// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Turbo Rush (docs/features/arcade.md): our own high-speed traffic racer, in daylight across five stages (the
// coast, a green valley, a desert canyon, the city, an alpine pass; then round again at sunset). A red supercar,
// four lanes: two your way, two coming at you. Race the clock to each checkpoint (more time, the next stage). The
// tricks pay, times a multiplier that grows with every one and falls back when you go quiet or crash:
//   near miss      pass a car close at speed (oncoming: twice), a close call even closer; fills the boost
//   oncoming       driving in the oncoming lanes at speed; fills the boost
//   slipstream     tuck in behind a car for a moment; fills the boost
//   rivals         three racers each stage, as quick as you: they boost, weave, use the first oncoming lane, catch
//                  up when you pass them and try to slam you into the traffic. Pass one, or ram it from the side
//                  (or while boosting) for a takedown, which fills the boost to the top. Reach the checkpoint ahead
//                  of a stage's rivals for a 1st or 2nd place bonus (time and points)
//   boost          hold A: much faster, points doubled, and a rival that hits you goes down; burn a long boost
//                  without crashing for a boost chain
// A crash costs the multiplier and the seconds to get going again. Controls: ◀ ▶ steer, A boost (hold), B brake.
// The sim (rules only; the 3D screen is client/arcade/games/turbo-rush.js): deterministic, see shared/arcade/core.js.
// Distances in metres, speeds in metres a second, one step = 1/60 s.
import { BTN, baseState, roll } from '../core.js';

export const LANES = [-5.25, -1.75, 1.75, 5.25], ROAD_HALF = 7, WALL = 8.6, CAR_W = 1.96, CAR_L = 4.55;
export const STAGE_LEN = 2000;
export const STAGES = ['COASTAL HIGHWAY', 'GREEN VALLEY', 'DESERT CANYON', 'METRO CITY', 'ALPINE PASS'];
export const stageAt = z => Math.max(0, Math.floor(z / STAGE_LEN));
export const KINDS = { sedan: { w: 1.85, l: 4.6 }, hatch: { w: 1.78, l: 4.0 }, suv: { w: 1.98, l: 4.8 }, van: { w: 2.02, l: 5.2 }, truck: { w: 2.5, l: 10 }, bus: { w: 2.55, l: 12 }, rival: { w: 1.95, l: 4.5 } };
const KIND_ODDS = [['sedan', 34], ['hatch', 22], ['suv', 18], ['van', 12], ['truck', 9], ['bus', 5]];
const DT = 1 / 60, MULT_MAX = 10, MULT_T = 200;

// the road: sections one after another, each with its bend (1/m, + to the right) and a hill (looks only)
function extend(s) {
  const last = s.track[s.track.length - 1], z0 = last ? last.z + last.len : 0;
  const n = s.track.length, straight = n < 2 || roll(s, 100) < 32, city = stageAt(z0) % 5 === 3;
  const curve = straight ? 0 : ((roll(s, 2) ? 1 : -1) * ((city ? 3 : 5) + roll(s, city ? 12 : 22))) / 10000;
  s.track.push({ z: z0, len: 280 + roll(s, 420), curve, hill: roll(s, 100) < 45 ? (roll(s, 2) ? 1 : -1) * (3 + roll(s, 9)) : 0 });
}
/** The bend at z (1/m), eased in over 90 m from the section before. */
export function curveAt(s, z) {
  const T = s.track;
  for (let i = T.length - 1; i >= 0; i--) {
    const sec = T[i];
    if (z >= sec.z) { const prev = i > 0 ? T[i - 1].curve : 0, u = Math.min(1, (z - sec.z) / 90); return prev + (sec.curve - prev) * u; }
  }
  return 0;
}
export const timeBonus = stage => Math.max(16, 28 - stage);
export const cruiseOf = s => Math.min(72, 60 + stageAt(s.z) * 1.6);
export const multOf = s => Math.min(MULT_MAX, 1 + s.chain);

