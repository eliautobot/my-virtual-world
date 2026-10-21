// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Bridges for vehicles (the design review 2026-10-03: "vehicles can drive through the guard rails, and there's a drivable
// surface on either side of the bridges"): the vehicle physics' ground leaves the water open beside and under a bridge,
// the deck is solid along the road's grade, and its rails stop a car where the drawn rails stand.
import test from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { generateWorld } from '../server/world/generate.js';
import { makeGrid } from '../shared/city.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads, profileAt, FORMATION } from '../shared/island-roads.js';
import { pointAt } from '../shared/roads.js';
import { TerrainColliders } from '../shared/terrain-physics.js';

await RAPIER.init({});
const um = v => Math.round(v * 1e6);

function bridgeWorld() {
  const w = generateWorld({ seed: 'bridge-physics', nx: 3, nz: 3, population: 0 }), g = makeGrid(w.grid);
  w.terrain = defaultIsland({ seed: 'bridge-physics:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  w.roads = generateIslandRoads(new Island(w.terrain), w.grid);
  let I = new Island(w.terrain, { roads: w.roads });
  if (![...(I.roads?.spans?.values() || [])].length) {
    // no water crossed yet: a road straight over the first lake
    const L = I.lakes[0];
    w.roads = [...w.roads, { id: 'over-lake', name: 'Lake Bridge', profile: 'two-lane', pts: [{ x: um(L.x - L.r * 1.7), z: um(L.z) }, { x: um(L.x + L.r * 1.7), z: um(L.z) }] }];
    I = new Island(w.terrain, { roads: w.roads });
  }
  return { w, g, I };
}

test('a bridge is a solid deck with rails; the water beside it is open', () => {
  const { g, I } = bridgeWorld();
  const [id, spans] = [...I.roads.spans][0], [a, b] = spans[0], G = I.roads.net.geometry(id), prof = I.roads.prof.get(id), half = I.roads.half.get(id);
  const s = (a + b) / 2, m = pointAt(G, s, {}), deck = profileAt(prof, s) - FORMATION, nx = -m.dz, nz = m.dx;
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const T = new TerrainColliders(RAPIER, physics, I, { cityRect: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ } });
  T.update([{ x: m.x, z: m.z }]);
  physics.step();
  const down = (x, z) => { const hit = physics.castRay(new RAPIER.Ray({ x, y: deck + 30, z }, { x: 0, y: -1, z: 0 }), 200, true); return hit ? deck + 30 - hit.timeOfImpact : null; };
  // on the deck: its top, along the road's grade
  assert.ok(Math.abs(down(m.x, m.z) - deck) < 0.15, `the deck at ${deck.toFixed(2)} (hit ${down(m.x, m.z)?.toFixed(2)})`);
  // beside it (3 m past its edge, on both sides): nothing near the deck's height — the water is open
  for (const sd of [1, -1]) { const h = down(m.x + nx * sd * (half + 3), m.z + nz * sd * (half + 3)); assert.ok(h === null || h < deck - 1.5, `open beside the deck (${h?.toFixed(2)})`); }
  // across the deck at a car's height: the rail stops it before the edge
  const from = { x: m.x, y: deck + 0.6, z: m.z };
  for (const sd of [1, -1]) {
    const hit = physics.castRay(new RAPIER.Ray(from, { x: nx * sd, y: 0, z: nz * sd }), half + 5, true);
    assert.ok(hit && hit.timeOfImpact <= half + 0.1, `a rail at the edge (${hit?.timeOfImpact.toFixed(2)} of ${half.toFixed(2)} m)`);
  }
  // the graded ground the residents and the water use: the deck itself, and no ramp out over the water beside it
  assert.ok(Math.abs(I.height(m.x, m.z) - deck) < 0.2);
  assert.ok(I.height(m.x + nx * (half + 5), m.z + nz * (half + 5)) < deck - 1.5, 'no graded ground beside the deck');
});
