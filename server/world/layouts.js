// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Interior layout generators. All coordinates are building-local (origin = footprint centre, +z = front/entrance).
// Placement uses exact rectangle tests (items, reserved clearances, walls) so furniture can sit flush to walls.
import { CATALOG } from '../../shared/catalog.js';
import { CAFE_STYLES } from '../../shared/floor-themes.js';
import { WALL_T } from '../../shared/constants.js';
import { itemAABB, rectsOverlap } from '../../shared/geom.js';
import { keepClear } from '../../shared/edit.js';
import { RNG } from '../../shared/rng.js';
import { kitchenLayout, PASS_BAND, kitchenNeeds, placeMenu } from '../../shared/kitchen-module.js';

const P = Math.PI, H = Math.PI / 2;
const IW = 0.06;               // interior wall half thickness
const r3 = v => Math.round(v * 1000) / 1000;
const K_ITEM = 1, K_RESERVE = 2, K_WALL = 3;

export const SOFA_COLORS = ['#5b6c8f', '#8f5b5b', '#6c8f5b', '#c9a66b', '#4a4a55', '#7a6a9a', '#b5651d', '#2f5d62', '#a64d79', '#d9c5a0', '#3d5a80', '#e07a5f'];
export const WOOD = ['#b08560', '#8a6242', '#d2b48c', '#6b4a33', '#e0cfb1', '#a0522d'];
export const DESK_COLORS = ['#ece8e1', '#d2b48c', '#8a6242', '#f7f7f7', '#3a3f47', '#b9c4cf'];
export const BED_COLORS = ['#e8e1d5', '#b7c9e2', '#d9b8c4', '#c5d8b8', '#f0e0b0', '#9fb3c8', '#d4c4f0'];
export const RUG_COLORS = ['#a14f3a', '#3f5e7a', '#6f7d4a', '#c2a36b', '#7a4a6f', '#4a6f6a', '#8a8f99'];

export class LevelBuilder {
  constructor(b, rng, open = false) {
    this.b = b; this.rng = rng; this.w = b.w; this.d = b.d; this.open = open;
    const m = open ? 0 : WALL_T;
    this.ix0 = -b.w / 2 + m; this.ix1 = b.w / 2 - m; this.iz0 = -b.d / 2 + m; this.iz1 = b.d / 2 - m;
    this.rects = [];
    this.items = []; this.walls = []; this.zones = []; this.units = []; this.doors = [];
    this.venue = null; this.name = '';
  }
  isFree(bb, pad = 0.05) {
    for (const r of this.rects) {
      const p = r[4] === K_ITEM ? pad : r[4] === K_WALL ? -0.004 : 0;
      if (bb.x0 < r[2] + p && bb.x1 > r[0] - p && bb.z0 < r[3] + p && bb.z1 > r[1] - p) return false;
    }
    return true;
  }
  mark(bb, kind) { this.rects.push([bb.x0, bb.z0, bb.x1, bb.z1, kind]); }
  inside(bb) {
    return bb.x0 >= this.ix0 - 1e-6 && bb.x1 <= this.ix1 + 1e-6 && bb.z0 >= this.iz0 - 1e-6 && bb.z1 <= this.iz1 + 1e-6;
  }
  add(t, x, z, r = 0, extra = null, pad = 0.05) {
    const def = CATALOG[t]; if (!def) return null;
    const it = { t, x: r3(x), z: r3(z), r: r3(r) };
    if (extra) Object.assign(it, extra);
    if (def.tint && !it.c) it.c = defaultTint(t, this.rng);
    const bb = itemAABB(it, def.rect);
    if (!this.inside(bb)) return null;
    if (def.block !== false && !this.isFree(bb, pad)) return null;
    this.items.push(it);
    if (def.block !== false) this.mark(bb, K_ITEM);
    return it;
  }
  addFixed(t, x, z, r = 0) {
    const it = { t, x: r3(x), z: r3(z), r: r3(r) };
    this.items.push(it); this.mark(itemAABB(it, CATALOG[t].rect), K_ITEM);
    return it;
  }
  reserve(x0, z0, x1, z1) { this.mark({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) }, K_RESERVE); }
  wall(x1, z1, x2, z2, kind = 0) {
    if (Math.hypot(x2 - x1, z2 - z1) < 0.25) return;
    this.walls.push([r3(x1), r3(z1), r3(x2), r3(z2), kind]);
    this.mark({ x0: Math.min(x1, x2) - IW, z0: Math.min(z1, z2) - IW, x1: Math.max(x1, x2) + IW, z1: Math.max(z1, z2) + IW }, K_WALL);
  }
  /** Straight wall with door gaps: gaps = [[distance from start, width], ...]. Keeps 0.8 m clear both sides of each gap. */
  wallGaps(x1, z1, x2, z2, gaps, kind = 0) {
    const L = Math.hypot(x2 - x1, z2 - z1); if (L < 0.01) return;
    const ux = (x2 - x1) / L, uz = (z2 - z1) / L;
    const gs = gaps.map(([t, w]) => [Math.max(0, t - w / 2), Math.min(L, t + w / 2)]).sort((a, b) => a[0] - b[0]);
    let s = 0;
    for (const [g0, g1] of gs) {
      if (g0 > s) this.wall(x1 + ux * s, z1 + uz * s, x1 + ux * g0, z1 + uz * g0, kind);
      const ax = x1 + ux * g0, az = z1 + uz * g0, bx = x1 + ux * g1, bz = z1 + uz * g1;
      if (Math.abs(ux) > 0.99 || Math.abs(uz) > 0.99) this.doors.push({ x: r3((ax + bx) / 2), z: r3((az + bz) / 2), w: r3(g1 - g0), axis: Math.abs(ux) > 0.99 ? 'x' : 'z', ...(kind ? { glass: true } : {}) });   // a door in the gap (shared/doors.js)
      const nx = -uz * 0.8, nz = ux * 0.8;
      this.reserve(Math.min(ax, bx) - Math.abs(nx), Math.min(az, bz) - Math.abs(nz), Math.max(ax, bx) + Math.abs(nx), Math.max(az, bz) + Math.abs(nz));
      s = g1;
    }
    if (s < L) this.wall(x1 + ux * s, z1 + uz * s, x2, z2, kind);
  }
  zone(x0, z0, x1, z1, f) { this.zones.push([r3(Math.min(x0, x1)), r3(Math.min(z0, z1)), r3(Math.max(x0, x1)), r3(Math.max(z0, z1)), f]); }
  /** Item with its back against an axis-aligned wall. axis 'z': wall along x at z=line; 'x': wall along z at x=line. inward = facing sign. */
  against(type, axis, line, inward, t, extra = null, gap = 0.03, pad = 0.05) {
    const def = CATALOG[type]; if (!def) return null;
    const off = inward * (gap - def.rect[1]);
    if (axis === 'z') return this.add(type, t, line + off, inward > 0 ? 0 : P, extra, pad);
    return this.add(type, line + off, t, inward > 0 ? H : -H, extra, pad);
  }
  /** Runs fn with rng as the builder's dice (tints and choices), so a piece's look depends only on its own dice. */
  with(rng, fn) { const keep = this.rng; this.rng = rng; try { return fn(); } finally { this.rng = keep; } }
  tryAdd(type, cands, extra = null, pad = 0.05) {
    for (const c of cands) { const it = this.add(type, c[0], c[1], c[2] || 0, extra, pad); if (it) return it; }
    return null;
  }
  result() {
    const out = { name: this.name, items: this.items, walls: this.walls, zones: this.zones };
    if (this.venue) out.venue = this.venue;
    if (this.style) out.style = this.style;   // (a café's style: shared/floor-themes.js CAFE_STYLES)
    if (this.units.length) out.units = this.units;
    if (this.doors.length) out.doors = this.doors;
    if (this.mods?.length) { out.mods = this.mods; out.mnid = this.mods.length; }   // (its interior modules: shared/interior-modules.js)
    return out;
  }
}

function defaultTint(t, rng) {
  switch (t) {
    case 'sofa': case 'sofa_l': case 'armchair': case 'beanbag': return rng.pick(SOFA_COLORS);
    case 'rug': case 'yoga_mat': return rng.pick(RUG_COLORS);
    case 'bed_double': case 'bed_single': return rng.pick(BED_COLORS);
    case 'desk': case 'desk_l': case 'standing_desk': case 'desk_home': case 'desk_exec': return rng.pick(DESK_COLORS);
    case 'tree': return rng.pick(['#4f8a3c', '#5e9a45', '#3f7a3a', '#6aa84f', '#7fae4e', '#8fbf5a']);
    case 'bush': return rng.pick(['#4c8b3f', '#3e7a36', '#5d9b48']);
    case 'flowers': return rng.pick(['#e05b8b', '#f2c14e', '#e8735a', '#b56be0', '#f7f7f7', '#ff8fab']);
    case 'arcade': return rng.pick(['#c0392b', '#2980b9', '#8e44ad', '#16a085', '#f39c12']);
    default: return CATALOG[t]?.cat === 'Arcade' ? rng.pick(['#7c3aed', '#db2777', '#2563eb', '#0891b2', '#dc2626', '#ea580c', '#16a34a', '#111827']) : rng.pick(WOOD);
  }
}

// ---------------------------------------------------------------------------------------------
// Vertical cores
export function coreFor(b) {
  if (b.type === 'park' || b.floors <= 1) return null;
  const ix0 = -b.w / 2 + WALL_T, ix1 = b.w / 2 - WALL_T, iz0 = -b.d / 2 + WALL_T;
  if (b.type === 'office' || b.type === 'hq') {
    if (b.w >= 16 && b.d >= 12) return { t: 'elevator', x: 0, z: r3(iz0 + 1.46), r: 0 };
    return { t: 'elevator_s', x: 0, z: r3(iz0 + 1.26), r: 0 };
  }
  if (b.type === 'apartment') return { t: 'elevator_s', x: r3(ix0 + 1.26), z: 0, r: H };
  if (b.type === 'terminal') return { t: 'elevator', x: r3(Math.max(ix0 + 4, -b.w / 2 + 20)), z: r3(iz0 + 1.46), r: 0 };   // airside, past security
  return { t: 'elevator_s', x: r3(ix1 - 1.31), z: r3(iz0 + 1.26), r: 0 };
}
function placeCore(L) {
  const c = L.b.core; if (!c) return null;
  const it = L.addFixed(c.t, c.x, c.z, c.r);
  const def = CATALOG[c.t];
  const cs = Math.cos(c.r), sn = Math.sin(c.r);
  for (const [dx, dz] of def.doors) {
    const px = c.x + dx * cs + (dz + 1.0) * sn, pz = c.z - dx * sn + (dz + 1.0) * cs;
    L.reserve(px - 1.0, pz - 1.0, px + 1.0, pz + 1.0);
  }
  return it;
}
function reserveEntrance(L, depth = 3.2) {
  const dr = L.b.door; if (!dr) return;
  L.reserve(dr.x - dr.w / 2 - 0.4, L.iz1 - depth, dr.x + dr.w / 2 + 0.4, L.iz1);
}

// ---------------------------------------------------------------------------------------------
// Fixed grids for the street floors (floor layouts step 4): pieces are counted out from the entrance and in from the
// front windows at fixed pitches, so a resize adds or takes pieces at the edges and leaves the rest where they stood.
/** Places outward from the middle line x = c on both sides at a fixed pitch: [{ x, side, k }] while a piece of half
 *  width hw stays within lo…hi; gap keeps the middle free (an aisle, the entrance). */
function fromMiddle(c, lo, hi, pitch, hw, gap = 0) {
  const out = [];
  for (const side of [-1, 1]) for (let k = 0; k < 64; k++) {
    const x = c + side * (gap + hw + k * pitch);
    if (x - hw < lo - 1e-6 || x + hw > hi + 1e-6) break;
    out.push({ x: r3(x), side, k });
  }
  return out;
}
/** Rows in from the front windows (z = iz1): [{ z, r }] at first, first + pitch, … while z stays at or above zMin. */
function fromFront(iz1, first, pitch, zMin) {
  const out = [];
  for (let r = 0; r < 64; r++) { const z = iz1 - first - r * pitch; if (z < zMin - 1e-6) break; out.push({ z: r3(z), r }); }
  return out;
}
/** The x range at the back wall that the elevator takes (with room around it), or null. */
function coreSpan(L, room = 0.6) {
  const c = L.b.core; if (!c) return null;
  const bb = itemAABB(c, CATALOG[c.t].rect);
  return { x0: bb.x0 - room, x1: bb.x1 + room, z1: bb.z1 + room };
}

/**
 * Where a floor of a street building is laid out from: on the street floor the entrance (columns out from the door, rows
 * in from the windows), on a floor above it the elevator (columns out from it, rows out from the back wall) — so every
 * floor keeps its arrangement around the way people arrive. aisle: the half width kept free on the middle line.
 * cols(pitch, hw, gap) and rows(first, pitch, back): the grid (rows stop at z = back on the street floor and start there
 * above it); door(c, r, half): whether a place is in the way in.
 */
function anchorOf(L, ground, aisle) {
  const { ix0, ix1, iz1 } = L, cs = coreSpan(L), dr = L.b.door;
  if (ground || !cs) {
    return { up: false, x: dr.x, gap: aisle, cs,
      cols: (pitch, hw, gap = aisle) => fromMiddle(dr.x, ix0 + 0.35, ix1 - 0.35, pitch, hw, gap),
      rows: (first, pitch, back) => fromFront(iz1, first, pitch, back),
      door: (c, r, half) => r === 0 && Math.abs(c.x - dr.x) < half };
  }
  const x = (cs.x0 + cs.x1) / 2, hg = (cs.x1 - cs.x0) / 2;
  return { up: true, x, gap: hg, cs,
    cols: (pitch, hw, gap = 0) => fromMiddle(x, ix0 + 0.35, ix1 - 0.35, pitch, hw, Math.max(gap, hg)),
    rows: (first, pitch, back) => { const out = []; for (let r = 0; r < 64; r++) { const z = back + r * pitch; if (z > iz1 - first + 1e-6) break; out.push({ z: r3(z), r }); } return out; },
    door: () => false };
}

// ---------------------------------------------------------------------------------------------
// Office
function deskCluster(L, cx, cz, cols, type = 'desk', tint = null) {
  const def = CATALOG[type];
  const dw = def.rect[2] - def.rect[0], half = -def.rect[1];
  const x0 = cx - (cols * dw) / 2 + dw / 2;
  const placed = [];
  const c = tint || L.rng.pick(DESK_COLORS);
  for (let k = 0; k < cols; k++) {
    const x = x0 + k * dw;
    const a = L.add(type, x, cz - half, P, { c }, -0.02); if (a) placed.push(a);
    const b = L.add(type, x, cz + half, 0, { c }, -0.02); if (b) placed.push(b);
  }
  return placed;
}
function kitchenArea(L, x0, z0, x1, z1, fancy = false) {
  const rng = L.rng;
  L.zone(x0, z0, x1, z1, rng.pick(['tile', 'wood', 'terrazzo']));
  const w = x1 - x0;
  const kx = x0 + Math.min(w / 2 - 0.5, 1.9);
  L.against('kitchen', 'z', z0, +1, kx);
  L.against('fridge', 'z', z0, +1, kx + 2.0);
  L.against('coffee_machine', 'z', z0, +1, kx + 3.0) || L.tryAdd('coffee_machine', [[x1 - 0.4, z0 + 1.6, -H]]);
  L.tryAdd('water_cooler', [[x1 - 0.35, z0 + 2.6], [x0 + 0.35, z0 + 2.6]]);
  if (fancy && w > 7.5) L.against('vending', 'z', z0, +1, x1 - 0.65);
  const tz = z0 + 3.45;
  if (z1 - z0 >= 5.2) {
    const n = Math.max(1, Math.floor((w - 0.4) / 2.7));
    const sp = (w - 0.4) / n;
    for (let k = 0; k < n; k++) {
      const x = x0 + 0.2 + sp * (k + 0.5);
      L.add('cafe_table4', x, tz, 0, null, 0.1) || L.add('cafe_table', x, tz, H, null, 0.1);
    }
  }
}
function lounge(L, x0, z0, x1, z1, face = +1) {
  // compact lounge group; face +1: the sofa faces +z
  const rng = L.rng, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  L.add('rug', cx, cz, 0);
  L.add(rng.chance(0.5) ? 'sofa' : 'sofa_l', cx, cz - 1.3 * face, face > 0 ? 0 : P) || L.add('sofa', cx, cz - 1.2 * face, face > 0 ? 0 : P);
  L.add('coffee_table', cx, cz + 0.15 * face, 0);
  L.tryAdd('armchair', [[cx - 1.75, cz + 0.2 * face, H], [cx - 1.6, cz, H]]);
  L.tryAdd('armchair', [[cx + 1.75, cz + 0.2 * face, -H], [cx + 1.6, cz, -H]]);
  L.tryAdd('plant_tall', [[x0 + 0.4, face > 0 ? z0 + 0.4 : z1 - 0.4], [x1 - 0.4, face > 0 ? z0 + 0.4 : z1 - 0.4]]);
  L.tryAdd('floor_lamp', [[x1 - 0.3, face > 0 ? z0 + 0.35 : z1 - 0.35], [x0 + 0.3, face > 0 ? z0 + 0.35 : z1 - 0.35]]);
}
/**
 * An office floor (floor layouts step 4, 2026-10-04): along the back wall, either side of the elevator, rooms of fixed
 * widths counted out from it — meeting rooms, private offices, a kitchen, phone booths — and in front an open plan of
 * desk clusters on a fixed grid from the aisle in front of the elevator, rows counted from the rooms. A resize adds or
 * takes rooms and clusters at the edges and leaves the rest where it was; every room and cluster has its own dice.
 */
export function officeFloor(L, o = {}) {
  const base = L.rng.int(1, 2 ** 30), R = k => new RNG(`${base}:${k}`), withRng = (r, fn) => L.with(r, fn);
  const { ix0, ix1, iz0, iz1 } = L, D = iz1 - iz0;
  L.name = o.name || 'Office';
  L.zone(ix0, iz0, ix1, iz1, o.finish || R('finish').pick(['carpet', 'carpet', 'carpet_blue', 'concrete', 'wood']));
  placeCore(L);
  const core = L.b.core, cx = core ? core.x : 0, coreHalf = core ? CATALOG[core.t].rect[2] + 0.1 : 1;
  const bandZ = iz0 + (D >= 13 ? 5.2 : Math.max(3.8, D * 0.4));
  // the rooms along the back: from the elevator outward, the last one taking what is left
  const ROOM_W = { meeting: 6.2, office: 3.6, kitchen: 6.6, phones: 2.8 };
  const kitchenLeft = R('kitchen').chance(0.5);
  const order = side => {
    const r = R(`rooms:${side}`), first = (side < 0) === kitchenLeft ? ['kitchen'] : [r.pick(['meeting', 'office'])];
    const rest = r.pick([['office', 'meeting', 'office', 'phones'], ['meeting', 'office', 'office', 'meeting'], ['office', 'office', 'meeting', 'phones', 'office']]);
    return k => (k < first.length ? first[k] : rest[(k - first.length) % rest.length]);
  };
  for (const side of [-1, 1]) {
    if (bandZ - iz0 < 3.8) break;
    const kindAt = order(side), start = side < 0 ? cx - coreHalf - 0.5 : cx + coreHalf + 0.5, end = side < 0 ? ix0 : ix1;
    let a = start;
    L.wall(a, iz0, a, bandZ, 0);   // the first room's wall by the elevator
    for (let k = 0; k < 24; k++) {
      const left = Math.abs(end - a);
      if (left < 2.6) { if (left > 0.6) L.tryAdd('plant_tall', [[(a + end) / 2, iz0 + 0.45]]); break; }
      let kind = kindAt(k), w = ROOM_W[kind];
      const flex = left - w < 2.6;
      if (flex) { w = left; if (w < ROOM_W[kind] - 1.2) kind = w >= 5.5 ? 'meeting' : w >= 3.0 ? 'office' : 'phones'; }
      const b = a + side * w, x0 = Math.min(a, b), x1 = Math.max(a, b), atWall = flex;
      if (!atWall) L.wall(b, iz0, b, bandZ, 0);
      withRng(R(`room:${side}:${k}`), () => backRoom(L, kind, x0, iz0, x1, bandZ, side, o));
      a = b;
      if (flex) break;
    }
  }
  // the open plan: clusters of desks on a grid from the aisle in front of the elevator
  const deskType = o.deskType || (R('desks').chance(0.15) ? 'standing_desk' : 'desk');
  const ddef = CATALOG[deskType], dw = ddef.rect[2] - ddef.rect[0];
  const pairD = 2 * (ddef.rect[3] - ddef.rect[1]) + (deskType === 'standing_desk' ? 0.8 : 0), rowGap = 1.6;
  const cols = ix1 - ix0 >= 16 ? 3 : 2, pitch = cols * dw + 1.5;   // clusters of 6 desks, of 4 on a narrow floor
  const z0 = bandZ + 1.4, z1 = iz1 - 0.8;
  const nRows = Math.max(0, Math.floor((z1 - z0 + rowGap) / (pairD + rowGap)));
  const loungeRow = nRows >= 2 && R('lounge').chance(0.65) ? nRows - 1 - R('lounge-row').int(0, Math.min(1, nRows - 2)) : -1;
  const loungeSide = R('lounge-side').chance(0.5) ? -1 : 1;
  let desks = 0;
  for (let r = 0; r < nRows; r++) {
    const cz = z0 + r * (pairD + rowGap) + pairD / 2;
    for (const side of [-1, 1]) {
      const a0 = cx + side * 1.15, lim = side < 0 ? ix0 + 0.9 : ix1 - 0.9;
      const n = Math.floor((Math.abs(lim - a0) + 1.5) / pitch);
      for (let k = 0; k < n; k++) {
        const c = a0 + side * (k * pitch + (cols * dw) / 2);
        if (r === loungeRow && side === loungeSide && k === n - 1 && n >= 2) {   // a sofa corner instead of the outermost cluster
          withRng(R(`lounge:${r}`), () => lounge(L, c - pitch / 2 + 0.3, cz - 1.7, c + pitch / 2 - 0.3, cz + 1.7, -1));
          continue;
        }
        desks += withRng(R(`desks:${side}:${r}:${k}`), () => deskCluster(L, c, cz, cols, deskType)).length;
      }
    }
  }
  // by the rooms: a printer and files beside the elevator, plants in the front corners
  L.tryAdd('printer', [[cx - coreHalf - 0.9, bandZ + 0.45, 0], [cx + coreHalf + 0.9, bandZ + 0.45, 0]], null, 0.02);
  L.tryAdd('filing', [[cx + coreHalf + 1.9, bandZ + 0.45, 0], [cx - coreHalf - 1.9, bandZ + 0.45, 0]], null, 0.02);
  for (const [x, z] of [[ix0 + 0.4, iz1 - 0.4], [ix1 - 0.4, iz1 - 0.4]]) L.add(R(`plant:${x > 0}`).chance(0.5) ? 'plant_tall' : 'plant', x, z);
  if (o.fun) {
    L.tryAdd('pingpong', [[cx - loungeSide * 6.5, z1 - 1.6, H], [cx - loungeSide * 5, z1 - 1.6, H]]);
    L.tryAdd('arcade', [[ix1 - 0.45, bandZ + 1.9, -H], [ix0 + 0.45, bandZ + 1.9, H]]);
  }
  return desks;
}
/** One room along an office's back wall, x0..x1 × z0..z1 (its side walls are drawn by the floor; side: which way from
 *  the elevator it lies). A glass front with a door for meeting rooms and offices; the kitchen and phone booths stay open. */
function backRoom(L, kind, x0, z0, x1, z1, side, o) {
  const rng = L.rng, w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2;
  const doorAt = side < 0 ? w - 0.9 : 0.9;   // the door at the end nearer the elevator
  if (kind === 'kitchen') { kitchenArea(L, x0 + IW, z0, x1 - IW, z1, o.fancy); return; }
  if (kind === 'phones') {
    L.zone(x0, z0, x1, z1, 'carpet_blue');
    for (let k = 0; k < Math.floor((w - 0.2) / 1.35); k++) L.add('phone_booth', x0 + 0.75 + k * 1.35, z0 + 0.75, 0);
    L.tryAdd('plant', [[cx, z1 - 0.5]]);
    return;
  }
  L.wallGaps(x0, z1, x1, z1, [[doorAt, kind === 'meeting' ? 1.0 : 0.95]], 1);
  if (kind === 'meeting') {
    L.zone(x0, z0, x1, z1, rng.pick(['carpet_blue', 'carpet_warm', 'wood']));
    const tz = (z0 + z1) / 2 - 0.15;
    if (w >= 6.1 && d >= 4.4) L.add('meeting_table', cx, tz, 0) || L.add('cafe_table4', cx, tz, 0);
    else if (w >= 3.2 && d >= 3.2) L.add('cafe_table4', cx, tz, 0);
    if (w >= 3) L.against('whiteboard', 'z', z0, +1, cx + (w > 6 ? -w * 0.22 : 0));
    if (w >= 5) L.against('tv_wall', 'z', z0, +1, cx + w * 0.22);
    L.tryAdd('plant', [[x0 + 0.45, z0 + 0.45], [x1 - 0.45, z0 + 0.45]]);
    return;
  }
  // a private office: the desk facing the door, a bookshelf, an armchair
  L.zone(x0, z0, x1, z1, rng.pick(['wood', 'wood_dark', 'carpet_warm']));
  // facing the door, room behind it for the chair (a big desk only where there is a way round it)
  (w >= 4.4 && L.tryAdd('desk_exec', [[cx, z0 + 1.78, P]])) || L.tryAdd('desk', [[cx, z0 + 1.68, P]]);
  L.against('bookshelf', 'x', side < 0 ? x0 + IW : x1 - IW, side < 0 ? +1 : -1, (z0 + z1) / 2 + 0.4);   // on the wall away from the door
  L.tryAdd('armchair', [[side < 0 ? x0 + 0.7 : x1 - 0.7, z1 - 1.0, side < 0 ? H + 0.4 : -H - 0.4]]);
  L.tryAdd('plant', [[side < 0 ? x0 + 0.45 : x1 - 0.45, z1 - 0.5]]);
}
/** An office lobby (floor layouts step 4): reception beside the way in, planters lining the walk from the door to the
 *  elevators, a waiting corner on the other side, a café on the back wall when the building has one — all placed from
 *  the entrance and the elevator, so a resize only moves what stands at the side walls. */
