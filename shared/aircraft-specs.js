// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The aircraft people can fly (the airport module, docs/features/play-modules.md): three classes, each with the numbers
// its flight model uses (client/js/player/flight.js) and the server's limits for a run (shared/airport.js verify()).
// Speeds in metres a second, lengths in metres. Scaled to the world: real light aircraft, a little quicker in the turn.
// Rates (rad/s) are the fly-by-wire's most at full stick (2026-10-14: gentler, an expo curve below them).
// gearH: the model's origin over the ground on its wheels/skids; restPitch: a taildragger's nose-up at rest; crashVy: the
// sink rate (m/s) a landing gear takes (faster is a crash); maxRotate: how far the nose comes up for take-off.
export const AIRCRAFT = Object.freeze({
  // a high-wing taildragger like the banner plane (a Super Cub): slow, forgiving, short take-off
  prop: Object.freeze({ id: 'prop', label: 'Propeller plane', icon: '🛩️', kind: 'plane', mass: 800, stall: 20, rotate: 26, cruise: 50, max: 68,
    thrust: 7.5, climb: 7, rollRate: 1.2, pitchRate: 0.55, yawRate: 0.35, takeoffRun: 120, maxBank: 1.05, length: 7.0, span: 10.7, gearH: 1.3,
    restPitch: 0.146, maxRotate: 0.2, crashVy: 5.5 }),
  // a small business jet (a very light jet): fast, needs a long run, wide turns
  jet: Object.freeze({ id: 'jet', label: 'Small jet', icon: '🛫', kind: 'plane', mass: 4500, stall: 42, rotate: 52, cruise: 105, max: 135,
    thrust: 8, climb: 16, rollRate: 1.4, pitchRate: 0.45, yawRate: 0.25, takeoffRun: 420, maxBank: 1.1, length: 12.5, span: 13.2, gearH: 1.62,
    restPitch: 0, maxRotate: 0.18, crashVy: 4.5 }),
  // a light helicopter: takes off and lands anywhere flat (roofs too), hovers, slower
  heli: Object.freeze({ id: 'heli', label: 'Helicopter', icon: '🚁', kind: 'heli', mass: 1300, cruise: 45, max: 70, climb: 9, descend: 7,
    rollRate: 1.4, pitchRate: 1.2, yawRate: 1.1, accel: 6, maxTilt: 0.42, length: 11.5, span: 10.0, gearH: 1.43, crashVy: 5 }),
});
export const AIRCRAFT_IDS = Object.freeze(Object.keys(AIRCRAFT));
/** The fastest any aircraft may go between two path samples, with slack for a dive (the run check). */
export const maxRunSpeed = id => (AIRCRAFT[id]?.max || 140) * 1.35 + 8;
