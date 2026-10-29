// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Order Up's coach (2026-10-27, the product owner: "we need some kind of indication of what to do, i'm not really sure how
// I can understand on what to do next on the game"): from a Rush's state (shared/orderup/rules.js), the next thing a
// cook should do for an order: which station, E (take, put, put together, serve) or F (hold to grind, chop, wash) or
// wait, and in words. The page shows it (the "Next" line, an arrow over the station); phase 5's computer cooks will do
// what it says. A dish's recipe in short for its ticket: RECIPES.
//
// What comes first: a dish already done in hand (serve it), anything burnt (out and into the bin), then the order's
// recipe from its last step back to its first (what is nearest done is finished first); while a machine works, the next
// thing that can be done meanwhile; out of plates or cups: the washing up.
import { dishOf, itemName, intoOf } from './rules.js';
import { kitchenOf, DEFAULT_KITCHEN } from './kitchens.js';

export const RECIPES = {
  espresso: ['Grind', 'Load', 'Cup under', 'Serve'],
  latte: ['Shot', 'Steam milk', 'Pour', 'Serve'],
  smoothie: ['Berries', 'Blend', 'Glass', 'Serve'],
  croissant: ['Pantry', 'Oven', 'Plate', 'Serve'],
  toastie: ['Chop tomato', 'Bread', 'Press', 'Plate', 'Serve'],
  fries: ['Fridge', 'Fryer', 'Plate', 'Serve'],
  cheeseburger: ['Patty', 'Grill', 'Bun', 'Serve'],
  pancakes: ['Batter', 'Griddle', 'Plate', 'Serve'],
  avocado_toast: ['Chop avocado', 'Toast', 'Together', 'Plate', 'Serve'],
  cola: ['Glass', 'Soda fountain', 'Serve'],
  tea: ['Cup', 'Tea station', 'Serve'],
  orange_juice: ['Orange', 'Load', 'Glass under', 'Serve'],
  beer: ['Glass', 'Taps', 'Serve'],
  red_wine: ['Wine glass', 'Pour red', 'Serve'],
  white_wine: ['Wine glass', 'Pour white', 'Serve'],
  champagne: ['Wine glass', 'Pour champagne', 'Serve'],
  cocktail: ['Shake', 'Cocktail glass', 'Pour', 'Serve'],
  pizza: ['Chop tomato', 'Dough', 'Pizza oven', 'Plate', 'Serve'],
  pasta: ['Pasta', 'Stove', 'Plate', 'Serve'],
  soup: ['Chop tomato', 'Stock', 'Stove', 'Bowl', 'Serve'],
  stir_fry: ['Chop pepper', 'Noodles', 'Wok: hold to toss', 'Bowl', 'Serve'],
  popcorn: ['Kernels', 'Popcorn machine', 'Serve'],
  hot_dog: ['Sausage', 'Grill', 'Bun', 'Serve'],
  tacos: ['Chop tomato', 'Tortilla', 'Griddle', 'Together', 'Plate', 'Serve'],
  water: ['Fridge', 'Serve'],
  curry: ['Curry', 'Stove', 'Bowl', 'Rice', 'Pour', 'Serve'],
  sushi: ['Slice fish', 'Plate', 'Rice', 'Together', 'Serve'],
  naan: ['Dough', 'Tandoor', 'Plate', 'Serve'],
  tandoori: ['Chicken', 'Tandoor', 'Plate', 'Serve'],
  dumplings: ['Dumplings', 'Steamer', 'Plate', 'Serve'],
  ice_cream: ['Bowl', 'Freezer', 'Serve'],
};
// (what is ruined: out and into the bin)
const BURNT = new Set(['burnt', 'bitter', 'scalded', 'stewed', 'spilled', 'soggy']);
const nm = (S, it) => itemName(it, S.K), kindName = (S, k) => S.K.say?.[k] || k;

/** The order to work on: the oldest one not already done in hand. */
export function focusTicket(S, p = 'you') {
  const h = S.items[S.players[p]?.hold];
  return S.tickets.find(t => dishOf(h, S.K) !== t.dish) || S.tickets[0] || null;
}

/** The next step for cook p: { t: station type | null, act: 'E' | 'F' | 'wait', text, dish, pick? (what to take from a dispenser) }. */
export function nextStep(S, p = 'you', dish = focusTicket(S, p)?.dish) {
  const P = S.players[p] || { hold: null }, h = S.items[P.hold] || null;
  const st = t => Object.values(S.st).find(x => x.t === t), on = t => { const x = st(t); return x ? S.items[x.slot] || null : null; };
  const go = (t, act, text) => ({ t, act, text, dish: dish || null });
  const has = t => !!st(t), K = S.K, DISHES = K.dishes;
  // a finished dish in hand: to the pass if anyone wants it
  const hd = dishOf(h, K);
  if (hd && S.tickets.some(t => t.dish === hd)) return go('ou_pass', 'E', `Serve the ${DISHES[hd].name} at the pass`);
  // anything burnt: out, and into the bin
  if (h && (BURNT.has(h.st) || h.burnt || (h.k === 'plate' && h.onSt && BURNT.has(h.onSt)))) return go('ou_bin', 'E', `Throw the ${nm(S, h)} in the bin`);
  for (const [t, d] of Object.entries(K.stations)) {
    if (d.role !== 'cook') continue;
    const it = on(t); if (it && BURNT.has(it.st)) return h ? putDown(S, h, go) : go(t, 'E', `Take the ${nm(S, it)} out of the ${stationName(t)}`);
  }
  if (hd && !S.tickets.some(t => t.dish === hd) && !(hd === 'espresso' && dish === 'latte') && !partOf(DISHES[dish], h)) return go('ou_bin', 'E', `Nobody wants the ${DISHES[hd].name} now: bin it`);   // (a latte's shot is part of it; a bowl of ice cream, of a sundae)
  if (!dish) return go(null, 'wait', 'Waiting for the next order…');
  // out of what the dish goes in: wash up
  const plating = st('ou_plating'), needs = K.ware[DISHES[dish].ware]?.stack;
  if (plating && needs && plating[needs] === 0 && !h && has('ou_sink')) {
    const sink = st('ou_sink'), dr = st('ou_dishes');
    if (sink.sink.length) return go('ou_sink', 'F', 'Hold F at the sink to wash up');
    if (dr?.dirty?.length) return go('ou_dishes', 'E', 'No clean ones left: take a dirty one from the dish return');
  }
  if (h?.st === 'dirty') return go('ou_sink', 'E', 'Put it in the sink, then hold F to wash');
  const step = (RECIPE_STEPS[dish] || (DISHES[dish]?.recipe ? (S2, h2, c2) => menuSteps(S2, h2, c2, DISHES[dish]) : () => null))(S, h, { st, on, go, has });
  return step || go(null, 'wait', 'Waiting…');
}
const stationName = t => ({ ou_oven: 'oven', ou_press: 'press', ou_steamer: 'steamer', ou_blender: 'blender', ou_espresso: 'espresso machine', ou_fryer: 'fryer', ou_grill: 'grill',
  ou_griddle: 'griddle', ou_toaster: 'toaster', ou_soda: 'soda fountain', ou_kettle: 'tea station', ou_juicer: 'juicer', ou_taps: 'beer taps', ou_wine: 'wine fridge',
  ou_cocktail: 'cocktail station', ou_pizza_oven: 'pizza oven', ou_stove: 'stove', ou_wok: 'wok', ou_popcorn: 'popcorn machine', ou_tandoor: 'tandoor', ou_bamboo: 'bamboo steamer',
  ou_rice: 'rice cooker', ou_freezer: 'ice cream freezer' }[t] || 'station');
