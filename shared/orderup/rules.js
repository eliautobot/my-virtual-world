// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Order Up's rules (phase 3 of PLAN-RESTAURANT-GAME.md, 2026-10-26, the product owner: "Think of the game Over Cooked
// but for MVW ... players can cook, serve, and build up skills ... poor, bad, medium, good, great, or supreme"): one
// kitchen's Rush as a pure, deterministic state machine, the same on the page (practice, phase 3), the server (real
// Rushes, phase 4) and for computer cooks (phase 5). No geometry here: a move names its station; whoever runs the game
// checks the cook is at it. What a kitchen has and cooks (its stations' roles, dishes, ware, combos) is its template
// (shared/orderup/kitchens.js, PLAN-RESTAURANT-GAME.md 6b K4): newRush(stations, { kitchen, menu }), the café's by default,
// its tickets only for what its place sells (menu: the item ids of its menu; none: all it can make).
//
//   the café's menu   espresso  grind (hold at the grinder) -> the grounds into the espresso station -> a cup under it
//                     latte     a shot, then milk from the fridge steamed at the steamer, poured into the cup
//                     smoothie  berries from the fridge blended, poured into a glass
//                     croissant one from the pantry warmed in the oven, onto a plate
//                     toastie   bread (pantry) and a tomato (fridge) chopped at the prep counter, together, pressed, plated
//   what the new      fries     frozen fries (fridge) in the fryer, onto a plate
//   appliances cook   cheeseburger a patty (fridge) on the grill, E at it with a bun (pantry): served in its wrap
//   (2026-10-28)      pancakes  batter (fridge) on the griddle, onto a plate
//                     avocado toast an avocado chopped, bread toasted in the toaster, the toast onto it, plated
//                     cola, tea a glass under the soda fountain, a cup under the tea station
//                     orange juice an orange loaded into the juicer, a glass under it
//   the stove, the    pizza     dough (pantry) onto a chopped tomato, baked in the pizza oven, plated
//   pizza oven, the   pasta     dry pasta (pantry) boiled on the stove, plated
//   wok               soup      stock (fridge) onto a chopped tomato, simmered on the stove, into a bowl
//                     stir-fry  noodles (pantry) onto a chopped pepper, tossed in the wok (it cooks only while you hold
//                               at it), into a bowl
//   the bar           beer      a glass under the taps
//                     wine      a wine glass held to the wine fridge: red, white or champagne chosen, poured at once
//                     cocktail  hold at the cocktail station to shake one, a cocktail glass held to it: poured
//   the rice cooker,  curry     a bowl held to the rice cooker (rice into it), the curry simmered on the stove poured over
//   the tandoor, the            it (E at the stove with the bowl)
//   bamboo steamer,   sushi     a fish sliced at the prep counter, a plate of rice held to it
//   the freezer       naan, tandoori chicken  dough or chicken in the tandoor, plated; dumplings  steamed, plated
//                     ice cream a bowl held to the freezer: scooped
//   a ticket          its dish and the menu item it is (a cappuccino is made as a latte; a mojito as any cocktail)
//   at a station      E (interact): take what it holds, else what it gives (the fridge, the pantry: press again to
//                     swap for the next thing it has; the plating counter: plates, cups, glasses); put down; put together; serve
//                     at the pass. Hold (work): grind, chop, wash.
//   timing            the oven, the press, the steamer, the blender and the espresso machine cook by themselves: done
//                     after `cook` seconds, perfect for `perfect` more, then going over until `burn` (burnt, bitter,
//                     scalded: capped at Bad; left longer: smoke)
//   a dish's grade    0-100: its steps' timing (perfect 100, going over down to 40, burnt 25), its freshness (hot drinks
//                     cool from 8 s after done, food from 12 s), latte art (+5) when shot and milk are both perfect;
//                     Poor < 20, Bad < 40, Medium < 60, Good < 75, Great < 90, Supreme 90+. A cook's skill (0-10)
//                     widens the perfect window (+6 % a level) and works faster (+5 % a level).
//   the Rush          tickets come in (sooner as it goes, at most 4 open, each with its patience); served: its money
//                     and a tip by grade; lost when its patience runs out. Plates, cups and glasses come back dirty to the dish
//                     return: wash them at the sink. Stars by the points served against the Rush's length.
import { RNG } from '../rng.js';
import { bonusAt, serviceOf, cleanSkills } from './skills.js';
import { kitchenOf, DEFAULT_KITCHEN, dishItems } from './kitchens.js';

