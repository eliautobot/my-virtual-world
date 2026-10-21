// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.15 coasts, the island chain and bridges (wp4-world-spec.md §3.3–3.4): a new island never changes the main one;
// slots keep clear of other islands and of protected waterfront and open-ocean views; administrators set coast classes
// and raise or remove islands (undo/redo); a bridge leaves the main island only from a growth coast and stands on piers
// over open water.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';
import { generateWorld } from '../server/world/generate.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { makeGrid } from '../shared/city.js';
import { islandSlots, newIsland } from '../shared/island-chain.js';
import { coastline, coastClasses, protectedWhy, sectorAt, SECTORS } from '../shared/coasts.js';
import { BRIDGE_DECK } from '../shared/island-roads.js';

const um = v => Math.round(Math.round(v * 100) * 1e4);
const P = (x, z) => ({ x: um(x), z: um(z) });

test('a new island leaves the main island as it was; slots respect other islands and protected coasts', () => {
  const w = generateWorld({ seed: 'wp4-chain', population: 0 }), g = makeGrid(w.grid);
  const T = defaultIsland({ seed: 'wp4-chain:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  const A = new Island(T), slots = islandSlots(T, 'harbour', { coastsWhy: (x, z, r) => protectedWhy(A, x, z, r) });
  const free = slots.filter(s => s.free);
  assert.ok(free.length >= 3, `free places: ${free.length}`);
  const I = newIsland(T, free[0], 'harbour', 'Test Harbour', 'abc123');
  const B = new Island({ ...T, islands: [I] });
  let diff = 0; for (let k = 0; k < 2000; k++) { const a = k * 2.399, r = T.radius * Math.sqrt((k % 997) / 997), x = T.center.x + Math.cos(a) * r, z = T.center.z + Math.sin(a) * r; diff = Math.max(diff, Math.abs(A.height(x, z) - B.height(x, z))); }
  assert.equal(diff, 0, 'the main island is untouched');
  assert.deepEqual(B.rivers.map(r => r.id), A.rivers.map(r => r.id)); assert.equal(B.lakes.length, A.lakes.length);
  assert.ok(B.height(I.center.x, I.center.z) > T.seaLevel + 2, 'the new island is land');
  assert.ok(A.height(I.center.x, I.center.z) < T.seaLevel - 20, 'where there was deep sea');
  // the next islands keep their distance
  const next = islandSlots({ ...T, islands: [I] }, 'harbour');
  assert.ok(!next.find(s => s.k === free[0].k).free, 'the same place is taken');
  // a protected waterfront facing a slot closes it (its corridor) — and an open-ocean frontage keeps its view
  const line = coastline(A), facing = sectorAt(T, free[1].center.x, free[1].center.z);
  let cls = coastClasses(T).split(''); cls[facing] = 'o'; cls = cls.join('');
  const C = new Island({ ...T, coasts: cls }), blocked = islandSlots({ ...T, coasts: cls }, 'harbour', { coastsWhy: (x, z, r) => protectedWhy(C, x, z, r) });
  assert.ok(!blocked.find(s => s.k === free[1].k).free, 'an open-ocean view keeps the sea in front of it open');
  assert.equal(line.length, SECTORS);
});

test('coasts, raising islands and bridges over the API', async () => {
  const dir = tempDir('mvw-chain-');
  const first = await startServer({ data: dir, population: 120 }); await first.stop();
  const r = spawnSync(process.execPath, ['tools/wp4/add-island.mjs', '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' });
    const edit = (c, ops) => c.post('/api/edit', { ops });
    let w = (await owner.get('/api/world')).json.world;
    const T = w.terrain, A = new Island(T), cls = coastClasses(T), k0 = cls.indexOf('g');
    assert.ok(k0 >= 0, 'a growth coast at the harbour by default');
    assert.equal((await edit(alice, [{ op: 'coast.set', k: 5, cls: 'w' }])).status, 403);
    assert.equal((await edit(owner, [{ op: 'coast.set', k: 5, cls: 'w' }])).status, 200);
    w = (await owner.get('/api/world')).json.world; assert.equal(w.terrain.coasts[5], 'w');
    // the island in the slot straight out from the growth coast
    const line = coastline(A), gp = line[k0 + 1] || line[k0];
    const slots = islandSlots(w.terrain, 'resort', { coastsWhy: (x, z, rr) => protectedWhy(new Island(w.terrain), x, z, rr) });
    const near = slots.filter(x => x.free).sort((a, b) => Math.hypot(a.center.x - gp.x, a.center.z - gp.z) - Math.hypot(b.center.x - gp.x, b.center.z - gp.z))[0];
    assert.equal((await edit(alice, [{ op: 'island.add', k: near.k, template: 'resort' }])).status, 403);
    const up = await edit(owner, [{ op: 'island.add', k: near.k, template: 'resort', name: 'Sunny Key', seed: 'sunnykey1' }]);
    assert.equal(up.status, 200, up.text);
    w = (await owner.get('/api/world')).json.world;
    const I = w.terrain.islands[0];
    assert.equal(I.name, 'Sunny Key');
    assert.equal((await owner.post('/api/undo')).status, 200);
    w = (await owner.get('/api/world')).json.world; assert.equal((w.terrain.islands || []).length, 0, 'undo takes it away');
    assert.equal((await owner.post('/api/redo')).status, 200);
    w = (await owner.get('/api/world')).json.world; assert.equal(w.terrain.islands.length, 1, 'redo raises it again');
    // A bridge from the growth coast to the new island: from just inland of the harbour shore to just inside its shore.
    const B = new Island(w.terrain), dx = I.center.x - gp.x, dz = I.center.z - gp.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    const start = { x: gp.x - ux * 60, z: gp.z - uz * 60 };
    let t = 0; while (t < L && B.landness(gp.x + ux * t, gp.z + uz * t) > 0) t += 5;   // off the main island
    while (t < L && B.landness(gp.x + ux * t, gp.z + uz * t) <= 0) t += 5;            // across the water
    const end = { x: gp.x + ux * (t + 60), z: gp.z + uz * (t + 60) };
    const bridge = { name: 'Sunny Key Bridge', profile: 'two-lane', pts: [P(start.x, start.z), P(end.x, end.z)] };
    const made = await edit(owner, [{ op: 'road.set', road: bridge }]);
    assert.equal(made.status, 200, made.text);
    w = (await owner.get('/api/world')).json.world;
    const Rw = new Island(w.terrain, { roads: w.roads }), Rr = new Island(w.terrain, { roads: w.roads, bridgesAsGround: false }), id = w.roads.at(-1).id;
    assert.ok(Rw.roads.spans.get(id)?.length, 'the road is a bridge over the deep water');
    const mid = { x: (gp.x + ux * t / 2), z: (gp.z + uz * t / 2) };
    assert.ok(Math.abs(Rw.height(mid.x, mid.z) - (T.seaLevel + BRIDGE_DECK)) < 0.6, `its deck stands above the sea (${Rw.height(mid.x, mid.z).toFixed(2)})`);
    assert.ok(Rr.height(mid.x, mid.z) < T.seaLevel - 5, 'and the drawn ground under it is the sea floor');
    // the island can't be taken away with a road on it; a bridge from an ordinary shore is refused
    const del = await edit(owner, [{ op: 'island.del', id: I.id }]);
    assert.equal(del.status, 400); assert.match(del.json.error, /road/);
    const other = line[(k0 + SECTORS / 2) % SECTORS], o2 = { x: other.x + (other.x - T.center.x) / T.radius * 400, z: other.z + (other.z - T.center.z) / T.radius * 400 };
    const bad = await edit(owner, [{ op: 'road.set', road: { name: 'Pier', profile: 'two-lane', pts: [P(other.x - (other.x - T.center.x) / T.radius * 80, other.z - (other.z - T.center.z) / T.radius * 80), P(o2.x, o2.z)] } }]);
    assert.equal(bad.status, 400); assert.match(bad.json.error, /growth coast|deep|edge/);
    assert.equal((await owner.get('/api/health')).json.errors, 0);
  } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the islands of the chain have coasts of their own: growth facing the main island, protected stretches kept clear', async () => {
  const { ISLE_SECTORS, isleCoastline, isleClasses, isleSectorAt, landOf, growthAt } = await import('../shared/coasts.js');
  const w = generateWorld({ seed: 'wp4-chain-coasts', population: 0 }), g = makeGrid(w.grid);
  const T = defaultIsland({ seed: 'wp4-chain-coasts:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  const free = islandSlots(T, 'harbour', { coastsWhy: (x, z, r) => protectedWhy(new Island(T), x, z, r) }).filter(s => s.free);
  const I = newIsland(T, free[0], 'harbour', 'Coast Isle', 'c0a57');
  const T2 = { ...T, islands: [I] }, A = new Island(T2), J = A._chain[0];
  const cls = isleClasses(J, T2), L = isleCoastline(J);
  assert.equal(cls.length, ISLE_SECTORS);
  assert.equal([...cls].filter(c => c === 'g').length, 5, 'a growth stretch by default');
  // the growth stretch faces the main island; the far side is public shore
  const near = L.reduce((b, p) => (Math.hypot(p.x - T.center.x, p.z - T.center.z) < Math.hypot(b.x - T.center.x, b.z - T.center.z) ? p : b));
  const far = L.reduce((b, p) => (Math.hypot(p.x - T.center.x, p.z - T.center.z) > Math.hypot(b.x - T.center.x, b.z - T.center.z) ? p : b));
  assert.equal(cls[isleSectorAt(J, near.x, near.z)], 'g'); assert.equal(cls[isleSectorAt(J, far.x, far.z)], 's');
  const inward = (p, d) => ({ x: p.x - p.nx * d, z: p.z - p.nz * d });
  const nl = inward(near, 6), fl = inward(far, 6);
  assert.equal(landOf(A, nl.x, nl.z, 0.3), J, 'the shore is the island\'s');
  assert.equal(growthAt(A, nl.x, nl.z), true); assert.equal(growthAt(A, fl.x, fl.z), false);
  // a protected stretch keeps the water in front of it clear
  const k = isleSectorAt(J, far.x, far.z), prot = cls.slice(0, k) + 'w' + cls.slice(k + 1);
  const B = new Island({ ...T, islands: [{ ...I, coasts: prot }] }), q = { x: far.x + far.nx * 60, z: far.z + far.nz * 60 };
  assert.equal(protectedWhy(A, q.x, q.z, 0), null);
  assert.match(protectedWhy(B, q.x, q.z, 0) || '', /protected waterfront/);
});

test('administrators set the classes of an island\'s coast; undo puts them back', async () => {
  const dir = tempDir('mvw-chaincoast-');
  const first = await startServer({ data: dir, population: 60 }); await first.stop();
  for (const tool of ['add-island', 'add-roads']) {
    const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const s = await startServer({ data: dir, population: 60 });
  try {
    const owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' });
    let w = (await owner.get('/api/world')).json.world;
    const slot = islandSlots(w.terrain, 'harbour', { coastsWhy: (x, z, r) => protectedWhy(new Island(w.terrain), x, z, r) }).find(x => x.free);
    const add = await owner.post('/api/edit', { ops: [{ op: 'island.add', k: slot.k, template: 'harbour', name: 'Gull Isle', seed: 'g1' }] });
    assert.equal(add.status, 200, add.text);
    w = (await owner.get('/api/world')).json.world;
    const id = w.terrain.islands[0].id;
    assert.equal((await alice.post('/api/edit', { ops: [{ op: 'coast.set', island: id, k: 3, cls: 'w' }] })).status, 403);
    const r = await owner.post('/api/edit', { ops: [{ op: 'coast.set', island: id, k: 3, cls: 'w' }] });
    assert.equal(r.status, 200, r.text);
    w = (await owner.get('/api/world')).json.world;
    assert.equal(w.terrain.islands[0].coasts[3], 'w');
    assert.equal((await owner.post('/api/edit', { ops: [{ op: 'coast.set', island: 'isl-99', k: 3, cls: 'w' }] })).status, 400);
    assert.equal((await owner.post('/api/undo')).status, 200);
    w = (await owner.get('/api/world')).json.world;
    assert.equal(w.terrain.islands[0].coasts[3], 's', 'back to public shore');
  } finally { await s.stop(); }
});
