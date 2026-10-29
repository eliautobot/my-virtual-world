// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Work hours and posts (server/agent-posts/posts.js, 2026-10-28, the product owner: "their assigned post is their job";
// "give posts job hours, and have a 24/7 option aswell"): an agent put on post (24/7) has no other job, and the city's
// own placing never gives it one; work at a counter with the hours its owner chose (overnight too: 10 PM to 6 AM); two of
// its owner's agents share one serving side at hours that don't meet, and one whose hours would meet another's makes it
// give way; its hours changed where it is; hours that make no shift refused; posting 24/7 at a seat shared by shifts
// sends those working there back to finding work.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession } from './helpers/server.mjs';
import { isServiceDesk } from '../shared/catalog.js';

let s, owner, A, B, C, staffed = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(150); } };
const info = async i => (await owner.get(`/api/agent/${i}`)).json;
const floorOf = async (b, f) => (await owner.get(`/api/agent-posts/floor?b=${b}&f=${f}`)).json;
const workOf = async a => (await owner.get(`/api/agent-posts/work?agent=${a.id}`)).json.work;

before(async () => {
  s = await startServer({ population: 500, agents: 3, env: { MVW_PROBLEM_SCAN_MS: '300' } });   // (the Mind's problems looked at often: none for a job on post)
  owner = await ownerSession(s);
  [A, B, C] = (await owner.get('/api/agents')).json.agents;
  // two counters (or checkouts, reception desks) with a resident working at the first serving side
  const w = (await owner.get('/api/world')).json.world;
  for (const Bd of w.buildings) {
    if (!Bd || Bd.gone || staffed.length >= 2) continue;
    for (let f = 0; f < Bd.floors && staffed.length < 2; f++) {
      if (!w.levels[Bd.lv[f]]?.items.some(it => isServiceDesk(it.t))) continue;
      for (const it of (await floorOf(Bd.idx, f)).items || []) if (staffed.length < 2 && it.slots[0]?.holder && !it.slots[0].holder.post) staffed.push({ b: Bd.idx, f, item: it.id, k: it.slots[0].k });
    }
  }
});
after(async () => { await s?.stop(); });

test('on post, its post is its job: the job it had ends, and the city\'s placing gives it none', async () => {
  assert.equal(staffed.length, 2, 'two staffed counters');
  const before = await info(A.i);
  assert.ok(before.job?.b >= 0, `A works somewhere to begin with (${JSON.stringify(before.job)})`);
  const r = await owner.post('/api/agent-posts/here', { agent: A.id, ...staffed[0] });
  assert.equal(r.status, 200, r.text);
  const now = await info(A.i);
  // its job record is its post (one record every reader agrees on: the Studio, the Mind, the venue's staff, the town)
  assert.deepEqual([now.job.kind, now.job.b, now.job.f, now.job.start, now.job.end], ['post', staffed[0].b, staffed[0].f, 0, 24], `its job is its post (${JSON.stringify(now.job)})`);
  assert.match(now.job.title, / at /, 'titled "<role> at <the place>"');
  assert.equal(now.post?.b, staffed[0].b);
  assert.equal((await owner.get(`/api/agent-posts/work?agent=${A.id}`)).json.work, null, 'no "work hours" beside it');
  // the Mind's problems see a job (2026-10-28: posted agents had a "lost my job" problem, and a memory of it)
  await wait(2000);
  const probs = (await owner.get(`/api/mind/problems?agent=${A.id}`)).json.problems || [];
  assert.ok(!probs.some(x => x.kind === 'job' && x.status === 'open'), `no "job" problem while on post (${JSON.stringify(probs.map(x => [x.kind, x.status]))})`);
  // the city places its agents (index.mjs settleAgents: here set off by an agent of the owner's made to give way below)
  // and leaves the one on post alone
  assert.equal((await owner.post('/api/agent-posts/work', { agent: C.id, ...staffed[1], slot: staffed[1].k, start: 9, end: 17, days: 127 })).status, 200);
  assert.equal((await owner.post('/api/agent-posts/work', { agent: B.id, ...staffed[1], slot: staffed[1].k, start: 10, end: 18, days: 127 })).status, 200);
  assert.ok(await waitFor(async () => (await info(C.i)).job?.b >= 0 && (await info(C.i)).job.b !== -1 && !((await info(C.i)).job.b === staffed[1].b && (await workOf(C))?.item === staffed[1].item), 15000), 'C, made to give way, is placed somewhere else');
  const after = (await info(A.i)).job;
  assert.deepEqual([after.kind, after.b], ['post', staffed[0].b], `A, on post, keeps its post for its job after the city placed its agents (${JSON.stringify(after)})`);
});

