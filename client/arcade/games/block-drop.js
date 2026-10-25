// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Block Drop's screen (the rules: shared/arcade/games/block-drop.js): a neon well, glassy tiles, a drop beam under the
// piece (not a copy of the piece: the columns it falls through and marks where it lands), flashes and sparks when rows
// clear, a chain counter, the level banner. createView() is the game in the sealed box; cover() is its attract screen
// on the cabinets in the world (client/js/play/arcade.js).
import * as sim from '/shared/arcade/games/block-drop.js';
import { makeScreen, canvas, text, textW, glow, blit, Particles, Shake, Floaters, crt, blink, fmt, rrect, shade, withAlpha, LW, LH } from '../fx.js';

export { sim };
const { COLS, ROWS, HIDDEN, PIECES, dropY } = sim;
const VIS = ROWS - HIDDEN;
export const COLORS = ['#22d3ee', '#a3e635', '#38bdf8', '#facc15', '#c084fc', '#fb923c', '#60a5fa', '#4ade80', '#f87171', '#f472b6', '#2dd4bf', '#e879f9', '#fbbf24', '#818cf8'];
const C = 20, WX = 14, WY = 56, WW = COLS * C, WH = VIS * C, PX = WX + WW + 14, PW = LW - PX - 10;
const LINE_WORD = ['', '', 'DOUBLE', 'TRIPLE', 'QUAD', 'BLOCKBUSTER!'];

