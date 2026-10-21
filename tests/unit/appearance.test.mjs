// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character looks: random generation, sanitising (every look from a client goes through it), packing (shared/appearance.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  randomAppearance, sanitizeAppearance, appToArr, arrToApp, packAppearance, hexToRgb, rgbToHex,
  SKIN, HAIR_COLORS, EYE_COLORS,
} from '../../shared/appearance.js';
import { RNG } from '../../shared/rng.js';

test('random looks are deterministic per seed and always valid', () => {
  for (let s = 0; s < 300; s++) {
    const a = randomAppearance(new RNG('look:' + s));
    assert.deepEqual(randomAppearance(new RNG('look:' + s)), a);
    assert.deepEqual(sanitizeAppearance(a), a, `seed ${s}`);
  }
});

test('sanitising replaces bad values with defaults, clamps sizes and drops unknown fields', () => {
  const s = sanitizeAppearance({ skin: 'red', hair: '#ABCDEF', hairStyle: 99, topStyle: -1, bottomStyle: 2.4, acc: '3', height: 9, build: -4, eyes: '#12345', script: '<b>' });
  assert.equal(s.skin, SKIN[2]);
  assert.equal(s.hair, '#abcdef');
  assert.equal(s.hairStyle, 1);
  assert.equal(s.topStyle, 0);
  assert.equal(s.bottomStyle, 2);
  assert.equal(s.acc, 3);
  assert.equal(s.height, 1.12);
  assert.equal(s.build, 0.85);
  assert.equal(s.eyes, EYE_COLORS[0]);
  assert.equal('script' in s, false);
});

test('an edit with a bad field keeps the current value of that field', () => {
  const base = randomAppearance(new RNG('base'));
  const s = sanitizeAppearance({ hair: 'bad', hairStyle: 'x', top: '#00FF00', height: null, acc: true, eyes: ['#aabbcc'] }, base);
  assert.deepEqual(s, { ...base, top: '#00ff00' });
  assert.deepEqual(sanitizeAppearance({}, base), base, 'an empty edit changes nothing');
  assert.equal(sanitizeAppearance({ hairStyle: null }).hairStyle, 1, 'null is not bald (style 0)');
  assert.equal(sanitizeAppearance('not an object').hair, HAIR_COLORS[1]);
});

test('looks survive the compact array form', () => {
  for (let s = 0; s < 50; s++) {
    const a = randomAppearance(new RNG('arr:' + s));
    assert.deepEqual(arrToApp(appToArr(a)), a);
  }
});

test('looks pack into 8 RGBA texels', () => {
  const a = sanitizeAppearance({ skin: '#102030', height: 1.2, hairStyle: 5, build: 0.8 });
  const px = packAppearance(a);
  assert.equal(px.length, 32);
  assert.deepEqual([...px.slice(0, 3)], [0x10, 0x20, 0x30]);
  assert.equal(px[3], 204, 'height 1.12 (clamped) in texel 0 alpha');
  assert.equal(px[7], 5, 'hair style in texel 1 alpha');
  assert.equal(px[27], 28, 'build 0.85 (clamped) in texel 6 alpha');
  assert.deepEqual(hexToRgb(rgbToHex(1, 128, 255)), [1, 128, 255]);
});

test('a look with no character gets a male or female one to match its body type, and keeps it', async () => {
  const { defaultChar, sanitizeAppearance, appToArr, arrToApp } = await import('../../shared/appearance.js');
  const base = { skin: '#eab896', hair: '#2d211b', hairStyle: 1, top: '#3b6ea5', topStyle: 0, bottom: '#1e272e', bottomStyle: 0, shoes: '#1b1b1b', height: 1, build: 1 };
  for (let i = 0; i < 30; i++) {
    const f = defaultChar({ ...base, hairStyle: i % 12, body: 1 }), m = defaultChar({ ...base, hairStyle: i % 12, body: 0 });
    assert.match(f, /^f\d\d$/); assert.match(m, /^m\d\d$/);
  }
  const a = sanitizeAppearance({ ...base, body: 1 });
  assert.equal(a.char[0], 'f'); assert.equal(a.body, 1);
  assert.equal(arrToApp(appToArr(a)).char, a.char);
});
