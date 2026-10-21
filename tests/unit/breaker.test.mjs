// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The circuit breaker of brains and decision services (server/providers/breaker.js; 2026-10-08: "when an account
// runs out of API funds and then it gets filled, it should become available again as soon as it's filled"): failures
// in a row pause a connection; no credit or a refused key pauses it only briefly (a minute, doubling to five), and a
// person's own request may try it at once; one trial at a time; an answer closes it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Breakers, pausedWords } from '../../server/providers/breaker.js';

const make = () => { let t = 1_000_000; const b = new Breakers({ after: 4, baseMs: 60000, maxMs: 1800000, longCodes: ['auth', 'quota', 'blocked'], now: () => t }); return { b, tick: ms => { t += ms; } }; };

test('no credit: paused a minute for the world, but a person may try at once — and the moment it answers it is open for all', () => {
  const { b } = make();
  b.fail(7, 'quota');
  assert.equal(b.open(7), true);
  assert.equal(b.allow(7), false, 'the scheduler waits');
  assert.deepEqual(b.state(7), { code: 'quota', until: 1_060_000, trial: false, fixable: true });
  assert.equal(b.allow(7, { person: true }), true, 'a person asking is the trial at once');
  assert.equal(b.allow(7, { person: true }), false, 'one trial at a time');
  assert.equal(b.state(7).trial, true);
  b.ok(7);   // credit was added: it answered
  assert.equal(b.open(7), false); assert.equal(b.allow(7), true); assert.equal(b.state(7), null);
});

test('still no credit: the pauses grow a minute, two, four, then five at most; each ends in one trial', () => {
  const { b, tick } = make();
  const pauses = [];
  for (let k = 0; k < 6; k++) {
    b.fail(3, 'quota');
    pauses.push(b.state(3).until - 1_000_000 - pauses.reduce((s, p) => s + p, 0));
    assert.equal(b.allow(3), false);
    tick(b.state(3).until - (1_000_000 + pauses.reduce((s, p) => s + p, 0) - pauses.at(-1)) );
    assert.equal(b.allow(3), true, 'time is up: the trial');
    assert.equal(b.allow(3), false, 'and only one');
  }
  assert.deepEqual(pauses, [60000, 120000, 240000, 300000, 300000, 300000]);
});

test('ordinary failures: four in a row pause it (doubling); half-open lets one through; a trial that never went out gives way', () => {
  const { b, tick } = make();
  for (let k = 0; k < 3; k++) b.fail(1, 'provider_error');
  assert.equal(b.open(1), false, 'three: still going');
  b.fail(1, 'provider_error');
  assert.equal(b.open(1), true); assert.equal(b.state(1).fixable, false);
  assert.equal(b.allow(1, { person: true }), false, 'a person waits too: the provider itself is down');
  assert.equal(b.allow(1, { force: true }), true, 'asked to find out (think now, a test): tried at once');
  assert.equal(b.allow(1, { force: true }), false, 'still one at a time');
  b.release(1);
  tick(60001);
  assert.equal(b.allow(1), true, 'half-open');
  b.release(1);   // (that call never went out)
  assert.equal(b.allow(1), true, 'the next may try');
  b.fail(1, 'timeout');
  assert.equal(b.state(1).until - 1_060_001, 120000, 'a failed trial pauses it again, longer');
  tick(120001); assert.equal(b.allow(1), true);
  tick(700000); assert.equal(b.allow(1), true, 'a trial that never came back is let go after its time');
  b.ok(1); assert.deepEqual(b.list(), []);
});

test('what a person is told', () => {
  assert.match(pausedWords('Adam', { code: 'quota' }), /^Adam's AI provider account has no credit left\. Add credit to it — it works again the moment/);
  assert.match(pausedWords('Adam', { code: 'auth' }), /refused its API key/);
  assert.match(pausedWords('Adam', { code: 'timeout' }), /isn't answering at the moment; try again in a minute/);
});
