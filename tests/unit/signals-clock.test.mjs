// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Traffic signals (deterministic from sim time, shared by server and clients) and the world clock (shared/constants.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sigLight, pedLight, pedStart, sigCycle, SIG_CYCLE, PED_WIN,
  hourAt, dayAt, simUntilHour, worldMin, worldSeconds, formatClock,
} from '../../shared/constants.js';

const IXS = [0, 1, 7, 33, 62];

test('the two car axes are never allowed to go at the same time', () => {
  for (const ix of IXS) {
    for (let t = 0; t < 3 * SIG_CYCLE; t += 0.05) {
      const a = sigLight(ix, t, 0), b = sigLight(ix, t, 1);
      assert.ok(a === 0 || b === 0, `intersection ${ix}, t ${t}: ${a} and ${b}`);
    }
  }
});

test('pedestrians only get walk or flashing while every car light is red', () => {
  for (const ix of IXS) {
    for (let t = 0; t < 3 * SIG_CYCLE; t += 0.05) {
      if (pedLight(ix, t) > 0) assert.ok(sigLight(ix, t, 0) === 0 && sigLight(ix, t, 1) === 0, `intersection ${ix}, t ${t}`);
    }
  }
});

test('each axis gets green, yellow and a protected left arrow once per cycle', () => {
  const phases = axis => {
    const seq = [];
    for (let c = 0; c < SIG_CYCLE; c += 0.25) {   // intersection 0 has no offset, so t = cycle position
      const v = sigLight(0, c, axis);
      if (!seq.length || seq[seq.length - 1][0] !== v) seq.push([v, 0]);
      seq[seq.length - 1][1] += 0.25;
    }
    return seq;
  };
  assert.deepEqual(phases(0), [[2, 10], [1, 2], [3, 4], [0, 38]]);
  assert.deepEqual(phases(1), [[0, 17], [2, 10], [1, 2], [3, 4], [0, 21]]);
  const ped = [];
  for (let c = 0; c < SIG_CYCLE; c += 0.25) {
    const v = pedLight(0, c);
    if (!ped.length || ped[ped.length - 1][0] !== v) ped.push([v, 0]);
    ped[ped.length - 1][1] += 0.25;
  }
  assert.deepEqual(ped, [[0, 34], [2, 12], [1, 8]]);
});

test('pedStart gives the first time a crossing fits inside the scramble window', () => {
  for (const ix of IXS) {
    for (const dur of [2, 6.5, 12, 19]) {
      for (let t = 0; t < 2 * SIG_CYCLE; t += 0.37) {
        const r = pedStart(ix, t, dur);
        assert.ok(r >= t - 1e-9 && r - t < SIG_CYCLE + 1, `never waits more than a cycle (ix ${ix}, t ${t})`);
        const c = sigCycle(ix, r);
        assert.ok(c >= PED_WIN[0] - 1e-6 && c + dur <= PED_WIN[1] + 1e-6, `ix ${ix}, t ${t}, dur ${dur}: starts at cycle ${c}`);
        assert.ok(pedLight(ix, r) > 0);
      }
    }
  }
});

test('world clock: hours, days and waiting for an hour', () => {
  const clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 7.5 * 3600, dayScale: 16 };
  assert.equal(hourAt(clock, 0), 7.5);
  assert.equal(worldSeconds(clock, 10), 7.5 * 3600 + 160);
  assert.equal(simUntilHour(clock, 0, 9), 1.5 * 3600 / 16);
  assert.equal(simUntilHour(clock, 0, 7.5), 24 * 3600 / 16, 'the same hour means the next day');
  assert.ok(Math.abs(hourAt(clock, simUntilHour(clock, 0, 22.25)) - 22.25) < 1e-9);
  assert.equal(dayAt(clock, simUntilHour(clock, 0, 7)), 1, '7:00 comes on the next day');
  assert.equal(worldMin(clock, 60), 225);
});

test('the clock is shown in 12-hour format', () => {
  assert.equal(formatClock(0), '12:00 AM');
  assert.equal(formatClock(12), '12:00 PM');
  assert.equal(formatClock(13.5), '1:30 PM');
  assert.equal(formatClock(23.99), '11:59 PM');
});
