// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Account management against a throwaway server (WP1.4): invites, open registration, deleting accounts, handing over
// ownership, the audit log, security settings, two-factor sign-in, the own data export and account deletion.
// CHECKLIST I14.4, I14.5, I14.6, I14.7; DECISIONS C73–C81.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DatabaseSync } from '../server/sqlite.js';
import { Audit } from '../server/auth/audit.js';
import { totp, base32Decode } from '../server/auth/totp.js';
import { startServer, httpClient, ownerSession, userSession, strongPassword } from './helpers/server.mjs';

let s, owner, admin;
const fwd = ip => ({ 'x-forwarded-for': ip, 'x-forwarded-proto': 'https' });
before(async () => {
  s = await startServer({ population: 80, env: { MVW_TRUSTED_PROXIES: '127.0.0.1,::1' } });
  owner = await ownerSession(s);
  admin = await userSession(s, owner, { login: 'admin1', displayName: 'Admin One', role: 'admin' });
});
after(async () => { await s?.stop(); });
const events = async (q = '') => (await owner.get(`/api/audit?limit=500${q}`)).json.events;
const tokenOf = link => new URLSearchParams(new URL(link).hash.slice(1)).get('invite');

test('invites: single use, role below the creator, revocable; accepting one creates the account and signs it in', async () => {
  assert.equal((await admin.post('/api/invites', { role: 'admin' })).status, 403, 'admins invite members only');
  const inv = await admin.post('/api/invites', { role: 'member', days: 3, note: 'for Kim' });
  assert.equal(inv.status, 201, inv.text);
  assert.match(inv.json.link, /\/#invite=[\w-]{40,}$/, 'the token is after #, never sent to a server');
  const token = tokenOf(inv.json.link);
  const guest = httpClient(s.url);
  assert.deepEqual({ ...(await guest.get(`/api/invites/check?token=${token}`)).json, expires: 0 }, { valid: true, role: 'member', expires: 0 });
  const pw = strongPassword();
  const r = await guest.post('/api/invites/accept', { token, login: 'kim', displayName: 'Kim', password: pw });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.account.login, 'kim');
  assert.equal(r.json.role, 'member');
  assert.equal((await guest.get('/api/account/devices')).status, 200, 'signed in');
  const again = await httpClient(s.url).post('/api/invites/accept', { token, login: 'kim2', displayName: 'Kim Two', password: pw });
  assert.equal(again.status, 410, 'single use');
  assert.equal((await guest.get(`/api/invites/check?token=${token}`)).json.valid, false);
  const inv2 = await owner.post('/api/invites', { role: 'admin' });
  assert.equal(inv2.status, 201);
  const list = (await admin.get('/api/invites')).json.invites;
  assert.deepEqual(list.map(i => i.state).sort(), ['open', 'used']);
  assert.equal(JSON.stringify(list).includes(tokenOf(inv2.json.link)), false, 'the list never shows links');
  assert.equal((await admin.post('/api/invites/revoke', { id: inv2.json.invite.id })).status, 403, 'an admin invite is above an admin');
  assert.equal((await owner.post('/api/invites/revoke', { id: inv2.json.invite.id })).status, 200);
  assert.equal((await httpClient(s.url).post('/api/invites/accept', { token: tokenOf(inv2.json.link), login: 'late', displayName: 'Late', password: pw })).status, 410);
  assert.equal((await admin.post('/api/invites', { role: 'member', days: 99 })).status, 400);
});

test('open self-registration is off by default, an admin switch, and limited per address', async () => {
  const pw = strongPassword();
  assert.equal((await httpClient(s.url).post('/api/auth/register', { login: 'self1', displayName: 'Self One', password: pw })).json.code, 'registration_closed');
  assert.equal((await admin.post('/api/settings/world', { registrationOpen: true })).status, 200);
  try {
    assert.equal((await httpClient(s.url).get('/api/auth/me')).json.registrationOpen, true);
    for (let k = 0; k < 5; k++) {
      const r = await httpClient(s.url).post('/api/auth/register', { login: `self${k}`, displayName: `Self ${k}`, password: pw }, fwd('203.0.113.80'));
      assert.equal(r.status, 201, r.text);
      assert.equal(r.json.role, 'member');
    }
    const sixth = await httpClient(s.url).post('/api/auth/register', { login: 'self9', displayName: 'Self Nine', password: pw }, fwd('203.0.113.80'));
    assert.equal(sixth.status, 429);
    assert.equal((await httpClient(s.url).post('/api/auth/register', { login: 'self9', displayName: 'Self Nine', password: pw }, fwd('203.0.113.81'))).status, 201);
  } finally {
    assert.equal((await admin.post('/api/settings/world', { registrationOpen: false })).status, 200);
  }
});

