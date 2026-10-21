// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The island's ground (WP4.2, wp4-world-spec.md §3.2): one deterministic height function shared by the server
// (players, vehicles, residents), the browser (terrain meshes, scatter) and workers. It is generated, not stored: a pinned
// generator version, a seed and a few parameters give the same island everywhere. Only + − × ÷, floor, sqrt and
// Math.imul are used, so every JavaScript engine computes bit-identical heights (no sin/cos/exp/pow).
// The canonical surface is a grid of 8 ft (2.4384 m) cells; heights between grid points are bilinear, so the physics
// ground, the rendered ground and the simulation agree exactly at full detail.
// Today's city keeps its flat ground: around its rectangle the ground is held at sidewalk height and blends into the
// natural terrain over a few hundred metres. Edits (terrain brushes, WP4.7) add per-chunk deltas on top later.

import { TerrainEdits } from './terrain-edits.js';
import { prepareIsland, chainLandness, chainNatural } from './island-chain.js';
import { inGridBlock } from './island-build.js';
const GRID_SINK = 0.35;   // m the drawn terrain lies under a grid block's surface
import { IslandRoads, BRIDGE_DEPTH, BRIDGE_DECK } from './island-roads.js';

// v2: beaches shelve smoothly into the sea (v1 had a 1 m step at the waterline and a steep sea floor right offshore).
// v3: rivers run from the mountains to the sea or a lake, in carved channels, with waterfalls where they drop.
export const TERRAIN_GENERATOR = 'island-v3';
const BEACH_L = 0.12, RIVER_BANK = 16, RIVER_SHELF = 2.5, RIVER_CELL = 64, PAD_BLEND = 8, PAD_CELL = 64;
/** How much wider (m) a river's banks reach where its water is cut below its course (a gorge under a waterfall, _stairs):
 *  the gorge's sides slope back with its depth instead of standing as sheer walls (from afar they stood up like fins),
 *  flaring out from the fall (sheer round the fall and its pool, sloping back further down). */
const GORGE_MAX = 45, gorgeW = (cut, below) => Math.min(GORGE_MAX, cut * 0.7, below * 0.45);
const LAKE_DECK = 2.8, RIVER_DECK = 2.6, SHALLOW_DECK = 2.4;   // m: a bridge deck's height over a lake, a river, shallow sea
/** Distance (m) from (x, z) to a building pad's rectangle (0 inside). */
function padDist(P, x, z) {
  const dx = x - P.x, dz = z - P.z, c = Math.cos(P.rot), sn = Math.sin(P.rot);
  const a = Math.abs(dx * c - dz * sn) - P.hw, b = Math.abs(dx * sn + dz * c) - P.hd;
  if (P.round) return Math.hypot(Math.max(0, a), Math.max(0, b));   // (rounded round its corners: a dock's dredged basin)
  return Math.max(a, b, 0);
}
/** A pad's level at (x, z): level, or (a sloped pad: a dock's launch ramp) rising P.k a metre along its own s (hw) —
 *  outside it, the level at the nearest point of its edge. */
function padY(P, x, z) {
  if (!P.k) return P.y;
  const s = (x - P.x) * Math.cos(P.rot) - (z - P.z) * Math.sin(P.rot);
  return P.y + P.k * Math.max(-P.hw, Math.min(P.hw, s));
}
const RIVER_CACHE = new Map();
const CITY_COAST_EASE = 900;   // m over which the city's straight shore eases into the island's coast
/** How far a lake's (or tarn's) shore lies out at angle a, as a share of its radius (2026-10-03: "the lakes are
 *  just very round"): it wanders in and out in bays and points; an administrator's pond stays as drawn. */
export const lakeShore = (k, a) => (k.pond ? 1 : 1 + (k.pool ? 0.4 : 1) * (0.07 * Math.sin(3 * a + k.r) + 0.05 * Math.sin(5 * a + k.x * 0.01) + 0.025 * Math.sin(8 * a + k.z * 0.013)));   // (a plunge pool's rounder: its back wall is the cliff)
export const tarnShore = lakeShore;
/** (x, z)'s squared distance from a lake's middle as a share of its shore's (1 at the shore's line, its basin's edge). */
export function lakeQ(k, x, z) {
  const dx = x - k.x, dz = z - k.z, d2 = dx * dx + dz * dz, r2 = k.r * k.r;
  if (d2 > r2 * 2.2) return d2 / r2 / 1.25;   // well away: no need to trace the shore (never under 1.76)
  const s = lakeShore(k, Math.atan2(dz, dx));
  return d2 / (r2 * s * s);
}
/**
 * A river's course made smooth (2026-10-03: "the rivers have jagged turns ... they should have rounded turns, very
 * smooth curves") and its water fitted to the ground (the product owner the same day: "the rivers sometimes are floating ... higher at
 * a point even if there's lower ground right next to it"; "the waterfalls are sometimes oddly shaped"): the traced
 * points (every ~24 m) eased twice ([1 2 3 2 1]) and a curve drawn through them (Catmull-Rom) every ~STEP m; then the
 * water's level worked out along that curve itself — never above the ground at its middle or on either bank out past
 * its drawn edge (bank(x, z, nx, nz, w): the highest the water may lie there), and only ever falling. A waterfall is
 * where the ground drops: the water falls with it, where it falls. endY: the sea's or the lake's level at its mouth.
 * Returns { pts: [{ x, z, y, w, s }], falls }.
 */
const COURSE_STEP = 10;
function smoothCourse(pts0, bank, endY = -Infinity) {
  let P = pts0.map(q => ({ x: q.x, z: q.z, w: q.w }));
  for (let it = 0; it < 2; it++) {
    const Q = P.map(q => ({ ...q }));
    for (let i = 2; i < P.length - 2; i++) {
      Q[i].x = (P[i - 2].x + 2 * P[i - 1].x + 3 * P[i].x + 2 * P[i + 1].x + P[i + 2].x) / 9;
      Q[i].z = (P[i - 2].z + 2 * P[i - 1].z + 3 * P[i].z + 2 * P[i + 1].z + P[i + 2].z) / 9;
    }
    P = Q;
  }
  const out = [], cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  for (let i = 0; i + 1 < P.length; i++) {
    const A = P[Math.max(0, i - 1)], B = P[i], C = P[i + 1], D = P[Math.min(P.length - 1, i + 2)];
    const n = Math.max(1, Math.round(Math.hypot(C.x - B.x, C.z - B.z) / COURSE_STEP));
    for (let k = 0; k < n; k++) { const t = k / n; out.push({ x: cr(A.x, B.x, C.x, D.x, t), z: cr(A.z, B.z, C.z, D.z, t), w: B.w + (C.w - B.w) * t }); }
  }
  out.push({ x: P.at(-1).x, z: P.at(-1).z, w: P.at(-1).w });
  let y = Infinity, s = 0;
  out.forEach((q, i) => {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const lim = bank(q.x, q.z, -(b.z - a.z) / l, (b.x - a.x) / l, q.w);
    y = y === Infinity ? lim : Math.min(y - 0.01, lim);
    q.y = y;
    if (i) s += Math.hypot(q.x - out[i - 1].x, q.z - out[i - 1].z); q.s = s;
  });
  const last = out.at(-1); last.y = Math.min(last.y, endY === -Infinity ? last.y : endY);
  return { pts: out, falls: fallsOf(out) };
}
/**
 * A river's waterfalls: where its water drops 6 m or more within ~30 m (FALL_SPAN points), the steepest such places, up
 * to four, apart; each at the point the water reaches the bottom of its steepest step.
 */
