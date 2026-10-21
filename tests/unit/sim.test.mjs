// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A morning in a small city on a virtual clock: no errors, every resident keeps a finite plan, and a client decoding
// the snapshot puts every resident exactly where the server does.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Sim } from '../../server/sim/sim.js';
import { evalPlan } from '../../server/sim/plan.js';
import { decodePlans, evalDecoded } from '../../shared/proto.js';
import { testCity } from '../helpers/world.mjs';

test('six world hours run without errors and clients agree with the server', () => {
  const { world, people, index } = testCity({ seed: 'sim-test', population: 400 });
  const sim = new Sim(world, people, { index, budgetMs: 1e9 });
  let T = 0;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 6 * 3600, dayScale: 16 };
  sim.start();
  const end = 6 * 3600 / 16;
  while (T < end) {
    T += 0.5;
    sim.tick();
    sim.flush();
  }
  assert.equal(sim.errorCount, 0, JSON.stringify(sim.errors, null, 1));
  assert.ok(sim.stats.decisions > people.length, `${sim.stats.decisions} decisions`);
  for (const a of sim.agents) {
    assert.ok(a.plan && a.plan.t > T, `resident ${a.i} has a plan beyond now`);
    const e = evalPlan(a.plan, T);
    assert.ok([e.x, e.y, e.z].every(Number.isFinite), `resident ${a.i} has a finite position`);
  }
  const decoded = new Map();
  for (const buf of sim.snapshot()) decodePlans(buf, (i, p) => decoded.set(i, p));
  assert.equal(decoded.size, sim.agents.length);
  let worst = 0;
  for (const a of sim.agents) {
    const d = decoded.get(a.i);
    for (let t = T; t < T + 120; t += 0.5) {
      const s = evalPlan(a.plan, t), c = evalDecoded(d, t);
      worst = Math.max(worst, Math.abs(s.x - c.x), Math.abs(s.y - c.y), Math.abs(s.z - c.z));
    }
  }
  assert.ok(worst < 0.02, `largest client/server difference ${worst} m`);
});
