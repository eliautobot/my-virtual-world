// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Neon Steps in the world (the rules: shared/arcade/games/neon-steps.js; the frame: ../machine-play.js): on the Dance
// Machine's own screen. Four lanes (◀ ▼ ▲ ▶), the targets at the top lighting as you step, the arrows rising to them (on
// the beat pink, between the beats cyan, jumps yellow), the judgement and the combo, the life bar and the score, a
// count-in; the beat itself played as it goes (a drum machine, a bass line and a chord on each bar: the song's own
// sounds, synthesised). You stand on the left pad, looking at the screen.
import { DANCE } from '/shared/arcade/machines.js';
import * as sim from '/shared/arcade/games/neon-steps.js';

const { BEAT, INTRO, END } = sim;
const SPD = 4.2, COLS = ['#f472b6', '#22d3ee', '#4ade80', '#facc15'];
const ROOTS = [110, 87.31, 130.81, 98];   // (A, F, C, G: a bar each, round and round)
const JUDGE = { perfect: ['PERFECT', '#fde047'], great: ['GREAT', '#4ade80'], good: ['GOOD', '#22d3ee'], miss: ['MISS', '#f87171'] };

/** An arrow pointing dir (0 ◀, 1 ▼, 2 ▲, 3 ▶) centred at (x, y), size r. */
function arrow(ctx, x, y, r, dir, fill, stroke) {
  const rot = [-Math.PI / 2, Math.PI, 0, Math.PI / 2][dir];   // (the canvas turns clockwise: the arrow drawn pointing up, turned to its way)
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(r * 0.45, 0); ctx.lineTo(r * 0.45, r); ctx.lineTo(-r * 0.45, r); ctx.lineTo(-r * 0.45, 0); ctx.lineTo(-r, 0); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke(); }
  ctx.restore();
}

