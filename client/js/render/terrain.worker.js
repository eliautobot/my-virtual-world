// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Builds island terrain tiles off the main thread (WP4.2/WP4.16): heights from the shared deterministic generator,
// normals, biome colours, skirts that hide seams between detail levels, and (for the most detailed tiles) the natural
// scatter — trees, bushes and rocks — placed by fixed rules so every visitor sees the same forest. Results are
// transferred without copies.
import { Island, CELL_M, CHUNK_M, CITY_FLOOR_DROP, lakeShore } from '/shared/terrain.js';
import { biome } from '/shared/biome.js';
import { nH21, nNoise } from './ground-noise.js';
const GRID_LAWN = [0.6, 0.69, 0.46], GRID_WALK = [0.66, 0.66, 0.64];   // sRGB of render/mats.js the city's lawn (linear 0.32, 0.44, 0.18, its middle)
import { buildCountryside, buildLandmarks, blockedGrid } from './countryside-build.js';

let island = null, P = null, plainHole = null;
const NRM_STEP = 2.4384;   // m: the canonical 8 ft cell
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hashf(x, z, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(s | 0, 0x2545f491);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// A number as a 16-bit float (the sea's depth map, render/water.js).
const H32 = new Float32Array(1), U32 = new Uint32Array(H32.buffer);
function toHalf(v) { H32[0] = v; const x = U32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff; if (e <= 0) return s; if (e >= 31) return s | 0x7c00; return s | (e << 10) | ((m + 0x1000) >>> 13); }
// sRGB byte → linear byte (vertex colours are linear in three.js).
const LIN = new Uint8Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = Math.round((c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * 255); }

// Tiles are built in two steps (2026-10-03: crossing the map took seconds on the phone): first the ground — its
// heights, normals and ground map — which is shown as soon as it arrives; then, asked for separately and nearest first,
// what stands on it — trees, grass, crops, hedges, farmsteads — which fades in. The second step reuses the first's
// heights (kept for the last few dozen tiles).
const KEPT = new Map(), KEEP = 64;
function keep(id, e) { KEPT.delete(id); KEPT.set(id, e); if (KEPT.size > KEEP) KEPT.delete(KEPT.keys().next().value); }
/** The heights over a tile and a cell beyond it ((n + 3)² samples, spacing d). */
function heightsOf(x0, z0, n, d) {
  const B = n + 3, H = new Float32Array(B * B);
  for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) H[j * B + i] = island.height(x0 + (i - 1) * d, z0 + (j - 1) * d);
  return H;
}
/** The ground's height anywhere over a tile (and a cell beyond it), world coordinates, from its height grid. */
const heightAt = (H, B, x0, z0, d) => (x, z) => {
  const gx = clamp((x - x0) / d + 1, 0, B - 1.001), gz = clamp((z - z0) / d + 1, 0, B - 1.001), i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
  const a = H[j * B + i], b = H[j * B + i + 1], c = H[(j + 1) * B + i], e = H[(j + 1) * B + i + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + e) * fx * fz;
};

