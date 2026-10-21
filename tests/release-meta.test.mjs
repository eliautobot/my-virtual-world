// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Version bookkeeping: package.json, package-lock.json and the newest CHANGELOG entry agree, and a release folder built
// from a version tag reports that version.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ROOT } from './helpers/server.mjs';

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const inRelease = fs.existsSync(path.join(ROOT, 'release.json'));

test('package.json, package-lock.json and the newest CHANGELOG entry name the same version', () => {
  const v = JSON.parse(read('package.json')).version;
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, v, 'package-lock.json version');
  assert.equal(lock.packages[''].version, v, 'package-lock.json root package version');
  const m = read('CHANGELOG.md').match(/^## v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\b/m);   // pre-releases too (2.0.0-alpha.1)
  assert.ok(m, 'CHANGELOG.md starts its entries with "## v<version>"');
  assert.equal(m[1], v, 'newest CHANGELOG entry');
});

test('a release folder built from a version tag reports that version', { skip: !inRelease && 'not a release folder' }, () => {
  const rel = JSON.parse(read('release.json'));
  if (!/^v\d/.test(rel.tag || '')) return;          // rehearsal and test builds use other tags
  assert.equal(rel.tag, 'v' + JSON.parse(read('package.json')).version);
});
