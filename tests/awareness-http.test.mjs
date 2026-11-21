// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents' awareness on a real server (server/senses/, docs/features/awareness.md) with a built-in brain (a fake model
// server): its owner's choice in the Studio (only they and its managers); what goes with a message in each mode —
// apart, one line; together (its owner's character beside it), the full picture; when it asks, the time and its tools;
// off, nothing — always with the newest message, never in the instructions (which stay the same message after message)
// nor in the conversation kept; its look tool, used by the brain when a question needs it, and what it knew kept with the
// answer (in the history too); a picture of the city its owner shares, told what it shows; its diary; the overview.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, agents, fake, ws, A;
const seenEye = [];
const EYE = '/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYxLjMuMTAwAP/bAEMACAgICQgJCwsLCwsLDQwNDQ0NDQ0NDQ0NDQ4ODhEREQ4ODg0NDg4QEBEREhMSERERERMTFBQUGBgXFxwcHSIiKf/EAE0AAQEAAAAAAAAAAAAAAAAAAAAFAQEBAQAAAAAAAAAAAAAAAAAABAUQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAGAAgADASIAAhEAAxEA/9oADAMBAAIRAxEAPwCIAiYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//2Q==';
const seen = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(150); } };
const NOTE = /^\[My Virtual World — [\s\S]*?\]\n\n/;
const textOf = c => (typeof c === 'string' ? c : (c || []).filter(p => p.type === 'text').map(p => p.text).join('\n'));

before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      const j = b ? JSON.parse(b) : null;
      seen.push(j);
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake-small' }] })); return; }
      const msgs = j.messages || [], last = textOf(msgs.at(-1)?.content), words = last.replace(NOTE, '');
      // a question about where it is: it looks around first, then answers from what it saw
      let content = 'Sure.';
      if (/how does it look\?/i.test(words) && !/^RESULTS:/.test(last)) content = '{"use":[{"tool":"see"}]}';
      else if (/^RESULTS:\n- see: the picture is attached/.test(last)) content = 'I can see it now.';
      else if (/where are you\?/i.test(words) && !/^RESULTS:/.test(last)) content = '{"use":[{"tool":"look"}]}';
      // words first, then a look ("let me look around"): it goes on with what it found
      else if (/what's around\?/i.test(words) && !/^RESULTS:/.test(last)) content = 'One moment, let me look around.\n{"use":[{"tool":"look"}]}';
      else if (/^RESULTS:/.test(last)) content = `I looked: ${/Where: ([^\n]*)/.exec(last)?.[1] || 'nothing'}`;
      if (j.stream) {
        res.setHeader('content-type', 'text/event-stream');
        res.write(`data: ${JSON.stringify({ model: 'fake-small', choices: [{ delta: { content } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 640 } } })}\n\ndata: [DONE]\n\n`);
        res.end(); return;
      }
      res.end(JSON.stringify({ model: 'fake-small', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 200, agents: 2, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  agents = (await owner.get('/api/agents')).json.agents;
  A = agents[0];
  const c = await owner.post('/api/connections', { kind: 'models', label: 'Test brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake-small' }, secrets: { apiKey: 'sk-test' } });
  assert.equal(c.status, 200, c.text);
  for (const a of agents) {
    assert.equal((await owner.post('/api/agents/update', { id: a.id, connectionId: c.json.id, nativeId: 'mind' })).status, 200);
    assert.equal((await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' })).status, 200);
    assert.equal((await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'life' })).status, 200);
  }
  ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: owner.cookie } });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  // (its eyes: the page answers the server's ask with one small JPEG — server/senses/eye.js)
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.t === 'see') { seenEye.push({ id: m.id, i: m.i, x: m.x, z: m.z }); try { ws.send(JSON.stringify({ t: 'see', id: m.id, mime: 'image/jpeg', data: EYE })); } catch { /* closed */ } } };
  await wait(400);
  ws.send(JSON.stringify({ t: 'pobserve', on: false }));
});
after(async () => { try { ws?.close(); } catch { /* closed */ } await s?.stop(); fake?.close(); });

const newChat = async () => (await owner.post('/api/chat-sessions/create', { agent: A.id, label: 'Aware' })).json.session;
async function ask(session, input, extra = {}) {
  const n = seen.length;
  const r = await owner.post('/api/providers/runs', { agent: A.id, session, input, ...extra });
  assert.equal(r.status, 200, r.text);
  const ev = await waitFor(async () => { const e = (await owner.get(`/api/providers/runs/events?run=${r.json.runId}`)).json; return e.done ? e.events.map(x => x.event) : null; });
  assert.ok(ev, 'it answered');
  const calls = seen.slice(n).filter(j => j?.stream);
  const first = calls[0];
  return { end: ev.find(e => e.type === 'run.end'), events: ev, calls, system: first?.messages[0].content || '', last: textOf(first?.messages.at(-1).content), messages: first?.messages || [] };
}
const info = async i => (await owner.get(`/api/agent/${i}`)).json;
/** The owner's character to the agent (or far from it). */
async function standBy(far = false) {
  const me = await info(A.i);
  ws.send(JSON.stringify({ t: 'pwarp', x: me.pos.x + (far ? 400 : 1.5), z: me.pos.z, ctx: far ? -1 : me.pos.ctx }));
  await wait(500);
}

