// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// tools/admin.mjs against a running throwaway server: status, reset-owner, create-account, sessions-clear.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import zlib from 'node:zlib';
import { DatabaseSync } from '../server/sqlite.js';
import { ROOT, startServer, httpClient, ownerSession, ownerTempPassword, setupCodeOf, strongPassword } from './helpers/server.mjs';

let s;
before(async () => { s = await startServer({ population: 60 }); });
after(async () => { await s?.stop(); });
const admin = (args, input) => spawnSync(process.execPath, ['tools/admin.mjs', ...args, '--data', s.data], { cwd: ROOT, input, encoding: 'utf8' });

test('before the administrator exists: status says how to make it, reset-owner writes a new setup code; never printed', async () => {
  const first = setupCodeOf(s.data);
  const st = admin(['status']);
  assert.equal(st.status, 0, st.stderr);
  assert.match(st.stdout, /owner +none yet: open the world in a browser and create it with the setup code in .*setup-code\.txt/);
  assert.equal(st.stdout.includes(first), false);
  const r = admin(['reset-owner']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /new setup code is in/);
  const second = setupCodeOf(s.data);
  assert.notEqual(second, first);
  assert.equal(fs.statSync(path.join(s.data, 'setup-code.txt')).mode & 0o777, 0o600);
  assert.equal((r.stdout + r.stderr).includes(second), false);
  assert.equal((await httpClient(s.url).post('/api/auth/setup', { code: first, login: 'owner', displayName: 'Owner', password: strongPassword() })).status, 403, 'the old code no longer works');
});

test('status and reset-owner never print a password; the new temporary password replaces the owner\'s', async () => {
  const owner = await ownerSession(s);
  const st = admin(['status']);
  assert.match(st.stdout, /owner +owner \(Owner\), active\n/);
  const r = admin(['reset-owner']);
  assert.equal(r.status, 0, r.stderr);
  const file = path.join(s.data, 'first-owner-password.txt'), temp = ownerTempPassword(s.data);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal((r.stdout + r.stderr).includes(temp), false);
  assert.match(admin(['status']).stdout, /owner +owner \(Owner\), active, temporary password until/);
  assert.equal((await httpClient(s.url).post('/api/auth/signin', { login: 'owner', password: owner.password })).status, 401);
  const c = httpClient(s.url);
  assert.equal((await c.post('/api/auth/signin', { login: 'owner', password: temp })).json.restricted, true);
  // back to a password of its own, for the tests after
  const pw = strongPassword();
  assert.equal((await c.post('/api/account/password', { current: temp, password: pw })).status, 200);
  s.ownerPassword = pw;
});

test('create-account reads the password from standard input and applies the policy', async () => {
  assert.equal(admin(['create-account', '--login', 'ops1', '--name', 'Ops One', '--role', 'admin', '--password-stdin'], 'short\n').status, 1);
  const pw = strongPassword();
  const r = admin(['create-account', '--login', 'ops1', '--name', 'Ops One', '--role', 'admin', '--password-stdin'], `${pw}\n`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.includes(pw), false);
  const c = httpClient(s.url);
  const me = (await c.post('/api/auth/signin', { login: 'ops1', password: pw })).json;
  assert.equal(me.role, 'admin');
  assert.equal(me.restricted, false);
  assert.equal(admin(['create-account', '--login', 'ops2', '--name', 'Ops Two', '--role', 'owner', '--password-stdin'], `${pw}\n`).status, 2, 'no second owner');
  assert.equal(admin(['frobnicate']).status, 2);
});

test('sessions-clear signs everyone out', async () => {
  const owner = await ownerSession(s);
  assert.equal((await owner.get('/api/account/devices')).status, 200);
  const r = admin(['sessions-clear']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Signed out \d+ sessions/);
  assert.equal((await owner.get('/api/account/devices')).status, 401);
});

