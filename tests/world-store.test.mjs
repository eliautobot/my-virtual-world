// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.1 the world store: the world and its residents live in next.db; an edit writes only the rows it changed, in the
// same transaction as its journal entry; a hard crash right after an edit loses nothing; world.json and people.json are
// exports, and one replaced by something else (a restore, an older release, a hand edit) is taken in at the next start.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db.js';
import { WorldDb } from '../server/world/world-db.js';
import { generateWorld } from '../server/world/generate.js';
import { startServer, ownerSession, httpClient, tempDir } from '../tools/lib/testserver.mjs';

const plain = o => JSON.parse(JSON.stringify(o));

test('rows: a round trip, only what changed is written, sweeps find unnamed changes, rollbacks resync', () => {
  const dir = tempDir('mvw-wdb-');
  try {
    const dbs = openDb(dir), wdb = new WorldDb(dbs);
    const world = generateWorld({ seed: 'wp4-store', population: 0 }), people = [{ name: 'Ada', home: null }, { name: 'Bo', home: null }];
    assert.equal(wdb.has('world'), false);
    wdb.replace(world, people);
    assert.ok(wdb.has('world') && wdb.has('people'));
    const w2 = new WorldDb(dbs);
    assert.deepEqual(w2.loadWorld(), plain(world), 'the world comes back as it went in');
    assert.deepEqual(w2.loadPeople(), plain(people));

    assert.equal(wdb.flush(world, people), 0, 'nothing changed, nothing written');
    world.buildings[3].name = 'Renamed House';
    world.version++;
    wdb.mark({ buildings: [3] });
    assert.equal(wdb.flush(world, people), 2, 'the building and the version');
    world.levels[5].items.push({ id: 999, t: 'plant', x: 0, z: 0, r: 0 });
    people[1].name = 'Bea';
    wdb.sweep();
    assert.equal(wdb.flush(world, people), 2, 'a sweep finds the unnamed level and resident');
    people.push({ name: 'Cy', home: null });
    wdb.mark({});
    wdb.sweep({ world: false });
    assert.equal(wdb.flush(world, people), 1, 'a newcomer');
    people.length = 2;
    wdb.sweep();
    assert.equal(wdb.flush(world, people), 1, 'a shorter list drops rows');
    assert.deepEqual(new WorldDb(dbs).loadPeople(), plain(people));

    // an edit whose transaction rolls back: nothing reaches the database, and the next sweep writes it
    world.buildings[4].name = 'Lost Then Found';
    assert.throws(() => dbs.tx(() => { wdb.mark({ buildings: [4] }); wdb.flush(world, people); throw new Error('boom'); }), /boom/);
    assert.notEqual(new WorldDb(dbs).loadWorld().buildings[4].name, 'Lost Then Found');
    assert.ok(wdb.pending(), 'resynced: everything is compared next time');
    wdb.flush(world, people);
    assert.equal(new WorldDb(dbs).loadWorld().buildings[4].name, 'Lost Then Found');

    // a failing savepoint inside a transaction undoes only its own writes
    dbs.tx(() => {
      world.buildings[5].name = 'Kept'; wdb.mark({ buildings: [5] }); wdb.flush(world, people);
      try { dbs.tx(() => { dbs.db.prepare("INSERT INTO meta (key, value) VALUES ('wp4-test', 'x')").run(); throw new Error('inner'); }); } catch { /* expected */ }
    });
    assert.equal(new WorldDb(dbs).loadWorld().buildings[5].name, 'Kept');
    assert.equal(dbs.db.prepare("SELECT COUNT(*) AS n FROM meta WHERE key = 'wp4-test'").get().n, 0);

    // export hashes: the last 20 are known
    for (let k = 0; k < 25; k++) wdb.rememberFile('world', `h${k}`);
    assert.ok(wdb.knownFile('world', 'h24') && wdb.knownFile('world', 'h5'));
    assert.ok(!wdb.knownFile('world', 'h4') && !wdb.knownFile('world', null));
    dbs.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the server: an edit commits with its journal entry; a hard crash loses nothing; replaced exports are taken in', async () => {
  let s = await startServer({ population: 60 });
  const dir = s.data, key = s.keyFile;
  try {
    const owner = await ownerSession(s);
    const w = (await owner.get('/api/world')).json.world, B = w.buildings.find(b => b && !b.gone && b.type === 'apartment');
    const times = [];
    for (let k = 0; k < 12; k++) {
      const t0 = performance.now();
      const r = await owner.post('/api/edit', { ops: [{ op: 'bld.set', b: B.idx, name: `Store Test ${k}` }] });
      times.push(performance.now() - t0);
      assert.equal(r.status, 200, r.text);
    }
    // committed: the row and the journal entry are in next.db now (no save timer involved)
    const raw = new DatabaseSync(path.join(dir, 'next.db'), { readOnly: true });
    const row = JSON.parse(raw.prepare("SELECT json FROM world_rows WHERE kind = 'building' AND id = ?").get(B.idx).json);
    const edit = raw.prepare('SELECT summary FROM edits ORDER BY id DESC LIMIT 1').get();
    raw.close();
    assert.equal(row.name, 'Store Test 11');
    assert.match(edit.summary, /Store Test 11/);
    const h = (await owner.get('/api/health')).json;
    assert.ok(h.store && h.store.commits >= 12, JSON.stringify(h.store));
    assert.ok(h.store.commitP95Ms < 50, `edit commit p95 ${h.store.commitP95Ms} ms (round trips ${times.map(t => t.toFixed(0)).join(' ')})`);

    // a hard crash right after an edit (no save on stop): the edit is there after the restart
    assert.equal((await owner.post('/api/edit', { ops: [{ op: 'bld.set', b: B.idx, name: 'After The Crash' }] })).status, 200);
    process.kill(s.pid, 'SIGKILL');
    await s.stop({ keepData: true });
    s = await startServer({ data: dir });
    let c = httpClient(s.url);
    await c.signIn('owner', owner.password);
    assert.equal((await c.get('/api/world')).json.world.buildings[B.idx].name, 'After The Crash');
    assert.equal((await c.post('/api/undo')).status, 200, 'its journal entry survived too');
    assert.equal((await c.get('/api/world')).json.world.buildings[B.idx].name, 'Store Test 11');
    await s.stop({ keepData: true });

    // the exports are current after a clean stop; one replaced by hand is taken in
    const file = path.join(dir, 'world.json'), wf = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(wf.buildings[B.idx].name, 'Store Test 11');
    wf.buildings[B.idx].name = 'Edited By Hand';
    fs.writeFileSync(file, JSON.stringify(wf));
    s = await startServer({ data: dir });
    c = httpClient(s.url); await c.signIn('owner', owner.password);
    assert.equal((await c.get('/api/world')).json.world.buildings[B.idx].name, 'Edited By Hand');
    assert.match(s.log(), /world\.json was replaced: taking it in/);
    await s.stop({ keepData: true });

    // an unreadable export never replaces the stored world
    fs.writeFileSync(file, '{"format":1,"build');
    s = await startServer({ data: dir });
    c = httpClient(s.url); await c.signIn('owner', owner.password);
    assert.equal((await c.get('/api/world')).json.world.buildings[B.idx].name, 'Edited By Hand');
    assert.match(s.log(), /world\.json cannot be read: keeping the stored world/);
    await s.stop({ keepData: true });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).buildings[B.idx].name, 'Edited By Hand', 'the stop wrote a good export again');
  } finally {
    await s.stop().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(key, { force: true });
  }
});
