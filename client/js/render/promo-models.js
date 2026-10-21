// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The promotional aircraft's models (the design review 2026-10-03: rebuilt from the ground up, in the city's style, with
// their banners): a high-winged banner-towing light plane, an advertising blimp and a hot-air balloon, each built from
// shaped surfaces — fuselage and hull lofted from cross-sections, wings, tails and fins with their control surfaces,
// wheels and struts, a gondola with engine pods, a balloon envelope of coloured gores with its load tapes, skirt,
// burner frame and wicker basket. Nose along +z, up +y, metres. Bodies are FB geometry (the furniture material: aC,
// with lights that glow at night); the advertisement surfaces are separate geometry with texture coordinates (the
// blimp's panels along both sides of its hull, the band round the balloon and the banner below its basket) — the
// plane's banner is drawn trailing behind it (render/promo-aircraft.js).
import * as THREE from 'three';
import { FB } from './furniture.js';
import { stillBlades } from './rotors.js';

const TAU = Math.PI * 2;

/**
 * A surface lofted along an axis through sections: secs [{ t (along), w, h (half sizes across), c (centre offset: up),
 * n (superellipse: 2 round, larger squarer) }]; axis 'z' (sections in x–y) or 'x' (sections in z–y). Ends closed.
 */
export function loft(f, secs, seg, axis = 'z', caps = true) {
  const rows = secs.map(S => {
    const row = [], n = S.n || 2;
    for (let k = 0; k < seg; k++) {
      const a = k / seg * TAU, c = Math.cos(a), s = Math.sin(a), pc = Math.sign(c) * Math.abs(c) ** (2 / n), ps = Math.sign(s) * Math.abs(s) ** (2 / n);
      const u = S.w * pc, v = (S.c || 0) + S.h * ps, nu = c / Math.max(S.w, 1e-3), nv = s / Math.max(S.h, 1e-3), l = Math.hypot(nu, nv) || 1;
      row.push(axis === 'z' ? f.vert(u, v, S.t, nu / l, nv / l, 0) : f.vert(S.t, v, u, 0, nv / l, nu / l));
    }
    return row;
  });
  for (let i = 0; i + 1 < rows.length; i++) for (let k = 0; k < seg; k++) { const k1 = (k + 1) % seg; f.tri(rows[i][k], rows[i + 1][k], rows[i + 1][k1]); f.tri(rows[i][k], rows[i + 1][k1], rows[i][k1]); }
  if (caps) for (const [i, dir] of [[0, -1], [rows.length - 1, 1]]) {
    const S = secs[i]; if (S.w < 0.005) continue;
    const c = axis === 'z' ? f.vert(0, S.c || 0, S.t, 0, 0, dir) : f.vert(S.t, S.c || 0, 0, dir, 0, 0);
    for (let k = 0; k < seg; k++) f.tri(c, rows[i][k], rows[i][(k + 1) % seg]);
  }
}
/** A flat, slightly thick panel (a wing, a fin): the outline [[a, b], ...] in the plane, thickness t, as a slab. */
export function slab(f, outline, plane, t, at = [0, 0, 0]) {
  const P = (a, b, s) => plane === 'xz' ? [at[0] + a, at[1] + s, at[2] + b] : plane === 'yz' ? [at[0] + s, at[1] + a, at[2] + b] : [at[0] + a, at[1] + b, at[2] + s];
  const N = plane === 'xz' ? [0, 1, 0] : plane === 'yz' ? [1, 0, 0] : [0, 0, 1];
  for (const side of [1, -1]) {
    const v = outline.map(([a, b]) => { const p = P(a, b, side * t / 2); return f.vert(p[0], p[1], p[2], N[0] * side, N[1] * side, N[2] * side); });
    for (let k = 1; k + 1 < v.length; k++) f.tri(v[0], v[k], v[k + 1]);
  }
  for (let k = 0; k < outline.length; k++) {
    const [a0, b0] = outline[k], [a1, b1] = outline[(k + 1) % outline.length], ea = a1 - a0, eb = b1 - b0, l = Math.hypot(ea, eb) || 1;
    const nn = plane === 'xz' ? [eb / l, 0, -ea / l] : plane === 'yz' ? [0, eb / l, -ea / l] : [eb / l, -ea / l, 0];
    const q = [P(a0, b0, t / 2), P(a1, b1, t / 2), P(a1, b1, -t / 2), P(a0, b0, -t / 2)].map(p => f.vert(p[0], p[1], p[2], ...nn));
    f.tri(q[0], q[1], q[2]); f.tri(q[0], q[2], q[3]);
  }
}
/**
 * A wing, tail or fin as one smooth, closed solid (2026-10-14, the product owner: "make everything one solid piece" — the flat slabs read
 * as cardboard and shaded differently with the angle): symmetric airfoil sections — a rounded leading edge, the
 * thickness tapering to a sharp trailing edge (NACA 00xx), smoothly shaded — along its span, both ends closed.
 * plane 'xz': span along x, chord along z, thickness along y (a wing, a tailplane); 'yz': span along y, chord along z,
 * thickness along x (a fin). stations: [{ s (span), le, te (the chord's ends along z: the leading edge the larger),
 * o (the surface's offset across it: y for 'xz', x for 'yz'), t (thickness / chord) }], ascending in s. o.bands:
 * [[u0, u1, colour]] — parts of the chord (0 leading edge … 1 trailing edge) in their own colour (a rudder, elevators).
 */
