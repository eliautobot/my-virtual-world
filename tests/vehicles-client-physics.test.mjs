// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Decision A20: the driver's browser simulates its own car with the shared LocalVehicleSim; the server validates,
// relays, refuses implausible poses and takes the car back (braked) when poses stop.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import { createVehicles, POSE_TTL } from '../server/world/vehicles.js';
import { generateWorld } from '../server/world/generate.js';
import { PlayerNav } from '../shared/playernav.js';
import { Store } from '../server/store.js';
import { decodeVehicles } from '../shared/vehicleproto.js';
import { blockAt, makeGrid } from '../shared/city.js';
import { GROUND_Y } from '../shared/constants.js';
import { VehicleDynamics } from '../shared/driving-classic/vehicle-dynamics.mjs';
import { LocalVehicleSim } from '../shared/vehicle-local.js';
import { buildVehicleStatics, packPose, unpackPose } from '../shared/vehicle-world.js';

const RIGS = JSON.parse(fs.readFileSync(new URL('../shared/vehicle-rigs.json', import.meta.url), 'utf8')).rigs;
const make = async () => {
  const world = generateWorld({ seed: 'driving-test', nx: 3, nz: 3 }), g = makeGrid(world.grid), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-a20-')), nav = new PlayerNav(world), messages = [];
  const clock = { now: 100000 };
  const players = { byId: new Map(), nav, spawnPoint: () => nav.defaultSpawn(), groundY: (x, z) => blockAt(nav.g, x, z) ? GROUND_Y : 0, canPlay: ws => !!ws.P.account, send: (ws, m) => messages.push({ ws, m }), toAccount: (id, m) => messages.push({ id, m }) };
  const store = new Store(dir);
  store.save('vehicles', { version: 1, worldId: 'a20', nextId: 1000, cars: [{ id: 900, k: 0, x: g.X[1], y: 0, z: g.Z[1], yaw: 0, col: 1, mode: 2, v: 0, s: 0, used: false, lastUser: null, deadline: null, region: 'outside' }] });
  const manager = await createVehicles({ world, worldId: 'a20', players, store, perms: { allowed: (P, cap) => cap === 'world.view' || !!P.account }, clock: () => ({ rate: 0, time: clock.now / 1000, hour: 12 }), now: () => clock.now });
  for (const c of [...manager.all.values()]) if (c.id !== 900) { manager.removeKinematic(c); manager.traffic.remove(c); }
  const packets = [], ws = { P: { account: { id: 1 } }, pid: 1, readyState: 1, bufferedAmount: 0, vehicleProtocol: 2, send: b => packets.push(decodeVehicles(b)) };
  const car = manager.all.get(900), rig = manager.rig(car);
  players.byId.set(1, { id: 1, x: car.x, y: 0, z: car.z + rig.halfWidth + .5, ctx: -1, flags: 0, ver: 0, conns: new Set([ws]), dirty: false });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { clock.now += 1000 / 60; manager.tick(); } };
  const last = t => messages.findLast(x => x.m.t === t)?.m;
  const enterClient = () => {
    manager.command(ws, { req: 1, op: 'enter', id: 900 }); assert.equal(last('drive_result').ok, true);
    manager.physicsMode(ws, { mode: 'client', id: 900 }); const reply = last('vphysics'); assert.equal(reply.mode, 'client');
    const sim = new LocalVehicleSim({ RAPIER, VehicleDynamics, world, rig, id: 900 }); sim.place(unpackPose(reply.state)); return sim;
  };
  let seq = 0;
  const drive = (sim, steps, input) => { for (let i = 0; i < steps; i++) { clock.now += 1000 / 60; sim.advance(1 / 60, input); if (i % 2) manager.pose(ws, { t: 'vpose', s: ++seq & 65535, ts: clock.now, ...packPose(sim.cur) }); manager.tick(); } };
  return { manager, world, g, ws, car, rig, clock, messages, packets, tick, last, enterClient, drive, send: (sim, extra = {}, ts = clock.now) => manager.pose(ws, { t: 'vpose', s: ++seq & 65535, ts, ...packPose({ ...sim.cur, ...extra }) }), close: () => { manager.dispose(); fs.rmSync(dir, { recursive: true, force: true }); } };
};
await RAPIER.init();

