#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Simulation health on a virtual clock. Runs the real simulation code (server/sim) much faster than real time, inside
// this process, and reports how well the residents get through their day. It never touches a running server.
// Usage: node tools/simhealth.mjs [--data <data folder> | --seed <seed> --population <n>]
//                                 [--hours 24] [--start 6] [--step 0.1] [--budget 25] [--json <out.json>]
//   --data    a server's data folder (world.json + people.json are only read)   --start   world hour to start (a Monday)
//   --step    sim seconds per tick (the server ticks every 0.1 s)               --budget  ms of decisions per tick (server: 25)
// Metrics (1 sim second = 1 real second at speed 1 = 16 world seconds):
//   decisions      planning decisions; idleFallbacks = decisions that found nothing to do and idled a few minutes
//                  (agents.js decide: "P.t - t0 < 1", or choose() threw)
//   errors         exceptions caught by the simulation (sim.noteError)
//   trips          every travel leg (Router.travel). Success = a real route: no teleport and no straight-line indoor
//                  fallback (squeezing out of a pocket beside a bed counts as a success and is counted separately).
//                  Travel time is from leaving to arriving, in world minutes, by mode (walk/subway/indoor)
//   paths          indoor A* searches (cache misses). When A* finds none, Nav.detour squeezes into or out of a pocket
//                  over a short straight stretch; a straight line through walls is the last resort
//   unreachable    beds and work places residents cannot walk to (after Nav.approach). raw = approach points that lie
//                  in a pocket or behind a wall, which Nav.approach moves to the nearest reachable spot
//   stuck          at 10-world-minute samples: plans that ran out (expired), non-finite positions, and residents who
//                  only idled for more than 3 world hours in a row
//   tickMs         wall time of each tick + flush (what the server does every 100 ms); lagMax = furthest behind (sim s)
//   plans          motion-plan traffic per connected client at speed 1
// Exit code 1 when the simulation threw errors, produced non-finite positions, left a home or job unreachable, or
// walked a straight line through walls.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generateWorld } from '../server/world/generate.js';
import { generatePopulation, validatePerson, reassign } from '../server/sim/population.js';
import { WorldIndex } from '../server/sim/windex.js';
import { Sim } from '../server/sim/sim.js';
import { evalPlan } from '../server/sim/plan.js';
import { RNG } from '../shared/rng.js';
import { hourAt, dayAt, mod, WEEKDAYS, formatClock } from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let o;
try {
  ({ values: o } = parseArgs({ options: {
    data: { type: 'string' }, seed: { type: 'string', default: 'next-city' }, population: { type: 'string', default: '4000' },
    hours: { type: 'string', default: '24' }, start: { type: 'string', default: '6' }, step: { type: 'string', default: '0.1' },
    budget: { type: 'string', default: '25' }, json: { type: 'string' },
  } }));
} catch (e) { console.error(e.message); process.exit(2); }
const HOURS = +o.hours, START = +o.start, STEP = +o.step, BUDGET = +o.budget, DAY_SCALE = 16;
if (!(HOURS > 0) || !(STEP > 0) || !(BUDGET > 0) || !(START >= 0 && START < 24)) {
  console.error('usage: node tools/simhealth.mjs [--data <folder> | --seed <s> --population <n>] [--hours h] [--start h] [--step s] [--budget ms] [--json out]');
  process.exit(2);
}
const wmin = simSecs => simSecs * DAY_SCALE / 60;
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const pct = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1)))] : 0);
const stats = arr => {
  const s = Float64Array.from(arr).sort();
  let sum = 0; for (const v of s) sum += v;
  return { n: s.length, mean: r1(s.length ? sum / s.length : 0), p50: r1(pct(s, 0.5)), p95: r1(pct(s, 0.95)), max: r1(s.length ? s[s.length - 1] : 0) };
};

// ------------------------------------------------------------------ world
const t0 = performance.now();
let world, people, source;
const loadNotes = {};
if (o.data) {
  const read = f => JSON.parse(fs.readFileSync(path.join(o.data, f), 'utf8'));
  world = read('world.json');
  people = read('people.json');
  if (world.format !== 1 || !Array.isArray(world.buildings) || !Array.isArray(people)) {
    console.error(`${o.data}: not a format-1 world with residents`);
    process.exit(2);
  }
  source = { data: path.resolve(o.data) };
} else {
  world = generateWorld({ seed: o.seed, population: +o.population });
  source = { seed: o.seed, population: +o.population };
}
const index = new WorldIndex(world);
if (o.data) {    // what the server does at start-up: repair invalid homes and jobs, then re-home and re-hire
  loadNotes.invalidOnLoad = people.filter(p => validatePerson(world, index, p)).length;
  loadNotes.reassigned = reassign(world, index, people, new RNG('simhealth')).changed.length;
} else {
  people = generatePopulation(world, index, { population: +o.population, roster: [] });
}
const clock = { simBase: 0, realBase: 0, rate: 1, dayBase: START * 3600, dayScale: DAY_SCALE };   // day 0 is a Monday
const sim = new Sim(world, people, { index, budgetMs: BUDGET, clock });
let T = 0;
sim.now = () => T;
const setupMs = performance.now() - t0;
const brain = sim.brain, router = sim.router, nav = sim.nav;

