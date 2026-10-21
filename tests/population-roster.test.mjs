// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CHARACTERS } from '../shared/appearance.js';
import { DEFAULT_POPULATION_SEED, redistributePopulation, runPopulationCLI } from '../tools/population-roster.mjs';

const tool = fileURLToPath(new URL('../tools/population-roster.mjs', import.meta.url));
const clone = value => JSON.parse(JSON.stringify(value));
function resident(id, fem, extra = {}) {
  return {
    id, fem, name: `PRIVATE-NAME-${id}`, home: { b: 17, f: 2, bed: [9, 0] },
    job: { kind: 'office', title: 'PRIVATE-JOB', b: 4, f: 1, id: 29, k: 0, days: 31 },
    tr: { soc: 0.71, act: 0.45, night: 1 }, speed: 1.31, off: 0.63,
    sched: [1, { start: 9, end: 17 }], agentId: 'PRIVATE-AGENT-IDENTIFIER',
    app: {
      skin: '#dca47c', hair: '#2d211b', hairStyle: 2,
      top: '#3B6EA5', topStyle: 0, bottom: '#2f3640', bottomStyle: 3,
      shoes: '#1b1b1b', accent: '#f5f5f5', eyes: '#4e7a3a', acc: 1, facial: 0,
      height: 1.02, build: 0.98, extraPalette: { custom: ['keep', 7, null] },
    },
    custom: { nested: [null, true, 'PRIVATE-SECRET'] }, ...extra,
  };
}
function population(male, female) {
  return [...Array.from({ length: male }, (_, i) => resident(`m-resident-${i}`, i % 2 ? false : 0)),
    ...Array.from({ length: female }, (_, i) => resident(`f-resident-${i}`, i % 2 ? true : 1))];
}
function stripAllowed(person) {
  const copy = clone(person);
  if (!copy.retired) { delete copy.app.char; delete copy.app.body; }
  return copy;
}
function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}
function cli(args, options = {}) {
  return spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', timeout: 15_000, ...options });
}
function fixture(t, people = population(45, 46), { pretty = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-population-roster-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'data');
  const backup = path.join(root, 'backup', 'data');
  const artifacts = path.join(root, 'artifacts');
  for (const directory of [data, backup, artifacts]) fs.mkdirSync(directory, { recursive: true });
  const source = path.join(data, 'people.json');
  const saved = path.join(backup, 'people.json');
  const original = Buffer.from(pretty ? `${JSON.stringify(people, null, 2).replaceAll('\n', '\r\n')}\r\n` : JSON.stringify(people));
  fs.writeFileSync(source, original, { mode: 0o640 });
  fs.writeFileSync(saved, original);
  // Opaque unrelated data, not a database the tool should even try to open.
  fs.writeFileSync(path.join(data, 'accounts.sqlite'), Buffer.from([0, 255, 12, 10, 0, 4]));
  fs.writeFileSync(path.join(data, 'world.json'), '{"private-world":"untouched"}\n');
  fs.writeFileSync(path.join(data, 'meta.json'), '{"version":3}\n');
  return { root, data, backup, artifacts, source, saved, original,
    apply: ['--data', data, '--apply', '--offline', '--backup', backup] };
}
function noTemps(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    assert.ok(!entry.name.includes('.population-roster-'), `leftover temp ${entry.name}`);
    if (entry.isDirectory()) noTemps(path.join(folder, entry.name));
  }
}
function assertRejected(people, options, pattern) {
  const original = clone(people);
  assert.throws(() => redistributePopulation(people, options), pattern);
  assert.deepEqual(people, original, 'invalid input is not partially changed');
}

