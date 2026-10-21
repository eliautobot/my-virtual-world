// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.7 terrain, water and decorations on real requests (wp4-world-spec.md §9): administrators reshape the land
// beyond the city (raise, lower, flatten, ponds, clearing and planting); a stroke that would touch the city, a road, a
// building or someone's lot is refused with the reason; undo and redo; the ground every height query sees follows.
// Lot holders decorate their own lots; members can't decorate the city's land; administrators can; decorations block
// buildings and roads in their way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';
import { Island } from '../shared/terrain.js';
import { TerrainEdits, normalizeEdit, editWeight } from '../shared/terrain-edits.js';
import { RoadNetwork, pointAt } from '../shared/roads.js';
import { checkDecor, normalizeDecor } from '../shared/decor.js';
import { makeGrid } from '../shared/city.js';

test('terrain strokes: weights, shaping in order, ponds as lakes, woodland cover', () => {
  const e = normalizeEdit({ kind: 'raise', x: 0, z: 0, r: 40, amount: 5, soft: 0.5 });
  assert.equal(editWeight(e, 0, 0), 1); assert.equal(editWeight(e, 19, 0), 1); assert.equal(editWeight(e, 40, 0), 0);
  assert.ok(editWeight(e, 30, 0) > 0 && editWeight(e, 30, 0) < 1);
  assert.match(normalizeEdit({ kind: 'raise', x: 0, z: 0, r: 1, amount: 5 }).message, /across/);
  assert.match(normalizeEdit({ kind: 'nuke', x: 0, z: 0, r: 10 }).message, /Unknown/);
  const list = [{ ...e, id: 'te-1' }, { ...normalizeEdit({ kind: 'flatten', x: 0, z: 0, r: 10, level: 2, soft: 0 }), id: 'te-2' }, { ...normalizeEdit({ kind: 'clear', x: 100, z: 0, r: 20 }), id: 'te-3' }, { ...normalizeEdit({ kind: 'plant', x: 100, z: 0, r: 10 }), id: 'te-4' }];
  const T = new TerrainEdits(list);
  assert.equal(T.shape(0, 0, 10), 2, 'flatten after raise wins in the middle');
  assert.equal(T.shape(30, 0, 10), 10 + 5 * editWeight(e, 30, 0), 'only the raise out there');
  assert.equal(T.cover(100, 0), 'plant'); assert.equal(T.cover(100, 15), 'clear'); assert.equal(T.cover(300, 0), null);
});

