// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The economy's policy (docs/features/ECONOMY.md §3, §11): every wage, price, rent, tax, benefit, upkeep, endowment,
// rate and limit is data an administrator can change (Settings → Economy), validated here. Amounts are hundredths of a
// VC; rates are basis points (1/100 of a percent: 600 = 6%). Nothing here knows one installation.
import { LedgerError } from './ledger.js';
import { moduleOf } from '../../shared/work.js';
import { FOOD_BY_ID } from '../../shared/food.js';

/** The venues whose menus are food and drink (shared/food.js), set by each place. */
export const FOOD_VENUES = new Set(['cafe', 'restaurant']);

/** Commodities venues buy on the Global Market (§7): price per unit, how much it moves in a world hour, its label. */
const COMMODITIES = {
  coffee: { label: 'Coffee beans', icon: '☕', base: 120, vol: 300 },
  baked: { label: 'Baked goods', icon: '🥐', base: 120, vol: 250 },
  food: { label: 'Fresh food', icon: '🥬', base: 230, vol: 350 },
  drinks: { label: 'Drinks', icon: '🍷', base: 220, vol: 250 },
  groceries: { label: 'Groceries', icon: '🛒', base: 330, vol: 200 },
  retail: { label: 'Retail goods', icon: '👕', base: 600, vol: 300 },
  fitness: { label: 'Fitness supplies', icon: '🏋️', base: 160, vol: 200 },
  materials: { label: 'Building materials', icon: '🧱', base: 500, vol: 350 },
};
/** What each kind of venue sells: price (hundredths of a VC) and the commodities one unit uses. */
// (cafés and restaurants sell food and drink: each place's own menu from shared/food.js, at the city's usual prices - the
// items' own, times food.pricePct, or an administrator's price for one item in food.prices)
const MENUS = {
  shop: [
    { id: 'groceries', label: 'Groceries', icon: '🛒', price: 500, inputs: { groceries: 1 } },
    { id: 'goods', label: 'Shopping bag', icon: '🛍️', price: 1200, inputs: { retail: 1 } },
  ],
  gym: [
    { id: 'session', label: 'Gym session', icon: '🏋️', price: 600, inputs: { fitness: 1 } },
  ],
};
/** Who works where, by the residents' job (server/sim/population.js): the role and its wage per world hour. */
const WAGES = { office: 1300, vip: 1500, barista: 1100, chef: 1400, server: 1000, cashier: 1000, trainer: 1200, receptionist: 1100 };
const STAFF_ROLE = { cafe: 'barista', restaurant: 'chef', shop: 'cashier', gym: 'trainer', lobby: 'receptionist' };

