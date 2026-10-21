// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.4 road edits on real requests (wp4-world-spec.md §3, §5.0): administrators build, change and remove roads beyond
// the city; members can't; a road inside the city, across a building or off the island is refused with the reason;
// undo and redo put roads back only where they still fit; every browser gets the new roads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';
import { RoadNetwork, pointAt } from '../shared/roads.js';
import { makeGrid } from '../shared/city.js';

const um = v => Math.round(Math.round(v * 100) * 1e4);   // whole micrometres (to the centimetre)
const P = (x, z, r = 0) => (r ? { x: um(x), z: um(z), r: um(r) } : { x: um(x), z: um(z) });

test('roads beyond the city: who may build them, what is refused, undo and redo', async () => {
  const dir = tempDir('mvw-roadedit-');
  const first = await startServer({ data: dir, population: 120 }); await first.stop();
  for (const tool of ['add-island', 'add-roads']) {
    const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' });
    const world = (await owner.get('/api/world')).json.world, g = makeGrid(world.grid);
    // A new road off the North road: square off it at its middle, 300 m out.
    const net = RoadNetwork.fromJSON(world.roads), G = net.geometry('isl-north'), q = pointAt(G, G.length * 0.55, {});
    const nx = -q.dz, nz = q.dx, road = { name: 'Orchard Lane', profile: 'country', pts: [P(q.x, q.z), P(q.x + nx * 300, q.z + nz * 300)] };
    const edit = (c, ops) => c.post('/api/edit', { ops });

    const no = await edit(alice, [{ op: 'road.set', road }]);
    assert.equal(no.status, 403, 'members do not build roads'); assert.equal(no.json.code, 'forbidden');

    const ok = await edit(owner, [{ op: 'road.set', road }]);
    assert.equal(ok.status, 200, ok.text);
    const id = ok.json.results[0].id;
    let w = (await owner.get('/api/world')).json.world;
    assert.ok(w.roads.some(r => r.id === id && r.name === 'Orchard Lane'), 'the road is in the world');
    assert.ok(RoadNetwork.fromJSON(w.roads).junctions().some(j => j.kind === 'T' && j.arms.some(a => a.id === id)), 'it meets the North road in a T');

    // Refused, with reasons in words.
    const inCity = await edit(owner, [{ op: 'road.set', road: { name: 'Shortcut', profile: 'country', pts: [P(g.X[0] + 20, g.Z[0] + 20), P(g.X[1] - 20, g.Z[1] - 20)] } }]);
    assert.equal(inCity.status, 400); assert.match(inCity.json.error, /inside the city/);
    const T = w.terrain, far = T.center.x + T.radius * 2;
    const offIsland = await edit(owner, [{ op: 'road.set', road: { name: 'Pier', profile: 'country', pts: [P(far, T.center.z), P(far + 200, T.center.z)] } }]);
    assert.equal(offIsland.status, 400); assert.match(offIsland.json.error, /off the island|deep|on land/);
    const overlap = await edit(owner, [{ op: 'road.set', road: { ...road, id: undefined, name: 'Twin Lane' } }]);
    assert.equal(overlap.status, 400, 'a road on top of another is refused');

    // Change it, undo the change, undo the build, redo.
    const moved = await edit(owner, [{ op: 'road.set', road: { ...road, id, name: 'Orchard Road' } }]);
    assert.equal(moved.status, 200, moved.text);
    assert.equal((await owner.post('/api/undo')).status, 200);
    w = (await owner.get('/api/world')).json.world;
    assert.equal(w.roads.find(r => r.id === id).name, 'Orchard Lane', 'undo brings the old name back');
    assert.equal((await owner.post('/api/undo')).status, 200);
    w = (await owner.get('/api/world')).json.world;
    assert.ok(!w.roads.some(r => r.id === id), 'undoing the build removes the road');
    assert.equal((await owner.post('/api/redo')).status, 200);
    w = (await owner.get('/api/world')).json.world;
    assert.ok(w.roads.some(r => r.id === id), 'redo builds it again');

    // Removing a road.
    const del = await edit(owner, [{ op: 'road.del', id }]);
    assert.equal(del.status, 200, del.text);
    w = (await owner.get('/api/world')).json.world;
    assert.ok(!w.roads.some(r => r.id === id));
    assert.equal((await edit(owner, [{ op: 'road.del', id: 'no-such-road' }])).status, 400);
  } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
