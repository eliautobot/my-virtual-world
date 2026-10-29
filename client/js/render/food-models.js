// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The food and drink pack (shared/food.js): a 3D model for every item, built from one kit of parts — plates, bowls,
// boards, baskets and glasses; buns, patties, noodles, rice, slices, scoops — so a burger is a burger and a dessert is
// the dessert that was ordered. Item frame: the middle of where it stands on the table at y 0, y up, +z toward whoever
// eats it; everything fits a café table's place (within ~0.16 m of the middle). Vertex colours as the furniture's
// (render/furniture.js FB): opaque parts in .geo, glass in .glass.
//
// Glasses are also what people hold (render/char-props.js): VESSELS[v](f, liq, { hand: true }) draws the glass solid and
// the drink with the tint flag, which the held shapes' shader colours with the drink's own colour.
// Look at the whole pack: /dev/food.html.
import * as THREE from 'three';
import { FB } from './furniture.js';
import { FOOD_BY_ID, FOOD_BY_N } from '/shared/food.js';

const TAU = Math.PI * 2, P = Math.PI, H = Math.PI / 2;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hsh = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

// ------------------------------------------------------------------------------------------------ helpers
/** Draws fn in frame m (inside FB's current one). */
function within(f, m, fn) { f.stack.push(f.m.clone()); f.m.multiply(m); fn(); f.pop(); }
const _e = new THREE.Euler();
/** Rotated (x, then y, then z, radians) and moved. */
function rot(f, rx, ry, rz, x, y, z, fn) { within(f, new THREE.Matrix4().makeRotationFromEuler(_e.set(rx, ry, rz)).setPosition(x, y, z), fn); }
/** At (x, y, z), turned yaw about y. */
function at(f, x, y, z, yaw, fn) { f.push(x, y, z, yaw); fn(); f.pop(); }
/** A convex outline [[x, z] …] (anticlockwise seen from above) extruded from y0 to y1. */
function prism(f, poly, y0, y1, sides = true) {
  const n = poly.length;
  const top = poly.map(([x, z]) => f.vert(x, y1, z, 0, 1, 0)), bot = poly.map(([x, z]) => f.vert(x, y0, z, 0, -1, 0));
  for (let i = 1; i < n - 1; i++) { f.tri(top[0], top[i], top[i + 1]); f.tri(bot[0], bot[i + 1], bot[i]); }
  if (!sides) return;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % n], nx = bz - az, nz = -(bx - ax), l = Math.hypot(nx, nz) || 1;
    f.quad([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [nx / l, 0, nz / l]);
  }
}
/** A wedge (a slice of a round cake or pie): radius r from angle a0 to a1 (radians about y, 0 = +z), y0 to y1. */
function wedge(f, r, a0, a1, y0, y1, seg = 6) {
  const poly = [[0, 0]];
  for (let k = 0; k <= seg; k++) { const a = a0 + (a1 - a0) * k / seg; poly.push([Math.sin(a) * r, Math.cos(a) * r]); }
  prism(f, poly.reverse(), y0, y1);
}
/** A ring lying flat (a donut, an onion ring): centre (x, y, z), ring radius R, tube r. */
function torus(f, x, y, z, R, r, seg = 16, tube = 8) {
  const prof = [];
  for (let k = 0; k <= tube; k++) { const a = -H + TAU * k / tube; prof.push([R + Math.cos(a) * r, y + Math.sin(a) * r]); }
  f.lathe(x, z, prof.reverse(), seg);
}
/** A rod with round ends. */
function capsule(f, a, b, r, seg = 8) { f.rod(a, b, r, seg); f.sph(a[0], a[1], a[2], r, r, r, seg, 5); f.sph(b[0], b[1], b[2], r, r, r, seg, 5); }
/** A lumpy round thing (meatball, scoop, leaf heap): a sphere pushed in and out by `amt`. */
function blob(f, x, y, z, rx, ry, rz, amt = 0.15, seed = 1, seg = 10, rings = 6, cut) {
  f.sph(x, y, z, rx, ry, rz, seg, rings, { disp: (a, b, c) => (hsh(a * 3 + seed, b * 3, c * 3) - 0.5) * 2 * amt, ...(cut !== undefined ? { cut } : {}) });
}
/** A dome on y (half a lumpy sphere, flat underneath). */
const dome = (f, x, y, z, rx, ry, rz, amt = 0.1, seed = 1, seg = 12) => blob(f, x, y, z, rx, ry, rz, amt, seed, seg, 6, 0);
/** n small things scattered in a disc of radius R: fn(x, z, k, r()). */
function scatter(f, n, R, seed, fn) { const r = rng(seed); for (let k = 0; k < n; k++) { const a = r() * TAU, d = Math.sqrt(r()) * R; fn(Math.sin(a) * d, Math.cos(a) * d, k, r); } }
/** A flat round thing (a slice of tomato, pepperoni): disc of radius r and thickness t at (x, y, z). */
const disc = (f, x, y, z, r, t, seg = 10) => f.cyl(x, z, r, y, y + t, seg);

// ------------------------------------------------------------------------------------------------ serving ware
// (Order Up's kitchen, 2026-10-28: a dish as it comes out of the oven, the fryer, the pan is the food alone: its plate,
// bowl, board, basket and sauce dishes left off (ALONE); what it was served on is noted (SERVED_ON))
let ALONE = false, SERVED_ON = null;
const ware = kind => { if (!SERVED_ON) SERVED_ON = kind; return !ALONE; };
const side = fn => { if (!ALONE) fn(); };   // (its sides, a garnish: on the plate, not in the oven or on the grill with it)
const WHITE = '#f3f1ec', CREAM = '#efe6d3', WOOD = '#b98a57', WOOD_D = '#7a5233', SLATE = '#3a3d42', STEEL = '#c9ced4';
/** A dinner plate (radius r); the food sits at y ≈ 0.014. */
function plate(f, r = 0.125, col = WHITE, rim = null) {
  if (!ware('plate')) return;
  f.col(col); f.lathe(0, 0, [[0, 0.002], [r * 0.55, 0], [r * 0.62, 0.006], [r * 0.78, 0.012], [r, 0.02], [r * 0.985, 0.023], [r * 0.8, 0.017], [r * 0.6, 0.0135], [0, 0.0135]], 24);
  if (rim) { f.col(rim); f.lathe(0, 0, [[r * 0.93, 0.0215], [r * 0.985, 0.0232]], 24); }
}
const TOP = 0.014;   // a plate's surface
/** An oval platter. */
function platter(f, rx = 0.15, rz = 0.1, col = WHITE) { within(f, new THREE.Matrix4().makeScale(1, 1, rz / rx), () => plate(f, rx, col)); }
/** A bowl (rim radius r, depth h); returns the height of its contents' surface at fill 0..1. */
function bowl(f, r = 0.085, h = 0.06, col = WHITE, inner = null, foot = 0.45) {
  if (!ware('bowl')) return fill => h * 0.14 + (h * 0.86 - 0.004) * fill;
  f.col(col);
  f.lathe(0, 0, [[0, 0.001], [r * foot, 0], [r * foot, 0.006], [r * 0.82, h * 0.45], [r, h], [r * 0.95, h + 0.002], [r * 0.9, h * 0.6], [r * 0.6, h * 0.2], [0, h * 0.14]], 20);
  if (inner) { f.col(inner); f.lathe(0, 0, [[r * 0.95, h + 0.0015], [r * 0.9, h * 0.6]], 20); }
  return fill => h * 0.14 + (h * 0.86 - 0.004) * fill;
}
/** The surface of a bowl's contents: a flat disc (soup, curry) at height y, the bowl's width there. */
function surface(f, r, h, y, col, seg = 20) { const k = (y - h * 0.14) / (h * 0.86); f.col(col); f.cyl(0, 0, r * (0.62 + 0.33 * Math.min(1, k)), y - 0.002, y, seg); }
/** A wooden board (w × d). */
function board(f, w = 0.3, d = 0.18, col = WOOD) { if (!ware('board')) return; f.col(col); f.box(-w / 2, 0, -d / 2, w / 2, 0.016, d / 2); f.col(WOOD_D); f.box(-w / 2, 0.0, -d / 2, w / 2, 0.003, d / 2); }
/** A slate (dark stone board). */
function slate(f, w = 0.28, d = 0.17) { if (!ware('slate')) return; f.col(SLATE); f.box(-w / 2, 0, -d / 2, w / 2, 0.009, d / 2); }
/** A basket lined with paper (burger joints, fries, wings). */
function basket(f, w = 0.22, d = 0.16, col = '#c62828') {
  if (!ware('basket')) return;
  f.col(col); f.box(-w / 2, 0, -d / 2, w / 2, 0.006, d / 2);
  for (const s of [-1, 1]) { f.box(-w / 2, 0, s * d / 2 - 0.004, w / 2, 0.035, s * d / 2 + 0.004); f.box(s * w / 2 - 0.004, 0, -d / 2, s * w / 2 + 0.004, 0.035, d / 2); }
  f.col('#f6f1e2'); f.box(-w / 2 + 0.008, 0.006, -d / 2 + 0.008, w / 2 - 0.008, 0.008, d / 2 - 0.008);
  for (let k = 0; k < 4; k++) { f.col(k % 2 ? '#f6f1e2' : '#d84a3a'); const x = -w / 2 + 0.012 + k * (w - 0.024) / 4; f.box(x, 0.0081, d / 2 - 0.03, x + (w - 0.024) / 4, 0.0083, d / 2 - 0.012); }
}
/** A cast-iron skillet on a wooden base (fajitas). */
function skillet(f, r = 0.11) {
  if (!ware('skillet')) return;
  board(f, r * 2.3, r * 2.1, WOOD_D);
  at(f, 0, 0.016, 0, 0, () => { f.col('#26272a'); f.lathe(0, 0, [[0, 0], [r, 0], [r * 1.05, 0.03], [r * 0.98, 0.032], [r * 0.94, 0.008], [0, 0.008]], 22); f.rod([r, 0.02, 0], [r + 0.08, 0.03, 0], 0.012, 6); });
}
/** A bamboo steamer basket. */
function steamer(f, r = 0.1) { if (!ware('steamer')) return; f.col('#c9a46a'); f.lathe(0, 0, [[0, 0], [r, 0], [r, 0.05], [r * 0.93, 0.05], [r * 0.93, 0.008], [0, 0.008]], 20); f.col('#a9834d'); torus(f, 0, 0.012, 0, r * 0.99, 0.004, 20, 4); torus(f, 0, 0.048, 0, r * 0.99, 0.004, 20, 4); }
/** A little dish of sauce at (x, z). */
function ramekin(f, x, z, col, r = 0.028) { if (ALONE) return; at(f, x, 0, z, 0, () => { f.col(WHITE); f.lathe(0, 0, [[r, 0.028], [r * 0.95, 0], [0, 0]].reverse(), 12); f.col(col); f.cyl(0, 0, r * 0.88, 0.02, 0.024, 12); }); }
/** Cutlery beside a plate (knife and fork, or chopsticks). */
let BARE = false;   // (thumbnails: the food without knife, fork, spoon or chopsticks)
// eaten by hand (render/char-props.js draws the piece being eaten in the hands): the dish's first piece is left off the
// plate — a burger off its basket, one taco of three, one slice of a cut quesadilla (single-piece dishes say so too)
let TAKE = 0;
const taken = () => TAKE > 0 && TAKE-- > 0;
function cutlery(f, r = 0.13, sticks = false) {
  if (BARE) return;
  if (sticks) { f.col('#3b2618'); f.box(r + 0.01, 0.002, -0.11, r + 0.017, 0.008, 0.1); f.box(r + 0.022, 0.002, -0.11, r + 0.029, 0.008, 0.1); return; }
  f.col(STEEL); f.box(-r - 0.022, 0.001, -0.08, -r - 0.012, 0.004, 0.09); for (let k = 0; k < 4; k++) f.box(-r - 0.024 + k * 0.004, 0.001, 0.09, -r - 0.022 + k * 0.004, 0.004, 0.115);
  f.box(r + 0.012, 0.001, -0.1, r + 0.022, 0.004, 0.11);
}

// ------------------------------------------------------------------------------------------------ glasses and cups
// v(f, liq, o): base at y 0. o.hand: held (glass solid, drink tinted: char-props colours it). Returns nothing.
const GLASS = '#dbe9f2', GLASS_SOLID = '#cfdbe3';
const gl = (f, o) => (o.hand ? f.col(GLASS_SOLID) : f.glass(GLASS));
const lq = (f, liq, o) => (o.hand ? f.col('#ffffff', 1) : f.col(liq));
/** A straight glass of radius r0 at the foot, r1 at the rim, height h, filled to fill; wall thickness. */
function tumblerShape(f, liq, o, r0, r1, h, fill, extra) {
  const rf = r0 + (r1 - r0) * fill;
  lq(f, liq, o); f.cyl(0, 0, r0 * 0.93, 0.008, h * fill, 16, rf * 0.93);
  if (extra) extra(h * fill, rf);
  gl(f, o); f.lathe(0, 0, [[0, 0], [r0, 0], [r1, h], [r1 * 0.95, h], [r0 * 0.93, 0.008], [0, 0.008]], 16);
}
function ice(f, y, r, n = 3, seed = 2, o = {}) { scatter(f, n, r * 0.45, seed, (x, z, k, R) => { if (o.hand) f.col('#eef7fb'); else f.glass('#eaf8ff'); f.boxC(x, y - 0.006, z, 0.011, 0.011, 0.011, R() * 3); }); }
function straw(f, y, col = '#e8453c', x = 0.012, lean = 0.25) { f.col(col); f.rod([x, y - 0.06, 0], [x + Math.sin(lean) * 0.12, y + 0.06, 0], 0.0035, 5); }
function lemon(f, x, y, r = 0.016, col = '#f4d23c') { rot(f, H, 0, 0, x, y, 0, () => { f.col(col); f.cyl(0, 0, r, -0.003, 0.003, 10); f.col('#fbf3c4'); f.cyl(0, 0, r * 0.82, -0.0031, 0.0031, 10); }); }
function foamTop(f, y, r, col = '#f2e8d8') { f.col(col); dome(f, 0, y, 0, r, 0.008, r, 0.06, 3); }
const handle = (f, x, y0, y1, out = 0.03, r = 0.006) => { f.rod([x, y0, 0], [x + out, y0 + 0.006, 0], r, 5); f.rod([x + out, y0 + 0.006, 0], [x + out, y1 - 0.006, 0], r, 5); f.rod([x + out, y1 - 0.006, 0], [x, y1, 0], r, 5); };

