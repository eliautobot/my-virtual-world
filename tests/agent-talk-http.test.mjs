// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Talking with someone else's agent in the city on a real server (docs/features/CHAT.md §14): its owner is sent to the
// chat window, a resident-like agent (no brain that handles visitors) only greets, anyone else talks - a few short
// messages, cleared after a few minutes, every limit the admin's and enforced here; the answer goes to the talker alone
// and never into their chat window's lists; the agent stops and turns to them; its owner reads every conversation and
// blocks whom they choose.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, bob, fake, A, B, annId;
const asked = [], systems = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(60); } };

before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
      const j = JSON.parse(b || '{}'), user = j.messages.filter(m => m.role === 'user').map(m => (typeof m.content === 'string' ? m.content : '')).join('\n');
      asked.push(user);
      const system = j.messages.filter(m => m.role === 'system').map(m => (typeof m.content === 'string' ? m.content : '')).join('\n');
      systems.push(system);
      const said = /«([^»]*)»[^«]*$/.exec(user)?.[1] || '', atWork = /Someone who is NOT/.test(system);
      res.setHeader('content-type', 'application/json');
      // (it also asks to keep a memory: kept in Life, never at work)
      res.end(JSON.stringify({ model: 'fake', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ reply: `Hello! You said: ${said}`, memories: [{ text: atWork ? 'Met a visitor at work' : 'Met a visitor', importance: 3 }] }) } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 260, agents: 2, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  bob = await userSession(s, owner, { login: 'bob', displayName: 'Bob', role: 'member' });
  annId = (await ann.get('/api/auth/me')).json.account.id;
  const agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
  const c = await owner.post('/api/connections', { kind: 'models', label: 'Brain', scope: 'installation', config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' }, secrets: { apiKey: 'k' } });
  assert.equal(c.status, 200, c.text);
  [A, B] = agents;
  assert.equal((await owner.post('/api/agents/update', { id: A.id, connectionId: c.json.id, nativeId: 'mind' })).status, 200);
});
after(async () => { await s?.stop(); fake?.close(); });

const say = (c, text, extra = {}) => c.post('/api/agent-talk/say', { agent: A.id, text, ...extra });
const answer = async (c, runId) => waitFor(async () => { const e = (await c.get(`/api/providers/runs/events?run=${runId}`)).json; return e?.done ? e.events.map(x => x.event).find(x => x.type === 'run.end') : null; });

test('who gets what: its owner the chat window, anyone else a talk, an agent without a visitor-safe brain a greeting', async () => {
  assert.deepEqual((await owner.get(`/api/agent-talk?agent=${A.id}`)).json, { mode: 'own', agent: A.id });
  const st = (await ann.get(`/api/agent-talk?agent=${A.id}`)).json;
  assert.deepEqual([st.mode, st.session, st.used, st.left, st.maxMessages, st.maxChars, st.windowMs], ['talk', null, 0, 15, 15, 200, 300000], 'the admin\'s limits, nothing said yet');
  const g = (await ann.get(`/api/agent-talk?agent=${B.id}`)).json;
  assert.deepEqual([g.mode, g.why], ['greet', 'greets_only']);
  assert.equal((await say(owner, 'hi')).json.code, 'own', 'its owner talks with it in the chat window');
  assert.equal((await ann.post('/api/agent-talk/say', { agent: B.id, text: 'hi' })).json.code, 'greets_only');
  assert.equal((await ann.get('/api/agent-talk?agent=999999')).status, 404);
  // its owner in person: their agent stops and turns to them; nobody else may make it
  assert.equal((await owner.post('/api/agent-talk/face', { agent: A.id, x: 3, z: 4 })).json.ok, true);
  assert.equal((await ann.post('/api/agent-talk/face', { agent: A.id, x: 3, z: 4 })).status, 404);
});

