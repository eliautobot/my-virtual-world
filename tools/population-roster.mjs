#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
/**
 * Offline, resident-only roster redistribution. No database or service access.
 *
 * Preview: node tools/population-roster.mjs --data /install/data [--seed text]
 * Apply:   node tools/population-roster.mjs --data /install/data --apply --offline
 *          --backup /backups/stopped-install/data [--seed text] [--report /artifacts/run.json]
 *
 * The caller must stop the service and copy its data before applying. --offline
 * is that caller's assertion, NOT a service-stop command or a process detector.
 * The backup's people.json must be a distinct file with exactly the live bytes.
 * Reports contain counts/hashes only; their existing parent must be outside both
 * data folders, and an existing report is never overwritten. Only a bare JSON
 * population array is accepted (no guessed wrapper fields).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  CHARACTERS, defaultChar, HAIR_STYLES, TOP_STYLES, BOTTOM_STYLES,
  ACCESSORIES, FACIAL,
} from '../shared/appearance.js';

export const DEFAULT_POPULATION_SEED = 'mvw-full-roster-population-20261002-v1';
const ALGORITHM = 'sha256-stable-id-sort/seeded-roster-round-robin-v1';
const ALLOWED_FIELDS = ['app.char', 'app.body'];
const own = (object, key) => Object.hasOwn(object, key);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hashJSON = value => sha256(JSON.stringify(value));
const rank = (domain, seed, value) => hashJSON([ALGORITHM, domain, seed, value]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sexOfCharacter = character => character[0] === 'f' ? 1 : 0;

// Reject values JSON would silently discard/coerce, accessors, sparse arrays and
// cycles. This also makes cloning independent of caller-owned nested objects.
function validateJSON(value, location = 'people', ancestors = new Set(), depth = 0) {
  if (depth > 100) throw new Error(`${location}: JSON nesting is too deep`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return;
  if (typeof value !== 'object') throw new Error(`${location}: value is not lossless JSON`);
  if (ancestors.has(value)) throw new Error(`${location}: cyclic JSON is not supported`);
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) {
    throw new Error(`${location}: expected a plain JSON object or array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length) throw new Error(`${location}: symbol fields are not JSON`);
  const keys = Object.keys(descriptors).filter(key => !(array && key === 'length'));
  if (array && (keys.length !== value.length || keys.some((key, i) => key !== String(i)))) {
    throw new Error(`${location}: sparse arrays or extra array fields are not supported`);
  }
  ancestors.add(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !own(descriptor, 'value')) {
      throw new Error(`${location}: hidden fields/accessors are not JSON`);
    }
    // Do not put arbitrary property names or resident values into diagnostics.
    validateJSON(descriptor.value, `${location} field`, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

function validateRoster(roster) {
  validateJSON(roster, 'roster');
  if (!Array.isArray(roster) || !roster.length) throw new Error('roster: expected a nonempty array');
  if (roster.some(character => typeof character !== 'string' || !CHARACTERS.includes(character))) {
    throw new Error('roster: every entry must be a known shared character');
  }
  if (new Set(roster).size !== roster.length) throw new Error('roster: duplicate character');
  const pools = [0, 1].map(sex => roster.filter(character => sexOfCharacter(character) === sex));
  if (pools.some(pool => !pool.length)) throw new Error('roster: both male and female pools are required');
  return pools;
}

const colorFields = ['skin', 'hair', 'top', 'bottom', 'shoes', 'accent', 'eyes'];
const enumSizes = {
  hairStyle: HAIR_STYLES.length, topStyle: TOP_STYLES.length,
  bottomStyle: BOTTOM_STYLES.length, acc: ACCESSORIES.length, facial: FACIAL.length,
};
function validatePerson(person, index, ids, rosterSet) {
  const label = `resident index ${index}`;
  if (!person || Array.isArray(person) || typeof person !== 'object') throw new Error(`${label}: expected an object`);
  if (typeof person.id !== 'string' || !person.id.trim() || person.id.trim() !== person.id || /[\u0000-\u001f\u007f]/u.test(person.id)) {
    throw new Error(`${label}: id must be a nonempty, stable string without whitespace padding/control characters`);
  }
  if (ids.has(person.id)) throw new Error(`${label}: duplicate resident id`);
  ids.add(person.id);
  if (![false, true, 0, 1].includes(person.fem)) throw new Error(`${label}: fem must be boolean or 0/1`);
  if (own(person, 'retired') && ![false, true, 0, 1].includes(person.retired)) {
    throw new Error(`${label}: retired must be boolean or 0/1 when present`);
  }
  const app = person.app;
  if (!app || typeof app !== 'object' || Array.isArray(app)) throw new Error(`${label}: app must be an object`);
  if (own(app, 'char') && (typeof app.char !== 'string' || (app.char !== '' && !rosterSet.has(app.char)))) {
    throw new Error(`${label}: app.char must be empty or a character in the requested roster`);
  }
  if (own(app, 'body') && ![0, 1].includes(app.body)) throw new Error(`${label}: app.body must be numeric 0/1`);
  for (const key of colorFields) {
    if (own(app, key) && (typeof app[key] !== 'string' || !/^#[0-9a-fA-F]{6}$/u.test(app[key]))) {
      throw new Error(`${label}: app.${key} must be a six-digit hex color`);
    }
  }
  for (const [key, size] of Object.entries(enumSizes)) {
    if (own(app, key) && (!Number.isInteger(app[key]) || app[key] < 0 || app[key] >= size)) {
      throw new Error(`${label}: app.${key} is outside its appearance enum`);
    }
  }
  for (const [key, low, high] of [['height', 0.85, 1.12], ['build', 0.85, 1.2]]) {
    if (own(app, key) && (typeof app[key] !== 'number' || app[key] < low || app[key] > high)) {
      throw new Error(`${label}: app.${key} is outside its appearance range`);
    }
  }
  // sim.lookOf ignores a stored body when char is absent. An explicit valid char
  // determines rendered sex even when fem/body disagree. Never change fem.
  return app.char ? sexOfCharacter(app.char) : Number(person.fem);
}

function countsFor(people, sexes, pools) {
  const byCharacter = Object.fromEntries(pools.flat().map(character => [character, 0]));
  let active = 0;
  for (let index = 0; index < people.length; index++) {
    if (people[index].retired) continue;
    active++;
    const app = people[index].app;
    const character = app.char || defaultChar({ ...app, body: sexes[index] });
    // A custom roster can exclude a legacy default; keep that baseline visible.
    byCharacter[character] = (byCharacter[character] ?? 0) + 1;
  }
  const bySex = {};
  for (const [sex, name] of [[0, 'male'], [1, 'female']]) {
    const values = pools[sex].map(character => byCharacter[character]);
    bySex[name] = {
      population: sexes.filter((value, index) => !people[index].retired && value === sex).length,
      models: pools[sex].length,
      minimum: Math.min(...values), maximum: Math.max(...values),
      spread: Math.max(...values) - Math.min(...values),
    };
  }
  return { total: people.length, active, retired: people.length - active, bySex, byCharacter };
}

function preservedProjection(people) {
  return people.map(person => {
    if (person.retired) return person;
    const { char: _char, body: _body, ...restOfApp } = person.app;
    return { ...person, app: restOfApp };
  });
}

/**
 * Pure redistribution: copied people in original order, count summaries, indexed
 * char/body diffs (no names/IDs), and checked preservation/balance proof.
 * Missing look fields remain missing, except active app.char/app.body. Invalid
 * stored fields are errors rather than silently sanitized or replaced.
 */
