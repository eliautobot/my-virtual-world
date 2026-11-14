// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Wildlife in the browser — the ambient tier (WP4.17, wp4-world-spec.md §6.3). Species come from the catalogue
// (shared/world-config/species, shared/species.js). Around the camera, each loaded tile offers habitat points (from the
// terrain worker, which knows its biomes), lakes and the rivers' slow stretches; groups of each species settle there as their hours, the weather and
// the seed allow — the same groups for everyone, since they come from the tile, the species and the world seed — and
// move by their behaviour on the shared clock (flocks, circling gulls, soaring hawks, swimming ducks, butterflies,
// fireflies, grazing deer and rabbits that run from a player on foot, fish leaping at dusk). One instanced draw per
// species, animated in the vertex shader (render/fauna-models.js). Groups fade in and out instead of popping.
// The shared tier (deer, horses, farm animals) comes from the server (server/world/wildlife.js: { t: 'fauna' } every
// 2 s with each animal's plan); it is drawn with the same models, moving smoothly along those plans.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { validateSpecies, activeAt } from '/shared/species.js';
import { CHUNK_M } from '/shared/terrain.js';
import { MODELS, faunaMaterial } from './fauna-models.js';
import { loadSkinned, skinnedPack, coatsOf, motion } from './fauna-skinned.js';
import { GU } from './scene.js';

const RANGE = { low: 260, medium: 420, high: 600 };   // m around the camera's target
const CAP = { firefly: 420, butterfly: 200, songbird: 220, 'reef-fish': 360 };
const HIPS = { deer: 0.8, rabbit: 0.3, cow: 0.68, sheep: 0.42, horse: 0.98, crab: 0.3, dolphin: -1, goat: 0.42, wolf: 0.8, tiger: 0.8, shark: -1 };   // (dolphin −1: its flukes beat up and down, render/fauna-models.js)
const STAND = { seagull: 0.31, bird: 0.19 };   // a landed bird's feet (a gull's legs) or belly below its middle, in its own size
const MODE = { rest: 0, walk: 1, run: 2, fly: 3, glide: 4, swim: 5, hop: 6, glow: 7 };
let app = null, species = [], packs = new Map(), groups = new Map(), lastPlan = 0, seed = 'world';
// The modelled species load when they are wanted (2026-11-14, the owner: "make the actual world load faster", and the
// travel lag): before, all 30 (50 MB) loaded before the world opened. Now a species' model is fetched in the background
// the first time a group of it is planned near the camera — or a little beyond, so it is usually ready before it is
// seen — a few at a time, nearest first; its groups are drawn (fading in) once it has arrived. If it can't load, its
// built model stands in, as before.
const spById = new Map(), modelState = new Map(), modelQueue = [];   // species id → 'queued' | 'loading' | 'ready' | 'failed'
let modelsActive = 0;
const MODELS_AT_ONCE = 3, PREFETCH = 1.6;   // (models fetched at once; the planning range's multiple a species is fetched within)
const shared = { herds: new Map(), off: null, seen: 0 };   // herds from the server and its wildlife clock's offset
let level = localStorage.getItem('mvw.wildlife') || 'normal';   // Display → Wildlife: off, fewer, normal
bus.on('display', k => { if (k === 'wildlife') { level = localStorage.getItem('mvw.wildlife') || 'normal'; groups.clear(); } });
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _qp = new THREE.Quaternion(), _side = new THREE.Vector3(0, 0, 1);
const SWIMMERS = ['reeffish', 'turtle', 'fish', 'otter', 'alligator', 'beaver', 'dolphin', 'shark', 'whale', 'marlin', 'manta', 'jellyfish'];
/** The clip slot of a modelled animal (render/fauna-skinned.js: 0 rest, 1 walk, 2 run) for a pose's mode: a swimmer's
 *  swim is its walk slot (its swimming clip), a glide too. */
const SKIN_MODE = { 0: 0, 1: 1, 2: 2, 4: 1, 5: 1, 6: 1 };
/** A pose's clip slot for a modelled animal: a bird's own fly, glide and swim clips (render/fauna-skinned.js slots 4,
 *  5, 6; tools/animals/bird_animal.py) where it has them, else SKIN_MODE. */
function slotOf(pk, mode) {
  const c = pk.clips;
  if (mode === MODE.fly && c.fly) return 4;
  if (mode === MODE.glide && (c.glide || c.fly)) return c.glide ? 5 : 4;
  if (mode === MODE.swim && c.swim) return 6;
  return SKIN_MODE[mode ?? 0] ?? 0;
}
const SLOT_CLIP = ['rest', 'walk', 'run', 'trot', 'fly', 'glide', 'swim'];
/** A modelled animal's fore and hind feet along its length ([front x, hind x], model metres at size 1), from its
 *  manifest's feet; null without them. */
function feetSpan(man) {
  const f = man.feet; if (!f?.LF || !f?.LH) return null;
  return [(f.LF[1][0] + f.RF[1][0]) / 2, (f.LH[1][0] + f.RH[1][0]) / 2];
}

