#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Puts a world's city on the island (WP4.2, DECISIONS E25 (3)): writes world.terrain — the pinned generator, its seed and
// the city's flat rectangle — so the server and every browser generate the same ~8 km island around the city. Nothing
// else changes; the island is generated, never stored, so this is a small, reversible change (remove world.terrain).
// Run while the server that uses the data folder is stopped.
// Usage: node tools/wp4/add-island.mjs --data <data folder> --server-stopped [--seed <s>]
//        node tools/wp4/add-island.mjs --data <data folder> --server-stopped --upgrade   (same island, current generator)
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Store } from '../../server/store.js';
import { makeGrid } from '../../shared/city.js';
import { defaultIsland, Island, TERRAIN_GENERATOR } from '../../shared/terrain.js';

function fail(m) { console.error(`add-island: ${m}`); process.exit(1); }
let o;
try { ({ values: o } = parseArgs({ options: { data: { type: 'string' }, 'server-stopped': { type: 'boolean' }, seed: { type: 'string' }, upgrade: { type: 'boolean' } } })); } catch (e) { fail(e.message); }
if (!o.data || !o['server-stopped']) fail('usage: --data <folder> --server-stopped [--seed s] (stop the server first)');
const store = new Store(path.resolve(o.data)), world = store.load('world');
if (!world || world.format !== 1) fail('world.json is not a format-1 world');
const g = makeGrid(world.grid);
// --upgrade: keep the island's seed and parameters, move it to the current generator version (its ground changes as the
// generator's release notes say; roads re-grade to it automatically).
if (o.upgrade && !world.terrain) fail('the world has no island to upgrade');
// The natural plain sits 5 cm below the city's sidewalk-height apron (shared/constants GROUND_Y 0.15), so the two never coincide.
const terrain = o.upgrade ? { ...world.terrain, generator: TERRAIN_GENERATOR } : defaultIsland({ seed: o.seed || `${world.worldId || 'world'}:island`, city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
const island = new Island(terrain);
world.terrain = terrain;
// world.json is the only file this changes: a copy of it first, beside the data folder.
const DATA = path.resolve(o.data), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const BACKUP = `${DATA}.before-island-${stamp}`;
fs.mkdirSync(BACKUP, { recursive: true, mode: 0o700 });
fs.copyFileSync(path.join(DATA, 'world.json'), path.join(BACKUP, 'world.json'));
world.version = (world.version || 1) + 1;
store.save('world', world);
console.log(JSON.stringify({ backup: BACKUP, seed: terrain.seed, city: terrain.city, lakes: island.lakes.length, version: world.version }, null, 1));
