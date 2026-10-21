// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Population-only selection: account/player fallback identities remain stable.
import { CHARACTERS, randomAppearance } from './appearance.js';

export function populationChar(look) {
  const prefix = look?.body ? 'f' : 'm';
  const pool = CHARACTERS.filter(char => char[0] === prefix);
  const key = [look?.skin, look?.hair, look?.hairStyle, look?.top, look?.topStyle,
    look?.bottom, look?.bottomStyle, look?.shoes, look?.height, look?.build].join('|');
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return pool[(hash >>> 0) % pool.length];
}

export function randomPopulationAppearance(rng, options = {}) {
  const look = randomAppearance(rng, options);
  look.char = populationChar(look);
  return look;
}
