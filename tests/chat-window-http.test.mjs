// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat window's server side on a real server (docs/features/CHAT.md): its owner's chat streams as it is written
// (pieces over the socket, the whole kept with what it took) and names a new chat; Stop ends the answer at once and
// keeps what was written; an answer written again and a message edited; a chat's own model and effort (only the models
// the installation offers on its brain, metered at their price); attachments — documents as text, images as images,
// private to their account; search and the list of chats; a visitor still gets the short text-only resident.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { DOCX } from './helpers/zip.mjs';

const SECRET = 'sk-CHATWINDOW-77';
let s, owner, ann, fake, brain, A, ownerId;
const seen = [];
let closed = 0;
let credit = true;   // false: the brain's account has no credit (402), as OpenRouter answers
const sockets = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(30); } };

/** The fake brain: an owner's chat answers "Echo: <message>" (a new chat also gets a title), streamed in small pieces;
 *  "slow" streams for seconds; "think" shows reasoning; a visitor's chat (the resident's JSON) answers in JSON. */
function content(j) {
  const sys = j.messages.find(m => m.role === 'system')?.content || '';
  const users = j.messages.filter(m => m.role === 'user'), last = users.at(-1).content;
  const text = typeof last === 'string' ? last : last.filter(p => p.type === 'text').map(p => p.text).join('\n');
  if (!/In this chat you talk with|This chat is WORK/.test(sys)) return JSON.stringify({ reply: 'Hi stranger.' });   // (its owner's chat: Work by default, or Life)
  const msg = text.split('\n').at(-1);
  return `Echo: ${msg}${/This is a new chat/.test(sys) ? '\n[[mvw-actions]]\n{"title":"Echo chat"}' : ''}`;
}
before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      const j = b ? JSON.parse(b) : null;
      seen.push({ url: req.url, body: j });
      if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fake-small' }] })); return; }
      if (!credit) { res.writeHead(402, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Insufficient credits', code: 402 } })); return; }
      const c = content(j), slow = /slow/.test(JSON.stringify(j.messages.at(-1))), think = /think/.test(JSON.stringify(j.messages.at(-1)));
      if (!j.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ model: j.model, choices: [{ finish_reason: 'stop', message: { content: c } }], usage: { prompt_tokens: 100, completion_tokens: 20 } })); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.on('close', () => { if (!res.writableEnded) closed++; });
      const pieces = slow ? Array.from({ length: 400 }, (_, i) => `word${i} `) : c.match(/.{1,5}/gs);
      // "breaks": the connection drops after a few pieces (no end, no [DONE])
      if (/breaks/.test(JSON.stringify(j.messages.at(-1)))) { for (const p of pieces.slice(0, 4)) res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: p } }] })}\n\n`); setTimeout(() => res.destroy(), 50); return; }
      if (think) res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'Thinking it over.' } }] })}\n\n`);
      let i = 0;
      const next = () => {
        if (res.destroyed) return;
        if (i >= pieces.length) { res.end(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\ndata: [DONE]\n\n`); return; }
        res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: pieces[i++] } }] })}\n\n`);
        if (slow) setTimeout(next, 15); else next();
      };
      next();
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 260, agents: 3, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  ownerId = (await owner.get('/api/auth/me')).json.account.id;
  const agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
  const c = await owner.post('/api/connections', { kind: 'models', label: 'Brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake-small', priceInPerMTok: 1, priceOutPerMTok: 2 }, secrets: { apiKey: SECRET } });
  assert.equal(c.status, 200, c.text);
  brain = c.json.id;
  A = agents[0].id;
  assert.equal((await owner.post('/api/agents/update', { id: A, connectionId: brain, nativeId: 'mind' })).status, 200);
  assert.equal((await owner.post('/api/settings', { values: { 'mind.chatModels': 'fake-large=3/15, bad=entry, fake-medium' } })).status, 200);
});
after(async () => { for (const w of sockets) try { w.close(); } catch { /* closed */ } await s?.stop(); fake?.close(); });