export function redistributePopulation(people, { seed = DEFAULT_POPULATION_SEED, roster = CHARACTERS } = {}) {
  if (typeof seed !== 'string' || !seed.trim()) throw new Error('seed must be nonempty text');
  if (!Array.isArray(people)) throw new Error('people.json must contain a bare array');
  validateJSON(people);
  const pools = validateRoster(roster);
  const rosterSet = new Set(roster);
  const ids = new Set();
  const sexes = people.map((person, index) => validatePerson(person, index, ids, rosterSet));
  const output = JSON.parse(JSON.stringify(people));
  for (const sex of [0, 1]) {
    const models = pools[sex].map(character => ({ character, hash: rank('model', seed, character) }))
      .sort((a, b) => compare(a.hash, b.hash) || compare(a.character, b.character));
    const residents = people.map((person, index) => ({ person, index }))
      .filter(({ person, index }) => !person.retired && sexes[index] === sex)
      .map(({ person, index }) => ({ index, id: person.id, hash: rank('resident', seed, person.id) }))
      .sort((a, b) => compare(a.hash, b.hash) || compare(a.id, b.id));
    residents.forEach(({ index }, position) => {
      output[index].app.char = models[position % models.length].character;
      output[index].app.body = sex;
    });
  }
  const diffs = [];
  for (let index = 0; index < people.length; index++) {
    const before = people[index].app;
    const after = output[index].app;
    const fields = ['char', 'body'].filter(key => own(before, key) !== own(after, key) || before[key] !== after[key]);
    if (!fields.length) continue;
    diffs.push({
      index, fields: fields.map(key => `app.${key}`),
      before: Object.fromEntries(['char', 'body'].filter(key => own(before, key)).map(key => [key, before[key]])),
      after: Object.fromEntries(['char', 'body'].filter(key => own(after, key)).map(key => [key, after[key]])),
    });
  }
  const counts = { before: countsFor(people, sexes, pools), after: countsFor(output, sexes, pools) };
  const preservationBefore = hashJSON(preservedProjection(people));
  const preservationAfter = hashJSON(preservedProjection(output));
  const outputSexes = output.map(person => person.app.char ? sexOfCharacter(person.app.char) : Number(person.fem));
  const proof = {
    algorithm: ALGORITHM, seedSha256: sha256(seed), rosterSha256: hashJSON([...roster].sort(compare)),
    allowedFields: [...ALLOWED_FIELDS],
    preservedBeforeSha256: preservationBefore, preservedAfterSha256: preservationAfter,
    onlyAllowedFieldsChanged: preservationBefore === preservationAfter,
    idsAndOrderPreserved: people.every((person, index) => person.id === output[index].id),
    renderedSexPreserved: sexes.every((sex, index) => sex === outputSexes[index]),
    retiredUnchanged: people.every((person, index) => !person.retired || hashJSON(person) === hashJSON(output[index])),
    balanced: Object.values(counts.after.bySex).every(group => group.spread <= 1),
  };
  if (Object.values(proof).some(value => value === false)) throw new Error('internal redistribution preservation check failed');
  return { people: output, counts, diffs, proof };
}

