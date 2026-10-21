// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Farmland (2026-10-03: "detailed farm land with like wheat fields or corn or planted anything", hay rolls, fields
// of flowers). Fields are laid out in a gently curving "farm space" - bands of fields like a patchwork quilt, bending
// with the land instead of a grid - each with its crop, the way its rows run, and what bounds it: a hedge, a post-and-
// rail fence, a dry-stone wall or a grass margin. A field is farmed when its middle is on the gentle, drier land of a
// farm cluster within ~2 km of the city (shared/biome.js decides, field by field, so fields are whole).
//
// The same rules are used in three places: here (the ground's colours and what grows, shared/biome.js), the countryside
// meshes the terrain worker builds (client/js/render/countryside.js), and the ground shader, which draws the rows, tram
// lines and furrows to the pixel (client/js/render/ground-detail.js FARM_GLSL mirrors fieldOf/edgeKind/toFarm exactly).
// Change one, change the others.

/** Depth (m) of a band of fields; fields in a band are 40–110 m wide. */
export const ROW_D = 56;
/** Crops, by a field's draw: cumulative shares. */
export const CROPS = ['corn', 'veg', 'green', 'wheat', 'barley', 'stubble', 'hay', 'sunflower', 'lavender', 'tulip', 'plough'];
const CUM = [0.15, 0.24, 0.32, 0.5, 0.57, 0.66, 0.76, 0.82, 0.87, 0.91, 1];
export const CROP = Object.fromEntries(CROPS.map((c, i) => [c, i]));
/** Field boundaries: a hedge, a fence, a dry-stone wall or just a grass margin. */
export const EDGES = ['hedge', 'fence', 'wall', 'margin'];
/** Half-width (m) of each kind of boundary on a field's side of the line, and the grass beyond it before the crop. */
export const EDGE_HALF = [1.5, 0.15, 0.45, 0];
export const EDGE_GRASS = [1.6, 1.4, 1.2, 2.2];

export function hashf(x, z, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(s | 0, 0x2545f491);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** Crop index for a field's draw r (0..1). */
export function cropOf(r) { for (let i = 0; i < CUM.length; i++) if (r < CUM[i]) return i; return CUM.length - 1; }
/** Some fields hold a farmstead (farmhouse, barn, silo, hay shed round a yard) instead of a crop: grass round it. */
export const isFarmstead = (fx, row) => hashf(fx, row, 4300) < 0.055;

// Farm space: world (x, z) = farm (u, v) + a gentle smooth offset (a few tens of metres, slowly varying), so bands of
// fields curve over kilometres. The inverse is found by fixed-point steps (the offset's slope is under 0.12, so four
// steps land within a centimetre).
const offU = (u, v) => 38 * Math.sin(v * 0.0021 + 1.3) + 22 * Math.sin((u + v) * 0.0013 + 4.1);
const offV = (u, v) => 30 * Math.sin(u * 0.0017 + 0.4) + 18 * Math.sin((u - v) * 0.0011 + 2.2);
export function fromFarm(u, v) { return [u + offU(u, v), v + offV(u, v)]; }
export function toFarm(x, z) {
  let u = x, v = z;
  for (let k = 0; k < 4; k++) { const nu = x - offU(u, v), nv = z - offV(u, v); u = nu; v = nv; }
  return [u, v];
}

/** The band (row) a farm-space v falls in, and its fields' width and offset. */
export function bandOf(v) {
  const rv = v + 9000, row = Math.floor(rv / ROW_D);
  return { row, lv: rv - row * ROW_D, w: 40 + hashf(row, 1, 4244) * 70, off: hashf(row, 0, 4243) * 90 };
}
/** Kind of boundary (index into EDGES) at the start of field fx of a band (between fx − 1 and fx). */
export function uEdge(fx, row) { const t = hashf(fx, row, 4260); return t < 0.52 ? 0 : t < 0.7 ? 1 : t < 0.8 ? 2 : 3; }
/** Kind of boundary along the start of a band (between row − 1 and row), in 90 m stretches along u. */
export function vEdge(row, u) { const t = hashf(row, Math.floor((u + 5000) / 90), 4261); return t < 0.52 ? 0 : t < 0.7 ? 1 : t < 0.8 ? 2 : 3; }

/**
 * The field at farm-space (u, v): { row, fx, lu, lv (m into the field), w (its width), d (its depth, ROW_D), crop,
 * along (rows run along u), id }. Pure arithmetic; the shader computes the same.
 */
export function fieldOf(u, v) {
  const b = bandOf(v), ru = u + 5000 + b.off, fx = Math.floor(ru / b.w);
  const r = hashf(fx, b.row, 4242);
  const stead = isFarmstead(fx, b.row);
  return { row: b.row, fx, lu: ru - fx * b.w, lv: b.lv, w: b.w, d: ROW_D, crop: stead ? CROP.hay : cropOf(r), r, along: hashf(fx, b.row, 4250) < 0.55, stead, id: `${b.row}:${fx}` };
}
/** A field's corners in farm space: u0, u1 (its band's u at lu = 0 and w), v0, v1. */
export function fieldRect(row, fx) {
  const w = 40 + hashf(row, 1, 4244) * 70, off = hashf(row, 0, 4243) * 90, u0 = fx * w - 5000 - off, v0 = row * ROW_D - 9000;
  return { u0, u1: u0 + w, v0, v1: v0 + ROW_D, w };
}
/**
 * Where a point is within its field: the nearest boundary's kind and distance (m), and whether it is on the boundary
 * itself (under a hedge, wall or fence), on the grass margin beside it, or in the crop.
 */
export function fieldPlace(f, u) {
  const eL = uEdge(f.fx, f.row), eR = uEdge(f.fx + 1, f.row), eB = vEdge(f.row, u), eT = vEdge(f.row + 1, u);
  const sides = [[f.lu, eL], [f.w - f.lu, eR], [f.lv, eB], [f.d - f.lv, eT]];
  let best = sides[0]; for (const s of sides) if (s[0] < best[0]) best = s;
  const [d, kind] = best, half = EDGE_HALF[kind];
  // the crop starts after the boundary and its grass on every side
  let inCrop = true; for (const [ds, k] of sides) if (ds < EDGE_HALF[k] + EDGE_GRASS[k]) inCrop = false;
  return { kind, d, on: d < half, margin: !inCrop && d >= half, inCrop };
}
