// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Platting lots along a road beyond the city (WP4.14, wp4-world-spec.md §5.0a, §5.5): standard lots (100 × 100 ft
// unless the administrator picks another size) side by side just behind the back of a road's sidewalk or shoulder.
// Their side lines are square to the road and shared exactly with their neighbours; their fronts follow its curve.
// Lots that would reach into water, the city, another road or a junction, overlap a lot or a building, or come out
// twisted (on a bend tighter than they are deep) are left out and counted. The same function previews the lots in the
// browser and plats them on the server (server/property-routes.js), so what the administrator sees is what is made.
import { pointAt } from './roads.js';
import { mToUm } from './units.js';
import { normalize, isSimple, overlaps, bbox } from './lots.js';
import { corners, segDist } from './geom.js';

const UM = 1e-6;
const SAG = 0.01;         // m: a lot's front follows a bend with corners so that it never strays further from it
const MARCH = 0.25;       // m: the step used to measure along the back of the road
const INSET = 0.02;       // m between the back of the road and the lots: lots never touch a road's corridor
export const SIDES = ['both', 'a', 'b'];

/** What side `sign` (1: left of the road's direction) of road `G` is called in the tools: inner or outer on a ring
 *  road, else the compass side it faces (−z is north on the maps). */
export function sideName(G, sign) {
  let nx = 0, nz = 0, cx = 0, cz = 0, inward = 0; const q = {}, pts = [];
  for (let k = 0; k < 16; k++) { pointAt(G, G.length * k / 16, q); pts.push({ x: q.x, z: q.z, nx: -q.dz * sign, nz: q.dx * sign }); cx += q.x / 16; cz += q.z / 16; }
  if (G.closed) { for (const p of pts) inward += p.nx * (cx - p.x) + p.nz * (cz - p.z); return inward > 0 ? 'inner' : 'outer'; }
  for (const p of pts) { nx += p.nx; nz += p.nz; }
  return Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? 'east' : 'west') : (nz > 0 ? 'south' : 'north');
}

/**
 * Lots along road `roadId` of RoadNetwork `net`.
 * o: { side: 'both' | 'a' (left of the road's direction) | 'b', from, to (m along the road; default all of it),
 *      count (at most this many lots on each side, the first that fit from `from` on; default as many as fit), width, depth (m), isWater(x, z), city: { x0, z0, x1, z1 } (m), lots: existing lots [{ poly (µm) }],
 *      buildings: [{ x, z, w, d, rot }], pads: junction and turning-circle areas [{ x, z, r, foot? }],
 *      feet: keep clear of a junction's paved footprint only (its corners' lots, a grid's), not the circle round it,
 *      even: `count` lots of equal width filling exactly from `from` to `to` (width is then only checked) }
 * Returns { lots: [{ poly (µm), frontage: [{ road, side, s0, s1 }], side }], skipped: { water, city, road, junction, lot,
 * building, shape } (counts) }.
 */
