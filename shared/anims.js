// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Animation clip ids shared by server (plans) and client (baked GPU clips).
export const ANIMS = [
  'idle', 'walk', 'run', 'jog', 'sit', 'sit_type', 'sit_talk', 'sit_eat', 'sit_relax', 'sit_high',
  'sit_play', 'sit_phone', 'lie', 'talk', 'drink', 'use', 'cook', 'wash', 'browse', 'phone',
  'wave', 'dance', 'cheer', 'yoga', 'lift', 'pingpong', 'play', 'present', 'wait', 'staff',
  'jump', 'clap',
  'bartend', 'dj', 'piano', 'bass', 'sing',   // (nights out: a bartender shaking and pouring, a DJ at the decks, the lounge's band)
  'pool', 'hockey', 'foos', 'whack', 'punch', 'claw', 'pinball', 'drive',   // (the arcade's machines, each its own)
];
export const A = Object.freeze(Object.fromEntries(ANIMS.map((n, i) => [n, i])));
/** Metres per full gait cycle (two steps). Gait clips are phase-driven by distance travelled. */
export const GAIT_STRIDE = { [A.walk]: 1.42, [A.run]: 2.8, [A.jog]: 2.15 };
export const SEATED = new Set([A.sit, A.sit_type, A.sit_talk, A.sit_eat, A.sit_relax, A.sit_high, A.sit_play, A.sit_phone, A.lie, A.piano, A.drive]);
export const animId = n => (typeof n === 'number' ? n : (A[n] ?? 0));
export const PROPS = ['', 'cup', 'phone', 'book', 'paddle', 'dumbbell', 'bag', 'briefcase', 'coffee', 'laptop'];   // laptop: an agent working away from a desk (drawn once the characters carry props)
export const PROP = Object.freeze(Object.fromEntries(PROPS.map((n, i) => [n || 'none', i])));
