#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Lays a world's generated floors out again with the current generators (floor layouts step 4, 2026-10-04): every floor
// still as it was generated (mode auto, without a roll of its own) gets what its building's seed gives now; floors changed
// by hand, cleared or re-rolled stay exactly as they are. Residents keep a home or a job where the new floor still has
// that bed or desk; the server gives the others new ones when it starts.
//
// Run it only while the server that uses the data folder is STOPPED. A full copy of the folder is made first
// (<data>.before-regen-floors-<time>); to undo, stop the server and put that copy back.
// Usage: node tools/wp4/regen-floors.mjs --data <data folder> --server-stopped [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { openDb } from '../../server/db.js';
import { Store } from '../../server/store.js';
import { freshLevels } from '../../server/world/generate.js';

function fail(msg) { console.error(`regen-floors: ${msg}`); process.exit(1); }
let o;
try { ({ values: o } = parseArgs({ options: { data: { type: 'string' }, 'server-stopped': { type: 'boolean' }, 'dry-run': { type: 'boolean' } } })); } catch (e) { fail(e.message); }
if (!o.data) fail('usage: --data <data folder> --server-stopped [--dry-run]');
if (!o['server-stopped']) fail('stop the server that uses this data folder first, then pass --server-stopped');
const DATA = path.resolve(o.data);
for (const f of ['world.json', 'next.db']) if (!fs.existsSync(path.join(DATA, f))) fail(`${f} not found in ${DATA}`);
const store = new Store(DATA), world = store.load('world');
if (!world || world.format !== 1 || !Array.isArray(world.buildings)) fail('world.json is not a format-1 world');

let laid = 0, kept = 0;
const byKind = {};
for (const B of world.buildings) {
  if (!B || B.gone || !Array.isArray(B.lv) || !B.lv.length) continue;
  let fresh = null;
  const seen = new Set();
  B.lv.forEach((lv, f) => {
    if (seen.has(lv)) return;
    seen.add(lv);
    const L = world.levels[lv];
    if (!L) return;
    if (!L.auto || L.roll) { kept++; return; }
    fresh ||= freshLevels(B);
    const want = fresh(f);
    if (!want) { kept++; return; }
    const keep = { b: L.b ?? B.idx, nid: Math.max(L.nid || 0, want.nid || 0) };
    for (const k of Object.keys(L)) delete L[k];
    Object.assign(L, want, keep);
    laid++;
    byKind[B.type] = (byKind[B.type] || 0) + 1;
  });
}
console.log(`floors laid out again: ${laid} (${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ')}); kept as they are: ${kept}`);
if (o['dry-run']) { console.log('dry run: nothing written'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const BACKUP = `${DATA}.before-regen-floors-${stamp}`;
const dbs = openDb(DATA);
fs.mkdirSync(BACKUP, { recursive: true, mode: 0o700 });
for (const f of fs.readdirSync(DATA)) {
  if (/^next\.db(-wal|-shm)?$/.test(f)) continue;
  fs.cpSync(path.join(DATA, f), path.join(BACKUP, f), { recursive: true, preserveTimestamps: true });
}
await dbs.backupTo(path.join(BACKUP, 'next.db'));
dbs.close();
console.log(`backup: ${BACKUP}`);
world.version = (world.version || 1) + 1;
store.save('world', world);
console.log('world.json written: the server takes it in at its next start');