test('4021-resident fixture covers all 44 bodies with balanced sex-matching counts and no unrelated changes', () => {
  const people = population(2011, 2010);
  const original = clone(people);
  const result = redistributePopulation(freezeDeep(people), { seed: 'whole-population-rollout' });
  assert.deepEqual(people, original);
  assert.notEqual(result.people, people);
  assert.equal(result.counts.after.total, 4021);
  assert.equal(result.counts.after.active, 4021);
  assert.equal(result.diffs.length, 4021);
  assert.equal(Object.keys(result.counts.after.byCharacter).length, 44);
  assert.equal(Object.values(result.counts.after.byCharacter).reduce((sum, count) => sum + count, 0), 4021);
  assert.ok(CHARACTERS.every(character => result.counts.after.byCharacter[character] > 0));
  assert.equal(result.counts.after.bySex.male.population, 2011);
  assert.equal(result.counts.after.bySex.female.population, 2010);
  for (const sex of ['male', 'female']) {
    const counts = result.counts.after.bySex[sex];
    assert.equal(counts.models, 22);
    assert.ok(counts.spread <= 1);
  }
  for (let index = 0; index < people.length; index++) {
    const updated = result.people[index];
    assert.deepEqual(stripAllowed(updated), stripAllowed(people[index]));
    assert.equal(updated.id, people[index].id);
    assert.equal(updated.fem, people[index].fem);
    assert.equal(updated.app.body, Number(people[index].fem));
    assert.equal(updated.app.char[0], people[index].fem ? 'f' : 'm');
    assert.notEqual(updated, people[index]);
    assert.notEqual(updated.app.extraPalette, people[index].app.extraPalette);
  }
  for (const key of ['onlyAllowedFieldsChanged', 'idsAndOrderPreserved', 'renderedSexPreserved', 'retiredUnchanged', 'balanced']) {
    assert.equal(result.proof[key], true, key);
  }
  assert.equal(result.proof.preservedBeforeSha256, result.proof.preservedAfterSha256);
  assert.deepEqual(result.proof.allowedFields, ['app.char', 'app.body']);
  assert.equal(result.proof.seedSha256.length, 64);
  assert.ok(result.diffs.every(diff => diff.fields.length === 2 && !('id' in diff) && !('name' in diff)));
});

test('small and empty populations still have a guaranteed spread of at most one', () => {
  for (const male of [0, 1, 21, 22, 23, 87]) {
    for (const female of [0, 1, 21, 22, 23, 87]) {
      const { counts, proof } = redistributePopulation(population(male, female));
      assert.equal(proof.balanced, true);
      for (const [name, count] of [['male', male], ['female', female]]) {
        assert.equal(counts.after.bySex[name].minimum, Math.floor(count / 22));
        assert.equal(counts.after.bySex[name].maximum, Math.ceil(count / 22));
      }
    }
  }
});

test('seeded stable-ID assignment is reproducible, independent of input/roster order and idempotent', () => {
  const people = population(101, 102);
  const roster = [...CHARACTERS];
  const first = redistributePopulation(people, { seed: 'seed A', roster });
  assert.deepEqual(redistributePopulation(people, { seed: 'seed A', roster }), first);
  assert.deepEqual(roster, CHARACTERS, 'roster was not sorted in place');
  const again = redistributePopulation(first.people, { seed: 'seed A', roster });
  assert.deepEqual(again.people, first.people);
  assert.deepEqual(again.diffs, []);
  const reversed = redistributePopulation([...people].reverse(), { seed: 'seed A', roster: [...roster].reverse() });
  const assignments = value => Object.fromEntries(value.people.map(person => [person.id, person.app.char]));
  assert.deepEqual(assignments(first), assignments(reversed));
  const different = redistributePopulation(people, { seed: 'seed B', roster });
  assert.ok(different.people.filter((person, index) => person.app.char !== first.people[index].app.char).length > 150);
  assert.equal(different.proof.balanced, true);
  assert.equal(redistributePopulation(people).proof.seedSha256, redistributePopulation(people, { seed: DEFAULT_POPULATION_SEED }).proof.seedSha256);
});

