// Order Up's rules (shared/orderup/rules.js, phase 3 of PLAN-RESTAURANT-GAME.md): each dish made by a scripted cook,
// timing and grades, burning, the pass, dishes washed, tickets lost, the same seed the same Rush.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRush, interact, work, step, starsOf, gradeOf, stepScore, AUTO, DISHES, stationView, choices } from '../shared/orderup/rules.js';

const KITCHEN = ['ou_fridge', 'ou_pantry', 'ou_prep', 'ou_grinder', 'ou_espresso', 'ou_steamer', 'ou_oven', 'ou_press', 'ou_blender', 'ou_plating', 'ou_pass', 'ou_dishes', 'ou_sink', 'ou_bin'].map((t, i) => ({ id: i + 1, t }));
const id = t => KITCHEN.find(s => s.t === t).id;
const run = (S, s) => { for (let k = 0; k < Math.round(s / 0.1); k++) step(S, 0.1); };
const hold = (S, t, s) => { for (let k = 0; k < Math.round(s / 0.1); k++) { work(S, 'you', id(t), 0.1); step(S, 0.1); } };
const E = (S, t) => interact(S, 'you', id(t));
const held = S => S.items[S.players.you.hold];
const want = (S, dish) => { S.tickets.push({ id: 900 + S.tickets.length, dish, at: S.t, until: S.t + 300 }); };
/** Takes from a dispenser until the hand holds kind k. */
const takeK = (S, t, k) => { for (let n = 0; n < 4; n++) { E(S, t); if (held(S)?.k === k) return; E(S, 'ou_bin'); } assert.fail(`no ${k} from ${t}`); };

function shot(S, wait = 4) {
  hold(S, 'ou_grinder', 2); assert.equal(E(S, 'ou_grinder'), 'take'); assert.equal(held(S).k, 'grounds');
  assert.equal(E(S, 'ou_espresso'), 'load');
  interact(S, 'you', id('ou_plating'), { pick: 'cup' });
  assert.equal(held(S).k, 'cup'); assert.equal(E(S, 'ou_espresso'), 'put');
  run(S, wait); assert.equal(E(S, 'ou_espresso'), 'take'); return held(S);
}

test('an espresso, a latte with art, a smoothie: made, served at the pass, graded', () => {
  const S = newRush(KITCHEN, { seed: 't1', dur: 600 }); S.nextTicket = 1e9;
  assert.deepEqual(S.menu, ['espresso', 'latte', 'smoothie', 'croissant', 'toastie']);
  want(S, 'espresso'); const c = shot(S, 4); assert.equal(c.st, 'shot'); assert.deepEqual(c.q, [100]);
  assert.equal(E(S, 'ou_pass'), 'serve'); assert.equal(S.served[0].grade, 'Supreme');
  // a latte: a shot on the counter, milk steamed, poured in
  want(S, 'latte'); shot(S, 4.5); assert.equal(E(S, 'ou_prep'), 'put');
  takeK(S, 'ou_fridge', 'milk'); assert.equal(E(S, 'ou_steamer'), 'put'); run(S, 5); assert.equal(E(S, 'ou_steamer'), 'take');
  assert.equal(held(S).st, 'steamed'); assert.equal(E(S, 'ou_prep'), 'mix'); assert.equal(E(S, 'ou_prep'), 'take');
  assert.equal(held(S).st, 'latte'); assert.ok(held(S).art, 'latte art: both perfect'); assert.equal(E(S, 'ou_pass'), 'serve');
  assert.equal(S.served[1].grade, 'Supreme');
  // a smoothie: berries blended, poured into a glass held to the blender (not a coffee cup: it won't take one)
  want(S, 'smoothie'); takeK(S, 'ou_fridge', 'berries'); assert.equal(E(S, 'ou_blender'), 'put'); run(S, 4);
  interact(S, 'you', id('ou_plating'), { pick: 'cup' }); assert.equal(E(S, 'ou_blender'), null, 'a coffee cup: no'); E(S, 'ou_bin');
  interact(S, 'you', id('ou_plating'), { pick: 'glass' }); assert.equal(held(S).k, 'glass');
  assert.equal(E(S, 'ou_blender'), 'mix'); assert.equal(held(S).st, 'smoothie'); assert.equal(E(S, 'ou_pass'), 'serve');
  assert.ok(S.money > 10 && S.tips > 0, `money ${S.money}, tips ${S.tips}`);
});

test('a croissant and a toastie: warmed, chopped, pressed, plated', () => {
  const S = newRush(KITCHEN, { seed: 't2', dur: 600 }); S.nextTicket = 1e9;
  want(S, 'croissant'); takeK(S, 'ou_pantry', 'croissant'); assert.equal(E(S, 'ou_oven'), 'put'); run(S, 7);
  interact(S, 'you', id('ou_plating'), { pick: 'plate' });
  assert.equal(E(S, 'ou_oven'), 'mix'); assert.equal(held(S).on, 'croissant'); assert.equal(E(S, 'ou_pass'), 'serve');
  want(S, 'toastie'); takeK(S, 'ou_fridge', 'tomato'); E(S, 'ou_prep'); hold(S, 'ou_prep', 2.5);
  assert.equal(S.items[S.st[id('ou_prep')].slot].st, 'chopped');
  takeK(S, 'ou_pantry', 'bread'); assert.equal(E(S, 'ou_prep'), 'mix'); assert.equal(E(S, 'ou_prep'), 'take');
  assert.equal(held(S).k, 'toastie'); assert.equal(E(S, 'ou_press'), 'put'); run(S, 6);
  interact(S, 'you', id('ou_plating'), { pick: 'plate' });
  assert.equal(E(S, 'ou_press'), 'mix'); assert.equal(E(S, 'ou_pass'), 'serve');
  assert.deepEqual(S.served.map(x => x.grade), ['Supreme', 'Supreme']);
});

