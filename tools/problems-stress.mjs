#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Mind's problems and money under load (docs/features/FREE-WILL.md §11.11): a city of `population` residents, `agents`
// of them AI agents with a brain, on the real economy (ledger, businesses, households, agents' spending rules) and a
// database of their own, run in real time like the server does (a 100 ms main loop; the problems watcher and the Mind's
// scheduler on their own timers), with a brain that answers after `latency` ms (± half) and fails `fail` of the time.
//   1. the city alone (the main loop's cost without any of it)
//   2. every agent's money drained at once: the watcher opens a problem for each, and every Mind deals with it — looks at
//      the flats (none here), asks its owner for money (a payment request through the economy) — 3 model calls a thought
//   3. `chats` owners at once ask their agent three times for a coffee: menu → buy, through the agent's spending rules
//      (a daily limit that allows two): no agent may spend past its limit
//   4. meetings: agents start chatting with people all over the city (`meetings` a second) — the first with a brain of its
//      own says a line, an agent answers; each line is checked by a moderation service (5 % flagged) before its bubble:
//      no agent past mind.speechPerDay, speech never taking the last thoughts at once
//   5. the money given back: every problem resolves
// Reports the main loop's cost with and without, the watcher's and the scheduler's own cost, the event loop's delay, how
// fast problems opened, were thought about and resolved, the most thoughts at once, money moved, the ledger's health,
// memory and the database's growth.
// Usage: node tools/problems-stress.mjs [--population 4000] [--agents 1000] [--seconds 300] [--rate 4] [--latency 800]
//        [--fail 0.05] [--scan 15000] [--chats 300]
import { parseArgs } from 'node:util';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { generateWorld } from '../server/world/generate.js';
import { generatePopulation } from '../server/sim/population.js';
import { WorldIndex } from '../server/sim/windex.js';
import { Sim } from '../server/sim/sim.js';
import { AgentLife } from '../server/agent-life/life.js';
import { Mind, MAX_IN_FLIGHT } from '../server/mind/mind.js';
import { Problems } from '../server/mind/problems.js';
import { agentActions } from '../server/economy/index.js';
import { createMindMoney } from '../server/economy/mind-money.js';
import { subj } from '../server/economy/economy.js';
import { economyModel } from '../tests/helpers/econ-model.mjs';

const { values: o } = parseArgs({ options: {
  population: { type: 'string', default: '4000' }, agents: { type: 'string', default: '1000' }, seconds: { type: 'string', default: '300' },
  rate: { type: 'string', default: '4' }, latency: { type: 'string', default: '800' }, fail: { type: 'string', default: '0.05' },
  scan: { type: 'string', default: '15000' }, chats: { type: 'string', default: '300' }, baseline: { type: 'string', default: '20' }, meetings: { type: 'string', default: '40' },
} });
const MEET = +o.meetings;
const POP = +o.population, N = +o.agents, SECS = +o.seconds, RATE = +o.rate, LAT = +o.latency, FAIL = +o.fail, SCAN = +o.scan, CHATS = Math.min(+o.chats, N), BASE = +o.baseline;
const VC = n => n * 100;
const stats = arr => { const s = [...arr].sort((a, b) => a - b), q = p => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0); return { n: s.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +(s.at(-1) || 0).toFixed(2) }; };
const mb = () => Math.round(process.memoryUsage().rss / 1048576);
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---- the city and its economy
const world = generateWorld({ seed: 'problems-stress', population: POP });
const roster = Array.from({ length: N }, (_, k) => ({ agentId: `pa-${k + 1}`, name: `Agent ${k + 1}`, emoji: '🤖', role: 'Tester' }));
const people = generatePopulation(world, new WorldIndex(world), { population: POP, roster });
const sim = new Sim(world, people);
sim.setRate(RATE);
sim.start();
const OWNERS = 10;
const records = people.filter(p => p.vip).map((p, k) => ({ id: k + 1, key: p.agentId, ownerId: 1 + (k % OWNERS), enabled: true, name: p.name, emoji: '🤖', role: p.role, connectionId: 1, bodyRef: `person:${p.id}` }));
const byKey = new Map(records.map(r => [r.key, r])), bodyOf = new Map(people.map((p, i) => [`person:${p.id}`, i]));
const agents = { list: () => records, enabled: () => records, get: id => records[Number(id) - 1] || null, byKey: k => byKey.get(k) || null, byId: id => records[Number(id) - 1] || null,
  ownedBy: acc => records.filter(r => r.ownerId === acc), listeners: new Set(), resolver: { resolveBody: ref => bodyOf.get(ref) ?? -1 } };
