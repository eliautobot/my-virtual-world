// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent put on post right from a counter, a checkout or a reception desk (server/agent-posts/posts.js here, 2026-10-23:
// "assign an agents to their a post just by cliking on actual item ... i want the agent to transport right away, not
// walk there"): its owner sees who is at the ones on a floor (no one else sees anything there); the agent is there at
// once, on duty; a resident working there makes way and looks for work elsewhere (no one is hired back onto the spot);
// another agent of theirs posted on the same desk is switched and walks off; only its owner's own agents, never one
// merely shared with them; only at a counter, a checkout or a reception desk.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession, httpClient } from './helpers/server.mjs';
import { isServiceDesk } from '../shared/catalog.js';
import { ctxOf } from '../shared/constants.js';

let s, owner, ann, annId, A, B, C, desk, staffed;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(150); } };
const info = async i => (await owner.get(`/api/agent/${i}`)).json;
const floorOf = async (who, b, f) => (await who.get(`/api/agent-posts/floor?b=${b}&f=${f}`)).json;

before(async () => {
  s = await startServer({ population: 500, agents: 3 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  annId = (await ann.get('/api/auth/me')).json.account.id;
  [A, B, C] = (await owner.get('/api/agents')).json.agents;
  // the counters, checkouts and reception desks: one a resident works at, and the floors they are on
  const w = (await owner.get('/api/world')).json.world, floors = [];
  for (const Bd of w.buildings) { if (!Bd || Bd.gone) continue; for (let f = 0; f < Bd.floors; f++) if (w.levels[Bd.lv[f]]?.items.some(it => isServiceDesk(it.t))) floors.push([Bd.idx, f]); }
  for (const [b, f] of floors) {
    for (const it of (await floorOf(owner, b, f)).items || []) {
      if (!staffed && it.slots.length === 1 && it.slots[0].holder && !it.slots[0].holder.post) staffed = { b, f, item: it.id, t: it.t, worker: it.slots[0].holder.name };
    }
    if (staffed) break;
  }
});
after(async () => { await s?.stop(); });

test('the floor: its owner sees the counters and desks there and who is at each; someone else sees nothing', async () => {
  assert.ok(staffed, 'a counter, checkout or reception desk with one serving side and a resident working there');
  const mine = await floorOf(owner, staffed.b, staffed.f);
  const it = mine.items.find(x => x.id === staffed.item);
  assert.ok(it && isServiceDesk(it.t) && it.name, JSON.stringify(mine));
  assert.ok(mine.items.every(x => isServiceDesk(x.t)), 'only counters, checkouts and reception desks');
  assert.deepEqual(it.slots[0].holder, { name: staffed.worker, post: false, agent: null });
  assert.deepEqual((await floorOf(ann, staffed.b, staffed.f)).items, [], 'Ann holds nothing here: she sees nothing');
  assert.deepEqual((await floorOf(owner, 99999, 0)).items, []);
  assert.notEqual((await httpClient(s.url).get(`/api/agent-posts/floor?b=${staffed.b}&f=${staffed.f}`)).status, 200, 'signed out: no');
});

test('posted from the desk: there at once, on duty; the resident working there makes way and is not hired back onto it', async () => {
  const t0 = Date.now();
  const r = await owner.post('/api/agent-posts/here', { agent: A.id, b: staffed.b, f: staffed.f, item: staffed.item });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.post.item, staffed.item);
  assert.deepEqual(r.json.replaced, { name: staffed.worker, post: false });
  // at the desk already: on duty on that floor within a moment, not walking (the Studio's post walks there)
  const on = await waitFor(async () => { const x = await info(A.i); return x.act?.kind === 'post' ? x : null; }, 3000);
  assert.ok(on, `on duty at once (${JSON.stringify((await info(A.i)).act)})`);
  assert.ok(Date.now() - t0 < 3500);
  assert.equal(on.pos.ctx, ctxOf(staffed.b, staffed.f), 'on that floor');
  assert.equal(on.moving, false, 'not walking there');
  assert.equal(on.act.label, 'On duty');
  // the floor says so; the resident is between jobs or works somewhere else, never back on that spot
  const it = (await floorOf(owner, staffed.b, staffed.f)).items.find(x => x.id === staffed.item);
  assert.deepEqual(it.slots[0].holder, { name: A.name, post: true, agent: { id: A.id, name: A.name, emoji: A.emoji || '', mine: true } });
  const people = (await owner.get('/api/people')).json, list = people.people || people;
  const worker = list.find(p => p.n === staffed.worker && p.i !== A.i);
  assert.ok(worker, 'the resident');
  const back = (await floorOf(owner, staffed.b, staffed.f)).items.find(x => x.slots.some(sl => sl.holder?.name === staffed.worker));
  assert.ok(!back || back.id !== staffed.item, `it is not hired back onto that desk (${JSON.stringify((await info(worker.i)).job)})`);
});

test('another agent of theirs posted on the same desk: switched, the first walks off to its day', async () => {
  const r = await owner.post('/api/agent-posts/here', { agent: B.id, b: staffed.b, f: staffed.f, item: staffed.item });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.replaced, { name: A.name, post: true });
  assert.ok(await waitFor(async () => (await info(B.i)).act?.kind === 'post', 3000), 'B on duty at once');
  assert.equal((await owner.get(`/api/agent-posts?agent=${A.id}`)).json.post, null, 'A is no longer on post');
  assert.ok(await waitFor(async () => (await info(A.i)).act?.kind !== 'post'), 'A back to its day');
  // the same one again: nothing changes
  const again = await owner.post('/api/agent-posts/here', { agent: B.id, b: staffed.b, f: staffed.f, item: staffed.item });
  assert.equal(again.status, 200, again.text);
  assert.equal(again.json.replaced, null);
});