export const POLICY_DEFAULTS = deepFreeze({
  version: 1,
  settleHour: 5,
  // starting money; a member's own agents get it for the first memberAgents only (an agent is free to make, its money isn't)
  endowment: { account: 50000, agent: 30000, resident: 12000, business: 150000, company: 600000, treasury: 5000000, memberAgents: 2 },
  minWage: 800,
  wages: WAGES,
  staffRole: STAFF_ROLE,
  menus: MENUS,
  food: { pricePct: 100, prices: {} },
  priceBounds: { minPct: 50, maxPct: 300 },
  commodities: COMMODITIES,
  rent: { studio: 1600, one: 2200, two: 3000, larger: 3800, landMinPct: 80, landMaxPct: 140 },
  taxes: {
    income: [{ upTo: 10000, bp: 400 }, { upTo: 20000, bp: 800 }, { upTo: 0, bp: 1200 }],   // brackets of a day's income; upTo 0: above
    sales: 600,
    exports: 800,
    venueProfit: 1000,
  },
  welfare: { pension: 5500, student: 4000, unemployed: 4500, allowance: 4000 },
  welfareOf: { Retired: 'pension', Student: 'student', 'Between jobs': 'unemployed', Newcomer: 'unemployed' },
  upkeep: { roadPerKm: 6000, park: 25000, station: 40000, buildingFloor: 300, perResident: 500 },
  publicWorks: { reserveDays: 30, pct: 10 },
  exports: { officePerHour: 1600, remotePerHour: 1100 },
  stabilizer: { enabled: true, targetBp: 100, stepBp: 100, minPct: 85, maxPct: 115 },
  households: { savingsTargetDays: 10, thriftyDays: 2, mealsPerBag: 2, excessSpendPct: 5, excessSpendCap: 8000, abroadPct: 40 },
  pricing: { auto: true, stepPct: 2, minPct: 70, maxPct: 160 },
  business: { workingCapitalDays: 5, cityDividend: true },
  fees: { worldFeeBp: 1000 },
  limits: { reauthAbove: 100000, transferMax: 10000000, transfersPerMin: 20, openRequests: 50, requestDays: 7, newAccountDays: 3, newAccountSendPerDay: 10000 },
  agents: { dailyCap: 10000, approveAbove: 5000, scopes: ['work', 'buy'], actionsPerMin: 30 },
  ordinances: {
    housingAssist: { on: true, label: 'Housing assistance', icon: '🏠', desc: 'The city pays the rent residents can\'t, up to half of it.', costPct: 50 },
    freeMetro: { on: false, label: 'Free metro', icon: '🚇', desc: 'No fares on the metro; the city pays the operator each day.', cost: 30000 },
    smallBusiness: { on: false, label: 'Small-business grants', icon: '🏪', desc: 'Businesses that lost money yesterday get help with wages.', cost: 0, capPerBiz: 20000 },
    tourism: { on: false, label: 'Tourism promotion', icon: '🧳', desc: 'Advertising the city abroad: more export demand.', cost: 60000, exportBoostBp: 500 },
  },
  loans: { cityRateBp: 150, cityMaxDebt: 50000000, termDays: 30 },
  // automatic shifts (spec 02 §9): a wage, never the best way to play - a share of the wage, capped a day, only in a role
  // the worker has played at that venue before; no tips, experience or reviews
  // roles: which work modules each kind of venue uses ({ cinema: ['usher'] }); empty: each module's own venues
  jobs: { tipMax: 100, autoPayPct: 30, autoDailyCap: 12000, autoNeedsPlayed: 5, tipsOfWagesPct: 60, roles: {} },
  // play modules' prizes (docs/features/play-modules.md): a finished run pays base × the course's difficulty × its stars,
  // a repeat without a new best a share of that, first-time stars and a new first place a bonus; at most dailyCap a day
  play: { on: true, base: 300, repeatPct: 40, firstStarPct: 100, recordPct: 150, dailyCap: 40000 },
  // the fish market (docs/features/fishing.md): a fishing trip's catch sold at a dock store pays pct % of its value, at
  // most dailyCap a day per angler
  fishMarket: { on: true, pct: 100, dailyCap: 150000 },
  // the published price index (spec 12): at least minSamples sales of an item a day to publish it, one venue at most
  // venueCapPct of an item's sample
  index: { minSamples: 20, venueCapPct: 10 },
  // a missed day settles on the next start; days the world wasn't running (no activity) are recorded as skipped
  settlement: { maxDaysPerTick: 5 },
  leases: { graceDays: 3 },
});

const ITEM_ID = /^[a-z][a-z0-9_]{1,23}$/;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
function deepFreeze(o) { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; }
const clone = o => JSON.parse(JSON.stringify(o));
const bad = msg => new LedgerError('input', msg, 400);

