// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A book open to read and a phone looked at (2026-11-02, the product owner: "can you fix how agents hold books and their
// cell phones too" — the book hung on its edge from open hands, the phone lay hidden in two hands knotted together):
// each thing's size, where it is before the body and where each hand holds it, one set of numbers for the clips that
// hold them (tools/chars/extra-clips.mjs hold_sit_read, hold_*phone) and for drawing them in the right hand
// (render/char-props.js), so the hands are on the thing in every pose and on every body.
//
// A thing's own frame: w across it toward the holder's right, h up its face (a page's top, the phone's top), n out of its
// face toward the eyes (w × h = n); the origin in the middle of its back. A hand holds it from behind, the palm on its back
// (the palm faces +n, or its own `palm`), its grip frame's origin (the palm's middle, render/char-props.js) at `at`, the fingers along `along`.

/** An open book: each page's width, the height, the cover's and the pages' thickness; the pages opened to a shallow V. */
export const BOOK = Object.freeze({ w: 0.135, h: 0.21, cover: 0.004, pages: 0.013, open: 0.12 });
/** A phone: width, height, thickness. */
export const PHONE = Object.freeze({ w: 0.08, h: 0.168, t: 0.0095 });   // (a large phone: these hands are big)

/** The book in both palms from below: each palm flat under its page (tilted with it: the pages' V) near the outer edge,
 *  a little below the cover (the fingers' thickness), the fingers in under it toward the spine and up the page (the
 *  thumbs come over the edge). */
const SA = Math.sin(BOOK.open), CA = Math.cos(BOOK.open), AT = 0.112, CLEAR = 0.004;
export const BOOK_HANDS = Object.freeze({
  Right: { at: [AT * CA + CLEAR * SA, -0.035, AT * SA - CLEAR * CA], along: [-0.72 * CA, 0.69, -0.72 * SA], palm: [-SA, 0, CA] },
  Left: { at: [-AT * CA - CLEAR * SA, -0.035, AT * SA - CLEAR * CA], along: [0.72 * CA, 0.69, -0.72 * SA], palm: [SA, 0, CA] },
});
/** The phone in the right hand: its back in the palm a little right of its middle and low, the fingers across its back
 *  to its far edge and round it, the thumb free over the screen. */
export const PHONE_HAND = Object.freeze({ at: [0.014, -0.03, 0], along: [-0.9, 0.42, 0] });

const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** A hand's grip frame on a thing, in the thing's frame: z out of the palm (its `palm`, else +n), y the fingers' way
 *  square to it, x = y × z; o its origin. */
export function gripOn(hand) {
  const z = nrm(hand.palm || [0, 0, 1]), a = hand.along, d = a[0] * z[0] + a[1] * z[1] + a[2] * z[2], y = nrm([a[0] - z[0] * d, a[1] - z[1] * d, a[2] - z[2] * d]);
  return { x: cross(y, z), y, z, o: hand.at };
}
/**
 * A thing's frame before the body (root space: x the holder's left, y up, z ahead) from its middle `at` and the way its
 * face looks (`face`, toward the eyes): { o, w, h, n } with w square to the face, toward the holder's right.
 */
export function thingFrame(at, face) {
  const n = nrm(face), r = [-1, 0, 0], d = r[0] * n[0] + r[1] * n[1] + r[2] * n[2];
  const w = nrm([r[0] - n[0] * d, r[1] - n[1] * d, r[2] - n[2] * d]), h = cross(n, w);
  return { o: at, w, h, n };
}
/** A point (w, h, n) of a thing, and a direction, in the frame thingFrame gives. */
export const pointOf = (F, p) => [0, 1, 2].map(i => F.o[i] + F.w[i] * p[0] + F.h[i] * p[1] + F.n[i] * p[2]);
export const dirOf = (F, d) => nrm([0, 1, 2].map(i => F.w[i] * d[0] + F.h[i] * d[1] + F.n[i] * d[2]));
