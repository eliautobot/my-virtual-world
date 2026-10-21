// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The countryside's standing detail for one full-detail terrain tile (runs in the terrain worker; the design review
// 2026-10-03: "fields of flowers, farm land with hay-rolls, detailed farm land with wheat fields or corn"): the crops of
// every farmed field (shared/farms.js) as solid shapes over the rows the ground shader draws — corn and sunflowers in
// tall leafy rows, wheat and barley as a standing crop with its tram lines open, cabbages, lavender in mounds, tulips in
// coloured bands, hay raked into windrows, round bales (some wrapped) and stacks of square ones on the stubble — and the
// fields' boundaries: hedgerows with trees in them and gates, post-and-rail fences and dry-stone walls. One mesh per
// tile (one draw call), built from cross-sections swept along rows and boundaries, following the ground vertex by vertex.
// Nothing grows on roads and their verges, building yards, water or in the city. The renderer raises it out of the
// ground as the camera comes near and lays it down again further off (render/countryside.js).
import { toFarm, fromFarm, bandOf, fieldRect, uEdge, vEdge, EDGE_HALF, EDGE_GRASS, CROP, hashf, cropOf, isFarmstead } from '/shared/farms.js';
import { farmed } from '/shared/biome.js';
import { lakeQ } from '/shared/terrain.js';

/** Kinds of surface (the material's detail per kind, render/countryside.js). */
export const CK = { corn: 1, wheat: 2, veg: 3, leaf: 4, head: 5, lavender: 6, tulip: 7, hay: 8, bale: 9, hedge: 10, wall: 11, wood: 12, wrap: 13, planks: 14, roof: 15, plaster: 16, metal: 17, window: 18, gravel: 19, baleEnd: 20, wrapEnd: 21, square: 22, squareEnd: 23 };
/** Texture coordinates (metres on the surface, render/countryside.js aT) are stored in 1/TS m steps. */
export const TS = 128;
const LIN = new Uint8Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = Math.round((c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * 255); }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lin = c => [LIN[clamp(Math.round(c[0] * 255), 0, 255)], LIN[clamp(Math.round(c[1] * 255), 0, 255)], LIN[clamp(Math.round(c[2] * 255), 0, 255)]];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
// smooth 1D noise along a path (lumps in hedges, waves in a row's height)
const n1 = (s, seed) => { const i = Math.floor(s), f = s - i, u = f * f * (3 - 2 * f); return hashf(i, seed, 911) * (1 - u) + hashf(i + 1, seed, 911) * u; };

class Mesh {
  constructor(x0, z0, hAt, still = false) { this.x0 = x0; this.z0 = z0; this.hAt = hAt; this.still = still; this.p = []; this.n = []; this.c = []; this.k = []; this.t = []; this.i = []; }
  get count() { return this.p.length / 3; }
  /**
   * A vertex at world (x, z), `y` above the ground there (or above `g`), normal, sRGB colour, kind, sway; t: its place
   * on the surface in metres ([along, across]: the material's textures follow it, not the world's axes).
   */
  v(x, z, y, nx, ny, nz, col, kind, sway, g = this.hAt(x, z), t = null) {
    const l = Math.hypot(nx, ny, nz) || 1, c = lin(col);
    this.p.push(x - this.x0, g + y, z - this.z0);
    this.n.push(Math.round(nx / l * 127), Math.round(ny / l * 127), Math.round(nz / l * 127));
    this.c.push(c[0], c[1], c[2]);
    // still meshes (farmsteads) always stand; the rest know their height above the ground to grow in (render/countryside.js)
    this.k.push(kind, this.still ? 0 : Math.round(clamp(sway, 0, 1) * 255), this.still ? 0 : Math.round(clamp(y / 6, 0, 1) * 255));
    this.t.push(t ? clamp(Math.round(t[0] * TS), -32768, 32767) : 0, t ? clamp(Math.round(t[1] * TS), -32768, 32767) : 0);
    return this.count - 1;
  }
  /** A triangle facing the way its vertices' normals point. */
  tri(a, b, c) {
    const P = this.p, N = this.n;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (Math.abs(fx) + Math.abs(fy) + Math.abs(fz) < 1e-10) return;
    const d = fx * (N[a * 3] + N[b * 3] + N[c * 3]) + fy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + fz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (d < 0) this.i.push(a, c, b); else this.i.push(a, b, c);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  /**
   * A cross-section swept along a path of world points [{x, z}]: prof(i, t) gives the section at sample i as
   * [[across, height, normalAcross, normalUp, colour, sway], ...] from one side over the top to the other; each vertex
   * stands on the ground beneath it. Optional end caps. Texture coordinates: the distance along the path (its points'
   * t) and round the section.
   */
  sweep(path, prof, kind, caps = [true, true]) {
    const n = path.length; if (n < 2) return;
    let prev = null, first = null, last = null;
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      const ax = -dz / l, az = dx / l, row = [], along = path[i].t ?? 0;
      let arc = 0, po = null;
      for (const [o, y, no, ny, col, sw] of prof(i)) {
        if (po) arc += Math.hypot(o - po[0], y - po[1]); po = [o, y];
        row.push(this.v(path[i].x + ax * o, path[i].z + az * o, y, ax * no, ny, az * no, col, kind, sw, undefined, [along, arc]));
      }
      if (prev) for (let k = 0; k + 1 < row.length; k++) this.quad(prev[k], row[k], row[k + 1], prev[k + 1]);
      if (i === 0) first = { row, tx: -dx / l, tz: -dz / l }; last = { row, tx: dx / l, tz: dz / l };
      prev = row;
    }
    for (const [end, on] of [[first, caps[0]], [last, caps[1]]]) {
      if (!on) continue;
      // a cap: the section's outline again, facing out of the end, fanned from its middle
      const R = end.row, P = this.p, C = this.c, K = this.k, mid = R[Math.floor(R.length / 2)];
      const cx = (P[R[0] * 3] + P[R.at(-1) * 3]) / 2, cz = (P[R[0] * 3 + 2] + P[R.at(-1) * 3 + 2]) / 2, cy = (P[R[0] * 3 + 1] + P[R.at(-1) * 3 + 1]) / 2;
      const T = this.t, q = R.map(r => { this.p.push(P[r * 3], P[r * 3 + 1], P[r * 3 + 2]); this.n.push(Math.round(end.tx * 127), 0, Math.round(end.tz * 127)); this.c.push(C[r * 3] * 0.8, C[r * 3 + 1] * 0.8, C[r * 3 + 2] * 0.8); this.k.push(K[r * 3], K[r * 3 + 1], K[r * 3 + 2]); T.push(T[r * 2], T[r * 2 + 1]); return this.count - 1; });
      this.p.push(cx, cy, cz); this.n.push(Math.round(end.tx * 127), 0, Math.round(end.tz * 127)); this.c.push(C[mid * 3] * 0.6, C[mid * 3 + 1] * 0.6, C[mid * 3 + 2] * 0.6); this.k.push(K[mid * 3], 0, 0); T.push(T[mid * 2], 0);
      const o = this.count - 1;
      for (let k = 0; k + 1 < q.length; k++) this.tri(o, q[k], q[k + 1]);
    }
  }
  build() {
    if (!this.i.length) return null;
    const nv = this.count;
    return { pos: new Float32Array(this.p), nrm: new Int8Array(this.n), col: new Uint8Array(this.c), k: new Uint8Array(this.k), t: new Int16Array(this.t), idx: nv > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i) };
  }
}

// colours (sRGB)
const COL = {
  cornBase: [0.24, 0.3, 0.12], corn: [0.3, 0.48, 0.16], cornTop: [0.42, 0.55, 0.2], tassel: [0.78, 0.7, 0.42],
  wheat: [0.88, 0.73, 0.35], wheatSide: [0.7, 0.58, 0.28], barley: [0.8, 0.77, 0.47],
  cabbage: [0.36, 0.55, 0.36], cabbageIn: [0.62, 0.75, 0.45], sunLeaf: [0.24, 0.4, 0.14], petal: [1.0, 0.78, 0.1], disc: [0.35, 0.22, 0.08],
  lavBase: [0.45, 0.5, 0.38], lav: [0.56, 0.42, 0.8], tulipLeaf: [0.32, 0.5, 0.24], hay: [0.66, 0.68, 0.34],
  straw: [0.86, 0.76, 0.46], strawEnd: [0.74, 0.6, 0.32], wrapW: [0.93, 0.93, 0.9], wrapG: [0.25, 0.38, 0.22], wrapB: [0.12, 0.12, 0.12],
  hedge: [0.2, 0.36, 0.13], hedgeHi: [0.32, 0.47, 0.18], blossom: [0.95, 0.93, 0.88], stone: [0.62, 0.6, 0.55], stoneD: [0.45, 0.43, 0.4], wood: [0.5, 0.4, 0.3],
};
const TULIPS = [[0.9, 0.12, 0.12], [0.98, 0.84, 0.15], [0.95, 0.45, 0.65], [0.97, 0.95, 0.92], [0.98, 0.5, 0.1]];