const sstep = (a, b, v) => { const u = Math.min(1, Math.max(0, (v - a) / (b - a))); return u * u * (3 - 2 * u); };
function hash(str, n = 0) {
  let h = 2166136261 ^ n;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export async function init(a) {
  app = a;
  seed = S.world?.worldId || 'world';
  const all = [];
  try {
    // (the catalogue's files fetched side by side: one after another, 42 of them, took seconds over a distant network)
    const idx = await (await fetch('/shared/world-config/species/index.json')).json();
    const list = await Promise.all(idx.species.map(id => fetch(`/shared/world-config/species/${id}.json`).then(r => r.json())));
    list.forEach((sp, k) => {
      const why = validateSpecies(sp);
      if (why.length) { console.warn(`[wildlife] ${idx.species[k]}: ${why.join('; ')}`); return; }
      all.push(sp); spById.set(sp.id, sp);
      if (sp.tier === 'ambient') species.push(sp);
    });
  } catch (e) { console.warn('[wildlife] the species catalogue could not load:', e.message); return; }
  // the built models now; a modelled species' (render/fauna-skinned.js) when it is first wanted: ensureModel
  for (const sp of all) if (!sp.asset) addBuilt(sp);
  // every built species' shader compiled now (in the background where the browser can), not in the frame it first appears
  app.stage.renderer.compileAsync?.(app.stage.scene, app.stage.camera).catch(() => {});
  app.wildlife = {
    get count() { let n = 0; for (const P of packs.values()) n += P.skinned ? P.skinned.count : P.mesh.count; return n; }, groups, species, shared, plan: () => plan(performance.now()),
    /** The modelled species' models: { id: 'queued' | 'loading' | 'ready' | 'failed' } (absent: not wanted yet). */
    get models() { return Object.fromEntries(modelState); },
  };
  bus.on('frame', update);
  for (const ev of ['terrain', 'roads', 'world']) bus.on(ev, () => { GQ.clear(); seaCells.clear(); });   // (the ground changed: reshaped, roads, building pads)
  bus.on('msg:fauna', m => {
    const now = performance.now() / 1000;
    shared.off = m.wt - now; shared.seen = now;
    const keep = new Set();
    for (const h of m.herds || []) {
      const sp = spById.get(h.s); if (!sp) continue;
      keep.add(h.id); ensureModel(sp, 2);
      const was = shared.herds.get(h.id);
      shared.herds.set(h.id, { id: h.id, sp, m: h.m, shown: was?.shown, r: h.m.map((_, i) => hash(h.id, i)), st: was?.st || [] });
    }
    for (const id of [...shared.herds.keys()]) if (!keep.has(id)) shared.herds.delete(id);
  });
}

/** A species drawn from its built model (render/fauna-models.js): one instanced draw. */
function addBuilt(sp) {
  const cap = CAP[sp.id] || 160, geo = MODELS[sp.model]().clone();
  geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
  // (what swims below the sea is seen through its water, with the full sea: render/water.js underwater)
  const swims = SWIMMERS.includes(sp.model), T = app.terrain;
  const mesh = new THREE.InstancedMesh(geo, swims && T?.uw ? T.uw(faunaMaterial(sp.model)) : faunaMaterial(sp.model), cap);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = sp.model === 'deer'; mesh.userData.smallCaster = true; mesh.name = `wildlife-${sp.id}`;
  mesh.matrixAutoUpdate = false;   // (it never moves: its animals are placed by their instance matrices)
  app.stage.scene.add(mesh);
  const pk = { sp, mesh, cap, anim: geo.attributes.aAnim, colors: sp.colors.map(c => new THREE.Color(c)) };
  packs.set(sp.id, pk);
  return pk;
}
/** A modelled species from its loaded asset: its draws, ready before it is first seen (the shader — one for every
 *  modelled species — and the textures sent to the GPU now, not in the frame it appears). */
function addSkinned(sp, A) {
  const cap = CAP[sp.id] || 160;
  const pk = { sp, cap, n: 0, skinned: skinnedPack(A, cap, app.stage.scene, `wildlife-${sp.id}`, coatsOf(sp, A)), clips: A.man.clips, span: feetSpan(A.man) };
  // (a modelled swimmer is seen through the water, as the built ones are: render/water.js underwater)
  if (SWIMMERS.includes(sp.model) && app.terrain?.uw) new Set(pk.skinned.meshes.map(m => m.material)).forEach(m => app.terrain.uw(m));
  const r = app.stage.renderer;
  try { for (const t of [A.color, A.mask, A.bones]) r.initTexture?.(t); } catch { /* sent with its first draw instead */ }
  r.compileAsync?.(pk.skinned.meshes[0], app.stage.camera, app.stage.scene).catch(() => {});
  packs.set(sp.id, pk);
  return pk;
}
/** Ask for a modelled species' model (priority: 2 its animals are here, 1 they are planned near, 0 a little beyond). */
function ensureModel(sp, pri) {
  if (!sp?.asset || packs.has(sp.id) || level === 'off') return;
  const st = modelState.get(sp.id);
  if (st === 'queued') { const q = modelQueue.find(x => x.sp === sp); if (q && pri > q.pri) q.pri = pri; return; }
  if (st) return;   // (loading, or failed: its built model stands in)
  modelState.set(sp.id, 'queued'); modelQueue.push({ sp, pri });
  pumpModels();
}
function pumpModels() {
  while (modelsActive < MODELS_AT_ONCE && modelQueue.length) {
    modelQueue.sort((a, b) => b.pri - a.pri);
    const { sp } = modelQueue.shift();
    modelState.set(sp.id, 'loading'); modelsActive++;
    loadSkinned(sp.asset).then(A => {
      if (A) { addSkinned(sp, A); modelState.set(sp.id, 'ready'); } else { addBuilt(sp); modelState.set(sp.id, 'failed'); }
    }).catch(() => { if (!packs.has(sp.id)) addBuilt(sp); modelState.set(sp.id, 'failed'); })
      .finally(() => { modelsActive--; pumpModels(); });
  }
}

// ------------------------------------------------------------------ where groups live
/** The groups that belong around the camera now: from loaded tiles' habitats and nearby lakes. */
function plan(now) {
  const T = app.terrain; if (!T) return;
  const ct = app.cam.target, R = RANGE[app.stage.q.name] || 420, R2 = R * PREFETCH, hour = S.hour, kind = app.weather?.now?.kind || 'clear';
  const want = new Map();
  // near: within the planning range (its groups are wanted now); else within PREFETCH of it, where only its model is
  // asked for (a group there would be wanted soon)
  const consider = (key, sp, anchors, areaKm2, near = true) => {
    // (a species of deep water keeps to anchors with that much sea over them: whales, marlin)
    if (sp.depth) { const sea = T.params?.seaLevel ?? 0; anchors = anchors.filter(a => sea - a.y >= sp.depth[0] && sea - a.y <= sp.depth[1]); }
    // (a species of the heights keeps to anchors that high above the sea: eagles over the mountains; one of the
    // lowlands below its top: parrots in the warm forests near the coast)
    if (sp.altitude) { const sea = T.params?.seaLevel ?? 0; anchors = anchors.filter(a => a.y - sea >= sp.altitude[0] && a.y - sea <= sp.altitude[1]); }
    if (!anchors.length) return;
    const exp = sp.perKm2 * areaKm2, n = Math.floor(exp) + (hash(key, 1) < exp % 1 ? 1 : 0);
    if (n > 0) ensureModel(sp, near ? 1 : 0);
    if (!near) return;
    for (let k = 0; k < Math.min(n, level === 'fewer' ? 1 : 3); k++) {
      const a = anchors[Math.floor(hash(key, 10 + k) * anchors.length)];
      want.set(`${key}:${k}`, { sp, a, key: `${key}:${k}` });
    }
  };
  for (const t of T.tiles.values()) {
    if (!t.hab || t.level !== 0 || !T.shown.has(t.key)) continue;
    const cx = t.x0 + t.S / 2, cz = t.z0 + t.S / 2, dt = Math.hypot(cx - ct.x, cz - ct.z);
    if (dt > R2) continue;
    for (const sp of species) {
      if (!activeAt(sp, hour) || !sp.weather.includes(kind) || sp.habitats.includes('lake') || sp.habitats.includes('river')) continue;
      const pts = []; let frac = 0;
      for (const h of sp.habitats) { const L = t.hab[h]; if (!L) continue; frac += L.length / 3; for (let i = 0; i < L.length; i += 3) pts.push({ x: L[i], y: L[i + 1], z: L[i + 2] }); }
      consider(`${seed}:${t.key}:${sp.id}`, sp, pts, (t.S * t.S / 1e6) * Math.min(1, frac / 24), dt <= R);
    }
  }
  // the open sea (2026-11-12, the owner: "I can't spot the sharks"): the terrain hides its tiles of deep water (the sea
  // is drawn over them), so they had no habitats and the sea's animals lived only along the coast; here the sea round
  // the camera cell by cell (the level-0 tiles' grid, so a group keeps its key once its tile has habitats), its anchors
  // where the water is 7-60 m deep, as the tiles' own 'sea' (render/terrain.worker.js)
  const seaSp = species.filter(sp => sp.habitats.includes('sea') && activeAt(sp, hour) && sp.weather.includes(kind));
  if (seaSp.length) {
    const C = CHUNK_M, n = Math.ceil(R / C), ci = Math.floor(ct.x / C), cj = Math.floor(ct.z / C);
    for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) {
      if (Math.hypot((i + 0.5) * C - ct.x, (j + 0.5) * C - ct.z) > R) continue;
      const tk = `0:${i}:${j}`, t = T.tiles.get(tk);
      if (t?.hab && T.shown.has(tk)) continue;   // (its tile has its habitats: above)
      const pts = seaCell(i, j); if (!pts.length) continue;
      for (const sp of seaSp) consider(`${seed}:${tk}:${sp.id}`, sp, pts, (C * C / 1e6) * pts.length / 25);
    }
  }
  for (const L of T.lakes || []) {
    if (L.userData.frozen || L.userData.lake?.pool) continue;   // (a frozen tarn, a waterfall's churning pool: no ducks)
    const r = L.userData.r || L.geometry.parameters?.radius || 60, lx = L.position.x, lz = L.position.z;
    const dl = Math.hypot(lx - ct.x, lz - ct.z);
    if (dl > R2 + r) continue;
    for (const sp of species) {
      if (!sp.habitats.includes('lake') || !activeAt(sp, hour) || !sp.weather.includes(kind)) continue;
      const anchors = []; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; anchors.push({ x: lx + Math.cos(a) * r * 0.62, y: L.position.y, z: lz + Math.sin(a) * r * 0.62, lake: { x: lx, z: lz, r: r * 0.8, y: L.position.y } }); }
      consider(`${seed}:lake${Math.round(lx)},${Math.round(lz)}:${sp.id}`, sp, anchors, Math.PI * r * r / 1e6, dl <= R + r);
    }
  }
  // rivers (otters, beavers): their slow, wide stretches (every RIVER_STRETCH m of course, no rapids or falls), each a
  // place a group swims up and down
  const I = T.ground?.island, rsp = species.filter(sp => sp.habitats.includes('river') && activeAt(sp, hour) && sp.weather.includes(kind));
  if (I?.rivers && rsp.length) for (const Rv of I.rivers) for (const st of riverStretches(Rv)) {
    const ds = Math.hypot(st.x - ct.x, st.z - ct.z);
    if (ds > R2 + RIVER_STRETCH) continue;
    for (const sp of rsp) consider(`${seed}:${Rv.id}:${st.j}:${sp.id}`, sp, [st], RIVER_STRETCH * st.w / 1e6, ds <= R + RIVER_STRETCH);
  }
  // keep the groups still wanted, start new ones, let the others fade out
  for (const [k, g] of groups) if (!want.has(k)) g.leaving = g.leaving ?? now;
  for (const [k, w] of want) {
    const g = groups.get(k);
    if (g) { g.leaving = null; continue; }
    const sp = w.sp, n = sp.group[0] + Math.floor(hash(k, 3) * (sp.group[1] - sp.group[0] + 1));
    groups.set(k, { sp, a: w.a, key: k, born: now, shown: null, leaving: null, flee: null, sk: !!packs.get(sp.id)?.skinned, members: Array.from({ length: n }, (_, i) => ({ r: [hash(k, 100 + i), hash(k, 200 + i), hash(k, 300 + i), hash(k, 400 + i)], col: Math.floor(hash(k, 500 + i) * sp.colors.length), x: w.a.x, y: w.a.y, z: w.a.z, yaw: 0 })) });
  }
}

