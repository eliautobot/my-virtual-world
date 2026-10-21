// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The home view (PLAN WP1.9, DECISIONS C44, C117). The module itself is the classic release's home-location.mjs, copied unchanged
// (X5: sha256 8a0815d54922e344…, docs/parity/IMPORTS.md): the frame is position, distance and angle, the distance stays
// between 4.5 and 120, the values are rounded to four decimals, and the default is the documented one — no value is
// invented here. These tests are its own (the classic release's tests/test_home_reset.mjs, kept), plus the two checks that belong to
// Next: the camera envelope that carries Next's tilt alongside the reused frame, and the dock panel that offers the two
// actions.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  HOME_DEFAULTS, HOME_DISTANCE_RANGE, HOME_WRITE_SECTION, SETTINGS_ENDPOINT, createHomeController, describeHome,
  homeFromCameraFrame, homeSettingsPatch, normalizeHome, readHomeLocation, sameHome, saveHomeLocation,
} from '../../client/js/vendor-classic/g8-extras/home-location.mjs';
import { readEnvelope, writeEnvelope, frameFromCamera, applyFrame } from '../../client/js/core/home-frame.js';
import crypto from 'node:crypto';

const defaultHome = { ...HOME_DEFAULTS };
const source = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('the copied module is the pinned one: its body, without the provenance header, hashes to the import record (X5)', () => {
  const text = fs.readFileSync(new URL('../../client/js/vendor-classic/g8-extras/home-location.mjs', import.meta.url), 'utf8');
  assert.ok(text.startsWith('/*'), 'the file opens with its provenance header');
  const end = text.indexOf('*/') + 2;
  const body = Buffer.from(text.slice(end).replace(/^\n/, ''), 'utf8');
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), '8a0815d54922e344dd6221a8d568e5b135cb79178a069e7f732fd1aa3abdb942',
    'the body is the classic file at its pin, unchanged');
  assert.match(text.slice(0, end), /PolyForm Noncommercial License 1.0.0/, 'the header names the licence');
});

test('the default home is the documented frame and no value is invented', () => {
  assert.deepEqual(defaultHome, { x: 0, y: 0, z: 0, distance: 40, angle: Math.PI / 4 });
  assert.deepEqual(normalizeHome(undefined), defaultHome);
  assert.deepEqual(normalizeHome({}), defaultHome);
  assert.deepEqual(readHomeLocation({}), defaultHome);
  assert.deepEqual(readHomeLocation(null), defaultHome);
});

test('an unset home reads as the default, a stored one reads back exactly', () => {
  const stored = { x: 12.5, y: 0, z: -8.25, distance: 22, angle: 1.5 };
  assert.ok(sameHome(readHomeLocation({ world: { home: stored } }), stored));
  // The account-scoped entry wins over the install-wide one.
  assert.equal(readHomeLocation({ account: { home: { x: 3, distance: 12 } }, world: { home: stored } }).x, 3);
  // A partial or hostile value is normalized rather than trusted.
  const normalized = readHomeLocation({ world: { home: { x: '4.56789', distance: 'nope', angle: -1 } } });
  assert.equal(normalized.x, 4.5679);
  assert.equal(normalized.distance, HOME_DEFAULTS.distance);
  assert.ok(normalized.angle >= 0 && normalized.angle < Math.PI * 2);
});

test('distance stays inside the camera engine range', () => {
  assert.equal(normalizeHome({ distance: 1 }).distance, HOME_DISTANCE_RANGE.min);
  assert.equal(normalizeHome({ distance: 10_000 }).distance, HOME_DISTANCE_RANGE.max);
});

test('setting home from the current view records exactly what the camera showed', () => {
  const frame = { target: { x: 10, y: 0, z: 20 }, distance: 33.5, angle: 0.75 };
  assert.deepEqual(homeFromCameraFrame(frame), { x: 10, y: 0, z: 20, distance: 33.5, angle: 0.75 });
  assert.deepEqual(homeFromCameraFrame({}), defaultHome);
});

test('reset returns to the home that was set, and to the default when none was', async () => {
  const applied = [];
  const controller = createHomeController({
    config: {},
    getCameraFrame: () => ({ target: { x: 100, y: 0, z: -50 }, distance: 18, angle: 2 }),
    applyHome: home => applied.push({ ...home }),
    save: async home => ({ ok: true, home }),
    csrf: () => 'token',
  });
  controller.reset();
  assert.deepEqual(applied[0], defaultHome, 'nothing stored yet: reset goes to the default frame');
  const { home, result } = await controller.setFromCurrentView();
  assert.deepEqual(home, { x: 100, y: 0, z: -50, distance: 18, angle: 2 });
  assert.equal(result.ok, true);
  controller.reset();
  assert.deepEqual(applied[1], home, 'reset returns to the newly set home');
  assert.equal(controller.describe(), describeHome(home));
});