export const GRADES = [['Poor', 20], ['Bad', 40], ['Medium', 60], ['Good', 75], ['Great', 90], ['Supreme', 1e9]];
export const gradeOf = s => GRADES.find(g => s < g[1])[0];

// The café's coffee kitchen (shared/orderup/kitchens.js) as tables, for the page, the coach and the effects; a Rush plays
// the template it was started with (S.K)
const K0 = kitchenOf(DEFAULT_KITCHEN);
const byRole = (K, ...roles) => Object.fromEntries(Object.entries(K.stations).filter(([, d]) => roles.includes(d.role)));
export const DISHES = K0.dishes;
// what the dispensers give, in turn (press again to swap)
export const GIVES = Object.fromEntries(Object.entries(byRole(K0, 'give')).map(([t, d]) => [t, d.gives]));
// the stations that cook by themselves: what they take (kind, state) and what it becomes
export const AUTO = byRole(K0, 'cook');
// the stations worked by hand: how long, and what they do (the wok too: tossed while held)
export const WORK = { ...byRole(K0, 'make', 'chop', 'sink'), ...Object.fromEntries(Object.entries(byRole(K0, 'cook')).filter(([, d]) => d.tend)) };
// the plating counter's stacks (2026-10-27, "for the smoothies we need glass cups not coffee cups"): each kind, its stack
export const WARE = Object.fromEntries(Object.entries(K0.ware).map(([k, w]) => [k, w.stack]));
const NONE = Object.freeze({});
const sdef = (S, st) => S.K.stations[st.t] || NONE;   // (what a station does in this kitchen)
const findRole = (S, role) => Object.values(S.st).find(x => sdef(S, x).role === role);
const stackOf = (S, k) => S.K.ware[k]?.stack || 'plates';

/** What a Rush in kitchen K with these station kinds orders: the dishes it has every station for, of those its place
 *  sells (menu: item ids, shared/food.js) when it sells any of them, else all of them. */
export function menuOf(K, have, menu = null) {
  const all = Object.keys(K.dishes).filter(d => K.dishes[d].needs.every(n => have.has(n))), can = all.filter(d => !K.dishes[d].sold);
  if (!menu?.length) return can;
  const on = new Set(menu), sold = all.filter(d => dishItems(K, d).some(i => on.has(i)));
  return sold.length ? sold : can;
}
/** A new Rush in a kitchen with these stations ([{ id, t }]): o.kitchen (its template), o.menu (its place's item ids),
 *  o.seed, o.dur (seconds), o.skill (0-10), o.players, o.skills ({ player: { skill: rank } }); o.course, a Rush level's own pace (shared/orderup/module.js):
 *  { pace: the gap between orders x, patience: how long a customer waits x, strict: only Good or better counts }. */
export function newRush(stations, o = {}) {
  const K = kitchenOf(o.kitchen), menu = menuOf(K, new Set(stations.map(s => s.t)), o.menu);
  const uses = [...new Set(menu.flatMap(d => K.dishes[d].uses || []))];   // (what its dispensers give in this Rush)
  const wares = [...new Set(menu.map(d => K.dishes[d].ware).filter(w => K.ware[w]))];   // (what its plating counter offers)
  // the menu items each dish is ordered as: those its place sells, else the dish's own
  const on = new Set(o.menu || []), sells = Object.fromEntries(menu.map(d => { const its = dishItems(K, d); return [d, on.size && its.some(i => on.has(i)) ? its.filter(i => on.has(i)) : its.slice(0, 1)]; }));
  const S = { t: 0, dur: o.dur ?? 180, seed: String(o.seed ?? 'practice'), kitchen: K.id, menu, uses, wares, sells, over: false, nextId: 1, items: {}, st: {}, tickets: [],
    nextTicket: 2, nTicket: 0, served: [], lost: 0, money: 0, tips: 0, points: 0, ev: [], players: {}, returns: [], skill: o.skill ?? 0,
    score: 0, burns: 0, pace: o.course?.pace ?? 1, patience: o.course?.patience ?? 1, strict: !!o.course?.strict };
  Object.defineProperty(S, 'K', { value: K });   // (its template: o.kitchen, an id or a template; not part of the state's data)
  S.rng = new RNG(`orderup:${S.seed}`);
  for (const s of stations) S.st[s.id] = { id: s.id, t: s.t, slot: null, loaded: false, prog: 0, work: 0, give: 0, gaveAt: -9, sink: [] };
  const plating = stations.find(s => K.stations[s.t]?.role === 'plating');
  if (plating) Object.assign(S.st[plating.id], Object.fromEntries(Object.values(K.ware).map(w => [w.stack, w.n])));
  for (const p of o.players || ['you']) S.players[p] = { id: p, hold: null, ...(o.skills?.[p] ? { skills: cleanSkills(o.skills[p]) } : {}) };   // (each cook's skills: shared/orderup/skills.js)
  return S;
}

