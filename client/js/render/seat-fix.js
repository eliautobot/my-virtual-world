// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Seated on the world's seats (2026-11-20, the product owner: the women "don't sit on the proper sitting surface and their
// feet go through the ground"). The character builder's bodies (the crowd's, characters built in the Agent Studio) each
// play the same seated clips retargeted to their own proportions, and the female body's came out lower and further
// forward than the male's — its seat contact 3 cm lower, its hips 6.5 cm forward, its soles under the floor — while the
// world's benches, chairs and tables were fitted to the male body's (its sit_idle: contact 0.4704 m above its root, hips
// 0.026 m behind it). So each builder body's seated clips are moved to sit as that one does (its own seated measure,
// tools/chars/custom-kind.mjs seated.sit_idle), and a seated person's height (0.8–1.2) is scaled about the seat rather
// than the floor: their hips stay on it, short or tall (render/characters.js, render/char-props.js PLACE).
import { TRIPO_CLIPS } from './charClips.js';

/** The male builder body's sit_idle (the seats were fitted to it): contact height and hip depth, root space, metres. */
export const SEAT_REF = { contact: 0.4704, hipZ: -0.026 };
/** The clips that sit on a bench, a chair or at a table (not in a car: render/car-occupants.js fits those itself). */
export const SEAT_CLIPS = ['sit', 'sit_work', 'sit_idle', 'sit_talk', 'wave_sit', 'hold_sit_phone', 'hold_sit_drink', 'hold_sit_read',
  'eat_hands', 'eat_hand', 'eat_knife', 'eat_spoon', 'eat_lap'];
/** The seated clips as the shader's clip bits (ivec3: a bit per clip index). */
export function seatClipBits() {
  const m = [0, 0, 0];
  for (const n of SEAT_CLIPS) { const c = TRIPO_CLIPS.indexOf(n); if (c >= 0 && c < 96) m[c >> 5] |= 1 << (c & 31); }
  return m;
}
/** A model's seat fix: [lift, back (+z), the seat's height (the pivot its height scales about), on] — on for a builder
 *  body that measured its own seat (man.custom, man.seated.sit_idle), off (zeros) for any other. */
export function seatFix(man) {
  const s = man?.custom ? man.seated?.sit_idle : null;
  if (!s || !Number.isFinite(s.contact) || !Array.isArray(s.hip)) return [0, 0, 0, 0];
  const lift = SEAT_REF.contact - s.contact, back = SEAT_REF.hipZ - s.hip[1];
  // (a body measured far off — a broken clip — is left as it is rather than thrown about)
  if (Math.abs(lift) > 0.15 || Math.abs(back) > 0.2) return [0, 0, 0, 0];
  return [lift, back, SEAT_REF.contact, 1];
}
