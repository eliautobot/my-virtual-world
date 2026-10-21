// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Editing rules shared by the client previews and the server checks (shared/edit.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSpec, checkItem, levelConnected, checkBuilding } from '../../shared/edit.js';
import { elevatorStops } from '../../shared/building.js';
import { makeGrid, lotRect } from '../../shared/city.js';
import { MAX_FLOORS } from '../../shared/constants.js';
import { testCity } from '../helpers/world.mjs';

// A 20 x 16 m office with an elevator core at the back and the entrance at the front (+z).
const office = () => ({ idx: 0, type: 'office', name: 'Test Office', x: 0, z: 0, w: 20, d: 16, rot: 0, floors: 2, door: { x: 0, w: 2.4 }, core: { t: 'elevator', x: 0, z: -6.3, r: 0 } });
const level = (items = [], walls = []) => ({ items: [{ t: 'elevator', x: 0, z: -6.3, r: 0, id: 1 }, ...items], walls });
const plant = (x, z) => ({ t: 'plant', x, z, r: 0 });

test('normalizeSpec snaps and clamps a new building', () => {
  assert.deepEqual(normalizeSpec({ type: 'nope', w: 3, d: 999, floors: 99, rot: 100, style: 'x', x: 1.26, z: -3.74 }),
    { type: 'office', rot: 90, w: 10, d: 50, floors: MAX_FLOORS, style: 'modern', x: 1.5, z: -3.5 });
  const park = normalizeSpec({ type: 'park', w: 5, d: 20, floors: 3, rot: -90 });
  assert.equal(park.floors, 1);
  assert.equal(park.w, 14);
  assert.equal(park.rot, 270);
  const apt = normalizeSpec({ type: 'apartment', w: 5, d: 5 });
  assert.deepEqual([apt.w, apt.d], [13, 17]);
  assert.equal(normalizeSpec({ type: 'cafe', floors: 9 }).floors, 4);
});

test('checkItem refuses bad placements with a reason', () => {
  const b = office(), up = level([{ t: 'sofa', x: 5, z: 3, r: 0, id: 2 }], [[-8, 2, -2, 2, 0]]);
  assert.equal(checkItem(b, 1, up, { t: 'nope', x: 0, z: 0, r: 0 }), 'Unknown item type');
  assert.equal(checkItem(b, 1, up, { t: 'elevator', x: 0, z: 0, r: 0 }), 'That is part of the building');
  assert.equal(checkItem(b, 1, up, { t: 'door', x: 0, z: 0, r: 0 }), 'That is part of the building');
  assert.equal(checkItem(b, 1, up, { t: 'plant', x: NaN, z: 0, r: 0 }), 'Bad position');
  assert.equal(checkItem(b, 1, up, plant(9.9, 0)), 'Outside the floor');
  assert.equal(checkItem(b, 0, level(), plant(0, 7.2)), 'Blocks the entrance');
  const stop = elevatorStops(b)[0];
  assert.equal(checkItem(b, 1, up, plant(stop.x, stop.z)), 'Blocks the elevator');
  assert.equal(checkItem(b, 1, up, plant(5, 3)), 'Overlaps the sofa');
  assert.equal(checkItem(b, 1, up, plant(-5, 2)), 'Overlaps a wall');
  assert.equal(checkItem(b, 1, up, { t: 'rug', x: 5, z: 3, r: 0 }), null, 'rugs may lie under furniture');
  assert.equal(checkItem(b, 1, up, plant(-5, 4)), null, 'a free spot');
  assert.equal(checkItem(b, 1, up, { ...up.items[1], x: 5.2 }, 2), null, 'moving an item ignores itself');
});

test('levelConnected: a wall across the floor cuts the entrance off from the elevator', () => {
  const b = office();
  assert.equal(levelConnected(b, 0, level()), true);
  assert.equal(levelConnected(b, 0, level([], [[-10, 2, 10, 2, 0]])), false);
  assert.equal(levelConnected(b, 0, level([], [[-10, 2, -1, 2, 0], [1.5, 2, 10, 2, 0]])), true, 'a doorway keeps it connected');
});

test('every generated floor keeps its entrances and elevators connected', () => {
  const { world } = testCity();
  let floors = 0;
  const bad = [];
  for (const B of world.buildings) {
    if (!B || B.gone) continue;
    for (let f = 0; f < B.floors; f++) {
      floors++;
      if (!levelConnected(B, f, world.levels[B.lv[f]])) bad.push(`${B.name} floor ${f + 1}`);
    }
  }
  assert.ok(floors > 500, `${floors} floors`);
  assert.deepEqual(bad, []);
});

test('checkBuilding: a free lot takes a new building; streets, sidewalks and neighbours are refused', () => {
  const { world } = testCity();
  for (const b of world.buildings) b.gone = 1;
  const g = makeGrid(world.grid);
  const lot = lotRect(g, 4, 3);
  const spec = normalizeSpec({ type: 'cafe', w: 12, d: 14, floors: 1, x: (lot.x0 + lot.x1) / 2, z: (lot.z0 + lot.z1) / 2 });
  assert.equal(checkBuilding(world, spec), null);
  assert.equal(checkBuilding(world, { ...spec, x: lot.x1 - 3 }), 'Keep it off the sidewalk');
  assert.equal(checkBuilding(world, { ...spec, x: g.X[5] }), 'Place it on a city block, not on a street');
  const nb = world.buildings.find(b => b.type === 'office');
  delete nb.gone;
  assert.equal(checkBuilding(world, normalizeSpec({ type: 'cafe', w: 10, d: 10, x: nb.x, z: nb.z, rot: nb.rot })), `Too close to ${nb.name}`);
});
