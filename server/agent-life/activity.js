// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What one planned activity means in words (docs/features/FREE-WILL.md §5): "Coffee at Café 21", "Worked out at Gym 9",
// "Went to bed" — the line an agent's activity log keeps (./life.js) and a resident's recent activity shows (server/recent.js).
// null: nothing worth a line (walking somewhere, waiting). key: a public place's "b.f" (familiar places), or null.

import { foodName } from '../../shared/food.js';

const MEAL = h => (h < 11 ? 'Breakfast' : h < 16 ? 'Lunch' : 'Dinner');
export const PUBLIC_VENUES = new Set(['cafe', 'restaurant', 'shop', 'gym', 'park', 'lounge']);
const HOME_USE = { tv: 'Watched TV at home', read: 'Read at home', computer: 'On the computer at home', phone: 'On the phone at home', relax: 'Relaxed at home', cook: 'Cooked at home' };

/** { kind, label, place, key, with? } for activity act of agent a (a sim agent: a.p its person, a.chatWith who it talks to). */
export function classifyAct(sim, a, act) {
  const W = sim.world, b = act.b, B = b >= 0 ? W.buildings[b] : null;
  const L = B ? W.levels[B.lv?.[act.f]] : null;
  const venue = L?.venue || (B?.type === 'park' ? 'park' : null);
  const place = act.place || (B ? B.name : '');
  const key = PUBLIC_VENUES.has(venue) && b >= 0 ? `${b}.${act.f}` : null;
  const home = a.p.home && b === a.p.home.b && act.f === a.p.home.f;
  const h = sim.brain.hour(act.holdStart);
  // what they had (shared/food.js: the main thing they ordered or made)
  const what = act.order?.length ? foodName(act.order[0]) : null, had = what ? `: ${what}` : '';
  switch (act.kind) {
    case 'sleep': return { kind: 'sleep', label: act.place === 'Out of town' ? 'Spent the night out of town' : h >= 5 && h < 12 ? 'Slept in' : 'Went to bed', place: null, key: null };
    case 'home':
      if (act.use === 'nap') return { kind: 'nap', label: 'Took a nap at home', place: 'Home', key: null };
      if (act.use === 'cook' && what) return { kind: 'home', label: `Cooked at home${had}`, place: 'Home', key: null };
      return HOME_USE[act.use] ? { kind: 'home', label: HOME_USE[act.use], place: 'Home', key: null } : null;
    case 'meal': return home ? { kind: 'meal', label: `${MEAL(h)} at home${had}`, place: 'Home', key: null } : { kind: 'meal', label: `${MEAL(h)} at ${place}${had}`, place, key };
    case 'visit':
      if (act.use === 'cafe') return { kind: 'cafe', label: what ? `${what} at ${place}` : `Coffee at ${place}`, place, key };
      if (act.use === 'chat') return { kind: 'visit', label: place || 'Visited a flat', place, key: null };
      if (venue === 'park' && ['bench', 'read', 'picnic', 'dance'].includes(act.use)) return { kind: 'park', label: `Spent time in ${place}`, place, key };
      return null;
    case 'shop': return { kind: 'shop', label: `Shopping at ${place}`, place, key };
    case 'gym': return { kind: 'gym', label: `Worked out at ${place}`, place, key };
    case 'bar': return { kind: 'bar', label: what ? `${what} at ${place}` : `A drink at ${place}`, place, key };
    case 'lounge': return { kind: 'lounge', label: `Hung out at ${place}`, place, key: b >= 0 ? `${b}.${act.f}` : null };
    case 'wander': return { kind: 'walk', label: place ? `A walk in ${place}` : 'A walk around the neighbourhood', place: place || null, key: venue === 'park' ? key : null };
    case 'jog': return { kind: 'jog', label: 'Went for a jog', place: null, key: null };
    case 'work':
      if (act.use === 'task_phone') return { kind: 'task', label: 'Worked on a task by phone', place: place || null, key: null };
      if (act.use === 'task') return { kind: 'task', label: home ? 'Worked on a task at home' : `Worked on a task at ${place}`, place, key: null };
      return { kind: 'work', label: `Working at ${place}`, place, key: null };
    case 'meeting': return { kind: 'meeting', label: `A meeting at ${place}`, place, key: null };
    // on post around the clock (server/agent-posts/): its log says so, one line a stretch (2026-10-28: a posted agent's
    // day showed only what it did before it was posted)
    case 'post': return { kind: 'post', label: `On duty at ${place}`, place: place || null, key: null };
    case 'chat': {
      const o = Number.isInteger(a.chatWith) ? sim.agents[a.chatWith] : null;
      return o ? { kind: 'chat', label: `Chatted with ${o.p.name}`, place: place || null, key: null, with: o } : null;
    }
    case 'talk': {
      // with someone it went to see or turned to (a connected agent's meet or say --to): like a chat in the street
      const o = Number.isInteger(act.talkWith) ? sim.agents[act.talkWith] : null;
      // (a player who walked up to it: by name — their conversation itself is remembered by server/agent-talk/)
      return o ? { kind: 'chat', label: `Talked with ${o.p.name}`, place: place || null, key: null, with: o }
        : { kind: 'talk', label: act.withName ? `Talked with ${act.withName}` : 'Talked with a visitor', place: place || null, key: null };
    }
    default: return null;
  }
}

