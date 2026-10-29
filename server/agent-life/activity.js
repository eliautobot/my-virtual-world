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