test('timing: perfect, going over, burnt (Bad at best); a cold drink loses its grade; skill widens the window', () => {
  const a = AUTO.ou_oven;
  assert.equal(stepScore(a, a.cook - 0.1), 0); assert.equal(stepScore(a, a.cook + 1), 100); assert.equal(stepScore(a, a.burn + 1), 25);
  const mid = stepScore(a, (a.cook + a.perfect + a.burn) / 2); assert.ok(mid > 40 && mid < 100, `${mid}`);
  assert.ok(stepScore(a, a.cook + a.perfect + 0.5, 10) === 100 && stepScore(a, a.cook + a.perfect + 0.5, 0) < 100, 'a skilled cook has longer');
  const S = newRush(KITCHEN, { seed: 't3', dur: 600 }); S.nextTicket = 1e9;
  want(S, 'croissant'); takeK(S, 'ou_pantry', 'croissant'); E(S, 'ou_oven'); run(S, a.burn + 1);
  assert.equal(S.ev.at(-1).k, 'burnt'); assert.ok(stationView(S, id('ou_oven')).burnt);
  interact(S, 'you', id('ou_plating'), { pick: 'plate' });
  E(S, 'ou_oven'); E(S, 'ou_pass'); assert.ok(['Poor', 'Bad'].includes(S.served[0].grade), S.served[0].grade);
  want(S, 'espresso'); shot(S, 4); run(S, 20); E(S, 'ou_pass');
  assert.ok(S.served[1].score <= 64, `an espresso 20 s old: ${S.served[1].score}`);
  assert.deepEqual([10, 30, 50, 70, 85, 95].map(gradeOf), ['Poor', 'Bad', 'Medium', 'Good', 'Great', 'Supreme']);
});

test('the pass takes only what a ticket wants; plates come back dirty and are washed; nothing in hand at the grinder', () => {
  const S = newRush(KITCHEN, { seed: 't4', dur: 600 }); S.nextTicket = 1e9;
  const c = shot(S, 4); assert.equal(E(S, 'ou_pass'), null, 'nobody wants an espresso'); assert.equal(held(S), c);
  want(S, 'espresso'); assert.equal(E(S, 'ou_pass'), 'serve'); run(S, 9);
  const dr = S.st[id('ou_dishes')]; assert.equal(dr.dirty.length, 1);
  assert.equal(E(S, 'ou_dishes'), 'take'); assert.equal(held(S).st, 'dirty'); const cups = S.st[id('ou_plating')].cups;
  assert.equal(E(S, 'ou_sink'), 'put'); hold(S, 'ou_sink', 1.5); assert.equal(S.st[id('ou_plating')].cups, cups + 1);
  assert.ok(S.ev.some(e => e.k === 'washed' && e.item === 'cup'), 'the washed event says so (and what)');
  E(S, 'ou_pantry'); assert.equal(work(S, 'you', id('ou_grinder'), 0.5), false, 'hands full: no grinding');
});

test('a Rush: tickets come, go unserved and are lost; it ends with its stars; the same seed, the same tickets', () => {
  const a = newRush(KITCHEN, { seed: 'same', dur: 180 }), b = newRush(KITCHEN, { seed: 'same', dur: 180 });
  run(a, 181); run(b, 181);
  assert.ok(a.over && a.lost >= 3, `lost ${a.lost}`);
  assert.deepEqual(a.ev.filter(e => e.k === 'ticket').map(e => e.dish + e.t), b.ev.filter(e => e.k === 'ticket').map(e => e.dish + e.t));
  assert.equal(starsOf(a), 0);
  const c = newRush(KITCHEN, { dur: 180 }); c.served = Array(10).fill({}); c.lost = 2; c.points = 900; assert.equal(starsOf(c), 2, '900 of 1200');
  c.points = 1000; c.lost = 0; assert.equal(starsOf(c), 3, 'all ten served, near perfect'); c.served = Array(3).fill({}); c.points = 290; assert.equal(starsOf(c), 2, 'few served: not 3');
  // a kitchen without a blender or a press: no smoothies, no toasties
  const small = newRush(KITCHEN.filter(s => s.t !== 'ou_blender' && s.t !== 'ou_press'), { dur: 60 });
  assert.deepEqual(small.menu, ['espresso', 'latte', 'croissant']);
  for (const d of Object.values(DISHES)) assert.ok(d.price > 0 && (d.needs.includes('ou_plating') || !d.ware), d.name);   // (served in something: the plating counter's)
});

