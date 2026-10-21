// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Biomes of the island (WP4.2, WP4.17): what grows at a point and its ground colour, from the shared deterministic
// generator - the terrain worker paints the ground and places the scatter with it, the server's wildlife finds its
// habitats with it (server/world/wildlife.js), so both agree on where the meadows, fields and woods are. Farmland is
// laid out field by field (shared/farms.js).
import { noise2, fbm, SNOW_LINE, lakeQ } from './terrain.js';
export { SNOW_LINE };
import { toFarm, fromFarm, fieldOf, fieldRect, fieldPlace, CROP } from './farms.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Biome palette (sRGB components 0..1). 2026-10-03: "smooth ... cozy, a bit cartoon but semi-realistic" - fresh,
// warm, clean colours (lush greens, warm cream sand, clear turquoise shallows, soft greys), the ground's variety drawn
// per pixel by the ground shader (render/ground-detail.js), never as speckle baked into the mesh's corners.
export const C = {
  deep: [0.1, 0.3, 0.38], shelf: [0.8, 0.76, 0.6], sand: [0.93, 0.84, 0.64], dune: [0.96, 0.89, 0.7],
  meadow: [0.42, 0.63, 0.24], meadowDry: [0.6, 0.66, 0.3], forest: [0.22, 0.4, 0.15], conifer: [0.17, 0.33, 0.15],
  rock: [0.55, 0.55, 0.53], scree: [0.66, 0.65, 0.61], snow: [0.95, 0.96, 0.99], wet: [0.4, 0.48, 0.3],
  wheat: [0.9, 0.76, 0.38], crop: [0.46, 0.63, 0.24], soil: [0.52, 0.39, 0.27], lawn: [0.47, 0.68, 0.3], stone: [0.66, 0.64, 0.6],
};
/** Each crop as seen from afar (sRGB), by shared/farms.js CROPS order; the ground shader draws its rows over it. */
export const CROP_COL = [
  [0.34, 0.55, 0.2], [0.4, 0.56, 0.27], [0.5, 0.67, 0.27], [0.91, 0.76, 0.38], [0.84, 0.8, 0.48], [0.87, 0.79, 0.53],
  [0.52, 0.68, 0.28], [0.84, 0.72, 0.22], [0.6, 0.52, 0.76], [0.8, 0.46, 0.46], [0.53, 0.39, 0.27],
];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Whether a field is farmed: its middle on gentle, drier land of a farm cluster, between ~0.5 and 2 km from the city.
// Decided once per field (on the natural ground, so roads and buildings never flip it) and remembered per island.
const FARMED = new WeakMap();
const FARM_D0 = 520, FARM_D1 = 2000;
export function farmed(island, row, fx) {
  let M = FARMED.get(island); if (!M) FARMED.set(island, M = new Map());
  const key = row * 1048576 + fx;
  let v = M.get(key); if (v !== undefined) return v;
  const R = fieldRect(row, fx), [x, z] = fromFarm((R.u0 + R.u1) / 2, (R.v0 + R.v1) / 2);
  v = false;
  const d = island.cityDist(x, z);
  if (d > FARM_D0 && d < FARM_D1 && fbm(x * 0.0016 + 40, z * 0.0016 - 12, 777, 3) < 0.1 && fbm(x * 0.0011 - 30, z * 0.0011 + 70, 4321, 3) > 0.08) {
    const e = 8, h = island.baseHeight(x, z), gx = (island.baseHeight(x + e, z) - island.baseHeight(x - e, z)) / (2 * e), gz = (island.baseHeight(x, z + e) - island.baseHeight(x, z - e)) / (2 * e);
    v = h > island.p.seaLevel + 2.5 && 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz) < 0.08;
  }
  if (M.size > 50000) M.clear();
  M.set(key, v);
  return v;
}
/** The farmed field at (x, z) with where the point is in it (shared/farms.js fieldPlace), or null. */
export function farmAt(island, x, z) {
  const d = island.cityDist(x, z);
  if (d < FARM_D0 - 120 || d > FARM_D1 + 120) return null;
  const [u, v] = toFarm(x, z), f = fieldOf(u, v);
  if (!farmed(island, f.row, f.fx)) return null;
  return { ...f, u, v, place: fieldPlace(f, u) };
}

/** Biome at a point of `island` (shared/terrain.js Island): a ground colour (sRGB 0..1, blended smoothly between
 *  neighbours), what grows there (kind: water, shore, beach, meadow, lawn, field (pasture and field margins), crop,
 *  hedge, forest, conifer, rock, snow) and how densely (woods); and how much of each detailed ground the shader draws
 *  there (render/ground-detail.js): farm, rock, snow, forest, sand, wet (0..1). h: the ground's height there, ny: the up
 *  component of its normal. */
