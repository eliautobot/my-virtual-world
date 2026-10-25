// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Star Pinball (docs/features/arcade.md "The machines"): the Pinball machine played for real (its tilted playfield, walls,
// arch, shooter lane, pop bumpers, slingshots, drop targets, rollover lanes and flippers: shared/arcade/machines.js PIN).
// Three balls. Pull the plunger back and let go: the ball goes up the lane and round the arch. Keep it in play with the
// flippers: down the inlanes it comes to them, down the outlanes beside them it is gone. Pop bumpers 100, slingshots 10, a rollover lane lit 50 (all three: 500 and the bonus multiplier up), a drop
// target 200 (all three: 1000 and the multiplier up); the first lane after a launch, if it is the flashing one, a SKILL
// SHOT: 1000. A drained ball counts its bonus (what it hit, times the multiplier, up to ×5). A ball lost in the first six
// seconds after a launch is saved once. A ball still for five seconds (or kept in one spot ten) is kicked free; a flipper
// held fifteen seconds drops.
// Controls: ◀ (or B) the left flipper, ▶ (or A) the right; ▼ (or A) held and let go, the plunger; on a screen, hold its
// left or right half (the right half also pulls the plunger). The sim (rules only; the game in the world is
// client/js/play/machines/star-pinball.js): deterministic, see shared/arcade/core.js; the playfield's own x (right) and z
// (down the slope, toward you) in metres, speeds in metres a step (1/60 s), angles in 1024ths of a turn.
import { BTN, baseState, roll, SIN, COS, FX } from '../core.js';
import { PIN } from '../machines.js';

const BR = PIN.ballR, NS = 8, G = 1.11 / 3600, VMAX = 0.07, WALL_E = 0.45, POST_E = 0.55, ARCH_E = 0.1;
const FLIP_UP = 64, FLIP_DOWN = 32, FLIP_E = 0.45, HOLD_MAX = 15 * 60, BUMP_KICK = 0.024, SLING_KICK = 0.02;
export const BALLS = 3, SAVE = 6 * 60, PAUSE = 120, LANE_IDLE = 10 * 60, STILL = 5 * 60, STALL = 10 * 60, MULT_MAX = 5;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---- the playfield's walls, as segments [ax, az, bx, bz, restitution, kick, id, one-way normal?]
const W = PIN.wallX, A0 = PIN.arch, L = PIN.lane;
export const SEGS = (() => {
  const g = [];
  const add = (a, b, e = WALL_E, kick = 0, id = 'wall', one = null) => g.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], e, kick, id, one });
  for (let k = 0; k < 16; k++) {   // the arch over the top: from the right wall round to the left
    const a0 = k * 32, a1 = (k + 1) * 32;
    add([(A0.r * COS[a0]) / FX, A0.cz - (A0.r * SIN[a0]) / FX], [(A0.r * COS[a1]) / FX, A0.cz - (A0.r * SIN[a1]) / FX], ARCH_E, 0, 'arch');
  }
  add([-W, A0.cz], [-W, PIN.drain + 0.05]);          // the left wall (the left outlane's outer side)
  add([W, A0.cz], [W, PIN.drain + 0.05]);              // the right wall (the shooter lane's outer side)
  add([L.x, L.top], [L.x, PIN.drain + 0.05]);           // the shooter lane's wall
  for (const [a, b] of PIN.guides) add(a, b);           // the guides onto the flippers
  const [g0, g1] = PIN.gate, gx = g1[0] - g0[0], gz = g1[1] - g0[1], gl = Math.sqrt(gx * gx + gz * gz);
  add(g0, g1, WALL_E, 0, 'gate', [gz / gl, -gx / gl]);  // the one-way gate at the lane's top (the field side: up and left)
  PIN.slings.forEach(([a, b, c], i) => { add(a, b, POST_E); add(b, c, WALL_E); add(a, c, POST_E, SLING_KICK, `sling${i}`); });
  for (const x of PIN.laneGuides) add([x, PIN.laneZ[0]], [x, PIN.laneZ[1]], POST_E, 0, 'post');
  return g;
})();
// (the one-way gate's normal must point to the field side: up and to the left)
if (SEGS.find(g => g.id === 'gate').one[0] > 0) { const g = SEGS.find(q => q.id === 'gate'); g.one = [-g.one[0], -g.one[1]]; }

