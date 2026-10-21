#!/usr/bin/env node
// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Widens a world's city streets to the city avenue (2026-10-03: four lanes and a 10 ft parking lane each side;
// shared/roads.js 'avenue-4'), so the city is drawn and run by the road kit like any other road (shared/city-roads.js
// cityRoadSet). Blocks keep their size and everything in them moves with its block: buildings, lots (in next.db, by
// whole micrometres - shapes, areas and titles unchanged), stations, street trees, saved player spots; the roads that
// leave the city move their ends to its new edge. The island itself is not regenerated: the city grows into the flat
// plain around it (the terrain's own city rectangle stays; terrain.cityStreets records the new one). Parked cars are
// cleared. Homes, jobs and interiors are untouched (they are by building and in each building's own frame).
//
// Run it only while the server that uses the data folder is STOPPED. A full copy of the folder is made first
// (<data>.before-widen-<time>); to undo, stop the server and put that copy back. The next start takes the changed
// world.json in (the world store, server/world/world-db.js).
// Usage: node tools/wp4/widen-streets.mjs --data <data folder> --server-stopped [--json <report>]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { makeGrid, blockAt } from '../../shared/city.js';
import { DEFAULT_ROAD_PROFILES } from '../../shared/roads.js';

function fail(msg) { console.error(`widen-streets: ${msg}`); process.exit(1); }
let o;
try { ({ values: o } = parseArgs({ options: { data: { type: 'string' }, 'server-stopped': { type: 'boolean' }, json: { type: 'string' } } })); } catch (e) { fail(e.message); }
if (!o.data) fail('usage: --data <data folder> --server-stopped');
if (!o['server-stopped']) fail('stop the server that uses this data folder first, then pass --server-stopped');
const DATA = path.resolve(o.data);
for (const f of ['world.json', 'next.db']) if (!fs.existsSync(path.join(DATA, f))) fail(`${f} not found in ${DATA}`);
const world = JSON.parse(fs.readFileSync(path.join(DATA, 'world.json'), 'utf8'));
const road = 2 * DEFAULT_ROAD_PROFILES['avenue-4'].carriageHalf / 1e6;
if (Math.abs(world.grid.road - road) < 0.01) fail('the streets are already the city avenue');

// ---- 1. a full copy of the data folder first
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const BACKUP = `${DATA}.before-widen-${stamp}`;
fs.cpSync(DATA, BACKUP, { recursive: true });

// ---- 2. where everything goes: a block's contents move with the block; a street's with its street; past the edge, out
const g = makeGrid(world.grid), grid2 = { ...world.grid, road }, g2 = makeGrid(grid2);
const blockShift = bi => { const i = bi % g.nx, j = Math.floor(bi / g.nx); return { dx: (g2.X[i] + g2.X[i + 1] - g.X[i] - g.X[i + 1]) / 2, dz: (g2.Z[j] + g2.Z[j + 1] - g.Z[j] - g.Z[j + 1]) / 2 }; };
function axis(v, A, A2, half, n, lo, hi, lo2, hi2) {
  if (v < lo) return v + (lo2 - lo);
  if (v > hi) return v + (hi2 - hi);
  const k = Math.round((v - A[0]) / (A[1] - A[0]));
  if (Math.abs(v - A[k]) <= half) return A2[k] + (v - A[k]);   // on a street
  const b = Math.min(n - 1, Math.max(0, Math.floor((v - A[0]) / (A[1] - A[0]))));
  return v - (A[b] + A[b + 1]) / 2 + (A2[b] + A2[b + 1]) / 2;   // in a block
}
const mapP = (x, z) => ({ x: axis(x, g.X, g2.X, g.hr, g.nx, g.minX, g.maxX, g2.minX, g2.maxX), z: axis(z, g.Z, g2.Z, g.hr, g.nz, g.minZ, g.maxZ, g2.minZ, g2.maxZ) });
const inOld = (x, z, pad = 0) => x >= g.minX - pad && x <= g.maxX + pad && z >= g.minZ - pad && z <= g.maxZ + pad;
const r2 = v => Math.round(v * 100) / 100;
const report = { road: { from: world.grid.road, to: road }, buildings: 0, stations: 0, trees: 0, decorations: 0, roadEnds: 0, lots: 0, players: 0, warnings: [] };

