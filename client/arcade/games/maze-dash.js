// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Maze Dash's screen (the rules: shared/arcade/games/maze-dash.js): a neon maze (its walls drawn once, edged where they
// meet the corridors), glowing sparks and pulsing power cores, Zip (a round glowing bot with a visor looking the way it
// goes, a trail behind it) and the four drones: hovering, each its own colour with one big eye; blue and wavering when
// a core is running (flickering white as it runs out), only eyes when caught. createView() is the game in the sealed
// box; cover() its attract screen on the cabinets.
import * as sim from '/shared/arcade/games/maze-dash.js';
import { makeScreen, canvas, text, glow, Particles, Shake, Floaters, crt, blink, fmt, LW, LH } from '../fx.js';

export { sim };
const { MAZE, COLS, ROWS, CELL, DX, DY, posOf, dronePos } = sim;
const MX = (LW - COLS * CELL) / 2, MY = 56;
const DRONE_C = ['#f43f5e', '#e879f9', '#34d399', '#fb923c'];
const wall = (c, r) => r >= 0 && r < ROWS && c >= 0 && c < COLS && MAZE[r][c] === '#';

function mazeArt(S, col = '#3b82f6') {
  const b = canvas(LW, LH, S.k), x = b.x;
  x.fillStyle = '#03040d'; x.fillRect(0, 0, LW, LH);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (wall(c, r)) { x.fillStyle = '#0a0f2e'; x.fillRect(MX + c * CELL, MY + r * CELL, CELL, CELL); }
  x.save(); x.shadowColor = col; x.shadowBlur = 8 * S.k; x.strokeStyle = col; x.lineWidth = 2; x.lineCap = 'round';
  x.beginPath();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!wall(c, r)) continue;
    const X = MX + c * CELL, Y = MY + r * CELL, ins = 3;
    // an edge where the wall meets the open maze (inset, so walls look like thick neon tubes)
    const openAt = (dc, dr) => { const ch = (r + dr >= 0 && r + dr < ROWS && c + dc >= 0 && c + dc < COLS) ? MAZE[r + dr][c + dc] : ' '; return ch !== '#' && !(ch === ' ' && (r + dr === 7 || r + dr === 11) && (c + dc < 3 || c + dc > 15)); };
    if (openAt(0, -1)) { x.moveTo(X, Y + ins); x.lineTo(X + CELL, Y + ins); }
    if (openAt(0, 1)) { x.moveTo(X, Y + CELL - ins); x.lineTo(X + CELL, Y + CELL - ins); }
    if (openAt(-1, 0)) { x.moveTo(X + ins, Y); x.lineTo(X + ins, Y + CELL); }
    if (openAt(1, 0)) { x.moveTo(X + CELL - ins, Y); x.lineTo(X + CELL - ins, Y + CELL); }
  }
  x.stroke(); x.restore();
  // the drones' door
  x.fillStyle = '#f9a8d4'; x.fillRect(MX + 9 * CELL + 2, MY + 8 * CELL + CELL / 2 - 1.5, CELL - 4, 3);
  return b;
}
function zipArt(ctx, x, y, dir, T, r = 7.5) {
  glow(ctx, '#22d3ee', x, y, 20, 0.55);
  const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, r); g.addColorStop(0, '#ecfeff'); g.addColorStop(0.6, '#22d3ee'); g.addColorStop(1, '#0e7490');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  const dx = DX[dir], dy = DY[dir];
  ctx.fillStyle = '#082f49'; ctx.beginPath(); ctx.ellipse(x + dx * 2.8, y + dy * 2.8, dy ? 4.6 : 2.4, dx ? 4.6 : 2.4, 0, 0, 7); ctx.fill();
  ctx.fillStyle = Math.floor(T * 6) & 1 ? '#fde68a' : '#ffffff'; ctx.fillRect(x + dx * 3.6 - 1, y + dy * 3.6 - 1, 2, 2);
}
function droneArt(ctx, x, y, k, d, T, power) {
  const bob = Math.sin(T * 5 + k) * 1.5;
  if (d.state === 'eyes') { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); ctx.fillStyle = '#1e3a8a'; ctx.beginPath(); ctx.arc(x + DX[d.dir] * 1.6, y + DY[d.dir] * 1.6, 2, 0, 7); ctx.fill(); return; }
  const scared = d.scared, ending = scared && power < 120 && Math.floor(T * 8) & 1;
  const col = scared ? (ending ? '#e2e8f0' : '#2563eb') : DRONE_C[k];
  y += bob;
  glow(ctx, col, x, y, 18, 0.45);
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - 8.5); ctx.quadraticCurveTo(x + 9, y - 6, x + 8, y + 3); ctx.lineTo(x + 4, y + 7); ctx.lineTo(x, y + 4); ctx.lineTo(x - 4, y + 7); ctx.lineTo(x - 8, y + 3); ctx.quadraticCurveTo(x - 9, y - 6, x, y - 8.5); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(x - 3, y - 4, 2.5, 1.5, -0.5, 0, 7); ctx.fill();
  if (scared) { ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 1.2; ctx.beginPath(); for (let i = 0; i <= 6; i++) ctx[i ? 'lineTo' : 'moveTo'](x - 5 + i * (10 / 6), y + 1 + (i & 1 ? 1.5 : -1)); ctx.stroke(); }
  else { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y - 1, 3.6, 0, 7); ctx.fill(); ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.arc(x + DX[d.dir] * 1.5, y - 1 + DY[d.dir] * 1.5, 1.8, 0, 7); ctx.fill(); }
  ctx.fillStyle = scared ? '#93c5fd' : '#fde68a'; ctx.globalAlpha = 0.5 + Math.sin(T * 20 + k) * 0.3; ctx.fillRect(x - 1, y + 7, 2, 2); ctx.globalAlpha = 1;
}

