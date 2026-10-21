// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An owner's message to an agent whose brain is the server's own (docs/features/CHAT.md §13.3), on a real server: at
// 3 AM in the city its body is asleep; the message wakes it - the run makes it work (presence: the agent named by its own
// key, though every agent on the brain shares the platform id "mind"), so its body gets up to work on it - and its
// answer knows it was woken, what it really did today, and that nothing else about its moment is to be made up; at Work
// the same facts, and no office or desk.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession } from './helpers/server.mjs';

let s, owner, fake, A;
const systems = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(100); } };

before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
      const j = JSON.parse(b || '{}');
      systems.push(j.messages.find(m => m.role === 'system')?.content || '');
      const c = 'Hello.';
      if (!j.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ model: 'fake', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ reply: c }) } }], usage: { prompt_tokens: 5, completion_tokens: 2 } })); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ model: 'fake', choices: [{ delta: { content: c } }] })}\n\ndata: ${JSON.stringify({ model: 'fake', choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\ndata: [DONE]\n\n`);
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 260, agents: 2, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  const agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
  const c = await owner.post('/api/connections', { kind: 'models', label: 'Brain', scope: 'installation', config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' }, secrets: { apiKey: 'k' } });
  assert.equal(c.status, 200, c.text);
  // (both on the brain with the platform id "mind", as on a live installation: the first must not take the second's runs)
  for (const a of agents) assert.equal((await owner.post('/api/agents/update', { id: a.id, connectionId: c.json.id, nativeId: 'mind' })).status, 200);
  A = agents[1];
});
after(async () => { await s?.stop(); fake?.close(); });

const info = async () => (await owner.get(`/api/agent/${A.i}`)).json;
const ask = async (session, input) => {
  const n = systems.length;
  const r = await owner.post('/api/providers/runs', { agent: A.id, session, input });
  assert.equal(r.status, 200, r.text);
  assert.ok(await waitFor(async () => (await owner.get(`/api/providers/runs/events?run=${r.json.runId}`)).json?.done), 'it answered');
  return systems[n] || '';
};

test('asleep at 3 AM, its owner\'s message wakes it: its body gets up to work on it, and its answer knows it was woken', async () => {
  assert.equal((await owner.post('/api/clock', { skip: 3 })).status, 200);
  const asleep = await waitFor(async () => (await info()).act?.use === 'sleep', 30000);
  assert.ok(asleep, `asleep at 3 AM (${JSON.stringify((await info()).act)})`);
  const sess = (await owner.post('/api/chat-sessions/create', { agent: A.id })).json.session;
  assert.equal((await owner.post('/api/chat-sessions/prefs', { agent: A.id, session: sess.id, mode: 'life' })).status, 200);
  const sys = await ask(sess.id, 'are you up?');
  assert.match(sys, /«[^»]+»'s message just woke you up: you were asleep/, 'it knows it was woken');
  assert.match(sys, /\nNOW: \w+ \d{1,2}:\d{2} AM, [^\n]*\./);
  assert.doesNotMatch(sys, /\nNOW: [^\n]*sleeping/, 'not "sleeping" while it answers');
  assert.match(sys, /Only what is written here is true about you right now\. Never make up details/);
  // its body: working on it (the task reflex, now that the run is seen as its own)
  const woke = await waitFor(async () => { const a = (await info()).act; return a && /^task/.test(a.use) ? a : null; }, 30000);
  assert.ok(woke, `its body got up to work on it (${JSON.stringify((await info()).act)})`);
  // at Work: the same facts, no office
  const w = (await owner.post('/api/chat-sessions/create', { agent: A.id })).json.session;
  const back = await waitFor(async () => (await info()).act?.use === 'sleep', 60000);   // (back to bed after the task)
  const ws = await ask(w.id, 'what are you doing?');
  assert.match(ws, /ABOUT YOU RIGHT NOW \(facts; nothing more is true\): you also live as a resident of a small virtual city, where your body is /);
  assert.match(ws, /Don't make up an office, a desk, colleagues or a commute/);
  if (back) assert.match(ws, /message just woke you up/, 'asleep again: woken again');
  assert.doesNotMatch(ws, /YOUR LIFE IN THE CITY|TODAY SO FAR/, 'nothing else of its life at work');
});

test('awake, its answer says what it was doing as the message came; what it did today is what it really did', async () => {
  assert.equal((await owner.post('/api/clock', { skip: 13 })).status, 200);
  const up = await waitFor(async () => { const a = (await info()).act; return a && a.use !== 'sleep' && !/^task/.test(a.use) ? a : null; }, 30000);
  assert.ok(up, 'awake in the afternoon');
  const sess = (await owner.post('/api/chat-sessions/create', { agent: A.id })).json.session;
  assert.equal((await owner.post('/api/chat-sessions/prefs', { agent: A.id, session: sess.id, mode: 'life' })).status, 200);
  const sys = await ask(sess.id, 'what are you up to?');
  assert.match(sys, /When «[^»]+»'s message came you were (on the way|[a-z])[^\n]*; you are answering it now\./);
  assert.doesNotMatch(sys, /woke you up/);
});
