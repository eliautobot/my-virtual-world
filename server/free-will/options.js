// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The options a Free Will agent chooses from (docs/features/FREE-WILL.md §2.3). They come from the same rules the routine
// uses (Brain.leisureOptions: what is open, what the needs allow, invitations), so Free Will can never pick something
// the world would not let a resident do. Kinds that happen at a venue are offered as real places — the nearest open ones
// with a free spot, with their name, the travel time and the price of a visit — because "a café" made agents stay home
// and spend nothing in the bake-off (FREE-WILL.md §11.1).
import { ctxB, ctxF, ctxOf } from '../../shared/constants.js';
import { isOpen } from '../sim/agents.js';

/** Free-time kinds that happen at a venue, and the venue kind they use (index.venues). */
export const VENUE_OF = Object.freeze({ cafe: 'cafe', bar: 'restaurant', shop: 'shop', gym: 'gym', park: 'park', arcade: 'arcade', lounge_bar: 'lounge_bar', club: 'club' });
/** The item a visit usually costs, per venue kind (shops and gyms: server/economy/policy.js menus; a café's or a bar's
 *  drink: the middle price of its drinks, server/economy/businesses.js typicalPrice); parks are free. */
const VISIT_ITEM = Object.freeze({ cafe: 'drink', restaurant: 'drink', shop: 'goods', gym: 'session', arcade: 'game_tokens', lounge_bar: 'martini', club: 'cover' });
/** The furniture a visit needs free (Brain.cafeVisit etc.); null: the place always has room (a park can be strolled). */
const NEEDS_SLOT = Object.freeze({ cafe: ['eat', 'relax'], restaurant: ['eat'], shop: ['browse'], gym: ['run', 'lift', 'yoga'], park: null, arcade: ['play', 'pingpong', 'dance'], lounge_bar: ['eat', 'relax', 'chat'], club: ['dance', 'eat'] });
export const PER_KIND = 2;
export const MAX_OPTIONS = 10;

const PLAIN = Object.freeze({
  home: (o, at) => (at.atHome ? 'Stay home and relax' : 'Go home and relax'),
  wander: () => 'Take a walk around the neighbourhood',
  jog: () => 'Go for a jog outside',
  lounge: () => "Hang out in the workplace lounge (games, music, the bar)",
  chat: () => 'Find someone nearby and have a chat',
  visit: () => 'Visit the flat you were invited to',
});
const AT_VENUE = Object.freeze({
  cafe: 'Coffee or a snack at', bar: 'A drink at', shop: 'Go shopping at', gym: 'Work out at', park: 'Spend time in',
  arcade: 'Play games at the arcade', lounge_bar: 'Cocktails and live music at', club: 'Go dancing at the club',
});

const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/**
 * The nearest open venues of one kind with a free spot, nearest first (dearer or worse-rated places count as farther,
 * as in Brain.pickVenue, without its random draw). at = { x, z, ctx }.
 */
