// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The server boots on a throwaway data folder, passes every smoke check, reports its version and release, and keeps
// its world across a restart. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { countData, smoke } from '../tools/smoke-lib.mjs';
import { ROOT, startServer } from './helpers/server.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const releaseFile = path.join(ROOT, 'release.json');
const release = fs.existsSync(releaseFile) ? JSON.parse(fs.readFileSync(releaseFile, 'utf8')) : null;

test('a new server passes every smoke check and reports its version and release', async () => {
  const s = await startServer();
  try {
    const r = await smoke({ url: s.url, expectTag: release ? release.tag : null, timeoutMs: 20000 });
    assert.ok(r.ok, JSON.stringify(r.checks, null, 2));
    assert.equal(r.health.version, pkg.version);
    const want = release
      ? { channel: 'release', tag: release.tag, commit: release.commit, builtAt: release.builtAt }
      : { channel: 'dev', tag: null, commit: null, builtAt: null };
    assert.deepEqual(r.health.release, want);
  } finally {
    await s.stop();
  }
});

test('the world and its residents survive a restart', async () => {
  const s = await startServer();
  await s.stop({ keepData: true });
  try {
    const counts = countData(s.data);
    assert.ok(counts.buildings > 0, 'a city was generated');
    assert.ok(counts.people > 0, 'residents were generated');
    const again = await startServer({ data: s.data });
    try {
      const r = await smoke({ url: again.url, expect: counts, timeoutMs: 20000 });
      assert.ok(r.ok, JSON.stringify(r.checks, null, 2));
    } finally {
      await again.stop();
    }
  } finally {
    fs.rmSync(s.data, { recursive: true, force: true });
    fs.rmSync(s.keyFile, { force: true });
  }
});

test('the smoke test fails when no server answers', async () => {
  const r = await smoke({ url: 'http://127.0.0.1:9', timeoutMs: 800 });
  assert.equal(r.ok, false);
  assert.equal(r.checks[0].name, 'health');
  assert.equal(r.checks[0].ok, false);
});
