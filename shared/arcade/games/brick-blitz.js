// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Brick Blitz (docs/features/arcade.md): our own brick breaker. Keep the ball in play with the paddle and break every
// brick; where the ball meets the paddle sets its angle. Some bricks take two or three hits, steel never breaks.
// Broken bricks sometimes drop a capsule: Wide paddle, Multi-ball, Slow ball, an extra Life or Bonus points. Every
// level is a new wall, the ball a little faster. Controls: ◀ ▶ (or drag / the mouse over the screen) moves the paddle,
// A (or a tap) launches. The sim (rules only; the screen is client/arcade/games/brick-blitz.js): deterministic, see
// shared/arcade/core.js (angles from its table; plain + − × ÷ and sqrt only).
import { BTN, baseState, roll, SIN, COS, FX } from '../core.js';

export const W = 360, H = 480, WALL_L = 8, WALL_R = 352, TOP = 56;
export const BCOLS = 10, BW = 32, BH = 14, BGAP = 2, BX0 = 11, BY0 = 86;
export const PADDLE_Y = 440, PADDLE_H = 10, BALL_R = 4;
const PAD_W = 56, PAD_WIDE = 84, PAD_V = 6, PTR_V = 14;
const ROW_PTS = [80, 70, 60, 50, 40, 30, 20, 10];
export const CAPSULES = ['W', 'M', 'S', 'L', 'B'];
const CAPSULE_ODDS = [30, 26, 22, 6, 16];   // of 100
// our own walls, ten bricks a row: '.' none, 1–3 hits, 'S' steel
const LEVELS = [
  ['1111111111', '1111111111', '1111111111', '1111111111', '1111111111', '1111111111'],
  ['....22....', '...2112...', '..211112..', '.21111112.', '2111111112', '.21111112.', '..211112..', '...2112...'],
  ['1.1.1.1.1.', '.2.2.2.2.2', 'S1S1S1S1S1', '1.1.1.1.1.', '.2.2.2.2.2', '1S1S1S1S1S'],
  ['3333333333', '1........1', '1.222222.1', '1.2SSSS2.1', '1.222222.1', '1........1', '1111111111'],
  ['S........S', 'S.111111.S', 'S.133331.S', 'S.132231.S', 'S.133331.S', 'S.111111.S', 'SSS....SSS'],
  ['2.2.2.2.2.', '.3.3.3.3.3', '2.2.2.2.2.', '.1.1.1.1.1', '1.1.1.1.1.', '.1.1.1.1.1', '1111111111', '2222222222'],
];

function layout(s) {
  const L = LEVELS[(s.level - 1) % LEVELS.length], extra = Math.floor((s.level - 1) / LEVELS.length);   // round two: one hit harder
  s.bricks = [];
  L.forEach((row, r) => { for (let c = 0; c < BCOLS; c++) {
    const ch = row[c]; if (ch === '.') continue;
    const steel = ch === 'S', hp = steel ? 0 : Math.min(3, Number(ch) + extra);
    s.bricks.push({ c, r, x: BX0 + c * (BW + BGAP), y: BY0 + r * (BH + BGAP), hp, max: hp, steel });
  } });
}
const breakable = s => s.bricks.some(b => !b.steel);
export const speedOf = s => Math.min(7.2, 3.6 + (s.level - 1) * 0.3 + Math.floor(s.hits / 12) * 0.2) * (s.slow > 0 ? 0.72 : 1);
function serve(s) { s.balls = [{ x: s.px, y: PADDLE_Y - PADDLE_H / 2 - BALL_R - 1, vx: 0, vy: 0, stuck: true }]; s.hits = 0; }
export function init(seed) {
  const s = { ...baseState(seed), level: 1, lives: 3, score: 0, px: W / 2, wide: 0, slow: 0, caps: [], prev: 0, over: false, extraAt: 10000, broken: 0, bestLevel: 1, hits: 0 };
  layout(s); serve(s);
  return s;
}
export const paddleW = s => (s.wide > 0 ? PAD_WIDE : PAD_W);
/** Sets ball b moving at the current speed at angle a (1024ths of a turn, 0 = straight up). */
function aim(s, b, a) { const v = speedOf(s); b.vx = (SIN[a & 1023] * v) / FX; b.vy = -(COS[a & 1023] * v) / FX; }
/** Keeps a ball from flying too flat (at least ~20° off level), at the same speed. */
function steep(s, b) {
  const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1, min = v * 0.35;
  if (Math.abs(b.vy) < min) { b.vy = (b.vy < 0 ? -1 : 1) * min; b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(v * v - min * min); }
}
function rescale(s, b) { const v = speedOf(s), m = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1; b.vx = (b.vx / m) * v; b.vy = (b.vy / m) * v; }
function addScore(s, n) { s.score += n; while (s.score >= s.extraAt) { if (s.lives < 5) { s.lives++; s.ev.push({ k: 'life' }); } s.extraAt += 15000; } }

