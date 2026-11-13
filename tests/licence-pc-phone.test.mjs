// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Demo mode locks the agents' PCs (their computer, browser, terminal and screens: lock 'pc') and their phones (texts and
// calls through Twilio: lock 'phone') — server/licence.js. Every route of theirs carries the lock; the server refuses them
// with the licence message (the page, AI apps through the connector, an agent's own screen live); where no route is
// involved the lock holds too: the phones' Twilio calls, sync and delivery to the agent, and the PC's work sessions.
// A licence key unlocks them (the licensed half needs the test licence: tools/lib/testserver.mjs TEST_LICENCE_FILE).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { createApi } from '../server/routes.js';
import { LOCKS } from '../server/licence.js';
import { addPcRoutes } from '../server/pc/routes.js';
import { addPhoneRoutes } from '../server/phone/routes.js';
import { invoker } from '../server/connector/tools.js';
import { openDb } from '../server/db.js';
import { Phone } from '../server/phone/phone.js';
import { PcOS } from '../server/pc/os.js';
import { PcWork } from '../server/pc/work.js';
import { startServer, ownerSession, importTestLicence, TEST_LICENCE_FILE, tempDir } from './helpers/server.mjs';

/** Every route the server has, the PC's and the phones' included (their modules add them in server/index.mjs). */
function allRoutes() {
  const { router } = createApi({});
  addPcRoutes(router, {}, {});
  addPhoneRoutes(router, {});
  return { router, routes: router.list ? router.list() : router.routes };
}

test('the locks are known features with a name the page shows', () => {
  assert.ok(Object.hasOwn(LOCKS, 'pc') && Object.hasOwn(LOCKS, 'phone'));
  assert.match(LOCKS.pc, /PC/); assert.match(LOCKS.pc, /browser/); assert.match(LOCKS.pc, /terminal/); assert.match(LOCKS.pc, /screens/);
  assert.match(LOCKS.phone, /phone/); assert.match(LOCKS.phone, /Twilio/);
});

test('lock coverage: every PC route carries lock pc, every phone route lock phone, an agent\'s browser and screen lock pc', () => {
  const { routes } = allRoutes();
  const pc = routes.filter(r => /^\/api\/pc(\/|$)/.test(r.path || ''));
  const phone = routes.filter(r => /^\/api\/phone(\/|$)/.test(r.path || ''));
  const watch = routes.filter(r => /^\/api\/providers\/(browser|screen)(\/|$)/.test(r.path || ''));
  assert.ok(pc.length >= 40, `the PC's routes (${pc.length})`);
  assert.ok(phone.length >= 20, `the phones' routes (${phone.length})`);
  assert.equal(watch.length, 6, 'an agent\'s browser (state, act, frame) and its own screen (state, act, picture)');
  for (const r of [...pc, ...watch]) assert.equal(r.lock, 'pc', `${r.method} ${r.path} must carry lock 'pc'`);
  for (const r of phone) assert.equal(r.lock, 'phone', `${r.method} ${r.path} must carry lock 'phone'`);
  for (const r of routes) if (r.cap === 'agents.pc') assert.equal(r.lock, 'pc', `${r.method} ${r.path}: capability agents.pc without lock 'pc'`);
  for (const r of routes) if (r.cap === 'agents.phone') assert.equal(r.lock, 'phone', `${r.method} ${r.path}: capability agents.phone without lock 'phone'`);
});

test('AI apps (the connector) are refused the PC and the phone in demo mode, and reach them once licensed', async () => {
  const { router } = allRoutes();
  const P = { account: { id: 1, login: 'o', role: 'owner' }, role: 'owner' };
  const host = { origin: 'http://127.0.0.1:9', ip: '127.0.0.1', userAgent: 'test' };
  const perms = { allowed: () => true };
  const demo = invoker({ router, perms, licence: { locked: l => !!l }, host });
  for (const [m, p, o] of [['GET', '/api/pc', {}], ['POST', '/api/pc/shell', { body: { agent: 1, run: 'ls' } }], ['GET', '/api/phone', { query: { agent: 1 } }],
    ['POST', '/api/phone/send', { body: { agent: 1, to: '+15550100', body: 'hi' } }], ['GET', '/api/phone/threads', { query: { agent: 1 } }]]) {
    const r = await demo(P, m, p, o);
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.json.code, 'licence_required', `${m} ${p}`);
  }
  // licensed: the lock is not what answers (the stub PC behind the route answers, or fails, its own way)
  const licensed = invoker({ router, perms, licence: { locked: () => false }, host });
  let r;
  try { r = await licensed(P, 'GET', '/api/phone/summary'); } catch (e) { r = { status: 500, json: { code: 'stub', error: e.message } }; }
  assert.notEqual(r.json?.code, 'licence_required');
});

