// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Where a player may stand (shared/playernav.js, PLAN WP1.10, I14.10): the server's validation, the soft push between
// players and the doorway rule, on a generated city.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayerNav, pushApart, PUSH_RADIUS, RUN_SPEED } from '../../shared/playernav.js';
import { toWorld } from '../../shared/geom.js';
import { encodePlayers, decodePlayers, PF_OBSERVING, PF_YOU } from '../../shared/playerproto.js';
import { testCity } from '../helpers/world.mjs';

const { world } = testCity({ seed: 'playernav-test', population: 100 });
const nav = new PlayerNav(world);
const office = world.buildings.find(b => b && !b.gone && b.type === 'office' && b.floors >= 2);

test('outside: open ground is fine, inside a building\'s walls is not, its doorway is', () => {
  const sp = nav.defaultSpawn();
  assert.ok(nav.ok(sp.x, sp.z, -1), 'the default spawn is on open ground');
  assert.equal(nav.ok(office.x, office.z, -1), false, 'the middle of a building is not outside');
  const door = toWorld(office, office.door.x, office.d / 2 - 0.3);
  assert.ok(nav.ok(door.x, door.z, -1), 'its doorway is passable from outside');
  assert.equal(nav.ok(NaN, 0, -1), false);
  assert.equal(nav.ok(1e6, 1e6, -1), false, 'far off the map is not');
});

test('inside: the floor plan and its walkable cells; a missing floor is not a place', () => {
  const ctx = office.idx * 64 + 1;
  const v = nav.nearestValid(office.x, office.z, ctx);
  assert.ok(v && v.ctx === ctx, 'the nearest valid spot on the first floor');
  assert.ok(nav.ok(v.x, v.z, ctx));
  assert.equal(nav.ok(v.x, v.z, office.idx * 64 + office.floors), false, 'a floor above the roof is not');
  const out = toWorld(office, office.w, 0);
  assert.equal(nav.ok(out.x, out.z, ctx), false, 'off the floor plan is not');
});

test('the soft push closes an overlap gently, never pins anyone, and leaves clear players alone (I14.10)', () => {
  assert.deepEqual(pushApart(0, 0, [[5, 0]], 1 / 60), { dx: 0, dz: 0 }, 'players apart do not push');
  const v = pushApart(0, 0, [[0.3, 0]], 1 / 60);
  assert.ok(v.dx < 0 && Math.abs(v.dz) < 1e-9, 'pushed away from the other player');
  assert.ok(Math.abs(v.dx) <= PUSH_RADIUS - 0.3 + 1e-9, 'never farther than the overlap');
  // per second the push is well below a walk (1.55 m/s), so walking always wins: nobody can pin anyone
  const perSecond = Math.hypot(pushApart(0, 0, [[0.59, 0]], 1).dx, 0);
  assert.ok(perSecond <= PUSH_RADIUS, 'at most the overlap, even over a whole second');
  const stacked = pushApart(1, 1, [[1, 1]], 1 / 60);
  assert.ok(stacked.dx > 0, 'exactly on top: a fixed direction, not a division by zero');
  // simulate two players standing on each other: they separate to about PUSH_RADIUS within a second
  let a = [0, 0], b = [0.1, 0];
  for (let k = 0; k < 60; k++) {
    const va = pushApart(a[0], a[1], [b], 1 / 60), vb = pushApart(b[0], b[1], [a], 1 / 60);
    a = [a[0] + va.dx, a[1] + va.dz]; b = [b[0] + vb.dx, b[1] + vb.dz];
  }
  assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) > PUSH_RADIUS * 0.9, 'two players on top of each other are apart within a second');
  assert.ok(RUN_SPEED > 1.55);
});

test('doorways and elevators are no-push zones, so a player can never block them (I14.10)', () => {
  const door = toWorld(office, office.door.x, office.d / 2 + 0.4);
  assert.ok(nav.inDoorway(door.x, door.z, -1), 'in front of the door (outside)');
  const inside = toWorld(office, office.door.x, office.d / 2 - 0.6);
  assert.ok(nav.inDoorway(inside.x, inside.z, office.idx * 64), 'just inside the door (ground floor)');
  // open ground with no door within 5 m is not a doorway
  let open = null;
  const g = nav.g;
  for (let z = g.minZ + 5; z < g.maxZ - 5 && !open; z += 3) for (let x = g.minX + 5; x < g.maxX - 5 && !open; x += 3) {
    if (!nav.ok(x, z, -1)) continue;
    const doorNear = world.buildings.some(b => b && !b.gone && b.door && Math.hypot(toWorld(b, b.door.x, b.d / 2).x - x, toWorld(b, b.door.x, b.d / 2).z - z) < 5);
    if (!doorNear) open = { x, z };
  }
  assert.ok(open, 'somewhere open, away from doors');
  assert.equal(nav.inDoorway(open.x, open.z, -1), false, 'open ground away from doors is not a doorway');
  // a spot on the first floor away from its elevators is not either
  const ctx = office.idx * 64 + 1, grid = nav.gridFor(office, 1);
  let spot = null;
  for (let c = 0; c < grid.blocked.length && !spot; c++) {
    if (grid.blocked[c]) continue;
    const lx = grid.x0 + ((c % grid.gw) + 0.5) * grid.cell, lz = grid.z0 + (Math.floor(c / grid.gw) + 0.5) * grid.cell, w = toWorld(office, lx, lz);
    if (!nav.nearElevator(office, w.x, w.z, 3)) spot = w;
  }
  assert.ok(spot, 'a walkable spot away from the elevators');
  assert.equal(nav.inDoorway(spot.x, spot.z, ctx), false, 'the rest of a floor is not a doorway');
});

test('the player frame round-trips: ids, positions, heading, place, animation, flags and sequence', () => {
  const list = [
    { pid: 7, x: 12.5, y: 0.15, z: -40.25, yaw: 3.0, ctx: -1, clip: 3, flags: PF_OBSERVING, seq: 65535 },
    { pid: 123456, x: -300, y: 3.55, z: 210.5, yaw: -2.5, ctx: 17 * 64 + 2, clip: 0, flags: PF_YOU, seq: 1 },
  ];
  const buf = encodePlayers(list, 1_700_000_000_123), out = [];
  assert.equal(buf.byteLength, 12 + 24 * 2, '24 bytes a player');
  const n = decodePlayers(buf, (e, t) => out.push({ ...e, t }));
  assert.equal(n, 2);
  for (let k = 0; k < 2; k++) {
    const a = list[k], b = out[k];
    assert.equal(b.pid, a.pid); assert.equal(b.ctx, a.ctx); assert.equal(b.clip, a.clip); assert.equal(b.flags, a.flags); assert.equal(b.seq, a.seq);
    assert.ok(Math.abs(b.x - a.x) < 1e-3 && Math.abs(b.z - a.z) < 1e-3 && Math.abs(b.yaw - a.yaw) < 1e-3);
    assert.equal(b.t, 1_700_000_000_123);
  }
  assert.equal(decodePlayers(new Uint8Array([1, 0, 0, 0]).buffer, () => {}), 0, 'another frame type is not a player frame');
});
