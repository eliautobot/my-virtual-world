// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Order Up's ingredients and dishes in every state (phase 2 of PLAN-RESTAURANT-GAME.md, 2026-10-26: "ingredients and
// dishes in their states"): small procedural models the game holds, sets on the stations and serves, a little larger
// than life so they read from the kitchen's camera (as Overcooked's). itemMesh(it) for an item of shared/orderup/rules.js:
//   cup       empty (a white cup on its saucer), shot (crema), latte (milk, a heart of latte art when perfect),
//             smoothie (a tall glass, pink, a straw), dirty (stained)
//   plate     clean, dirty (smudged), with a croissant or a toastie on it
//   grounds   the portafilter, packed     milk      a steel pitcher: cold, steamed (foam), scalded (brown foam)
//   croissant raw (pale dough), warm (golden), burnt      bread     two slices
//   tomato    whole, chopped (slices)     toastie   raw, toasted (grill lines), burnt
//   berries   whole (a bowl of them), blended or warm (the blender's jug)
// and what the new appliances cook (2026-10-28): tea in a cup (stewed: dark), cola and orange juice in a glass (spilled:
// over its rim), fries (frozen, fried, burnt: in their basket, or heaped on a plate), a patty (raw, grilled, burnt), a bun,
// the cheeseburger in its wrap, pancake batter and the pancakes (a stack, butter and syrup), toast, an orange, an avocado
// (whole, chopped) and the avocado toast; the bar's: beer in a glass (its head), a wine glass (red, white, champagne), a
// cocktail glass and the shaker; the stove's, the pizza oven's and the wok's: pizza dough, a pizza (raw, baked, burnt),
// dry and cooked pasta, stock and soup in their saucepan, noodles, a pepper (whole, chopped), the stir-fry, and a bowl; the
// arcade's: popcorn kernels and the popcorn in its striped bag, a sausage and the hot dog, a tortilla and tacos, water; the
// rice cooker's, the tandoor's, the steamer's and the freezer's: rice, curry (in its saucepan, over rice), a fish (whole,
// sliced) and sushi, naan, chicken (raw, tandoori), dumplings, ice cream
// Geometries and materials are made once and shared; a model is a few meshes.
import * as THREE from 'three';
import { dishGeometry } from './food-models.js';
import { makeFurnMat } from './mats.js';
import { kitchenOf, DEFAULT_KITCHEN } from '/shared/orderup/kitchens.js';

const K = 1.45;   // (larger than life)
const geo = new Map(), mat = new Map();
const G = (key, make) => { let g = geo.get(key); if (!g) geo.set(key, g = make()); return g; };
const M = (hex, o = {}) => {
  const key = hex + JSON.stringify(o); let m = mat.get(key);
  if (!m) mat.set(key, m = new THREE.MeshStandardMaterial({ color: hex, roughness: o.r ?? 0.55, metalness: o.m ?? 0, transparent: !!o.a, opacity: o.a ?? 1, emissive: o.e ?? hex, emissiveIntensity: LIT.k, side: o.two ? THREE.DoubleSide : THREE.FrontSide }));
  return m;
};
/** Indoors the kitchen's lamps light the dishes whatever the hour (2026-10-27): each model glows a little of its own colour,
 *  more as night falls outside, so the scene's dimming sun doesn't darken them. night: 0 (day) to 1. */
