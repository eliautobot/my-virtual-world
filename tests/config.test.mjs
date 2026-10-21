// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Configuration (server/config.js): documented defaults, every problem reported at once, the key setting, the data
// folder, the Docker gateway rule for plain-HTTP sign-in on localhost, the log format,
// .env.example, and that only server/config.js reads the environment.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_COOKIE, DEFAULT_HQ_NAME, DEFAULT_PORT, DEFAULT_POPULATION, DEFAULT_SEED, SERVER_SETTINGS, defaultGateway, loadConfig,
} from '../server/config.js';
import { HttpPolicy } from '../server/auth/http.js';
import { createLogger, formatLine } from '../server/log.js';
import { ROOT } from './helpers/server.mjs';

// Paths are only read, never created.
const BASE = path.join(os.tmpdir(), 'mvw-config-test');
const CODE = path.join(BASE, 'code');
const KEY_FILE = path.join(BASE, 'secret.key');
const load = (env = {}, o = {}) => loadConfig({ env: { MVW_KEY_FILE: KEY_FILE, ...env }, root: CODE, ...o });
const newKey = () => crypto.randomBytes(32).toString('base64');
// Variables only compose.yaml uses (documented in .env.example next to the server's).
const COMPOSE_SETTINGS = ['MVW_IMAGE', 'MVW_PORT', 'MVW_DOMAIN', 'MVW_HTTP_PORT', 'MVW_HTTPS_PORT', 'MVW_PROXY_SUBNET', 'MVW_PROXY_RANGE', 'MVW_PROXY_IP'];

test('with only the key set, every setting has its documented default', () => {
  const { cfg, errors, warnings } = load();
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(DEFAULT_PORT, 8570);
  assert.equal(DEFAULT_HQ_NAME, 'Headquarters');
  assert.equal(cfg.port, DEFAULT_PORT);
  assert.equal(cfg.host, '0.0.0.0');
  assert.equal(cfg.data, path.join(CODE, 'data'));
  assert.equal(cfg.dataDefaulted, true);
  assert.equal(cfg.population, DEFAULT_POPULATION);
  assert.equal(cfg.seed, DEFAULT_SEED);
  assert.equal(cfg.hqName, DEFAULT_HQ_NAME);
  assert.equal(cfg.cookieName, DEFAULT_COOKIE);
  assert.equal(cfg.publicUrls, '');
  assert.equal(cfg.trustedProxies, 'none');
  assert.equal(cfg.gatewayIsLocal, false);
  assert.deepEqual(cfg.localPeers, []);
  assert.equal(cfg.keyPollMs, 2000);
  assert.equal(cfg.wsPerAddress, 20);
  assert.equal(cfg.wsMax, 1000);
  assert.deepEqual(cfg.keyEnv, { MVW_KEY_FILE: KEY_FILE });
  assert.ok(Object.isFrozen(cfg));
});

