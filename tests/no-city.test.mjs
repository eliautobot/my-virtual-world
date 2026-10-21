// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A world without a city (2026-10-18, the product owner: "remove the built-in grid"): its grid is empty (nx, nz 0) and
// its terrain's cityStreets null — a clean island the owner builds up with roads, lots and buildings of their own.
// Residents with no home wait out of town until there are footpaths; the land where the city stood is a plain that
// takes terrain strokes like any land.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, ownerSession, tempDir } from '../tools/lib/testserver.mjs';
import { defaultIsland, Island } from '../shared/terrain.js';
import { makeGrid, hasCity, blockAt, addressOf, viewRect } from '../shared/city.js';
import { cityRoads, cityRoadSet, joinCityEdge, worldRoads } from '../shared/city-roads.js';
import { apronRects, OutdoorGround } from '../shared/city-edge.js';
import { gridLayout, gridLevel } from '../shared/road-grid.js';
import { RoadNetwork, pointAt } from '../shared/roads.js';
import { buildingPads } from '../shared/island-build.js';
import { WorldIndex } from '../server/sim/windex.js';
import { generatePopulation } from '../server/sim/population.js';
import { Sim } from '../server/sim/sim.js';
import { evalPlan } from '../server/sim/plan.js';
import { F_HIDDEN, CTX_UNDER } from '../shared/proto.js';
import { VehicleTraffic } from '../shared/vehicle-traffic.js';

const SPEC = { nx: 0, nz: 0, bw: 100.44, bd: 69.96, road: 20.7264, lotsX: 3, lotsZ: 2, lotFt: 100 };
const PLAIN = { x0: -464.76, z0: -300.86, x1: 464.76, z1: 300.86 };
/** A clean island: the land of the default island, no city, nothing built. */
function cleanWorld(seed = 'no-city') {
  return { format: 1, layout: 'lots', seed, created: Date.now(), name: 'Clean Island', grid: { ...SPEC },
    terrain: { ...defaultIsland({ seed, city: PLAIN }), cityStreets: null },
    roads: [], buildings: [], levels: [], stations: [], decorations: [], trees: [], worldModules: [], population: 120, version: 1 };
}
/** A 3 × 3 grid of two-lane roads levelled on the plain where a city would stand. */
function plainGrid(world, name = 'Main') {
  const isl = new Island(world.terrain, { roads: world.roads });
  const o = { c: { x: 0, z: 0 }, ns: 3, ew: 3, lotsX: 2, lotsZ: 2, lotFt: 100, rot: 0, profile: 'two-lane', name };
  const lv = gridLevel(gridLayout(o), (x, z) => isl.height(x, z), (x, z) => !!isl.waterAt(x, z), world.terrain.seaLevel);
  assert.equal(lv.wet, 0, 'the plain is dry land');
  return gridLayout({ ...o, level: lv.level, grid: 'g-main' });
}

test('no city: the grid answers "beyond the city" everywhere, with no streets, apron or road joins', () => {
  assert.ok(!hasCity(SPEC) && !hasCity(null) && hasCity({ ...SPEC, nx: 1, nz: 1 }));
  const g = makeGrid(SPEC);
  assert.ok(g.empty, 'an empty grid');
  assert.deepEqual([g.X, g.Z], [[], []]);
  assert.ok(g.minX === Infinity && g.maxX === -Infinity, 'empty bounds: nothing is inside');
  assert.equal(blockAt(g, 0, 0), null, 'no block at the origin');
  assert.equal(addressOf(g, 0, 0), '');
  assert.equal(cityRoads(SPEC).length, 0, 'no city streets');
  assert.equal(cityRoadSet(SPEC), null);
  const road = { id: 'r1', profile: 'two-lane', pts: [{ x: 0, z: 0 }, { x: 200e6, z: 0 }] };
  assert.equal(joinCityEdge(SPEC, road), road, 'no edge junction to join');
  assert.deepEqual(apronRects(g, [road]), [], 'no apron');
  assert.equal(new OutdoorGround(g, [road], { height: () => 7 }).height(0, 0), 7, 'the island\'s ground at the origin');
  assert.deepEqual(worldRoads({ grid: SPEC, roads: [road] }).all().map(r => r.id), ['r1'], 'the network is the roads alone');
  assert.deepEqual(viewRect({ grid: SPEC, terrain: { city: PLAIN } }), PLAIN, 'views frame the plain');
  assert.deepEqual(viewRect({ grid: SPEC }), { x0: -300, z0: -300, x1: 300, z1: 300 });
  const city = makeGrid({ ...SPEC, nx: 2, nz: 2 });
  assert.deepEqual(viewRect({ grid: { ...SPEC, nx: 2, nz: 2 } }), { x0: city.minX, z0: city.minZ, x1: city.maxX, z1: city.maxZ }, 'a city frames itself');
  const W = cleanWorld(), I = new Island(W.terrain, { roads: plainGrid(W).roads.map((r, k) => ({ ...r, id: `g${k}` })) });
  assert.equal(I.roads.pads.filter(P => P.kind === 'city').length, 0, 'no road is pinned to a city level');
});