test('Admin → Users: delete below the own role, deleting or reassigning the data; the deleted session ends', async () => {
  const m = await userSession(s, owner, { login: 'gone1', displayName: 'Gone One' });
  const keep = await userSession(s, owner, { login: 'keeper', displayName: 'Keeper' });
  const users = (await admin.get('/api/users')).json.users;
  const ownerId = users.find(u => u.role === 'owner').id, adminId = users.find(u => u.login === 'admin1').id;
  assert.equal((await admin.post('/api/users/delete', { id: ownerId })).status, 403);
  assert.equal((await admin.post('/api/users/delete', { id: adminId })).status, 403, 'not the own account');
  assert.equal((await admin.post('/api/users/delete', { id: m.id, data: 'reassign', to: 999999 })).status, 400);
  const r = await admin.post('/api/users/delete', { id: m.id, data: 'reassign', to: keep.id });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.users.some(u => u.login === 'gone1'), false);
  assert.equal((await m.get('/api/account/devices')).status, 401, 'its session ended');
  assert.equal((await httpClient(s.url).post('/api/auth/signin', { login: 'gone1', password: m.password })).status, 401);
  const e = (await events('&group=accounts')).find(x => x.action === 'account.delete' && x.target_login === 'gone1');
  assert.deepEqual(e.detail, { data: 'reassign', to: 'keeper' });
});

test('the owner hands ownership to an active admin and becomes an admin', async () => {
  const s2 = await startServer({ population: 60 });
  try {
    const o = await ownerSession(s2);
    const a = await userSession(s2, o, { login: 'heir', displayName: 'Heir', role: 'admin' });
    const m = await userSession(s2, o, { login: 'plain', displayName: 'Plain' });
    assert.equal((await a.post('/api/owner/transfer', { id: a.id })).status, 403, 'an admin cannot take ownership');
    assert.equal((await o.post('/api/owner/transfer', { id: m.id })).status, 400, 'members cannot receive it');
    const r = await o.post('/api/owner/transfer', { id: a.id });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.role, 'admin', 'the former owner is an admin');
    assert.equal((await a.get('/api/permissions')).status, 200, 'the new owner may manage permissions');
    assert.equal((await o.get('/api/permissions')).status, 403);
    const roles = Object.fromEntries((await a.get('/api/users')).json.users.map(u => [u.login, u.role]));
    assert.deepEqual([roles.owner, roles.heir], ['admin', 'owner']);
  } finally { await s2.stop(); }
});

