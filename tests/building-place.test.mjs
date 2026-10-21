// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Moving and resizing a standing building (op bld.place, WP4.6 handles): only someone with build rights on its lot, only
// to a place inside a lot they may build on, never so small that its furniture would end up outside the walls; one
// undo puts it back, a redo moves it again, and furniture against a side that moves goes with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';
import { WALL_T } from '../shared/constants.js';
import { interiorFits } from '../shared/edit.js';
import { toWorld } from '../shared/geom.js';

test('bld.place: move, resize, rights, furniture inside the walls, undo and redo', async () => {
  const dir = tempDir('mvw-place-');
  const first = await startServer({ data: dir, population: 120 }); await first.stop();
  const rb = spawnSync(process.execPath, ['tools/wp4/rebuild-city.mjs', '--data', dir, '--server-stopped', '--nx', '5', '--nz', '4'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(rb.status, 0, rb.stderr);
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s);
    const alice = await userSession(s, owner, { login: 'alice' }), bob = await userSession(s, owner, { login: 'bob' });
    const edit = (c, ops) => c.post('/api/edit', { ops });
    let world = (await owner.get('/api/world')).json.world;
    const lots = (await owner.get('/api/property/lots')).json.lots;
    // a lot of its own with a small building: the city clears it, gives it to Alice, and she builds a shop in the middle
    const L = lots.find(l => l.origins === 1 && l.buildings.length === 1 && world.buildings[l.buildings[0]].type !== 'park' && world.buildings[l.buildings[0]].floors <= 4);
    const old = L.buildings[0], rot = world.buildings[old].rot || 0;
    assert.equal((await edit(owner, [{ op: 'bld.del', b: old }])).status, 200);
    assert.equal((await owner.post('/api/property/transfer', { id: L.id, login: 'alice', reason: 'Test' })).status, 200);
    const xs = L.poly.map(p => p.x / 1e6), zs = L.poly.map(p => p.z / 1e6), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const add = await edit(alice, [{ op: 'bld.add', spec: { type: 'shop', w: 14, d: 12, floors: 1, rot, style: 'modern', x: cx, z: cz } }]);
    assert.equal(add.status, 200, add.text);
    const b = add.json.results[0].b;

    // Bob holds nothing there; nobody moves it off the lot or across its line.
    assert.equal((await edit(bob, [{ op: 'bld.place', b, x: cx + 1 }])).status, 403);
    const off = await edit(alice, [{ op: 'bld.place', b, x: Math.max(...xs) + 4 }]);
    assert.ok(off.status === 403 || off.status === 400, off.text);

    // Alice moves it 2 m along x and makes it 2 m wider: one edit, one journal entry.
    const mv = await edit(alice, [{ op: 'bld.place', b, x: cx + 2, w: 16 }]);
    assert.equal(mv.status, 200, mv.text);
    world = (await owner.get('/api/world')).json.world;
    let B = world.buildings[b];
    assert.equal(B.x, Math.round((cx + 2) * 2) / 2); assert.equal(B.w, 16); assert.equal(B.lot, L.id);

    // A plant against the east wall goes with that wall when the shop grows that way; one undo brings both back.
    const lv = B.lv[0], iw = B.w / 2 - WALL_T;
    let placed = null;
    for (const z of [0, -2, 2, -3.5, 3.5, -1, 1]) {
      const r = await edit(alice, [{ op: 'item.add', b, f: 0, t: 'plant', x: iw - 0.45, z, r: 0 }]);
      if (r.status === 200) { placed = r.json.results[0]; break; }
    }
    assert.ok(placed, 'a plant fits against the east wall');
    const plantAt = async () => { const W2 = (await owner.get('/api/world')).json.world, it = W2.levels[lv].items.find(i => i.id === placed.id); return toWorld(W2.buildings[b], it.x, it.z); };
    const p0 = await plantAt(), ux = toWorld(B, 1, 0), ax = ux.x - B.x, az = ux.z - B.z;   // the building's own x axis
    const grow = await edit(alice, [{ op: 'bld.place', b, x: B.x + ax, z: B.z + az, w: B.w + 2 }]);
    assert.equal(grow.status, 200, grow.text);
    const p1 = await plantAt();
    assert.ok(Math.abs(p1.x - p0.x - 2 * ax) < 0.01 && Math.abs(p1.z - p0.z - 2 * az) < 0.01, `the plant moved 2 m with the east wall (${JSON.stringify([p0, p1])})`);
    const W3 = (await owner.get('/api/world')).json.world, B3 = W3.buildings[b];   // the browser's preview, same rule
    assert.equal(interiorFits(B3, { x: B3.x, z: B3.z, w: B3.w + 2, d: B3.d, rot: B3.rot }, l => W3.levels[l]), null);

    // Undo the growth (shop and plant back), the plant, the first move: it stands as built; redo moves it again.
    assert.equal((await alice.post('/api/undo')).status, 200);
    const p2 = await plantAt();
    assert.ok(Math.hypot(p2.x - p0.x, p2.z - p0.z) < 0.01, 'undo put the plant back');
    assert.equal((await alice.post('/api/undo')).status, 200);
    const u = await alice.post('/api/undo');
    assert.equal(u.status, 200, u.text);
    B = (await owner.get('/api/world')).json.world.buildings[b];
    assert.equal(B.w, 14); assert.equal(B.x, Math.round(cx * 2) / 2);
    const r = await alice.post('/api/redo');
    assert.equal(r.status, 200, r.text);
    B = (await owner.get('/api/world')).json.world.buildings[b];
    assert.equal(B.w, 16);
  } finally {
    await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
