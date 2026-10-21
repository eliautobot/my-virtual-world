// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Checks of the release tooling that need no running service: script syntax, missing configuration, backup
// manifests. The full flow (promote, rollback, restore on a real systemd unit) is rehearsed on a throwaway install.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ROOT, tempDir } from './helpers/server.mjs';

const DEPLOY = path.join(ROOT, 'tools', 'deploy');
const scripts = fs.readdirSync(DEPLOY).filter(f => f.endsWith('.sh'));

test('every deploy script parses', () => {
  assert.ok(scripts.length >= 7, `found ${scripts.join(', ')}`);
  for (const f of scripts) {
    const r = spawnSync('bash', ['-n', path.join(DEPLOY, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('the deploy scripts stop when their configuration is missing', () => {
  const r = spawnSync('bash', [path.join(DEPLOY, 'promote.sh'), 'v0.0.0'], {
    encoding: 'utf8',
    env: { ...process.env, MVW_DEPLOY_ENV: path.join(os.tmpdir(), `mvw-missing-${process.pid}-${Date.now()}.env`) },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /deploy config not found/);
});

test('a backup manifest lists every data file with its hash, and the world counts', () => {
  const dir = tempDir();
  try {
    const world = JSON.stringify({ version: 3, buildings: [{ id: 'b0' }, { id: 'b1', gone: 1 }, null, { id: 'b3' }] });
    const people = JSON.stringify([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
    fs.writeFileSync(path.join(dir, 'world.json'), world);
    fs.writeFileSync(path.join(dir, 'people.json'), people);
    const r = spawnSync(process.execPath, [path.join(DEPLOY, 'manifest.mjs'), dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const m = JSON.parse(r.stdout);
    assert.deepEqual(m.counts, { buildings: 2, people: 3, worldVersion: 3 });
    const sha = s => crypto.createHash('sha256').update(s).digest('hex');
    assert.deepEqual(m.files.map(f => [f.name, f.bytes, f.sha256]), [
      ['people.json', Buffer.byteLength(people), sha(people)],
      ['world.json', Buffer.byteLength(world), sha(world)],
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('configcheck.mjs checks a configuration the way this release reads it, and creates nothing', () => {
  const dir = tempDir('mvw-configcheck-');
  try {
    const run = (env, ...args) => spawnSync(process.execPath, [path.join(DEPLOY, 'configcheck.mjs'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
    const base = { MVW_DATA: path.join(dir, 'data'), MVW_KEY_FILE: path.join(dir, 'secret.key') };
    let r = run(base);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^configuration ok: port 8570 on 0\.0\.0\.0, data folder .+ \(this environment, checked by .+\)$/m);
    r = run({ ...base, PORT: 'eighty', MVW_POPULATION: '0' });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /^2 settings need fixing:\n {2}- PORT .+\n {2}- MVW_POPULATION .+\nThe configuration does not work/m);
    assert.ok(!fs.existsSync(path.join(dir, 'data')) && !fs.existsSync(path.join(dir, 'secret.key')), 'nothing was created');
    assert.equal(run(base, '--bogus').status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
