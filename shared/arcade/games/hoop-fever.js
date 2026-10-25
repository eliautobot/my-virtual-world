// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Hoop Fever (docs/features/arcade.md "The machines"): the Basketball Hoops machine played for real, at the machine (its
// rim, backboard and side nets: shared/arcade/machines.js HOOPS). Forty-five seconds to sink as many as
// you can. Aim, hold to charge (the meter swings), let go to shoot: the ball flies in a real arc and can kiss the rim,
// bank off the backboard or drop clean through. A basket is 2, a swish 3; three in a row sets you ON FIRE (double points
// till you miss). The last fifteen seconds are BONUS TIME: the hoop slides from side to side and every basket counts 1
// more.
// Controls: ◀ ▶ (or the pointer across the screen) aim; hold A (touch and hold, the mouse button) to charge, let go to
// shoot. The sim (rules only; the game in the world is client/js/play/machines/hoop-fever.js): deterministic, see
// shared/arcade/core.js; metres and steps (1/60 s) from where the ball leaves the hands: x to the right, y up, z ahead
// (toward the hoop).
import { BTN, baseState, roll, SIN, COS, FX } from '../core.js';
import { HOOPS } from '../machines.js';

const [RX, RY, RZ] = HOOPS.release;
export const ROUND = 45 * 60, BONUS = 15 * 60, HOOP_Y = HOOPS.rim[1] - RY, HOOP_Z = RZ - HOOPS.rim[2], RIM_R = HOOPS.rimR, BALL_R = HOOPS.ballR;
export const BOARD_Z = RZ - HOOPS.board.z, BOARD_W = HOOPS.board.w, BOARD_Y0 = HOOPS.board.y0 - RY, BOARD_Y1 = HOOPS.board.y1 - RY, SIDE = HOOPS.side - BALL_R;
/** A point of the sim (from the hands) in the machine's own frame (shared/arcade/machines.js). */
export const toItem = (x, y, z) => [RX + x, RY + y, RZ - z];
const DT = 1 / 60, G = 9.8, SWEEP = 46, AIM_MAX = 22, RELOAD = 22, TUBE = 0.012;
const LAUNCH_SIN = 0.883, LAUNCH_COS = 0.469;   // 62°: it drops into the hoop rather than skimming its front
export const powerOf = c => { const p = (c % (2 * SWEEP)) / SWEEP; return p <= 1 ? p : 2 - p; };
/** Where the hoop is across (x) at step t: still, then sliding in BONUS TIME. */
export const hoopX = s => (s.left <= BONUS ? (SIN[(s.slide >> 1) & 1023] * 0.22) / FX : 0);
export function init(seed) {
  return { ...baseState(seed), left: ROUND, balls: [], aim: 0, held: 0, charge: -1, reload: 0, prev: 0, score: 0, made: 0, shots: 0, swish: 0, streak: 0, fire: false, bestStreak: 0, slide: 0, nextId: 1, over: false, tail: 0 };
}
function shoot(s, power) {
  // (a hand is never quite the same twice: a little either way in the speed and the line, from the seed)
  const v = (4.9 + power * 1.9) * (1 + (roll(s, 41) - 20) / 1600), a = s.aim + roll(s, 3) - 1, sx = SIN[a & 1023] / FX, cz = COS[a & 1023] / FX;
  s.balls.push({ id: s.nextId++, x: 0, y: 0, z: 0, vx: v * LAUNCH_COS * sx, vy: v * LAUNCH_SIN, vz: v * LAUNCH_COS * cz, rim: 0, board: 0, done: false, t: 0, power });
  s.charge = -1; s.reload = RELOAD; s.shots++;
  s.ev.push({ k: 'shoot', power });
}
function scored(s, b) {
  b.done = true;
  const swish = !b.rim && !b.board;
  let pts = swish ? 3 : 2;
  if (s.left <= BONUS) pts += 1;
  s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak); s.made++;
  if (swish) s.swish++;
  if (s.streak === 3) { s.fire = true; s.ev.push({ k: 'fire' }); }
  if (s.fire) pts *= 2;
  s.score += pts;
  s.ev.push({ k: 'score', pts, swish, bank: !!b.board && !b.rim, rim: !!b.rim, fire: s.fire, id: b.id, x: b.x });
}
function missed(s, b) {
  b.done = true;
  if (s.streak || s.fire) s.ev.push({ k: 'cold', n: s.streak });
  s.streak = 0; s.fire = false;
  s.ev.push({ k: 'miss', id: b.id });
}
function physics(s, b, hx) {
  b.t++;
  const py = b.y;
  b.vy -= G * DT;
  b.x += b.vx * DT; b.y += b.vy * DT; b.z += b.vz * DT;
  // the backboard: a flat panel behind the rim
  if (b.vz > 0 && b.z + BALL_R >= BOARD_Z && b.z < BOARD_Z + 0.1 && Math.abs(b.x) < BOARD_W + BALL_R * 0.5 && b.y > BOARD_Y0 - BALL_R && b.y < BOARD_Y1 + BALL_R) {
    b.z = BOARD_Z - BALL_R; b.vz = -b.vz * 0.92; b.vx *= 0.9; b.vy *= 0.97; b.board++;
    s.ev.push({ k: 'board', id: b.id });
  }
  // the side nets
  if (Math.abs(b.x) > SIDE) { b.x = Math.sign(b.x) * SIDE; b.vx = -b.vx * 0.4; b.vz *= 0.8; if (!b.netted) { b.netted = 1; s.ev.push({ k: 'net', id: b.id }); } }
  // the rim: the nearest point of its ring, a thin tube
  const dx = b.x - hx, dz = b.z - HOOP_Z, h = Math.sqrt(dx * dx + dz * dz) || 1e-6;
  const rx = hx + (dx / h) * RIM_R, rz = HOOP_Z + (dz / h) * RIM_R;
  const nx = b.x - rx, ny = b.y - HOOP_Y, nz = b.z - rz, dist = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (dist < BALL_R + TUBE) {
    const ux = nx / dist, uy = ny / dist, uz = nz / dist, vn = b.vx * ux + b.vy * uy + b.vz * uz;
    if (vn < 0) {
      const j = -(1 + 0.7) * vn;   // (a lively rim: a ball that hits it squarely bounces out)
      b.vx += j * ux; b.vy += j * uy; b.vz += j * uz;
      const push = BALL_R + TUBE - dist;
      b.x += ux * push; b.y += uy * push; b.z += uz * push;
      b.rim++;
      if (b.rim <= 4) s.ev.push({ k: 'rim', id: b.id });
    }
  }
  // through the hoop: its centre comes down through the ring's plane inside it
  if (!b.done && py > HOOP_Y && b.y <= HOOP_Y && b.vy < 0) {
    const ex = b.x - hx, ez = b.z - HOOP_Z;
    if (ex * ex + ez * ez < (RIM_R - 0.03) * (RIM_R - 0.03)) scored(s, b);
  }
  if (!b.done && (b.y < -0.5 || b.t > 200)) missed(s, b);
}
export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const bt = inp.b, pressed = bt & ~s.prev, released = s.prev & ~bt;
  s.prev = bt;
  if (s.left <= BONUS) s.slide += 9;
  const hx = hoopX(s);
  for (const b of s.balls) physics(s, b, hx);
  s.balls = s.balls.filter(b => !b.done || b.y > -1.2);
  if (s.balls.length > 6) s.balls.shift();
  if (s.left > 0) {
    // aim and charge
    if (inp.pd) s.aim = Math.round(((inp.px / 255) * 2 - 1) * AIM_MAX * 1.2);
    const lr = bt & (BTN.L | BTN.R);
    if (pressed & lr) { s.aim += pressed & BTN.L ? -1 : 1; s.held = 0; }
    else if (lr && ++s.held > 10 && s.held % 3 === 0) s.aim += bt & BTN.L ? -1 : 1;
    s.aim = Math.max(-AIM_MAX, Math.min(AIM_MAX, s.aim));
    if (s.reload > 0) s.reload--;
    if (pressed & BTN.A) s.charge = 0;
    else if (s.charge >= 0 && bt & BTN.A) s.charge++;
    if (s.charge >= 0 && released & BTN.A) { if (s.reload === 0) shoot(s, powerOf(s.charge)); else s.charge = -1; }
    s.left--;
    if (s.left === BONUS) s.ev.push({ k: 'bonus' });
    if (s.left > 0 && s.left <= 5 * 60 && s.left % 60 === 0) s.ev.push({ k: 'count', n: s.left / 60 });
    if (s.left === 0) s.ev.push({ k: 'buzzer' });
  } else {
    // the buzzer went: balls in the air still count
    s.tail++;
    if (!s.balls.some(b => !b.done) || s.tail > 150) { s.over = true; s.ev.push({ k: 'over' }); }
  }
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ made: s.made, shots: s.shots, swish: s.swish, bestStreak: s.bestStreak });
