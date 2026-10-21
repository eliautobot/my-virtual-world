// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Free Will in the simulation (docs/features/FREE-WILL.md §2, §12): the options are the routine's own and real places,
// questions go out ahead of the choice point, answers are used only for their own plan and only when still possible,
// every failure falls back to the routine with its reason logged, spending stops at the limits, a failing service is
// paused, and a simulation with Free Will attached but nobody using it behaves exactly as one without it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { generateWorld } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { openDb } from '../../server/db.js';
import { FreeWill } from '../../server/free-will/free-will.js';
import { buildOptions, stillPossible, MAX_OPTIONS } from '../../server/free-will/options.js';
import { decisionRequest, snapshotText } from '../../server/free-will/prompt.js';
import { drawChoice, temperature } from '../../server/free-will/sampling.js';
import mockDecisions from '../../server/providers/decisions-mock.js';
import { tempDir } from '../helpers/server.mjs';

const AGENTS = 16;

function city({ pop = 500, seed = 'fw-unit' } = {}) {
  const world = generateWorld({ seed, population: pop });
  const roster = Array.from({ length: AGENTS }, (_, k) => ({ agentId: `fw-agent-${k + 1}`, name: `Agent ${k + 1}`, emoji: '🤖', role: 'Tester' }));
  const people = generatePopulation(world, new WorldIndex(world), { population: pop, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 6 * 3600, dayScale: 16 };
  return { world, people, sim, advance: dt => { T += dt; }, t: () => T };
}

/** Free Will on a test city, with the parts it talks to reduced to what it uses. */
function harness(c, { decide, cfg = {}, conn = {} } = {}) {
  const dir = tempDir('mvw-fw-');
  const dbs = openDb(dir);
  const records = c.people.filter(p => p.vip).map((p, k) => ({ id: k + 1, key: p.agentId, ownerId: null, enabled: true, name: p.name, role: p.role, emoji: '', bodyRef: `person:${p.id}` }));
  const agents = {
    list: () => records, get: id => records.find(a => a.id === Number(id)) || null, listeners: new Set(),
    resolver: { resolveBody: ref => c.people.findIndex(p => `person:${p.id}` === ref) },
    isOwner: () => true, canManage: () => true,
  };
  const connection = { id: 7, kind: 'decisions-mock', label: 'Mock decisions', enabled: true, scope: 'installation', config: { latencyMs: 0, priceInPerMTok: 0.1, behaviour: 'spread', ...conn } };
  const connections = { list: () => [connection], get: id => (Number(id) === 7 ? connection : null), canUse: () => true };
  const registry = { manifest: k => (k === 'decisions-mock' ? mockDecisions.manifest : null), implemented: k => k === 'decisions-mock' };
  const config = { enabled: true, defaultConnection: '7', dailyDecisions: 100000, agentDailyDecisions: 600, keepDays: 7, ...cfg };
  let seed = 12345;   // repeatable draws
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const fw = new FreeWill({
    dbs, agents, connections, registry, sim: () => c.sim, principalFor: () => ({ account: { id: 1 }, role: 'owner' }), config: () => config, rand,
    decide: decide || ((cn, request) => mockDecisions.decide({ config: cn.config, request })),
  });
  return { fw, dbs, records, connection, config, close: () => { fw.stop(); dbs.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

/** Runs the city for worldHours on its virtual clock, letting answers arrive between ticks. */
async function run(c, fw, worldHours, step = 0.5) {
  const end = c.t() + worldHours * 3600 / 16;
  while (c.t() < end) {
    c.advance(step);
    c.sim.tick();
    fw?.tick();
    c.sim.flush();
    if (fw && fw.inFlight) await new Promise(r => setImmediate(r));
  }
}

const rowsOf = h => { h.fw.flush(); return h.dbs.db.prepare('SELECT * FROM agent_decisions ORDER BY id').all(); };

test('sampling: spontaneity 0 nearly always takes the favourite, options the world does not offer are never drawn', () => {
  assert.ok(temperature(0) < temperature(0.5) && temperature(0.5) < temperature(1));
  const ans = { choice: 'a', probabilities: [{ value: 'a', probability: 0.7 }, { value: 'b', probability: 0.25 }, { value: 'x', probability: 0.05 }] };
  const allowed = new Set(['a', 'b']);
  let seed = 1; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const count = s => { let n = 0; for (let k = 0; k < 2000; k++) if (drawChoice(ans, allowed, s, rand).value === 'a') n++; return n / 2000; };
  const cold = count(0), mid = count(0.5), hot = count(1);
  assert.ok(cold > 0.95, `spontaneity 0 takes the favourite (${cold})`);
  assert.ok(cold > mid && mid > hot, `more spontaneity, more variety (${cold} > ${mid} > ${hot})`);
  for (let k = 0; k < 500; k++) assert.notEqual(drawChoice(ans, allowed, 1, rand).value, 'x');
  assert.equal(drawChoice({ choice: 'zzz', probabilities: [] }, allowed, 0.5, rand), null, 'nothing allowed: no pick');
  assert.deepEqual(drawChoice({ choice: 'b' }, allowed, 0.5, rand), { value: 'b', p: 1 }, 'no probabilities: the service\'s choice');
});

test('options are the routine\'s own kinds, with real places, travel times and at most MAX_OPTIONS; the request stays small', async () => {
  const c = city();
  c.sim.start();
  await run(c, null, 3);   // into the morning: cafés and parks are open
  const brain = c.sim.brain;
  let checked = 0;
  for (const a of c.sim.agents.filter(x => x.p.vip)) {
    const h = brain.hour(c.t()), day = brain.day(c.t());
    const at = { x: a.plan.x, z: a.plan.z, ctx: a.plan.ctx, h, day, needs: { ...a.needs }, atHome: false };
    const opts = buildOptions(brain, a, at, null);
    const kinds = new Set(brain.leisureOptions(a, h, day, at.needs).map(o => o[0]));
    assert.ok(opts.length <= MAX_OPTIONS);
    assert.equal(new Set(opts.map(o => o.id)).size, opts.length, 'option ids are unique');
    for (const o of opts) {
      assert.ok(kinds.has(o.kind), `${o.kind} is something the routine offers now`);
      if (o.b !== undefined) { assert.ok(o.name && o.minutes >= 1, 'a venue has a name and a travel time'); assert.match(o.label, /min away/); }
    }
    const live = brain.leisureOptions(a, h, day);
    for (const o of opts) assert.ok(stillPossible(brain, a, o, live) || !live.some(x => x[0] === o.kind) || o.b !== undefined, 'plain options stay possible while their kind is offered');
    const req = decisionRequest({ name: a.p.name, role: 'Tester', tr: a.p.tr, needs: a.needs, h, day, place: 'outside', atHome: false, job: a.p.job, money: { available: 4200, rentPerDay: 1800 }, recent: [{ clock: '8:10 AM', label: 'Café Luna' }] }, opts);
    assert.equal(req.questions[0].choices.length, opts.length);
    assert.ok(JSON.stringify(req).length < 4000, 'about 1,000 tokens at most');
    assert.ok(!/[\u0000-\u001f]/.test(snapshotText({ name: 'A\u0007b', role: 'x\ny', tr: a.p.tr, needs: a.needs, h, day, place: 'p', job: a.p.job }).replace(/\n/g, '')));
    checked++;
  }
  assert.equal(checked, AGENTS);
});

test('Free Will attached with nobody using it changes nothing: the plans are identical to a city without it', async () => {
  const digest = async attach => {
    const c = city({ pop: 400, seed: 'fw-parity' });
    const h = attach ? harness(c) : null;
    if (h) h.fw.attach();
    const hash = crypto.createHash('sha256');
    c.sim.listeners.add(b => hash.update(Buffer.from(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength)));
    c.sim.start();
    await run(c, h?.fw, 20);
    h?.close();
    return hash.digest('hex');
  };
  assert.equal(await digest(true), await digest(false));
});

test('agents with Free Will choose for themselves: asked ahead, answers used for their own plan, every choice logged with its options', async () => {
  const c = city();
  const h = harness(c);
  h.fw.attach();
  for (const a of h.records) h.fw.setSettings(a, { enabled: true }, 1);
  assert.equal(h.fw.byPerson.size, AGENTS, 'every agent with a body is active');
  c.sim.start();
  await run(c, h.fw, 30);
  const rows = rowsOf(h);
  const chosen = rows.filter(r => r.outcome === 'chosen');
  // agents with jobs reach free time a few times a world day (the rest is sleep, work and meals: never asked about)
  assert.ok(chosen.length >= AGENTS * 2, `agents chose for themselves (${chosen.length})`);
  assert.ok(chosen.length >= h.fw.stats.asked * 0.8, `most answers were carried out (${chosen.length} of ${h.fw.stats.asked})`);
  for (const r of chosen) {
    const ids = JSON.parse(r.options_json).map(o => o.id);
    assert.ok(ids.includes(r.chosen), 'the choice was one of the options offered');
    assert.ok(r.input_tokens > 0 && r.cost_micro > 0, 'metered');
    assert.ok(JSON.parse(r.probs_json).every(p => ids.includes(p.id)));
  }
  assert.ok(h.fw.stats.skippedRoutine > 0, 'routine moments (sleep, work, meals) were not asked about');
  assert.equal(c.sim.errorCount, 0, JSON.stringify(c.sim.errors));
  const kinds = new Set(chosen.map(r => r.chosen.split('@')[0]));
  assert.ok(kinds.size >= 3, `a variety of things (${[...kinds]})`);
  const log = h.fw.decisions(h.records[0].id, { limit: 5 });
  assert.ok(log.length >= 1 && log.every((r, k) => k === 0 || r.id < log[k - 1].id), 'the why-log reads newest first');
  const ov = h.fw.overview();
  assert.equal(ov.activeAgents, AGENTS); assert.ok(ov.today.requests >= chosen.length); assert.equal(ov.inFlight, 0);
  h.close();
});

test('an answer that arrives after its choice point: the routine chose, and the log says "late" with what the request cost', async () => {
  const c = city();
  const held = [];
  const h = harness(c, { decide: (cn, request) => new Promise(resolve => held.push(() => resolve(mockDecisions.decide({ config: cn.config, request })))) });
  h.fw.attach();
  for (const a of h.records) h.fw.setSettings(a, { enabled: true }, 1);
  c.sim.start();
  await run(c, h.fw, 8);
  assert.ok(held.length > 0, 'questions went out');
  for (const r of held.splice(0)) r();
  await new Promise(r => setTimeout(r, 20));
  const late = rowsOf(h).filter(r => r.reason === 'late');
  assert.ok(late.length > 0, 'late answers are logged');
  assert.ok(late.every(r => r.outcome === 'routine' && r.input_tokens > 0), 'as the routine\'s choice, with their cost');
  assert.equal(c.sim.errorCount, 0);
  h.close();
});

test('a failing decision service is paused after repeated failures; the routine carries on and the log says why', async () => {
  const c = city();
  let calls = 0;
  const h = harness(c, { decide: () => { calls++; return Promise.reject(Object.assign(new Error('down'), { code: 'provider_error' })); } });
  h.fw.attach();
  for (const a of h.records) h.fw.setSettings(a, { enabled: true }, 1);
  c.sim.start();
  await run(c, h.fw, 20);
  const rows = rowsOf(h);
  assert.ok(rows.some(r => r.reason === 'service_provider_error'), 'failures are logged');
  assert.ok(rows.some(r => r.reason === 'service_paused'), 'then the service is paused');
  assert.ok(calls <= 10, `a paused service is not hammered (${calls} calls)`);
  assert.equal(rows.filter(r => r.outcome === 'chosen').length, 0);
  assert.equal(h.fw.overview().paused.length, 1);
  assert.equal(c.sim.errorCount, 0);
  h.close();
});

test('the per-agent and the installation daily limits stop the requests', async () => {
  for (const [cfg, reason] of [[{ agentDailyDecisions: 2 }, 'agent_daily_limit'], [{ dailyDecisions: 5 }, 'daily_limit']]) {
    const c = city();
    const h = harness(c, { cfg });
    h.fw.attach();
    for (const a of h.records) h.fw.setSettings(a, { enabled: true }, 1);
    c.sim.start();
    await run(c, h.fw, 30);
    const rows = rowsOf(h), paid = rows.filter(r => r.input_tokens !== null);
    assert.ok(rows.some(r => r.reason === reason), `${reason} is logged`);
    if (cfg.agentDailyDecisions) for (const a of h.records) assert.ok(paid.filter(r => r.agent_id === a.id).length <= 2);
    else assert.ok(paid.length <= 5, `at most 5 paid requests (${paid.length})`);
    h.close();
  }
});

test('refusals and answers that are not options fall back to the routine; switching Free Will off stops it at once', async () => {
  for (const behaviour of ['refuse', 'garbage']) {
    const c = city();
    const h = harness(c, { conn: { behaviour } });
    h.fw.attach();
    for (const a of h.records) h.fw.setSettings(a, { enabled: true }, 1);
    c.sim.start();
    await run(c, h.fw, 12);
    const rows = rowsOf(h);
    assert.equal(rows.filter(r => r.outcome === 'chosen').length, 0, behaviour);
    assert.ok(rows.some(r => r.reason === (behaviour === 'refuse' ? 'refused' : 'invalid_answer')), behaviour);
    h.close();
  }
  const c = city();
  const h = harness(c);
  h.fw.attach();
  for (const a of h.records) h.fw.setSettings(a, { enabled: true }, 1);
  c.sim.start();
  await run(c, h.fw, 6);
  for (const a of h.records) h.fw.setSettings(a, { enabled: false }, 1);
  assert.equal(h.fw.byPerson.size, 0);
  const before = h.fw.stats.asked;
  await run(c, h.fw, 6);
  assert.equal(h.fw.stats.asked, before, 'nothing is asked once it is off');
  assert.throws(() => h.fw.setSettings(h.records[0], { spontaneity: 2 }, 1), /0 to 1/);
  h.close();
});

