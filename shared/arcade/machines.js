// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade's game machines as they are built (2026-10-24, the product owner: "No I meant like actually playing not a
// second gaming version. Like with the 3D asset you created it becomes its own mini game"): the measurements a machine's
// game is played on, shared by its 3D model (client/js/render/furniture-arcade.js), its rules (shared/arcade/games/: the
// server plays every run again on them) and the game in the world (client/js/play/machines/). Item frame as the
// furniture's: metres, +z the front (where the player stands), y up from the floor, x to the right as you face the front.

/** Whack-a-Mole: the five holes in its deck (x, z; the front row of three, the back row of two), the deck's top. */
export const WHACK = Object.freeze({
  holes: Object.freeze([[-0.3, 0.25], [0, 0.25], [0.3, 0.25], [-0.15, -0.05], [0.15, -0.05]]),
  deck: 0.86, holeR: 0.085,
});

/** Skee-Ball: the lane from its near end up to the hump, then the ring board rising away (along it from its bottom edge),
 *  the cups on it (along, across: radius, points), the 100 pockets near its top corners. */
export const SKEE = Object.freeze({
  laneNear: Object.freeze([0.72, 1.3]),    // y, z of the lane's near end (where the ball is let go)
  laneHump: Object.freeze([0.95, -0.36]),  // y, z of its far end (the hump's lip)
  laneW: 0.3,                               // half the lane's width
  board0: Object.freeze([0.97, -0.5]),     // y, z of the ring board's bottom edge
  boardSlope: 0.42,                         // radians it rises at, going away
  boardLen: 1.0, boardW: 0.33,
  ringsAt: 0.55,                            // along the board: the rings' middle
  rings: Object.freeze([[0.06, 50], [0.12, 40], [0.18, 30], [0.24, 20]]),
  pockets: Object.freeze([[-0.22, 0.88], [0.22, 0.88]]), pocketR: 0.05,
  ballR: 0.04,
});
/** How long the lane is (m, along it) and how steeply it rises. */
export const skeeLane = () => { const [y0, z0] = SKEE.laneNear, [y1, z1] = SKEE.laneHump, dz = z0 - z1, dy = y1 - y0; return { len: Math.sqrt(dz * dz + dy * dy), sin: dy / Math.sqrt(dz * dz + dy * dy), cos: dz / Math.sqrt(dz * dz + dy * dy) }; };

/** Basketball Hoops: where the ball leaves the player's hands, the rim (its middle, radius), the backboard (its front face,
 *  half width, bottom and top), the side nets. */
export const HOOPS = Object.freeze({
  release: Object.freeze([0, 1.3, 1.45]),
  rim: Object.freeze([0, 1.72, -1.07]), rimR: 0.2,
  board: Object.freeze({ z: -1.3, w: 0.45, y0: 1.55, y1: 2.25 }),
  side: 0.54, ballR: 0.1,
});

/** The Racing Cabinet's screen (Turbo Rush plays on it): its middle, size and the plane it is on (facing the seat, +z). */
export const RACING = Object.freeze({ screen: Object.freeze({ cy: 1.17, z: -0.473, w: 0.88, h: 0.78 }) });

/** The Punching Machine: the ball on its arm (the hinge it swings on, the ball's middle, its radius), the timing strip
 *  across the panel above it (where the light runs: its middle, half its width), its screen. */
export const BOXER = Object.freeze({
  hinge: Object.freeze([0, 1.4, -0.12]), ball: Object.freeze([0, 1.4, 0.22]), ballR: 0.17,
  strip: Object.freeze({ y: 1.63, z: -0.108, w: 0.22 }),
  screen: Object.freeze({ x0: -0.25, x1: 0.25, y0: 1.75, y1: 2.1, z: -0.11 }),
});

/** The Claw Machine: the prize field inside the glass (its floor, how far the claw goes), where the claw hangs at the top
 *  and how low it reaches, the chute in the front left corner (prizes dropped there come out of the prize door), the
 *  joystick and the button on the front, the marquee over it. */
export const CLAW = Object.freeze({
  floor: 0.94, reach: 0.36, top: 1.72, low: 1.02,
  chute: Object.freeze([-0.3, 0.3]), chuteR: 0.075,
  stick: Object.freeze([-0.18, 1.07, 0.4]), button: Object.freeze([0.18, 1.0, 0.4]),
  sign: Object.freeze({ x0: -0.4, x1: 0.4, y0: 1.86, y1: 1.99, z: 0.487 }),
});