const item = (S, k, st, extra = {}) => { const it = { id: S.nextId++, k, st, q: [], done: -1, ...extra }; S.items[it.id] = it; return it.id; };
const drop = (S, id) => { delete S.items[id]; };
const win = S => 1 + 0.06 * S.skill;   // (a skilled cook's perfect window is wider)

/** The score of a step that cooked by itself, taken off after t seconds on its station. */
export function stepScore(a, t, skill = 0, extra = 0) {   // (extra: a cook's skill at that station, shared/orderup/skills.js)
  const per = a.perfect * (1 + 0.06 * skill + extra);
  if (t < a.cook) return 0;
  if (t <= a.cook + per) return 100;
  if (t >= a.burn) return 25;
  return Math.round(100 - 60 * (t - a.cook - per) / Math.max(0.1, a.burn - a.cook - per));
}

const is = (x, [k, st]) => x.k === k && (st == null || (Array.isArray(st) ? st.includes(x.st) : x.st === st));
/** What two things make put together (either way round), or null: the kitchen's combos, in order. */
function together(S, a, b) {
  const A = S.items[a], B = S.items[b], K = S.K;
  if (!A || !B) return null;
  for (const [x, y] of [[A, B], [B, A]]) for (const c of K.combos) {
    if (c.onWare) {   // (a food onto clean ware: a croissant onto a plate)
      const w = K.ware[x.k];
      if (w?.on && x.st === w.clean && !x.on && K.onWare[y.k]?.includes(y.st) && K.served[x.k]?.[y.k]) return { keep: x, gone: y, on: y.k, burnt: y.st !== K.onWare[y.k][0], q: [...y.q] };
      continue;
    }
    if (c.onto) {   // (onto the food on ware: the curry over a bowl of rice, the fish onto a plate of it)
      if (x.k === c.onto[0] && x.on === c.onto[1] && is(y, c.b)) return { keep: x, gone: y, on: c.on, burnt: y.st === 'burnt', q: c.q === 'b' ? [...y.q] : [] };
      continue;
    }
    if (!is(x, c.a) || !is(y, c.b)) continue;
    const r = { keep: x, gone: y, q: c.q === 'both' ? [...x.q, ...y.q] : c.q === 'a' ? [...x.q] : c.q === 'b' ? [...y.q] : [] };
    if (c.k) r.k = c.k;
    if (c.st) r.st = c.st;
    if (c.art != null) r.art = Math.min(...x.q) >= c.art && Math.min(...y.q) >= c.art;
    return r;
  }
  return null;
}
function combine(S, r) {
  const it = r.keep;
  if (r.k) it.k = r.k;
  if (r.st) it.st = r.st;
  if (r.on) { it.on = r.on; it.onSt = S.items[r.gone.id].st; }
  if (r.art) it.art = true;
  if (r.burnt) it.burnt = true;
  it.q = r.q; it.done = S.t;
  drop(S, r.gone.id);
  return it.id;
}
/** The dish an item is, ready to serve, or null. */
export const dishOf = (it, K = K0) => it && (K.served[it.k]?.[K.ware[it.k]?.on ? it.on : it.st] || null);
const PLAIN = new Set(['plain', 'fresh', 'clean', 'empty', 'whole']);
/** What an item is called (the kitchen's own words, K.say, else its state and kind): "steamed milk", "pancakes on a plate". */
export function itemName(it, K = K0) {
  const say = K.say || {}, kind = k => say[k] || k;
  if (it.on) return `${say[`${it.on}:${it.onSt}`] || kind(it.on)} on a ${kind(it.k)}`;
  return say[`${it.k}:${it.st}`] || `${it.st && !PLAIN.has(it.st) ? it.st + ' ' : ''}${kind(it.k)}`;
}
/** The entry of chopping station w that works item it (its own, or one of its `chops`), or null. */
export function chopEntry(w, it) {
  for (const e of [w, ...(w.chops || [])]) if (e.k != null && chopsOf(e).includes(it.k) && it.st === (e.from ?? w.from)) return e;
  return null;
}
/** What pouring station d pours into (its `into`: kinds for all it gives, or per thing given). */
export const intoOf = (d, what) => [].concat(d.into && !Array.isArray(d.into) && typeof d.into === 'object' ? d.into[what] || [] : d.into || []);
/** The kind (or kinds) a chopping station chops, or a cooking station takes. */
export const chopsOf = w => [].concat(w?.k ?? []);
export const takesOf = chopsOf;

