// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Configuration of an installation (PLAN WP1.6; DECISIONS C102, C105). Every setting comes from an environment
// variable and is checked at start, and every problem is reported at once, so a broken configuration is fixed in one
// pass. Only this module reads process.env in server/. .env.example lists every setting; no .env file is read (C102).
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { HttpPolicy } from './auth/http.js';
import { KeyConfigError, keySource, parseKey } from './secrets.js';

export const DEFAULT_PORT = 8570;
export const DEFAULT_SEED = 'next-city';
export const DEFAULT_HQ_NAME = 'Headquarters';
export const DEFAULT_COOKIE = '__Host-mvw-session';
export const DEFAULT_POPULATION = 1000;

/** Every setting the server reads (.env.example documents each one; tests/config.test.mjs checks that). */
export const SERVER_SETTINGS = Object.freeze([
  'PORT', 'HOST', 'MVW_DATA', 'MVW_POPULATION', 'MVW_SEED', 'MVW_HQ_NAME', 'MVW_PUBLIC_URL', 'MVW_TRUSTED_PROXIES',
  'MVW_COOKIE_NAME', 'MVW_KEY_FILE', 'MVW_SECRET_KEY', 'MVW_SECRET_KEY_PREVIOUS', 'MVW_KEY_POLL_MS',
  'MVW_WS_PER_ADDRESS', 'MVW_WS_MAX', 'MVW_PROVIDER_MEDIA_CACHE_MB', 'MVW_GATEWAY_IS_LOCAL',
  'MVW_PROVIDER_TEST', 'MVW_PROVIDER_RUN_TIMEOUT_MS', 'MVW_TWILIO_TEST_URL', 'MVW_PROBLEM_SCAN_MS', 'MVW_CHROME', 'MVW_HOUSING', 'MVW_STARTER_MAP',
]);
/** Older names that still work, with a warning (C102): none at present. */
export const LEGACY_SETTINGS = Object.freeze({});
const KEY_SETTINGS = ['MVW_KEY_FILE', 'MVW_SECRET_KEY', 'MVW_SECRET_KEY_PREVIOUS'];

const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const COOKIE_RE = /^__Host-[A-Za-z0-9_.-]{1,64}$/;
const shorten = v => { const s = String(v); return s.length > 60 ? `${s.slice(0, 57)}…` : s; };

/** The IPv4 default gateway in a Linux routing table (the text of /proc/net/route), or null. */
export function defaultGateway(table) {
  for (const line of String(table || '').split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 4 || f[1] !== '00000000' || !/^[0-9A-Fa-f]{8}$/.test(f[2])) continue;
    const flags = parseInt(f[3], 16);
    if (!(flags & 0x1) || !(flags & 0x2)) continue;                         // RTF_UP and RTF_GATEWAY
    const ip = [6, 4, 2, 0].map(i => parseInt(f[2].slice(i, i + 2), 16)).join('.');   // stored little-endian
    if (ip !== '0.0.0.0') return ip;
  }
  return null;
}

/**
 * Reads and checks the configuration.
 * @param {object} [o]
 * @param {object} [o.env]         the environment (default: process.env)
 * @param {string} o.root          the code folder (the default data folder lies inside it)
 * @param {object} [o.release]     readRelease().release: in a release folder a missing MVW_DATA is warned about
 * @param {string} [o.routeTable]  routing-table text instead of /proc/net/route (tests)
 * @returns {{ cfg: object, errors: string[], warnings: string[] }}
 */
