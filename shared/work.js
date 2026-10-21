// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Work modules (docs/features/WORK-MODULES.md; ECONOMY.md §8; spec 03 §2–4): the roles a player or an agent can work
// at a venue, each a MODULE registered here — what one order of the job is (made deterministically from a seed), what
// the worker reports for it (raw inputs only) and how it is scored (a rubric: weights, star thresholds, tips). The
// economy's core (server/economy/jobs.js) owns everything around a module: who may work where, the venue's tickets from
// real customers, the pace a person can work at, pay, tax, experience, reputation and reviews, all committed together.
// A new mini-game (a restaurant's kitchen, a cinema's box office, a gym's class) is a new module: registerModule() here
// and, if it needs its own screen, a browser game registered with app.work.registerGame() — no change to the economy.
//
// Shared by the browser (which draws and plays the steps) and the server (which makes the orders and scores the
// reports): the server never trusts a score from the browser and clamps raw inputs to what a person can do.
// Everything here is deterministic from the seed.
import { RNG } from './rng.js';
import { FOOD_BY_ID } from './food.js';

// ------------------------------------------------------------------------------------------- skill primitives
/** The needle of a timing bar: position 0..1 at time t ms (a triangle wave with the step's period and phase). */
export function needleAt(step, t) {
  const p = step.period, x = ((t + step.phase * p) % (2 * p) + 2 * p) % (2 * p) / p;
  return x <= 1 ? x : 2 - x;
}
/** A hold meter's level after holding ms (0..1.2: it overfills). */
export const meterAt = (step, ms) => Math.min(1.2, Math.max(0, ms) / step.fill);

/**
 * The skill primitives an order is made of (spec 03 §2): make(rng, label, options) builds a step, score(step, report)
 * grades the worker's raw report 0..1. A primitive is shared by every module; a new one is a platform decision.
 */
export const PRIMITIVES = Object.freeze({
  timing: {
    make: (r, label, o = {}) => ({ kind: 'timing', label, period: r.int(o.period?.[0] ?? 900, o.period?.[1] ?? 1500), phase: r.float(0, 2), target: r.float(o.lo ?? 0.35, o.hi ?? 0.75), band: o.band ?? 0.11, hint: o.hint || '' }),
    score(step, rep) {
      const t = Number(rep.t); if (!Number.isFinite(t) || t < 120 || t > 60000) return 0;   // faster than a person can react: nothing
      const d = Math.abs(needleAt(step, t) - step.target);
      return d <= step.band ? 1 - 0.5 * d / step.band : Math.max(0, 0.5 - (d - step.band) * 2);
    },
  },
  meter: {
    make: (r, label, o = {}) => ({ kind: 'meter', label, fill: r.int(o.fill?.[0] ?? 1600, o.fill?.[1] ?? 2600), target: r.float(o.lo ?? 0.62, o.hi ?? 0.82), band: o.band ?? 0.08, hint: o.hint || '' }),
    score(step, rep) {
      const ms = Number(rep.ms); if (!Number.isFinite(ms) || ms < 100 || ms > 60000) return 0;
      const d = Math.abs(meterAt(step, ms) - step.target);
      return d <= step.band ? 1 - 0.5 * d / step.band : Math.max(0, 0.5 - (d - step.band) * 2);
    },
  },
  choice: {
    make: (r, label, o = {}) => { const opts = r.shuffle([...o.options]); return { kind: 'choice', label, options: opts, answer: opts.indexOf(o.correct), memo: o.memo || null, hint: o.hint || '' }; },
    score: (step, rep) => (Number(rep.pick) === step.answer ? 1 : 0),
    secret: ['answer'],   // kept by the server; the browser never sees it
  },
  sequence: {
    make: (r, label, o = {}) => ({ kind: 'sequence', label, items: o.items, order: o.order, hint: o.hint || '' }),
    score(step, rep) {
      const p = Array.isArray(rep.picks) ? rep.picks.map(Number) : [];
      if (p.length !== step.order.length) return 0;
      let ok = 0;
      for (let k = 0; k < p.length; k++) if (p[k] === step.order[k]) ok++;
      return ok / p.length;
    },
  },
});
/** One step of an order from the order's own random numbers. */
const step = (r, kind, label, o) => { const P = PRIMITIVES[kind]; if (!P) throw new Error(`unknown step kind ${kind}`); return P.make(r, label, o); };

