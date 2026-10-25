#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Account and key administration on the host for My Virtual World. It opens <data>/next.db directly, so it
// works while the server runs (SQLite WAL); a running server notices sign-outs made here within a minute, and a new key
// file within seconds. Nothing secret is ever printed: temporary passwords and keys go to files readable only by their
// owner (0600), chosen passwords come from standard input.
// Usage: node tools/admin.mjs <command> [--data <data folder>] [--key-file <file>]
//        data: --data, else $MVW_DATA, else ./data. Key: --key-file, else $MVW_KEY_FILE or $MVW_SECRET_KEY (as the
//        server's service has them; a login shell usually does not, so pass --key-file).
//   status            the owner's state, account and session counts, the key and the stored secrets
//   reset-owner       a new temporary owner password in <data>/first-owner-password.txt (72 hours); also unlocks and
//                     re-enables the owner account, turns off its two-factor sign-in and signs it out everywhere. Before
//                     the administrator account exists: a new setup code in <data>/setup-code.txt
//   create-account    --login <username> --name <display name> --role member|admin [--must-change] --password-stdin
//                     creates an account with the password read from standard input (typed without echo on a terminal)
//   sessions-clear    signs every account out (after copying live data to a staging copy)
//   unlock <login>    clears the sign-in failure locks of an account
//   list-admins       the owner and the admins
//   new-key <file>    writes a new random key to <file> (0600; never over an existing file), for MVW_KEY_FILE, or its
//                     content for MVW_SECRET_KEY
//   rotate-key [--forget]
//                     a new key for stored secrets (DECISIONS C87): the key file then holds the new key and the previous
//                     one, and every stored secret is sealed again with the new key; a running server switches within
//                     seconds. --forget drops the old key at once (it leaked) and deletes the two-factor recovery codes
//                     (C96, C97). With MVW_SECRET_KEY, it explains how to rotate by hand.
//   forget-secrets --unreadable | --all --yes
//                     deletes the stored secrets the key cannot open (or all of them, only with --yes); the accounts concerned set up
//                     two-factor sign-in again (C88)
//   licence-status    demo mode or licensed (tier, activation date, the key masked)
//   licence-import <license.json | release 1 data folder>
//                     imports a release 1 licence, validated with Lemon Squeezy (no new activation; WP1.11, C109)
//   backup [--out <file>]
//                     a .tar.gz of the world files, a consistent copy of the accounts database and of the agents' PC
//                     (pc/pc.db and its file store pc/blobs), the city's songs (music/), made while the server runs (DECISIONS C111), written as it
//                     goes (never held in memory whole), to standard output unless --out names a new file. It leaves out
//                     the key (back it up separately) and the first owner's temporary password, and never migrates.
// Every change is recorded in the audit log as a host action.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import { openDb, backupDb } from '../server/db.js';
import { DatabaseSync } from '../server/sqlite.js';
import { Accounts, AuthError } from '../server/auth/accounts.js';
import { Audit } from '../server/auth/audit.js';
import { SecretBox, KeyConfigError, newKey, fingerprint, writeKeyFile, keySource, isInside, unreadableHelp } from '../server/secrets.js';
import { registerSecretHolders, RECOVERY_KEY } from '../server/secret-holders.js';
import { Licence, LicenceError } from '../server/licence.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS = ['status', 'reset-owner', 'create-account', 'sessions-clear', 'unlock', 'list-admins', 'new-key', 'rotate-key', 'forget-secrets', 'backup', 'licence-status', 'licence-import'];
const WITH_ARGUMENT = ['unlock', 'new-key', 'licence-import'];
const USAGE = [
  'usage: node tools/admin.mjs licence-status | licence-import <license.json or release 1 data folder> [--data <folder>] [--key-file <file>]',
  'usage: node tools/admin.mjs status|reset-owner|sessions-clear|list-admins [--data <folder>] [--key-file <file>]',
  '       node tools/admin.mjs unlock <login> [--data <folder>]',
  '       node tools/admin.mjs create-account --login <name> --name <display name> --role member|admin [--must-change] --password-stdin [--data <folder>]',
  '       node tools/admin.mjs new-key <file>',
  '       node tools/admin.mjs backup [--out <file>] [--data <folder>]   (a .tar.gz; to standard output unless --out)',
  '       node tools/admin.mjs rotate-key [--forget] [--data <folder>] [--key-file <file>]',
  '       node tools/admin.mjs forget-secrets --unreadable|--all --yes [--data <folder>] [--key-file <file>]',
].join('\n');
const ENV_ROTATE = [
  'The key comes from MVW_SECRET_KEY, so this tool cannot rotate it. To rotate it by hand:',
  '  1. node tools/admin.mjs new-key <file>   (a new key; its content is the new value)',
  '  2. set MVW_SECRET_KEY_PREVIOUS to the current key and MVW_SECRET_KEY to the new one, then restart the server:',
  '     it seals every stored secret again with the new key at start',
  '  3. at the next rotation, replace MVW_SECRET_KEY_PREVIOUS; remove it at once if the old key leaked.',
].join('\n');

