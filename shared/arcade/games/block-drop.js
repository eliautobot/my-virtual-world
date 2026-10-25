// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Block Drop (docs/features/arcade.md): our own falling-block puzzle. Pieces of three, four and five blocks fall into an
// 11-wide well; full rows clear. Its own rules: two small pieces (a bar and a corner of three) come all game, five-block
// pieces join from level 3 (a long bar of five clears five rows at once: a Blockbuster), and clears in a row build a
// chain bonus. Controls: ◀ ▶ move (held: they repeat), ▼ drops faster, ▲ drops at once, A turns right, B turns left.
// The sim (rules only; the screen is client/arcade/games/block-drop.js): deterministic, see shared/arcade/core.js.
import { BTN, baseState, shuffle } from '../core.js';

export const COLS = 11, ROWS = 22, HIDDEN = 2;   // the top two rows are above the well's mouth
// pieces as cells [x, y] in an n × n box (y down)
const SHAPES = [
  ['I3', 3, [[0, 1], [1, 1], [2, 1]]],
  ['V3', 2, [[0, 0], [0, 1], [1, 1]]],
  ['I4', 4, [[0, 1], [1, 1], [2, 1], [3, 1]]],
  ['O4', 2, [[0, 0], [1, 0], [0, 1], [1, 1]]],
  ['T4', 3, [[1, 0], [0, 1], [1, 1], [2, 1]]],
  ['L4', 3, [[2, 0], [0, 1], [1, 1], [2, 1]]],
  ['J4', 3, [[0, 0], [0, 1], [1, 1], [2, 1]]],
  ['S4', 3, [[1, 0], [2, 0], [0, 1], [1, 1]]],
  ['Z4', 3, [[0, 0], [1, 0], [1, 1], [2, 1]]],
  ['I5', 5, [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]]],
  ['P5', 3, [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]]],
  ['Q5', 3, [[0, 0], [1, 0], [0, 1], [1, 1], [1, 2]]],
  ['L5', 4, [[3, 0], [0, 1], [1, 1], [2, 1], [3, 1]]],
  ['J5', 4, [[0, 0], [0, 1], [1, 1], [2, 1], [3, 1]]],
];
export const PIECES = SHAPES.map(([name, n, cells], k) => {
  const rots = [cells];
  for (let r = 1; r < 4; r++) rots.push(rots[r - 1].map(([x, y]) => [n - 1 - y, x]));
  return { k, name, n, rots, size: cells.length };
});
const ID = Object.fromEntries(PIECES.map(p => [p.name, p.k]));
const POOL_1 = ['I3', 'V3', 'I4', 'O4', 'T4', 'L4', 'J4', 'S4', 'Z4'].map(n => ID[n]);
const POOL_3 = ['P5', 'Q5', 'I5'].map(n => ID[n]);
const POOL_6 = ['L5', 'J5'].map(n => ID[n]);
const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [0, 1]];
// steps a row falls, by level (2026-10-22, the product owner: "the original tetris was a bit faster": the classic arcade
// curve, a touch quicker to start, and a level every LINES_PER_LEVEL rows)
const GRAVITY = [43, 38, 33, 28, 23, 18, 13, 10, 8, 6, 5, 5, 4, 4, 3, 3, 3, 2, 2, 2];
export const LINES_PER_LEVEL = 8;
const LINE_PTS = [0, 100, 300, 600, 1000, 1600];
const DAS = 10, ARR = 2, LOCK = 30, LOCK_MOVES = 15, CLEAR_T = 20, SOFT = 2;

export const gravityAt = level => (level <= GRAVITY.length ? GRAVITY[level - 1] : 1);
const at = (s, x, y) => (x < 0 || x >= COLS || y >= ROWS ? 9 : y < 0 ? 0 : s.grid[y * COLS + x]);
/** Whether piece k in turn r fits with its box at (x, y). */
export function fits(s, k, r, x, y) {
  for (const [cx, cy] of PIECES[k].rots[r]) if (at(s, x + cx, y + cy)) return false;
  return true;
}
/** How far down the piece in hand would land (its box's y). */
export function dropY(s) {
  const c = s.cur; if (!c) return 0;
  let y = c.y;
  while (fits(s, c.k, c.r, c.x, y + 1)) y++;
  return y;
}
function refill(s) {
  const pool = [...POOL_1, ...(s.level >= 3 ? POOL_3 : []), ...(s.level >= 6 ? POOL_6 : [])];
  s.bag.push(...shuffle(s, pool));
}
function take(s) { if (!s.bag.length) refill(s); return s.bag.shift(); }
function spawn(s) {
  const k = s.next.shift();
  s.next.push(take(s));
  const p = PIECES[k], x = Math.floor((COLS - p.n) / 2);
  s.cur = { k, r: 0, x, y: 0 };
  s.grav = 0; s.lock = 0; s.lockMoves = 0;
  if (!fits(s, k, 0, x, 0)) { s.over = true; s.cur = null; s.ev.push({ k: 'over' }); }
  else s.ev.push({ k: 'spawn' });
}

