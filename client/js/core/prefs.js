// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Display preferences (DECISIONS C91, C96, C100): name labels, interior walls, the people list folded away, whether the
// controls tip was shown, which docks are open (a small JSON value, C112), how the team list is sorted and which places
// are favourites (C115) and which theme (C39, C117) — three token sets in client/css/theme.css. Guests keep them in the browser. A signed-in account keeps them on the server, so they
// follow it to every device; at the account's first sign-in on a device, every preference it has not stored yet takes
// the device's current choice. Graphics quality stays with each device (ui.js). They are tier 0: no password entry.
// Emits bus 'prefs' (names) when the account's values replace the device's.
import { S, bus } from './state.js';
import { auth } from './auth.js';
import { SOUND_DEFAULTS } from '/shared/sound-defaults.js';

const local = {
  get: k => localStorage.getItem(k),
  set: (k, v) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); },
};
/** A volume preference (0–100 %, in steps of 5) kept on the device and with the account; bus 'sound' when it changes. */
const clampVol = v => { const n = Math.round(Number(v) / 5) * 5; return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100; };
const OLD_WORLD = { off: 0, quiet: 35, normal: 70, loud: 100 };
function vol(key, dflt) {
  return { path: `sound.${key}`, get: () => { const v = local.get(`mvw.vol.${key}`); return v === null ? (typeof dflt === 'function' ? dflt() : dflt) : clampVol(v); },
    apply: v => { local.set(`mvw.vol.${key}`, String(clampVol(v))); bus.emit('sound', key); } };
}
const PREFS = {
  theme: { path: 'display.theme', get: () => local.get('mw.theme') || 'dark', apply: v => local.set('mw.theme', v && v !== 'dark' ? v : null) },
  // agents' and residents' own emoji: as emoji (normal) or drawn in the theme's icon style (styled) — core/icons.js
  agentEmoji: { path: 'display.agentEmoji', get: () => local.get('mvw.agentEmoji') || 'normal', apply: v => local.set('mvw.agentEmoji', v === 'styled' ? 'styled' : null) },
  labels: { path: 'display.labels', get: () => S.labels, apply: v => { S.labels = !!v; local.set('mvw.labels', v ? '1' : '0'); } },
  walls: { path: 'display.walls', get: () => S.walls, apply: v => { S.walls = v; local.set('mvw.walls', v); } },
  rosterFolded: { path: 'display.rosterFolded', get: () => local.get('mvw.roster') === '0', apply: v => local.set('mvw.roster', v ? '0' : '1') },
  seenHelp: { path: 'display.seenHelp', get: () => !!local.get('mvw.seenHelp'), apply: v => local.set('mvw.seenHelp', v ? '1' : null) },
  // the home view: each account's own, kept on this device under that account (a guest's under its own key) — another
  // account's home on a shared device is never this account's (2026-10-09: "every user account has their own home")
  home: { path: 'display.home', get: () => local.get(homeKey()) || '', apply: v => local.set(homeKey(), v || null) },
  docks: { path: 'display.docks', get: () => local.get('mvw.docks') || '', apply: v => local.set('mvw.docks', v || null) },
  teamSort: { path: 'display.teamSort', get: () => local.get('mvw.teamSort') || 'world', apply: v => local.set('mvw.teamSort', v && v !== 'world' ? v : null) },
  // the team list: your own agents (mine) or the public ones, anyone's that anyone may talk with (ui.js)
  teamView: { path: 'display.teamView', get: () => local.get('mvw.teamView') || 'mine', apply: v => local.set('mvw.teamView', v === 'public' ? 'public' : null) },
  // the selection widget across the top (ui.js): 'auto' opens it when something is selected and folds it when nothing is;
  // 'open' / 'closed' keep it as the person left it (Manual)
  selectionWidget: { path: 'display.selectionWidget', get: () => local.get('mvw.selWidget') || 'auto', apply: v => local.set('mvw.selWidget', v === 'open' || v === 'closed' ? v : null) },
  // how see-through windows, panels and buttons are: 0 (solid) to 60 % (core/theme.js; High contrast stays solid)
  transparency: { path: 'display.transparency', get: () => Number(local.get('mvw.transparency')) || 0, apply: v => { local.set('mvw.transparency', Number(v) > 0 ? String(Number(v)) : null); bus.emit('display', 'transparency'); } },
  favourites: { path: 'display.favourites', get: () => local.get('mvw.favs') || '', apply: v => local.set('mvw.favs', v || null) },
  sound: { path: 'display.sound', get: () => local.get('mvw.sound') || 'normal', apply: v => { local.set('mvw.sound', v && v !== 'normal' ? v : null); bus.emit('sound', v || 'normal'); } },
  // Sound (Settings → Sound; audio/mixer.js): a master volume and one per kind of sound, 0–100 %. (The world's starts from
  // the old Ambient sound on a device that had one.) The defaults: shared/sound-defaults.js (Settings → Sound → Reset).
  volMaster: vol('master', SOUND_DEFAULTS.master),
  volWorld: vol('world', () => OLD_WORLD[local.get('mvw.sound')] ?? SOUND_DEFAULTS.world),
  volAircraft: vol('aircraft', SOUND_DEFAULTS.aircraft),
  volVoices: vol('voices', SOUND_DEFAULTS.voices),
  volMedia: vol('media', SOUND_DEFAULTS.media),
  volMusic: vol('music', SOUND_DEFAULTS.music),
  volScore: vol('score', SOUND_DEFAULTS.score),
  volEffects: vol('effects', SOUND_DEFAULTS.effects),
  volVehicles: vol('vehicles', SOUND_DEFAULTS.vehicles),
  volRadio: vol('radio', SOUND_DEFAULTS.radio),
  // the living world's off switches and levels (spec §7.1 X8)
  wildlife: { path: 'display.wildlife', get: () => local.get('mvw.wildlife') || 'normal', apply: v => { local.set('mvw.wildlife', v && v !== 'normal' ? v : null); bus.emit('display', 'wildlife'); } },
  weatherFx: { path: 'display.weatherFx', get: () => local.get('mvw.weatherFx') || 'on', apply: v => { local.set('mvw.weatherFx', v && v !== 'on' ? v : null); bus.emit('display', 'weatherFx'); } },
  traffic: { path: 'display.traffic', get: () => local.get('mvw.traffic') || 'normal', apply: v => { local.set('mvw.traffic', v && v !== 'normal' ? v : null); bus.emit('display', 'traffic'); } },
  promoAircraft: { path: 'display.promoAircraft', get: () => local.get('mvw.promoAircraft') || 'on', apply: v => { local.set('mvw.promoAircraft', v && v !== 'on' ? v : null); bus.emit('display', 'promoAircraft'); } },
  vehicleDetail: { path: 'display.vehicleDetail', get: () => local.get('mvw.vehicleDetail') || 'normal', apply: v => { local.set('mvw.vehicleDetail', v && v !== 'normal' ? v : null); bus.emit('display', 'vehicleDetail'); } },
};
let syncedFor = null, syncing = null;
const homeKey = () => (auth.account ? `mw.home.${auth.account.id}` : 'mw.home');