export function init(seed) {
  const s = { ...baseState(seed), x: LANES[2], vx: 0, z: 0, v: 0, boost: 40, boosting: false, boostRun: 0, time: 50 * 60, score: 0,
    chain: 0, chainT: 0, bestMult: 1, near: 0, close: 0, takedowns: 0, overtakes: 0, track: [], traffic: [], rivals: [], spawnZ: 70,
    nextId: 1, crashT: 0, ghost: 0, checkpoints: 0, nextCp: STAGE_LEN, prev: 0, over: false, endT: 0, onc: 0, slip: 0, slipId: 0,
    startT: 180, carry: 0, stage: 0, shoved: 0 };
  extend(s); extend(s); extend(s);
  spawnRivals(s, true);
  return s;
}
function pts(s, base) { const p = Math.round(base * multOf(s) * (s.boosting ? 2 : 1)); s.score += p; return p; }
function trick(s, n = 1) { s.chain = Math.min(MULT_MAX - 1, s.chain + n); s.chainT = MULT_T; s.bestMult = Math.max(s.bestMult, multOf(s)); }
/** Three rivals: on the start line beside and just ahead of the car at the start; ahead on the road in a new stage.
 *  They want about our cruising speed (each a little different) and carry a boost of their own. */
function spawnRivals(s, start = false) {
  const st = stageAt(s.z), base = cruiseOf(s) - 3;
  const grid = start ? [[3, 9], [2, 24], [3, 40]] : [[2 + roll(s, 2), 110], [2 + roll(s, 2), 210], [2 + roll(s, 2), 310]];
  grid.forEach(([lane, dz], k) => {
    s.rivals.push({ id: s.nextId++, x: LANES[lane], lane, to: lane, z: s.z + dz + (start ? 0 : roll(s, 40)), v: start ? 0 : base, want: base + roll(s, 7), passed: false, color: k,
      rb: 30 + roll(s, 30), boosting: false, slam: 0, slamDir: 0, st });
  });
}
function spawn(s) {
  const st = stageAt(s.z), gap = Math.max(24, 62 - st * 5 - s.z / 900);
  while (s.spawnZ < s.z + 560) {
    s.spawnZ += gap + roll(s, 44);
    const lane = roll(s, 4), oncoming = lane < 2;
    let r = roll(s, 100), kind = 'sedan';
    for (const [k, p] of KIND_ODDS) { if (r < p) { kind = k; break; } r -= p; }
    const z = s.spawnZ, K = KINDS[kind];
    if (s.traffic.some(t => t.lane === lane && Math.abs(t.z - z) < 34) || s.rivals.some(t => Math.abs(t.x - LANES[lane]) < 2 && Math.abs(t.z - z) < 60)) continue;
    const slow = kind === 'truck' || kind === 'bus' ? 5 : 0;
    const v = oncoming ? -(22 + roll(s, 12)) : 22 + roll(s, 12) - slow;
    s.traffic.push({ id: s.nextId++, lane, x: LANES[lane], z, v, w: K.w, l: K.l, kind, to: lane, passed: false, slip: 0, color: roll(s, 10) });
  }
}
const overlap = (ax, az, aw, al, bx, bz, bw, bl) => Math.abs(ax - bx) < (aw + bw) / 2 - 0.05 && Math.abs(az - bz) < (al + bl) / 2;

