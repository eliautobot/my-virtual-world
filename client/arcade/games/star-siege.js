// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Star Siege's screen (the rules: shared/arcade/games/star-siege.js): our own drones (wisps, darts and crawlers, two
// frames each), a starfield in three depths, glowing shots, shield pods that wear away cell by cell, sparks and a
// shake when something blows up, the command saucer's lights. createView() is the game in the sealed box; cover() its
// attract screen on the cabinets.
import * as sim from '/shared/arcade/games/star-siege.js';
import { makeScreen, canvas, text, glow, Particles, Shake, Floaters, Stars, crt, blink, fmt, sprite, stamp, LW, LH } from '../fx.js';

export { sim };
const { FCOLS, PLAYER_Y, PW, PH, GROUND, SHIELD_X, SHIELD_Y, SC, SW, SH, alienAt } = sim;

// our own drones: 11 × 8, two frames
const WISP = [
  ['...#####...', '..#######..', '.##.###.##.', '.#########.', '..#######..', '..#.#.#.#..', '.#.#...#.#.', '#.........#'],
  ['...#####...', '..#######..', '.##.###.##.', '.#########.', '..#######..', '...#.#.#...', '..#.#.#.#..', '.#.......#.'],
];
const DART = [
  ['.....#.....', '....###....', '#..#####..#', '#.##.#.##.#', '###########', '..#######..', '...#...#...', '..#.....#..'],
  ['.....#.....', '....###....', '...#####...', '#.##.#.##.#', '###########', '#.#######.#', '...#...#...', '....#.#....'],
];
const CRAWL = [
  ['...#####...', '.#########.', '##..###..##', '###########', '.#.#####.#.', '#.#.....#.#', '#.........#', '.#.......#.'],
  ['...#####...', '.#########.', '##..###..##', '###########', '.#.#####.#.', '.#.#...#.#.', '#..#...#..#', '..#.....#..'],
];
const SHIP = ['......#......', '.....###.....', '.....###.....', '..#########..', '.###########.', '#############', '##.##...##.##'];
const SAUCER = ['.....######.....', '...##########...', '..############..', '.##.##.##.##.##.', '################', '..###..##..###..', '...#........#...'];
const ROW_LOOK = [[WISP, '#f472b6'], [DART, '#22d3ee'], [DART, '#22d3ee'], [CRAWL, '#a3e635'], [CRAWL, '#a3e635']];

