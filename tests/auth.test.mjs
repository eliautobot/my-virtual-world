// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Accounts against a throwaway server: first start, what guests, members, admins and the owner may do, CSRF and Origin,
// sign-in rate limits, devices and sessions, the live stream's session guard, task text, and re-authentication.
// CHECKLIST I14.1, I14.2, I14.3, I14.8, I14.14, I14.15, I14.20; DECISIONS C64–C67.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DatabaseSync } from '../server/sqlite.js';
import { createApi } from '../server/routes.js';
import { startServer, httpClient, ownerSession, userSession, strongPassword } from './helpers/server.mjs';

// An agent's task comes from its provider's run (the mock provider, a slow run whose progress says TASK).
const TASK = 'Draft the secret launch plan for the owner';
let s, owner, admin, member, roster;

before(async () => {
  s = await startServer({
    population: 150,
    agents: 3,   // AI-agent residents, so the task-privacy test runs on every machine
    env: { MVW_PROVIDER_TEST: '1', MVW_PROVIDER_RUN_TIMEOUT_MS: '8000', MVW_TRUSTED_PROXIES: '127.0.0.1,::1' },
  });
  owner = await ownerSession(s);
  admin = await userSession(s, owner, { login: 'admin1', displayName: 'Admin One', role: 'admin' });
  member = await userSession(s, owner, { login: 'member1', displayName: 'Member One', role: 'member' });
  roster = (await owner.get('/api/roster')).json.roster;
});
after(async () => {
  await s?.stop();
});

async function waitFor(fn, ms = 5000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await new Promise(r => setTimeout(r, 40));
  }
}
/** A live-stream connection with the client's cookie (none for a guest); collects its text messages. */
function openWs(client) {
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', client && client.cookie ? { headers: { cookie: client.cookie } } : undefined);
  ws.binaryType = 'arraybuffer';
  const msgs = [];
  ws.onmessage = e => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
  const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('WebSocket error')); });
  const closed = new Promise(resolve => { ws.onclose = e => resolve({ code: e.code, reason: e.reason }); });
  return { ws, msgs, opened, closed, next: (pred, ms) => waitFor(() => msgs.find(pred), ms) };
}

test('first start: no account; whoever holds the setup code creates the administrator with their own name and password', async () => {
  const s2 = await startServer({ population: 60 });
  try {
    const file = path.join(s2.data, 'setup-code.txt');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const code = /^Setup code: (\S+)$/m.exec(fs.readFileSync(file, 'utf8'))[1];
    assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    for (let t = 0; t < 60 && !s2.log().includes(`Setup code: ${code}`); t++) await new Promise(r => setTimeout(r, 50));   // (printed just after "listening")
    assert.ok(s2.log().includes(`Setup code: ${code}`), 'the server\'s output shows the code, with how to use it');
    assert.match(s2.log(), /create the administrator account with this one-time setup code/);
    assert.equal(fs.existsSync(path.join(s2.data, 'first-owner-password.txt')), false, 'no temporary owner any more');
    const g = httpClient(s2.url);
    assert.equal((await g.get('/api/auth/me')).json.setup, true);
    assert.equal((await g.post('/api/auth/signin', { login: 'owner', password: 'anything-at-all-123' })).status, 401, 'there is no owner account to sign in to');
    // a restart keeps the code
    await s2.stop({ keepData: true });
    const s3 = await startServer({ data: s2.data, population: 60 });
    try {
      assert.ok(fs.readFileSync(file, 'utf8').includes(code), 'a restart keeps the code');
      const c = httpClient(s3.url), pw = strongPassword();
      const wrong = await c.post('/api/auth/setup', { code: 'ABCD-EFGH', login: 'mira', displayName: 'Mira', password: pw });
      assert.equal(wrong.status, 403); assert.equal(wrong.json.code, 'bad_setup_code');
      const weak = await c.post('/api/auth/setup', { code, login: 'mira', displayName: 'Mira', password: 'short' });
      assert.equal(weak.status, 400); assert.equal(weak.json.code, 'weak_password');
      // the code, written any way (lower case, without the dash): their account, signed in, the owner
      const r = await c.post('/api/auth/setup', { code: code.toLowerCase().replace('-', ' '), login: 'mira', displayName: 'Mira', password: pw });
      assert.equal(r.status, 201, r.text);
      assert.equal(r.json.account.login, 'mira'); assert.equal(r.json.role, 'owner'); assert.equal(r.json.restricted, false); assert.equal(r.json.setup, false);
      assert.equal((await c.post('/api/edit', { ops: [] })).status === 401, false, 'signed in');
      assert.equal(fs.existsSync(file), false, 'the code is used up');
      const again = await httpClient(s3.url).post('/api/auth/setup', { code, login: 'eve', displayName: 'Eve', password: strongPassword() });
      assert.equal(again.status, 409); assert.equal(again.json.code, 'owner_exists');
      assert.equal((await httpClient(s3.url).post('/api/auth/signin', { login: 'mira', password: pw })).status, 200);
    } finally { await s3.stop(); }
  } finally { fs.rmSync(s2.data, { recursive: true, force: true }); fs.rmSync(s2.keyFile, { force: true }); }
});