test('explicit char overrides fem/body; absent or empty char uses fem, not stored body', () => {
  const people = population(4, 4);
  people[0].app.char = 'f22'; people[0].app.body = 0;
  people[1].app.char = 'f01'; people[1].app.body = 1;
  people[2].app.body = 1;
  people[3].app.char = ''; people[3].app.body = 1;
  people[4].app.char = 'm22'; people[4].app.body = 1;
  people[5].app.char = 'm01'; people[5].app.body = 0;
  people[6].app.body = 0;
  people[7].app.char = ''; people[7].app.body = 0;
  const result = redistributePopulation(people);
  const expected = [1, 1, 0, 0, 0, 0, 1, 1];
  result.people.forEach((person, index) => {
    assert.equal(person.app.body, expected[index]);
    assert.equal(person.app.char[0], expected[index] ? 'f' : 'm');
    assert.equal(person.fem, people[index].fem);
    assert.deepEqual(stripAllowed(person), stripAllowed(people[index]));
  });
  assert.equal(result.proof.renderedSexPreserved, true);
});

test('retired residents are byte-equivalent JSON and excluded from balancing/diffs, including numeric and boolean flags', () => {
  const people = population(23, 23);
  people[1].retired = 1;
  people[1].app.char = 'f13'; people[1].app.body = 0;
  people[24].retired = true;
  people[24].app.char = ''; people[24].app.body = 0;
  people[2].retired = 0;
  people[25].retired = false;
  const result = redistributePopulation(people);
  assert.equal(result.counts.after.active, 44);
  assert.equal(result.counts.after.retired, 2);
  assert.ok(CHARACTERS.every(character => result.counts.after.byCharacter[character] === 1));
  for (const index of [1, 24]) {
    assert.equal(JSON.stringify(result.people[index]), JSON.stringify(people[index]));
    assert.ok(!result.diffs.some(diff => diff.index === index));
  }
  const onlyRetired = redistributePopulation(people.filter(person => person.retired));
  assert.deepEqual(onlyRetired.diffs, []);
  assert.equal(onlyRetired.counts.after.active, 0);
});

test('valid subset rosters are balanced; malformed rosters and seeds are rejected without mutation', () => {
  const people = population(17, 18);
  const roster = ['f02', 'm02', 'f01', 'm01'];
  const result = redistributePopulation(people, { roster, seed: 'subset' });
  assert.ok(result.people.every(person => roster.includes(person.app.char)));
  assert.equal(result.counts.after.bySex.male.models, 2);
  assert.equal(result.counts.after.bySex.female.models, 2);
  assert.ok(result.proof.balanced);
  for (const bad of [[], ['m01'], ['f01'], ['m01', 'f01', 'm01'], ['m01', 'f99'], ['m01', 1], 'm01,f01', null]) {
    assertRejected(people, { roster: bad }, /roster/);
  }
  for (const seed of ['', '   ', 0, false, null]) assertRejected(people, { seed }, /seed/);
});

test('malformed person IDs, sex, retirement and looks fail instead of being silently sanitized', () => {
  for (const id of ['', ' ', ' padded', 'line\nbreak', 1, null]) {
    assertRejected([resident(id, 0)], undefined, /id/);
  }
  assertRejected([resident('duplicate', 0), resident('duplicate', 1)], undefined, /duplicate resident id/);
  for (const fem of [undefined, null, 2, -1, '0', 'male']) {
    if (fem === undefined) {
      const person = resident('bad', 0); delete person.fem;
      assertRejected([person], undefined, /fem/);
    } else assertRejected([resident('bad', fem)], undefined, /fem/);
  }
  for (const retired of [null, 2, '1']) assertRejected([resident('bad', 0, { retired })], undefined, /retired/);
  for (const app of [null, [], 'look', 1]) assertRejected([resident('bad', 0, { app })], undefined, /app/);
  for (const [key, value] of [
    ['char', 'unknown'], ['char', 0], ['char', null], ['body', 2], ['body', true], ['body', '0'],
    ['skin', 'red'], ['hair', '#fff'], ['top', 2], ['hairStyle', 12], ['topStyle', -1],
    ['bottomStyle', 1.5], ['acc', 7], ['facial', '1'], ['height', 0.84], ['height', '1'], ['build', 1.21],
  ]) {
    const person = resident('bad', 0); person.app[key] = value;
    assertRejected([person], undefined, /app\./);
  }
  for (const people of [{ people: population(1, 1) }, { residents: population(1, 1) }, null, [null], [[]]]) {
    assert.throws(() => redistributePopulation(people), /array|object/);
  }
});

