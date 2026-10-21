// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Two-factor codes (RFC 6238 test vectors), recovery codes, secret encryption, and the append-only audit log.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  base32Encode, base32Decode, hotp, totp, verifyTotp, stepAt, newSecret, otpauthUrl, newRecoveryCodes, normalizeRecovery,
} from '../server/auth/totp.js';
import { Audit, AUDIT_GROUPS } from '../server/auth/audit.js';
import { openDb, SCHEMA_VERSION } from '../server/db.js';
import { DatabaseSync } from '../server/sqlite.js';
import { tempDir } from './helpers/server.mjs';

test('TOTP matches the RFC 6238 test vectors (SHA-1, 8 digits) and HOTP the RFC 4226 ones', () => {
  const key = Buffer.from('12345678901234567890');
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [t, code] of vectors) assert.equal(totp(key, t * 1000, { digits: 8 }), code, `t = ${t}`);
  const hotps = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  hotps.forEach((code, c) => assert.equal(hotp(key, c), code, `counter ${c}`));
  const sha256 = Buffer.from('12345678901234567890123456789012');
  assert.equal(totp(sha256, 59000, { digits: 8, algorithm: 'sha256' }), '46119246');
});

test('base32 round-trips and decodes the usual spellings', () => {
  for (let n = 0; n < 40; n++) {
    const b = Buffer.from(Array.from({ length: n }, (_, k) => (k * 37 + n) & 255));
    assert.deepEqual(base32Decode(base32Encode(b)), b);
  }
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.deepEqual(base32Decode('mzxw 6ytb-oi=='), Buffer.from('foobar'));
  assert.throws(() => base32Decode('01!'), /base32/);
  assert.equal(base32Decode(newSecret()).length, 20);
});

test('a code is accepted within one step of drift, once', () => {
  const key = base32Decode(newSecret()), now = Date.UTC(2026, 8, 27, 12, 0, 10);
  const s = stepAt(now);
  assert.equal(verifyTotp(key, totp(key, now), now), s);
  assert.equal(verifyTotp(key, totp(key, now - 30000), now), s - 1, 'the previous step');
  assert.equal(verifyTotp(key, totp(key, now + 30000), now), s + 1, 'the next step');
  assert.equal(verifyTotp(key, totp(key, now - 90000), now), null, 'too old');
  assert.equal(verifyTotp(key, totp(key, now), now, s), null, 'already used');
  assert.equal(verifyTotp(key, '12345', now), null);
  assert.equal(verifyTotp(key, 'abcdef', now), null);
  assert.match(otpauthUrl({ issuer: 'My World', account: 'owner', secret: 'JBSWY3DPEHPK3PXP' }), /^otpauth:\/\/totp\/My%20World%3Aowner\?secret=JBSWY3DPEHPK3PXP&issuer=My%20World&/);
});

test('recovery codes are random and normalised', () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[a-z2-9]{4}-[a-z2-9]{4}$/);
  assert.equal(normalizeRecovery(codes[0]), normalizeRecovery(codes[0].toUpperCase().replace('-', ' ')));
});