const FALL_SPAN = 3;
function fallsOf(pts) {
  const n = pts.length, drop = i => pts[Math.max(0, i - FALL_SPAN)].y - pts[i].y, falls = [];
  const idx = []; for (let i = 1; i < n; i++) if (drop(i) >= 6) idx.push(i);
  idx.sort((a, b) => drop(b) - drop(a));
  for (const i of idx) {
    // the step within the span that falls most
    let k = i, best = -1; for (let j = Math.max(1, i - FALL_SPAN + 1); j <= i; j++) { const d = pts[j - 1].y - pts[j].y; if (d > best) { best = d; k = j; } }
    if (falls.every(f => Math.abs(f - k) > 6)) falls.push(k);
    if (falls.length >= 4) break;
  }
  return falls.sort((a, b) => a - b);
}
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** One round of corner cutting: a smoother polyline with the same ends. */
function chaikin(L) {
  const out = [L[0]];
  for (let i = 0; i + 1 < L.length; i++) { const a = L[i], b = L[i + 1]; out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 }); }
  out.push(L.at(-1));
  return out;
}
/** A binary min-heap of (priority, value), ties broken by value so every engine pops in the same order. */
class MinHeap {
  constructor() { this.p = []; this.v = []; }
  get size() { return this.v.length; }
  less(a, b) { return this.p[a] < this.p[b] || (this.p[a] === this.p[b] && this.v[a] < this.v[b]); }
  swap(a, b) { [this.p[a], this.p[b]] = [this.p[b], this.p[a]]; [this.v[a], this.v[b]] = [this.v[b], this.v[a]]; }
  push(pr, v) { this.p.push(pr); this.v.push(v); let i = this.v.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (!this.less(i, q)) break; this.swap(i, q); i = q; } }
  pop() {
    const top = this.v[0], lp = this.p.pop(), lv = this.v.pop();
    if (this.v.length) { this.p[0] = lp; this.v[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < this.v.length && this.less(l, m)) m = l; if (r < this.v.length && this.less(r, m)) m = r; if (m === i) break; this.swap(i, m); i = m; } }
    return top;
  }
}
/** Canonical height grid spacing (m): 8 ft. A 400 ft chunk is exactly 50 cells. */
export const CELL_M = 2.4384;
export const CHUNK_M = 121.92;
export const CELLS_PER_CHUNK = 50;

