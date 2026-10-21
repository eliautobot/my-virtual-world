// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Furniture / object geometry library. Item-local frame: +z = front, y up, origin = item centre on the floor.
// Dimensions match shared/catalog.js rects and seat slots (seat tops 0.46 m, bar stools 0.74 m, mattress 0.56 m).
// Vertex attribute aC = (linear rgb, flags) where flags = tint(1) + emit*2 (emit 1 screen, 2 night lamp, 3 neon, 4 disco).
import * as THREE from 'three';
import { AD_ASSETS, INDOOR_SIGNS, stylesOf, parseSignGeoKey } from '/shared/signs.js';

const TAU = Math.PI * 2, P = Math.PI, H = Math.PI / 2;
const s2l = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function lin(hex) { const n = parseInt(String(hex).slice(1), 16); return [s2l(((n >> 16) & 255) / 255), s2l(((n >> 8) & 255) / 255), s2l((n & 255) / 255)]; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Matrix4();

class Buf { constructor() { this.P = []; this.N = []; this.C = []; this.I = []; this.X = {}; } }

export class FB {
  constructor() { this.o = new Buf(); this.g = new Buf(); this.m = new THREE.Matrix4(); this.stack = []; this.c = [1, 1, 1, 0]; this.gl = false; this.sh = 1; this.ext = {}; }
  col(hex, tint = 0, emit = 0) { const l = lin(hex); this.c = [l[0], l[1], l[2], tint + emit * 2]; this.gl = false; return this; }
  tint(shade = '#ffffff') { return this.col(shade, 1, 0); }
  glass(hex = '#bfdcec') { const l = lin(hex); this.c = [l[0], l[1], l[2], 0]; this.gl = true; return this; }
  push(x = 0, y = 0, z = 0, yaw = 0) {
    this.stack.push(this.m.clone());
    _t.makeRotationY(yaw).setPosition(x, y, z);
    this.m.multiply(_t);
    return this;
  }
  pop() { this.m.copy(this.stack.pop()); return this; }
  buf() { return this.gl ? this.g : this.o; }
  vert(x, y, z, nx, ny, nz, shade = 1) {
    const b = this.buf();
    _v.set(x, y, z).applyMatrix4(this.m); _n.set(nx, ny, nz).transformDirection(this.m);
    b.P.push(_v.x, _v.y, _v.z); b.N.push(_n.x, _n.y, _n.z);
    const k = shade * this.sh;
    b.C.push(this.c[0] * k, this.c[1] * k, this.c[2] * k, this.c[3]);
    for (const key in this.ext) { const a = b.X[key] || (b.X[key] = []), v = this.ext[key]; for (let q = 0; q < v.length; q++) a.push(v[q]); }
    return b.P.length / 3 - 1;
  }
  tri(a, b, c) {
    const B = this.buf(), P = B.P, N = B.N;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (Math.abs(fx) + Math.abs(fy) + Math.abs(fz) < 1e-12) return;
    const d = fx * (N[a * 3] + N[b * 3] + N[c * 3]) + fy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + fz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (d < 0) B.I.push(a, c, b); else B.I.push(a, b, c);
  }
  quad(p, n) {
    const i = p.map(q => this.vert(q[0], q[1], q[2], n[0], n[1], n[2]));
    this.tri(i[0], i[1], i[2]); this.tri(i[0], i[2], i[3]);
  }
  box(x0, y0, z0, x1, y1, z1, skip = '') {
    if (x0 > x1) [x0, x1] = [x1, x0]; if (y0 > y1) [y0, y1] = [y1, y0]; if (z0 > z1) [z0, z1] = [z1, z0];
    if (!skip.includes('t')) this.quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0]);
    if (!skip.includes('b')) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
    if (!skip.includes('f')) this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
    if (!skip.includes('k')) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1]);
    if (!skip.includes('r')) this.quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]);
    if (!skip.includes('l')) this.quad([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0]);
    return this;
  }
  /** Box by centre + half extents, rotated around y. */
  boxC(cx, cy, cz, hx, hy, hz, yaw = 0, skip = '') { this.push(cx, cy, cz, yaw); this.box(-hx, -hy, -hz, hx, hy, hz, skip); this.pop(); return this; }
  /** Surface of revolution around the vertical axis at (x, z). prof = [[r, y], ...]. */
  lathe(x, z, prof, seg = 12, a0 = 0, a1 = TAU) {
    const rows = prof.length, full = Math.abs(a1 - a0 - TAU) < 1e-6, cols = seg + (full ? 0 : 1);
    const pn = prof.map((q, i) => {
      const a = prof[Math.max(0, i - 1)], b = prof[Math.min(rows - 1, i + 1)];
      const dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l];
    });
    // orient normals outward: for a profile going upward the normal is (+r); flip if the profile runs downward
    const base = this.buf().P.length / 3;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const th = a0 + (a1 - a0) * j / seg, c = Math.cos(th), s = Math.sin(th);
      let [nr, ny] = pn[i];
      const [r, y] = prof[i];
      this.vert(x + r * s, y, z + r * c, nr * s, ny, nr * c);
    }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < seg; j++) {
      const j1 = full ? (j + 1) % seg : j + 1;
      const a = base + i * cols + j, b = base + i * cols + j1, c = base + (i + 1) * cols + j, d = base + (i + 1) * cols + j1;
      this.tri(a, b, c); this.tri(b, d, c);
    }
    return this;
  }
  cyl(x, z, r, y0, y1, seg = 12, r1 = r, cap = true) {
    const prof = cap ? [[0, y0], [r, y0], [r, y0 + 1e-4], [r1, y1 - 1e-4], [r1, y1], [0, y1]] : [[r, y0], [r1, y1]];
    return this.lathe(x, z, prof, seg);
  }
  /** Cylinder between two arbitrary points. */
  rod(a, b, r, seg = 6) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
    if (L < 1e-5) return this;
    const up = new THREE.Vector3(dx / L, dy / L, dz / L);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    this.stack.push(this.m.clone());
    this.m.multiply(new THREE.Matrix4().compose(new THREE.Vector3(a[0], a[1], a[2]), q, new THREE.Vector3(1, 1, 1)));
    this.cyl(0, 0, r, 0, L, seg, r, true);
    this.pop();
    return this;
  }
  sph(x, y, z, rx, ry, rz, seg = 10, rings = 6, o = {}) {
    const base = this.buf().P.length / 3;
    const y0 = o.cut ?? -1;
    for (let i = 0; i <= rings; i++) {
      const ph = P * i / rings;
      for (let j = 0; j <= seg; j++) {
        const th = TAU * j / seg;
        let dx = Math.sin(ph) * Math.cos(th), dy = Math.cos(ph), dz = Math.sin(ph) * Math.sin(th);
        if (dy < y0) dy = y0;
        const k = o.disp ? 1 + o.disp(dx, dy, dz) : 1;
        this.vert(x + dx * rx * k, y + dy * ry * k, z + dz * rz * k, dx / rx, dy / ry, dz / rz, o.shade ? o.shade(dx, dy, dz) : 1);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = base + i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1;
      this.tri(a, b, c); this.tri(b, d, c);
    }
    return this;
  }
  build() {
    const mk = (B) => {
      if (!B.I.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.N, 3));
      g.setAttribute('aC', new THREE.Float32BufferAttribute(B.C, 4));
      const nv = B.P.length / 3;
      for (const key in B.X) g.setAttribute(key, new THREE.Float32BufferAttribute(B.X[key], B.X[key].length / nv));
      g.setIndex(B.P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(B.I, 1) : new THREE.Uint16BufferAttribute(B.I, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    };
    return { geo: mk(this.o), glass: mk(this.g) };
  }
}

// ------------------------------------------------------------------ palette + reusable parts
export const C = {
  metal: '#9aa0a8', dark: '#2a2e35', black: '#15171b', white: '#f1f0ec', chrome: '#d2d6dc', wood: '#a87a50', woodD: '#6e4a31',
  woodL: '#d6b88f', fabric: '#4b5563', screen: '#8cc6ff', stone: '#d8d4cc', leaf: '#4f8a3c', soil: '#5a4030', pot: '#c2703f',
  gray: '#7b8088', paper: '#fbfbf7', steel: '#b9bec5', lamp: '#ffe2a8',
};
function officeChair(f, x, z, yaw, seat = '#30343b') {
  f.push(x, 0, z, yaw); f.push(0, 0, -0.04);
  f.col(C.dark);
  for (let k = 0; k < 5; k++) { const a = k * TAU / 5 + 0.3; f.rod([0, 0.07, 0], [Math.sin(a) * 0.28, 0.045, Math.cos(a) * 0.28], 0.018, 5); f.sph(Math.sin(a) * 0.28, 0.025, Math.cos(a) * 0.28, 0.025, 0.025, 0.025, 6, 3); }
  f.col(C.chrome); f.cyl(0, 0, 0.028, 0.07, 0.4, 8);
  f.col(seat); f.box(-0.24, 0.4, -0.23, 0.24, 0.47, 0.22);
  f.box(-0.22, 0.52, -0.3, 0.22, 0.98, -0.245);
  f.col(C.dark); f.rod([0, 0.42, -0.2], [0, 0.58, -0.275], 0.02, 5);
  for (const s of [-1, 1]) { f.box(0.23 * s - 0.03, 0.6, -0.16, 0.23 * s + 0.03, 0.625, 0.1); f.rod([0.23 * s, 0.45, -0.06], [0.23 * s, 0.6, -0.06], 0.012, 4); }
  f.pop(); f.pop();
}
function chair(f, x, z, yaw, seat = '#3c4048', frame = C.woodD, tint = 0) {
  f.push(x, 0, z, yaw); f.push(0, 0, -0.04);
  f.col(frame);
  for (const [a, b] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) f.box(a - 0.018, 0, b - 0.018, a + 0.018, 0.42, b + 0.018, 'b');
  f.box(-0.19, 0.46, -0.215, -0.16, 0.86, -0.185); f.box(0.16, 0.46, -0.215, 0.19, 0.86, -0.185);
  if (tint) f.tint(); else f.col(seat);
  f.box(-0.21, 0.42, -0.2, 0.21, 0.46, 0.2);
  f.box(-0.18, 0.62, -0.215, 0.18, 0.84, -0.19);
  f.pop(); f.pop();
}
function stool(f, x, z) {
  f.col(C.dark); f.cyl(x, z, 0.2, 0, 0.03, 12); f.cyl(x, z, 0.026, 0.03, 0.7, 8);
  f.col(C.chrome); f.lathe(x, z, [[0.16, 0.3], [0.17, 0.3], [0.17, 0.315], [0.16, 0.315]], 12);
  f.col('#7a2f2a'); f.cyl(x, z, 0.19, 0.7, 0.745, 14);
}
function laptop(f, x, y, z, yaw = 0) {
  f.push(x, y, z, yaw);
  f.col('#9ba1a8'); f.box(-0.17, 0, -0.12, 0.17, 0.018, 0.12);
  f.push(0, 0.018, -0.12, 0); f.m.multiply(new THREE.Matrix4().makeRotationX(-0.28));
  f.box(-0.17, 0, -0.012, 0.17, 0.23, 0); f.col(C.screen, 0, 1); f.box(-0.155, 0.015, 0.0, 0.155, 0.215, 0.003);
  f.pop(); f.pop();
}
/**
 * A workstation's one large monitor (a 27-inch class screen, 2026-10-18): its picture MON.w × MON.h, the picture's lower
 * edge MON.y0 above the floor (desk tops are at 0.755), the picture's face MON.z in front of the monitor's own origin.
 * An agent's PC is drawn exactly over that picture for its owner (render/pc-screens.js, SCREENS below).
 */
export const MON = Object.freeze({ w: 0.62, h: 0.35, y0: 0.99, z: 0.012 });
function bigMonitor(f, x, z, yaw = 0) {
  const W = MON.w / 2, y0 = MON.y0, y1 = MON.y0 + MON.h;
  f.push(x, 0, z, yaw);
  f.col(C.dark); f.box(-0.13, 0.755, -0.17, 0.13, 0.764, 0.0);                 // the foot
  f.col('#3a3f47'); f.box(-0.032, 0.764, -0.12, 0.032, y0 + 0.1, -0.085);      // the neck
  f.col('#2b2f36'); f.box(-W + 0.06, y0 + 0.03, -0.07, W - 0.06, y1 - 0.04, -0.03);   // the back
  f.col(C.black); f.box(-W - 0.011, y0 - 0.02, -0.03, W + 0.011, y1 + 0.011, 0.008);   // the panel: thin bezels, a chin
  f.col(C.screen, 0, 1); f.box(-W, y0, 0.008, W, y1, MON.z);                     // the picture
  f.col('#8d96a3', 0, 1); f.box(-0.012, y0 - 0.013, 0.008, 0.012, y0 - 0.009, 0.0105);   // its light
  f.pop();
}
function mug(f, x, y, z, col = C.white) { f.col(col); f.cyl(x, z, 0.04, y, y + 0.1, 10); f.col('#3e2718'); f.cyl(x, z, 0.034, y + 0.085, y + 0.092, 10); }
function potPlant(f, x, z, s = 1, potCol = C.pot) {
  f.col(potCol); f.lathe(x, z, [[0, 0.0], [0.16 * s, 0.0], [0.2 * s, 0.34 * s], [0.21 * s, 0.36 * s], [0.18 * s, 0.36 * s], [0, 0.33 * s]], 12);
  f.col(C.soil); f.cyl(x, z, 0.18 * s, 0.3 * s, 0.33 * s, 10);
  f.tint(); const leafShade = (dx, dy) => 0.7 + 0.3 * dy;
  f.col('#4d8f3f');
  f.sph(x, 0.58 * s, z, 0.26 * s, 0.26 * s, 0.26 * s, 9, 6, { shade: leafShade, disp: (a, b, c) => 0.12 * Math.sin(a * 7) * Math.sin(b * 6 + 1) * Math.sin(c * 7 + 2) });
  f.col('#5a9e48'); f.sph(x + 0.08 * s, 0.76 * s, z - 0.05 * s, 0.16 * s, 0.16 * s, 0.16 * s, 7, 5, { shade: leafShade });
}
function books(f, x0, x1, y, z0, z1, seed) {
  const r = rng(seed), cols = ['#8c2f2f', '#2f5d8c', '#2f8c5a', '#c9a227', '#6b3f8c', '#d9d4c7', '#1f2a44', '#b5651d', '#3d6b6b', '#a33b5b'];
  let x = x0 + 0.01;
  while (x < x1 - 0.03) {
    const w = 0.022 + r() * 0.035, h = 0.18 + r() * 0.12;
    if (r() < 0.08) { x += 0.05; continue; }
    f.col(cols[Math.floor(r() * cols.length)]);
    f.box(x, y, z0 + r() * 0.02, Math.min(x + w, x1), y + h, z1);
    x += w + 0.003;
  }
}
function products(f, x0, x1, y, z0, z1, seed, hmax = 0.22) {
  const r = rng(seed), cols = ['#e63946', '#f1c453', '#2a9d8f', '#457b9d', '#f4a261', '#e9e4d8', '#8ab17d', '#b56576', '#264653', '#ffb4a2', '#6d597a'];
  let x = x0 + 0.02;
  while (x < x1 - 0.06) {
    const w = 0.07 + r() * 0.12, h = 0.08 + r() * hmax, c = cols[Math.floor(r() * cols.length)];
    f.col(c);
    if (r() < 0.35) f.cyl(x + w / 2, (z0 + z1) / 2, Math.min(w, z1 - z0) * 0.4, y, y + h, 8);
    else f.box(x, y, z0 + 0.02, Math.min(x + w, x1 - 0.01), y + h, z1 - 0.02);
    x += w + 0.015;
  }
}
function leafShade(dx, dy) { return 0.62 + 0.38 * Math.max(0, dy * 0.5 + 0.5); }
function noise3(a, b, c, k) { return Math.sin(a * 5.1 + k) * Math.sin(b * 4.3 + k * 1.7) * Math.sin(c * 5.7 + k * 0.6); }

// ------------------------------------------------------------------ item definitions
const D = {};
D.desk = f => {
  // (2026-10-18: one large monitor, so its agent's PC is a screen its owner can read and use — render/pc-screens.js)
  f.tint(); f.box(-0.7, 0.722, -0.37, 0.7, 0.755, 0.37);
  f.col('#2a2d33'); f.box(-0.7, 0.708, 0.35, 0.7, 0.722, 0.37);
  f.col(C.dark);
  for (const s of [-1, 1]) { f.box(0.6 * s - 0.028, 0.03, -0.03, 0.6 * s + 0.028, 0.722, 0.03); f.box(0.6 * s - 0.035, 0, -0.33, 0.6 * s + 0.035, 0.03, 0.33); }
  f.box(-0.6, 0.66, -0.31, 0.6, 0.705, -0.28);
  f.col('#3a3f47'); f.box(-0.38, 0.6, -0.33, 0.38, 0.62, -0.2);                  // the cable tray
  f.col('#30343b'); f.box(-0.44, 0.755, -0.02, 0.44, 0.759, 0.31);              // the desk mat
  f.col('#1f2329'); f.box(-0.22, 0.759, 0.07, 0.16, 0.772, 0.2);                // the keyboard
  f.col('#454b55'); f.box(-0.21, 0.772, 0.08, 0.15, 0.775, 0.19);
  f.col('#1f2329'); f.box(0.24, 0.759, 0.1, 0.3, 0.781, 0.19);                  // the mouse
  bigMonitor(f, 0, -0.16);
  mug(f, -0.55, 0.755, 0.12);
  f.col('#b5432f'); f.box(0.42, 0.755, -0.02, 0.63, 0.773, 0.27); f.col(C.paper); f.box(0.427, 0.773, -0.013, 0.623, 0.775, 0.263);   // a notebook
  potPlant(f, 0.56, -0.26, 0.3);
  officeChair(f, 0, 0.58, P);
};
D.desk_l = f => {
  f.tint(); f.box(-0.9, 0.72, -0.45, 0.9, 0.755, 0.2); f.box(0.4, 0.72, 0.2, 0.9, 0.755, 0.95);
  f.col(C.metal); f.box(-0.89, 0, -0.4, -0.85, 0.72, 0.15); f.box(0.85, 0, -0.4, 0.89, 0.72, 0.9); f.box(0.42, 0, 0.86, 0.85, 0.72, 0.9);
  bigMonitor(f, 0, -0.26);
  f.col('#1f2329'); f.box(-0.2, 0.755, -0.04, 0.18, 0.768, 0.09); f.col('#454b55'); f.box(-0.19, 0.768, -0.03, 0.17, 0.771, 0.08);
  f.col('#1f2329'); f.box(0.26, 0.755, -0.02, 0.32, 0.777, 0.07);
  f.col(C.paper); f.box(0.5, 0.755, 0.4, 0.8, 0.765, 0.7); f.col('#3a6ea5'); f.box(0.52, 0.765, 0.45, 0.78, 0.775, 0.65);   // papers, a folder
  f.col(C.dark); f.cyl(0.72, -0.28, 0.07, 0.755, 0.77, 10); f.rod([0.72, 0.77, -0.28], [0.62, 1.12, -0.2], 0.012);   // a desk lamp
  f.col(C.lamp, 0, 2); f.lathe(0.6, -0.15, [[0.04, 1.15], [0.1, 1.07], [0.1, 1.06], [0.03, 1.14]], 10);
  potPlant(f, -0.72, -0.25, 0.45, '#e8e4dc');
  officeChair(f, 0, 0.6, P, '#26313f');
};
D.desk_exec = f => {
  f.tint(); f.box(-1.0, 0.72, -0.48, 1.0, 0.77, 0.42);
  f.tint('#d8d8d8'); f.box(-0.98, 0, -0.45, -0.62, 0.72, 0.38); f.box(0.62, 0, -0.45, 0.98, 0.72, 0.38); f.box(-0.62, 0.25, -0.44, 0.62, 0.72, -0.4);
  f.col('#c9a45a'); for (const s of [-1, 1]) for (const y of [0.2, 0.45, 0.62]) f.box(0.8 * s - 0.06, y, 0.38, 0.8 * s + 0.06, y + 0.02, 0.395);
  laptop(f, 0, 0.77, 0.0);
  f.col(C.dark); f.cyl(-0.72, -0.25, 0.08, 0.77, 0.79, 10); f.rod([-0.72, 0.79, -0.25], [-0.62, 1.1, -0.2], 0.012);
  f.col(C.lamp, 0, 2); f.lathe(-0.6, -0.17, [[0.04, 1.14], [0.1, 1.06], [0.1, 1.05], [0.03, 1.13]], 10);
  f.col(C.paper); f.box(0.4, 0.77, -0.2, 0.65, 0.785, 0.1);
  f.push(0, 0, 0.66, P); f.push(0, 0, -0.04);
  f.col(C.dark); for (let k = 0; k < 5; k++) { const a = k * TAU / 5 + 0.3; f.rod([0, 0.07, 0], [Math.sin(a) * 0.3, 0.045, Math.cos(a) * 0.3], 0.02, 5); }
  f.col(C.chrome); f.cyl(0, 0, 0.03, 0.07, 0.4, 8);
  f.col('#3b2418'); f.box(-0.27, 0.4, -0.25, 0.27, 0.48, 0.24); f.box(-0.25, 0.5, -0.33, 0.25, 1.18, -0.25);
  for (const s of [-1, 1]) f.box(0.27 * s - 0.04, 0.48, -0.25, 0.27 * s + 0.04, 0.66, 0.14);
  f.pop(); f.pop();
};
D.standing_desk = f => {
  f.tint(); f.box(-0.7, 1.02, -0.37, 0.7, 1.05, 0.37);
  f.col(C.dark); for (const s of [-1, 1]) { f.box(0.6 * s - 0.03, 0, -0.03, 0.6 * s + 0.03, 1.02, 0.03); f.box(0.6 * s - 0.035, 0, -0.33, 0.6 * s + 0.035, 0.03, 0.33); }
  f.push(0, 0.29, 0); bigMonitor(f, 0, -0.16); f.pop();
  f.col('#3a3f47'); f.box(-0.22, 1.05, 0.02, 0.22, 1.066, 0.15);
  mug(f, 0.45, 1.05, 0.1, '#2a9d8f');
};
D.meeting_table = f => {
  f.tint(); f.box(-1.2, 0.72, -0.6, 1.2, 0.76, 0.6);
  f.lathe(-1.2, 0, [[0, 0.72], [0.6, 0.72], [0.6, 0.76], [0, 0.76]], 16, P, TAU);
  f.lathe(1.2, 0, [[0, 0.72], [0.6, 0.72], [0.6, 0.76], [0, 0.76]], 16, 0, P);
  f.col(C.dark); for (const s of [-1, 1]) { f.box(0.75 * s - 0.08, 0, -0.08, 0.75 * s + 0.08, 0.72, 0.08); f.box(0.75 * s - 0.1, 0, -0.35, 0.75 * s + 0.1, 0.03, 0.35); }
  f.col('#23262b'); f.cyl(0, 0, 0.1, 0.76, 0.79, 3);
  laptop(f, -0.9, 0.76, 0.3, P); laptop(f, 0.9, 0.76, -0.3, 0); mug(f, 0.15, 0.76, 0.35); mug(f, -0.3, 0.76, -0.38);
  f.col(C.paper); f.box(0.3, 0.76, -0.45, 0.52, 0.765, -0.15);
  for (const x of [-0.9, 0, 0.9]) { officeChair(f, x, 1.0, P, '#394150'); officeChair(f, x, -1.0, 0, '#394150'); }
  officeChair(f, 1.78, 0, -H, '#394150'); officeChair(f, -1.78, 0, H, '#394150');
};
D.whiteboard = f => {
  f.col(C.steel); f.box(-0.95, 0.88, -0.08, 0.95, 2.02, -0.02);
  f.col('#fbfcfd', 0, 1); f.box(-0.92, 0.91, -0.02, 0.92, 1.99, -0.015);
  f.col(C.steel); f.box(-0.8, 0.86, -0.08, 0.8, 0.88, 0.03);
  const r = rng(7), ink = ['#2f5d8c', '#c0392b', '#2a9d8f', '#222222'];
  for (let k = 0; k < 9; k++) { f.col(ink[k % 4]); const x = -0.8 + r() * 1.0, y = 1.1 + r() * 0.8; f.box(x, y, -0.015, x + 0.2 + r() * 0.45, y + 0.012, -0.012); }
  f.col('#e9c46a'); f.box(0.35, 1.45, -0.015, 0.55, 1.65, -0.011); f.col('#90be6d'); f.box(0.6, 1.3, -0.015, 0.78, 1.48, -0.011);
};
D.tv_wall = f => {
  f.col(C.black); f.box(-0.95, 1.0, -0.08, 0.95, 2.0, -0.02);
  f.col('#5a9fe0', 0, 1); f.box(-0.91, 1.04, -0.02, 0.91, 1.96, -0.016);
  f.col('#e9f1fa', 0, 1); f.box(-0.7, 1.6, -0.016, 0.2, 1.7, -0.013); f.box(-0.7, 1.35, -0.016, 0.6, 1.4, -0.013);
};
D.printer = f => {
  f.col('#d9dcdf'); f.box(-0.42, 0, -0.28, 0.42, 0.62, 0.28);
  f.col('#e8eaec'); f.box(-0.4, 0.62, -0.26, 0.4, 1.02, 0.26);
  f.col(C.dark); f.box(-0.34, 0.8, 0.26, 0.34, 0.83, 0.3); f.col(C.paper); f.box(-0.18, 1.02, -0.12, 0.18, 1.04, 0.14);
  f.col('#4caf50', 0, 1); f.box(0.2, 0.96, 0.26, 0.34, 1.0, 0.27);
  for (let k = 0; k < 2; k++) { f.col(C.gray); f.box(-0.3, 0.12 + k * 0.24, 0.28, 0.3, 0.14 + k * 0.24, 0.29); }
};
D.bookshelf = f => {
  f.tint();
  f.box(-0.8, 0, -0.2, -0.77, 2.0, 0.2); f.box(0.77, 0, -0.2, 0.8, 2.0, 0.2); f.box(-0.8, 1.97, -0.2, 0.8, 2.0, 0.2); f.box(-0.77, 0, -0.2, 0.77, 2.0, -0.18);
  for (let k = 0; k < 5; k++) { f.tint(); f.box(-0.77, 0.06 + k * 0.4, -0.18, 0.77, 0.085 + k * 0.4, 0.2); books(f, -0.77, 0.77, 0.085 + k * 0.4, -0.16, 0.14, 11 + k); }
};
D.filing = f => {
  f.col('#8d949c'); f.box(-0.25, 0, -0.3, 0.25, 1.3, 0.3);
  for (let k = 0; k < 4; k++) { f.col('#9ba2aa'); f.box(-0.23, 0.05 + k * 0.315, 0.3, 0.23, 0.33 + k * 0.315, 0.31); f.col(C.chrome); f.box(-0.07, 0.25 + k * 0.315, 0.31, 0.07, 0.27 + k * 0.315, 0.33); }
};
D.phone_booth = f => {
  f.col('#2f5d62');
  f.box(-0.6, 0, -0.6, 0.6, 2.2, -0.54); f.box(-0.6, 0, -0.54, -0.54, 2.2, 0.6); f.box(0.54, 0, -0.54, 0.6, 2.2, 0.6); f.box(-0.6, 2.14, -0.54, 0.6, 2.2, 0.6);
  f.col('#e9c46a'); f.box(-0.54, 0, -0.54, 0.54, 0.38, -0.3); f.col('#d9a441'); f.box(-0.5, 0.38, -0.54, 0.5, 0.46, -0.2);
  f.col('#8a6242'); f.box(-0.45, 0.72, 0.15, 0.45, 0.75, 0.4);
  f.col(C.lamp, 0, 2); f.box(-0.3, 2.1, -0.2, 0.3, 2.14, 0.2);
  f.glass(); f.box(-0.54, 0.02, 0.58, 0.54, 2.12, 0.6);
};
D.server_rack = f => {
  f.col('#1b1d22'); f.box(-0.32, 0, -0.5, 0.32, 2.0, 0.5);
  f.col('#2b2f36'); for (let k = 0; k < 12; k++) f.box(-0.29, 0.12 + k * 0.15, 0.5, 0.29, 0.24 + k * 0.15, 0.51);
  const r = rng(3);
  for (let k = 0; k < 24; k++) { f.col(r() < 0.7 ? '#39ff88' : '#58a6ff', 0, 1); const y = 0.16 + Math.floor(k / 2) * 0.15, x = -0.24 + (k % 2) * 0.05 + r() * 0.3; f.box(x, y, 0.51, x + 0.02, y + 0.012, 0.515); }
};
function sofa(f, w, n) {
  const hw = w / 2;
  f.tint(); f.box(-hw, 0.1, -0.45, hw, 0.38, 0.45);
  f.box(-hw, 0.38, -0.45, hw, 0.85, -0.2);
  f.box(-hw, 0.38, -0.45, -hw + 0.14, 0.62, 0.45); f.box(hw - 0.14, 0.38, -0.45, hw, 0.62, 0.45);
  const cw = (w - 0.28) / n;
  for (let k = 0; k < n; k++) {
    f.tint('#f4f4f4'); f.box(-hw + 0.14 + k * cw + 0.01, 0.38, -0.2, -hw + 0.14 + (k + 1) * cw - 0.01, 0.45, 0.44);
    f.tint('#f0f0f0'); f.box(-hw + 0.14 + k * cw + 0.02, 0.45, -0.22, -hw + 0.14 + (k + 1) * cw - 0.02, 0.8, -0.1);
  }
  f.col(C.woodD); for (const [x, z] of [[-hw + 0.06, -0.39], [hw - 0.06, -0.39], [-hw + 0.06, 0.39], [hw - 0.06, 0.39]]) f.cyl(x, z, 0.025, 0, 0.1, 6);
}
D.sofa = f => sofa(f, 2.1, 3);
D.sofa_l = f => sofa(f, 2.8, 4);
D.armchair = f => {
  f.tint(); f.box(-0.45, 0.1, -0.45, 0.45, 0.38, 0.45); f.box(-0.45, 0.38, -0.45, 0.45, 0.88, -0.22);
  f.box(-0.45, 0.38, -0.45, -0.32, 0.62, 0.45); f.box(0.32, 0.38, -0.45, 0.45, 0.62, 0.45);
  f.tint('#f4f4f4'); f.box(-0.31, 0.38, -0.22, 0.31, 0.45, 0.43); f.box(-0.3, 0.45, -0.24, 0.3, 0.82, -0.12);
  f.col(C.woodD); for (const [x, z] of [[-0.39, -0.39], [0.39, -0.39], [-0.39, 0.39], [0.39, 0.39]]) f.cyl(x, z, 0.025, 0, 0.1, 6);
};
D.beanbag = f => {
  f.tint();
  f.sph(0, 0.2, 0.02, 0.44, 0.22, 0.42, 14, 8, { cut: -0.6, disp: (x, y, z) => (y > 0.2 && z > -0.2 ? -0.25 * (y - 0.2) : 0) });
  f.sph(0, 0.38, -0.24, 0.36, 0.26, 0.2, 12, 7);
};
D.coffee_table = f => {
  f.col(C.woodL); f.box(-0.6, 0.38, -0.33, 0.6, 0.42, 0.33);
  f.col(C.dark); for (const [x, z] of [[-0.54, -0.27], [0.54, -0.27], [-0.54, 0.27], [0.54, 0.27]]) f.box(x - 0.02, 0, z - 0.02, x + 0.02, 0.38, z + 0.02);
  f.col(C.woodD); f.box(-0.55, 0.12, -0.28, 0.55, 0.14, 0.28);
  f.col('#c0392b'); f.box(-0.35, 0.42, -0.1, -0.1, 0.43, 0.15); f.col('#2f5d8c'); f.box(-0.33, 0.43, -0.08, -0.12, 0.44, 0.12);
  mug(f, 0.25, 0.42, 0.05);
};
D.rug = f => { f.tint('#cfcfcf'); f.box(-1.3, 0, -0.9, 1.3, 0.008, 0.9, 'b'); f.tint(); f.box(-1.15, 0, -0.75, 1.15, 0.012, 0.75, 'b'); };
D.tv_stand = f => {
  f.col(C.woodD); f.box(-0.95, 0.05, -0.25, 0.95, 0.5, 0.25);
  f.col(C.dark); f.box(-0.93, 0, -0.23, -0.88, 0.05, 0.23); f.box(0.88, 0, -0.23, 0.93, 0.05, 0.23);
  f.col('#8a6242'); f.box(-0.9, 0.08, 0.25, -0.02, 0.47, 0.26); f.box(0.02, 0.08, 0.25, 0.9, 0.47, 0.26);
  f.col(C.black); f.box(-0.05, 0.5, -0.1, 0.05, 0.6, -0.04); f.box(-0.25, 0.5, -0.15, 0.25, 0.51, 0.0);
  f.box(-0.78, 0.6, -0.08, 0.78, 1.3, -0.04);
  f.col('#4f86c6', 0, 1); f.box(-0.75, 0.63, -0.04, 0.75, 1.27, -0.036);
  f.col('#bfe0ff', 0, 1); f.box(-0.5, 0.85, -0.036, 0.1, 1.1, -0.033);
};
D.plant = f => potPlant(f, 0, 0, 1.0);
D.plant_tall = f => {
  f.col('#e8e4dc'); f.lathe(0, 0, [[0, 0], [0.2, 0], [0.26, 0.5], [0.27, 0.52], [0.23, 0.52], [0, 0.48]], 14);
  f.col(C.soil); f.cyl(0, 0, 0.23, 0.44, 0.48, 10);
  f.col('#6b4a33'); f.rod([0, 0.46, 0], [0.03, 1.35, 0.02], 0.025);
  f.tint();
  f.col('#3f7f3a');
  const r = rng(5);
  for (let k = 0; k < 9; k++) {
    const a = k * 2.4, y = 0.9 + r() * 0.95, rad = 0.1 + r() * 0.16;
    f.sph(Math.sin(a) * rad, y, Math.cos(a) * rad, 0.15, 0.1, 0.15, 7, 4, { shade: leafShade });
  }
};
D.floor_lamp = f => {
  f.col(C.dark); f.cyl(0, 0, 0.16, 0, 0.03, 14); f.cyl(0, 0, 0.015, 0.03, 1.45, 6);
  f.col(C.lamp, 0, 2); f.lathe(0, 0, [[0.12, 1.7], [0.19, 1.42], [0.2, 1.42], [0.13, 1.7]], 14);
};
D.pingpong = f => {
  f.col('#1f4e79'); f.box(-0.76, 0.72, -1.37, 0.76, 0.76, 1.37);
  f.col(C.white); f.box(-0.76, 0.76, -1.37, -0.73, 0.762, 1.37); f.box(0.73, 0.76, -1.37, 0.76, 0.762, 1.37);
  f.box(-0.76, 0.76, -1.37, 0.76, 0.762, -1.34); f.box(-0.76, 0.76, 1.34, 0.76, 0.762, 1.37); f.box(-0.006, 0.76, -1.37, 0.006, 0.762, 1.37);
  f.col('#e8e8e8'); f.box(-0.83, 0.76, -0.005, 0.83, 0.915, 0.005); f.col(C.dark); f.box(-0.84, 0.76, -0.02, -0.8, 0.93, 0.02); f.box(0.8, 0.76, -0.02, 0.84, 0.93, 0.02);
  f.col(C.dark); for (const [x, z] of [[-0.6, -1.1], [0.6, -1.1], [-0.6, 1.1], [0.6, 1.1]]) f.box(x - 0.03, 0, z - 0.03, x + 0.03, 0.72, z + 0.03);
};
D.arcade = f => {
  f.tint(); f.box(-0.4, 0, -0.4, 0.4, 1.8, 0.2); f.box(-0.4, 0, 0.2, 0.4, 0.9, 0.4);
  f.col(C.black); f.push(0, 1.3, 0.22, 0); f.m.multiply(new THREE.Matrix4().makeRotationX(-0.25)); f.box(-0.34, -0.25, -0.02, 0.34, 0.25, 0.0);
  f.col('#7b2ff7', 0, 1); f.box(-0.3, -0.21, 0.0, 0.3, 0.21, 0.005); f.col('#ffd166', 0, 1); f.box(-0.1, -0.05, 0.005, 0.12, 0.08, 0.008); f.pop();
  f.col(C.dark); f.push(0, 0.95, 0.3, 0); f.m.multiply(new THREE.Matrix4().makeRotationX(0.35)); f.box(-0.4, -0.05, -0.12, 0.4, 0.02, 0.12);
  f.col('#ef476f'); f.cyl(0.08, 0, 0.025, 0.02, 0.04, 8); f.col('#06d6a0'); f.cyl(0.16, 0.03, 0.025, 0.02, 0.04, 8); f.col('#ffd166'); f.cyl(0.24, -0.02, 0.025, 0.02, 0.04, 8);
  f.col(C.black); f.cyl(-0.18, 0, 0.012, 0.02, 0.1, 6); f.col('#e63946'); f.sph(-0.18, 0.11, 0, 0.03, 0.03, 0.03, 8, 5); f.pop();
  f.col('#ff9f1c', 0, 3); f.box(-0.38, 1.62, 0.2, 0.38, 1.78, 0.22);
};
D.piano = f => {
  f.col('#111215'); f.box(-0.75, 0, -0.35, 0.75, 1.3, 0.05); f.box(-0.78, 0.66, 0.05, 0.78, 0.72, 0.3);
  f.box(-0.78, 0, 0.05, -0.72, 0.72, 0.3); f.box(0.72, 0, 0.05, 0.78, 0.72, 0.3);
  f.col('#f8f8f4'); f.box(-0.7, 0.72, 0.1, 0.7, 0.74, 0.28);
  f.col('#111215'); for (let k = 0; k < 36; k++) { if ([2, 6, 9, 13, 16].includes(k % 7 === 0 ? 99 : k % 7)) continue; const x = -0.69 + k * 0.0385; if (k % 7 === 2 || k % 7 === 6) continue; f.box(x + 0.024, 0.74, 0.1, x + 0.036, 0.755, 0.2); }
  f.col('#1c1d21'); f.box(-0.5, 1.05, 0.05, 0.5, 1.3, 0.08); f.col(C.paper); f.box(-0.18, 1.02, 0.08, 0.18, 1.22, 0.1);
  f.col('#111215'); f.box(-0.4, 0.44, 0.47, 0.4, 0.49, 0.77);
  for (const [x, z] of [[-0.36, 0.5], [0.36, 0.5], [-0.36, 0.74], [0.36, 0.74]]) f.box(x - 0.02, 0, z - 0.02, x + 0.02, 0.44, z + 0.02);
};
D.kitchen = f => {
  f.tint(); f.box(-1.5, 0.08, -0.33, 1.5, 0.88, 0.3);
  f.col(C.dark); f.box(-1.48, 0, -0.3, 1.48, 0.08, 0.26);
  f.col('#e5e2dc'); f.box(-1.5, 0.88, -0.33, 1.5, 0.92, 0.33);
  f.col('#dfe7ea'); f.box(-1.5, 0.92, -0.33, 1.5, 1.45, -0.31);
  f.tint(); f.box(-1.5, 1.45, -0.33, 1.5, 2.2, 0.0);
  f.col(C.chrome); for (let k = 0; k < 6; k++) { const x = -1.25 + k * 0.5; f.box(x - 0.08, 0.78, 0.3, x + 0.08, 0.8, 0.32); f.box(x - 0.08, 1.52, 0.0, x + 0.08, 1.54, 0.02); }
  f.col('#aab0b6'); f.box(-1.05, 0.86, -0.2, -0.45, 0.922, 0.2); f.col('#5d6670'); f.box(-1.0, 0.8, -0.16, -0.5, 0.923, 0.16);
  f.col(C.chrome); f.rod([-0.75, 0.92, -0.25], [-0.75, 1.15, -0.25], 0.015); f.rod([-0.75, 1.15, -0.25], [-0.75, 1.12, -0.05], 0.012);
  f.col('#1b1c1f'); f.box(0.4, 0.92, -0.26, 1.1, 0.935, 0.26);
  f.col('#3a3d42'); for (const [x, z] of [[0.58, -0.12], [0.92, -0.12], [0.58, 0.13], [0.92, 0.13]]) f.cyl(x, z, 0.08, 0.935, 0.94, 12);
  f.col('#23262a'); f.box(0.42, 0.12, 0.3, 1.08, 0.78, 0.31); f.col('#e07a2f', 0, 1); f.box(0.5, 0.2, 0.31, 1.0, 0.6, 0.312);
  f.col(C.steel); f.lathe(0.75, -0.12, [[0.32, 1.45], [0.36, 1.6], [0.1, 1.9], [0.1, 2.2]], 4);
};
D.counter = f => {
  f.tint(); f.box(-0.9, 0.08, -0.33, 0.9, 0.9, 0.3); f.col(C.dark); f.box(-0.88, 0, -0.3, 0.88, 0.08, 0.26);
  f.col('#e5e2dc'); f.box(-0.9, 0.9, -0.33, 0.9, 0.94, 0.33);
  f.col(C.chrome); for (const x of [-0.45, 0.45]) f.box(x - 0.08, 0.8, 0.3, x + 0.08, 0.82, 0.32);
  f.col('#c9a66b'); f.box(-0.3, 0.94, -0.15, 0.15, 0.96, 0.15); f.col('#e63946'); f.sph(0.4, 0.99, 0.0, 0.05, 0.05, 0.05, 8, 5);
};
D.fridge = f => {
  f.col('#c9ced4'); f.box(-0.4, 0, -0.36, 0.4, 1.9, 0.33);
  f.col('#d8dde2'); f.box(-0.38, 1.22, 0.33, 0.38, 1.88, 0.36); f.box(-0.38, 0.03, 0.33, 0.38, 1.19, 0.36);
  f.col(C.dark); f.box(0.3, 1.3, 0.36, 0.33, 1.7, 0.39); f.box(0.3, 0.7, 0.36, 0.33, 1.1, 0.39);
};
D.coffee_machine = f => {
  f.tint('#8a6242'); f.box(-0.45, 0, -0.3, 0.45, 0.9, 0.3); f.col('#e5e2dc'); f.box(-0.45, 0.9, -0.3, 0.45, 0.93, 0.3);
  f.col('#c9ced4'); f.box(-0.3, 0.93, -0.25, 0.2, 1.42, 0.12); f.col(C.dark); f.box(-0.25, 1.05, 0.12, 0.15, 1.1, 0.2);
  f.col('#39ff88', 0, 1); f.box(0.08, 1.3, 0.12, 0.16, 1.34, 0.125);
  mug(f, -0.12, 0.93, 0.1); mug(f, 0.32, 0.93, 0.05, '#c0392b'); mug(f, 0.32, 1.03, 0.05, '#2f5d8c');
};
D.water_cooler = f => {
  f.col('#eef0f2'); f.box(-0.2, 0, -0.2, 0.2, 0.95, 0.2);
  f.col(C.dark); f.box(-0.12, 0.72, 0.2, 0.12, 0.8, 0.22); f.col('#3a86ff'); f.box(-0.08, 0.83, 0.2, -0.02, 0.86, 0.23); f.col('#e63946'); f.box(0.02, 0.83, 0.2, 0.08, 0.86, 0.23);
  f.glass('#7fb8e6'); f.lathe(0, 0, [[0.03, 0.95], [0.14, 1.0], [0.15, 1.2], [0.1, 1.25], [0, 1.25]], 12);
};
D.vending = f => {
  f.col('#c0392b'); f.box(-0.5, 0, -0.4, 0.5, 1.95, 0.36);
  f.col('#1b1c1f'); f.box(-0.44, 0.35, 0.36, 0.2, 1.85, 0.38);
  const r = rng(9), cols = ['#e63946', '#f1c453', '#2a9d8f', '#457b9d', '#f4a261', '#8ab17d'];
  for (let row = 0; row < 6; row++) for (let k = 0; k < 5; k++) { f.col(cols[Math.floor(r() * cols.length)], 0, 1); const x = -0.4 + k * 0.12, y = 0.45 + row * 0.23; f.box(x, y, 0.37, x + 0.08, y + 0.12, 0.385); }
  f.col('#dfe3e8'); f.box(0.25, 1.1, 0.36, 0.44, 1.6, 0.38); f.col(C.dark); f.box(-0.42, 0.1, 0.36, 0.18, 0.28, 0.39);
  f.glass('#cfe7f7'); f.box(-0.44, 0.35, 0.385, 0.2, 1.85, 0.39);
};
function tableLegs(f, x0, z0, x1, z1, h, col = C.dark, t = 0.025) { f.col(col); for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) f.box(x - t, 0, z - t, x + t, h, z + t); }
D.dining_table = f => {
  f.tint(); f.box(-0.8, 0.72, -0.45, 0.8, 0.76, 0.45); tableLegs(f, -0.72, -0.38, 0.72, 0.38, 0.72, C.woodD, 0.03);
  for (const x of [-0.42, 0.42]) { chair(f, x, 0.78, P, '#3c4048', C.woodD); chair(f, x, -0.78, 0, '#3c4048', C.woodD); }
  // (no plates or vase of its own: the dishes people eat are drawn on it — render/food-table.js; 2026-10-07)
};
D.cafe_table = f => {
  f.tint(); f.cyl(0, 0, 0.36, 0.72, 0.76, 18); f.col(C.dark); f.cyl(0, 0, 0.035, 0.0, 0.72, 8); f.cyl(0, 0, 0.22, 0, 0.03, 14);
  chair(f, 0, 0.62, P, '#2d3138', C.dark); chair(f, 0, -0.62, 0, '#2d3138', C.dark);
  // (no cup or saucer of its own: what is ordered is drawn on it)
};
D.cafe_table4 = f => {
  f.tint(); f.cyl(0, 0, 0.48, 0.72, 0.76, 20); f.col(C.dark); f.cyl(0, 0, 0.04, 0, 0.72, 8); f.cyl(0, 0, 0.26, 0, 0.03, 14);
  chair(f, 0, 0.7, P, '#2d3138', C.dark); chair(f, 0, -0.7, 0, '#2d3138', C.dark); chair(f, 0.7, 0, -H, '#2d3138', C.dark); chair(f, -0.7, 0, H, '#2d3138', C.dark);
  // (no cups of its own: what is ordered is drawn on it)
};
D.bar_counter = f => {
  f.col('#5a3a26'); f.box(-1.5, 0, -0.3, 1.5, 1.05, 0.28);
  f.col('#7a5238'); for (let k = 0; k < 10; k++) f.box(-1.45 + k * 0.3, 0.1, 0.28, -1.3 + k * 0.3, 0.95, 0.3);
  f.col('#2b1d14'); f.box(-1.55, 1.05, -0.32, 1.55, 1.1, 0.38);
  f.col(C.chrome); f.box(-1.5, 0.22, 0.34, 1.5, 0.24, 0.36);
  const r = rng(21), bc = ['#2a9d8f', '#c9a227', '#6b3f8c', '#8c2f2f', '#3d6b6b', '#e9d8a6'];
  for (let k = 0; k < 12; k++) { f.col(bc[k % bc.length]); const x = -1.35 + k * 0.24 + r() * 0.05; f.cyl(x, -0.2, 0.035, 1.1, 1.32 + r() * 0.06, 8, 0.02); }
  for (const x of [-1.1, -0.37, 0.37, 1.1]) stool(f, x, 0.55);
};
D.cafe_counter = f => {
  f.tint(); f.box(-1.6, 0, -0.4, 1.6, 1.0, 0.36);
  f.col('#e5e2dc'); f.box(-1.62, 1.0, -0.42, 1.62, 1.05, 0.4);
  f.col(C.dark); f.box(-1.55, 0, 0.36, 1.55, 0.08, 0.38);
  f.glass('#e7f3f8'); f.box(0.3, 1.05, -0.05, 1.5, 1.45, 0.3);
  f.col('#f4a261', 0, 1); f.box(0.35, 1.05, 0.0, 1.45, 1.06, 0.25);
  const r = rng(4); for (let k = 0; k < 8; k++) { f.col(['#c98b4a', '#f1c453', '#e76f51', '#8c5a3c'][k % 4]); f.sph(0.45 + k * 0.14, 1.1, 0.12 + (k % 2) * 0.06, 0.05, 0.035, 0.05, 7, 4); void r; }
  f.col('#c9ced4'); f.box(-1.3, 1.05, -0.3, -0.7, 1.45, 0.05); f.col(C.dark); f.box(-1.2, 1.15, 0.05, -0.8, 1.2, 0.12);
  f.col('#39ff88', 0, 1); f.box(-1.05, 1.36, 0.05, -0.95, 1.4, 0.055);
  f.col(C.dark); f.box(-0.25, 1.05, -0.1, 0.1, 1.08, 0.2); f.box(-0.2, 1.08, 0.0, 0.05, 1.3, 0.03); f.col(C.screen, 0, 1); f.box(-0.18, 1.1, 0.03, 0.03, 1.28, 0.033);
};
D.shop_shelf = f => {
  f.tint(); f.box(-1.0, 0, -0.05, 1.0, 1.8, 0.05); f.box(-1.0, 0, -0.3, 1.0, 0.12, 0.3);
  for (const side of [-1, 1]) for (let k = 0; k < 4; k++) {
    const y = 0.12 + k * 0.42;
    f.tint('#e6e6e6'); f.box(-1.0, y, side < 0 ? -0.3 : 0.05, 1.0, y + 0.025, side < 0 ? -0.05 : 0.3);
    products(f, -0.98, 0.98, y + 0.025, side < 0 ? -0.28 : 0.07, side < 0 ? -0.07 : 0.28, 100 + k * 3 + side, 0.2);
  }
};
D.clothes_rack = f => {
  f.col(C.chrome); for (const s of [-1, 1]) { f.rod([0.78 * s, 0, 0], [0.78 * s, 1.55, 0], 0.015); f.rod([0.78 * s, 0.02, -0.25], [0.78 * s, 0.02, 0.25], 0.015); }
  f.rod([-0.78, 1.55, 0], [0.78, 1.55, 0], 0.015);
  const r = rng(12);
  for (let k = 0; k < 13; k++) {
    const x = -0.68 + k * 0.113, sh = 0.75 + r() * 0.35;
    f.tint(k % 3 === 0 ? '#ffffff' : k % 3 === 1 ? '#b8b8b8' : '#7a7a7a');
    f.box(x - 0.012, 0.75 + r() * 0.2, -0.24 * sh, x + 0.012, 1.5, 0.24 * sh);
  }
};
// a fishing dock's store (docs/features/fishing.md): the rods in their rack, the lure wall, the live bait, the fish counter
D.rod_rack = f => {
  f.col('#7a5a3a'); f.box(-0.9, 0, -0.25, 0.9, 0.12, 0.25); f.box(-0.9, 1.05, -0.08, 0.9, 1.12, 0.08); f.box(-0.88, 0.12, -0.04, -0.82, 1.12, 0.04); f.box(0.82, 0.12, -0.04, 0.88, 1.12, 0.04);
  const cols = ['#1d2023', '#c8a040', '#7a2f22', '#2d6fb8', '#2f6b3a', '#d8d8d8', '#5a3a7a'];
  for (let k = 0; k < 9; k++) {
    const x = -0.72 + k * 0.18, lean = (k % 2 ? 0.05 : -0.05), top = 2.05 + (k % 3) * 0.12;
    f.col('#b98c5c'); f.rod([x, 0.12, 0], [x + lean * 0.3, 0.55, 0], 0.016, 5);
    f.col(cols[k % cols.length]); f.rod([x + lean * 0.3, 0.55, 0], [x + lean, top, 0], 0.007, 4);
    f.col('#c8ccd2'); f.box(x - 0.025, 0.42, 0.012, x + 0.025, 0.48, 0.06);
  }
};
D.lure_wall = f => {
  f.col('#c9b38e'); f.box(-1.0, 0.3, -0.05, 1.0, 2.0, 0.05); f.col('#8a6a4a'); f.box(-1.0, 0, -0.12, 1.0, 0.3, 0.12);
  const cols = ['#e8d040', '#e86a3a', '#7a5ab0', '#f2f2e8', '#3a8ae8', '#e04a6a', '#5ad06a'], r = rng(71);
  for (let row = 0; row < 6; row++) for (let k = 0; k < 9; k++) {
    const x = -0.86 + k * 0.215, y = 0.5 + row * 0.25;
    f.col('#9aa0a8'); f.rod([x, y + 0.08, 0.05], [x, y + 0.08, 0.1], 0.004, 3);
    f.col('#f4f4f0'); f.box(x - 0.045, y - 0.07, 0.05, x + 0.045, y + 0.06, 0.06);
    f.col(cols[Math.floor(r() * cols.length)]); f.box(x - 0.012, y - 0.05, 0.06, x + 0.012, y + 0.04, 0.085);
  }
};
D.bait_fridge = f => {
  // a glass-fronted cooler: its case, the lit inside (the back glowing), wire shelves of bait tubs, the door's frame, its sign
  f.col('#e8eef2'); f.box(-0.5, 0, -0.36, -0.44, 1.9, 0.36); f.box(0.44, 0, -0.36, 0.5, 1.9, 0.36); f.box(-0.5, 0, -0.36, 0.5, 0.25, 0.36); f.box(-0.5, 1.55, -0.36, 0.5, 1.9, 0.36);
  f.col('#dff4ff', 0, 1); f.box(-0.44, 0.25, -0.36, 0.44, 1.55, -0.3);
  f.col('#9aa4ae'); for (const y of [0.55, 0.9, 1.25]) f.box(-0.44, y, -0.3, 0.44, y + 0.015, 0.3);
  const tubs = ['#f4f2ea', '#6a8a4a', '#e8a080', '#f4f2ea', '#b8c4c8'];
  for (const [k, y] of [0.27, 0.565, 0.915, 1.265].entries()) for (let i = 0; i < 4; i++) { f.col(tubs[(i + k) % tubs.length]); f.cyl(-0.3 + i * 0.2, 0.05, 0.07, y, y + 0.11, 8); }
  f.col('#c9ced4'); f.box(-0.44, 0.25, 0.3, -0.4, 1.55, 0.34); f.box(0.4, 0.25, 0.3, 0.44, 1.55, 0.34); f.box(0.36, 0.7, 0.34, 0.39, 1.1, 0.38);
  f.col('#2a6fb0'); f.box(-0.5, 1.6, 0.36, 0.5, 1.86, 0.38); f.col('#ffffff', 0, 1); f.box(-0.36, 1.68, 0.38, 0.36, 1.78, 0.385);
};
D.fish_counter = f => {
  f.col('#e8e2d4'); f.box(-1.1, 0, -0.4, 1.1, 0.9, 0.4); f.col('#2a6fb0'); f.box(-1.1, 0.6, 0.4, 1.1, 0.7, 0.41);
  f.col('#cfd6dc'); f.box(-1.05, 0.9, -0.36, 0.2, 0.93, 0.36);            // the steel top where the catch is laid out
  f.col('#e8f2f8'); for (let k = 0; k < 7; k++) f.box(-1.0 + k * 0.17, 0.93, -0.3, -0.88 + k * 0.17, 0.95, 0.3);   // ice
  f.col('#9aa4ae'); f.box(0.35, 0.9, -0.2, 0.85, 0.95, 0.2); f.box(0.55, 0.95, -0.05, 0.65, 1.15, 0.05); f.col('#3a3e45'); f.box(0.45, 1.15, -0.15, 0.75, 1.32, 0.05);
  f.col(C.screen, 0, 1); f.box(0.48, 1.18, 0.05, 0.72, 1.29, 0.055);   // the scale and its read-out
};
D.checkout = f => {
  f.col('#dcd6cc'); f.box(-0.9, 0, -0.35, 0.9, 0.9, 0.35);
  f.col(C.black); f.box(-0.85, 0.9, -0.1, 0.4, 0.92, 0.3);
  f.col(C.dark); f.box(0.5, 0.9, -0.25, 0.8, 1.0, 0.05); f.box(0.6, 1.0, -0.2, 0.7, 1.18, -0.16); f.col(C.screen, 0, 1); f.box(0.52, 1.02, -0.16, 0.78, 1.2, -0.155);
  f.col('#2a9d8f'); f.box(-0.9, 0.3, 0.35, 0.9, 0.36, 0.36);
};
D.display = f => {
  f.tint(); f.box(-0.75, 0.7, -0.5, 0.75, 0.76, 0.5); tableLegs(f, -0.68, -0.43, 0.68, 0.43, 0.7, C.dark, 0.03);
  products(f, -0.7, 0.7, 0.76, -0.4, -0.05, 55, 0.12); products(f, -0.7, 0.7, 0.76, 0.05, 0.4, 56, 0.1);
};
// ---- a shoe store (2026-10-15): a low-poly sneaker — its outsole, a white midsole, the upper (colour), the toe, the
// collar's opening, the tongue and laces, a stripe and a heel tab (accent). Item frame: its sole's middle at (x, y, z),
// pointing along +z (yaw turns it), about 0.29 m long; s scales it. up: the upper's colour (null: the item's tint).
function sneaker(f, x, y, z, yaw, up, accent, s = 1) {
  f.push(x, y, z, yaw);
  const U = () => (up ? f.col(up) : f.tint()), k = s;
  f.col('#2b2d31'); f.sph(0, 0.011 * k, 0.004 * k, 0.054 * k, 0.015 * k, 0.15 * k, 16, 6, { cut: -0.1 });        // outsole
  f.col('#f3f1ec'); f.sph(0, 0.027 * k, 0.0, 0.052 * k, 0.022 * k, 0.146 * k, 16, 6, { cut: -0.3 });            // midsole
  f.col('#f3f1ec'); f.sph(0, 0.04 * k, -0.105 * k, 0.05 * k, 0.03 * k, 0.045 * k, 12, 6, { cut: -0.3 });        // the heel's midsole, thicker
  U(); f.sph(0, 0.06 * k, -0.068 * k, 0.046 * k, 0.062 * k, 0.078 * k, 14, 8, { cut: -0.5 });                    // the heel and ankle
  U(); f.sph(0, 0.05 * k, 0.005 * k, 0.047 * k, 0.046 * k, 0.075 * k, 14, 8, { cut: -0.5 });                     // the midfoot
  U(); f.sph(0, 0.04 * k, 0.078 * k, 0.044 * k, 0.03 * k, 0.066 * k, 12, 6, { cut: -0.5 });                      // the toe box
  f.col('#ece9e2'); f.sph(0, 0.036 * k, 0.118 * k, 0.034 * k, 0.02 * k, 0.03 * k, 10, 5, { cut: -0.4 });         // the toe cap
  f.col('#1d1e22'); f.sph(0, 0.121 * k, -0.083 * k, 0.03 * k, 0.008 * k, 0.04 * k, 12, 4);                       // the opening
  U(); f.sph(0, 0.108 * k, -0.035 * k, 0.022 * k, 0.026 * k, 0.03 * k, 10, 5);                                    // the tongue
  f.col('#fbfbf8'); for (let n = 0; n < 4; n++) { const zz = (-0.022 + n * 0.024) * k, yy = (0.098 - n * 0.013) * k; f.box(-0.034 * k, yy, zz - 0.006 * k, 0.034 * k, yy + 0.009 * k, zz + 0.006 * k); }   // laces
  f.col(accent);
  for (const sd of [-1, 1]) f.box(sd > 0 ? 0.045 * k : -0.051 * k, 0.042 * k, -0.09 * k, sd > 0 ? 0.051 * k : -0.045 * k, 0.054 * k, 0.04 * k);   // the side stripe
  f.box(-0.011 * k, 0.08 * k, -0.149 * k, 0.011 * k, 0.126 * k, -0.137 * k);                                     // heel tab
  f.pop();
}
D.shoe_wall = f => {
  // a tinted back panel with a lit top band, four glass-edged shelves, four sneakers on each (side-on), a skirting
  f.tint(); f.box(-1.0, 0, -0.16, 1.0, 2.3, -0.1);
  f.col(C.dark); f.box(-1.0, 0, -0.1, 1.0, 0.18, 0.12);
  f.col('#fff6e0', 0, 1); f.box(-0.96, 2.12, -0.1, 0.96, 2.18, -0.08);
  const cols = ['#f4f4f2', '#1f2329', '#c0392b', '#2e86de', '#f1c40f', '#8e44ad', '#16a085', '#e67e22', '#d35400', '#7f8c8d', '#ff6b81', '#2c3e50'];
  const acc = ['#e74c3c', '#f1c40f', '#ffffff', '#ff9f43', '#1f2329', '#48dbfb', '#ffffff', '#2d3436'];
  for (let row = 0; row < 4; row++) {
    const y = 0.42 + row * 0.44;
    f.col('#e8eef2'); f.box(-0.94, y - 0.02, -0.1, 0.94, y, 0.12);
    f.col('#fff6e0', 0, 1); f.box(-0.94, y - 0.025, 0.115, 0.94, y - 0.02, 0.12);   // the shelf's lit edge
    for (let k = 0; k < 4; k++) {
      const n = row * 4 + k;
      sneaker(f, -0.69 + k * 0.46, y, 0.01, n % 2 ? -H : H, cols[n % cols.length], acc[(n * 3) % acc.length], 0.95);
    }
  }
};
D.shoe_plinth = f => {
  // a white plinth with a lit top, the sneaker turned to show its side, a glass case over it
  f.col('#f2f1ee'); f.box(-0.3, 0, -0.3, 0.3, 1.0, 0.3);
  f.col(C.dark); f.box(-0.31, 0, -0.31, 0.31, 0.06, 0.31);
  f.col('#fff6e0', 0, 1); f.box(-0.28, 1.0, -0.28, 0.28, 1.012, 0.28);
  f.col('#d9dde2'); f.cyl(0, 0, 0.13, 1.012, 1.04, 20);
  sneaker(f, 0, 1.04, 0, H + 0.4, null, '#ff5a4e', 1.45);
  f.glass('#dfeef6'); f.box(-0.27, 1.012, -0.27, 0.27, 1.42, 0.27);
  f.col('#c9ced4'); f.box(-0.28, 1.42, -0.28, 0.28, 1.44, 0.28);
};
D.treadmill = f => {
  f.col(C.dark); f.box(-0.4, 0, -0.95, 0.4, 0.16, 0.95); f.col('#101114'); f.box(-0.3, 0.16, -0.8, 0.3, 0.19, 0.95);
  f.col('#55595f'); f.box(-0.4, 0.16, -0.95, -0.3, 0.2, 0.95); f.box(0.3, 0.16, -0.95, 0.4, 0.2, 0.95);
  f.col(C.dark); for (const s of [-1, 1]) f.rod([0.36 * s, 0.18, -0.85], [0.33 * s, 1.25, -0.72], 0.03);
  f.box(-0.4, 1.2, -0.85, 0.4, 1.32, -0.62); f.col(C.screen, 0, 1); f.box(-0.18, 1.28, -0.66, 0.18, 1.321, -0.6);
  f.col('#9aa0a8'); for (const s of [-1, 1]) f.rod([0.36 * s, 1.05, -0.72], [0.36 * s, 1.0, -0.2], 0.018);
};
D.weights = f => {
  f.col(C.dark); f.box(-0.8, 0, -0.3, -0.74, 0.9, 0.3); f.box(0.74, 0, -0.3, 0.8, 0.9, 0.3);
  f.box(-0.74, 0.35, -0.25, 0.74, 0.38, 0.05); f.box(-0.74, 0.7, -0.25, 0.74, 0.73, 0.05);
  for (const y of [0.38, 0.73]) for (let k = 0; k < 6; k++) {
    const x = -0.62 + k * 0.245, r = 0.045 + k * 0.006;
    f.col('#2b2d33'); f.push(x, y + r, -0.1); f.m.multiply(new THREE.Matrix4().makeRotationZ(H)); f.cyl(0, 0, r, -0.1, -0.06, 10); f.cyl(0, 0, r, 0.06, 0.1, 10); f.col(C.chrome); f.cyl(0, 0, 0.015, -0.06, 0.06, 6); f.pop();
  }
};
D.yoga_mat = f => { f.tint(); f.box(-0.33, 0, -0.93, 0.33, 0.012, 0.93, 'b'); f.tint('#d0d0d0'); f.cyl(0, -0.93, 0.05, 0, 0.012, 8); };
D.lockers = f => {
  f.tint('#dcdcdc'); f.box(-1.0, 0, -0.25, 1.0, 1.95, 0.22);
  for (let k = 0; k < 5; k++) {
    const x0 = -0.97 + k * 0.392;
    f.tint(); f.box(x0, 0.08, 0.22, x0 + 0.37, 1.9, 0.24);
    f.col(C.dark); for (let v = 0; v < 3; v++) f.box(x0 + 0.08, 1.6 + v * 0.06, 0.24, x0 + 0.29, 1.62 + v * 0.06, 0.245);
    f.col(C.chrome); f.box(x0 + 0.3, 1.0, 0.24, x0 + 0.33, 1.12, 0.26);
  }
};
function bed(f, w) {
  const hw = w / 2;
  f.col(C.woodD); f.box(-hw, 0.08, -1.05, hw, 0.35, 1.1); f.box(-hw - 0.02, 0, -1.1, hw + 0.02, 1.0, -1.04);
  for (const [x, z] of [[-hw + 0.05, 1.05], [hw - 0.05, 1.05]]) f.box(x - 0.04, 0, z - 0.04, x + 0.04, 0.12, z + 0.04);
  f.col(C.white); f.box(-hw + 0.03, 0.35, -1.03, hw - 0.03, 0.55, 1.07);
  f.tint(); f.box(-hw + 0.01, 0.36, -0.35, hw - 0.01, 0.575, 1.09);
  f.tint('#e0e0e0'); f.box(-hw + 0.01, 0.4, 0.75, hw - 0.01, 0.58, 1.09);
  f.col(C.white); const n = w > 1.2 ? 2 : 1;
  for (let k = 0; k < n; k++) { const cx = n === 1 ? 0 : (k ? 0.38 : -0.38); f.box(cx - 0.3, 0.55, -1.0, cx + 0.3, 0.66, -0.62); }
}
D.bed_double = f => bed(f, 1.7);
D.bed_single = f => bed(f, 1.0);
D.nightstand = f => {
  f.col(C.woodD); f.box(-0.24, 0, -0.22, 0.24, 0.55, 0.22); f.col('#8a6242'); f.box(-0.21, 0.3, 0.22, 0.21, 0.5, 0.23); f.col(C.chrome); f.box(-0.05, 0.39, 0.23, 0.05, 0.41, 0.25);
  f.col('#dcd6cc'); f.lathe(0.05, -0.05, [[0.07, 0.55], [0.08, 0.62], [0.03, 0.7], [0.02, 0.78]], 10);
  f.col(C.lamp, 0, 2); f.lathe(0.05, -0.05, [[0.1, 0.95], [0.15, 0.76], [0.16, 0.76], [0.11, 0.95]], 12);
  f.col('#2f5d8c'); f.box(-0.18, 0.55, 0.0, -0.02, 0.58, 0.18);
};
D.wardrobe = f => {
  f.tint(); f.box(-0.65, 0.05, -0.3, 0.65, 2.05, 0.28);
  f.tint('#e8e8e8'); f.box(-0.63, 0.1, 0.28, -0.01, 2.0, 0.3); f.box(0.01, 0.1, 0.28, 0.63, 2.0, 0.3);
  f.col(C.chrome); f.box(-0.08, 0.95, 0.3, -0.05, 1.25, 0.33); f.box(0.05, 0.95, 0.3, 0.08, 1.25, 0.33);
  f.col(C.dark); f.box(-0.63, 0, -0.28, 0.63, 0.05, 0.26);
};
D.shower = f => {
  f.col(C.white); f.box(-0.48, 0, -0.48, 0.48, 0.08, 0.48);
  f.col('#dfe7ea'); f.box(-0.48, 0.08, -0.48, 0.48, 2.1, -0.44); f.box(-0.48, 0.08, -0.44, -0.44, 2.1, 0.48);
  f.col(C.chrome); f.rod([0.0, 1.0, -0.44], [0.0, 2.0, -0.44], 0.012); f.rod([0, 2.0, -0.44], [0, 2.0, -0.25], 0.012); f.cyl(0, -0.22, 0.08, 1.96, 2.0, 12);
  f.box(0.1, 1.0, -0.44, 0.16, 1.1, -0.4); f.box(0.45, 0.08, 0.45, 0.48, 2.05, 0.48);
  f.glass('#d6ecf5'); f.box(0.45, 0.08, -0.44, 0.47, 2.0, 0.45); f.box(-0.44, 0.08, 0.46, 0.2, 2.0, 0.48);
};
D.sink = f => {
  f.col(C.woodL); f.box(-0.35, 0.08, -0.25, 0.35, 0.8, 0.23); f.col(C.dark); f.box(-0.33, 0, -0.23, 0.33, 0.08, 0.2);
  f.col(C.white); f.box(-0.37, 0.8, -0.25, 0.37, 0.86, 0.25); f.col('#e8ecef'); f.lathe(0, 0.02, [[0.2, 0.86], [0.18, 0.79], [0, 0.78]], 14);
  f.col(C.chrome); f.rod([0, 0.86, -0.18], [0, 1.02, -0.18], 0.014); f.rod([0, 1.02, -0.18], [0, 1.0, -0.08], 0.011);
  f.col('#b8d6e6', 0, 1); f.box(-0.32, 1.1, -0.25, 0.32, 1.78, -0.23); f.col(C.chrome); f.box(-0.34, 1.08, -0.255, 0.34, 1.8, -0.25);
  f.col(C.lamp, 0, 2); f.box(-0.25, 1.82, -0.25, 0.25, 1.86, -0.18);
};
D.toilet = f => {
  f.col(C.white);
  f.lathe(0, 0.07, [[0.11, 0], [0.12, 0.04], [0.1, 0.2], [0.17, 0.34], [0.19, 0.4]], 16);   // the pedestal and bowl
  f.col('#fafaf7'); f.lathe(0, 0.07, [[0.19, 0.4], [0.2, 0.43], [0.19, 0.45], [0.11, 0.45], [0.1, 0.43]], 16);   // the seat
  f.col('#c9d2d6'); f.cyl(0, 0.07, 0.1, 0.36, 0.43, 14, 0.1, true);   // inside the bowl
  f.col(C.white); f.box(-0.19, 0.4, -0.36, 0.19, 0.8, -0.16); f.col('#fafaf7'); f.box(-0.2, 0.8, -0.37, 0.2, 0.83, -0.15);   // the cistern and its lid
  f.col(C.chrome); f.cyl(0, -0.26, 0.035, 0.83, 0.845, 12);
};
D.bathtub = f => {
  f.col(C.white); f.box(-0.85, 0, -0.38, 0.85, 0.08, 0.38);
  f.box(-0.85, 0.08, -0.38, 0.85, 0.56, -0.31); f.box(-0.85, 0.08, 0.31, 0.85, 0.56, 0.38);   // the sides
  f.box(-0.85, 0.08, -0.31, -0.78, 0.56, 0.31); f.box(0.78, 0.08, -0.31, 0.85, 0.56, 0.31);
  f.col('#eef4f6'); f.box(-0.78, 0.08, -0.31, 0.78, 0.13, 0.31);   // the inside
  f.glass('#bfe3f0'); f.box(-0.77, 0.13, -0.3, 0.77, 0.36, 0.3, 'b');   // water
  f.col(C.chrome); f.rod([0.81, 0.56, -0.2], [0.81, 0.66, -0.2], 0.014); f.rod([0.81, 0.66, -0.2], [0.72, 0.66, -0.2], 0.012);   // the tap
  f.rod([0.62, 0.56, -0.37], [0.62, 1.95, -0.37], 0.012); f.rod([0.62, 1.95, -0.37], [0.62, 1.95, -0.2], 0.012); f.cyl(0.62, -0.18, 0.07, 1.91, 1.95, 12);   // the shower
  f.glass('#d6ecf5'); f.box(0.2, 0.56, 0.35, 0.84, 1.9, 0.37);   // a glass screen over half the tub
};
D.desk_home = f => {
  f.tint(); f.box(-0.6, 0.72, -0.32, 0.6, 0.755, 0.3); tableLegs(f, -0.55, -0.27, 0.55, 0.25, 0.72, C.dark, 0.022);
  laptop(f, -0.05, 0.755, -0.05); mug(f, 0.35, 0.755, 0.05, '#e76f51');
  f.col(C.dark); f.cyl(-0.45, -0.2, 0.06, 0.755, 0.77, 10); f.rod([-0.45, 0.77, -0.2], [-0.4, 1.05, -0.12], 0.01); f.col(C.lamp, 0, 2); f.lathe(-0.38, -0.08, [[0.03, 1.08], [0.08, 1.0], [0.085, 1.0], [0.035, 1.08]], 10);
  chair(f, 0, 0.55, P, '#3c4048', C.dark);
};
D.bench = f => {
  f.col('#2b2f36'); for (const s of [-0.8, 0.8]) { f.box(s - 0.03, 0, -0.22, s + 0.03, 0.42, 0.24); f.box(s - 0.03, 0.42, -0.28, s + 0.03, 0.88, -0.22); }
  f.col('#8a5a36'); for (let k = 0; k < 4; k++) f.box(-0.95, 0.42, -0.2 + k * 0.115, 0.95, 0.45, -0.11 + k * 0.115);
  for (let k = 0; k < 3; k++) f.box(-0.95, 0.52 + k * 0.12, -0.285, 0.95, 0.6 + k * 0.12, -0.255);
};
D.picnic_table = f => {
  f.col('#9c6b41'); for (let k = 0; k < 5; k++) f.box(-0.9, 0.72, -0.38 + k * 0.155, 0.9, 0.76, -0.25 + k * 0.155);
  for (const s of [-1, 1]) { f.box(-0.9, 0.42, 0.5 * s - 0.13, 0.9, 0.46, 0.5 * s + 0.13 + (s > 0 ? 0.02 : -0.02)); }
  f.col('#7a5230'); for (const x of [-0.65, 0.65]) { f.rod([x, 0, -0.62], [x, 0.74, 0], 0.035); f.rod([x, 0, 0.62], [x, 0.74, 0], 0.035); f.box(x - 0.03, 0.38, -0.66, x + 0.03, 0.42, 0.66); }
};
function trunk(f, h, r, lean = 0) { f.col('#6b4a33'); f.lathe(0, 0, [[r * 1.3, 0], [r, 0.3], [r * 0.8, h * 0.7], [r * 0.6, h]], 7); void lean; }
export function treeRound(f, h = 6.5, s = 1, k = 0, col = null) {
  trunk(f, h * 0.55, 0.16 * s);
  if (col) f.col(col); else f.tint();
  const blobs = [[0, h * 0.64, 0, 1.9], [0.8, h * 0.56, 0.4, 1.3], [-0.7, h * 0.6, -0.5, 1.35], [0.2, h * 0.8, -0.2, 1.3]];
  for (const [x, y, z, r] of blobs) f.sph(x * s, y, z * s, r * s, r * s * 0.85, r * s, 10, 7, { shade: leafShade, disp: (a, b, c) => 0.13 * noise3(a, b, c, k + x) });
}
export function treePine(f, h = 7.5, s = 1) {
  trunk(f, h * 0.35, 0.14 * s);
  f.col('#2f5f35');
  for (let t = 0; t < 4; t++) {
    const y0 = h * (0.2 + t * 0.17), r = s * (1.6 - t * 0.33);
    f.lathe(0, 0, [[0, y0 - 0.05], [r, y0], [r * 0.2, y0 + h * 0.3], [0, y0 + h * 0.32]], 9);
  }
}
export function treeColumn(f, h = 8, s = 1, k = 0, col = null) {
  trunk(f, h * 0.3, 0.14 * s);
  if (col) f.col(col); else f.tint();
  f.sph(0, h * 0.6, 0, 1.05 * s, h * 0.38, 1.05 * s, 10, 8, { shade: leafShade, disp: (a, b, c) => 0.1 * noise3(a, b, c, k) });
}
D.tree = f => treeRound(f, 6.5, 1, 1);
D.tree_pine = f => treePine(f, 7.5, 1);
D.bush = f => {
  f.tint();
  for (const [x, y, z, r] of [[0, 0.45, 0, 0.55], [0.3, 0.35, 0.2, 0.4], [-0.3, 0.38, -0.15, 0.42]]) f.sph(x, y, z, r, r * 0.85, r, 9, 6, { cut: -0.5, shade: leafShade, disp: (a, b, c) => 0.12 * noise3(a, b, c, x * 9) });
};
D.flowers = f => {
  f.col('#8a6a4a'); f.box(-1.0, 0, -0.5, 1.0, 0.28, 0.5); f.col(C.soil); f.box(-0.95, 0.28, -0.45, 0.95, 0.3, 0.45);
  f.col('#4e8a3a'); const r = rng(31);
  for (let k = 0; k < 16; k++) f.sph(-0.8 + r() * 1.6, 0.36, -0.35 + r() * 0.7, 0.12, 0.08, 0.12, 6, 4);
  for (let k = 0; k < 26; k++) { f.tint(); const x = -0.85 + r() * 1.7, z = -0.38 + r() * 0.76; f.sph(x, 0.44 + r() * 0.06, z, 0.045, 0.035, 0.045, 5, 3); }
};
// The park fountain (2026-10-05: "make sure it looks great"): a two-tier sandstone fountain — a low step, the
// basin with a moulded coping you can stand on, a tiled pool with lamps in its floor (lit at night), an octagonal
// pedestal, a baluster carrying the lower bowl, a slimmer one carrying the upper bowl, and a finial spout. The water —
// the pool, the bowls, the curtains spilling over both lips, the crown jet and the rim jets — is animated separately
// (render/fountains.js, FOUNTAIN_WATER); the heights here are the ones it fits.
export const FOUNTAIN = { r: 3.0, rim: 0.56, poolIn: 2.62, poolY: 0.36, floorY: 0.1, bowl1: { r: 1.42, y: 1.46, in: 1.3 }, bowl2: { r: 0.72, y: 2.16, in: 0.62 }, spout: 2.55, ped: 0.72 };
D.fountain = f => {
  const sand = '#c7baa2', sandD = '#a99b83', sandL = '#d8ccb6', joint = '#8f826d';
  f.col(sandD); f.lathe(0, 0, [[3.32, 0], [3.32, 0.06], [3.2, 0.1], [3.0, 0.1]], 48);                       // the step
  f.col(sand); f.lathe(0, 0, [[3.0, 0.1], [3.0, 0.42], [3.06, 0.44]], 48);                                  // the basin wall
  f.col(joint); f.lathe(0, 0, [[3.005, 0.4], [3.005, 0.415]], 48);                                         // a shadow line under the coping
  for (let k = 0; k < 24; k++) {                                                                           // pilasters round the wall
    const a = k * TAU / 24; f.push(Math.sin(a) * 3.0, 0, Math.cos(a) * 3.0, a);
    f.col(sandD); f.box(-0.09, 0.1, -0.02, 0.09, 0.42, 0.045); f.pop();
  }
  f.col(sandL); f.lathe(0, 0, [[3.06, 0.44], [3.1, 0.47], [3.1, 0.52], [3.04, 0.56], [2.74, 0.56], [2.66, 0.53], [2.64, 0.48]], 48);   // its coping
  f.col(sandD); f.lathe(0, 0, [[2.64, 0.48], [2.62, 0.1]], 48);                                             // inner wall
  f.col('#3f6d78'); f.lathe(0, 0, [[2.62, 0.1], [0.72, 0.1]], 48);                                           // the pool's tiled floor
  for (let k = 0; k < 8; k++) {                                                                            // lamps in the floor
    const a = (k + 0.5) * TAU / 8, x = Math.sin(a) * 2.25, z = Math.cos(a) * 2.25;
    f.col('#59626a'); f.cyl(x, z, 0.13, 0.1, 0.13, 10);
    f.col('#6fb9c2', 0, 2); f.cyl(x, z, 0.06, 0.13, 0.135, 10);   // lit at night (the water above glows: fountains.js)
  }
  // the pedestal: an octagonal plinth with mouldings, standing in the pool
  f.col(sandD); f.lathe(0, 0, [[0.78, 0.1], [0.78, 0.2], [0.72, 0.24]], 8);
  f.col(sand); f.lathe(0, 0, [[0.72, 0.24], [0.68, 0.3], [0.68, 0.62], [0.74, 0.66], [0.74, 0.72], [0.56, 0.76]], 8);
  // the lower baluster and bowl (lip at 1.46, water in it at 1.43)
  f.col(sandL); f.lathe(0, 0, [[0.56, 0.76], [0.3, 0.84], [0.24, 0.95], [0.34, 1.05], [0.2, 1.16], [0.24, 1.22], [0.5, 1.26], [0.9, 1.31], [1.25, 1.36], [1.38, 1.38]], 28);
  f.col(sand); f.lathe(0, 0, [[1.38, 1.38], [1.44, 1.41], [1.45, 1.46], [1.4, 1.49], [1.33, 1.48], [1.3, 1.44]], 40);
  f.col(sandD); f.lathe(0, 0, [[1.3, 1.44], [1.0, 1.4], [0.3, 1.38], [0, 1.38]], 28);
  // the upper baluster and bowl
  f.col(sandL); f.lathe(0, 0, [[0.26, 1.38], [0.17, 1.5], [0.14, 1.62], [0.21, 1.72], [0.13, 1.84], [0.16, 1.9], [0.36, 1.98], [0.62, 2.06], [0.7, 2.1]], 24);
  f.col(sand); f.lathe(0, 0, [[0.7, 2.1], [0.74, 2.13], [0.74, 2.17], [0.69, 2.19], [0.64, 2.18], [0.62, 2.14]], 32);
  f.col(sandD); f.lathe(0, 0, [[0.62, 2.14], [0.3, 2.1], [0, 2.09]], 24);
  // the finial: a short column with a fluted cap and the spout
  f.col(sandL); f.lathe(0, 0, [[0.11, 2.09], [0.08, 2.2], [0.075, 2.36], [0.12, 2.4], [0.1, 2.46], [0.06, 2.5], [0.045, 2.55], [0, 2.56]], 16);
};
// Billboards (shared/signs.js AD_ASSETS: standard 9.6 × 3.2 m or large 14.4 × 4.8 m faces, double-faced): a concrete
// footing and a monopole, centred or near one end with the board overhanging; the head frame and beam, the cabinet with
// its trim, a catwalk hung below each face (its rail stays below the ad), three to five lamps per face on arms from the
// top (lit at night). The ads are drawn on the faces by render/signs.js.
function billboardGeo(f, A) {
  const F = A.face, hw = F.w / 2, half = A.half, y0 = F.y - F.h / 2, y1 = F.y + F.h / 2, P = A.pole, big = F.w > 12;
  f.col('#a9a49b'); f.cyl(P.x, 0, P.r * 1.75, 0, 0.32, 16);
  f.col('#6d737a'); f.cyl(P.x, 0, P.r, 0.32, y0 - 0.15, 14, P.r * 0.85);
  f.col('#5d6268'); f.box(P.x - P.r * 1.4, y0 - 0.5, -half - 0.05, P.x + P.r * 1.4, y0 - 0.15, half + 0.05);   // the head plate
  if (A.mount === 'overhang') {   // the head frame carrying the board out from the pole
    f.col('#4a4f55');
    for (const z of [-half * 0.6, half * 0.6]) { f.rod([P.x, y0 - 0.3, z], [-hw + 0.6, y0 - 0.15, z], 0.07, 6); f.rod([P.x, y0 - 1.6, z], [P.x - hw * 0.6, y0 - 0.2, z], 0.06, 6); }
  }
  f.col('#3a3e44'); f.box(-hw - 0.1, y0 - 0.15, -half - 0.07, hw + 0.1, y0, half + 0.07);   // the beam under the cabinet
  f.col('#24272b'); f.box(-hw - 0.1, y0, -half, hw + 0.1, y1 + 0.05, half);   // the cabinet (its faces carry the ads)
  f.col('#dcdde0');
  for (const z of [-half - 0.04, half]) { f.box(-hw - 0.12, y1, z, hw + 0.12, y1 + 0.12, z + 0.04); f.box(-hw - 0.12, y0 - 0.1, z, hw + 0.12, y0, z + 0.04); f.box(-hw - 0.12, y0, z, -hw, y1, z + 0.04); f.box(hw, y0, z, hw + 0.12, y1, z + 0.04); }
  const cw = y0 - 1.55, n = big ? 5 : 3;
  for (const s of [1, -1]) {
    f.col('#4a4f55');
    f.box(-hw - 0.15, cw, s > 0 ? half + 0.07 : -half - 0.8, hw + 0.15, cw + 0.06, s > 0 ? half + 0.8 : -half - 0.07);   // the catwalk's grating
    for (let k = 0; k <= 4; k++) { const x = -hw + k * hw / 2; f.rod([x, cw + 0.06, s * (half + 0.3)], [x, y0 - 0.15, s * half * 0.8], 0.03, 4); }   // hung from the beam
    for (let k = 0; k <= 6; k++) { const x = -hw - 0.1 + k * (F.w + 0.2) / 6; f.rod([x, cw + 0.06, s * (half + 0.78)], [x, cw + 1.05, s * (half + 0.78)], 0.022, 4); }
    f.rod([-hw - 0.1, cw + 1.05, s * (half + 0.78)], [hw + 0.1, cw + 1.05, s * (half + 0.78)], 0.025, 4);
    for (let k = 0; k < n; k++) {
      const x = -hw + (k + 0.5) * F.w / n;
      f.col('#4a4f55'); f.rod([x, y1 + 0.12, s * half * 0.9], [x, y1 + 0.5, s * (half + 0.75)], 0.035, 5);
      f.col('#2a2e35'); f.box(x - 0.22, y1 + 0.4, s * (half + 0.68) - 0.13, x + 0.22, y1 + 0.6, s * (half + 0.68) + 0.13);
      f.col(C.lamp, 0, 2); f.box(x - 0.19, y1 + 0.38, s * (half + 0.68) - 0.1, x + 0.19, y1 + 0.4, s * (half + 0.68) + 0.1);
    }
  }
}
for (const [t, A] of Object.entries(AD_ASSETS)) if (t !== 'street_sign') D[t] = f => billboardGeo(f, A);
// A lit street sign ("mupi"): a stone plinth, the cabinet with two portrait faces (render/signs.js draws them) behind
// glass, a slim roof; lit from inside at night.
D.street_sign = f => {
  const A = AD_ASSETS.street_sign, F = A.face, hw = F.w / 2 + 0.07, y0 = F.y - F.h / 2 - 0.07, y1 = F.y + F.h / 2 + 0.07, half = A.half;
  f.col('#8e8a82'); f.box(-hw + 0.02, 0, -half + 0.02, hw - 0.02, 0.06, half - 0.02);
  f.col('#3b3f45'); f.box(-0.32, 0.06, -half + 0.04, 0.32, y0, half - 0.04);   // the foot
  f.col('#24272b'); f.box(-hw, y0, -half, hw, y1, half);   // the cabinet
  f.col('#c9ccd0');
  for (const z of [-half - 0.012, half - 0.008]) { f.box(-hw - 0.01, y1 - 0.06, z, hw + 0.01, y1, z + 0.02); f.box(-hw - 0.01, y0, z, hw + 0.01, y0 + 0.06, z + 0.02); f.box(-hw - 0.01, y0, z, -hw + 0.06, y1, z + 0.02); f.box(hw - 0.06, y0, z, hw + 0.01, y1, z + 0.02); }
  f.col('#3b3f45'); f.box(-hw - 0.05, y1, -half - 0.05, hw + 0.05, y1 + 0.07, half + 0.05);
};
// Signs inside (shared/signs.js INDOOR_SIGNS) in their styles (SIGN_STYLES), built round a face w × h whose centre is
// yc above the floor: standing ones double-faced, their board 5 cm thick round the face, the base and post their own
// size whatever the face's; wall ones a frame round the face. Lights take the sign's colour (tint + neon emission:
// glowing by day, brighter at night). The geometry is made for each size a sign takes (signGeoKey 'type@style#w×h').
const LIGHT = f => f.col('#ffffff', 1, 3);
/** n points spread evenly over ±half (one: the middle). */
const spread = (n, half) => (n < 2 ? [0] : Array.from({ length: n }, (_, i) => -half + (2 * half * i) / (n - 1)));
/** A post's half thickness for a panel w × h: slender for a small one, sturdier for a big one. */
const postT = (w, h, a, b) => Math.min(b, a + 0.005 * Math.max(0, Math.max(w, h) - 1));
const STANDING = {
  classic(f, w, h, yc) {
    const n = w <= 1.3 ? 1 : Math.max(2, Math.round(w / 2.4)), r = n > 1 ? 0.2 : 0.21, pr = postT(w, h, 0.02, 0.045);   // wider boards on more posts
    f.col('#2f3237');
    for (const x of spread(n, w * 0.36)) { f.cyl(x, 0, r, 0, 0.03, 18); f.cyl(x, 0, pr, 0.03, yc - h / 2, 8); }
    f.col('#1f2226'); f.box(-w / 2 - 0.025, yc - h / 2 - 0.025, -0.026, w / 2 + 0.025, yc + h / 2 + 0.025, 0.026);
  },
  modern(f, w, h, yc) {
    const pw = Math.max(0.15, w * 0.42), n = w <= 2.2 ? 2 : Math.max(3, Math.round(w / 1.8)), lt = postT(w, h, 0.011, 0.024);
    f.col('#cbc7bf'); f.box(-pw, 0, -0.17, pw, 0.09, 0.17);
    f.col('#a8a49c'); f.box(-pw - 0.01, 0, -0.18, pw + 0.01, 0.015, 0.18);
    f.col('#c3c8ce'); for (const x of spread(n, pw - 0.06)) f.box(x - lt, 0.09, -lt, x + lt, yc - h / 2, lt);
    f.col('#d9dcdf'); f.box(-w / 2 - 0.012, yc - h / 2 - 0.012, -0.027, w / 2 + 0.012, yc + h / 2 + 0.012, 0.027);
  },
  pylon(f, w, h, yc) {
    const hw = w / 2 + 0.045, bot = yc - h / 2;
    f.col('#24282e'); f.box(-hw - 0.02, 0, -0.15, hw + 0.02, 0.05, 0.15);              // the step
    if (bot - 0.03 > 0.06) { f.col('#2f343b'); f.box(-hw, 0.05, -0.1, hw, bot - 0.03, 0.1); }   // the body below the sign
    f.col('#2f343b'); f.box(-hw, Math.min(bot - 0.03, 0.05), -0.026, hw, yc + h / 2 + 0.05, 0.026);   // round the sign
    f.col('#3a4048'); f.box(-hw - 0.01, yc + h / 2 + 0.05, -0.05, hw + 0.01, yc + h / 2 + 0.085, 0.05);   // the cap
    if (bot - 0.09 > 0.2) { LIGHT(f); for (const z of [0.1, -0.104]) for (const x of spread(w > 2.4 ? 3 : 1, w * 0.33)) f.box(x - 0.014, 0.11, z, x + 0.014, bot - 0.09, z + 0.004); }   // the light strips
    LIGHT(f); f.box(-hw + 0.01, 0.05, -0.105, hw - 0.01, 0.062, 0.105);                                 // and their glow at the step
  },
  halo(f, w, h, yc) {
    const r = 0.23, run = Math.max(0, w * 0.34 - r * 0.6), n = w <= 1.6 ? 1 : Math.max(2, Math.round(w / 2.4)), bt = postT(w, h, 0.03, 0.05);
    f.col('#1b1f24');
    f.box(-run, 0.025, -r * 0.82, run, 0.07, r * 0.82); for (const x of [-run, run]) f.cyl(x, 0, r * 0.82, 0.025, 0.07, 24);
    LIGHT(f); f.box(-run, 0, -r, run, 0.025, r); for (const x of [-run, run]) f.cyl(x, 0, r, 0, 0.025, 28);   // the glowing ring at the bottom
    f.col('#c3c8ce'); for (const x of spread(n, run * 0.85)) f.box(x - bt, 0.07, -0.01, x + bt, yc - h / 2 - 0.02, 0.01);   // the blade posts
    f.col('#16191d'); f.box(-w / 2 - 0.018, yc - h / 2 - 0.02, -0.027, w / 2 + 0.018, yc + h / 2 + 0.018, 0.027);
    LIGHT(f); f.box(-w / 2 + 0.02, yc - h / 2 - 0.032, -0.03, w / 2 - 0.02, yc - h / 2 - 0.02, 0.03);      // a light under the board
  },
};
const WALLED = {
  frame(f, w, h) { f.col('#1f2226'); f.box(-w / 2 - 0.03, -h / 2 - 0.03, -0.03, w / 2 + 0.03, h / 2 + 0.03, 0.032); },
  lightbox(f, w, h) {
    f.col('#20242a'); f.box(-w / 2 - 0.03, -h / 2 - 0.03, -0.06, w / 2 + 0.03, h / 2 + 0.03, 0.03);
    LIGHT(f); const e = 0.034, z0 = -0.055, z1 = 0.026;
    f.box(-w / 2 - e, -h / 2 - e, z0, w / 2 + e, -h / 2 - 0.03, z1); f.box(-w / 2 - e, h / 2 + 0.03, z0, w / 2 + e, h / 2 + e, z1);
    f.box(-w / 2 - e, -h / 2 - 0.03, z0, -w / 2 - 0.03, h / 2 + 0.03, z1); f.box(w / 2 + 0.03, -h / 2 - 0.03, z0, w / 2 + e, h / 2 + 0.03, z1);
  },
  floating(f, w, h) {
    f.col('#eceae6'); f.box(-w / 2, -h / 2, -0.004, w / 2, h / 2, 0.03);
    f.col('#d2d6dc'); for (const px of spread(Math.max(2, Math.round(w / 1.8) + 1), w / 2 - 0.05)) for (const py of [h / 2 - 0.05, -h / 2 + 0.05]) f.rod([px, py, -0.06], [px, py, 0.036], 0.014, 10);   // pins along a long one
  },
  neon(f, w, h) {
    f.col('#1a1d21'); f.box(-w / 2 - 0.015, -h / 2 - 0.015, -0.03, w / 2 + 0.015, h / 2 + 0.015, 0.032);
    LIGHT(f); const o = 0.05;
    for (const [a, b] of [[[-w / 2 - o, -h / 2 - o], [w / 2 + o, -h / 2 - o]], [[w / 2 + o, -h / 2 - o], [w / 2 + o, h / 2 + o]], [[w / 2 + o, h / 2 + o], [-w / 2 - o, h / 2 + o]], [[-w / 2 - o, h / 2 + o], [-w / 2 - o, -h / 2 - o]]]) f.rod([a[0], a[1], 0.02], [b[0], b[1], 0.02], 0.011, 8);
    f.col('#6b7078'); for (const x of spread(Math.max(2, Math.round(w / 1.8) + 1), w / 2 + o)) for (const y of [h / 2 + o, -h / 2 - o]) f.rod([x, y, -0.04], [x, y, 0.02], 0.008, 6);
  },
};
/** The builder for a sign geometry key ('type@style' at its own face, or 'type@style#w×h'), or null. */
function signBuilder(key) {
  const P = parseSignGeoKey(key); if (!P) return null;
  if (P.family === 'stand') return f => STANDING[P.v](f, P.w, P.h, P.y);
  return f => { f.push(0, P.y, 0); WALLED[P.v](f, P.w, P.h); f.pop(); };
}
for (const t of Object.keys(INDOOR_SIGNS)) D[t] = signBuilder(`${t}@${stylesOf(t)[0].id}`);   // the type in its plain style
D.mailboxes = f => {
  f.col('#8c6a3c'); f.box(-0.9, 0.45, -0.15, 0.9, 1.5, 0.02);
  f.col('#c9a45a'); for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) { const x = -0.86 + c * 0.215, y = 0.5 + r * 0.25; f.box(x, y, 0.02, x + 0.2, y + 0.22, 0.035); }
};
D.dance_floor = f => {
  const n = 5, s = 4.4 / n, cols = ['#ff006e', '#3a86ff', '#ffbe0b', '#8338ec', '#06d6a0', '#fb5607'];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { f.col(cols[(i * 3 + j * 2) % cols.length], 0, 4); f.box(-2.2 + i * s + 0.02, 0, -2.2 + j * s + 0.02, -2.2 + (i + 1) * s - 0.02, 0.025, -2.2 + (j + 1) * s - 0.02, 'b'); }
  f.col(C.dark); f.box(-2.2, 0, -2.2, 2.2, 0.018, 2.2, 'b');
};
D.reception = f => {
  f.tint(); f.box(-1.5, 0, 0.25, 1.5, 1.15, 0.45); f.box(-1.5, 0, -0.45, -1.35, 1.15, 0.25); f.box(1.35, 0, -0.45, 1.5, 1.15, 0.25);
  f.col('#e5e2dc'); f.box(-1.55, 1.15, 0.2, 1.55, 1.19, 0.5); f.col(C.woodL); f.box(-1.35, 0.72, -0.45, 1.35, 0.76, 0.25);
  f.col('#c9a45a', 0, 3); f.box(-1.2, 0.6, 0.45, 1.2, 0.66, 0.46);
  bigMonitor(f, -0.3, 0.02, P); f.col('#3a3f47'); f.box(-0.5, 0.76, -0.35, -0.1, 0.775, -0.22);
  potPlant(f, 1.05, -0.2, 0.5, '#e8e4dc');
  officeChair(f, 0, -0.85, 0, '#26313f');
};
// the airport's terminal: a departures board (glowing rows of flights), a walk-through security scanner, a baggage belt
D.flight_board = f => {
  f.col(C.black); f.box(-1.6, 1.4, -0.1, 1.6, 2.7, -0.02);
  f.col('#0d1b2a', 0, 1); f.box(-1.54, 1.46, -0.02, 1.54, 2.64, -0.016);
  f.col('#ffd166', 0, 2); f.box(-1.45, 2.47, -0.016, -0.35, 2.57, -0.012);   // DEPARTURES
  const r = rng(17), st = ['#7ff0b2', '#7ff0b2', '#ffd166', '#ff6b6b'];
  for (let k = 0; k < 7; k++) {
    const y = 2.33 - k * 0.13;
    f.col('#e9f1fa', 0, 1); f.box(-1.45, y, -0.016, -1.45 + 0.35 + r() * 0.25, y + 0.07, -0.013);   // time
    f.col('#cfe0f1', 0, 1); f.box(-0.95, y, -0.016, -0.95 + 0.5 + r() * 0.6, y + 0.07, -0.013);    // destination
    f.col(st[Math.floor(r() * st.length)], 0, 2); f.box(0.95, y, -0.016, 1.45, y + 0.07, -0.013);   // status
  }
};
D.security_arch = f => {
  f.col('#c9ced4'); f.box(-0.62, 0, -0.32, -0.5, 2.25, 0.32); f.box(0.5, 0, -0.32, 0.62, 2.25, 0.32); f.box(-0.62, 2.1, -0.32, 0.62, 2.25, 0.32);
  f.col('#3a3f47'); f.box(-0.66, 0, -0.36, -0.46, 0.06, 0.36); f.box(0.46, 0, -0.36, 0.66, 0.06, 0.36);
  f.col('#4ade80', 0, 2); f.box(-0.2, 2.25, -0.05, 0.2, 2.29, 0.05);
  f.col('#9aa4b2'); for (let k = 0; k < 4; k++) f.box(-0.5, 0.4 + k * 0.42, 0.3, -0.48, 0.6 + k * 0.42, 0.31);
};
D.baggage_belt = f => {
  f.col('#5b616a'); f.box(-2.6, 0, -1.05, 2.6, 0.42, 1.05);
  f.col('#2b2f34'); f.box(-2.5, 0.42, -0.95, 2.5, 0.48, 0.95);
  f.col('#3a3f47'); for (let x = -2.4; x < 2.4; x += 0.32) { f.box(x, 0.48, -0.95, x + 0.26, 0.5, -0.55); f.box(x, 0.48, 0.55, x + 0.26, 0.5, 0.95); }
  f.col('#8a9097'); f.box(-2.3, 0.42, -0.4, 2.3, 0.62, 0.4);
  const r = rng(23), cols = ['#c0392b', '#2c3e50', '#1f6f8b', '#8e44ad', '#e67e22', '#27ae60'];
  for (let k = 0; k < 6; k++) { const x = -2.1 + k * 0.8 + r() * 0.2, z = (k % 2 ? 0.75 : -0.75); f.col(cols[Math.floor(r() * cols.length)]); f.box(x - 0.24, 0.5, z - 0.17, x + 0.24, 0.84, z + 0.17); f.col(C.dark); f.box(x - 0.08, 0.84, z - 0.02, x + 0.08, 0.9, z + 0.02); }
};
D.door = f => {
  f.col('#8a7a66'); f.box(-0.62, 0, -0.08, -0.52, 2.22, 0.08); f.box(0.52, 0, -0.08, 0.62, 2.22, 0.08); f.box(-0.62, 2.12, -0.08, 0.62, 2.22, 0.08);
};
export const FURN_DEF = D;