export function airfoil(f, stations, plane = 'xz', { n = 10, bands = null } = {}) {
  const us = []; for (let k = 0; k <= n; k++) us.push((1 - Math.cos(Math.PI * k / n)) / 2);
  for (const [u0, u1] of bands || []) for (const u of [u0, u1]) if (!us.some(v => Math.abs(v - u) < 1e-4)) us.push(u);
  us.sort((a, b) => a - b);
  const yt = u => 5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);   // per unit chord and thickness
  const dyt = u => 5 * (0.14845 / Math.sqrt(Math.max(u, 1e-6)) - 0.126 - 0.7032 * u + 0.8529 * u * u - 0.4144 * u ** 3);
  const at = (S, u, side) => {
    const c = S.le - S.te, z = S.le - c * u, th = (S.o || 0) + side * yt(u) * S.t * c;
    let nz = u < 1e-6 ? 1 : dyt(u) * S.t, nt = u < 1e-6 ? 0 : side; const l = Math.hypot(nz, nt) || 1; nz /= l; nt /= l;
    return plane === 'xz' ? [S.s, th, z, 0, nt, nz] : [th, S.s, z, nt, 0, nz];
  };
  const base = f.c.slice();
  const strip = (u0, u1, side) => {
    const U = us.filter(u => u >= u0 - 1e-9 && u <= u1 + 1e-9);
    const rows = stations.map(S => U.map(u => f.vert(...at(S, u, side))));
    for (let i = 0; i + 1 < rows.length; i++) for (let k = 0; k + 1 < U.length; k++) { f.tri(rows[i][k], rows[i + 1][k], rows[i + 1][k + 1]); f.tri(rows[i][k], rows[i + 1][k + 1], rows[i][k + 1]); }
  };
  const parts = []; let from = 0;
  for (const [u0, u1, col] of (bands || []).slice().sort((a, b) => a[0] - b[0])) { if (u0 > from) parts.push([from, u0, null]); parts.push([u0, u1, col]); from = u1; }
  if (from < 1) parts.push([from, 1, null]);
  for (const [u0, u1, col] of parts) { if (col) f.col(col); else f.c = base.slice(); for (const side of [1, -1]) strip(u0, u1, side); }
  f.c = base.slice();
  // the ends: each closed by a fan from its mid-chord
  for (const [S, d] of [[stations[0], -1], [stations[stations.length - 1], 1]]) {
    const ring = [...us.map(u => at(S, u, 1)), ...us.slice(1, -1).reverse().map(u => at(S, u, -1))], m = (S.le + S.te) / 2;
    const nrm = plane === 'xz' ? [d, 0, 0] : [0, d, 0];
    const c = f.vert(...(plane === 'xz' ? [S.s, S.o || 0, m] : [S.o || 0, S.s, m]), ...nrm);
    const vs = ring.map(p => f.vert(p[0], p[1], p[2], ...nrm));
    for (let k = 0; k < vs.length; k++) f.tri(c, vs[k], vs[(k + 1) % vs.length]);
  }
}
/** A wheel with its tyre, axle across x. */
export function wheel(f, x, y, z, r, w) {
  f.col('#1d1f22');
  f.push(x, y, z, Math.PI / 2); f.stack.push(f.m.clone()); f.m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  f.lathe(0, 0, [[0, -w / 2], [r * 0.8, -w / 2], [r, -w / 3], [r, w / 3], [r * 0.8, w / 2], [0, w / 2]], 14);
  f.col('#c9ccd1'); f.lathe(0, 0, [[0, -w / 2 - 0.005], [r * 0.45, -w / 2 - 0.005]], 10); f.lathe(0, 0, [[r * 0.45, w / 2 + 0.005], [0, w / 2 + 0.005]], 10);
  f.pop(); f.pop();
}

