// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.5 residents beyond the city stop and chat as they do on the city's sidewalks: one idles by an island road, the
// other walks up (along the footpaths) and they talk; never meeting in the water.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { makeGrid } from '../shared/city.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { WorldIndex } from '../server/sim/windex.js';
import { generatePopulation } from '../server/sim/population.js';
import { Sim } from '../server/sim/sim.js';
import { Plan } from '../server/sim/plan.js';
import { CTX_OUT } from '../shared/proto.js';

test('two residents out on the island stop and chat', () => {
  const world = generateWorld({ seed: 'wp4-island-chat', population: 0 }), g = makeGrid(world.grid);
  world.terrain = defaultIsland({ seed: 'wp4-island-chat:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  world.roads = generateIslandRoads(new Island(world.terrain), world.grid);
  const index = new WorldIndex(world), people = generatePopulation(world, index, { population: 60, roster: [] });
  let T = 5000;
  const sim = new Sim(world, people, { index, budgetMs: 1e9, clock: { simBase: 0, realBase: 0, rate: 1, dayBase: 10 * 3600, dayScale: 16 } });
  sim.now = () => T;
  sim.start();
  const W = sim.nav.walk(), brain = sim.brain;
  // a footpath point well out of the city, and a spot 9 m along the footpath from it
  let n = -1; for (let k = 0; k < W.N; k += 5) if (Math.hypot(W.X[k], W.Z[k]) > 1500) { n = k; break; }
  assert.ok(n >= 0);
  const L = W.adj[n]; let m = L[0]; for (let k = 0; k < L.length; k += 2) if (Math.hypot(W.X[L[k]] - W.X[n], W.Z[L[k]] - W.Z[n]) < Math.hypot(W.X[m] - W.X[n], W.Z[m] - W.Z[n])) m = L[k];   // the next point along the same footpath
  const [a, o] = sim.agents.filter(x => !x.p.vip).slice(0, 2);
  for (const x of [a, o]) { brain.release(x); brain.leaveJoin(x); }
  o.plan = new Plan(T, { x: W.X[n], y: W.Y[n], z: W.Z[n], ctx: CTX_OUT });
  brain.lookAround(o, o.plan, brain.wm(30));
  // a few metres along the footpath, in the same 30 m neighbourhood (residents chat with someone in their own)
  const cell = (x, z) => `${Math.floor(x / 30)},${Math.floor(z / 30)}`, dl = Math.hypot(W.X[m] - W.X[n], W.Z[m] - W.Z[n]) || 1;
  let ax = W.X[n] + (W.X[m] - W.X[n]) / dl * 6, az = W.Z[n] + (W.Z[m] - W.Z[n]) / dl * 6;
  if (cell(ax, az) !== cell(W.X[n], W.Z[n])) { ax = W.X[n] - (W.X[m] - W.X[n]) / dl * 6; az = W.Z[n] - (W.Z[m] - W.Z[n]) / dl * 6; }
  a.plan = new Plan(T, { x: ax, y: W.Y[n], z: az, ctx: CTX_OUT });
  assert.equal(brain.chat(a, a.plan), true, 'they meet and talk');
  assert.equal(a.act.kind, 'chat'); assert.equal(o.act.kind, 'chat');
  assert.equal(a.chatWith, o.i);
  const island = new Island(world.terrain);
  assert.ok(!island.waterAt(a.plan.x, a.plan.z), 'on dry ground');
  assert.ok(Math.hypot(a.plan.x - W.X[n], a.plan.z - W.Z[n]) < 3, 'face to face');
});
