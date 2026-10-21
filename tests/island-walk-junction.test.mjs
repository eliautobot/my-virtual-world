// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Walkers at a planned junction beyond the city (shared/road-kit.js): they walk on the raised sidewalks, cross an arm at
// its crosswalk (stepping down onto the road and up again) and at a signalled junction wait at the curb for the walk
// light, then get across before it ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { makeGrid } from '../shared/city.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { RoadNetwork } from '../shared/roads.js';
import { walkFor } from '../shared/road-kit.js';
import { Nav } from '../server/sim/nav.js';
import { Plan, Router } from '../server/sim/plan.js';

const um = v => Math.round(v * 1e6);
function crossingWorld(seed) {
  const w = generateWorld({ seed, nx: 3, nz: 3, population: 0 }), g = makeGrid(w.grid);
  w.terrain = defaultIsland({ seed: `${seed}:island`, city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  const I = new Island(w.terrain), T = w.terrain;
  w.roads = generateIslandRoads(I, w.grid);
  const avenues = q => [{ id: 'av-a', name: 'A', profile: 'avenue-4', pts: [{ x: um(q.x - 260), z: um(q.z) }, { x: um(q.x + 260), z: um(q.z) }] }, { id: 'av-b', name: 'B', profile: 'avenue-4', pts: [{ x: um(q.x), z: um(q.z - 260) }, { x: um(q.x), z: um(q.z + 260) }] }];
  for (let fx = -0.6; fx <= 0.6; fx += 0.1) for (let fz = -0.6; fz <= 0.6; fz += 0.1) {
    const q = { x: T.center.x + T.radius * fx, z: T.center.z + T.radius * fz };
    if ([[0, 0], [-260, 0], [260, 0], [0, -260], [0, 260]].some(([dx, dz]) => I.waterAt(q.x + dx, q.z + dz) || I.baseHeight(q.x + dx, q.z + dz) < T.seaLevel + 3)) continue;
    const trial = RoadNetwork.fromJSON([...w.roads, ...avenues(q)]);
    if (!trial.validate().length && trial.junctions().filter(j => j.arms.some(a => a.id.startsWith('av-')) && j.kind !== 'end').length === 1) { w.roads = [...w.roads, ...avenues(q)]; return { w, q }; }
  }
  return null;
}

test('walkers cross a signalled avenue junction at the crosswalk, on the walk light', () => {
  const got = crossingWorld('wp4-walk-junction');
  assert.ok(got, 'a place for the crossing');
  const { w, q } = got, nav = new Nav(w), W = nav.walk();
  const plan = [...W.plans.values()].find(p => p.arms.some(a => a.id === 'av-a') && p.arms.some(a => a.id === 'av-b'));
  assert.ok(plan?.signalized, 'the avenue crossing is signalled');
  // from the north side of avenue A's east arm to its south side, 60 m out: the way across is the crosswalk
  const off = plan.arms[0].sec.carriage + 2.5;
  const A = nav.walkAccess(q.x + 60, q.z + off), B = nav.walkAccess(q.x + 60, q.z - off);
  const r = nav.walkRoute(A, B, true);
  assert.ok(Number.isFinite(r.cost) && r.cost < 300, `a short walk (${r.cost.toFixed(0)} s)`);
  const k = r.pts.findIndex(p => p.jx === plan.key);
  assert.ok(k > 0, 'the route crosses at the junction, on its signal');
  assert.ok(r.pts[k].y < r.pts[k - 1].y - 0.15, 'stepping down off the sidewalk');
  const ground = new Island(w.terrain, { roads: w.roads });
  assert.ok(Math.abs(r.pts[k - 1].y - ground.height(r.pts[k - 1].x, r.pts[k - 1].z) - 0.225) < 0.05, 'walking on the raised sidewalk');
  // the plan: waits at the curb until the walk light, and is across before it ends
  const router = new Router(w, nav);
  for (const t0 of [1000, 1017, 1031, 1047]) {
    const P = new Plan(t0, { x: A.x, y: ground.height(A.x, A.z) + 0.225, z: A.z, ctx: -1 });
    router.walkStreet(P, A, B, { speed: 1.4, anim: 1, use: 1 });
    // find when the walker leaves the curb (the segment ending at the crossing's first road point)
    let t = P.base, start = null, end = null;
    for (const sg of P.segs) {
      const t1 = t + sg.dur;
      if (start === null && Math.abs(sg.x - r.pts[k].x) < 0.01 && Math.abs(sg.z - r.pts[k].z) < 0.01) start = t;
      if (start !== null && end === null && Math.abs(sg.x - r.pts[k + 1].x) < 0.01 && Math.abs(sg.z - r.pts[k + 1].z) < 0.01) end = t1;
      t = t1;
    }
    assert.ok(start !== null && end !== null, 'the crossing is in the plan');
    assert.equal(walkFor(plan, start + 0.01), 2, `starts on the walk light (from ${t0})`);
    assert.ok(walkFor(plan, end - 0.01) >= 1, 'across before the light turns to don\'t walk');
  }
});
