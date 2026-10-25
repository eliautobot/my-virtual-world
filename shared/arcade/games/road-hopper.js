// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Road Hopper (docs/features/arcade.md): our own crossing game. Hop the little bot across five lanes of traffic and a
// river of drifting logs and glow-rafts (the rafts sink for a moment now and then) into one of the five portals at the
// top. Fill all five for the next level, faster. Every hop further than before scores; a portal scores with the time
// left. A firefly in a portal is a bonus. Controls: ▲ ▼ ◀ ▶ hop. The sim (rules only; the screen is
// client/arcade/games/road-hopper.js): deterministic, see shared/arcade/core.js.
import { BTN, baseState, roll } from '../core.js';

export const W = 360, CELL = 32, COLS = 11, ROWS = 13, X0 = 4, Y0 = 52;
export const PORTALS = [1, 3, 5, 7, 9];                // the portals' columns in the top row
export const RIVER = [1, 2, 3, 4, 5], MEDIAN = 6, ROAD = [7, 8, 9, 10, 11], START = 12;
const HOP = 7, TIME = 60 * 60, DEAD_T = 70;
export const colX = c => X0 + c * CELL + CELL / 2;
export const rowY = r => Y0 + r * CELL + CELL / 2;
// lanes: row → [direction, speed (px a step), kind, length (px), gap (px)]
const LANES = {
  1: [-1, 0.9, 'log', 96, 80], 2: [1, 1.1, 'raft', 70, 74], 3: [-1, 1.4, 'log', 128, 90], 4: [1, 0.8, 'log', 80, 70], 5: [-1, 1.2, 'raft', 92, 70],
  7: [-1, 1.0, 'truck', 64, 120], 8: [1, 1.6, 'car', 30, 110], 9: [-1, 1.2, 'car', 30, 90], 10: [1, 2.1, 'racer', 30, 160], 11: [-1, 0.9, 'car', 30, 80],
};
const SPAN = 620, OFF = 130;   // a lane's loop: the screen and room off both sides for the longest log