// ------------------------------------------------------------------ decals on a lofted hull
/** The section of a loft at t (sections sorted by t), interpolated. */
export function secAt(secs, t) {
  let i = 0; while (i < secs.length - 2 && secs[i + 1].t < t) i++;
  const A = secs[i], B = secs[i + 1], u = Math.max(0, Math.min(1, (t - A.t) / ((B.t - A.t) || 1)));
  const L = (k, d) => (A[k] ?? d) + ((B[k] ?? d) - (A[k] ?? d)) * u;
  return { t, w: L('w', 0), h: L('h', 0), c: L('c', 0), n: L('n', 2) };
}
/** A point on the hull (axis z) at t and angle a (0: +x side, π/2: top), and its outward normal. */
export function hullPoint(secs, t, a) {
  const S = secAt(secs, t), n = S.n, c = Math.cos(a), s = Math.sin(a);
  const pc = Math.sign(c) * Math.abs(c) ** (2 / n), ps = Math.sign(s) * Math.abs(s) ** (2 / n);
  const nu = c / Math.max(S.w, 1e-3), nv = s / Math.max(S.h, 1e-3), l = Math.hypot(nu, nv) || 1;
  return { x: S.w * pc, y: S.c + S.h * ps, z: t, nx: nu / l, ny: nv / l };
}
/** A patch of the hull between t0..t1 and angles a0..a1 (numbers, or functions of t: a stripe that rises or narrows along
 *  it), in colour col, lifted off it by off (a decal: paint, a window). Its rows fall on every section of the hull
 *  inside it too, and it stands off along the surface's true normal: cut straight across a bend in the hull (a nose
 *  narrowing to its tip) the hull showed through it in a ring (2026-10-14). Shaded like the hull under it. */
export function hullDecal(f, secs, col, t0, t1, a0, a1, { off = 0.015, nt = 6, na = 6 } = {}) {
  f.col(col);
  const A0 = typeof a0 === 'function' ? a0 : () => a0, A1 = typeof a1 === 'function' ? a1 : () => a1;
  const ts = [];
  for (let i = 0; i <= nt; i++) ts.push(t0 + (t1 - t0) * i / nt);
  for (const S of secs) if (S.t > t0 + 1e-6 && S.t < t1 - 1e-6) ts.push(S.t);
  ts.sort((x, y) => x - y);
  const E = 1e-3, rows = [];
  for (const t of ts) {
    const row = [], b0 = A0(t), b1 = A1(t);
    for (let k = 0; k <= na; k++) {
      const a = b0 + (b1 - b0) * k / na, p = hullPoint(secs, t, a);
      // the true normal: across the hull (angle) × along it (t), turned outwards
      const pa = hullPoint(secs, t, a + E), pb = hullPoint(secs, t, a - E), pt = hullPoint(secs, Math.min(t + E, secs[secs.length - 1].t), a), pu = hullPoint(secs, Math.max(t - E, secs[0].t), a);
      const u = [pa.x - pb.x, pa.y - pb.y, 0], v = [pt.x - pu.x, pt.y - pu.y, pt.z - pu.z];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
      n = n.map(c => c / l); if (n[0] * p.nx + n[1] * p.ny < 0) n = n.map(c => -c);
      row.push(f.vert(p.x + n[0] * off, p.y + n[1] * off, p.z + n[2] * off, p.nx, p.ny, 0));
    }
    rows.push(row);
  }
  for (let i = 0; i + 1 < rows.length; i++) for (let k = 0; k < na; k++) { f.tri(rows[i][k], rows[i + 1][k], rows[i + 1][k + 1]); f.tri(rows[i][k], rows[i + 1][k + 1], rows[i][k + 1]); }
}
/** The same decal on both sides (a: angles on the +x side; mirrored to π − a on the other). */
export const both = (f, secs, col, t0, t1, a0, a1, o) => { const m = a => (typeof a === 'function' ? t => Math.PI - a(t) : Math.PI - a); hullDecal(f, secs, col, t0, t1, a0, a1, o); hullDecal(f, secs, col, t0, t1, m(a1), m(a0), o); };

// ---------------------------------------------------------------- the banner plane
/** The propeller: two tapered, twisted blades with yellow tips, turning about the nose (render/rotors.js). */
export const PROP_ROTOR = Object.freeze({ blades: 2, r0: 0.1, R: 1.0, chord: 0.17, tipChord: 0.1, thick: 0.035, twist0: 0.6, twist1: 0.2, color: '#24272b', tip: '#f2c94c', tipLen: 0.08, axis: 'z', at: Object.freeze([0, -0.02, 2.66]), blur: 0.85 });
/** The plane's fuselage: from the tail post to the cowling; the cabin's roof rises to meet the wing all along its chord
 *  (it sat below the wing's leading and trailing edges: a dark gap), the windscreen slopes down from the wing to the
 *  cowling. */
