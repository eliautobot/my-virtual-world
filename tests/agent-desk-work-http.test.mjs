// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent given its work from the desk or counter itself (server/agent-posts/posts.js work, 2026-10-23: "setting a desk
// assigned to an agent (So the agent has a place of work)"; the ⋯ menu's "Works here (shifts)"): a floor's desks are
// listed with its counters; the agent works shifts there, kept there (its owner's pick) and there at once when its shift
// is on; let choose again, it is placed by the rules; a 24/7 post on a counter where one of theirs works shifts switches
// it out (it finds work again); only its owner's own agents, only on their own property (here: a world without lots,
// its owner's).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { isServiceDesk } from '../shared/catalog.js';
import { ctxOf } from '../shared/constants.js';

let s, owner, ann, A, B, C, desk, counter;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(200); } };
const info = async i => (await owner.get(`/api/agent/${i}`)).json;
const floorOf = async (b, f) => (await owner.get(`/api/agent-posts/floor?b=${b}&f=${f}`)).json.items || [];

before(async () => {
  s = await startServer({ population: 400, agents: 3 });
  owner = await ownerSession(s);
  assert.equal((await owner.post('/api/permissions', { cap: 'agents.manage', min: 'member' })).status, 200);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  [A, B, C] = (await owner.get('/api/agents')).json.agents;
  const w = (await owner.get('/api/world')).json.world;
  for (const Bd of w.buildings) {
    if (!Bd || Bd.gone) continue;
    for (let f = 0; f < Bd.floors; f++) {
      const items = w.levels[Bd.lv[f]]?.items || [];
      if (!desk && Bd.type === 'office' && f > 0 && items.some(it => /^desk/.test(it.t))) {
        const d = (await floorOf(Bd.idx, f)).find(x => x.kind === 'desk' && !x.slots[0].holder);
        if (d) desk = { b: Bd.idx, f, item: d.id };
      }
      if (!counter && items.some(it => isServiceDesk(it.t))) {
        const c = (await floorOf(Bd.idx, f)).find(x => x.kind === 'service' && x.slots.length === 1);
        if (c) counter = { b: Bd.idx, f, item: c.id };
      }
    }
    if (desk && counter) break;
  }
  // a weekday's half past ten: shifts are on
  let c = (await owner.post('/api/clock', { skip: 10.5 })).json;   // (the next half past ten; again: the day after)
  for (let n = 0; n < 3 && /^S/.test(c.weekday); n++) c = (await owner.post('/api/clock', { skip: 10.5 })).json;
  assert.ok(!/^S/.test(c.weekday) && c.hour >= 10 && c.hour < 11, `a weekday morning (${c.weekday} ${c.hour})`);
});
after(async () => { await s?.stop(); });

test('a floor lists its desks with its counters', () => {
  assert.ok(desk, 'a free desk on an office floor, listed as a desk');
  assert.ok(counter, 'a counter, listed as one');
});

test('given a desk: it works shifts there, kept there; on shift now, it is there at once', async () => {
  const r = await owner.post('/api/agent-posts/work', { agent: A.id, ...desk });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.work.b, r.json.work.f, r.json.work.item, r.json.work.chosen], [desk.b, desk.f, desk.item, true]);
  const x = await info(A.i);
  assert.equal(x.job.b, desk.b);
  const on = (await owner.get(`/api/agent-posts/work?agent=${A.id}`)).json.work;
  assert.equal(on.chosen, true, 'its owner\'s pick');
  const it = (await floorOf(desk.b, desk.f)).find(y => y.id === desk.item);
  assert.deepEqual([it.slots[0].holder?.agent?.id, it.slots[0].holder?.post], [A.id, false], 'the floor: it works here (shifts)');
  const there = await waitFor(async () => { const v = await info(A.i); return v.act?.kind === 'work' && v.pos.ctx === ctxOf(desk.b, desk.f) ? v : null; }, 3000);
  assert.ok(there, `at its desk at once (${JSON.stringify({ act: (await info(A.i)).act?.kind, ctx: (await info(A.i)).pos?.ctx })})`);
});

test('let choose again: placed by the rules (its owner\'s pick lifted)', async () => {
  const r = await owner.post('/api/agent-posts/work/auto', { agent: A.id });
  assert.equal(r.status, 200, r.text);
  const back = await waitFor(async () => { const w = (await owner.get(`/api/agent-posts/work?agent=${A.id}`)).json.work; return w && !w.chosen ? w : null; }, 15000);
  assert.ok(back, `working again, by its own choice (${JSON.stringify((await info(A.i)).job)})`);
});

test('a counter: shifts there; a 24/7 post of theirs on it switches the shift worker out (it finds work again)', async () => {
  const r = await owner.post('/api/agent-posts/work', { agent: B.id, ...counter });
  assert.equal(r.status, 200, r.text);
  assert.equal((await info(B.i)).job.kind, 'staff');
  const p = await owner.post('/api/agent-posts/here', { agent: C.id, ...counter });
  assert.equal(p.status, 200, p.text);
  assert.deepEqual(p.json.replaced, { name: B.name, post: false });
  const again = await waitFor(async () => { const v = await info(B.i); return v.job.b >= 0 && !(v.job.b === counter.b && v.job.f === counter.f) ? v : null; }, 15000);
  assert.ok(again, `B works somewhere else now (${JSON.stringify((await info(B.i)).job)})`);
});

test('only its owner\'s own agents, only on their own property', async () => {
  assert.equal((await ann.post('/api/agent-posts/work', { agent: A.id, ...desk })).status, 404, 'not hers');
  const mine = await ann.post('/api/agents', { name: 'Nova', emoji: '🚀', role: 'Scout' });
  assert.equal(mine.status, 200, mine.text);
  const r = await ann.post('/api/agent-posts/work', { agent: (mine.json.agent || mine.json).id, ...desk });
  assert.deepEqual([r.status, r.json.code], [403, 'not_yours'], 'a world without lots is its owner\'s');
});
