// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat contract on a real server with the mock provider (PLAN WP2.2, I11.4, I11.9, I8.7, X11; DECISIONS C53, C119, C120, C121, A8, A9):
// sessions private per account and agent, events only to the account that started a run, uncertain submissions never retried,
// interrupted runs on a helper crash, attachments and references, and credentials that never reach a browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { startServer, ownerSession, userSession, httpClient } from './helpers/server.mjs';

const TOKEN = 'tok-CHATSECRET-4242';
const ENV = { MVW_PROVIDER_TEST: '1', MVW_PROVIDER_RUN_TIMEOUT_MS: '1500' };
let s, owner, ann, ben, cat, A, B, annId, benId;
const sockets = [];
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 30)); } };
function openWs(client) {
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: client.cookie } });
  const msgs = [];
  ws.onmessage = e => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('WebSocket error')); });
  sockets.push(ws);
  return { ws, msgs, opened, chat: run => msgs.filter(m => m.t === 'chat' && (!run || m.run === run)), next: (pred, ms) => waitFor(() => msgs.find(pred), ms) };
}
const me = async c => (await c.get('/api/auth/me')).json.account.id;
const run = (c, session, input, extra = {}) => c.post('/api/providers/runs', { agent: A, session, input, ...extra });
const session = async (c, label = 'Chat', agent = A) => (await c.post('/api/chat-sessions/create', { agent, label })).json.session;
const doneEvents = async (c, runId) => waitFor(async () => { const r = (await c.get(`/api/providers/runs/events?run=${runId}`)).json; return r && r.done ? r : null; });
const history = async (c, sess, agent = A) => (await c.get(`/api/providers/history?agent=${agent}&session=${sess}`)).json;

before(async () => {
  s = await startServer({ population: 150, agents: 3, env: ENV });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  ben = await userSession(s, owner, { login: 'ben', displayName: 'Ben', role: 'member' });
  cat = await userSession(s, owner, { login: 'cat', displayName: 'Cat', role: 'member' });
  [annId, benId] = [await me(ann), await me(ben)];
  const agents = (await owner.get('/api/agents')).json.agents;
  [A, B] = [agents[0].id, agents[1].id];
  const conn = await owner.post('/api/connections', { kind: 'mock', label: 'Shared mock', scope: 'installation', config: {}, secrets: { token: TOKEN } });
  assert.equal(conn.status, 200, conn.text);
  assert.equal((await owner.post('/api/agents/update', { id: A, connectionId: conn.json.id })).status, 200);
  assert.equal((await owner.post('/api/agents/update', { id: A, connectionId: 99999 })).status, 404, 'a connection that does not exist');
  for (const who of [annId, benId]) assert.equal((await owner.post('/api/agents/share', { id: A, kind: 'account', who: String(who), level: 'use' })).status, 200);
  assert.equal((await owner.post('/api/agents/share', { id: B, kind: 'account', who: String(annId), level: 'use' })).status, 200);   // B is not linked to a connection
});
after(async () => { for (const w of sockets) { try { w.close(); } catch { /* closed */ } } await s?.stop(); });

test('an account that may not use an agent finds nothing of it: 404 everywhere (X11)', async () => {
  const calls = [
    cat.get(`/api/chat-sessions?agent=${A}`), cat.post('/api/chat-sessions/create', { agent: A }), cat.post('/api/providers/runs', { agent: A, session: 1, input: 'hi' }),
    cat.get(`/api/providers/history?agent=${A}&session=1`), cat.get(`/api/providers/models?agent=${A}`), cat.get(`/api/providers/task?agent=${A}`),
    cat.get(`/api/chat-references?agent=${A}`), cat.post('/api/chat-references/add', { agent: A, kind: 'note', text: 'x' }),
  ];
  for (const r of await Promise.all(calls)) assert.equal(r.status, 404, r.text);
  assert.equal((await httpClient(s.url).get(`/api/chat-sessions?agent=${A}`)).status, 401, 'signed out: not even asked');
  assert.equal((await ann.get('/api/chat-sessions')).status, 400, 'which agent?');
});