export function officeLobby(L, o = {}) {
  const base = L.rng.int(1, 2 ** 30), D = (...k) => new RNG(`${base}:${k.join(':')}`);
  const { ix0, ix1, iz0, iz1 } = L;
  L.name = 'Lobby';
  L.zone(ix0, iz0, ix1, iz1, D('floor').pick(['marble', 'terrazzo', 'tile']));
  placeCore(L); reserveEntrance(L, 4);
  const core = L.b.core, dr = L.b.door, cs = coreSpan(L, 0.3);
  const coreFront = cs ? cs.z1 + 1.2 : iz0 + 2;
  L.reserve(dr.x - 1.3, coreFront, dr.x + 1.3, iz1);
  L.zone(dr.x - 1.3, coreFront - 0.6, dr.x + 1.3, iz1, D('walk').pick(['marble', 'tile_dark', 'terrazzo']));
  L.with(D('desk'), () => L.tryAdd('reception', [[dr.x + 3.7, iz1 - 3.6, 0], [dr.x + 3.4, iz1 - 4.2, 0], [dr.x - 3.7, iz1 - 3.6, 0]]));
  L.tryAdd('water_cooler', [[dr.x + 5.9, iz1 - 4.6]]);
  for (const r of fromFront(iz1, 1.1, 3.0, coreFront + 0.8)) for (const sx of [-1, 1]) L.add('plant_tall', dr.x + sx * 1.75, r.z);
  if (dr.x - 2.4 - ix0 >= 5.6) L.with(D('wait'), () => lounge(L, dr.x - 2.4 - 5.4, iz1 - 4.4, dr.x - 2.4, iz1 - 0.6, +1));
  // a big lobby: a second seating group deeper in on the other side, benches facing the elevators
  if (ix1 - dr.x - 2.4 >= 5.8 && iz1 - 10.4 >= coreFront + 1.0) L.with(D('wait2'), () => lounge(L, dr.x + 2.4, iz1 - 10.4, dr.x + 2.4 + 5.4, iz1 - 6.6, +1));
  if (cs) for (const sx2 of [-1, 1]) L.tryAdd('bench', [[dr.x + sx2 * 3.0, coreFront + 1.3, P]]);
  // the back wall either side of the elevators: a café counter with tables on one side, a directory screen on the other
  const cafeSide = D('cafe').chance(0.5) ? 1 : -1, cx = (core ? core.x : dr.x) + cafeSide * ((cs ? (cs.x1 - cs.x0) / 2 : 1) + 2.4);
  const cafe = o.cafe && cx - 1.7 > ix0 + 0.3 && cx + 1.7 < ix1 - 0.3;
  if (cafe) {
    L.venue = 'cafe';
    L.with(D('cafe-counter'), () => {
      L.zone(cx - 2.4, iz0, cx + 2.4, iz0 + 3.2, 'wood');
      L.add('cafe_counter', cx, iz0 + 2.45, 0);
      L.against('coffee_machine', 'z', iz0, +1, cx - 0.9); L.against('fridge', 'z', iz0, +1, cx + 0.7);
    });
    for (const c of fromMiddle(cx, ix0 + 0.4, ix1 - 0.4, 2.2, 0.42, -0.42)) if (c.k < 2) L.with(D('cafe-table', c.side, c.k), () => L.add('cafe_table', c.x, iz0 + 4.6, 0, null, 0.1));
  }
  const sx = (core ? core.x : dr.x) - cafeSide * ((cs ? (cs.x1 - cs.x0) / 2 : 1) + 1.4);
  L.tryAdd('tv_wall', [[sx, iz0 + 0.08, 0]]);
  L.tryAdd('bench', [[sx, iz0 + 2.0, 0]]);
  for (const [x, z] of [[ix0 + 0.45, iz1 - 0.45], [ix1 - 0.45, iz1 - 0.45]]) L.add('plant_tall', x, z);
  L.with(D('sides'), () => { L.tryAdd('bench', [[ix0 + 0.4, iz1 - 6.0, H]]); L.tryAdd('bench', [[ix1 - 0.4, iz1 - 6.0, -H]]); });
}
export function vacantFloor(L) {
  L.name = 'Available';
  L.zone(L.ix0, L.iz0, L.ix1, L.iz1, 'concrete');
  placeCore(L);
}

// ---------------------------------------------------------------------------------------------
// Apartments (floor layouts step 4, 2026-10-04): a double-loaded corridor along x (z in [-CW, CW]) with the elevator
// at its west end, and on each side a row of real flats — studios, one- and two-bedroom — each of its own fixed width,
// counted from the elevator end. Only the last flat on a side takes what is left, so a resize changes the flats at the far
// end and leaves the rest exactly as they were. Every flat has its own dice (seeded by the floor and its place in the row).
const CW = 1.45;
const UNIT_W = { studio: 6.2, one: 8.4, two: 10.8 };   // wall to wall
const UNIT_MIN = 5.0;
const unitKind = (w, ud) => (ud < 6.0 ? 'studio' : w >= 10 ? 'two' : w >= 7.4 ? 'one' : 'studio');
/** The flats along a row of length W: [{ kind, w }], fixed widths from the elevator end, the last one taking the rest. */
export function packUnits(W, kindAt, ud) {
  const out = [];
  let x = 0;
  for (let k = 0; k < 64; k++) {
    const rest = W - x, want = kindAt(k), w = UNIT_W[want];
    if (rest < UNIT_MIN) { if (out.length) { out[out.length - 1].w += rest; out[out.length - 1].kind = unitKind(out[out.length - 1].w, ud); } else out.push({ kind: 'studio', w: rest }); break; }
    if (rest - w < UNIT_MIN) { out.push({ kind: unitKind(rest, ud), w: rest, flex: true }); break; }
    out.push({ kind: unitKind(w, ud), w });
    x += w;
  }
  return out;
}
/** A row of a floor's plan ([{ k, w, s }]) fitted to a row of length W: every flat keeps its width but the last, which
 *  takes what is left (and goes into the one before it when too narrow). Kinds follow widths. */
export function fitRow(row, W, ud) {
  const out = row.map(u => ({ kind: u.k, w: u.w, s: u.s }));
  while (out.length > 1 && W - out.slice(0, -1).reduce((a, u) => a + u.w, 0) < UNIT_MIN) out.pop();
  if (!out.length) return [{ kind: 'studio', w: W, s: '0:0' }];
  out[out.length - 1].w = W - out.slice(0, -1).reduce((a, u) => a + u.w, 0);
  for (const u of out) u.kind = unitKind(u.w, ud);
  return out;
}
export function apartmentFloor(L, o = {}) {
  const { ix0, ix1, iz1 } = L, b = L.b;
  L.name = o.name || 'Apartments';
  const base = L.rng.int(1, 2 ** 30);   // the first draw: the floor's own dice, whatever the building's size
  placeCore(L);
  L.zone(ix0, -CW, ix1, CW, 'tile');
  L.reserve(ix0 + 2.6, -CW + 0.1, ix1, CW - 0.1);
  const W = ix1 - ix0, ud = iz1 - CW - IW;
  const mix = new RNG(`${base}:mix`).pick([['studio', 'one', 'one', 'two'], ['one', 'two', 'studio', 'one'], ['two', 'one', 'one', 'studio', 'two'], ['one', 'one', 'studio']]);
  const row = side => packUnits(W, k => { const r = new RNG(`${base}:${side}:kind:${k}`); return r.chance(0.7) ? mix[k % mix.length] : r.pick(['studio', 'one', 'two']); }, ud).map((u, k) => ({ ...u, s: `${side}:${k}` }));
  // the flats a floor's plan sets (flats added or taken away by hand, server/world/edit.js flatPlanOp): fitted to this width
  const rows = o.plan ? o.plan.map(r => fitRow(r, W, ud)) : [row(0), row(1)];
  L.plan = rows.map(r => r.map(u => ({ k: u.kind, w: r3(u.w), s: u.s })));
  // the front row straight into L; the back row built the same way (on the front side of a scratch builder), then turned over
  const flats = side => {
    const B = side === 0 ? L : new LevelBuilder(b, L.rng);
    const units = [];
    let x = ix0;
    rows[side].forEach((u, k) => {
      units.push({ ...apartmentUnit(B, x, CW, x + u.w, iz1, k % 2 === 0, x + u.w >= ix1 - 0.01, u.kind, new RNG(`${base}:${u.s}`), side === 1), s: u.s });
      x += u.w;
    });
    return { B, units };
  };
  const front = flats(0), back = flats(1);
  for (const it of back.B.items) if (!CATALOG[it.t].fixed) L.items.push({ ...it, z: r3(-it.z), r: r3(P - it.r) });
  for (const w of back.B.walls) L.walls.push([w[0], r3(-w[1]), w[2], r3(-w[3]), w[4]]);
  for (const z of back.B.zones) L.zones.push([z[0], r3(-z[3]), z[2], r3(-z[1]), z[4]]);
  for (const d of back.B.doors) L.doors.push({ ...d, z: r3(-d.z) });
  L.units = [...front.units, ...back.units.map(u => ({ ...u, z0: r3(-u.z1), z1: r3(-u.z0), door: [u.door[0], r3(-u.door[1])] }))];
  // the corridor's far end
  L.tryAdd('plant_tall', [[ix1 - 0.45, CW - 0.45], [ix1 - 0.45, -CW + 0.45]]);
  return L.units.length;
}
/**
 * One flat between the corridor wall (z0) and the windows (z1), x0..x1; mirror: its door at the east end. In the flat's
 * own frame u runs along its width from the door end and v from the corridor wall to the windows. Service rooms keep to
 * the corridor side (the bathroom in the far corner, the kitchen along the wall), bedrooms and the living room to the
 * windows, so a deeper building moves only what is by the windows.
 */
function apartmentUnit(L, x0, z0, x1, z1, mirror, last, kind, rng, turned = false) {
  const hand = mirror !== turned;   // which way the flat ends up handed (the back row is built here and then turned over)
  const first = x0 <= L.ix0 + 0.05;
  const lx0 = x0 + (first ? 0 : IW), lx1 = x1 - (last ? 0 : IW);
  const uw = lx1 - lx0, v0 = z0 + IW, ud = z1 - v0;
  const X = u => (mirror ? lx1 - u : lx0 + u), Z = v => v0 + v;
  const R = f => (f === '+v' ? 0 : f === '-v' ? P : f === '+u' ? (mirror ? -H : H) : (mirror ? H : -H));
  const put = (t, u, v, f, pad = 0.05, extra = null) => L.add(t, X(u), Z(v), R(f), extra || (CATALOG[t].tint ? { c: defaultTint(t, rng) } : null), pad);
  const back = (t, wall, pos, gap = 0.03, pad = 0.05) => {
    const off = gap - CATALOG[t].rect[1];
    if (wall === 'v0') return put(t, pos, off, '+v', pad);
    if (wall === 'v1') return put(t, pos, ud - off, '-v', pad);
    if (wall === 'u0') return put(t, off, pos, '+u', pad);
    return put(t, uw - off, pos, '-u', pad);
  };
  /** Against an inner wall at u = wu (facing +u when dir > 0) or v = wv (facing +v when dir > 0). */
  const atU = (t, wu, dir, v, gap = 0.03) => put(t, wu + dir * (IW + gap - CATALOG[t].rect[1]), v, dir > 0 ? '+u' : '-u');
  const atV = (t, wv, dir, u, gap = 0.03) => put(t, u, wv + dir * (IW + gap - CATALOG[t].rect[1]), dir > 0 ? '+v' : '-v');
  const wallUV = (u1, v1, u2, v2, gaps) => {
    const ax = X(u1), az = Z(v1), bx = X(u2), bz = Z(v2);
    if (gaps) L.wallGaps(ax, az, bx, bz, gaps, 0); else L.wall(ax, az, bx, bz, 0);
  };
  const zoneUV = (u1, v1, u2, v2, f) => { const a = X(u1), c = X(u2); L.zone(Math.min(a, c), Z(v1), Math.max(a, c), Z(v2), f); };
  const doorU = 1.05, doorX = X(doorU);
  L.wallGaps(x0, z0, x1, z0, [[doorX - x0, 1.0]], 0);
  if (!last) L.wall(x1, z0, x1, z1, 0);
  const floor = rng.pick(['wood', 'wood', 'wood_dark', 'carpet_warm']);
  zoneUV(0, 0, uw, ud, floor);
  // the bathroom in the far corner by the corridor: a compact one in a studio (basin on the corridor wall, toilet on the
  // far wall, shower in the corner), else toilet and basin on the corridor wall and a bath (or a shower) at the end
  const compact = kind === 'studio', bw = compact ? 2.2 : 2.6, bu = uw - bw, bv = 2.3;
  wallUV(bu, 0, bu, bv);
  wallUV(bu, bv, uw, bv, [[0.6, 0.9]]);
  zoneUV(bu, 0, uw, bv, rng.pick(['tile', 'tile', 'tile_dark', 'marble']));
  if (compact) { back('sink', 'v0', bu + 0.5, 0.03, 0.02); back('toilet', 'u1', 0.5); put('shower', uw - 0.53, bv - 0.53 - IW, '-u', 0.0); }
  else {
    back('toilet', 'v0', bu + 0.45);
    back('sink', 'v0', bu + 1.1, 0.03, 0.02);
    if (uw >= 8.4) back('bathtub', 'u1', 0.92, 0.03, 0.02); else put('shower', uw - 0.53, 0.53, '+v', 0.0);
  }
  // the kitchen along the corridor wall, between the door and the bathroom (the fridge by the door when it's short)
  const k0 = 1.75;
  if (bu - k0 >= 4.05) { back('kitchen', 'v0', k0 + 1.5); back('fridge', 'v0', k0 + 3.5); }
  else if (bu - k0 >= 2.75) { back('counter', 'v0', k0 + 0.9); back('fridge', 'v0', k0 + 2.3); }
  else if (!back('counter', 'v0', k0 + 0.9)) { back('fridge', 'u0', 1.4); back('counter', 'u0', 2.9); }   // a narrow studio: both on the entry wall
  else back('fridge', 'u0', 1.45);
  if (kind === 'studio') {
    // one room by the windows: the bed against the door-end wall, a sofa facing the TV on the far wall, a small table
    const dbl = hand || (uw >= 6.0 && rng.chance(0.7)), bt = dbl ? 'bed_double' : 'bed_single', bh = dbl ? 0.85 : 0.5;   // (see the second bedroom)
    if (back(bt, 'u0', ud - 0.9 - bh, 0.04)) back('nightstand', 'u0', ud - 0.55);
    back('wardrobe', 'u0', Math.max(2.25, ud - 3.3 - 0.7)) || back('wardrobe', 'v1', 3.2);
    const liveV = Math.max(bv + 1.6, (bv + ud) / 2 + 0.35);
    if (back('tv_stand', 'u1', liveV)) {
      put('rug', uw - 2.1, liveV, '+u');
      put('coffee_table', uw - 1.2, liveV, '+u');
      put('sofa', uw - 2.95, liveV, '+u') || put('armchair', uw - 2.7, liveV, '+u');
    }
    if (uw >= 6.0) put('cafe_table', k0 + 0.95, 2.35, '+u');   // along the kitchen (in a narrower studio it would stand in the way)
    if (uw >= 7.0) back('desk_home', 'v1', uw - 1.0);
    put('plant', uw - 0.35, ud - 0.35, '+v', 0.02);
    put('floor_lamp', uw - 0.3, liveV + 1.4, '+v', 0.02);
  } else {
    // bedrooms by the windows: the main one in the far corner, a second one at the door end in a two-bedroom flat
    const rd = Math.max(2.9, Math.min(3.6, ud - bv - 1.1)), rv = ud - rd;   // bedroom depth and where it starts (a hall to the bathroom)
    const r0 = uw - 3.7;
    wallUV(r0, rv, r0, ud, [[0.65, 0.9]]);
    if (rv > bv + 0.05) wallUV(r0, rv, uw, rv); else wallUV(r0, rv, bu, rv);   // (else the bathroom opens off the bedroom)
    zoneUV(r0, rv, uw, ud, rng.pick(['carpet_warm', 'wood', 'carpet']));
    const bc = r0 + 1.95;
    if (back('bed_double', 'v1', bc, 0.04)) { back('nightstand', 'v1', bc - 1.15); back('nightstand', 'v1', bc + 1.15); }
    back('wardrobe', 'u1', rv + 0.85);
    let liv0 = 0;
    if (kind === 'two') {
      const s1 = 3.3;
      wallUV(s1, rv, s1, ud, [[0.65, 0.9]]);
      wallUV(0, rv, s1, rv);
      zoneUV(0, rv, s1, ud, rng.pick(['carpet', 'wood', 'carpet_blue']));
      // the bed's head on the end wall, its open side to the room (a single bed is got into from one side, which a
      // mirrored or turned-over flat turns round: then it goes by the inner wall and the wardrobe by the windows)
      if (!hand) { if (back('bed_single', 'u0', ud - 0.62, 0.04)) back('nightstand', 'u0', ud - 1.4); atV('wardrobe', rv, +1, 1.0); }
      else { if (back('bed_single', 'u0', rv + 0.68, 0.04)) back('nightstand', 'u0', rv + 1.45); back('wardrobe', 'v1', 1.0); }
      back('desk_home', 'v1', s1 - 0.68) || put('plant', s1 - 0.4, ud - 0.35, '+v', 0.02);
      liv0 = s1;
    }
    // the living room by the windows between them: the TV on one wall, the sofa facing it
    const lv = ud - 1.12, mid = (liv0 + r0) / 2;
    if (liv0 > 0) { atU('tv_stand', liv0, +1, lv); put('coffee_table', liv0 + 1.3, lv, '+u'); put('rug', mid, ud - 1.45, '+u'); put('sofa', r0 - 0.56, lv, '-u') || put('armchair', r0 - 0.56, lv, '-u'); }
    else { back('tv_stand', 'u0', lv); put('rug', 1.9, ud - 1.45, '+u'); put('coffee_table', 1.3, lv, '+u'); put('sofa', Math.min(r0 - 0.56, 2.85), lv, '-u') || put('armchair', 2.6, lv, '-u'); }
    put('floor_lamp', r0 - 0.35, ud - 0.3, '+v', 0.02);
    // eating between the kitchen and the living room, clear of the way to the bedrooms and the bathroom
    const dv = 1.6 + 0.9;   // in front of the kitchen, keeping a 0.9 m way along it
    if (kind === 'two') put('dining_table', mid, dv, '+u') || put('cafe_table4', mid, dv + 0.05, '+v') || put('cafe_table', mid, dv, '+v');
    else if (rv - 1.6 >= 1.75) put('cafe_table', Math.min(3.0, r0 - 1.6), dv, '+v') || put('cafe_table', 2.6, dv, '+v');
    if (uw >= 11.5) back('bookshelf', 'v1', (liv0 + r0) / 2 - 0.2) || atU('bookshelf', r0, -1, rv + 1.2);
    put('plant', r0 - 0.35, rv + 0.3, '+v', 0.02);
  }
  const ax = X(0), bx = X(uw);
  return { x0: r3(Math.min(ax, bx)), z0: r3(z0), x1: r3(Math.max(ax, bx)), z1: r3(z1), door: [r3(doorX), r3(z0)], kind };
}
/** An apartment lobby (floor layouts step 4): the walk from the door to the hall where the elevator is, mailboxes and
 *  parcel lockers by the elevator, a waiting corner beside the door, a bike and parcel room at the far end of a wide
 *  block — placed from the entrance and the elevator, so a resize only moves what stands at the far side wall. */
export function apartmentLobby(L) {
  const base = L.rng.int(1, 2 ** 30), D = (...k) => new RNG(`${base}:${k.join(':')}`);
  const { ix0, ix1, iz0, iz1 } = L;
  L.name = 'Lobby';
  L.zone(ix0, iz0, ix1, iz1, D('floor').pick(['tile', 'terrazzo', 'wood']));
  placeCore(L); reserveEntrance(L, 4);
  const dr = L.b.door;
  L.reserve(ix0 + 2.5, -1.4, dr.x + 1.2, 1.4);
  L.reserve(dr.x - 1.2, -1.4, dr.x + 1.2, iz1);
  L.zone(ix0 + 2.5, -1.4, dr.x + 1.2, 1.4, D('hall').pick(['terrazzo', 'tile_dark', 'marble']));
  // by the elevator: mailboxes and parcel lockers on the back wall, two armchairs facing each other on the front side
  L.with(D('mail'), () => { L.against('mailboxes', 'z', iz0, +1, ix0 + 4.0); L.against('lockers', 'z', iz0, +1, ix0 + 6.1); });
  L.with(D('seats'), () => { L.tryAdd('armchair', [[ix0 + 2.9, iz1 - 2.2, H]]); L.tryAdd('armchair', [[ix0 + 4.6, iz1 - 2.2, -H]]); L.tryAdd('plant', [[ix0 + 3.75, iz1 - 0.45]]); });
  // a reading corner on the back wall past the door: a bookshelf, two armchairs, a lamp
  const room = ix1 - ix0 > 16 ? ix1 - 6 : ix1, bx = dr.x + 3.4;   // (clear of the bike room's door)
  if (bx + 2.4 < room - 1.2) L.with(D('reading'), () => {
    if (L.against('bookshelf', 'z', iz0, +1, bx)) { L.tryAdd('armchair', [[bx - 1.55, iz0 + 1.3, H - 0.4]]); L.tryAdd('armchair', [[bx + 1.55, iz0 + 1.3, -H + 0.4]]); L.tryAdd('floor_lamp', [[bx + 1.55, iz0 + 0.35]]); }
  });
  // beside the door: a waiting corner on one side, a bench on the other
  if (ix1 - dr.x > 7) L.with(D('wait'), () => lounge(L, dr.x + 1.8, 1.8, Math.min(ix1 - 0.2, dr.x + 7.6), iz1 - 0.2, -1));
  L.tryAdd('bench', [[dr.x - 3, iz1 - 0.45, P], [dr.x - 2.5, iz1 - 0.45, P]]);
  for (const x of [dr.x - 1.75, dr.x + 1.75]) L.add('plant_tall', x, iz1 - 0.5);
  for (const [x, z] of [[ix0 + 0.45, iz1 - 0.45], [ix1 - 0.45, iz1 - 0.45]]) L.add('plant_tall', x, z);
  // a wide block has a bike and parcel room at the far end
  if (ix1 - ix0 > 16) {
    const rx0 = ix1 - 6;
    L.wallGaps(rx0, iz0, rx0, -1.6, [[1.2, 1.0]], 0);
    L.wall(rx0, -1.6, ix1, -1.6, 0);
    L.zone(rx0, iz0, ix1, -1.6, 'concrete');
    L.with(D('room'), () => { L.against('lockers', 'z', iz0, +1, ix1 - 3.2); L.against('vending', 'x', ix1, -1, iz0 + 3.0); L.tryAdd('bench', [[rx0 + 2.6, -2.25, P]]); });
  } else L.add('plant_tall', ix1 - 0.45, iz0 + 0.45);
}