test('the audit log is append-only, chained, filterable, exportable, and purged only on purpose', () => {
  const dir = tempDir('mvw-audit-'), store = openDb(dir);
  let now = Date.UTC(2026, 8, 27, 12);
  try {
    const audit = new Audit(store, { now: () => now });
    audit.log('auth.signin', { actor: { id: 1, login: 'owner' }, ip: '203.0.113.5' });
    now += 1000;
    audit.log('account.create', { actor: { id: 1, login: 'owner' }, target: { id: 2, login: 'member1' }, detail: { role: 'member' } });
    now += 1000;
    audit.log('permissions.set', { actor: { id: 1, login: 'owner' }, detail: { cap: 'world.edit', min: 'member' } });
    assert.deepEqual(audit.verify(), { ok: true, rows: 3 });
    assert.equal(audit.list().length, 3);
    assert.equal(audit.list()[0].action, 'permissions.set', 'newest first');
    assert.deepEqual(audit.list({ group: 'accounts' }).map(r => r.action), ['account.create']);
    assert.equal(audit.list({ account: 2 }).length, 1);
    assert.deepEqual(audit.list({ group: 'accounts' })[0].detail, { role: 'member' });
    assert.throws(() => store.db.exec("UPDATE audit SET action = 'x'"), /append-only/);
    assert.throws(() => store.db.exec('DELETE FROM audit'), /append-only/);
    const csv = audit.export('csv');
    assert.match(csv.split('\n')[0], /^id,time,actor_id,actor,action/);
    assert.equal(csv.trim().split('\n').length, 4);
    assert.equal(audit.export('jsonl').trim().split('\n').length, 3);
    audit.log('account.name', { actor: { id: 2, login: '=cmd' }, detail: { to: '+1' } });
    assert.match(audit.export('csv'), /'=cmd/, 'no spreadsheet formulas');
    // A change made outside the server shows up in the chain.
    store.db.exec('DROP TRIGGER audit_no_update');
    store.db.exec("UPDATE audit SET ip = '198.51.100.1' WHERE id = 1");
    assert.equal(audit.verify().ok, false);
    assert.equal(audit.verify().brokenAt, 1);
    store.db.exec("UPDATE audit SET ip = '203.0.113.5' WHERE id = 1");
    assert.equal(audit.verify().ok, true);
    // Retention purge: only older events go, and the purge is recorded.
    now += 400 * 86400000;
    audit.log('auth.signin', { actor: { id: 1, login: 'owner' } });
    assert.equal(audit.purge(365, { actor: { id: 1, login: 'owner' } }), 4);
    const left = audit.list();
    assert.deepEqual(left.map(r => r.action), ['audit.purge', 'auth.signin']);
    assert.equal(audit.verify().ok, true, 'the chain starts again at the first remaining row');
    assert.throws(() => store.db.exec('DELETE FROM audit'), /append-only/, 'still append-only after a purge');
    for (const acts of Object.values(AUDIT_GROUPS)) for (const a of acts) assert.match(a, /^[a-z]+\.[a-z_]+$/);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a database written by an older schema migrates to the current one', () => {
  const dir = tempDir('mvw-migrate-');
  try {
    const s = openDb(dir);
    const v = s.db.prepare('PRAGMA user_version').get().user_version;
    s.close();
    const raw = new DatabaseSync(path.join(dir, 'next.db'));
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(r => r.name);
    raw.close();
    assert.equal(v, SCHEMA_VERSION);
    for (const t of ['agent_profiles', 'agent_intentions', 'agent_memories', 'agent_relations', 'agent_activity', 'agent_free_will', 'agent_decisions', 'econ_listings', 'econ_work', 'econ_xp', 'econ_rep', 'econ_rep_events', 'econ_reviews', 'econ_wallets', 'econ_tx', 'econ_postings', 'econ_holds', 'econ_businesses', 'econ_biz_days', 'econ_pending', 'econ_days', 'econ_stats', 'econ_requests', 'econ_agent_policy', 'econ_approvals', 'econ_debts', 'econ_leases', 'econ_loans', 'commerce_ledger', 'commerce_listings', 'commerce_offers', 'commerce_orders', 'commerce_leases', 'commerce_flats', 'commerce_events', 'commerce_campaigns', 'commerce_ad_stats', 'commerce_host_earnings', 'floor_layouts', 'floor_layout_shares', 'world_rows', 'world_docs', 'lots', 'lot_titles', 'title_events', 'lot_delegations', 'property_ops', 'accounts', 'sessions', 'auth_failures', 'audit', 'invites', 'twofa', 'recovery_codes', 'account_settings', 'edits', 'edit_keys', 'players', 'friends', 'agents', 'agent_shares', 'connections', 'connection_shares', 'connection_secrets', 'chat_sessions', 'chat_references', 'attachments']) assert.ok(tables.includes(t), t);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
