// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.3 driving on the island: beyond the city the ground is the island's terrain (roads graded in), for the driver's own
// browser simulation and for the server's; the server accepts poses anywhere on the island above the ground and out of
// deep water; water slows a car, stops it at its wading depth and always lets it back out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import { createVehicles } from '../server/world/vehicles.js';
import { generateWorld } from '../server/world/generate.js';
import { PlayerNav } from '../shared/playernav.js';
import { Store } from '../server/store.js';
import { makeGrid } from '../shared/city.js';
import { GROUND_Y } from '../shared/constants.js';
import { OutdoorGround, apronRects, roadCuts, APRON_M } from '../shared/city-edge.js';
import { VehicleDynamics } from '../shared/driving-classic/vehicle-dynamics.mjs';
import { LocalVehicleSim } from '../shared/vehicle-local.js';
import { packPose, unpackPose } from '../shared/vehicle-world.js';
import { defaultIsland, Island, GroundQuery } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { pointAt } from '../shared/roads.js';
import { profileAt } from '../shared/island-roads.js';
import { waterDepth, POSE_MAX_DEPTH, WADE_MAX } from '../shared/vehicle-water.js';

const RIGS = JSON.parse(fs.readFileSync(new URL('../shared/vehicle-rigs.json', import.meta.url), 'utf8')).rigs;
await RAPIER.init({});

