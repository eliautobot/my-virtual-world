// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The lounge's furniture (Floor Themes' lounge, 2026-10-23: "a fancy sit back and relax area, modern organic, elegant, soft
// lighting ... sculptures that fit the mood ... relaxing yet social vibes ... the little stage: agents playing music and
// instruments in the future"): curved velvet sofas and a serpentine sofa to talk across, bouclé and shell chairs, poufs,
// a stone coffee table, side tables with lamps, a fire table, organic rugs, an arc lamp, sculptures (twisted bronze,
// balanced stones, a ring), ceramic vases, planters, lit wall niches, a slatted wood wall, sconces, abstract art, warm
// light strips, a terrazzo bar and its back bar, and the stage (a velvet curtain, spotlights, a grand piano, a double
// bass, a microphone). Item-local frame as render/furniture.js: +z the front, y up; the sizes match shared/catalog.js.
// Light: col(hex, tint, emit): 1 a soft glow by day and night (lamp shades, niches), 2 a lamp at night, 3 bright, 4 flicker
// (the fire); glass with a glow (halo, emit 7: seen only after dark) for the light round lamps and the stage's beams.
import * as THREE from 'three';
import { trackPath, gapU, barStools } from '/shared/bar-shape.js';
import { SINGER, BASSIST, MIC, BASS, BASS_SHAPE, stringZ } from '/shared/stage.js';

const TAU = Math.PI * 2, P = Math.PI, H = Math.PI / 2;
const C = { walnut: '#5b3a26', oak: '#a37c55', brass: '#b8924a', stone: '#d6c8b2', stoneD: '#a8977f', cream: '#ece4d6', black: '#141416', warm: '#ffd9a6', glow: '#ffe7c4' };
const halo = (f, hex, emit = 7) => { f.glass(hex); f.c[3] = emit * 2; };   // (7: light in the air, only after dark)
const rotX = (f, a) => { f.m.multiply(new THREE.Matrix4().makeRotationX(a)); };
const rotZ = (f, a) => { f.m.multiply(new THREE.Matrix4().makeRotationZ(a)); };
/** A flat shape (points [x, z], going round) raised from y0 to y1: its top, its sides (and its underside when lifted). */
export function prism(f, pts, y0, y1, bottom = false) {
  const n = pts.length, cx = pts.reduce((t, p) => t + p[0], 0) / n, cz = pts.reduce((t, p) => t + p[1], 0) / n;
  const c = f.vert(cx, y1, cz, 0, 1, 0);
  const top = pts.map(p => f.vert(p[0], y1, p[1], 0, 1, 0));
  for (let i = 0; i < n; i++) f.tri(c, top[i], top[(i + 1) % n]);
  if (bottom) { const cb = f.vert(cx, y0, cz, 0, -1, 0), bt = pts.map(p => f.vert(p[0], y0, p[1], 0, -1, 0)); for (let i = 0; i < n; i++) f.tri(cb, bt[(i + 1) % n], bt[i]); }
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    const out = (dz * ((a[0] + b[0]) / 2 - cx) - dx * ((a[1] + b[1]) / 2 - cz)) >= 0 ? 1 : -1;   // (the side's normal points out of the shape)
    f.quad([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], [out * dz / L, 0, -out * dx / L]);
  }
}
/** A double bass in its own frame (shared/stage.js BASS_SHAPE: its end pin at the origin, y up along it, z the way its
 *  strings face): the body's two bouts, f-holes, the bridge, the tailpiece, the fingerboard over the neck, the pegbox and
 *  scroll, four strings from the tailpiece over the bridge to the nut. */
function doubleBass(f) {
  const B = BASS_SHAPE, slope = Math.atan((B.nut[1] - B.bridge[1]) / (B.nut[0] - B.bridge[0]));
  f.col('#9aa0a8'); f.rod([0, 0, 0], [0, B.bottom + 0.03, 0], 0.008, 4);
  f.col('#7a3b1e'); f.sph(0, B.lower[0], 0, B.lower[1], B.lower[2], B.lower[3], 16, 9); f.sph(0, B.upper[0], 0, B.upper[1], B.upper[2], B.upper[3], 14, 8);
  f.col('#1a0d06'); for (const s of [-1, 1]) f.rod([s * 0.085, 0.56, 0.093], [s * 0.078, 0.7, 0.077], 0.006, 4);
  f.col('#d9b98a'); f.box(-0.06, B.bridge[0] - 0.006, 0.08, 0.06, B.bridge[0] + 0.006, B.bridge[1]);
  f.col('#141010'); f.rod([0, B.bottom + 0.04, 0.06], [0, 0.6, 0.135], 0.02, 4);   // (the tailpiece)
  // the fingerboard (its top just under the strings) and the neck under it, both along the strings' slope
  const along = (y0, y1, z0, w, d) => { f.push(0, y0, z0); rotX(f, slope); f.box(-w, 0, -d, w, (y1 - y0) / Math.cos(slope), d); f.pop(); };
  f.col('#5e2c14'); along(B.neck, B.nut[0], stringZ(B.neck) - 0.054, 0.026, 0.03);
  f.col('#141010'); along(B.board[0], B.board[1], stringZ(B.board[0]) - 0.016, 0.034, 0.008);
  f.col('#e8dcc0'); f.box(-0.03, B.nut[0] - 0.006, B.nut[1] - 0.025, 0.03, B.nut[0] + 0.006, B.nut[1] + 0.004);
  // the pegbox and its scroll, the tuning keys out to each side
  f.col('#5e2c14'); f.box(-0.026, B.nut[0], 0.03, 0.026, B.nut[0] + 0.15, 0.095); f.sph(0, B.nut[0] + 0.18, 0.062, 0.03, 0.04, 0.036, 8, 5);
  f.col(C.brass); for (const y of [B.nut[0] + 0.04, B.nut[0] + 0.1]) for (const s of [-1, 1]) { f.rod([s * 0.026, y, 0.062], [s * 0.065, y, 0.062], 0.005, 4); f.sph(s * 0.07, y, 0.062, 0.008, 0.016, 0.012, 6, 4); }
  f.col('#d7c9a8');
  for (const k of [-1.5, -0.5, 0.5, 1.5]) {
    const t = [k * 0.009, 0.6, 0.14], b = [k * 0.017, B.bridge[0], B.bridge[1]], n = [k * 0.009, B.nut[0], B.nut[1]];
    f.rod(t, b, 0.0022, 3); f.rod(b, n, 0.0022, 3);
  }
}
export const blob = (rx, rz, n = 30, k = 0) => Array.from({ length: n }, (_, i) => { const a = i / n * TAU, r = 1 + 0.07 * Math.sin(3 * a + 1 + k) + 0.05 * Math.sin(5 * a + 2 + k); return [Math.sin(a) * rx * r, Math.cos(a) * rz * r]; });
/** A rounded section (r, y) going round, for a band of upholstery turned about a centre. */
export const pad = (r0, y0, r1, y1, k = 0.04) => [[r0 + k, y0], [r1 - k, y0], [r1, y0 + k], [r1, y1 - k], [r1 - k, y1], [r0 + k, y1], [r0, y1 - k], [r0, y0 + k], [r0 + k, y0]];
/** A band turned about (cx, cz) from angle t0 to t1 (lathe angles: 0 is +z), its two ends closed. */
export function band(f, cx, cz, prof, t0, t1, seg) {
  f.lathe(cx, cz, prof, seg, t0, t1);
  const n = prof.length - 1, mr = prof.slice(0, n).reduce((t, p) => t + p[0], 0) / n, my = prof.slice(0, n).reduce((t, p) => t + p[1], 0) / n;
  for (const [t, sg] of [[t0, -1], [t1, 1]]) {
    const sn = Math.sin(t), cs = Math.cos(t), nx = sg * cs, nz = -sg * sn;
    const ctr = f.vert(cx + mr * sn, my, cz + mr * cs, nx, 0, nz), ring = prof.slice(0, n).map(([r, y]) => f.vert(cx + r * sn, y, cz + r * cs, nx, 0, nz));
    for (let i = 0; i < n; i++) f.tri(ctr, ring[i], ring[(i + 1) % n]);
  }
}
/** A sofa along an arc about (cx, cz), seats facing its middle (flip: the middle behind, the seats facing −z): one seamless
 *  curve of upholstery on a dark plinth, a softly rounded back, loose cushions, rounded arms. */
