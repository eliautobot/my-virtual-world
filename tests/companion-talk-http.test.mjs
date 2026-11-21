// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A companion out with its owner talks like a person, not a report (2026-11-17, the product owner: "if I tell them 'how are you doing
// today?' they don't have to say we're going seventy kilometres per hour"): Free Will's check of the message says which of
// its senses the answer needs (server/free-will/moments.js RELEVANT, needs_sight) and only that goes with it — small talk
// gets where it is in short, a question about the way gets the place, a question about how something looks gets its eyes
// (and only then); with no decision service, all of it as before. Said out loud, it is told to answer out loud. Its
// instructions say how a friend beside you talks, and stay the same message after message.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession } from './helpers/server.mjs';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 9)]).toString('base64');
const textOf = c => (typeof c === 'string' ? c : (c || []).filter(p => p.type === 'text').map(p => p.text).join('\n'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(100); } };
let s, owner, fake, ws, A, B, seen = [];
const asks = [];

// (the decision service: nothing of its senses is needed, unless the message asks the way or how something looks)
const SCRIPT = JSON.stringify([{ when: 'how far', answers: { about_world: 0.9, needs_place: 0.95 } }, { when: 'what colour', answers: { about_world: 0.9, needs_sight: 0.95, needs_around: 0.9 } }]);

before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; });
    req.on('end', () => {
      const j = b ? JSON.parse(b) : {};
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
      seen.push(j);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ model: 'fake', choices: [{ delta: { content: 'Good, thanks.' } }] }) + '\n\n');
      res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) + '\n\ndata: [DONE]\n\n');
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 120, agents: 2, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  [A, B] = (await owner.get('/api/agents')).json.agents;
  const brain = await owner.post('/api/connections', { kind: 'models', label: 'Test brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' }, secrets: { apiKey: 'sk-test' } });
  assert.equal(brain.status, 200, brain.text);
  const dec = await owner.post('/api/connections', { kind: 'decisions-mock', label: 'Relevance', scope: 'installation', config: { latencyMs: 5, behaviour: 'no', script: SCRIPT }, secrets: { apiKey: 'k' } });
  assert.equal(dec.status, 200, dec.text);
  assert.equal((await owner.post('/api/settings', { values: { 'freeWill.defaultConnection': String(dec.json.id) } })).status, 200);
  for (const a of [A, B]) {
    assert.equal((await owner.post('/api/agents/update', { id: a.id, connectionId: brain.json.id, nativeId: 'mind' })).status, 200);
    assert.equal((await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' })).status, 200);
    assert.equal((await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'life' })).status, 200);
  }
  // (A has Free Will — its owner's messages are checked —; B has none: all of its senses, as before)
  assert.equal((await owner.post('/api/free-will/agent', { agent: A.id, enabled: true })).status, 200);
  ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: owner.cookie } });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.t === 'see') { asks.push(m); ws.send(JSON.stringify({ t: 'see', id: m.id, mime: 'image/jpeg', data: JPEG })); } };
  await wait(400);
  ws.send(JSON.stringify({ t: 'pobserve', on: false }));
});
after(async () => { try { ws?.close(); } catch { /* closed */ } await s?.stop(); fake?.close(); });

async function standBy(rec) {
  const me = (await owner.get(`/api/agent/${rec.i}`)).json;
  ws.send(JSON.stringify({ t: 'pwarp', x: me.pos.x + 1.5, z: me.pos.z, ctx: me.pos.ctx }));
  await wait(500);
}
/** One message; what its brain was asked: { note (before the words), system, images }. */
async function say(agent, session, input, extra = {}) {
  const n = seen.length;
  const r = await owner.post('/api/providers/runs', { agent: agent.id, session, input, ...extra });
  assert.equal(r.status, 200, r.text);
  assert.ok(await waitFor(async () => (await owner.get(`/api/providers/runs/events?run=${r.json.runId}`)).json.done), 'it answered');
  const call = seen.slice(n).find(j => j?.stream);
  const last = call.messages.at(-1), text = textOf(last.content);
  return { note: (/^\[My Virtual World — [\s\S]*?\]/.exec(text) || [''])[0], system: textOf(call.messages[0].content), images: Array.isArray(last.content) ? last.content.filter(p => p.type === 'image_url').length : 0 };
}

test('small talk out together: where it is in short — no street, speed, time or people — and how a friend beside you talks', async () => {
  await standBy(A);
  const sess = (await owner.post('/api/chat-sessions/create', { agent: A.id })).json.session.id;
  const a0 = asks.length;
  const r = await say(A, sess, 'How are you doing today?');
  assert.match(r.note, /together right now/, 'it knows it is with them');
  assert.match(r.note, /Where: /);
  assert.doesNotMatch(r.note, /Around you|Time:|Lately|Since .*'s last message/, 'nothing it was not asked about');
  assert.match(r.note, /a look away: tool "look"/, 'the rest is a look away');
  assert.equal(asks.length, a0, 'no picture asked for');
  assert.equal(r.images, 0);
  assert.match(r.system, /OUT WITH .*: like a friend beside them|Talk like a friend beside them/);
  assert.match(r.system, /not what you talk about/);
  // the same instructions message after message (a provider's prompt cache; the first asks for the chat's title)
  const r2 = await say(A, sess, 'Nice day, huh'), r3 = await say(A, sess, 'What colour is the sky, would you say?');
  assert.equal(r3.system, r2.system, 'whatever goes with the message');
});

test('a question about the way gets the place; one about how something looks gets its eyes — and only then', async () => {
  await standBy(A);
  const sess = (await owner.post('/api/chat-sessions/create', { agent: A.id })).json.session.id;
  const a0 = asks.length;
  const way = await say(A, sess, 'How far is the lake from here?');
  assert.match(way.note, /Places near you/, 'the place and the places near it');
  assert.doesNotMatch(way.note, /Time:|Around you/, 'not the time, not who is around');
  assert.equal(asks.length, a0, 'no picture for the way');
  const look = await say(A, sess, 'What colour is that car over there?');
  assert.equal(asks.length, a0 + 1, 'its eyes, for how something looks');
  assert.equal(look.images, 1, 'the picture with the message');
  assert.match(look.note, /because answering needs your eyes/);
  assert.match(look.note, /don't describe the rest of it/);
  assert.match(look.note, /Around you/, 'who and what is around, asked about');
});

test('said out loud: answered out loud; written: no such line', async () => {
  await standBy(A);
  const sess = (await owner.post('/api/chat-sessions/create', { agent: A.id })).json.session.id;
  assert.match((await say(A, sess, 'Hey, you there?', { spoken: true })).note, /said out loud, by voice: answer out loud/);
  assert.doesNotMatch((await say(A, sess, 'Hey, you there?')).note, /said out loud/);
  assert.doesNotMatch((await say(A, sess, 'Hey, you there?', { spoken: 'yes' })).note, /said out loud/, 'only a real yes');
});

test('no decision service (its Free Will off): all of its senses with the message, as before', async () => {
  await standBy(B);
  const sess = (await owner.post('/api/chat-sessions/create', { agent: B.id })).json.session.id;
  const r = await say(B, sess, 'How are you doing today?');
  assert.match(r.note, /together right now/);
  assert.match(r.note, /Time:/);
  assert.doesNotMatch(r.note, /a look away/);
});
