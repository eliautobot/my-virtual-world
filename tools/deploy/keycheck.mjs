#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Checks the key for stored secrets before a release is promoted or the server restarted (DECISIONS C98): it is set up
// as the server needs it (MVW_KEY_FILE or MVW_SECRET_KEY, exactly one, outside the data folder) and opens every stored
// secret. A server that cannot open its secrets refuses to start, and so would the release a failed promotion rolls
// back to, because every release reads the same key; promote.sh therefore runs this before it stops live.
// Usage: node tools/deploy/keycheck.mjs --data <data folder> [--unit <systemd unit>] [--systemctl "<command>"]
//        Without --unit, this process's environment is used. Exit 0: fine; 1: not (the reason is printed); 2: usage.
// It never migrates the database and never prints a key.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DatabaseSync } from '../../server/sqlite.js';
import { SecretBox, KeyConfigError, keySource, unreadableHelp } from '../../server/secrets.js';
import { registerSecretHolders } from '../../server/secret-holders.js';
import { unitEnv } from './unitenv.mjs';

const USAGE = 'usage: node tools/deploy/keycheck.mjs --data <data folder> [--unit <systemd unit>] [--systemctl "<command>"]';
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Opens an accounts database as it is (no migration): { db, worldId }. */
export function openAsIs(file) {
  const db = new DatabaseSync(file, { timeout: 10000 });
  const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  const worldId = (hasMeta && db.prepare("SELECT value FROM meta WHERE key = 'world_id'").get()?.value) || '';
  return { db, worldId };
}

function main() {
  let o;
  try { o = parseArgs({ options: { data: { type: 'string' }, unit: { type: 'string' }, systemctl: { type: 'string' } } }).values; } catch (e) {
    console.error(`${e.message}\n${USAGE}`);
    return 2;
  }
  if (!o.data) { console.error(USAGE); return 2; }
  const data = path.resolve(o.data), dbFile = path.join(data, 'next.db');
  let env;
  try { env = o.unit ? unitEnv(o.unit, o.systemctl || 'systemctl --user') : process.env; } catch (e) {
    console.error(`cannot read the environment of ${o.unit}: ${e.message.split('\n')[0]}`);
    return 1;
  }
  const box = new SecretBox();
  let store = null;
  try {
    if (fs.existsSync(dbFile)) {
      store = openAsIs(dbFile);
      registerSecretHolders(box, store);
    }
    const src = keySource(env, data), n = box.values().length;
    if (src.source === 'file' && !fs.existsSync(src.file)) {
      if (n) {
        console.error(`The key file ${src.file} (MVW_KEY_FILE) does not exist, but the database holds ${plural(n, 'sealed secret')}. `
          + 'Point MVW_KEY_FILE at the key that belongs to this data, or delete the secrets with: node tools/admin.mjs forget-secrets --all --yes');
        return 1;
      }
      console.log(`key ok: the key file ${src.file} does not exist yet and nothing is sealed; the server creates it at start`);
      return 0;
    }
    box.load({ env, dataDir: data, create: false });
    const bad = box.unreadable();
    if (bad.length) { console.error(unreadableHelp(bad, box)); return 1; }
    console.log(`key ok: ${src.source === 'env' ? 'MVW_SECRET_KEY' : src.file}, key ${box.fps[0]}${box.fps[1] ? ` (previous ${box.fps[1]})` : ''}; ${plural(n, 'stored secret')} open with it`);
    return 0;
  } catch (e) {
    if (e instanceof KeyConfigError) { console.error(e.message); return 1; }
    throw e;
  } finally {
    store?.db.close();
  }
}

// Run as a command, not when reseal-copy.mjs imports openAsIs().
const isMain = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) process.exitCode = main();