export function nearestVenues(brain, a, vkind, at, econ, n = PER_KIND, slotUses = NEEDS_SLOT[vkind]) {
  const list = brain.index.venues[vkind];
  if (!list || !list.length) return [];
  const scored = [];
  for (const v of list) {
    const B = brain.W.buildings[v.b];
    if (!B || B.gone) continue;
    scored.push([hyp(v.x, v.z, at.x, at.z) * (econ ? econ.venueFactor(v.b, v.f) : 1), v]);
  }
  scored.sort((p, q) => p[0] - q[0]);
  const out = [], uses = slotUses;
  for (const [, v] of scored) {
    if (uses && !brain.freeSlots(v.b, v.f, uses, a.i).length) continue;
    out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

/** "about 12 min away" in world minutes, from the router's own estimate (walking, the subway, lifts). */
function minutesTo(brain, at, v) {
  const s = brain.router.estimate(at.ctx, at.x, at.z, { ctx: ctxOf(v.b, v.f), x: v.x, z: v.z });
  return Math.max(1, Math.round(s * brain.clock.dayScale / 60));
}

/** Plain kinds the routine tries and may find impossible (nobody to talk to, a full lounge): offered only when they
 *  can happen, so the agent does not pick what the world then refuses (stress test, FREE-WILL.md §8). */
function possibleHere(brain, a, kind, at) {
  if (kind === 'chat') return brain.chatPartnerNear(a, at.ctx, at.x, at.z);
  if (kind === 'lounge') return brain.loungeHasRoom(a);
  return true;
}

/**
 * The menu for one choice point: [{ id, kind, w, label, b?, f?, price?, minutes?, rating? }] (≤ MAX_OPTIONS), where w is the
 * routine's weight. at = { x, z, ctx, h, day, needs, atHome } describes the agent at the moment of the choice (predicted
 * when asked ahead). econ (or null when the economy is off) = { canSpend(a, kind), venueFactor(b, f), price(b, f, item),
 * rating(b, f) } — prices in hundredths of a VC, ratings 0..500.
 */
export function buildOptions(brain, a, at, econ) {
  const out = [];
  for (const [kind, w] of brain.leisureOptions(a, at.h, at.day, at.needs)) {
    if (!possibleHere(brain, a, kind, at)) continue;
    const vkind = VENUE_OF[kind];
    if (!vkind) { out.push({ id: kind, kind, w, label: PLAIN[kind] ? PLAIN[kind](a, at) : kind }); continue; }
    if (econ && !econ.canSpend(a, vkind)) continue;   // what Brain.pickVenue refuses: can't afford it and keep the rent
    const near = nearestVenues(brain, a, vkind, at, econ);
    for (const v of near) {
      const o = { id: `${kind}@${v.b}.${v.f}`, kind, w: w / near.length, b: v.b, f: v.f, venue: true, name: brain.placeName(v.b, v.f), minutes: minutesTo(brain, at, v) };
      const item = VISIT_ITEM[vkind];
      if (econ && item) { const p = econ.price(v.b, v.f, item); if (Number.isFinite(p)) o.price = p; const r = econ.rating(v.b, v.f); if (Number.isFinite(r)) o.rating = r; }
      o.label = describeVenue(kind, o);
      out.push(o);
    }
  }
  if (out.length <= MAX_OPTIONS) return out;
  // too many: keep each kind's best place first, then the rest by the routine's weight
  const firstOfKind = new Set(), keep = [];
  for (const o of out) if (!firstOfKind.has(o.kind)) { firstOfKind.add(o.kind); keep.push(o); }
  const rest = out.filter(o => !keep.includes(o)).sort((p, q) => q.w - p.w);
  return [...keep.sort((p, q) => q.w - p.w).slice(0, MAX_OPTIONS), ...rest].slice(0, MAX_OPTIONS);
}

const vcText = c => `${(c / 100).toFixed(c % 100 ? 2 : 0)} VC`;
export function describeVenue(kind, o) {
  const bits = [`${o.prefix || AT_VENUE[kind] || kind} ${o.name}`];
  const extra = [`about ${o.minutes} min away`];
  if (o.visits !== undefined) extra.push(o.visits === 0 ? 'never been' : o.visits === 1 ? 'been once before' : `been ${o.visits} times`);
  if (o.price) extra.push(`about ${vcText(o.price)}`);
  else if (kind === 'park') extra.push('free');
  if (o.rating) extra.push(`rated ${(o.rating / 100).toFixed(1)}/5`);
  return `${bits[0]} (${extra.join(', ')})`;
}

/**
 * Whether option o can still be done now (the moment of the decision): its kind is still on the routine's list and its
 * venue still exists, is open (the kind is on the list) and has a free spot. Returns the index.venues entry for a venue
 * option, true for a plain one, or null.
 */
export function stillPossible(brain, a, o, live, at = null) {
  if (!live.some(x => x[0] === o.kind)) return null;
  if (at && !possibleHere(brain, a, o.kind, at)) return null;
  if (o.b === undefined) return true;
  const vkind = VENUE_OF[o.kind];
  const v = (brain.index.venues[vkind] || []).find(x => x.b === o.b && x.f === o.f);
  if (!v) return null;
  const B = brain.W.buildings[o.b];
  if (!B || B.gone) return null;
  const uses = NEEDS_SLOT[vkind];
  if (uses && !brain.freeSlots(o.b, o.f, uses, a.i).length) return null;
  return v;
}

/** The place the agent will be at when its current plan ends: { x, z, ctx }. */
export function endPlace(P) { return { x: P.x, z: P.z, ctx: P.ctx }; }
export const placeOf = (brain, ctx) => (ctx >= 0 ? brain.placeName(ctxB(ctx), ctxF(ctx)) : 'outside');

// ------------------------------------------------------------------------------------------- the other choices
// An agent with Free Will also chooses how to work on a task, where to eat, how to start the day, whether to stop for
// a coffee on the way to work, how to recover when exhausted, and what to do after a task at night
// (server/sim/agents.js choiceType). Every option is something the brain can carry out (Brain.doChoice).

const MEAL = h => (h < 11 ? 'Breakfast' : h < 16 ? 'Lunch' : 'Dinner');
/** Venue options of one kind for a choice: the nearest open ones with room, with price and travel time. */
function venueOptions(brain, a, at, econ, vkind, idPrefix, prefix, item, extra = {}, slotUses = NEEDS_SLOT[vkind]) {
  if (!isOpen(vkind, at.h)) return [];
  if (econ && !econ.canSpend(a, vkind, true)) return [];
  return nearestVenues(brain, a, vkind, at, econ, PER_KIND, slotUses).map(v => {
    const o = { id: `${idPrefix}@${v.b}.${v.f}`, kind: vkind, w: 1, b: v.b, f: v.f, venue: true, prefix, name: brain.placeName(v.b, v.f), minutes: minutesTo(brain, at, v), ...extra };
    if (econ && item) { const p = econ.price(v.b, v.f, item); if (Number.isFinite(p)) o.price = p; const r = econ.rating(v.b, v.f); if (Number.isFinite(r)) o.rating = r; }
    o.label = describeVenue(vkind, o);
    return o;
  });
}
const away = m => (m > 0 ? ` (about ${m} min away)` : '');
function homeMinutes(brain, a, at) {
  const hm = a.p.home; if (!hm) return null;
  const B = brain.W.buildings[hm.b]; if (!B || B.gone) return null;
  return at.atHome ? 0 : Math.max(1, Math.round(brain.router.estimate(at.ctx, at.x, at.z, { ctx: ctxOf(hm.b, hm.f), x: B.x, z: B.z }) * brain.clock.dayScale / 60));
}

function taskOptions(brain, a, P) {
  return brain.taskWays(a, P).map(w => {
    const id = w.b === undefined ? w.way : `${w.way}@${w.b}.${w.f}`;
    const label = w.way === 'desk' ? (w.minutes ? `Go to its desk at ${w.place}${away(w.minutes)}` : `Work at its desk at ${w.place}`)
      : w.way === 'home' ? (w.minutes ? `Go home and use the computer${away(w.minutes)}` : 'Use the computer at home')
        : w.way === 'laptop' ? (w.minutes ? `Take the laptop to a table at ${w.place}${away(w.minutes)}` : `Open the laptop at a free table here (${w.place})`)
          : 'Handle it on the phone, right where it is';
    return { id, way: w, w: 1, label };
  });
}

function mealOptions(brain, a, at, econ) {
  const out = [], meal = MEAL(at.h), hm = homeMinutes(brain, a, at), j = a.p.job;
  if (hm !== null) out.push({ id: 'home', way: 'home', w: 1, label: `${meal} at home${away(hm)}` });
  out.push(...venueOptions(brain, a, at, econ, 'cafe', 'cafe', `${meal} at`, 'cafe_lunch', { way: 'venue', vkind: 'cafe' }, ['eat']));
  out.push(...venueOptions(brain, a, at, econ, 'restaurant', 'restaurant', `${meal} at`, 'meal', { way: 'venue', vkind: 'restaurant' }, ['eat']));
  if (j && j.b !== undefined && at.ctx >= 0 && ctxB(at.ctx) === j.b && brain.freeSlots(j.b, j.f, 'eat', a.i).length) out.push({ id: 'office', way: 'office', w: 1, label: 'Eat in the kitchen at work' });
  return out.slice(0, MAX_OPTIONS);
}

function morningOptions(brain, a, at) {
  if (!a.p.home || !at.atHome) return [];
  const out = [
    { id: 'full', steps: ['shower', 'dress', 'breakfast'], w: 1, label: 'Shower, get dressed and have breakfast at home' },
    { id: 'quick', steps: ['dress', 'breakfast'], w: 1, label: 'Get dressed and have a quick breakfast at home' },
  ];
  if (isOpen('cafe', at.h)) out.push({ id: 'out', steps: ['shower', 'dress', 'breakfast_out'], w: 1, label: 'Shower, get dressed and have breakfast at a café' });
  out.push({ id: 'go', steps: [], w: 1, label: 'Skip the morning routine and head out' });
  return out;
}

function shiftOptions(brain, a, at) {
  const j = a.p.job, d = brain.jobDest(a);
  if (!j || !d || !Number.isFinite(j.start)) return [];
  const minutes = Math.max(1, Math.round(brain.router.estimate(at.ctx, at.x, at.z, d) * brain.clock.dayScale / 60));
  const out = [{ id: 'go', way: 'go', w: 1, label: `Head to work at ${brain.placeName(j.b, j.f)} now${away(minutes)}` }];
  // a coffee to go at a café close by: how late it would make the agent is part of the choice
  const spare = (j.start - at.h) * 60 - minutes;
  for (const o of venueOptions(brain, a, at, null, 'cafe', 'coffee', 'Grab a coffee to go at', null, { way: 'coffee' }).slice(0, 1)) {
    if (o.minutes > 10) continue;
    const late = Math.max(0, Math.round(o.minutes * 2 + 5 - spare));
    o.label = `${o.label.replace(/\)$/, '')}, ${late > 0 ? `about ${late} min late for work` : 'still on time'})`;
    out.push(o);
  }
  return out;
}

function restOptions(brain, a, at, econ) {
  const out = [], hm = homeMinutes(brain, a, at);
  if (hm !== null) out.push({ id: 'nap', way: 'nap', w: 1, label: `Take a nap at home${away(hm)}` });
  out.push(...venueOptions(brain, a, at, econ, 'cafe', 'coffee', 'A coffee to wake up at', 'coffee', { way: 'coffee' }).slice(0, 1));
  return out;
}

function afterTaskOptions(brain, a) {
  const out = [{ id: 'sleep', way: 'sleep', w: 1, label: 'Go back to sleep' }];
  if (a.p.home) out.push({ id: 'stay_up', way: 'stay_up', w: 1, label: 'Stay up a while (TV or a book at home)' });
  return out;
}

/** The menu for a choice of the given type (FREE-WILL.md §2.3); see buildOptions for free time. */
export function buildChoice(type, brain, a, at, econ, P) {
  switch (type) {
    case 'leisure': return buildOptions(brain, a, at, econ);
    case 'task': return taskOptions(brain, a, P);
    case 'meal': return mealOptions(brain, a, at, econ);
    case 'morning': return morningOptions(brain, a, at);
    case 'shift': return shiftOptions(brain, a, at);
    case 'rest': return restOptions(brain, a, at, econ);
    case 'after_task': return afterTaskOptions(brain, a);
    default: return [];
  }
}

/** Whether a choice (not free time) can still be done at the moment of the decision: { venue } or null. */
export function choicePossible(brain, a, type, o, P, h) {
  if (o.venue) {
    const v = (brain.index.venues[o.kind] || []).find(x => x.b === o.b && x.f === o.f);
    const B = v && brain.W.buildings[o.b];
    if (!v || !B || B.gone || !isOpen(o.kind, h)) return null;
    if (type === 'meal' && !brain.freeSlots(o.b, o.f, 'eat', a.i).length) return null;
    return { venue: v };
  }
  if (type === 'task') {
    const w = brain.taskWays(a, P).find(x => x.way === o.way.way && x.b === o.way.b && x.f === o.way.f);
    return w ? { venue: null, way: w } : null;
  }
  if ((o.way === 'home' || o.way === 'nap' || o.way === 'stay_up') && !a.p.home) return null;
  return { venue: null };
}