test('its owner chooses its awareness; only they and its managers', async () => {
  const v = (await owner.get(`/api/awareness?agent=${A.id}`)).json;
  assert.equal(v.mode, 'together'); assert.equal(v.own, null); assert.equal(v.default, 'together'); assert.equal(v.enabled, true);
  assert.deepEqual(v.modes.map(m => m.id), ['off', 'ask', 'together', 'always']);
  assert.equal(v.now.body, true);
  assert.match(v.now.line, /^\w+ \d{1,2}:\d{2} [AP]M — /);
  assert.ok(v.now.tokens.line > 0 && v.now.tokens.full > v.now.tokens.line);
  assert.equal((await owner.post('/api/awareness', { agent: A.id, mode: 'always' })).json.mode, 'always');
  assert.equal((await owner.post('/api/awareness', { agent: A.id, mode: 'loud' })).status, 400);
  assert.equal((await owner.post('/api/awareness', { agent: A.id, mode: null })).json.own, null, 'back to the default');
  assert.equal((await ann.get(`/api/awareness?agent=${A.id}`)).status, 404, 'someone else finds nothing');
  assert.equal((await ann.post('/api/awareness', { agent: A.id, mode: 'off' })).status, 404);
  assert.equal((await ann.get(`/api/awareness/diary?agent=${A.id}`)).status, 404);
  assert.equal((await ann.get('/api/awareness/overview')).status, 403);
  const o = (await owner.get('/api/awareness/overview')).json;
  assert.equal(o.enabled, true); assert.ok(o.ticks >= 0);
});

test('apart: one line with the message; together: the full picture; the instructions stay the same; nothing kept in the chat', async () => {
  await standBy(true);
  const sess = await newChat();
  const apart = await ask(sess.id, 'Hello!');
  assert.match(apart.last, NOTE, 'its senses go with the newest message, before its words');
  assert.match(apart.last, /is not with you right now/);
  assert.doesNotMatch(apart.last, /Around you:/, 'apart: one line');
  assert.match(apart.last, /\n\nHello!$/);
  assert.match(apart.system, /WHAT YOU CAN TELL ABOUT THE CITY RIGHT NOW/);
  assert.match(apart.system, /\{"tool":"look"\}/, 'it may look around');
  assert.doesNotMatch(apart.system, /NOW: |TODAY SO FAR|PLACES NEAR ME/, 'nothing that changes message to message in the instructions');
  const knew = apart.end.aware;
  assert.equal(knew.mode, 'together'); assert.equal(knew.told, 'line'); assert.equal(knew.together, null);
  assert.equal(apart.end.tokensCached, 640, 'what the provider read from its cache');
  const apart2 = await ask(sess.id, 'Still there?');   // (the first message of a chat also asks for its title)
  // together: its owner's character beside it
  await standBy();
  const near = await ask(sess.id, 'And now?');
  assert.match(near.last, /You and «?Owner»? are together right now: (right beside you|near you)/);
  assert.match(near.last, /Around you: .*Owner \(your owner, the one writing to you\)/);
  assert.equal(near.end.aware.told, 'full');
  assert.equal(near.system, apart2.system, 'the same instructions, message after message, apart or together (a provider\'s prompt cache)');
  assert.deepEqual(near.messages.slice(1, -1).map(m => textOf(m.content)), ['Hello!', 'Sure.', 'Still there?', 'Sure.'], 'the conversation kept without its notes');
  // kept with the answer, in the history
  const h = (await owner.get(`/api/providers/history?agent=${A.id}&session=${sess.id}`)).json.messages;
  const ans = h.filter(m => m.role === 'assistant');
  assert.equal(ans.at(-1).meta.aware.told, 'full');
  assert.equal(ans.at(-1).meta.cachedIn, 640);
  assert.ok(h.filter(m => m.role === 'user').every(m => !NOTE.test(m.text)), 'the person\'s words as they wrote them');
});

test('when it asks: the time and its tools; it looks around itself, and what it looked up is kept', async () => {
  await owner.post('/api/awareness', { agent: A.id, mode: 'ask' });
  const sess = await newChat();
  const r = await ask(sess.id, 'Where are you?');
  assert.match(r.last, /You are not told about your surroundings with each message/);
  assert.doesNotMatch(r.last, /Around you:/);
  assert.equal(r.calls.length, 2, 'it looked, then answered');
  assert.match(textOf(r.calls[1].messages.at(-1).content), /^RESULTS:\n- look: Where: /);
  assert.match(r.end.text, /^I looked: /);
  assert.equal(r.end.aware.told, 'pointer');
  assert.deepEqual(r.end.aware.looked.map(l => l.tool), ['look']);
  assert.ok(r.events.some(e => e.type === 'tool.start' && e.name === 'look'), 'shown as a step');
  await owner.post('/api/awareness', { agent: A.id, mode: null });
});

