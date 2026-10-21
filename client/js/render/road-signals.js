// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Traffic signals at the busier junctions beyond the city (shared/road-kit.js plans), in the city's style
// (render/city.js): a pole on the corner where each road comes in, a mast arm reaching over its incoming lanes with a
// US three-lamp head over each lane (red, yellow, green; 2026-10-06), and walk/don't-walk heads facing across the
// crosswalks.
// The lamps follow the city's timetable for that junction (signalFor / walkFor on the simulation clock), so drivers,
// walkers and every screen see the same light. Junctions without signals get stop signs where the plan puts them
// (shared/road-kit.js signs: the side road at a two-way stop, every approach at an all-way stop, with its plaque).
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { FB } from './furniture.js';
import { makeFurnMat } from './mats.js';
import { signalFor, walkFor, CURB_RISE } from '/shared/road-kit.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();
// the three lamps' colours, red, yellow, green, off / on (linear, the on ones bright for bloom); the city's too
export const SIGNAL_LAMPS = [[[0.09, 0.015, 0.01], [7, 0.3, 0.12]], [[0.09, 0.07, 0.01], [6, 4.5, 0.3]], [[0.01, 0.07, 0.03], [0.3, 6.5, 1.8]]];
const VC = SIGNAL_LAMPS;

export class RoadSignals {
  /** plans: shared/road-kit.js junction plans; padY: key → the junction's surface height; nameOf(road id): its name
   *  (the street name signs). */
  constructor(plans, padY, nameOf = null) {
    this.group = new THREE.Group(); this.group.name = 'road-signals';
    const signed = plans.filter(p => !p.signalized && p.signs?.length);
    this.plans = plans.filter(p => p.signalized);
    const f = new FB(), discs = [], peds = [], faces = [], blades = [];
    // the street a road meets at junction J (the arm most across arm A, on another road), for its name sign
    const crossOf = (J, A) => { let best = null, bc = 0.3; for (const B of J.arms) { if (B.id === A.id) continue; const c = Math.abs(A.d.x * B.d.z - A.d.z * B.d.x); if (c > bc) { bc = c; best = B; } } return best; };
    // stop signs: a galvanised post, the sign's face and back an instanced plate each (render below)
    for (const J of signed) {
      const y0 = padY.get(J.key) ?? 0;
      for (const sg of J.signs) {
        const y = y0 + (sg.raised ? CURB_RISE : 0);
        f.col('#9aa0a6'); f.box(sg.x - 0.035, y - 0.4, sg.z - 0.035, sg.x + 0.035, y + 2.5, sg.z + 0.035);
        faces.push({ x: sg.x, y: y + 2.5, z: sg.z, yaw: sg.yaw, allWay: sg.allWay });
        if (nameOf) cornerBlades(f, blades, J, sg.x, sg.z, y + 2.5 + 0.55, nameOf);   // the two street names atop the stop sign
      }
    }
    for (const J of this.plans) {
      const y0 = padY.get(J.key) ?? 0;
      for (const sg of J.signals) {
        const A = J.arms[sg.arm], y = y0 + (A.sec.raised ? CURB_RISE : 0), h = 5.4;
        // the pole, its mast arm along +n of the arm (over the incoming lanes), heads over each lane facing the traffic
        f.col('#2d3137');
        f.cyl(sg.x, sg.z, 0.13, y, y + 0.35, 10, 0.12);
        f.cyl(sg.x, sg.z, 0.085, y + 0.35, y + h + 0.2, 10, 0.07);
        const tip = { x: sg.x + A.n.x * sg.reach, z: sg.z + A.n.z * sg.reach };
        f.rod([sg.x, y + h, sg.z], [tip.x, y + h, tip.z], 0.06, 6);
        f.rod([sg.x, y + h - 1.1, sg.z], [sg.x + A.n.x * sg.reach * 0.45, y + h - 0.02, sg.z + A.n.z * sg.reach * 0.45], 0.03, 5);   // the arm's brace
        const face = Math.atan2(A.d.x, A.d.z);   // traffic comes in along −d: the heads look back along +d
        // the street name sign on the arm (2026-10-05): the name of the street this traffic is about to cross, on top
        // of the arm halfway out, readable from both sides
        const X = nameOf && crossOf(J, A), xn = X && nameOf(X.id);
        if (xn) {
          const r = sg.reach * 0.5, bx = sg.x + A.n.x * r, bz = sg.z + A.n.z * r, by = y + h + 0.42;
          f.col('#2d3137'); for (const k of [-0.35, 0.35]) f.rod([bx + A.n.x * k, y + h, bz + A.n.z * k], [bx + A.n.x * k, by - 0.2, bz + A.n.z * k], 0.02, 4);
          blades.push({ x: bx, y: by, z: bz, yaw: face, text: xn });
        }
        const pole = A.sec.carriage + (A.sec.curb ? 0.9 : 1.6);
        for (const L of A.sec.lanes) {
          const r = pole - L.o, hx = sg.x + A.n.x * r, hz = sg.z + A.n.z * r, hy = y + h - 0.75;
          f.col('#2d3137'); f.rod([hx, y + h, hz], [hx, hy + 0.62, hz], 0.025, 4);
          f.col('#1c1f24'); f.push(hx, hy, hz, face); f.box(-0.2, -0.64, -0.14, 0.2, 0.6, 0.13);
          for (let k = 0; k < 3; k++) { f.col('#111317'); f.box(-0.18, 0.36 - k * 0.34 + 0.12, 0.13, 0.18, 0.36 - k * 0.34 + 0.15, 0.25); }
          f.col('#15171b'); f.box(-0.27, -0.71, -0.155, 0.27, 0.67, -0.14);   // the backplate (dark from behind)
          f.col('#e8c21a'); for (const [x0, x1, y0b, y1b] of [[-0.27, 0.27, 0.63, 0.67], [-0.27, 0.27, -0.71, -0.67], [-0.27, -0.23, -0.71, 0.67], [0.23, 0.27, -0.71, 0.67]]) f.box(x0, y0b, -0.14, x1, y1b, -0.13);   // its thin reflective border, facing the traffic
          f.pop();
          for (let k = 0; k < 3; k++) discs.push({ J, arm: sg.arm, lamp: k, x: hx + A.d.x * 0.135, y: hy + 0.34 - k * 0.34, z: hz + A.d.z * 0.135, yaw: face });
        }
        // walk heads facing across the crosswalk on this arm
        if (J.crosswalks.some(c => c.arm === sg.arm)) {
          const pf = Math.atan2(A.n.x, A.n.z), qx = sg.x + A.n.x * 0.2, qz = sg.z + A.n.z * 0.2;
          f.col('#1c1f24'); f.push(qx, y + 2.75, qz, pf); f.box(-0.18, -0.21, -0.1, 0.18, 0.21, 0.1); f.pop();
          peds.push({ J, x: qx + A.n.x * 0.105, y: y + 2.75, z: qz + A.n.z * 0.105, yaw: pf });
        }
      }
    }
    // corners with neither signals nor stop signs: a post with the two street names (built with the rest — 2026-10-14:
    // added after the build, the post was never drawn and its names floated)
    if (nameOf) for (const J of plans.filter(p => !p.signalized && !p.signs?.length)) {
      const C = J.corners?.find(c => c.X && c.O && c.R); if (!C) continue;
      // on the corner's sidewalk just behind its curb, at the middle of the curve (the curb runs at R from the curve's
      // centre O, the land on O's side; X, the curb lines' meeting point, is out on the road)
      const A = J.arms[C.i], raised = !!A.sec.raised, back = A.sec.curb ? A.sec.curb.o1 - A.sec.curb.o0 + 0.6 : 1.2;
      const ox = C.X.x - C.O.x, oz = C.X.z - C.O.z, l = Math.hypot(ox, oz) || 1, y = (padY.get(J.key) ?? 0) + (raised ? CURB_RISE : 0);
      const px = C.O.x + ox / l * (C.R - back), pz = C.O.z + oz / l * (C.R - back);
      f.col('#9aa0a6'); f.box(px - 0.035, y - 0.3, pz - 0.035, px + 0.035, y + 3.0, pz + 0.035);
      cornerBlades(f, blades, J, px, pz, y + 3.0, nameOf);
    }
    const G = f.build();
    if (G.geo) { const m = new THREE.Mesh(G.geo, makeFurnMat({ lit: true })); m.castShadow = true; m.receiveShadow = true; m.userData.smallCaster = true; this.group.add(m); }
    const lamps = (geo, list) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), list.length);
      list.forEach((d, k) => { _q.setFromAxisAngle(_up, d.yaw); im.setMatrixAt(k, _m.compose(_p.set(d.x, d.y, d.z), _q, _s)); im.setColorAt(k, _c.setRGB(0, 0, 0)); });
      im.frustumCulled = false; this.group.add(im);
      return { im, list, state: new Int8Array(list.length).fill(-1) };
    };
    if (faces.length) this.group.add(stopSigns(faces));
    if (blades.length) this.group.add(nameSigns(blades));
    this.veh = lamps(new THREE.CircleGeometry(0.11, 14), discs);
    this.ped = lamps(new THREE.PlaneGeometry(0.27, 0.32), peds);
    this.off = this.plans.length ? bus.on('frame', () => this.update()) : null;
  }
  update() {
    const t = S.simT ?? 0, blink = (performance.now() / 1000 % 1) < 0.55;
    // (the protected-left time, 3, shows red)
    if (this.veh) this.paint(this.veh, d => { const l = signalFor(d.J, d.arm, t); return d.lamp === 0 ? l === 0 || l === 3 : d.lamp === 1 ? l === 1 : l === 2; }, (d, on) => { const c = VC[d.lamp][on ? 1 : 0]; _c.setRGB(c[0], c[1], c[2]); });
    if (this.ped) this.paint(this.ped, d => { const w = walkFor(d.J, t); return w === 2 ? 2 : w === 1 ? (blink ? 1 : 0) : 1; }, (d, v) => { if (v === 2) _c.setRGB(3.2, 3.6, 3.9); else if (v === 1) _c.setRGB(5.5, 1.7, 0.25); else _c.setRGB(0.05, 0.02, 0.01); });
  }
  paint(set, state, colour) {
    let dirty = false;
    set.list.forEach((d, k) => { const v = +state(d); if (set.state[k] === v) return; set.state[k] = v; dirty = true; colour(d, v); set.im.setColorAt(k, _c); });
    if (dirty) set.im.instanceColor.needsUpdate = true;
  }
  dispose() { this.off?.(); for (const o of this.group.children) { o.geometry?.dispose(); o.material?.dispose?.(); } }
}

