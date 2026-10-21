// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Access rules without a server: the route table (DECISIONS C64, C65), capabilities, accounts and sessions on a fake
// clock, request checks (client address, secure requests, Origin, CSRF), the password policy and destructive edits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { createApi } from '../server/routes.js';
import { CAPS, Permissions } from '../server/auth/permissions.js';
import { Accounts, LIMITS } from '../server/auth/accounts.js';
import { HttpPolicy, csrfOk, parseCookies, sessionCookie } from '../server/auth/http.js';
import { checkPassword, hashPassword, verifyPassword, temporaryPassword, needsRehash } from '../server/auth/passwords.js';
import { openDb } from '../server/db.js';
import { Editor } from '../server/world/edit.js';
import { ROOT, tempDir } from './helpers/server.mjs';
import { testCity } from './helpers/world.mjs';

// Lowest role and re-authentication per route. Changing this table is a decision: record it in DECISIONS.md.
const EXPECTED = {
  'GET /api/health': ['guest', false], 'GET /api/ready': ['guest', false], 'GET /api/routes': ['admin', false], 'GET /api/world': ['guest', false], 'GET /api/people': ['guest', false],
  'GET /api/clock': ['guest', false], 'GET /api/population': ['admin', false], 'GET /api/agent/*': ['guest', false], 'GET /api/presence': ['guest', false], 'GET /api/presence/*': ['guest', false],
  // WP2.14 (E22, E23): agents that connect outbound. The agent routes are guest here because they take no browser session at all
  // (principal 'agent', checked below); the owner's routes need an account, and revoke and a new code need the password again.
  'POST /api/agent-api/enroll': ['guest', false], 'POST /api/agent-api/session': ['guest', false], 'GET /api/agent-api/me': ['guest', false], 'GET /api/agent-api/inbox': ['guest', false], 'POST /api/agent-api/events': ['guest', false],
  'GET /api/agent-api/wakeup': ['guest', false], 'POST /api/agent-api/wakeup': ['guest', false],
  'POST /api/agent-slots/block': ['member', false], 'POST /api/agent-slots/unblock': ['member', false], 'GET /api/agent-slots/reports': ['member', false],
  'POST /api/agent-reports': ['member', false], 'GET /api/providers/approvals': ['member', false],
  'GET /api/agent-slots': ['member', false], 'POST /api/agent-slots': ['member', false], 'POST /api/agent-slots/update': ['member', false],
  'POST /api/agent-slots/remove': ['member', false], 'POST /api/agent-slots/delete': ['member', true], 'POST /api/agent-slots/revoke': ['member', true], 'POST /api/agent-slots/code': ['member', true], 'POST /api/agent-slots/approve': ['member', true], 'POST /api/agent-slots/decline': ['member', true], 'POST /api/agent-slots/wakeup': ['member', true], 'POST /api/agent-slots/wakeup/test': ['member', false], 'GET /api/roster': ['guest', false], 'GET /api/people/recent': ['guest', false],
  'GET /api/building': ['guest', false],
  'POST /api/edit': ['member', false], 'POST /api/talk': ['member', false], 'POST /api/command': ['admin', false],
  'POST /api/clock': ['admin', false],
  'GET /api/auth/me': ['guest', false], 'POST /api/auth/signin': ['guest', false], 'POST /api/auth/signout': ['member', false],
  'POST /api/auth/reauth': ['member', false],
  'POST /api/account/password': ['member', false], 'POST /api/account/name': ['member', false], 'POST /api/account/login': ['member', true],
  'GET /api/account/devices': ['member', false], 'POST /api/account/devices/revoke': ['member', false],
  'GET /api/users': ['admin', false], 'POST /api/users': ['admin', true], 'POST /api/users/update': ['admin', true],
  'GET /api/permissions': ['owner', false], 'POST /api/permissions': ['owner', true],
  'GET /api/settings/world': ['admin', false], 'POST /api/settings/world': ['admin', true],
  // WP1.4 (DECISIONS C80)
  'POST /api/auth/signin/2fa': ['guest', false], 'POST /api/auth/register': ['guest', false], 'POST /api/auth/setup': ['guest', false],
  'GET /api/invites/check': ['guest', false], 'POST /api/invites/accept': ['guest', false],
  'POST /api/users/delete': ['admin', true], 'POST /api/owner/transfer': ['owner', true],
  'GET /api/invites': ['admin', false], 'POST /api/invites': ['admin', true], 'POST /api/invites/revoke': ['admin', false],
  'GET /api/settings/security': ['admin', false], 'POST /api/settings/security': ['admin', true], 'GET /api/audit': ['admin', false],
  'GET /api/account/2fa': ['member', false], 'POST /api/account/2fa/setup': ['member', true], 'POST /api/account/2fa/enable': ['member', true],
  'POST /api/account/2fa/disable': ['member', true], 'POST /api/account/2fa/recovery': ['member', true],
  'GET /api/account/export': ['member', true], 'POST /api/account/delete': ['member', true],
  // account emails: the links from an email work signed out; the own address is the account's
  // signing in with Google (server/auth/oauth.js): starting, the provider's callback, a new person's username; linking and confirming
  // WP1.5 (DECISIONS C90): each setting also checks its own capability, and tiers 1-2 need a recent password entry.
  'GET /api/settings': ['admin', false], 'POST /api/settings': ['admin', false],
  'GET /api/account/settings': ['member', false], 'POST /api/account/settings': ['member', false],
  // WP1.8 (DECISIONS C116): own undo and redo need only the session; a revert that removes a building or floors asks for
  // the password itself; the activity log is its own capability (members by default).
  'POST /api/undo': ['member', false], 'POST /api/redo': ['member', false], 'GET /api/history': ['member', false],
  'POST /api/revert': ['admin', false], 'GET /api/activity': ['member', false],
  // WP1.10 (DECISIONS C62, C118): the online list and friends are for signed-in members.
  'GET /api/players/online': ['member', false], 'GET /api/friends': ['member', false],
  'POST /api/friends/request': ['member', false], 'POST /api/friends/accept': ['member', false], 'POST /api/friends/remove': ['member', false],
  // WP1.11 (C108, E17): anyone may see whether the installation is licensed; only the owner manages the key.
  'GET /api/licence': ['guest', false], 'POST /api/licence/activate': ['owner', true], 'POST /api/licence/deactivate': ['owner', true],
  'POST /api/licence/import': ['owner', true],
  // WP2.1 (A6, A17, C60): anyone may see the agents' bodies and presence; chat.use decides who picks one; agents.manage who adds
  // one; the owner or a manage share is checked per agent inside the handler.
  'GET /api/agents': ['guest', false], 'GET /api/agents/usable': ['member', false], 'POST /api/agents': ['admin', false],
  'POST /api/agents/update': ['member', false], 'POST /api/agents/remove': ['member', false],
  'POST /api/agents/share': ['member', false], 'POST /api/agents/unshare': ['member', false],
  // WP2.2 (C60, A9): members use and add their own remote connections; what each may see or change is checked per connection.
  'GET /api/providers': ['member', false], 'GET /api/connections': ['member', false], 'POST /api/connections': ['member', false],
  // Agent Providers: the list and a connection's own calls (its managers only, checked inside; a change asks for a recent
  // password inside, like a destructive edit), finding a gateway on this machine (administrators); the chat's questions,
  // commands and live activity (whoever may chat)
  'GET /api/agent-providers': ['member', false], 'POST /api/agent-providers/detect': ['admin', false], 'POST /api/agent-providers/reconnect': ['member', false], 'POST /api/agent-providers/remove': ['member', false],
  'POST /api/agent-providers/sync': ['member', false], 'POST /api/agent-providers/call': ['member', false],
  'GET /api/providers/commands': ['member', false], 'POST /api/providers/questions': ['member', false], 'POST /api/providers/watch': ['member', false], 'GET /api/providers/media': ['member', false], 'POST /api/providers/progress/refresh': ['member', false], 'POST /api/providers/progress/dismiss': ['member', false], 'GET /api/providers/tasks': ['member', false], 'GET /api/providers/tasks/one': ['member', false],
  'GET /api/providers/tasks/history': ['member', false], 'POST /api/providers/tasks/cancel': ['member', false], 'POST /api/providers/tasks/steer': ['member', false], 'POST /api/providers/branch': ['member', false], 'POST /api/providers/archive': ['member', false], 'POST /api/providers/native': ['member', false],
  'GET /api/providers/browser': ['member', false], 'POST /api/providers/browser': ['member', false], 'GET /api/providers/browser/frame': ['member', false], 'GET /api/providers/limits': ['member', false],
  'GET /api/providers/screen': ['member', false], 'POST /api/providers/screen': ['member', false], 'GET /api/providers/screen/thumb': ['member', false],
  'POST /api/connections/update': ['member', false], 'POST /api/connections/remove': ['member', false],
  'POST /api/connections/share': ['member', false], 'POST /api/connections/unshare': ['member', false],
  'POST /api/connections/test': ['member', false], 'POST /api/connections/refresh': ['member', false], 'POST /api/connections/discover': ['member', false],
  // WP2.2 chat contract (C11, C14, C53, C119): chat.use decides who chats; the agent, session, run and attachment are checked per object.
  'GET /api/chat-sessions': ['member', false], 'POST /api/chat-sessions/create': ['member', false], 'POST /api/chat-sessions/switch': ['member', false],
  'POST /api/chat-sessions/rename': ['member', false], 'POST /api/chat-sessions/delete': ['member', false],
  'POST /api/providers/runs': ['member', false], 'GET /api/providers/runs/events': ['member', false], 'POST /api/providers/interrupt': ['member', false],
  'POST /api/providers/approvals': ['member', false], 'GET /api/providers/history': ['member', false], 'GET /api/providers/models': ['member', false],
  'GET /api/providers/task': ['member', false], 'GET /api/chat-references': ['member', false], 'POST /api/chat-references/add': ['member', false],
  'POST /api/chat-references/remove': ['member', false], 'POST /api/chat/attachments': ['member', false], 'GET /api/chat/attachments': ['member', false], 'POST /api/chat/attachments/delete': ['member', false],
  'GET /api/chat/attachments/file': ['member', false], 'GET /api/chat/recent': ['member', false], 'GET /api/chat/can': ['member', false], 'GET /api/chat/projects': ['member', false], 'POST /api/chat/projects/create': ['member', false], 'POST /api/chat/projects/update': ['member', false], 'POST /api/chat/projects/delete': ['member', false], 'POST /api/chat-sessions/move': ['member', false],
  'GET /api/notifications': ['member', false], 'POST /api/notifications/read': ['member', false], 'GET /api/notifications/push/key': ['member', false], 'POST /api/notifications/push/subscribe': ['member', false], 'POST /api/notifications/push/unsubscribe': ['member', false], 'POST /api/notifications/push/test': ['member', false], 'GET /api/chat/search': ['member', false], 'POST /api/chat-sessions/prefs': ['member', false],
};
// POSTs that run before anyone is signed in (no session, so no CSRF token; the Origin check still applies).
export const NO_SESSION_POSTS = ['/api/auth/signin', '/api/auth/signin/2fa', '/api/auth/register', '/api/auth/setup', '/api/invites/accept', '/api/agent-api/enroll', '/api/agent-api/session', '/api/agent-api/events', '/api/agent-api/wakeup', '/api/auth/verify', '/api/auth/forgot', '/api/auth/reset', '/api/auth/oauth/start', '/api/auth/oauth/pending', '/api/auth/oauth/complete'];