/**
 * Where nothing natural may stand (3 m cells, worked out as asked): the city, roads and their verges, building yards,
 * rivers and their gravel banks, lake shores, the sea. Shared by the countryside and the scatter of a tile.
 */
export function blockedGrid(island, hAt) {
  const P = island.p, CELL = 3, blk = new Map(), roads = island.roads;
  return (x, z) => {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL), key = i * 65536 + j;
    let b = blk.get(key);
    if (b === undefined) {
      const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL;
      b = island.cityDist(cx, cz) < P.plainMargin;
      if (!b && roads) { const nr = roads.net.nearest(cx, cz, 18); b = !!nr && nr.dist < roads.half.get(nr.id) + 3.5 + CELL * 0.7; }
      if (!b && island.pads) b = island.nearPad(cx, cz, 3.5 + CELL * 0.7);
      if (!b) { const rv = island.riverAt(cx, cz); b = !!rv && rv.d < rv.width / 2 + 4; }
      if (!b) for (const k of island.lakes) if (lakeQ(k, cx, cz) < 1.6) { b = true; break; }
      if (!b) b = hAt(cx, cz) < P.seaLevel + 1;
      blk.set(key, b);
    }
    return b;
  };
}

/**
 * Builds the countryside of the tile [x0, x0 + S] × [z0, z0 + S]. island: the worker's Island; hAt(x, z): the tile's
 * ground height (world coordinates). Returns { mesh, trees: [x, y, z, ...] (hedgerow trees, world) } or null.
 */