test('the home survives a settings save and is re-read from the refreshed config', () => {
  let config = { world: { home: { x: 1, z: 2, distance: 10, angle: 0 } } };
  const controller = createHomeController({ config: () => config, applyHome: () => {}, save: async home => ({ ok: true, home }) });
  assert.equal(controller.home.x, 1);
  config = { world: { home: { x: 9, z: 9, distance: 60, angle: 1 } } };
  assert.equal(controller.refresh().x, 9);
});

test('home is written as a patch to the settings path, with the session CSRF token', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const result = await saveHomeLocation({ x: 5, z: 6, distance: 25, angle: 0.5 }, { fetch: fetcher, csrf: 'csrf-token' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SETTINGS_ENDPOINT);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['X-World-CSRF'], 'csrf-token');
  assert.equal(calls[0].options.credentials, 'same-origin');
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(Object.keys(body), [HOME_WRITE_SECTION]);
  assert.deepEqual(body[HOME_WRITE_SECTION].home, { x: 5, y: 0, z: 6, distance: 25, angle: 0.5 });
  assert.deepEqual(homeSettingsPatch({ x: 5, z: 6, distance: 25, angle: 0.5 }), body);
});

test('a refused or unreachable save is reported, never thrown, and keeps the value in memory', async () => {
  const refused = await saveHomeLocation({ x: 1 }, { fetch: async () => ({ ok: false, status: 403, json: async () => ({ ok: false, code: 'admin_required' }) }) });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'admin_required');
  const broken = await saveHomeLocation({ x: 1 }, { fetch: async () => { throw new Error('offline'); } });
  assert.equal(broken.ok, false);
  assert.equal(broken.code, 'settings_unavailable');

  const applied = [];
  const controller = createHomeController({
    config: {},
    getCameraFrame: () => ({ target: { x: 7, y: 0, z: 7 }, distance: 30 }),
    applyHome: home => applied.push(home),
    save: async () => ({ ok: false, code: 'settings_unavailable' }),
  });
  const { home, result } = await controller.setFromCurrentView();
  assert.equal(result.ok, false);
  assert.equal(controller.home.x, 7, 'the in-memory home is still the current view');
  controller.reset();
  assert.equal(applied[0].x, 7);
  assert.ok(!sameHome(home, defaultHome));
});

// ------------------------------------------------------------------ Next: the camera envelope
test('the envelope carries the reused frame and Next\'s own tilt and true distance, and survives a bad value', () => {
  const cam = { goal: { x: 12, y: 0, z: -4 }, goalDist: 210, goalYaw: 1.25, goalPitch: 0.87 };
  const env = frameFromCamera(cam);
  assert.deepEqual(env.frame, { x: 12, y: 0, z: -4, distance: 120, angle: 1.25 });   // the distance is clamped by the module
  assert.equal(env.pitch, 0.87);
  assert.equal(env.dist, 210, 'the envelope keeps the true distance beside it (2026-10-09: a view over the city is farther than 120 m)');
  const back = readEnvelope(writeEnvelope(env));
  assert.deepEqual(back, env, 'a saved envelope reads back exactly');
  for (const junk of ['', 'nonsense', '[]', 'null', '{"pitch":"x"}', '{"frame":{}}', '{"frame":[]}']) {
    assert.equal(readEnvelope(junk), null, `${junk} is not a home`);
  }
  // The reused module keeps a half-written frame (one usable number is enough) and fills the rest in, so the envelope
  // does the same rather than throwing the person's home away.
  const half = readEnvelope('{"frame":{"x":1}}');
  assert.deepEqual(half.frame, { x: 1, y: 0, z: 0, distance: 40, angle: Math.PI / 4 });
  const flown = [];
  const c2 = { goalYaw: 0, goalPitch: 0.9, flyTo: (...a) => flown.push(a) };
  applyFrame(c2, env);
  assert.deepEqual(flown, [[12, 0, -4, 210, 1.25, 0.87]], 'the camera is sent to the saved frame, tilt and true distance included');
  applyFrame(c2, { frame: { x: 1, y: 0, z: 1, distance: 40, angle: 0.5 } });
  assert.equal(flown[1][5], null, 'without a saved tilt the camera is left to keep its own (flyTo ignores a null tilt)');
});

// ------------------------------------------------------------------ Next: the dock panel
test('the info dock offers the home view to everyone, and setting it to editors (I13.5, C117)', () => {
  const docks = source('client/js/ui/docks.js');
  assert.match(docks, /id: 'home'/, 'the info dock has a home section');
  const home = source('client/js/ui/home.js');
  assert.match(home, /Go to home view/);
  assert.match(home, /Set home to current view/);
  assert.match(home, /Set as the world default/);
  assert.match(home, /auth\.account && auth\.can\('account\.self'\)/, 'any signed-in account keeps a home of its own');
  assert.match(home, /auth\.can\('settings\.world'\)/, 'only admins set the world default');
  assert.match(home, /homeEnvelope\(\{ own: mine\(\), world:/, 'the account\'s own home, then the world default, then the whole city');
  assert.match(home, /'world\.home'/, 'the world default is the installation setting');
  assert.match(source('client/index.html'), /css\/theme\.css/, 'the theme tokens load before the shell');
});
