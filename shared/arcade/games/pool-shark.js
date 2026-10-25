// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Pool Shark (docs/features/arcade.md "The machines"): eight-ball on the Billiards Table itself (its cloth, cushions,
// pockets and balls: shared/arcade/machines.js POOL), you against the computer. You break. The first ball potted after a
// fair shot makes the groups (solids 1-7, stripes 9-15); pot yours and you shoot again; miss, foul (the cue ball potted,
// nothing hit, or the other group's ball hit first) and it is the other's turn. With your group cleared, pot the 8 to
// win; the 8 down early loses (on the break it is spotted again). A ball of yours potted 100, each further pot in a run
// 50 more; a win 1000 and 100 for every ball of the computer's still on the table. Twenty seconds a shot (three let run
// out in a row: the game is the computer's).
// Controls: the pointer (the mouse over the table, a finger on it) aims the cue from the cue ball (the way to it, sent as
// an angle fine enough for a thin cut); hold A (the mouse
// button, a finger, Z) to draw the cue back, the power rising and falling, let go to strike; ◀ ▶ turn the aim finely,
// ▲ ▼ more. The sim (rules only; the game in the world is client/js/play/machines/pool-shark.js): deterministic, see
// shared/arcade/core.js; metres on the cloth (x across, z toward you), speeds in metres a step (1/60 s).
import { BTN, baseState, roll, shuffle, SIN, COS, FX } from '../core.js';
import { POOL, poolRack } from '../machines.js';

const { hw: HW, hl: HL, ballR: R } = POOL, D2 = 4 * R * R, NS = 8;
const DEC = 0.4 / 3600, DAMP = 0.997, STOP = 0.0003, CUSH_E = 0.78, BALL_E = 0.95, VMIN = 0.008, VMAX = 0.1;
export const CLOCK = 20 * 60, MAX_SHOTS = 120, WALKOUT = 3;
export const CPU = { err: 0.00025, think: 50 };   // (the computer's aim off by up to 20 × err radians, and how long it looks)
// (turning the aim: fine ◀ ▶ 0.001 rad a step, ▲ ▼ 0.01; cos and sin written out, the same everywhere)
const FINE = [0.9999995000000417, 0.0009999998333333417], COARSE = [0.9999500004166653, 0.009999833334166664];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** The aim the pointer gives (the way from the cue ball to where it points, in 65536ths of a turn: its high byte as px,
 *  its low as py) from a way (x, z), and back to a way: by the angle table, between its entries in a straight line. */
export function toPx(x, z) {
  let a = Math.atan2(x, -z) / (2 * Math.PI); if (a < 0) a += 1;
  const v = Math.round(a * 65536) & 65535; return [v >> 8, v & 255];
}
export function aimOf(px, py) {
  const a = (((px & 255) << 8) | (py & 255)) / 64, i = Math.floor(a), f = a - i;
  const x = (SIN[i & 1023] * (1 - f) + SIN[(i + 1) & 1023] * f) / FX, z = -(COS[i & 1023] * (1 - f) + COS[(i + 1) & 1023] * f) / FX, l = Math.sqrt(x * x + z * z);
  return [x / l, z / l];
}
export const groupOf = n => (n >= 1 && n <= 7 ? 1 : n >= 9 ? 2 : 0);

// ---- the cushions, with gaps at the pockets and their jaws turned in toward them
export const CUSHIONS = (() => {
  const c = POOL.corner, sd = POOL.side, g = [];
  for (const sx of [-1, 1]) {
    g.push([sx * HW, -HL + c, sx * HW, -sd], [sx * HW, sd, sx * HW, HL - c]);
    g.push([sx * HW, -HL + c, sx * (HW + 0.045), -HL + c - 0.04], [sx * HW, HL - c, sx * (HW + 0.045), HL - c + 0.04]);   // (corner jaws, the long sides')
    g.push([sx * HW, -sd, sx * (HW + 0.04), -sd + 0.017], [sx * HW, sd, sx * (HW + 0.04), sd - 0.017]);                   // (side jaws)
  }
  for (const sz of [-1, 1]) {
    g.push([-HW + c, sz * HL, HW - c, sz * HL]);
    g.push([-HW + c, sz * HL, -HW + c - 0.04, sz * (HL + 0.045)], [HW - c, sz * HL, HW - c + 0.04, sz * (HL + 0.045)]);   // (corner jaws, the ends')
  }
  return g;
})();

