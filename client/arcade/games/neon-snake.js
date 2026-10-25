// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Neon Snake's screen (the rules: shared/arcade/games/neon-snake.js): a dark grid, the snake gliding from cell to cell
// (drawn between its steps, so it moves smoothly at any speed), its glow fading to the tail, a pulsing orb, the gold
// orb with its countdown ring, pillars rising, sparks and a shake. createView() is the game in the sealed box;
// cover() its attract screen on the cabinets.
import * as sim from '/shared/arcade/games/neon-snake.js';
import { makeScreen, canvas, text, glow, Particles, Shake, Floaters, crt, blink, fmt, rrect, LW, LH } from '../fx.js';

export { sim };
const { COLS, ROWS, DIRS, speedAt } = sim;
const C = 16, FX0 = (LW - COLS * C) / 2, FY0 = 64;
const HEAD = '#bef264', TAIL = '#15803d';
const cx = x => FX0 + x * C + C / 2, cy = y => FY0 + y * C + C / 2;
const mix = (a, b, t) => { const p = parseInt(a.slice(1), 16), q = parseInt(b.slice(1), 16), f = s => Math.round(((p >> s) & 255) * (1 - t) + ((q >> s) & 255) * t); return `rgb(${f(16)},${f(8)},${f(0)})`; };

function backdrop(S) {
  const b = canvas(LW, LH, S.k), x = b.x;
  const g = x.createLinearGradient(0, 0, 0, LH); g.addColorStop(0, '#04110a'); g.addColorStop(1, '#020806');
  x.fillStyle = g; x.fillRect(0, 0, LW, LH);
  x.fillStyle = 'rgba(2,14,8,0.9)'; x.fillRect(FX0, FY0, COLS * C, ROWS * C);
  x.fillStyle = 'rgba(134,239,172,0.12)';
  for (let r = 0; r <= ROWS; r++) for (let c = 0; c <= COLS; c++) x.fillRect(FX0 + c * C - 0.5, FY0 + r * C - 0.5, 1, 1);
  x.save(); x.shadowColor = '#22c55e'; x.shadowBlur = 12 * S.k; x.strokeStyle = '#4ade80'; x.lineWidth = 2;
  rrect(x, FX0 - 4, FY0 - 4, COLS * C + 8, ROWS * C + 8, 6); x.stroke(); x.restore();
  return b;
}

