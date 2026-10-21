// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The secret store and the settings tiers (PLAN WP1.5; CHECKLIST I14.16; DECISIONS C85–C100): credential names, the
// redaction helper, sealing, where the key comes from, rotation while running, the settings service with declared test
// entries (no real secret setting exists before the next phase, C93), recovery codes across rotations, and the host and
// deploy tools (new-key, rotate-key, forget-secrets, status, keycheck, reseal-copy).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { isCredentialName, redact, scrub, REDACTED } from '../server/redact.js';
import { SecretBox, SealError, newKey, fingerprint, readKeyFile, writeKeyFile, keySource } from '../server/secrets.js';
import { registerSecretHolders, aadInstall, SECRET_PREFIX, RECOVERY_KEY } from '../server/secret-holders.js';
import { Settings, SETTINGS, defineSetting } from '../server/settings.js';
import { Permissions } from '../server/auth/permissions.js';
import { Accounts } from '../server/auth/accounts.js';
import { Audit } from '../server/auth/audit.js';
import { totp, base32Decode } from '../server/auth/totp.js';
import { openDb } from '../server/db.js';
import { ROOT, tempDir } from './helpers/server.mjs';

const PASSWORD = 'Correct-Horse-Battery-9';
const b64 = k => k.toString('base64');
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise(r => setTimeout(r, 25));
  }
};
/** Runs a tool with a clean environment: no inherited key or data settings. */
function run(script, args, env = {}) {
  const base = { ...process.env };
  for (const k of ['MVW_KEY_FILE', 'MVW_SECRET_KEY', 'MVW_SECRET_KEY_PREVIOUS', 'MVW_DATA']) delete base[k];
  return spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...base, ...env } });
}

test('credential names: the rule agrees with all 75 answers of Jev batches 21b and 23 (C89, C94)', () => {
  const { names } = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/credential-names.json'), 'utf8'));
  assert.equal(Object.keys(names).length, 75);
  for (const [n, p] of Object.entries(names)) assert.equal(isCredentialName(n), p >= 0.5, `${n}: Jev ${p}`);
  assert.equal(isCredentialName(''), false);
});

test('redaction: fields named like credentials, Set-Cookie, known secrets and Bearer tokens; flags and structure stay (C89, C94)', () => {
  const known = new Set(['fake-key-abcdef1234567890']);
  const input = {
    apiKey: 'x1', count: 3, note: 'uses fake-key-abcdef1234567890 now', 'set-cookie': ['a=b'],
    nested: { password: 'p', secret: true, token: '', list: [{ accessToken: 'y', model: 'm' }] },
  };
  assert.deepEqual(redact(input, known), {
    apiKey: REDACTED, count: 3, note: `uses ${REDACTED} now`, 'set-cookie': REDACTED,
    nested: { password: REDACTED, secret: true, token: '', list: [{ accessToken: REDACTED, model: 'm' }] },
  });
  assert.equal(input.apiKey, 'x1', 'the original is untouched');
  assert.equal(scrub('Authorization: Bearer abcdef0123456789xyz'), `Authorization: Bearer ${REDACTED}`);
  assert.equal(scrub('Basic plan, 12 months'), 'Basic plan, 12 months');
  assert.equal(redact(new Error('failed with fake-key-abcdef1234567890'), known).includes('fake-key'), false);
  const loop = { a: 1 };
  loop.self = loop;
  assert.deepEqual(redact(loop), { a: 1, self: '[circular]' });
  assert.equal(redact(Buffer.from('abc')), '[3 bytes]');
});

// Release 1.2's reader and writer (server/auth/totp.js open() and seal() of v1.2.0), to check both ways of a rollback.
function open12(key, sealed, aad) {
  const [v, iv, ct, tag] = String(sealed).split(':');
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
function seal12(key, plaintext, aad) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return ['v1', iv, ct, c.getAuthTag()].map(x => (typeof x === 'string' ? x : x.toString('base64url'))).join(':');
}
const load12 = file => Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');

