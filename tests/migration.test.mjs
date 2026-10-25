// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// People moving between towns (server/sim/migration.js, step 6 of 2026-10-23): on a generated city split in two towns,
// residents working in the other town move there when it has free homes; one out of work in a town with too few jobs
// moves to a town with work and looks for it there; never an agent's resident, never one moved in by its flat's owner;
// at most a few at a time; a town's pull grows with how well it does and its open work (none without free homes); and
// newcomers settle mostly in the town that pulls hardest (population.js reassign).
import test from 'node:test';
import assert from 'node:assert/strict';
import { testCity } from './helpers/world.mjs';
import { townNeeds } from '../server/town-needs.js';
import { planMoves, pullOf, MOVE_MAX } from '../server/sim/migration.js';
import { reassign, setPlaces } from '../server/sim/population.js';
import { RNG } from '../shared/rng.js';

const always = { next: () => 0 };   // (every chance taken)
const city = () => testCity({ seed: 'migration', population: 700 });
const split = W => b => (W.buildings[b].x > 0 ? 'East' : 'main');
const names = new Map([['main', 'Next City'], ['East', 'East']]);

test('commuters move to the town where they work; never agents or tenants; a few at a time', () => {
  const { world, people, index } = city(), townOf = split(world);
  const needs = townNeeds({ world, index, people, townOf, names });
  const commuters = people.map((p, i) => ({ p, i })).filter(({ p }) => p && !p.retired && p.home && p.job?.b >= 0 && townOf(p.job.b) !== townOf(p.home.b));
  assert.ok(commuters.length > 0, 'some live in one town and work in the other');
  // an agent's resident and a tenant among them stay
  const agent = commuters[0].p; agent.vip = 1; agent.agentId = 'a-1';
  const tenant = commuters[1];
  world.flats = { [`${tenant.p.home.b}:${tenant.p.home.f}:${tenant.p.home.u}`]: { deal: 'assigned', tenants: [{ kind: 'person', id: tenant.i }] } };
  const moves = planMoves({ world, index, people, townOf, needs, flat: (b, f, u) => world.flats[`${b}:${f}:${u}`] || null, rng: always });
  assert.ok(moves.length > 0 && moves.length <= MOVE_MAX, `a few move (${moves.length})`);
  for (const m of moves) {
    const p = people[m.i];
    assert.equal(world.buildings[m.b].type, 'apartment', 'into a block of flats');
    assert.equal(townOf(m.b), townOf(p.job.b), `to the town it works in (${m.why})`);
    assert.equal(m.seek, false, 'it keeps its work');
  }
  assert.ok(!moves.some(m => m.i === commuters[0].i), 'never an agent\'s resident');
  assert.ok(!moves.some(m => m.i === tenant.i), 'never one its flat\'s owner moved in');
});

test('out of work where there is none: to a town with work and free homes, looking for work there', () => {
  const { world, people, index } = city(), townOf = split(world);
  const jobless = people.map((p, i) => ({ p, i })).find(({ p }) => p && !p.retired && p.home && townOf(p.home.b) === 'main' && !p.vip);
  jobless.p.job = { kind: 'free', title: 'Between jobs', lost: 1, prev: 'office' };
  const needs = { towns: [
    { id: 'main', freeJobs: 0, unemployed: 30, freeBeds: 10, scores: { overall: 55 } },
    { id: 'East', freeJobs: 80, unemployed: 2, freeBeds: 200, scores: { overall: 70 } },
  ] };
  const moves = planMoves({ world, index, people: people.map((p, i) => (i === jobless.i ? p : { ...p, vip: 1 })), townOf, needs, rng: always });
  assert.equal(moves.length, 1, JSON.stringify(moves));
  assert.deepEqual([moves[0].i, moves[0].to, moves[0].seek, townOf(moves[0].b)], [jobless.i, 'East', true, 'East']);
});

test('a town\'s pull: how well it does and its open work; none without free homes; newcomers follow it', () => {
  const base = { freeBeds: 10, unemployed: 5 };
  assert.equal(pullOf({ ...base, freeBeds: 0, freeJobs: 50, scores: { overall: 100 } }), 0, 'no free homes: no pull');
  assert.ok(pullOf({ ...base, freeJobs: 50, scores: { overall: 90 } }) > pullOf({ ...base, freeJobs: 50, scores: { overall: 40 } }), 'better does: pulls more');
  assert.ok(pullOf({ ...base, freeJobs: 50, scores: { overall: 60 } }) > pullOf({ ...base, freeJobs: 0, scores: { overall: 60 } }), 'work for them: pulls more');
  // newcomers (no home, no work) settle mostly where the pull is
  const { world, people, index } = city(), townOf = split(world);
  const fresh = [];
  people.forEach((p, i) => { if (p && !p.retired && !p.vip && fresh.length < 60 && p.home) { p.home = null; p.job = { kind: 'free', title: 'Newcomer', seek: 1 }; fresh.push(i); } });
  setPlaces(() => ({ townOf, pull: new Map([['East', 50], ['main', 0.01]]) }));
  try {
    reassign(world, index, people, new RNG('newcomers'));
    const east = fresh.filter(i => people[i].home && townOf(people[i].home.b) === 'East').length;
    assert.ok(east >= fresh.length * 0.8, `most newcomers to the town that pulls (${east} of ${fresh.length})`);
  } finally { setPlaces(null); }
});