// ---------------------------------------------------------------------------------------------
// Commercial (floor layouts step 4, 2026-10-04): the counter, kitchen or shelving on the back wall, the entrance in the
// middle of the front with the staff place beside it, and tables, shelves or machines on fixed grids out from the door and
// in from the windows, each with its own dice.
const dice = (base, ...k) => new RNG(`${base}:${k.join(':')}`);
export function cafeFloor(L, o = {}) {
  const base = L.rng.int(1, 2 ** 30), D = (...k) => dice(base, ...k);
  const { ix0, ix1, iz0, iz1 } = L, dr = L.b.door, ground = o.ground !== false;
  L.name = o.name || 'Café'; L.venue = 'cafe';
  L.zone(ix0, iz0, ix1, iz1, D('floor').pick(['wood', 'wood_dark', 'terrazzo', 'tile']));
  placeCore(L);
  if (ground) reserveEntrance(L, 3.2);
  const A = anchorOf(L, ground, 1.2), cs = A.cs;
  // the counter on the back wall: facing the door on the street floor, beside the elevator above it
  let cx = A.x;
  if (cs && cx + 2.9 > cs.x0 && cx - 2.9 < cs.x1) cx = cs.x0 - 3.0 >= ix0 + 2.9 ? cs.x0 - 3.0 : cs.x1 + 3.0;
  L.with(D('counter'), () => {
    L.zone(cx - 3.0, iz0, cx + 3.0, iz0 + 3.3, D('counter-floor').pick(['tile', 'tile_dark', 'terrazzo']));
    L.add('cafe_counter', cx, iz0 + 2.3, 0);
    L.against('coffee_machine', 'z', iz0, +1, cx - 0.9); L.against('fridge', 'z', iz0, +1, cx + 0.4); L.against('counter', 'z', iz0, +1, cx + 1.85);
    L.tryAdd('plant_tall', [[cx - 2.75, iz0 + 0.45], [cx + 2.75, iz0 + 0.45]]);
  });
  // window bars in the front corners (stools facing the street), a sofa bench and shelves on the side walls
  L.with(D('bars'), () => { for (const x of [ix0 + 1.65, ix1 - 1.65]) if (!ground || Math.abs(x - dr.x) > 4.2) L.add('bar_counter', x, iz1 - 0.6, P, null, 0.05); });
  L.with(D('sides'), () => {
    L.tryAdd('sofa', [[ix0 + 0.5, iz1 - 4.2, H], [ix0 + 0.5, iz1 - 6.6, H]]);
    L.tryAdd('bookshelf', [[ix1 - 0.23, iz0 + 3.6, -H], [ix0 + 0.23, iz0 + 3.6, H]]);
    L.tryAdd('floor_lamp', [[ix0 + 0.35, iz1 - 2.9], [ix0 + 0.35, iz1 - 5.6]]);
  });
  // tables on the grid, each with its own dice
  for (const r of A.rows(1.6, 2.45, iz0 + 4.4)) for (const c of A.cols(2.45, 0.95)) {
    if (A.door(c, r, 2.6)) continue;
    const d = D('table', c.side, c.k, r.r);
    L.with(d, () => (d.chance(0.3) ? L.add('cafe_table4', c.x, r.z, 0, null, 0.1) : null) || L.add('cafe_table', c.x, r.z, d.chance(0.5) ? 0 : H, null, 0.1));
  }
  if (ground) for (const x of [dr.x - 1.9, dr.x + 1.9]) L.add('plant', x, iz1 - 0.4);
  for (const [x, z] of [[ix0 + 0.4, iz0 + 0.4], [ix1 - 0.4, iz0 + 0.4]]) L.add('plant', x, z);
}
// The café redone (Floor Themes and the city's own cafés, 2026-10-26, the product owner: "the current Cafe floor
// type/building layout needs to be redone from scratch ... highly detailed unique and distinct layouts that are nice to
// visit and have style"): five styles (shared/floor-themes.js CAFE_STYLES; client/js/render/furniture-cafe.js), one plan
// sized to any floor: the counter on the back wall (its pastry case and condiment bar beside it, menu boards over it,
// room for the queue), the style's corner (the roaster, a reading nook by the hearth), a centrepiece on a big floor (a
// communal table, a fountain), its walls (booths, books, shelves, palms), seats along the front windows, then tables
// filling the room in the style's mix, plants in the corners and its lights or ivy over the tables.
const CAFE_KIT = {
  bistro: { floor: ['cream_tile', 'marble', 'cream_tile'], bar: 'wood_dark', counter: 'counter_bistro', body: ['#4a2c1f', '#5b2a22', '#2f3a2a', '#1f2c4a'],
    seats: [['bistro_set', 6], ['cafe_table4', 2]], wallSeat: 'cafe_booth', front: 'bistro_set', backDeco: 'gilt_mirror', corner: 'cafe_palm', lounge: ['sofa', 'armchair', 'armchair'], rug: 'wood_dark' },
  nordic: { floor: ['pale_oak'], bar: 'concrete', counter: 'counter_nordic', body: ['#c9a878', '#d8c4a0', '#b89a70'],
    seats: [['bistro_set', 3], ['cafe_table', 3], ['cafe_table4', 1]], center: 'communal_table', feature: ['coffee_roaster', 'bean_sacks'], front: 'window_ledge',
    corner: 'plant_tall', ceiling: 'hanging_ivy', lounge: ['sofa', 'armchair', 'armchair'], rug: 'wood' },
  loft: { floor: ['concrete', 'warm_concrete'], bar: 'tile_dark', counter: 'counter_loft', body: ['#6b6e70', '#4a4e52', '#5a4a3a'],
    seats: [['cafe_table', 4], ['cafe_table4', 2], ['bistro_set', 1]], wallSeat: 'cafe_booth', wallDeco: 'pipe_shelf', feature: ['bean_sacks'], front: 'window_ledge',
    corner: 'plant_tall', ceiling: 'edison_pendants', lounge: ['sofa_l', 'armchair'], rug: 'wood_dark' },
  library: { floor: ['wood_dark', 'smoked_oak'], bar: 'wood_dark', counter: 'counter_library', body: ['#3b2418', '#2a1a12'],
    seats: [['cafe_table4', 3], ['bistro_set', 2], ['wingback_set', 2]], wallDeco: 'library_wall', nook: true, front: 'wingback_set', corner: 'floor_lamp', rug: 'carpet_warm' },
  garden: { floor: ['terracotta'], bar: 'cream_tile', counter: 'counter_garden', body: ['#c49a62', '#b88c58'],
    seats: [['rattan_set', 6], ['cafe_table4', 1]], center: 'fountain_tiered', wallDeco: 'cafe_palm', front: 'rattan_set', corner: 'cafe_palm', ceiling: 'hanging_ivy', lounge: ['rattan_set', 'cafe_palm', 'rattan_set'], rug: 'travertine' },
};
/** Order Up's kitchen (PLAN-RESTAURANT-GAME.md phase 1b, 2026-10-26: "make space for the kitchen for the gaming module"):
 *  a room in a back corner, away from the elevator, about a third of the floor wide and 3.6 m deep, tiled, with a door
 *  and a pass to the café, kept empty (the stations come in phase 2). null on a floor too small. */
function cafeKitchen(L, D, cs, ax = 0) {   // ax: the entrance's or the elevator's x (a corner kitchen's inner wall on a metre's step from it)
  const { ix0, ix1, iz0, iz1 } = L, W = ix1 - ix0, Dp = iz1 - iz0;
  if (W < 12 || Dp < 10) return null;
  const kw = Math.min(8.5, Math.max(4.4, W * 0.3)), kd = W >= 24 && Dp >= 18 ? 4.8 : 3.6;   // (a big floor's kitchen deeper: an island down the middle)
  // (its stations follow what the café sells as it comes: shared/kitchen-module.js; a tight kitchen gives the menu's first)
  const menu = placeMenu({ name: L.name, venue: 'cafe' }) || [];
  return cafeKitchenAt(L, D, cs, ax, kw, kd, { needs: kitchenNeeds(menu), menu });

}
function cafeKitchenAt(L, D, cs, ax, kw, kd, { needs, menu }) {
  const { ix0, ix1, iz0 } = L, W = ix1 - ix0;
  const mid = (ix0 + ix1) / 2, z0 = iz0, z1 = iz0 + kd, cands = [];
  const cside = cs ? ((cs.x0 + cs.x1) / 2 < mid ? -1 : 1) : 0;
  if (cs && (cside > 0 ? ix1 - cs.x1 : cs.x0 - ix0) < 3.5) {   // an elevator by a side wall: the kitchen beside its core along the back wall (a service lift), a set width, so it keeps its place by the elevator when the floor is resized
    const s = cside, cw = W >= 26 ? 7 : 5.6;
    cands.push(s > 0 ? [cs.x0 - 0.6 - cw, cs.x0 - 0.6, s] : [cs.x1 + 0.6, cs.x1 + 0.6 + cw, s]);
  }
  for (const side of cs ? ((cs.x0 + cs.x1) / 2 < mid ? [1, -1] : [-1, 1]) : D('kside').chance(0.5) ? [1, -1] : [-1, 1]) {   // else in a back corner
    const edge = side > 0 ? ix1 - kw : ix0 + kw, step = ax + side * Math.floor(side * (edge - ax));   // (the inner wall a whole number of metres from ax, towards the room: never narrower)
    cands.push(side > 0 ? [step, ix1, side] : [ix0, step, side]);
  }
  for (const [x0, x1, side] of cands) {
    if (x0 < ix0 - 1e-6 || x1 > ix1 + 1e-6 || x1 - x0 < 4.4) continue;
    if (cs && cs.x0 < x1 + 0.55 && cs.x1 > x0 - 0.55 && cs.z0 < z1 + 0.6) continue;
    if (keepClear(L.b, 1).some(c => rectsOverlap({ x0, x1, z0, z1: z1 + PASS_BAND }, c, 0))) continue;   // (clear of the elevator's doors, as an interior module must be)
    const inner = side > 0 ? x0 : x1, km = inner + side * (x1 - x0 >= 7 ? 3.6 : 2.9);   // (the hatch a set way from the inner wall, past the door)
    // the kitchen is an interior module (shared/kitchen-module.js, PLAN-RESTAURANT-GAME.md 6b K2): its walls (the door
    // and the hatch in the front), its tiled floor and its stations laid by it, tagged with its record, which the floor
    // keeps; its rectangle takes the strip in front of the hatch the pass reaches over
    const rec = { id: `m${(L.mods || []).length + 1}`, kind: 'kitchen', name: 'Kitchen', x0, z0, x1, z1: z1 + PASS_BAND, face: 0, data: { side, kitchen: 'coffee', needs, menu } };   // (what the café sells as it comes: its stations, and what its Rushes order)
    const k = kitchenLayout(L.b, rec), tag = (list, n0) => { for (let i = n0; i < list.length; i++) list[i][5] = rec.id; };
    let n0 = L.walls.length; for (const w of k.walls) L.wall(w[0], w[1], w[2], w[3]); tag(L.walls, n0);
    n0 = L.zones.length; for (const z of k.zones) L.zone(...z); tag(L.zones, n0);
    for (const it of k.items) L.addFixed(it.t, it.x, it.z, it.r).mod = rec.id;
    (L.mods || (L.mods = [])).push(rec);
    L.reserve(x0, z0, x1, z1 + 1.0);
    return { x0, x1, z0, z1, side, inner, mid: km };
  }
  return null;
}
/** The bistro (classic Parisian): the zinc bar along a side wall with its stools, banquettes along the windows and the
 *  walls, little marble tables close together, posters and brass sconces, a coat stand and the papers by the door. */
function bistroPlan(L, D, K, c) {
  const { ix0, ix1, iz0, iz1 } = L, { A, put, kit, doorX, nearDoor } = c, H2 = H;
  // (a clear aisle in front of a piece: its seats stay reachable when the tables fill the room)
  const aisle = (it, depth = 1.0) => { if (!it) return it; const d = CATALOG[it.t], sn = Math.sin(it.r), co = Math.cos(it.r), hw = (d.rect[2] - d.rect[0]) / 2;
    const pts = [[-hw, d.rect[3]], [hw, d.rect[3]], [-hw, d.rect[3] + depth], [hw, d.rect[3] + depth]].map(([lx, lz]) => [it.x + lx * co + lz * sn, it.z - lx * sn + lz * co]);
    L.reserve(Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))); return it; };
  const barSide = kit ? -kit.side : (D('barside').chance(0.5) ? 1 : -1), wallX = barSide > 0 ? ix1 : ix0, inward = -barSide;
  let bar = null;
  for (let z = iz0 + 3.4; z < iz1 - 3.2 && !bar; z += 0.5) bar = put('zinc_bar', wallX + inward * 1.71, z, inward > 0 ? H2 : -H2, D('body').pick(K.body));
  if (bar) {
    L.zone(wallX, bar.z - 2.7, wallX + inward * 3.3, bar.z + 2.7, 'wood_dark');
    for (const dz of [-1.8, 0, 1.8]) L.against(dz ? 'gilt_mirror' : 'menu_board', 'x', wallX, inward, bar.z + dz);
    L.reserve(wallX + inward * 2.3, bar.z - 2.4, wallX + inward * 3.6, bar.z + 2.4);
    L.tryAdd('pastry_vitrine', [[wallX + inward * 1.5, bar.z + barSide * 0 + 3.0, inward > 0 ? H2 : -H2], [wallX + inward * 1.5, bar.z - 3.0, inward > 0 ? H2 : -H2]]);
  } else if (!put(K.counter, (ix0 + ix1) / 2, iz0 + 2.25)) L.add('cafe_counter', (ix0 + ix1) / 2, iz0 + 2.3, 0);
  // the windows: banquettes either side of the door; the walls: banquettes with posters and sconces over them
  for (let k = 0; k < 30; k++) { const x = (doorX ?? A.x) + (k % 2 ? 1 : -1) * (Math.floor(k / 2) * 4.4 + 2.2); if (x < ix0 + 2.2 || x > ix1 - 2.2 || nearDoor(x, 3.4)) continue; aisle(L.against('banquette_long', 'z', iz1, -1, x)); }
  const sideX = barSide > 0 ? ix0 : ix1, sIn = barSide > 0 ? 1 : -1;
  for (let z = (kit ? kit.z1 + 1.4 : iz0 + 1.5); z < iz1 - 3.0; z += 4.4) if (aisle(L.against('banquette_long', 'x', sideX, sIn, z + 2.2))) { L.against('poster_frame', 'x', sideX, sIn, z + 1.2); L.against('cafe_sconce', 'x', sideX, sIn, z + 2.2); L.against('poster_frame', 'x', sideX, sIn, z + 3.2); }
  for (let x = ix0 + 1.2; x < ix1 - 1.2; x += 2.2) { if (kit && x > kit.x0 - 0.5 && x < kit.x1 + 0.5) continue; L.against((Math.round(x * 10) % 2) ? 'cafe_sconce' : 'poster_frame', 'z', iz0, +1, x); }
  // a big floor's sides: lounges between the walls' pieces and the room; the room: marble bistro tables close together, a few for four
  cafeSideZones(L, D, c, 'bistro', { half: 0.26, inset: barSide > 0 ? [2.4, 3.8] : [3.8, 2.4] });
  for (const r of A.rows(2.6, 2.05, iz0 + 4.4)) for (const cc of A.cols(2.2, 0.9)) {
    if (A.door(cc, r, 2.6)) continue;
    const d = D('bt', cc.side, cc.k, r.r);
    L.with(d, () => put(d.chance(0.82) ? 'bistro_set' : 'cafe_table4', cc.x, r.z, d.chance(0.5) ? 0 : H2, null, 0.1));
  }
  if (doorX != null) { put('coat_stand', doorX - 2.0, iz1 - 0.6); L.against('newspaper_rack', 'z', iz1, -1, doorX + 2.1); }
  L.tryAdd('condiment_bar', kit ? [[kit.inner - kit.side * 0.9, kit.z1 + 1.4]] : [[ix0 + 1, iz0 + 1]]);
  for (const [x, z] of [[ix0 + 0.45, iz1 - 0.45], [ix1 - 0.45, iz1 - 0.45]]) put('cafe_palm', x, z);
}
/** The book café (cozy): walls of books, bookshelf dividers making bays off the aisle, each bay its own room (a reading
 *  table, wingbacks, a sofa) on its own rug, the fireplace lounge, a piano and a globe, lamps everywhere. */
function libraryPlan(L, D, K, c) {
  const { ix0, ix1, iz0, iz1 } = L, { A, cs, put, kit, doorX } = c, mid = (ix0 + ix1) / 2;
  // the counter on the back wall, beside the kitchen's pass when there is one
  const cx0 = Math.min(ix1 - 2.3, Math.max(ix0 + 2.3, kit ? kit.inner - kit.side * 3.2 : A.x));
  let ctr = null;
  for (let k = 0; k < 64 && !ctr; k++) { const x = cx0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5; ctr = put(K.counter, x, iz0 + 2.25, 0, D('body').pick(K.body)); }
  if (!ctr) for (let k = 0; k < 30 && !ctr; k++) ctr = L.add('cafe_counter', cx0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5, iz0 + 2.3, 0);
  if (ctr) { L.zone(ctr.x - 3.0, iz0, ctr.x + 3.0, iz0 + 3.4, 'smoked_oak'); L.reserve(ctr.x - 2.3, iz0 + 2.75, ctr.x + 2.3, iz0 + 4.0); L.against('menu_board', 'z', iz0, +1, ctr.x); L.tryAdd('pastry_vitrine', [[ctr.x + 2.9, iz0 + 2.25], [ctr.x - 2.9, iz0 + 2.25]]); }
  // the walls: books from the counter to the front
  for (const [wx, s] of [[ix0, 1], [ix1, -1]]) for (let z = iz0 + 1.7; z < iz1 - 1.6; z += 3.05) L.against('library_wall', 'x', wx, s, z);
  // the bays: dividers out from each wall, a room between each pair
  const bays = [];
  for (const [wx, s] of [[ix0, 1], [ix1, -1]]) {
    if ((kit && Math.sign(wx - mid) === kit.side) || ix1 - ix0 < 16) continue;   // (a narrow floor: no bays, the room stays open)
    for (let z = iz0 + 4.6; z < iz1 - 2.5; z += 4.3) { const it = put('bookshelf_divider', wx + s * 1.95, z, H); if (it) bays.push({ wx, s, z: z + 2.15 }); }
  }
  bays.forEach((b, k) => L.with(D('bay', k), () => {
    const x = b.wx + b.s * 2.3, z = b.z, kind = ['library_table', 'wingback_set', 'sofa'][k % 3];
    L.zone(b.wx + b.s * 0.6, z - 1.9, b.wx + b.s * 3.9, z + 1.9, 'carpet_warm');
    if (kind === 'sofa') { put('sofa', b.wx + b.s * 1.1, z, b.s > 0 ? H : -H); put('coffee_table', b.wx + b.s * 2.2, z, b.s > 0 ? H : -H); put('armchair', b.wx + b.s * 3.2, z, b.s > 0 ? -H : H); }
    else put(kind, x, z, kind === 'wingback_set' ? (b.s > 0 ? H : -H) : H);
    put('floor_lamp', b.wx + b.s * 0.55, z - 1.55);
  }));
  // the fireplace lounge on the front half of a wall, the piano and the globe
  const hx = kit ? (kit.side > 0 ? ix1 : ix0) : ix1, hs = hx === ix1 ? -1 : 1, hz = Math.max(iz0 + 6, iz1 - 4.2);
  if (L.against('hearth', 'x', hx, hs, hz)) { L.zone(hx + hs * 0.4, hz - 2.4, hx + hs * 4.4, hz + 2.4, 'carpet_warm'); put('wingback_set', hx + hs * 1.8, hz, hs > 0 ? H : -H); put('sofa', hx + hs * 3.6, hz, hs > 0 ? -H : H); L.tryAdd('globe_stand', [[hx + hs * 1.0, hz + 2.0], [hx + hs * 1.0, hz - 2.0]]); }
  L.tryAdd('piano', [[mid + 3, iz1 - 2.2, P], [mid - 3, iz1 - 2.2, P]]);
  // the reading room down the middle: long tables under the lamps
  for (const r of A.rows(3.2, 2.6, iz0 + 4.6)) for (const cc of A.cols(2.6, 1.1)) { if (A.door(cc, r, 2.6)) continue; const d = D('rt', cc.side, cc.k, r.r); L.with(d, () => put(d.chance(0.6) ? 'library_table' : 'bistro_set', cc.x, r.z, d.chance(0.5) ? 0 : H, null, 0.15)); }
  if (doorX != null) for (const x of [doorX - 1.9, doorX + 1.9]) put('plant_tall', x, iz1 - 0.45);
}
/** Calls fn(x, z, i, j) on a grid of px by pz over a rectangle (the centres in it; what doesn't fit, put refuses): its
 *  columns on ax's (the entrance or the elevator: a floor a metre wider keeps its tables where they were), rows from z0. */
function gridIn(x0, z0, x1, z1, px, pz, fn, ax = 0) {
  const nz = Math.max(0, Math.floor((z1 - z0) / pz));
  for (let k = Math.ceil((x0 - ax) / px - 1e-6); ax + k * px <= x1 + 1e-6; k++) for (let j = 0; j < nz; j++) fn(ax + k * px, z0 + pz / 2 + j * pz, k + 100, j);
}
/** x on a metre's step from ax (a counter by the kitchen stays put while the kitchen's edge moves a little). */
const onStep = (x, ax) => ax + Math.round(x - ax);
/** A back-wall counter for a plan: the style's own where it fits, else the Café Counter; its pastry case and menu. */
function backCounter(L, D, K, c, x0) {
  const { iz0 } = L, { put } = c;
  let ctr = null;
  for (let k = 0; k < 40 && !ctr; k++) ctr = put(K.counter, x0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5, iz0 + 2.25, 0, D('body').pick(K.body));
  for (let k = 0; k < 40 && !ctr; k++) ctr = L.add('cafe_counter', x0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5, iz0 + 2.3, 0);
  if (ctr) { L.zone(ctr.x - 3.0, iz0, ctr.x + 3.0, iz0 + 3.4, K.bar); L.reserve(ctr.x - 2.3, iz0 + 2.75, ctr.x + 2.3, iz0 + 4.0); L.against('menu_board', 'z', iz0, +1, ctr.x); L.tryAdd('pastry_vitrine', [[ctr.x + 2.9, iz0 + 2.25], [ctr.x - 2.9, iz0 + 2.25]]); }
  return ctr;
}
/** The side rooms of a big café (phase 1b part 3, "make them all look really nice and pretty"): the dining room keeps to a
 *  band about the entrance (upstairs the elevator) and each side beyond it becomes a place to sit back: a lounge of sofa
 *  groups on rugs (in the garden café a terrace of tables under vine trellises between flower beds) behind the style's
 *  dividers (with ways in), the style's pieces along its wall. Returns the dining band [x0, x1] (the whole floor when small). */
const CAFE_ZONES = {
  bistro: { floor: 'wood_dark', sofa: 'sofa', sc: '#7a2a2a', ac: '#6a4a3a', rug: '#7a2a2a', divider: 'cafe_palm', wall: ['gilt_mirror', 'poster_frame'], against: true },
  nordic: { floor: 'pale_oak', sofa: 'sofa', sc: '#cfc7b8', ac: '#7a8a6a', rug: '#a8b0a0', over: 'paper_pendant', divider: 'planter_box', dc: '#d9d2c4', wall: ['plant_wall', 'slat_wall'], against: true },
  loft: { floor: 'wood_dark', sofa: 'sofa_l', sc: '#5a3a2a', ac: '#3a3a3a', rug: '#4a5a6a', over: 'edison_pendants', divider: 'mesh_partition', wall: ['chalk_wall', 'neon_coffee'], against: true },
  garden: { floor: 'terracotta', garden: true, divider: 'hedge_planter', dc: '#d9d2c4', wall: ['stone_urn', 'cafe_palm'] },
};
function cafeSideZones(L, D, c, sid, o = {}) {   // o.half: the band's half width as a share of the floor's (about a third); o.inset [left, right]: wall pieces of the plan's own kept clear
  const { ix0, ix1, iz0, iz1 } = L, { put, kit, A } = c, Z = CAFE_ZONES[sid], ax = c.doorX ?? A.x, W = ix1 - ix0, half = Math.max(8, 2.4 * Math.round((o.half ?? 0.32) * W / 2.4)), band = [ix0, ix1];   // (the band's width in steps: a metre wider keeps it)
  if (!Z || W < 26) return band;
  for (const s of [-1, 1]) {
    const inset = o.inset?.[s < 0 ? 0 : 1] || 0, edge = ax + s * half, wall = (s < 0 ? ix0 : ix1) - s * inset, x0 = Math.min(edge, wall), x1 = Math.max(edge, wall), d = -s, cx = edge + s * 2.3;   // (the groups by the room's edge)
    if ((wall - edge) * s < 4.4) continue;   // (a side room at least 4.4 m wide, inside the walls)
    const z0 = Math.max(iz0 + 4.6, kit && kit.x1 > x0 && kit.x0 < x1 ? kit.z1 + 1.4 : -1e9), z1 = iz1 - 1.4;
    if (z1 - z0 < 5) continue;
    band[s < 0 ? 0 : 1] = edge;
    L.zone(x0, z0 - 0.6, x1, z1 + 0.6, Z.floor);
    for (let k = 0, z = z0 + 0.9; z < z1 - 0.9; k++, z += 2.4) if (k % 3 !== 1) put(Z.divider, edge, z, H, Z.dc ?? null);   // (every third left open: the ways in)
    for (let k = 0, z = z0 + 2.4; z <= z1 - 2.2; k++, z += 4.6) {
      if (Z.garden) {
        put('vine_trellis', cx, z); put('rattan_set', cx, z - 0.75, 0); put('rattan_set', cx, z + 0.75, 0);
        put('flower_bed', cx, z - 2.0, 0, '#b9a48a'); if (k % 2 === 0) put('birdcage', cx + 1.0, z + 1.4);
        continue;
      }
      if (!put(Z.sofa, cx - d * 1.2, z, d > 0 ? H : -H, Z.sc)) continue;
      put('cafe_rug', cx, z, H, Z.rug); put('coffee_table', cx, z, H);
      for (const o of [-0.78, 0.78]) put('armchair', cx + d * 1.15, z + o, d > 0 ? -H : H, Z.ac);
      put('floor_lamp', cx - d * 1.25, z + (Z.sofa === 'sofa_l' ? 1.75 : 1.45));
      if (Z.over) put(Z.over, cx, z);
    }
    if (!inset) for (let k = 0, z = z0 + 1.0; z < z1 - 0.5; k++, z += 2.8) { const t = Z.wall[k % Z.wall.length]; if (Z.against) L.against(t, 'x', wall, d, z); else put(t, wall + d * 0.5, z); }
    L.reserve(x0, z0 - 0.6, x1, z1 + 0.6);
  }
  return band;
}
/** The roastery (Nordic modern): calm and open, an island bar in the room with the roaster behind it, long communal
 *  tables in rows under hanging plants, a living plant wall, window ledges, a few large pieces and room to breathe. */
