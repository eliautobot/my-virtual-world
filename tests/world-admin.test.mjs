// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.10 world management on real requests: administrators download a backup (lots listed, never restored), restore it
// (the current world backed up first; the server restarts with the restored world; lots and titles untouched), reset
// the residents (agents' residents stay); members can't.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, ownerSession, userSession, tempDir, httpClient } from '../tools/lib/testserver.mjs';
import { backupWhy, freshPopulation, BACKUP_FORMAT } from '../server/world-admin-routes.js';
import { generateWorld } from '../server/world/generate.js';
import { generatePopulation } from '../server/sim/population.js';
import { WorldIndex } from '../server/sim/windex.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('backups: format checks; resetting residents keeps the agents', () => {
  assert.match(backupWhy({}, 'w') || '', /not a world backup/);
  assert.match(backupWhy({ format: BACKUP_FORMAT, version: 1, world: { format: 1, buildings: [], levels: [], grid: {}, worldId: 'other' }, people: [] }, 'w') || '', /another world/);
  assert.equal(backupWhy({ format: BACKUP_FORMAT, version: 1, world: { format: 1, buildings: [], levels: [], grid: {}, worldId: 'w' }, people: [] }, 'w'), null);
  const w = generateWorld({ seed: 'wp4-reset', population: 300 });
  const people = generatePopulation(w, new WorldIndex(w), { population: 300, roster: [{ agentId: 'a1', name: 'Agent One', emoji: '🤖', role: 'Tester' }] });
  const fresh = freshPopulation(w, people, { population: 250 });
  assert.equal(fresh.length, 250);
  assert.ok(fresh.some(p => p.agentId === 'a1'), "the agent's resident stays");
  assert.equal(new Set(fresh.map(p => p.id)).size, fresh.length, 'ids stay unique');
  assert.ok(fresh.filter(p => !p.retired && p.home).length > 200, 'people have homes');
});

test('download, restore and reset over the API', async () => {
  const dir = tempDir('mvw-worldadmin-');
  let s = await startServer({ data: dir, population: 150 });
  try {
    const owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' });
    assert.equal((await alice.get('/api/world/backup')).status, 403, 'members do not download the world');
    const bk = await owner.get('/api/world/backup');
    assert.equal(bk.status, 200); assert.match(bk.headers.get('content-disposition') || '', /attachment/);
    const b = bk.json;
    assert.equal(b.format, BACKUP_FORMAT); assert.ok(b.world.buildings.length > 10 && b.people.length >= 150);
    // change the world, then restore the backup
    const name0 = b.world.buildings.find(x => x && !x.gone && x.type === 'office');
    assert.equal((await owner.post('/api/edit', { ops: [{ op: 'bld.set', b: name0.idx, name: 'Changed Tower' }] })).status, 200);
    assert.equal((await alice.post('/api/world/restore', b)).status, 403);
    const r = await owner.post('/api/world/restore', b);
    assert.equal(r.status, 200, r.text); assert.ok(r.json.restarting);
    assert.ok(fs.existsSync(path.join(dir, r.json.backup, 'world.json')), 'the world before is kept');
    await sleep(1500);
    const ex = await s.stop();
    assert.ok(!ex || ex.code === 75 || ex.code === undefined || ex.code === 0, `exit ${JSON.stringify(ex)}`);
    s = await startServer({ data: dir, population: 150 });
    const o2 = httpClient(s.url); await o2.signIn('owner', owner.password);
    const w = (await o2.get('/api/world')).json.world;
    assert.equal(w.buildings[name0.idx].name, name0.name, 'the restored world is back');
    // reset the residents
    const rr = await o2.post('/api/world/reset-population', { population: 120 });
    assert.equal(rr.status, 200, rr.text); assert.equal(rr.json.people, 120);
    await sleep(1500); await s.stop();
    s = await startServer({ data: dir, population: 150 });
    const o3 = httpClient(s.url); await o3.signIn('owner', owner.password);
    assert.equal((await o3.get('/api/people')).json.people.length, 120, 'the new residents');
  } finally { await s.stop().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }); }
});
