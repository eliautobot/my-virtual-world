// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI agents on post around the clock on a real server (server/agent-posts/, 2026-10-08): its owner sees the spots
// they may post it at (their own property: 2026-10-23), posts it — it goes there, "On duty", its needs waiting, everyone
// told it is on post — one agent to a spot and never on another's desk or a bed; only its owner or a manager, and only
// on their own property — not even an administrator on the city's land or another player's lot; it goes back to its
// day when let go, and its post ends when its furniture is taken away.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, annId, adm, A, B, C, iA, iB, desk;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(150); } };
const info = async i => (await owner.get(`/api/agent/${i}`)).json;
const person = async i => (await owner.get('/api/people')).json.people?.find(p => p.i === i) ?? (await owner.get('/api/people')).json.find?.(p => p.i === i);

before(async () => {
  s = await startServer({ population: 260, agents: 3 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  annId = (await ann.get('/api/auth/me')).json.account.id;
  [A, B, C] = (await owner.get('/api/agents')).json.agents;
  [iA, iB] = [A.i, B.i];
  adm = await userSession(s, owner, { login: 'adm', displayName: 'Adm', role: 'admin' });
});
after(async () => { await s?.stop(); });

test('the spots: on its owner\'s own property — desks, counters, kitchens; never a bed', async () => {
  const r = await owner.get(`/api/agent-posts/spots?agent=${A.id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.post, null, 'not on post yet');
  const all = r.json.buildings.flatMap(b => b.floors.flatMap(f => f.items.flatMap(it => it.slots.map(sl => ({ b: b.b, f: f.f, item: it.id, slot: sl.k, use: sl.use, holder: sl.holder, name: it.name })))));
  assert.ok(all.length > 0, 'a world without lots is its owner\'s: anywhere (a world with lots: agent-posts-property-http.test.mjs)');
  assert.ok(all.every(x => ['staff', 'work', 'computer', 'cook', 'prep'].includes(x.use)), 'only where an agent serves or works');
  desk = all.find(x => x.use === 'work' && !x.holder);
  assert.ok(desk, 'a free desk');
  const theirs = all.find(x => x.holder && !x.holder.post);
  if (theirs) assert.ok(theirs.holder.name, 'someone\'s place at work is shown as theirs');
});

test('posted: it goes there "On duty", everyone sees it is on post, its needs wait; one agent to a spot', async () => {
  const r = await owner.post('/api/agent-posts', { agent: A.id, b: desk.b, f: desk.f, item: desk.item, slot: desk.slot });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.post.item, desk.item);
  assert.match(r.json.post.place, /\S/);
  assert.equal(r.json.post.furniture, desk.name);
  const on = await waitFor(async () => { const x = await info(iA); return x.act?.kind === 'post' ? x : null; });
  assert.ok(on, 'it went on duty');
  assert.equal(on.act.label, 'On duty');
  assert.deepEqual([on.act.b, on.act.f], [desk.b, desk.f]);
  assert.equal(on.post.b, desk.b, 'its card says where it is on post');
  const pub = await waitFor(async () => { const p = await person(iA); return p?.po === 1 ? p : null; }, 5000);
  assert.ok(pub, 'anyone sees it is on post (the public people list)');
  // (the clock fast: off post, needs fall visibly in these seconds — B's do; A's on post don't)
  assert.equal((await owner.post('/api/clock', { rate: 30 })).status, 200);
  const a1 = (await info(iA)).needs, b1 = (await info(iB)).needs; await wait(3000); const a2 = (await info(iA)).needs, b2 = (await info(iB)).needs;
  assert.equal((await owner.post('/api/clock', { rate: 1 })).status, 200);
  assert.ok(b2.hunger !== b1.hunger || b2.fun !== b1.fun || b2.energy !== b1.energy, `off post, its needs change (${JSON.stringify([b1, b2])})`);
  assert.deepEqual(a2, a1, 'on post its needs wait');
  // another agent on the same spot: no
  const two = await owner.post('/api/agent-posts', { agent: B.id, b: desk.b, f: desk.f, item: desk.item, slot: desk.slot });
  assert.deepEqual([two.status, two.json.code], [409, 'taken'], two.text);
  assert.match(two.json.error, new RegExp(A.name));
  // never a bed
  const w = (await owner.get('/api/world')).json.world;
  let bed = null;
  for (const Bd of w.buildings) { if (bed || !Bd || Bd.gone) continue; for (let f = 0; f < Bd.floors && !bed; f++) { const it = w.levels[Bd.lv[f]]?.items.find(x => /^bed_/.test(x.t)); if (it) bed = { b: Bd.idx, f, item: it.id }; } }
  assert.ok(bed, 'a bed somewhere');
  assert.equal((await owner.post('/api/agent-posts', { agent: B.id, ...bed, slot: 0 })).json.code, 'not_a_post');
});

test('only its owner or a manager, only where they could furnish', async () => {
  assert.equal((await ann.post('/api/agent-posts', { agent: A.id, b: desk.b, f: desk.f, item: desk.item, slot: desk.slot })).status, 404, 'not hers');
  assert.equal((await ann.get(`/api/agent-posts/spots?agent=${A.id}`)).status, 404);
  // shared with Ann to manage: she may post it — but only where she could furnish (she holds nothing)
  const sh = await owner.post('/api/agents/share', { id: C.id, kind: 'account', who: annId, level: 'manage' });
  assert.equal(sh.status, 200, sh.text);
  const r = await ann.post('/api/agent-posts', { agent: C.id, b: desk.b, f: desk.f, item: desk.item, slot: desk.slot });
  assert.ok(['not_yours', 'taken'].includes(r.json.code), r.text);
  const spots = (await ann.get(`/api/agent-posts/spots?agent=${C.id}`)).json;
  assert.deepEqual(spots.buildings, [], 'nowhere she could furnish');
});

test('a world without lots is its owner\'s alone: not even another administrator posts there (2026-10-23)', async () => {
  const mine = await adm.post('/api/agents', { name: 'Ada', emoji: '🛠️', role: 'Admin aide' });
  assert.equal(mine.status, 200, mine.text);
  const id = mine.json.agent?.id ?? mine.json.id;
  assert.deepEqual((await adm.get(`/api/agent-posts/spots?agent=${id}`)).json.buildings, [], 'nowhere for an administrator');
  const r = await adm.post('/api/agent-posts', { agent: id, b: desk.b, f: desk.f, item: desk.item, slot: desk.slot });
  assert.deepEqual([r.status, r.json.code], [403, 'not_yours'], r.text);
});

test('the world warmed again (a restart, a clock skip) at night or by day: it starts at its post, on duty (2026-10-15)', async () => {
  for (const h of [2, 13]) {
    assert.equal((await owner.post('/api/clock', { skip: h })).status, 200);
    const a = await waitFor(async () => { const x = await info(iA); return x?.act?.kind === 'post' ? x : null; }, 8000);
    assert.ok(a, `on duty after the world warmed at ${h}:00 (${JSON.stringify((await info(iA))?.act)})`);
    assert.equal(a.act.label, 'On duty');
  }
});

test('let go: back to its day; its post ends with its furniture', async () => {
  const off = await owner.post('/api/agent-posts/leave', { agent: A.id });
  assert.equal(off.status, 200, off.text);
  assert.equal(off.json.post, null);
  assert.ok(await waitFor(async () => (await info(iA)).act?.kind !== 'post'), 'back to its day');
  assert.equal((await owner.get(`/api/agent-posts?agent=${A.id}`)).json.post, null);
  // posted again, then its desk is taken away: the post ends with it
  assert.equal((await owner.post('/api/agent-posts', { agent: A.id, b: desk.b, f: desk.f, item: desk.item, slot: desk.slot })).status, 200);
  const del = await owner.post('/api/edit', { ops: [{ op: 'item.del', b: desk.b, f: desk.f, id: desk.item }] });
  assert.equal(del.status, 200, del.text);
  assert.ok(await waitFor(async () => (await owner.get(`/api/agent-posts?agent=${A.id}`)).json.post === null, 8000), 'its post ended with the desk');
  assert.ok(await waitFor(async () => (await info(iA)).act?.kind !== 'post'), 'and it went back to its day');
});
