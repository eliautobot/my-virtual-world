// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Street traffic: client-side cars in right-hand lanes that obey the shared deterministic signal timing, so they are
// always stopped during the pedestrian scramble the server schedules crossings into. Straight-through lanes that
// wrap at the city edge, car following, stop lines, yellow-light logic, density by time of day. Decoration only.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { sigLight, GROUND_Y } from '/shared/constants.js';
import { ROAD_TOP } from './island-roads.js';
import { blockAt } from '/shared/city.js';
import { groundVehicleWheel } from '/shared/vehicle-presentation.js';
import { makeFurnMat } from './mats.js';
import { FB } from './furniture.js';
import { createVehicleAsset } from './vehicle-assets.js';
import { cityLanes } from '/shared/vehicle-traffic.js';
import { GU, uploadUsed } from './scene.js';
import { makeVehicleLampMaterial, makeVehicleBeamMaterial, wheelSpinAngle, composeVehicleWheelMatrix } from './vehicle-effects.js';

const KINDS = [
  { n: 'sedan', L: 4.5, W: 1.82, H: 1.44, p: 34, v: 12.5 },
  { n: 'compact', L: 3.9, W: 1.74, H: 1.5, p: 22, v: 12 },
  { n: 'suv', L: 4.8, W: 1.95, H: 1.78, p: 20, v: 12.5 },
  { n: 'van', L: 5.4, W: 2.0, H: 2.25, p: 9, v: 11 },
  { n: 'taxi', L: 4.6, W: 1.82, H: 1.46, p: 10, v: 12.5 },
  { n: 'bus', L: 11.6, W: 2.55, H: 3.15, p: 5, v: 9.5 },
];
const PSUM = KINDS.reduce((a, k) => a + k.p, 0);
const BODY = ['#f2f1ee', '#1b1d21', '#9aa0a8', '#b3202a', '#1f4e8c', '#2f6b4f', '#c7a24a', '#dedad0', '#5b6068', '#7a2e3b', '#27465e', '#3b3f45', '#e8e8e8', '#2a2d33'];
const BUS = ['#e8e8e8', '#2a6fb0', '#c0392b'];
const MIN_GAP = 2.4;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _netColor = new THREE.Color(), _beamPose = new THREE.Matrix4(), _beamQ = new THREE.Quaternion();
const _bridge = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
const _view = new THREE.Matrix4(), _frustum = new THREE.Frustum(), _shadowFrustum = new THREE.Frustum(), _vehicleBounds = new THREE.Sphere(), _wheelPose = new THREE.Matrix4();
const _tilt = new THREE.Quaternion(), _roll = new THREE.Quaternion(), _zAxis = new THREE.Vector3(0, 0, 1), _xAxis = new THREE.Vector3(1, 0, 0);
/** A car whose pose carries only its heading (traffic and resting cars travel that way) is drawn following the ground
 *  under it beyond the city (WP4.3): pitched along and rolled across the island's slope. */
function groundTilt(q, c, terrain, halfLength, halfWidth) {
  const fx = Math.cos(c.yaw), fz = -Math.sin(c.yaw), lx = Math.sin(c.yaw), lz = Math.cos(c.yaw), a = halfLength * 0.8, b = halfWidth * 0.8;
  const pitch = Math.atan2(terrain.heightAt(c.x + fx * a, c.z + fz * a) - terrain.heightAt(c.x - fx * a, c.z - fz * a), 2 * a);
  const roll = -Math.atan2(terrain.heightAt(c.x + lx * b, c.z + lz * b) - terrain.heightAt(c.x - lx * b, c.z - lz * b), 2 * b);
  return q.multiply(_tilt.setFromAxisAngle(_zAxis, pitch)).multiply(_roll.setFromAxisAngle(_xAxis, roll));
}