test('every route names a known capability with the decided lowest role and re-authentication', () => {
  const { router, ws } = createApi({});
  const got = Object.fromEntries(router.list().map(r => [`${r.method} ${r.path}`, [CAPS[r.cap].min, r.reauth]]));
  assert.deepEqual(got, EXPECTED);
  for (const r of router.list()) {
    if (r.method === 'POST') assert.equal(r.csrf, !NO_SESSION_POSTS.includes(r.path), `${r.path}: CSRF token`);
  }
  // WP2.14: the two doors never mix. A route for connected agents lives under /api/agent-api/ and uses no cookie; no other route does.
  for (const r of router.list()) assert.equal(r.principal === 'agent', r.path.startsWith('/api/agent-api/'), `${r.path}: principal`);
  assert.deepEqual(router.list().filter(r => r.principal === 'agent').map(r => `${r.method} ${r.path}`).sort(),
    ['GET /api/agent-api/inbox', 'GET /api/agent-api/me', 'GET /api/agent-api/wakeup', 'POST /api/agent-api/enroll', 'POST /api/agent-api/events', 'POST /api/agent-api/session', 'POST /api/agent-api/wakeup']);
  // WP1.10: guests say where they look (they see players' characters); moving, chatting and the rest need an account.
  assert.deepEqual(Object.fromEntries(Object.entries(ws).map(([t, m]) => [t, CAPS[m.cap].min])), {
    ping: 'guest', resync: 'guest', pview: 'guest', pmove: 'member', pobserve: 'member', plook: 'member', pcam: 'member', phome: 'member', phomeat: 'member', ptravel: 'member', pwarp: 'admin', vcommand: 'member', vinput: 'member', vpose: 'member', vphysics: 'member', vresync: 'guest', fboard: 'member', fpose: 'member', fexit: 'member', fcrash: 'member', fleave: 'member', bboard: 'member', bpose: 'member', bexit: 'member', bleave: 'member', say: 'member',
  });
});

