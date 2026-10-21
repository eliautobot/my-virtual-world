// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The road tools' 2026-10-13 round (the product owner): dead ends simply stop (no turning circle) and traffic still turns
// round there; a road joined by another is re-graded where its heights moved, not only round the new road; a batch of
// road changes asked for atomically (the grid layout tool) is built whole or not at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ROOT, startServer, ownerSession, tempDir } from '../tools/lib/testserver.mjs';
import { RoadNetwork, pointAt } from '../shared/roads.js';
import { IslandRoads, roadShifts } from '../shared/island-roads.js';
import { buildLaneGraph } from '../shared/lane-graph.js';
import { makeGrid } from '../shared/city.js';

const um = v => Math.round(Math.round(v * 100) * 1e4);
const P = (x, z) => ({ x: um(x), z: um(z) });
const slope = (x, z) => 0.03 * x + 0.02 * z + 4 * Math.sin(x / 90);   // rolling ground, so profiles differ

test('a dead end has no turning circle, and traffic still turns round there', () => {
  const R = new IslandRoads([{ id: 'lane', profile: 'two-lane', name: 'Lane', pts: [P(0, 0), P(400, 0)] }], slope);
  assert.equal(R.pads.filter(p => p.kind === 'end').length, 0, 'no turning circle is paved or graded');
  const G = buildLaneGraph(R);
  const around = G.connectors.filter(c => c.turn === 'around');
  assert.ok(around.length >= 2, 'a turnaround at each end');
  for (const c of around) for (const p of c.pts) assert.ok(Math.abs(p.z) < R.half.get('lane'), 'the turnaround stays within the road');
});

test('joining a road re-grades the road it joins, where its heights moved', () => {
  const A = { id: 'a', profile: 'two-lane', name: 'A', pts: [P(-600, 0), P(600, 0)] };
  const B = { id: 'b', profile: 'two-lane', name: 'B', pts: [P(0, 0), P(0, 500)] };
  const before = new IslandRoads([A], slope), after = new IslandRoads([A, B], slope);
  const moved = [...before.prof.get('a').y].some((y, i) => Math.abs(y - after.prof.get('a').y[i]) > 0.01);
  assert.ok(moved, 'the junction re-profiles the old road');
  const boxes = roadShifts(before, after);
  assert.ok(boxes.some(b => b.x0 <= 0 && b.x1 >= 0 && b.z0 <= 1 && b.z1 >= -1), 'the junction on the old road is rebuilt');
  assert.ok(boxes.some(b => b.x0 < -30 || b.x1 > 30), 'and its re-graded approach beyond the new road\'s own corridor');
  assert.deepEqual(roadShifts(after, new IslandRoads([A, B], slope)), [], 'nothing moved: nothing to rebuild');
});

test('beside a junction on a slope the ground never stands above the road, nor as a bank at its edge', () => {
  const steep = (x, z) => 0.07 * x - 0.05 * z + 3 * Math.sin(z / 60);
  // (square and skewed: a side road at an angle makes the paving reach further along one side of the through road;
  // a wide road meeting a narrow one paves corners outside the narrow road)
  for (const [p1, p2, bx] of [['two-lane', 'two-lane', 0], ['avenue-4', 'two-lane-shoulder', 0], ['two-lane', 'country', 0], ['country', 'country', 0], ['two-lane', 'two-lane', 170], ['country', 'avenue-4', 0], ['country', 'avenue-4', -150]]) {
    const R = new IslandRoads([
      { id: 'a', profile: p1, name: 'A', pts: [P(-300, 0), P(300, 0)] },
      { id: 'b', profile: p2, name: 'B', pts: [P(0, 0), P(bx, 300)] },
    ], steep);
    let over = -Infinity, bank = -Infinity;
    for (const id of ['a', 'b']) {
      const G = R.net.geometry(id), half = R.half.get(id);
      for (let s = 0; s <= G.length; s += 0.5) {
        const p = pointAt(G, s, {});
        for (const k of [-0.95, -0.5, 0, 0.5, 0.95]) {
          const x = p.x - p.dz * half * k, z = p.z + p.dx * half * k, top = R.top(x, z);
          if (top !== null) over = Math.max(over, R.grade(x, z, steep(x, z)) - top);
        }
        // just outside the road's edge, against the edge's own top
        for (const sd of [-1, 1]) {
          const x = p.x - p.dz * sd * (half + 0.4), z = p.z + p.dx * sd * (half + 0.4), xi = p.x - p.dz * sd * (half - 0.2), zi = p.z + p.dx * sd * (half - 0.2), top = R.top(xi, zi);
          if (top !== null && R.top(x, z) === null) bank = Math.max(bank, R.grade(x, z, steep(x, z)) - top);
        }
      }
    }
    assert.ok(over <= 0.005, `${p1} + ${p2} (${bx}): ground ${over.toFixed(3)} m over the road`);
    assert.ok(bank < 0.1, `${p1} + ${p2} (${bx}): a bank ${bank.toFixed(3)} m over the road's edge`);
  }
});

