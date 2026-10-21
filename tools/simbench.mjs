// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Headless simulation benchmark with a virtual clock: node tools/simbench.mjs [population] [worldHours]
import { generateWorld } from '../server/world/generate.js';
import { generatePopulation } from '../server/sim/population.js';
import { WorldIndex } from '../server/sim/windex.js';
import { Sim } from '../server/sim/sim.js';
import { evalPlan } from '../server/sim/plan.js';
import { hourAt } from '../shared/constants.js';

const pop = +(process.argv[2] || 4000), hours = +(process.argv[3] || 30);
const t0 = performance.now();
const world = generateWorld({ seed: 'next-city', population: pop });
// 20 AI-agent residents with test identities (agents join through connections; DECISIONS C103).
const roster = Array.from({ length: 20 }, (_, k) => ({ agentId: `bench-agent-${k + 1}`, name: `Bench Agent ${k + 1}`, emoji: '🤖', role: 'Agent' }));
const people = generatePopulation(world, new WorldIndex(world), { population: pop, roster });
const sim = new Sim(world, people, { budgetMs: 1e9 });
let T = 0;
sim.now = () => T;
sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 5 * 3600, dayScale: 16 };
console.log('setup ms', Math.round(performance.now() - t0), 'people', people.length, 'vip', roster.length,
  'homeless', people.filter(p => !p.home).length, 'jobs', JSON.stringify(people.reduce((m, p) => (m[p.job.kind] = (m[p.job.kind] || 0) + 1, m), {})));
const w0 = performance.now(); sim.start(); console.log('warm ms', Math.round(performance.now() - w0));
const step = 0.5, simSecs = hours * 3600 / 16;
let maxTick = 0, decisions = 0, lastReport = 0, bytes = 0, plans = 0;
sim.listeners.add(b => { bytes += b.byteLength; });
const tRun = performance.now();
const stuckCheck = new Map();
while (T < simSecs) {
  T += step;
  const a = performance.now(); const before = sim.stats.decisions;
  sim.tick(); sim.flush();
  maxTick = Math.max(maxTick, performance.now() - a);
  decisions += sim.stats.decisions - before;
  if (T - lastReport >= 3600 * 2 / 16) {
    lastReport = T;
    const h = hourAt(sim.clock, T);
    const acts = {};
    let inside = 0, out = 0, under = 0, bad = 0;
    for (const ag of sim.agents) {
      const e = evalPlan(ag.plan, T);
      if (![e.x, e.y, e.z].every(Number.isFinite)) bad++;
      if (e.ctx === -2) under++; else if (e.ctx < 0) out++; else inside++;
      const k = ag.act ? ag.act.use : 'none'; acts[k] = (acts[k] || 0) + 1;
    }
    const top = Object.entries(acts).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => k + ':' + v).join(' ');
    console.log(`h=${h.toFixed(1).padStart(4)} dec/s=${(decisions / (3600 * 2 / 16)).toFixed(1)} in=${inside} out=${out} under=${under} bad=${bad} heap=${sim.heap.size} err=${sim.errorCount} | ${top}`);
    decisions = 0;
  }
}
const runMs = performance.now() - tRun;
console.log('ran', hours, 'world hours in', Math.round(runMs), 'ms; max tick ms', maxTick.toFixed(1), 'plans', sim.stats.plansSent, 'bytes', bytes, 'avg B/s(sim)', Math.round(bytes / simSecs));
console.log('errors', sim.errorCount, JSON.stringify(sim.errors.slice(0, 5), null, 1));