/** A cell of the open sea (CHUNK_M square at i, j): its points (of a jittered 5 x 5 grid) with 7-60 m of water over them,
 *  { x, y (the floor), z } — worked out once (until the ground changes). */
const seaCells = new Map();
function seaCell(i, j) {
  const k = `${i}:${j}`; let out = seaCells.get(k); if (out) return out;
  const C = CHUNK_M, sea = app.terrain?.params.seaLevel ?? 0; out = [];
  for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) {
    const x = (i + (a + 0.2 + 0.6 * hash(k, a * 5 + b)) / 5) * C, z = (j + (b + 0.2 + 0.6 * hash(k, 50 + a * 5 + b)) / 5) * C, y = ground(x, z), dep = sea - y;
    if (dep > 7 && dep < 60) out.push({ x, y, z });
  }
  if (seaCells.size > 6000) seaCells.delete(seaCells.keys().next().value);
  seaCells.set(k, out);
  return out;
}

const RIVER_STRETCH = 120;   // m of a river's course: one place for a group of its swimmers
const stretchCache = new WeakMap();
/** A river's slow, wide stretches: [{ j, x, y, z (middle), w (width), s0, s1, pts (its course points, with s) }]. */
function riverStretches(Rv) {
  let out = stretchCache.get(Rv); if (out) return out;
  out = []; const P = Rv.pts, by = new Map();
  for (const q of P) { const j = Math.floor(q.s / RIVER_STRETCH); (by.get(j) || by.set(j, []).get(j)).push(q); }
  for (const [j, Q] of by) {
    if (Q.length < 2) continue;
    const a = Q[0], b = Q.at(-1), len = b.s - a.s; if (len < RIVER_STRETCH * 0.6) continue;
    let steep = false; for (let k = 1; k < Q.length; k++) if ((Q[k - 1].y - Q[k].y) / Math.max(1, Q[k].s - Q[k - 1].s) > 0.025) steep = true;
    const w = Math.min(...Q.map(q => q.w)); if (steep || w < 5) continue;
    const m = Q[Math.floor(Q.length / 2)];
    out.push({ j, x: m.x, y: m.y, z: m.z, w, s0: a.s + 6, s1: b.s - 6, pts: Q, river: true });
  }
  stretchCache.set(Rv, out);
  return out;
}
/** A point on a stretch at course distance s: { x, y, z, dx, dz (downstream) }. */
function alongRiver(st, s) {
  const P = st.pts; let k = 1; while (k < P.length - 1 && P[k].s < s) k++;
  const a = P[k - 1], b = P[k], l = Math.max(1e-3, b.s - a.s), u = Math.min(1, Math.max(0, (s - a.s) / l)), dx = (b.x - a.x) / l, dz = (b.z - a.z) / l, n = Math.hypot(dx, dz) || 1;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, dx: dx / n, dz: dz / n };
}

