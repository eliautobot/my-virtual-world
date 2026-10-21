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
import { MODELS, faunaMaterial } from './fauna-models.js';

const RANGE = { low: 260, medium: 420, high: 600 };   // m around the camera's target
const CAP = { firefly: 420, butterfly: 200, songbird: 220, 'reef-fish': 360 };
const HIPS = { deer: 0.8, rabbit: 0.3, cow: 0.68, sheep: 0.42, horse: 0.98, crab: 0.3, dolphin: -1 };   // (dolphin −1: its flukes beat up and down, render/fauna-models.js)
const MODE = { rest: 0, walk: 1, run: 2, fly: 3, glide: 4, swim: 5, hop: 6, glow: 7 };
let app = null, species = [], packs = new Map(), groups = new Map(), lastPlan = 0, seed = 'world';
const shared = { herds: new Map(), off: null, seen: 0 };   // herds from the server and its wildlife clock's offset
let level = localStorage.getItem('mvw.wildlife') || 'normal';   // Display → Wildlife: off, fewer, normal
bus.on('display', k => { if (k === 'wildlife') { level = localStorage.getItem('mvw.wildlife') || 'normal'; groups.clear(); } });
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

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
    const idx = await (await fetch('/shared/world-config/species/index.json')).json();
    for (const id of idx.species) {
      const sp = await (await fetch(`/shared/world-config/species/${id}.json`)).json(), why = validateSpecies(sp);
      if (why.length) { console.warn(`[wildlife] ${id}: ${why.join('; ')}`); continue; }
      all.push(sp);
      if (sp.tier === 'ambient') species.push(sp);
    }
  } catch (e) { console.warn('[wildlife] the species catalogue could not load:', e.message); return; }
  for (const sp of all) {
    const cap = CAP[sp.id] || 160, geo = MODELS[sp.model]().clone();
    geo.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    // (what swims below the sea is seen through its water, with the full sea: render/water.js underwater)
    const swims = ['reeffish', 'turtle', 'fish', 'otter', 'alligator', 'beaver', 'dolphin'].includes(sp.model), T = app.terrain;
    const mesh = new THREE.InstancedMesh(geo, swims && T?.uw ? T.uw(faunaMaterial(sp.model)) : faunaMaterial(sp.model), cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = sp.model === 'deer'; mesh.userData.smallCaster = true; mesh.name = `wildlife-${sp.id}`;
    app.stage.scene.add(mesh);
    packs.set(sp.id, { sp, mesh, cap, anim: geo.attributes.aAnim, colors: sp.colors.map(c => new THREE.Color(c)) });
  }
  // every species' shader compiled now (in the background where the browser can), not in the frame it first appears
  app.stage.renderer.compileAsync?.(app.stage.scene, app.stage.camera).catch(() => {});
  app.wildlife = { get count() { let n = 0; for (const P of packs.values()) n += P.mesh.count; return n; }, groups, species, shared, plan: () => plan(performance.now()) };
  bus.on('frame', update);
  for (const ev of ['terrain', 'roads', 'world']) bus.on(ev, () => GQ.clear());   // (the ground changed: reshaped, roads, building pads)
  bus.on('msg:fauna', m => {
    const now = performance.now() / 1000;
    shared.off = m.wt - now; shared.seen = now;
    const keep = new Set();
    for (const h of m.herds || []) {
      const pk = packs.get(h.s); if (!pk) continue;
      keep.add(h.id);
      const was = shared.herds.get(h.id);
      shared.herds.set(h.id, { id: h.id, sp: pk.sp, m: h.m, born: was ? was.born : performance.now(), r: h.m.map((_, i) => hash(h.id, i)) });
    }
    for (const id of [...shared.herds.keys()]) if (!keep.has(id)) shared.herds.delete(id);
  });
}

