// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The food and drink pack (shared/food.js) and its models (client/js/render/food-models.js): numbers that travel on the
// wire never move, every item has a model and every drink a glass someone can hold, every kind of place's menu is made
// of known items, what residents order comes from the menu they were given (same order for the same who and when), and
// a visit's courses fill its time in a sensible order.
import assert from 'node:assert/strict';
import test from 'node:test';
import '../helpers/client-paths.mjs';
import { FOOD, FOOD_BY_ID, FOOD_BY_N, CUISINES, FOOD_CATS, MENU_MAX, pickOrder, courses, homeMeal, guessCuisine, menuIds, isDrink, foodName } from '../../shared/food.js';
import { REST_NAMES, CAFE_NAMES } from '../../shared/names.js';

const r = seed => tag => { let h = 2166136261; for (const c of `${seed}:${tag}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

test('item numbers are unique, 1..255, and pinned (the plans carry them)', () => {
  assert.equal(new Set(FOOD.map(i => i.n)).size, FOOD.length);
  assert.ok(FOOD.every(i => i.n >= 1 && i.n <= 255 && FOOD_BY_N[i.n] === i && FOOD_BY_ID[i.id] === i));
  // a few pinned numbers: changing one would show yesterday's plans the wrong food
  for (const [id, n] of [['coffee', 1], ['latte', 3], ['pancakes', 20], ['cheeseburger', 70], ['margherita', 90], ['sushi_platter', 170], ['beer', 86], ['ribeye', 250], ['brisket', 255], ['glass_water', 184]]) assert.equal(FOOD_BY_ID[id].n, n, id);
  assert.ok(FOOD.length >= 200 && FOOD_CATS.every(c => FOOD.some(i => i.cat === c.id)));
});

test('every item has a model, every drink a glass to hold and a colour', async () => {
  const M = await import('../../client/js/render/food-models.js');
  for (const it of FOOD) {
    assert.ok(M.hasModel(it.id), `${it.id} has no model`);
    if (isDrink(it)) { assert.ok(M.VESSELS[it.v] && M.VESSEL_DIMS[it.v], `${it.id}: glass ${it.v}`); assert.match(it.liq, /^#[0-9a-f]{6}$/); }
  }
  const g = M.foodGeometry(FOOD_BY_ID.pad_thai.n), b = g.geo.boundingBox;
  assert.ok(b.max.x < 0.2 && b.min.x > -0.2 && b.max.y < 0.2 && b.min.y >= -0.001, 'a dish fits a place at a table');
  assert.ok(M.foodGeometry(FOOD_BY_ID.home_pasta.n, true).geo, 'what cooks on the stove');
});

test('every kind of place has a menu of known items; places are guessed from their names', () => {
  for (const c of CUISINES) { assert.ok(c.menu.length >= 10 && c.menu.length <= MENU_MAX, c.id); assert.ok(c.menu.every(id => FOOD_BY_ID[id])); assert.equal(new Set(c.menu).size, c.menu.length, c.id); }
  assert.equal(guessCuisine('Burger Joint', 'restaurant'), 'burger');
  assert.equal(guessCuisine('Harbor Fish Co', 'restaurant'), 'seafood');
  assert.equal(guessCuisine('Sakura Sushi', 'restaurant'), 'japanese');
  assert.equal(guessCuisine('Kettle & Crumb', 'cafe'), 'bakery');
  assert.equal(guessCuisine('Restaurant 16 Dining Room', 'restaurant', 4), guessCuisine('Restaurant 16', 'restaurant', 4), 'a dining room upstairs is the same kind');
  for (const n of REST_NAMES || []) assert.ok(guessCuisine(n, 'restaurant'), n);
  for (const n of CAFE_NAMES || []) assert.ok(guessCuisine(n, 'cafe'), n);
  assert.deepEqual(menuIds('pizza', ['latte', 'nope']), ['latte'], 'an own menu keeps known items only');
  assert.deepEqual(menuIds('pizza', ['nope']), CUISINES.find(c => c.id === 'pizza').menu, 'nothing known: the usual menu');
  assert.equal(foodName('meal'), 'Main course', 'the old items keep their names in old books');
});

test('orders come from the menu, the same for the same who and when, and suit the occasion', () => {
  const menus = CUISINES.map(c => c.menu);
  for (let k = 0; k < 400; k++) {
    const m = menus[k % menus.length], occ = ['meal', 'breakfast', 'cafe', 'coffee', 'bar'][k % 5], h = [8, 12.5, 19.5][k % 3];
    const o = pickOrder(m, occ, h, r(k));
    assert.ok(o.length >= 1 && o.every(id => m.includes(id)), `${occ} from the menu`);
    assert.deepEqual(pickOrder(m, occ, h, r(k)), o, 'deterministic');
    assert.equal(new Set(o).size, o.length);
  }
  const bar = CUISINES.find(c => c.id === 'bar').menu, alc = id => FOOD_BY_ID[id].t === 'alc';
  const drinks = Array.from({ length: 200 }, (_, k) => pickOrder(bar, 'bar', 21, r(`b${k}`))[0]);
  assert.ok(drinks.filter(alc).length > 150, 'at a bar mostly beer, wine and cocktails');
  const cafe = CUISINES.find(c => c.id === 'cafe').menu, morning = Array.from({ length: 200 }, (_, k) => pickOrder(cafe, 'breakfast', 8, r(`c${k}`)));
  assert.ok(morning.filter(o => FOOD_BY_ID[o[0]].bf).length > 150, 'a breakfast order starts with breakfast');
  const dinner = Array.from({ length: 200 }, (_, k) => pickOrder(CUISINES.find(c => c.id === 'italian').menu, 'meal', 19.5, r(`d${k}`)));
  assert.ok(dinner.every(o => FOOD_BY_ID[o[0]].course === 'main'), 'a dinner starts with a main course');
  assert.equal(pickOrder([], 'meal', 12, r(1)).length, 0);
  const hm = homeMeal(19, r('h'));
  assert.ok(hm.every(id => FOOD_BY_ID[id]) && !isDrink(FOOD_BY_ID[hm[0]]));
});

test('courses: the drink first and alone, then the food in order (starter, main, dessert), sharing the whole visit', () => {
  const cs = courses(['spaghetti', 'red_wine', 'tiramisu', 'bruschetta']);
  assert.ok(Math.abs(cs.reduce((s, c) => s + c.f, 0) - 1) < 1e-9);
  assert.deepEqual(cs.map(c => FOOD_BY_N[c.item].id), ['red_wine', 'bruschetta', 'spaghetti', 'tiramisu']);
  assert.deepEqual(cs.map(c => c.sip), [true, false, false, false]);
  const two = courses(['beer', 'stout']);
  assert.deepEqual(two.map(c => [FOOD_BY_N[c.item].id, c.sip, c.f]), [['beer', true, 0.5], ['stout', true, 0.5]]);
});

test('the simulation orders from the venue\'s menu (the economy\'s, else its kind\'s), and not at all with food off', async () => {
  const { generateWorld } = await import('../../server/world/generate.js');
  const { generatePopulation } = await import('../../server/sim/population.js');
  const { WorldIndex } = await import('../../server/sim/windex.js');
  const { Sim } = await import('../../server/sim/sim.js');
  const world = generateWorld({ seed: 'food-test', population: 200 });
  const sim = new Sim(world, generatePopulation(world, new WorldIndex(world), { population: 200, roster: [] }), { budgetMs: 1e9 });
  const B = sim.brain, a = sim.agents.find(x => x), v = B.index.venues.restaurant[0];
  const L = world.levels[world.buildings[v.b].lv[v.f]];
  const o = B.orderAt(a, v.b, v.f, 'meal', 1000);
  assert.ok(o.order.every(id => menuIds(guessCuisine(L.name || world.buildings[v.b].name, 'restaurant', v.b)).includes(id)), 'no economy: the kind of place from its name');
  sim.econ = { menuAt: () => ['margherita', 'cola'] };
  for (let t = 1000; t < 1100; t += 7) assert.ok(B.orderAt(a, v.b, v.f, 'meal', t).order.every(id => ['margherita', 'cola'].includes(id)));
  sim.food = false;
  assert.deepEqual(B.orderAt(a, v.b, v.f, 'meal', 1000), {});
});