// worth keeping when not wanted now: set down (the rest is cheap to get again)
const KEEP = new Set(['cup:shot', 'cup:latte', 'glass:smoothie', 'milk:steamed', 'patty:grilled', 'sausage:grilled', 'bun:plain', 'shaker:shaken']);
/** Something in hand that isn't wanted now: down on a free counter (not on `avoid`, the counter the recipe needs free), or the bin. */
function putDown(S, h, go, avoid = null, keepIt = false) {
  if (S.K.ware[h.k] && h.st === S.K.ware[h.k].clean && !h.on) return go('ou_plating', 'E', `Put the ${nm(S, h)} back on the plating counter`);
  const keep = keepIt || KEEP.has(`${h.k}:${h.st}`) || dishOf(h, S.K);
  const free = keep && ['ou_prep', 'ou_plating'].find(t => { const x = Object.values(S.st).find(s => s.t === t); return t !== avoid && x && x.slot == null; });
  return free ? go(free, 'E', `Put the ${nm(S, h)} down on the ${free === 'ou_prep' ? 'prep counter' : 'plating counter'}`) : go('ou_bin', 'E', `Not needed now: throw the ${nm(S, h)} in the bin`);
}
/** A cup, a glass, a plate or a bowl in hand, clean (taken from the plating counter: E again swaps it for the next kind). */
function container(S, h, c, kind, then) {
  if (h?.k === kind && h.st === S.K.ware[kind]?.clean && !h.on) return then;
  if (h) return putDown(S, h, c.go);
  return { ...c.go('ou_plating', 'E', `Take a ${kindName(S, kind)} from the plating counter`), pick: kind };
}
const MASS = new Set(['milk', 'berries', 'bread', 'fries', 'batter', 'dough', 'pasta', 'noodles', 'stock', 'kernels', 'water', 'curry', 'chicken', 'dumplings', 'bacon', 'lamb', 'beans', 'chips']);
const some = k => (MASS.has(k) ? k : /^[aeiou]/.test(k) ? `an ${k}` : `a ${k}`);
function fromDispenser(c, t, k, words = null) { return { ...c.go(t, 'E', `Take ${words ? words : some(k)} from the ${t === 'ou_fridge' ? 'fridge' : 'pantry'}`), pick: k }; }

/** The shot: grind, load, a cup under, pulled; returns the step, or null once a shot is in hand. o: what goes under it
 *  instead (k in state from, made to: a cup to go; a glass of ice from the fridge, store). */
function shot(S, h, c, o = { k: 'cup', from: 'empty', to: 'shot' }) {
  const esp = c.st('ou_espresso'), cup = c.on('ou_espresso'), what = S.K.say[`${o.k}:${o.to}`] || 'shot', under = S.K.say[`${o.k}:${o.from}`] || kindName(S, o.k);
  if (h?.k === o.k && h.st === o.to) return null;
  if (cup) {
    if (cup.k === o.k && cup.st === o.to) return h ? putDown(S, h, c.go) : c.go('ou_espresso', 'E', `Take the ${what} from the espresso machine`);
    if (esp.loaded || esp.prog > 0) return c.go('ou_espresso', 'wait', `The ${what} is pulling…`);
  }
  if (esp.loaded) {
    if (cup) return null;
    if (o.store) return h?.k === o.k && h.st === o.from ? c.go('ou_espresso', 'E', `Put the ${under} under the espresso machine`) : h ? putDown(S, h, c.go) : fromDispenser(c, o.store, o.k, `a ${under}`);
    return container(S, h, c, o.k, c.go('ou_espresso', 'E', `Put the ${under} under the espresso machine`));
  }
  if (h?.k === 'grounds') return c.go('ou_espresso', 'E', 'Load the grounds into the espresso machine');
  if (c.on('ou_grinder')?.k === 'grounds') return h ? putDown(S, h, c.go) : c.go('ou_grinder', 'E', 'Take the grounds from the grinder');
  if (h) return putDown(S, h, c.go);
  return c.go('ou_grinder', 'F', 'Hold F at the grinder to grind coffee');
}
/** A counter with item k in state s on it, if any. */
const counterWith = (S, k, s) => Object.values(S.st).find(x => (x.t === 'ou_prep' || x.t === 'ou_plating') && S.items[x.slot]?.k === k && S.items[x.slot]?.st === s);
const label = t => t === 'ou_prep' ? 'prep counter' : 'plating counter';
/** Food cooked by itself in a machine (the oven, the press, the fryer, the griddle, the stove), then onto a plate or into a
 *  bowl (ware) (what: its name). */
function plated(S, h, c, t, k, raw, put, what = k, ware = 'plate') {
  const it = c.on(t), name = stationName(t), wn = kindName(S, ware);
  if (it && it.k === k && it.st !== raw) return container(S, h, c, ware, c.go(t, 'E', `E at the ${name} with the ${wn}: the ${what} ${ware === 'plate' ? 'onto' : 'into'} it`));
  if (it && it.k === k) {   // (cooking: a plate ready meanwhile)
    if (!h) return { ...c.go('ou_plating', 'E', `While it cooks: take a ${wn} from the plating counter`), pick: ware };
    if (h.k === ware && h.st === S.K.ware[ware].clean && !h.on) return c.go(t, 'wait', `The ${what} in the ${name}: wait, then E with the ${wn}`);
    return putDown(S, h, c.go);
  }
  return put();
}
/** Into a machine once it is free (another dish's food in it: wait for it). */
const into = (S, c, t, text) => (c.on(t) ? c.go(t, 'wait', `The ${stationName(t)} is busy: wait for it`) : c.go(t, 'E', text));
/** A base put onto a chopped topping at the prep counter (dough onto tomato: a pizza; stock: a soup; noodles onto a pepper:
 *  a stir-fry), then into its machine: o = { k: what it makes, base, top, t: the machine, put: the words for putting it in }. */
function topped(S, h, c, o) {
  const prep = c.on('ou_prep');
  if (h?.k === o.k && h.st === 'raw') return into(S, c, o.t, o.put);
  if (prep?.k === o.k) return h ? putDown(S, h, c.go, 'ou_prep') : c.go('ou_prep', 'E', `Take the ${nm(S, prep)} from the prep counter`);
  if (prep?.k === o.top && prep.st === 'chopped') {
    if (h?.k === o.base) return c.go('ou_prep', 'E', `Put the ${kindName(S, o.base)} on the chopped ${o.top}`);
    if (h) return putDown(S, h, c.go, 'ou_prep');
    return fromDispenser(c, giver(S, o.base), o.base);
  }
  if (prep?.k === o.top) return h ? putDown(S, h, c.go, 'ou_prep') : c.go('ou_prep', 'F', `Hold F at the prep counter to chop the ${o.top}`);
  if (h?.k === o.top && h.st === 'whole') return prep ? c.go('ou_bin', 'E', `The prep counter is busy: bin the ${o.top} or clear it`) : c.go('ou_prep', 'E', `Put the ${o.top} on the prep counter`);
  if (h) return putDown(S, h, c.go, 'ou_prep');
  if (prep) return c.go('ou_prep', 'E', `Clear the prep counter: take the ${nm(S, prep)}`);
  return fromDispenser(c, giver(S, o.top), o.top);
}
/** A cup or a glass filled at a machine (the soda fountain, the tea station; the juicer loaded first, as the espresso
 *  machine is: an orange), taken out to serve. */
function filled(S, h, c, t, what, load = null, to = null) {   // (load: what it is loaded with for this one, its state to: a lemon, lemonade)
  const a = S.K.stations[t], x = c.st(t), it = c.on(t), name = stationName(t), L = load || a.loaded, done = to || a.to;
  if (it?.st === done) return h ? putDown(S, h, c.go) : c.go(t, 'E', `Take the ${what} from the ${name}`);
  if (it && (!L || x.loaded || x.prog > 0)) return c.go(t, 'wait', `The ${what} is pouring…`);
  if (L && x.loaded && x.loaded !== true && x.loaded !== L) return c.go(t, 'wait', `The ${name} has a ${x.loaded} in it: put a glass under for that first`);
  if (L && !x.loaded) {
    if (h?.k === L) return c.go(t, 'E', `Load the ${L} into the ${name}`);
    if (h) return putDown(S, h, c.go);
    return fromDispenser(c, giver(S, L), L);
  }
  return container(S, h, c, a.k, c.go(t, 'E', `Put the ${kindName(S, a.k)} under the ${name}`));
}
/** A glass held to a station that pours what is chosen at once (the wine fridge: red, white or champagne). */
function poured(S, h, c, t, what) {
  const d = S.K.stations[t], into = intoOf(d, what)[0];
  return container(S, h, c, into, { ...c.go(t, 'E', `Pour the ${kindName(S, what)} at the ${stationName(t)}`), pick: what });
}
/** The dispenser that gives kind k. */
const giver = (S, k) => Object.keys(S.K.stations).find(t => S.K.stations[t].gives?.includes(k)) || 'ou_fridge';