// One island world for every test: a small city, its island and the island's roads, as tools/wp4 lay them.
const world = generateWorld({ seed: 'island-drive', nx: 3, nz: 3 }), g = makeGrid(world.grid);
world.terrain = defaultIsland({ seed: 'island-drive:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
world.roads = generateIslandRoads(new Island(world.terrain), world.grid);
const island = new Island(world.terrain, { roads: world.roads }), ground = new GroundQuery(island);
const inCity = (x, z) => x >= g.minX - 10 && x <= g.maxX + 10 && z >= g.minZ - 10 && z <= g.maxZ + 10;
const outdoor = new OutdoorGround(g, world.roads, ground), groundY = (x, z) => outdoor.height(x, z);
const yawQ = yaw => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
const NORTH = Math.PI / 2;   // forward is (cos yaw, −sin yaw): yaw π/2 faces −z
const mid = Math.floor(g.nx / 2);

const make = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-isl-drive-')), nav = new PlayerNav(world, { ground }), messages = [], clock = { now: 100000 };
  const players = { byId: new Map(), nav, spawnPoint: () => nav.defaultSpawn(), groundY, canPlay: ws => !!ws.P.account, send: (ws, m) => messages.push({ ws, m }), toAccount: (id, m) => messages.push({ id, m }) };
  const store = new Store(dir);
  // A car on the middle avenue, near the city's north edge, facing north (out of the city).
  store.save('vehicles', { version: 1, worldId: 'isl', nextId: 1000, cars: [{ id: 900, k: 0, x: g.X[mid], y: 0, z: g.minZ + 14, yaw: NORTH, col: 1, mode: 2, v: 0, s: 0, used: false, lastUser: null, deadline: null, region: 'outside' }] });
  const manager = await createVehicles({ world, worldId: 'isl', players, store, perms: { allowed: (P, cap) => cap === 'world.view' || !!P.account }, clock: () => ({ rate: 0, time: clock.now / 1000, hour: 12 }), now: () => clock.now });
  for (const c of [...manager.all.values()]) if (c.id !== 900) { manager.removeKinematic(c); manager.traffic.remove(c); }
  const ws = { P: { account: { id: 1 } }, pid: 1, readyState: 1, bufferedAmount: 0, vehicleProtocol: 2, send: () => {} };
  const car = manager.all.get(900), rig = manager.rig(car);
  players.byId.set(1, { id: 1, x: car.x + rig.halfWidth + .5, y: 0, z: car.z, ctx: -1, flags: 0, ver: 0, conns: new Set([ws]), dirty: false });
  const last = t => messages.findLast(x => x.m.t === t)?.m;
  manager.command(ws, { req: 1, op: 'enter', id: 900 }); assert.equal(last('drive_result').ok, true, last('drive_result').msg);
  return { manager, ws, car, rig, clock, messages, last, close: () => { manager.dispose(); fs.rmSync(dir, { recursive: true, force: true }); } };
};

test('a browser-simulated car drives out of the city along the island road; the server accepts every pose', async () => {
  const f = await make(); try {
    f.manager.physicsMode(f.ws, { mode: 'client', id: 900 }); const reply = f.last('vphysics'); assert.equal(reply.mode, 'client');
    const sim = new LocalVehicleSim({ RAPIER, VehicleDynamics, world, rig: f.rig, id: 900, island }); sim.place(unpackPose(reply.state));
    let seq = 0, lowest = Infinity, edgeLo = Infinity, edgeHi = -Infinity;
    for (let i = 0; i < 60 * 30; i++) {
      f.clock.now += 1000 / 60; sim.advance(1 / 60, { throttle: sim.cur.v < 20 ? .8 : 0, steer: 0, brake: 0 });
      if (i % 2) f.manager.pose(f.ws, { t: 'vpose', s: ++seq & 65535, ts: f.clock.now, ...packPose(sim.cur) });
      f.manager.tick();
      if (i > 60 && !inCity(sim.cur.x, sim.cur.z)) lowest = Math.min(lowest, sim.cur.y - ground.height(sim.cur.x, sim.cur.z));
      if (i > 60 && sim.cur.z > g.minZ - APRON_M - 6 && sim.cur.z < g.minZ + 6) { edgeLo = Math.min(edgeLo, sim.cur.y); edgeHi = Math.max(edgeHi, sim.cur.y); }
    }
    assert.ok(edgeHi - edgeLo < 0.08, `no step where the road leaves the city (${edgeLo.toFixed(3)}…${edgeHi.toFixed(3)} m)`);
    assert.equal(f.messages.filter(x => x.m.t === 'vcorrect').length, 0, 'no pose on the island was refused');
    assert.ok(f.car.z < g.minZ - 300, `the car left the city (${(g.minZ - f.car.z).toFixed(0)} m beyond its edge)`);
    assert.ok(lowest > -0.15 && lowest < 1, `the car stays on the ground beyond the city (lowest clearance ${lowest.toFixed(2)} m)`);
    sim.dispose();
  } finally { f.close(); }
});

test('a server-simulated car drives on the island terrain too', async () => {
  const f = await make(); try {
    let lowest = Infinity;
    for (let i = 0; i < 60 * 30; i++) {
      f.clock.now += 1000 / 60;
      f.manager.controls(f.ws, { seq: (i + 1) & 65535, throttle: (f.car.v || 0) < 20 ? .8 : 0, steer: 0, brake: 0 });
      f.manager.tick();
      if (i > 60 && !inCity(f.car.x, f.car.z)) lowest = Math.min(lowest, (f.car.y || 0) - ground.height(f.car.x, f.car.z));
    }
    assert.ok(f.car.z < g.minZ - 300, `the car left the city (${(g.minZ - f.car.z).toFixed(0)} m)`);
    assert.ok(lowest > -0.15 && lowest < 1, `on the ground (lowest clearance ${lowest.toFixed(2)} m)`);
    // 3 × 3 chunks around the car, plus the ones just passed until they go unused for 2 s
    const built = [...f.manager.terrain.live.values()].filter(e => e.body).length;
    assert.ok(built > 0 && built <= 15, `terrain colliders only around the car (${built})`);
  } finally { f.close(); }
});

test('water stops a car at its wading depth, holds it there and lets it back out', () => {
  const G = island.roads.net.geometry('isl-beach'), prof = island.roads.prof.get('isl-beach'), s0 = G.length - 60, p = pointAt(G, s0, {});
  const sim = new LocalVehicleSim({ RAPIER, VehicleDynamics, world, rig: RIGS[0], id: 1, island }), SOUTH = -Math.PI / 2;
  sim.place({ x: p.x, y: profileAt(prof, s0) + .4, z: p.z, rotation: yawQ(SOUTH), yaw: SOUTH, v: 0, vx: 0, vy: 0, vz: 0, angular: { x: 0, y: 0, z: 0 }, steering: 0, wheels: [] });
  let deepest = 0;
  const run = (secs, throttle) => { for (let i = 0; i < secs * 60; i++) { sim.advance(1 / 60, { throttle, steer: 0, brake: 0 }); deepest = Math.max(deepest, waterDepth(island, sim.cur.x, sim.cur.z)); } };
  run(30, 1);   // a beach shelves gently: the car slows as it wades in and stalls at its wading depth
  assert.ok(deepest > WADE_MAX * .5, `the car reached the water (${deepest.toFixed(2)} m)`);
  assert.ok(deepest < POSE_MAX_DEPTH, `but not beyond what the server accepts (${deepest.toFixed(2)} m)`);
  assert.ok(deepest <= WADE_MAX + 0.1, `not past its wading depth under power (${deepest.toFixed(2)} m)`);
  assert.ok(Math.abs(sim.cur.v) < .5, 'full throttle no longer moves it deeper');
  const z = sim.cur.z; run(10, 0);
  assert.ok(Math.abs(sim.cur.z - z) < .1, 'a stopped car doesn\'t roll deeper');
  run(16, -1);
  assert.equal(waterDepth(island, sim.cur.x, sim.cur.z), 0, 'reversing brings it back to dry land');
  sim.dispose();
});

test('the server refuses poses deep in the water or under the ground, and far off the island', async () => {
  const f = await make(); try {
    f.manager.physicsMode(f.ws, { mode: 'client', id: 900 });
    const base = unpackPose(f.last('vphysics').state), c = f.car;
    const at = (x, z, y) => { Object.assign(c, { x, y, z }); return f.manager.poseProblem(c, unpackPose(packPose({ ...base, x, y, z })), c.poseAt + 200, f.clock.now + 200); };
    // a point on dry land beyond the city, a point in deep sea, and one far beyond the island
    const G = island.roads.net.geometry('isl-north'), p = pointAt(G, G.length * .5, {}), gy = ground.height(p.x, p.z);
    assert.equal(at(p.x, p.z, gy), null, 'on the island road');
    assert.equal(at(p.x, p.z, gy - 4), 'bounds', 'under the ground');
    const cz = world.terrain.center.z, r = world.terrain.radius;
    let sea = null; for (let d = r * .8; d < r * 1.3 && !sea; d += 20) if (waterDepth(island, world.terrain.center.x, cz - d) > POSE_MAX_DEPTH + .5) sea = { x: world.terrain.center.x, z: cz - d };
    assert.ok(sea, 'found deep sea north of the island');
    assert.equal(at(sea.x, sea.z, ground.height(sea.x, sea.z)), 'water', 'deep water');
    assert.equal(at(world.terrain.center.x, cz - r * 2, 0), 'bounds', 'far off the island');
  } finally { f.close(); }
});

test('the apron around the city opens where island roads leave it, at street level', () => {
  const cuts = roadCuts(g, world.roads), exits = ['isl-north', 'isl-east', 'isl-west', 'isl-beach'];
  for (const id of exits) assert.ok(cuts.some(c => c.road === id), `${id} crosses the city's edge`);
  assert.ok(!cuts.some(c => c.road === 'isl-loop'), 'the island loop never reaches the city');
  const rects = apronRects(g, world.roads), on = (x, z) => rects.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  // the north exit: open along the road, apron either side of it
  const xN = g.X[mid];
  assert.ok(!on(xN, g.minZ - 5), 'the road runs through the apron');
  assert.ok(on(xN + 12, g.minZ - 5) && on(xN - 12, g.minZ - 5), 'the apron either side of the road');
  assert.equal(outdoor.height(xN + 12, g.minZ - 5), GROUND_Y);
  // the road eases from the city's street level (0) toward the plain, below the apron's kerb height
  assert.ok(Math.abs(outdoor.height(xN, g.minZ - 5)) < 0.1, `the road near street level (${outdoor.height(xN, g.minZ - 5).toFixed(3)})`);
  // corners and plain sides are closed; beyond the apron the terrain takes over
  assert.ok(on(g.minX - 5, g.minZ - 5) && on(g.maxX + 5, g.maxZ + 5));
  assert.equal(outdoor.height(g.minX - APRON_M - 20, g.Z[0]), ground.height(g.minX - APRON_M - 20, g.Z[0]));
  // a world without island roads: one closed ring
  assert.equal(apronRects(g, []).length, 4);
});