test('wrong setup codes lock that address out like wrong passwords', async () => {
  const s4 = await startServer({ population: 60 });
  try {
    const c = httpClient(s4.url), pw = strongPassword();
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/setup', { code: `WRNG-000${i}`, login: 'x1', displayName: 'X', password: pw })).status, 403);
    const code = /^Setup code: (\S+)$/m.exec(fs.readFileSync(path.join(s4.data, 'setup-code.txt'), 'utf8'))[1];
    const locked = await c.post('/api/auth/setup', { code, login: 'x1', displayName: 'X', password: pw });
    assert.equal(locked.status, 429, 'locked out even with the right code, for a while');
  } finally { await s4.stop(); }
});

test('guests watch the world and every write answers 401', async () => {
  const g = httpClient(s.url);
  for (const p of ['/api/health', '/api/world', '/api/people', '/api/clock', '/api/agent/0', '/api/roster', '/api/auth/me']) assert.equal((await g.get(p)).status, 200, p);
  const b = (await g.get('/api/world')).json.world.buildings.findIndex(x => x && !x.gone);
  assert.equal((await g.get('/api/building?b=' + b)).status, 200);
  for (const r of createApi({}).router.list()) {
    // routes for connected agents (principal 'agent') take no browser session: their refusals are tested in agent-api-http.test.mjs
    if (r.method !== 'POST' || r.principal === 'agent' || ['/api/auth/signin', '/api/auth/signin/2fa', '/api/auth/register', '/api/auth/setup', '/api/invites/accept', '/api/auth/verify', '/api/auth/forgot', '/api/auth/reset', '/api/auth/oauth/start', '/api/auth/oauth/pending', '/api/auth/oauth/complete'].includes(r.path)) continue;   // (the email links work signed out)
    const res = await g.post(r.path, {});
    assert.equal(res.status, 401, r.path);
    assert.equal(res.json.code, 'signin_required', r.path);
  }
  for (const p of ['/api/users', '/api/permissions', '/api/settings/world', '/api/account/devices', '/api/audit', '/api/invites', '/api/settings/security', '/api/account/2fa', '/api/account/export']) assert.equal((await g.get(p)).status, 401, p);
  const me = (await g.get('/api/auth/me')).json;
  assert.equal(me.account, null);
  assert.equal(me.role, 'guest');
  assert.equal(me.caps['world.view'], true);
  assert.equal(me.caps['world.edit'], false);
  const h = (await g.get('/api/health')).json;
  for (const k of ['clients', 'lastErrors', 'accounts', 'mem']) assert.equal(k in h, false, `health.${k} is admin-only`);
  assert.equal('source' in h.presence, false);
});