/** Something grilled put in a bun (E at the grill with the bun, it in hand; or the two put together on a counter):
 *  o = { meat: what is grilled, made: the kind it makes, name: its words }. */
function bunned(S, h, c, o) {
  const g = c.on('ou_grill'), bun = counterWith(S, 'bun', 'plain'), meat = counterWith(S, o.meat, 'grilled'), made = counterWith(S, o.made, 'ready');
  if (made) return h ? putDown(S, h, c.go) : c.go(made.t, 'E', `Take the ${o.name} from the ${label(made.t)}`);
  const aBun = () => (bun ? c.go(bun.t, 'E', `Take the bun from the ${label(bun.t)}`) : fromDispenser(c, 'ou_pantry', 'bun'));
  if (meat) {   // (a grilled one set down: a bun onto it there)
    if (h?.k === 'bun') return c.go(meat.t, 'E', `Put the bun on the grilled ${o.meat} on the ${label(meat.t)}`);
    return h ? putDown(S, h, c.go) : aBun();
  }
  if (h?.k === o.meat && h.st === 'grilled') return bun ? c.go(bun.t, 'E', `Put the ${o.meat} in the bun on the ${label(bun.t)}`) : putDown(S, h, c.go);
  if (g?.k === o.meat && g.st === 'grilled') {   // (grilled: E at the grill with a bun, it in hand)
    if (h?.k === 'bun') return c.go('ou_grill', 'E', `E at the grill with the bun: the ${o.meat} into it`);
    return h ? putDown(S, h, c.go) : aBun();
  }
  if (g?.k === o.meat) {   // (grilling: a bun ready meanwhile)
    if (h?.k === 'bun') return c.go('ou_grill', 'wait', `The ${o.meat} is grilling: wait, then E with the bun`);
    if (h) return putDown(S, h, c.go);
    const b = aBun(); return { ...b, text: `While it grills: ${b.text[0].toLowerCase()}${b.text.slice(1)}` };
  }
  if (h?.k === o.meat && h.st === 'raw') return into(S, c, 'ou_grill', `Put the ${o.meat} on the grill`);
  if (h) return putDown(S, h, c.go);   // (a bun first: set down, the meat on first)
  return fromDispenser(c, 'ou_fridge', o.meat);
}
/** A topping chopped at the prep counter, a base cooked in a machine put onto it, then onto a plate (avocado toast, tacos):
 *  o = { base, done: the base's cooked state, t: its machine, top, made: the kind it makes, name, put, take, onto, busy: the words }. */
function onTopping(S, h, c, o) {
  const prep = c.on('ou_prep'), m = c.on(o.t), made = counterWith(S, o.made, 'ready');
  if (made) return container(S, h, c, 'plate', c.go(made.t, 'E', `E at the ${label(made.t)} with the plate: the ${o.name} onto it`));
  if (h?.k === o.made) return putDown(S, h, c.go);
  if (prep?.k === o.top && prep.st === 'chopped') {   // (then the base, cooked, onto it)
    if (h?.k === o.base && h.st === o.done) return c.go('ou_prep', 'E', o.onto);
    if (m?.k === o.base && m.st === o.done) return h ? putDown(S, h, c.go, 'ou_prep') : c.go(o.t, 'E', o.take);
    if (m?.k === o.base) return c.go(o.t, 'wait', o.busy);
    if (h?.k === o.base && h.st === S.K.fresh[o.base]) return into(S, c, o.t, o.put);
    if (h) return putDown(S, h, c.go, 'ou_prep');
    return fromDispenser(c, giver(S, o.base), o.base);
  }
  if (prep?.k === o.top) return h ? putDown(S, h, c.go, 'ou_prep') : c.go('ou_prep', 'F', `Hold F at the prep counter to chop the ${o.top}`);
  if (h?.k === o.top && h.st === 'whole') return prep ? c.go('ou_bin', 'E', `The prep counter is busy: bin the ${o.top} or clear it`) : c.go('ou_prep', 'E', `Put the ${o.top} on the prep counter`);
  if (h) return putDown(S, h, c.go, 'ou_prep');
  if (prep) return c.go('ou_prep', 'E', `Clear the prep counter: take the ${nm(S, prep)}`);
  return fromDispenser(c, giver(S, o.top), o.top);
}

/** A bowl or a plate with rice in it (scooped at the rice cooker), then `then`. */
function withRice(S, h, c, ware, then) {
  if (h?.k === ware && h.on === 'rice') return then;
  const wn = kindName(S, ware);
  return container(S, h, c, ware, c.go('ou_rice', 'E', `Scoop rice ${ware === 'bowl' ? 'into the' : 'onto the'} ${wn} at the rice cooker`));
}

