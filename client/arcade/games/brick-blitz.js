// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Brick Blitz's screen (the rules: shared/arcade/games/brick-blitz.js): glassy bricks in rows of colour (harder ones
// darker, cracking as they're hit; steel riveted), a glowing paddle, balls with a light trail, capsules with their
// letter, sparks and a shake. createView() is the game in the sealed box; cover() its attract screen on the cabinets.
import * as sim from '/shared/arcade/games/brick-blitz.js';
import { makeScreen, canvas, text, glow, blit, Particles, Shake, Floaters, crt, blink, fmt, rrect, shade, LW, LH } from '../fx.js';

export { sim };
const { WALL_L, WALL_R, TOP, BW, BH, PADDLE_Y, PADDLE_H, BALL_R, paddleW } = sim;
const ROWC = ['#f43f5e', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6'];
const CAPC = { W: '#38bdf8', M: '#f472b6', S: '#4ade80', L: '#f87171', B: '#fbbf24' };
const CAPWORD = { W: 'WIDE!', M: 'MULTI!', S: 'SLOW', L: '1UP!', B: '+400' };

const bricks = new Map();
/** A brick of colour col (or steel), w × h device px, made once. */
function brickTile(col, w, h, steel) {
  const key = `${col}|${w}|${h}|${steel}`;
  let t = bricks.get(key);
  if (!t) {
    t = canvas(w, h, 1);
    const x = t.x, r = Math.max(2, h * 0.22), g = x.createLinearGradient(0, 0, 0, h);
    if (steel) { g.addColorStop(0, '#e2e8f0'); g.addColorStop(0.5, '#94a3b8'); g.addColorStop(1, '#475569'); }
    else { g.addColorStop(0, shade(col, 0.35)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -0.4)); }
    rrect(x, 0.5, 0.5, w - 1, h - 1, r); x.fillStyle = g; x.fill();
    x.strokeStyle = steel ? '#334155' : shade(col, -0.55); x.lineWidth = 1; x.stroke();
    x.globalAlpha = 0.45; x.fillStyle = '#ffffff'; rrect(x, w * 0.06, h * 0.12, w * 0.88, h * 0.22, h * 0.1); x.fill(); x.globalAlpha = 1;
    if (steel) { x.fillStyle = '#334155'; for (const px of [0.12, 0.88]) { x.beginPath(); x.arc(w * px, h / 2, Math.max(1, h * 0.12), 0, 7); x.fill(); } }
    bricks.set(key, t);
  }
  return t;
}
function backdrop(S) {
  const b = canvas(LW, LH, S.k), x = b.x;
  const g = x.createLinearGradient(0, 0, 0, LH); g.addColorStop(0, '#140a24'); g.addColorStop(1, '#0a0614');
  x.fillStyle = g; x.fillRect(0, 0, LW, LH);
  x.strokeStyle = 'rgba(244,114,182,0.05)'; x.lineWidth = 1;
  for (let k = -LH; k < LW; k += 22) { x.beginPath(); x.moveTo(k, TOP); x.lineTo(k + LH, TOP + LH); x.stroke(); }
  x.save(); x.shadowColor = '#f472b6'; x.shadowBlur = 12 * S.k; x.strokeStyle = '#f9a8d4'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(WALL_L - 2, LH); x.lineTo(WALL_L - 2, TOP - 2); x.lineTo(WALL_R + 2, TOP - 2); x.lineTo(WALL_R + 2, LH); x.stroke(); x.restore();
  return b;
}