/** The Mechanical Bull: the top of its pole (where the bull turns and rocks), the saddle, the padded arena's radius. */
export const BULL = Object.freeze({ pivot: Object.freeze([0, 0.74, 0]), saddle: Object.freeze([0, 1.22, -0.08]), arena: 1.25 });

/** Air Hockey: the playing surface (its top, half its width and length to the rails' inner faces), the goals (half their
 *  width, at both ends: the player's at +z, the computer's at -z), the puck and the strikers (radius), where the strikers
 *  rest, the scoreboard over the far goal. */
export const HOCKEY = Object.freeze({
  top: 0.8, hw: 0.64, hl: 1.17, goal: 0.2,
  puckR: 0.035, strikerR: 0.05, park: 0.85,
  sign: Object.freeze({ x0: -0.27, x1: 0.27, y0: 0.95, y1: 1.15, z: -1.226 }),
});

/** Foosball: the field (its top, half its width across the rods and its length between the goals), the goals (half their
 *  width, at z = ±hl: red's at -z, blue's at +z), the ball, the eight rods (along z; red the player's, its handles at +x
 *  where the player stands), the men on each (how many, how far apart, their feet: half width along the rod, half depth),
 *  how far below the rod a foot reaches, the scoreboard on the far side (facing the player, +x). */
export const FOOS = Object.freeze({
  top: 0.83, hw: 0.34, hl: 0.68, goal: 0.12, ballR: 0.017, rodY: 0.9,
  rods: Object.freeze([-0.6, -0.44, -0.27, -0.09, 0.09, 0.27, 0.44, 0.6]),
  red: Object.freeze([true, true, false, true, false, true, false, false]),
  men: Object.freeze([3, 2, 3, 5, 5, 3, 2, 3]),
  manW: 0.015, manD: 0.012, foot: 0.064,
  sign: Object.freeze({ cx: -0.364, cz: 0, ry: Math.PI / 2, x0: -0.2, x1: 0.2, y0: 0.95, y1: 1.07 }),
});
/** The men of rod i: where each stands along it with the rod at rest (x), and how far the rod slides each way. */
export function foosMen(i) {
  const n = FOOS.men[i], sp = 0.6 / n, xs = Array.from({ length: n }, (_, k) => (k - (n - 1) / 2) * sp);
  const travel = FOOS.hw - FOOS.manW - ((n - 1) * sp) / 2;
  return { xs, travel };
}

/** Pinball: the playfield is tilted (about pivot, front down by tilt radians), its surface at y = surf in that frame;
 *  the game's rules are in the playfield's own x (right) and z (down the slope, toward the player), metres. The walls,
 *  the arch over the top, the shooter lane on the right (its wall, the plunger, where the ball waits), the one-way gate at
 *  its top, the pop bumpers, the slingshots (their kicking edge A→C), the guides onto the flippers (the inlanes; outside them
 *  the outlanes, straight down to the drain), the flippers (pivots,
 *  length, radii at pivot and tip, rest and up angles in 1024ths of a turn), the three drop targets on the left wall,
 *  the three rollover lanes at the top (their guides, their middles), the drain, the screen on the backbox. */
