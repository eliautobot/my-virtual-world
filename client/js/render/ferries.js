// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Ferries in the browser (WP4.15, shared/ferries.js): a pier from the shore to each dock with a shelter at its end, and
// the boats — one instanced mesh for every boat in the world — sailing on the shared timetable (the simulation clock),
// so every screen shows the same boat at the same dock, and residents waiting on the pier vanish aboard as it leaves.
// The boats rock gently with the water; far ones (beyond FAR m) are not drawn.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { FB } from './furniture.js';
import { ferry } from './vessels.js';
import { makeFurnMat } from './mats.js';
import { boatAt, docksOf } from '/shared/ferries.js';

const FAR = 4500, MAX_BOATS = 96;
let app = null, group = null, piers = null, boats = null, lines = [], dirty = true, mat = null;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _b = {};

export function init(a) {
  app = a;
  group = new THREE.Group(); group.name = 'ferries'; a.stage.scene.add(group);
  mat = makeFurnMat({ lit: true });
  boats = new THREE.InstancedMesh(boatModel(), mat, MAX_BOATS); boats.castShadow = true; boats.frustumCulled = false; boats.count = 0;
  group.add(boats);
  bus.on('ferries', () => { dirty = true; });
  bus.on('terrain', () => { dirty = true; });
  bus.on('roads', () => { dirty = true; });
  bus.on('frame', update);
  app.ferries = { get lines() { return lines; }, boatAt };
}
// ------------------------------------------------------------------ models (nose along +z)
function boatModel() { return ferry(); }   // render/vessels.js
/** Every line's piers (deck, pilings, rails) and a shelter at each dock: one mesh. */
function pierModel(list) {
  const f = new FB();
  for (const L of list) for (const D of L.docks) {
    if (!D.land) continue;
    const dx = D.dock.x - D.land.x, dz = D.dock.z - D.land.z, len = Math.hypot(dx, dz) + 6, yaw = Math.atan2(dx, dz);
    const y0 = D.deck;
    f.push(D.land.x, 0, D.land.z, yaw);
    f.col('#8a6a48'); f.box(-2, y0 - 0.35, -1, 2, y0, len);                       // deck
    f.col('#5b4330');
    for (let s = 2; s < len; s += 6) for (const x of [-1.8, 1.8]) f.box(x - 0.18, D.level - 4, s - 0.18, x + 0.18, y0 - 0.35, s + 0.18);   // pilings
    for (const x of [-2, 2]) f.box(x - 0.06, y0, -1, x + 0.06, y0 + 1, len);      // rails
    f.col('#e9e5dc'); f.box(-3, y0, len - 5, 3, y0 + 0.15, len + 3);                // the dock's landing stage
    f.col('#1d4e89'); f.box(-2.6, y0 + 2.6, len - 4, 2.6, y0 + 2.85, len + 0.5);    // shelter roof
    f.col('#5b4330'); for (const [x, z] of [[-2.4, len - 3.8], [2.4, len - 3.8], [-2.4, len + 0.3], [2.4, len + 0.3]]) f.box(x - 0.08, y0, z - 0.08, x + 0.08, y0 + 2.6, z + 0.08);
    f.pop();
  }
  const g = f.build();
  return g.geo;
}
function build() {
  dirty = false;
  const island = app.terrain?.ground?.island, W = S.world;
  lines = island ? (W?.ferries || []).map(fl => ({ f: fl, docks: docksOf(fl, island) })) : [];
  if (piers) { group.remove(piers); piers.geometry.dispose(); piers = null; }
  const geo = lines.length ? pierModel(lines) : null;
  if (geo) { piers = new THREE.Mesh(geo, mat); piers.castShadow = piers.receiveShadow = true; group.add(piers); }
}
function update() {
  if (!S.world) return;
  if (dirty) { if (!app.terrain?.ground && (S.world.ferries || []).length) return; build(); }
  if (!lines.length) { boats.count = 0; return; }
  const t = S.simT ?? app.net?.simNow?.() ?? 0, cam = app.stage.camera.position;
  let n = 0;
  for (const L of lines) {
    const level = L.docks[0].level, boatsN = L.f.boats || 1;
    for (let k = 0; k < boatsN && n < MAX_BOATS; k++) {
      boatAt(L.f, k, t, _b);
      if (Math.hypot(_b.x - cam.x, _b.z - cam.z) > FAR) continue;
      const bob = Math.sin(t * 1.1 + k * 2.1) * 0.12, roll = Math.sin(t * 0.8 + k) * (_b.sailing ? 0.025 : 0.012), pitch = Math.sin(t * 0.63 + k * 1.7) * 0.012;
      _q.setFromEuler(_e.set(pitch, _b.yaw, roll));
      boats.setMatrixAt(n++, _m.compose(_p.set(_b.x, level - 0.05 + bob, _b.z), _q, _s));   // the hull's waterline at the water (render/vessels.js)
    }
  }
  boats.count = n;
  boats.instanceMatrix.needsUpdate = true;
}