export const VESSELS = {
  mug(f, liq, o) {
    f.col(o.cup || '#eeeae2'); f.lathe(0, 0, [[0, 0], [0.038, 0], [0.04, 0.095], [0.036, 0.095], [0.035, 0.012], [0, 0.012]], 16);
    lq(f, liq, o); f.cyl(0, 0, 0.0355, 0.07, 0.083, 16); handle(f, 0.039, 0.025, 0.075, 0.026, 0.0065);
  },
  cup(f, liq, o) {   // cup and saucer (cappuccino, flat white): foam on top
    f.col('#f4f2ed'); if (!o.hand) f.lathe(0, 0, [[0, 0], [0.06, 0], [0.068, 0.008], [0.064, 0.01], [0.03, 0.005], [0, 0.005]], 18);
    const b = o.hand ? 0 : 0.006;
    f.col('#f4f2ed'); f.lathe(0, 0, [[0, b], [0.026, b], [0.042, b + 0.04], [0.046, b + 0.058], [0.043, b + 0.058], [0.022, b + 0.008], [0, b + 0.008]], 18);
    lq(f, liq, o); f.cyl(0, 0, 0.041, b + 0.046, b + 0.053, 18); f.col('#f4f2ed'); handle(f, 0.044, b + 0.02, b + 0.05, 0.02, 0.005);
    if (!o.hand) { f.col('#8a5a3a'); f.cyl(0, 0, 0.012, b + 0.0532, b + 0.0536, 10); }
  },
  espresso(f, liq, o) {
    f.col('#f4f2ed'); if (!o.hand) f.lathe(0, 0, [[0, 0], [0.042, 0], [0.047, 0.006], [0.044, 0.008], [0, 0.004]], 16);
    const b = o.hand ? 0 : 0.005;
    f.lathe(0, 0, [[0, b], [0.02, b], [0.028, b + 0.042], [0.025, b + 0.042], [0.018, b + 0.006], [0, b + 0.006]], 16);
    lq(f, liq, o); f.cyl(0, 0, 0.0245, b + 0.03, b + 0.036, 14); f.col('#f4f2ed'); handle(f, 0.027, b + 0.014, b + 0.034, 0.014, 0.004);
  },
  latte(f, liq, o) {   // a tall glass with a layered latte
    gl(f, o); f.lathe(0, 0, [[0, 0], [0.032, 0], [0.036, 0.12], [0.034, 0.12], [0.03, 0.006], [0, 0.006]], 16);
    lq(f, liq, o); f.cyl(0, 0, 0.0295, 0.007, 0.095, 16, 0.033); f.col('#f2ead9'); f.cyl(0, 0, 0.0332, 0.095, 0.112, 16, 0.0338);
    if (!o.hand) { f.col(WHITE); f.lathe(0, 0, [[0, 0], [0.05, 0], [0.054, 0.005], [0, 0.005]], 16); }
  },
  takeaway(f, liq, o) {
    f.col('#f4f1ea'); f.cyl(0, 0, 0.029, 0, 0.118, 14, 0.037);
    f.col(o.hand ? '#b88752' : '#b88752'); f.cyl(0, 0, 0.0335, 0.04, 0.085, 14, 0.0358);
    f.col('#2a2a2c'); f.cyl(0, 0, 0.0385, 0.116, 0.127, 14, 0.035);
  },
  teacup(f, liq, o) {
    f.col('#f4f2ed'); if (!o.hand) f.lathe(0, 0, [[0, 0], [0.065, 0], [0.07, 0.007], [0.066, 0.009], [0, 0.005]], 18);
    const b = o.hand ? 0 : 0.006;
    f.col('#f6f4ef'); f.lathe(0, 0, [[0, b], [0.024, b], [0.05, b + 0.045], [0.047, b + 0.045], [0.02, b + 0.008], [0, b + 0.008]], 18);
    f.col('#7aa0c8'); f.lathe(0, 0, [[0.0485, b + 0.04], [0.05, b + 0.044]], 18);
    lq(f, liq, o); f.cyl(0, 0, 0.044, b + 0.036, b + 0.04, 18); f.col('#f6f4ef'); handle(f, 0.048, b + 0.016, b + 0.038, 0.018, 0.004);
    if (!o.hand) { f.col('#f4f0e2'); f.rod([0.03, b + 0.04, 0.01], [0.08, 0.008, 0.06], 0.0012, 3); f.col('#e5c64a'); f.box(0.075, 0.003, 0.055, 0.092, 0.006, 0.072); }
  },
  tall(f, liq, o) { tumblerShape(f, liq, o, 0.03, 0.036, 0.14, 0.82, (y, r) => { ice(f, y, r, 3, 2, o); straw(f, y, '#2b2b2b'); }); },
  frappe(f, liq, o) {
    f.col('#f6f3ee'); f.lathe(0, 0, [[0, 0], [0.029, 0], [0.037, 0.12], [0, 0.12]], 14);
    lq(f, liq, o); f.lathe(0, 0, [[0.0295, 0.004], [0.0372, 0.118]], 14);
    f.col('#fbf7ef'); dome(f, 0, 0.12, 0, 0.037, 0.035, 0.037, 0.12, 4); f.col('#a5622a'); rot(f, 0, 0, 0, 0, 0, 0, () => { for (let k = 0; k < 4; k++) f.rod([-0.025 + k * 0.016, 0.148 - (k % 2) * 0.006, -0.01], [-0.02 + k * 0.016, 0.15, 0.012], 0.002, 4); });
    straw(f, 0.14, '#4caf50', 0.005, 0.1);
  },
  shake(f, liq, o) {
    gl(f, o); f.lathe(0, 0, [[0, 0], [0.03, 0], [0.012, 0.012], [0.012, 0.03], [0.03, 0.045], [0.042, 0.16], [0.04, 0.16], [0.028, 0.048], [0, 0.048]], 16);
    lq(f, liq, o); f.cyl(0, 0, 0.028, 0.048, 0.15, 16, 0.04);
    if (!o.hand) { f.col('#fffaf3'); dome(f, 0, 0.15, 0, 0.038, 0.04, 0.038, 0.15, 5); f.col('#c3182b'); f.sph(0.004, 0.193, 0, 0.009, 0.009, 0.009, 8, 5); straw(f, 0.15, '#e94b6a', 0.014, 0.18); }
  },
  boba(f, liq, o) {
    f.col('#eef3f6'); f.cyl(0, 0, 0.033, 0, 0.14, 14, 0.04);
    lq(f, liq, o); f.cyl(0, 0, 0.0335, 0.004, 0.125, 14, 0.0395);
    if (!o.hand) scatter(f, 14, 0.026, 7, (x, z, k) => { f.col('#2a1a12'); f.sph(x, 0.012 + (k % 3) * 0.012, z, 0.006, 0.006, 0.006, 6, 4); });
    f.col('#e7e2c8'); f.cyl(0, 0, 0.0405, 0.138, 0.142, 14); straw(f, 0.14, '#3c3c3c', 0, 0.05);
  },
  sake(f, liq, o) {
    f.col('#efece3'); f.lathe(0, 0, [[0, 0], [0.028, 0], [0.034, 0.05], [0.02, 0.1], [0.012, 0.13], [0.014, 0.14], [0, 0.14]], 14);
    f.col('#2b4c7e'); f.lathe(0, 0, [[0.0335, 0.045], [0.031, 0.06]], 14);
    if (!o.hand) at(f, 0.07, 0, 0.03, 0, () => { f.col('#efece3'); f.lathe(0, 0, [[0, 0], [0.018, 0], [0.024, 0.03], [0.021, 0.03], [0, 0.006]], 12); f.col(liq); f.cyl(0, 0, 0.02, 0.02, 0.024, 12); });
  },
  smoothie(f, liq, o) {
    gl(f, o); f.lathe(0, 0, [[0, 0], [0.032, 0], [0.04, 0.15], [0.038, 0.15], [0.03, 0.006], [0, 0.006]], 16);
    lq(f, liq, o); f.cyl(0, 0, 0.0295, 0.007, 0.14, 16, 0.0375); f.col(o.hand ? '#ffffff' : liq); if (!o.hand) dome(f, 0, 0.14, 0, 0.037, 0.012, 0.037, 0.1, 6);
    straw(f, 0.14, '#f2f2f2', 0.008, 0.15); if (!o.hand) { f.col('#3f6b2e'); f.sph(-0.015, 0.153, 0.01, 0.01, 0.004, 0.006, 6, 4); }
  },
  soda(f, liq, o) { tumblerShape(f, liq, o, 0.033, 0.037, 0.13, 0.85, (y, r) => { ice(f, y, r, 4, 3, o); straw(f, y, '#d32f2f'); if (!o.hand) lemon(f, 0.03, y + 0.01); }); },
  juice(f, liq, o) { tumblerShape(f, liq, o, 0.03, 0.033, 0.12, 0.85); },
  tumbler(f, liq, o) { tumblerShape(f, liq, o, 0.033, 0.036, 0.1, 0.75, (y, r) => { if (!o.hand) { ice(f, y, r, 2, 5, o); lemon(f, 0.028, y + 0.008, 0.014, '#9ccc4a'); } }); },
  bottle_water(f, liq, o) {
    gl(f, o); f.lathe(0, 0, [[0, 0], [0.032, 0], [0.033, 0.14], [0.022, 0.18], [0.013, 0.2], [0, 0.2]], 14);
    lq(f, liq, o); f.cyl(0, 0, 0.03, 0.004, 0.15, 14);
    f.col('#2f7fd1'); f.cyl(0, 0, 0.0333, 0.06, 0.1, 14); f.col('#e8eef2'); f.cyl(0, 0, 0.0135, 0.2, 0.215, 10);
  },
  can(f, liq, o) {
    f.col(STEEL); f.lathe(0, 0, [[0, 0], [0.027, 0], [0.033, 0.01], [0.033, 0.112], [0.027, 0.122], [0, 0.122]], 16);
    f.col(o.hand ? '#c8202a' : liq); f.cyl(0, 0, 0.0333, 0.014, 0.108, 16); f.col('#f4f4f4'); f.cyl(0, 0, 0.0334, 0.05, 0.06, 16);
  },
  pint(f, liq, o) { tumblerShape(f, liq, o, 0.031, 0.043, 0.155, 0.84, (y, r) => { f.col('#f6efdc'); f.cyl(0, 0, r * 0.95, y - 0.001, y + 0.014, 16, r * 0.97); }); },
  beer_bottle(f, liq, o) {
    f.col('#5a3a12'); f.lathe(0, 0, [[0, 0], [0.03, 0], [0.031, 0.13], [0.014, 0.17], [0.012, 0.215], [0.014, 0.22], [0, 0.22]], 14);
    f.col('#e9d8a6'); f.cyl(0, 0, 0.0315, 0.04, 0.095, 14); f.col('#c62828'); f.cyl(0, 0, 0.0155, 0.19, 0.205, 10);
    if (!o.hand) at(f, 0.075, 0, 0.02, 0, () => VESSELS.pint(f, liq, { ...o, small: true }));
  },
  wine(f, liq, o) {
    gl(f, o); f.lathe(0, 0, [[0, 0], [0.034, 0], [0.034, 0.003], [0.004, 0.006], [0.004, 0.09], [0.03, 0.115], [0.036, 0.15], [0.033, 0.18], [0.031, 0.18], [0.034, 0.15], [0.028, 0.117], [0, 0.1]], 18);
    lq(f, liq, o); f.lathe(0, 0, [[0, 0.1], [0.026, 0.115], [0.032, 0.135], [0, 0.135]], 18);
  },
  wine_big(f, liq, o) {
    gl(f, o); f.lathe(0, 0, [[0, 0], [0.036, 0], [0.036, 0.004], [0.004, 0.009], [0.0045, 0.075], [0.038, 0.1], [0.045, 0.14], [0.04, 0.17], [0.038, 0.17], [0.043, 0.14], [0, 0.085]], 18);
    lq(f, liq, o); f.lathe(0, 0, [[0, 0.085], [0.036, 0.1], [0.043, 0.135], [0, 0.135]], 18);
    if (!o.hand) { ice(f, 0.135, 0.04, 3, 8, o); lemon(f, 0.03, 0.15, 0.018, '#f08a2c'); }
  },
  flute(f, liq, o) {
    gl(f, o); f.lathe(0, 0, [[0, 0], [0.03, 0], [0.03, 0.004], [0.003, 0.009], [0.003, 0.08], [0.018, 0.095], [0.023, 0.2], [0.021, 0.2], [0.016, 0.097], [0, 0.088]], 16);
    lq(f, liq, o); f.lathe(0, 0, [[0, 0.088], [0.016, 0.097], [0.021, 0.17], [0, 0.17]], 16);
  },
  coupe(f, liq, o) {   // margarita: a wide rim with salt and lime
    gl(f, o); f.lathe(0, 0, [[0, 0], [0.034, 0], [0.034, 0.004], [0.004, 0.009], [0.004, 0.08], [0.02, 0.09], [0.055, 0.125], [0.053, 0.127], [0, 0.088]], 18);
    lq(f, liq, o); f.lathe(0, 0, [[0, 0.09], [0.02, 0.095], [0.048, 0.118], [0, 0.118]], 18);
    if (!o.hand) { f.col('#fafafa'); torus(f, 0, 0.126, 0, 0.054, 0.003, 18, 4); lemon(f, 0.05, 0.13, 0.018, '#8bc34a'); }
  },
  martini(f, liq, o) {
    gl(f, o); f.lathe(0, 0, [[0, 0], [0.034, 0], [0.034, 0.004], [0.003, 0.009], [0.003, 0.085], [0.055, 0.14], [0.052, 0.14], [0, 0.088]], 18);
    lq(f, liq, o); f.lathe(0, 0, [[0, 0.09], [0.043, 0.128], [0, 0.128]], 18);
    if (!o.hand) { f.col('#9a8f3a'); f.rod([-0.03, 0.11, 0], [0.03, 0.15, 0], 0.0015, 3); f.col('#5b7f2a'); f.sph(0, 0.125, 0, 0.008, 0.008, 0.008, 8, 5); }
  },
  rocks(f, liq, o) {
    gl(f, o); f.lathe(0, 0, [[0, 0], [0.04, 0], [0.042, 0.085], [0.039, 0.085], [0.038, 0.012], [0, 0.012]], 16);
    lq(f, liq, o); f.cyl(0, 0, 0.037, 0.012, 0.05, 16);
    if (!o.hand) { f.glass('#eaf8ff'); f.boxC(0, 0.048, 0, 0.02, 0.02, 0.02, 0.4); f.col('#f08a2c'); rot(f, 0.4, 0.3, 0, 0.02, 0.065, 0.01, () => f.box(-0.004, -0.02, -0.002, 0.004, 0.02, 0.002)); }
  },
  highball(f, liq, o) { tumblerShape(f, liq, o, 0.03, 0.032, 0.15, 0.85, (y, r) => { ice(f, y, r, 4, 9, o); straw(f, y, '#111111', 0.008, 0.18); if (!o.hand) { f.col('#3e8e41'); for (let k = 0; k < 3; k++) f.sph(-0.01 + k * 0.01, y + 0.005, 0.008 * (k - 1), 0.01, 0.003, 0.007, 6, 4); lemon(f, 0.028, y + 0.006, 0.015, '#8bc34a'); } }); },
  hurricane(f, liq, o) {
    gl(f, o); f.lathe(0, 0, [[0, 0], [0.032, 0], [0.032, 0.004], [0.004, 0.009], [0.005, 0.03], [0.03, 0.06], [0.022, 0.11], [0.036, 0.17], [0.034, 0.17], [0.02, 0.11], [0, 0.04]], 18);
    lq(f, liq, o); f.lathe(0, 0, [[0, 0.04], [0.026, 0.06], [0.02, 0.11], [0.032, 0.155], [0, 0.155]], 18);
    if (!o.hand) { f.col('#f6d64b'); rot(f, 0, 0, 0.3, 0.03, 0.165, 0, () => f.box(-0.006, -0.02, -0.025, 0.006, 0.01, 0.025)); f.col('#d81b60'); f.sph(0.01, 0.165, 0.01, 0.008, 0.008, 0.008, 8, 5); straw(f, 0.155, '#f06292', -0.01, -0.2); }
  },
};
/** A glass's radius and height (for the hand's grip, render/char-props.js). */
export const VESSEL_DIMS = {
  mug: [0.04, 0.095], cup: [0.045, 0.058], espresso: [0.027, 0.042], latte: [0.035, 0.12], takeaway: [0.035, 0.12], teacup: [0.048, 0.045],
  tall: [0.034, 0.14], frappe: [0.034, 0.15], shake: [0.04, 0.16], boba: [0.037, 0.14], sake: [0.03, 0.14], smoothie: [0.036, 0.15], soda: [0.035, 0.13],
  juice: [0.032, 0.12], tumbler: [0.035, 0.1], bottle_water: [0.032, 0.2], can: [0.033, 0.122], pint: [0.038, 0.155], beer_bottle: [0.03, 0.22],
  wine: [0.034, 0.18], wine_big: [0.042, 0.17], flute: [0.022, 0.2], coupe: [0.05, 0.127], martini: [0.05, 0.14], rocks: [0.041, 0.085],
  highball: [0.031, 0.15], hurricane: [0.034, 0.17],
};
export const VESSEL_LIST = Object.keys(VESSELS);

