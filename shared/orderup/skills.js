// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Order Up's cooking skills (PLAN-RESTAURANT-GAME.md "Progression" P2, 2026-10-28, the product owner: "we need the skills
// as well ... for agents, I want the same skill system"): a cook (a player or an agent) gets a skill point each Order Up
// level after the first and puts it into a skill, up to five ranks. A skill helps at its stations: their perfect window
// is wider (the time a dish can stay in and still be perfect) or their work quicker (chopping, shaking, washing); Service
// keeps a dish's grade longer between done and served and brings bigger tips. The rules apply the skills of the cook who
// put the food in, works the station or serves (shared/orderup/rules.js), the same for every cook; a Rush that counts is
// played with the skills the server has on record for that cook (shared/orderup/module.js).

export const SKILL_MAX = 5;
/** What taking every point back costs, in VC (as the fishing game's). */
export const RESPEC_PRICE = 250;
/** The skills: per, what a rank adds (a fraction); window/speed: what it widens or quickens at its stations. */
export const SKILLS = Object.freeze([
  { id: 'barista', name: 'Barista', icon: '☕', per: 0.08, window: true, speed: true, stations: ['ou_espresso', 'ou_steamer', 'ou_kettle', 'ou_grinder'], blurb: 'Coffee, milk and tea: +8 % perfect window and quicker grinding a rank.' },
  { id: 'knife', name: 'Knife work', icon: '🔪', per: 0.1, speed: true, stations: ['ou_prep'], blurb: 'The prep counter: chopping and preparing +10 % quicker a rank.' },
  { id: 'baker', name: 'Baker', icon: '🥐', per: 0.08, window: true, stations: ['ou_oven', 'ou_pizza_oven', 'ou_toaster', 'ou_press', 'ou_tandoor'], blurb: 'Ovens, the toaster and the press: +8 % perfect window a rank.' },
  { id: 'grill', name: 'Grill cook', icon: '🔥', per: 0.08, window: true, stations: ['ou_grill', 'ou_griddle', 'ou_fryer', 'ou_popcorn'], blurb: 'The grill, the griddle and the fryer: +8 % perfect window a rank.' },
  { id: 'saucier', name: 'Saucier', icon: '🍲', per: 0.08, window: true, stations: ['ou_stove', 'ou_wok', 'ou_bamboo'], blurb: 'The stove, the wok and the steamer: +8 % perfect window a rank.' },
  { id: 'mixology', name: 'Mixologist', icon: '🍸', per: 0.1, window: true, speed: true, stations: ['ou_cocktail', 'ou_blender', 'ou_juicer', 'ou_soda', 'ou_taps'], blurb: 'The bar and the blender: shaking +10 % quicker, +10 % perfect window a rank.' },
  { id: 'service', name: 'Service', icon: '🛎️', per: 0.1, stations: [], blurb: 'Dishes keep their grade 10 % longer before serving, and tips 5 % bigger a rank.' },
  { id: 'dishpit', name: 'Dish pit', icon: '🧽', per: 0.15, speed: true, stations: ['ou_sink'], blurb: 'The sink: washing up +15 % quicker a rank.' },
].map(Object.freeze));
export const SKILL_BY_ID = Object.freeze(Object.fromEntries(SKILLS.map(s => [s.id, s])));
const BY_STATION = new Map(SKILLS.flatMap(s => s.stations.map(t => [t, s])));
/** The skill that helps at station type t, or null. */
export const skillAt = t => BY_STATION.get(t) || null;

/** A cook's skills, cleaned: { id: rank 1..5 } of known skills only. */
export function cleanSkills(o) {
  const out = {};
  for (const [id, n] of Object.entries(o && typeof o === 'object' ? o : {})) if (SKILL_BY_ID[id] && Number.isSafeInteger(n) && n > 0) out[id] = Math.min(SKILL_MAX, n);
  return out;
}
/** Skill points: one an Order Up level after the first; spent: those in the skills. */
export function pointsOf(level, skills) {
  const total = Math.max(0, (level | 0) - 1), spent = Object.values(cleanSkills(skills)).reduce((a, n) => a + n, 0);
  return { total, spent, free: Math.max(0, total - spent) };
}
/** What a cook's skill adds at station type t: { window, speed } as fractions (0 when it doesn't help there). */
export function bonusAt(skills, t) {
  const s = skillAt(t), n = s ? (skills?.[s.id] | 0) : 0;
  return { window: s?.window ? n * s.per : 0, speed: s?.speed ? n * s.per : 0 };
}
/** Service's: { fresh: how much longer a dish keeps its grade (a fraction), tips: x }. */
export function serviceOf(skills) { const n = skills?.service | 0; return { fresh: n * SKILL_BY_ID.service.per, tips: 1 + n * 0.05 }; }