// ------------------------------------------------------------------ the shallows (wading birds)
/** Water 10-45 cm deep at (x, z) (the sea over its floor). */
function wadeable(x, z) {
  const sea = app.terrain?.params.seaLevel ?? 0, d = sea - ground(x, z);
  return d > 0.1 && d < 0.45 && !(app.terrain?.ground?.island?.inTown?.(x, z));
}
/** The middle of the shallows nearest a point on a beach: rings out from it to 120 m, the first wadeable spot with
 *  wadeable water round it (so the flock has room); null if none. */
function shallowsNear(x, z, key) {
  for (let r = 4; r <= 120; r += 4) for (let k = 0; k < 16; k++) {
    const a = (k + hash(key, 3)) / 16 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (!wadeable(px, pz)) continue;
    let ok = 0; for (let j = 0; j < 6; j++) if (wadeable(px + Math.cos(j * 1.047) * 5, pz + Math.sin(j * 1.047) * 5)) ok++;
    if (ok >= 3) return { x: px, z: pz };
  }
  return null;
}

// ------------------------------------------------------------------ how they move
// The ground under the animals: worked out at the point (a road's drawn top there, else the island's height) and kept on
// a 25 cm grid. heightAt fills a 122 m chunk of 2601 heights round any point it hasn't seen — flying over the island,
// the animals coming into view built a dozen chunks a second: frames of 100-300 ms on a phone (2026-10-14).
const GQ = new Map(), GQ_MAX = 8000;
let gqAt = 0;
function ground(x, z) {
  const T = app.terrain; if (!T) return 0;
  const k = Math.round(x * 4) * 4194304 + Math.round(z * 4);
  let y = GQ.get(k);
  if (y === undefined) {
    y = T.ground?.island.roads?.top(x, z) ?? T.pointHeight(x, z);
    if (GQ.size >= GQ_MAX) GQ.delete(GQ.keys().next().value);
    GQ.set(k, y);
  }
  return y;
}
/** One member's pose at time t (s on the shared clock): sets m.x, m.y, m.z, m.yaw, m.mode, m.rate. */
function pose(g, m, i, t, player) {
  const sp = g.sp, a = g.a, r = m.r, H = sp.height || [0, 0];
  switch (sp.behaviour) {
    case 'flock': {
      // the flock wanders over its patch; now and then it settles on the ground for a while
      const landed = ((t / 95 + hash(g.key, 7)) % 1) > 0.72;
      const w = 0.045 + hash(g.key, 8) * 0.03, R = 25 + hash(g.key, 9) * 30;
      const cx = a.x + Math.sin(t * w + 1.3) * R, cz = a.z + Math.sin(t * w * 1.7) * R * 0.7;
      const ox = Math.sin(t * 0.9 + r[0] * 6.28) * 3 + (r[1] - 0.5) * 6, oz = Math.cos(t * 0.8 + r[2] * 6.28) * 3 + (r[3] - 0.5) * 6;
      const gx = cx + ox, gz = cz + oz, gy = ground(gx, gz);
      // (a modelled bird stands on its feet at its origin; a built one's belly or legs are below its middle)
      if (landed) { m.x = a.x + (r[1] - 0.5) * 10; m.z = a.z + (r[3] - 0.5) * 10; m.y = ground(m.x, m.z) + (g.sk ? 0 : (STAND[sp.model] ?? 0.02) * sp.size * (0.85 + 0.3 * r[3])); m.mode = MODE.rest; m.rate = 1; m.yaw = r[0] * 6.28 + (g.sk ? 0 : Math.sin(t * 0.5 + r[2] * 9) * 0.6); return; }
      m.x = gx; m.z = gz; m.y = gy + H[0] + (H[1] - H[0]) * (0.5 + 0.5 * Math.sin(t * 0.3 + r[0] * 6)) ;
      m.yaw = Math.atan2(-(Math.cos(t * w * 1.7) * w * 1.7 * R * 0.7), Math.cos(t * w + 1.3) * w * R);
      m.mode = Math.sin(t * 0.7 + r[1] * 6.28) > 0.55 ? MODE.glide : MODE.fly; m.rate = 2.6 + r[2]; return;
    }
    case 'circle': case 'soar': {
      const R = (sp.behaviour === 'soar' ? 90 : 30) + r[0] * (sp.behaviour === 'soar' ? 70 : 40), w = sp.speed / R * (r[1] > 0.5 ? 1 : -1), ang = t * w + r[2] * 6.28;
      m.x = a.x + Math.cos(ang) * R; m.z = a.z + Math.sin(ang) * R;
      m.y = Math.max(ground(m.x, m.z), app.terrain?.params.seaLevel ?? 0) + H[0] + (H[1] - H[0]) * (0.5 + 0.5 * Math.sin(t * 0.13 + r[3] * 6));
      m.yaw = Math.atan2(-(Math.cos(ang) * w), -Math.sin(ang) * w);
      m.mode = Math.sin(t * 0.4 + r[0] * 9) > (sp.behaviour === 'soar' ? 0.85 : 0.5) ? MODE.fly : MODE.glide; m.rate = sp.behaviour === 'soar' ? 1.4 : 2.2;
      m.roll = (w > 0 ? 1 : -1) * Math.min(0.45, Math.atan(sp.speed * Math.abs(w) / 9.8) + 0.12);   // (banked into the turn)
      return;
    }
    case 'swim': {
      if (a.river) {
        // up and down its stretch of river in a long, lazy loop (along the course and a little across it, so it turns
        // round smoothly at each end), the group following one behind the other
        const half = (a.s1 - a.s0) / 2, ws = sp.speed / Math.max(10, half) * 1.4, ph = t * ws + hash(g.key, 5) * 6.28 - i * 0.12;
        const lat = (hash(g.key, 6) - 0.5) * a.w * 0.3 + (r[0] - 0.5) * 0.8, la = a.w * 0.2;
        const s = (a.s0 + a.s1) / 2 + half * Math.cos(ph), q = alongRiver(a, s), off = lat + la * Math.sin(ph);
        m.x = q.x - q.dz * off; m.z = q.z + q.dx * off; m.y = q.y;
        const vs = -half * Math.sin(ph), vl = la * Math.cos(ph), vx = q.dx * vs - q.dz * vl, vz = q.dz * vs + q.dx * vl;
        m.yaw = Math.atan2(-vz, vx); m.mode = MODE.swim; m.rate = 1; return;
      }
      // round the lake; the circle widens and narrows slowly — never faster than a part of the swim itself (on a big
      // lake it outran it, and they slid sideways: 2026-10-03) — facing the way they really move
      // (at their own speed along the circle: 2026-10-03 "lake animals need to move a bit faster" — they went at a
      // third of it)
      const L = a.lake, w = sp.speed / Math.max(6, L.r * 0.55), ang = t * w + hash(g.key, 5) * 6.28 - i * 0.05;
      const wr = Math.min(0.02, 0.15 * sp.speed / (0.35 * Math.max(10, L.r))), pr = t * wr + hash(g.key, 6) * 6;
      const rr = L.r * (0.55 + 0.35 * Math.sin(pr)) + (r[0] - 0.5) * 4, vr = L.r * 0.35 * Math.cos(pr) * wr;
      m.x = L.x + Math.cos(ang) * rr; m.z = L.z + Math.sin(ang) * rr; m.y = L.y;
      const vx = vr * Math.cos(ang) - rr * w * Math.sin(ang), vz = vr * Math.sin(ang) + rr * w * Math.cos(ang);
      m.yaw = Math.atan2(-vz, vx); m.mode = MODE.swim; m.rate = 1; return;
    }
    case 'flutter': {
      m.x = a.x + Math.sin(t * 0.31 + r[0] * 20) * 6 + Math.sin(t * 1.3 + r[1] * 9) * 1.5;
      m.z = a.z + Math.cos(t * 0.27 + r[2] * 20) * 6 + Math.sin(t * 1.1 + r[3] * 9) * 1.5;
      m.y = ground(m.x, m.z) + H[0] + (H[1] - H[0]) * (0.5 + 0.5 * Math.sin(t * 0.9 + r[0] * 7));
      m.yaw = t * 0.8 + r[1] * 6.28; m.mode = MODE.fly; m.rate = 7 + r[2] * 3; return;
    }
    case 'glow': {
      m.x = a.x + Math.sin(t * 0.11 + r[0] * 20) * 9; m.z = a.z + Math.cos(t * 0.09 + r[1] * 20) * 9;
      m.y = ground(m.x, m.z) + H[0] + (H[1] - H[0]) * (0.5 + 0.5 * Math.sin(t * 0.3 + r[2] * 7)); m.yaw = 0; m.mode = MODE.glow; m.rate = 0.8 + r[3]; return;
    }
    case 'graze': {
      // wander between spots near the herd's place; run from a player on foot who comes close, then settle again
      let ax = a.x, az = a.z;
      if (g.flee) { ax = g.flee.x; az = g.flee.z; }
      const seg = Math.floor(t / 14 + r[0] * 3), f = (t / 14 + r[0] * 3) - seg, walking = f < 0.25;
      const spot = k => ({ x: ax + (hash(g.key, 900 + i * 31 + k) - 0.5) * 30, z: az + (hash(g.key, 1700 + i * 31 + k) - 0.5) * 30 });
      const p0 = spot(seg), p1 = spot(seg + 1), u = walking ? f / 0.25 : 1;
      let x = p0.x + (p1.x - p0.x) * u, z = p0.z + (p1.z - p0.z) * u;
      let mode = walking ? (sp.model === 'rabbit' ? MODE.hop : MODE.walk) : MODE.rest, yaw = Math.atan2(-(p1.z - p0.z), p1.x - p0.x);
      if (player && sp.flee > 0) {
        const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz);
        if (d < sp.flee && (!g.flee || t - g.flee.t > 20)) g.flee = { x: x + dx / d * sp.flee * 3, z: z + dz / d * sp.flee * 3, t };
      }
      if (g.flee && t - g.flee.t < 6) {   // running to the new place
        const k = Math.min(1, (t - g.flee.t) / 6), fx = m.x + (g.flee.x + (r[1] - 0.5) * 12 - m.x) * Math.min(1, k * 0.25 + 0.02), fz = m.z + (g.flee.z + (r[2] - 0.5) * 12 - m.z) * Math.min(1, k * 0.25 + 0.02);
        yaw = Math.atan2(-(fz - m.z), fx - m.x); x = fx; z = fz; mode = sp.model === 'rabbit' ? MODE.hop : MODE.run;
      }
      if (app.terrain?.isWater(x, z)) { x = m.x; z = m.z; }
      m.x = x; m.z = z; m.y = ground(x, z); m.yaw = yaw; m.mode = mode; m.rate = mode === MODE.run ? 2.2 : mode === MODE.hop ? 2.4 : 1.1; return;
    }
    case 'school': {
      // a school weaving over its patch of reef, between the sea floor and the surface (2026-10-03: marine life)
      const sea = app.terrain?.params.seaLevel ?? 0, w = sp.speed / 9, R = 7 + hash(g.key, 9) * 9, ang = t * w + hash(g.key, 5) * 6.28;
      const cx = a.x + Math.cos(ang) * R, cz = a.z + Math.sin(ang * 1.3) * R * 0.7;
      m.x = cx + Math.sin(t * 0.7 + r[0] * 6.28) * 1.1 + (r[1] - 0.5) * 2.6; m.z = cz + Math.cos(t * 0.6 + r[2] * 6.28) * 1.1 + (r[3] - 0.5) * 2.6;
      const floor = ground(m.x, m.z), top = sea - 0.3;
      if (top - floor < 0.5) { m.hide = true; return; }   // too shallow just there
      m.y = floor + 0.25 + (top - floor - 0.25) * (0.25 + 0.45 * r[2]) + Math.sin(t * 0.9 + r[0] * 9) * 0.12;
      const vx = -Math.sin(ang) * w * R, vz = Math.cos(ang * 1.3) * 1.3 * w * R * 0.7;
      m.yaw = Math.atan2(-vz, vx) + Math.sin(t * 1.3 + r[1] * 6) * 0.15; m.mode = MODE.swim; m.rate = 2.5 + r[1]; return;
    }
    case 'cruise': {
      // a slow glide on a wide loop near the sea floor, the front flippers stroking
      const sea = app.terrain?.params.seaLevel ?? 0, R = 14 + r[0] * 12, w = sp.speed / R * (r[1] > 0.5 ? 1 : -1), ang = t * w + r[2] * 6.28;
      m.x = a.x + Math.cos(ang) * R; m.z = a.z + Math.sin(ang) * R * 0.8;
      const floor = ground(m.x, m.z), top = sea - 0.4;
      if (top - floor < 0.6) { m.hide = true; return; }
      const low = floor + 0.35 + (top - floor - 0.35) * (0.2 + 0.25 * (0.5 + 0.5 * Math.sin(t * 0.05 + r[3] * 6)));
      // (a turtle comes up to breathe every minute or so: rising, a few breaths with its shell awash, then down again —
      // 2026-11-12, the owner: sea turtles were hard to see, gliding near the floor)
      const per = sp.breathe ? 45 + r[3] * 30 : 0, u = per ? ((t + r[0] * per) % per) / per : 1;
      const up = u < 0.06 ? sstep(0, 0.06, u) : u < 0.16 ? 1 : u < 0.24 ? 1 - sstep(0.16, 0.24, u) : 0;
      m.y = low + (sea - 0.12 * sp.size - low) * up;
      m.pitch = u < 0.06 ? 0.35 * Math.sin(u / 0.06 * Math.PI) : u >= 0.16 && u < 0.24 ? -0.3 * Math.sin((u - 0.16) / 0.08 * Math.PI) : 0;
      m.yaw = Math.atan2(-(Math.cos(ang) * 0.8 * w), -Math.sin(ang) * w); m.mode = MODE.glide; m.rate = up > 0.9 ? 0.8 : 1.6; return;   // (glide: the flippers stroke gently)
    }
    case 'pod': {
      // dolphins (2026-10-04): a pod on a long loop offshore, one behind and beside another, each breaking the
      // surface in a low arc every few seconds and, now and then, leaping clear; never over water shallower than 4 m
      const sea = app.terrain?.params.seaLevel ?? 0, R = 70 + hash(g.key, 9) * 60, w = sp.speed / R * (hash(g.key, 8) > 0.5 ? 1 : -1);
      const a2 = t * w + hash(g.key, 5) * 6.28 - i * 3.4 * (0.6 + r[0] * 0.6) / R * Math.sign(w), off = (r[1] - 0.5) * 7;
      const cx = a.x + Math.cos(a2) * (R + off), cz = a.z + Math.sin(a2) * (R + off) * 0.75;
      if (sea - ground(cx, cz) < 4) { m.hide = true; return; }
      const per = 5 + r[2] * 3, ph = (t + r[3] * per) / per, u = ph % 1, leap = hash(g.key, Math.floor(ph) * 7 + i) < 0.18;
      let y, pitch;
      if (u < 0.3) { const v = u / 0.3; y = sea - 0.35 + Math.sin(v * Math.PI) * (leap ? 1.9 : 0.45); pitch = Math.cos(v * Math.PI) * (leap ? 0.95 : 0.45); }
      else { const v = (u - 0.3) / 0.7; y = sea - 0.35 - Math.sin(v * Math.PI) * 1.6; pitch = -Math.cos(v * Math.PI) * 0.25; }
      m.x = cx; m.z = cz; m.y = y; m.pitch = pitch;
      m.yaw = Math.atan2(-(Math.cos(a2) * w * (R + off) * 0.75), -Math.sin(a2) * w * (R + off)); m.mode = MODE.swim; m.rate = 1.2 + r[0] * 0.4; return;
    }
    case 'patrol': {
      // sharks (2026-11-12, the product owner: "sharks in open sea"): one alone on a wide, slow loop offshore, a few metres down,
      // now and then rising till its fin cuts the surface; never over water shallower than its depth and 2 m
      // (its loop drawn in to stay over water deep enough all the way round — a reef shark's near the shore — instead of
      // vanishing wherever it crossed the shallows: 2026-11-12, the owner: "I can't spot the sharks")
      const sea = app.terrain?.params.seaLevel ?? 0, [d0, d1] = sp.swimDepth || [0.45, 3.25];
      const R = g.loopR ??= (() => {
        const R0 = 45 + hash(g.key, 9) * 50, deepAll = R => { for (let k = 0; k < 12; k++) { const q = k / 12 * 6.283; if (sea - ground(a.x + Math.cos(q) * R, a.z + Math.sin(q) * R * 0.7) < d1 + 2) return false; } return true; };
        for (const f of [1, 0.7, 0.5, 0.35, 0.25]) if (deepAll(R0 * f)) return R0 * f;
        return R0 * 0.25;
      })();
      const w = sp.speed / R * (hash(g.key, 8) > 0.5 ? 1 : -1);
      const ang = t * w + hash(g.key, 5) * 6.28, cx = a.x + Math.cos(ang) * R, cz = a.z + Math.sin(ang) * R * 0.7;
      const depth = d0 + (d1 - d0) * (0.5 + 0.5 * Math.sin(t * 0.045 + r[2] * 6.28)) ** 2;   // (a shark at 0.45 m: its fin is out)
      if (sea - ground(cx, cz) < depth + 2) { m.hide = true; return; }
      m.x = cx; m.z = cz; m.y = sea - depth;
      m.yaw = Math.atan2(-(Math.cos(ang) * w * R * 0.7), -Math.sin(ang) * w * R); m.mode = MODE.swim; m.rate = 0.6;
      if (sp.leaps) {
        // now and then (a few seconds in a minute or so) it rises and leaps clear in an arc, nose up then down
        const per = 50 + r[3] * 40, u = ((t + r[1] * per) % per) / per, L = 0.07;
        if (u < L) { const v = u / L; m.y = sea - d0 + Math.sin(v * Math.PI) * (1.6 + r[0]); m.pitch = Math.cos(v * Math.PI) * 0.9; }
      }
      return;
    }
    case 'roam': {
      // whales (2026-11-12): a long slow loop over deep water; up at the surface for a few breaths (its back awash), then
      // down again for most of a minute, nose down going and up coming back
      const sea = app.terrain?.params.seaLevel ?? 0, R = 120 + hash(g.key, 9) * 120, w = sp.speed / R * (hash(g.key, 8) > 0.5 ? 1 : -1);
      const ang = t * w + hash(g.key, 5) * 6.28 - i * 0.04, cx = a.x + Math.cos(ang) * R + (r[0] - 0.5) * 12, cz = a.z + Math.sin(ang) * R * 0.75 + (r[1] - 0.5) * 12;
      const deep = Math.min(9, sea - ground(cx, cz) - 0.1 * sp.size - 4); if (deep < 2) { m.hide = true; return; }
      const per = 45 + r[2] * 20, u = ((t + r[3] * per) % per) / per;
      const sink = u < 0.18 ? 0 : u < 0.3 ? (1 - Math.cos((u - 0.18) / 0.12 * Math.PI)) / 2 : u < 0.85 ? 1 : (1 + Math.cos((u - 0.85) / 0.15 * Math.PI)) / 2;
      const dsink = u < 0.18 || (u >= 0.3 && u < 0.85) ? 0 : u < 0.3 ? 1 : -1;
      // (at the surface its back just awash: its middle a tenth of its length down)
      m.x = cx; m.z = cz; m.y = sea - 0.1 * sp.size - sink * deep + (u < 0.18 ? 0.08 * Math.sin(t * 1.3) : 0);
      m.pitch = -0.28 * dsink * Math.sin(Math.PI * (u < 0.3 ? (u - 0.18) / 0.12 : (u - 0.85) / 0.15));
      m.yaw = Math.atan2(-(Math.cos(ang) * w * R * 0.75), -Math.sin(ang) * w * R); m.mode = MODE.swim; m.rate = 0.3; return;
    }
    case 'drift': {
      // jellyfish (2026-11-12): a bloom drifting slowly about its patch of sea near the surface, each one bobbing as it
      // pulses
      const sea = app.terrain?.params.seaLevel ?? 0;
      m.x = a.x + (r[0] - 0.5) * 18 + Math.sin(t * 0.03 + r[1] * 6.28) * 6; m.z = a.z + (r[1] - 0.5) * 18 + Math.cos(t * 0.027 + r[2] * 6.28) * 6;
      if (sea - ground(m.x, m.z) < 2) { m.hide = true; return; }
      m.y = sea - 0.5 - r[2] * 2.5 + 0.18 * Math.sin(t * 0.9 + r[3] * 6.28);
      m.yaw = r[3] * 6.28 + t * 0.02; m.mode = MODE.swim; m.rate = 0.5; return;
    }
    case 'wade': {
      // flamingos (2026-11-12): a flock wading in the shallows off a beach — the strip of sea 10-45 cm deep — each one
      // walking slowly from spot to spot and feeding, head down, in between; never out of its depth or up on the sand
      if (!g.wade) g.wade = shallowsNear(a.x, a.z, g.key) || { none: true };
      if (g.wade.none) { m.hide = true; return; }
      // (its own patch of the shallows, a few metres from the flock's middle; a stroll of a few metres every 20 s)
      const c = g.wade, seg = Math.floor(t / 20 + r[0] * 5), f = (t / 20 + r[0] * 5) - seg, walking = f < 0.4;
      const hx = c.x + (r[1] - 0.5) * 14, hz = c.z + (r[2] - 0.5) * 14;
      const spot = k => { for (let tr = 0; tr < 6; tr++) { const x = hx + (hash(g.key, 900 + i * 31 + k * 7 + tr) - 0.5) * 7, z = hz + (hash(g.key, 1700 + i * 31 + k * 7 + tr) - 0.5) * 7; if (wadeable(x, z)) return { x, z }; } return { x: c.x + (r[1] - 0.5) * 3, z: c.z + (r[2] - 0.5) * 3 }; };
      const p0 = spot(seg), p1 = spot(seg + 1), u = walking ? f / 0.4 : 1;
      m.x = p0.x + (p1.x - p0.x) * u; m.z = p0.z + (p1.z - p0.z) * u; m.y = ground(m.x, m.z);
      m.yaw = Math.atan2(-(p1.z - p0.z), p1.x - p0.x); m.mode = walking ? MODE.walk : MODE.rest; m.rate = 1; return;
    }
    case 'scuttle': {
      // crabs (2026-10-04): short sideways dashes between spots on their patch of sand, pausing between; never into
      // the water
      const sg = Math.floor(t / 4 + r[0] * 7), f = (t / 4 + r[0] * 7) - sg, moving = f < 0.3;
      const spot = k => ({ x: a.x + (hash(g.key, 900 + i * 31 + k) - 0.5) * 14, z: a.z + (hash(g.key, 1700 + i * 31 + k) - 0.5) * 14 });
      const p0 = spot(sg), p1 = spot(sg + 1), u = moving ? f / 0.3 : 1;
      let x = p0.x + (p1.x - p0.x) * u, z = p0.z + (p1.z - p0.z) * u;
      if (app.terrain?.isWater(x, z)) { x = a.x + (r[1] - 0.5) * 3; z = a.z + (r[2] - 0.5) * 3; }
      m.x = x; m.z = z; m.y = ground(x, z);
      m.yaw = Math.atan2(-(p1.z - p0.z), p1.x - p0.x) + Math.PI / 2; m.mode = moving ? MODE.run : MODE.rest; m.rate = 3.5; return;
    }
    case 'jump': {
      // a fish shows only while it leaps: an arc every few seconds somewhere near its spot
      const L = a.lake, per = 7 + r[0] * 8, ph = (t / per + r[1]) % 1, cyc = Math.floor(t / per + r[1]), dur = 1.1 / per;
      if (ph > dur) { m.hide = true; return; }
      m.hide = false;
      const u = ph / dur, ang = hash(g.key, cyc * 7 + i) * 6.28, rr = L.r * (0.3 + 0.6 * hash(g.key, cyc * 13 + i));
      const bx = L.x + Math.cos(ang) * rr, bz = L.z + Math.sin(ang) * rr, dir = hash(g.key, cyc * 17) * 6.28;
      m.x = bx + Math.cos(dir) * (u - 0.5) * 1.6; m.z = bz - Math.sin(dir) * (u - 0.5) * 1.6; m.y = L.y - 0.2 + Math.sin(u * Math.PI) * 1.1;
      m.yaw = dir; m.pitch = (0.5 - u) * 2.2; m.mode = MODE.rest; m.rate = 1; return;
    }
  }
}

