// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Rock Drift (docs/features/arcade.md): our own space-rocks shooter. A little ship drifts in a field that wraps round
// its edges; big rocks break into two smaller ones, the smallest into dust. From wave 2 a raider saucer crosses and
// shoots (from wave 4 it aims). Controls: ◀ ▶ turn, ▲ thrust, A fire (hold), B warp to a random place. The ship keeps
// drifting: space has no brakes, only a little dust that slows it. The sim (rules only; the screen is
// client/arcade/games/rock-drift.js): deterministic, see shared/arcade/core.js (angles from its table; + − × ÷ and
// sqrt only).
import { BTN, baseState, roll, SIN, COS, FX } from '../core.js';

export const W = 360, H = 480;
export const ROCK_R = [0, 8, 15, 27];          // by size
const ROCK_PTS = [0, 100, 50, 20], SAUCER_PTS = [0, 1000, 200];
const TURN = 15, THRUST = 0.11, DRAG = 0.992, VMAX = 5.2, SHOT_V = 7, SHOT_LIFE = 46, SHOT_GAP = 8, SHOTS = 4, SHIP_R = 8;
const wrapX = x => (x < 0 ? x + W : x >= W ? x - W : x), wrapY = y => (y < 0 ? y + H : y >= H ? y - H : y);
/** The shortest way from (ax, ay) to (bx, by) on the wrapping field. */
export function delta(ax, ay, bx, by) {
  let dx = bx - ax, dy = by - ay;
  if (dx > W / 2) dx -= W; else if (dx < -W / 2) dx += W;
  if (dy > H / 2) dy -= H; else if (dy < -H / 2) dy += H;
  return [dx, dy];
}
const near = (ax, ay, bx, by, r) => { const [dx, dy] = delta(ax, ay, bx, by); return dx * dx + dy * dy < r * r; };