export function init(seed) {
  return {
    ...baseState(seed),
    x: L.rest[0], z: L.rest[1], vx: 0, vz: 0, ph: 'lane', pt: 0, ball: 1, score: 0,
    fa: [PIN.flipRest, PIN.flipRest], fp: [PIN.flipRest, PIN.flipRest], held: [0, 0], prev: 0,
    pull: 0, idle: 0, save: 0, saved: false, skill: false, skillLane: 1, still: 0, ax: 0, az: 0, stall: 0,
    down: [false, false, false], downT: 0, lit: [false, false, false], litT: 0, inLane: -1, mult: 1,
    hits: { bump: 0, sling: 0, lane: 0, target: 0 }, total: { bump: 0, sling: 0, lane: 0, target: 0, skill: 0, saves: 0 },
    over: false,
  };
}

/** Flipper i's tip direction at angle a (unit, playfield x and z). */
export const flipDir = (i, a) => [(i ? -COS[a & 1023] : COS[a & 1023]) / FX, SIN[a & 1023] / FX];

/** The ball against a segment, as a capsule of radius rad: out of it, bounced (e), kicked (kick). → how hard it came in. */
function seg(s, ax, az, bx, bz, rad, e, kick, one) {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
  const t = clamp(((s.x - ax) * ex + (s.z - az) * ez) / l2, 0, 1), qx = ax + ex * t, qz = az + ez * t;
  let nx = s.x - qx, nz = s.z - qz;
  const d2 = nx * nx + nz * nz, R = BR + rad;
  if (d2 >= R * R) return 0;
  if (one) { if ((s.x - ax) * one[0] + (s.z - az) * one[1] < 0) return 0; nx = one[0]; nz = one[1]; s.x = qx + nx * R; s.z = qz + nz * R; }
  else {
    const d = Math.sqrt(d2);
    if (d < 1e-9) { const el = Math.sqrt(l2); nx = -ez / el; nz = ex / el; } else { nx /= d; nz /= d; }
    s.x = qx + nx * R; s.z = qz + nz * R;
  }
  const vn = s.vx * nx + s.vz * nz;
  if (vn >= 0) return 0;
  s.vx -= (1 + e) * vn * nx; s.vz -= (1 + e) * vn * nz;
  if (kick && vn < -0.004) { s.vx += nx * kick; s.vz += nz * kick; }
  return -vn;
}
/** The ball against flipper i at angle a turning w (1024ths a step): its rubber, and the flipper's own swing. */
function flipper(s, i, a, w) {
  const P = PIN.flippers[i].at, [ux, uz] = flipDir(i, a), Lf = PIN.flipLen;
  const t = clamp(((s.x - P[0]) * ux + (s.z - P[1]) * uz) / Lf, 0, 1), qx = P[0] + ux * Lf * t, qz = P[1] + uz * Lf * t;
  let nx = s.x - qx, nz = s.z - qz;
  const d2 = nx * nx + nz * nz, R = BR + PIN.flipR0 + (PIN.flipR1 - PIN.flipR0) * t;
  if (d2 >= R * R) return 0;
  const d = Math.sqrt(d2) || 1e-9; nx /= d; nz /= d;
  s.x = qx + nx * R; s.z = qz + nz * R;
  // the flipper's surface moving there: ω × r (ω in radians a step)
  const om = (w * 6.283185307179586) / 1024, sl = Lf * t;
  const cvx = i ? om * sl * uz : -om * sl * uz, cvz = i ? -om * sl * ux : om * sl * ux;
  const vn = (s.vx - cvx) * nx + (s.vz - cvz) * nz;
  if (vn >= 0) return 0;
  s.vx -= (1 + FLIP_E) * vn * nx; s.vz -= (1 + FLIP_E) * vn * nz;
  return -vn;
}

