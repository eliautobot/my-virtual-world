// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4 city on 100 × 100 ft lots (DECISIONS E25 (8c)/(9)): lots cover every block exactly and stay clear of the road
// corridors, every building stands inside its own lot group with its entrance on its street, nothing overlaps, groups
// are the planned sizes, and there is housing for everyone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLotCity, lotGridSpec, blockLots } from '../server/world/generate-lots.js';
import { makeGrid, lotRect, blockIJ } from '../shared/city.js';
import { RoadNetwork, alignmentsFromGrid } from '../shared/roads.js';
import { contains, unionLots, checkPartition, area } from '../shared/lots.js';
import { footprint, rectsOverlap } from '../shared/geom.js';
import { mToUm } from '../shared/units.js';

const world = generateLotCity({ seed: 'wp4-test', population: 4000 });
const lotByKey = new Map(world.lots.map(l => [l.key, l]));
const m2poly = r => [{ x: mToUm(r.x0), z: mToUm(r.z0) }, { x: mToUm(r.x1), z: mToUm(r.z0) }, { x: mToUm(r.x1), z: mToUm(r.z1) }, { x: mToUm(r.x0), z: mToUm(r.z1) }];

test('the lot grid: 100 × 100 ft lots, 3 × 2 per block, inside the sidewalks', () => {
  const spec = lotGridSpec({ nx: 8, nz: 7 });
  assert.equal(spec.bw, 100.44); assert.equal(spec.bd, 69.96);
  assert.equal(world.lots.length, 8 * 7 * 6);
  assert.ok(world.lots.every(l => area(l.poly).sqft === 10000));
});

test('lots cover each block\'s building area exactly and meet the back of the sidewalk, never the road corridor', () => {
  const g = makeGrid(world.grid), roads = RoadNetwork.fromJSON(alignmentsFromGrid(world.grid));
  for (let bi = 0; bi < g.nx * g.nz; bi++) {
    const { i, j } = blockIJ(g, bi), lots = world.lots.filter(l => l.block === bi);
    assert.deepEqual(checkPartition(lots.map(l => ({ id: l.key, poly: l.poly })), { region: m2poly(lotRect(g, i, j)) }), [], `block ${bi}`);
    for (const l of lots) assert.deepEqual(roads.corridorHits(l.poly.map(p => ({ x: p.x / 1e6, z: p.z / 1e6 }))), [], `lot ${l.key} clear of roads`);
  }
  assert.deepEqual(blockLots(world.grid, 0, 0).map(l => l.face), [2, 2, 2, 0, 0, 0], 'back row fronts the −z street, front row the +z street');
});

test('every building stands inside its own lot group, faces its street, and no two buildings overlap', () => {
  const groups = new Map(world.lotGroups.map(g => [g.key, g]));
  const fps = world.buildings.map(b => footprint(b));
  world.buildings.forEach((b, k) => {
    const gr = groups.get(b.lotGroup);
    assert.ok(gr, `${b.id} has a lot group`);
    const polys = gr.lots.map(key => lotByKey.get(key).poly), outline = polys.length > 1 ? unionLots(polys).poly : polys[0];
    assert.ok(contains(outline, m2poly(fps[k])), `${b.id} (${b.type}) inside its lots`);
    if (b.type !== 'park') {
      const rows = gr.lots.map(key => lotByKey.get(key).r), faceRow = b.rot === 0 ? 1 : 0;
      assert.ok(rows.includes(faceRow), `${b.id} faces a street its lots front`);
    }
  });
  for (let a = 0; a < fps.length; a++) for (let c = a + 1; c < fps.length; c++) assert.ok(!rectsOverlap(fps[a], fps[c], 0.01), `${world.buildings[a].id} and ${world.buildings[c].id} overlap`);
});

test('groups: parks are whole blocks, the headquarters a 2 × 2, towers and big apartments pairs; one zoning per group', () => {
  const sizes = {};
  for (const g of world.lotGroups) {
    (sizes[g.kind] ||= new Set()).add(g.lots.length);
    assert.equal(new Set(g.lots.map(k => lotByKey.get(k).zoning)).size, 1, `${g.key} has one zoning`);
    if (g.lots.length > 1) assert.doesNotThrow(() => unionLots(g.lots.map(k => lotByKey.get(k).poly)), `${g.key} joins side to side`);
  }
  assert.deepEqual([...sizes.park], [6]); assert.deepEqual([...sizes.hq], [4]); assert.deepEqual([...sizes.pair], [2]);
  assert.ok([...sizes.single].every(n => n === 1) && [...sizes.vacant].every(n => n === 1));
  assert.equal(world.buildings.filter(b => b.type === 'hq').length, 1);
  const used = new Set(world.lotGroups.flatMap(g => g.lots));
  assert.equal(used.size, world.lots.length, 'every lot is in exactly one group');
});

test('housing for the whole population, and the same seed gives the same city', () => {
  const apts = world.buildings.filter(b => b.type === 'apartment');
  const est = apts.reduce((a, b) => a + (b.floors - 1) * 2 * Math.max(1, Math.round((b.w - 0.5) / 7.6)), 0);
  assert.ok(est * 1.55 >= world.population, `capacity estimate ${est}`);
  const again = generateLotCity({ seed: 'wp4-test', population: 4000 });
  assert.deepEqual(again.buildings.map(b => [b.type, b.x, b.z, b.w, b.d, b.floors]), world.buildings.map(b => [b.type, b.x, b.z, b.w, b.d, b.floors]));
});