// ------------------------------------------------------------------------------------------- the registry
const MODULES = new Map();
/** The default rubric (spec 03 §3.1): quality from the steps, speed against the expected time, stars and the tip. */
export const DEFAULT_RUBRIC = Object.freeze({ quality: 0.8, speed: 0.2, stars: Object.freeze([0.5, 0.62, 0.74, 0.86]), tip: Object.freeze({ five: 1, four: 0.5 }) });
const ID = /^[a-z][a-z0-9_]{1,23}$/;

/**
 * Registers a work module (a role). def:
 *   id        the role's id (also its key in wages unless `wage` says otherwise)
 *   version   bumps when its orders or scoring change (recorded with each shift)
 *   label, icon, unit, units   how people see it ("Barista", "☕", "drink", "drinks")
 *   venues    the venue kinds it works at by default (the policy's jobs.roles may change that)
 *   wage      the policy wage role it is paid at (default: id)
 *   stage     where it acts on a venue's tickets, lower first (a restaurant: the kitchen cooks, then the floor serves)
 *   ui        the browser's game: 'steps' (the shared step panel) or the name of a game the browser registers
 *   rubric    { quality, speed, stars: [2★, 3★, 4★, 5★ thresholds], tip: { five, four } } (DEFAULT_RUBRIC's shape)
 *   makeOrder(r, { customer, item }) → { title, item, steps, expectMs }: one order from the seeded RNG r
 *   minMs(order)   the least time a person needs for the order (default: 900 ms a step, at least 2.5 s)
 *   score(order, reports, tookMs) → { quality, speed } (default: the steps' mean, and time against expectMs)
 */
export function registerModule(def) {
  if (!def || !ID.test(def.id || '')) throw new Error('a work module needs an id (lowercase letters, digits, _)');
  if (!Number.isSafeInteger(def.version) || def.version < 1) throw new Error(`${def.id}: version is a whole number from 1`);
  for (const k of ['label', 'icon', 'unit', 'units']) if (typeof def[k] !== 'string' || !def[k]) throw new Error(`${def.id}: ${k} is required`);
  if (!Array.isArray(def.venues) || def.venues.some(v => !ID.test(v))) throw new Error(`${def.id}: venues is a list of venue kinds`);
  if (typeof def.makeOrder !== 'function') throw new Error(`${def.id}: makeOrder(r, ctx) is required`);
  const rubric = { ...DEFAULT_RUBRIC, ...(def.rubric || {}) };
  if (!(rubric.quality >= 0 && rubric.speed >= 0 && Math.abs(rubric.quality + rubric.speed - 1) < 1e-9)) throw new Error(`${def.id}: rubric quality + speed must be 1`);
  if (!Array.isArray(rubric.stars) || rubric.stars.length !== 4 || rubric.stars.some((t, k) => !(t > 0 && t <= 1) || (k && t <= rubric.stars[k - 1]))) throw new Error(`${def.id}: rubric.stars is four rising thresholds`);
  const m = Object.freeze({ wage: def.id, stage: 50, ui: 'steps', minMs: o => Math.max(2500, o.steps.length * 900), ...def, rubric: Object.freeze(rubric) });
  MODULES.set(m.id, m);
  rebuild();
  return m;
}
export const moduleOf = id => MODULES.get(id) || null;
export const modules = () => [...MODULES.values()];