test('work at the hours its owner chose: overnight, 10 PM to 6 AM, its day turned round', async () => {
  const r = await owner.post('/api/agent-posts/work', { agent: B.id, ...staffed[1], slot: staffed[1].k, start: 22, end: 6, days: 0b0011111 });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.work.start, r.json.work.end, r.json.work.days, r.json.work.chosen], [22, 30, 0b0011111, true]);
  const x = await info(B.i);
  assert.deepEqual([x.job.start, x.job.end], [22, 30]);
  assert.ok(x.sched.wake >= 19.9 && x.sched.wake <= 20.6 && x.sched.bed > 6 && x.sched.bed < 8, `up in the evening, to bed after the shift (${JSON.stringify(x.sched)})`);
});

test('two of its owner\'s agents share a serving side at hours that don\'t meet; hours that meet make the other give way', async () => {
  const r = await owner.post('/api/agent-posts/work', { agent: C.id, ...staffed[1], slot: staffed[1].k, start: 6, end: 14, days: 127 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.replaced, null, 'nobody made way: B works nights there');
  assert.equal((await workOf(B))?.item, staffed[1].item, 'B still works there');
  const it = (await floorOf(staffed[1].b, staffed[1].f)).items.find(x => x.id === staffed[1].item), sl = it.slots.find(x => x.k === staffed[1].k);
  assert.deepEqual(sl.holders.map(h => [h.name, h.start, h.end]).sort(), [[B.name, 22, 30], [C.name, 6, 14]].sort(), JSON.stringify(sl));
  // C's hours changed to meet B's: B gives way (finds work again)
  const h = await owner.post('/api/agent-posts/work/hours', { agent: C.id, start: 20, end: 4, days: 127 });
  assert.equal(h.status, 200, h.text);
  assert.deepEqual([h.json.work.start, h.json.work.end, h.json.work.item], [20, 28, staffed[1].item]);
  assert.notEqual((await workOf(B))?.item === staffed[1].item && (await workOf(B))?.chosen, true, 'B no longer works there');
});

test('its hours changed where it works; hours that make no shift refused', async () => {
  const h = await owner.post('/api/agent-posts/work/hours', { agent: C.id, start: 8.5, end: 12, days: 0b11 });
  assert.equal(h.status, 200, h.text);
  assert.deepEqual([h.json.work.start, h.json.work.end, h.json.work.days], [8.5, 12, 3]);
  for (const bad of [{ start: 9, end: 9 }, { start: 6, end: 23 }, { start: 9, end: 17, days: 0 }, { start: 25, end: 3 }]) {
    const r = await owner.post('/api/agent-posts/work/hours', { agent: C.id, ...bad });
    assert.equal(r.status, 400, `${JSON.stringify(bad)}: ${r.text}`);
    assert.equal(r.json.code, 'bad_hours');
  }
  assert.equal((await owner.post('/api/agent-posts/work/hours', { agent: A.id, start: 9, end: 17 })).json.code, 'no_work', 'A, on post, has no work to change the hours of');
});

test('let go, its job is no longer its post: it looks for work again', async () => {
  const before = (await info(A.i)).job;
  assert.equal(before.kind, 'post');
  assert.equal((await owner.post('/api/agent-posts/leave', { agent: A.id })).status, 200);
  const now = (await info(A.i)).job;
  assert.notEqual(now.kind, 'post', `no longer a post (${JSON.stringify(now)})`);
  assert.equal((await owner.get(`/api/agent-posts?agent=${A.id}`)).json.post, null);
});

test('posted 24/7 at a serving side shared by shifts: those working there go back to finding work', async () => {
  const r = await owner.post('/api/agent-posts/here', { agent: A.id, ...staffed[1], slot: staffed[1].k });
  assert.equal(r.status, 200, r.text);
  assert.equal((await workOf(C))?.item === staffed[1].item, false, 'C no longer works there');
  const it = (await floorOf(staffed[1].b, staffed[1].f)).items.find(x => x.id === staffed[1].item), sl = it.slots.find(x => x.k === staffed[1].k);
  assert.deepEqual(sl.holders.map(h => [h.name, h.post]), [[A.name, true]]);
});