/**
 * Stop signs, one instanced draw: a 0.76 m octagon (red, a white border, STOP) facing the traffic on +z, its grey back
 * on −z, an ALL WAY plaque under it at an all-way stop. From one small canvas texture; the octagon cut by alpha.
 */
function stopSigns(faces) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const g = cv.getContext('2d');
  const oct = (cx, cy, r) => { g.beginPath(); for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); };
  g.fillStyle = '#ffffff'; oct(128, 128, 124); g.fill();
  g.fillStyle = '#c4161c'; oct(128, 128, 112); g.fill();
  g.fillStyle = '#ffffff'; g.font = 'bold 74px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STOP', 128, 132);
  g.fillStyle = '#8d939a'; oct(384, 64, 60); g.fill();                      // the back
  g.fillStyle = '#ffffff'; g.fillRect(260, 140, 248, 52); g.fillStyle = '#c4161c'; g.fillRect(266, 146, 236, 40);
  g.fillStyle = '#ffffff'; g.font = 'bold 30px Arial, Helvetica, sans-serif'; g.fillText('ALL WAY', 384, 167);
  g.fillStyle = '#8d939a'; g.fillRect(260, 200, 248, 52);                    // the plaque's back
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const quad = (pos, x0, y0, x1, y1, z, u0, v0, u1, v1, back) => {
    const a = [x0, y0, z], b = [x1, y0, z], c = [x1, y1, z], d = [x0, y1, z], uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const order = back ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3], P = [a, b, c, d];
    for (const k of order) { pos.p.push(...P[k]); pos.n.push(0, 0, back ? -1 : 1); pos.uv.push(...uv[k]); }
  };
  const build = plaque => {
    const pos = { p: [], n: [], uv: [] }, S = 0.38;
    quad(pos, -S, -S, S, S, 0.045, 0, 0, 0.5, 1, false);              // face (canvas v runs down: flipY handles it)
    quad(pos, S, -S, -S, S, 0.035, 324 / 512, 1 - 124 / 256, 444 / 512, 1 - 4 / 256, true);   // back: the grey octagon (centre 384, 64; r 60), mirrored
    if (plaque) { quad(pos, -0.3, -S - 0.27, 0.3, -S - 0.06, 0.045, 260 / 512, 64 / 256, 1 - 4 / 512, 116 / 256, false); quad(pos, 0.3, -S - 0.27, -0.3, -S - 0.06, 0.035, 260 / 512, 4 / 256, 1 - 4 / 512, 56 / 256, true); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.n, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(pos.uv, 2));
    return geo;
  };
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.55, metalness: 0.1 });
  const grp = new THREE.Group();
  for (const plaque of [false, true]) {
    const list = faces.filter(q => !!q.allWay === plaque); if (!list.length) continue;
    const im = new THREE.InstancedMesh(build(plaque), mat, list.length);
    list.forEach((q, k) => { _q.setFromAxisAngle(_up, q.yaw); im.setMatrixAt(k, _m.compose(_p.set(q.x, q.y, q.z), _q, _s)); });
    im.castShadow = true; im.receiveShadow = true; im.userData.smallCaster = true; im.computeBoundingSphere(); grp.add(im);
  }
  return grp;
}