export function init(seed) {
  const s = { ...baseState(seed), grid: new Array(COLS * ROWS).fill(0), cur: null, next: [], bag: [], level: 1, lines: 0, score: 0,
    chain: 0, grav: 0, lock: 0, lockMoves: 0, das: 0, dasT: 0, prev: 0, clear: null, over: false, pieces: 0, best5: 0 };
  s.next.push(take(s), take(s));
  spawn(s);
  return s;
}
function landed(s) { const c = s.cur; return !fits(s, c.k, c.r, c.x, c.y + 1); }
function moved(s) { if (landed(s) && s.lockMoves < LOCK_MOVES) { s.lock = 0; s.lockMoves++; } }
function shift(s, dx) {
  const c = s.cur;
  if (!fits(s, c.k, c.r, c.x + dx, c.y)) { s.ev.push({ k: 'bump' }); return false; }
  c.x += dx; moved(s); s.ev.push({ k: 'move' });
  return true;
}
function turn(s, d) {
  const c = s.cur, p = PIECES[c.k], r = (c.r + d + 4) & 3;
  if (p.name === 'O4') return;
  for (const [kx, ky] of KICKS) {
    if (fits(s, c.k, r, c.x + kx, c.y + ky)) { c.r = r; c.x += kx; c.y += ky; moved(s); s.ev.push({ k: 'turn' }); return; }
  }
  s.ev.push({ k: 'bump' });
}
function lockPiece(s, hard = false) {
  const c = s.cur, p = PIECES[c.k];
  let top = ROWS;
  for (const [cx, cy] of p.rots[c.r]) { const y = c.y + cy; s.grid[y * COLS + c.x + cx] = c.k + 1; top = Math.min(top, y); }
  s.pieces++;
  s.ev.push({ k: 'lock', hard, x: c.x, y: c.y, piece: c.k, r: c.r });
  s.cur = null;
  const rows = [];
  for (let y = 0; y < ROWS; y++) { let full = true; for (let x = 0; x < COLS && full; x++) full = !!s.grid[y * COLS + x]; if (full) rows.push(y); }
  if (rows.length) {
    const n = Math.min(5, rows.length), lv = s.level;
    let pts = LINE_PTS[n] * lv;
    if (s.chain > 0) pts += 50 * s.chain * lv;
    s.chain++;
    s.score += pts;
    s.lines += rows.length;
    if (n === 5) s.best5++;
    s.clear = { rows, t: CLEAR_T };
    s.ev.push({ k: 'clear', n, rows, pts, chain: s.chain });
    const nl = Math.min(25, 1 + Math.floor(s.lines / LINES_PER_LEVEL));
    if (nl > s.level) { s.level = nl; s.ev.push({ k: 'level', level: nl }); }
    return;
  }
  s.chain = 0;
  if (top < HIDDEN) { s.over = true; s.ev.push({ k: 'over' }); return; }   // locked above the mouth of the well
  spawn(s);
}
function finishClear(s) {
  const { rows } = s.clear, keep = [];
  for (let y = 0; y < ROWS; y++) if (!rows.includes(y)) keep.push(s.grid.slice(y * COLS, y * COLS + COLS));
  const g = new Array(COLS * ROWS).fill(0);
  const off = ROWS - keep.length;
  keep.forEach((row, k) => { for (let x = 0; x < COLS; x++) g[(off + k) * COLS + x] = row[x]; });
  s.grid = g; s.clear = null;
  if (g.every(v => !v)) { s.score += 2000 * s.level; s.ev.push({ k: 'perfect' }); }
  spawn(s);
}

export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev;
  s.prev = b;
  if (s.clear) { if (--s.clear.t <= 0) finishClear(s); return; }
  if (!s.cur) return;
  if (pressed & BTN.A) turn(s, 1);
  if (pressed & BTN.B) turn(s, -1);
  if (pressed & BTN.U) {
    const y = dropY(s), n = y - s.cur.y;
    s.cur.y = y; s.score += 2 * n;
    s.ev.push({ k: 'hard', n });
    lockPiece(s, true);
    return;
  }
  const dir = (b & BTN.L) && !(b & BTN.R) ? -1 : (b & BTN.R) && !(b & BTN.L) ? 1 : 0;
  if (dir !== s.das) { s.das = dir; s.dasT = 0; if (dir) shift(s, dir); }
  else if (dir) { s.dasT++; if (s.dasT >= DAS && (s.dasT - DAS) % ARR === 0) shift(s, dir); }
  const soft = !!(b & BTN.D), g = soft ? Math.min(SOFT, gravityAt(s.level)) : gravityAt(s.level);
  if (++s.grav >= g) {
    s.grav = 0;
    if (!landed(s)) { s.cur.y++; if (soft) s.score += 1; if (landed(s)) s.ev.push({ k: 'land' }); }
  }
  if (landed(s)) { if (++s.lock >= LOCK || (soft && s.lock >= LOCK / 2)) lockPiece(s); }
  else s.lock = 0;
}
export const over = s => s.over;
export const score = s => s.score;
/** What the run is worth beside its score (kept with the run on the server). */
export const detail = s => ({ lines: s.lines, level: s.level, pieces: s.pieces, blockbusters: s.best5 });
