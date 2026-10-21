// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The jump clip driven by the jump itself (player.js: real gravity, shared/standable.js). The baked clip (Tripo
// 'jump_02', the same on every character) crouches for its first 30 %, is in the air from 31 % to 57 % — lifting the
// hips up to 0.64 m by itself — lands and settles. Here the take-off starts at the airborne part, the air time maps
// onto it, and its own lift is taken back out (hipLift) so the height comes from the physics alone.
import { JUMP_V, GRAVITY } from '/shared/standable.js';

const AIR0 = 0.31, AIR1 = 0.555, LAND0 = 0.57, LAND1 = 0.74;
export const AIR_T = 2 * JUMP_V / GRAVITY;   // in the air on flat ground (s)
export const LAND_T = 0.3;                    // the landing, standing still (s); walking on, half that
// The hips' height (m) at each of the clip's 30 frames, measured from the bake (f01, m01: the same).
const HIP = [0, -0.01, -0.03, -0.04, -0.07, -0.11, -0.14, -0.18, -0.19, -0.09, 0.09, 0.29, 0.45, 0.64, 0.63, 0.48,
  0.31, 0.01, -0.1, -0.06, 0.01, 0.03, 0.03, 0.02, 0.02, 0, 0, 0, 0, 0];

/** The clip phase ta seconds after take-off (still in the air). */
export function airPhase(ta) { return AIR0 + (AIR1 - AIR0) * Math.min(1, Math.max(0, ta / AIR_T)); }
/** The clip phase tl seconds after landing (u: 0..1 of the landing, from tl / its length). */
export function landPhase(u) { return LAND0 + (LAND1 - LAND0) * Math.min(1, Math.max(0, u)); }
/** How much the clip itself lifts the body at phase ph during the airborne part (0 elsewhere: the crouch on landing
 *  stays, it bends the knees). Subtract it from the body's height. */
export function hipLift(ph) {
  if (ph < AIR0 - 0.02 || ph > LAND0) return 0;
  const f = Math.min(29, Math.max(0, ph * 30)), i = Math.floor(f), t = f - i;
  return Math.max(0, HIP[i] * (1 - t) + HIP[Math.min(29, i + 1)] * t);
}
/** For a body seen from afar (remote.js): the phase and lift s seconds after its jump clip began. */
export function remoteJump(s) {
  const ph = s < AIR_T ? airPhase(s) : landPhase((s - AIR_T) / LAND_T);
  return { ph, lift: hipLift(ph) };
}