test('pose wire format round-trips and refuses malformed or non-unit rotations', () => {
  const s = { x: 1.5, y: .2, z: -3, rotation: { x: 0, y: Math.sin(.2), z: 0, w: Math.cos(.2) }, yaw: .4, v: 7, vx: 6.9, vy: 0, vz: -1, angular: { x: 0, y: .3, z: 0 }, steering: .1,
    wheels: [0, 1, 2, 3].map(i => ({ spin: i, suspensionLength: .2, contact: i !== 2, point: i !== 2 ? { x: i, y: 0, z: 1 } : null, normal: i !== 2 ? { x: 0, y: 1, z: 0 } : null, slip: .3 })) };
  const back = unpackPose(JSON.parse(JSON.stringify(packPose(s))));
  assert.ok(Math.abs(back.x - 1.5) < 1e-4 && Math.abs(back.angular.y - .3) < 1e-4 && back.wheels[2].point === null && back.wheels[1].contact);
  assert.equal(unpackPose({ p: [1, 2], w: [] }), null);
  const bad = packPose(s); bad.p[3] = 5; assert.equal(unpackPose(bad), null);
  const nan = packPose(s); nan.p[0] = NaN; assert.equal(unpackPose(JSON.parse(JSON.stringify(nan))), null);
});

test('server and browser build the same static collision world', () => {
  const world = generateWorld({ seed: 'driving-test', nx: 3, nz: 3 }), a = new RAPIER.World({ x: 0, y: -9.81, z: 0 }), b = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const sa = buildVehicleStatics(RAPIER, a, world), sb = new LocalVehicleSim({ RAPIER, VehicleDynamics, world, rig: RIGS[0], id: 1 }).statics;
  assert.equal(sa.bodies.length, sb.bodies.length); assert.equal(sa.solid.size, sb.solid.size); assert.ok(sa.solid.size > 0 && sa.solid.size < sa.bodies.length);
  a.free(); b.free();
});

test('a browser-simulated car is applied and relayed, without the server simulating or echoing it', async () => {
  const f = await make(); try {
    const sim = f.enterClient(); assert.equal(f.car.physics, 'client'); assert.equal(f.manager.body(f.car), null);
    const start = { x: f.car.x, z: f.car.z }; f.packets.length = 0;
    f.drive(sim, 150, { throttle: 1, steer: 0, brake: 0 });
    assert.equal(f.messages.filter(x => x.m.t === 'vcorrect').length, 0, 'no valid pose was refused');
    assert.ok(Math.hypot(f.car.x - start.x, f.car.z - start.z) > 5, 'server follows the browser');
    assert.ok(Math.abs(f.car.x - sim.cur.x) < .01 && Math.abs(f.car.v - sim.cur.v) < .01);
    assert.equal(f.packets.filter(p => p?.partial).length, 0, 'no owner echo while the browser simulates');
    f.manager.stream(f.ws); const frame = f.packets.at(-1), mine = frame.cars.find(c => c.id === 900);
    assert.ok(mine && Math.abs(mine.x - sim.cur.x) < 1, 'others receive the browser pose');
    assert.equal(f.car.physics, 'client');
  } finally { f.close(); }
});

