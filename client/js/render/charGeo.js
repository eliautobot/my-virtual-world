// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Procedural character geometry (rest pose, faces +z, left = +x, feet at y = 0).
// One master geometry per LOD contains every style variant; the vertex shader collapses variants that do not match
// the instance's appearance. Vertex attributes: position, normal, aInfo = (bone, part, variant code), aCol (fixed colour).
import * as THREE from 'three';
import { PEL, SPI, CHE, HEA, LUA, LFA, LHA, RUA, RFA, RHA, LTH, LSH, LFO, RTH, RSH, RFO } from './anim.js';

export const PART = { SKIN: 0, HAIR: 1, TOP: 2, BOTTOM: 3, SHOES: 4, ACCENT: 5, EYES: 6, FIXED: 7, UARM: 8, FARM: 9, THU: 10, THL: 11, SHIN: 12, SKIRT: 13, MOUTH: 14, BROW: 15, STUB: 16 };
export const VCAT = { ALL: 0, HAIR: 1, TOP: 2, BOTTOM: 3, ACC: 4, FACIAL: 5, PROP: 6, SKIRT: 7, HAIRNH: 8 };
const bits = (...ks) => ks.reduce((m, k) => m | (1 << k), 0);
const code = (cat, mask = 0) => cat * 65536 + mask;
const HC = [0, 1.575, 0.008], HR = [0.098, 0.12, 0.11];
const sm = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
const s2l = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lin = hex => { const n = parseInt(hex.slice(1), 16); return [s2l(((n >> 16) & 255) / 255), s2l(((n >> 8) & 255) / 255), s2l((n & 255) / 255)]; };