function roasteryPlan(L, D, K, c) {
  const { ix0, ix1, iz0, iz1 } = L, { put, kit, doorX, nearDoor, A } = c, mx = (doorX ?? A.x) + (kit ? -kit.side * 1.5 : 0);
  const iz = iz0 + 6.2, roomy = iz1 - iz0 >= 18 && ix1 - ix0 >= 16;
  let island = roomy ? put(K.counter, mx, iz, 0, D('body').pick(K.body)) : null;
  if (island) {
    L.zone(mx - 3.6, iz - 3.4, mx + 3.6, iz + 1.6, 'concrete');
    put('coffee_roaster', mx - 1.4, iz - 2.0, P); put('bean_sacks', mx + 1.3, iz - 2.1);
    L.tryAdd('pastry_vitrine', [[mx + 2.9, iz], [mx - 2.9, iz]]);
    L.reserve(mx - 2.3, iz + 0.5, mx + 2.3, iz + 1.8);
  } else if ((island = backCounter(L, D, K, c, kit ? onStep(kit.inner - kit.side * 3.2, A.x) : A.x))) { L.tryAdd('coffee_roaster', [[island.x - 3.6, iz0 + 1.0], [island.x + 3.6, iz0 + 1.0]]); L.tryAdd('bean_sacks', [[island.x + 3.4, iz0 + 2.4], [island.x - 3.4, iz0 + 2.4]]); }
  const [bx0, bx1] = cafeSideZones(L, D, c, 'nordic');
  if (island && roomy) for (let x = bx0 + 1.5; x < bx1 - 1.4; x += 2.6) if (!kit || x < kit.x0 - 1.4 || x > kit.x1 + 1.4) L.against('slat_wall', 'z', iz0, 1, x);   // (oak slats along the back wall behind the island)
  const plantWall = kit ? (kit.side > 0 ? ix0 : ix1) : ix0, pw = plantWall === ix0 ? 1 : -1;
  if ((pw > 0 ? bx0 : bx1) === plantWall) for (let z = iz0 + 1.6; z < iz1 - 1.4; z += 3.4) { if (!L.against('plant_wall', 'x', plantWall, pw, z)) put('cafe_palm', plantWall + pw * 0.5, z); put('cafe_palm', plantWall + pw * 0.5, z + 1.7); }
  const rows0 = island && roomy ? island.z + 2.6 : iz0 + 4.6;
  gridIn(bx0 + 1.6, rows0, bx1 - 1.6, iz1 - 2.4, 4.4, 2.6, (x, z, i, j) => { if (Math.abs(x - (doorX ?? 1e9)) < 2.6 && z > iz1 - 4) return; if (put(i % 3 === 2 ? 'bistro_set' : 'communal_table', x, z, 0, null, 0.15) && (i + j) % 2 === 0) put(i % 3 === 2 ? 'hanging_ivy' : 'paper_pendant', x, z); }, mx + 2.2);
  for (let k = 0; k < 30; k++) { const x = (doorX ?? A.x) + (k % 2 ? 1 : -1) * (Math.floor(k / 2) * 2.75 + 1.4); if (x < bx0 + 1.5 || x > bx1 - 1.5 || nearDoor(x, 2.9)) continue; L.against('window_ledge', 'z', iz1, -1, x); }
}
/** The coffee lab (industrial modern): the steel bar on the back wall with the roaster as its lab, a raised platform of
 *  high tables (window ledges back to back) on one side, booths under pipe shelving on the other, Edison bulbs over all. */
function loftPlan(L, D, K, c) {
  const { ix0, ix1, iz0, iz1 } = L, { put, kit, doorX, nearDoor, A } = c, mid = (ix0 + ix1) / 2;
  const ctr = backCounter(L, D, K, c, kit ? onStep(kit.inner - kit.side * 3.2, A.x) : A.x);
  if (ctr) {
    put('coffee_roaster', ctr.x - (kit ? kit.side : 1) * 3.4, iz0 + 1.0, 0);
    L.tryAdd('cold_brew_tower', [[ctr.x - 2.9, iz0 + 2.25], [ctr.x + 2.9, iz0 + 2.25], [ctr.x + (kit ? kit.side : 1) * 3.5, iz0 + 1.0]]);
    for (const k of [1, 2]) L.against(k === 1 ? 'neon_coffee' : 'chalk_wall', 'z', iz0, 1, ctr.x + (kit ? -kit.side : 1) * (k === 1 ? 5.6 : 8.4));   // (the neon and the chalk wall along the back, away from the kitchen)
  }
  const [bx0, bx1] = cafeSideZones(L, D, c, 'loft'), bmid = (bx0 + bx1) / 2;
  const pside = kit ? kit.side : 1, px0 = pside > 0 ? bmid + 0.5 : bx0 + 0.6, px1 = pside > 0 ? bx1 - 0.6 : bmid - 0.5, pz0 = iz0 + 5.0, pz1 = Math.min(iz1 - 1.2, iz0 + 5.0 + 9.3);
  const wide = bx1 - bx0 >= 19.5;
  if (wide && px1 - px0 > 5) { L.zone(px0, pz0, px1, pz1, 'tile_dark');
    for (let k = 0, z = pz0 + 1.0; z < pz1 - 0.6; k++, z += 2.3) if (k % 3 !== 1) put('mesh_partition', pside > 0 ? px0 - 0.3 : px1 + 0.3, z, H);   // (the platform's mesh screens, with ways up)
    gridIn(px0, pz0, px1, pz1, 3.0, 3.1, (x, z) => { if (nearDoor(x, 2.6) && z > iz1 - 3.5) return; if (put('window_ledge', x, z - 0.47, P, null, 0.05)) { put('window_ledge', x, z + 0.47, 0, null, 0.05); put('edison_pendants', x, z); } }, A.x + 1.5); }
  const bw = pside > 0 ? bx0 : bx1, bs = pside > 0 ? 1 : -1, onWall = bw === ix0 || bw === ix1;
  for (let z = iz0 + 4.8; z < iz1 - 2.2; z += 2.25) { if (put('cafe_booth', bw + bs * (onWall ? 1.04 : 1.4), z + 0.98, bs > 0 ? 0 : P) && onWall) L.against('pipe_shelf', 'x', bw, bs, z + 0.98 + 1.15); }
  gridIn(pside > 0 ? bx0 + 3.0 : (wide ? bmid + 0.6 : bx0 + 0.8), iz0 + 5.0, pside > 0 ? (wide ? bmid - 0.6 : bx1 - 0.8) : bx1 - 3.0, iz1 - 1.6, 2.6, 2.6, (x, z, i, j) => { if (nearDoor(x, 2.6) && z > iz1 - 3.5) return; if (put((i + j) % 2 ? 'cafe_table4' : 'bistro_set', x, z, 0, null, 0.15) && (i + j) % 2) put('edison_pendants', x + 1.1, z); }, A.x);
}
/** The garden café (romantic classic): a courtyard: the fountain in the middle, stone paths crossing to it, four
 *  gardens of rattan tables between palms and hanging ivy, planters all round, the rattan counter at the back. */
function gardenPlan(L, D, K, c) {
  const { ix0, ix1, iz0, iz1 } = L, { put, kit, doorX, A } = c;
  const ctr = backCounter(L, D, K, c, kit ? onStep(kit.inner - kit.side * 3.2, A.x) : A.x);
  const cz0 = iz0 + 4.4, mx = doorX ?? A.x, mz = (cz0 + iz1) / 2;
  const [bx0, bx1] = cafeSideZones(L, D, c, 'garden');
  if (ix1 - ix0 < 15 || iz1 - cz0 < 11) {   // (no room for a courtyard: a garden room of rattan tables among palms)
    gridIn(ix0 + 1.0, cz0, ix1 - 1.0, iz1 - 1.0, 2.3, 2.1, (x, z, i, j) => { if ((i + j) % 4 === 3) put('cafe_palm', x, z); else if (put('rattan_set', x, z, 0, null, 0.1) && (i + j) % 3 === 0) put('hanging_ivy', x + 0.95, z); }, A.x);
    for (const [wx, s] of [[ix0, 1], [ix1, -1]]) for (let z = iz0 + 1.0; z < iz1 - 0.8; z += 2.6) put('cafe_palm', wx + s * 0.5, z);
    return;
  }
  put('fountain_tiered', mx, mz); L.zone(mx - 2.0, mz - 2.0, mx + 2.0, mz + 2.0, 'travertine');
  L.zone(mx - 1.0, cz0, mx + 1.0, iz1, 'travertine'); L.zone(bx0 + 0.8, mz - 1.0, bx1 - 0.8, mz + 1.0, 'travertine');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put('stone_urn', mx + sx * 2.2, mz + sz * 2.2, 0, '#d9d2c4');   // (urns at the fountain's corners)
  for (let z = cz0 + 1.2; z < iz1 - 1.6; z += 3.3) if (Math.abs(z + 1.0 - mz) > 3.4) for (const sx of [-1, 1]) put('hedge_planter', mx + sx * 1.38, z + 1.0, H, '#d9d2c4');   // (hedges along the paths, with ways through)
  for (const s of [-1, 1]) for (let x = mx + s * 3.6; s < 0 ? x > bx0 + 1.6 : x < bx1 - 1.6; x += s * 3.3) for (const sz of [-1, 1]) put('hedge_planter', x + s * 1.0, mz + sz * 1.38, 0, '#d9d2c4');
  L.reserve(mx - 2.6, mz - 2.6, mx + 2.6, mz + 2.6); L.reserve(mx - 1.0, cz0, mx + 1.0, iz1); L.reserve(bx0 + 0.8, mz - 1.0, bx1 - 0.8, mz + 1.0);
  for (const [x0, x1] of [[bx0 + 1.2, mx - 1.2], [mx + 1.2, bx1 - 1.2]]) for (const [z0, z1] of [[cz0, mz - 1.1], [mz + 1.1, iz1 - 1.2]]) {
    let arbour = false;
    gridIn(x0, z0, x1, z1, 2.4, 2.1, (x, z, i, j) => { if ((i + j) % 4 === 3) put('cafe_palm', x, z); else if (put('rattan_set', x, z, (i + j) % 2 ? 0 : H, null, 0.12)) { if (!arbour && (i + j) % 4 === 1) arbour = !!put('vine_trellis', x, z); else if ((i + j) % 4 === 0) put('birdcage', x + 0.95, z); } }, mx + 1.2);
  }
  for (const [wx, s] of [[ix0, 1], [ix1, -1]]) if ((s > 0 ? bx0 : bx1) === wx) for (let z = iz0 + 1.0; z < iz1 - 0.8; z += 2.2) put('cafe_palm', wx + s * 0.5, z);
  if (ctr) L.tryAdd('condiment_bar', [[ctr.x - 2.9, ctr.z + 1.4], [ctr.x + 2.9, ctr.z + 1.4]]);
}
export function cafeThemeFloor(L, o = {}) {
  const base = L.rng.int(1, 2 ** 30), D = (...k) => dice(base, ...k);
  const { ix0, ix1, iz0, iz1 } = L, dr = L.b.door, ground = o.ground !== false;
  const sid = CAFE_KIT[o.style] ? o.style : D('style').pick(Object.keys(CAFE_KIT)), K = CAFE_KIT[sid];
  L.name = o.name || CAFE_STYLES[sid].name; L.venue = 'cafe'; L.style = sid;
  L.zone(ix0, iz0, ix1, iz1, D('floor').pick(K.floor));
  placeCore(L);
  if (ground) reserveEntrance(L, 3.2);
  const A = anchorOf(L, ground, 1.2), cs = A.cs, W = ix1 - ix0;
  const put = (t, x, z, r = 0, c = null, pad = 0.05) => L.add(t, x, z, r, c ? { c } : null, pad);
  const doorX = ground && dr ? dr.x : null, nearDoor = (x, half) => doorX != null && Math.abs(x - doorX) < half;
  // ---- Order Up's kitchen first (kept empty for the stations), then the style's own plan where it has one (phase 1b)
  const kit = cafeKitchen(L, D, cs, A.x);
  if (sid === 'bistro') { bistroPlan(L, D, K, { A, cs, put, kit, doorX, nearDoor }); return sid; }
  if (sid === 'library') { libraryPlan(L, D, K, { A, cs, put, kit, doorX, nearDoor }); return sid; }
  if (sid === 'nordic') { roasteryPlan(L, D, K, { A, cs, put, kit, doorX, nearDoor }); return sid; }
  if (sid === 'loft') { loftPlan(L, D, K, { A, cs, put, kit, doorX, nearDoor }); return sid; }
  if (sid === 'garden') { gardenPlan(L, D, K, { A, cs, put, kit, doorX, nearDoor }); return sid; }
  // ---- the counter on the back wall, clear of the elevator; its queue kept free
  let cx = A.x;
  if (cs && cx + 3.0 > cs.x0 && cx - 3.0 < cs.x1) cx = cs.x0 - 3.3 >= ix0 + 2.6 ? cs.x0 - 3.3 : cs.x1 + 3.3;
  cx = Math.min(ix1 - 2.4, Math.max(ix0 + 2.4, cx));
  // (the long counter where it fits along the back wall, nearest the middle; else the short one; else a side wall: a café
  // always has its order point)
  const tryXs = [];
  for (let k = 0; k < 40; k++) { const x = cx + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5; if (x >= ix0 + 1.7 && x <= ix1 - 1.7) tryXs.push(x); }
  let ctr = null;
  L.with(D('counter'), () => {
    const body = D('body').pick(K.body);
    for (const x of tryXs) if ((ctr = put(K.counter, x, iz0 + 2.25, 0, body))) break;
    if (!ctr) for (const x of tryXs) if ((ctr = L.add('cafe_counter', x, iz0 + 2.3, 0))) break;
    if (!ctr) for (const [wx, side] of [[ix0, +1], [ix1, -1]]) { for (let z = iz0 + 3; z < iz1 - 2.5 && !ctr; z += 0.5) ctr = L.against(K.counter, 'x', wx, side, z) || L.against('cafe_counter', 'x', wx, side, z); if (ctr) break; }
    if (!ctr || ctr.r) return;   // (on a side wall: no more round it)
    cx = ctr.x;
    L.zone(cx - 3.3, iz0, cx + 3.3, iz0 + 3.5, K.bar);
    for (const dx of [-1.15, 1.15]) L.against('menu_board', 'z', iz0, +1, cx + dx);
    L.tryAdd('pastry_vitrine', [[cx + 2.9, iz0 + 2.25], [cx - 2.9, iz0 + 2.25]]);
    L.tryAdd('condiment_bar', [[cx - 2.85, iz0 + 2.3], [cx + 2.85, iz0 + 2.3], [cx - 2.9, iz0 + 3.6, H]]);
    L.reserve(cx - 2.3, iz0 + 2.75, cx + 2.3, iz0 + 4.1);
    if (K.backDeco) for (const x of [cx - 4.2, cx + 4.2]) if (x > ix0 + 0.8 && x < ix1 - 0.8 && !(cs && x > cs.x0 - 0.8 && x < cs.x1 + 0.8)) L.against(K.backDeco, 'z', iz0, +1, x);
  });
  const far = cx < (ix0 + ix1) / 2 ? +1 : -1;   // (the side away from the counter: the style's corner)
  // ---- the open kitchen beside the counter (tiled, its worktops along the back wall: the playable kitchen comes here)
  if (ctr && !ctr.r) L.with(D('kitchen'), () => {
    const k0 = ctr.x - far * 3.6, ks = [];
    for (const dx of [0, 1.9, 3.8]) { const x = k0 - far * dx; if (x < ix0 + 1 || x > ix1 - 1 || (cs && x > cs.x0 - 1.1 && x < cs.x1 + 1.1)) break; ks.push(x); }
    if (ks.length >= 2) {
      L.zone(Math.min(...ks) - 1.0, iz0, Math.max(...ks) + 1.0, iz0 + 2.6, 'tile');
      ks.forEach((x, k) => L.against(['kitchen', 'counter', 'fridge'][k % 3], 'z', iz0, +1, x));
      L.reserve(Math.min(...ks) - 1.0, iz0 + 1.0, Math.max(...ks) + 1.0, iz0 + 2.6);
    }
  });
  // ---- the style's corner: the roaster and its sacks, or a reading nook by the hearth
  if (K.feature) L.with(D('feature'), () => {
    const x = far > 0 ? ix1 - 1.2 : ix0 + 1.2;
    if (put(K.feature[0], x, iz0 + 1.0, far > 0 ? -H : H)) { L.zone(x - 1.4, iz0, x + 1.4, iz0 + 2.4, K.bar); if (K.feature[1]) L.tryAdd(K.feature[1], [[x - far * 1.6, iz0 + 0.5], [x, iz0 + 2.3]]); }
    else if (K.feature[1]) L.tryAdd(K.feature[1], [[x, iz0 + 0.5], [x, iz0 + 2.3]]);
  });
  let nook = null;
  if (K.nook) L.with(D('nook'), () => {
    const wx = far > 0 ? ix1 : ix0, z = Math.min(iz1 - 2.0, Math.max(iz0 + 5.0, (iz0 + iz1) / 2));
    if (L.against('hearth', 'x', wx, -far, z)) {
      nook = { x: wx - far * 1.9, z };
      L.zone(wx - far * 3.4, z - 1.7, wx, z + 1.7, K.rug);
      put('wingback_set', wx - far * 1.75, z, far > 0 ? H : -H);
      L.tryAdd('floor_lamp', [[wx - far * 0.4, z + 1.45], [wx - far * 0.4, z - 1.45]]);
    }
  });
  // ---- the centrepiece on a big floor
  let center = null;
  const mz = (iz0 + 4.3 + iz1) / 2, mx = (ix0 + ix1) / 2 + (cs && Math.abs((ix0 + ix1) / 2 - (cs.x0 + cs.x1) / 2) < 3 ? far * 2.5 : 0);
  if (K.center && W >= 11 && iz1 - iz0 >= 11) L.with(D('center'), () => {
    if (put(K.center, mx, mz, K.center === 'communal_table' ? 0 : 0)) {
      center = { x: mx, z: mz };
      L.reserve(mx - 2.6, mz - 1.5, mx + 2.6, mz + 1.5);
      if (K.center === 'fountain_tiered') L.zone(mx - 1.6, mz - 1.6, mx + 1.6, mz + 1.6, 'travertine');
    }
  });
  // ---- the walls: booths along them, or books, shelves or palms
  for (const side of [-1, 1]) L.with(D('wall', side), () => {
    const wx = side < 0 ? ix0 : ix1;
    for (let z = iz0 + 4.6; z < iz1 - 1.4; z += K.wallSeat ? 2.25 : 3.4) {
      if (nook && Math.sign(wx - (ix0 + ix1) / 2) === Math.sign(nook.x - (ix0 + ix1) / 2) && Math.abs(z - nook.z) < 2.6) continue;
      if (K.wallSeat) put(K.wallSeat, wx - side * 1.04, z + 0.98, side < 0 ? 0 : P);
      else if (K.wallDeco) L.against(K.wallDeco, 'x', wx, -side, z + 1.4);
    }
    if (K.wallSeat && K.wallDeco) for (let z = iz0 + 3.9; z < iz0 + 4.6; z += 3) L.against(K.wallDeco, 'x', wx, -side, z);
  });
  // ---- the front windows: a ledge with stools (or tables) looking out, either side of the door
  if (K.front) L.with(D('front'), () => {
    const step = K.front === 'window_ledge' ? 2.75 : 2.2, mid = doorX != null ? doorX : A.x, xs = [];   // (from the door outward: a wider floor keeps them)
    for (let k = 0; k < 40; k++) { const x = mid + (k % 2 ? 1 : -1) * (Math.floor(k / 2) * step + step / 2); if (x > ix0 + 1.5 && x < ix1 - 1.5) xs.push(x); }
    for (const x of xs) {
      if (nearDoor(x, 2.9)) continue;
      if (K.front === 'window_ledge') L.against('window_ledge', 'z', iz1, -1, x);
      else put(K.front, x, iz1 - 0.75, 0);
    }
  });
  // ---- a lounge corner on a big floor: sofas and armchairs on a rug, away from the counter
  if (K.lounge && W >= 22 && iz1 - iz0 >= 14) L.with(D('lounge'), () => {
    const lx = far > 0 ? ix1 - 4.6 : ix0 + 4.6, lz = iz1 - 4.2;
    if (nearDoor(lx, 5)) return;
    L.zone(lx - 3.4, lz - 2.6, lx + 3.4, lz + 2.6, K.rug);
    put('coffee_table', lx, lz);
    const spots = [[lx, lz - 1.45, 0], [lx - 1.9, lz, H], [lx + 1.9, lz, -H], [lx, lz + 1.45, P]];
    K.lounge.forEach((t, k) => put(t, spots[k][0], spots[k][1], spots[k][2], null, 0.02));
    put(K.corner === 'floor_lamp' ? 'plant_tall' : K.corner, lx + far * 3.0, lz - 2.2);
    L.reserve(lx - 3.4, lz - 2.6, lx + 3.4, lz + 2.6);
  });
  // ---- tables filling the room in the style's mix
  const pick = d => { const tot = K.seats.reduce((t, s) => t + s[1], 0); let r = d.next() * tot; for (const [t, w] of K.seats) { r -= w; if (r <= 0) return t; } return K.seats[0][0]; };
  const placed = [];
  for (const r of A.rows(2.4, 2.75, iz0 + 4.6)) for (const c of A.cols(2.85, 1.1)) {
    if (A.door(c, r, 2.6)) continue;
    if ((c.k + r.r) % 4 === 3) { L.with(D('green', c.side, c.k, r.r), () => { if (D('green', c.side, c.k, r.r).chance(0.55)) put(K.corner === 'floor_lamp' ? 'plant_tall' : K.corner, c.x, r.z); }); continue; }   // (a planter, or room to breathe)
    if (center && Math.abs(c.x - center.x) < 2.8 && Math.abs(r.z - center.z) < 1.9) continue;
    const d = D('seat', c.side, c.k, r.r), t = pick(d);
    const it = L.with(d, () => put(t, c.x, r.z, t === 'cafe_table' || t === 'wingback_set' ? (d.chance(0.5) ? 0 : H) : t === 'bistro_set' || t === 'rattan_set' ? (d.chance(0.5) ? 0 : H) : 0, null, 0.12)
      || put('bistro_set', c.x, r.z, 0, null, 0.12));
    if (it) placed.push(it);
  }
  // ---- corners, plants by the door, and the style's ceiling over the tables
  for (const [x, z] of [[ix0 + 0.45, iz1 - 0.45], [ix1 - 0.45, iz1 - 0.45], [ix0 + 0.45, iz0 + 0.45], [ix1 - 0.45, iz0 + 0.45]]) L.with(D('corner', x, z), () => put(K.corner, x, z));
  if (ground && doorX != null) for (const x of [doorX - 1.95, doorX + 1.95]) put(K.corner === 'floor_lamp' ? 'plant_tall' : K.corner, x, iz1 - 0.45);
  if (K.ceiling) for (let k = 0; k < placed.length; k += 2) { const it = placed[k]; put(K.ceiling, it.x + 1.15, it.z, 0); }
  return sid;
}

