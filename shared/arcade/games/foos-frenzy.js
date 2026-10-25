// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Foos Frenzy (docs/features/arcade.md "The machines"): the Foosball table played for real (its field, goals, rods and
// men: shared/arcade/machines.js FOOS), you on the red rods (their handles on your side) against the computer on the blue.
// First to five, or the most when the three minutes are up. Your four rods slide together to where you point (each rod
// the man of its own nearest there), and kick together: a kick swings the men's feet through the ball and lifts them as
// they follow through, so your own shot passes over them. A man standing still stops the ball (a trap); the blue men
// stand in the way of your shots. A goal 100; from your goalie or your defence (a LONG SHOT) 100 more; within three
// seconds of the serve (a QUICK GOAL) 50 more; stopping a shot of the computer's with your goalie or defence (a BLOCK) 10; winning 500, without
// letting one in 300 more. A ball left still out of everyone's way is served again.
// Controls: the pointer (the mouse over the table, a finger on it) slides your men there, a click or a tap kicks; or
// ▲ ▼ slide them (▲ away from you) and A kicks. The sim (rules only; the game in the world is
// client/js/play/machines/foos-frenzy.js): deterministic, see shared/arcade/core.js; metres in the table's frame (x
// across the rods, + toward you; z along the field, red attacking +z), speeds in metres a step (1/60 s).
import { BTN, baseState, roll } from '../core.js';
import { FOOS, foosMen } from '../machines.js';

const { hw: HW, hl: HL, goal: GW, ballR: BR, manW: MW, manD: MD } = FOOS;
export const GOALS = 5, CLOCK = 180 * 60, NS = 4, KICK = 16, REACH = 0.07;
const VMAX = 0.08, KICKV = 0.06, FRICTION = 0.991, WALL_E = 0.6, MAN_E = 0.3, PTRV = 0.03, KEYV = 0.012, PAUSE = 90, DEAD = 240;
export const CPU = { v: 0.0095, kick: 18, look: 7, lead: 0.3, err: 0.005 };   // (the computer's rods: top slide a step, its chance in 100 a step to kick a ball at its feet, how often it looks again)
export const RODS = FOOS.rods.map((z, i) => ({ z, red: FOOS.red[i], dir: FOOS.red[i] ? 1 : -1, ...foosMen(i) }));
/** Whether rod i's feet are down (stopping the ball) kt steps into its kick (-1: not kicking), and kicking it. */
export const footDown = kt => kt < 0 || kt < 3 || kt >= 12;
const kicking = kt => kt >= 0 && kt < 3;
/** The pointer across the field (px: z along it, py: x across it, 0 … 255) and back. */
export const toPx = (x, z) => [Math.round(((z + HL) / (2 * HL)) * 255), Math.round(((x + HW) / (2 * HW)) * 255)];
const fromPy = py => (py / 255) * 2 * HW - HW;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function init(seed) {
  const s = {
    ...baseState(seed),
    bx: 0, bz: 0, vx: 0, vz: 0,
    sl: RODS.map(() => 0), sv: RODS.map(() => 0), kt: RODS.map(() => -1), tg: RODS.map(() => 0),
    tx: 0, prev: 0, me: 0, cpu: 0, score: 0, clock: CLOCK, ph: 'goal', pt: PAUSE - 30, scorer: 0, last: -1, served: 0, still: 0,
    look: 0, blocks: 0, longs: 0, quicks: 0, over: false, win: false,
  };
  return s;
}