/** A whole number from lo to hi, or throws. */
function int(path, v, lo, hi) {
  if (!Number.isSafeInteger(v) || v < lo || v > hi) throw bad(`${path} must be a whole number from ${lo} to ${hi}.`);
  return v;
}
const VC = [0, 1e11];          // an amount
const BP = [0, 10000];         // a rate
const SCALAR = {
  settleHour: [0, 23],
  minWage: [0, 1e7],
  'endowment.account': VC, 'endowment.agent': VC, 'endowment.resident': VC, 'endowment.business': VC, 'endowment.company': VC, 'endowment.treasury': VC, 'endowment.memberAgents': [0, 1000],
  'food.pricePct': [10, 1000],
  'priceBounds.minPct': [10, 100], 'priceBounds.maxPct': [100, 1000],
  'rent.studio': VC, 'rent.one': VC, 'rent.two': VC, 'rent.larger': VC, 'rent.landMinPct': [10, 100], 'rent.landMaxPct': [100, 500],
  'taxes.sales': [0, 5000], 'taxes.exports': [0, 5000], 'taxes.venueProfit': [0, 5000],
  'welfare.pension': VC, 'welfare.student': VC, 'welfare.unemployed': VC, 'welfare.allowance': VC,
  'upkeep.roadPerKm': VC, 'upkeep.park': VC, 'upkeep.station': VC, 'upkeep.buildingFloor': VC, 'upkeep.perResident': VC,
  'publicWorks.reserveDays': [0, 3650], 'publicWorks.pct': [0, 100],
  'pricing.stepPct': [0, 20], 'pricing.minPct': [10, 100], 'pricing.maxPct': [100, 1000],
  'exports.officePerHour': VC, 'exports.remotePerHour': VC,
  'stabilizer.targetBp': [-1000, 2000], 'stabilizer.stepBp': [0, 1000], 'stabilizer.minPct': [10, 100], 'stabilizer.maxPct': [100, 500],
  'households.savingsTargetDays': [1, 365], 'households.thriftyDays': [0, 60], 'households.mealsPerBag': [0, 10], 'households.excessSpendPct': [0, 100], 'households.excessSpendCap': VC, 'households.abroadPct': [0, 100],
  'business.workingCapitalDays': [0, 60],
  'fees.worldFeeBp': [0, 5000],
  'limits.reauthAbove': VC, 'limits.transferMax': VC, 'limits.transfersPerMin': [1, 600], 'limits.openRequests': [1, 1000], 'limits.requestDays': [1, 90], 'limits.newAccountDays': [0, 365], 'limits.newAccountSendPerDay': VC,
  'agents.dailyCap': VC, 'agents.approveAbove': VC, 'agents.actionsPerMin': [1, 600],
  'play.base': [0, 1e7], 'play.repeatPct': [0, 100], 'play.firstStarPct': [0, 1000], 'play.recordPct': [0, 1000], 'play.dailyCap': VC,
  'fishMarket.pct': [0, 300], 'fishMarket.dailyCap': VC,
  'loans.cityRateBp': [0, 5000], 'loans.cityMaxDebt': VC, 'loans.termDays': [1, 3650],
  'jobs.tipMax': [0, 100000], 'jobs.autoPayPct': [0, 100], 'jobs.autoDailyCap': VC, 'jobs.autoNeedsPlayed': [0, 1000], 'jobs.tipsOfWagesPct': [0, 500], 'leases.graceDays': [0, 60],
  'index.minSamples': [1, 100000], 'index.venueCapPct': [1, 100], 'settlement.maxDaysPerTick': [1, 365],
};
const FLAGS = ['stabilizer.enabled', 'business.cityDividend', 'pricing.auto', 'play.on', 'fishMarket.on'];
const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const set = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); let x = o; for (const k of ks) x = x[k]; x[last] = v; };