test('sessions belong to the account and the agent: ben has the same agent and sees none of ann\'s (C119, I11.4)', async () => {
  const s1 = await session(ann, 'Ann one'), s2 = await session(ann, 'Ann two');
  assert.equal(s1.key, '@new', 'a new session is lazy and non-destructive');
  assert.deepEqual((await ann.get(`/api/chat-sessions?agent=${A}`)).json.sessions.map(x => x.label).sort(), ['Ann one', 'Ann two']);
  assert.equal((await ben.get(`/api/chat-sessions?agent=${A}`)).json.sessions.length, 0);
  const b1 = await session(ben, 'Ben one');
  for (const [who, id] of [[ben, s1.id], [ann, b1.id]]) {
    for (const [p, body] of [['switch', {}], ['rename', { label: 'Hijack' }], ['delete', {}]]) assert.equal((await who.post(`/api/chat-sessions/${p}`, { agent: A, session: id, ...body })).status, 404, p);
    assert.equal((await run(who, id, 'hi')).status, 404, 'not even to run in it');
    assert.equal((await who.get(`/api/providers/history?agent=${A}&session=${id}`)).status, 404);
  }
  assert.equal((await ann.post('/api/chat-sessions/rename', { agent: A, session: s2.id, label: 'Renamed' })).json.session.label, 'Renamed');
  assert.equal((await ann.post('/api/chat-sessions/switch', { agent: A, session: s1.id })).status, 200);
  assert.equal((await ann.post('/api/chat-sessions/delete', { agent: A, session: s2.id })).status, 200);
  assert.equal((await ann.get(`/api/chat-sessions?agent=${A}`)).json.sessions.length, 1);
});

test('a run streams its events only to the account that started it, and the reply lands in the history (A8, I11.9)', async () => {
  const [wa, wb, wo] = [openWs(ann), openWs(ben), openWs(owner)];
  await Promise.all([wa.opened, wb.opened, wo.opened]);
  const sess = (await ann.get(`/api/chat-sessions?agent=${A}`)).json.sessions[0];
  const r = await run(ann, sess.id, 'tool');
  assert.equal(r.status, 200, r.text);
  const runId = r.json.runId;
  assert.ok(await wa.next(m => m.t === 'chat' && m.run === runId && m.event?.type === 'run.end'), 'the end reached ann');
  const mine = wa.chat(runId);
  assert.deepEqual(mine.map(m => m.event?.type), ['run.start', 'run.progress', 'tool.start', 'tool.update', 'tool.end', 'run.end']);
  assert.deepEqual(mine.map(m => m.seq), [1, 2, 3, 4, 5, 6]); assert.equal(mine.every(m => m.agent === A && m.session === sess.id), true);
  await new Promise(r2 => setTimeout(r2, 300));
  assert.equal(wb.chat().length, 0, 'ben, who may use the same agent, sees nothing'); assert.equal(wo.chat().length, 0, 'nor does the owner');
  assert.equal(JSON.stringify(wa.msgs).includes('CHATSECRET'), false, 'no credential on the wire');
  const ev = (await ann.get(`/api/providers/runs/events?run=${runId}&since=4`)).json;
  assert.equal(ev.done, true); assert.deepEqual(ev.events.map(e => e.seq), [5, 6]);
  for (const who of [ben, owner, cat]) assert.equal((await who.get(`/api/providers/runs/events?run=${runId}`)).status, 404, 'the run is its starter\'s alone');
  const h = (await history(ann, sess.id)).messages;
  assert.deepEqual(h.map(m => `${m.role}:${m.text}`), ['user:tool', 'assistant:Mock reply to: tool']);
  assert.equal((await ann.post('/api/chat-sessions/create', { agent: A })).status, 200);
});

test('approvals: the run asks, the starter answers, nobody else can (A9)', async () => {
  const w = openWs(ann); await w.opened;
  const sess = await session(ann, 'Approvals');
  const runId = (await run(ann, sess.id, 'approve')).json.runId;
  const ask = await w.next(m => m.run === runId && m.event?.type === 'approval.requested');
  assert.ok(ask && ask.event.approvalId); assert.equal(ask.event.tool, 'shell');
  assert.equal((await ben.post('/api/providers/approvals', { run: runId, approval: ask.event.approvalId, approved: true })).status, 404);
  assert.equal((await ann.post('/api/providers/approvals', { run: runId, approval: ask.event.approvalId })).status, 400, 'approve or decline');
  assert.equal((await ann.post('/api/providers/approvals', { run: runId, approval: ask.event.approvalId, approved: true })).status, 200);
  assert.ok(await w.next(m => m.run === runId && m.event?.type === 'run.end' && m.event.status === 'ok'));
  assert.deepEqual(w.chat(runId).map(m => m.event?.type).slice(-3), ['approval.requested', 'approval.resolved', 'run.end']);
});