test('no city: traffic runs on the roads alone, its cars topped up where their lanes start', () => {
  const world = cleanWorld('no-city-traffic');
  assert.equal(new VehicleTraffic(world, { seed: 'none' }).allLanes.length, 0, 'no roads, no lanes');
  world.roads = plainGrid(world).roads.map((r, k) => ({ ...r, id: `g${k}` }));
  const T = new VehicleTraffic(world, { seed: 'no-city' });
  assert.equal(T.lanes.length, 0, 'no city lanes');
  assert.ok(T.roadLanes.length > 0, 'the roads\' lanes');
  let time = 12 * 3600, most = 0;
  for (let k = 0; k < 6000; k++) { T.step(0.1, time, 12); time += 0.1; most = Math.max(most, T.islandCount); }
  const want = T.islandTarget(12);
  assert.ok(want > 0 && T.islandCount >= Math.min(want, 3), `cars keep coming (${T.islandCount} of ${want}, at most ${most})`);
  for (const c of T.all.values()) assert.ok([c.x, c.z].every(Number.isFinite), 'every car is somewhere');
});

test('no city: homeless residents wait out of town until there are roads, then walk the footpaths', () => {
  const world = cleanWorld('no-city-sim'), index = new WorldIndex(world);
  const people = generatePopulation(world, index, { population: 120, roster: [] });
  assert.equal(people.length, 120);
  assert.ok(people.every(p => !p.home), 'nobody has a home on a clean island');
  let T = 0;
  const sim = new Sim(world, people, { index, budgetMs: 1e9, clock: { simBase: 0, realBase: 0, rate: 1, dayBase: 9 * 3600, dayScale: 16 } });
  sim.now = () => T;
  sim.start();
  const look = () => people.map((p, i) => evalPlan(sim.agents[i].plan, T));
  for (; T < 240; T += 0.5) sim.tick();
  for (const e of look()) {
    assert.ok([e.x, e.y, e.z].every(Number.isFinite), 'a resident is always somewhere');
    assert.ok(e.ctx === CTX_UNDER && e.s && e.s.flags & F_HIDDEN, 'out of town and unseen, with nowhere to walk');
  }
  // the owner lays out roads: residents come back onto the footpaths as their time out of town ends
  world.roads = plainGrid(world).roads.map((r, k) => ({ ...r, id: `g${k}` }));
  const ground = new Island(world.terrain, { roads: world.roads, pads: buildingPads(world) });
  let out = 0;
  for (; T < 2400; T += 0.5) {
    sim.tick();
    if (T % 60) continue;
    for (const e of look()) {
      assert.ok([e.x, e.y, e.z].every(Number.isFinite), 'a resident is always somewhere');
      if (e.ctx === -1 && !(e.s && e.s.flags & F_HIDDEN)) {
        out++;
        assert.ok(Math.abs(e.y - ground.height(e.x, e.z)) < 1.5, `outdoors on the ground (${(e.y - ground.height(e.x, e.z)).toFixed(2)} m at ${e.x.toFixed(0)},${e.z.toFixed(0)})`);
        assert.ok(Math.abs(e.x) < 400 && Math.abs(e.z) < 400, `near the roads (${e.x.toFixed(0)},${e.z.toFixed(0)})`);
      }
    }
  }
  assert.ok(out > 50, `residents are out on the roads (${out} sightings)`);
  assert.equal(sim.errorCount, 0, `simulation errors: ${JSON.stringify(sim.errors.slice(0, 2))}`);
});

