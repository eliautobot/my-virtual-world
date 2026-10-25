// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Road Hopper's screen (the rules: shared/arcade/games/road-hopper.js): the start kerb, five lanes of traffic with their
// lane lines and headlights, a planted median, a river with drifting logs and glow-rafts (fading as they sink), and the
// five portals on the far bank (a firefly visits them). The hopper is our own little round bot, squashing and leaping
// from cell to cell. createView() is the game in the sealed box; cover() its attract screen on the cabinets.
import * as sim from '/shared/arcade/games/road-hopper.js';
import { makeScreen, canvas, text, glow, Particles, Shake, Floaters, crt, blink, fmt, rrect, shade, LW, LH } from '../fx.js';

export { sim };
const { CELL, COLS, ROWS, X0, Y0, PORTALS, RIVER, MEDIAN, ROAD, START, colX, rowY, afloat, sinking } = sim;
const CAR_C = ['#f43f5e', '#38bdf8', '#facc15', '#a78bfa', '#fb923c', '#2dd4bf'];
const top = r => Y0 + r * CELL;

function backdrop(S) {
  const b = canvas(LW, LH, S.k), x = b.x;
  x.fillStyle = '#05060f'; x.fillRect(0, 0, LW, LH);
  // the far bank and its portal bays
  x.fillStyle = '#14532d'; x.fillRect(X0, top(0), COLS * CELL, CELL);
  x.fillStyle = '#166534'; for (let c = 0; c < COLS; c++) if (!PORTALS.includes(c)) { rrect(x, X0 + c * CELL + 2, top(0) + 3, CELL - 4, CELL - 6, 6); x.fill(); }
  // the river
  const rg = x.createLinearGradient(0, top(1), 0, top(6)); rg.addColorStop(0, '#0c4a6e'); rg.addColorStop(1, '#082f49');
  x.fillStyle = rg; x.fillRect(X0, top(1), COLS * CELL, CELL * 5);
  // the median and the start kerb
  for (const r of [MEDIAN, START]) {
    x.fillStyle = '#3b0764'; x.fillRect(X0, top(r), COLS * CELL, CELL);
    x.fillStyle = '#581c87'; for (let c = 0; c < COLS * 2; c++) if (c % 2) x.fillRect(X0 + c * (CELL / 2), top(r) + 2, CELL / 2 - 1, CELL - 4);
    x.fillStyle = '#a855f7'; x.fillRect(X0, top(r), COLS * CELL, 1.5); x.fillRect(X0, top(r) + CELL - 1.5, COLS * CELL, 1.5);
  }
  // the road and its lane lines
  x.fillStyle = '#111318'; x.fillRect(X0, top(ROAD[0]), COLS * CELL, CELL * ROAD.length);
  x.fillStyle = 'rgba(250,250,250,0.25)';
  for (let r = ROAD[0] + 1; r <= ROAD[ROAD.length - 1]; r++) for (let px = X0 + 6; px < X0 + COLS * CELL; px += 26) x.fillRect(px, top(r) - 1, 12, 2);
  return b;
}
function car(ctx, o, row, dir) {
  const y = top(row) + 5, h = CELL - 10, col = CAR_C[(row * 3 + Math.floor((o.x + 1000) / 97)) % CAR_C.length];
  if (o.kind === 'truck') {
    const cab = dir > 0 ? o.x + o.len - 18 : o.x;
    ctx.fillStyle = '#cbd5e1'; rrect(ctx, dir > 0 ? o.x : o.x + 18, y, o.len - 18, h, 3); ctx.fill();
    ctx.fillStyle = col; rrect(ctx, cab, y + 1, 18, h - 2, 4); ctx.fill();
    ctx.fillStyle = '#0f172a'; ctx.fillRect(dir > 0 ? cab + 11 : cab + 3, y + 4, 4, h - 8);
  } else {
    const racer = o.kind === 'racer';
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, shade(racer ? '#e879f9' : col, 0.3)); g.addColorStop(1, shade(racer ? '#e879f9' : col, -0.35));
    ctx.fillStyle = g; rrect(ctx, o.x, y + (racer ? 2 : 0), o.len, h - (racer ? 4 : 0), racer ? 7 : 5); ctx.fill();
    ctx.fillStyle = 'rgba(15,23,42,0.85)'; ctx.fillRect(dir > 0 ? o.x + o.len - 13 : o.x + 6, y + 4, 7, h - 8);
    if (racer) glow(ctx, '#e879f9', o.x + o.len / 2, y + h / 2, 22, 0.35);
  }
  // headlights ahead, tail lights behind
  const fx = dir > 0 ? o.x + o.len : o.x, bx = dir > 0 ? o.x : o.x + o.len;
  ctx.fillStyle = '#fef9c3'; ctx.fillRect(fx - (dir > 0 ? 2 : 0), y + 2, 2, 3); ctx.fillRect(fx - (dir > 0 ? 2 : 0), y + h - 5, 2, 3);
  glow(ctx, '#fde68a', fx + dir * 6, y + h / 2, 12, 0.25);
  ctx.fillStyle = '#ef4444'; ctx.fillRect(bx - (dir > 0 ? 0 : 2), y + 2, 2, 3); ctx.fillRect(bx - (dir > 0 ? 0 : 2), y + h - 5, 2, 3);
}
function floater(ctx, s, o, row, T) {
  const y = top(row) + 4, h = CELL - 8;
  if (o.kind === 'log') {
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#a16207'); g.addColorStop(0.5, '#854d0e'); g.addColorStop(1, '#422006');
    ctx.fillStyle = g; rrect(ctx, o.x, y, o.len, h, h / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(66,32,6,0.8)'; ctx.lineWidth = 1;
    for (let k = 12; k < o.len - 8; k += 17) { ctx.beginPath(); ctx.moveTo(o.x + k, y + 4); ctx.lineTo(o.x + k + 7, y + 4); ctx.moveTo(o.x + k + 4, y + h - 5); ctx.lineTo(o.x + k + 11, y + h - 5); ctx.stroke(); }
    ctx.fillStyle = '#ca8a04'; ctx.beginPath(); ctx.ellipse(o.x + o.len - 4, y + h / 2, 3, h / 2 - 1, 0, 0, 7); ctx.fill();
  } else {
    const up = afloat(s, o), sink = sinking(s, o), a = !up ? 0.18 : sink ? 0.45 + 0.4 * (Math.floor(T * 10) & 1) : 1;
    ctx.globalAlpha = a;
    for (let k = 0; k * 23 < o.len - 6; k++) {
      const cx = o.x + 12 + k * 23, pu = 1 + Math.sin(T * 4 + k) * 0.06;
      glow(ctx, '#f472b6', cx, y + h / 2, 16, 0.35 * a);
      ctx.fillStyle = '#f9a8d4'; ctx.beginPath(); ctx.ellipse(cx, y + h / 2, 10 * pu, h / 2 - 1, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#fdf2f8'; ctx.beginPath(); ctx.ellipse(cx - 3, y + h / 2 - 3, 3, 2, 0, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
/** Our hopper bot: a round green body, two big eyes, an antenna; f: facing (0 up, 1 right, 2 down, 3 left). */
function hopper(ctx, x, y, f, squash, dead, T) {
  ctx.save(); ctx.translate(x, y); ctx.rotate((f * Math.PI) / 2);
  const sx = 1 + squash * 0.18, sy = 1 - squash * 0.18;
  glow(ctx, '#a3e635', 0, 0, 20, 0.35);
  ctx.fillStyle = '#65a30d'; ctx.beginPath(); ctx.ellipse(-8 * sx, 7, 4, 3, 0, 0, 7); ctx.ellipse(8 * sx, 7, 4, 3, 0, 0, 7); ctx.fill();
  const g = ctx.createRadialGradient(-3, -4, 1, 0, 0, 12); g.addColorStop(0, '#d9f99d'); g.addColorStop(1, '#4d7c0f');
  ctx.fillStyle = dead ? '#64748b' : g; ctx.beginPath(); ctx.ellipse(0, 0, 10 * sx, 10 * sy, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = '#d9f99d'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, -9 * sy); ctx.lineTo(0, -14 * sy); ctx.stroke();
  ctx.fillStyle = Math.floor(T * 4) & 1 ? '#f472b6' : '#fde68a'; ctx.beginPath(); ctx.arc(0, -15 * sy, 1.8, 0, 7); ctx.fill();
  for (const sg of [-1, 1]) {
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(sg * 4.5, -3 * sy, 3.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#0f172a';
    if (dead) { ctx.fillRect(sg * 4.5 - 2, -3.5 * sy, 4, 1); } else { ctx.beginPath(); ctx.arc(sg * 4.5, -4 * sy, 1.8, 0, 7); ctx.fill(); }
  }
  ctx.restore();
}

export function createView(cv) {
  const S = makeScreen(cv), P = new Particles(600), shake = new Shake(), F = new Floaters();
  let bg = null, bgKey = '', best = 0, practice = false, T = 0, banner = null, overT = -1, isPaused = false, deadAt = null, waves = 0;
  return {
    resize() { S.fit(); },
    pause(on) { isPaused = on; },
    reset(s, info) { best = info.best || 0; practice = info.practice; banner = { str: 'HOP!', t: 0, life: 1, color: '#d9f99d' }; overT = -1; P.p.length = 0; deadAt = null; },
    event(ev) {
      switch (ev.k) {
        case 'die':
          deadAt = { x: ev.x, y: ev.y, why: ev.why, t: 0 };
          if (ev.why === 'water' || ev.why === 'edge') P.burst(ev.x, ev.y, 26, { color: ['#7dd3fc', '#e0f2fe', '#38bdf8'], speed: 110, life: 0.7, gravity: 160 });
          else if (ev.why === 'road') { P.burst(ev.x, ev.y, 30, { color: ['#a3e635', '#d9f99d', '#ffffff'], speed: 150, life: 0.6 }); shake.kick(6); }
          else P.burst(ev.x, ev.y, 18, { color: ['#94a3b8', '#e2e8f0'], speed: 80, life: 0.8 });
          break;
        case 'home': F.add(`+${ev.pts}`, colX(PORTALS[ev.i]), top(0) + 6, { color: '#fde68a', s: 2 }); P.burst(colX(PORTALS[ev.i]), rowY(0), 26, { color: ['#a3e635', '#fde68a', '#ffffff'], speed: 130, life: 0.7 }); break;
        case 'cleared': banner = { str: 'ALL HOME!', t: 0, life: 1.8, color: '#fde68a' }; F.add('+1000', LW / 2, LH / 2, { color: '#fde68a', s: 2 }); break;
        case 'level': banner = { str: `LEVEL ${ev.level}`, t: 0, life: 1.5, color: '#d9f99d' }; break;
        case 'life': F.add('1UP!', LW / 2, LH - 60, { color: '#86efac', s: 2 }); break;
        case 'over': overT = 0; break;
        default: break;
      }
    },
    sfx(ev) { return { hop: ['hop'], home: ['home'], cleared: ['fanfare'], level: ['level'], life: ['coin'], over: ['over'], die: [ev.why === 'water' || ev.why === 'edge' ? 'splash' : ev.why === 'road' ? 'squish' : 'lost'] }[ev.k] || null; },
    buzz(ev) { return ev.k === 'die' ? 140 : ev.k === 'home' ? 30 : ev.k === 'hop' ? 5 : 0; },
    draw(dt, s) {
      S.fit();
      const ctx = S.ctx; if (!isPaused) T += dt;
      const key = `${S.cv.width}x${S.cv.height}`;
      if (key !== bgKey) { bg = backdrop(S); bgKey = key; }
      S.begin();
      if (!isPaused) { shake.update(dt); P.update(dt); waves = (waves + dt * 14) % 24; }
      ctx.drawImage(bg.c, 0, 0, LW, LH);
      if (!s) { crt(ctx, S); return; }
      ctx.save(); ctx.translate(shake.x, shake.y);
      ctx.save(); ctx.beginPath(); ctx.rect(X0, Y0, COLS * CELL, ROWS * CELL); ctx.clip();
      // the river's ripples
      ctx.strokeStyle = 'rgba(125,211,252,0.18)'; ctx.lineWidth = 1;
      for (const r of RIVER) { const d = s.lanes[r].dir; for (let px = X0 - 24 + ((d * waves) % 24 + 24) % 24; px < X0 + COLS * CELL; px += 24) { ctx.beginPath(); ctx.moveTo(px, top(r) + CELL / 2 + 6); ctx.quadraticCurveTo(px + 6, top(r) + CELL / 2 + 3, px + 12, top(r) + CELL / 2 + 6); ctx.stroke(); } }
      // portals, filled ones with a happy hopper, the firefly
      PORTALS.forEach((c, i) => {
        const x = colX(c), y = rowY(0);
        glow(ctx, s.filled[i] ? '#a3e635' : '#22d3ee', x, y, 22, 0.45);
        ctx.strokeStyle = s.filled[i] ? '#bef264' : '#67e8f9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y, 12, 10, 0, 0, 7); ctx.stroke();
        if (s.filled[i]) hopper(ctx, x, y + 1, 2, 0, false, T);
        if (s.fly?.i === i) { const fy = y + Math.sin(T * 6) * 3; glow(ctx, '#fde047', x, fy, 14, 0.9); ctx.fillStyle = '#fef9c3'; ctx.beginPath(); ctx.arc(x, fy, 2.5, 0, 7); ctx.fill(); }
      });
      for (const r of [...RIVER, ...ROAD]) { const L = s.lanes[r]; for (const o of L.objs) { if (o.x > X0 + COLS * CELL || o.x + o.len < X0) continue; if (RIVER.includes(r)) floater(ctx, s, o, r, T); else car(ctx, o, r, L.dir); } }
      // the hopper: leaping between cells, or what is left of it
      if (s.dead && deadAt) {
        deadAt.t += isPaused ? 0 : dt;
        if (deadAt.why === 'road' || deadAt.why === 'time' || deadAt.why === 'full' || deadAt.why === 'bank') hopper(ctx, deadAt.x, deadAt.y, s.facing, deadAt.why === 'road' ? 1 : 0, true, T);
        else { ctx.strokeStyle = '#bae6fd'; ctx.globalAlpha = Math.max(0, 1 - deadAt.t); ctx.beginPath(); ctx.arc(deadAt.x, deadAt.y, 6 + deadAt.t * 18, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
      } else if (!s.dead) {
        let x = s.x, y = rowY(s.row), sq = 0;
        if (s.hop) { const u = s.hop.t / 7; x += s.hop.dx * CELL * u; y += s.hop.dy * CELL * u - Math.sin(u * Math.PI) * 7; sq = -0.6 * Math.sin(u * Math.PI); }
        hopper(ctx, x, y, s.facing, sq, false, T);
      }
      ctx.restore();
      P.draw(ctx); F.draw(ctx, isPaused ? 0 : dt);
      ctx.restore();
      // the heads-up line and the clock
      text(ctx, 'SCORE', 12, 10, 1, { color: '#bef264', glow: false });
      text(ctx, fmt(s.score), 12, 22, 2, { color: '#ffffff', glow: '#65a30d' });
      const hi = Math.max(best, s.score), beat = s.score > best && best > 0;
      text(ctx, 'HI', LW / 2, 10, 1, { color: '#bef264', glow: false, align: 'center' });
      text(ctx, fmt(hi), LW / 2, 22, 2, { color: beat ? '#fde68a' : '#e2e8f0', glow: beat ? '#f59e0b' : false, align: 'center' });
      text(ctx, 'LEVEL', LW - 12, 10, 1, { color: '#bef264', glow: false, align: 'right' });
      text(ctx, String(s.level), LW - 12, 22, 2, { color: '#d9f99d', glow: '#65a30d', align: 'right' });
      const u = Math.max(0, s.time / 3600), bw = 150;
      ctx.fillStyle = 'rgba(148,163,184,0.25)'; ctx.fillRect(LW - 12 - bw, LH - 8, bw, 4);
      ctx.fillStyle = u > 0.3 ? '#84cc16' : blink(T, 0.4) ? '#f43f5e' : '#fb7185'; ctx.fillRect(LW - 12 - bw * u, LH - 8, bw * u, 4);
      text(ctx, 'TIME', LW - 16 - bw, LH - 10, 1, { color: '#a3e635', glow: false, align: 'right' });
      for (let k = 0; k < Math.max(0, s.lives - (s.dead ? 0 : 1)); k++) { ctx.save(); ctx.translate(14 + k * 14, LH - 6); ctx.scale(0.45, 0.45); hopper(ctx, 0, 0, 0, 0, false, 0); ctx.restore(); }
      if (practice) text(ctx, 'PRACTICE', LW / 2, LH - 10, 1, { color: '#94a3b8', glow: false, align: 'center' });
      if (banner) {
        if (!isPaused) banner.t += dt;
        if (banner.t > banner.life) banner = null;
        else if (blink(banner.t, 0.45, 0.75)) text(ctx, banner.str, LW / 2, rowY(MEDIAN) - 10, 3, { color: banner.color, align: 'center' });
      }
      if (overT >= 0) {
        overT += dt;
        if (overT > 0.6) { ctx.fillStyle = 'rgba(2,3,10,0.6)'; ctx.fillRect(0, LH / 2 - 50, LW, 92); text(ctx, 'GAME OVER', LW / 2, LH / 2 - 34, 4, { color: '#fda4af', glow: '#e11d48', align: 'center' }); text(ctx, fmt(s.score), LW / 2, LH / 2 + 8, 2, { color: '#ffffff', align: 'center' }); }
      }
      if (isPaused) { ctx.fillStyle = 'rgba(2,3,10,0.6)'; ctx.fillRect(0, 0, LW, LH); text(ctx, 'PAUSED', LW / 2, LH / 2 - 10, 3, { color: '#e2e8f0', align: 'center' }); }
      crt(ctx, S);
    },
  };
}

// ------------------------------------------------------------------------------------------- the attract screen
export function cover(ctx, w, h, t, info = {}) {
  ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, w, h);
  const s = w / 240, lane = 18 * s, y0 = h * 0.3;
  ctx.fillStyle = '#0c4a6e'; ctx.fillRect(0, y0, w, lane * 2);
  ctx.fillStyle = '#3b0764'; ctx.fillRect(0, y0 + lane * 2, w, lane);
  ctx.fillStyle = '#111318'; ctx.fillRect(0, y0 + lane * 3, w, lane * 3);
  for (let k = 0; k < 3; k++) {
    const dir = k % 2 ? 1 : -1, x = ((dir * t * (30 + k * 18) * s) % (w + 60) + w + 60) % (w + 60) - 30;
    ctx.fillStyle = CAR_C[k]; rrect(ctx, x, y0 + lane * (3 + k) + 3 * s, 24 * s, lane - 6 * s, 4 * s); ctx.fill();
    const lx = ((-dir * t * 20 * s) % (w + 80) + w + 80) % (w + 80) - 40;
    if (k < 2) { ctx.fillStyle = '#854d0e'; rrect(ctx, lx, y0 + lane * k + 3 * s, 60 * s, lane - 6 * s, 6 * s); ctx.fill(); }
  }
  const hp = (t * 1.2) % 1;
  hopper(ctx, w / 2, y0 + lane * 6.5 - hp * lane * 6, 0, Math.sin(hp * 30) * 0.3, false, t);
  text(ctx, 'ROAD', w / 2, h * 0.05, Math.round(4 * s), { color: '#d9f99d', glow: '#65a30d', align: 'center' });
  text(ctx, 'HOPPER', w / 2, h * 0.05 + 36 * s, Math.round(4 * s), { color: '#bae6fd', glow: '#38bdf8', align: 'center' });
  const top3 = info.top || [];
  text(ctx, 'HI-SCORES', w / 2, h * 0.72, Math.max(1, Math.round(s)), { color: '#fde68a', glow: false, align: 'center' });
  for (let i = 0; i < 3; i++) {
    const r = top3[i], y = h * 0.72 + (13 + i * 11) * s;
    text(ctx, r ? `${i + 1} ${String(r.name).slice(0, 9).toUpperCase().padEnd(9, ' ')} ${fmt(r.score).padStart(7, ' ')}` : `${i + 1} ---       ------`, w / 2, y, Math.max(1, Math.round(s)), { color: i === 0 ? '#ffffff' : '#cbd5e1', glow: false, align: 'center' });
  }
  if (blink(t, 1.2)) text(ctx, 'PRESS PLAY', w / 2, h * 0.95, Math.max(1, Math.round(1.5 * s)), { color: '#86efac', glow: '#22c55e', align: 'center' });
}
