// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A building connects to its street (shared/door-access.js; 2026-10-09: "lots should connect to roadways … this has to
// work flawlessly"): the straight way residents walk from the door to the sidewalk (city) or the road (beyond it) may
// not run through the building itself, another building beyond the city, or someone else's lot. And lots made beside a
// road (shared/plat-road.js) front it, a set number at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { makeGrid, blockAt, lotRect } from '../shared/city.js';
import { normalizeSpec } from '../shared/edit.js';
import { checkIslandBuilding } from '../shared/island-build.js';
import { pointAt } from '../shared/roads.js';
import { toWorld } from '../shared/geom.js';
import { doorWalk, doorReason } from '../shared/door-access.js';
import { platAlongRoad } from '../shared/plat-road.js';
import { overlaps } from '../shared/lots.js';

function islandWorld() {
  const world = generateWorld({ seed: 'door-access', population: 0 });
  const g = makeGrid(world.grid);
  world.terrain = defaultIsland({ seed: 'door-access:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  world.roads = generateIslandRoads(new Island(world.terrain), world.grid);
  return world;
}
/** A spot beside the Island Loop where an office fits, facing the road. */
function spotOnLoop(world, island) {
  const net = island.roads.net, G = net.geometry('isl-loop'), half = net.profiles[net.get('isl-loop').profile].outerHalf / 1e6;
  const env = { heightAt: (x, z) => island.height(x, z), isWater: (x, z) => !!island.waterAt(x, z), roads: net };
  for (let k = 0; k < 60; k++) {
    const q = pointAt(G, G.length * ((0.2 + k * 0.011) % 1), {});
    for (const side of [1, -1]) {
      const nx = -q.dz * side, nz = q.dx * side, r = half + 2.5 + 8;
      const s = normalizeSpec({ type: 'office', w: 14, d: 16, floors: 2, style: 'modern', x: q.x + nx * r, z: q.z + nz * r, rot: Math.atan2(-nx, -nz) * 180 / Math.PI }, world);
      if (!checkIslandBuilding(world, s, env)) return { spec: s, env, net, n: { x: nx, z: nz } };
    }
  }
  return null;
}

test('beyond the city: the door faces the road; nothing stands in the way out; nobody else\'s lot is crossed', () => {
  const world = islandWorld(), island = new Island(world.terrain, { roads: world.roads });
  const P = spotOnLoop(world, island);
  assert.ok(P, 'a spot beside the loop');
  const { spec, net } = P;
  const w = doorWalk(world, spec, net);
  assert.ok(w && w.road, 'the way out goes to the road');
  assert.equal(doorReason(world, spec, { net }), null, 'facing the road: connected');
  // turned away: the way to the road runs through the building
  assert.match(doorReason(world, { ...spec, rot: (spec.rot + 180) % 360 }, { net }), /door faces away from the road/);
  // a shed right in front of the door
  const front = toWorld(spec, 0, spec.d / 2 + 3);
  const shed = { idx: 7, name: 'Shed', type: 'shop', x: front.x, z: front.z, w: 4, d: 2, rot: spec.rot, base: 0, floors: 1 };
  world.buildings.push(shed);
  assert.match(doorReason(world, spec, { net }), /Shed is in the way/);
  assert.equal(doorReason(world, spec, { net, ignoreIdx: 7 }), null, 'the building being moved is not in its own way');
  world.buildings.pop();
  // standing between someone's door and the road
  const house = { ...spec, idx: 8, name: 'Blue House', base: 0, door: { x: 0, w: 2.4 } };
  world.buildings.push(house);
  const between = { ...spec, x: front.x, z: front.z, w: 4, d: 2 };
  assert.match(doorReason(world, between, { net }), /between Blue House's door and the road/);
  world.buildings.pop();
  // the way out crossing a neighbour's lot (the strip just behind the road is someone else's)
  const lotAt = (x, z) => (Math.hypot(x - w.b.x, z - w.b.z) < 1.5 ? 'L00NB' : 'L00ME');
  assert.match(doorReason(world, spec, { net, lotAt, lot: 'L00ME' }), /crosses lot L00NB/);
  assert.equal(doorReason(world, spec, { net, lotAt: () => 'L00ME', lot: 'L00ME' }), null, 'all on its own lot: fine');
  // parks have gates on every side
  assert.equal(doorReason(world, { ...spec, type: 'park', rot: (spec.rot + 180) % 360 }, { net }), null);
});

test('in the city: the way from the door to its street stays on its own lot', () => {
  const world = generateWorld({ seed: 'door-access-city', population: 0 }), g = makeGrid(world.grid);
  const blk = blockAt(g, (g.X[2] + g.X[3]) / 2, (g.Z[2] + g.Z[3]) / 2), r = lotRect(g, blk.i, blk.j);
  // an office near the block's +z side, facing it (rot 0): straight onto the sidewalk
  const spec = normalizeSpec({ type: 'office', w: 12, d: 12, floors: 2, x: (r.x0 + r.x1) / 2, z: r.z1 - 7, rot: 0 }, world);
  const w = doorWalk(world, spec, null);
  assert.ok(w && !w.road && w.b.z > w.a.z, 'out to the +z street');
  const zMid = (r.z0 + r.z1) / 2, lotAt = (x, z) => (z > zMid ? 'FRONT' : 'BACK');
  assert.equal(doorReason(world, spec, { lotAt, lot: 'FRONT' }), null, 'facing its own street');
  // the same office in the back half, its door facing the far street across the front lot
  const back = { ...spec, z: zMid - 8 };
  assert.match(doorReason(world, back, { lotAt, lot: 'BACK' }), /crosses lot FRONT: turn it so the door faces its own street/);
  assert.equal(doorReason(world, { ...back, rot: 180 }, { lotAt, lot: 'BACK' }), null, 'turned to its own street');
});

test('lots beside a road: a set number at a chosen place, fronting the road, sharing their side lines', () => {
  const world = islandWorld(), island = new Island(world.terrain, { roads: world.roads }), net = island.roads.net, g = makeGrid(world.grid);
  const opts = { side: 'a', width: 30.48, depth: 30.48, isWater: (x, z) => !!island.waterAt(x, z), city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, lots: [], buildings: [], pads: island.roads.pads };
  const G = net.geometry('isl-loop');
  let res = null, next = null, from = 0;
  for (; from < G.length - 400; from += 37) {
    res = platAlongRoad(net, 'isl-loop', { ...opts, from, to: from + 3 * 30.48 * 1.6 + 12, count: 3 });
    if (res.lots.length !== 3) continue;
    // carrying on the row from the last one's end
    const e = res.lots[2].frontage[0].s1;
    next = platAlongRoad(net, 'isl-loop', { ...opts, from: e, to: e + 60, count: 1, lots: res.lots });
    if (next.lots.length === 1) break;
  }
  assert.equal(res.lots.length, 3, 'three lots, no more');
  assert.ok(res.lots.every(l => l.frontage[0].road === 'isl-loop' && l.frontage[0].side === 'a'), 'each fronts the road');
  for (let k = 1; k < 3; k++) assert.equal(res.lots[k].frontage[0].s0, res.lots[k - 1].frontage[0].s1, 'side by side along the road');
  const a = res.lots[2].poly, b = next.lots[0].poly;
  assert.ok(a.some(p => b.some(q => p.x === q.x && p.z === q.z)), 'the next lot shares the row\'s side line');
  assert.ok(!overlaps(a, b), 'and overlaps nothing');
  // both sides: up to the count on each
  const both = platAlongRoad(net, 'isl-loop', { ...opts, side: 'both', from, to: from + 2 * 30.48 * 1.6 + 12, count: 2 });
  assert.ok(both.lots.filter(l => l.side === 'a').length <= 2 && both.lots.filter(l => l.side === 'b').length <= 2);
});
