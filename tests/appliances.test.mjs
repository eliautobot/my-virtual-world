// What every menu item needs (shared/appliances.js; the product owner 2026-10-27: "to add fries to the menu, you will
// need a fryer"): every item of the pack says, every appliance it names is known, the café's own kitchen agrees with it,
// and a menu's missing appliances are put into words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOOD_BY_ID, CUISINES } from '../shared/food.js';
import { APPLIANCES, NEEDS_IDS, needsOf, appliancesIn, missingFor, menuNeeds, needWords, APPLIANCE_OF_PIECE } from '../shared/appliances.js';
import { KITCHENS } from '../shared/orderup/kitchens.js';

test('every item of the pack says which appliances it needs, every one of them known', () => {
  assert.deepEqual(Object.keys(FOOD_BY_ID).filter(id => !NEEDS_IDS.includes(id)), [], 'items without needs');
  assert.deepEqual(NEEDS_IDS.filter(id => !FOOD_BY_ID[id]), [], 'needs for items that are not in the pack');
  for (const id of NEEDS_IDS) for (const k of needsOf(id)) assert.ok(APPLIANCES[k], `${id}: ${k}`);
  for (const [k, A] of Object.entries(APPLIANCES)) if (A.piece) assert.equal(APPLIANCE_OF_PIECE[A.piece], k);
});

test('the café\'s own kitchen has what its dishes need', () => {
  const K = KITCHENS.coffee;
  for (const [d, dish] of Object.entries(K.dishes)) {
    const have = appliancesIn(dish.needs);
    for (const id of dish.items || [d]) {   // (the menu items it is)
      assert.ok(FOOD_BY_ID[id], `${d}: a menu item (${id})`);
      assert.deepEqual(needsOf(id).filter(k => !have.has(k)), [], `${d} as ${id}: its stations lack what it needs`);
    }
  }
});

test('a coffee shop adding fries is told it needs a fryer; a menu says what it lacks, the most wanted first', () => {
  const coffee = appliancesIn(['ou_grinder', 'ou_espresso', 'ou_steamer', 'ou_fridge', 'ou_pantry', 'ou_oven', 'ou_prep', 'ou_blender', 'ou_press']);
  assert.equal(needWords('latte', coffee), '');
  assert.equal(needWords('fries', coffee), 'To add Fries to the menu, you will need a fryer');
  assert.match(needWords('cheeseburger', new Set()), /you will need a grill, a prep counter, a fridge and a pantry$/);
  assert.equal(needWords('beer', coffee), 'To add Pint of lager to the menu, you will need beer taps');
  const burger = CUISINES.find(c => c.id === 'burger').menu, miss = missingFor(burger, coffee);
  assert.equal(miss[0].key, 'grill', JSON.stringify(miss.map(m => [m.key, m.items.length])));
  assert.ok(miss.some(m => m.key === 'fryer'));
  assert.ok(menuNeeds(burger).get('grill') >= 5);
});

test('every appliance a menu can name has its machine, and every item somewhere its ingredients come from', () => {
  // (2026-10-28, the product owner: "do they all have all the required machines/appliances/cookware so that adding
  // additional cooking items doesn't involve adding new things to cook them with?")
  assert.deepEqual(Object.entries(APPLIANCES).filter(([, A]) => !A.piece).map(([k]) => k), [], 'appliances without a piece');
  // a store (the fridge, the pantry) or a machine that makes or pours its own (the grinder, the soda fountain, the tea
  // station, the wine fridge, the freezer, the taps, the cocktail station)
  const MAKERS = new Set(['fridge', 'pantry', 'grinder', 'soda', 'kettle', 'wine', 'freezer', 'taps', 'cocktail']);
  const none = Object.values(FOOD_BY_ID).filter(f => f.cat !== 'home' && !needsOf(f.id).some(k => MAKERS.has(k))).map(f => f.id);
  assert.deepEqual(none, [], 'items with nowhere for their ingredients to come from');
});