const model = economyModel({ city: { world, people }, agents });
for (let id = 1; id <= OWNERS; id++) model.account(id, 'member', 0);
const { econ, dbs } = model, H = econ.parts.households;
console.log(`city: ${people.length} residents (${records.length} AI agents), clock ${RATE}×, rss ${mb()} MB`);

async function loop(seconds, until = null) {
  const ticks = [], eld = monitorEventLoopDelay({ resolution: 10 });
  eld.enable();
  const t0 = Date.now();
  await new Promise(resolve => {
    const id = setInterval(() => {
      const a = performance.now();
      try { sim.tick(); sim.flush(); } catch (e) { sim.noteError(e); }
      ticks.push(performance.now() - a);
      if (Date.now() - t0 >= seconds * 1000 || (until && until())) { clearInterval(id); resolve(); }
    }, 100);
  });
  eld.disable();
  return { seconds: +((Date.now() - t0) / 1000).toFixed(1), tickMs: stats(ticks), loopDelayMs: { p50: +(eld.percentile(50) / 1e6).toFixed(1), p99: +(eld.percentile(99) / 1e6).toFixed(1), max: +(eld.max / 1e6).toFixed(1) }, errors: sim.errorCount };
}

// 1. the city alone, late morning (everyone up)
sim.skipTo(10);
const base = await loop(BASE);
console.log('the city alone:', JSON.stringify(base));

