// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Shared constants + tiny math helpers. Imported by the Node server AND the browser client.
export const FLOOR_H = 3.4;          // storey height (m)
export const SIGN_RIM = 0.045;      // m: a sign's board beyond its face, each side (shared/signs.js, geom.js itemRect)
export const GROUND_Y = 0.15;        // sidewalk / lot surface height (road surface is 0)
export const CELL = 0.5;             // indoor nav grid resolution (m)
export const AGENT_R = 0.22;
export const WALK_SPEED = 1.35;
export const RUN_SPEED = 3.7;
export const JOG_SPEED = 2.7;
export const CROSS_SPEED = 1.6;
export const DEFAULT_DAY_SCALE = 16;  // world seconds per sim second (1 world day = 90 real minutes at 1x)
export const ELEVATOR_BASE = 3.5, ELEVATOR_PER_FLOOR = 0.9;
export const MAX_FLOORS = 48;
export const SIDEWALK = 4.5;          // sidewalk width (curb -> lot line)
export const WALK_BAND = 2.75;        // sidewalk walking centre-line distance from the curb
export const WALL_T = 0.25;           // exterior wall thickness
export const ctxOf = (bIdx, floor) => bIdx * 64 + floor;
export const ctxB = ctx => (ctx < 0 ? -1 : (ctx >> 6));
export const ctxF = ctx => (ctx < 0 ? 0 : (ctx & 63));

export function mod(a, n) { return ((a % n) + n) % n; }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function floorY(f) { return GROUND_Y + f * FLOOR_H; }
/** A building's base (m above the city's ground level): 0 in the city; on the island its level pad's height (WP4.6). */
export const baseOf = B => (B && B.base) || 0;
/** Height of floor f of building B (its base included). */
export function floorAt(B, f) { return floorY(f) + baseOf(B); }
export function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

// ---- Traffic signals: deterministic from sim time, so server + every client agree ----
// axis 0 = vehicles moving along z, axis 1 = vehicles moving along x.
// Cycle (s): 0-10 A0 green, 10-12 A0 yellow, 12-16 A0 left arrow, 16-17 all red,
//            17-27 A1 green, 27-29 A1 yellow, 29-33 A1 left arrow, 33-34 all red,
//            34-54 pedestrian scramble (walk 34-46, flashing 46-54). Cars are all red during the scramble.
export const SIG_CYCLE = 54;
export const SIG_GREEN = [[0, 10], [17, 27]];
export const SIG_LEFT = [[12, 16], [29, 33]];
export const PED_WIN = [34, 54];
export function sigOffset(ix) { return mod(ix * 17.37, SIG_CYCLE); }
export function sigCycle(ix, t) { return mod(t + sigOffset(ix), SIG_CYCLE); }
/** Car light: 0 red, 1 yellow, 2 green, 3 protected-left arrow (through traffic red). */
export function sigLight(ix, t, axis) {
  const c = sigCycle(ix, t);
  if (axis === 0) return c < 10 ? 2 : c < 12 ? 1 : c < 16 ? 3 : 0;
  return c >= 17 && c < 27 ? 2 : c >= 27 && c < 29 ? 1 : c >= 29 && c < 33 ? 3 : 0;
}
/** Pedestrian light: 2 walk, 1 flashing, 0 don't walk. */
export function pedLight(ix, t) { const c = sigCycle(ix, t); return c >= PED_WIN[0] ? (c < 46 ? 2 : 1) : 0; }
/** Earliest time >= t at which a pedestrian can start crossing and finish inside the scramble window. */
export function pedStart(ix, t, dur) {
  const c = sigCycle(ix, t);
  const latest = PED_WIN[1] - Math.min(dur, PED_WIN[1] - PED_WIN[0] - 1) - 0.3;
  if (c >= PED_WIN[0] && c <= latest) return t;
  let dt = PED_WIN[0] - c; if (dt < 0) dt += SIG_CYCLE;
  return t + dt + 0.15;
}

// ---- World clock ----  clock = { simBase, realBase, rate, dayBase, dayScale }
export function simAt(clock, realNow) { return clock.simBase + (realNow - clock.realBase) * clock.rate; }
export function worldSeconds(clock, sim) { return clock.dayBase + sim * clock.dayScale; }
export function hourAt(clock, sim) { return mod(worldSeconds(clock, sim), 86400) / 3600; }
export function dayAt(clock, sim) { return Math.floor(worldSeconds(clock, sim) / 86400); }
/** Sim seconds until the world clock next shows hour h (0..24). */
export function simUntilHour(clock, sim, h) {
  const cur = hourAt(clock, sim);
  let dh = h - cur; if (dh <= 0) dh += 24;
  return dh * 3600 / clock.dayScale;
}
export function worldMin(clock, minutes) { return minutes * 60 / clock.dayScale; } // world minutes -> sim seconds
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function formatClock(h) {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  const ap = hh >= 12 ? 'PM' : 'AM';
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ap}`;
}
