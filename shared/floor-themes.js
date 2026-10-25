// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Floor Themes (the product owner 2026-10-22: "Floor Themes or floor types ... floor templates, like an arcade, procedurally
// generated like other floors"): a floor of a building is laid out as a kind of place, generated to fit its size and its
// elevator like the city's own floors (server/world/layouts.js themeFloor), then furnished further by hand like any floor.
// A themed floor keeps its theme: 🎲 Regenerate rolls the same theme again, a resize lays it out again for the new size,
// ↺ Reset to auto gives the building's own floor back. The layout can be kept with 💾 Save layout (shared/edit.js). A
// theme with a venue makes the floor that kind of place for the city: a café, a restaurant, a shop or a gym is a business
// residents come to (server/economy/businesses.js); an arcade, a lounge or a club is a night out for the whole city, with
// its own staff and menu (shared/nightlife.js). Floors with flats keep their flats; parks and the airport have none.

export const FLOOR_THEMES = Object.freeze([
  { id: 'arcade', name: 'Arcade', icon: '🕹️', venue: 'arcade', blurb: 'Rows of playable arcade cabinets on a neon carpet, a prize counter, a snack corner and a lounge to sit out a turn.' },
  { id: 'lounge', name: 'Lounge', icon: '🛋️', venue: 'lounge_bar', blurb: 'Modern organic and softly lit: velvet sofas and bouclé chairs round stone tables, a terrazzo bar, sculpture, a little stage for music.' },
  { id: 'club', name: 'Night Club', icon: '💃', venue: 'club', blurb: 'Miami style: the DJ on a round stage in the middle of an LED dance floor, lights and lasers, a long backlit bar, VIP booths and party tables.' },
  { id: 'cafe', name: 'Café', icon: '☕', venue: 'cafe', blurb: 'A coffee counter, window bars, sofas and tables: a café residents come to.' },
  { id: 'restaurant', name: 'Restaurant', icon: '🍽️', venue: 'restaurant', blurb: 'A dining room with its kitchen and bar: a restaurant residents come to.' },
  { id: 'shop', name: 'Shop', icon: '🛍️', venue: 'shop', blurb: 'Shelves, display tables and a checkout: a shop residents come to.' },
  { id: 'gym', name: 'Gym', icon: '🏋️', venue: 'gym', blurb: 'Treadmills, weights, mats and lockers: a gym residents come to.' },
  { id: 'office', name: 'Open Office', icon: '💼', venue: null, blurb: 'Desk clusters, meeting rooms, offices and a kitchen.' },
  { id: 'conference', name: 'Conference', icon: '📊', venue: null, blurb: 'A boardroom and meeting rooms with screens and whiteboards, a reception and a coffee point.' },
]);
export const THEME_IDS = FLOOR_THEMES.map(t => t.id);
export const themeOf = id => FLOOR_THEMES.find(t => t.id === id) || null;

/** Why floor f of building B can't take a theme, or null. L: its layout (a floor with flats keeps its flats). */
export function themeWhy(B, f, L = null) {
  if (!B || B.gone) return 'No such building';
  if (B.type === 'park') return 'Parks have no floor themes';
  if (B.type === 'terminal') return "The airport's floors are its own";
  if ((B.type === 'apartment' && f > 0) || L?.units?.length) return 'Floors with flats keep their flats';
  return null;
}

/** A floor's name as people see it: its own name, or what kind of floor it is; '' when there is nothing to say. */
export const floorLabel = L => String(L?.name || '').trim();
export const MAX_FLOOR_NAME = 40;
