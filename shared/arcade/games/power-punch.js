// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Power Punch (docs/features/arcade.md "The machines"): the Punching Machine played for real (its ball on its arm, its
// timing strip, its screen: shared/arcade/machines.js BOXER). Three punches. The ball comes down; a light runs back and
// forth along the strip over it. Hold A to wind up (the power climbs, and past the top it fades, to about half: don't hold too long),
// let go to punch: the strength (0 … 999) is the power times how near the middle of the strip the light was. The ball
// is knocked back, the screen counts it up and calls it (lightweight … champion). A full wind-up right in the middle is a
// PERFECT: 100 more. The score is the three together.
// Controls: hold A (a finger or the mouse button on the screen), let go to punch. The sim (rules only; the game in the
// world is client/js/play/machines/power-punch.js): deterministic, see shared/arcade/core.js.
import { BTN, baseState, roll, SIN, FX } from '../core.js';

export const PUNCHES = 3, WIND = 54, OVER = 45, MAXS = 999;
const DROP = 40, HIT = 54, SHOW = 72, IDLE = 12 * 60;
export const GRADES = [[250, 'LIGHTWEIGHT'], [500, 'MIDDLEWEIGHT'], [750, 'HEAVYWEIGHT'], [900, 'KNOCKOUT'], [1000, 'CHAMPION']];
/** The power of a wind-up held c steps (0 … 1): it climbs to the top, then fades to about half. */
export const powerOf = c => (c <= WIND ? c / WIND : Math.max(0.55, 1 - (0.45 * (c - WIND)) / OVER));
/** Where the light on the strip is (-1 … 1), at step t of a punch whose sweep started at ph (in 1024ths of a turn). */
export const lightAt = (t, ph, lv) => SIN[(ph + t * (6 + lv * 2)) & 1023] / FX;
export const gradeOf = n => GRADES.find(g => n < g[0])[1];
export function init(seed) {
  return { ...baseState(seed), punch: 0, ph: 'drop', pt: 0, charge: -1, idle: 0, sweep: 0, light: 0, last: 0, swing: 0, score: 0, best: 0, perfects: 0, lastPerfect: false, strengths: [], prev: 0, over: false };
}
export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev, released = s.prev & ~b;
  s.prev = b;
  s.pt++;
  if (s.ph === 'drop') {   // the ball comes down into place
    if (s.pt >= DROP) { s.ph = 'aim'; s.pt = 0; s.sweep = roll(s, 1024); s.idle = 0; s.ev.push({ k: 'ready', n: s.punch + 1 }); }
    return;
  }
  if (s.ph === 'aim') {
    s.light = lightAt(s.pt, s.sweep, s.punch);
    if (pressed & BTN.A) { s.charge = 0; s.ev.push({ k: 'wind' }); }
    else if (s.charge >= 0 && b & BTN.A) { s.charge++; if (s.charge === WIND) s.ev.push({ k: 'full' }); }
    const go = s.charge >= 0 && released & BTN.A, lazy = s.charge < 0 && ++s.idle > IDLE;
    if (go || lazy) {
      const power = lazy ? 0.3 : powerOf(s.charge), acc = 1 - Math.abs(s.light);
      const a3 = acc * Math.sqrt(acc);   // (the middle matters: near it pays more than near the ends)
      let n = Math.round(MAXS * power * Math.sqrt(power) * (0.35 + 0.65 * a3)) + roll(s, 9) - 4;
      n = Math.max(0, Math.min(MAXS, n));
      const perfect = power >= 0.92 && acc >= 0.9;
      s.last = n; s.strengths.push(n); s.score += n + (perfect ? 100 : 0); s.best = Math.max(s.best, n);
      if (perfect) s.perfects++;
      s.ph = 'hit'; s.pt = 0; s.charge = -1; s.swing = n / MAXS; s.lastPerfect = perfect;
      s.ev.push({ k: 'punch', n, power, acc, perfect });
    }
    return;
  }
  if (s.ph === 'hit') {   // the ball knocked back, swinging
    if (s.pt === 6) s.ev.push({ k: 'grade', n: s.last, grade: gradeOf(s.last), perfect: s.lastPerfect });
    if (s.pt >= HIT) { s.ph = 'show'; s.pt = 0; }
    return;
  }
  if (s.ph === 'show') {
    if (s.pt >= SHOW) {
      s.punch++;
      if (s.punch >= PUNCHES) { s.over = true; s.ev.push({ k: 'over' }); return; }
      s.ph = 'drop'; s.pt = 0;
    }
  }
}
/** How far the ball is swung back now (0 … 1): knocked back by the punch, then swinging down. */
export function swingNow(s) {
  if (s.ph !== 'hit') return 0;
  const u = s.pt / HIT;
  return s.swing * (u < 0.15 ? u / 0.15 : Math.max(0, 1 - (u - 0.15) / 0.85) * (1 + 0.25 * Math.abs(SIN[(s.pt * 40) & 1023] / FX) * (1 - u)));
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ strengths: s.strengths, best: s.best, perfects: s.perfects });