test('the audit log records sign-ins and failures, account, invite, permission and settings changes; admins filter and export it', async () => {
  await httpClient(s.url).post('/api/auth/signin', { login: 'nobody-here', password: 'wrong-password-1' });
  await httpClient(s.url).post('/api/auth/signin', { login: 'admin1', password: 'wrong-password-1' });
  await owner.post('/api/permissions', { cap: 'world.edit', min: 'member' });
  await owner.post('/api/permissions', { cap: 'world.edit', min: null });
  const all = await events();
  const actions = new Set(all.map(e => e.action));
  for (const a of ['account.create', 'account.password', 'auth.signin', 'auth.signin_failed', 'invite.create', 'invite.accept', 'invite.revoke',
    'account.register', 'account.delete', 'permissions.set', 'settings.change']) assert.ok(actions.has(a), a);
  const unknown = all.find(e => e.action === 'auth.signin_failed' && !e.target_id);
  assert.deepEqual(unknown.detail, { unknown: true });
  assert.equal(JSON.stringify(all).includes('nobody-here'), false, 'typed unknown names are never stored');
  assert.equal(all.find(e => e.action === 'auth.signin_failed' && e.target_login === 'admin1').ip, '127.0.0.1');
  const perm = all.find(e => e.action === 'permissions.set');
  assert.equal(perm.detail.cap, 'world.edit');
  assert.ok((await events('&group=invites')).every(e => e.action.startsWith('invite.')));
  const adminId = (await owner.get('/api/users')).json.users.find(u => u.login === 'admin1').id;
  assert.ok((await events(`&account=${adminId}`)).every(e => e.actor_id === adminId || e.target_id === adminId));
  const csv = await admin.get('/api/audit?format=csv&group=accounts');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="audit-\d{4}-\d{2}-\d{2}\.csv"/);
  assert.match(csv.text.split('\n')[0], /^id,time,actor_id,actor,action/);
  const jsonl = await admin.get('/api/audit?format=jsonl');
  assert.ok(jsonl.text.trim().split('\n').every(l => JSON.parse(l).action));
  assert.ok((await events('&group=data')).some(e => e.action === 'audit.export'), 'exports are recorded');
  const member = await userSession(s, owner, { login: 'curious', displayName: 'Curious' });
  assert.equal((await member.get('/api/audit')).status, 403);
  const db = new DatabaseSync(path.join(s.data, 'next.db'), { timeout: 5000 });
  try {
    assert.throws(() => db.exec("UPDATE audit SET action = 'x'"), /append-only/);
    assert.throws(() => db.exec('DELETE FROM audit'), /append-only/);
    const worldId = db.prepare("SELECT value FROM meta WHERE key = 'world_id'").get().value;
    assert.deepEqual(new Audit({ db, worldId, tx: fn => fn() }).verify().ok, true, 'the hash chain holds');
  } finally { db.close(); }
});

test('two-factor sign-in: setup with a QR code, enable with a code, sign in in two steps, recovery codes, no code twice', async () => {
  const u = await userSession(s, owner, { login: 'secure1', displayName: 'Secure One', role: 'admin' });
  const setup = await u.post('/api/account/2fa/setup');
  assert.equal(setup.status, 200, setup.text);
  assert.match(setup.json.svg, /^<svg /);
  assert.match(setup.json.otpauth, /^otpauth:\/\/totp\/My%20Virtual%20World%3Asecure1\?secret=/);
  const key = base32Decode(setup.json.secret);
  assert.equal((await u.post('/api/account/2fa/enable', { code: '000000' })).json.code, 'bad_code');
  const en = await u.post('/api/account/2fa/enable', { code: totp(key, Date.now()) });
  assert.equal(en.status, 200, en.text);
  assert.equal(en.json.codes.length, 10);
  assert.equal(en.json.account.twofa, true);
  assert.equal((await u.get('/api/account/2fa')).json.recoveryLeft, 10);
  const c = httpClient(s.url);
  const step1 = await c.post('/api/auth/signin', { login: 'secure1', password: u.password });
  assert.equal(step1.json.twofa, 'required');
  assert.equal(c.cookie, '', 'no session before the code');
  assert.equal((await c.post('/api/auth/signin/2fa', { ticket: step1.json.ticket, code: '123456' })).json.code, 'bad_code');
  assert.equal((await c.post('/api/auth/signin/2fa', { ticket: step1.json.ticket, code: totp(key, Date.now() + 30000) }, fwd('198.51.100.40'))).json.code, 'ticket_expired', 'the ticket is bound to the address');
  const step1b = await c.post('/api/auth/signin', { login: 'secure1', password: u.password });
  const code = totp(key, Date.now() + 30000);
  const ok = await c.post('/api/auth/signin/2fa', { ticket: step1b.json.ticket, code });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.account.login, 'secure1');
  const c2 = httpClient(s.url);
  const t2 = (await c2.post('/api/auth/signin', { login: 'secure1', password: u.password })).json.ticket;
  assert.equal((await c2.post('/api/auth/signin/2fa', { ticket: t2, code })).json.code, 'bad_code', 'a code works only once');
  const rec = await c2.post('/api/auth/signin/2fa', { ticket: t2, code: en.json.codes[0].toUpperCase() });
  assert.equal(rec.status, 200, 'a recovery code');
  const c3 = httpClient(s.url);
  const t3 = (await c3.post('/api/auth/signin', { login: 'secure1', password: u.password })).json.ticket;
  assert.equal((await c3.post('/api/auth/signin/2fa', { ticket: t3, code: en.json.codes[0] })).json.code, 'bad_code', 'each recovery code once');
  assert.equal((await u.get('/api/account/2fa')).json.recoveryLeft, 9);
  const fresh = await u.post('/api/account/2fa/recovery');
  assert.equal(fresh.json.codes.length, 10);
  assert.equal((await u.post('/api/account/2fa/disable')).status, 200);
  const one = await httpClient(s.url).post('/api/auth/signin', { login: 'secure1', password: u.password });
  assert.equal(one.json.account.login, 'secure1', 'back to one step');
  const acts = new Set((await events('&group=credentials')).map(e => e.action));
  for (const a of ['twofa.enable', 'twofa.recovery_used', 'twofa.recovery_new', 'twofa.disable']) assert.ok(acts.has(a), a);
  const db = new DatabaseSync(path.join(s.data, 'next.db'), { timeout: 5000 });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM twofa').get().n, 0);
  } finally { db.close(); }
});