export function restaurantFloor(L, o = {}) {
  const base = L.rng.int(1, 2 ** 30), D = (...k) => dice(base, ...k);
  const { ix0, ix1, iz0, iz1 } = L, dr = L.b.door, ground = o.ground !== false;
  L.name = o.name || 'Restaurant'; L.venue = 'restaurant';
  L.zone(ix0, iz0, ix1, iz1, D('floor').pick(['wood_dark', 'wood', 'terrazzo']));
  placeCore(L);
  if (ground) reserveEntrance(L, 3.2);
  const A = anchorOf(L, ground, 1.2), cs = A.cs;
  // the kitchen behind a wall at the back with a pass door; cooking lines out from the middle (or the elevator)
  const kz = iz0 + 4.2, kx1 = cs && cs.x0 < ix1 ? Math.min(ix1, cs.x0) : ix1, pass = A.up ? kx1 - 1.2 : Math.min(kx1 - 1.0, dr.x + 2.2);
  L.wallGaps(ix0, kz, kx1, kz, [[pass - ix0, 1.1]], 0);
  if (kx1 < ix1 - 0.1) L.wall(kx1, iz0, kx1, kz, 0);
  L.zone(ix0, iz0, kx1, kz, 'tile_dark');
  L.with(D('kitchen'), () => {
    for (const c of fromMiddle(A.x, ix0 + 0.2, kx1 - 0.2, 3.3, 1.5, A.up ? A.gap + 0.3 : 0.15)) L.against('kitchen', 'z', iz0, +1, c.x);
    L.tryAdd('fridge', [[pass + 1.4, kz - 0.45, P], [pass - 1.4, kz - 0.45, P], [ix0 + 0.42, kz - 1.3, H]]);
    L.tryAdd('counter', A.up ? [[pass - 2.8, kz - 1.75, 0], [pass - 5.3, kz - 1.75, 0]] : [[dr.x - 1.2, kz - 1.75, 0], [dr.x - 4.5, kz - 1.75, 0]]);   // clear of the way in from the pass
  });
  // the bar against the kitchen wall; the host's stand by the door on the street floor
  const bx = A.up ? A.x - A.gap - 3.0 : dr.x - 4.4;
  L.with(D('bar'), () => L.tryAdd('bar_counter', [[bx, kz + 0.7, 0], [bx - 3.4, kz + 0.7, 0], [dr.x + 5.6, kz + 0.7, 0]]));
  if (ground) L.with(D('host'), () => L.tryAdd('reception', [[dr.x + 3.3, iz1 - 1.75, P], [dr.x - 3.3, iz1 - 1.75, P], [dr.x + 3.3, iz1 - 2.6, P]]));   // (clear of the way in)
  // tables on the grid, a wine rack on each side wall
  for (const r of A.rows(1.7, 2.75, kz + 2.2)) for (const c of A.cols(2.6, 1.0)) {
    if (A.door(c, r, 4.9)) continue;   // the way in and the host's stand
    const d = D('table', c.side, c.k, r.r);
    L.with(d, () => L.add(d.chance(0.4) ? 'cafe_table4' : 'dining_table', c.x, r.z, d.chance(0.5) ? 0 : H, null, 0.1) || L.add('cafe_table', c.x, r.z, H, null, 0.1));
  }
  L.with(D('racks'), () => { L.tryAdd('bookshelf', [[ix0 + 0.23, kz + 2.2, H]], { c: '#5a3a22' }); L.tryAdd('bookshelf', [[ix1 - 0.23, kz + 2.2, -H]], { c: '#5a3a22' }); });
  for (const [x, z] of [[ix0 + 0.4, iz1 - 0.4], [ix1 - 0.4, iz1 - 0.4]]) L.add('plant_tall', x, z);
  if (ground) L.add('plant_tall', dr.x - 1.9, iz1 - 0.4);
}
export function shopFloor(L, o = {}) {
  const base = L.rng.int(1, 2 ** 30), D = (...k) => dice(base, ...k);
  const { ix0, ix1, iz0, iz1 } = L, dr = L.b.door, ground = o.ground !== false;
  L.name = o.name || 'Store'; L.venue = 'shop';
  L.zone(ix0, iz0, ix1, iz1, D('floor').pick(['tile', 'marble', 'wood', 'concrete']));
  placeCore(L);
  if (ground) reserveEntrance(L, 3.4);
  const A = anchorOf(L, ground, 1.45), cs = A.cs;
  // (a fishing dock's store: rod racks for shelves, the lure wall behind, the fish market's counter for the till)
  const tackle = !!o.tackle, clothes = !tackle && (o.clothes ?? D('kind').chance(0.4)), piece = tackle ? 'rod_rack' : clothes ? 'clothes_rack' : 'shop_shelf', hw = clothes ? 0.8 : tackle ? 0.9 : 1.0;
  const till = tackle ? 'fish_counter' : 'checkout', disp = tackle ? 'bait_fridge' : 'display', back = tackle ? 'lure_wall' : 'shop_shelf';
  // the till and display tables: either side of the way in on the street floor, in front of the elevator above it
  if (A.up) {
    L.with(D('till'), () => L.tryAdd(till, [[cs.x0 - 1.4, cs.z1 + 1.0, 0], [cs.x0 - 1.4, cs.z1 + 2.2, 0]]));
    L.with(D('display'), () => L.tryAdd(disp, [[cs.x0 - 3.8, cs.z1 + 1.0, 0]]));
  } else {
    L.with(D('till'), () => L.tryAdd(till, [[dr.x + 3.1, iz1 - 2.3, 0], [dr.x - 3.1, iz1 - 2.3, 0]]));
    L.with(D('display'), () => L.tryAdd(disp, [[dr.x - 3.0, iz1 - 2.3, 0], [dr.x + 3.0, iz1 - 2.3, 0]]));
  }
  // a clothes shop has fitting rooms in a back corner (the one away from the elevator)
  let fx0 = ix0, fx1 = ix1;
  if (clothes && ix1 - ix0 >= 12 && iz1 - iz0 >= 9) {
    const left = !cs || cs.x0 > (ix0 + ix1) / 2, a = left ? ix0 : ix1 - 3.0, b = a + 3.0;
    L.wall(left ? b : a, iz0, left ? b : a, iz0 + 2.0, 0); L.wall(a + 1.5, iz0, a + 1.5, iz0 + 2.0, 0);
    L.wallGaps(a, iz0 + 2.0, b, iz0 + 2.0, [[0.75, 0.8], [2.25, 0.8]], 0);
    L.zone(a, iz0, b, iz0 + 2.0, 'carpet_warm');
    L.add('bench', a + 1.5, iz0 + 3.0, P);
    if (left) fx0 = b; else fx1 = a;
  }
  // shelving along the back wall, then rows of shelves or racks on the grid
  L.with(D('back'), () => { for (const c of fromMiddle(A.x, fx0 + 0.3, fx1 - 0.3, 2.1, 1.0, A.up ? A.gap : 0.05)) L.against(back, 'z', iz0, +1, c.x); });
  for (const r of A.rows(A.up ? 1.4 : 4.4, 2.6, iz0 + (A.up ? Math.max(2.6, cs.z1 - iz0 + 1.8) : 2.3))) for (const c of A.cols(2.9, hw)) {
    L.with(D('row', c.side, c.k, r.r), () => L.add(piece, c.x, r.z, 0, null, 0.1));
  }
  for (const [x, z] of [[ix0 + 0.4, iz1 - 0.4], [ix1 - 0.4, iz1 - 0.4]]) L.add('plant', x, z);
}
export function gymFloor(L, o = {}) {
  const base = L.rng.int(1, 2 ** 30), D = (...k) => dice(base, ...k);
  const { ix0, ix1, iz0, iz1 } = L, dr = L.b.door, W = ix1 - ix0, Dp = iz1 - iz0, ground = !!o.ground;
  L.name = o.name || 'Gym'; L.venue = 'gym';
  L.zone(ix0, iz0, ix1, iz1, 'rubber');
  placeCore(L);
  if (ground) { reserveEntrance(L, 3.2); L.tryAdd('reception', [[dr.x + 3.4, iz1 - 1.9, P], [dr.x - 3.4, iz1 - 1.9, P]]); }
  const A = anchorOf(L, ground, 1.25), cs = A.cs;
  // treadmills in a row facing the windows
  const tz = ground ? iz1 - 4.8 : iz1 - 1.6;
  for (const c of A.cols(1.15, 0.45, ground ? 1.25 : 0.15)) L.add('treadmill', c.x, tz, P);
  // changing rooms in the back corner away from the elevator: lockers, a bench and a shower each
  const left = !cs || cs.x0 > (ix0 + ix1) / 2, rx0 = left ? ix0 : ix1 - 6.2, rx1 = rx0 + 6.2, rz = iz0 + 3.6;
  let back0 = ix0, back1 = ix1;
  if (W >= 14 && Dp >= 11) {
    const mid = (rx0 + rx1) / 2;
    L.wall(mid, iz0, mid, rz, 0); L.wall(left ? rx1 : rx0, iz0, left ? rx1 : rx0, rz, 0);
    L.wallGaps(rx0, rz, rx1, rz, [[1.0, 0.9], [4.1, 0.9]], 0);
    L.zone(rx0, iz0, rx1, rz, 'tile');
    for (const [a, b] of [[rx0, mid], [mid, rx1]]) {   // each door 1 m in from the room's west end: the shower in the far front corner
      L.against('lockers', 'z', iz0, +1, (a + b) / 2);
      L.add('shower', b - 0.55 - IW, rz - 0.55 - IW, P, null, 0.0);
      L.add('bench', (a + b) / 2 - 0.2, iz0 + 1.55, 0);
    }
    if (left) back0 = rx1; else back1 = rx0;
  }
  // a glass-walled studio for yoga at the other back corner (not where the elevator is), else mats in the open
  const zone = ground ? tz - 2.4 : tz - 2.6;
  const sx0 = left ? ix1 - 7.2 : ix0, sx1 = sx0 + 7.2, sz = iz0 + 5.0;
  const studio = W >= 22 && Dp >= 13 && !(cs && cs.x1 > sx0 && cs.x0 < sx1);
  if (studio) {
    L.wallGaps(sx0, sz, sx1, sz, [[left ? 1.0 : 6.2, 1.0]], 1); L.wall(left ? sx0 : sx1, iz0, left ? sx0 : sx1, sz, 1);
    L.zone(sx0, iz0, sx1, sz, 'wood');
    for (let k = 0; k < 6; k++) L.add('yoga_mat', sx0 + 0.9 + k * 1.05, iz0 + 2.0, 0);
    L.against('tv_wall', 'z', iz0, +1, (sx0 + sx1) / 2);
    if (left) back1 = sx0; else back0 = sx1;
  }
  // free weights in the middle; a water cooler and lockers on the back wall between the rooms
  for (const z of [zone, zone - 2.2]) for (const c of A.cols(2.4, 0.8, 0.6)) if (c.k < 3) L.add('weights', c.x, z, 0);
  if (!studio) for (const c of A.cols(1.05, 0.36, 2.6)) if (c.k < 4) L.add('yoga_mat', c.x, zone - 4.6, 0);
  L.with(D('back'), () => {
    const mx = Math.min(Math.max((back0 + back1) / 2, back0 + 1.4), back1 - 1.4);
    L.against('water_cooler', 'z', iz0, +1, mx + 1.3); L.against('lockers', 'z', iz0, +1, mx - 0.4);
    L.tryAdd('bench', [[ix1 - 0.45, zone, -H], [ix0 + 0.45, zone, H]]);
  });
  L.tryAdd('plant', [[ix1 - 0.4, iz1 - 0.4], [ix0 + 0.4, iz1 - 0.4]]);
}
export function loungeFloor(L, o = {}) {
  const { ix0, ix1, iz0, iz1 } = L;
  L.name = o.name || 'Lounge'; L.venue = 'lounge';
  L.zone(ix0, iz0, ix1, iz1, 'wood');
  placeCore(L);
  if (o.ground) reserveEntrance(L, 3.2);
  const core = L.b.core || { x: (ix0 + ix1) / 2 };   // (a building of one floor has no elevator: from the middle)
  const bandZ = iz0 + 5.6;
  kitchenArea(L, core.x + 3.1, iz0, ix1, bandZ, true);
  L.add('bar_counter', (ix0 + core.x - 2.6) / 2, iz0 + 1.3, 0);
  L.zone(ix0, bandZ + 1, (ix0 + core.x) / 2 + 3, iz1, 'marble');
  L.add('dance_floor', (ix0 + core.x) / 2 - 1.2, (bandZ + iz1) / 2 + 0.3, 0);
  L.tryAdd('pingpong', [[ix1 - 4.8, iz1 - 3.0, H], [ix1 - 3.8, (bandZ + iz1) / 2 + 1, H]]);
  for (let k = 0; k < 3; k++) L.against('arcade', 'x', ix1, -1, bandZ + 1.6 + k * 0.95);
  L.tryAdd('piano', [[ix0 + 1.4, iz1 - 1.6, 0], [ix0 + 1.4, bandZ + 2.2, 0]]);
  lounge(L, core.x - 2.9, iz1 - 3.9, core.x + 2.9, iz1 - 0.3, -1);
  L.tryAdd('beanbag', [[core.x + 4.2, iz1 - 1.2, P], [core.x - 4.2, iz1 - 1.2, P]]);
  L.tryAdd('beanbag', [[core.x + 5.4, iz1 - 1.5, P]]);
  for (const [x, z] of [[ix0 + 0.4, iz1 - 0.4], [ix1 - 0.4, iz1 - 0.4], [ix0 + 0.4, bandZ + 0.8]]) L.add('plant_tall', x, z);
}

// ---------------------------------------------------------------------------------------------
// Floor Themes (shared/floor-themes.js, 2026-10-23): a floor laid out as a kind of place, to fit its size and its elevator.
/**
 * An arcade (Floor Themes, 2026-10-23: "arcade themed furniture ... more arcade games ... billiards, bowling, a mechanical
 * bull ... fill the right amount of space, not half empty, not overcrowded"). Laid out in zones, each fitted to the floor:
 *   the walls     a big neon ARCADE over a row of cabinets on the back wall; cabinets down the side walls; pixel murals
 *   bowling       on a floor deep and wide enough, two to four mini lanes along one side, the bowlers' end to the front
 *   the front     the prize corner on one side of the way in (the counter off the wall with its clerk behind, the prize
 *                 wall, a prize case, a token machine, a PRIZES sign), the snack corner on the other (the snack bar, a
 *                 SNACKS sign, high-top tables)
 *   a lounge      neon booths and gaming chairs in the back corner away from the elevator, a mural over them
 *   the middle    strips across the room, an aisle between each: strips of attractions (billiards, the bull, air hockey,
 *                 skee-ball, hoops, the dance machine, racers, claw machines, pinball, whack-a-mole and the punching
 *                 machine, foosball, the photo booth, the giant joystick) and strips of cabinets back to back, by turns
 *   the light     strips of light along the way in, LED pillars at the ends of the strips
 * The way in from the door and the way out of the elevator are kept clear. On a neon arcade carpet; the pieces in arcade
 * colours. Every cabinet plays (render/furniture.js, play/arcade.js); the attractions are used by residents.
 */
export function arcadeFloor(L, o = {}) {
  const base = L.rng.int(1, 2 ** 30), D = (...k) => dice(base, ...k);
  const { ix0, ix1, iz0, iz1 } = L, dr = L.b.door, ground = !!o.ground, W = ix1 - ix0, Dp = iz1 - iz0, mid = (ix0 + ix1) / 2;
  L.name = o.name || 'Arcade'; L.venue = 'arcade';
  L.zone(ix0, iz0, ix1, iz1, 'carpet_arcade');
  placeCore(L);
  if (ground) reserveEntrance(L, 3.4);
  const core = L.b.core, CAB = 0.43, PITCH = 0.92, AISLE = 1.6, GAP = 0.8;
  const coreBox = core ? (() => { const bb = itemAABB(core, CATALOG[core.t].rect); return { x0: bb.x0 - 1.1, z0: bb.z0 - 1.1, x1: bb.x1 + 1.1, z1: bb.z1 + 2.2 }; })() : null;
  const nearCore = (x0, z0, x1, z1) => coreBox && x0 < coreBox.x1 && x1 > coreBox.x0 && z0 < coreBox.z1 && z1 > coreBox.z0;
  const doorWay = (x0, x1) => ground && x0 < dr.x + 1.5 && x1 > dr.x - 1.5;
  const tint = (pal, k) => D('tint', k).pick(pal);
  const MACH = ['#7c3aed', '#db2777', '#2563eb', '#0891b2', '#111827', '#dc2626', '#ea580c', '#16a34a'], NEON = ['#22d3ee', '#f472b6', '#facc15', '#a3e635', '#c084fc', '#fb923c'];
  const SEAT = ['#7c3aed', '#db2777', '#0e7490', '#b91c1c', '#1d4ed8'];
  let k = 0;
  const put = (t, x, z, r = 0, c = null, pad = 0.05) => L.add(t, x, z, r, c ? { c } : null, pad);
  // ---- the sides: which side has the bowling (and the prize corner), which the lounge and the snacks
  const coreSide = core ? Math.sign(core.x - mid) : 0;
  const bowlSide = coreSide ? -coreSide : (D('bowl-side').chance(0.5) ? -1 : 1);
  const lanes = Dp >= 13 && W >= 15 ? Math.max(2, Math.min(4, Math.floor((W * 0.28) / 1.5))) : 0;
  const LANE_L = 6.8, bowlW = lanes * 1.5, bowlX0 = bowlSide < 0 ? ix0 : ix1 - bowlW, bowlX1 = bowlX0 + bowlW;
  const frontD = ground ? 4.4 : 3.4, frontZ = iz1 - frontD;
  // ---- the back wall: the big sign, the cabinets
  {
    const span = coreSide === 0 && coreBox ? (coreBox.x0 - ix0 > ix1 - coreBox.x1 ? [ix0, coreBox.x0] : [coreBox.x1, ix1]) : [lanes && bowlSide < 0 ? bowlX1 : ix0, lanes && bowlSide > 0 ? bowlX0 : ix1];
    const sx = (span[0] + span[1]) / 2;
    if (span[1] - span[0] >= 3) L.against('neon_arcade', 'z', iz0, +1, sx, null, 0.01);
    if (lanes) L.against(D('bowl-sign').chance(0.5) ? 'neon_gameon' : 'neon_invader', 'z', iz0, +1, (bowlX0 + bowlX1) / 2, null, 0.01);
  }
  // ---- bowling: lanes along the side, the pin decks against the back wall, the bowlers' end to the front
  if (lanes) L.with(D('bowling'), () => {
    L.zone(bowlX0, iz0, bowlX1, iz0 + LANE_L + 1.6, 'wood_dark');
    const lc = tint(NEON, 'lanes');
    for (let n = 0; n < lanes; n++) put('bowling_lane', bowlX0 + 0.75 + n * 1.5, iz0 + LANE_L / 2 + 0.02, 0, lc, 0.0);
    L.reserve(bowlX0, iz0, bowlX1, iz0 + LANE_L + 1.5);   // (the bowlers' room)
  });
  // ---- the lounge in the back corner on the other side: booths, gaming chairs, a mural over them
  const loungeW = W >= 13 ? Math.min(5.0, W * 0.24) : 0, lside = -bowlSide;
  if (loungeW) L.with(D('lounge'), () => {
    const x0 = lside < 0 ? ix0 : ix1 - loungeW, x1 = x0 + loungeW;
    if (nearCore(x0, iz0, x1, iz0 + 4.2)) return;
    L.zone(x0, iz0, x1, iz0 + 4.0, 'carpet_blue');
    const cx = (x0 + x1) / 2;
    put('neon_booth', cx, iz0 + 0.88, 0, tint(SEAT, 'booth'));
    L.against(D('mural').chance(0.5) ? 'pixel_mural' : 'pixel_mural_maze', 'z', iz0, +1, cx, null, 0.005);
    L.tryAdd('gaming_chair', [[cx - 1.0, iz0 + 2.75, 0], [cx - 0.9, iz0 + 2.9, 0]], { c: tint(SEAT, 'gc1') });
    L.tryAdd('gaming_chair', [[cx + 1.0, iz0 + 2.75, 0], [cx + 0.9, iz0 + 2.9, 0]], { c: tint(SEAT, 'gc2') });
    L.against('tv_wall', 'x', lside < 0 ? ix0 : ix1, lside < 0 ? +1 : -1, iz0 + 2.6);
    L.reserve(x0, iz0, x1, iz0 + 4.0);
  });
  // ---- the front: the prize corner (on the bowling side) and the snack corner
  const pside = lanes ? bowlSide : (D('sides').chance(0.5) ? 1 : -1);
  L.with(D('prizes'), () => {
    const wx = pside > 0 ? ix1 : ix0, inn = -pside, dz = frontZ + 1.25;
    if (put('reception', wx + inn * 1.9, dz, pside > 0 ? -H : H, tint(MACH, 'desk'))) {
      L.against('prize_wall', 'x', wx, inn, dz, { c: tint(MACH, 'pwall') });
      L.reserve(Math.min(wx, wx + inn * 1.45), dz - 2.1, Math.max(wx, wx + inn * 1.45), dz + 2.1);   // (the clerk's side)
      L.reserve(Math.min(wx + inn * 2.35, wx + inn * 3.7), dz - 1.6, Math.max(wx + inn * 2.35, wx + inn * 3.7), dz + 1.6);   // (and the customers')
      L.tryAdd('prize_case', [[wx + inn * 1.9, dz - 2.0, pside > 0 ? -H : H], [wx + inn * 2.6, dz - 2.1, 0]], { c: tint(MACH, 'case') });
      L.against('neon_prizes', 'x', wx, inn, dz - 2.6, null, 0.01);
      L.against('token_machine', 'x', wx, inn, Math.min(iz1 - 0.5, dz + 2.45), { c: tint(MACH, 'token') });
    }
  });
  L.with(D('snacks'), () => {
    const wx = pside > 0 ? ix0 : ix1, inn = pside > 0 ? +1 : -1, dz = frontZ + 1.4;
    if (L.against('snack_bar', 'x', wx, inn, dz, { c: tint(MACH, 'snack') })) {
      L.reserve(Math.min(wx, wx + inn * 2.7), dz - 1.7, Math.max(wx, wx + inn * 2.7), dz + 1.7);
      L.against('neon_snacks', 'x', wx, inn, dz - 2.7, null, 0.01);
      L.tryAdd('hightop_table', [[wx + inn * 3.5, dz - 1.0, 0], [wx + inn * 3.7, dz - 1.4, 0]], { c: tint(NEON, 'ht1') });
      L.tryAdd('hightop_table', [[wx + inn * 3.5, dz + 0.9, 0], [wx + inn * 3.7, dz + 0.7, 0]], { c: tint(NEON, 'ht2') });
    }
  });
  if (ground) { L.tryAdd('led_pillar', [[dr.x - 2.2, iz1 - 0.6]]); L.tryAdd('led_pillar', [[dr.x + 2.2, iz1 - 0.6]]); }
  if (lanes) for (let n = 0; n < lanes; n += 2) L.tryAdd('gaming_chair', [[bowlX0 + 1.5 + n * 1.5, iz0 + LANE_L + 2.05, P]], { c: tint(SEAT, 'bowl-seat' + n) });   // (for the next bowler)
  // the giant joystick: beside the way in on the street floor, in the middle at the front above it
  L.tryAdd('giant_joystick', ground ? [[dr.x + 3.7, iz1 - 2.4, 0], [dr.x - 3.7, iz1 - 2.4, 0]] : [[mid, frontZ + 1.6, 0], [mid + 3, frontZ + 1.6, 0]], { c: tint(NEON, 'joy') });
  if (!ground && W >= 16) L.with(D('front-seats'), () => {   // (above the street, the front's middle: a booth each side of the joystick)
    for (const s of [-1, 1]) L.tryAdd('neon_booth', [[mid + s * 3.4, frontZ + 1.55, P], [mid + s * 4.2, frontZ + 1.55, P]], { c: tint(SEAT, 'fb' + s) });
  });
  // a cluster of claw machines against the front wall each side of the middle, facing in (four at most, clear of the way in)
  L.with(D('front-claws'), () => {
    const c0 = ground ? dr.x : mid;
    for (const s of [-1, 1]) {
      let n = 0;
      for (let x = c0 + s * (ground ? 3.4 : 5.4); n < 4 && x > ix0 + 2.6 && x < ix1 - 2.6; x += s * 1.04) if (L.against('claw_machine', 'z', iz1, -1, x, { c: tint(MACH, 'fc' + s + n) }, 0.03, 0.02)) n++; else if (n) break;
    }
  });
  // ---- the middle: strips across the room, attractions and cabinets by turns
  const sideBand = 2 * CAB + AISLE;
  const mx0 = (lanes && bowlSide < 0 ? bowlX1 + 0.6 : ix0 + sideBand), mx1 = (lanes && bowlSide > 0 ? bowlX0 - 0.6 : ix1 - sideBand);
  const POD = {   // w × d with the room to play; place(cx, cz) the pieces in the pod's middle
    pool: [3.4, 4.6, (x, z) => put('pool_table', x, z, 0, tint(['#1f2937', '#7f1d1d', '#4c1d95', '#3b2416', '#0f172a'], 'pool' + x))],
    bull: [4.4, 4.6, (x, z) => put('mech_bull', x, z - 0.2, 0)],
    hockey: [2.4, 4.2, (x, z) => put('air_hockey', x, z, 0, tint(MACH, 'ah' + x))],
    skee: [2.9, 4.4, (x, z) => { for (let n = -1; n <= 1; n++) put('skeeball', x + n * 0.92, z - 0.25, 0, tint(MACH, 'sk' + n)); }],
    hoops: [2.7, 3.9, (x, z) => { for (const n of [-0.65, 0.65]) put('hoop_shot', x + n, z - 0.25, 0, tint(MACH, 'hp' + n)); }],
    dance: [2.4, 3.6, (x, z) => put('dance_machine', x, z - 0.45, 0, tint(MACH, 'dm' + x))],
    racers: [2.6, 3.3, (x, z) => { for (const n of [-0.62, 0.62]) put('racing_sim', x + n, z - 0.3, 0, tint(MACH, 'rs' + n)); }],
    claws: [3.4, 2.3, (x, z) => { for (let n = -1; n <= 1; n++) put('claw_machine', x + n * 1.02, z - 0.35, 0, tint(MACH, 'cl' + n)); }],
    pinball: [2.6, 2.9, (x, z) => { for (let n = -1; n <= 1; n++) put('pinball', x + n * 0.82, z - 0.35, 0, tint(MACH, 'pb' + n)); }],
    games: [3.0, 2.4, (x, z) => { put('whack_mole', x - 0.9, z - 0.3, 0, tint(MACH, 'wm')); put('boxer', x + 0.15, z - 0.4, 0, tint(MACH, 'bx')); put('whack_mole', x + 1.15, z - 0.3, 0, tint(MACH, 'wm2')); }],
    foos: [3.3, 2.2, (x, z) => put('foosball', x, z, 0, tint(MACH, 'fs' + x))],
    photo: [1.9, 2.8, (x, z) => put('photo_booth', x, z - 0.35, 0, tint(MACH, 'ph' + x))],
    joystick: [2.2, 2.2, (x, z) => put('giant_joystick', x, z, D('js').int(0, 3) * H, tint(NEON, 'js'))],
    chill: [3.2, 3.0, (x, z) => { put('neon_booth', x, z - 0.4, 0, tint(SEAT, 'cb' + x)); }],
  };
  const BIG = ['bull', 'pool', 'hockey', 'skee', 'pool', 'hoops', 'dance', 'hockey'], SMALL = ['claws', 'racers', 'pinball', 'games', 'photo', 'joystick', 'foos', 'chill', 'claws', 'pinball'];
  const big = D('big').shuffle ? D('big').shuffle([...BIG]) : [...BIG], small = D('small').shuffle ? D('small').shuffle([...SMALL]) : [...SMALL];
  if (W * Dp < 260) big.splice(big.indexOf('bull'), 1);   // (the bull wants a big room)
  const queue = { big, small }, used = new Set();
  const takePods = (kind, room, maxD = 99) => {   // pods of this kind that fit side by side in room metres (GAP between them)
    const out = []; let w = 0;
    for (let tries = 0; tries < queue[kind].length * 2 && queue[kind].length; tries++) {
      const id = queue[kind][0], [pw, pd] = POD[id];
      queue[kind].push(queue[kind].shift());
      if (pd > maxD || w + (out.length ? GAP : 0) + pw > room) continue;
      if (used.has(id) && queue[kind].some(q => !used.has(q) && POD[q][1] <= maxD)) continue;   // (each kind once before any twice)
      out.push(id); used.add(id); w += (out.length > 1 ? GAP : 0) + pw;
    }
    return out;
  };
  // the stretches of a strip's width free for pods: the door's way in and the elevator's way out kept clear
  const stretches = (z0, z1) => {
    const cut = [];
    if (ground && z1 > iz1 - 4.5) cut.push([dr.x - 1.6, dr.x + 1.6]);   // (the way in, as far as it goes before the room opens out)
    if (coreBox && z0 < coreBox.z1 && z1 > coreBox.z0) cut.push([coreBox.x0, coreBox.x1]);
    let segs = [[mx0, mx1]];
    for (const [a, b] of cut) segs = segs.flatMap(([s0, s1]) => (b <= s0 || a >= s1 ? [[s0, s1]] : [[s0, a], [b, s1]]).filter(([p0, p1]) => p1 - p0 > 1.6));
    return segs;
  };
  // cabinets: about one to 5 m² (24 to 150; screens and models for a phone to draw); past three quarters of that, the
  // middle's cabinet strips become attractions
  const cap = Math.max(24, Math.min(150, Math.floor((W * Dp) / 5)));
  let placed = 0;
  const cab = (x, z, r) => { if (placed >= cap) return null; const it = L.with(D('cab', k++), () => L.add('arcade', x, z, r, null, 0.02)); if (it) placed++; return it; };
  const pillars = [];
  let z = iz0 + 2 * CAB + AISLE, turn = D('first').chance(0.6) ? 'big' : 'cab', strips = 0, nextPods = 'big';   // (pod strips: big and small by turns)
  if (mx1 - mx0 >= 3.2) while (z < frontZ - 1.2 && strips < 12) {
    strips++;
    if (turn === 'cab' && placed >= cap * 0.75) turn = nextPods;
    if (turn === 'cab') {
      const d = 4 * CAB + 0.02;
      if (z + d > frontZ - 0.4) break;
      const xs = []; let n = 0;
      for (let x = mx0 + CAB; x <= mx1 - CAB + 1e-6; x += PITCH) {
        if (doorWay(x - CAB, x + CAB) || nearCore(x - CAB, z, x + CAB, z + d)) { n = 0; continue; }
        if (n === 6) { n = 0; continue; }
        xs.push(x); n++;
      }
      for (const x of xs) { cab(x, z + CAB, P); cab(x, z + 3 * CAB + 0.02, 0); }
      pillars.push([mx0 + 0.3, z - AISLE / 2], [mx1 - 0.3, z - AISLE / 2]);
      z += d + AISLE; turn = nextPods;
      continue;
    }
    const kind = turn, room = frontZ - 0.6 - z;
    let depth = 0;
    for (const [s0, s1] of stretches(z, z + (kind === 'big' ? 5 : 3.6))) {
      let ids = takePods(kind, s1 - s0, room);
      if (!ids.length) continue;
      const width = list => list.reduce((t, id) => t + POD[id][0], 0) + Math.max(0, list.length - 1) * GAP;
      // what the strip's pods leave at its ends: smaller attractions as deep as the strip, so it runs wall to wall
      const dmax0 = Math.max(...ids.map(id => POD[id][1]));
      if (kind === 'big') { const left = s1 - s0 - width(ids) - GAP; if (left >= 2.0) { const more = takePods('small', left, dmax0); ids = [...more.slice(0, Math.ceil(more.length / 2)), ...ids, ...more.slice(Math.ceil(more.length / 2))]; } }
      let x = (s0 + s1) / 2 - width(ids) / 2;
      const dmax = Math.max(...ids.map(id => POD[id][1]));
      for (const id of ids) { const [pw, , place] = POD[id]; L.with(D('pod', id, x), () => place(x + pw / 2, z + dmax / 2)); L.reserve(x, z, x + pw, z + dmax); x += pw + GAP; }
      depth = Math.max(depth, dmax);
    }
    if (!depth) { if (kind === 'big') { turn = 'small'; nextPods = 'small'; continue; } break; }
    nextPods = kind === 'big' ? 'small' : 'big';
    pillars.push([mx0 + 0.3, z + depth / 2], [mx1 - 0.3, z + depth / 2]);
    z += depth + AISLE; turn = 'cab';
  }
  // what is left before the front: small attractions if it is deep enough, else a row of cabinets facing the front
  if (mx1 - mx0 >= 3.2) {
    const room = frontZ - 0.4 - z;
    let filled = false;
    if (room >= 2.2) for (const [s0, s1] of stretches(z, z + room)) {
      const ids = takePods('small', s1 - s0, room); if (!ids.length) continue;
      const tw = ids.reduce((t, id) => t + POD[id][0], 0) + (ids.length - 1) * GAP, dm = Math.max(...ids.map(id => POD[id][1]));
      let x = (s0 + s1) / 2 - tw / 2;
      for (const id of ids) { const [pw, , place] = POD[id]; L.with(D('tail', id, x), () => place(x + pw / 2, z + dm / 2)); L.reserve(x, z, x + pw, z + dm); x += pw + GAP; }
      filled = true;
    }
    if (!filled && room >= 0.5) for (let x = mx0 + CAB, n = 0; x <= mx1 - CAB + 1e-6; x += PITCH) {   // (0.4 to spare before the front)
      if (doorWay(x - CAB, x + CAB) || nearCore(x - CAB, z, x + CAB, z + 0.9) || ++n % 7 === 0) continue;
      cab(x, z + CAB, 0);
    }
  }
  // ---- the walls: cabinets along the back wall and down the side walls where nothing else stands
  for (let x = ix0 + 0.45; x <= ix1 - 0.45 + 1e-6; x += PITCH) cab(x, iz0 + CAB, 0);
  // (down the side walls every sixth place another game: a claw machine, a punching machine, a pinball)
  const WALLG = ['claw_machine', 'boxer', 'pinball'], wn = { [-1]: 0, [1]: 0 };
  for (let zz = iz0 + 0.45 + PITCH; zz <= iz1 - 0.45 + 1e-6; zz += PITCH) for (const side of [-1, 1]) {
    if (++wn[side] % 6 === 3) { const t = WALLG[(wn[side] / 6 | 0) % 3], it = L.against(t, 'x', side < 0 ? ix0 : ix1, side < 0 ? +1 : -1, zz + (t === 'pinball' ? 0 : 0.05), { c: tint(MACH, 'wg' + side + zz) }, 0.03, 0.02); if (it) { zz += t === 'claw_machine' ? 0.1 : 0; continue; } }
    cab(side < 0 ? ix0 + CAB : ix1 - CAB, zz, side < 0 ? H : -H);
  }
  // ---- the light: LED pillars at the ends of the strips, light strips along the way in, a mural on a free stretch of wall
  for (const [x, zz] of pillars.slice(0, 6)) L.tryAdd('led_pillar', [[x, zz]]);
  const lane = ground ? dr.x : core ? core.x : mid, nc = tint(NEON, 'strips');
  for (let zz = (ground ? iz1 - 1.6 : iz0 + 4); zz > iz0 + 3 && zz < iz1 - 1; zz += ground ? -2.6 : 2.6) for (const s of [-1, 1]) {
    const bb = { x0: lane + s * 1.15 - 0.06, z0: zz - 1.0, x1: lane + s * 1.15 + 0.06, z1: zz + 1.0 };   // (on the floor: clear of pieces, not of the ways kept open)
    if (L.inside(bb) && !L.rects.some(q => q[4] === K_ITEM && bb.x0 < q[2] + 0.1 && bb.x1 > q[0] - 0.1 && bb.z0 < q[3] + 0.1 && bb.z1 > q[1] - 0.1)) L.add('floor_neon', lane + s * 1.15, zz, H, { c: nc });
  }
  if (W >= 16) L.with(D('murals'), () => {
    const side = -lside, wx = side < 0 ? ix0 : ix1, inn = side < 0 ? +1 : -1;
    if (!lanes || side !== bowlSide) L.against(D('m2').chance(0.5) ? 'neon_joystick' : 'neon_invader', 'x', wx, inn, (iz0 + frontZ) / 2, null, 0.01);
  });
}
/** Whether a square pad (a dance floor: it blocks nothing itself) of half size h at x, z is clear and inside. */
function padFree(L, x, z, h) { const bb = { x0: x - h, z0: z - h, x1: x + h, z1: z + h }; return L.inside(bb) && L.isFree(bb, 0.1); }
/**
 * The lounge theme, redone (2026-10-23, the product owner: "a fancy sit back and relax area, modern organic, elegant, soft lighting";
 * then "it needs a bigger nicer bar ... central bars ... add walls ... it needs to feel comfortable, unique, and flow ...
 * more variety: couches, loveseats, tables for 4 and 2, counters round the bars, barstool tables ... this looks like a
 * furniture store instead of a lounge"). Laid out as a place, not a grid:
 *   the salon     on a big floor one end walled off with panelled walls (two wide openings): a fireplace with a sofa
 *                 and club chairs round it, bookcases, loveseats, a booth, chaises by the window
 *   the stage     on the hall's back wall toward one end (a side wall when the back is taken), tables for two and four
 *                 in arcs before it, like a supper club
 *   the bar       the centrepiece: an island bar on a big hall, a round bar on a middling one (stools all round, a
 *                 bartender's well, a lit bottle tower, a halo of lights above), high tables round it beyond its aisle;
 *                 a wall bar and a drink ledge on a small floor
 *   the walls     runs of banquettes with their tables, lounge corners (a sofa, club chairs, a coffee table on a rug),
 *                 round booths, olive trees and palms, art with sconces, lit niches, bookcases on solid walls
 *   the rest      groups set where the room opens out (the widest free spot first), each turned to the bar, the stage or
 *                 the fire: sofas with club chairs, loveseats face to face, the curved sofa, a fire table, chaises,
 *                 booths, tables for four and two, a walkway kept round each, until under a third of the floor is furnished
 * Aisles run from the way in, the elevator, the stage and the salon to the bar; every group goes down whole or not at all.
 */