const LIT = { k: 0.12 };
export function itemLight(night) {
  const k = 0.12 + 0.5 * Math.max(0, Math.min(1, night || 0)); if (Math.abs(k - LIT.k) < 0.01) return;
  LIT.k = k; for (const m of mat.values()) m.emissiveIntensity = k;
}
const cyl = (r0, r1, h, n = 16) => G(`c${r0},${r1},${h},${n}`, () => new THREE.CylinderGeometry(r0, r1, h, n));
const sph = n => G(`s${n}`, () => new THREE.SphereGeometry(1, n, Math.max(4, n >> 1)));
const box = () => G('b', () => new THREE.BoxGeometry(1, 1, 1));
const tor = () => G('t', () => new THREE.TorusGeometry(1, 0.42, 8, 14, Math.PI * 1.25));
function part(g, gm, m, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(gm, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(rx, ry, rz); o.castShadow = false; g.add(o); return o;
}
const C = { cup: 0xf6f4ef, coffee: 0x3a1f10, crema: 0xb07a3c, milk: 0xefe4cc, foam: 0xfbf8f1, dough: 0xe9cf9a, gold: 0xd9973c, burnt: 0x2b1a12,
  bread: 0xe6c48a, crust: 0xb9803f, tomato: 0xd8352a, leaf: 0x4f8a35, steel: 0xc9ced3, black: 0x1b1c1f, berry: 0x7a2a5a, pink: 0xe57a9a, stain: 0x8a6a4a,
  tea: 0x9a4a12, stewed: 0x4a1e08, cola: 0x4e1f0c, juice: 0xf2911e, ice: 0xeaf6fb, fry: 0xf0c04a, frozen: 0xf3ead2, patty: 0x6a3a22, raw: 0xc8505a,
  bun: 0xd99a4a, cheese: 0xf6c21e, lettuce: 0x6fb03a, batter: 0xf1dfab, cake: 0xd9a055, syrup: 0x7a3a10, butter: 0xf8e27a, orange: 0xf28c1e,
  avoSkin: 0x2f4a1e, avo: 0xb6cf5a, pit: 0x7a4a26, toast: 0xc98b4a, paper: 0xf1e7d0,
  dough: 0xf0dcb0, crustB: 0xd9a055, sauce: 0xc8361e, mozz: 0xf8f0d8, basil: 0x3f8a2a, noodle: 0xf0d58a, pasta: 0xf2d27a, broth: 0xd9a84a,
  soup: 0xc84a22, pepper: 0xd8301e, wokd: 0xb8743a, corn: 0xf2c84a, pop: 0xf8f0d6, sausage: 0xa8442a, sausageRaw: 0xe08a7a, tortilla: 0xf0e0b0, mustard: 0xf2c21e,
  rice: 0xfbfaf4, curry: 0xd2691e, fish: 0xf08a5a, fishFat: 0xfbe0d0, chickenRaw: 0xf0b8a8, tandoori: 0xc8401e, naan: 0xe8c48a, char: 0x6a3a1a, dumpling: 0xf3ecdc,
  beer: 0xe0a024, head: 0xfbf6ea, red: 0x7a0f24, white: 0xf3ecc0, bubbly: 0xe8c04a, cocktail: 0xf0705a, lime: 0x9ccf4a };

function cup(g, it) {
  part(g, cyl(0.07, 0.07, 0.01), M(C.cup), 0, 0.005, 0);
  part(g, cyl(0.045, 0.035, 0.065), M(C.cup), 0, 0.042, 0);
  part(g, tor(), M(C.cup), 0.05, 0.045, 0, 0.018, 0.018, 0.018, 0, 0, -1.2);
  const top = { shot: C.crema, latte: C.milk, dirty: C.stain, tea: C.tea, stewed: C.stewed }[it.st];
  // (what is in it on the cup's top: its body is solid, a disc under its rim would never show)
  if (top) part(g, cyl(0.041, 0.041, 0.002), M(top), 0, 0.0756, 0);
  if (it.st === 'shot') part(g, cyl(0.03, 0.03, 0.002), M(C.coffee), 0, 0.0768, 0);
  if (it.st === 'latte') {
    part(g, cyl(0.012, 0.012, 0.002, 12), M(C.crema), 0, 0.0772, 0.012);
    if (it.art) for (const [x, z, s] of [[-0.01, -0.006, 0.013], [0.01, -0.006, 0.013], [0, 0.008, 0.009]]) part(g, sph(10), M(C.foam), x, 0.0775, z, s, 0.002, s);
  }
}
function food(g, k, st, y = 0) {
  if (k === 'pizza') { pizza(g, st, y); return; }
  if (k === 'pasta') { pastaNest(g, st, y, true); return; }
  if (k === 'soup') { part(g, cyl(0.072, 0.072, 0.006, 20), M({ burnt: 0x4a1a0a }[st] || C.soup, { r: 0.3 }), 0, y + 0.03, 0); part(g, sph(8), M(0xf6f0e0), 0.02, y + 0.034, 0.01, 0.012, 0.004, 0.012); return; }
  if (k === 'stirfry') { stirfry(g, st, y); return; }
  if (k === 'tacos') { for (const x of [-0.035, 0.035]) tacoShell(g, x, y); return; }
  if (k === 'rice') { part(g, sph(14), M(C.rice, { r: 0.9 }), 0, y + 0.012, 0, 0.055, 0.03, 0.055); return; }
  if (k === 'curry') { part(g, sph(14), M(C.rice, { r: 0.9 }), -0.018, y + 0.012, 0, 0.045, 0.026, 0.05); part(g, cyl(0.05, 0.05, 0.006, 18), M(st === 'burnt' ? 0x4a1a0a : C.curry, { r: 0.3 }), 0.02, y + 0.02, 0.005, 1, 1, 1, 0, 0, 0.12); return; }
  if (k === 'icecream') { for (const [x, z, c] of [[-0.022, 0.012, 0xf6eccf], [0.022, 0.012, 0xf2a8b8], [0, -0.022, 0x5a3420]]) part(g, sph(12), M(c, { r: 0.85 }), x, y + 0.022, z, 0.028, 0.025, 0.028); return; }
  if (k === 'sushi') { for (const x of [-0.04, 0, 0.04]) { part(g, box(), M(C.rice, { r: 0.9 }), x, y + 0.01, 0, 0.03, 0.02, 0.05); part(g, box(), M(C.fish, { r: 0.4 }), x, y + 0.024, 0, 0.034, 0.008, 0.056, 0.1, 0, 0); } return; }
  if (k === 'dough') { naan(g, st, y); return; }
  if (k === 'chicken') { chicken(g, st, y); return; }
  if (k === 'dumplings') { dumplings(g, st, y); return; }
  if (k === 'fries') { fries(g, st, y, false); return; }
  if (k === 'batter') { pancakes(g, st, y); return; }
  if (k === 'avo_toast') { slice(g, 'toasted', y); avoOn(g, y + 0.022); return; }
  if (k === 'croissant') {
    const c = { raw: C.dough, warm: C.gold, burnt: C.burnt }[st] || C.gold;
    part(g, tor(), M(c, { r: 0.7 }), 0, y + 0.025, 0, 0.045, 0.045, 0.06, Math.PI / 2, 0, 0.9);
    return;
  }
  if (k === 'toastie') {
    const c = { raw: C.bread, toasted: C.gold, burnt: C.burnt }[st] || C.gold;
    part(g, box(), M(c), 0, y + 0.012, 0, 0.12, 0.022, 0.11);
    part(g, box(), M(C.tomato), 0, y + 0.027, 0, 0.115, 0.008, 0.105);
    part(g, box(), M(c), 0, y + 0.043, 0, 0.12, 0.022, 0.11, 0, 0.06, 0);
    if (st === 'toasted') for (const x of [-0.03, 0, 0.03]) part(g, box(), M(0x8a5a2a), x, y + 0.055, 0, 0.006, 0.002, 0.1);
  }
}
/** A tall smoothie glass (2026-10-27, "for the smoothies we need glass cups not coffee cups"): empty, a smoothie with its
 *  straw, cola (ice and a straw), orange juice, spilled (over its rim, a puddle round it), or dirty (left down its sides). */
function glass(g, it) {   // (its shell faint and unlit, so the drink in it shows its own colour)
  part(g, cyl(0.046, 0.04, 0.16, 18), M(0xe3f0f5, { a: it.st === 'empty' || it.st === 'dirty' ? 0.4 : 0.2, r: 0.08, e: 0x000000 }), 0, 0.08, 0);
  part(g, cyl(0.041, 0.041, 0.008, 18), M(0xd0e4ec, { a: 0.7, r: 0.1 }), 0, 0.004, 0);   // (its thick base)
  const straw = c => part(g, cyl(0.006, 0.006, 0.14, 6), M(c), 0.015, 0.17, 0, 1, 1, 1, 0, 0, 0.25);
  if (it.st === 'smoothie') { part(g, cyl(0.042, 0.036, 0.125, 18), M(C.pink), 0, 0.07, 0); straw(0x3a7ad9); }
  if (it.st === 'cola') {
    part(g, cyl(0.042, 0.036, 0.13, 18), M(C.cola, { r: 0.2 }), 0, 0.072, 0); straw(0xc0392b);
    for (const [x, z, r] of [[-0.015, 0.01, 0.3], [0.016, -0.008, 1.1], [0.002, 0.018, 2]]) part(g, box(), M(C.ice, { a: 0.75, r: 0.1 }), x, 0.138, z, 0.022, 0.018, 0.022, 0.2, r, 0.1);
  }
  if (it.st === 'beer') { part(g, cyl(0.042, 0.036, 0.12, 18), M(C.beer, { r: 0.25 }), 0, 0.066, 0); part(g, cyl(0.045, 0.043, 0.03, 18), M(C.head, { r: 0.9 }), 0, 0.141, 0); }
  if (it.st === 'juice') { part(g, cyl(0.042, 0.036, 0.13, 18), M(C.juice, { r: 0.3 }), 0, 0.072, 0); part(g, cyl(0.03, 0.03, 0.006, 14), M(C.orange), 0.035, 0.158, 0, 1, 1, 1, 0, 0, 1.2); }
  if (it.st === 'spilled') {
    part(g, cyl(0.046, 0.04, 0.158, 18), M(0x8a5a2a, { a: 0.85 }), 0, 0.08, 0); part(g, cyl(0.048, 0.048, 0.006, 18), M(0xa8723a, { a: 0.8 }), 0, 0.161, 0);
    part(g, cyl(0.075, 0.075, 0.003, 18), M(0x8a5a2a, { a: 0.7, r: 0.1 }), 0.01, 0.0015, 0.01);   // (the puddle)
  }
  if (it.st === 'dirty') part(g, cyl(0.043, 0.038, 0.04, 18), M(0xd98aa0, { a: 0.6 }), 0, 0.03, 0);
  if (it.st === 'pearls' || it.st === 'stewed') {   // (tapioca pearls at its bottom; stewed: the tea gone dark over them)
    for (let n = 0; n < 14; n++) { const a = n * 2.3, r = 0.008 + (n % 3) * 0.011; part(g, sph(8), M(0x2a1a14, { r: 0.2 }), Math.cos(a) * r, 0.014 + (n % 2) * 0.01, Math.sin(a) * r, 0.007, 0.007, 0.007); }
    if (it.st === 'stewed') part(g, cyl(0.042, 0.036, 0.13, 18), M(0x5a3014, { r: 0.25, a: 0.85 }), 0, 0.072, 0);
  }
}
// a wine glass's tulip bowl (turned: widest low, in at the rim) and the wine in it, to the bowl's widest
const lathe = (key, pts) => G(key, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 20));
const BOWL = [[0.005, 0.072], [0.022, 0.078], [0.036, 0.092], [0.042, 0.112], [0.04, 0.13], [0.034, 0.156]];
const WINE = [[0, 0.075], [0.021, 0.08], [0.034, 0.093], [0.039, 0.11], [0, 0.11]];
/** A wine glass: its foot, stem and bowl; red, white, champagne (golden, a ring of fizz and bubbles), or dirty. */
function wineglass(g, it) {
  const shell = M(0xe3f0f5, { a: it.st === 'empty' || it.st === 'dirty' ? 0.4 : 0.2, r: 0.08, e: 0x000000 });
  part(g, cyl(0.034, 0.036, 0.004, 18), shell, 0, 0.002, 0); part(g, cyl(0.005, 0.005, 0.07, 8), shell, 0, 0.039, 0);
  part(g, lathe('wbowl', BOWL), M(0xe3f0f5, { a: it.st === 'empty' || it.st === 'dirty' ? 0.4 : 0.2, r: 0.08, e: 0x000000, two: true }), 0, 0, 0);   // (seen from inside too: it is open)
  const c = { red: C.red, white: C.white, bubbly: C.bubbly }[it.st];
  if (c) part(g, lathe('wine', WINE), M(c, { r: 0.2 }), 0, 0, 0);
  if (it.st === 'bubbly') {
    part(g, cyl(0.039, 0.039, 0.004, 18), M(0xfff8e0, { r: 0.9 }), 0, 0.111, 0);   // (its fizz)
    for (const [x, y, z] of [[0.012, 0.1, 0.02], [-0.016, 0.092, 0.018], [0.006, 0.086, 0.024], [-0.004, 0.104, 0.026]]) part(g, sph(6), M(0xffffff), x, y, z, 0.003, 0.003, 0.003);
  }
  if (it.st === 'dirty') part(g, cyl(0.03, 0.022, 0.01, 18), M(0x8a3a4a, { a: 0.5 }), 0, 0.083, 0);
}
/** A cocktail glass: a wide cone on its stem; empty, a cocktail (a lime wheel on its rim), or dirty. */
function coupe(g, it) {
  const shell = M(0xe3f0f5, { a: it.st === 'empty' || it.st === 'dirty' ? 0.4 : 0.2, r: 0.08, e: 0x000000 });
  part(g, cyl(0.036, 0.038, 0.004, 18), shell, 0, 0.002, 0); part(g, cyl(0.005, 0.005, 0.075, 8), shell, 0, 0.04, 0);
  part(g, cyl(0.058, 0.006, 0.055, 20), shell, 0, 0.105, 0);
  if (it.st === 'cocktail') {
    part(g, cyl(0.05, 0.008, 0.046, 20), M(C.cocktail, { r: 0.2 }), 0, 0.1, 0);
    part(g, cyl(0.018, 0.018, 0.004, 14), M(C.lime, { r: 0.5 }), 0.05, 0.13, 0, 1, 1, 1, Math.PI / 2, 0, 0.3);   // (a lime wheel on the rim)
  }
  if (it.st === 'dirty') part(g, cyl(0.03, 0.008, 0.02, 18), M(0xd98a7a, { a: 0.5 }), 0, 0.088, 0);
}
/** Fries, heaped (on a plate) or in their wire basket: frozen (pale), fried (golden), burnt. */
function fries(g, st, y = 0, basket = true) {
  const c = { frozen: C.frozen, fried: C.fry, burnt: C.burnt }[st] || C.fry, m = M(c, { r: st === 'frozen' ? 0.8 : 0.5 });
  if (basket) {
    part(g, cyl(0.07, 0.06, 0.07, 14), M(C.steel, { m: 0.6, r: 0.35, a: 0.55 }), 0, 0.035, 0); part(g, box(), M(C.black), 0.11, 0.06, 0, 0.09, 0.016, 0.022);
    for (let n = 0; n < 12; n++) { const a = n * 2.4, r = 0.012 + (n % 4) * 0.012; part(g, box(), m, Math.cos(a) * r, y + 0.05 + (n % 3) * 0.012, Math.sin(a) * r, 0.011, 0.075, 0.011, 0.3 * Math.sin(n), a, 0.35 * Math.cos(n)); }
    return;
  }
  for (let n = 0; n < 14; n++) { const a = n * 2.4, r = 0.01 + (n % 5) * 0.012; part(g, box(), m, Math.cos(a) * r, y + 0.012 + (n % 3) * 0.008, Math.sin(a) * r, 0.011, 0.011, 0.075, 0.1 * Math.sin(n), a, 0); }
}
/** Pancakes: batter poured (two pale rounds), a golden stack with butter and syrup, or a burnt stack. */
function pancakes(g, st, y = 0) {
  if (st === 'raw') { for (const [x, z] of [[-0.035, 0], [0.04, 0.012]]) part(g, cyl(0.045, 0.045, 0.008, 18), M(C.batter, { r: 0.85 }), x, y + 0.004, z); return; }
  const c = st === 'burnt' ? C.burnt : C.cake;
  for (let n = 0; n < 3; n++) { part(g, cyl(0.06, 0.06, 0.014, 20), M(c, { r: 0.75 }), 0, y + 0.007 + n * 0.015, 0); part(g, cyl(0.061, 0.061, 0.004, 20), M(st === 'burnt' ? 0x1a0e08 : 0xb07a3a), 0, y + 0.014 + n * 0.015, 0); }
  if (st !== 'burnt') { part(g, box(), M(C.butter, { r: 0.4 }), 0, y + 0.053, 0, 0.022, 0.01, 0.022, 0, 0.5, 0); part(g, cyl(0.045, 0.05, 0.003, 16), M(C.syrup, { r: 0.15, a: 0.85 }), 0.006, y + 0.047, 0.004); }
}
/** A steel milk pitcher, what is in it on its top (cols: by state): cold, steamed (foam), scalded; a scoop of ice cream on it
 *  (for a shake); blended or warm: the blender's jug, the shake in it. */