// Filesystem helpers deliberately address only the specified people.json files
// and optional report. No scanning the data directory or opening accounts DBs.
function safePath(filename, { directory = false, allowMissing = false } = {}) {
  const absolute = path.resolve(filename);
  const root = path.parse(absolute).root;
  const components = absolute.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < components.length; index++) {
    current = path.join(current, components[index]);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (allowMissing && index === components.length - 1 && error.code === 'ENOENT') return absolute;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error('symlinks are not allowed in data, backup or report paths');
    if ((index < components.length - 1 || directory) && !stat.isDirectory()) throw new Error('expected a directory path');
  }
  if (directory && !fs.lstatSync(absolute).isDirectory()) throw new Error('expected a directory path');
  return absolute;
}

const statKeys = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid', 'gid', 'nlink'];
const sameStat = (a, b) => statKeys.every(key => a[key] === b[key]);
function snapshot(filename) {
  const absolute = safePath(filename);
  const stat = fs.lstatSync(absolute, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n) throw new Error('people.json must be a regular file without hard links');
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!sameStat(stat, opened)) throw new Error('people.json changed while opening; stop the service and retry');
    const bytes = fs.readFileSync(fd);
    if (!sameStat(opened, fs.fstatSync(fd, { bigint: true }))) throw new Error('people.json changed while reading');
    return { filename: absolute, stat: opened, bytes, sha256: sha256(bytes) };
  } finally { fs.closeSync(fd); }
}