function arcSofa(f, cx, cz, R, a0, a1, flip = false) {
  const s = flip ? -1 : 1, t0 = flip ? a0 : P - a1, t1 = flip ? a1 : P - a0, seg = Math.max(8, Math.round((a1 - a0) * 14));
  f.col('#24180f'); band(f, cx, cz, pad(R - 0.2, 0, R + 0.36, 0.1, 0.01), t0, t1, seg);
  f.tint(); band(f, cx, cz, pad(R - 0.3, 0.1, R + 0.3, 0.38, 0.05), t0, t1, seg);            // the base
  f.tint('#f2f2f2'); band(f, cx, cz, pad(R - 0.33, 0.36, R + 0.3, 0.48, 0.05), t0, t1, seg);  // the seat, a shade lighter
  f.tint('#d6d6d6'); band(f, cx, cz, pad(R + 0.26, 0.36, R + 0.56, 0.88, 0.12), t0, t1, seg);   // the back, rounded on top
  const n = Math.max(2, Math.round((a1 - a0) / 0.42));
  for (let i = 0; i < n; i++) {   // loose cushions against the back, oatmeal and rust
    const a = a0 + (i + 0.5) * (a1 - a0) / n, x = cx + Math.sin(a) * (R + 0.14), z = cz - s * Math.cos(a) * (R + 0.14), yaw = flip ? P + a : -a;
    f.push(x, 0.66, z, yaw); rotX(f, -0.25); f.col(i % 3 === 1 ? '#b0623e' : '#e6dccb'); f.sph(0, 0, 0, 0.21, 0.19, 0.07, 10, 6); f.pop();
  }
  for (const a of [a0, a1]) { const x = cx + Math.sin(a) * (R + 0.02), z = cz - s * Math.cos(a) * (R + 0.02); f.tint('#e8e8e8'); f.sph(x, 0.5, z, 0.17, 0.2, 0.3, 12, 7); f.tint(); f.cyl(x, z, 0.15, 0.1, 0.5, 12); }
}
/** A shape in (z, y) running along z, drawn across x from x0 to x1 down to y0 (a chaise's seat). */
function extrudeX(f, top, y0, x0, x1) {
  for (let i = 0; i + 1 < top.length; i++) {
    const [za, ya] = top[i], [zb, yb] = top[i + 1], dz = zb - za, dy = yb - ya, L = Math.hypot(dz, dy) || 1;
    let ny = -dz / L, nz = dy / L; if (ny < 0) { ny = -ny; nz = -nz; }
    f.quad([[x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb]], [0, ny, nz]);
    for (const [x, sx] of [[x0, -1], [x1, 1]]) f.quad([[x, y0, za], [x, y0, zb], [x, yb, zb], [x, ya, za]], [sx, 0, 0]);
  }
  const [zf, yf] = top[0], [zh, yh] = top[top.length - 1];
  f.quad([[x0, y0, zf], [x1, y0, zf], [x1, yf, zf], [x0, yf, zf]], [0, 0, Math.sign(zf - zh)]);
  f.quad([[x0, y0, zh], [x1, y0, zh], [x1, yh, zh], [x0, yh, zh]], [0, 0, Math.sign(zh - zf)]);
  f.quad([[x0, y0, zf], [x1, y0, zf], [x1, y0, zh], [x0, y0, zh]], [0, -1, 0]);
}

/** A band between two matching paths (outer, inner: as many points), raised from y0 to y1: its top, both sides, its
 *  underside if asked, and its two ends when the path is open. */
export function ringStrip(f, outer, inner, y0, y1, open = false, bottom = false) {
  const n = outer.length, m = open ? n - 1 : n;
  const side = (a, b, ref) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; let nx = dz / L, nz = -dx / L; if (nx * (a[0] - ref[0]) + nz * (a[1] - ref[1]) < 0) { nx = -nx; nz = -nz; } return [nx, 0, nz]; };
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n, o0 = outer[i], o1 = outer[j], i0 = inner[i], i1 = inner[j];
    f.quad([[o0[0], y1, o0[1]], [o1[0], y1, o1[1]], [i1[0], y1, i1[1]], [i0[0], y1, i0[1]]], [0, 1, 0]);
    if (bottom) f.quad([[o0[0], y0, o0[1]], [o1[0], y0, o1[1]], [i1[0], y0, i1[1]], [i0[0], y0, i0[1]]], [0, -1, 0]);
    f.quad([[o0[0], y0, o0[1]], [o1[0], y0, o1[1]], [o1[0], y1, o1[1]], [o0[0], y1, o0[1]]], side(o0, o1, i0));
    f.quad([[i0[0], y0, i0[1]], [i1[0], y0, i1[1]], [i1[0], y1, i1[1]], [i0[0], y1, i0[1]]], side(i0, i1, o0));
  }
  if (open) for (const [k, k2] of [[0, 1], [n - 1, n - 2]]) {
    const o = outer[k], q = inner[k], dx = o[0] - outer[k2][0], dz = o[1] - outer[k2][1], L = Math.hypot(dx, dz) || 1;
    f.quad([[o[0], y0, o[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [o[0], y1, o[1]]], [dx / L, 0, dz / L]);
  }
}
/** A bar stool: a brass foot and column, a velvet seat in the piece's colour, a low curved back. */
export function barStool(f, x, z, yaw) {
  f.push(x, 0, z, yaw);
  f.col(C.brass); f.cyl(0, 0, 0.19, 0, 0.022, 16); f.cyl(0, 0, 0.026, 0.022, 0.66, 8);
  f.lathe(0, 0, [[0.15, 0.29], [0.165, 0.29], [0.165, 0.305], [0.15, 0.305]], 14);
  f.tint(); f.lathe(0, 0, [[0, 0.64], [0.19, 0.64], [0.21, 0.69], [0.19, 0.74], [0, 0.745]], 16);
  f.tint('#dcdcdc'); band(f, 0, 0, pad(0.15, 0.7, 0.2, 0.93, 0.03), P - 0.95, P + 0.95, 10);
  f.pop();
}
/** A dining chair: velvet on four brass legs, its back a closed curve. */
export function diningChair(f, x, z, yaw) {
  f.push(x, 0, z, yaw);
  f.col(C.brass); for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) f.rod([lx * 1.2, 0, lz * 1.2], [lx, 0.4, lz], 0.012, 5);
  f.tint(); f.lathe(0, 0, [[0, 0.39], [0.22, 0.39], [0.245, 0.43], [0.23, 0.48], [0, 0.49]], 16);
  f.tint('#e0e0e0'); band(f, 0, 0.03, pad(0.15, 0.44, 0.26, 0.86, 0.045), P - 1.15, P + 1.15, 14);
  f.pop();
}
/** A round marble table on a brass pedestal with a candle in a hurricane glass. */
export function bistro(f, x, z, r, h = 0.75) {
  f.col(C.brass); f.cyl(x, z, Math.max(0.16, r * 0.5), 0, 0.025, 18); f.cyl(x, z, 0.032, 0.025, h - 0.03, 8);
  f.col('#ece6dc'); f.lathe(x, z, [[0, h - 0.035], [r - 0.012, h - 0.035], [r, h - 0.018], [r - 0.012, h], [0, h]], 26);
  f.col('#f4ead8'); f.cyl(x, z, 0.026, h, h + 0.055, 10); f.col('#ffb347', 0, 2); f.sph(x, h + 0.072, z, 0.011, 0.02, 0.011, 6, 4);
  f.glass('#f0e6d6'); f.cyl(x, z, 0.045, h, h + 0.1, 10, 0.04, false);
}
/** A straight sofa: brass feet, a channel-tufted back, rounded arms, loose seat cushions, a pillow. */
function channelSofa(f, hw, n) {
  f.col(C.brass); for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.cyl(sx * (hw - 0.08), sz * 0.3, 0.024, 0, 0.1, 6);
  f.tint(); f.box(-hw, 0.1, -0.44, hw, 0.36, 0.38);
  const inner = hw * 2 - 0.36, cw = inner / n;
  f.tint('#f2f2f2'); for (let i = 0; i < n; i++) { const x0 = -hw + 0.18 + i * cw + 0.008; f.box(x0, 0.36, -0.24, x0 + cw - 0.016, 0.47, 0.4); }
  const k = Math.round(inner / 0.15);
  f.tint('#d6d6d6'); for (let i = 0; i < k; i++) { const x = -hw + 0.18 + (i + 0.5) * inner / k; f.cyl(x, -0.33, 0.082, 0.36, 0.84, 8); f.sph(x, 0.84, -0.33, 0.082, 0.05, 0.082, 8, 4); }
  for (const sg of [-1, 1]) {
    f.tint(); f.box(sg * hw, 0.1, -0.44, sg * (hw - 0.18), 0.58, 0.38);
    f.push(sg * (hw - 0.09), 0.58, -0.03, 0); rotX(f, H); f.tint('#e8e8e8'); f.cyl(0, 0, 0.09, -0.41, 0.41, 12); f.pop();
  }
  f.col('#e6dccb'); f.push(-hw + 0.42, 0.63, -0.17, 0.25); rotX(f, -0.3); f.sph(0, 0, 0, 0.19, 0.17, 0.06, 10, 6); f.pop();
  if (n > 2) { f.col('#b0623e'); f.push(hw - 0.42, 0.63, -0.17, -0.25); rotX(f, -0.3); f.sph(0, 0, 0, 0.18, 0.16, 0.06, 10, 6); f.pop(); }
}
/** The island bar: a marble counter all the way round on a lacquered, brass-fluted front with a warm light at its
 *  foot (the bartenders' way in at the back), the well, a tower of lit shelves and bottles in the middle, a brass halo
 *  above with globes hanging from it, and its stools all round (shared/bar-shape.js puts them where the seats are). */
