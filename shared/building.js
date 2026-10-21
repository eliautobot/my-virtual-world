// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Building entry/exit points shared by server planner, generator and client (player mode).
import { CATALOG } from './catalog.js';
import { WALL_T } from './constants.js';
import { itemToLocal } from './geom.js';

/** Front entrance (local coords). */
export function doorPoints(b) {
  const dx = b.door ? b.door.x : 0;
  return {
    inside: { x: dx, z: b.d / 2 - WALL_T - 0.65 },
    sill: { x: dx, z: b.d / 2 },
    outside: { x: dx, z: b.d / 2 + 0.95 },
  };
}
/** Parks have four gates: local side k (0 front +z, 1 +x, 2 -z, 3 -x). */
export function gatePoints(b) {
  const hw = b.w / 2, hd = b.d / 2;
  return [
    { k: 0, inside: { x: 0, z: hd - 0.9 }, outside: { x: 0, z: hd + 0.95 } },
    { k: 1, inside: { x: hw - 0.9, z: 0 }, outside: { x: hw + 0.95, z: 0 } },
    { k: 2, inside: { x: 0, z: -hd + 0.9 }, outside: { x: 0, z: -hd - 0.95 } },
    { k: 3, inside: { x: -hw + 0.9, z: 0 }, outside: { x: -hw - 0.95, z: 0 } },
  ];
}
/** Waiting points in front of each elevator door (local coords) + yaw facing the door (local). */
export function elevatorStops(b) {
  const c = b.core; if (!c) return [];
  const def = CATALOG[c.t];
  return def.doors.map(([dx, dz]) => {
    const p = itemToLocal(c, dx, dz + 0.62), q = itemToLocal(c, dx, dz - 0.35);
    return { x: p.x, z: p.z, ix: q.x, iz: q.z, yaw: Math.PI + (c.r || 0) };
  });
}
/** Entry points used for level connectivity checks. */
export function levelEntries(b, f) {
  const out = [];
  if (b.type === 'park') for (const g of gatePoints(b)) out.push(g.inside);
  else if (f === 0) out.push(doorPoints(b).inside);
  for (const s of elevatorStops(b)) out.push({ x: s.x, z: s.z });
  return out;
}
