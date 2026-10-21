#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Free Will under load (docs/features/FREE-WILL.md §8): a city of `population` residents, `fw` of them AI agents with Free
// Will, run in real time like the server does (a 100 ms main loop), with every question going through a real provider
// helper process to the mock decision service (its latency and failure rate are settings). Reports the main loop's
// cost with and without Free Will, the event loop's delay, what happened at the choice points, and memory.
// Usage: node tools/freewill-stress.mjs [--population 4000] [--fw 1000] [--seconds 120] [--rate 4] [--latency 250] [--fail 0.05]
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateWorld } from '../server/world/generate.js';
import { generatePopulation } from '../server/sim/population.js';
import { WorldIndex } from '../server/sim/windex.js';
import { Sim, realNow } from '../server/sim/sim.js';
import { openDb } from '../server/db.js';
import { Registry } from '../server/providers/registry.js';
import { ProviderHost } from '../server/providers/host.js';
import { EventBus } from '../server/providers/bus.js';
import { FreeWill } from '../server/free-will/free-will.js';
import { AgentLife } from '../server/agent-life/life.js';

const { values: o } = parseArgs({ options: {
  population: { type: 'string', default: '4000' }, fw: { type: 'string', default: '1000' }, seconds: { type: 'string', default: '120' },
  rate: { type: 'string', default: '4' }, latency: { type: 'string', default: '250' }, fail: { type: 'string', default: '0.05' },
  baseline: { type: 'string', default: '30' },
} });
const POP = +o.population, FW = +o.fw, SECS = +o.seconds, RATE = +o.rate, BASE = +o.baseline;

const stats = arr => { const s = [...arr].sort((a, b) => a - b), q = p => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0); return { n: s.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +(s.at(-1) || 0).toFixed(2) }; };
const mb = () => Math.round(process.memoryUsage().rss / 1048576);

const world = generateWorld({ seed: 'fw-stress', population: POP });
const roster = Array.from({ length: FW }, (_, k) => ({ agentId: `stress-${k + 1}`, name: `Stress Agent ${k + 1}`, emoji: '🤖', role: 'Tester' }));
const people = generatePopulation(world, new WorldIndex(world), { population: POP, roster });
const sim = new Sim(world, people);
sim.setRate(RATE);
sim.start();
console.log(`city: ${people.length} residents (${people.filter(p => p.vip).length} AI agents), clock ${RATE}×, warm ${sim.stats.warmMs} ms, rss ${mb()} MB`);

async function loop(seconds, fw) {
  const ticks = [], eld = monitorEventLoopDelay({ resolution: 10 });
  eld.enable();
  const t0 = Date.now(), d0 = sim.stats.decisions;
  await new Promise(resolve => {
    const id = setInterval(() => {
      const a = performance.now();
      try { sim.tick(); fw?.tick(); sim.flush(); } catch (e) { sim.noteError(e); }
      ticks.push(performance.now() - a);
      if (Date.now() - t0 >= seconds * 1000) { clearInterval(id); resolve(); }
    }, 100);
  });
  eld.disable();
  return { tickMs: stats(ticks), loopDelayMs: { p50: +(eld.percentile(50) / 1e6).toFixed(1), p99: +(eld.percentile(99) / 1e6).toFixed(1), max: +(eld.max / 1e6).toFixed(1) }, decisions: sim.stats.decisions - d0, errors: sim.errorCount };
}

// 1. the same city without Free Will, in the evening (free time: what Free Will is about)
sim.skipTo(17.5);
const base = await loop(BASE, null);
console.log('without Free Will:', JSON.stringify(base));

