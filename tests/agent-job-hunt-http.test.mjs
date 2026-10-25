// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's own brain chooses its job (step 7 of 2026-10-23: "based on what the agent decides to work at (based on
// availability and their own preference unless specified by the owner)"), on a real server with the mock decision
// service: an agent with Free Will on that loses its work asks its decision service which of the jobs open to it to take
// (one of those offered: its why-log shows a 'job' choice) and works there, "by its brain"; an agent its owner gave work
// to keeps it and asks nothing; with Free Will off, the rules place it as before.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession } from './helpers/server.mjs';

let s, owner, conn, A, B, C;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(400); } };
const work = async a => (await owner.get(`/api/agent-posts/work?agent=${a.id}`)).json.work;
const jobDecisions = async a => (await owner.get(`/api/free-will/decisions?agent=${a.id}&limit=100`)).json.decisions.filter(r => r.choice === 'job');
/** Takes agent a's work away: its desk goes (the world's own check: it is looking for work). */
const lose = async a => {
  const w = await work(a); assert.ok(w, `${a.name} works somewhere`);
  const r = await owner.post('/api/edit', { ops: [{ op: 'item.del', b: w.b, f: w.f, id: w.item }] }); assert.equal(r.status, 200, r.text);
};

before(async () => {
  s = await startServer({ population: 300, agents: 3, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  const c = await owner.post('/api/connections', { kind: 'decisions-mock', label: 'Mock decisions', scope: 'installation', config: { latencyMs: 30 }, secrets: { apiKey: 'sk-test-job-hunt' } });
  assert.equal(c.status, 200, c.text);
  conn = c.json.id;
  assert.equal((await owner.post('/api/settings', { values: { 'freeWill.defaultConnection': String(conn) } })).status, 200);
  [A, B, C] = (await owner.get('/api/agents')).json.agents;
  const on = await owner.post('/api/free-will/agent', { agent: A.id, enabled: true });
  assert.equal(on.json.status.active, true, JSON.stringify(on.json.status));
});
after(async () => { await s?.stop(); });

test('with Free Will, an agent that loses its work chooses its next job itself, from those open to it', async () => {
  await lose(A);
  const w = await waitFor(async () => { const x = await work(A); return x && x.by === 'brain' ? x : null; });
  assert.ok(w, `working again, by its own brain's choice (${JSON.stringify(await work(A))})`);
  const rows = await jobDecisions(A);
  const chosen = rows.find(r => r.outcome === 'chosen');
  assert.ok(chosen, `its why-log has the job choice (${JSON.stringify(rows.map(r => [r.outcome, r.reason]))})`);
  assert.ok(chosen.options.length >= 2 && chosen.options.some(o => o.id === chosen.chosen), 'one of the jobs offered');
  assert.match(chosen.options.find(o => o.id === chosen.chosen).label, /^(At a desk|Serving at the counter) at /);
  assert.equal(w.chosen, false, 'not its owner\'s pick: its owner may still give it work');
});

test('work its owner gave it: kept, nothing asked; Free Will off: the rules place it', async () => {
  // B: Free Will on, but its owner gave it a desk: it keeps it, asks nothing
  await owner.post('/api/free-will/agent', { agent: B.id, enabled: true });
  const w = await owner.get('/api/world'), W = w.json.world;
  let desk = null;
  for (const Bd of W.buildings) { if (desk || !Bd || Bd.gone || Bd.type !== 'office') continue; for (let f = 1; f < Bd.floors && !desk; f++) { const it = (await owner.get(`/api/agent-posts/floor?b=${Bd.idx}&f=${f}`)).json.items.find(x => x.kind === 'desk' && !x.slots[0].holder); if (it) desk = { b: Bd.idx, f, item: it.id }; } }
  assert.ok(desk, 'a free desk');
  assert.equal((await owner.post('/api/agent-posts/work', { agent: B.id, ...desk })).status, 200);
  await wait(4000);
  assert.deepEqual([(await work(B)).item, (await work(B)).by], [desk.item, 'owner']);
  assert.equal((await jobDecisions(B)).length, 0, 'nothing asked');
  // C: Free Will off: losing its work, the rules give it more
  await lose(C);
  const c = await waitFor(async () => { const x = await work(C); return x && x.by === 'rules' ? x : null; });
  assert.ok(c, `placed by the rules (${JSON.stringify(await work(C))})`);
  assert.equal((await jobDecisions(C)).length, 0);
});