test('teleports, overspeed and stale times are refused with the last accepted state; repeated refusals hand the car back', async () => {
  const f = await make(); try {
    const sim = f.enterClient(); f.drive(sim, 20, { throttle: 1 });
    const before = { x: f.car.x, z: f.car.z };
    f.clock.now += 33; f.send(sim, { x: sim.cur.x + 60 });
    let c = f.last('vcorrect'); assert.equal(c.why, 'distance'); assert.ok(Math.abs(unpackPose(c.state).x - before.x) < 1e-3); assert.equal(f.car.x, before.x);
    f.clock.now += 33; f.send(sim, { v: 200 }); assert.equal(f.last('vcorrect').why, 'speed');
    f.send(sim, {}, f.clock.now + 5000); assert.equal(f.last('vcorrect').why, 'time');
    for (let i = 0; i < 3; i++) { f.clock.now += 33; f.send(sim, { x: sim.cur.x + 80 }); }
    assert.equal(f.car.physics, 'server'); assert.ok(f.manager.body(f.car)); assert.equal(f.last('vphysics').mode, 'server'); assert.equal(f.last('vphysics').why, 'invalid');
  } finally { f.close(); }
});

test('a pose overlapping a building is refused', async () => {
  const f = await make(); try {
    f.enterClient(); f.tick();
    const B = f.world.buildings.find(b => b && !b.gone && b.type !== 'park' && !(b.rot % 180)), edge = B.x - B.w / 2;
    Object.assign(f.car, { x: edge - f.rig.halfLength - 1, z: B.z, y: 0, rotation: { x: 0, y: 0, z: 0, w: 1 }, yaw: 0 });
    const inside = { ...f.car, x: edge + .6, rotation: { x: 0, y: 0, z: 0, w: 1 }, angular: { x: 0, y: 0, z: 0 } };
    assert.equal(f.manager.poseProblem(f.car, unpackPose(packPose(inside)), f.car.poseAt + 200, f.clock.now + 200), 'collision');
    const outside = { ...inside, x: edge - f.rig.halfLength - .4 };
    assert.equal(f.manager.poseProblem(f.car, unpackPose(packPose(outside)), f.car.poseAt + 200, f.clock.now + 200), null);
  } finally { f.close(); }
});

test('when poses stop the server takes the car back and brakes it; the driver can switch back', async () => {
  const f = await make(); try {
    const sim = f.enterClient(); f.drive(sim, 120, { throttle: 1 }); const speed = f.car.v; assert.ok(speed > 3);
    f.tick(Math.ceil(POSE_TTL / (1000 / 60)) + 2);
    assert.equal(f.car.physics, 'server'); assert.equal(f.last('vphysics').why, 'timeout'); assert.ok(f.manager.body(f.car));
    f.tick(240); assert.ok(Math.abs(f.car.v) < speed * .5, `braked from ${speed} to ${f.car.v}`);
    f.manager.physicsMode(f.ws, { mode: 'client', id: 900 }); assert.equal(f.car.physics, 'client'); assert.equal(f.manager.body(f.car), null);
  } finally { f.close(); }
});

test('stopping and exiting a browser-simulated car uses the normal safe exit; re-entry works', async () => {
  const f = await make(); try {
    const sim = f.enterClient(); f.drive(sim, 60, { throttle: 1 }); f.drive(sim, 240, { brake: 1 });
    assert.ok(Math.abs(f.car.v) < .5);
    f.manager.command(f.ws, { req: 2, op: 'exit' }); assert.equal(f.last('drive_result').ok, true, f.last('drive_result').why);
    assert.equal(f.car.driver, 0); assert.equal(f.car.physics, 'server'); assert.ok(f.manager.body(f.car));
    f.tick(30); f.manager.command(f.ws, { req: 3, op: 'enter', id: 900 }); assert.equal(f.last('drive_result').ok, true);
  } finally { f.close(); }
});

test('server-driven input is ignored while the browser simulates, so it cannot keep the car alive', async () => {
  const f = await make(); try {
    f.enterClient(); for (let i = 0; i < Math.ceil(POSE_TTL / (1000 / 60)) + 10; i++) { f.manager.controls(f.ws, { seq: (i + 1) & 65535, throttle: 1 }); f.tick(); }
    assert.equal(f.car.physics, 'server', 'vinput alone does not count as poses');
  } finally { f.close(); }
});