// 2. with Free Will on for every agent, through a real helper process and the mock decision service
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-fw-stress-'));
const dbs = openDb(dir);
const registry = new Registry({ allowTest: true });
const host = new ProviderHost({ adapters: [fileURLToPath(new URL('../server/providers/decisions-mock.js', import.meta.url))], bus: new EventBus({}), registry });
await host.start();
const records = people.filter(p => p.vip).map((p, k) => ({ id: k + 1, key: p.agentId, ownerId: null, enabled: true, name: p.name, role: p.role, bodyRef: `person:${p.id}` }));
const index = new Map(people.map((p, i) => [`person:${p.id}`, i]));
const agents = { list: () => records, get: id => records[Number(id) - 1] || null, listeners: new Set(), resolver: { resolveBody: ref => index.get(ref) ?? -1 } };
const connection = { id: 1, kind: 'decisions-mock', label: 'Mock', enabled: true, scope: 'installation', config: { latencyMs: +o.latency, failRate: +o.fail, behaviour: 'spread', priceInPerMTok: 0.1 } };
// every agent's life is recorded too (activity log, memories, relationships), and Free Will is told about it
const life = new AgentLife({ dbs, agents, sim: () => sim }).attach();
const flushMs = [];
const realFlush = life.flush.bind(life);
life.flush = () => { const a = performance.now(); realFlush(); flushMs.push(performance.now() - a); };
const fw = new FreeWill({
  context: id => life.contextFor(id), spontaneity: { get: id => life.traitsFor(id).spontaneity, set: () => {} },
  dbs, agents, registry, sim: () => sim, principalFor: () => ({ account: { id: 1 }, role: 'owner' }),
  connections: { list: () => [connection], get: () => connection, canUse: () => true },
  config: () => ({ enabled: true, defaultConnection: '1', dailyDecisions: 10_000_000, agentDailyDecisions: 100_000, keepDays: 7 }),
  decide: (c, request, timeoutMs) => host.call(c.kind, 'decide', { connectionId: '1', config: c.config, secrets: {}, request, timeoutMs }, { timeoutMs: timeoutMs + 1000 }),
}).attach();
for (const a of records) fw.q.put.run({ $w: dbs.worldId, $agent: a.id, $enabled: 1, $conn: null, $spont: 0.5, $at: Date.now(), $by: null });
fw.rebuild();
sim.skipTo(17.5);   // the next evening: every resident plans again, now with Free Will watching
let maxInFlight = 0;
const watch = setInterval(() => { maxInFlight = Math.max(maxInFlight, fw.inFlight); }, 20);
const rss0 = mb();
const t0 = realNow();
const withFw = await loop(SECS, fw);
clearInterval(watch);
await new Promise(r => setTimeout(r, 1500));   // the last answers settle
fw.flush(); life.flush();
const secs = realNow() - t0;
const count = t => dbs.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const byChoice = dbs.db.prepare(`SELECT choice, outcome, coalesce(reason, '') AS reason, COUNT(*) AS n FROM agent_decisions GROUP BY choice, outcome, reason ORDER BY choice, n DESC`).all()
  .reduce((m, r) => { const k = r.outcome === 'chosen' ? (r.reason ? `chosen (${r.reason})` : 'chosen') : r.reason; (m[r.choice] ||= {})[k] = r.n; return m; }, {});
const lifeReport = { activityRows: count('agent_activity'), memories: count('agent_memories'), relations: count('agent_relations'),
  writesPerSec: +((count('agent_activity') + count('agent_memories')) / secs).toFixed(1), flushMs: stats(flushMs),
  dbMb: +(fs.statSync(path.join(dir, 'next.db')).size / 1048576 + (fs.existsSync(path.join(dir, 'next.db-wal')) ? fs.statSync(path.join(dir, 'next.db-wal')).size / 1048576 : 0)).toFixed(1) };
const ov = fw.overview();
const rows = dbs.db.prepare('SELECT outcome, reason, COUNT(*) AS n FROM agent_decisions GROUP BY outcome, reason ORDER BY n DESC').all();
const paid = dbs.db.prepare('SELECT COUNT(*) AS n, SUM(input_tokens) AS tok, SUM(cost_micro) AS cost FROM agent_decisions WHERE input_tokens IS NOT NULL').get();
const kindOf = "substr(chosen, 1, instr(chosen || '@', '@') - 1)";
const byKind = Object.fromEntries(dbs.db.prepare(`SELECT ${kindOf} AS k, SUM(outcome = 'chosen') AS chosen, SUM(reason = 'could_not_do') AS failed, SUM(reason = 'not_possible') AS gone
  FROM agent_decisions WHERE chosen IS NOT NULL GROUP BY k ORDER BY k`).all().map(r => [r.k, { chosen: r.chosen, couldNotDo: r.failed, notPossible: r.gone }]));
console.log('with Free Will:', JSON.stringify(withFw));
const asked = ov.counts.asked, chosen = ov.counts.chosen;
const report = {
  activeAgents: ov.activeAgents, seconds: +secs.toFixed(1), requests: asked, requestsPerSec: +(asked / secs).toFixed(1), answered: ov.counts.answered,
  chosen, chosenShareOfAsked: +(chosen / Math.max(1, asked)).toFixed(3), routine: ov.counts.routine, routineMomentsNotAsked: ov.counts.skippedRoutine,
  latencyMs: ov.latencyMs, maxInFlight, reasons: ov.reasons, byKind, paidRows: paid.n, avgInputTokens: Math.round((paid.tok || 0) / Math.max(1, paid.n)),
  costUsd: +((paid.cost || 0) / 1e6).toFixed(4), rssMb: { before: rss0, after: mb() }, helper: host.status(),
  overheadTickP95Ms: +(withFw.tickMs.p95 - base.tickMs.p95).toFixed(2), life: lifeReport, byChoice,
};
console.log(JSON.stringify(report, null, 2));
fw.stop(); life.stop(); await host.stop(); dbs.close(); fs.rmSync(dir, { recursive: true, force: true });
const ok = withFw.errors === 0 && withFw.tickMs.p95 < 25 && report.chosenShareOfAsked > 0.8
  && (!planReport || (planReport.metered === planReport.asked && planReport.freeAccountsAsked === 0 && planReport.skippedByPlan > 0));
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