function islandBar(f, hx, r) {
  const N = hx > 0 ? 96 : 72, g = gapU(hx, r + 0.16, 0.45), p = (rr, u0 = g) => trackPath(hx, rr, N, u0);
  f.col('#1d1510'); ringStrip(f, p(r - 0.12), p(r - 0.66), 0, 0.1, true);
  f.col('#ffc777', 0, 2); ringStrip(f, p(r - 0.02), p(r - 0.12), 0, 0.012, true);
  f.tint(); ringStrip(f, p(r), p(r - 0.66), 0.1, 1.0, true);
  const fl = p(r + 0.012); f.col(C.brass); for (let i = 1; i < fl.length - 1; i += 2) f.rod([fl[i][0], 0.13, fl[i][1]], [fl[i][0], 0.97, fl[i][1]], 0.011, 4);
  f.col('#ece6dc'); ringStrip(f, p(r + 0.16), p(r - 0.74), 1.0, 1.07, true, true);
  f.col(C.brass); ringStrip(f, p(r + 0.135), p(r + 0.115), 1.07, 1.074, true);
  const rail = p(r + 0.13), foot = p(r - 0.06);
  for (let i = 0; i + 3 < rail.length; i += 3) f.rod([rail[i][0], 0.22, rail[i][1]], [rail[i + 3][0], 0.22, rail[i + 3][1]], 0.016, 6);
  for (let i = 0; i < rail.length; i += 9) f.rod([rail[i][0], 0.22, rail[i][1]], [foot[i][0], 0.1, foot[i][1]], 0.012, 4);
  if (r - 0.74 - 0.3 > 0.55) { f.col('#2b2622'); ringStrip(f, p(r - 0.66), p(r - 0.92), 0, 0.9, true); f.col('#5a544c'); ringStrip(f, p(r - 0.66), p(r - 0.92), 0.9, 0.93, true); }
  // the tower: a walnut cabinet, three glowing shelves of bottles, brass posts, a brass crown
  const th = hx * 0.8, rnd = (k => () => { k = (k * 16807) % 2147483647; return k / 2147483647; })(13);
  f.col('#241a13'); prism(f, trackPath(th, 0.3, 40), 0, 0.95);
  for (const y of [1.25, 1.62, 1.99]) {
    f.col('#e9c48c', 0, 1); prism(f, trackPath(th, 0.29, 40), y - 0.025, y, true);
    const nb = Math.max(10, Math.round((4 * th + 2 * P * 0.22) / 0.12));
    for (const [bx, bz] of trackPath(th, 0.21, nb)) { const c = ['#8a5a2b', '#3e6b3a', '#d7c9a8', '#6b2b2b', '#c9a227', '#b8cfd6'][Math.floor(rnd() * 6)], hgt = 0.17 + rnd() * 0.12; f.col(c); f.lathe(bx, bz, [[0, y], [0.034, y], [0.035, y + hgt * 0.65], [0.013, y + hgt * 0.8], [0.011, y + hgt], [0, y + hgt]], 7); }
  }
  f.col(C.brass); for (const [px, pz] of trackPath(th, 0.29, 4)) f.cyl(px, pz, 0.018, 0.95, 2.4, 6);
  prism(f, trackPath(th, 0.33, 40), 2.4, 2.44, true);
  // the halo: a brass ring with a warm light under it, globes hanging from it, held from the ceiling
  const h0 = p(r + 0.04, 0), h1 = p(r - 0.12, 0);
  f.col(C.brass); ringStrip(f, h0, h1, 2.74, 2.8, false, true);
  f.col('#ffd59a', 0, 1); ringStrip(f, p(r + 0.02, 0), p(r - 0.1, 0), 2.734, 2.738, false, true);
  const gl = p(r - 0.04, 0), step = Math.max(4, Math.round(N / Math.round((4 * hx + 2 * P * r) / 0.75)));
  for (let i = 0; i < gl.length; i += step) { const [x, z] = gl[i]; f.col(C.brass); f.cyl(x, z, 0.006, 2.5, 2.74, 4); f.col(C.glow, 0, 2); f.sph(x, 2.44, z, 0.075, 0.075, 0.075, 10, 7); halo(f, C.warm); f.sph(x, 2.44, z, 0.17, 0.17, 0.17, 10, 7); }
  for (const [x, z] of trackPath(hx, r - 0.04, hx > 0 ? 6 : 4)) { f.col(C.brass); f.cyl(x, z, 0.008, 2.8, 3.2, 4); }
  for (const t of barStools(hx, r)) barStool(f, t.x, t.z, t.yaw);
}

