// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.9 residents' cars: a drive's lanes run on the roads (city streets and island roads), in the right-hand lane for
// the way they go, without jumps; the plan marks the drive (the segment's vehicle byte, which the wire format carries);
// the router tells who drives where and when, matching the hidden segment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { makeGrid } from '../shared/city.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { worldRoads } from '../shared/city-roads.js';
import { tangentAt } from '../shared/roads.js';
import { encodePlans, decodePlans, F_HIDDEN, VEH_CAR, VEH_BOAT } from '../shared/proto.js';
import { Nav } from '../server/sim/nav.js';
import { Plan, Router } from '../server/sim/plan.js';

test('the wire format carries what a hidden traveller rides in', () => {
  const P = new Plan(100, { x: 0, y: 0, z: 0, ctx: -1 });
  P.seg(5, 10, 0, 0, 0, 0, 0, 0, F_HIDDEN, -1, { veh: VEH_CAR });
  P.seg(5, 20, 0, 0, 0, 0, 0, 0, F_HIDDEN, -1, { veh: VEH_BOAT });
  P.seg(5, 30, 0, 0, 0, 0, 0, 0, 0, -1);
  let got = null; decodePlans(encodePlans([[7, P]]), (i, p) => { got = p; });
  assert.deepEqual([...got.veh], [VEH_CAR, VEH_BOAT, 0]);
});

test('a resident\'s drive: lanes on the roads, right-hand side, no jumps; the router says who drives when', () => {
  const world = generateWorld({ seed: 'wp4-rcars', population: 0 }), g = makeGrid(world.grid);
  world.terrain = defaultIsland({ seed: 'wp4-rcars:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  world.roads = generateIslandRoads(new Island(world.terrain), world.grid);
  const nav = new Nav(world), W = nav.walk(), net = worldRoads(world);
  // from a city office's door to a footpath far out along the island's roads
  const C = world.buildings.find(b => b && !b.gone && b.type === 'office');
  let far = -1, fd = 0; for (let n = 0; n < W.N; n += 7) { const d = Math.hypot(W.X[n], W.Z[n]); if (d > fd && d < 2600) { fd = d; far = n; } }
  const A = nav.acc[C.idx][0], B = nav.walkAccess(W.X[far], W.Z[far]);
  const flat = nav.carPath(A, B);
  assert.ok(flat && flat.length >= 20, `a path (${flat && flat.length / 2} points)`);
  let onRoad = 0, right = 0, n = flat.length / 2;
  for (let k = 0; k < n; k++) {
    const x = flat[2 * k], z = flat[2 * k + 1];
    if (k) assert.ok(Math.hypot(x - flat[2 * k - 2], z - flat[2 * k - 1]) < 45, `no jumps (${k})`);
    const q = net.nearest(x, z, 12); if (!q) continue;
    onRoad++;
    if (k + 1 < n) {   // the lane is right of the way it goes
      const dx = flat[2 * k + 2] - x, dz = flat[2 * k + 3] - z, t = tangentAt(net.geometry(q.id), q.s), sg = Math.sign(t.dx * dx + t.dz * dz) || 1;
      const ox = x - q.x, oz = z - q.z, side = -(t.dz * sg) * ox + (t.dx * sg) * oz;   // + : on the right (as the traffic's lanes, shared/lane-graph.js)
      if (side > 0 || q.dist < 0.3) right++;
    }
  }
  assert.ok(onRoad / n > 0.97, `on the roads (${onRoad}/${n})`);
  assert.ok(right / (n - 1) > 0.95, `right-hand lanes (${right}/${n - 1})`);
  // the router: the drive's message matches its hidden segment
  const router = new Router(world, nav), seen = [];
  router.onDrive = r => seen.push(r);
  const P = new Plan(1000, { x: A.x, y: 0.15, z: A.z, ctx: -1 }), r = nav.rideCost(A, B);
  assert.ok(r, 'a drive is possible');
  router.drive(P, A, B, r, { speed: 1.4, anim: 1, use: 1, i: 42 });
  const hidden = P.segs.find(s => s.veh === VEH_CAR);
  assert.ok(hidden && hidden.flags & F_HIDDEN);
  assert.equal(seen.length, 1); assert.equal(seen[0].i, 42);
  const t0 = 1000 + P.segs.slice(0, P.segs.indexOf(hidden)).reduce((a, s) => a + s.dur, 0);
  assert.ok(Math.abs(seen[0].t0 - t0) < 1e-6 && Math.abs(seen[0].t1 - (t0 + hidden.dur)) < 1e-6, 'the times of the hidden segment');
});
