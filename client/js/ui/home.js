// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Home View panel in the info dock (PLAN WP1.9, DECISIONS C44, C117).
// - Everyone can go to their home view, and the camera starts there (main.js). A signed-in account sets and keeps its own,
//   which follows the account to every device and is changed at any time. Without one: the installation's default
//   (admins set it), else a view over the whole city (2026-10-09: not the headquarters).
// - The frame itself is the classic release's home-location.mjs, copied unchanged (X5): position, distance and angle, distance between
//   4.5 and 120, values rounded to four decimals, and its documented default when nothing is stored anywhere.
//   core/home-frame.js adds the one thing Next's camera has that the module does not — the tilt.
// - Setting the world default is an installation setting (tier 2, so the server asks for the password again, as for
//   every other installation-wide change); the panel writes it through /api/settings and reports what the server says.
import { S, bus, viewGrid } from '../core/state.js';
import { h, esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { pref, setPref } from '../core/prefs.js';
import { readEnvelope, writeEnvelope, frameFromCamera, applyFrame, worldEnvelope, worldValue, homeEnvelope } from '../core/home-frame.js';
import { post } from '../core/net.js';

let app = null;
const E = {};

export function init(a) {
  app = a;
  const slot = a.docks && a.docks.slot('r:home');
  if (!slot) return;
  slot.appendChild(h(`<div class="home">
    <div class="home-actions">
      <button type="button" class="btn primary go">⌂ Go to home view</button>
      <button type="button" class="btn set">📌 Set home to current view</button>
      <button type="button" class="btn def hidden">🏛️ Set as the world default</button>
      <button type="button" class="btn spawn hidden" title="Where new players appear, and anyone whose last spot is no longer valid">🚩 Make this the spawn point</button>
    </div>
    <p class="hint status"></p>
    <p class="hint note"></p></div>`));
  E.go = slot.querySelector('.go'); E.set = slot.querySelector('.set'); E.def = slot.querySelector('.def');
  E.status = slot.querySelector('.status'); E.note = slot.querySelector('.note');
  E.spawn = slot.querySelector('.spawn');
  E.spawn.onclick = setSpawn;
  E.go.onclick = goHome;
  E.set.onclick = setMine;
  E.def.onclick = setWorldDefault;
  bus.on('world', refresh);
  // the account's stored home arrived and differs from this device's copy: the camera goes there, unless it was moved meanwhile
  bus.on('prefs', names => { if (names.includes('home')) { refresh(); if (unmoved() && mine()) applyFrame(app.cam, mine()); } });
  bus.on('auth', refresh);
  app.home = { go: goHome };   // ⌂ and the Home key (ui.js)
  refresh();
  // (the account's preferences may have arrived before this panel: a home this device had no copy of yet goes in force now)
  if (unmoved() && mine()) applyFrame(app.cam, mine());
}
/** Whether the camera is still where it started (main.js app.startView). */
const unmoved = () => { const s = app.startView, c = app.cam; return !!(s && c && Math.hypot(c.goal.x - s.x, c.goal.z - s.z) < 1 && Math.abs(c.goalDist - s.d) < 1); };

/** This account's own home (null when it has none): the envelope in the preference. */
const mine = () => readEnvelope(pref('home'));
/** The installation's default home (null when no admin has set one): sent with the world. */
const worldDefault = () => worldEnvelope(S.world && S.world.home);
/** The home in force: this account's, then the installation's, then the view over the whole city. */
const effective = () => homeEnvelope({ own: mine(), world: S.world && S.world.home, grid: viewGrid(S.world), cam: app.cam });

function refresh() {
  if (!E.status) return;
  const own = mine(), world = worldDefault(), canSet = !!(auth.account && auth.can('account.self'));
  E.set.classList.toggle('hidden', !canSet);
  E.def.classList.toggle('hidden', !auth.can('settings.world'));
  E.spawn.classList.toggle('hidden', !auth.can('players.spawn'));
  E.go.disabled = false;
  if (own) E.status.textContent = 'Your home view is set: you start there, and ⌂ takes you back to it.';
  else if (world) E.status.textContent = 'You have no home view of your own yet: you start at the city\'s default view.';
  else E.status.textContent = 'You have no home view of your own yet: you start with a view over the whole city.';
  E.note.textContent = canSet
    ? (own ? 'Your home follows your account to every device.' : 'Set one from the view you like: it follows your account.')
    : (auth.account ? 'Ask an admin for the display permission to keep your own home.' : 'Sign in to keep a home view of your own.');
}

/** To the home view in force; quiet: no note (⌂ and the Home key). */
function goHome(quiet = false) {
  const env = effective();
  if (!env || !applyFrame(app.cam, env)) return app.toast('No home view yet', 'bad', 2000);
  if (!quiet) app.toast(mine() ? 'Your home view' : worldDefault() ? 'The city\'s home view' : 'The whole city', '', 2200);
  if (S.mode === 'play' && app.setMode) app.setMode('explore');
  refresh();
}

function setMine() {
  const env = frameFromCamera(app.cam);
  setPref('home', writeEnvelope(env));   // follows the account; a guest's stays in this browser
  refresh();
  app.toast('Home view set: you start here from now on.', 'good', 2600);
}

/** The spawn point (WP1.10, I14.12): where the camera looks, as an installation setting (asks for the password). */
async function setSpawn() {
  const t = app.cam.goal, spot = { x: Math.round(t.x * 100) / 100, z: Math.round(t.z * 100) / 100 };
  E.spawn.disabled = true;
  try {
    await post('/api/settings', { values: { 'players.spawn': JSON.stringify(spot) } });
    app.toast(`New players now appear at ${Math.round(spot.x)}, ${Math.round(spot.z)} (the nearest open ground)`, 'good', 3200);
  } catch (err) {
    if (!err.quiet) app.toast(err.message || String(err), 'bad', 6000);
  } finally { E.spawn.disabled = false; }
}
async function setWorldDefault() {
  const env = frameFromCamera(app.cam);
  E.def.disabled = true;
  try {
    await post('/api/settings', { values: { 'world.home': JSON.stringify(worldValue(env)) } });
    app.toast('The city\'s default home view is set: accounts without their own start here.', 'good', 2800);
  } catch (err) {
    if (!err.quiet) app.toast(err.message || String(err), 'bad', 6000);
  } finally {
    E.def.disabled = false;
    refresh();
  }
}
