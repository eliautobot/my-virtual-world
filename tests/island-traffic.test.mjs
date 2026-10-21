// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.3/4.5 roads and traffic beyond the city: the generated island roads meet square (every exit a T junction on the
// Island Loop, every lake road square off its road), a ring road's profile is continuous where it joins up, and traffic
// runs on the lane graph: cars leave the city onto the island and come back, never overlap in a lane, never use two
// conflicting junction moves at once, stay on the graded ground, and a car taken over by a driver lets go of its lane
// and junction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { makeGrid } from '../shared/city.js';
import { defaultIsland, Island, GroundQuery } from '../shared/terrain.js';
import { generateIslandRoads, profileAt } from '../shared/island-roads.js';
import { RoadNetwork } from '../shared/roads.js';
import { VehicleTraffic } from '../shared/vehicle-traffic.js';

const world = generateWorld({ seed: 'island-traffic', nx: 3, nz: 3 }), g = makeGrid(world.grid);
world.terrain = defaultIsland({ seed: 'island-traffic:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
world.roads = generateIslandRoads(new Island(world.terrain), world.grid);
const island = new Island(world.terrain, { roads: world.roads }), ground = new GroundQuery(island, { maxChunks: 4096 });   // cars spread over ~70 km of road

test('generated island roads are valid and meet square', () => {
  const net = RoadNetwork.fromJSON(world.roads), J = net.junctions();
  assert.deepEqual(net.validate(), []);
  for (const id of ['isl-north', 'isl-east', 'isl-west']) {
    // exactly once with the loop, in a T (lake roads may branch off the exit on the way)
    const at = J.filter(j => j.kind !== 'end' && j.arms.some(a => a.id === id) && j.arms.some(a => a.id === 'isl-loop'));
    assert.equal(at.length, 1, `${id} meets the loop once`);
    assert.equal(at[0].kind, 'T', `${id} ends on the loop in a T`);
  }
  for (const j of J) {
    if (j.kind !== 'T') continue;
    const stem = j.arms.find(a => j.arms.filter(b => b.id === a.id).length === 1), bar = j.arms.find(a => a !== stem);
    const off = Math.abs(Math.abs(((stem.angle - bar.angle) * 180 / Math.PI + 540) % 360 - 180) - 90);
    assert.ok(off < 3, `${stem.id} meets ${bar.id} square (${off.toFixed(1)}° off)`);
  }
});

test('a ring road is profiled all the way round', () => {
  const R = island.roads, P = R.prof.get('isl-loop'), G = R.net.geometry('isl-loop'), max = R.profiles.country.maxGrade;
  assert.ok(G.closed);
  assert.equal(P.y[0], P.y.at(-1), 'the same height where the ring joins up');
  assert.ok(Math.abs(profileAt(P, P.d / 2) - (P.y[0] + P.y[1]) / 2) < 1e-6, 'heights interpolate within the first sample interval too');
  for (let i = 1; i < P.y.length; i++) assert.ok(Math.abs(P.y[i] - P.y[i - 1]) / P.d <= max + 1e-4, `grade at sample ${i}`);   // heights are stored as float32
});

test('traffic leaves the city for the island roads and comes back, safely', () => {
  const T = new VehicleTraffic(world, { seed: 'island-traffic' });
  assert.ok(T.roadLanes.length > 0 && T.graphLanes.length > T.roadLanes.length, 'road lanes and junction connectors');
  assert.ok(T.lanes.some(l => l.next.length) && T.lanes.some(l => l.feeders.length), 'city lanes link to the roads at the city edge');
  T.fill(17.7);
  let time = 17.7 * 3600, out = 0, back = 0, lowest = 0, highest = 0;
  const onIsland = new Map();
  for (let k = 0; k < 6000; k++) {   // 10 simulated minutes
    T.step(0.1, time, (time / 3600) % 24); time += 0.1;
    if (k % 25) continue;
    let count = 0;
    for (const c of T.all.values()) {
      assert.ok([c.x, c.y, c.z, c.yaw, c.v, c.s].every(Number.isFinite), `car ${c.id} has a finite pose`);
      const isl = !!c.lane.graph; if (isl) count++;
      const was = onIsland.get(c.id); if (was === false && isl) out++; if (was === true && !isl) back++; onIsland.set(c.id, isl);
      if (c.lane.kind === 'road') { const e = c.y - ground.height(c.x, c.z); lowest = Math.min(lowest, e); highest = Math.max(highest, e); }
    }
    assert.equal(count, T.islandCount, 'the island count matches the cars on its lanes');
    for (const l of T.allLanes) for (let i = 1; i < l.cars.length; i++) {
      const a = l.cars[i - 1], b = l.cars[i];
      assert.ok(b.s + b.len / 2 <= a.s - a.len / 2 + 1e-6, `no overlap in lane ${l.id || 'city'}`);
    }
    for (const C of T.graphLanes) if (C.kind === 'path' && C.cars.length) for (const K of C.conflicts) if (K !== C) assert.equal(K.cars.length, 0, `${C.id} and ${K.id} are never used together`);
  }
  assert.ok(out > 5 && back > 5, `cars went out (${out}) and came back (${back})`);
  assert.ok(lowest > -0.15 && highest < 0.15, `on the graded ground (${lowest.toFixed(3)}…${highest.toFixed(3)} m)`);
  const speeds = [...T.all.values()].filter(c => c.lane.kind === 'road').map(c => c.v);
  assert.ok(speeds.reduce((a, b) => a + b, 0) / speeds.length > 12, 'island traffic moves at country-road speed');

  // A car a driver takes over leaves its lane, its junction and the island count.
  const car = [...T.all.values()].find(c => c.lane.kind === 'road'), n = T.islandCount;
  const J = car.lane.next[0]; if (J?.reserved) J.reserved.add(car.id); car.nextLane = J;
  T.detach(car);
  assert.equal(T.islandCount, n - 1); assert.equal(car.lane, null); assert.ok(!J?.reserved || !J.reserved.has(car.id));
});

test('a world without an island keeps only the city lanes', () => {
  const plain = generateWorld({ seed: 'island-traffic', nx: 3, nz: 3 }), T = new VehicleTraffic(plain, { seed: 'plain' });
  assert.equal(T.graphLanes.length, 0); assert.ok(T.lanes.every(l => !l.next.length));
  T.fill(12); for (let k = 0; k < 600; k++) T.step(0.1, 12 * 3600 + k / 10, 12);
  assert.equal(T.islandCount, 0); assert.ok(T.all.size > 0);
});

test('traffic stops for a car someone drives, and for someone on foot, ahead in its lane', () => {
  const T = new VehicleTraffic(world, { seed: 'island-traffic-obstacle' });
  const l = T.roadLanes.reduce((a, b) => (b.len > a.len ? b : a)), c = T.car(l, 50); l.cars.push(c); T.islandCount++; T.pose(c);
  const ahead = l.at(140, {}), obstacles = [{ x: ahead.x, z: ahead.z, len: 4.6 }];
  for (let k = 0; k < 600; k++) T.step(0.1, 12 * 3600, 12, obstacles);
  assert.ok(c.lane === l && c.s < 140 - 2.3 - 1.5 && c.v < 0.2, `stopped behind it (s ${c.s.toFixed(1)}, v ${c.v.toFixed(2)})`);
  for (let k = 0; k < 100; k++) T.step(0.1, 12 * 3600, 12, []);
  assert.ok(c.v > 5 || c.lane !== l, 'drives on once it has gone');
  const side = l.at(c.s + 30, {}), o2 = [{ x: side.x + Math.sin(side.yaw) * 3.7, z: side.z + Math.cos(side.yaw) * 3.7, len: 4.6 }];
  const v0 = c.v; for (let k = 0; k < 20; k++) T.step(0.1, 12 * 3600, 12, o2);
  assert.ok(c.v >= Math.min(v0, 5), 'a car in the next lane over is not in the way');
  // Something pushed in beside the car (not wholly ahead of its front) doesn't stop it in its tracks.
  const here = l.at(c.s + 1, {}), o3 = [{ x: here.x + Math.sin(here.yaw) * 2, z: here.z + Math.cos(here.yaw) * 2, len: 4.6 }];
  const s0 = c.s; for (let k = 0; k < 20; k++) T.step(0.1, 12 * 3600, 12, o3);
  assert.ok(c.lane !== l || c.s > s0 + 5, 'drives on past something beside it');
});

test('traffic obeys the signals at a busy junction beyond the city', async () => {
  const { signalFor } = await import('../shared/road-kit.js');
  const w2 = generateWorld({ seed: 'island-traffic-signals', nx: 3, nz: 3 }), g2 = makeGrid(w2.grid);
  w2.terrain = defaultIsland({ seed: 'island-traffic-signals:island', city: { x0: g2.minX, z0: g2.minZ, x1: g2.maxX, z1: g2.maxZ }, plainY: 0.1 });
  const I2 = new Island(w2.terrain);
  w2.roads = generateIslandRoads(I2, w2.grid);
  // two avenues crossing on flat dry land
  const um = v => Math.round(v * 1e6), T0 = w2.terrain;
  let Q = null;
  for (let fx = -0.6; fx <= 0.6 && !Q; fx += 0.1) for (let fz = -0.6; fz <= 0.6 && !Q; fz += 0.1) {
    const q = { x: T0.center.x + T0.radius * fx, z: T0.center.z + T0.radius * fz };
    const pts = [[0, 0], [-260, 0], [260, 0], [0, -260], [0, 260]].map(([dx, dz]) => ({ x: q.x + dx, z: q.z + dz }));
    if (pts.some(p => I2.waterAt(p.x, p.z) || I2.baseHeight(p.x, p.z) < T0.seaLevel + 3)) continue;
    const trial = RoadNetwork.fromJSON([...w2.roads, { id: 'av-a', profile: 'avenue-4', pts: [{ x: um(q.x - 260), z: um(q.z) }, { x: um(q.x + 260), z: um(q.z) }] }, { id: 'av-b', profile: 'avenue-4', pts: [{ x: um(q.x), z: um(q.z - 260) }, { x: um(q.x), z: um(q.z + 260) }] }]);
    if (!trial.validate().length && trial.junctions().filter(j => j.arms.some(a => a.id.startsWith('av-')) && j.kind !== 'end').length === 1) Q = q;
  }
  assert.ok(Q, 'a place for the crossing');
  w2.roads = [...w2.roads, { id: 'av-a', name: 'A', profile: 'avenue-4', pts: [{ x: um(Q.x - 260), z: um(Q.z) }, { x: um(Q.x + 260), z: um(Q.z) }] }, { id: 'av-b', name: 'B', profile: 'avenue-4', pts: [{ x: um(Q.x), z: um(Q.z - 260) }, { x: um(Q.x), z: um(Q.z + 260) }] }];
  const T = new VehicleTraffic(w2, { seed: 'signals' });
  const signalled = T.roadLanes.filter(l => l.signal && l.signal.plan.arms.some(a => a.id.startsWith('av-')));
  assert.equal(signalled.length, 8, 'two lanes come in on each of the four arms');
  // (2026-10-04: signals at every junction of two roads, whatever their type - the island's country roads' too)
  for (const P of T.roadLanes.filter(l => l.signal).map(l => l.signal.plan)) assert.ok(P.signals.length === P.arms.length, `${P.key}: a signal on every arm`);
  const countryJ = [...new Set(T.roadLanes.filter(l => l.signal && l.signal.plan.arms.every(a => a.sec.id === 'country')).map(l => l.signal.plan.key))];
  assert.ok(countryJ.length >= 1, 'country-road junctions are signalled');
  T.fill(17.7);
  let time = 17.7 * 3600, go = 0;
  const seen = new Map(), phases = new Set();
  for (let k = 0; k < 6000; k++) {   // 10 simulated minutes
    T.step(0.1, time, (time / 3600) % 24); time += 0.1;
    for (const l of signalled) for (const N of l.next) for (const id of N.reserved) {
      const key = `${N.id}|${id}`; if (seen.has(key)) continue; seen.set(key, true);
      const lt = signalFor(l.signal.plan, l.signal.arm, time - 0.1);
      assert.ok(lt === 2 || lt === 1 || (lt === 3 && N.turn === 'left'), `car ${id} committed to ${N.turn} on light ${lt}`);
      go++; phases.add(l.signal.plan.phases[l.signal.arm]);
    }
    for (const id of [...seen.keys()]) if (!signalled.some(l => l.next.some(N => N.reserved.has(id.split('|')[1] | 0)))) seen.delete(id);
  }
  assert.ok(go >= 6, `cars crossed (${go})`);
  assert.equal(phases.size, 2, 'on both phases');
});

test('a widened city: traffic leaves through its edge junctions and comes back; island lanes stop at the city\'s lights', async () => {
  const { DEFAULT_ROAD_PROFILES } = await import('../shared/roads.js');
  const { cityRoadSet } = await import('../shared/city-roads.js');
  const w3 = generateWorld({ seed: 'island-traffic-wide', nx: 3, nz: 3 });
  w3.grid = { ...w3.grid, road: 2 * DEFAULT_ROAD_PROFILES['avenue-4'].carriageHalf / 1e6 };
  const g3 = makeGrid(w3.grid);
  w3.terrain = defaultIsland({ seed: 'island-traffic-wide:island', city: { x0: g3.minX, z0: g3.minZ, x1: g3.maxX, z1: g3.maxZ }, plainY: 0.1 });
  w3.roads = generateIslandRoads(new Island(w3.terrain), w3.grid);
  const north = w3.roads.find(r => r.id === 'isl-north');
  assert.ok(Math.abs(north.pts[0].z / 1e6 - g3.Z[0]) < 0.01, 'the exit starts at the centre of the edge junction');
  const set = cityRoadSet(w3.grid, w3.roads);
  assert.ok([...set.plans.values()].some(P => P.kind === 'X' && P.arms.some(a => a.id === 'isl-north')), 'the edge junction has the exit as its fourth arm');
  const T = new VehicleTraffic(w3, { seed: 'wide' });
  assert.ok(T.roadLanes.some(l => l.signal?.portal), 'lanes coming into the city obey its lights');
  T.fill(17.7);
  let time = 17.7 * 3600, out = 0, back = 0;
  const onIsland = new Map();
  for (let k = 0; k < 6000; k++) {
    T.step(0.1, time, (time / 3600) % 24); time += 0.1;
    if (k % 25) continue;
    for (const c of T.all.values()) { const isl = !!c.lane.graph, was = onIsland.get(c.id); if (was === false && isl) out++; if (was === true && !isl) back++; onIsland.set(c.id, isl); }
  }
  assert.ok(out > 3 && back > 3, `cars went out (${out}) and came back (${back})`);
});
