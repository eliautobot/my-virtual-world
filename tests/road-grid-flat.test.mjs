// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The grid layout tool, 2026-10-14 (the product owner): its roadways flat - one level, the land across the whole grid
// levelled to it so the lots are level too - and its lots made with it (/api/property/plat-grid).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ROOT, startServer, ownerSession, tempDir } from '../tools/lib/testserver.mjs';
import { RoadNetwork, pointAt } from '../shared/roads.js';
import { IslandRoads, profileAt, DRAW_LIFT } from '../shared/island-roads.js';
import { CURB_RISE } from '../shared/road-kit.js';
import { Island } from '../shared/terrain.js';
import { buildingPads, gridPads } from '../shared/island-build.js';
import { gridLayout, gridLevel } from '../shared/road-grid.js';
import { GROUND_Y } from '../shared/constants.js';

const steep = (x, z) => 0.07 * x - 0.05 * z + 3 * Math.sin(z / 60);

test('a grid\'s roads are flat at its level, its junctions too, and a road meeting it climbs to it', () => {
  const L = gridLayout({ c: { x: 0, z: 0 }, ns: 3, ew: 3, lotsX: 2, lotsZ: 2, lotFt: 100, rot: 20, profile: 'two-lane', name: 'T', level: 6, grid: 'gt' });
  const roads = L.roads.map((r, k) => ({ ...r, id: `g${k}` }));
  const end = roads[0].pts[0], side = { id: 'side', profile: 'two-lane', name: 'Side', pts: [{ x: end.x, z: end.z }, { x: end.x - 300e6, z: end.z - 250e6 }] };
  const R = new IslandRoads([...roads, side], steep);
  for (const r of roads) { const y = R.prof.get(r.id).y; assert.ok(Math.max(...y) - 6 < 1e-4 && 6 - Math.min(...y) < 1e-4, `${r.name} is flat`); }
  for (const P of R.pads) assert.ok(Math.abs(P.y - 6) < 1e-6, 'every junction on the grid at its level');
  assert.ok(Math.abs(profileAt(R.prof.get('side'), 0) - 6) < 1e-4, 'the side road meets the grid at its level');
  assert.ok(Math.abs(profileAt(R.prof.get('side'), 300) - 6) > 2, 'and follows its own ground further out');
  { // inside a junction its own drawing sets the surface: paving at the road's level (a mouth too), corner sidewalks raised
    let paved = 0, raised = 0;
    for (const P of R.pads) for (let x = P.x - P.r; x <= P.x + P.r; x += 0.7) for (let z = P.z - P.r; z <= P.z + P.r; z += 0.7) {
      const k = R.junctionAt(x, z); if (!k) continue;
      const want = P.y + DRAW_LIFT + (k === 'raised' ? CURB_RISE : 0), t = R.top(x, z);
      assert.ok(Math.abs(t - want) < 1e-4, `${k} at (${x.toFixed(1)}, ${z.toFixed(1)}): top ${t} vs ${want}`);
      k === 'raised' ? raised++ : paved++;
    }
    assert.ok(paved > 500 && raised > 100, `junctions checked (${paved} paved, ${raised} raised)`);
  }
  const [pad] = gridPads({ roads });
  assert.ok(pad && pad.under && Math.abs(pad.lot - (6 + DRAW_LIFT + CURB_RISE)) < 1e-6, 'one level pad for the grid, its lots at the top of its sidewalks');
  for (const B of L.blocks) for (const q of B.ring) {   // the pad covers every block (its corners are inside)
    const dx = q.x - pad.x, dz = q.z - pad.z, u = dx * Math.cos(pad.rot) - dz * Math.sin(pad.rot), v = dx * Math.sin(pad.rot) + dz * Math.cos(pad.rot);
    assert.ok(Math.abs(u) < pad.hw && Math.abs(v) < pad.hd, 'block inside the pad');
  }
  assert.equal(L.runs.length, 4 * 2, 'two rows of lots per block'); assert.equal(L.inner, 0);
  const big = gridLayout({ c: { x: 0, z: 0 }, ns: 2, ew: 2, lotsX: 4, lotsZ: 4, lotFt: 60, rot: 0, profile: 'two-lane' });
  assert.equal(big.inner, 4, 'a 4 × 4 block leaves its 4 middle lots out (no road beside them)');
});