test('the picker: the fridge, the pantry and the plating counter give what is chosen', () => {
  const S = newRush(KITCHEN, { seed: 'pick', dur: 600 });
  assert.equal(interact(S, 'you', id('ou_fridge'), { pick: 'berries' }), 'give'); assert.equal(held(S).k, 'berries'); E(S, 'ou_bin');
  interact(S, 'you', id('ou_pantry'), { pick: 'bread' }); assert.equal(held(S).k, 'bread'); E(S, 'ou_bin');
  interact(S, 'you', id('ou_plating'), { pick: 'cup' }); assert.equal(held(S).k, 'cup');
  assert.equal(E(S, 'ou_plating'), 'give', 'E again straight after: swapped'); assert.equal(held(S).k, 'glass', 'for the next kind'); E(S, 'ou_bin'); step(S, 2);
  interact(S, 'you', id('ou_plating'), { pick: 'plate' }); assert.equal(held(S).k, 'plate');
  assert.deepEqual(choices(S, id('ou_fridge')).map(c => c.k), ['milk', 'tomato', 'berries']);
  assert.deepEqual(choices(S, id('ou_plating')).map(c => [c.k, c.left]), [['plate', 2], ['cup', 4], ['glass', 2]]);   // (the swapped cup back on its stack, the glass binned)
  E(S, 'ou_bin'); step(S, 2); interact(S, 'you', id('ou_plating'), { pick: 'glass' }); assert.equal(held(S).k, 'glass');
});

test('a kitchen is a template: a made-up snack bar plays its own dishes with the same rules', () => {
  // (PLAN-RESTAURANT-GAME.md 6b K4, the product owner 2026-10-27: "a good first template for the rest"; the stations here
  // are this test's own, no catalog pieces)
  const SNACK = {
    id: 'test-snack', name: 'Snack bar',
    dishes: {
      popcorn: { name: 'Popcorn', price: 3, needs: ['ou_kernels', 'ou_popper', 'ou_plating'] },
      soda: { name: 'Soda', price: 2, needs: ['ou_fountain', 'ou_plating'] },
      hotdog: { name: 'Hot Dog', price: 4, food: true, needs: ['ou_cupboard', 'ou_grill', 'ou_plating'] },
      nachos: { name: 'Nachos', price: 5, food: true, needs: ['ou_nacho_warmer', 'ou_plating'] },   // (no warmer here: off the menu)
    },
    stations: {
      ou_kernels: { role: 'make', s: 1, makes: 'kernels', st: 'dry' },
      ou_popper: { role: 'cook', k: 'bag', from: 'empty', to: 'popcorn', over: 'scorched', cook: 3, perfect: 3, burn: 9, loaded: 'kernels' },
      ou_fountain: { role: 'cook', k: 'cup', from: 'empty', to: 'soda', over: 'overflowing', cook: 2, perfect: 4, burn: 12 },
      ou_cupboard: { role: 'give', gives: ['sausage', 'bun'] },
      ou_grill: { role: 'cook', k: 'sausage', from: 'raw', to: 'grilled', over: 'burnt', cook: 4, perfect: 3, burn: 10 },
      ou_plating: { role: 'plating', counter: true },
      ou_counter: { role: 'counter', counter: true },
      ou_pass: { role: 'pass' },
      ou_bin: { role: 'bin' },
    },
    fresh: { sausage: 'raw', bun: 'plain' },
    ware: { bag: { stack: 'bags', clean: 'empty', n: 2 }, cup: { stack: 'cups', clean: 'empty', n: 2 }, tray: { stack: 'trays', clean: 'clean', n: 2, on: true } },
    onWare: { hotdog: ['ready', 'burnt'] },
    combos: [{ a: ['bun'], b: ['sausage', ['grilled', 'burnt']], k: 'hotdog', st: 'ready', q: 'b' }, { onWare: true }],
    served: { bag: { popcorn: 'popcorn' }, cup: { soda: 'soda' }, tray: { hotdog: 'hotdog' } },
  };
  const ST = ['ou_kernels', 'ou_popper', 'ou_fountain', 'ou_cupboard', 'ou_grill', 'ou_plating', 'ou_counter', 'ou_pass', 'ou_bin'].map((t, i) => ({ id: i + 1, t }));
  const sid = t => ST.find(s => s.t === t).id, at = (S, t, o) => interact(S, 'you', sid(t), o);
  const S = newRush(ST, { kitchen: SNACK, seed: 'snack' }), h = () => S.items[S.players.you.hold];
  const go = s => { for (let k = 0; k < Math.round(s / 0.1); k++) step(S, 0.1); };
  assert.equal(S.kitchen, 'test-snack');
  assert.deepEqual(S.menu, ['popcorn', 'soda', 'hotdog']);
  assert.deepEqual(choices(S, sid('ou_plating')).map(c => [c.k, c.left]), [['bag', 2], ['cup', 2], ['tray', 2]]);
  assert.deepEqual(choices(S, sid('ou_cupboard')).map(c => c.k), ['sausage', 'bun']);
  for (const d of ['popcorn', 'soda', 'hotdog']) S.tickets.push({ id: 800 + S.tickets.length, dish: d, at: 0, until: 300 });
  // popcorn: kernels made by hand, loaded, a bag under the popper, popped, served
  for (let k = 0; k < 12; k++) { work(S, 'you', sid('ou_kernels'), 0.1); step(S, 0.1); }
  assert.equal(at(S, 'ou_kernels'), 'take'); assert.equal(h().k, 'kernels');
  assert.equal(at(S, 'ou_popper'), 'load');
  at(S, 'ou_plating', { pick: 'bag' }); assert.equal(h().k, 'bag');
  assert.equal(at(S, 'ou_popper'), 'put'); go(4);
  assert.equal(at(S, 'ou_popper'), 'take'); assert.equal(h().st, 'popcorn');
  assert.equal(at(S, 'ou_pass'), 'serve');
  // soda: a cup at the fountain, filled, served
  at(S, 'ou_plating', { pick: 'cup' }); assert.equal(at(S, 'ou_fountain'), 'put'); go(3);
  assert.equal(at(S, 'ou_fountain'), 'take'); assert.equal(at(S, 'ou_pass'), 'serve');
  // a hot dog: the sausage grilled, into the bun, onto a tray, served
  at(S, 'ou_cupboard', { pick: 'sausage' }); assert.equal(at(S, 'ou_grill'), 'put'); go(5);
  at(S, 'ou_plating', { pick: 'tray' }); assert.equal(h().k, 'tray');
  assert.equal(at(S, 'ou_bin'), 'bin');
  at(S, 'ou_cupboard', { pick: 'bun' }); assert.equal(at(S, 'ou_grill'), 'mix'); assert.equal(h().k, 'hotdog');
  assert.equal(at(S, 'ou_counter'), 'put');   // (set down on the counter)
  at(S, 'ou_plating', { pick: 'tray' }); assert.equal(h().k, 'tray');
  assert.equal(at(S, 'ou_counter'), 'mix'); assert.equal(h().on, 'hotdog', 'the tray in hand: the hot dog onto it, the tray still in hand');
  assert.equal(at(S, 'ou_pass'), 'serve');
  assert.deepEqual(S.served.map(x => [x.dish, x.grade]), [['popcorn', 'Supreme'], ['soda', 'Supreme'], ['hotdog', 'Supreme']]);
  // the café's own Rush is unchanged by it: its template is the default
  assert.equal(newRush(KITCHEN).kitchen, 'coffee');
});