function buildTile({ id, level, tx, tz, n, epoch = 0, gm = 0 }) {
  const T0 = performance.now(), ms = {};
  gm = gm || n;
  const S = CHUNK_M * 2 ** level, d = S / n, x0 = tx * S, z0 = tz * S, N = n + 1, B = n + 3;
  const H = heightsOf(x0, z0, n, d), hAtW = heightAt(H, B, x0, z0, d);
  const skirt = 4 * n, verts = N * N + skirt, pos = new Float32Array(verts * 3), nrm = new Float32Array(verts * 3);
  const hole = plainHole, low = P.plainY - CITY_FLOOR_DROP, sea = P.seaLevel;
  let minY = Infinity, maxY = -Infinity, wet = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const v = j * N + i, x = x0 + i * d, z = z0 + j * d, h = H[(j + 1) * B + i + 1];
    // the normal: on the nearer tiles from the ground a fixed small step either side (the same at a point whatever the
    // tile's detail, so neighbours of different detail light alike); on the far ones from the tile's own heights
    let nx, nz;
    if (level <= 1) { const e = NRM_STEP; nx = (island.height(x - e, z) - island.height(x + e, z)) / (2 * e); nz = (island.height(x, z - e) - island.height(x, z + e)) / (2 * e); }
    else { nx = (H[(j + 1) * B + i] - H[(j + 1) * B + i + 2]) / (2 * d); nz = (H[j * B + i + 1] - H[(j + 2) * B + i + 1]) / (2 * d); }
    const il = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    const inCity = !!hole && x > hole.x0 && x < hole.x1 && z > hole.z0 && z < hole.z1;
    const y = inCity ? low : h;
    pos[v * 3] = i * d; pos[v * 3 + 1] = y; pos[v * 3 + 2] = j * d;
    nrm[v * 3] = nx * il; nrm[v * 3 + 1] = il; nrm[v * 3 + 2] = nz * il;
    if (h < sea) wet++;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  // Skirts: the border ring copied straight down, so a coarser neighbour never shows a crack.
  const drop = Math.max(2, d * 1.5);
  let s = N * N;
  const ring = [];
  for (let i = 0; i < n; i++) ring.push(i);                       // z0 edge
  for (let j = 0; j < n; j++) ring.push(j * N + n);               // x1 edge
  for (let i = n; i > 0; i--) ring.push(n * N + i);               // z1 edge
  for (let j = n; j > 0; j--) ring.push(j * N);                   // x0 edge
  for (const v of ring) {
    pos[s * 3] = pos[v * 3]; pos[s * 3 + 1] = pos[v * 3 + 1] - drop; pos[s * 3 + 2] = pos[v * 3 + 2];
    nrm[s * 3] = nrm[v * 3]; nrm[s * 3 + 1] = nrm[v * 3 + 1]; nrm[s * 3 + 2] = nrm[v * 3 + 2];
    s++;
  }
  const out = { op: 'tile', id, epoch, level, tx, tz, n, x0, z0, minY: minY - drop, maxY, allWater: wet === N * N, pos, nrm, ms };
  ms.ground = performance.now() - T0;
  const transfer = [pos.buffer, nrm.buffer];
  // The ground's colour and its kinds of surface as a texture over the tile (2026-10-03: "I can still spot tiles"):
  // gm × gm texels whatever the tile's level, so the colours and the borders between fields, meadow, woodland and beach
  // are drawn per pixel (render/ground-detail.js) and never follow the mesh's triangles. Samples at the texels' corners
  // ((gm + 1)² of them), so neighbouring tiles share their edge samples exactly. A: colour (sRGB) + woodland; B: farm,
  // sand, wet. The kinds of ground sampled are kept for the second step (grass and flowers follow them).
  const M = gm + 1, e = S / gm, q = Math.max(e * 0.5, 1.2), kinds = new Array(M * M), lin = new Uint8Array(M * M * 3);
  const gA = new Uint8Array(M * M * 4), gB = new Uint8Array(M * M * 4);
  const roads = island.roads, verge = (x, z) => { if (!roads) return false; const nr = roads.net.nearest(x, z, 16); return !!nr && nr.dist < roads.half.get(nr.id) + 3; };
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = x0 + i * e, z = z0 + j * e, v = j * M + i, k = v * 4, h = hAtW(x, z);
    const gx = (hAtW(x + q, z) - hAtW(x - q, z)) / (2 * q), gz = (hAtW(x, z + q) - hAtW(x, z - q)) / (2 * q), ny = 1 / Math.sqrt(1 + gx * gx + gz * gz);
    let b = biome(island, x, z, h, ny), c = b.under || b.col;
    if (island._under && island.underAt(x, z)) {   // a grid's land: lawn round it; under its roads the sidewalks' grey (the
      b = { ...b, farm: 0, forest: 0, sand: 0, wet: 0 };   // road kit's seams at corners show that, as the city's asphalt does)
      c = roads && roads.top(x, z) !== null ? GRID_WALK : GRID_LAWN;
    }
    kinds[v] = b;
    const inCity = !!hole && x > hole.x0 && x < hole.x1 && z > hole.z0 && z < hole.z1;
    const farm = b.farm && !inCity && !verge(x, z) && !(island.pads && island.nearPad(x, z, 3)) ? b.farm : 0;
    const r = clamp(Math.round(c[0] * 255), 0, 255), g = clamp(Math.round(c[1] * 255), 0, 255), bl = clamp(Math.round(c[2] * 255), 0, 255);
    gA[k] = r; gA[k + 1] = g; gA[k + 2] = bl; gA[k + 3] = Math.round((b.forest || 0) * 255);
    gB[k] = Math.round(farm * 255); gB[k + 1] = Math.round((b.sand || 0) * 255); gB[k + 2] = Math.round((b.wet || 0) * 255); gB[k + 3] = 255;
    lin[v * 3] = LIN[r]; lin[v * 3 + 1] = LIN[g]; lin[v * 3 + 2] = LIN[bl];
  }
  out.gm = gm; out.gmA = gA; out.gmB = gB; transfer.push(gA.buffer, gB.buffer);
  keep(id, { H, B, d, x0, z0, S, level, kinds, lin, M, e });
  ms.map = performance.now() - T0 - ms.ground;
  ms.total = performance.now() - T0; ms.rest = 0;
  postMessage(out, transfer);
}
/** The second step: what stands on a tile — farmsteads (tiles up to level 2), crops, hedges and the scatter (level 0
 *  near the camera: scatter), or only far-off trees (level 1: distant). */
function buildDetail({ id, level, tx, tz, n, scatter, distant = false, epoch = 0, gm = 0 }) {
  const T0 = performance.now();
  let K = KEPT.get(id);
  if (!K) {   // built by another worker, or forgotten: the heights again (and the kinds of ground where grass may grow)
    const S = CHUNK_M * 2 ** level, d = S / n, x0 = tx * S, z0 = tz * S, H = heightsOf(x0, z0, n, d);
    K = { H, B: n + 3, d, x0, z0, S, level };
    if (scatter) {
      const M = (gm || n) + 1, e = S / (M - 1), hAtW = heightAt(H, n + 3, x0, z0, d), kinds = new Array(M * M), lin = new Uint8Array(M * M * 3);
      for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { const x = x0 + i * e, z = z0 + j * e, v = j * M + i, b = biome(island, x, z, hAtW(x, z), 0.95), c = b.under || b.col; kinds[v] = b; for (let k = 0; k < 3; k++) lin[v * 3 + k] = LIN[clamp(Math.round(c[k] * 255), 0, 255)]; }
      Object.assign(K, { kinds, lin, M, e });
    }
  }
  const { H, B, d, x0, z0, S } = K, hAtW = heightAt(H, B, x0, z0, d), out = { op: 'detail', id, epoch }, transfer = [];
  // farmsteads: seen from afar too (simple blocks on the coarser tiles), in full on the nearest
  let lmTrees = null;
  if (level <= 2) {
    const lm = buildLandmarks(island, x0, z0, S, hAtW, level === 0);
    if (lm?.mesh) { out.lm = lm.mesh; for (const v of Object.values(lm.mesh)) transfer.push(v.buffer); }
    lmTrees = lm?.trees || null;
  }
  if (scatter) {
    // the countryside's standing detail: crops, hedges, fences, walls, bales (render/countryside-build.js)
    const blocked = blockedGrid(island, hAtW);
    const cs = buildCountryside(island, x0, z0, S, hAtW, blocked);
    if (cs?.mesh) { out.cs = cs.mesh; for (const v of Object.values(cs.mesh)) transfer.push(v.buffer); }
    if (cs?.small) { out.css = cs.small; for (const v of Object.values(cs.small)) transfer.push(v.buffer); }
    const sc = buildScatter(x0, z0, S, H, B, d, [...(cs?.trees || []), ...(lmTrees || [])], { kinds: K.kinds, col: K.lin, N: K.M, e: K.e, blocked, hAt: hAtW });
    out.hab = sc.hab; delete sc.hab; out.scatter = sc; for (const v of Object.values(sc)) transfer.push(v.p.buffer, v.c.buffer, v.v.buffer);
  } else if (distant) {
    // a coarser tile further off: its trees only, on the same world grid as the near tiles' (the forest carries on),
    // thinned on the coarser levels (treeLevel)
    const sc = buildScatter(x0, z0, S, H, B, d, lmTrees, null, true, Math.max(1, level));
    delete sc.hab; out.scatter = sc; for (const v of Object.values(sc)) transfer.push(v.p.buffer, v.c.buffer, v.v.buffer);
  }
  out.ms = performance.now() - T0;
  postMessage(out, transfer);
}