test('an atomic batch of road changes is built whole or not at all', async () => {
  const dir = tempDir('mvw-roadgrid-');
  const first = await startServer({ data: dir, population: 60 }); await first.stop();
  for (const tool of ['add-island', 'add-roads']) {
    const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const s = await startServer({ data: dir, population: 60 });
  try {
    const owner = await ownerSession(s);
    let world = (await owner.get('/api/world')).json.world;
    const g = makeGrid(world.grid), count = world.roads.length;
    // two crossing roads 160 m off the North road's middle, square to it
    const G = RoadNetwork.fromJSON(world.roads).geometry('isl-north'), q = pointAt(G, G.length * 0.55, {}), n = { x: -q.dz, z: q.dx }, t = { x: q.dx, z: q.dz };
    const c = { x: q.x + n.x * 160, z: q.z + n.z * 160 }, L = 70;
    const a = { name: 'Grid Avenue 1', profile: 'two-lane', pts: [P(c.x - t.x * L, c.z - t.z * L), P(c.x + t.x * L, c.z + t.z * L)] };
    const b = { name: 'Grid Street 1', profile: 'two-lane', pts: [P(c.x - n.x * L, c.z - n.z * L), P(c.x + n.x * L, c.z + n.z * L)] };
    const inCity = { name: 'Shortcut', profile: 'country', pts: [P(g.X[0] + 20, g.Z[0] + 20), P(g.X[1] - 20, g.Z[1] - 20)] };
    const ops = list => list.map(road => ({ op: 'road.set', road }));

    const refused = await owner.post('/api/edit', { atomic: true, ops: ops([a, b, inCity]) });
    assert.equal(refused.status, 400); assert.match(refused.json.error, /inside the city/); assert.equal(refused.json.failedAt, 2);
    world = (await owner.get('/api/world')).json.world;
    assert.equal(world.roads.length, count, 'none of the batch was built');

    const built = await owner.post('/api/edit', { atomic: true, ops: ops([a, b]) });
    assert.equal(built.status, 200, built.text);
    world = (await owner.get('/api/world')).json.world;
    assert.equal(world.roads.length, count + 2);
    const ids = built.json.results.map(r => r.id);
    assert.ok(RoadNetwork.fromJSON(world.roads).junctions().some(j => j.kind === 'X' && ids.every(id => j.arms.some(x => x.id === id))), 'they cross');
    assert.equal((await owner.post('/api/undo')).status, 200);
    world = (await owner.get('/api/world')).json.world;
    assert.equal(world.roads.length, count, 'one undo takes the whole batch away');

    // without atomic the old behaviour stands: the ops before the refused one are kept
    const partial = await owner.post('/api/edit', { ops: ops([a, inCity]) });
    assert.equal(partial.status, 400);
    world = (await owner.get('/api/world')).json.world;
    assert.equal(world.roads.length, count + 1);
  } finally { await s.stop(); }
});