test('one answer at a time per session; stop ends it; a refused or failed run is said plainly', async () => {
  const w = openWs(ann); await w.opened;
  const sess = await session(ann, 'Busy');
  const runId = (await run(ann, sess.id, 'slow:5000')).json.runId;
  await w.next(m => m.run === runId && m.event?.type === 'run.progress');
  const busy = await run(ann, sess.id, 'again'); assert.equal(busy.status, 409); assert.equal(busy.json.code, 'busy');
  assert.equal((await ann.post('/api/chat-sessions/delete', { agent: A, session: sess.id })).json.code, 'busy', 'not while it answers');
  assert.equal((await ben.post('/api/providers/interrupt', { run: runId })).status, 404, 'only its starter stops it');
  assert.equal((await ann.post('/api/providers/interrupt', { run: runId })).status, 200);
  const end = await w.next(m => m.run === runId && m.event?.type === 'run.end');
  assert.equal(end.event.status, 'stopped');
  const failId = (await run(ann, sess.id, 'fail')).json.runId;
  assert.equal((await w.next(m => m.run === failId && m.event?.type === 'run.end')).event.status, 'error');
  assert.deepEqual((await history(ann, sess.id)).messages.filter(m => m.role === 'system').map(m => m.text), ['Stopped.', 'The agent could not answer: The mock failed on purpose']);
  assert.equal((await run(ann, sess.id, '   ')).json.code, 'empty'); assert.equal((await run(ann, sess.id, 'x'.repeat(100001))).status, 413);
});

test('a helper crash interrupts the run with a reason, never replays it, and the helper comes back (C120)', async () => {
  const w = openWs(ann); await w.opened;
  const sess = await session(ann, 'Crash');
  const runId = (await run(ann, sess.id, 'crash')).json.runId;
  const end = await w.next(m => m.run === runId && m.event?.type === 'run.end', 10000);
  assert.ok(end, 'the run ended'); assert.equal(end.event.status, 'interrupted'); assert.match(end.event.error, /helper stopped/);
  assert.equal(w.chat(runId).filter(m => m.event?.type === 'run.start').length, 1, 'started once and never replayed');
  const h = (await history(ann, sess.id)).messages;
  assert.equal(h.filter(m => m.role === 'user').length, 1); assert.match(h.at(-1).text, /interrupted/);
  assert.ok(await waitFor(async () => (await ann.get('/api/providers')).json.host.running, 10000), 'the helper restarted');
  const again = (await run(ann, sess.id, 'tool')).json.runId;
  assert.ok(await w.next(m => m.run === again && m.event?.type === 'run.end' && m.event.status === 'ok', 10000), 'and works again');
});

test('a submission that gets no answer is reported as uncertain and never retried (A9)', async () => {
  const w = openWs(ann); await w.opened;
  const sess = await session(ann, 'Hang');
  const r = await run(ann, sess.id, 'hang');
  assert.equal(r.status, 502); assert.equal(r.json.code, 'run_uncertain'); assert.match(r.json.error, /may or may not have started/);
  assert.ok(await w.next(m => m.t === 'chat' && m.event?.type === 'run.end' && m.event.status === 'error' && /may or may not/.test(m.event.error)), 'the page is told');
  const h = (await history(ann, sess.id)).messages;
  assert.equal(h.filter(m => m.role === 'user' && m.text === 'hang').length, 1, 'sent once');
  assert.match(h.at(-1).text, /uncertain/);
  assert.equal(w.chat().filter(m => m.event?.type === 'run.start').length, 0, 'the helper never reported a start: nothing was retried');
  const next = await run(ann, sess.id, 'tool');
  assert.equal(next.status, 200, 'an uncertain run does not block the session');
});

test('an agent with no connection says so; the models and the task progress come through the provider', async () => {
  const sb = await session(ann, 'B', B);
  const r = await ann.post('/api/providers/runs', { agent: B, session: sb.id, input: 'hi' });
  assert.equal(r.status, 409); assert.equal(r.json.code, 'not_connected'); assert.match(r.json.error, /Settings → Connections/);
  const m = await ann.get(`/api/providers/models?agent=${A}`);
  assert.deepEqual(m.json.models.map(x => x.id), ['mock-small', 'mock-large']); assert.deepEqual(m.json.effort, ['low', 'medium', 'high']);
  const sess = (await ann.get(`/api/chat-sessions?agent=${A}`)).json.sessions[0];
  assert.equal((await ann.get(`/api/providers/task?agent=${A}&session=${sess.id}`)).json.steps.length, 1);
  assert.equal((await ann.get(`/api/providers/models?agent=${B}`)).json.code, 'not_connected');
});