// ---- the rest of the menu (shared/orderup/menu-dishes.js): each dish made as its recipe says
/** Whether item h is a part of dish's making (a bowl of ice cream for a sundae, an egg for its bacon). */
function partOf(dish, h) {
  const r = dish?.recipe; if (!r || !h) return false;
  if (r.how === 'onto') return (h.k === r.ware && h.on === r.base) || (h.k === r.b[0] && h.st === r.b[1]);
  if (r.how === 'steam') return h.k === 'cup' && h.st === r.base;   // (a mocha's shot, a chai's tea)
  if (r.how === 'combo') return [r.a, r.b].some(([k, st]) => h.k === k && (st == null || [].concat(st).includes(h.st)));
  return false;
}
const menuName = (S, dish) => S.K.dishes[dish]?.name.toLowerCase() || dish;
// ---- a dish of two parts (shared/orderup/menu-dishes.js combo, and onto with a cooked part): each part is made as it is
// (in its machine, chopped, from a store, or a dish of its own: a burger), what cooks longest started first and the other
// made meanwhile; a ready one in hand waits at the other's machine, E there once it is done; else they are put together on
// a counter; the dish made, plated at the plating counter.
const partWords = (S, p) => S.K.say[`${p.k}:${p.st}`] || kindName(S, p.k);
const rawWords = (S, p) => S.K.say[`${p.k}:${S.K.fresh[p.k]}`] || kindName(S, p.k);
const is = w => (/[^s]s$/.test(w) ? 'are' : 'is');   // (the fries are, the egg is)
const goes = w => (is(w) === 'are' ? 'go' : 'goes');
const anOf = (k, w) => (MASS.has(k) || /[^s]s$/.test(w) ? w : `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w}`);
const READY = new Set(['hand', 'counter', 'machine']);
/** Where part p is: in hand, on a counter or done in its machine (ready); cooking or being chopped; else null. */
function partAt(S, h, c, p) {
  if (h && h.k === p.k && h.st === p.st) return { where: 'hand' };
  const at = counterWith(S, p.k, p.st); if (at) return { where: 'counter', t: at.t };
  const fresh = S.K.fresh[p.k];
  if (p.at) { const m = c.on(p.at); if (m?.k === p.k && m.st === p.st) return { where: 'machine', t: p.at }; if (m?.k === p.k && m.st === fresh) return { where: 'cooking', t: p.at }; }
  if (p.chop) { const pr = c.on('ou_prep'); if (pr?.k === p.k && pr.st === fresh) return { where: 'chopping', t: 'ou_prep' }; }
  return null;
}
const where = t => (t === 'ou_prep' || t === 'ou_plating' ? label(t) : stationName(t));
/** The next step to start part p (or carry it on: a dish of its own's steps); keep(it): something in hand worth setting down. */
function makePart(S, h, c, p, keep) {
  if (p.dish) return RECIPE_STEPS[p.dish] ? RECIPE_STEPS[p.dish](S, h, c) : menuSteps(S, h, c, S.K.dishes[p.dish]);
  const fresh = S.K.fresh[p.k], raw = rawWords(S, p), mine = h?.k === p.k && h.st === fresh;
  if (p.chop) {
    const pr = c.on('ou_prep');
    if (pr?.k === p.k && pr.st === fresh) return h ? putDown(S, h, c.go, 'ou_prep', keep(h)) : c.go('ou_prep', 'F', `Hold F at the prep counter to ${p.k === 'fish' ? 'slice' : 'chop'} the ${raw}`);
    if (mine) return pr ? c.go('ou_bin', 'E', `The prep counter is busy: bin the ${raw} or clear it`) : c.go('ou_prep', 'E', `Put the ${raw} on the prep counter`);
    if (h) return putDown(S, h, c.go, 'ou_prep', keep(h));
    if (pr) return c.go('ou_prep', 'E', `Clear the prep counter: take the ${nm(S, pr)}`);
    return fromDispenser(c, giver(S, p.k), p.k, anOf(p.k, raw));
  }
  const left = !h && counterWith(S, p.k, fresh); if (left) return c.go(left.t, 'E', `Take the ${raw} from the ${label(left.t)}`);   // (one set down, raw, before)
  if (p.at && mine) return into(S, c, p.at, `Put the ${raw} ${['ou_oven', 'ou_fryer', 'ou_toaster', 'ou_stove'].includes(p.at) ? 'in' : 'on'} the ${stationName(p.at)}`);
  if (h) return putDown(S, h, c.go, null, keep(h));
  return fromDispenser(c, giver(S, p.k), p.k, anOf(p.k, raw));
}
/** Holding the dish made of its parts: onto a plate (or into a bowl) at the plating counter. */
function plateIt(S, h, c, name, ware) {
  const pl = c.st('ou_plating');
  if (pl && pl.slot == null) return c.go('ou_plating', 'E', `E at the plating counter: the ${name} ${ware === 'bowl' ? 'into a bowl' : 'onto a plate'}`);
  return putDown(S, h, c.go, 'ou_plating', true);
}
const rank = p => (p.at ? 0 : p.dish ? 1 : p.chop ? 2 : 3);   // (what takes longest first)
function partsSteps(S, h, c, dish) {
  const r = dish.recipe, id = r.id, name = dish.name.toLowerCase(), [A, B] = r.parts;
  const isPart = it => !!it && [A, B].some(p => it.k === p.k && it.st === p.st), keep = it => isPart(it) || it?.k === id;
  if (h?.k === id) return plateIt(S, h, c, name, dish.ware);
  const made = counterWith(S, id, 'ready');
  if (made) {   // (put together on a counter: taken, the plating counter clear for it)
    if (h) return putDown(S, h, c.go, made.t);
    const pl = c.st('ou_plating'), there = pl && S.items[pl.slot];
    if (there && made.t !== 'ou_plating') return c.go('ou_plating', 'E', `Clear the plating counter: take the ${nm(S, there)}`);
    return c.go(made.t, 'E', `Take the ${name} from the ${label(made.t)}`);
  }
  const a = partAt(S, h, c, A), b = partAt(S, h, c, B), ready = x => !!x && READY.has(x.where);
  if (ready(a) && ready(b)) {   // (one in hand to the other; else the one in a machine taken out first)
    const [x, px, y, py] = a.where === 'hand' ? [a, A, b, B] : b.where === 'hand' ? [b, B, a, A] : [];
    if (x) return c.go(y.t, 'E', y.where === 'machine' ? `E at the ${stationName(y.t)} with the ${partWords(S, px)}: the ${partWords(S, py)} with it` : `Put the ${partWords(S, px)} with the ${partWords(S, py)} on the ${label(y.t)}`);
    if (h) return putDown(S, h, c.go, null, keep(h));
    const [f, pf] = a.where === 'machine' ? [a, A] : b.where === 'machine' ? [b, B] : [a, A];
    return c.go(f.t, 'E', `Take the ${partWords(S, pf)} from the ${where(f.t)}`);
  }
  for (const [x, px, y, py] of [[a, A, b, B], [b, B, a, A]]) {   // one ready: the other made
    if (!ready(x)) continue;
    if (y?.where === 'cooking') {   // (it in hand, waiting at the other's machine: E there once done)
      if (x.where === 'hand') return c.go(y.t, 'wait', `The ${kindName(S, py.k)} ${is(kindName(S, py.k))} cooking: wait, then E with the ${partWords(S, px)}`);
      if (h) return putDown(S, h, c.go, null, keep(h));
      return c.go(x.t, 'E', `Take the ${partWords(S, px)} from the ${where(x.t)}`);
    }
    if (y?.where === 'chopping' && x.where === 'machine') return h ? putDown(S, h, c.go, 'ou_prep', keep(h)) : c.go(x.t, 'E', `Take the ${partWords(S, px)} from the ${stationName(x.t)} before it burns`);   // (out at its best, then the chopping finished)
    if (y?.where === 'chopping') return h ? putDown(S, h, c.go, 'ou_prep', keep(h)) : c.go('ou_prep', 'F', `Hold F at the prep counter to ${py.k === 'fish' ? 'slice' : 'chop'} the ${rawWords(S, py)}`);
    if (x.where === 'machine' && py.at === x.t) return h ? putDown(S, h, c.go, null, true) : c.go(x.t, 'E', `Take the ${partWords(S, px)} from the ${stationName(x.t)}: the ${kindName(S, py.k)} ${goes(kindName(S, py.k))} in next`);   // (both in the one machine: one after the other)
    if (x.where === 'machine') return h && !(h.k === py.k && h.st === S.K.fresh[py.k]) ? putDown(S, h, c.go, null, keep(h)) : h ? makePart(S, h, c, py, keep) : c.go(x.t, 'E', `Take the ${partWords(S, px)} from the ${stationName(x.t)}`);   // (out before it burns)
    if (x.where === 'hand') return putDown(S, h, c.go, py.chop ? 'ou_prep' : null, true);   // (set down while the other is made)
    return makePart(S, h, c, py, keep);
  }
  // neither ready: the one that cooks longest started first, the other made meanwhile
  const order = [[a, A], [b, B]].sort((u, v) => rank(u[1]) - rank(v[1]));
  for (const [x, p] of order) {
    if (x?.where === 'cooking') continue;
    const busy = p.at && order.find(([o, q]) => q !== p && o?.where === 'cooking' && o.t === p.at);
    if (busy) return h ? putDown(S, h, c.go, null, keep(h)) : c.go(p.at, 'wait', `The ${kindName(S, busy[1].k)} ${is(kindName(S, busy[1].k))} cooking: the ${kindName(S, p.k)} ${goes(kindName(S, p.k))} in after`);   // (one machine for both)
    if (x?.where === 'chopping') return h ? putDown(S, h, c.go, 'ou_prep', keep(h)) : c.go('ou_prep', 'F', `Hold F at the prep counter to ${p.k === 'fish' ? 'slice' : 'chop'} the ${rawWords(S, p)}`);
    return makePart(S, h, c, p, keep);
  }
  return c.go(order[0][0].t, 'wait', `The ${kindName(S, order[0][1].k)} ${is(kindName(S, order[0][1].k))} cooking…`);
}
/** Onto a plate or bowl of rice, a part cooked in its machine (teriyaki: the chicken grilled; katsu: fried; burrito bowl:
 *  the beans): it started first, the rice scooped meanwhile, E at its machine with the rice once it is done. */