function carGeo(k) {
  const f = new FB(), L = k.L, W = k.W, H = k.H, hl = L / 2, hw = W / 2, glass = '#1d2731';
  const wr = k.n === 'bus' ? 0.5 : (k.n === 'van' || k.n === 'suv') ? 0.37 : 0.33;
  if (k.n === 'bus') {
    f.tint(); f.box(-hw, 0.32, -hl, hw, H - 0.14, hl);
    f.col('#f4f4f2'); f.box(-hw + 0.04, H - 0.14, -hl + 0.1, hw - 0.04, H, hl - 0.1);
    f.col(glass); f.box(-hw - 0.012, 1.2, -hl + 0.5, hw + 0.012, 2.5, hl - 1.15);
    f.box(-hw + 0.12, 1.05, hl - 0.01, hw - 0.12, 2.6, hl + 0.012); f.box(-hw + 0.2, 1.3, -hl - 0.012, hw - 0.2, 2.5, -hl + 0.01);
    f.col('#2a2d33'); f.box(-hw - 0.016, 0.3, hl - 1.05, -hw + 0.01, 2.55, hl - 0.2);
    f.col('#ffb347', 0, 3); f.box(-0.75, 2.66, hl + 0.013, 0.75, 2.86, hl + 0.02);
  } else {
    const van = k.n === 'van', suv = k.n === 'suv';
    const belt = van ? 1.1 : suv ? 1.0 : 0.86, ins = 0.1;
    f.tint(); f.box(-hw, 0.3, -hl, hw, belt, hl);
    const cr = van ? -hl + 0.15 : -hl + L * (suv ? 0.12 : 0.2), cf = van ? hl - 1.0 : hl - L * 0.32;
    f.box(-hw + ins, belt, cr, hw - ins, H, cf);
    f.col(glass);
    f.box(-hw + ins - 0.012, belt + 0.06, cr + 0.15, hw - ins + 0.012, H - 0.07, cf - 0.12);
    f.box(-hw + ins + 0.05, belt + 0.05, cf - 0.01, hw - ins - 0.05, H - 0.06, cf + 0.012);
    f.box(-hw + ins + 0.08, belt + 0.08, cr - 0.012, hw - ins - 0.08, H - 0.08, cr + 0.01);
    f.tint(); const bp = (cr + cf) / 2 - 0.05; f.box(-hw + ins - 0.02, belt, bp - 0.05, hw - ins + 0.02, H - 0.02, bp + 0.05);
    if (k.n === 'taxi') {
      const zc = (cr + cf) / 2;
      f.col('#f2f2f2'); f.box(-0.3, H, zc - 0.15, 0.3, H + 0.2, zc + 0.15);
      f.col('#ffcf33', 0, 3); f.box(-0.25, H + 0.05, zc + 0.151, 0.25, H + 0.16, zc + 0.158);
    }
    f.col('#2a2d33'); f.box(-hw + 0.02, 0.28, hl - 0.02, hw - 0.02, 0.5, hl + 0.06); f.box(-hw + 0.02, 0.28, -hl - 0.06, hw - 0.02, 0.5, -hl + 0.02);
    f.col('#15171a'); f.box(-hw * 0.55, 0.52, hl, hw * 0.55, 0.7, hl + 0.012);
  }
  const ly = k.n === 'bus' ? 0.75 : 0.68;
  f.col('#fff4d6', 0, 2); for (const s of [-1, 1]) f.box(s * (hw - 0.32) - 0.16, ly - 0.07, hl - 0.02, s * (hw - 0.32) + 0.16, ly + 0.07, hl + 0.018);
  f.col('#ff2a1a', 0, 2); for (const s of [-1, 1]) f.box(s * (hw - 0.25) - 0.14, ly - 0.06, -hl - 0.018, s * (hw - 0.25) + 0.14, ly + 0.06, -hl + 0.02);
  const wz = k.n === 'bus' ? [hl - 2.0, -hl + 2.6] : [hl - 0.82, -hl + 0.85];
  for (const z of wz) for (const s of [-1, 1]) {
    const x = s * (hw - 0.14);
    f.col('#141518'); f.rod([x - 0.12, wr, z], [x + 0.12, wr, z], wr, 12);
    f.col('#aeb3ba'); f.rod([x + s * 0.12, wr, z], [x + s * 0.126, wr, z], wr * 0.55, 10);
  }
  return f.build().geo;
}
function pickKind() { let r = Math.random() * PSUM; for (let k = 0; k < KINDS.length; k++) { r -= KINDS[k].p; if (r <= 0) return k; } return 0; }
function density(h) {
  const day = h > 6.5 && h < 21.5 ? 1 : 0, g = (c, w) => Math.exp(-(((h - c) / w) ** 2));
  return Math.min(1, 0.14 + 0.3 * day + 0.42 * g(8.4, 1.3) + 0.48 * g(17.7, 1.6) + 0.1 * g(12.5, 1.5));
}