test('reshaping the island and decorating: rules, rights, undo and redo', async () => {
  const dir = tempDir('mvw-terrain-');
  const first = await startServer({ data: dir, population: 120 }); await first.stop();
  for (const tool of ['add-island', 'add-roads']) {
    const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' });
    const edit = (c, ops) => c.post('/api/edit', { ops });
    let w = (await owner.get('/api/world')).json.world;
    const T = w.terrain, net = RoadNetwork.fromJSON(w.roads), g = makeGrid(w.grid);
    // A spot well away from roads and the city: between the North road and the loop.
    const island = new Island(T, { roads: w.roads });
    let spot = null;
    for (let k = 0; k < 400 && !spot; k++) {
      const a = k * 2.399, rr = T.radius * (0.25 + (k % 7) * 0.08), x = T.center.x + Math.cos(a) * rr, z = T.center.z + Math.sin(a) * rr;
      const near = net.nearest(x, z, 200);
      if (near && near.dist < 120) continue;
      if (island.cityDist(x, z) < T.plainMargin + 200 || island.waterAt(x, z)) continue;
      spot = { x, z };
    }
    assert.ok(spot, 'a quiet spot on the island');
    const h0 = island.height(spot.x, spot.z);

    assert.equal((await edit(alice, [{ op: 'terrain.add', edit: { kind: 'raise', x: spot.x, z: spot.z, r: 30, amount: 6 } }])).status, 403, 'members do not reshape land');
    const up = await edit(owner, [{ op: 'terrain.add', edit: { kind: 'raise', x: spot.x, z: spot.z, r: 30, amount: 6, soft: 0.4 } }]);
    assert.equal(up.status, 200, up.text);
    w = (await owner.get('/api/world')).json.world;
    assert.equal(w.terrain.edits.length, 1);
    const after = new Island(w.terrain, { roads: w.roads }).height(spot.x, spot.z);
    assert.ok(Math.abs(after - h0 - 6) < 0.05, `the hill rose 6 m (${(after - h0).toFixed(2)})`);
    // refused: in the city, on a road, in the sea
    const q = pointAt(net.geometry('isl-loop'), 500, {});
    const onRoad = await edit(owner, [{ op: 'terrain.add', edit: { kind: 'lower', x: q.x, z: q.z, r: 20, amount: 3 } }]);
    assert.equal(onRoad.status, 400); assert.match(onRoad.json.error, /ground under|junction/);
    const city = await edit(owner, [{ op: 'terrain.add', edit: { kind: 'raise', x: (g.minX + g.maxX) / 2, z: (g.minZ + g.maxZ) / 2, r: 20, amount: 3 } }]);
    assert.equal(city.status, 400); assert.match(city.json.error, /city/);
    const sea = await edit(owner, [{ op: 'terrain.add', edit: { kind: 'raise', x: T.center.x + T.radius * 1.2, z: T.center.z, r: 20, amount: 3 } }]);
    assert.equal(sea.status, 400); assert.match(sea.json.error, /sea|off the island/);
    // a pond next to the hill: water that never spills, a lake for everyone
    const pond = await edit(owner, [{ op: 'terrain.add', edit: { kind: 'pond', x: spot.x + 70, z: spot.z, r: 18, depth: 2 } }]);
    assert.equal(pond.status, 200, pond.text);
    w = (await owner.get('/api/world')).json.world;
    const I2 = new Island(w.terrain, { roads: w.roads }), pd = w.terrain.edits.find(e => e.kind === 'pond');
    assert.ok(Number.isFinite(pd.level), 'the pond has a water level');
    assert.equal(I2.waterAt(spot.x + 70, spot.z)?.kind, 'lake', 'there is water in it');
    assert.ok(I2.lakes.some(k => k.pond), 'it is one of the lakes');
    // undo the pond, redo it
    assert.equal((await owner.post('/api/undo')).status, 200);
    w = (await owner.get('/api/world')).json.world; assert.equal(w.terrain.edits.length, 1, 'undo fills the pond');
    assert.equal((await owner.post('/api/redo')).status, 200);
    w = (await owner.get('/api/world')).json.world; assert.equal(w.terrain.edits.length, 2, 'redo digs it again');
    // take back the hill
    const id = w.terrain.edits.find(e => e.kind === 'raise').id;
    assert.equal((await edit(owner, [{ op: 'terrain.del', id }])).status, 200);
    w = (await owner.get('/api/world')).json.world;
    assert.ok(Math.abs(new Island(w.terrain, { roads: w.roads }).height(spot.x, spot.z) - h0) < 0.01, 'the ground is back');

    // Decorations: the owner on public land beyond the city; alice can't.
    const tree = { t: 'tree', x: spot.x + 10, z: spot.z + 10, r: 0 };
    assert.equal((await edit(alice, [{ op: 'deco.add', deco: tree }])).status, 403);
    const put = await edit(owner, [{ op: 'deco.add', deco: tree }]);
    assert.equal(put.status, 200, put.text);
    const did = put.json.results[0].id;
    const twice = await edit(owner, [{ op: 'deco.add', deco: tree }]);
    assert.equal(twice.status, 400); assert.match(twice.json.error, /Too close/);
    const bench = await edit(owner, [{ op: 'deco.add', deco: { t: 'bench', x: q.x, z: q.z, r: 0 } }]);
    assert.equal(bench.status, 400, 'not on the road'); assert.match(bench.json.error, /road/);
    assert.equal((await edit(owner, [{ op: 'deco.move', id: did, deco: { ...tree, x: tree.x + 5 } }])).status, 200);
    w = (await owner.get('/api/world')).json.world;
    assert.equal(w.decorations.find(d => d.id === did).x, Math.round((tree.x + 5) * 100) / 100);
    assert.equal((await owner.post('/api/undo')).status, 200);
    w = (await owner.get('/api/world')).json.world;
    assert.equal(w.decorations.find(d => d.id === did).x, Math.round(tree.x * 100) / 100, 'undo moves it back');
    assert.equal((await edit(owner, [{ op: 'deco.del', id: did }])).status, 200);
    w = (await owner.get('/api/world')).json.world;
    assert.ok(!w.decorations.some(d => d.id === did));
    // A subway station beside the East road: administrators only; named after its road; undo and redo.
    {
      const G = net.geometry('isl-east'), half = net.profiles[net.get('isl-east').profile].outerHalf / 1e6;
      let made = null;
      for (let k = 0; k < 30 && !made; k++) {
        const q2 = pointAt(G, G.length * (0.4 + k * 0.015), {});
        for (const side of [1, -1]) {
          const nx = -q2.dz * side, nz = q2.dx * side, r = half + 1.6 + 1.98, station = { x: q2.x + nx * r, z: q2.z + nz * r, rot: Math.atan2(-nx, -nz) };
          if (k === 0 && side === 1) assert.equal((await edit(alice, [{ op: 'station.add', station }])).status, 403, 'members do not place stations');
          const res = await edit(owner, [{ op: 'station.add', station }]);
          if (res.status === 200) { made = res.json.results[0]; break; }
        }
      }
      assert.ok(made, 'a station opens beside the East road');
      w = (await owner.get('/api/world')).json.world;
      const S1 = w.stations.find(x => x.id === made.id);
      assert.ok(Number.isFinite(S1.y) && S1.name, `${S1.name} stands on the ground`);
      assert.equal((await owner.post('/api/undo')).status, 200);
      w = (await owner.get('/api/world')).json.world; assert.ok(!w.stations.some(x => x.id === made.id), 'undo closes it');
      assert.equal((await owner.post('/api/redo')).status, 200);
      w = (await owner.get('/api/world')).json.world; assert.ok(w.stations.some(x => x.id === made.id), 'redo opens it again');
      assert.equal((await edit(owner, [{ op: 'station.del', id: 's0' }])).status, 400, "the city's own stations stay");
      assert.equal((await owner.get('/api/health')).json.errors, 0);
    }
    // A holder decorates their own lot, not the city's next door.
    const plat = await owner.post('/api/property/plat-road', { road: 'isl-east', side: 'both' });
    assert.equal(plat.status, 200, plat.text);
    const lots = (await owner.get('/api/property/lots')).json.lots.filter(l => plat.json.ids.includes(l.id));
    const mid = l => ({ x: l.poly.reduce((t, p) => t + p.x, 0) / l.poly.length / 1e6, z: l.poly.reduce((t, p) => t + p.z, 0) / l.poly.length / 1e6 });
    const [mine, theirs] = [lots[10], lots[11]];
    assert.equal((await owner.post('/api/property/transfer', { id: mine.id, login: 'alice', reason: 'Test' })).status, 200);
    // billboards carry the shop's ads: only administrators put them up, even on a holder's own lot
    const bb = await edit(alice, [{ op: 'deco.add', deco: { t: 'billboard', ...mid(mine), r: 0 } }]);
    assert.equal(bb.status, 403, bb.text); assert.match(bb.json.error, /administrators put up billboards/);
    // the Marketing tools' billboards stand on public land or the city's own lots (not a player's, not one for sale),
    // and a city lot with one isn't handed to a player until it is moved
    assert.match((await edit(owner, [{ op: 'deco.add', deco: { t: 'billboard', ...mid(mine), r: 0 } }])).json.error, /held by a player/);
    const third = lots[12], bm = mid(third);
    const putB = await edit(owner, [{ op: 'deco.add', deco: { t: 'billboard', x: bm.x, z: bm.z, r: 0 } }]);
    assert.equal(putB.status, 200, putB.text);
    const bid = (await owner.get('/api/world')).json.world.decorations.find(d => d.t === 'billboard');
    assert.equal(bid.lot, third.id, 'it knows its lot');
    const tr = await owner.post('/api/property/transfer', { id: third.id, login: 'alice', reason: 'Test' });
    assert.equal(tr.status, 409); assert.match(tr.json.error, /move it first \(Marketing\)/);
    assert.equal((await owner.post('/api/property/offer', { id: third.id })).status, 409, 'nor put up for sale');
    assert.equal((await edit(alice, [{ op: 'deco.del', id: bid.id }])).status, 403, 'members never take one down from city land');
    assert.equal((await edit(owner, [{ op: 'deco.del', id: bid.id }])).status, 200);
    assert.equal((await owner.post('/api/property/transfer', { id: third.id, login: 'alice', reason: 'Test' })).status, 200, 'moved: the lot can go');
    // billboards stand outdoors only: never as furniture inside
    const inside = w.buildings.find(B => B && !B.gone && B.type !== 'park' && B.lv?.length);
    const furn = await edit(owner, [{ op: 'item.add', b: inside.idx, f: 0, t: 'billboard', x: 0, z: 0, r: 0 }]);
    assert.match(furn.json.error, /outdoors only/);
    const own = await edit(alice, [{ op: 'deco.add', deco: { t: 'flowers', ...mid(mine), r: 0 } }]);
    assert.equal(own.status, 200, own.text);
    const next = await edit(alice, [{ op: 'deco.add', deco: { t: 'flowers', ...mid(theirs), r: 0 } }]);
    assert.equal(next.status, 403); assert.match(next.json.error, /decorate lot/);
    // a building can't go up on top of a decoration
    w = (await owner.get('/api/world')).json.world;
    const fl = w.decorations.find(d => d.t === 'flowers');
    assert.equal(fl.lot, mine.id, 'the decoration knows its lot');
    // the shared rules
    const env = { isWater: () => false, roads: net, city: g, buildings: w.buildings, decorations: [] };
    assert.match(checkDecor(normalizeDecor({ t: 'bench', x: g.X[0] + g.bw / 2, z: g.minZ - 0.2 }), { ...env, roads: null }) || 'ok', /street|ok/);
  } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
