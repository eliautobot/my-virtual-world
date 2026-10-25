// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Bull Rider (docs/features/arcade.md "The machines"): the Mechanical Bull ridden for real (it turns and rocks on its pole:
// shared/arcade/machines.js BULL). Hold on as long as you can: the bull bucks (nose down, then up), rears, spins one way
// or the other, throws you to a side and shimmies, every ten seconds wilder. Each move pushes you off your seat; lean
// against it to stay up (you fall the way you lean if you let it run). Lean too far and you are thrown. Ten points a
// second, more as it gets wilder; eight seconds: 100 more; a move ridden out smoothly: 25; sixty seconds and the bull is
// tamed: 500.
// Controls: ◀ ▶ lean left and right, ▲ ▼ forward and back; or hold the pointer on the screen: you lean toward it from the
// middle. The sim (rules only; the game in the world is client/js/play/machines/bull-rider.js): deterministic, see
// shared/arcade/core.js; the bull's turn (yaw) and its rocking (pitch: nose down below 0, roll: to its right above 0) in
// radians, the rider's lean (-1 … 1 each way: thrown past 1), steps of 1/60 s.
import { BTN, baseState, roll } from '../core.js';

export const TAME = 60 * 60, EIGHT = 8 * 60, LEVEL = 10 * 60;
const DT = 1 / 60, MOVES = ['buck', 'rear', 'spin', 'throw', 'shimmy', 'buck', 'spin', 'throw'];
const bump = u => (u <= 0 || u >= 1 ? 0 : 4 * u * (1 - u));
const tri = u => { const f = u - Math.floor(u); return f < 0.5 ? 4 * f - 1 : 3 - 4 * f; };
export const levelOf = s => Math.min(5, Math.floor(s.ride / LEVEL));
export function init(seed) {
  return {
    ...baseState(seed), ph: 'start', pt: 0, ride: 0, yaw: 0, yawV: 0, pitch: 0, roll: 0, pp: 0, pr: 0,
    lx: 0, lz: 0, vx: 0, vz: 0, move: null, moveMax: 0, smooth: 0, pts: 0, bonus: 0, eight: false, tamed: false, fellX: 0, fellZ: 0, prev: 0, over: false,
  };
}
function nextMove(s) {
  const lv = levelOf(s), kind = MOVES[roll(s, MOVES.length)];
  const dur = Math.round((70 + roll(s, 40)) / (1 + 0.12 * lv)), amp = (0.13 + 0.045 * lv) * (0.8 + roll(s, 40) / 100);
  s.move = { kind, t: 0, dur, amp, dir: roll(s, 2) ? 1 : -1 };
  s.moveMax = 0;
  s.ev.push({ k: 'move', kind, dir: s.move.dir, lv });
}
/** The bull's pose for a move at u (0 … 1): pitch, roll and the turn's speed. */
function pose(m, u) {
  const a = m.amp;
  switch (m.kind) {
    case 'buck': return [u < 0.5 ? -a * bump(u * 2) : 0.7 * a * bump(u * 2 - 1), 0, 0];
    case 'rear': return [0.9 * a * bump(u), 0, 0];
    case 'spin': return [-0.25 * a * bump(u), 0.2 * a * m.dir * bump(u), m.dir * a * 9 * bump(u)];
    case 'throw': return [0, m.dir * 0.85 * a * bump(u), 0];
    case 'shimmy': return [0, 0.45 * a * tri(u * 4) * bump(u) * 1.6, 0];
    default: return [0, 0, 0];
  }
}
export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b;
  s.prev = b;
  s.pt++;
  if (s.ph === 'start') { if (s.pt >= 90) { s.ph = 'ride'; s.pt = 0; s.ev.push({ k: 'go' }); nextMove(s); } return; }
  if (s.ph === 'thrown' || s.ph === 'tamed') {
    // the bull settles; the rider is on the mat (or climbs off, the winner)
    s.pitch *= 0.92; s.roll *= 0.92; s.yawV *= 0.9; s.yaw += s.yawV * DT;
    if (s.pt >= 110) { s.over = true; s.ev.push({ k: 'over' }); }
    return;
  }
  // the bull's move
  const m = s.move; m.t++;
  const [p, r, w] = pose(m, m.t / m.dur);
  s.pp = s.pitch; s.pr = s.roll;
  s.pitch = p; s.roll = r; s.yawV = w; s.yaw += w * DT;
  // what it does to the rider: its rocking shoves them, a spin throws them outward; letting a lean run makes it worse
  const dP = s.pitch - s.pp, dR = s.roll - s.pr;
  let ix = 0, iz = 0;
  if (b & BTN.L) ix -= 1; if (b & BTN.R) ix += 1; if (b & BTN.U) iz -= 1; if (b & BTN.D) iz += 1;
  if (inp.pd && !(b & (BTN.L | BTN.R | BTN.U | BTN.D))) { ix = (inp.px - 128) / 128; iz = (inp.py - 128) / 128; }   // (the arrows over the pointer)
  s.vx = s.vx * 0.9 + dR * 0.3 + w * 0.00016 + ix * 0.0042 + s.lx * 0.0016;
  s.vz = s.vz * 0.9 - dP * 0.28 + iz * 0.0042 + s.lz * 0.0016;
  s.lx += s.vx; s.lz += s.vz;
  s.moveMax = Math.max(s.moveMax, Math.abs(s.lx), Math.abs(s.lz));
  if (Math.abs(s.lx) > 1 || Math.abs(s.lz) > 1) {
    s.fellX = Math.abs(s.lx) > 1 ? Math.sign(s.lx) : 0; s.fellZ = Math.abs(s.lz) > 1 ? Math.sign(s.lz) : 0;
    s.ph = 'thrown'; s.pt = 0; s.ev.push({ k: 'thrown', x: s.fellX, z: s.fellZ, secs: Math.floor(s.ride / 60) });
    return;
  }
  // riding: the points, the bonuses, wilder by the level
  s.ride++;
  if (s.ride % 6 === 0) s.pts += 1 + levelOf(s) * 0.5;
  if (!s.eight && s.ride >= EIGHT) { s.eight = true; s.bonus += 100; s.ev.push({ k: 'eight' }); }
  if (s.ride % LEVEL === 0 && s.ride < TAME) s.ev.push({ k: 'level', lv: levelOf(s) });
  if (m.t >= m.dur) {
    if (s.moveMax < 0.35) { s.smooth++; s.bonus += 25; s.ev.push({ k: 'smooth' }); }
    nextMove(s);
  }
  if (s.ride >= TAME) { s.tamed = true; s.bonus += 500; s.ph = 'tamed'; s.pt = 0; s.ev.push({ k: 'tamed' }); }
}
export const over = s => s.over;
export const score = s => Math.floor(s.pts) + s.bonus;
export const detail = s => ({ secs: Math.floor(s.ride / 60), smooth: s.smooth, tamed: s.tamed });