export function createView(cv) {
  const S = makeScreen(cv), P = new Particles(700), shake = new Shake(), F = new Floaters();
  let bg = null, bgKey = '', best = 0, practice = false, T = 0, banner = null, overT = -1, isPaused = false, flash = 0, trails = [], padPulse = 0;
  return {
    resize() { S.fit(); },
    pause(on) { isPaused = on; },
    reset(s, info) { best = info.best || 0; practice = info.practice; banner = { str: 'LEVEL 1', t: 0, life: 1.4, color: '#fbcfe8' }; overT = -1; P.p.length = 0; trails = []; },
    event(ev) {
      switch (ev.k) {
        case 'brick': P.burst(ev.x, ev.y, 14, { color: [ROWC[ev.r % 8], '#ffffff'], speed: 130, life: 0.5, gravity: 200 }); shake.kick(1.2); break;
        case 'crack': P.burst(ev.x, ev.y, 6, { color: '#ffffff', speed: 80, life: 0.3 }); break;
        case 'steel': P.burst(ev.x, ev.y, 5, { color: ['#e2e8f0', '#fde68a'], speed: 90, life: 0.25 }); break;
        case 'paddle': padPulse = 0.25; break;
        case 'cap': F.add(CAPWORD[ev.c] || '', ev.x, ev.y - 8, { color: CAPC[ev.c] || '#fff', s: 2 }); P.burst(ev.x, ev.y, 20, { color: [CAPC[ev.c] || '#fff', '#ffffff'], speed: 140, life: 0.6 }); break;
        case 'lost': P.burst(ev.x, LH - 8, 16, { color: ['#f87171', '#fda4af'], speed: 120, life: 0.6, dir: 0, spread: 2 }); break;
        case 'die': flash = 0.35; shake.kick(6); break;
        case 'cleared': banner = { str: 'WALL CLEAR!', t: 0, life: 1.8, color: '#fde68a' }; F.add(`+${fmt(ev.pts)}`, LW / 2, LH / 2 + 20, { color: '#fde68a', s: 2 }); break;
        case 'level': banner = { str: `LEVEL ${ev.level}`, t: 0, life: 1.5, color: '#fbcfe8' }; break;
        case 'life': F.add('1UP!', LW / 2, LH - 80, { color: '#86efac', s: 2 }); break;
        case 'over': overT = 0; break;
        default: break;
      }
    },
    sfx(ev) { return { brick: ['brick', ev.r], crack: ['crack'], steel: ['steel'], paddle: ['paddle'], wall: ['wall'], cap: ['power'], lost: ['lost'], die: ['die'], cleared: ['fanfare'], level: ['level'], life: ['coin'], launch: ['laser'], over: ['over'] }[ev.k] || null; },
    buzz(ev) { return ev.k === 'die' ? 150 : ev.k === 'brick' ? 6 : ev.k === 'cap' ? 25 : 0; },
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
      const K = ctx.getTransform().a, bw = Math.round(BW * K), bh = Math.round(BH * K);
      for (const b of s.bricks) {
        blit(ctx, brickTile(b.steel ? '#94a3b8' : b.max > 1 ? shade(ROWC[b.r % 8], -0.25 + (b.hp - 1) * -0.1) : ROWC[b.r % 8], bw, bh, b.steel).c, b.x, b.y);
        if (!b.steel && b.hp < b.max) {   // cracks
          ctx.strokeStyle = 'rgba(15,10,25,0.75)'; ctx.lineWidth = 1; ctx.beginPath();
          ctx.moveTo(b.x + 6, b.y + 2); ctx.lineTo(b.x + 12, b.y + 8); ctx.lineTo(b.x + 10, b.y + BH - 2);
          if (b.max - b.hp > 1) { ctx.moveTo(b.x + BW - 7, b.y + 2); ctx.lineTo(b.x + BW - 13, b.y + 7); ctx.lineTo(b.x + BW - 9, b.y + BH - 2); }
          ctx.stroke();
        }
        if (!b.steel && b.max > 1) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; for (let k = 0; k < b.hp; k++) ctx.fillRect(b.x + BW / 2 - (b.hp * 4) / 2 + k * 4 + 1, b.y + BH - 4, 2, 2); }
      }
      // capsules
      for (const c of s.caps) {
        const col = CAPC[c.k] || '#fff';
        glow(ctx, col, c.x, c.y, 14, 0.5);
        const g = ctx.createLinearGradient(0, c.y - 6, 0, c.y + 6); g.addColorStop(0, shade(col, 0.4)); g.addColorStop(1, shade(col, -0.35));
        ctx.fillStyle = g; rrect(ctx, c.x - 12, c.y - 6, 24, 12, 6); ctx.fill();
        text(ctx, c.k, c.x, c.y - 3.5, 1, { color: '#ffffff', glow: false, align: 'center' });
      }
      // the paddle
      const pw = paddleW(s), px = s.px - pw / 2, py = PADDLE_Y - PADDLE_H / 2;
      glow(ctx, '#f472b6', s.px, PADDLE_Y, pw * 0.7, 0.35 + padPulse);
      const pg = ctx.createLinearGradient(0, py, 0, py + PADDLE_H); pg.addColorStop(0, '#fbcfe8'); pg.addColorStop(0.5, '#ec4899'); pg.addColorStop(1, '#831843');
      ctx.fillStyle = pg; rrect(ctx, px, py, pw, PADDLE_H, PADDLE_H / 2); ctx.fill();
      ctx.fillStyle = '#22d3ee'; ctx.fillRect(px + 3, py + 3, 4, PADDLE_H - 6); ctx.fillRect(px + pw - 7, py + 3, 4, PADDLE_H - 6);
      padPulse = Math.max(0, padPulse - dt);
      // balls with a trail
      s.balls.forEach((b, i) => {
        const tr = trails[i] || (trails[i] = []);
        if (!isPaused) { tr.push([b.x, b.y]); if (tr.length > 8) tr.shift(); }
        tr.forEach(([x, y], k) => { ctx.globalAlpha = (k / tr.length) * 0.35; ctx.fillStyle = '#a5f3fc'; ctx.beginPath(); ctx.arc(x, y, BALL_R * (0.5 + k / tr.length * 0.5), 0, 7); ctx.fill(); });
        ctx.globalAlpha = 1;
        glow(ctx, '#22d3ee', b.x, b.y, 14, 0.6);
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, 0, 7); ctx.fill();
      });
      trails.length = s.balls.length;
      P.draw(ctx); F.draw(ctx, isPaused ? 0 : dt);
      ctx.restore();
      // the heads-up line, lives, the launch hint
      text(ctx, 'SCORE', 14, 12, 1, { color: '#f9a8d4', glow: false });
      text(ctx, fmt(s.score), 14, 24, 2, { color: '#ffffff', glow: '#ec4899' });
      const hi = Math.max(best, s.score), beat = s.score > best && best > 0;
      text(ctx, 'HI', LW / 2, 12, 1, { color: '#f9a8d4', glow: false, align: 'center' });
      text(ctx, fmt(hi), LW / 2, 24, 2, { color: beat ? '#fde68a' : '#e2e8f0', glow: beat ? '#f59e0b' : false, align: 'center' });
      text(ctx, 'LEVEL', LW - 14, 12, 1, { color: '#f9a8d4', glow: false, align: 'right' });
      text(ctx, String(s.level), LW - 14, 24, 2, { color: '#fde68a', glow: '#f59e0b', align: 'right' });
      for (let k = 0; k < Math.max(0, s.lives - 1); k++) { ctx.fillStyle = '#ec4899'; rrect(ctx, WALL_L + 4 + k * 26, LH - 12, 20, 5, 2.5); ctx.fill(); }
      if (s.wide > 0 && s.wide < 180 && blink(T, 0.3)) text(ctx, 'WIDE', WALL_R - 4, LH - 14, 1, { color: '#38bdf8', glow: false, align: 'right' });
      if (practice) text(ctx, 'PRACTICE', WALL_R - 4, LH - 26, 1, { color: '#94a3b8', glow: false, align: 'right' });
      if (s.balls.some(b => b.stuck) && !s.deadT && blink(T, 0.9)) text(ctx, 'PRESS A OR TAP TO LAUNCH', LW / 2, PADDLE_Y + 16, 1, { color: '#fbcfe8', glow: '#ec4899', align: 'center' });
      if (banner) {
        if (!isPaused) banner.t += dt;
        if (banner.t > banner.life) banner = null;
        else if (blink(banner.t, 0.45, 0.75)) text(ctx, banner.str, LW / 2, LH / 2 + 40, 3, { color: banner.color, align: 'center' });
      }
      if (flash > 0) { ctx.fillStyle = `rgba(248,113,113,${Math.min(0.3, flash)})`; ctx.fillRect(0, 0, LW, LH); flash -= dt; }
      if (overT >= 0) {
        overT += dt;
        if (overT > 0.6) { ctx.fillStyle = 'rgba(8,4,14,0.55)'; ctx.fillRect(0, LH / 2 - 50, LW, 92); text(ctx, 'GAME OVER', LW / 2, LH / 2 - 34, 4, { color: '#fda4af', glow: '#e11d48', align: 'center' }); text(ctx, fmt(s.score), LW / 2, LH / 2 + 8, 2, { color: '#ffffff', align: 'center' }); }
      }
      if (isPaused) { ctx.fillStyle = 'rgba(8,4,14,0.6)'; ctx.fillRect(0, 0, LW, LH); text(ctx, 'PAUSED', LW / 2, LH / 2 - 10, 3, { color: '#e2e8f0', align: 'center' }); }
      crt(ctx, S);
    },
  };
}