// ------------------------------------------------------------------ static check: can every bed and work place be reached?
const unreachable = { homes: 0, jobs: 0, rawHomes: 0, rawJobs: 0, moved: 0, places: new Map() };
const place = (b, f) => `${world.buildings[b]?.name || 'building ' + b}, floor ${f + 1}`;
function checkSlot(kind, b, f, id, k) {
  const B = world.buildings[b];
  const e = B && !B.gone && f >= 0 && f < B.floors ? index.entry(b, f, id) : null, s = e && e.slots[k];
  let raw = false, ok = false;
  if (s) {
    const lv = B.lv[f], ap = nav.approach(lv, s);
    raw = nav.isReachable(lv, s.ax, s.az) && !nav.crossesWall(lv, s.lx, s.lz, s.ax, s.az);
    ok = nav.isReachable(lv, ap.x, ap.z);
    if (ap.x !== s.ax || ap.z !== s.az) unreachable.moved++;
  }
  if (!raw) unreachable[kind === 'homes' ? 'rawHomes' : 'rawJobs']++;
  if (!ok) {
    unreachable[kind]++;
    const key = place(b, f); unreachable.places.set(key, (unreachable.places.get(key) || 0) + 1);
  }
}
for (const p of people) {
  if (p.home) checkSlot('homes', p.home.b, p.home.f, p.home.bed[0], p.home.bed[1]);
  const j = p.job;
  if (j && j.b !== undefined && j.id !== undefined) checkSlot('jobs', j.b, j.f, j.id, j.k);
}

// ------------------------------------------------------------------ instrumentation (wraps instance methods only)
let recording = false, decisions = 0, idleFallbacks = 0, straightUses = 0, detourUses = 0;
const idleSince = new Float64Array(sim.agents.length).fill(-1);
const failedLevels = new Map();
const trips = { calls: 0, ok: 0, tele: 0, straightLine: 0, detours: 0, modes: {}, minutes: {} };

brain.choose = (choose => (a, P) => {
  const tStart = Math.max(a.plan ? a.plan.t : T, T);   // decide(): t0 = max(end of the old plan, now)
  let threw = true;
  try {
    const r = choose(a, P);
    threw = false;
    return r;
  } finally {
    if (recording) {
      decisions++;
      if (threw || P.t - tStart < 1) { idleFallbacks++; if (idleSince[a.i] < 0) idleSince[a.i] = T; } else idleSince[a.i] = -1;
    }
  }
})(brain.choose.bind(brain));

router.travel = (travel => (P, dest, opt) => {
  const straight0 = straightUses, detour0 = detourUses, leave = P.t;
  const mode = travel(P, dest, opt);
  if (recording) {
    trips.calls++;
    trips.modes[mode] = (trips.modes[mode] || 0) + 1;
    if (mode === 'tele') trips.tele++;
    else if (straightUses > straight0) trips.straightLine++;
    else { trips.ok++; if (detourUses > detour0) trips.detours++; }
    if (mode !== 'tele') (trips.minutes[mode] ||= []).push(wmin(P.t - leave));
  }
  return mode;
})(router.travel.bind(router));

nav.path = (path => (lv, sx, sz, ex, ez) => {   // Nav.path marks detours (pts.detour) and straight lines (pts.straight)
  const pts = path(lv, sx, sz, ex, ez);
  if (recording) {
    if (pts.straight) { straightUses++; failedLevels.set(lv, (failedLevels.get(lv) || 0) + 1); }
    else if (pts.detour !== undefined) detourUses++;
  }
  return pts;
})(nav.path.bind(nav));

// ------------------------------------------------------------------ run
const warm0 = performance.now();
sim.start();
const warmMs = performance.now() - warm0;
sim.flush();                              // the first flush sends every plan once, like a new client's snapshot
let bytes = 0;
sim.listeners.add(b => { bytes += b.byteLength; });
const plans0 = sim.stats.plansSent;
const nav0 = { ...nav.stats };
recording = true;

