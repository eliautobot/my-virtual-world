// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Indoor navigation grid and A* paths, shared by the server planner and the client player (shared/navgrid.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGrid, findPath, lineFree, pathLength, walkable, nearestFree, flood, cellOf, wallBetween, nearWall } from '../../shared/navgrid.js';

const room = { type: 'office', w: 20, d: 20 };

test('a clear room gives a straight path', () => {
  const g = buildGrid(room, { items: [], walls: [] });
  assert.deepEqual(findPath(g, -8, 0, 8, 0), [[-8, 0], [8, 0]]);
});

test('paths go around a wall through its gap and never cross blocked cells', () => {
  const g = buildGrid(room, { items: [], walls: [[0, -10, 0, 6, 0]] });
  const p = findPath(g, -8, 0, 8, 0);
  assert.ok(p && p.length >= 3, JSON.stringify(p));
  for (let k = 1; k < p.length; k++) assert.ok(lineFree(g, p[k - 1][0], p[k - 1][1], p[k][0], p[k][1]), `segment ${k} crosses a blocked cell`);
  assert.ok(p.some(([, z]) => z > 6), 'goes through the gap');
  assert.ok(pathLength(p) > 16);
});

test('there is no path into a sealed-off part of a floor', () => {
  const g = buildGrid(room, { items: [], walls: [[0, -10, 0, 10, 0]] });
  assert.equal(findPath(g, -8, 0, 8, 0), null);
  const reach = flood(g, [nearestFree(g, -8, 0)]);
  assert.equal(Boolean(reach[cellOf(g, 8, 0)]), false);
  assert.equal(Boolean(reach[cellOf(g, -5, 3)]), true);
});

test('furniture blocks the cells it stands on', () => {
  const g = buildGrid(room, { items: [{ t: 'desk', x: 3, z: 3, r: 0 }], walls: [] });
  assert.equal(walkable(g, 3, 3.2), false);
  assert.equal(walkable(g, -5, -5), true);
  const p = findPath(g, 3, -4, 3, 8);
  assert.ok(p, 'a path around the desk exists');
  for (let k = 1; k < p.length; k++) assert.ok(lineFree(g, p[k - 1][0], p[k - 1][1], p[k][0], p[k][1]));
});

// Cell centres of this room lie on multiples of 0.5 m, so a wall at x = 0.25 lies exactly between two columns of
// centres, 0.25 m from each: too far for either cell to count as blocked. Such walls used to let residents through.
test('a wall between two columns of cell centres still stops paths, reachability and straight lines', () => {
  const g = buildGrid(room, { items: [], walls: [[0.25, -10, 0.25, 10, 0]] });
  assert.equal(walkable(g, 0, 0) && walkable(g, 0.5, 0), true, 'the cells on both sides stay free');
  assert.equal(findPath(g, -8, 0, 8, 0), null);
  const reach = flood(g, [nearestFree(g, -8, 0)]);
  assert.equal(Boolean(reach[cellOf(g, 8, 0)]), false);
  assert.equal(Boolean(reach[cellOf(g, 0, 0)]), true);
  assert.equal(lineFree(g, -1, 0, 1, 0), false);
  assert.equal(wallBetween(g, 0, 3, 0.5, 3), true);
  assert.equal(nearWall(g, 0.4, 0, 0.26), true);
  assert.equal(nearWall(g, 0.6, 0, 0.26), false);
});

test('a doorway in such a wall stays open, and a path crosses the wall line only through it', () => {
  const g = buildGrid(room, { items: [], walls: [[0.25, -10, 0.25, -0.5, 0], [0.25, 0.5, 0.25, 10, 0]] });
  const through = p => p.slice(1).some((q, k) => {    // some leg crosses x = 0.25 inside the 1 m doorway
    const a = p[k];
    if ((a[0] - 0.25) * (q[0] - 0.25) >= 0) return false;
    return Math.abs(a[1] + (q[1] - a[1]) * (0.25 - a[0]) / (q[0] - a[0])) < 0.5;
  });
  const p = findPath(g, -8, 6, 8, 6);                  // the straight line runs into the wall
  assert.ok(p && p.length >= 3, JSON.stringify(p));
  for (let k = 1; k < p.length; k++) assert.equal(wallBetween(g, p[k - 1][0], p[k - 1][1], p[k][0], p[k][1]), false, `leg ${k}`);
  assert.ok(through(p), 'goes through the doorway');
  assert.deepEqual(findPath(g, -8, 6, 8, -6), [[-8, 6], [8, -6]], 'a straight line through the doorway stays straight');
});

test('nearestFree prefers a free cell on the same side of a wall', () => {
  const g = buildGrid(room, { items: [], walls: [[0.25, -10, 0.25, 10, 0]] });
  const c = nearestFree(g, 0.3, 2);                  // just right of the wall, inside the left column's cell
  const x = g.x0 + ((c % g.gw) + 0.5) * g.cell;
  assert.ok(x > 0.25, `picked a cell centred at x = ${x}`);
});
