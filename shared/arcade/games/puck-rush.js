// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Puck Rush (docs/features/arcade.md "The machines"): the Air Hockey table played for real (its surface, rails, goals,
// puck and strikers: shared/arcade/machines.js HOCKEY), you at the near end (red, +z) against the computer (blue, -z).
// First to seven goals, or the most when the two minutes are up. The puck glides on the air, off the rails and the
// strikers (each hit as hard as the striker moved); a goal 100, a hard one (a SLAP SHOT) or one off a rail (a BANK SHOT)
// 50 more, stopping a hard shot of the computer's in front of your goal (a SAVE) 20; winning 500, without letting one in
// 300 more. The computer gets quicker with every goal you score.
// Controls: the pointer (the mouse over the table, a finger on it) moves your striker there (as fast as a hand); or
// ▲ ▼ ◀ ▶, A to move quicker. The sim (rules only; the game in the world is client/js/play/machines/puck-rush.js):
// deterministic, see shared/arcade/core.js; metres in the table's frame (x right as you face it, z toward you), speeds in
// metres a step (1/60 s).
import { BTN, baseState, roll } from '../core.js';
import { HOCKEY } from '../machines.js';

const { hw: HW, hl: HL, goal: GW, puckR: PR, strikerR: SR } = HOCKEY;
export const GOALS = 7, CLOCK = 120 * 60, NS = 4, ZMIN = 0.07;
const VMAX = 0.1, KEYV = 0.026, PTRV = 0.1, FRICTION = 0.9988, WALL_E = 0.88, HIT_E = 0.8, RR = PR + SR, PAUSE = 90, SLAP = 0.07;
const XS = HW - SR, ZS = HL - SR;
export const CPU = { v: 0.044, a: 0.013, t: 4, err: 0.0025 };   // (the computer's top speed and pick-up a step, how often it looks again, how far off it aims)
const CPUV = CPU.v, CPUA = CPU.a, CPUT = CPU.t;
/** The pointer's place over your half (px, py 0 … 255: x across the table, z from the centre line to your end) and back. */
export const toPx = (x, z) => [Math.round(((x + HW) / (2 * HW)) * 255), Math.round((z / HL) * 255)];
const fromPx = (px, py) => [(px / 255) * 2 * HW - HW, (py / 255) * HL];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function init(seed) {
  return {
    ...baseState(seed),
    px: 0, pz: 0.35, vx: 0, vz: 0,                  // the puck
    sx: 0, sz: HOCKEY.park, ox: 0, oz: HOCKEY.park,  // your striker (and where it was a step ago)
    cx: 0, cz: -HOCKEY.park, qx: 0, qz: -HOCKEY.park, cvx: 0, cvz: 0,   // the computer's
    me: 0, cpu: 0, score: 0, clock: CLOCK, ph: 'play', pt: 0, scorer: 0, last: 0, bank: false, gx: 0, gz: 0,
    plan: { tx: 0, tz: -HL + 0.25, t: 0, aim: 0, mode: 'home' }, saves: 0, slaps: 0, banks: 0, over: false, win: false,
  };
}

function moveYou(s, inp) {
  s.ox = s.sx; s.oz = s.sz;
  const b = inp.b;
  let tx = s.sx, tz = s.sz;
  if (b & (BTN.L | BTN.R | BTN.U | BTN.D)) {
    const v = b & BTN.A ? KEYV * 1.8 : KEYV;
    if (b & BTN.L) tx -= v; if (b & BTN.R) tx += v; if (b & BTN.U) tz -= v; if (b & BTN.D) tz += v;
  } else if (inp.pd) {
    const [x, z] = fromPx(inp.px, inp.py);
    let dx = clamp(x, -XS, XS) - s.sx, dz = clamp(z, ZMIN, ZS) - s.sz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > PTRV) { dx = (dx / d) * PTRV; dz = (dz / d) * PTRV; }
    tx += dx; tz += dz;
  }
  s.sx = clamp(tx, -XS, XS); s.sz = clamp(tz, ZMIN, ZS);
}

