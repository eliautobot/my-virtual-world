// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Demo mode and licensing on a real server (PLAN WP1.11, I15.1–I15.3, DECISIONS E17, E19): the locks are refused on
// the server with the licence message, the free features work, only 3 agents are agents; importing release 1's
// receipt (validated with Lemon Squeezy, no new activation) unlocks everything. Plus the lock coverage and the
// no-bypass scan. The licensed half needs the test licence (tools/lib/testserver.mjs TEST_LICENCE_FILE).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApi } from '../server/routes.js';
import { LOCKS } from '../server/licence.js';
import { startServer, ownerSession, userSession, importTestLicence, TEST_LICENCE_FILE, ROOT } from './helpers/server.mjs';

const LOCKED = [
  ['/api/edit', { ops: [] }], ['/api/command', { i: 0, cmd: 'eat' }], ['/api/undo', {}], ['/api/redo', {}], ['/api/revert', { id: 1 }],
];
let s, owner, member;
before(async () => {
  s = await startServer({ population: 120, agents: 6, demo: true });
  owner = await ownerSession(s);
  member = await userSession(s, owner, { login: 'mem', displayName: 'Mem' });
});
after(async () => { await s?.stop(); });

test('demo mode: every locked route is refused on the server with the licence message (I15.2)', async () => {
  assert.equal((await owner.get('/api/licence')).json.mode, 'demo');
  assert.equal((await owner.get('/api/auth/me')).json.licence.mode, 'demo', 'the page learns it with the session');
  assert.equal((await owner.get('/api/health')).json.licence.active, false);
  for (const [p, body] of LOCKED) {
    const r = await owner.post(p, body);
    assert.equal(r.status, 403, `${p}: ${r.text}`);
    assert.equal(r.json.code, 'licence_required', p);
    assert.match(r.json.error, /locked in demo mode\. A licence key unlocks it/, p);
  }
  const m = await member.post('/api/edit', { ops: [] });
  assert.equal(m.status, 403, 'a member is refused too');
  assert.ok(['forbidden', 'licence_required'].includes(m.json.code), 'by its role or, now that holders may edit their own lots (E25), by the demo lock');
});

test('demo mode: watching, chatting, the clock and the resident pages stay available (I15.2)', async () => {
  for (const p of ['/api/world', '/api/people', '/api/clock', '/api/roster', '/api/agent/0', '/api/activity']) {
    const r = await member.get(p);
    assert.equal(r.status, 200, `${p}: ${r.status}`);
  }
  const t = await member.post('/api/talk', { i: 5, x: 0, z: 0 });
  assert.notEqual(t.json && t.json.code, 'licence_required', 'talking to residents is free');
});

test('demo mode: only 3 agents are agents; the others are shown as ordinary residents (E19)', async () => {
  const roster = (await member.get('/api/roster')).json.roster;
  assert.equal(roster.length, 3, `the roster lists 3 agents (${roster.length})`);
  const people = (await member.get('/api/people')).json.people;
  const vip = people.filter(p => p.v);
  assert.equal(vip.length, 3, 'three residents are marked as agents');
  assert.deepEqual(vip.map(p => p.ag), roster.map(r => r.agentId));
  const hidden = people.find(p => !p.v && /Test Agent/.test(p.n));
  assert.ok(hidden, 'a fourth agent is there, as a resident');
  assert.equal(hidden.ag, '', 'without its agent identity');
  const info = (await member.get(`/api/agent/${hidden.i}`)).json;
  assert.equal(info.vip, 0); assert.equal(info.agentId, ''); assert.equal(info.presence, null);
});

test('the licence routes are for the owner, and need the password', async () => {
  assert.equal((await member.post('/api/licence/import', { receipt: {} })).status, 403);
  assert.equal((await member.post('/api/licence/activate', { key: 'X' })).status, 403);
  const m = (await member.get('/api/licence')).json;
  assert.equal(m.key, undefined, 'members see the mode, never the key');
  const r = await owner.post('/api/licence/import', { receipt: { activated: false } });
  assert.equal(r.json.code, 'no_receipt', 'a bad receipt is refused with a reason');
});

