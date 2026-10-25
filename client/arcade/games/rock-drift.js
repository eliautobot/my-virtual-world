// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Rock Drift's screen (the rules: shared/arcade/games/rock-drift.js): neon vector lines on deep space, each rock its own
// jagged outline (from its id), spinning slowly; the ship's flame flickers while it thrusts; anything near an edge is
// drawn on the far side too (the field wraps). createView() is the game in the sealed box; cover() its attract screen.
import * as sim from '/shared/arcade/games/rock-drift.js';
import { makeScreen, canvas, text, glow, Particles, Shake, Floaters, Stars, crt, blink, fmt, LW, LH } from '../fx.js';

export { sim };
const { W, H, ROCK_R } = sim;
const ROCK_C = [null, '#f9a8d4', '#c4b5fd', '#7dd3fc'];
const shapes = new Map();
/** A rock's outline as unit points (its own from its id: the same rock looks the same every frame). */
function shapeOf(id) {
  let sh = shapes.get(id);
  if (!sh) {
    let h = Math.imul(id ^ 0x9e3779b9, 2654435761) >>> 0;
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
    const n = 9 + Math.floor(rnd() * 4);
    sh = Array.from({ length: n }, (_, k) => { const a = (k / n) * Math.PI * 2, r = 0.72 + rnd() * 0.32; return [Math.sin(a) * r, -Math.cos(a) * r]; });
    if (shapes.size > 400) shapes.clear();
    shapes.set(id, sh);
  }
  return sh;
}
/** Draws fn(x, y) at (x, y) and again across any edge it is within m of (the field wraps). */
function wrapped(x, y, m, fn) {
  fn(x, y);
  const xs = [x], ys = [y];
  if (x < m) xs.push(x + W); else if (x > W - m) xs.push(x - W);
  if (y < m) ys.push(y + H); else if (y > H - m) ys.push(y - H);
  for (const a of xs) for (const b of ys) if (a !== x || b !== y) fn(a, b);
}
function neon(ctx, pts, color, width = 1.4) {
  const path = () => { ctx.beginPath(); pts.forEach(([x, y], k) => ctx[k ? 'lineTo' : 'moveTo'](x, y)); ctx.closePath(); };
  ctx.lineJoin = 'round';
  path(); ctx.strokeStyle = color; ctx.globalAlpha = 0.3; ctx.lineWidth = width * 3.6; ctx.stroke();
  ctx.globalAlpha = 1; ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
}
const SHIP = [[0, -11], [8, 9], [0, 5], [-8, 9]];
function ship(ctx, x, y, ang, thrust, T, color = '#e0f2fe') {
  const a = (ang / 1024) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), tr = ([px, py]) => [x + px * c - py * s, y + px * s + py * c];
  if (thrust) { const f = 10 + (Math.floor(T * 30) & 1) * 5; neon(ctx, [[-4, 7], [0, 7 + f], [4, 7]].map(tr), '#fb923c', 1.2); }
  ctx.fillStyle = 'rgba(14,30,48,0.9)'; ctx.beginPath(); SHIP.map(tr).forEach(([px, py], k) => ctx[k ? 'lineTo' : 'moveTo'](px, py)); ctx.closePath(); ctx.fill();
  neon(ctx, SHIP.map(tr), color, 1.5);
}
function saucer(ctx, x, y, r, color) {
  const k = r / 12;
  neon(ctx, [[-12, 0], [-6, -4], [6, -4], [12, 0], [6, 4], [-6, 4]].map(([a, b]) => [x + a * k, y + b * k]), color, 1.4);
  neon(ctx, [[-5, -4], [-3, -8], [3, -8], [5, -4]].map(([a, b]) => [x + a * k, y + b * k]), color, 1.2);
}