// ---------------------------------------------------------------------------------------------------------------
// Exact hash noise
// ---------------------------------------------------------------------------------------------------------------
function hash2(ix, iz, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x2545f491);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;                       // [0, 1)
}
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);  // quintic, exact arithmetic
/** Value noise in [−1, 1]. */
export function noise2(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  const u = fade(fx), v = fade(fz);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
/** Fractal sum of `oct` octaves, roughly in [−1, 1]. */
export function fbm(x, z, seed, oct = 5, lac = 2.03, gain = 0.5) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let k = 0; k < oct; k++) { sum += amp * noise2(x * f, z * f, seed + k * 7919); norm += amp; amp *= gain; f *= lac; }
  return sum / norm;
}
/** Ridged fractal in [0, 1]: sharp crests for mountain ranges. */
export function ridged(x, z, seed, oct = 5) {
  let sum = 0, amp = 0.5, f = 1, norm = 0, w = 1;
  for (let k = 0; k < oct; k++) {
    let n = 1 - Math.abs(noise2(x * f, z * f, seed + k * 104729));
    n *= n; n *= w; w = n * 2; if (w > 1) w = 1;
    sum += amp * n; norm += amp; amp *= 0.5; f *= 2.07;
  }
  return sum / norm;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function seedOf(s) { let h = 2166136261; const str = String(s); for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h | 0; }

// ---------------------------------------------------------------------------------------------------------------
// The island
// ---------------------------------------------------------------------------------------------------------------
/**
 * Island parameters (world.terrain). city: the flat rectangle (m) the existing city occupies, held at `plainY`.
 * Defaults put an ~8 km island north of the city, the city on its southern coastal plain with the sea beyond it.
 */
/** Under the city the terrain is held this far below the natural plain, so the city's own ground (streets, blocks) is
 *  the surface there — for the renderer (client/js/render/terrain.worker.js) and the driving physics (terrain-physics.js). */
export const CITY_FLOOR_DROP = 0.6;
/** The height (m) the snow lies above, give or take 40 m (shared/biome.js); tarns above it are frozen. */
export const SNOW_LINE = 470;
export function defaultIsland({ seed = 'island', city = { x0: -470, z0: -300, x1: 470, z1: 300 }, plainY = 0.15 } = {}) {
  return {
    generator: TERRAIN_GENERATOR, seed: String(seed), plainY, seaLevel: -2.4,
    center: { x: 0, z: -2700 }, radius: 4100,       // ~8.2 km across
    city: { ...city }, plainMargin: 140, plainBlend: 420, cityCoast: 420,
    mountains: { x: -900, z: -4300, r: 2600, height: 720 },
  };
}

/** The world modules' gates among the pads: [{ x, z, y }] (where an access road meets a module, at its land's level). */
const gatesOf = pads => (pads || []).filter(P => P.gate).map(P => P.gate);
export class Island {
  /** p: world.terrain. roads: world.roads (alignment records) — the ground is graded to them (cuttings, embankments). */
  /** bridgesAsGround: false for drawing the terrain (open water under bridges); true for walking, driving and placing. */
  constructor(p, { roads = null, pads = null, bridgesAsGround = true } = {}) {
    if (!p || p.generator !== TERRAIN_GENERATOR) throw new Error(`unknown terrain generator ${p && p.generator}`);
    this.p = p;
    this.s = seedOf(p.seed);
    // The island chain (WP4.15, shared/island-chain.js): other islands' land joins the main island's; the main island's
    // lakes and rivers are found on its own land only, so adding an island never moves them.
    this._chain = (p.islands || []).map(prepareIsland);
    this._mainOnly = true;
    this.lakes = [];
    this.rivers = [];   // (none yet: the crags are at full strength while the lakes and rivers are found)
    this.lakes = this._placeLakes();
    const traced = this._traceRivers();
    this.rivers = traced.rivers;
    // the rivers' tarns and their waterfalls' plunge pools (after the courses are traced: they never move)
    this.lakes = [...this.lakes, ...traced.tarns, ...traced.pools];
    this._riverCells = this._indexRivers();
    this._mainOnly = false;
    // Administrators' strokes (WP4.7, shared/terrain-edits.js): shaping on the natural ground, ponds as lakes.
    this.edits = p.edits && p.edits.length ? new TerrainEdits(p.edits) : null;
    if (this.edits) this.lakes = [...this.lakes, ...this.edits.ponds()];
    this._drawn = !bridgesAsGround;   // the drawn terrain (render/terrain.worker.js), not the ground people stand on
    // (the world modules' gates — where their access roads meet them — come with their pads: the roads are held level
    // with a module's land there)
    // (cityStreets null: a world without a city, shared/city.js — no road is pinned to the city's level anywhere)
    this._roadArgs = roads && roads.length ? [roads, (x, z) => this.dryGround(x, z), { cityRect: p.cityStreets === null ? null : p.cityStreets || p.city, cityY: 0, seaLevel: p.seaLevel, depthAt: (x, z) => this.waterDepth(x, z), skipBridges: !bridgesAsGround, drawn: !bridgesAsGround }] : null;
    this._gates = gatesOf(pads);
    this.roads = this._roadArgs ? new IslandRoads(this._roadArgs[0], this._roadArgs[1], { ...this._roadArgs[2], gates: this._gates }) : null;
    this._setPads(pads);
  }
  /** The same island with the ground under bridge decks left open (vehicle physics: the decks are solid bodies of their
   *  own, shared/terrain-physics.js), sharing everything else. */
  withoutBridges() {
    const o = Object.create(Island.prototype); Object.assign(o, this);
    if (this.roads) o.roads = Object.assign(Object.create(Object.getPrototypeOf(this.roads)), this.roads, { skipBridges: true });
    return o;
  }
  /** The same island with other building pads, sharing its lakes, rivers and roads (cheap: for building edits). */
  withPads(pads) {
    const o = Object.create(Island.prototype); Object.assign(o, this); o._setPads(pads);
    const g = gatesOf(pads);   // (a module placed, moved or gone: its gate's road is profiled again)
    if (this._roadArgs && JSON.stringify(g) !== JSON.stringify(this._gates)) { o._gates = g; o.roads = new IslandRoads(this._roadArgs[0], this._roadArgs[1], { ...this._roadArgs[2], gates: g }); }
    return o;
  }
  /** Level pads of buildings beyond the city (shared/island-build.js buildingPads): the ground is graded to each. */
  _setPads(pads) {
    this.pads = pads && pads.length ? pads : null;
    this._under = !!this.pads?.some(P => P.under && P.lot !== undefined);
    this._padCells = new Map();
    for (const P of this.pads || []) {
      const R = Math.hypot(P.hw, P.hd) + (P.blend || PAD_BLEND);
      for (let i = Math.floor((P.x - R) / PAD_CELL); i <= Math.floor((P.x + R) / PAD_CELL); i++) for (let k = Math.floor((P.z - R) / PAD_CELL); k <= Math.floor((P.z + R) / PAD_CELL); k++) { const key = `${i},${k}`; (this._padCells.get(key) || this._padCells.set(key, []).get(key)).push(P); }
    }
  }
  /** Distance (m) from a point to the city rectangle (0 inside). */
  cityDist(x, z) {
    const c = this.p.city, dx = Math.max(c.x0 - x, 0, x - c.x1), dz = Math.max(c.z0 - z, 0, z - c.z1);
    return Math.sqrt(dx * dx + dz * dz);
  }
  /** Land-ness: > 0 on land, < 0 at sea (roughly metres of distance to the coast / 100 near it). */
  /** How much (x, z) is land (> 0) or sea (≤ 0): the main island's, or the island of the chain it belongs to. */
  landness(x, z) {
    let L = this._landMain(x, z);
    if (!this._mainOnly) for (const c of this._chain) { if (Math.abs(x - c.center.x) > c.reach || Math.abs(z - c.center.z) > c.reach) continue; L = Math.max(L, chainLandness(c, x, z)); }
    return L;
  }
  _landMain(x, z) {
    const p = this.p, dx = (x - p.center.x) / p.radius, dz = (z - p.center.z) / p.radius;
    const r2 = dx * dx + dz * dz;
    const wx = x * 0.00041, wz = z * 0.00041;
    const warpX = fbm(wx + 13.7, wz - 4.1, this.s + 11, 3) * 0.9, warpZ = fbm(wx - 7.3, wz + 9.9, this.s + 23, 3) * 0.9;
    const coast = fbm(wx + warpX, wz + warpZ, this.s + 37, 5) * 0.55;
    let L = (1 - r2) * 1.15 + coast;
    // The city's coast: land all around the city and a shoreline `cityCoast` m beyond its southern edge.
    const d = this.cityDist(x, z), keep = 1 - sstep(p.plainMargin + p.plainBlend * 0.6, p.plainMargin + p.plainBlend * 1.6, d);
    if (keep > 0) L = lerp(L, Math.max(L, 0.35), keep);
    // A straight shore south of the city, easing into the island's own coast over CITY_COAST_EASE m at each end (the product owner
    // 2026-10-03: it used to stop dead, leaving cliffs and square corners where the two coasts met)
    const south = z - p.city.z1;
    if (south > 0) {
      const e = CITY_COAST_EASE, w = sstep(p.city.x0 - 900 - e, p.city.x0 - 900 + e * 0.35, x) * (1 - sstep(p.city.x1 + 900 - e * 0.35, p.city.x1 + 900 + e, x));
      const cap = 0.35 - (south - p.cityCoast) / 520;
      if (w > 0 && cap < L) L = lerp(L, cap, w);
    }
    return L;
  }
  /** Natural ground height (m) before the city plain and lakes. */
  natural(x, z) {
    const p = this.p;
    let L = this._landMain(x, z), isle = null;
    if (!this._mainOnly) for (const c of this._chain) {
      if (Math.abs(x - c.center.x) > c.reach || Math.abs(z - c.center.z) > c.reach) continue;
      const Li = chainLandness(c, x, z); if (Li > L) { L = Li; isle = c; }
    }
    // The sea floor: a shallow shelf (about 8 % off a beach), then deeper water further out — continuous with the land.
    if (L <= 0) return p.seaLevel - 0.4 + (L > -0.1 ? L * 8 : -0.8 + (L + 0.1) * 42) - (L < -0.5 ? (-0.5 - L) * 60 : 0);
    if (isle) return chainNatural(isle, x, z, L, p.seaLevel);
    const shore = sstep(0, 0.22, L);
    // A coastal plain around the city: hills start a kilometre or more away from it.
    const d = this.cityDist(x, z), plain = sstep(p.plainMargin + p.plainBlend, p.plainMargin + p.plainBlend + 1500, d);
    const hills = (fbm(x * 0.0021, z * 0.0021, this.s + 101, 5) * 0.5 + 0.5) * 38 * shore * (0.12 + 0.88 * plain);
    const m = p.mountains, mdx = (x - m.x) / m.r, mdz = (z - m.z) / m.r, md = mdx * mdx + mdz * mdz;
    const range = md < 1 ? (1 - md) * (1 - md) : 0;
    const peaks = range > 0 ? ridged(x * 0.00095 + 3.1, z * 0.00095 - 1.7, this.s + 211, 5) * m.height * range : 0;
    const rise = sstep(0, 0.9, L) * 60;
    // The beach rises out of the water without a step: from the shelf's edge to 0.6 m above the sea over the first metres.
    return p.seaLevel - 0.4 + sstep(0, BEACH_L, L) + shore * 2.4 + hills + rise * 0.45 * (0.25 + 0.75 * plain) + peaks;
  }
  /** Ground height (m) at (x, z): natural terrain, the city plain, the lakes' basins, graded to the roads. */
  /** Building pads blend into the land first, roads then grade over that (their corridors are never moved by a pad),
   *  and a pad's own area stays level (pads keep clear of road corridors, shared/island-build.js). */
  height(x, z) {
    let h = this.baseHeight(x, z);
    if (this.pads) h = this.gradePads(x, z, h);
    if (this.roads) h = this.roads.grade(x, z, h);
    if (this.pads) {
      const g = this._under ? this.gridGround(x, z, h) : null;
      if (g !== null) h = g; else { const y = this.padLevel(x, z); if (y !== null) h = y; }
    }
    return h;
  }
  /** On a grid's land (shared/island-build.js gridPads): just under its lots' level everywhere off the roads, and just
   *  under the sidewalks' tops beneath them — so a lot meets the back of the sidewalk flush, with no dip between. */
  gridGround(x, z, h) {
    const P = this.underAt(x, z); if (!P) return null;
    // under the roads: their formation; for the ground people stand on, just under a sidewalk's top. Never in the drawn
    // terrain: its 2.4 m cells would slope from there up through the road beside a curb (2026-10-14: grey wedges poking
    // through the asphalt round the corners) — the block's own surface meets the sidewalk instead (render/lot-ground.js)
    const R = this.roads, j = R ? R.junctionAt(x, z) : null;
    if (j) return j === 'raised' && !this._drawn ? Math.max(h, P.lot - 0.06) : h;   // a junction's paving at the road's level
    const t = R ? R.top(x, z) : null;
    if (t !== null) return t >= P.lot - 0.005 && !this._drawn ? Math.max(h, P.lot - 0.06) : h;
    // a block, as in the city: its ground is the lots' level exactly (render/lot-ground.js draws it); the terrain's own
    // mesh is drawn well below it there, so far off the two never flicker through each other
    if (inGridBlock(P, x, z)) return this._drawn ? P.lot - GRID_SINK : P.lot;
    return P.lot - 0.03;
  }
  /** The grid pad (under) over (x, z), or null. */
  underAt(x, z) {
    const L = this._padCells.get(`${Math.floor(x / PAD_CELL)},${Math.floor(z / PAD_CELL)}`);
    if (L) for (const P of L) if (P.under && P.lot !== undefined && padDist(P, x, z) === 0) return P;
    return null;
  }
  /** Ground under and around building pads: just below the floor inside, blending back to the land over PAD_BLEND m. */
  gradePads(x, z, h) {
    const L = this._padCells.get(`${Math.floor(x / PAD_CELL)},${Math.floor(z / PAD_CELL)}`);
    if (!L) return h;
    let best = null;
    for (const P of L) {
      if (P.clear || this.undrawn(P, x, z)) continue;   // (a pad that only keeps the scatter off: the ground as it is)
      const d = padDist(P, x, z), bl = P.blend || PAD_BLEND;
      if (d > bl || (best && d >= best.d)) continue;
      const t = d / bl, w = t * t * (3 - 2 * t), y = padY(P, x, z) - 0.05;
      best = { d, y: y + (h - y) * w };
    }
    return best ? best.y : h;
  }
  /**
   * A pad not drawn here (2026-10-15, the product owner: the marina's water "looks unnatural since it's a square area and
   * you can see the waves outlined"): a dock's dredged basin, and its launch ramp under the water, shape the ground the
   * boats float over (and walking, driving) but not the drawn terrain — its sea floor, and the surf's depth map read from
   * it, stay as nature made them.
   */
  undrawn(P, x, z) { return this._drawn && (P.undrawn || (P.dryOnly && padY(P, x, z) < P.wy)); }
  /** Whether (x, z) is on a building pad or within m metres of one (nothing natural grows there). */
  nearPad(x, z, m = 0) {
    const L = this._padCells.get(`${Math.floor(x / PAD_CELL)},${Math.floor(z / PAD_CELL)}`);
    if (L) for (const P of L) if (padDist(P, x, z) <= m) return true;
    return false;
  }
  /** The ground's height on a building pad at (x, z), or null off every pad. */
  padLevel(x, z) {
    const L = this._padCells.get(`${Math.floor(x / PAD_CELL)},${Math.floor(z / PAD_CELL)}`);
    if (L) for (const P of L) if (!P.under && !P.clear && !this.undrawn(P, x, z) && padDist(P, x, z) === 0) return padY(P, x, z) - 0.05;   // (a grid's land: its roads keep their corridors)
    return null;
  }
  /** The ground a road may follow: never below a lake's or river's banks, and over water a bridge's deck — every road
   *  crossing water is a bridge (2026-10-03): its deck stands clear of a lake or river, or high over the sea. */
  dryGround(x, z) {
    const b = this.baseHeight(x, z);
    let h = b;
    for (const k of this.lakes) {
      const q = lakeQ(k, x, z);
      if (q < 1.5) h = Math.max(h, k.level + (q < 1.44 && b < k.level ? LAKE_DECK : 1.2));
    }
    const r = this.riverAt(x, z);
    if (r && r.d < r.width / 2 + RIVER_BANK) h = Math.max(h, r.level + (r.d < r.width / 2 + 2 ? RIVER_DECK : 1.6));
    if (b < this.p.seaLevel) h = Math.max(h, this.p.seaLevel + (b < this.p.seaLevel - BRIDGE_DEPTH ? BRIDGE_DECK : SHALLOW_DECK));
    return h;
  }
  /** How deep water stands over the natural ground at (x, z) (sea, lake or river; ≤ 0 on dry land). */
  waterDepth(x, z) {
    const b = this.baseHeight(x, z);
    let d = this.p.seaLevel - b;
    for (const k of this.lakes) if (lakeQ(k, x, z) < 1.44) d = Math.max(d, k.level - b);
    const r = this.riverAt(x, z);
    if (r && r.d < r.width / 2) d = Math.max(d, r.level - b);
    return d;
  }
  /** The ground before road grading. */
  baseHeight(x, z) {
    const p = this.p, d = this.cityDist(x, z), noCity = p.cityStreets === null;
    // the plain round the city is level; without a city (cityStreets null) it takes administrators' strokes like any land
    if (d <= p.plainMargin && !(noCity && this.edits)) return p.plainY;
    let h;
    if (d <= p.plainMargin) h = p.plainY;
    else {
      h = this.natural(x, z);
      h += this._crags(x, z, h);
      const t = sstep(p.plainMargin, p.plainMargin + p.plainBlend, d);
      if (t < 1) h = lerp(p.plainY, h, t);
    }
    if (this.edits) h = this.edits.shape(x, z, h);
    for (const k of this.lakes) {
      const dx = x - k.x, dz = z - k.z, q = k.tarn ? (dx * dx + dz * dz) / (k.r * k.r) : lakeQ(k, x, z);
      if (k.tarn) {
        // a tarn's hollow: its bed (flat under the ice when frozen), a lip just above the water all round, the
        // mountain carved back into a cirque behind it and built up into a moraine below it, the river leaving through
        // a notch (its channel, below)
        if (q < 9) {
          // its shore wanders in and out (never a drawn circle)
          const d = Math.sqrt(q) / tarnShore(k, Math.atan2(dz, dx)), rim = k.level + 0.4, bed = k.frozen ? k.level - 0.05 : k.level - 0.6 - k.depth * Math.max(0, 1 - q);
          h = d < 1.3 ? lerp(bed, rim, sstep(k.frozen ? 1.08 : 1.0, 1.3, d)) : lerp(rim, h, sstep(1.9, 3.0, d));   // (the rim holds all round: where the mountain falls away it is a moraine)
        }
        continue;
      }
      // (a waterfall's plunge pool: its rock walls rise steeply from the water, the cliff behind the fall among them —
      // over 4.5 m: sheerer, the ground's 2.4 m grid drew them as a sawtooth of thin spikes; render/rivers.js stands a
      // clean rock face in front)
      const qw = k.pool ? (1 + 4.5 / k.r) ** 2 : 1.44;
      if (q < qw) { const bowl = k.level - k.depth * (1 - q) * (1 - q > 0 ? 1 : 0) - 0.6; h = q < 1 ? Math.min(h, bowl) : lerp(Math.min(h, k.level - 0.6), h, sstep(1, qw, q)); }
    }
    // River channels: a rounded trough under the water, a shallow shelf RIVER_SHELF m wide either side of it just under
    // the water's edge, banks sloping back to the land. (The shelf: a coarse ground mesh — a point every ~5 m — never
    // spans a narrow stream from bank to bank above its water; 2026-10-03, bands of ground across the rapids.)
    const r = this.riverAt(x, z);
    if (r) {
      const hw = r.width / 2, depth = 1.1 + r.width * 0.05, edge = r.level - 0.3, s0 = hw + RIVER_SHELF;
      // past the shelf the bank comes up to just above the water within a few metres (its shore), then back to the land
      const shore = lerp(edge, Math.min(h, r.level + 0.4), sstep(s0, s0 + 4, r.d));
      const bank = r.d < hw ? edge - (depth - 0.3) * (1 - (r.d / hw) * (r.d / hw)) : r.d < s0 ? edge : lerp(shore, h, sstep(s0 + 4, hw + RIVER_BANK + r.gorge, r.d));
      h = Math.min(h, bank);
    }
    return h;
  }
  /**
   * The mountains' rock in finer detail (the design review 2026-10-03: "the mountain details aren't defined"): crags and
   * gullies a few tens of metres across on the high slopes, growing with height. Added on top of the natural ground after
   * the rivers are traced (their courses never move), and faded out along the rivers' banks.
   */
  _crags(x, z, h) {
    const m = this.p.mountains; if (!m) return 0;
    const mdx = (x - m.x) / m.r, mdz = (z - m.z) / m.r, md = mdx * mdx + mdz * mdz;
    if (md >= 1 || h < 90) return 0;
    let k = (1 - md) * sstep(90, 260, h);
    const rv = this.riverAt(x, z); if (rv) k *= sstep(rv.width / 2, rv.width / 2 + RIVER_BANK, rv.d);
    // (and round a waterfall's plunge pool: its walls rise clean from the water, no crag standing up at their foot)
    for (const P of this._pools || []) { const dx = x - P.x, dz = z - P.z, d2 = dx * dx + dz * dz, R = P.r * 2.2; if (d2 < R * R) k *= sstep(P.r * 1.15, R, Math.sqrt(d2)); }
    if (k <= 0) return 0;
    return k * (ridged(x * 0.011 + 7.7, z * 0.011 - 3.3, this.s + 307, 3) * 15 - 6.5 + noise2(x * 0.034, z * 0.034, this.s + 311) * 2.5);
  }
  /** The river nearest (x, z) within its channel and banks (wider along a gorge): { river, s, d, level, width, slope,
   *  dx, dz, gorge (m its banks reach further: a gorge) } or null. */
  riverAt(x, z) {
    if (!this.rivers.length) return null;
    const L = this._riverCells.get(`${Math.floor(x / RIVER_CELL)},${Math.floor(z / RIVER_CELL)}`);
    if (!L) return null;
    let best = null;
    for (const [ri, k] of L) {
      const R = this.rivers[ri], a = R.pts[k], b = R.pts[k + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((x - a.x) * ex + (z - a.z) * ez) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + ex * t, pz = a.z + ez * t, d = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
      const width = a.w + (b.w - a.w) * t, gorge = (a.gw || 0) + ((b.gw || 0) - (a.gw || 0)) * t;
      if (d > width / 2 + RIVER_BANK + gorge || (best && d >= best.d)) continue;
      const l = Math.sqrt(l2) || 1;
      best = { river: R.id, s: a.s + l * t, d, level: a.y + (b.y - a.y) * t, width, slope: (a.y - b.y) / l, dx: ex / l, dz: ez / l, gorge };
    }
    return best;
  }
  /**
   * Rivers: from springs high in the mountains down to the sea, a lake or another river (a tributary), along the
   * island's drainage — a priority flood over a 40 m grid from the sea and the lakes inward, so every course reaches
   * open water and none loops, crossing hollows over their lowest rims; the city's plain is avoided. The course is
   * smoothed and given a gentle meander; its water only ever falls, cutting gorges through rims. Cached per island.
   * Each: { id, pts: [{ x, z, y (water level), w (width), s }], falls: [index], drops (_stairs), mouth }.
   */
  _traceRivers() {
    const { edits, islands, ...gen } = this.p, key = JSON.stringify(gen), hit = RIVER_CACHE.get(key);   // rivers follow the main island's generated land
    void edits; void islands;
    if (hit) { this._pools = hit.pools; return hit; }
    const p = this.p, C = 40, R0 = p.radius * 1.18, x0 = p.center.x - R0, z0 = p.center.z - R0, N = Math.ceil(2 * R0 / C) + 1;
    const H = new Float32Array(N * N), down = new Int32Array(N * N).fill(-1), seen = new Uint8Array(N * N), sink = new Int16Array(N * N).fill(-1);
    const plain = p.plainMargin + p.plainBlend + 250;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = this.natural(x0 + i * C, z0 + j * C);
    // seeds: the sea (code -2) and each lake (its index)
    const heap = new MinHeap();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = x0 + i * C, z = z0 + j * C;
      const lake = this.lakes.findIndex(L => (x - L.x) ** 2 + (z - L.z) ** 2 < (L.r * 0.9) ** 2);
      if (H[k] < p.seaLevel || lake >= 0) { seen[k] = 1; sink[k] = lake >= 0 ? lake : -2; heap.push(H[k], k); }
    }
    const fill = new Float32Array(N * N); for (let k = 0; k < N * N; k++) fill[k] = H[k];
    while (heap.size) {
      const k = heap.pop(), i = k % N, j = (k - i) / N;
      for (let d = 0; d < 8; d++) {
        const ni = i + NB[d][0], nj = j + NB[d][1]; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const n = nj * N + ni; if (seen[n]) continue;
        seen[n] = 1; down[n] = k; sink[n] = sink[k];
        const x = x0 + ni * C, z = z0 + nj * C, pen = this.cityDist(x, z) < plain ? 60 : 0;
        fill[n] = Math.max(H[n] + pen, fill[k] + 0.001); heap.push(fill[n], n);
      }
    }
    // springs: high ground in the mountains, best first (by height and the seed)
    const m = p.mountains, springs = [];
    for (let j = 0; j < N; j += 3) for (let i = 0; i < N; i += 3) {
      const k = j * N + i, x = x0 + i * C, z = z0 + j * C;
      if (H[k] < 160 || (x - m.x) ** 2 + (z - m.z) ** 2 > m.r * m.r || this.landness(x, z) < 0.4) continue;
      springs.push({ k, w: H[k] * (0.6 + 0.4 * hash2(i, j, this.s + 719)) });
    }
    springs.sort((a, b) => b.w - a.w);
    const owner = new Int16Array(N * N).fill(-1), out = [];
    for (const sp of springs) {
      if (out.length >= 4) break;
      if (owner[sp.k] >= 0) continue;
      const cells = []; let k = sp.k, mouth = null;
      while (k >= 0 && cells.length < 2000) {
        if (owner[k] >= 0) { mouth = out[owner[k]].id; break; }       // joins an earlier river
        if (down[k] < 0) { mouth = sink[k] >= 0 ? this.lakes[sink[k]].id : 'sea'; break; }
        cells.push(k); k = down[k];
      }
      if (!mouth || cells.length * C < 1000) continue;
      if (cells.some(c => this.cityDist(x0 + (c % N) * C, z0 + Math.floor(c / N) * C) < p.plainMargin + 60)) continue;
      const end = k >= 0 ? k : cells[cells.length - 1];
      let line = [...cells, end].map(c => ({ x: x0 + (c % N) * C, z: z0 + Math.floor(c / N) * C }));
      for (let it = 0; it < 3; it++) line = chaikin(line);   // smooth the grid's corners into curves
      // resample every 24 m with a gentle meander; the water only falls
      const pts = []; let s = 0, y = Infinity;
      for (let a = 0; a + 1 < line.length; a++) {
        const A = line[a], B = line[a + 1], L = Math.hypot(B.x - A.x, B.z - A.z), n = Math.max(1, Math.round(L / 8));
        for (let t = 0; t < n; t++) {
          const u = t / n, bx = A.x + (B.x - A.x) * u, bz = A.z + (B.z - A.z) * u;
          if (pts.length && Math.hypot(bx - pts.at(-1).bx, bz - pts.at(-1).bz) < 24) continue;
          if (pts.length) s += Math.hypot(bx - pts.at(-1).bx, bz - pts.at(-1).bz);
          const tx = (B.x - A.x) / (L || 1), tz = (B.z - A.z) / (L || 1), mea = noise2(s * 0.006, this.s % 991, this.s + 733) * 9;
          const x = bx - tz * mea, z = bz + tx * mea;
          y = Math.min(y === Infinity ? this.natural(x, z) - 0.6 : y - 0.02, this.natural(x, z) - 0.6);
          pts.push({ x, z, y, w: 4.5 + 18 * sstep(0, 6000, s), s, bx, bz });
        }
      }
      const lake = this.lakes.find(L => L.id === mouth), endY = mouth === 'sea' ? p.seaLevel : lake ? lake.level : -Infinity;
      for (const c of cells) owner[c] = out.length;
      // the water's level: under the ground at its middle and on both banks, out past where its water is drawn
      // (the ground with the mountains' crags where they dip: rivers aren't traced yet, so _crags is at full strength)
      const ground = (x, z) => { const n = this.natural(x, z); return n + Math.min(0, this._crags(x, z, n)); };
      const bankAt = (x, z, nx, nz, w) => {
        let m = ground(x, z);
        for (const o of [w / 2 + 2, w / 2 + 5, w / 2 + 9, w / 2 + 13]) for (const sd of [1, -1]) m = Math.min(m, ground(x + nx * o * sd, z + nz * o * sd));   // (out past its shore: never a ledge on a hillside)
        return m - 0.6;
      };
      const smooth = smoothCourse(pts, bankAt, endY);
      out.push({ id: `river${out.length + 1}`, pts: smooth.pts, falls: smooth.falls, mouth });
    }
    // Where a stream joins a river, the two meet at one level: a river higher than the stream where they meet falls to
    // the stream's level there (else it would stand above the stream's channel beside it); a stream higher than the river
    // falls into it.
    for (const T of out) {
      const M = out.find(R => R.id === T.mouth); if (!M) continue;
      const tail = T.pts.slice(-30), end = T.pts.at(-1);
      let j = -1;
      for (let k = 0; k < M.pts.length && j < 0; k++) { const q = M.pts[k]; for (const t of tail) if (Math.hypot(q.x - t.x, q.z - t.z) < q.w / 2 + t.w / 2 + RIVER_BANK + 6) { j = k; break; } }
      if (j < 0) continue;
      if (M.pts[j].y > end.y) { for (let k = j; k < M.pts.length; k++) M.pts[k].y = Math.min(M.pts[k].y, end.y); M.falls = fallsOf(M.pts); }
      else { let kn = j, dn = Infinity; for (let k = j; k < Math.min(M.pts.length, j + 40); k++) { const d = Math.hypot(M.pts[k].x - end.x, M.pts[k].z - end.z); if (d < dn) { dn = d; kn = k; } } end.y = Math.min(end.y, M.pts[kn].y); T.falls = fallsOf(T.pts); }
    }
    const tarns = this._tarns(out), pools = this._stairs(out);
    const res = { rivers: out, tarns, pools };
    this._pools = pools;
    RIVER_CACHE.set(key, res);
    return res;
  }
  /**
   * Waterfalls (2026-10-03, with a diagram of a waterfall over hard cap rock into a plunge pool, a gorge below it,
   * and a photo: "waterfalls fall, not run down along the mountain ... where they fall it's a lake, and from that lake
   * the river gives out, which then if there's a large drop is another waterfall that falls into a lake, and leads
   * another river, and so on"; then: "the drops could be much bigger ... not so many repeated ... each drop a distinct
   * layout ... small drops more rocky"). Where a river's course runs steep its water is laid out as a staircase: a calm
   * reach (130–300 m) ending at a lip, the water dropping into a pool at the foot, the river leaving the pool on the next
   * calm reach, cut into the slope as a gorge that shallows to the next lip. A big drop (30–160 m) is a fall: the water
   * leaves a ledge of hard cap rock standing out over the undercut cliff (the pool's back reaches in under it) and falls
   * free, each in a style of its own (a plunge thrown well out, twin falls parted by a buttress of rock, a wide veil over
   * a broad lip, a fall in two tiers off a shelf of rock, a horsetail close down the rock), with its own lip width, throw,
   * overhang, pool and rock; the river widens to the lip. A smaller one (9–30 m) is a cascade: the water tumbling down a
   * few rock steps into a small basin. Only in the hills and mountains (lips above LIP_Y). On gentler ground the water
   * follows its course as before (rapids where it is steepish). The water only ever lies at or under the level it was
   * fitted to, so it stays under the ground on both banks. Each river gets drops: [{ kind ('fall' | 'cascade'), i (its
   * lip's point), j (the foot's), x, y, z (the lip), dx, dz (downstream), F (m), w (at the lip), pool (its id), and for a
   * fall its style: style, v (m/s it leaves the lip), ov (m the cap rock stands out), thick (m), span (rad, the pool's
   * rock wall each side), tier (share of the height of a two-tier fall's shelf), tierOut (m), split (where across twin
   * falls part), gap (m, the buttress), tint (0..1) }]; falls are their feet. Returns the pools.
   */
  _stairs(rivers) {
    const G = 0.012, FMIN = 9, FMAX = 160, CASCADE = 30, LIP_Y = 50, pools = [];
    for (const R of rivers) {
      const P = R.pts, n = P.length, out = [], drops = [];
      // a point along the course at distance s (interpolated), with the course's direction there; the level it was fitted to
      const seg = s => { let k = 1; while (k < n - 1 && P[k].s < s) k++; return k; };
      const along = s => {
        const k = seg(s), a = P[k - 1], b = P[k], l = Math.max(1e-6, b.s - a.s), t = clamp((s - a.s) / l, 0, 1), dx = b.x - a.x, dz = b.z - a.z, d = Math.sqrt(dx * dx + dz * dz) || 1;
        return { x: a.x + dx * t, z: a.z + dz * t, dx: dx / d, dz: dz / d, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t };
      };
      let mode = 'follow', level = P[0].y, flatTo = -1, nextLip = -Infinity, prevS = P[0].s, lipS = -Infinity, skipTo = -Infinity;
      for (let i = 0; i < n; i++) {
        const q = P[i];
        if (q.s <= skipTo) continue;   // (a cascade's own points stand for these)
        let y = q.y;
        if (mode === 'reach') {
          const cand = q.s <= flatTo ? level : level - G * (q.s - prevS);
          if (cand < q.y) y = cand; else mode = 'follow';   // (the reach meets the course's own level again)
        }
        level = y; prevS = q.s;
        const o = { ...q, y, gw: gorgeW(q.y - y, q.s - lipS) }; out.push(o);
        if (mode !== 'follow' || q.s < nextLip || i >= n - 4 || q.y < LIP_Y) continue;
        const hh = k => hash2(i * 13 + k, n + k * 7, this.s + 907 + k * 131);   // (this drop's own dice)
        // a lip here, if the course falls far enough ahead: the reach below it as long as LR, and the pool with room
        // in it before the reach meets the course again
        const LR = 130 + 170 * hh(0);
        let j = i + 1; while (j < n - 1 && P[j].s < q.s + LR) j++;
        if (P[j].s < q.s + LR * 0.9) continue;
        const F = Math.min(FMAX, q.y - P[j].y - G * (P[j].s - q.s));
        if (F < FMIN) continue;
        const foot = q.y - F, kind = F < CASCADE ? 'cascade' : 'fall', Lc = kind === 'cascade' ? clamp(F * 1.3, 10, 40) : 0.8;
        let r = kind === 'cascade' ? clamp(4 + F * 0.22 + q.w * 0.4, 6, 11) : clamp((7 + F * 0.2 + q.w * 1.1) * (0.85 + 0.3 * hh(6)), 9, 42), meet = -1;
        for (let k = i + 1; k < n; k++) if (P[k].y <= foot - G * Math.max(0, P[k].s - q.s - Lc - 2 * r)) { meet = k; break; }
        if (meet < 0) continue;   // (it would never come back to its course: no drop)
        r = Math.min(r, (P[meet].s - q.s - Lc - 25) / 2.1);   // (and a river at least 25 m long out of it before the next lip)
        if (r < (kind === 'cascade' ? 5 : 8)) continue;
        const id = `pool${pools.length + 1}`, d0 = along(q.s + 0.4);
        if (kind === 'fall') {
          // its style, and how the river comes to its lip: widening over the last 30 m to the lip's width
          const h1 = hh(1), h2 = hh(2), h3 = hh(3);
          const style = F >= 70 && h1 < 0.22 ? 'tiered' : h1 < 0.44 ? 'plunge' : h1 < 0.64 ? 'twin' : h1 < 0.84 ? 'veil' : 'horsetail';
          const K = { plunge: [1.3, 0.3, 2.4, 1.0], twin: [2.1, 0.5, 1.8, 0.8], veil: [2.4, 0.6, 1.1, 0.5], tiered: [1.6, 0.4, 1.6, 0.6], horsetail: [1.2, 0.3, 0.7, 0.4] }[style];
          const lipK = K[0] + K[1] * h2, v = K[2] + K[3] * h3, wLip = q.w * lipK;
          for (let k = out.length - 1; k >= 0 && out[k].s > q.s - 30; k--) out[k].w *= 1 + (lipK - 1) * sstep(q.s - 30, q.s, out[k].s);
          // the drop: the water leaves the lip and is at the pool's level a step later; the pool's back reaching 3 m in
          // under the cap rock (render/rivers.js draws the ledge standing out over it, the water falling from its edge)
          const a = along(q.s + 0.8), c = along(q.s + r - 3);
          out.push({ x: a.x, z: a.z, y: foot, w: wLip, s: q.s + 0.8, gw: 0 });
          drops.push({ kind, i: out.length - 2, j: out.length - 1, x: q.x, y: q.y, z: q.z, dx: d0.dx, dz: d0.dz, F, w: wLip, pool: id,
            style, v, ov: 1.4 + 2.2 * hh(4), thick: 2.5 + 2.5 * hh(5), span: 2.2 + 0.6 * hh(7), tier: 0.35 + 0.25 * hh(8), tierOut: 2 + 2.5 * hh(9),
            split: 0.32 + 0.36 * hh(10), gap: 2.2 + 2 * hh(11), tint: hh(12) });
          pools.push({ id, x: c.x, z: c.z, r, level: foot, depth: 2 + F * 0.05, pool: true, river: R.id, fall: { x: q.x, z: q.z } });
          mode = 'reach'; level = foot; prevS = q.s + 0.8; flatTo = q.s + 2 * r - 3; nextLip = q.s + 2.1 * r + 25; lipS = q.s;
        } else {
          // a cascade: a few rock steps, each a short drop then a ledge of calm water, into a small basin
          const nS = clamp(Math.round(F / 4.5), 2, 5), run = Lc / nS, w = q.w * 1.1, i0 = out.length - 1;
          for (let k = 0; k < nS; k++) for (const [f, dl] of [[0.28, 0], [1, 0.02]]) {
            const s1 = q.s + (k + f) * run, A = along(s1), y1 = Math.min(A.y, q.y - (k + 1) * F / nS - dl);
            out.push({ x: A.x, z: A.z, y: y1, w, s: s1, gw: gorgeW(A.y - y1, s1 - q.s) });
          }
          const end = out.at(-1), c = along(q.s + Lc + r - 1.5);
          drops.push({ kind, i: i0, j: out.length - 1, x: q.x, y: q.y, z: q.z, dx: d0.dx, dz: d0.dz, F, w, pool: id, steps: nS, run });
          pools.push({ id, x: c.x, z: c.z, r, level: end.y, depth: 1.2 + F * 0.04, pool: true, river: R.id, cascade: true, fall: { x: q.x, z: q.z } });
          mode = 'reach'; level = end.y; prevS = end.s; flatTo = q.s + Lc + 2 * r; nextLip = q.s + Lc + 2.1 * r + 25; lipS = q.s; skipTo = q.s + Lc;
        }
      }
      R.pts = out; R.drops = drops; R.falls = drops.map(f => f.j);
    }
    return pools;
  }
  /**
   * Tarns (2026-10-03: "the rivers should start from a lake ... on top of the mountain on some of its valleys, so
   * that the rivers look natural"): each river rises from a small lake in a hollow high on its course — the first place
   * down from its spring where the mountain stands round it (little damming needed), as a cirque holds a tarn below a
   * peak; the river leaves it through a notch in its rim. Found once the courses are traced, which never move: only the
   * stretch above the tarn is dropped. Above the snowline they are frozen.
   */
  _tarns(rivers) {
    const out = [], RING16 = RING;
    for (const R of rivers) {
      const s0 = R.pts[0].s;
      let best = null;
      for (let i = 0; i < R.pts.length - 6 && R.pts[i].s - s0 < 1200; i++) {
        const q = R.pts[i], nx = R.pts[i + 2], l = Math.hypot(nx.x - q.x, nx.z - q.z) || 1, dx = (nx.x - q.x) / l, dz = (nx.z - q.z) / l;
        if (q.y < 200) break;
        const r = 30 + hash2(i, Math.floor(s0), this.s + 811) * 16, cx = q.x - dx * r * 1.15, cz = q.z - dz * r * 1.15;
        if (out.some(t => Math.hypot(t.x - cx, t.z - cz) < (t.r + r) * 2.6)) continue;
        // how much of a dam its rim would need (the outlet's side aside), and how deep a cirque behind it
        let dam = 0;
        for (const [ax, az] of RING16) {
          if (ax * dx + az * dz > 0.8) continue;   // the notch
          dam = Math.max(dam, q.y + 0.4 - this.natural(cx + ax * r * 1.3, cz + az * r * 1.3));
        }
        if (!best || dam < best.dam - 0.5) best = { i, r, cx, cz, dam, level: q.y };
        if (dam <= 3) break;
      }
      if (!best) continue;
      if (best.i) { R.pts = R.pts.slice(best.i); R.falls = fallsOf(R.pts); }
      const o = R.pts[0];
      out.push({ id: `tarn${out.length + 1}`, x: best.cx, z: best.cz, r: best.r, level: best.level, depth: 2 + best.r * 0.05, tarn: true, frozen: best.level > SNOW_LINE - 15, outlet: { x: o.x, z: o.z } });
    }
    return out;
  }
  _indexRivers() {
    const cells = new Map(), pad = 22 / 2 + RIVER_BANK + GORGE_MAX;
    this.rivers.forEach((R, ri) => {
      for (let k = 0; k + 1 < R.pts.length; k++) {
        const a = R.pts[k], b = R.pts[k + 1];
        for (let i = Math.floor((Math.min(a.x, b.x) - pad) / RIVER_CELL); i <= Math.floor((Math.max(a.x, b.x) + pad) / RIVER_CELL); i++)
          for (let j = Math.floor((Math.min(a.z, b.z) - pad) / RIVER_CELL); j <= Math.floor((Math.max(a.z, b.z) + pad) / RIVER_CELL); j++) {
            const key = `${i},${j}`; (cells.get(key) || cells.set(key, []).get(key)).push([ri, k]);
          }
      }
    });
    return cells;
  }
  /** Deterministic lake sites: moderate ground, away from the city, the coast and each other. */
  _placeLakes() {
    const p = this.p, out = [], cands = [];
    for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) {
      const x = p.center.x + i * 380 + (hash2(i, j, this.s + 503) - 0.5) * 300, z = p.center.z + j * 380 + (hash2(i, j, this.s + 509) - 0.5) * 300;
      const L = this.landness(x, z); if (L < 0.35) continue;
      if (this.cityDist(x, z) < p.plainMargin + p.plainBlend + 300) continue;
      const h = this.natural(x, z); if (h < 6 || h > 140) continue;
      cands.push({ x, z, h, w: hash2(i, j, this.s + 521) });
    }
    cands.sort((a, b) => b.w - a.w);
    for (const c of cands) {
      if (out.length >= 6) break;
      if (out.some(k => (k.x - c.x) ** 2 + (k.z - c.z) ** 2 < 900 * 900)) continue;
      const r = 90 + hash2(Math.floor(c.x), Math.floor(c.z), this.s + 601) * 170;
      // its level: under the lowest ground all round its wandering shore and out under the rim of its drawn water
      // (2026-10-03: water never standing above the land beside it)
      const k0 = { x: c.x, z: c.z, r }; let rim = Infinity;
      for (let k = 0; k < 48; k++) {
        const a = k / 48 * Math.PI * 2, sh = lakeShore(k0, a);
        for (const f of [1.05, 1.18, 1.3, 1.4]) { const x = c.x + Math.cos(a) * r * f * sh, z = c.z + Math.sin(a) * r * f * sh, n = this.natural(x, z); rim = Math.min(rim, n + Math.min(0, this._crags(x, z, n))); }
      }
      out.push({ id: `lake${out.length + 1}`, x: c.x, z: c.z, r, level: rim - 0.6, depth: 3 + r * 0.04 });
    }
    return out;
  }
  /** The ground at (x, z) as if no bridge stood there (what lies under a deck). */
  belowDeck(x, z) {
    let h = this.baseHeight(x, z);
    if (this.pads) h = this.gradePads(x, z, h);
    if (this.roads) h = this.roads.grade(x, z, h, true);
    return h;
  }
  /** Water at (x, z): { kind: 'sea' | 'lake', level } or null on dry land (h: the ground there, if already known). */
  waterAt(x, z, h = this.height(x, z)) {
    if (h < this.p.seaLevel) return { kind: 'sea', level: this.p.seaLevel };
    for (const k of this.lakes) if (!k.frozen && lakeQ(k, x, z) < 1.44 && h < k.level) return { kind: 'lake', level: k.level, id: k.id };   // a frozen tarn is walked on
    const r = this.riverAt(x, z);
    if (r && r.d < r.width / 2 && h < r.level) return { kind: 'river', level: r.level, id: r.river, flow: { x: r.dx, z: r.dz }, slope: r.slope };
    return null;
  }
}
// 16 directions around a circle (exact constants instead of sin/cos at run time).
const RING = [[1, 0], [0.92388, 0.38268], [0.70711, 0.70711], [0.38268, 0.92388], [0, 1], [-0.38268, 0.92388], [-0.70711, 0.70711], [-0.92388, 0.38268],
  [-1, 0], [-0.92388, -0.38268], [-0.70711, -0.70711], [-0.38268, -0.92388], [0, -1], [0.38268, -0.92388], [0.70711, -0.70711], [0.92388, -0.38268]];

