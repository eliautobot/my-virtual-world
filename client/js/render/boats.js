// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Boats on the water (WP4.18, wp4-world-spec.md §6.5 ambient life): sailing dinghies tacking round the lakes and motor
// launches cruising off the growth coasts (the harbours) of the main island and the islands of the chain. Decoration
// only, the same on every screen: each boat goes round its own loop on the shared clock. Loops are checked to stay on
// open water when the land changes. Display → Traffic switches them off with the traffic.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { dinghy, launch } from './vessels.js';
import { makeFurnMat } from './mats.js';
import { coastline, coastClasses, SECTORS, isleCoastline, isleClasses, ISLE_SECTORS } from '/shared/coasts.js';
import { waterFor } from '/shared/ferries.js';

const MAX = 48, FAR = 3500;
let app = null, sails = null, launches = null, loops = [], dirty = true;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

export function init(a) {
  app = a;
  const mat = makeFurnMat({ lit: true }), group = new THREE.Group(); group.name = 'boats'; a.stage.scene.add(group);
  sails = new THREE.InstancedMesh(dinghy(), mat, MAX); launches = new THREE.InstancedMesh(launch(), mat, MAX);
  for (const im of [sails, launches]) { im.count = 0; im.frustumCulled = false; im.castShadow = true; group.add(im); }
  for (const ev of ['terrain', 'roads']) bus.on(ev, () => { dirty = true; });
  bus.on('frame', update);
  app.boats = { get loops() { return loops; } };
}
// ------------------------------------------------------------------ where they go
/** A loop of radius r round (cx, cz) that stays on water at least `depth` m deep (shrunk until it does), or null. */
function loopOn(island, cx, cz, r, depth) {
  for (let rr = r; rr >= 25; rr *= 0.8) {
    let ok = true;
    for (let k = 0; k < 24 && ok; k++) { const a = k / 24 * Math.PI * 2, w = waterFor(island, cx + Math.cos(a) * rr, cz + Math.sin(a) * rr * 0.7); ok = !!w && w.depth >= depth; }
    if (ok) return rr;
  }
  return 0;
}
const h = s => { let x = 2166136261; for (const c of String(s)) x = Math.imul(x ^ c.charCodeAt(0), 16777619); return (x >>> 0) / 4294967296; };
function build() {
  dirty = false; loops = [];
  const island = app.terrain?.ground?.island; if (!island) return;
  const T = S.world.terrain, sea = island.p.seaLevel;
  for (const L of island.lakes) {   // sailing dinghies on the lakes
    if (L.r < 45 || L.tarn) continue;   // (no boats on the mountain tarns)
    const r = loopOn(island, L.x, L.z, L.r * 0.5, 1); if (!r) continue;
    const n = L.r > 160 ? 3 : L.r > 90 ? 2 : 1;
    for (let k = 0; k < n && loops.length < MAX; k++) loops.push({ kind: 0, x: L.x, z: L.z, r: r * (1 - k * 0.18), level: L.level, speed: 2.2, phase: h(`${L.id}:${k}`) * 6.283, dir: k % 2 ? -1 : 1 });
  }
  // launches off the growth coasts (the harbours): one per stretch, every other stretch
  const harbour = (C, cls, n, key) => {
    for (let k = 0; k < n; k += 2) {
      if (cls[k] !== 'g' || loops.length >= MAX * 2) continue;
      const p = C[k], cx = p.x + p.nx * 320, cz = p.z + p.nz * 320, r = loopOn(island, cx, cz, 140, 3); if (!r) continue;
      loops.push({ kind: 1, x: cx, z: cz, r, level: sea, speed: 6, phase: h(`${key}:${k}`) * 6.283, dir: k % 4 ? -1 : 1 });
    }
  };
  harbour(coastline(island), coastClasses(T), SECTORS, 'main');
  for (const I of island._chain || []) harbour(isleCoastline(I), isleClasses(I, T), ISLE_SECTORS, I.id);
}
function update() {
  if (!S.world?.terrain) return;
  if (dirty) { if (!app.terrain?.ground) return; build(); }
  const off = localStorage.getItem('mvw.traffic') === 'off', t = S.simT ?? 0, cam = app.stage.camera.position;
  let ns = 0, nl = 0;
  if (!off) for (const B of loops) {
    const w = B.speed / B.r, a = B.phase + B.dir * t * w, x = B.x + Math.cos(a) * B.r, z = B.z + Math.sin(a) * B.r * 0.7;
    if (Math.hypot(x - cam.x, z - cam.z) > FAR) continue;
    const dx = -Math.sin(a) * B.dir, dz = Math.cos(a) * 0.7 * B.dir, yaw = Math.atan2(dx, dz);
    const heel = B.kind === 0 ? 0.12 * B.dir : 0, bob = Math.sin(t * 1.3 + B.phase) * 0.08;
    _q.setFromEuler(_e.set(Math.sin(t * 0.9 + B.phase) * 0.02, yaw, heel + Math.sin(t * 0.7 + B.phase) * 0.02));
    _m.compose(_p.set(x, B.level - 0.04 + bob, z), _q, _s);   // the hull's waterline at the water (render/vessels.js)
    if (B.kind === 0 && ns < MAX) sails.setMatrixAt(ns++, _m); else if (B.kind === 1 && nl < MAX) launches.setMatrixAt(nl++, _m);
  }
  sails.count = ns; launches.count = nl;
  sails.instanceMatrix.needsUpdate = true; launches.instanceMatrix.needsUpdate = true;
}
