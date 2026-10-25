// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// City Shield's screen (the rules: shared/arcade/games/city-shield.js): a night sky with a big moon over hills, six
// glass domes full of city lights (rubble and embers once hit), three launchers with their shots left, missiles
// trailing fire down from where they came, interceptors trailing blue up to their mark, blasts that bloom bright and
// change colour, chains and bonuses as words, and a crosshair where you aim. createView() is the game in the sealed box;
// cover() its attract screen on the cabinets.
import * as sim from '/shared/arcade/games/city-shield.js';
import { makeScreen, canvas, text, glow, Particles, Shake, Floaters, crt, blink, fmt, rrect, LW, LH } from '../fx.js';

export { sim };
const { GROUND, LAUNCHERS, DOMES, blastR, multOf } = sim;
const BLAST_C = ['#ffffff', '#fde68a', '#f472b6', '#22d3ee', '#a78bfa'];

function backdrop(S) {
  const b = canvas(LW, LH, S.k), x = b.x;
  const g = x.createLinearGradient(0, 0, 0, GROUND); g.addColorStop(0, '#020617'); g.addColorStop(0.6, '#1e1b4b'); g.addColorStop(1, '#4c1d95');
  x.fillStyle = g; x.fillRect(0, 0, LW, LH);
  for (let i = 0; i < 80; i++) { x.fillStyle = i % 5 ? 'rgba(226,232,240,0.6)' : '#ffffff'; x.fillRect((i * 131) % LW, (i * 71) % (GROUND - 80), i % 7 ? 1 : 1.6, i % 7 ? 1 : 1.6); }
  const m = x.createRadialGradient(288, 92, 0, 288, 92, 70); m.addColorStop(0, 'rgba(254,243,199,0.35)'); m.addColorStop(1, 'rgba(254,243,199,0)');
  x.fillStyle = m; x.fillRect(200, 20, 160, 150);
  x.fillStyle = '#fef3c7'; x.beginPath(); x.arc(288, 92, 22, 0, 7); x.fill();
  x.fillStyle = 'rgba(203,213,225,0.5)'; for (const [cx, cy, r] of [[282, 86, 4], [295, 98, 3], [290, 82, 2]]) { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); }
  x.fillStyle = '#1e1b4b'; x.beginPath(); x.moveTo(0, GROUND); for (let px = 0; px <= LW; px += 20) x.lineTo(px, GROUND - 30 - Math.sin(px / 47) * 14 - Math.sin(px / 19) * 6); x.lineTo(LW, GROUND); x.fill();
  const gg = x.createLinearGradient(0, GROUND, 0, LH); gg.addColorStop(0, '#312e81'); gg.addColorStop(1, '#0b0820');
  x.fillStyle = gg; x.fillRect(0, GROUND, LW, LH - GROUND);
  x.fillStyle = '#a78bfa'; x.fillRect(0, GROUND, LW, 1.5);
  return b;
}
function dome(ctx, x, alive, T, i) {
  const y = GROUND;
  if (!alive) {
    ctx.fillStyle = '#334155'; ctx.beginPath(); ctx.moveTo(x - 15, y); ctx.lineTo(x - 9, y - 6); ctx.lineTo(x - 3, y - 3); ctx.lineTo(x + 3, y - 8); ctx.lineTo(x + 10, y - 4); ctx.lineTo(x + 15, y); ctx.fill();
    if (Math.floor(T * 3 + i) % 3 === 0) { ctx.fillStyle = '#fb923c'; ctx.fillRect(x - 4 + ((i * 7) % 8), y - 5, 2, 2); }
    return;
  }
  glow(ctx, '#22d3ee', x, y - 8, 22, 0.25);
  ctx.fillStyle = '#0f172a';
  for (const [bx, bh] of [[-11, 10], [-6, 15], [-1, 12], [4, 17], [9, 9]]) ctx.fillRect(x + bx, y - bh, 4, bh);
  ctx.fillStyle = '#fde68a';
  for (const [bx, bh] of [[-11, 10], [-6, 15], [-1, 12], [4, 17], [9, 9]]) for (let wy = y - bh + 2; wy < y - 2; wy += 3) if ((wy + bx * 3 + i) % 2 === 0) ctx.fillRect(x + bx + 1, wy, 1, 1);
  ctx.fillStyle = 'rgba(103,232,249,0.18)'; ctx.strokeStyle = 'rgba(165,243,252,0.8)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, 15, Math.PI, 0); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.ellipse(x - 6, y - 10, 3, 1.5, -0.6, 0, 7); ctx.fill();
}
function launcher(ctx, x, L, T) {
  const y = GROUND;
  ctx.fillStyle = L.alive ? '#475569' : '#1e293b';
  ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.lineTo(x - 9, y - 12); ctx.lineTo(x + 9, y - 12); ctx.lineTo(x + 16, y); ctx.fill();
  if (!L.alive) { if (Math.floor(T * 4) & 1) { ctx.fillStyle = '#f97316'; ctx.fillRect(x - 2, y - 14, 3, 3); } return; }
  ctx.fillStyle = '#94a3b8'; ctx.fillRect(x - 2, y - 18, 4, 7);
  ctx.fillStyle = '#22d3ee'; for (let k = 0; k < L.ammo; k++) ctx.fillRect(x - 13 + (k % 5) * 6 + 1, y + 6 + Math.floor(k / 5) * 6, 3, 4);
}