test('unsafe/non-lossless JS inputs are rejected, never invoking getters or silently dropping data', () => {
  for (const value of [undefined, NaN, Infinity, -0, 1n, () => 0, Symbol('private')]) {
    const person = resident('bad', 0); person.custom = value;
    assert.throws(() => redistributePopulation([person]), /lossless JSON/);
  }
  const cyclic = resident('bad', 0); cyclic.custom.self = cyclic;
  assert.throws(() => redistributePopulation([cyclic]), /cyclic/);
  const accessor = resident('bad', 0);
  Object.defineProperty(accessor, 'trap', { enumerable: true, get() { assert.fail('getter executed'); } });
  assert.throws(() => redistributePopulation([accessor]), /accessors/);
  const hidden = resident('bad', 0);
  Object.defineProperty(hidden, 'hidden', { value: 1 });
  assert.throws(() => redistributePopulation([hidden]), /hidden/);
  const symbolic = resident('bad', 0); symbolic[Symbol('hidden')] = 1;
  assert.throws(() => redistributePopulation([symbolic]), /symbol/);
  const sparse = [resident('good', 0), , resident('good2', 1)];
  assert.throws(() => redistributePopulation(sparse), /sparse/);
  const extraArray = population(1, 1); extraArray.extra = 0;
  assert.throws(() => redistributePopulation(extraArray), /extra array/);
  const dated = resident('bad', 0); dated.custom = new Date();
  assert.throws(() => redistributePopulation([dated]), /plain JSON/);
  const withToJSON = resident('bad', 0); withToJSON.toJSON = () => ({});
  assert.throws(() => redistributePopulation([withToJSON]), /lossless JSON/);
});

test('CLI defaults to dry-run JSON counts, keeps every file unchanged, and writes privacy-safe optional reports', t => {
  const f = fixture(t);
  const before = fs.readdirSync(f.data).map(name => [name, fs.readFileSync(path.join(f.data, name))]);
  const report = path.join(f.artifacts, 'preview.json');
  const result = cli(['--data', f.data, '--report', report]);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.mode, 'dry-run');
  assert.equal(summary.written, false);
  assert.equal(summary.backupVerified, false);
  assert.equal(summary.counts.after.total, 91);
  assert.equal(summary.changes.residents, 91);
  assert.notEqual(summary.inputSha256, summary.outputSha256);
  assert.deepEqual(JSON.parse(fs.readFileSync(report)), summary);
  assert.ok(!result.stdout.includes('PRIVATE-'));
  assert.ok(!('people' in summary) && !('diffs' in summary) && !('seed' in summary));
  for (const [name, bytes] of before) assert.deepEqual(fs.readFileSync(path.join(f.data, name)), bytes);
  assert.deepEqual(fs.readFileSync(f.saved), f.original);
  noTemps(f.root);
});

test('CLI apply requires data, offline assertion and a distinct byte-identical existing backup', t => {
  const f = fixture(t);
  const report = path.join(f.artifacts, 'must-not-exist.json');
  for (const args of [
    [], ['--apply'], ['--data', f.data, '--apply'], ['--data', f.data, '--apply', '--offline'],
    ['--data', f.data, '--apply', '--backup', f.backup],
    ['--data', f.data, '--apply', '--offline', '--backup', path.join(f.root, 'missing')],
    ['--data', f.data, '--apply', '--offline', '--backup', f.data],
  ]) {
    const result = cli([...args, '--report', report]);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.ok(!fs.existsSync(report));
    assert.deepEqual(fs.readFileSync(f.source), f.original);
    noTemps(f.root);
  }
  fs.writeFileSync(f.saved, Buffer.concat([f.original, Buffer.from('\n')]));
  let result = cli([...f.apply, '--report', report]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /byte hash does not match/);
  assert.deepEqual(fs.readFileSync(f.source), f.original);
  assert.ok(!fs.existsSync(report));
  fs.unlinkSync(f.saved);
  result = cli(f.apply);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOENT/);
  assert.deepEqual(fs.readFileSync(f.source), f.original);
  noTemps(f.root);
});