class GB {
  constructor() { this.P = []; this.N = []; this.A = []; this.C = []; this.I = []; this.c = { bone: 0, part: 0, v: 0, col: [1, 1, 1] }; }
  set(o) { if (o.col && typeof o.col === 'string') o = { ...o, col: lin(o.col) }; Object.assign(this.c, o); return this; }
  vert(p, n) {
    const c = this.c;
    this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]); this.A.push(c.bone, c.part, c.v); this.C.push(c.col[0], c.col[1], c.col[2]);
    return this.P.length / 3 - 1;
  }
  tri(a, b, c) {
    const P = this.P, N = this.N;
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const f = cross(e1, e2);
    if (Math.abs(f[0]) + Math.abs(f[1]) + Math.abs(f[2]) < 1e-11) return;
    const d = f[0] * (N[a * 3] + N[b * 3] + N[c * 3]) + f[1] * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + f[2] * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (d < 0) this.I.push(a, c, b); else this.I.push(a, b, c);
  }
  /** Parametric surface: f(v, u) -> {p, n}, v in rows (0..1), u in cols (0..1). keep(v, u) filters quads. */
  surf(nr, nc, f, keep = null) {
    const base = this.P.length / 3;
    for (let i = 0; i <= nr; i++) for (let j = 0; j <= nc; j++) { const r = f(i / nr, j / nc); this.vert(r.p, r.n); }
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
      if (keep && !keep((i + 0.5) / nr, (j + 0.5) / nc)) continue;
      const a = base + i * (nc + 1) + j, b = a + 1, c = a + nc + 1, d = c + 1;
      this.tri(a, b, c); this.tri(b, d, c);
    }
  }
  ellip(c, r, nu, nv, o = {}) {
    const dir = (v, u) => { const ph = v * Math.PI, th = u * TAU; return [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]; };
    this.surf(nv, nu, (v, u) => {
      const d = dir(v, u), k = o.disp ? o.disp(d) : 0;
      const rx = r[0] + k, ry = r[1] + k, rz = r[2] + k;
      let p = [c[0] + d[0] * rx, c[1] + d[1] * ry, c[2] + d[2] * rz];
      if (o.shape) p = o.shape(p, d);
      return { p, n: norm3([d[0] / rx, d[1] / ry, d[2] / rz]) };
    }, o.keep ? (v, u) => o.keep(dir(v, u)) : null);
  }
  /** Surface of revolution: prof = [[radius, y], ...] from top to bottom, around axis `up` through o. */
  lathe(o, up, prof, segs, rx = 1, rz = 1) {
    const ey = norm3(up);
    let ex = cross(ey, [0, 0, 1]); if (Math.hypot(ex[0], ex[1], ex[2]) < 1e-3) ex = [1, 0, 0];
    ex = norm3(ex); const ez = cross(ex, ey);
    const pn = prof.map((q, i) => {
      const a = prof[Math.max(0, i - 1)], b = prof[Math.min(prof.length - 1, i + 1)];
      const dr = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dr, dy) || 1;
      return [-dy / l, dr / l];
    });
    this.surf(prof.length - 1, segs, (v, u) => {
      const i = Math.round(v * (prof.length - 1)), th = u * TAU, cs = Math.cos(th), sn = Math.sin(th);
      const [r, y] = prof[i], [nr, ny] = pn[i];
      const lx = r * cs * rx, lz = r * sn * rz;
      const nl = norm3([nr * cs / rx, ny, nr * sn / rz]);
      return {
        p: [o[0] + ex[0] * lx + ey[0] * y + ez[0] * lz, o[1] + ex[1] * lx + ey[1] * y + ez[1] * lz, o[2] + ex[2] * lx + ey[2] * y + ez[2] * lz],
        n: [ex[0] * nl[0] + ey[0] * nl[1] + ez[0] * nl[2], ex[1] * nl[0] + ey[1] * nl[1] + ez[1] * nl[2], ex[2] * nl[0] + ey[2] * nl[1] + ez[2] * nl[2]],
      };
    });
  }
  capsule(p0, p1, r0, r1, segs, rings, rx = 1, rz = 1) {
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(d[0], d[1], d[2]);
    const prof = [];
    for (let k = 0; k <= rings; k++) { const a = Math.PI / 2 * (1 - k / rings); prof.push([r0 * Math.cos(a), r0 * Math.sin(a)]); }
    for (let k = 0; k <= rings; k++) { const a = -Math.PI / 2 * k / rings; prof.push([r1 * Math.cos(a), -L + r1 * Math.sin(a)]); }
    this.lathe(p0, [-d[0], -d[1], -d[2]], prof, segs, rx, rz);
  }
  cyl(c, axis, r, h, segs, r2 = r) {
    const a = norm3(axis), o = [c[0] + a[0] * h / 2, c[1] + a[1] * h / 2, c[2] + a[2] * h / 2];
    this.lathe(o, a, [[0, 0], [r, 0], [r, -0.0001], [r2, -h + 0.0001], [r2, -h], [0, -h]], segs);
  }
  box(c, h, rot = null) {
    let ax = [1, 0, 0], ay = [0, 1, 0], az = [0, 0, 1];
    if (rot) {
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])).elements;
      ax = [m[0], m[1], m[2]]; ay = [m[4], m[5], m[6]]; az = [m[8], m[9], m[10]];
    }
    const faces = [[ax, ay, az, h[0], h[1], h[2]], [ay, az, ax, h[1], h[2], h[0]], [az, ax, ay, h[2], h[0], h[1]]];
    for (const [n, u, v, hn, hu, hv] of faces) {
      for (const s of [1, -1]) {
        const nn = [n[0] * s, n[1] * s, n[2] * s], ids = [];
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ids.push(this.vert([c[0] + nn[0] * hn + u[0] * hu * su + v[0] * hv * sv, c[1] + nn[1] * hn + u[1] * hu * su + v[1] * hv * sv, c[2] + nn[2] * hn + u[2] * hu * su + v[2] * hv * sv], nn));
        }
        this.tri(ids[0], ids[1], ids[2]); this.tri(ids[0], ids[2], ids[3]);
      }
    }
  }
  ring(c, n, R, r, segs, tube, a0 = 0, a1 = TAU) {
    n = norm3(n);
    let e1 = cross(n, [0, 1, 0]); if (Math.hypot(e1[0], e1[1], e1[2]) < 1e-3) e1 = cross(n, [1, 0, 0]);
    e1 = norm3(e1); const e2 = cross(n, e1);
    this.surf(segs, tube, (v, u) => {
      const th = a0 + (a1 - a0) * v, ph = u * TAU;
      const rad = [e1[0] * Math.cos(th) + e2[0] * Math.sin(th), e1[1] * Math.cos(th) + e2[1] * Math.sin(th), e1[2] * Math.cos(th) + e2[2] * Math.sin(th)];
      const nn = [rad[0] * Math.cos(ph) + n[0] * Math.sin(ph), rad[1] * Math.cos(ph) + n[1] * Math.sin(ph), rad[2] * Math.cos(ph) + n[2] * Math.sin(ph)];
      return { p: [c[0] + rad[0] * R + nn[0] * r, c[1] + rad[1] * R + nn[1] * r, c[2] + rad[2] * R + nn[2] * r], n: nn };
    });
  }
  cone(base, dir, r, h, segs) { this.lathe(base, dir, [[0, h], [r, 0], [0, 0]], segs); }
  build() {
    // compact: drop vertices no triangle references
    const n = this.P.length / 3, map = new Int32Array(n).fill(-1);
    let m = 0;
    for (const i of this.I) if (map[i] < 0) map[i] = m++;
    const pos = new Float32Array(m * 3), nor = new Float32Array(m * 3), info = new Float32Array(m * 3), col = new Float32Array(m * 3);
    for (let i = 0; i < n; i++) {
      const k = map[i]; if (k < 0) continue;
      for (let c = 0; c < 3; c++) { pos[k * 3 + c] = this.P[i * 3 + c]; nor[k * 3 + c] = this.N[i * 3 + c]; info[k * 3 + c] = this.A[i * 3 + c]; col[k * 3 + c] = this.C[i * 3 + c]; }
    }
    const idx = m < 65535 ? new Uint16Array(this.I.length) : new Uint32Array(this.I.length);
    for (let k = 0; k < this.I.length; k++) idx[k] = map[this.I[k]];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.userData.verts = m; g.userData.tris = this.I.length / 3;
    return g;
  }
}