const cache = new Map();
/** { geo, glass } for a catalog type (built lazily, cached). */
/**
 * Where the screens of an item are, in its own frame: for each, the matrix that puts a 1 × 1 quad facing +z exactly over
 * the picture (render/pc-screens.js draws an agent's PC there for its owner). From the same numbers the geometry uses.
 *   desk, desk_l, standing_desk, reception   the large monitor   desk_exec, desk_home   the laptop on it
 *   tv_wall                       the wall screen (a team's board, on its office's floor)
 */
const _sq = new THREE.Matrix4(), _sr = new THREE.Matrix4();
function quadAt(x, y, z, yaw, tilt, cy, fz, w, h) {
  return new THREE.Matrix4().makeTranslation(x, y, z).multiply(_sr.makeRotationY(yaw)).multiply(_sq.makeRotationX(tilt))
    .multiply(new THREE.Matrix4().makeTranslation(0, cy, fz)).multiply(new THREE.Matrix4().makeScale(w, h, 1));
}
const monQuad = (z, y = 0) => quadAt(0, y, z, 0, 0, MON.y0 + MON.h / 2, MON.z + 0.0004, MON.w, MON.h);
// (furniture's laptop: hinged 0.018 up and 0.12 back from its middle, the lid leaning back 0.28; its picture 0.31 × 0.2)
const lapQuad = (x, y, z, yaw = 0) => new THREE.Matrix4().makeTranslation(x, y, z).multiply(_sr.makeRotationY(yaw))
  .multiply(new THREE.Matrix4().makeTranslation(0, 0.018, -0.12)).multiply(_sq.makeRotationX(-0.28))
  .multiply(new THREE.Matrix4().makeTranslation(0, 0.115, 0.0034)).multiply(new THREE.Matrix4().makeScale(0.31, 0.2, 1));
