// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's eyes on a real server (server/senses/eye.js, docs/features/awareness.md §9), with a page that answers the
// server's ask: a message about the world (Free Will's check, a decision service that says yes to everything) from its
// owner beside it takes one frame from where it stands — inline, with the message, to a built-in brain (an image part of
// the newest turn) and to another platform's agent (one more picture: the mock provider tells what it got) — never a file
// left on disk; far from its owner's character no page is asked and nothing claims a picture; a page that can't draw it
// says so at once and the agent is told it could not look; someone it is only shared with gets no eyes; and its see tool
// is offered only near its owner, its picture in the results turn (one user turn after its tool request).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 9)]).toString('base64');
const NOTE = /^\[My Virtual World — [\s\S]*?\]\n\n/;
const textOf = c => (typeof c === 'string' ? c : (c || []).filter(p => p.type === 'text').map(p => p.text).join('\n'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(100); } };
let s, owner, ann, fake, ws, annWs, A, B, seen = [];
const asks = [], annAsks = [];
let pageAnswer = 'picture';   // what the page answers: 'picture', 'not_drawn', 'silent'

before(async () => {
  fake = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; });
    req.on('end', () => {
      const j = b ? JSON.parse(b) : {};
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
      seen.push(j);
      // (a model that reads text only: a request with a picture is refused)
      const all = JSON.stringify(j.messages || []);
      if (/textonly/.test(all) && all.includes('image_url')) { res.statusCode = 400; res.end(JSON.stringify({ error: { message: 'image input is not supported' } })); return; }
      const last = textOf(j.messages?.at(-1)?.content), words = last.replace(NOTE, '');
      let content = 'Sure.';
      if (/take a look\?|textonly/i.test(words) && !/^RESULTS:/.test(last)) content = '{"use":[{"tool":"see"}]}';
      else if (/^RESULTS:/.test(last)) content = 'Now I see it.';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ model: 'fake', choices: [{ delta: { content } }] }) + '\n\n');
      res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) + '\n\ndata: [DONE]\n\n');
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 120, agents: 2, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  // (an administrator: she may put her character anywhere — and manages no agent of the owner's for it)
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'admin' });
  [A, B] = (await owner.get('/api/agents')).json.agents;
  const brain = await owner.post('/api/connections', { kind: 'models', label: 'Test brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake' }, secrets: { apiKey: 'sk-test' } });
  assert.equal(brain.status, 200, brain.text);
  const mock = await owner.post('/api/connections', { kind: 'mock', label: 'Mock', scope: 'installation', config: {}, secrets: { token: 'tok-EYES-1' } });
  assert.equal(mock.status, 200, mock.text);
  // (Free Will's check of its owner's message: a decision service that finds every message about the world)
  const dec = await owner.post('/api/connections', { kind: 'decisions-mock', label: 'Yes', scope: 'installation', config: { latencyMs: 5, behaviour: 'yes' }, secrets: { apiKey: 'k' } });
  assert.equal(dec.status, 200, dec.text);
  assert.equal((await owner.post('/api/settings', { values: { 'freeWill.defaultConnection': String(dec.json.id) } })).status, 200);
  assert.equal((await owner.post('/api/agents/update', { id: A.id, connectionId: brain.json.id, nativeId: 'mind' })).status, 200);
  assert.equal((await owner.post('/api/mind/agent', { agent: A.id, cadence: 'off' })).status, 200);
  assert.equal((await owner.post('/api/agent-work', { agent: A.id, defaultMode: 'life' })).status, 200);
  assert.equal((await owner.post('/api/agents/update', { id: B.id, connectionId: mock.json.id, nativeId: 'mock-a' })).status, 200);
  for (const a of [A, B]) assert.equal((await owner.post('/api/free-will/agent', { agent: a.id, enabled: true })).status, 200);
  assert.equal((await owner.post('/api/agents/share', { id: B.id, kind: 'account', who: String((await ann.get('/api/auth/me')).json.account.id), level: 'use' })).status, 200);
  ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: owner.cookie } });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  // (the owner's page: it answers the server's ask as the page would — a picture, that it doesn't draw it, or nothing)
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t !== 'see') return;
    asks.push(m);
    if (pageAnswer === 'picture') ws.send(JSON.stringify({ t: 'see', id: m.id, mime: 'image/jpeg', data: JPEG }));
    else if (pageAnswer === 'not_drawn') ws.send(JSON.stringify({ t: 'see', id: m.id, error: 'not_drawn' }));
  };
  annWs = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: ann.cookie } });
  await new Promise((res, rej) => { annWs.onopen = res; annWs.onerror = () => rej(new Error('ws')); });
  annWs.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.t === 'see') { annAsks.push(m); annWs.send(JSON.stringify({ t: 'see', id: m.id, mime: 'image/jpeg', data: JPEG })); } };
  await wait(400);
  ws.send(JSON.stringify({ t: 'pobserve', on: false }));
  annWs.send(JSON.stringify({ t: 'pobserve', on: false }));
});
after(async () => { try { ws?.close(); annWs?.close(); } catch { /* closed */ } await s?.stop(); fake?.close(); });