// (2026-10-28, the product owner: "to add fries to the menu, you will need a fryer": what the new appliances cook)
const FULL = [...KITCHEN, ...['ou_fryer', 'ou_grill', 'ou_griddle', 'ou_toaster', 'ou_soda', 'ou_kettle', 'ou_juicer', 'ou_taps', 'ou_wine', 'ou_cocktail', 'ou_pizza_oven', 'ou_stove', 'ou_wok', 'ou_popcorn', 'ou_tandoor', 'ou_bamboo', 'ou_rice', 'ou_freezer'].map((t, i) => ({ id: 100 + i, t }))];
const fid = t => FULL.find(s => s.t === t).id;
const F = (S, t, o) => interact(S, 'you', fid(t), o);

test('the new appliances: fries, a cheeseburger in its wrap, pancakes, avocado toast, cola, tea, orange juice', () => {
  const S = newRush(FULL, { seed: 'new', dur: 900 }); S.nextTicket = 1e9;
  const serve = dish => { want(S, dish); assert.equal(F(S, 'ou_pass'), 'serve', dish); assert.equal(S.served.at(-1).dish, dish); };
  // fries: frozen from the fridge, fried, onto a plate
  F(S, 'ou_fridge', { pick: 'fries' }); assert.equal(held(S).st, 'frozen'); assert.equal(F(S, 'ou_fryer'), 'put'); run(S, 6);
  F(S, 'ou_plating', { pick: 'plate' }); assert.equal(F(S, 'ou_fryer'), 'mix'); assert.equal(held(S).on, 'fries'); serve('fries');
  // a cheeseburger: the patty grilled, E at the grill with a bun: in hand, served as it is (no plate back to wash)
  F(S, 'ou_fridge', { pick: 'patty' }); assert.equal(F(S, 'ou_grill'), 'put'); run(S, 7);
  F(S, 'ou_pantry', { pick: 'bun' }); assert.equal(F(S, 'ou_grill'), 'mix'); assert.equal(held(S).k, 'burger');
  const back = S.returns.length; serve('cheeseburger'); assert.equal(S.returns.length, back, 'nothing to wash');
  // pancakes: batter on the griddle, onto a plate
  F(S, 'ou_fridge', { pick: 'batter' }); assert.equal(F(S, 'ou_griddle'), 'put'); run(S, 6);
  F(S, 'ou_plating', { pick: 'plate' }); assert.equal(F(S, 'ou_griddle'), 'mix'); serve('pancakes');
  // avocado toast: the avocado chopped, the bread toasted and put on it, a plate held to it: the plate kept in hand
  F(S, 'ou_fridge', { pick: 'avocado' }); F(S, 'ou_prep'); for (let k = 0; k < 26; k++) { work(S, 'you', fid('ou_prep'), 0.1); step(S, 0.1); }
  assert.equal(S.items[S.st[fid('ou_prep')].slot].st, 'chopped');
  F(S, 'ou_pantry', { pick: 'bread' }); assert.equal(F(S, 'ou_toaster'), 'put'); run(S, 5); assert.equal(F(S, 'ou_toaster'), 'take'); assert.equal(held(S).st, 'toasted');
  assert.equal(F(S, 'ou_prep'), 'mix'); assert.equal(S.items[S.st[fid('ou_prep')].slot].k, 'avo_toast');
  F(S, 'ou_plating', { pick: 'plate' }); assert.equal(F(S, 'ou_prep'), 'mix'); assert.equal(held(S).on, 'avo_toast'); assert.equal(S.st[fid('ou_prep')].slot, null);
  serve('avocado_toast');
  // cola: a glass under the soda fountain; tea: a cup under the tea station; orange juice: an orange loaded, a glass under it
  F(S, 'ou_plating', { pick: 'glass' }); assert.equal(F(S, 'ou_soda'), 'put'); run(S, 3); assert.equal(F(S, 'ou_soda'), 'take'); assert.equal(held(S).st, 'cola'); serve('cola');
  F(S, 'ou_plating', { pick: 'cup' }); assert.equal(F(S, 'ou_kettle'), 'put'); run(S, 4.5); F(S, 'ou_kettle'); assert.equal(held(S).st, 'tea'); serve('tea');
  F(S, 'ou_plating', { pick: 'glass' }); assert.equal(F(S, 'ou_juicer'), 'put'); run(S, 5); assert.equal(S.items[S.st[fid('ou_juicer')].slot].st, 'empty', 'no orange in it: nothing');
  assert.equal(F(S, 'ou_juicer'), 'take'); assert.equal(F(S, 'ou_juicer'), 'put', 'a glass is put back under it'); step(S, 2);
  assert.equal(F(S, 'ou_juicer'), 'take'); F(S, 'ou_plating'); step(S, 2); assert.equal(held(S), undefined, 'the clean glass back on its stack');
  F(S, 'ou_fridge', { pick: 'orange' }); assert.equal(F(S, 'ou_juicer'), 'load'); F(S, 'ou_plating', { pick: 'glass' }); assert.equal(F(S, 'ou_juicer'), 'put'); run(S, 3.5);
  assert.equal(F(S, 'ou_juicer'), 'take'); assert.equal(held(S).st, 'juice'); serve('orange_juice');
  assert.deepEqual(S.served.map(x => x.grade), Array(7).fill('Supreme'));
  // left too long: ruined (burnt fries, spilled cola, stewed tea) and not served
  F(S, 'ou_plating', { pick: 'cup' }); F(S, 'ou_kettle'); run(S, 14); F(S, 'ou_kettle'); assert.equal(held(S).st, 'stewed'); want(S, 'tea'); assert.equal(F(S, 'ou_pass'), null);
});