// ------------------------------------------------------------------ hairline helpers
function hairline(frontY, backY, sideY) {
  return d => {
    const lim = d[2] > 0 ? lerp(sideY, frontY, sm(d[2] / 0.75)) : lerp(sideY, backY, sm(-d[2] / 0.9));
    return d[1] > lim;
  };
}
const add = (r, k) => [r[0] + k, r[1] + k, r[2] + k];
// chest lathe profile [relative y, radius] (top -> bottom), shared by body() and the front-z helper
const CHEST = [[0.255, 0], [0.25, 0.08], [0.228, 0.16], [0.18, 0.198], [0.08, 0.188], [-0.02, 0.168], [-0.075, 0.158], [-0.1, 0.152], [-0.105, 0]];
function chestZ(y) {
  const t = y - 1.2;
  for (let k = 0; k < CHEST.length - 2; k++) {
    const [y0, r0] = CHEST[k], [y1, r1] = CHEST[k + 1];
    if (t <= y0 && t >= y1) return -0.01 + (r0 + (r1 - r0) * (t - y0) / (y1 - y0)) * 0.64;
  }
  return 0.09;
}

function body(g, L) {
  const S = [14, 9, 6][L], R = [4, 3, 2][L];
  g.set({ v: 0 });
  // hips / pelvis (bottom clothing)
  g.set({ bone: PEL, part: PART.THU });
  g.ellip([0, 0.93, -0.004], [0.158, 0.108, 0.102], S, R * 2 + 1);
  // abdomen + chest
  g.set({ bone: SPI, part: PART.TOP });
  g.lathe([0, 1.03, -0.008], [0, 1, 0], [[0, 0.15], [0.1, 0.14], [0.138, 0.09], [0.148, 0.02], [0.152, -0.05], [0.14, -0.1], [0, -0.11]], S, 1, 0.66);
  g.set({ bone: CHE });
  g.lathe([0, 1.2, -0.01], [0, 1, 0], CHEST.map(([y, r]) => [r, y]), S, 1, 0.64);
  // neck
  g.set({ part: PART.SKIN });
  g.lathe([0, 1.44, -0.004], [0, 1, 0], [[0.047, 0.055], [0.049, 0], [0.056, -0.06]], Math.max(6, S - 4));
  // head
  g.set({ bone: HEA, part: PART.SKIN });
  g.ellip(HC, HR, [18, 11, 7][L], [12, 8, 5][L], {
    shape: (p, d) => { if (d[1] < 0) { const k = 1 - 0.16 * sm(-d[1] * 1.2); p[0] = HC[0] + (p[0] - HC[0]) * k; } return p; },
  });
  if (L < 2) {
    for (const s of [1, -1]) g.ellip([0.097 * s, 1.568, -0.004], [0.016, 0.028, 0.02], 6, 4);
    // eyes + brows
    for (const s of [1, -1]) {
      if (L === 0) {
        g.set({ part: PART.FIXED, col: '#f2f0ec' }); g.ellip([0.036 * s, 1.589, 0.104], [0.017, 0.012, 0.009], 8, 5);
        g.set({ part: PART.EYES }); g.ellip([0.036 * s, 1.588, 0.111], [0.0092, 0.0098, 0.004], 7, 4);
      } else { g.set({ part: PART.EYES }); g.ellip([0.036 * s, 1.589, 0.108], [0.012, 0.012, 0.006], 5, 3); }
      g.set({ part: PART.BROW }); g.box([0.037 * s, 1.617, 0.106], [0.017, 0.0036, 0.004], [0, 0, -0.08 * s]);
    }
    if (L === 0) {
      g.set({ part: PART.SKIN }); g.ellip([0, 1.566, 0.116], [0.012, 0.019, 0.013], 6, 4);
      g.set({ part: PART.MOUTH }); g.box([0, 1.528, 0.11], [0.016, 0.0028, 0.003]);
    }
  }
  // arms
  for (const s of [1, -1]) {
    g.set({ bone: s > 0 ? LUA : RUA, part: PART.UARM });
    g.capsule([0.19 * s, 1.385, 0], [0.2 * s, 1.12, 0], 0.051, 0.046, Math.max(6, S - 4), R);
    g.set({ bone: s > 0 ? LFA : RFA, part: PART.FARM });
    g.capsule([0.2 * s, 1.12, 0], [0.205 * s, 0.875, 0], 0.045, 0.036, Math.max(6, S - 5), R);
    g.set({ bone: s > 0 ? LHA : RHA, part: PART.SKIN });
    g.ellip([0.207 * s, 0.826, 0.006], [0.027, 0.052, 0.04], L === 2 ? 5 : 8, L === 2 ? 4 : 6);
    if (L === 0) g.capsule([0.19 * s, 0.862, 0.03], [0.186 * s, 0.822, 0.047], 0.012, 0.011, 5, 2);
  }
  // legs
  for (const s of [1, -1]) {
    g.set({ bone: s > 0 ? LTH : RTH, part: PART.THU });
    g.capsule([0.095 * s, 0.915, 0], [0.095 * s, 0.7, 0.002], 0.08, 0.068, Math.max(6, S - 3), R);
    g.set({ part: PART.THL });
    g.capsule([0.095 * s, 0.72, 0.002], [0.095 * s, 0.5, 0.004], 0.068, 0.058, Math.max(6, S - 3), R);
    g.set({ bone: s > 0 ? LSH : RSH, part: PART.SHIN });
    g.capsule([0.095 * s, 0.5, 0.004], [0.095 * s, 0.09, 0], 0.057, 0.04, Math.max(6, S - 4), R);
    g.set({ bone: s > 0 ? LFO : RFO, part: PART.SHOES });
    if (L === 2) g.box([0.095 * s, 0.045, 0.045], [0.048, 0.045, 0.125]);
    else {
      g.box([0.095 * s, 0.05, 0.02], [0.047, 0.04, 0.1]);
      g.ellip([0.095 * s, 0.045, 0.115], [0.047, 0.04, 0.062], 8, 5, { keep: d => d[2] > -0.2 });
      g.set({ part: PART.FIXED, col: '#1d1d1f' }); g.box([0.095 * s, 0.009, 0.045], [0.05, 0.009, 0.13]);
    }
  }
  // skirt / dress flare
  g.set({ bone: PEL, part: PART.SKIRT, v: code(VCAT.SKIRT) });
  g.lathe([0, 1.0, -0.004], [0, 1, 0], [[0.153, 0.03], [0.168, -0.08], [0.2, -0.24], [0.222, -0.33]], S, 1, 0.8);
  g.set({ v: 0 });
}