export function createView(cv) {
  const S = makeScreen(cv), P = new Particles(800), shake = new Shake(), F = new Floaters(), stars = new Stars(120);
  let best = 0, practice = false, T = 0, banner = null, overT = -1, isPaused = false, flash = 0, neb = null, nebKey = '', rings = [];
  return {
    resize() { S.fit(); },
    pause(on) { isPaused = on; },
    reset(s, info) { best = info.best || 0; practice = info.practice; banner = { str: 'WAVE 1', t: 0, life: 1.5, color: '#a5f3fc' }; overT = -1; P.p.length = 0; rings = []; },
    event(ev) {
      switch (ev.k) {
        case 'rock': { const n = ev.size === 3 ? 26 : ev.size === 2 ? 16 : 9; P.burst(ev.x, ev.y, n, { color: [ROCK_C[ev.size], '#ffffff'], speed: 60 + ev.size * 35, life: 0.7, size: 2 }); shake.kick(ev.size); break; }
        case 'saucer': P.burst(ev.x, ev.y, 34, { color: ['#f87171', '#fde68a', '#ffffff'], speed: 180, life: 0.9 }); if (ev.pts) F.add(String(ev.pts), ev.x, ev.y - 10, { color: '#fde68a', s: 2 }); shake.kick(4); break;
        case 'die': P.burst(ev.x, ev.y, 60, { color: ['#e0f2fe', '#38bdf8', '#fb923c', '#ffffff'], speed: 160, life: 1.3, size: 2.5 }); shake.kick(9); flash = 0.3; break;
        case 'warpOut': case 'warpIn': rings.push({ x: ev.x, y: ev.y, t: 0, out: ev.k === 'warpOut' }); break;
        case 'cleared': banner = { str: 'FIELD CLEAR', t: 0, life: 1.6, color: '#86efac' }; break;
        case 'wave': banner = { str: `WAVE ${ev.wave}`, t: 0, life: 1.6, color: '#a5f3fc' }; break;
        case 'life': F.add('1UP!', LW / 2, LH - 60, { color: '#86efac', s: 2 }); break;
        case 'saucerIn': F.add(ev.small ? 'RAIDER!' : 'SAUCER', LW / 2, 70, { color: '#fda4af', s: 1, life: 1.4 }); break;
        case 'over': overT = 0; break;
        default: break;
      }
    },
    sfx(ev) { return { fire: ['laser'], rock: ['rock', ev.size], saucer: ['bigboom'], die: ['die'], warpOut: ['warp'], cleared: ['fanfare'], wave: ['level'], life: ['coin'], saucerIn: ['ufo'], sfire: ['sfire'], over: ['over'] }[ev.k] || null; },
    buzz(ev) { return ev.k === 'die' ? 180 : ev.k === 'rock' ? 6 + ev.size * 6 : 0; },
    draw(dt, s) {
      S.fit();
      const ctx = S.ctx; if (!isPaused) T += dt;
      S.begin();
      const key = `${S.cv.width}x${S.cv.height}`;
      if (key !== nebKey) {
        nebKey = key; neb = canvas(LW, LH, S.k);
        const x = neb.x; x.fillStyle = '#02030a'; x.fillRect(0, 0, LW, LH);
        for (const [cx, cy, r, c] of [[260, 120, 180, 'rgba(56,189,248,0.1)'], [90, 360, 160, 'rgba(244,114,182,0.08)']]) { const n = x.createRadialGradient(cx, cy, 0, cx, cy, r); n.addColorStop(0, c); n.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = n; x.fillRect(0, 0, LW, LH); }
      }
      ctx.drawImage(neb.c, 0, 0, LW, LH);
      stars.draw(ctx, isPaused ? 0 : dt, 4);
      if (!isPaused) { shake.update(dt); P.update(dt); }
      if (!s) { crt(ctx, S); return; }
      ctx.save(); ctx.translate(shake.x, shake.y);
      // rocks
      for (const r of s.rocks) {
        const R = ROCK_R[r.size], sh = shapeOf(r.id), a = T * 0.6 * r.spin * (4 - r.size) * 0.5, c = Math.cos(a), sn = Math.sin(a);
        wrapped(r.x, r.y, R + 2, (x, y) => {
          const pts = sh.map(([px, py]) => [x + (px * c - py * sn) * R, y + (px * sn + py * c) * R]);
          ctx.fillStyle = 'rgba(10,14,30,0.85)'; ctx.beginPath(); pts.forEach(([px, py], k) => ctx[k ? 'lineTo' : 'moveTo'](px, py)); ctx.closePath(); ctx.fill();
          neon(ctx, pts, ROCK_C[r.size], 1.6);
        });
      }
      // shots
      for (const sh of s.shots) { glow(ctx, '#a5f3fc', sh.x, sh.y, 7, 0.8); ctx.fillStyle = '#ffffff'; ctx.fillRect(sh.x - 1, sh.y - 1, 2, 2); }
      for (const sh of s.sShots) { glow(ctx, '#fb923c', sh.x, sh.y, 7, 0.8); ctx.fillStyle = '#fde68a'; ctx.fillRect(sh.x - 1, sh.y - 1, 2, 2); }
      // the saucer
      if (s.saucer) wrapped(s.saucer.x, s.saucer.y, 16, (x, y) => saucer(ctx, x, y, s.saucer.r, s.saucer.small ? '#fb7185' : '#fca5a5'));
      // the ship
      if (!s.dead && !(s.inv && Math.floor(T * 12) & 1)) wrapped(s.x, s.y, 14, (x, y) => ship(ctx, x, y, s.ang, s.thrust, T));
      // warp rings
      for (let i = rings.length - 1; i >= 0; i--) { const g = rings[i]; g.t += dt; if (g.t > 0.4) { rings.splice(i, 1); continue; } const u = g.t / 0.4; ctx.strokeStyle = '#a5f3fc'; ctx.globalAlpha = 1 - u; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(g.x, g.y, g.out ? 4 + u * 26 : 30 - u * 26, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
      P.draw(ctx); F.draw(ctx, isPaused ? 0 : dt);
      ctx.restore();
      // the heads-up line
      text(ctx, 'SCORE', 12, 12, 1, { color: '#7dd3fc', glow: false });
      text(ctx, fmt(s.score), 12, 24, 2, { color: '#ffffff', glow: '#38bdf8' });
      const hi = Math.max(best, s.score), beat = s.score > best && best > 0;
      text(ctx, 'HI', LW / 2, 12, 1, { color: '#7dd3fc', glow: false, align: 'center' });
      text(ctx, fmt(hi), LW / 2, 24, 2, { color: beat ? '#fde68a' : '#e2e8f0', glow: beat ? '#f59e0b' : false, align: 'center' });
      text(ctx, 'WAVE', LW - 12, 12, 1, { color: '#7dd3fc', glow: false, align: 'right' });
      text(ctx, String(s.wave), LW - 12, 24, 2, { color: '#a5f3fc', glow: '#38bdf8', align: 'right' });
      for (let k = 0; k < Math.max(0, s.lives - (s.dead ? 0 : 1)); k++) ship(ctx, 18 + k * 18, LH - 16, 0, false, T, '#7dd3fc');
      if (s.warp) { ctx.fillStyle = 'rgba(165,243,252,0.35)'; ctx.fillRect(LW - 62, LH - 14, 50 * (1 - s.warp / 90), 3); }
      else text(ctx, 'WARP', LW - 12, LH - 18, 1, { color: '#a5f3fc', glow: false, align: 'right' });
      if (practice) text(ctx, 'PRACTICE', LW / 2, LH - 18, 1, { color: '#94a3b8', glow: false, align: 'center' });
      if (banner) {
        if (!isPaused) banner.t += dt;
        if (banner.t > banner.life) banner = null;
        else if (blink(banner.t, 0.45, 0.75)) text(ctx, banner.str, LW / 2, LH / 2 - 60, 3, { color: banner.color, align: 'center' });
      }
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.35, flash)})`; ctx.fillRect(0, 0, LW, LH); flash -= dt; }
      if (overT >= 0) {
        overT += dt;
        if (overT > 0.6) { ctx.fillStyle = 'rgba(2,3,10,0.55)'; ctx.fillRect(0, LH / 2 - 50, LW, 92); text(ctx, 'GAME OVER', LW / 2, LH / 2 - 34, 4, { color: '#fda4af', glow: '#e11d48', align: 'center' }); text(ctx, fmt(s.score), LW / 2, LH / 2 + 8, 2, { color: '#ffffff', align: 'center' }); }
      }
      if (isPaused) { ctx.fillStyle = 'rgba(2,3,10,0.6)'; ctx.fillRect(0, 0, LW, LH); text(ctx, 'PAUSED', LW / 2, LH / 2 - 10, 3, { color: '#e2e8f0', align: 'center' }); }
      crt(ctx, S);
    },
  };
}

// ------------------------------------------------------------------------------------------- the attract screen
export function cover(ctx, w, h, t, info = {}) {
  ctx.fillStyle = '#02030a'; ctx.fillRect(0, 0, w, h);
  const s = w / 240;
  for (let i = 0; i < 50; i++) { ctx.fillStyle = i % 4 ? '#475569' : '#e2e8f0'; ctx.fillRect((i * 89) % w, (i * 57) % h, 1, 1); }
  for (let i = 0; i < 6; i++) {
    const R = [22, 14, 9][i % 3] * s, x = ((i * 53 + t * (8 + i * 3) * s) % (w + 60)) - 30, y = h * 0.3 + ((i * 71) % (h * 0.4)), sh = shapeOf(i + 1), a = t * (0.3 + i * 0.1);
    neon(ctx, sh.map(([px, py]) => [x + (px * Math.cos(a) - py * Math.sin(a)) * R, y + (px * Math.sin(a) + py * Math.cos(a)) * R]), ROCK_C[3 - (i % 3)], 1.2);
  }
  ship(ctx, w / 2, h * 0.58, Math.floor(t * 120) & 1023, Math.floor(t * 2) % 3 === 0, t);
  text(ctx, 'ROCK', w / 2, h * 0.06, Math.round(4 * s), { color: '#bae6fd', glow: '#38bdf8', align: 'center' });
  text(ctx, 'DRIFT', w / 2, h * 0.06 + 36 * s, Math.round(4 * s), { color: '#fed7aa', glow: '#f97316', align: 'center' });
  const top = info.top || [];
  text(ctx, 'HI-SCORES', w / 2, h * 0.7, Math.max(1, Math.round(s)), { color: '#fde68a', glow: false, align: 'center' });
  for (let i = 0; i < 3; i++) {
    const r = top[i], y = h * 0.7 + (13 + i * 11) * s;
    text(ctx, r ? `${i + 1} ${String(r.name).slice(0, 9).toUpperCase().padEnd(9, ' ')} ${fmt(r.score).padStart(7, ' ')}` : `${i + 1} ---       ------`, w / 2, y, Math.max(1, Math.round(s)), { color: i === 0 ? '#ffffff' : '#cbd5e1', glow: false, align: 'center' });
  }
  if (blink(t, 1.2)) text(ctx, 'PRESS PLAY', w / 2, h * 0.94, Math.max(1, Math.round(1.5 * s)), { color: '#86efac', glow: '#22c55e', align: 'center' });
}