test('a talk: the answer to the talker alone, never in their chat window; the agent stops for them; counted, bounded, cleared', async () => {
  const r = await say(ann, 'What do you do here?', { x: 1, z: 2 });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.used, r.json.left], [1, 14]);
  assert.ok(r.json.endsAt > Date.now() + 250000, 'cleared five minutes after its first message');
  const end = await answer(ann, r.json.runId);
  assert.equal(end?.status, 'ok', JSON.stringify(end));
  assert.equal(end.text, 'Hello! You said: What do you do here?');
  assert.equal((await owner.get(`/api/providers/runs/events?run=${r.json.runId}`)).status, 404, 'nobody else gets it, its owner neither');
  assert.equal((await bob.get(`/api/providers/runs/events?run=${r.json.runId}`)).status, 404);
  assert.deepEqual((await ann.get('/api/chat/recent')).json.sessions, [], 'not one of her chats');
  assert.deepEqual((await ann.get('/api/chat/search?q=here')).json.results, [], 'nor in her chat search');
  const me = (await ann.get(`/api/agent/${A.i}`)).json;
  assert.equal(me.act?.use, 'greet', `it stopped and turned to her (${JSON.stringify(me.act)})`);
  const pres = await bob.get(`/api/presence/${A.id}`);
  assert.equal(pres.status, 200, pres.text);
  assert.ok(!['working', 'finishing'].includes(pres.json.state), `nobody is shown it is busy: a talk is not work (${pres.json.state})`);
  // the conversation so far goes with the next message (its context), and the server counts it
  const r2 = await say(ann, 'And on Sundays?');
  assert.deepEqual([r2.json.session, r2.json.used, r2.json.left], [r.json.session, 2, 13]);
  await answer(ann, r2.json.runId);
  assert.match(asked.at(-1), /What do you do here\?/, 'the first message is part of the context');
  // the admin's limits, read at once
  assert.equal((await owner.post('/api/settings', { values: { 'talk.maxMessages': 3, 'talk.maxChars': 20 } })).status, 200);
  const long = await say(ann, 'x'.repeat(21));
  assert.deepEqual([long.status, long.json.code, long.json.maxChars], [413, 'too_long', 20]);
  const r3 = await say(ann, 'Last one'); await answer(ann, r3.json.runId);
  assert.equal(r3.json.left, 0);
  const over = await say(ann, 'One more?');
  assert.deepEqual([over.status, over.json.code], [429, 'talk_limit']);
  assert.ok(over.json.resetAt > Date.now(), 'says when it can start again');
  // cleared: five minutes after its first message, the next message starts a new conversation with nothing of the last
  const db = (await import('node:sqlite')).DatabaseSync;
  const raw = new db(`${s.data}/next.db`);
  raw.prepare("UPDATE chat_sessions SET created = created - 400000 WHERE kind = 'talk'").run();
  raw.close();
  const fresh = await say(ann, 'Hi again');
  assert.equal(fresh.status, 200, fresh.text);
  assert.notEqual(fresh.json.session, r.json.session, 'a new conversation');
  assert.deepEqual([fresh.json.used, fresh.json.left], [1, 2]);
  await answer(ann, fresh.json.runId);
  assert.doesNotMatch(asked.at(-1), /What do you do here|Sundays/, 'nothing of the last conversation goes with it');
  assert.equal((await owner.post('/api/settings', { values: { 'talk.maxMessages': 15, 'talk.maxChars': 200 } })).status, 200);
});

test('its owner reads every conversation and blocks a player; the admin can switch talking off', async () => {
  const list = (await owner.get(`/api/agent-talk/conversations?agent=${A.id}`)).json.conversations;
  assert.ok(list.length >= 2 && list.every(c => c.account.name === 'Ann'), JSON.stringify(list));
  assert.equal(list.find(c => c.messages === 3)?.blocked, false);
  const one = (await owner.get(`/api/agent-talk/conversation?agent=${A.id}&session=${list.at(-1).id}`)).json;
  assert.deepEqual(one.messages.filter(m => m.role === 'user').map(m => m.text), ['What do you do here?', 'And on Sundays?', 'Last one']);
  assert.match(one.messages.find(m => m.role === 'assistant').text, /You said/);
  for (const r of [await ann.get(`/api/agent-talk/conversations?agent=${A.id}`), await bob.get(`/api/agent-talk/conversation?agent=${A.id}&session=${list[0].id}`)]) assert.equal(r.status, 404, 'nobody else reads them');
  const blk = await owner.post('/api/agent-talk/block', { agent: A.id, account: annId });
  assert.deepEqual(blk.json.blocks.map(b => b.account?.name), ['Ann']);
  assert.deepEqual([(await say(ann, 'hello?')).json.code, (await ann.get(`/api/agent-talk?agent=${A.id}`)).json.why], ['blocked', 'blocked']);
  assert.equal((await say(bob, 'hi')).status, 200, 'others still talk with it');
  assert.equal((await owner.post('/api/agent-talk/block', { agent: A.id, account: annId, on: false })).json.blocks.length, 0);
  assert.equal((await ann.get(`/api/agent-talk?agent=${A.id}`)).json.mode, 'talk', 'let her talk again');
  assert.equal((await owner.post('/api/agent-talk/block', { agent: A.id })).json.code, 'bad_request');
  assert.equal((await ann.post('/api/agent-talk/block', { agent: A.id, account: annId })).status, 404, 'only its owner (or a manager) blocks');
  assert.equal((await owner.post('/api/settings', { values: { 'talk.enabled': false } })).status, 200);
  assert.deepEqual([(await ann.get(`/api/agent-talk?agent=${A.id}`)).json.why, (await say(ann, 'hi')).json.code], ['talk_off', 'talk_off']);
  assert.equal((await owner.post('/api/settings', { values: { 'talk.enabled': true } })).status, 200);
});

