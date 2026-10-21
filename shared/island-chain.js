// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The island chain (WP4.15, wp4-world-spec.md §3.4): new islands beyond the main one, each made once from a template
// and a seed by the pinned generator and then kept (world.terrain.islands: [{ id, name, template, seed, center, radius }]).
// Their land joins the main island's in the one height function (shared/terrain.js), so everything that walks, drives,
// grows or renders on the land works on them too; the main island's own ground, lakes and rivers never change. New
// islands go into free slots out in the ocean: clear of the other islands, of every protected waterfront corridor and
// open-ocean view (shared/coasts.js), and inside the world's ocean square.
import { fbm, ridged, noise2 } from './terrain.js';

export const TEMPLATES = Object.freeze({
  harbour: { label: 'Harbour town', description: 'Gentle hills round a flat plain for a town and its port.', radius: [1000, 1400], hills: 0.5, plain: 0.38 },
  atoll: { label: 'Lagoon atoll', description: 'A low ring of sand and palms round a shallow lagoon.', radius: [900, 1300], hills: 0.08, ring: true },
  peninsula: { label: 'Peninsula fingers', description: 'Long fingers of land with sheltered bays between them.', radius: [1100, 1600], hills: 0.7, fingers: 5 },
  mountain: { label: 'Mountain island', description: 'A tall wooded peak with ridges down to the sea.', radius: [1200, 1700], hills: 0.9, peak: [320, 560] },
  resort: { label: 'Resort island', description: 'Low and green with long beaches all round.', radius: [700, 1000], hills: 0.25, beach: true },
});
export const WORLD_HALF = 64000 * 0.3048 / 2;   // m: the ocean square is 64,000 ft across (spec §3.1)
export const ISLAND_GAP = 1500;                 // m of open water between islands' shores at least
const SLOTS = 12;

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function seedOf(s) { let h = 2166136261; const str = String(s); for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h | 0; }
const rnd = (seed, k) => { const h = seedOf(`${seed}:${k}`); return ((h >>> 0) % 100000) / 100000; };

/** An island of the chain prepared for fast queries (its template, seed and shape constants). */
export function prepareIsland(I) {
  const T = TEMPLATES[I.template] || TEMPLATES.harbour, s = seedOf(I.seed);
  return { ...I, T, s, reach: I.radius * 1.7, peakH: T.peak ? T.peak[0] + (T.peak[1] - T.peak[0]) * rnd(I.seed, 'peak') : 0, phase: rnd(I.seed, 'phase') * Math.PI * 2 };
}
/** How much (x, z) is land of island I (> 0 land, ≤ 0 sea), like the main island's land-ness. */
export function chainLandness(I, x, z) {
  const dx = (x - I.center.x) / I.radius, dz = (z - I.center.z) / I.radius, r2 = dx * dx + dz * dz;
  if (r2 > 2.9) return -2;
  const wx = x * 0.0006, wz = z * 0.0006, T = I.T;
  const warpX = fbm(wx + 3.1, wz - 8.2, I.s + 11, 3) * 0.6, warpZ = fbm(wx - 5.5, wz + 2.7, I.s + 23, 3) * 0.6;
  const coast = fbm(wx + warpX, wz + warpZ, I.s + 37, 4) * 0.42;
  let shape = 1 - r2;
  if (T.ring) { const r = Math.sqrt(r2); shape = 1 - ((r - 0.78) / 0.2) ** 2; }   // a ring round the lagoon
  if (T.fingers) { const a = Math.atan2(dz, dx); shape = 1 - r2 * (1 + 0.65 * Math.sin(T.fingers * a + I.phase)); }
  return shape * 1.15 + coast;
}
/** Island I's natural ground at (x, z), given its land-ness L (> 0) there. */
export function chainNatural(I, x, z, L, sea) {
  const T = I.T, shore = sstep(0, 0.22, L), dx = (x - I.center.x) / I.radius, dz = (z - I.center.z) / I.radius, r2 = dx * dx + dz * dz;
  let hills = (fbm(x * 0.0024, z * 0.0024, I.s + 101, 5) * 0.5 + 0.5) * 34 * T.hills * shore;
  if (T.plain) hills *= sstep(T.plain * 0.7, T.plain * 1.3, Math.sqrt(r2));   // a flat plain at the middle for a town
  if (T.beach) hills *= sstep(0.1, 0.5, L);                                  // wide, flat beaches all round
  const peaks = I.peakH ? ridged(x * 0.0011 + 1.3, z * 0.0011 - 2.9, I.s + 211, 5) * I.peakH * Math.max(0, 1 - r2) ** 2 : 0;
  const rise = sstep(0, 0.9, L) * (T.ring ? 4 : 30) * (0.4 + T.hills);
  return sea - 0.4 + sstep(0, 0.12, L) + shore * 2.4 + hills + rise * 0.45 + peaks + noise2(x * 0.05, z * 0.05, I.s + 5) * 0.15 * shore;
}

/**
 * Free slots for a new island of the given template around the main island (p: world.terrain): [{ k, center, radius,
 * free, why }]. coastsWhy(x, z, r): a reason a disc may not be used (protected waterfront corridors, open-ocean views),
 * or null.
 */
export function islandSlots(p, template, { coastsWhy = () => null } = {}) {
  const T = TEMPLATES[template] || TEMPLATES.harbour, out = [];
  const existing = (p.islands || []).map(prepareIsland);
  for (let k = 0; k < SLOTS; k++) {
    const a = k / SLOTS * Math.PI * 2, radius = Math.round((T.radius[0] + T.radius[1]) / 2);
    const d = p.radius + ISLAND_GAP + radius + 400;
    const center = { x: Math.round(p.center.x + Math.cos(a) * d), z: Math.round(p.center.z + Math.sin(a) * d) };
    let why = null;
    if (Math.abs(center.x) + radius * 1.4 > WORLD_HALF || Math.abs(center.z) + radius * 1.4 > WORLD_HALF) why = 'Beyond the edge of the world\'s ocean';
    for (const I of existing) if (!why && Math.hypot(I.center.x - center.x, I.center.z - center.z) < I.radius + radius + ISLAND_GAP) why = `Too close to ${I.name}`;
    if (!why) why = coastsWhy(center.x, center.z, radius * 1.3);
    out.push({ k, center, radius, free: !why, why });
  }
  return out;
}
/** A new island's record (pinned: its template, seed, place and size never change once approved). */
export function newIsland(p, slot, template, name, seed) {
  const n = (p.islands || []).length + 2, T = TEMPLATES[template] || TEMPLATES.harbour;
  const radius = Math.round(T.radius[0] + (T.radius[1] - T.radius[0]) * rnd(seed, 'radius'));
  return { id: `isl-${n}`, name: String(name || '').trim().slice(0, 40) || `${T.label} ${n}`, template, seed: String(seed), center: { ...slot.center }, radius };
}
