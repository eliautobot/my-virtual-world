#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Puts the fountain at the centre of every park that has none (2026-10-05: the park generator reserved the cross
// paths before placing its fountain, so no park ever got one; server/world/layouts.js parkLevel is fixed). Nothing else
// on the parks changes; a park whose centre is taken by something else is reported and left alone.
//
// Run it only while the server that uses the data folder is STOPPED. A full copy of the folder is made first
// (<data>.before-park-fountains-<time>); to undo, stop the server and put that copy back.
// Usage: node tools/wp4/add-park-fountains.mjs --data <data folder> --server-stopped [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { openDb } from '../../server/db.js';
import { Store } from '../../server/store.js';
import { CATALOG } from '../../shared/catalog.js';
import { itemAABB } from '../../shared/geom.js';

function fail(msg) { console.error(`add-park-fountains: ${msg}`); process.exit(1); }
let o;
try { ({ values: o } = parseArgs({ options: { data: { type: 'string' }, 'server-stopped': { type: 'boolean' }, 'dry-run': { type: 'boolean' } } })); } catch (e) { fail(e.message); }
if (!o.data) fail('usage: --data <data folder> --server-stopped [--dry-run]');
if (!o['server-stopped']) fail('stop the server that uses this data folder first, then pass --server-stopped');
const DATA = path.resolve(o.data);
for (const f of ['world.json', 'next.db']) if (!fs.existsSync(path.join(DATA, f))) fail(`${f} not found in ${DATA}`);
const store = new Store(DATA), world = store.load('world');
if (!world || world.format !== 1 || !Array.isArray(world.buildings)) fail('world.json is not a format-1 world');

const fb = itemAABB({ x: 0, z: 0, r: 0 }, CATALOG.fountain.rect);
const overlaps = it => {
  const d = CATALOG[it.t]; if (!d || d.block === false || !d.rect) return false;
  const b = itemAABB(it, d.rect);
  return b.x0 < fb.x1 && b.x1 > fb.x0 && b.z0 < fb.z1 && b.z1 > fb.z0;
};
let added = 0, had = 0;
const seen = new Set();
for (const B of world.buildings) {
  if (!B || B.gone || B.type !== 'park') continue;
  const lv = B.lv?.[0], L = world.levels[lv];
  if (!L || seen.has(lv)) continue;
  seen.add(lv);
  if (L.items.some(i => i.t === 'fountain')) { had++; continue; }
  const inWay = L.items.filter(overlaps);
  if (inWay.length) { console.log(`${B.name}: its centre has ${inWay.map(i => i.t).join(', ')} — left alone`); continue; }
  L.nid = (L.nid || L.items.reduce((m, i) => Math.max(m, i.id || 0), 0)) + 1;
  L.items.push({ t: 'fountain', x: 0, z: 0, r: 0, id: L.nid });
  added++;
  console.log(`${B.name}: fountain added`);
}
console.log(`fountains added: ${added}; parks that had one: ${had}`);
if (o['dry-run'] || !added) { console.log(added ? 'dry run: nothing written' : 'nothing to write'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const BACKUP = `${DATA}.before-park-fountains-${stamp}`;
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