export function init(seed) {
  const s = { ...baseState(seed), balls: [], turn: 1, ph: 'aim', pt: 0, ax: 0, az: -1, chg: -1, pw: 0, prev: 0, clock: CLOCK,
    group: 0, shot: null, shots: 0, run: 0, score: 0, potted: [0, 0], fouls: 0, best: 0, over: false, win: false, plan: null, walk: 0 };
  // the rack: the 1 at the apex, the 8 in the middle, a solid and a stripe at the back corners, the rest by the dice
  const spots = poolRack(), order = new Array(15).fill(0);
  const solids = shuffle(s, [2, 3, 4, 5, 6, 7]), stripes = shuffle(s, [9, 10, 11, 12, 13, 14, 15]);
  order[0] = 1; order[4] = 8;
  const flip = roll(s, 2); order[10] = flip ? solids.pop() : stripes.pop(); order[14] = flip ? stripes.pop() : solids.pop();
  const rest = shuffle(s, [...solids, ...stripes]);
  for (let i = 0; i < 15; i++) if (!order[i]) order[i] = rest.pop();
  s.balls.push({ n: 0, x: POOL.head[0], z: POOL.head[1], vx: 0, vz: 0, in: false });
  for (let i = 0; i < 15; i++) s.balls.push({ n: order[i], x: spots[i][0], z: spots[i][1], vx: 0, vz: 0, in: false });
  s.balls.sort((a, b) => a.n - b.n);
  return s;
}
const ballN = (s, n) => s.balls[n];
/** The balls of group g still on the table (1 solids, 2 stripes). */
export const left = (s, g) => s.balls.filter(b => !b.in && groupOf(b.n) === g).length;
/** The group of the one whose turn it is (1 the player, -1 the computer): 0 while the table is open. */
const groupFor = (s, who) => (!s.group ? 0 : who === 1 ? s.group : 3 - s.group);

/** Puts the cue ball on the head spot, along the line across it until it is clear of the others. */
function spotCue(s) {
  const c = s.balls[0]; c.in = false; c.vx = c.vz = 0;
  for (let k = 0; k < 40; k++) {
    const x = POOL.head[0] + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.06, z = POOL.head[1];
    if (s.balls.every(b => b === c || b.in || (b.x - x) * (b.x - x) + (b.z - z) * (b.z - z) > D2 * 1.1)) { c.x = x; c.z = z; return; }
  }
  c.x = POOL.head[0]; c.z = POOL.head[1];
}
function spotEight(s) {
  const b = s.balls[8]; b.in = false; b.vx = b.vz = 0;
  for (let k = 0; k < 40; k++) {
    const x = POOL.foot[0], z = POOL.foot[1] - k * 0.06;
    if (s.balls.every(o => o === b || o.in || (o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) > D2 * 1.1)) { b.x = x; b.z = z; return; }
  }
}

function strike(s, pw) {
  const c = s.balls[0], v = VMIN + (VMAX - VMIN) * pw;
  c.vx = s.ax * v; c.vz = s.az * v;
  s.ph = 'roll'; s.pt = 0; s.chg = -1; s.shots++;
  s.shot = { who: s.turn, first: -1, potted: [], scratch: false, group: groupFor(s, s.turn), cleared: s.group ? left(s, groupFor(s, s.turn)) === 0 : false, rails: 0, break: s.shots === 1 };
  s.ev.push({ k: 'strike', who: s.turn, p: pw });
}

