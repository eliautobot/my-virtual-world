// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// How many live in the city follows its homes (server/sim/housing.js): the beds of its apartment buildings × Homes
// filled; the city settles towards it by the world's clock — moving in (about 1/24 of the gap a world hour, only into free
// beds), moving away (no home first, then no work, never an agent's resident), a resident without a home for a world day
// leaves; a paused clock changes nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Housing, bedsOf, targetOf } from '../../server/sim/housing.js';

/** A small world: `apts` apartment buildings of `beds` beds each, an office with desks; `n` residents (`housed` of them with a home). */
function city({ apts = 2, beds = 50, n = 0, housed = n, agents = 0 } = {}) {
  const buildings = [], slots = new Map();
  for (let b = 0; b < apts; b++) { buildings.push({ idx: b, type: 'apartment', lv: [b] }); slots.set(b, new Map([[1, { slots: Array.from({ length: beds }, () => ({ use: 'sleep' })) }]])); }
  buildings.push({ idx: apts, type: 'office', lv: [apts] }); slots.set(apts, new Map([[1, { slots: Array.from({ length: 300 }, () => ({ use: 'work' })) }]]));
  const world = { buildings };
  const people = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, home: i < housed ? { b: 0 } : null, job: { kind: i % 3 ? 'office' : 'free' }, ...(i < agents ? { agentId: `a${i}`, vip: 1 } : {}) }));
  const clock = { dayBase: 0, dayScale: 1 };
  let t = 0;
  const sim = { people, clock, index: { slots: lv => slots.get(lv) || new Map() }, now: () => t };
  const editor = {
    apply(ops) {
      const results = [];
      for (const o of ops) {
        if (o.op === 'person.add') { people.push({ id: `n${people.length}`, home: { b: 1 }, job: { kind: 'free' } }); results.push({}); }
        if (o.op === 'person.del') { const p = people[o.i]; p.retired = 1; p.home = null; results.push({ i: o.i }); }
      }
      return { results };
    },
  };
  return { world, sim, editor, advance: s => { t += s; }, live: () => people.filter(p => !p.retired) };
}
const H = (c, pct) => new Housing({ world: () => c.world, sim: () => c.sim, editor: c.editor, pct: () => pct });

test('the homes decide: only apartment beds count; the target is beds × the share', () => {
  const c = city({ apts: 3, beds: 40 });
  assert.equal(bedsOf(c.world, c.sim.index), 120, 'the office\'s 300 desks bring no one');
  assert.equal(targetOf(120, 30), 36); assert.equal(targetOf(120, 0), 0); assert.equal(targetOf(120, 150), 120);
});

test('fewer residents than the homes call for: they move in about 1/24 of the gap a world hour, never past the free beds', () => {
  const c = city({ apts: 2, beds: 50, n: 10 }), h = H(c, 100);   // target 100, 90 to come
  h.step(); c.advance(3600); h.step();
  const first = c.live().length - 10;
  assert.ok(first >= 3 && first <= 5, `one world hour: about 90/24 moved in (${first})`);
  c.advance(30); h.step(); assert.equal(c.live().length - 10, first, 'under a world minute: nothing yet');
  for (let k = 0; k < 96; k++) { c.advance(3600); h.step(); }
  assert.equal(c.live().length, 100, 'four world days: settled at the target');
  // full homes: no one moves in, whatever the share says
  const full = city({ apts: 1, beds: 10, n: 10 }), h2 = H(full, 100);
  h2.step(); full.advance(86400); h2.step();
  assert.equal(full.live().length, 10, 'no free bed, no newcomer');
});

test('more residents than that: those without a home leave first, then those without work — never an agent\'s resident', () => {
  const c = city({ apts: 2, beds: 50, n: 60, housed: 55, agents: 2 }), h = H(c, 20);   // target 20, 40 too many
  h.step(); c.advance(6 * 3600); h.step();
  const gone = c.sim.people.filter(p => p.retired);
  assert.ok(gone.length >= 5, `some moved away (${gone.length})`);
  assert.ok(gone.slice(0, 5).every(p => p.id >= 'p55' || !p.home), 'the five without a home went first');
  for (let k = 0; k < 120; k++) { c.advance(3600); h.step(); }
  assert.equal(c.live().length, 20, 'settled at the target');
  assert.equal(c.live().filter(p => p.agentId).length, 2, 'the agents\' residents stay');
});

test('a resident without a home for a whole world day moves away; a paused clock changes nothing', () => {
  const c = city({ apts: 1, beds: 10, n: 10, housed: 8 }), h = H(c, 100);   // 2 without a home, no free bed for them
  h.step(); c.advance(60); h.step();   // (the first step starts the clock; the next sees them without a home)
  c.advance(12 * 3600); h.step();
  assert.equal(c.live().length, 10, 'half a day: still here');
  c.advance(12 * 3600); h.step();
  assert.equal(c.live().length, 8, 'a whole day without a home: they left');
  const before = c.live().length;
  for (let k = 0; k < 10; k++) h.step();
  assert.equal(c.live().length, before, 'the clock stood still: nothing moved');
  const s = h.status();
  assert.deepEqual([s.beds, s.target, s.residents, s.homeless], [10, 10, 8, 0]);
});

test('a small gap closes at about one person a world hour — not one every step — and what is owed never piles up', () => {
  const c = city({ apts: 1, beds: 100, n: 50 }), h = H(c, 45);   // target 45: 5 too many
  h.step();
  for (let k = 0; k < 16; k++) { c.advance(225); h.step(); }      // one world hour in steps of 225 world seconds
  assert.equal(c.live().length, 49, 'one world hour: one moved away');
  for (let k = 0; k < 4 * 16; k++) { c.advance(225); h.step(); }
  assert.equal(c.live().length, 45, 'five world hours: settled');
  // owed while no bed is free: not all at once when beds free up
  const full = city({ apts: 1, beds: 10, n: 10 }), h2 = H(full, 100);
  h2.step(); full.advance(3 * 86400); h2.step();
  assert.ok(h2.carry <= 1, `nothing piled up (${h2.carry})`);
});
