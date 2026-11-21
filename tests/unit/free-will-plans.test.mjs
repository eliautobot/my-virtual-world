// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Free Will follows through on its plans (server/free-will/options.js withPlans; 2026-11-17, the product owner: Sam said
// he would grab groceries after work and never went): an option that would do one of its open plans for today says so,
// the place a plan names is offered even when it isn't among the nearest (open, with room, reachable), a plan that names
// only a kind of thing marks the options of that kind, a plan its body has nothing to do with marks nothing; a meal's
// choice offers the café a lunch plan names. And all the way: after its shift it chooses its plan's shop, goes there,
// buys its groceries (in its bag) and the plan is done once it got there.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { generateWorld } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { openDb } from '../../server/db.js';
import { AgentLife } from '../../server/agent-life/life.js';
import { planCheck, placeNames } from '../../server/agent-life/activity.js';
import { FreeWill } from '../../server/free-will/free-will.js';
import { buildOptions, buildChoice, stillPossible, choicePossible, MAX_OPTIONS } from '../../server/free-will/options.js';
import { Inventory } from '../../server/economy/inventory.js';
import { subj } from '../../server/economy/economy.js';
import mockDecisions from '../../server/providers/decisions-mock.js';
import { economyModel } from '../helpers/econ-model.mjs';
import { tempDir } from '../helpers/server.mjs';

