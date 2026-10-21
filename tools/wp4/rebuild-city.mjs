#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Rebuilds a world's city on 100 × 100 ft lots (WP4, DECISIONS E25 (9)): a new street-and-lot layout and new buildings,
// with every lot created in the property store (municipal) and the lots under big buildings, parks and the
// headquarters merged. People are carried over exactly — accounts, residents (ids, names, looks, traits, routines),
// agents and their records — and move into the new buildings: homes, desks and shifts are given again by the
// population rules (agents first at the headquarters). Parked cars are cleared (their spots are gone), earlier edits
// stop being undoable (they describe buildings that no longer exist), players start from the spawn point if their
// saved spot is now inside a building (the server does that on its own).
//
// Run it only while the server that uses the data folder is STOPPED. A full copy of the folder is made first
// (<data>.before-rebuild-<time>); to undo, stop the server and put that copy back.
// Usage: node tools/wp4/rebuild-city.mjs --data <data folder> --server-stopped [--seed <s>] [--nx 8] [--nz 7] [--vacancy 0.1]
//          [--json <report>]
// --vacancy: the share of single lots outside downtown left empty (0–1; default 0.1). A launch world that owners build
// up (most lots for sale) uses a high share; downtown is always built.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { openDb } from '../../server/db.js';
import { Audit } from '../../server/auth/audit.js';
import { Property, MUNICIPALITY } from '../../server/property.js';
import { generateLotCity } from '../../server/world/generate-lots.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { reassign } from '../../server/sim/population.js';
import { Store } from '../../server/store.js';
import { RNG } from '../../shared/rng.js';

function fail(msg) { console.error(`rebuild-city: ${msg}`); process.exit(1); }
let o;
try {
  ({ values: o } = parseArgs({ options: { data: { type: 'string' }, 'server-stopped': { type: 'boolean' }, seed: { type: 'string', default: 'wp4-city' },
    nx: { type: 'string', default: '8' }, nz: { type: 'string', default: '7' }, vacancy: { type: 'string', default: '0.1' }, json: { type: 'string' } } }));
} catch (e) { fail(e.message); }
const vacancy = Number(o.vacancy);
if (!(vacancy >= 0 && vacancy <= 1)) fail('--vacancy is a share from 0 to 1');
if (!o.data) fail('usage: --data <data folder> --server-stopped [--seed s] [--nx 8] [--nz 7]');
if (!o['server-stopped']) fail('stop the server that uses this data folder first, then pass --server-stopped');
const DATA = path.resolve(o.data);
for (const f of ['world.json', 'people.json', 'next.db']) if (!fs.existsSync(path.join(DATA, f))) fail(`${f} not found in ${DATA}`);

// ---- 1. full copy of the data folder first
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const BACKUP = `${DATA}.before-rebuild-${stamp}`;
const dbs = openDb(DATA);
fs.mkdirSync(BACKUP, { recursive: true, mode: 0o700 });
for (const f of fs.readdirSync(DATA)) {
  if (/^next\.db(-wal|-shm)?$/.test(f)) continue;
  const src = path.join(DATA, f);
  fs.cpSync(src, path.join(BACKUP, f), { recursive: true, preserveTimestamps: true });
}
await dbs.backupTo(path.join(BACKUP, 'next.db'));
console.log(`backup: ${BACKUP}`);

// ---- 2. load
const store = new Store(DATA);
const old = store.load('world'), people = store.load('people'), vehicles = store.load('vehicles');
if (!old || old.format !== 1 || !Array.isArray(old.buildings)) fail('world.json is not a format-1 world');
if (old.worldId && old.worldId !== dbs.worldId) fail(`world.json belongs to world ${old.worldId} but next.db to ${dbs.worldId}`);
const P = new Property(dbs, { audit: new Audit(dbs) });
if (P.count() > 0) fail(`this world already has ${P.count()} lots; restore the copy made before the last rebuild to run it again`);

