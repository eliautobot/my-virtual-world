// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Edit dock → World modules (docs/features/play-modules.md §Placing modules): administrators place the big play modules
// that take up world space — an airport, the fishing docks (a marina, a lake dock: point at the shore and the ghost turns
// its water side to the water). Pick one, move the ghost over open land beyond the city (green: it fits;
// red: why not — the same rules the server checks), turn it with R (Shift+R the other way), click to place it: the
// airport and a road from its car park to the nearest road (square out of its entrance, round to the road) go in
// together, as one edit that can be undone. Placed modules are listed with Go to, Move (its old road goes, a new one
// comes), Road (its access road laid again), Rename and Remove. (Interior modules — a kitchen, an arcade — are bought by
// players for their own buildings from the Buildings section.)
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { h, esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { post } from '../core/net.js';
import { WORLD_KINDS, normalizeWorldModule, checkWorldModule, padOf, rectCorners, modulesOf, accessRoadPath, accessRoadsOf, placeLevel } from '/shared/world-modules.js';
import { rectAt, RUNWAY, STRUCTURES } from '/shared/airport-layout.js';
import { DOCKS, fitToShore, rampOf } from '/shared/dock-layout.js';
import { protectedWhy } from '/shared/coasts.js';
import { RoadNetwork } from '/shared/roads.js';

const T = { kind: null, moving: null, rot: 0, at: null, why: '', checkedAt: 0, busy: false };
let app = null, E = {}, ghost = null, ptr = { x: 0, y: 0, moved: false };
const can = () => !!auth.account && auth.can('world.edit') && !!S.world?.terrain;
const um = v => Math.round(v * 1e6);
const STEP = Math.PI / 12;   // R turns it 15°

export function init(a) {
  app = a;
  const slot = a.docks && a.docks.slot('l:wmods');
  if (!slot) return;
  slot.appendChild(h(`<div class="wmods">
    <p class="hint">Big play modules that take up world space. Only administrators place them; players find them in the world and play them. Each is joined to the nearest road.</p>
    <div class="wm-kinds"></div>
    <div class="row wm-place hidden"><button type="button" class="btn sm wm-l" title="Turn left (Shift+R)">⟲</button> <button type="button" class="btn sm wm-r" title="Turn right (R)">⟳</button> <button type="button" class="btn sm wm-x">✕ Cancel</button></div>
    <p class="hint wm-stat"></p>
    <h5 class="wm-h hidden">Placed</h5><div class="wm-list"></div></div>`));
  const q = s => slot.querySelector(s);
  E = { kinds: q('.wm-kinds'), place: q('.wm-place'), stat: q('.wm-stat'), list: q('.wm-list'), head: q('.wm-h') };
  E.kinds.innerHTML = Object.values(WORLD_KINDS).map(K => `<div class="wm-card"><div><b>${K.icon} ${esc(K.label)}</b> <span class="dim">${esc(K.size)}</span></div>
    <p class="hint">${esc(K.blurb)}</p><button type="button" class="btn primary sm" data-kind="${K.kind}">Place ${esc(K.label.toLowerCase())}</button></div>`).join('');
  E.kinds.onclick = e => { const b = e.target.closest('[data-kind]'); if (b) start(b.dataset.kind); };
  q('.wm-l').onclick = () => turn(-1); q('.wm-r').onclick = () => turn(1); q('.wm-x').onclick = () => stop('');
  E.list.onclick = onList;
  ghost = new THREE.Group(); ghost.name = 'wmod-ghost'; a.stage.scene.add(ghost);
  app.hooks.click.unshift(onClick); app.hooks.key.unshift(onKey); app.hooks.hover.unshift(() => !!T.kind);
  a.stage.renderer.domElement.addEventListener('pointermove', e => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.moved = true; });
  bus.on('wmods', list); bus.on('mode', m => { if (m === 'play' || m === 'furnish') stop(''); });
  bus.on('frame', frame);
  list();
}
function say(t, bad = false) { E.stat.textContent = t; E.stat.classList.toggle('bad', bad); }
function list() {
  const L = modulesOf(S.world);
  E.head.classList.toggle('hidden', !L.length);
  E.list.innerHTML = L.map(m => `<div class="ditem" data-m="${esc(m.id)}">${WORLD_KINDS[m.kind]?.icon || '🌍'} ${esc(m.name)}
    <span class="row"><button type="button" class="btn sm" data-go="1">👁 Go to</button>${can() ? ' <button type="button" class="btn sm" data-move="1">✥ Move</button> <button type="button" class="btn sm" data-road="1" title="Lay its access road again: square out of its entrance, round to the nearest road">🛣 Road</button> <button type="button" class="btn sm" data-rename="1">✏️ Rename</button> <button type="button" class="btn sm danger" data-del="1">Remove</button>' : ''}</span></div>`).join('');
}
async function onList(e) {
  const b = e.target.closest('button'), row = e.target.closest('[data-m]'); if (!b || !row) return;
  const m = modulesOf(S.world).find(x => x.id === row.dataset.m); if (!m) return;
  if (b.dataset.go) { app.cam?.flyTo?.(m.x, m.y, m.z, 900); return; }
  if (b.dataset.move) { start(m.kind, m); return; }
  try {
    if (b.dataset.road) {
      if (!app.terrain?.roadNet) return;
      const { ops, pts } = roadOps(m, m);
      if (!pts) { say('A road is already right at its entrance.'); return; }
      await post('/api/edit', { ops, atomic: true }); say(`Its access road was laid again (${Math.round(roadLength(pts))} m). You can undo it.`);
    } else if (b.dataset.rename) { const name = prompt('Name', m.name); if (name && name.trim() !== m.name) await post('/api/edit', { ops: [{ op: 'wmod.set', id: m.id, name: name.trim() }] }); }
    else if (b.dataset.del && confirm(`Remove ${m.name}? Its ${DOCKS[m.kind] ? 'boats and store go' : 'aircraft go'} with it. You can undo it.`)) await post('/api/edit', { ops: [{ op: 'wmod.del', id: m.id }] });
  } catch (err) { say(err.message, true); }
}
// ------------------------------------------------------------------ placing
function start(kind, moving = null) {
  if (!can()) { say('Only administrators place world modules, on land beyond the city.', true); return; }
  if (S.mode === 'play' || S.mode === 'furnish') app.setMode('explore');
  T.kind = kind; T.moving = moving; T.rot = moving ? moving.rot : T.rot; T.at = null; T.why = ''; T.manual = false;
  E.place.classList.remove('hidden');
  say(DOCKS[kind]
    ? `Point at the shore of ${DOCKS[kind].water === 'sea' ? 'the sea' : 'a lake'}: it turns its piers out over the water and its quay to the water's edge. R turns it yourself (Shift+R the other way); click to ${moving ? 'move it there' : 'place it'}; Esc stops. A road is built from its car park to the nearest road.`
    : `Move over open, flat land beyond the city. R turns it (Shift+R the other way); click to ${moving ? 'move it there' : 'place it'}; Esc stops. A road is built from its car park to the nearest road.`);
}
function stop(text) { T.kind = null; T.moving = null; T.at = null; clear(); E.place.classList.add('hidden'); if (text !== undefined) say(text); }
function turn(d) { T.rot = (T.rot + d * STEP + 2 * Math.PI) % (2 * Math.PI); T.manual = true; T.checkedAt = 0; draw(true); }
function env() {
  const t = app.terrain;
  return { heightAt: (x, z) => t.pointHeight(x, z), isWater: (x, z) => t.isWater(x, z), waterAt: (x, z) => t.ground?.water(x, z) || null,
    coastWhy: (x, z) => (t.ground ? protectedWhy(t.ground.island, x, z, 0) : null), roads: t.roadNet };
}
function draft() { return T.at ? normalizeWorldModule({ kind: T.kind, x: T.at.x, z: T.at.z, rot: T.rot }) : null; }
function groundAt(cx, cy) { const p = app.terrain?.rayHit(app.cam.rayAt(cx, cy)); return p ? { x: p.x, z: p.z } : null; }
function clear() { for (const m of [...ghost.children]) { ghost.remove(m); m.geometry.dispose(); m.material.dispose(); } }
/** The access road: square out of the module's entrance, round to the nearest road, long enough to climb from its land
 *  to that road (shared/world-modules.js accessRoadPath): its points, or null when a road is right there. */
