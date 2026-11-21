// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// One conversation with an agent (server/chat/sessions.js current, server/companions/outings.js, server/chat/marks.js), with
// a built-in brain (a fake model server): an outing with its owner is a divider in the owner's current chat when it begins
// ("Out with …") and when it ends ("Back to its own day") — once, however often an order is given again during it, a wait
// between two walks part of it — never in what its brain is told; an agent with no chat yet gets one for it; the chat it
// is talked with now is the one last written in; a line said to a group keeps who it was said to, for the person only.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession } from './helpers/server.mjs';

let s, owner, agents, fake, ws;
const seen = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(100); } };

before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      const j = b ? JSON.parse(b) : null;
      seen.push(j);
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake-small' }] })); return; }
      const content = 'Sure thing!';
      if (j.stream) {
        res.setHeader('content-type', 'text/event-stream');
        res.write(`data: ${JSON.stringify({ model: 'fake-small', choices: [{ delta: { content } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`);
        res.end(); return;
      }
      res.end(JSON.stringify({ model: 'fake-small', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 200, agents: 3, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  agents = (await owner.get('/api/agents')).json.agents;
  const c = await owner.post('/api/connections', { kind: 'models', label: 'Test brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake-small' }, secrets: { apiKey: 'sk-test' } });
  assert.equal(c.status, 200, c.text);
  for (const a of agents) {
    assert.equal((await owner.post('/api/agents/update', { id: a.id, connectionId: c.json.id, nativeId: 'mind' })).status, 200);
    assert.equal((await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' })).status, 200);
    assert.equal((await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'life' })).status, 200);
  }
  // the owner's player (its page's live connection)
  ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: owner.cookie } });
  ws.lines = [];
  ws.onmessage = e => { try { const m = JSON.parse(e.data); if (m.t === 'chat_line') ws.lines.push(m); } catch { /* not ours */ } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  await wait(500);
});
after(async () => { try { ws?.close(); } catch { /* closed */ } await s?.stop(); fake?.close(); });

async function chat(a, session, input, extra = {}) {
  const run = await owner.post('/api/providers/runs', { agent: a.id, session, input, ...extra });
  assert.equal(run.status, 200, run.text);
  for (let k = 0; k < 80; k++) {
    await wait(150);
    const ev = (await owner.get(`/api/providers/runs/events?run=${run.json.runId}`)).json;
    if (ev.done) return run.json;
  }
  throw new Error('no answer');
}
const history = async (a, sid) => (await owner.get(`/api/providers/history?agent=${a.id}&session=${sid}`)).json.messages || [];
const outings = async (a, sid) => (await history(a, sid)).filter(m => m.role === 'system' && m.status === 'outing');
const order = async (a, body) => { const r = await owner.post('/api/companions', { agent: a.id, ...body }); assert.equal(r.status, 200, r.text); return r.json; };
const current = async a => (await owner.get(`/api/chat/recent?agent=${a.id}`)).json.current;

