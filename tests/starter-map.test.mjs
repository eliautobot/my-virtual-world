// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The starting map (server/world/starter.js): a new installation opens with the city built for new installations - its
// buildings, roads, stations and world modules as built, its lots laid out with the same ids and held by the city, its
// homes filled to Homes filled (no residents travel with the map) - and tools/starter-map.mjs makes one from a running
// installation's data folder, without residents, accounts or owners. MVW_STARTER_MAP=off generates a city instead.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { startServer, ownerSession } from './helpers/server.mjs';
import { STARTER_FILE, starterWhy } from '../server/world/starter.js';

const map = JSON.parse(zlib.gunzipSync(fs.readFileSync(STARTER_FILE)).toString('utf8'));
let s, owner;
before(async () => { s = await startServer({ env: { MVW_STARTER_MAP: 'on', MVW_HOUSING: 'on' } }); owner = await ownerSession(s); });
after(async () => { await s?.stop(); });

test('the starting map in the repository is whole: every building on a lot stands on one of its lots; nothing personal travels', () => {
  assert.equal(starterWhy(map), null);
  assert.ok(map.world.buildings.filter(B => B && !B.gone).length >= 50, 'a city, not an empty map');
  assert.ok(map.lots.length >= 50);
  assert.equal(map.world.worldId, undefined, 'no world id');
  assert.equal(map.people, undefined, 'no residents');
  assert.ok(map.lots.every(l => !('holder' in l) && !('lifecycle' in l)), 'no owners: the city holds every lot');
});

test('a new installation opens with it: the same buildings and lots (held by the city), its own world id, its homes 30 % full', async () => {
  const W = (await owner.get('/api/world')).json.world;
  const built = B => B && !B.gone;
  assert.equal(W.buildings.filter(built).length, map.world.buildings.filter(built).length);
  assert.deepEqual(W.buildings.filter(built).map(B => [B.name, B.type, B.lot || null]), map.world.buildings.filter(built).map(B => [B.name, B.type, B.lot || null]));
  assert.equal(W.stations.length, map.world.stations.length);
  assert.equal((W.worldModules || []).length, (map.world.worldModules || []).length);
  const lots = (await owner.get('/api/property/lots')).json.lots.filter(l => l.lifecycle !== 'retired');
  assert.deepEqual(lots.map(l => l.id).sort(), map.lots.map(l => l.id).sort(), 'the same lot ids');
  assert.ok(lots.every(l => l.lifecycle === 'municipal' && l.holder?.kind === 'municipality'), 'held by the city');
  assert.deepEqual(Object.fromEntries(lots.map(l => [l.id, l.zoning])), Object.fromEntries(map.lots.map(l => [l.id, l.zoning])), 'zoned as built');
  const pop = (await owner.get('/api/population')).json;
  assert.ok(pop.beds > 0 && pop.pct === 30 && pop.residents === pop.target, JSON.stringify(pop));
});

test('tools/starter-map.mjs export makes a starting map from a data folder: the world and its live lots, no residents', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-starter-out-')), 'map.json.gz');
  const text = execFileSync(process.execPath, ['tools/starter-map.mjs', 'export', s.data, '--out', out, '--name', 'Test Town'], { encoding: 'utf8' });
  assert.match(text, /written .*"Test Town": \d+ buildings/);
  const b = JSON.parse(zlib.gunzipSync(fs.readFileSync(out)).toString('utf8'));
  assert.equal(starterWhy(b), null);
  assert.equal(b.world.name, 'Test Town');
  assert.equal(b.world.worldId, undefined); assert.equal(b.people, undefined);
  assert.deepEqual(b.lots.map(l => l.id).sort(), map.lots.map(l => l.id).sort());
  assert.match(execFileSync(process.execPath, ['tools/starter-map.mjs', 'info', out], { encoding: 'utf8' }), /108 lots|\d+ lots/);
});
