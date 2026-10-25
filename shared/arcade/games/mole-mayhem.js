// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Mole Mayhem (docs/features/arcade.md "The machines"): the Whack-a-Mole machine played for real, at the machine (the
// moles come up out of its own five holes: shared/arcade/machines.js WHACK). Sixty seconds; moles pop up and duck back
// down, quicker as the round goes on. Whack one while it is up: 10 points and a little more the sooner you get it, times
// the combo (every five in a row adds one, up to ×5). A gold mole is worth 50; a mole with a bomb costs 25, breaks the
// combo and stuns the mallet a moment. A whack at an empty hole breaks the combo too. The last ten seconds are a frenzy:
// two at a time.
// Controls: the pointer on a hole (the game in the world tells which: px = hole × 32 + 16) and a tap or a click whacks;
// or ◀ ▶ along a row, ▲ ▼ between the rows, and A. The sim (rules only; the game in the world is
// client/js/play/machines/mole-mayhem.js): deterministic, see shared/arcade/core.js.
import { BTN, baseState, roll } from '../core.js';
import { WHACK } from '../machines.js';

export const ROUND = 60 * 60, FRENZY = 10 * 60, N = WHACK.holes.length;
const RISE = 7, FALL = 7, HIT_SHOW = 16, STUN = 36, SWING = 9;
export const NORMAL = 0, GOLD = 1, BOMB = 2;
/** The pointer's x on hole i (what the game in the world sends while the pointer is over it), and back. */
export const holePx = i => i * 32 + 16;
export const pxHole = px => { const i = px >> 5; return i < N ? i : -1; };
// a mole's phase: 0 down, 1 rising, 2 up, 3 hit (dizzy), 4 ducking
export function init(seed) {
  return {
    ...baseState(seed), left: ROUND, score: 0, combo: 0, bestCombo: 0, hits: 0, gold: 0, bombs: 0, whiffs: 0, missed: 0,
    moles: WHACK.holes.map(() => ({ ph: 0, kind: NORMAL, t: 0, up: 0 })), cur: 1, prev: 0, stun: 0, swing: 0, swingAt: -1, next: 50, over: false,
  };
}
const gapOf = s => (s.left <= FRENZY ? 16 : Math.max(20, 50 - Math.floor((ROUND - s.left) / 110)));
const upOf = (s, kind) => (kind === GOLD ? 34 : kind === BOMB ? 84 : Math.max(38, 92 - Math.floor((ROUND - s.left) / 75)));
/** How far out of its hole mole m is (0 … 1). */
export const out = m => (m.ph === 1 ? m.t / RISE : m.ph === 2 || m.ph === 3 ? 1 : m.ph === 4 ? 1 - m.t / FALL : 0);
export const mult = s => Math.min(5, 1 + Math.floor(s.combo / 5));
function spawn(s) {
  const free = [];
  s.moles.forEach((m, i) => { if (m.ph === 0 && m.t <= 0) free.push(i); });
  if (!free.length) return;
  const i = free[roll(s, free.length)], m = s.moles[i], r = roll(s, 100), late = s.left < ROUND - 8 * 60;
  m.kind = r < 6 ? GOLD : late && r < 18 ? BOMB : NORMAL;
  m.ph = 1; m.t = 0; m.up = upOf(s, m.kind);
  s.ev.push({ k: 'pop', i, kind: m.kind });
}
function whack(s, i) {
  s.swing = SWING; s.swingAt = i;
  const m = s.moles[i];
  if ((m.ph !== 1 && m.ph !== 2) || out(m) < 0.45) {
    s.whiffs++;
    if (s.combo) s.ev.push({ k: 'break', n: s.combo });
    s.combo = 0;
    s.ev.push({ k: 'whiff', i });
    return;
  }
  if (m.kind === BOMB) {
    s.bombs++; s.score = Math.max(0, s.score - 25);
    if (s.combo) s.ev.push({ k: 'break', n: s.combo });
    s.combo = 0; s.stun = STUN;
    m.ph = 3; m.t = 0;
    s.ev.push({ k: 'bomb', i, pts: -25 });
    return;
  }
  s.combo++; s.bestCombo = Math.max(s.bestCombo, s.combo); s.hits++;
  const quick = m.ph === 1 ? 5 : Math.max(0, 5 - Math.floor(m.t / 8));
  const pts = (m.kind === GOLD ? 50 : 10 + quick) * mult(s);
  if (m.kind === GOLD) s.gold++;
  s.score += pts;
  m.ph = 3; m.t = 0;
  s.ev.push({ k: 'hit', i, pts, kind: m.kind, combo: s.combo, mult: mult(s) });
  if (s.combo % 5 === 0 && s.combo <= 20) s.ev.push({ k: 'mult', m: mult(s) });
}
// ◀ ▶ along a row, ▲ ▼ to the nearest hole of the other row
const MOVE = { L: [0, 0, 1, 3, 3], R: [1, 2, 2, 4, 4], U: [3, 3, 4, 3, 4], D: [0, 1, 2, 0, 2] };
export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev;
  s.prev = b;
  if (inp.pd) { const i = pxHole(inp.px); if (i >= 0) s.cur = i; }
  if (pressed & BTN.L) s.cur = MOVE.L[s.cur];
  if (pressed & BTN.R) s.cur = MOVE.R[s.cur];
  if (pressed & BTN.U) s.cur = MOVE.U[s.cur];
  if (pressed & BTN.D) s.cur = MOVE.D[s.cur];
  if (s.swing > 0) s.swing--;
  if (s.stun > 0) s.stun--;
  else if (pressed & BTN.A) whack(s, s.cur);
  for (let i = 0; i < N; i++) {
    const m = s.moles[i];
    if (m.ph === 0) { if (m.t > 0) m.t--; continue; }
    m.t++;
    if (m.ph === 1 && m.t >= RISE) { m.ph = 2; m.t = 0; }
    else if (m.ph === 2 && m.t >= m.up) {
      m.ph = 4; m.t = 0;
      if (m.kind === NORMAL) { s.missed++; s.ev.push({ k: 'escape', i }); }
    } else if (m.ph === 3 && m.t >= HIT_SHOW) { m.ph = 4; m.t = 0; }
    else if (m.ph === 4 && m.t >= FALL) { m.ph = 0; m.t = 10; }
  }
  if (--s.next <= 0) {
    spawn(s);
    if (s.left <= FRENZY) spawn(s);
    s.next = gapOf(s) + roll(s, 12);
  }
  s.left--;
  if (s.left === FRENZY) s.ev.push({ k: 'frenzy' });
  if (s.left > 0 && s.left <= 5 * 60 && s.left % 60 === 0) s.ev.push({ k: 'count', n: s.left / 60 });
  if (s.left <= 0) { s.over = true; s.ev.push({ k: 'over' }); }
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ hits: s.hits, gold: s.gold, bombs: s.bombs, bestCombo: s.bestCombo, missed: s.missed });