test('a Rush orders only what its place sells; its fridge gives only what those dishes use', () => {
  const all = newRush(FULL, { seed: 'm' });
  assert.equal(all.menu.length, 30);
  // a burger joint's menu (food ids: shared/food.js); an item that is no dish is never ordered
  const S = newRush(FULL, { seed: 'm', menu: ['cheeseburger', 'fries', 'cola', 'not_a_dish'] });
  assert.deepEqual(S.menu, ['fries', 'cheeseburger', 'cola']);
  assert.deepEqual(choices(S, fid('ou_fridge')).map(c => c.k), ['fries', 'patty']);
  assert.deepEqual(choices(S, fid('ou_pantry')).map(c => c.k), ['bun']);
  run(S, 170); assert.ok(S.ev.filter(e => e.k === 'ticket').every(e => S.menu.includes(e.dish)));
  // the toastie is the menu's panini
  assert.deepEqual(newRush(FULL, { menu: ['panini', 'latte'] }).menu, ['latte', 'toastie']);
  // a menu it can make nothing of: all it can make (a practice Rush always has something to cook)
  assert.equal(newRush(FULL, { menu: ['not_a_dish'] }).menu.length, 30);
  assert.deepEqual(newRush(KITCHEN, { seed: 'pick' }).uses.sort(), ['berries', 'bread', 'croissant', 'milk', 'tomato']);
});

test('the bar: beer from the taps, wine poured at the wine fridge, a cocktail shaken and poured; tickets name the drink', () => {
  // (2026-10-28: lounges and clubs: "Drinks and maybe drinking appetizers for lounges, bars, clubs")
  const BAR = ['ou_taps', 'ou_wine', 'ou_cocktail', 'ou_plating', 'ou_prep', 'ou_sink', 'ou_dishes', 'ou_pass', 'ou_bin'].map((t, i) => ({ id: i + 1, t }));
  const bid = t => BAR.find(s => s.t === t).id, B = (S, t, o) => interact(S, 'you', bid(t), o);
  const LOUNGE = ['martini', 'old_fashioned', 'gin_tonic', 'aperol', 'red_wine', 'white_wine', 'champagne', 'whiskey'];
  const S = newRush(BAR, { seed: 'bar', dur: 600, menu: LOUNGE }); S.nextTicket = 1e9;
  assert.deepEqual(S.menu, ['red_wine', 'white_wine', 'champagne', 'cocktail']);
  assert.deepEqual(S.sells.cocktail, ['martini', 'old_fashioned', 'gin_tonic', 'aperol', 'whiskey']);
  assert.deepEqual(choices(S, bid('ou_plating')).map(c => c.k), ['wineglass', 'coupe'], 'the plating counter offers the bar\'s glasses only');
  assert.deepEqual(choices(S, bid('ou_wine')).map(c => c.k), ['red', 'white', 'bubbly']);
  const serve = dish => { S.tickets.push({ id: 700 + S.tickets.length, dish, at: S.t, until: S.t + 300 }); assert.equal(B(S, 'ou_pass'), 'serve', dish); assert.equal(S.served.at(-1).dish, dish); };
  // wine: nothing in hand, nothing; a wine glass held to it: poured at once, the one chosen
  assert.equal(B(S, 'ou_wine'), null);
  B(S, 'ou_plating', { pick: 'wineglass' }); assert.equal(B(S, 'ou_wine', { pick: 'bubbly' }), 'pour'); assert.equal(held(S).st, 'bubbly'); serve('champagne');
  B(S, 'ou_plating', { pick: 'wineglass' }); B(S, 'ou_wine', { pick: 'red' }); assert.equal(B(S, 'ou_wine', { pick: 'white' }), null, 'a full glass: no more'); serve('red_wine');
  // a cocktail: shaken (held), a cocktail glass held to the shaker: poured, the glass kept in hand
  for (let k = 0; k < 24; k++) { work(S, 'you', bid('ou_cocktail'), 0.1); step(S, 0.1); }
  assert.equal(S.items[S.st[bid('ou_cocktail')].slot]?.st, 'shaken');
  B(S, 'ou_plating', { pick: 'coupe' }); assert.equal(B(S, 'ou_cocktail'), 'mix'); assert.equal(held(S).st, 'cocktail'); assert.equal(S.st[bid('ou_cocktail')].slot, null); serve('cocktail');
  assert.deepEqual(S.served.map(x => x.grade), ['Supreme', 'Supreme', 'Supreme']);
  // beer at a club's bar: a glass under the taps
  const C = newRush(BAR, { seed: 'club', menu: ['margarita', 'mojito', 'cosmopolitan', 'pina_colada', 'champagne', 'beer'] }); C.nextTicket = 1e9;
  assert.deepEqual(C.menu, ['beer', 'champagne', 'cocktail']);
  interact(C, 'you', bid('ou_plating'), { pick: 'glass' }); assert.equal(interact(C, 'you', bid('ou_taps')), 'put'); run(C, 3.2);
  assert.equal(interact(C, 'you', bid('ou_taps')), 'take'); assert.equal(C.items[C.players.you.hold].st, 'beer');
  // a Rush's tickets name the menu item: a mojito, a margarita … all made as a cocktail
  const all = []; const R3 = newRush(BAR, { seed: 'names', menu: ['margarita', 'mojito', 'cosmopolitan', 'beer'] });
  for (let k = 0; k < 1700; k++) { step(R3, 0.1); for (const tk of R3.tickets) if (!all.some(x => x.id === tk.id)) all.push(tk); }
  assert.ok(all.every(tk => (tk.dish === 'cocktail' ? ['margarita', 'mojito', 'cosmopolitan'] : ['beer']).includes(tk.item)), JSON.stringify(all.map(tk => [tk.dish, tk.item])));
  assert.ok(new Set(all.filter(tk => tk.dish === 'cocktail').map(tk => tk.item)).size >= 2, 'more than one cocktail named');
});