// The flower drifts' noise, as the ground shader draws it (render/ground-detail.js gH21/gNoise), so the flowers stand
// where the ground shows them.
const fr = v => v - Math.floor(v);
let noiseTex = false;   // (render flag 'noise': the shader looks its randomness up in a texture — render/ground-noise.js)
function gH21(px, py) {
  if (noiseTex) return nH21(px, py);
  let x = fr(px * 0.1031), y = fr(py * 0.1031), z = fr(px * 0.1031); const q = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33); x += q; y += q; z += q; return fr((x + y) * z); }
function gNoise(px, py) {
  if (noiseTex) return nNoise(px, py);
  const ix = Math.floor(px), iy = Math.floor(py); let fx = px - ix, fy = py - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = gH21(ix, iy), b = gH21(ix + 1, iy), c = gH21(ix, iy + 1), e = gH21(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
}
const mixv = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const FLOWER = { red: [0.9, 0.1, 0.06], yellow: [1, 0.82, 0.08], blue: [0.3, 0.42, 0.95], purple: [0.72, 0.3, 0.85], white: [0.97, 0.96, 0.9] };
const lin1 = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const TAU_W = Math.PI * 2;

// The reefs (2026-10-04): where the sea floor is 2.4–12 m down, reef sections tens to a couple of hundred metres
// across (slow noise), sand channels running through them (spur and groove), the reef's edge thinning out. 0..1.
const REEF_KINDS = ['coralBranch', 'coralBrain', 'coralTable', 'coralFan', 'coralTube'];
// per kind: its model's height at scale 1 (m), the scale range, the colours its colonies come in (linear multipliers)
// (the colours strong: seen through metres of water they lose their reds — render/water.js underwater); w: its share
const REEF = [
  { kind: 'coralBranch', w: 0.3, h: 0.85, sc: [1.3, 2.4], tint: [[1.3, 1.1, 0.85], [0.85, 0.4, 3.2], [1.6, 0.7, 2.4], [0.65, 0.85, 4.2], [0.75, 1.0, 0.8]] },   // tan, violet, pink, lilac, olive
  { kind: 'coralBrain', w: 0.22, h: 0.62, sc: [1.0, 2.2], tint: [[0.55, 1.1, 1.0], [1.2, 0.75, 0.55], [1.3, 1.15, 0.55], [1.05, 0.62, 2.4], [0.85, 0.9, 0.75]] },   // green, rust, mustard, mauve, brown
  { kind: 'coralTable', w: 0.12, h: 0.75, sc: [0.9, 1.6], tint: [[1.35, 0.95, 0.8], [0.65, 0.95, 2.4], [1.25, 0.65, 2.6]] },   // tan, blue-grey, purple
  { kind: 'coralFan', w: 0.18, h: 1.25, sc: [0.9, 1.5], tint: [[1.4, 1.0, 1.5], [2.6, 1.4, 0.35], [2.0, 0.7, 1.2], [0.9, 0.9, 1.6]] },   // purple, red, magenta, violet
  { kind: 'coralTube', w: 0.18, h: 1.4, sc: [0.8, 1.5], tint: [[1.4, 1.2, 1.0], [1.6, 1.0, 0.8], [1.1, 1.0, 1.5]] },
];
const reefPick = u => { let a = 0; for (let k = 0; k < REEF.length; k++) { a += REEF[k].w; if (u < a) return k; } return REEF.length - 1; };
// (the section as a whole, its sand channels included: the sea is drawn clearer over it — the depth map's second channel)
function reefZone(x, z, dep) {
  const patch = sstep(0.55, 0.66, gNoise(x * 0.0042 + 31, z * 0.0042 - 17) * 0.65 + gNoise(x * 0.011 - 5, z * 0.011 + 8) * 0.35);
  return patch <= 0 ? 0 : patch * sstep(2.4, 3.6, dep) * (1 - sstep(10, 12.5, dep));
}
function reefAt(x, z, dep) {
  const zone = reefZone(x, z, dep);
  return zone <= 0 ? 0 : zone * sstep(0.05, 0.15, Math.abs(gNoise(x * 0.045 + 3, z * 0.045 - 2) * 2 - 1));
}

// Natural scatter for a full-detail tile: a jittered 6 m grid, each point drawing from its biome's species (trees, firs,
// bushes, boulders); and, on a finer grid, grass tufts and wild flowers (their colours from the ground and the flower
// drifts). Per instance: x, y, z (world), yaw, scale; and a colour (linear).
// Each tree's coarsest tile level (1-3): every tree stands on the level-1 tiles (and the full-detail ones); one in 4 of
// them on level 2, one in 16 on level 3 — the same trees, picked by a hash of their grid cell, so a forest seen from a
// kilometre off thins out with distance instead of ending (2026-10-04: none past ~1 km), and none moves when its area
// is refined; the client keeps those already standing and fades in only the rest (render/terrain.js fillKind).
const treeLevel = h => (h < 1 / 16 ? 3 : h < 1 / 4 ? 2 : 1);
function buildScatter(x0, z0, S, H, B, d, extraTrees = null, T = null, distant = false, thin = 1) {
  const KINDS = ['tree', 'tree2', 'birch', 'conifer', 'bush', 'rock', 'grass', 'flower', 'reed', 'lily', 'seagrass', 'boulder', 'pebbles', ...REEF_KINDS, 'palm'], step = 6.1;
  const lists = Object.fromEntries(KINDS.map(k => [k, []])), cols = Object.fromEntries(KINDS.map(k => [k, []])), levs = Object.fromEntries(KINDS.map(k => [k, []]));
  const TREES = new Set(['tree', 'tree2', 'birch', 'conifer']);
  let cell = 0.5;   // (the hash of the grid cell, or hedgerow tree, being placed: its tree level)
  const put = (k, lx, y, lz, yaw, sc, c) => {
    const tree = TREES.has(k), lv = tree ? treeLevel(cell) : 0;
    if (distant && (!tree || lv < thin)) return;
    lists[k].push(x0 + lx, y, z0 + lz, yaw, sc); cols[k].push(c[0], c[1], c[2]); levs[k].push(lv);
  };
  const leafTint = t => [0.82 + t * 0.3, 0.88 + t * 0.22, 0.82 + (1 - t) * 0.28], stoneTint = t => [0.85 + t * 0.3, 0.85 + t * 0.28, 0.83 + t * 0.26];
  // Habitat samples for wildlife (WP4.17, render/wildlife.js): a few points per kind of ground, chosen by the seed.
  const hab = { forest: [], meadow: [], field: [], beach: [], shore: [], rock: [], reef: [], sea: [] }, HAB_MAX = 24;
  const habAt = (kind, x, h, z, r) => { const L = hab[kind]; if (L && L.length < HAB_MAX * 3 && r > 0.82) L.push(x, h, z); };
  const hAt = (lx, lz) => { const gx = lx / d + 1, gz = lz / d + 1, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const a = H[j * B + i], b = H[j * B + i + 1], c = H[(j + 1) * B + i], e = H[(j + 1) * B + i + 1]; return a + (b - a) * fx + (c - a) * fz + (a - b - c + e) * fx * fz; };
  // one grid over the whole world (cells of `step` m, a point jittered in each): every tile, of any size, takes the
  // points inside it, so neighbouring tiles neither miss nor double a tree along their edge
  const gx0 = Math.floor(x0 / step) - 1, gz0 = Math.floor(z0 / step) - 1, gx1 = Math.floor((x0 + S) / step), gz1 = Math.floor((z0 + S) / step);
  for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
    const r = hashf(gx, gz, 1301), jx = hashf(gx, gz, 1303), jz = hashf(gx, gz, 1307);
    const x = (gx + jx) * step, z = (gz + jz) * step;
    cell = hashf(gx, gz, 1331);
    if (x < x0 || x >= x0 + S || z < z0 || z >= z0 + S) continue;
    const lx = x - x0, lz = z - z0;
    if ((P.cityStreets !== null && island.cityDist(x, z) < 22) || nearHole(x, z, 14)) continue;   // (no city, cityStreets null: the plain grows like any land)   // the city's streets and sidewalks out to its edge, and a margin (2026-10-03: trees on the widened city's corners)
    if (island.roads) { const nr = island.roads.net.nearest(x, z, 12); if (nr && nr.dist < island.roads.half.get(nr.id) + 2.5) continue; }   // roads and their verges
    if (island.pads && island.nearPad(x, z, 2)) continue;   // buildings beyond the city and their yards
    const cover = island.edits ? island.edits.cover(x, z) : null;   // woodland cleared or planted (WP4.7)
    if (cover === 'clear') continue;
    const h = hAt(lx, lz);
    // the sea floor: the reefs' corals are laid out below (reefAt, on their own finer grid); stones here and there on
    // the sand between them; the reef's fish and turtles live over the reefs (render/wildlife.js)
    const dep = P.seaLevel - h;
    if (dep > 0.7 && dep < 14 && !distant) {
      if (dep > 7) habAt('sea', x, h, z, hashf(gx, gz, 1321));   // (open water from 7 m: the dolphins' places — over the outer reef too)
      if (reefAt(x, z, dep) > 0.3) habAt('reef', x, h, z, hashf(gx, gz, 1319));
      else if (dep < 9 && r < 0.025) put('rock', lx, h - 0.25, lz, r * 6.283, 0.5 + jx * 1.2, stoneTint(jz));
      continue;
    }
    if (dep > 0.7) { if (dep < 60 && !distant) habAt('sea', x, h, z, hashf(gx, gz, 1321)); continue; }   // (open water: the dolphins' places)
    if (h < P.seaLevel + 1.2) continue;
    const hk = hashf(gx, gz, 1319), bh = hashf(gx, gz, 1323), broad = bh < 0.3 ? 'tree2' : bh < 0.45 ? 'birch' : 'tree';
    const hx = hAt(Math.min(S, lx + 1), lz) - h, hz = hAt(lx, Math.min(S, lz + 1)) - h, ny = 1 / Math.sqrt(hx * hx + 1 + hz * hz);
    if (ny < 0.8) { habAt('rock', x, h, z, hk); if (r < 0.04) put('rock', lx, h - 0.2, lz, r * 6.283, 0.6 + jx * 1.6, stoneTint(jz)); continue; }
    let b = biome(island, x, z, h, ny);
    if (cover === 'plant' && b.kind !== 'water' && b.kind !== 'shore' && b.kind !== 'beach' && b.kind !== 'snow') b = { ...b, kind: 'forest', density: 1 };
    habAt(b.kind === 'conifer' ? 'forest' : b.kind === 'lawn' ? 'meadow' : b.kind === 'hedge' ? 'field' : b.kind === 'snow' ? 'rock' : b.kind === 'crop' ? 'field' : b.kind, x, h, z, hk);
    if (b.kind === 'lawn') { if (r < 0.012) put(broad, lx, h - 0.1, lz, jx * 6.283, 0.85 + jz * 0.5, leafTint(r * 40)); continue; }   // parkland around the city
    // palms (2026-10-04: "add palms so that the beach areas look the part"): in groves along the beaches and the
    // meadows just behind them, leaning a little toward the sea, a few on their own
    if (b.kind === 'beach' || (b.kind === 'meadow' && (b.sand || 0) > 0.15)) {
      const grove = sstep(0.45, 0.7, gNoise(x * 0.02 + 41, z * 0.02 - 13));
      if (h > P.seaLevel + 1.6 && r < 0.02 + 0.3 * grove) { put('palm', lx, h - 0.15, lz, jx * 6.283, 0.8 + jz * 0.55, leafTint(0.3 + jx * 0.5)); continue; }
      if (b.kind === 'beach') continue;
    }
    if (b.kind === 'water' || b.kind === 'shore' || b.kind === 'field' || b.kind === 'crop' || b.kind === 'beach' || b.kind === 'snow' || b.kind === 'hedge') continue;
    if (b.kind === 'forest' || b.kind === 'conifer') {
      if (r < 0.62 * (0.4 + 0.6 * (b.density ?? 1))) put(b.kind === 'conifer' || hashf(gx, gz, 1311) < sstep(60, 200, h) * 0.8 ? 'conifer' : broad, lx, h - 0.1, lz, jx * 6.283, 0.75 + jz * 0.6, leafTint(r / 0.62));
      else if (r < 0.75) put('bush', lx, h - 0.05, lz, jx * 6.283, 0.6 + jz * 0.7, leafTint(jx));
    } else if (b.kind === 'rock') { if (r < 0.05) put('rock', lx, h - 0.2, lz, r * 6.283, 0.5 + jx * 1.4, stoneTint(jz)); else if (r < 0.065) put('boulder', lx, h - 0.5, lz, r * 6.283, 1.2 + jx * 1.4, stoneTint(jz)); else if (r < 0.09) put('pebbles', lx, h - 0.05, lz, r * 6.283, 0.8 + jx * 0.8, stoneTint(jz)); }
    else if (r < 0.035) put(broad, lx, h - 0.1, lz, jx * 6.283, 0.8 + jz * 0.55, leafTint(r / 0.035));
    else if (r < 0.08) put('bush', lx, h - 0.05, lz, jx * 6.283, 0.55 + jz * 0.6, leafTint(jx));
    else if (r < 0.088) put('rock', lx, h - 0.15, lz, r * 6.283, 0.35 + jx * 0.8, stoneTint(jz));
  }
  // trees standing in the hedgerows
  if (extraTrees) for (let i = 0; i < extraTrees.length; i += 4) { const t = extraTrees[i + 3]; cell = (t * 7.13 + 0.17) % 1; put(t < 0.3 ? 'tree2' : 'tree', extraTrees[i] - x0, extraTrees[i + 1], extraTrees[i + 2] - z0, t * 6.283, 0.85 + t * 0.45, leafTint(t)); }
  // the reefs (2026-10-04): sections of reef — big colonies packed close, a few kinds each in zones of their own,
  // sand channels running through, nothing shallow enough to break the surface (each colony's top a metre or more under)
  if (!distant) {
    const rs = 2.3;
    for (let gz = Math.floor(z0 / rs) - 1; gz <= Math.floor((z0 + S) / rs); gz++) for (let gx = Math.floor(x0 / rs) - 1; gx <= Math.floor((x0 + S) / rs); gx++) {
      const x = (gx + hashf(gx, gz, 1601)) * rs, z = (gz + hashf(gx, gz, 1603)) * rs;
      if (x < x0 || x >= x0 + S || z < z0 || z >= z0 + S) continue;
      const hh = hAt(x - x0, z - z0), dep = P.seaLevel - hh; if (dep < 2.2 || dep > 13) continue;
      if (island.pads && island.nearPad(x, z, 4)) continue;   // (not in a dock's dredged basin)
      const st = reefAt(x, z, dep), u = hashf(gx, gz, 1605); if (u > st * 0.9) continue;
      const zone = reefPick(fr((gNoise(x * 0.016 + 11, z * 0.016 - 4) + gNoise(x * 0.041 - 7, z * 0.041 + 3) * 0.45) * 3.1));
      const k = hashf(gx, gz, 1607) < 0.7 ? zone : reefPick(hashf(gx, gz, 1609)), R = REEF[k];
      let sc = R.sc[0] + (R.sc[1] - R.sc[0]) * hashf(gx, gz, 1611);
      sc = Math.min(sc, (dep - 1.1) / R.h); if (sc < R.sc[0] * 0.6) continue;
      const tv = hashf(gx, gz, 1613), tint = R.tint[Math.floor(tv * R.tint.length)].map((c, q) => c * (0.88 + 0.24 * hashf(gx, gz, 1615 + q)));
      put(R.kind, x - x0, hh - 0.06, z - z0, hashf(gx, gz, 1617) * 6.283, sc, tint);
    }
  }
  // grass tufts and wild flowers, from the ground already worked out for the tile's vertices (kind, colour)
  if (T && !distant) {
    const { kinds, col, N, e: ge, blocked } = T, gs = 0.9;
    // a world grid again: no seam of missing grass along the tiles' edges
    for (let gz = Math.floor(z0 / gs) - 1; gz <= Math.floor((z0 + S) / gs); gz++) for (let gx = Math.floor(x0 / gs) - 1; gx <= Math.floor((x0 + S) / gs); gx++) {
      const r = hashf(gx, gz, 1401), x = (gx + hashf(gx, gz, 1403)) * gs, z = (gz + hashf(gx, gz, 1405)) * gs;
      if (x < x0 || x >= x0 + S || z < z0 || z >= z0 + S) continue;
      const lx = x - x0, lz = z - z0;
      const vi = Math.min(N - 1, Math.round(lx / ge)), vj = Math.min(N - 1, Math.round(lz / ge)), v = vj * N + vi, b = kinds[v];
      if (b.kind === 'water') {
        // sea grass in meadows on the shallow sand
        const hh = hAt(lx, lz), dep = P.seaLevel - hh;
        if (dep > 0.5 && dep < 5 && reefAt(x, z, dep) < 0.2 && !(island.pads && island.nearPad(x, z, 2)) && r < 0.5 * sstep(0.5, 0.68, gNoise(x * 0.03 - 5, z * 0.03 + 11)) * (1 - sstep(3.5, 5, dep))) put('seagrass', lx, hh - 0.03, lz, r * 6.283, 0.7 + 0.5 * hashf(gx, gz, 1409), [0.09 + 0.05 * hashf(gx, gz, 1411), 0.24 + 0.08 * hashf(gx, gz, 1413), 0.08]);   // (linear: a fresh sea-grass green)
        continue;
      }
      let p = 0, sc = 0.6;
      if (b.kind === 'meadow') { p = 0.72 * (1 - (b.sand || 0)); sc = 0.55 + 0.4 * r; }
      else if (b.kind === 'lawn') { p = 0.35; sc = 0.3; }
      else if (b.kind === 'field') { if (b.crop === undefined) { p = 0.7; sc = 0.65 + 0.35 * r; } else if (b.crop === 6) { p = 0.45; sc = 0.38; } }
      else if (b.kind === 'forest' || b.kind === 'conifer') { p = 0.1; sc = 0.4; }
      if (p <= 0 || hashf(gx, gz, 1407) > p || blocked(x, z)) continue;
      // the ground's own soft variation where it stands (render/ground-detail.js meadow), so a tuft matches the grass round it
      const h = hAt(lx, lz), k = (0.92 + 0.12 * hashf(gx, gz, 1409)) * (0.93 + 0.12 * gNoise(x * 0.012 + 3, z * 0.012 - 7) + 0.06 * gNoise(x * 0.05 + 1, z * 0.05 + 2));
      const gc = [col[v * 3] / 255 * k * 0.98, col[v * 3 + 1] / 255 * k * 1.04, col[v * 3 + 2] / 255 * k * 0.9];
      // flowers in the drifts the ground draws, a few here and there elsewhere; poppies and cornflowers by the fields
      const meadow = b.kind === 'meadow', patchN = gNoise(x * 0.035 + 17, z * 0.035 - 9) * 0.7 + gNoise(x * 0.11 + 3, z * 0.11 + 3) * 0.3;
      const drift = meadow ? sstep(0.58, 0.8, patchN) * (1 - (b.forest || 0)) : 0;
      const fp = meadow ? 0.03 + 0.6 * drift : b.kind === 'field' && b.crop === undefined ? 0.08 : 0;
      if (fp > 0 && hashf(gx, gz, 1411) < fp) {
        let fc;
        if (meadow) {
          const k1 = gNoise(x * 0.009 + 5, z * 0.009 + 5), k2 = gNoise(x * 0.013 - 11, z * 0.013 - 11), s1 = sstep(0.35, 0.65, k1);
          fc = mixv(mixv(FLOWER.red, FLOWER.yellow, s1), mixv(FLOWER.blue, FLOWER.purple, s1), sstep(0.4, 0.7, k2));
          if (hashf(gx, gz, 1413) > 0.8) fc = FLOWER.white;
        } else fc = hashf(gx, gz, 1413) < 0.6 ? FLOWER.red : FLOWER.blue;
        put('flower', lx, h - 0.02, lz, r * 6.283, 0.8 + 0.5 * hashf(gx, gz, 1415), fc.map(lin1));
      } else put('grass', lx, h - 0.02, lz, r * 6.283, sc, gc);
    }
  }
  // by the water: boulders in and beside the rivers (more where they run fast), reeds in their calm reaches and round
  // the lakes' shores
  const inT = (x, z) => x >= x0 && x < x0 + S && z >= z0 && z < z0 + S;
  const onRoad = (x, z) => { if (!island.roads) return false; const nr = island.roads.net.nearest(x, z, 14); return !!nr && nr.dist < island.roads.half.get(nr.id) + 2; };
  // (none of it in a waterfall's plunge pool: its own rocks are round its shore, below)
  const pools = (island.lakes || []).filter(K => K.pool), inPool = (x, z) => pools.some(K => (x - K.x) ** 2 + (z - K.z) ** 2 < (K.r * 1.08) ** 2);
  const belowFall = (x, z) => pools.some(K => (x - K.x) ** 2 + (z - K.z) ** 2 < (K.r * 2.8) ** 2);   // (the churned water out of a pool: no reeds)
  // Where a fall's water runs and falls (2026-10-03: "the water falls over the rocks, not through them"): its
  // channel over the last metres to the lip, the ledge, and the air it falls through down to where it lands — no stone
  // there. (Its landing: render/rivers.js throws it out at d.v from the ledge's edge d.ov.)
  const fallZones = [];
  for (const R of island.rivers || []) for (const d of R.drops || []) if (d.kind === 'fall') fallZones.push({ d, land: d.ov + d.v * Math.sqrt(2 * d.F / 9.81) + 2, half: d.w / 2 + 3 + d.F * 0.07 });
  const inFall = (x, z) => fallZones.some(({ d, land, half }) => { const f = (x - d.x) * d.dx + (z - d.z) * d.dz, l = Math.abs(-(x - d.x) * d.dz + (z - d.z) * d.dx); return f > -14 && f < land + 4 && l < half; });
  if (!distant) for (const R of island.rivers || []) for (let k = 0; k + 1 < R.pts.length; k++) {
    const a = R.pts[k], b = R.pts[k + 1], onSteps = (R.drops || []).some(d => d.kind === 'cascade' && k >= d.i - 1 && k <= d.j);   // (a cascade's steps: its own rocks, below; no reeds)
    if (Math.max(a.x, b.x) < x0 - 30 || Math.min(a.x, b.x) > x0 + S + 30 || Math.max(a.z, b.z) < z0 - 30 || Math.min(a.z, b.z) > z0 + S + 30) continue;
    const L = Math.hypot(b.x - a.x, b.z - a.z), dx = (b.x - a.x) / L, dz = (b.z - a.z) / L, slope = (a.y - b.y) / L;
    for (let t = 0; t < L; t += 1.6) {
      const f = t / L, cx = a.x + (b.x - a.x) * f, cz = a.z + (b.z - a.z) * f, w = a.w + (b.w - a.w) * f, lvl = a.y + (b.y - a.y) * f, si = Math.floor(R.pts[k].s + t);
      const hr = hashf(si, k, 1501);
      if (hr < 0.1 + Math.min(0.3, slope * 6)) {
        // in the shallows near either bank (the bed is shallow there) or up on the bank: pebbles and small stones most
        // often, rocks, now and then a big boulder half in the water (more of all where it runs fast)
        const side = hashf(si, k, 1509) < 0.5 ? -1 : 1, o = side * w / 2 * (0.5 + hashf(si, k, 1503) * 0.8), x = cx - dz * o, z = cz + dx * o, u = hashf(si, k, 1505);
        if (inT(x, z) && !onRoad(x, z) && !inPool(x, z) && !inFall(x, z)) {
          const g = hAt(x - x0, z - z0), tint = stoneTint(hashf(si, k, 1507));
          if (u < 0.5) put('pebbles', x - x0, g - 0.04, z - z0, hr * 40, 0.7 + u * 0.9, tint);
          else if (u < 0.86) put('rock', x - x0, g - 0.12, z - z0, hr * 40, 0.4 + (u - 0.5) * 2.2, tint);
          else put('boulder', x - x0, g - 0.45, z - z0, hr * 40, 1.3 + (u - 0.86) * 8, tint);
        }
      }
      if (slope < 0.012 && !onSteps) for (const side of [-1, 1]) {
        if (hashf(si, k + side, 1511) > 0.55) continue;
        const o = side * (w / 2 - 0.2 + hashf(si, k + side, 1513) * 1.6), x = cx - dz * o, z = cz + dx * o;
        if (inT(x, z) && !onRoad(x, z) && !belowFall(x, z)) put('reed', x - x0, Math.max(lvl - 0.25, hAt(x - x0, z - z0)) - 0.05, z - z0, hashf(si, side, 1515) * 6.283, 0.7 + hashf(si, side, 1517) * 0.5, [0.9 + hashf(si, side, 1519) * 0.2, 0.95, 0.85]);
      }
    }
  }
  // the cascades (2026-10-03: "small drops ... should be more rocky"): boulders and rocks crowding their steps, on
  // both banks and standing in the white water at its edges, the water tumbling between them
  if (!distant) for (const R of island.rivers || []) for (const d of R.drops || []) {
    if (d.kind !== 'cascade') continue;
    const P = R.pts, A = P[d.i], E = P[d.j];
    if (Math.max(A.x, E.x) < x0 - 40 || Math.min(A.x, E.x) > x0 + S + 40 || Math.max(A.z, E.z) < z0 - 40 || Math.min(A.z, E.z) > z0 + S + 40) continue;
    for (let k = d.i; k < d.j; k++) {
      const a = P[k], b = P[k + 1], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      // the head of each step (where its water drops): a rough sill of big rocks across it, gaps where the water pours
      if ((k - d.i) % 2 === 0) for (let c = -1.3; c <= 1.31; c += 0.38) {
        const si = Math.floor(a.s * 5 + c * 11), hr = hashf(si, k, 1571); if (Math.abs(c) < 0.9 && hr < 0.45) continue;
        const o = c * a.w / 2, x = a.x - uz * o + ux * (hashf(si, k, 1573) - 0.5), z = a.z + ux * o + uz * (hashf(si, k, 1573) - 0.5);
        if (!inT(x, z) || onRoad(x, z)) continue;
        put('boulder', x - x0, hAt(x - x0, z - z0) - 0.35, z - z0, hr * 40, (Math.abs(c) > 1 ? 1.8 : 1.1) + hashf(si, k, 1575) * 1.6, stoneTint(hashf(si, k, 1577) * 0.5).map(v => v * 0.7));
      }
      for (let t = 0; t < L; t += 1.1) {
        const si = Math.floor(a.s * 3 + t * 3), hr = hashf(si, k, 1561); if (hr > 0.85) continue;
        const side = hashf(si, k, 1563) < 0.5 ? -1 : 1, o = side * (a.w / 2 * (0.45 + hashf(si, k, 1565) * 1.3)), x = a.x + ux * t - uz * o, z = a.z + uz * t + ux * o, u = hashf(si, k, 1567);
        if (!inT(x, z) || onRoad(x, z)) continue;
        const g = hAt(x - x0, z - z0), tint = stoneTint(hashf(si, k, 1569) * 0.5).map(v => v * 0.7);
        if (u < 0.42) put('boulder', x - x0, g - 0.4, z - z0, hr * 40, 1.2 + u * 5.5, tint);
        else if (u < 0.85) put('rock', x - x0, g - 0.12, z - z0, hr * 40, 0.8 + (u - 0.42) * 3.5, tint);
        else put('pebbles', x - x0, g - 0.04, z - z0, hr * 40, 1 + u, tint);
      }
    }
  }
  if (!distant) for (const K of island.lakes || []) {
    if (K.frozen) continue;   // no reeds round the ice
    if (K.x + K.r * 1.2 < x0 || K.x - K.r * 1.2 > x0 + S || K.z + K.r * 1.2 < z0 || K.z - K.r * 1.2 > z0 + S) continue;
    if (K.pool) {
      // a waterfall's plunge pool (2026-10-03, the photo): dark wet rocks and boulders round its water, in it and on
      // its ledges, a few big ones where the river leaves; no reeds or lilies in the churned water
      const n = Math.floor(TAU_W * K.r / 1.1);
      for (let q = 0; q < n; q++) {
        const hq = hashf(q, Math.floor(K.x), 1541); if (hq > 0.62) continue;
        const a = q / n * TAU_W + hashf(q, 2, 1543) * 0.1, rr = K.r * lakeShore(K, a) * (0.88 + hashf(q, 3, 1545) * 0.3), x = K.x + Math.cos(a) * rr, z = K.z + Math.sin(a) * rr;
        if (!inT(x, z) || onRoad(x, z) || inFall(x, z)) continue;
        const h = hAt(x - x0, z - z0); if (h > K.level + 2.5) continue;
        const u = hashf(q, 5, 1547), tint = stoneTint(0.15 + hashf(q, 7, 1549) * 0.25).map(v => v * 0.62), y = Math.max(h, K.level - 1.2);   // (wet: dark)
        if (u < 0.45) put('boulder', x - x0, y - 0.5, z - z0, hq * 40, 1.4 + u * 5, tint);
        else if (u < 0.85) put('rock', x - x0, y - 0.15, z - z0, hq * 40, 0.8 + (u - 0.45) * 3, tint);
        else put('pebbles', x - x0, y - 0.04, z - z0, hq * 40, 1 + u, tint);
      }
      continue;
    }
    const n = Math.floor(TAU_W * K.r / 1.4);
    for (let q = 0; q < n; q++) {
      if (hashf(q, Math.floor(K.x), 1521) > 0.5) continue;
      const a = q / n * TAU_W, rr = K.r * lakeShore(K, a) * (1.12 + hashf(q, 3, 1523) * 0.14), x = K.x + Math.cos(a) * rr, z = K.z + Math.sin(a) * rr;
      if (!inT(x, z) || onRoad(x, z)) continue;
      const h = hAt(x - x0, z - z0); if (h > K.level + 0.6 || h < K.level - 0.8) continue;
      put('reed', x - x0, Math.max(h, K.level - 0.3) - 0.05, z - z0, a * 3.1, 0.7 + hashf(q, 5, 1525) * 0.5, [0.9 + hashf(q, 7, 1527) * 0.2, 0.95, 0.85]);
    }
    // lily pads in clusters over the shallows, some lakes' flowers white, others pink
    const pink = hashf(Math.floor(K.x), Math.floor(K.z), 1531) < 0.5, nl = Math.floor(TAU_W * K.r / 3);
    for (let q = 0; q < nl; q++) {
      if (gNoise(q * 0.13 + K.x * 0.01, K.z * 0.01) < 0.55) continue;
      const a = q / nl * TAU_W + hashf(q, 9, 1533) * 0.05, rr = K.r * lakeShore(K, a) * (0.78 + hashf(q, 11, 1535) * 0.16), x = K.x + Math.cos(a) * rr, z = K.z + Math.sin(a) * rr;
      if (!inT(x, z) || onRoad(x, z)) continue;
      const fl = pink ? [1, 0.62, 0.78] : [1, 1, 0.96];
      put('lily', x - x0, K.level + 0.015, z - z0, hashf(q, 13, 1537) * 6.283, 0.8 + hashf(q, 15, 1539) * 0.6, [fl[0], fl[1], fl[2]]);
    }
  }
  const out = {};
  for (const k of Object.keys(lists)) out[k] = { p: new Float32Array(lists[k]), c: new Float32Array(cols[k]), v: new Uint8Array(levs[k]) };
  out.hab = hab;
  return out;
}