test('only its owner\'s own agents (never one shared with them), only at a counter, a checkout or a reception desk', async () => {
  const at = { b: staffed.b, f: staffed.f, item: staffed.item };
  assert.equal((await ann.post('/api/agent-posts/here', { agent: A.id, ...at })).status, 404, 'not hers');
  const sh = await owner.post('/api/agents/share', { id: C.id, kind: 'account', who: annId, level: 'manage' });
  assert.equal(sh.status, 200, sh.text);
  const r = await ann.post('/api/agent-posts/here', { agent: C.id, ...at });
  assert.deepEqual([r.status, r.json.code], [404, 'not_found'], 'shared with her to manage, but not hers');
  // a desk (an office one): not here
  const w = (await owner.get('/api/world')).json.world;
  let other = null;
  for (const Bd of w.buildings) { if (other || !Bd || Bd.gone) continue; for (let f = 0; f < Bd.floors && !other; f++) { const it = w.levels[Bd.lv[f]]?.items.find(x => /^desk/.test(x.t)); if (it) other = { b: Bd.idx, f, item: it.id }; } }
  assert.ok(other, 'a desk somewhere');
  assert.equal((await owner.post('/api/agent-posts/here', { agent: C.id, ...other })).json.code, 'not_a_post');
  assert.equal((await owner.post('/api/agent-posts/here', { agent: C.id, b: staffed.b, f: staffed.f, item: 987654 })).json.code, 'no_spot');
});

test('a world without lots is its owner\'s alone: another administrator sees no ⋯ and posts none (2026-10-23: "even admins")', async () => {
  const adm = await userSession(s, owner, { login: 'adm', displayName: 'Adm', role: 'admin' });
  const made = await adm.post('/api/agents', { name: 'Ada', emoji: '🛠️', role: 'Admin aide' });
  assert.equal(made.status, 200, made.text);
  assert.deepEqual((await floorOf(adm, staffed.b, staffed.f)).items, [], 'no ⋯ for an administrator');
  const r = await adm.post('/api/agent-posts/here', { agent: (made.json.agent || made.json).id, b: staffed.b, f: staffed.f, item: staffed.item });
  assert.deepEqual([r.status, r.json.code], [403, 'not_yours'], r.text);
});

test('its desk taken away: the post ends and it walks off as usual', async () => {
  const del = await owner.post('/api/edit', { ops: [{ op: 'item.del', b: staffed.b, f: staffed.f, id: staffed.item }] });
  assert.equal(del.status, 200, del.text);
  assert.ok(await waitFor(async () => (await owner.get(`/api/agent-posts?agent=${B.id}`)).json.post === null, 8000), 'its post ended with the desk');
  assert.ok(await waitFor(async () => (await info(B.i)).act?.kind !== 'post'), 'and it went back to its day');
});
