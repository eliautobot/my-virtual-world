// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Themes (PLAN WP1.9, DECISIONS C39, C117): three token sets in client/css/theme.css - Dark (the default), Light and
// High contrast - applied by setting data-theme on <html>. The choice is a preference like the others: it follows the
// account to every device, and a guest's stays in this browser (prefs.js). index.html applies the browser's own copy
// before the first paint so the page never flashes the wrong look; a signed-in account's choice replaces it a moment
// later, when the account's preferences arrive. Only the interface is themed: the 3D world keeps its own colours.
import { bus } from './state.js';
import { pref } from './prefs.js';
import { setAvatarStyle } from './icons.js';

export const THEMES = [['dark', 'Dark'], ['light', 'Light'], ['contrast', 'High contrast']];
/** Transparency (Settings → Display, under Theme): 0 (solid, as the theme draws it) to TRANSPARENCY_MAX % see-through. */
export const TRANSPARENCY_MAX = 60, TRANSPARENCY_STEP = 5;
export const transparencyOf = v => { const n = Math.round((Number(v) || 0) / TRANSPARENCY_STEP) * TRANSPARENCY_STEP; return Math.max(0, Math.min(TRANSPARENCY_MAX, n)); };
export const isTheme = v => THEMES.some(([k]) => k === v);

/** Applies a theme now. Dark is the default, so it is the absence of the attribute. */
export function apply(name) {
  const t = isTheme(name) ? name : 'dark';
  const el = document.documentElement;
  if (t === 'dark') delete el.dataset.theme;
  else el.dataset.theme = t;
  // The browser's own chrome (the address bar on a phone, the scrollbars) follows the page's look.
  for (const m of [...document.querySelectorAll('meta[name="theme-color"]')]) m.remove();
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = (getComputedStyle(el).getPropertyValue('--page') || '#111111').trim();
  document.head.appendChild(meta);
  applyTransparency();
  return t;
}
/** Applies the transparency now: windows', panels' and buttons' backgrounds keep (100 − it) % of their opacity
 *  (--ui-a, theme.css); `see-through` on <html> drops the panels' blur and gives their words a faint halo (app.css).
 *  High contrast stays solid. */
export function applyTransparency(v = pref('transparency')) {
  const t = transparencyOf(v), el = document.documentElement;
  if (t) el.style.setProperty('--ui-a', `${100 - t}%`); else el.style.removeProperty('--ui-a');
  el.classList.toggle('see-through', t > 0 && el.dataset.theme !== 'contrast');
}

/** The theme in force (never throws; anything unknown means Dark). */
export const current = () => (isTheme(pref('theme')) ? pref('theme') : 'dark');

/** Agents' and residents' own emoji: 'normal' (as emoji, the default) or 'styled' (the theme's icons). */
export const AGENT_EMOJI = [['normal', 'Normal'], ['styled', 'Stylized (matches the theme)']];
export const applyAgentEmoji = () => setAvatarStyle(pref('agentEmoji'));

export function init() {
  apply(current());
  applyAgentEmoji();
  bus.on('prefs', names => { if (names.includes('theme')) apply(current()); if (names.includes('transparency')) applyTransparency(); if (names.includes('agentEmoji')) applyAgentEmoji(); });   // the account's values arrived
  bus.on('display', k => { if (k === 'transparency') applyTransparency(); });   // (a slider being dragged, on this device)
  bus.on('auth', () => { apply(current()); applyAgentEmoji(); });                                                                     // signed in or out
}