function ontoCooked(S, h, c, dish) {
  const r = dish.recipe, ware = dish.ware, name = dish.name.toLowerCase(), p = { k: r.b[0], st: r.b[1], at: r.cook };
  const done = Object.values(S.st).find(x => (x.t === 'ou_prep' || x.t === 'ou_plating') && S.items[x.slot]?.k === ware && S.items[x.slot]?.on === r.id);
  if (done) return h ? putDown(S, h, c.go) : c.go(done.t, 'E', `Take the ${name} from the ${label(done.t)}`);
  const based = it => it?.k === ware && it.on === r.base, keep = it => based(it) || (it?.k === p.k && it.st === p.st);
  const x = partAt(S, h, c, p), baseAt = Object.values(S.st).find(s => (s.t === 'ou_prep' || s.t === 'ou_plating') && based(S.items[s.slot]));
  const rice = S.K.say[r.base] || r.base, onTo = `${ware === 'bowl' ? 'into' : 'onto'} the ${kindName(S, ware)}`;
  if (x && READY.has(x.where)) {
    if (x.where === 'hand') return baseAt ? c.go(baseAt.t, 'E', `Put the ${partWords(S, p)} on the ${rice} on the ${label(baseAt.t)}`) : putDown(S, h, c.go, null, true);
    if (baseAt && !h) return c.go(baseAt.t, 'E', `Take the ${kindName(S, ware)} of ${rice} from the ${label(baseAt.t)}`);
    return withRice(S, h, c, ware, c.go(x.t, 'E', `E at the ${where(x.t)} with the ${rice}: the ${partWords(S, p)} ${onTo}`));
  }
  if (x?.where === 'cooking') {
    if (based(h)) return c.go(x.t, 'wait', `The ${kindName(S, p.k)} ${is(kindName(S, p.k))} cooking: wait, then E with the ${rice}`);
    if (baseAt && !h) return c.go(baseAt.t, 'E', `Take the ${kindName(S, ware)} of ${rice} from the ${label(baseAt.t)}`);
    const w = withRice(S, h, c, ware, null); return w ? { ...w, text: `While it cooks: ${w.text[0].toLowerCase()}${w.text.slice(1)}` } : c.go(x.t, 'wait', 'Cooking…');
  }
  return makePart(S, h, c, p, keep);
}
/** The station that gives (or pours) kind k. */
const giverOf = (S, k) => Object.keys(S.K.stations).find(t => S.K.stations[t].gives?.includes(k));
// ---- the drinks of the menu (2026-10-28)
/** A milk steamed, poured into a cup: of a shot (set down first), of tea, or an empty cup held to the steamer. */
function steamDrink(S, h, c, r, name) {
  const milk = r.milk, mw = kindName(S, milk), made = counterWith(S, 'cup', r.st), m = c.on('ou_steamer'), steamed = m?.k === milk && m.st === 'steamed';
  if (made) return h ? putDown(S, h, c.go) : c.go(made.t, 'E', `Take the ${name} from the ${label(made.t)}`);
  const milkSteps = () => {
    if (steamed) return h ? putDown(S, h, c.go) : c.go('ou_steamer', 'E', `Take the steamed ${mw}`);
    if (m?.k === milk) return c.go('ou_steamer', 'wait', `The ${mw} is steaming…`);
    if (h?.k === milk && h.st === S.K.fresh[milk]) return into(S, c, 'ou_steamer', `Put the ${mw} on the steamer`);
    if (h) return putDown(S, h, c.go);
    return fromDispenser(c, giver(S, milk), milk, mw);
  };
  if (r.base === 'empty') {   // (the cup held to the steamer: poured in there)
    if (steamed) return container(S, h, c, 'cup', c.go('ou_steamer', 'E', `E at the steamer with the cup: the steamed ${mw} into it`));
    if (m?.k === milk) return h?.k === 'cup' && h.st === 'empty' ? c.go('ou_steamer', 'wait', `The ${mw} is steaming: wait, then E with the cup`) : h ? putDown(S, h, c.go) : { ...c.go('ou_plating', 'E', 'While it steams: take a cup from the plating counter'), pick: 'cup' };
    return milkSteps();
  }
  const bw = r.base === 'shot' ? 'shot' : 'tea', baseAt = counterWith(S, 'cup', r.base);
  if (h?.k === 'cup' && h.st === r.base) { const free = ['ou_prep', 'ou_plating'].find(t => c.st(t) && c.st(t).slot == null); return free ? c.go(free, 'E', `Put the ${bw} down on the ${label(free)}`) : c.go('ou_pass', 'wait', `Clear a counter for the ${bw}`); }
  if (h?.k === milk && h.st === 'steamed') return baseAt ? c.go(baseAt.t, 'E', `Pour the ${mw} into the ${bw} on the ${label(baseAt.t)}`) : putDown(S, h, c.go, null, true);
  if (baseAt) return milkSteps();
  return r.base === 'shot' ? shot(S, h, c) : filled(S, h, c, 'ou_kettle', 'tea');
}
/** A cup or glass filled under its machine: a coffee to go, an iced coffee (a glass of ice from the fridge), lemonade (the
 *  juicer loaded with a lemon), bubble tea (the pearls into the glass at a counter first). */
