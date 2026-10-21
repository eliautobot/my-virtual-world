// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const promote = fs.readFileSync(new URL('../tools/deploy/promote.sh', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../tools/uitest.cjs', import.meta.url), 'utf8');
test('population rollout is explicit opt-in and requires complete tests/browser gates', () => {
  assert.match(promote, /redistribute_population=0/);
  assert.match(promote, /--redistribute-population\) redistribute_population=1/);
  assert.match(promote, /population redistribution requires the full test and browser gates/);
  assert.match(promote, /population redistribution is not allowed during rollback/);
});
test('population apply occurs after stop/full backup and restores data on tool or smoke failure', () => {
  const stopped = promote.indexOf('svc stop "$MVW_LIVE_UNIT"');
  const backup = promote.indexOf('backup_data "pre-$kind-$tag"');
  const apply = promote.indexOf('--data "$DATA" --apply --offline');
  const switched = promote.indexOf('switch_to "$tag"');
  assert.ok(stopped >= 0 && stopped < backup && backup < apply && apply < switched);
  assert.match(promote, /--backup "\$bk\/data"/);
  assert.match(promote.slice(apply, switched), /restore_data "\$bk"/);
  assert.match(promote.slice(switched), /restore_data "\$bk"/);
});
test('UI rehearsal redistributes only a temporary copy and refuses a live URL', () => {
  assert.match(ui, /population rehearsal requires a disposable copy from --data, never --url/);
  assert.match(ui, /tempDir\('mvw-population-rehearsal-'\)/);
  assert.match(ui, /copyData\(copyFrom, rehearsal\)/);
  assert.match(ui, /redistributePopulation\(residents\)/);
  assert.match(ui, /finally \{ if \(rehearsal\) fs\.rmSync/);
});