/** The grade of a served item, now. */
export function scoreOf(S, it, p = null) {   // (p: the cook serving it: their Service keeps it longer)
  const dish = dishOf(it, S.K), d = S.K.dishes[dish];
  let s = it.q.length ? it.q.reduce((a, b) => a + b, 0) / it.q.length : 100;
  if (it.q.some(x => x <= 25)) s = Math.min(s, 35);   // (anything burnt, bitter or scalded in it: Bad at best)
  const age = (S.t - (it.done >= 0 ? it.done : S.t)) / (1 + serviceOf(p && S.players[p]?.skills).fresh);
  s -= d.hot ? Math.max(0, age - 8) * 3 : d.food ? Math.max(0, age - 12) * 1.5 : Math.max(0, age - 20);
  if (it.art) s += 5;
  return Math.max(0, Math.min(100, Math.round(s)));
}

/** An item leaving a station that cooks by itself: its step scored by how long it was on. */
function offStation(S, st) {
  const a = cookOf(S, st), it = S.items[st.slot];
  if (a && it && st.prog >= a.cook) { it.q = [...it.q, stepScore(a, st.prog, S.skill, bonusAt(S.players[st.by]?.skills, st.t).window)]; it.done = S.t; }   // (the skill of the cook who put it in)
  st.prog = 0;
}
const cookOf = (S, st) => { const d = sdef(S, st); return d.role !== 'cook' ? null : st.ci > 0 && d.cooks?.[st.ci - 1] ? { ...d, ...d.cooks[st.ci - 1] } : d; };
/** The entry of cooking station d that takes item it (its own: 0; else 1 + its index in d.cooks), or -1. */
function entryFor(d, it) {
  if (d.k != null && takesOf(d).includes(it.k) && it.st === d.from) return 0;
  const n = (d.cooks || []).findIndex(e => takesOf(e).includes(it.k) && it.st === (e.from ?? d.from));
  return n < 0 ? -1 : n + 1;
}
/** What a loaded station makes of what is loaded in it (the juicer: an orange, a lemon, an apple), else its own. */
const loadedTo = (a, st) => (a.loads && st.loaded ? a.loads[st.loaded] : null) || a.to;
const needsLoad = a => !!(a.loaded || a.loads);
const giveOf = (S, st) => {   // (in a Rush only what its menu uses; all it has when its menu uses none of them)
  const d = sdef(S, st); if (d.role !== 'give' && d.role !== 'pour') return null;
  const some = S.uses ? d.gives.filter(k => S.uses.includes(k)) : d.gives;
  return some.length ? some : d.gives;
};
/** The kinds of ware the plating counter offers in this Rush (those its menu is served in; all when none). */
const waresOf = S => { const all = Object.keys(S.K.ware), some = S.wares ? all.filter(k => S.wares.includes(k)) : all; return some.length ? some : all; };
/** The ware food item h goes on at plating counter st (a plate, a bowl: the one it is served on there is one of), or null:
 *  only for a dish an order waits for (else it is set down there, as on any counter). */