export function createView(cv) {
  const S = makeScreen(cv), P = new Particles(500), shake = new Shake(), F = new Floaters();
  let art = null, artW = null, key = '', best = 0, practice = false, T = 0, banner = null, overT = -1, isPaused = false, dieAt = null, flashT = 0, trail = [], sparkN = 0;
  return {
    resize() { S.fit(); },
    pause(on) { isPaused = on; },
    reset(s, info) { best = info.best || 0; practice = info.practice; overT = -1; P.p.length = 0; dieAt = null; trail = []; banner = null; },
    event(ev) {
      switch (ev.k) {
        case 'power': P.burst(MX + ev.c * CELL + CELL / 2, MY + ev.r * CELL + CELL / 2, 24, { color: ['#fde68a', '#ffffff', '#22d3ee'], speed: 140, life: 0.6 }); shake.kick(2); break;
        case 'catch': F.add(String(ev.pts), MX + ev.x, MY + ev.y - 8, { color: '#93c5fd', s: 2 }); P.burst(MX + ev.x, MY + ev.y, 20, { color: ['#93c5fd', '#ffffff'], speed: 120, life: 0.5 }); break;
        case 'die': dieAt = { x: MX + ev.x, y: MY + ev.y, t: 0 }; P.burst(MX + ev.x, MY + ev.y, 40, { color: ['#22d3ee', '#ecfeff', '#f43f5e'], speed: 150, life: 1 }); shake.kick(6); break;
        case 'chip': F.add(String(ev.pts), MX + 9 * CELL + CELL / 2, MY + 11 * CELL, { color: '#fde68a', s: 2 }); break;
        case 'cleared': flashT = 2.4; break;
        case 'level': banner = { str: `LEVEL ${ev.level}`, t: 0, life: 1.6 }; break;
        case 'life': F.add('1UP!', LW / 2, LH - 60, { color: '#86efac', s: 2 }); break;
        case 'over': overT = 0; break;
        default: break;
      }
    },
    sfx(ev) {
      if (ev.k === 'spark') return ['spark', sparkN++];
      return { power: ['core'], catch: ['catch', 0], die: ['die'], chip: ['chip'], cleared: ['fanfare'], level: ['level'], life: ['coin'], go: ['go'], chipIn: ['coin'], over: ['over'] }[ev.k] || null;
    },
    buzz(ev) { return ev.k === 'die' ? 160 : ev.k === 'catch' ? 30 : ev.k === 'power' ? 20 : 0; },
    draw(dt, s) {
      S.fit();
      const ctx = S.ctx; if (!isPaused) T += dt;
      const k2 = `${S.cv.width}x${S.cv.height}`;
      if (k2 !== key) { key = k2; art = mazeArt(S); artW = mazeArt(S, '#e0f2fe'); }
      S.begin();
      if (!isPaused) { shake.update(dt); P.update(dt); }
      const white = flashT > 0 && Math.floor(flashT * 5) & 1;
      if (flashT > 0 && !isPaused) flashT -= dt;
      ctx.drawImage((white ? artW : art).c, 0, 0, LW, LH);
      if (!s) { crt(ctx, S); return; }
      ctx.save(); ctx.translate(shake.x, shake.y);
      // sparks and power cores
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const v = s.dots[r * COLS + c]; if (!v) continue;
        const x = MX + c * CELL + CELL / 2, y = MY + r * CELL + CELL / 2;
        if (v === 1) { ctx.fillStyle = '#fef3c7'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); }
        else { const pu = 4.5 + Math.sin(T * 6) * 1.2; glow(ctx, '#fde68a', x, y, 16, 0.6); ctx.fillStyle = '#fef9c3'; ctx.beginPath(); ctx.arc(x, y, pu, 0, 7); ctx.fill(); }
      }
      if (s.chip) { const x = MX + 9 * CELL + CELL / 2, y = MY + 11 * CELL + CELL / 2; glow(ctx, '#a78bfa', x, y, 16, 0.7); ctx.fillStyle = '#c4b5fd'; ctx.fillRect(x - 5, y - 4, 10, 8); ctx.fillStyle = '#4c1d95'; ctx.fillRect(x - 3, y - 2, 6, 4); ctx.fillStyle = '#fde68a'; for (let i = -1; i <= 1; i++) { ctx.fillRect(x + i * 3 - 0.5, y - 6, 1, 2); ctx.fillRect(x + i * 3 - 0.5, y + 4, 1, 2); } }
      // the drones
      s.drones.forEach((d, k) => { const [x, y] = dronePos(d); droneArt(ctx, MX + x, MY + y, k, d, T, s.power); });
      // Zip and its trail
      if (!s.deadT) {
        const [x, y] = posOf(s.zip);
        if (!isPaused) { trail.push([MX + x, MY + y]); if (trail.length > 7) trail.shift(); }
        trail.forEach(([tx, ty], i) => { ctx.globalAlpha = (i / trail.length) * 0.3; ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(tx, ty, 2 + i * 0.6, 0, 7); ctx.fill(); });
        ctx.globalAlpha = 1;
        zipArt(ctx, MX + x, MY + y, s.zip.dir, T);
      } else if (dieAt) { dieAt.t += dt; const u = Math.min(1, dieAt.t / 0.8); ctx.globalAlpha = 1 - u; zipArt(ctx, dieAt.x, dieAt.y, 0, T, 7.5 * (1 - u * 0.8)); ctx.globalAlpha = 1; }
      P.draw(ctx); F.draw(ctx, isPaused ? 0 : dt);
      ctx.restore();
      // the heads-up line
      text(ctx, 'SCORE', 12, 10, 1, { color: '#93c5fd', glow: false });
      text(ctx, fmt(s.score), 12, 22, 2, { color: '#ffffff', glow: '#3b82f6' });
      const hi = Math.max(best, s.score), beat = s.score > best && best > 0;
      text(ctx, 'HI', LW / 2, 10, 1, { color: '#93c5fd', glow: false, align: 'center' });
      text(ctx, fmt(hi), LW / 2, 22, 2, { color: beat ? '#fde68a' : '#e2e8f0', glow: beat ? '#f59e0b' : false, align: 'center' });
      text(ctx, 'LEVEL', LW - 12, 10, 1, { color: '#93c5fd', glow: false, align: 'right' });
      text(ctx, String(s.level), LW - 12, 22, 2, { color: '#a5f3fc', glow: '#22d3ee', align: 'right' });
      for (let i = 0; i < Math.max(0, s.lives - (s.deadT ? 0 : 1)); i++) zipArt(ctx, 18 + i * 18, LH - 22, 1, 0, 6);
      if (practice) text(ctx, 'PRACTICE', LW - 12, LH - 26, 1, { color: '#94a3b8', glow: false, align: 'right' });
      if (s.readyT > 0 && blink(T, 0.5, 0.7)) text(ctx, 'READY!', LW / 2, MY + 11 * CELL + 5, 2, { color: '#fde68a', glow: '#f59e0b', align: 'center' });
      if (banner) { banner.t += isPaused ? 0 : dt; if (banner.t > banner.life) banner = null; else text(ctx, banner.str, LW / 2, MY + 11 * CELL + 5, 2, { color: '#a5f3fc', align: 'center' }); }
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
  ctx.fillStyle = '#03040d'; ctx.fillRect(0, 0, w, h);
  const s = w / 240, y = h * 0.5;
  ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2 * s; ctx.shadowColor = '#3b82f6'; ctx.shadowBlur = 6;
  ctx.strokeRect(8 * s, y - 22 * s, w - 16 * s, 44 * s); ctx.shadowBlur = 0;
  const px = ((t * 50 * s) % (w + 120 * s)) - 60 * s;
  for (let i = 0; i < 12; i++) { const dx = 14 * s + i * 19 * s; if (dx > px) { ctx.fillStyle = '#fef3c7'; ctx.fillRect(dx - 1.5, y - 1.5, 3, 3); } }
  ctx.save(); ctx.translate(px, y); ctx.scale(s, s); zipArt(ctx, 0, 0, 1, t); ctx.restore();
  for (let k = 0; k < 4; k++) { ctx.save(); ctx.translate(px - (26 + k * 22) * s, y); ctx.scale(s, s); droneArt(ctx, 0, 0, k, { state: 'active', dir: 1, scared: 0 }, t, 0); ctx.restore(); }
  text(ctx, 'MAZE', w / 2, h * 0.08, Math.round(4 * s), { color: '#a5f3fc', glow: '#22d3ee', align: 'center' });
  text(ctx, 'DASH', w / 2, h * 0.08 + 36 * s, Math.round(4 * s), { color: '#f5d0fe', glow: '#e879f9', align: 'center' });
  const top = info.top || [];
  text(ctx, 'HI-SCORES', w / 2, h * 0.7, Math.max(1, Math.round(s)), { color: '#fde68a', glow: false, align: 'center' });
  for (let i = 0; i < 3; i++) {
    const r = top[i], yy = h * 0.7 + (13 + i * 11) * s;
    text(ctx, r ? `${i + 1} ${String(r.name).slice(0, 9).toUpperCase().padEnd(9, ' ')} ${fmt(r.score).padStart(7, ' ')}` : `${i + 1} ---       ------`, w / 2, yy, Math.max(1, Math.round(s)), { color: i === 0 ? '#ffffff' : '#cbd5e1', glow: false, align: 'center' });
  }
  if (blink(t, 1.2)) text(ctx, 'PRESS PLAY', w / 2, h * 0.94, Math.max(1, Math.round(1.5 * s)), { color: '#86efac', glow: '#22c55e', align: 'center' });
}
