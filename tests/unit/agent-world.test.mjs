// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A connected agent's eyes, ears and hands (server/agent-world.js; 2026-10-10) on a generated city with a
// virtual clock: look says where it is heading and when it arrives, names each place once, and shows its order; meet is an
// order; a line said to someone near is heard by them (toYou) and wakes their mailbox, someone far is told how far; a
// refused order says why and costs no wait, a carried-out one starts the wait (retryAfter).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { AgentWorld } from '../../server/agent-world.js';
import { AgentApiError } from '../../server/agent-api.js';

function rig() {
  const world = generateWorld({ seed: 'agent-world-unit', population: 400 });
  const roster = Array.from({ length: 6 }, (_, k) => ({ agentId: `w-agent-${k + 1}`, name: `Agent ${k + 1}`, emoji: '🤖', role: 'Tester' }));
  const people = generatePopulation(world, new WorldIndex(world), { population: 400, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, real = Date.parse('2026-10-10T12:00:00Z');
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 11 * 3600, dayScale: 16 };
  sim.start();
  const run = worldMinutes => { const end = T + worldMinutes * 60 / 16; while (T < end) { T += 0.5; real += 500; sim.tick(); sim.flush(); } };
  const vip = people.map((p, k) => (p && p.vip ? k : -1)).filter(k => k >= 0);
  // two connected agents: slot 1 is the body vip[0], slot 2 the body vip[1]
  const recs = new Map([['ext-1', { id: 101, name: people[vip[0]].name }], ['ext-2', { id: 102, name: people[vip[1]].name }]]);
  const byAgent = new Map([[101, vip[0]], [102, vip[1]]]);
  const plans = new Map();
  const life = {
    byAgent,
    contextFor: () => ({ personality: [], earlier: [], memories: [] }),
    intentions: id => plans.get(id) || [],
    addIntention: (id, p) => { const l = plans.get(id) || []; l.push({ id: l.length + 1, ...p, status: 'open' }); plans.set(id, l); return l; },
  };
  const mind = { voice: async (agent, text) => { sim.emit({ t: 'say', i: byAgent.get(agent.id), text, until: 0 }); return { shown: true, text }; } };
  const woke = [];
  const w = new AgentWorld({ agents: { byKey: k => recs.get(k) || null }, sim: () => sim, life: () => life, mind: () => mind, extKey: id => `ext-${id}`, wake: id => woke.push(id), now: () => real });
  return { sim, people, run, w, vip, woke, A: { id: 1 }, B: { id: 2 }, tick: ms => { real += ms; } };
}

test('look: the time, honest whereabouts (heading somewhere: when it arrives), places named once, its order', async () => {
  const R = rig();
  R.run(5);
  const l = R.w.look(R.A);
  assert.ok(l.time.clock && l.time.realMinutesPerWorldHour > 0);
  const names = l.places.map(p => p.name);
  assert.equal(new Set(names).size, names.length, `each place once: ${names.join(' | ')}`);
  assert.ok(l.places.every(p => p.walkWorldMinutesAtLeast >= 1));
  const r = await R.w.act(R.A, { action: 'go', place: l.places.find(p => p.kind === 'park')?.name || 'home', minutes: 90 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.heading ? r.arrivesIn.worldMinutes >= 0 && r.then : r.now, 'heading there with an arrival time, or already there');
  const l2 = R.w.look(R.A, { brief: true });
  assert.ok(l2.order && l2.order.until, 'the order shows, with its end');
  if (r.heading) assert.match(l2.me.where, /^on the way to /);
});

test('orders: a refused one says why and costs no wait; a carried-out one starts the wait, with retryAfter', async () => {
  const R = rig();
  R.run(5);
  const bad = await R.w.act(R.A, { action: 'go', place: 'Nowhere Street Café 999' });
  assert.equal(bad.ok, false); assert.match(bad.why, /no place called/);
  const ok = await R.w.act(R.A, { action: 'do', activity: 'jog', minutes: 30 });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  await assert.rejects(R.w.act(R.A, { action: 'do', activity: 'park' }), e => e instanceof AgentApiError && e.status === 429 && e.retryAfter > 0);
  R.tick(10500);
  assert.equal((await R.w.act(R.A, { action: 'stop' })).stopped, true, 'stop ends its order');
});

test('meet is an order; a line said to someone near is heard by them (toYou) and wakes their mailbox; someone far is told how far', async () => {
  const R = rig();
  R.run(5);
  const nameB = R.people[R.vip[1]].name;
  R.w.look(R.B);   // B's AI is here: its ears are open
  // B to a park, A meets B there
  assert.equal(R.sim.order(R.vip[1], { kind: 'park', minutes: 240 }).ok, true);
  let m = { ok: false };
  for (let k = 0; k < 40 && !m.ok; k++) { R.run(5); R.tick(11000); m = await R.w.act(R.A, { action: 'meet', name: nameB, minutes: 30 }); }
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.equal(m.order?.doing, 'meet'); assert.equal(m.order?.with, nameB);
  // far away first: told how far
  const far = await R.w.act(R.A, { action: 'say', text: 'Hello!', to: nameB });
  if (far.said === false) assert.match(far.why, /m away|can't talk through walls/);
  for (let k = 0; k < 60 && !R.sim.orderOf(R.vip[0])?.reached; k++) R.run(5);
  assert.ok(R.sim.orderOf(R.vip[0])?.reached, 'A reached B');
  R.w.look(R.B);
  R.tick(16000);
  const said = await R.w.act(R.A, { action: 'say', text: 'Fancy seeing you here!', to: nameB });
  assert.equal(said.said, true, JSON.stringify(said));
  assert.ok(R.woke.includes(2), 'B\'s mailbox was woken');
  const got = R.w.inboxExtra(R.B);
  assert.equal(got.heard.length, 1);
  assert.equal(got.heard[0].from, R.people[R.vip[0]].name);
  assert.equal(got.heard[0].text, 'Fancy seeing you here!');
  assert.equal(got.heard[0].toYou, true);
  assert.ok(got.heard[0].at && got.heard[0].clock);
  assert.equal(R.w.inboxExtra(R.B), null, 'handed over once');
  assert.equal(R.w.look(R.A, { brief: true }).me.doing, `Talking with ${nameB}`, 'said from its own side');
});

test('the open air is one space: the street and a park\'s grounds see and hear each other; walls still separate (an exhibition shoot found two friends side by side in a park who couldn\'t talk)', () => {
  const R = rig(), Bs = R.sim.world.buildings;
  const park = Bs.findIndex(b => b && b.type === 'park'), office = Bs.findIndex(b => b && b.type !== 'park' && b.lv && b.lv.length > 1);
  assert.ok(park >= 0 && office >= 0);
  const P0 = park * 64, O0 = office * 64, O1 = office * 64 + 1;
  assert.equal(R.w.sameSpace(R.sim, P0, -1), true, 'on the park\'s grounds and on the path beside it');
  assert.equal(R.w.sameSpace(R.sim, -1, P0), true);
  assert.equal(R.w.sameSpace(R.sim, P0, P0), true);
  assert.equal(R.w.sameSpace(R.sim, O0, -1), false, 'inside a building and outdoors: walls');
  assert.equal(R.w.sameSpace(R.sim, O0, O1), false, 'two floors');
  assert.equal(R.w.sameSpace(R.sim, O1, O1), true, 'the same floor');
  assert.equal(R.w.sameSpace(R.sim, O0, P0), false);
});

test('its facts right now (2026-10-12): the time and part of the day, where, its day as "doing" — a message only a moment from it', async () => {
  const R = rig();
  R.run(20);
  const i = R.vip[0], a = R.sim.agents[i], key = R.people[i].agentId;
  const f = R.w.nowFacts(R.A);
  assert.match(f.time, /^\w+ \d{1,2}:\d{2} (AM|PM)$/); assert.ok(['morning', 'afternoon', 'evening', 'night'].includes(f.partOfDay));
  assert.equal(f.where, R.w.look(R.A, { brief: true }).me.where);
  assert.match(f.rule, /"doing" is your day.*Never make up the time, the part of the day, where you are or what you are doing/s);
  const working = new Set([key]);
  R.sim.presence = { isWorking: k => working.has(k), info: () => null, ok: true };
  // a message: its facts keep its day as what it is doing — the phone or desk it turned to is only a moment
  const was = a.act && { ...a.act };
  R.sim.brain.workChanged(a, true);
  R.run(2);
  const g = R.w.nowFacts(R.A);
  assert.doesNotMatch(g.doing, /phone|answer(ing)? (a |this )?message/i, `"doing" is its day, not the message (${g.doing})`);
  if (a.resume) {
    assert.ok(g.doing.includes(a.resume.label.toLowerCase()), `${g.doing} — it was ${was?.label}`);
    assert.match(g.moment, /^you paused it to answer this message; you go back to it until \d{1,2}:\d{2} (AM|PM)$/);
  } else if (R.sim.brain.atScreen(a)) assert.match(g.moment, /right where you are/);
  assert.equal(R.w.look(R.A, { brief: true }).me.doing, g.doing, 'look says the same');
  // woken by a message: said so
  a.wokenAt = R.sim.now();
  if (/^(task|task_phone|phone)$/.test(a.act?.use || '')) assert.equal(R.w.nowFacts(R.A).doing, 'you were asleep in bed; this message woke you');
});