const PLANE = [
  { t: -4.15, w: 0.03, h: 0.07, c: 0.56, n: 2.4 }, { t: -3.8, w: 0.1, h: 0.15, c: 0.52, n: 2.6 }, { t: -3.0, w: 0.2, h: 0.27, c: 0.45, n: 2.8 },
  { t: -2.0, w: 0.33, h: 0.42, c: 0.34, n: 3 }, { t: -1.0, w: 0.43, h: 0.58, c: 0.27, n: 3.2 }, { t: -0.6, w: 0.45, h: 0.65, c: 0.22, n: 3.3 },
  { t: 0.6, w: 0.46, h: 0.67, c: 0.2, n: 3.3 }, { t: 0.86, w: 0.46, h: 0.65, c: 0.2, n: 3.2 }, { t: 1.35, w: 0.44, h: 0.52, c: 0.02, n: 2.8 },
  { t: 2.1, w: 0.4, h: 0.4, c: -0.02, n: 2.4 }, { t: 2.45, w: 0.32, h: 0.32, c: -0.02, n: 2 },
];
/** A high-winged light plane (≈ 7 m long, 10.7 m span), white with a red cheat line. opts.parked: the tail wheel on its
 *  spring leg down to the ground (the airport's aircraft, standing nose up on it); opts.noProp: without its propeller
 *  (one that turns is drawn on it: PROP_ROTOR). Everything on it is joined to it (tests/aircraft-models.test.mjs). */