test('an outing: a divider when it begins and when it ends, in the current chat, once — never in what its brain is told', async () => {
  const a = agents[0];
  const old = (await owner.post('/api/chat-sessions/create', { agent: a.id, label: 'Older' })).json.session;
  await chat(a, old.id, 'Good morning');
  await wait(20);
  const sess = (await owner.post('/api/chat-sessions/create', { agent: a.id, label: 'Today' })).json.session;
  await chat(a, sess.id, 'What a day');
  // (pinning the older one does not make it the one it is talked with: the one last written in is)
  assert.equal((await owner.post('/api/chat-sessions/prefs', { agent: a.id, session: old.id, pinned: true })).status, 200);
  assert.equal(await current(a), sess.id, 'the current chat: the one last written in');

  await order(a, { action: 'follow', target: 'me' });
  const start = await waitFor(async () => { const l = await outings(a, sess.id); return l.length ? l : null; });
  assert.ok(start, 'a divider when it begins');
  assert.equal(start.length, 1);
  assert.equal(start[0].meta?.outing, 'start');
  assert.match(start[0].text, /^Out with \S/);
  assert.ok(Number.isFinite(start[0].ts), 'with its time (the page shows it in its own clock)');
  assert.equal((await outings(a, old.id)).length, 0, 'not in another chat');
  assert.ok(await waitFor(() => ws.lines.find(m => m.agent === a.id && m.session === sess.id && m.message?.meta?.outing === 'start')), 'the page is told at once');

  // the same order again, a wait between two walks, the order again by its chat: one outing
  await order(a, { action: 'follow', target: 'me' });
  await order(a, { action: 'stay', place: 'here' });
  await wait(1200);
  await chat(a, sess.id, 'Follow me!');
  await wait(1200);
  assert.deepEqual((await outings(a, sess.id)).map(m => m.meta?.outing), ['start'], 'no second divider, no end while it waits for them');

  // its brain is never told about the dividers
  const n = seen.length;
  await chat(a, sess.id, 'Where are we now?');
  const call = seen.slice(n).find(j => j?.stream);
  assert.ok(call, 'the brain was asked');
  const all = JSON.stringify(call.messages);
  assert.doesNotMatch(all, /Out with |Back to its own day/, 'no divider in what the brain is told');
  assert.match(all, /What a day/, 'its history is there');

  // let go: the end, once
  const r = await owner.post('/api/companions/dismiss-all', {});
  assert.equal(r.status, 200, r.text);
  const end = await waitFor(async () => { const l = await outings(a, sess.id); return l.length === 2 ? l : null; });
  assert.ok(end, 'a divider when it ends: ' + JSON.stringify(await outings(a, sess.id)));
  assert.deepEqual(end.map(m => m.meta?.outing), ['start', 'end']);
  assert.equal(end[1].text, 'Back to its own day');
  // (in their place: the end after what was said during the outing)
  const h = await history(a, sess.id), k0 = h.findIndex(m => m.status === 'outing'), k1 = h.findLastIndex(m => m.status === 'outing');
  assert.ok(h.slice(k0, k1).some(m => m.role === 'user' && m.text === 'Where are we now?'), 'what was said on the walk lies between them');
  await wait(1200);
  assert.equal((await outings(a, sess.id)).length, 2, 'nothing more');
  // (a later outing: its own pair)
  await order(a, { action: 'follow', target: 'me' });
  assert.ok(await waitFor(async () => (await outings(a, sess.id)).length === 3), 'another outing, another divider');
  await order(a, { action: 'dismiss' });
  assert.ok(await waitFor(async () => (await outings(a, sess.id)).length === 4));
  const n2 = seen.length;
  await chat(a, sess.id, 'Home again');
  assert.doesNotMatch(JSON.stringify(seen.slice(n2).find(j => j?.stream)?.messages || []), /Out with |Back to its own day/);
});

test('an agent with no chat yet: one is made for its outing, and is its current chat', async () => {
  const a = agents[1];
  assert.equal((await owner.get(`/api/chat/recent?agent=${a.id}`)).json.sessions.length, 0);
  assert.equal(await current(a), null, 'no chat yet: none (nothing is made by asking)');
  await order(a, { action: 'follow', target: 'me' });
  const sid = await waitFor(() => current(a));
  assert.ok(sid, 'a chat for it');
  assert.ok(await waitFor(async () => (await outings(a, sid)).length === 1), 'with the divider');
  await order(a, { action: 'dismiss' });
  assert.ok(await waitFor(async () => (await outings(a, sid)).map(m => m.meta?.outing).join() === 'start,end'));
  assert.equal((await owner.get(`/api/chat/recent?agent=${a.id}`)).json.sessions.length, 1, 'one chat, not one per outing');
});

test('a line said to several of a group keeps who it was said to — for the person, not the brain', async () => {
  const [a, b] = agents;
  const sa = await current(a);
  const sb = (await owner.post('/api/chat-sessions/create', { agent: b.id })).json.session.id;
  const n = seen.length;
  const r = await chat(a, sa, 'What do you two think of the park?', { group: [a.id, b.id], groupSay: true });
  assert.deepEqual(r.message?.meta?.to, [a.name, b.name].map(x => x.slice(0, 40)), 'the line as sent');
  await chat(b, sb, 'What do you two think of the park?', { group: [a.id, b.id] });
  const mine = (await history(a, sa)).filter(m => m.role === 'user').at(-1);
  assert.deepEqual(mine.meta?.to, [a.name, b.name], 'kept with it');
  assert.ok((await history(b, sb)).filter(m => m.role === 'user').at(-1).meta?.to, 'in each one\'s chat');
  const calls = seen.slice(n).filter(j => j?.stream);   // (the two answers to that line)
  assert.ok(calls.length >= 2);
  for (const c of calls) {
    const last = c.messages.filter(m => m.role === 'user').at(-1);
    assert.match(String(last.content), /What do you two think of the park\?$/, 'the words as said');
    assert.doesNotMatch(JSON.stringify(c.messages), /"to":/, 'the mark is not the brain\'s');
  }
  // (said to one of them — in the group, the others hear it —: no mark; to both, named: both)
  const one = await chat(a, sa, 'Just you, what is that?', { group: [a.id, b.id], groupSay: true, to: [a.id] });
  assert.equal(one.message?.meta?.to, undefined, 'said to one: no mark');
  const two = await chat(a, sa, 'And you two?', { group: [a.id, b.id], groupSay: true, to: [a.id, b.id] });
  assert.deepEqual(two.message?.meta?.to, [a.name, b.name]);
});
