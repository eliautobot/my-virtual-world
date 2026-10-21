// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The roads drawn with the road tools (the product owner 2026-10-21, on the starting map, where every street is drawn):
// cars feel their curbs and sidewalks (the heightfield lay flat under a road's whole width), traffic doesn't lock up at
// junctions (don't block the box) and turns smoothly through them (no heading jumps between a connector's points).
import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { readStarter } from '../server/world/starter.js';
import { Island } from '../shared/terrain.js';
import { pointAt } from '../shared/roads.js';
import { TerrainColliders } from '../shared/terrain-physics.js';
import { VehicleTraffic } from '../shared/vehicle-traffic.js';
import { buildLaneGraph } from '../shared/lane-graph.js';
import { CURB_RISE, sectionOf } from '../shared/road-kit.js';

const world = readStarter().world, island = new Island(world.terrain, { roads: world.roads }), R = island.roads;
const avenue = R.net.all().find(r => r.profile === 'avenue-4');   // (its middle is mid-block: the grid's blocks are ~90 m)

test('cars feel a drawn avenue\'s curbs and sidewalks, and its junctions\' corners, where they are drawn', async () => {
  await RAPIER.init();
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 }), T = new TerrainColliders(RAPIER, physics, island, { radius: 1 });
  const G = R.net.geometry(avenue.id), m = pointAt(G, G.length / 2, {}), sec = sectionOf(R.profiles['avenue-4']);
  const J = R.pads.find(P => P.foot && Math.hypot(P.x - m.x, P.z - m.z) < 200);
  T.update([{ x: m.x, z: m.z }, ...(J ? [{ x: J.x, z: J.z }] : [])]); physics.step();
  const ray = (x, z) => { const y0 = (R.top(x, z) ?? 0) + 5, h = physics.castRay(new RAPIER.Ray({ x, y: y0, z }, { x: 0, y: -1, z: 0 }), 20, true); return h ? y0 - h.timeOfImpact : NaN; };
  const across = o => ray(m.x - m.dz * o, m.z + m.dx * o);
  const road = across(0);
  for (const sd of [1, -1]) {
    assert.ok(Math.abs(across(sd * (sec.carriage - 0.4)) - road) < 0.02, 'the gutter is at the road\'s level');
    assert.ok(Math.abs(across(sd * (sec.carriage + 0.3)) - road - CURB_RISE) < 0.02, 'the curb stands CURB_RISE proud');
    assert.ok(Math.abs(across(sd * (sec.sidewalk.o1 - 0.3)) - road - CURB_RISE) < 0.02, 'the sidewalk is as high as the curb');
  }
  assert.ok(J, 'a junction near by');
  let n = 0, off = 0;
  for (let dx = -40; dx <= 40; dx += 0.5) for (let dz = -40; dz <= 40; dz += 0.5) {
    const x = J.x + dx, z = J.z + dz, t = R.top(x, z); if (t === null) continue;
    n++; if (Math.abs(ray(x, z) - (t - 0.075)) > 0.04) off++;
  }
  assert.ok(n > 5000 && off / n < 0.005, `the physics matches the drawn junction (${off} of ${n} points off)`);
});

test('a turn through a junction changes heading smoothly (no jump where two of its pieces meet)', () => {
  const { connectors } = buildLaneGraph(R), c = {};
  let worst = 0;
  for (const C of connectors) {
    if (C.turn === 'around') continue;   // (a dead end's U-turn is as tight as the road is wide)
    let prev = null;
    for (let s = 0; s <= C.len; s += 0.05) {
      C.at(s, c);
      if (prev !== null) { let d = c.yaw - prev; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; worst = Math.max(worst, Math.abs(d)); }
      prev = c.yaw;
    }
  }
  assert.ok(connectors.length > 50 && worst < 0.04, `heading steps at most ${worst.toFixed(3)} rad per 5 cm`);
});

test('rush-hour traffic on the drawn grid keeps moving: no car stands still for minutes, none blocks a junction', () => {
  const T = new VehicleTraffic(world, { seed: 'drawn-roads' }), hour = 17.7, dt = 0.1, still = new Map();
  T.fill(hour);
  let t = 0, stuck = 0;
  for (let k = 0; k < 40 * 600; k++) {
    T.step(dt, t, hour); t += dt;
    for (const c of T.all.values()) {
      const s = c.v < 0.1 ? (still.get(c.id) || 0) + dt : 0; still.set(c.id, s);
      // stopped on a connector means stopped inside a junction: only ever briefly (a walker crossing in front)
      if (c.lane?.kind === 'path' && s > 20) assert.fail(`car ${c.id} stood ${s.toFixed(0)} s inside junction ${c.lane.junction}`);
    }
  }
  for (const s of still.values()) if (s > 120) stuck++;
  assert.ok(T.all.size > 100, 'the roads are busy');
  assert.equal(stuck, 0, `${stuck} cars stood still over two minutes`);
});