export function loadConfig({ env = process.env, root, release = null, routeTable = null } = {}) {
  const errors = [], warnings = [];
  const raw = k => (env[k] === undefined || env[k] === null ? undefined : String(env[k]).trim());
  const given = k => { const v = raw(k); return v !== undefined && v !== ''; };
  const int = (k, def, min, max) => {
    if (!given(k)) return def;
    const v = raw(k);
    if (!/^\d{1,10}$/.test(v) || +v < min || +v > max) {
      errors.push(`${k} must be a whole number from ${min} to ${max}, not "${shorten(v)}"`);
      return def;
    }
    return +v;
  };
  const text = (k, def, max) => {
    if (!given(k)) return def;
    const v = raw(k);
    if (v.length > max || /[\u0000-\u001f\u007f<>]/.test(v)) {
      errors.push(`${k} must be at most ${max} characters, without control characters or < >`);
      return def;
    }
    return v;
  };
  const bool = k => {
    if (!given(k)) return false;
    const v = raw(k).toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
    errors.push(`${k} must be 1 or 0 (true or false), not "${shorten(v)}"`);
    return false;
  };

  const cfg = {};
  cfg.port = int('PORT', DEFAULT_PORT, 0, 65535);
  cfg.host = '0.0.0.0';
  if (given('HOST')) {
    const h = raw('HOST');
    if (net.isIP(h) || HOST_RE.test(h)) cfg.host = h;
    else errors.push(`HOST must be an IP address or a host name, not "${shorten(h)}"`);
  }

  // The data folder: world files and the accounts database.
  if (given('MVW_DATA')) {
    const d = raw('MVW_DATA');
    if (!path.isAbsolute(d)) {
      errors.push(`MVW_DATA must be an absolute path, not "${shorten(d)}": a relative path depends on the folder each program `
        + 'starts in, so the server and the host tools would use different folders');
    }
    cfg.data = path.resolve(d);
    cfg.dataDefaulted = false;
  } else {
    cfg.data = path.join(root, 'data');
    cfg.dataDefaulted = true;
    if (release && release.channel === 'release') {
      warnings.push(`MVW_DATA is not set, so the data folder is ${cfg.data}, inside this release's folder, which later promotions `
        + 'delete. Set MVW_DATA to a folder outside the release folders.');
    }
  }

  // How big a generated city is built (its housing). How many live in it is its homes' business (server/sim/housing.js:
  // Settings → Residents → Homes filled) — unless MVW_HOUSING=off: then the first start makes exactly MVW_POPULATION
  // residents and the number stays as it is (no one moves in or away by themselves; the tests use that).
  cfg.population = int('MVW_POPULATION', DEFAULT_POPULATION, 1, 20000);
  cfg.housing = !/^(0|off|false|no)$/i.test(String(raw('MVW_HOUSING') ?? '').trim());
  // A new world opens with the starting map built for new installations (server/world/starter.js); off: a generated city
  // of MVW_POPULATION's size and MVW_SEED (the tests use that).
  cfg.starterMap = !/^(0|off|false|no)$/i.test(String(raw('MVW_STARTER_MAP') ?? '').trim());
  // Tests only (WP2.2): load the mock agent provider into the provider helper, and shorten how long a run submission may go unanswered.
  cfg.providerTest = bool('MVW_PROVIDER_TEST');
  cfg.providerRunTimeoutMs = int('MVW_PROVIDER_RUN_TIMEOUT_MS', 0, 0, 600000);
  // (tests only, with MVW_PROVIDER_TEST: the Twilio adapter talks to a fake Twilio on this machine — tests/helpers/fake-twilio.mjs)
  cfg.twilioTestUrl = cfg.providerTest && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(raw('MVW_TWILIO_TEST_URL') || '') ? raw('MVW_TWILIO_TEST_URL') : null;
  cfg.seed = text('MVW_SEED', DEFAULT_SEED, 100);
  cfg.hqName = text('MVW_HQ_NAME', DEFAULT_HQ_NAME, 28);   // the rooftop sign holds 28 characters

  // Addresses, proxies and the same-machine sign-in rule.
  cfg.publicUrls = raw('MVW_PUBLIC_URL') || '';
  cfg.trustedProxies = raw('MVW_TRUSTED_PROXIES') || 'none';
  try { new HttpPolicy({ publicUrls: cfg.publicUrls }); } catch (e) { errors.push(e.message); }
  try { new HttpPolicy({ trustedProxies: cfg.trustedProxies }); } catch (e) { errors.push(e.message); }
  // The Docker image (C105): connections from the container's default gateway count as coming from this machine for
  // plain-HTTP sign-in, and still only when the browser asked for localhost and no proxy header is present.
  cfg.gatewayIsLocal = bool('MVW_GATEWAY_IS_LOCAL');
  cfg.localPeers = [];
  if (cfg.gatewayIsLocal) {
    let table = routeTable;
    if (table === null) { try { table = fs.readFileSync('/proc/net/route', 'utf8'); } catch { table = ''; } }
    const gw = defaultGateway(table);
    if (gw) cfg.localPeers.push(gw);
    else errors.push('MVW_GATEWAY_IS_LOCAL is set, but no default gateway was found in /proc/net/route (the setting is meant for the Docker image)');
  }
  cfg.cookieName = raw('MVW_COOKIE_NAME') || DEFAULT_COOKIE;
  if (!COOKIE_RE.test(cfg.cookieName)) {
    errors.push(`MVW_COOKIE_NAME must start with __Host- and use only letters, digits, dot, dash or underscore, not "${shorten(cfg.cookieName)}"`);
  }

  // The key for stored secrets (server/secrets.js loads it; checked here too, so every problem is listed at once).
  cfg.keyEnv = {};
  for (const k of KEY_SETTINGS) if (env[k] !== undefined) cfg.keyEnv[k] = String(env[k]);
  try {
    if (keySource(cfg.keyEnv, cfg.data).source === 'env') {
      parseKey(cfg.keyEnv.MVW_SECRET_KEY, 'MVW_SECRET_KEY');
      if (String(cfg.keyEnv.MVW_SECRET_KEY_PREVIOUS || '').trim()) parseKey(cfg.keyEnv.MVW_SECRET_KEY_PREVIOUS, 'MVW_SECRET_KEY_PREVIOUS');
    }
  } catch (e) {
    if (!(e instanceof KeyConfigError)) throw e;
    errors.push(e.message);
  }
  cfg.keyPollMs = int('MVW_KEY_POLL_MS', 2000, 50, 3600000);

  // How often the agents' lives are looked at for problems (rent, money, home, job: server/mind/problems.js).
  cfg.problemScanMs = int('MVW_PROBLEM_SCAN_MS', 15000, 200, 3600000);
  // the agents' built-in real browser (server/pc/chrome.js): the Chrome it runs — a path, or "off" (the reader only); unset:
  // the one installed on this machine
  cfg.chrome = text('MVW_CHROME', '', 500);

  // Live-stream connections per client address and in total (DECISIONS C71).
  cfg.wsPerAddress = int('MVW_WS_PER_ADDRESS', 20, 1, 100000);
  cfg.wsMax = int('MVW_WS_MAX', 1000, 1, 1000000);
  // how much of the media of agent providers' answers is kept on disk (Agent Providers: images, video an agent attached)
  cfg.providerMediaCacheMb = int('MVW_PROVIDER_MEDIA_CACHE_MB', 1024, 16, 1048576);
  return { cfg: Object.freeze(cfg), errors, warnings };
}
