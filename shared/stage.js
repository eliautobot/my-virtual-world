// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Lounge Stage's microphone and double bass, and the singer and the bassist at them (2026-10-24, the product owner:
// "the lounge singer has their hand holding the mic in the wrong place, their hand is not holding the mic stand", "the
// bass player needs more work the hand placements are off"): where they stand on the stage, and where the stand and the
// bass are from there, used both to draw them (client/js/render/furniture-lounge.js) and to put the hands on them
// (tools/chars/extra-clips.mjs act_sing, act_bass), so the two can't drift apart. Points from a player's place are in
// their root frame: x their left, y up from the stage, z ahead.

/** Where the singer and the bassist stand (the stage's frame: x, z, yaw; shared/catalog.js lounge_stage slots). */
export const SINGER = { x: 0.4, z: 0.6, yaw: 0 };
export const BASSIST = { x: 1.11, z: 0.13, yaw: 0 };

/** The microphone's stand, from the singer's place: its rod from its foot to its top (leaning back a little toward the
 *  singer), r its radius; the microphone over it, between a woman's mouth and a man's, 0.12 ahead. */
export const MIC = { foot: [0, 0.02, 0.33], top: [0, 1.39, 0.21], r: 0.012, mic: [0, 1.46, 0.2] };

// The double bass, in its own frame: its end pin on the floor at its origin, y up along it, z the way its strings face,
// x its left (as its player sees it from behind).
const B = {
  bottom: 0.25,                       // the body's lowest point (the end pin out under it)
  lower: [0.53, 0.29, 0.31, 0.1],     // the lower bout: its middle's height, half width, half height, half depth
  upper: [0.98, 0.215, 0.24, 0.092],  // the upper bout
  bridge: [0.661, 0.19],              // the bridge: its height, where its top is (z)
  nut: [1.6, 0.105],                  // the nut, where the strings leave the fingerboard
  board: [0.93, 1.6],                 // the fingerboard: from (over the upper bout) to the nut
  neck: 1.15,                         // the neck, from the upper bout to the nut
};
/** Where the strings are at height y of the bass (z), between the bridge and the nut. */
export const stringZ = y => B.bridge[1] + (y - B.bridge[0]) * (B.nut[1] - B.bridge[1]) / (B.nut[0] - B.bridge[0]);
export const BASS_SHAPE = B;

const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** The bass as its player holds it, from the bassist's place: leaning to their left (lean) and back toward them (back),
 *  turned so its strings face toward their right hand (turn), its end pin set so the strings at the end of the
 *  fingerboard (pluck: the height on the bass) are at `at` (where the right hand plucks). x, y, z: its axes. */
export function bassFrame({ lean, back, turn, pluck, at }) {
  const y = nrm([Math.tan(lean), 1, -Math.tan(back)]), f0 = [-Math.sin(turn), 0, Math.cos(turn)];
  const d = f0[0] * y[0] + f0[1] * y[1] + f0[2] * y[2], z = nrm([f0[0] - d * y[0], f0[1] - d * y[1], f0[2] - d * y[2]]), x = cross(y, z);
  const p = [0, pluck, stringZ(pluck)], o = [0, 1, 2].map(k => at[k] - (x[k] * p[0] + y[k] * p[1] + z[k] * p[2]));
  o[1] = 0;   // (its end pin on the stage)
  return { o, x, y, z, pluck };
}
// (chosen against every character (their arms' reach, the bass clear of their body and head): the strings plucked a
// little left of their middle, the bass turned half way to their right, its back on their left hip)
export const BASS = bassFrame({ lean: 0.15, back: 0.05, turn: 0.9, pluck: 1.03, at: [0.12, 1, 0.22] });
/** A point of the bass (its own frame) from the bassist's place. */
export const bassPt = p => [0, 1, 2].map(k => BASS.o[k] + BASS.x[k] * p[0] + BASS.y[k] * p[1] + BASS.z[k] * p[2]);
/** A direction of the bass (its own frame) from the bassist's place. */
export const bassDir = v => nrm([0, 1, 2].map(k => BASS.x[k] * v[0] + BASS.y[k] * v[1] + BASS.z[k] * v[2]));

/** The DJ's headphones (2026-10-24, the product owner: "I'm not sure why the dj puts their elbow up so high when placing
 *  hand on ear, looks off": the hand presses a cup of them to the ear), worn on the head (render/char-props.js
 *  headphones) and pressed by the hand (tools/chars/extra-clips.mjs act_dj). Made for a head `w` wide beside its middle
 *  at its ears (`ear` over the head's joint) and `top` from there to over its crown; each head's frame (venue-clips.json
 *  heads, measured from its own mesh, hair and all) stretches them to fit it: the cups from `in` to `out` beside the
 *  middle, r their radius, the band over the crown. */
export const PHONES = { w: 0.12, ear: 0.075, top: 0.2, in: 0.112, out: 0.146, r: 0.046 };
