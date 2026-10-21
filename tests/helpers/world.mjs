// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Generated test cities for the unit tests. Generation is deterministic per seed; callers get deep copies they may change.
import { generateWorld } from '../../server/world/generate.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { generatePopulation } from '../../server/sim/population.js';

const cache = new Map();

export function testCity({ seed = 'unit-test', population = 300 } = {}) {
  const key = `${seed}:${population}`;
  if (!cache.has(key)) {
    const world = generateWorld({ seed, population });
    const people = generatePopulation(world, new WorldIndex(world), { population, roster: [] });
    cache.set(key, { world, people });
  }
  const c = cache.get(key);
  const world = structuredClone(c.world);
  return { world, people: structuredClone(c.people), index: new WorldIndex(world) };
}
