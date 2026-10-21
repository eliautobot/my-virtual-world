// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Frame pacing (client/js/core/framepace.js; 2026-10-03: the phone ran very hot): phones draw at most 60 a second,
// 30 once still and untouched for a few seconds; other devices every display frame unless a cap is chosen.
import test from 'node:test';
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const { FramePace } = await import('../client/js/core/framepace.js');

// frames drawn a second, counted after the first 5 s (the page starts as if just touched)
const drawn = (pace, hz, ms, busy = () => false, input = null) => {
  let n = 0;
  for (let t = 0; t < ms; t += 1000 / hz) { if (input && input(t)) pace.input(t); if (pace.due(t, busy(t)) && t >= 5000) n++; }
  return n / ((ms - 5000) / 1000);
};
test('a phone: 60 while used, 30 once still, never above 60 on a 120 Hz screen', () => {
  store.clear();
  const used = new FramePace({ battery: true });
  assert.ok(Math.abs(drawn(used, 120, 10000, () => true) - 60) < 2, 'busy on 120 Hz → 60');
  const still = new FramePace({ battery: true });
  assert.ok(Math.abs(drawn(still, 60, 20000) - 30) < 2, 'still and untouched → 30');
  const touched = new FramePace({ battery: true });
  assert.ok(Math.abs(drawn(touched, 60, 10000, () => false, t => t % 1000 < 20) - 60) < 2, 'touched every second → 60');
});
test('a desktop draws every display frame; a chosen cap holds anywhere', () => {
  store.clear();
  assert.ok(drawn(new FramePace({ battery: false }), 144, 10000) > 140, 'desktop auto: every frame');
  const p = new FramePace({ battery: false }); p.setMode('30');
  assert.equal(store.get('mvw.fps'), '30');
  assert.ok(Math.abs(drawn(p, 144, 10000, () => true) - 30) < 2, '30 at most');
  const q = new FramePace({ battery: true }); q.setMode('max');
  assert.ok(drawn(q, 120, 10000) > 115, 'unlimited');
  q.setMode('auto'); assert.equal(store.has('mvw.fps'), false, 'auto is the default (nothing stored)');
});

test('a window over the world (Settings, the Studio, the chat full screen): none while it opens, then at most 20 a second, and all again once it closes', () => {
  store.clear();
  for (const [battery, label] of [[false, 'desktop'], [true, 'phone']]) {
    const p = new FramePace({ battery });
    const frames = (from, to, hz = 60, busy = true) => { let n = 0; for (let t = from; t < to; t += 1000 / hz) { p.cover(t >= 1000 && t < 4000, t); if (p.due(t, busy)) n++; } return n; };
    assert.ok(frames(0, 1000) >= 55, `${label}: uncovered, every frame`);
    assert.equal(frames(1000, 1400), 0, `${label}: the first 400 ms of a window, no world frames (the window is built)`);
    const covered = frames(1400, 3400);
    assert.ok(covered >= 36 && covered <= 42, `${label}: covered, about 20 a second (${covered} in 2 s)`);
    frames(3400, 4000);
    assert.ok(frames(4000, 5000) >= 55, `${label}: closed, every frame again`);
  }
  // a cap chosen lower than 20 stays lower under a window; the 'max' choice is still capped behind one
  const thirty = new FramePace({ battery: true }); thirty.setMode('30');
  let n = 0; thirty.cover(true, 0); for (let t = 0; t < 3000; t += 1000 / 60) { thirty.cover(true, t); if (thirty.due(t, true) && t >= 1000) n++; }
  assert.ok(n >= 36 && n <= 42, `30 a second chosen: 20 under a window (${n} in 2 s)`);
  store.clear();
});
