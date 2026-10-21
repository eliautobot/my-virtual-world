// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Where a terrain stroke may go (WP4.7, wp4-world-spec.md §9: terrain and water are administrators' tools, checked over
// the whole affected area): on the island's land, clear of the city's ground, every road (its corridor, junctions and
// the land graded to it), every building beyond the city (its pad and yard) and every lot someone other than the city
// holds. A pond's water level is set here so it never spills: just under the lowest ground around its rim.
import { EDIT_LIMITS } from './terrain-edits.js';
import { corners } from './geom.js';
import { protectedWhy, growthAt } from './coasts.js';

const ROAD_BLEND = 16;   // m beyond a road's corridor that its grading reaches (shared/island-roads.js BLEND + margin)
const PAD_YARD = 8;      // m around a building's pad that is graded to it
const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** Whether (x, z) lies within reach of the main island or one of the chain. */
function onSomeIsland(T, x, z) {
  if (Math.hypot(x - T.center.x, z - T.center.z) <= T.radius * 1.3) return true;
  return (T.islands || []).some(I => Math.hypot(x - I.center.x, z - I.center.z) <= I.radius * 1.5);
}
/** The nearest land within r of (x, z) (sampled), with whether it belongs to an island of the chain, or null. */
function nearLand(island, x, z, r) {
  let best = null;
  for (let ring = 0; ring <= 6; ring++) {
    const rr = r * ring / 6;
    for (let k = 0; k < (ring ? 24 : 1); k++) {
      const a = k / 24 * Math.PI * 2, px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      if (island.landness(px, pz) > 0 && (!best || rr < best.d)) best = { x: px, z: pz, d: rr, chain: island._landMain(px, pz) <= 0 };
    }
    if (best) return best;
  }
  return null;
}
/** Distance (m) from a point to a polygon [{x, z}] (0 inside). */
function distToPoly(P, x, z) {
  let inside = false, best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[j], b = P[i];
    if ((a.z > z) !== (b.z > z) && x < a.x + (z - a.z) * (b.x - a.x) / (b.z - a.z)) inside = !inside;
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz, t = L2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
    best = Math.min(best, hyp(a.x + dx * t, a.z + dz * t, x, z));
  }
  return inside ? 0 : best;
}

/**
 * Why stroke `rec` can't go into the world, or null; for a pond, sets rec.level. island: the Island as it is now (roads,
 * pads and earlier strokes); lots: lots near the stroke [{ id, poly (µm), holder }].
 */
export function terrainWhy(world, rec, { island, lots = [] }) {
  const T = world.terrain, edits = T.edits || [];
  if (edits.length >= EDIT_LIMITS.maxEdits) return 'This island has as many terrain changes as it can keep';
  if (rec.kind === 'pond' && edits.filter(e => e.kind === 'pond').length >= EDIT_LIMITS.maxPonds) return 'This island has as many ponds as it can keep';
  const reach = rec.r * (rec.kind === 'pond' ? 1.3 : 1);   // a pond's banks reach past its water
  if (T.cityStreets !== null && island.cityDist(rec.x, rec.z) - reach < T.plainMargin) return "Too close to the city: the city's ground stays as it is";
  if (rec.kind === 'reclaim') {   // new land from a growth coast (WP4.15, shared/coasts.js)
    const near = nearLand(island, rec.x, rec.z, rec.r + 120);
    if (!near) return 'New land grows out from the coast; start it at the shore';
    if (!near.chain && !growthAt(island, near.x, near.z)) return 'Land grows only from a growth coast; mark the coast there as one first';
    const why = protectedWhy(island, rec.x, rec.z, rec.r);
    if (why) return why;
    if (!(rec.level >= T.seaLevel + 0.8 && rec.level <= T.seaLevel + 6)) return 'Reclaimed land stands a little above the sea';
  } else {
    if (island.waterAt(rec.x, rec.z)?.kind === 'sea') return 'That is in the sea; use Reclaim land on a growth coast';
    if (!onSomeIsland(T, rec.x, rec.z)) return 'That is off the island';
  }
  const R = island.roads;
  if (R) {
    const near = R.net.nearest(rec.x, rec.z, reach + 60);
    if (near && near.dist - R.half.get(near.id) < reach + ROAD_BLEND) return `It would change the ground under ${R.net.get(near.id).name || 'a road'}`;
    for (const P of R.pads || []) if (hyp(P.x, P.z, rec.x, rec.z) < reach + P.r + ROAD_BLEND) return 'It would change the ground at a junction';
  }
  for (const B of world.buildings || []) {
    if (!B || B.gone || B.base === undefined) continue;
    if (distToPoly(corners(B, 1.5), rec.x, rec.z) < reach + PAD_YARD) return `It would change the ground under ${B.name || 'a building'}`;
  }
  for (const L of lots) {
    if (!L.holder || L.holder.kind === 'municipality') continue;
    const P = L.poly.map(p => ({ x: p.x / 1e6, z: p.z / 1e6 }));
    if (distToPoly(P, rec.x, rec.z) < reach) return `Lot ${L.id} is held by someone; change only public land`;
  }
  if (rec.kind === 'pond') {
    // The water sits just under the lowest ground around the pond, so it never spills down a slope.
    let rim = island.height(rec.x, rec.z);
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; rim = Math.min(rim, island.height(rec.x + Math.cos(a) * rec.r * 1.25, rec.z + Math.sin(a) * rec.r * 1.25)); }
    const level = Math.round((rim - 0.3) * 100) / 100;
    if (level < T.seaLevel + 0.5) return 'The ground there is too low for a pond; it would run into the sea';
    rec.level = level;
  }
  return null;
}
