// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Neon Steps (docs/features/arcade.md "The machines"): the Dance Machine played for real (its pad and its screen:
// shared/arcade/machines.js DANCE). A song at 120 beats a minute, a four-beat count-in, then thirty-two bars whose steps
// the dice write from the seed, busier every eight bars (eighth notes, then jumps: two arrows at once). Arrows rise up
// the screen to the targets at the top; step on the arrow as it reaches its target: PERFECT (within 2/60 s) 100, GREAT
// (5/60) 70, GOOD (8/60) 30, each times the combo (up to ×2 at fifty in a row); one let past is a MISS. The life bar
// fills with good steps and drains with misses: empty, the song stops there. To the end without a miss (a FULL COMBO)
// 2000 more; what is left of the life, ten a point.
// Controls: ◀ ▼ ▲ ▶ (the arrow keys, a controller's cross, the pad's own panels under the player); on a screen, a tap
// toward a side (left, right, up, down from its middle). The sim (rules only; the game in the world is
// client/js/play/machines/neon-steps.js): deterministic, see shared/arcade/core.js; time in steps (1/60 s).
import { BTN, baseState, roll } from '../core.js';

export const BEAT = 30, INTRO = 4, BARS = 32, OUTRO = 4, LANES = 4;
export const WIN = { perfect: 2, great: 5, good: 8 }, PTS = { perfect: 100, great: 70, good: 30 };
const KEYS = [BTN.L, BTN.D, BTN.U, BTN.R];   // ← ↓ ↑ → (the pad's order)
export const END = (INTRO + BARS * 4 + OUTRO) * BEAT;
const JUMPS = [[0, 3], [1, 2], [0, 2], [1, 3], [0, 1], [2, 3]];

export function init(seed) {
  const s = { ...baseState(seed), notes: [], next: 0, prev: 0, combo: 0, best: 0, life: 60, score: 0, judged: { perfect: 0, great: 0, good: 0, miss: 0 }, over: false, failed: false, full: false };
  // the steps: by bar, on the beats and (later) between them, never three times running on one arrow
  let last = -1, run = 0;
  const pick = () => { let c = roll(s, 4); if (c === last && run >= 1) c = (c + 1 + roll(s, 3)) % 4; run = c === last ? run + 1 : 0; last = c; return c; };
  for (let b = 0; b < BARS; b++) {
    const sec = b >> 3, onP = [75, 85, 90, 95][sec], offP = [0, 25, 45, 60][sec], jumpP = [0, 4, 12, 18][sec];
    for (let h = 0; h < 8; h++) {
      const t = (INTRO * 2 + b * 8 + h) * (BEAT / 2), on = h % 2 === 0;
      if (b === BARS - 1 && h > 4) continue;   // (a breath before the last beat)
      if (roll(s, 100) >= (on ? onP : offP)) continue;
      if (on && roll(s, 100) < jumpP) { const [a, c] = JUMPS[roll(s, JUMPS.length)]; s.notes.push({ t, c: a, j: 0 }, { t, c, j: 0 }); last = -1; run = 0; }
      else s.notes.push({ t, c: pick(), j: 0 });
    }
  }
  // the finish: a jump on the last bar's last beat
  s.notes.push({ t: (INTRO * 2 + (BARS - 1) * 8 + 6) * (BEAT / 2), c: 0, j: 0 }, { t: (INTRO * 2 + (BARS - 1) * 8 + 6) * (BEAT / 2), c: 3, j: 0 });
  s.total = s.notes.length;
  return s;
}

function hit(s, n, kind) {
  n.j = kind === 'perfect' ? 1 : kind === 'great' ? 2 : 3;
  const mult = 1 + Math.min(s.combo, 50) / 50;
  s.combo++; s.best = Math.max(s.best, s.combo); s.judged[kind]++;
  s.score += Math.round(PTS[kind] * mult);
  s.life = Math.min(100, s.life + (kind === 'perfect' ? 2 : kind === 'great' ? 1 : 0));
  s.ev.push({ k: 'judge', c: n.c, kind, combo: s.combo });
}
function finish(s, failed) {
  s.over = true; s.failed = failed;
  if (!failed) { s.full = s.judged.miss === 0; if (s.full) s.score += 2000; s.score += s.life * 10; }
  s.ev.push({ k: failed ? 'fail' : 'clear', full: s.full, life: s.life });
  s.ev.push({ k: 'over' });
}

export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const now = s.t, b = inp.b, pressed = b & ~s.prev;
  s.prev = b;
  if (now % (BEAT / 2) === 0 && now < END) s.ev.push({ k: 'tick', h: now / (BEAT / 2) });
  // each arrow stepped on: the nearest of its notes still to judge, if it is near enough
  for (let c = 0; c < LANES; c++) {
    if (!(pressed & KEYS[c])) continue;
    s.ev.push({ k: 'step', c });
    let best = null, bd = WIN.good + 1;
    for (let i = s.next; i < s.notes.length; i++) {
      const n = s.notes[i]; if (n.t > now + WIN.good) break;
      if (n.j || n.c !== c) continue;
      const d = Math.abs(n.t - now); if (d < bd) { bd = d; best = n; }
    }
    if (best) hit(s, best, bd <= WIN.perfect ? 'perfect' : bd <= WIN.great ? 'great' : 'good');
  }
  // the ones gone past: missed
  while (s.next < s.notes.length && s.notes[s.next].t < now - WIN.good) {
    const n = s.notes[s.next++];
    if (n.j) continue;
    n.j = 4; s.combo = 0; s.judged.miss++; s.life -= 6;
    s.ev.push({ k: 'miss', c: n.c });
    if (s.life <= 0) { s.life = 0; finish(s, true); return; }
  }
  if (now >= END) finish(s, false);
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ ...s.judged, best: s.best, full: s.full, failed: s.failed, notes: s.total });
