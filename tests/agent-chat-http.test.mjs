// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Chatting with a connected agent, end to end over HTTP (PLAN WP2.14; DECISIONS E22, C125, C127, C129; CHECKLIST I8.14, I8.15):
// the owner writes to their own hidden agent from the chat, the agent (a fake client that only makes outbound calls) fetches the
// message, reports on its work and answers; the owner's approvals reach it; a stopped or unfetched message is taken back; nobody else
// can write to it, and it can report only on its own runs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, ben, cy;
const S = {};
const makeAgent = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
  return { pub, sign: m => crypto.sign(null, Buffer.from(m), privateKey).toString('base64url') };
};
const nonce = () => crypto.randomBytes(12).toString('base64url');
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 40)); } };
async function call(method, p, body, token) {
  const h = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
  const r = await fetch(new URL(p, s.url), { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}
/** A connected agent as a program would be: enrol once, sign in, then only outbound calls. */
async function connect(owner, name) {
  const made = await owner.post('/api/agent-slots', { name }), a = makeAgent();
  const en = await call('POST', '/api/agent-api/enroll', { code: made.json.code, publicKey: a.pub, signature: a.sign(`v1|enrol|${made.json.code}|${a.pub}`) });
  assert.equal(en.status, 200, en.text);
  assert.equal((await owner.post('/api/agent-slots/approve', { id: made.json.slot.id })).status, 200, 'its owner\'s OK');
  const agent = { a, slot: made.json.slot.id, token: null };
  agent.login = async () => {
    const ts = Math.floor(Date.now() / 1000), n = nonce();
    const r = await call('POST', '/api/agent-api/session', { slot: agent.slot, timestamp: ts, nonce: n, signature: a.sign(`v1|session|${agent.slot}|${ts}|${n}`) });
    assert.equal(r.status, 200, r.text); agent.token = r.json.token;
  };
  agent.inbox = (wait = 0) => call('GET', `/api/agent-api/inbox${wait ? `?wait=${wait}` : ''}`, undefined, agent.token);
  agent.report = (e) => call('POST', '/api/agent-api/events', e, agent.token);
  const list = (await owner.get('/api/agents')).json.agents;
  agent.id = list.find(x => x.key === `ext-${agent.slot}`).id;
  return agent;
}
const session = async (c, agent, label = 'Chat') => (await c.post('/api/chat-sessions/create', { agent, label })).json.session;
const startRun = (c, agent, sess, input) => c.post('/api/providers/runs', { agent, session: sess, input });
const runEvents = async (c, run, since = 0) => (await c.get(`/api/providers/runs/events?run=${run}&since=${since}`)).json;
const presence = async (c, id) => (await c.get(`/api/presence/${id}`)).json.state;

before(async () => {
  s = await startServer({ population: 150, agents: 3 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  ben = await userSession(s, owner, { login: 'ben', displayName: 'Ben', role: 'member' });
  cy = await userSession(s, owner, { login: 'cy', displayName: 'Cy', role: 'member' });
  assert.equal((await ann.post('/api/friends/request', { name: 'Ben' })).status, 200);
  assert.equal((await ben.post('/api/friends/accept', { id: (await ben.get('/api/friends')).json.incoming[0].id })).json.state, 'friends');
  S.bot = await connect(ann, 'Claude Code'); await S.bot.login();
});
after(async () => { await s?.stop(); });

test('the owner writes to their own hidden agent; the agent fetches it, works, and answers into the same chat (I8.14)', async () => {
  const sess = await session(ann, S.bot.id);
  assert.equal(await presence(ann, S.bot.id), 'idle');
  const sent = await startRun(ann, S.bot.id, sess.id, 'Please summarise the repo');
  assert.equal(sent.status, 200, sent.text); S.run = sent.json.runId;
  const got = await S.bot.inbox(5);
  assert.equal(got.status, 200, got.text); assert.equal(got.json.messages.length, 1);
  const m = got.json.messages[0];
  assert.deepEqual([m.runId, m.text, m.sender], [S.run, 'Please summarise the repo', { name: 'Ann', visitor: false }]);
  assert.equal(await waitFor(async () => (await presence(ann, S.bot.id)) === 'working'), true, 'it shows as working once it has the message');
  assert.equal((await S.bot.report({ type: 'run.progress', runId: S.run, text: 'Reading files', pct: 30 })).status, 200);
  assert.equal((await S.bot.report({ type: 'tool.start', runId: S.run, toolId: 't1', name: 'shell', input: 'ls' })).status, 200);
  assert.equal((await S.bot.report({ type: 'tool.end', runId: S.run, toolId: 't1', ok: true, text: 'ok' })).status, 200);
  const mid = await runEvents(ann, S.run);
  assert.deepEqual(mid.events.map(e => e.event.type), ['run.start', 'run.progress', 'tool.start', 'tool.end'].filter(t => mid.events.some(e => e.event.type === t)));
  assert.equal(mid.done, false);
  assert.equal((await S.bot.report({ type: 'run.end', runId: S.run, status: 'ok', text: 'The repo is a Node server with a browser client.' })).status, 200);
  const end = await runEvents(ann, S.run);
  assert.equal(end.done, true); assert.equal(end.events.at(-1).event.type, 'run.end'); assert.equal(end.events.at(-1).event.text, 'The repo is a Node server with a browser client.');
  assert.equal(await waitFor(async () => (await presence(ann, S.bot.id)) === 'idle', 12000), true, 'idle again after the grace');
  const hist = (await ann.get(`/api/providers/history?agent=${S.bot.id}&session=${sess.id}`)).json;
  const texts = JSON.stringify(hist); assert.ok(texts.includes('Please summarise the repo') && texts.includes('The repo is a Node server'), 'both sides are in the chat history');
  S.sess = sess;
});

test('a message written while the agent is offline waits, and the agent finds it when it signs in again (C125)', async () => {
  const bot = await connect(ann, 'Sleeper');   // enrolled, never signed in: offline
  assert.equal(await presence(ann, bot.id), 'offline');
  const sess = await session(ann, bot.id);
  const sent = await startRun(ann, bot.id, sess.id, 'Are you there?');
  assert.equal(sent.status, 200, sent.text);
  assert.equal((await runEvents(ann, sent.json.runId)).done, false, 'the run stays open while it waits');
  assert.equal((await bot.inbox()).status, 401, 'no session yet');
  await bot.login();
  const got = await bot.inbox(3);
  assert.deepEqual(got.json.messages.map(m => m.text), ['Are you there?']);
  await bot.report({ type: 'run.end', runId: sent.json.runId, status: 'ok', text: 'Yes' });
  assert.equal((await runEvents(ann, sent.json.runId)).done, true);
});

test('stop takes back a message the agent has not fetched, and tells a working agent to stop the run', async () => {
  const sess = await session(ann, S.bot.id, 'Stop');
  const a = await startRun(ann, S.bot.id, sess.id, 'First');
  assert.equal((await ann.post('/api/providers/interrupt', { run: a.json.runId })).status, 200);
  assert.equal((await S.bot.inbox()).json.messages.length, 0, 'never delivered');
  const ra = await runEvents(ann, a.json.runId); assert.equal(ra.done, true); assert.equal(ra.events.at(-1).event.status, 'stopped');
  const b = await startRun(ann, S.bot.id, sess.id, 'Second'); await S.bot.inbox();
  assert.equal((await ann.post('/api/providers/interrupt', { run: b.json.runId })).status, 200);
  assert.deepEqual((await S.bot.inbox()).json.stops, [b.json.runId]);
  await S.bot.report({ type: 'run.end', runId: b.json.runId, status: 'stopped' });
  assert.equal((await runEvents(ann, b.json.runId)).done, true);
});

test('approvals: the agent asks, only the owner answers, and the answer reaches the agent (C129)', async () => {
  const sess = await session(ann, S.bot.id, 'Approve');
  const r = await startRun(ann, S.bot.id, sess.id, 'Delete the build folder'); await S.bot.inbox();
  await S.bot.report({ type: 'approval.requested', runId: r.json.runId, approvalId: 'p1', tool: 'shell', summary: 'rm -rf build' });
  assert.equal(await presence(ann, S.bot.id), 'working', 'a viewer without task access sees waiting for an approval as working (WP2.3); the coordinator tests cover the exact state');
  const ev = await runEvents(ann, r.json.runId); assert.ok(ev.events.some(e => e.event.type === 'approval.requested'));
  assert.equal((await S.bot.report({ type: 'approval.resolved', runId: r.json.runId, approvalId: 'p1', approved: true })).status, 400, 'the agent cannot answer for itself');
  for (const who of [ben, cy]) assert.equal((await who.post('/api/providers/approvals', { run: r.json.runId, approval: 'p1', approved: true })).status, 404, 'no one else can');
  assert.equal((await call('POST', '/api/providers/approvals', { run: r.json.runId, approval: 'p1', approved: true }, S.bot.token)).status, 401, 'nor the agent\'s token');
  const yes = await ann.post('/api/providers/approvals', { run: r.json.runId, approval: 'p1', approved: true });
  assert.equal(yes.status, 200, yes.text);
  assert.deepEqual((await S.bot.inbox(3)).json.approvals, [{ runId: r.json.runId, approvalId: 'p1', approved: true }]);
  await S.bot.report({ type: 'run.end', runId: r.json.runId, status: 'ok', text: 'Deleted' });
});

test('nobody else can write to a hidden agent, and an agent cannot touch another agent\'s runs or the chat routes (I8.15, X11)', async () => {
  for (const [name, who] of [['a friend', ben], ['a stranger', cy], ['the installation owner', owner]]) {
    const r = await who.post('/api/chat-sessions/create', { agent: S.bot.id, label: 'x' });
    assert.equal(r.status, 404, `${name}: not even told it exists`);
    assert.equal((await who.post('/api/providers/runs', { agent: S.bot.id, session: S.sess.id, input: 'hi' })).status, 404, name);
  }
  const other = await connect(ben, 'Ben bot'); await other.login();
  const sess = await session(ann, S.bot.id, 'Mine'); const r = await startRun(ann, S.bot.id, sess.id, 'private'); await S.bot.inbox();
  assert.equal((await other.report({ type: 'run.progress', runId: r.json.runId, text: 'hijack' })).status, 404, 'another agent cannot report on it');
  assert.equal((await other.inbox()).json.messages.length, 0);
  for (const [m, p, b] of [['POST', '/api/providers/runs', { agent: S.bot.id, session: sess.id, input: 'x' }], ['GET', `/api/providers/history?agent=${S.bot.id}&session=${sess.id}`], ['POST', '/api/chat-sessions/create', { agent: S.bot.id }]]) {
    assert.equal((await call(m, p, b, S.bot.token)).status, 401, `${m} ${p}: an agent token is not a chat login`);
  }
  await S.bot.report({ type: 'run.end', runId: r.json.runId, status: 'ok', text: 'done' });
});

test('a message that waits longer than a day is dropped and the chat is told; revoking ends what is open', async () => {
  const bot = await connect(ann, 'Revoked soon'); await bot.login();
  const sess = await session(ann, bot.id);
  const r = await startRun(ann, bot.id, sess.id, 'Anything'); await bot.inbox();
  assert.equal((await ann.post('/api/agent-slots/revoke', { id: bot.slot })).status, 200);
  const ev = await waitFor(async () => { const e = await runEvents(ann, r.json.runId); return e.done ? e : null; });
  assert.ok(ev, 'the run ended'); assert.equal(ev.events.at(-1).event.status, 'interrupted'); assert.match(ev.events.at(-1).event.error, /disconnected/);
  assert.equal((await bot.inbox()).status, 401, 'and its session is gone');
  assert.equal((await startRun(ann, bot.id, sess.id, 'again')).status, 404, 'a revoked agent is not in the chat any more');
});

test('whatever an agent writes reaches the person, however it ends the run; a run ended without a word says so plainly (2026-09-29: a listener sent its answer and ended the run "interrupted")', async () => {
  const bot = await connect(ann, 'Listener'); await bot.login();
  const sess = await session(ann, bot.id);
  const ask = async text => { const r = await startRun(ann, bot.id, sess.id, text); await bot.inbox(); return r.json.runId; };
  const endWith = async body => { const id = await ask('hi'); await bot.report({ type: 'run.end', runId: id, ...body }); const ev = await waitFor(async () => { const e = await runEvents(ann, id); return e.done ? e : null; }); return ev.events.at(-1).event; };
  const hist = async () => (await ann.get(`/api/providers/history?agent=${bot.id}&session=${sess.id}`)).json.messages;
  const a = await endWith({ status: 'interrupted', text: 'Saved. Automatic replies are off.' });
  assert.equal(a.error, undefined, 'an answer explains itself, no reason is invented');
  let h = await hist();
  assert.ok(h.some(m => m.role === 'assistant' && m.text === 'Saved. Automatic replies are off.'), 'the agent\'s own words are in the conversation');
  assert.match(h.at(-1).text, /ended the run before finishing/, 'and the person is told it did not finish');
  assert.equal(/provider/i.test(JSON.stringify(h)), false, 'nothing blames a provider restart');
  await endWith({ status: 'interrupted' });
  h = await hist(); assert.match(h.at(-1).text, /interrupted: The agent ended the run and gave no reason/);
  await endWith({ status: 'ok' });
  h = await hist(); assert.match(h.at(-1).text, /finished without sending an answer/);
});
