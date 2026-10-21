// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Presence over the API on a real server with the mock provider (PLAN WP2.3, CHECKLIST I8.6; DECISIONS A8, C120): working while a run
// works, finishing then idle, failed runs finish normally with the error recorded (for callers who may see tasks), a helper crash
// never leaves an agent working, unlinked agents are offline, and task text reaches only accounts that may see it.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

const ENV = { MVW_PROVIDER_TEST: '1', MVW_PROVIDER_RUN_TIMEOUT_MS: '1500' };
let s, owner, ann, A, B, aKey;
const sockets = [];
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 40)); } };
function openWs(client) {
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: client.cookie } });
  const msgs = [];
  ws.onmessage = e => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('WebSocket error')); });
  sockets.push(ws);
  return { ws, msgs, opened, pres: () => msgs.filter(m => m.t === 'presence' && m.id === aKey), next: (pred, ms) => waitFor(() => msgs.find(pred), ms) };
}
const me = async c => (await c.get('/api/auth/me')).json.account.id;
const of = async (c, id) => (await c.get(`/api/presence/${id}`)).json;
const session = async (c, label = 'P') => (await c.post('/api/chat-sessions/create', { agent: A, label })).json.session;
const run = (c, sess, input) => c.post('/api/providers/runs', { agent: A, session: sess, input });
const state = async (c, want, ms = 10000) => waitFor(async () => { const j = await of(c, A); return j.state === want ? j : null; }, ms);

before(async () => {
  s = await startServer({ population: 150, agents: 3, env: ENV });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  const annId = await me(ann);
  const agents = (await owner.get('/api/agents')).json.agents;
  [A, B] = [agents[0].id, agents[1].id]; aKey = agents[0].key;
  const conn = await owner.post('/api/connections', { kind: 'mock', label: 'Shared mock', scope: 'installation', config: {}, secrets: { token: 'tok-PRESSECRET-1' } });
  assert.equal(conn.status, 200, conn.text);
  assert.equal((await owner.post('/api/agents/update', { id: A, connectionId: conn.json.id })).status, 200);
  assert.equal((await owner.post('/api/agents/share', { id: A, kind: 'account', who: String(annId), level: 'use' })).status, 200);
  assert.equal((await owner.post('/api/settings', { values: { 'presence.finishGraceSec': '3' } })).status, 200);
});
after(async () => { for (const w of sockets) { try { w.close(); } catch { /* closed */ } } await s?.stop(); });

test('an agent with no connection is offline, one with a working connection is idle, and unknown ids are 404 (I8.6)', async () => {
  const list = (await owner.get('/api/presence')).json.agents;
  assert.equal(list.length, 3, 'the demo limit shows three agents');
  const by = Object.fromEntries(list.map(x => [x.id, x]));
  assert.equal(by[A].state, 'idle'); assert.equal(by[A].working, false); assert.equal(by[B].state, 'offline');
  assert.deepEqual([(await of(owner, B)).state, (await of(owner, A)).meeting], ['offline', false]);
  for (const bad of ['99999', 'abc', '0', '1.5']) assert.equal((await owner.get(`/api/presence/${bad}`)).status, 404, bad);
});

test('a run makes the agent work; the owner sees the task, a member only whether it works; then finishing, then idle (I8.6)', async () => {
  const wo = openWs(owner), wa = openWs(ann); await Promise.all([wo.opened, wa.opened]);
  const sess = await session(ann, 'Work');
  const r = await run(ann, sess.id, 'slow:1800'); assert.equal(r.status, 200, r.text);
  const w = await state(owner, 'working'); assert.ok(w, 'working while the run works');
  assert.equal(w.working, true); assert.equal(typeof w.task, 'string'); assert.equal(w.source, 'provider');
  const lite = await of(ann, A);
  assert.deepEqual(Object.keys(lite).sort(), ['id', 'key', 'meeting', 'state', 'working'], 'a member sees no task text and no error');
  assert.equal(lite.working, true);
  assert.ok(await state(owner, 'finishing', 12000), 'finishing after it ends');
  assert.equal((await of(ann, A)).state, 'working', 'a member sees finishing as still working');
  assert.ok(await state(owner, 'idle', 12000), 'idle after the grace');
  assert.equal((await of(ann, A)).state, 'idle');
  // the live stream: full info for the owner, lite for the member, same order
  assert.ok(await wo.next(m => m.t === 'presence' && m.id === aKey && m.info.state === 'idle', 6000), 'the owner is told it is idle');
  const seq = wo.pres().map(m => m.info.working);
  assert.deepEqual([seq[0], seq.at(-1)], [true, false], 'working first, idle last');
  const memberFrame = wa.pres().find(m => m.info.working);
  assert.ok(memberFrame && !('task' in memberFrame.info), 'the member\'s frame has no task text');
});

test('a failed run finishes normally and the error is recorded, for callers who may see it (I8.6)', async () => {
  const sess = await session(ann, 'Fail');
  const r = await run(ann, sess.id, 'fail'); assert.equal(r.status, 200, r.text);
  const f = await waitFor(async () => { const j = await of(owner, A); return j.lastRunError ? j : null; });
  assert.ok(f, 'the error is recorded'); assert.match(f.lastRunError, /mock failed on purpose/);
  assert.equal('lastRunError' in (await of(ann, A)), false, 'a member does not see it');
  assert.ok(await state(owner, 'idle', 12000), 'nobody stays working: it finishes and goes idle');
  assert.match((await of(owner, A)).lastRunError, /mock failed/, 'kept after it finished');
  const ok = await run(ann, sess.id, 'tool'); assert.equal(ok.status, 200, ok.text);
  assert.ok(await waitFor(async () => (await of(owner, A)).lastRunError === null), 'a good run clears the error');
  assert.ok(await state(owner, 'idle', 12000));
});

test('a helper crash mid-run never leaves the agent working, and it works again after the restart (C120, I8.6)', async () => {
  const sess = await session(ann, 'Crash');
  const r = await run(ann, sess.id, 'crash'); assert.equal(r.status, 200, r.text);
  const c = await waitFor(async () => { const j = await of(owner, A); return /helper stopped/.test(j.lastRunError || '') ? j : null; }, 12000);
  assert.ok(c, 'the interruption is recorded with its reason');
  assert.ok(await state(owner, 'idle', 15000), 'idle, not working forever');
  assert.ok(await waitFor(async () => (await ann.get('/api/providers')).json.host.running, 15000), 'the helper is back');
  const again = await run(ann, sess.id, 'slow:1200'); assert.equal(again.status, 200, again.text);
  assert.ok(await state(owner, 'working'), 'and the agent works again');
  assert.ok(await state(owner, 'idle', 15000));
});

test('what the server reports about presence in its health is for diagnostics readers only', async () => {
  const st = (await owner.get('/api/health')).json;
  assert.equal(typeof st.presence.activeRuns, 'number'); assert.equal(st.presence.finishGraceSec, 3); assert.equal(st.presence.quietLimitMin, 60);
  const lite = (await ann.get('/api/health')).json;
  assert.equal('activeRuns' in (lite.presence || {}), false);
  assert.equal(String((await owner.get('/api/presence')).text).includes('PRESSECRET'), false, 'no credential in presence');
});