function pitcher(g, it, cols) {
  if (it.st === 'blended' || it.st === 'warm') { blenderJug(g, cols[it.st]); return; }
  part(g, cyl(0.035, 0.045, 0.1), M(C.steel, { m: 0.6, r: 0.3 }), 0, 0.05, 0);
  part(g, cyl(0.034, 0.034, 0.002), M(cols[it.st] ?? cols.cold), 0, 0.1012, 0);
  part(g, box(), M(C.steel, { m: 0.6, r: 0.3 }), -0.05, 0.06, 0, 0.012, 0.05, 0.012);
  if (it.st === 'shake') { part(g, cyl(0.034, 0.034, 0.002), M(cols.cold), 0, 0.1012, 0); part(g, sph(12), M(0xf6eccf, { r: 0.85 }), 0.004, 0.11, 0, 0.026, 0.02, 0.026); }   // (a scoop of ice cream in it)
}
/** A drink's mix in its glass carafe (col, and what is in it: bits), as the store gives it; blended, warm: the blender's jug. */
function mixJug(g, it, col, bits) {
  if (it.st === 'blended' || it.st === 'warm') { blenderJug(g, it.st === 'warm' ? mixHex(`#${col.toString(16).padStart(6, '0')}`, '#8a7a6a', 0.35) : col); return; }
  part(g, cyl(0.04, 0.044, 0.1, 18), M(0xe3f0f5, { a: 0.4, r: 0.08, e: 0x000000 }), 0, 0.05, 0); part(g, cyl(0.036, 0.04, 0.07, 18), M(col, { r: 0.5 }), 0, 0.037, 0);
  part(g, cyl(0.012, 0.016, 0.02, 12), M(0xe3f0f5, { a: 0.4, r: 0.08, e: 0x000000 }), 0, 0.11, 0);
  bits.forEach((b, n) => part(g, box(), M(b, { r: 0.6 }), (n - 0.5) * 0.024, 0.074, 0.008 * n, 0.014, 0.01, 0.014, 0, n, 0));   // (on its top: what it is made of)
}
/** The blender's jug with a drink blended in it (warm: duller). */
function blenderJug(g, col) {
  part(g, cyl(0.045, 0.035, 0.12), M(0xe3f0f5, { a: 0.45, r: 0.1, e: 0x000000 }), 0, 0.06, 0); part(g, cyl(0.04, 0.032, 0.09), M(col, { r: 0.35 }), 0, 0.048, 0);
  part(g, cyl(0.045, 0.045, 0.004, 18), M(0x6a7078, { r: 0.4 }), 0, 0.122, 0); part(g, cyl(0.03, 0.03, 0.0045, 16), M(0xd8e6ec, { a: 0.5, r: 0.1, e: 0x000000 }), 0, 0.1222, 0); part(g, cyl(0.01, 0.01, 0.008, 10), M(0x6a7078, { r: 0.4 }), 0, 0.128, 0);   // (its lid: a rim, clear in the middle, a cap)
}
/** A pizza: raw (dough, sauce, cheese), baked (golden, bubbled, basil), burnt. */
function pizza(g, st, y = 0) {
  const burnt = st === 'burnt';
  part(g, cyl(0.1, 0.1, 0.014, 22), M(burnt ? C.burnt : st === 'baked' ? C.crustB : C.dough, { r: 0.8 }), 0, y + 0.007, 0);
  part(g, cyl(0.086, 0.086, 0.004, 22), M(burnt ? 0x2a0e06 : C.sauce, { r: 0.5 }), 0, y + 0.016, 0);
  for (const [x, z] of [[0.03, 0.02], [-0.035, 0.01], [0.005, -0.04], [-0.02, 0.045], [0.05, -0.02]]) part(g, cyl(0.018, 0.018, 0.004, 10), M(burnt ? 0x3a2a1a : st === 'baked' ? 0xf6d890 : C.mozz, { r: 0.6 }), x, y + 0.02, z);
  if (st === 'baked') for (const [x, z] of [[0.0, 0.0], [-0.04, -0.03], [0.04, 0.045]]) part(g, sph(6), M(C.basil), x, y + 0.024, z, 0.012, 0.003, 0.008);
}
/** Pasta: dry (a bundle of spaghetti), cooked (a nest of it; on a plate, its sauce), burnt. */
function pastaNest(g, st, y = 0, sauced = false) {
  if (st === 'raw') { for (let n = 0; n < 14; n++) part(g, cyl(0.0025, 0.0025, 0.16, 4), M(C.pasta, { r: 0.4 }), (n % 5 - 2) * 0.006, y + 0.08, (Math.floor(n / 5) - 1) * 0.006, 1, 1, 1, 0.08 * Math.sin(n), 0, 0.08 * Math.cos(n)); return; }
  const c = st === 'burnt' ? C.burnt : C.noodle;
  for (let n = 0; n < 5; n++) part(g, tor(), M(c, { r: 0.5 }), (n % 3 - 1) * 0.012, y + 0.012 + n * 0.006, (n % 2 - 0.5) * 0.014, 0.04 - n * 0.004, 0.04 - n * 0.004, 0.025, Math.PI / 2, 0, n);
  if (sauced && st !== 'burnt') { part(g, sph(10), M(C.sauce, { r: 0.4 }), 0, y + 0.04, 0, 0.03, 0.01, 0.03); part(g, sph(6), M(C.basil), 0.01, y + 0.05, 0, 0.01, 0.003, 0.007); }
}
/** The stir-fry: noodles with a pepper's strips; tossed (glossy, browned), burnt. */
function stirfry(g, st, y = 0) {
  const c = st === 'burnt' ? C.burnt : st === 'tossed' ? C.wokd : C.noodle;
  for (let n = 0; n < 6; n++) part(g, tor(), M(c, { r: st === 'tossed' ? 0.25 : 0.5 }), (n % 3 - 1) * 0.014, y + 0.012 + (n % 3) * 0.006, (n % 2 - 0.5) * 0.016, 0.035, 0.035, 0.02, Math.PI / 2, 0, n * 1.3);
  if (st !== 'burnt') for (const [x, z, r] of [[0.02, 0.01, 0.4], [-0.025, -0.01, 1.4], [0.0, 0.03, 2.2], [0.03, -0.025, 0.9]]) part(g, box(), M(st === 'tossed' ? 0xb8281a : C.pepper, { r: 0.4 }), x, y + 0.032, z, 0.035, 0.006, 0.008, 0, r, 0);
}
/** A saucepan (the stock, the soup in it): its handle, what is in it. */
function saucepan(g, top, bits, chunks = null) {
  part(g, cyl(0.06, 0.055, 0.07, 18), M(C.steel, { m: 0.6, r: 0.3 }), 0, 0.035, 0); part(g, box(), M(C.black), 0.1, 0.06, 0, 0.08, 0.014, 0.02);
  part(g, cyl(0.056, 0.056, 0.002, 18), M(top, { r: 0.3 }), 0, 0.0712, 0);   // (on the pan's top: its body is solid)
  for (const [x, z] of bits || []) part(g, box(), M(C.tomato), x, 0.0735, z, 0.014, 0.004, 0.014);
  if (chunks?.length) [[0.025, -0.02], [-0.028, 0.012], [0.008, 0.03], [-0.01, -0.03]].forEach(([x, z], n) => part(g, sph(8), M(new THREE.Color(...hexL(chunks[n % chunks.length])).getHex(), { r: 0.5 }), x, 0.0725, z, 0.011, 0.005, 0.011));   // (what is in it)
}
/** Naan: a teardrop of bread, its char; burnt. */
function naan(g, st, y = 0) {
  part(g, sph(16), M(st === 'burnt' ? C.burnt : C.naan, { r: 0.8 }), 0, y + 0.006, 0, 0.09, 0.012, 0.06, 0, 0.4, 0);
  if (st !== 'burnt') for (const [x, z] of [[0.02, 0.01], [-0.03, -0.01], [0.04, -0.015], [-0.005, 0.025], [-0.045, 0.015]]) part(g, sph(6), M(C.char), x, y + 0.016, z, 0.008, 0.003, 0.008);
}
/** Chicken: raw (pink), tandoori (red, charred), grilled (golden, its grill marks), fried (a katsu cutlet, breaded, sliced),
 *  burnt. */