test('members talk; admins edit, direct residents and run the clock; only the owner changes permissions', async () => {
  const w = (await owner.get('/api/world')).json.world, b = w.buildings.findIndex(x => x && !x.gone && x.type !== 'hq');
  const edit = (c, name) => c.post('/api/edit', { ops: [{ op: 'bld.set', b, name }], who: 'spoofed' });
  assert.equal((await member.post('/api/talk', { i: 0 })).status, 200);
  assert.equal((await edit(member, 'x')).status, 403);
  assert.equal((await member.post('/api/clock', { rate: 2 })).status, 403);
  assert.equal((await member.post('/api/command', { i: 0, cmd: 'home' })).status, 403);
  assert.equal((await member.get('/api/users')).status, 403);
  const watcher = openWs(null);
  await watcher.opened;
  const r = await edit(admin, 'Renamed by an admin');
  assert.equal(r.status, 200, r.text);
  assert.equal((await owner.get('/api/world')).json.world.buildings[b].name, 'Renamed by an admin');
  const patch = await watcher.next(m => m.t === 'patch');
  assert.equal(patch && patch.who, 'Admin One', 'edits are signed with the display name, not the request body');
  watcher.ws.close();
  assert.equal((await admin.post('/api/command', { i: 0, cmd: 'home' })).status, 200);
  assert.equal((await admin.post('/api/clock', { rate: 1 })).status, 200);
  assert.equal((await admin.get('/api/users')).status, 200);
  assert.equal((await admin.get('/api/permissions')).status, 403);
  assert.equal((await admin.post('/api/permissions', { cap: 'world.edit', min: 'member' })).status, 403);
  assert.equal((await owner.post('/api/permissions', { cap: 'world.edit', min: 'member' })).status, 200);
  assert.equal((await edit(member, 'Renamed by a member')).status, 200);
  assert.equal((await owner.post('/api/permissions', { cap: 'world.edit', min: 'guest' })).status, 400, 'identity capabilities never go to guests');
  assert.equal((await owner.post('/api/permissions', { cap: 'permissions.manage', min: 'admin' })).status, 400);
  assert.equal((await owner.post('/api/permissions', { cap: 'world.edit', min: null })).status, 200);
  assert.equal((await edit(member, 'x')).status, 403);
});

test('admins manage members but never the owner or other admins', async () => {
  const users = (await admin.get('/api/users')).json.users;
  const ownerId = users.find(u => u.role === 'owner').id;
  assert.equal((await admin.post('/api/users/update', { id: ownerId, status: 'disabled' })).status, 403);
  assert.equal((await admin.post('/api/users/update', { id: ownerId, resetPassword: true })).status, 403);
  assert.equal((await admin.post('/api/users', { login: 'admin9', displayName: 'Admin Nine', role: 'admin' })).status, 403);
  const c = await admin.post('/api/users', { login: 'member9', displayName: 'Member Nine' });
  assert.equal(c.status, 201, c.text);
  assert.equal(c.json.user.role, 'member');
  assert.equal((await admin.post('/api/users/update', { id: c.json.user.id, status: 'disabled' })).status, 200);
  const r = await httpClient(s.url).post('/api/auth/signin', { login: 'member9', password: c.json.temporaryPassword });
  assert.equal(r.json.code, 'disabled');
});

test('writes need the CSRF token and a same-site Origin; sign-in needs a secure connection', async () => {
  const body = { i: 0 };
  assert.equal((await member.post('/api/talk', body, { 'x-csrf-token': '' })).json.code, 'csrf');
  assert.equal((await member.post('/api/talk', body, { 'x-csrf-token': 'wrong' })).json.code, 'csrf');
  assert.equal((await member.post('/api/talk', body, { origin: 'https://evil.example' })).json.code, 'bad_origin');
  assert.equal((await member.post('/api/talk', body, { 'sec-fetch-site': 'cross-site' })).json.code, 'bad_origin');
  assert.equal((await member.post('/api/talk', body, { origin: s.url })).status, 200);
  const form = await member.request('POST', '/api/talk', 'i=0', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415, 'only JSON bodies');
  assert.equal(form.json.code, 'unsupported_media_type');
  assert.equal((await httpClient(s.url).post('/api/auth/signin', { login: 'x', password: 'y' }, { origin: 'https://evil.example' })).json.code, 'bad_origin');
  const plain = await httpClient(s.url).post('/api/auth/signin', { login: 'member1', password: member.password }, { 'x-forwarded-for': '198.51.100.3' });
  assert.equal(plain.status, 400, 'proxied plain http');
  assert.equal(plain.json.code, 'https_required');
});

// A request forwarded by the (trusted, loopback) TLS proxy for a client at `ip`.
const fwd = ip => ({ 'x-forwarded-for': ip, 'x-forwarded-proto': 'https' });