export const plateFor = (S, st, h) => (h && st.slot == null && S.K.onWare[h.k]?.includes(h.st)
  ? waresOf(S).find(w => S.K.served[w]?.[h.k] && st[S.K.ware[w].stack] > 0 && S.tickets.some(t => t.dish === S.K.served[w][h.k])) || null : null);
/** What item h makes poured into clean ware at plating counter st (the pearls into a glass for bubble tea; steamed chocolate
 *  milk into a cup, a hot chocolate an order waits for): { w: the ware, c: the combo }, or null. */
export function intoWare(S, st, h) {
  if (!h || st.slot != null || S.K.ware[h.k]) return null;
  for (const c of S.K.combos) {
    if (!c.a || c.k || !S.K.ware[c.a[0]] || !is(h, c.b)) continue;
    const w = c.a[0], W = S.K.ware[w]; if ([].concat(c.a[1]).join() !== W.clean || !(st[W.stack] > 0) || !waresOf(S).includes(w)) continue;
    const dish = S.K.served[w]?.[c.st]; if (dish && !S.tickets.some(t => t.dish === dish)) continue;
    return { w, c };
  }
  return null;
}
/** Whether cooking station d takes item it (its own kind, or one of its `cooks`). */
export const takesItem = (d, it) => entryFor(d, it) >= 0;
/** What a dispenser gives (or a pouring station pours) in this Rush, in turn, or null. */
export const givesAt = (S, sid) => (S.st[sid] ? giveOf(S, S.st[sid]) : null);
const workOf = (S, st) => { const d = sdef(S, st); return d.role === 'make' || d.role === 'chop' || d.role === 'sink' || (d.role === 'cook' && d.tend) ? d : null; };
const holdOf = (S, p) => S.players[p] || (S.players[p] = { id: p, hold: null });
const ev = (S, k, o = {}) => S.ev.push({ k, t: +S.t.toFixed(2), ...o });

/** What a dispenser gives (the fridge, the pantry, the plating counter's plates, cups and glasses: the page's picker shows these). */
export function choices(S, sid, p = null) {
  const st = S.st[sid]; if (!st) return [];
  const gives = giveOf(S, st), d = sdef(S, st), h = p && S.items[S.players[p]?.hold];
  if (gives && d.role === 'pour' && h) return gives.filter(g => intoOf(d, g).includes(h.k)).map(k => ({ k, left: Infinity }));   // (what pours into what is held)
  if (gives) return gives.map(k => ({ k, left: Infinity }));
  if (sdef(S, st).role === 'plating') return waresOf(S).map(k => ({ k, left: st[S.K.ware[k].stack] || 0 }));
  return [];
}
/** Interact (E): player p at station sid (o.pick: the thing wanted from a dispenser, chosen in the picker). Returns what happened ('take', 'give', 'put', 'mix', 'pour', 'serve',
 *  'bin', 'load', or null: nothing to do there). */
