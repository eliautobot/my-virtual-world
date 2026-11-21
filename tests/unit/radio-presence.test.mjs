// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The radio's cast is who is in the studio (server/radio/radio.js hostsOf/djOf/missingOf with server/workplace/presence.js):
// a host or DJ whose hours these are but who isn't there — out with someone, late, on a break — is not on the air; the
// ones on it know who is missing and why; nobody there: no talk (music only). A station with no studio: its hosts, unless
// they are out (an order took them away).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Radio } from '../../server/radio/radio.js';

function rig(states) {
  // a studio: room 7 on floor 0 of building 3 — a broadcast desk (id 10, seats 0..2) and a DJ booth (id 11)
  const W = { buildings: [null, null, null, { lv: [0] }], levels: [{ items: [{ id: 10, t: 'broadcast_desk', mod: 7 }, { id: 11, t: 'studio_dj', mod: 7 }, { id: 12, t: 'desk', mod: 0 }] }] };
  const recs = new Map([[1, { id: 1, name: 'Luke', enabled: true }], [2, { id: 2, name: 'Sara', enabled: true }], [3, { id: 3, name: 'Ben', enabled: true }], [4, { id: 4, name: 'Ana', enabled: true }]]);
  const seats = { 10: new Map([[0, { j: 100, agent: recs.get(1) }], [1, { j: 200, agent: recs.get(2) }], [2, { j: 300, agent: recs.get(3) }]]), 11: new Map([[0, { j: 400, agent: recs.get(4) }]]) };
  const status = j => states[j] || { state: 'on_duty', text: 'On duty', onShift: true };
  const presence = { onDutyAt: (j, seat) => { void seat; return status(j).state === 'on_duty'; }, status, awayBy: j => (states[j]?.state === 'away' ? states[j].reason : '') };
  const R = Object.create(Radio.prototype);
  Object.assign(R, { world: () => W, agents: { get: id => recs.get(id) }, postsAt: (b, f, id) => seats[id] || new Map(), presence: () => presence,
    agentsBody: new Map([[1, 100], [2, 200], [3, 300], [4, 400]]) });
  R.bodyOf = a => R.agentsBody.get(a.id) ?? -1;
  return { R, st: { id: 's1', studio: { b: 3, f: 0, room: 7 } } };
}

test('only those in the studio are on the air; the others are missing, with why', () => {
  const { R, st } = rig({ 100: { state: 'away', text: 'Away — out with Kim', reason: 'out with Kim', onShift: true }, 400: { state: 'late', text: 'Late (12 min) — still asleep', reason: 'still asleep', lateBy: 12, onShift: true } });
  assert.deepEqual(R.hostsOf(st).map(a => a.name), ['Sara', 'Ben'], 'Luke is out: not on the air');
  assert.equal(R.djOf(st), null, 'the DJ is late: not at the decks');
  assert.deepEqual(R.castOf(st).map(a => a.name), ['Sara', 'Ben']);
  const miss = R.missingOf(st);
  assert.deepEqual(miss.map(m => [m.name, m.part, m.text]), [['Luke', 'host', 'Away — out with Kim'], ['Ana', 'dj', 'Late (12 min) — still asleep']]);
  // all: the job's holders, there or not (the host's job: server/radio/host-job.js)
  assert.deepEqual(R.hostsOf(st, { all: true }).map(a => a.name), ['Luke', 'Sara', 'Ben']);
  assert.equal(R.djOf(st, { all: true }).name, 'Ana');
});

test('nobody in the studio: no one to talk (music only); everyone in: all on, nobody missing', () => {
  const away = { state: 'away', text: 'Away — out with Kim', reason: 'out with Kim', onShift: true };
  const empty = rig({ 100: away, 200: away, 300: away, 400: away });
  empty.R.station = () => empty.st; empty.R.day = { n: {} };
  assert.equal(empty.R.hostsOf(empty.st).length, 0);
  assert.equal(empty.R.hostOf('s1'), null, 'no host and no DJ there: no break is written');
  assert.equal(empty.R.missingOf(empty.st).length, 4);
  const full = rig({});
  assert.equal(full.R.castOf(full.st).length, 4);
  assert.equal(full.R.missingOf(full.st).length, 0);
});

test('a station with no studio: its hosts, unless an order took them away', () => {
  const { R } = rig({ 200: { state: 'away', reason: 'at a meet-up at Founders Park' } });
  const st = { id: 's2', hosts: [1, 2] };
  assert.deepEqual(R.hostsOf(st).map(a => a.name), ['Luke']);
  assert.deepEqual(R.missingOf(st).map(m => [m.name, m.text]), [['Sara', 'Away — at a meet-up at Founders Park']]);
});

test('with no one tracking who is at work, the hours decide as before', () => {
  const { R, st } = rig({ 100: { state: 'away' } });
  R.presence = () => null;
  assert.equal(R.hostsOf(st).length, 3);
  assert.equal(R.missingOf(st).length, 0);
});