export function buildCountryside(island, x0, z0, S, hAt, blocked0 = null) {
  // a quick reject: no farm cluster anywhere near this tile
  const dCity = island.cityDist(x0 + S / 2, z0 + S / 2);
  if (dCity < 520 - S || dCity > 2000 + S) return null;
  // tall things (crops, hedges, walls, fences, bales) stand within the full reach; small ones (cabbages, sunflower heads,
  // tulips) within half of it (render/countryside.js)
  const Mt = new Mesh(x0, z0, hAt), Ms = new Mesh(x0, z0, hAt), trees = [];
  let M = Mt;
  const blocked = blocked0 || blockedGrid(island, hAt);
  const inTile = (x, z) => x >= x0 && x < x0 + S && z >= z0 && z < z0 + S;
  /**
   * How far (m, up to 3) a point is from ground the crops keep off (blockedGrid's rules, measured exactly): a standing
   * crop thins out to the ground along it instead of ending in the grid's 3 m steps (2026-10-03: "lego").
   */
  const IP = island.p, roadsI = island.roads;
  const clear = (x, z) => {
    // no blocked 3 m cell within two cells: at least 2.5 m clear (everything kept off is wider than a cell's diagonal)
    let near = false;
    for (let di = -2; di <= 2 && !near; di++) for (let dj = -2; dj <= 2; dj++) if (blocked(x + di * 3, z + dj * 3)) { near = true; break; }
    if (!near) return 3;
    let c = Math.min(3, island.cityDist(x, z) - IP.plainMargin);
    if (roadsI) { const nr = roadsI.net.nearest(x, z, 18); if (nr) c = Math.min(c, nr.dist - roadsI.half.get(nr.id) - 3.5); }
    if (island.pads && island.nearPad(x, z, 5.5)) c = Math.min(c, island.nearPad(x, z, 3.5) ? -1 : 1);
    const rv = island.riverAt(x, z); if (rv) c = Math.min(c, rv.d - rv.width / 2 - 4);
    for (const k of island.lakes) c = Math.min(c, (Math.sqrt(lakeQ(k, x, z)) - 1.265) * k.r);
    return Math.min(c, (hAt(x, z) - IP.seaLevel - 1) * 4);
  };
  // a tall crop dwindling to the ground over its last couple of metres where it stops short of a bank, road or yard (the product owner
  // 2026-10-03: no blocks of crop ending in steps)
  const taper = p => 0.08 + 0.92 * sstep(0, 2.5, clear(p.x, p.z));
  /**
   * A line in farm space (u, v) → (u1, v1), sampled every `step` m and cut into runs of open ground in this tile; each
   * run swept with prof. Pieces outside the tile belong to its neighbour (no seams: they share sample points).
   */
  const line = (u0, v0, u1, v1, step, prof, kind, ok = null, target = Mt) => {
    const L = Math.hypot(u1 - u0, v1 - v0), n = Math.max(1, Math.round(L / step));
    const pts = [];
    for (let s = 0; s <= n; s++) { const t = s / n, [x, z] = fromFarm(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t); pts.push({ x, z, t: L * t }); }
    let run = [], runStart = 0, openStart = false;
    const flush = (openEnd) => { if (run.length >= 2) target.sweep(run, i => prof(i + runStart, run[i]), kind, [!openStart, !openEnd]); run = []; };
    for (let s = 0; s < n; s++) {
      const a = pts[s], b = pts[s + 1], mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      // (the exact distance from what crops keep off, not the 3 m grid: rows end along a smooth line, never in steps)
      const mine = inTile(mx, mz), good = mine && clear(mx, mz) > 0 && (!ok || ok((s + 0.5) / n));
      if (good) { if (!run.length) { run.push(a); runStart = s; openStart = s > 0 && !inTile((pts[s - 1].x + a.x) / 2, (pts[s - 1].z + a.z) / 2); } run.push(b); }
      else if (run.length) flush(!mine);
    }
    flush(true);
  };

  // the farm-space rectangle covering this tile (the offset is gentle: corners plus a margin)
  let fu0 = Infinity, fv0 = Infinity, fu1 = -Infinity, fv1 = -Infinity;
  for (const [x, z] of [[x0, z0], [x0 + S, z0], [x0, z0 + S], [x0 + S, z0 + S]]) { const [u, v] = toFarm(x, z); fu0 = Math.min(fu0, u); fv0 = Math.min(fv0, v); fu1 = Math.max(fu1, u); fv1 = Math.max(fv1, v); }
  fu0 -= 12; fv0 -= 12; fu1 += 12; fv1 += 12;
  const row0 = bandOf(fv0).row, row1 = bandOf(fv1).row;
  for (let row = row0; row <= row1; row++) {
    const w = 40 + hashf(row, 1, 4244) * 70, off = hashf(row, 0, 4243) * 90;
    const fx0 = Math.floor((fu0 + 5000 + off) / w), fx1 = Math.floor((fu1 + 5000 + off) / w);
    for (let fx = fx0; fx <= fx1; fx++) {
      const R = fieldRect(row, fx), here = farmed(island, row, fx);
      // ---- the field's left boundary (shared with fx − 1: drawn once, here) and its bottom boundary (shared with the band
      // below: drawn by this band's fields over their own width)
      const eL = uEdge(fx, row);
      if (eL !== 3 && (here || farmed(island, row, fx - 1))) boundary(R.u0, R.v0, R.u0, R.v1, eL, `${row}:${fx}:L`);
      const below = bandOf(R.v0 - 1), bw = 40 + hashf(below.row, 1, 4244) * 70, boff = hashf(below.row, 0, 4243) * 90;
      for (let s = Math.floor((R.u0 + 5000) / 90); s * 90 - 5000 < R.u1; s++) {
        const a = Math.max(R.u0, s * 90 - 5000), b = Math.min(R.u1, (s + 1) * 90 - 5000), e = vEdge(row, (a + b) / 2);
        if (e === 3 || b - a < 0.5) continue;
        const farmedAt = t => { const u = a + (b - a) * t; return here || farmed(island, below.row, Math.floor((u + 5000 + boff) / bw)); };
        boundary(a, R.v0, b, R.v0, e, `${row}:${s}:B`, farmedAt);
      }
      if (here) field(row, fx, R);
    }
  }

  // ---------------------------------------------------------------- boundaries
  function boundary(u0, v0, u1, v1, kind, key, ok = null) {
    const seed = Math.floor(hashf(u0 | 0, v0 | 0, 977) * 1e6), L = Math.hypot(u1 - u0, v1 - v0);
    // a gate in some hedges and fences: a 4 m gap somewhere along it
    const gate = (kind === 0 || kind === 1) && L > 30 && hashf(seed, 1, 978) < 0.55 ? 8 + hashf(seed, 2, 979) * (L - 16) : -1;
    const okG = t => (gate < 0 || Math.abs(t * L - gate) > 2.2) && (!ok || ok(t));
    if (kind === 0) {
      // hedgerow: lumpy and rounded, some stretches in flower; a tree in it every few dozen metres
      const blossom = hashf(seed, 3, 980) < 0.3;
      line(u0, v0, u1, v1, 1.25, (i, p) => {
        const s = p.t, lump = n1(s / 3.2, seed), lump2 = n1(s / 1.3, seed + 7), H = 1.9 + 1.0 * lump + 0.3 * lump2, W = 1.15 + 0.35 * n1(s / 4.1, seed + 3);
        // each side bulges on its own (bushes of different sizes), so the outline is never smooth
        const jl = hashf(i, seed, 990) - 0.5, jr = hashf(i, seed, 991) - 0.5, jt = hashf(i, seed, 992) - 0.5;
        const g = mixc(COL.hedge, COL.hedgeHi, n1(s / 2.1, seed + 11) * 0.8), top = blossom && n1(s / 2.7, seed + 13) > 0.62 ? mixc(g, COL.blossom, 0.55) : mixc(g, COL.hedgeHi, 0.5);
        return [[-W * 0.85, 0, -1, 0.1, shade(g, 0.55), 0], [-W - jl * 0.3, H * 0.4, -1, 0.3, shade(g, 0.8), 0.15], [-W * 0.75 - jl * 0.25, H * 0.82 + jt * 0.3, -0.7, 0.75, g, 0.45], [jt * 0.3, H + jt * 0.25, 0, 1, top, 0.6], [W * 0.75 + jr * 0.25, H * 0.82 - jt * 0.3, 0.7, 0.75, g, 0.45], [W + jr * 0.3, H * 0.4, 1, 0.3, shade(g, 0.8), 0.15], [W * 0.85, 0, 1, 0.1, shade(g, 0.55), 0]];
      }, CK.hedge, okG);
      for (let t = 14 + hashf(seed, 4, 981) * 20; t < L - 6; t += 22 + hashf(seed, Math.floor(t), 982) * 30) {
        if (gate >= 0 && Math.abs(t - gate) < 6) continue;
        const f = t / L, [x, z] = fromFarm(u0 + (u1 - u0) * f, v0 + (v1 - v0) * f);
        if (!inTile(x, z) || blocked(x, z) || (ok && !ok(f))) continue;
        trees.push(x, hAt(x, z) - 0.1, z, hashf(seed, Math.floor(t), 983));
      }
      if (gate >= 0) fence(u0, v0, u1, v1, L, gate, ok, seed);
    } else if (kind === 1) { fence(u0, v0, u1, v1, L, -1, okG, seed); if (gate >= 0) fence(u0, v0, u1, v1, L, gate, ok, seed); }
    else {
      // dry-stone wall: knee-high, its top uneven, stones of many greys
      line(u0, v0, u1, v1, 0.7, (i, p) => {
        const s = p.t, j = n1(s / 0.9, seed) * 0.12, c = mixc(COL.stoneD, COL.stone, n1(s / 0.6, seed + 5));
        return [[-0.4, 0, -1, 0.15, shade(c, 0.85), 0], [-0.28, 0.8 + j, -0.8, 0.6, c, 0], [0, 0.92 + j, 0, 1, mixc(c, COL.stone, 0.4), 0], [0.28, 0.8 + j, 0.8, 0.6, c, 0], [0.4, 0, 1, 0.15, shade(c, 0.85), 0]];
      }, CK.wall, ok);
    }
  }
  // post-and-rail fence along a line (a gate across a gap when gateAt ≥ 0: a five-bar gate only)
  function fence(u0, v0, u1, v1, L, gateAt, ok, seed) {
    const post = (x, z, h) => {
      const g = hAt(x, z), q = 0.07, c = shade(COL.wood, 0.85 + 0.3 * hashf(Math.floor(x * 10), Math.floor(z * 10), 984));
      const v = [];
      for (const [dx, dz] of [[-q, -q], [q, -q], [q, q], [-q, q]]) { const nx = dx, nz = dz; v.push(M.v(x + dx, z + dz, 0, nx, 0, nz, c, CK.wood, 0, g), M.v(x + dx, z + dz, h, nx, 0.2, nz, c, CK.wood, 0, g)); }
      for (let k = 0; k < 4; k++) { const a = v[k * 2], b = v[k * 2 + 1], c2 = v[((k + 1) % 4) * 2], d = v[((k + 1) % 4) * 2 + 1]; M.quad(a, c2, d, b); }
      const t = M.v(x, z, h + 0.04, 0, 1, 0, c, CK.wood, 0, g); for (let k = 0; k < 4; k++) M.tri(v[k * 2 + 1], v[((k + 1) % 4) * 2 + 1], t);
    };
    const rail = (ax, az, bx, bz, y, c) => {
      const ga = hAt(ax, az), gb = hAt(bx, bz), dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l, t = 0.035, h = 0.06;
      const q = [];
      for (const [ox, oy, mx, my] of [[-t, 0, -1, 0], [-t, h, -1, 0], [-t, h, 0, 1], [t, h, 0, 1], [t, h, 1, 0], [t, 0, 1, 0]]) q.push([M.v(ax + nx * ox, az + nz * ox, y + oy, nx * mx, my, nz * mx, c, CK.wood, 0, ga), M.v(bx + nx * ox, bz + nz * ox, y + oy, nx * mx, my, nz * mx, c, CK.wood, 0, gb)]);
      for (let k = 0; k < 6; k += 2) M.quad(q[k][0], q[k][1], q[k + 1][1], q[k + 1][0]);
    };
    if (gateAt >= 0) {
      // a gate: two stout posts, five bars between them
      const f0 = (gateAt - 2) / L, f1 = (gateAt + 2) / L, [ax, az] = fromFarm(u0 + (u1 - u0) * f0, v0 + (v1 - v0) * f0), [bx, bz] = fromFarm(u0 + (u1 - u0) * f1, v0 + (v1 - v0) * f1);
      if (!inTile((ax + bx) / 2, (az + bz) / 2) || blocked((ax + bx) / 2, (az + bz) / 2) || (ok && !ok(gateAt / L))) return;
      post(ax, az, 1.3); post(bx, bz, 1.3);
      for (let k = 0; k < 5; k++) rail(ax, az, bx, bz, 0.25 + k * 0.22, [0.62, 0.55, 0.45]);
      return;
    }
    const n = Math.max(1, Math.round(L / 2.4));
    let prev = null;
    for (let s = 0; s <= n; s++) {
      const f = s / n, [x, z] = fromFarm(u0 + (u1 - u0) * f, v0 + (v1 - v0) * f);
      const open = inTile(x, z) && !blocked(x, z) && (!ok || ok(f));
      if (open) post(x, z, 1.15);
      if (open && prev) { const c = shade(COL.wood, 0.95); rail(prev[0], prev[1], x, z, 0.45, c); rail(prev[0], prev[1], x, z, 0.9, c); }
      prev = open ? [x, z] : null;
    }
    void seed;
  }

  // ---------------------------------------------------------------- crops
  function field(row, fx, R) {
    if (isFarmstead(fx, row)) return;   // its buildings and yard are landmarks (buildLandmarks)
    const r = hashf(fx, row, 4242), crop = cropOf(r), along = hashf(fx, row, 4250) < 0.55, ripe = hashf(fx, row, 4270), seed = (row * 7919 + fx) | 0;
    const eL = uEdge(fx, row), eR = uEdge(fx + 1, row);
    const inset = k => EDGE_HALF[k] + EDGE_GRASS[k] + 0.3;
    // the crop's extent: inside every boundary and its grass (the bottom and top boundaries vary along u, in 90 m stretches)
    const bIn = u => inset(vEdge(row, u)), tIn = u => inset(vEdge(row + 1, u));
    const cu0 = R.u0 + inset(eL), cu1 = R.u1 - inset(eR);
    const maxB = Math.max(...[R.u0, (R.u0 + R.u1) / 2, R.u1].map(bIn)), maxT = Math.max(...[R.u0, (R.u0 + R.u1) / 2, R.u1].map(tIn));
    const cv0 = R.v0 + maxB, cv1 = R.v1 - maxT;
    if (cu1 - cu0 < 3 || cv1 - cv0 < 3) return;
    // rows: across positions (centre of each row in the ground shader's stripes); a row runs the field's length
    const rows = (period, centre, fn) => {
      if (along) { for (let k = Math.ceil((cv0 - R.v0 - centre) / period); R.v0 + centre + k * period <= cv1; k++) { const v = R.v0 + centre + k * period; fn(cu0, v, cu1, v, v - R.v0, k); } }
      else { for (let k = Math.ceil((cu0 - R.u0 - centre) / period); R.u0 + centre + k * period <= cu1; k++) { const u = R.u0 + centre + k * period; fn(u, cv0, u, cv1, u - R.u0, k); } }
    };
    if (crop === CROP.corn) {
      const c0 = mixc(COL.corn, COL.cornTop, ripe * 0.6);
      rows(1.5, 0.75, (a0, b0, a1, b1, across, k) => line(a0, b0, a1, b1, 1.2, (i, p) => {
        const j = hashf(i, k + seed, 985), f = taper(p), H = (2.05 + 0.45 * n1(p.t / 1.7, seed + k) + (j - 0.5) * 0.3) * f, W = (0.42 + (j - 0.5) * 0.14) * (0.4 + 0.6 * f);
        return [[-0.3, 0, -1, 0.2, COL.cornBase, 0], [-W - 0.04, 1.0 * f, -0.9, 0.45, c0, 0.35], [0, H, 0, 1, mixc(COL.cornTop, COL.tassel, 0.55), 1], [W + 0.04, 1.0 * f, 0.9, 0.45, c0, 0.35], [0.3, 0, 1, 0.2, COL.cornBase, 0]];
      }, CK.corn));
    } else if (crop === CROP.sunflower) {
      rows(1.2, 0.6, (a0, b0, a1, b1, across, k) => {
        line(a0, b0, a1, b1, 1.2, (i, p) => {
          const f = taper(p), H = (1.55 + 0.25 * n1(p.t / 2.3, seed + k)) * f;
          return [[-0.28, 0, -1, 0.2, COL.cornBase, 0], [-0.46, 0.85 * f, -0.9, 0.4, COL.sunLeaf, 0.3], [0, H, 0, 1, shade(COL.sunLeaf, 1.15), 0.7], [0.46, 0.85 * f, 0.9, 0.4, COL.sunLeaf, 0.3], [0.28, 0, 1, 0.2, COL.cornBase, 0]];
        }, CK.leaf);
        // the heads, all turned to the morning sun (east, a little south)
        const L = Math.hypot(a1 - a0, b1 - b0), n = Math.floor(L / 1.1);
        for (let s = 0; s < n; s++) {
          const f = (s + 0.5) / n, [x, z] = fromFarm(a0 + (a1 - a0) * f, b0 + (b1 - b0) * f);
          if (!inTile(x, z) || blocked(x, z)) continue;
          const tf = taper({ x, z }); if (tf < 0.6) continue;   // (none on the dwindling end of a row)
          head(x, z, (1.75 + 0.3 * hashf(s, k + seed, 986)) * tf, 0.3 + 0.06 * hashf(s, k + seed, 987));
        }
      });
    } else if (crop === CROP.wheat || crop === CROP.barley) {
      // standing crop in slabs, the tram lines open between them (wheel tracks 24 m apart, the ground shader's)
      const H = crop === CROP.wheat ? 0.95 : 0.8, top = mixc(crop === CROP.wheat ? COL.wheat : COL.barley, [0.78, 0.66, 0.3], ripe * 0.5);
      const A0 = along ? cv0 - R.v0 : cu0 - R.u0, A1 = along ? cv1 - R.v0 : cu1 - R.u0;   // across extent, field-relative
      const L0 = along ? cu0 - R.u0 : cv0 - R.v0, L1 = along ? cu1 - R.u0 : cv1 - R.v0;   // along extent
      for (let k = Math.floor((A0 + 13) / 24) - 1; k * 24 - 13 < A1; k++) {
        const t1 = k * 24 + 11.1, t2 = k * 24 + 12.9;
        for (const [s0, s1] of [[k * 24 - 11.1 + 0.22, t1 - 0.22], [t1 + 0.22, t2 - 0.22]]) {
          const a0 = Math.max(A0, s0), a1 = Math.min(A1, s1);
          if (a1 - a0 >= 0.4) canopy(R, along, a0, a1, L0, L1, H, top, seed);
        }
      }
    } else if (crop === CROP.veg) {
      // cabbages, a head every 75 cm along rows 90 cm apart
      rows(0.9, 0.45, (a0, b0, a1, b1, across, k) => {
        const L = Math.hypot(a1 - a0, b1 - b0), n = Math.floor(L / 0.9);
        for (let s = 0; s < n; s++) {
          const f = (s + 0.5) / n, [x, z] = fromFarm(a0 + (a1 - a0) * f, b0 + (b1 - b0) * f);
          if (!inTile(x, z) || blocked(x, z)) continue;
          dome(x, z, 0.24 + 0.06 * hashf(s, k + seed, 988), 0.3, mixc(COL.cabbage, COL.cabbageIn, 0.3 * hashf(s, k, 989)), COL.cabbageIn, CK.veg);
        }
      });
    } else if (crop === CROP.lavender) {
      rows(1.6, 0.8, (a0, b0, a1, b1, across, k) => line(a0, b0, a1, b1, 0.5, (i, p) => {
        const b = Math.abs(Math.sin(p.t * Math.PI / 1.0)), H = 0.32 + 0.38 * Math.sqrt(b), W = 0.3 + 0.22 * Math.sqrt(b);
        return [[-0.3, 0, -1, 0.3, COL.lavBase, 0], [-W, H * 0.55, -0.9, 0.5, mixc(COL.lavBase, COL.lav, 0.5), 0.2], [0, H, 0, 1, COL.lav, 0.5], [W, H * 0.55, 0.9, 0.5, mixc(COL.lavBase, COL.lav, 0.5), 0.2], [0.3, 0, 1, 0.3, COL.lavBase, 0]];
      }, CK.lavender));
    } else if (crop === CROP.tulip) {
      rows(0.7, 0.35, (a0, b0, a1, b1, across, k) => line(a0, b0, a1, b1, 1.0, (i, p) => {
        const alongC = (along ? a0 : b0) - (along ? R.u0 : R.v0) + p.t, band = Math.floor(alongC / 3.5), tc = TULIPS[Math.min(4, Math.floor(hashf(band, fx, 4280) * 5))];
        return [[-0.22, 0, -1, 0.3, COL.tulipLeaf, 0], [0, 0.42, 0, 1, tc, 0.6], [0.22, 0, 1, 0.3, COL.tulipLeaf, 0]];
      }, CK.tulip, null, Ms));
    } else if (crop === CROP.hay && ripe >= 0.5) {
      // raked into windrows (the ground shader's lines)
      rows(10, 2.5, (a0, b0, a1, b1) => line(a0, b0, a1, b1, 1.2, (i, p) => {
        const H = 0.3 + 0.08 * n1(p.t / 1.5, seed);
        return [[-0.6, 0, -1, 0.3, shade(COL.hay, 0.8), 0], [-0.35, H * 0.8, -0.6, 0.8, COL.hay, 0.2], [0, H, 0, 1, mixc(COL.hay, COL.straw, 0.3), 0.3], [0.35, H * 0.8, 0.6, 0.8, COL.hay, 0.2], [0.6, 0, 1, 0.3, shade(COL.hay, 0.8), 0]];
      }, CK.hay));
    }
    if (crop === CROP.stubble || (crop === CROP.hay && ripe < 0.5)) {
      // the harvest: round bales along the swaths (some wrapped for silage), or stacks of square ones
      const style = hashf(fx, row, 4290), wrap = style < 0.22 ? [COL.wrapW, COL.wrapG, COL.wrapB][Math.floor(hashf(fx, row, 4291) * 3)] : null;
      if (style > 0.85) {
        const n = 1 + Math.floor(hashf(fx, row, 4292) * 3);
        for (let s = 0; s < n; s++) { const fu = cu0 + (cu1 - cu0) * (0.2 + 0.6 * hashf(s, seed, 4293)), fv = cv0 + (cv1 - cv0) * (0.2 + 0.6 * hashf(s, seed, 4294)), [x, z] = fromFarm(fu, fv); if (inTile(x, z) && !blocked(x, z)) stack(x, z, hashf(s, seed, 4295) * Math.PI, seed + s); }
      } else {
        rows(6, 3, (a0, b0, a1, b1, across, k) => {
          const L = Math.hypot(a1 - a0, b1 - b0), dx = (a1 - a0) / (L || 1), dz = (b1 - b0) / (L || 1);
          for (let t = 6 + hashf(k, seed, 4296) * 14; t < L - 3; t += 14 + hashf(Math.floor(t), k + seed, 4297) * 16) {
            if (hashf(Math.floor(t), k + seed, 4298) < 0.35) continue;
            const [x, z] = fromFarm(a0 + dx * t, b0 + dz * t);
            if (inTile(x, z) && !blocked(x, z)) bale(x, z, Math.atan2(dz, dx) + (hashf(Math.floor(t), k, 4299) - 0.5) * 0.8, wrap);
          }
        });
      }
    }
  }

  /**
   * A standing crop as a canopy over a grid in the field's frame (across a0..a1, along l0..l1, field-relative): a gently
   * uneven top at height H following the ground, thinning down into the ground where it nears a road's verge, the river
   * bank or a yard (by the exact distance, so its edge runs smoothly round them), and where its rows end (a tram line,
   * the field's edge) a wall of stalks with ears along its top. Cells are this tile's when their middles are.
   */
  function canopy(R, along, a0, a1, l0, l1, H, top, seed) {
    // the crop's height above the ground at a point: full, or thinning into the ground near what it keeps off
    const htAt = (x, z) => { const cov = sstep(-0.6, 2.2, clear(x, z)); return cov > 0.999 ? H + 0.06 * n1(x * 0.21 + z * 0.13, seed) : H * cov - 0.35 * (1 - cov); };
    const nA = Math.max(1, Math.ceil((a1 - a0) / 2.5)), nL = Math.max(1, Math.ceil((l1 - l0) / 3));
    const at = (i, j) => { const ac = a0 + (a1 - a0) * i / nA, l = l0 + (l1 - l0) * j / nL; return along ? fromFarm(R.u0 + l, R.v0 + ac) : fromFarm(R.u0 + ac, R.v0 + l); };
    const W = (nA + 1), NV = W * (nL + 1), pts = new Array(NV), ht = new Float32Array(NV), gy = new Float32Array(NV);
    for (let j = 0; j <= nL; j++) for (let i = 0; i <= nA; i++) {
      const q = j * W + i, p = pts[q] = at(i, j);
      ht[q] = htAt(p[0], p[1]); gy[q] = hAt(p[0], p[1]);
    }
    const topV = new Map(), side = shade(top, 0.74);
    const P3 = (i, j) => { i = Math.max(0, Math.min(nA, i)); j = Math.max(0, Math.min(nL, j)); const q = j * W + i; return [pts[q][0], gy[q] + ht[q], pts[q][1]]; };
    const tv = (i, j) => {
      const key = j * W + i; let v = topV.get(key);
      if (v === undefined) {
        const [x, z] = pts[key], c = mixc(top, shade(top, 0.86), n1(x * 0.11 - z * 0.07, seed + 1));
        // the surface's own normal (the ground's slope and the crop thinning out), a little uneven
        const a = P3(i + 1, j), b = P3(i - 1, j), e = P3(i, j + 1), f = P3(i, j - 1), ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2], wx = e[0] - f[0], wy = e[1] - f[1], wz = e[2] - f[2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz) || 1, jx = (n1(x * 0.37, seed + 4) - 0.5) * 0.2, jz = (n1(z * 0.37, seed + 5) - 0.5) * 0.2;
        v = M.v(x, z, ht[key], nx / l + jx, ny / l, nz / l + jz, c, CK.wheat, 0.7, gy[key]);
        topV.set(key, v);
      }
      return v;
    };
    const wall = (pi, qi, nx, nz) => {
      // stalks from the ground to the top, ears in a fringe along it
      const [px, pz] = pts[pi], [qx, qz] = pts[qi], hp = ht[pi], hq = ht[qi];
      if (hp < 0.05 && hq < 0.05) return;
      const L = Math.hypot(qx - px, qz - pz);
      const a = M.v(px, pz, -0.05, nx, 0.1, nz, shade(side, 0.6), CK.wheat, 0, gy[pi], [0, 0]), b = M.v(qx, qz, -0.05, nx, 0.1, nz, shade(side, 0.6), CK.wheat, 0, gy[qi], [L, 0]);
      const c = M.v(qx, qz, Math.max(0, hq), nx, 0.25, nz, side, CK.wheat, 0.6, gy[qi], [L, hq]), d = M.v(px, pz, Math.max(0, hp), nx, 0.25, nz, side, CK.wheat, 0.6, gy[pi], [0, hp]);
      M.quad(a, b, c, d);
      const n = Math.max(1, Math.round(L / 0.32));
      for (let k = 0; k < n; k++) {
        const f0 = k / n, f1 = (k + 1) / n, fm = (f0 + f1) / 2, h0 = hp + (hq - hp) * f0, h1 = hp + (hq - hp) * f1, hm = (h0 + h1) / 2;
        if (hm < 0.25) continue;
        const j = hashf(Math.floor(px * 7) + k, Math.floor(pz * 7), seed);
        const e0 = M.v(px + (qx - px) * f0, pz + (qz - pz) * f0, h0 - 0.04, nx, 0.4, nz, side, CK.wheat, 0.7);
        const e1 = M.v(px + (qx - px) * f1, pz + (qz - pz) * f1, h1 - 0.04, nx, 0.4, nz, side, CK.wheat, 0.7);
        const tip = M.v(px + (qx - px) * fm + nx * 0.06, pz + (qz - pz) * fm + nz * 0.06, hm + 0.1 + 0.1 * j, nx, 0.6, nz, top, CK.wheat, 0.9);
        M.tri(e0, e1, tip);
      }
    };
    // a cell where the crop thins out, as K × K smaller cells (their corners on the cell's own ground and crop rules)
    const K = 4;
    function thinning(q) {
      const [p0, p1, p2, p3] = q.map(k => pts[k]), sub = [], N = K + 1;
      for (let b = 0; b <= K; b++) for (let a = 0; a <= K; a++) {
        const u = a / K, v = b / K, x = (p0[0] * (1 - u) + p1[0] * u) * (1 - v) + (p3[0] * (1 - u) + p2[0] * u) * v, z = (p0[1] * (1 - u) + p1[1] * u) * (1 - v) + (p3[1] * (1 - u) + p2[1] * u) * v;
        sub.push({ x, z, h: htAt(x, z), g: hAt(x, z) });
      }
      const S = (a, b) => sub[Math.max(0, Math.min(K, b)) * N + Math.max(0, Math.min(K, a))], vid = new Array(N * N);
      const V = (a, b) => {
        const k = b * N + a; if (vid[k] !== undefined) return vid[k];
        const s0 = S(a, b), A = S(a + 1, b), B = S(a - 1, b), E = S(a, b + 1), F = S(a, b - 1);
        const ux = A.x - B.x, uy = A.g + A.h - B.g - B.h, uz = A.z - B.z, wx = E.x - F.x, wy = E.g + E.h - F.g - F.h, wz = E.z - F.z;
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz) || 1, c = mixc(top, shade(top, 0.86), n1(s0.x * 0.11 - s0.z * 0.07, seed + 1));
        return (vid[k] = M.v(s0.x, s0.z, s0.h, nx / l, ny / l, nz / l, c, CK.wheat, 0.7, s0.g));
      };
      for (let b = 0; b < K; b++) for (let a = 0; a < K; a++) {
        if (Math.max(S(a, b).h, S(a + 1, b).h, S(a + 1, b + 1).h, S(a, b + 1).h) < 0.02) continue;
        M.quad(V(a, b), V(a + 1, b), V(a + 1, b + 1), V(a, b + 1));
      }
    }
    for (let j = 0; j < nL; j++) for (let i = 0; i < nA; i++) {
      const q = [j * W + i, j * W + i + 1, (j + 1) * W + i + 1, (j + 1) * W + i];
      if (Math.max(ht[q[0]], ht[q[1]], ht[q[2]], ht[q[3]]) < 0.02) continue;   // all of it below the ground
      const mx = (pts[q[0]][0] + pts[q[2]][0]) / 2, mz = (pts[q[0]][1] + pts[q[2]][1]) / 2; if (!inTile(mx, mz)) continue;
      if (Math.min(ht[q[0]], ht[q[1]], ht[q[2]], ht[q[3]]) > H - 0.1) M.quad(tv(i, j), tv(i + 1, j), tv(i + 1, j + 1), tv(i, j + 1));
      else thinning(q);   // where it thins out: a finer mesh, so its edge runs smoothly (2026-10-03: a saw-tooth edge)
      // walls where its rows end (the grid's own edges): each side's outward normal from the cell's middle
      const side4 = [[q[0], q[1], j === 0], [q[1], q[2], i === nA - 1], [q[2], q[3], j === nL - 1], [q[3], q[0], i === 0]];
      for (const [pi, qi, edge] of side4) {
        if (!edge) continue;
        const ex = (pts[pi][0] + pts[qi][0]) / 2 - mx, ez = (pts[pi][1] + pts[qi][1]) / 2 - mz, l = Math.hypot(ex, ez) || 1;
        wall(pi, qi, ex / l, ez / l);
      }
    }
  }

  // ---------------------------------------------------------------- pieces
  // a low dome (a cabbage): a ring of leaves round a paler heart
  function dome(x, z, r, h, c, cIn, kind) {
    const M = Ms, g = hAt(x, z), N = 5, ring0 = [], ring1 = [];
    for (let k = 0; k < N; k++) {
      const a = k / N * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), rr = r * (0.92 + 0.16 * ((k * 37) % 5) / 5);
      ring0.push(M.v(x + ca * rr * 1.15, z + sa * rr * 1.15, 0.02, ca, 0.3, sa, shade(c, 0.75), kind, 0, g));
      ring1.push(M.v(x + ca * rr, z + sa * rr, h * 0.55, ca, 0.7, sa, c, kind, 0.2, g));
    }
    const top = M.v(x, z, h, 0, 1, 0, cIn, kind, 0.3, g);
    for (let k = 0; k < N; k++) { const k1 = (k + 1) % N; M.quad(ring0[k], ring0[k1], ring1[k1], ring1[k]); M.tri(ring1[k], ring1[k1], top); }
  }
  // a sunflower head on its stalk top: petals round a dark disc, facing east-south-east and a little up
  function head(x, z, y, r) {
    const M = Ms, g = hAt(x, z), fx = 0.85, fz = 0.3, fy = 0.45, l = Math.hypot(fx, fy, fz), nx = fx / l, ny = fy / l, nz = fz / l;
    // two axes in the head's plane
    let ux = -nz, uz = nx; const ul = Math.hypot(ux, uz); ux /= ul; uz /= ul;
    const vx = ny * uz, vy = nz * ux - nx * uz, vz = -ny * ux;
    const cx = x, cz = z, N = 7, inner = [], outer = [], back = [];
    for (let k = 0; k < N; k++) {
      const a = k / N * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const ix = (ux * ca + vx * sa) * r * 0.55, iy = vy * sa * r * 0.55, iz = (uz * ca + vz * sa) * r * 0.55;
      const ox = (ux * ca + vx * sa) * r * 1.25, oy = vy * sa * r * 1.25, oz = (uz * ca + vz * sa) * r * 1.25;
      inner.push(M.v(cx + ix, cz + iz, y + iy, nx, ny, nz, COL.disc, CK.head, 0.6, g));
      outer.push(M.v(cx + ox, cz + oz, y + oy, nx, ny + 0.2, nz, COL.petal, CK.head, 0.7, g));
      back.push(M.v(cx + ix - nx * 0.12, cz + iz - nz * 0.12, y + iy - ny * 0.12, -nx, -ny, -nz, COL.sunLeaf, CK.leaf, 0.6, g));
    }
    const c = M.v(cx + nx * 0.04, cz + nz * 0.04, y + ny * 0.04, nx, ny, nz, shade(COL.disc, 0.8), CK.head, 0.6, g);
    const b = M.v(cx - nx * 0.2, cz - nz * 0.2, y - ny * 0.2, -nx, -ny, -nz, COL.sunLeaf, CK.leaf, 0.6, g);
    for (let k = 0; k < N; k++) {
      const k1 = (k + 1) % N;
      M.tri(c, inner[k], inner[k1]);
      M.tri(inner[k], outer[k], inner[k1]);   // a pointed petal
      M.tri(b, back[k1], back[k]);
    }
  }
  // a round bale lying on its side: straw rolled in a spiral (the rings on its flat ends, the straw running round its
  // curve), its edges rounded; or wrapped in plastic film, wound on in overlapping bands. Texture coordinates: along
  // the axis and round the curve on its side, across the face on its ends.
  function bale(x, z, yaw, wrap) {
    const g = hAt(x, z), R = 0.74, Lh = 0.62, B = 0.08, N = 16, ax = Math.cos(yaw), az = Math.sin(yaw);
    const sideK = wrap ? CK.wrap : CK.bale, endK = wrap ? CK.wrapEnd : CK.baleEnd, side = wrap || COL.straw, endC = wrap ? shade(wrap, 0.95) : COL.strawEnd;
    const tint = 0.92 + 0.12 * hashf(Math.floor(x * 5), Math.floor(z * 5), 4310);
    // a ring round the axis at s (along it), radius r; normals leaning out along the axis by lean
    const ring = (s, r, lean, col, kind, endFace) => {
      const out = [];
      for (let k = 0; k <= N; k++) {
        if (endFace && k === N) break;
        const a = k / N * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), rx = -az * ca, rz = ax * ca, sg = Math.sign(s);
        const nx = endFace ? ax * sg : rx * (1 - lean) + ax * sg * lean, ny = endFace ? 0 : sa * (1 - lean), nz = endFace ? az * sg : rz * (1 - lean) + az * sg * lean;
        out.push(M.v(x + ax * s + rx * r, z + az * s + rz * r, R + sa * r - 0.03, nx, ny, nz, shade(col, tint), kind, 0, g, endFace ? [ca * r, sa * r] : [s, a * R]));
      }
      return out;
    };
    const b0 = ring(-Lh, R - B, 0.6, side, sideK), r0 = ring(-(Lh - B), R, 0, side, sideK), r1 = ring(Lh - B, R, 0, side, sideK), b1 = ring(Lh, R - B, 0.6, side, sideK);
    for (const [p, q] of [[b0, r0], [r0, r1], [r1, b1]]) for (let k = 0; k < N; k++) M.quad(p[k], p[k + 1], q[k + 1], q[k]);
    for (const sg of [-1, 1]) {
      const e = ring(sg * Lh, R - B, 1, endC, endK, true), c = M.v(x + ax * (Lh + 0.02) * sg, z + az * (Lh + 0.02) * sg, R - 0.03, ax * sg, 0, az * sg, shade(endC, tint * 0.9), endK, 0, g, [0, 0]);
      for (let k = 0; k < N; k++) M.tri(c, e[k], e[(k + 1) % N]);
    }
  }
  // a stack of square bales: two layers; each bale's straw in flakes across its length, two strings round it
  function stack(x, z, yaw, seed) {
    const g = hAt(x, z), ca = Math.cos(yaw), sa = Math.sin(yaw), bw = 0.46, bl = 0.9, bh = 0.36;
    const box = (cx, cz, y0) => {
      const c = shade(COL.straw, 0.9 + 0.15 * hashf(Math.floor(cx * 9), Math.floor(cz * 9), seed)), v = [];
      for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const lx = i * bl / 2, lz = j * bw / 2, wx = x + (cx + lx) * ca - (cz + lz) * sa, wz = z + (cx + lx) * sa + (cz + lz) * ca; v.push([wx, wz, i, j, lx, lz]); }
      // the long sides show the flakes (along: the bale's length), the ends the cut straw
      for (let k = 0; k < 4; k++) {
        const A = v[k], Bv = v[(k + 1) % 4], long = k % 2 === 0, kind = long ? CK.square : CK.squareEnd, nx = (A[2] + Bv[2]) / 2, nz = (A[3] + Bv[3]) / 2;
        const wnx = nx * ca - nz * sa, wnz = nx * sa + nz * ca, ta = long ? A[4] : A[5], tb = long ? Bv[4] : Bv[5];
        M.quad(M.v(A[0], A[1], y0, wnx, 0, wnz, shade(c, 0.85), kind, 0, g, [ta, 0]), M.v(Bv[0], Bv[1], y0, wnx, 0, wnz, shade(c, 0.85), kind, 0, g, [tb, 0]), M.v(Bv[0], Bv[1], y0 + bh, wnx, 0, wnz, c, kind, 0, g, [tb, bh]), M.v(A[0], A[1], y0 + bh, wnx, 0, wnz, c, kind, 0, g, [ta, bh]));
      }
      const up = v.map(([wx, wz, , , lx, lz]) => M.v(wx, wz, y0 + bh, 0, 1, 0, c, CK.square, 0, g, [lx, lz])); M.quad(up[0], up[1], up[2], up[3]);
    };
    for (let i = -1; i <= 1; i++) for (let j = 0; j < 2; j++) box(i * (bl + 0.02), j * (bw + 0.02) - bw / 2, 0);
    for (let i = -0.5; i <= 0.5; i++) for (let j = 0; j < 2; j++) box(i * (bl + 0.02), j * (bw + 0.02) - bw / 2, bh);
  }
  const mesh = Mt.build(), small = Ms.build();
  void M;
  return mesh || small || trees.length ? { mesh, small, trees } : null;
}