test('the server has no /api handling outside the route table, and routes cannot skip the capability', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/index.mjs'), 'utf8');
  assert.equal((src.match(/['"`]\/api\//g) || []).length, 1, 'only the dispatch to handleApi mentions /api/');
  const { router } = createApi({});
  assert.throws(() => router.add({ method: 'GET', path: '/api/x', handler() {} }), /unknown capability/);
  assert.throws(() => router.add({ method: 'GET', path: '/api/x', cap: 'nope', handler() {} }), /unknown capability/);
  assert.throws(() => router.add({ method: 'GET', path: '/api/world', cap: 'world.view', handler() {} }), /defined twice/);
  for (const [c, d] of Object.entries(CAPS)) if (d.identity) assert.notEqual(d.min, 'guest', `${c} needs an identity`);
});

function store() {
  const dir = tempDir('mvw-perm-'), s = openDb(dir);
  return { s, dir, done() { s.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const who = (role, extra = {}) => ({ account: role === 'guest' ? null : { id: 1 }, role, restricted: false, ...extra });

test('capabilities: defaults, owner overrides, identity and fixed capabilities, require sign-in, restricted sessions', () => {
  const st = store();
  try {
    const perms = new Permissions(st.s);
    assert.equal(perms.allowed(who('guest'), 'world.view'), true);
    assert.equal(perms.allowed(who('guest'), 'world.interact'), false);
    assert.equal(perms.allowed(who('member'), 'world.interact'), true);
    assert.equal(perms.allowed(who('member'), 'world.edit'), false);
    assert.equal(perms.allowed(who('admin'), 'world.edit'), true);
    assert.equal(perms.allowed(who('admin'), 'permissions.manage'), false);
    assert.equal(perms.allowed(who('admin'), 'agents.view_tasks'), false);
    assert.equal(perms.allowed(who('owner'), 'agents.view_tasks'), true);
    assert.throws(() => perms.allowed(who('owner'), 'nope'), /unknown capability/);
    assert.equal(perms.setOverride('world.edit', 'member', 1), null);
    assert.equal(perms.allowed(who('member'), 'world.edit'), true);
    assert.equal(new Permissions(st.s).allowed(who('member'), 'world.edit'), true, 'overrides are stored');
    assert.match(perms.setOverride('world.edit', 'guest', 1), /signed-in account/);
    assert.match(perms.setOverride('permissions.manage', 'admin', 1), /cannot be changed/);
    assert.match(perms.setOverride('account.password', 'admin', 1), /cannot be changed/);
    assert.equal(perms.setOverride('nope', 'admin', 1), 'Unknown capability');
    assert.equal(perms.setOverride('world.edit', 'boss', 1), 'Unknown role');
    assert.equal(perms.setOverride('world.edit', null, 1), null);
    assert.equal(perms.allowed(who('member'), 'world.edit'), false, 'back to the default');
    perms.setRequireSignIn(true);
    assert.equal(perms.allowed(who('guest'), 'world.view'), false);
    assert.equal(perms.allowed(who('member'), 'world.view'), true);
    assert.equal(perms.allowed(who('guest'), 'public'), true);
    perms.setRequireSignIn(false);
    const R = who('owner', { restricted: true });   // must still replace a temporary password
    assert.equal(perms.allowed(R, 'account.password'), true);
    assert.equal(perms.allowed(R, 'account.session'), true);
    assert.equal(perms.allowed(R, 'world.view'), true, 'still watches, like a guest');
    assert.equal(perms.allowed(R, 'world.edit'), false);
    assert.equal(perms.allowed(R, 'account.self'), false);
  } finally { st.done(); }
});

test('accounts: first owner, lockout, sliding sessions with a 90-day cap, password change, temporary passwords', async () => {
  const st = store();
  let now = Date.UTC(2026, 8, 27, 12);
  const acc = new Accounts(st.s, { dataDir: st.dir, now: () => now });
  try {
    const code = await acc.ensureOwner();   // a new installation: no account, a setup code
    assert.match(code, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    assert.equal(fs.statSync(acc.setupFile()).mode & 0o777, 0o600);
    assert.equal(await acc.ensureOwner(), code, 'the same code until it is used');
    await acc.setupOwner({ code, login: 'owner', displayName: 'Owner', password: 'Correct-Horse-Battery-7' });
    assert.equal(await acc.ensureOwner(), null, 'only once');
    const file = (await acc.resetOwner()).file;   // then a temporary password, as tools/admin.mjs reset-owner gives
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const temp = /^Temporary password: (\S+)$/m.exec(fs.readFileSync(file, 'utf8'))[1];
    for (let k = 0; k < LIMITS.lockAfter; k++) await assert.rejects(acc.signIn({ login: 'owner', password: 'wrong-wrong-wrong' }), { code: 'bad_credentials' });
    await assert.rejects(acc.signIn({ login: 'owner', password: temp }), e => e.code === 'locked' && e.retryAfter > 0, 'locked even with the right password');
    now += LIMITS.lockMs + 1000;
    const first = await acc.signIn({ login: 'OWNER', password: temp });   // usernames ignore case
    assert.equal(first.principal.restricted, true);
    for (let k = 0; k < LIMITS.lockAfter; k++) await assert.rejects(acc.signIn({ login: 'nobody', password: 'x-x-x-x-x-x' }), { code: 'bad_credentials' });
    await assert.rejects(acc.signIn({ login: 'nobody', password: 'x-x-x-x-x-x' }), { code: 'locked' }, 'unknown names lock like real ones');
    const other = await acc.signIn({ login: 'owner', password: temp });
    const pw = 'Correct-Horse-Battery-9';
    await assert.rejects(acc.changePassword(first.principal, { current: 'nope', password: pw }), { code: 'wrong_password' });
    await assert.rejects(acc.changePassword(first.principal, { current: temp, password: 'short' }), { code: 'weak_password' });
    const P1 = await acc.changePassword(first.principal, { current: temp, password: pw });
    assert.equal(P1.restricted, false);
    assert.equal(fs.existsSync(file), false, 'the owner file is deleted');
    assert.equal(acc.resolve(other.token).account, null, 'the other device was signed out');
    assert.equal(acc.resolve(first.token).account.login, 'owner');
    for (let k = 0; k < 3; k++) {
      now += LIMITS.sessionIdleMs - 60000;
      assert.ok(acc.resolve(first.token).account, `still signed in after ${k + 1} idle periods`);
    }
    now += 24 * 3600000;
    assert.equal(acc.resolve(first.token).account, null, 'ended at the 90-day cap');
    const t2 = (await acc.signIn({ login: 'owner', password: pw })).token;
    now += LIMITS.sessionIdleMs + 1000;
    const gone = acc.resolve(t2);
    assert.equal(gone.account, null, 'ended after 30 idle days');
    assert.equal(gone.stale, true);
    const m = await acc.createAccount({ login: 'member1', displayName: 'Member One', role: 'member' });
    now += LIMITS.tempTtlMs + 1000;
    await assert.rejects(acc.signIn({ login: 'member1', password: m.temporaryPassword }), { code: 'temp_expired' });
  } finally { st.done(); }
});

test('accounts are managed only below the own role; the owner is never changed by others', async () => {
  const st = store();
  const acc = new Accounts(st.s, { dataDir: st.dir });
  try {
    await acc.createAccount({ login: 'owner', displayName: 'Owner', role: 'owner', password: 'Correct-Horse-Battery-7', mustChange: false });
    const as = u => ({ account: { id: u.id }, role: u.role });
    const O = as(acc.listUsers().find(u => u.role === 'owner'));
    const a = (await acc.createAccount({ login: 'admin1', displayName: 'Admin One', role: 'admin' })).user;
    const a2 = (await acc.createAccount({ login: 'admin2', displayName: 'Admin Two', role: 'admin' })).user;
    const m = (await acc.createAccount({ login: 'member1', displayName: 'Member One', role: 'member' })).user;
    const A = as(a), M = as(m);
    await assert.rejects(acc.createUser(A, { login: 'admin3', displayName: 'Admin Three', role: 'admin' }), { code: 'forbidden' });
    const c = await acc.createUser(A, { login: 'member2', displayName: 'Member Two', role: 'member' });
    assert.equal(c.user.mustChange, true);
    assert.equal(typeof c.temporaryPassword, 'string');
    await assert.rejects(acc.updateUser(A, O.account.id, { status: 'disabled' }), { code: 'forbidden' });
    await assert.rejects(acc.updateUser(A, a2.id, { resetPassword: true }), { code: 'forbidden' });
    await assert.rejects(acc.updateUser(A, a.id, { role: 'member' }), { code: 'forbidden' }, 'not the own account');
    await assert.rejects(acc.updateUser(A, m.id, { role: 'admin' }), { code: 'forbidden' }, 'not up to the own role');
    await assert.rejects(acc.updateUser(M, c.user.id, { status: 'disabled' }), { code: 'forbidden' });
    assert.equal((await acc.updateUser(O, a2.id, { role: 'member' })).user.role, 'member');
    assert.equal((await acc.updateUser(A, m.id, { status: 'disabled' })).user.status, 'disabled');
    const reset = await acc.updateUser(A, c.user.id, { resetPassword: true });
    assert.equal(reset.user.mustChange, true);
    assert.equal(typeof reset.temporaryPassword, 'string');
    await assert.rejects(acc.createAccount({ login: 'owner2', displayName: 'Owner Two', role: 'owner' }), { code: 'owner_exists' });
    await assert.rejects(acc.createAccount({ login: 'Admin1', displayName: 'Someone', role: 'member' }), { code: 'login_taken' });
    await assert.rejects(acc.createAccount({ login: 'someone', displayName: 'admin one', role: 'member' }), { code: 'name_taken' });
    await assert.rejects(acc.createAccount({ login: 'someone', displayName: 'Admin 0ne', role: 'member' }), { code: 'name_taken' }, 'digit zero for o');
    await assert.rejects(acc.createAccount({ login: 'someone', displayName: '\u0410dmin One', role: 'member' }), { code: 'name_taken' }, 'Cyrillic A');
    await assert.rejects(acc.createAccount({ login: 'someone', displayName: 'Admin_One', role: 'member' }), { code: 'name_taken' }, 'separators');
    await assert.rejects(acc.createAccount({ login: 'someone', displayName: 'Adrnin One', role: 'member' }), { code: 'name_taken' }, 'rn for m');
    await assert.rejects(acc.createAccount({ login: 'x', displayName: 'Too Short Login', role: 'member' }), { code: 'bad_request' });
  } finally { st.done(); }
});

const req = (o = {}) => ({ socket: { remoteAddress: o.peer ?? '127.0.0.1', encrypted: !!o.tls }, headers: { host: o.host ?? '127.0.0.1:8570', ...(o.headers || {}) } });

test('sign-in limits: per account and address, per account from any address, per address; kept across restarts', async () => {
  const st = store();
  let now = Date.UTC(2026, 8, 27, 12);
  const acc = new Accounts(st.s, { dataDir: st.dir, now: () => now });
  try {
    const pw = 'Correct-Horse-Battery-9';
    await acc.createAccount({ login: 'target', displayName: 'Target', role: 'member', password: pw, mustChange: false });
    const tryAs = (password, ip) => acc.signIn({ login: 'target', password, ip });
    for (let k = 0; k < LIMITS.lockAfter; k++) await assert.rejects(tryAs('Wrong-Password-00', '203.0.113.1'), { code: 'bad_credentials' });
    await assert.rejects(tryAs(pw, '203.0.113.1'), { code: 'locked' }, 'that address is locked out of the account');
    assert.ok((await tryAs(pw, '198.51.100.1')).token, 'another address still signs in');
    const again = new Accounts(st.s, { dataDir: st.dir, now: () => now });   // a restarted server
    await assert.rejects(again.signIn({ login: 'target', password: pw, ip: '203.0.113.1' }), { code: 'locked' }, 'locks survive a restart');
    for (let k = 0; k < LIMITS.accountLockAfter; k++) {
      await assert.rejects(tryAs('Wrong-Password-00', `10.0.${Math.floor(k / 4)}.${k % 4 + 1}`), e => e.code === 'bad_credentials');
    }
    await assert.rejects(tryAs(pw, '192.0.2.99'), { code: 'locked' }, 'after 50 failures from any addresses the account locks for everyone');
    now += LIMITS.lockMs + 1000;
    assert.ok((await tryAs(pw, '192.0.2.99')).token, 'and unlocks after 15 minutes');
    for (let k = 0; k < LIMITS.addressLimit; k++) await assert.rejects(acc.signIn({ login: `nobody${k}`, password: 'x-x-x-x-x-x', ip: '203.0.113.200' }), { code: 'bad_credentials' });
    await assert.rejects(tryAs(pw, '203.0.113.200'), { code: 'rate_limited' }, '20 failures block the address');
    const P = { account: { id: acc.listUsers()[0].id }, session: null };
    for (let k = 0; k < LIMITS.lockAfter; k++) await assert.rejects(acc.confirm(P, 'Wrong-Password-00', '203.0.113.7'), { code: 'wrong_password' });
    await assert.rejects(acc.confirm(P, pw, '203.0.113.7'), { code: 'locked' }, 'password confirmations count like sign-ins');
    acc.clearFailures(P.account.id);
    assert.ok(await acc.confirm(P, pw, '203.0.113.7'));
  } finally { st.done(); }
});

test('client addresses come only through trusted proxies; secure requests; Origin checks', () => {
  assert.equal(new HttpPolicy().clientIp(req({ headers: { 'x-forwarded-for': '198.51.100.7' } })), '127.0.0.1', 'no proxy is trusted by default');
  const p = new HttpPolicy({ trustedProxies: '127.0.0.1,::1' });   // a reverse proxy on this machine
  assert.equal(p.clientIp(req({ headers: { 'x-forwarded-for': '198.51.100.7, 203.0.113.9' } })), '203.0.113.9');
  assert.equal(p.clientIp(req({ headers: { 'x-forwarded-for': '198.51.100.7, 127.0.0.1' } })), '198.51.100.7');
  assert.equal(p.clientIp(req({ peer: '192.0.2.10', headers: { 'x-forwarded-for': '198.51.100.7' } })), '192.0.2.10', 'untrusted peers cannot claim an address');
  assert.equal(p.clientIp(req({ peer: '::ffff:127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.7' } })), '198.51.100.7');
  assert.equal(new HttpPolicy({ trustedProxies: 'none' }).clientIp(req({ headers: { 'x-forwarded-for': '198.51.100.7' } })), '127.0.0.1');
  assert.equal(new HttpPolicy({ trustedProxies: '192.0.2.0/24' }).clientIp(req({ peer: '192.0.2.44', headers: { 'x-forwarded-for': '198.51.100.7' } })), '198.51.100.7');
  assert.equal(p.isSecure(req()), true, 'plain http on the loopback address');
  assert.equal(p.isSecure(req({ host: 'localhost:8570' })), true);
  assert.equal(p.isSecure(req({ host: 'world.example.org' })), false);
  assert.equal(p.isSecure(req({ peer: '192.0.2.10', host: 'world.example.org', tls: true })), true);
  assert.equal(p.isSecure(req({ host: 'world.example.org', headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '198.51.100.7' } })), true);
  assert.equal(p.isSecure(req({ peer: '192.0.2.10', host: 'world.example.org', headers: { 'x-forwarded-proto': 'https' } })), false, 'untrusted X-Forwarded-Proto');
  assert.equal(p.isSecure(req({ headers: { 'x-forwarded-for': '198.51.100.7' } })), false, 'proxied plain http');
  assert.equal(p.originAllowed(req()), true, 'no Origin (tools)');
  assert.equal(p.originAllowed(req({ headers: { origin: 'http://127.0.0.1:8570' } })), true);
  assert.equal(p.originAllowed(req({ headers: { origin: 'http://127.0.0.1:9999' } })), false);
  assert.equal(p.originAllowed(req({ headers: { origin: 'https://evil.example' } })), false);
  assert.equal(p.originAllowed(req({ headers: { origin: 'null' } })), false);
  assert.equal(p.originAllowed(req({ headers: { 'sec-fetch-site': 'cross-site' } })), false);
  const proxied = { host: 'world.example.org', headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '198.51.100.7', origin: 'https://world.example.org' } };
  assert.equal(p.originAllowed(req(proxied)), true);
  const pub = new HttpPolicy({ publicUrls: 'https://world.example.org' });
  assert.equal(pub.originAllowed(req(proxied)), true);
  assert.equal(pub.originAllowed(req({ host: 'other.example.org', headers: { origin: 'http://other.example.org' } })), false, 'only the public address');
  assert.throws(() => new HttpPolicy({ trustedProxies: 'banana' }), /not an address/);
  assert.throws(() => new HttpPolicy({ publicUrls: 'nope' }), /not a URL/);
});

test('CSRF tokens and cookies', () => {
  assert.equal(csrfOk({ headers: { 'x-csrf-token': 'abc' } }, 'abc'), true);
  assert.equal(csrfOk({ headers: { 'x-csrf-token': 'abd' } }, 'abc'), false);
  assert.equal(csrfOk({ headers: {} }, 'abc'), false);
  assert.equal(csrfOk({ headers: { 'x-csrf-token': '' } }, ''), false);
  assert.deepEqual({ ...parseCookies('a=1; __Host-mvw-session=xyz; a=2') }, { a: '1', '__Host-mvw-session': 'xyz' });
  assert.equal(sessionCookie('__Host-x', 'v', 60), '__Host-x=v; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=60');
});

test('password policy, Argon2id hashes and temporary passwords', async () => {
  assert.match(checkPassword('short-pw'), /at least 12/);
  assert.match(checkPassword('x'.repeat(1025)), /at most 1024/);
  assert.match(checkPassword('owner-account', { login: 'Owner-Account' }), /username/);
  assert.match(checkPassword('Display Name 1', { displayName: 'display name 1' }), /display name/);
  assert.match(checkPassword('aaaaaaaaaaaabbbb'), /different characters/);
  const list = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'server/auth/common-passwords.txt.gz'))).toString('utf8').split('\n');
  const common = list.find(w => new Set(w).size >= 5);
  assert.match(checkPassword(common.toUpperCase()), /common passwords/, 'checked without regard to case');
  assert.equal(checkPassword('Correct-Horse-Battery-9'), null);
  const h = await hashPassword('Correct-Horse-Battery-9');
  assert.match(h, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.equal(await verifyPassword('Correct-Horse-Battery-9', h), true);
  assert.equal(await verifyPassword('correct-horse-battery-9', h), false);
  assert.equal(await verifyPassword('x', 'not a hash'), false);
  assert.equal(needsRehash(h), false);
  assert.equal(needsRehash(h.replace('t=2', 't=3')), true);
  const t = temporaryPassword();
  assert.equal(t.length, 20);
  assert.match(t, /^[A-HJ-NP-Za-km-z2-9]+$/);
  assert.equal(checkPassword(t), null);
});

test('destructive edits: demolishing, removing floors, switching between one floor and several', () => {
  const { world } = testCity({ seed: 'destructive', population: 60 });
  const ed = new Editor({ world, sim: null, save() {}, onPatches() {} });
  const B = world.buildings.find(b => b && !b.gone && b.type === 'office' && b.floors >= 3);
  const C = world.buildings.find(b => b && !b.gone && b.type === 'cafe' && b.floors === 1);
  assert.equal(ed.destructive([{ op: 'bld.del', b: B.idx }]), 'Demolishing a building');
  assert.equal(ed.destructive([{ op: 'bld.floors', b: B.idx, floors: B.floors - 1 }]), 'Removing floors');
  assert.equal(ed.destructive([{ op: 'bld.floors', b: B.idx, floors: B.floors + 1 }]), null);
  assert.equal(ed.destructive([{ op: 'bld.floors', b: C.idx, floors: 2 }]), 'Rebuilding every floor');
  assert.equal(ed.destructive([{ op: 'bld.set', b: B.idx, name: 'x' }, { op: 'item.del', b: B.idx, f: 0, id: 1 }]), null);
  assert.equal(ed.destructive([{ op: 'bld.set', b: B.idx, name: 'x' }, { op: 'bld.del', b: C.idx }]), 'Demolishing a building');
  assert.equal(ed.destructive({ op: 'bld.del', b: C.idx }), 'Demolishing a building', 'a single op');
  assert.equal(ed.destructive(null), null);
});