export function createView(cv) {
  const S = makeScreen(cv), P = new Particles(600), shake = new Shake(), F = new Floaters();
  let bg = null, bgKey = '', best = 0, practice = false, T = 0, banner = null, overT = -1, isPaused = false, flash = 0, rising = [], frac = 0;
  return {
    resize() { S.fit(); },
    pause(on) { isPaused = on; },
    reset(s, info) { best = info.best || 0; practice = info.practice; banner = { str: 'GO!', t: 0, life: 1, color: '#bef264' }; overT = -1; P.p.length = 0; rising = []; },
    event(ev) {
      if (ev.k === 'eat' || ev.k === 'bonus') {
        const gold = ev.k === 'bonus';
        P.burst(cx(ev.x), cy(ev.y), gold ? 30 : 16, { color: gold ? ['#fde68a', '#facc15', '#ffffff'] : ['#f0abfc', '#e879f9', '#ffffff'], speed: gold ? 170 : 120, life: 0.6 });
        F.add(`+${ev.pts}`, cx(ev.x), cy(ev.y) - 10, { color: gold ? '#fde68a' : '#f5d0fe', s: gold ? 2 : 1 });
        shake.kick(gold ? 3 : 1);
      } else if (ev.k === 'level') banner = { str: `LEVEL ${ev.level}`, t: 0, life: 1.5, color: '#fde68a' };
      else if (ev.k === 'pillar') rising.push({ x: ev.x, y: ev.y, t: 0 });
      else if (ev.k === 'die') { flash = 0.4; shake.kick(8); P.burst(cx(ev.x), cy(ev.y), 40, { color: ['#bef264', '#4ade80', '#ffffff', '#f87171'], speed: 200, life: 0.9 }); }
      else if (ev.k === 'over') overT = 0;
      else if (ev.k === 'bonusIn') F.add('GOLD!', LW / 2, FY0 + 20, { color: '#fde68a', s: 2 });
    },
    sfx(ev) { return { eat: ['eat'], bonus: ['bonus'], level: ['level'], pillar: ['pillar'], die: ['die'], over: ['over'], turn: ['tick'], bonusIn: ['coin'] }[ev.k] || null; },
    buzz(ev) { return ev.k === 'die' ? 160 : ev.k === 'bonus' ? 30 : ev.k === 'eat' ? 10 : 0; },
    draw(dt, s) {
      S.fit();
      const ctx = S.ctx; if (!isPaused) T += dt;
      const key = `${S.cv.width}x${S.cv.height}`;
      if (key !== bgKey) { bg = backdrop(S); bgKey = key; }
      S.begin();
      if (!isPaused) { shake.update(dt); P.update(dt); }
      ctx.drawImage(bg.c, 0, 0, LW, LH);
      if (!s) { crt(ctx, S); return; }
      ctx.save(); ctx.translate(shake.x, shake.y);
      // pillars (rising for a moment when they come)
      for (const p of s.pillars) {
        const x = p % COLS, y = Math.floor(p / COLS), r = rising.find(q => q.x === x && q.y === y), u = r ? Math.min(1, r.t / 0.5) : 1;
        glow(ctx, '#a855f7', cx(x), cy(y), 18, 0.35 * u);
        const g = ctx.createLinearGradient(0, FY0 + y * C, 0, FY0 + y * C + C); g.addColorStop(0, '#d8b4fe'); g.addColorStop(1, '#6b21a8');
        ctx.fillStyle = g; ctx.globalAlpha = u; rrect(ctx, FX0 + x * C + 2, FY0 + y * C + 2 + (1 - u) * 8, C - 4, (C - 4) * u, 3); ctx.fill(); ctx.globalAlpha = 1;
      }
      for (const r of rising) r.t += dt;
      rising = rising.filter(r => r.t < 0.6);
      // the orbs
      if (s.food) { const pu = 1 + Math.sin(T * 6) * 0.12; glow(ctx, '#e879f9', cx(s.food.x), cy(s.food.y), 20, 0.6); ctx.fillStyle = '#f5d0fe'; ctx.beginPath(); ctx.arc(cx(s.food.x), cy(s.food.y), 4.5 * pu, 0, 7); ctx.fill(); }
      if (s.bonus) {
        const x = cx(s.bonus.x), y = cy(s.bonus.y), u = s.bonus.t / 420;
        glow(ctx, '#facc15', x, y, 24, 0.7);
        ctx.strokeStyle = 'rgba(253,230,138,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 9, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#fde68a'; ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 + T * 2, r = k % 2 ? 2.4 : 5.5; ctx[k ? 'lineTo' : 'moveTo'](x + Math.sin(a) * r, y - Math.cos(a) * r); } ctx.closePath(); ctx.fill();
      }
      // the snake: each part between its cell and the next, so it glides
      if (!isPaused && !s.over && !(s.wait > 0)) frac = Math.min(1, (s.moveT + 0.5) / speedAt(s.level)); else if (s.over || s.wait > 0) frac = 0;
      const nd = s.queue.length ? s.queue[0] : s.dir, n = s.body.length;
      const pos = i => {
        const [x, y] = s.body[i], [tx, ty] = i === 0 ? [x + DIRS[nd][0], y + DIRS[nd][1]] : s.body[i - 1];
        const stay = i === n - 1 && s.grow > 0;
        const f = s.over || stay ? 0 : frac;
        return [cx(x + (tx - x) * f), cy(y + (ty - y) * f)];
      };
      const dead = overT >= 0;
      for (let i = n - 1; i >= 0; i--) {
        const [x, y] = pos(i), t = n > 1 ? i / (n - 1) : 0, col = dead ? (Math.floor(T * 8) & 1 ? '#f87171' : '#7f1d1d') : mix(HEAD, TAIL, t);
        if (i % 3 === 0) glow(ctx, '#22c55e', x, y, 14, 0.18 * (1 - t));
        const r = i === 0 ? 7 : 6.3 - t * 1.6;
        ctx.fillStyle = col; rrect(ctx, x - r, y - r, r * 2, r * 2, r * 0.6); ctx.fill();
        if (i && i < n - 1) { const [px, py] = pos(i - 1); ctx.fillStyle = col; ctx.fillRect(Math.min(x, px) - r * 0.6, Math.min(y, py) - r * 0.6, Math.abs(px - x) + r * 1.2, Math.abs(py - y) + r * 1.2); }
      }
      // the head: eyes looking the way it goes
      { const [x, y] = pos(0), [dx, dy] = DIRS[nd];
        glow(ctx, '#bef264', x, y, 20, 0.45);
        for (const sgn of [-1, 1]) { const ex = x + dx * 2.5 + -dy * sgn * 3.3, ey = y + dy * 2.5 + dx * sgn * 3.3; ctx.fillStyle = '#052e16'; ctx.beginPath(); ctx.arc(ex, ey, 2.2, 0, 7); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.fillRect(ex + dx * 0.8 - 0.6, ey + dy * 0.8 - 0.6, 1.2, 1.2); }
      }
      P.draw(ctx); F.draw(ctx, isPaused ? 0 : dt);
      ctx.restore();
      // the heads-up line
      text(ctx, 'SCORE', 14, 12, 1, { color: '#86efac', glow: false });
      text(ctx, fmt(s.score), 14, 24, 2, { color: '#ffffff', glow: '#22c55e' });
      const hi = Math.max(best, s.score), beat = s.score > best && best > 0;
      text(ctx, 'HI', LW / 2, 12, 1, { color: '#86efac', glow: false, align: 'center' });
      text(ctx, fmt(hi), LW / 2, 24, 2, { color: beat ? '#fde68a' : '#e2e8f0', glow: beat ? '#f59e0b' : false, align: 'center' });
      text(ctx, 'LEVEL', LW - 14, 12, 1, { color: '#86efac', glow: false, align: 'right' });
      text(ctx, String(s.level), LW - 14, 24, 2, { color: '#bef264', glow: '#22c55e', align: 'right' });
      text(ctx, `LENGTH ${n + s.grow}`, FX0, FY0 + ROWS * C + 10, 1, { color: '#4ade80', glow: false });
      if (practice) text(ctx, 'PRACTICE', LW - FX0, FY0 + ROWS * C + 10, 1, { color: '#94a3b8', glow: false, align: 'right' });
      if (banner) {
        if (!isPaused) banner.t += dt;
        if (banner.t > banner.life) banner = null;
        else if (blink(banner.t, 0.4, 0.75)) text(ctx, banner.str, LW / 2, FY0 + ROWS * C / 2 - 30, 3, { color: banner.color, align: 'center' });
      }
      if (flash > 0) { ctx.fillStyle = `rgba(248,113,113,${Math.min(0.35, flash)})`; ctx.fillRect(0, 0, LW, LH); flash -= dt; }
      if (overT >= 0) {
        overT += dt;
        if (overT > 0.7) { ctx.fillStyle = 'rgba(2,6,4,0.55)'; ctx.fillRect(FX0, FY0 + ROWS * C / 2 - 44, COLS * C, 88); text(ctx, 'GAME OVER', LW / 2, FY0 + ROWS * C / 2 - 30, 4, { color: '#fda4af', glow: '#e11d48', align: 'center' }); text(ctx, fmt(s.score), LW / 2, FY0 + ROWS * C / 2 + 12, 2, { color: '#ffffff', align: 'center' }); }
      }
      if (isPaused) { ctx.fillStyle = 'rgba(2,6,4,0.6)'; ctx.fillRect(0, 0, LW, LH); text(ctx, 'PAUSED', LW / 2, LH / 2 - 10, 3, { color: '#e2e8f0', align: 'center' }); }
      crt(ctx, S);
    },
  };
}