function fillDrink(S, h, c, r, name) {
  if (r.at === 'ou_espresso') return shot(S, h, c, { k: r.k || r.ware, from: r.from, to: r.st, store: r.k ? giver(S, r.k) : null }) || c.go('ou_pass', 'E', `Serve the ${name} at the pass`);
  if (r.load) return filled(S, h, c, r.at, name, r.load, r.st);
  const m = c.on(r.at), w = r.ware, wn = kindName(S, w), fresh = S.K.fresh[r.with], ww = S.K.say[`${r.with}:${fresh}`] || kindName(S, r.with);
  if (m?.k === w && m.st === r.st) return h ? putDown(S, h, c.go) : c.go(r.at, 'E', `Take the ${name} from the ${stationName(r.at)}`);
  if (m?.k === w && m.st === r.from) return c.go(r.at, 'wait', `The ${name} is pouring…`);
  if (h?.k === w && h.st === r.from) return into(S, c, r.at, `Put the ${S.K.say[`${w}:${r.from}`] || wn} under the ${stationName(r.at)}`);
  const at = counterWith(S, r.with, fresh), pl = c.st('ou_plating');
  if (at) return container(S, h, c, w, c.go(at.t, 'E', `E at the ${label(at.t)} with the ${wn}: the ${ww} into it`));
  if (h?.k === r.with) return pl && pl.slot == null ? c.go('ou_plating', 'E', `E at the plating counter: the ${ww} into a ${wn}`) : putDown(S, h, c.go, 'ou_plating', true);   // (into a glass from its stack there)
  if (h) return putDown(S, h, c.go);
  return fromDispenser(c, giver(S, r.with), r.with, ww);
}
/** Its mix in the blender (a milk with a scoop of ice cream first; a cocktail shaken first), a glass held to it. */
function blendDrink(S, h, c, r, name) {
  const mix = r.mix, b = c.on('ou_blender'), from = r.freezer ? 'shake' : r.shaker ? 'shaken' : S.K.fresh[mix], mw = S.K.say[`${mix}:${from}`] || kindName(S, mix);
  if (b?.k === mix && b.st !== from) return container(S, h, c, 'glass', c.go('ou_blender', 'E', `E at the blender with the glass: pour the ${name}`));
  if (b?.k === mix) return h ? (h.k === 'glass' && h.st === 'empty' ? c.go('ou_blender', 'wait', 'Blending… then E with the glass') : putDown(S, h, c.go)) : { ...c.go('ou_plating', 'E', 'While it blends: take a glass from the plating counter'), pick: 'glass' };
  if (h?.k === mix && h.st === from) return into(S, c, 'ou_blender', `Put the ${mw} in the blender`);
  if (r.freezer && h?.k === mix && h.st === S.K.fresh[mix]) return c.go('ou_freezer', 'E', `Hold the ${kindName(S, mix)} to the ice cream freezer: a scoop into it`);
  if (h) return putDown(S, h, c.go);
  if (r.shaker) {
    const sh = c.on('ou_cocktail');
    if (sh?.k === 'shaker' && sh.st === 'shaken') return c.go('ou_cocktail', 'E', `Take the shaken ${name} from the cocktail station`);
    if (sh) return c.go('ou_cocktail', 'E', `Clear the cocktail station: take the ${nm(S, sh)}`);
    return c.go('ou_cocktail', 'F', `Hold F at the cocktail station to shake the ${name}`);
  }
  return fromDispenser(c, giver(S, mix), mix, S.K.say[`${mix}:${S.K.fresh[mix]}`] || kindName(S, mix));
}
/** The next step for a dish of the menu, by how it is made. */
function menuSteps(S, h, c, dish) {
  const r = dish.recipe, id = r.id, name = dish.name.toLowerCase(), ware = dish.ware;
  if (r.how === 'cook' && S.K.stations[r.at]?.tend) {   // (the wok: it cooks only while tossed)
    const w = c.on(r.at);
    if (w?.k === id && w.st !== 'raw') return container(S, h, c, ware, c.go(r.at, 'E', `E at the ${stationName(r.at)} with the ${kindName(S, ware)}: the ${name} into it`));
    if (w?.k === id) return h ? putDown(S, h, c.go) : c.go(r.at, 'F', `Hold F at the ${stationName(r.at)} to toss the ${name}`);
    if (h?.k === id && h.st === 'raw') return into(S, c, r.at, `Put the ${name} in the ${stationName(r.at)}`);
    if (h) return putDown(S, h, c.go);
    return fromDispenser(c, r.from, id, name);
  }
  if (r.how === 'cook') {
    return plated(S, h, c, r.at, id, 'raw', () => {
      if (h?.k === id && h.st === 'raw') return into(S, c, r.at, `Put the ${S.K.say[`${id}:raw`] || name} in the ${stationName(r.at)}`);
      if (h) return putDown(S, h, c.go);
      return fromDispenser(c, r.from, id, name);
    }, name, ware);
  }
  if (r.how === 'chain') {   // (into the first machine, then the second)
    const [A, B] = r.at;
    return plated(S, h, c, B, id, 'prepared', () => {
      const m1 = c.on(A);
      if (h?.k === id && h.st === 'prepared') return into(S, c, B, `Put the ${name} in the ${stationName(B)}`);
      if (m1?.k === id && m1.st === 'prepared') return h ? putDown(S, h, c.go) : c.go(A, 'E', `Take the ${name} from the ${stationName(A)}`);
      if (m1?.k === id) return c.go(A, 'wait', `The ${name} is on the ${stationName(A)}…`);
      if (h?.k === id && h.st === 'raw') return into(S, c, A, `Put the ${S.K.say[`${id}:raw`] || name} on the ${stationName(A)}`);
      if (h) return putDown(S, h, c.go);
      return fromDispenser(c, r.from, id, name);
    }, name, ware);
  }
  if (r.how === 'topped') {   // (its base onto its chopped topping at the prep counter, then into its machine)
    return plated(S, h, c, r.at, id, 'raw', () => topped(S, h, c, { k: id, base: r.base[0], top: r.top, t: r.at, put: `Put the ${name} in the ${stationName(r.at)}` }), name, ware);
  }
  if (r.how === 'prep') {   // (its makings prepared at the prep counter, held: then onto its plate there)
    const p = c.on('ou_prep');
    if (p?.k === id && p.st === 'ready') return container(S, h, c, ware, c.go('ou_prep', 'E', `E at the prep counter with the ${kindName(S, ware)}: the ${name} onto it`));
    if (p?.k === id) return h ? putDown(S, h, c.go, 'ou_prep') : c.go('ou_prep', 'F', `Hold F at the prep counter to make the ${name}`);
    if (h?.k === id && h.st === 'whole') return p ? c.go('ou_bin', 'E', `The prep counter is busy: bin the makings or clear it`) : c.go('ou_prep', 'E', `Put the makings of the ${name} on the prep counter`);
    if (h) return putDown(S, h, c.go, 'ou_prep');
    if (p) return c.go('ou_prep', 'E', `Clear the prep counter: take the ${nm(S, p)}`);
    return fromDispenser(c, r.from, id, `the makings of the ${name}`);
  }
  if (r.how === 'ready') {   // (as it comes, set down, then a plate held to it)
    const at = counterWith(S, id, 'ready');
    if (at) return container(S, h, c, ware, c.go(at.t, 'E', `E at the ${label(at.t)} with the ${kindName(S, ware)}: the ${name} onto it`));
    if (h?.k === id) return putDown(S, h, c.go, null, true);
    if (h) return putDown(S, h, c.go);
    return fromDispenser(c, r.from, id, name);
  }
  if (r.how === 'combo') return partsSteps(S, h, c, dish);
  if (r.how === 'steam') return steamDrink(S, h, c, r, name);
  if (r.how === 'fill') return fillDrink(S, h, c, r, name);
  if (r.how === 'blend') return blendDrink(S, h, c, r, name);
  if (r.how === 'pour') return poured(S, h, c, 'ou_wine', r.give);
  if (r.how === 'asis') return h ? putDown(S, h, c.go) : fromDispenser(c, 'ou_fridge', id, anOf(id, name));
  if (r.how === 'onto' && r.cook) return ontoCooked(S, h, c, dish);
  if (r.how === 'scoop') return container(S, h, c, ware, { ...c.go(r.at, 'E', `E at the ${stationName(r.at)} with the ${kindName(S, ware)}: the ${name} ${ware === 'bowl' ? 'into' : 'onto'} it`), pick: id });
  if (r.how === 'onto') {   // (what goes on it ready on a counter; a bowl of the base held to it)
    const [bk, bst] = r.b, base = r.base, bAt = Object.values(S.st).find(x => (x.t === 'ou_prep' || x.t === 'ou_plating') && S.items[x.slot]?.k === bk && S.items[x.slot]?.st === bst);
    const bWords = S.K.say[`${bk}:${bst}`] || S.K.say[bk] || bk;
    if (bAt) {
      if (h?.k === ware && h.on === base) return c.go(bAt.t, 'E', `E at the ${label(bAt.t)} with the ${kindName(S, ware)}: the ${bWords} onto it`);
      const pourer = giverOf(S, base);
      return container(S, h, c, ware, c.go(pourer, 'E', `Scoop the ${S.K.say[base] || base} into the ${kindName(S, ware)} at the ${stationName(pourer)}`));
    }
    if (r.chop) {   // (chopped at the prep counter first)
      const p = c.on('ou_prep');
      if (p?.k === bk) return h ? putDown(S, h, c.go, 'ou_prep') : c.go('ou_prep', 'F', `Hold F at the prep counter to chop the ${S.K.say[bk] || bk}`);
      if (h?.k === bk) return p ? c.go('ou_bin', 'E', `The prep counter is busy: bin the ${bk} or clear it`) : c.go('ou_prep', 'E', `Put the ${S.K.say[bk] || bk} on the prep counter`);
      if (h) return putDown(S, h, c.go, 'ou_prep');
      if (p) return c.go('ou_prep', 'E', `Clear the prep counter: take the ${nm(S, p)}`);
      return fromDispenser(c, r.from, bk, S.K.say[bk] || bk);
    }
    if (h?.k === bk) return putDown(S, h, c.go, null, true);   // (set down, ready for the bowl)
    if (h) return putDown(S, h, c.go);
    return fromDispenser(c, r.from, bk, S.K.say[`${bk}:${bst}`] || bk);
  }
  return null;
}
/** The words of a dish's recipe for its ticket. */
export function recipeWords(dish) {
  const r = dish.recipe, at = t => stationName(t).replace(/^\w/, ch => ch.toUpperCase()), ware = dish.ware === 'bowl' ? 'Bowl' : 'Plate';
  if (r.how === 'cook') return [r.from === 'ou_fridge' ? 'Fridge' : 'Pantry', at(r.at), ware, 'Serve'];
  if (r.how === 'chain') return [r.from === 'ou_fridge' ? 'Fridge' : 'Pantry', ...r.at.map(at), ware, 'Serve'];
  if (r.how === 'prep') return ['Makings', 'Prepare', ware, 'Serve'];
  if (r.how === 'topped') return [`Chop ${r.top}`, r.base[0].replace(/^\w/, ch => ch.toUpperCase()), at(r.at), ware, 'Serve'];
  if (r.how === 'ready') return [r.from === 'ou_fridge' ? 'Fridge' : 'Pantry', ware, 'Serve'];
  const cap = w => w.replace(/^\w/, ch => ch.toUpperCase());
  if (r.how === 'onto' && r.cook) return [`${cap(r.b[0])}: ${stationName(r.cook)}`, ware, 'Rice', 'Together', 'Serve'];
  if (r.how === 'onto') return [r.chop ? `Chop ${r.b[0]}` : cap(r.b[0]), ware, 'Scoop', 'Together', 'Serve'];
  if (r.how === 'combo') return [...r.parts.map(p => (p.at ? `${cap(p.k)}: ${stationName(p.at)}` : p.chop ? `Chop ${p.k}` : p.dish ? cap(p.dish.replace(/_/g, ' ')) : cap(p.k))), 'Together', ware, 'Serve'];
  if (r.how === 'scoop') return [ware, at(r.at), 'Serve'];
  const say = k => (kitchenOf(DEFAULT_KITCHEN).say[k] || k).replace(/^\w/, ch => ch.toUpperCase());
  if (r.how === 'steam') return [...(r.base === 'shot' ? ['Shot'] : r.base === 'tea' ? ['Tea'] : []), `Steam ${say(r.milk).toLowerCase()}`, r.base === 'empty' ? 'Cup' : 'Pour', 'Serve'];
  if (r.how === 'fill') return [...(r.at === 'ou_espresso' ? ['Grind', 'Load'] : []), r.load ? `Load ${r.load}` : r.with ? `Pearls in a glass` : r.k ? say(r.k) : cap(r.ware === 'togo' ? 'cup to go' : r.ware), r.at === 'ou_espresso' ? 'Under it' : at(r.at), 'Serve'];
  if (r.how === 'blend') return [r.shaker ? 'Shake' : say(r.mix), ...(r.freezer ? ['Scoop of ice cream'] : []), 'Blend', 'Glass', 'Serve'];
  if (r.how === 'pour') return [cap(r.ware), `Pour ${r.give}`, 'Serve'];
  if (r.how === 'asis') return ['Fridge', 'Serve'];
  return ['Serve'];
}
for (const [d, dish] of Object.entries(kitchenOf(DEFAULT_KITCHEN).dishes)) if (dish.recipe && !RECIPES[d]) RECIPES[d] = recipeWords(dish);