/** Where the men of rod i are (x each) with its slide now. */
export const menOf = (s, i) => RODS[i].xs.map(x => x + s.sl[i]);
/** The slide that brings rod i's man nearest to x over x. */
function slideFor(i, x) {
  const R = RODS[i]; let best = 0, bd = 1e9;
  for (const m of R.xs) { const sl = clamp(x - m, -R.travel, R.travel), d = Math.abs(m + sl - x); if (d < bd - 1e-9) { bd = d; best = sl; } }
  return best;
}
function serve(s) {
  s.ph = 'play'; s.pt = 0; s.still = 0; s.served = s.t; s.last = -1;
  s.bx = HW - BR - 0.01; s.bz = (roll(s, 21) - 10) * 0.002;
  s.vx = -(0.024 + roll(s, 10) * 0.0012); s.vz = (roll(s, 21) - 10) * 0.0004;
  s.ev.push({ k: 'serve' });
}
function goal(s, who) {
  s.ph = 'goal'; s.pt = 0; s.scorer = who;
  if (who === 1) {
    s.me++; let pts = 100; const tags = [];
    if (s.last === 0 || s.last === 1) { pts += 100; s.longs++; tags.push('LONG SHOT'); }
    if (s.t - s.served < 180) { pts += 50; s.quicks++; tags.push('QUICK GOAL'); }
    s.score += pts; s.ev.push({ k: 'goal', who, pts, tags, x: s.bx, me: s.me, cpu: s.cpu });
  } else { s.cpu++; s.ev.push({ k: 'goal', who, pts: 0, tags: [], x: s.bx, me: s.me, cpu: s.cpu }); }
  s.vx = 0; s.vz = 0;
}
function end(s) {
  s.over = true; s.win = s.me > s.cpu;
  if (s.win) s.score += 500 + (s.cpu === 0 ? 300 : 0);
  s.ev.push({ k: 'over', win: s.win, me: s.me, cpu: s.cpu, shutout: s.win && s.cpu === 0 });
}

/** The ball against rod i's men: kicked forward while they kick, else stopped and bounced off them (their feet up: past). */
function men(s, i, f) {
  const R = RODS[i], kt = s.kt[i];
  if (!footDown(kt)) return;
  const dz = s.bz - R.z;
  if (Math.abs(dz) > (kicking(kt) ? REACH + BR : MD + BR)) return;
  for (const m0 of R.xs) {
    const mx = m0 + s.sl[i] - s.sv[i] * (1 - f), dx = s.bx - mx;
    if (Math.abs(dx) > MW + BR) continue;
    if (kicking(kt)) {
      const off = dx / (MW + BR);   // (off the man's middle: angled)
      s.vz = R.dir * (KICKV + roll(s, 7) * 0.001); s.vx = off * 0.03 + s.sv[i] * 0.9 + (roll(s, 9) - 4) * 0.0008;
      if (Math.abs(dz) < MD + BR) s.bz = R.z + R.dir * (MD + BR + 0.002);   // (out of the foot, in front of it)
      s.last = i; s.kt[i] = 3;   // (the foot through it: up)
      s.ev.push({ k: 'kick', rod: i, red: R.red, x: s.bx, z: s.bz });
      return;
    }
    // a man in the way: the nearest face of his foot
    const px = clamp(s.bx, mx - MW, mx + MW), pz = clamp(s.bz, R.z - MD, R.z + MD);
    let nx = s.bx - px, nz = s.bz - pz; const d = Math.sqrt(nx * nx + nz * nz);
    if (d >= BR) continue;
    if (d < 1e-6) { nx = 0; nz = dz >= 0 ? 1 : -1; } else { nx /= d; nz /= d; }
    s.bx = px + nx * BR; s.bz = pz + nz * BR;
    const vn = (s.vx - s.sv[i]) * nx + s.vz * nz;
    if (vn < 0) {
      const fast = Math.abs(s.vz) > 0.03;
      s.vx -= (1 + MAN_E) * vn * nx; s.vz -= (1 + MAN_E) * vn * nz;
      if (fast && R.red && i <= 1 && s.last >= 0 && !RODS[s.last].red && nz > 0) { s.blocks++; s.score += 10; s.ev.push({ k: 'block', x: s.bx, z: s.bz }); }
      else if (-vn > 0.006) s.ev.push({ k: 'bump', x: s.bx, z: s.bz, v: -vn });
    }
    return;
  }
}

