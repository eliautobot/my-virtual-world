// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Doors (shared/doors.js; 2026-10-05): every floor's doors come from what the floor is - the entrance, the doors the
// generators leave (L.doors, while a wall still ends at them), doorways cut in a line of walls by hand - and a door in a
// flat's corridor wall is that flat's front door.
import test from 'node:test';
import assert from 'node:assert/strict';
import { levelDoors, wallDoorways } from '../shared/doors.js';
import { generateLevels } from '../server/world/generate.js';
import { coreFor } from '../server/world/layouts.js';

const make = (type, w, d, floors) => { const b = { idx: 0, type, floors, w, d, x: 0, z: 0, rot: 0, seed: 7, door: { x: 0, w: type === 'apartment' ? 1.8 : 2.4 }, style: 'brick' }; b.core = coreFor(b); const W = { levels: [], buildings: [b] }; generateLevels(W, b, null); return { b, W }; };

test('an apartment floor: a front door for every flat, and the doors inside the flats', () => {
  const { b, W } = make('apartment', 30, 20, 3), L = W.levels[b.lv[1]], ds = levelDoors(b, 1, L);
  const flats = ds.filter(d => d.kind === 'flat');
  assert.equal(flats.length, L.units.length, 'one front door per flat');
  assert.deepEqual([...new Set(flats.map(d => d.u))].sort((p, q) => p - q), L.units.map((_, i) => i));
  assert.ok(ds.filter(d => d.kind === 'room').length >= L.units.length, 'bathroom and bedroom doors too');
  assert.ok(flats.every(d => d.swing === (L.units[d.u].z0 + L.units[d.u].z1 > 0 ? 1 : -1)), 'front doors open into their flat');
  assert.equal(new Set(ds.map(d => d.key)).size, ds.length, 'keys are unique');
});

test('the street floor has the entrance: glass doors that part on shops and offices, double doors on apartments', () => {
  assert.equal(levelDoors(make('shop', 18, 14, 1).b, 0, make('shop', 18, 14, 1).W.levels[0]).find(d => d.kind === 'entrance').style, 'slide');
  const a = make('apartment', 26, 18, 3);
  assert.equal(levelDoors(a.b, 0, a.W.levels[a.b.lv[0]]).find(d => d.kind === 'entrance').style, 'double');
});

test('a doorway cut in a wall by hand is a door; a door whose walls were taken down is gone', () => {
  assert.deepEqual(wallDoorways([[0, 0, 2, 0, 0], [3, 0, 5, 0, 0]]).map(d => [d.x, d.z, d.w, d.axis]), [[2.5, 0, 1, 'x']]);
  assert.equal(wallDoorways([[0, 0, 2, 0, 0], [4, 0, 6, 0, 0]]).length, 0, 'too wide for a door');
  const b = { type: 'office', d: 20 }, L = { items: [], walls: [], doors: [{ x: 1, z: 1, w: 0.9, axis: 'x' }] };
  assert.equal(levelDoors(b, 1, L).length, 0, 'no wall ends at it any more');
});