test('the pizza oven, the stove and the wok: a pizza, pasta, soup in a bowl, a stir-fry tossed (cooking only while held)', () => {
  // (2026-10-28: an Italian's, a pizzeria's and an Asian kitchen's dishes; the stove's on fifteen kinds of menu)
  const S = newRush(FULL, { seed: 'stove', dur: 900 }); S.nextTicket = 1e9;
  const serve = dish => { want(S, dish); assert.equal(F(S, 'ou_pass'), 'serve', dish); assert.equal(S.served.at(-1).dish, dish); };
  const chop = k => { F(S, 'ou_fridge', { pick: k }); assert.equal(F(S, 'ou_prep'), 'put'); for (let n = 0; n < 26; n++) { work(S, 'you', fid('ou_prep'), 0.1); step(S, 0.1); } assert.equal(S.items[S.st[fid('ou_prep')].slot].st, 'chopped'); };
  // pizza: dough onto a chopped tomato, baked, plated
  chop('tomato'); F(S, 'ou_pantry', { pick: 'dough' }); assert.equal(F(S, 'ou_prep'), 'mix'); assert.equal(F(S, 'ou_prep'), 'take'); assert.equal(held(S).k, 'pizza');
  assert.equal(F(S, 'ou_pizza_oven'), 'put'); run(S, 8); F(S, 'ou_plating', { pick: 'plate' }); assert.equal(F(S, 'ou_pizza_oven'), 'mix'); assert.equal(held(S).on, 'pizza'); serve('pizza');
  // pasta: boiled on the stove, plated
  F(S, 'ou_pantry', { pick: 'pasta' }); assert.equal(F(S, 'ou_stove'), 'put'); run(S, 7); F(S, 'ou_plating', { pick: 'plate' }); assert.equal(F(S, 'ou_stove'), 'mix'); serve('pasta');
  // soup: stock onto a chopped tomato, simmered; a plate won't take it, a bowl does
  chop('tomato'); F(S, 'ou_fridge', { pick: 'stock' }); F(S, 'ou_prep'); F(S, 'ou_prep'); assert.equal(held(S).k, 'soup');
  assert.equal(F(S, 'ou_stove'), 'put'); run(S, 7);
  F(S, 'ou_plating', { pick: 'plate' }); assert.equal(F(S, 'ou_stove'), null, 'soup onto a plate: no'); step(S, 2); F(S, 'ou_plating'); step(S, 2);
  F(S, 'ou_plating', { pick: 'bowl' }); assert.equal(held(S).k, 'bowl'); assert.equal(F(S, 'ou_stove'), 'mix'); assert.equal(held(S).on, 'soup'); serve('soup');
  // a stir-fry: noodles onto a chopped pepper; in the wok it cooks only while tossed (held)
  chop('pepper'); F(S, 'ou_pantry', { pick: 'noodles' }); F(S, 'ou_prep'); F(S, 'ou_prep'); assert.equal(held(S).k, 'stirfry');
  assert.equal(F(S, 'ou_wok'), 'put'); run(S, 10);
  assert.equal(S.items[S.st[fid('ou_wok')].slot].st, 'raw', 'left alone: not cooking');
  for (let n = 0; n < 40; n++) { assert.equal(work(S, 'you', fid('ou_wok'), 0.1), true); step(S, 0.1); }
  assert.equal(S.items[S.st[fid('ou_wok')].slot].st, 'tossed'); run(S, 20); assert.equal(S.items[S.st[fid('ou_wok')].slot].st, 'tossed', 'and stays done while nobody tosses it');
  F(S, 'ou_plating', { pick: 'bowl' }); assert.equal(F(S, 'ou_wok'), 'mix'); assert.equal(held(S).on, 'stirfry'); serve('stir_fry');
  assert.ok(S.served.every(x => ['Supreme', 'Great'].includes(x.grade)), S.served.map(x => x.grade).join(' '));   // (the soup waited on the stove while the plate went back)
  // an Italian's menu: pizza, pasta and soup (and its wines, its espresso)
  assert.deepEqual(newRush(FULL, { menu: ['minestrone', 'spaghetti', 'carbonara', 'margherita', 'red_wine', 'white_wine', 'espresso', 'tiramisu'] }).menu.sort(),
    ['espresso', 'pasta', 'pizza', 'red_wine', 'soup', 'tiramisu', 'white_wine']);   // (its tiramisu too: the rest of the menu, shared/orderup/menu-dishes.js)
});

