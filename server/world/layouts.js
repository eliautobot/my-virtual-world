// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Interior layout generators. All coordinates are building-local (origin = footprint centre, +z = front/entrance).
// Placement uses exact rectangle tests (items, reserved clearances, walls) so furniture can sit flush to walls.
import { CATALOG } from '../../shared/catalog.js';
import { WALL_T } from '../../shared/constants.js';
import { itemAABB } from '../../shared/geom.js';
import { RNG } from '../../shared/rng.js';

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
    if (this.units.length) out.units = this.units;
    if (this.doors.length) out.doors = this.doors;
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
    default: return rng.pick(WOOD);
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
 * in from the windows), on a floor above it the elevator (columns out from it, rows out from the back wall) - so every
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
 * widths counted out from it - meeting rooms, private offices, a kitchen, phone booths - and in front an open plan of
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
 *  elevators, a waiting corner on the other side, a café on the back wall when the building has one - all placed from
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
// at its west end, and on each side a row of real flats - studios, one- and two-bedroom - each of its own fixed width,
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
 *  block - placed from the entrance and the elevator, so a resize only moves what stands at the far side wall. */
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
  const core = L.b.core;
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
// The airport's terminal (shared/world-modules.js: a long, shallow glass hall; the front, +z, faces the car park, the
// back the apron). The street floor: the entrance hall with an information desk; check-in desks along the back with
// the baggage conveyors behind them and departures boards over them; the security checkpoint before the lifts to the
// gates; arrivals with two baggage belts; restrooms. Upstairs: the departures lounge - rows of gate seats facing the
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
    case 'cafe': cafeFloor(L, { name: ground ? b.name : b.name + ' Upstairs', ground }); break;
    case 'restaurant': restaurantFloor(L, { name: ground ? b.name : b.name + ' Dining Room', ground }); break;
    case 'shop': shopFloor(L, { name: b.name, clothes: b.clothes, tackle: b.tackle, ground }); break;
    case 'gym': gymFloor(L, { name: b.name, ground }); break;
    case 'terminal': terminalFloor(L, { name: b.name, ground }); break;
    default: vacantFloor(L);
  }
  return L.result();
}