export function create() {
  const lit = [0, 0, 0, 0], pop = [0, 0, 0, 0];
  let judge = null, judgeT = 0, combo = 0, T = 0;
  return {
    camera: { pos: [-0.2, 1.6, 1.22], at: [0, 1.48, -0.12], fov: 52, fit: 1.5 },
    board: { w: 512, h: 336, ...DANCE.screen },
    reset() { judge = null; combo = 0; },
    pointer() { return null; },
    event(ev) {
      if (ev.k === 'step') lit[ev.c] = 1;
      else if (ev.k === 'judge') { judge = ev.kind; judgeT = 0.6; combo = ev.combo; pop[ev.c] = 1; }
      else if (ev.k === 'miss') { judge = 'miss'; judgeT = 0.6; combo = 0; }
    },
    sfx(ev) {
      if (ev.k === 'tick') {
        // the beat: kick on the beats, snare on two and four, hats between, the bass on the bar's root, a chord on its first
        const h = ev.h, beat = h % 2 === 0, bar = Math.floor(h / 8), root = ROOTS[bar % 4], intro = h < INTRO * 2;
        const out = [];
        if (beat) out.push(['kick']); else out.push(['hat']);
        if (!intro) { if (h % 4 === 2) out.push(['snare']); if (beat) out.push(['bass', h % 8 === 6 ? root * 1.5 : root]); else if (h % 8 === 3) out.push(['bass', root * 2]); if (h % 8 === 0) out.push(['stab', root * 2]); }
        return out;
      }
      if (ev.k === 'clear') return ev.full ? ['fanfare'] : ['bonus'];
      if (ev.k === 'fail') return ['over'];
      return null;
    },
    buzz(ev) { return ev.k === 'judge' && ev.kind === 'perfect' ? 10 : ev.k === 'miss' ? 30 : 0; },
    update(s, dt) {
      T += dt; judgeT = Math.max(0, judgeT - dt);
      for (let c = 0; c < 4; c++) { lit[c] = Math.max(0, lit[c] - dt * 6); pop[c] = Math.max(0, pop[c] - dt * 4); }
    },
    /** The screen: drawn every frame on the machine's own display. */
    paint(ctx, w, h, s) {
      ctx.fillStyle = '#0b0614'; ctx.fillRect(0, 0, w, h);
      if (!s) return;
      const now = s.t, lw = 64, x0 = w / 2 - 2 * lw, top = 44;
      // the beat on the floor of the screen
      const ph = (now % BEAT) / BEAT, pulse = Math.max(0, 1 - ph * 3);
      ctx.fillStyle = `rgba(124, 58, 237, ${0.12 + 0.18 * pulse})`; ctx.fillRect(x0 - 8, 0, lw * 4 + 16, h);
      for (let c = 1; c < 4; c++) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x0 + c * lw - 1, 0, 2, h); }
      // the targets
      for (let c = 0; c < 4; c++) {
        const x = x0 + c * lw + lw / 2, k = Math.max(lit[c], pop[c]);
        arrow(ctx, x, top, 22 + 5 * pop[c], c, k ? `rgba(255,255,255,${0.25 + 0.6 * k})` : 'rgba(255,255,255,0.08)', '#cbd5e1');
      }
      // the arrows coming up (those still to judge, and the misses fading past)
      for (let i = s.next; i < s.notes.length; i++) {
        const n = s.notes[i], y = top + (n.t - now) * SPD;
        if (y > h + 30) break;
        if (n.j && n.j !== 4) continue;
        const jump = (i > 0 && s.notes[i - 1].t === n.t) || (i + 1 < s.notes.length && s.notes[i + 1].t === n.t);
        const on = n.t % BEAT === 0;
        arrow(ctx, x0 + n.c * lw + lw / 2, y, 22, n.c, n.j === 4 ? 'rgba(148,163,184,0.4)' : jump ? '#fde047' : on ? COLS[0] : COLS[1], '#ffffff');
      }
      // the count-in
      if (now < INTRO * BEAT) { const k = INTRO - Math.floor(now / BEAT); ctx.fillStyle = '#ffffff'; ctx.font = 'bold 96px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(k), w / 2, h / 2 + 40); }
      // the judgement and the combo
      if (judge && judgeT > 0) {
        const [t, c] = JUDGE[judge]; ctx.globalAlpha = Math.min(1, judgeT * 3);
        ctx.fillStyle = c; ctx.font = `bold ${38 + Math.round(judgeT * 10)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(t, w / 2, h * 0.58);
        if (combo >= 4) { ctx.fillStyle = '#ffffff'; ctx.font = 'bold 28px system-ui, sans-serif'; ctx.fillText(`${combo} COMBO`, w / 2, h * 0.58 + 36); }
        ctx.globalAlpha = 1;
      }
      // the life bar (left) and the score (right)
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(14, 16, 18, h - 32);
      const lf = s.life / 100; ctx.fillStyle = lf > 0.5 ? '#4ade80' : lf > 0.25 ? '#facc15' : '#f87171'; ctx.fillRect(14, 16 + (h - 32) * (1 - lf), 18, (h - 32) * lf);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 26px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(s.score.toLocaleString('en-US'), w - 14, 34);
      ctx.fillStyle = '#a5b4fc'; ctx.font = '16px system-ui, sans-serif'; ctx.fillText(`${Math.max(0, Math.ceil((END - now) / 60))}s`, w - 14, 56);
      if (s.over) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = s.failed ? '#f87171' : '#fde047'; ctx.font = 'bold 54px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(s.failed ? 'FAILED' : s.full ? 'FULL COMBO!' : 'CLEARED!', w / 2, h / 2 + 18); }
    },
    hud(s) {
      return {
        info: `Combo ${s.combo} · best ${s.best}`,
        hint: s.t < INTRO * BEAT + 240 ? 'Step on the arrows as they reach the top: ◀ ▼ ▲ ▶ (or tap that side of the screen)' : '',
      };
    },
    dispose() {},
  };
}