export function interact(S, p, sid, o = {}) {
  if (S.over) return null;
  const P = holdOf(S, p), st = S.st[sid]; if (!st) return null;
  const h = P.hold != null ? S.items[P.hold] : null, d = sdef(S, st), K = S.K, gives = giveOf(S, st), fresh = k => K.fresh[k];
  if (d.role === 'bin') { if (!h) return null; drop(S, P.hold); P.hold = null; ev(S, 'bin', { s: sid }); return 'bin'; }
  if (d.role === 'pass') return h ? serve(S, P, st, h) : null;
  if (d.role === 'pour') {   // (a clean glass held to it: filled with the one chosen, else the next in turn; food: onto it, a bowl of rice)
    if (!h || !gives?.length) return null;
    if (d.mix?.[h.k] && h.st === K.fresh[h.k]) { h.st = d.mix[h.k]; ev(S, 'poured', { s: sid, what: h.st }); return 'pour'; }   // (a scoop into a jug of milk: a shake to blend)
    const fits = gives.filter(g => intoOf(d, g).includes(h.k));
    if (!fits.length || h.st !== K.ware[h.k]?.clean || h.on) return null;
    if (o.pick && fits.includes(o.pick)) st.give = gives.indexOf(o.pick);
    let what = gives[st.give % gives.length]; if (!fits.includes(what)) { what = fits[0]; st.give = gives.indexOf(what); }
    if (d.food) { h.on = what; h.onSt = 'ready'; } else h.st = what;
    h.done = S.t; st.give = (st.give + 1) % gives.length; ev(S, 'poured', { s: sid, what });
    return 'pour';
  }
  if (!h) {
    if (st.slot != null) { offStation(S, st); P.hold = st.slot; st.slot = null; st.work = 0; return 'take'; }
    if (d.role === 'dishes' && st.dirty?.length) { P.hold = st.dirty.shift(); return 'take'; }
    if (gives) {
      const list = gives;
      if (o.pick && list.includes(o.pick)) st.give = list.indexOf(o.pick);   // (chosen in the picker)
      st.gaveAt = S.t; P.gave = sid;
      const k = list[st.give];
      P.hold = item(S, k, fresh(k));
      st.give = (st.give + 1) % list.length;   // (the next press without a choice: the next thing)
      return 'give';
    }
    if (d.role === 'plating') {   // (the kind picked, else the next one there is, in turn: of those this Rush uses)
      const kinds = waresOf(S); if (kinds.includes(o.pick)) st.give = kinds.indexOf(o.pick);
      let k = null; for (let n = 0; n < kinds.length && !k; n++) { const c = kinds[(st.give + n) % kinds.length]; if (st[K.ware[c].stack] > 0) k = c; }
      if (!k) return null;
      st[K.ware[k].stack]--; P.hold = item(S, k, K.ware[k].clean);
      st.give = (kinds.indexOf(k) + 1) % kinds.length; st.gaveAt = S.t; P.gave = sid; return 'give';
    }
    return null;
  }
  // a pressed-again swap at a dispenser: the one just taken goes back, the next comes
  if (gives && P.gave === sid && S.t - st.gaveAt < 1.5 && gives.includes(h.k) && !h.q.length) {
    drop(S, P.hold); P.hold = null; st.gaveAt = -9;
    const list = gives; if (o.pick && list.includes(o.pick)) st.give = list.indexOf(o.pick);
    const k = list[st.give]; st.give = (st.give + 1) % list.length;
    P.hold = item(S, k, fresh(k)); st.gaveAt = S.t;
    return 'give';
  }
  if (d.role === 'cook' && (d.loaded === h.k || (d.loads?.[h.k] && h.st === K.fresh[h.k]))) { if (st.loaded) return null; st.loaded = d.loads ? h.k : true; drop(S, P.hold); P.hold = null; ev(S, 'load', { s: sid }); return 'load'; }
  if (d.role === 'sink') { if (h.st !== 'dirty' || st.sink.length >= (d.holds ?? 4)) return null; st.sink.push(P.hold); P.hold = null; return 'put'; }
  if (d.role === 'plating' && K.ware[h.k] && h.st === K.ware[h.k].clean && !h.on && st.slot == null) {
    st[K.ware[h.k].stack]++; drop(S, P.hold); P.hold = null;   // (a clean one back on its stack)
    if (P.gave === sid && S.t - st.gaveAt < 1.5) {   // (just taken and pressed again: swapped for the next kind there is)
      const kinds = waresOf(S); if (!kinds.includes(h.k)) return 'put';
      for (let n = 1; n < kinds.length; n++) { const c = kinds[(kinds.indexOf(h.k) + n) % kinds.length]; if (st[K.ware[c].stack] > 0) { st[K.ware[c].stack]--; P.hold = item(S, c, K.ware[c].clean); st.gaveAt = S.t; st.give = (kinds.indexOf(c) + 1) % kinds.length; return 'give'; } }
    }
    return 'put';
  }
  if (st.slot != null) {   // put together with what is there
    let r = together(S, P.hold, st.slot); if (!r) return null;
    if (d.role === 'cook') { offStation(S, st); r = together(S, P.hold, st.slot); }   // (scored as it comes off, then put together)
    const held = r.keep.id === P.hold && !!K.ware[r.keep.k], id = combine(S, r);   // (a plate or a glass in hand: the food onto it, the drink into it, kept in hand)
    if (d.role === 'cook' || held) { P.hold = id; st.slot = null; } else { st.slot = id; P.hold = null; }
    if (S.items[id].art) ev(S, 'art', { s: sid });
    return 'mix';
  }
  if (d.role === 'cook') { const n = entryFor(d, h); if (n < 0) return null; st.slot = P.hold; P.hold = null; st.prog = 0; st.ci = n; st.by = p; return 'put'; }
  const w = d.role === 'plating' && plateFor(S, st, h);
  if (w) {   // (food that goes on a plate or in a bowl, brought to the plating counter: onto one from its stack, in hand)
    st[K.ware[w].stack]--; const id = item(S, w, K.ware[w].clean);
    P.hold = combine(S, { keep: S.items[id], gone: h, on: h.k, burnt: h.st !== K.onWare[h.k][0], q: [...h.q] }); return 'mix';
  }
  const iw = d.role === 'plating' && intoWare(S, st, h);
  if (iw) {   // (and what goes into a cup or glass to be made: into one from its stack, in hand)
    st[K.ware[iw.w].stack]--; const id = item(S, iw.w, K.ware[iw.w].clean), c = iw.c;
    P.hold = combine(S, { keep: S.items[id], gone: h, st: c.st, q: c.q === 'b' || c.q === 'both' ? [...h.q] : [] }); return 'mix';
  }
  if (d.counter) { st.slot = P.hold; P.hold = null; st.work = 0; return 'put'; }
  return null;
}