const RECIPE_STEPS = {
  espresso: (S, h, c) => shot(S, h, c),
  latte(S, h, c) {
    const shotAt = counterWith(S, 'cup', 'shot'), latteAt = counterWith(S, 'cup', 'latte'), milk = c.on('ou_steamer');
    if (latteAt) return h ? putDown(S, h, c.go) : c.go(latteAt.t, 'E', `Take the latte from the ${label(latteAt.t)}`);
    if (h?.k === 'milk' && h.st === 'steamed') return shotAt ? c.go(shotAt.t, 'E', `Pour the milk into the shot on the ${label(shotAt.t)}`) : putDown(S, h, c.go);
    if (h?.k === 'cup' && h.st === 'shot') { const free = ['ou_prep', 'ou_plating'].find(t => c.st(t) && c.st(t).slot == null); return free ? c.go(free, 'E', `Put the shot down on the ${label(free)}`) : c.go('ou_pass', 'wait', 'Clear a counter for the shot'); }
    if (shotAt) {   // then the milk
      if (milk?.st === 'steamed') return h ? putDown(S, h, c.go) : c.go('ou_steamer', 'E', 'Take the steamed milk');
      if (milk?.st === 'cold') return c.go('ou_steamer', 'wait', 'The milk is steaming…');
      if (h?.k === 'milk' && h.st === 'cold') return c.go('ou_steamer', 'E', 'Put the milk on the steamer');
      if (h) return putDown(S, h, c.go);
      return fromDispenser(c, 'ou_fridge', 'milk');
    }
    return shot(S, h, c);
  },
  smoothie(S, h, c) {
    const b = c.on('ou_blender');
    if (b && b.k === 'berries' && b.st !== 'whole') return container(S, h, c, 'glass', c.go('ou_blender', 'E', 'E at the blender with the glass: pour the smoothie'));
    if (b && b.k === 'berries') return h ? (h.k === 'glass' && h.st === 'empty' ? c.go('ou_blender', 'wait', 'Blending… then E with the glass') : putDown(S, h, c.go)) : { ...c.go('ou_plating', 'E', 'While it blends: take a glass from the plating counter'), pick: 'glass' };
    if (h?.k === 'berries' && h.st === 'whole') return c.go('ou_blender', 'E', 'Put the berries in the blender');
    if (h) return putDown(S, h, c.go);
    return fromDispenser(c, 'ou_fridge', 'berries');
  },
  croissant(S, h, c) {
    return plated(S, h, c, 'ou_oven', 'croissant', 'raw', () => {
      if (h?.k === 'croissant' && h.st === 'raw') return c.go('ou_oven', 'E', 'Put the croissant in the oven');
      if (h) return putDown(S, h, c.go);
      return fromDispenser(c, 'ou_pantry', 'croissant');
    });
  },
  toastie(S, h, c) {
    return plated(S, h, c, 'ou_press', 'toastie', 'raw', () => {
      const prep = c.on('ou_prep');
      if (h?.k === 'toastie' && h.st === 'raw') return c.go('ou_press', 'E', 'Put the toastie in the press');
      if (prep?.k === 'toastie') return h ? putDown(S, h, c.go, 'ou_prep') : c.go('ou_prep', 'E', 'Take the toastie from the prep counter');
      if (prep?.k === 'tomato' && prep.st === 'chopped') {
        if (h?.k === 'bread') return c.go('ou_prep', 'E', 'Put the bread with the chopped tomato');
        if (h) return putDown(S, h, c.go, 'ou_prep');
        return fromDispenser(c, 'ou_pantry', 'bread');
      }
      if (prep?.k === 'tomato') return h ? putDown(S, h, c.go, 'ou_prep') : c.go('ou_prep', 'F', 'Hold F at the prep counter to chop the tomato');
      if (h?.k === 'tomato' && h.st === 'whole') return prep ? c.go('ou_bin', 'E', 'The prep counter is busy: bin the tomato or clear it') : c.go('ou_prep', 'E', 'Put the tomato on the prep counter');
      if (h) return putDown(S, h, c.go, 'ou_prep');   // (not back onto the counter it needs: it would only be cleared again)
      if (prep) return c.go('ou_prep', 'E', `Clear the prep counter: take the ${nm(S, prep)}`);
      return fromDispenser(c, 'ou_fridge', 'tomato');
    });
  },
  fries(S, h, c) {
    return plated(S, h, c, 'ou_fryer', 'fries', 'frozen', () => {
      if (h?.k === 'fries' && h.st === 'frozen') return c.go('ou_fryer', 'E', 'Drop the fries in the fryer');
      if (h) return putDown(S, h, c.go);
      return fromDispenser(c, 'ou_fridge', 'fries');
    });
  },
  pancakes(S, h, c) {
    return plated(S, h, c, 'ou_griddle', 'batter', 'raw', () => {
      if (h?.k === 'batter' && h.st === 'raw') return c.go('ou_griddle', 'E', 'Pour the batter on the griddle');
      if (h) return putDown(S, h, c.go);
      return fromDispenser(c, 'ou_fridge', 'batter');
    }, 'pancakes');
  },
  cheeseburger: (S, h, c) => bunned(S, h, c, { meat: 'patty', made: 'burger', name: 'cheeseburger' }),
  hot_dog: (S, h, c) => bunned(S, h, c, { meat: 'sausage', made: 'hotdog', name: 'hot dog' }),
  avocado_toast: (S, h, c) => onTopping(S, h, c, { base: 'bread', done: 'toasted', t: 'ou_toaster', top: 'avocado', made: 'avo_toast', name: 'avocado toast', put: 'Put the bread in the toaster', take: 'Take the toast from the toaster', onto: 'Put the toast on the chopped avocado', busy: 'The bread is toasting…' }),
  tacos: (S, h, c) => onTopping(S, h, c, { base: 'tortilla', done: 'cooked', t: 'ou_griddle', top: 'tomato', made: 'tacos', name: 'tacos', put: 'Put the tortilla on the griddle', take: 'Take the warm tortilla from the griddle', onto: 'Put the tortilla on the chopped tomato', busy: 'The tortilla is warming…' }),
  popcorn(S, h, c) {   // the kernels into the popcorn machine, popped, served as they are (in their bag)
    const m = c.on('ou_popcorn');
    if (m?.k === 'kernels' && m.st === 'popped') return h ? putDown(S, h, c.go) : c.go('ou_popcorn', 'E', 'Take the popcorn from the popcorn machine');
    if (m?.k === 'kernels') return c.go('ou_popcorn', 'wait', 'The popcorn is popping…');
    if (h?.k === 'kernels' && h.st === 'raw') return into(S, c, 'ou_popcorn', 'Pour the kernels into the popcorn machine');
    if (h) return putDown(S, h, c.go);
    return fromDispenser(c, 'ou_pantry', 'kernels');
  },
  water: (S, h, c) => (h ? putDown(S, h, c.go) : fromDispenser(c, 'ou_fridge', 'water')),   // (a bottle from the fridge, served as it is)
  curry(S, h, c) {   // the curry simmered on the stove; meanwhile a bowl of rice; the curry poured over it at the stove
    const pot = c.on('ou_stove');
    if (pot?.k === 'curry' && pot.st !== 'raw') return withRice(S, h, c, 'bowl', c.go('ou_stove', 'E', 'E at the stove with the rice: the curry over it'));
    if (pot?.k === 'curry') return h?.k === 'bowl' && h.on === 'rice' ? c.go('ou_stove', 'wait', 'The curry is simmering: wait, then E with the rice') : withRice(S, h, c, 'bowl', c.go('ou_stove', 'wait', 'The curry is simmering…'));
    if (h?.k === 'curry' && h.st === 'raw') return into(S, c, 'ou_stove', 'Put the curry on the stove to simmer');
    if (h) return putDown(S, h, c.go);
    return fromDispenser(c, 'ou_fridge', 'curry');
  },
  sushi(S, h, c) {   // a fish sliced at the prep counter; a plate of rice held to it
    const prep = c.on('ou_prep');
    if (prep?.k === 'fish' && prep.st === 'chopped') return withRice(S, h, c, 'plate', c.go('ou_prep', 'E', 'E at the prep counter with the rice: the fish onto it'));
    if (prep?.k === 'fish') return h ? putDown(S, h, c.go, 'ou_prep') : c.go('ou_prep', 'F', 'Hold F at the prep counter to slice the fish');
    if (h?.k === 'fish' && h.st === 'whole') return prep ? c.go('ou_bin', 'E', 'The prep counter is busy: bin the fish or clear it') : c.go('ou_prep', 'E', 'Put the fish on the prep counter');
    if (h) return putDown(S, h, c.go, 'ou_prep');
    if (prep) return c.go('ou_prep', 'E', `Clear the prep counter: take the ${nm(S, prep)}`);
    return fromDispenser(c, 'ou_fridge', 'fish');
  },
  naan: (S, h, c) => plated(S, h, c, 'ou_tandoor', 'dough', 'raw', () => {
    if (h?.k === 'dough' && h.st === 'raw') return into(S, c, 'ou_tandoor', 'Slap the dough onto the tandoor\'s wall');
    if (h) return putDown(S, h, c.go);
    return fromDispenser(c, 'ou_pantry', 'dough');
  }, 'naan'),
  tandoori: (S, h, c) => plated(S, h, c, 'ou_tandoor', 'chicken', 'raw', () => {
    if (h?.k === 'chicken' && h.st === 'raw') return into(S, c, 'ou_tandoor', 'Put the chicken in the tandoor');
    if (h) return putDown(S, h, c.go);
    return fromDispenser(c, 'ou_fridge', 'chicken');
  }, 'tandoori chicken'),
  dumplings: (S, h, c) => plated(S, h, c, 'ou_bamboo', 'dumplings', 'raw', () => {
    if (h?.k === 'dumplings' && h.st === 'raw') return into(S, c, 'ou_bamboo', 'Put the dumplings in the bamboo steamer');
    if (h) return putDown(S, h, c.go);
    return fromDispenser(c, 'ou_fridge', 'dumplings');
  }, 'dumplings'),
  ice_cream: (S, h, c) => container(S, h, c, 'bowl', { ...c.go('ou_freezer', 'E', 'Scoop the ice cream into the bowl at the freezer'), pick: 'icecream' }),
  beer: (S, h, c) => filled(S, h, c, 'ou_taps', 'beer'),
  red_wine: (S, h, c) => poured(S, h, c, 'ou_wine', 'red'),
  white_wine: (S, h, c) => poured(S, h, c, 'ou_wine', 'white'),
  champagne: (S, h, c) => poured(S, h, c, 'ou_wine', 'bubbly'),
  cocktail(S, h, c) {   // shaken at the cocktail station, then a cocktail glass held to it
    const sh = c.on('ou_cocktail');
    if (sh?.k === 'shaker') return container(S, h, c, 'coupe', c.go('ou_cocktail', 'E', 'E at the cocktail station with the glass: pour the cocktail'));
    if (h?.k === 'shaker') return sh ? putDown(S, h, c.go) : c.go('ou_cocktail', 'E', 'Put the shaker back on the cocktail station');
    if (h) return putDown(S, h, c.go);
    if (sh) return c.go('ou_cocktail', 'E', `Clear the cocktail station: take the ${nm(S, sh)}`);
    return c.go('ou_cocktail', 'F', 'Hold F at the cocktail station to shake a cocktail');
  },
  pizza: (S, h, c) => plated(S, h, c, 'ou_pizza_oven', 'pizza', 'raw', () => topped(S, h, c, { k: 'pizza', base: 'dough', top: 'tomato', t: 'ou_pizza_oven', put: 'Slide the pizza into the pizza oven' }), 'pizza'),
  pasta: (S, h, c) => plated(S, h, c, 'ou_stove', 'pasta', 'raw', () => {
    if (h?.k === 'pasta' && h.st === 'raw') return into(S, c, 'ou_stove', 'Put the pasta in the pot on the stove');
    if (h) return putDown(S, h, c.go);
    return fromDispenser(c, 'ou_pantry', 'pasta');
  }, 'pasta'),
  soup: (S, h, c) => plated(S, h, c, 'ou_stove', 'soup', 'raw', () => topped(S, h, c, { k: 'soup', base: 'stock', top: 'tomato', t: 'ou_stove', put: 'Put the soup on the stove to simmer' }), 'soup', 'bowl'),
  stir_fry(S, h, c) {   // the wok cooks only while tossed: hands free, hold F; done, a bowl
    const w = c.on('ou_wok');
    if (w?.k === 'stirfry' && w.st === 'tossed') return container(S, h, c, 'bowl', c.go('ou_wok', 'E', 'E at the wok with the bowl: the stir-fry into it'));
    if (w?.k === 'stirfry') return h ? putDown(S, h, c.go) : c.go('ou_wok', 'F', 'Hold F at the wok to toss the stir-fry');
    return topped(S, h, c, { k: 'stirfry', base: 'noodles', top: 'pepper', t: 'ou_wok', put: 'Put the stir-fry in the wok' });
  },
  cola: (S, h, c) => filled(S, h, c, 'ou_soda', 'cola'),
  tea: (S, h, c) => filled(S, h, c, 'ou_kettle', 'tea'),
  orange_juice: (S, h, c) => filled(S, h, c, 'ou_juicer', 'orange juice'),
};
