// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Floor layouts on a resize, end to end (op bld.place with fit; 2026-10-04): a generated floor is laid out again for
// the new size and comes back exactly with undo; a floor changed by hand is refused until the person chooses — keep the
// layout without the pieces that don't fit (deleted; undo brings them back) or regenerate the floor (generated again).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, ownerSession, tempDir } from '../tools/lib/testserver.mjs';
import { WALL_T } from '../shared/constants.js';
import { toWorld } from '../shared/geom.js';

test('bld.place: generated floors follow a new size; hand-changed floors ask, keep or regenerate, and undo', async () => {
  const dir = tempDir('mvw-floors-');
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s);
    const edit = ops => owner.post('/api/edit', { ops });
    const get = async () => (await owner.get('/api/world')).json.world;
    let W = await get();
    const B = W.buildings.find(b => b && !b.gone && (b.type === 'cafe' || b.type === 'shop') && b.floors === 1 && b.w >= 13);
    assert.ok(B, 'a one-floor café or shop');
    const lv = B.lv[0], orig = structuredClone(W.levels[lv]);
    assert.equal(orig.auto, 1, 'a generated floor is marked so');
    const o = toWorld(B, 0, 0), u = toWorld(B, 1, 0), ax = u.x - o.x, az = u.z - o.z;   // the building's own x axis
    const wTo = by => Math.round((B.w - by) * 2) / 2;   // sizes snap to half metres; the west wall stays put
    const shrink = (by, extra = {}) => { const d = B.w - wTo(by); return edit([{ op: 'bld.place', b: B.idx, x: B.x - ax * d / 2, z: B.z - az * d / 2, w: wTo(by), ...extra }]); };

    // 1 generated: laid out again for the new size, no question; undo brings back exactly the old floor
    let r = await shrink(2);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.results[0].remade, [0]);
    W = await get();
    assert.equal(W.buildings[B.idx].w, wTo(2));
    assert.equal(W.levels[lv].auto, 1, 'still generated');
    assert.notDeepEqual(W.levels[lv].items, orig.items, 'a new layout for the new size');
    assert.equal((await owner.post('/api/undo')).status, 200);
    W = await get();
    assert.equal(W.buildings[B.idx].w, B.w);
    assert.deepEqual(W.levels[lv].items, orig.items, 'undo brings the old floor back exactly');

    // 2 changed by hand: a plant 2 m in from the east wall (it stays put when that wall comes in 3 m)
    const ix1 = B.w / 2 - WALL_T;
    let plant = null;
    for (const z of [0, -1, 1, -2, 2, -3, 3, -0.5, 0.5, -1.5, 1.5]) {
      for (const x of [ix1 - 2, ix1 - 2.4, ix1 - 1.7]) {
        const a = await edit([{ op: 'item.add', b: B.idx, f: 0, t: 'plant', x, z, r: 0 }]);
        if (a.status === 200) { plant = a.json.results[0]; break; }
      }
      if (plant) break;
    }
    assert.ok(plant, 'a plant fits 2 m in from the east wall');
    W = await get();
    assert.equal(W.levels[lv].mode, 'custom'); assert.equal(W.levels[lv].auto, undefined);

    r = await shrink(3);
    assert.equal(r.status, 400, 'refused without a choice');
    assert.match(r.json.error, /changed by hand/); assert.match(r.json.error, /plant/);

    // keep: the layout stays, the plant (and whatever else would not fit) goes; undo brings it all back
    r = await shrink(3, { fit: 'keep' });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.results[0].removed >= 1);
    W = await get();
    assert.equal(W.buildings[B.idx].w, wTo(3));
    assert.equal(W.levels[lv].mode, 'custom');
    assert.ok(!W.levels[lv].items.some(i => i.id === plant.id), 'the plant was removed');
    const u1 = await owner.post('/api/undo');
    assert.equal(u1.status, 200, u1.text);
    W = await get();
    assert.equal(W.buildings[B.idx].w, B.w);
    assert.ok(W.levels[lv].items.some(i => i.id === plant.id), 'undo brought the plant back');

    // regenerate (floor by floor form): generated again; undo makes it the hand-changed floor again
    r = await shrink(3, { fit: { [lv]: 'regen' } });
    assert.equal(r.status, 200, r.text);
    W = await get();
    assert.equal(W.levels[lv].auto, 1, 'generated again');
    assert.ok(!W.levels[lv].items.some(i => i.t === 'plant' && i.id === plant.id && Math.abs(i.x - plant.x) < 1e-9));
    assert.equal((await owner.post('/api/undo')).status, 200);
    W = await get();
    assert.equal(W.levels[lv].mode, 'custom');
    assert.ok(W.levels[lv].items.some(i => i.id === plant.id));

    // undoing the plant makes the floor generated again: a resize then lays it out without asking
    assert.equal((await owner.post('/api/undo')).status, 200);
    W = await get();
    assert.equal(W.levels[lv].auto, 1);
    const byId = list => [...list].sort((p, q) => p.id - q.id);
    assert.deepEqual(byId(W.levels[lv].items), byId(orig.items), 'the same pieces in the same places');
  } finally {
    await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('whole floors: clear (stays empty through a resize), regenerate (a new roll it keeps), reset to auto, one floor or all', async () => {
  const dir = tempDir('mvw-floors2-');
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s);
    const edit = ops => owner.post('/api/edit', { ops });
    const get = async () => (await owner.get('/api/world')).json.world;
    let W = await get();
    const A = W.buildings.find(b => b && !b.gone && b.type === 'apartment' && b.floors >= 4 && b.lv[1] === b.lv[2]);
    assert.ok(A, 'an apartment block whose upper floors share one layout');
    const tpl = A.lv[1], orig = structuredClone(W.levels[tpl]);
    const fixedOnly = L => L.items.every(i => i.t === 'elevator' || i.t === 'elevator_s' || i.t === 'door');

    // clear floor 2 only: it gets a copy of its own, emptied; floors 3+ keep the shared layout
    let r = await edit([{ op: 'lvl.clear', b: A.idx, f: 1 }]);
    assert.equal(r.status, 200, r.text);
    W = await get();
    let B = W.buildings[A.idx];
    assert.notEqual(B.lv[1], tpl, 'floor 2 has its own layout now');
    assert.equal(B.lv[2], tpl);
    const L2 = W.levels[B.lv[1]];
    assert.equal(L2.mode, 'empty'); assert.ok(fixedOnly(L2), 'only the elevator stays'); assert.deepEqual(L2.walls, []);
    assert.ok(L2.items.length >= 1, 'the elevator is still there');
    assert.deepEqual(W.levels[tpl].items, orig.items, 'the other floors are untouched');

    // a resize keeps the empty floor empty and lays out the generated ones again, no question asked
    const o = toWorld(B, 0, 0), u = toWorld(B, 1, 0), ax = u.x - o.x, az = u.z - o.z, w2 = Math.round((B.w - 1) * 2) / 2, d = B.w - w2;
    r = await edit([{ op: 'bld.place', b: A.idx, x: B.x - ax * d / 2, z: B.z - az * d / 2, w: w2 }]);
    assert.equal(r.status, 200, r.text);
    W = await get();
    assert.equal(W.levels[W.buildings[A.idx].lv[1]].mode, 'empty');
    assert.ok(fixedOnly(W.levels[W.buildings[A.idx].lv[1]]), 'still empty after the resize');
    assert.equal(W.levels[tpl].auto, 1);
    assert.equal((await owner.post('/api/undo')).status, 200);
    assert.equal((await owner.post('/api/undo')).status, 200);
    W = await get();
    assert.deepEqual(W.levels[W.buildings[A.idx].lv[1]].items, orig.items, 'undo brings floor 2 back');

    // regenerate every floor that shares the layout (at a size on the half-metre grid, so a resize can come back to it)
    B = (await get()).buildings[A.idx];
    r = await edit([{ op: 'bld.place', b: A.idx, x: B.x - ax * d / 2, z: B.z - az * d / 2, w: w2 }]);
    assert.equal(r.status, 200, r.text);
    r = await edit([{ op: 'lvl.regen', b: A.idx, f: 2, scope: 'all' }]);
    assert.equal(r.status, 200, r.text);
    W = await get();
    const R = W.levels[tpl], at = W.buildings[A.idx];
    assert.equal(R.auto, 1); assert.ok(R.roll > 0, 'it remembers its roll');
    // its roll survives a resize there and back: the same arrangement comes back
    r = await edit([{ op: 'bld.place', b: A.idx, x: at.x - ax * 0.5, z: at.z - az * 0.5, w: w2 - 1 }]);
    assert.equal(r.status, 200, r.text);
    assert.equal((await get()).levels[tpl].roll, R.roll);
    assert.notDeepEqual((await get()).levels[tpl].items, R.items, 'laid out for the smaller size');
    r = await edit([{ op: 'bld.place', b: A.idx, x: at.x, z: at.z, w: w2 }]);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await get()).levels[tpl].items, R.items, 'the re-rolled floor comes back the same');

    // changed by hand, then reset to auto: the building's own generated floor again
    const ix1 = at.w / 2 - 0.25;
    let placed = false;
    for (const z of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5]) {
      for (const x of [ix1 - 0.4, -ix1 + 0.4, 0]) { const a = await edit([{ op: 'item.add', b: A.idx, f: 2, t: 'plant', x, z, r: 0, scope: 'all' }]); if (a.status === 200) { placed = true; break; } }
      if (placed) break;
    }
    assert.ok(placed, 'a plant placed by hand');
    assert.equal((await get()).levels[tpl].mode, 'custom');
    r = await edit([{ op: 'lvl.reset', b: A.idx, f: 2, scope: 'all' }]);
    assert.equal(r.status, 200, r.text);
    W = await get();
    assert.equal(W.levels[tpl].auto, 1); assert.equal(W.levels[tpl].roll, undefined);
    assert.notDeepEqual(W.levels[tpl].items, R.items, 'not the re-rolled layout any more');
    assert.equal((await owner.post('/api/undo')).status, 200);
    assert.equal((await get()).levels[tpl].mode, 'custom', 'undo brings the hand-changed floor back');
  } finally {
    await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