const info = async i => (await owner.get(`/api/agent/${i}`)).json;
/** The owner's character beside agent rec (or far from it). */
async function standBy(rec, far = false) {
  const me = await info(rec.i);
  ws.send(JSON.stringify({ t: 'pwarp', x: me.pos.x + (far ? 400 : 1.5), z: me.pos.z, ctx: far ? -1 : me.pos.ctx }));
  await wait(500);
}
async function run(who, agent, session, input) {
  const n = seen.length;
  const r = await who.post('/api/providers/runs', { agent: agent.id, session, input });
  assert.equal(r.status, 200, r.text);
  const ev = await waitFor(async () => { const e = (await who.get(`/api/providers/runs/events?run=${r.json.runId}`)).json; return e.done ? e.events.map(x => x.event) : null; });
  assert.ok(ev, 'it answered');
  return { end: ev.find(e => e.type === 'run.end'), events: ev, calls: seen.slice(n).filter(j => j?.stream) };
}
const chatWith = async (who, agent) => (await who.post('/api/chat-sessions/create', { agent: agent.id })).json.session.id;
const tmpEyes = () => fs.readdirSync(os.tmpdir()).filter(f => /^mvw-eyes-/.test(f));

test('beside its owner, a message about the world: the page draws from where it stands, and the picture is in the message', async () => {
  await standBy(A);
  pageAnswer = 'picture'; asks.length = 0;
  const before = tmpEyes().length;
  const sess = await chatWith(owner, A);
  const r = await run(owner, A, sess, 'What colour is that tree?');
  assert.equal(asks.length, 1, 'the page was asked once');
  const me = await info(A.i);
  assert.equal(asks[0].i, A.i, 'for its body');
  assert.ok(Math.hypot(asks[0].x - me.pos.x, asks[0].z - me.pos.z) < 3, 'where it stands: ' + JSON.stringify(asks[0]));
  const call = r.calls[0], msgs = call.messages, last = msgs.at(-1);
  assert.equal(last.role, 'user');
  assert.ok(Array.isArray(last.content) && last.content.some(p => p.type === 'image_url' && p.image_url.url === `data:image/jpeg;base64,${JPEG}`), 'the picture is a part of the newest message');
  assert.match(textOf(last.content), /picture of what is in front of you right now is attached \(from where you stand, looking where .+ is looking\), because answering needs your eyes/);
  assert.ok(msgs.every((m, k) => k === 0 || m.role !== msgs[k - 1].role), 'no two turns of one role in a row');
  assert.equal(tmpEyes().length, before, 'nothing written to disk');
  assert.match(r.end.aware?.text || '', /picture of what is in front of you/, 'what it knew says so');
});