function serve(S, P, st, h) {
  const dish = dishOf(h, S.K); if (!dish) return null;
  const k = S.tickets.findIndex(t => t.dish === dish); if (k < 0) { ev(S, 'nobody', { dish }); return null; }
  const tk = S.tickets.splice(k, 1)[0], score = scoreOf(S, h, P.id), grade = gradeOf(score), d = S.K.dishes[dish];
  const tip = +(d.price * ({ Poor: 0, Bad: 0, Medium: 0.05, Good: 0.12, Great: 0.2, Supreme: 0.3 }[grade]) * (S.t <= tk.until - (tk.until - tk.at) / 2 ? 1.25 : 1) * serviceOf(P.skills).tips).toFixed(2);
  const paid = grade === 'Poor' ? 0 : d.price;
  S.money = +(S.money + paid).toFixed(2); S.tips = +(S.tips + tip).toFixed(2); S.points += score;
  S.score += S.strict && score < 75 ? 0 : Math.round(score * d.price / 10);   // (the Rush's score: each dish's grade x its price; a critic counts Good or better only)
  S.served.push({ dish, item: tk.item || dish, score, grade, tip, paid, t: +S.t.toFixed(1), art: !!h.art });
  ev(S, 'served', { dish, score, grade, tip, s: st.id, ticket: tk.id });
  if (S.K.ware[h.k] && !S.K.ware[h.k].disposable) S.returns.push({ at: S.t + 8, k: h.k });   // (plates, cups and glasses come back to be washed; a burger's wrap, a cup to go don't)
  drop(S, P.hold); P.hold = null;
  return 'serve';
}

/** Work (held): player p at station sid for dt seconds. True while there is work being done there. */
export function work(S, p, sid, dt) {
  if (S.over) return false;
  const P = holdOf(S, p), st = S.st[sid], w = st && workOf(S, st); if (!w || P.hold != null) return false;
  const speed = (1 + 0.05 * S.skill) * (1 + bonusAt(P.skills, st.t).speed);   // (the cook's skill at it: quicker)
  if (w.role === 'make') {
    if (st.slot != null) return false;
    st.work += dt * speed; if (st.work >= w.s) { st.work = 0; st.slot = item(S, w.makes, w.st); ev(S, 'ground', { s: sid }); }
    return true;
  }
  if (w.role === 'chop') {   // (its own: chopped; its `chops`: what else is prepared there, a salad tossed, a cocktail of shrimp)
    const it = S.items[st.slot], e = it && chopEntry(w, it); if (!e) return false;
    st.work += dt * speed; if (st.work >= (e.s ?? w.s)) { st.work = 0; it.st = e.to ?? w.to; ev(S, 'chopped', { s: sid }); }
    return true;
  }
  if (w.role === 'cook') {   // (a station cooked only while tended: the wok, tossed; what is on it cooks this step)
    if (st.slot == null) return false;
    st.tended = true; return true;
  }
  if (w.role === 'sink') {
    if (!st.sink.length) return false;
    st.work += dt * speed;
    if (st.work >= w.s) {
      st.work = 0; const it = S.items[st.sink.shift()]; drop(S, it.id);
      const pl = findRole(S, 'plating'); if (pl) pl[stackOf(S, it.k)]++;
      ev(S, 'washed', { s: sid, item: it.k });
    }
    return true;
  }
  return false;
}