export function createView(cv) {
  const S = makeScreen(cv), P = new Particles(900), shake = new Shake(), F = new Floaters();
  let bg = null, key = '', best = 0, practice = false, T = 0, banner = null, overT = -1, isPaused = false, flash = 0;
  return {
    resize() { S.fit(); },
    pause(on) { isPaused = on; },
    reset(s, info) { best = info.best || 0; practice = info.practice; overT = -1; P.p.length = 0; banner = { str: 'WAVE 1', t: 0, life: 1.6, color: '#fdba74' }; },
    event(ev) {
      switch (ev.k) {
        case 'kill': P.burst(ev.x, ev.y, 10, { color: ['#fde68a', '#fb923c', '#ffffff'], speed: 90, life: 0.5 }); if (ev.chain >= 2) F.add(`CHAIN X${ev.chain}`, ev.x, ev.y - 12, { color: '#f9a8d4', s: 1, life: 0.9 }); else F.add(String(ev.pts), ev.x, ev.y - 10, { color: '#fde68a', s: 1, life: 0.7 }); break;
        case 'bomberDown': P.burst(ev.x, ev.y, 30, { color: ['#f43f5e', '#fde68a', '#ffffff'], speed: 160, life: 0.8 }); F.add(String(ev.pts), ev.x, ev.y - 10, { color: '#fde68a', s: 2 }); shake.kick(3); break;
        case 'dome': P.burst(ev.x, GROUND - 6, 60, { color: ['#f97316', '#fde68a', '#ef4444', '#ffffff'], speed: 170, life: 1.1, gravity: 120 }); shake.kick(8); flash = 0.25; break;
        case 'base': P.burst(ev.x, GROUND - 8, 40, { color: ['#f97316', '#94a3b8', '#ffffff'], speed: 150, life: 0.9, gravity: 120 }); shake.kick(6); break;
        case 'thud': P.burst(ev.x, GROUND - 2, 12, { color: ['#f97316', '#94a3b8'], speed: 80, life: 0.5, dir: 0, spread: 2 }); break;
        case 'split': P.burst(ev.x, ev.y, 8, { color: '#fda4af', speed: 70, life: 0.3 }); break;
        case 'tally': banner = { str: 'WAVE CLEAR', t: 0, life: 2.7, color: '#86efac', tally: true }; break;
        case 'wave': banner = { str: `WAVE ${ev.wave}`, t: 0, life: 1.6, color: '#fdba74' }; break;
        case 'spare': F.add('BONUS CITY!', LW / 2, 200, { color: '#86efac', s: 2, life: 1.6 }); break;
        case 'rebuilt': F.add('CITY REBUILT', DOMES[ev.i], GROUND - 30, { color: '#86efac', s: 1, life: 1.6 }); break;
        case 'fallen': banner = { str: 'THE CITIES HAVE FALLEN', t: 0, life: 3, color: '#fda4af' }; break;
        case 'over': overT = 0; break;
        default: break;
      }
    },
    sfx(ev) { return { fire: ['launch'], burst: ['burst'], kill: ['chain', ev.chain], bomberDown: ['bigboom'], dome: ['domeLost'], base: ['bigboom'], split: ['split'], empty: ['click'], tally: ['tally'], wave: ['level'], spare: ['coin'], bomber: ['ufo'], over: ['over'] }[ev.k] || null; },
    buzz(ev) { return ev.k === 'dome' ? 180 : ev.k === 'base' ? 120 : ev.k === 'fire' ? 6 : ev.k === 'kill' ? 8 : 0; },
    draw(dt, s) {
      S.fit();
      const ctx = S.ctx; if (!isPaused) T += dt;
      const k2 = `${S.cv.width}x${S.cv.height}`;
      if (k2 !== key) { key = k2; bg = backdrop(S); }
      S.begin();
      if (!isPaused) { shake.update(dt); P.update(dt); }
      ctx.drawImage(bg.c, 0, 0, LW, LH);
      if (!s) { crt(ctx, S); return; }
      ctx.save(); ctx.translate(shake.x, shake.y);
      DOMES.forEach((x, i) => dome(ctx, x, s.domes[i], T, i));
      LAUNCHERS.forEach((x, i) => launcher(ctx, x, s.launchers[i], T));
      // missiles: a trail of fire from where they came
      ctx.lineCap = 'round';
      for (const m of s.missiles) {
        const sx = m.sx ?? m.x0, sy = m.sy ?? m.y0, g = ctx.createLinearGradient(sx, sy, m.x, m.y);
        g.addColorStop(0, 'rgba(244,63,94,0)'); g.addColorStop(1, 'rgba(251,146,60,0.9)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(m.x, m.y); ctx.stroke();
        glow(ctx, '#fb923c', m.x, m.y, 8, 0.9); ctx.fillStyle = '#ffffff'; ctx.fillRect(m.x - 1, m.y - 1, 2, 2);
      }
      // bombers
      for (const b of s.bombers) {
        ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.ellipse(b.x, b.y, 14, 4, 0, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.moveTo(b.x - 3, b.y); ctx.lineTo(b.x + 3 * Math.sign(b.vx), b.y - 9); ctx.lineTo(b.x + 6 * Math.sign(b.vx), b.y); ctx.fill();
        ctx.fillStyle = Math.floor(T * 6) & 1 ? '#f43f5e' : '#22c55e'; ctx.fillRect(b.x - 13, b.y - 1, 2, 2); ctx.fillRect(b.x + 11, b.y - 1, 2, 2);
      }
      // interceptors: a blue trail up to the mark, and the mark
      for (const sh of s.shots) {
        ctx.strokeStyle = 'rgba(103,232,249,0.7)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(sh.x0, sh.y0); ctx.lineTo(sh.x, sh.y); ctx.stroke();
        glow(ctx, '#67e8f9', sh.x, sh.y, 7, 1);
        ctx.strokeStyle = '#a5f3fc'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sh.tx - 3, sh.ty - 3); ctx.lineTo(sh.tx + 3, sh.ty + 3); ctx.moveTo(sh.tx + 3, sh.ty - 3); ctx.lineTo(sh.tx - 3, sh.ty + 3); ctx.stroke();
      }
      // blasts, blooming
      const op = ctx.globalCompositeOperation; ctx.globalCompositeOperation = 'lighter';
      for (const bl of s.blasts) {
        const r = blastR(bl); if (r <= 0.5) continue;
        const col = BLAST_C[Math.floor(T * 14 + bl.x) % BLAST_C.length], g = ctx.createRadialGradient(bl.x, bl.y, 0, bl.x, bl.y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.45, col); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bl.x, bl.y, r, 0, 7); ctx.fill();
      }
      ctx.globalCompositeOperation = op;
      P.draw(ctx); F.draw(ctx, isPaused ? 0 : dt);
      // the crosshair
      if (!s.overT && !s.tallyT) {
        const c = s.cross, rr = 9 + Math.sin(T * 6) * 1.2;
        ctx.strokeStyle = '#a5f3fc'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, 7);
        for (const [a, b2] of [[[-rr - 5, 0], [-rr + 3, 0]], [[rr - 3, 0], [rr + 5, 0]], [[0, -rr - 5], [0, -rr + 3]], [[0, rr - 3], [0, rr + 5]]]) { ctx.moveTo(c.x + a[0], c.y + a[1]); ctx.lineTo(c.x + b2[0], c.y + b2[1]); }
        ctx.stroke();
      }
      ctx.restore();
      // the heads-up line
      text(ctx, 'SCORE', 12, 10, 1, { color: '#fdba74', glow: false });
      text(ctx, fmt(s.score), 12, 22, 2, { color: '#ffffff', glow: '#f97316' });
      const hi = Math.max(best, s.score), beat = s.score > best && best > 0;
      text(ctx, 'HI', LW / 2, 10, 1, { color: '#fdba74', glow: false, align: 'center' });
      text(ctx, fmt(hi), LW / 2, 22, 2, { color: beat ? '#fde68a' : '#e2e8f0', glow: beat ? '#f59e0b' : false, align: 'center' });
      text(ctx, 'WAVE', LW - 12, 10, 1, { color: '#fdba74', glow: false, align: 'right' });
      text(ctx, `${s.wave}${multOf(s) > 1 ? ` X${multOf(s)}` : ''}`, LW - 12, 22, 2, { color: '#fed7aa', glow: '#f97316', align: 'right' });
      if (s.spare) text(ctx, `+${s.spare} CITY`, LW - 12, 40, 1, { color: '#86efac', glow: false, align: 'right' });
      if (practice) text(ctx, 'PRACTICE', LW / 2, LH - 12, 1, { color: '#94a3b8', glow: false, align: 'center' });
      if (banner) {
        if (!isPaused) banner.t += dt;
        if (banner.t > banner.life) banner = null;
        else {
          text(ctx, banner.str, LW / 2, 150, 2, { color: banner.color, align: 'center' });
          if (banner.tally && s.tally) {
            const t = s.tally;
            text(ctx, `CITIES ${t.domes} X ${100 * t.mult}`, LW / 2, 185, 1, { color: '#e2e8f0', glow: false, align: 'center' });
            text(ctx, `SHOTS LEFT ${t.ammo} X ${5 * t.mult}`, LW / 2, 200, 1, { color: '#e2e8f0', glow: false, align: 'center' });
            text(ctx, `BONUS ${fmt(t.bonus)}`, LW / 2, 222, 2, { color: '#fde68a', glow: '#f59e0b', align: 'center' });
          }
        }
      }
      if (flash > 0) { ctx.fillStyle = `rgba(254,215,170,${Math.min(0.4, flash)})`; ctx.fillRect(0, 0, LW, LH); flash -= dt; }
      if (overT >= 0) {
        overT += dt;
        if (overT > 0.6) { ctx.fillStyle = 'rgba(2,3,10,0.6)'; ctx.fillRect(0, LH / 2 - 50, LW, 92); text(ctx, 'GAME OVER', LW / 2, LH / 2 - 34, 4, { color: '#fda4af', glow: '#e11d48', align: 'center' }); text(ctx, fmt(s.score), LW / 2, LH / 2 + 8, 2, { color: '#ffffff', align: 'center' }); }
      }
      if (isPaused) { ctx.fillStyle = 'rgba(2,3,10,0.6)'; ctx.fillRect(0, 0, LW, LH); text(ctx, 'PAUSED', LW / 2, LH / 2 - 10, 3, { color: '#e2e8f0', align: 'center' }); }
      crt(ctx, S);
      void rrect;
    },
  };
}

