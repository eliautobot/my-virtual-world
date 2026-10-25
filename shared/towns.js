// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Towns (2026-10-23: "a location system ... like a city/town so that agents form city or town dont automtically appear on
// the main city ... they should live and work on the town/city where the owner has their property"): every lot belongs to
// one town — the lot's region (server/property.js). The world's own town, MAIN, is named after the world ("Next City");
// administrators make the others by giving lots a town's name (the data map's Town lens, a lot's card). A town is its
// lots: one whose last lot leaves it is gone. Shared by the server and the browser.

/** The world's own town: every lot is in it until it is given another. */
export const MAIN_TOWN = 'main';
/** Longest town name. */
export const TOWN_NAME_MAX = 32;

/** A town's name as people read it: MAIN is the world's name. */
export function townName(id, worldName = '') {
  return !id || id === MAIN_TOWN ? (String(worldName || '').trim() || 'Main City') : String(id);
}
/** A name typed for a town, cleaned: '' when it can't be one (empty, too long once trimmed of controls, or MAIN's own id). */
export function cleanTownName(s) {
  const t = String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > TOWN_NAME_MAX || t.toLowerCase() === MAIN_TOWN) return '';
  return t;
}
/** The id a town is kept under for a name or id given by an administrator: MAIN for the world's own (by id or by its
 *  name), else the cleaned name; '' when it can't be a town. */
export function townId(s, worldName = '') {
  const raw = String(s ?? '').trim();
  if (raw === MAIN_TOWN || (raw && raw.toLowerCase() === townName(MAIN_TOWN, worldName).toLowerCase())) return MAIN_TOWN;
  return cleanTownName(raw);
}

const COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#8e44ad', '#3d6fb6', '#e84393', '#4f8a3c', '#f4a261', '#00b4d8', '#b5179e', '#90be6d', '#c0392b'];
/** A town's colour on the data map: MAIN a quiet grey, the others each their own (by name, so it stays put). */
export function townColor(id) {
  if (!id || id === MAIN_TOWN) return '#8d99ae';
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return COLORS[(h >>> 0) % COLORS.length];
}