test('it says it will look, and looks: its answer goes on with what it found, its first words kept', async () => {
  const sess = await newChat();
  const r = await ask(sess.id, 'What\'s around?');
  assert.equal(r.calls.length, 2, 'looked, then went on');
  assert.match(r.end.text, /^One moment, let me look around\.\n\nI looked: /);
  assert.match(textOf(r.calls[1].messages.at(-1).content), /^RESULTS:\n- look: Where: [\s\S]*don't repeat it/);
  assert.deepEqual(r.end.aware.looked.map(l => l.tool), ['look']);
  const h = (await owner.get(`/api/providers/history?agent=${A.id}&session=${sess.id}`)).json.messages;
  assert.match(h.filter(m => m.role === 'assistant').at(-1).text, /^One moment, let me look around\.\n\nI looked: /, 'kept whole');
});

test('off: nothing about its surroundings, and it can\'t look around', async () => {
  await owner.post('/api/awareness', { agent: A.id, mode: 'off' });
  await standBy();
  const sess = await newChat();
  const r = await ask(sess.id, 'Hi there');
  assert.match(r.last, /switched off your awareness/);
  assert.doesNotMatch(r.last, /Around you:|outside at|in «/);
  assert.doesNotMatch(r.system, /\{"tool":"look"\}/);
  assert.match(r.system, /\{"tool":"recent"\}/, 'its own day it still knows');
  assert.equal(r.end.aware.told, 'none');
  await owner.post('/api/awareness', { agent: A.id, mode: null });
});

test('a picture of the city its owner shares: told what it shows, checked against the world', async () => {
  await standBy();
  const me = await info(A.i);
  const png = (await owner.request('POST', `/api/chat/attachments?name=${encodeURIComponent('view.png')}`, Buffer.from('89504e470d0a1a0a', 'hex'), { 'content-type': 'application/octet-stream' })).json.attachment;
  const sess = await newChat();
  const r = await ask(sess.id, 'Who is this?', { attachments: [png.id], view: { cam: { x: me.pos.x + 3, y: 2, z: me.pos.z, ctx: me.pos.ctx, yaw: 0 }, visible: [{ kind: 'resident', i: A.i }, { kind: 'resident', i: 999999 }], at: Date.now() } });
  assert.match(r.last, /This picture is «?Owner»?'s own view of the city, taken just now/);
  assert.match(r.last, new RegExp(`${A.name} \\(that's you\\)`));
  // without a picture, a view says nothing
  const r2 = await ask(sess.id, 'And this?', { view: { cam: { x: me.pos.x, z: me.pos.z, ctx: -1 }, visible: [{ kind: 'resident', i: A.i }] } });
  assert.doesNotMatch(r2.last, /This picture is/);
});

test('its diary: what it lived lately, newest first, for its owner', async () => {
  await standBy(true); await wait(2500);
  await standBy(); await wait(2500);
  const d = (await owner.get(`/api/awareness/diary?agent=${A.id}`)).json.items;
  assert.ok(Array.isArray(d));
  assert.ok(d.some(l => /came over to you/.test(l.text)), JSON.stringify(d.slice(0, 5)));
  assert.ok(d.every(l => typeof l.clock === 'string' && typeof l.kind === 'string'));
});

test("it asks to see: its owner's page draws one frame from where it stands, and the picture goes into the answer", async () => {
  await standBy();
  const sess = await newChat();
  seenEye.length = 0;
  const r = await ask(sess.id, 'how does it look?');
  assert.ok(seenEye.length >= 1, 'the server asked the page');
  assert.ok(Number.isFinite(seenEye[0].x) && Number.isFinite(seenEye[0].z) && seenEye[0].i === A.i, 'it asked from where its body stands: ' + JSON.stringify(seenEye[0]));
  const withPic = r.calls.find(c => JSON.stringify(c.messages || []).includes('image_url'));
  assert.ok(withPic, 'the picture went with the next turn: ' + JSON.stringify(r.calls.map(c => JSON.stringify(c.messages).slice(0, 120))));
  // (in the results turn itself: one user turn after its tool request, as every provider takes it)
  const M = withPic.messages;
  assert.equal(M.at(-2).role, 'assistant'); assert.equal(M.at(-1).role, 'user');
  assert.ok(M.at(-1).content.some(p => p.type === 'image_url') && /^RESULTS:/.test(textOf(M.at(-1).content)));
  assert.equal(r.end.text, 'I can see it now.');
  assert.ok((r.events || []).some(e => /^tool\./.test(e.type) && e.name === 'see'), 'the tool is shown as used: ' + JSON.stringify((r.events || []).filter(e => /^tool\./.test(e.type))));
});
