// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Jumping onto things (2026-10-05: "colliders on objects so players can jump on things" — without a physics
// engine). Every catalog item already has a height; this adds where a body stands on it (a desk's top, not its
// screen; a bench's seat, not its back). A body walks into anything whose top is above its feet + STEP, steps or lands
// onto anything lower, and falls off edges. Shared by the browser (client/js/player/player.js) and the server
// (shared/playernav.js), so a player standing on a table is not refused as "inside the table".
import { CATALOG } from './catalog.js';
import { inItemRect, itemRect } from './geom.js';

export const STEP = 0.36;          // climbed without jumping (a kerb, a step)
export const GRAVITY = 9.8;
export const JUMP_V = 4.6;         // take-off speed (m/s): feet rise ~1.08 m
export const JUMP_PEAK = JUMP_V * JUMP_V / (2 * GRAVITY);
export const STAND_TOL = 0.1;      // the server's slack over the browser's step rule

// Standing heights where an item's h counts something taller than its surface (backs, screens, chairs).
const TOP = {
  desk: 0.76, desk_l: 0.76, desk_exec: 0.76, desk_home: 0.76, standing_desk: 1.05, meeting_table: 0.76, reception: 1.05,
  sofa: 0.45, sofa_l: 0.45, armchair: 0.45, beanbag: 0.4, tv_stand: 0.55, pingpong: 0.76, counter: 0.92,
  dining_table: 0.76, cafe_table: 0.76, cafe_table4: 0.76, bar_counter: 1.08, checkout: 0.9, bed_double: 0.55,
  bed_single: 0.55, nightstand: 0.6, toilet: 0.45, bench: 0.48, picnic_table: 0.78, flowers: 0.3,
};
/** The height a body stands at on top of an item of type t (tall things: their full height, out of reach). */
export function itemTop(t) { const d = CATALOG[t]; return d ? (TOP[t] ?? d.h ?? 3) : 3; }
// Round things whose height changes across them, by distance from their centre: the park fountain (client/js/render/
// furniture.js FOUNTAIN) — its column, the pool floor you wade on, the coping you stand on, the step.
const RADIAL = {
  fountain: r => (r < 1.55 ? 2.6 : r < 2.62 ? 0.1 : r <= 3.1 ? 0.56 : 0.1),   // under the lower bowl: no room for a head
};
/** The highest point of item it under a body of radius pad at (x, z) (its own frame unrotated: round items only). */
function heightOn(it, x, z, pad) {
  const f = RADIAL[it.t];
  if (!f) return (it.y || 0) + itemTop(it.t);
  const r = Math.hypot(x - it.x, z - it.z);
  return (it.y || 0) + Math.max(f(Math.max(0, r - pad)), f(r), f(r + pad));
}
/** The highest top among `items` ([{ t, x, z, r, y? }], one coordinate frame) under a body of radius pad at (x, z),
 *  with only tops at or below `maxTop` counted; -Infinity when none. */
export function topUnder(items, x, z, pad, maxTop = Infinity) {
  let top = -Infinity;
  for (const it of items) {
    const d = CATALOG[it.t];
    if (!d || !d.rect || d.block === false) continue;
    if (!inItemRect(x, z, it.x, it.z, it.r || 0, itemRect(it, d.rect), pad)) continue;
    const h = heightOn(it, x, z, pad);
    if (h > top && h <= maxTop) top = h;
  }
  return top;
}
/** Whether an item taller than `feet` + STEP covers (x, z) for a body of radius pad (it walls the body off). */
export function tallUnder(items, x, z, pad, feet) {
  for (const it of items) {
    const d = CATALOG[it.t];
    if (!d || !d.rect || d.block === false) continue;
    if (inItemRect(x, z, it.x, it.z, it.r || 0, itemRect(it, d.rect), pad) && heightOn(it, x, z, pad) > feet + STEP) return true;
  }
  return false;
}
// A park's edge (client/js/render/interiors.js parkEdge draws it): hedges 0.97 m high, gate posts 1.35 m, from the
// lot's edge inset e, half thickness th, gaps of ±gap in the middle of each side.
export const PARK_EDGE = Object.freeze({ e: 0.35, th: 0.28, gap: 1.7, hedge: 0.97, post: 0.29, postTop: 1.35 });
/** What a park's edge rises to at local (lx, lz) for a body of radius pad (park half sizes hw, hd): 0, a hedge or a post. */
export function parkEdgeTop(hw, hd, lx, lz, pad) {
  const { e, th, gap, hedge, post, postTop } = PARK_EDGE, ax = Math.abs(lx), az = Math.abs(lz), pr = post + pad;
  if ((Math.abs(ax - gap) < pr && Math.abs(az - (hd - e)) < pr) || (Math.abs(az - gap) < pr && Math.abs(ax - (hw - e)) < pr)) return postTop;
  if (Math.abs(az - (hd - e)) < th + pad && ax < hw - e + th + pad && ax > gap) return hedge;
  if (Math.abs(ax - (hw - e)) < th + pad && az < hd - e + th + pad && az > gap) return hedge;
  return 0;
}
