// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Flap Dash's screen (the rules: shared/arcade/games/flap-dash.js): a dusk sky over a neon city in three layers that
// scroll at their own pace, glass crystal pylons (the swaying ones tinted), star orbs, a scrolling ground, and Pip, our
// round bird-bot, tilting with its speed and beating its wings at each flap. The score sits big in the middle.
// createView() is the game in the sealed box; cover() its attract screen on the cabinets.
import * as sim from '/shared/arcade/games/flap-dash.js';
import { makeScreen, canvas, text, glow, Particles, Shake, Floaters, crt, blink, fmt, rrect, LW, LH } from '../fx.js';

export { sim };
const { GROUND, BIRD_X, BIRD_R, PYLON_W, gapY } = sim;

function skyline(w, h, k, seed, col, lit) {
  const c = canvas(w, h, k), x = c.x;
  let r = seed;
  const rnd = () => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
  for (let px = 0; px < w;) {
    const bw = 14 + rnd() * 30, bh = h * (0.3 + rnd() * 0.65);
    x.fillStyle = col; x.fillRect(px, h - bh, bw + 1, bh);
    if (lit) { x.fillStyle = lit; for (let wy = h - bh + 5; wy < h - 4; wy += 7) for (let wx = px + 3; wx < px + bw - 3; wx += 5) if (rnd() < 0.35) x.fillRect(wx, wy, 2, 3); }
    px += bw;
  }
  return c;
}
function backdrop(S) {
  const b = canvas(LW, LH, S.k), x = b.x;
  const g = x.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, '#1e1b4b'); g.addColorStop(0.45, '#6d28d9'); g.addColorStop(0.8, '#f472b6'); g.addColorStop(1, '#fdba74');
  x.fillStyle = g; x.fillRect(0, 0, LW, LH);
  const sun = x.createRadialGradient(250, 300, 0, 250, 300, 90); sun.addColorStop(0, 'rgba(254,240,138,0.95)'); sun.addColorStop(0.45, 'rgba(251,146,60,0.55)'); sun.addColorStop(1, 'rgba(251,146,60,0)');
  x.fillStyle = sun; x.fillRect(0, 0, LW, LH);
  x.fillStyle = 'rgba(255,255,255,0.7)'; for (let i = 0; i < 40; i++) x.fillRect((i * 97) % LW, (i * 53) % 180, 1, 1);
  return b;
}
function pylonBody(k, tint) {
  const c = canvas(PYLON_W, 64, k), x = c.x, g = x.createLinearGradient(0, 0, PYLON_W, 0);
  g.addColorStop(0, tint[0]); g.addColorStop(0.35, tint[1]); g.addColorStop(0.55, '#ffffff'); g.addColorStop(0.7, tint[1]); g.addColorStop(1, tint[2]);
  x.globalAlpha = 0.92; x.fillStyle = g; x.fillRect(0, 0, PYLON_W, 64);
  x.globalAlpha = 0.25; x.fillStyle = '#ffffff'; for (let y = 0; y < 64; y += 16) x.fillRect(4, y + 3, PYLON_W - 8, 1.5);
  return c;
}
const TINT = { glass: ['#0e7490', '#22d3ee', '#155e75'], sway: ['#86198f', '#e879f9', '#701a75'] };
function pip(ctx, x, y, rot, wing, dead, t) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  glow(ctx, '#fbbf24', 0, 0, 22, 0.35);
  const g = ctx.createRadialGradient(-4, -5, 2, 0, 0, BIRD_R + 2); g.addColorStop(0, '#fef3c7'); g.addColorStop(0.5, '#fbbf24'); g.addColorStop(1, '#c2410c');
  ctx.fillStyle = dead ? '#94a3b8' : g; ctx.beginPath(); ctx.arc(0, 0, BIRD_R + 1, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff7ed'; ctx.beginPath(); ctx.ellipse(1, 5, 7, 4.5, 0, 0, 7); ctx.fill();
  // the visor and the eye
  ctx.fillStyle = '#0f172a'; rrect(ctx, 1, -8, 12, 8, 4); ctx.fill();
  ctx.fillStyle = dead ? '#f87171' : '#67e8f9'; ctx.fillRect(dead ? 4 : 6 + Math.sin(t * 3) * 1, -6, dead ? 6 : 4, dead ? 1.5 : 3);
  // the beak
  ctx.fillStyle = '#fb923c'; ctx.beginPath(); ctx.moveTo(BIRD_R, -1); ctx.lineTo(BIRD_R + 7, 2); ctx.lineTo(BIRD_R, 5); ctx.fill();
  // the wing, beating
  ctx.save(); ctx.translate(-4, 1); ctx.rotate(-0.6 + wing * 1.4);
  ctx.fillStyle = '#f59e0b'; ctx.beginPath(); ctx.ellipse(-4, 0, 8, 4.5, 0.2, 0, 7); ctx.fill();
  ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.ellipse(-5, -1, 5, 2, 0.2, 0, 7); ctx.fill();
  ctx.restore();
  ctx.restore();
}