// ------------------------------------------------------------------------------------------- tiles
const tiles = new Map();
/** A glassy tile of `color`, P device pixels square, made once per colour and size. */
function tile(color, P) {
  const key = `${color}|${P}`;
  let t = tiles.get(key);
  if (!t) {
    t = canvas(P, P, 1);
    const x = t.x, size = P, r = Math.max(2, size * 0.16), g = x.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, shade(color, 0.3)); g.addColorStop(0.55, color); g.addColorStop(1, shade(color, -0.35));
    rrect(x, 0.5, 0.5, size - 1, size - 1, r); x.fillStyle = g; x.fill();
    x.lineWidth = 1; x.strokeStyle = shade(color, -0.5); x.stroke();
    x.globalAlpha = 0.55; x.fillStyle = '#ffffff';
    rrect(x, size * 0.16, size * 0.12, size * 0.68, size * 0.16, size * 0.08); x.fill();
    x.globalAlpha = 0.18; x.fillRect(size * 0.14, size * 0.3, size * 0.12, size * 0.42);
    x.globalAlpha = 1;
    tiles.set(key, t);
  }
  return t;
}
/** Piece k in turn r with its box's top-left at (ox, oy), cells `size` logical px. */
function drawPiece(ctx, k, r, ox, oy, size, a = 1) {
  const t = tile(COLORS[k], Math.max(2, Math.round(size * ctx.getTransform().a)));
  ctx.globalAlpha = a;
  for (const [cx, cy] of PIECES[k].rots[r]) blit(ctx, t.c, ox + cx * size, oy + cy * size);
  ctx.globalAlpha = 1;
}
/** The piece's cells' bounding box in its own box: [x0, y0, x1, y1]. */
function bounds(k, r) {
  let x0 = 9, y0 = 9, x1 = -1, y1 = -1;
  for (const [x, y] of PIECES[k].rots[r]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

// ------------------------------------------------------------------------------------------- the backdrop (made once per size)
function backdrop(S) {
  const b = canvas(LW, LH, S.k), x = b.x;
  const g = x.createLinearGradient(0, 0, 0, LH);
  g.addColorStop(0, '#0d0b24'); g.addColorStop(0.6, '#0a1030'); g.addColorStop(1, '#120a26');
  x.fillStyle = g; x.fillRect(0, 0, LW, LH);
  // the well: a dark glass box with a neon rim
  x.save(); x.shadowColor = '#8b5cf6'; x.shadowBlur = 14 * S.k;
  rrect(x, WX - 5, WY - 5, WW + 10, WH + 10, 7); x.strokeStyle = '#a78bfa'; x.lineWidth = 2; x.stroke(); x.restore();
  x.fillStyle = 'rgba(5,6,18,0.86)'; x.fillRect(WX, WY, WW, WH);
  x.strokeStyle = 'rgba(148,163,255,0.06)'; x.lineWidth = 1;
  for (let c = 1; c < COLS; c++) { x.beginPath(); x.moveTo(WX + c * C + 0.5, WY); x.lineTo(WX + c * C + 0.5, WY + WH); x.stroke(); }
  for (let r = 1; r < VIS; r++) { x.beginPath(); x.moveTo(WX, WY + r * C + 0.5); x.lineTo(WX + WW, WY + r * C + 0.5); x.stroke(); }
  // the panel's boxes
  const box = (y, h) => { rrect(x, PX, y, PW, h, 6); x.fillStyle = 'rgba(20,16,48,0.75)'; x.fill(); x.strokeStyle = 'rgba(167,139,250,0.35)'; x.stroke(); };
  box(WY - 5, 176); box(WY + 182, 150); box(WY + 343, WH - 338);
  text(x, 'SCORE', PX + 10, WY + 6, 1, { color: '#a5b4fc', glow: false, k: S.k });
  text(x, 'BEST', PX + 10, WY + 48, 1, { color: '#a5b4fc', glow: false, k: S.k });
  text(x, 'LEVEL', PX + 10, WY + 90, 1, { color: '#a5b4fc', glow: false, k: S.k });
  text(x, 'LINES', PX + 10, WY + 132, 1, { color: '#a5b4fc', glow: false, k: S.k });
  text(x, 'NEXT', PX + 10, WY + 192, 1, { color: '#a5b4fc', glow: false, k: S.k });
  text(x, 'BLOCK', WX, 14, 3, { color: '#e9d5ff', glow: '#8b5cf6', k: S.k });
  text(x, 'DROP', WX + textW('BLOCK ', 3), 14, 3, { color: '#a5f3fc', glow: '#22d3ee', k: S.k });
  return b;
}

// ------------------------------------------------------------------------------------------- the game's screen
export function createView(cv) {
  const S = makeScreen(cv), P = new Particles(700), shake = new Shake(), F = new Floaters();
  let bg = null, bgKey = '', best = 0, practice = false, T = 0, drop = 0, trails = [], flashes = [], banner = null, overT = -1, isPaused = false, gridLines = 0;
  return {
    resize() { S.fit(); },
    pause(on) { isPaused = on; },
    reset(s, info) { best = info.best || 0; practice = info.practice; trails = []; flashes = []; banner = { str: 'READY', t: 0, life: 1.2, color: '#a5f3fc' }; overT = -1; P.p.length = 0; },
    event(ev) {
      if (ev.k === 'hard') drop = ev.n;
      else if (ev.k === 'lock') {
        const cells = PIECES[ev.piece].rots[ev.r].map(([x, y]) => [ev.x + x, ev.y + y]);
        flashes.push({ cells, t: 0 });
        if (ev.hard && drop > 0) {
          const xs = [...new Set(cells.map(c => c[0]))];
          for (const x of xs) { const ys = cells.filter(c => c[0] === x).map(c => c[1]); trails.push({ x, y0: Math.min(...ys) - drop, y1: Math.min(...ys), t: 0, color: COLORS[ev.piece] }); }
          for (const [x, y] of cells) P.burst(WX + x * C + C / 2, WY + (y - HIDDEN + 1) * C, 3, { color: COLORS[ev.piece], speed: 70, life: 0.35, size: 2, dir: 0, spread: 2.4 });
          shake.kick(Math.min(3, 1 + drop / 8));
        }
        drop = 0;
      } else if (ev.k === 'clear') {
        for (const y of ev.rows) for (let x = 0; x < COLS; x++) {
          P.burst(WX + x * C + C / 2, WY + (y - HIDDEN) * C + C / 2, 4, { color: ['#ffffff', '#a5f3fc', '#f0abfc'], speed: 160, life: 0.7, size: 2.5, gravity: 120 });
        }
        const y = WY + (ev.rows[0] - HIDDEN) * C;
        F.add(`+${fmt(ev.pts)}`, WX + WW / 2, y, { color: '#fde68a', s: 2 });
        if (LINE_WORD[ev.n]) F.add(LINE_WORD[ev.n], WX + WW / 2, y - 22, { color: ev.n >= 5 ? '#f0abfc' : '#a5f3fc', s: ev.n >= 5 ? 3 : 2, life: 1.4 });
        if (ev.chain >= 2) F.add(`CHAIN X${ev.chain}`, WX + WW / 2, y + 22, { color: '#86efac', s: 1, life: 1.2 });
        shake.kick(ev.n >= 5 ? 9 : ev.n >= 4 ? 6 : ev.n >= 3 ? 3 : 1);
      } else if (ev.k === 'level') banner = { str: `LEVEL ${ev.level}`, t: 0, life: 1.6, color: '#fde68a' };
      else if (ev.k === 'perfect') banner = { str: 'PERFECT CLEAR!', t: 0, life: 2, color: '#f0abfc' };
      else if (ev.k === 'over') { overT = 0; shake.kick(4); }
    },
    sfx(ev) {
      switch (ev.k) {
        case 'move': return ['tick'];
        case 'turn': return ['turn'];
        case 'bump': return ['bump'];
        case 'land': return ['land'];
        case 'lock': return ev.hard ? ['drop'] : ['lock'];
        case 'clear': return ['clear', ev.n];
        case 'level': return ['level'];
        case 'perfect': return ['fanfare'];
        case 'over': return ['over'];
        default: return null;
      }
    },
    buzz(ev) { return ev.k === 'lock' && ev.hard ? 12 : ev.k === 'clear' ? 18 + ev.n * 12 : ev.k === 'over' ? 160 : 0; },
    draw(dt, s) {
      S.fit();
      const ctx = S.ctx; T += isPaused ? 0 : dt;
      const key = `${S.cv.width}x${S.cv.height}`;
      if (key !== bgKey) { bg = backdrop(S); bgKey = key; }
      S.begin();
      if (!isPaused) { shake.update(dt); P.update(dt); }
      ctx.drawImage(bg.c, 0, 0, LW, LH);
      // a slow shimmer down the well's back
      gridLines = (gridLines + dt * 18) % 40;
      ctx.globalAlpha = 0.05; ctx.fillStyle = '#a78bfa';
      for (let y = WY - 40 + gridLines; y < WY + WH; y += 40) if (y > WY) ctx.fillRect(WX, y, WW, 1);
      ctx.globalAlpha = 1;
      if (!s) { S.begin(); crt(ctx, S); return; }
      ctx.save(); ctx.translate(shake.x, shake.y);
      ctx.save(); ctx.beginPath(); ctx.rect(WX, WY, WW, WH); ctx.clip();
      const PC = Math.max(2, Math.round(C * ctx.getTransform().a)), clearing = s.clear ? new Set(s.clear.rows) : null, cp = s.clear ? 1 - s.clear.t / 20 : 0;
      // the drop beam: the columns the piece falls through, and where it lands
      if (s.cur && overT < 0) {
        const c = s.cur, ly = dropY(s), col = COLORS[c.k];
        const cols = new Map();
        for (const [x, y] of PIECES[c.k].rots[c.r]) { const X = c.x + x; cols.set(X, Math.max(cols.get(X) ?? -9, y)); }
        for (const [X, by] of cols) {
          const top = WY + (c.y + by - HIDDEN + 1) * C, bot = WY + (ly + by - HIDDEN + 1) * C;
          if (bot > top) { const g = ctx.createLinearGradient(0, top, 0, bot); g.addColorStop(0, withAlpha(col, 0.02)); g.addColorStop(1, withAlpha(col, 0.16)); ctx.fillStyle = g; ctx.fillRect(WX + X * C + 1, top, C - 2, bot - top); }
        }
        ctx.fillStyle = col; ctx.globalAlpha = 0.85;
        for (const [x, y] of PIECES[c.k].rots[c.r]) { const X = WX + (c.x + x) * C, Y = WY + (ly + y - HIDDEN) * C; if (Y >= WY) { ctx.fillRect(X + 3, Y + C - 3, C - 6, 2); ctx.fillRect(X + 3, Y + 1, 2, 2); ctx.fillRect(X + C - 5, Y + 1, 2, 2); } }
        ctx.globalAlpha = 1;
      }
      // the stack (grey from the bottom when the game is over)
      const greyFrom = overT >= 0 ? ROWS - Math.floor(overT * 26) : ROWS + 1;
      for (let y = HIDDEN; y < ROWS; y++) {
        const row = clearing?.has(y);
        if (row) ctx.globalAlpha = Math.max(0, 1 - cp * 1.3);
        for (let x = 0; x < COLS; x++) {
          const v = s.grid[y * COLS + x]; if (!v) continue;
          blit(ctx, tile(y >= greyFrom ? '#475569' : COLORS[v - 1], PC).c, WX + x * C, WY + (y - HIDDEN) * C);
        }
        if (row) { ctx.globalAlpha = Math.max(0, 0.9 - cp); ctx.fillStyle = '#ffffff'; const w = WW * (1 - cp * 0.6); ctx.fillRect(WX + (WW - w) / 2, WY + (y - HIDDEN) * C + 2, w, C - 4); ctx.globalAlpha = 1; }
        ctx.globalAlpha = 1;
      }
      // the piece in hand, glowing
      if (s.cur) {
        const c = s.cur;
        for (const [x, y] of PIECES[c.k].rots[c.r]) { const Y = c.y + y - HIDDEN; if (Y >= 0) glow(ctx, COLORS[c.k], WX + (c.x + x) * C + C / 2, WY + Y * C + C / 2, 22, 0.32); }
        for (const [x, y] of PIECES[c.k].rots[c.r]) { const Y = c.y + y - HIDDEN; if (Y >= 0) blit(ctx, tile(COLORS[c.k], PC).c, WX + (c.x + x) * C, WY + Y * C); }
      }
      // a locked piece flashes white for a moment; a hard drop leaves a streak
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]; f.t += dt; if (f.t > 0.14) { flashes.splice(i, 1); continue; }
        ctx.globalAlpha = 0.7 * (1 - f.t / 0.14); ctx.fillStyle = '#ffffff';
        for (const [x, y] of f.cells) if (y >= HIDDEN) ctx.fillRect(WX + x * C + 1, WY + (y - HIDDEN) * C + 1, C - 2, C - 2);
        ctx.globalAlpha = 1;
      }
      for (let i = trails.length - 1; i >= 0; i--) {
        const tr = trails[i]; tr.t += dt; if (tr.t > 0.22) { trails.splice(i, 1); continue; }
        const y0 = WY + Math.max(0, tr.y0 - HIDDEN) * C, y1 = WY + (tr.y1 - HIDDEN) * C;
        if (y1 <= y0) continue;
        const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, withAlpha(tr.color, 0)); g.addColorStop(1, withAlpha(tr.color, 0.55 * (1 - tr.t / 0.22)));
        ctx.fillStyle = g; ctx.fillRect(WX + tr.x * C + 4, y0, C - 8, y1 - y0);
      }
      ctx.restore();   // (the well's clip)
      P.draw(ctx);
      // the panel
      text(ctx, fmt(s.score), PX + 10, WY + 20, 2, { color: '#ffffff', glow: '#a78bfa' });
      const hi = Math.max(best, s.score);
      text(ctx, fmt(hi), PX + 10, WY + 62, 2, { color: s.score > best && best > 0 ? '#fde68a' : '#e2e8f0', glow: s.score > best && best > 0 ? '#f59e0b' : false });
      text(ctx, String(s.level), PX + 10, WY + 104, 2, { color: '#a5f3fc', glow: '#22d3ee' });
      text(ctx, String(s.lines), PX + 10, WY + 146, 2, { color: '#bbf7d0', glow: '#22c55e' });
      s.next.forEach((nk, i) => {
        const size = i === 0 ? 16 : 12, [x0, y0, x1, y1] = bounds(nk, 0), w = (x1 - x0 + 1) * size, h = (y1 - y0 + 1) * size;
        const cx = PX + PW / 2, cy = WY + 236 + i * 58;
        drawPiece(ctx, nk, 0, cx - w / 2 - x0 * size, cy - h / 2 - y0 * size, size, i === 0 ? 1 : 0.6);
      });
      if (s.chain >= 2 && blink(T, 0.8, 0.7)) text(ctx, `CHAIN X${s.chain}`, PX + PW / 2, WY + 360, 1, { color: '#86efac', align: 'center' });
      if (practice) text(ctx, 'PRACTICE', PX + PW / 2, WY + 386, 1, { color: '#94a3b8', glow: false, align: 'center' });
      text(ctx, 'MVW ARCADE', PX + PW / 2, LH - 26, 1, { color: '#6d28d9', glow: false, align: 'center' });
      F.draw(ctx, isPaused ? 0 : dt);
      ctx.restore();   // (the shake)
      if (banner) {
        banner.t += isPaused ? 0 : dt;
        if (banner.t > banner.life) banner = null;
        else { const u = banner.t / banner.life; ctx.globalAlpha = u > 0.75 ? (1 - u) / 0.25 : 1; text(ctx, banner.str, WX + WW / 2, WY + WH / 2 - 60, 2, { color: banner.color, align: 'center' }); ctx.globalAlpha = 1; }
      }
      if (overT >= 0) {
        overT += dt;
        if (overT > 0.9) {
          ctx.fillStyle = 'rgba(3,4,12,0.55)'; ctx.fillRect(WX, WY + WH / 2 - 44, WW, 88);
          text(ctx, 'GAME', WX + WW / 2, WY + WH / 2 - 32, 4, { color: '#fda4af', glow: '#e11d48', align: 'center' });
          text(ctx, 'OVER', WX + WW / 2, WY + WH / 2 + 4, 4, { color: '#fda4af', glow: '#e11d48', align: 'center' });
        }
      }
      if (isPaused) { ctx.fillStyle = 'rgba(2,3,10,0.6)'; ctx.fillRect(0, 0, LW, LH); text(ctx, 'PAUSED', LW / 2, LH / 2 - 10, 3, { color: '#e2e8f0', align: 'center' }); }
      crt(ctx, S);
    },
  };
}