// ---------------------------------------------------------------- farmsteads
/**
 * The farmsteads standing in this tile (fields that hold one, shared/farms.js isFarmstead): a gambrel-roofed barn with
 * its great doors, a silo, a two-storey farmhouse with a chimney and windows that light at night, an open hay shed with
 * bales stacked under it, round a gravel yard. `detail` false: the same buildings as simple blocks, for the coarser
 * tiles (seen from afar). Always standing (no growing in); { mesh, trees } or null.
 */
export function buildLandmarks(island, x0, z0, S, hAt, detail = true) {
  const dCity = island.cityDist(x0 + S / 2, z0 + S / 2);
  if (dCity < 520 - S || dCity > 2000 + S) return null;
  const M = new Mesh(x0, z0, hAt, true), trees = [], blocked = blockedGrid(island, hAt);
  let fu0 = Infinity, fv0 = Infinity, fu1 = -Infinity, fv1 = -Infinity;
  for (const [x, z] of [[x0, z0], [x0 + S, z0], [x0, z0 + S], [x0 + S, z0 + S]]) { const [u, v] = toFarm(x, z); fu0 = Math.min(fu0, u); fv0 = Math.min(fv0, v); fu1 = Math.max(fu1, u); fv1 = Math.max(fv1, v); }
  for (let row = bandOf(fv0 - 60).row; row <= bandOf(fv1 + 60).row; row++) {
    const w = 40 + hashf(row, 1, 4244) * 70, off = hashf(row, 0, 4243) * 90;
    for (let fx = Math.floor((fu0 - 60 + 5000 + off) / w); fx <= Math.floor((fu1 + 60 + 5000 + off) / w); fx++) {
      if (!isFarmstead(fx, row) || !farmed(island, row, fx)) continue;
      const R = fieldRect(row, fx), cu = (R.u0 + R.u1) / 2, cv = (R.v0 + R.v1) / 2, [cx, cz] = fromFarm(cu, cv);
      if (cx < x0 || cx >= x0 + S || cz < z0 || cz >= z0 + S) continue;   // its tile is the one its middle is in
      const [ax, az] = fromFarm(cu + 1, cv), yaw = Math.atan2(az - cz, ax - cx);
      // the yard must be clear: no road, building, water within it
      const ca = Math.cos(yaw), sa = Math.sin(yaw), at = (a, b) => [cx + ca * a - sa * b, cz + sa * a + ca * b];
      if ([[0, 0], [-16, -12], [16, -12], [-16, 12], [16, 12]].some(([a, b]) => { const [x, z] = at(a, b); return blocked(x, z); })) continue;
      stead(M, at, yaw, hashf(fx, row, 4301), detail, hAt);
      if (detail) for (const [a, b] of [[20, -14], [24, -2], [-22, 15], [6, 18]]) { const [x, z] = at(a + hashf(fx, a, 4302) * 3, b); if (!blocked(x, z)) trees.push(x, hAt(x, z) - 0.1, z, hashf(fx, b, 4303)); }
    }
  }
  const mesh = M.build();
  return mesh || trees.length ? { mesh, trees } : null;
}
/** A box standing on the ground at local (a, b) of a farmstead, its sides facing out; base: the ground height. */
function block(M, at, yaw, a, b, w, d, y0, y1, col, kind, base, top = true) {
  const c = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([p, q]) => at(a + p, b + q));
  const ca = Math.cos(yaw), sa = Math.sin(yaw), nrm = [[sa, -ca], [ca, sa], [-sa, ca], [-ca, -sa]];   // outward: −b, +a, +b, −a
  for (let k = 0; k < 4; k++) {
    // texture coordinates: along the side from its first corner (offset by the box's place, so neighbours differ), up
    const [p0, p1] = [c[k], c[(k + 1) % 4]], [nx, nz] = nrm[k], L = k % 2 ? d : w, o = (a + b) * 0.37 + k * 1.3;
    const v = [M.v(p0[0], p0[1], y0, nx, 0, nz, col, kind, 0, base, [o, y0]), M.v(p1[0], p1[1], y0, nx, 0, nz, col, kind, 0, base, [o + L, y0]), M.v(p1[0], p1[1], y1, nx, 0, nz, col, kind, 0, base, [o + L, y1]), M.v(p0[0], p0[1], y1, nx, 0, nz, col, kind, 0, base, [o, y1])];
    M.quad(v[0], v[1], v[2], v[3]);
  }
  if (top) { const loc = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], v = c.map(([x, z], q) => M.v(x, z, y1, 0, 1, 0, col, kind, 0, base, [a + loc[q][0], b + loc[q][1]])); M.quad(v[0], v[1], v[2], v[3]); }
}
/**
 * A building's long body extruded along local a from a − len/2 to a + len/2 at local b: its cross-section `prof`
 * [[across, height, colour, kind], ...] (walls up, then the roof's planes), with gable ends filled.
 */