// ------------------------------------------------------------------------------------------------ food parts
const BUN = '#c98a3f', BUN_IN = '#f1d9a8', BEEF = '#5b3420', CHEDDAR = '#f2b53a', LETTUCE = '#7cbf4a', TOMATO = '#d8412f';
const BREAD = '#d9a25e', CRUST = '#a8662c', RICE = '#f5f2e9', EGG_W = '#fbf8f0', YOLK = '#f6b21b', HERB = '#3f7f2a';
const FRY = '#f2c14e', SAUCE_RED = '#b83222', CREAM_S = '#f1e6c8', CHOC = '#4a2a1a', CHICKEN = '#d9a35b', GRILL = '#3a2416';
/** A bun's top (a dome with sesame) sitting at y. */
function bunTop(f, y, r = 0.055, h = 0.035, col = BUN, seeds = true) {
  f.col(BUN_IN); f.cyl(0, 0, r * 0.98, y, y + 0.004, 16);
  f.col(col); dome(f, 0, y + 0.003, 0, r, h, r, 0.04, 2, 16);
  if (seeds) scatter(f, 14, r * 0.7, 5, (x, z) => { const d = Math.hypot(x, z) / r, yy = y + 0.003 + h * Math.sqrt(Math.max(0, 1 - d * d)); f.col('#f4ead2'); f.sph(x, yy, z, 0.004, 0.0018, 0.0025, 5, 3); });
}
function bunBase(f, y, r = 0.054, h = 0.02, col = BUN) { f.col(col); f.cyl(0, 0, r * 0.94, y, y + h * 0.6, 16, r); f.col(BUN_IN); f.cyl(0, 0, r, y + h * 0.6, y + h, 16, r * 0.97); }
function patty(f, y, r = 0.056, h = 0.018, col = BEEF) { f.col(col); f.lathe(0, 0, [[0, y], [r * 0.95, y], [r, y + h * 0.5], [r * 0.96, y + h], [0, y + h]], 16); f.col('#3d2213'); scatter(f, 8, r * 0.8, 11, (x, z) => f.box(x - 0.006, y + h, z - 0.001, x + 0.006, y + h + 0.0008, z + 0.001)); }
function cheese(f, y, s = 0.05, col = CHEDDAR) {
  f.push(0, 0, 0, P / 4); f.col(col); f.box(-s, y, -s, s, y + 0.003, s);
  for (const [x, z] of [[-s, 0], [s, 0], [0, -s], [0, s]]) f.box(x - (x ? 0.004 : 0.012), y - 0.012, z - (z ? 0.004 : 0.012), x + (x ? 0.004 : 0.012), y, z + (z ? 0.004 : 0.012));
  f.pop();
}
function lettuce(f, y, r = 0.06, col = LETTUCE) { f.col(col); f.sph(0, y + 0.003, 0, r, 0.006, r, 16, 3, { disp: (a, b, c) => Math.sin(Math.atan2(c, a) * 9) * 0.08 }); }
function tomatoSlice(f, y, r = 0.045) { f.col(TOMATO); f.cyl(0, 0, r, y, y + 0.006, 14); f.col('#f08a72'); f.cyl(0, 0, r * 0.7, y + 0.0061, y + 0.0062, 10); }
function bacon(f, x, y, z, len = 0.1, yaw = 0, w = 0.02) {
  at(f, x, y, z, yaw, () => { for (let k = 0; k < 6; k++) { const x0 = -len / 2 + k * len / 6, yy = Math.sin(k * 1.4) * 0.004; f.col(k % 2 ? '#a3402c' : '#c2583d'); f.box(x0, yy, -w / 2, x0 + len / 6 + 0.001, yy + 0.004, w / 2); f.col('#f0c9a8'); f.box(x0, yy + 0.004, -w / 2 + 0.004, x0 + len / 6, yy + 0.0045, -w / 2 + 0.008); } });
}
/** A heap of fries (or chips) at (x, z): n sticks. */
function fries(f, x, z, n = 22, R = 0.045, col = FRY, seed = 3, y = TOP) {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const a = r() * TAU, d = Math.sqrt(r()) * R, len = 0.05 + r() * 0.035;
    f.col(r() < 0.3 ? '#e5a93a' : col);
    rot(f, (r() - 0.5) * 0.5, r() * P, 0, x + Math.sin(a) * d, y + 0.005 + r() * 0.025, z + Math.cos(a) * d, () => f.box(-0.0045, -0.0045, -len / 2, 0.0045, 0.0045, len / 2));
  }
}
function egg(f, x, z, y = TOP, r = 0.036, seed = 1) {
  f.col(EGG_W); f.sph(x, y, z, r, 0.006, r * 0.9, 14, 3, { cut: 0, disp: (a, b, c) => Math.sin(Math.atan2(c, a) * 5 + seed) * 0.12 });
  f.col(YOLK); dome(f, x + 0.004, y + 0.004, z - 0.002, r * 0.38, r * 0.3, r * 0.38, 0.02, seed, 10);
}
/** A slice of bread/toast lying flat: a rounded-top slice. */
function toast(f, x, y, z, yaw = 0, s = 0.05, col = '#d39a52', crust = CRUST, h = 0.012) {
  const poly = [];
  for (let k = 0; k <= 8; k++) { const a = P * k / 8; poly.push([Math.cos(a) * s * 0.9, s * 0.35 + Math.sin(a) * s * 0.55]); }
  poly.push([-s * 0.85, -s * 0.85], [s * 0.85, -s * 0.85]);
  const pts = [poly[poly.length - 1], ...poly.slice(0, poly.length - 1)];
  at(f, x, y, z, yaw, () => { f.col(crust); prism(f, pts.map(([a, b]) => [a, b]).reverse(), 0, h); f.col(col); within(f, new THREE.Matrix4().makeScale(0.88, 1, 0.88), () => prism(f, pts.reverse(), h, h + 0.0012, false)); });
}
function sausage(f, a, b, r = 0.011, col = '#8a3b22') { f.col(col); capsule(f, a, b, r, 8); }
/** A heap of leaves (salad): n leaves of the colours given. */
function leaves(f, x, z, R = 0.07, n = 18, cols = [LETTUCE, '#5f9e35', '#a3cf5c', '#8a2f4a'], seed = 4, y = TOP) {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const a = r() * TAU, d = Math.sqrt(r()) * R, c = cols[Math.floor(r() * cols.length)];
    f.col(c); rot(f, (r() - 0.5) * 1.2, r() * TAU, (r() - 0.5) * 1.2, x + Math.sin(a) * d, y + 0.012 + (1 - d / R) * 0.022 + r() * 0.01, z + Math.cos(a) * d,
      () => f.sph(0, 0, 0, 0.022, 0.003, 0.014, 8, 3, { disp: (u, v, w) => Math.sin(u * 14) * 0.15 }));
  }
}
function rice(f, x, z, r = 0.05, h = 0.035, col = RICE, y = TOP) { f.col(col); dome(f, x, y, z, r, h, r, 0.06, 9, 14); }
/** A nest of noodles (spaghetti, chow mein): loops of tube. */
function noodles(f, x, z, R = 0.055, h = 0.03, col = '#f0d58a', seed = 6, y = TOP, n = 9) {
  const r = rng(seed);
  for (let k = 0; k < n; k++) { const rr = R * (0.35 + r() * 0.65); rot(f, (r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5, x + (r() - 0.5) * 0.02, y + 0.006 + k * h / n, z + (r() - 0.5) * 0.02, () => { f.col(k % 3 ? col : '#e8c870'); torus(f, 0, 0, 0, rr, 0.0035, 18, 4); }); }
}
function herbs(f, R, y, n = 10, seed = 7, col = HERB, x0 = 0, z0 = 0) { scatter(f, n, R, seed, (x, z, k, r) => { f.col(col); f.boxC(x0 + x, y, z0 + z, 0.004, 0.0012, 0.0025, r() * 3); }); }
/** Chunks in a sauce (curry, stew): small rounded cubes. */
function chunks(f, n, R, y, s, cols, seed = 8, x0 = 0, z0 = 0) { scatter(f, n, R, seed, (x, z, k, r) => { f.col(cols[k % cols.length]); blob(f, x0 + x, y, z0 + z, s, s * 0.7, s, 0.2, seed + k, 7, 4); }); }
function sauce(f, x, y, z, r, col, h = 0.006) { f.col(col); dome(f, x, y, z, r, h, r * 0.9, 0.1, 3, 14); }
function steak(f, x, z, w = 0.1, d = 0.07, h = 0.022, col = '#6a3a22', y = TOP, marks = true) {
  f.col(col); blob(f, x, y, z, w / 2, h, d / 2, 0.05, 4, 14, 6, 0);
  if (marks) { f.col(GRILL); for (let k = -2; k <= 2; k++) at(f, x + k * w * 0.16, y + h * 0.98, z, 0.7, () => f.box(-0.003, 0, -d * 0.36, 0.003, 0.0012, d * 0.36)); }
}
function fillet(f, x, z, w = 0.11, d = 0.055, h = 0.022, col = '#f08c5a', y = TOP) {
  f.col(col); blob(f, x, y, z, w / 2, h, d / 2, 0.04, 5, 14, 6, 0);
  f.col('#f7c3a2'); for (let k = -2; k <= 2; k++) at(f, x + k * w * 0.15, y + h * 0.95, z, 0.35, () => f.box(-0.0015, 0, -d * 0.4, 0.0015, 0.0012, d * 0.4));
}
function drumstick(f, x, z, yaw = 0, s = 1, col = '#b9692f', y = TOP) {
  if (taken()) return;
  at(f, x, y, z, yaw, () => { f.col(col); f.sph(0, 0.018 * s, 0, 0.032 * s, 0.022 * s, 0.024 * s, 10, 6); f.col('#efe3cc'); f.rod([0.025 * s, 0.014 * s, 0], [0.065 * s, 0.012 * s, 0], 0.006 * s, 6); f.sph(0.068 * s, 0.012 * s, 0, 0.009 * s, 0.009 * s, 0.009 * s, 6, 4); });
}
function shrimp(f, x, y, z, yaw = 0, s = 1, col = '#f28a5a') {
  at(f, x, y, z, yaw, () => { for (let k = 0; k < 6; k++) { const a = P * 0.15 + k * P * 0.17, rr = 0.022 * s; f.col(k === 5 ? '#d9452c' : k % 2 ? col : '#f6a77e'); f.sph(Math.cos(a) * rr, 0.008 * s, Math.sin(a) * rr, (0.011 - k * 0.0012) * s, (0.009 - k * 0.0008) * s, (0.011 - k * 0.0012) * s, 8, 5); } });
}
/** A round of pizza (radius r) at y; topping(f, r, y) draws on the cheese. cut: slices marked. */
function pizza(f, r, y, cheeseCol = '#f3d27a', topping = null, cut = true) {
  f.col('#d99a4e'); torus(f, 0, y + 0.008, 0, r - 0.008, 0.009, 28, 6);
  f.col('#e3b06a'); f.cyl(0, 0, r - 0.006, y, y + 0.006, 28);
  f.col(SAUCE_RED); f.cyl(0, 0, r - 0.012, y + 0.006, y + 0.008, 28);
  f.col(cheeseCol); f.sph(0, y + 0.008, 0, r - 0.016, 0.004, r - 0.016, 28, 3, { cut: 0, disp: (a, b, c) => (hsh(a * 9, b, c * 9) - 0.5) * 0.04 });
  if (topping) topping(f, r - 0.02, y + 0.011);
  if (cut) { f.col('#c98b45'); for (let k = 0; k < 4; k++) at(f, 0, y + 0.0125, 0, k * P / 4, () => f.box(-0.0012, 0, -r + 0.01, 0.0012, 0.0006, r - 0.01)); }
}
/** A slice of layered cake (or pie): layers [[col, h] …] from the bottom, then a top colour; r its length. */
function cakeSlice(f, x, z, yaw, r, layers, top = null, y = TOP, deco = null) {
  at(f, x, y, z, yaw, () => {
    let yy = 0; for (const [c, h] of layers) { f.col(c); wedge(f, r, -0.38, 0.38, yy, yy + h, 6); yy += h; }
    if (top) { f.col(top); wedge(f, r * 1.01, -0.385, 0.385, yy, yy + 0.004, 6); yy += 0.004; }
    if (deco) deco(yy, r);
  });
}
function scoop(f, x, y, z, r = 0.026, col = '#f6e7c8', seed = 1) { f.col(col); blob(f, x, y, z, r, r * 0.9, r, 0.08, seed, 10, 6); f.col(col); torus(f, x, y - r * 0.45, z, r * 0.92, r * 0.18, 12, 4); }
function dumpling(f, x, y, z, s = 1, col = '#f1eadb', yaw = 0) {
  at(f, x, y, z, yaw, () => { f.col(col); f.sph(0, 0.012 * s, 0, 0.022 * s, 0.016 * s, 0.018 * s, 10, 5, { cut: -0.3, disp: (a, b, c) => (b > 0.4 ? Math.sin(Math.atan2(c, a) * 8) * 0.12 : 0) }); });
}
function nigiri(f, x, z, yaw, fish = '#f2875a', stripes = '#fbd1bd', y = TOP) {
  at(f, x, y, z, yaw, () => { f.col(RICE); blob(f, 0, 0.0, 0, 0.022, 0.016, 0.013, 0.04, 3, 10, 5, 0); f.col(fish); f.sph(0, 0.016, 0, 0.027, 0.007, 0.016, 10, 4, { cut: -0.5 }); f.col(stripes); for (let k = -1; k <= 1; k++) f.box(k * 0.01 - 0.0012, 0.0225, -0.012, k * 0.01 + 0.0012, 0.0228, 0.012); });
}
function maki(f, x, z, fill = '#f2875a', y = TOP, h = 0.022, r = 0.016) { f.col('#1b2a1f'); f.cyl(x, z, r, y, y + h, 12); f.col(RICE); f.cyl(x, z, r * 0.86, y + h, y + h + 0.001, 12); f.col(fill); f.cyl(x, z, r * 0.35, y + h + 0.001, y + h + 0.0016, 8); }
/** A soft tortilla or flatbread folded in half, standing (a taco): shell of radius r. */
function tacoShell(f, x, z, yaw, r = 0.045, col = '#e9c77a', filling = ['#7a4b2a', LETTUCE, TOMATO, '#f3e3a3'], y = TOP) {
  if (taken()) return;
  // folded along its length (local x): a U of tortilla standing on its fold, the filling heaped in it
  at(f, x, y, z, yaw, () => {
    rot(f, 0, 0, H, 0, r, 0, () => { f.col(col); f.lathe(0, 0, [[r, -0.05], [r * 0.98, 0.05]], 16, P + 0.35, TAU - 0.35); f.col('#d9b25e'); f.lathe(0, 0, [[r * 0.985, -0.05], [r * 0.965, 0.05]], 16, P + 0.35, TAU - 0.35); });
    filling.forEach((c, k) => { f.col(c); blob(f, 0, r * (0.42 + k * 0.17), 0, 0.045, 0.01 + (k === 0 ? 0.008 : 0), r * (0.62 - k * 0.06), 0.3, k + 3, 9, 5); });
  });
}
/** A wrap or burrito lying on its side: length L, radius r; cut: one end cut showing the filling. */
function wrapRoll(f, x, z, yaw, L = 0.13, r = 0.026, col = '#efd9a4', fill = ['#c46a3a', LETTUCE, '#f5f0e4'], cut = true, y = TOP) {
  if (taken()) return;
  at(f, x, y + r, z, yaw, () => {
    f.col(col); f.rod([-L / 2, 0, 0], [L / 2, 0, 0], r, 12); f.sph(-L / 2, 0, 0, r, r, r, 12, 6);
    if (cut) { fill.forEach((c, k) => { f.col(c); rot(f, 0, 0, H, L / 2 + 0.0005, 0, 0, () => f.cyl((k - 1) * r * 0.35, (k % 2 - 0.5) * r * 0.3, r * 0.35, 0, 0.0012, 8)); }); f.col(col); rot(f, 0, 0, -H, L / 2, 0, 0, () => f.lathe(0, 0, [[r, 0], [r * 0.85, 0.001]], 12)); }
    else f.sph(L / 2, 0, 0, r, r, r, 12, 6);
  });
}
/** A sandwich half (a triangle, cut side toward +z) with layers [[col, h] …] between two slices of bread. */
function sandwichHalf(f, x, z, yaw, s = 0.06, layers = [['#e9b38c', 0.008], [LETTUCE, 0.004], [TOMATO, 0.004]], bread = '#e9cf9a', crust = CRUST, y = TOP, stand = false) {
  if (taken()) return;
  const tri = [[-s, 0], [s, 0], [0, -s * 1.2]];
  const body = () => {
    let yy = 0;
    const slice = () => { f.col(crust); prism(f, tri, yy, yy + 0.011); f.col(bread); within(f, new THREE.Matrix4().makeScale(0.94, 1, 0.94), () => prism(f, tri, yy + 0.0001, yy + 0.0111, true)); yy += 0.011; };
    slice(); for (const [c, h] of layers) { f.col(c); within(f, new THREE.Matrix4().makeScale(1.03, 1, 1.03), () => prism(f, tri, yy, yy + h)); yy += h; } slice();
  };
  at(f, x, y, z, yaw, () => (stand ? rot(f, H * 0.92, 0, 0, 0, 0, 0.004, body) : body()));
}
function onionRings(f, n, R, y, seed = 4) { scatter(f, n, R, seed, (x, z, k, r) => rot(f, (r() - 0.5) * 0.9, 0, (r() - 0.5) * 0.9, x, y + 0.01 + k * 0.006, z, () => { f.col(k % 2 ? '#d9a04a' : '#c98d3c'); torus(f, 0, 0, 0, 0.022, 0.008, 14, 5); })); }
function nuggets(f, n, R, y, seed = 5) { scatter(f, n, R, seed, (x, z, k) => { f.col(k % 2 ? '#d49a4a' : '#c78a3e'); blob(f, x, y + 0.008, z, 0.02, 0.011, 0.016, 0.18, k, 8, 5, 0); }); }
function wing(f, x, z, yaw, col = '#c2401c', y = TOP) { if (taken()) return; at(f, x, y, z, yaw, () => { f.col(col); blob(f, 0, 0.012, 0, 0.026, 0.013, 0.016, 0.15, 3, 9, 5, 0); f.col('#efe3cc'); f.rod([0.022, 0.01, 0], [0.034, 0.01, 0], 0.004, 5); }); }
function pita(f, x, z, yaw, s = 0.05, col = '#e6c27f', y = TOP) { at(f, x, y, z, yaw, () => { f.col(col); prism(f, [[-s * 0.5, 0], [s * 0.5, 0], [0, -s]], 0, 0.008); }); }
function croissant(f, x, y, z, yaw = 0, s = 1) {
  if (taken()) return;
  at(f, x, y, z, yaw, () => { for (let k = -3; k <= 3; k++) { const a = k * 0.32, rr = 0.045 * s, w = (1 - Math.abs(k) / 4.2) * 0.022 * s; f.col(k % 2 ? '#c27a2e' : '#d5913c'); f.sph(Math.sin(a) * rr, w * 0.9, Math.cos(a) * rr - rr * 0.7, w * 1.15, w, w * 1.1, 10, 5, { cut: -0.5 }); } });
}
function donut(f, x, y, z, glaze = '#f3d3b0', sprinkles = false, seed = 1) {
  if (taken()) return;
  f.col('#c7843c'); torus(f, x, y + 0.016, z, 0.03, 0.016, 18, 8);
  f.col(glaze); torus(f, x, y + 0.019, z, 0.03, 0.0145, 18, 8);
  if (sprinkles) scatter(f, 18, 0.04, seed, (sx, sz, k, r) => { const d = Math.hypot(sx, sz); if (d < 0.017 || d > 0.043) return; f.col(['#e94b6a', '#4caf50', '#2f80ed', '#f6d64b'][k % 4]); f.boxC(x + sx, y + 0.034, z + sz, 0.004, 0.0012, 0.0012, r() * 3); });
}
function muffinShape(f, x, y, z, top = '#b0702e', dots = '#3b2f6b', paper = '#e9e2d0', s = 1) {
  if (taken()) return;
  f.col(paper); f.lathe(x, z, [[0, y], [0.028 * s, y], [0.034 * s, y + 0.035 * s], [0, y + 0.035 * s]], 14);
  for (let k = 0; k < 12; k++) { f.col('#d8cfb8'); at(f, x, y, z, k * TAU / 12, () => f.box(-0.0008, 0, 0.0285 * s, 0.0008, 0.034 * s, 0.0345 * s)); }
  f.col(top); blob(f, x, y + 0.033 * s, z, 0.04 * s, 0.03 * s, 0.04 * s, 0.1, 2, 12, 6, 0);
  if (dots) scatter(f, 8, 0.03 * s, 3, (dx, dz) => { f.col(dots); f.sph(x + dx, y + 0.033 * s + 0.026 * s * (1 - Math.hypot(dx, dz) / (0.04 * s)), z + dz, 0.005, 0.005, 0.005, 6, 4); });
}
function cookie(f, x, y, z, r = 0.035, col = '#c98f4c', chips = CHOC, seed = 1) { if (taken()) return; f.col(col); f.sph(x, y, z, r, 0.008, r, 14, 4, { cut: 0, disp: (a, b, c) => (hsh(a * 6 + seed, b, c * 6) - 0.5) * 0.08 }); if (chips) scatter(f, 7, r * 0.75, seed, (dx, dz) => { f.col(chips); f.sph(x + dx, y + 0.007, z + dz, 0.004, 0.003, 0.004, 6, 3); }); }
function cone(f, x, y, z, scoops = ['#f6e7c8'], tilt = 0) {
  rot(f, tilt, 0, 0, x, y, z, () => { f.col('#d9a25e'); f.lathe(0, 0, [[0, 0], [0.026, 0.1], [0.028, 0.104], [0, 0.104]], 14); f.col('#b98244'); for (let k = 0; k < 5; k++) f.lathe(0, 0, [[0.0052 * k + 0.002, 0.02 * k + 0.004], [0.0052 * k + 0.0028, 0.02 * k + 0.006]], 14); scoops.forEach((c, k) => scoop(f, 0, 0.124 + k * 0.034, 0, 0.028 - k * 0.002, c, k + 2)); });
}
/** A soup or curry in a bowl: liquid col, garnish(fill y). */
function soupBowl(f, col, garnish, r = 0.08, h = 0.055, bcol = WHITE, fill = 0.8) { const y = bowl(f, r, h, bcol)(fill); surface(f, r, h, y, col); if (garnish) garnish(y); return y; }
/** A plate with a main thing, a side and a garnish. */
function plated(f, main, side = null, r = 0.125, col = WHITE, rim = null, knife = true) { plate(f, r, col, rim); main(); if (side) side(); if (knife) cutlery(f, r); }
/** A fork lying across a bowl's rim or a dessert plate. */
function fork(f, x, y, z, yaw = 0.5) { if (BARE) return; at(f, x, y, z, yaw, () => { f.col(STEEL); f.box(-0.004, 0, -0.07, 0.004, 0.003, 0.03); for (let k = 0; k < 3; k++) f.box(-0.004 + k * 0.003, 0, 0.03, -0.003 + k * 0.003, 0.003, 0.05); }); }
function spoon(f, x, y, z, yaw = 0.5) { if (BARE) return; at(f, x, y, z, yaw, () => { f.col(STEEL); f.box(-0.0035, 0, -0.07, 0.0035, 0.003, 0.02); f.sph(0, 0.002, 0.034, 0.012, 0.003, 0.018, 8, 3); }); }

// ------------------------------------------------------------------------------------------------ the items
// id → builder (drinks: their glass, VESSELS[item.v], filled with item.liq)
const SYRUP = '#9a4a12', BUTTER = '#f6dc7a', BERRY = '#3b2f6b', STRAW = '#d62f45', GUAC = '#7fa83a', BEANS = '#6a3a24', CHEESE_W = '#f7e6a8';
const burgerStack = (f, o = {}) => {
  if (taken()) return;
  const y0 = o.y ?? TOP, r = o.r ?? 0.055;
  let y = y0; bunBase(f, y, r, 0.02, o.bun); y += 0.02;
  if (o.lettuce !== false) { lettuce(f, y, r * 1.1); y += 0.008; }
  if (o.tomato !== false) { tomatoSlice(f, y, r * 0.8); y += 0.006; }
  for (let k = 0; k < (o.patties ?? 1); k++) { if (o.chicken) { f.col('#c9853a'); blob(f, 0, y, 0, r * 1.08, 0.012, r * 0.95, 0.12, 4, 14, 5, 0); y += 0.02; } else if (o.veggie) { patty(f, y, r * 0.95, 0.018, '#7a6a3a'); y += 0.018; } else { patty(f, y, r, 0.017); y += 0.017; } if (o.cheese !== false) { cheese(f, y, r * 0.78); y += 0.003; } }
  if (o.bacon) { bacon(f, -0.01, y, 0, 0.11, 0.3, 0.018); bacon(f, 0.01, y + 0.004, 0.012, 0.11, -0.4, 0.018); y += 0.008; }
  if (o.onion) { f.col('#f1e9f2'); torus(f, 0.01, y + 0.002, 0, 0.025, 0.003, 14, 4); }
  bunTop(f, y, r * 1.02, 0.034, o.bun || BUN, o.seeds !== false);
};
const pizzaT = {
  pepperoni: (f, r, y) => scatter(f, 14, r * 0.9, 21, (x, z) => { f.col('#a8321f'); f.cyl(x, z, 0.014, y - 0.001, y + 0.002, 10); }),
  hawaiian: (f, r, y) => { scatter(f, 10, r * 0.9, 22, (x, z, k, R) => { f.col('#f6d64b'); f.boxC(x, y, z, 0.008, 0.004, 0.008, R() * 3); }); scatter(f, 9, r * 0.9, 23, (x, z, k, R) => { f.col('#e79a8f'); f.boxC(x, y, z, 0.01, 0.002, 0.007, R() * 3); }); },
  veggie: (f, r, y) => { scatter(f, 9, r * 0.9, 24, (x, z, k, R) => { f.col(k % 2 ? '#3f8a3a' : '#d84a2b'); f.boxC(x, y, z, 0.01, 0.002, 0.004, R() * 3); }); scatter(f, 7, r * 0.85, 25, (x, z) => { f.col('#2b2b2b'); torus(f, x, y, z, 0.006, 0.0022, 8, 3); }); scatter(f, 6, r * 0.8, 26, (x, z) => { f.col('#8a6a4a'); f.cyl(x, z, 0.008, y - 0.001, y + 0.002, 8); }); },
  margherita: (f, r, y) => { scatter(f, 5, r * 0.75, 27, (x, z) => { f.col('#fbf7ec'); f.sph(x, y, z, 0.018, 0.004, 0.018, 10, 3); }); scatter(f, 6, r * 0.8, 28, (x, z, k, R) => { f.col('#2f7d32'); f.sph(x, y + 0.004, z, 0.008, 0.0015, 0.005, 6, 3); }); },
  four: (f, r, y) => scatter(f, 12, r * 0.85, 29, (x, z, k) => { f.col(['#fbf3d8', '#f2c14e', '#e8e0b8', '#d9c48a'][k % 4]); f.sph(x, y, z, 0.016, 0.003, 0.016, 10, 3); }),
  bbq: (f, r, y) => { scatter(f, 10, r * 0.85, 30, (x, z, k, R) => { f.col('#c48a4a'); f.boxC(x, y + 0.002, z, 0.009, 0.004, 0.007, R() * 3); }); f.col('#6b2a14'); for (let k = 0; k < 3; k++) at(f, 0, y + 0.004, (k - 1) * 0.03, 0.4, () => f.box(-r * 0.7, 0, -0.002, r * 0.7, 0.001, 0.002)); scatter(f, 8, r * 0.8, 31, (x, z) => { f.col('#8a2a5a'); f.boxC(x, y + 0.003, z, 0.006, 0.001, 0.002, x * 40); }); },
};
const curry = (f, sauceCol, chunkCols, rice_ = true, bowlCol = '#e9e4da', garn = HERB) => {
  plate(f, 0.13, WHITE); if (rice_) rice(f, -0.045, 0.02, 0.05, 0.03);
  at(f, 0.04, TOP, -0.02, 0, () => { const y = bowl(f, 0.062, 0.042, bowlCol)(0.8); surface(f, 0.062, 0.042, y, sauceCol); chunks(f, 7, 0.035, y, 0.011, chunkCols, 9); herbs(f, 0.035, y + 0.006, 8, 9, garn); });
  spoon(f, 0.0, 0.0, 0.14, 0.0);
};
const pasta = (f, noodleCol, sauceCol, top) => { plate(f, 0.125, WHITE); noodles(f, 0, 0, 0.06, 0.032, noodleCol, 6, TOP, 10); if (sauceCol) sauce(f, 0, TOP + 0.03, 0, 0.032, sauceCol, 0.012); if (top) top(TOP + 0.042); fork(f, 0.06, TOP + 0.02, 0.06, 2.2); };
const salad = (f, cols, extra, bowlCol = WHITE, r = 0.09) => { const y = bowl(f, r, 0.05, bowlCol)(0.55); leaves(f, 0, 0, r * 0.72, 22, cols, 4, y - 0.01); if (extra) extra(y + 0.02); fork(f, 0.08, 0.05, 0.03, 2.6); };
const wedgeDessert = (f, layers, top, deco, plateCol = WHITE) => { plate(f, 0.095, plateCol); cakeSlice(f, 0, 0.01, P, 0.08, layers, top, TOP, deco); fork(f, 0.065, TOP, 0.02, -0.3); };
const sushiBoard = f => { at(f, 0, 0, 0, 0, () => { f.col('#c09a62'); f.box(-0.14, 0, -0.07, 0.14, 0.018, 0.07); f.col('#9a7a48'); f.box(-0.12, -0.012, -0.06, -0.1, 0, 0.06); f.box(0.1, -0.012, -0.06, 0.12, 0, 0.06); }); };
const Y_BOARD = 0.018;
const wasabi = (f, x, z, y) => { f.col('#9cc24a'); blob(f, x, y, z, 0.012, 0.008, 0.01, 0.2, 3, 8, 4, 0); f.col('#f2a8a0'); for (let k = 0; k < 3; k++) f.sph(x + 0.022 + k * 0.004, y + 0.003, z + k * 0.006, 0.01, 0.002, 0.008, 8, 3); };

const R = {
  // ---------------------------------------------------------------- breakfast & brunch
  pancakes: f => { plate(f); for (let k = 0; k < 4; k++) { f.col(k % 2 ? '#d49a52' : '#c98a42'); f.cyl(0, 0, 0.06 - k * 0.001, TOP + k * 0.012, TOP + k * 0.012 + 0.011, 20, 0.058 - k * 0.001); } f.col(SYRUP); f.sph(0, TOP + 0.047, 0, 0.052, 0.004, 0.052, 18, 3, { cut: 0, disp: (a, b, c) => Math.sin(Math.atan2(c, a) * 6) * 0.12 }); f.col(BUTTER); f.box(-0.012, TOP + 0.05, -0.012, 0.012, TOP + 0.062, 0.012); scatter(f, 6, 0.08, 4, (x, z) => { if (Math.hypot(x, z) < 0.065) return; f.col(BERRY); f.sph(x, TOP + 0.006, z, 0.007, 0.007, 0.007, 6, 4); }); cutlery(f); },
  waffles: f => { plate(f); for (const [x, yaw] of [[-0.03, 0.2], [0.035, -0.3]]) at(f, x, TOP, 0, yaw, () => { f.col('#d39a4a'); f.box(-0.04, 0, -0.045, 0.04, 0.014, 0.045); f.col('#b97a32'); for (let k = -3; k <= 3; k++) { f.box(k * 0.011 - 0.002, 0.014, -0.045, k * 0.011 + 0.002, 0.0145, 0.045); f.box(-0.04, 0.014, k * 0.012 - 0.002, 0.04, 0.0145, k * 0.012 + 0.002); } }); f.col('#fbf6ec'); dome(f, 0, TOP + 0.016, 0.02, 0.02, 0.016, 0.02, 0.15, 3); scatter(f, 5, 0.05, 6, (x, z) => { f.col(STRAW); f.sph(x, TOP + 0.022, z, 0.009, 0.008, 0.009, 8, 4); }); cutlery(f); },
  french_toast: f => { plate(f); toast(f, -0.02, TOP, 0.01, 0.3, 0.05, '#d9993f', '#9a5a22', 0.016); toast(f, 0.025, TOP + 0.012, -0.015, -0.4, 0.05, '#d9993f', '#9a5a22', 0.016); f.col('#f4f1ea'); scatter(f, 30, 0.05, 2, (x, z) => f.boxC(x, TOP + 0.031, z, 0.002, 0.0008, 0.002)); scatter(f, 4, 0.03, 9, (x, z) => { f.col(STRAW); f.sph(x + 0.06, TOP + 0.008, z + 0.05, 0.009, 0.008, 0.009, 8, 4); }); cutlery(f); },
  eggs_bacon: f => { plate(f); egg(f, -0.035, 0.02); egg(f, 0.025, 0.035, TOP, 0.034, 3); bacon(f, 0.0, TOP, -0.045, 0.11, 0.1); bacon(f, 0.0, TOP + 0.003, -0.02, 0.11, -0.1); toast(f, 0.075, TOP, 0.0, 1.4, 0.035); cutlery(f); },
  full_breakfast: f => { platter(f, 0.15, 0.115); egg(f, -0.06, 0.03); bacon(f, -0.02, TOP, -0.05, 0.1, 0.2); sausage(f, [0.02, TOP + 0.012, 0.04], [0.08, TOP + 0.012, 0.03]); sausage(f, [0.02, TOP + 0.012, 0.065], [0.08, TOP + 0.012, 0.055]); at(f, 0.06, TOP, -0.04, 0, () => { f.col('#c4502a'); scatter(f, 18, 0.03, 7, (x, z) => f.sph(x, 0.006, z, 0.007, 0.006, 0.005, 6, 3)); }); f.col('#c9b28a'); dome(f, -0.09, TOP, -0.03, 0.022, 0.012, 0.022, 0.1); f.col('#d84a2b'); dome(f, 0.0, TOP, 0.06, 0.02, 0.016, 0.02, 0.05, 5); toast(f, 0.11, TOP, 0.03, 1.6, 0.03); cutlery(f, 0.15); },
  omelette: f => { plate(f); f.col('#f4cf5c'); within(f, new THREE.Matrix4().makeScale(1, 1, 0.55), () => f.sph(0, TOP, 0, 0.07, 0.022, 0.07, 18, 6, { cut: 0 })); herbs(f, 0.05, TOP + 0.022, 12, 3); f.col(CHEESE_W); f.box(0.05, TOP + 0.004, -0.004, 0.065, TOP + 0.01, 0.006); side(() => leaves(f, -0.07, 0.05, 0.03, 6)); cutlery(f); },
  eggs_benedict: f => { plate(f); for (const x of [-0.035, 0.035]) at(f, x, TOP, 0, 0, () => { f.col('#d9a85e'); f.cyl(0, 0, 0.034, 0, 0.016, 14); f.col('#e79a8f'); f.cyl(0, 0, 0.032, 0.016, 0.02, 14); f.col(EGG_W); dome(f, 0, 0.02, 0, 0.03, 0.02, 0.03, 0.1, 2); f.col('#f7d35e'); f.sph(0, 0.034, 0, 0.033, 0.006, 0.03, 12, 3, { cut: 0, disp: (a, b, c) => Math.sin(Math.atan2(c, a) * 5) * 0.18 }); f.col('#c62828'); scatter(f, 6, 0.012, 3, (sx, sz) => f.boxC(sx, 0.041, sz, 0.002, 0.0006, 0.002)); }); leaves(f, 0, 0.065, 0.03, 6); cutlery(f); },
  avocado_toast: f => { plate(f, 0.12, '#e8e4dc'); toast(f, 0, TOP, 0, 0, 0.055, '#d8a35c', '#8a5a2a', 0.014); f.col('#8db84a'); scatter(f, 9, 0.035, 8, (x, z, k, r) => { f.col(k % 3 ? '#9cc451' : '#6f9a33'); rot(f, 0, r() * 3, 0, x, TOP + 0.018, z + 0.005, () => f.sph(0, 0, 0, 0.016, 0.005, 0.008, 8, 3)); }); egg(f, 0.0, 0.0, TOP + 0.022, 0.026, 5); scatter(f, 10, 0.04, 9, (x, z) => { f.col('#c62828'); f.boxC(x, TOP + 0.026, z, 0.0015, 0.0006, 0.0015); }); cutlery(f, 0.12); },
  breakfast_burrito: f => { plate(f); wrapRoll(f, 0, 0, 0.3, 0.13, 0.028, '#ecd3a0', [YOLK, '#c4502a', '#6a3a24']); ramekin(f, -0.07, 0.07, '#c84a2a'); ramekin(f, 0.08, 0.06, GUAC); cutlery(f); },
  yogurt_parfait: f => { gl(f, {}); f.lathe(0, 0, [[0, 0], [0.034, 0], [0.04, 0.11], [0.038, 0.11], [0.032, 0.006], [0, 0.006]], 16); const layers = [['#fbf8f2', 0.025], ['#c9935a', 0.012], ['#a32a4a', 0.012], ['#fbf8f2', 0.025], ['#c9935a', 0.012]]; let y = 0.006; for (const [c, h] of layers) { f.col(c); f.cyl(0, 0, 0.031 + y * 0.05, y, y + h, 16); y += h; } scatter(f, 5, 0.022, 3, (x, z) => { f.col(BERRY); f.sph(x, y + 0.006, z, 0.008, 0.008, 0.008, 8, 4); }); f.col(STRAW); f.sph(0.01, y + 0.012, -0.012, 0.01, 0.01, 0.01, 8, 5); spoon(f, 0.03, y, 0, 1.2); },
  oatmeal: f => soupBowl(f, '#e3cfa2', y => { scatter(f, 8, 0.045, 4, (x, z, k) => { f.col(k % 2 ? BERRY : STRAW); f.sph(x, y + 0.004, z, 0.008, 0.007, 0.008, 8, 4); }); f.col('#f2d27a'); for (let k = 0; k < 4; k++) at(f, 0.02, y + 0.003, -0.01, k * 0.5, () => f.box(-0.01, 0, -0.003, 0.012, 0.004, 0.003)); spoon(f, 0.05, y, 0.03, 0.8); }),
  acai_bowl: f => soupBowl(f, '#5b2347', y => { const rows = [['#f4d23c', -0.04], [STRAW, -0.013], ['#c9935a', 0.014], ['#2a2a4a', 0.04]]; for (const [c, z] of rows) scatter(f, 6, 0.012, z * 1000, (x, zz) => { f.col(c); f.sph(x, y + 0.005, z + zz, 0.009, 0.006, 0.009, 7, 4); }); f.col('#f2f0e6'); torus(f, 0.0, y + 0.004, 0.0, 0.05, 0.002, 18, 3); }, 0.08, 0.055, '#e8e2d6'),
  bagel_lox: f => { plate(f); for (const [x, yaw] of [[-0.035, 0.2], [0.04, -0.2]]) at(f, x, TOP, 0, yaw, () => { f.col('#c88a3e'); torus(f, 0, 0.01, 0, 0.032, 0.012, 16, 6); f.col('#fbf6ec'); f.cyl(0, 0, 0.042, 0.016, 0.02, 16); f.col('#f2875a'); for (let k = 0; k < 3; k++) rot(f, 0.2, k * 2, 0, 0, 0.022 + k * 0.002, 0, () => f.sph(0.01, 0, 0, 0.026, 0.003, 0.015, 10, 3)); f.col('#7a1f4a'); torus(f, 0.008, 0.028, 0.004, 0.012, 0.002, 10, 3); }); herbs(f, 0.07, TOP + 0.034, 8, 4); cutlery(f); },
  // ---------------------------------------------------------------- bakery & pastries
  croissant: f => { plate(f, 0.09); croissant(f, 0, TOP, 0.0, 0.3); },
  pain_au_chocolat: f => { plate(f, 0.09); if (taken()) return; at(f, 0, TOP, 0, 0.3, () => { f.col('#cf8a3a'); for (let k = 0; k < 4; k++) f.box(-0.05 + k * 0.001, k * 0.007, -0.03 + k * 0.002, 0.05 - k * 0.001, k * 0.007 + 0.009, 0.03 - k * 0.002); f.col('#d99a4a'); dome(f, 0, 0.026, 0, 0.048, 0.01, 0.028, 0.05, 3); f.col(CHOC); f.box(0.05, 0.008, -0.012, 0.052, 0.014, -0.006); f.box(0.05, 0.016, 0.006, 0.052, 0.022, 0.012); }); },
  muffin: f => { plate(f, 0.08); muffinShape(f, 0, TOP, 0); },
  cinnamon_roll: f => {   // (2026-10-28: its coil of dough, the cinnamon between its turns, icing drizzled across)
    plate(f, 0.09); if (taken()) return;
    const h = 0.032, top = TOP + h, coil = (r0, r1, turns, y, rad, col) => { let p0 = null; f.col(col); for (let k = 0; k <= 72; k++) { const t = k / 72, a = t * turns * TAU, r = r0 + (r1 - r0) * t, p = [Math.cos(a) * r, y, Math.sin(a) * r]; if (p0) f.rod(p0, p, rad, 6); p0 = p; } };
    f.col('#c98a42'); f.cyl(0, 0, 0.047, TOP, top - 0.004, 24, 0.045);   // (its sides, baked)
    f.col('#a8662c'); for (let k = 0; k < 3; k++) f.cyl(0, 0, 0.0475, TOP + 0.007 + k * 0.009, TOP + 0.0085 + k * 0.009, 24);   // (its layers showing)
    coil(0.004, 0.043, 3.1, top - 0.002, 0.0062, '#d9a056');   // (the coil on top)
    coil(0.008, 0.046, 3.1, top - 0.0035, 0.0028, '#6a3214');   // (the cinnamon between its turns)
    f.col('#fbf6ea'); for (let k = 0; k < 5; k++) {   // (icing, drizzled across in waves)
      const z0 = -0.03 + k * 0.015, w = 0.042 * Math.sqrt(Math.max(0, 1 - Math.pow(z0 / 0.046, 2))); let p0 = null;
      for (let q = 0; q <= 10; q++) { const x = -w + 2 * w * q / 10, p = [x, top + 0.0035, z0 + Math.sin(q * 1.3 + k) * 0.004]; if (p0) f.rod(p0, p, 0.0016, 4); p0 = p; }
    }
  },
  donut: f => { plate(f, 0.08); donut(f, 0, TOP, 0, '#f3d3b0'); },
  bagel: f => { plate(f, 0.085); f.col('#c88a3e'); torus(f, -0.012, TOP + 0.012, 0, 0.032, 0.013, 16, 6); f.col('#fbf6ec'); f.cyl(-0.012, 0, 0.045, TOP + 0.02, TOP + 0.026, 16); scatter(f, 20, 0.04, 5, (x, z) => { f.col('#f2ead2'); f.sph(x - 0.012, TOP + 0.024, z, 0.003, 0.0015, 0.002, 4, 3); }); f.col('#c88a3e'); at(f, 0.05, TOP, 0.035, 0, () => torus(f, 0, 0.012, 0, 0.028, 0.012, 16, 6)); },
  scone: f => { plate(f, 0.09); if (!taken()) { f.col('#d9a85e'); blob(f, -0.015, TOP, 0, 0.038, 0.035, 0.036, 0.14, 4, 12, 6, 0); f.col('#a8662c'); dome(f, -0.015, TOP + 0.03, 0, 0.026, 0.01, 0.026, 0.1); } ramekin(f, 0.045, 0.03, '#a3182a', 0.022); ramekin(f, 0.045, -0.025, '#fbf3df', 0.022); },
  danish: f => { plate(f, 0.09); if (taken()) return; f.col('#d39444'); f.lathe(0, 0, [[0, TOP], [0.045, TOP], [0.05, TOP + 0.015], [0.042, TOP + 0.02], [0.03, TOP + 0.014], [0, TOP + 0.014]], 16); f.col('#f2e3b0'); f.cyl(0, 0, 0.03, TOP + 0.012, TOP + 0.017, 14); f.col(STRAW); scatter(f, 5, 0.018, 3, (x, z) => f.sph(x, TOP + 0.021, z, 0.008, 0.006, 0.008, 7, 4)); },
  banana_bread: f => { plate(f, 0.09); for (const [x, yaw] of [[-0.012, 0.15], [0.02, -0.1]]) at(f, x, TOP, 0, yaw, () => { f.col('#7a4a22'); f.box(-0.012, 0, -0.045, 0.012, 0.06, 0.045); f.col('#c99050'); f.box(-0.0122, 0.003, -0.042, 0.0122, 0.055, 0.042); scatter(f, 5, 0.03, x * 99, (a, b) => { f.col('#3a2414'); f.box(-0.0125, 0.03 + a * 0.6, b - 0.002, 0.0125, 0.034 + a * 0.6, b + 0.002); }); }); },
  cookie: f => { plate(f, 0.085); cookie(f, -0.02, TOP, 0.0, 0.034, '#c98f4c', CHOC, 1); cookie(f, 0.025, TOP + 0.008, 0.02, 0.032, '#c48548', CHOC, 2); cookie(f, 0.02, TOP, -0.035, 0.03, '#b9783d', CHOC, 3); },
  brownie: f => { plate(f, 0.09); if (taken()) return; at(f, 0, TOP, 0, 0.3, () => { f.col('#3d2214'); f.box(-0.035, 0, -0.035, 0.035, 0.03, 0.035); f.col('#2e1a10'); f.sph(0, 0.03, 0, 0.033, 0.004, 0.033, 10, 3, { cut: 0, disp: (a, b, c) => (hsh(a * 9, b, c * 9) - 0.5) * 0.3 }); }); scatter(f, 10, 0.03, 4, (x, z) => { f.col('#f4f1ea'); f.boxC(x, TOP + 0.036, z, 0.0015, 0.0006, 0.0015); }); },
  // (2026-10-28: the arcade's popcorn) a striped carton heaped with it
  popcorn: f => { f.col('#f6f4ef'); f.cyl(0, 0, 0.04, 0, 0.1, 14); for (let k = 0; k < 7; k++) at(f, Math.cos(k * TAU / 7) * 0.04, 0, Math.sin(k * TAU / 7) * 0.04, P / 2 - k * TAU / 7, () => { f.col('#c0241e'); f.box(-0.007, 0.004, -0.002, 0.007, 0.096, 0.002); });
    if (taken()) return; const r = rng(7); for (let k = 0; k < 18; k++) { const a = r() * TAU, d = Math.sqrt(r()) * 0.038; f.col(k % 5 ? '#f8f0d6' : '#f2c84a'); f.sph(Math.cos(a) * d, 0.1 + (1 - d / 0.038) * 0.02 + r() * 0.008, Math.sin(a) * d, 0.012, 0.011, 0.012, 6, 4); } },
  pretzel: f => { plate(f, 0.09); f.col('#8a4a1e'); torus(f, -0.02, TOP + 0.012, 0.01, 0.025, 0.01, 16, 6); torus(f, 0.02, TOP + 0.012, 0.01, 0.025, 0.01, 16, 6); f.rod([-0.045, TOP + 0.012, -0.02], [0.045, TOP + 0.012, -0.02], 0.01, 8); scatter(f, 24, 0.055, 8, (x, z) => { f.col('#fafafa'); f.boxC(x, TOP + 0.024, z, 0.002, 0.001, 0.002); }); ramekin(f, 0.06, 0.05, '#e1b828', 0.022); },
  // ---------------------------------------------------------------- sandwiches & deli
  club_sandwich: f => { plate(f); const L = [['#f0d9b0', 0.006], ['#e9b38c', 0.007], [LETTUCE, 0.004], [TOMATO, 0.005], ['#c2583d', 0.004]]; sandwichHalf(f, -0.035, 0.0, 0.5, 0.05, L, '#ead7a6', '#a8662c', TOP, true); sandwichHalf(f, 0.035, 0.01, -0.4, 0.05, L, '#ead7a6', '#a8662c', TOP, true); f.col('#d9c06a'); f.rod([-0.035, TOP + 0.03, 0.0], [-0.035, TOP + 0.08, 0.0], 0.0015, 3); fries(f, 0.06, 0.065, 12, 0.028); },
  blt: f => { plate(f); const L = [['#c2583d', 0.007], [LETTUCE, 0.006], [TOMATO, 0.006]]; sandwichHalf(f, -0.03, 0.01, 0.6, 0.052, L, '#e6c58e', CRUST, TOP, true); sandwichHalf(f, 0.035, -0.005, -0.5, 0.052, L, '#e6c58e', CRUST, TOP, true); f.col('#7fa83a'); for (let k = 0; k < 3; k++) f.cyl(0.07 + k * 0.012, 0.06, 0.013, TOP, TOP + 0.003, 10); },
  grilled_cheese: f => { plate(f); const L = [['#f2b53a', 0.008]]; sandwichHalf(f, -0.02, 0.02, 0.3, 0.055, L, '#d9993f', '#9a5a22'); sandwichHalf(f, 0.03, -0.02, P + 0.3, 0.055, L, '#d9993f', '#9a5a22', TOP + 0.01); f.col('#f2b53a'); f.box(-0.02, TOP + 0.005, 0.018, 0.01, TOP + 0.009, 0.026); ramekin(f, 0.075, 0.06, '#b83222'); },
  panini: f => { plate(f, 0.13); for (const [x, yaw] of [[-0.03, 0.25], [0.035, -0.2]]) at(f, x, TOP, 0, yaw, () => { if (taken()) return; f.col('#d8a85e'); f.box(-0.03, 0, -0.06, 0.03, 0.012, 0.06); f.box(-0.03, 0.02, -0.06, 0.03, 0.032, 0.06); f.col('#5b3a1a'); for (let k = -3; k <= 3; k++) f.box(-0.031, 0.032, k * 0.016 - 0.002, 0.031, 0.0325, k * 0.016 + 0.002); f.col('#fbf6ea'); f.box(-0.028, 0.012, -0.058, 0.028, 0.016, 0.058); f.col(TOMATO); f.box(-0.026, 0.016, -0.055, 0.026, 0.02, 0.055); }); leaves(f, 0.075, 0.05, 0.025, 5, ['#3f8a3a']); },
  sub: f => { platter(f, 0.15, 0.08); if (!taken()) at(f, 0, TOP, 0, 0.1, () => { f.col('#d9a25e'); f.rod([-0.11, 0.022, 0], [0.11, 0.022, 0], 0.024, 12); f.col('#c98a42'); f.rod([-0.11, 0.034, 0], [0.11, 0.034, 0], 0.022, 12); f.sph(-0.11, 0.028, 0, 0.024, 0.024, 0.024, 10, 5); f.sph(0.11, 0.028, 0, 0.024, 0.024, 0.024, 10, 5); for (let k = -4; k <= 4; k++) { f.col(['#c2453a', '#e9b38c', LETTUCE, '#f2b53a'][Math.abs(k) % 4]); f.boxC(k * 0.024, 0.026, 0.02, 0.014, 0.006, 0.006, 0.2); } }); },
  wrap: f => { plate(f); wrapRoll(f, -0.02, 0.02, 0.4, 0.12, 0.026, '#efd9a4', ['#d9a35b', LETTUCE, '#f5f0e4']); wrapRoll(f, 0.04, -0.025, P + 0.3, 0.1, 0.024, '#efd9a4', ['#d9a35b', LETTUCE, TOMATO]); },
  reuben: f => { plate(f); const L = [['#c2585a', 0.012], ['#f3e6b0', 0.005], ['#e6d7a0', 0.006]]; sandwichHalf(f, -0.03, 0, 0.5, 0.055, L, '#7a5a3a', '#4a3020', TOP, true); sandwichHalf(f, 0.035, 0, -0.5, 0.055, L, '#7a5a3a', '#4a3020', TOP, true); f.col('#7a9a3a'); rot(f, 0, 0, H, 0.075, TOP + 0.012, 0.06, () => capsule(f, [0, -0.03, 0], [0, 0.03, 0], 0.012)); },
  tuna_melt: f => { plate(f); for (const x of [-0.035, 0.035]) { if (taken()) continue; toast(f, x, TOP, 0, 0, 0.042, '#d39a52', CRUST, 0.012); f.col('#e8d6a8'); f.box(x - 0.033, TOP + 0.012, -0.032, x + 0.033, TOP + 0.02, 0.025); f.col('#f2b53a'); f.sph(x, TOP + 0.02, -0.004, 0.038, 0.004, 0.032, 12, 3, { cut: 0, disp: (a, b, c) => Math.sin(Math.atan2(c, a) * 6) * 0.15 }); } side(() => leaves(f, 0, 0.075, 0.025, 5)); },
  // ---------------------------------------------------------------- burgers & fries
  cheeseburger: f => { basket(f); burgerStack(f, { y: 0.008 }); },
  bacon_burger: f => { basket(f); burgerStack(f, { y: 0.008, bacon: true, tomato: false }); },
  double_burger: f => { basket(f); burgerStack(f, { y: 0.008, patties: 2, tomato: false, onion: true }); },
  chicken_burger: f => { basket(f, 0.22, 0.16, '#2f5d8c'); burgerStack(f, { y: 0.008, chicken: true, cheese: false, bun: '#c99a52', seeds: false }); },
  veggie_burger: f => { basket(f, 0.22, 0.16, '#3f8a3a'); burgerStack(f, { y: 0.008, veggie: true, bun: '#a8763a' }); },
  burger_fries: f => { basket(f, 0.26, 0.17); at(f, -0.05, 0, 0, 0, () => burgerStack(f, { y: 0.008, r: 0.05 })); fries(f, 0.07, 0.0, 22, 0.04, FRY, 3, 0.008); },
  hot_dog: f => { plate(f, 0.11, '#f3f1ec'); if (!taken()) at(f, 0, TOP, 0, 0.3, () => { f.col('#d9a25e'); f.rod([-0.075, 0.016, -0.012], [0.075, 0.016, -0.012], 0.016, 10); f.rod([-0.075, 0.016, 0.012], [0.075, 0.016, 0.012], 0.016, 10); f.col('#a8412a'); capsule(f, [-0.085, 0.024, 0], [0.085, 0.024, 0], 0.012); f.col('#f2c12a'); for (let k = 0; k < 8; k++) f.boxC(-0.07 + k * 0.02, 0.0365, Math.sin(k * 1.3) * 0.005, 0.009, 0.002, 0.0025, 0.6 * (k % 2 ? 1 : -1)); }); },
  nuggets: f => { basket(f, 0.2, 0.15, '#f2b53a'); nuggets(f, 9, 0.05, 0.008); ramekin(f, 0.07, 0.04, '#b0412a', 0.022); ramekin(f, 0.07, -0.03, '#e9c46a', 0.022); },
  fries: f => { basket(f, 0.16, 0.13); fries(f, 0, 0, 30, 0.045, FRY, 3, 0.008); ramekin(f, 0.06, 0.045, '#c0392b', 0.02); },
  sweet_potato_fries: f => { basket(f, 0.16, 0.13, '#3f8a3a'); fries(f, 0, 0, 26, 0.045, '#e3843a', 8, 0.008); ramekin(f, 0.06, 0.045, '#f3ead2', 0.02); },
  onion_rings: f => { basket(f, 0.16, 0.13); onionRings(f, 7, 0.035, 0.008); ramekin(f, 0.06, 0.045, '#b0412a', 0.02); },
  // ---------------------------------------------------------------- pizza
  margherita: f => { board(f, 0.3, 0.3, WOOD); pizza(f, 0.13, 0.016, '#f3d27a', pizzaT.margherita); },
  pepperoni: f => { board(f, 0.3, 0.3, WOOD); pizza(f, 0.13, 0.016, '#f2c76a', pizzaT.pepperoni); },
  hawaiian: f => { board(f, 0.3, 0.3, WOOD); pizza(f, 0.13, 0.016, '#f2c76a', pizzaT.hawaiian); },
  veggie_pizza: f => { board(f, 0.3, 0.3, WOOD); pizza(f, 0.13, 0.016, '#f2c76a', pizzaT.veggie); },
  four_cheese: f => { board(f, 0.3, 0.3, WOOD); pizza(f, 0.13, 0.016, '#f5dc8a', pizzaT.four); },
  bbq_pizza: f => { board(f, 0.3, 0.3, WOOD); pizza(f, 0.13, 0.016, '#e9c070', pizzaT.bbq); },
  pizza_slice: f => { plate(f, 0.1, '#f3f1ec'); if (!taken()) at(f, 0, TOP, 0.03, 0, () => { f.col('#e3b06a'); wedge(f, 0.1, P - 0.32, P + 0.32, 0, 0.007, 4); f.col('#f2c76a'); wedge(f, 0.09, P - 0.3, P + 0.3, 0.007, 0.01, 4); f.col('#d99a4e'); rot(f, 0, 0, H, 0, 0.008, -0.094, () => f.rod([0, -0.032, 0], [0, 0.032, 0], 0.009, 6)); scatter(f, 5, 0.025, 9, (x, z) => { f.col('#a8321f'); f.cyl(x, z - 0.05, 0.011, 0.009, 0.012, 10); }); }); },
  calzone: f => { plate(f); at(f, 0, TOP, 0, 0.4, () => { f.col('#d99a4e'); within(f, new THREE.Matrix4().makeScale(1, 1, 0.6), () => f.sph(0, 0, 0, 0.09, 0.04, 0.09, 18, 6, { cut: 0, disp: (a, b, c) => (Math.abs(c) < 0.05 ? 0 : 0) })); f.col('#c88a3e'); rot(f, 0, 0, 0, 0, 0.004, 0, () => { for (let k = 0; k < 9; k++) { const a = -1.2 + k * 0.3; f.sph(Math.sin(a) * 0.088, 0.006, Math.cos(a) * 0.052, 0.008, 0.006, 0.008, 6, 4); } }); f.col('#c9893f'); scatter(f, 4, 0.02, 3, (x, z) => f.box(x - 0.008, 0.039, z - 0.001, x + 0.008, 0.041, z + 0.001)); }); ramekin(f, 0.08, 0.07, SAUCE_RED); cutlery(f); },
  garlic_bread: f => { board(f, 0.24, 0.12); for (let k = 0; k < 4; k++) at(f, -0.075 + k * 0.05, Y_BOARD, 0, 0.25, () => { f.col('#c98a42'); f.box(-0.02, 0, -0.045, 0.02, 0.012, 0.045); f.col('#f3d27a'); f.box(-0.018, 0.012, -0.043, 0.018, 0.015, 0.043); herbs(f, 0.03, 0.016, 6, k, HERB); }); },
  // ---------------------------------------------------------------- italian
  spaghetti: f => pasta(f, '#f0d58a', '#a8321f', y => { scatter(f, 3, 0.02, 5, (x, z) => { f.col('#7a3a22'); f.sph(x, y - 0.004, z, 0.012, 0.011, 0.012, 8, 5); }); f.col('#f4f0e2'); scatter(f, 14, 0.03, 6, (x, z) => f.boxC(x, y + 0.002, z, 0.002, 0.001, 0.002)); f.col('#2f7d32'); f.sph(0.006, y + 0.006, 0, 0.012, 0.002, 0.008, 6, 3); }),
  carbonara: f => pasta(f, '#f2dc93', null, y => { f.col('#f3e2a6'); f.sph(0, y - 0.012, 0, 0.05, 0.006, 0.05, 14, 3, { cut: 0 }); f.col(YOLK); dome(f, 0, y - 0.006, 0, 0.014, 0.01, 0.014, 0.02, 3); scatter(f, 10, 0.04, 6, (x, z) => { f.col('#c2583d'); f.boxC(x, y - 0.006, z, 0.005, 0.003, 0.004, x * 50); }); scatter(f, 30, 0.05, 7, (x, z) => { f.col('#1f1f1f'); f.boxC(x, y - 0.004, z, 0.0012, 0.0008, 0.0012); }); }),
  pasta_pomodoro: f => { plate(f, 0.125); scatter(f, 34, 0.055, 3, (x, z, k, r) => { f.col(k % 4 ? '#e8b85a' : '#d9a64a'); rot(f, H, r() * P, 0, x, TOP + 0.008 + r() * 0.02, z, () => f.cyl(0, 0, 0.005, -0.014, 0.014, 6)); }); sauce(f, 0, TOP + 0.02, 0, 0.04, '#b83222', 0.01); f.col('#2f7d32'); f.sph(0, TOP + 0.034, 0, 0.012, 0.002, 0.008, 6, 3); fork(f, 0.06, TOP + 0.02, 0.06, 2.2); },
  lasagna: f => { plate(f); at(f, 0, TOP, 0, 0.3, () => { const L = [['#e9c46a', 0.006], ['#a8321f', 0.008], ['#f6efd6', 0.004], ['#e9c46a', 0.006], ['#a8321f', 0.008], ['#f6efd6', 0.004], ['#e9c46a', 0.006]]; let y = 0; for (const [c, h] of L) { f.col(c); f.box(-0.045, y, -0.035, 0.045, y + h, 0.035); y += h; } f.col('#e3a640'); f.sph(0, y, 0, 0.045, 0.006, 0.035, 12, 3, { cut: 0, disp: (a, b, c) => (hsh(a * 9, 1, c * 9) - 0.5) * 0.3 }); f.col('#b4561e'); scatter(f, 6, 0.03, 3, (x, z) => f.sph(x, y + 0.004, z, 0.008, 0.002, 0.008, 6, 3)); herbs(f, 0.02, y + 0.007, 4, 2); }); cutlery(f); },
  alfredo: f => pasta(f, '#f2dc93', '#f4ead0', y => { scatter(f, 6, 0.03, 4, (x, z) => { f.col('#e2c08a'); f.boxC(x, y - 0.004, z, 0.008, 0.004, 0.006, x * 40); }); herbs(f, 0.035, y, 10, 3, '#3f7f2a'); }),
  risotto: f => { const y = bowl(f, 0.09, 0.04, WHITE)(0.6); f.col('#efe3be'); dome(f, 0, y - 0.01, 0, 0.065, 0.016, 0.065, 0.08, 4); scatter(f, 9, 0.045, 5, (x, z, k, r) => { f.col('#8a6a4a'); rot(f, 0.2, r() * 3, 0, x, y + 0.006, z, () => f.sph(0, 0, 0, 0.012, 0.004, 0.009, 8, 3)); }); scatter(f, 20, 0.05, 6, (x, z) => { f.col('#f4f0e2'); f.boxC(x, y + 0.006, z, 0.0018, 0.001, 0.0018); }); herbs(f, 0.03, y + 0.008, 6, 2); fork(f, 0.07, 0.04, 0.05, 2.4); },
  gnocchi: f => { plate(f, 0.125); scatter(f, 18, 0.05, 6, (x, z, k, r) => { f.col('#f0dca0'); rot(f, 0, r() * 3, 0, x, TOP + 0.008, z, () => f.sph(0, 0, 0, 0.012, 0.008, 0.009, 8, 4)); }); f.col('#4f8a2a'); f.sph(0, TOP + 0.012, 0, 0.055, 0.004, 0.055, 14, 3, { cut: 0, disp: (a, b, c) => (hsh(a * 7, 0, c * 7) - 0.5) * 0.5 }); scatter(f, 6, 0.04, 5, (x, z) => { f.col('#f2e3b0'); f.boxC(x, TOP + 0.02, z, 0.004, 0.002, 0.003, x * 30); }); cutlery(f); },
  ravioli: f => { plate(f, 0.125); scatter(f, 7, 0.045, 7, (x, z, k, r) => at(f, x, TOP, z, r() * 2, () => { f.col('#f0d58a'); f.box(-0.018, 0, -0.018, 0.018, 0.005, 0.018); f.col('#f2dc9a'); dome(f, 0, 0.005, 0, 0.013, 0.008, 0.013, 0.05, k); })); sauce(f, 0.02, TOP + 0.01, 0.02, 0.03, '#b83222', 0.006); herbs(f, 0.05, TOP + 0.016, 8, 9); cutlery(f); },
  bruschetta: f => { slate(f, 0.26, 0.12); for (let k = 0; k < 3; k++) at(f, -0.08 + k * 0.08, 0.009, 0, 0.1 * (k - 1), () => { f.col('#c98a42'); f.box(-0.028, 0, -0.04, 0.028, 0.012, 0.04); scatter(f, 10, 0.025, k + 3, (x, z, j) => { f.col(j % 4 ? TOMATO : '#2f7d32'); f.boxC(x, 0.016, z, 0.006, 0.004, 0.006, x * 40); }); }); },
  caprese: f => { plate(f, 0.12); for (let k = 0; k < 7; k++) { const a = k / 7 * TAU, x = Math.sin(a) * 0.065, z = Math.cos(a) * 0.065; at(f, x, TOP + (k % 2) * 0.003, z, a, () => { if (k % 2) { f.col('#f7f4ea'); f.cyl(0, 0, 0.026, 0, 0.008, 12); } else { f.col(TOMATO); f.cyl(0, 0, 0.026, 0, 0.008, 12); } f.col('#2f7d32'); f.sph(0.006, 0.01, 0.0, 0.013, 0.002, 0.008, 6, 3); }); } f.col('#4a1f1a'); for (let k = 0; k < 3; k++) f.rod([-0.03, TOP + 0.013, -0.02 + k * 0.02], [0.03, TOP + 0.013, -0.01 + k * 0.02], 0.0015, 3); },
  minestrone: f => soupBowl(f, '#c46a3a', y => { chunks(f, 12, 0.05, y, 0.009, ['#e38a3a', '#4f8a2a', '#f2dc93', '#b0412a', '#8a5a3a'], 5); herbs(f, 0.04, y + 0.006, 6, 4); spoon(f, 0.06, y, 0.04, 0.6); }),
  tiramisu: f => { plate(f, 0.095); at(f, 0, TOP, 0, 0.3, () => { const L = [['#c7924e', 0.01], ['#f4ead2', 0.012], ['#b88246', 0.01], ['#f4ead2', 0.012]]; let y = 0; for (const [c, h] of L) { f.col(c); f.box(-0.035, y, -0.035, 0.035, y + h, 0.035); y += h; } f.col('#5a3420'); f.box(-0.0352, y, -0.0352, 0.0352, y + 0.003, 0.0352); }); fork(f, 0.06, TOP, 0.04, -0.4); },
  gelato: f => { gl(f, {}); f.col('#c9ced4'); f.lathe(0, 0, [[0, 0], [0.03, 0], [0.03, 0.004], [0.006, 0.009], [0.006, 0.03], [0.05, 0.055], [0.048, 0.057], [0, 0.034]], 16); scoop(f, -0.014, 0.068, 0.0, 0.024, '#a8d08a', 1); scoop(f, 0.016, 0.068, 0.008, 0.024, '#f2c6d2', 2); scoop(f, 0.0, 0.07, -0.016, 0.022, '#f6e7c8', 3); f.col('#d9a25e'); rot(f, 0.4, 0, 0.3, 0.02, 0.09, 0.0, () => f.box(-0.006, -0.03, -0.002, 0.006, 0.03, 0.002)); },
  // ---------------------------------------------------------------- mexican
  tacos: f => { platter(f, 0.15, 0.1); tacoShell(f, -0.06, 0, H, 0.045); tacoShell(f, 0.0, 0, H, 0.045, '#e9c77a', ['#b0412a', LETTUCE, '#f3f0e4', TOMATO]); tacoShell(f, 0.06, 0, H, 0.045, '#e9c77a', ['#7a4b2a', '#8a2a5a', GUAC]); lemon(f, 0.1, TOP + 0.012, 0.016, '#8bc34a'); },
  burrito: f => { plate(f); wrapRoll(f, -0.01, 0, 0.25, 0.15, 0.033, '#ecd3a0', ['#c46a3a', '#f5f0e4', BEANS, GUAC]); rice(f, 0.07, 0.06, 0.03, 0.018, '#f2b25a'); ramekin(f, -0.07, 0.07, TOMATO); cutlery(f); },
  quesadilla: f => { plate(f); for (let k = 0; k < 4; k++) at(f, Math.sin(k * 1.4) * 0.012, TOP + k * 0.0002, Math.cos(k * 1.4) * 0.012, k * TAU / 4 + 0.2, () => { if (taken()) return; f.col('#e6c27f'); wedge(f, 0.075, -0.33, 0.33, 0, 0.01, 5); f.col('#f2b53a'); f.box(-0.02, 0.003, 0.066, 0.02, 0.008, 0.074); f.col('#c88a3e'); for (let j = 0; j < 3; j++) f.box(-0.012, 0.0101, 0.02 + j * 0.016, 0.012, 0.0104, 0.024 + j * 0.016); }); ramekin(f, 0.075, 0.075, GUAC, 0.022); ramekin(f, -0.075, 0.075, '#f7f2e8', 0.022); },
  nachos: f => { plate(f, 0.13, '#e8b04a'); const r = rng(5); for (let k = 0; k < 26; k++) { const a = r() * TAU, d = Math.sqrt(r()) * 0.08; f.col(k % 3 ? '#e9c25a' : '#d6a840'); rot(f, (r() - 0.5) * 0.9, r() * TAU, (r() - 0.5) * 0.9, Math.sin(a) * d, TOP + 0.01 + (1 - d / 0.08) * 0.025 + r() * 0.01, Math.cos(a) * d, () => prism(f, [[-0.022, 0.012], [0.022, 0.012], [0, -0.026]], -0.0015, 0.0015)); } scatter(f, 9, 0.06, 11, (x, z) => { f.col('#f2b53a'); f.sph(x, TOP + 0.03 - Math.hypot(x, z) * 0.2, z, 0.018, 0.005, 0.014, 8, 3); }); scatter(f, 10, 0.05, 4, (x, z, k) => { f.col(k % 2 ? '#2f8a3a' : TOMATO); f.boxC(x, TOP + 0.04, z, 0.005, 0.003, 0.005); }); f.col(GUAC); dome(f, 0.0, TOP + 0.036, 0.0, 0.022, 0.014, 0.022, 0.15, 3); f.col('#f7f2e8'); dome(f, 0.02, TOP + 0.04, 0.02, 0.014, 0.01, 0.014, 0.1, 4); },
  enchiladas: f => { platter(f, 0.15, 0.1, '#e9e2d0'); for (let k = 0; k < 3; k++) wrapRoll(f, 0, (k - 1) * 0.045, 0, 0.17, 0.02, '#e6c27f', [], false); f.col('#a8321f'); f.sph(0, TOP + 0.035, 0, 0.09, 0.008, 0.07, 16, 3, { cut: 0, disp: (a, b, c) => Math.sin(Math.atan2(c, a) * 6) * 0.1 }); f.col('#f7f2e8'); for (let k = 0; k < 3; k++) f.rod([-0.06, TOP + 0.043, -0.05 + k * 0.05], [0.06, TOP + 0.043, -0.04 + k * 0.05], 0.003, 4); herbs(f, 0.06, TOP + 0.045, 12, 5, '#2f8a3a'); },
  fajitas: f => { skillet(f, 0.1); chunks(f, 14, 0.07, 0.03, 0.012, ['#c46a3a', '#d84a2b', '#3f8a3a', '#f2d27a', '#9a5a3a'], 7); at(f, 0.15, 0, 0.08, 0, () => { f.col('#e9e2cf'); f.cyl(0, 0, 0.045, 0, 0.03, 14); f.col('#ecd3a0'); for (let k = 0; k < 3; k++) f.cyl(0, 0, 0.042, 0.03 + k * 0.003, 0.0325 + k * 0.003, 14); }); },
  chips_guac: f => { plate(f, 0.15, '#e8b04a'); at(f, 0.0, TOP, 0, 0, () => { f.col('#5a4a3a'); f.lathe(0, 0, [[0, 0], [0.05, 0], [0.065, 0.045], [0.06, 0.045], [0, 0.012]], 16); f.col(GUAC); dome(f, 0, 0.03, 0, 0.055, 0.012, 0.055, 0.1, 3); scatter(f, 6, 0.03, 2, (x, z) => { f.col(TOMATO); f.boxC(x, 0.042, z, 0.004, 0.003, 0.004); }); }); const r = rng(9); for (let k = 0; k < 16; k++) { const a = r() * TAU, d = 0.085 + r() * 0.035; f.col('#e9c25a'); rot(f, (r() - 0.5) * 0.5, a, (r() - 0.5) * 0.5, Math.sin(a) * d, TOP + 0.006 + r() * 0.008, Math.cos(a) * d, () => prism(f, [[-0.02, 0.012], [0.02, 0.012], [0, -0.024]], -0.0015, 0.0015)); } },
  burrito_bowl: f => { const y = bowl(f, 0.09, 0.05, '#e8e2d6')(0.5); const parts = [['#f5f2e9', 0], ['#6a3a24', 1], ['#d9a35b', 2], [LETTUCE, 3], ['#f2c14e', 4], [TOMATO, 5]]; for (const [c, k] of parts) at(f, 0, 0, 0, k * TAU / 6, () => { f.col(c); for (let j = 0; j < 4; j++) f.sph(0.012 + j * 0.008, y + 0.006, 0.03 + (j % 2) * 0.008, 0.012, 0.008, 0.011, 7, 4); }); f.col(GUAC); dome(f, 0, y + 0.008, 0, 0.018, 0.012, 0.018, 0.15, 3); lemon(f, 0.06, y + 0.012, 0.016, '#8bc34a'); },
  churros: f => { plate(f, 0.1); for (let k = 0; k < 4; k++) at(f, 0, TOP + 0.01 + (k % 2) * 0.012, -0.03 + k * 0.02, 0.3 - k * 0.2, () => { if (taken()) return; f.col('#c88a3e'); f.rod([-0.06, 0, 0], [0.06, 0, 0], 0.01, 6); f.col('#e9cfa0'); f.rod([-0.06, 0.006, 0], [0.06, 0.006, 0], 0.0045, 5); }); ramekin(f, 0.06, 0.06, '#4a2a1a', 0.024); },
  // ---------------------------------------------------------------- chinese, thai & vietnamese
  fried_rice: f => { const y = bowl(f, 0.085, 0.045, '#f3f1ec', '#2f5d8c')(0.6); f.col('#f2d27a'); dome(f, 0, y - 0.01, 0, 0.065, 0.028, 0.065, 0.06, 4); chunks(f, 16, 0.05, y + 0.006, 0.006, ['#f6b21b', '#4f8a2a', '#e38a3a', '#c2583d'], 6); cutlery(f, 0.09, true); },
  chow_mein: f => { plate(f, 0.125, '#f3f1ec', '#2f5d8c'); noodles(f, 0, 0, 0.065, 0.03, '#d9a85a', 8, TOP, 11); chunks(f, 12, 0.05, TOP + 0.034, 0.008, ['#4f8a2a', '#c46a3a', '#f2f0e6', '#e38a3a'], 7); cutlery(f, 0.13, true); },
  kung_pao: f => { plate(f, 0.13); rice(f, -0.05, 0.02, 0.045, 0.03); at(f, 0.035, TOP, -0.01, 0, () => { f.col('#8a2a14'); f.sph(0, 0, 0, 0.055, 0.008, 0.05, 14, 3, { cut: 0 }); chunks(f, 12, 0.04, 0.012, 0.01, ['#c46a3a', '#d84a2b', '#e9c46a', '#3f8a3a'], 8); }); cutlery(f, 0.13, true); },
  sweet_sour: f => { plate(f, 0.13); rice(f, -0.05, 0.02, 0.045, 0.03); at(f, 0.035, TOP, -0.01, 0, () => { chunks(f, 10, 0.04, 0.012, 0.013, ['#d9783a', '#e8853f'], 9); f.col('#e2491f'); f.sph(0, 0.01, 0, 0.05, 0.006, 0.045, 14, 3, { cut: 0, disp: (a, b, c) => Math.sin(Math.atan2(c, a) * 5) * 0.15 }); chunks(f, 6, 0.04, 0.02, 0.008, ['#f6d64b', '#3f8a3a', '#d84a2b'], 10); }); cutlery(f, 0.13, true); },
  dumplings: f => { steamer(f, 0.1); for (let k = 0; k < 6; k++) { const a = k * TAU / 6; dumpling(f, Math.sin(a) * 0.05, 0.008, Math.cos(a) * 0.05, 1, '#f3ecdc', a); } dumpling(f, 0, 0.008, 0, 1, '#f3ecdc', 0); ramekin(f, 0.11, 0.08, '#3a1e12', 0.022); },
  spring_rolls: f => { platter(f, 0.13, 0.09); for (let k = 0; k < 4; k++) { f.col('#d9a04a'); capsule(f, [-0.05, TOP + 0.014, -0.045 + k * 0.03], [0.05, TOP + 0.014, -0.04 + k * 0.03], 0.013); } ramekin(f, 0.085, 0.06, '#e8572a', 0.022); side(() => leaves(f, -0.085, 0.05, 0.02, 4)); },
  pad_thai: f => { plate(f, 0.13); noodles(f, 0, 0, 0.07, 0.025, '#e9b35a', 9, TOP, 11); shrimp(f, -0.02, TOP + 0.03, 0.0, 0.3); shrimp(f, 0.025, TOP + 0.03, 0.01, 2.3); scatter(f, 14, 0.05, 3, (x, z) => { f.col('#c9a46a'); f.boxC(x, TOP + 0.034, z, 0.003, 0.002, 0.003); }); f.col('#e9edd5'); for (let k = 0; k < 6; k++) f.rod([0.04, TOP + 0.03, -0.02 + k * 0.006], [0.07, TOP + 0.03, -0.015 + k * 0.006], 0.002, 3); lemon(f, -0.07, TOP + 0.012, 0.016, '#8bc34a'); cutlery(f, 0.13, true); },
  green_curry: f => curry(f, '#a9c46a', ['#f1e6c8', '#4f8a2a', '#d9a35b'], true, '#f3f1ec', '#3f8a3a'),
  pho: f => { const y = soupBowl(f, '#b37b45', null, 0.1, 0.07, '#f3f1ec', 0.75); noodles(f, 0, 0, 0.05, 0.01, '#f6f1e2', 4, y - 0.012, 5); f.col('#8a4a3a'); for (let k = 0; k < 4; k++) rot(f, 0.1, k * 0.8, 0, 0.01, y + 0.002, 0.0, () => f.sph(0.025, 0, 0, 0.026, 0.002, 0.014, 10, 3)); herbs(f, 0.06, y + 0.004, 14, 5, '#3f8a3a'); f.col('#eef3e0'); scatter(f, 6, 0.04, 6, (x, z) => f.rod([x, y + 0.004, z], [x + 0.025, y + 0.004, z + 0.006], 0.002, 3)); lemon(f, 0.07, y + 0.012, 0.016, '#8bc34a'); cutlery(f, 0.1, true); },
  bao: f => { steamer(f, 0.1); for (let k = 0; k < 3; k++) at(f, -0.04 + k * 0.04, 0.008, 0, 0.2, () => { if (taken()) return; f.col('#f6f1e4'); rot(f, 0, 0, 0, 0, 0.0, 0, () => { f.sph(0, 0.01, 0, 0.025, 0.012, 0.035, 10, 5, { cut: 0 }); f.sph(0, 0.022, 0, 0.025, 0.012, 0.035, 10, 5, { cut: 0 }); }); f.col('#b8582a'); f.box(-0.02, 0.012, -0.03, 0.02, 0.02, 0.03); f.col('#4f8a2a'); f.box(-0.018, 0.02, -0.022, 0.018, 0.022, 0.02); }); },
  peking_duck: f => { platter(f, 0.15, 0.1); for (let k = 0; k < 7; k++) at(f, -0.06 + k * 0.018, TOP + 0.004, -0.01, 0.4, () => { f.col('#a8521e'); f.box(-0.008, 0, -0.035, 0.008, 0.008, 0.035); f.col('#f2e3d0'); f.box(-0.0078, 0, -0.034, 0.0078, 0.004, 0.034); }); at(f, 0.08, TOP, 0.03, 0, () => { f.col('#f6f1e4'); for (let k = 0; k < 4; k++) f.cyl(0, 0, 0.032, k * 0.003, k * 0.003 + 0.0025, 14); }); f.col('#f2f0e6'); for (let k = 0; k < 4; k++) f.rod([0.04 + k * 0.006, TOP + 0.005, -0.06], [0.06 + k * 0.006, TOP + 0.005, -0.03], 0.002, 3); ramekin(f, -0.09, 0.06, '#3a1e12', 0.02); },
  // ---------------------------------------------------------------- japanese & sushi
  sushi_platter: f => { sushiBoard(f); for (let k = 0; k < 4; k++) nigiri(f, -0.09 + k * 0.032, -0.03, H, k % 2 ? '#f2875a' : '#c8202a', k % 2 ? '#fbd1bd' : '#e86a6a', Y_BOARD); for (let k = 0; k < 4; k++) maki(f, -0.08 + k * 0.034, 0.03, ['#f2875a', '#7fa83a', '#f6d64b', '#c8202a'][k], Y_BOARD); wasabi(f, 0.08, -0.03, Y_BOARD); cutlery(f, 0.15, true); },
  nigiri: f => { sushiBoard(f); for (let k = 0; k < 4; k++) nigiri(f, -0.075 + k * 0.04, 0.0, H, '#f2875a', '#fbd1bd', Y_BOARD); wasabi(f, 0.1, 0.035, Y_BOARD); cutlery(f, 0.15, true); },
  maki: f => { sushiBoard(f); for (let k = 0; k < 6; k++) maki(f, -0.08 + (k % 3) * 0.036, -0.02 + Math.floor(k / 3) * 0.04, k % 2 ? '#f2875a' : '#7fa83a', Y_BOARD); wasabi(f, 0.08, 0.0, Y_BOARD); cutlery(f, 0.15, true); },
  sashimi: f => { slate(f, 0.26, 0.15); f.col('#f2f2f2'); for (let k = 0; k < 6; k++) f.rod([-0.1 + k * 0.006, 0.012, -0.05], [-0.06 + k * 0.006, 0.012, 0.05], 0.004, 3); for (let k = 0; k < 7; k++) at(f, -0.03 + k * 0.016, 0.009, (k % 2) * 0.02, 0.5, () => { f.col(k < 4 ? '#f2875a' : '#c8202a'); f.box(-0.007, 0, -0.03, 0.007, 0.012, 0.03); f.col(k < 4 ? '#fbd1bd' : '#e86a6a'); f.box(-0.0072, 0.012, -0.03, 0.0072, 0.0125, 0.03); }); f.col('#4f8a2a'); f.sph(0.1, 0.012, 0.04, 0.016, 0.003, 0.012, 8, 3); wasabi(f, 0.1, -0.03, 0.009); cutlery(f, 0.14, true); },
  ramen: f => { const y = soupBowl(f, '#d9b98a', null, 0.1, 0.07, '#2a2a2e', 0.75); noodles(f, -0.015, 0.01, 0.045, 0.01, '#f2dc93', 3, y - 0.012, 5); at(f, 0.035, y, -0.025, 0.5, () => { f.col('#f6f1e4'); f.sph(0, 0, 0, 0.02, 0.012, 0.016, 10, 5); f.col('#f2a01e'); f.cyl(0.0, 0.0, 0.009, 0.006, 0.0125, 10); }); for (let k = 0; k < 2; k++) at(f, -0.03, y + 0.002, -0.035 + k * 0.024, 0.2, () => { f.col('#b8784a'); f.cyl(0, 0, 0.022, 0, 0.004, 14); f.col('#f2e3d0'); f.cyl(0, 0, 0.012, 0.004, 0.0045, 12); }); f.col('#1b2a1f'); rot(f, -0.3, 0, 0, 0.0, y + 0.03, -0.075, () => f.box(-0.03, -0.035, -0.001, 0.03, 0.035, 0.001)); herbs(f, 0.05, y + 0.003, 14, 7, '#5fa83a'); spoon(f, 0.07, y, 0.05, 2.5); cutlery(f, 0.1, true); },
  tempura: f => { at(f, 0, 0, 0, 0, () => { f.col('#2a2a2e'); f.box(-0.12, 0, -0.08, 0.12, 0.012, 0.08); f.col('#f4f0e4'); f.box(-0.1, 0.012, -0.065, 0.1, 0.013, 0.065); }); for (let k = 0; k < 3; k++) at(f, -0.04 + k * 0.03, 0.02, 0.0, 0.3, () => { f.col('#e9c46a'); blob(f, 0, 0, 0, 0.018, 0.014, 0.05, 0.3, k, 10, 5); f.col('#d84a2b'); f.sph(0, 0.0, 0.055, 0.008, 0.006, 0.012, 6, 4); }); for (let k = 0; k < 2; k++) { f.col('#e9c46a'); blob(f, 0.06, 0.022, -0.03 + k * 0.05, 0.022, 0.012, 0.022, 0.3, k + 5, 10, 5); } ramekin(f, 0.09, 0.05, '#4a2a14', 0.022); cutlery(f, 0.12, true); },
  teriyaki: f => { plate(f, 0.13); rice(f, -0.05, 0.02, 0.045, 0.03); for (let k = 0; k < 5; k++) at(f, 0.035, TOP, -0.04 + k * 0.02, 0.2, () => { f.col('#8a4a1a'); blob(f, 0, 0, 0, 0.03, 0.014, 0.009, 0.1, k, 9, 5, 0); f.col('#3a1e0e'); f.box(-0.03, 0.014, -0.002, 0.03, 0.0145, 0.002); }); scatter(f, 10, 0.04, 2, (x, z) => { f.col('#f4ead2'); f.boxC(0.035 + x, TOP + 0.017, z, 0.002, 0.001, 0.0012); }); leaves(f, -0.06, -0.06, 0.025, 5, ['#4f8a2a', '#7fa83a']); cutlery(f, 0.13, true); },
  katsu_curry: f => { plate(f, 0.13); rice(f, -0.04, 0.0, 0.055, 0.03); f.col('#a8641e'); f.sph(0.03, TOP, 0.01, 0.07, 0.008, 0.07, 16, 3, { cut: 0, disp: (a, b, c) => Math.sin(Math.atan2(c, a) * 5) * 0.12 }); for (let k = 0; k < 5; k++) at(f, 0.035, TOP + 0.006, -0.04 + k * 0.022, 0, () => { f.col('#d39a4a'); f.box(-0.04, 0, -0.009, 0.04, 0.014, 0.009); f.col('#f2e3d0'); f.box(-0.038, 0.002, 0.009, 0.038, 0.012, 0.0095); }); f.col('#c62828'); scatter(f, 6, 0.012, 3, (x, z) => f.sph(-0.07 + x, TOP + 0.01, 0.06 + z, 0.006, 0.004, 0.006, 6, 3)); spoon(f, 0.0, 0.0, 0.14, 0); },
  miso_soup: f => { f.col('#5a1a14'); f.lathe(0, 0, [[0, 0], [0.03, 0], [0.05, 0.06], [0.047, 0.06], [0, 0.012]], 16); f.col('#c98a4a'); f.cyl(0, 0, 0.044, 0.048, 0.05, 16); scatter(f, 6, 0.03, 4, (x, z) => { f.col('#f6f1e4'); f.boxC(x, 0.052, z, 0.005, 0.004, 0.005); }); herbs(f, 0.03, 0.052, 8, 3, '#4f8a2a'); f.col('#1b3a24'); f.sph(0.01, 0.051, 0.01, 0.012, 0.002, 0.008, 6, 3); },
  edamame: f => { const y = bowl(f, 0.075, 0.04, '#2a2a2e')(0.7); const r = rng(4); for (let k = 0; k < 14; k++) { const a = r() * TAU, d = Math.sqrt(r()) * 0.045; f.col(k % 3 ? '#7fae3c' : '#6a9a32'); rot(f, (r() - 0.5) * 0.6, a, (r() - 0.5) * 0.6, Math.sin(a) * d, y + r() * 0.01, Math.cos(a) * d, () => { for (let j = -1; j <= 1; j++) f.sph(j * 0.011, 0, 0, 0.009, 0.007, 0.008, 6, 4); }); } scatter(f, 18, 0.05, 5, (x, z) => { f.col('#fafafa'); f.boxC(x, y + 0.012, z, 0.0015, 0.0008, 0.0015); }); },
  gyoza: f => { plate(f, 0.12, '#2a2a2e'); for (let k = 0; k < 5; k++) at(f, -0.06 + k * 0.03, TOP, 0.0, H, () => { f.col('#f1e6c8'); f.sph(0, 0.008, 0, 0.032, 0.014, 0.015, 10, 5, { cut: 0, disp: (a, b, c) => (b > 0.4 ? Math.sin(a * 20) * 0.1 : 0) }); f.col('#b8783a'); f.box(-0.03, 0, -0.012, 0.03, 0.0015, 0.012); }); ramekin(f, 0.08, 0.06, '#3a1e12', 0.022); },
  mochi: f => { plate(f, 0.09, '#2a2a2e'); for (const [x, z, c] of [[-0.022, 0.012, '#f6c6d2'], [0.022, 0.012, '#c6e0a8'], [0, -0.025, '#f6f1e4']]) { f.col(c); f.sph(x, TOP, z, 0.022, 0.018, 0.022, 12, 6, { cut: 0 }); } f.col('#f6f1e4'); scatter(f, 10, 0.05, 3, (x, z) => f.boxC(x, TOP + 0.001, z, 0.002, 0.0008, 0.002)); },
  // ---------------------------------------------------------------- indian
  butter_chicken: f => curry(f, '#e07a2c', ['#f2b06a', '#e98a3a'], true, '#c9ced4', '#3f8a3a'),
  tikka_masala: f => curry(f, '#c84a1e', ['#e07a3a', '#c86a2a'], true, '#c9ced4', '#3f8a3a'),
  biryani: f => { const y = bowl(f, 0.09, 0.05, '#c9ced4')(0.55); f.col('#f2c66a'); dome(f, 0, y - 0.01, 0, 0.07, 0.035, 0.07, 0.06, 4); scatter(f, 30, 0.05, 6, (x, z, k) => { f.col(k % 3 ? '#fbf6ea' : '#e98a2a'); f.boxC(x, y + 0.02 - Math.hypot(x, z) * 0.3, z, 0.0035, 0.0015, 0.0015, x * 80); }); chunks(f, 4, 0.03, y + 0.018, 0.012, ['#8a4a2a'], 3); f.col('#d9a04a'); f.sph(-0.02, y + 0.024, 0.01, 0.014, 0.012, 0.014, 8, 5); herbs(f, 0.04, y + 0.028, 10, 4, '#3f8a3a'); ramekin(f, 0.1, 0.06, '#f4f1e6', 0.022); },
  dal: f => { const y = soupBowl(f, '#e6b23a', null, 0.08, 0.05, '#c9ced4', 0.8); f.col('#c8521e'); for (let k = 0; k < 6; k++) f.sph(Math.sin(k) * 0.02, y + 0.001, Math.cos(k * 1.7) * 0.02, 0.008, 0.001, 0.006, 6, 3); herbs(f, 0.04, y + 0.003, 10, 4, '#3f8a3a'); at(f, 0.08, 0, 0.06, 0.6, () => { f.col('#e6c27f'); f.sph(0, 0.004, 0, 0.05, 0.004, 0.03, 12, 3); }); },
  palak_paneer: f => curry(f, '#3f6e24', ['#f6f1e2', '#f6f1e2', '#eee6cc'], true, '#c9ced4', '#f2e3b0'),
  samosas: f => { plate(f, 0.12); for (let k = 0; k < 3; k++) at(f, Math.sin(k * 2.1) * 0.035, TOP, Math.cos(k * 2.1) * 0.035, k * 2.1, () => { if (taken()) return; f.col('#d39a4a'); within(f, new THREE.Matrix4().makeScale(1, 1, 1), () => { const t = [[-0.032, 0.02], [0.032, 0.02], [0, -0.035]]; prism(f, t, 0, 0.022); f.col('#c88a3e'); f.sph(0, 0.022, -0.002, 0.024, 0.008, 0.02, 8, 3); }); }); ramekin(f, 0.08, 0.06, '#5a8a2a', 0.022); ramekin(f, -0.08, 0.06, '#8a2a1a', 0.022); },
  naan: f => { at(f, 0, 0, 0, 0, () => { f.col('#c9ced4'); f.box(-0.11, 0, -0.07, 0.11, 0.008, 0.07); }); if (!taken()) at(f, 0, 0.008, 0, 0.3, () => { f.col('#e6c27f'); f.sph(0, 0.0, 0, 0.1, 0.008, 0.06, 16, 3, { cut: 0, disp: (a, b, c) => (hsh(a * 6, 0, c * 6) - 0.5) * 0.15 }); f.col('#8a4a1a'); scatter(f, 14, 0.06, 5, (x, z) => f.sph(x * 1.4, 0.008, z * 0.8, 0.01, 0.002, 0.008, 6, 3)); herbs(f, 0.06, 0.009, 10, 6, '#3f8a3a'); }); },
  tandoori: f => { platter(f, 0.15, 0.1, '#c9ced4'); drumstick(f, -0.04, 0.0, 0.3, 1.1, '#c8401e'); drumstick(f, 0.03, 0.02, 2.8, 1.1, '#c8401e'); drumstick(f, 0.0, -0.035, 1.6, 1.0, '#b8381a'); f.col('#d9e6b0'); for (let k = 0; k < 4; k++) torus(f, 0.09, TOP + 0.002 + k * 0.002, 0.04 + k * 0.006, 0.014, 0.0025, 10, 3); lemon(f, -0.1, TOP + 0.012, 0.016, '#8bc34a'); },
  // ---------------------------------------------------------------- mediterranean
  hummus: f => { plate(f, 0.15, '#e8e2d6'); const y = TOP + bowl(f, 0.08, 0.03, '#e8e2d6')(0.8); f.col('#e6d3a0'); f.sph(0, y - 0.004, 0, 0.065, 0.012, 0.065, 18, 4, { cut: 0, disp: (a, b, c) => Math.sin(Math.hypot(a, c) * 18) * 0.06 }); f.col('#c9a01e'); torus(f, 0, y + 0.007, 0, 0.03, 0.003, 16, 3); scatter(f, 5, 0.012, 3, (x, z) => { f.col('#d9a85a'); f.sph(x, y + 0.008, z, 0.006, 0.005, 0.006, 6, 4); }); f.col('#c8401e'); scatter(f, 10, 0.04, 4, (x, z) => f.boxC(x, y + 0.009, z, 0.002, 0.0006, 0.002)); for (let k = 0; k < 4; k++) pita(f, Math.sin(k * 0.6 + 2) * 0.11, Math.cos(k * 0.6 + 2) * 0.11, k * 0.6 + 2 + P, 0.045, '#e6c27f', TOP); },
  falafel: f => { plate(f, 0.13); scatter(f, 5, 0.035, 3, (x, z) => { f.col('#8a5a2a'); blob(f, x - 0.02, TOP + 0.014, z, 0.015, 0.014, 0.015, 0.18, x * 99, 8, 5); }); side(() => { at(f, 0.06, TOP, 0.0, 0, () => { f.col('#e6d3a0'); dome(f, 0, 0, 0, 0.035, 0.012, 0.035, 0.1, 3); }); leaves(f, 0.0, 0.07, 0.03, 6); scatter(f, 8, 0.03, 5, (x, z, k) => { f.col(k % 2 ? TOMATO : '#7fae3c'); f.boxC(x + 0.04, TOP + 0.006, z - 0.06, 0.006, 0.005, 0.006); }); pita(f, -0.08, -0.06, 0.4, 0.05); }); cutlery(f, 0.13); },
  shawarma: f => { plate(f); wrapRoll(f, -0.01, 0.0, 0.5, 0.13, 0.026, '#e9d6a6', ['#c46a3a', '#f6f1e4', TOMATO], true); f.col('#f6f1e4'); f.box(-0.06, TOP, -0.02, 0.06, TOP + 0.002, 0.02); fries(f, 0.06, 0.06, 10, 0.025, FRY, 6); ramekin(f, -0.075, 0.07, '#f6f1e4', 0.022); },
  kebab: f => { platter(f, 0.16, 0.1); for (let k = 0; k < 2; k++) at(f, 0, TOP + 0.016, -0.02 + k * 0.04, 0, () => { f.col(STEEL); f.rod([-0.13, 0, 0], [0.12, 0, 0], 0.002, 4); for (let j = 0; j < 6; j++) { f.col(['#7a3a1e', '#d84a2b', '#7a3a1e', '#3f8a3a', '#7a3a1e', '#f2e3b0'][j]); blob(f, -0.08 + j * 0.03, 0, 0, 0.014, 0.014, 0.014, 0.15, j + k * 7, 8, 5); } }); side(() => rice(f, 0.08, 0.06, 0.035, 0.02, '#f2d27a')); },
  gyro: f => { plate(f); if (!taken()) at(f, 0, TOP, 0, 0.3, () => { f.col('#e9d6a6'); rot(f, 0, 0, H, 0, 0.045, 0, () => f.lathe(0, 0, [[0.045, -0.04], [0.045, 0.04]], 14, P * 0.1, P * 0.9)); f.col('#8a4a2a'); for (let k = 0; k < 6; k++) f.boxC(0, 0.035 + (k % 2) * 0.006, -0.03 + k * 0.012, 0.012, 0.004, 0.012, k); f.col(TOMATO); f.boxC(0.004, 0.045, 0, 0.008, 0.004, 0.03); f.col('#f6f1e4'); f.sph(0, 0.05, 0, 0.012, 0.004, 0.03, 8, 3); }); fries(f, 0.07, 0.05, 10, 0.025, FRY, 7); },
  greek_salad: f => salad(f, [LETTUCE, '#5f9e35'], y => { scatter(f, 6, 0.045, 3, (x, z) => { f.col(TOMATO); f.sph(x, y, z, 0.012, 0.01, 0.012, 8, 5); }); scatter(f, 6, 0.04, 4, (x, z) => { f.col('#2a1a2a'); f.sph(x, y + 0.004, z, 0.007, 0.006, 0.006, 6, 4); }); f.col('#fbf8ee'); f.box(-0.025, y + 0.004, -0.018, 0.025, y + 0.016, 0.018); f.col('#6fa83a'); scatter(f, 5, 0.04, 6, (x, z) => f.cyl(x, z, 0.01, y, y + 0.003, 8)); }),
  moussaka: f => { plate(f); at(f, 0, TOP, 0, 0.3, () => { const L = [['#6a3a6a', 0.008], ['#a8321f', 0.012], ['#d9a85e', 0.008], ['#6a3a6a', 0.008], ['#f2e3b0', 0.016]]; let y = 0; for (const [c, h] of L) { f.col(c); f.box(-0.045, y, -0.04, 0.045, y + h, 0.04); y += h; } f.col('#c98a3a'); f.sph(0, y, 0, 0.045, 0.006, 0.04, 12, 3, { cut: 0, disp: (a, b, c) => (hsh(a * 9, 0, c * 9) - 0.5) * 0.4 }); }); side(() => leaves(f, -0.07, 0.06, 0.025, 5)); cutlery(f); },
  baklava: f => { plate(f, 0.09); for (let k = 0; k < 3; k++) at(f, -0.03 + k * 0.03, TOP, (k % 2) * 0.02 - 0.01, P / 4, () => { f.col('#d39a3a'); for (let j = 0; j < 5; j++) { f.col(j % 2 ? '#e2ad4a' : '#c88a2e'); f.box(-0.02, j * 0.006, -0.02, 0.02, j * 0.006 + 0.006, 0.02); } f.col('#5a7a2a'); scatter(f, 6, 0.012, k, (x, z) => f.boxC(x, 0.031, z, 0.003, 0.002, 0.003)); }); },
  // ---------------------------------------------------------------- french bistro
  steak_frites: f => { plate(f, 0.135); steak(f, -0.03, 0.0, 0.1, 0.07, 0.024, '#6a3a22'); f.col(BUTTER); f.sph(-0.03, TOP + 0.028, 0, 0.012, 0.005, 0.012, 8, 4); herbs(f, 0.012, TOP + 0.033, 4, 3, '#3f8a3a', -0.03, 0); fries(f, 0.06, 0.01, 18, 0.035); leaves(f, -0.03, 0.075, 0.025, 5); cutlery(f, 0.135); },
  croque: f => { plate(f); at(f, 0, TOP, 0, 0.2, () => { f.col('#d9a85e'); f.box(-0.05, 0, -0.045, 0.05, 0.012, 0.045); f.col('#e8a8a0'); f.box(-0.048, 0.012, -0.043, 0.048, 0.017, 0.043); f.col('#d9a85e'); f.box(-0.05, 0.017, -0.045, 0.05, 0.029, 0.045); f.col('#e9b85a'); f.sph(0, 0.029, 0, 0.052, 0.007, 0.047, 14, 3, { cut: 0, disp: (a, b, c) => (hsh(a * 9, 0, c * 9) - 0.5) * 0.25 }); f.col('#a8662c'); scatter(f, 8, 0.035, 6, (x, z) => f.sph(x, 0.035, z, 0.01, 0.002, 0.008, 6, 3)); }); side(() => leaves(f, 0.07, 0.05, 0.03, 6)); cutlery(f); },
  onion_soup: f => { f.col('#6a4a3a'); f.lathe(0, 0, [[0, 0], [0.04, 0], [0.055, 0.06], [0.05, 0.06], [0, 0.012]], 16); f.col('#6a4a3a'); f.rod([0.05, 0.05, 0], [0.075, 0.052, 0], 0.008, 6); f.rod([-0.05, 0.05, 0], [-0.075, 0.052, 0], 0.008, 6); f.col('#d9a85e'); f.cyl(0, 0, 0.05, 0.05, 0.06, 16); f.col('#e9b85a'); f.sph(0, 0.06, 0, 0.056, 0.012, 0.056, 16, 4, { cut: 0, disp: (a, b, c) => (hsh(a * 7, b, c * 7) - 0.5) * 0.25 }); f.col('#a8662c'); scatter(f, 7, 0.035, 5, (x, z) => f.sph(x, 0.069, z, 0.012, 0.002, 0.01, 6, 3)); f.col('#e9b85a'); for (let k = 0; k < 4; k++) f.sph(Math.sin(k * 1.6) * 0.052, 0.05, Math.cos(k * 1.6) * 0.052, 0.008, 0.012, 0.006, 6, 4); },
  quiche: f => { plate(f, 0.11); at(f, 0, TOP, 0.0, 0, () => { f.col('#c88a3e'); wedge(f, 0.085, P - 0.42, P + 0.42, 0, 0.032, 6); f.col('#f2d27a'); wedge(f, 0.078, P - 0.4, P + 0.4, 0.004, 0.0322, 6); f.col('#d8a04a'); scatter(f, 6, 0.025, 5, (x, z) => f.sph(x, 0.033, z - 0.05, 0.01, 0.002, 0.008, 6, 3)); f.col('#e8a8a0'); scatter(f, 6, 0.025, 6, (x, z) => f.boxC(x, 0.033, z - 0.05, 0.004, 0.0015, 0.004)); }); side(() => leaves(f, 0.06, 0.05, 0.028, 6)); cutlery(f, 0.11); },
  coq_au_vin: f => { const y = bowl(f, 0.1, 0.05, '#e9e2d6')(0.7); surface(f, 0.1, 0.05, y, '#5a1a1e'); drumstick(f, -0.02, 0.005, 0.6, 1, '#7a3a2a', y - 0.006); drumstick(f, 0.02, -0.025, 2.5, 1, '#7a3a2a', y - 0.006); chunks(f, 8, 0.06, y + 0.003, 0.009, ['#8a6a4a', '#e38a3a', '#f2ead8'], 3); herbs(f, 0.05, y + 0.006, 8, 2); spoon(f, 0.08, 0.05, 0.05, 2.4); },
  ratatouille: f => { plate(f, 0.125); for (let ring = 0; ring < 2; ring++) for (let k = 0; k < (ring ? 9 : 14); k++) { const a = k / (ring ? 9 : 14) * TAU, rr = ring ? 0.035 : 0.075; rot(f, -0.9, a + H, 0, Math.sin(a) * rr, TOP + 0.016, Math.cos(a) * rr, () => { f.col(['#d84a2b', '#e9c84a', '#6a2a5a', '#3f8a3a'][k % 4]); f.cyl(0, 0, 0.016, -0.002, 0.002, 10); }); } herbs(f, 0.06, TOP + 0.03, 10, 4); cutlery(f); },
  creme_brulee: f => { plate(f, 0.09); f.col(WHITE); f.lathe(0, 0, [[0, TOP], [0.055, TOP], [0.058, TOP + 0.03], [0.054, TOP + 0.03], [0, TOP + 0.02]], 18); f.col('#c8862e'); f.cyl(0, 0, 0.053, TOP + 0.024, TOP + 0.027, 18); f.col('#a8661e'); f.sph(0.01, TOP + 0.027, -0.01, 0.025, 0.001, 0.02, 8, 2); f.col(STRAW); f.sph(-0.02, TOP + 0.032, 0.015, 0.009, 0.008, 0.009, 7, 4); f.col('#3f8a3a'); f.sph(-0.012, TOP + 0.035, 0.02, 0.007, 0.002, 0.004, 6, 3); spoon(f, 0.07, TOP, 0.03, -0.3); },
  crepes: f => { plate(f); for (let k = 0; k < 2; k++) at(f, 0, TOP + k * 0.006, -0.015 + k * 0.03, 0.2, () => { f.col('#e9c47a'); rot(f, 0, 0, H, 0, 0.01, 0, () => f.lathe(0, 0, [[0.012, -0.06], [0.012, 0.06]], 12)); f.col('#d9a04a'); for (let j = 0; j < 5; j++) f.sph(-0.04 + j * 0.02, 0.022, 0, 0.006, 0.001, 0.006, 6, 3); }); f.col(CHOC); for (let k = 0; k < 4; k++) f.rod([-0.06, TOP + 0.03, -0.04 + k * 0.025], [0.06, TOP + 0.03, -0.03 + k * 0.025], 0.002, 3); scatter(f, 5, 0.03, 2, (x, z) => { f.col(STRAW); f.sph(x + 0.06, TOP + 0.008, z + 0.06, 0.009, 0.008, 0.009, 7, 4); }); f.col('#f4f1ea'); scatter(f, 30, 0.07, 3, (x, z) => f.boxC(x, TOP + 0.031, z, 0.0018, 0.0006, 0.0018)); cutlery(f); },
  macarons: f => { plate(f, 0.1); ['#f2a8c0', '#b8d88a', '#c9a8e8', '#f6d68a', '#8ac8e8', '#e8b07a'].forEach((c, k) => { if (taken()) return; const a = k / 6 * TAU; at(f, Math.sin(a) * 0.045, TOP, Math.cos(a) * 0.045, a, () => rot(f, 0.15, 0, 0, 0, 0.012, 0, () => { f.col(c); f.cyl(0, 0, 0.02, -0.011, -0.003, 14, 0.021); f.col('#fbf4ea'); f.cyl(0, 0, 0.017, -0.003, 0.003, 14); f.col(c); f.cyl(0, 0, 0.021, 0.003, 0.011, 14, 0.02); })); }); },
  // ---------------------------------------------------------------- seafood
  fish_chips: f => { basket(f, 0.25, 0.17, '#1f4e8c'); at(f, -0.04, 0.008, 0, 0.3, () => { f.col('#d9a04a'); blob(f, 0, 0, 0, 0.075, 0.02, 0.035, 0.18, 4, 14, 6, 0); f.col('#c88a3e'); blob(f, 0.045, 0.004, 0.0, 0.03, 0.015, 0.025, 0.18, 5, 10, 5, 0); }); fries(f, 0.07, 0.01, 18, 0.035, FRY, 3, 0.008); lemon(f, -0.03, 0.04, 0.016); ramekin(f, 0.08, -0.06, '#eee6c8', 0.02); },
  salmon: f => { plate(f, 0.13); fillet(f, 0.0, -0.01, 0.1, 0.055, 0.022, '#f08c5a'); f.col('#3f6e24'); for (let k = 0; k < 6; k++) f.rod([-0.06 + k * 0.006, TOP + 0.005, 0.05], [0.04 + k * 0.004, TOP + 0.005, 0.07], 0.0045, 5); lemon(f, 0.06, TOP + 0.03, 0.017); herbs(f, 0.03, TOP + 0.024, 6, 3); cutlery(f, 0.13); },
  shrimp: f => { const y = bowl(f, 0.09, 0.03, '#e9e2d6')(0.6); surface(f, 0.09, 0.03, y, '#e9b84a'); for (let k = 0; k < 7; k++) { const a = k / 7 * TAU; shrimp(f, Math.sin(a) * 0.045, y - 0.004, Math.cos(a) * 0.045, a + H, 1); } herbs(f, 0.06, y + 0.006, 14, 6); at(f, 0.11, 0, 0.0, 0.3, () => { f.col('#c98a42'); f.box(-0.02, 0, -0.04, 0.02, 0.012, 0.04); }); },
  lobster: f => { platter(f, 0.17, 0.11); at(f, 0, TOP, 0, 0, () => { for (let k = 0; k < 6; k++) { f.col(k % 2 ? '#d8371e' : '#c8301a'); f.sph(-0.06 + k * 0.022, 0.016, 0, 0.016 - k * 0.0006, 0.014, 0.022 - k * 0.0008, 10, 5); } f.col('#d8371e'); f.sph(0.075, 0.018, 0, 0.026, 0.018, 0.024, 10, 6); for (const s of [-1, 1]) { f.rod([0.09, 0.018, s * 0.015], [0.12, 0.016, s * 0.05], 0.006, 5); f.sph(0.135, 0.016, s * 0.06, 0.024, 0.013, 0.016, 10, 5); f.col('#e04a2a'); f.rod([0.095, 0.03, s * 0.01], [0.16, 0.05, s * 0.03], 0.0015, 3); f.col('#d8371e'); } f.col('#f2f0e6'); f.box(-0.06, 0.03, -0.012, 0.04, 0.034, 0.012); f.col('#c62828'); for (let k = 0; k < 3; k++) f.rod([-0.1 - k * 0.006, 0.01, 0], [-0.12 - k * 0.004, 0.01, (k - 1) * 0.02], 0.004, 4); }); lemon(f, -0.13, TOP + 0.012, 0.017); ramekin(f, 0.0, 0.075, '#f2d27a', 0.022); },
  oysters: f => { at(f, 0, 0, 0, 0, () => { f.col(STEEL); f.lathe(0, 0, [[0, 0], [0.14, 0.0], [0.15, 0.02], [0.145, 0.022], [0, 0.012]], 24); f.col('#eef6fa'); scatter(f, 30, 0.12, 6, (x, z, k, r) => f.boxC(x, 0.018, z, 0.01, 0.006, 0.01, r() * 3)); }); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; at(f, Math.sin(a) * 0.085, 0.022, Math.cos(a) * 0.085, a, () => { f.col('#8a8070'); f.sph(0, 0, 0, 0.03, 0.01, 0.024, 10, 4, { cut: 0, disp: (u, v, w) => Math.sin(u * 12) * 0.15 }); f.col('#d8d0c0'); f.sph(0, 0.004, 0, 0.024, 0.005, 0.018, 10, 3, { cut: 0 }); f.col('#c8bfae'); f.sph(0, 0.008, 0, 0.014, 0.004, 0.011, 8, 3); }); } lemon(f, 0, 0.03, 0.02); },
  fish_tacos: f => { platter(f, 0.15, 0.1); tacoShell(f, -0.05, 0, H, 0.045, '#efd9a4', ['#e9b85a', '#8a5aa8', '#f3f0e4', GUAC]); tacoShell(f, 0.05, 0, H, 0.045, '#efd9a4', ['#e9b85a', '#7fae3c', '#f3f0e4', TOMATO]); lemon(f, 0.1, TOP + 0.012, 0.016, '#8bc34a'); },
  chowder: f => { at(f, 0, 0, 0, 0, () => { f.col('#c98a42'); f.sph(0, 0.0, 0, 0.065, 0.05, 0.065, 16, 8, { cut: 0, disp: (a, b, c) => (hsh(a * 7, b * 7, c * 7) - 0.5) * 0.06 }); f.col('#f1e6c8'); f.cyl(0, 0, 0.05, 0.044, 0.048, 16); chunks(f, 8, 0.03, 0.048, 0.007, ['#e9d6a0', '#e38a3a', '#f6f1e4'], 6); herbs(f, 0.03, 0.05, 6, 2); f.col('#b8783a'); f.cyl(0.07, 0.04, 0.03, 0.0, 0.02, 12); }); spoon(f, 0.08, 0.0, -0.04, 1.0); },
  paella: f => { f.col('#2a2a2e'); f.lathe(0, 0, [[0, 0], [0.13, 0], [0.145, 0.025], [0.14, 0.026], [0.125, 0.006], [0, 0.006]], 26); f.rod([0.14, 0.022, 0], [0.17, 0.024, 0], 0.006, 5); f.rod([-0.14, 0.022, 0], [-0.17, 0.024, 0], 0.006, 5); f.col('#f2b52a'); f.cyl(0, 0, 0.13, 0.006, 0.018, 26); chunks(f, 14, 0.1, 0.02, 0.008, ['#d84a2b', '#3f8a3a', '#f2e3b0'], 5); for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; shrimp(f, Math.sin(a) * 0.08, 0.02, Math.cos(a) * 0.08, a, 1.1); } for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + 0.6; at(f, Math.sin(a) * 0.05, 0.02, Math.cos(a) * 0.05, a, () => { f.col('#1b1b2a'); f.sph(0, 0.0, 0, 0.018, 0.008, 0.011, 8, 4); f.col('#f2a06a'); f.sph(0, 0.004, 0, 0.012, 0.004, 0.007, 6, 3); }); } lemon(f, 0.0, 0.03, 0.02); },
  calamari: f => { plate(f, 0.12); onionRings(f, 9, 0.045, TOP - 0.002, 7); ramekin(f, 0.075, 0.06, '#e8e2c8', 0.022); lemon(f, -0.07, TOP + 0.012, 0.017); },
  mussels: f => { const y = bowl(f, 0.1, 0.06, '#2a2a2e')(0.5); for (let k = 0; k < 14; k++) { const a = k * 2.4, d = 0.02 + (k % 3) * 0.022; at(f, Math.sin(a) * d, y + (k % 2) * 0.008, Math.cos(a) * d, a, () => rot(f, 0.4, 0, 0, 0, 0, 0, () => { f.col('#1b1b2a'); f.sph(0, 0, 0, 0.022, 0.006, 0.012, 8, 4, { cut: 0 }); f.col('#f29a5a'); f.sph(0, 0.003, 0, 0.014, 0.004, 0.007, 6, 3); })); } herbs(f, 0.06, y + 0.02, 14, 5); at(f, 0.11, 0, 0.05, 0.3, () => { f.col('#c98a42'); f.box(-0.02, 0, -0.04, 0.02, 0.012, 0.04); }); },
  shrimp_cocktail: f => { gl(f, {}); f.lathe(0, 0, [[0, 0], [0.034, 0], [0.034, 0.004], [0.004, 0.009], [0.004, 0.05], [0.05, 0.075], [0.06, 0.1], [0.058, 0.1], [0, 0.055]], 18); f.col('#d8341e'); f.cyl(0, 0, 0.03, 0.058, 0.07, 14); leaves(f, 0, 0, 0.03, 6, [LETTUCE], 3, 0.06); for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; rot(f, 0, a, 0.7, Math.sin(a) * 0.055, 0.1, Math.cos(a) * 0.055, () => shrimp(f, 0, 0, 0, 0, 1.1)); } lemon(f, 0.05, 0.1, 0.016); },
  // ---------------------------------------------------------------- steak & bbq
  ribeye: f => { board(f, 0.3, 0.2, WOOD_D); steak(f, -0.02, 0.0, 0.14, 0.09, 0.03, '#5a2e1a', Y_BOARD); f.col('#e08a7a'); at(f, 0.065, Y_BOARD, 0.0, 0.0, () => { for (let k = 0; k < 3; k++) { f.col('#5a2e1a'); f.box(k * 0.016, 0, -0.04, k * 0.016 + 0.012, 0.028, 0.04); f.col('#d8606a'); f.box(k * 0.016 + 0.0005, 0.004, -0.038, k * 0.016 + 0.0125, 0.024, 0.038); } }); side(() => { f.col('#f2e3b0'); for (let k = 0; k < 3; k++) f.sph(-0.1, Y_BOARD + 0.012, -0.06 + k * 0.025, 0.016, 0.012, 0.016, 8, 5); }); f.col('#3f8a3a'); f.rod([-0.06, Y_BOARD + 0.035, 0.0], [0.0, Y_BOARD + 0.035, 0.02], 0.002, 3); cutlery(f, 0.15); },
  bbq_ribs: f => { board(f, 0.3, 0.2, WOOD_D); at(f, -0.01, Y_BOARD, 0, 0.1, () => { f.col('#6a2412'); f.box(-0.1, 0, -0.045, 0.1, 0.025, 0.045); f.col('#8a2e14'); f.sph(0, 0.025, 0, 0.1, 0.008, 0.045, 14, 3, { cut: 0 }); f.col('#efe3cc'); for (let k = 0; k < 7; k++) f.rod([-0.09 + k * 0.03, 0.012, 0.045], [-0.09 + k * 0.03, 0.012, 0.06], 0.0045, 5); }); side(() => { f.col('#f2e3b0'); at(f, 0.1, Y_BOARD, 0.05, 0, () => { f.col('#f6f1e4'); f.lathe(0, 0, [[0.03, 0.03], [0.026, 0], [0, 0]].reverse(), 12); leaves(f, 0, 0, 0.022, 6, ['#d8e8b0', '#c8508a'], 3, 0.018); }); fries(f, 0.08, -0.05, 12, 0.03, FRY, 5, Y_BOARD); }); },
  pulled_pork: f => { board(f, 0.26, 0.18, WOOD); at(f, -0.03, Y_BOARD, 0, 0, () => burgerStack(f, { y: 0, cheese: false, tomato: false, lettuce: false, patties: 0, bun: '#d9a25e' })); at(f, -0.03, Y_BOARD + 0.02, 0, 0, () => { for (let k = 0; k < 18; k++) { f.col(k % 3 ? '#9a5a2a' : '#7a3a1a'); f.boxC(Math.sin(k * 2.3) * 0.035, 0.005 + (k % 3) * 0.004, Math.cos(k * 1.7) * 0.035, 0.012, 0.003, 0.003, k); } }); side(() => at(f, 0.075, Y_BOARD, 0.02, 0, () => { f.col('#f6f1e4'); f.lathe(0, 0, [[0, 0], [0.026, 0], [0.03, 0.03], [0, 0.03]], 12); leaves(f, 0, 0, 0.022, 6, ['#d8e8b0', '#c8508a'], 3, 0.018); })); },
  roast_chicken: f => { platter(f, 0.15, 0.11); at(f, -0.015, TOP, 0, 0.3, () => { f.col('#c8823a'); f.sph(0, 0.03, 0, 0.065, 0.04, 0.05, 14, 7, { cut: -0.4 }); f.col('#d9944a'); f.sph(0.05, 0.03, 0.03, 0.022, 0.018, 0.02, 8, 5); f.sph(0.05, 0.03, -0.03, 0.022, 0.018, 0.02, 8, 5); f.col('#efe3cc'); f.rod([0.065, 0.034, 0.035], [0.08, 0.04, 0.04], 0.004, 4); f.rod([0.065, 0.034, -0.035], [0.08, 0.04, -0.04], 0.004, 4); }); chunks(f, 8, 0.03, TOP + 0.01, 0.012, ['#d9a04a', '#e38a3a', '#7a2a3a'], 4, 0.1, 0.0); herbs(f, 0.05, TOP + 0.06, 6, 3); cutlery(f, 0.15); },
  wings: f => { basket(f, 0.2, 0.15, '#c62828'); for (let k = 0; k < 7; k++) { const a = k * 0.9; wing(f, Math.sin(a) * 0.04, Math.cos(a) * 0.035, a, '#c2401c', 0.008 + (k % 2) * 0.01); } f.col('#f2f0e6'); for (let k = 0; k < 3; k++) f.rod([0.06, 0.016, -0.04 + k * 0.01], [0.09, 0.016, -0.04 + k * 0.01], 0.005, 5); ramekin(f, 0.075, 0.045, '#f4f1e6', 0.02); },
  brisket: f => { board(f, 0.28, 0.18, WOOD); for (let k = 0; k < 5; k++) at(f, -0.06 + k * 0.022, Y_BOARD, 0, 0.1, () => { f.col('#2a1a12'); f.box(-0.009, 0, -0.045, 0.009, 0.03, 0.045); f.col('#a8523a'); f.box(-0.0092, 0.003, -0.042, 0.0092, 0.025, 0.042); f.col('#d8603a'); f.box(-0.0093, 0.02, -0.042, 0.0093, 0.024, 0.042); }); side(() => { at(f, 0.09, Y_BOARD, 0.04, 0, () => { f.col('#e9d6a0'); f.lathe(0, 0, [[0, 0], [0.024, 0], [0.028, 0.026], [0, 0.026]], 12); }); f.col('#f2e3b0'); f.box(0.07, Y_BOARD, -0.06, 0.12, Y_BOARD + 0.015, -0.03); }); },
  mac_cheese: f => { f.col('#2a2a2e'); f.lathe(0, 0, [[0, 0], [0.07, 0], [0.075, 0.04], [0.071, 0.04], [0, 0.008]], 18); f.col('#f2b53a'); f.cyl(0, 0, 0.069, 0.008, 0.034, 18); scatter(f, 30, 0.06, 5, (x, z, k) => { f.col(k % 3 ? '#f2c14e' : '#d9993a'); rot(f, H * 0.3, x * 40, 0, x, 0.036, z, () => torus(f, 0, 0, 0, 0.005, 0.003, 8, 4)); }); f.col('#c98a3a'); scatter(f, 14, 0.05, 6, (x, z) => f.sph(x, 0.038, z, 0.006, 0.002, 0.006, 5, 3)); },
  corn: f => { plate(f, 0.1); if (taken()) return; f.col('#f2c84a'); capsule(f, [-0.06, TOP + 0.022, 0], [0.06, TOP + 0.022, 0], 0.02, 12); f.col('#f6d870'); scatter(f, 30, 0.02, 3, (x, z) => f.sph(x * 3, TOP + 0.04, z * 0.6, 0.004, 0.003, 0.004, 5, 3)); f.col(BUTTER); f.box(-0.01, TOP + 0.04, -0.008, 0.01, TOP + 0.048, 0.008); },
  mash: f => { const y = bowl(f, 0.07, 0.04, WHITE)(0.6); f.col('#f2e6c0'); f.sph(0, y - 0.004, 0, 0.055, 0.03, 0.055, 14, 6, { cut: 0, disp: (a, b, c) => Math.sin(Math.atan2(c, a) * 4 + b * 6) * 0.08 }); f.col('#8a5a2a'); f.cyl(0, 0, 0.02, y + 0.022, y + 0.026, 12); f.col(BUTTER); f.box(-0.008, y + 0.026, -0.008, 0.008, y + 0.032, 0.008); herbs(f, 0.03, y + 0.026, 6, 4); },
  coleslaw: f => { const y = bowl(f, 0.065, 0.04, WHITE)(0.6); leaves(f, 0, 0, 0.04, 14, ['#f2f0d8', '#e8ecc8', '#c8508a', '#f2a050'], 7, y - 0.012); },
  // ---------------------------------------------------------------- salads & bowls
  caesar: f => salad(f, ['#9cc451', '#7fae3c', '#b8d870'], y => { scatter(f, 6, 0.045, 4, (x, z) => { f.col('#d9a85e'); f.boxC(x, y, z, 0.007, 0.007, 0.007, x * 30); }); f.col('#fbf6ea'); scatter(f, 6, 0.04, 5, (x, z, k, r) => rot(f, 0.3, r() * 3, 0, x, y + 0.006, z, () => f.box(-0.012, 0, -0.004, 0.012, 0.0015, 0.004))); chunks(f, 5, 0.035, y + 0.004, 0.011, ['#e9b56a'], 8); }),
  garden_salad: f => salad(f, [LETTUCE, '#5f9e35', '#a3cf5c', '#8a2f4a'], y => { scatter(f, 6, 0.045, 3, (x, z) => { f.col(TOMATO); f.sph(x, y - 0.004, z, 0.011, 0.01, 0.011, 8, 5); }); scatter(f, 6, 0.045, 4, (x, z) => { f.col('#e9f2c8'); f.cyl(x, z, 0.011, y - 0.004, y - 0.001, 8); }); scatter(f, 6, 0.04, 5, (x, z) => { f.col('#f2a050'); f.boxC(x, y - 0.002, z, 0.012, 0.002, 0.002, x * 40); }); }),
  cobb: f => { const y = bowl(f, 0.095, 0.045, WHITE)(0.5); leaves(f, 0, 0, 0.07, 14, [LETTUCE, '#5f9e35'], 4, y - 0.01); const rows = [['#c2583d', -0.04], ['#f6f1e4', -0.02], [TOMATO, 0.0], ['#8db84a', 0.02], ['#e9b56a', 0.04]]; for (const [c, z] of rows) for (let k = 0; k < 5; k++) { f.col(c); f.boxC(-0.04 + k * 0.02, y + 0.02, z, 0.008, 0.006, 0.008, k); } egg(f, 0.06, -0.05, y + 0.02, 0.015, 2); },
  poke: f => { const y = bowl(f, 0.09, 0.05, '#2a2a2e')(0.5); rice(f, 0, 0, 0.06, 0.012, RICE, y - 0.004); const parts = [['#e8505a', 0], ['#f2875a', 1], ['#8db84a', 2], ['#f6d64b', 3], ['#7fae3c', 4], ['#e9d6c8', 5]]; for (const [c, k] of parts) at(f, 0, 0, 0, k * TAU / 6, () => { f.col(c); for (let j = 0; j < 4; j++) f.boxC(0.012 + j * 0.008, y + 0.012, 0.03 + (j % 2) * 0.008, 0.007, 0.007, 0.007, j); }); scatter(f, 18, 0.05, 6, (x, z) => { f.col('#fafafa'); f.boxC(x, y + 0.02, z, 0.0015, 0.0008, 0.0015); }); cutlery(f, 0.09, true); },
  buddha_bowl: f => { const y = bowl(f, 0.09, 0.05, '#e8e2d6')(0.5); const parts = [['#f2e3b0', 0], ['#e38a3a', 1], ['#7fae3c', 2], ['#8a2a5a', 3], ['#3f6e24', 4], ['#c9a46a', 5]]; for (const [c, k] of parts) at(f, 0, 0, 0, k * TAU / 6, () => { f.col(c); for (let j = 0; j < 4; j++) f.sph(0.012 + j * 0.008, y + 0.006, 0.03 + (j % 2) * 0.008, 0.011, 0.008, 0.011, 7, 4); }); f.col('#e6d3a0'); dome(f, 0, y + 0.008, 0, 0.018, 0.012, 0.018, 0.1, 3); scatter(f, 10, 0.05, 4, (x, z) => { f.col('#2a2a2a'); f.boxC(x, y + 0.016, z, 0.0015, 0.0008, 0.0015); }); },
  tomato_soup: f => soupBowl(f, '#c8401e', y => { f.col('#f6f1e4'); for (let k = 0; k < 3; k++) torus(f, 0, y + 0.001, 0, 0.012 + k * 0.01, 0.0015, 16, 3); herbs(f, 0.02, y + 0.003, 5, 3); at(f, 0.09, 0, 0.02, 0.3, () => { f.col('#c98a42'); f.box(-0.02, 0, -0.04, 0.02, 0.012, 0.04); f.col('#f2c14e'); f.box(-0.018, 0.012, -0.038, 0.018, 0.018, 0.038); }); spoon(f, 0.06, y, -0.05, 0.6); }),
  chicken_soup: f => soupBowl(f, '#e9c46a', y => { noodles(f, 0, 0, 0.04, 0.004, '#f6e7b0', 4, y - 0.006, 4); chunks(f, 10, 0.045, y, 0.008, ['#f2e3c0', '#e38a3a', '#4f8a2a'], 5); herbs(f, 0.04, y + 0.003, 8, 2); spoon(f, 0.06, y, -0.05, 0.6); }),
  // ---------------------------------------------------------------- desserts & ice cream
  choc_cake: f => wedgeDessert(f, [['#4a2a1a', 0.022], ['#6a3a22', 0.006], ['#4a2a1a', 0.022]], '#3a1e12', (y, r) => { f.col(STRAW); f.sph(0, y + 0.008, -r * 0.6, 0.01, 0.009, 0.01, 8, 5); f.col('#fbf6ea'); dome(f, 0, y, -r * 0.35, 0.012, 0.01, 0.012, 0.1, 2); }),
  cheesecake: f => wedgeDessert(f, [['#c9934a', 0.008], ['#f6ecd2', 0.035]], '#f6e8c8', (y, r) => { f.col('#a3182a'); f.sph(0, y, -r * 0.5, 0.025, 0.004, 0.02, 10, 3, { cut: 0 }); scatter(f, 3, 0.012, 2, (x, z) => { f.col(STRAW); f.sph(x, y + 0.008, -r * 0.5 + z, 0.008, 0.007, 0.008, 7, 4); }); }),
  apple_pie: f => wedgeDessert(f, [['#d39a4a', 0.006], ['#e9c47a', 0.028]], '#d8964a', (y, r) => {   // (its lattice over the slice: across it and along it; 2026-10-28: the strips ran off the slice's back)
    f.col('#c88a3e'); for (const t of [0.4, 0.62, 0.84]) { const z = r * t, w = z * 0.38; f.box(-w, y, z - 0.004, w, y + 0.003, z + 0.004); }
    for (const x of [-0.011, 0.011]) f.box(x - 0.0035, y + 0.0005, r * 0.3, x + 0.0035, y + 0.0035, r * 0.94);
    scoop(f, 0.05, TOP + 0.015, -0.01, 0.022, '#fbf3df', 3); }),
  sundae: f => { gl(f, {}); f.lathe(0, 0, [[0, 0], [0.034, 0], [0.034, 0.004], [0.006, 0.009], [0.006, 0.04], [0.045, 0.07], [0.05, 0.1], [0.048, 0.1], [0, 0.045]], 18); scoop(f, -0.014, 0.085, 0.006, 0.024, '#f6e7c8', 1); scoop(f, 0.016, 0.085, 0.006, 0.024, '#5a3420', 2); scoop(f, 0.0, 0.1, -0.012, 0.022, '#f2c6d2', 3); f.col('#4a2a1a'); f.sph(0, 0.112, 0, 0.035, 0.006, 0.03, 12, 3, { disp: (a, b, c) => Math.sin(Math.atan2(c, a) * 6) * 0.25 }); f.col('#fbf8f2'); dome(f, 0, 0.115, 0, 0.022, 0.024, 0.022, 0.2, 4); f.col('#c3182b'); f.sph(0, 0.142, 0, 0.009, 0.009, 0.009, 8, 5); f.col('#d9a25e'); rot(f, 0.3, 0, 0.4, 0.025, 0.12, 0, () => f.box(-0.004, -0.03, -0.004, 0.004, 0.03, 0.004)); },
  ice_cream: f => { at(f, 0, 0, 0, 0, () => { f.col('#c9ced4'); f.lathe(0, 0, [[0, 0], [0.03, 0], [0.032, 0.008], [0.012, 0.012], [0.012, 0.045], [0.02, 0.05], [0, 0.05]], 14); }); cone(f, 0, 0.03, 0, ['#f2c6d2', '#f6e7c8']); },
  fruit_tart: f => { plate(f, 0.09); f.col('#d9a04a'); f.lathe(0, 0, [[0, TOP], [0.055, TOP], [0.06, TOP + 0.022], [0.055, TOP + 0.024], [0.05, TOP + 0.016], [0, TOP + 0.016]], 20); f.col('#f6e3a0'); f.cyl(0, 0, 0.051, TOP + 0.016, TOP + 0.02, 18); for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; at(f, Math.sin(a) * 0.035, TOP + 0.02, Math.cos(a) * 0.035, a, () => { f.col(STRAW); f.sph(0, 0.004, 0, 0.01, 0.009, 0.01, 7, 4); }); } scatter(f, 8, 0.022, 3, (x, z, k) => { f.col(k % 2 ? BERRY : '#7fae3c'); f.sph(x, TOP + 0.026, z, 0.007, 0.007, 0.007, 6, 4); }); f.col('#f4b23a'); f.cyl(0, 0, 0.01, TOP + 0.02, TOP + 0.03, 10); },
  cupcake: f => { plate(f, 0.08); if (taken()) return; muffinShape(f, 0, TOP, 0, '#c98f4c', null, '#e94b6a'); f.col('#f6c6d2'); for (let k = 0; k < 4; k++) torus(f, 0, TOP + 0.062 + k * 0.012, 0, 0.032 - k * 0.008, 0.01 - k * 0.0015, 16, 6); scatter(f, 12, 0.03, 4, (x, z, k) => { f.col(['#2f80ed', '#f6d64b', '#4caf50'][k % 3]); f.boxC(x, TOP + 0.09 - Math.hypot(x, z) * 0.6, z, 0.003, 0.001, 0.001, x * 50); }); f.col('#c3182b'); f.sph(0, TOP + 0.112, 0, 0.008, 0.008, 0.008, 8, 5); },
  lava_cake: f => { plate(f, 0.1); f.col('#3a1e12'); f.lathe(0, 0, [[0, TOP], [0.04, TOP], [0.037, TOP + 0.045], [0, TOP + 0.045]], 18); f.col('#2a140c'); f.sph(0.03, TOP, 0.03, 0.035, 0.004, 0.025, 12, 3, { cut: 0 }); f.col('#f4f1ea'); scatter(f, 30, 0.035, 2, (x, z) => f.boxC(x, TOP + 0.046, z, 0.0015, 0.0005, 0.0015)); scoop(f, -0.055, TOP + 0.015, 0.0, 0.02, '#fbf3df', 3); f.col(STRAW); f.sph(-0.04, TOP + 0.008, 0.05, 0.01, 0.009, 0.01, 8, 5); },
  banana_split: f => { gl(f, {}); f.lathe(0, 0, [[0, 0], [0.13, 0]], 4); within(f, new THREE.Matrix4().makeScale(1.9, 1, 0.8), () => { gl(f, {}); f.lathe(0, 0, [[0, 0], [0.03, 0], [0.06, 0.035], [0.058, 0.036], [0, 0.008]], 18); }); for (const s of [-1, 1]) { f.col('#f2dc8a'); capsule(f, [-0.08, 0.03, s * 0.03], [0.08, 0.03, s * 0.022], 0.012); } scoop(f, -0.04, 0.045, 0.0, 0.022, '#5a3420', 1); scoop(f, 0.0, 0.045, 0.0, 0.022, '#f6e7c8', 2); scoop(f, 0.04, 0.045, 0.0, 0.022, '#f2c6d2', 3); f.col('#fbf8f2'); for (const x of [-0.04, 0, 0.04]) dome(f, x, 0.066, 0, 0.012, 0.012, 0.012, 0.2, x * 9); f.col('#c3182b'); f.sph(0, 0.08, 0, 0.007, 0.007, 0.007, 6, 4); },
  pudding: f => { gl(f, {}); f.lathe(0, 0, [[0, 0], [0.032, 0], [0.04, 0.07], [0.038, 0.07], [0.03, 0.005], [0, 0.005]], 16); f.col('#5a3420'); f.cyl(0, 0, 0.03, 0.005, 0.055, 16, 0.036); f.col('#fbf8f2'); dome(f, 0, 0.055, 0, 0.028, 0.02, 0.028, 0.2, 3); f.col('#3a1e12'); scatter(f, 8, 0.015, 3, (x, z) => f.boxC(x, 0.072, z, 0.003, 0.001, 0.0015, x * 60)); spoon(f, 0.05, 0.0, 0.0, 0.3); },
  // ---------------------------------------------------------------- home cooking
  cereal: f => { const y = bowl(f, 0.08, 0.05, '#f3f1ec', '#d84a3a')(0.7); surface(f, 0.08, 0.05, y, '#f7f5ee'); scatter(f, 28, 0.05, 7, (x, z, k) => { f.col(k % 3 ? '#e2a84a' : '#c98a3a'); torus(f, x, y + 0.003, z, 0.006, 0.0028, 8, 4); }); spoon(f, 0.05, y, 0.03, 0.8); },
  toast_jam: f => { plate(f, 0.1); toast(f, -0.025, TOP, 0.0, 0.2, 0.042); toast(f, 0.03, TOP + 0.006, 0.01, -0.3, 0.042); f.col('#a3182a'); f.sph(-0.025, TOP + 0.014, 0.0, 0.03, 0.002, 0.026, 10, 3); f.col(BUTTER); f.sph(0.03, TOP + 0.02, 0.01, 0.026, 0.0015, 0.024, 10, 3); at(f, 0.075, 0, -0.04, 0, () => { gl(f, {}); f.cyl(0, 0, 0.02, 0, 0.045, 12); f.col('#8a1020'); f.cyl(0, 0, 0.018, 0.002, 0.035, 12); f.col('#f2f0e6'); f.cyl(0, 0, 0.021, 0.045, 0.05, 12); }); },
  scrambled_eggs: f => { plate(f); toast(f, -0.035, TOP, 0.0, 0.3, 0.045); toast(f, 0.04, TOP, -0.01, -0.2, 0.045); for (const x of [-0.035, 0.04]) { f.col('#f6d870'); blob(f, x, TOP + 0.013, 0.0, 0.035, 0.014, 0.03, 0.3, x * 99, 12, 5, 0); } herbs(f, 0.06, TOP + 0.03, 8, 3); cutlery(f); },
  pbj: f => { plate(f, 0.11); const L = [['#b8783a', 0.006], ['#7a1f4a', 0.005]]; sandwichHalf(f, -0.02, 0.01, 0.4, 0.05, L, '#f2e6c4', CRUST); sandwichHalf(f, 0.03, -0.02, P + 0.4, 0.05, L, '#f2e6c4', CRUST, TOP + 0.004); f.col('#7a1f4a'); f.sph(0.0, TOP + 0.02, -0.004, 0.014, 0.003, 0.004, 6, 3); },
  stir_fry: f => { const y = bowl(f, 0.09, 0.045, '#3a3d42')(0.5); rice(f, 0, 0, 0.06, 0.012, RICE, y - 0.004); chunks(f, 18, 0.06, y + 0.014, 0.01, ['#3f8a3a', '#d84a2b', '#f2c14e', '#e38a3a', '#7a4a2a', '#f2f0e6'], 6); f.col('#6a2a14'); f.sph(0, y + 0.01, 0, 0.055, 0.004, 0.055, 14, 3, { cut: 0, disp: (a, b, c) => (hsh(a * 6, 0, c * 6) - 0.5) * 0.5 }); cutlery(f, 0.09, true); },
  chicken_veg: f => { plate(f, 0.13); drumstick(f, -0.03, 0.0, 0.4, 1.15, '#c88a3a'); chunks(f, 10, 0.035, TOP + 0.012, 0.013, ['#d9a04a', '#e38a3a', '#f2e3b0'], 4, 0.05, 0.02); f.col('#3f8a3a'); for (let k = 0; k < 4; k++) f.sph(0.04 + k * 0.008, TOP + 0.014, -0.05, 0.012, 0.012, 0.012, 8, 5, { disp: (a, b, c) => (hsh(a * 9, b * 9, c * 9) - 0.5) * 0.4 }); cutlery(f, 0.13); },
  home_pasta: f => pasta(f, '#f0d58a', '#c0391f', y => { f.col('#f4f0e2'); scatter(f, 10, 0.03, 6, (x, z) => f.boxC(x, y - 0.002, z, 0.002, 0.001, 0.002)); }),
  instant_noodles: f => { at(f, 0, 0, 0, 0, () => { f.col('#f4f1ea'); f.lathe(0, 0, [[0, 0], [0.04, 0], [0.05, 0.08], [0.047, 0.08], [0, 0.006]], 16); f.col('#d84a3a'); f.cyl(0, 0, 0.0472, 0.04, 0.06, 16, 0.0495); f.col('#e9b85a'); f.cyl(0, 0, 0.046, 0.066, 0.07, 16); noodles(f, 0, 0, 0.035, 0.004, '#f2d27a', 4, 0.066, 4); chunks(f, 6, 0.03, 0.072, 0.005, ['#4f8a2a', '#e38a3a'], 3); }); f.col('#c2582a'); rot(f, -0.4, 0, 0, 0.0, 0.085, -0.03, () => f.box(-0.035, 0, -0.03, 0.035, 0.002, 0.03)); f.col('#3b2618'); f.rod([0.01, 0.07, 0.0], [0.06, 0.16, 0.04], 0.003, 4); f.rod([0.018, 0.07, 0.0], [0.07, 0.16, 0.035], 0.003, 4); },
  rice_beans: f => { plate(f, 0.12); rice(f, -0.03, 0.0, 0.05, 0.03); at(f, 0.04, TOP, 0, 0, () => { f.col('#5a2a1a'); f.sph(0, 0, 0, 0.045, 0.012, 0.05, 12, 3, { cut: 0 }); scatter(f, 18, 0.035, 5, (x, z) => { f.col('#6a2a1e'); f.sph(x, 0.012, z, 0.006, 0.004, 0.004, 6, 3); }); }); herbs(f, 0.04, TOP + 0.03, 6, 3); cutlery(f, 0.12); },
  veg_soup: f => soupBowl(f, '#c88a3a', y => { chunks(f, 14, 0.05, y, 0.009, ['#e38a3a', '#3f8a3a', '#f2e3b0', '#d84a2b'], 4); herbs(f, 0.04, y + 0.004, 6, 5); spoon(f, 0.06, y, -0.05, 0.6); at(f, 0.09, 0, 0.03, 0.3, () => { f.col('#c98a42'); f.box(-0.02, 0, -0.035, 0.02, 0.014, 0.035); }); }),
  salmon_rice: f => { plate(f, 0.13); rice(f, -0.04, 0.03, 0.04, 0.025); fillet(f, 0.035, -0.0, 0.08, 0.045, 0.02, '#f08c5a'); f.col('#3f8a3a'); for (let k = 0; k < 5; k++) f.sph(-0.05 + k * 0.012, TOP + 0.008, -0.05, 0.012, 0.008, 0.01, 7, 4); lemon(f, 0.07, TOP + 0.026, 0.014); cutlery(f, 0.13); },
  tacos_home: f => { board(f, 0.3, 0.18); tacoShell(f, -0.07, 0, H, 0.042, '#f2c86a', ['#7a4b2a', LETTUCE, '#f2b53a'], Y_BOARD); tacoShell(f, 0.0, 0, H, 0.042, '#f2c86a', ['#7a4b2a', LETTUCE, TOMATO], Y_BOARD); ramekin(f, 0.08, -0.03, '#c84a2a', 0.022); ramekin(f, 0.08, 0.04, GUAC, 0.022); },
  lunchbox: f => { at(f, 0, 0, 0, 0, () => { f.col('#2f80ed'); f.box(-0.09, 0, -0.065, 0.09, 0.04, 0.065); f.col('#f3f1ec'); f.box(-0.085, 0.004, -0.06, 0.085, 0.041, 0.06); f.col('#2f80ed'); f.box(-0.002, 0.004, -0.06, 0.002, 0.042, 0.06); f.box(0.0, 0.004, -0.002, 0.085, 0.042, 0.002); f.col('#2f80ed'); rot(f, -0.25, 0, 0, 0, 0.0, -0.075, () => f.box(-0.09, 0, -0.07, 0.09, 0.008, 0.0)); }); sandwichHalf(f, -0.045, 0.025, 0, 0.035, [['#e9b38c', 0.006], [LETTUCE, 0.003]], '#e9cf9a', CRUST, 0.004); scatter(f, 6, 0.02, 3, (x, z) => { f.col('#e38a3a'); f.rod([0.03 + x, 0.012, 0.03 + z], [0.06 + x, 0.012, 0.03 + z], 0.004, 5); }); f.col('#c3182b'); f.sph(0.045, 0.022, -0.03, 0.018, 0.018, 0.018, 10, 6); },
  leftovers: f => { at(f, 0, 0, 0, 0, () => { gl(f, {}); f.box(-0.08, 0, -0.06, 0.08, 0.045, 0.06); f.col('#c46a3a'); f.box(-0.075, 0.004, -0.055, 0.075, 0.028, 0.055); f.col('#f5f2e9'); f.box(-0.074, 0.028, -0.054, 0.0, 0.032, 0.054); chunks(f, 6, 0.03, 0.032, 0.009, ['#8a4a2a', '#3f8a3a'], 4, 0.035, 0); f.col('#3aa0d8'); rot(f, 0, 0.5, 0, 0.085, 0.0, 0.06, () => f.box(-0.07, 0, -0.05, 0.07, 0.01, 0.05)); }); fork(f, -0.11, 0, 0.0, 0.1); },
};