function rock(s, x, y, size, speedK = 1) {
  const a = roll(s, 1024), v = (0.45 + roll(s, 100) / 100) * (1 + (s.wave - 1) * 0.06) * speedK * (size === 1 ? 1.5 : size === 2 ? 1.2 : 1);
  return { id: s.nextId++, x, y, size, vx: (SIN[a] * v) / FX, vy: (COS[a] * v) / FX, spin: roll(s, 2) ? 1 : -1 };
}
function newWave(s) {
  const n = Math.min(11, 3 + s.wave);
  for (let k = 0; k < n; k++) {
    let x, y, tries = 0;
    do { x = roll(s, W); y = roll(s, H); } while (near(x, y, s.x, s.y, 130) && ++tries < 30);
    s.rocks.push(rock(s, x, y, 3));
  }
  s.nextSaucer = s.t + 900 + roll(s, 600);
}
export function init(seed) {
  const s = { ...baseState(seed), x: W / 2, y: H / 2, vx: 0, vy: 0, ang: 0, lives: 3, score: 0, wave: 1, extraAt: 10000,
    shots: [], gap: 0, rocks: [], saucer: null, sShots: [], dead: 0, inv: 120, warp: 0, nextId: 1, prev: 0, over: false, thrust: false,
    waveT: 0, kills: 0 };
  newWave(s);
  return s;
}
function addScore(s, n) { s.score += n; while (s.score >= s.extraAt) { if (s.lives < 6) { s.lives++; s.ev.push({ k: 'life' }); } s.extraAt += 10000; } }
function breakRock(s, i, by) {
  const r = s.rocks[i];
  s.rocks.splice(i, 1); s.kills++;
  if (by === 'ship' || by === 'shot') addScore(s, ROCK_PTS[r.size]);
  s.ev.push({ k: 'rock', x: r.x, y: r.y, size: r.size });
  if (r.size > 1) for (let k = 0; k < 2; k++) s.rocks.push(rock(s, r.x, r.y, r.size - 1, 1.15));
}
function die(s) {
  s.lives--; s.dead = 100; s.shots = []; s.thrust = false;
  s.ev.push({ k: 'die', x: s.x, y: s.y });
}
export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev;
  s.prev = b;
  // the ship
  if (s.dead) {
    if (--s.dead <= 0) {
      if (s.lives <= 0) { s.over = true; s.ev.push({ k: 'over' }); return; }
      // back in the middle once nothing is close to it
      if (s.rocks.some(r => near(r.x, r.y, W / 2, H / 2, ROCK_R[r.size] + 50)) || s.saucer) s.dead = 1;
      else { s.x = W / 2; s.y = H / 2; s.vx = s.vy = 0; s.ang = 0; s.inv = 120; s.ev.push({ k: 'respawn' }); }
    }
  } else {
    if (s.inv) s.inv--;
    if (s.gap) s.gap--;
    if (s.warp) s.warp--;
    if (b & BTN.L) s.ang = (s.ang - TURN + 1024) & 1023;
    if (b & BTN.R) s.ang = (s.ang + TURN) & 1023;
    s.thrust = !!(b & BTN.U);
    if (s.thrust) { s.vx += (SIN[s.ang] * THRUST) / FX; s.vy -= (COS[s.ang] * THRUST) / FX; }
    s.vx *= DRAG; s.vy *= DRAG;
    const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    if (v > VMAX) { s.vx = (s.vx / v) * VMAX; s.vy = (s.vy / v) * VMAX; }
    s.x = wrapX(s.x + s.vx); s.y = wrapY(s.y + s.vy);
    if ((b & BTN.A) && !s.gap && s.shots.length < SHOTS) {
      const nx = SIN[s.ang] / FX, ny = -COS[s.ang] / FX;
      s.shots.push({ x: wrapX(s.x + nx * 11), y: wrapY(s.y + ny * 11), vx: s.vx + nx * SHOT_V, vy: s.vy + ny * SHOT_V, life: SHOT_LIFE });
      s.gap = SHOT_GAP; s.ev.push({ k: 'fire' });
    }
    if ((pressed & BTN.B) && !s.warp) {
      s.ev.push({ k: 'warpOut', x: s.x, y: s.y });
      s.x = 20 + roll(s, W - 40); s.y = 40 + roll(s, H - 80); s.vx = s.vy = 0; s.warp = 90; s.inv = Math.max(s.inv, 20);
      s.ev.push({ k: 'warpIn', x: s.x, y: s.y });
    }
  }
  // shots
  for (let i = s.shots.length - 1; i >= 0; i--) {
    const sh = s.shots[i];
    sh.x = wrapX(sh.x + sh.vx); sh.y = wrapY(sh.y + sh.vy);
    let gone = --sh.life <= 0;
    for (let j = 0; j < s.rocks.length && !gone; j++) { const r = s.rocks[j]; if (near(sh.x, sh.y, r.x, r.y, ROCK_R[r.size] + 1)) { breakRock(s, j, 'shot'); gone = true; } }
    if (!gone && s.saucer && near(sh.x, sh.y, s.saucer.x, s.saucer.y, s.saucer.r + 1)) {
      addScore(s, SAUCER_PTS[s.saucer.small ? 1 : 2]); s.ev.push({ k: 'saucer', x: s.saucer.x, y: s.saucer.y, pts: SAUCER_PTS[s.saucer.small ? 1 : 2] }); s.saucer = null; gone = true;
    }
    if (gone) s.shots.splice(i, 1);
  }
  // rocks drift; the ship hits one
  for (const r of s.rocks) { r.x = wrapX(r.x + r.vx); r.y = wrapY(r.y + r.vy); }
  if (!s.dead && !s.inv) for (let j = 0; j < s.rocks.length; j++) {
    const r = s.rocks[j];
    if (near(s.x, s.y, r.x, r.y, ROCK_R[r.size] + SHIP_R - 2)) { breakRock(s, j, 'ship'); die(s); break; }
  }
  // the raider saucer
  if (s.saucer) {
    const sc = s.saucer;
    sc.x += sc.vx; sc.y = wrapY(sc.y + sc.vy);
    if (--sc.turn <= 0) { sc.vy = [-1, 0, 1][roll(s, 3)] * 0.9; sc.turn = 60 + roll(s, 60); }
    if (--sc.fire <= 0 && !s.dead) {
      sc.fire = sc.small ? 42 : 62;
      let a;
      if (sc.small) {   // aimed, a little off
        const [dx, dy] = delta(sc.x, sc.y, s.x, s.y), m = Math.sqrt(dx * dx + dy * dy) || 1, off = (roll(s, 21) - 10) / 100;
        s.sShots.push({ x: sc.x, y: sc.y, vx: (dx / m + off) * 4, vy: (dy / m - off) * 4, life: 70 });
      } else { a = roll(s, 1024); s.sShots.push({ x: sc.x, y: sc.y, vx: (SIN[a] * 3.6) / FX, vy: (COS[a] * 3.6) / FX, life: 70 }); }
      s.ev.push({ k: 'sfire' });
    }
    if (sc.x < -20 || sc.x > W + 20) s.saucer = null;
    else if (!s.dead && !s.inv && near(s.x, s.y, sc.x, sc.y, sc.r + SHIP_R)) { s.ev.push({ k: 'saucer', x: sc.x, y: sc.y, pts: 0 }); s.saucer = null; die(s); }
  } else if (s.wave >= 2 && s.t >= s.nextSaucer && !s.dead) {
    const small = s.wave >= 4 && roll(s, 100) < 40 + s.wave * 4, left = roll(s, 2) === 0;
    s.saucer = { x: left ? -16 : W + 16, y: 60 + roll(s, H - 120), vx: (left ? 1 : -1) * (small ? 1.6 : 1.1), vy: 0, r: small ? 7 : 12, small, turn: 60, fire: 50 };
    s.nextSaucer = s.t + 1100 + roll(s, 900);
    s.ev.push({ k: 'saucerIn', small });
  }
  for (let i = s.sShots.length - 1; i >= 0; i--) {
    const sh = s.sShots[i];
    sh.x = wrapX(sh.x + sh.vx); sh.y = wrapY(sh.y + sh.vy);
    if (--sh.life <= 0) { s.sShots.splice(i, 1); continue; }
    if (!s.dead && !s.inv && near(sh.x, sh.y, s.x, s.y, SHIP_R)) { s.sShots.splice(i, 1); die(s); }
  }
  // the next wave
  if (!s.rocks.length) {
    if (!s.waveT) { s.waveT = 120; s.ev.push({ k: 'cleared', wave: s.wave }); }
    else if (--s.waveT <= 0) { s.wave++; newWave(s); s.ev.push({ k: 'wave', wave: s.wave }); }
  }
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ wave: s.wave, rocks: s.kills });
