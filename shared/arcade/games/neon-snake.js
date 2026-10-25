// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Neon Snake (docs/features/arcade.md): our own snake. Steer a neon snake round a walled grid, eat the orbs to grow;
// every five orbs a level: faster, and from level 3 pillars rise from the floor. Now and then a gold orb that is worth
// more the sooner it is eaten. Hitting a wall, a pillar or yourself ends the game. Controls: ▲ ▼ ◀ ▶ (a turn can be
// queued while the last is still to happen; never straight back). The sim (rules only; the screen is
// client/arcade/games/neon-snake.js): deterministic, see shared/arcade/core.js.
import { BTN, baseState, roll } from '../core.js';

export const COLS = 20, ROWS = 24;
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // up, right, down, left
const SPEED = [8, 7, 7, 6, 6, 5, 5, 4, 4, 4, 3];          // steps per cell, by level
const PER_LEVEL = 5, BONUS_EVERY = 7, BONUS_T = 420;

const key = (x, y) => y * COLS + x;
export const speedAt = level => SPEED[Math.min(level, SPEED.length) - 1];
function occupied(s) {
  const o = new Uint8Array(COLS * ROWS);
  for (const [x, y] of s.body) o[key(x, y)] = 1;
  for (const p of s.pillars) o[p] = 2;
  if (s.food) o[key(s.food.x, s.food.y)] = 3;
  if (s.bonus) o[key(s.bonus.x, s.bonus.y)] = 3;
  return o;
}
/** A free cell, at least `away` cells (Manhattan) from the head: { x, y } (null if none). */
function freeCell(s, away = 0) {
  const o = occupied(s), [hx, hy] = s.body[0], free = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!o[key(x, y)] && Math.abs(x - hx) + Math.abs(y - hy) >= away) free.push(key(x, y));
  if (!free.length) return null;
  const k = free[roll(s, free.length)];
  return { x: k % COLS, y: Math.floor(k / COLS) };
}
export function init(seed) {
  const s = { ...baseState(seed), body: [], dir: 1, queue: [], grow: 0, food: null, bonus: null, pillars: [], level: 1, eaten: 0, score: 0,
    moveT: 0, prev: 0, over: false, longest: 4, wait: 60 };   // (a second to get ready: it moves after GO!)
  const y = Math.floor(ROWS / 2);
  for (let k = 0; k < 4; k++) s.body.push([6 - k, y]);
  s.food = freeCell(s, 4);
  return s;
}
function addPillars(s, n) {
  const [hx, hy] = s.body[0], [dx, dy] = DIRS[s.dir];
  for (let k = 0; k < n && s.pillars.length < 16; k++) {
    for (let tries = 0; tries < 20; tries++) {
      const c = freeCell(s, 5); if (!c) return;
      // never straight ahead of the head
      const ahead = (dx && c.y === hy && Math.sign(c.x - hx) === dx) || (dy && c.x === hx && Math.sign(c.y - hy) === dy);
      if (ahead) continue;
      s.pillars.push(key(c.x, c.y)); s.ev.push({ k: 'pillar', x: c.x, y: c.y });
      break;
    }
  }
}
export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev;
  s.prev = b;
  for (const [bit, d] of [[BTN.U, 0], [BTN.R, 1], [BTN.D, 2], [BTN.L, 3]]) {
    if (!(pressed & bit)) continue;
    const last = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
    if (d !== last && d !== (last + 2) % 4 && s.queue.length < 2) { s.queue.push(d); s.ev.push({ k: 'turn' }); }
  }
  if (s.wait > 0) { s.wait--; return; }
  if (s.bonus && --s.bonus.t <= 0) { s.bonus = null; s.ev.push({ k: 'bonusGone' }); }
  if (++s.moveT < speedAt(s.level)) return;
  s.moveT = 0;
  if (s.queue.length) s.dir = s.queue.shift();
  const [hx, hy] = s.body[0], [dx, dy] = DIRS[s.dir], nx = hx + dx, ny = hy + dy;
  const tailMoves = s.grow === 0;
  const hitSelf = s.body.some(([x, y], i) => x === nx && y === ny && !(tailMoves && i === s.body.length - 1));
  if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || hitSelf || s.pillars.includes(key(nx, ny))) {
    s.over = true; s.ev.push({ k: 'die', x: hx, y: hy, wall: nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS }); s.ev.push({ k: 'over' });
    return;
  }
  s.body.unshift([nx, ny]);
  if (s.grow > 0) s.grow--; else s.body.pop();
  s.ev.push({ k: 'move' });
  if (s.food && s.food.x === nx && s.food.y === ny) {
    s.eaten++; s.grow += 3;
    const pts = 10 * s.level;
    s.score += pts;
    s.ev.push({ k: 'eat', x: nx, y: ny, pts });
    s.food = null;
    if (s.eaten % PER_LEVEL === 0) { s.level++; s.ev.push({ k: 'level', level: s.level }); if (s.level >= 3) addPillars(s, 2); }
    s.food = freeCell(s, 3);
    if (!s.bonus && s.eaten % BONUS_EVERY === 0) { const c = freeCell(s, 6); if (c) { s.bonus = { ...c, t: BONUS_T }; s.ev.push({ k: 'bonusIn' }); } }
  } else if (s.bonus && s.bonus.x === nx && s.bonus.y === ny) {
    const pts = (50 + Math.floor(s.bonus.t / 4)) * s.level;
    s.score += pts; s.grow += 2;
    s.ev.push({ k: 'bonus', x: nx, y: ny, pts });
    s.bonus = null;
  }
  s.longest = Math.max(s.longest, s.body.length + s.grow);
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ level: s.level, eaten: s.eaten, length: s.longest });