function openWs(client) {
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: client.cookie } });
  const msgs = [];
  ws.onmessage = e => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('WebSocket error')); });
  sockets.push(ws);
  return { msgs, opened, of: run => msgs.filter(m => m.t === 'chat' && m.run === run) };
}
const newChat = async (c = owner, label) => (await c.post('/api/chat-sessions/create', { agent: A, ...(label ? { label } : {}) })).json.session;
const send = async (c, session, input, extra = {}) => { const r = await c.post('/api/providers/runs', { agent: A, session, input, ...extra }); assert.equal(r.status, 200, r.text); return r.json.runId; };
const ended = async (c, runId) => waitFor(async () => { const r = (await c.get(`/api/providers/runs/events?run=${runId}`)).json; return r && r.done ? r.events.map(e => e.event).find(e => e.type === 'run.end') : null; });
const history = async (session, c = owner) => (await c.get(`/api/providers/history?agent=${A}&session=${session}`)).json.messages;
const up = async (c, name, buf) => { const r = await c.request('POST', `/api/chat/attachments?name=${encodeURIComponent(name)}`, buf, { 'content-type': 'application/octet-stream' }); assert.equal(r.status, 200, r.text); return r.json.attachment; };

test('its owner\'s answer streams as it is written; the whole is kept with what it took; a new chat names itself', async () => {
  const w = openWs(owner); await w.opened;
  const sess = await newChat();
  assert.equal(sess.label, 'New session');
  const run = await send(owner, sess.id, 'hello there');
  const end = await ended(owner, run);
  assert.equal(end.status, 'ok'); assert.equal(end.text, 'Echo: hello there', 'the marker and what follows it never in the answer');
  assert.deepEqual([end.model, end.tokensIn, end.tokensOut, end.cost], ['fake-small', 100, 20, 140], 'what it took (the connection\'s price list: 100×1 + 20×2)');
  await waitFor(() => w.of(run).some(m => m.event?.type === 'run.end'));
  const pieces = w.of(run).filter(m => m.delta).map(m => m.delta.text).join('');
  assert.ok(pieces.startsWith('Echo: hello there') && !pieces.includes('mvw-actions'), `streamed: ${JSON.stringify(pieces)}`);
  // each piece says where it starts in the answer (a page that also read the whole so far never adds one twice)
  let at = 0;
  for (const m of w.of(run).filter(x => x.delta?.text)) { assert.equal(m.delta.at, at, 'a piece starts where the last ended'); at += m.delta.text.length; }
  const h = await history(sess.id);
  assert.deepEqual(h.map(m => `${m.role}:${m.text}`), ['user:hello there', 'assistant:Echo: hello there']);
  assert.ok(Number.isInteger(h[0].id)); assert.equal(h[1].meta.model, 'fake-small'); assert.equal(h[1].meta.cost, 140);
  assert.equal((await owner.get(`/api/chat-sessions?agent=${A}`)).json.sessions.find(x => x.id === sess.id).label, 'Echo chat', 'named by the agent');
  const named = await newChat(owner, 'Mine');
  await ended(owner, await send(owner, named.id, 'hi'));
  assert.equal((await owner.get(`/api/chat-sessions?agent=${A}`)).json.sessions.find(x => x.id === named.id).label, 'Mine', 'a name its owner gave stays');
  // reasoning the model shows: streamed apart, kept with the answer
  const t = await send(owner, sess.id, 'think about it');
  const te = await ended(owner, t);
  assert.equal(te.thinking, 'Thinking it over.');
  await waitFor(() => w.of(t).some(m => m.event?.type === 'run.end'));
  assert.ok(w.of(t).some(m => m.delta?.thinking === 'Thinking it over.'));
});