test('a world without a city boots and is built up: roads, lots, a building and a terrain stroke on the plain', async () => {
  const dir = tempDir('mvw-nocity-');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'world.json'), JSON.stringify(cleanWorld('no-city-http')));
  fs.writeFileSync(path.join(dir, 'people.json'), '[]');
  const s = await startServer({ data: dir, population: 60 });
  try {
    const owner = await ownerSession(s);
    let world = (await owner.get('/api/world')).json.world;
    assert.equal(world.grid.nx, 0, 'no city grid');
    assert.equal(world.terrain.cityStreets, null);
    assert.equal(world.buildings.length, 0);
    assert.equal((await owner.get('/api/health')).status, 200);
    // roads: a grid of them on the plain
    const L = plainGrid(world);
    const built = await owner.post('/api/edit', { atomic: true, ops: L.roads.map(({ id, ...road }) => (void id, { op: 'road.set', road })) });
    assert.equal(built.status, 200, built.text);
    world = (await owner.get('/api/world')).json.world;
    assert.equal(world.roads.length, L.roads.length, 'the grid\'s roads are the only roads');
    // its lots, made with it (the grid layout tool)
    const ids = built.json.results.map(r => r.id), runs = L.runs.map(r => ({ ...r, road: ids[r.road] }));
    const plat = await owner.post('/api/property/plat-grid', { runs, width: L.lot.w, depth: L.lot.d, zoning: 'residential' });
    assert.equal(plat.status, 200, plat.text);
    assert.equal(plat.json.ids.length, L.lots, `every lot of the plan (${plat.json.ids.length} of ${L.lots}; skipped ${JSON.stringify(plat.json.skipped)})`);
    const lots = (await owner.get('/api/property/lots')).json.lots.filter(l => plat.json.ids.includes(l.id));
    // a building on one of them, facing its road
    const net = RoadNetwork.fromJSON(world.roads);
    let placed = null, why = [];
    for (const l of lots) {
      const P = l.poly.map(q => ({ x: q.x / 1e6, z: q.z / 1e6 })), c = { x: P.reduce((a, q) => a + q.x, 0) / P.length, z: P.reduce((a, q) => a + q.z, 0) / P.length };
      const near = net.nearest(c.x, c.z, 90), t = pointAt(net.geometry(near.id), near.s, {}), side = near.offset >= 0 ? 1 : -1;
      const rot = Math.atan2(t.dz * side, -t.dx * side) * 180 / Math.PI;
      const r = await owner.post('/api/edit', { ops: [{ op: 'bld.add', spec: { type: 'apartment', x: c.x, z: c.z, w: 14, d: 17, floors: 3, rot, style: 'modern', name: 'First Flats' } }] });
      if (r.status === 200) { placed = r.json.results[0]; break; }
      why.push(r.json?.error || r.text);
    }
    assert.ok(placed, `a building fits on a lot: ${why.slice(0, 3).join(' | ')}`);
    world = (await owner.get('/api/world')).json.world;
    const B = world.buildings[placed.b];
    assert.ok(B && B.base !== undefined && !Number.isInteger(B.block), 'it stands beyond any city, on its own pad');
    // a terrain stroke on the plain where a city would stand (refused next to a city: "Too close to the city")
    const stroke = await owner.post('/api/edit', { ops: [{ op: 'terrain.add', edit: { kind: 'raise', x: 360, z: -230, r: 20, amount: 3 } }] });
    assert.equal(stroke.status, 200, stroke.text);
    world = (await owner.get('/api/world')).json.world;
    const I = new Island(world.terrain);
    assert.ok(I.height(360, -230) > world.terrain.plainY + 2, `the plain rose there (${I.height(360, -230).toFixed(2)} m)`);
    assert.equal(I.height(-300, 200), world.terrain.plainY, 'and stays level elsewhere');
    assert.equal((await owner.get('/api/health')).status, 200, 'still healthy');
  } finally { await s.stop(); }
});