export class Traffic {
  constructor(app) {
    this.app = app; this.g = S.grid;
    this.max = { low: 130, medium: 230, high: 330 }[app.stage.q.name] || 230;
    this.group = new THREE.Group();
    this.assets = KINDS.map(createVehicleAsset);
    this.batches = this.assets.map((asset, kind) => asset.parts.map(part => {
      const material = part.lit ? makeVehicleLampMaterial(part.material, GU.uNight) : part.material.clone();
      const im = new THREE.InstancedMesh(part.geometry, material, this.max);
      im.name = `traffic:${KINDS[kind].n}:${part.sourceNames.join('+')}`;
      im.userData.vehicleSource = asset.provenance;
      im.userData.vehicleKind = KINDS[kind].n;
      im.count = 0; im.frustumCulled = false;
      im.castShadow = app.stage.q.shadows && !im.material.transparent; im.receiveShadow = true; im.userData.smallCaster = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (part.tint) im.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(im); return { mesh: im, tint: part.tint };
    }));
    // Representative per-kind meshes keep the public traffic shape; all visual parts share the same pose.
    this.meshes = this.batches.map(parts => parts[0].mesh);
    this.mat = this.meshes[0].material;
    this.wheelMeshes = this.assets.map((asset, kind) => {
      const im = new THREE.InstancedMesh(asset.wheel.geometry, asset.wheel.material.clone(), this.max * 4);
      im.name = `traffic:${KINDS[kind].n}:rolling-wheels`; im.userData.vehicleRole = 'wheels';
      im.userData.vehicleSource = asset.provenance; im.count = 0; im.frustumCulled = false;
      im.castShadow = app.stage.q.shadows; im.receiveShadow = true; im.userData.smallCaster = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(im); return im;
    });
    this.beamMeshes = this.assets.map((asset, kind) => {
      const im = new THREE.InstancedMesh(asset.beam, makeVehicleBeamMaterial(GU.uNight), this.max);
      im.name = `traffic:${KINDS[kind].n}:headlight-road-pools`; im.userData.vehicleRole = 'beams';
      im.userData.vehicleSource = asset.provenance; im.count = 0; im.frustumCulled = false;
      im.renderOrder = 1; im.visible = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im); return im;
    });
    this.lanes = [];
    const g = this.g;
    this.city = cityLanes(S.world.grid);   // the avenue's lanes and stop bars once the city is widened (shared/vehicle-traffic.js)
    if (!g.empty) {   // (no city: no local lanes; the server's traffic on the roads is drawn as it comes)
      for (let i = 0; i <= g.nx; i++) for (const dir of [1, -1]) for (const off of this.city.offsets) this.lanes.push(this.lane(0, dir, i, off));
      for (let j = 0; j <= g.nz; j++) for (const dir of [1, -1]) for (const off of this.city.offsets) this.lanes.push(this.lane(1, dir, j, off));
    }
    this.fill(Math.round(this.max * density(S.hour)));
  }
  lane(axis, dir, k, off) {
    const g = this.g, lo = axis === 0 ? g.minZ : g.minX, hi = axis === 0 ? g.maxZ : g.maxX;
    const fixed = axis === 0 ? g.X[k] - dir * off : g.Z[k] + dir * off, start = dir > 0 ? lo : hi, len = hi - lo;
    const stops = [];
    (axis === 0 ? g.Z : g.X).forEach((c, m) => {
      const s = dir > 0 ? (c - this.city.stop) - start : start - (c + this.city.stop);
      if (s > 1) stops.push({ s, ix: axis === 0 ? m * (g.nx + 1) + k : k * (g.nx + 1) + m });
    });
    stops.sort((a, b) => a.s - b.s);
    return { axis, dir, fixed, start, len, stops, cars: [] };
  }
  car(s) {
    const k = pickKind(), K = KINDS[k], pal = k === 5 ? BUS : BODY;
    return { k, len: K.L, s, v: K.v * 0.8, vmax: K.v * (0.85 + Math.random() * 0.25), col: new THREE.Color(pal[(Math.random() * pal.length) | 0]) };
  }
  fill(target) {
    const total = this.lanes.reduce((a, l) => a + l.len, 0), spacing = total / Math.max(1, target);
    for (const l of this.lanes) {
      let s = l.len - Math.random() * spacing;
      while (s > 0) { const c = this.car(s); l.cars.push(c); s -= c.len + MIN_GAP + spacing * (0.3 + Math.random() * 1.4); }
    }
  }
  count() { if (this.app.driving?.ready) return this.app.driving.byId.size; let n = 0; for (const l of this.lanes) n += l.cars.length; return n; }
  step(dt, t) {
    for (const l of this.lanes) {
      const C = l.cars;
      for (let n = 0; n < C.length; n++) {
        const c = C[n], front = c.s + c.len / 2;
        let gap = 1e9;
        if (n > 0) { const a = C[n - 1]; gap = a.s - a.len / 2 - front - MIN_GAP; }
        for (const st of l.stops) {
          if (st.s < front - 0.4) continue;
          const d = st.s - front;
          if (d > 60) break;
          const lt = sigLight(st.ix, t, l.axis);
          if (lt === 2) break;
          if (lt === 1 && d < c.v * c.v / 6 + 0.5) break;
          gap = Math.min(gap, d - 0.1);
          break;
        }
        const vDes = Math.min(c.vmax, Math.sqrt(Math.max(0, 2 * 3.2 * gap)));
        const dv = vDes - c.v;
        c.v = Math.max(0, c.v + (dv > 0 ? Math.min(dv, 2.4 * dt) : Math.max(dv, -9 * dt)));
        c.s += c.v * dt;
      }
      while (C.length && C[0].s - C[0].len / 2 > l.len) C.shift();
    }
  }
  renderNetwork() {
    const source = this.app.driving, camera = this.app.stage.camera, counts = [0, 0, 0, 0, 0, 0];
    const cars = source.list().sort((a, b) => (b.id === source.id) - (a.id === source.id) || Math.hypot(a.x - camera.position.x, a.z - camera.position.z) - Math.hypot(b.x - camera.position.x, b.z - camera.position.z));
    this.visibleCars = [];
    _view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frustum.setFromProjectionMatrix(_view);
    const light = this.app.stage.sun, hasShadow = !!(this.app.stage.q.shadows && light?.castShadow);
    const terrain = this.app.terrain || null, g = this.g;
    if (hasShadow) { light.shadow.updateMatrices(light); _shadowFrustum.copy(light.shadow.getFrustum()); }
    const show = localStorage.getItem('mvw.traffic') || 'normal', simple = localStorage.getItem('mvw.vehicleDetail') === 'simple';
    for (const c of cars) {
      // Display → Traffic: fewer (or no) passing cars on this screen; parked and driven cars always show
      if (c.mode === 0 && c.id !== source.id && (show === 'off' || (show === 'light' && c.id % 2))) continue;
      _vehicleBounds.center.set(c.x, c.y + KINDS[c.k].H / 2, c.z); _vehicleBounds.radius = this.assets[c.k].radius + (GU.uNight.value > .01 ? this.assets[c.k].beamLength : 2);
      if (c.id !== source.id && !_frustum.intersectsSphere(_vehicleBounds) && !(hasShadow && _shadowFrustum.intersectsSphere(_vehicleBounds))) continue;
      const idx = counts[c.k]; if (idx >= this.max) continue; counts[c.k]++;
      const outside = terrain && (c.x < g.minX || c.x > g.maxX || c.z < g.minZ || c.z > g.maxZ);
      // beyond the city the roads are drawn a little above the graded ground everything runs on: wheels on the road
      _p.set(c.x, c.y + (outside ? ROAD_TOP : 0), c.z); _s.set(1, 1, 1);
      _q.set(c.rotation.x, c.rotation.y, c.rotation.z, c.rotation.w);
      if (outside && Math.abs(c.rotation.x) < 1e-6 && Math.abs(c.rotation.z) < 1e-6) groundTilt(_q, c, terrain, KINDS[c.k].L / 2, KINDS[c.k].W / 2);
      _q.multiply(_bridge); _m.compose(_p, _q, _s);
      for (const part of this.batches[c.k]) { part.mesh.setMatrixAt(idx, _m); if (part.tint) part.mesh.setColorAt(idx, _netColor.setHex(c.col)); }
      const a = this.assets[c.k];
      const plain = simple && c.id !== source.id && Math.hypot(c.x - camera.position.x, c.z - camera.position.z) > 60;   // Display → Vehicle detail: far wheels neither turn nor follow the ground
      for (let w = 0; w < 4; w++) {
        if (plain) { composeVehicleWheelMatrix(_m, a.wheels[w].centre, 0, _wheelPose, 0, a.wheel.radius + .06 - c.wheels[w].suspensionLength); this.wheelMeshes[c.k].setMatrixAt(idx * 4 + w, _wheelPose); continue; }
        const state = c.wheels[w], steering = a.wheels[w].centre[2] > 0 ? c.steering : 0;
        composeVehicleWheelMatrix(_m, a.wheels[w].centre, state.spin, _wheelPose, steering, a.wheel.radius + .06 - state.suspensionLength);
        const wheelBox = a.wheel.geometry.boundingBox;
        groundVehicleWheel(_wheelPose, state, a.wheel.radius, Math.max(Math.abs(wheelBox.min.x), Math.abs(wheelBox.max.x)));
        this.wheelMeshes[c.k].setMatrixAt(idx * 4 + w, _wheelPose);
      }
      _p.set(c.x, outside ? c.y + ROAD_TOP : blockAt(this.g, c.x, c.z) ? GROUND_Y : 0, c.z); _beamQ.setFromAxisAngle(_up, c.yaw + Math.PI / 2); _beamPose.compose(_p, _beamQ, _s);
      this.beamMeshes[c.k].setMatrixAt(idx, _beamPose); this.visibleCars.push({ id: c.id, k: c.k, idx });
    }
    this.batches.forEach((parts, k) => parts.forEach(({mesh: im}) => { im.count = counts[k]; uploadUsed(im.instanceMatrix, im.count); uploadUsed(im.instanceColor, im.count); }));
    this.wheelMeshes.forEach((im, k) => { im.count = counts[k] * 4; uploadUsed(im.instanceMatrix, im.count); });
    this.beamMeshes.forEach((im, k) => { im.count = counts[k]; im.visible = GU.uNight.value > .01; if (im.visible) uploadUsed(im.instanceMatrix, im.count); });
  }
  update(dt) {
    if (this.app.driving?.ready) { this.networked = true; this.renderNetwork(); return; }
    if (this.networked) return; // hold the last confirmed fleet during an outage; never replace it with local guesses
    if (!this.lanes.length) return;   // no city: no local cars (the roads' traffic arrives from the server)
    const net = this.app.net;
    if (!net.clock) return;
    const dts = Math.min(dt * net.clock.rate, 0.5), t = S.simT;
    if (dts > 0) {
      const steps = Math.ceil(dts / 0.1);
      for (let k = 0; k < steps; k++) this.step(dts / steps, t);
      const want = Math.round(this.max * density(S.hour));
      let n = this.count();
      for (let tries = 0; tries < 6 && n < want; tries++) {
        const l = this.lanes[(Math.random() * this.lanes.length) | 0], last = l.cars[l.cars.length - 1];
        if (!last || last.s - last.len / 2 > 14) { l.cars.push(this.car(0)); n++; }
      }
    }
    const cnt = [0, 0, 0, 0, 0, 0];
    const camera = this.app.stage.camera, light = this.app.stage.sun;
    const cull = !!camera?.isCamera;
    let shadowCull = false;
    if (cull) {
      camera.updateMatrixWorld();
      _frustum.setFromProjectionMatrix(_view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      if (this.app.stage.q.shadows && light?.shadow?.camera) {
        light.updateMatrixWorld(); light.target.updateMatrixWorld(); light.shadow.updateMatrices(light);
        const sc = light.shadow.camera;
        _shadowFrustum.setFromProjectionMatrix(_view.multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse));
        shadowCull = true;
      }
    }
    for (const l of this.lanes) {
      const yaw = l.axis === 0 ? (l.dir > 0 ? 0 : Math.PI) : (l.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      _q.setFromAxisAngle(_up, yaw);
      for (const c of l.cars) {
        const idx = cnt[c.k]; if (idx >= this.max) continue;
        const along = l.start + l.dir * c.s, sc = Math.min(1, Math.max(0.01, Math.min(c.s, l.len - c.s) / 4));
        _p.set(l.axis === 0 ? l.fixed : along, 0, l.axis === 0 ? along : l.fixed); _s.set(sc, sc, sc);
        if (cull) {
          _vehicleBounds.center.set(_p.x, KINDS[c.k].H / 2, _p.z);
          _vehicleBounds.radius = this.assets[c.k].radius + (GU.uNight.value > 0.01 ? this.assets[c.k].beamLength : 2);
          if (!_frustum.intersectsSphere(_vehicleBounds) && (!shadowCull || !_shadowFrustum.intersectsSphere(_vehicleBounds))) continue;
        }
        cnt[c.k]++;
        _m.compose(_p, _q, _s);
        for (const part of this.batches[c.k]) {
          part.mesh.setMatrixAt(idx, _m);
          if (part.tint) part.mesh.setColorAt(idx, c.col);
        }
        const asset = this.assets[c.k], angle = wheelSpinAngle(c.s, asset.wheel.radius);
        for (let w = 0; w < asset.wheels.length; w++) {
          composeVehicleWheelMatrix(_m, asset.wheels[w].centre, angle, _wheelPose);
          this.wheelMeshes[c.k].setMatrixAt(idx * 4 + w, _wheelPose);
        }
        this.beamMeshes[c.k].setMatrixAt(idx, _m);
      }
    }
    this.batches.forEach((parts, k) => parts.forEach(({ mesh: im }) => { im.count = cnt[k]; uploadUsed(im.instanceMatrix, im.count); uploadUsed(im.instanceColor, im.count); }));
    this.wheelMeshes.forEach((im, k) => { im.count = cnt[k] * 4; uploadUsed(im.instanceMatrix, im.count); });
    this.beamMeshes.forEach((im, k) => { im.count = cnt[k]; im.visible = GU.uNight.value > 0.01; if (im.visible) uploadUsed(im.instanceMatrix, im.count); });
  }
}

export function init(app) {
  const tr = app.traffic = new Traffic(app);
  app.stage.scene.add(tr.group);
  bus.on('frame', dt => tr.update(dt));
}
