// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Residents' cars (WP4.9): a resident who drives (server/sim/plan.js drive) sits hidden at the wheel for the length of
// the drive; the server tells every browser the lanes the drive follows (an 'rcar' message, and the drives under way to
// a browser that connects), and this draws the resident's car along them — the same classic models as traffic, wheels
// turning, lights at night — only while that resident's plan says they are in the car (the segment's vehicle byte), so
// a changed plan takes the car away at once. A short wait at each end for getting in and parking.
// 2026-10-28 (the product owner: people leaving the Radio Station "disappear ... their position is moving straight (not
// through roads)"): a drive now comes with its timetable (shared/car-route.js: the quickest way along the roads, the
// lights, the stop signs), the same one the server moves its driver by, so the resident is where its car is. Its car
// waits at the kerb while they walk to it, takes them there, and stays a moment after they get out (while they are near).
// 2026-11-16 (the product owner: "agents using cars to go places, they should appear as drivers inside the car"): the
// driver is drawn at the wheel (render/car-occupants.js), placed by the same pose as its car here (each: one pass over the
// drives, by the frame's time), so the two move as one.
import * as THREE from 'three';
import { ROAD_TOP } from './island-roads.js';
import { S, bus } from '../core/state.js';
import { evalDecoded, F_HIDDEN, VEH_CAR } from '/shared/proto.js';
import { carAt, arcLengths } from '/shared/car-route.js';
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
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0), _w = new THREE.Matrix4(), _e = {}, _c = new THREE.Color(), _a = {};
const TURN_DT = 0.25;   // s ahead the way a driven car turns is looked at (its driver's hands on the wheel)

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
  app.residentCars = { get drives() { return drives; }, shown: 0, each, kinds: () => kinds };
}
const keyOf = r => `${r.i}:${r.tIn ?? r.t0}`;   // (one resident may have more than one drive planned: there and back)
function add(r) {
  if (!Array.isArray(r.pts) || r.pts.length < 4 || !(r.t1 > r.t0)) return;
  if (Array.isArray(r.ks) && Array.isArray(r.ts) && r.ks.length === r.ts.length && r.ks.length >= 2) {
    drives.set(keyOf(r), { key: keyOf(r), i: r.i, t0: r.t0, t1: r.t1, tIn: r.tIn, tOut: r.tOut, timed: { pts: r.pts, S: arcLengths(r.pts), ks: r.ks, ts: r.ts }, k: r.i % KINDS.length, col: PAINT[(r.i * 7) % PAINT.length] });
    return;
  }
  const n = r.pts.length / 2, x = new Float32Array(n), z = new Float32Array(n), s = new Float32Array(n);
  for (let k = 0; k < n; k++) { x[k] = r.pts[2 * k]; z[k] = r.pts[2 * k + 1]; if (k) s[k] = s[k - 1] + Math.hypot(x[k] - x[k - 1], z[k] - z[k - 1]); }
  drives.set(keyOf(r), { key: keyOf(r), i: r.i, t0: r.t0, t1: r.t1, x, z, s, L: s[n - 1], k: r.i % KINDS.length, col: PAINT[(r.i * 7) % PAINT.length] });
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
/**
 * Each resident's car drawn at sim time t (this frame's: S.simT), with its pose: fn(D, k, matrix, info) — k its kind
 * (index into kinds), matrix the car's (Matrix4, reused: copy it to keep it), info { d (m along its way), turn (how
 * the road bends under it now: radians a metre, + to the left), wheel (true: its resident at the wheel) }. The cars render/car-occupants.js puts
 * drivers in are exactly those drawn, at exactly these poses.
 */
function each(t, fn) {
  const plans = app.net?.plans, cam = app.stage.camera.position;
  if (localStorage.getItem('mvw.traffic') === 'off' || !plans) return;
  const counts = kinds.map(() => 0);
  for (const D of drives.values()) {
    if (t > D.t1 + 5) { drives.delete(D.key); continue; }
    if (t < D.t0) continue;
    const p = plans[D.i]; if (!p) continue;
    evalDecoded(p, t, _e);
    let d, turn = 0, wheel = false;
    if (D.timed) {
      // its timetable: at the wheel from getting in to getting out (else the plan changed: no car); before and after,
      // parked at the kerb while its resident is near it
      if (t > D.t1) continue;
      const px = _e.x, pz = _e.z;
      wheel = !!(p.flags[_e.k] & F_HIDDEN) && p.veh?.[_e.k] === VEH_CAR;
      carAt(D.timed, t, _e);
      if (t >= D.tIn && t <= D.tOut) { if (!wheel) continue; }
      else if (Math.hypot(px - _e.x, pz - _e.z) > 60) continue;   // (its resident on the way to it, or just gone from it)
      d = _e.s;
      if (wheel) { carAt(D.timed, t + TURN_DT, _a); const ds = _a.s - d; if (ds > 0.05) turn = Math.atan2(Math.sin(_a.yaw - _e.yaw), Math.cos(_a.yaw - _e.yaw)) / ds; }
    } else {
      if (!(p.flags[_e.k] & F_HIDDEN) || p.veh?.[_e.k] !== VEH_CAR) continue;   // not (or no longer) at the wheel
      wheel = true;
      const dur = D.t1 - D.t0, board = Math.min(BOARD, dur * 0.2), u = Math.max(0, Math.min(1, (t - D.t0 - board) / Math.max(1, dur - 2 * board)));
      d = (u - Math.sin(2 * Math.PI * u) / (2 * Math.PI)) * D.L;   // pulls away and slows to a stop
      at(D, d, _e);
    }
    if (Math.hypot(_e.x - cam.x, _e.z - cam.z) > FAR) continue;
    if (counts[D.k] >= MAX) continue; counts[D.k]++;
    _q.setFromAxisAngle(_up, _e.yaw);
    _m.compose(_p.set(_e.x, groundY(_e.x, _e.z), _e.z), _q, _s);
    fn(D, D.k, _m, { d, turn, wheel });
  }
}
function update() {
  const t = S.simT, counts = kinds.map(() => 0);
  each(t, (D, k, m, { d }) => {
    const kk = kinds[k], idx = counts[k]++;
    for (const part of kk.parts) { part.mesh.setMatrixAt(idx, m); if (part.tint) part.mesh.setColorAt(idx, _c.setHex(D.col)); }
    const spin = wheelSpinAngle(d, kk.asset.wheel.radius);
    for (let w = 0; w < 4; w++) kk.wheels.setMatrixAt(idx * 4 + w, composeVehicleWheelMatrix(m, kk.asset.wheels[w].centre, spin, _w));
    kk.beams.setMatrixAt(idx, m);
    D.at = { x: m.elements[12], y: m.elements[13], z: m.elements[14], d, t };   // (where it is now: its engine's sound, audio/vehicle-sound.js)
  });
  let shown = 0;
  kinds.forEach((kk, k) => {
    for (const part of kk.parts) { part.mesh.count = counts[k]; uploadUsed(part.mesh.instanceMatrix, counts[k]); uploadUsed(part.mesh.instanceColor, counts[k]); }
    kk.wheels.count = counts[k] * 4; uploadUsed(kk.wheels.instanceMatrix, kk.wheels.count);
    kk.beams.count = counts[k]; kk.beams.visible = GU.uNight.value > 0.01; if (kk.beams.visible) uploadUsed(kk.beams.instanceMatrix, counts[k]);
    shown += counts[k];
  });
  app.residentCars.shown = shown;
}
