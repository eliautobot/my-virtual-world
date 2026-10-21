// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.6 lot rights on real requests (wp4-world-spec.md §5.0, §5.5, DECISIONS E25 (8)): administrators edit the city's
// land and never someone's private lot; holders edit the buildings on their own lots and nobody else's; a new building
// stands inside one lot they may build on, within its envelope; undo re-checks the rights; residents stay with
// administrators.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';

test('lot rights: who may edit which building, placement inside a lot, undo after a transfer', async () => {
  const dir = tempDir('mvw-lotrights-');
  const first = await startServer({ data: dir, population: 120 }); await first.stop();
  const rb = spawnSync(process.execPath, ['tools/wp4/rebuild-city.mjs', '--data', dir, '--server-stopped', '--nx', '5', '--nz', '4'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(rb.status, 0, rb.stderr);
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s);
    const alice = await userSession(s, owner, { login: 'alice' }), bob = await userSession(s, owner, { login: 'bob' });
    const world = (await owner.get('/api/world')).json.world, lots = (await owner.get('/api/property/lots')).json.lots;
    const single = lots.find(l => l.origins === 1 && l.buildings.length === 1 && world.buildings[l.buildings[0]].type !== 'park');
    const b = single.buildings[0];
    const edit = (c, ops) => c.post('/api/edit', { ops });

    // The city's land: administrators yes, members no.
    assert.equal((await edit(owner, [{ op: 'bld.set', b, name: 'City Hall Annex' }])).status, 200);
    const nope = await edit(alice, [{ op: 'bld.set', b, name: 'Mine now' }]);
    assert.equal(nope.status, 403); assert.equal(nope.json.code, 'forbidden');

    // After a transfer the holder edits, the administrator and other members don't.
    assert.equal((await owner.post('/api/property/transfer', { id: single.id, login: 'alice', reason: 'Test' })).status, 200);
    assert.equal((await edit(alice, [{ op: 'bld.set', b, name: 'Alice Place' }])).status, 200);
    assert.equal((await edit(bob, [{ op: 'bld.set', b, name: 'Bob Place' }])).status, 403);
    assert.equal((await edit(owner, [{ op: 'bld.set', b, name: 'Admin Place' }])).status, 403, 'administrators don\'t edit private lots');
    assert.equal((await edit(alice, [{ op: 'bld.floors', b, floors: 80 }])).status, 403, 'zoning caps the floors');

    // Shared rights let Bob furnish but not rebuild.
    assert.equal((await alice.post('/api/property/delegate', { id: single.id, login: 'bob', rights: ['furnish'] })).status, 200);
    assert.equal((await edit(bob, [{ op: 'bld.set', b, name: 'Bob Place' }])).status, 403, 'furnish rights don\'t rename the building');

    // A new building: inside one of your lots, clear of its lines.
    const L = lots.find(l => l.origins === 1 && l.buildings.length === 1 && l.id !== single.id && world.buildings[l.buildings[0]].type !== 'park' && world.buildings[l.buildings[0]].floors <= 4);
    const lb = L.buildings[0];
    assert.equal((await owner.post('/api/edit', { ops: [{ op: 'bld.del', b: lb }] })).status, 200, 'the city clears its lot');
    assert.equal((await owner.post('/api/property/transfer', { id: L.id, login: 'alice', reason: 'Test' })).status, 200);
    const xs = L.poly.map(p => p.x / 1e6), zs = L.poly.map(p => p.z / 1e6), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const rot = world.buildings[lb].rot || 0;   // face the lot's own street, as its old building did
    const add = (c, spec) => edit(c, [{ op: 'bld.add', spec: { type: 'shop', w: 14, d: 12, floors: 1, rot, style: 'modern', ...spec } }]);
    assert.equal((await add(bob, { x: cx, z: cz })).status, 403, 'not Bob\'s lot');
    assert.equal((await add(alice, { x: Math.min(...xs) + 3, z: cz })).status, 403, 'too close to the lot line');
    const ok = await add(alice, { x: cx, z: cz });
    assert.equal(ok.status, 200, ok.text);
    const after = (await owner.get('/api/world')).json.world, nb = after.buildings[ok.json.results[0].b];
    assert.equal(nb.lot, L.id, 'the new building knows its lot');

    // Undo re-checks rights: once the lot is transferred away, Alice can't undo her last change on it.
    assert.equal((await owner.post('/api/property/transfer', { id: L.id, login: 'bob', reason: 'Test' })).status, 200);
    const u = await alice.post('/api/undo');
    assert.equal(u.status, 403, u.text); assert.equal(u.json.code, 'forbidden');

    // Residents stay with administrators.
    assert.equal((await edit(alice, [{ op: 'person.set', i: 0, name: 'Renamed' }])).status, 403);
  } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); for (const f of fs.readdirSync('/tmp')) if (f.startsWith(dir.split('/').pop() + '.')) fs.rmSync('/tmp/' + f, { recursive: true, force: true }); }
});