export function bannerPlane(opts = {}) {
  const f = new FB(), white = '#f3f1ea', red = '#c0392b', glass = '#22303d', metal = '#8a9097';
  f.col(white); loft(f, PLANE, 20);
  // paint on the hull: a red cheat line, level along the cabin, sweeping up towards the tail
  const sweep = t => { const u = Math.max(0, -t - 0.4); return 0.12 * (u < 0.8 ? u * u / 1.6 : u - 0.4); };
  both(f, PLANE, red, -3.6, 2.05, t => -0.06 + sweep(t), t => 0.02 + sweep(t), { nt: 22, na: 2 });
  // glass on the hull: the windscreen between the wing and the cowling, the door and rear windows each side
  hullDecal(f, PLANE, glass, 0.9, 1.31, 0.5, Math.PI - 0.5, { nt: 4, na: 10 });
  both(f, PLANE, glass, 0.06, 0.8, 0.16, 0.64, { nt: 4, na: 3 });
  both(f, PLANE, glass, -0.86, -0.06, 0.18, 0.62, { nt: 4, na: 3 });
  both(f, PLANE, '#d9d6cd', -0.02, 0.84, -0.5, -0.46, { nt: 3, na: 1, off: 0.012 });   // the door's lower edge
  both(f, PLANE, '#5d6168', 0.55, 0.66, 0.05, 0.11, { nt: 1, na: 1, off: 0.006 });     // its handle
  // the wing: high on the cabin, white with red tips; fuel caps on top, a landing light in the left leading edge, a pitot
  const W = (t, w, h) => ({ t, w, h, c: 0.86, n: 2.4 });
  f.col(white); loft(f, [W(-4.6, 0.82, 0.1), W(4.6, 0.82, 0.1)], 14, 'x');
  f.col(red); for (const s of [1, -1]) loft(f, [W(s * 4.6, 0.82, 0.1), W(s * 5.1, 0.82, 0.1), W(s * 5.35, 0.5, 0.055)].sort((a, b) => a.t - b.t), 14, 'x');
  f.col('#3a3f45'); for (const s of [1, -1]) f.cyl(s * 1.7, 0, 0.055, 0.95, 0.975, 8);
  f.col('#fff6da', 0, 2); f.box(-2.0, 0.8, 0.76, -1.7, 0.88, 0.822);
  f.col(metal); f.rod([-3.3, 0.79, 0.2], [-3.3, 0.69, 0.25], 0.015, 4); f.rod([-3.3, 0.69, 0.25], [-3.3, 0.69, 0.75], 0.014, 4);
  // struts from the fuselage's lower sides up to the wing, with fittings at each end
  for (const s of [1, -1]) for (const [z0, z1] of [[0.5, 0.42], [-0.1, -0.38]]) {
    f.col('#9aa0a7'); f.rod([s * 0.38, -0.2, z0], [s * 2.65, 0.82, z1], 0.035, 6);
    f.col(metal); f.sph(s * 0.4, -0.19, z0, 0.05, 0.05, 0.05, 6, 4); f.sph(s * 2.64, 0.8, z1, 0.05, 0.04, 0.05, 6, 4);
  }
  // the tail, solid airfoils: a dorsal fillet into the fin, the fin and its red rudder, the tailplane with red elevators
  f.col(white); airfoil(f, [{ s: 0.6, le: -2.05, te: -3.25, t: 0.1 }, { s: 0.96, le: -3.18, te: -3.25, t: 0.1 }], 'yz', { n: 8 });
  airfoil(f, [{ s: 0.5, le: -2.92, te: -3.92, t: 0.1 }, { s: 1.56, le: -3.5, te: -3.92, t: 0.1 }], 'yz');
  f.col(red); airfoil(f, [{ s: 0.46, le: -3.93, te: -4.16, t: 0.13 }, { s: 1.62, le: -3.93, te: -4.28, t: 0.12 }], 'yz', { n: 8 });
  f.col(white); airfoil(f, [{ s: -1.7, le: -3.45, te: -3.85, o: 0.5, t: 0.1 }, { s: 0, le: -3.0, te: -3.85, o: 0.5, t: 0.1 }, { s: 1.7, le: -3.45, te: -3.85, o: 0.5, t: 0.1 }], 'xz');
  f.col(red); airfoil(f, [{ s: -1.52, le: -3.86, te: -4.14, o: 0.5, t: 0.12 }, { s: 0, le: -3.86, te: -4.2, o: 0.5, t: 0.12 }, { s: 1.52, le: -3.86, te: -4.14, o: 0.5, t: 0.12 }], 'xz', { n: 8 });
  // the main gear: sprung legs and braces from the fuselage's underside out to the wheels; a step under the door
  f.col(metal);
  for (const s of [1, -1]) { f.rod([s * 0.3, -0.32, 0.75], [s * 0.86, -1.05, 0.75], 0.042, 6); f.rod([s * 0.28, -0.34, 0.15], [s * 0.85, -1.03, 0.72], 0.034, 6); f.rod([s * 0.83, -1.05, 0.75], [s * 1.0, -1.05, 0.75], 0.03, 6); }
  wheel(f, 0.92, -1.05, 0.75, 0.32, 0.18); wheel(f, -0.92, -1.05, 0.75, 0.32, 0.18);
  for (const s of [1, -1]) { f.col(metal); f.rod([s * 0.3, -0.36, 0.38], [s * 0.5, -0.62, 0.38], 0.025, 5); f.box(s * 0.42, -0.65, 0.28, s * 0.6, -0.62, 0.48); }
  // the tail wheel: its spring leg from inside the tail down to a fork round the wheel (it hung below the fuselage), and
  // the tow hook (the banner's rope starts at it: render/promo-aircraft.js)
  f.col(metal);
  if (opts.parked) {
    f.rod([0, 0.42, -3.66], [0, -0.38, -3.97], 0.032, 6);
    for (const x of [-0.055, 0.055]) f.rod([x, -0.36, -3.97], [x, -0.55, -4.0], 0.016, 5);
    f.rod([-0.06, -0.37, -3.97], [0.06, -0.37, -3.97], 0.02, 5); f.rod([-0.06, -0.55, -4.0], [0.06, -0.55, -4.0], 0.014, 5);
    wheel(f, 0, -0.55, -4.0, 0.12, 0.07);
  } else { f.rod([0, 0.47, -3.85], [0, 0.26, -3.95], 0.026, 5); f.rod([-0.04, 0.25, -3.95], [0.04, 0.25, -3.95], 0.012, 4); wheel(f, 0, 0.25, -3.95, 0.1, 0.06); }
  f.col('#5d6168'); f.rod([0, 0.5, -4.02], [0, 0.32, -4.2], 0.022, 5); f.sph(0, 0.31, -4.21, 0.035, 0.035, 0.035, 6, 4);
  // the cowling, red (one shell a whisker over the fuselage's nose: no white seam), the spinner, two air intakes either
  // side of it, the exhaust stack below
  f.col(red); loft(f, [{ t: 2.12, w: 0.402, h: 0.402, c: -0.02, n: 2.4 }, { t: 2.45, w: 0.326, h: 0.326, c: -0.02, n: 2 }, { t: 2.62, w: 0.26, h: 0.26, c: -0.02 }], 20, 'z');
  f.col('#e8e6df'); f.push(0, -0.02, 2.62); f.stack.push(f.m.clone()); f.m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)); f.lathe(0, 0, [[0.14, 0], [0.12, -0.14], [0.06, -0.26], [0, -0.3]], 12); f.pop(); f.pop();
  f.col('#1e2226'); for (const s of [1, -1]) f.sph(s * 0.17, -0.14, 2.6, 0.07, 0.045, 0.035, 8, 4);
  f.col('#3b3f45'); f.rod([0.22, -0.32, 2.1], [0.26, -0.42, 1.52], 0.04, 6);
  // the propeller, standing still (one that turns is drawn on a flying plane)
  if (!opts.noProp) stillBlades(f, PROP_ROTOR, 1.2);
  // lights: red on the left wing tip, green on the right, white on the rudder's trailing edge, a red beacon on the fin
  f.col('#ff3b30', 0, 2); f.cyl(5.37, 0.15, 0.045, 0.82, 0.9, 6);
  f.col('#34c759', 0, 2); f.cyl(-5.37, 0.15, 0.045, 0.82, 0.9, 6);
  f.col('#ffffff', 0, 2); f.cyl(0, -4.235, 0.035, 1.02, 1.14, 6);
  f.col('#ff3b30', 0, 2); f.cyl(0, -3.62, 0.04, 1.44, 1.56, 6);
  return f.build().geo;
}

