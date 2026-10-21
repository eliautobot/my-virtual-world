/* My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
   From My Virtual World (release 1): src/client/js/home-location.mjs, copied unchanged (WP1.9, G8 extras).
   Pin: the classic release's working tree as reviewed on 2026-09-26 · sha256 (this file's body, without this header)
   8a0815d54922e344dd6221a8d568e5b135cb79178a069e7f732fd1aa3abdb942
   Licence: part of My Virtual World, the PolyForm Noncommercial License 1.0.0 (see LICENSE at the repository's root); the brand is reserved. The header is the only
   addition (IMPORTS.md allows a provenance header and stripped import paths). Next's own half of the home view —
   the camera envelope that adds the tilt — lives beside it in client/js/core/home-frame.js. */
/* Home location — the camera frame that "Reset View (Home)" returns to, and the
   account value behind "Set home to current view".

   Contract (wave 2, §4):
     - `#btn-zoomReset` returns the camera to the account's home frame:
       `flyCameraTo(homePosition, homeDistance)`.
     - Home defaults to {x:0, y:0, z:0, distance:40, angle:π/4} — the engine's own
       starting frame — and a user can define their own.
     - Home persists with the account through the existing settings path. No
       value is hardcoded twice: this module is the single definition of the
       default and of the shape that is read and written.

   The write path is `POST /api/settings` with a `world.home` patch. `world.*` is
   the server's tier-0 preference section, so storing your own home never needs
   an administrator (see `classify_path` in `src/server/accounts.py`). */

export const HOME_DEFAULTS = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  distance: 40,
  angle: Math.PI / 4,
});

/* Where a home may already live in the public config, most specific first. The
   account-scoped entry wins when the server offers one; `world.home` is the
   path this module writes. */
export const HOME_CONFIG_PATHS = Object.freeze([
  Object.freeze(['account', 'home']),
  Object.freeze(['world', 'home']),
  Object.freeze(['home']),
]);

export const HOME_WRITE_SECTION = 'world';
export const SETTINGS_ENDPOINT = '/api/settings';
export const HOME_PRECISION = 4;
export const HOME_DISTANCE_RANGE = Object.freeze({min: 4.5, max: 120});