export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev;
  s.prev = b;
  // you: where your men go, and the kick
  if (b & (BTN.U | BTN.D)) s.tx = clamp(s.tx + (b & BTN.D ? KEYV : -KEYV), -HW, HW);
  else if (inp.pd) s.tx = clamp(fromPy(inp.py), -HW, HW);
  if (pressed & BTN.A) for (let i = 0; i < RODS.length; i++) if (RODS[i].red && s.kt[i] < 0) { s.kt[i] = 0; if (i === 3) s.ev.push({ k: 'swing' }); }
  // the computer: each blue rod to where the ball will be at it, and a kick when it's at its feet
  const lv = Math.min(4, s.me), vmax = CPU.v + 0.002 * lv;
  if (--s.look <= 0) {
    s.look = CPU.look - (lv >> 1) + roll(s, 3);
    for (let i = 0; i < RODS.length; i++) {
      if (RODS[i].red) continue;
      const dz = RODS[i].z - s.bz, t = s.vz !== 0 && dz / s.vz > 0 ? Math.min(40, dz / s.vz) : 0;
      s.tg[i] = slideFor(i, clamp(s.bx + s.vx * t * CPU.lead, -HW, HW) + (roll(s, 9) - 4) * CPU.err);
    }
  }
  for (let i = 0; i < RODS.length; i++) {
    const R = RODS[i], want = R.red ? slideFor(i, s.tx) : s.tg[i], v = R.red ? PTRV : vmax;
    const d = clamp(want - s.sl[i], -v, v);
    s.sv[i] = d; s.sl[i] += d;
    if (s.kt[i] >= 0 && ++s.kt[i] >= KICK) s.kt[i] = -1;
    if (!R.red && s.kt[i] < 0 && s.ph === 'play' && Math.abs(s.bz - R.z) < REACH && s.vz > -0.03) {
      for (const m of menOf(s, i)) if (Math.abs(s.bx - m) < MW + BR + 0.004 && roll(s, 100) < CPU.kick + 5 * lv) { s.kt[i] = 0; break; }
    }
  }
  if (s.ph === 'goal') {
    if (++s.pt >= PAUSE) { if (s.me >= GOALS || s.cpu >= GOALS || s.clock <= 0) { end(s); return; } serve(s); }
    return;
  }
  if (--s.clock <= 0) { s.ev.push({ k: 'buzzer' }); end(s); return; }
  if (s.clock === 600) s.ev.push({ k: 'hurry' });
  for (let k = 1; k <= NS; k++) {
    s.bx += s.vx / NS; s.bz += s.vz / NS;
    const f = k / NS;
    for (let i = 0; i < RODS.length; i++) men(s, i, f);
    if (s.bx < -HW + BR) { s.bx = 2 * (-HW + BR) - s.bx; s.vx = -s.vx * WALL_E; }
    else if (s.bx > HW - BR) { s.bx = 2 * (HW - BR) - s.bx; s.vx = -s.vx * WALL_E; }
    if (s.bz < -HL + BR || s.bz > HL - BR) {
      const theirs = s.bz > 0;
      if (Math.abs(s.bx) < GW - BR * 0.3) { goal(s, theirs ? 1 : -1); return; }
      s.bz = theirs ? 2 * (HL - BR) - s.bz : 2 * (-HL + BR) - s.bz; s.vz = -s.vz * WALL_E;
      if (Math.abs(s.vz) > 0.01) s.ev.push({ k: 'wall', x: s.bx, z: s.bz });
    }
  }
  const sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (sp > VMAX) { s.vx = (s.vx / sp) * VMAX; s.vz = (s.vz / sp) * VMAX; }
  s.vx *= FRICTION; s.vz *= FRICTION;
  // a dead ball (still where nobody plays it) is served again
  if (sp < 0.0015) { if (++s.still >= DEAD) { s.ev.push({ k: 'dead' }); serve(s); } } else s.still = 0;
}
/** How far rod i is turned now (radians, its feet toward the side it attacks): the kick's swing and follow-through. */
export function twistOf(s, i) {
  const kt = s.kt[i]; if (kt < 0) return 0;
  return kt < 3 ? (kt / 3) * 1.1 : kt < 9 ? 1.1 + ((kt - 3) / 6) * 0.4 : 1.5 * (1 - (kt - 9) / 7);
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ me: s.me, cpu: s.cpu, win: s.win, blocks: s.blocks, longs: s.longs, quicks: s.quicks });