/** A preference's current value on this device. */
export const pref = name => PREFS[name].get();
/** Shows a preference on this device without saving it (a slider being dragged); setPref when it is let go. */
export const previewPref = (name, value) => PREFS[name].apply(value);
/** Changes a preference on this device and, when signed in, for the account. */
export function setPref(name, value) {
  const d = PREFS[name];
  d.apply(value);
  if (auth.account && syncedFor === auth.account.id) save({ [d.path]: value });
}
/** Changes several preferences at once (Settings → Sound → Reset): on this device and, signed in, in one save. */
export function setPrefs(map) {
  const values = {};
  for (const [name, value] of Object.entries(map)) { const d = PREFS[name]; d.apply(value); values[d.path] = value; }
  if (auth.account && syncedFor === auth.account.id) save(values);
}
function save(values) {
  auth.call('/api/account/settings', { values }).catch(err => console.warn('[prefs] not saved:', err.message));
}
/** Takes the account's stored preferences; the ones it has not stored yet take this device's choice (C96). */
async function sync() {
  const id = auth.account.id;
  if (syncing === id) return;
  syncing = id;
  try {
    const r = await fetch('/api/account/settings', { cache: 'no-store' });
    if (!r.ok || !auth.account || auth.account.id !== id) return;
    const rows = new Map((await r.json()).settings.map(x => [x.path, x]));
    const changed = [], missing = {};
    for (const [name, d] of Object.entries(PREFS)) {
      const row = rows.get(d.path);
      if (!row) continue;
      if (!row.stored) missing[d.path] = d.get();
      else if (row.value !== d.get()) { d.apply(row.value); changed.push(name); }
    }
    syncedFor = id;
    if (Object.keys(missing).length) save(missing);
    if (changed.length) bus.emit('prefs', changed);
  } catch (err) {
    console.warn('[prefs] could not load the account\'s preferences:', err.message);
  } finally {
    if (syncing === id) syncing = null;
  }
}
const wanted = me => !!(me && me.account && me.caps && me.caps['account.self'] && syncedFor !== me.account.id);

export async function init() {
  bus.on('auth', me => {
    if (!me || !me.account) { syncedFor = null; return; }
    if (wanted(me)) sync();
  });
  if (wanted(auth.me)) await sync();
}