function update(dt, now) {
  if (!species.length || !app.terrain) return;
  if (level === 'off') { for (const pk of packs.values()) if (pk.skinned) { pk.skinned.begin(); pk.skinned.end(); } else { pk.mesh.count = 0; pk.mesh.visible = false; } return; }
  if (now - lastPlan > 500) { lastPlan = now; plan(now); }
  if (now - gqAt > 5000) { gqAt = now; GQ.clear(); }   // (and now and then anyway: a regrade lands a moment after its event)
  const t = app.net?.realNow ? app.net.realNow() % 100000 : now / 1000, cam = app.stage.camera.position;
  const P = app.player && app.player.active && app.player.ctx === -1 ? { x: app.player.x, z: app.player.z } : null;
  for (const pk of packs.values()) { pk.n = 0; pk.skinned?.begin(); }
  for (const [k, g] of groups) {
    const pk = packs.get(g.sp.id);
    if (!pk) { if (g.leaving != null && now - g.leaving > 1500) groups.delete(k); continue; }   // (its model hasn't arrived: not drawn yet)
    // (fading in from when it is first drawn: a group whose model arrived later doesn't pop in)
    if (g.shown == null) { g.shown = now; g.sk = !!pk.skinned; }
    const fade = g.leaving != null ? 1 - (now - g.leaving) / 1500 : Math.min(1, (now - g.shown) / 1500);
    if (g.leaving != null && fade <= 0) { groups.delete(k); continue; }
    // life under the sea is seen only close by: far-off schools and turtles aren't moved or drawn
    // (turtles that come up to breathe are seen further: at the surface)
    if ((g.sp.behaviour === 'school' || g.sp.behaviour === 'cruise') && Math.hypot(g.a.x - cam.x, g.a.z - cam.z) > (g.sp.breathe ? 320 : 170) + cam.y * 0.3) continue;
    g.members.forEach((m, i) => {
      m.hide = false; m.pitch = 0; m.roll = 0;
      pose(g, m, i, t, P);
      if (m.hide || pk.n >= pk.cap) return;
      const d = Math.hypot(m.x - cam.x, m.y - cam.y, m.z - cam.z); if (d > 700) return;
      const sc = g.sp.size * fade * (0.85 + 0.3 * m.r[3]);
      _q.setFromAxisAngle(_up, m.yaw); if (m.pitch) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), m.pitch));
      if (m.roll) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), m.roll));
      _m.compose(_p.set(m.x, m.y, m.z), _q, _s.set(sc, sc, sc));
      if (pk.skinned) {
        // its clip at the pace it really moves (speed / the clip's stride: a tail beat carries it one stride), else
        // the behaviour's own rate
        const sm = slotOf(pk, m.mode), clip = sm ? pk.clips[SLOT_CLIP[sm]] || pk.clips[sm === 2 ? 'run' : 'walk'] : null;
        // (a bird's wingbeat at its own pace, a little different for each: the clip's hz)
        const rate = clip?.hz ? clip.hz * (0.9 + 0.2 * m.r[2]) : clip?.stride ? Math.min(3.5, Math.max(0.15, g.sp.speed / (clip.stride * sc))) : (m.rate || 1);
        if (pk.skinned.put(_m, m.col, m.r[0] * 6.28, rate, sm, d)) pk.n++;
        return;
      }
      pk.mesh.setMatrixAt(pk.n, _m);
      pk.mesh.instanceColor.setXYZ(pk.n, pk.colors[m.col].r, pk.colors[m.col].g, pk.colors[m.col].b);
      pk.anim.setXYZW(pk.n, m.r[0] * 6.28, m.rate || 1, m.mode ?? 0, HIPS[g.sp.model] || 0);
      pk.n++;
    });
  }
  // the shared tier: each animal along its plan from the server ([x, z, x1, z1, t0, t1, mode, yaw, col])
  if (shared.off !== null) {
    const wt = now / 1000 + shared.off;
    for (const h of shared.herds.values()) {
      const pk = packs.get(h.sp.id); if (!pk) continue;   // (its model hasn't arrived: not drawn yet)
      h.shown ??= now;
      const fade = Math.min(1, (now - h.shown) / 1500);
      h.m.forEach((a, i) => {
        if (pk.n >= pk.cap || (level === 'fewer' && i % 2)) return;
        const u = a[5] > a[4] ? Math.min(1, Math.max(0, (wt - a[4]) / (a[5] - a[4]))) : 1, moving = a[6] && u < 1;
        const x = a[0] + (a[2] - a[0]) * u, z = a[1] + (a[3] - a[1]) * u;
        if (Math.hypot(x - cam.x, z - cam.z) > 700) return;
        const sc = h.sp.size * fade * (0.85 + 0.3 * h.r[i]);
        _q.setFromAxisAngle(_up, a[7]);
        let gy = ground(x, z);
        if (pk.span && Math.hypot(x - cam.x, z - cam.z) < 200) {
          // on a slope a modelled animal leans with the ground along its length (its fore and hind feet on the ground,
          // not one pair in the hill and the other in the air)
          const [xf, xh] = pk.span, cy = Math.cos(a[7]), sy = Math.sin(a[7]);
          const gf = ground(x + cy * xf * sc, z - sy * xf * sc), gh = ground(x + cy * xh * sc, z - sy * xh * sc);
          const pitch = Math.atan2(gf - gh, (xf - xh) * sc);
          if (Math.abs(pitch) < 0.5) { gy = gh + (gf - gh) * (-xh / (xf - xh)); _q.multiply(_qp.setFromAxisAngle(_side, pitch)); }
        }
        _m.compose(_p.set(x, gy, z), _q, _s.set(sc, sc, sc));
        if (pk.skinned) {
          // the gait's rate from the animal's own speed along its plan, so the hooves keep pace with the ground (the
          // clips' strides are made for the species' speeds: the rate stays near the gait's own beat, and the bounds
          // only catch odd plans); kept continuous, and a change of gait cross-faded (render/fauna-skinned.js motion)
          const mode = !moving ? 0 : a[6] === 2 ? 2 : 1, clip = pk.clips[mode === 2 ? 'run' : 'walk'];
          const speed = a[5] > a[4] ? Math.hypot(a[2] - a[0], a[3] - a[1]) / (a[5] - a[4]) : 0;
          const rate = mode === 2 ? Math.min(4.2, Math.max(1.4, speed / (clip.stride * sc))) : Math.min(2.0, Math.max(0.4, speed / (clip.stride * sc)));
          const st = motion(h.st[i] ||= {}, mode, rate, GU.uTime.value, h.r[i]);
          if (pk.skinned.put(_m, a[8], st.off, st.rate, st.mode, Math.hypot(x - cam.x, z - cam.z), st.prev, true)) pk.n++;
          return;
        }
        pk.mesh.setMatrixAt(pk.n, _m);
        const c = pk.colors[a[8] % pk.colors.length]; pk.mesh.instanceColor.setXYZ(pk.n, c.r, c.g, c.b);
        const mode = !moving ? MODE.rest : a[6] === 2 ? (h.sp.model === 'rabbit' ? MODE.hop : MODE.run) : (h.sp.model === 'rabbit' ? MODE.hop : MODE.walk);
        pk.anim.setXYZW(pk.n, h.r[i] * 6.28, mode === MODE.run ? 2.2 : mode === MODE.hop ? 2.4 : 1.1, mode, HIPS[h.sp.model] || 0);
        pk.n++;
      });
    }
  }
  for (const pk of packs.values()) {
    if (pk.skinned) { pk.skinned.end(); continue; }
    pk.mesh.count = pk.n; pk.mesh.visible = pk.n > 0;   // (an empty draw left out of the frame: render/fauna-skinned.js end)
    if (pk.n) { pk.mesh.instanceMatrix.needsUpdate = true; pk.mesh.instanceColor.needsUpdate = true; pk.anim.needsUpdate = true; }
  }
}
