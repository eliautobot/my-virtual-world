// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What happens inside a building when its sides move (shared/edit.js followLayout/followCore/interiorFits, op
// bld.place): as in the Sims, furniture and the elevator standing against a side that moves go with it, everything else
// stays where it stands in the world; turning keeps the inside as it is; a move that would push something into
// something else, out of the walls or in front of the entrance is refused in words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { followLayout, followCore, interiorFits, interiorBounds } from '../shared/edit.js';
import { toWorld } from '../shared/geom.js';

const shop = () => ({ type: 'shop', x: 100, z: 50, w: 16, d: 12, rot: 0, floors: 1, lv: [0], door: { x: 0, w: 2.4 }, core: null });
const level = B => { const ib = interiorBounds(B); return { items: [
  { id: 1, t: 'plant', x: ib.x1 - 0.3, z: -2, r: 0 },     // against the east wall
  { id: 2, t: 'sofa', x: 0, z: -2, r: 0 },                 // in the middle
  { id: 3, t: 'plant', x: ib.x0 + 0.3, z: -3, r: 0 },     // against the west wall
], walls: [] }; };
const world = (B, it) => toWorld(B, it.x, it.z);
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('growing to the east: the east wall\'s plant goes along, the rest stays put', () => {
  const B = shop(), L = level(B), g = { x: B.x + 1, z: B.z, w: B.w + 2, d: B.d, rot: 0 };
  const F = followLayout(B, g, L), nb = { ...B, ...g };
  assert.ok(near(world(nb, F.items[0]).x, world(B, L.items[0]).x + 2), 'the plant on the east wall moved 2 m east');
  assert.ok(near(world(nb, F.items[1]).x, world(B, L.items[1]).x), 'the sofa in the middle stayed');
  assert.ok(near(world(nb, F.items[2]).x, world(B, L.items[2]).x), 'the west wall\'s plant stayed (that wall did not move)');
  assert.equal(interiorFits(B, g, () => L), null);
});

test('turning keeps the inside as it is', () => {
  const B = shop(), L = level(B), F = followLayout(B, { x: B.x, z: B.z, w: B.w, d: B.d, rot: 90 }, L);
  assert.deepEqual(F.items.map(i => [i.x, i.z]), L.items.map(i => [i.x, i.z]));
});

test('pulling the east wall in until its plant hits the sofa is refused, with the reason', () => {
  const B = shop(), L = level(B), ib = interiorBounds(B), s = ib.x1 - 0.3 - 0.9;   // the plant ends 0.9 m from the middle: on the sofa
  const why = interiorFits(B, { x: B.x - s / 2, z: B.z, w: B.w - s, d: B.d, rot: 0 }, () => L);
  assert.match(why || '', /plant .* would bump into the sofa/i);
});

test('a symmetric shrink that squeezes the walls past the sofa is refused', () => {
  const B = { ...shop(), w: 12 }, L = { items: [{ id: 2, t: 'sofa', x: 0, z: 0, r: Math.PI / 2 }, { id: 4, t: 'sofa', x: 2.5, z: 0, r: Math.PI / 2 }], walls: [] };
  const why = interiorFits(B, { x: B.x, z: B.z, w: 10, d: B.d, rot: 0 }, () => L);
  assert.ok(why === null || /bump into|outside/.test(why), why);
});

test('the elevator against the back wall goes with it when the building gets deeper', () => {
  const B = { ...shop(), floors: 3, lv: [0, 0, 0], core: { t: 'elevator_s', x: 4, z: -6 + 0.2 + 1.26, r: 0 } };
  const g = { x: B.x, z: B.z - 1, w: B.w, d: B.d + 2, rot: 0 };   // the back moves 2 m back, the front stays
  const c = followCore(B, g), nb = { ...B, ...g };
  assert.ok(near(world(nb, c).z, world(B, B.core).z - 2), 'the core moved back with the back wall');
  assert.ok(near(world(nb, c).x, world(B, B.core).x));
});
