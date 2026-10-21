// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The weather (WP4.18, wp4-world-spec.md §6.1): one deterministic timeline per world region from its seed and the world
// clock, so the server and every browser agree without storing anything. The day is cut into spells of a few hours;
// each spell draws its kind (clear, partly cloudy, overcast, rain, storm, fog - fog more likely around dawn) and blends
// into the next over its first half hour. Wind turns slowly and blows harder in bad weather. An administrator can set
// the weather for a while (an override the server holds and sends); the timeline resumes after it.
export const WEATHER_KINDS = ['clear', 'partly', 'overcast', 'rain', 'storm', 'fog'];
const TABLE = {   // per kind: cloud cover, rain, fog (0..1), wind (m/s)
  clear: { cloud: 0.12, rain: 0, fog: 0, wind: 3 },
  partly: { cloud: 0.45, rain: 0, fog: 0, wind: 4.5 },
  overcast: { cloud: 0.85, rain: 0, fog: 0.15, wind: 6 },
  rain: { cloud: 0.95, rain: 0.6, fog: 0.3, wind: 8 },
  storm: { cloud: 1, rain: 1, fog: 0.4, wind: 15 },
  fog: { cloud: 0.6, rain: 0, fog: 1, wind: 1.5 },
};
const ODDS = [['clear', 34], ['partly', 30], ['overcast', 14], ['rain', 12], ['storm', 4], ['fog', 6]];
const SPELL_MIN = 3, SPELL_MAX = 8, BLEND_H = 0.5, OVERRIDE_BLEND_H = 0.15;   // world hours (an override comes in faster)

function hash(seed, n) {
  let h = 2166136261 ^ n;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** The spell around world hour t (hours since the world's start): { i, start, end, kind }. */
function spellAt(seed, t) {
  // Spells have lengths SPELL_MIN..SPELL_MAX hours; boundaries come from a fixed 24-hour grid of 4 spells per day.
  const day = Math.floor(t / 24), within = t - day * 24, cuts = [0];
  for (let k = 1; k < 4; k++) cuts.push(k * 6 + (hash(seed, day * 8 + k) - 0.5) * (SPELL_MAX - SPELL_MIN));
  cuts.push(24);
  let k = 0; while (k < 3 && within >= cuts[k + 1]) k++;
  const i = day * 4 + k, start = day * 24 + cuts[k], end = day * 24 + cuts[k + 1];
  const dawn = cuts[k] < 9 && cuts[k + 1] > 4;   // the spell covers part of 4–9 a.m.
  let r = hash(seed, i * 31 + 7) * 100, kind = 'clear';
  for (const [kd, p] of ODDS) { const w = kd === 'fog' ? (dawn ? p * 3 : p * 0.4) : p; if (r < w) { kind = kd; break; } r -= w; }
  return { i, start, end, kind };
}
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * The weather at world time t (hours since the world's start) for a region seed:
 * { kind, cloud, rain, fog, wind: { dir (radians, the direction it blows toward), speed (m/s) }, storm (0..1), t }.
 * `override`: { kind, from, until } (world hours) from an administrator, blended in and out like a spell.
 */
export function weatherAt(seed, t, override = null) {
  const cur = spellAt(seed, t), prev = spellAt(seed, cur.start - 0.01);
  let a = TABLE[prev.kind], b = TABLE[cur.kind], k = sstep((t - cur.start) / BLEND_H), kind = k > 0.5 ? cur.kind : prev.kind;
  let v = { cloud: lerp(a.cloud, b.cloud, k), rain: lerp(a.rain, b.rain, k), fog: lerp(a.fog, b.fog, k), wind: lerp(a.wind, b.wind, k), storm: lerp(prev.kind === 'storm' ? 1 : 0, cur.kind === 'storm' ? 1 : 0, k) };
  if (override && TABLE[override.kind] && t >= override.from && t < override.until + OVERRIDE_BLEND_H) {
    const o = TABLE[override.kind], w = Math.min(sstep((t - override.from) / OVERRIDE_BLEND_H), 1 - sstep((t - override.until) / OVERRIDE_BLEND_H));
    v = { cloud: lerp(v.cloud, o.cloud, w), rain: lerp(v.rain, o.rain, w), fog: lerp(v.fog, o.fog, w), wind: lerp(v.wind, o.wind, w), storm: lerp(v.storm, override.kind === 'storm' ? 1 : 0, w) };
    if (w > 0.5) kind = override.kind;
  }
  // Wind direction drifts slowly over the days (smooth between 6-hour anchors); gusts ride on top in the renderer.
  const q = t / 6, q0 = Math.floor(q), f = sstep(q - q0), d0 = hash(seed, q0 * 13 + 3) * Math.PI * 2;
  let d1 = hash(seed, (q0 + 1) * 13 + 3) * Math.PI * 2; if (d1 - d0 > Math.PI) d1 -= Math.PI * 2; if (d0 - d1 > Math.PI) d1 += Math.PI * 2;
  return { kind, cloud: v.cloud, rain: v.rain, fog: v.fog, storm: v.storm, wind: { dir: d0 + (d1 - d0) * f, speed: v.wind }, t };
}
/** World hours (since the world's start) from the world clock and its sim time (shared/constants.js worldSeconds). */
export const worldHours = (clock, sim) => (clock.dayBase + sim * clock.dayScale) / 3600;