test('attachments: type by file name, stored once per account, private, limited by the setting (C121, X11)', async () => {
  const up = (c, name, buf) => c.request('POST', `/api/chat/attachments?name=${encodeURIComponent(name)}`, buf, { 'content-type': 'application/octet-stream' });
  const a = await up(ann, 'notes.txt', Buffer.from('hello attachment'));
  assert.equal(a.status, 200, a.text); assert.equal(a.json.attachment.mime, 'text/plain'); assert.equal(a.json.attachment.size, 16);
  const dup = await up(ann, 'again.txt', Buffer.from('hello attachment'));
  assert.equal(dup.json.attachment.id, a.json.attachment.id); assert.equal(dup.json.attachment.duplicate, true);
  assert.equal((await up(ann, 'tool.exe', Buffer.from('MZ'))).status, 415); assert.equal((await up(ann, 'empty.txt', Buffer.alloc(0))).json.code, 'empty');
  const list = (await ann.get('/api/chat/attachments')).json;
  assert.equal(list.attachments.length, 1); assert.equal(list.used, 16); assert.equal(list.maxBytes, 25 * 1048576);
  assert.equal((await ben.get('/api/chat/attachments')).json.attachments.length, 0, 'private to its account');
  const sess = (await ann.get(`/api/chat-sessions?agent=${A}`)).json.sessions[0], bs = (await ben.get(`/api/chat-sessions?agent=${A}`)).json.sessions[0];
  assert.equal((await run(ben, bs.id, 'use it', { attachments: [a.json.attachment.id] })).status, 404, 'ben cannot send ann\'s file');
  assert.equal((await run(ann, sess.id, 'use it', { attachments: [a.json.attachment.id] })).status, 200);
  assert.equal((await run(ann, sess.id, 'x', { attachments: [999] })).status, 404, 'a file that is not there');
  assert.equal((await owner.post('/api/settings', { values: { 'chat.attachmentMaxMb': '10' } })).status, 200);
  const big = await up(ann, 'big.txt', Buffer.alloc(11 * 1048576, 65));
  assert.equal(big.status, 413, big.text); assert.equal(big.json.code, 'file_too_large');
  assert.equal((await ann.get('/api/chat/attachments')).json.attachments.length, 1, 'nothing stored');
  assert.equal((await owner.post('/api/settings', { values: { 'chat.attachmentMaxMb': '25' } })).status, 200);
});

test('references are shared by everyone who may use the agent; only whoever manages it changes them (C53)', async () => {
  assert.deepEqual([(await ann.get(`/api/chat-references?agent=${A}`)).json.references.length, (await ann.get(`/api/chat-references?agent=${A}`)).json.canManage], [0, false]);
  assert.equal((await ann.post('/api/chat-references/add', { agent: A, kind: 'note', title: 'Hi', text: 'x' })).status, 403);
  const add = await owner.post('/api/chat-references/add', { agent: A, kind: 'link', title: 'Docs', url: 'https://example.com/docs' });
  assert.equal(add.status, 200, add.text); assert.equal(add.json.reference.url, 'https://example.com/docs');
  assert.equal((await owner.post('/api/chat-references/add', { agent: A, kind: 'link', url: 'javascript:1' })).json.code, 'bad_url');
  for (const who of [ann, ben]) assert.equal((await who.get(`/api/chat-references?agent=${A}`)).json.references.length, 1, 'everyone who may chat sees it');
  assert.equal((await ann.post('/api/chat-references/remove', { agent: A, id: add.json.reference.id })).status, 403);
  assert.equal((await owner.post('/api/chat-references/remove', { agent: A, id: add.json.reference.id })).json.removed, true);
  assert.equal((await ben.get(`/api/chat-references?agent=${A}`)).json.references.length, 0);
});

test('deleting a session removes it and its local history; history and sessions survive a restart (I11.9)', async () => {
  const keep = await session(ann, 'Keep'), gone = await session(ann, 'Gone');
  for (const sess of [keep, gone]) { const id = (await run(ann, sess.id, 'tool')).json.runId; assert.ok(await doneEvents(ann, id)); }
  // (the mirror is in the database since schema 27: chat_messages)
  const rows = () => { const db = new DatabaseSync(path.join(s.data, 'next.db'), { readOnly: true }); try { return db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE account_id = ? AND session_id = ?').get(annId, gone.id).n; } finally { db.close(); } };
  assert.equal(rows(), 2, 'the mirror is stored');
  assert.equal((await ann.post('/api/chat-sessions/delete', { agent: A, session: gone.id })).status, 200);
  assert.equal(rows(), 0, 'and gone with the session'); assert.equal((await history(ann, gone.id)).code, 'not_found');
  const dir = s.data, pw = ann.password;
  await s.stop({ keepData: true });
  s = await startServer({ data: dir, env: { ...ENV, MVW_KEY_FILE: s.keyFile } });
  const again = httpClient(s.url); await again.signIn('ann', pw);
  assert.ok((await again.get(`/api/chat-sessions?agent=${A}`)).json.sessions.some(x => x.id === keep.id), 'the session survived');
  assert.deepEqual((await history(again, keep.id)).messages.map(m => m.text), ['tool', 'Mock reply to: tool'], 'and its history');
  await waitFor(async () => (await again.get('/api/providers')).json.host.running, 10000);
  const id = (await again.post('/api/providers/runs', { agent: A, session: keep.id, input: 'tool' })).json.runId;
  assert.equal((await doneEvents(again, id)).events.at(-1).event.status, 'ok', 'the link and the sealed credential survived too');
  assert.equal(s.log().includes('CHATSECRET'), false, 'no credential in the server log after all of it');
});