export function loungeThemeFloor(L, o = {}) {
  const base = L.rng.int(1, 2 ** 30), D = (...k) => dice(base, ...k);
  const { ix0, ix1, iz0, iz1 } = L, dr = L.b.door, ground = !!o.ground, W = ix1 - ix0, Dp = iz1 - iz0;
  L.name = o.name || 'Lounge'; L.venue = 'lounge_bar';
  L.zone(ix0, iz0, ix1, iz1, D('floor').pick(['smoked_oak', 'smoked_oak', 'wood_dark', 'wood']));
  placeCore(L);
  if (ground) reserveEntrance(L, 3.4);
  const core = L.b.core, cbb = core ? itemAABB(core, CATALOG[core.t].rect) : null;
  const VELVET = ['#3f5a3c', '#a4532c', '#c9973a', '#1f2c4a', '#7a4a5a', '#5a6b4a', '#b06a4a', '#2f4f4f'], BOUCLE = ['#e4d7c0', '#d9c6a6', '#cdb48e', '#e8dcc4', '#c4a57c'];
  const RUG = ['#cdb08a', '#b88a5a', '#a8b094', '#d8c7a8', '#b5785a', '#c9a27a', '#9da48a'], WOODS = ['#5b3a26', '#6e4a31', '#8a6242', '#3b2a1f'], CURTAIN = ['#2a2f6b', '#3b1f3a', '#1f3a3a', '#4a2a22'];
  const STONE = ['#d8cbb5', '#cbbba1', '#bfb3a3'], OAK = ['#a37c55', '#8a6242', '#b8915f'], LEATHER = ['#6b3f2a', '#4a2c20', '#7a4a32', '#33261f'];
  const tint = (pal, ...k) => D('tint', ...k).pick(pal);
  const accent = tint(['#1f4a3a', '#5a1f2a', '#1f2c4a', '#2f4f4f', '#6b4a1f', '#3b2a4a'], 'accent');   // (the bar's colour, its stools and high tables)
  const put = (t, x, z, r = 0, c = null, pad = 0.05) => L.add(t, x, z, r, c ? { c } : null, pad);
  const keep = fn => { const ni = L.items.length, nr = L.rects.length; if (fn()) return true; L.items.length = ni; L.rects.length = nr; return false; };   // (a group goes down whole or not at all)
  const frame = (ox, oz, r) => { const cs = Math.cos(r), sn = Math.sin(r); return (t, lx, lz, rr = 0, c = null, pad) => put(t, ox + lx * cs + lz * sn, oz - lx * sn + lz * cs, r + rr, c, pad); };
  const SEATS = new Set(['curve_sofa', 'serp_sofa', 'boucle_chair', 'shell_chair', 'pouf', 'chaise', 'loveseat', 'sofa_lounge', 'club_chair', 'booth_round', 'banquette_table', 'table_two', 'table_four', 'highboy', 'island_bar', 'round_bar', 'lounge_bar', 'drink_ledge']);
  const seats = () => L.items.reduce((t, it) => t + (SEATS.has(it.t) ? CATALOG[it.t].slots.filter(s => s.use !== 'staff').length : 0), 0);
  const solid = () => L.items.reduce((t, it) => { const d = CATALOG[it.t]; return t + (d.block === false || d.fixed ? 0 : (d.rect[2] - d.rect[0]) * (d.rect[3] - d.rect[1])); }, 0);
  const warm = '#ffcf8a';

  // ---- the salon: on a big floor one end becomes a quieter room behind panelled walls with wide openings
  let hx0 = ix0, hx1 = ix1, salon = null;
  if (W >= 24 && Dp >= 13) {
    const coreLeft = cbb && (cbb.x0 + cbb.x1) / 2 < (ix0 + ix1) / 2;
    for (const side of cbb ? (coreLeft ? [1, -1] : [-1, 1]) : D('salon-side').chance(0.5) ? [-1, 1] : [1, -1]) {
      const sw = Math.min(10, Math.max(7.2, W * 0.3)), px = side < 0 ? ix0 + sw : ix1 - sw;
      if (cbb && px > cbb.x0 - 1.3 && px < cbb.x1 + 1.3) continue;
      if (ground && dr && Math.abs(px - dr.x) < dr.w / 2 + 2.4) continue;
      const ops = Dp >= 18 ? [[iz0 + Dp * 0.28, 2.6], [iz0 + Dp * 0.72, 2.6]] : [[iz0 + Dp * 0.55, 2.8]];
      let z = iz0;
      for (const [oz, ow] of ops) { if (oz - ow / 2 - z > 0.3) L.wall(px, z, px, oz - ow / 2, 2); L.reserve(px - 1.0, oz - ow / 2, px + 1.0, oz + ow / 2); z = oz + ow / 2; }
      if (iz1 - z > 0.3) L.wall(px, z, px, iz1, 2);
      salon = { side, px, ops, x0: side < 0 ? ix0 : px + 0.12, x1: side < 0 ? px - 0.12 : ix1 };
      if (side < 0) hx0 = px + 0.12; else hx1 = px - 0.12;
      L.zone(salon.x0, iz0, salon.x1, iz1, D('salon-floor').pick(['carpet_warm', 'wood_dark']));
      break;
    }
  }
  const HW = hx1 - hx0, hcx = (hx0 + hx1) / 2;

  // ---- the stage: on the hall's back wall toward one end (clear of the elevator), else on its outer side wall
  const spans = [];
  if (cbb && cbb.z0 < iz0 + 1.6 && cbb.x1 > hx0 && cbb.x0 < hx1) { if (cbb.x0 - 0.9 - hx0 > 0.5) spans.push([hx0, cbb.x0 - 0.9]); if (hx1 - cbb.x1 - 0.9 > 0.5) spans.push([cbb.x1 + 0.9, hx1]); }
  else spans.push([hx0, hx1]);
  spans.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  const barKind = HW >= 20 && Dp >= 14.5 ? 'island_bar' : HW >= 11 && Dp >= 11.5 ? 'round_bar' : 'wall';   // (the island wants a big room)
  let stage = null, bar = null;
  const wallBar = () => {   // a small floor's bar: on the back wall, its back bar behind, a drink ledge along a side
    const sp = spans.filter(([a, b]) => b - a >= 4.2).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    if (sp.length && Dp >= 8) {
      const [s0, s1] = sp[0], bx = sp[0][1] - sp[0][0] >= 10 ? (D('bar-end').chance(0.5) ? s0 + 2.4 : s1 - 2.4) : (s0 + s1) / 2;
      if (L.against('back_bar', 'z', iz0, +1, bx, { c: tint(WOODS, 'bb') }) && put('lounge_bar', bx, iz0 + 1.88, 0, accent)) {
        bar = { x: bx, z: iz0 + 1.9, wall: true };
        L.zone(bx - 2.3, iz0, bx + 2.3, iz0 + 3.3, 'travertine');
        L.reserve(bx - 1.8, iz0 + 0.5, bx + 1.8, iz0 + 1.5); L.reserve(bx - 2.0, iz0 + 2.75, bx + 2.0, iz0 + 3.9);
        const i = spans.indexOf(sp[0]); spans.splice(i, 1, ...[[s0, bx - 2.5], [bx + 2.5, s1]].filter(([a, b]) => b - a > 0.5));
        spans.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
      }
    }
    for (const side of [-1, 1]) if (L.against('drink_ledge', 'x', side < 0 ? ix0 : ix1, -side, iz0 + Math.min(4.5, Dp * 0.35), { c: accent })) break;
  };
  if (barKind === 'wall') wallBar();
  const snap = { i: L.items.length, r: L.rects.length, z: L.zones.length };
  const placeStage = () => {
  if (Dp >= 9.5 && spans.length && spans[0][1] - spans[0][0] >= 5.6) {
    const [s0, s1] = spans[0], x = s1 - s0 >= 11 ? (D('stage-end').chance(0.5) ? s0 + 2.8 : s1 - 2.8) : (s0 + s1) / 2;
    if (put('lounge_stage', x, iz0 + 1.46, 0, tint(CURTAIN, 'curtain'))) {
      stage = { x, z: iz0 + 2.8, fx: 0, fz: 1, x0: x - 2.9, x1: x + 2.9 };
      L.zone(x - 2.6, iz0, x + 2.6, iz0 + 3.3, 'wood_dark');
      for (const s of [-1, 1]) L.tryAdd('slat_screen', [[x + s * 2.62, iz0 + 1.15, H]], { c: tint(OAK, 'scr') });
      L.reserve(x - 1.6, iz0 + 2.75, x + 1.6, iz0 + 3.5);
    }
  }
  if (!stage && Dp >= 11.5 && HW >= 9) for (const side of D('stage-side').chance(0.5) ? [-1, 1] : [1, -1]) {
    if (salon && side === salon.side) continue;
    const wx = side < 0 ? ix0 : ix1, inn = -side, z = iz0 + Math.max(3.4, Dp * 0.42);
    if (cbb && Math.abs((cbb.x0 + cbb.x1) / 2 - wx) < 5 && z + 2.6 > cbb.z0 && z - 2.6 < cbb.z1 + 2) continue;
    if (L.against('lounge_stage', 'x', wx, inn, z, { c: tint(CURTAIN, 'curtain') })) { stage = { x: wx + inn * 2.8, z, fx: inn, fz: 0, side }; break; }
  }
  };
  placeStage();

  // ---- the bar: the centrepiece of the hall (a round one if the island doesn't fit; before the stage's tables if it can)
  for (const t of barKind === 'island_bar' ? ['island_bar', 'round_bar'] : barKind === 'round_bar' ? ['round_bar'] : []) {
    if (bar) break;
    const R = CATALOG[t].rect, ring = 1.25;
    const turn = t === 'island_bar' && Dp > HW * 1.1 ? H : 0, ex = turn ? R[3] : R[2], ez = turn ? R[2] : R[3];
    const zc = stage && stage.fz ? Math.max(iz0 + Dp * 0.5, stage.z + 3.4 + ez + ring) : iz0 + Dp * 0.5;   // (room before the stage for its tables)
    const xc = stage && stage.fz ? hcx + (stage.x < hcx ? 1 : -1) * Math.min(3.5, HW * 0.12) : stage ? hcx - stage.fx * Math.min(3, HW * 0.12) : hcx;
    const offs = [[0, 0], [1.2, 0], [-1.2, 0], [0, -0.8], [0, 0.8], [2.4, 0], [-2.4, 0], [1.2, -0.8], [-1.2, -0.8], [0, -1.6], [3.6, 0], [-3.6, 0], [2.4, -1.6], [-2.4, -1.6], [0, -2.4], [0, 1.6]];
    for (const [x, z] of [...offs.map(([dx, dz]) => [xc + dx, zc + dz]), ...offs.map(([dx, dz]) => [hcx + dx, iz0 + Dp * 0.55 + dz])]) {
      const bb = { x0: x - ex - ring, z0: z - ez - ring, x1: x + ex + ring, z1: z + ez + ring };
      if (!L.inside(bb) || !L.isFree(bb, 0)) continue;
      if (put(t, x, z, turn, accent)) { bar = { x, z, ex, ez, t, ring }; L.reserve(bb.x0, bb.z0, bb.x1, bb.z1); break; }
    }
  }
  if (bar) {   // (an island: marble under it, high tables round it beyond its aisle)
    L.zone(bar.x - bar.ex - 0.5, bar.z - bar.ez - 0.5, bar.x + bar.ex + 0.5, bar.z + bar.ez + 0.5, 'marble');
    const rx = bar.ex + bar.ring + 1.0, rz = bar.ez + bar.ring + 1.0, n = Math.max(4, Math.round(2 * P * Math.sqrt((rx * rx + rz * rz) / 2) / 3.3));
    for (let k = 0; k < n; k++) { const a = (k + 0.5) / n * 2 * P; L.tryAdd('highboy', [[bar.x + Math.sin(a) * rx, bar.z + Math.cos(a) * rz, a], [bar.x + Math.sin(a) * (rx + 0.5), bar.z + Math.cos(a) * (rz + 0.5), a]], { c: accent }, 0.35); }
  }
  if (!bar && barKind !== 'wall') {   // (the middle had no room for it: the bar goes on the back wall first, the stage after if it still fits)
    if (stage) { L.items.length = snap.i; L.rects.length = snap.r; L.zones.length = snap.z; stage = null; }
    wallBar(); placeStage();
  }

  // ---- the ways through: from the way in (or the elevator), the stage and the salon's openings to the bar's aisle
  const aisle = (ax, az, bx, bz, w = 1.4) => { L.reserve(Math.min(ax, bx) - w / 2, az - w / 2, Math.max(ax, bx) + w / 2, az + w / 2); L.reserve(bx - w / 2, Math.min(az, bz) - w / 2, bx + w / 2, Math.max(az, bz) + w / 2); };
  if (bar && !bar.wall) {
    const to = (x, z) => [Math.max(bar.x - bar.ex, Math.min(bar.x + bar.ex, x)), Math.max(bar.z - bar.ez, Math.min(bar.z + bar.ez, z))];
    if (ground && dr) { const [bx, bz] = to(dr.x, iz1); aisle(bx, bz, dr.x, iz1 - 0.5); aisle(dr.x, iz1 - 0.5, bx, bz); }
    if (core && CATALOG[core.t].doors) { const cs = Math.cos(core.r), sn = Math.sin(core.r), [dx, dz] = CATALOG[core.t].doors[0], ex = core.x + dx * cs + (dz + 1.2) * sn, ez = core.z - dx * sn + (dz + 1.2) * cs, [bx, bz] = to(ex, ez); aisle(ex, ez, bx, bz); }
    if (stage) { const [bx, bz] = to(stage.x, stage.z); aisle(bx, bz, stage.x, stage.z, 1.3); }
    if (salon) for (const [oz] of salon.ops) { const [bx, bz] = to(salon.px, oz); aisle(salon.px, oz, bx, bz, 1.3); }
  }
  // ---- before the stage: tables for two and four in arcs, like a supper club
  if (stage) {
    const fa = Math.atan2(stage.fx, stage.fz);
    for (const [R, kind] of [[3.3, 'table_two'], [4.9, 'table_four'], [6.5, 'table_two']]) {
      const step = (kind === 'table_four' ? 3.15 : 2.9) / R;
      for (let a = -1.2; a <= 1.2 + 1e-6; a += step) {
        const ang = fa + a, x = stage.x + Math.sin(ang) * R, z = stage.z + Math.cos(ang) * R;
        L.tryAdd(kind, [[x, z, ang]], { c: tint(VELVET, 'cab', R, Math.round(a * 10)) }, 0.22);
      }
    }
  }

  // ---- along the walls: banquettes with their tables, lounge corners, booths, trees, art
  const wallKit = (axis, line, inn, t0, t1, view, tag, low = false) => {   // (low: a partition, cut down in the cutaway: nothing hung on it)
    const seq = low ? ['banq', 'banq', 'tree', 'booth', 'banq', 'tree'] : view ? ['corner', 'tree', 'banq', 'banq', 'art', 'booth', 'tree', 'corner', 'art'] : ['banq', 'banq', 'banq', 'tree', 'booth', 'art', 'banq', 'banq', 'niche'];
    let t = t0 + 0.35, k = D('seq', tag).int(0, seq.length - 1), n = 0;
    const r0 = axis === 'z' ? (inn > 0 ? 0 : P) : (inn > 0 ? H : -H);
    while (t < t1 - 0.9 && n++ < 60) {
      const what = seq[k++ % seq.length], w = { corner: 4.0, banq: 2.62, booth: 3.25, tree: 1.1, art: 1.9, niche: 1.3 }[what];
      if (t + w > t1 - 0.2) { if (w > 1.2) continue; break; }
      const m = t + w / 2, ox = axis === 'z' ? m : line, oz = axis === 'z' ? line : m;
      let ok = false;
      if (what === 'banq') ok = !!L.against('banquette_table', axis, line, inn, m, { c: tint(VELVET, 'bq', tag) });
      else if (what === 'booth') ok = !!L.against('booth_round', axis, line, inn, m, { c: tint(VELVET, 'bo', tag, n) });
      else if (what === 'tree') ok = !!(D('tr', tag, n).chance(0.55) ? put('olive_tree', ox + (axis === 'x' ? inn * 0.6 : 0), oz + (axis === 'z' ? inn * 0.6 : 0), D('trr', tag, n).float(0, 6.28), tint(STONE, 'pot', tag, n)) : put('planter_palm', ox + (axis === 'x' ? inn * 0.58 : 0), oz + (axis === 'z' ? inn * 0.58 : 0), 0, '#e9e2d6'));
      else if (what === 'art') { ok = !!L.against('art_panel', axis, line, inn, m, { c: tint(BOUCLE, 'art', tag, n) }, 0.01); if (ok) for (const d of [-1.15, 1.15]) L.against('wall_sconce', axis, line, inn, m + d, null, 0.005); if (ok) L.tryAdd('vase_set', [[ox + (axis === 'x' ? inn * 0.45 : 0), oz + (axis === 'z' ? inn * 0.45 : 0), r0]]); }
      else if (what === 'niche') ok = !!L.against('wall_niche', axis, line, inn, m);
      else ok = keep(() => {   // a lounge corner: the sofa against the wall, club chairs facing it across a coffee table on a rug
        const q = frame(ox, oz, r0), c = tint(VELVET, 'cs', tag, n), lc = tint(LEATHER, 'cc', tag, n);
        q('organic_rug', 0, 1.6, 0, tint(RUG, 'cr', tag, n));
        if (!q('sofa_lounge', 0, 0.52, 0, c)) return false;
        q('stone_table', 0, 1.55);
        if (!q('club_chair', -1.35, 2.4, 2.36, lc) || !q('club_chair', 1.35, 2.4, -2.36, lc)) return false;
        q('side_lamp_table', 1.62, 0.32, 0, tint(WOODS, 'cl', tag, n)); q('floor_lantern', -1.62, 0.3);
        return true;
      });
      t += ok ? w + (what === 'banq' ? 0.04 : 0.3) : 0.6;
    }
  };
  // the hall's walls: its back (beside the stage and the elevator), its outer side, the front (round the way in), the salon's
  const doorGap = ground && dr ? [dr.x - dr.w / 2 - 2.2, dr.x + dr.w / 2 + 2.2] : null;
  const cut = (a, b, gaps) => { let out = [[a, b]]; for (const [g0, g1] of gaps) out = out.flatMap(([p, q]) => g1 <= p || g0 >= q ? [[p, q]] : [[p, Math.min(q, g0)], [Math.max(p, g1), q]]).filter(([p, q]) => q - p > 1.0); return out; };
  const backGaps = [...(stage && stage.fz ? [[stage.x0 - 0.4, stage.x1 + 0.4]] : []), ...(bar && bar.wall ? [[bar.x - 2.6, bar.x + 2.6]] : []), ...(cbb && cbb.z0 < iz0 + 1.6 ? [[cbb.x0 - 1.0, cbb.x1 + 1.0]] : [])];
  for (const [a, b] of cut(hx0, hx1, backGaps)) wallKit('z', iz0, +1, a, b, false, `b${Math.round(a)}`);
  for (const [a, b] of cut(hx0, hx1, doorGap ? [doorGap] : [])) wallKit('z', iz1, -1, a, b, true, `f${Math.round(a)}`);
  for (const side of [-1, 1]) {
    const wx = side < 0 ? hx0 : hx1, inn = -side, isSalon = salon && ((side < 0 && salon.side < 0) || (side > 0 && salon.side > 0));
    const gaps = [...(isSalon ? salon.ops.map(([oz, ow]) => [oz - ow / 2 - 0.6, oz + ow / 2 + 0.6]) : []), ...(stage && !stage.fz && stage.side === side ? [[stage.z - 2.9, stage.z + 2.9]] : []), ...(cbb && Math.abs((cbb.x0 + cbb.x1) / 2 - wx) < 3 ? [[cbb.z0 - 1, cbb.z1 + 1]] : [])];
    for (const [a, b] of cut(iz0 + 0.4, iz1 - 0.4, gaps)) wallKit('x', isSalon ? salon.px + inn * (IW + 0.02) : wx, inn, a, b, !isSalon, `s${side}${Math.round(a)}`, isSalon);
  }

  // ---- the salon: the fire, a sofa and club chairs round it, bookcases, then whatever fits
  const GROUPS = loungeGroups({ D, tint, VELVET, BOUCLE, RUG, WOODS, LEATHER, accent });
  let fire = null;
  if (salon) {
    const outer = salon.side < 0 ? ix0 : ix1, inn = -salon.side, zc = (iz0 + iz1) / 2;
    for (const dz of [0, -1.5, 1.5, -3, 3]) if (keep(() => {
      if (!L.against('fireplace', 'x', outer, inn, zc + dz)) return false;
      const q = frame(outer, zc + dz, inn > 0 ? H : -H), lc = tint(LEATHER, 'fc');
      q('organic_rug', 0, 2.5, H, tint(RUG, 'fr'));
      if (!q('sofa_lounge', 0, 4.0, P, tint(VELVET, 'fs'))) return false;
      q('stone_table', 0, 2.6, 0);
      if (!q('club_chair', -1.55, 2.6, H, lc) || !q('club_chair', 1.55, 2.6, -H, lc)) return false;
      q('floor_lantern', -1.5, 0.55); q('floor_lantern', 1.5, 0.55);
      fire = { x: outer + inn * 2.6, z: zc + dz };
      return true;
    })) break;
    for (const [x, z] of [[salon.x0 + 1.6, iz0], [salon.x1 - 1.6, iz0]]) L.against('bookcase', 'z', z, +1, x, { c: tint(WOODS, 'bk', x) });
    for (const [oz, ow] of salon.ops) for (const s of [-1, 1]) for (const sd of [-1, 1]) L.tryAdd(D('ot', oz, s, sd).chance(0.6) ? 'olive_tree' : 'planter_palm', [[salon.px + sd * 0.7, oz + s * (ow / 2 + 0.55)]], { c: sd > 0 ? tint(STONE, 'op', oz) : '#e9e2d6' });
  }

  // ---- the rest: groups where the room opens out, the widest spot first, each turned to what it looks at
  const fillArea = (rx0, rz0, rx1, rz1, kinds, foci, tag) => fillGroups(L, D, GROUPS, { rx0, rz0, rx1, rz1, kinds, foci, tag, cap: 0.29 });
  const hallFoci = [...(bar && !bar.wall ? [[bar.x, bar.z]] : []), ...(stage ? [[stage.x, stage.z]] : []), ...(bar && bar.wall ? [[bar.x, bar.z]] : [])];
  if (!hallFoci.length) hallFoci.push([hcx, (iz0 + iz1) / 2]);
  fillArea(hx0, iz0, hx1, iz1, ['lounge', 'loves', 'curve', 'fire', 'booth', 'four', 'two', 'relax', 'clubs', 'chat'], hallFoci, 'h');
  if (salon) fillArea(salon.x0, iz0, salon.x1, iz1, ['lounge', 'loves', 'relax', 'curve', 'two', 'four', 'clubs', 'chat'], [fire ? [fire.x, fire.z] : [(salon.x0 + salon.x1) / 2, (iz0 + iz1) / 2]], 's');

  // ---- plants and sculpture where they mean something: the hall's corners, the way in, the elevator's door
  for (const [x, z] of [[hx0 + 0.6, iz0 + 0.6], [hx1 - 0.6, iz0 + 0.6], [hx0 + 0.6, iz1 - 0.6], [hx1 - 0.6, iz1 - 0.6]]) L.tryAdd(D('cn', x, z).chance(0.5) ? 'olive_tree' : 'planter_palm', [[x, z, D('cr', x).float(0, 6.28)]], { c: tint(STONE, 'cp', x, z) });
  if (ground && dr) {
    for (const s of [-1, 1]) L.tryAdd('olive_tree', [[dr.x + s * (dr.w / 2 + 0.9), iz1 - 0.6]], { c: STONE[0] });
    L.tryAdd(D('greet').chance(0.5) ? 'ring_sculpture' : 'twist_sculpture', [[dr.x, iz1 - 4.6, 0], [dr.x + 2.6, iz1 - 4.2, -0.4], [dr.x - 2.6, iz1 - 4.2, 0.4]], { c: '#a9854a' }, 0.4);
  } else if (core) {
    const cs = Math.cos(core.r), sn = Math.sin(core.r), [dx, dz] = (CATALOG[core.t].doors || [[0, 0]])[0], d = 3.4 + (CATALOG[core.t].rect[3] || 0);
    L.tryAdd(D('greet').chance(0.5) ? 'ring_sculpture' : 'twist_sculpture', [[core.x + dx * cs + d * sn, core.z - dx * sn + d * cs, core.r]], { c: '#a9854a' }, 0.4);
  }
  // warm light along the foot of the outer walls
  for (const side of [-1, 1]) for (let z = iz0 + 1.3; z <= iz1 - 1.0; z += 2.2) L.add('cove_light', (side < 0 ? ix0 : ix1) - side * 0.12, z, H, { c: warm }, 0);
}
/** All or nothing: the pieces fn puts down stay only if it returns true. */
function keepAll(L, fn) { const ni = L.items.length, nr = L.rects.length; if (fn()) return true; L.items.length = ni; L.rects.length = nr; return false; }
/** Groups set where a region of the floor opens out, the widest free spot first (a lattice of points, each with its
 *  distance to the nearest piece, wall or kept room), each turned toward the nearest focus in eighths of a half turn
 *  (round ones any way), keeping a walkway from what was there, until `cap` of the floor is under pieces. GROUPS:
 *  { kind: { need (free radius), round, make(q, k) } }. */
