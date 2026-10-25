// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Skee Roll (docs/features/arcade.md "The machines"): the Skee-Ball lane played for real, on the machine itself
// (shared/arcade/machines.js SKEE: its lane, its hump, its ring board). Nine balls. Aim, then hold to charge: the power
// meter swings up and down while you hold, and the ball rolls when you let go. It runs up the lane (slowing as it
// climbs), leaps off the hump and lands on the ring board, rolls a little back down it and drops into the cup there: 10,
// 20, 30, 40 and 50 from the outside in, the two pockets near the top corners 100. Too soft and it barely clears the hump
// (10); too hard and it hits the back (10). Three 50s or 100s in a row: a 100 bonus.
// Controls: ◀ ▶ (or the pointer across the screen) aim; hold A (or touch and hold, or hold the mouse button) to charge,
// let go to roll. The sim (rules only; the game in the world is client/js/play/machines/skee-roll.js): deterministic,
// see shared/arcade/core.js; metres along the lane (d) and up the board (u), across (x); steps of 1/60 s.
import { BTN, baseState, roll, SIN, COS, FX } from '../core.js';
import { SKEE, skeeLane } from '../machines.js';

export const BALLS = 9;
const LANE = skeeLane(), DT = 1 / 60, FRICTION = 0.3, G = 9.8, AIM_MAX = 40, SWEEP = 70, IDLE = 15 * 60;
const SLOPE_S = Math.sqrt(1 - Math.cos(SKEE.boardSlope) ** 2), SLOPE_C = Math.cos(SKEE.boardSlope);   // (sin, cos of the board's rise: a table-free sine is fine here, it is a constant)
const LAUNCH = 0.7071;   // off the hump at 45°
export const HUMP = LANE.len, LANE_W = SKEE.laneW - SKEE.ballR;
/** Power 0 … 1 from how long the charge has been held (a triangle wave, up and down). */
export const powerOf = c => { const p = (c % (2 * SWEEP)) / SWEEP; return p <= 1 ? p : 2 - p; };
const dir = a => [SIN[a & 1023] / FX, COS[a & 1023] / FX];
export function init(seed) {
  return { ...baseState(seed), ball: 0, aim: 0, held: 0, charge: -1, idle: 0, b: null, score: 0, streak: 0, bonus: 0, prev: 0, over: false, wait: 30, cups: { 10: 0, 20: 0, 30: 0, 40: 0, 50: 0, 100: 0 } };
}
/** What a point on the board pays (x across, u up it from its bottom edge): a 100 pocket, a cup, else the 10. */
export function cupAt(x, u) {
  for (const [px, pu] of SKEE.pockets) if ((x - px) ** 2 + (u - pu) ** 2 < SKEE.pocketR * SKEE.pocketR) return 100;
  const r = Math.sqrt(x * x + (u - SKEE.ringsAt) ** 2);
  for (const [rr, pts] of SKEE.rings) if (r < rr) return pts;
  return 10;
}
/** Where a cup's hole is (x, u) for a ball that settles at (x, u): the cup's own middle (the 10 drops at the bottom). */
export function cupMiddle(x, u, pts) {
  if (pts === 100) { let best = SKEE.pockets[0], bd = 1e9; for (const p of SKEE.pockets) { const d = (x - p[0]) ** 2 + (u - p[1]) ** 2; if (d < bd) { bd = d; best = p; } } return best; }
  if (pts === 50) return [0, SKEE.ringsAt];
  if (pts === 10) return [x * 0.6, 0.08];
  // a ring: its gutter is a circle; the ball drops where it settled, pulled onto it
  const ring = SKEE.rings.find(r => r[1] === pts), inner = SKEE.rings[SKEE.rings.indexOf(ring) - 1], rr = (ring[0] + inner[0]) / 2;
  const dx = x, du = u - SKEE.ringsAt, d = Math.sqrt(dx * dx + du * du) || 1;
  return [(dx / d) * rr, SKEE.ringsAt + (du / d) * rr];
}
function launch(s, power) {
  const v0 = 2.4 + power * 2.3, [sx, cy] = dir(s.aim);
  s.b = { ph: 'roll', x: 0, d: 0, vx: v0 * sx, vd: v0 * cy, power, t: 0 };
  s.charge = -1; s.idle = 0;
  s.ev.push({ k: 'roll', power });
}
function land(s, b) {
  // where it settles: a little back down the board, a hair either way, then the cup there
  const jx = (roll(s, 31) - 15) / 1200, ju = -0.025 - roll(s, 16) / 1000;
  let x = b.x + jx, u = b.u + ju;
  if (u > SKEE.boardLen) { u = SKEE.boardLen - 0.05; s.ev.push({ k: 'backboard' }); }
  if (Math.abs(x) > SKEE.boardW) x = Math.sign(x) * SKEE.boardW;
  const pts = cupAt(x, u), [mx, mu] = cupMiddle(x, u, pts);
  b.ph = 'settle'; b.t = 0; b.sx = x; b.su = u; b.mx = mx; b.mu = mu; b.pts = pts;
  s.ev.push({ k: 'land', x: b.x, u: b.u });
}
function scoreBall(s, b) {
  s.cups[b.pts]++;
  s.score += b.pts;
  s.streak = b.pts >= 50 ? s.streak + 1 : 0;
  let bonus = 0;
  if (s.streak === 3) { bonus = 100; s.bonus += 100; s.score += 100; s.streak = 0; }
  s.ev.push({ k: 'cup', pts: b.pts, x: b.mx, u: b.mu, bonus });
  next(s, 50);
}
function next(s, wait) {
  s.ball++; s.b = null; s.wait = wait;
  if (s.ball >= BALLS) { s.over = true; s.ev.push({ k: 'over' }); }
}
export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev, released = s.prev & ~b;
  s.prev = b;
  if (s.wait > 0) { s.wait--; if (s.wait === 0) s.ev.push({ k: 'ready', ball: s.ball + 1 }); return; }
  const ball = s.b;
  if (!ball) {
    if (inp.pd) s.aim = Math.round(((inp.px / 255) * 2 - 1) * AIM_MAX * 1.15);
    const lr = b & (BTN.L | BTN.R);
    if (pressed & lr) { s.aim += pressed & BTN.L ? -1 : 1; s.held = 0; }
    else if (lr && ++s.held > 12 && s.held % 3 === 0) s.aim += b & BTN.L ? -1 : 1;
    s.aim = Math.max(-AIM_MAX, Math.min(AIM_MAX, s.aim));
    if (pressed & BTN.A) { s.charge = 0; s.ev.push({ k: 'charge' }); }
    else if (s.charge >= 0 && b & BTN.A) s.charge++;
    if (s.charge >= 0 && released & BTN.A) launch(s, powerOf(s.charge));
    else if (++s.idle > IDLE && s.charge < 0) launch(s, 0.3);   // (left alone: a soft roll, so a game always ends)
    return;
  }
  ball.t++;
  if (ball.ph === 'roll') {
    // up the lane: friction and the climb slow it
    ball.vd -= (FRICTION + G * LANE.sin) * DT;
    ball.x += ball.vx * DT; ball.d += ball.vd * DT;
    if (Math.abs(ball.x) > LANE_W) { ball.x = Math.sign(ball.x) * LANE_W; ball.vx = -ball.vx * 0.55; ball.vd *= 0.9; s.ev.push({ k: 'rail' }); }
    if (ball.vd <= 0.04) { ball.ph = 'back'; ball.t = 0; s.ev.push({ k: 'dead' }); return; }
    if (ball.d >= HUMP) {
      // off the hump at 45°: its flight onto the board (rising away at boardSlope) worked out at once
      const vh = ball.vd, vz = vh * LAUNCH, vd = vh * LAUNCH, tanB = SLOPE_S / SLOPE_C;
      const T = Math.max(0.04, (vz - tanB * vd) / (G / 2));
      ball.ph = 'fly'; ball.t = 0; ball.ft = Math.max(4, Math.round(T / DT)); ball.x0 = ball.x; ball.x1 = ball.x + ball.vx * T;
      ball.u = (vd * T) / SLOPE_C; ball.peak = (vz * vz) / (2 * G);
      s.ev.push({ k: 'jump' });
    }
  } else if (ball.ph === 'fly') {
    const u = ball.t / ball.ft;
    ball.x = ball.x0 + (ball.x1 - ball.x0) * u;
    if (ball.t >= ball.ft) { ball.x = ball.x1; land(s, ball); }
  } else if (ball.ph === 'settle') {
    if (ball.t >= 30) scoreBall(s, ball);
  } else if (ball.ph === 'back') {
    // too soft: it rolls back down the lane to the player, no score
    ball.d = Math.max(0, ball.d - 0.035);
    if (ball.d <= 0 || ball.t >= 90) { s.streak = 0; s.ev.push({ k: 'cup', pts: 0, x: 0, u: -1, bonus: 0 }); next(s, 30); }
  }
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ cups: s.cups, bonus: s.bonus });