test('"require two-factor for admins": an admin without it gets a session that can only set it up', async () => {
  const u = await userSession(s, owner, { login: 'lax1', displayName: 'Lax One', role: 'admin' });
  assert.equal((await admin.post('/api/settings/security', { retentionDays: 90 })).status, 403, 'retention is the owner\'s');
  assert.equal((await admin.post('/api/settings/security', { require2fa: true })).status, 200);
  try {
    assert.equal((await admin.get('/api/users')).status, 200, 'sessions already running keep working (C77: from the next sign-in on)');
    const c = httpClient(s.url);
    const me = (await c.post('/api/auth/signin', { login: 'lax1', password: u.password })).json;
    assert.equal(me.restricted, true);
    assert.equal(me.restrictedWhy, 'twofa');
    const w = (await c.get('/api/world')).json.world, b = w.buildings.findIndex(x => x && !x.gone && x.type !== 'hq');
    const edit = await c.post('/api/edit', { ops: [{ op: 'bld.set', b, name: 'x' }] });
    assert.equal(edit.json.code, 'twofa_setup_required');
    const setup = await c.post('/api/account/2fa/setup');
    assert.equal(setup.status, 200, setup.text);
    const en = await c.post('/api/account/2fa/enable', { code: totp(base32Decode(setup.json.secret), Date.now()) });
    assert.equal(en.status, 200, en.text);
    assert.equal(en.json.restricted, false);
    assert.equal((await c.post('/api/edit', { ops: [{ op: 'bld.set', b, name: 'Lax Edit' }] })).status, 200);
    const members = await userSession(s, owner, { login: 'lax2', displayName: 'Lax Two' });
    assert.equal((await members.get('/api/account/devices')).status, 200, 'members are not affected');
  } finally {
    assert.equal((await admin.post('/api/settings/security', { require2fa: false })).status, 200);
  }
  assert.equal((await owner.post('/api/settings/security', { retentionDays: 10 })).status, 400);
  const r = await owner.post('/api/settings/security', { retentionDays: 365 });
  assert.equal(r.json.retentionDays, 365);
  assert.equal((await owner.post('/api/settings/security', { retentionDays: null })).json.retentionDays, null, 'forever again');
});

test('users download their data and delete their account after the password; the owner hands over first', async () => {
  const u = await userSession(s, owner, { login: 'leaver', displayName: 'Leaver' });
  const x = await u.get('/api/account/export');
  assert.equal(x.status, 200, x.text);
  assert.match(x.headers.get('content-disposition'), /attachment; filename="my-data-leaver\.json"/);
  assert.equal(x.json.account.login, 'leaver');
  assert.ok(x.json.devices.length >= 1);
  assert.ok(x.json.auditEvents.some(e => e.action === 'account.create'));
  assert.equal(JSON.stringify(x.json).includes('password_hash'), false);
  assert.equal((await u.post('/api/account/delete', { password: 'Wrong-Password-00' })).json.code, 'wrong_password');
  const d = await u.post('/api/account/delete', { password: u.password });
  assert.equal(d.status, 200, d.text);
  assert.equal(d.json.deleted, true);
  assert.equal((await httpClient(s.url).post('/api/auth/signin', { login: 'leaver', password: u.password })).status, 401);
  assert.equal((await owner.post('/api/account/delete', { password: owner.password })).json.code, 'owner_cannot_delete');
  assert.ok((await events('&group=data')).some(e => e.action === 'account.export' && e.actor_login === 'leaver'));
});
