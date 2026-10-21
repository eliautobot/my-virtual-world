// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Where an island road leaves the city (2026-10-03: "the junction between the 4lane and the 2lane needs work"): the
// city draws its edge junction at street level out to the road's mouth past its edge; the road runs level with that
// paving from the junction's middle to beyond the mouth (its drawn surface, DRAW_LIFT above its profile, at exactly
// street level — no step where they meet), and the ground under the whole junction lies just below the paving (no
// grass showing through its corners).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { makeGrid } from '../shared/city.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads, profileAt, DRAW_LIFT, FORMATION } from '../shared/island-roads.js';
import { CITY_RETURN } from '../shared/city-roads.js';
import { pointAt, DEFAULT_ROAD_PROFILES } from '../shared/roads.js';
import { apronRects } from '../shared/city-edge.js';

const world = generateWorld({ seed: 'edge-junction', nx: 3, nz: 3 }), g = makeGrid(world.grid);
world.terrain = defaultIsland({ seed: 'edge-junction:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
world.roads = generateIslandRoads(new Island(world.terrain), world.grid);
const I = new Island(world.terrain, { roads: world.roads }), R = I.roads;
const inCity = p => p.x >= g.minX && p.x <= g.maxX && p.z >= g.minZ && p.z <= g.maxZ;

test('a road leaving the city runs level with its streets past the edge junction, the ground under it below the paving', () => {
  let exits = 0;
  for (const r of R.net.all()) {
    const G = R.net.geometry(r.id), prof = R.prof.get(r.id);
    for (const [s0, dir] of [[0, 1], [G.length, -1]]) {
      if (!inCity(pointAt(G, s0, {}))) continue;
      exits++;
      let t = 0; while (inCity(pointAt(G, s0 + dir * t, {}))) t += 1;
      // level with the city's streets (drawn surface at 0) from the junction to past its mouth (edge + curb return)
      for (let u = 0; u <= t + CITY_RETURN + 4; u += 1.5) assert.ok(Math.abs(profileAt(prof, s0 + dir * u) + DRAW_LIFT) < 1e-6, `${r.id} level at ${u.toFixed(1)} m`);
      // the ground under the junction, out to its corners either side, below the paving
      const pad = R.pads.find(P => P.kind === 'city' && P.road === r.id);
      assert.ok(pad, `${r.id} has the city's junction pad`);
      const q = pointAt(G, s0 + dir * (t + 5), {});
      for (const o of [-14, -8, 0, 8, 14]) {
        const x = q.x - q.dz * o, z = q.z + q.dx * o;
        assert.ok(I.height(x, z) <= -FORMATION + 1e-6, `${r.id}: ground ${o} m aside below the paving (${I.height(x, z).toFixed(3)})`);
      }
    }
  }
  assert.ok(exits >= 2, 'roads leave the city');
});

test('the drawn apron can leave the edge streets\' sidewalks open; walking and driving keep the whole apron', () => {
  const full = apronRects(g, world.roads), inset = apronRects(g, world.roads, { inset: 4 });
  assert.equal(full.length, inset.length);
  for (const r of inset) assert.ok(r.x1 <= g.minX - 4 + 1e-6 || r.x0 >= g.maxX + 4 - 1e-6 || r.z1 <= g.minZ - 4 + 1e-6 || r.z0 >= g.maxZ + 4 - 1e-6, 'clear of the 4 m next to the edge');
});

// 2026-10-06: an island's Beach Road started at Walnut St's curb, so 5th Ave & Walnut St never became a junction;
// and where the country roads meet the city the corners stepped and the sidewalk left gaps. (A city widened to the
// avenue, whose streets the road kit draws.)
const wide = (() => {
  const w = generateWorld({ seed: 'edge-junction-wide', nx: 3, nz: 3 });
  w.grid = { ...w.grid, road: 2 * DEFAULT_ROAD_PROFILES['avenue-4'].carriageHalf / 1e6 };
  const gw = makeGrid(w.grid);
  w.terrain = defaultIsland({ seed: 'edge-junction-wide:island', city: { x0: gw.minX, z0: gw.minZ, x1: gw.maxX, z1: gw.maxZ }, plainY: 0.1 });
  w.roads = generateIslandRoads(new Island(w.terrain), w.grid);
  return w;
})();
test('a road stopping short of an edge junction is carried on to its centre; one already there, or far off, stays', async () => {
  const { joinCityEdge, cityRoads, cityRoadSet } = await import('../shared/city-roads.js');
  const grid = wide.grid, lines = cityRoads(grid), av = lines.find(r => r.id === 'grid-a1'), bottom = lines.filter(r => /^grid-s/.test(r.id)).at(-1);
  const x = av.pts[0].x, ze = bottom.pts[0].z;
  const short = { id: 'beach', profile: 'country', name: 'Beach Road', pts: [{ x, z: ze + 10340000 }, { x, z: ze + 400000000 }] };
  const j = joinCityEdge(grid, short);
  assert.notEqual(j, short);
  assert.deepEqual(j.pts[0], { x, z: ze });
  assert.deepEqual(j.pts[1], short.pts[1]);
  const set = cityRoadSet(grid, [j]);
  assert.ok([...set.plans.values()].some(P => P.arms.some(A => A.id === 'beach') && P.arms.length === 4 && P.signalized), 'the junction has the road as its fourth arm');
  const there = { ...short, pts: [{ x, z: ze }, short.pts[1]] }, far = { ...short, pts: [{ x, z: ze + 40000000 }, short.pts[1]] };
  assert.equal(joinCityEdge(grid, there), there);
  assert.equal(joinCityEdge(grid, far), far);
  const inward = { ...short, pts: [{ x, z: ze + 10340000 }, { x, z: ze - 50000000 }] };   // heading into the city: not ours
  assert.equal(joinCityEdge(grid, inward), inward);
});

test('where a curbed road meets a country road the curb and sidewalk taper out round the corner and come down to the road', async () => {
  const { cityRoadSet } = await import('../shared/city-roads.js');
  const set = cityRoadSet(wide.grid, wide.roads);
  const plans = [...set.plans.values()].filter(P => P.arms.some(A => A.sec.raised) && P.arms.some(A => !A.sec.raised));
  assert.ok(plans.length, 'an edge junction with a country road');
  let mixed = 0;
  for (const P of plans) for (const c of P.corners) {
    const A = P.arms[c.i], B = P.arms[c.k];
    if (A.sec.raised === B.sec.raised) { assert.ok(c.rise.every(r => r === (A.sec.raised ? 1 : 0))); continue; }
    mixed++;
    const down = A.sec.raised ? c.rise.length - 1 : 0, up = A.sec.raised ? 0 : c.rise.length - 1;
    assert.equal(c.rise[down], 0, 'the curb is down at the country road');
    assert.equal(c.rise[up], 1, 'and up at the curbed road');
    // the sidewalk's outer edge never crosses to the road side of its inner edge (the notch)
    const [inner, outer] = c.bands.sidewalk, C = { x: P.x, z: P.z };
    for (let k = 0; k < inner.length; k++) {
      const di = Math.hypot(inner[k].x - c.curb[k].x, inner[k].z - c.curb[k].z), dout = Math.hypot(outer[k].x - c.curb[k].x, outer[k].z - c.curb[k].z);
      assert.ok(dout >= di - 1e-6, `sidewalk point ${k} lies beyond the curb`);
    }
    void C;
    assert.ok(c.bands.gravel, "the country road's gravel shoulder carries on round the corner");
  }
  assert.ok(mixed >= 2, `corners between a curbed and a country road (${mixed})`);
});
