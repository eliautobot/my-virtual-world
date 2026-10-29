// Order Up's coach (shared/orderup/guide.js, 2026-10-27: "we need some kind of indication of what to do"): a cook who
// does only what the coach says makes every dish, gets burnt food out and binned, washes up when out of plates, and
// plays a whole Rush without getting stuck.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRush, interact, work, step } from '../shared/orderup/rules.js';
import { nextStep, focusTicket, RECIPES } from '../shared/orderup/guide.js';
import { KITCHENS } from '../shared/orderup/kitchens.js';

const KITCHEN = ['ou_fridge', 'ou_pantry', 'ou_prep', 'ou_grinder', 'ou_espresso', 'ou_steamer', 'ou_oven', 'ou_press', 'ou_blender', 'ou_plating', 'ou_pass', 'ou_dishes', 'ou_sink', 'ou_bin'].map((t, i) => ({ id: i + 1, t }));
// (and the new appliances, 2026-10-28: fries, burgers, pancakes, avocado toast, cola, tea, orange juice)
const FULL = [...KITCHEN, ...['ou_fryer', 'ou_grill', 'ou_griddle', 'ou_toaster', 'ou_soda', 'ou_kettle', 'ou_juicer', 'ou_taps', 'ou_wine', 'ou_cocktail', 'ou_pizza_oven', 'ou_stove', 'ou_wok', 'ou_popcorn', 'ou_tandoor', 'ou_bamboo', 'ou_rice', 'ou_freezer'].map((t, i) => ({ id: 100 + i, t }))];
const sid = t => FULL.find(s => s.t === t).id;
/** Does what the coach says for up to `secs` of kitchen time (a beat per action, as a player's walk and press), until done(). */
function follow(S, done, secs = 120) {
  const said = [];
  for (let n = 0; S.t < secs + 1e-9 && n < 20000 && !done(); n++) {
    const g = nextStep(S); said.push(g.text);
    if (g.act === 'E') { assert.ok(S.st[sid(g.t)], `${g.text}: a station this kitchen has`); interact(S, 'you', sid(g.t), { pick: g.pick }); step(S, 0.6); }
    else if (g.act === 'F') { work(S, 'you', sid(g.t), 0.1); step(S, 0.1); }
    else step(S, 0.2);
  }
  return said;
}
const want = (S, dish) => S.tickets.push({ id: 900 + S.tickets.length, dish, at: S.t, until: S.t + 600 });

test('following the coach alone, every dish is made and served well', () => {
  for (const dish of Object.keys(RECIPES)) {
    const S = newRush(FULL, { seed: `g-${dish}`, dur: 900, menu: KITCHENS.coffee.dishes[dish].items || [dish] }); S.nextTicket = 1e9; want(S, dish);   // (sold there)
    assert.ok(S.menu.includes(dish), `${dish} on the full kitchen's menu`);
    const said = follow(S, () => S.served.length === 1, 120);
    assert.equal(S.served.length, 1, `${dish}: not served; last said: ${said.slice(-4).join(' / ')}`);
    assert.ok(['Supreme', 'Great', 'Good'].includes(S.served[0].grade), `${dish}: ${S.served[0].grade} ${S.served[0].score}`);
    assert.ok(said.every(t => typeof t === 'string' && t.length > 5), 'every step in words');
  }
});

test('the coach gets burnt food out and into the bin, then starts again', () => {
  const S = newRush(KITCHEN, { seed: 'burn', dur: 900 }); S.nextTicket = 1e9; want(S, 'croissant');
  interact(S, 'you', sid('ou_pantry')); while (S.items[S.players.you.hold].k !== 'croissant') { interact(S, 'you', sid('ou_bin')); interact(S, 'you', sid('ou_pantry')); }
  interact(S, 'you', sid('ou_oven')); for (let k = 0; k < 160; k++) step(S, 0.1);
  assert.match(nextStep(S).text, /burnt croissant out/);
  const said = follow(S, () => S.served.length === 1, 150);
  assert.ok(said.some(t => /bin/.test(t)), 'binned'); assert.equal(S.served.length, 1); assert.notEqual(S.served[0].grade, 'Bad');
});

test('out of cups: the coach washes up first', () => {
  const S = newRush(KITCHEN, { seed: 'wash', dur: 900 }); S.nextTicket = 1e9;
  const pl = S.st[sid('ou_plating')]; pl.cups = 0; S.returns.push({ at: 0, k: 'cup' }); step(S, 0.1);
  want(S, 'espresso');
  const said = follow(S, () => S.served.length === 1, 120);
  assert.ok(said.some(t => /dish return/.test(t)) && said.some(t => /wash/.test(t)), said.slice(0, 6).join(' / '));
  assert.equal(S.served.length, 1);
});

test('a whole Rush by the coach: orders served, never stuck', () => {
  const S = newRush(KITCHEN, { seed: 'rush', dur: 180 });
  let same = 0, last = '';
  for (let n = 0; n < 20000 && !S.over; n++) {
    const g = nextStep(S), key = g.text + JSON.stringify(S.players.you.hold) + S.t.toFixed(0);
    same = key === last ? same + 1 : 0; last = key; assert.ok(same < 400, `stuck on "${g.text}"`);
    if (g.act === 'E') { interact(S, 'you', sid(g.t), { pick: g.pick }); step(S, 0.6); } else if (g.act === 'F') { work(S, 'you', sid(g.t), 0.1); step(S, 0.1); } else step(S, 0.2);
  }
  assert.ok(S.over && S.served.length >= 6, `served ${S.served.length}, lost ${S.lost}`);
  assert.equal(focusTicket(S), S.tickets[0] || null);
});