function addScore(s, n) { s.score += n; }
function launch(s, p) {
  s.ph = 'play'; s.vx = 0; s.vz = -(0.02 + 0.03 * p); s.pull = 0; s.idle = 0; s.skill = true; s.still = 0;
  if (!s.saved) s.save = SAVE;
  s.ev.push({ k: 'launch', p });
}
function drain(s) {
  if (s.save > 0 && !s.saved) {
    s.saved = true; s.total.saves++; s.ph = 'lane'; s.x = L.rest[0]; s.z = L.rest[1]; s.vx = s.vz = 0;
    s.ev.push({ k: 'saved' }); return;
  }
  const h = s.hits, bonus = (h.bump * 10 + h.sling * 5 + h.lane * 25 + h.target * 50) * s.mult;
  addScore(s, bonus);
  s.ev.push({ k: 'drain', bonus, mult: s.mult, ball: s.ball });
  s.ph = 'drain'; s.pt = 0;
}
function nextBall(s) {
  s.ball++;
  if (s.ball > BALLS) { s.over = true; s.ball = BALLS; s.ev.push({ k: 'over' }); return; }
  s.ph = 'lane'; s.x = L.rest[0]; s.z = L.rest[1]; s.vx = s.vz = 0; s.saved = false; s.save = 0; s.mult = 1;
  s.hits = { bump: 0, sling: 0, lane: 0, target: 0 }; s.lit = [false, false, false]; s.down = [false, false, false]; s.downT = 0;
  s.skillLane = roll(s, 3);
  s.ev.push({ k: 'ball', n: s.ball });
}

