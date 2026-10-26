// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Strike Lane (docs/features/arcade.md "The machines"): ten frames on the Mini Bowling Lane itself (its lane, gutters,
// pin deck, ten pins and kickback plates: shared/arcade/machines.js BOWL). Two rolls a frame (three in the tenth after a
// strike or a spare); a strike scores ten and the next two rolls, a spare ten and the next one: 300 at most. The ball
// rolls from where you stand toward where you aim; off the lane it drops into the gutter. Pins hit hard enough fall and
// go on sliding into the others, off the kickbacks at the sides, into the pit; one only grazed wobbles and stays up.
// Controls: the pointer (the mouse over the lane, a finger on it) aims (where across the lane the ball is to reach the
// pins); ◀ ▶ step to where you stand; hold A (the mouse button, a finger, Z), the power rising and falling, let go to
// roll. Left eight seconds, it rolls by itself (softly, anywhere). It takes a steady hand (2026-10-26, the product owner:
// "the bowling game is way too easy"; a straight ball at the pointer struck 8 to 10 times a game): while the power builds
// the aim sways about where you point (WOB, more the harder the throw: the line shows it), so you let go as it passes
// your mark; a hard throw also skids a little off its line (SKID). The sim (rules only; the game in the world is
// client/js/play/machines/strike-lane.js): deterministic, see shared/arcade/core.js; metres on the lane (x across, z
// toward the bowler), speeds in metres a step (1/60 s).
import { BTN, baseState, roll } from '../core.js';
import { BOWL, bowlPins } from '../machines.js';

