// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Automatic resolution: steps down only when it helps, steps back up after a smooth stretch, never flaps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoResolution } from '../client/js/core/autores.js';

// Simulate frames whose duration depends on the current scale; returns the final scale and the scales chosen.
function run(ar, frameMs, seconds, start = 0) {
  let t = start;
  const end = start + seconds * 1000;
  while (t < end) { t += frameMs(ar.scale); ar.frame(t); }
  return t;
}

test('a GPU-bound device steps down while it helps and settles where frames are smooth', () => {
  const calls = [], ar = new AutoResolution({ set: s => calls.push(s), min: 0.6, warmupMs: 0 });
  run(ar, s => Math.max(16.7, 26 * s * s), 30);   // fill-rate bound: time scales with pixels
  assert.ok(ar.scale < 1 && ar.scale >= 0.6, `scale ${ar.scale}`);
  assert.ok(26 * ar.scale * ar.scale <= 19.5, 'settles where frames are within budget');
  assert.ok(calls.every((s, i) => i === 0 || Math.abs(s - calls[i - 1]) <= 0.1 + 1e-9), 'small steps');
});

test('a CPU-bound device gets one try, then the step is undone and not retried for 30 s', () => {
  const calls = [], ar = new AutoResolution({ set: s => calls.push(s), min: 0.6, warmupMs: 0 });
  run(ar, () => 25, 3.2);
  assert.deepEqual(calls, [0.9, 1], 'tried 0.9, saw no gain, back to full');
  run(ar, () => 25, 20, 3200);
  assert.deepEqual(calls, [0.9, 1], 'no retry during the cool-down');
  assert.equal(ar.scale, 1);
});

test('after a smooth stretch it raises again; a raise that brings slow frames back is undone and held longer', () => {
  const calls = [], ar = new AutoResolution({ set: s => calls.push(s), min: 0.6, warmupMs: 0 });
  ar.set(0.8); calls.length = 0;
  const frame = s => (s > 0.82 ? 24 : 16.7);        // smooth at 0.8, too slow at 0.85
  const t = run(ar, frame, 13.6);                   // 8 smooth windows, the raise, one slow window
  assert.deepEqual(calls, [0.85, 0.8]); assert.equal(ar.hold, 16);
  run(ar, frame, 13, t);                            // 12 s of smooth frames is no longer enough
  assert.deepEqual(calls, [0.85, 0.8]);
});

test('hidden-tab gaps are ignored and turning it off restores full resolution', () => {
  const calls = [], ar = new AutoResolution({ set: s => calls.push(s), min: 0.6, warmupMs: 0 });
  let t = 0; for (let i = 0; i < 20; i++) { t += 5000; ar.frame(t); }
  assert.deepEqual(calls, []);
  ar.set(0.7); ar.enable(false); assert.equal(ar.scale, 1);
  run(ar, () => 40, 10, t); assert.equal(ar.scale, 1, 'no changes while off');
});

test('nothing is judged during the start-up warm-up', () => {
  const calls = [], ar = new AutoResolution({ set: s => calls.push(s), min: 0.6 });
  run(ar, () => 40, 9.5);
  assert.deepEqual(calls, [], 'slow start-up frames are not acted on');
  run(ar, () => 40, 3, 9500);
  assert.equal(calls[0], 0.9, 'afterwards slow frames are acted on');
});