export function createView(cv) {
  const S = makeScreen(cv), P = new Particles(500), shake = new Shake(), F = new Floaters();
  let bg = null, far = null, mid = null, bodies = null, key = '', best = 0, practice = false, T = 0, wing = 0, overT = -1, isPaused = false, flash = 0, pop = 0;
  return {
    resize() { S.fit(); },
    pause(on) { isPaused = on; },
    reset(s, info) { best = info.best || 0; practice = info.practice; overT = -1; P.p.length = 0; wing = 0; },
    event(ev) {
      if (ev.k === 'flap') wing = 1;
      else if (ev.k === 'pass') { pop = 1; if (ev.n % 10 === 0) F.add(`${ev.n}!`, LW / 2, 140, { color: '#fde68a', s: 3 }); }
      else if (ev.k === 'orb') { P.burst(ev.x, ev.y, 18, { color: ['#fde68a', '#ffffff', '#fbbf24'], speed: 120, life: 0.5 }); F.add('+3', ev.x + 10, ev.y - 14, { color: '#fde68a', s: 2 }); }
      else if (ev.k === 'hit') { flash = 0.5; shake.kick(7); P.burst(ev.x, ev.y, 30, { color: ['#fbbf24', '#ffffff', '#f472b6'], speed: 160, life: 0.8 }); }
      else if (ev.k === 'over') overT = 0;
    },
    sfx(ev) { return { flap: ['flap'], pass: ['point'], orb: ['orb'], hit: ['thump'], over: ['over'] }[ev.k] || null; },
    buzz(ev) { return ev.k === 'hit' ? 140 : ev.k === 'flap' ? 4 : 0; },
    draw(dt, s) {
      S.fit();
      const ctx = S.ctx; if (!isPaused) T += dt;
      const k2 = `${S.cv.width}x${S.cv.height}`;
      if (k2 !== key) {
        key = k2; bg = backdrop(S);
        far = skyline(LW * 2, 150, S.k, 7, '#3b0764', 'rgba(244,114,182,0.6)'); mid = skyline(LW * 2, 110, S.k, 19, '#1e1b4b', 'rgba(251,191,36,0.75)');
        bodies = { glass: pylonBody(S.k, TINT.glass), sway: pylonBody(S.k, TINT.sway) };
      }
      S.begin();
      if (!isPaused) { shake.update(dt); P.update(dt); }
      ctx.drawImage(bg.c, 0, 0, LW, LH);
      const d = s ? s.dist : T * 60 * 2.2;
      for (const [layer, f, y] of [[far, 0.15, GROUND - 150], [mid, 0.4, GROUND - 110]]) { const off = -((d * f) % (LW * 2)); ctx.drawImage(layer.c, off, y, LW * 2, layer.h); ctx.drawImage(layer.c, off + LW * 2, y, LW * 2, layer.h); }
      ctx.save(); ctx.translate(shake.x, shake.y);
      if (s) {
        // pylons: glass bodies with lips at the gap
        for (const p of s.pylons) {
          if (p.x > LW + 10 || p.x < -PYLON_W - 10) continue;
          const g = gapY(s, p), top = g - p.gap / 2, bot = g + p.gap / 2, body = p.sway ? bodies.sway : bodies.glass, tint = p.sway ? TINT.sway : TINT.glass;
          ctx.drawImage(body.c, p.x, -2, PYLON_W, top + 2); ctx.drawImage(body.c, p.x, bot, PYLON_W, GROUND - bot);
          for (const [y0, dir] of [[top, -1], [bot, 1]]) {
            glow(ctx, tint[1], p.x + PYLON_W / 2, y0, 36, 0.35);
            const lg = ctx.createLinearGradient(p.x - 5, 0, p.x + PYLON_W + 5, 0); lg.addColorStop(0, tint[2]); lg.addColorStop(0.5, '#ffffff'); lg.addColorStop(1, tint[2]);
            ctx.fillStyle = lg; rrect(ctx, p.x - 5, dir < 0 ? y0 - 16 : y0, PYLON_W + 10, 16, 4); ctx.fill();
          }
          if (p.orb && !p.orb.taken) { const ox = p.x + PYLON_W / 2, oy = g + Math.sin(T * 5 + p.id) * 3; glow(ctx, '#fde68a', ox, oy, 18, 0.8); ctx.fillStyle = '#fef9c3'; ctx.beginPath(); for (let q = 0; q < 10; q++) { const a = (q / 10) * Math.PI * 2 + T * 2, r = q % 2 ? 2.5 : 6; ctx[q ? 'lineTo' : 'moveTo'](ox + Math.sin(a) * r, oy - Math.cos(a) * r); } ctx.closePath(); ctx.fill(); }
        }
      }
      // the ground
      const gx = -((d) % 24);
      const gg = ctx.createLinearGradient(0, GROUND, 0, LH); gg.addColorStop(0, '#312e81'); gg.addColorStop(1, '#0f0a2a');
      ctx.fillStyle = gg; ctx.fillRect(0, GROUND, LW, LH - GROUND);
      ctx.fillStyle = '#e879f9'; ctx.fillRect(0, GROUND, LW, 2);
      ctx.fillStyle = 'rgba(232,121,249,0.35)'; for (let x = gx; x < LW; x += 24) { ctx.beginPath(); ctx.moveTo(x, GROUND + 2); ctx.lineTo(x + 12, GROUND + 2); ctx.lineTo(x + 2, LH); ctx.lineTo(x - 10, LH); ctx.fill(); }
      // Pip
      const y = s ? s.y : 200 + Math.sin(T * 3) * 6, vy = s ? s.vy : 0, idle = !s || !s.started;
      if (!isPaused) wing = Math.max(0, wing - dt * 5);
      const beat = idle ? (Math.sin(T * 12) + 1) / 2 : wing;
      pip(ctx, BIRD_X, idle ? y + Math.sin(T * 3) * 5 : y, idle ? 0 : Math.max(-0.45, Math.min(1.1, vy * 0.09)), beat, s?.over, T);
      P.draw(ctx); F.draw(ctx, isPaused ? 0 : dt);
      ctx.restore();
      if (s) {
        // the score, big
        if (!isPaused) pop = Math.max(0, pop - dt * 4);
        if (s.started) text(ctx, String(s.score), LW / 2, 40 - pop * 4, 6 + Math.round(pop), { color: '#ffffff', glow: '#7c3aed', align: 'center' });
        if (!s.started) {
          text(ctx, 'FLAP', LW / 2, 70, 5, { color: '#fde68a', glow: '#f59e0b', align: 'center' });
          text(ctx, 'DASH', LW / 2, 115, 5, { color: '#a5f3fc', glow: '#22d3ee', align: 'center' });
          if (blink(T, 1)) text(ctx, 'TAP OR PRESS A TO FLAP', LW / 2, 300, 1, { color: '#ffffff', glow: '#7c3aed', align: 'center' });
          if (best) text(ctx, `BEST ${best}`, LW / 2, 320, 1, { color: '#fde68a', glow: false, align: 'center' });
        }
        if (practice) text(ctx, 'PRACTICE', LW - 10, LH - 14, 1, { color: '#c4b5fd', glow: false, align: 'right' });
      }
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, flash)})`; ctx.fillRect(0, 0, LW, LH); flash -= dt * 2; }
      if (overT >= 0 && s) {
        overT += dt;
        if (overT > 0.5) {
          ctx.fillStyle = 'rgba(15,10,42,0.6)'; rrect(ctx, 50, 150, LW - 100, 150, 14); ctx.fill();
          text(ctx, 'GAME OVER', LW / 2, 168, 3, { color: '#fda4af', glow: '#e11d48', align: 'center' });
          text(ctx, 'SCORE', 100, 212, 1, { color: '#c4b5fd', glow: false }); text(ctx, String(s.score), 100, 226, 3, { color: '#ffffff' });
          const hi = Math.max(best, s.score);
          text(ctx, 'BEST', 200, 212, 1, { color: '#c4b5fd', glow: false }); text(ctx, String(hi), 200, 226, 3, { color: s.score > best ? '#fde68a' : '#ffffff' });
          const medal = s.score >= 60 ? '#e5e4e2' : s.score >= 30 ? '#fbbf24' : s.score >= 10 ? '#cd7f32' : null;
          if (medal) { glow(ctx, medal, LW / 2, 278, 20, 0.6); ctx.fillStyle = medal; ctx.beginPath(); ctx.arc(LW / 2, 278, 9, 0, 7); ctx.fill(); }
        }
      }
      if (isPaused) { ctx.fillStyle = 'rgba(15,10,42,0.6)'; ctx.fillRect(0, 0, LW, LH); text(ctx, 'PAUSED', LW / 2, LH / 2 - 10, 3, { color: '#e2e8f0', align: 'center' }); }
      crt(ctx, S);
    },
  };
}

// ------------------------------------------------------------------------------------------- the attract screen
export function cover(ctx, w, h, t, info = {}) {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1e1b4b'); g.addColorStop(0.5, '#6d28d9'); g.addColorStop(0.85, '#f472b6'); g.addColorStop(1, '#fdba74');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const s = w / 240, off = (t * 60) % 150;
  for (let k = -1; k < 3; k++) {
    const x = k * 150 * s - off * s + 90 * s, gy = h * (0.42 + ((k + 3) % 3) * 0.06), gap = 70 * s;
    ctx.fillStyle = '#22d3ee'; ctx.globalAlpha = 0.85; ctx.fillRect(x, 0, 30 * s, gy - gap / 2); ctx.fillRect(x, gy + gap / 2, 30 * s, h - gy - gap / 2); ctx.globalAlpha = 1;
    ctx.fillStyle = '#e0f2fe'; ctx.fillRect(x - 3 * s, gy - gap / 2 - 8 * s, 36 * s, 8 * s); ctx.fillRect(x - 3 * s, gy + gap / 2, 36 * s, 8 * s);
  }
  ctx.save(); ctx.scale(s, s); pip(ctx, 70, h / s * 0.5 + Math.sin(t * 4) * 12, Math.sin(t * 4 + 1) * 0.3, (Math.sin(t * 14) + 1) / 2, false, t); ctx.restore();
  text(ctx, 'FLAP', w / 2, h * 0.06, Math.round(4 * s), { color: '#fde68a', glow: '#f59e0b', align: 'center' });
  text(ctx, 'DASH', w / 2, h * 0.06 + 36 * s, Math.round(4 * s), { color: '#a5f3fc', glow: '#22d3ee', align: 'center' });
  const top = info.top || [];
  ctx.fillStyle = 'rgba(15,10,42,0.55)'; ctx.fillRect(0, h * 0.7, w, h * 0.3);
  text(ctx, 'HI-SCORES', w / 2, h * 0.72, Math.max(1, Math.round(s)), { color: '#fde68a', glow: false, align: 'center' });
  for (let i = 0; i < 3; i++) {
    const r = top[i], y = h * 0.72 + (13 + i * 11) * s;
    text(ctx, r ? `${i + 1} ${String(r.name).slice(0, 9).toUpperCase().padEnd(9, ' ')} ${fmt(r.score).padStart(7, ' ')}` : `${i + 1} ---       ------`, w / 2, y, Math.max(1, Math.round(s)), { color: i === 0 ? '#ffffff' : '#e2e8f0', glow: false, align: 'center' });
  }
  if (blink(t, 1.2)) text(ctx, 'PRESS PLAY', w / 2, h * 0.95, Math.max(1, Math.round(1.5 * s)), { color: '#86efac', glow: '#22c55e', align: 'center' });
}
