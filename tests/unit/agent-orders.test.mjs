// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Orders from a connected agent's own AI (server/sim/agents.js order; 2026-10-10), on a generated city with a
// virtual clock: an order comes before the routine (it outlasts a work shift), until its time is up — then the routine goes
// on and the AI is told; an order the world refuses changes nothing; a meet walks up to its person, follows them, counts
// its time together from when it reaches them, and ends — told why — when they go somewhere private or it can't find them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { evalPlan } from '../../server/sim/plan.js';
import { ctxB } from '../../shared/constants.js';
import { classifyAct } from '../../server/agent-life/activity.js';

function city({ pop = 400, seed = 'orders-unit', startHour = 9 } = {}) {
  const world = generateWorld({ seed, population: pop });
  const roster = Array.from({ length: 8 }, (_, k) => ({ agentId: `o-agent-${k + 1}`, name: `Agent ${k + 1}`, emoji: '🤖', role: 'Tester' }));
  const people = generatePopulation(world, new WorldIndex(world), { population: pop, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: startHour * 3600, dayScale: 16 };
  sim.start();
  const run = worldMinutes => { const end = T + worldMinutes * 60 / 16; while (T < end) { T += 0.5; sim.tick(); sim.flush(); } };
  return { world, people, sim, run, t: () => T };
}
const parks = (c) => new Set((c.sim.brain.index.venues.park || []).map(v => v.b));
const where = (c, i) => evalPlan(c.sim.agents[i].plan, c.t());

test('an order outlasts the routine: a park during work hours stays a park until its time is up, then work goes on and the AI is told', () => {
  const c = city();
  const i = c.people.findIndex(p => p && p.job && p.job.kind !== 'free' && p.job.start <= 9.5 && p.job.end >= 15);
  assert.ok(i >= 0, 'someone who works through the day');
  c.run(60);   // 10 AM: at work
  const r = c.sim.order(i, { kind: 'park', minutes: 150 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const P = parks(c);
  let inPark = 0;
  for (let m = 0; m < 140; m += 10) { c.run(10); if (P.has(ctxB(where(c, i).ctx)) || c.sim.agents[i].act?.kind === 'visit') inPark++; }
  assert.ok(c.sim.orderOf(i), 'the order still runs');
  assert.ok(inPark >= 8, `mostly in a park meanwhile (${inPark} of 14 checks)`);
  assert.notEqual(c.sim.agents[i].act?.kind, 'work', 'not back at work while the order runs');
  c.run(Math.ceil((c.sim.orderOf(i).until - c.t()) * 16 / 60) + 5);   // (150 minutes from its arrival at the park)
  assert.equal(c.sim.orderOf(i), null, 'its time is up');
  assert.deepEqual(c.sim.orderEndedOf(i)?.why, 'done', 'and its AI is told it finished');
  assert.equal(c.sim.orderEndedOf(i)?.why, 'done', 'still told on the next look');
  assert.equal(c.sim.order(i, { kind: 'jog', minutes: 30 }).ok, true);
  assert.equal(c.sim.orderEndedOf(i), null, 'until its next order');
});

test('an order\'s time counts from when it gets there, and it survives a restart of the server (kept on the resident)', () => {
  const c = city();
  const i = c.people.findIndex(p => p && p.job && p.job.kind !== 'free' && p.job.start <= 9.5 && p.job.end >= 15);
  c.run(60);
  // the park farthest from it: a long walk, so the 90 minutes clearly start on arrival
  const me = where(c, i), far = [...c.sim.brain.index.venues.park].sort((x, y) => Math.hypot(y.x - me.x, y.z - me.z) - Math.hypot(x.x - me.x, x.z - me.z))[0];
  const t0 = c.t();
  assert.equal(c.sim.order(i, { kind: 'park', venue: far, minutes: 90 }).ok, true);
  const o = c.sim.orderOf(i), arrive = c.sim.agents[i].act.travelEnd;
  assert.ok(arrive > t0, 'it walks there first');
  assert.equal(o.until, arrive + c.sim.brain.wm(90), 'ninety minutes from its arrival');
  assert.ok(c.people[i].order && c.people[i].order.kind === 'park', 'kept on the resident');
  // a restart: a new simulation from the same residents (the saved order with them) on the same clock
  const sim2 = new Sim(c.world, c.people, { budgetMs: 1e9 });
  sim2.now = () => c.t(); sim2.clock = c.sim.clock; sim2.start();
  const o2 = sim2.orderOf(i);
  assert.ok(o2, 'the order is back');
  assert.equal(o2.kind, 'park'); assert.equal(o2.venue.b, far.b);
  assert.ok(Math.abs(o2.until - o.until) < 1e-6, 'with what is left of it');
  assert.equal(sim2.agents[i].act?.place, sim2.brain.placeName(far.b, far.f), 'and the body goes on with it at once (not its routine)');
  sim2.endOrder(i);
  assert.equal(c.people[i].order, undefined, 'stopped: gone from the resident too');
});

test('an order the world refuses changes nothing: what it was doing carries on', () => {
  const c = city();
  const i = c.people.findIndex(p => p && (!p.job || p.job.kind === 'free'));
  assert.ok(i >= 0, 'someone without a job');
  c.run(30);
  const plan = c.sim.agents[i].plan, act = c.sim.agents[i].act;
  assert.deepEqual(c.sim.order(i, { kind: 'work', minutes: 60 }), { ok: false, why: 'no_job' });
  assert.equal(c.sim.agents[i].plan, plan, 'the plan was not cut');
  assert.equal(c.sim.agents[i].act, act);
  assert.equal(c.sim.orderOf(i), null);
});

test('meet: walks up to them, follows them, and the time together counts from when it reaches them', () => {
  const c = city({ startHour: 11 });
  const [i, j] = c.people.map((p, k) => (p && p.vip ? k : -1)).filter(k => k >= 0);
  c.run(10);
  // j goes to a park (public); i meets j there
  assert.equal(c.sim.order(j, { kind: 'park', minutes: 240 }).ok, true);
  c.run(5);
  const r = c.sim.order(i, { kind: 'meet', who: j, minutes: 30 });
  if (!r.ok) {   // j may still be inside its office (private to i unless they share the floor): wait until it is out
    for (let k = 0; k < 30 && !c.sim.order(i, { kind: 'meet', who: j, minutes: 30 }).ok; k++) c.run(5);
  }
  const o = c.sim.orderOf(i);
  assert.ok(o && o.kind === 'meet', 'a meet order runs');
  assert.equal(o.reached, 0, 'not there yet');
  assert.equal(c.sim.agents[i].act?.kind, 'meet', 'walking over to them');
  assert.equal(classifyAct(c.sim, c.sim.agents[i], c.sim.agents[i].act), null, 'which its life\'s log does not count as a talk');
  let reachedAt = 0;
  for (let k = 0; k < 60 && !reachedAt; k++) { c.run(5); reachedAt = c.sim.orderOf(i)?.reached || 0; }
  assert.ok(reachedAt, 'it reached them');
  assert.equal(c.sim.orderOf(i).until, reachedAt + c.sim.brain.wm(30), 'thirty minutes from then');
  const a = where(c, i), b = where(c, j);
  assert.equal(a.ctx, b.ctx);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 4, 'beside them');
  assert.match(c.sim.agents[i].act?.label || '', /^With /);
  assert.equal(classifyAct(c.sim, c.sim.agents[i], c.sim.agents[i].act)?.label, `Talked with ${c.people[j].name}`, 'being with them is');
});

test('meet: when they go somewhere private the order ends and says why; nobody, or a private place, is refused at once', () => {
  const c = city({ startHour: 11 });
  const vip = c.people.map((p, k) => (p && p.vip ? k : -1)).filter(k => k >= 0);
  const [i, j] = vip;
  c.run(10);
  assert.equal(c.sim.order(i, { kind: 'meet', who: i, minutes: 30 }).why, 'nobody', 'not oneself');
  // j outdoors in a park, i meets it; then j goes home (private): i stops following
  assert.equal(c.sim.order(j, { kind: 'park', minutes: 120 }).ok, true);
  let ok = false;
  for (let k = 0; k < 40 && !ok; k++) { c.run(5); ok = c.sim.order(i, { kind: 'meet', who: j, minutes: 240 }).ok; }
  assert.ok(ok, 'the meet started');
  for (let k = 0; k < 40 && !c.sim.orderOf(i)?.reached; k++) c.run(5);
  assert.ok(c.sim.orderOf(i)?.reached, 'together');
  assert.equal(c.sim.order(j, { kind: 'home', minutes: 240 }).ok, true);
  let ended = null;
  for (let k = 0; k < 120 && !ended; k++) { c.run(5); ended = c.sim.orderEndedOf(i); }
  assert.ok(ended, 'the meet ended');
  assert.equal(ended.why, 'private', 'because they went home');
  // and asked while they are at home, it is refused without touching anything
  const plan = c.sim.agents[i].plan;
  assert.deepEqual(c.sim.order(i, { kind: 'meet', who: j, minutes: 30 }), { ok: false, why: 'private' });
  assert.equal(c.sim.agents[i].plan, plan);
});

test('meet someone on the move: it hurries and heads for where they will be, so it catches up (a live test chased a stroller for hours)', () => {
  for (const kind of ['jog', 'park']) {
    const c = city({ startHour: 11 });
    const [i, j] = c.people.map((p, k) => (p && p.vip ? k : -1)).filter(k => k >= 0);
    c.run(10);
    assert.equal(c.sim.order(j, { kind, minutes: 300 }).ok, true);
    c.run(20);   // (on their way, or already strolling / jogging)
    let ok = false;
    for (let k = 0; k < 40 && !ok; k++) { ok = c.sim.order(i, { kind: 'meet', who: j, minutes: 30 }).ok; if (!ok) c.run(5); }
    assert.ok(ok, `${kind}: the meet started`);
    let reached = 0, m = 0;
    for (; m < 120 && !reached; m += 5) { c.run(5); reached = c.sim.orderOf(i)?.reached || 0; }
    assert.ok(reached, `${kind}: it reached them (within ${m} world minutes)`);
  }
});

test('a meet that never reaches them gives up after its search time, and says so', () => {
  const c = city();
  const i = c.people.findIndex(p => p && p.vip);
  c.run(10);
  const j = c.people.findIndex((p, k) => p && k !== i && !p.retired);
  c.sim.agents[i].order = { kind: 'meet', who: j, stay: c.sim.brain.wm(20), until: c.t() + 1, reached: 0, at: c.t() };
  c.run(5);
  assert.equal(c.sim.orderOf(i), null);
  assert.equal(c.sim.orderEndedOf(i)?.why, 'not_found');
});
