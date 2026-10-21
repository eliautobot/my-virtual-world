#!/usr/bin/env node
// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Consistent copy of a (possibly running) server's accounts database: node tools/deploy/dbcopy.mjs <next.db> <copy>
// SQLite's online backup copies every page even while the server writes; a plain file copy of a WAL database can be
// torn. The copy is created with mode 0600 and checked with PRAGMA integrity_check. The source is never migrated.
import fs from 'node:fs';
import { DatabaseSync } from '../../server/sqlite.js';
import { backupDb } from '../../server/db.js';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error('usage: node tools/deploy/dbcopy.mjs <next.db> <copy>');
  process.exit(2);
}
if (!fs.existsSync(src)) {
  console.error(`no database at ${src}`);
  process.exit(1);
}
const db = new DatabaseSync(src, { timeout: 10000 });
try {
  const pages = await backupDb(db, dest);
  const check = new DatabaseSync(dest, { timeout: 10000 });
  const result = check.prepare('PRAGMA integrity_check').get();
  check.close();
  const verdict = result && Object.values(result)[0];
  if (verdict !== 'ok') throw new Error(`the copy failed its integrity check: ${JSON.stringify(result)}`);
  console.log(`copied ${src} to ${dest} (${pages} pages, integrity ok)`);
} catch (e) {
  fs.rmSync(dest, { force: true });
  console.error(`dbcopy: ${e.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