const END = HOURS * 3600 / DAY_SCALE, SAMPLE = 600 / DAY_SCALE, REPORT = 2 * 3600 / DAY_SCALE;
const tickMs = new Float64Array(Math.ceil(END / STEP) + 4);
let nt = 0, lagMax = 0, nextSample = SAMPLE, nextReport = REPORT, last = { inside: 0, out: 0, under: 0, moving: 0 };
const stuck = { expiredMax: 0, expiredSamples: 0, badPositions: 0, longIdle: new Set() };
const hourly = [];
let rep = { d: 0, f: 0, e: 0 };

function sample() {
  let expired = 0, bad = 0;
  const c = { inside: 0, out: 0, under: 0, moving: 0 };
  for (const ag of sim.agents) {
    const P = ag.plan;
    if (!P) { expired++; continue; }
    if (P.t < T) expired++;
    const e = evalPlan(P, T);
    if (!(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.z))) bad++;
    if (e.ctx === -2) c.under++; else if (e.ctx < 0) c.out++; else c.inside++;
    if (e.s && !e.s.h) c.moving++;
    if (idleSince[ag.i] >= 0 && wmin(T - idleSince[ag.i]) > 180) stuck.longIdle.add(ag.i);
  }
  if (expired) stuck.expiredSamples++;
  stuck.expiredMax = Math.max(stuck.expiredMax, expired);
  stuck.badPositions = Math.max(stuck.badPositions, bad);
  last = c;
}
function report() {
  const h = hourAt(sim.clock, T), day = WEEKDAYS[mod(dayAt(sim.clock, T), 7)];
  const acts = {};
  for (const ag of sim.agents) { const k = ag.act ? ag.act.use : 'none'; acts[k] = (acts[k] || 0) + 1; }
  const top = Object.entries(acts).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(' ');
  const row = { at: `${day} ${formatClock(h)}`, decisions: decisions - rep.d, idleFallbacks: idleFallbacks - rep.f, errors: sim.errorCount - rep.e, ...last, top };
  hourly.push(row);
  console.log(`${row.at.padEnd(12)} decisions ${String(row.decisions).padStart(5)}  idle ${String(row.idleFallbacks).padStart(4)}  errors ${row.errors}  in ${last.inside} out ${last.out} under ${last.under} moving ${last.moving} | ${top}`);
  rep = { d: decisions, f: idleFallbacks, e: sim.errorCount };
}

const run0 = performance.now();
while (T < END - 1e-9) {
  T += STEP;
  const a0 = performance.now();
  sim.tick();
  sim.flush();
  if (nt < tickMs.length) tickMs[nt++] = performance.now() - a0;
  if (sim.stats.lag > lagMax) lagMax = sim.stats.lag;
  if (T >= nextSample - 1e-9) { nextSample += SAMPLE; sample(); }
  if (T >= nextReport - 1e-9) { nextReport += REPORT; report(); }
}
const runMs = performance.now() - run0;