/**
 * A map picture of an area (the minimap's island view): biome colours (2 × 2 samples per pixel, so field patterns blend
 * instead of aliasing) with hill shading, the sea by depth, lakes; RGBA (sRGB, for a 2D canvas), w × h pixels over
 * [x0, x1] × [z0, z1]. Built a few rows at a time so terrain tiles requested meanwhile aren't held up.
 */
function buildMap({ id, x0, z0, x1, z1, w, h }) {
  const px = new Uint8ClampedArray(w * h * 4), dx = (x1 - x0) / w, dz = (z1 - z0) / h, LAKE = [0.2, 0.42, 0.56];
  const row0 = new Float32Array(w + 1), row1 = new Float32Array(w + 1), ROWS = 8;
  for (let i = 0; i <= w; i++) row0[i] = island.height(x0 + i * dx, z0);
  let j = 0;
  const slice = () => {
    try {
      for (const end = Math.min(h, j + ROWS); j < end; j++) {
        for (let i = 0; i <= w; i++) row1[i] = island.height(x0 + i * dx, z0 + (j + 1) * dz);
        for (let i = 0; i < w; i++) {
          const x = x0 + (i + 0.5) * dx, z = z0 + (j + 0.5) * dz, hh = (row0[i] + row0[i + 1] + row1[i] + row1[i + 1]) / 4;
          // slope from the cell's corners: hill shading lit from the north-west, and the biome's "flatness"
          const gx = ((row0[i + 1] + row1[i + 1]) - (row0[i] + row1[i])) / (2 * dx), gz = ((row1[i] + row1[i + 1]) - (row0[i] + row0[i + 1])) / (2 * dz);
          const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz), wet = island.waterAt(x, z);
          let r = 0, g = 0, b = 0, shade = 1;
          if (wet && wet.kind === 'lake') [r, g, b] = LAKE;
          else {
            for (const [ox, oz] of SS) { const c = biome(island, x + ox * dx, z + oz * dz, hh, ny).col; r += c[0] / 4; g += c[1] / 4; b += c[2] / 4; }
            if (!wet) shade = clamp(1 + (-gx - gz) * 0.9 * Math.min(1, dx / 8), 0.62, 1.3);
          }
          const o = (j * w + i) * 4;
          px[o] = r * shade * 255; px[o + 1] = g * shade * 255; px[o + 2] = b * shade * 255; px[o + 3] = 255;
        }
        row0.set(row1);
      }
      if (j < h) setTimeout(slice, 0);
      else postMessage({ op: 'map', id, w, h, px }, [px.buffer]);
    } catch (err) { postMessage({ op: 'error', id, error: String(err && err.stack || err) }); }
  };
  slice();
}
const SS = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
/** Whether (x, z) is within m metres of the city's own ground (its road edge, plainHole). */
function nearHole(x, z, m) { const h = plainHole; if (!h) return false; const dx = Math.max(h.x0 - x, 0, x - h.x1), dz = Math.max(h.z0 - z, 0, z - h.z1); return dx * dx + dz * dz < m * m; }