test('apply changes only permitted fields, preserves mode/ownership/array style, and repeat apply keeps exact bytes and inode', t => {
  const f = fixture(t, population(45, 46), { pretty: true });
  const originalStat = fs.statSync(f.source);
  const unrelated = ['accounts.sqlite', 'world.json', 'meta.json'].map(name => [name, fs.readFileSync(path.join(f.data, name))]);
  const report = path.join(f.artifacts, 'applied.json');
  let result = cli([...f.apply, '--seed', 'fixed-test-rollout', '--report', report]);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.mode, 'apply');
  assert.equal(summary.written, true);
  assert.equal(summary.backupVerified, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(report)), summary);
  const applied = fs.readFileSync(f.source);
  const appliedPeople = JSON.parse(applied);
  assert.deepEqual(appliedPeople, redistributePopulation(JSON.parse(f.original), { seed: 'fixed-test-rollout' }).people);
  assert.ok(Array.isArray(appliedPeople));
  assert.ok(applied.toString().includes('\r\n  {'));
  assert.ok(applied.toString().endsWith('\r\n'));
  assert.equal(applied.toString().replaceAll('\r\n', '').includes('\n'), false);
  const appliedStat = fs.statSync(f.source);
  assert.equal(appliedStat.mode, originalStat.mode);
  assert.equal(appliedStat.uid, originalStat.uid);
  assert.equal(appliedStat.gid, originalStat.gid);
  assert.ok(appliedStat.isFile());
  assert.notEqual(appliedStat.ino, originalStat.ino, 'write used atomic file replacement');
  assert.deepEqual(fs.readFileSync(f.saved), f.original);
  for (const [name, bytes] of unrelated) assert.deepEqual(fs.readFileSync(path.join(f.data, name)), bytes);
  // Even an idempotent apply cannot reuse a pre-redistribution stale backup.
  result = cli([...f.apply, '--seed', 'fixed-test-rollout']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /byte hash does not match/);
  assert.deepEqual(fs.readFileSync(f.source), applied);
  // Deployment's next stopped snapshot is the current data, not the old rollout.
  fs.copyFileSync(f.source, f.saved);
  result = cli([...f.apply, '--seed', 'fixed-test-rollout']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).written, false);
  assert.equal(JSON.parse(result.stdout).changes.residents, 0);
  assert.deepEqual(fs.readFileSync(f.source), applied);
  const repeatedStat = fs.statSync(f.source);
  assert.equal(repeatedStat.ino, appliedStat.ino);
  assert.equal(repeatedStat.mtimeMs, appliedStat.mtimeMs);
  assert.ok(!result.stdout.includes('PRIVATE-'));
  noTemps(f.root);
});

test('CLI rejects symlinked live/backup files and directory paths without touching targets', t => {
  const f = fixture(t);
  const moved = path.join(f.root, 'live-original.json');
  fs.renameSync(f.source, moved);
  fs.symlinkSync(moved, f.source);
  let result = cli(f.apply);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /symlink/);
  assert.deepEqual(fs.readFileSync(moved), f.original);
  fs.unlinkSync(f.source); fs.renameSync(moved, f.source);
  const movedBackup = path.join(f.root, 'backup-original.json');
  fs.renameSync(f.saved, movedBackup); fs.symlinkSync(movedBackup, f.saved);
  result = cli(f.apply);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /symlink/);
  fs.unlinkSync(f.saved); fs.renameSync(movedBackup, f.saved);
  const dataAlias = path.join(f.root, 'data-alias');
  fs.symlinkSync(f.data, dataAlias, 'dir');
  result = cli(['--data', dataAlias]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /symlink/);
  const backupAlias = path.join(f.root, 'backup-alias');
  fs.symlinkSync(path.dirname(f.backup), backupAlias, 'dir');
  result = cli(['--data', f.data, '--apply', '--offline', '--backup', path.join(backupAlias, 'data')]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /symlink/);
  assert.deepEqual(fs.readFileSync(f.source), f.original);
  assert.deepEqual(fs.readFileSync(f.saved), f.original);
  noTemps(f.root);
});