export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev;
  s.prev = b;
  if (s.clearT) { if (--s.clearT <= 0) { s.level++; s.bestLevel = s.level; layout(s); serve(s); s.caps = []; s.ev.push({ k: 'level', level: s.level }); } return; }
  if (s.deadT) { if (--s.deadT <= 0) { if (s.lives > 0) serve(s); else { s.over = true; s.ev.push({ k: 'over' }); } } return; }
  if (s.wide > 0) s.wide--;
  if (s.slow > 0 && --s.slow === 0) for (const bl of s.balls) if (!bl.stuck) rescale(s, bl);
  // the paddle: the pointer when it aims, else the buttons
  const hw = paddleW(s) / 2;
  if (inp.pd) { const tx = WALL_L + (inp.px / 255) * (WALL_R - WALL_L), d = tx - s.px; s.px += Math.max(-PTR_V, Math.min(PTR_V, d)); }
  else s.px += ((b & BTN.R) && !(b & BTN.L) ? PAD_V : 0) - ((b & BTN.L) && !(b & BTN.R) ? PAD_V : 0);
  s.px = Math.max(WALL_L + hw, Math.min(WALL_R - hw, s.px));
  // launching
  for (const bl of s.balls) if (bl.stuck) { bl.x = s.px; if (pressed & BTN.A) { bl.stuck = false; aim(s, bl, -60 + roll(s, 121)); s.ev.push({ k: 'launch' }); } }
  // the balls, in small steps (no tunnelling through a brick)
  for (let i = s.balls.length - 1; i >= 0; i--) {
    const bl = s.balls[i]; if (bl.stuck) continue;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(bl.vx), Math.abs(bl.vy)) / 3));
    for (let k = 0; k < n; k++) {
      const ox = bl.x, oy = bl.y;
      bl.x += bl.vx / n; bl.y += bl.vy / n;
      if (bl.x - BALL_R < WALL_L) { bl.x = WALL_L + BALL_R; bl.vx = Math.abs(bl.vx); s.ev.push({ k: 'wall' }); }
      if (bl.x + BALL_R > WALL_R) { bl.x = WALL_R - BALL_R; bl.vx = -Math.abs(bl.vx); s.ev.push({ k: 'wall' }); }
      if (bl.y - BALL_R < TOP) { bl.y = TOP + BALL_R; bl.vy = Math.abs(bl.vy); s.ev.push({ k: 'wall' }); }
      // the paddle: the angle from where it meets it (up to 60° off straight up)
      const pt = PADDLE_Y - PADDLE_H / 2;
      if (bl.vy > 0 && bl.y + BALL_R >= pt && oy + BALL_R <= pt + 2 && Math.abs(bl.x - s.px) <= hw + BALL_R) {
        const off = Math.max(-1, Math.min(1, (bl.x - s.px) / hw));
        bl.y = pt - BALL_R; s.hits++;
        // (never straight up: a ball going up and down one cleared column would never come back to the bricks)
        let a = Math.round(off * 170);
        if (Math.abs(a) < 16) a = a < 0 || (a === 0 && (s.hits & 1)) ? -16 : 16;
        aim(s, bl, a);
        s.ev.push({ k: 'paddle', x: bl.x, off });
      }
      // a brick
      let hitB = -1;
      for (let j = 0; j < s.bricks.length; j++) {
        const br = s.bricks[j];
        if (bl.x + BALL_R > br.x && bl.x - BALL_R < br.x + BW && bl.y + BALL_R > br.y && bl.y - BALL_R < br.y + BH) { hitB = j; break; }
      }
      if (hitB >= 0) {
        const br = s.bricks[hitB];
        const wasSide = ox + BALL_R <= br.x || ox - BALL_R >= br.x + BW;
        if (wasSide) { bl.vx = -bl.vx; bl.x = ox; } else { bl.vy = -bl.vy; bl.y = oy; }
        if (br.steel) s.ev.push({ k: 'steel', x: bl.x, y: bl.y });
        else if (--br.hp > 0) { addScore(s, 20); s.ev.push({ k: 'crack', x: br.x + BW / 2, y: br.y + BH / 2, hp: br.hp }); }
        else {
          s.bricks.splice(hitB, 1); s.broken++;
          const pts = ROW_PTS[Math.min(br.r, ROW_PTS.length - 1)] + (br.max - 1) * 40;
          addScore(s, pts);
          s.ev.push({ k: 'brick', x: br.x + BW / 2, y: br.y + BH / 2, r: br.r, pts });
          if (roll(s, 100) < 13) {
            let pick = roll(s, 100), c = 0;
            while (pick >= CAPSULE_ODDS[c]) { pick -= CAPSULE_ODDS[c]; c++; }
            s.caps.push({ x: br.x + BW / 2, y: br.y + BH / 2, k: CAPSULES[c] });
          }
        }
        break;
      }
    }
    if (bl.y - BALL_R > H) { s.balls.splice(i, 1); s.ev.push({ k: 'lost', x: bl.x }); }
  }
  // capsules fall; the paddle catches them
  for (let i = s.caps.length - 1; i >= 0; i--) {
    const c = s.caps[i]; c.y += 2;
    if (c.y > H) { s.caps.splice(i, 1); continue; }
    if (c.y + 6 >= PADDLE_Y - PADDLE_H / 2 && c.y - 6 <= PADDLE_Y + PADDLE_H / 2 && Math.abs(c.x - s.px) <= hw + 10) {
      s.caps.splice(i, 1); addScore(s, 100);
      if (c.k === 'W') s.wide = 900;
      else if (c.k === 'S') { s.slow = 600; for (const bl of s.balls) if (!bl.stuck) rescale(s, bl); }
      else if (c.k === 'L') { if (s.lives < 5) s.lives++; }
      else if (c.k === 'B') addScore(s, 400);
      else if (c.k === 'M') {
        const live = s.balls.filter(x => !x.stuck);
        for (const bl of live) for (const da of [-70, 70]) {   // two more, each turned 25° off it
          if (s.balls.length >= 6) break;
          const c = COS[da & 1023] / FX, sn = SIN[da & 1023] / FX;
          const nb = { x: bl.x, y: bl.y, vx: bl.vx * c - bl.vy * sn, vy: bl.vx * sn + bl.vy * c, stuck: false };
          steep(s, nb); s.balls.push(nb);
        }
      }
      s.ev.push({ k: 'cap', c: c.k, x: c.x, y: c.y });
    }
  }
  if (!s.balls.length) { s.lives--; s.deadT = 70; s.caps = []; s.wide = 0; s.slow = 0; s.ev.push({ k: 'die' }); return; }
  if (!breakable(s)) { addScore(s, 500 * s.level); s.clearT = 110; s.ev.push({ k: 'cleared', pts: 500 * s.level }); }
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ level: s.bestLevel, bricks: s.broken });
