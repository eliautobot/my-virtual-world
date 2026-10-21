// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's character traits (docs/features/FREE-WILL.md §5). Every trait is a value from 0 to 1.
// - Body traits drive the routine as well as Free Will: they are the resident's own traits (person.tr, which the
//   simulation reads), shown here on a 0..1 scale. Changing one changes how the resident lives.
// - Character traits only shape choices (Free Will now, the Mind later); they live in agent_profiles.traits_json.
// - Flags are yes/no habits of the body (night owl, always on the phone).
import { hashStr } from '../../shared/rng.js';

export const TRAITS = Object.freeze([
  { key: 'sociability', label: 'Sociable', low: 'introverted', high: 'very sociable', body: 'soc', range: [0.2, 1] },
  { key: 'activity', label: 'Active', low: 'not sporty', high: 'very sporty', body: 'act', range: [0.1, 1] },
  { key: 'homebody', label: 'Homebody', low: 'likes being out', high: 'a homebody', body: 'home', range: [0.1, 1] },
  { key: 'appetite', label: 'Appetite', low: 'a small appetite', high: 'loves food', body: 'food', range: [0.5, 1.3] },
  { key: 'curiosity', label: 'Curious', low: 'a creature of habit', high: 'very curious' },
  { key: 'spontaneity', label: 'Spontaneous', low: 'predictable', high: 'impulsive' },
  { key: 'ambition', label: 'Ambitious', low: 'easy-going', high: 'ambitious' },
  { key: 'thrift', label: 'Careful with money', low: 'free-spending', high: 'frugal' },
  { key: 'kindness', label: 'Kind', low: 'reserved', high: 'warm and kind' },
].map(t => Object.freeze(t)));
export const FLAGS = Object.freeze([
  Object.freeze({ key: 'nightOwl', label: 'Night owl', body: 'night', word: 'a night owl' }),
  Object.freeze({ key: 'phone', label: 'Always on the phone', body: 'phone', word: 'always on the phone' }),
]);
export const TRAIT_KEYS = Object.freeze(TRAITS.map(t => t.key));
const BY_KEY = new Map(TRAITS.map(t => [t.key, t]));

const r2 = v => Math.round(v * 100) / 100;
const clamp01 = v => Math.max(0, Math.min(1, v));

/** A character trait an agent has before anyone sets it: steady per agent (from its key), mid-range; spontaneity 0.5. */
export function defaultTrait(agentKey, key) {
  if (key === 'spontaneity') return 0.5;
  return r2(0.25 + (hashStr(`trait:${key}:${agentKey}`) % 1000) / 1000 * 0.5);
}

/** The full trait set: body traits read from the resident, character traits from the profile (or their defaults). */
export function traitsOf(agentKey, person, stored = {}) {
  const out = {};
  for (const t of TRAITS) {
    if (t.body) {
      const v = person && person.tr ? Number(person.tr[t.body]) : NaN;
      out[t.key] = Number.isFinite(v) ? r2(clamp01((v - t.range[0]) / (t.range[1] - t.range[0]))) : 0.5;
    } else out[t.key] = Number.isFinite(stored[t.key]) ? r2(clamp01(stored[t.key])) : defaultTrait(agentKey, t.key);
  }
  return out;
}
export function flagsOf(person) {
  return Object.fromEntries(FLAGS.map(f => [f.key, !!(person && person.tr && person.tr[f.body])]));
}

/** Writes body traits and flags onto the resident (the simulation reads person.tr). Returns whether anything changed. */
export function applyBody(person, traits = {}, flags = {}) {
  if (!person || !person.tr) return false;
  let changed = false;
  for (const t of TRAITS) {
    if (!t.body || traits[t.key] === undefined) continue;
    const v = r2(t.range[0] + clamp01(traits[t.key]) * (t.range[1] - t.range[0]));
    if (person.tr[t.body] !== v) { person.tr[t.body] = v; changed = true; }
  }
  for (const f of FLAGS) {
    if (flags[f.key] === undefined) continue;
    const v = flags[f.key] ? 1 : 0;
    if (person.tr[f.body] !== v) { person.tr[f.body] = v; changed = true; }
  }
  return changed;
}

/** The character traits stored in the profile (body traits are not: they live on the resident). */
export function storedTraits(traits) {
  const out = {};
  for (const t of TRAITS) if (!t.body && Number.isFinite(traits[t.key])) out[t.key] = r2(clamp01(traits[t.key]));
  return out;
}

/** Words for the clear traits only (≥ 0.7 or ≤ 0.3), so a snapshot names what stands out: ["very curious", "frugal"]. */
export function traitWords(traits, flags = {}) {
  const w = [];
  for (const t of TRAITS) {
    const v = traits[t.key];
    if (v >= 0.7) w.push(t.high); else if (v <= 0.3) w.push(t.low);
  }
  for (const f of FLAGS) if (flags[f.key]) w.push(f.word);
  return w;
}

export const isTrait = k => BY_KEY.has(k);
