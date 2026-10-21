// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.15 ferries: the shared timetable (boats at the docks when sailings leave and arrive), the rules for a line (docks
// off a growth coast with a road near the shore, deep water all the way, never over land), residents' routes that take
// the ferry (and never drive across the water), the wait and crossing in a resident's plan; over the API with undo and
// administrators only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateWorld } from '../server/world/generate.js';
import { makeGrid } from '../shared/city.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { SECTORS } from '../shared/coasts.js';
import { ferryWhy, ferryPath, timetable, boatAt, nextSailing, docksOf, normalizeFerry, FERRY } from '../shared/ferries.js';
import { Nav } from '../server/sim/nav.js';
import { Plan, Router } from '../server/sim/plan.js';
import { F_HIDDEN } from '../shared/proto.js';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';
import { findLine } from '../tools/lib/ferry-line.mjs';

function islandWorld(seed = 'wp4-ferries') {
  const world = generateWorld({ seed, population: 0 }), g = makeGrid(world.grid);
  world.terrain = defaultIsland({ seed: `${seed}:island`, city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  world.roads = generateIslandRoads(new Island(world.terrain), world.grid);
  return world;
}
test('the timetable: boats are at the docks when sailings leave and arrive, everyone computes the same', () => {
  const f = normalizeFerry({ id: 'fy-7', name: 'T', boats: 2, pts: [{ x: 0, z: 0 }, { x: 900, z: 0 }, { x: 900, z: 1200 }] });
  const T = timetable(f), P = ferryPath(f);
  assert.ok(P.length > 1900 && P.length < 2100, `the corner is rounded: ${P.length.toFixed(0)} m`);
  assert.ok(Math.abs(T.cross - P.length / FERRY.SPEED) < 1e-9 && Math.abs(T.headway - T.cycle / 2) < 1e-9);
  for (const [e, start, end] of [['a', f.pts[0], f.pts.at(-1)], ['b', f.pts.at(-1), f.pts[0]]]) {
    for (const t0 of [0, 1234.5, 98765]) {
      const s = nextSailing(f, e, t0);
      assert.ok(s.depart >= t0 && s.depart - t0 <= T.headway + 1e-6, `${e}: the next sailing within a headway`);
      assert.ok(Math.abs(s.arrive - s.depart - T.cross) < 1e-9);
      const at = k => [0, 1].map(j => boatAt(f, j, k)).sort((p, q) => Math.hypot(p.x - start.x, p.z - start.z) - Math.hypot(q.x - start.x, q.z - start.z))[0];
      const dep = at(s.depart - 0.01), arr = [0, 1].map(j => boatAt(f, j, s.arrive + 0.01)).find(b => Math.hypot(b.x - end.x, b.z - end.z) < 1);
      assert.ok(Math.hypot(dep.x - start.x, dep.z - start.z) < 1 && dep.at === e, `${e}: a boat waits at the dock as the sailing leaves`);
      assert.ok(arr, `${e}: a boat is at the far dock when it arrives`);
    }
  }
  const mid = boatAt(f, 0, T.phase + T.dwell + T.cross / 2);
  assert.ok(mid.sailing === 1 && mid.p > 0.45 && mid.p < 0.55, 'half way at half time');
});

test('ferry lines: the rules; residents ride across (never drive over the water); a plan waits for the sailing', () => {
  const world = islandWorld();
  world.terrain = { ...world.terrain, coasts: 'g'.repeat(SECTORS) };   // the whole coast open for docks
  const found = findLine(world);
  assert.ok(found, 'a line round the coast');
  const { f, env } = found;
  // refusals
  const over = normalizeFerry({ ...f, pts: [f.pts[0], { x: world.terrain.center.x, z: world.terrain.center.z }, f.pts.at(-1)] });
  assert.match(ferryWhy(over, env), /crosses land|city|deep/);
  const near = normalizeFerry({ ...f, pts: [f.pts[0], { x: f.pts[0].x + 20, z: f.pts[0].z }] });
  assert.match(ferryWhy(near, env), /apart/);
  const protectedCoast = { ...world, terrain: { ...world.terrain, coasts: 'w'.repeat(SECTORS) } };
  assert.match(ferryWhy(f, { ...env, island: new Island(protectedCoast.terrain) }), /growth coast/);
  assert.match(ferryWhy(f, { ...env, roads: { nearest: () => null } }), /No road/);

  // residents: the footpaths gain the crossing both ways; a route through it carries the dock points and the marker
  world.ferries = [f];
  const nav = new Nav(world), W = nav.walk();
  assert.equal(W.ferry.size, 2, 'both ways');
  const [key] = W.ferry.keys(), [na, nb] = key.split('>').map(Number);
  const pts = W.pts([na, nb]), mark = pts.find(p => p.ferry);
  assert.ok(mark && mark.ferry === f.id && ['a', 'b'].includes(mark.from), 'the crossing is marked');
  const A = nav.walkAccess(W.X[na], W.Z[na]), B = nav.walkAccess(W.X[nb], W.Z[nb]);
  const r = nav.walkRoute(A, B, true);
  assert.ok(r.ferry, `the ferry is the quicker way (${(r.cost / 60).toFixed(0)} min door to door)`);
  assert.ok(r.pts.some(p => p.ferry), 'the points carry the crossing');
  assert.equal(nav.rideCost(A, B), null, 'nobody drives across the water');
  // the plan: walk to the dock, wait for the boat, hidden across, step off at the far dock
  const router = new Router(world, nav), D = docksOf(f, new Island(world.terrain, { roads: world.roads })), t0 = 5000;
  const P = new Plan(t0, { x: D[0].dock.x, y: D[0].deck, z: D[0].dock.z, ctx: -1 });
  router.ferry(P, { ferry: f.id, from: 'a' }, { x: D[1].dock.x, y: D[1].deck, z: D[1].dock.z }, { speed: 1.4, anim: 1, use: 1 });
  const s = nextSailing(f, 'a', t0 + 2), hidden = P.segs.at(-1);
  assert.ok(Math.abs(P.t - s.arrive) < 1e-6, 'off the boat when it arrives');
  assert.ok(hidden.flags & F_HIDDEN, 'hidden on board');
  assert.ok(Math.hypot(P.x - D[1].dock.x, P.z - D[1].dock.z) < 0.01, 'at the far dock');
});

test('ferries over the API: administrators open, change and close lines; undo and redo; members cannot', async () => {
  const dir = tempDir('mvw-ferry-');
  const first = await startServer({ data: dir, population: 80 }); await first.stop();
  for (const tool of ['add-island', 'add-roads']) {
    const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  const s = await startServer({ data: dir, population: 80 });
  try {
    const owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' });
    // open the whole main coast for docks (as an administrator would, stretch by stretch)
    let world = (await owner.get('/api/world')).json.world;
    const ops = []; for (let k = 0; k < SECTORS; k++) ops.push({ op: 'coast.set', k, cls: 'g' });
    for (let i = 0; i < ops.length; i += 40) assert.equal((await owner.post('/api/edit', { ops: ops.slice(i, i + 40) })).status, 200);
    world = (await owner.get('/api/world')).json.world;
    const found = findLine(world, { id: 'fy-1', name: 'Harbour Ferry' });
    assert.ok(found, 'a line round the coast');
    const ferry = { name: 'Harbour Ferry', boats: 2, pts: found.f.pts };
    assert.equal((await alice.post('/api/edit', { ops: [{ op: 'ferry.set', ferry }] })).status, 403, 'members do not run ferries');
    const ok = await owner.post('/api/edit', { ops: [{ op: 'ferry.set', ferry }] });
    assert.equal(ok.status, 200, ok.text);
    const id = ok.json.results[0].id;
    world = (await owner.get('/api/world')).json.world;
    assert.deepEqual(world.ferries.map(f => [f.id, f.name, f.boats]), [[id, 'Harbour Ferry', 2]]);
    const bad = await owner.post('/api/edit', { ops: [{ op: 'ferry.set', ferry: { ...ferry, pts: [ferry.pts[0], { x: world.terrain.center.x, z: world.terrain.center.z }, ferry.pts.at(-1)] } }] });
    assert.equal(bad.status, 400); assert.match(bad.json.error, /land|city|deep/);
    assert.equal((await owner.post('/api/edit', { ops: [{ op: 'ferry.set', ferry: { ...world.ferries[0], boats: 3 } }] })).status, 200);
    assert.equal((await owner.post('/api/edit', { ops: [{ op: 'ferry.del', id }] })).status, 200);
    assert.equal(((await owner.get('/api/world')).json.world.ferries || []).length, 0);
    assert.equal((await owner.post('/api/undo')).status, 200);
    world = (await owner.get('/api/world')).json.world;
    assert.equal(world.ferries[0].boats, 3, 'back, with three boats');
    assert.equal((await owner.post('/api/undo')).status, 200);
    assert.equal((await owner.get('/api/world')).json.world.ferries[0].boats, 2);
    assert.equal((await owner.post('/api/redo')).status, 200);
    assert.equal((await owner.get('/api/world')).json.world.ferries[0].boats, 3);
  } finally { await s.stop(); }
});