// ---------------------------------------------------------------------------------------- the phones, with no route
function phoneSetup(locked) {
  const dir = tempDir('mvw-phone-lock-');
  const dbs = openDb(dir);
  const calls = [], runs = [];
  const agent = { id: 52, name: 'Max', emoji: '🔧', enabled: true, ownerId: 1 };
  const phone = new Phone({
    dbs, timers: true, locked: () => locked.on,
    agents: { get: id => (id === 52 ? agent : null), isOwner: () => true, canManage: () => true, shares: () => [], listeners: new Set() },
    connections: { get: () => ({ id: 1, kind: 'twilio', enabled: true, config: {} }), canUse: () => true, visible: () => [], secretsFor: () => ({}) },
    host: { call: async (svc, method) => { calls.push(method); throw Object.assign(new Error('no Twilio here'), { code: 'unsupported' }); } },
    chat: { sessions: { create: () => ({ id: 7 }), get: () => ({ id: 7, agentId: 52 }), list: () => [] }, startRun: async (P, o) => { runs.push(o.input); return { runId: `r${runs.length}` }; } },
    notifications: { create: () => {} }, send: () => {}, setting: () => 10,
    principalFor: () => ({ account: { id: 1, login: 'sam', role: 'owner' }, role: 'owner' }),
  });
  const T = Date.now();
  dbs.db.prepare("INSERT INTO accounts (id, world_id, login, display_name, display_key, role, password_hash, password_changed, created, updated) VALUES (1, ?, 'sam', 'Sam', 'sam', 'owner', 'x', ?, ?, ?)").run(dbs.worldId, T, T, T);
  dbs.db.prepare("INSERT INTO phone_lines (world_id, agent_id, connection_id, number, number_sid, session_id, sync_json, created, updated) VALUES (?, 52, 1, '+18885550100', 'PNx', 7, '{\"imported\":true}', ?, ?)").run(dbs.worldId, T, T);
  dbs.db.prepare("INSERT INTO phone_messages (world_id, line_id, sid, direction, peer, body, state, origin, author_id, at, created) VALUES (?, 1, 'SMx', 'in', '+15552010042', 'Are you open?', 'received', 'twilio', NULL, ?, ?)").run(dbs.worldId, T, T);
  return { dbs, phone, calls, runs, done: () => { phone.stop(); dbs.db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('demo mode: a phone makes no Twilio call, does not sync and gives the agent nothing; licensed, it does', async () => {
  const locked = { on: true };
  const x = phoneSetup(locked);
  try {
    await assert.rejects(x.phone.tw({ id: 1, config: {} }, 'send', { from: '+18885550100', to: '+15552010042', body: 'hi' }),
      e => e.code === 'licence_required' && e.status === 403 && /locked in demo mode/.test(e.message));
    await x.phone.tick();
    const line = x.phone.lineView(x.phone.q.line.get(x.dbs.worldId, 1));
    await x.phone.deliver(line);
    assert.deepEqual(x.calls, [], 'no Twilio call at all');
    assert.deepEqual(x.runs, [], 'nothing reached the agent');
    locked.on = false;
    await x.phone.tick();
    assert.ok(x.calls.length > 0, 'licensed: the phone reads its number again');
  } finally { x.done(); }
});

// ---------------------------------------------------------------------------------------- the PC's work, with no route
test('demo mode: a task given to an agent waits, and its work starts once a licence key is active', async () => {
  const dir = tempDir('mvw-pcw-lock-');
  const rows = [{ id: 1, key: 'reva', name: 'Reva', ownerId: 10, connectionId: 7 }, { id: 2, key: 'mo', name: 'Mo', ownerId: 10, connectionId: 7 }];
  const agents = { list: () => rows, get: id => rows.find(a => a.id === Number(id)) || null };
  const pc = new PcOS({ dir, agents, ownerAccount: () => 10 });
  const asked = [];
  const mind = {
    brainOf: () => ({ connection: { id: 7, config: { model: 'm' } }, own: true }), limited: () => null, breakerAllow: () => true, breakerOk() {}, breakerFail() {},
    breakerRelease() {}, pausedText: () => null, costOf: () => 1, record() {},
    completeFn: async () => { asked.push(1); return { text: '{"done":"done it","status":"review"}', usage: { in: 1, out: 1 } }; },
  };
  const locked = { on: true };
  const work = new PcWork({ pc, mind, agents, names: t => t, bus: { emit() {} }, notify() {}, zoneOf: () => 'UTC', locked: () => locked.on });
  const idle = async () => { for (let i = 0; i < 200 && (work.running.size || work.queue.length); i++) await new Promise(r => setTimeout(r, 10)); };
  try {
    const t = pc.createTeam({ human: 10 }, { name: 'Ops' });
    pc.setMember({ human: 10 }, t.id, 1, 'member'); pc.setMember({ human: 10 }, t.id, 2, 'lead');
    pc.addCard({ agent: 2 }, '/teams/ops', { title: 'Write the plan', assignee: 1 });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(work.queue.length, 1, 'queued');
    assert.equal(work.running.size, 0, 'not started in demo mode');
    assert.equal(asked.length, 0, 'its brain was not asked');
    locked.on = false;
    work.pump();
    await idle();
    assert.ok(asked.length > 0, 'licensed: the agent works on it');
  } finally { work.stop(); pc.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------- a real server
let s, owner;
before(async () => {
  s = await startServer({ population: 120, agents: 3, demo: true });
  owner = await ownerSession(s);
});
after(async () => { await s?.stop(); });

const LOCKED = [
  ['GET', '/api/pc', 'pc'], ['GET', '/api/pc/screens', 'pc'], ['POST', '/api/pc/shell', 'pc', { agent: 1, run: 'ls' }], ['GET', '/api/pc/browser?agent=1', 'pc'],
  ['GET', '/api/pc/board?profile=1', 'pc'], ['POST', '/api/pc/watch', 'pc', { agents: [1] }],
  ['GET', '/api/providers/browser?agent=1', 'pc'], ['GET', '/api/providers/screen?agent=1', 'pc'], ['GET', '/api/providers/screen/thumb?agent=1', 'pc'],
  ['GET', '/api/phone/summary', 'phone'], ['GET', '/api/phone?agent=1', 'phone'], ['POST', '/api/phone/send', 'phone', { agent: 1, to: '+15550100', body: 'hi' }],
  ['POST', '/api/phone/dial', 'phone', { agent: 1, to: '+15550100' }], ['GET', '/api/phone/numbers?connection=1', 'phone'],
];

test('demo mode: the server refuses the agents\' PCs, browsers, screens and phones with the licence message', async () => {
  const st = (await owner.get('/api/licence')).json;
  assert.equal(st.mode, 'demo');
  assert.ok(st.locks.includes(LOCKS.pc) && st.locks.includes(LOCKS.phone), 'Settings → License lists them');
  assert.match(st.message, /no agent PCs or phones/);
  for (const [m, p, lock, body] of LOCKED) {
    const r = m === 'GET' ? await owner.get(p) : await owner.post(p, body);
    assert.equal(r.status, 403, `${m} ${p}: ${r.text}`);
    assert.equal(r.json.code, 'licence_required', `${m} ${p}`);
    assert.equal(r.json.error, `${LOCKS[lock]} is locked in demo mode. A licence key unlocks it.`, `${m} ${p}`);
  }
});

test('demo mode: an agent\'s own screen, live, is refused before anything is dialed', async () => {
  const code = await new Promise(resolve => {
    const ws = new WebSocket(`${s.url.replace('http', 'ws')}/api/providers/screen/ws?agent=1`, { headers: { cookie: owner.cookie, origin: s.url } });
    ws.on('unexpected-response', (req, res) => { resolve(res.statusCode); res.resume(); });
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('error', () => {});
  });
  assert.equal(code, 403);
});

test('demo mode: chat and the free features still answer', async () => {
  for (const p of ['/api/world', '/api/people', '/api/roster', '/api/agents', '/api/notifications']) {
    const r = await owner.get(p);
    assert.equal(r.status, 200, `${p}: ${r.status} ${r.text.slice(0, 120)}`);
  }
});

const haveLicence = fs.existsSync(TEST_LICENCE_FILE);
test('a licence key unlocks the PCs and phones at once', { skip: !haveLicence && `no test licence at ${TEST_LICENCE_FILE}` }, async () => {
  const st = await importTestLicence(owner);
  assert.equal(st.active, true);
  const pc = await owner.get('/api/pc');
  assert.equal(pc.status, 200, pc.text);
  assert.ok(Array.isArray(pc.json.agents));
  const ph = await owner.get('/api/phone/summary');
  assert.equal(ph.status, 200, ph.text);
  const scr = await owner.get('/api/providers/screen?agent=1');
  assert.notEqual(scr.json?.code, 'licence_required', 'the screen answers its own way (this agent has none)');
  // never deactivate here: that would free release 1's real activation
});
