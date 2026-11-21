// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Sitting in a car (2026-11-16, the product owner: "the driver should be visible, and other companions aswell. so they are
// visible on the seat ... they should appear as drivers inside the car, so please make it look right"). The numbers the
// car-seat clips are posed with (tools/chars/extra-clips.mjs --set venue: car_ride, car_drive) and the browser plays them
// by (render/car-occupants.js), in the body's own frame (x its left, y up, z ahead; metres for a body of height 1, from
// its hip joint).
//
// A car's seat is low and its floor close under it: the legs go forward into the footwell (the knees a little apart,
// the shins sloping forward, the feet on the floor or the pedals), not down as on a chair. The driver's hands hold the
// wheel at ten to two; the clip's frames turn it from full left to full right, so the hands follow the car's steering
// (the phase is the turn: carSteerPhase).
export const CAR_LEGS = Object.freeze({
  thigh: [0.11, 0.04, 1], shin: [0.03, -0.62, 0.78], foot: [0.02, -0.18, 1],
});
/** The driver: the wheel's middle (from the hip joint), its rim's radius, how far forward the driver leans (radians),
 *  the turn across the clip's frames (radians of the wheel, either way) and their number. */
export const CAR_DRIVE = Object.freeze({ wheel: [0, 0.26, 0.43], rim: 0.15, lean: 0.12, turn: 0.9, frames: 15 });
/** The phase of the driver's clip (0…1) that has the wheel turned by `turn` radians (+ to the driver's right). */
export function carSteerPhase(turn) {
  const { turn: max, frames } = CAR_DRIVE, k = (Math.max(-max, Math.min(max, turn || 0)) + max) / (2 * max) * (frames - 1);
  return k / frames;   // (frame k exactly; never past the last, so the clip doesn't blend back into the first)
}
/** The wheel's turn (radians) in frame k of the driver's clip. */
export const carSteerOfFrame = k => -CAR_DRIVE.turn + 2 * CAR_DRIVE.turn * k / (CAR_DRIVE.frames - 1);