/** The roles by id as pages and the core read them (label, icon, venue, game, unit, units, wage, stage, version). */
export const ROLES = {};
/** The default roles at each kind of venue, in ticket order (the policy's jobs.roles overrides per installation). */
export const ROLES_AT = {};
function rebuild() {
  for (const k of Object.keys(ROLES)) delete ROLES[k];
  for (const k of Object.keys(ROLES_AT)) delete ROLES_AT[k];
  for (const m of [...MODULES.values()].sort((a, b) => a.stage - b.stage || a.id.localeCompare(b.id))) {
    ROLES[m.id] = { label: m.label, icon: m.icon, venue: m.venues[0], game: m.ui === 'steps' ? m.game || m.id : m.ui, ui: m.ui, unit: m.unit, units: m.units, wage: m.wage, stage: m.stage, version: m.version };
    for (const v of m.venues) (ROLES_AT[v] ||= []).push(m.id);
  }
}

// ------------------------------------------------------------------------------------------- orders and scoring
/**
 * The next order for a role: deterministic from (seed, n). item: what the customer bought (a menu id), customer: who
 * (a first name). Returns { n, title, customer, item, steps, expectMs, module, version }.
 */
export function makeOrder(role, seed, n, { item = null, customer = null } = {}) {
  const m = MODULES.get(role); if (!m) throw new Error('unknown role');
  const r = new RNG(`${seed}:${n}`), who = customer || r.pick(FIRST);
  const o = m.makeOrder(r, { customer: who, item });
  return { n, customer: who, ...o, module: m.id, version: m.version };
}
/** Strips an order of what only the server keeps (a choice's answer), for the browser. */
export function publicOrder(o) {
  return { ...o, steps: o.steps.map(s => { const sec = PRIMITIVES[s.kind]?.secret; if (!sec) return s; const c = { ...s }; for (const k of sec) c[k] = undefined; return c; }) };
}
/** Scores the raw report for one step (0..1). */
export function scoreStep(st, rep) {
  if (!rep || typeof rep !== 'object') return 0;
  const P = PRIMITIVES[st.kind];
  return P ? P.score(st, rep) : 0;
}
/**
 * An order's result: quality (0..1), speed (0..1 against the expected time; a slow order still counts), the rubric's
 * score and stars (1..5), and the tip the customer leaves (hundredths of a VC, up to tipMax at 5★).
 */
export function scoreOrder(order, reports, tookMs, { tipMax = 250 } = {}) {
  const m = MODULES.get(order.module) || null, rb = m?.rubric || DEFAULT_RUBRIC;
  const q = order.steps.map((s, k) => scoreStep(s, reports?.[k]));
  const took = Math.max(0, Number(tookMs) || 0);
  let quality = q.reduce((a, b) => a + b, 0) / Math.max(1, q.length);
  let speed = took <= order.expectMs ? 1 : Math.max(0, 1 - (took - order.expectMs) / (order.expectMs * 2));
  if (m?.score) { const s = m.score(order, reports, took) || {}; if (Number.isFinite(s.quality)) quality = s.quality; if (Number.isFinite(s.speed)) speed = s.speed; }
  quality = Math.max(0, Math.min(1, quality)); speed = Math.max(0, Math.min(1, speed));
  const score = quality * rb.quality + speed * rb.speed, [t2, t3, t4, t5] = rb.stars;
  const stars = score >= t5 ? 5 : score >= t4 ? 4 : score >= t3 ? 3 : score >= t2 ? 2 : 1;
  const tip = stars >= 4 ? Math.round(tipMax * (stars === 5 ? rb.tip.five : rb.tip.four) * (0.6 + 0.4 * speed)) : 0;
  return { steps: q.map(v => Math.round(v * 100) / 100), quality: Math.round(quality * 100) / 100, speed: Math.round(speed * 100) / 100, score: Math.round(score * 100) / 100, stars, tip };
}
/** The least time a person needs for an order (the core refuses anything faster). */
export const minMsOf = order => { const m = MODULES.get(order.module); return m ? m.minMs(order) : Math.max(2500, order.steps.length * 900); };
/** The pay multiplier for an average star rating over a session (0.6 at 1★ … 1.4 at 5★). */
export const starPay = avg => Math.max(0.6, Math.min(1.4, 0.6 + (avg - 1) * 0.2));
/** XP for an order: more for more stars; the first fifty a day count fully, then a quarter. */
export const orderXp = (stars, todayUnits) => (todayUnits < 50 ? 2 + stars : (2 + stars) / 4);
/** A role level from its XP: 1 at 0, 2 at 50, 3 at 200, 4 at 450 … (level² × 50 / 4 apart). */
export const levelOf = xp => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 50));