test('Stop ends the answer at once: the provider is let go and what was written is kept', async () => {
  const w = openWs(owner); await w.opened;
  const sess = await newChat(owner, 'Stop');
  const run = await send(owner, sess.id, 'slow please');
  assert.ok(await waitFor(() => w.of(run).filter(m => m.delta).length >= 5), 'it is writing');
  const before = closed, t0 = Date.now();
  assert.equal((await owner.post('/api/providers/interrupt', { run })).status, 200);
  const end = await ended(owner, run);
  assert.equal(end.status, 'stopped'); assert.ok(Date.now() - t0 < 2000, 'at once');
  assert.match(end.text, /^word0 word1 /); assert.ok(!end.text.includes('word399'));
  assert.ok(await waitFor(() => closed > before, 3000), 'the provider connection was closed (it stops writing, and billing)');
  const h = await history(sess.id);
  assert.equal(h.at(-1).role, 'assistant'); assert.equal(h.at(-1).status, 'stopped'); assert.equal(h.at(-1).text, end.text);
});

test('a stream that breaks part-way: what was written is kept and said to be cut short — never shown as a whole answer', async () => {
  const sess = await newChat(owner, 'Broken');
  const run = await send(owner, sess.id, 'this breaks');
  const r = await waitFor(async () => { const e = (await owner.get(`/api/providers/runs/events?run=${run}`)).json; return e.done ? e : null; });
  const end = r.events.map(x => x.event).find(e => e.type === 'run.end');
  assert.equal(end.status, 'interrupted', JSON.stringify(end));
  assert.equal(end.text, 'Echo: this breaks', 'the start of the marker it broke in is not kept'); assert.match(end.error, /broke before it finished/);
  const h = (await owner.get(`/api/providers/history?agent=${A}&session=${sess.id}`)).json.messages;
  const [ans, note] = h.slice(-2);
  assert.deepEqual([ans.role, ans.text, ans.status], ['assistant', 'Echo: this breaks', 'interrupted']);
  assert.deepEqual([note.role, note.status], ['system', 'interrupted']);
  assert.match(note.text, /^The answer was interrupted: the connection to its brain broke before it finished\. Send it again/);
  assert.ok(!h.some(m => /nothing to add/.test(m.text)));
  // written again, it answers whole
  const again = await send(owner, sess.id, '', { regenerate: true });
  const r2 = await waitFor(async () => { const e = (await owner.get(`/api/providers/runs/events?run=${again}`)).json; return e.done ? e : null; });
  assert.equal(r2.events.map(x => x.event).find(e => e.type === 'run.end').status, 'interrupted', '(the same message breaks the same way)');
});

test('an answer written again; a message edited: everything after it goes', async () => {
  const sess = await newChat(owner, 'Edit');
  await ended(owner, await send(owner, sess.id, 'first'));
  await ended(owner, await send(owner, sess.id, 'second'));
  const n = seen.length;
  const r = await ended(owner, await send(owner, sess.id, '', { regenerate: true }));
  assert.equal(r.text, 'Echo: second'); assert.equal(seen.length, n + 1);
  let h = await history(sess.id);
  assert.deepEqual(h.map(m => m.text), ['first', 'Echo: first', 'second', 'Echo: second'], 'the old answer replaced, the question not repeated');
  await ended(owner, await send(owner, sess.id, 'first, edited', { editFrom: h[0].id }));
  h = await history(sess.id);
  assert.deepEqual(h.map(m => m.text), ['first, edited', 'Echo: first, edited']);
  assert.equal((await owner.post('/api/providers/runs', { agent: A, session: sess.id, input: 'x', editFrom: h[1].id })).json.code, 'not_found', 'only the person\'s own messages are edited');
  const other = await newChat(owner, 'Other');
  assert.equal((await owner.post('/api/providers/runs', { agent: A, session: other.id, input: 'x', editFrom: h[0].id })).json.code, 'not_found', 'nor one of another chat');
});

