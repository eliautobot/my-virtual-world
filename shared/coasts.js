// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Coast classes (WP4.15, wp4-world-spec.md §3.3, DECISIONS E25): the main island's coastline is cut into sectors round
// its centre, each with a class stored in world.terrain.coasts (one letter per sector):
//   s  public shore (beach, promenade, shore park) — the municipality's; no waterfront lots; never grows;
//   g  growth coast (port, industrial shore, reserved headland) — new land, piers, bridges and causeways may start here;
//   w  protected waterfront — lots may face the water, and a clear-water corridor (500 ft) in front of it stays open:
//      no new land, bridge, pier or island may enter it;
//   o  open-ocean frontage — protected waterfront whose view out to sea is protected too (a view cone).
// The islands of the chain (shared/island-chain.js) have coasts of their own, ISLE_SECTORS round each island's centre,
// stored on the island (coasts); by default the stretch facing the main island is a growth coast (where its bridge or
// ferry lands) and the rest public shore. The same rules run in the browser's tools and on the server.
import { chainLandness } from './island-chain.js';

export const COAST_CLASSES = Object.freeze({
  s: { label: 'Public shore', color: '#e9d8a6' },
  g: { label: 'Growth coast', color: '#f4a261' },
  w: { label: 'Protected waterfront', color: '#2a9d8f' },
  o: { label: 'Open-ocean frontage', color: '#3a86ff' },
});
export const SECTORS = 72, ISLE_SECTORS = 36;
export const CORRIDOR = 500 * 0.3048;     // m of clear water in front of protected waterfront (policy value)
export const VIEW_HALF = 12 * Math.PI / 180;   // half-width of an open-ocean view cone

const cache = new WeakMap();
/** The main island's coastline: SECTORS points (one per sector's middle angle) where its land meets the sea, outermost. */
export function coastline(island) {
  let c = cache.get(island); if (c) return c;
  const p = island.p, out = [];
  for (let k = 0; k < SECTORS; k++) {
    const a = (k + 0.5) / SECTORS * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    // from well out at sea inwards to the first land: the outer shore
    let r = p.radius * 1.5;
    while (r > 50 && island._landMain(p.center.x + dx * r, p.center.z + dz * r) <= 0) r -= 20;
    let lo = r, hi = r + 20;
    for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (island._landMain(p.center.x + dx * m, p.center.z + dz * m) > 0) lo = m; else hi = m; }
    out.push({ k, a, x: p.center.x + dx * lo, z: p.center.z + dz * lo, nx: dx, nz: dz });
  }
  cache.set(island, out);
  return out;
}
/** The classes of the main island's sectors: stored, or the default (a growth coast at the harbour by the city). */
export function coastClasses(p) {
  if (typeof p.coasts === 'string' && p.coasts.length === SECTORS && /^[sgwo]+$/.test(p.coasts)) return p.coasts;
  const cx = (p.city.x0 + p.city.x1) / 2, cz = p.city.z1 + p.cityCoast;   // the shore beyond the city
  const a = Math.atan2(cz - p.center.z, cx - p.center.x), k0 = Math.floor((((a / (Math.PI * 2)) % 1 + 1) % 1) * SECTORS);
  let s = '';
  for (let k = 0; k < SECTORS; k++) { const d = Math.min(Math.abs(k - k0), SECTORS - Math.abs(k - k0)); s += d <= 2 ? 'g' : 's'; }
  return s;
}
/** The sector a point lies in (by its angle round the main island's centre). */
export function sectorAt(p, x, z) {
  const a = Math.atan2(z - p.center.z, x - p.center.x);
  return Math.floor((((a / (Math.PI * 2)) % 1 + 1) % 1) * SECTORS) % SECTORS;
}
const segDist = (px, pz, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / L2)); return Math.hypot(a.x + dx * t - px, a.z + dz * t - pz); };