export function platAlongRoad(net, roadId, o) {
  const G = net.geometry(roadId), rec = net.get(roadId);
  if (!G || !rec) throw new Error('No such road');
  const P = net.profiles[rec.profile], back = P.outerHalf * UM + INSET;
  const width = o.width, depth = o.depth, L = G.length;
  if (!(width >= 5 && width <= 200 && depth >= 5 && depth <= 200)) throw new Error('Lots must be 5 to 200 m wide and deep');
  const from = Math.max(0, Math.min(L, o.from ?? 0)), to = Math.max(from, Math.min(L, o.to ?? L));
  const skipped = { water: 0, city: 0, road: 0, junction: 0, lot: 0, building: 0, shape: 0 }, out = [];
  const existing = (o.lots || []).map(l => ({ poly: l.poly, b: bbox(l.poly) }));
  const blds = (o.buildings || []).map(B => { const poly = corners(B).map(p => ({ x: mToUm(p.x), z: mToUm(p.z) })); return { poly, b: bbox(poly) }; });
  const city = o.city, inCity = (x, z) => city && x > city.x0 - 1 && x < city.x1 + 1 && z > city.z0 - 1 && z < city.z1 + 1;
  const q = {};
  const count = Number.isInteger(o.count) && o.count > 0 ? o.count : Infinity;
  for (const sign of o.side === 'a' ? [1] : o.side === 'b' ? [-1] : [1, -1]) {
    let made = 0, tried = 0;
    const at = s => { pointAt(G, s, q); return { x: q.x - q.dz * back * sign, z: q.z + q.dx * back * sign, nx: -q.dz * sign, nz: q.dx * sign }; };
    let s = from, prev = at(s);
    while (s < to && made < count && (!o.even || tried < count)) {
      // March along the back of the road until the front is `width` long; on a bend, add a corner wherever a straight
      // front would stray more than SAG from it (a straight road's lots are four-cornered).
      const front = [prev]; let len = 0, cur = prev, s1 = s, run = [];
      // even: the run split into `count` equal lots exactly from `from` to `to` (a grid's blocks: lots reaching the
      // sidewalks at both ends — 2026-10-14, a strip was left where the last lot of a run fell short)
      const end = o.even && Number.isFinite(count) ? Math.min(to, from + (to - from) * (++tried) / count) : null;
      while (end !== null ? s1 < end : len < width && s1 < to) {
        s1 = Math.min(end ?? to, s1 + MARCH);
        const nxt = at(s1); len += Math.hypot(nxt.x - cur.x, nxt.z - cur.z);
        run.push(nxt);
        const lc = front.at(-1), mid = run[run.length >> 1];
        if (run.length > 2 && segDist(mid.x, mid.z, lc.x, lc.z, nxt.x, nxt.z) > SAG) { front.push(run[run.length - 2]); run = [nxt]; }
        cur = nxt;
      }
      if (end === null && len < width - 0.05) break;   // what is left is shorter than a lot
      front.push(cur);
      const a = front[0], b = front.at(-1);
      let ring = [...front, { x: b.x + b.nx * depth, z: b.z + b.nz * depth }, { x: a.x + a.nx * depth, z: a.z + a.nz * depth }];
      if (o.feet) ring = trimFeet(ring, o.pads || []);   // a corner lot gives up the rounded corner of the junction's sidewalk
      const poly = ring.map(p => ({ x: mToUm(p.x), z: mToUm(p.z) }));
      const why = reject(ring, poly);
      if (why) skipped[why]++;
      else { out.push({ poly: normalize(poly), side: sign > 0 ? 'a' : 'b', frontage: [{ road: roadId, side: sign > 0 ? 'a' : 'b', s0: +s.toFixed(2), s1: +s1.toFixed(2) }] }); existing.push({ poly, b: bbox(poly) }); made++; }
      s = s1; prev = cur;
    }
  }
  return { lots: out, skipped };

  function reject(ring, poly) {
    if (!isSimple(poly)) return 'shape';
    if (ring.some(p => inCity(p.x, p.z))) return 'city';
    // water anywhere on the lot (its corners, its middle and a grid across it)
    let cx = 0, cz = 0; for (const p of ring) { cx += p.x; cz += p.z; } cx /= ring.length; cz /= ring.length;
    const pts = [...ring, { x: cx, z: cz }];
    const A = ring[0], Bf = ring[ring.length - 3], Bb = ring[ring.length - 2], Ab = ring[ring.length - 1];
    for (let i = 1; i < 4; i++) for (let k = 1; k < 4; k++) {
      const u = i / 4, v = k / 4, fx = A.x + (Bf.x - A.x) * u, fz = A.z + (Bf.z - A.z) * u, bx = Ab.x + (Bb.x - Ab.x) * u, bz = Ab.z + (Bb.z - Ab.z) * u;
      pts.push({ x: fx + (bx - fx) * v, z: fz + (bz - fz) * v });
    }
    if (o.isWater && pts.some(p => o.isWater(p.x, p.z))) return 'water';
    if (net.corridorHits(ring).length) return 'road';
    for (const C of o.pads || []) {
      if (o.feet && C.foot) { if (Math.hypot(cx - C.x, cz - C.z) < C.r + depth + width && footMeets(C.foot, ring)) return 'junction'; }
      else if (distToRing(ring, C.x, C.z) < C.r + 2) return 'junction';
    }
    const b = bbox(poly), meets = e => e.b.x0 <= b.x1 && e.b.x1 >= b.x0 && e.b.z0 <= b.z1 && e.b.z1 >= b.z0;
    if (existing.some(e => meets(e) && overlaps(e.poly, poly))) return 'lot';
    if (blds.some(e => meets(e) && overlaps(e.poly, poly))) return 'building';
    return null;
  }
}
const inPoly = (p, x, z) => { let k = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) k = !k; } return k; };
/** A lot's corner standing on a junction's paved footprint (where the sidewalk rounds the corner) cut off: the corner
 *  becomes two points, where its two sides leave the paving (a little beyond), the cut a chord inside the curb's curve. */