// ------------------------------------------------------------------------------------------- the attract screen
export function cover(ctx, w, h, t, info = {}) {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#020617'); g.addColorStop(0.7, '#312e81'); g.addColorStop(1, '#4c1d95');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const s = w / 240, gy = h * 0.62;
  ctx.fillStyle = '#1e1b4b'; ctx.fillRect(0, gy, w, h - gy);
  ctx.save(); ctx.translate(0, gy - GROUND * s); ctx.scale(s, s);
  [40, 80, 160, 200].forEach((x, i) => dome(ctx, x, true, t, i));
  ctx.restore();
  for (let k = 0; k < 4; k++) {
    const u = ((t * 0.25 + k * 0.27) % 1), x0 = (30 + k * 60) * s, x1 = (60 + ((k * 53) % 140)) * s, x = x0 + (x1 - x0) * u, y = gy * u;
    ctx.strokeStyle = 'rgba(251,146,60,0.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x, y); ctx.stroke();
    if (u > 0.55 && u < 0.75) { const r = (u - 0.55) * 120 * s, gr = ctx.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, BLAST_C[k + 1]); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  }
  text(ctx, 'CITY', w / 2, h * 0.06, Math.round(4 * s), { color: '#fed7aa', glow: '#f97316', align: 'center' });
  text(ctx, 'SHIELD', w / 2, h * 0.06 + 36 * s, Math.round(4 * s), { color: '#ddd6fe', glow: '#8b5cf6', align: 'center' });
  const top = info.top || [];
  text(ctx, 'HI-SCORES', w / 2, h * 0.7, Math.max(1, Math.round(s)), { color: '#fde68a', glow: false, align: 'center' });
  for (let i = 0; i < 3; i++) {
    const r = top[i], y = h * 0.7 + (13 + i * 11) * s;
    text(ctx, r ? `${i + 1} ${String(r.name).slice(0, 9).toUpperCase().padEnd(9, ' ')} ${fmt(r.score).padStart(7, ' ')}` : `${i + 1} ---       ------`, w / 2, y, Math.max(1, Math.round(s)), { color: i === 0 ? '#ffffff' : '#cbd5e1', glow: false, align: 'center' });
  }
  if (blink(t, 1.2)) text(ctx, 'PRESS PLAY', w / 2, h * 0.94, Math.max(1, Math.round(1.5 * s)), { color: '#86efac', glow: '#22c55e', align: 'center' });
}