function chicken(g, st, y = 0) {
  if (st === 'fried') {   // (breaded, golden, cut in strips that lean a little apart)
    for (let n = 0; n < 5; n++) { const x = (n - 2) * 0.024; part(g, box(), M(0xd99a3e, { r: 0.85 }), x, y + 0.013, 0, 0.021, 0.022, 0.085, 0, 0, (n - 2) * 0.04); part(g, box(), M(0xf3e6d0, { r: 0.7 }), x, y + 0.013, 0, 0.016, 0.014, 0.086, 0, 0, (n - 2) * 0.04); }
    for (let n = 0; n < 14; n++) part(g, box(), M(0xb8742a, { r: 0.9 }), ((n * 37) % 11 - 5) * 0.01, y + 0.025, ((n * 53) % 13 - 6) * 0.0065, 0.004, 0.003, 0.004, 0, n, 0);   // (its crumb)
    return;
  }
  if (st === 'grilled') {
    for (const [x, z, r] of [[-0.03, 0, 0.4], [0.025, 0.015, -0.3], [0.01, -0.03, 1.2]]) { part(g, sph(12), M(0xc8823e, { r: 0.55 }), x, y + 0.016, z, 0.035, 0.018, 0.022, 0, r, 0); for (const d of [-0.012, 0.012]) part(g, box(), M(0x4a2410), x + d, y + 0.0335, z, 0.004, 0.001, 0.03, 0, r + 0.6, 0); }
    return;
  }
  const c = { raw: C.chickenRaw, baked: C.tandoori, burnt: C.burnt }[st] || C.tandoori;
  for (const [x, z, r] of [[-0.03, 0, 0.4], [0.025, 0.015, -0.3], [0.01, -0.03, 1.2]]) { part(g, sph(12), M(c, { r: 0.6 }), x, y + 0.016, z, 0.035, 0.018, 0.022, 0, r, 0); if (st === 'baked') part(g, sph(6), M(C.char), x + 0.01, y + 0.03, z, 0.01, 0.004, 0.008); }
}
/** Dumplings: raw (pale, pleated), steamed (glossy), soggy (grey). */
function dumplings(g, st, y = 0) {
  const c = { raw: 0xf3ecdc, steamed: 0xfaf6ec, soggy: 0xb8b4a8 }[st] || 0xfaf6ec;
  for (const [x, z] of [[-0.03, -0.02], [0.03, -0.02], [-0.03, 0.025], [0.03, 0.025]]) { part(g, sph(12), M(c, { r: st === 'steamed' ? 0.3 : 0.8 }), x, y + 0.012, z, 0.026, 0.02, 0.022); part(g, box(), M(c, { r: 0.7 }), x, y + 0.03, z, 0.004, 0.01, 0.03); }
}
/** A taco: a warm tortilla folded over its filling. */
function tacoShell(g, x, y) {
  const shell = G('taco', () => new THREE.CylinderGeometry(0.03, 0.03, 0.09, 16, 1, false, Math.PI / 2, Math.PI));   // (a half round: its fold down)
  part(g, shell, M(0xe8c890, { r: 0.8, two: true }), x, y + 0.03, 0, 1, 1, 1, -Math.PI / 2, 0, 0);   // (seen from inside too: it is open)
  part(g, box(), M(0x7a4b2a, { r: 0.6 }), x, y + 0.024, 0, 0.034, 0.012, 0.08);   // (its filling, in the fold)
  part(g, box(), M(C.tomato, { r: 0.5 }), x - 0.006, y + 0.031, 0, 0.012, 0.006, 0.07); part(g, box(), M(C.lettuce, { r: 0.6 }), x + 0.007, y + 0.032, 0.004, 0.012, 0.006, 0.066);
}
/** A slice of bread: plain, toasted or burnt. */
function slice(g, st, y = 0) {
  const c = { toasted: C.toast, burnt: C.burnt }[st] || C.bread;
  part(g, box(), M(c), 0, y + 0.011, 0, 0.11, 0.02, 0.1); part(g, box(), M(st === 'burnt' ? 0x140a06 : C.crust), 0, y + 0.011, 0.051, 0.11, 0.021, 0.006);
}
/** Avocado on toast: green slices fanned, a pinch of chilli. */
function avoOn(g, y) {
  for (const x of [-0.03, -0.01, 0.01, 0.03]) part(g, sph(10), M(C.avo, { r: 0.6 }), x, y + 0.004, 0, 0.012, 0.006, 0.04, 0, 0.15, 0);
  for (const [x, z] of [[-0.02, 0.02], [0.015, -0.02], [0.03, 0.015]]) part(g, box(), M(0xc0392b), x, y + 0.01, z, 0.005, 0.002, 0.005);
}
const MAKE = {
  cup, glass, wineglass, coupe,
  plate(g, it) {
    part(g, cyl(0.12, 0.1, 0.014, 20), M(C.cup), 0, 0.007, 0);
    if (it.st === 'dirty') for (const [x, z] of [[0.03, 0.02], [-0.04, -0.01]]) part(g, cyl(0.025, 0.025, 0.002, 8), M(C.stain), x, 0.015, z);
    if (it.on) food(g, it.on, it.onSt || (it.burnt ? 'burnt' : it.on === 'croissant' ? 'warm' : 'toasted'), 0.014);
  },
  grounds(g) {
    part(g, cyl(0.045, 0.04, 0.03), M(C.steel, { m: 0.6, r: 0.3 }), 0, 0.015, 0);
    part(g, cyl(0.04, 0.04, 0.004), M(0x4a2a18), 0, 0.031, 0);
    part(g, box(), M(C.black), 0.09, 0.02, 0, 0.1, 0.02, 0.025);
  },
  milk: (g, it) => pitcher(g, it, { cold: C.milk, steamed: C.foam, scalded: 0xd9b98a, blended: 0xf4ecdc, warm: 0xe0d2b4 }),
  chocmilk: (g, it) => pitcher(g, it, { cold: 0x8a5a3a, steamed: 0xb88a68, scalded: 0x5a3420, blended: 0x7a4a2e, warm: 0x6a4a36 }),
  matchamilk: (g, it) => pitcher(g, it, { cold: 0xa8c87a, steamed: 0xcfe0b0, scalded: 0x8a9a5a }),
  croissant: (g, it) => food(g, 'croissant', it.st),
  toastie: (g, it) => food(g, 'toastie', it.st),
  bread(g, it) {
    if (it.st === 'toasted' || it.st === 'burnt') { slice(g, it.st); return; }   // (out of the toaster: one slice)
    for (const [y, r] of [[0.012, 0], [0.036, 0.25]]) { part(g, box(), M(C.bread), 0, y, 0, 0.11, 0.02, 0.1, 0, r, 0); part(g, box(), M(C.crust), 0, y, 0.051, 0.11, 0.021, 0.006, 0, r, 0); }
  },
  fries: (g, it) => fries(g, it.st),
  batter: (g, it) => pancakes(g, it.st),
  patty(g, it) {
    const c = { raw: C.raw, grilled: C.patty, burnt: C.burnt }[it.st] || C.patty;
    part(g, cyl(0.055, 0.055, 0.022, 18), M(c, { r: 0.8 }), 0, 0.011, 0);
    if (it.st === 'grilled') for (const z of [-0.025, 0, 0.025]) part(g, box(), M(0x2a1810), 0, 0.023, z, 0.09, 0.002, 0.008);
  },
  bun(g) {
    part(g, cyl(0.06, 0.062, 0.022, 18), M(C.bun), 0, 0.011, 0);
    part(g, sph(14), M(C.bun, { r: 0.5 }), 0.03, 0.03, 0.03, 0.06, 0.03, 0.06);   // (its top, beside it)
    for (const [x, z] of [[0.02, 0.02], [0.045, 0.035], [0.03, 0.055], [0.01, 0.045]]) part(g, sph(6), M(0xf6eedc), x, 0.058, z, 0.005, 0.003, 0.008);
  },
  burger(g) {   // (in its wrap)
    part(g, box(), M(C.paper, { r: 0.9 }), 0, 0.002, 0, 0.16, 0.004, 0.16, 0, 0.6, 0);
    part(g, cyl(0.06, 0.062, 0.02, 18), M(C.bun), 0, 0.014, 0);
    part(g, cyl(0.066, 0.066, 0.006, 16), M(C.lettuce, { r: 0.7 }), 0, 0.027, 0);
    part(g, cyl(0.058, 0.058, 0.02, 18), M(C.patty, { r: 0.8 }), 0, 0.04, 0);
    part(g, box(), M(C.cheese, { r: 0.4 }), 0, 0.052, 0, 0.1, 0.004, 0.1, 0, 0.78, 0);
    part(g, sph(14), M(C.bun, { r: 0.5 }), 0, 0.056, 0, 0.062, 0.035, 0.062);
    for (const [x, z] of [[0.01, 0.02], [-0.02, -0.01], [0.025, -0.02], [-0.015, 0.03]]) part(g, sph(6), M(0xf6eedc), x, 0.09, z, 0.005, 0.003, 0.008);
  },
  orange(g) { part(g, sph(14), M(C.orange, { r: 0.6 }), 0, 0.04, 0, 0.042, 0.04, 0.042); part(g, sph(6), M(C.leaf), 0, 0.08, 0, 0.012, 0.005, 0.016); },
  avocado(g, it) {
    if (it.st === 'chopped') {   // (halved, the stone out, sliced)
      part(g, box(), M(0x8a6034), 0, 0.005, 0, 0.14, 0.01, 0.09);   // (on its board)
      for (const x of [-0.04, -0.02, 0, 0.02, 0.04]) part(g, sph(10), M(C.avo, { r: 0.6 }), x, 0.016, 0, 0.011, 0.008, 0.035);
      return;
    }
    part(g, sph(14), M(C.avoSkin, { r: 0.75 }), 0, 0.045, 0, 0.038, 0.048, 0.034, 0.25, 0, 0.2);
  },
  avo_toast(g) { slice(g, 'toasted'); avoOn(g, 0.022); },
  bowl(g, it) {   // (a deep bowl: clean, dirty, with soup or a stir-fry)
    part(g, cyl(0.085, 0.05, 0.06, 20), M(C.cup), 0, 0.03, 0);
    part(g, cyl(0.078, 0.078, 0.003, 20), M(it.st === 'dirty' ? C.stain : 0xeceae2), 0, 0.058, 0);
    if (it.on) food(g, it.on, it.onSt || 'cooked', 0.03);   // (soup, a stir-fry, rice, curry over it, ice cream)
  },
  dough(g, it) { if (it.st === 'baked' || it.st === 'burnt') { naan(g, it.st); return; } part(g, sph(14), M(C.dough, { r: 0.85 }), 0, 0.02, 0, 0.07, 0.025, 0.07); },   // (baked in the tandoor: naan)
  curry: (g, it) => saucepan(g, it.st === 'raw' ? 0xe0a050 : it.st === 'burnt' ? 0x4a1a0a : C.curry),
  fish(g, it) {
    if (it.st === 'fried' || it.st === 'burnt') {   // (battered: a golden, puffed fillet, its batter bubbled)
      const c = it.st === 'burnt' ? C.burnt : 0xe2aa4c;
      part(g, sph(16), M(c, { r: 0.75 }), 0, 0.02, 0, 0.075, 0.022, 0.036, 0, 0.15, 0); part(g, sph(12), M(c, { r: 0.75 }), 0.06, 0.016, -0.008, 0.03, 0.016, 0.024, 0, 0.4, 0);
      if (it.st === 'fried') for (let n = 0; n < 9; n++) part(g, sph(6), M(0xf0c26a, { r: 0.8 }), ((n * 29) % 9 - 4) * 0.014, 0.038, ((n * 17) % 5 - 2) * 0.008, 0.008, 0.004, 0.007);
      return;
    }
    if (it.st === 'chopped') { for (let n = 0; n < 5; n++) { part(g, box(), M(C.fish, { r: 0.4 }), (n - 2) * 0.022, 0.006, 0, 0.018, 0.012, 0.07, 0, 0.1, 0); part(g, box(), M(C.fishFat), (n - 2) * 0.022, 0.0125, 0, 0.004, 0.001, 0.06); } return; }
    part(g, box(), M(C.fish, { r: 0.4 }), 0, 0.012, 0, 0.12, 0.024, 0.07); for (const x of [-0.035, 0, 0.035]) part(g, box(), M(C.fishFat), x, 0.0245, 0, 0.004, 0.001, 0.06, 0, 0.4, 0);
  },
  chicken: (g, it) => chicken(g, it.st),
  dumplings: (g, it) => dumplings(g, it.st),
  pizza: (g, it) => pizza(g, it.st),
  pasta: (g, it) => pastaNest(g, it.st),
  noodles(g) { for (let n = 0; n < 4; n++) part(g, tor(), M(C.noodle, { r: 0.5 }), (n % 2 - 0.5) * 0.02, 0.01 + n * 0.006, 0, 0.035, 0.035, 0.02, Math.PI / 2, 0, n); },
  stirfry: (g, it) => stirfry(g, it.st),
  stock: g => saucepan(g, C.broth),
  soup: (g, it) => saucepan(g, it.st === 'raw' ? C.broth : it.st === 'burnt' ? 0x4a1a0a : C.soup, it.st === 'raw' ? [[0.02, 0.01], [-0.02, -0.015], [0.0, -0.025]] : null),
  kernels(g, it) {   // (a scoop of kernels; popped: its striped bag heaped full; burnt: dark)
    if (it.st === 'raw') { part(g, cyl(0.045, 0.035, 0.05, 16), M(C.steel, { m: 0.5, r: 0.35 }), 0, 0.025, 0); part(g, cyl(0.042, 0.042, 0.003, 16), M(C.corn, { r: 0.7 }), 0, 0.0515, 0); return; }
    part(g, cyl(0.05, 0.038, 0.11, 16), M(0xf6f4ef, { r: 0.8 }), 0, 0.055, 0);
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; part(g, box(), M(0xc0241e, { r: 0.7 }), Math.cos(a) * 0.045, 0.055, Math.sin(a) * 0.045, 0.016, 0.108, 0.004, 0, Math.PI / 2 - a, 0); }
    for (let k = 0; k < 16; k++) { const a = k * 2.4, r = 0.012 + (k % 4) * 0.011; part(g, sph(6), M(it.st === 'burnt' ? 0x3a2a1a : k % 5 ? C.pop : C.corn, { r: 0.85 }), Math.cos(a) * r, 0.112 + (3 - (k % 4)) * 0.008, Math.sin(a) * r, 0.014, 0.012, 0.014); }
  },
  sausage(g, it) {
    const c = { raw: C.sausageRaw, grilled: C.sausage, burnt: C.burnt }[it.st] || C.sausage;
    part(g, cyl(0.014, 0.014, 0.11, 12), M(c, { r: 0.5 }), 0, 0.016, 0, 1, 1, 1, Math.PI / 2, 0, 0); for (const z of [-0.055, 0.055]) part(g, sph(8), M(c, { r: 0.5 }), 0, 0.016, z, 0.014, 0.014, 0.014);
    if (it.st === 'grilled') for (const z of [-0.03, 0, 0.03]) part(g, box(), M(0x3a1a0a), 0, 0.03, z, 0.02, 0.002, 0.005);
  },
  hotdog(g) {   // (in its paper tray)
    part(g, box(), M(C.paper, { r: 0.9 }), 0, 0.006, 0, 0.07, 0.012, 0.15);
    for (const x of [-0.016, 0.016]) part(g, cyl(0.02, 0.02, 0.13, 12), M(C.bun, { r: 0.6 }), x, 0.026, 0, 1, 1, 1, Math.PI / 2, 0, 0);
    part(g, cyl(0.014, 0.014, 0.14, 12), M(C.sausage, { r: 0.45 }), 0, 0.04, 0, 1, 1, 1, Math.PI / 2, 0, 0);
    for (let k = 0; k < 5; k++) part(g, box(), M(C.mustard, { r: 0.4 }), (k % 2 ? 0.007 : -0.007), 0.054, -0.05 + k * 0.025, 0.018, 0.003, 0.006, 0, k % 2 ? 0.7 : -0.7, 0);
  },
  tortilla(g, it) {
    part(g, cyl(0.06, 0.06, 0.004, 20), M({ raw: C.tortilla, cooked: 0xe8c890, burnt: C.burnt }[it.st] || C.tortilla, { r: 0.85 }), 0, 0.002, 0);
    if (it.st === 'cooked') for (const [x, z] of [[0.02, 0.01], [-0.025, -0.015], [0.005, -0.03], [-0.01, 0.03]]) part(g, cyl(0.008, 0.008, 0.001, 8), M(0xa86a2a), x, 0.0045, z);
  },
  tacos(g) { for (const x of [-0.035, 0.035]) tacoShell(g, x, 0); },
  water(g) {   // (a bottle: clear, its blue cap and label)
    part(g, cyl(0.026, 0.028, 0.14, 14), M(0xdceef8, { a: 0.55, r: 0.1, e: 0x000000 }), 0, 0.07, 0); part(g, cyl(0.012, 0.022, 0.03, 12), M(0xdceef8, { a: 0.55, r: 0.1, e: 0x000000 }), 0, 0.155, 0);
    part(g, cyl(0.013, 0.013, 0.014, 12), M(0x2a6ad9), 0, 0.177, 0); part(g, cyl(0.0285, 0.0285, 0.04, 14), M(0x3a8ad9, { r: 0.6 }), 0, 0.07, 0);
  },
  baguette(g) {   // (a baguette, its end cut, three slices from it lying fanned beside it)
    const crust = M(0xc98a42, { r: 0.7 }), crumb = M(0xf0dcb0, { r: 0.85 });
    part(g, cyl(0.022, 0.022, 0.14, 14), crust, -0.03, 0.022, 0, 1, 1, 1, 0, 0, Math.PI / 2);
    part(g, sph(10), crust, -0.1, 0.022, 0, 0.014, 0.021, 0.021);   // (its round end)
    part(g, cyl(0.02, 0.02, 0.002, 14), crumb, 0.0405, 0.022, 0, 1, 1, 1, 0, 0, Math.PI / 2);   // (its cut end)
    for (let n = 0; n < 3; n++) {
      const x = 0.078 + n * 0.006, y = 0.004 + n * 0.0055, z = -0.026 + n * 0.022;
      part(g, cyl(0.02, 0.02, 0.006, 14), crust, x, y, z, 1, 1, 1, 0.12, 0, 0); part(g, cyl(0.0175, 0.0175, 0.0065, 14), crumb, x, y + 0.0004, z, 1, 1, 1, 0.12, 0, 0);
    }
    for (let n = 0; n < 4; n++) part(g, box(), M(0xa8662c), -0.075 + n * 0.028, 0.044, 0, 0.012, 0.002, 0.03, 0, 0.6, 0);   // (its scores)
  },
  chips(g, it) {   // (tortilla chips, a heap: raw, pale; fried, golden)
    const c = { raw: 0xf0e2b8, fried: 0xe8b84a, burnt: C.burnt }[it.st] || 0xe8b84a;
    for (let n = 0; n < 16; n++) { const a = n * 2.4, r = 0.008 + (n % 5) * 0.011; part(g, box(), M(c, { r: 0.6 }), Math.cos(a) * r, 0.006 + (n % 4) * 0.006, Math.sin(a) * r, 0.034, 0.003, 0.03, 0.25 * Math.sin(n), a, 0.25 * Math.cos(n)); }
  },
  fudge(g) {   // (hot fudge in its jug, a spoon in it)
    part(g, cyl(0.04, 0.034, 0.05, 16), M(0xf6f4ef, { r: 0.4 }), 0, 0.025, 0); part(g, cyl(0.037, 0.037, 0.002, 16), M(0x3a1a0c, { r: 0.15 }), 0, 0.0505, 0);
    part(g, box(), M(C.steel, { m: 0.6, r: 0.3 }), 0.02, 0.07, 0, 0.006, 0.06, 0.012, 0, 0, -0.5);
  },
  banana(g, it) {
    if (it.st === 'chopped') {   // (sliced, on its little board)
      part(g, box(), M(0xb98a57, { r: 0.8 }), 0, 0.005, 0, 0.15, 0.01, 0.07);
      for (let n = 0; n < 7; n++) { const x = (n - 3) * 0.019; part(g, cyl(0.0155, 0.0155, 0.007, 16), M(0xf6ecc0, { r: 0.6 }), x, 0.0135, (n % 2) * 0.006 - 0.003, 1, 1, 1, 0.12 * (n % 3 - 1), 0, 0.1); part(g, cyl(0.004, 0.004, 0.0072, 6), M(0xd8c88a), x, 0.0136, (n % 2) * 0.006 - 0.003); }
      return;
    }
    const yel = M(0xf2d03a, { r: 0.45 });   // (its curve: tapering beads along an arc, its stem, its tip)
    for (let n = 0; n <= 28; n++) { const t = n / 28, a = -1.1 + t * 2.2, r = 0.008 + 0.0085 * Math.sin(t * Math.PI); part(g, sph(10), yel, Math.sin(a) * 0.06, 0.012 + r * 0.6, (1 - Math.cos(a)) * 0.05 - 0.02, r, r * 0.88, r); }   // (beads close enough to read as one fruit)
    part(g, cyl(0.004, 0.005, 0.018, 6), M(0x6a5a2a), Math.sin(-1.18) * 0.064, 0.02, (1 - Math.cos(-1.18)) * 0.05 - 0.016, 1, 1, 1, 0, 0, 1.2);
    part(g, sph(6), M(0x3a2a1a), Math.sin(1.12) * 0.062, 0.018, (1 - Math.cos(1.12)) * 0.05 - 0.02, 0.005, 0.005, 0.005);
  },
  pepper(g, it) {
    if (it.st === 'chopped') { for (let n = 0; n < 6; n++) part(g, box(), M(C.pepper, { r: 0.4 }), (n - 2.5) * 0.016, 0.006, (n % 2) * 0.01, 0.01, 0.008, 0.05, 0, 0.2 * (n % 3), 0); return; }
    part(g, sph(14), M(C.pepper, { r: 0.3 }), 0, 0.04, 0, 0.042, 0.045, 0.042); part(g, cyl(0.006, 0.008, 0.02, 8), M(C.leaf), 0, 0.09, 0);
  },
  tomato(g, it) {
    if (it.st === 'chopped') { for (const x of [-0.04, -0.013, 0.013, 0.04]) part(g, cyl(0.026, 0.026, 0.01, 12), M(C.tomato), x, 0.006, 0, 1, 1, 1, 0, 0, 0.2); return; }
    part(g, sph(12), M(C.tomato, { r: 0.35 }), 0, 0.04, 0, 0.042, 0.038, 0.042); part(g, sph(6), M(C.leaf), 0, 0.078, 0, 0.015, 0.006, 0.015);
  },
  berries(g, it) {
    if (it.st === 'whole') {
      part(g, cyl(0.06, 0.04, 0.03), M(0xe8e6df), 0, 0.015, 0);
      for (let n = 0; n < 7; n++) { const a = n * 0.9; part(g, sph(8), M(n % 3 ? C.berry : 0xc0392b), Math.cos(a) * 0.028 * (n % 2 + 0.4), 0.035, Math.sin(a) * 0.028 * (n % 2 + 0.4), 0.017, 0.017, 0.017); }
      return;
    }
    part(g, cyl(0.045, 0.035, 0.12), M(0xe3f0f5, { a: 0.45, r: 0.1 }), 0, 0.06, 0); part(g, cyl(0.04, 0.032, 0.09), M(it.st === 'warm' ? 0xc96a7a : C.pink), 0, 0.048, 0);
  },
  // the drinks' (2026-10-28)
  lemon(g) {   // (an oval, its two little points, a leaf)
    const y = M(0xf2d93a, { r: 0.5 }); part(g, sph(16), y, 0, 0.032, 0, 0.044, 0.031, 0.031);
    for (const x of [-1, 1]) part(g, cyl(0.002, 0.008, 0.01, 10), y, x * 0.046, 0.032, 0, 1, 1, 1, 0, 0, -x * Math.PI / 2);   // (narrow end out)
    part(g, sph(6), M(C.leaf), -0.01, 0.062, 0.006, 0.016, 0.004, 0.009, 0, 0.5, 0.2);
  },
  apple(g) { part(g, sph(14), M(0xc8281e, { r: 0.4 }), 0, 0.038, 0, 0.042, 0.038, 0.042); part(g, cyl(0.002, 0.003, 0.02, 6), M(0x5a3a1a), 0, 0.08, 0, 1, 1, 1, 0, 0, 0.2); part(g, sph(6), M(C.leaf), 0.012, 0.084, 0, 0.014, 0.004, 0.008, 0, 0.3, 0.3); },
  ice(g, it) {   // (a glass of ice cubes from the fridge; bitter: the shot over it left too long)
    part(g, cyl(0.046, 0.04, 0.13, 18), M(0xe3f0f5, { a: 0.35, r: 0.08, e: 0x000000 }), 0, 0.065, 0); part(g, cyl(0.041, 0.041, 0.008, 18), M(0xd0e4ec, { a: 0.7, r: 0.1 }), 0, 0.004, 0);
    if (it.st === 'bitter') part(g, cyl(0.042, 0.036, 0.1, 18), M(0x2a160a, { r: 0.2 }), 0, 0.055, 0);
    for (let n = 0; n < 9; n++) part(g, box(), M(C.ice, { a: 0.8, r: 0.1 }), ((n % 3) - 1) * 0.022, 0.02 + Math.floor(n / 3) * 0.03, ((n * 7) % 3 - 1) * 0.016, 0.022, 0.02, 0.022, 0.2 * n, 0.5 * n, 0.1);
  },
  pearls(g) {   // (a tub of tapioca pearls, cooked)
    part(g, cyl(0.05, 0.042, 0.05, 18), M(0xf3f1ea, { r: 0.6 }), 0, 0.025, 0); part(g, cyl(0.047, 0.047, 0.003, 18), M(0x3a2418, { r: 0.3 }), 0, 0.0515, 0);
    for (let n = 0; n < 16; n++) { const a = n * 2.4, r = 0.006 + (n % 4) * 0.011; part(g, sph(8), M(0x241410, { r: 0.15 }), Math.cos(a) * r, 0.054, Math.sin(a) * r, 0.0075, 0.0075, 0.0075); }
  },
  togo(g, it) {   // (a paper cup to go: its sleeve and lid; bitter: coffee down its side)
    part(g, cyl(0.042, 0.032, 0.12, 18), M(0xf3ede0, { r: 0.85 }), 0, 0.06, 0); part(g, cyl(0.04, 0.036, 0.04, 18), M(0xa8784a, { r: 0.9 }), 0, 0.06, 0);
    part(g, cyl(0.045, 0.044, 0.012, 18), M(0xf6f4ef, { r: 0.5 }), 0, 0.125, 0); part(g, cyl(0.04, 0.042, 0.006, 18), M(0xf6f4ef, { r: 0.5 }), 0, 0.134, 0);
    if (it.st === 'bitter') part(g, box(), M(0x3a1a0a, { r: 0.3 }), 0.04, 0.1, 0, 0.004, 0.04, 0.012);
  },
  frappe: (g, it) => mixJug(g, it, 0xc8a07a, [0x5a3420, 0xf6f0e4]),
  lassi: (g, it) => mixJug(g, it, 0xf2b84a, [0xf6f0e0, 0xe89a2a]),
  horchata: (g, it) => mixJug(g, it, 0xf4ecd8, [0xb8864a, 0xf8f4ea]),
  shaker(g, it) {   // (a steel shaker, frosted once shaken; blended with ice: the blender's jug, a piña colada in it)
    if (it.st === 'blended' || it.st === 'warm') { blenderJug(g, it.st === 'warm' ? 0xd8c890 : 0xf6eab0); return; }
    const m = M(it.st === 'shaken' ? 0xe6eef2 : C.steel, { m: 0.65, r: it.st === 'shaken' ? 0.55 : 0.3 });
    part(g, cyl(0.04, 0.032, 0.11, 16), m, 0, 0.055, 0); part(g, cyl(0.03, 0.04, 0.04, 16), m, 0, 0.13, 0); part(g, cyl(0.014, 0.03, 0.03, 12), m, 0, 0.165, 0);
    part(g, cyl(0.016, 0.016, 0.012, 12), M(C.steel, { m: 0.6, r: 0.3 }), 0, 0.186, 0);
  },
  // the parts of the breakfasts, the platters and the wraps (2026-10-28)
  egg(g, it) {   // (raw: an egg in its cup; fried: sunny side up, its edge crisp; poached: a soft white mound; burnt)
    if (it.st === 'raw') {
      part(g, cyl(0.022, 0.016, 0.026, 14), M(C.steel, { m: 0.5, r: 0.35 }), 0, 0.013, 0); part(g, cyl(0.012, 0.016, 0.006, 12), M(C.steel, { m: 0.5, r: 0.35 }), 0, 0.003, 0);
      part(g, sph(16), M(0xf2e2c4, { r: 0.6 }), 0, 0.045, 0, 0.024, 0.032, 0.024); return;
    }
    if (it.st === 'poached') {
      part(g, sph(16), M(0xf7f3e8, { r: 0.45 }), 0, 0.012, 0, 0.04, 0.026, 0.036);
      part(g, sph(12), M(0xf4cf72, { r: 0.4, a: 0.85 }), 0.004, 0.026, -0.004, 0.016, 0.012, 0.015); return;   // (the yolk showing through)
    }
    const burnt = it.st === 'burnt';
    part(g, cyl(0.06, 0.06, 0.002, 20), M(burnt ? 0x1e140c : 0xd9a050, { r: 0.8 }), 0.004, 0.001, 0.002);   // (its crisp edge)
    part(g, cyl(0.056, 0.056, 0.005, 20), M(burnt ? C.burnt : 0xfbf8ee, { r: 0.4 }), 0, 0.0035, 0, 1, 1, 0.86);
    part(g, cyl(0.036, 0.036, 0.004, 16), M(burnt ? C.burnt : 0xfbf8ee, { r: 0.4 }), 0.03, 0.004, 0.02);
    part(g, sph(14), M(burnt ? 0x3a2410 : 0xf5ad1a, { r: 0.25 }), -0.008, 0.007, -0.004, 0.019, 0.011, 0.019);   // (the yolk)
  },
  bacon(g, it) {   // (three rashers: raw pink with its fat, crisp and rippled, burnt)
    const lean = { raw: 0xe58a84, crisp: 0xa4442a, burnt: C.burnt }[it.st] || 0xa4442a, fat = { raw: 0xf6e4da, crisp: 0xe4b47a, burnt: 0x2a1a10 }[it.st] || 0xe4b47a;
    for (let r = 0; r < 3; r++) for (let n = 0; n < 12; n++) {   // (short overlapping pieces along each rasher: crisp, it ripples)
      const a = n * 0.95 + r * 1.3, x = (r - 1) * 0.034, z = (n - 5.5) * 0.0095, y = 0.006 + (it.st === 'raw' ? 0.001 : 0.004 * Math.sin(a)), tilt = it.st === 'raw' ? 0 : 0.42 * Math.cos(a);
      part(g, box(), M(lean, { r: 0.6 }), x - 0.004, y, z, 0.018, 0.004, 0.0135, tilt, 0, 0); part(g, box(), M(fat, { r: 0.7 }), x + 0.0095, y, z, 0.009, 0.0041, 0.0135, tilt, 0, 0);
    }
  },
  beans(g, it) {   // (dried: a scoop of them; cooked in their saucepan; burnt)
    if (it.st === 'raw') {
      part(g, cyl(0.045, 0.035, 0.05, 16), M(C.steel, { m: 0.5, r: 0.35 }), 0, 0.025, 0); part(g, cyl(0.042, 0.042, 0.003, 16), M(0xb88a5a, { r: 0.8 }), 0, 0.0515, 0);
      for (let n = 0; n < 9; n++) { const a = n * 2.4, r = 0.006 + (n % 3) * 0.011; part(g, sph(8), M(n % 3 ? 0xc89a6a : 0x8a4a2a, { r: 0.6 }), Math.cos(a) * r, 0.055, Math.sin(a) * r, 0.007, 0.005, 0.01, 0, a, 0); }
      return;
    }
    saucepan(g, it.st === 'burnt' ? 0x3a1a0a : 0x7a3a1c, null, it.st === 'burnt' ? null : ['#5a2412', '#9a5a2a', '#d8b48a']);
  },
  pita(g, it) {   // (a round of it: raw, pale; warmed, golden, a few toasted spots, puffed; burnt)
    const c = { raw: 0xf0dcb0, warm: 0xe2b36a, burnt: C.burnt }[it.st] || 0xe2b36a;
    part(g, sph(20), M(c, { r: 0.8 }), 0, 0.005, 0, 0.062, it.st === 'warm' ? 0.012 : 0.006, 0.062);
    if (it.st === 'warm') for (const [x, z] of [[0.022, 0.012], [-0.026, -0.016], [0.004, -0.032], [-0.012, 0.03], [0.036, -0.02]]) part(g, cyl(0.007, 0.007, 0.001, 8), M(0x9a5a22), x, 0.0165, z);
  },
};

