// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.17 shared wildlife (wp4-world-spec.md §6.3 tier 2): herds simulated by the server near someone, the same herds
// whenever a region wakes, nothing simulated where nobody is, herds running from a walker, plans small enough to send.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { makeGrid } from '../shared/city.js';
import { Wildlife, sharedSpecies, REGION } from '../server/world/wildlife.js';
import { biome } from '../shared/biome.js';

function world() {
  const w = generateWorld({ seed: 'wp4-wildlife', population: 0 }), g = makeGrid(w.grid);
  w.terrain = defaultIsland({ seed: 'wp4-wildlife:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  w.roads = generateIslandRoads(new Island(w.terrain), w.grid);
  return w;
}
const clock = () => ({ simBase: 0, realBase: 0, rate: 1, dayBase: 10 * 3600, dayScale: 16 });

test('the shared tier: deer, horses and farm animals come from the catalogue', () => {
  const ids = sharedSpecies().map(s => s.id).sort();
  for (const id of ['cow', 'deer', 'horse', 'sheep']) assert.ok(ids.includes(id), id);
});

test('herds wake near someone, the same every time, sleep when nobody is near, and run from a walker', () => {
  const w = world(), I = new Island(w.terrain, { roads: w.roads });
  // somewhere with meadows or fields: scan for a spot whose biome suits grazers
  let spot = null;
  for (let k = 0; k < 2000 && !spot; k++) {
    const a = k * 2.399, r = w.terrain.radius * (0.15 + (k % 11) * 0.06), x = w.terrain.center.x + Math.cos(a) * r, z = w.terrain.center.z + Math.sin(a) * r;
    const h = I.height(x, z); if (h < w.terrain.seaLevel + 2 || I.cityDist(x, z) < 500) continue;
    const kd = biome(I, x, z, h, 1).kind;
    if (kd === 'field' || kd === 'meadow') spot = { x, z };
  }
  assert.ok(spot, 'farmland or meadow on the island');
  const A = new Wildlife(w, { seed: 'test', clock }), B = new Wildlife(w, { seed: 'test', clock });
  let herds = null;
  for (let i = 0; i < 40; i++) { A.tick(0.1, [spot], [], 10); B.tick(0.1, [spot], [], 10); }
  assert.ok(A.stats.regions > 0 && A.stats.herds > 0, `herds near the viewer: ${JSON.stringify(A.stats)}`);
  herds = A.view(spot.x, spot.z).herds;
  assert.deepEqual(herds.map(h => [h.id, h.m.length]), B.view(spot.x, spot.z).herds.map(h => [h.id, h.m.length]), 'the same herds for the same world');
  const bytes = JSON.stringify(A.view(spot.x, spot.z)).length;
  assert.ok(bytes < 40000, `a browser's update stays small (${bytes} bytes)`);
  // members move in plans (rest or walk), always on dry land
  for (let i = 0; i < 200; i++) A.tick(0.1, [spot], [], 10);
  for (const h of A.view(spot.x, spot.z).herds) for (const m of h.m) assert.ok(!I.waterAt(m[2], m[3]), 'never into the water');
  // a walker comes up to a herd: it runs
  const H = [...A.regions.values()].flatMap(R => R.herds).find(h => h.sp.flee > 0);
  if (H) {
    const p = A.at(H.members[0], A.t);
    for (let i = 0; i < 10; i++) A.tick(0.1, [spot], [{ x: p.x + 3, z: p.z, r: 0 }], 10);
    assert.ok(H.members.some(m => m.mode === 'run'), 'the herd takes fright');
  }
  // nobody near: the regions go to sleep and cost nothing
  for (let i = 0; i < 1000; i++) A.tick(0.1, [], [], 10);
  assert.equal(A.regions.size, 0, 'empty land is dormant');
  // waking again brings the same herds back
  for (let i = 0; i < 10; i++) A.tick(0.1, [spot], [], 10);
  assert.deepEqual(A.view(spot.x, spot.z).herds.map(h => h.id).sort(), herds.map(h => h.id).sort());
  void REGION;
});

test('a grid laid out over a herd\'s land sends it away; taken away, the herds come back (2026-10-14)', async () => {
  const { gridLayout } = await import('../shared/road-grid.js');
  const { gridPads } = await import('../shared/island-build.js');
  const w = world(), I = new Island(w.terrain, { roads: w.roads });
  let spot = null;
  for (let k = 0; k < 2000 && !spot; k++) {
    const a = k * 2.399, r = w.terrain.radius * (0.15 + (k % 11) * 0.06), x = w.terrain.center.x + Math.cos(a) * r, z = w.terrain.center.z + Math.sin(a) * r;
    const h = I.height(x, z); if (h < w.terrain.seaLevel + 2 || I.cityDist(x, z) < 500) continue;
    const kd = biome(I, x, z, h, 1).kind;
    if (kd === 'field' || kd === 'meadow') spot = { x, z };
  }
  const A = new Wildlife(w, { seed: 'test', clock });
  for (let i = 0; i < 40; i++) A.tick(0.1, [spot], [], 10);
  const all = () => A.view(spot.x, spot.z).herds.flatMap(h => h.m.map(m => ({ x: m[2], z: m[3] })));
  const before = all(); assert.ok(before.length, 'animals near the spot');
  // a grid over where the first animal stands
  const L = gridLayout({ c: before[0], ns: 4, ew: 4, lotsX: 3, lotsZ: 2, lotFt: 100, rot: 0, profile: 'two-lane', level: I.height(before[0].x, before[0].z), grid: 'gw' });
  const keep = w.roads;
  w.roads = [...keep, ...L.roads.map((r, k) => ({ ...r, id: `gw-${k}` }))];
  const [P] = gridPads(w), inTown = q => { const dx = q.x - P.x, dz = q.z - P.z; return Math.abs(dx * Math.cos(P.rot) - dz * Math.sin(P.rot)) <= P.hw && Math.abs(dx * Math.sin(P.rot) + dz * Math.cos(P.rot)) <= P.hd; };
  assert.ok(before.some(inTown), 'animals stood where the grid goes');
  for (let i = 0; i < 40; i++) A.tick(0.1, [spot], [], 10);
  assert.equal(all().filter(inTown).length, 0, 'none on the grid\'s land');
  for (let i = 0; i < 300; i++) A.tick(0.1, [spot], [], 10);
  assert.equal(all().filter(inTown).length, 0, 'nor do they wander on to it');
  w.roads = keep;
  for (let i = 0; i < 40; i++) A.tick(0.1, [spot], [], 10);
  assert.ok(all().some(inTown), 'the grid gone, they graze there again');
});