test('far from its owner\'s character: no page is asked, nothing claims a picture', async () => {
  await standBy(A, true);
  asks.length = 0;
  const sess = await chatWith(owner, A);
  const r = await run(owner, A, sess, 'What colour is that tree?');
  assert.equal(asks.length, 0);
  const all = JSON.stringify(r.calls[0].messages);
  assert.doesNotMatch(all, /image_url/);
  assert.doesNotMatch(all, /is attached, taken from where you stand/);
});

test('a page that doesn\'t draw it says so at once: it is told it could not look, the answer is not held up', async () => {
  await standBy(A);
  pageAnswer = 'not_drawn'; asks.length = 0;
  const sess = await chatWith(owner, A);
  const t0 = Date.now();
  const r = await run(owner, A, sess, 'What colour is that tree?');
  assert.equal(asks.length, 1);
  assert.ok(Date.now() - t0 < 1800, 'not waiting for the time-out');
  const last = r.calls[0].messages.at(-1);
  assert.match(textOf(last.content), /You could not get a look just now: .* page doesn't show where you are right now/);
  assert.doesNotMatch(JSON.stringify(last.content), /image_url/);
  pageAnswer = 'picture';
});

test('another platform\'s agent gets the picture with the message, inline; someone it is only shared with gets no eyes', async () => {
  await standBy(B);
  pageAnswer = 'picture'; asks.length = 0;
  const before = tmpEyes().length;
  const sess = await chatWith(owner, B);
  const r = await run(owner, B, sess, 'files?');
  assert.equal(asks.length, 1, 'the page was asked');
  assert.match(r.end.text, /what-you-see\.jpg \(image\/jpeg, 904 bytes, with the message\)/, 'the mock got it: ' + r.end.text);
  assert.equal(tmpEyes().length, before, 'nothing written to disk');
  // (Ann may use it, not manage it: her character beside it, her page open — her messages get no eyes all the same)
  const me = await info(B.i);
  annWs.send(JSON.stringify({ t: 'pwarp', x: me.pos.x - 1.5, z: me.pos.z, ctx: me.pos.ctx }));
  await wait(500);
  asks.length = 0; annAsks.length = 0;
  const as = await chatWith(ann, B);
  const r2 = await run(ann, B, as, 'files?');
  assert.equal(asks.length + annAsks.length, 0, 'no eyes for her');
  assert.match(r2.end.text, /no files/);
});

test('its see tool: beside its owner, its picture in the results turn; far from them, told why — no page asked', async () => {
  await standBy(A);
  pageAnswer = 'picture'; asks.length = 0;
  const sess = await chatWith(owner, A);
  const r = await run(owner, A, sess, 'Can you take a look?');
  assert.match(r.calls[0].messages[0].content, /\{"tool":"see"\}/, 'offered');
  const after = r.calls.find(c => /^RESULTS:/.test(textOf(c.messages.at(-1).content)));
  assert.ok(after, 'the results came back');
  const msgs = after.messages, res = msgs.at(-1);
  assert.equal(msgs.at(-2).role, 'assistant'); assert.equal(res.role, 'user');
  assert.ok(msgs.every((m, k) => k === 0 || m.role !== msgs[k - 1].role), 'no two turns of one role in a row');
  assert.ok(res.content.some(p => p.type === 'image_url'), 'the picture is in the results turn');
  assert.match(textOf(res.content), /- see: the picture is attached: what is in front of you now, from where you stand/);
  assert.ok(r.events.some(e => e.type === 'tool.start' && e.name === 'see'), 'the tool is shown as used');
  assert.equal(r.end.text, 'Now I see it.');
  // far: the same instructions (a provider's prompt cache), but no page is asked and it is told why
  await standBy(A, true);
  asks.length = 0;
  const r2 = await run(owner, A, await chatWith(owner, A), 'Can you take a look?');
  assert.match(r2.calls[0].messages[0].content, /\{"tool":"see"\}/, 'still on offer: the instructions do not change');
  assert.equal(asks.length, 0, 'no page asked');
  const res2 = r2.calls.find(c => /^RESULTS:/.test(textOf(c.messages.at(-1).content))).messages.at(-1);
  assert.doesNotMatch(JSON.stringify(res2.content), /image_url/);
  assert.match(textOf(res2.content), /- see: You could not get a look just now: you are not near enough to .* character/);
});

test('who it is told it is with: its owner beside it, yes; someone it is only shared with — beside it too — or its phone, nothing of the city', async () => {
  const me = await info(B.i);
  ws.send(JSON.stringify({ t: 'pwarp', x: me.pos.x + 1.5, z: me.pos.z, ctx: me.pos.ctx }));
  annWs.send(JSON.stringify({ t: 'pwarp', x: me.pos.x - 1.5, z: me.pos.z, ctx: me.pos.ctx }));
  await wait(600);
  const mine = await run(owner, B, await chatWith(owner, B), 'note?');
  assert.match(mine.end.text, /You and Owner are together right now/, 'its owner: ' + mine.end.text.slice(0, 200));
  const hers = await run(ann, B, await chatWith(ann, B), 'note?');
  assert.equal(hers.end.text, 'Mock note: none', 'Ann, only shared with to chat: nothing of its surroundings, nobody "together"');
  const phone = await owner.post('/api/providers/runs', { agent: B.id, session: await chatWith(owner, B), input: 'note?', aware: false });
  assert.equal(phone.status, 200);
  const end = await waitFor(async () => { const e = (await owner.get(`/api/providers/runs/events?run=${phone.json.runId}`)).json; return e.done ? e.events.map(x => x.event).find(x => x.type === 'run.end') : null; });
  assert.equal(end.text, 'Mock note: none', 'its phone: none');
  // (a built-in brain: Ann's chat with it is a visitor's — nothing of the city, never "together")
  assert.equal((await owner.post('/api/agents/share', { id: A.id, kind: 'account', who: String((await ann.get('/api/auth/me')).json.account.id), level: 'use' })).status, 200);
  const a = await info(A.i);
  annWs.send(JSON.stringify({ t: 'pwarp', x: a.pos.x - 1.5, z: a.pos.z, ctx: a.pos.ctx }));
  await wait(500);
  const v = await run(ann, A, await chatWith(ann, A), 'Where are we?');
  const all = JSON.stringify(v.calls.map(c => c.messages));
  assert.doesNotMatch(all, /together right now|Around you:|You and Ann/);
});

test('a brain that reads text only turns its picture down: the round again without it, and it is told — the answer still comes', async () => {
  await standBy(A);
  pageAnswer = 'picture'; asks.length = 0;
  const sess = await chatWith(owner, A);
  const r = await run(owner, A, sess, 'textonly: take a look?');
  assert.equal(r.end.status, 'ok', JSON.stringify(r.end));
  assert.equal(r.end.text, 'Now I see it.');
  // (its eyes' picture with the message — Free Will found it about the world — was turned down: sent again without it, told)
  const again = r.calls.find(c => !JSON.stringify(c.messages).includes('image_url'));
  assert.ok(again, 'sent again without the picture');
  assert.match(JSON.stringify(again.messages), /could not be shown to you: your brain reads text only/);
  // (and the picture it then asked for with its see tool is not taken: told why)
  const last = r.calls.at(-1).messages.at(-1);
  assert.doesNotMatch(JSON.stringify(last.content), /image_url/);
  assert.match(textOf(last.content), /- see: your brain reads text only/);
  // (and for a while no picture goes to that model at all — no refused call each time —, it is told why)
  const r2 = await run(owner, A, sess, 'textonly again: take a look?');
  assert.equal(r2.end.status, 'ok');
  assert.ok(r2.calls.every(c => !JSON.stringify(c.messages).includes('image_url')), 'no picture sent to it');
  assert.match(JSON.stringify(r2.calls[0].messages.at(-1).content), /your brain reads text only/);
});
