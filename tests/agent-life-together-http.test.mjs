// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Life with others, remembered (server/agent-life/, 2026-10-28, the product owner: "sara and luke talk on the radio
// together yet they have no recolection of who they are ... they dont report as freiends or aquentances, also what
// happens to their dialog? shouldnt what they talk and what they talk about and who they speak to me recognized and
// remobered"; "its not to be specific to Luke and sara"): two agents on post side by side get to know each other, each
// noting the other works with it there; a player who talks with an agent is in its day by name, a memory of who (never
// their own words, as they are), and someone it knows; a day on post carries on as one line across a server restart.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession, httpClient, tempDir } from './helpers/server.mjs';
import { isServiceDesk } from '../shared/catalog.js';

let s, dir, owner, ann, fake, A, B, C, seats;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(150); } };
const people = async a => (await owner.get(`/api/agent-life/people?agent=${a.id}`)).json.people || [];
const activity = async a => (await owner.get(`/api/agent-life/activity?agent=${a.id}&limit=40`)).json.activity || [];
const memories = async a => (await owner.get(`/api/agent-life/memories?agent=${a.id}&term=short&limit=40`)).json.memories || [];

before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
      res.end(JSON.stringify({ model: 'fake', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ reply: 'Hello! Nice to meet you.' }) } }] }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  dir = tempDir('mvw-together-');
  s = await startServer({ data: dir, population: 500, agents: 3, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  const agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
  [A, B, C] = agents;
  const c = await owner.post('/api/connections', { kind: 'models', label: 'Brain', scope: 'installation', config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' }, secrets: { apiKey: 'k' } });
  assert.equal((await owner.post('/api/agents/update', { id: C.id, connectionId: c.json.id, nativeId: 'mind' })).status, 200);
  // a floor with two serving sides (one counter with two, or two counters)
  const w = (await owner.get('/api/world')).json.world;
  for (const Bd of w.buildings) {
    if (!Bd || Bd.gone || seats) continue;
    for (let f = 0; f < Bd.floors && !seats; f++) {
      if (!w.levels[Bd.lv[f]]?.items.some(it => isServiceDesk(it.t))) continue;
      const items = (await owner.get(`/api/agent-posts/floor?b=${Bd.idx}&f=${f}`)).json.items || [];
      const all = items.flatMap(it => it.slots.map(sl => ({ b: Bd.idx, f, item: it.id, slot: sl.k })));
      if (all.length >= 2) seats = all.slice(0, 2);
    }
  }
});
after(async () => { await s?.stop(); fake?.close(); });

test('two agents on post side by side get to know each other: each notes the other works with it there', async () => {
  assert.ok(seats, 'a floor with two serving sides');
  assert.equal((await owner.post('/api/agent-posts/here', { agent: A.id, ...seats[0] })).status, 200);
  assert.equal((await owner.post('/api/agent-posts/here', { agent: B.id, ...seats[1] })).status, 200);
  // (its next stretch on duty: A put there again, at once — it sees B at work there)
  assert.equal((await owner.post('/api/agent-posts/here', { agent: A.id, ...seats[0] })).status, 200);
  const knows = async (x, y) => waitFor(async () => (await people(x)).find(p => p.kind === 'agent' && p.name === y.name && p.interactions >= 1) || null, 15000);
  const ab = await knows(A, B), ba = await knows(B, A);
  assert.ok(ab && ba, `they know each other (${JSON.stringify({ ab, ba })})`);
  assert.match(ab.note, /^Works with me at /, 'A notes that B works with it');
  assert.match(ba.note, /^Works with me at /);
  assert.ok((await memories(B)).some(m => m.text.startsWith(`Met ${A.name}`)), 'B remembers meeting A');
});

test('a player who talks with an agent: in its day by name, a memory of what about, someone it knows', async () => {
  const r = await ann.post('/api/agent-talk/say', { agent: C.id, text: 'Do you know a good place for coffee around here?' });
  assert.equal(r.status, 200, r.text);
  const line = await waitFor(async () => (await activity(C)).find(x => x.label === 'Talked with Ann') || null);
  assert.ok(line, `its day says who it talked with (${JSON.stringify((await activity(C)).slice(0, 3))})`);
  const mem = await waitFor(async () => (await memories(C)).find(m => /^Talked with Ann at /.test(m.text) || m.text === 'Talked with Ann') || null);
  assert.ok(mem, `a memory of who it talked with (${JSON.stringify((await memories(C)).map(m => m.text).slice(0, 5))})`);
  assert.ok(!(await memories(C)).some(m => /good place for coffee/.test(m.text)), 'never the visitor\'s own words, as they are');
  const p = (await people(C)).find(x => x.kind === 'player' && x.name === 'Ann');
  assert.ok(p && p.interactions >= 1, `Ann is someone it knows (${JSON.stringify(await people(C))})`);
});

test('a day on post carries on as one line across a server restart', async () => {
  const onDuty = async () => (await activity(A)).filter(x => x.kind === 'post');
  assert.ok(await waitFor(async () => (await onDuty()).length >= 1), 'A on duty in its day');
  const day = (await onDuty())[0].day;
  const pw = owner.password;
  await s.stop({ keepData: true });
  s = await startServer({ data: dir, population: 500, env: { MVW_PROVIDER_TEST: '1' } });
  owner = httpClient(s.url); await owner.signIn('owner', pw); owner.password = pw;
  await wait(4000);
  const rows = (await onDuty()).filter(x => x.day === day);
  assert.equal(rows.length, 1, `one line for the day, not one a restart (${JSON.stringify(rows.map(x => [x.when, x.minutes, x.now]))})`);
});