function fillGroups(L, D, GROUPS, { rx0, rz0, rx1, rz1, kinds, foci, tag, cap = 0.29, gap = 0.6 }) {
  const { ix0, ix1, iz0, iz1 } = L, area = (ix1 - ix0) * (iz1 - iz0);
  const solid = () => L.items.reduce((t, it) => { const d = CATALOG[it.t]; return t + (d.block === false || d.fixed ? 0 : (d.rect[2] - d.rect[0]) * (d.rect[3] - d.rect[1])); }, 0);
  const pts = [], dist = (p, r) => Math.hypot(Math.max(r[0] - p.x, 0, p.x - r[2]), Math.max(r[1] - p.z, 0, p.z - r[3]));
  for (let z = rz0 + 0.9; z <= rz1 - 0.9; z += 0.5) for (let x = rx0 + 0.9; x <= rx1 - 0.9; x += 0.5) pts.push({ x, z, d: Math.min(x - ix0, ix1 - x, z - iz0, iz1 - z) });
  for (const p of pts) for (const r of L.rects) p.d = Math.min(p.d, dist(p, r));
  let seen = L.rects.length;
  for (let n = 0; n < 90; n++) {
    if (L.rects.length < seen) seen = L.rects.length;
    for (; seen < L.rects.length; seen++) for (const p of pts) p.d = Math.min(p.d, dist(p, L.rects[seen]));
    if (solid() >= area * cap) break;
    let best = null; for (const p of pts) if (!p.used && (!best || p.d > best.d)) best = p;
    if (!best || best.d < 1.0) break;
    best.used = true;
    const fits = kinds.filter(k => GROUPS[k].need <= best.d);
    if (!fits.length) continue;
    const big = fits.filter(k => GROUPS[k].need >= Math.max(...fits.map(f => GROUPS[f].need)) - 0.45);
    const kind = D('fk', tag, n).pick(big), f = foci.reduce((a, b) => Math.hypot(b[0] - best.x, b[1] - best.z) < Math.hypot(a[0] - best.x, a[1] - best.z) ? b : a, foci[0]);
    const ang = Math.atan2(f[0] - best.x, f[1] - best.z), r = GROUPS[kind].round ? ang : Math.round(ang / (P / 8)) * (P / 8);   // (the groups fan round what they look at: no rows)
    const start = L.rects.length, cs = Math.cos(r), sn = Math.sin(r);
    const q = (t, lx, lz, rr = 0, c = null, pad = 0.05) => {   // (a group keeps a walkway from the pieces already there)
      const def = CATALOG[t], x = best.x + lx * cs + lz * sn, z = best.z - lx * sn + lz * cs;
      if (def.block !== false) { const bb = itemAABB({ x, z, r: r + rr }, def.rect); for (let i = 0; i < start; i++) { const R = L.rects[i]; if (R[4] === K_ITEM && bb.x0 < R[2] + gap && bb.x1 > R[0] - gap && bb.z0 < R[3] + gap && bb.z1 > R[1] - gap) return null; } }
      return L.add(t, x, z, r + rr, c ? { c } : null, pad);
    };
    if (!keepAll(L, () => GROUPS[kind].make(q, `${tag}${n}`))) for (const p of pts) if (Math.hypot(p.x - best.x, p.z - best.z) < 0.6) p.used = true;
  }
}
/** The lounge's groups, each laid out in its own frame (+z toward what it looks at): `need` is the free radius it
 *  takes, `round` lets it turn any way (round tables), `make(q, k)` places it through q(type, x, z, turn, colour). */
function loungeGroups({ D, tint, VELVET, BOUCLE, RUG, WOODS, LEATHER, accent }) {
  return {
    lounge: { need: 2.15, make: (q, k) => {   // a tufted sofa facing out, club chairs facing it across a coffee table
      q('organic_rug', 0, -0.1, 0, tint(RUG, 'r', k));
      if (!q('sofa_lounge', 0, -1.05, 0, tint(VELVET, 's', k))) return false;
      q('stone_table', 0, 0.05, 0);
      const lc = tint(LEATHER, 'l', k);
      if (!q('club_chair', -1.38, 0.95, 2.47, lc) || !q('club_chair', 1.38, 0.95, -2.47, lc)) return false;
      q('side_lamp_table', 1.62, -1.22, 0, tint(WOODS, 'w', k)); q('floor_lantern', -1.62, -1.22);
      return true;
    } },
    loves: { need: 1.75, make: (q, k) => {   // two loveseats face to face across a stone table
      q('organic_rug', 0, 0, H, tint(RUG, 'r', k));
      const c = tint(VELVET, 's', k);
      if (!q('loveseat', 0, -0.98, 0, c) || !q('loveseat', 0, 0.98, Math.PI, c)) return false;
      q('stone_table', 0, 0, 0); q('side_lamp_table', 1.25, -1.32, 0, tint(WOODS, 'w', k)); q('floor_lantern', -1.25, 1.32);
      return true;
    } },
    curve: { need: 2.15, make: (q, k) => {
      q('organic_rug', 0, 0.15, 0, tint(RUG, 'r', k));
      if (!q('curve_sofa', 0, -0.95, 0, tint(VELVET, 's', k))) return false;
      q('stone_table', 0, 0.3, D('t', k).float(-0.2, 0.2));
      const bc = tint(BOUCLE, 'b', k); if (!q('boucle_chair', -0.95, 1.5, Math.PI + 0.35, bc) || !q('boucle_chair', 0.95, 1.5, Math.PI - 0.35, bc)) return false;
      q('side_lamp_table', 1.6, -0.85, 0, tint(WOODS, 'w', k)); q(D('lamp', k).chance(0.6) ? 'arc_lamp' : 'floor_lantern', -1.65, -1.2, 0);
      return true;
    } },
    fire: { need: 1.95, make: (q, k) => {
      q('organic_rug', 0, 0, 0, tint(RUG, 'r', k));
      if (!q('fire_table', 0, 0, 0)) return false;
      const bc = tint(BOUCLE, 'b', k), sc = tint(VELVET, 's', k);
      if (!q('boucle_chair', -1.38, 0, Math.PI / 2, bc) || !q('boucle_chair', 1.38, 0, -Math.PI / 2, bc)) return false;
      q('shell_chair', 0, -1.2, 0, sc); q('shell_chair', 0, 1.2, Math.PI, sc);
      q('floor_lantern', -1.75, 1.15, 0); q('floor_lantern', 1.75, -1.15, 0);
      return true;
    } },
    relax: { need: 1.75, make: (q, k) => {
      q('organic_rug', 0, 0.1, 0, tint(RUG, 'r', k));
      const c = tint(VELVET, 's', k);
      if (!q('chaise', -0.76, 0, 0, c) || !q('chaise', 0.76, 0, 0, c)) return false;
      q('side_lamp_table', 0, -0.62, 0, tint(WOODS, 'w', k)); q('planter_palm', -1.65, -0.6, 0, '#e9e2d6'); q('floor_lantern', 1.5, -0.75, 0);
      return true;
    } },
    booth: { need: 1.75, make: (q, k) => !!q('booth_round', 0, 0.4, 0, tint(VELVET, 'b', k)) },
    four: { need: 1.45, round: true, make: (q, k) => !!q('table_four', 0, 0, D('a', k).pick([0, Math.PI / 4]), tint(VELVET, 'c', k), 0.15) },
    two: { need: 1.15, round: true, make: (q, k) => !!q('table_two', 0, 0, 0, tint(VELVET, 'c', k), 0.15) },
    clubs: { need: 1.3, make: (q, k) => {   // two club chairs angled toward each other, a side table between
      const lc = tint(LEATHER, 'l', k);
      if (!q('club_chair', -0.62, 0, 0.5, lc) || !q('club_chair', 0.62, 0, -0.5, lc)) return false;
      q('side_lamp_table', 0, -0.42, 0, tint(WOODS, 'w', k));
      return true;
    } },
    chat: { need: 1.15, make: (q, k) => {   // two shell chairs and a lamp
      const c = tint(VELVET, 's', k);
      if (!q('shell_chair', -0.62, 0, 0.45, c) || !q('shell_chair', 0.62, 0, -0.45, c)) return false;
      q('side_lamp_table', 0, -0.3, 0, tint(WOODS, 'w', k));
      return true;
    } },
    high: { need: 1.0, round: true, make: (q, k) => !!q('highboy', 0, 0, D('a', k).float(0, 2), accent, 0.15) },
  };
}
/**
 * The night club (2026-10-23, the product owner: "a big DJ booth in the center, like a center stage, dance floor all around ... sort
 * of like a lounge with tables and booths, larger tables for big parties ... a big bar ... lights, lasers, speakers ...
 * make the night club fun and really pretty to look at. Think of high end Miami beach clubs"). On black marble:
 *   the middle   the DJ's round stage (its truss of moving lights, a mirror ball, lasers) on an LED dance floor ring, a
 *                smaller ring on a middling floor; speaker stacks at its corners, light towers at its sides, go-go
 *                podiums at its edge, high tables round it
 *   the bar      the long backlit onyx bar on the back wall, the LED video wall beside it
 *   VIP          booths for big parties along the side walls, each on velvet carpet between velvet ropes under neon VIP
 *   the rest     party tables, lounge sofas, loveseats, tables for four, high tables where the room opens out, turned to
 *                the dance floor; royal palms, neon palms over MIAMI, laser bars on the walls
 * A small floor gets the DJ's stage on the back wall with the dance floor before it. Aisles run from the way in, the
 * elevator and the bar to the dance floor.
 */
export function clubThemeFloor(L, o = {}) {
  const base = L.rng.int(1, 2 ** 30), D = (...k) => dice(base, ...k);
  const { ix0, ix1, iz0, iz1 } = L, dr = L.b.door, ground = !!o.ground, W = ix1 - ix0, Dp = iz1 - iz0;
  L.name = o.name || 'Night Club'; L.venue = 'club';
  L.zone(ix0, iz0, ix1, iz1, 'club_marble');
  placeCore(L);
  if (ground) reserveEntrance(L, 3.4);
  const core = L.b.core, cbb = core ? itemAABB(core, CATALOG[core.t].rect) : null;
  const SEAT = ['#f3f0ea', '#f3f0ea', '#e8b4b8', '#1f1f24', '#2a9d8f', '#c9a227', '#7a1f3d'], ROPE = ['#c2185b', '#7a1f3d', '#e8508a'];
  const tint = (pal, ...k) => D('tint', ...k).pick(pal);
  const vip = tint(['#f3f0ea', '#e8b4b8', '#1f1f24', '#7a1f3d'], 'vip'), rope = tint(ROPE, 'rope');
  const put = (t, x, z, r = 0, c = null, pad = 0.05) => L.add(t, x, z, r, c ? { c } : null, pad);
  const cx0 = (ix0 + ix1) / 2;

  // ---- the back wall: the bar on its widest stretch clear of the elevator, the LED wall on another
  const spans = [];
  if (cbb && cbb.z0 < iz0 + 1.6) { if (cbb.x0 - 0.9 - ix0 > 0.5) spans.push([ix0, cbb.x0 - 0.9]); if (ix1 - cbb.x1 - 0.9 > 0.5) spans.push([cbb.x1 + 0.9, ix1]); }
  else spans.push([ix0, ix1]);
  spans.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  let bar = null;
  if (spans.length && spans[0][1] - spans[0][0] >= 7.4) {
    const [s0, s1] = spans[0], bx = s1 - s0 >= 16 ? (D('bar-end').chance(0.5) ? s0 + 4.2 : s1 - 4.2) : (s0 + s1) / 2;
    if (L.against('club_bar', 'z', iz0, +1, bx, { c: tint(SEAT, 'stools') })) {
      bar = { x: bx, z: iz0 + 2.0 };
      L.reserve(bx - 3.4, iz0 + 1.55, bx + 3.4, iz0 + 2.7);
      spans.splice(0, 1, ...[[s0, bx - 3.5], [bx + 3.5, s1]].filter(([a, b]) => b - a > 0.5));
    }
  }
  if (!bar) for (const side of [-1, 1]) if (L.against('club_bar', 'x', side < 0 ? ix0 : ix1, -side, iz0 + Math.max(4, Dp * 0.35), { c: tint(SEAT, 'stools') })) { bar = { x: side < 0 ? ix0 + 2.0 : ix1 - 2.0, z: iz0 + Math.max(4, Dp * 0.35) }; break; }
  spans.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  if (spans.length && spans[0][1] - spans[0][0] >= 5.4) L.against('led_wall', 'z', iz0, +1, (spans[0][0] + spans[0][1]) / 2, null, 0.01);

  // ---- the middle: the DJ's stage on its LED dance floor, sound and light round it
  let floor = null;
  const oct = (x, z, R) => { const k = 0.414 * R, s = 0.71 * R; return [{ x0: x - R, z0: z - k, x1: x + R, z1: z + k }, { x0: x - k, z0: z - R, x1: x + k, z1: z + R }, { x0: x - s, z0: z - s, x1: x + s, z1: z + s }]; };
  const tryRing = ring => {
    const R = CATALOG[ring].rect[2], back = bar && bar.z < iz0 + 3 ? iz0 + 2.8 : iz0 + 0.6;
    const zc = Math.max(back + R + 0.3, (back + iz1) / 2 - (ground ? 0.8 : 0));
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 2], [0, -2], [3, 0], [-3, 0], [2, 1.5], [-2, 1.5], [4, 0], [-4, 0]]) {
      const x = cx0 + dx, z = zc + dz;
      const clear = bb => L.inside(bb) && L.rects.every(r => r[4] === K_RESERVE || bb.x0 >= r[2] || bb.x1 <= r[0] || bb.z0 >= r[3] || bb.z1 <= r[1]);   // (the floor is walked on: it may cover the way in, only pieces and walls are in its way)
      if (!oct(x, z, R + 0.35).every(clear)) continue;
      if (!put('dj_stage', x, z, 0)) continue;
      put(ring, x, z, 0);
      floor = { x, z, R };
      for (const a of [0.75, 1.25].map(k => k * P)) put('go_go_podium', x + Math.sin(a) * (R - 0.75), z + Math.cos(a) * (R - 0.75), 0);
      for (const bb of oct(x, z, R)) L.reserve(bb.x0, bb.z0, bb.x1, bb.z1);   // (the dance floor kept clear)
      return true;
    }
    return false;
  };
  if (W >= 17 && Dp >= 16) tryRing('dance_ring');
  if (!floor && W >= 10.5 && Dp >= 11) tryRing('dance_ring_s');
  if (!floor) {   // a small floor: the stage against a wall (the back, else a side), the dance floor before it
    const sp = spans.filter(([a, b]) => b - a >= 5.2).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    const tries = [...sp.map(([a, b]) => ['z', iz0, +1, (a + b) / 2]), ['x', ix0, +1, iz0 + Dp * 0.55], ['x', ix1, -1, iz0 + Dp * 0.55]];
    for (const [axis, line, inn, t] of tries) {
      if (!keepAll(L, () => {
        if (!L.against('dj_stage', axis, line, inn, t)) return false;
        const d = line + inn * (2.83 + 2.3), x = axis === 'z' ? t : d, z = axis === 'z' ? d : t;
        if (!put('dance_floor', x, z, 0)) return false;
        L.reserve(x - 2.25, z - 2.25, x + 2.25, z + 2.25);
        floor = { x, z, R: 2.4, small: true };
        return true;
      })) continue;
      break;
    }
  }
  if (floor && !floor.small) {
    const { x, z, R } = floor;
    for (let k = 0; k < 4; k++) { const a = (k + 0.5) / 4 * 2 * P, d = R + 0.95; L.tryAdd('speaker_stack', [[x + Math.sin(a) * d, z + Math.cos(a) * d, a + P]]); }
    for (let k = 0; k < 4; k++) { const a = k / 4 * 2 * P, d = R + 0.8; L.tryAdd('light_tower', [[x + Math.sin(a) * d, z + Math.cos(a) * d, a + P]]); }
    const rh = R + 2.3, n = Math.max(6, Math.round(2 * P * rh / 3.4));
    for (let k = 0; k < n; k++) { const a = (k + 0.5) / n * 2 * P; L.tryAdd('highboy', [[x + Math.sin(a) * rh, z + Math.cos(a) * rh, a]], { c: tint(SEAT, 'hb', k) }, 0.35); }
  }

  // ---- the ways through: from the way in, the elevator and the bar to the dance floor
  const aisle = (ax, az, bx, bz, w = 1.6) => { L.reserve(Math.min(ax, bx) - w / 2, az - w / 2, Math.max(ax, bx) + w / 2, az + w / 2); L.reserve(bx - w / 2, Math.min(az, bz) - w / 2, bx + w / 2, Math.max(az, bz) + w / 2); };
  if (floor) {
    const to = (px, pz) => { const dx = px - floor.x, dz = pz - floor.z, d = Math.hypot(dx, dz) || 1; return [floor.x + dx / d * floor.R * 0.8, floor.z + dz / d * floor.R * 0.8]; };
    if (ground && dr) { const [bx, bz] = to(dr.x, iz1); aisle(dr.x, iz1 - 0.5, bx, bz); }
    if (core && CATALOG[core.t].doors) { const cs = Math.cos(core.r), sn = Math.sin(core.r), [dx, dz] = CATALOG[core.t].doors[0], ex = core.x + dx * cs + (dz + 1.2) * sn, ez = core.z - dx * sn + (dz + 1.2) * cs, [bx, bz] = to(ex, ez); aisle(ex, ez, bx, bz); }
    if (bar) { const [bx, bz] = to(bar.x, bar.z); aisle(bar.x, bar.z + 0.6, bx, bz, 1.4); }
  }

  // ---- VIP along the side walls: booths for big parties on velvet carpet between ropes, neon VIP over them
  const sideRun = (side) => {
    const wx = side < 0 ? ix0 : ix1, inn = -side;
    const z0 = iz0 + (bar && !bar.wall ? 2.9 : 0.6), z1 = iz1 - (ground ? 1.2 : 0.6);
    let z = z0 + 0.2, n = 0;
    while (z + 4.3 <= z1 && n < 12) {
      if (cbb && wx + inn * 2.2 > Math.min(cbb.x0, cbb.x1) - 1 && wx + inn * 2.2 < Math.max(cbb.x0, cbb.x1) + 1 && z + 4.3 > cbb.z0 - 1 && z < cbb.z1 + 2) { z += 1; continue; }
      const m = z + 2.15;
      if (keepAll(L, () => {
        if (!L.against('vip_booth', 'x', wx, inn, m, { c: vip })) return false;
        for (const d of [-2.15, 2.15]) L.add('velvet_rope', wx + inn * 1.15, m + d, H, { c: rope }, 0.02);
        if (n % 2 === 0) L.against('neon_vip', 'x', wx, inn, m, null, 0.01);
        else L.against('neon_palm', 'x', wx, inn, m, null, 0.01);
        return true;
      })) { L.zone(Math.min(wx, wx + inn * 2.6), m - 2.1, Math.max(wx, wx + inn * 2.6), m + 2.1, 'vip_carpet'); z += 4.4; n++; }
      else z += 0.8;
    }
  };
  if (W >= 11) for (const side of [-1, 1]) sideRun(side);

  // ---- the rest: party tables, lounges and tables where the room opens out, turned to the dance floor
  const GROUPS = clubGroups({ D, tint, SEAT, vip });
  const foci = floor ? [[floor.x, floor.z]] : [[cx0, (iz0 + iz1) / 2]];
  fillGroups(L, D, GROUPS, { rx0: ix0, rz0: iz0, rx1: ix1, rz1: iz1, kinds: ['party', 'party', 'vipb', 'lounge', 'loves', 'four', 'high', 'two'], foci, tag: 'c', cap: 0.3 });   // (parties first: twice the chance)

  // ---- light and life on the walls and in the corners: lasers high on the side walls, royal palms, the way in
  for (const side of [-1, 1]) L.against('laser_bar', 'x', side < 0 ? ix0 : ix1, -side, iz0 + Dp * (side < 0 ? 0.42 : 0.58), null, 0.01);
  for (const [x, z] of [[ix0 + 0.6, iz1 - 0.6], [ix1 - 0.6, iz1 - 0.6], [ix0 + 0.6, iz0 + 0.6], [ix1 - 0.6, iz0 + 0.6]]) L.tryAdd('royal_palm', [[x, z, D('rp', x).float(0, 6.28)]]);
  if (ground && dr) {
    for (const s of [-1, 1]) { L.tryAdd('royal_palm', [[dr.x + s * (dr.w / 2 + 0.9), iz1 - 0.6]]); L.tryAdd('velvet_rope', [[dr.x + s * (dr.w / 2 + 0.25), iz1 - 1.6, H]], { c: rope }, 0.02); }
  }
  // warm light along the foot of the outer walls, pink
  for (const side of [-1, 1]) for (let z = iz0 + 1.3; z <= iz1 - 1.0; z += 2.2) L.add('cove_light', (side < 0 ? ix0 : ix1) - side * 0.12, z, H, { c: '#ff4fa3' }, 0);
}
/** The club's groups (as the lounge's: +z toward the dance floor). */
function clubGroups({ D, tint, SEAT, vip }) {
  const RUG = ['#2a2a30', '#3b1d2c', '#1f2c4a', '#e8dcc6'], WOODS = ['#1f1f24', '#c9a227', '#f3f0ea'];
  const G = loungeGroups({ D, tint, VELVET: SEAT, BOUCLE: ['#f3f0ea', '#e8dcc6', '#f6e7ea'], RUG, WOODS, LEATHER: SEAT, accent: '#c9a227' });
  return {
    lounge: G.lounge, loves: G.loves, four: G.four, two: G.two, high: G.high,
    party: { need: 2.0, round: true, make: (q, k) => !!q('party_table', 0, 0, D('pa', k).pick([0, Math.PI / 2]), tint(SEAT, 'pt', k), 0.15) },
    vipb: { need: 2.15, make: (q, k) => { if (!q('vip_booth', 0, 0.5, 0, vip)) return false; q('royal_palm', -2.2, -1.2, 0); q('velvet_rope', 2.3, 0.2, Math.PI / 2, '#c2185b'); return true; } },
  };
}
/** A night club: a dance floor in the middle (two on a wide floor) with the DJ's counter behind it, a long bar on the
 *  back wall, booths (a sofa and a low table) along the side walls, tables to stand at round the floor; dark tile. */