/**
 * The canonical heights of one chunk at a given step (cells per sample; 1 = full 8 ft detail): a (n+1)² Float32Array,
 * row by row along z, for chunk (cx, cz) whose corner is (cx·CHUNK_M, cz·CHUNK_M).
 */
export function chunkHeights(island, cx, cz, step = 1, out = null) {
  const n = CELLS_PER_CHUNK / step;
  if (!Number.isInteger(n)) throw new Error('step must divide 50');
  const a = out || new Float32Array((n + 1) * (n + 1)), x0 = cx * CHUNK_M, z0 = cz * CHUNK_M, d = CELL_M * step;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) a[j * (n + 1) + i] = island.height(x0 + i * d, z0 + j * d);
  return a;
}

/**
 * The one height query (server, client, physics): bilinear on the canonical 8 ft grid, with a small per-chunk cache.
 */
export class GroundQuery {
  constructor(island, { maxChunks = 256 } = {}) { this.island = island; this.cache = new Map(); this.max = maxChunks; }
  _chunk(cx, cz) {
    const k = cx * 100003 + cz; let c = this.cache.get(k);
    if (c) { this.cache.delete(k); this.cache.set(k, c); return c; }
    c = chunkHeights(this.island, cx, cz, 1);
    this.cache.set(k, c);
    if (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value);
    return c;
  }
  height(x, z) {
    // on a road (and a bridge's deck) its drawn surface, exactly: the 2.4 m grid would round curbs off and pull a deck's
    // edges down toward the water beside it
    const top = this.island.roads?.top(x, z);
    if (top !== null && top !== undefined) return top;
    // beside a bridge the grid's cells hold its deck too: the water there would seem to rise to it (swimmers were lifted
    // onto decks, 2026-10-05) — the exact height instead
    const dk = this.island.roads?.deckAt(x, z, CELL_M * 1.5);
    if (dk !== null && dk !== undefined) return this.island.height(x, z);
    const gx = x / CELL_M, gz = z / CELL_M, ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const cx = Math.floor(ix / CELLS_PER_CHUNK), cz = Math.floor(iz / CELLS_PER_CHUNK), li = ix - cx * CELLS_PER_CHUNK, lj = iz - cz * CELLS_PER_CHUNK;
    const a = this._chunk(cx, cz), n1 = CELLS_PER_CHUNK + 1, o = lj * n1 + li;
    const h00 = a[o], h10 = a[o + 1], h01 = a[o + n1], h11 = a[o + n1 + 1];
    return h00 + (h10 - h00) * fx + (h01 - h00) * fz + (h00 - h10 - h01 + h11) * fx * fz;
  }
  water(x, z) { return this.island.waterAt(x, z); }
  /** For a body whose feet are at y more than 1.5 m under a bridge's deck: { h, water, deck } — the ground and the water
   *  beneath the bridge (2026-10-05: swimming under a bridge lifted the swimmer onto its deck) — else null. */
  under(x, z, y) {
    const deck = this.island.roads?.deckAt(x, z);
    if (deck === null || deck === undefined || !(y < deck - 1.5)) return null;
    const h = this.island.belowDeck(x, z);
    return { h, water: this.island.waterAt(x, z, h), deck };
  }
}
