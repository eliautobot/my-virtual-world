// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A plan its body does is done by what its body does (server/agent-life/activity.js planCheck, didPlan; life.js keepPlans,
// setIntention check; 2026-11-17: Sam's "Groceries at Store 21 after work" was marked done with no shopping in his day):
// a plan naming a place of the world or a kind of activity is closed when its activity log shows it there, and a brain
// saying it is done (its Mind's reflection, its own AI, a line on the air) while the log shows nothing of it since it was
// planned leaves it open, and says why; a plan with nothing to check ("Text Pema about sushi") and its owner's word are
// as before.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { generateWorld } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { openDb } from '../../server/db.js';
import { AgentLife, LifeError } from '../../server/agent-life/life.js';
import { planCheck, didPlan, placeNames } from '../../server/agent-life/activity.js';
import { applyActions } from '../../server/mind/actions.js';
import { tempDir } from '../helpers/server.mjs';

test('what a plan asks of its body: the world\'s places and the kinds of activity it names, and the lines that show it', () => {
  const names = [{ name: 'Café Lumière', low: 'café lumière' }, { name: 'Store 21', low: 'store 21' }, { name: 'Store 2', low: 'store 2' }, { name: 'Sakura Sushi', low: 'sakura sushi' }];
  const kinds = c => c && { places: c.places, kinds: c.groups.map(g => g.kinds.join('|')) };
  assert.deepEqual(kinds(planCheck('Groceries at Store 21 after work', names)), { places: ['Store 21'], kinds: ['shop'] }, '"Store 21" is the place, not "Store 2"');
  assert.deepEqual(kinds(planCheck('Lunch at Café Lumière', names)), { places: ['Café Lumière'], kinds: ['meal'] });
  assert.deepEqual(kinds(planCheck('Buy groceries', names)), { places: [], kinds: ['shop'] });
  assert.deepEqual(kinds(planCheck('Visit Store 21', names)), { places: ['Store 21'], kinds: [] });
  assert.equal(planCheck('Text Pema about sushi', names), null, 'nothing its body does');
  assert.equal(planCheck('Tell Lara about Store 21 and its groceries', names), null, 'what it is about is talked about, not done');
  assert.equal(planCheck('Read a book', names), null);
  const g = planCheck('Groceries at Store 21 after work', names);
  assert.equal(didPlan(g, [{ kind: 'shop', place: 'Store 21' }]), true);
  assert.equal(didPlan(g, [{ kind: 'shop', place: 'Store 2' }]), false, 'another shop');
  assert.equal(didPlan(g, [{ kind: 'shop', place: 'Store 9' }, { kind: 'walk', place: 'Store 21' }]), false, 'shopping elsewhere and passing by');
  const l = planCheck('Lunch at Café Lumière', names);
  assert.equal(didPlan(l, [{ kind: 'meal', place: 'Café Lumière' }]), true);
  assert.equal(didPlan(l, [{ kind: 'cafe', place: 'Café Lumière' }]), false, 'a coffee there is not lunch');
  const out = planCheck('Dinner at a restaurant', names);
  assert.equal(didPlan(out, [{ kind: 'meal', place: 'Home' }]), false, 'a restaurant is not home');
  assert.equal(didPlan(out, [{ kind: 'meal', place: 'Sakura Sushi Dining Room' }]), true);
  assert.equal(didPlan(planCheck('Dinner at Sakura Sushi', names), [{ kind: 'meal', place: 'Sakura Sushi Dining Room' }]), true, 'a floor of the place is the place');
  const home = planCheck('Dinner at home', names);
  assert.deepEqual(home.places, ['Home'], 'at home: its home, as its log says');
  assert.equal(didPlan(home, [{ kind: 'meal', place: 'Sakura Sushi' }]), false);
  assert.equal(didPlan(home, [{ kind: 'meal', place: 'Home' }]), true);
  assert.deepEqual(kinds(planCheck('Bring the groceries home', names)), { places: [], kinds: ['shop'] }, 'taking something home is not being at home');
  assert.equal(planCheck('Drinks with Lara tonight', names), null, 'drinks are had where the log doesn\'t look (a club): taken at its word');
  // the places a plan can name: those whose visits the log records, by its names for them (a night out isn't in it)
  const world = { buildings: [{ name: 'Orion Court', floors: 3, lv: [0, 1, 2] }, { type: 'park', name: 'Cedar Grove', floors: 1, lv: [3] }, { name: 'Gone', gone: true, floors: 1, lv: [1] }],
    levels: [{ venue: 'shop', name: 'Store 21' }, { venue: 'club', name: 'Club' }, { venue: 'lounge_bar', name: 'Lounge Bar' }, { venue: 'park' }] };
  const sim = { world, brain: { placeName: (b, f) => { const B = world.buildings[b], L = world.levels[B.lv[f]]; return L.venue === 'park' ? B.name : ['club', 'lounge_bar'].includes(L.venue) ? `${B.name} ${L.name}` : L.name; } } };
  assert.deepEqual(placeNames(sim).map(n => n.name).sort(), ['Cedar Grove', 'Store 21']);
});