// ------------------------------------------------------------------------------------------- plans and what was done
/**
 * The words a plan uses for the kinds of activity above (2026-11-17, the product owner: Sam's "Groceries at Store 21 after
 * work" was marked done with no shopping in his day). A plan that uses them, or names a place of the world, is done when
 * a line of its log says so (planCheck, didPlan) — so only what the log records wherever it happens is here (drinks are
 * also had at a club or a lounge bar, which it doesn't record: a plan for drinks is taken at its word). out: the word
 * names the kind of place (a restaurant, a café), so the same kind of activity at home is not it.
 */
const PLAN_WORDS = Object.freeze([
  { kinds: ['shop'], words: ['shop', 'shops', 'shopping', 'store', 'groceries', 'grocery', 'supermarket'] },
  { kinds: ['meal'], words: ['breakfast', 'brunch', 'lunch', 'dinner', 'supper', 'meal', 'eat'] },
  { kinds: ['meal', 'bar'], words: ['restaurant'], out: true },
  { kinds: ['cafe', 'meal'], words: ['café', 'cafe'], out: true },
  { kinds: ['cafe', 'meal'], words: ['coffee'] },
  { kinds: ['gym'], words: ['gym'] },
  { kinds: ['gym', 'jog'], words: ['workout', 'work out', 'exercise'] },
  { kinds: ['jog'], words: ['jog', 'jogging'] },
  { kinds: ['walk', 'park'], words: ['walk', 'stroll'] },
  { kinds: ['park', 'walk', 'jog'], words: ['park'] },
  { kinds: ['nap'], words: ['nap'] },
]);
const low = s => String(s ?? '').normalize('NFC').toLowerCase();
const wordChar = ch => !!ch && /[\p{L}\p{N}]/u.test(ch);
/** Where needle (lower case) stands in hay as whole words, or -1. */
function wordAt(hay, needle) {
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) if (!wordChar(hay[i - 1]) && !wordChar(hay[i + needle.length])) return i;
  return -1;
}
/** The world's places a plan can name, longest first, for planCheck: those whose visits the activity log records
 *  (PUBLIC_VENUES, by the names it gives them) — a night out at a club isn't in it, so a plan for one is taken at its word. */
export function placeNames(sim) {
  const W = sim.world, seen = new Map();
  (W.buildings || []).forEach((B, b) => {
    if (!B || B.gone) return;
    if (B.type === 'park' && B.name) seen.set(low(B.name), B.name);
    for (let f = 0; f < (B.floors || 0); f++) {
      if (!PUBLIC_VENUES.has(W.levels[B.lv?.[f]]?.venue)) continue;
      const n = sim.brain.placeName(b, f);
      if (n) seen.set(low(n), n);
    }
  });
  return [...seen].map(([l, name]) => ({ name, low: l })).sort((a, b) => b.low.length - a.low.length);
}
/**
 * What a plan asks its body to do: { places: [names of the world's places it names], groups: [the kinds of activity it
 * names: PLAN_WORDS entries] }, or null when it names neither ("Text Pema about sushi": nothing in its activity log can
 * say whether that happened). What it is about (after "about") is talked about, not done. "At home" is its home, as its
 * log says ("Breakfast at home": place 'Home'). names: placeNames().
 */
export function planCheck(text, names = []) {
  let rest = ` ${low(text)} `;
  const ab = wordAt(rest, 'about');
  if (ab >= 0) rest = rest.slice(0, ab);
  const places = [];
  for (const n of [...names, { name: 'Home', low: 'at home' }]) {
    const i = n.low ? wordAt(rest, n.low) : -1;
    if (i < 0) continue;
    places.push(n.name);
    rest = `${rest.slice(0, i)}${' '.repeat(n.low.length)}${rest.slice(i + n.low.length)}`;   // ("Store 21" is a place, not a word for shopping)
  }
  const groups = PLAN_WORDS.filter(g => g.words.some(w => wordAt(rest, w) >= 0));
  return places.length || groups.length ? { places, groups } : null;
}
/** Whether two names are one place ("Sakura Sushi" and its "Sakura Sushi Dining Room" too). */
export const samePlace = (a, b) => { const x = low(a), y = low(b); return !!x && !!y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)); };
/** The line each kind of free time writes in the log (classifyAct: a café visit is 'cafe', a stroll a 'walk'), so an
 *  option can be matched to a plan before it is done (server/free-will/options.js withPlans). */
export const LOGGED_AS = Object.freeze({ cafe: 'cafe', park: 'park', shop: 'shop', gym: 'gym', jog: 'jog', wander: 'walk', bar: 'bar', lounge: 'lounge', chat: 'chat', visit: 'visit', home: 'home' });
const fits = (g, line) => g.kinds.includes(line.kind) && !(g.out && (!line.place || line.place === 'Home'));
/**
 * Whether the lines of an activity log ([{ kind, place }]) show a plan done (check: planCheck's): a line at each place it
 * names, and for each kind of activity it names a line of that kind at one of them ("Groceries at Store 21": shopping at
 * Store 21 — not shopping elsewhere and passing by), anywhere when it names no place.
 */
export function didPlan(check, lines) {
  if (!check) return false;
  const at = l => !check.places.length || check.places.some(p => samePlace(l.place, p));
  return check.places.every(p => lines.some(l => samePlace(l.place, p))) && check.groups.every(g => lines.some(l => fits(g, l) && at(l)));
}
