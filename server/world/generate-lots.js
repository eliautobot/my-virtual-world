// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The city on lots (WP4, DECISIONS E25 (8c)/(9)): today's street grid rebuilt so every block holds whole 100 × 100 ft
// lots — by default 3 lots along the avenue side and 2 deep, every lot fronting a street (corner lots front two).
// Buildings are planned lot by lot: each stands inside its lot (or a merged group of lots) with front, side and rear
// setbacks, its entrance facing its own street, so residents walk straight from the door to the sidewalk.
// Towers and large apartments sit on 2-lot groups, the headquarters on a 2 × 2 group with a forecourt, parks on whole
// blocks. A share of lots in the middle and outer districts stays vacant, ready for future owners.
// The road grid stays the one the simulation, traffic and signals already use; the lots are also returned as exact
// integer-micrometre polygons for the property store (server/property.js).
import { RNG } from '../../shared/rng.js';
import { makeGrid, blockIndex } from '../../shared/city.js';
import { SIDEWALK } from '../../shared/constants.js';
import { mToUm, ftToUm, UM_PER_M } from '../../shared/units.js';
import * as N from '../../shared/names.js';
import { makeBuilding, ensureHousing, generateLevels, placeStations, placeTrees } from './generate.js';
import { coreFor } from './layouts.js';

export const LOT_LAYOUT = Object.freeze({ lotsX: 3, lotsZ: 2, lotFt: 100 });
const r2 = v => Math.round(v * 100) / 100;

/** Grid spec (metres, as world.grid) whose blocks hold lotsX × lotsZ lots of lotFt inside their sidewalks. */
export function lotGridSpec({ nx = 8, nz = 7, lotsX = LOT_LAYOUT.lotsX, lotsZ = LOT_LAYOUT.lotsZ, lotFt = LOT_LAYOUT.lotFt, road = 14 } = {}) {
  const lotUm = ftToUm(lotFt), sw = mToUm(SIDEWALK);
  return { nx, nz, bw: (lotsX * lotUm + 2 * sw) / UM_PER_M, bd: (lotsZ * lotUm + 2 * sw) / UM_PER_M, road, lotsX, lotsZ, lotFt };
}

/**
 * The lots of block (i, j), computed in integer micrometres from the grid spec (the same arithmetic as makeGrid):
 * [{ c, r, poly (µm), rect (m), face }] where face is the street side its buildings front (0: +z, 2: −z).
 */
export function blockLots(spec, i, j) {
  const lotUm = ftToUm(spec.lotFt), sw = mToUm(SIDEWALK), road = mToUm(spec.road);
  const bw = spec.lotsX * lotUm + 2 * sw, bd = spec.lotsZ * lotUm + 2 * sw, px = bw + road, pz = bd + road;
  const x0 = -spec.nx * px / 2, z0 = -spec.nz * pz / 2;
  if (!Number.isInteger(x0) || !Number.isInteger(z0)) throw new Error('the lot grid origin is not a whole micrometre');
  const bx = x0 + i * px + road / 2 + sw, bz = z0 + j * pz + road / 2 + sw, out = [];
  for (let r = 0; r < spec.lotsZ; r++) for (let c = 0; c < spec.lotsX; c++) {
    const lx0 = bx + c * lotUm, lz0 = bz + r * lotUm, lx1 = lx0 + lotUm, lz1 = lz0 + lotUm;
    out.push({ c, r, poly: [{ x: lx0, z: lz0 }, { x: lx1, z: lz0 }, { x: lx1, z: lz1 }, { x: lx0, z: lz1 }],
      rect: { x0: lx0 / UM_PER_M, z0: lz0 / UM_PER_M, x1: lx1 / UM_PER_M, z1: lz1 / UM_PER_M }, face: r >= spec.lotsZ / 2 ? 0 : 2 });
  }
  return out;
}
const unionRect = rs => ({ x0: Math.min(...rs.map(r => r.x0)), z0: Math.min(...rs.map(r => r.z0)), x1: Math.max(...rs.map(r => r.x1)), z1: Math.max(...rs.map(r => r.z1)) });

