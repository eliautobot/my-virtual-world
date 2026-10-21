// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Saved floor layouts over the API (server/layout-routes.js, op lvl.apply; 2026-10-04): save the floor being
// furnished, list it, lay it onto another floor of the same kind (fitted to its size; misfits need fit 'keep'), refused on
// another kind of floor, shared with a player by username (and private otherwise), renamed, deleted; undo puts the
// floor back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';

test('layout library: save, list, apply (fitted), wrong kind refused, share privately, rename, delete, undo', async () => {
  const dir = tempDir('mvw-library-');
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s);
    const alice = await userSession(s, owner, { login: 'alice' }), bob = await userSession(s, owner, { login: 'bob' });
    const get = async () => (await owner.get('/api/world')).json.world;
    let W = await get();
    const apts = W.buildings.filter(b => b && !b.gone && b.type === 'apartment' && b.floors >= 2);
    const A = apts[0], C = apts.find(b => b.idx !== A.idx && Math.abs(b.w - A.w) > 1) || apts[1];
    const office = W.buildings.find(b => b && !b.gone && b.type === 'office' && b.floors >= 2);

    let r = await owner.post('/api/layouts/save', { b: A.idx, f: 1, name: 'Two-bed units' });
    assert.equal(r.status, 200, r.text);
    const id = r.json.id;
    assert.equal(r.json.use, 'apartment'); assert.equal(r.json.w, A.w); assert.ok(r.json.pieces > 5);
    assert.equal((await owner.post('/api/layouts/save', { b: A.idx, f: 1, name: '   ' })).status, 400, 'a name is needed');
    r = await owner.get('/api/layouts');
    assert.deepEqual(r.json.mine.map(l => l.name), ['Two-bed units']); assert.deepEqual(r.json.shared, []);
    r = await owner.get(`/api/layouts/${id}`);
    assert.equal(r.status, 200); assert.ok(r.json.layout.items.length === r.json.pieces);

    // onto another apartment block's floor 2 (another size): without fit, misfits are named; with fit 'keep' it goes on
    const edit = (c, ops) => c.post('/api/edit', { ops });
    r = await edit(owner, [{ op: 'lvl.apply', b: C.idx, f: 1, layout: id }]);
    if (r.status === 400) {
      assert.match(r.json.error, /Two-bed units/); assert.match(r.json.error, /fit this floor/);
      r = await edit(owner, [{ op: 'lvl.apply', b: C.idx, f: 1, layout: id, fit: 'keep' }]);
    }
    assert.equal(r.status, 200, r.text);
    W = await get();
    const LC = W.levels[W.buildings[C.idx].lv[1]];
    assert.equal(LC.mode, 'custom'); assert.ok(LC.items.length > 5);
    assert.ok(LC.items.some(i => i.t === 'elevator_s'), 'the block keeps its own elevator');
    assert.equal((await owner.post('/api/undo')).status, 200);
    assert.equal((await get()).levels[W.buildings[C.idx].lv[1]].auto, 1, 'undo puts the generated floor back');

    // an office floor is another kind of floor
    r = await edit(owner, [{ op: 'lvl.apply', b: office.idx, f: 1, layout: id, fit: 'keep' }]);
    assert.equal(r.status, 400); assert.match(r.json.error, /is for an apartment floor; this is an office floor/);

    // private: Bob can't see or use it; shared with Alice, she sees it (not his)
    assert.equal((await bob.get(`/api/layouts/${id}`)).status, 404);
    assert.equal((await owner.post('/api/layouts/share', { id, login: 'nobody' })).status, 404);
    r = await owner.post('/api/layouts/share', { id, login: 'alice' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await alice.get('/api/layouts')).json.shared.map(l => l.name), ['Two-bed units']);
    assert.equal((await alice.get(`/api/layouts/${id}`)).status, 200);
    assert.deepEqual((await bob.get('/api/layouts')).json.shared, []);
    assert.equal((await alice.post('/api/layouts/rename', { id, name: 'Mine now' })).status, 404, 'only its owner renames it');
    assert.deepEqual((await owner.get('/api/layouts')).json.mine[0].shares.map(x => x.login), ['alice']);
    assert.equal((await alice.post('/api/layouts/unshare', { id })).status, 200, 'she drops it from her list');
    assert.deepEqual((await alice.get('/api/layouts')).json.shared, []);

    // rename, delete
    assert.equal((await owner.post('/api/layouts/rename', { id, name: 'Family units' })).json.name, 'Family units');
    assert.equal((await owner.post('/api/layouts/delete', { id })).status, 200);
    assert.deepEqual((await owner.get('/api/layouts')).json.mine, []);
    assert.equal((await edit(owner, [{ op: 'lvl.apply', b: C.idx, f: 1, layout: id, fit: 'keep' }])).status, 400, 'a deleted layout is gone');
  } finally {
    await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