test('CLI rejects hardlinked/nonregular people files, malformed UTF-8/JSON and wrappers without writes', t => {
  const f = fixture(t);
  const hardlink = path.join(f.root, 'hardlink.json');
  fs.linkSync(f.source, hardlink);
  let result = cli(f.apply);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /hard links/);
  fs.unlinkSync(hardlink);
  fs.unlinkSync(f.source); fs.mkdirSync(f.source);
  result = cli(f.apply);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /regular file/);
  fs.rmdirSync(f.source);
  for (const bytes of [Buffer.from([0xff]), Buffer.from('{'), Buffer.from('{"people":[]}'), Buffer.from('[{"id":"bad","fem":2,"app":{}}]')]) {
    fs.writeFileSync(f.source, bytes); fs.writeFileSync(f.saved, bytes);
    result = cli(f.apply);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.deepEqual(fs.readFileSync(f.source), bytes);
    assert.deepEqual(fs.readFileSync(f.saved), bytes);
    noTemps(f.root);
  }
});

test('unsafe/existing/missing-parent report paths fail before apply and never overwrite unrelated files', t => {
  const f = fixture(t);
  const existing = path.join(f.artifacts, 'existing.json');
  fs.writeFileSync(existing, 'KEEP-EXISTING');
  const reportLink = path.join(f.artifacts, 'alias.json');
  fs.symlinkSync(existing, reportLink);
  const directoryAlias = path.join(f.root, 'artifact-alias');
  fs.symlinkSync(f.artifacts, directoryAlias, 'dir');
  for (const report of [
    existing, reportLink, path.join(directoryAlias, 'new.json'), path.join(f.data, 'world.json'),
    path.join(f.data, 'new.json'), path.join(f.backup, 'new.json'),
    path.join(f.artifacts, 'configuration.sh'), path.join(f.root, 'missing', 'run.json'),
  ]) {
    const result = cli([...f.apply, '--report', report]);
    assert.notEqual(result.status, 0);
    assert.deepEqual(fs.readFileSync(f.source), f.original);
    assert.deepEqual(fs.readFileSync(f.saved), f.original);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'KEEP-EXISTING');
    assert.equal(fs.readFileSync(path.join(f.data, 'world.json'), 'utf8'), '{"private-world":"untouched"}\n');
    noTemps(f.root);
  }
});

test('apply opens only specified people files, private staging files and sync directories, never accounts/world/meta', t => {
  const f = fixture(t);
  const report = path.join(f.artifacts, 'open-audit.json');
  const originalOpen = fs.openSync;
  const opened = [];
  fs.openSync = (filename, ...args) => {
    opened.push(path.resolve(filename));
    return originalOpen(filename, ...args);
  };
  const stderr = [];
  let code;
  try {
    code = runPopulationCLI([...f.apply, '--report', report], {
      stdout: { write() {} }, stderr: { write: bytes => stderr.push(String(bytes)) },
    });
  } finally { fs.openSync = originalOpen; }
  assert.equal(code, 0, stderr.join(''));
  assert.ok(opened.includes(f.source) && opened.includes(f.saved));
  for (const filename of opened) {
    assert.ok([f.source, f.saved, f.data, f.artifacts].includes(filename) ||
      (path.basename(filename).includes('.population-roster-') &&
        [f.data, f.artifacts].includes(path.dirname(filename))), `unexpected file opened: ${filename}`);
  }
  assert.ok(!opened.some(filename => /accounts|world\.json|meta\.json/u.test(filename)));
  noTemps(f.root);
});