// ------------------------------------------------------------------ where groups live
/** The groups that belong around the camera now: from loaded tiles' habitats and nearby lakes. */
function plan(now) {
  const T = app.terrain; if (!T) return;
  const ct = app.cam.target, R = RANGE[app.stage.q.name] || 420, hour = S.hour, kind = app.weather?.now?.kind || 'clear';
  const want = new Map();
  const consider = (key, sp, anchors, areaKm2) => {
    if (!anchors.length) return;
    const exp = sp.perKm2 * areaKm2, n = Math.floor(exp) + (hash(key, 1) < exp % 1 ? 1 : 0);
    for (let k = 0; k < Math.min(n, level === 'fewer' ? 1 : 3); k++) {
      const a = anchors[Math.floor(hash(key, 10 + k) * anchors.length)];
      want.set(`${key}:${k}`, { sp, a, key: `${key}:${k}` });
    }
  };
  for (const t of T.tiles.values()) {
    if (!t.hab || t.level !== 0 || !T.shown.has(t.key)) continue;
    const cx = t.x0 + t.S / 2, cz = t.z0 + t.S / 2;
    if (Math.hypot(cx - ct.x, cz - ct.z) > R) continue;
    for (const sp of species) {
      if (!activeAt(sp, hour) || !sp.weather.includes(kind) || sp.habitats.includes('lake') || sp.habitats.includes('river')) continue;
      const pts = []; let frac = 0;
      for (const h of sp.habitats) { const L = t.hab[h]; if (!L) continue; frac += L.length / 3; for (let i = 0; i < L.length; i += 3) pts.push({ x: L[i], y: L[i + 1], z: L[i + 2] }); }
      consider(`${seed}:${t.key}:${sp.id}`, sp, pts, (t.S * t.S / 1e6) * Math.min(1, frac / 24));
    }
  }
  for (const L of T.lakes || []) {
    if (L.userData.frozen || L.userData.lake?.pool) continue;   // (a frozen tarn, a waterfall's churning pool: no ducks)
    const r = L.userData.r || L.geometry.parameters?.radius || 60, lx = L.position.x, lz = L.position.z;
    if (Math.hypot(lx - ct.x, lz - ct.z) > R + r) continue;
    for (const sp of species) {
      if (!sp.habitats.includes('lake') || !activeAt(sp, hour) || !sp.weather.includes(kind)) continue;
      const anchors = []; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; anchors.push({ x: lx + Math.cos(a) * r * 0.62, y: L.position.y, z: lz + Math.sin(a) * r * 0.62, lake: { x: lx, z: lz, r: r * 0.8, y: L.position.y } }); }
      consider(`${seed}:lake${Math.round(lx)},${Math.round(lz)}:${sp.id}`, sp, anchors, Math.PI * r * r / 1e6);
    }
  }
  // rivers (otters, beavers): their slow, wide stretches (every RIVER_STRETCH m of course, no rapids or falls), each a
  // place a group swims up and down
  const I = T.ground?.island, rsp = species.filter(sp => sp.habitats.includes('river') && activeAt(sp, hour) && sp.weather.includes(kind));
  if (I?.rivers && rsp.length) for (const Rv of I.rivers) for (const st of riverStretches(Rv)) {
    if (Math.hypot(st.x - ct.x, st.z - ct.z) > R + RIVER_STRETCH) continue;
    for (const sp of rsp) consider(`${seed}:${Rv.id}:${st.j}:${sp.id}`, sp, [st], RIVER_STRETCH * st.w / 1e6);
  }
  // keep the groups still wanted, start new ones, let the others fade out
  for (const [k, g] of groups) if (!want.has(k)) g.leaving = g.leaving ?? now;
  for (const [k, w] of want) {
    const g = groups.get(k);
    if (g) { g.leaving = null; continue; }
    const sp = w.sp, n = sp.group[0] + Math.floor(hash(k, 3) * (sp.group[1] - sp.group[0] + 1));
    groups.set(k, { sp, a: w.a, key: k, born: now, leaving: null, flee: null, members: Array.from({ length: n }, (_, i) => ({ r: [hash(k, 100 + i), hash(k, 200 + i), hash(k, 300 + i), hash(k, 400 + i)], col: Math.floor(hash(k, 500 + i) * sp.colors.length), x: w.a.x, y: w.a.y, z: w.a.z, yaw: 0 })) });
  }
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
      if (landed) { m.x = a.x + (r[1] - 0.5) * 10; m.z = a.z + (r[3] - 0.5) * 10; m.y = ground(m.x, m.z) + 0.02; m.mode = MODE.rest; m.rate = 1; m.yaw = r[0] * 6.28 + Math.sin(t * 0.5 + r[2] * 9) * 0.6; return; }
      m.x = gx; m.z = gz; m.y = gy + H[0] + (H[1] - H[0]) * (0.5 + 0.5 * Math.sin(t * 0.3 + r[0] * 6)) ;
      m.yaw = Math.atan2(-(Math.cos(t * w * 1.7) * w * 1.7 * R * 0.7), Math.cos(t * w + 1.3) * w * R);
      m.mode = Math.sin(t * 0.7 + r[1] * 6.28) > 0.55 ? MODE.glide : MODE.fly; m.rate = 2.6 + r[2]; return;
    }
    case 'circle': case 'soar': {
      const R = (sp.behaviour === 'soar' ? 90 : 30) + r[0] * (sp.behaviour === 'soar' ? 70 : 40), w = sp.speed / R * (r[1] > 0.5 ? 1 : -1), ang = t * w + r[2] * 6.28;
      m.x = a.x + Math.cos(ang) * R; m.z = a.z + Math.sin(ang) * R;
      m.y = Math.max(ground(m.x, m.z), app.terrain?.params.seaLevel ?? 0) + H[0] + (H[1] - H[0]) * (0.5 + 0.5 * Math.sin(t * 0.13 + r[3] * 6));
      m.yaw = Math.atan2(-(Math.cos(ang) * w), -Math.sin(ang) * w);
      m.mode = Math.sin(t * 0.4 + r[0] * 9) > (sp.behaviour === 'soar' ? 0.85 : 0.5) ? MODE.fly : MODE.glide; m.rate = sp.behaviour === 'soar' ? 1.4 : 2.2; return;
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
      m.y = floor + 0.35 + (top - floor - 0.35) * (0.2 + 0.25 * (0.5 + 0.5 * Math.sin(t * 0.05 + r[3] * 6)));
      m.yaw = Math.atan2(-(Math.cos(ang) * 0.8 * w), -Math.sin(ang) * w); m.mode = MODE.glide; m.rate = 1.6; return;   // (glide: the flippers stroke gently)
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
  if (level === 'off') { for (const pk of packs.values()) pk.mesh.count = 0; return; }
  if (now - lastPlan > 500) { lastPlan = now; plan(now); }
  if (now - gqAt > 5000) { gqAt = now; GQ.clear(); }   // (and now and then anyway: a regrade lands a moment after its event)
  const t = app.net?.realNow ? app.net.realNow() % 100000 : now / 1000, cam = app.stage.camera.position;
  const P = app.player && app.player.active && app.player.ctx === -1 ? { x: app.player.x, z: app.player.z } : null;
  for (const pk of packs.values()) pk.n = 0;
  for (const [k, g] of groups) {
    const fade = g.leaving != null ? 1 - (now - g.leaving) / 1500 : Math.min(1, (now - g.born) / 1500);
    if (g.leaving != null && fade <= 0) { groups.delete(k); continue; }
    const pk = packs.get(g.sp.id);
    // life under the sea is seen only close by: far-off schools and turtles aren't moved or drawn
    if ((g.sp.behaviour === 'school' || g.sp.behaviour === 'cruise') && Math.hypot(g.a.x - cam.x, g.a.z - cam.z) > 170 + cam.y * 0.3) continue;
    g.members.forEach((m, i) => {
      m.hide = false; m.pitch = 0;
      pose(g, m, i, t, P);
      if (m.hide || pk.n >= pk.cap) return;
      const d = Math.hypot(m.x - cam.x, m.y - cam.y, m.z - cam.z); if (d > 700) return;
      const sc = g.sp.size * fade * (0.85 + 0.3 * m.r[3]);
      _q.setFromAxisAngle(_up, m.yaw); if (m.pitch) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), m.pitch));
      _m.compose(_p.set(m.x, m.y, m.z), _q, _s.set(sc, sc, sc));
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
      const pk = packs.get(h.sp.id), fade = Math.min(1, (now - h.born) / 1500);
      h.m.forEach((a, i) => {
        if (pk.n >= pk.cap || (level === 'fewer' && i % 2)) return;
        const u = a[5] > a[4] ? Math.min(1, Math.max(0, (wt - a[4]) / (a[5] - a[4]))) : 1, moving = a[6] && u < 1;
        const x = a[0] + (a[2] - a[0]) * u, z = a[1] + (a[3] - a[1]) * u;
        if (Math.hypot(x - cam.x, z - cam.z) > 700) return;
        const sc = h.sp.size * fade * (0.85 + 0.3 * h.r[i]);
        _q.setFromAxisAngle(_up, a[7]);
        _m.compose(_p.set(x, ground(x, z), z), _q, _s.set(sc, sc, sc));
        pk.mesh.setMatrixAt(pk.n, _m);
        const c = pk.colors[a[8] % pk.colors.length]; pk.mesh.instanceColor.setXYZ(pk.n, c.r, c.g, c.b);
        const mode = !moving ? MODE.rest : a[6] === 2 ? (h.sp.model === 'rabbit' ? MODE.hop : MODE.run) : (h.sp.model === 'rabbit' ? MODE.hop : MODE.walk);
        pk.anim.setXYZW(pk.n, h.r[i] * 6.28, mode === MODE.run ? 2.2 : mode === MODE.hop ? 2.4 : 1.1, mode, HIPS[h.sp.model] || 0);
        pk.n++;
      });
    }
  }
  for (const pk of packs.values()) {
    pk.mesh.count = pk.n;
    if (pk.n) { pk.mesh.instanceMatrix.needsUpdate = true; pk.mesh.instanceColor.needsUpdate = true; pk.anim.needsUpdate = true; }
  }
}