// ---------------------------------------------------------------- the blimp
const BLIMP_L = 48, BLIMP_R = 6.4;
const blimpR = t => { const u = (t + BLIMP_L / 2) / BLIMP_L; return BLIMP_R * (u < 0.38 ? Math.sin(Math.min(1, u / 0.38) * Math.PI / 2) ** 0.62 : Math.cos(Math.min(1, (u - 0.38) / 0.62) * Math.PI / 2) ** 0.78) + 0.05; };
/** The airship (48 m): a smooth hull, four fins with their rudders and elevators, gondola, engine pods. */
export function blimp() {
  const f = new FB(), secs = [];
  for (let i = 0; i <= 28; i++) { const t = BLIMP_L / 2 - (i / 28) * BLIMP_L; secs.push({ t, w: blimpR(t), h: blimpR(t), c: 0 }); }
  f.col('#eceae4'); loft(f, secs.reverse(), 28);
  // a coloured band along the keel, on the hull's surface
  f.col('#1f4e79');
  {
    const NT = 24, NA = 4, rows = [];
    for (let i = 0; i <= NT; i++) {
      const t = -BLIMP_L / 2 + 5 + i * (BLIMP_L - 10) / NT, r = blimpR(t) + 0.03, row = [];
      for (let j = 0; j <= NA; j++) { const a = -Math.PI / 2 - 0.42 + j * 0.84 / NA, c = Math.cos(a), sn = Math.sin(a); row.push(f.vert(c * r, sn * r, t, c, sn, 0)); }
      rows.push(row);
    }
    for (let i = 0; i < NT; i++) for (let j = 0; j < NA; j++) { f.tri(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1]); f.tri(rows[i][j], rows[i + 1][j + 1], rows[i][j + 1]); }
  }
  f.col('#1f4e79'); loft(f, [{ t: BLIMP_L / 2 - 1.4, w: blimpR(BLIMP_L / 2 - 1.4) + 0.04, h: blimpR(BLIMP_L / 2 - 1.4) + 0.04 }, { t: BLIMP_L / 2 + 0.06, w: 0.3, h: 0.3 }], 28);
  // fins in an X, each with its control surface
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    f.stack.push(f.m.clone()); f.m.multiply(new THREE.Matrix4().makeRotationZ(a));
    f.col('#eceae4'); slab(f, [[blimpR(-17) - 0.3, -16.5], [blimpR(-17) + 4.6, -19.2], [blimpR(-17) + 4.6, -21.6], [blimpR(-21) - 0.2, -21.4]], 'xz', 0.32, [0, 0, 0]);
    f.col('#1f4e79'); slab(f, [[blimpR(-21) - 0.2, -21.45], [blimpR(-17) + 4.6, -21.65], [blimpR(-17) + 4.2, -23.0], [blimpR(-22.5) + 0.2, -22.8]], 'xz', 0.24, [0, 0, 0]);
    f.pop();
  }
  // the gondola: a streamlined car under the hull, a band of windows, lights
  const gy = -BLIMP_R - 1.0;
  f.col('#dcd8cf'); loft(f, [{ t: -5.2, w: 0.3, h: 0.35, c: gy }, { t: -4.4, w: 1.15, h: 0.95, c: gy, n: 2.6 }, { t: 3.0, w: 1.3, h: 1.05, c: gy, n: 2.8 }, { t: 4.6, w: 0.9, h: 0.75, c: gy - 0.05, n: 2.4 }, { t: 5.4, w: 0.25, h: 0.25, c: gy - 0.1 }], 16);
  f.col('#2a3644', 0, 2); for (const s of [1, -1]) slab(f, [[-3.6, gy + 0.05], [4.2, gy + 0.05], [4.0, gy + 0.6], [-3.4, gy + 0.6]].map(([a, b]) => [b, a]), 'yz', 0.02, [s * 1.31, 0, 0]);
  f.col('#2a3644'); slab(f, [[-0.7, gy + 0.1], [0.7, gy + 0.1], [0.55, gy + 0.62], [-0.55, gy + 0.62]], 'xy', 0.02, [0, 0, 4.95]);
  // engine pods on outriggers either side of the gondola's back, ducted propellers
  for (const s of [1, -1]) {
    f.col('#9aa0a7'); f.rod([s * 1.2, gy + 0.3, -2.6], [s * 3.0, gy + 0.6, -2.6], 0.09, 6);
    f.col('#4b5157'); f.stack.push(f.m.clone()); f.m.multiply(new THREE.Matrix4().makeTranslation(s * 3.2, gy + 0.6, -2.6).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    f.lathe(0, 0, [[0, -1.3], [0.38, -1.0], [0.42, 0.4], [0.2, 1.0], [0, 1.1]], 12);
    f.col('#1f4e79'); f.lathe(0, 0, [[0.95, -1.4], [1.0, -1.4], [1.0, -0.9], [0.95, -0.9], [0.95, -1.4]], 18);
    f.pop();
  }
  // mooring cone at the nose, lights on the tail and the gondola (glowing at night)
  f.col('#ff3b30', 0, 2); f.cyl(BLIMP_R * 0.0, 0, 0.12, BLIMP_R - 0.1, BLIMP_R + 0.12, 8);
  f.col('#ffffff', 0, 2); f.cyl(0, -BLIMP_L / 2 + 0.4, 0.15, -0.2, 0.2, 8);
  return f.build().geo;
}
/**
 * The blimp's advertisement panels: the hull's surface along both sides between t0 and t1 and the angles about its
 * side, a little proud of it, reading front to back on each side (uv: u along, v up).
 */