// ------------------------------------------------------------------------------------------------ the menu's dishes
// (2026-10-28, the product owner: "make all the ones that are pending, make sure the assets for each state looks really
// good, take your time with the details"): a dish of the menu is drawn from the world's own model of it
// (render/food-models.js), the one residents are served: as served, on its plate, in its bowl, on its board; done, the food
// alone as it comes out of the machine; raw and burnt, that same food with its browned colours turned (dough, raw meat,
// a pale fry, a shell; charred); a pot dish in its saucepan, its colour the dish's; a salad or a sandwich to prepare, its
// makings on a board. What each kind looks like: its template's looks (shared/orderup/kitchens.js).
const LOOKS = () => kitchenOf(DEFAULT_KITCHEN).looks || {};
let FMAT = null;
const fmats = () => FMAT || (FMAT = [makeFurnMat({ lit: true, indoor: true }), makeFurnMat({ glass: true })]);
const toS = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const toL = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hexL = h => { const n = parseInt(h.slice(1), 16); return [toL(((n >> 16) & 255) / 255), toL(((n >> 8) & 255) / 255), toL((n & 255) / 255)]; };
function hsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 1e-6) return [0, 0, l];
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, d / (1 - Math.abs(2 * l - 1)), l];
}
/** A colour that cooking browned (a crust, a sear, a fry, a toast): golden to dark brown, or near black. */
// (by family: a crust from golden to brown, not a tomato's red; meat and fish brown from redder; a shell is red cooked)
const HUES = { meat: [6, 56], fish: [6, 56], shell: [0, 40] };
const browned = (h, s, l, fam = 'dough') => { const [h0, h1] = HUES[fam] || [15, 56]; return (l < 0.2 && h < 70 && s >= 0.15) || (h >= h0 && h <= h1 && s > (fam === 'shell' ? 0.3 : 0.16) && l < 0.86); };   // (not black or grey: a pan, a tray)
// what a browned colour was before it cooked, by the kind of food
const RAW = { dough: '#f0ddb6', choc: '#6a3d26', meat: '#e5998c', fish: '#f2a68a', fry: '#f2e5c0', egg: '#f6e5a2', shell: '#5c6a7a', veg: '#e8dc98' };
const CHAR = hexL('#22150c');
const RECOL = new Map();
/** A copy of geometry geo, its colours turned: 'raw' (a browned colour back to what it was, by family fam), 'burnt'
 *  (browned colours charred, the rest darkened), 'charred' (only the browned ones: the food burnt, its plate not). */
