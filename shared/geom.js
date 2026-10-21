// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Building-local <-> world transforms and rectangle helpers.
// Building local frame: origin at footprint centre, +z = front (entrance side), +x = local right-hand of the facade
// when looking at it from the street (three.js convention: world = rotateY(rot) * local + centre).
import { SIGN_RIM } from './constants.js';

export const DEG = Math.PI / 180;

export function bRot(b) { return (b.rot || 0) * DEG; }

export function toWorld(b, lx, lz, out = {}) {
  const r = bRot(b), c = Math.cos(r), s = Math.sin(r);
  out.x = b.x + lx * c + lz * s;
  out.z = b.z - lx * s + lz * c;
  return out;
}
export function toLocal(b, wx, wz, out = {}) {
  const r = bRot(b), c = Math.cos(r), s = Math.sin(r);
  const dx = wx - b.x, dz = wz - b.z;
  out.x = dx * c - dz * s;
  out.z = dx * s + dz * c;
  return out;
}
/** Whether a building is turned by a multiple of 90° (the city's buildings are; beyond the city they face their road). */
export const square = b => (b.rot || 0) % 90 === 0;
/** World-space axis-aligned bounds of a building's footprint (exact for square turns; else the turned rectangle's bounds). */
export function footprint(b, pad = 0) {
  if (square(b)) {
    const r = (((b.rot || 0) % 180) + 180) % 180;
    const hw = (r === 90 ? b.d : b.w) / 2 + pad, hd = (r === 90 ? b.w : b.d) / 2 + pad;
    return { x0: b.x - hw, x1: b.x + hw, z0: b.z - hd, z1: b.z + hd };
  }
  const r = bRot(b), c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const ex = (b.w / 2 + pad) * c + (b.d / 2 + pad) * s, ez = (b.w / 2 + pad) * s + (b.d / 2 + pad) * c;
  return { x0: b.x - ex, x1: b.x + ex, z0: b.z - ez, z1: b.z + ez };
}
/** The footprint's corners in world space, counter-clockwise seen from above (front-left, front-right, back-right,
 *  back-left), grown by pad on every side. */
export function corners(b, pad = 0) {
  const hw = b.w / 2 + pad, hd = b.d / 2 + pad;
  return [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]].map(([x, z]) => toWorld(b, x, z));
}
/** Whether world point (x, z) is within the building's footprint grown by pad. */
export function inFootprint(b, x, z, pad = 0) {
  const l = toLocal(b, x, z, _l);
  return Math.abs(l.x) <= b.w / 2 + pad && Math.abs(l.z) <= b.d / 2 + pad;
}
const _l = {};
/** Whether two buildings' footprints (grown by pad each) overlap — separating axes over both rectangles. */
export function footprintsOverlap(a, b, pad = 0) {
  const A = corners(a, pad), Bc = corners(b, pad);
  for (const P of [A, Bc]) for (let k = 0; k < 2; k++) {
    const ax = P[k + 1].x - P[k].x, az = P[k + 1].z - P[k].z;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const q of A) { const v = q.x * ax + q.z * az; a0 = Math.min(a0, v); a1 = Math.max(a1, v); }
    for (const q of Bc) { const v = q.x * ax + q.z * az; b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}
export function rectsOverlap(a, b, eps = 0) {
  return a.x0 < b.x1 - eps && a.x1 > b.x0 + eps && a.z0 < b.z1 - eps && a.z1 > b.z0 + eps;
}
export function inRect(x, z, r, pad = 0) { return x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad; }

/** Is point (px,pz) inside a rotated local rect [minX,minZ,maxX,maxZ] of an item placed at (ix,iz,rot)? */
export function inItemRect(px, pz, ix, iz, rot, rect, pad = 0) {
  const dx = px - ix, dz = pz - iz, c = Math.cos(rot), s = Math.sin(rot);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return lx >= rect[0] - pad && lx <= rect[2] + pad && lz >= rect[1] - pad && lz <= rect[3] + pad;
}
/** Transform an item-local point to floor-local coordinates. */
export function itemToLocal(item, x, z, out = {}) {
  const r = item.r || 0, c = Math.cos(r), s = Math.sin(r);
  out.x = item.x + x * c + z * s;
  out.z = item.z - x * s + z * c;
  return out;
}
/**
 * An item's local rect [x0, z0, x1, z1]: its type's `rect`, at least as wide as a sign's face (`fw`, m, and its board's
 * rim: shared/signs.js), or grown by the uniform scale `s` signs had before their faces were sized.
 */
export function itemRect(item, rect) {
  if (item.fw > 0) { const hw = item.fw / 2 + SIGN_RIM; return [Math.min(rect[0], -hw), rect[1], Math.max(rect[2], hw), rect[3]]; }
  return item.s > 0 && item.s !== 1 ? rect.map(v => v * item.s) : rect;
}
/** Axis-aligned bounds (floor-local) of an item's rotated local rect (itemRect: a sign's own width). */
export function itemAABB(item, rect0, pad = 0) {
  const rect = itemRect(item, rect0), r = item.r || 0, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const cx = (rect[0] + rect[2]) / 2, cz = (rect[1] + rect[3]) / 2;
  const hw = (rect[2] - rect[0]) / 2, hd = (rect[3] - rect[1]) / 2;
  const cc = Math.cos(r), ss = Math.sin(r);
  const x = item.x + cx * cc + cz * ss, z = item.z - cx * ss + cz * cc;
  const ex = hw * c + hd * s + pad, ez = hw * s + hd * c + pad;
  return { x0: x - ex, x1: x + ex, z0: z - ez, z1: z + ez };
}
export function segDist(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz;
  let t = L2 > 1e-9 ? ((px - x1) * dx + (pz - z1) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = x1 + dx * t - px, qz = z1 + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}
export function normAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