test('valid values are taken as given', () => {
  const key = newKey();
  const { cfg, errors, warnings } = loadConfig({
    root: CODE,
    env: {
      PORT: '0', HOST: '::', MVW_DATA: path.join(BASE, 'data'), MVW_POPULATION: '250', MVW_SEED: 'river-town',
      MVW_HQ_NAME: 'Civic Centre', MVW_PUBLIC_URL: 'https://world.example.org', MVW_TRUSTED_PROXIES: '127.0.0.1,::1,192.0.2.0/24',
      MVW_COOKIE_NAME: '__Host-mvw-staging', MVW_SECRET_KEY: key, MVW_KEY_POLL_MS: '100',
      MVW_WS_PER_ADDRESS: '5', MVW_WS_MAX: '50',
    },
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(cfg.port, 0);
  assert.equal(cfg.host, '::');
  assert.equal(cfg.data, path.join(BASE, 'data'));
  assert.equal(cfg.dataDefaulted, false);
  assert.equal(cfg.population, 250);
  assert.equal(cfg.seed, 'river-town');
  assert.equal(cfg.hqName, 'Civic Centre');
  assert.equal(cfg.publicUrls, 'https://world.example.org');
  assert.equal(cfg.trustedProxies, '127.0.0.1,::1,192.0.2.0/24');
  assert.equal(cfg.cookieName, '__Host-mvw-staging');
  assert.deepEqual(cfg.keyEnv, { MVW_SECRET_KEY: key });
  assert.equal(cfg.keyPollMs, 100);
  assert.equal(cfg.wsPerAddress, 5);
  assert.equal(cfg.wsMax, 50);
});

test('every problem is reported at once, each naming its setting', () => {
  const env = {
    PORT: 'eighty', HOST: 'not a host!', MVW_DATA: 'relative/data', MVW_POPULATION: '-5', MVW_SEED: 'x'.repeat(101),
    MVW_HQ_NAME: '<b>HQ</b>', MVW_PUBLIC_URL: 'not a url', MVW_TRUSTED_PROXIES: 'proxy.example', MVW_COOKIE_NAME: 'session',
    MVW_GATEWAY_IS_LOCAL: 'maybe', MVW_KEY_POLL_MS: '10',
    MVW_WS_PER_ADDRESS: '0', MVW_WS_MAX: 'lots', MVW_SECRET_KEY: 'too-short',
  };
  const { errors } = loadConfig({ env, root: CODE });
  for (const k of Object.keys(env)) {
    assert.ok(errors.some(e => e.startsWith(`${k} `) || e.startsWith(`${k}:`)), `${k} is reported:\n${errors.join('\n')}`);
  }
  assert.equal(errors.length, Object.keys(env).length, errors.join('\n'));
});

test('the key setting: exactly one of the two, a key file with an absolute path outside the data folder', () => {
  const data = path.join(BASE, 'data');
  const cases = [
    [{}, /MVW_KEY_FILE/],
    [{ MVW_KEY_FILE: 'secret.key' }, /^MVW_KEY_FILE must be an absolute path/],
    [{ MVW_KEY_FILE: path.join(data, 'secret.key') }, /^MVW_KEY_FILE \(.+\) lies inside the data folder/],
    [{ MVW_KEY_FILE: KEY_FILE, MVW_SECRET_KEY: newKey() }, /^Both MVW_SECRET_KEY and MVW_KEY_FILE are set/],
    [{ MVW_SECRET_KEY: newKey(), MVW_SECRET_KEY_PREVIOUS: 'nope' }, /^MVW_SECRET_KEY_PREVIOUS is not a 32-byte key/],
  ];
  for (const [env, re] of cases) {
    const { errors } = loadConfig({ env: { MVW_DATA: data, ...env }, root: CODE });
    assert.equal(errors.length, 1, `${Object.keys(env).join(', ') || 'no key'}: ${errors.join(' | ')}`);
    assert.match(errors[0], re);
  }
});

test('unknown MVW_ names are ignored', () => {
  const { cfg, errors, warnings } = load({ MVW_TRUSTED_PROXY: '127.0.0.1', MVW_SOMETHING: 'x' });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(cfg.trustedProxies, 'none');
});

test('the data folder: MVW_DATA when set; otherwise the code folder\'s, with a warning in a release folder', () => {
  const given = load({ MVW_DATA: path.join(BASE, 'data') });
  assert.equal(given.cfg.data, path.join(BASE, 'data'));
  assert.equal(given.cfg.dataDefaulted, false);
  assert.deepEqual(given.warnings, []);
  assert.deepEqual(load({}, { release: { channel: 'dev', tag: null } }).warnings, [], 'a development checkout');
  const rel = load({}, { release: { channel: 'release', tag: 'v2.0.0-alpha.1' } });
  assert.equal(rel.warnings.length, 1);
  assert.match(rel.warnings[0], /^MVW_DATA is not set, so the data folder is .+ inside this release's folder/);
  assert.ok(rel.warnings[0].includes(path.join(CODE, 'data')));
  assert.deepEqual(load({ MVW_DATA: path.join(BASE, 'data') }, { release: { channel: 'release', tag: 'v2.0.0-alpha.1' } }).warnings, []);
});

// /proc/net/route stores addresses as little-endian hex: 010200C0 is 192.0.2.1.
const ROUTES = [
  'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
  'eth0\t00000000\t010200C0\t0003\t0\t0\t0\t00000000\t0\t0\t0',
  'eth0\t000200C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0',
];
const TABLE = ROUTES.join('\n') + '\n', NO_DEFAULT = [ROUTES[0], ROUTES[2]].join('\n') + '\n';

test('MVW_GATEWAY_IS_LOCAL: the default gateway counts as this machine for plain-HTTP sign-in on localhost only', () => {
  assert.equal(defaultGateway(TABLE), '192.0.2.1');
  assert.equal(defaultGateway(NO_DEFAULT), null);
  assert.equal(defaultGateway(''), null);
  const g = load({ MVW_GATEWAY_IS_LOCAL: '1' }, { routeTable: TABLE });
  assert.deepEqual(g.errors, []);
  assert.equal(g.cfg.gatewayIsLocal, true);
  assert.deepEqual(g.cfg.localPeers, ['192.0.2.1']);
  const none = load({ MVW_GATEWAY_IS_LOCAL: 'true' }, { routeTable: NO_DEFAULT });
  assert.equal(none.errors.length, 1);
  assert.match(none.errors[0], /^MVW_GATEWAY_IS_LOCAL is set, but no default gateway/);
  assert.deepEqual(load({ MVW_GATEWAY_IS_LOCAL: '0' }, { routeTable: TABLE }).cfg.localPeers, []);

  const req = (peer, host, headers = {}) => ({ socket: { remoteAddress: peer }, headers: { host, ...headers } });
  const docker = new HttpPolicy({ localPeers: g.cfg.localPeers }), plain = new HttpPolicy();
  assert.equal(docker.isSecure(req('::ffff:192.0.2.1', 'localhost:8570')), true, 'the gateway, asking for localhost');
  assert.equal(docker.isSecure(req('192.0.2.1', '127.0.0.1:8570')), true);
  assert.equal(docker.isSecure(req('192.0.2.1', 'world.example:8570')), false, 'the gateway, asking for another host name');
  assert.equal(docker.isSecure(req('192.0.2.1', 'localhost:8570', { 'x-forwarded-for': '203.0.113.9' })), false, 'through a proxy');
  assert.equal(docker.isSecure(req('198.51.100.7', 'localhost:8570')), false, 'another address claiming localhost');
  assert.equal(plain.isSecure(req('192.0.2.1', 'localhost:8570')), false, 'without the setting');
  assert.equal(plain.isSecure(req('127.0.0.1', 'localhost:8570')), true, 'the loopback address, as before');
});

test('log lines read "time level [area] message", redacted, with later lines indented', () => {
  const known = new Set(['s3cr3t-value-1234']);
  const when = new Date('2026-01-02T03:04:05.000Z');
  const line = formatLine('warn', ['[secrets]', 'the value s3cr3t-value-1234 leaked', { apiToken: 'tok-9f8e7d', n: 1 }], known, when);
  assert.ok(line.startsWith('2026-01-02T03:04:05.000Z warn [secrets] the value [redacted] leaked {'), line);
  assert.ok(line.endsWith('\n'));
  assert.ok(!line.includes('s3cr3t') && !line.includes('tok-9f8e7d'), line);
  const multi = formatLine('error', ['[http] error', 'Error: boom\n    at handler (routes.js:1:2)'], null, when);
  assert.deepEqual(multi.split('\n'), ['2026-01-02T03:04:05.000Z error [http] error Error: boom', '      at handler (routes.js:1:2)', '']);

  const out = [];
  const log = createLogger({ known, out: { write: s => out.push(s) } });
  log('[boot] hello');
  log.warn('[config] careful');
  log.error('[store] failed', 's3cr3t-value-1234');
  assert.equal(log.info, log);
  assert.deepEqual(out.map(l => l.split(' ').slice(1, 3).join(' ')), ['info [boot]', 'warn [config]', 'error [store]']);
  assert.ok(!out.join('').includes('s3cr3t'));
});

test('.env.example documents every setting, with comments on their own lines', () => {
  const text = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const named = new Set([...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1]));
  for (const k of SERVER_SETTINGS) assert.ok(named.has(k), `${k} is in .env.example`);
  for (const k of named) assert.ok(SERVER_SETTINGS.includes(k) || COMPOSE_SETTINGS.includes(k), `${k} in .env.example is a known setting`);
  for (const k of ['PRESENCE_URL', 'MVW_PRESENCE_URL', 'MVW_EDITION', 'MVW_STRIPE_API', 'MVW_OAUTH_TEST']) assert.ok(!named.has(k), `${k} is not offered (the online platform's)`);
  for (const l of text.split('\n')) {
    if (l.trim() && !l.startsWith('#')) assert.match(l, /^[A-Z][A-Z0-9_]*=\S*$/, `a comment after a value (systemd reads it as part of the value): ${l}`);
  }
});

test('in server/, only config.js reads the environment', () => {
  const files = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.m?js$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'server'));
  assert.ok(files.length > 10);
  for (const f of files) {
    if (f === path.join(ROOT, 'server', 'config.js')) continue;
    const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(src, /process\.env\s*(\.|\[)/, `${path.relative(ROOT, f)} reads process.env; read settings in server/config.js`);
  }
});