function trimFeet(ring, pads) {
  const feet = pads.filter(C => C.foot).flatMap(C => C.foot);
  const paved = q => feet.some(F => q.x > F.x0 && q.x < F.x1 && q.z > F.z0 && q.z < F.z1 && inPoly(F.p, q.x, q.z));
  const out = [];
  ring.forEach((q, i) => {
    if (!paved(q)) { out.push(q); return; }
    for (const nb of [ring[(i - 1 + ring.length) % ring.length], ring[(i + 1) % ring.length]]) {
      const L = Math.hypot(nb.x - q.x, nb.z - q.z); let t = 0;
      while (t < L * 0.9 && paved({ x: q.x + (nb.x - q.x) * t / L, z: q.z + (nb.z - q.z) * t / L })) t += 0.05;
      t = Math.min(L * 0.9, t + 0.1);   // (a lot too small for its corner's curve comes out twisted, and is left out)
      out.push({ x: q.x + (nb.x - q.x) * t / L, z: q.z + (nb.z - q.z) * t / L });
    }
  });
  return out;
}
/** Whether a junction's paved footprint (shared/island-roads.js footOf: polygons) reaches into a lot's ring. */
function footMeets(foot, ring) {
  // (paving that only touches the lot's edge — the back of a sidewalk running along it — doesn't count: 10 cm in)
  let cx = 0, cz = 0; for (const q of ring) { cx += q.x / ring.length; cz += q.z / ring.length; }
  const pull = q => { const L = Math.hypot(cx - q.x, cz - q.z) || 1; return { x: q.x + (cx - q.x) / L * 0.1, z: q.z + (cz - q.z) / L * 0.1 }; };
  const deep = ring.map(pull);
  for (const F of foot) {
    if (F.p.some(q => inPoly(deep, q.x, q.z) && distToRing(ring.map(pull), q.x, q.z) === 0 && edgeDist(ring, q.x, q.z) > 0.1)) return true;
    for (let i = 0; i < deep.length; i++) {
      const a = deep[i], b = deep[(i + 1) % deep.length];
      for (let t = 0; t <= 8; t++) { const x = a.x + (b.x - a.x) * t / 8, z = a.z + (b.z - a.z) * t / 8; if (x > F.x0 && x < F.x1 && z > F.z0 && z < F.z1 && inPoly(F.p, x, z)) return true; }
    }
  }
  return false;
}
/** Distance (m) from a point to a ring's edges. */
function edgeDist(ring, x, z) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[j], b = ring[i], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz, t = L2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0; best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z)); }
  return best;
}
/** Distance (m) from a point to a ring's area (0 inside). */
function distToRing(ring, x, z) {
  let inside = false, best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    if ((a.z > z) !== (b.z > z) && x < a.x + (z - a.z) * (b.x - a.x) / (b.z - a.z)) inside = !inside;
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz, t = L2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
    best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
  }
  return inside ? 0 : best;
}