// ---------------------------------------------------------------- the islands of the chain
const isleCache = new WeakMap();
/** Island I's coastline (I prepared, as Island keeps them in _chain): ISLE_SECTORS points, outermost shore. */
export function isleCoastline(I) {
  let c = isleCache.get(I); if (c) return c;
  const out = [];
  for (let k = 0; k < ISLE_SECTORS; k++) {
    const a = (k + 0.5) / ISLE_SECTORS * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    let r = I.radius * 1.65;
    while (r > 20 && chainLandness(I, I.center.x + dx * r, I.center.z + dz * r) <= 0) r -= 25;
    let lo = r, hi = r + 25;
    for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (chainLandness(I, I.center.x + dx * m, I.center.z + dz * m) > 0) lo = m; else hi = m; }
    out.push({ k, a, x: I.center.x + dx * lo, z: I.center.z + dz * lo, nx: dx, nz: dz });
  }
  isleCache.set(I, out);
  return out;
}
/** The classes of island I's sectors (p: world.terrain): stored, or the default (a growth coast facing the main island). */
export function isleClasses(I, p) {
  if (typeof I.coasts === 'string' && I.coasts.length === ISLE_SECTORS && /^[sgwo]+$/.test(I.coasts)) return I.coasts;
  const a = Math.atan2(p.center.z - I.center.z, p.center.x - I.center.x), k0 = Math.floor((((a / (Math.PI * 2)) % 1 + 1) % 1) * ISLE_SECTORS);
  let s = '';
  for (let k = 0; k < ISLE_SECTORS; k++) { const d = Math.min(Math.abs(k - k0), ISLE_SECTORS - Math.abs(k - k0)); s += d <= 2 ? 'g' : 's'; }
  return s;
}
export function isleSectorAt(I, x, z) {
  const a = Math.atan2(z - I.center.z, x - I.center.x);
  return Math.floor((((a / (Math.PI * 2)) % 1 + 1) % 1) * ISLE_SECTORS) % ISLE_SECTORS;
}
/** Whose land (x, z) is, within m of the shore: 'main', a chain island (prepared), or null at sea. */
export function landOf(island, x, z, m = 0.05) {
  if (island._landMain(x, z) > -m) return 'main';
  for (const I of island._chain || []) if (Math.hypot(x - I.center.x, z - I.center.z) < I.radius * 1.7 && chainLandness(I, x, z) > -m) return I;
  return null;
}
/** Every stretch of protected coast, main island and chain: [{ a, b, c }] (its two coastline points and its class). */
function protectedStretches(island) {
  const out = [], p = island.p, cls = coastClasses(p), C = coastline(island);
  for (let k = 0; k < SECTORS; k++) if (cls[k] === 'w' || cls[k] === 'o') out.push({ a: C[k], b: C[(k + 1) % SECTORS], c: cls[k] });
  for (const I of island._chain || []) {
    const ic = isleClasses(I, p); if (!/[wo]/.test(ic)) continue;
    const L = isleCoastline(I);
    for (let k = 0; k < ISLE_SECTORS; k++) if (ic[k] === 'w' || ic[k] === 'o') out.push({ a: L[k], b: L[(k + 1) % ISLE_SECTORS], c: ic[k] });
  }
  return out;
}

/**
 * Why a disc of water (x, z, r) may not be built on (new land, a bridge pier, an island), or null: it enters the clear
 * water in front of protected waterfront, or an open-ocean view — of the main island or of an island of the chain.
 */
export function protectedWhy(island, x, z, r = 0) {
  for (const { a, b, c } of protectedStretches(island)) {
    if (segDist(x, z, a, b) < CORRIDOR + r) return `It would enter the clear water kept in front of the ${c === 'o' ? 'open-ocean frontage' : 'protected waterfront'}`;
    if (c === 'o') {   // the view out to sea from this stretch of coast
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, ox = (a.nx + b.nx) / 2, oz = (a.nz + b.nz) / 2;
      const vx = x - mx, vz = z - mz, d = Math.hypot(vx, vz), cos = (vx * ox + vz * oz) / (d * Math.hypot(ox, oz) || 1);
      if (d > 0 && Math.acos(Math.max(-1, Math.min(1, cos))) - Math.atan2(r, d) < VIEW_HALF) return 'It would stand in the protected view out to the open ocean';
    }
  }
  return null;
}
/** Whether growth (new land, piers, bridges) may leave the coast near (x, z): the stretch there is a growth coast — the
 *  main island's, or that of the island of the chain whose shore it is. */
export function growthAt(island, x, z) {
  const who = landOf(island, x, z, 0.3);
  if (who && who !== 'main') return isleClasses(who, island.p)[isleSectorAt(who, x, z)] === 'g';
  return coastClasses(island.p)[sectorAt(island.p, x, z)] === 'g';
}