// ---- the Mind, its problems watcher and its money, wired as the server wires them
const runAgentAction = agentActions(econ), money = createMindMoney(econ, runAgentAction);
const wallets = { money: p => ({ available: H.available(p), rentPerDay: H.rentOf(p) }) };
const life = new AgentLife({ dbs, agents, sim: () => sim }).attach();
const brain = { id: 1, kind: 'models', label: 'Fake brain', enabled: true, scope: 'installation', config: { provider: 'custom', model: 'fake', priceInPerMTok: 0.02, priceOutPerMTok: 1.3 } };
let calls = 0, live = 0, maxLive = 0, notes = 0, moderations = 0, bubbles = 0, warnings = 0;
const answer = turns => {
  const first = turns[0].text, last = turns.at(-1).text, n = turns.filter(t => t.role === 'user').length;
  const place = /(?:café|restaurant) «([^»]+)»/.exec(first)?.[1];
  if (/TASK: Something in my life/.test(first)) {
    if (n === 1) return { use: [{ tool: 'flats' }] };
    if (n === 2) return /none on offer/.test(last) ? { use: [{ tool: 'ask_owner', amount: 30, why: 'For my rent' }] } : { use: [{ tool: 'rent_flat', flat: 'F1' }] };
    return { plans: [{ kind: 'must', text: 'Cook at home this week' }], memories: [{ text: 'Had to ask for help with money' }], tell_owner: 'I asked you for 30 VC for my rent.', thought: 'Embarrassing, but sensible.' };
  }
  if (/JSON: \{"say"/.test(first)) return { say: n > 0 && Math.random() < 0.02 ? 'Find me at www.example.com' : 'Nice to see you!' };
  if (/NEW MESSAGE from/.test(first)) {
    if (n === 1) return place ? { use: [{ tool: 'menu', place }] } : { reply: 'Nothing near.' };
    if (n === 2) return { use: [{ tool: 'buy', place, items: [{ item: 'I1', n: 1 }] }] };
    return { reply: /done: bought/.test(last) ? 'Bought it.' : 'Couldn\'t.' };
  }
  return {};
};
const complete = (c, req) => new Promise((resolve, reject) => {
  calls++; live++; maxLive = Math.max(maxLive, live);
  setTimeout(() => {
    live--;
    if (Math.random() < FAIL) return reject(Object.assign(new Error('fake failure'), { code: Math.random() < 0.5 ? 'timeout' : 'provider_error' }));
    const turns = req.turns || [{ role: 'user', text: req.user }];
    resolve({ text: JSON.stringify(answer(turns)), usage: { in: Math.round(turns.reduce((s, t) => s + t.text.length, 0) / 4), out: 60 }, costUsd: null, model: 'fake', ms: LAT });
  }, LAT * (0.5 + Math.random()));
});
const problems = new Problems({ dbs, agents, sim: () => sim, life, money: () => money, wallets: () => wallets, notify: () => { notes++; }, scanMs: SCAN });
const mind = new Mind({
  dbs, agents, life, sim: () => sim, complete, principalFor: id => ({ account: { id: id ?? 1, login: `user${id ?? 1}` }, role: 'member' }), log: { warn: (...a) => { warnings++; if (warnings <= 3) console.warn(...a); } },
  econ: () => ({ money: wallets.money, price: (b, f, item) => { const biz = econ.parts.businesses.at(b, f); return biz ? econ.parts.businesses.priceOf(biz, item) : null; } }),
  money: () => money, problems, notify: () => { notes++; },
  moderate: (c, text) => new Promise(r => setTimeout(() => { moderations++; r({ flagged: Math.random() < 0.05, categories: [] }); }, 40 + Math.random() * 80)),
  say: () => { bubbles++; },
  connections: { get: () => brain, list: () => [brain], canUse: () => true }, registry: { implemented: () => true },
  config: () => ({ enabled: true, reflectConnection: '', agentDailyJobs: 1000, agentMonthlyUsd: 100, dailyUsd: 100000, keepDays: 30, speech: true, moderationConnection: '1', speechPerDay: 8 }),
});
// (their day is planned already: only problems to think about)
for (const r of records) { const i = life.byAgent.get(r.id); if (i !== undefined && sim.agents[i]) { const d = mind.dayOf(i).lifeDay; mind.save(r.id, { lastPlanDay: d, lastReflectDay: d - 1 }); } }
const scanMs = [], mindTick = [];
const realScan = problems.scan.bind(problems), realTick = mind.tick.bind(mind);
problems.scan = () => { const a = performance.now(); realScan(); scanMs.push(performance.now() - a); };
mind.tick = () => { const a = performance.now(); realTick(); mindTick.push(performance.now() - a); };

// 2. every agent's money drained at once (back to its owner, as an owner taking pocket money back)
const dbBytes = () => dbs.db.prepare('PRAGMA page_count').get().page_count * dbs.db.prepare('PRAGMA page_size').get().page_size;
const rss0 = mb(), db0 = dbBytes();
for (const r of records) {
  const w = econ.walletFor(subj('agent', r.id)), keep = VC(10), amt = w.balance - keep;
  if (amt > 0) econ.ledger.transfer(w.id, econ.walletFor(subj('account', r.ownerId)).id, amt, { kind: 'draw', actor: `account:${r.ownerId}`, memo: 'stress: taken back' });
  econ.parts.agents.setLimits({ id: r.ownerId }, r.id, { scopes: ['rent', 'pay', 'buy'], dailyCap: VC(200), approveAbove: VC(100) });
}
problems.attach(); mind.attach();
const t2 = Date.now();
const count = sql => dbs.db.prepare(sql).get().n;
const opened = () => count("SELECT COUNT(DISTINCT agent_id) AS n FROM agent_problems WHERE kind = 'money'");
const thought = () => count("SELECT COUNT(DISTINCT agent_id) AS n FROM mind_jobs WHERE kind = 'problem' AND status = 'ok'");
const mark = {};
const watch = setInterval(() => {
  if (!mark.opened && opened() >= N * 0.95) mark.opened = (Date.now() - t2) / 1000;
  if (!mark.thought && thought() >= N * 0.95) mark.thought = (Date.now() - t2) / 1000;
}, 250);
const rush = await loop(SECS, () => mark.thought && Date.now() - t2 > mark.thought * 1000 + 5000);
const requests = count("SELECT COUNT(*) AS n FROM econ_requests WHERE payee LIKE 'agent:%' AND status = 'open'");
console.log('problems rush:', JSON.stringify({ secondsTo95pctOpened: mark.opened, secondsTo95pctThought: mark.thought, ...rush }));

// 3. owners at once ask their agents for coffee, three times each; a daily limit that allows two
const chatters = records.slice(0, CHATS);
const prices = [];
for (const r of chatters) {
  econ.grant({ id: 1, login: 'stress' }, { to: { kind: 'agent', id: r.id }, amount: VC(60), memo: 'stress: for coffee' });
  econ.parts.agents.setLimits({ id: r.ownerId }, r.id, { dailyCap: econ.parts.agents.limitsOf(r.id).spent24h + VC(9), approveAbove: VC(100) });
}
const before = new Map(chatters.map(r => [r.id, econ.parts.agents.limitsOf(r.id).spent24h]));
const queue = [...chatters, ...chatters, ...chatters];   // (round after round: an agent's own chats one at a time, as its chat window sends them)
let chatOk = 0, chatFail = 0, bought = 0, refused = 0;
const t3 = Date.now();
const asks = (async () => {
  const running = new Set();
  for (const r of queue) {
    while (mind.inFlight >= MAX_IN_FLIGHT || mind.busy.has(r.id)) await wait(20);
    const p = mind.think(r, 'chat', { connection: brain, own: true }, { chat: { from: `user${r.ownerId}`, isOwner: true, knows: true, history: [], message: 'Could you get me a coffee?', accountId: r.ownerId } })
      .then(x => { chatOk++; for (const u of x.used) { if (u.tool === 'buy' && /^done/.test(u.text)) { bought++; prices.push(u.text); } if (u.tool === 'buy' && /daily limit/.test(u.text)) refused++; } }, () => { chatFail++; })
      .finally(() => running.delete(p));
    running.add(p);
    await wait(0);
  }
  await Promise.all(running);
})();
let chatsDone = false;
asks.then(() => { chatsDone = true; });
const chatPhase = await loop(SECS, () => chatsDone);
const overCap = chatters.filter(r => { const L = econ.parts.agents.limitsOf(r.id); return L.spent24h > L.dailyCap; }).length;
const spentChats = chatters.reduce((s, r) => s + econ.parts.agents.limitsOf(r.id).spent24h - before.get(r.id), 0);
console.log('chats:', JSON.stringify({ seconds: (Date.now() - t3) / 1000, chatOk, chatFail, bought, refusedByLimit: refused, overCap, ...chatPhase }));

// 4. meetings all over the city: who speaks, the moderation service, the limits
const speechBefore = { ...mind.speechStats }, whyNot = {};
const realSpeak = mind.speak.bind(mind);
mind.speak = async (a, sp) => { const v = await realSpeak(a, sp); if (v?.why) whyNot[v.why] = (whyNot[v.why] || 0) + 1; return v; };
let meetings = 0, maxAtOnceSpeaking = 0;
const meetTimer = setInterval(() => {
  for (let k = 0; k < MEET / 10; k++) {
    const r = records[Math.floor(Math.random() * records.length)], other = people[Math.floor(Math.random() * people.length)];
    if (!other || other.retired || other.id === people[life.byAgent.get(r.id)]?.id) continue;
    meetings++; mind.onMet(r.id, { p: other });
  }
  maxAtOnceSpeaking = Math.max(maxAtOnceSpeaking, mind.inFlight);
}, 100);
const meetPhase = await loop(60);
clearInterval(meetTimer);
await wait(2000);
const perAgent = new Map();
for (const [k, n] of mind.speechDay) { const id = k.split(':')[0]; perAgent.set(id, Math.max(perAgent.get(id) || 0, n)); }
const speech = { meetings, linesTried: [...mind.speechDay.values()].reduce((a, b) => a + b, 0), moderations, bubbles, shown: mind.speechStats.shown - speechBefore.shown, blocked: mind.speechStats.blocked - speechBefore.blocked,
  local: mind.speechStats.local - speechBefore.local, unchecked: mind.speechStats.unchecked - speechBefore.unchecked, mostLinesOneAgent: Math.max(0, ...perAgent.values()), maxThoughtsAtOnce: maxAtOnceSpeaking, whyNot };
console.log('meetings:', JSON.stringify({ ...speech, tickMs: meetPhase.tickMs, loopDelayMs: meetPhase.loopDelayMs }));

// 5. the money given back: every problem resolves
for (const r of records) econ.grant({ id: 1, login: 'stress' }, { to: { kind: 'agent', id: r.id }, amount: VC(400), memo: 'stress: money back' });
const t4 = Date.now(), stillOpen = () => count("SELECT COUNT(*) AS n FROM agent_problems WHERE status = 'open'");
const calm = await loop(Math.max(60, SCAN * 4 / 1000), () => stillOpen() <= N * 0.05);
const resolvedIn = (Date.now() - t4) / 1000;
clearInterval(watch);
await wait(LAT * 2);
mind.stop(); problems.stop(); life.flush();

const rows = dbs.db.prepare("SELECT kind, status, COALESCE(error, '') AS error, COUNT(*) AS n FROM mind_jobs GROUP BY kind, status, error ORDER BY kind, n DESC").all();
const health = econ.health();
const report = {
  agents: N, brainCalls: calls, maxAtOnce: maxLive, notesToOwners: notes,
  problems: { opened: opened(), secondsTo95pctOpened: mark.opened, thoughtAbout: thought(), secondsTo95pctThought: mark.thought, moneyRequestsFiled: requests,
    stillOpenAfterMoneyBack: stillOpen(), secondsToResolve95pct: +resolvedIn.toFixed(1) },
  chats: { asked: queue.length, ok: chatOk, failed: chatFail, coffeesBought: bought, refusedByDailyLimit: refused, agentsOverTheirLimit: overCap, spentVc: spentChats / 100 },
  speech,
  thoughts: rows.map(r => `${r.kind}/${r.status}${r.error ? `(${r.error})` : ''}: ${r.n}`),
  watcherScanMs: stats(scanMs), schedulerMs: stats(mindTick),
  tickMs: { alone: base.tickMs, rush: rush.tickMs, chats: chatPhase.tickMs, meetings: meetPhase.tickMs, after: calm.tickMs }, loopDelayMs: { rush: rush.loopDelayMs, chats: chatPhase.loopDelayMs, meetings: meetPhase.loopDelayMs },
  overheadTickP95Ms: +(Math.max(rush.tickMs.p95, chatPhase.tickMs.p95, meetPhase.tickMs.p95, calm.tickMs.p95) - base.tickMs.p95).toFixed(2),
  ledger: { ok: health.ok, problems: health.problems }, rssMb: { before: rss0, after: mb() },
  dbGrowthMb: +((dbBytes() - db0) / 1048576).toFixed(2),
  errors: rush.errors + chatPhase.errors + meetPhase.errors + calm.errors, mindWarnings: warnings,
};
console.log(JSON.stringify(report, null, 2));
life.stop(); model.close();
const ok = report.errors === 0 && warnings === 0 && report.overheadTickP95Ms < 5 && report.watcherScanMs.p95 < 60 && report.schedulerMs.p95 < 10 && health.ok
  && report.problems.thoughtAbout >= N * 0.95 && report.chats.agentsOverTheirLimit === 0 && report.problems.stillOpenAfterMoneyBack <= N * 0.05
  && speech.mostLinesOneAgent <= 8 && speech.maxThoughtsAtOnce <= MAX_IN_FLIGHT && speech.shown > 0 && speech.bubbles === speech.shown;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
