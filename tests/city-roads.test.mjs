// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.1 compatibility layer: the city's streets as road records (shared/city-roads.js) go back to the grid exactly,
// carry the names the addresses use, and join the roads beyond the city in one network; a new road may not run along a
// city street or take a street's id, and the generated roads still pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { makeGrid, addressOf } from '../shared/city.js';
import { cityRoads, gridFromRoads, worldRoads, isCityRoad } from '../shared/city-roads.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { roadProblems, normalizeRoad } from '../server/world/road-rules.js';

const geo = g => ({ nx: g.nx, nz: g.nz, bw: g.bw, bd: g.bd, road: g.road });

test('city streets as road records: an exact round trip, the addresses\' names, one network', () => {
  for (const spec of [generateWorld({ seed: 'wp4-city-roads', population: 0 }).grid, { nx: 8, nz: 7, bw: 100.44, bd: 69.96, road: 14 }, { nx: 9, nz: 7, bw: 64, bd: 52, road: 14 }]) {
    const recs = cityRoads(spec), back = gridFromRoads(recs);
    assert.deepEqual(back, geo(spec), 'the grid comes back exactly');
    const a = makeGrid(spec), b = makeGrid(back);
    assert.deepEqual([a.X, a.Z, a.minX, a.maxZ], [b.X, b.Z, b.minX, b.maxZ], 'the same centrelines to the last bit');
    assert.equal(recs.length, spec.nx + 1 + spec.nz + 1);
    assert.ok(recs.every(r => isCityRoad(r.id)));
    // the names are the addresses' names
    const at = (i, j) => addressOf(a, a.X[i], a.Z[j]);
    assert.equal(at(2, 3), `${recs.find(r => r.id === 'grid-a2').name} & ${recs.find(r => r.id === 'grid-s3').name}`);
    // one network: every corner of the grid is a junction (crossings inside, T's on the edge, turns at the corners)
    const J = worldRoads({ grid: spec, roads: [] }).junctions(), kinds = k => J.filter(j => j.kind === k).length;
    assert.equal(kinds('X'), (spec.nx - 1) * (spec.nz - 1));
    assert.equal(kinds('T'), 2 * (spec.nx - 1) + 2 * (spec.nz - 1));
    assert.equal(kinds('turn'), 4);
  }
  const recs = cityRoads({ nx: 4, nz: 3, bw: 64, bd: 52, road: 14 });
  assert.throws(() => gridFromRoads(recs.filter(r => r.id !== 'grid-s1')), /every avenue and street/);
  const bent = structuredClone(recs); bent[1].pts[1].x += 1;
  assert.throws(() => gridFromRoads(bent), /straight grid line/);
  const shifted = structuredClone(recs); for (const p of shifted[2].pts) p.x += 1;
  assert.throws(() => gridFromRoads(shifted), /evenly spaced|edge to edge/);
});

test('road rules with the city streets: no running along one, no taking a street\'s id; the generated roads still pass', () => {
  const world = generateWorld({ seed: 'wp4-city-roads', nx: 4, nz: 3, population: 0 }), g = makeGrid(world.grid);
  world.terrain = defaultIsland({ seed: 'wp4-city-roads:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  world.roads = generateIslandRoads(new Island(world.terrain), world.grid);
  for (const r of world.roads) assert.deepEqual(roadProblems(world, r), [], `${r.name} still passes`);
  assert.match(normalizeRoad({ id: 'grid-s0', profile: 'country', pts: [{ x: 0, z: 0 }, { x: 1e8, z: 0 }] }).message, /city's streets/);
  const um = v => Math.round(v * 1e6);
  // alongside the north edge street, just outside the city: refused
  const along = { id: 'road-x', profile: 'country', name: 'Edge Lane', pts: [{ x: um(g.X[0] - 60), z: um(g.Z[0] - 12) }, { x: um(g.X[2]), z: um(g.Z[0] - 12) }] };
  assert.ok(roadProblems(world, along).some(p => /too close along/.test(p)), roadProblems(world, along).join('; '));
  // leaving the city square off an edge street, away from its corners: fine as far as the streets go
  const out = { id: 'road-y', profile: 'country', name: 'Out Lane', pts: [{ x: um((g.X[1] + g.X[2]) / 2), z: um(g.Z[0]) }, { x: um((g.X[1] + g.X[2]) / 2), z: um(g.Z[0] - 300) }] };
  assert.ok(!roadProblems(world, out).some(p => /too close|on top of|apart/.test(p)), roadProblems(world, out).join('; '));
});