function lanes(s) {
  const k = 1 + (s.level - 1) * 0.14;
  s.lanes = {};
  for (const [r, [dir, v, kind, len, gap]] of Object.entries(LANES)) {
    const n = Math.max(2, Math.floor(SPAN / (len + gap + roll(s, 30)))), step = SPAN / n, x0 = roll(s, Math.floor(step));
    const objs = [];
    for (let i = 0; i < n; i++) objs.push({ x: x0 + i * step - OFF, len, kind, dive: kind === 'raft' && i % 2 === 0 ? roll(s, 400) : -1 });
    s.lanes[r] = { dir, v: v * k, kind, objs };
  }
}
function home(s) { s.x = colX(5); s.row = START; s.far = START; s.hop = null; s.time = TIME; s.ride = 0; }
export function init(seed) {
  const s = { ...baseState(seed), level: 1, lives: 3, score: 0, extraAt: 10000, filled: [0, 0, 0, 0, 0], fly: null, flyNext: 600,
    dead: 0, prev: 0, over: false, facing: 0, homes: 0 };
  lanes(s); home(s);
  return s;
}
/** Whether a raft (or a log) holds up a hopper now: a diving raft goes under for a while every 480 steps. */
export function afloat(s, o) {
  if (o.dive < 0) return true;
  const ph = (s.t + o.dive) % 480;
  return ph < 380 || ph >= 460;   // 380–400 sinking, 400–460 under, back up
}
export const sinking = (s, o) => o.dive >= 0 && ((s.t + o.dive) % 480) >= 340 && ((s.t + o.dive) % 480) < 460;
function addScore(s, n) { s.score += n; while (s.score >= s.extraAt) { if (s.lives < 5) { s.lives++; s.ev.push({ k: 'life' }); } s.extraAt += 10000; } }
function die(s, why) {
  s.lives--; s.dead = DEAD_T; s.ev.push({ k: 'die', why, x: s.x, y: rowY(s.row) });
}
/** The object under x in lane row r (with a small margin), or null. */
function under(s, r, x) {
  const L = s.lanes[r]; if (!L) return null;
  for (const o of L.objs) if (x >= o.x + 4 && x <= o.x + o.len - 4) return o;
  return null;
}
export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev;
  s.prev = b;
  // the lanes move
  for (const L of Object.values(s.lanes)) for (const o of L.objs) { o.x += L.dir * L.v; if (o.x >= SPAN - OFF) o.x -= SPAN; else if (o.x + o.len < -OFF) o.x += SPAN; }
  // the firefly visits a free portal now and then
  if (s.fly) { if (--s.fly.t <= 0) s.fly = null; }
  else if (--s.flyNext <= 0) { const free = PORTALS.map((c, i) => i).filter(i => !s.filled[i]); if (free.length) s.fly = { i: free[roll(s, free.length)], t: 330 }; s.flyNext = 700 + roll(s, 600); }
  if (s.dead) { if (--s.dead <= 0) { if (s.lives <= 0) { s.over = true; s.ev.push({ k: 'over' }); } else home(s); } return; }
  if (s.nextT) { if (--s.nextT <= 0) { s.level++; s.filled = [0, 0, 0, 0, 0]; lanes(s); home(s); s.ev.push({ k: 'level', level: s.level }); } return; }
  if (--s.time <= 0) { die(s, 'time'); return; }
  // a hop in the air lands after HOP steps
  if (s.hop) {
    if (++s.hop.t >= HOP) {
      s.x += s.hop.dx * CELL; s.row += s.hop.dy; s.hop = null;
      s.x = Math.max(colX(0), Math.min(colX(COLS - 1), s.x));
      if (s.row < s.far) { addScore(s, 10); s.far = s.row; }
      s.ev.push({ k: 'land', row: s.row });
      if (s.row === 0) {   // the top: a free portal, or a fall
        const i = PORTALS.findIndex(c => Math.abs(colX(c) - s.x) <= 13);
        if (i < 0 || s.filled[i]) { die(s, i < 0 ? 'bank' : 'full'); return; }
        s.filled[i] = 1; s.homes++;
        const pts = 50 + Math.floor(s.time / 30) + (s.fly?.i === i ? 200 : 0);
        if (s.fly?.i === i) s.fly = null;
        addScore(s, pts); s.ev.push({ k: 'home', i, pts });
        if (s.filled.every(Boolean)) { addScore(s, 1000); s.nextT = 120; s.ev.push({ k: 'cleared', level: s.level }); return; }
        home(s); return;
      }
    } else return;
  }
  // a new hop
  for (const [bit, dx, dy, f] of [[BTN.U, 0, -1, 0], [BTN.D, 0, 1, 2], [BTN.L, -1, 0, 3], [BTN.R, 1, 0, 1]]) {
    if (!(pressed & bit)) continue;
    if (dy > 0 && s.row >= START) break;
    if (dx < 0 && s.x - CELL < colX(0) - 6) break;
    if (dx > 0 && s.x + CELL > colX(COLS - 1) + 6) break;
    s.hop = { dx, dy, t: 0 }; s.facing = f; s.ev.push({ k: 'hop' });
    return;
  }
  // the road: run over
  if (ROAD.includes(s.row)) {
    for (const o of s.lanes[s.row].objs) if (s.x + 10 > o.x && s.x - 10 < o.x + o.len) { die(s, 'road'); return; }
  }
  // the river: on something afloat, carried with it; else in the water
  if (RIVER.includes(s.row)) {
    const o = under(s, s.row, s.x);
    if (!o || !afloat(s, o)) { die(s, 'water'); return; }
    const L = s.lanes[s.row];
    s.x += L.dir * L.v;
    if (s.x < colX(0) - 12 || s.x > colX(COLS - 1) + 12) { die(s, 'edge'); return; }
  }
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ level: s.level, homes: s.homes });