test('sign-in is rate limited per client address and per account', async () => {
  const g = httpClient(s.url), ip = fwd('203.0.113.50');
  for (let k = 0; k < 20; k++) {
    const r = await g.post('/api/auth/signin', { login: `nobody${k}`, password: 'wrong-password-1' }, ip);
    assert.equal(r.status, 401, `try ${k + 1}`);
  }
  const r = await g.post('/api/auth/signin', { login: 'member1', password: member.password }, ip);
  assert.equal(r.status, 429);
  assert.equal(r.json.code, 'rate_limited');
  assert.ok(+r.headers.get('retry-after') > 0);
  assert.equal((await g.post('/api/auth/signin', { login: 'nobody', password: 'wrong-password-1' }, fwd('203.0.113.51'))).status, 401, 'another address may still try');
  const acc = await userSession(s, owner, { login: 'locktest', displayName: 'Lock Test' });
  for (let k = 0; k < 5; k++) {
    assert.equal((await g.post('/api/auth/signin', { login: 'locktest', password: 'Wrong-Password-00' }, fwd('198.51.100.10'))).status, 401);
  }
  const l = await g.post('/api/auth/signin', { login: 'locktest', password: acc.password }, fwd('198.51.100.10'));
  assert.equal(l.status, 429, 'the guessing address is locked out of the account');
  assert.equal(l.json.code, 'locked');
  assert.equal((await g.post('/api/auth/signin', { login: 'locktest', password: acc.password }, fwd('198.51.100.11'))).status, 200, 'the owner of the account still signs in from elsewhere');
});

test('the own username can be changed, with a recent password entry', async () => {
  const u = await userSession(s, owner, { login: 'rename1', displayName: 'Rename One' });
  assert.equal((await u.post('/api/account/login', { login: 'member1' })).status, 409, 'taken');
  assert.equal((await u.post('/api/account/login', { login: 'x' })).status, 400);
  const r = await u.post('/api/account/login', { login: 'Renamed-One' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.account.login, 'renamed-one');
  assert.equal((await httpClient(s.url).post('/api/auth/signin', { login: 'rename1', password: u.password })).status, 401);
  assert.equal((await httpClient(s.url).post('/api/auth/signin', { login: 'renamed-one', password: u.password })).status, 200);
});

test('live-stream connections are limited per client address', async () => {
  const s2 = await startServer({ population: 60, env: { MVW_WS_PER_ADDRESS: '3', MVW_TRUSTED_PROXIES: '127.0.0.1,::1' } });
  const open = headers => new Promise(resolve => {
    const ws = new WebSocket(s2.url.replace(/^http/, 'ws') + '/ws', { headers });
    ws.onmessage = e => { if (typeof e.data === 'string' && JSON.parse(e.data).t === 'hello') resolve({ ws, ok: true }); };
    ws.onerror = () => resolve({ ws, ok: false });
  });
  const socks = [];
  try {
    for (let k = 0; k < 3; k++) socks.push(await open(fwd('203.0.113.60')));
    assert.ok(socks.every(x => x.ok), 'three from one address');
    const fourth = await open(fwd('203.0.113.60'));
    socks.push(fourth);
    assert.equal(fourth.ok, false, 'the fourth is refused');
    const other = await open(fwd('203.0.113.61'));
    socks.push(other);
    assert.equal(other.ok, true, 'other addresses still connect');
  } finally {
    for (const x of socks) try { x.ws.close(); } catch { /* closed */ }
    await s2.stop();
  }
});

// How the client address is derived is covered in permissions.test.mjs; here: the server believes no forwarded header.
test('without trusted proxies, forwarded headers are not believed', async () => {
  const s2 = await startServer({ population: 60, env: { MVW_TRUSTED_PROXIES: 'none' } });
  try {
    const g = httpClient(s2.url);
    assert.equal((await g.get('/api/auth/me', fwd('203.0.113.7'))).json.secure, false, 'a forwarded https scheme is not believed');
    const r = await g.post('/api/auth/signin', { login: 'owner', password: 'wrong-password-1' }, fwd('203.0.113.7'));
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'https_required');
    assert.equal((await g.post('/api/auth/signin', { login: 'owner', password: 'wrong-password-1' })).status, 401, 'direct loopback requests still work');
    assert.equal((await httpClient(s.url).get('/api/auth/me', fwd('203.0.113.7'))).json.secure, true, 'with the default trusted loopback proxy it is');
  } finally { await s2.stop(); }
});

