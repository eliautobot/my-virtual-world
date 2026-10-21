// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Flats (2026-10-05; op flat.set / flat.invite / flat.uninvite): the building's owner holds every flat and assigns,
// rents or sells it; tenants are characters, AI agents' characters or players, and the characters among them live there;
// the buyer or a tenant who is a player locks the door and invites visitors; others may not; one undo puts it back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';

test('flats: rent to residents (they move in), sell to a player, lock, invite a visitor, rights, undo', async () => {
  const dir = tempDir('mvw-flats-');
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s);
    const alice = await userSession(s, owner, { login: 'alice' }), bob = await userSession(s, owner, { login: 'bob' });
    const edit = (c, ops) => c.post('/api/edit', { ops });
    const world = async () => (await owner.get('/api/world')).json.world;
    let W = await world();
    const B = W.buildings.find(b => b && !b.gone && b.type === 'apartment' && b.floors >= 3), f = 1, L = W.levels[B.lv[f]];
    assert.ok(L.units.length >= 2, 'flats on the floor');
    // two residents become the tenants of flat 1 (rented)
    let r = await edit(owner, [{ op: 'flat.set', b: B.idx, f, u: 0, deal: 'rented', rent: 1200, tenants: [{ kind: 'person', id: 3 }, { kind: 'person', id: 4 }] }]);
    assert.equal(r.status, 200, r.text);
    W = await world();
    const key = `${B.idx}:${f}:0`;
    assert.equal(W.flats[key].deal, 'rented'); assert.equal(W.flats[key].rent, 1200);
    assert.deepEqual(W.flats[key].tenants.map(t => t.id), [3, 4]);
    // sell flat 2 to Alice: she may lock it and invite Bob; Bob may not change it
    r = await edit(owner, [{ op: 'flat.set', b: B.idx, f, u: 1, deal: 'sold', owner: { kind: 'account', login: 'alice' } }]);
    assert.equal(r.status, 200, r.text);
    assert.equal((await edit(alice, [{ op: 'flat.set', b: B.idx, f, u: 1, locked: true }])).status, 200);
    r = await edit(alice, [{ op: 'flat.invite', b: B.idx, f, u: 1, who: { kind: 'account', login: 'bob' }, hours: 3 }]);
    assert.equal(r.status, 200, r.text);
    W = await world();
    const f2 = W.flats[`${B.idx}:${f}:1`];
    assert.equal(f2.locked, true); assert.equal(f2.visitors.length, 1);
    assert.ok(f2.visitors[0].until > Date.now() + 2.9 * 3600e3);
    assert.equal((await edit(bob, [{ op: 'flat.set', b: B.idx, f, u: 1, locked: false }])).status, 403, 'a visitor cannot unlock');
    assert.equal((await edit(alice, [{ op: 'flat.set', b: B.idx, f, u: 1, deal: 'own' }])).status, 403, 'the buyer cannot deal');
    assert.equal((await edit(alice, [{ op: 'flat.set', b: B.idx, f, u: 0, locked: true }])).status, 403, 'nor touch another flat');
    assert.equal((await edit(owner, [{ op: 'flat.set', b: B.idx, f, u: 1, deal: 'sold', owner: { kind: 'account', login: 'nobody' } }])).status, 400);
    // the owner's undo of the sale is refused: Alice changed the flat since; a change nobody touched since undoes
    assert.equal((await owner.post('/api/undo')).status, 409, 'the sale cannot be undone over the buyer\'s changes');
    assert.equal((await edit(owner, [{ op: 'flat.set', b: B.idx, f, u: 0, rent: 1500 }])).status, 200);
    assert.equal((await world()).flats[key].rent, 1500);
    assert.equal((await owner.post('/api/undo')).status, 200);
    assert.equal((await world()).flats[key].rent, 1200, 'one undo puts the rent back');
  } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('flats: split one in two, take one away — the others stay as they were, records and tenants follow, one undo', async () => {
  const dir = tempDir('mvw-flats2-');
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' });
    const edit = (c, ops) => c.post('/api/edit', { ops });
    const world = async () => (await owner.get('/api/world')).json.world;
    let W = await world();
    const B = W.buildings.filter(b => b && !b.gone && b.type === 'apartment' && b.floors >= 3).sort((a, b) => b.w - a.w)[0], f = 2;
    let L = W.levels[B.lv[f]];
    const n0 = L.units.length;
    const front = L.units.map((u, i) => ({ u, i })).filter(x => x.u.z0 > 0);
    assert.ok(front.length >= 2, 'two flats on the front side');
    const last = front[front.length - 1].i, keep = front[0].i;
    const items = (Lx, u) => Lx.items.filter(it => it.x >= u.x0 && it.x <= u.x1 && it.z >= u.z0 && it.z <= u.z1).map(it => [it.t, it.x, it.z]);
    const before = items(L, L.units[keep]);
    // a record on the last front flat moves with it
    assert.equal((await edit(owner, [{ op: 'flat.set', b: B.idx, f, u: last, deal: 'rented', rent: 900 }])).status, 200);
    assert.equal((await edit(alice, [{ op: 'flat.del', b: B.idx, f, u: keep }])).status, 403, 'only the owner');
    // take away the flat next to the last one: the last one takes its place in the list, the first stays as it was
    const gone = front[front.length - 2].i;
    let r = await edit(owner, [{ op: 'flat.del', b: B.idx, f, u: gone }]);
    assert.equal(r.status, 200, r.text);
    W = await world(); L = W.levels[W.buildings[B.idx].lv[f]];
    assert.equal(L.units.length, n0 - 1, 'one flat fewer');
    if (gone !== keep) assert.deepEqual(items(L, L.units[keep]), before, 'the first flat is exactly as it was');
    const rented = Object.entries(W.flats).filter(([k]) => k.startsWith(`${B.idx}:${f}:`));
    assert.equal(rented.length, 1); assert.equal(rented[0][1].rent, 900, 'the record followed its flat');
    assert.equal(W.levels[W.buildings[B.idx].lv[1]].units.length, W.levels[B.lv[1]].units.length, 'the floor below is untouched');
    // split the widest flat into two
    const wide = L.units.map((u, i) => ({ i, w: u.x1 - u.x0 })).sort((a, b) => b.w - a.w)[0];
    if (wide.w >= 10) { r = await edit(owner, [{ op: 'flat.add', b: B.idx, f, u: wide.i }]); assert.equal(r.status, 200, r.text); assert.equal((await world()).levels[W.buildings[B.idx].lv[f]].units.length, L.units.length + 1); r = await owner.post('/api/undo'); assert.equal(r.status, 200, r.text); }
    else assert.equal((await edit(owner, [{ op: 'flat.add', b: B.idx, f, u: wide.i }])).status, 400);
    // undo the removal: the floor and the record are back
    r = await owner.post('/api/undo'); assert.equal(r.status, 200, r.text);
    W = await world();
    assert.equal(W.levels[W.buildings[B.idx].lv[f]].units.length, n0, 'the flat is back');
    assert.ok(W.flats[`${B.idx}:${f}:${last}`]?.rent === 900, 'the record is back on its flat');
  } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the resident editor gives a character, or an AI agent\'s character, a chosen flat as its home', async () => {
  const dir = tempDir('mvw-flats3-');
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s), edit = ops => owner.post('/api/edit', { ops });
    const W = (await owner.get('/api/world')).json.world;
    const B = W.buildings.find(b => b && !b.gone && b.type === 'apartment' && b.floors >= 3), u = W.levels[B.lv[2]].units.length - 1;
    let r = await edit([{ op: 'person.set', i: 5, home: { b: B.idx, f: 2, u } }]);
    assert.equal(r.status, 200, r.text);
    const home = (await owner.get('/api/agent/5')).json.home;
    assert.deepEqual([home.b, home.f, home.u], [B.idx, 2, u]);
    // an agent's character: a chosen flat yes, its work no
    const people = (await owner.get('/api/agents')).json;
    const vip = (Array.isArray(people) ? people : people?.list || []).find(p => p.v || p.vip);
    if (vip) {
      const i = vip.i ?? vip.index;
      r = await edit([{ op: 'person.set', i, home: { b: B.idx, f: 2, u } }]);
      assert.ok(r.status === 200 || /No free bed/.test(r.json.error), r.text);
      assert.equal((await edit([{ op: 'person.set', i, job: 'free' }])).status, 400, "an agent's work stays with its agent");
    }
  } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('doors held open are shared; a locked flat\'s door opens only for its people', async () => {
  const dir = tempDir('mvw-flats4-');
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' }), bob = await userSession(s, owner, { login: 'bob' });
    const edit = (c, ops) => c.post('/api/edit', { ops });
    const W = (await owner.get('/api/world')).json.world;
    const B = W.buildings.find(b => b && !b.gone && b.type === 'apartment' && b.floors >= 3), L = W.levels[B.lv[1]], d = L.units[0].door;
    const key = `flat:${Math.round(d[0] * 20)}:${Math.round(d[1] * 20)}`;
    assert.equal((await edit(owner, [{ op: 'door.set', b: B.idx, f: 1, key, open: true }])).status, 200);
    assert.equal((await owner.get('/api/world')).json.world.doors[`${B.idx}:1:${key}`], 1, 'held open for everyone');
    assert.equal((await edit(owner, [{ op: 'door.set', b: B.idx, f: 1, key: 'bad key', open: true }])).status, 400);
    // sold to Alice and locked: Bob can't open it, until she invites him
    assert.equal((await edit(owner, [{ op: 'flat.set', b: B.idx, f: 1, u: 0, deal: 'sold', owner: { kind: 'account', login: 'alice' } }])).status, 200);
    assert.equal((await edit(alice, [{ op: 'flat.set', b: B.idx, f: 1, u: 0, locked: true }])).status, 200);
    assert.equal((await edit(bob, [{ op: 'door.set', b: B.idx, f: 1, key, open: true }])).status, 403);
    assert.equal((await edit(alice, [{ op: 'flat.invite', b: B.idx, f: 1, u: 0, who: { kind: 'account', login: 'bob' }, hours: 1 }])).status, 200);
    assert.equal((await edit(bob, [{ op: 'door.set', b: B.idx, f: 1, key, open: false }])).status, 200, 'an invited visitor may');
  } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