test('staged write failures clean both temporary files and do not change people or publish a report', t => {
  const f = fixture(t);
  const report = path.join(f.artifacts, 'failed.json');
  const originalRename = fs.renameSync;
  const stdout = []; const stderr = [];
  fs.renameSync = (from, to) => {
    if (to === f.source) throw new Error('injected atomic rename failure');
    return originalRename(from, to);
  };
  let code;
  try {
    code = runPopulationCLI([...f.apply, '--report', report], {
      stdout: { write: bytes => stdout.push(String(bytes)) },
      stderr: { write: bytes => stderr.push(String(bytes)) },
    });
  } finally { fs.renameSync = originalRename; }
  assert.equal(code, 1);
  assert.match(stderr.join(''), /injected atomic rename failure/);
  assert.equal(stdout.join(''), '');
  assert.deepEqual(fs.readFileSync(f.source), f.original);
  assert.deepEqual(fs.readFileSync(f.saved), f.original);
  assert.ok(!fs.existsSync(report));
  noTemps(f.root);
});

test('changes to live or backup bytes during staging are detected before publishing', t => {
  for (const changedTarget of ['source', 'saved']) {
    const f = fixture(t);
    const report = path.join(f.artifacts, 'raced.json');
    const originalSync = fs.fsyncSync;
    let injected = false;
    const stderr = []; const stdout = [];
    fs.fsyncSync = fd => {
      originalSync(fd);
      if (!injected) { injected = true; fs.appendFileSync(f[changedTarget], '\n'); }
    };
    let code;
    try {
      code = runPopulationCLI([...f.apply, '--report', report], {
        stdout: { write: bytes => stdout.push(String(bytes)) },
        stderr: { write: bytes => stderr.push(String(bytes)) },
      });
    } finally { fs.fsyncSync = originalSync; }
    assert.ok(injected);
    assert.equal(code, 1);
    assert.match(stderr.join(''), /snapshot changed/);
    assert.equal(stdout.join(''), '');
    for (const key of ['source', 'saved']) {
      const expected = key === changedTarget ? Buffer.concat([f.original, Buffer.from('\n')]) : f.original;
      assert.deepEqual(fs.readFileSync(f[key]), expected, 'tool never publishes over the externally changed snapshot');
    }
    assert.ok(!fs.existsSync(report));
    noTemps(f.root);
  }
});

test('a staged file substituted by a symlink is rejected and its target is untouched', t => {
  const f = fixture(t);
  const originalSync = fs.fsyncSync;
  let injected = false;
  const stderr = [];
  fs.fsyncSync = fd => {
    originalSync(fd);
    if (!injected) {
      injected = true;
      const temporary = fs.readdirSync(f.data).find(name => name.includes('.population-roster-'));
      assert.ok(temporary);
      const filename = path.join(f.data, temporary);
      fs.unlinkSync(filename);
      fs.symlinkSync(f.saved, filename);
    }
  };
  let code;
  try {
    code = runPopulationCLI(f.apply, {
      stdout: { write() { assert.fail('unsafe staging returned success'); } },
      stderr: { write: bytes => stderr.push(String(bytes)) },
    });
  } finally { fs.fsyncSync = originalSync; }
  assert.equal(code, 1);
  assert.match(stderr.join(''), /symlink/);
  assert.deepEqual(fs.readFileSync(f.source), f.original);
  assert.deepEqual(fs.readFileSync(f.saved), f.original);
  noTemps(f.root);
});

test('CLI help/argument errors are safe and importing the module never executes CLI or reads data', t => {
  const f = fixture(t);
  let result = cli(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run is the default/);
  for (const args of [
    ['--unknown'], ['--data'], ['--data', f.data, '--data', f.data],
    ['--data', f.data, '--seed', ''], ['--data', f.data, '--dry-run', '--apply', '--offline', '--backup', f.backup],
  ]) {
    result = cli(args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.deepEqual(fs.readFileSync(f.source), f.original);
  }
  const moduleURL = new URL('../tools/population-roster.mjs', import.meta.url).href;
  result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(moduleURL)})`,
    '--', '--data', '/nonexistent/private/data', '--apply', '--offline', '--backup', '/missing'], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.deepEqual(fs.readFileSync(f.source), f.original);
});