test('the arcade\'s snack bar: popcorn, a hot dog, tacos, a bottle of water; the arcade\'s menu plays them', () => {
  // (2026-10-28: "junk food on arcades like popcorn, pizza, burgers, tacos, soda, water, juice")
  const ARCADE = ['cola', 'lemon_soda', 'water', 'orange_juice', 'popcorn', 'pizza_slice', 'hot_dog', 'cheeseburger', 'fries', 'tacos'];
  const S = newRush(FULL, { seed: 'arcade', dur: 900, menu: ARCADE }); S.nextTicket = 1e9;
  const serve = dish => { want(S, dish); assert.equal(F(S, 'ou_pass'), 'serve', dish); assert.equal(S.served.at(-1).dish, dish); };
  // popcorn: kernels into the machine, popped, served in its bag (nothing to wash)
  F(S, 'ou_pantry', { pick: 'kernels' }); assert.equal(F(S, 'ou_popcorn'), 'put'); run(S, 4.5); assert.equal(F(S, 'ou_popcorn'), 'take'); assert.equal(held(S).st, 'popped');
  const back = S.returns.length; serve('popcorn'); assert.equal(S.returns.length, back);
  // a hot dog: the sausage grilled, E at the grill with a bun
  F(S, 'ou_fridge', { pick: 'sausage' }); assert.equal(F(S, 'ou_grill'), 'put'); run(S, 7); F(S, 'ou_pantry', { pick: 'bun' }); assert.equal(F(S, 'ou_grill'), 'mix'); assert.equal(held(S).k, 'hotdog'); serve('hot_dog');
  // tacos: a tomato chopped, the tortilla warmed on the griddle and put on it, plated
  F(S, 'ou_fridge', { pick: 'tomato' }); F(S, 'ou_prep'); for (let n = 0; n < 26; n++) { work(S, 'you', fid('ou_prep'), 0.1); step(S, 0.1); }
  F(S, 'ou_pantry', { pick: 'tortilla' }); assert.equal(F(S, 'ou_griddle'), 'put'); run(S, 5.5); assert.equal(F(S, 'ou_griddle'), 'take'); assert.equal(held(S).st, 'cooked');
  assert.equal(F(S, 'ou_prep'), 'mix'); F(S, 'ou_plating', { pick: 'plate' }); assert.equal(F(S, 'ou_prep'), 'mix'); assert.equal(held(S).on, 'tacos'); serve('tacos');
  // water: a bottle from the fridge
  F(S, 'ou_fridge', { pick: 'water' }); serve('water');
  assert.deepEqual(S.served.map(x => x.grade), Array(4).fill('Supreme'));
  // the arcade's menu (shared/nightlife.js): its kitchen's Rush plays its snacks and drinks
  assert.deepEqual(S.menu.sort(), ['cheeseburger', 'cola', 'fries', 'hot_dog', 'orange_juice', 'pizza', 'popcorn', 'tacos', 'water']);
  assert.ok(!newRush(FULL).menu.includes('water'), 'water only where it is sold');
});

