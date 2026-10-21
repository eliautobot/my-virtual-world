#!/usr/bin/env node
// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The starting map a new installation opens with (server/world/starter.js).
// Usage: node tools/starter-map.mjs export <data folder> [--out <file.json.gz>] [--name <city name>]
//          the world and the live lots of an installation (read from a copy of its database, so it may be running)
//          become the starting map - no residents, accounts, agents, owners or money go with it
//        node tools/starter-map.mjs info [<file.json.gz>]
//          what a starting map holds
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { openDb } from '../server/db.js';
import { WorldDb } from '../server/world/world-db.js';
import { starterBundle, writeStarter, starterWhy, STARTER_FILE } from '../server/world/starter.js';

const [, , cmd, arg] = process.argv;
const opt = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const fail = msg => { console.error(msg); process.exit(1); };

function summary(b) {
  const live = b.world.buildings.filter(B => B && !B.gone), kinds = {};
  for (const B of live) kinds[B.type] = (kinds[B.type] || 0) + 1;
  return `"${b.name}": ${live.length} buildings (${Object.entries(kinds).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${n} ${k}`).join(', ')}), `
    + `${b.lots.length} lots, ${(b.world.roads || []).length} roads, ${(b.world.stations || []).length} stations, ${(b.world.worldModules || []).length} world modules`;
}

if (cmd === 'export') {
  const data = path.resolve(arg || fail('Which data folder?'));
  if (!fs.existsSync(path.join(data, 'next.db'))) fail(`${data} has no next.db`);
  // a copy of the database (with its write-ahead log), so a running server is never touched
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-starter-'));
  try {
    for (const f of ['next.db', 'next.db-wal', 'next.db-shm']) if (fs.existsSync(path.join(data, f))) fs.copyFileSync(path.join(data, f), path.join(tmp, f));
    const dbs = openDb(tmp), wdb = new WorldDb(dbs, { log: () => {} });
    const world = wdb.loadWorld() || fail('That data folder holds no world');
    const lots = dbs.db.prepare("SELECT * FROM lots WHERE world_id = ? AND lifecycle != 'retired' ORDER BY id").all(dbs.worldId).map(r => ({
      id: r.id, region: r.region, block: r.block, poly: JSON.parse(r.poly_json), zoning: r.zoning, lifecycle: r.lifecycle,
      frontage: r.frontage_json ? JSON.parse(r.frontage_json) : null, access: r.access, name: r.name, note: r.note,
    }));
    dbs.db.close();
    const b = starterBundle(world, lots, { name: opt('name') });
    const out = writeStarter(b, path.resolve(opt('out') || STARTER_FILE));
    console.log(`written ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB): ${summary(b)}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
} else if (cmd === 'info') {
  const file = path.resolve(arg || STARTER_FILE);
  let b;
  try { b = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); } catch (e) { fail(`${file}: ${e.message}`); }
  const why = starterWhy(b);
  if (why) fail(`${file}: ${why}`);
  console.log(`${file}: ${summary(b)}; exported ${b.exportedAt}`);
} else {
  fail('Usage: node tools/starter-map.mjs export <data folder> [--out <file>] [--name <city name>] | info [<file>]');
}
