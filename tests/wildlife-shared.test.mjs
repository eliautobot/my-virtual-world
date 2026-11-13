// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.17 shared wildlife (wp4-world-spec.md §6.3 tier 2): herds simulated by the server near someone, the same herds
// whenever a region wakes, nothing simulated where nobody is, herds running from a walker, plans small enough to send.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { makeGrid } from '../shared/city.js';
import { Wildlife, sharedSpecies, REGION, dry } from '../server/world/wildlife.js';
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

/** Every region of the island woken once with these species: its herds. */
function census(w, species) {
  const A = new Wildlife(w, { seed: 'test', clock, species }), I = A.island(), c = w.terrain.center, R = w.terrain.radius, all = [];
  for (let i = Math.floor((c.x - R) / REGION); i <= Math.floor((c.x + R) / REGION); i++)
    for (let j = Math.floor((c.z - R) / REGION); j <= Math.floor((c.z + R) / REGION); j++) all.push(...A.wake(I, i, j, 0).herds);
  return { A, I, all };
}
const kindAt = (I, x, z) => { const k = biome(I, x, z, I.height(x, z), 1).kind; return k === 'lawn' ? 'meadow' : k === 'conifer' ? 'forest' : k; };

test('a liking for each habitat: sheep mostly on the farms\' pastures, few out on the meadows (2026-11-12)', () => {
  const w = world(), sheep = sharedSpecies().find(s => s.id === 'sheep');
  const even = census(w, [{ ...sheep, habitatWeight: undefined }]).all, liked = census(w, [sheep]).all, I = census(w, []).I;
  const on = (hs, k) => hs.filter(H => kindAt(I, H.ax, H.az) === k).length;
  assert.ok(on(even, 'meadow') > 0 && on(liked, 'meadow') < on(even, 'meadow') * 0.35, `on the meadows: ${on(liked, 'meadow')} flocks, ${on(even, 'meadow')} without the liking`);
  assert.ok(Math.abs(on(liked, 'field') - on(even, 'field')) <= Math.max(3, on(even, 'field') * 0.4), `on the pastures as many: ${on(liked, 'field')} vs ${on(even, 'field')}`);
  const none = census(w, [{ ...sheep, habitatWeight: { meadow: 0 } }]).all;
  assert.equal(on(none, 'meadow'), 0, 'none where it has no liking at all');
});

test('bears fish where the rivers fall: haunts found from the island\'s own waterfalls, not fixed places (2026-11-12)', () => {
  const w = world(), bear = sharedSpecies().find(s => s.id === 'black-bear');
  assert.ok(bear.haunts?.some(h => h.near === 'falls'), 'the bears\' catalogue entry has the waterfalls as a haunt');
  // (only the haunt: no bears elsewhere, so every one placed is by a fall)
  const only = { ...bear, perKm2: 0, haunts: bear.haunts.filter(h => h.near === 'falls') }, { A, I, all } = census(w, [only]);
  const falls = I.lakes.filter(L => L.pool), lips = I.rivers.flatMap(R => R.drops || []);
  assert.ok(falls.length > 0, 'the island has waterfalls');
  assert.ok(all.length > 0, 'bears at the falls');
  const within = only.haunts[0].within;
  for (const H of all) {
    const d = Math.min(...falls.map(L => Math.hypot(L.x - H.ax, L.z - H.az) - L.r), ...lips.map(f => Math.hypot(f.x - H.ax, f.z - H.az) - f.w / 2));
    assert.ok(d <= within + 0.01, `a bear ${d.toFixed(0)} m from a fall`);
    assert.ok(H.spot?.kind === 'falls' && dry(I, H.ax, H.az), 'keeping to the fall, on dry ground');
  }
  // the haunts follow the land: with no rivers (a flat, dry island), no falls and no bears there
  const bare = census(w, [only]); bare.I.rivers = []; bare.I.lakes = bare.I.lakes.filter(L => !L.pool); bare.A._haunts = null;
  assert.equal(bare.A.haunts(bare.I).count.falls, 0);
  // and over a while by the falls, they keep near the water and out of it
  const H0 = all[0], B = new Wildlife(w, { seed: 'test', clock, species: [only] });
  for (let t = 0; t < 400; t++) B.tick(0.5, [{ x: H0.ax, z: H0.az }], [], 12);
  const hs = [...B.regions.values()].flatMap(R => R.herds);
  assert.ok(hs.length > 0);
  for (const H of hs) for (const m of H.members) {
    const p = B.at(m, B.t);
    assert.ok(dry(I, p.x, p.z), 'not in the water (nor on a bank under the river\'s level)');
    assert.ok(Math.hypot(p.x - H.spot.x, p.z - H.spot.z) - H.spot.r < within + 40, 'still by its fall');
  }
});

test('the elder stag leads some of the deer herds in the hills, and a few roam alone (2026-11-12)', () => {
  const w = world(), sps = sharedSpecies().filter(s => s.id === 'deer' || s.id === 'elder-deer'), { I, all } = census(w, sps);
  const elder = all.filter(H => H.sp.id === 'elder-deer'), deer = all.filter(H => H.sp.id === 'deer'), alt = sps.find(s => s.id === 'elder-deer').altitude;
  assert.ok(elder.length > 0, 'elder deer on the island');
  for (const E of elder) {
    assert.equal(E.members.length, 1, 'one stag');
    if (E.with) {
      const H = deer.find(d => d.id === E.with); assert.ok(H, 'with a herd of deer');
      const h = I.height(H.ax, H.az); assert.ok(h >= alt[0] && h <= alt[1], `its herd in the hills (${h.toFixed(0)} m)`);
    }
  }
  assert.ok(elder.some(E => E.with), 'some leading a herd');
});

test('roosters keep company with the hens: one beside some of the chickens\' groups, nowhere else (2026-11-12)', () => {
  const w = world(), A = new Wildlife(w, { seed: 'test', clock }), I = A.island();
  const c = w.terrain.center, R = w.terrain.radius, all = [];
  for (let i = Math.floor((c.x - R) / REGION); i <= Math.floor((c.x + R) / REGION); i++)
    for (let j = Math.floor((c.z - R) / REGION); j <= Math.floor((c.z + R) / REGION); j++) all.push(...(A.wake(I, i, j, 0)?.herds || []));
  const hens = all.filter(h => h.sp.id === 'chicken'), cocks = all.filter(h => h.sp.id === 'rooster');
  assert.ok(hens.length > 0, 'chickens on the farmland');
  assert.ok(cocks.length > 0 && cocks.length <= hens.length, `roosters: ${cocks.length} with ${hens.length} flocks`);
  for (const r of cocks) {
    const h = hens.find(x => x.id === r.with);
    assert.ok(h, 'each rooster with a flock');
    assert.ok(Math.hypot(r.ax - h.ax, r.az - h.az) < 1e-6 && r.members.length === 1, 'at its place, alone');
  }
});