function recolor(geo, fam, how, all = false) {
  if (!geo) return null;
  const key = `${geo.uuid}:${fam}:${how}:${all ? 1 : 0}`; if (RECOL.has(key)) return RECOL.get(key);
  const g = geo.clone(), a = g.getAttribute('aC').clone(); g.setAttribute('aC', a);
  const to = how === 'raw' || how === 'half' ? (RAW[fam] ? hexL(RAW[fam]) : null) : CHAR;
  for (let i = 0; i < a.count; i++) {
    const c = [a.getX(i), a.getY(i), a.getZ(i)], [h, s, l] = hsl(toS(c[0]), toS(c[1]), toS(c[2])), b = browned(h, s, l, fam);
    let k = 0, shade = 1;
    if (how === 'half' && !b && fam === 'veg') { const w = hexL('#f3ecd8'); a.setXYZ(i, c[0] + (w[0] - c[0]) * 0.22, c[1] + (w[1] - c[1]) * 0.22, c[2] + (w[2] - c[2]) * 0.22); continue; }   // (vegetables not roasted yet: a little paler)
    if (how === 'raw' || how === 'half') { if ((!b && !all) || !to) continue; k = how === 'half' ? 0.5 : all ? 0.9 : 0.86; shade = Math.min(1.12, 0.78 + l * 0.45); }   // (all: every colour of it was the dough: a donut before its glaze; half: on its way, between two machines)
    else k = b ? 0.86 : 0.62;
    if (!k) continue;
    a.setXYZ(i, c[0] + (to[0] * shade - c[0]) * k, c[1] + (to[1] * shade - c[1]) * k, c[2] + (to[2] * shade - c[2]) * k);
  }
  RECOL.set(key, g); return g;
}
/** The colours a model is mostly made of (sRGB hex, most first): a pot's contents, a salad's makings. */
const PAL = new Map();
function palette(geo, n = 5) {
  if (!geo) return ['#c8a070'];
  if (PAL.has(geo.uuid)) return PAL.get(geo.uuid).slice(0, n);
  const a = geo.getAttribute('aC'), P = geo.getAttribute('position'), I = geo.getIndex(), count = new Map();
  const v = i => [P.getX(i), P.getY(i), P.getZ(i)];
  const at = t => (I ? I.getX(t) : t), n3 = I ? I.count : P.count;
  for (let t = 0; t + 2 < n3; t += 3) {   // (by area: a soup's surface over its many little herbs)
    const i0 = at(t), [x0, y0, z0] = v(i0), [x1, y1, z1] = v(at(t + 1)), [x2, y2, z2] = v(at(t + 2));
    const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0, wx = x2 - x0, wy = y2 - y0, wz = z2 - z0;
    const area = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
    const key = [a.getX(i0), a.getY(i0), a.getZ(i0)].map(c => Math.round(toS(c) * 15)).join(',');   // (16 steps a channel)
    count.set(key, (count.get(key) || 0) + area);
  }
  const out = [];
  for (const [key] of [...count].sort((x, y) => y[1] - x[1])) {
    const c = key.split(',').map(Number), [, sat, l] = hsl(c[0] / 15, c[1] / 15, c[2] / 15);
    if (l > 0.93 || (sat < 0.08 && l > 0.6)) continue;   // (its plate's white, steel)
    if (out.some(o => Math.abs(o[0] - c[0]) + Math.abs(o[1] - c[1]) + Math.abs(o[2] - c[2]) < 4)) continue;
    out.push(c); if (out.length >= 8) break;
  }
  const hex = out.map(c => '#' + c.map(v => Math.round(v * 17).toString(16).padStart(2, '0')).join(''));
  PAL.set(geo.uuid, hex.length ? hex : ['#c8a070']); return PAL.get(geo.uuid).slice(0, n);
}
const mixHex = (h, w, k) => { const a = hexL(h), b = hexL(w); return new THREE.Color(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k).getHex(); };
/** A model's meshes into group g (its solid colours and its glass), its geometry given (a dish's, maybe recoloured). */
function addModel(g, geo, glassGeo, y = 0) {
  const [solid, glass] = fmats();
  if (geo) { const m = new THREE.Mesh(geo, solid); m.position.y = y; g.add(m); }
  if (glassGeo) { const m = new THREE.Mesh(glassGeo, glass); m.position.y = y; m.renderOrder = 2; g.add(m); }
}
/** Which of a look's states item it is in: 'raw', 'done' or 'over'. */
const phase = (look, st) => (look.over?.includes(st) ? 'over' : look.raw?.includes(st) ? 'raw' : 'done');
/** A kind with a look (a dish of the menu, or a part of one): drawn as its family draws it. */
function dishMesh(g, it, look) {
  const ph = phase(look, it.st), model = look.models?.[it.st] || look.model, fam = look.family || 'dough';
  if (fam === 'pot' || look.pot?.includes(it.st)) {   // (in its saucepan: the dish's own colour; raw, paler; burnt, dark)
    const pal = palette(dishGeometry(model, true).geo), top = look.top || pal[0], bits = look.bits || pal.slice(1, 3);
    const c = ph === 'raw' ? mixHex(top, '#c2cbd0', 0.6) : ph === 'over' ? 0x3a1a0a : new THREE.Color(...hexL(top)).getHex();
    saucepan(g, c, null, ph === 'over' ? null : bits);   // (raw: watery, what goes in it showing; burnt: dark)
    return;
  }
  if (fam === 'prep' && ph === 'raw') { makings(g, palette(dishGeometry(model, true).geo, 6)); return; }   // (its makings, to prepare)
  if (fam === 'blend') {   // (its makings; blended: the blender's jug, the dish's colour; left too long, duller)
    const pal = palette(dishGeometry(model, true).geo, 6);
    if (ph === 'raw') { makings(g, pal); return; }
    part(g, cyl(0.045, 0.035, 0.12), M(0xe3f0f5, { a: 0.45, r: 0.1, e: 0x000000 }), 0, 0.06, 0);
    part(g, cyl(0.04, 0.032, 0.09), M(ph === 'over' ? mixHex(pal[0], '#4a3020', 0.6) : new THREE.Color(...hexL(pal[0])).getHex(), { r: 0.35 }), 0, 0.048, 0);
    return;
  }
  const d = dishGeometry(model, true);
  const how = ph === 'over' ? 'burnt' : look.half?.includes(it.st) ? 'half' : 'raw';
  addModel(g, ph === 'done' ? d.geo : recolor(d.geo, fam, how, ph === 'raw' && look.rawAll), d.glass, -0.012);   // (the food alone sits a plate's height lower: on the station)
}
/** Its makings on a little board: the dish's colours as what it is made of, whole. */
function makings(g, pal) {
  part(g, box(), M(0xb98a57, { r: 0.8 }), 0, 0.006, 0, 0.17, 0.012, 0.12);
  const spots = [[-0.05, 0.03], [0.0, -0.03], [0.05, 0.025], [-0.035, -0.035], [0.045, -0.03], [0.012, 0.035]];
  pal.forEach((h, n) => {
    const [x, z] = spots[n % spots.length], c = new THREE.Color(...hexL(h)).getHex();
    if (n % 3 === 0) part(g, sph(12), M(c, { r: 0.6 }), x, 0.03, z, 0.024, 0.02, 0.024);   // (a round one)
    else if (n % 3 === 1) part(g, box(), M(c, { r: 0.7 }), x, 0.022, z, 0.034, 0.018, 0.026, 0, 0.4 * n, 0);   // (a block)
    else part(g, cyl(0.022, 0.022, 0.006, 14), M(c, { r: 0.6 }), x, 0.016, z, 1, 1, 1, 0.2, 0, 0.1);   // (a slice)
  });
}
/** Served: plate or bowl item it (on it, a dish with a look), as the dish is served in the world (on its own plate, in its
 *  bowl, on its board); null when it isn't such a dish. */
