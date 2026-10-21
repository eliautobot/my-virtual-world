// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// tools/deploy/dbcopy.mjs: a consistent, private copy of a running server's accounts database, taken while it writes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { DatabaseSync } from '../server/sqlite.js';
import { ROOT, startServer, ownerSession, tempDir } from './helpers/server.mjs';

let s, dir;
before(async () => { s = await startServer({ population: 60 }); dir = tempDir('mvw-dbcopy-'); });
after(async () => { await s?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const copy = (src, dest) => new Promise(resolve => {
  const p = spawn(process.execPath, ['tools/deploy/dbcopy.mjs', src, dest], { cwd: ROOT });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.stderr.on('data', d => { out += d; });
  p.on('exit', code => resolve({ code, out }));
});

test('copies a running server\'s database while accounts are being created', async () => {
  const owner = await ownerSession(s);
  let n = 0, stop = false;
  const writer = (async () => {
    while (!stop) {
      const r = await owner.post('/api/users', { login: `copy${n}`, displayName: `Copy ${n}` });
      assert.equal(r.status, 201, r.text);
      n++;
    }
  })();
  await new Promise(r => setTimeout(r, 150));
  const dest = path.join(dir, 'next.db');
  const r = await copy(path.join(s.data, 'next.db'), dest);
  stop = true;
  await writer;
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /integrity ok/);
  assert.equal(fs.statSync(dest).mode & 0o777, 0o600);
  const db = new DatabaseSync(dest);
  try {
    const accounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
    assert.ok(accounts >= 2 && accounts <= n + 1, `${accounts} accounts in the copy (owner + ${n} created)`);
    assert.equal(db.prepare("SELECT role FROM accounts WHERE login = 'owner'").get().role, 'owner');
  } finally { db.close(); }
});

test('refuses a missing source and removes a failed copy', async () => {
  const r = await copy(path.join(dir, 'missing.db'), path.join(dir, 'x.db'));
  assert.equal(r.code, 1);
  assert.equal(fs.existsSync(path.join(dir, 'x.db')), false);
});