export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev;
  s.prev = b;
  // the flippers: up while held (up to HOLD_MAX), else back down
  const want = [b & (BTN.L | BTN.B), b & (BTN.R | BTN.A)];
  for (let i = 0; i < 2; i++) {
    s.fp[i] = s.fa[i];
    s.held[i] = want[i] ? s.held[i] + 1 : 0;
    const up = want[i] && s.held[i] < HOLD_MAX;
    s.fa[i] = up ? Math.max(PIN.flipUp, s.fa[i] - FLIP_UP) : Math.min(PIN.flipRest, s.fa[i] + FLIP_DOWN);
    if (up && s.held[i] === 1) {
      s.ev.push({ k: 'flip', i });
      // (a flipper pressed moves the lit lanes along: line them up)
      const l = s.lit; s.lit = i ? [l[2], l[0], l[1]] : [l[1], l[2], l[0]];
    }
  }
  if (s.downT > 0 && --s.downT === 0) { s.down = [false, false, false]; s.ev.push({ k: 'reset' }); }
  if (s.litT > 0 && --s.litT === 0) s.lit = [false, false, false];
  if (s.ph === 'drain') { if (++s.pt >= PAUSE) nextBall(s); return; }
  if (s.ph === 'lane') {
    // the plunger: pulled back while held, let go to launch (or by itself, left long enough)
    const pull = b & (BTN.D | BTN.A);
    if (pull) { s.pull = Math.min(1, s.pull + 1 / 60); s.idle = 0; if (pressed & (BTN.D | BTN.A)) s.ev.push({ k: 'pull' }); }
    else if (s.pull > 0.04) launch(s, s.pull);
    else { s.pull = 0; if (++s.idle >= LANE_IDLE) launch(s, 0.6); }
    return;
  }
  if (s.save > 0) s.save--;
  for (let k = 1; k <= NS; k++) {
    s.vz += G / NS;
    s.x += s.vx / NS; s.z += s.vz / NS;
    for (const g of SEGS) {
      const hit = seg(s, g.ax, g.az, g.bx, g.bz, 0, g.e, g.kick, g.one);
      if (hit && g.kick && hit > 0.004) {
        s.hits.sling++; s.total.sling++; addScore(s, 10); s.ev.push({ k: 'sling', i: g.id === 'sling0' ? 0 : 1 });
      }
    }
    // the drop targets on the left wall, those still up
    for (let j = 0; j < 3; j++) {
      if (s.down[j]) continue;
      const tz = PIN.targets[j], hit = seg(s, PIN.targetX, tz - PIN.targetH, PIN.targetX, tz + PIN.targetH, 0.004, WALL_E, 0, null);
      if (hit > 0.002) {
        s.down[j] = true; s.hits.target++; s.total.target++; addScore(s, 200); s.ev.push({ k: 'target', j });
        if (s.down.every(Boolean)) { addScore(s, 1000); s.mult = Math.min(MULT_MAX, s.mult + 1); s.downT = 90; s.ev.push({ k: 'targets', mult: s.mult }); }
      }
    }
    // the pop bumpers: away at once
    PIN.bumpers.forEach(([cx, cz], j) => {
      let nx = s.x - cx, nz = s.z - cz; const d2 = nx * nx + nz * nz, R = BR + PIN.bumperR;
      if (d2 >= R * R) return;
      const d = Math.sqrt(d2) || 1e-9; nx /= d; nz /= d;
      s.x = cx + nx * R; s.z = cz + nz * R;
      const vn = s.vx * nx + s.vz * nz;
      if (vn < 0) { s.vx -= 1.5 * vn * nx; s.vz -= 1.5 * vn * nz; }
      const out = s.vx * nx + s.vz * nz;
      if (out < BUMP_KICK) { s.vx += nx * (BUMP_KICK - out); s.vz += nz * (BUMP_KICK - out); }
      s.hits.bump++; s.total.bump++; addScore(s, 100); s.ev.push({ k: 'bumper', j });
    });
    // the flippers, where they are this part of the step
    for (let i = 0; i < 2; i++) flipper(s, i, Math.round(s.fp[i] + ((s.fa[i] - s.fp[i]) * k) / NS), s.fa[i] - s.fp[i]);
    const sp = Math.sqrt(s.vx * s.vx + s.vz * s.vz);
    if (sp > VMAX) { s.vx = (s.vx / sp) * VMAX; s.vz = (s.vz / sp) * VMAX; }
  }
  // the rollover lanes at the top
  let lane = -1;
  if (s.z > PIN.laneZ[0] && s.z < PIN.laneZ[1]) PIN.lanes.forEach((x, j) => { if (Math.abs(s.x - x) < 0.03) lane = j; });
  if (lane >= 0 && lane !== s.inLane) {
    if (s.skill && lane === s.skillLane) { addScore(s, 1000); s.total.skill++; s.ev.push({ k: 'skill', j: lane }); }
    s.skill = false;
    if (!s.lit[lane]) {
      s.lit[lane] = true; s.hits.lane++; s.total.lane++; addScore(s, 50); s.ev.push({ k: 'lane', j: lane });
      if (s.lit.every(Boolean)) { addScore(s, 500); s.mult = Math.min(MULT_MAX, s.mult + 1); s.litT = 60; s.ev.push({ k: 'lanes', mult: s.mult }); }
    }
  }
  s.inLane = lane;
  if (s.z > -0.3 && s.x < L.x) s.skill = false;   // (down into the field: no skill shot any more)
  // back down the shooter lane: onto the plunger again
  if (s.x > L.x && s.z >= L.rest[1] && s.vz >= 0) { s.ph = 'lane'; s.x = L.rest[0]; s.z = L.rest[1]; s.vx = s.vz = 0; s.pull = 0; s.idle = 0; return; }
  if (s.z > PIN.drain) { drain(s); return; }
  // stuck: still (and not held on a flipper) five seconds, or kept within a few centimetres ten, kicked free
  const kick = () => { s.still = 0; s.stall = 0; s.vx = (roll(s, 21) - 10) * 0.001; s.vz = -0.02; s.ev.push({ k: 'search' }); };
  if (s.vx * s.vx + s.vz * s.vz < 0.0005 * 0.0005 && !s.held[0] && !s.held[1]) { if (++s.still >= STILL) kick(); } else s.still = 0;
  if (Math.abs(s.x - s.ax) < 0.04 && Math.abs(s.z - s.az) < 0.04) { if (++s.stall >= STALL) kick(); } else { s.ax = s.x; s.az = s.z; s.stall = 0; }
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ ...s.total, balls: BALLS });
