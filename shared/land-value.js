// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Land value for the property map (WP4.14; 2026-10-04: "a realty value map that is colour coded and directly
// viewed in the world"): a score from 0 to 100 for where a lot is - close to downtown, near the water, next to a park,
// near a subway station, on higher ground - with the factors that made it, in words. Weights and reaches are data
// (shared/world-config/land-value.json), the same for every browser and, when land is sold later, the server. It is an
// estimate of how wanted a place is, not a price: prices come with the land-sales package (wp4-world-spec.md §5.8).

const clamp01 = v => Math.max(0, Math.min(1, v));
const DIRS = 12, RINGS = [12, 25, 45, 70, 100, 140, 190, 260];

/** Metres from (x, z) to the nearest water within the rings, or Infinity. isWater(x, z) → boolean. */
export function waterDistance(x, z, isWater, reach = 260) {
  for (const r of RINGS) {
    if (r > reach * 1.05) break;
    for (let k = 0; k < DIRS; k++) { const a = (k + (r % 2) * 0.5) * 2 * Math.PI / DIRS; if (isWater(x + Math.cos(a) * r, z + Math.sin(a) * r)) return r; }
  }
  return Infinity;
}
const nearest = (x, z, pts) => { let d = Infinity; for (const p of pts) d = Math.min(d, Math.hypot(p.x - x, p.z - z)); return d; };

/**
 * The value of a lot at (x, z). env: { centre: {x, z}, isWater(x, z), heightAt(x, z) (optional), seaLevel, parks: [{x, z}],
 * stations: [{x, z}] }; cfg: the land-value config. Returns { score (0..100, whole), tier, factors: [{ key, label, points }]
 * (the ones that add at least 3 points, biggest first) }.
 */
export function landValue(x, z, env, cfg) {
  const F = cfg.factors, out = [];
  const add = (key, closeness) => { const f = F[key]; if (!f) return 0; const p = f.weight * clamp01(closeness); out.push({ key, label: f.label, points: p }); return p; };
  let s = cfg.base || 0;
  if (env.centre) s += add('downtown', 1 - Math.hypot(x - env.centre.x, z - env.centre.z) / F.downtown.reach);
  if (env.isWater && F.water) s += add('water', 1 - waterDistance(x, z, env.isWater, F.water.reach) / F.water.reach);
  if (env.parks?.length && F.park) s += add('park', 1 - nearest(x, z, env.parks) / F.park.reach);
  if (env.stations?.length && F.station) s += add('station', 1 - nearest(x, z, env.stations) / F.station.reach);
  if (env.heightAt && F.view) s += add('view', (env.heightAt(x, z) - (env.seaLevel ?? 0) - 12) / F.view.reach);
  const score = Math.max(0, Math.min(100, Math.round(s)));
  const tier = (cfg.tiers || []).find(t => score < t.below)?.name || '';
  return { score, tier, factors: out.filter(f => f.points >= 3).sort((a, b) => b.points - a.points).map(f => ({ ...f, points: Math.round(f.points) })) };
}