function tops(g, L) {
  if (L === 2) return;
  const CT = VCAT.TOP;
  // shirt collar (button shirt: top colour, blazer: shirt/accent colour)
  g.set({ bone: CHE, part: PART.TOP, v: code(CT, bits(2)) });
  g.ring([0, 1.432, -0.004], [0, 1, 0.25], 0.058, 0.012, 14, 5, 0.35 + Math.PI / 2, Math.PI * 2 + Math.PI / 2 - 0.35);
  g.set({ part: PART.ACCENT, v: code(CT, bits(3)) });
  g.ring([0, 1.432, -0.004], [0, 1, 0.25], 0.058, 0.012, 14, 5, 0.35 + Math.PI / 2, Math.PI * 2 + Math.PI / 2 - 0.35);
  // blazer: shirt V + tie (placed just in front of the chest surface)
  const vz = (y) => chestZ(y) + 0.004;
  g.set({ part: PART.ACCENT, v: code(CT, bits(3)) });
  { const a = g.vert([-0.055, 1.43, vz(1.43)], [0, 0.3, 1]), b = g.vert([0.055, 1.43, vz(1.43)], [0, 0.3, 1]), c = g.vert([0, 1.22, vz(1.22) + 0.004], [0, 0, 1]); g.tri(a, b, c); }
  if (L === 0) {
    g.set({ part: PART.FIXED, col: '#7b1e2b' });
    const t0 = g.vert([-0.013, 1.405, vz(1.405) + 0.004], [0, 0.2, 1]), t1 = g.vert([0.013, 1.405, vz(1.405) + 0.004], [0, 0.2, 1]);
    const t2 = g.vert([0.017, 1.3, vz(1.3) + 0.006], [0, 0, 1]), t3 = g.vert([0, 1.25, vz(1.25) + 0.007], [0, 0, 1]), t4 = g.vert([-0.017, 1.3, vz(1.3) + 0.006], [0, 0, 1]);
    g.tri(t0, t1, t2); g.tri(t0, t2, t4); g.tri(t4, t2, t3);
    // shirt buttons
    g.set({ part: PART.FIXED, col: '#e8e4dc', v: code(CT, bits(2)) });
    for (const y of [1.37, 1.29, 1.21]) g.box([0, y, vz(y) + 0.002], [0.0055, 0.0055, 0.003]);
  }
  // hoodie: hood + drawstrings
  g.set({ part: PART.TOP, v: code(CT, bits(4)) });
  g.ellip([0, 1.455, -0.08], [0.122, 0.078, 0.07], L === 0 ? 12 : 8, L === 0 ? 7 : 5, { keep: d => d[2] < 0.45 });
  if (L === 0) {
    g.set({ part: PART.ACCENT });
    for (const s of [1, -1]) g.capsule([0.034 * s, 1.41, 0.1], [0.036 * s, 1.3, 0.108], 0.0055, 0.0055, 4, 1);
  }
  // sweater: ribbed neck
  g.set({ part: PART.TOP, v: code(CT, bits(7)) });
  g.ring([0, 1.438, -0.004], [0, 1, 0.1], 0.054, 0.013, 14, 5);
  g.set({ v: 0 });
}