/** Checks a change of policy; returns the whole new policy or throws LedgerError('input'). */
export function checkPolicy(cur, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw bad('Send the policy values to change.');
  const p = clone(cur);
  for (const [path, [lo, hi]] of Object.entries(SCALAR)) { const v = get(patch, path); if (v !== undefined) set(p, path, int(path, v, lo, hi)); }
  for (const path of FLAGS) { const v = get(patch, path); if (v !== undefined) { if (typeof v !== 'boolean') throw bad(`${path} is true or false.`); set(p, path, v); } }
  if (patch.wages !== undefined) {
    if (!patch.wages || typeof patch.wages !== 'object') throw bad('wages is a list of roles.');
    for (const [role, v] of Object.entries(patch.wages)) { if (!ITEM_ID.test(role)) throw bad(`Bad role name ${clean(role, 30)}.`); p.wages[role] = int(`wages.${role}`, v, 0, 1e7); }
  }
  if (patch.taxes?.income !== undefined) {
    const list = patch.taxes.income;
    if (!Array.isArray(list) || list.length < 1 || list.length > 6) throw bad('Income tax has 1 to 6 brackets.');
    let prev = 0;
    p.taxes.income = list.map((b, k) => {
      const last = k === list.length - 1, upTo = last ? 0 : int('taxes.income.upTo', b?.upTo, prev + 1, 1e10);
      if (!last) prev = upTo;
      return { upTo, bp: int('taxes.income.bp', b?.bp, 0, 9000) };
    });
  }
  if (patch.food?.prices !== undefined) {
    const ps = patch.food.prices;
    if (!ps || typeof ps !== 'object' || Array.isArray(ps)) throw bad('food.prices is a price per item.');
    const out = { ...p.food.prices };
    for (const [id, v] of Object.entries(ps)) {
      if (!FOOD_BY_ID[id]) throw bad(`Unknown food item ${clean(id, 30)}.`);
      if (v === null) { delete out[id]; continue; }
      out[id] = int(`food.prices.${id}`, v, 1, 1e8);
    }
    p.food.prices = out;
  }
  if (patch.menus !== undefined) {
    if (!patch.menus || typeof patch.menus !== 'object') throw bad('menus is a list per kind of venue.');
    for (const [kind, items] of Object.entries(patch.menus)) {
      if (!ITEM_ID.test(kind)) throw bad(`Bad venue kind ${clean(kind, 30)}.`);
      if (FOOD_VENUES.has(kind)) { delete p.menus[kind]; continue; }   // (a policy from before food.js: their menus are the places' own now)
      if (!Array.isArray(items) || items.length > 30) throw bad(`The ${kind} menu is a list of up to 30 items.`);
      const seen = new Set();
      p.menus[kind] = items.map(it => {
        const id = String(it?.id || '');
        if (!ITEM_ID.test(id) || seen.has(id)) throw bad(`Bad or repeated item id "${clean(id, 30)}" on the ${kind} menu.`);
        seen.add(id);
        const label = clean(it.label, 40);
        if (!label) throw bad(`Item ${id} needs a name.`);
        const inputs = {};
        for (const [c, n] of Object.entries(it.inputs || {})) { if (!p.commodities[c]) throw bad(`Item ${id} uses an unknown commodity ${clean(c, 30)}.`); inputs[c] = int(`${id} input`, n, 0, 100); }
        return { id, label, icon: clean(it.icon, 8) || '•', price: int(`${id} price`, it.price, 1, 1e8), inputs };
      });
    }
  }
  if (patch.commodities !== undefined) {
    for (const [c, v] of Object.entries(patch.commodities || {})) {
      if (!p.commodities[c]) throw bad(`Unknown commodity ${clean(c, 30)}.`);
      if (v?.base !== undefined) p.commodities[c].base = int(`${c} base price`, v.base, 1, 1e8);
      if (v?.vol !== undefined) p.commodities[c].vol = int(`${c} volatility`, v.vol, 0, 3000);
    }
  }
  if (patch.ordinances !== undefined) {
    for (const [k, v] of Object.entries(patch.ordinances || {})) {
      if (!p.ordinances[k]) throw bad(`Unknown ordinance ${clean(k, 30)}.`);
      if (v?.on !== undefined) { if (typeof v.on !== 'boolean') throw bad(`${k}.on is true or false.`); p.ordinances[k].on = v.on; }
      for (const f of ['cost', 'costPct', 'capPerBiz', 'exportBoostBp']) if (v?.[f] !== undefined && p.ordinances[k][f] !== undefined) p.ordinances[k][f] = int(`${k}.${f}`, v[f], 0, f.endsWith('Pct') ? 100 : 1e10);
    }
  }
  if (patch.agents?.scopes !== undefined) {
    const s = patch.agents.scopes;
    if (!Array.isArray(s) || s.some(x => !AGENT_SCOPES.includes(x))) throw bad(`Agent scopes are among ${AGENT_SCOPES.join(', ')}.`);
    p.agents.scopes = [...new Set(s)];
  }
  if (patch.jobs?.roles !== undefined) {
    const r = patch.jobs.roles;
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw bad('jobs.roles is a list of work modules per kind of venue.');
    const out = {};
    for (const [kind, list] of Object.entries(r)) {
      if (!ITEM_ID.test(kind)) throw bad(`Bad venue kind ${clean(kind, 30)}.`);
      if (list === null) continue;   // back to the modules' own choice
      if (!Array.isArray(list) || list.length > 6 || list.some(id => !moduleOf(id))) throw bad(`jobs.roles.${kind} is a list of up to 6 known work modules.`);
      out[kind] = [...new Set(list)];
    }
    p.jobs.roles = out;
  }
  if (patch.welfareOf !== undefined) {
    const out = {};
    for (const [title, kind] of Object.entries(patch.welfareOf || {})) { if (!['pension', 'student', 'unemployed', 'allowance'].includes(kind)) throw bad(`${clean(title, 30)}: unknown benefit.`); out[clean(title, 40)] = kind; }
    p.welfareOf = out;
  }
  if (p.priceBounds.minPct > p.priceBounds.maxPct || p.stabilizer.minPct > p.stabilizer.maxPct || p.rent.landMinPct > p.rent.landMaxPct || p.pricing.minPct > p.pricing.maxPct) throw bad('A minimum is above its maximum.');
  if (p.minWage > Math.min(...Object.values(p.wages))) throw bad('A role pays less than the minimum wage.');
  return p;
}
export const AGENT_SCOPES = Object.freeze(['work', 'buy', 'pay', 'rent', 'business']);