test('whole Rushes by the coach in a kitchen with the new appliances: a burger joint\'s menu, a café\'s, everything, a lounge\'s, a club\'s, a diner\'s …', () => {
  for (const [what, menu, min] of [['burger joint', ['cheeseburger', 'fries', 'cola'], 6], ['café', ['espresso', 'latte', 'tea', 'croissant', 'avocado_toast', 'orange_juice', 'pancakes'], 6], ['everything', null, 6],
    ['lounge', ['martini', 'old_fashioned', 'gin_tonic', 'aperol', 'red_wine', 'white_wine', 'champagne', 'whiskey'], 8], ['club', ['margarita', 'mojito', 'cosmopolitan', 'pina_colada', 'champagne', 'beer'], 8],
    ['italian', ['bruschetta', 'caprese', 'minestrone', 'spaghetti', 'carbonara', 'pasta_pomodoro', 'lasagna', 'alfredo', 'risotto', 'gnocchi', 'ravioli', 'margherita', 'tiramisu', 'gelato', 'red_wine', 'white_wine', 'espresso', 'sparkling'], 5],
    ['asian', ['spring_rolls', 'dumplings', 'bao', 'fried_rice', 'chow_mein', 'kung_pao', 'sweet_sour', 'peking_duck', 'pad_thai', 'green_curry', 'pho', 'mochi', 'bubble_tea', 'green_tea', 'beer', 'cola'], 6],
    ['arcade', ['cola', 'lemon_soda', 'water', 'orange_juice', 'popcorn', 'pizza_slice', 'hot_dog', 'cheeseburger', 'fries', 'tacos'], 7],
    ['indian', ['samosas', 'naan', 'butter_chicken', 'tikka_masala', 'biryani', 'dal', 'palak_paneer', 'tandoori', 'mango_lassi', 'chai_latte', 'beer', 'sparkling'], 6],
    ['japanese', ['miso_soup', 'edamame', 'gyoza', 'sushi_platter', 'nigiri', 'maki', 'sashimi', 'ramen', 'tempura', 'teriyaki', 'katsu_curry', 'mochi', 'green_tea', 'sake', 'beer'], 6],
    ['dim sum and ice cream', ['dumplings', 'bao', 'ice_cream', 'gelato', 'green_tea'], 7],
    // (two parts put together, 2026-10-28: the breakfasts, the platters, the wraps, rice with what is cooked onto it)
    ['diner', ['eggs_bacon', 'full_breakfast', 'eggs_benedict', 'pancakes', 'burger_fries', 'steak_frites', 'fish_chips', 'espresso', 'cola'], 5],
    ['mexican', ['burrito', 'burrito_bowl', 'breakfast_burrito', 'fish_tacos', 'chips_guac', 'nachos', 'quesadilla', 'tacos', 'churros', 'cola'], 5],
    ['mediterranean and bowls', ['shawarma', 'gyro', 'falafel', 'hummus', 'greek_salad', 'baklava', 'poke', 'buddha_bowl', 'bagel_lox', 'water'], 5],
    // (the drinks, 2026-10-28: steamed, filled under a machine, blended, poured, as they come)
    ['coffee shop', ['espresso', 'latte', 'mocha', 'hot_chocolate', 'chai_latte', 'matcha_latte', 'iced_coffee', 'cold_brew', 'coffee_to_go', 'frappe', 'croissant'], 6],
    ['juice and shake bar', ['lemonade', 'apple_juice', 'orange_juice', 'milkshake', 'choc_shake', 'mango_lassi', 'horchata', 'bubble_tea', 'smoothie'], 7],
    ['beach bar', ['pina_colada', 'sangria', 'sake', 'bottled_beer', 'soda_can', 'margarita', 'beer'], 8]]) {
    const S = newRush(FULL, { seed: `rush-${what}`, dur: 180, ...(menu ? { menu } : {}) });
    let same = 0, last = '';
    for (let n = 0; n < 20000 && !S.over; n++) {
      const g = nextStep(S), key = g.text + JSON.stringify(S.players.you.hold) + S.t.toFixed(0);
      same = key === last ? same + 1 : 0; last = key; assert.ok(same < 400, `${what}: stuck on "${g.text}"`);
      if (g.act === 'E') { interact(S, 'you', sid(g.t), { pick: g.pick }); step(S, 0.6); } else if (g.act === 'F') { work(S, 'you', sid(g.t), 0.1); step(S, 0.1); } else step(S, 0.2);
    }
    assert.ok(S.over && S.served.length >= min, `${what}: served ${S.served.length}, lost ${S.lost}`);
    console.log(`# ${what}: served ${S.served.length} (${[...new Set(S.served.map(x => x.dish))].join(' ')}), lost ${S.lost}, stars ${S.ev.at(-1).stars}`);
  }
});

test('every item a place may sell (all but home cooking) is a dish of Order Up, made by the coach above', async () => {
  // (2026-10-28, the product owner: "go ahead and make all the ones that are pending")
  const { FOOD_BY_ID } = await import('../shared/food.js'), K = KITCHENS.coffee, covered = new Set();
  for (const [id, d] of Object.entries(K.dishes)) for (const x of d.items || [id]) covered.add(x);
  const left = Object.values(FOOD_BY_ID).filter(f => f.cat !== 'home' && !covered.has(f.id)).map(f => f.id);
  assert.deepEqual(left, [], `no dish yet: ${left.join(', ')}`);
  for (const [id, d] of Object.entries(K.dishes)) if (d.recipe) assert.ok(RECIPES[id], `${id}: its recipe in words`);
});
