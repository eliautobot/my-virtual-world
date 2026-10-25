// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade's machines and the people playing them move together (2026-10-24, the product owner: "the arcade games
// interaction animations need way more work they look off"): each motion here is a function of the player's clip's
// phase u (0..1, one loop), used both by the clips (tools/chars/extra-clips.mjs --set venue: where the hands go) and by
// the machines' moving parts (client/js/render/venue-motion.js: the wheel turned, the claw moved, the bag hit), so the
// wheel turns with the hands on it and the bag swings when the fist lands.

const TAU = Math.PI * 2;
const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** A value keyed [[u, v], …] (u from 0 to 1), eased between keys. */
export function keyed(keys, u) {
  for (let i = 0; i + 1 < keys.length; i++) {
    const [u0, a] = keys[i], [u1, b] = keys[i + 1];
    if (u >= u0 && u <= u1) return a + (b - a) * smooth((u - u0) / (u1 - u0 || 1));
  }
  return keys[keys.length - 1][1];
}

/** The racing cabinet: the wheel's turn (radians, + to the driver's right), the hands on it. */
export const steer = u => 0.55 * Math.sin(TAU * u) + 0.18 * Math.sin(TAU * 3 * u);

/** The claw machine: where the claw is (item frame: x, z over the prizes; drop 0 up … 1 down) and the button pressed. */
export function claw(u) {
  const move = keyed([[0, 0], [0.55, 1]], u);
  const x = u < 0.6 ? 0.22 * Math.sin(TAU * 0.9 * move) : u < 0.86 ? 0.22 * Math.sin(TAU * 0.9) : keyed([[0.86, 0.22 * Math.sin(TAU * 0.9)], [0.92, -0.3], [1, 0]], u);
  const z = u < 0.6 ? 0.18 * Math.sin(TAU * 1.4 * move + 0.6) - 0.05 : u < 0.86 ? 0.18 * Math.sin(TAU * 1.4 + 0.6) - 0.05 : keyed([[0.86, 0.18 * Math.sin(TAU * 1.4 + 0.6) - 0.05], [0.92, 0.3], [1, 0]], u);
  const drop = keyed([[0, 0], [0.6, 0], [0.7, 1], [0.76, 1], [0.84, 0], [1, 0]], u);
  const press = keyed([[0, 0], [0.56, 0], [0.59, 1], [0.64, 1], [0.67, 0], [1, 0]], u);
  // the joystick leans the way the claw goes
  const e = 0.004, a = claw0(u - e), b = claw0(u + e);
  return { x, z, drop, press, jx: Math.max(-1, Math.min(1, (b[0] - a[0]) / (2 * e) / 0.8)), jz: Math.max(-1, Math.min(1, (b[1] - a[1]) / (2 * e) / 0.8)) };
}
function claw0(u) {
  u = ((u % 1) + 1) % 1;
  if (u >= 0.6) return [0, 0];
  const m = keyed([[0, 0], [0.55, 1]], u);
  return [0.22 * Math.sin(TAU * 0.9 * m), 0.18 * Math.sin(TAU * 1.4 * m + 0.6) - 0.05];
}

/** The punching machine: the fist out (0 guard … 1 on the bag) and the bag's swing back (0 … 1). */
export const punch = u => keyed([[0, 0], [0.38, 0], [0.44, -0.25], [0.5, 1], [0.58, 1], [0.72, 0], [1, 0]], u);
export const bagSwing = u => (u < 0.5 ? 0 : u < 0.95 ? Math.sin(Math.PI * Math.min(1, (u - 0.5) / 0.22)) * Math.exp(-(u - 0.5) * 5) + 0.25 * Math.sin(TAU * 2.5 * (u - 0.5)) * Math.exp(-(u - 0.5) * 7) : 0);

/** Foosball: each hand's twist of its rod (radians) and its slide in or out (m). */
export function foos(u, side) {
  const k = side === 'R' ? 0 : 1;
  const kick = keyed(k ? [[0, 0], [0.62, 0], [0.66, -1.3], [0.74, 0.25], [0.8, 0], [1, 0]] : [[0, 0], [0.22, 0], [0.26, -1.3], [0.34, 0.25], [0.4, 0], [1, 0]], u);
  return { twist: kick + 0.18 * Math.sin(TAU * 2 * u + k * 1.7), slide: 0.035 * Math.sin(TAU * u + k * 2.2) };
}

/** Whack-a-mole: three whacks a loop at the front row of holes (0 left, 1 middle, 2 right, as the player sees them):
 *  which hole the mallet goes for, how far down it is (0 up … 1 on the hole), and each mole's height (0 down … 1 up). */
export const WHACK_HOLES = [1, 2, 1];   // (the holes in turn, by index into the machine's front row as the player sees it: the left one is past the right arm's reach)
export function whack(u) {
  const n = Math.min(2, Math.floor(u * 3)), v = u * 3 - n;
  const hit = keyed([[0, 0], [0.55, 0], [0.7, 1], [0.8, 1], [1, 0]], v);
  const moles = [0, 0, 0];
  for (let k = 0; k < 3; k++) { const w = u * 3 - k; moles[WHACK_HOLES[k]] = w >= 0.1 && w < 0.7 ? Math.min(1, (w - 0.1) / 0.12) : 0; }
  return { hole: WHACK_HOLES[n], next: WHACK_HOLES[(n + 1) % 3], v, hit, moles };
}

/** Pinball: each flipper's press (0 … 1): the right, the left. */
export function flippers(u) {
  const pulse = (c, w) => { const d = Math.abs((((u - c) % 1) + 1.5) % 1 - 0.5); return d < w ? 1 - d / w : 0; };
  return { R: Math.min(1, pulse(0.18, 0.05) + pulse(0.62, 0.05) + pulse(0.86, 0.04)), L: Math.min(1, pulse(0.38, 0.05) + pulse(0.74, 0.05)) };
}

/** Air hockey: where the striker is on the table, in front of the player (x to their left, z ahead from the table's end). */
export function hockey(u) {
  return { x: 0.2 * Math.sin(TAU * u) + 0.06 * Math.sin(TAU * 3 * u + 1), z: 0.22 + 0.15 * Math.pow(Math.max(0, Math.sin(TAU * 2 * u + 1)), 3) };
}
