#!/usr/bin/env node
// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Prepares the stored secrets of a staging copy of live data (DECISIONS C99). Staging keeps a key of its own: the
// two-factor secrets and the recovery-code key are opened with live's key and sealed again with staging's key, so
// signing in to staging works exactly as on live; every other stored secret (service credentials) is deleted from the
// copy. Staging never holds live's key. Nothing secret is printed.
// Usage: node tools/deploy/reseal-copy.mjs --data <copied data folder>
//          (--from-unit <live unit> | --from-key-file <file>) (--to-unit <staging unit> | --to-key-file <file>)
//          [--systemctl "<command>"]
// A --to key file that does not exist yet is created (0600).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SecretBox, KeyConfigError } from '../../server/secrets.js';
import { registerSecretHolders } from '../../server/secret-holders.js';
import { unitEnv } from './unitenv.mjs';
import { openAsIs } from './keycheck.mjs';

const USAGE = 'usage: node tools/deploy/reseal-copy.mjs --data <copied data folder> (--from-unit <unit> | --from-key-file <file>) (--to-unit <unit> | --to-key-file <file>)';
const SIGN_IN = new Set(['twofa', 'recovery']);
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

function main() {
  let o;
  try {
    o = parseArgs({ options: {
      data: { type: 'string' }, 'from-unit': { type: 'string' }, 'from-key-file': { type: 'string' },
      'to-unit': { type: 'string' }, 'to-key-file': { type: 'string' }, systemctl: { type: 'string' },
    } }).values;
  } catch (e) { console.error(`${e.message}\n${USAGE}`); return 2; }
  const sc = o.systemctl || 'systemctl --user';
  const envOf = (unit, file) => (unit ? unitEnv(unit, sc) : file ? { MVW_KEY_FILE: path.resolve(file) } : null);   // options: relative to where the command runs
  if (!o.data || !(o['from-unit'] || o['from-key-file']) || !(o['to-unit'] || o['to-key-file'])) { console.error(USAGE); return 2; }
  const data = path.resolve(o.data), dbFile = path.join(data, 'next.db');
  if (!fs.existsSync(dbFile)) { console.log('no accounts database in the copy: nothing to re-seal'); return 0; }
  const store = openAsIs(dbFile), db = store.db;
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  const dropExpected = () => {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get()) db.prepare("DELETE FROM settings WHERE key = 'secrets.expectedKey'").run();
  };
  try {
    const from = registerSecretHolders(new SecretBox(), store);
    const values = from.values();
    if (!values.length) { tx(dropExpected); console.log('nothing sealed in the copy'); return 0; }
    from.load({ env: envOf(o['from-unit'], o['from-key-file']), dataDir: null, create: false });   // live's key
    const to = new SecretBox();
    to.load({ env: envOf(o['to-unit'], o['to-key-file']), dataDir: data, create: true });        // staging's own key
    if (to.fps[0] === from.fps[0]) {
      console.error(`staging uses the same key as live (${to.fps[0]}): give staging a key file of its own (DECISIONS C99)`);
      return 1;
    }
    let kept = 0, dropped = 0, unreadable = 0;
    tx(() => {
      for (const v of values) {
        if (!SIGN_IN.has(v.holder.kind)) { v.holder.forget(v.id); dropped++; continue; }
        let plain;
        try { plain = from.open(v.sealed, v.aad); } catch { v.holder.forget(v.id); unreadable++; continue; }
        v.holder.update(v.id, to.seal(plain, v.aad));
        kept++;
      }
      dropExpected();
    });
    console.log(`staging copy: ${plural(kept, 'sign-in secret')} sealed again with staging's key ${to.fps[0]}; ${plural(dropped, 'service secret')} deleted`
      + (unreadable ? `; ${unreadable} could not be opened with live's key and were deleted` : ''));
    return 0;
  } catch (e) {
    if (e instanceof KeyConfigError) { console.error(e.message); return 1; }
    throw e;
  } finally {
    db.close();
  }
}

process.exitCode = main();