export const SCREENS = Object.freeze({
  desk: { kind: 'monitor', quads: [monQuad(-0.16)] },
  desk_l: { kind: 'monitor', quads: [monQuad(-0.26)] },
  standing_desk: { kind: 'monitor', quads: [monQuad(-0.16, 0.29)] },
  desk_exec: { kind: 'laptop', quads: [lapQuad(0, 0.77, 0.0)] },
  desk_home: { kind: 'laptop', quads: [lapQuad(-0.05, 0.755, -0.05)] },
  // (a meeting table's two laptops: nobody's PC — plain screens only, render/pc-screens.js)
  meeting_table: { kind: 'laptop', plain: true, quads: [lapQuad(-0.9, 0.76, 0.3, P), lapQuad(0.9, 0.76, -0.3, 0)] },
  reception: { kind: 'monitor', quads: [quadAt(-0.3, 0, 0.02, P, 0, MON.y0 + MON.h / 2, MON.z + 0.0004, MON.w, MON.h)] },
  tv_wall: { kind: 'tv', quads: [quadAt(0, 0, -0.016, 0, 0, 1.5, 0.0005, 1.82, 0.92)] },
});

export function furnitureGeometry(type) {
  let g = cache.get(type);
  if (!g) {
    const fn = D[type] || signBuilder(type);
    const f = new FB();
    if (fn) fn(f); else { f.col('#9aa0a8'); f.box(-0.3, 0, -0.3, 0.3, 0.6, 0.3); }
    g = f.build();
    cache.set(type, g);
  }
  return g;
}