test('task text reaches only the owner: people, roster, agent details, live presence; spoken lines never quote it', async t => {
  if (!roster.length) return t.skip('this installation has no AI-agent residents');
  const a = roster[0];
  const wo = openWs(owner), wg = openWs(null);
  await Promise.all([wo.opened, wg.opened]);
  await Promise.all([wo.next(m => m.t === 'hello'), wg.next(m => m.t === 'hello')]);
  // the agent works on a run of the mock provider; its progress is the task text
  const rec = (await owner.get('/api/agents')).json.agents.find(x => x.key === a.agentId);
  const conn = await owner.post('/api/connections', { kind: 'mock', label: 'Task mock', scope: 'installation', config: {}, secrets: { token: 'tok-TASK-1' } });
  assert.equal(conn.status, 200, conn.text);
  assert.equal((await owner.post('/api/agents/update', { id: rec.id, connectionId: conn.json.id })).status, 200);
  const sess = (await owner.post('/api/chat-sessions/create', { agent: rec.id, label: 'Task' })).json.session;
  const run = await owner.post('/api/providers/runs', { agent: rec.id, session: sess.id, input: `slow:6000:${TASK}` });
  assert.equal(run.status, 200, run.text);
  try {
    const po = await wo.next(m => m.t === 'presence' && m.id === a.agentId && m.info.working);
    const pg = await wg.next(m => m.t === 'presence' && m.id === a.agentId && m.info.working);
    assert.ok(po && pg, 'both streams heard the presence change');
    assert.equal('task' in po.info, true, 'the owner\'s frame carries the task field');
    assert.equal(pg.info.working, true);
    assert.equal('task' in pg.info, false, 'a guest\'s frame has no task');
    const has = r => r.text.includes(TASK);
    assert.ok(await waitFor(async () => has(await owner.get('/api/people')), 6000), 'the task reached the owner');
    for (const p of ['/api/people', '/api/roster', `/api/agent/${a.i}`]) {
      assert.equal(has(await owner.get(p)), true, `owner ${p}`);
      for (const c of [httpClient(s.url), member, admin]) assert.equal(has(await c.get(p)), false, `${c.login || 'guest'} ${p}`);
    }
    assert.deepEqual((await httpClient(s.url).get('/api/people')).json.presence[a.agentId], { working: true, state: 'working' });
    const line = await member.post('/api/talk', { i: a.i });
    assert.equal(line.status, 200);
    assert.equal(line.text.includes(TASK), false);
  } finally {
    if (run.json?.run) await owner.post('/api/providers/interrupt', { run: run.json.run.id ?? run.json.run }).catch(() => {});
    wo.ws.close();
    wg.ws.close();
  }
});

test('admins can require sign-in to watch: guests get 401 and their live stream closes', async () => {
  const wg = openWs(null);
  await wg.opened;
  await wg.next(m => m.t === 'hello');
  const r = await admin.post('/api/settings/world', { requireSignIn: true });
  assert.equal(r.status, 200, r.text);
  try {
    assert.equal((await wg.closed).code, 4401);
    assert.ok(wg.msgs.some(m => m.t === 'auth' && m.state === 'signin_required'));
    const g = httpClient(s.url);
    assert.equal((await g.get('/api/world')).status, 401);
    assert.equal((await g.get('/api/health')).status, 200, 'health stays public for monitors');
    assert.equal((await member.get('/api/world')).status, 200);
    const late = openWs(null);
    assert.equal((await late.closed).code, 4401);
  } finally {
    assert.equal((await admin.post('/api/settings/world', { requireSignIn: false })).status, 200);
  }
  assert.equal((await httpClient(s.url).get('/api/world')).status, 200);
});