test('sealing: AES-256-GCM bound to its place, with the key fingerprint; release 1.2 and this one read each other (C93)', () => {
  const k1 = newKey(), box = new SecretBox();
  box.setKeys([k1]);
  const s = box.seal('JBSWY3DPEHPK3PXP', 'w|7'), parts = s.split(':');
  assert.deepEqual([parts.length, parts[0], parts[4]], [5, 'v1', fingerprint(k1)]);
  assert.equal(s.includes('JBSWY3DPEHPK3PXP'), false);
  assert.equal(box.open(s, 'w|7'), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => box.open(s, 'w|8'), SealError, 'bound to its place');
  assert.equal(open12(k1, s, 'w|7'), 'JBSWY3DPEHPK3PXP', 'release 1.2 reads it');
  assert.equal(box.open(seal12(k1, 'written by 1.2', 'w|1'), 'w|1'), 'written by 1.2');
  assert.equal(box.known.has('JBSWY3DPEHPK3PXP'), true, 'the logger learns it');
  const dir = tempDir('mvw-seal-');
  try {
    const file = path.join(dir, 'secret.key'), k2 = newKey();
    writeKeyFile(file, [k2, k1]);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(load12(file), k2, 'release 1.2 reads the current key from a file that also holds the previous one');
    assert.deepEqual(readKeyFile(file).map(fingerprint), [fingerprint(k2), fingerprint(k1)]);
    fs.writeFileSync(file, `${b64(k1)}\n${b64(k2)}\n${b64(newKey())}\n`);
    assert.throws(() => readKeyFile(file), /one key, or the current and the previous key/);
    const other = new SecretBox();
    other.setKeys([k2]);
    assert.throws(() => box.open(other.seal('x', 'a'), 'a'), new RegExp(`sealed with key ${fingerprint(k2)}, which is not loaded`));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('where the key comes from: exactly one source, never inside the data folder, created only when nothing is sealed (C86, C95)', () => {
  const root = tempDir('mvw-keysrc-'), data = path.join(root, 'data');
  fs.mkdirSync(data);
  try {
    assert.throws(() => keySource({}, data), /No key for stored secrets/);
    assert.throws(() => keySource({ MVW_SECRET_KEY: 'k', MVW_KEY_FILE: 'f' }, data), /Both MVW_SECRET_KEY and MVW_KEY_FILE are set/);
    assert.throws(() => keySource({ MVW_KEY_FILE: path.join(data, 'secret.key') }, data), /inside the data folder/);
    assert.throws(() => keySource({ MVW_KEY_FILE: 'secret.key' }, data), /must be an absolute path/, 'never relative (C101)');
    fs.symlinkSync(data, path.join(root, 'link'));
    assert.throws(() => keySource({ MVW_KEY_FILE: path.join(root, 'link', 'secret.key') }, data), /inside the data folder/, 'also through a link');
    assert.deepEqual(keySource({ MVW_SECRET_KEY: 'k' }, data), { source: 'env', file: null });
    const file = path.join(root, 'keys', 'secret.key');
    assert.equal(new SecretBox().load({ env: { MVW_KEY_FILE: file }, dataDir: data }).created, true);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(new SecretBox().load({ env: { MVW_KEY_FILE: file }, dataDir: data }).created, false);
    fs.chmodSync(file, 0o644);
    assert.match(new SecretBox().load({ env: { MVW_KEY_FILE: file }, dataDir: data }).warnings.join(), /now readable only by its owner/);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const k = newKey(), kp = newKey(), env = new SecretBox();
    assert.match(env.load({ env: { MVW_SECRET_KEY: b64(k), MVW_SECRET_KEY_PREVIOUS: b64(kp) } }).warnings.join(), /the key comes from MVW_SECRET_KEY/, 'C101');
    assert.deepEqual(env.fps, [fingerprint(k), fingerprint(kp)]);
    assert.throws(() => new SecretBox().load({ env: { MVW_SECRET_KEY: 'short' } }), /MVW_SECRET_KEY is not a 32-byte key/);
    const held = new SecretBox();
    held.register({ name: 'test', list: () => [{ id: 1, sealed: 'v1:a:b:c:0123456789ab', aad: 'x', label: 'a test value' }], update() {}, forget() {} });
    const missing = path.join(root, 'missing.key');
    assert.throws(() => held.load({ env: { MVW_KEY_FILE: missing }, dataDir: data }), /does not exist, but the database holds 1 sealed secret/);
    assert.equal(fs.existsSync(missing), false, 'never created over sealed values');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rotation while running: a new key file is taken and everything sealed again; a wrong one is kept out until fixed or recorded (C87, C98)', async () => {
  const root = tempDir('mvw-rot-'), file = path.join(root, 'secret.key');
  const mem = new Map(), logs = [];
  let expected = null;
  const box = new SecretBox();
  box.register({
    name: 'memory', list: () => [...mem].map(([id, sealed]) => ({ id, sealed, aad: `mem|${id}`, label: id })),
    update: (id, v) => mem.set(id, v), forget: id => mem.delete(id),
  });
  try {
    box.load({ env: { MVW_KEY_FILE: file }, dataDir: path.join(root, 'data') });
    const k1 = box.keys[0];
    mem.set('a', box.seal('alpha-secret-1', 'mem|a'));
    mem.set('b', box.seal('beta-secret-2', 'mem|b'));
    box.watch({ tx: fn => fn(), log: m => logs.push(m), intervalMs: 50, expectedKey: () => expected });
    const allSealedWith = k => [...mem.values()].every(v => SecretBox.fingerprintOf(v) === fingerprint(k));
    const k2 = newKey();
    writeKeyFile(file, [k2, k1]); box.checkNow?.();
    await until(() => box.fps[0] === fingerprint(k2) && allSealedWith(k2), 30000);
    assert.equal(box.open(mem.get('a'), 'mem|a'), 'alpha-secret-1');
    writeKeyFile(file, [newKey()]); box.checkNow?.();
    await until(() => box.status().problem, 30000);
    assert.equal(box.fps[0], fingerprint(k2), 'the keys loaded before stay');
    assert.match(box.status().problem, /cannot open 2 stored secrets; keeping the keys loaded before/);
    assert.match(logs.join('\n'), /keeping the keys loaded before/);
    writeKeyFile(file, [k2, k1]); box.checkNow?.();
    await until(() => !box.status().problem);
    const k3 = newKey();
    expected = fingerprint(k3);                      // what rotate-key records before it writes the file
    writeKeyFile(file, [k3]); box.checkNow?.();
    await until(() => box.fps.join() === fingerprint(k3) && allSealedWith(k3));
    assert.equal(box.open(mem.get('b'), 'mem|b'), 'beta-secret-2');
    assert.match(logs.join('\n'), /recorded new key/);
  } finally {
    box.unwatch();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the settings service: tiers, set / not set, a blank value keeps a secret, tiers 1–2 need a recent password entry (C85, C90, C92, C93)', () => {
  const dir = tempDir('mvw-settings-'), st = openDb(dir);
  try {
    const box = registerSecretHolders(new SecretBox(), st);
    box.setKeys([newKey()]);
    const perms = new Permissions(st), audit = new Audit(st);
    const now = Date.now();
    const TEST = [
      defineSetting({ path: 'test.provider.apiKey', scope: 'install', type: 'string', label: 'Test provider key' }),
      defineSetting({ path: 'test.gateway.url', scope: 'install', tier: 2, type: 'string', label: 'Test gateway address' }),
      defineSetting({ path: 'test.voice.apiKey', scope: 'account', type: 'secret', label: 'Test speech key' }),
    ];
    assert.deepEqual([TEST[0].type, TEST[0].tier, TEST[0].cap], ['secret', 1, 'settings.secrets'], 'a name like a credential makes a tier 1 secret');
    assert.equal(TEST[1].cap, 'settings.infrastructure');
    assert.throws(() => defineSetting({ path: 'test.flag', scope: 'install', tier: 1, type: 'boolean' }), /tier 1 holds secrets only/);
    assert.ok(SETTINGS.filter(e => e.scope === 'install').every(e => e.tier === 2), 'today\'s installation settings are infrastructure (C90)');
    assert.deepEqual(SETTINGS.filter(e => e.editions || /^(email|auth|commerce)\./.test(e.path)).map(e => e.path), [], 'no sign-in providers, account emails or shop here');
    assert.ok(SETTINGS.filter(e => e.scope === 'account').every(e => e.tier === 0), 'display preferences are tier 0 (C100)');
    const set = new Settings(st, { perms, box, audit, entries: [...SETTINGS, ...TEST], now: () => now });
    const ins = st.db.prepare(`INSERT INTO accounts (world_id, login, display_name, display_key, role, password_hash, password_changed, created, updated)
      VALUES (?, ?, ?, ?, ?, 'x', ?, ?, ?)`);
    const ids = {}, roles = { owner: 'owner', admin1: 'admin', member1: 'member' };
    for (const [login, role] of Object.entries(roles)) ids[login] = Number(ins.run(st.worldId, login, login, login, role, now, now, now).lastInsertRowid);
    const P = (login, ageMs = 0) => ({ account: { id: ids[login], login, role: roles[login] }, role: roles[login], restricted: false, session: { id: 1, authAt: now - ageMs } });
    const OLD = 11 * 60000, secret = 'fake-test-0123456789abcdef', code = c => e => e.code === c;
    assert.throws(() => set.changeInstall(P('admin1', OLD), { 'test.provider.apiKey': secret }), code('reauth_required'));
    assert.throws(() => set.changeInstall(P('member1'), { 'test.provider.apiKey': secret }), code('forbidden'));
    set.changeInstall(P('admin1'), { 'test.provider.apiKey': secret });
    assert.throws(() => set.changeInstall(P('admin1'), { 'test.gateway.url': 'ws://gw.example:1' }), code('forbidden'), 'infrastructure is the owner\'s');
    set.changeInstall(P('owner'), { 'test.gateway.url': 'ws://gw.example:1' });
    const view = set.installView(P('admin1')), row = p => view.settings.find(x => x.path === p);
    assert.equal(row('test.provider.apiKey').set, true);
    assert.equal('value' in row('test.provider.apiKey'), false, 'secrets only as set / not set');
    assert.equal(JSON.stringify(view).includes(secret), false);
    assert.equal(row('test.gateway.url').value, 'ws://gw.example:1');
    assert.deepEqual([row('audit.retentionDays').canChange, row('audit.retentionDays').why], [false, 'Only the owner can change this']);
    assert.equal(set.secret('test.provider.apiKey'), secret);
    const raw = st.db.prepare('SELECT value FROM settings WHERE key = ?').get(`${SECRET_PREFIX}test.provider.apiKey`).value;
    assert.equal(raw.includes(secret), false);
    assert.equal(SecretBox.fingerprintOf(raw), box.fps[0]);
    set.changeInstall(P('admin1', OLD), { 'test.provider.apiKey': '' });
    assert.equal(set.secret('test.provider.apiKey'), secret, 'a blank value keeps it, without a password entry');
    set.changeInstall(P('admin1'), { 'test.provider.apiKey': null });
    assert.equal(set.secret('test.provider.apiKey'), null, 'null clears it');
    assert.equal(set.installView(P('admin1')).settings.find(x => x.path === 'test.provider.apiKey').set, false);
    const changes = audit.list({ group: 'settings' }).map(e => e.detail.changes['test.provider.apiKey']).filter(Boolean);
    assert.deepEqual(changes.sort(), ['cleared', 'set'], 'the audit log says set / cleared, never the value');
    // account settings: preferences without a password entry, the own secrets with one
    const m = P('member1', OLD);
    set.changeAccount(m, { 'display.labels': false, 'display.walls': 'up' });
    assert.throws(() => set.changeAccount(m, { 'test.voice.apiKey': 'voice-key-123456' }), code('reauth_required'));
    set.changeAccount(P('member1'), { 'test.voice.apiKey': 'voice-key-123456' });
    const av = set.accountView(P('member1')), arow = p => av.settings.find(x => x.path === p);
    assert.deepEqual([arow('display.labels').value, arow('display.labels').stored], [false, true]);
    assert.deepEqual([arow('display.seenHelp').value, arow('display.seenHelp').stored], [false, false]);
    assert.deepEqual([arow('display.walls').value, arow('test.voice.apiKey').set], ['up', true]);
    assert.equal(JSON.stringify(av).includes('voice-key-123456'), false);
    assert.equal(set.accountSecret(ids.member1, 'test.voice.apiKey'), 'voice-key-123456');
    assert.throws(() => set.changeAccount(P('member1'), { 'display.walls': 'sideways' }), e => e.status === 400);
    assert.throws(() => set.changeAccount(P('member1'), { 'world.requireSignIn': true }), e => e.status === 400);
    assert.throws(() => set.changeInstall(P('owner'), { 'no.such': 1 }), e => e.status === 400);
    const cred = audit.list({ group: 'credentials' });
    assert.ok(cred.some(e => e.action === 'account.secret' && e.detail.changes['test.voice.apiKey'] === 'set'));
    assert.equal(JSON.stringify(audit.list({ limit: 5000 })).includes('display.'), false, 'preference changes are not audited (C92)');
    assert.equal(JSON.stringify(audit.list({ limit: 5000 })).includes('voice-key-123456'), false);
    // a rotation reaches settings secrets through their holders
    set.changeInstall(P('admin1'), { 'test.provider.apiKey': secret });
    const k2 = newKey();
    box.setKeys([k2, ...box.keys]);
    assert.equal(box.reseal(fn => st.tx(fn)), 2);
    assert.ok(box.values().every(v => SecretBox.fingerprintOf(v.sealed) === fingerprint(k2)));
    assert.equal(set.secret('test.provider.apiKey'), secret);
    // deleting an account deletes its settings and secrets
    st.db.prepare('DELETE FROM accounts WHERE id = ?').run(ids.member1);
    assert.equal(st.db.prepare('SELECT COUNT(*) AS n FROM account_settings').get().n, 0);
  } finally {
    st.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recovery codes have their own random key: they survive key rotations; forgetting that key deletes them (C96, C97)', async () => {
  const dir = tempDir('mvw-recovery-'), st = openDb(dir);
  try {
    const box = registerSecretHolders(new SecretBox(), st);
    box.setKeys([newKey()]);
    const acc = new Accounts(st, { dataDir: dir, box, audit: new Audit(st) });
    const { user } = await acc.createAccount({ login: 'tf1', displayName: 'TF One', role: 'member', password: PASSWORD, mustChange: false });
    const P = { account: { id: user.id, login: 'tf1' }, role: 'member', session: { id: 1, authAt: Date.now() } };
    const key = base32Decode(acc.twofaSetup(P).secret);
    const { codes } = acc.twofaEnable(P, totp(key, Date.now()));
    const row = () => st.db.prepare('SELECT * FROM accounts WHERE id = ?').get(user.id);
    const rk = () => st.db.prepare('SELECT value FROM settings WHERE key = ?').get(`${SECRET_PREFIX}${RECOVERY_KEY}`)?.value;
    assert.equal(SecretBox.fingerprintOf(rk()), box.fps[0], 'the recovery-code key is stored sealed');
    assert.equal(acc.checkSecondFactor(row(), codes[0], Date.now()), 'recovery');
    box.setKeys([newKey(), ...box.keys]);
    box.reseal(fn => st.tx(fn));
    assert.equal(SecretBox.fingerprintOf(rk()), box.fps[0]);
    assert.equal(acc.checkSecondFactor(row(), codes[1], Date.now()), 'recovery', 'codes survive a rotation');
    const rec = box.holders.find(h => h.kind === 'recovery');
    st.tx(() => rec.forget(RECOVERY_KEY));
    assert.equal(rk(), undefined);
    assert.equal(acc.twofaStatus(P).recoveryLeft, 0);
    assert.equal(acc.checkSecondFactor(row(), codes[2], Date.now()), null);
    const fresh = acc.twofaRecovery(P).codes;
    assert.equal(acc.checkSecondFactor(row(), fresh[0], Date.now()), 'recovery', 'new codes come with a new key');
  } finally {
    st.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A data folder whose next.db holds a two-factor secret, the recovery-code key and one installation secret, all sealed
 *  with a key file outside it. */
async function sealedData() {
  const root = tempDir('mvw-keys-'), data = path.join(root, 'data'), keyFile = path.join(root, 'live.key');
  fs.mkdirSync(data);
  const st = openDb(data);
  try {
    const box = registerSecretHolders(new SecretBox(), st);
    box.load({ env: { MVW_KEY_FILE: keyFile }, dataDir: data });
    const acc = new Accounts(st, { dataDir: data, box });
    const { user } = await acc.createAccount({ login: 'tf1', displayName: 'TF One', role: 'member', password: PASSWORD, mustChange: false });
    const P = { account: { id: user.id, login: 'tf1' }, role: 'member', session: { id: 1, authAt: Date.now() } };
    const setup = acc.twofaSetup(P);
    acc.twofaEnable(P, totp(base32Decode(setup.secret), Date.now()));
    st.db.prepare('INSERT INTO settings (world_id, key, value) VALUES (?, ?, ?)')
      .run(st.worldId, `${SECRET_PREFIX}test.provider.apiKey`, box.seal('sk-provider-0123456789', aadInstall(st.worldId, 'test.provider.apiKey')));
    return { root, data, keyFile, totpSecret: setup.secret.replace(/\s/g, '') };
  } finally { st.close(); }
}
function openBox(data, keyFile) {
  const st = openDb(data), box = registerSecretHolders(new SecretBox(), st);
  box.load({ env: { MVW_KEY_FILE: keyFile }, dataDir: data, create: false });
  return { st, box };
}

test('keycheck: promote.sh stops before touching live when the key cannot open the stored secrets (C98)', async () => {
  const f = await sealedData();
  const empty = tempDir('mvw-keys-');
  try {
    const check = env => run('tools/deploy/keycheck.mjs', ['--data', f.data], env);
    const ok = check({ MVW_KEY_FILE: f.keyFile });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /key ok: .* 3 stored secrets open with it/);
    const other = path.join(f.root, 'other.key');
    writeKeyFile(other, [newKey()]);
    const bad = check({ MVW_KEY_FILE: other });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /holds secrets this server cannot open: 3 sealed with key [0-9a-f]{12}/);
    assert.match(check({}).stderr, /No key for stored secrets/);
    assert.match(check({ MVW_KEY_FILE: path.join(f.data, 'k') }).stderr, /inside the data folder/);
    assert.match(check({ MVW_KEY_FILE: path.join(f.root, 'missing.key') }).stderr, /does not exist, but the database holds 3 sealed secrets/);
    const fresh = run('tools/deploy/keycheck.mjs', ['--data', path.join(empty, 'data')], { MVW_KEY_FILE: path.join(empty, 'k') });
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.match(fresh.stdout, /does not exist yet and nothing is sealed/);
    assert.equal(run('tools/deploy/keycheck.mjs', []).status, 2);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('reseal-copy: a staging copy keeps the sign-in secrets under its own key and loses the service secrets (C99)', async () => {
  const f = await sealedData();
  try {
    const staging = path.join(f.root, 'staging'), sdata = path.join(staging, 'data'), skey = path.join(staging, 'staging.key');
    fs.mkdirSync(sdata, { recursive: true });
    fs.copyFileSync(path.join(f.data, 'next.db'), path.join(sdata, 'next.db'));
    const r = run('tools/deploy/reseal-copy.mjs', ['--data', sdata, '--from-key-file', f.keyFile, '--to-key-file', skey]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 sign-in secrets sealed again with staging's key [0-9a-f]{12}; 1 service secret deleted/);
    assert.equal(fs.statSync(skey).mode & 0o777, 0o600);
    const { st, box } = openBox(sdata, skey);
    try {
      const vals = box.values();
      assert.deepEqual(vals.map(v => v.holder.kind).sort(), ['recovery', 'twofa']);
      assert.equal(box.unreadable().length, 0);
      const tf = vals.find(v => v.holder.kind === 'twofa');
      assert.equal(box.open(tf.sealed, tf.aad), f.totpSecret, 'the same two-factor secret, so sign-in works as on live');
      const live = new SecretBox();
      live.load({ env: { MVW_KEY_FILE: f.keyFile }, create: false });
      assert.throws(() => live.open(tf.sealed, tf.aad), SealError, 'sealed with staging\'s key, not live\'s');
    } finally { st.close(); }
    const same = run('tools/deploy/reseal-copy.mjs', ['--data', sdata, '--from-key-file', skey, '--to-key-file', skey]);
    assert.equal(same.status, 1);
    assert.match(same.stderr, /same key as live/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('host key commands: new-key, status, rotate-key (and --forget), forget-secrets (C87, C88, C96)', async () => {
  const f = await sealedData();
  try {
    const admin = (args, env = {}) => run('tools/admin.mjs', [...args, '--data', f.data], env);
    const nk = path.join(f.root, 'new.key');
    const n1 = run('tools/admin.mjs', ['new-key', nk]);
    assert.equal(n1.status, 0, n1.stderr);
    assert.equal(fs.statSync(nk).mode & 0o777, 0o600);
    assert.equal(n1.stdout.includes(fs.readFileSync(nk, 'utf8').trim()), false, 'the key is never printed');
    assert.equal(run('tools/admin.mjs', ['new-key', nk]).status, 1, 'never over an existing file');
    assert.equal(admin(['new-key', path.join(f.data, 'k')]).status, 1, 'never inside the data folder');
    const st1 = admin(['status', '--key-file', f.keyFile]);
    assert.equal(st1.status, 0, st1.stderr);
    assert.match(st1.stdout, /^key +file .*live\.key, key [0-9a-f]{12}$/m);
    assert.match(st1.stdout, /^secrets +3 sealed \(/m);
    const before = readKeyFile(f.keyFile).map(fingerprint);
    const r1 = admin(['rotate-key', '--key-file', f.keyFile]);
    assert.equal(r1.status, 0, r1.stderr);
    const after = readKeyFile(f.keyFile).map(fingerprint);
    assert.equal(after.length, 2);
    assert.equal(after[1], before[0], 'the old key stays as the previous one');
    assert.notEqual(after[0], before[0]);
    let o = openBox(f.data, f.keyFile);
    try {
      assert.ok(o.box.values().every(v => SecretBox.fingerprintOf(v.sealed) === after[0]), 'everything sealed with the new key');
      assert.equal(o.st.db.prepare("SELECT value FROM settings WHERE key = 'secrets.expectedKey'").get().value, after[0]);
    } finally { o.st.close(); }
    const r2 = admin(['rotate-key', '--forget', '--key-file', f.keyFile]);
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /10 recovery codes deleted/);
    assert.equal(readKeyFile(f.keyFile).length, 1, 'the old key is gone at once');
    o = openBox(f.data, f.keyFile);
    try {
      assert.deepEqual(o.box.values().map(v => v.holder.kind).sort(), ['install', 'twofa']);
      assert.equal(o.box.unreadable().length, 0);
      assert.equal(o.st.db.prepare('SELECT COUNT(*) AS n FROM recovery_codes').get().n, 0);
      const host = o.st.db.prepare("SELECT action, detail FROM audit WHERE action LIKE 'host.%'").all();
      assert.equal(host.filter(a => a.action === 'host.rotate_key').length, 2);
      assert.equal(JSON.stringify(host).includes(fs.readFileSync(f.keyFile, 'utf8').trim()), false);
    } finally { o.st.close(); }
    const env = admin(['rotate-key'], { MVW_SECRET_KEY: b64(newKey()) });
    assert.equal(env.status, 2);
    assert.match(env.stderr, /MVW_SECRET_KEY_PREVIOUS/);
    const noYes = admin(['forget-secrets', '--all']);
    assert.equal(noYes.status, 1, 'deleting everything needs --yes (C101)');
    assert.match(noYes.stderr, /would delete all 2 stored secrets[\s\S]*--yes/);
    const rel = run('tools/admin.mjs', ['status', '--data', f.data, '--key-file', path.relative(ROOT, f.keyFile)]);
    assert.match(rel.stdout, /^key +file .*live\.key, key [0-9a-f]{12}$/m, 'a relative --key-file is resolved against the folder the command runs in');
    const other = path.join(f.root, 'other.key');
    writeKeyFile(other, [newKey()]);
    const fu = admin(['forget-secrets', '--unreadable', '--key-file', other]);
    assert.equal(fu.status, 0, fu.stderr);
    assert.match(fu.stdout, /Deleted 2 stored secrets/);
    assert.equal(admin(['forget-secrets', '--all']).stdout.trim(), 'Nothing to delete.');
    assert.equal(admin(['forget-secrets']).status, 2);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('unit environments: Environment= words, and EnvironmentFile= lines that override them', async () => {
  const { parseEnvironment, parseEnvFile } = await import('../tools/deploy/unitenv.mjs');
  assert.deepEqual(parseEnvironment('PORT=8570 MVW_KEY_FILE=/srv/mvw/secret.key "NAME=My World" EMPTY='),
    { PORT: '8570', MVW_KEY_FILE: '/srv/mvw/secret.key', NAME: 'My World', EMPTY: '' });
  assert.deepEqual(parseEnvironment(''), {});
  assert.deepEqual(parseEnvFile('# comment\nA=1\nB = "x y"\n\nC=\'z\'\nnot a setting\n'), { A: '1', B: 'x y', C: 'z' });
});
