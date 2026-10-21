// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.14 property over HTTP: the lot map for everyone, administrators transfer (with a reason, password re-entered),
// holders merge up to 4 side-by-side lots and split them back, choose who may enter and share rights, nobody acts on
// someone else's lot, requests are idempotent, and the property check stays clean (wp4-world-spec.md §5, E25).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';

// A small world rebuilt on lots: boot once (fresh city + accounts database), stop, rebuild on lots, boot again.
async function lotWorld() {
  const dir = tempDir('mvw-prop-api-');
  const first = await startServer({ data: dir, population: 120 });
  await first.stop();
  const r = spawnSync(process.execPath, ['tools/wp4/rebuild-city.mjs', '--data', dir, '--server-stopped', '--nx', '3', '--nz', '2'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const s = await startServer({ data: dir, population: 120 });
  return { s, dir, close: async () => { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); for (const f of fs.readdirSync(path.dirname(dir))) if (f.startsWith(path.basename(dir) + '.')) fs.rmSync(path.join(path.dirname(dir), f), { recursive: true, force: true }); } };
}
/** Two lots of one block that share a side, both single (origins 1). */
function sideBySide(lots) {
  for (const a of lots) for (const b of lots) {
    if (a.id >= b.id || a.block !== b.block || a.origins !== 1 || b.origins !== 1) continue;
    const ax = a.poly.map(p => p.x), bx = b.poly.map(p => p.x), az = a.poly.map(p => p.z), bz = b.poly.map(p => p.z);
    if (Math.min(...az) === Math.min(...bz) && (Math.max(...ax) === Math.min(...bx) || Math.max(...bx) === Math.min(...ax))) return [a, b];
  }
  return null;
}

test('property over HTTP: map, transfer, merge/split, access, rights, idempotency, checks', async () => {
  const W = await lotWorld();
  try {
    const owner = await ownerSession(W.s);
    const alice = await userSession(W.s, owner, { login: 'alice' }), bob = await userSession(W.s, owner, { login: 'bob' });
    const guestLots = await fetch(W.s.url + '/api/property/lots').then(r => r.json());
    assert.equal(guestLots.lots.length > 0, true);
    assert.ok(guestLots.lots.every(l => l.holder.kind === 'municipality' && /^City of /.test(l.holder.name)));
    const pair = sideBySide(guestLots.lots);
    assert.ok(pair, 'two side-by-side single lots exist');
    const [A, B] = pair;

    // Administrators transfer, with a reason; members can't.
    assert.equal((await alice.post('/api/property/transfer', { id: A.id, login: 'alice', reason: 'test' })).status, 403);
    assert.equal((await owner.post('/api/property/transfer', { id: A.id, login: 'alice' })).status, 400, 'a reason is required');
    for (const L of [A, B]) assert.equal((await owner.post('/api/property/transfer', { id: L.id, login: 'alice', reason: 'Test sale', revision: L.revision })).status, 200);
    const mine = (await alice.get('/api/property/mine')).json.lots.map(l => l.id).sort();
    assert.deepEqual(mine, [A.id, B.id].sort());
    assert.deepEqual((await bob.get('/api/property/mine')).json.lots, []);

    // Bob can't merge, change access on or share Alice's lots.
    assert.equal((await bob.post('/api/property/merge', { ids: [A.id, B.id] })).status, 403);
    assert.equal((await bob.post('/api/property/access', { id: A.id, access: 'private' })).status, 403);
    assert.equal((await bob.post('/api/property/delegate', { id: A.id, login: 'bob', rights: ['build'] })).status, 403);

    // Alice merges (idempotently), splits back, and sets access.
    const m1 = await alice.post('/api/property/merge', { ids: [A.id, B.id], key: 'merge-1' });
    assert.equal(m1.status, 200, m1.text);
    const m2 = await alice.post('/api/property/merge', { ids: [A.id, B.id], key: 'merge-1' });
    assert.equal(m2.status, 200); assert.equal(m2.json.replayed, true); assert.equal(m2.json.id, m1.json.id);
    assert.equal((await alice.post('/api/property/merge', { ids: [B.id, A.id], key: 'merge-1' })).status, 409, 'same key, different request');
    const detail = (await alice.get(`/api/property/lot/${m1.json.id}`)).json;
    assert.equal(detail.lot.origins, 2); assert.equal(detail.can.merge, true);
    assert.deepEqual(detail.history.map(e => e.kind), ['merge']);
    assert.equal((await alice.post('/api/property/access', { id: m1.json.id, access: 'private' })).status, 200);
    assert.equal((await alice.post('/api/property/delegate', { id: m1.json.id, login: 'bob', rights: ['build', 'furnish'] })).status, 200);
    const split = await alice.post('/api/property/unmerge', { id: m1.json.id });
    assert.equal(split.status, 200, split.text);
    assert.deepEqual(split.json.ids.sort(), [A.id, B.id].sort());

    // Municipal lots are not Alice's to merge.
    const city = guestLots.lots.filter(l => l.id !== A.id && l.id !== B.id);
    const pair2 = sideBySide(city);
    assert.equal((await alice.post('/api/property/merge', { ids: [pair2[0].id, pair2[1].id] })).status, 403);

    // Holders name their lot and write a note (Bob can't); the map shows them.
    assert.equal((await alice.post('/api/property/info', { id: A.id, name: '  Alice <b>Garden</b> ', note: 'Tomatoes here' })).status, 200);
    assert.equal((await bob.post('/api/property/info', { id: A.id, name: 'Bob\'s now' })).status, 403);
    const named = (await bob.get('/api/property/lots')).json.lots.find(l => l.id === A.id);
    assert.equal(named.name, 'Alice bGarden/b'); assert.equal(named.note, 'Tomatoes here');
    // The city puts its land up for sale and takes it off again; members can't, and nobody sells someone's lot.
    const C = pair2[0];
    assert.equal((await alice.post('/api/property/offer', { id: C.id })).status, 403);
    assert.equal((await owner.post('/api/property/offer', { id: C.id })).status, 200);
    assert.equal((await bob.get('/api/property/lots')).json.lots.find(l => l.id === C.id).lifecycle, 'available');
    assert.equal((await owner.post('/api/property/offer', { id: A.id })).status, 409, 'Alice\'s lot is not the city\'s to sell');
    assert.equal((await owner.post('/api/property/withdraw', { id: C.id })).status, 200);
    assert.equal((await bob.get('/api/property/lots')).json.lots.find(l => l.id === C.id).lifecycle, 'municipal');

    // The check is clean, and only administrators may run it.
    assert.equal((await alice.get('/api/property/check')).status, 403);
    const chk = (await owner.get('/api/property/check')).json;
    assert.deepEqual(chk.problems, []);
  } finally { await W.close(); }
});