// ------------------------------------------------------------------------------------------- the built-in modules
const FIRST = ['Ava', 'Ben', 'Chloe', 'Dan', 'Ella', 'Finn', 'Grace', 'Hugo', 'Isla', 'Jack', 'Kai', 'Lena', 'Max', 'Nora', 'Omar', 'Pia', 'Ravi', 'Sara', 'Theo', 'Uma'];
// a drink or a dish from the menus (shared/food.js) when the order names one; the modules' own lists otherwise
const MILKY = /latte|cappuccino|flat_white|mocha|macchiato|chocolate|chai|matcha|frappe|shake|horchata|lassi/;
const foodDrink = id => { const it = FOOD_BY_ID[id]; return it && it.course === 'drink' ? { name: it.name, milk: MILKY.test(id) } : null; };
const foodDish = id => { const it = FOOD_BY_ID[id]; return it && it.course !== 'drink' ? it.name : null; };
const DRINKS = {
  coffee: { name: 'Americano', milk: false }, espresso: { name: 'Espresso', milk: false }, latte: { name: 'Latte', milk: true }, cappuccino: { name: 'Cappuccino', milk: true }, mocha: { name: 'Mocha', milk: true },
};
const DISHES = ['Pasta al pomodoro', 'Grilled salmon', 'Mushroom risotto', 'Chicken curry', 'Steak frites', 'Veggie burger', 'Tomato soup', 'Fish tacos'];
const SIDES = ['fries', 'salad', 'rice', 'bread', 'greens', 'mash'];
const GROCERIES = ['🥖', '🧀', '🍎', '🥛', '🥚', '🍅', '🥕', '🍌', '🧃', '🍫'];
const EXERCISES = ['Squat', 'Lunge', 'Plank', 'Push-up', 'Burpee', 'Jumping jack'];

// the café counter: size, the shot, the milk, the pour
registerModule({ id: 'barista', version: 1, label: 'Barista', icon: '☕', unit: 'drink', units: 'drinks', venues: ['cafe'], stage: 10, game: 'barista',
  makeOrder(r, { customer: who, item }) {
    const own = item && !DRINKS[item] ? foodDrink(item) : null;
    const key = own ? item : item && DRINKS[item] ? item : r.pick(Object.keys(DRINKS)), d = own || DRINKS[key];
    const size = r.pick(['small', 'medium', 'large']);
    const steps = [
      step(r, 'choice', 'Cup size', { options: ['small', 'medium', 'large'], correct: size, memo: `${who}: a ${size} ${d.name.toLowerCase()}`, hint: 'The size they asked for' }),
      step(r, 'timing', 'Pull the shot', { hint: 'Stop the needle in the green: 25 to 30 seconds' }),
    ];
    if (d.milk) steps.push(step(r, 'meter', 'Steam the milk', { hint: 'Hold until 60–65 °C, then let go' }));
    steps.push(step(r, 'timing', d.milk ? 'Pour the art' : 'Serve', { period: [700, 1100], band: 0.14, hint: 'Stop in the green' }));
    return { title: `${size[0].toUpperCase()}${size.slice(1)} ${d.name}`, item: key, steps, expectMs: 9000 + steps.length * 2500 };
  } });