export function clubFloor(L, o = {}) {
  const base = L.rng.int(1, 2 ** 30), D = (...k) => dice(base, ...k);
  const { ix0, ix1, iz0, iz1 } = L, dr = L.b.door, ground = !!o.ground, W = ix1 - ix0, Dp = iz1 - iz0;
  L.name = o.name || 'Night Club'; L.venue = 'club';
  L.zone(ix0, iz0, ix1, iz1, 'tile_dark');
  placeCore(L);
  if (ground) reserveEntrance(L, 3.4);
  const core = L.b.core, cx = (ix0 + ix1) / 2;
  // the bar along the back wall, clear of the elevator
  L.with(D('bar'), () => {
    const cs = coreSpan(L, 0.8);
    for (const x of [cx - 4.5, cx - 1.5, cx + 1.5, cx + 4.5, cx - 7.5, cx + 7.5]) {
      if (cs && x + 1.6 > cs.x0 && x - 1.6 < cs.x1) continue;
      L.add('bar_counter', x, iz0 + 1.3, 0);
    }
    L.tryAdd('fridge', [[ix0 + 0.45, iz0 + 0.45], [ix1 - 0.45, iz0 + 0.45]]);
  });
  // the dance floor in the middle, the DJ behind it
  const mz = iz0 + Math.max(5.2, Dp * 0.5), wide = W >= 22;
  L.with(D('floor'), () => {
    L.zone(cx - (wide ? 4.6 : 2.4), mz - 2.4, cx + (wide ? 4.6 : 2.4), mz + 2.4, 'marble');
    const hw = wide ? 4.4 : 2.2;
    if (padFree(L, cx, mz, hw - 0.01) || padFree(L, cx, mz, 2.2)) {
      if (wide && padFree(L, cx, mz, hw - 0.01)) { L.add('dance_floor', cx - 2.2, mz, 0); L.add('dance_floor', cx + 2.2, mz, 0); L.reserve(cx - 4.4, mz - 2.2, cx + 4.4, mz + 2.2); }
      else { L.add('dance_floor', cx, mz, 0); L.reserve(cx - 2.2, mz - 2.2, cx + 2.2, mz + 2.2); }
    }
    L.tryAdd('counter', [[cx, mz - 2.75, 0]]);
    for (const [dx, dz] of [[-3.3, -1.6], [3.3, -1.6], [-3.3, 1.6], [3.3, 1.6]]) L.tryAdd('cafe_table', [[cx + dx * (wide ? 1.7 : 1), mz + dz, 0]], null, 0.1);
  });
  // booths along the side walls
  for (const side of [-1, 1]) {
    const wx = side < 0 ? ix0 : ix1;
    for (let z = iz0 + 3.6, n = 0; z <= iz1 - 2.0 && n < 6; z += 3.0, n++) L.with(D('booth', side, n), () => {
      if (L.against('sofa', 'x', wx, -side, z)) L.add('coffee_table', wx - side * 1.45, z, H);
    });
  }
  L.tryAdd('floor_lamp', [[ix0 + 0.35, iz1 - 0.35], [ix1 - 0.35, iz1 - 0.35]]);
  if (ground) for (const x of [dr.x - 1.9, dr.x + 1.9]) L.add('plant_tall', x, iz1 - 0.4);
}
/** A conference floor: meeting rooms behind glass along the back wall (each a table, a screen and a whiteboard), a
 *  boardroom in the middle where the floor is deep enough, a reception with a waiting corner, a coffee point. */
export function conferenceFloor(L, o = {}) {
  const base = L.rng.int(1, 2 ** 30), D = (...k) => dice(base, ...k);
  const { ix0, ix1, iz0, iz1 } = L, dr = L.b.door, ground = !!o.ground, W = ix1 - ix0, Dp = iz1 - iz0;
  L.name = o.name || 'Conference'; L.venue = null;
  L.zone(ix0, iz0, ix1, iz1, D('finish').pick(['carpet', 'carpet_blue', 'carpet_warm']));
  placeCore(L);
  if (ground) reserveEntrance(L, 3.4);
  const core = L.b.core, cx = core ? core.x : (ix0 + ix1) / 2, coreHalf = core ? CATALOG[core.t].rect[2] + 0.1 : -0.5;
  // meeting rooms along the back, out from the elevator
  const bandZ = iz0 + (Dp >= 14 ? 5.2 : Math.max(3.8, Dp * 0.38));
  if (bandZ - iz0 >= 3.8) for (const side of [-1, 1]) {
    let a = side < 0 ? cx - coreHalf - 0.5 : cx + coreHalf + 0.5;
    const end = side < 0 ? ix0 : ix1;
    if (core) L.wall(a, iz0, a, bandZ, 0);
    for (let k = 0; k < 24; k++) {
      const left = Math.abs(end - a); if (left < 3.2) break;
      const w = left - 6.2 < 3.2 ? left : 6.2, b = a + side * w, x0 = Math.min(a, b), x1 = Math.max(a, b);
      if (w < left) L.wall(b, iz0, b, bandZ, 1);
      L.with(D('room', side, k), () => backRoom(L, 'meeting', x0, iz0, x1, bandZ, side, o));
      a = b; if (w === left) break;
    }
  }
  // the boardroom in the middle (glass, a door on each long side), two tables end to end and a screen
  const bz0 = bandZ + 2.0, bz1 = Math.min(iz1 - (ground ? 4.2 : 2.4), bz0 + 6.2), bw = Math.min(12.4, W - 8);
  if (bz1 - bz0 >= 5 && bw >= 7) L.with(D('board'), () => {
    const x0 = cx - bw / 2, x1 = cx + bw / 2;
    L.zone(x0, bz0, x1, bz1, 'wood_dark');
    L.wallGaps(x0, bz0, x1, bz0, [[bw / 2, 1.2]], 1); L.wallGaps(x0, bz1, x1, bz1, [[bw / 2, 1.2]], 1);
    L.wall(x0, bz0, x0, bz1, 1); L.wall(x1, bz0, x1, bz1, 1);
    const mz = (bz0 + bz1) / 2;
    if (bw >= 10) { L.add('meeting_table', cx - 1.95, mz, 0); L.add('meeting_table', cx + 1.95, mz, 0); } else L.add('meeting_table', cx, mz, 0);
    L.against('tv_wall', 'x', x0 + IW, +1, mz); L.against('whiteboard', 'x', x1 - IW, -1, mz);
    L.tryAdd('plant_tall', [[x0 + 0.45, bz0 + 0.5], [x1 - 0.45, bz1 - 0.5]]);
  });
  // a reception and a waiting corner at the front, a coffee point on a side wall
  L.with(D('reception'), () => {
    const rx = ground ? dr.x + (D('rside').chance(0.5) ? 3.6 : -3.6) : cx, rz = iz1 - (ground ? 2.0 : 1.6);
    L.tryAdd('reception', [[rx, rz, P], [cx + 4, rz, P], [cx - 4, rz, P]]);
    L.tryAdd('sofa', [[ix0 + 0.5, iz1 - 2.6, H], [ix1 - 0.5, iz1 - 2.6, -H]]);
    L.tryAdd('coffee_table', [[ix0 + 1.5, iz1 - 2.6, H], [ix1 - 1.5, iz1 - 2.6, H]]);
  });
  L.with(D('coffee'), () => {
    const side = D('cside').chance(0.5) ? -1 : 1, wx = side < 0 ? ix0 : ix1, z = bandZ + 1.8;
    L.against('counter', 'x', wx, -side, z); L.against('coffee_machine', 'x', wx, -side, z + 1.3); L.against('water_cooler', 'x', wx, -side, z + 2.2);
  });
  for (const [x, z] of [[ix0 + 0.4, iz1 - 0.4], [ix1 - 0.4, iz1 - 0.4]]) L.tryAdd('plant', [[x, z]]);
}
/** Floor f laid out as a theme (shared/floor-themes.js); ground: the street floor (the entrance kept clear). */
export function themeFloor(L, theme, o = {}) {
  const ground = !!o.ground;
  if (ground && !['arcade', 'club', 'conference', 'cafe', 'restaurant', 'shop', 'gym', 'lounge'].includes(theme)) reserveEntrance(L, 3.2);
  switch (theme) {
    case 'arcade': return arcadeFloor(L, { ground });
    case 'club': return clubThemeFloor(L, { ground });
    case 'conference': return conferenceFloor(L, { ground });
    case 'lounge': return loungeThemeFloor(L, { ground });
    case 'cafe': return cafeThemeFloor(L, { ground, style: o.style });
    case 'restaurant': return restaurantFloor(L, { ground });
    case 'shop': return shopFloor(L, { ground });
    case 'gym': return gymFloor(L, { ground });
    case 'office': officeFloor(L, { fancy: true }); L.name = 'Open Office'; return null;
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------
// The airport's terminal (shared/world-modules.js: a long, shallow glass hall; the front, +z, faces the car park, the
// back the apron). The street floor: the entrance hall with an information desk; check-in desks along the back with
// the baggage conveyors behind them and departures boards over them; the security checkpoint before the lifts to the
// gates; arrivals with two baggage belts; restrooms. Upstairs: the departures lounge — rows of gate seats facing the
// apron, the gate desks and boards, a café (a venue: residents come for coffee), duty-free shelves, an arcade corner.
export function terminalFloor(L, o = {}) {
  const { ix0, ix1, iz0, iz1 } = L, ground = o.ground !== false, dr = L.b.door;
  const W = ix1 - ix0, X = u => ix0 + u * W;   // a share of the hall's length
  L.zone(ix0, iz0, ix1, iz1, 'terrazzo');
  placeCore(L);
  const core = L.b.core;
  if (ground) {
    L.name = o.name ? `${o.name} · Check-in` : 'Check-in';
    reserveEntrance(L, 4.5);
    L.zone(dr.x - 8, iz1 - 7, dr.x + 8, iz1, 'marble');
    L.tryAdd('reception', [[dr.x - 6, iz1 - 6.2, 0], [dr.x + 6, iz1 - 6.2, 0]]);   // the information desk
    for (const x of [dr.x - 5.5, dr.x + 5.5]) L.add('plant_tall', x, iz1 - 0.5);
    // check-in: desks in a row, the conveyors behind, the boards on the back wall
    const c0 = dr.x + 9, c1 = Math.min(ix1 - 12, dr.x + 52);
    L.zone(c0 - 2, iz0, c1 + 2, iz1 - 8, 'tile');
    for (let x = c0; x <= c1; x += 4.5) L.add('reception', x, iz0 + 6.5, 0);
    for (let x = c0 + 3; x <= c1 - 3; x += 11) L.add('baggage_belt', x, iz0 + 3.0, 0);
    for (let x = c0 + 2; x <= c1; x += 10) L.against('flight_board', 'z', iz0, +1, x);
    for (let x = c0; x <= c1; x += 9) L.tryAdd('plant', [[x + 2.2, iz1 - 3.5]]);
    // security before the lifts: scanners in a line, the trays' tables, the officers' desks
    const sx = core ? core.x + 8 : X(0.2);
    L.zone(sx - 10, iz0, sx + 10, iz1, 'tile_dark');
    for (const k of [-1, 0, 1]) { L.add('security_arch', sx + k * 4, iz0 + 9, 0); L.add('display', sx + k * 4 + 1.6, iz0 + 9.5, H); }
    L.tryAdd('reception', [[sx, iz0 + 13.5, P], [sx + 6, iz0 + 13.5, P]]);
    // arrivals: two baggage belts, benches round them
    const ax = ix0 + 9;
    L.zone(ix0, iz1 - 13, ix0 + 26, iz1, 'wood');
    L.add('baggage_belt', ax, iz1 - 6, 0); L.add('baggage_belt', ax + 9, iz1 - 6, 0);
    for (const x of [ax - 1.5, ax + 4.5, ax + 10.5]) L.tryAdd('bench', [[x, iz1 - 1.2, P]]);
    L.against('flight_board', 'x', ix0, +1, iz1 - 7);
    // restrooms in the far corner, behind a wall with a door
    const rx = ix1 - 8;
    L.wallGaps(rx, iz0, rx, iz0 + 9, [[6.5, 1.2]], 0); L.wall(rx, iz0 + 9, ix1, iz0 + 9, 0);
    L.zone(rx, iz0, ix1, iz0 + 9, 'tile');
    for (let k = 0; k < 3; k++) { L.against('toilet', 'z', iz0, +1, rx + 1.5 + k * 2.2); L.against('sink', 'x', ix1, -1, iz0 + 4.5 + k * 1.3); }
    for (const [x, z] of [[dr.x + 8.5, iz1 - 1], [dr.x - 8.5, iz1 - 1]]) L.tryAdd('vending', [[x, z, P]]);
    L.tryAdd('water_cooler', [[dr.x - 10.5, iz1 - 0.6, P]]);
    for (const x of [X(0.35), X(0.55)]) L.tryAdd('bench', [[x, iz1 - 1.2, P]]);
  } else {
    L.name = o.name ? `${o.name} · Departures` : 'Departures'; L.venue = 'cafe';
    // gate seating facing the apron (the back, −z), gate desks and boards on the back wall
    const g0 = core ? core.x + 8 : X(0.15), g1 = ix1 - 22;
    L.zone(g0 - 2, iz0, g1 + 2, iz1, 'carpet_blue');
    for (let gx = g0 + 8; gx < g1 - 4; gx += 26) {   // a gate: its desk and board, two rows of seats either side of a walkway
      L.add('reception', gx, iz0 + 1.6, 0); L.against('flight_board', 'z', iz0, +1, gx + 4.5);
      for (const z of [iz0 + 6.5, iz0 + 10]) for (const x of [-9.2, -6.9, -4.6, 4.6, 6.9, 9.2]) L.add('bench', gx + x, z, P, null, 0.02);
    }
    for (let x = g0 + 3; x < g1; x += 12) L.tryAdd('plant_tall', [[x, iz1 - 0.5]]);
    // the café: counter on the back wall, tables in front
    const cx = ix1 - 11;
    L.zone(ix1 - 20, iz0, ix1, iz1, 'wood');
    L.add('cafe_counter', cx, iz0 + 2.3, 0);
    L.against('coffee_machine', 'z', iz0, +1, cx - 1.2); L.against('fridge', 'z', iz0, +1, cx + 1.6);
    for (const x of [ix1 - 17, ix1 - 13, ix1 - 9, ix1 - 5]) for (const z of [iz0 + 6.5, iz0 + 10, iz1 - 2]) L.tryAdd('cafe_table', [[x, z, 0]], null, 0.1);
    // duty-free shelves, a checkout; an arcade corner by the front glass; a lounge
    const dx0 = ix0 + 1;
    if (core) {
      L.zone(dx0, iz1 - 11, core.x + 6, iz1, 'tile');
      for (const z of [iz1 - 3, iz1 - 6.5]) L.tryAdd('shop_shelf', [[dx0 + 4, z, 0], [dx0 + 7, z, 0]]);
      L.tryAdd('checkout', [[core.x + 2, iz1 - 3, P]]);
      L.tryAdd('display', [[dx0 + 2, iz1 - 9, 0]]);
    }
    for (let k = 0; k < 4; k++) L.against('arcade', 'z', iz1, -1, g1 + 2 + k * 1.15);   // between the lounge and the café
    L.tryAdd('sofa', [[g1 - 9, iz1 - 2.2, P]]); L.tryAdd('armchair', [[g1 - 12.5, iz1 - 2.2, P]]); L.tryAdd('coffee_table', [[g1 - 9, iz1 - 4, 0]]);
    L.tryAdd('vending', [[g0 - 3, iz1 - 0.6, P]]); L.tryAdd('water_cooler', [[g0 - 5, iz1 - 0.5, P]]);
  }
}

// ---------------------------------------------------------------------------------------------
// Parks (open lots, no walls; gates in the middle of each side)
export function parkLevel(L, o = {}) {
  const rng = L.rng, { ix0, ix1, iz0, iz1 } = L;
  L.name = o.name || 'Park'; L.venue = 'park';
  L.zone(ix0, iz0, ix1, iz1, 'grass');
  const pw = 2.8;
  L.zone(-pw / 2, iz0, pw / 2, iz1, 'paving');
  L.zone(ix0, -pw / 2, ix1, pw / 2, 'paving');
  L.zone(-8, -8, 8, 8, 'paving');
  L.addFixed('fountain', 0, 0, 0);   // first, at the crossing (added after the paths' reserve it never fitted: no park had one)
  L.reserve(-pw / 2, iz0, pw / 2, iz1); L.reserve(ix0, -pw / 2, ix1, pw / 2);
  L.reserve(-4.3, -4.3, 4.3, 4.3);
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 + Math.PI / 8, R = 6.7;
    L.add('flowers', Math.sin(a) * R, Math.cos(a) * R, a + H, null, 0.02);
  }
  for (const s of [-1, 1]) {
    for (let t = 11; t < (iz1 - iz0) / 2 - 3; t += 7) { L.add('bench', pw / 2 + 0.95, s * t, -H); L.add('bench', -pw / 2 - 0.95, s * t, H); }
    for (let t = 11; t < (ix1 - ix0) / 2 - 3; t += 7) { L.add('bench', s * t, pw / 2 + 0.95, P); L.add('bench', s * t, -pw / 2 - 0.95, 0); }
  }
  for (const qx of [-1, 1]) for (const qz of [-1, 1]) {
    const x0 = qx < 0 ? ix0 + 1.5 : pw / 2 + 3, x1 = qx < 0 ? -pw / 2 - 3 : ix1 - 1.5;
    const z0 = qz < 0 ? iz0 + 1.5 : pw / 2 + 3, z1 = qz < 0 ? -pw / 2 - 3 : iz1 - 1.5;
    for (let k = 0; k < 4; k++) L.tryAdd('picnic_table', [[rng.float(x0 + 2, x1 - 2), rng.float(z0 + 2, z1 - 2), rng.chance(0.5) ? 0 : H]], null, 1.2);
    const area = (x1 - x0) * (z1 - z0);
    const nt = Math.min(40, Math.round(area / 45));
    for (let k = 0; k < nt * 3; k++) {
      const x = rng.float(x0, x1), z = rng.float(z0, z1);
      if (Math.hypot(x, z) < 9.5) continue;
      L.add(rng.chance(0.25) ? 'tree_pine' : 'tree', x, z, rng.float(0, 6.28), null, 1.7);
    }
    for (let k = 0; k < 7; k++) L.add('bush', rng.float(x0, x1), rng.float(z0, z1), rng.float(0, 6.28), null, 0.4);
  }
  if (o.dance) L.tryAdd('dance_floor', [[ix1 - 8, iz1 - 8, 0], [ix0 + 8, iz1 - 8, 0]]);
}

// ---------------------------------------------------------------------------------------------
export function buildLevel(b, f, rng, o = {}) {
  const L = new LevelBuilder(b, rng, b.type === 'park');
  const ground = f === 0;
  if (o.theme && b.type !== 'park') { themeFloor(L, o.theme, { ground, style: o.style }); return L.result(); }   // a themed floor (Floor Themes; a café's style)
  switch (b.type) {
    case 'park': parkLevel(L, { name: b.name, dance: o.dance }); break;
    case 'office':
      if (ground) officeLobby(L, { cafe: b.mixed === 'cafe' });
      else if (o.vacant) vacantFloor(L);
      else officeFloor(L, { fancy: rng.chance(0.3) });
      break;
    case 'hq':
      if (ground) officeLobby(L, { cafe: true });
      else if (f === b.floors - 1 && b.floors > 2) loungeFloor(L, { name: 'Sky Lounge' });
      else officeFloor(L, { fun: f === 1, fancy: true, name: f === 1 ? 'Agent Floor' : 'Office', deskType: f === 1 ? 'desk_l' : 'desk' });
      break;
    case 'apartment':
      if (ground) {
        if (b.mixed === 'cafe') cafeFloor(L, { name: b.shopName, ground });
        else if (b.mixed === 'shop') shopFloor(L, { name: b.shopName, ground });
        else if (b.mixed === 'restaurant') restaurantFloor(L, { name: b.shopName, ground });
        else apartmentLobby(L);
      } else apartmentFloor(L, { plan: o.plan });
      break;
    case 'cafe': cafeThemeFloor(L, { name: ground ? b.name : b.name + ' Upstairs', ground }); break;
    case 'restaurant': restaurantFloor(L, { name: ground ? b.name : b.name + ' Dining Room', ground }); break;
    case 'shop': shopFloor(L, { name: b.name, clothes: b.clothes, tackle: b.tackle, ground }); break;
    case 'gym': gymFloor(L, { name: b.name, ground }); break;
    case 'terminal': terminalFloor(L, { name: b.name, ground }); break;
    default: vacantFloor(L);
  }
  return L.result();
}