test('a chat\'s own model and effort: only what the installation offers on its brain, metered at its price', async () => {
  const m = (await owner.get(`/api/providers/models?agent=${A}`)).json;
  assert.deepEqual(m.models.map(x => x.id), ['fake-small', 'fake-large', 'fake-medium'], 'the default first, a malformed entry left out');
  assert.deepEqual([m.default, m.offered, m.models[1].priceIn, m.models[1].priceOut], ['fake-small', true, 3, 15]);
  const sess = await newChat(owner, 'Models');
  const p = await owner.post('/api/chat-sessions/prefs', { agent: A, session: sess.id, model: 'fake-large', effort: 'high' });
  assert.equal(p.status, 200, p.text); assert.deepEqual([p.json.session.model, p.json.session.effort], ['fake-large', 'high']);
  assert.equal((await owner.post('/api/chat-sessions/prefs', { agent: A, session: sess.id, effort: 'max' })).json.code, 'bad_effort');
  const end = await ended(owner, await send(owner, sess.id, 'hi'));
  assert.equal(seen.at(-1).body.model, 'fake-large', 'the chat\'s own model');
  assert.deepEqual([end.model, end.effort, end.cost], ['fake-large', 'high', 100 * 3 + 20 * 15]);
  const no = await ended(owner, await send(owner, sess.id, 'hi', { model: 'gpt-anything' }));
  assert.equal(no.status, 'error'); assert.match(no.error, /not offered/);
  assert.equal((await ann.post('/api/chat-sessions/prefs', { agent: A, session: sess.id, model: 'x' })).status, 404, 'someone else\'s chat does not exist for them');
});

