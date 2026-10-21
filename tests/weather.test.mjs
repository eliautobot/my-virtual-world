// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.18 weather: one deterministic timeline per region (the server and every browser agree), spells that blend, fog
// mostly around dawn, wind that turns slowly and blows harder in storms, and an administrator's override that fades in
// and out; the server sends the seed and override, and only administrators set it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { weatherAt, WEATHER_KINDS } from '../shared/weather.js';
import { startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';

test('the weather timeline: deterministic, varied, smooth, overridable', () => {
  const seed = 'w1:weather:main';
  assert.deepEqual(weatherAt(seed, 1234.5), weatherAt(seed, 1234.5), 'the same everywhere');
  const kinds = new Map(); let maxJump = 0, prev = weatherAt(seed, 0), fogDawn = 0, fogDay = 0;
  for (let t = 0; t < 24 * 60; t += 0.05) {
    const w = weatherAt(seed, t);
    assert.ok(WEATHER_KINDS.includes(w.kind));
    for (const k of ['cloud', 'rain', 'fog', 'storm']) assert.ok(w[k] >= 0 && w[k] <= 1);
    kinds.set(w.kind, (kinds.get(w.kind) || 0) + 1);
    maxJump = Math.max(maxJump, Math.abs(w.cloud - prev.cloud), Math.abs(w.rain - prev.rain), Math.abs(w.wind.speed - prev.wind.speed) / 15);
    if (w.kind === 'fog') { const h = t % 24; if (h > 3 && h < 11) fogDawn++; else fogDay++; }
    prev = w;
  }
  assert.ok(kinds.size >= 5, `several kinds over 60 days (${[...kinds.keys()]})`);
  assert.ok(kinds.get('clear') + kinds.get('partly') > kinds.get('rain') + (kinds.get('storm') || 0), 'mostly fair');
  assert.ok(maxJump < 0.2, `changes blend (largest step ${maxJump.toFixed(3)})`);
  assert.ok(fogDawn > fogDay * 0.5, 'fog keeps to the mornings mostly');
  const storm = weatherAt(seed, 500.3, { kind: 'storm', from: 499, until: 503 });
  assert.equal(storm.kind, 'storm'); assert.ok(storm.rain > 0.9 && storm.wind.speed > 12);
  assert.ok(weatherAt(seed, 504, { kind: 'storm', from: 499, until: 503 }).rain < weatherAt(seed, 502, { kind: 'storm', from: 499, until: 503 }).rain + 1e-9, 'it fades after');
});

test('the server sends the weather and only administrators set it', async () => {
  const dir = tempDir('mvw-weather-'), s = await startServer({ data: dir, population: 60 });
  try {
    const owner = await ownerSession(s), bob = await userSession(s, owner, { login: 'bob' });
    const now = await owner.get('/api/weather');
    assert.equal(now.status, 200); assert.ok(now.json.seed && WEATHER_KINDS.includes(now.json.now.kind));
    assert.equal((await bob.post('/api/weather', { kind: 'storm', hours: 2 })).status, 403);
    const set = await owner.post('/api/weather', { kind: 'storm', hours: 2 });
    assert.equal(set.status, 200, set.text); assert.equal(set.json.override.kind, 'storm');
    assert.equal((await owner.post('/api/weather', { kind: 'snowstorm' })).status, 400);
    assert.equal((await owner.post('/api/weather', { kind: 'auto' })).json.override, null);
  } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