export function createView(cv) {
  const S = makeScreen(cv), P = new Particles(800), shake = new Shake(), F = new Floaters(), stars = new Stars(110);
  let best = 0, practice = false, T = 0, banner = null, overT = -1, isPaused = false, flash = 0, deadAt = 0, nebula = null, nebKey = '';
  return {
    resize() { S.fit(); },
    pause(on) { isPaused = on; },
    reset(s, info) { best = info.best || 0; practice = info.practice; banner = { str: 'WAVE 1', t: 0, life: 1.6, color: '#a5f3fc' }; overT = -1; P.p.length = 0; flash = 0; },
    event(ev) {
      switch (ev.k) {
        case 'kill': {
          const col = ROW_LOOK[ev.row][1];
          P.burst(ev.x, ev.y, 18, { color: [col, '#ffffff', col], speed: 150, life: 0.55, size: 2.5 });
          shake.kick(1.2);
          break;
        }
        case 'saucer':
          P.burst(ev.x, ev.y, 40, { color: ['#f43f5e', '#fde68a', '#ffffff'], speed: 200, life: 0.9, size: 3 });
          F.add(String(ev.pts), ev.x, ev.y - 6, { color: '#fde68a', s: 2, life: 1.4 });
          shake.kick(3);
          break;
        case 'die':
          P.burst(ev.x, ev.y, 70, { color: ['#fde68a', '#fb923c', '#ffffff', '#22d3ee'], speed: 220, life: 1.1, size: 3, gravity: 60 });
          shake.kick(9); flash = 0.35; deadAt = T;
          break;
        case 'clash': P.burst(ev.x, ev.y, 10, { color: ['#ffffff', '#fde68a'], speed: 110, life: 0.35 }); break;
        case 'chip': P.burst(ev.x, ev.y, 5, { color: '#4ade80', speed: 70, life: 0.3, size: 2 }); break;
        case 'puff': P.burst(ev.x, ev.y, 6, { color: ['#a3e635', '#22c55e'], speed: 60, life: 0.35, dir: 0, spread: 2.2 }); break;
        case 'miss': P.burst(ev.x, ev.y, 4, { color: '#a5f3fc', speed: 50, life: 0.25 }); break;
        case 'cleared': banner = { str: 'WAVE CLEAR', t: 0, life: 1.5, color: '#86efac' }; F.add(`+${ev.pts}`, LW / 2, LH / 2 + 10, { color: '#fde68a', s: 2 }); break;
        case 'wave': banner = { str: `WAVE ${ev.wave}`, t: 0, life: 1.6, color: '#a5f3fc' }; break;
        case 'life': F.add('1UP!', LW / 2, LH - 70, { color: '#86efac', s: 2, life: 1.4 }); break;
        case 'invade': flash = 0.6; shake.kick(10); banner = { str: 'INVADED!', t: 0, life: 3, color: '#fda4af' }; break;
        case 'over': overT = 0; break;
        default: break;
      }
    },
    sfx(ev) {
      switch (ev.k) {
        case 'fire': return ['laser'];
        case 'kill': return ['boom', ev.row];
        case 'march': return ['march', ev.n];
        case 'saucer': return ['bigboom'];
        case 'saucerIn': return ['ufo'];
        case 'die': return ['die'];
        case 'clash': return ['clash'];
        case 'chip': return ['chip'];
        case 'life': return ['coin'];
        case 'cleared': return ['fanfare'];
        case 'invade': return ['die'];
        case 'over': return ['over'];
        default: return null;
      }
    },
    buzz(ev) { return ev.k === 'die' || ev.k === 'invade' ? 200 : ev.k === 'saucer' ? 40 : ev.k === 'kill' ? 8 : 0; },
    draw(dt, s) {
      S.fit();
      const ctx = S.ctx; if (!isPaused) T += dt;
      S.begin();
      // space: a deep gradient with two soft nebulas (made once per size), and the stars
      const key = `${S.cv.width}x${S.cv.height}`;
      if (key !== nebKey) {
        nebKey = key; nebula = canvas(LW, LH, S.k);
        const x = nebula.x, g = x.createLinearGradient(0, 0, 0, LH);
        g.addColorStop(0, '#05030f'); g.addColorStop(0.7, '#070b1d'); g.addColorStop(1, '#0b0716');
        x.fillStyle = g; x.fillRect(0, 0, LW, LH);
        for (const [cx, cy, r, c] of [[80, 150, 150, 'rgba(139,92,246,0.16)'], [290, 300, 170, 'rgba(14,165,233,0.12)']]) { const n = x.createRadialGradient(cx, cy, 0, cx, cy, r); n.addColorStop(0, c); n.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = n; x.fillRect(0, 0, LW, LH); }
      }
      ctx.drawImage(nebula.c, 0, 0, LW, LH);
      stars.draw(ctx, isPaused ? 0 : dt, 10);
      if (!isPaused) { shake.update(dt); P.update(dt); }
      ctx.save(); ctx.translate(shake.x, shake.y);
      if (s) {
        // the ground and the ship's lane
        ctx.fillStyle = '#16a34a'; ctx.fillRect(0, GROUND, LW, 2); glow(ctx, '#22c55e', LW / 2, GROUND + 1, 40, 0.25);
        // the drones
        for (let i = 0; i < s.alive.length; i++) {
          if (!s.alive[i]) continue;
          const row = Math.floor(i / FCOLS), [look, col] = ROW_LOOK[row], [ax, ay] = alienAt(s, i);
          stamp(ctx, sprite(ctx, `a${row > 2 ? 2 : row > 0 ? 1 : 0}${s.frame}`, look[s.frame], 2, col), ax, ay);
        }
        // the shield pods, cell by cell
        ctx.fillStyle = '#4ade80';
        SHIELD_X.forEach((sx, n) => {
          const x0 = sx - (SW * SC) / 2, c = s.shields[n];
          glow(ctx, '#22c55e', sx, SHIELD_Y + 10, 26, 0.18);
          const m = ctx.getTransform(), P = Math.max(1, Math.round(SC * m.a)), X0 = Math.round(m.a * x0 + m.e), Y0 = Math.round(m.d * SHIELD_Y + m.f);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) if (c[y * SW + x]) ctx.fillRect(X0 + x * P, Y0 + y * P, P, P);
          ctx.setTransform(m);
        });
        // the saucer
        if (s.saucer) {
          stamp(ctx, sprite(ctx, 'saucer', SAUCER, 2, '#fb7185'), s.saucer.x - 16, 62 - 7);
          for (let n = 0; n < 4; n++) if (Math.floor(T * 8 + n) % 4 === 0) { ctx.fillStyle = '#fde68a'; ctx.fillRect(s.saucer.x - 12 + n * 8, 62 + 1, 2, 2); }
          glow(ctx, '#f43f5e', s.saucer.x, 62, 24, 0.4);
        }
        // shots and bombs
        if (s.shot) { glow(ctx, '#22d3ee', s.shot.x + 1, s.shot.y + 5, 10, 0.7); ctx.fillStyle = '#e0f2fe'; ctx.fillRect(s.shot.x, s.shot.y, 2, 10); }
        for (const b of s.bombs) {
          const ph = Math.floor(T * 12) & 1;
          glow(ctx, '#fb923c', b.x, b.y + 5, 9, 0.5);
          ctx.fillStyle = b.k === 2 ? '#fde68a' : '#fdba74';
          if (b.k === 0) for (let j = 0; j < 5; j++) ctx.fillRect(b.x - 1 + (((j + ph) & 1) ? 1 : -1), b.y + j * 2, 2, 2);
          else if (b.k === 1) { ctx.fillRect(b.x - 1, b.y, 2, 8); ctx.fillRect(b.x - 2, b.y + (ph ? 0 : 6), 4, 2); }
          else { ctx.fillRect(b.x - 1, b.y, 2, 10); ctx.fillRect(b.x - 3, b.y + 4, 6, 2); }
        }
        // the ship (blinking while it comes back)
        if (!s.dead && !(s.inv && Math.floor(T * 10) & 1)) {
          glow(ctx, '#38bdf8', s.px, PLAYER_Y, 22, 0.35);
          stamp(ctx, sprite(ctx, 'ship', SHIP, 2, '#e0f2fe'), s.px - PW / 2, PLAYER_Y - PH / 2);
          ctx.fillStyle = Math.floor(T * 20) & 1 ? '#fb923c' : '#fde68a'; ctx.fillRect(s.px - 3, PLAYER_Y + PH / 2 + 1, 2, 2); ctx.fillRect(s.px + 1, PLAYER_Y + PH / 2 + 1, 2, 2);
        }
      }
      P.draw(ctx);
      F.draw(ctx, isPaused ? 0 : dt);
      ctx.restore();
      // the heads-up line
      if (s) {
        text(ctx, 'SCORE', 12, 12, 1, { color: '#a5b4fc', glow: false });
        text(ctx, fmt(s.score), 12, 24, 2, { color: '#ffffff', glow: '#22d3ee' });
        const hi = Math.max(best, s.score), beat = s.score > best && best > 0;
        text(ctx, 'HI', LW / 2, 12, 1, { color: '#a5b4fc', glow: false, align: 'center' });
        text(ctx, fmt(hi), LW / 2, 24, 2, { color: beat ? '#fde68a' : '#e2e8f0', glow: beat ? '#f59e0b' : false, align: 'center' });
        text(ctx, 'WAVE', LW - 12, 12, 1, { color: '#a5b4fc', glow: false, align: 'right' });
        text(ctx, String(s.wave), LW - 12, 24, 2, { color: '#a5f3fc', glow: '#22d3ee', align: 'right' });
        for (let n = 0; n < Math.max(0, s.lives - (s.dead ? 0 : 1)); n++) stamp(ctx, sprite(ctx, 'life', SHIP, 1, '#7dd3fc'), 12 + n * 18, GROUND + 7);
        if (practice) text(ctx, 'PRACTICE', LW - 12, GROUND + 8, 1, { color: '#94a3b8', glow: false, align: 'right' });
      }
      if (banner) {
        if (!isPaused) banner.t += dt;
        if (banner.t > banner.life) banner = null;
        else if (blink(banner.t, 0.5, 0.75)) text(ctx, banner.str, LW / 2, LH / 2 - 40, 3, { color: banner.color, align: 'center' });
      }
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.5, flash)})`; ctx.fillRect(0, 0, LW, LH); flash -= dt; }
      if (overT >= 0) {
        overT += dt;
        if (overT > 0.6) {
          ctx.fillStyle = 'rgba(2,3,10,0.5)'; ctx.fillRect(0, LH / 2 - 50, LW, 90);
          text(ctx, 'GAME OVER', LW / 2, LH / 2 - 32, 4, { color: '#fda4af', glow: '#e11d48', align: 'center' });
          text(ctx, fmt(s?.score || 0), LW / 2, LH / 2 + 10, 2, { color: '#ffffff', align: 'center' });
        }
      }
      if (isPaused) { ctx.fillStyle = 'rgba(2,3,10,0.6)'; ctx.fillRect(0, 0, LW, LH); text(ctx, 'PAUSED', LW / 2, LH / 2 - 10, 3, { color: '#e2e8f0', align: 'center' }); }
      void deadAt;
      crt(ctx, S);
    },
  };
}

// ------------------------------------------------------------------------------------------- the attract screen
export function cover(ctx, w, h, t, info = {}) {
  ctx.fillStyle = '#05030f'; ctx.fillRect(0, 0, w, h);
  const s = w / 240;
  for (let i = 0; i < 60; i++) { const x = (i * 97) % w, y = ((i * 53 + t * (10 + (i % 3) * 12) * s) % h); ctx.fillStyle = i % 3 ? '#64748b' : '#ffffff'; ctx.fillRect(x, y, 1, 1); }
  const fr = Math.floor(t * 2) & 1, step = Math.floor(t * 2) % 8, off = (step < 4 ? step : 8 - step) * 4 * s;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
    const [look, col] = ROW_LOOK[r === 0 ? 0 : r === 1 ? 1 : 3];
    stamp(ctx, sprite(ctx, `c${r}${fr}`, look[fr], 1.5 * s, col), (30 + c * 32) * s + off, (120 + r * 26) * s);
  }
  text(ctx, 'STAR', w / 2, h * 0.07, Math.round(4 * s), { color: '#a5f3fc', glow: '#22d3ee', align: 'center', k: 1 });
  text(ctx, 'SIEGE', w / 2, h * 0.07 + 36 * s, Math.round(4 * s), { color: '#fbcfe8', glow: '#f472b6', align: 'center', k: 1 });
  const top = info.top || [];
  text(ctx, 'HI-SCORES', w / 2, h * 0.64, Math.max(1, Math.round(s)), { color: '#fde68a', glow: false, align: 'center', k: 1 });
  for (let i = 0; i < 3; i++) {
    const r = top[i], y = h * 0.64 + (14 + i * 12) * s;
    text(ctx, r ? `${i + 1} ${String(r.name).slice(0, 9).toUpperCase().padEnd(9, ' ')} ${fmt(r.score).padStart(7, ' ')}` : `${i + 1} ---       ------`, w / 2, y, Math.max(1, Math.round(s)), { color: i === 0 ? '#ffffff' : '#cbd5e1', glow: false, align: 'center', k: 1 });
  }
  stamp(ctx, sprite(ctx, 'cship', SHIP, 1.5 * s, '#e0f2fe'), w / 2 - 10 * s, h * 0.55);
  if (blink(t, 1.2)) text(ctx, 'PRESS PLAY', w / 2, h * 0.92, Math.max(1, Math.round(1.5 * s)), { color: '#86efac', glow: '#22c55e', align: 'center', k: 1 });
}
