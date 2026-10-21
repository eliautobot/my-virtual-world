// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Visitors chatting with someone else's connected agent (PLAN WP2.14; DECISIONS C119, C127, C128, C129; CHECKLIST I8.15): who may chat
// follows the owner's audience setting, each visitor has a private session, visitors are limited and can be blocked and can report,
// they never see the agent's tools or what it asks its owner, and only the owner answers approvals.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, ben, cy, dee;
const S = {};
const makeAgent = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
  return { pub, sign: m => crypto.sign(null, Buffer.from(m), privateKey).toString('base64url') };
};
const nonce = () => crypto.randomBytes(12).toString('base64url');
async function call(method, p, body, token) {
  const h = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
  const r = await fetch(new URL(p, s.url), { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}
async function connect(owner, name) {
  const made = await owner.post('/api/agent-slots', { name }), a = makeAgent();
  assert.equal((await call('POST', '/api/agent-api/enroll', { code: made.json.code, publicKey: a.pub, signature: a.sign(`v1|enrol|${made.json.code}|${a.pub}`) })).status, 200);
  assert.equal((await owner.post('/api/agent-slots/approve', { id: made.json.slot.id })).status, 200, 'its owner\'s OK');
  const bot = { slot: made.json.slot.id, token: null };
  const ts = Math.floor(Date.now() / 1000), n = nonce();
  bot.token = (await call('POST', '/api/agent-api/session', { slot: bot.slot, timestamp: ts, nonce: n, signature: a.sign(`v1|session|${bot.slot}|${ts}|${n}`) })).json.token;
  bot.inbox = () => call('GET', '/api/agent-api/inbox', undefined, bot.token);
  bot.report = e => call('POST', '/api/agent-api/events', e, bot.token);
  bot.id = (await owner.get('/api/agents')).json.agents.find(x => x.key === `ext-${bot.slot}`).id;
  return bot;
}
const me = async c => (await c.get('/api/auth/me')).json.account.id;
const setup = (c, patch) => ann.post('/api/agent-slots/update', { id: S.bot.slot, ...patch });
const write = async (c, text, label = 'Chat') => {
  const sess = (await c.post('/api/chat-sessions/create', { agent: S.bot.id, label })).json.session;
  return c.post('/api/providers/runs', { agent: S.bot.id, session: sess && sess.id, input: text });
};
const events = async (c, run) => (await c.get(`/api/providers/runs/events?run=${run}`)).json;
const finish = async runId => { await S.bot.report({ type: 'run.end', runId, status: 'ok', text: 'done' }); };

before(async () => {
  s = await startServer({ population: 150, agents: 3 });
  owner = await ownerSession(s);
  [ann, ben, cy, dee] = [];
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  ben = await userSession(s, owner, { login: 'ben', displayName: 'Ben', role: 'member' });
  cy = await userSession(s, owner, { login: 'cy', displayName: 'Cy', role: 'member' });
  dee = await userSession(s, owner, { login: 'dee', displayName: 'Dee', role: 'member' });
  assert.equal((await ann.post('/api/friends/request', { name: 'Ben' })).status, 200);
  assert.equal((await ben.post('/api/friends/accept', { id: (await ben.get('/api/friends')).json.incoming[0].id })).json.state, 'friends');
  S.ids = { ben: await me(ben), cy: await me(cy), dee: await me(dee) };
  S.bot = await connect(ann, 'Public helper');
});
after(async () => { await s?.stop(); });

test('the audience decides who may chat: owner only by default, then friends, then everyone, and a guest never (I8.15)', async () => {
  await setup(ann, { visibility: 'public' });
  for (const [name, who] of [['a friend', ben], ['a stranger', cy]]) assert.equal((await write(who, 'hi')).status, 404, `${name}: public to look at, still owner only to chat`);
  assert.equal((await setup(ann, { chatAudience: 'friends' })).status, 200);
  let r = await write(ben, 'Hello from a friend'); assert.equal(r.status, 200, r.text); await S.bot.inbox(); await finish(r.json.runId);
  assert.equal((await write(cy, 'hi')).status, 404, 'a stranger is still out');
  assert.equal((await setup(ann, { chatAudience: 'everyone' })).status, 200);
  r = await write(cy, 'Hello from a stranger'); assert.equal(r.status, 200, r.text); await S.bot.inbox(); await finish(r.json.runId);
  const guest = await call('POST', '/api/providers/runs', { agent: S.bot.id, session: 1, input: 'hi' });
  assert.equal(guest.status, 401, 'a guest cannot chat at all');
  assert.equal((await setup(ann, { visibility: 'hidden' })).status, 200);
  assert.equal((await write(cy, 'hi')).status, 404, 'everyone may chat only with an agent they can see');
  await setup(ann, { visibility: 'public' });
});

test('the agent sees who wrote: a visitor is labelled as one, the owner is not; each visitor has their own private chat (C119)', async () => {
  const a = await write(ben, 'From Ben'); await write(ann, 'From the owner');
  const got = (await S.bot.inbox()).json.messages;
  const byText = Object.fromEntries(got.map(m => [m.text, m]));
  assert.deepEqual(byText['From Ben'].sender, { name: 'Ben', visitor: true });
  assert.deepEqual(byText['From the owner'].sender, { name: 'Ann', visitor: false });
  for (const m of got) await finish(m.runId);
  const sessBen = (await ben.get(`/api/chat-sessions?agent=${S.bot.id}`)).json.sessions, sessCy = (await cy.get(`/api/chat-sessions?agent=${S.bot.id}`)).json.sessions;
  assert.ok(sessBen.length >= 1); assert.equal(sessBen.some(x => sessCy.some(y => y.id === x.id)), false, 'no shared sessions');
  const hist = JSON.stringify((await ben.get(`/api/providers/history?agent=${S.bot.id}&session=${sessBen[0].id}`)).json);
  assert.equal(hist.includes('From the owner'), false, 'Ben never sees the owner\'s chat'); assert.equal(hist.includes('From Ben') || hist.includes('friend'), true);
  assert.equal((await cy.get(`/api/providers/history?agent=${S.bot.id}&session=${sessBen[0].id}`)).status, 404, 'nor can Cy read Ben\'s session');
  assert.ok(a.status === 200);
});

test('a visitor sees the answer but not the agent\'s tools or what it asks its owner; only the owner answers approvals (C129)', async () => {
  const r = await write(cy, 'Clean the build folder'); await S.bot.inbox();
  await S.bot.report({ type: 'tool.start', runId: r.json.runId, toolId: 't1', name: 'shell', input: 'rm -rf build' });
  await S.bot.report({ type: 'approval.requested', runId: r.json.runId, approvalId: 'p1', tool: 'shell', summary: 'rm -rf build' });
  const seen = (await events(cy, r.json.runId)).events.map(e => e.event.type);
  assert.equal(seen.some(t => t.startsWith('tool.') || t.startsWith('approval.')), false, `the visitor's stream: ${seen.join(',')}`);
  const pending = (await ann.get('/api/providers/approvals')).json.approvals;
  assert.deepEqual(pending.map(p => [p.run, p.approval, p.tool]), [[r.json.runId, 'p1', 'shell']], 'the owner is asked');
  assert.deepEqual((await cy.get('/api/providers/approvals')).json.approvals, [], 'the visitor is not');
  const no = await cy.post('/api/providers/approvals', { run: r.json.runId, approval: 'p1', approved: true });
  assert.equal(no.status, 403, 'the visitor cannot approve their own run');
  assert.equal((await ben.post('/api/providers/approvals', { run: r.json.runId, approval: 'p1', approved: true })).status, 404, 'another visitor is not told it exists');
  const yes = await ann.post('/api/providers/approvals', { run: r.json.runId, approval: 'p1', approved: false });
  assert.equal(yes.status, 200, yes.text);
  assert.deepEqual((await S.bot.inbox()).json.approvals, [{ runId: r.json.runId, approvalId: 'p1', approved: false }]);
  await S.bot.report({ type: 'run.end', runId: r.json.runId, status: 'ok', text: 'Left the build folder alone' });
  const end = await events(cy, r.json.runId); assert.equal(end.done, true); assert.equal(end.events.at(-1).event.text, 'Left the build folder alone');
});

test('a visitor is limited per conversation and per day - the same "talk" settings as walking up to an agent; the owner is not (C128)', async () => {
  assert.equal((await owner.post('/api/settings', { values: { 'talk.maxMessages': 6 } })).status, 200);
  const runs = [];
  for (let i = 0; i < 6; i++) { const r = await write(dee, `m${i}`, `S${i}`); assert.equal(r.status, 200, `${i}: ${r.text}`); runs.push(r.json.runId); }
  const slow = await write(dee, 'one too many', 'S7');
  assert.equal(slow.status, 429, slow.text); assert.equal(slow.json.code, 'slow_down');
  const got = (await S.bot.inbox()).json.messages; for (const m of got) await finish(m.runId);
  const own = await write(ann, 'the owner has no limit', 'O'); assert.equal(own.status, 200); await S.bot.inbox(); await finish(own.json.runId);
  assert.equal((await write(ben, 'a different visitor is not slowed', 'B2')).status, 200);
  await S.bot.inbox();
  assert.equal((await owner.post('/api/settings', { values: { 'talk.maxMessages': 15 } })).status, 200);
});

test('pause and block: the owner stops chat at once, for everybody or for one person, and can undo it (C128)', async () => {
  for (const m of (await S.bot.inbox()).json.messages) await finish(m.runId);
  assert.equal((await setup(ann, { chatPaused: true })).status, 200);
  assert.equal((await write(cy, 'paused?', 'P1')).status, 404, 'paused: visitors are out');
  const own = await write(ann, 'the owner still can', 'P2'); assert.equal(own.status, 200); await S.bot.inbox(); await finish(own.json.runId);
  assert.equal((await setup(ann, { chatPaused: false })).status, 200);
  assert.equal((await ann.post('/api/agent-slots/block', { id: S.bot.slot, account: S.ids.cy })).json.blocked.includes(S.ids.cy), true);
  assert.equal((await write(cy, 'blocked?', 'P3')).status, 404, 'blocked');
  assert.equal((await write(ben, 'others are fine', 'P4')).status, 200); await S.bot.inbox();
  assert.equal((await ann.post('/api/agent-slots/block', { id: S.bot.slot, account: await me(ann) })).status, 400, 'you cannot block yourself');
  assert.equal((await ben.post('/api/agent-slots/block', { id: S.bot.slot, account: S.ids.dee })).status, 404, 'only the owner can block');
  assert.equal((await ann.post('/api/agent-slots/unblock', { id: S.bot.slot, account: S.ids.cy })).json.blocked.length, 0);
  assert.equal((await write(cy, 'welcome back', 'P5')).status, 200); await S.bot.inbox();
});

test('a visitor can report an agent to its owner; only people who can see the agent can, and only the owner reads the reports (C128)', async () => {
  const r = await cy.post('/api/agent-reports', { agent: S.bot.id, reason: '  It said something rude  ' });
  assert.equal(r.status, 200, r.text);
  assert.equal((await cy.post('/api/agent-reports', { agent: S.bot.id, reason: '' })).status, 400);
  await setup(ann, { visibility: 'hidden' });
  assert.equal((await cy.post('/api/agent-reports', { agent: S.bot.id, reason: 'x' })).status, 404, 'a hidden agent cannot be reported by strangers');
  await setup(ann, { visibility: 'public' });
  const rep = (await ann.get(`/api/agent-slots/reports?id=${S.bot.slot}`)).json;
  assert.equal(rep.reports.length, 1); assert.deepEqual([rep.reports[0].name, rep.reports[0].reason], ['Cy', 'It said something rude']);
  assert.equal((await cy.get(`/api/agent-slots/reports?id=${S.bot.slot}`)).status, 404, 'a visitor cannot read them');
  assert.equal((await ben.get(`/api/agent-slots/reports?id=${S.bot.slot}`)).status, 404);
});
