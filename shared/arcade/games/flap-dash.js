// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Flap Dash (docs/features/arcade.md): our own one-button flyer. Pip, a little bird-bot, flaps through the gaps between
// crystal pylons; touch one, or the ground, and it's over. The gaps narrow and the pylons speed up as you go, from 15
// some of them sway up and down, and star orbs in the gaps are worth extra. It waits, hovering, until the first flap.
// Controls: A (or ▲, or a tap anywhere on the screen) flaps. The sim (rules only; the screen is
// client/arcade/games/flap-dash.js): deterministic, see shared/arcade/core.js.
import { BTN, baseState, roll, SIN, FX } from '../core.js';

export const W = 360, H = 480, GROUND = 436, BIRD_X = 96, BIRD_R = 11, PYLON_W = 54;
const GRAVITY = 0.42, FLAP = -7.1, VMAX = 9.5, SPACING = 196;

export const gapOf = s => Math.max(116, 152 - Math.floor(s.passed / 5) * 4);
export const speedOf = s => Math.min(3.3, 2.2 + Math.floor(s.passed / 10) * 0.12);
function pylon(s, x) {
  const gap = gapOf(s), lo = 70 + gap / 2, hi = GROUND - 40 - gap / 2;
  const sway = s.passed >= 15 && roll(s, 100) < Math.min(55, 20 + s.passed);
  return { id: s.nextId++, x, cy: lo + roll(s, Math.max(1, Math.floor(hi - lo))), gap, sway: sway ? 30 + roll(s, 40) : 0, ph: roll(s, 1024), passed: false,
    orb: roll(s, 100) < 30 ? { taken: false } : null };
}
/** The middle of pylon p's gap now (a swaying one moves on the core's sine table). */
export const gapY = (s, p) => (p.sway ? p.cy + (SIN[(p.ph + s.t * 6) & 1023] * p.sway) / FX : p.cy);
export function init(seed) {
  const s = { ...baseState(seed), y: H * 0.42, vy: 0, started: false, over: false, passed: 0, orbs: 0, score: 0, pylons: [], nextId: 1, prev: 0, dist: 0 };
  return s;
}
export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const pressed = inp.b & ~s.prev;
  s.prev = inp.b;
  const flap = pressed & (BTN.A | BTN.U);
  if (!s.started) {
    if (!flap) return;   // hovering until the first flap
    s.started = true;
    for (let k = 0; k < 3; k++) s.pylons.push(pylon(s, W + 120 + k * SPACING));
  }
  if (flap) { s.vy = FLAP; s.ev.push({ k: 'flap' }); }
  s.vy = Math.min(VMAX, s.vy + GRAVITY);
  s.y += s.vy;
  if (s.y < BIRD_R) { s.y = BIRD_R; s.vy = 0; }
  const v = speedOf(s);
  s.dist += v;
  for (const p of s.pylons) p.x -= v;
  if (s.pylons.length && s.pylons[0].x < -PYLON_W) { s.pylons.shift(); s.pylons.push(pylon(s, s.pylons[s.pylons.length - 1].x + SPACING)); }
  for (const p of s.pylons) {
    const g = gapY(s, p), top = g - p.gap / 2, bot = g + p.gap / 2;
    // the orb in the middle of the gap
    if (p.orb && !p.orb.taken && Math.abs(p.x + PYLON_W / 2 - BIRD_X) < BIRD_R + 9 && Math.abs(g - s.y) < BIRD_R + 9) { p.orb.taken = true; s.orbs++; s.score += 3; s.ev.push({ k: 'orb', x: BIRD_X, y: s.y }); }
    // through it
    if (!p.passed && p.x + PYLON_W < BIRD_X - BIRD_R) { p.passed = true; s.passed++; s.score++; s.ev.push({ k: 'pass', n: s.passed }); }
    // into it: the circle against the two pylons (rounded off a little at the corners)
    if (BIRD_X + BIRD_R - 2 > p.x && BIRD_X - BIRD_R + 2 < p.x + PYLON_W && (s.y - BIRD_R + 2 < top || s.y + BIRD_R - 2 > bot)) {
      s.over = true; s.ev.push({ k: 'hit', x: BIRD_X, y: s.y }); s.ev.push({ k: 'over' }); return;
    }
  }
  if (s.y + BIRD_R >= GROUND) { s.y = GROUND - BIRD_R; s.over = true; s.ev.push({ k: 'hit', x: BIRD_X, y: s.y, ground: true }); s.ev.push({ k: 'over' }); }
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ pylons: s.passed, orbs: s.orbs });