export const PIN = Object.freeze({
  pivot: Object.freeze([0, 0.82, 0]), tilt: 0.115, surf: 0.205,
  ballR: 0.0135, wallX: 0.31, arch: Object.freeze({ cz: -0.19, r: 0.31 }),
  lane: Object.freeze({ x: 0.25, top: -0.17, rest: Object.freeze([0.28, 0.54]) }),
  gate: Object.freeze([[0.25, -0.17], [0.31, -0.23]]),
  bumpers: Object.freeze([[-0.1, -0.26], [0.08, -0.26], [-0.01, -0.12]]), bumperR: 0.032,
  slings: Object.freeze([
    Object.freeze([[-0.23, 0.18], [-0.23, 0.29], [-0.14, 0.389]]),
    Object.freeze([[0.17, 0.18], [0.17, 0.29], [0.08, 0.389]]),
  ]),
  guides: Object.freeze([[[-0.27, 0.3], [-0.135, 0.445]], [[0.21, 0.3], [0.075, 0.445]]]),   // (outside them the outlanes, down to the drain)
  flippers: Object.freeze([Object.freeze({ at: Object.freeze([-0.13, 0.455]), side: -1 }), Object.freeze({ at: Object.freeze([0.07, 0.455]), side: 1 })]),
  flipLen: 0.083, flipR0: 0.011, flipR1: 0.006, flipRest: 73, flipUp: -73,
  targets: Object.freeze([-0.04, 0.02, 0.08]), targetX: -0.3, targetH: 0.024,
  laneGuides: Object.freeze([-0.13, -0.05, 0.03, 0.11]), lanes: Object.freeze([-0.09, -0.01, 0.07]), laneZ: Object.freeze([-0.42, -0.36]),
  drain: 0.6, front: 0.66,
  screen: Object.freeze({ x0: -0.29, x1: 0.29, y0: 1.13, y1: 1.43, z: -0.512 }),
});
/** A point on the playfield (x, z), h above its surface, in the machine's frame (for the model and the game's view). */
export function pinAt(x, z, h = 0) {
  const y = PIN.surf + h, c = Math.cos(PIN.tilt), s = Math.sin(PIN.tilt);
  return [x, PIN.pivot[1] + y * c - z * s, y * s + z * c];
}

/** Billiards: the cloth (its top, half its width and length to the cushions' faces), the balls (radius), the six
 *  pockets (their middles, how near a ball's middle must come to drop), how far short of a corner and of a side pocket's
 *  middle the cushions stop (the jaws), the head spot (the cue ball's) and the foot spot (the rack's apex), the lamp
 *  hung over the table (its height, half its width and length) with its score display on its end facing the player. */
export const POOL = Object.freeze({
  top: 0.8, hw: 0.66, hl: 1.26, ballR: 0.028,
  pockets: Object.freeze([[-0.69, -1.29], [0.69, -1.29], [-0.715, 0], [0.715, 0], [-0.69, 1.29], [0.69, 1.29]].map(p => Object.freeze(p))), pocketR: 0.06,
  corner: 0.075, side: 0.062,
  head: Object.freeze([0, 0.63]), foot: Object.freeze([0, -0.63]),
  lamp: Object.freeze({ y0: 1.76, y1: 1.86, hx: 0.36, hz: 0.55 }),
  sign: Object.freeze({ x0: -0.28, x1: 0.28, y0: 1.77, y1: 1.85, z: 0.557 }),
});
/** Where the fifteen balls of a rack stand (x, z): rows away from the player from the foot spot, the apex first. */
export function poolRack() {
  const R = POOL.ballR + 0.0004, out = [];
  for (let r = 0; r < 5; r++) for (let i = 0; i <= r; i++) out.push([(i - r / 2) * 2 * R, POOL.foot[1] - r * R * 1.7320508075688772]);
  return out;
}

/** Mini Bowling: the lane (its top, half its width, the foul line, where the pin deck begins and ends), the ten pins
 *  (the head pin's place, the rows' spacing and the pins' along a row; a pin's radius at its belly and height), the ball,
 *  the gutters (out to), the screen over the pins. */
export const BOWL = Object.freeze({
  top: 0.09, hw: 0.42, foul: 2.2, lane: -2.78, deck: -3.15, gutter: 0.58,
  head: -2.88, row: 0.1, sp: 0.12, pinR: 0.047, pinH: 0.34, ballR: 0.065,
  screen: Object.freeze({ x0: -0.66, x1: 0.66, y0: 1.24, y1: 1.66, z: -3.143 }),
});
/** The ten pins' spots (x, z): the head pin first, then each row away from the bowler. */
export function bowlPins() {
  const out = [];
  for (let r = 0; r < 4; r++) for (let i = 0; i <= r; i++) out.push([(i - r / 2) * BOWL.sp, BOWL.head - r * BOWL.row]);
  return out;
}

/** The Dance Machine: its two pads (their middles across, the panels' middle along, how far apart the panels are), the
 *  screen the arrows rise on. */
export const DANCE = Object.freeze({
  pads: Object.freeze([-0.45, 0.45]), padZ: 0.44, panel: 0.27, top: 0.145,
  screen: Object.freeze({ x0: -0.66, x1: 0.66, y0: 1.07, y1: 1.93, z: -0.111 }),
});
