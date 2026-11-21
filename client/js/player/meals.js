// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Players' meals (2026-11-18, the product owner: "once I sit down, there's a button to order, a menu … then the plate should appear in
// front of the player character"): what a player bought sitting at a table there is in front of them — served the way the
// residents' meals are (shared/food.js courses: the drink first, then the starter, the main, the dessert, the drink beside
// each) over the meal's time, from the server's word (t: 'pmeal': server/world/players.js serveMeal), until they get up.
// Kept apart from the pages' renderers so the tests run it in node; player.js (its own) and remote.js (everyone else's)
// put what is in front of each one on its character (render/agents.js draws the plate with the residents' own).
import { courses, foodItem } from '/shared/food.js';

/** pid → { ns (the items: shared/food.js numbers), at (ms, the page's clock), dur (ms), list (courses) } */
export const meals = new Map();

/** The server's word about a player's meal: m { pid, items (numbers; [] when it is over), el (ms since served), dur }. */
export function onMeal(m, now = Date.now()) {
  if (!m || m.pid === undefined || m.pid === null) return;
  const ns = Array.isArray(m.items) ? m.items.filter(n => Number.isInteger(n) && foodItem(n)) : [];
  if (!ns.length || !(m.dur > 0)) { meals.delete(m.pid); return; }
  meals.set(m.pid, { ns, at: now - Math.max(0, Number(m.el) || 0), dur: m.dur, list: courses(ns) });
}

/**
 * What is in front of player pid at time now (ms, the page's clock): { item (the course now: a dish, or a drink being had),
 * side (the drink beside a dish: 0 none), sip (the course is a drink) } — or null (nothing: no meal, or it is over).
 */
export function servedNow(pid, now = Date.now()) {
  const m = meals.get(pid);
  if (!m || !m.list.length) return null;
  const f = (now - m.at) / m.dur;
  if (f >= 1) { meals.delete(pid); return null; }
  let acc = 0, c = m.list[m.list.length - 1];
  for (const x of m.list) { acc += x.f; if (f < acc) { c = x; break; } }
  const drink = m.ns.find(n => foodItem(n)?.v) || 0;
  return { item: c.item, side: c.sip ? 0 : drink, sip: !!c.sip };
}