function setup() {
  const world = generateWorld({ seed: 'plans-done', population: 300 });
  const roster = [1, 2].map(k => ({ agentId: `pd-agent-${k}`, name: `Agent ${k}`, emoji: '🤖', role: 'Tester' }));
  const people = generatePopulation(world, new WorldIndex(world), { population: 300, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, ms = 1e9;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 10 * 3600, dayScale: 16 };
  const dir = tempDir('mvw-plans-done-');
  const dbs = openDb(dir);
  const records = people.filter(p => p.vip).map((p, k) => ({ id: k + 1, key: p.agentId, ownerId: null, enabled: true, name: p.name, role: p.role, emoji: '', bodyRef: `person:${p.id}` }));
  const agents = { list: () => records, get: id => records.find(a => a.id === Number(id)) || null, listeners: new Set(),
    resolver: { resolveBody: ref => people.findIndex(p => `person:${p.id}` === ref) }, isOwner: () => true, canManage: () => true };
  const life = new AgentLife({ dbs, agents, sim: () => sim, now: () => ms });
  sim.start();
  life.attach();
  const a = sim.agents[life.byAgent.get(1)], shops = sim.index.venues.shop;
  const name = v => sim.brain.placeName(v.b, v.f);
  const there = shops[0], other = shops.find(v => !name(v).startsWith(name(there)) && !name(there).startsWith(name(v)));
  // what its body is reported doing (the simulation's act observers: server/sim/agents.js act)
  const does = (kind, v, { use = 'browse', ahead = 0 } = {}) => { ms += 60000; T += 30; life.observer(a, { kind, use, b: v.b, f: v.f, place: name(v), holdStart: T + ahead, holdEnd: T + ahead + 20 }); };
  const plan = text => { ms += 1000; const p = life.addIntention(1, { kind: 'must', text, today: true }, 'mind').find(x => x.text === text); return p; };
  const status = id => life.intentions(1).find(x => x.id === id);
  return { sim, life, a, dbs, there, other, name, does, plan, status, later: s => { T += s; ms += s * 1000; }, close: () => { life.stop(); dbs.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('its body closes a plan by doing it there; a brain saying so before is told it isn\'t done, and the plan stays open', () => {
  const c = setup();
  try {
    const { life, there, other, name, does, plan, status } = c;
    assert.ok(placeNames(c.sim).some(n => n.name === name(there)), 'the shop is a place a plan can name');
    const g = plan(`Groceries at ${name(there)} after work`);
    assert.equal(g.body, false, 'not done yet: its day shows nothing of it');
    // its own AI or its reflection says it's done: not so
    assert.throws(() => life.setIntention(1, g.id, 'done', { check: true }), e => e instanceof LifeError && e.status === 409 && e.code === 'not_done' && /stays open/.test(e.message));
    const r = applyActions(life, 1, { done: [g.id], drop: [], plans: [], memories: [], people: [] }, { plans: [{ id: g.id, text: g.text }] });
    assert.deepEqual(r.done, []);
    assert.deepEqual(r.skipped, ['done: not_done']);
    assert.equal(status(g.id).status, 'open');
    // shopping at another shop is not it
    does('shop', other);
    assert.equal(status(g.id).status, 'open');
    assert.throws(() => life.setIntention(1, g.id, 'done', { check: true }), /not done/i);
    // shopping there is
    does('shop', there);
    assert.equal(status(g.id).status, 'done', 'its body did it: done');
    // a plan made after it shopped there is not done by that
    const again = plan(`Groceries at ${name(there)} after work`);
    assert.throws(() => life.setIntention(1, again.id, 'done', { check: true }), /not done/i, 'what it did before planning it does not count');
    // another agent's plans are its own
    const theirs = life.addIntention(2, { kind: 'must', text: `Groceries at ${name(there)}`, today: true }, 'mind').find(x => x.status === 'open');
    does('shop', there);
    assert.equal(status(again.id).status, 'done');
    assert.equal(life.intentions(2).find(x => x.id === theirs.id).status, 'open', 'agent 2 did not go');
  } finally { c.close(); }
});

test('on its way there it is not done yet: done once its body gets there; a change of plan on the way leaves it open', () => {
  const c = setup();
  try {
    const { life, a, there, name, does, plan, status, later } = c;
    const g = plan(`Groceries at ${name(there)}`);
    does('shop', there, { ahead: 200 });   // (planned: the way there first)
    assert.equal(status(g.id).status, 'open', 'on its way');
    assert.throws(() => life.setIntention(1, g.id, 'done', { check: true }), /not done/i, 'nor may its brain say so yet');
    later(150); life.flush();
    assert.equal(status(g.id).status, 'open');
    later(60); life.flush();
    assert.equal(status(g.id).status, 'done', 'there: done');
    // on its way again for another plan, and its day changes before it gets there (its owner calls it along)
    const h = plan(`Groceries at ${name(there)} tonight`);
    does('shop', there, { ahead: 200 });
    later(20);
    life.observer(a, { kind: 'talk', use: 'talk', b: -1, f: -1, place: '', withName: 'Kim', holdStart: c.sim.now(), holdEnd: c.sim.now() + 40 });
    later(400); life.flush();
    assert.equal(status(h.id).status, 'open', 'it never got there');
  } finally { c.close(); }
});

test('a plan with nothing its body does, and its owner\'s word, are as before; Free Will is given the plans its body does', () => {
  const c = setup();
  try {
    const { life, there, name, plan, status } = c;
    const sushi = plan('Text Pema about sushi');
    assert.equal(sushi.body, null);
    life.setIntention(1, sushi.id, 'done', { check: true });
    assert.equal(status(sushi.id).status, 'done', 'nothing to check: done when it says so');
    const g = plan(`Groceries at ${name(there)} after work`), w = plan('Write a poem for Lara'), r = plan('Read a book at home');
    const ctx = life.contextFor(1);
    assert.deepEqual(ctx.planned.map(x => x.text), [g.text, r.text], 'Free Will gets the plans its body does');
    assert.deepEqual(ctx.planned.map(x => x.check.places), [[name(there)], ['Home']]);
    assert.ok(ctx.plans.some(x => x.includes(w.text)), 'and every plan in words, as before');
    life.setIntention(1, g.id, 'done');
    assert.equal(status(g.id).status, 'done', 'its owner\'s word is taken');
  } finally { c.close(); }
});
