#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The accounts database's schema number, and lowering it for a rollback (DECISIONS C84).
// Usage: node tools/deploy/dbschema.mjs version <next.db>              the database's schema number
//        node tools/deploy/dbschema.mjs release-schema <release folder>  the schema a release knows (0: it has no
//                                                                        accounts database and ignores next.db)
//        node tools/deploy/dbschema.mjs downgrade <next.db> <schema>     lowers the schema number when every newer
//                                                                        migration only added things; exit 3 when not
// Run it from the newest code (the repository checkout): it knows which migrations are additive.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from '../../server/sqlite.js';
import { downgradeSchema } from '../../server/db.js';

const [cmd, a, b] = process.argv.slice(2);
const usage = () => {
  console.error('usage: node tools/deploy/dbschema.mjs version <next.db> | release-schema <release folder> | downgrade <next.db> <schema>');
  process.exit(2);
};
if (cmd === 'release-schema') {
  if (!a) usage();
  const f = path.join(a, 'server', 'db.js');
  if (!fs.existsSync(f)) { console.log(0); process.exit(0); }
  const m = await import(pathToFileURL(f).href);
  console.log(Number(m.SCHEMA_VERSION) || 0);
  process.exit(0);
}
if ((cmd !== 'version' && cmd !== 'downgrade') || !a || (cmd === 'downgrade' && !/^\d+$/.test(b || ''))) usage();
if (!fs.existsSync(a)) { console.error(`no database at ${a}`); process.exit(1); }
const db = new DatabaseSync(a, { timeout: 10000 });
try {
  if (cmd === 'version') {
    console.log(db.prepare('PRAGMA user_version').get().user_version);
  } else {
    const r = downgradeSchema(db, Number(b));
    if (!r.ok) {
      console.error(`cannot lower the schema of ${a} from ${r.from} to ${r.to}: ${r.why}`);
      process.exitCode = 3;
    } else {
      console.log(r.changed ? `schema ${r.from} -> ${r.to}: only additive changes, nothing deleted` : `schema ${r.from}: nothing to do`);
    }
  }
} finally {
  db.close();
}