const { hw: HW, ballR: BR, pinR: PR } = BOWL, NS = 6, START = 2.05, STAND = 0.3;
export const PHYS = { ballM: 4.5, knock: 0.0135, ballE: 0.45, pinE: 0.3, slide: 0.9, tumble: 0.49, scatter: 0.35 };   // (the ball heavier than a pin; how hard a pin must be hit to fall; how much of its push a falling pin keeps; how far the dice turn it)
const STOP = 0.0004, VMIN = 0.03, VMAX = 0.08, IDLE = 8 * 60;
export const WOB = { amp: 0.17, low: 0.3, period: 46, skid: 0.04 };   // (the sway at full power, m; how much of it at the lowest; frames a sway takes; a full-power skid, m)
export const FRAMES = 10, SPOTS = bowlPins();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** The pointer across the lane (px: x, 0 … 255 over the lane's width) and back. */
export const toPx = x => Math.round(((x + HW) / (2 * HW)) * 255);
const fromPx = px => (px / 255) * 2 * HW - HW;

const freshPins = () => SPOTS.map(([x, z]) => ({ x, z, vx: 0, vz: 0, up: true, out: false }));
export function init(seed) {
  return {
    ...baseState(seed), frame: 1, r: 0, rolls: [], frames: [], pins: freshPins(), standAt: 0,
    ph: 'aim', pt: 0, x0: 0, tx: 0.03, aim: 0.03, wph: 0, chg: -1, pw: 0, prev: 0, idle: 0,
    ball: { x: 0, z: START, vx: 0, vz: 0, gutter: false, live: false }, knocked: 0, strikes: 0, spares: 0, gutters: 0, over: false,
  };
}

/** The frames' scores so far: [[the rolls of each], …] and the running totals (null where a bonus is still to come). */
export function card(rolls) {
  const out = []; let i = 0, total = 0;
  for (let f = 1; f <= FRAMES && i < rolls.length; f++) {
    if (f < FRAMES) {
      if (rolls[i] === 10) { const ok = rolls.length > i + 2; total += ok ? 10 + rolls[i + 1] + rolls[i + 2] : 0; out.push({ rolls: [10], total: ok ? total : null }); i += 1; continue; }
      const two = rolls.length > i + 1;
      if (two && rolls[i] + rolls[i + 1] === 10) { const ok = rolls.length > i + 2; total += ok ? 10 + rolls[i + 2] : 0; out.push({ rolls: [rolls[i], rolls[i + 1]], total: ok ? total : null }); i += 2; continue; }
      if (two) { total += rolls[i] + rolls[i + 1]; out.push({ rolls: [rolls[i], rolls[i + 1]], total }); i += 2; continue; }
      out.push({ rolls: [rolls[i]], total: null }); i += 1;
    } else {
      const last = rolls.slice(i); total += last.reduce((a, b) => a + b, 0);
      const done = last.length === 3 || (last.length === 2 && last[0] + last[1] < 10);
      out.push({ rolls: last, total: done ? total : null }); i = rolls.length;
    }
  }
  return out;
}
/** The score as far as it is known (the frames whose bonuses have been rolled). */
export function total(s) { let t = 0; for (const f of card(s.rolls)) if (f.total !== null) t = f.total; return t; }

function launch(s, pw) {
  const B = s.ball;
  B.x = s.x0; B.z = START; B.gutter = false; B.live = true;
  const skid = (roll(s, 41) - 20) / 20 * WOB.skid * pw * pw;   // (a hard throw skids a little off its line)
  let dx = s.tx + skid - s.x0, dz = BOWL.head - START; const d = Math.sqrt(dx * dx + dz * dz); dx /= d; dz /= d;
  const v = VMIN + (VMAX - VMIN) * pw; B.vx = dx * v; B.vz = dz * v;
  s.ph = 'roll'; s.pt = 0; s.chg = -1; s.idle = 0; s.standAt = s.pins.filter(p => p.up).length;
  s.ev.push({ k: 'roll', p: pw });
}

/** Two bodies a and b (radii ra, rb, masses ma, mb) off each other; → how hard they met (0: apart). */
function bump(a, b, ra, rb, ma, mb, e) {
  const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz, rr = ra + rb;
  if (d2 >= rr * rr || d2 < 1e-12) return 0;
  const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, over = rr - d, wa = mb / (ma + mb), wb = ma / (ma + mb);
  a.x -= nx * over * wa; a.z -= nz * over * wa; b.x += nx * over * wb; b.z += nz * over * wb;
  const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  if (vn <= 0) return 0;
  const j = ((1 + e) * vn) / (1 / ma + 1 / mb);
  a.vx -= (j / ma) * nx; a.vz -= (j / ma) * nz; b.vx += (j / mb) * nx; b.vz += (j / mb) * nz;
  return vn;
}
/** A pin knocked (hard enough): down, sliding; grazed, it wobbles and stays (its push undone). */
function knock(s, p, v, x0, z0) {
  if (!p.up) return;
  if (v >= PHYS.knock) {
    // falling: most of the push goes into the tumble, the rest sends it sliding, turned a little by the dice
    p.up = false;
    const t = (roll(s, 21) - 10) / 10 * PHYS.scatter, vx = p.vx - t * p.vz, vz = p.vz + t * p.vx;
    p.vx = vx * PHYS.tumble; p.vz = vz * PHYS.tumble;
    s.ev.push({ k: 'pin', v, x: p.x, z: p.z });
  }
  else { p.x = x0; p.z = z0; p.vx = 0; p.vz = 0; s.ev.push({ k: 'wobble', x: p.x, z: p.z }); }
}

function sub(s) {
  const B = s.ball, P = s.pins;
  if (B.live) {
    B.x += B.vx / NS; B.z += B.vz / NS;
    if (!B.gutter && B.z > BOWL.lane && Math.abs(B.x) > HW - BR * 0.4) { B.gutter = true; B.x = Math.sign(B.x) * (HW + 0.08); B.vx = 0; s.gutters++; s.ev.push({ k: 'gutter' }); }
    if (!B.gutter) for (const p of P) {
      if (p.out) continue;
      const x0 = p.x, z0 = p.z, v = bump(B, p, BR, PR, PHYS.ballM, 1, PHYS.ballE);
      if (v) knock(s, p, v, x0, z0);
    }
    if (B.z < BOWL.deck - 0.1) { B.live = false; s.ev.push({ k: 'pit' }); }
  }
  for (const p of P) if (!p.up && !p.out) { p.x += p.vx / NS; p.z += p.vz / NS; }
  for (let i = 0; i < P.length; i++) {
    const a = P[i]; if (a.out) continue;
    for (let j = i + 1; j < P.length; j++) {
      const b = P[j]; if (b.out || (a.up && b.up)) continue;
      const ax = a.x, az = a.z, bx = b.x, bz = b.z, v = bump(a, b, PR, PR, 1, 1, PHYS.pinE);
      if (!v) continue;
      if (a.up) knock(s, a, v, ax, az);
      if (b.up) knock(s, b, v, bx, bz);
    }
  }
  for (const p of P) {
    if (p.up || p.out) continue;
    // the kickbacks at the sides of the deck send them back in; past them, or past the deck's end, into the pit
    if (p.z < BOWL.lane + 0.15 && Math.abs(p.x) > BOWL.gutter - PR) { p.x = Math.sign(p.x) * (BOWL.gutter - PR); p.vx = -p.vx * 0.5; }
    if (p.z < BOWL.deck || (p.z > BOWL.lane + 0.15 && Math.abs(p.x) > HW)) { p.out = true; p.vx = p.vz = 0; }
  }
}

function endRoll(s) {
  const down = s.standAt - s.pins.filter(p => p.up).length, rack = s.standAt === 10;
  s.rolls.push(down); s.knocked += down;
  // a strike: a full rack all down with one ball; a spare: what was left of a rack all down with the second
  const kind = rack && down === 10 ? 'strike' : !rack && down === s.standAt && down > 0 ? 'spare' : '';
  if (kind === 'strike') s.strikes++; else if (kind === 'spare') s.spares++;
  let next = false, reset = false;
  if (s.frame < FRAMES) next = kind === 'strike' || s.r === 1;
  else if (s.r === 0) reset = kind === 'strike';
  else if (s.r === 1) { if (kind) reset = true; else if (s.rolls[s.rolls.length - 2] !== 10) next = true; }   // (a strike then a miss: the third at what is left)
  else next = true;
  s.ev.push({ k: 'count', down, kind, frame: s.frame, r: s.r, standing: s.pins.filter(p => p.up).length });
  if (next) {
    s.frames.push(s.frame);
    if (s.frame === FRAMES) { s.over = true; s.ev.push({ k: 'over', score: total(s) }); return; }
    s.frame++; s.r = 0; s.pins = freshPins();
  } else { s.r++; if (reset) s.pins = freshPins(); else for (const p of s.pins) if (!p.up) p.out = true; }   // (the sweep clears the fallen)
  s.ph = 'sweep'; s.pt = 0;
}

export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, released = s.prev & ~b;
  s.prev = b;
  if (s.ph === 'aim') {
    if (inp.pd) s.aim = clamp(fromPx(inp.px), -HW, HW);
    if (b & BTN.L) s.x0 = Math.max(-STAND, s.x0 - 0.006); if (b & BTN.R) s.x0 = Math.min(STAND, s.x0 + 0.006);
    if (b) s.idle = 0;
    if (b & BTN.A) {
      if (s.chg < 0) s.wph = roll(s, 628) / 100;   // (each throw's sway starts somewhere of its own)
      s.chg++; const k = s.chg % 100; s.pw = k < 50 ? k / 50 : (100 - k) / 50;
      s.wph += (2 * Math.PI) / WOB.period;
      s.tx = clamp(s.aim + WOB.amp * (WOB.low + (1 - WOB.low) * s.pw) * Math.sin(s.wph), -HW, HW);
    } else if (s.chg >= 0 && released & BTN.A) { if (s.chg > 2) launch(s, Math.max(0.05, s.pw)); else s.chg = -1; }
    else if (++s.idle >= IDLE) { s.tx = (roll(s, 61) - 30) * 0.012; launch(s, 0.2); }   // (left too long: a soft roll, anywhere)
    if (s.ph === 'aim' && s.chg < 0) s.tx = s.aim;   // (no sway until the power builds)
    return;
  }
  if (s.ph === 'sweep') { if (++s.pt >= 45) { s.ph = 'aim'; s.pt = 0; s.ball.live = false; s.ev.push({ k: 'ready', frame: s.frame, r: s.r }); } return; }
  for (let k = 0; k < NS; k++) sub(s);
  const B = s.ball;
  if (B.live) { B.vx *= 0.9997; B.vz *= 0.9997; if (B.vx * B.vx + B.vz * B.vz < STOP * STOP) B.live = false; }
  let moving = false;
  for (const p of s.pins) { if (p.up || p.out) continue; p.vx *= PHYS.slide; p.vz *= PHYS.slide; if (p.vx * p.vx + p.vz * p.vz > STOP * STOP) moving = true; else { p.vx = p.vz = 0; } }
  s.pt++;
  if ((!B.live && !moving && s.pt > 30) || s.pt > 60 * 8) endRoll(s);
}
export const over = s => s.over;
export const score = s => total(s);
export const detail = s => ({ frames: card(s.rolls), strikes: s.strikes, spares: s.spares, gutters: s.gutters });