function hair(g, L) {
  const CH = VCAT.HAIR, NH = VCAT.HAIRNH;
  const nu = [22, 13, 8][L], nv = [14, 9, 6][L];
  g.set({ bone: HEA, part: PART.HAIR });
  if (L === 2) {
    g.set({ v: code(CH, bits(1, 2, 3, 6, 7, 9, 11)) }); g.ellip(HC, add(HR, 0.014), nu, nv, { keep: hairline(0.46, -0.3, 0.08) });
    g.set({ v: code(CH, bits(4, 5, 8)) }); g.ellip(HC, add(HR, 0.02), nu, nv, { keep: hairline(0.46, -0.62, -0.45) });
    g.set({ v: code(CH, bits(10)) }); g.ellip(HC, [0.16, 0.18, 0.17], nu, nv, { keep: hairline(0.5, -0.25, 0.05) });
    g.set({ v: 0 });
    return;
  }
  // short family: short, ponytail, bun, spiky
  g.set({ v: code(CH, bits(1, 6, 7, 9)) });
  g.ellip(HC, add(HR, 0.013), nu, nv, { keep: hairline(0.48, -0.3, 0.1), disp: d => 0.005 * sm(d[1]) });
  // side part
  g.set({ v: code(CH, bits(2)) });
  g.ellip(HC, add(HR, 0.016), nu, nv, {
    keep: d => hairline(d[0] < -0.1 ? 0.3 : 0.46, -0.3, 0.08)(d),
    disp: d => 0.011 * Math.max(0, d[0]) * sm(d[1] + 0.3) + 0.007 * sm(d[1]),
  });
  // buzz
  g.set({ v: code(CH, bits(3)) });
  g.ellip(HC, add(HR, 0.004), nu, nv, { keep: hairline(0.5, -0.3, 0.12) });
  // long + bob
  g.set({ v: code(CH, bits(4)) });
  g.ellip(HC, add(HR, 0.016), nu, nv, { keep: hairline(0.47, -0.5, -0.05), disp: d => 0.006 * sm(d[1]) });
  {
    const rows = L === 0 ? 8 : 5, cols = L === 0 ? 14 : 8;
    g.surf(rows, cols, (v, u) => {
      const a = (u - 0.5) * 4.3, yEnd = lerp(1.3, 1.46, sm((Math.abs(a) - 1.2) / 0.9)), y = lerp(1.625, yEnd, v);
      const t = (1.625 - y) / 0.33, rx = lerp(0.114, 0.124, t), rz = lerp(0.124, 0.138, t);
      return { p: [Math.sin(a) * rx, y, 0.006 - Math.cos(a) * rz], n: norm3([Math.sin(a), 0.15, -Math.cos(a)]) };
    });
  }
  g.set({ v: code(CH, bits(5)) });
  g.ellip(HC, add(HR, 0.022), nu, nv, { keep: hairline(0.47, -0.62, -0.62), disp: d => 0.012 * sm(-d[1] * 1.4) + 0.004 * sm(d[1]) });
  // ponytail + bun + spikes
  g.set({ v: code(CH, bits(6)) });
  g.capsule([0, 1.625, -0.118], [0, 1.39, -0.168], 0.032, 0.017, L === 0 ? 8 : 6, 2);
  g.set({ v: code(NH, bits(7)) });
  g.ellip([0, 1.688, -0.052], [0.052, 0.047, 0.052], L === 0 ? 10 : 7, L === 0 ? 7 : 5);
  g.set({ v: code(NH, bits(9)) });
  for (let k = 0; k < 9; k++) {
    const th = k * 2.4, ph = 0.25 + 0.55 * ((k * 0.37) % 1);
    const d = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th) - 0.1];
    const base = [HC[0] + d[0] * (HR[0] + 0.005), HC[1] + d[1] * (HR[1] + 0.005), HC[2] + d[2] * (HR[2] + 0.005)];
    g.cone(base, d, 0.024, 0.055, L === 0 ? 5 : 4);
  }
  // curly
  g.set({ v: code(CH, bits(8)) });
  g.ellip(HC, add(HR, 0.028), nu + 4, nv + 2, {
    keep: hairline(0.44, -0.4, -0.12),
    disp: d => 0.011 * Math.sin(d[0] * 23) * Math.sin(d[1] * 19 + 1) * Math.sin(d[2] * 21 + 2),
  });
  // afro
  g.set({ v: code(CH, bits(10)) });
  g.ellip([HC[0], HC[1] + 0.02, HC[2] - 0.01], [0.165, 0.17, 0.172], nu + 2, nv, {
    keep: hairline(0.52, -0.25, 0.02), disp: d => 0.006 * Math.sin(d[0] * 29) * Math.sin(d[1] * 31) * Math.sin(d[2] * 27),
  });
  // pixie
  g.set({ v: code(CH, bits(11)) });
  g.ellip(HC, add(HR, 0.015), nu, nv, { keep: hairline(0.34, -0.28, 0.08), disp: d => (d[2] > 0.35 && d[1] > 0.25 ? 0.01 : 0) + 0.004 * sm(d[1]) });
  g.set({ v: 0 });
}