// ------------------------------------------------------------------------------------------- the attract screen
const DEMO = [[4, 0, 1], [9, 1, 6], [6, 2, 3], [0, 3, 8], [10, 1, 0], [2, 0, 5], [7, 3, 7]];
/** Block Drop's attract screen on a cabinet: w × h canvas, t seconds, info { top: [{ name, score }] }. */
export function cover(ctx, w, h, t, info = {}) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#120c2e'); g.addColorStop(1, '#0a1030');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const s = w / 240, c = 16 * s;
  // pieces falling behind the title
  DEMO.forEach(([k, r, col], i) => {
    const y = ((t * (26 + i * 5) * s + i * 70 * s) % (h + 80 * s)) - 60 * s;
    ctx.globalAlpha = 0.55;
    drawPiece(ctx, k, r, (col * 22 + 6) * s, y, c);
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(8,6,24,0.55)'; ctx.fillRect(0, h * 0.2, w, h * 0.32);
  text(ctx, 'BLOCK', w / 2, h * 0.24, Math.round(4 * s), { color: '#e9d5ff', glow: '#8b5cf6', align: 'center', k: 1 });
  text(ctx, 'DROP', w / 2, h * 0.24 + 36 * s, Math.round(4 * s), { color: '#a5f3fc', glow: '#22d3ee', align: 'center', k: 1 });
  const top = info.top || [];
  text(ctx, 'HI-SCORES', w / 2, h * 0.6, Math.max(1, Math.round(s)), { color: '#fde68a', glow: false, align: 'center', k: 1 });
  for (let i = 0; i < 3; i++) {
    const r = top[i], y = h * 0.6 + (14 + i * 12) * s;
    text(ctx, r ? `${i + 1} ${String(r.name).slice(0, 9).toUpperCase().padEnd(9, ' ')} ${fmt(r.score).padStart(7, ' ')}` : `${i + 1} ---       ------`, w / 2, y, Math.max(1, Math.round(s)), { color: i === 0 ? '#ffffff' : '#cbd5e1', glow: false, align: 'center', k: 1 });
  }
  if (blink(t, 1.2)) text(ctx, 'PRESS PLAY', w / 2, h * 0.9, Math.max(1, Math.round(1.5 * s)), { color: '#86efac', glow: '#22c55e', align: 'center', k: 1 });
}
