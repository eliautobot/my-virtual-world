#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Lays the island's roads (WP4.3/4.5): city exits, the Island Loop and roads to the lakes, generated once for the world's
// island and stored as alignment records in world.roads (the same records an administrator's road tools edit). The
// terrain is graded to them from then on. Run while the server that uses the data folder is stopped.
// Usage: node tools/wp4/add-roads.mjs --data <data folder> --server-stopped [--replace]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Store } from '../../server/store.js';
import { Island } from '../../shared/terrain.js';
import { generateIslandRoads } from '../../shared/island-roads.js';

function fail(m) { console.error(`add-roads: ${m}`); process.exit(1); }
let o;
try { ({ values: o } = parseArgs({ options: { data: { type: 'string' }, 'server-stopped': { type: 'boolean' }, replace: { type: 'boolean' } } })); } catch (e) { fail(e.message); }
if (!o.data || !o['server-stopped']) fail('usage: --data <folder> --server-stopped [--replace]');
const store = new Store(path.resolve(o.data)), world = store.load('world');
if (!world?.terrain) fail('the world has no island yet (tools/wp4/add-island.mjs)');
if (world.roads?.length && !o.replace) fail(`the world already has ${world.roads.length} island roads (--replace to generate them again)`);
const roads = generateIslandRoads(new Island(world.terrain), world.grid);
world.roads = roads;
// world.json is the only file this changes: a copy of it first, beside the data folder.
const DATA = path.resolve(o.data), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const BACKUP = `${DATA}.before-roads-${stamp}`;
fs.mkdirSync(BACKUP, { recursive: true, mode: 0o700 });
fs.copyFileSync(path.join(DATA, 'world.json'), path.join(BACKUP, 'world.json'));
world.version = (world.version || 1) + 1;
store.save('world', world);
console.log(JSON.stringify({ backup: BACKUP, roads: roads.map(r => r.id), version: world.version }, null, 1));