test('devices: list, sign out one, sign out everywhere; a revoked session drops its live stream to guest', async () => {
  const u = await userSession(s, owner, { login: 'devices1', displayName: 'Devices One' });
  const second = httpClient(s.url);
  await second.signIn('devices1', u.password);
  const list = (await u.get('/api/account/devices')).json.devices;
  assert.equal(list.length, 2);
  assert.equal(list.filter(d => d.current).length, 1);
  const ws = openWs(second);
  await ws.opened;
  assert.equal((await ws.next(m => m.t === 'hello')).role, 'member');
  assert.equal((await u.post('/api/account/devices/revoke', { id: list.find(d => !d.current).id })).status, 200);
  assert.ok(await ws.next(m => m.t === 'session' && m.state === 'ended'), 'the stream hears that its session ended');
  assert.equal(ws.ws.readyState, 1, 'and keeps showing the world as a guest');
  ws.ws.close();
  const dead = await second.get('/api/account/devices');
  assert.equal(dead.status, 401);
  assert.match(dead.headers.get('set-cookie') || '', /Max-Age=0/, 'the dead cookie is cleared');
  const third = httpClient(s.url);
  await third.signIn('devices1', u.password);
  const npw = strongPassword();
  assert.equal((await u.post('/api/account/password', { current: u.password, password: npw })).status, 200);
  assert.equal((await third.get('/api/account/devices')).status, 401, 'a password change signs out the other devices');
  assert.equal((await u.get('/api/account/devices')).status, 200, 'but not the one that changed it');
  const fourth = httpClient(s.url);
  await fourth.signIn('devices1', npw);
  assert.equal((await u.post('/api/auth/signout', { everywhere: true })).status, 200);
  assert.equal((await fourth.get('/api/account/devices')).status, 401);
  assert.equal((await u.get('/api/account/devices')).status, 401);
  const f = httpClient(s.url);
  await f.signIn('devices1', npw);
  assert.equal((await f.post('/api/account/name', { displayName: 'Admin One' })).status, 409, 'display names are unique');
  const n = await f.post('/api/account/name', { displayName: 'Dev Ice' });
  assert.equal(n.status, 200);
  assert.equal(n.json.account.displayName, 'Dev Ice');
});

test('destructive edits and account changes need a password entry within the last 10 minutes', async () => {
  const db = new DatabaseSync(path.join(s.data, 'next.db'), { timeout: 5000 });
  const age = login => db.prepare('UPDATE sessions SET auth_at = auth_at - 660000 WHERE account_id = (SELECT id FROM accounts WHERE login = ?)').run(login);
  try {
    const w = (await admin.get('/api/world')).json.world;
    const B = w.buildings.find(x => x && !x.gone && x.type !== 'hq' && x.type !== 'park' && x.floors > 2);
    age('admin1');
    const cut = await admin.post('/api/edit', { ops: [{ op: 'bld.floors', b: B.idx, floors: B.floors - 1 }] });
    assert.equal(cut.status, 403);
    assert.equal(cut.json.code, 'reauth_required');
    assert.equal((await admin.post('/api/edit', { ops: [{ op: 'bld.set', b: B.idx, name: 'Still editable' }] })).status, 200, 'ordinary edits need only the session');
    assert.equal((await admin.post('/api/users', { login: 'member7', displayName: 'Member Seven' })).json.code, 'reauth_required');
    assert.equal((await admin.post('/api/auth/reauth', { password: 'Wrong-Password-00' })).status, 403);
    assert.equal((await admin.post('/api/auth/reauth', { password: admin.password })).status, 200);
    const r = await admin.post('/api/edit', { ops: [{ op: 'bld.floors', b: B.idx, floors: B.floors - 1 }] });
    assert.equal(r.status, 200, r.text);
    assert.equal((await admin.get('/api/world')).json.world.buildings[B.idx].floors, B.floors - 1);
  } finally { db.close(); }
});

test('HTTPS through a trusted proxy carries Strict-Transport-Security; plain HTTP does not', async () => {
  const via = proto => fetch(s.url + '/', { headers: { 'x-forwarded-proto': proto, 'x-forwarded-for': '203.0.113.70' } });
  assert.equal((await via('https')).headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal((await via('http')).headers.get('strict-transport-security'), null);
  assert.equal((await fetch(s.url + '/api/health', { headers: { 'x-forwarded-proto': 'https' } })).headers.get('strict-transport-security'), 'max-age=31536000', 'API answers too');
});