export function blimpPanels() {
  const pos = [], uv = [], nrm = [], idx = [], N = 24, M = 10, t0 = -14, t1 = 15, a0 = -0.62, a1 = 0.62;
  for (const s of [1, -1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= M; j++) for (let i = 0; i <= N; i++) {
      const t = t0 + (t1 - t0) * i / N, a = a0 + (a1 - a0) * j / M, r = blimpR(t) + 0.06, c = Math.cos(a), sn = Math.sin(a);
      pos.push(s * c * r, sn * r, t); nrm.push(s * c, sn, 0);
      uv.push(s > 0 ? 1 - i / N : i / N, j / M);   // read from either side, the text starts at the nose
    }
    for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) { const a = base + j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; if (s > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
export const BLIMP_PANEL_ASPECT = (15 - -14) / (1.24 * BLIMP_R);   // the panel's width over its height (≈ 3.6)

// ---------------------------------------------------------------- the hot-air balloon
// the envelope's profile (radius, height above the basket's floor): a teardrop on a narrowing throat
const ENV = [[0.0, 27.0], [3.2, 26.6], [6.2, 25.2], [8.3, 22.8], [9.3, 19.8], [9.4, 17.0], [8.8, 14.2], [7.4, 11.6], [5.5, 9.4], [3.6, 7.6], [2.3, 6.6]];
const envR = y => { for (let i = 0; i + 1 < ENV.length; i++) { const [r0, y0] = ENV[i], [r1, y1] = ENV[i + 1]; if (y <= y0 && y >= y1) return r0 + (r1 - r0) * (y - y0) / (y1 - y0); } return 0; };
/**
 * The balloon (27 m tall): sixteen gores, every other one taking the balloon's own colour (the instance's), the rest
 * white, load tapes round it and down its seams; the skirt, the cables, the burner frame and the wicker basket.
 */
export function balloon() {
  const f = new FB(), G = 16;
  const prof = ENV.map(([r, y]) => [r, y]).reverse();
  for (let k = 0; k < G; k++) {
    const a0 = k / G * TAU, a1 = (k + 1) / G * TAU;
    if (k % 2) f.col('#f4f2ec'); else f.col('#ffffff', 1);   // tinted gores take the instance's colour
    f.lathe(0, 0, prof, 4, a0, a1);
  }
  // load tapes down the seams and round the envelope
  f.col('#3a3530');
  for (let k = 0; k < G; k++) { const a = k / G * TAU; for (let i = 0; i + 1 < ENV.length; i++) { const [r0, y0] = ENV[i], [r1, y1] = ENV[i + 1]; f.rod([Math.sin(a) * (r0 + 0.04), y0, Math.cos(a) * (r0 + 0.04)], [Math.sin(a) * (r1 + 0.04), y1, Math.cos(a) * (r1 + 0.04)], 0.035, 3); } }
  for (const y of [21, 13]) { const r = envR(y) + 0.05; f.lathe(0, 0, [[r, y - 0.06], [r, y + 0.06]], 32); }
  // the skirt (scoop) below the throat, the cables to the basket
  f.col('#c0392b'); f.lathe(0, 0, [[2.3, 6.6], [2.0, 5.0]], 24);
  f.col('#2b2b2b'); for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + 0.2; f.rod([Math.sin(a) * 2.2, 6.6, Math.cos(a) * 2.2], [Math.sin(a) * 0.6, 2.0, Math.cos(a) * 0.6], 0.025, 3); }
  // the burner frame and its two burners
  f.col('#8d9399'); f.box(-0.65, 1.95, -0.65, 0.65, 2.05, 0.65, 'b'); for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) f.rod([x, 2.0, z], [x * 1.05, 1.2, z * 1.05], 0.03, 4);
  f.col('#5d6168'); f.cyl(-0.25, 0, 0.17, 2.05, 2.45, 10); f.cyl(0.25, 0, 0.17, 2.05, 2.45, 10);
  // the wicker basket with its padded leather rim
  f.col('#a07a4c'); f.box(-0.75, 0, -0.75, 0.75, 1.15, 0.75);
  f.col('#5a3a24'); f.box(-0.8, 1.1, -0.8, 0.8, 1.22, 0.8);
  f.col('#7d5a36'); for (let i = 0; i < 5; i++) { const y = 0.12 + i * 0.22; f.box(-0.77, y, -0.77, 0.77, y + 0.03, 0.77); }
  return f.build().geo;
}
/** The band round the envelope's widest part, the advertisement going round it twice (uv). */
export function balloonBand() {
  const pos = [], uv = [], nrm = [], idx = [], N = 24, ys = [15.2, 16.6, 18.0, 19.4, 20.8];
  for (let half = 0; half < 2; half++) {   // the advertisement twice round, each half its own strip (no seam inside)
    const base = pos.length / 3;
    ys.forEach((y, j) => { const r = envR(y) + 0.08; for (let i = 0; i <= N; i++) { const a = (half * N + i) / (2 * N) * TAU; pos.push(Math.sin(a) * r, y, Math.cos(a) * r); nrm.push(Math.sin(a), 0, Math.cos(a)); uv.push(i / N, j / (ys.length - 1)); } });
    for (let j = 0; j + 1 < ys.length; j++) for (let i = 0; i < N; i++) { const a = base + j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
/** The banner hanging below the basket on two lines: both faces (the back's text the right way round too). */
export function balloonBanner() {
  const w = 9, h = 2.6, top = -3.4, pos = [], uv = [], nrm = [], idx = [];
  for (const s of [1, -1]) {
    const b = pos.length / 3;
    for (const [x, y, u, v] of [[-w / 2, top - h, 0, 0], [w / 2, top - h, 1, 0], [w / 2, top, 1, 1], [-w / 2, top, 0, 1]]) { pos.push(x * s, y, s * 0.01); nrm.push(0, 0, s); uv.push(u, v); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}
/** The lines from the basket down to the hanging banner's top corners, and its weighted pole. */
export function balloonBannerRig() {
  const f = new FB();
  f.col('#2b2b2b'); f.rod([-0.6, 0, 0], [-4.5, -3.4, 0], 0.02, 3); f.rod([0.6, 0, 0], [4.5, -3.4, 0], 0.02, 3);
  f.col('#8a6a48'); f.rod([-4.6, -3.4, 0], [4.6, -3.4, 0], 0.05, 5); f.rod([-4.6, -6.0, 0], [4.6, -6.0, 0], 0.06, 5);
  return f.build().geo;
}
export const BALLOON_BANNER_ASPECT = 9 / 2.6, BALLOON_BAND_ASPECT = (Math.PI * 2 * 9.3 / 2) / 5.6;