/**
 * A new city on lots. Options: seed, name, hqName, population, nx, nz (blocks), lotsX, lotsZ, lotFt, vacancy (share of
 * eligible single lots left empty in the middle/outer districts).
 * Returns the world (format 1, layout 'lots'): world.lots lists every original lot ({ key, block, c, r, poly, zoning })
 * and world.lotGroups every group a building or park stands on ({ key, lots: [keys], kind, zoning }); each building
 * carries `lotGroup` (its group key). The property store turns these into lot records and merges.
 */
export function generateLotCity(opts = {}) {
  const seed = String(opts.seed ?? 'next-city-lots');
  const hqName = String(opts.hqName ?? '').trim().slice(0, 40) || 'Headquarters';
  const rng = new RNG(seed + ':city');
  const spec = lotGridSpec(opts), g = makeGrid(spec), nx = spec.nx, nz = spec.nz;
  const vacancy = opts.vacancy ?? 0.1;
  const world = { format: 1, layout: 'lots', seed, created: Date.now(), name: opts.name || 'Next City', grid: spec,
    buildings: [], levels: [], stations: [], trees: [], population: opts.population ?? 4000, lots: [], lotGroups: [] };
  const cx = (nx - 1) / 2, cz = (nz - 1) / 2;
  const zoneOf = (i, j) => { const dn = Math.max(Math.abs(i - cx) / (nx / 2), Math.abs(j - cz) / (nz / 2)); return { dn, zone: dn < 0.36 ? 'down' : dn < 0.72 ? 'mid' : 'out' }; };
  const ZONING = { down: 'commercial', mid: 'mixed', out: 'residential' };
  // Special blocks: the headquarters east of the centre, parks spread out (as the grid generator).
  const hqI = Math.min(nx - 1, Math.round(cx) + 1), hqJ = Math.round(cz);
  const parks = new Set(), cands = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (i === hqI && j === hqJ) continue;
    const { dn } = zoneOf(i, j); if (dn < 0.2) continue;
    cands.push({ i, j, w: rng.next() + (dn > 0.3 && dn < 0.6 ? 0.6 : 0) });
  }
  cands.sort((a, b) => b.w - a.w);
  const nParks = Math.max(2, Math.round(nx * nz / 12));
  for (const c of cands) {
    if (parks.size >= nParks) break;
    if ([...parks].every(p => { const [pi, pj] = p.split(',').map(Number); return Math.max(Math.abs(pi - c.i), Math.abs(pj - c.j)) >= 3; })) parks.add(c.i + ',' + c.j);
  }
  const used = { tower: new Set(), apt: new Set(), cafe: new Set(), shop: new Set(), gym: new Set(), rest: new Set(), park: new Set() };
  const uniqueName = (pool, key, fallback) => {
    for (let k = 0; k < 30; k++) { const n = rng.pick(pool); if (!used[key].has(n)) { used[key].add(n); return n; } }
    return fallback + ' ' + (used[key].size + 1);
  };
  const specs = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const bi = blockIndex(g, i, j), lots = blockLots(spec, i, j), { dn, zone } = zoneOf(i, j);
    const isPark = parks.has(i + ',' + j), isHq = i === hqI && j === hqJ;
    const zoning = isPark ? 'park' : isHq ? 'commercial' : ZONING[zone];
    const key = l => `${bi}:${l.c}:${l.r}`;
    for (const l of lots) world.lots.push({ key: key(l), block: bi, c: l.c, r: l.r, poly: l.poly, zoning });
    const group = (members, kind) => { const k = `g${world.lotGroups.length}`; world.lotGroups.push({ key: k, lots: members.map(key), kind, zoning, block: bi }); return { key: k, rect: unionRect(members.map(m => m.rect)), face: members[0].face }; };
    if (isPark) {
      const gr = group(lots, 'park');
      specs.push({ type: 'park', block: bi, rect: gr.rect, face: 0, name: uniqueName(N.PARK_NAMES, 'park', 'Park'), lotGroup: gr.key });
      continue;
    }
    const rows = [];
    for (let r = 0; r < spec.lotsZ; r++) rows.push(lots.filter(l => l.r === r).sort((a, b) => a.c - b.c));
    if (isHq && spec.lotsX >= 2 && spec.lotsZ >= 2) {
      // Headquarters on a 2 × 2 group of the first two columns, fronting the +z street with a forecourt; the rest singles.
      const quad = lots.filter(l => l.c < 2 && l.r >= spec.lotsZ - 2), gr = group(quad, 'hq'), R = gr.rect;
      const w = Math.min(40, R.x1 - R.x0 - 8), d = Math.min(28, R.z1 - R.z0 - 14);
      specs.push({ type: 'hq', block: bi, face: 0, floors: 10, style: 'modern', name: hqName, sign: hqName.slice(0, 28), lotGroup: gr.key,
        rect: { x0: (R.x0 + R.x1 - w) / 2, x1: (R.x0 + R.x1 + w) / 2, z0: R.z1 - 9 - d, z1: R.z1 - 9 } });
      for (const l of lots.filter(x => !quad.includes(x))) planSingle(specs, group([l], 'single'), bi, rng, zone, dn, uniqueName, 0);
      continue;
    }
    for (const row of rows) {
      const pattern = pickPattern(rng, zone, row.length);
      let c = 0;
      for (const size of pattern) {
        const members = row.slice(c, c + size); c += size;
        if (size === 2) planPair(specs, group(members, 'pair'), bi, rng, zone, dn);
        else if (zone !== 'down' && rng.chance(vacancy)) group(members, 'vacant');
        else planSingle(specs, group(members, 'single'), bi, rng, zone, dn, uniqueName, vacancy);
      }
    }
  }
  for (const s of specs) {
    const b = makeBuilding(world.buildings.length, s, rng, uniqueName);
    b.lotGroup = s.lotGroup;
    world.buildings.push(b);
  }
  ensureHousing(world, rng);
  for (const b of world.buildings) b.core = coreFor(b);
  for (const b of world.buildings) generateLevels(world, b, rng);
  placeStations(world, g, rng);
  placeTrees(world, g, rng);
  return world;
}

