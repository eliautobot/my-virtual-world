// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What each town needs (server/town-needs.js, 2026-10-23): on a generated city split in two towns, the world's counts are
// the towns' together; every score is 0–100 or doesn't apply; people living in one town and working in the other are
// its commuters (and the other's); a homeless worker, a business that couldn't pay its wages and a town without venues
// show up as issues in plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { testCity } from './helpers/world.mjs';
import { townNeeds } from '../server/town-needs.js';

const city = testCity({ seed: 'town-needs', population: 600 });
const { world, people, index } = city;
const east = b => world.buildings[b].x > 0;
const townOf = b => (east(b) ? 'East' : 'main');
const names = new Map([['main', 'Next City'], ['East', 'East']]);

test('the world is its towns together; scores are 0–100 or n/a; commuters both ways', () => {
  const r = townNeeds({ world, index, people, townOf, names });
  const T = Object.fromEntries(r.towns.map(t => [t.id, t]));
  assert.deepEqual(Object.keys(T).sort(), ['East', 'main']);
  for (const k of ['residents', 'homeless', 'beds', 'jobs', 'venues', 'unemployed', 'employed'])
    assert.equal(r.world[k], T.main[k] + T.East[k], `${k}: the world is its towns together`);
  for (const s of [r.world, T.main, T.East]) for (const [k, v] of Object.entries(s.scores)) assert.ok(v === null || (Number.isInteger(v) && v >= 0 && v <= 100), `${k}: ${v}`);
  // living in one town, working in the other
  const across = people.filter(p => p && !p.retired && p.home && p.job?.b >= 0 && townOf(p.home.b) !== townOf(p.job.b));
  assert.ok(across.length > 0, 'some commute across');
  assert.equal(T.main.commutersOut + T.East.commutersOut, across.length);
  assert.equal(T.main.commutersIn + T.East.commutersIn, across.length);
  assert.equal(r.world.scores.prosperity, null, 'no books (the economy off): n/a');
  assert.equal(r.world.name, undefined);
  assert.equal(T.East.name, 'East');
});

test('issues in plain words: a homeless worker, wages not paid, few venues', () => {
  const p = people.find(x => x && !x.retired && x.home && x.job?.b >= 0 && townOf(x.job.b) === 'East');
  const had = p.home; p.home = null;
  try {
    const r = townNeeds({ world, index, people, townOf, names, books: [{ b: p.job.b, profit: -500, owed: 1200 }] });
    const E = r.towns.find(t => t.id === 'East');
    assert.ok(E.homeless >= 1, 'counted where it works');
    assert.ok(E.issues.some(i => /no home here/.test(i.text)), JSON.stringify(E.issues));
    assert.ok(E.issues.some(i => /couldn't pay all its wages yesterday/.test(i.text)), JSON.stringify(E.issues));
    assert.equal(E.scores.prosperity, 0, 'its one business did badly');
    assert.ok(E.issues.length <= 6);
  } finally { p.home = had; }
  // a town with homes and no venue at all: its shops need is full
  const noVenues = b => (world.levels[world.buildings[b].lv[0]]?.venue ? 'Busy' : 'Quiet');
  const r2 = townNeeds({ world, index, people, townOf: noVenues, names: new Map([['Busy', 'Busy'], ['Quiet', 'Quiet']]) });
  const Q = r2.towns.find(t => t.id === 'Quiet');
  assert.equal(Q.venues, 0);
  assert.equal(Q.scores.shops, 0);
  assert.equal(Q.demand.shops, 100);
  assert.ok(Q.issues.some(i => /Few cafés/.test(i.text)));
});