// ------------------------------------------------------------------------------------------- the attract screen
export function cover(ctx, w, h, t, info = {}) {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#04140b'); g.addColorStop(1, '#010604');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const s = w / 240, c = 10 * s;
  ctx.fillStyle = 'rgba(134,239,172,0.12)';
  for (let y = c; y < h; y += c) for (let x = c; x < w; x += c) ctx.fillRect(x, y, 1, 1);
  // a snake winding round a loop
  const n = 22, path = u => { const a = u * Math.PI * 2; return [w / 2 + Math.sin(a) * w * 0.36, h * 0.47 + Math.sin(a * 2) * h * 0.12]; };
  for (let i = n - 1; i >= 0; i--) {
    const [x, y] = path((t * 0.12 - i * 0.012) % 1), col = mix(HEAD, TAIL, i / (n - 1)), r = (i ? 5 - i * 0.1 : 6) * s;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  const [fx, fy] = path((t * 0.12 + 0.05) % 1);
  ctx.fillStyle = '#f5d0fe'; ctx.beginPath(); ctx.arc(fx, fy, 3.5 * s, 0, 7); ctx.fill();
  text(ctx, 'NEON', w / 2, h * 0.07, Math.round(4 * s), { color: '#d9f99d', glow: '#22c55e', align: 'center' });
  text(ctx, 'SNAKE', w / 2, h * 0.07 + 36 * s, Math.round(4 * s), { color: '#f5d0fe', glow: '#e879f9', align: 'center' });
  const top = info.top || [];
  text(ctx, 'HI-SCORES', w / 2, h * 0.66, Math.max(1, Math.round(s)), { color: '#fde68a', glow: false, align: 'center' });
  for (let i = 0; i < 3; i++) {
    const r = top[i], y = h * 0.66 + (14 + i * 12) * s;
    text(ctx, r ? `${i + 1} ${String(r.name).slice(0, 9).toUpperCase().padEnd(9, ' ')} ${fmt(r.score).padStart(7, ' ')}` : `${i + 1} ---       ------`, w / 2, y, Math.max(1, Math.round(s)), { color: i === 0 ? '#ffffff' : '#cbd5e1', glow: false, align: 'center' });
  }
  if (blink(t, 1.2)) text(ctx, 'PRESS PLAY', w / 2, h * 0.92, Math.max(1, Math.round(1.5 * s)), { color: '#86efac', glow: '#22c55e', align: 'center' });
}