/** The computer: every few steps it looks again (strike the puck in its half toward your goal, now and then off a rail;
 *  stand between a shot and its goal; else wait at home), and goes there as fast as it may. */
function think(s, P) {
  const lv = Math.min(6, s.me);
  if (s.ph !== 'play') { P.mode = 'home'; P.tx = 0; P.tz = -HL + 0.26; return; }
  const sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (s.pz < -0.02 && (s.vz > -0.012 || s.pz > -0.45)) {
    if (P.mode !== 'strike') { P.mode = 'strike'; const k = roll(s, 10); P.aim = k < 6 ? (roll(s, 21) - 10) * 0.012 : k < 8 ? 2 * HW - 0.05 : -2 * HW + 0.05; }
    // toward the aim (your goal, or its mirror past a rail: a bank shot)
    let ux = P.aim - s.px, uz = HL - s.pz; const d = Math.sqrt(ux * ux + uz * uz) || 1; ux /= d; uz /= d;
    const bx = s.cx - s.px, bz = s.cz - s.pz, along = bx * ux + bz * uz, side = Math.abs(bx * uz - bz * ux);
    if (along < -RR * 0.6 && side < 0.05) { P.tx = s.px + ux * 0.16; P.tz = s.pz + uz * 0.16; }   // behind it, lined up: through it
    else { P.tx = s.px - ux * (RR + 0.05); P.tz = s.pz - uz * (RR + 0.05); }                      // else round behind it
  } else if (s.vz < -0.004 && sp > 0.006) {
    P.mode = 'guard';
    const zd = -HL + 0.2, t = (zd - s.pz) / s.vz;
    let x = s.px + s.vx * t;
    const w = HW - PR, span = 4 * w;
    let y = (((x + w) % span) + span) % span;    // (folded back off the rails)
    if (y > 2 * w) y = 4 * w - y;
    x = y - w;
    P.tx = clamp(x, -GW - 0.06, GW + 0.06); P.tz = zd;
  } else { P.mode = 'home'; P.tx = s.px * 0.35; P.tz = -HL + 0.28; }
  P.tx += (roll(s, 41) - 20) * CPU.err * (1 - lv / 9);
}
function moveCpu(s) {
  s.qx = s.cx; s.qz = s.cz;
  const lv = Math.min(6, s.me), vmax = CPUV + 0.004 * lv, acc = CPUA + 0.0012 * lv, P = s.plan;
  if (--P.t <= 0) { P.t = CPUT - Math.min(2, lv >> 1) + roll(s, 3); think(s, P); }
  let dx = P.tx - s.cx, dz = P.tz - s.cz;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > vmax) { dx = (dx / d) * vmax; dz = (dz / d) * vmax; }
  s.cvx += clamp(dx - s.cvx, -acc, acc); s.cvz += clamp(dz - s.cvz, -acc, acc);
  s.cx = clamp(s.cx + s.cvx, -XS, XS); s.cz = clamp(s.cz + s.cvz, -ZS, -ZMIN);
}

