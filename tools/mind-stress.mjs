#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Mind under load (docs/features/FREE-WILL.md §8): a city of `population` residents, `mind` of them AI agents with a
// brain, run in real time like the server does (a 100 ms main loop, the Mind's own 1 s scheduler), with a brain that
// answers after `latency` ms (± half) and fails `fail` of the time. The world is put at dawn so every agent's day starts
// at once (the morning rush of plans), then at bedtime (the rush of reflections) — with the clock 4× its normal pace, so
// the rushes are 4× steeper than a real morning. Reports the main loop's cost with and
// without the Mind, the scheduler's own cost, the event loop's delay, how many agents planned and reflected and how fast,
// the most thoughts at once, memory and the database's growth.
// Usage: node tools/mind-stress.mjs [--population 4000] [--mind 1000] [--seconds 200] [--rate 4] [--latency 800] [--fail 0.05]
import { parseArgs } from 'node:util';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateWorld } from '../server/world/generate.js';
import { generatePopulation } from '../server/sim/population.js';
import { WorldIndex } from '../server/sim/windex.js';
import { Sim } from '../server/sim/sim.js';
import { openDb } from '../server/db.js';
import { AgentLife } from '../server/agent-life/life.js';
import { Mind } from '../server/mind/mind.js';

const { values: o } = parseArgs({ options: {
  population: { type: 'string', default: '4000' }, mind: { type: 'string', default: '1000' }, seconds: { type: 'string', default: '200' },
  rate: { type: 'string', default: '4' }, latency: { type: 'string', default: '800' }, fail: { type: 'string', default: '0.05' }, baseline: { type: 'string', default: '20' },
} });
const POP = +o.population, N = +o.mind, SECS = +o.seconds, RATE = +o.rate, LAT = +o.latency, FAIL = +o.fail, BASE = +o.baseline;
const stats = arr => { const s = [...arr].sort((a, b) => a - b), q = p => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0); return { n: s.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +(s.at(-1) || 0).toFixed(2) }; };
const mb = () => Math.round(process.memoryUsage().rss / 1048576);

const world = generateWorld({ seed: 'mind-stress', population: POP });
const roster = Array.from({ length: N }, (_, k) => ({ agentId: `mind-${k + 1}`, name: `Mind Agent ${k + 1}`, emoji: '🤖', role: 'Tester' }));
const people = generatePopulation(world, new WorldIndex(world), { population: POP, roster });
const sim = new Sim(world, people);
sim.setRate(RATE);
sim.start();
console.log(`city: ${people.length} residents (${people.filter(p => p.vip).length} AI agents), clock ${RATE}×, rss ${mb()} MB`);

async function loop(seconds) {
  const ticks = [], eld = monitorEventLoopDelay({ resolution: 10 });
  eld.enable();
  const t0 = Date.now();
  await new Promise(resolve => {
    const id = setInterval(() => {
      const a = performance.now();
      try { sim.tick(); sim.flush(); } catch (e) { sim.noteError(e); }
      ticks.push(performance.now() - a);
      if (Date.now() - t0 >= seconds * 1000) { clearInterval(id); resolve(); }
    }, 100);
  });
  eld.disable();
  return { tickMs: stats(ticks), loopDelayMs: { p50: +(eld.percentile(50) / 1e6).toFixed(1), p99: +(eld.percentile(99) / 1e6).toFixed(1), max: +(eld.max / 1e6).toFixed(1) }, errors: sim.errorCount };
}

// 1. the city without the Mind, at dawn
sim.skipTo(5.5);
const base = await loop(BASE);
console.log('without the Mind:', JSON.stringify(base));