test('attachments: a document read as text, an image as an image; private to their account; an old format said plainly', async () => {
  const sess = await newChat(owner, 'Files');
  const doc = await up(owner, 'report.docx', DOCX), png = await up(owner, 'photo.png', Buffer.from('89504e47fake', 'hex'));
  const end = await ended(owner, await send(owner, sess.id, 'Summarise these', { attachments: [doc.id, png.id] }));
  assert.equal(end.status, 'ok', JSON.stringify(end));
  const u = seen.at(-1).body.messages.at(-1).content;
  assert.ok(Array.isArray(u)); assert.equal(u[0].type, 'image_url'); assert.match(u[0].image_url.url, /^data:image\/png;base64,/);
  assert.match(u.at(-1).text, /ATTACHED FILE «report\.docx»:\n```\nQuarterly report\nRevenue\t12 & up/); assert.match(u.at(-1).text, /Summarise these$/);
  const h = await history(sess.id);
  assert.deepEqual(h[0].meta.attachments.map(f => f.name), ['report.docx', 'photo.png']);
  const f = await owner.get(`/api/chat/attachments/file?id=${png.id}`);
  assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'image/png'); assert.match(f.headers.get('content-disposition'), /^inline/);
  assert.equal(f.headers.get('x-content-type-options'), 'nosniff', 'never sniffed as something else');
  assert.equal((await ann.get(`/api/chat/attachments/file?id=${png.id}`)).status, 404, 'not someone else\'s');
  // the next message: the document's text again, the image not resent as an image only after newer ones
  await ended(owner, await send(owner, sess.id, 'And the totals?'));
  assert.match(JSON.stringify(seen.at(-1).body.messages), /Quarterly report/);
  // a video: kept like any file, but a brain that reads text and pictures can't take it — said before sending
  const vid = await up(owner, 'clip.mp4', Buffer.from('000000206674797069736f6d', 'hex'));
  const r = await owner.post('/api/providers/runs', { agent: A, session: sess.id, input: 'Watch this', attachments: [vid.id] });
  assert.equal(r.status, 415, r.text); assert.match(r.json.error, /can't take videos or recordings — clip\.mp4/);
  const old = await up(owner, 'old.doc', Buffer.from('legacy'));
  const bad = await ended(owner, await send(owner, sess.id, '', { attachments: [old.id] }));
  assert.equal(bad.status, 'error'); assert.match(bad.error, /Save it as \.docx/);
  // the Library's Delete: only the account's own; its chat goes on without it
  assert.equal((await ann.post('/api/chat/attachments/delete', { id: doc.id })).status, 404, 'not someone else\'s');
  const used = (await owner.get('/api/chat/attachments')).json.used;
  const del = await owner.post('/api/chat/attachments/delete', { id: doc.id });
  assert.equal(del.status, 200, del.text); assert.equal(del.json.used, used - DOCX.length);
  assert.ok(!(await owner.get('/api/chat/attachments')).json.attachments.some(x => x.id === doc.id));
  assert.equal((await owner.get(`/api/chat/attachments/file?id=${doc.id}`)).status, 404);
  assert.equal((await owner.post('/api/chat/attachments/delete', { id: doc.id })).status, 404, 'gone');
  const after = await ended(owner, await send(owner, sess.id, 'Still there?'));
  assert.equal(after.status, 'ok', JSON.stringify(after));
  assert.doesNotMatch(JSON.stringify(seen.at(-1).body.messages), /Quarterly report/, 'the earlier message without it');
});

test('search finds an account\'s own messages; the list holds its chats; a visitor gets the short resident, text only', async () => {
  const r = (await owner.get('/api/chat/search?q=Echo%20hell')).json.results;
  assert.ok(r.length >= 1 && r.every(x => x.agent === A)); assert.ok(r.some(x => x.label === 'Echo chat'));
  assert.match(r.find(x => x.label === 'Echo chat').snippet, /\u0002hell/);
  assert.deepEqual((await ann.get('/api/chat/search?q=Echo')).json.results, [], 'nothing of another account');
  const list = (await owner.get('/api/chat/recent')).json.sessions;
  assert.ok(list.length >= 5 && list.every(x => x.agentId === A));
  const pin = list.at(-1);
  await owner.post('/api/chat-sessions/prefs', { agent: A, session: pin.id, pinned: true });
  assert.equal((await owner.get('/api/chat/recent')).json.sessions[0].id, pin.id, 'pinned first');
  assert.equal((await owner.post('/api/agents/share', { id: A, kind: 'account', who: (await ann.get('/api/auth/me')).json.account.id, level: 'use' })).status, 200);
  const sa = await newChat(ann, 'Hi');
  const end = await ended(ann, await send(ann, sa.id, 'hello'));
  assert.equal(end.text, 'Hi stranger.');
  assert.equal(seen.at(-1).body.stream, undefined, 'the resident\'s short answer is not the chat window\'s');
  const img = await up(ann, 'x.png', Buffer.from('png'));
  const no = await ann.post('/api/providers/runs', { agent: A, session: sa.id, input: 'look', attachments: [img.id] });
  assert.equal(no.json.code, 'unsupported');
  assert.equal(s.log().includes(SECRET), false, 'the key never in the log');
  assert.ok(ownerId);
});

test('whether someone can chat, said before anything is typed: why not in one line, with the fix for its owner', async () => {
  const agents = (await owner.get('/api/agents')).json.agents, other = agents.find(a => a.id !== A);
  const can = (c, id) => c.get(`/api/chat/can?agent=${id}`).then(r => r.json);
  const mine = await can(owner, A);
  assert.equal(mine.ok, true); assert.equal(mine.kind, 'models'); assert.equal(mine.manage, true);
  assert.deepEqual([mine.caps.chat, mine.caps.attachments, mine.caps.effort, mine.caps.models, mine.caps.stop], [true, true, true, true, true]);
  assert.deepEqual(mine.modes, { default: 'work' }, 'its owner\'s chats have Work and Life (CHAT.md §13)');
  const none = await can(owner, other.id);
  assert.deepEqual([none.ok, none.reason, none.fix], [false, 'no_brain', 'brain']); assert.match(none.message, new RegExp(`^${other.name} has no chat brain yet`));
  const theirs = await can(ann, other.id);
  assert.deepEqual([theirs.ok, theirs.reason, theirs.fix], [false, 'not_shared', undefined]); assert.equal(theirs.message, `${other.name}'s owner hasn't shared chat with you.`);
  const shared = await can(ann, A);   // (shared with Ann to use, in the test before)
  assert.deepEqual([shared.ok, shared.manage, shared.modes], [true, false, undefined]);
  assert.equal((await can(owner, 999999)).reason, 'gone');
});

test('an account out of credit and then topped up: the very next message is answered — no waiting for a pause to end', async () => {
  const sess = await newChat(owner, 'Credit');
  credit = false;
  const dry = await ended(owner, await send(owner, sess.id, 'hello?'));
  assert.equal(dry.status, 'error'); assert.match(dry.error, /no credit/i);
  const can = (await owner.get(`/api/chat/can?agent=${A}`)).json;
  assert.equal(can.ok, true, 'the window still lets its owner try (it may have been topped up a second later)');
  const again = await ended(owner, await send(owner, sess.id, 'still nothing?'));
  assert.equal(again.status, 'error', 'still dry: told again, plainly');
  assert.ok((await owner.get('/api/mind/overview')).json.paused.some(p => p.code === 'quota'), 'the background thinking waits (a minute, then up to five)');
  credit = true;   // topped up
  const t0 = Date.now(), ok = await ended(owner, await send(owner, sess.id, 'and now?'));
  assert.equal(ok.status, 'ok'); assert.equal(ok.text, 'Echo: and now?'); assert.ok(Date.now() - t0 < 5000, 'at once');
  assert.deepEqual((await owner.get('/api/mind/overview')).json.paused, [], 'and the pause is over for everyone');
});

test('projects: an account\'s folders of chats with one agent; their instructions go with every message; the Sidebar lists one agent\'s chats', async () => {
  const p = await owner.post('/api/chat/projects/create', { agent: A, name: 'Bakery plan', instructions: 'Answer in Spanish. We are opening a bakery on Pine Street.' });
  assert.equal(p.status, 200, p.text);
  const project = p.json.project;
  assert.equal((await owner.post('/api/chat/projects/create', { agent: A, name: '   ' })).json.code, 'bad_name');
  const sess = await newChat(owner, 'Ovens');
  const mv = await owner.post('/api/chat-sessions/move', { agent: A, session: sess.id, project: project.id });
  assert.equal(mv.json.session.projectId, project.id);
  await ended(owner, await send(owner, sess.id, 'Which oven?'));
  const sys = seen.at(-1).body.messages[0].content;
  assert.match(sys, /THIS CHAT IS PART OF YOUR OWNER'S PROJECT «Bakery plan»/); assert.match(sys, /Answer in Spanish\. We are opening a bakery on Pine Street\./);
  const other = await newChat(owner, 'Not in it');
  await ended(owner, await send(owner, other.id, 'hi'));
  assert.doesNotMatch(seen.at(-1).body.messages[0].content, /Bakery plan/, 'only its own chats');
  // the Sidebar: this agent's chats and projects only
  const r = (await owner.get(`/api/chat/recent?agent=${A}`)).json;
  assert.ok(r.sessions.length >= 2 && r.sessions.every(x => x.agentId === A));
  assert.deepEqual(r.projects.map(x => x.name), ['Bakery plan']);
  assert.equal(r.sessions.find(x => x.id === sess.id).projectId, project.id);
  assert.equal(r.projects[0].chats, 1, 'how many chats it holds');
  // one project's own chats (all of them, however old)
  const inP = (await owner.get(`/api/chat/recent?agent=${A}&project=${project.id}`)).json;
  assert.deepEqual(inP.sessions.map(x => x.id), [sess.id]); assert.equal(inP.project.name, 'Bakery plan');
  assert.equal((await ann.get(`/api/chat/recent?agent=${A}&project=${project.id}`)).status, 404, 'not someone else\'s');
  // search in this agent's chats
  assert.ok((await owner.get(`/api/chat/search?q=oven&agent=${A}`)).json.results.some(x => x.session === sess.id));
  // someone else: not found
  assert.equal((await ann.post('/api/chat/projects/update', { agent: A, project: project.id, name: 'Mine' })).status, 404);
  assert.equal((await owner.post('/api/chat/projects/update', { agent: A, project: project.id, instructions: 'Answer in French.' })).json.project.instructions, 'Answer in French.');
  // removed: its chats stay, outside it
  assert.equal((await owner.post('/api/chat/projects/delete', { agent: A, project: project.id })).status, 200);
  assert.equal((await owner.get(`/api/chat/recent?agent=${A}`)).json.sessions.find(x => x.id === sess.id).projectId, null);
});
