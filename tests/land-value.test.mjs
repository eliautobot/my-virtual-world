// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The property map's land value (shared/land-value.js): closer to downtown, the water, a park or a station is worth
// more; the score stays within 0..100; the factors that made it come back in words.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { landValue, waterDistance } from '../shared/land-value.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../shared/world-config/land-value.json', import.meta.url)));
const env = { centre: { x: 0, z: 0 }, isWater: (x, z) => z > 400, parks: [{ x: 300, z: 0 }], stations: [{ x: -200, z: 0 }], heightAt: () => 0, seaLevel: 0 };

test('land value: nearer good things is worth more, within 0..100, with its reasons', () => {
  const centre = landValue(0, 0, env, cfg), far = landValue(-1500, -1500, env, cfg), shore = landValue(0, 380, env, cfg), park = landValue(290, 10, env, cfg);
  assert.ok(centre.score > far.score, 'downtown beats the far corner');
  assert.ok(shore.factors.some(f => f.key === 'water'), 'the shore lot counts its water');
  assert.ok(park.factors.some(f => f.key === 'park'));
  for (const v of [centre, far, shore, park]) { assert.ok(v.score >= 0 && v.score <= 100); assert.ok(v.tier); }
  assert.equal(landValue(0, 0, env, cfg).score, centre.score, 'the same place, the same value');
  assert.equal(waterDistance(0, 390, env.isWater), 12);
  assert.equal(waterDistance(0, -500, env.isWater), Infinity);
});