/** One sub-step of the balls: moving, off each other and the cushions, into the pockets. */
function sub(s) {
  const B = s.balls;
  for (const b of B) if (!b.in && (b.vx || b.vz)) { b.x += b.vx / NS; b.z += b.vz / NS; }
  for (let i = 0; i < B.length; i++) {
    const a = B[i]; if (a.in) continue;
    for (let j = i + 1; j < B.length; j++) {
      const b = B[j]; if (b.in) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 >= D2 || d2 < 1e-12) continue;
      // back to the moment they touched (within this sub-step), so they meet at the right point whatever their speed
      const wx = (b.vx - a.vx) / NS, wz = (b.vz - a.vz) / NS, ww = wx * wx + wz * wz, dw = dx * wx + dz * wz;
      let tau = 0;
      if (ww > 1e-14 && dw < 0) tau = clamp((-dw + Math.sqrt(dw * dw + ww * (D2 - d2))) / ww, 0, 1);
      a.x -= (a.vx / NS) * tau; a.z -= (a.vz / NS) * tau; b.x -= (b.vx / NS) * tau; b.z -= (b.vz / NS) * tau;
      let cx = b.x - a.x, cz = b.z - a.z; const cd = Math.sqrt(cx * cx + cz * cz) || 1e-9, nx = cx / cd, nz = cz / cd;
      if (cd < 2 * R) { const over = (2 * R - cd) / 2; a.x -= nx * over; a.z -= nz * over; b.x += nx * over; b.z += nz * over; }
      const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (vn > 0) { const k = ((1 + BALL_E) / 2) * vn; a.vx -= k * nx; a.vz -= k * nz; b.vx += k * nx; b.vz += k * nz; }
      a.x += (a.vx / NS) * tau; a.z += (a.vz / NS) * tau; b.x += (b.vx / NS) * tau; b.z += (b.vz / NS) * tau;
      if (vn <= 0) continue;
      if (s.shot && s.shot.first < 0 && (a.n === 0 || b.n === 0)) s.shot.first = a.n === 0 ? b.n : a.n;
      if (vn > 0.004) s.ev.push({ k: 'click', v: vn, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    }
  }
  for (const b of B) {
    if (b.in) continue;
    for (const [ax, az, bx, bz] of CUSHIONS) {
      const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez, t = clamp(((b.x - ax) * ex + (b.z - az) * ez) / l2, 0, 1);
      const qx = ax + ex * t, qz = az + ez * t; let nx = b.x - qx, nz = b.z - qz; const d2 = nx * nx + nz * nz;
      if (d2 >= R * R) continue;
      const d = Math.sqrt(d2) || 1e-9; nx /= d; nz /= d;
      b.x = qx + nx * R; b.z = qz + nz * R;
      const vn = b.vx * nx + b.vz * nz;
      if (vn < 0) { b.vx -= (1 + CUSH_E) * vn * nx; b.vz -= (1 + CUSH_E) * vn * nz; if (s.shot) s.shot.rails++; if (vn < -0.006) s.ev.push({ k: 'cushion', v: -vn, x: b.x, z: b.z }); }
    }
    let pi = -1;
    POOL.pockets.forEach(([px, pz], i) => { if ((b.x - px) * (b.x - px) + (b.z - pz) * (b.z - pz) < POOL.pocketR * POOL.pocketR) pi = i; });
    if (pi < 0 && (Math.abs(b.x) > HW + 0.07 || Math.abs(b.z) > HL + 0.07)) {   // (past a jaw: the nearest pocket has it)
      let bd = 1e9; POOL.pockets.forEach(([px, pz], i) => { const dd = (b.x - px) * (b.x - px) + (b.z - pz) * (b.z - pz); if (dd < bd) { bd = dd; pi = i; } });
    }
    if (pi >= 0) {
      b.in = true; b.vx = b.vz = 0; b.x = POOL.pockets[pi][0]; b.z = POOL.pockets[pi][1];
      if (s.shot) { s.shot.potted.push(b.n); if (b.n === 0) s.shot.scratch = true; }
      s.ev.push({ k: 'pot', n: b.n, pocket: pi });
    }
  }
}

/** The shot over (everything still): the rules. */
function resolve(s) {
  const sh = s.shot, who = sh.who, pots = sh.potted.filter(n => n !== 0);
  let g = groupFor(s, who);
  const eight = pots.includes(8);
  let foul = sh.scratch || sh.first < 0 || (g && sh.first !== 8 && groupOf(sh.first) !== g) || (g && sh.first === 8 && !sh.cleared) || (!g && sh.first === 8 && !sh.break);
  if (eight) {
    if (sh.break) { spotEight(s); s.ev.push({ k: 'spot8' }); }
    else {
      const won = !foul && sh.cleared;
      s.over = true; s.win = won === (who === 1);
      if (s.win) { s.score += 1000 + 100 * left(s, 3 - s.group || 2); }
      s.ev.push({ k: 'eight', who, won, foul });
      s.ev.push({ k: 'over', win: s.win });
      return;
    }
  }
  // the table open: the first ball of a group potted on a fair shot makes the groups
  if (!g && !foul) {
    const first = pots.find(n => n !== 8);
    if (first !== undefined) { s.group = who === 1 ? groupOf(first) : 3 - groupOf(first); g = groupFor(s, who); s.ev.push({ k: 'groups', group: s.group }); }
  }
  const mine = g ? pots.filter(n => groupOf(n) === g) : [];
  if (who === 1) {
    s.potted[0] += mine.length;
    if (mine.length && !foul) { s.run++; const pts = mine.length * 100 + (s.run > 1 ? 50 * (s.run - 1) : 0); s.score += pts; s.best = Math.max(s.best, s.run); s.ev.push({ k: 'points', pts, run: s.run }); }
  } else s.potted[1] += mine.length;
  if (sh.scratch) spotCue(s);
  const again = !foul && mine.length > 0;
  if (foul) { if (who === 1) s.fouls++; s.ev.push({ k: 'foul', who, why: sh.scratch ? 'scratch' : sh.first < 0 ? 'miss' : 'wrong' }); }
  if (!again) { s.turn = -who; s.run = 0; s.ev.push({ k: 'turn', to: s.turn }); }
  s.shot = null;
  if (s.shots >= MAX_SHOTS) { s.over = true; s.win = false; s.ev.push({ k: 'over', win: false, out: true }); return; }
  s.ph = s.turn === 1 ? 'aim' : 'cpu'; s.pt = 0; s.clock = CLOCK; s.chg = -1; s.plan = null;
  if (s.turn === -1) planCpu(s);
}

/** Whether the line from a to b is clear of every ball on the table but those skipped (numbers). */
function clear(s, ax, az, bx, bz, skip) {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1e-9;
  for (const o of s.balls) {
    if (o.in || skip.includes(o.n)) continue;
    const t = clamp(((o.x - ax) * ex + (o.z - az) * ez) / l2, 0, 1), dx = o.x - (ax + ex * t), dz = o.z - (az + ez * t);
    if (dx * dx + dz * dz < D2 * 0.96) return false;
  }
  return true;
}
/** The computer's shot: each of its balls into each pocket by the ghost-ball line, the clear and straight ones best. */
function planCpu(s) {
  const c = s.balls[0], g = groupFor(s, -1), targets = s.balls.filter(b => !b.in && b.n !== 0 && (g ? (left(s, g) ? groupOf(b.n) === g : b.n === 8) : b.n !== 8));
  let best = null;
  for (const t of targets) for (let pi = 0; pi < 6; pi++) {
    const [px, pz] = POOL.pockets[pi];
    let ux = px - t.x, uz = pz - t.z; const d2 = Math.sqrt(ux * ux + uz * uz); ux /= d2; uz /= d2;
    if ((pi === 2 || pi === 3) && Math.abs(ux) < 0.55) continue;   // (a side pocket only takes a ball coming at it)
    const gx = t.x - ux * 2 * R, gz = t.z - uz * 2 * R;
    let vx = gx - c.x, vz = gz - c.z; const d1 = Math.sqrt(vx * vx + vz * vz); if (d1 < 1e-6) continue; vx /= d1; vz /= d1;
    const cos = vx * ux + vz * uz; if (cos < 0.35) continue;
    if (!clear(s, c.x, c.z, gx, gz, [0, t.n]) || !clear(s, t.x, t.z, px, pz, [0, t.n])) continue;
    const val = (cos * cos) / (0.3 + d1 + d2 * 1.5);
    if (!best || val > best.val) best = { val, vx, vz, d: d1 + d2 / (cos * cos) };
  }
  if (!best) {   // nothing on: straight at the nearest of its own
    let bd = 1e9, t0 = targets[0];
    for (const t of targets) { const dd = (t.x - c.x) * (t.x - c.x) + (t.z - c.z) * (t.z - c.z); if (dd < bd) { bd = dd; t0 = t; } }
    if (!t0) t0 = s.balls.find(b => !b.in && b.n !== 0);
    let vx = t0.x - c.x, vz = t0.z - c.z; const d = Math.sqrt(vx * vx + vz * vz) || 1; vx /= d; vz /= d;
    best = { vx, vz, d: d + 0.6 };
  }
  // off a little (the computer is only as good as its hand)
  const e = (roll(s, 41) - 20) * CPU.err, vx = best.vx - e * best.vz, vz = best.vz + e * best.vx, l = Math.sqrt(vx * vx + vz * vz);
  s.plan = { ax: vx / l, az: vz / l, pw: clamp((Math.sqrt(best.d) * 0.034 + 0.004 - VMIN) / (VMAX - VMIN), 0.12, 0.85), t: CPU.think + roll(s, 30) };
  if (s.shots === 0) s.plan.pw = 0.95;
}

export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, released = s.prev & ~b;
  s.prev = b;
  const c = s.balls[0];
  if (s.ph === 'aim') {
    if (inp.pd && s.chg < 0) { const [x, z] = aimOf(inp.px, inp.py); s.ax = x; s.az = z; }
    const turn = b & (BTN.L | BTN.R) ? FINE : b & (BTN.U | BTN.D) ? COARSE : null;
    if (turn) {
      const sg = b & (BTN.R | BTN.D) ? 1 : -1, x = s.ax * turn[0] - sg * s.az * turn[1], z = s.az * turn[0] + sg * s.ax * turn[1], l = Math.sqrt(x * x + z * z);
      s.ax = x / l; s.az = z / l;
    }
    if (b) s.walk = 0;
    if (b & BTN.A) { s.chg++; const k = s.chg % 120; s.pw = k < 60 ? k / 60 : (120 - k) / 60; }
    else if (s.chg >= 0 && released & BTN.A) { if (s.chg > 2) strike(s, Math.max(0.04, s.pw)); else s.chg = -1; }
    if (s.ph === 'aim' && --s.clock <= 0) {
      // (three turns let run out in a row: the player walked away, the game is the computer's)
      if (++s.walk >= WALKOUT) { s.over = true; s.win = false; s.ev.push({ k: 'over', win: false, walked: true }); return; }
      s.ev.push({ k: 'time' }); s.turn = -1; s.run = 0; s.ph = 'cpu'; s.pt = 0; s.chg = -1; s.clock = CLOCK; s.shots++; s.ev.push({ k: 'turn', to: -1 }); planCpu(s); }
    return;
  }
  if (s.ph === 'cpu') {
    const P = s.plan;
    // (the cue swung round to its line while it looks)
    s.ax += (P.ax - s.ax) * 0.1; s.az += (P.az - s.az) * 0.1; const l = Math.sqrt(s.ax * s.ax + s.az * s.az); s.ax /= l; s.az /= l;
    s.pw = s.pt > P.t - 30 ? (P.pw * (s.pt - (P.t - 30))) / 30 : 0;
    if (++s.pt >= P.t) { s.ax = P.ax; s.az = P.az; strike(s, P.pw); }
    return;
  }
  // rolling: the balls, until they all stop
  for (let k = 0; k < NS; k++) sub(s);
  let moving = false;
  for (const o of s.balls) {
    if (o.in) continue;
    const sp = Math.sqrt(o.vx * o.vx + o.vz * o.vz);
    if (sp < STOP) { o.vx = o.vz = 0; continue; }
    const k = Math.max(0, sp * DAMP - DEC) / sp; o.vx *= k; o.vz *= k; moving = true;
  }
  if (!moving || ++s.pt > 60 * 40) resolve(s);
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ win: s.win, potted: s.potted[0], best: s.best, fouls: s.fouls, shots: s.shots });