function facial(g, L) {
  if (L === 2) return;
  const CF = VCAT.FACIAL;
  const beardKeep = d => {
    if (d[2] < -0.25) return false;
    if (Math.abs(d[0]) > 0.72 && d[1] < 0.12 && d[1] > -0.5) return true;
    if (d[1] > -0.14) return false;
    if (Math.abs(d[0]) < 0.24 && d[1] > -0.46 && d[1] < -0.33 && d[2] > 0.85) return false;
    return true;
  };
  g.set({ bone: HEA, part: PART.HAIR, v: code(CF, bits(1)) });
  g.ellip(HC, add(HR, 0.012), L === 0 ? 20 : 12, L === 0 ? 14 : 9, { keep: beardKeep, disp: d => 0.006 * sm(-d[1] - 0.5) });
  g.set({ part: PART.STUB, v: code(CF, bits(3)) });
  g.ellip(HC, add(HR, 0.0025), L === 0 ? 20 : 12, L === 0 ? 14 : 9, { keep: beardKeep });
  g.set({ part: PART.HAIR, v: code(CF, bits(2, 4)) });
  g.ellip([0, 1.545, 0.113], [0.03, 0.009, 0.008], 8, 4);
  g.set({ v: code(CF, bits(4)) });
  g.ellip([0, 1.487, 0.1], [0.026, 0.028, 0.016], 8, 5);
  g.set({ v: 0 });
}