function servedMesh(g, it) {
  const look = it.on && LOOKS()[it.on]; if (!look) return false;
  const burnt = it.burnt || look.over?.includes(it.onSt);
  if (burnt && it.k === 'bowl') {   // (burnt in a bowl: dark, a few burnt bits of it)
    MAKE.bowl(g, { k: 'bowl', st: 'clean' }); part(g, cyl(0.074, 0.074, 0.002, 20), M(0x3a1a0a, { r: 0.4 }), 0, 0.0605, 0);
    (look.bits ? [look.top, ...look.bits] : palette(dishGeometry(look.model, true).geo, 3)).forEach((h, n) => part(g, sph(8), M(mixHex(h, '#22150c', 0.7), { r: 0.6 }), [0.025, -0.03, 0.005][n], 0.062, [-0.02, 0.01, 0.03][n], 0.012, 0.005, 0.012));
    return true;
  }
  if (burnt) {   // (burnt: the burnt food on a plain plate or bowl, its own plate or board left clean)
    MAKE[it.k](g, { k: it.k, st: 'clean' });
    const a = dishGeometry(look.model, true); addModel(g, recolor(a.geo, look.family || 'dough', 'burnt'), a.glass);
    return true;
  }
  const d = dishGeometry(look.served || look.model, false); addModel(g, d.geo, d.glass);
  return true;
}
/** A drink of the menu in its cup or glass (look key 'cup:mocha'): its own vessel, as served in the world. */
function drinkMesh(g, it) {
  const look = LOOKS()[`${it.k}:${it.st}`]; if (!look) return false;
  const d = dishGeometry(look.served || look.model, false); addModel(g, d.geo, d.glass);
  return true;
}

/** The model of an item ({ k, st, on, onSt, art, burnt }): a Group, its base at y 0. */
export function itemMesh(it) {
  const g = new THREE.Group(); g.name = `ou-item:${it.k}`;
  const look = LOOKS()[it.k];
  if (look) dishMesh(g, it, look);
  else if (!(it.on && servedMesh(g, it)) && !drinkMesh(g, it)) (MAKE[it.k] || MAKE.bread)(g, it);
  g.scale.setScalar(K);
  return g;
}
/** A key that changes when the item's look does (to rebuild a model only then). */
export const lookKey = it => `${it.k}:${it.st}:${it.on || ''}:${it.onSt || ''}:${it.art ? 1 : 0}`;