/** Only what differs from the defaults (what is stored). */
export function policyDiff(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) if (JSON.stringify(v) !== JSON.stringify(POLICY_DEFAULTS[k])) out[k] = v;
  return out;
}
/** The stored policy, checked (a broken stored value never stops the economy: the defaults stand in). */
export function loadPolicy(raw) {
  let stored = {};
  try { stored = raw ? JSON.parse(raw) : {}; } catch { stored = {}; }
  try { const p = checkPolicy(clone(POLICY_DEFAULTS), stored || {}); for (const k of FOOD_VENUES) delete p.menus[k]; return p; } catch { return clone(POLICY_DEFAULTS); }
}
/** Income tax on a day's income (hundredths), bracket by bracket, rounded down. */
export function incomeTax(policy, income) {
  if (!(income > 0)) return 0;
  let tax = 0, lower = 0;
  for (const b of policy.taxes.income) {
    const upper = b.upTo || Infinity, slice = Math.max(0, Math.min(income, upper) - lower);
    tax += slice * b.bp / 10000;
    if (income <= upper) break;
    lower = upper;
  }
  return Math.floor(tax);
}
/** The bracket (1, 2, 3 …: $, $$, $$$) a day's income falls in. */
export function bracketOf(policy, income) {
  const list = policy.taxes.income;
  for (let k = 0; k < list.length; k++) if (!list[k].upTo || income <= list[k].upTo) return k + 1;
  return list.length;
}
/** Basis points of an amount, rounded down. */
export const bp = (amount, rate) => Math.floor(amount * rate / 10000);
export const menuItem = (policy, kind, id) => (policy.menus[kind] || []).find(m => m.id === id) || null;
/** The city's usual price of a food item: an administrator's own, else the item's price × food.pricePct. */
export const foodBase = (policy, it) => { const own = policy.food?.prices?.[it.id]; return Number.isSafeInteger(own) ? own : Math.max(1, Math.round(it.price * (policy.food?.pricePct ?? 100) / 100 / 5) * 5); };
