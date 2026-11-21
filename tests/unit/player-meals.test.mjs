// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A player's meal on the pages (client/js/player/meals.js): the server's word (t: 'pmeal') is what is in front of them —
// served the way the residents' meals are (the drink first, then the starter, the main, the dessert, the drink beside
// each) over the meal's time; over, or emptied, nothing; a page that comes in late picks the meal up where it is.
import assert from 'node:assert/strict';
import test from 'node:test';
import '../helpers/client-paths.mjs';
import { FOOD_BY_ID } from '../../shared/food.js';

const { meals, onMeal, servedNow } = await import('../../client/js/player/meals.js');

test('the courses of a player\'s meal over its time, the drink beside the dish; over, nothing', () => {
  meals.clear();
  const main = FOOD_BY_ID.pho || Object.values(FOOD_BY_ID).find(f => f.course === 'main');
  const cake = Object.values(FOOD_BY_ID).find(f => f.course === 'dessert');
  const cola = FOOD_BY_ID.cola || Object.values(FOOD_BY_ID).find(f => f.v);
  const t0 = 1e6;
  onMeal({ pid: 7, items: [main.n, cake.n, cola.n], el: 0, dur: 600000 }, t0);
  const first = servedNow(7, t0 + 1000);
  assert.deepEqual(first, { item: cola.n, side: 0, sip: true }, 'the drink first');
  const mid = servedNow(7, t0 + 300000);
  assert.deepEqual(mid, { item: main.n, side: cola.n, sip: false }, 'the main, the drink beside it');
  const late = servedNow(7, t0 + 590000);
  assert.deepEqual(late, { item: cake.n, side: cola.n, sip: false }, 'the dessert last');
  assert.equal(servedNow(7, t0 + 600001), null, 'over');
  // a page coming in late: where the meal is now
  onMeal({ pid: 8, items: [main.n], el: 50000, dur: 100000 }, t0);
  assert.equal(servedNow(8, t0 + 49000)?.item, main.n);
  assert.equal(servedNow(8, t0 + 51000), null);
  // emptied (they got up): nothing; anything that isn't food is not served
  onMeal({ pid: 7, items: [], el: 0, dur: 0 }, t0);
  assert.equal(servedNow(7, t0 + 1), null);
  onMeal({ pid: 9, items: [9999, 'x'], el: 0, dur: 1000 }, t0);
  assert.equal(servedNow(9, t0 + 1), null);
});