const finite = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const round = (value) => {
  const factor = 10 ** HOME_PRECISION;
  return Math.round(value * factor) / factor;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const TAU = Math.PI * 2;

/* Keep the angle inside one turn so two equal frames compare equal. */
export function normalizeHomeAngle(value) {
  const angle = finite(value, HOME_DEFAULTS.angle);
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/* Accepts anything (missing, partial, hostile) and always returns a usable home. */
export function normalizeHome(home) {
  const source = home && typeof home === 'object' ? home : {};
  return {
    x: round(finite(source.x, HOME_DEFAULTS.x)),
    y: round(finite(source.y, HOME_DEFAULTS.y)),
    z: round(finite(source.z, HOME_DEFAULTS.z)),
    distance: round(clamp(
      finite(source.distance, HOME_DEFAULTS.distance),
      HOME_DISTANCE_RANGE.min,
      HOME_DISTANCE_RANGE.max,
    )),
    // The angle keeps full precision: it is a radian measure the camera compares
    // directly, and the documented default is exactly π/4.
    angle: normalizeHomeAngle(finite(source.angle, HOME_DEFAULTS.angle)),
  };
}

function lookup(config, path) {
  let node = config;
  for (const part of path) {
    if (!node || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

const HOME_KEYS = Object.freeze(Object.keys(HOME_DEFAULTS));

/* A stored home counts as one when it carries at least one usable number. A
   half-written value (a coordinate but no distance, say) is still the person's
   home; it is normalized rather than discarded. */
export function isHomeConfigured(home) {
  if (!home || typeof home !== 'object' || Array.isArray(home)) return false;
  return HOME_KEYS.some(key => key in home && Number.isFinite(Number(home[key])));
}

/* Read the account's home out of a public config object (`/vw-config`), falling
   back to the engine default when nothing has been stored yet. */
export function readHomeLocation(config) {
  for (const path of HOME_CONFIG_PATHS) {
    const candidate = lookup(config, path);
    if (isHomeConfigured(candidate)) return normalizeHome(candidate);
  }
  return normalizeHome(HOME_DEFAULTS);
}

export function sameHome(a, b) {
  const left = normalizeHome(a);
  const right = normalizeHome(b);
  return Object.keys(HOME_DEFAULTS).every(key => left[key] === right[key]);
}

/* The patch this module writes: never a whole-section overwrite. */
export function homeSettingsPatch(home) {
  return {[HOME_WRITE_SECTION]: {home: normalizeHome(home)}};
}

/* "Set home to current view" reads the live camera frame. */
export function homeFromCameraFrame(frame = {}) {
  const target = frame && typeof frame.target === 'object' && frame.target ? frame.target : {};
  return normalizeHome({
    x: target.x,
    y: target.y,
    z: target.z,
    distance: frame.distance,
    angle: frame.angle,
  });
}

export function describeHome(home) {
  const value = normalizeHome(home);
  return `${value.x}, ${value.z} · ${value.distance} away`;
}

/* Persist through the existing settings route with the session's CSRF token.
   Never throws: a World whose settings route is unavailable keeps its in-memory
   home instead of breaking the edit panel. */
export async function saveHomeLocation(home, {fetch: fetcher, csrf = ''} = {}) {
  const send = fetcher || globalThis.fetch?.bind(globalThis);
  const value = normalizeHome(home);
  if (typeof send !== 'function') return {ok: false, code: 'no_transport', home: value};
  const headers = {'Content-Type': 'application/json', Accept: 'application/json'};
  if (csrf) headers['X-World-CSRF'] = csrf;
  try {
    const response = await send(SETTINGS_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      body: JSON.stringify(homeSettingsPatch(value)),
    });
    const result = await response.json?.().catch?.(() => null) ?? null;
    if (!response.ok || result?.ok !== true) {
      return {ok: false, status: response.status, code: result?.code || result?.error?.code || '', home: value};
    }
    return {ok: true, home: value, result};
  } catch (error) {
    return {ok: false, code: 'settings_unavailable', error: String(error?.message || error), home: value};
  }
}

/* The one object the World uses: holds the home, resets to it, and records the
   current view as the new home. Every dependency is injectable so the behaviour
   is testable without a renderer. */
export function createHomeController({
  config = () => globalThis.window?.__VWConfig,
  getCameraFrame,
  applyHome,
  save = saveHomeLocation,
  csrf = () => '',
  onChange,
  fetcher,
} = {}) {
  let home = readHomeLocation(typeof config === 'function' ? config() : config);
  let saving = null;

  const publish = () => { if (typeof onChange === 'function') onChange({...home}); };

  return {
    get home() {
      return {...home};
    },
    /* Re-read from the current config (after Settings saved, for example). */
    refresh(nextConfig) {
      const source = nextConfig !== undefined
        ? nextConfig
        : (typeof config === 'function' ? config() : config);
      home = readHomeLocation(source);
      publish();
      return {...home};
    },
    /* `#btn-zoomReset` and the edit panel's "Go to home". */
    reset() {
      if (typeof applyHome === 'function') applyHome({...home});
      return {...home};
    },
    /* "Set home to current view" under the edit-panel settings. */
    async setFromCurrentView(frame) {
      const current = frame !== undefined
        ? frame
        : (typeof getCameraFrame === 'function' ? getCameraFrame() : {});
      home = homeFromCameraFrame(current);
      publish();
      const token = typeof csrf === 'function' ? await csrf() : csrf;
      saving = save(home, {csrf: token || '', fetcher});
      const result = await saving;
      saving = null;
      return {home: {...home}, result};
    },
    isSaving() {
      return saving !== null;
    },
    describe() {
      return describeHome(home);
    },
  };
}
