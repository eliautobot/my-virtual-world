// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Doors (2026-10-05: "doors on buildings and apartments ... make them open and close"). A floor's doors are read from
// what the floor already is, so every floor — generated, changed by hand, saved and laid out again — has them without new
// data: the building's entrance on the street floor, the doors the generators leave in their walls (L.doors), and every
// doorway left in a line of inner walls (the walls tool's doorways); a door in a flat's corridor wall is its front door.
import { WALL_T } from './constants.js';

const DOOR_MIN = 0.6, DOOR_MAX = 1.6;   // m: a gap in a line of walls this wide is a doorway
/**
 * The doorways in a list of inner walls: gaps DOOR_MIN…DOOR_MAX wide between pieces of wall on one straight line (walls
 * running along x or z). [{ x, z, w, axis: 'x' | 'z' (the way the doorway runs), glass }]
 */
export function wallDoorways(walls) {
  const lines = new Map();
  for (const w of walls || []) {
    const dx = w[2] - w[0], dz = w[3] - w[1];
    let axis, c, a, b;
    if (Math.abs(dz) < 1e-3) { axis = 'x'; c = (w[1] + w[3]) / 2; a = Math.min(w[0], w[2]); b = Math.max(w[0], w[2]); }
    else if (Math.abs(dx) < 1e-3) { axis = 'z'; c = (w[0] + w[2]) / 2; a = Math.min(w[1], w[3]); b = Math.max(w[1], w[3]); }
    else continue;
    const key = `${axis}${Math.round(c * 50)}`;
    if (!lines.has(key)) lines.set(key, { axis, c, segs: [] });
    lines.get(key).segs.push([a, b, w[4] || 0]);
  }
  const out = [];
  for (const { axis, c, segs } of lines.values()) {
    segs.sort((p, q) => p[0] - q[0]);
    for (let i = 0; i + 1 < segs.length; i++) {
      const g0 = segs[i][1], g1 = segs[i + 1][0], g = g1 - g0;
      if (g < DOOR_MIN || g > DOOR_MAX) continue;
      const m = (g0 + g1) / 2, glass = !!(segs[i][2] && segs[i + 1][2]);
      out.push(axis === 'x' ? { x: m, z: c, w: g, axis, glass } : { x: c, z: m, w: g, axis, glass });
    }
  }
  return out;
}

const STOREFRONT = new Set(['shop', 'cafe', 'restaurant', 'gym', 'office', 'hq']);
/**
 * The doors of floor f of building B (layout L), in the building's own frame: [{ key, kind: 'entrance' | 'flat' |
 * 'room', x, z, w, axis, swing (+1 / -1: the side it opens to, along the doorway's normal), style: 'slide' (glass
 * doors that part) | 'double' | 'single', glass, u (a flat's index in L.units) }]. key is stable while the door stays.
 */
export function levelDoors(B, f, L) {
  const out = [];
  if (!B || B.type === 'park' || !L) return out;
  if (f === 0 && B.door) {
    const w = B.door.w || 2.4, store = STOREFRONT.has(B.type);
    out.push({ key: 'entrance', kind: 'entrance', x: B.door.x || 0, z: B.d / 2 - WALL_T / 2, w, axis: 'x', swing: -1, style: store ? 'slide' : 'double', glass: store });
  }
  // the doors the generator left (while a wall still ends at one of their sides), then doorways made by hand
  const walls = L.walls || [], ends = walls.flatMap(w => [[w[0], w[1]], [w[2], w[3]]]);
  const jambed = d => { const h = d.w / 2, j = d.axis === 'x' ? [[d.x - h, d.z], [d.x + h, d.z]] : [[d.x, d.z - h], [d.x, d.z + h]]; return j.some(([x, z]) => ends.some(e => Math.abs(e[0] - x) < 0.15 && Math.abs(e[1] - z) < 0.15)); };
  const found = (L.doors || []).filter(jambed);
  for (const d of wallDoorways(walls)) if (!found.some(e => Math.abs(e.x - d.x) < 0.3 && Math.abs(e.z - d.z) < 0.3)) found.push(d);
  const units = L.units || [];
  for (const d of found) {
    let u = -1;
    if (d.axis === 'x') u = units.findIndex(n => n.door && Math.abs(n.door[0] - d.x) < 0.3 && Math.abs(n.door[1] - d.z) < 0.3);
    const flat = u >= 0, swing = flat ? (units[u].z0 + units[u].z1 > 0 ? 1 : -1) : 1;
    out.push({ key: `${flat ? 'flat' : 'room'}:${Math.round(d.x * 20)}:${Math.round(d.z * 20)}`, kind: flat ? 'flat' : 'room', x: d.x, z: d.z, w: d.w, axis: d.axis, glass: !!d.glass, swing, style: d.w > 1.25 ? 'double' : 'single', ...(flat ? { u } : {}) });
  }
  return out;
}