function pickPattern(rng, zone, n) {
  if (n !== 3) return Array(n).fill(1);
  if (zone === 'down') return rng.weighted([[[2, 1], 45], [[1, 2], 30], [[1, 1, 1], 25]]);
  if (zone === 'mid') return rng.weighted([[[1, 1, 1], 65], [[2, 1], 20], [[1, 2], 15]]);
  return rng.weighted([[[1, 1, 1], 88], [[2, 1], 12]]);
}
// Footprint inside a lot (group) rectangle: centred across the frontage with side setbacks, `front` m back from the
// street-side lot line, `d` deep, and at least 2 m clear at the rear.
function inLot(R, face, w, d, front) {
  const W = R.x1 - R.x0, D = R.z1 - R.z0;
  w = Math.min(w, W - 2.4); d = Math.min(d, D - front - 2);
  const x0 = R.x0 + (W - w) / 2;
  const z0 = face === 0 ? R.z1 - front - d : R.z0 + front;
  return { x0: r2(x0), x1: r2(x0 + w), z0: r2(z0), z1: r2(z0 + d) };
}
function planPair(specs, gr, bi, rng, zone, dn) {
  const R = gr.rect, W = R.x1 - R.x0;
  if (zone === 'down' || (zone === 'mid' && rng.chance(0.35))) {
    const floors = Math.max(10, Math.round((zone === 'down' ? 42 : 22) - dn * 40 + rng.float(-5, 5)));
    specs.push({ type: 'office', block: bi, face: gr.face, floors, style: rng.pick(['glass', 'glass', 'modern', 'concrete']), mixed: rng.chance(0.35) ? 'cafe' : null, lotGroup: gr.key,
      rect: inLot(R, gr.face, r2(rng.float(Math.min(36, W - 8), W - 6)), r2(rng.float(22, 26)), r2(rng.float(3, 6))) });
  } else {
    specs.push({ type: 'apartment', block: bi, face: gr.face, floors: Math.max(5, Math.round(zone === 'mid' ? rng.float(9, 16) : rng.float(6, 11))), style: rng.pick(['brick', 'stucco', 'classic', 'modern', 'concrete']),
      mixed: rng.chance(0.45) ? rng.pick(['cafe', 'shop', 'restaurant', 'shop']) : null, lotGroup: gr.key,
      rect: inLot(R, gr.face, r2(rng.float(W - 12, W - 4)), r2(rng.float(19, 23)), r2(rng.float(1.5, 3))) });
  }
}
function planSingle(specs, gr, bi, rng, zone, dn, uniqueName) {
  const R = gr.rect, W = R.x1 - R.x0;
  const t = zone === 'down' ? rng.weighted([['office', 62], ['cafe', 13], ['restaurant', 13], ['shop', 12]])
    : zone === 'mid' ? rng.weighted([['apartment', 52], ['office', 20], ['cafe', 8], ['restaurant', 8], ['shop', 8], ['gym', 4]])
      : rng.weighted([['apartment', 55], ['cafe', 10], ['restaurant', 10], ['shop', 13], ['gym', 7], ['office', 5]]);
  const front = r2(rng.float(1.5, 3));
  if (t === 'office') {
    specs.push({ type: 'office', block: bi, face: gr.face, floors: Math.max(3, Math.round(zone === 'down' ? rng.float(12, 26) : rng.float(4, 12))), style: rng.pick(['concrete', 'glass', 'modern', 'classic', 'brick']),
      mixed: rng.chance(0.25) ? 'cafe' : null, lotGroup: gr.key, rect: inLot(R, gr.face, r2(rng.float(20, W - 3)), r2(rng.float(18, 25)), front) });
  } else if (t === 'apartment') {
    specs.push({ type: 'apartment', block: bi, face: gr.face, floors: Math.max(4, Math.round(zone === 'mid' ? rng.float(6, 12) : rng.float(4, 9))), style: rng.pick(['brick', 'brick', 'stucco', 'classic', 'modern', 'concrete']),
      mixed: rng.chance(zone === 'mid' ? 0.45 : 0.3) ? rng.pick(['cafe', 'shop', 'restaurant', 'shop']) : null, lotGroup: gr.key, rect: inLot(R, gr.face, r2(rng.float(20, W - 3)), r2(rng.float(18, 22)), front) });
  } else if (zone !== 'down' && rng.chance(0.35)) {
    // Two small venues side by side on one lot.
    const gap = r2(rng.float(1.4, 2.2)), half = (W - 2.4 - gap) / 2;
    const types = [t, rng.pick(['cafe', 'shop', 'restaurant', 'gym'].filter(x => x !== t))];
    types.forEach((type, k) => {
      const x0 = R.x0 + 1.2 + k * (half + gap), sub = { x0, x1: x0 + half, z0: R.z0, z1: R.z1 };
      const r = inLot({ ...sub, x0: sub.x0 - 1.2, x1: sub.x1 + 1.2 }, gr.face, half, r2(rng.float(13, 18)), front);
      specs.push({ type, block: bi, face: gr.face, floors: type === 'gym' ? rng.int(1, 3) : rng.int(1, 2), style: rng.pick(['stucco', 'brick', 'classic', 'modern']), lotGroup: gr.key, rect: r });
    });
  } else {
    specs.push({ type: t, block: bi, face: gr.face, floors: t === 'gym' ? rng.int(1, 3) : rng.int(1, 2), style: rng.pick(['stucco', 'brick', 'classic', 'modern']), lotGroup: gr.key,
      rect: inLot(R, gr.face, r2(rng.float(16, W - 4)), r2(rng.float(14, 20)), front) });
  }
  void dn; void uniqueName;
}
