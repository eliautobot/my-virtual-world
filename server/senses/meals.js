// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a body is eating or drinking (docs/features/awareness.md §5), from what the city really served it — never from what
// its brain said it would have (2026-11-18, the product owner: Sam said he was eating pho while his plate held what he really ordered;
// Lara "had a croissant" for twenty minutes with nothing in front of her). One reading for its own senses (the "Your food"
// card: what it ordered, eating it or on its way to the table, or nothing at all where food is served) and for what others
// see of it ("Around you: Sam — eating lobster and a cheesecake").
import { ctxB, ctxF } from '../../shared/constants.js';
import { foodName } from '../../shared/food.js';

/** The places where food or drink is served (a floor's venue kind), as the companions' meals know them. */
export const FOOD_PLACES = Object.freeze(new Set(['restaurant', 'cafe', 'lounge_bar', 'club']));

/** Items (shared/food.js ids) in words: "lobster, a cola and a cheesecake". */
export function foodWords(items) {
  const n = (items || []).map(id => String(foodName(id) || '').toLowerCase()).filter(Boolean).slice(0, 6);
  return n.length < 2 ? n[0] || '' : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/**
 * What body a has to eat or drink at sim time t: { items, state, place, paid } — state 'eating' (in front of it now),
 * 'coming' (ordered, on its way to the table), 'ordering' (at the counter), 'done' (its meal with its leader is over) —
 * or null (nothing). A companion's meal with its leader (its order's seat) first, else the stay it is in (a meal, a
 * coffee, a drink: the order on its act).
 */
export function mealOf(a, t) {
  if (!a) return null;
  const s = a.order?.seat, m = s?.meal;
  if (m?.order?.length) {
    const x = a.act, on = x && x.k === s.k && (s.dec !== undefined ? x.dec === s.dec : x.b === s.b && x.f === s.f && x.id === s.id);
    const sat = !!on && Number.isFinite(x.holdStart) && x.holdStart <= t;
    return { items: m.order, state: m.done ? 'done' : sat ? 'eating' : 'coming', place: s.venue?.name || null, paid: m.paid?.total ?? null };
  }
  const x = a.act;
  if (!x?.order?.length || !Number.isFinite(x.holdStart) || !Number.isFinite(x.holdEnd) || t > x.holdEnd) return null;
  if (t < x.holdStart) return { items: x.order, state: 'coming', place: x.place || null, paid: null };
  return { items: x.order, state: x.use === 'order' ? 'ordering' : 'eating', place: x.place || null, paid: null };
}

/** The food place floor ctx is (its venue kind), or null: not one, or outdoors. */
export function foodPlaceAt(W, ctx) {
  if (!(ctx >= 0) || !W) return null;
  const B = W.buildings?.[ctxB(ctx)], L = B && !B.gone ? W.levels?.[B.lv?.[ctxF(ctx)]] : null;
  return L && FOOD_PLACES.has(L.venue) ? L.venue : null;
}

/** What others see of it: "eating lobster and a cheesecake", or '' (nothing to see). */
export function mealSeen(a, t) {
  const m = mealOf(a, t);
  if (!m || (m.state !== 'eating' && m.state !== 'ordering')) return '';
  return `${m.state === 'ordering' ? 'buying' : 'having'} ${foodWords(m.items)}`;
}
