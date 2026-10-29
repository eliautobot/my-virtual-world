// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Radio Station's layout (a world module: shared/world-modules.js WORLD_KINDS.radio; R2 of the sound effects plan,
// the product owner 2026-10-26/27: "a radio building / radio tower ... with its own assets like a big radio tower",
// "it should be a World Module"). In the module's frame (shared/airport-layout.js toWorldAt): s across (+s towards the
// road), f along. The studio building (MVW Radio: a real building its hosts work in, shared/world-modules.js
// terminalSpec) faces the car park and the road; behind it the broadcast tower, a 96 m lattice mast with its aviation
// lights, and the satellite dishes on their pads.
export const RADIO_PAD = Object.freeze({ sc: 0, hs: 40, hf: 42 });                          // 80 × 84 m, levelled
export const RADIO_STUDIO = Object.freeze({ s0: -14, f0: -30, s1: 8, f1: 2, h: 8.2 });     // 32 × 22 m, two storeys
export const RADIO_TOWER = Object.freeze({ s: -26, f: 22, base: 9, h: 96 });              // a three-legged mast
export const RADIO_DISHES = Object.freeze([{ s: -27, f: -10, r: 5.5, yaw: 2.5, el: 0.6 }, { s: -30, f: 4, r: 3.8, yaw: 2.1, el: 0.7 }]);   // 11 m and 7.6 m across, aimed up at the sky
export const RADIO_DOOR = Object.freeze({ s: 9, f: -14 });
export const RADIO_ROAD_END = Object.freeze({ s: 42, f: -14 });
// The grounds (2026-10-28, the product owner: "the parking lot has like a sidewalk in the middle ... the entrance to the
// parking lot has parking spots ... rebuilt to make sense"; the walking surfaces "don't get recognized"): the plaza round
// the studio and a walk along its front; the car park, two rows of bays facing each other across their aisle (the near
// row nose to the walk, the far row nose to the road); the drive from the aisle out to where the access road meets the
// grounds, through the far row (no bays across it); the tower's gravel compound. The rest is the ground's own grass.
export const RADIO_PARKING = Object.freeze({ s0: 12, f0: -36, s1: 30, f1: 36, aisle: Object.freeze([17.5, 24.5]), rows: Object.freeze([Object.freeze([12, 17.5]), Object.freeze([24.5, 30])]), bay: 2.6 });
export const RADIO_DRIVE = Object.freeze({ f0: RADIO_ROAD_END.f - 4, f1: RADIO_ROAD_END.f + 4 });   // 8 m wide, the access road's own and a margin
/** Flat rectangles on the ground: [s0, f0, s1, f1, surface] (drawn in this order; render/radio-station.js; what is
 *  underfoot: shared/world-modules.js groundAt). */
export const RADIO_SURFACES = Object.freeze([
  [RADIO_STUDIO.s0 - 3, RADIO_STUDIO.f0 - 3, RADIO_STUDIO.s1 + 1, RADIO_STUDIO.f1 + 3, 'paving'],   // the plaza round the studio
  [RADIO_STUDIO.s1, RADIO_PARKING.f0, RADIO_PARKING.s0, RADIO_PARKING.f1, 'paving'],                // the walk along its front
  [RADIO_PARKING.s0, RADIO_PARKING.f0, RADIO_PARKING.s1, RADIO_PARKING.f1, 'asphalt'],             // the car park
  [RADIO_PARKING.aisle[1], RADIO_DRIVE.f0, RADIO_ROAD_END.s + 0.8, RADIO_DRIVE.f1, 'asphalt'],     // the drive to the road
  [RADIO_TOWER.s - 8, RADIO_TOWER.f - 8, RADIO_TOWER.s + 8, RADIO_TOWER.f + 8, 'gravel'],          // the tower's compound
].map(Object.freeze));
/** The tower's aviation lights: heights (m) up the mast; the top one flashes, the others glow steadily at night. */
export const RADIO_LIGHTS = Object.freeze([32, 64, 96]);
