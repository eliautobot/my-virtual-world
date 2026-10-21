// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Building and item transforms, footprints and rectangle helpers (shared/geom.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { toWorld, toLocal, footprint, rectsOverlap, inRect, inItemRect, itemToLocal, itemAABB, segDist, normAngle } from '../../shared/geom.js';
import { SIDE_N, rotToSide } from '../../shared/city.js';

const near = (a, b, eps, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

test('toLocal undoes toWorld for every building rotation', () => {
  for (const rot of [0, 90, 180, 270]) {
    const b = { x: 12.5, z: -40, rot };
    for (const [lx, lz] of [[0, 0], [3, 4], [-7.25, 2], [5, -9]]) {
      const w = toWorld(b, lx, lz);
      const l = toLocal(b, w.x, w.z);
      near(l.x, lx, 1e-9, `rot ${rot} x`);
      near(l.z, lz, 1e-9, `rot ${rot} z`);
    }
  }
});

test('a building front (local +z) faces the street side of its rotation', () => {
  for (const rot of [0, 90, 180, 270]) {
    const b = { x: 3, z: 4, rot };
    const w = toWorld(b, 0, 1);
    const [nx, nz] = SIDE_N[rotToSide(rot)];
    near(w.x - b.x, nx, 1e-9, `rot ${rot} x`);
    near(w.z - b.z, nz, 1e-9, `rot ${rot} z`);
  }
});

test('footprint swaps width and depth for buildings turned sideways', () => {
  assert.deepEqual(footprint({ x: 0, z: 0, w: 10, d: 6, rot: 0 }), { x0: -5, x1: 5, z0: -3, z1: 3 });
  assert.deepEqual(footprint({ x: 0, z: 0, w: 10, d: 6, rot: 270 }), { x0: -3, x1: 3, z0: -5, z1: 5 });
  assert.deepEqual(footprint({ x: 1, z: 2, w: 10, d: 6, rot: 180 }, 1), { x0: -5, x1: 7, z0: -2, z1: 6 });
});

test('rectangles that only touch do not overlap', () => {
  const a = { x0: 0, x1: 5, z0: 0, z1: 5 };
  assert.equal(rectsOverlap(a, { x0: 5, x1: 9, z0: 0, z1: 5 }), false);
  assert.equal(rectsOverlap(a, { x0: 4.9, x1: 9, z0: 0, z1: 5 }), true);
  assert.equal(rectsOverlap(a, { x0: 4.9, x1: 9, z0: 0, z1: 5 }, 0.2), false);
  assert.equal(inRect(5, 5, a), true);
  assert.equal(inRect(5.1, 5, a), false);
  assert.equal(inRect(5.1, 5, a, 0.2), true);
});

test('item rectangles and their bounds follow the item rotation', () => {
  const rect = [-1, -0.5, 1, 0.5];
  for (const r of [0, 0.6, Math.PI / 2, 2.5, -1.2]) {
    const item = { x: 3, z: -2, r };
    for (const [px, pz, inside] of [[0, 0, true], [0.9, 0.4, true], [1.1, 0, false], [0, 0.6, false], [-0.95, -0.45, true]]) {
      const w = itemToLocal(item, px, pz);
      assert.equal(inItemRect(w.x, w.z, item.x, item.z, r, rect), inside, `r ${r}, point ${px},${pz}`);
    }
    const bb = itemAABB(item, rect);
    const corners = [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]].map(([x, z]) => itemToLocal(item, x, z));
    for (const c of corners) assert.ok(inRect(c.x, c.z, bb, 1e-9), `r ${r}: a corner lies outside its bounds`);
    near(Math.min(...corners.map(c => c.x)), bb.x0, 1e-9, 'tight x0');
    near(Math.max(...corners.map(c => c.z)), bb.z1, 1e-9, 'tight z1');
  }
});

test('distance from a point to a segment', () => {
  near(segDist(0, 3, -5, 0, 5, 0), 3, 1e-12, 'foot on the segment');
  near(segDist(8, 4, -5, 0, 5, 0), 5, 1e-12, 'beyond the end');
  near(segDist(1, 1, 2, 2, 2, 2), Math.SQRT2, 1e-12, 'zero-length segment');
});

test('normAngle keeps angles in [-pi, pi] without changing the direction', () => {
  for (const a of [0, 3, 3.2, -3.2, 7, -7, 20, -20, Math.PI, -Math.PI]) {
    const n = normAngle(a);
    assert.ok(n >= -Math.PI - 1e-12 && n <= Math.PI + 1e-12, `${a} -> ${n}`);
    near(Math.cos(n), Math.cos(a), 1e-9, `cos ${a}`);
    near(Math.sin(n), Math.sin(a), 1e-9, `sin ${a}`);
  }
});
