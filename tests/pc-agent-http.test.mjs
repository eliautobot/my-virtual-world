// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents at work on their PC, on a real server with a fake brain (docs/features/agent-pc.md §4): its owner's chat uses
// the "pc" tool (the file is made, the chat shows the step), a task given to it runs a work session to Review with a note
// and a notification, its owner turns working by itself off and back on, and the PC's command line as one's own agent
// is refused for anyone else's.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, adm, fake, A, B;
const seen = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(50); } };
const lastUser = j => { const m = j.messages.filter(x => x.role === 'user').at(-1).content; return typeof m === 'string' ? m : m.filter(p => p.type === 'text').map(p => p.text).join('\n'); };

/** The fake brain: in a chat, "save-hello" writes a file on its PC, then answers; at work, one step then done. */
function content(j) {
  const sys = j.messages.find(m => m.role === 'system')?.content || '';
  const msg = lastUser(j);
  if (/You are at your PC, working on a task by yourself/.test(sys)) {
    if (!/RESULTS:/.test(msg)) return JSON.stringify({ use: [{ tool: 'pc', run: 'whoami' }, { tool: 'pc', run: 'write ~/Documents/report.md', text: '# Report\nDone by the fake brain.' }] });
    return JSON.stringify({ done: 'Wrote the report in ~/Documents/report.md.', status: 'review' });
  }
  if (/YOUR PC - your own computer/.test(sys)) {
    if (/RESULTS:/.test(msg)) return 'Saved it to ~/Documents/hello.md.';
    if (/save-hello/.test(msg)) return JSON.stringify({ use: [{ tool: 'pc', run: 'write ~/Documents/hello.md', text: 'Hello from the PC' }] });
    return 'Hi.';
  }
  return JSON.stringify({ reply: 'Hi.' });
}
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      const j = b ? JSON.parse(b) : null;
      if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fake-small' }] })); return; }
      seen.push(j);
      const c = content(j);
      if (!j.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ model: j.model, choices: [{ finish_reason: 'stop', message: { content: c } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: c } }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`);
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 220, agents: 2, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  adm = await userSession(s, owner, { login: 'adm', displayName: 'Adm', role: 'admin' });
  const agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
  const c = await owner.post('/api/connections', { kind: 'models', label: 'Brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake-small' }, secrets: { apiKey: 'sk-PC-1' } });
  assert.equal(c.status, 200, c.text);
  [A, B] = [agents[0].id, agents[1].id];
  for (const id of [A, B]) assert.equal((await owner.post('/api/agents/update', { id, connectionId: c.json.id, nativeId: 'mind' })).status, 200);
});
after(async () => { await s?.stop(); fake?.close(); });

test('its owner\'s chat uses its PC: the file is made, the step shows in the chat', async () => {
  const session = (await owner.post('/api/chat-sessions/create', { agent: A })).json.session.id;
  const r = await owner.post('/api/providers/runs', { agent: A, session, input: 'save-hello please' });
  assert.equal(r.status, 200, r.text);
  const ev = await waitFor(async () => { const e = (await owner.get(`/api/providers/runs/events?run=${r.json.runId}`)).json; return e && e.done ? e.events.map(x => x.event) : null; });
  assert.ok(ev, 'the answer ended');
  const tool = ev.find(e => e.type === 'tool.start');
  assert.deepEqual([tool.name, tool.input], ['pc', 'write ~/Documents/hello.md']);
  assert.equal(ev.find(e => e.type === 'tool.end').ok, true);
  assert.equal(ev.find(e => e.type === 'run.end').text, 'Saved it to ~/Documents/hello.md.');
  assert.equal((await owner.get(`/api/pc/text?profile=${A}&path=${encodeURIComponent('~/Documents/hello.md')}`)).json.text, 'Hello from the PC');
  const first = seen.find(j => j.stream && /save-hello/.test(lastUser(j)));
  assert.match(first.messages[0].content, /YOUR PC - your own computer for work/);
  assert.match(first.messages[0].content, /PC COMMANDS/);
});

test('a task given to it runs a work session: Doing, the PC, Review with a note, its owner told', async () => {
  const k = await owner.post('/api/pc/cards', { profile: B, path: '~', title: 'Write the weekly report' });
  assert.equal(k.status, 200, k.text);
  const end = await waitFor(async () => { const b = (await owner.get(`/api/pc/board?profile=${B}&path=~`)).json; const x = b.cards.find(c => c.id === k.json.id); return x && x.col === 'review' ? x : null; });
  assert.ok(end, 'it reached Review');
  assert.match(end.notes, /: Wrote the report in ~\/Documents\/report\.md\./);
  assert.equal(end.work.state, 'done');
  assert.equal((await owner.get(`/api/pc/text?profile=${B}&path=${encodeURIComponent('~/Documents/report.md')}`)).json.text, '# Report\nDone by the fake brain.');
  const n = await waitFor(async () => (await owner.get('/api/notifications')).json?.notifications?.find(x => x.kind === 'pc'));
  assert.ok(n, 'its owner was told'); assert.match(n.title, /finished "Write the weekly report"/);
  const th = (await owner.get(`/api/mind/thoughts?agent=${B}`)).json;
  assert.ok((th.thoughts || th.jobs || []).some(j => j.kind === 'work' && j.status === 'ok'), `counted as its thinking: ${JSON.stringify(th).slice(0, 300)}`);
  // its owner turns working by itself off: a new task waits, until "Work on it"
  assert.deepEqual((await owner.post('/api/pc/profile', { agent: B, autoWork: false })).json.autoWork, false);
  const k2 = await owner.post('/api/pc/cards', { profile: B, path: '~', title: 'Second task' });
  await wait(600);
  assert.equal((await owner.get(`/api/pc/board?profile=${B}&path=~`)).json.cards.find(c => c.id === k2.json.id).col, 'todo');
  assert.equal((await adm.post('/api/pc/work', { card: k2.json.id })).status, 404, 'another account can\'t start it');
  assert.equal((await owner.post('/api/pc/work', { card: k2.json.id })).json.queued, true);
  assert.ok(await waitFor(async () => (await owner.get(`/api/pc/board?profile=${B}&path=~`)).json.cards.find(c => c.id === k2.json.id).col === 'review'));
});

test('the command line as one\'s own agent; never as anyone else\'s', async () => {
  const r = await owner.post('/api/pc/shell', { agent: A, run: 'cd Documents\nls' });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.text, /hello\.md/);
  assert.equal((await owner.post('/api/pc/shell', { agent: A, run: 'pwd' })).json.text, '~/Documents', 'the same shell carries on');
  assert.equal((await adm.post('/api/pc/shell', { agent: A, run: 'ls' })).status, 404);
  assert.equal((await adm.get(`/api/pc/profile?agent=${A}`)).status, 404);
});
