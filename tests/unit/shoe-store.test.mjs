// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A shoe store's furniture (2026-10-15): the Shoe Wall and the Shoe Plinth are Retail items people browse (a shop's
// visitors use browse slots: server/sim/agents.js shopVisit), the wall hangs on a wall, both take the owner's colour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../../shared/catalog.js';

test('the shoe wall and the shoe plinth: Retail, coloured, browsed by shoppers', () => {
  for (const id of ['shoe_wall', 'shoe_plinth']) {
    const c = CATALOG[id];
    assert.ok(c, id);
    assert.equal(c.cat, 'Retail'); assert.equal(c.tint, true);
    assert.ok(c.slots.length >= 2 && c.slots.every(s => s.use === 'browse' && s.anim === 'browse'), `${id}: browse slots`);
    const [x0, z0, x1, z1] = c.rect;
    // every slot stands outside what blocks the way (people reach it)
    for (const s of c.slots) assert.ok(s.x < x0 || s.x > x1 || s.z < z0 || s.z > z1, `${id}: slot ${s.x},${s.z} outside its rect`);
  }
  assert.equal(CATALOG.shoe_wall.wall, true);
  assert.ok(!CATALOG.shoe_plinth.wall);
});