test('a grid built on the island: level land across it, its lots made in one go', async () => {
  const dir = tempDir('mvw-gridflat-');
  const first = await startServer({ data: dir, population: 40 }); await first.stop();
  for (const tool of ['add-island', 'add-roads']) {
    const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const s = await startServer({ data: dir, population: 40 });
  try {
    const owner = await ownerSession(s);
    let world = (await owner.get('/api/world')).json.world;
    const G = RoadNetwork.fromJSON(world.roads).geometry('isl-north'), N = RoadNetwork.fromJSON(world.roads);
    const before = new Island(world.terrain, { roads: world.roads }).withPads(buildingPads(world));
    // a dry spot off the North road, clear of the other roads (the test island is new each run: some spots are a lake)
    let o = null, lv = null;
    for (const [t, d] of [[0.55, 260], [0.4, 260], [0.7, 260], [0.55, -260], [0.3, 300], [0.8, 300], [0.4, -300], [0.7, -300]]) {
      const q = pointAt(G, G.length * t, {}), c = { x: q.x - q.dz * d, z: q.z + q.dx * d }, rot = Math.atan2(q.dz, q.dx) * 180 / Math.PI;
      const tryO = { c, ns: 3, ew: 3, lotsX: 2, lotsZ: 2, lotFt: 80, rot, profile: 'two-lane', name: 'Flat' }, Lt = gridLayout(tryO);
      const l = gridLevel(Lt, (x, z) => before.height(x, z), (x, z) => !!before.waterAt(x, z), world.terrain.seaLevel);
      const [u0, u1, v0, v1] = Lt.extent, ring = [Lt.at(u0 - 40, v0 - 40), Lt.at(u1 + 40, v0 - 40), Lt.at(u1 + 40, v1 + 40), Lt.at(u0 - 40, v1 + 40)];
      if (!l.wet && !N.corridorHits(ring).length) { o = tryO; lv = l; break; }
    }
    assert.ok(o, 'a dry spot clear of other roads');
    assert.equal(lv.wet, 0, 'dry land'); assert.ok(lv.cut + lv.fill > 0.5, `the ground there is not flat to begin with (${(lv.cut + lv.fill).toFixed(2)} m)`);
    const L = gridLayout({ ...o, level: lv.level, grid: 'gtest' });
    const built = await owner.post('/api/edit', { atomic: true, ops: L.roads.map(({ id, ...road }) => (void id, { op: 'road.set', road })) });
    assert.equal(built.status, 200, built.text);
    const ids = built.json.results.map(r => r.id);
    world = (await owner.get('/api/world')).json.world;
    const mine = world.roads.filter(r => ids.includes(r.id));
    assert.ok(mine.every(r => r.level === lv.level && r.grid === 'gtest'), 'the roads keep their level and grid');
    const isl = new Island(world.terrain, { roads: world.roads }).withPads(buildingPads(world));
    for (const id of ids) { const y = isl.roads.prof.get(id).y; assert.ok(Math.max(...y) - Math.min(...y) < 1e-4, 'flat road'); }
    const lotY = lv.level + DRAW_LIFT + CURB_RISE, ground = lotY;   // a block's ground: the lots' level, as the city's
    let worst = 0;
    for (const B of L.blocks) {   // across each block, right up to the back of its sidewalks, the land is at its lots' level
      const [a, , b2] = B.ring;
      for (let i = 0; i <= 12; i++) for (let k = 0; k <= 12; k++) {
        const x = a.x + (b2.x - a.x) * (0.002 + 0.996 * i / 12), z = a.z + (b2.z - a.z) * (0.002 + 0.996 * k / 12);
        if (isl.roads.top(x, z) !== null) continue;   // (a corner's curved sidewalk)
        worst = Math.max(worst, Math.abs(isl.height(x, z) - ground));
      }
    }
    assert.ok(worst < 0.005, `the blocks are flush to the back of the sidewalks (worst ${worst.toFixed(3)} m off)`);
    { // the drawn terrain lies well under a block (no flicker from afar); in a junction the ground stays under its paving
      const drawn = new Island(world.terrain, { roads: world.roads, bridgesAsGround: false }).withPads(buildingPads(world)), B = L.blocks[0].ring;
      const c = { x: (B[0].x + B[2].x) / 2, z: (B[0].z + B[2].z) / 2 };
      assert.ok(drawn.height(c.x, c.z) < lotY - 0.3, 'the drawn terrain sinks under the block');
      let n = 0, over = 0;
      for (const P of isl.roads.pads) for (let x = P.x - P.r; x <= P.x + P.r; x += 0.5) for (let z = P.z - P.r; z <= P.z + P.r; z += 0.5) {
        const k = isl.roads.junctionAt(x, z); if (k !== 'paved') continue; n++;
        const pad = isl.roads.pads.find(Q => Q === P);
        if (isl.height(x, z) > pad.y + 0.001) over++;
      }
      assert.ok(n > 1000 && over === 0, `the ground under a junction's paving stays under it (${over} of ${n} points over)`);
    }
    { // under the sidewalk the land stays just below its top: no dip where a lot meets it (stretches clear of junctions)
      let n = 0;
      for (const id of ids) {
        const G2 = isl.roads.net.geometry(id), half = isl.roads.half.get(id);
        for (let k = 1; k < 20; k++) {
          const p = pointAt(G2, G2.length * k / 20, {});
          if (isl.roads.pads.some(P => Math.hypot(P.x - p.x, P.z - p.z) < P.r + 3)) continue;
          for (const off of [half - 0.3, half - 1, -(half - 0.5)]) {
            const x = p.x - p.dz * off, z = p.z + p.dx * off, t = isl.roads.top(x, z), h = isl.height(x, z);
            assert.ok(Math.abs(t - lotY) < 1e-4, `the sidewalk top is the lots' level (${t} vs ${lotY})`);
            assert.ok(h < t && h > t - 0.1, `the land just under it (${(t - h).toFixed(3)} m)`); n++;
          }
        }
      }
      assert.ok(n > 20, `sidewalk checked (${n})`);
    }
    // the lots, made with it
    const runs = L.runs.map(r => ({ ...r, road: ids[r.road] }));
    const made = await owner.post('/api/property/plat-grid', { runs, width: L.lot.w, depth: L.lot.d, zoning: 'residential' });
    assert.equal(made.status, 200, made.text);
    assert.equal(made.json.ids.length, L.lots, `every lot of the plan (${made.json.ids.length} of ${L.lots}; skipped ${JSON.stringify(made.json.skipped)})`);
    const lots = (await owner.get('/api/property/lots')).json.lots.filter(l => made.json.ids.includes(l.id));
    assert.ok(lots.every(l => l.frontage?.length && ids.includes(l.frontage[0].road)), 'each lot fronts one of the grid\'s roads');
    assert.ok(lots.every(l => l.zoning === 'residential'));
    for (const l of lots) {
      const ys = l.poly.map(p => isl.height(p.x / 1e6, p.z / 1e6)); let cx = 0, cz = 0; for (const p of l.poly) { cx += p.x / 1e6 / l.poly.length; cz += p.z / 1e6 / l.poly.length; }
      assert.ok(Math.abs(isl.height(cx, cz) - ground) < 0.005, 'the middle of each lot at its level');
      assert.ok(Math.max(...ys) - Math.min(...ys) < 0.005, 'and level corner to corner');
    }
    { // a house on one of them stands at the lots' level: its floor flush with the lot and the sidewalk
      const G0 = await owner.get('/api/world'), net = RoadNetwork.fromJSON(G0.json.world.roads);
      let built = null;
      for (const l of lots) {
        const f = l.frontage[0], G2 = net.geometry(f.road), half = net.profiles[net.get(f.road).profile].outerHalf / 1e6, q2 = pointAt(G2, (f.s0 + f.s1) / 2, {});
        const sign = f.side === 'a' ? 1 : -1, nx = -q2.dz * sign, nz = q2.dx * sign, rr = half + 1.5 + 6;
        const spec = { type: 'house', w: 10, d: 10, floors: 2, style: 'stucco', x: q2.x + nx * rr, z: q2.z + nz * rr, rot: Math.atan2(-nx, -nz) * 180 / Math.PI, name: 'Grid House' };
        const res = await owner.post('/api/edit', { ops: [{ op: 'bld.add', spec }] });
        if (res.status === 200) { built = res.json.results[0]; break; }
      }
      assert.ok(built, 'a house goes up on a grid lot');
      const B = (await owner.get('/api/world')).json.world.buildings[built.b];
      assert.ok(Math.abs(B.base - (lotY - GROUND_Y)) < 0.006, `its floor at the lots' level (${B.base} vs ${(lotY - GROUND_Y).toFixed(2)})`);
    }
    { // the lots fill their blocks: from the back of one sidewalk to the next (2026-10-14: a strip was left at a run's end)
      const area = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q.x * r.z - r.x * q.z; } return Math.abs(a) / 2e12; };
      const blocks = L.blocks.reduce((a, B) => a + Math.hypot(B.ring[1].x - B.ring[0].x, B.ring[1].z - B.ring[0].z) * Math.hypot(B.ring[3].x - B.ring[0].x, B.ring[3].z - B.ring[0].z), 0);
      const share = lots.reduce((a, l) => a + area(l.poly), 0) / blocks;
      assert.ok(share > 0.985 && share <= 1.0005, `the lots cover their blocks (${(share * 100).toFixed(2)} %)`);
    }
    const again = await owner.post('/api/property/plat-grid', { runs, width: L.lot.w, depth: L.lot.d });
    assert.equal(again.status, 400, 'the lots are there already'); assert.equal(again.json.skipped.lot, L.lots);
    assert.equal((await owner.post('/api/property/plat-grid', { runs: [{ road: 'no-such' }], width: 20, depth: 20 })).status, 404);
    // a grid road moved stays flat at its level
    const r0 = mine[0], moved = await owner.post('/api/edit', { ops: [{ op: 'road.set', road: { id: r0.id, name: r0.name, profile: r0.profile, pts: r0.pts } }] });
    assert.equal(moved.status, 200, moved.text);
    world = (await owner.get('/api/world')).json.world;
    assert.equal(world.roads.find(r => r.id === r0.id).level, lv.level);
  } finally { await s.stop(); }
});