self.onmessage = e => {
  const m = e.data;
  try {
    if (m.op === 'init') {
      noiseTex = !!m.noiseTex;
      island = new Island(m.params, { roads: m.roads, pads: m.pads, bridgesAsGround: false }); P = island.p; plainHole = m.hole;   // water shows under bridges
      postMessage({ op: 'ready', lakes: island.lakes });
    } else if (m.op === 'ground') { island = new Island(m.params || P, { roads: m.roads, pads: m.pads, bridgesAsGround: false }); P = island.p; KEPT.clear(); }   // roads, building pads or terrain strokes changed
    else if (m.op === 'tile') buildTile(m);
    else if (m.op === 'detail') buildDetail(m);
    else if (m.op === 'depth') {
      // Water depth (m) around a point, n × n over size m, two half floats per sample: the depth (signed: the beach above
      // the sea too, the surf runs up it) and how much of a reef section is there (0..1: the sea is clearer over it) —
      // render/water.js.
      const { id, x0, z0, size, n } = m, px = new Uint16Array(n * n * 2), d = size / (n - 1), sea = P.seaLevel;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = x0 + i * d, z = z0 + j * d, dep = sea - island.height(x, z), k = (j * n + i) * 2;
        px[k] = toHalf(Math.max(-4, Math.min(60, dep))); px[k + 1] = toHalf(dep > 2 && dep < 13 ? reefZone(x, z, dep) : 0);
      }
      postMessage({ op: 'depth', id, x0, z0, size, n, px }, [px.buffer]);
    }
    else if (m.op === 'map') buildMap(m);
  } catch (err) { postMessage({ op: 'error', id: m.id, error: String(err && err.stack || err) }); }
};
void CELL_M;