// ------------------------------------------------------------------------------------------- the attract screen
export function cover(ctx, w, h, t, info = {}) {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1a0b2e'); g.addColorStop(1, '#0a0614');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const s = w / 240, bw = Math.round(20 * s), bh = Math.round(8 * s);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 10; c++) {
    if ((r * 3 + c + Math.floor(t * 2)) % 11 === 0) continue;
    ctx.drawImage(brickTile(ROWC[r], bw, bh, false).c, Math.round(10 * s + c * 22 * s), Math.round(h * 0.33 + r * 10 * s));
  }
  const bx = w / 2 + Math.sin(t * 1.7) * w * 0.38, by = h * 0.62 - Math.abs(Math.sin(t * 2.3)) * h * 0.1;
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(bx, by, 3 * s, 0, 7); ctx.fill();
  ctx.fillStyle = '#ec4899'; rrect(ctx, bx - 18 * s, h * 0.66, 36 * s, 6 * s, 3 * s); ctx.fill();
  text(ctx, 'BRICK', w / 2, h * 0.06, Math.round(4 * s), { color: '#fbcfe8', glow: '#ec4899', align: 'center' });
  text(ctx, 'BLITZ', w / 2, h * 0.06 + 36 * s, Math.round(4 * s), { color: '#fde68a', glow: '#f59e0b', align: 'center' });
  const top = info.top || [];
  text(ctx, 'HI-SCORES', w / 2, h * 0.72, Math.max(1, Math.round(s)), { color: '#fde68a', glow: false, align: 'center' });
  for (let i = 0; i < 3; i++) {
    const r = top[i], y = h * 0.72 + (13 + i * 11) * s;
    text(ctx, r ? `${i + 1} ${String(r.name).slice(0, 9).toUpperCase().padEnd(9, ' ')} ${fmt(r.score).padStart(7, ' ')}` : `${i + 1} ---       ------`, w / 2, y, Math.max(1, Math.round(s)), { color: i === 0 ? '#ffffff' : '#cbd5e1', glow: false, align: 'center' });
  }
  if (blink(t, 1.2)) text(ctx, 'PRESS PLAY', w / 2, h * 0.95, Math.max(1, Math.round(1.5 * s)), { color: '#86efac', glow: '#22c55e', align: 'center' });
}