function extrude(M, at, yaw, a, b, len, prof, base, endCol, endKind) {
  const ca = Math.cos(yaw), sa = Math.sin(yaw), ax = [ca, sa], cr = [-sa, ca];
  for (const end of [-1, 1]) {
    // the gable: a fan from the middle of the section
    const pts = prof.map(([o, y]) => { const [x, z] = at(a + end * len / 2, b + o); return M.v(x, z, y, ax[0] * end, 0, ax[1] * end, endCol, endKind, 0, base, [o, y]); });
    const my = prof.reduce((s, p) => s + p[1], 0) / prof.length, [mx, mz] = at(a + end * len / 2, b), mid = M.v(mx, mz, my, ax[0] * end, 0, ax[1] * end, endCol, endKind, 0, base, [0, my]);
    for (let k = 0; k + 1 < pts.length; k++) M.tri(mid, pts[k], pts[k + 1]);
    M.tri(mid, pts.at(-1), pts[0]);
  }
  let arc = 0;
  for (let k = 0; k + 1 < prof.length; k++) {
    // the outward normal of a section running up one side, over the top and down the other; texture coordinates along
    // the building and round its section (walls: their height; roofs: up the slope)
    const [o0, y0, col, kind] = prof[k], [o1, y1] = prof[k + 1], no = -(y1 - y0), ny = (o1 - o0), l = Math.hypot(no, ny) || 1;
    const nx = cr[0] * no / l, nz = cr[1] * no / l, nyy = ny / l, wall = Math.abs(o1 - o0) < 1e-3, t0 = wall ? y0 : arc, t1 = wall ? y1 : arc + l;
    const s = side => at(a + side * len / 2, b), q = [];
    for (const [side, o, y, tv] of [[-1, o0, y0, t0], [1, o0, y0, t0], [1, o1, y1, t1], [-1, o1, y1, t1]]) { const [x, z] = s(side); q.push(M.v(x + cr[0] * o, z + cr[1] * o, y, nx, nyy, nz, col, kind, 0, base, [a + side * len / 2 + b * 0.37, tv])); }
    M.quad(q[0], q[1], q[2], q[3]);
    arc += l;
  }
}
const SC = { barn: [0.62, 0.17, 0.13], trim: [0.94, 0.93, 0.88], roof: [0.25, 0.26, 0.28], house: [0.93, 0.9, 0.82], roofH: [0.33, 0.22, 0.18], silo: [0.78, 0.8, 0.82], glass: [0.2, 0.24, 0.28], wood: [0.55, 0.42, 0.3], gravel: [0.66, 0.62, 0.55], door: [0.36, 0.1, 0.08] };
function stead(M, at, yaw, r, detail, hAt) {
  const ground = (a, b) => { const [x, z] = at(a, b); return hAt(x, z); };
  // each building on a level base at its lowest corner, its walls running a little into the ground
  const baseOf = (a, b, w, d) => Math.min(ground(a - w / 2, b - d / 2), ground(a + w / 2, b - d / 2), ground(a - w / 2, b + d / 2), ground(a + w / 2, b + d / 2), ground(a, b)) - 0.05;
  const barnCol = r < 0.6 ? SC.barn : r < 0.8 ? [0.45, 0.33, 0.24] : [0.3, 0.36, 0.42];
  // the barn: a gambrel roof over plank walls, its great doors in the gable end
  {
    const a = -8, b = 0, L = 18, W = 10, base = baseOf(a, b, L, W) - 0.6, e = 5.6, k = 8.2, ridge = 9.6;
    extrude(M, at, yaw, a, b, L, [[-W / 2, 0, barnCol, CK.planks], [-W / 2, e, SC.roof, CK.roof], [-3.5, k, SC.roof, CK.roof], [0, ridge, SC.roof, CK.roof], [3.5, k, barnCol, CK.planks], [W / 2, e, barnCol, CK.planks], [W / 2, 0, barnCol, CK.planks]].map(([o, y, c, kd], i, P) => [o, y + 0.6, i === 0 || i === P.length - 1 || i === 5 ? barnCol : c, i === 0 || i === 5 || i === 6 ? CK.planks : kd]), base, barnCol, CK.planks);
    // the roof planes over the walls (an overhang), dark
    if (detail) {
      const roof = (o0, y0, o1, y1) => {
        const q = [[-L / 2 - 0.4, o0, y0], [L / 2 + 0.4, o0, y0], [L / 2 + 0.4, o1, y1], [-L / 2 - 0.4, o1, y1]].map(([s2, o, y]) => { const [x, z] = at(a + s2, b + o); const no = (o1 - o0) > 0 ? 1 : -1; return M.v(x, z, y + 0.6, -Math.sin(yaw) * (y1 - y0) * no * 0.3, 1, Math.cos(yaw) * (y1 - y0) * no * 0.3, SC.roof, CK.roof, 0, base); });
        M.quad(q[0], q[1], q[2], q[3]);
      };
      roof(-W / 2 - 0.45, e - 0.3, -3.5, k + 0.05); roof(-3.5, k + 0.05, 0, ridge + 0.08); roof(0, ridge + 0.08, 3.5, k + 0.05); roof(3.5, k + 0.05, W / 2 + 0.45, e - 0.3);
      // great doors: dark planks framed and crossed in white, a hay-loft door above
      for (const end of [-1, 1]) {
        const ea = a + end * (L / 2 + 0.03);
        block(M, at, yaw, ea, b, 0.06, 4.2, 0.6, 4.6, SC.door, CK.planks, base);
        block(M, at, yaw, ea + end * 0.04, b, 0.06, 4.4, 4.6, 4.8, SC.trim, CK.plaster, base);
        for (const o of [-2.15, 0, 2.15]) block(M, at, yaw, ea + end * 0.04, b + o, 0.06, 0.2, 0.6, 4.7, SC.trim, CK.plaster, base);
        block(M, at, yaw, ea, b, 0.06, 1.6, 6.3, 7.6, SC.door, CK.planks, base);
      }
    }
  }
  // the silo beside it: a tall metal drum with a dome
  {
    const a = -19.5, b = 6, base = ground(a, b) - 0.3, R = 2.1, H = 12.5, N = detail ? 14 : 8, [cx, cz] = at(a, b);
    const ring = (y, rr, ny = 0) => Array.from({ length: N }, (_, q) => { const t = q / N * Math.PI * 2; return M.v(cx + Math.cos(t) * rr, cz + Math.sin(t) * rr, y, Math.cos(t), ny, Math.sin(t), SC.silo, CK.metal, 0, base); });
    const r0 = ring(0, R), r1 = ring(H, R), r2 = ring(H + 1.4, R * 0.7, 0.6), top = M.v(cx, cz, H + 2.2, 0, 1, 0, SC.silo, CK.metal, 0, base);
    for (let q = 0; q < N; q++) { const q1 = (q + 1) % N; M.quad(r0[q], r0[q1], r1[q1], r1[q]); M.quad(r1[q], r1[q1], r2[q1], r2[q]); M.tri(r2[q], r2[q1], top); }
  }
  // the farmhouse: two storeys, a pitched roof with a chimney, windows (lit at night) and a door
  {
    const a = 12, b = -7, L = 10, W = 8, base = baseOf(a, b, L, W) - 0.4, e = 6.4, ridge = 9.4, wallCol = r < 0.5 ? SC.house : [0.86, 0.8, 0.7];
    extrude(M, at, yaw, a, b, L, [[-W / 2, 0, wallCol, CK.plaster], [-W / 2, e + 0.4, SC.roofH, CK.roof], [0, ridge + 0.4, SC.roofH, CK.roof], [W / 2, e + 0.4, wallCol, CK.plaster], [W / 2, 0, wallCol, CK.plaster]], base, wallCol, CK.plaster);
    block(M, at, yaw, a + 2.5, b + 1.2, 0.8, 0.8, ridge - 1, ridge + 1.6, [0.5, 0.36, 0.3], CK.plaster, base);   // chimney
    if (detail) {
      // windows on both long sides and the ends, the door facing the yard
      for (const side of [-1, 1]) for (const fl of [1.5, 4.4]) for (const o of [-3, -1, 1, 3]) {
        if (side > 0 && fl < 3 && o === 1) continue;
        block(M, at, yaw, a + o, b + side * (W / 2 + 0.02), 1.0, 0.06, 0.4 + fl, 0.4 + fl + 1.3, SC.glass, CK.window, base, false);
        block(M, at, yaw, a + o, b + side * (W / 2 + 0.04), 1.2, 0.04, 0.3 + fl, 0.4 + fl, SC.trim, CK.plaster, base);
      }
      block(M, at, yaw, a + 1, b + W / 2 + 0.03, 1.1, 0.06, 0.4, 2.6, [0.25, 0.32, 0.4], CK.planks, base, false);
      block(M, at, yaw, a + 1, b + W / 2 + 0.9, 2.4, 1.6, 2.7, 2.85, SC.roofH, CK.roof, base);   // porch roof
      for (const o of [-0.1, 2.1]) block(M, at, yaw, a + o, b + W / 2 + 1.6, 0.12, 0.12, 0.4, 2.7, SC.trim, CK.wood, base);
    }
  }
  // the hay shed: posts and a pent roof over stacked bales
  {
    const a = 9, b = 10.5, L = 11, W = 6, base = baseOf(a, b, L, W);
    for (const o of [-L / 2, 0, L / 2]) for (const q of [-W / 2, W / 2]) block(M, at, yaw, a + o, b + q, 0.25, 0.25, 0, q < 0 ? 5 : 4.2, SC.wood, CK.wood, base);
    const [x0r, z0r] = at(a - L / 2 - 0.3, b - W / 2 - 0.3), [x1r, z1r] = at(a + L / 2 + 0.3, b - W / 2 - 0.3), [x2r, z2r] = at(a + L / 2 + 0.3, b + W / 2 + 0.3), [x3r, z3r] = at(a - L / 2 - 0.3, b + W / 2 + 0.3);
    const v = [M.v(x0r, z0r, 5.1, 0, 1, 0, SC.silo, CK.metal, 0, base), M.v(x1r, z1r, 5.1, 0, 1, 0, SC.silo, CK.metal, 0, base), M.v(x2r, z2r, 4.3, 0, 1, 0, SC.silo, CK.metal, 0, base), M.v(x3r, z3r, 4.3, 0, 1, 0, SC.silo, CK.metal, 0, base)];
    M.quad(v[0], v[1], v[2], v[3]);
    if (detail) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) for (let k2 = 0; k2 < 3; k2++) if (k2 < 3 - (i % 2)) block(M, at, yaw, a - 4.2 + i * 1.6, b - 1.6 + j * 1.15, 1.5, 1.05, k2 * 0.6, k2 * 0.6 + 0.58, [0.86 - j * 0.03, 0.76, 0.46], CK.square, base);
  }
  // the yard: gravel laid over the ground between them
  if (detail) {
    const NA = 10, NB = 7, A0 = -16, A1 = 22, B0 = -3, B1 = 7, ix = [];
    for (let j = 0; j <= NB; j++) for (let i = 0; i <= NA; i++) { const a = A0 + (A1 - A0) * i / NA, b = B0 + (B1 - B0) * j / NB, [x, z] = at(a, b); ix.push(M.v(x, z, 0.04, 0, 1, 0, SC.gravel, CK.gravel, 0)); }
    for (let j = 0; j < NB; j++) for (let i = 0; i < NA; i++) { const q = j * (NA + 1) + i; M.quad(ix[q], ix[q + 1], ix[q + NA + 2], ix[q + NA + 1]); }
  }
}