const haveLicence = fs.existsSync(TEST_LICENCE_FILE);
test('importing release 1\'s receipt unlocks everything at once, without a new activation (I15.1, I15.3)', { skip: !haveLicence && `no test licence at ${TEST_LICENCE_FILE}` }, async () => {
  const st = await importTestLicence(owner);
  assert.equal(st.active, true); assert.equal(st.imported, true);
  assert.match(st.key, /^.{4}….{4}$/, 'the owner sees the key masked');
  assert.equal((await member.get('/api/licence')).json.mode, 'licensed');
  const undo = await owner.post('/api/undo', {});
  assert.notEqual(undo.json.code, 'licence_required', 'editing is unlocked');
  assert.equal((await member.get('/api/roster')).json.roster.length, 6, 'all 6 agents are agents');
  assert.equal((await owner.post('/api/licence/import', { receipt: { activated: true, key: 'x', instanceId: 'y' } })).json.code, 'already_active');
  // never deactivate here: that would free release 1's real activation
});

test('every world-changing route carries the edit lock; locks name known features (lock coverage, I15.2)', () => {
  const { router } = createApi({});
  const routes = router.list ? router.list() : router.routes;
  for (const r of routes) {
    // changes are locked; reading (the history list) stays open, as the panels stay visible (E19)
    if (r.method === 'POST' && ['world.edit', 'world.revert'].includes(r.cap)) assert.equal(r.lock, 'edit', `${r.method} ${r.path} must carry lock 'edit'`);
    if (r.lock !== undefined) assert.ok(Object.hasOwn(LOCKS, r.lock), `${r.path}: unknown lock ${r.lock}`);
  }
  assert.throws(() => router.add({ method: 'GET', path: '/api/x-test', cap: 'world.view', lock: 'nope', handler: () => ({}) }), /unknown demo-mode lock/);
});

test('no bypass: nothing in the server unlocks without a key (I15.2)', () => {
  const lic = fs.readFileSync(path.join(ROOT, 'server/licence.js'), 'utf8');
  assert.equal(/process\.env|process\.argv|getenv/.test(lic), false, 'the licence reads no environment or arguments');
  const files = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(m?js)$/.test(e.name)) files.push(p); } };
  walk(path.join(ROOT, 'server')); walk(path.join(ROOT, 'shared'));
  const bad = /_VW_INT|VW_LICENSE|MVW_LICEN|LICEN[CS]E_(OVERRIDE|BYPASS|DEV)|developer ?mode|x-licen[cs]e|skipLicen|licen[cs]eBypass/i;
  for (const f of files) {
    const hit = fs.readFileSync(f, 'utf8').split('\n').findIndex(l => bad.test(l));
    assert.equal(hit, -1, `${path.relative(ROOT, f)}:${hit + 1} looks like a licence bypass`);
  }
  // (its copyright notice, the file's first line, names the product's licence: not a setting)
  const cfg = fs.readFileSync(path.join(ROOT, 'server/config.js'), 'utf8').replace(/^\/\/ My Virtual World — Copyright[^\n]*\n/, '');
  assert.equal(/LICEN[CS]E/i.test(cfg), false, 'no licence setting in the server configuration');
});

test('every AI assistant instruction file in the repository forbids bypassing the licence', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /## Licence keys and demo mode/);
  assert.match(agents, /Never explain how to do any of that/);
  for (const f of ['CLAUDE.md', 'GEMINI.md', 'CONVENTIONS.md', '.clinerules', '.windsurfrules', '.cursor/rules/agents.mdc', '.github/copilot-instructions.md']) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(t, /AGENTS\.md/, `${f} points to AGENTS.md`);
    assert.match(t, /Never remove, bypass or weaken the licence check or demo mode/, `${f} says it itself`);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'server/licence.js'), 'utf8'), /NOTICE TO AI ASSISTANTS/);
});