// ------------------------------------------------------------------------------------------------ building
/** Builds item it's model into a new FB. o.cook: as it cooks (a pan or a pot with its colours) rather than served;
 *  o.bare: without its knife, fork, spoon or chopsticks; o.taken: its first piece in someone's hands. */
export function buildFood(it, o = {}) {
  const f = new FB();
  BARE = !!o.bare; TAKE = o.taken ? 1 : 0;
  try {
    if (o.cook) cookware(f, it);
    else if (it.v) VESSELS[it.v](f, it.liq, {});
    else (R[it.id] || placeholder)(f, it);
  } finally { BARE = false; TAKE = 0; }
  return f.build();
}
function placeholder(f) { plate(f); f.col('#c8a070'); dome(f, 0, TOP, 0, 0.05, 0.03, 0.05, 0.1, 1); }
/** What is on the stove while a home dish cooks: a frying pan (eggs, stir-fries, pancakes) or a pot (soup, pasta,
 *  noodles, rice), its contents in the dish's colours. */
const POT = new Set(['home_pasta', 'veg_soup', 'instant_noodles', 'rice_beans', 'spaghetti', 'tomato_soup', 'oatmeal', 'dal', 'green_curry', 'mac_cheese', 'chicken_soup', 'cereal']);
const COOK_COL = {
  home_pasta: ['#c0391f', '#f0d58a'], veg_soup: ['#c88a3a', '#e38a3a', '#3f8a3a'], instant_noodles: ['#e9b85a', '#f2d27a'], rice_beans: ['#f5f2e9', '#5a2a1a'],
  spaghetti: ['#a8321f', '#f0d58a'], tomato_soup: ['#c8401e'], oatmeal: ['#e3cfa2', BERRY], dal: ['#e6b23a'], green_curry: ['#a9c46a', '#f1e6c8'],
  mac_cheese: ['#f2b53a'], chicken_soup: ['#e9c46a', '#f6e7b0'], cereal: ['#f7f5ee'],
  scrambled_eggs: ['#f6d870', '#f6d870'], eggs_bacon: [EGG_W, YOLK, '#c2583d'], pancakes: ['#d49a52'], french_toast: ['#d9993f'], omelette: ['#f4cf5c'],
  stir_fry: ['#3f8a3a', '#d84a2b', '#f2c14e', '#7a4a2a'], chicken_veg: ['#c88a3a', '#e38a3a', '#3f8a3a'], salmon_rice: ['#f08c5a', '#3f8a3a'], tacos_home: ['#7a4b2a', '#d84a2b'],
  fried_rice: ['#f2d27a', '#4f8a2a', '#e38a3a'], roast_chicken: ['#c8823a'], grilled_cheese: ['#d9993f', '#f2b53a'], quesadilla: ['#e6c27f', '#f2b53a'], tuna_melt: ['#d39a52'],
};
function cookware(f, it) {
  const cols = COOK_COL[it.id] || ['#c8a070', '#8a5a3a'];
  if (POT.has(it.id)) {
    f.col('#9aa3ad'); f.lathe(0, 0, [[0, 0], [0.085, 0], [0.09, 0.11], [0.085, 0.11], [0.08, 0.008], [0, 0.008]], 20);
    f.col('#2a2c30'); for (const s of [-1, 1]) f.rod([s * 0.088, 0.09, 0], [s * 0.115, 0.095, 0], 0.008, 5);
    f.col(cols[0]); f.cyl(0, 0, 0.08, 0.07, 0.085, 20);
    if (cols.length > 1) chunks(f, 8, 0.05, 0.085, 0.008, cols.slice(1), it.n);
    f.col('#7a7f86'); f.rod([0.03, 0.09, 0.02], [0.13, 0.2, 0.08], 0.006, 5); f.sph(0.03, 0.085, 0.02, 0.018, 0.006, 0.014, 8, 3);
  } else {
    f.col('#2b2d31'); f.lathe(0, 0, [[0, 0], [0.1, 0], [0.11, 0.035], [0.104, 0.036], [0.095, 0.008], [0, 0.008]], 20);
    f.col('#3b2618'); f.rod([0.105, 0.03, 0], [0.24, 0.045, 0], 0.011, 6);
    f.col(cols[0]); f.sph(0, 0.008, 0, 0.075, 0.012, 0.075, 16, 3, { cut: 0, disp: (a, b, c) => (hsh(a * 7, 0, c * 7) - 0.5) * 0.3 });
    if (cols.length > 1) chunks(f, 10, 0.055, 0.02, 0.01, cols.slice(1), it.n);
    f.col('#c9a46a'); f.rod([-0.03, 0.03, 0.02], [-0.16, 0.06, 0.09], 0.005, 5); f.col('#3b2618'); f.box(-0.035, 0.022, -0.005, 0.0, 0.026, 0.035);
  }
}