/** Two crossed street name blades on a post at junction J (its two most different roads), the lower one at y. */
function cornerBlades(f, blades, J, x, z, y, nameOf) {
  const seen = new Set(), arms = [];
  for (const A of J.arms) if (!seen.has(A.id) && nameOf(A.id)) { seen.add(A.id); arms.push(A); }
  arms.slice(0, 2).forEach((A, k) => blades.push({ x, y: y + k * 0.26, z, yaw: Math.atan2(A.n.x, A.n.z), text: nameOf(A.id), small: true }));
}

/**
 * Street name signs (2026-10-05: the map's street names on the streets themselves): green blades with a white
 * border and the name in white, both faces readable, from one canvas of every name this layer shows. A blade's width
 * follows its name. One draw call.
 */
function nameSigns(blades) {
  const names = [...new Set(blades.map(b => b.text))], ROW = 64, W = 1024;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = ROW * names.length;
  const g = cv.getContext('2d'), wide = new Map();
  g.font = 'bold 40px "Highway Gothic", Arial, Helvetica, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
  names.forEach((n, i) => {
    const tw = Math.min(W - 40, Math.ceil(g.measureText(n).width) + 44), y0 = i * ROW;
    g.fillStyle = '#0b6a3c'; g.fillRect(0, y0, tw, ROW);
    g.strokeStyle = '#f3f6f2'; g.lineWidth = 3; g.strokeRect(4.5, y0 + 4.5, tw - 9, ROW - 9);
    g.fillStyle = '#ffffff'; g.fillText(n, tw / 2, y0 + ROW / 2 + 2);
    wide.set(n, tw);
  });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const P = [], N = [], UV = [];
  for (const b of blades) {
    const tw = wide.get(b.text), H = b.small ? 0.2 : 0.42, Wm = H * tw / ROW, i = names.indexOf(b.text);
    const v0 = 1 - (i + 1) * ROW / cv.height, v1 = 1 - i * ROW / cv.height, u1 = tw / W;
    const c = Math.cos(b.yaw), sn = Math.sin(b.yaw), rx = c, rz = -sn, nx = sn, nz = c;   // across the blade, its normal
    for (const side of [1, -1]) {
      const off = 0.012 * side, ox = nx * off, oz = nz * off;
      const corner = (u, v) => [b.x + rx * u * side + ox, b.y + v, b.z + rz * u * side + oz];
      const q = [corner(-Wm / 2, -H / 2), corner(Wm / 2, -H / 2), corner(Wm / 2, H / 2), corner(-Wm / 2, H / 2)];
      const uv = [[0, v0], [u1, v0], [u1, v1], [0, v1]];
      for (const k of [0, 1, 2, 0, 2, 3]) { P.push(...q[k]); N.push(nx * side, 0, nz * side); UV.push(...uv[k]); }
    }
    // its edge: a thin dark frame from the side
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.05, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 }));
  m.name = 'street-names'; m.castShadow = true; m.receiveShadow = true; m.userData.smallCaster = true;
  return m;
}