function unchanged(expected) {
  const current = snapshot(expected.filename);
  if (!sameStat(expected.stat, current.stat) || current.sha256 !== expected.sha256) {
    throw new Error('people.json snapshot changed; stop the service and make a fresh backup');
  }
}
function matchedBackup(live, backup) {
  if (live.stat.dev === backup.stat.dev && live.stat.ino === backup.stat.ino) {
    throw new Error('backup must be a distinct copied people.json file');
  }
  if (live.sha256 !== backup.sha256 || !live.bytes.equals(backup.bytes)) {
    throw new Error('backup people.json byte hash does not match the live snapshot');
  }
}
function inside(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function reportTarget(filename, data, backup) {
  const absolute = safePath(filename, { allowMissing: true });
  safePath(path.dirname(absolute), { directory: true });
  if (inside(absolute, data) || (backup && inside(absolute, backup))) throw new Error('report must be outside data and backup directories');
  if (path.extname(absolute) !== '.json') throw new Error('report must use a .json filename');
  if (fs.existsSync(absolute)) throw new Error('report already exists; choose a new artifact filename');
  return absolute;
}

function stageFile(destination, bytes, sourceStat = null) {
  safePath(path.dirname(destination), { directory: true });
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.population-roster-${process.pid}-${randomBytes(12).toString('hex')}.tmp`);
  let fd;
  let created = false;
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    created = true;
    fs.writeFileSync(fd, bytes);
    if (sourceStat) {
      const current = fs.fstatSync(fd, { bigint: true });
      if (current.uid !== sourceStat.uid || current.gid !== sourceStat.gid) {
        // Fail rather than silently changing ownership when running as another user.
        fs.fchownSync(fd, Number(sourceStat.uid), Number(sourceStat.gid));
      }
      fs.fchmodSync(fd, Number(sourceStat.mode & 0o7777n));
    }
    fs.fsyncSync(fd);
    const stat = fs.fstatSync(fd, { bigint: true });
    const closing = fd;
    fd = undefined;
    fs.closeSync(closing);
    return { filename: temporary, stat, sha256: sha256(bytes) };
  } catch (error) {
    const cleanupErrors = [];
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (cleanupError) { cleanupErrors.push(cleanupError.message); }
    }
    // Never unlink a preexisting file when exclusive creation failed.
    if (created) {
      try { fs.unlinkSync(temporary); } catch (cleanupError) { cleanupErrors.push(cleanupError.message); }
    }
    if (cleanupErrors.length) throw new Error(`${error.message}; staging cleanup failed: ${cleanupErrors.join('; ')}`, { cause: error });
    throw error;
  }
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function serializeLike(people, original) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(original);
  const indent = text.match(/(?:\r?\n)([ \t]+)\S/u)?.[1];
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  let output = JSON.stringify(people, null, indent ? indent.slice(0, 10) : undefined);
  if (newline === '\r\n') output = output.replaceAll('\n', newline);
  if (/\r?\n$/u.test(text)) output += newline;
  return Buffer.from(output);
}

const HELP = `Usage: node tools/population-roster.mjs --data <folder> [--seed <text>]
  [--dry-run | --apply --offline --backup <copied-data-folder>] [--report <new.json>]
Dry run is the default. Only resident app.char/app.body can change.
Stop the service and back up first; --offline asserts it is already stopped.
Backup people.json must match the current bytes, including on a repeated apply.
Reports require an existing parent outside data/backup and never overwrite files.
Default seed: ${DEFAULT_POPULATION_SEED}\n`;
function parseArgs(args) {
  const options = { seed: DEFAULT_POPULATION_SEED, apply: false, offline: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--data', '--seed', '--apply', '--offline', '--backup', '--report', '--dry-run', '--help'].includes(flag)) {
      throw new Error('unknown argument; use --help');
    }
    if (seen.has(flag)) throw new Error('duplicate argument; use --help');
    seen.add(flag);
    if (['--apply', '--offline', '--dry-run', '--help'].includes(flag)) {
      options[flag.slice(2)] = true;
    } else {
      const value = args[++index];
      if (value === undefined || !value.trim() || value.startsWith('--')) throw new Error('argument requires a nonempty value; use --help');
      options[flag.slice(2)] = value;
    }
  }
  if (options.help) return options;
  if (!options.data) throw new Error('--data is required');
  if (options.apply && options['dry-run']) throw new Error('--apply and --dry-run are mutually exclusive');
  if (options.apply && (!options.offline || !options.backup)) throw new Error('--apply requires both --offline and --backup');
  return options;
}

/** Entry point also exported for integration; import never reads files or runs it. */
export function runPopulationCLI(args = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr } = {}) {
  let options;
  try { options = parseArgs(args); } catch (error) {
    stderr.write(`population-roster: ${error.message}\n`);
    return 2;
  }
  if (options.help) { stdout.write(HELP); return 0; }
  let peopleTemporary;
  let reportTemporary;
  let exitCode = 1;
  try {
    const data = safePath(options.data, { directory: true });
    const live = snapshot(path.join(data, 'people.json'));
    const backupDirectory = options.backup ? safePath(options.backup, { directory: true }) : null;
    const backup = backupDirectory ? snapshot(path.join(backupDirectory, 'people.json')) : null;
    if (backup) matchedBackup(live, backup);
    const report = options.report ? reportTarget(options.report, data, backupDirectory) : null;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(live.bytes);
    const result = redistributePopulation(JSON.parse(text), { seed: options.seed });
    // Keep the exact bytes and mtime on an idempotent run, not just equal JSON.
    const output = result.diffs.length ? serializeLike(result.people, live.bytes) : live.bytes;
    const summary = {
      mode: options.apply ? 'apply' : 'dry-run', written: options.apply && result.diffs.length > 0,
      backupVerified: Boolean(backup), inputSha256: live.sha256, outputSha256: sha256(output),
      counts: result.counts,
      changes: {
        residents: result.diffs.length,
        char: result.diffs.filter(diff => diff.fields.includes('app.char')).length,
        body: result.diffs.filter(diff => diff.fields.includes('app.body')).length,
        addedChar: result.diffs.filter(diff => !own(diff.before, 'char')).length,
        addedBody: result.diffs.filter(diff => !own(diff.before, 'body')).length,
      },
      proof: result.proof,
    };
    const reportBytes = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`);
    if (report) reportTemporary = stageFile(report, reportBytes);
    if (summary.written) peopleTemporary = stageFile(live.filename, output, live.stat);
    // Recheck identity, permissions and bytes after staging, immediately before
    // publishing. Changes to either snapshot are a failure, never a fresh read.
    unchanged(live);
    if (backup) unchanged(backup);
    if (peopleTemporary) {
      unchanged(peopleTemporary);
      fs.renameSync(peopleTemporary.filename, live.filename);
      peopleTemporary = undefined;
      syncDirectory(data);
    }
    if (reportTemporary) {
      reportTarget(report, data, backupDirectory);
      unchanged(reportTemporary);
      // link is exclusive: a racing report creator cannot be overwritten.
      fs.linkSync(reportTemporary.filename, report);
      fs.unlinkSync(reportTemporary.filename);
      reportTemporary = undefined;
      syncDirectory(path.dirname(report));
    }
    stdout.write(reportBytes);
    exitCode = 0;
  } catch (error) {
    stderr.write(`population-roster: ${error.message}\n`);
  } finally {
    for (const temporary of [peopleTemporary, reportTemporary]) {
      if (!temporary) continue;
      try { fs.unlinkSync(temporary.filename); } catch (error) {
        stderr.write(`population-roster: temporary cleanup failed: ${error.message}\n`);
        exitCode = 1;
      }
    }
  }
  return exitCode;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = runPopulationCLI();
}
