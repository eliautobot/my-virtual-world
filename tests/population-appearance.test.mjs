// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../shared/rng.js';
import { randomAppearance, CHARACTERS, LEGACY_CHARACTERS } from '../shared/appearance.js';
import { populationChar, randomPopulationAppearance } from '../shared/populationAppearance.js';
import { makeCitizen } from '../server/sim/population.js';

test('resident generation uses all44 models while account/player defaults remain legacy-stable', () => {
  const used = new Set();
  for (let i = 0; i < 3000; i++) {
    const residentRng = new RNG('population-roster:' + i);
    const accountRng = new RNG('population-roster:' + i);
    const resident = randomPopulationAppearance(residentRng);
    const account = randomAppearance(accountRng);
    used.add(resident.char);
    assert.ok(CHARACTERS.includes(resident.char));
    assert.equal(resident.char[0], resident.body ? 'f' : 'm');
    assert.ok(LEGACY_CHARACTERS.includes(account.char));
    assert.deepEqual({ ...resident, char: account.char }, account);
    assert.equal(residentRng.next(), accountRng.next(), 'roster selection must not perturb jobs/schedules RNG');
  }
  assert.equal(used.size, 44);
});

test('future citizens sample the full pool and explicit creator choices are retained', () => {
  const used = new Set();
  for (let i = 0; i < 1000; i++) used.add(makeCitizen([], { fem: i % 2 }, i).app.char);
  assert.equal(used.size, 44);
  assert.equal(makeCitizen([], { app: { char: 'f22' } }, 50).app.char, 'f22');
});

test('population character selection is deterministic and gender-matched', () => {
  for (const body of [0, 1]) {
    const look = { body, skin: '#123456', height: 1, build: 1 };
    assert.equal(populationChar(look), populationChar({ ...look }));
    assert.equal(populationChar(look)[0], body ? 'f' : 'm');
  }
});