function accessories(g, L) {
  const CA = VCAT.ACC;
  g.set({ bone: HEA });
  if (L === 0) {
    // glasses / sunglasses / round glasses
    g.set({ part: PART.FIXED, col: '#1a1a1c', v: code(CA, bits(1)) });
    for (const s of [1, -1]) {
      const cx = 0.036 * s, cy = 1.589, cz = 0.119;
      g.box([cx, cy + 0.016, cz], [0.024, 0.0025, 0.0025]); g.box([cx, cy - 0.016, cz], [0.024, 0.0025, 0.0025]);
      g.box([cx + 0.023, cy, cz], [0.0025, 0.016, 0.0025]); g.box([cx - 0.023, cy, cz], [0.0025, 0.016, 0.0025]);
    }
    g.set({ v: code(CA, bits(1, 2, 6)) });
    g.box([0, 1.592, 0.12], [0.012, 0.0025, 0.0025]);
    for (const s of [1, -1]) g.box([0.1 * s, 1.594, 0.062], [0.0028, 0.0028, 0.056]);
    g.set({ col: '#0c0d12', v: code(CA, bits(2)) });
    for (const s of [1, -1]) g.box([0.036 * s, 1.588, 0.119], [0.025, 0.017, 0.003]);
    g.set({ col: '#1a1a1c', v: code(CA, bits(6)) });
    for (const s of [1, -1]) g.ring([0.036 * s, 1.588, 0.119], [0, 0, 1], 0.02, 0.0028, 14, 4);
  } else if (L === 1) {
    g.set({ part: PART.FIXED, col: '#0c0d12', v: code(CA, bits(2)) });
    for (const s of [1, -1]) g.box([0.036 * s, 1.588, 0.119], [0.025, 0.017, 0.003]);
  }
  // cap
  g.set({ part: PART.ACCENT, v: code(CA, bits(3)) });
  const nu = [18, 11, 7][L], nv = [10, 7, 5][L];
  g.ellip(HC, add(HR, 0.03), nu, nv, { keep: d => d[1] > 0.16 });
  g.ellip([0, 1.636, 0.112], [0.088, 0.008, 0.075], L === 2 ? 6 : 10, 4, { keep: d => d[2] > -0.35 });
  if (L === 2) { g.set({ v: 0 }); return; }
  // beanie
  g.set({ v: code(CA, bits(4)) });
  g.ellip(HC, add(HR, 0.03), nu, nv, { keep: d => d[1] > (d[2] > 0 ? lerp(0.04, 0.4, d[2]) : 0.02), disp: d => 0.006 * sm(d[1] * 2) });
  g.ellip(HC, add(HR, 0.037), nu, nv, { keep: d => { const lim = d[2] > 0 ? lerp(0.04, 0.4, d[2]) : 0.02; return d[1] > lim && d[1] < lim + 0.16; } });
  // headphones
  g.set({ part: PART.FIXED, col: '#1f2024', v: code(CA, bits(5)) });
  g.ring([0, 1.572, 0], [0, 0, 1], 0.132, 0.008, L === 0 ? 16 : 10, 5, Math.PI + 0.15, 2 * Math.PI - 0.15);
  g.set({ part: PART.ACCENT });
  for (const s of [1, -1]) g.cyl([0.112 * s, 1.566, 0.002], [s, 0, 0], 0.033, 0.026, L === 0 ? 12 : 8);
  g.set({ v: 0 });
}