// 2. every agent with a brain
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-mind-stress-'));
const dbs = openDb(dir);
const records = people.filter(p => p.vip).map((p, k) => ({ id: k + 1, key: p.agentId, ownerId: null, enabled: true, name: p.name, role: p.role, connectionId: 1, bodyRef: `person:${p.id}` }));
const index = new Map(people.map((p, i) => [`person:${p.id}`, i]));
const agents = { list: () => records, enabled: () => records, get: id => records[Number(id) - 1] || null, listeners: new Set(), resolver: { resolveBody: ref => index.get(ref) ?? -1 } };
const brain = { id: 1, kind: 'models', label: 'Fake brain', enabled: true, scope: 'installation', config: { provider: 'custom', model: 'fake', priceInPerMTok: 0.02, priceOutPerMTok: 1.3 } };
const life = new AgentLife({ dbs, agents, sim: () => sim }).attach();
let calls = 0, live = 0, maxLive = 0;
const complete = (c, req) => new Promise((resolve, reject) => {
  calls++; live++; maxLive = Math.max(maxLive, live);
  setTimeout(() => {
    live--;
    if (Math.random() < FAIL) return reject(Object.assign(new Error('fake failure'), { code: Math.random() < 0.5 ? 'timeout' : 'provider_error' }));
    const user = req.turns ? req.turns[0].text : req.user;   // (a thought is sent as its turns)
    const plan = /start of my day/.test(user), place = /PLACES [^:]*: \S+ «([^»]+)»/.exec(user)?.[1] || 'the park';
    const ans = plan ? { plans: [{ kind: 'want', text: `Lunch at ${place}` }, { kind: 'must', text: 'Call home' }], thought: 'Fine.' }
      : { memories: [{ term: 'short', text: 'A long day at work' }], thought: 'Tired.' };
    resolve({ text: JSON.stringify(ans), usage: { in: Math.round(user.length / 4), out: 60 }, costUsd: null, model: 'fake', ms: LAT });
  }, LAT * (0.5 + Math.random()));
});
const mind = new Mind({
  dbs, agents, life, sim: () => sim, complete, principalFor: () => ({ account: { id: 1 }, role: 'owner' }),
  connections: { get: () => brain, list: () => [brain], canUse: () => true }, registry: { implemented: () => true },
  config: () => ({ enabled: true, reflectConnection: '', agentDailyJobs: 1000, agentMonthlyUsd: 100, dailyUsd: 100000, keepDays: 30 }),
});
const mindTick = [];
const realTick = mind.tick.bind(mind);
mind.tick = () => { const a = performance.now(); realTick(); mindTick.push(performance.now() - a); };
mind.attach();
const rss0 = mb(), db0 = fs.statSync(path.join(dir, 'next.db')).size;
const t0 = Date.now();
const done = kind => dbs.db.prepare(`SELECT COUNT(DISTINCT agent_id) AS n FROM mind_jobs WHERE kind = ? AND status = 'ok'`).get(kind).n;
const watch = { plan: null, reflect: null };
const timer = setInterval(() => {
  if (watch.plan === null && done('plan') >= N * 0.95) watch.plan = (Date.now() - t0) / 1000;
  if (watch.reflectStart && watch.reflect === null && done('reflect') >= N * 0.95) watch.reflect = (Date.now() - watch.reflectStart) / 1000;
}, 250);
sim.skipTo(8.5);   // morning: everyone is up, and every agent's day starts at once
const morning = await loop(Math.round(SECS * 0.5));
sim.skipTo(23.4);  // bedtime
watch.reflectStart = Date.now();
const night = await loop(Math.round(SECS * 0.5));
clearInterval(timer);
await new Promise(r => setTimeout(r, LAT * 2));
mind.stop(); life.flush();
const rows = dbs.db.prepare('SELECT kind, status, COALESCE(error, \'\') AS error, COUNT(*) AS n FROM mind_jobs GROUP BY kind, status, error ORDER BY kind, n DESC').all();
const plans = dbs.db.prepare("SELECT COUNT(*) AS n FROM agent_intentions WHERE source = 'mind'").get().n;
const ov = mind.overview();
const report = {
  agents: N, seconds: +((Date.now() - t0) / 1000).toFixed(1), brainCalls: calls, callsPerSec: +(calls / ((Date.now() - t0) / 1000)).toFixed(1), maxAtOnce: maxLive,
  planned: done('plan'), reflected: done('reflect'), secondsTo95pctPlanned: watch.plan, secondsTo95pctReflected: watch.reflect, plansWritten: plans,
  thoughts: rows.map(r => `${r.kind}/${r.status}${r.error ? `(${r.error})` : ''}: ${r.n}`), latencyMs: ov.latency, costUsd: +(ov.today.cost / 1e6).toFixed(4),
  schedulerMs: stats(mindTick), tickMs: { morning: morning.tickMs, night: night.tickMs }, loopDelayMs: { morning: morning.loopDelayMs, night: night.loopDelayMs },
  overheadTickP95Ms: +(Math.max(morning.tickMs.p95, night.tickMs.p95) - base.tickMs.p95).toFixed(2), rssMb: { before: rss0, after: mb() },
  dbGrowthMb: +((fs.statSync(path.join(dir, 'next.db')).size - db0) / 1048576).toFixed(2), errors: morning.errors + night.errors,
};
console.log(JSON.stringify(report, null, 2));
life.stop(); dbs.close(); fs.rmSync(dir, { recursive: true, force: true });
const ok = report.errors === 0 && report.overheadTickP95Ms < 5 && report.schedulerMs.p95 < 10 && report.planned >= N * 0.95 && report.reflected >= N * 0.95;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