/** The puck against a striker at (x, z) that moved (vx, vz) this step: out of it, and off it as hard as it came. */
function hit(s, x, z, vx, vz, who) {
  const dx = s.px - x, dz = s.pz - z, d2 = dx * dx + dz * dz;
  if (d2 >= RR * RR) return;
  const d = Math.sqrt(d2) || 1e-6, nx = dx / d, nz = dz / d;
  s.px = x + nx * RR; s.pz = z + nz * RR;
  const before = s.vz, vn = (s.vx - vx) * nx + (s.vz - vz) * nz;
  if (vn >= 0) return;
  s.vx -= (1 + HIT_E) * vn * nx; s.vz -= (1 + HIT_E) * vn * nz;
  const sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  if (sp > VMAX) { s.vx = (s.vx / sp) * VMAX; s.vz = (s.vz / sp) * VMAX; }
  s.last = who; s.bank = false;
  if (who === 1 && before > 0.035 && s.pz > HL * 0.45) { s.saves++; s.score += 20; s.ev.push({ k: 'save', x: s.px, z: s.pz }); }
  if (-vn > 0.004) s.ev.push({ k: 'hit', who, v: -vn, x: s.px, z: s.pz });
}
function goal(s, who) {
  const sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
  s.ph = 'goal'; s.pt = 0; s.scorer = who; s.gx = s.px; s.gz = who === 1 ? -HL : HL;
  if (who === 1) {
    s.me++; let pts = 100; const tags = [];
    if (sp > SLAP) { pts += 50; s.slaps++; tags.push('SLAP SHOT'); }
    if (s.bank && s.last === 1) { pts += 50; s.banks++; tags.push('BANK SHOT'); }
    s.score += pts; s.ev.push({ k: 'goal', who, pts, tags, x: s.px, me: s.me, cpu: s.cpu });
  } else { s.cpu++; s.ev.push({ k: 'goal', who, pts: 0, tags: [], x: s.px, me: s.me, cpu: s.cpu }); }
  s.vx = 0; s.vz = 0;
}
function end(s) {
  s.over = true; s.win = s.me > s.cpu;
  if (s.win) { s.score += 500 + (s.cpu === 0 ? 300 : 0); }
  s.ev.push({ k: 'over', win: s.win, me: s.me, cpu: s.cpu, shutout: s.win && s.cpu === 0 });
}

export function step(s, inp) {
  s.t++;
  if (s.over) return;
  moveYou(s, inp);
  moveCpu(s);
  if (s.ph === 'goal') {
    if (++s.pt >= PAUSE) {
      if (s.me >= GOALS || s.cpu >= GOALS || s.clock <= 0) { end(s); return; }
      // the one let in has the puck: on their side, still
      s.ph = 'play'; s.px = (roll(s, 21) - 10) * 0.01; s.pz = s.scorer === 1 ? -0.35 : 0.35; s.vx = 0; s.vz = 0; s.last = 0;
      s.ev.push({ k: 'serve', to: -s.scorer });
    }
    return;
  }
  if (--s.clock <= 0) { if (s.clock === 0) s.ev.push({ k: 'buzzer' }); end(s); return; }
  if (s.clock === 600) s.ev.push({ k: 'hurry' });
  for (let k = 1; k <= NS; k++) {
    s.px += s.vx / NS; s.pz += s.vz / NS;
    const f = k / NS;
    hit(s, s.ox + (s.sx - s.ox) * f, s.oz + (s.sz - s.oz) * f, s.sx - s.ox, s.sz - s.oz, 1);
    hit(s, s.qx + (s.cx - s.qx) * f, s.qz + (s.cz - s.qz) * f, s.cx - s.qx, s.cz - s.qz, -1);
    if (s.px < -HW + PR) { s.px = 2 * (-HW + PR) - s.px; s.vx = -s.vx * WALL_E; s.bank = true; if (Math.abs(s.vx) > 0.01) s.ev.push({ k: 'rail', v: -s.vx, x: s.px, z: s.pz }); }
    else if (s.px > HW - PR) { s.px = 2 * (HW - PR) - s.px; s.vx = -s.vx * WALL_E; s.bank = true; if (Math.abs(s.vx) > 0.01) s.ev.push({ k: 'rail', v: s.vx, x: s.px, z: s.pz }); }
    if (s.pz < -HL + PR || s.pz > HL - PR) {
      const mine = s.pz < 0;
      if (Math.abs(s.px) < GW - PR * 0.3) { goal(s, mine ? 1 : -1); return; }
      s.pz = mine ? 2 * (-HL + PR) - s.pz : 2 * (HL - PR) - s.pz; s.vz = -s.vz * WALL_E;
      if (Math.abs(s.vz) > 0.01) s.ev.push({ k: 'rail', v: Math.abs(s.vz), x: s.px, z: s.pz });
    }
  }
  s.vx *= FRICTION; s.vz *= FRICTION;
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ me: s.me, cpu: s.cpu, win: s.win, saves: s.saves, slaps: s.slaps, banks: s.banks });