// the restaurant's kitchen: prep, cook, plate (cooks first: the floor serves what the kitchen sends)
registerModule({ id: 'chef', version: 1, label: 'Chef', icon: '🧑‍🍳', unit: 'dish', units: 'dishes', venues: ['restaurant'], stage: 20, game: 'kitchen',
  makeOrder(r, { item }) {
    const dish = foodDish(item) || r.pick(DISHES), side = r.pick(SIDES), prep = r.shuffle([...SIDES]).slice(0, 3);
    if (!prep.includes(side)) prep[r.int(0, 2)] = side;
    const order = r.shuffle([0, 1, 2]);
    return { title: `${dish} with ${side}`, item: item || 'meal', expectMs: 16000, steps: [
      step(r, 'sequence', 'Prep the station', { items: prep, order, hint: 'Tap them in the order shown' }),
      step(r, 'timing', 'Cook it', { period: [1100, 1700], lo: 0.55, hi: 0.8, band: 0.1, hint: 'Take it off the heat in the green — not raw, not burnt' }),
      step(r, 'choice', 'Plate it', { options: SIDES.slice(0, 4).includes(side) ? SIDES.slice(0, 4) : [side, ...SIDES.slice(0, 3)], correct: side, memo: `The ticket: ${dish} with ${side}`, hint: 'The side on the ticket' }),
    ] };
  } });
// the restaurant's floor: take the order, the right table, carry it steady
registerModule({ id: 'server', version: 1, label: 'Server', icon: '🍽️', unit: 'table', units: 'tables', venues: ['restaurant'], stage: 30, game: 'floor',
  makeOrder(r, { customer: who, item }) {
    const table = r.int(1, 8), dish = foodDish(item) || r.pick(DISHES), wrong = r.shuffle(DISHES.filter(x => x !== dish)).slice(0, 2);
    return { title: `Table ${table}`, item: item || 'meal', expectMs: 14000, steps: [
      step(r, 'choice', 'Take the order', { options: [dish, ...wrong], correct: dish, memo: `${who} at table ${table}: “The ${dish.toLowerCase()}, please.”`, hint: 'What did they order?' }),
      step(r, 'choice', 'Bring it to the table', { options: ['1', '2', '3', '4', '5', '6', '7', '8'], correct: String(table), hint: 'Which table was it?' }),
      step(r, 'meter', 'Carry it steady', { fill: [1400, 2000], lo: 0.55, hi: 0.8, band: 0.12, hint: 'Hold to walk, let go at the table' }),
    ] };
  } });
// the shop's till: scan in order, bag or no bag
registerModule({ id: 'cashier', version: 1, label: 'Cashier', icon: '🛒', unit: 'customer', units: 'customers', venues: ['shop'], stage: 10, game: 'till',
  makeOrder(r, { customer: who, item }) {
    const basket = r.shuffle([...GROCERIES]).slice(0, 4), order = r.shuffle([0, 1, 2, 3]);
    return { title: `${who}'s basket`, item: item || 'groceries', expectMs: 10000, steps: [
      step(r, 'sequence', 'Scan the items', { items: basket, order, hint: 'Scan them in the order shown' }),
      step(r, 'choice', 'Bag or no bag?', { options: ['Bag', 'No bag'], correct: r.chance(0.6) ? 'Bag' : 'No bag', memo: `${who}: “${r.chance(0.5) ? 'A bag, please' : 'I brought my own'}.”`, hint: 'What did they say?' }),
    ] };
  } });
// the gym's coach: plan the circuit, count the rep
registerModule({ id: 'trainer', version: 1, label: 'Trainer', icon: '🏋️', unit: 'session', units: 'sessions', venues: ['gym'], stage: 10, game: 'coach',
  makeOrder(r, { customer: who, item }) {
    const moves = r.shuffle([...EXERCISES]).slice(0, 3), order = r.shuffle([0, 1, 2]);
    return { title: `${who}'s session`, item: item || 'session', expectMs: 12000, steps: [
      step(r, 'sequence', 'Plan the circuit', { items: moves, order, hint: 'In the order shown' }),
      step(r, 'timing', 'Count the rep', { period: [800, 1200], band: 0.12, hint: 'Clap in the green' }),
    ] };
  } });