function city({ pop = 500, agents = 4, seed = 'fw-plans' } = {}) {
  const world = generateWorld({ seed, population: pop });
  const roster = Array.from({ length: agents }, (_, k) => ({ agentId: `fp-agent-${k + 1}`, name: `Agent ${k + 1}`, emoji: '🤖', role: 'Tester' }));
  const people = generatePopulation(world, new WorldIndex(world), { population: pop, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 6 * 3600, dayScale: 16 };
  return { world, people, sim, advance: dt => { T += dt; }, t: () => T };
}
async function run(c, worldHours, fw = null, stop = () => false) {
  const end = c.t() + worldHours * 3600 / 16;
  while (c.t() < end && !stop()) { c.advance(0.5); c.sim.tick(); fw?.tick(); c.sim.flush(); if (fw && fw.inFlight) await new Promise(r => setImmediate(r)); }
}
const planned = (c, text) => ({ text, kind: 'must', check: planCheck(text, placeNames(c.sim)) });
/** The venue of vkind farthest from the agent with room for uses, and not one it would be offered anyway. */
function farthest(brain, a, vkind, uses, offered) {
  const P = a.plan, list = brain.index.venues[vkind].filter(v => !offered.has(brain.placeName(v.b, v.f)) && brain.freeSlots(v.b, v.f, uses, a.i).length);
  return list.sort((x, y) => Math.hypot(y.x - P.x, y.z - P.z) - Math.hypot(x.x - P.x, x.z - P.z))[0];
}

test('free time: its plan\'s shop is offered and says so, even far away; a kind of thing marks that kind; nothing else changes', async () => {
  const c = city();
  c.sim.start();
  await run(c, 5);   // 11 AM: the shops are open
  const brain = c.sim.brain, a = c.sim.agents.find(x => x.p.vip && x.plan), P = a.plan;
  const h = brain.hour(c.t()), day = brain.day(c.t()), at = { x: P.x, z: P.z, ctx: P.ctx, h, day, needs: { ...a.needs, energy: 0.9, fun: 0.3 }, atHome: false };
  const base = buildOptions(brain, a, at, null);
  assert.ok(base.some(o => o.kind === 'shop'), 'shops are among its free-time options now');
  const v = farthest(brain, a, 'shop', ['browse'], new Set(base.map(o => o.name).filter(Boolean)));
  const name = brain.placeName(v.b, v.f), text = `Groceries at ${name} after work`;
  const opts = buildChoice('leisure', brain, a, at, null, P, [planned(c, text)]);
  const o = opts.find(x => x.id === `shop@${v.b}.${v.f}`);
  assert.ok(o, `its plan's shop is offered (${opts.map(x => x.id).join(', ')})`);
  assert.match(o.label, new RegExp(`^Go shopping at ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(about \\d+ min away.*\\) — in your plans: ${text}$`));
  assert.deepEqual(o.buy, ['groceries'], 'it goes for the groceries');
  assert.ok(opts.length <= MAX_OPTIONS);
  assert.equal(new Set(opts.map(x => x.id)).size, opts.length);
  assert.ok(stillPossible(brain, a, o, brain.leisureOptions(a, h, day, at.needs), { ctx: P.ctx, x: P.x, z: P.z }), 'and it can be carried out');
  assert.deepEqual(opts.filter(x => x.plan).map(x => x.id), [o.id], 'only that one is its plan');
  // a plan that names only a kind of thing: the shops it is offered say so; none added
  const kindOnly = buildChoice('leisure', brain, a, at, null, P, [planned(c, 'Buy groceries')]);
  assert.deepEqual(kindOnly.map(x => x.id), base.map(x => x.id));
  assert.deepEqual(kindOnly.filter(x => x.plan).map(x => x.kind), base.filter(x => x.kind === 'shop').map(() => 'shop'));
  // a plan its body has nothing to do with: as before
  assert.equal(planned(c, 'Text Pema about sushi').check, null);
  assert.deepEqual(buildChoice('leisure', brain, a, at, null, P, []).map(x => x.label), base.map(x => x.label));
});

test('a meal: the café a lunch plan names is offered, and says so', async () => {
  const c = city({ seed: 'fw-plans-meal' });
  c.sim.start();
  await run(c, 6.5);   // 12:30 PM
  const brain = c.sim.brain, a = c.sim.agents.find(x => x.p.vip && x.plan), P = a.plan;
  const h = brain.hour(c.t()), day = brain.day(c.t()), at = { x: P.x, z: P.z, ctx: P.ctx, h, day, needs: { ...a.needs }, atHome: false };
  const base = buildChoice('meal', brain, a, at, null, P);
  const v = farthest(brain, a, 'cafe', ['eat'], new Set(base.map(o => o.name).filter(Boolean)));
  const name = brain.placeName(v.b, v.f), text = `Lunch at ${name}`;
  const opts = buildChoice('meal', brain, a, at, null, P, [planned(c, text)]);
  const o = opts.find(x => x.id === `cafe@${v.b}.${v.f}`);
  assert.ok(o, 'its plan\'s café is offered');
  assert.equal(o.way, 'venue');
  assert.match(o.label, new RegExp(`^Lunch at .+ — in your plans: ${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  assert.ok(choicePossible(brain, a, 'meal', o, P, h), 'and it can be carried out');
  assert.equal(o.buy, undefined, 'a meal is no errand');
  // "Lunch at home": its meal at home says so, and nothing else; a plan for any meal marks every meal
  const home = buildChoice('meal', brain, a, at, null, P, [planned(c, 'Lunch at home')]);
  assert.deepEqual(home.map(x => x.id), base.map(x => x.id));
  assert.deepEqual(home.filter(x => x.plan).map(x => x.id), ['home']);
  assert.match(home.find(x => x.id === 'home').label, /^Lunch at home.* — in your plans: Lunch at home$/);
  assert.equal(buildChoice('meal', brain, a, at, null, P, [planned(c, 'Have lunch')]).filter(x => x.plan).length, base.length);
});

test('all the way: after its shift it chooses its plan, goes to that shop, buys its groceries; the plan is done once it is there', { timeout: 180000 }, async () => {
  const c = city({ seed: 'fw-errand' });
  const dir = tempDir('mvw-fw-plans-');
  const dbs = openDb(dir);
  const records = c.people.filter(p => p.vip).map((p, k) => ({ id: k + 1, key: p.agentId, ownerId: null, enabled: true, name: p.name, role: p.role, emoji: '', bodyRef: `person:${p.id}` }));
  const agents = { list: () => records, get: id => records.find(a => a.id === Number(id)) || null, byKey: k => records.find(a => a.key === k) || null, byId: id => records.find(a => a.id === Number(id)) || null,
    enabled: () => records, listeners: new Set(), resolver: { resolveBody: ref => c.people.findIndex(p => `person:${p.id}` === ref) }, isOwner: () => true, canManage: () => true };
  // the economy, charging what residents and agents buy as on a server (sim.onAct), with the agents' inventories
  const model = economyModel({ city: { world: c.world, people: c.people }, agents });
  const e = model.econ, H = e.parts.households, inv = e.parts.inventory = new Inventory(e);
  e.parts.businesses.sync();
  c.sim.econ = H; c.sim.onAct = (a, act) => H.onAct(a, act);
  const life = new AgentLife({ dbs, agents, sim: () => c.sim });
  // a decision service that goes for what is in its plans (else the mock's own spread)
  const connection = { id: 7, kind: 'decisions-mock', label: 'Mock', enabled: true, scope: 'installation', config: { latencyMs: 0, priceInPerMTok: 0.1, behaviour: 'spread' } };
  const decide = async (cn, request) => {
    const q = request.questions[0], mine = q.choices.find(x => /— in your plans: /.test(x.description));
    if (!mine) return mockDecisions.decide({ config: cn.config, request });
    return { answers: [{ type: 'choice', name: q.name, choice: mine.value, confidence: 0.97, probabilities: q.choices.map(x => ({ value: x.value, probability: x === mine ? 0.97 : 0.03 / (q.choices.length - 1) })) }], usage: { inputTokens: 100 } };
  };
  let seed = 12345;
  const fw = new FreeWill({ dbs, agents, connections: { list: () => [connection], get: id => (Number(id) === 7 ? connection : null), canUse: () => true },
    registry: { manifest: k => (k === 'decisions-mock' ? mockDecisions.manifest : null), implemented: k => k === 'decisions-mock' },
    sim: () => c.sim, principalFor: () => ({ account: { id: 1 }, role: 'owner' }), config: () => ({ enabled: true, defaultConnection: '7', dailyDecisions: 100000, agentDailyDecisions: 600, keepDays: 7 }),
    rand: () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }, decide, context: id => life.contextFor(id) });
  try {
    c.sim.start(); life.attach(); fw.attach();
    for (const r of records) fw.setSettings(r, { enabled: true }, 1);
    const A = c.sim.agents[life.byAgent.get(1)], p = A.p, j = p.job;
    assert.ok(j && Number.isFinite(j.end) && j.end < 20 && ((j.days ?? 31) & 1), `a job that ends before the shops close (${JSON.stringify(j)})`);
    const me = subj('agent', 1), w = e.walletFor(me, 'main');
    if (w.balance < 20000) e.ledger.transfer(e.treasury().id, w.id, 20000, { actor: 'system:test', force: true });
    const B = c.world.buildings[p.home.b], brain = c.sim.brain;
    const v = [...brain.index.venues.shop].sort((x, y) => Math.hypot(y.x - B.x, y.z - B.z) - Math.hypot(x.x - B.x, x.z - B.z))[0];
    const name = brain.placeName(v.b, v.f), text = `Groceries at ${name} after work`;
    const g = life.addIntention(1, { kind: 'must', text, today: true }).find(x => x.text === text);
    const status = () => life.intentions(1).find(x => x.id === g.id).status;
    await run(c, 15.5, fw, () => status() === 'done');
    life.flush(); fw.flush();
    assert.equal(status(), 'done', 'it did what it planned');
    const shopped = life.activity(1, { limit: 60 }).filter(x => x.kind === 'shop');
    assert.ok(shopped.some(x => x.place === name), `it went shopping at ${name} (${shopped.map(x => x.place).join(', ') || 'nowhere'})`);
    assert.ok(brain.hour(c.t()) >= j.end, 'after work');
    assert.ok(inv.has(me, 'goods:groceries') >= 1, 'its groceries are in its bag');
    const chose = dbs.db.prepare("SELECT chosen_label FROM agent_decisions WHERE agent_id = 1 AND outcome = 'chosen' AND choice = 'leisure'").all().map(r => r.chosen_label);
    assert.ok(chose.some(l => l.startsWith(`Go shopping at ${name}`) && l.endsWith(`— in your plans: ${text}`)), chose.join(' | '));
  } finally { fw.stop(); life.stop(); model.close(); dbs.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