// ------------------------------------------------------------------ summary
let commit = null;
try {
  const git = args => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).toString().trim();
  commit = git(['rev-parse', '--short', 'HEAD']) + (git(['status', '--porcelain', '--untracked-files=no']) ? '-dirty' : '');
} catch { /* not a git checkout */ }
const tk = Float64Array.from(tickMs.subarray(0, nt)).sort();
let tickSum = 0; for (const v of tk) tickSum += v;
const street = [...(trips.minutes.walk || []), ...(trips.minutes.subway || [])];
const mem = process.memoryUsage();
const summary = {
  tool: 'simhealth', at: new Date().toISOString(), commit, node: process.version, source,
  params: { hours: HOURS, start: START, step: STEP, budgetMs: BUDGET, dayScale: DAY_SCALE },
  world: { buildings: world.buildings.filter(b => b && !b.gone).length, residents: people.length, agents: people.filter(p => p.vip).length, ...loadNotes },
  setupMs: Math.round(setupMs), warmMs: Math.round(warmMs), runMs: Math.round(runMs), speedup: Math.round(END * 1000 / runMs),
  decisions, decisionsPerWorldHour: Math.round(decisions / HOURS), idleFallbacks, idleFallbackPct: r2(decisions ? 100 * idleFallbacks / decisions : 0),
  errors: sim.errorCount, errorSamples: sim.errors.slice(0, 5),
  trips: {
    total: trips.calls, ok: trips.ok, successPct: r2(trips.calls ? 100 * trips.ok / trips.calls : 100), teleports: trips.tele,
    straightLine: trips.straightLine, detours: trips.detours, modes: trips.modes, streetMinutes: stats(street),
    walkMinutes: stats(trips.minutes.walk || []), subwayMinutes: stats(trips.minutes.subway || []), indoorMinutes: stats(trips.minutes.indoor || []),
  },
  paths: {
    searches: nav.stats.searches - nav0.searches, failed: nav.stats.failed - nav0.failed, detours: nav.stats.detours - nav0.detours,
    straight: nav.stats.straight - nav0.straight, floorsWithStraight: failedLevels.size, detourUses, straightUses,
  },
  unreachable: {
    homes: unreachable.homes, jobs: unreachable.jobs, rawHomes: unreachable.rawHomes, rawJobs: unreachable.rawJobs, moved: unreachable.moved,
    places: [...unreachable.places].sort((a, b) => b[1] - a[1]).slice(0, 10),
  },
  stuck: { expiredMax: stuck.expiredMax, expiredSamples: stuck.expiredSamples, badPositions: stuck.badPositions, longIdle: stuck.longIdle.size },
  tickMs: { ticks: nt, mean: r2(nt ? tickSum / nt : 0), p50: r2(pct(tk, 0.5)), p95: r2(pct(tk, 0.95)), p99: r2(pct(tk, 0.99)), max: r2(nt ? tk[nt - 1] : 0) },
  lagMaxSec: r2(lagMax),
  plans: { sent: sim.stats.plansSent - plans0, perSec: r1((sim.stats.plansSent - plans0) / END), bytesPerSec: Math.round(bytes / END) },
  memoryMB: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
  hourly,
};
const S = summary;
console.log('');
console.log(`world      ${S.world.buildings} buildings, ${S.world.residents} residents (${S.world.agents} agents)${o.data ? `; at load: ${S.world.invalidOnLoad} invalid, ${S.world.reassigned} re-homed/re-hired` : ''}`);
console.log(`run        ${HOURS} world hours from ${formatClock(START)} Monday in ${(runMs / 1000).toFixed(1)} s (${S.speedup}x real time); setup ${S.setupMs} ms, warm ${S.warmMs} ms`);
console.log(`decisions  ${S.decisions} (${S.decisionsPerWorldHour}/world hour); idle fallbacks ${S.idleFallbacks} (${S.idleFallbackPct} %); errors ${S.errors}`);
console.log(`trips      ${S.trips.total}, success ${S.trips.successPct} % (teleports ${S.trips.teleports}, straight-line ${S.trips.straightLine}, squeezed out of a pocket ${S.trips.detours}); modes ${JSON.stringify(S.trips.modes)}`);
console.log(`           street trip minutes mean ${S.trips.streetMinutes.mean}, p50 ${S.trips.streetMinutes.p50}, p95 ${S.trips.streetMinutes.p95}, max ${S.trips.streetMinutes.max}`);
console.log(`paths      ${S.paths.searches} indoor searches; A* found none for ${S.paths.failed}: ${S.paths.detours} pocket squeezes, ${S.paths.straight} straight lines (${S.paths.floorsWithStraight} floors); straight lines walked ${S.paths.straightUses} times`);
console.log(`unreachable homes ${S.unreachable.homes}, jobs ${S.unreachable.jobs}; approach points in a pocket or behind a wall: homes ${S.unreachable.rawHomes}, jobs ${S.unreachable.rawJobs} (moved ${S.unreachable.moved})${S.unreachable.places.length ? ' — ' + S.unreachable.places.map(([k, v]) => `${k} (${v})`).join('; ') : ''}`);
console.log(`stuck      expired plans max ${S.stuck.expiredMax} (in ${S.stuck.expiredSamples} samples), bad positions ${S.stuck.badPositions}, idle > 3 h ${S.stuck.longIdle}`);
console.log(`tick ms    mean ${S.tickMs.mean}, p50 ${S.tickMs.p50}, p95 ${S.tickMs.p95}, p99 ${S.tickMs.p99}, max ${S.tickMs.max} (${S.tickMs.ticks} ticks, budget ${BUDGET} ms); lag max ${S.lagMaxSec} s`);
console.log(`plans      ${S.plans.perSec}/s, ${S.plans.bytesPerSec} B/s per client; memory rss ${S.memoryMB.rss} MB`);
if (S.errors) console.log('errors:', JSON.stringify(S.errorSamples, null, 1));
if (o.json) {
  fs.mkdirSync(path.dirname(path.resolve(o.json)), { recursive: true });
  fs.writeFileSync(o.json, JSON.stringify(summary, null, 2) + '\n');
  console.log(`saved ${o.json}`);
}
process.exit(S.errors || S.stuck.badPositions || S.unreachable.homes || S.unreachable.jobs || S.paths.straightUses ? 1 : 0);
