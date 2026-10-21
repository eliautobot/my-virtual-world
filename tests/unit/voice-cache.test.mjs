// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The replay cache of server/voice/voice.js (docs/features/CHAT.md §9.3): an audio kept again under the same key is
// counted once (a double count once drifted the size past its limit until an empty cache was asked for its oldest
// entry and threw), the oldest go first within the items and bytes allowed, and an audio too big to keep isn't.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Voice } from '../../server/voice/voice.js';

const cache = () => Object.assign(Object.create(Voice.prototype), { cache: new Map(), cacheBytes: 0 });
const audio = n => ({ audio: Buffer.alloc(n) });

test('an audio kept twice under one key is counted once; the oldest go first; the sizes always add up', () => {
  const v = cache();
  v.remember('a', audio(1000)); v.remember('a', audio(1000)); v.remember('a', audio(3000));
  assert.deepEqual([v.cache.size, v.cacheBytes], [1, 3000]);
  for (let i = 0; i < 200; i++) v.remember(`k${i}`, audio(100));
  assert.equal(v.cache.size, 128, 'at most 128 kept');
  assert.ok(!v.cache.has('a') && !v.cache.has('k0') && v.cache.has('k199'), 'the oldest went first');
  assert.equal(v.cacheBytes, [...v.cache.values()].reduce((n, x) => n + x.audio.length, 0));
  // big ones: within 64 MB in all, and one over a quarter of it isn't kept
  for (let i = 0; i < 6; i++) v.remember(`big${i}`, audio(15 * 1048576));
  assert.ok(v.cacheBytes <= 64 * 1048576, `${v.cacheBytes}`);
  assert.equal(v.cacheBytes, [...v.cache.values()].reduce((n, x) => n + x.audio.length, 0));
  v.remember('huge', audio(17 * 1048576));
  assert.ok(!v.cache.has('huge'));
  // the same big one kept again and again never pushes the count past what is held
  for (let i = 0; i < 50; i++) v.remember('big5', audio(15 * 1048576));
  assert.equal(v.cacheBytes, [...v.cache.values()].reduce((n, x) => n + x.audio.length, 0));
  assert.ok(v.cache.has('big5'));
});