function accessRoad(m, old = null) {
  const gone = old ? new Set(accessRoadsOf(S.world, old).map(r => r.id)) : null;   // (moving it: not to its old road, which goes)
  const net = gone?.size ? RoadNetwork.fromJSON((S.world.roads || []).filter(r => !gone.has(r.id))) : app.terrain?.roadNet;
  const E = env(), level = Number.isFinite(m.y) && !T.kind ? m.y : placeLevel(m, E);
  return accessRoadPath(m, net, { heightAt: E.heightAt, level });
}
const roadLength = pts => pts.reduce((L, p, k) => (k ? L + Math.hypot(p.x - pts[k - 1].x, p.z - pts[k - 1].z) : 0), 0);
/** The edit that lays a module's access road: the old one(s) out (moving it, laying it again), the new one in. */
function roadOps(m, old) {
  const pts = accessRoad(m, old), ops = (old ? accessRoadsOf(S.world, old) : []).map(r => ({ op: 'road.del', id: r.id }));
  if (pts) ops.push({ op: 'road.set', road: { profile: 'country', name: `${WORLD_KINDS[m.kind].label} Road`, pts: pts.map(p => (p.r ? { x: um(p.x), z: um(p.z), r: um(p.r) } : { x: um(p.x), z: um(p.z) })) } });
  return { ops, pts };
}
function draw(check) {
  clear();
  const m = draft(); if (!m || m instanceof Error || !app.terrain?.ground) return;
  if (check) { T.why = checkWorldModule(S.world, m, env(), { ignoreId: T.moving?.id || null }) || ''; T.checkedAt = performance.now(); }
  const col = T.why ? 0xf87171 : 0x4ade80, y = app.terrain.pointHeight(m.x, m.z) + 1.5;
  const loop = pts => { const g = new THREE.BufferGeometry().setFromPoints([...pts, pts[0]].map(p => new THREE.Vector3(p.x, y, p.z))); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, depthTest: false })); l.renderOrder = 6; ghost.add(l); };
  const fill = (r, c, o) => { const g = new THREE.PlaneGeometry(r.hw * 2, r.hd * 2); g.rotateX(-Math.PI / 2); const me = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false })); me.position.set(r.x, y, r.z); me.rotation.y = r.rot; me.renderOrder = 5; ghost.add(me); };
  const pad = padOf(m);
  fill(pad, col, 0.12); loop(rectCorners(pad));
  if (DOCKS[m.kind]) {   // a dock: its land, the ramp, the piers and floats, the store
    const K = DOCKS[m.kind], L = K.land, R = rampOf({ ...m, y: (m.wy ?? -2.4) + K.above[0] });
    fill(rectAt(m, L.s0, L.f0, L.s1, L.f1), 0xb9b4aa, 0.5); fill(rectAt(m, R.s0, R.f0, R.s1, R.f1), 0x8e8981, 0.7);
    for (const d of K.decks) fill(rectAt(m, d.s0, d.f0, d.s1, d.f1), d.kind === 'float' || d.kind === 'finger' ? 0xdfe3e6 : 0x8a6a4b, 0.85);
    fill(rectAt(m, K.store.s0, K.store.f0, K.store.s1, K.store.f1), 0xdddddd, 0.7);
  } else {
    fill(rectAt(m, -RUNWAY.w / 2, -RUNWAY.len / 2, RUNWAY.w / 2, RUNWAY.len / 2), 0x30343a, 0.75);
    for (const B of STRUCTURES) fill(rectAt(m, B.s0, B.f0, B.s1, B.f1), 0xdddddd, 0.6);
  }
  const road = accessRoad(m, T.moving);
  if (road) { const g = new THREE.BufferGeometry().setFromPoints(road.map((p, k) => new THREE.Vector3(p.x, k ? app.terrain.pointHeight(p.x, p.z) + 1.5 : y, p.z))); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false })); l.renderOrder = 6; ghost.add(l); }
  say(T.why ? `⚠️ ${T.why}` : `It fits.${road ? ` A ${Math.round(roadLength(road))} m road (yellow) joins it to the nearest road.` : ''} Click to ${T.moving ? 'move it here' : 'place it'}.`, !!T.why);
}
function frame() {
  if (!T.kind || !ptr.moved) return;
  ptr.moved = false;
  T.at = groundAt(ptr.x, ptr.y);
  if (T.at && DOCKS[T.kind] && !T.manual) {   // a dock squares itself to the shore it is pointed at
    const fit = fitToShore(T.kind, T.at.x, T.at.z, env());
    if (fit) { T.at = { x: fit.x, z: fit.z }; T.rot = fit.rot; }
  }
  draw(performance.now() - T.checkedAt > 200);   // the full check at most five times a second
}
async function place() {
  if (T.busy) return;
  const m = draft(); if (!m || m instanceof Error) return;
  const why = checkWorldModule(S.world, m, env(), { ignoreId: T.moving?.id || null });
  if (why) { say(`⚠️ ${why}`, true); return; }
  // moving it: its old access road goes first (else it would cross where it now stands), then the module, then the new road
  const { ops: rops, pts: road } = roadOps(m, T.moving), dels = rops.filter(o => o.op === 'road.del'), adds = rops.filter(o => o.op !== 'road.del');
  const ops = [...dels, T.moving ? { op: 'wmod.set', id: T.moving.id, x: m.x, z: m.z, rot: m.rot } : { op: 'wmod.add', module: m }, ...adds];
  T.busy = true; say(T.moving ? 'Moving…' : 'Placing…');
  try {
    const r = await post('/api/edit', { ops, atomic: true });
    stop(T.moving ? 'Moved.' : `${r?.results?.[0]?.name || 'It'} is open.`);
  } catch (e) { say(`⚠️ ${e.message}${road ? ' (the access road and the module go in together — turn or move it)' : ''}`, true); }
  finally { T.busy = false; }
}
function onClick(e) {
  if (!T.kind || S.mode === 'play') return false;
  const p = groundAt(e.clientX, e.clientY);
  if (p) { T.at = p; if (DOCKS[T.kind] && !T.manual) { const fit = fitToShore(T.kind, p.x, p.z, env()); if (fit) { T.at = { x: fit.x, z: fit.z }; T.rot = fit.rot; } } draw(true); place(); }
  return true;
}
function onKey(e) {
  if (!T.kind) return false;
  if (e.key === 'Escape') { stop(''); return true; }
  if (e.key === 'r' || e.key === 'R') { turn(e.shiftKey ? -1 : 1); return true; }
  return false;
}