// ---- 3. the new city (same world id, name, headquarters name and population size)
const hq = old.buildings.find(b => b.type === 'hq' && !b.gone);
const world = generateLotCity({ seed: o.seed, name: old.name, hqName: hq?.name, population: old.population || people.length, nx: +o.nx, nz: +o.nz, vacancy });
world.worldId = old.worldId || dbs.worldId;
world.version = (old.version || 1) + 1;
world.created = old.created || world.created;
world.rebuiltAt = Date.now();

// ---- 4. property: plat every lot for the municipality, merge the groups buildings and parks stand on
const actor = { admin: true, account: { id: null, login: 'wp4-rebuild' } };
const keyToId = new Map();
const plat = P.plat(world.lots.map(l => ({ poly: l.poly, block: l.block, zoning: l.zoning, lifecycle: 'municipal' })), { actor, holder: MUNICIPALITY, reason: 'City rebuilt on 100 × 100 ft lots (WP4)' });
world.lots.forEach((l, i) => keyToId.set(l.key, plat.ids[i]));
const groupLot = new Map();
for (const gr of world.lotGroups) {
  const ids = gr.lots.map(k => keyToId.get(k));
  groupLot.set(gr.key, ids.length > 1 ? P.merge(ids, { actor, reason: `Merged for ${gr.kind === 'park' ? 'a park' : gr.kind === 'hq' ? 'the headquarters' : 'a larger building'}` }).id : ids[0]);
}
for (const b of world.buildings) { b.lot = groupLot.get(b.lotGroup); delete b.lotGroup; }
const vacantLots = world.lotGroups.filter(g => g.kind === 'vacant').map(g => groupLot.get(g.key));
delete world.lots; delete world.lotGroups;

// ---- 5. people move in: clear homes and workplaces in the old buildings, then the population rules give new ones
const index = new WorldIndex(world);
let movedJobs = 0;
for (const p of people) {
  if (p.retired) { p.home = null; continue; }
  p.home = null;
  const k = p.job?.kind;
  if (k === 'office' || k === 'vip' || k === 'staff') { p.job = { kind: 'free', title: p.job.title || 'Between jobs', seek: 1, prev: k }; movedJobs++; }
}
const re = reassign(world, index, people, new RNG('wp4-rebuild:' + world.worldId));
const homeless = people.filter(p => !p.retired && !p.home).length, jobless = people.filter(p => !p.retired && p.job?.seek).length;

// ---- 6. parked cars (their spots are gone), undo history (it describes buildings that no longer exist), audit
if (vehicles && Array.isArray(vehicles.cars)) vehicles.cars = [];
const undoLocked = dbs.db.prepare('UPDATE edits SET undoable = 0 WHERE world_id = ? AND undoable = 1').run(world.worldId).changes;
new Audit(dbs).log('world.rebuild', { actor: { id: null, login: 'wp4-rebuild' }, detail: { layout: 'lots', lots: plat.ids.length, buildings: world.buildings.length, people: people.length, homeless, version: world.version } });

// ---- 7. checks before anything is written over
const problems = P.reconcile();
if (problems.length) fail(`property checks failed: ${problems.slice(0, 3).map(p => p.message).join('; ')} (nothing written; the database copy is in ${BACKUP})`);
const lotsInUse = P.count();
store.save('world', world);
store.save('people', people);
if (vehicles) store.save('vehicles', vehicles);
dbs.close();

const report = { backup: BACKUP, worldId: world.worldId, version: world.version, grid: world.grid, lots: plat.ids.length, lotsInUse,
  buildings: world.buildings.length, vacantLots: vacantLots.length, people: people.length, reassigned: re.changed.length, movedJobs, homeless, jobless, undoLocked };
console.log(JSON.stringify(report, null, 1));
if (o.json) fs.writeFileSync(o.json, JSON.stringify(report, null, 1));