test('unlock and list-admins; host actions are recorded in the audit log', async () => {
  const g = httpClient(s.url);
  for (let k = 0; k < 5; k++) await g.post('/api/auth/signin', { login: 'ops1', password: 'Wrong-Password-00' });
  const pwFile = admin(['list-admins']);
  assert.equal(pwFile.status, 0, pwFile.stderr);
  assert.match(pwFile.stdout, /^owner +owner +Owner/m);
  assert.match(pwFile.stdout, /^admin +ops1 +Ops One/m);
  const u = admin(['unlock', 'ops1']);
  assert.equal(u.status, 0, u.stderr);
  assert.match(u.stdout, /Unlocked "ops1"/);
  assert.equal(admin(['unlock', 'nobody-at-all']).status, 1);
  const db = new DatabaseSync(path.join(s.data, 'next.db'), { timeout: 5000 });
  try {
    const acts = db.prepare("SELECT action FROM audit WHERE action LIKE 'host.%'").all().map(r => r.action);
    for (const a of ['host.reset_owner', 'host.create_account', 'host.sessions_clear', 'host.unlock']) assert.ok(acts.includes(a), a);
  } finally { db.close(); }
});

/** The names in a ustar archive, checking each header's magic and checksum. */
function tarNames(buf) {
  const names = [];
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const name = h.toString('utf8', 0, 100).replace(/\0[\s\S]*$/, '');
    assert.equal(h.toString('ascii', 257, 262), 'ustar', name);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    assert.equal(parseInt(h.toString('ascii', 148, 156), 8), sum, `the checksum of ${name}`);
    names.push(name);
    off += 512 + Math.ceil(parseInt(h.toString('ascii', 124, 136), 8) / 512) * 512;
  }
  return names;
}

test('backup: the world files and consistent copies of the databases (accounts, the agents\' PC), without the temporary password; system tar reads it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-backup-test-'));
  // The owner replaced the temporary password in an earlier test, which deletes this file; put one back, so the test
  // shows that a backup leaves it out.
  const ownerFile = path.join(s.data, 'first-owner-password.txt'), made = !fs.existsSync(ownerFile);
  if (made) fs.writeFileSync(ownerFile, 'Temporary password: not-a-real-one\n', { mode: 0o600 });
  try {
    const file = path.join(dir, 'world.tar.gz');
    const r = admin(['backup', '--out', file]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /: meta\.json, people\.json, world\.json, next\.db, pc\/pc\.db \(/);
    assert.match(r.stderr, /The key for stored secrets is not in it/);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(admin(['backup', '--out', file]).status, 1, 'never over an existing file');
    assert.equal(admin(['backup', '--out', path.join(s.data, 'inside.tar.gz')]).status, 1, 'never inside the data folder');

    const out = spawnSync(process.execPath, ['tools/admin.mjs', 'backup', '--data', s.data], { cwd: ROOT });
    assert.equal(out.status, 0, String(out.stderr));
    assert.deepEqual(tarNames(zlib.gunzipSync(out.stdout)), ['meta.json', 'people.json', 'world.json', 'next.db', 'pc/pc.db'], 'to standard output');

    const x = path.join(dir, 'x');
    fs.mkdirSync(x);
    const t = spawnSync('tar', ['-xzf', file, '-C', x], { encoding: 'utf8' });
    assert.equal(t.status, 0, t.stderr);
    assert.deepEqual(fs.readdirSync(x).sort(), ['meta.json', 'next.db', 'pc', 'people.json', 'world.json']);
    const pcCopy = new DatabaseSync(path.join(x, 'pc', 'pc.db'));
    try { assert.equal(pcCopy.prepare("PRAGMA integrity_check").get().integrity_check, 'ok'); } finally { pcCopy.close(); }
    const worldId = JSON.parse(fs.readFileSync(path.join(x, 'world.json'), 'utf8')).worldId;
    assert.ok(worldId);
    const db = new DatabaseSync(path.join(x, 'next.db'));
    try {
      assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'world_id'").get().value, worldId, 'the database belongs to the same world');
      assert.ok(db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE login = 'ops1'").get().n === 1, 'accounts made while the server ran are in it');
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (made) fs.rmSync(ownerFile, { force: true });
  }
});