test('the rice cooker, the tandoor, the bamboo steamer, the freezer: curry over rice, sushi, naan, tandoori chicken, dumplings, ice cream', () => {
  // (2026-10-28: an Indian's, a Japanese and a dim sum kitchen's dishes; ice cream on eight kinds of menu)
  const S = newRush(FULL, { seed: 'rice', dur: 900, menu: ['butter_chicken', 'nigiri', 'naan', 'tandoori', 'dumplings', 'gelato'] }); S.nextTicket = 1e9;
  assert.deepEqual([...S.menu].sort(), ['curry', 'dumplings', 'ice_cream', 'naan', 'sushi', 'tandoori']);
  const serve = dish => { want(S, dish); assert.equal(F(S, 'ou_pass'), 'serve', dish); assert.equal(S.served.at(-1).dish, dish); };
  // curry: on the stove; a bowl held to the rice cooker (rice into it, at once); the curry poured over it at the stove
  F(S, 'ou_fridge', { pick: 'curry' }); assert.equal(F(S, 'ou_stove'), 'put');
  F(S, 'ou_plating', { pick: 'bowl' }); assert.equal(F(S, 'ou_rice'), 'pour'); assert.equal(held(S).on, 'rice');
  assert.equal(F(S, 'ou_rice'), null, 'rice in it already'); run(S, 7);
  assert.equal(F(S, 'ou_stove'), 'mix'); assert.equal(held(S).on, 'curry'); serve('curry');
  // sushi: a fish sliced, a plate of rice held to it
  F(S, 'ou_fridge', { pick: 'fish' }); F(S, 'ou_prep'); for (let n = 0; n < 26; n++) { work(S, 'you', fid('ou_prep'), 0.1); step(S, 0.1); }
  F(S, 'ou_plating', { pick: 'plate' }); assert.equal(F(S, 'ou_prep'), null, 'no rice on the plate: nothing'); F(S, 'ou_rice'); assert.equal(F(S, 'ou_prep'), 'mix'); assert.equal(held(S).on, 'sushi'); serve('sushi');
  // naan and tandoori chicken: in the tandoor, plated
  F(S, 'ou_pantry', { pick: 'dough' }); assert.equal(F(S, 'ou_tandoor'), 'put'); run(S, 7); F(S, 'ou_plating', { pick: 'plate' }); assert.equal(F(S, 'ou_tandoor'), 'mix'); assert.equal(held(S).on, 'dough'); serve('naan');
  F(S, 'ou_fridge', { pick: 'chicken' }); F(S, 'ou_tandoor'); run(S, 7); F(S, 'ou_plating', { pick: 'plate' }); F(S, 'ou_tandoor'); serve('tandoori');
  // dumplings: steamed, plated; ice cream: a bowl held to the freezer
  S.st[fid('ou_plating')].plates = 3;   // (the dirty ones washed meanwhile)
  F(S, 'ou_fridge', { pick: 'dumplings' }); assert.equal(F(S, 'ou_bamboo'), 'put'); run(S, 6); F(S, 'ou_plating', { pick: 'plate' }); F(S, 'ou_bamboo'); serve('dumplings');
  F(S, 'ou_plating', { pick: 'bowl' }); assert.equal(F(S, 'ou_freezer'), 'pour'); assert.equal(held(S).on, 'icecream'); serve('ice_cream');
  assert.ok(S.served.every(x => ['Supreme', 'Great'].includes(x.grade)), S.served.map(x => `${x.dish} ${x.grade}`).join(' '));
  // ice cream into a bowl, not onto a plate; rice onto either
  step(S, 2); F(S, 'ou_plating', { pick: 'plate' }); assert.equal(F(S, 'ou_freezer'), null);
});

test('two parts put together: an egg fried and bacon crisp on the one griddle, onto a plate at the plating counter; rice with chicken grilled onto it; mochi from the freezer', () => {
  // (2026-10-28: the breakfasts, the platters, the rice bowls; food an order waits for, brought to the plating counter: onto a plate)
  const S = newRush(FULL, { seed: 'parts', dur: 900, menu: ['eggs_bacon', 'teriyaki', 'mochi', 'fries'] }); S.nextTicket = 1e9;
  assert.deepEqual([...S.menu].sort(), ['eggs_bacon', 'fries', 'mochi', 'teriyaki']);
  const serve = dish => { want(S, dish); assert.equal(F(S, 'ou_pass'), 'serve', dish); assert.equal(S.served.at(-1).dish, dish); };
  F(S, 'ou_fridge', { pick: 'egg' }); assert.equal(held(S).st, 'raw'); assert.equal(F(S, 'ou_griddle'), 'put'); run(S, 5.5);
  assert.equal(F(S, 'ou_griddle'), 'take'); assert.equal(held(S).st, 'fried', 'the griddle fries an egg');
  assert.equal(F(S, 'ou_prep'), 'put');
  F(S, 'ou_fridge', { pick: 'bacon' }); assert.equal(F(S, 'ou_griddle'), 'put'); run(S, 5.5);
  F(S, 'ou_prep'); assert.equal(held(S).k, 'egg'); assert.equal(F(S, 'ou_griddle'), 'mix', 'the egg in hand put with the bacon at the griddle');
  assert.equal(held(S).k, 'eggs_bacon'); assert.equal(held(S).st, 'ready');
  assert.equal(F(S, 'ou_plating'), 'put', 'nobody waits for it yet: set down'); F(S, 'ou_plating'); want(S, 'eggs_bacon');
  assert.equal(F(S, 'ou_plating'), 'mix', 'an order waits for it: onto a plate'); assert.equal(held(S).k, 'plate'); assert.equal(held(S).on, 'eggs_bacon');
  assert.equal(F(S, 'ou_pass'), 'serve'); assert.equal(S.served.at(-1).dish, 'eggs_bacon'); assert.equal(S.served.at(-1).grade, 'Supreme');
  // teriyaki: the chicken grilled; a plate of rice held to the grill
  F(S, 'ou_fridge', { pick: 'chicken' }); assert.equal(F(S, 'ou_grill'), 'put'); F(S, 'ou_plating', { pick: 'plate' }); F(S, 'ou_rice'); run(S, 6.5);
  assert.equal(F(S, 'ou_grill'), 'mix'); assert.equal(held(S).on, 'teriyaki'); serve('teriyaki');
  // mochi: a plate held to the freezer (a bowl: ice cream, not sold here)
  F(S, 'ou_plating', { pick: 'plate' }); assert.equal(F(S, 'ou_freezer'), 'pour'); assert.equal(held(S).on, 'mochi'); serve('mochi');
  assert.ok(S.served.every(x => x.grade === 'Supreme'), S.served.map(x => `${x.dish} ${x.grade} ${x.score}`).join(' '));
});
