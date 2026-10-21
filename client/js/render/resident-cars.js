// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Residents' cars (WP4.9): a resident who drives (server/sim/plan.js drive) sits hidden at the wheel for the length of
// the drive; the server tells every browser the lanes the drive follows (an 'rcar' message, and the drives under way to
// a browser that connects), and this draws the resident's car along them - the same classic models as traffic, wheels
// turning, lights at night - only while that resident's plan says they are in the car (the segment's vehicle byte), so
// a changed plan takes the car away at once. A short wait at each end for getting in and parking.
import * as THREE from 'three';
import { ROAD_TOP } from './island-roads.js';
import { S, bus } from '../core/state.js';
import { evalDecoded, F_HIDDEN, VEH_CAR } from '/shared/proto.js';
import { createVehicleAsset } from './vehicle-assets.js';
import { GU, uploadUsed } from './scene.js';
import { makeVehicleLampMaterial, makeVehicleBeamMaterial, wheelSpinAngle, composeVehicleWheelMatrix } from './vehicle-effects.js';

const KINDS = [
  { n: 'sedan', L: 4.5, W: 1.82, H: 1.44 },
  { n: 'compact', L: 3.9, W: 1.74, H: 1.5 },
  { n: 'suv', L: 4.8, W: 1.95, H: 1.78 },
];
const PAINT = [0xf2f1ee, 0x1b1d21, 0x9aa0a8, 0xb3202a, 0x1f4e8c, 0x2f6b4f, 0xc7a24a, 0xdedad0, 0x5b6068, 0x7a2e3b, 0x27465e, 0x3b3f45];
const MAX = 64, FAR = 1500, BOARD = 18;   // s getting in at the start and parking at the end
let app = null, kinds = [], drives = new Map(), group = null;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0), _w = new THREE.Matrix4(), _e = {}, _c = new THREE.Color();

export function init(a) {
  app = a;
  group = new THREE.Group(); group.name = 'resident-cars'; a.stage.scene.add(group);
  kinds = KINDS.map(K => {
    const asset = createVehicleAsset(K);
    const parts = asset.parts.map(part => {
      const im = new THREE.InstancedMesh(part.geometry, part.lit ? makeVehicleLampMaterial(part.material, GU.uNight) : part.material.clone(), MAX);
      im.count = 0; im.frustumCulled = false; im.castShadow = a.stage.q.shadows && !im.material.transparent; im.receiveShadow = true; im.userData.smallCaster = true;
      if (part.tint) im.setColorAt(0, _c.set(0xffffff));
      group.add(im); return { mesh: im, tint: part.tint };
    });
    const wheels = new THREE.InstancedMesh(asset.wheel.geometry, asset.wheel.material.clone(), MAX * 4); wheels.count = 0; wheels.frustumCulled = false; group.add(wheels);
    const beams = new THREE.InstancedMesh(asset.beam, makeVehicleBeamMaterial(GU.uNight), MAX); beams.count = 0; beams.frustumCulled = false; beams.renderOrder = 1; group.add(beams);
    return { K, asset, parts, wheels, beams };
  });
  bus.on('msg:rcar', add);
  bus.on('msg:rcars', m => { for (const r of m.list || []) add(r); });
  bus.on('frame', update);
  app.residentCars = { get drives() { return drives; }, shown: 0 };
}
function add(r) {
  if (!Array.isArray(r.pts) || r.pts.length < 4 || !(r.t1 > r.t0)) return;
  const n = r.pts.length / 2, x = new Float32Array(n), z = new Float32Array(n), s = new Float32Array(n);
  for (let k = 0; k < n; k++) { x[k] = r.pts[2 * k]; z[k] = r.pts[2 * k + 1]; if (k) s[k] = s[k - 1] + Math.hypot(x[k] - x[k - 1], z[k] - z[k - 1]); }
  drives.set(r.i, { i: r.i, t0: r.t0, t1: r.t1, x, z, s, L: s[n - 1], k: r.i % KINDS.length, col: PAINT[(r.i * 7) % PAINT.length] });
}
/** Position and heading at distance d along a drive. */
function at(D, d, out) {
  const s = D.s, n = s.length;
  let lo = 0, hi = n - 1; while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (s[mid] <= d) lo = mid; else hi = mid; }
  const seg = s[hi] - s[lo] || 1, u = Math.max(0, Math.min(1, (d - s[lo]) / seg));
  out.x = D.x[lo] + (D.x[hi] - D.x[lo]) * u; out.z = D.z[lo] + (D.z[hi] - D.z[lo]) * u;
  out.yaw = Math.atan2(D.x[hi] - D.x[lo], D.z[hi] - D.z[lo]);
  return out;
}
function groundY(x, z) {
  const g = app.city?.g;
  if (g && x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ) return 0;   // the city's streets
  // on an island road: its drawn surface exactly (the road's own profile), else the ground
  const R = app.terrain?.ground?.island?.roads, near = R?.net.nearest(x, z, 12);
  if (near && near.dist <= R.half.get(near.id)) return R.surface(near.id, x, z) + ROAD_TOP - 0.04;
  return app.terrain ? app.terrain.heightAt(x, z) : 0;
}
function update() {
  const t = S.simT, plans = app.net?.plans, cam = app.stage.camera.position;
  const off = localStorage.getItem('mvw.traffic') === 'off', counts = kinds.map(() => 0);
  if (!off && plans) for (const D of drives.values()) {
    if (t > D.t1 + 5) { drives.delete(D.i); continue; }
    if (t < D.t0) continue;
    const p = plans[D.i]; if (!p) continue;
    evalDecoded(p, t, _e);
    if (!(p.flags[_e.k] & F_HIDDEN) || p.veh?.[_e.k] !== VEH_CAR) continue;   // not (or no longer) at the wheel
    const dur = D.t1 - D.t0, board = Math.min(BOARD, dur * 0.2), u = Math.max(0, Math.min(1, (t - D.t0 - board) / Math.max(1, dur - 2 * board)));
    const d = (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI)) * D.L;   // pulls away and slows to a stop
    at(D, d, _e);
    if (Math.hypot(_e.x - cam.x, _e.z - cam.z) > FAR) continue;
    const kk = kinds[D.k], idx = counts[D.k]; if (idx >= MAX) continue; counts[D.k]++;
    _q.setFromAxisAngle(_up, _e.yaw);
    _m.compose(_p.set(_e.x, groundY(_e.x, _e.z), _e.z), _q, _s);
    for (const part of kk.parts) { part.mesh.setMatrixAt(idx, _m); if (part.tint) part.mesh.setColorAt(idx, _c.setHex(D.col)); }
    const spin = wheelSpinAngle(d, kk.asset.wheel.radius);
    for (let w = 0; w < 4; w++) kk.wheels.setMatrixAt(idx * 4 + w, composeVehicleWheelMatrix(_m, kk.asset.wheels[w].centre, spin, _w));
    kk.beams.setMatrixAt(idx, _m);
  }
  let shown = 0;
  kinds.forEach((kk, k) => {
    for (const part of kk.parts) { part.mesh.count = counts[k]; uploadUsed(part.mesh.instanceMatrix, counts[k]); uploadUsed(part.mesh.instanceColor, counts[k]); }
    kk.wheels.count = counts[k] * 4; uploadUsed(kk.wheels.instanceMatrix, kk.wheels.count);
    kk.beams.count = counts[k]; kk.beams.visible = GU.uNight.value > 0.01; if (kk.beams.visible) uploadUsed(kk.beams.instanceMatrix, counts[k]);
    shown += counts[k];
  });
  app.residentCars.shown = shown;
}