export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev;
  s.prev = b;
  while (s.track[s.track.length - 1].z < s.z + 3000) extend(s);
  while (s.track.length > 3 && s.track[1].z + s.track[1].len < s.z - 120) s.track.shift();
  spawn(s);
  if (s.startT) { s.startT--; if (!s.startT) s.ev.push({ k: 'go' }); }
  const ending = s.time <= 0;
  if (ending && !s.endT) { s.endT = 1; s.boosting = false; s.ev.push({ k: 'timeup' }); }
  const live = !s.crashT && !ending && !s.startT;
  // boost: held, while there's some; a long one burned without a crash is a boost chain
  const wasBoosting = s.boosting;
  s.boosting = live && !!(b & BTN.A) && s.boost > 0 && s.v > 20;
  if (s.boosting && !wasBoosting) { s.boostRun = 0; s.ev.push({ k: 'boostOn' }); }
  if (s.boosting) {
    s.boost = Math.max(0, s.boost - 0.55); s.boostRun++;
    if (s.boost === 0) { if (s.boostRun >= 240) { const p = pts(s, 1200); trick(s, 2); s.ev.push({ k: 'boostChain', pts: p }); } s.ev.push({ k: 'boostOut' }); }
  }
  void pressed;
  // the car
  const steer = live ? ((b & BTN.R) ? 1 : 0) - ((b & BTN.L) ? 1 : 0) : 0, brake = live && !!(b & BTN.B);
  const off = Math.abs(s.x) > ROAD_HALF + 0.4;
  let target = !live && !s.crashT ? 0 : brake ? 18 : s.boosting ? 100 : cruiseOf(s);
  if (off) target = Math.min(target, 40);
  if (s.crashT) { s.v *= 0.94; if (--s.crashT === 0) respawn(s); }
  else s.v += (target - s.v) * (target > s.v ? (s.boosting ? 0.07 : s.startT ? 0 : 0.016) : brake || ending ? 0.05 : 0.025);
  if (s.startT) s.v = 0;
  // steering: a firm lane change (about 0.4 s), a little quicker the faster we go, eased in and out like a real car
  // (not a snap); the car holds its line through the bends (they are the road's look, not a pull). A rival's slam
  // takes the wheel for a moment
  const tv = steer * (8.5 + s.v * 0.08);
  s.vx += (tv - s.vx) * (s.shoved ? 0.08 : steer ? 0.13 : 0.2);
  if (s.shoved) s.shoved--;
  s.x += s.vx * DT;
  if (Math.abs(s.x) > WALL) {
    if (s.shoved && Math.abs(s.vx) > 6 && live && !s.ghost) { s.x = Math.sign(s.x) * WALL; s.vx = 0; s.shoved = 0; crash(s, 'wall'); }
    else { s.x = Math.sign(s.x) * WALL; s.vx = -s.vx * 0.3; s.v *= 0.99; if (s.t % 5 === 0) s.ev.push({ k: 'scrape', side: Math.sign(s.x) }); }
  }
  s.z += s.v * DT;
  if (s.ghost) s.ghost--;
  // the way driven scores
  if (!s.crashT && s.v > 5) { s.carry += s.v * DT * (s.boosting ? 2 : 1); while (s.carry >= 2) { s.carry -= 2; s.score++; } }
  // the oncoming lanes
  if (live && s.x < -0.4 && s.v > 35) {
    s.onc++; s.boost = Math.min(100, s.boost + 0.09); s.chainT = Math.max(s.chainT, 60);
    if (s.onc % 45 === 0) { const p = pts(s, 40); s.ev.push({ k: 'oncoming', pts: p }); }
  } else s.onc = 0;
  if (s.chainT && --s.chainT === 0 && s.chain) { s.chain = 0; s.ev.push({ k: 'multEnd' }); }
  // the traffic: moves, some change lanes; passing close is a near miss; tucking in behind is a slipstream; touching
  // one is a crash
  for (let i = s.traffic.length - 1; i >= 0; i--) {
    const t = s.traffic[i], rel0 = t.rel ?? t.z - s.z;   // (where it was from the car the step before: passing it is the change of side)
    t.z += t.v * DT;
    if (t.v > 0 && t.to === t.lane && roll(s, 2400) < 4) { const nl = t.lane === 2 ? 3 : 2; if (!s.traffic.some(o => o !== t && o.lane === nl && Math.abs(o.z - t.z) < 22) && !s.rivals.some(o => Math.abs(o.x - LANES[nl]) < 2.5 && o.z > t.z - 40 && o.z < t.z + 12)) { t.to = nl; s.ev.push({ k: 'signal', id: t.id }); } }
    if (t.to !== t.lane) { const d = LANES[t.to] - t.x; t.x += Math.sign(d) * Math.min(Math.abs(d), 1.7 * DT); if (Math.abs(d) < 0.02) t.lane = t.to; }
    const rel = t.z - s.z, dx = Math.abs(t.x - s.x), gap = dx - (t.w + CAR_W) / 2;
    if (!s.crashT && !s.ghost && live && overlap(s.x, s.z, CAR_W, CAR_L, t.x, t.z, t.w, t.l)) {
      crash(s, t.kind); t.z += t.v > 0 ? 10 : 3; t.v *= t.v > 0 ? 0.5 : 0.3; continue;
    }
    if (!t.passed && rel0 > 0 && rel <= 0) {
      t.passed = true;
      if (live && s.v > 30 && gap < 1.5 && gap > -0.05) {
        const closeCall = gap < 0.55, onc = t.v < 0;
        s.near++; if (closeCall) s.close++;
        const p = pts(s, (closeCall ? 300 : 150) * (onc ? 2 : 1));
        s.boost = Math.min(100, s.boost + (closeCall ? 22 : 14) * (onc ? 1.5 : 1));
        trick(s);
        s.ev.push({ k: 'near', pts: p, close: closeCall, oncoming: onc, side: t.x < s.x ? -1 : 1, mult: multOf(s) });
      }
    }
    // slipstream: right behind a car going our way
    if (live && t.v > 0 && rel > 3 && rel < 20 && dx < 1.1 && s.v > 30) {
      s.boost = Math.min(100, s.boost + 0.3);
      if (++t.slip === 50) { const p = pts(s, 100); trick(s); s.ev.push({ k: 'slip', pts: p }); }
    }
    t.rel = rel;
    if (rel < -70 || rel > 760) s.traffic.splice(i, 1);
  }
  // the rivals: race in our lanes (and the first oncoming one to get by), boost when the road is clear, catch up when
  // behind; alongside us they may slam into us. Pass them, or take them down
  const me = { x: s.x, z: s.z, v: s.v };
  for (let i = s.rivals.length - 1; i >= 0; i--) {
    const r = s.rivals[i], rel0 = r.rel ?? r.z - s.z;
    if (s.startT) continue;   // (on the line until GO)
    const near = [...s.traffic, ...s.rivals.filter(o => o !== r), me].filter(t => t.z > r.z - 12 && t.z < r.z + 300);
    // (the nearest car about lane-x from `from` to `to` m ahead of it, by their ends: a bus is 12 m long)
    const first = (x, from, to) => { let f = null; for (const t of near) if (Math.abs(t.x - x) < 1.9 && t.z - r.z + ((t.l || CAR_L) + KINDS.rival.l) / 2 > from + 4.5 && t.z - r.z < to && (!f || t.z < f.z)) f = t; return f; };
    const look = Math.max(55, r.v * 1.5), rel = r.z - s.z;
    // a lane is good to go into when it is clear about us, and (oncoming) when nothing comes at us for 3 s
    const open = l => !first(LANES[l], -7, 40 + r.v * 0.6) && (l >= 2 || !s.traffic.some(t => t.v < 0 && Math.abs(t.x - LANES[l]) < 2.2 && t.z > r.z - 6 && t.z - r.z < (r.v - t.v) * 3));
    const ahead = first(r.x, -2, look);
    const facing = r.lane < 2 && s.traffic.some(t => t.v < 0 && Math.abs(t.x - r.x) < 2.2 && t.z > r.z - 5 && t.z - r.z < (r.v - t.v) * 1.8);
    let panic = false;
    if (!r.slam && r.to === r.lane) {
      if (r.lane < 2) { if (open(2)) r.to = 2; else if (facing) { if (!first(LANES[2], -6, 10)) r.to = 2; else panic = true; } }   // back to our side
      else if (ahead) { const opts = r.lane === 3 ? [2] : [3, 1]; const l = opts.find(open); if (l !== undefined) r.to = l; }
    }
    // the nearest car in its way (where it is, and where it is going): keep a gap it can stop in
    const way = [first(r.x, -2, look), r.to !== r.lane ? first(LANES[r.to], -6, look) : null].filter(Boolean).sort((a, b) => a.z - b.z)[0];
    const blocked = panic || (way && way.v < r.v && way.z - r.z < (r.v - way.v) * 1.1 + 12);
    // boost: on a clear road, sooner when behind us
    const behind = rel < -25;
    if (r.boosting) { r.rb = Math.max(0, r.rb - 0.5); if (!r.rb || blocked || first(r.x, -2, 120)) r.boosting = false; }
    else { r.rb = Math.min(100, r.rb + 0.1); if (r.rb > (behind ? 18 : 45) && r.lane >= 2 && !r.slam && !first(r.x, -2, 170)) r.boosting = true; }
    let want = r.boosting ? 96 : r.want + (behind ? Math.min(14, -rel * 0.05) : rel > 280 ? -6 : 0);
    if (blocked) want = panic ? 18 : Math.min(want, way.v - 2);
    r.v += (want - r.v) * (want > r.v ? (r.boosting ? 0.05 : 0.02) : blocked ? 0.15 : 0.04);
    // threading close past the traffic fills its boost too
    for (const t of s.traffic) if (Math.abs(t.z - r.z) < 2.5 && Math.abs(t.x - r.x) - (t.w + KINDS.rival.w) / 2 < 1.3) r.rb = Math.min(100, r.rb + 1.2);
    // a slam: alongside us in the next lane it may swing at us (a twitch away first: that's the warning)
    if (!r.slam && r.to === r.lane && live && !s.ghost && Math.abs(rel) < 3.5) {
      const dx = s.x - r.x;
      if (Math.abs(dx) > 2.4 && Math.abs(dx) < 4.6 && roll(s, 100) < 3) { r.slam = 44; r.slamDir = Math.sign(dx); s.ev.push({ k: 'lunge', id: r.id, side: r.slamDir }); }
    }
    if (r.slam) {
      r.slam--;
      const home = LANES[r.lane];
      if (blocked && r.slam > 15) r.slam = 15;                              // (something ahead: never mind us)
      if (r.slam >= 16) { r.v += (s.v - r.v) * 0.2; r.z += (s.z - r.z) * 0.04; }   // (it keeps alongside)
      if (r.slam >= 30) r.x -= r.slamDir * 1.6 * DT;                       // the twitch away
      else if (r.slam >= 16) r.x += r.slamDir * 10.5 * DT;                 // the swing
      else { const d = home - r.x; r.x += Math.sign(d) * Math.min(Math.abs(d), 6 * DT); }
      if (!r.slam) r.x = home;
    } else if (r.to !== r.lane) { const d = LANES[r.to] - r.x; r.x += Math.sign(d) * Math.min(Math.abs(d), 4.6 * DT); if (Math.abs(d) < 0.02) r.lane = r.to; }
    r.z += r.v * DT;
    if (s.traffic.some(t => overlap(r.x, r.z, KINDS.rival.w, KINDS.rival.l, t.x, t.z, t.w, t.l))) { s.rivals.splice(i, 1); s.ev.push({ k: 'rivalWreck', id: r.id, x: r.x, z: r.z }); continue; }
    const rl = r.z - s.z;
    if (live && !s.ghost && overlap(s.x, s.z, CAR_W, CAR_L, r.x, r.z, KINDS.rival.w, KINDS.rival.l)) {
      const side = Math.abs(rl) < (CAR_L + KINDS.rival.l) / 2 - 1.3, into = Math.sign(s.vx) === Math.sign(r.x - s.x) && Math.abs(s.vx) > 2.5;
      if ((side && into) || s.boosting) {
        s.rivals.splice(i, 1); s.takedowns++;
        const p = pts(s, 1500); s.boost = 100; trick(s, 2);
        s.ev.push({ k: 'takedown', id: r.id, pts: p, x: r.x, z: r.z, side: Math.sign(r.x - s.x) || 1 });
        continue;
      }
      if (side && r.slam >= 16 && r.slam < 30) {
        // slammed: shoved off our line for a moment, slower
        s.shoved = 16; s.vx = r.slamDir * 18; s.v = Math.max(20, s.v - 6); r.v += 2; r.slam = 15;
        s.x = r.x + r.slamDir * ((CAR_W + KINDS.rival.w) / 2 + 0.05); s.chain = Math.max(0, s.chain - 1);
        s.ev.push({ k: 'slammed', id: r.id, side: r.slamDir });
      } else {
        // a bump: whoever is behind slows, the other is pushed on
        if (rl > 0) { s.v = Math.max(15, s.v - 10); r.v += 4; s.z = r.z - (CAR_L + KINDS.rival.l) / 2 - 0.1; }
        else { r.v = Math.max(15, r.v - 10); r.z = s.z - (CAR_L + KINDS.rival.l) / 2 - 0.1; }
        s.vx = -s.vx * 0.4;
        s.ev.push({ k: 'bump' });
      }
    }
    if (!r.passed && rel0 > 0 && rl <= 0 && live) { r.passed = true; s.overtakes++; const p = pts(s, 400); trick(s); s.ev.push({ k: 'overtake', id: r.id, pts: p }); }
    if (r.passed && rl > 8) r.passed = false;   // (it got by again: pass it again)
    r.rel = rl;
    if (rl < -400) s.rivals.splice(i, 1);
  }
  // the clock, the checkpoints and the stages
  if (!s.startT && !ending) s.time--;
  if (s.z >= s.nextCp) {
    // our place: 1 + the rivals of this stage still ahead (a taken-down or wrecked one is out of it)
    const place = 1 + s.rivals.filter(r => r.st === s.stage && r.z > s.z).length;
    s.checkpoints++; s.nextCp += STAGE_LEN; s.stage = s.checkpoints;
    const add = timeBonus(s.stage) + (place === 1 ? 4 : place === 2 ? 2 : 0); if (!ending) s.time += add * 60;
    const p = pts(s, (500 + (place === 1 ? 1000 : place === 2 ? 400 : 0)) * s.stage);
    if (place === 1) s.wins = (s.wins || 0) + 1;
    s.ev.push({ k: 'checkpoint', add, stage: s.stage, pts: p, place });
    s.rivals = s.rivals.filter(r => r.z > s.z - 50);
    spawnRivals(s);
  }
  if (ending && s.v < 1.5 && !s.crashT) { s.over = true; s.ev.push({ k: 'over' }); }
}
function crash(s, kind) {
  s.crashT = 100; s.chain = 0; s.chainT = 0; s.boosting = false;
  s.ev.push({ k: 'crash', x: s.x, v: s.v, kind });
}
function respawn(s) {
  // back on the road in the clearer of our two lanes, gently, through traffic for a moment
  const clear = l => Math.min(...s.traffic.filter(t => t.lane === l).map(t => Math.abs(t.z - s.z)), 999);
  const lane = clear(2) >= clear(3) ? 2 : 3;
  s.x = LANES[lane]; s.vx = 0; s.v = 30; s.ghost = 100;
  s.ev.push({ k: 'respawn' });
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ km: Math.round(s.z / 100) / 10, stage: s.stage + 1, nearMisses: s.near, closeCalls: s.close, takedowns: s.takedowns, stageWins: s.wins || 0, bestMult: s.bestMult });
/** Our place in the stage's race now: 1 + its rivals ahead. */
export const placeOf = s => 1 + s.rivals.filter(r => r.st === s.stage && r.z > s.z).length;