// geometry per item (and per cooking item), built when first wanted
const CACHE = new Map();
/** { geo, glass } for item n (shared/food.js number); cook: the pan/pot version; bare: without cutlery; taken: a piece
 *  of it (the first) in the eater's hands. */
export function foodGeometry(n, cook = false, bare = false, taken = false) {
  const key = `${n}:${cook ? 1 : 0}${bare ? 1 : 0}${taken ? 1 : 0}`;
  if (!CACHE.has(key)) { const it = FOOD_BY_N[n]; CACHE.set(key, it ? buildFood(it, { cook, bare, taken }) : { geo: null, glass: null }); }
  return CACHE.get(key);
}
/** Order Up's dishes (client/js/render/orderup-items.js): item id's model as served (on its plate, bowl, board …, no
 *  cutlery) or, alone, the food by itself as it comes out of the machine; and what it is served on ('plate', 'bowl',
 *  'board', 'slate', 'basket', 'skillet', 'steamer', or null: a drink, or its own vessel). { geo, glass, on }. */
export function dishGeometry(id, alone = false) {
  const key = `dish:${id}:${alone ? 1 : 0}`;
  if (!CACHE.has(key)) {
    const it = FOOD_BY_ID[id]; let out = { geo: null, glass: null, on: null };
    if (it) { ALONE = alone; SERVED_ON = null; try { out = { ...buildFood(it, { bare: true }), on: SERVED_ON }; } finally { ALONE = false; SERVED_ON = null; } }
    CACHE.set(key, out);
  }
  return CACHE.get(key);
}
export const hasModel = id => !!(FOOD_BY_ID[id]?.v ? VESSELS[FOOD_BY_ID[id].v] : R[id]);
