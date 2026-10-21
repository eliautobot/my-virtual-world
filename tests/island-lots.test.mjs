// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.14 lots along roads beyond the city and WP4.6 building on them, on real requests (wp4-world-spec.md §5.0, §5.5,
// §9): administrators plat standard lots beside a road and retire unused ones; members can't; a building on an island
// lot faces its road on a level pad; newcomers arrive and the simulation keeps running without errors; undo and redo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';
import { RoadNetwork, pointAt } from '../shared/roads.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('island lots: platting, building on one, residents, undo and redo, retiring', async () => {
  const dir = tempDir('mvw-islandlots-');
  const first = await startServer({ data: dir, population: 150 }); await first.stop();
  for (const tool of ['add-island', 'add-roads']) {
    const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const s = await startServer({ data: dir, population: 150 });
  try {
    const owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' });
    const no = await alice.post('/api/property/plat-road', { road: 'isl-east' });
    assert.equal(no.status, 403, 'members do not plat lots');
    const r = await owner.post('/api/property/plat-road', { road: 'isl-east', side: 'both', zoning: 'residential' });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.ids.length > 40, `lots made: ${r.json.ids.length}`);
    const again = await owner.post('/api/property/plat-road', { road: 'isl-east', side: 'both' });
    assert.equal(again.status, 400, 'nothing new fits a second time'); assert.ok(again.json.skipped.lot > 40);
    assert.equal((await owner.post('/api/property/plat-road', { road: 'no-such-road' })).status, 404);
    // a set number of lots at a chosen place (the Lots tool): on a road not yet platted
    const roads = (await owner.get('/api/world')).json.world.roads.filter(rd => rd.id !== 'isl-east');
    let few = null;
    for (const rd of roads) {
      for (const from of [40, 160, 320, 520]) {
        const t = await owner.post('/api/property/plat-road', { road: rd.id, side: 'a', from, to: from + 3 * 30.48 * 1.6 + 12, count: 3, widthFt: 100, depthFt: 100, zoning: 'commercial' });
        if (t.status === 200) { few = t.json; break; }
      }
      if (few) break;
    }
    assert.ok(few, 'a few lots fit somewhere');
    assert.ok(few.ids.length >= 1 && few.ids.length <= 3, `at most the count: ${few.ids.length}`);
    // a road with lots fronting it stays (they would be left without it): removing it is refused and says why
    const del = await owner.post('/api/edit', { ops: [{ op: 'road.del', id: 'isl-east' }] });
    assert.notEqual(del.status, 200, 'a road its lots front is not removed');
    assert.match(del.json.error || '', /lots front it/);

    const lots = (await owner.get('/api/property/lots')).json.lots, mine = lots.filter(l => r.json.ids.includes(l.id));
    assert.equal(mine.length, r.json.ids.length, 'every new lot is on the map');
    assert.ok(mine.every(l => l.holder?.kind === 'municipality' && l.zoning === 'residential'));

    // An apartment house on one of them, facing the road.
    const world = (await owner.get('/api/world')).json.world, net = RoadNetwork.fromJSON(world.roads), G = net.geometry('isl-east');
    const half = net.profiles[net.get('isl-east').profile].outerHalf / 1e6;
    const detail = id => owner.get(`/api/property/lot/${id}`);
    let built = null, lotId = null;
    for (const l of mine.slice(5, 60)) {
      const f = (await detail(l.id)).json.lot?.frontage?.[0];
      if (!f) continue;
      const q = pointAt(G, (f.s0 + f.s1) / 2, {}), sign = f.side === 'a' ? 1 : -1, nx = -q.dz * sign, nz = q.dx * sign, rr = half + 2.5 + 9;
      const spec = { type: 'apartment', w: 16, d: 18, floors: 3, style: 'stucco', x: q.x + nx * rr, z: q.z + nz * rr, rot: Math.atan2(-nx, -nz) * 180 / Math.PI, name: 'Hillside Flats' };
      const res = await owner.post('/api/edit', { ops: [{ op: 'bld.add', spec }] });
      if (res.status === 200) { built = res.json.results[0]; lotId = l.id; break; }
      assert.match(res.json.error, /ground|road|water|lot/, res.text);
    }
    assert.ok(built, 'an apartment house goes up on an island lot');
    // the Lots tool's lots front their road (on the map too), and a building on one must face it (shared/door-access.js)
    const mapLot = (await owner.get('/api/property/lots')).json.lots.find(l => l.id === lotId);
    assert.equal(mapLot.frontage?.[0]?.road, 'isl-east', 'the map knows which road a lot fronts');
    let turned = null;
    for (const l of mine.slice(60, 120)) {
      const f = (await detail(l.id)).json.lot?.frontage?.[0];
      if (!f) continue;
      const q = pointAt(G, (f.s0 + f.s1) / 2, {}), sign = f.side === 'a' ? 1 : -1, nx = -q.dz * sign, nz = q.dx * sign, rr = half + 2.5 + 9;
      const spec = { type: 'office', w: 14, d: 18, floors: 2, style: 'modern', x: q.x + nx * rr, z: q.z + nz * rr, rot: (Math.atan2(-nx, -nz) * 180 / Math.PI + 180) % 360 };
      const res = await owner.post('/api/edit', { ops: [{ op: 'bld.add', spec }] });
      assert.notEqual(res.status, 200, 'a building turned away from its road is never built');
      if (/door faces away from the road/.test(res.json.error || '')) { turned = res.json.error; break; }
    }
    assert.ok(turned, 'turned away from its road: refused, and told why');
    let w = (await owner.get('/api/world')).json.world;
    const B = w.buildings[built.b];
    assert.equal(B.lot, lotId); assert.ok(Number.isFinite(B.base), 'it stands on a pad'); assert.equal(B.name, 'Hillside Flats');
    const other = mine.find(l => l.id !== lotId);
    const denied = await alice.post('/api/edit', { ops: [{ op: 'bld.add', spec: { type: 'office', w: 12, d: 12, floors: 2, x: 0, z: 0 } }] });
    assert.equal(denied.status, 403, 'members do not build on city land');

    // Its flats count among the city's homes; no one arrives at once (the residents follow the homes by themselves,
    // server/sim/housing.js — off in tests, tests/unit/housing.test.mjs); the simulation runs on without errors.
    const pop = (await owner.get('/api/population')).json;
    assert.ok(pop.beds > 0 && pop.target >= 0, `its homes counted: ${JSON.stringify(pop)}`);
    const before = (await owner.get('/api/people')).json.people.length;
    assert.ok(before <= 152, `no newcomers at once: ${before}`);
    await sleep(1500);
    const h = (await owner.get('/api/health')).json;
    assert.equal(h.errors, 0, `no simulation errors: ${JSON.stringify(h.lastErrors || '')}`);

    // Undo takes it down, redo puts it back on its lot.
    assert.equal((await owner.post('/api/undo')).status, 200);
    w = (await owner.get('/api/world')).json.world; assert.ok(w.buildings[built.b].gone, 'undo removes it');
    assert.equal((await owner.post('/api/redo')).status, 200);
    w = (await owner.get('/api/world')).json.world; assert.ok(!w.buildings[built.b].gone, 'redo brings it back');

    // Retiring: unused city land only.
    assert.equal((await alice.post('/api/property/retire', { ids: [other.id] })).status, 403);
    const busy = await owner.post('/api/property/retire', { ids: [lotId] });
    assert.equal(busy.status, 409, 'a lot with a building is not retired'); assert.equal(busy.json.code, 'in_use');
    const gone = await owner.post('/api/property/retire', { ids: [other.id], reason: 'Platted by mistake' });
    assert.equal(gone.status, 200, gone.text);
    assert.ok(!(await owner.get('/api/property/lots')).json.lots.some(l => l.id === other.id), 'a retired lot leaves the map');
    void other;
  } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