/** The kitchen's time goes on by dt: cooking, tickets coming and going, dishes coming back. */
export function step(S, dt) {
  if (S.over) return;
  S.t += dt;
  for (const st of Object.values(S.st)) {
    const a = cookOf(S, st); if (!a || st.slot == null) continue;
    if (needsLoad(a) && !st.loaded && st.prog < a.cook) continue;   // (no grounds in it: no shot)
    if (a.tend) { if (!st.tended) continue; st.tended = false; }   // (the wok: only while someone tosses it)
    const it = S.items[st.slot], was = st.prog; st.prog += dt;
    if (was < a.cook && st.prog >= a.cook) { it.st = st.ci > 0 ? a.to : loadedTo(a, st); if (needsLoad(a)) st.loaded = false; ev(S, 'cooked', { s: st.id }); }   // (the shot pulled: the grounds used)
    if (was < a.burn && st.prog >= a.burn) { it.st = a.over; S.burns++; ev(S, 'burnt', { s: st.id }); }
  }
  // tickets: sooner as the Rush goes on, at most 4 open
  if (S.t >= S.nextTicket && S.t < S.dur - 15 && S.tickets.length < 4 && S.menu.length) {
    const dish = S.rng.pick(S.menu), d = S.K.dishes[dish], pat = (d.food ? 110 : 90) * (S.patience ?? 1), its = S.sells?.[dish] || [dish];
    const item = its.length > 1 ? S.rng.pick(its) : its[0];   // (which of its menu items: a cappuccino, a mojito)
    S.tickets.push({ id: ++S.nTicket, dish, item, at: +S.t.toFixed(2), until: +(S.t + pat).toFixed(2) });
    ev(S, 'ticket', { dish });
    S.nextTicket = S.t + (20 - 11 * Math.min(1, S.t / S.dur)) * (S.pace ?? 1) + S.rng.float(-2, 2);   // (every 20 s at first, every 9 by the end; a Rush level's pace)
  }
  for (let k = S.tickets.length - 1; k >= 0; k--) if (S.t > S.tickets[k].until) { const tk = S.tickets.splice(k, 1)[0]; S.lost++; ev(S, 'lost', { dish: tk.dish, ticket: tk.id }); }
  for (let k = S.returns.length - 1; k >= 0; k--) if (S.t >= S.returns[k].at) {
    const r = S.returns.splice(k, 1)[0], dr = findRole(S, 'dishes');
    if (dr) (dr.dirty || (dr.dirty = [])).push(item(S, r.k, 'dirty'));
    else { const pl = findRole(S, 'plating'); if (pl) pl[stackOf(S, r.k)]++; }
  }
  if (S.t >= S.dur) { S.over = true; ev(S, 'over', { stars: starsOf(S) }); }
}

/** Stars: the points served out of what every order that came could have been (lost and still open count as nothing),
 *  3 for 85 % (and at least 5 served in 3 minutes), 2 for 60 %, 1 for 30 %. */
export function starsOf(S) {
  const r = S.points / (100 * Math.max(1, S.served.length + S.lost + S.tickets.length)), busy = S.served.length >= 5 * S.dur / 180;
  return r >= 0.85 && busy ? 3 : r >= 0.6 ? 2 : r >= 0.3 ? 1 : 0;
}

/** What a station is doing for the page: its progress 0-1 to done, then to burnt; 'warn' as it goes over. */
export function stationView(S, sid) {
  const st = S.st[sid], a = cookOf(S, st), w = workOf(S, st);
  if (a && st.slot != null && (!needsLoad(a) || st.loaded || st.prog >= a.cook)) {
    const p = st.prog;
    return { cook: Math.min(1, p / a.cook), over: p > a.cook + a.perfect * win(S) ? Math.min(1, (p - a.cook) / (a.burn - a.cook)) : 0, burnt: p >= a.burn };
  }
  if (w && st.work > 0) return { cook: Math.min(1, st.work / w.s), over: 0, burnt: false };
  return null;
}