/** Standard input as text (empty on a terminal: nothing was piped in). */
async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}
async function readPassword() {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  process.stderr.write('Password (not shown): ');
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let pw = '';
    const done = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData); process.stderr.write('\n'); };
    const onData = chunk => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') { done(); return resolve(pw); }
        if (c === '\u0003') { done(); return reject(new Error('cancelled')); }
        pw = c === '\u007f' || c === '\b' ? pw.slice(0, -1) : pw + c;
      }
    };
    process.stdin.on('data', onData);
  });
}

/** The key settings to use: --key-file wins over the environment. */
function keyEnv(o) {
  const env = { ...process.env };
  if (o['key-file']) {
    env.MVW_KEY_FILE = path.resolve(o['key-file']);   // a command-line option: relative to where the command runs
    delete env.MVW_SECRET_KEY;
    delete env.MVW_SECRET_KEY_PREVIOUS;
  }
  return env;
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Files of a data folder that a backup leaves out: the accounts database's own files (it is copied through SQLite's
// online backup instead), temporary and previous versions, and the first owner's temporary password.
const BACKUP_SKIP = /^(next\.db(-wal|-shm|-journal)?|first-owner-password\.txt|setup-code\.txt)$|\.(tmp|bak)$/;
const stampOf = f => { try { const s = fs.statSync(f); return `${s.ino}:${s.size}:${s.mtimeMs}`; } catch { return 'gone'; } };

/** The 512-byte ustar header of one file. */
function tarHeader(name, size, mtimeMs) {
  const octal = (n, len) => `${n.toString(8).padStart(len - 1, '0')}\0`;
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write(octal(0o600, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  h.write(octal(size, 12), 124, 'ascii');
  h.write(octal(Math.floor(mtimeMs / 1000), 12), 136, 'ascii');
  h.write(' '.repeat(8), 148, 'ascii');
  h.write('0', 156, 'ascii');
  h.write('ustar\u000000', 257, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return h;
}
/** Writes a gzip-compressed ustar archive to `out` (a writable stream) as it goes: each entry is { name, body } (held
 *  in memory: the world files, the databases' copies) or { name, file } (read when its turn comes: the PC's file store).
 *  Resolves with the compressed bytes written. */
async function writeTarGz(entries, out, mtimeMs) {
  const gz = zlib.createGzip();
  let bytes = 0;
  gz.on('data', d => { bytes += d.length; });
  // (a pipe never ends standard output: there, the archive is done once the gzip stream has given out its last bytes)
  const toStd = out === process.stdout;
  const done = new Promise((resolve, reject) => {
    out.on('error', reject); gz.on('error', reject);
    if (toStd) gz.on('end', () => out.write('', () => resolve())); else out.on('finish', resolve);
  });
  gz.pipe(out);
  const put = b => (gz.write(b) ? null : new Promise(r => gz.once('drain', r)));
  for (const e of entries) {
    let body = e.body;
    if (!body) { try { body = fs.readFileSync(e.file); } catch { continue; } }   // (swept meanwhile: it isn't needed)
    await put(tarHeader(e.name, body.length, mtimeMs));
    await put(body);
    const pad = (512 - (body.length % 512)) % 512;
    if (pad) await put(Buffer.alloc(pad));
  }
  await put(Buffer.alloc(1024));
  gz.end();
  await done;
  return bytes;
}

/** node tools/admin.mjs backup: see the usage at the top. */
async function backup(data, out) {
  const toStdout = !out || out === '-';
  if (toStdout && process.stdout.isTTY) {
    console.error('backup writes a .tar.gz archive: pass --out <file>, or redirect standard output to a file');
    return 2;
  }
  if (!fs.existsSync(path.join(data, 'world.json'))) { console.error(`no world in ${data}: world.json is missing`); return 1; }
  const dest = toStdout ? null : path.resolve(out);
  if (dest && fs.existsSync(dest)) { console.error(`${dest} exists already; choose a new file`); return 1; }
  if (dest && isInside(dest, data)) { console.error(`${dest} lies inside the data folder; write the backup outside it`); return 1; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-backup-'));
  try {
    // The world files as the server last saved them (it replaces each one atomically); read again if it saved meanwhile.
    const names = fs.readdirSync(data, { withFileTypes: true })
      .filter(e => e.isFile() && !BACKUP_SKIP.test(e.name) && Buffer.byteLength(e.name) < 100).map(e => e.name).sort();
    let files = null;
    for (let i = 0; i < 10 && !files; i++) {
      const before = names.map(n => stampOf(path.join(data, n)));
      const read = names.map(n => ({ name: n, body: fs.readFileSync(path.join(data, n)) }));
      if (names.every((n, k) => stampOf(path.join(data, n)) === before[k])) files = read;
      else await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!files) { console.error('the server kept saving while the backup read the world files; try again'); return 1; }
    const dbFile = path.join(data, 'next.db');
    if (fs.existsSync(dbFile)) {
      const copy = path.join(tmp, 'next.db');
      const src = new DatabaseSync(dbFile, { timeout: 10000 });
      try { await backupDb(src, copy); } finally { src.close(); }
      const check = new DatabaseSync(copy, { timeout: 10000 });
      let verdict;
      try { verdict = Object.values(check.prepare('PRAGMA integrity_check').get() || {})[0]; } finally { check.close(); }
      if (verdict !== 'ok') { console.error(`the copy of next.db failed its integrity check: ${verdict}`); return 1; }
      files.push({ name: 'next.db', body: fs.readFileSync(copy) });
    }
    // the agents' PC (docs/features/agent-pc.md): its database through SQLite's online backup, then its file store —
    // the database first, so every content it names was already there when its copy was made
    const pcDb = path.join(data, 'pc', 'pc.db');
    let pcFiles = 0;
    if (fs.existsSync(pcDb)) {
      const copy = path.join(tmp, 'pc.db');
      const src = new DatabaseSync(pcDb, { timeout: 10000 });
      try { await backupDb(src, copy); } finally { src.close(); }
      files.push({ name: 'pc/pc.db', body: fs.readFileSync(copy) });
      const store = path.join(data, 'pc', 'blobs');
      for (const d of fs.existsSync(store) ? fs.readdirSync(store, { withFileTypes: true }) : []) {
        if (!d.isDirectory() || !/^[0-9a-f]{2}$/.test(d.name)) continue;
        for (const f of fs.readdirSync(path.join(store, d.name))) if (/^[0-9a-f]{64}$/.test(f)) { files.push({ name: `pc/blobs/${d.name}/${f}`, file: path.join(store, d.name, f) }); pcFiles++; }
      }
    }
    // the city's music (docs/features/music.md): its songs' files (the library itself is in next.db)
    const songs = path.join(data, 'music');
    let musicFiles = 0;
    for (const f of fs.existsSync(songs) ? fs.readdirSync(songs) : []) if (/^[0-9a-f]{18}\.mp3$/.test(f)) { files.push({ name: `music/${f}`, file: path.join(songs, f) }); musicFiles++; }
    const out = dest ? fs.createWriteStream(dest, { mode: 0o600, flags: 'wx' }) : process.stdout;
    const size = await writeTarGz(files, out, Date.now());
    const named = files.filter(f => !f.name.startsWith('pc/blobs/') && !f.name.startsWith('music/')).map(f => f.name);
    console.error(`backup of ${data}: ${named.join(', ')}${pcFiles ? ` and ${pcFiles} PC files` : ''}${musicFiles ? ` and ${musicFiles} songs` : ''} (${(size / 1048576).toFixed(1)} MB)${dest ? ` in ${dest}` : ''}. `
      + 'The key for stored secrets is not in it: back it up separately (docs/SECRETS.md).');
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  let a;
  try {
    a = parseArgs({ allowPositionals: true, options: {
      data: { type: 'string' }, login: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' },
      'must-change': { type: 'boolean', default: false }, 'password-stdin': { type: 'boolean', default: false },
      'key-file': { type: 'string' }, forget: { type: 'boolean', default: false }, out: { type: 'string' },
      unreadable: { type: 'boolean', default: false }, all: { type: 'boolean', default: false }, yes: { type: 'boolean', default: false },
      clear: { type: 'boolean', default: false },
      batch: { type: 'string' }, max: { type: 'string' }, days: { type: 'string' }, note: { type: 'string' }, count: { type: 'string' },
    } });
  } catch (e) { console.error(`${e.message}\n${USAGE}`); return 2; }
  const cmd = a.positionals[0], o = a.values;
  if (!COMMANDS.includes(cmd) || a.positionals.length > (WITH_ARGUMENT.includes(cmd) ? 2 : 1)) { console.error(USAGE); return 2; }
  if (WITH_ARGUMENT.includes(cmd) && !a.positionals[1]) { console.error(USAGE); return 2; }
  if (!o.data && process.env.MVW_DATA && !path.isAbsolute(process.env.MVW_DATA)) {
    console.error(`MVW_DATA must be an absolute path, not "${process.env.MVW_DATA}" (DECISIONS C102); or pass --data`);
    return 2;
  }
  const data = path.resolve(o.data || process.env.MVW_DATA || path.join(ROOT, 'data'));

  if (cmd === 'new-key') {
    const file = path.resolve(a.positionals[1]);
    if (isInside(file, data)) { console.error(`${file} lies inside the data folder ${data}: keep the key outside it, so copies of the data do not carry it`); return 1; }
    if (fs.existsSync(file)) { console.error(`${file} exists already; choose a new file`); return 1; }
    const k = newKey();
    writeKeyFile(file, [k], { exclusive: true });
    console.log(`Wrote a new key (fingerprint ${fingerprint(k)}) to ${file}, readable only by this user.`);
    console.log('Use it with MVW_KEY_FILE, or its content as MVW_SECRET_KEY. Back it up separately from the data: without it, stored secrets are lost.');
    return 0;
  }

  if (cmd === 'backup') return backup(data, o.out);

  const store = openDb(data);
  try {
    const audit = new Audit(store);
    const acc = new Accounts(store, { dataDir: data, log: (...m) => console.log(...m), audit });
    const tx = fn => store.tx(fn);
    const newBox = () => registerSecretHolders(new SecretBox(), store);
    if (cmd === 'licence-status' || cmd === 'licence-import') {
      const box = newBox();
      box.load({ env: keyEnv(o), dataDir: data, create: false });
      const lic = new Licence(store, { box, audit });
      if (cmd === 'licence-import') {
        try { await lic.importRelease1(path.resolve(a.positionals[1]), { id: null, login: 'host' }); } catch (e) {
          if (e instanceof LicenceError) { console.error(`Not imported: ${e.message}`); return 1; }
          throw e;
        }
        console.log('Imported and validated with Lemon Squeezy (no new activation). A running server picks it up within 2 seconds.');
      }
      const s = lic.ownerStatus();
      console.log(s.active ? `licensed      ${s.tierName}, activated ${s.activatedAt}${s.imported ? ' (imported from release 1)' : ''}, key ${s.key}` : 'demo mode     no licence key is active');
      return 0;
    }
    if (cmd === 'status') {
      const s = acc.status();
      const when = t => (t ? new Date(t).toISOString() : '-');
      console.log(`data folder   ${data}`);
      console.log(`world id      ${s.worldId}`);
      console.log(s.owner
        ? `owner         ${s.owner.login} (${s.owner.displayName}), ${s.owner.status}${s.owner.locked ? ', locked' : ''}${s.owner.temporaryPassword ? `, temporary password until ${when(s.owner.tempExpires)}` : ''}`
        : `owner         none yet: open the world in a browser and create it with the setup code in ${acc.setupFile()}`);
      console.log(`accounts      ${s.accounts.map(r => `${r.n} ${r.role}${r.status === 'active' ? '' : ` (${r.status})`}`).join(', ') || 'none'}`);
      console.log(`sessions      ${s.sessions}`);
      console.log(`owner file    ${s.ownerFile ? acc.ownerFile() : 'none'}`);
      const box = newBox(), vals = box.values(), kinds = {};
      for (const v of vals) kinds[v.holder.name] = (kinds[v.holder.name] || 0) + 1;
      let keyLine, unreadable = 0;
      try {
        const env = keyEnv(o), src = keySource(env, data);
        if (src.source === 'file' && !fs.existsSync(src.file)) keyLine = `file ${src.file} (not created yet)`;
        else {
          box.load({ env, dataDir: data, create: false });
          unreadable = box.unreadable().length;
          keyLine = `${src.source === 'env' ? 'MVW_SECRET_KEY' : `file ${src.file}`}, key ${box.fps[0]}${box.fps[1] ? `, previous ${box.fps[1]}` : ''}`;
        }
      } catch (e) {
        if (!(e instanceof KeyConfigError)) throw e;
        keyLine = `not known here (${e.message.split('. ')[0]}); pass --key-file as the server has MVW_KEY_FILE`;
      }
      console.log(`key           ${keyLine}`);
      console.log(`secrets       ${vals.length} sealed${vals.length ? ` (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}${unreadable ? `; ${unreadable} cannot be opened with this key` : ''}`);
      return 0;
    }
    if (cmd === 'reset-owner') {
      const r = await acc.resetOwner();
      if (r.setup) {
        console.log('There is no administrator account yet. A new setup code is in ' + r.file + ' (readable only by this user).');
        console.log('Open the world in a browser and create the administrator account with it.');
        return 0;
      }
      console.log('Reset the owner account: unlocked, enabled, two-factor sign-in off, signed out everywhere.');
      console.log(`Its temporary password is in ${r.file} (readable only by this user, valid 72 hours).`);
      console.log(`Sign in with the name "${r.login}" and that password, then choose a new password.`);
      return 0;
    }
    if (cmd === 'sessions-clear') {
      console.log(`Signed out ${acc.clearSessions()} sessions.`);
      return 0;
    }
    if (cmd === 'unlock') {
      console.log(`Unlocked "${acc.unlock(a.positionals[1])}": it can sign in again from every address.`);
      return 0;
    }
    if (cmd === 'list-admins') {
      for (const u of acc.listAdmins()) console.log(`${u.role.padEnd(6)} ${u.login.padEnd(24)} ${u.displayName}${u.status === 'active' ? '' : ` (${u.status})`}`);
      return 0;
    }
    if (cmd === 'rotate-key') {
      const env = keyEnv(o), src = keySource(env, data);
      if (src.source === 'env') { console.error(ENV_ROTATE); return 2; }
      if (!fs.existsSync(src.file)) { console.error(`The key file ${src.file} does not exist yet: the server creates it at its first start. Nothing to rotate.`); return 1; }
      const box = newBox();
      box.load({ env, dataDir: data, create: false });
      const bad = box.unreadable();
      if (bad.length) { console.error(unreadableHelp(bad, box)); return 1; }
      box.reseal(tx);                                  // everything sealed with the current key first
      const old = [...box.keys], cur = old[0], next = newKey(), fp = fingerprint(next);
      // The new key's fingerprint goes to the database before the file: a running server then takes the new file even
      // before every value is sealed with it (C98), and seals what is left itself.
      tx(() => store.db.prepare(`INSERT INTO settings (world_id, key, value) VALUES (?, 'secrets.expectedKey', ?)
        ON CONFLICT (world_id, key) DO UPDATE SET value = excluded.value`).run(store.worldId, fp));
      writeKeyFile(src.file, o.forget ? [next] : [next, cur]);
      box.setKeys([next, ...old]);
      const n = box.reseal(tx);
      let codes = 0;
      if (o.forget) {
        const rec = box.holders.find(h => h.kind === 'recovery');
        const hasCodes = store.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recovery_codes'").get();
        if (hasCodes) codes = store.db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE account_id IN (SELECT id FROM accounts WHERE world_id = ?)').get(store.worldId).n;
        if (rec) tx(() => rec.forget(RECOVERY_KEY));   // a new random recovery-code key is made at the next use (C96, C97)
      }
      audit.log('host.rotate_key', { detail: { from: fingerprint(cur), to: fp, forget: !!o.forget, resealed: n, recoveryCodesDeleted: codes } });
      console.log(`Rotated the key for stored secrets: new key ${fp}; ${plural(n, 'stored secret')} sealed again with it.`);
      if (o.forget) {
        console.log(`The old key ${fingerprint(cur)} is gone: backups sealed with it can no longer be opened.`);
        console.log(`${plural(codes, 'recovery code')} deleted: users with two-factor sign-in create new ones in Account settings.`);
      } else {
        console.log(`The previous key ${fingerprint(cur)} stays in the key file until the next rotation, so backups up to one rotation old stay readable.`);
      }
      console.log('A running server switches to the new key within a few seconds. Back up the new key file separately from the data.');
      return 0;
    }
    if (cmd === 'forget-secrets') {
      if (o.unreadable === o.all) { console.error(USAGE); return 2; }
      const box = newBox();
      let list;
      if (o.all) list = box.values();
      else {
        const env = keyEnv(o), src = keySource(env, data);
        if (src.source === 'file' && !fs.existsSync(src.file)) {
          console.error(`The key file ${src.file} does not exist, so it opens nothing. To delete every stored secret, use --all.`);
          return 1;
        }
        box.load({ env, dataDir: data, create: false });
        list = box.unreadable();
      }
      if (!list.length) { console.log('Nothing to delete.'); return 0; }
      if (o.all && !o.yes) {   // DECISIONS C101
        console.error(`This would delete all ${plural(list.length, 'stored secret')}: accounts with two-factor sign-in would sign in with their `
          + 'password alone until they set it up again, and service credentials would have to be entered again. Run again with --yes to delete them.');
        return 1;
      }
      box.forget(list, tx);
      audit.log('host.forget_secrets', { detail: { mode: o.all ? 'all' : 'unreadable', count: list.length, what: list.slice(0, 50).map(v => v.label) } });
      console.log(`Deleted ${plural(list.length, 'stored secret')}:`);
      for (const v of list.slice(0, 20)) console.log(`  ${v.label}`);
      if (list.length > 20) console.log(`  … and ${list.length - 20} more`);
      console.log('Accounts whose two-factor secret was deleted sign in with their password alone until they set it up again.');
      return 0;
    }
    if (!o.login || !o.name || !['member', 'admin'].includes(o.role || '') || !o['password-stdin']) { console.error(USAGE); return 2; }
    const password = await readPassword();
    const r = await acc.createAccount({ login: o.login, displayName: o.name, role: o.role, password, mustChange: o['must-change'] });
    audit.log('host.create_account', { target: { id: r.user.id, login: r.user.login }, detail: { role: r.user.role } });
    console.log(`Created ${r.user.role} "${r.user.login}" (${r.user.displayName})${o['must-change'] ? '; the password must be changed at the first sign-in' : ''}.`);
    return 0;
  } catch (e) {
    if (e instanceof AuthError || e instanceof KeyConfigError) { console.error(e.message); return 1; }
    throw e;
  } finally {
    store.close();
  }
}

main().then(code => { process.exitCode = code; }, e => { console.error(e.stack || e.message); process.exitCode = 1; });
