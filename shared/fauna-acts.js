// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An animal's own acts beyond walking and running (2026-11-24: the fox's play). The server's minds (server/world/fox.js)
// send an act's number (its place here + 1; 0 none) and the pages play its clip (render/fauna-skinned.js slots 7..,
// in this order); the clips are baked with these names and lengths (tools/animals/fox_play.py).
export const ACTS = ['sit', 'bow', 'pounce', 'hop', 'roll', 'stretch', 'dig', 'liedown', 'sleep', 'getup', 'wag', 'shake', 'tilt'];
/** One play of each act's clip (s): a one-shot (ONCE) lasts exactly this, a loop any whole number of it. */
export const ACT_LEN = { sit: 6, bow: 2.4, pounce: 1.6, hop: 1.2, roll: 4, stretch: 3, dig: 2, liedown: 1.6, sleep: 8, getup: 1.6, wag: 2, shake: 1.4, tilt: 3 };
export const ONCE = new Set(['pounce', 'roll', 'stretch', 'liedown', 'getup', 'shake']);