test('what its owner gives others: its job (never its work notes, nothing kept), its life, or only a greeting', async () => {
  // its job: the brief and what it knows - not the notes it keeps from its owner's chats
  const w = await owner.post('/api/agent-work', { agent: A.id, company: 'Sunrise Bakery', instructions: 'Answer questions about the bakery. Be cheerful.', knowledge: 'Open 7 to 18. Sourdough is $6.', publicMode: 'work' });
  assert.equal(w.status, 200, w.text);
  assert.equal(w.json.brief.publicMode, 'work');
  assert.equal((await owner.post('/api/agent-work/notes', { agent: A.id, add: { text: 'Private: the alarm code is 4321' } })).status, 200);
  const conv = (await owner.get(`/api/agent-talk/conversations?agent=${A.id}`)).json;
  assert.deepEqual([conv.publicMode, conv.limits.maxMessages, conv.limits.maxChars, conv.why], ['work', 15, 200, null], 'the Studio is told what others get and the limits');
  const r = await say(ann, 'When are you open?');
  assert.equal(r.status, 200, r.text);
  const end = await answer(ann, r.json.runId);
  assert.equal(end?.status, 'ok', JSON.stringify(end));
  const sys = systems.at(-1), user = asked.at(-1);
  assert.match(sys, /Someone who is NOT/, 'at work for a visitor');
  assert.match(sys, /Sunrise Bakery/); assert.match(sys, /Answer questions about the bakery/); assert.match(sys, /Open 7 to 18/);
  assert.doesNotMatch(sys + user, /alarm code|4321/, 'never its owner\'s work notes');
  assert.match(user, /NEW MESSAGE from the visitor/);
  const mems = (await owner.get(`/api/agent-life/memories?agent=${A.id}&term=short&limit=50`)).json.memories || [];
  assert.ok(!mems.some(m => /at work/.test(m.text)), 'nothing of a visitor at work is kept in its life');
  // its life: the resident's chat again
  assert.equal((await owner.post('/api/agent-work', { agent: A.id, publicMode: 'life' })).status, 200);
  const r2 = await say(ann, 'How is your day?');
  await answer(ann, r2.json.runId);
  assert.doesNotMatch(systems.at(-1), /Someone who is NOT|Sunrise Bakery/, 'in Life it is the resident');
  // only a greeting: nobody talks with it, and the Studio knows it was its owner's choice
  assert.equal((await owner.post('/api/agent-work', { agent: A.id, publicMode: 'greet' })).status, 200);
  assert.deepEqual([(await ann.get(`/api/agent-talk?agent=${A.id}`)).json.why, (await say(ann, 'hi')).json.code], ['greets_only', 'greets_only']);
  assert.equal((await owner.get(`/api/agent-talk/conversations?agent=${A.id}`)).json.publicMode, 'greet');
  assert.equal((await owner.post('/api/agent-work', { agent: A.id, publicMode: 'everyone' })).json.code, 'bad_mode');
  assert.equal((await owner.post('/api/agent-work', { agent: A.id, publicMode: 'life' })).status, 200);
});

test('a day\'s worth (the admin\'s): one person with one agent, and all visitors with one agent - a new conversation doesn\'t start the count again', async () => {
  const db = (await import('node:sqlite')).DatabaseSync;
  const age = () => { const raw = new db(`${s.data}/next.db`); raw.prepare("UPDATE chat_sessions SET created = created - 400000 WHERE kind = 'talk'").run(); raw.close(); };
  const cay = await userSession(s, owner, { login: 'cay', displayName: 'Cay', role: 'member' });
  assert.equal((await owner.post('/api/settings', { values: { 'talk.maxMessages': 15, 'talk.maxChars': 200, 'talk.visitorPerDay': 3 } })).status, 200);
  for (const t of ['Hi there', 'How are you?']) { const r = await say(cay, t); assert.equal(r.status, 200, r.text); await answer(cay, r.json.runId); }
  age();   // (a new conversation now: its window is over)
  const third = await say(cay, 'Me again!');
  assert.equal(third.status, 200, third.text);
  assert.equal(third.json.used, 1, 'a new conversation');
  await answer(cay, third.json.runId);
  age();
  const fourth = await say(cay, 'And again?');
  assert.deepEqual([fourth.status, fourth.json.code], [429, 'visitor_day_limit'], 'the day\'s three, over every conversation');
  // all visitors with this agent: its answers to everyone together
  assert.equal((await owner.post('/api/settings', { values: { 'talk.visitorPerDay': 50, 'talk.agentVisitorPerDay': 1 } })).status, 200);
  const dan = await userSession(s, owner, { login: 'dan', displayName: 'Dan', role: 'member' });
  const busy = await say(dan, 'Hello!');
  assert.deepEqual([busy.status, busy.json.code], [429, 'agent_day_limit'], 'it has talked with enough visitors today');
  assert.equal((await owner.post('/api/settings', { values: { 'talk.agentVisitorPerDay': 200 } })).status, 200);
  const ok = await say(dan, 'Hello!');
  assert.equal(ok.status, 200, 'the admin\'s change applies at once');
  await answer(dan, ok.json.runId);
});