export function biome(island, x, z, h, ny) {
  const P = island.p, sea = P.seaLevel, slope = 1 - ny;
  if (h < sea) { const t = clamp((sea - h) / 14, 0, 1); return { col: mix3(C.shelf, C.deep, t), kind: 'water', farm: 0, rock: 0, snow: 0, forest: 0, sand: 1, wet: 0 }; }
  // river channels: wet stones and gravel under and beside the water
  const rv = island.riverAt(x, z);
  if (rv && rv.d < rv.width / 2 + 1.5) return { col: mix3(C.wet, C.scree, 0.35 + 0.3 * clamp(rv.slope * 3, 0, 1)), kind: 'shore', farm: 0, rock: 0, snow: 0, forest: 0, sand: 0, wet: 1 };
  // gravel and pebbles thinning out up the bank
  const wetW = rv ? 1 - sstep(rv.width / 2 + 1.5, rv.width / 2 + 7, rv.d) : 0;
  const moist = fbm(x * 0.0016 + 40, z * 0.0016 - 12, 777, 3);
  // Beaches: low ground close to the coast (the generator's land-ness, only computed near sea level).
  if (h < sea + 6 && slope < 0.3) {
    // (by the city the plain's own height: the ground held low under its edge junctions is no beach)
    const hs = island.cityDist(x, z) < P.plainMargin + 60 ? Math.max(h, P.plainY) : h;
    const L = island.landness(x, z);
    let sandT = 1 - sstep(0.035, 0.08, L) * sstep(sea + 1.2, sea + 3.5, hs);
    // without a city (cityStreets null) its low plain shows: grass there, the sand only out towards the coast
    if (P.cityStreets === null) sandT *= sstep(P.plainMargin, P.plainMargin + 260, island.cityDist(x, z));
    if (sandT > 0.02) {
      const sand = mix3(C.sand, C.dune, clamp(0.5 - moist, 0, 1));
      if (sandT > 0.98) return { col: sand, kind: 'beach', farm: 0, rock: 0, snow: 0, forest: 0, sand: 1, wet: 0 };
      return { col: mix3(C.meadowDry, sand, sandT), kind: sandT > 0.5 ? 'beach' : 'meadow', farm: 0, rock: 0, snow: 0, forest: 0, sand: sandT, wet: 0 };
    }
  }
  const snowLine = SNOW_LINE + noise2(x * 0.004, z * 0.004, 5) * 40;
  const rockT = Math.max(sstep(0.36, 0.48, slope), sstep(snowLine - 90, snowLine - 30, h));
  const snowT = sstep(snowLine - 10, snowLine + 15, h) * (1 - sstep(0.5, 0.62, slope));
  if (snowT > 0.98) return { col: C.snow, under: C.rock, kind: 'snow', farm: 0, rock: rockT, snow: 1, forest: 0, sand: 0, wet: 0 };
  for (const k of island.lakes) if (h < k.level + 1.2 && lakeQ(k, x, z) < 1.6) return { col: C.wet, kind: 'shore', farm: 0, rock: 0, snow: 0, forest: 0, sand: 0, wet: 1 };
  const d = island.cityDist(x, z);
  let base, kind = 'meadow', density = 0, forestT = 0;
  const meadowCol = mix3(C.meadow, C.meadowDry, clamp(0.45 - moist * 1.5, 0, 1));
  if (d < P.plainMargin + 30) { base = mix3(meadowCol, C.lawn, 0.35 * (1 - sstep(P.plainMargin - 80, P.plainMargin + 30, d))); kind = 'lawn'; }
  else {
    // Farmland: whole fields in clusters on the gentle land within ~2 km of the city (shared/farms.js).
    const F = slope < 0.14 ? farmAt(island, x, z) : null;
    if (F) {
      const pl = F.place, drift = 0;
      if (pl.on && pl.kind === 0) return { col: C.forest, kind: 'hedge', farm: 1, rock: 0, snow: 0, forest: 0, sand: 0, wet: wetW };
      if (!pl.inCrop) return { col: pl.on && pl.kind === 2 ? mix3(meadowCol, C.stone, 0.6) : meadowCol, kind: 'field', farm: 1, rock: 0, snow: 0, forest: 0, sand: 0, wet: wetW };
      const f = CROP_COL[F.crop];
      return { col: [f[0] + drift, f[1] + drift, f[2] + drift * 0.5], kind: F.crop === CROP.hay || F.crop === CROP.stubble ? 'field' : 'crop', farm: 1, rock: 0, snow: 0, forest: 0, sand: 0, wet: wetW, crop: F.crop };
    }
    const forest = moist + noise2(x * 0.006, z * 0.006, 33) * 0.25, fT = h > 3 ? sstep(0.06, 0.2, forest) : 0;
    const trees = h > 160 ? mix3(C.forest, C.conifer, sstep(160, 280, h)) : C.forest;
    base = mix3(meadowCol, trees, fT); forestT = fT;
    if (fT > 0.5) { kind = h > 200 ? 'conifer' : 'forest'; density = sstep(0.12, 0.35, forest); }
  }
  let col = mix3(base, C.rock, rockT);
  col = mix3(col, C.snow, snowT);
  if (rockT > 0.6) kind = 'rock';
  // under: the ground beneath any rock and snow (the renderer draws those per pixel, so a coarse mesh never shows)
  return { col, under: base, kind, density, farm: 0, rock: rockT, snow: snowT, forest: forestT * (1 - rockT), sand: 0, wet: wetW };
}