function props(g, L) {
  if (L === 2) return;
  const CP = VCAT.PROP, seg = L === 0 ? 12 : 7;
  g.set({ bone: RHA });
  // 1 mug
  g.set({ part: PART.FIXED, col: '#eeeae2', v: code(CP, bits(1)) });
  g.cyl([-0.172, 0.82, 0.03], [0, 0, 1], 0.035, 0.1, seg);
  g.set({ col: '#4a2c1a' }); g.cyl([-0.172, 0.82, 0.079], [0, 0, 1], 0.031, 0.004, seg);
  // 8 coffee to go
  g.set({ col: '#f4f1ea', v: code(CP, bits(8)) });
  g.cyl([-0.172, 0.82, 0.03], [0, 0, 1], 0.036, 0.12, seg, 0.028);
  g.set({ col: '#b88752' }); g.cyl([-0.172, 0.82, 0.032], [0, 0, 1], 0.0345, 0.045, seg, 0.0325);
  g.set({ col: '#2a2a2c' }); g.cyl([-0.172, 0.82, 0.093], [0, 0, 1], 0.037, 0.01, seg);
  // 2 phone
  g.set({ col: '#15161a', v: code(CP, bits(2)) });
  g.box([-0.178, 0.8, 0.022], [0.0045, 0.07, 0.035]);
  // 3 book
  g.set({ col: '#8c2f2f', v: code(CP, bits(3)) });
  g.box([-0.176, 0.8, 0.03], [0.017, 0.092, 0.066]);
  if (L === 0) { g.set({ col: '#f1ece0' }); g.box([-0.176, 0.8, 0.034], [0.0185, 0.085, 0.06]); }
  // 4 paddle
  g.set({ col: '#b58a5a', v: code(CP, bits(4)) });
  g.cyl([-0.205, 0.78, 0.004], [0, 1, 0], 0.013, 0.1, 6);
  g.set({ col: '#c0202a' }); g.cyl([-0.205, 0.665, 0.004], [1, 0, 0], 0.075, 0.012, seg);
  // 5 dumbbell
  g.set({ col: '#2b2d33', v: code(CP, bits(5)) });
  g.capsule([-0.28, 0.815, 0.012], [-0.13, 0.815, 0.012], 0.012, 0.012, 6, 1);
  for (const x of [-0.27, -0.14]) g.cyl([x, 0.815, 0.012], [1, 0, 0], 0.042, 0.035, seg);
  // 6 shopping bag
  g.set({ col: '#c79a62', v: code(CP, bits(6)) });
  g.box([-0.218, 0.615, 0.0], [0.05, 0.125, 0.12]);
  g.set({ col: '#8a6238' }); g.box([-0.212, 0.77, 0.0], [0.006, 0.035, 0.006]);
  // 7 briefcase
  g.set({ col: '#3b2a1f', v: code(CP, bits(7)) });
  g.box([-0.218, 0.62, 0.0], [0.045, 0.12, 0.17]);
  g.set({ col: '#1c1512' }); g.box([-0.212, 0.768, 0.0], [0.012, 0.028, 0.045]);
  g.set({ v: 0 });
}

export function buildCharGeometry(L) {
  const g = new GB();
  body(g, L); tops(g, L); hair(g, L); facial(g, L); accessories(g, L); props(g, L);
  return g.build();
}
