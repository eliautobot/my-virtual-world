// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Home meals follow the home's furniture (2026-10-08, "they place the pan on a countertop and cook without a stove…
// if the agent has no table they can only eat handheld items… food type and seating type need to go hand in hand"):
// a generated city run for a day — every cooking is at a stove (a kitchen unit's hob), something cold is made at a
// counter only, a home without a stove never makes a dish cooked on one, and a home without a table eats only food held
// in the hands (on a seat, or standing in the kitchen).
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateWorld } from '../server/world/generate.js';
import { generatePopulation } from '../server/sim/population.js';
import { WorldIndex } from '../server/sim/windex.js';
import { Sim } from '../server/sim/sim.js';
import { Brain } from '../server/sim/agents.js';
import { onStove, byHand, homeMeal } from '../shared/food.js';

test('home meals: cooking at a stove, cold food at a counter, and without a table only food held in the hands', () => {
  const world = generateWorld({ seed: 'kitchen-city', population: 900 });
  const people = generatePopulation(world, new WorldIndex(world), { population: 900, roster: [] });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  const seen = [], useAt = Brain.prototype.useAt;
  Brain.prototype.useAt = function (a, P, b, f, uses, dur, o = {}) {
    const r = useAt.call(this, a, P, b, f, uses, dur, o);
    if (r && o.place === 'Home') seen.push({ k: this.homeKitchen(a), slot: r.st.s.use, use: o.use, anim: o.anim, dish: o.order?.[0] || null, kind: o.kind });
    return r;
  };
  try {
    let T = 0;
    sim.now = () => T;
    sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 5 * 3600, dayScale: 16 };
    sim.start();
    while (T < 26 * 3600 / 16) { T += 0.5; sim.tick(); sim.flush(); }
  } finally { Brain.prototype.useAt = useAt; }
  const cooks = seen.filter(e => e.use === 'cook'), preps = seen.filter(e => e.use === 'prep'), meals = seen.filter(e => e.kind === 'meal');
  assert.ok(cooks.length > 20 && preps.length > 20 && meals.length > 100, `a day of meals: ${cooks.length} cooked, ${preps.length} made cold, ${meals.length} eaten`);
  for (const e of cooks) { assert.equal(e.slot, 'cook', 'cooking is at a stove'); assert.ok(e.k.stove); if (e.dish) assert.ok(onStove(e.dish), `${e.dish} is cooked`); }
  for (const e of preps) { assert.equal(e.slot, 'prep', 'cold food is made at a counter'); if (e.dish) assert.ok(!onStove(e.dish), `${e.dish} needs no stove`); }
  for (const e of meals) {
    if (!e.dish) continue;
    if (!e.k.stove) assert.ok(!onStove(e.dish), `no stove at home, yet ${e.dish}`);
    if (!e.k.table) { assert.ok(byHand(e.dish), `no table at home, yet ${e.dish}`); assert.ok(e.slot !== 'eat'); }
    else assert.equal(e.slot, 'eat', 'with a table, at the table');
  }
  // homes of every kind were seen (the city has stoves and counters, and some homes with no table)
  assert.ok(meals.some(e => e.k.stove) && meals.some(e => !e.k.stove) && meals.some(e => !e.k.table), 'every kind of home ate');
  assert.ok(meals.some(e => !e.k.table && !e.k.seat && e.anim !== undefined) || !meals.some(e => !e.k.table && !e.k.seat), 'standing in the kitchen when there is no seat either');
});

test('a home\'s dish fits its kitchen and its seats (shared/food.js homeMeal)', () => {
  const r = s => t => { let h = 2166136261; for (const c of s + t) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
  for (const home of [{ stove: false }, { table: false }, { stove: false, table: false }]) for (const hour of [8, 13, 19]) for (let i = 0; i < 200; i++) {
    const [dish] = homeMeal(hour, r(`${i}`), home);
    if (home.stove === false) assert.ok(!onStove(dish), `${dish} without a stove`);
    if (home.table === false) assert.ok(byHand(dish), `${dish} without a table`);
  }
  // with both, the meal's own list as before (every routine unchanged there)
  assert.deepEqual(homeMeal(19, r('x'), {}), homeMeal(19, r('x')));
});
