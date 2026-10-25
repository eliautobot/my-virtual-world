// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The city's nights out (2026-10-23, the product owner: "make these themed floors actually be usable by agents and
// residents, meaning some work there, some go there spending money ... the lounge needs bartenders, several, musicians
// ... the night club needs bartenders, several, nightclub dancers as well as a DJ"): the themed floors (Floor Themes:
// shared/floor-themes.js) an arcade, a lounge or a club are places of their own (their floor's venue), open to everyone;
// who works there is told by the piece they work at.

/** The themed floors' venue kinds (a level's `venue`), what Free Will and the Mind call them. */
export const NIGHTLIFE = Object.freeze(['arcade', 'lounge_bar', 'club']);
export const NIGHTLIFE_NAME = Object.freeze({ arcade: 'arcade', lounge_bar: 'lounge', club: 'night club' });
/** Hours open (world hours; a club closes at midnight, its staff with it). */
export const NIGHTLIFE_OPEN = Object.freeze({ arcade: [10, 23.5], lounge_bar: [15, 23.95], club: [20, 23.95] });

/** What one drinks there (shared/food.js items, on the place's menu: server/economy/policy.js menus). */
export const DRINKS = Object.freeze({
  lounge_bar: ['martini', 'old_fashioned', 'gin_tonic', 'aperol', 'red_wine', 'white_wine', 'champagne', 'whiskey'],
  club: ['margarita', 'mojito', 'cosmopolitan', 'pina_colada', 'champagne', 'beer'],
  arcade: ['cola', 'lemon_soda'],
});

/** Who works at a piece with a serving side: its role (the economy's wage, the job's title, what they're seen doing). */
export const ITEM_ROLE = Object.freeze({
  island_bar: 'bartender', round_bar: 'bartender', club_bar: 'bartender', dj_stage: ['dj', 'dancer', 'dancer'], lounge_stage: 'musician', go_go_podium: 'dancer',
});   // (one role for the piece, or one per serving place in its slots' order)
export const ROLE_TITLE = Object.freeze({ bartender: 'Bartender', dj: 'DJ', musician: 'Musician', dancer: 'Dancer', attendant: 'Attendant' });
/** What they're seen doing at work (shared/catalog.js USES), per role. */
export const ROLE_USE = Object.freeze({ bartender: 'bartend', dj: 'dj', musician: 'perform', dancer: 'gogo' });

/** The role at a piece of type t, slot k (its index among all the piece's slots). */
export function roleOf(t, k) { const r = ITEM_ROLE[t]; return Array.isArray(r) ? r[k] || null : r || null; }
/** The role of whoever works at slot k of item id on floor f of building b (by the piece), or null. */
export function roleAt(world, b, f, id, k = 0) {
  const B = world.buildings?.[b], L = B && !B.gone ? world.levels[B.lv?.[f]] : null;
  const it = L?.items?.find(i => i.id === id);
  return it ? roleOf(it.t, k) : null;
}