export function addLoungeFurniture(D) {
  // ---------------------------------------------------------------- the redone lounge: bars, tables, sofas, booths
  D.island_bar = f => islandBar(f, 1.8, 1.75);
  D.round_bar = f => islandBar(f, 0, 1.45);
  D.table_two = f => { bistro(f, 0, 0, 0.38); diningChair(f, -0.62, 0, H); diningChair(f, 0.62, 0, -H); };
  D.table_four = f => { bistro(f, 0, 0, 0.55); for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) diningChair(f, sx * 0.6, sz * 0.6, Math.atan2(-sx, -sz)); };
  D.highboy = f => { bistro(f, 0, 0, 0.36, 1.05); for (const [x, z, a] of [[0, -0.52, 0], [0.45, 0.26, -2.09], [-0.45, 0.26, 2.09]]) barStool(f, x, z, a); };
  D.loveseat = f => channelSofa(f, 0.86, 2);
  D.sofa_lounge = f => channelSofa(f, 1.18, 3);
  D.club_chair = f => {
    f.col(C.walnut); for (const [x, z] of [[-0.34, -0.34], [0.34, -0.34], [-0.34, 0.32], [0.34, 0.32]]) f.box(x - 0.025, 0, z - 0.025, x + 0.025, 0.09, z + 0.025);
    f.tint(); f.box(-0.42, 0.09, -0.42, 0.42, 0.38, 0.4);
    f.tint('#f2f2f2'); f.box(-0.27, 0.38, -0.25, 0.27, 0.49, 0.41);
    f.tint('#dadada'); band(f, 0, 0.12, pad(0.4, 0.36, 0.56, 0.92, 0.08), P - 0.95, P + 0.95, 14);
    for (const sg of [-1, 1]) { f.tint(); f.box(sg * 0.27, 0.09, -0.42, sg * 0.44, 0.6, 0.4); f.push(sg * 0.355, 0.6, -0.01, 0); rotX(f, H); f.tint('#e8e8e8'); f.cyl(0, 0, 0.085, -0.41, 0.41, 12); f.pop(); }
  };
  D.booth_round = f => {
    const t0 = P - 1.75, t1 = P + 1.75;
    f.col('#1d1510'); band(f, 0, 0, pad(1.02, 0, 1.5, 0.1, 0.01), t0, t1, 30);
    f.tint(); band(f, 0, 0, pad(0.98, 0.1, 1.52, 0.42, 0.05), t0, t1, 30);
    f.tint('#f2f2f2'); band(f, 0, 0, pad(0.95, 0.4, 1.36, 0.5, 0.05), t0, t1, 30);
    f.tint('#d6d6d6'); for (let k = 0; k <= 24; k++) { const t = t0 + 0.07 + k / 24 * (t1 - t0 - 0.14), x = Math.sin(t) * 1.43, z = Math.cos(t) * 1.43; f.cyl(x, z, 0.088, 0.42, 1.12, 8); f.sph(x, 1.12, z, 0.088, 0.05, 0.088, 8, 4); }
    f.tint(); band(f, 0, 0, pad(1.49, 0.1, 1.58, 1.1, 0.03), t0, t1, 30);
    bistro(f, 0, 0.05, 0.55);
  };
  D.banquette_table = f => {
    f.col('#1d1510'); f.box(-1.26, 0, -0.34, 1.26, 0.08, 0.2);
    f.tint(); f.box(-1.28, 0.08, -0.36, 1.28, 0.42, 0.22);
    f.tint('#f2f2f2'); f.box(-1.24, 0.42, -0.2, 1.24, 0.5, 0.24);
    f.tint('#d6d6d6'); for (let k = 0; k < 16; k++) { const x = -1.2 + (k + 0.5) * 2.4 / 16; f.cyl(x, -0.27, 0.078, 0.42, 1.0, 8); f.sph(x, 1.0, -0.27, 0.078, 0.045, 0.078, 8, 4); }
    f.col(C.brass); f.box(-1.28, 1.0, -0.36, 1.28, 1.02, -0.2);
    for (const x of [-0.62, 0.62]) { bistro(f, x, 0.6, 0.32); diningChair(f, x, 1.2, P); }
  };
  D.drink_ledge = f => {
    f.col(C.brass); for (const x of [-1.05, 0, 1.05]) { f.box(x - 0.02, 0.3, -0.2, x + 0.02, 1.04, -0.17); f.rod([x, 0.86, -0.18], [x, 1.03, 0.04], 0.012, 4); }
    f.col('#ece6dc'); f.box(-1.2, 1.04, -0.2, 1.2, 1.09, 0.12);
    for (const x of [-0.78, 0, 0.78]) barStool(f, x, 0.4, P);
  };
  D.fireplace = f => {   // a low, long fireplace in travertine: a linear fire behind glass, a walnut top with two vases
    f.col('#ddd2bf'); f.box(-1.25, 0, -0.3, 1.25, 1.12, 0.14);
    f.col('#cfc3ae'); f.box(-1.3, 0, 0.14, 1.3, 0.12, 0.3);
    f.col('#16120f'); f.box(-0.95, 0.3, 0.08, 0.95, 0.72, 0.145);
    f.col('#3a2a20'); f.rod([-0.7, 0.35, 0.11], [0.7, 0.37, 0.11], 0.03, 6); f.rod([-0.55, 0.38, 0.1], [0.5, 0.41, 0.12], 0.026, 6);
    for (let i = 0; i < 14; i++) { const x = -0.84 + i * 0.13, h = 0.12 + 0.08 * ((i * 7) % 3); f.col(i % 2 ? '#ff9a3c' : '#ffd166', 0, 4); f.lathe(x, 0.115, [[0, 0.37], [0.036, 0.37], [0.022, 0.37 + h * 0.6], [0, 0.37 + h]], 6); }
    halo(f, '#ff9a3c'); f.box(-0.9, 0.34, 0.1, 0.9, 0.68, 0.14);
    f.glass('#f2eadf'); f.box(-0.96, 0.29, 0.145, 0.96, 0.73, 0.15);
    f.col(C.brass); f.box(-1.0, 0.26, 0.14, 1.0, 0.29, 0.155); f.box(-1.0, 0.73, 0.14, 1.0, 0.76, 0.155);
    f.col(C.walnut); f.box(-1.32, 1.12, -0.3, 1.32, 1.19, 0.2);
    f.col('#efe8dc'); f.lathe(-0.9, -0.05, [[0, 1.19], [0.07, 1.19], [0.1, 1.31], [0.06, 1.47], [0.04, 1.51], [0, 1.51]], 12);
    f.col('#b5653a'); f.lathe(0.95, -0.05, [[0, 1.19], [0.09, 1.19], [0.12, 1.28], [0.08, 1.37], [0, 1.36]], 12);
    f.col('#7a5a3e'); for (const [dx, dz, h] of [[0.12, 0.04, 0.35], [-0.1, 0.06, 0.3]]) f.rod([-0.9, 1.46, -0.05], [-0.9 + dx, 1.46 + h, -0.05 + dz], 0.007, 4);
  };
  D.bookcase = f => {
    f.tint(); f.box(-1.0, 0, -0.2, -0.95, 2.4, 0.18); f.box(0.95, 0, -0.2, 1.0, 2.4, 0.18); f.box(-1.0, 2.34, -0.2, 1.0, 2.4, 0.18); f.box(-1.0, 0, -0.2, 1.0, 0.1, 0.18); f.box(-0.95, 0.1, -0.2, 0.95, 2.34, -0.17);
    const rnd = (k => () => { k = (k * 48271) % 2147483647; return k / 2147483647; })(29);
    for (const y of [0.56, 1.0, 1.44, 1.88]) {
      f.tint(); f.box(-0.95, y - 0.03, -0.17, 0.95, y, 0.18); f.col('#f1d9b0', 0, 1); f.box(-0.93, y - 0.036, -0.15, 0.93, y - 0.03, 0.14);
      let x = -0.9;
      while (x < 0.86) {
        const k = rnd();
        if (k < 0.55) { let n = 4 + Math.floor(rnd() * 7); while (n-- > 0 && x < 0.88) { const w = 0.03 + rnd() * 0.025, hh = 0.22 + rnd() * 0.1; f.col(['#7a3b2e', '#2f4a3a', '#c9b48a', '#3a3f5c', '#8a6a3a', '#e8dfcc'][Math.floor(rnd() * 6)]); f.box(x, y, -0.12, x + w, y + hh, 0.1); x += w + 0.004; } x += 0.06; }
        else if (k < 0.8) { f.col(['#efe8dc', '#b5653a', '#4b5d4a', '#2b2b2b'][Math.floor(rnd() * 4)]); f.lathe(x + 0.08, 0, [[0, y], [0.06, y], [0.08, y + 0.1], [0.05, y + 0.22], [0.03, y + 0.26], [0, y + 0.26]], 10); x += 0.22; }
        else { f.col(C.brass); f.sph(x + 0.07, y + 0.08, 0, 0.07, 0.07, 0.07, 10, 7); x += 0.2; }
      }
    }
  };
  D.olive_tree = f => {
    f.tint(); f.lathe(0, 0, [[0, 0], [0.3, 0], [0.42, 0.15], [0.44, 0.5], [0.4, 0.56], [0, 0.52]], 22);
    f.col('#3d2b1e'); f.cyl(0, 0, 0.38, 0.5, 0.54, 16);
    f.col('#6b5a48'); f.rod([0, 0.52, 0], [0.06, 1.1, 0.04], 0.06, 7); f.rod([0.06, 1.1, 0.04], [-0.03, 1.6, 0.02], 0.05, 7);
    for (const [a, b] of [[[0.06, 1.1, 0.04], [0.42, 1.72, 0.2]], [[-0.02, 1.45, 0.03], [-0.38, 1.98, -0.14]], [[-0.03, 1.6, 0.02], [0.08, 2.15, -0.26]], [[0.0, 1.5, 0.03], [0.05, 1.95, 0.3]]]) f.rod(a, b, 0.03, 5);
    [[0.45, 1.85, 0.2, 0.42], [-0.4, 2.05, -0.15, 0.45], [0.1, 2.32, -0.25, 0.4], [0.05, 2.05, 0.32, 0.38], [-0.22, 1.75, 0.25, 0.32], [0.3, 2.25, 0.1, 0.3]]
      .forEach(([x, y, z, r], i) => { f.col(['#7d8f6a', '#93a37e', '#6c7f5c'][i % 3]); f.sph(x, y, z, r, r * 0.72, r, 12, 8, { disp: (a, b, c) => 0.12 * Math.sin(a * 6 + c * 5 + i) * Math.cos(b * 4) }); });
  };
  // ---------------------------------------------------------------- seats
  D.curve_sofa = f => arcSofa(f, 0, 1.2, 1.38, -0.62, 0.62);
  D.serp_sofa = f => {
    arcSofa(f, -0.82, 1.3, 1.2, -0.72, 0.68);
    arcSofa(f, 0.82, -1.3, 1.2, -0.68, 0.72, true);
    f.tint('#d9d9d9'); f.box(-0.18, 0.1, -0.3, 0.18, 0.84, 0.3);
  };
  D.boucle_chair = f => {
    f.col(C.walnut); f.cyl(0, 0, 0.34, 0, 0.08, 18);
    f.tint(); f.lathe(0, 0, [[0, 0.08], [0.4, 0.08], [0.44, 0.2], [0.43, 0.38], [0.36, 0.43], [0, 0.44]], 22);
    f.tint('#f4f4f4'); band(f, 0, 0, pad(0.32, 0.36, 0.49, 0.78, 0.07), P - 1.55, P + 1.55, 18);   // (the back: closed, its ends capped, down into the seat)
    for (const s of [-1, 1]) f.sph(s * 0.42, 0.52, 0.06, 0.08, 0.15, 0.1, 8, 6);
  };
  D.shell_chair = f => {
    f.col(C.brass); for (const [x, z] of [[-0.28, -0.26], [0.28, -0.26], [-0.28, 0.26], [0.28, 0.26]]) f.rod([x * 0.8, 0.22, z * 0.8], [x, 0, z], 0.014, 6);
    f.tint(); f.lathe(0, 0, [[0, 0.22], [0.36, 0.22], [0.42, 0.3], [0.41, 0.42], [0.34, 0.46], [0, 0.47]], 20);
    f.tint('#e6e6e6'); band(f, 0, -0.02, pad(0.29, 0.4, 0.45, 1.02, 0.06), P - 1.3, P + 1.3, 20);   // (the shell: closed, capped, rising out of the seat)
  };
  D.pouf = f => { f.tint(); f.lathe(0, 0, [[0, 0], [0.25, 0], [0.3, 0.07], [0.3, 0.33], [0.26, 0.41], [0, 0.42]], 20); f.tint('#cfcfcf'); f.lathe(0, 0, [[0.302, 0.2], [0.308, 0.2], [0.308, 0.215], [0.302, 0.215]], 20); };
  // ---------------------------------------------------------------- tables, rugs, lamps
  D.stone_table = f => {
    f.col(C.stoneD); f.cyl(-0.3, 0, 0.17, 0, 0.32, 16); f.cyl(0.3, 0.02, 0.15, 0, 0.32, 16);
    f.col(C.stone); prism(f, blob(0.66, 0.4, 28, 2), 0.32, 0.39, true);
    f.col('#c9b79d'); f.lathe(0.32, -0.08, [[0, 0.39], [0.09, 0.39], [0.12, 0.45], [0.1, 0.47], [0, 0.44]], 14);
    f.col('#2f3a33'); f.box(-0.42, 0.39, 0.02, -0.12, 0.43, 0.22); f.col('#c46a3c'); f.box(-0.4, 0.43, 0.04, -0.15, 0.46, 0.2);
  };
  D.side_lamp_table = f => {
    f.col(C.walnut); f.cyl(0, 0, 0.2, 0, 0.03, 16); f.cyl(0, 0, 0.04, 0.03, 0.52, 10); f.tint(); f.cyl(0, 0, 0.27, 0.52, 0.56, 22);
    f.col(C.cream); f.lathe(0.05, -0.04, [[0, 0.56], [0.07, 0.56], [0.1, 0.64], [0.06, 0.74], [0.02, 0.76], [0, 0.76]], 14);
    f.col(C.glow, 0, 1); f.lathe(0.05, -0.04, [[0.13, 0.74], [0.16, 0.74], [0.13, 0.93], [0.1, 0.93]], 16);
    halo(f, C.warm); f.sph(0.05, 0.84, -0.04, 0.19, 0.12, 0.19, 12, 7);
  };
  D.fire_table = f => {
    f.col('#8d8579'); f.box(-0.8, 0, -0.45, 0.8, 0.42, 0.45);
    f.col('#6f685e'); f.box(-0.78, 0.42, -0.43, 0.78, 0.45, 0.43);
    f.col('#2a2724'); f.box(-0.5, 0.42, -0.14, 0.5, 0.455, 0.14);
    for (let i = 0; i < 9; i++) { const x = -0.42 + i * 0.105, h = 0.12 + 0.08 * ((i * 7) % 3); f.col(i % 2 ? '#ff9a3c' : '#ffd166', 0, 4); f.lathe(x, ((i * 5) % 3 - 1) * 0.03, [[0, 0.455], [0.035, 0.455], [0.022, 0.455 + h * 0.6], [0, 0.455 + h]], 6); }
    halo(f, '#ff9a3c'); f.box(-0.5, 0.46, -0.13, 0.5, 0.62, 0.13);
    f.glass('#f0f6ff'); f.box(-0.52, 0.455, -0.15, 0.52, 0.66, 0.15, 'tb');
  };
  // (above the floor's finish, which is drawn 6 mm up and pulled toward the eye)
  D.organic_rug = f => {   // hand-tufted: a deeper border, a carved ring inside
    f.tint('#9c8d7c'); prism(f, blob(2.08, 1.53, 40, 1), 0, 0.022);
    f.tint(); prism(f, blob(1.95, 1.4, 40, 1), 0.022, 0.028);
    f.tint('#c4b6a6'); prism(f, blob(1.45, 1.0, 36, 1), 0.028, 0.031);
    f.tint(); prism(f, blob(1.37, 0.92, 36, 1), 0.031, 0.034);
  };
  D.chaise = f => {   // a chaise longue: a long seat that rises to its head (−z), a bolster, a throw at its foot
    f.col(C.brass); for (const [x, z] of [[-0.28, -0.82], [0.28, -0.82], [-0.28, 0.74], [0.28, 0.74]]) f.rod([x, 0, z], [x * 0.92, 0.18, z * 0.97], 0.016, 6);
    f.tint(); extrudeX(f, [[0.84, 0.36], [0.62, 0.42], [0.3, 0.44], [0.0, 0.43], [-0.3, 0.46], [-0.52, 0.55], [-0.7, 0.68], [-0.84, 0.8], [-0.93, 0.85]], 0.17, -0.34, 0.34);
    f.tint('#f0f0f0'); f.push(0, 0.83, -0.72, 0); rotZ(f, H); f.cyl(0, 0, 0.1, -0.33, 0.33, 14); f.pop();
    f.col('#e6dccb'); f.box(-0.37, 0.28, 0.42, 0.37, 0.455, 0.64); f.col('#b0623e'); f.box(-0.372, 0.33, 0.47, 0.372, 0.35, 0.5);
  };
  D.floor_lantern = f => {   // a paper lantern on a walnut foot, glowing after dark
    f.col(C.walnut); f.cyl(0, 0, 0.17, 0, 0.04, 16);
    const prof = [[0, 0.05], [0.15, 0.07], [0.2, 0.2], [0.21, 0.38], [0.19, 0.55], [0.13, 0.67], [0, 0.7]];
    f.col('#f4dfb8', 0, 2); f.lathe(0, 0, prof, 18);
    f.col('#8a6a4a'); for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; for (let i = 0; i + 1 < prof.length; i++) f.rod([Math.sin(a) * (prof[i][0] + 0.004), prof[i][1], Math.cos(a) * (prof[i][0] + 0.004)], [Math.sin(a) * (prof[i + 1][0] + 0.004), prof[i + 1][1], Math.cos(a) * (prof[i + 1][0] + 0.004)], 0.004, 3); }
    halo(f, '#d09a5c'); f.sph(0, 0.38, 0, 0.32, 0.36, 0.32, 14, 8);
  };
  D.planter_box = f => {   // a long stone planter of grasses and low shrubs: a soft wall between groups
    f.tint(); f.box(-1.0, 0.02, -0.26, 1.0, 0.55, 0.26);
    f.tint('#d4d4d4'); f.box(-1.02, 0.55, -0.28, 1.02, 0.6, 0.28);
    f.col('#3d2b1e'); f.box(-0.96, 0.5, -0.22, 0.96, 0.585, 0.22);
    f.col('#ffc777', 0, 2); f.box(-0.97, 0, -0.24, 0.97, 0.02, 0.24);
    for (const [x, z, r] of [[-0.7, 0.04, 0.24], [-0.05, -0.06, 0.27], [0.62, 0.05, 0.23]]) { f.col('#4b7140'); f.sph(x, 0.68, z, r, r * 0.85, r * 0.8, 10, 6, { disp: (a, b, c) => 0.1 * Math.sin(a * 7 + c * 5) }); }
    const r = (k => () => { k = (k * 16807) % 2147483647; return k / 2147483647; })(5);
    for (let i = 0; i < 34; i++) { const x = -0.92 + r() * 1.84, z = -0.16 + r() * 0.32, h = 0.45 + r() * 0.5, c = ['#8a9a5b', '#6f8a4a', '#b9a66a', '#9fb070'][Math.floor(r() * 4)]; f.col(c); f.rod([x, 0.58, z], [x + (r() - 0.5) * 0.35, 0.58 + h, z + (r() - 0.5) * 0.3], 0.009, 3); }
  };
  D.slat_screen = f => {   // a freestanding screen of oak slats on a walnut foot
    f.col(C.walnut); f.box(-0.85, 0, -0.16, 0.85, 0.07, 0.16); f.box(-0.85, 2.04, -0.05, 0.85, 2.1, 0.05);
    f.tint(); for (let x = -0.8; x <= 0.801; x += 0.08) f.box(x - 0.022, 0.07, -0.04, x + 0.022, 2.04, 0.04);
    f.col('#e6dccb'); f.lathe(0.55, 0.1, [[0, 0.07], [0.06, 0.07], [0.09, 0.16], [0.07, 0.27], [0.04, 0.3], [0, 0.29]], 12);
  };
  D.arc_lamp = f => {
    f.col('#f2efe9'); f.cyl(0, 0, 0.25, 0, 0.07, 20);
    f.col(C.brass); f.cyl(0, 0, 0.02, 0.07, 1.4, 8);
    const pts = Array.from({ length: 9 }, (_, i) => { const a = i / 8 * H; return [Math.sin(a) * 1.2, 1.4 + Math.sin(a) * 0.65 - (1 - Math.cos(a)) * 0.2, 0]; });
    for (let i = 0; i < 8; i++) f.rod(pts[i], pts[i + 1], 0.018, 6);
    const e = pts[8];
    f.col(C.brass); f.lathe(e[0], 0, [[0.03, e[1]], [0.12, e[1] - 0.04], [0.2, e[1] - 0.16], [0.21, e[1] - 0.18], [0.19, e[1] - 0.18]], 18);
    f.col(C.glow, 0, 1); f.sph(e[0], e[1] - 0.17, 0, 0.07, 0.04, 0.07, 10, 6);
    halo(f, C.warm); f.sph(e[0], e[1] - 0.2, 0, 0.16, 0.08, 0.16, 12, 6);
  };
  // ---------------------------------------------------------------- sculpture and the walls
  D.twist_sculpture = f => {   // a bronze ribbon twisting as it rises off a travertine plinth
    f.col(C.stone); f.box(-0.26, 0, -0.26, 0.26, 0.42, 0.26); f.col(C.stoneD); f.box(-0.27, 0.42, -0.27, 0.27, 0.45, 0.27);
    f.tint(); for (let i = 0; i < 30; i++) { const w = 0.06 + 0.16 * Math.sin((i + 2) / 33 * P); f.push(0, 0.46 + i * 0.05, 0, i * 0.11); f.box(-w, 0, -0.022, w, 0.052, 0.022); f.pop(); }
  };
  D.stone_stack = f => {
    f.col('#cfc3b0'); f.cyl(0, 0, 0.34, 0, 0.16, 20);
    [[0.3, 0.12, '#8f877c'], [0.24, 0.1, '#bdb2a1'], [0.19, 0.09, '#6f6a63'], [0.14, 0.08, '#d8cfc2'], [0.1, 0.07, '#9b8f7f']].reduce((y, [r, h, c], i) => { f.col(c); f.sph(Math.sin(i) * 0.03, y + h, Math.cos(i * 2) * 0.03, r, h, r * 0.85, 14, 8); return y + h * 2 - 0.01; }, 0.16);
  };
  D.ring_sculpture = f => {
    f.col(C.stone); f.box(-0.5, 0, -0.25, 0.5, 0.18, 0.25);
    f.col(C.glow, 0, 1); f.box(-0.48, 0.18, -0.23, 0.48, 0.19, 0.23);
    const n = 28, R = 0.72, ring = Array.from({ length: n }, (_, k) => [Math.sin(k / n * TAU) * R, 0.98 + Math.cos(k / n * TAU) * R * 0.98, 0]);
    f.tint(); for (let k = 0; k < n; k++) f.rod(ring[k], ring[(k + 1) % n], 0.06, 8);
    f.col(C.brass); f.sph(0.18, 0.62, 0.0, 0.16, 0.16, 0.16, 12, 8);
  };
  D.vase_set = f => {
    f.col('#efe8dc'); f.lathe(-0.2, 0, [[0, 0], [0.1, 0], [0.15, 0.3], [0.13, 0.6], [0.06, 0.85], [0.05, 1.0], [0.07, 1.04], [0, 1.0]], 16);
    f.col('#7a5a3e'); for (const [dx, dz, h] of [[0.15, 0.05, 0.5], [-0.12, 0.1, 0.4], [0.05, -0.12, 0.55]]) f.rod([-0.2, 0.95, 0], [-0.2 + dx, 0.95 + h, dz], 0.008, 4);
    f.col('#b5653a'); f.lathe(0.15, 0.08, [[0, 0], [0.12, 0], [0.19, 0.18], [0.16, 0.36], [0.07, 0.44], [0.08, 0.5], [0, 0.48]], 16);
    f.col('#f6f2ea'); for (let k = 0; k < 16; k++) { const a = k / 16 * TAU; f.sph(0.28 + Math.sin(a) * 0.11, 0.18 + Math.cos(a) * 0.11, -0.1, 0.07, 0.07, 0.06, 8, 5); }
  };
  D.planter_palm = f => {
    f.tint(); f.lathe(0, 0, [[0, 0], [0.32, 0], [0.42, 0.45], [0.43, 0.5], [0.38, 0.5], [0, 0.46]], 20);
    f.col('#3d2b1e'); f.cyl(0, 0, 0.38, 0.44, 0.48, 16);
    for (let i = 0; i < 11; i++) {
      const a = i * 2.39, lean = 0.25 + (i % 4) * 0.12, len = 1.0 + (i % 3) * 0.35, tx = Math.sin(a) * Math.sin(lean) * len, tz = Math.cos(a) * Math.sin(lean) * len, ty = 0.48 + Math.cos(lean) * len;
      f.col('#4c6b3c'); f.rod([0, 0.48, 0], [tx, ty, tz], 0.012, 4);
      f.push(tx, ty, tz, a); rotX(f, -lean - 0.3); f.col(i % 2 ? '#3f6b3a' : '#5a8a4c'); f.sph(0, 0.22, 0, 0.11, 0.28, 0.025, 8, 6); f.pop();
    }
  };
  D.wall_niche = f => {
    f.col('#e7ddcd'); f.box(-0.6, 0, -0.26, -0.48, 2.45, 0.26); f.box(0.48, 0, -0.26, 0.6, 2.45, 0.26); f.box(-0.6, 2.25, -0.26, 0.6, 2.45, 0.26); f.box(-0.6, 0, -0.26, 0.6, 0.5, 0.26);
    f.col('#f1dfbf', 0, 1); f.box(-0.48, 0.5, -0.26, 0.48, 2.25, -0.2);
    f.col('#fff0d4', 0, 3); f.box(-0.46, 2.2, -0.2, 0.46, 2.22, 0.2);
    f.col('#d9ccb8'); f.box(-0.48, 0.5, -0.2, 0.48, 0.53, 0.24);
    for (let i = 0; i < 14; i++) { const y = 0.6 + i * 0.075, x = Math.sin(i * 0.5) * 0.05, r = 0.06 + 0.035 * Math.sin(i * 0.55 + 0.7); f.push(x, y, 0.02, i * 0.42); f.col('#7a5a3a'); f.sph(0, 0, 0, r * 1.5, 0.05, r * 0.7, 9, 4); f.pop(); }
    halo(f, C.warm); f.box(-0.47, 0.53, -0.19, 0.47, 2.2, 0.0);
  };
  D.wall_slats = f => {
    f.col('#2b211b'); f.box(-1.2, 0, -0.05, 1.2, 3.0, -0.03);
    f.tint(); for (let x = -1.16; x <= 1.161; x += 0.08) f.box(x - 0.022, 0.02, -0.03, x + 0.022, 2.98, 0.03);
    f.col(C.warm, 0, 1); f.box(-1.18, 0.0, -0.03, 1.18, 0.02, 0.05); f.box(-1.18, 2.98, -0.03, 1.18, 3.0, 0.05);
    halo(f, C.warm); f.box(-1.18, 0.0, -0.02, 1.18, 0.35, 0.06); f.box(-1.18, 2.65, -0.02, 1.18, 3.0, 0.06);
  };
  D.wall_sconce = f => {
    f.col(C.brass); f.box(-0.07, 1.48, -0.09, 0.07, 1.98, -0.07);
    f.col(C.glow, 0, 1); f.lathe(0, -0.07, [[0.0, 1.52], [0.09, 1.55], [0.1, 1.73], [0.09, 1.92], [0, 1.95]], 12, -H, H);
    halo(f, C.warm); f.lathe(0, -0.07, [[0.05, 1.3], [0.2, 1.55], [0.22, 1.75], [0.2, 1.95], [0.05, 2.25]], 12, -H, H);
  };
  D.art_panel = f => {
    f.col(C.walnut); f.box(-0.9, 1.05, -0.04, 0.9, 2.3, -0.01);
    f.tint(); f.box(-0.85, 1.1, -0.01, 0.85, 2.25, 0.0);
    [['#b5653a', -0.4, 1.75, 0.38, 0.3], ['#7d8f6a', 0.25, 1.5, 0.42, 0.26], ['#d9a441', 0.45, 1.98, 0.22, 0.17], ['#2f3d5c', -0.1, 1.35, 0.2, 0.12], ['#efe6d8', 0.05, 1.95, 0.16, 0.14]]
      .forEach(([c, x, y, rx, ry], i) => { f.col(c); f.push(x, y, 0.004 + i * 0.001, 0); f.sph(0, 0, 0, rx, ry, 0.004, 16, 6, { disp: (a, b) => 0.08 * Math.sin(a * 3 + b * 2 + i) }); f.pop(); });
  };
  D.cove_light = f => { f.col('#ffffff', 1, 1); f.box(-1.0, 0, -0.025, 1.0, 0.026, 0.025); halo(f, '#ffd59a'); f.box(-1.0, 0, -0.06, 1.0, 0.04, 0.06); };
  // ---------------------------------------------------------------- the bar
  D.lounge_bar = f => {
    f.col('#ebe3d7'); f.box(-1.75, 0.08, -0.32, 1.75, 1.04, 0.28);
    for (const s of [-1, 1]) f.cyl(s * 1.75, -0.02, 0.3, 0.08, 1.04, 16);
    const r = (k => () => { k = (k * 16807) % 2147483647; return k / 2147483647; })(7);
    for (let i = 0; i < 260; i++) { const x = -1.72 + r() * 3.44, y = 0.12 + r() * 0.88, c = ['#b5653a', '#7d8f6a', '#3f3a35', '#d9a441', '#9a8f80'][Math.floor(r() * 5)], s = 0.008 + r() * 0.016; f.col(c); f.box(x - s, y - s, 0.28, x + s, y + s, 0.284); }
    f.col('#ffc777', 0, 3); f.box(-1.76, 0.06, 0.2, 1.76, 0.085, 0.3);
    f.col('#3a3530'); f.box(-2.06, 1.04, -0.36, 2.06, 1.1, 0.34);
    f.col(C.brass); f.box(-1.8, 0.2, 0.36, 1.8, 0.23, 0.39); f.rod([-1.8, 0.22, 0.37], [-1.8, 0.08, 0.3], 0.012, 5); f.rod([1.8, 0.22, 0.37], [1.8, 0.08, 0.3], 0.012, 5);
    for (const x of [-1.2, -0.4, 0.4, 1.2]) {
      f.col(C.brass); f.cyl(x, 0.62, 0.18, 0, 0.02, 14); f.cyl(x, 0.62, 0.025, 0.02, 0.66, 8); f.lathe(x, 0.62, [[0.14, 0.26], [0.15, 0.26], [0.15, 0.275], [0.14, 0.275]], 12);
      f.tint(); f.lathe(x, 0.62, [[0, 0.66], [0.19, 0.66], [0.2, 0.71], [0.18, 0.74], [0, 0.745]], 16); f.lathe(x, 0.62, [[0.16, 0.72], [0.19, 0.72], [0.2, 0.86], [0.17, 0.88]], 14, P - 0.9, P + 0.9);
    }
    f.col('#2b2622'); f.box(-1.7, 0.85, -0.6, 1.7, 0.9, -0.36);
  };
  D.back_bar = f => {
    f.tint(); f.box(-1.6, 0, -0.24, 1.6, 0.92, 0.24);
    f.col('#3a3530'); f.box(-1.62, 0.92, -0.25, 1.62, 0.96, 0.25);
    f.col(C.brass); for (const x of [-0.8, 0, 0.8]) f.box(x - 0.08, 0.5, 0.24, x + 0.08, 0.52, 0.25);
    f.glass('#c9d7e0'); f.box(-1.55, 1.0, -0.24, 1.55, 2.55, -0.22);
    f.col('#2b211b'); f.box(-1.6, 0.96, -0.24, -1.52, 2.6, 0.12); f.box(1.52, 0.96, -0.24, 1.6, 2.6, 0.12); f.box(-1.6, 2.52, -0.24, 1.6, 2.6, 0.12);
    const r = (k => () => { k = (k * 48271) % 2147483647; return k / 2147483647; })(11);
    for (const y of [1.2, 1.62, 2.04]) {
      f.col('#c79d66', 0, 1); f.box(-1.52, y - 0.025, -0.22, 1.52, y, 0.1);
      for (let x = -1.4; x < 1.42; x += 0.11 + r() * 0.06) { const c = ['#8a5a2b', '#3e6b3a', '#d7c9a8', '#6b2b2b', '#c9a227', '#b8cfd6'][Math.floor(r() * 6)], h = 0.18 + r() * 0.12; f.col(c); f.lathe(x, -0.08, [[0, y], [0.035, y], [0.036, y + h * 0.65], [0.014, y + h * 0.8], [0.012, y + h], [0, y + h]], 8); }
    }
  };
  // ---------------------------------------------------------------- the stage
  D.lounge_stage = f => {
    const front = Array.from({ length: 17 }, (_, i) => { const a = -H + i / 16 * P; return [Math.sin(a) * 2.2, 0.3 + Math.cos(a) * 1.0]; });
    const outline = [[-2.2, -1.45], ...front, [2.2, -1.45]];
    f.col('#4a3122'); prism(f, outline, 0, 0.27);
    f.col('#6b4a33'); prism(f, outline, 0.27, 0.3);
    f.col('#ffb760', 0, 3); for (let i = 0; i + 1 < front.length; i++) { const [a, b] = [front[i], front[i + 1]]; f.rod([a[0], 0.255, a[1] + 0.012 * Math.sign(a[1])], [b[0], 0.255, b[1] + 0.012 * Math.sign(b[1])], 0.012, 4); }
    // the curtain: velvet folds from the stage to the arch
    f.tint(); for (let x = -2.05; x <= 2.051; x += 0.17) f.cyl(x, -1.33 + (Math.round(x / 0.17) % 2 ? 0.035 : 0), 0.095, 0.3, 3.0, 8);
    f.col(C.walnut); f.box(-2.2, 0, -1.45, -2.0, 3.2, -1.15); f.box(2.0, 0, -1.45, 2.2, 3.2, -1.15); f.box(-2.2, 2.95, -1.45, 2.2, 3.2, -1.1);
    f.col('#ffd08a', 0, 1); f.box(-1.95, 2.93, -1.12, 1.95, 2.95, -1.1);
    // the lights: three spots on the arch, their beams on the stage
    for (const [x, tx] of [[-1.3, -0.45], [0, 0.4], [1.3, 1.2]]) {   // (the piano, the singer, the bass)
      f.col(C.black); f.cyl(x, -1.05, 0.07, 2.78, 2.95, 10); f.col('#fff1d0', 0, 3); f.cyl(x, -1.05, 0.055, 2.77, 2.78, 10);
      halo(f, '#8a7452'); f.push(x, 2.77, -1.05); const dx = tx - x, dz = 0.25 + 1.05, L = Math.hypot(dx, 2.47, dz); f.m.multiply(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dx / L, -2.47 / L, dz / L))));
      f.lathe(0, 0, [[0.05, 0], [0.4, -L], [0.01, -L]], 14); f.pop();
    }
    // the grand piano, side on, its keys facing the middle; its bench. Played as a desk is typed at (2026-10-24, the
    // product owner: "the piano is too high and the piano's seat too low ... the typing/working animation should work
    // fine for the piano"): the white keys' top at a desk's height over the stage (0.755: render/char-props.js
    // DESK_TOP) and where a typist's fingertips rest from the bench (about 0.57 ahead), the bench as high as an office
    // chair's seat; the piano sunk into the stage by PK, its legs shorter for it. All of it on the stage (2026-10-24: "one of
    // the legs of the piano is off stage"): its tail 0.1 inside the stage's left edge, clear of the curtain
    const PK = 0.145;
    f.push(-1.2, 0.3 - PK, -0.5, 0);
    const body = [[0.38, -0.7], [0.38, 0.7], [0.0, 0.72], [-0.45, 0.62], [-0.78, 0.38], [-0.9, 0.05], [-0.82, -0.3], [-0.55, -0.62], [-0.2, -0.72]];
    f.col('#0d0d10'); for (const [x, z] of [[0.25, -0.55], [0.25, 0.55], [-0.7, 0.0]]) f.box(x - 0.04, 0, z - 0.04, x + 0.04, 0.62, z + 0.04);
    prism(f, body, 0.62, 0.98, true);
    f.push(0, 0.98, 0.66); rotX(f, 0.62); f.col('#0d0d10'); prism(f, body.map(([x, z]) => [x, z - 0.66]), 0, 0.02, true); f.pop();   // (the lid, open on its long side)
    f.col('#c9a227'); f.rod([-0.3, 0.98, -0.25], [-0.3, 1.5, 0.02], 0.008, 4);   // (its prop)
    f.col('#f4f1ea'); f.box(0.38, 0.86, -0.62, 0.62, 0.9, 0.62); f.col('#0d0d10'); for (let z = -0.58; z < 0.6; z += 0.055) f.box(0.5, 0.9, z - 0.012, 0.62, 0.92, z + 0.012);
    f.col('#0d0d10'); f.box(0.38, 0.62, -0.68, 0.64, 0.86, -0.62); f.box(0.38, 0.62, 0.62, 0.64, 0.86, 0.68);
    // the key bed under the keys (2026-10-24: "the piano doesn't have a base under the keys"), its front's key slip, the
    // lyre down to the pedals
    f.col('#121216'); f.box(0.38, 0.74, -0.62, 0.64, 0.86, 0.62); f.col('#26262c'); f.box(0.62, 0.745, -0.62, 0.645, 0.8, 0.62);
    f.col('#0d0d10'); f.box(0.07, 0.1 + PK, -0.05, 0.13, 0.62, 0.05); f.col(C.brass); for (const z of [-0.035, 0.035]) f.rod([0.1, 0.12 + PK, z], [0.1, 0.6, z], 0.006, 4);
    f.col(C.brass); f.box(0.06, 0.05 + PK, -0.08, 0.14, 0.1 + PK, 0.08);   // (the pedals, on the stage)
    f.pop();
    f.col('#0d0d10'); f.box(-0.23, 0.3, -0.7, 0.07, 0.73, -0.3); f.col('#5b1f2a'); f.box(-0.23, 0.73, -0.7, 0.07, 0.77, -0.3);   // (the bench: the pianist's reach from the keys)
    // the double bass, standing as its player holds it, and the microphone on its stand (2026-10-24: "the lounge singer
    // has their hand holding the mic in the wrong place ... the bass player needs more work the hand placements are off"):
    // both where shared/stage.js puts them from their player's place, where the clips put the hands (act_sing, act_bass)
    f.push(BASSIST.x, 0.3, BASSIST.z, BASSIST.yaw);
    f.m.multiply(new THREE.Matrix4().makeBasis(new THREE.Vector3(...BASS.x), new THREE.Vector3(...BASS.y), new THREE.Vector3(...BASS.z)).setPosition(...BASS.o));
    doubleBass(f);
    f.pop();
    f.push(SINGER.x, 0.3, SINGER.z, SINGER.yaw);
    f.col(C.black); f.cyl(MIC.foot[0], MIC.foot[2], 0.12, 0, 0.02, 14); f.col('#2a2a2e'); f.rod(MIC.foot, MIC.top, MIC.r, 6);
    f.rod(MIC.top, [MIC.mic[0], MIC.mic[1] - 0.035, MIC.mic[2]], 0.008, 6); f.col('#3a3a40'); f.sph(...MIC.mic, 0.03, 0.05, 0.03, 8, 6);
    f.col('#9aa0a8'); f.cyl(MIC.mic[0], MIC.mic[2], 0.031, MIC.mic[1] - 0.006, MIC.mic[1] + 0.006, 10);   // (the microphone's band)
    f.pop();
    for (const x of [-0.95, 0.95]) { f.push(x, 0.3, 1.0, P); f.col('#1a1a1d'); prism(f, [[-0.22, -0.15], [0.22, -0.15], [0.22, 0.15], [-0.22, 0.15]], 0, 0.18); rotX(f, 0.5); f.col('#222226'); f.box(-0.2, 0.1, -0.02, 0.2, 0.28, 0.02); f.pop(); }
    f.tint('#a0a0a0'); prism(f, blob(0.7, 0.45, 22, 3).map(([x, z]) => [x, z + 0.35]), 0.3, 0.306);
  };
}
