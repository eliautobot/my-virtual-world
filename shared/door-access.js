// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The way from a building's door to its street (the product owner, 2026-10-09: "lots should connect to roadways so that a
// building can be placed there that connects as they already connect … this has to work flawlessly"). Residents walk
// out of the door in a straight line: in the city to the sidewalk of the block side the door faces (server/sim/nav.js
// accessFor, shared/edit.js accessSegments), beyond the city to the footpath along the nearest road (its edge). The same
// rules in the browser's ghost and on the server: that line may not run through the building itself (a door turned away
// from the road), through another building (beyond the city; the city's own check covers its blocks), or across someone
// else's lot (it would cut through their land, and block what they build there).
import { makeGrid, blockAt, bandPoint, rotToSide } from './city.js';
import { doorPoints } from './building.js';
import { toWorld, inFootprint, corners } from './geom.js';
import { ROAD_REACH } from './island-build.js';

const STEP = 0.5;   // m between the points checked along the way

/** Whether (x, z) is beyond the city's grid. */
const beyond = (g, x, z) => x < g.minX || x > g.maxX || z < g.minZ || z > g.maxZ;

/**
 * The walk from the spot outside building `spec`'s door to its street: { a, b, road } (metres; road: true beyond the
 * city), or null for a park (gates on every side) or a building with no road near its door. net: a RoadNetwork or null.
 */
export function doorWalk(world, spec, net = null) {
  if (!spec || spec.type === 'park') return null;
  const g = makeGrid(world.grid), dp = doorPoints(spec), a = toWorld(spec, dp.outside.x, dp.outside.z);
  if (!beyond(g, spec.x, spec.z)) {
    const blk = blockAt(g, spec.x, spec.z);
    if (!blk) return null;
    const p = bandPoint(g, blk.i, blk.j, rotToSide(spec.rot || 0), a.x, a.z);
    return { a: { x: a.x, z: a.z }, b: { x: p.x, z: p.z }, road: false };
  }
  const near = net ? net.nearest(a.x, a.z, ROAD_REACH + 15) : null;
  if (!near) return null;
  const half = net.profiles[net.get(near.id).profile].outerHalf / 1e6;
  const dx = a.x - near.x, dz = a.z - near.z, L = Math.hypot(dx, dz);
  if (L <= half) return { a: { x: a.x, z: a.z }, b: { x: a.x, z: a.z }, road: true };
  return { a: { x: a.x, z: a.z }, b: { x: near.x + dx / L * half, z: near.z + dz / L * half }, road: true };
}

/** Whether segment p→q comes within `pad` m of building o's footprint. */
function segHitsBuilding(p, q, o, pad) {
  const L = Math.hypot(q.x - p.x, q.z - p.z), n = Math.max(1, Math.ceil(L / STEP));
  for (let k = 0; k <= n; k++) if (inFootprint(o, p.x + (q.x - p.x) * k / n, p.z + (q.z - p.z) * k / n, pad)) return true;
  return false;
}

/**
 * Why the way from building `spec`'s door to its street or road is blocked, or null.
 * o: { net (RoadNetwork, beyond the city), lotAt(x, z) → the id of the lot there or null (on a world with lots),
 *      lot (the building's own lot id), ignoreIdx (the building being moved) }
 */
export function doorReason(world, spec, { net = null, lotAt = null, lot = null, ignoreIdx = -1 } = {}) {
  const w = doorWalk(world, spec, net);
  if (!w) return null;
  const where = w.road ? 'road' : 'street';
  const L = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z), n = Math.max(1, Math.ceil(L / STEP));
  for (let k = 0; k <= n; k++) {
    const x = w.a.x + (w.b.x - w.a.x) * k / n, z = w.a.z + (w.b.z - w.a.z) * k / n;
    if (inFootprint(spec, x, z, -0.2)) return `Its door faces away from the ${where}: turn it so the door faces the ${where}`;
    if (lotAt) { const id = lotAt(x, z); if (id && id !== lot) return `The way from its door to the ${where} crosses lot ${id}: turn it so the door faces its own ${where}`; }
  }
  if (w.road) {
    // beyond the city: no other building in the way out, and this one in nobody else's
    const box = corners(spec, 120);
    const x0 = Math.min(...box.map(p => p.x)), x1 = Math.max(...box.map(p => p.x)), z0 = Math.min(...box.map(p => p.z)), z1 = Math.max(...box.map(p => p.z));
    for (const o of world.buildings || []) {
      if (!o || o.gone || o.idx === ignoreIdx || o.base === undefined || o.x < x0 || o.x > x1 || o.z < z0 || o.z > z1) continue;
      if (segHitsBuilding(w.a, w.b, o, 0.3)) return `${o.name || 'Another building'} is in the way between its door and the road`;
      const ow = doorWalk(world, o, net);
      if (ow && segHitsBuilding(ow.a, ow.b, spec, 0.3)) return `It would stand between ${o.name || 'another building'}'s door and the road`;
    }
  }
  return null;
}