// ---- 3. the world
for (const B of world.buildings) {
  if (!B || B.base !== undefined || !Number.isInteger(B.block)) continue;   // beyond the city: stays
  const d = blockShift(B.block); B.x = r2(B.x + d.dx); B.z = r2(B.z + d.dz); report.buildings++;
}
for (const s of world.stations || []) {
  if (!Number.isInteger(s.block)) continue;
  const d = blockShift(s.block); s.x = r2(s.x + d.dx); s.z = r2(s.z + d.dz);
  for (const k of ['entry', 'band']) if (s[k]) { s[k].x = r2(s[k].x + d.dx); s[k].z = r2(s[k].z + d.dz); }
  report.stations++;
}
if (Array.isArray(world.trees)) for (const t of world.trees) { if (!inOld(t[0], t[1])) continue; const b = blockAt(g, t[0], t[1]), d = b ? blockShift(b.bi) : null, p = d ? { x: t[0] + d.dx, z: t[1] + d.dz } : mapP(t[0], t[1]); t[0] = r2(p.x); t[1] = r2(p.z); report.trees++; }
for (const d of world.decorations || []) { if (!inOld(d.x, d.z)) continue; const p = mapP(d.x, d.z); d.x = r2(p.x); d.z = r2(p.z); report.decorations++; }
// a road that started at the city's edge now ends on the edge street's centre line, in the city's junction there
const toEdgeStreet = (v, lo, hi, A2) => (Math.abs(v - lo) < 1.5 ? A2[0] : Math.abs(v - hi) < 1.5 ? A2.at(-1) : null);
for (const r of world.roads || []) for (const p of r.pts) {
  const x = p.x / 1e6, z = p.z / 1e6;
  if (!inOld(x, z, 1.5)) continue;
  const q = mapP(x, z), ex = toEdgeStreet(x, g.minX, g.maxX, g2.X), ez = toEdgeStreet(z, g.minZ, g.maxZ, g2.Z);
  if (ex !== null) q.x = ex; if (ez !== null) q.z = ez;
  p.x = Math.round(q.x * 1e6); p.z = Math.round(q.z * 1e6); report.roadEnds++;
}
world.grid = grid2;
if (world.terrain) world.terrain = { ...world.terrain, cityStreets: { x0: g2.minX, z0: g2.minZ, x1: g2.maxX, z1: g2.maxZ } };
world.version = (world.version || 1) + 1;
// nothing beyond the city may now stand inside it
for (const r of world.roads || []) r.pts.forEach((p, k) => { const x = p.x / 1e6, z = p.z / 1e6; if (k > 0 && k < r.pts.length - 1 && x > g2.minX + 0.5 && x < g2.maxX - 0.5 && z > g2.minZ + 0.5 && z < g2.maxZ - 0.5) report.warnings.push(`${r.name || r.id}: point ${k} is now inside the city`); });
for (const B of world.buildings) if (B && !B.gone && B.base !== undefined && B.x > g2.minX && B.x < g2.maxX && B.z > g2.minZ && B.z < g2.maxZ) report.warnings.push(`${B.name} (beyond the city) is now inside it`);

// ---- 4. next.db: lots by whole micrometres (their blocks' shifts), saved player spots
const db = new DatabaseSync(path.join(DATA, 'next.db'));
db.exec('BEGIN IMMEDIATE');
try {
  const wid = db.prepare("SELECT value FROM meta WHERE key = 'world_id'").get().value;
  const up = db.prepare('UPDATE lots SET poly_json = ?, x0 = ?, z0 = ?, x1 = ?, z1 = ? WHERE id = ?');
  for (const L of db.prepare('SELECT id, block, poly_json, x0, z0, x1, z1 FROM lots WHERE world_id = ? AND block IS NOT NULL').all(wid)) {
    const d = blockShift(L.block), dx = Math.round(d.dx * 1e6), dz = Math.round(d.dz * 1e6);
    const poly = JSON.parse(L.poly_json).map(p => ({ x: p.x + dx, z: p.z + dz }));
    up.run(JSON.stringify(poly), L.x0 + dx, L.z0 + dz, L.x1 + dx, L.z1 + dz, L.id); report.lots++;
  }
  for (const L of db.prepare('SELECT id, x0, z0, x1, z1 FROM lots WHERE world_id = ? AND block IS NULL AND retired IS NULL').all(wid)) {
    if (L.x1 / 1e6 > g2.minX && L.x0 / 1e6 < g2.maxX && L.z1 / 1e6 > g2.minZ && L.z0 / 1e6 < g2.maxZ) report.warnings.push(`lot ${L.id} (beyond the city) now reaches into it`);
  }
  const pu = db.prepare('UPDATE players SET x = ?, z = ? WHERE world_id = ? AND account_id = ?');
  for (const P of db.prepare('SELECT account_id, x, z FROM players WHERE world_id = ?').all(wid)) { if (!inOld(P.x, P.z)) continue; const q = mapP(P.x, P.z); pu.run(q.x, q.z, wid, P.account_id); report.players++; }
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); db.close(); fail(`next.db: ${e.message} (nothing changed; the copy is in ${BACKUP})`); }
db.close();

// ---- 5. the files (the next start takes world.json into the store); parked cars belong to the old layout
fs.writeFileSync(path.join(DATA, 'world.json'), JSON.stringify(world));
const vf = path.join(DATA, 'vehicles.json');
if (fs.existsSync(vf)) { const v = JSON.parse(fs.readFileSync(vf, 'utf8')); fs.writeFileSync(vf, JSON.stringify({ ...v, cars: [] })); }
report.backup = BACKUP;
console.log(`widen-streets: streets ${report.road.from} m → ${report.road.to.toFixed(4)} m; moved ${report.buildings} buildings, ${report.lots} lots, ${report.stations} stations, ${report.trees} trees, ${report.decorations} decorations, ${report.roadEnds} road ends, ${report.players} player spots${report.warnings.length ? `; ${report.warnings.length} warnings` : ''}. Copy of the data before: ${BACKUP}`);
for (const w of report.warnings) console.log(`  warning: ${w}`);
if (o.json) fs.writeFileSync(o.json, JSON.stringify(report, null, 2));
