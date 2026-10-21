// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// City generation and population: deterministic, every home and job points at a real slot, every place is reachable.
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateWorld } from '../../server/world/generate.js';
import { validatePerson } from '../../server/sim/population.js';
import { Nav } from '../../server/sim/nav.js';
import { testCity } from '../helpers/world.mjs';

test('a city is generated the same way every time for a seed', () => {
  const a = generateWorld({ seed: 'determinism', population: 200 });
  const b = generateWorld({ seed: 'determinism', population: 200 });
  delete a.created;
  delete b.created;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('every generated home is a bed and every job a work place that exists', () => {
  const { world, people, index } = testCity();
  assert.equal(people.length, 300);
  const invalid = people.filter(p => validatePerson(world, index, p)).map(p => p.name);
  assert.deepEqual(invalid, []);
  assert.equal(people.filter(p => !p.home).length, 0, 'nobody is homeless');
});

test('the street network connects every block corner and every building has an entrance', () => {
  const { world } = testCity();
  const nav = new Nav(world);
  let unreachable = 0;
  for (let k = 0; k < nav.dist.length; k++) if (!Number.isFinite(nav.dist[k])) unreachable++;
  assert.equal(unreachable, 0);
  const noEntrance = world.buildings.filter((b, i) => b && !b.gone && !nav.acc[i].length).map(b => b.name);
  assert.deepEqual(noEntrance, []);
});
