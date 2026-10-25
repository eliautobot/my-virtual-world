// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Star Siege (docs/features/arcade.md): our own fixed shooter. A fleet of drones marches side to side and steps down;
// the fewer are left, the faster they go. Hold A to fire, ◀ ▶ to move; hide behind the shield pods (they wear away);
// shoot the command saucer for a bonus. A wave cleared brings the next, lower and angrier. Three ships; another at 1,500
// points and every 10,000 after. The sim (rules only; the screen is client/arcade/games/star-siege.js): deterministic,
// see shared/arcade/core.js. Coordinates are the screen's own 360 × 480, in whole pixels.
import { BTN, baseState, roll } from '../core.js';

export const W = 360, H = 480;
export const FCOLS = 9, FROWS = 5, DX = 30, DY = 26, AW = 22, AH = 16;
export const PLAYER_Y = 440, PW = 26, PH = 14, GROUND = 462;
export const SHIELD_X = [63, 141, 219, 297], SHIELD_Y = 372, SC = 2, SW = 14, SH = 10;   // pods of 14 × 10 cells of 2 px
const ROW_PTS = [30, 20, 20, 10, 10];
const SAUCER_PTS = [50, 100, 100, 150, 150, 300];
const SHOT_V = 9, PLAYER_V = 3, SAUCER_Y = 62, INVADE_Y = 424;

/** Whether cell (x, y) of a fresh shield pod is solid: a rounded pod with an arch underneath (our own shape). */
export function podCell(x, y) {
  if (y === 0) return x >= 3 && x <= 10;
  if (y === 1) return x >= 1 && x <= 12;
  if (y === 6) return x < 5 || x > 8;
  if (y >= 7) return x < 4 || x > 9;
  return true;
}
function freshShields() {
  return SHIELD_X.map(() => { const c = new Array(SW * SH); for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) c[y * SW + x] = podCell(x, y) ? 1 : 0; return c; });
}
function newWave(s) {
  s.alive = new Array(FCOLS * FROWS).fill(1);
  s.left = FCOLS * FROWS;
  s.fx = Math.floor((W - ((FCOLS - 1) * DX + AW)) / 2);
  s.fy = 92 + Math.min(s.wave - 1, 6) * 10;
  s.dir = 1; s.stepT = 0; s.frame = 0; s.steps = 0;
  s.bombs = []; s.shot = null; s.shields = freshShields(); s.saucer = null;
  s.nextSaucer = s.t + 900 + roll(s, 600);
}
export function init(seed) {
  const s = { ...baseState(seed), score: 0, lives: 3, extraAt: 1500, wave: 1, px: W / 2, dead: 0, inv: 0, over: false, overT: 0,
    clearT: 0, kills: 0, saucers: 0, prev: 0 };
  newWave(s);
  return s;
}
/** The formation's alien k at (x, y) top-left. */
export const alienAt = (s, k) => [s.fx + (k % FCOLS) * DX, s.fy + Math.floor(k / FCOLS) * DY];
const hit = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
function stepInterval(s) { return Math.max(1, Math.floor(s.left * 0.55) - Math.min(8, s.wave - 1)); }
function addScore(s, n) {
  s.score += n;
  while (s.score >= s.extraAt) { if (s.lives < 5) { s.lives++; s.ev.push({ k: 'life' }); } s.extraAt = s.extraAt === 1500 ? 10000 : s.extraAt + 10000; }
}
/** Wears shield cells round (cx, cy) (screen px) away: a small blast with a few ragged cells; true if any was solid. */
function blast(s, cx, cy, r = 2) {
  let any = false;
  SHIELD_X.forEach((sx, k) => {
    const x0 = sx - (SW * SC) / 2, gx = Math.floor((cx - x0) / SC), gy = Math.floor((cy - SHIELD_Y) / SC);
    if (gx < -r || gx >= SW + r || gy < -r || gy >= SH + r) return;
    const c = s.shields[k];
    for (let y = gy - r; y <= gy + r; y++) for (let x = gx - r; x <= gx + r; x++) {
      if (x < 0 || x >= SW || y < 0 || y >= SH) continue;
      const d = Math.abs(x - gx) + Math.abs(y - gy);
      if (d <= r - 1 || (d <= r && roll(s, 2))) { if (c[y * SW + x]) any = true; c[y * SW + x] = 0; }
    }
  });
  return any;
}
/** Whether a box (screen px) touches a solid shield cell; → [pod, x, y] of the first, or null. */
function shieldHit(s, x, y, w, h) {
  for (let k = 0; k < SHIELD_X.length; k++) {
    const x0 = SHIELD_X[k] - (SW * SC) / 2;
    if (!hit(x, y, w, h, x0, SHIELD_Y, SW * SC, SH * SC)) continue;
    const c = s.shields[k];
    const gx0 = Math.max(0, Math.floor((x - x0) / SC)), gx1 = Math.min(SW - 1, Math.floor((x + w - 1 - x0) / SC));
    const gy0 = Math.max(0, Math.floor((y - SHIELD_Y) / SC)), gy1 = Math.min(SH - 1, Math.floor((y + h - 1 - SHIELD_Y) / SC));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) if (c[gy * SW + gx]) return [k, x0 + gx * SC + 1, SHIELD_Y + gy * SC + 1];
  }
  return null;
}

export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b;
  s.prev = b;
  // ending: the last ship gone (a moment to see it go) or the fleet landed
  if (s.overT) { if (--s.overT <= 0) { s.over = true; s.ev.push({ k: 'over' }); } return; }
  if (s.clearT) { if (--s.clearT <= 0) { s.wave++; newWave(s); s.ev.push({ k: 'wave', wave: s.wave }); } return; }
  // the ship
  if (s.dead) {
    if (--s.dead <= 0) { if (s.lives > 0) { s.px = W / 2; s.inv = 90; s.ev.push({ k: 'respawn' }); } else { s.overT = 30; } }
  } else {
    if (s.inv) s.inv--;
    const dir = (b & BTN.L) && !(b & BTN.R) ? -1 : (b & BTN.R) && !(b & BTN.L) ? 1 : 0;
    s.px = Math.max(16, Math.min(W - 16, s.px + dir * PLAYER_V));
    if ((b & BTN.A) && !s.shot) { s.shot = { x: s.px - 1, y: PLAYER_Y - PH / 2 - 10 }; s.ev.push({ k: 'fire', x: s.px }); }
  }
  // the shot
  if (s.shot) {
    const sh = s.shot;
    sh.y -= SHOT_V;
    let gone = sh.y < 40;
    if (gone) s.ev.push({ k: 'miss', x: sh.x, y: 40 });
    if (!gone) {   // a drone
      for (let k = 0; k < s.alive.length && !gone; k++) {
        if (!s.alive[k]) continue;
        const [ax, ay] = alienAt(s, k);
        if (hit(sh.x, sh.y, 2, 10, ax, ay, AW, AH)) {
          s.alive[k] = 0; s.left--; s.kills++; gone = true;
          const row = Math.floor(k / FCOLS);
          addScore(s, ROW_PTS[row]);
          s.ev.push({ k: 'kill', x: ax + AW / 2, y: ay + AH / 2, row, pts: ROW_PTS[row] });
        }
      }
    }
    if (!gone && s.saucer && hit(sh.x, sh.y, 2, 10, s.saucer.x - 16, SAUCER_Y - 7, 32, 14)) {
      const v = SAUCER_PTS[roll(s, SAUCER_PTS.length)];
      addScore(s, v); s.saucers++;
      s.ev.push({ k: 'saucer', x: s.saucer.x, y: SAUCER_Y, pts: v });
      s.saucer = null; gone = true;
    }
    if (!gone) for (let n = 0; n < s.bombs.length; n++) {
      const bo = s.bombs[n];
      if (hit(sh.x - 2, sh.y, 6, 10, bo.x - 2, bo.y, 5, 10)) { s.bombs.splice(n, 1); gone = true; s.ev.push({ k: 'clash', x: bo.x, y: bo.y }); addScore(s, 5); break; }
    }
    if (!gone) { const q = shieldHit(s, sh.x, sh.y, 2, 10); if (q) { blast(s, q[1], q[2], 2); gone = true; s.ev.push({ k: 'chip', x: q[1], y: q[2] }); } }
    if (gone) s.shot = null;
  }
  // the fleet marches: one step every stepInterval steps, down and back at an edge
  if (++s.stepT >= stepInterval(s) && s.left > 0) {
    s.stepT = 0; s.frame ^= 1; s.steps++;
    let lo = W, hi = 0, bottom = 0;
    for (let k = 0; k < s.alive.length; k++) if (s.alive[k]) { const [ax, ay] = alienAt(s, k); lo = Math.min(lo, ax); hi = Math.max(hi, ax + AW); bottom = Math.max(bottom, ay + AH); }
    const v = s.wave > 3 ? 5 : 4;
    if ((s.dir > 0 && hi + v > W - 6) || (s.dir < 0 && lo - v < 6)) { s.fy += 12; s.dir = -s.dir; bottom += 12; }
    else s.fx += s.dir * v;
    s.ev.push({ k: 'march', n: s.steps & 3 });
    // drones going through a shield wear it away
    for (let k = 0; k < s.alive.length; k++) if (s.alive[k]) { const [ax, ay] = alienAt(s, k); if (ay + AH >= SHIELD_Y && ay <= SHIELD_Y + SH * SC) for (let x = ax; x < ax + AW; x += 4) blast(s, x, ay + AH - 2, 1); }
    if (bottom >= INVADE_Y) { s.lives = 0; s.dead = 0; s.overT = 60; s.ev.push({ k: 'invade' }); return; }
  }
  // bombs
  if (!s.dead && !s.clearT) {
    const max = Math.min(6, 3 + Math.floor(s.wave / 2)), rate = 16 + s.wave * 4;
    if (s.bombs.length < max && roll(s, 1000) < rate) {
      const cols = [];
      for (let c = 0; c < FCOLS; c++) for (let r = FROWS - 1; r >= 0; r--) if (s.alive[r * FCOLS + c]) { cols.push([c, r]); break; }
      if (cols.length) {
        let pick;
        if (roll(s, 10) < 4) {   // aimed: the column over the ship
          pick = cols[0];
          for (const cr of cols) { const [ax] = alienAt(s, cr[1] * FCOLS + cr[0]); const [px] = alienAt(s, pick[1] * FCOLS + pick[0]); if (Math.abs(ax + AW / 2 - s.px) < Math.abs(px + AW / 2 - s.px)) pick = cr; }
        } else pick = cols[roll(s, cols.length)];
        const [ax, ay] = alienAt(s, pick[1] * FCOLS + pick[0]);
        const kind = roll(s, 3);
        s.bombs.push({ x: ax + AW / 2, y: ay + AH, k: kind, v: kind === 2 ? 4 : 3 });
      }
    }
  }
  for (let n = s.bombs.length - 1; n >= 0; n--) {
    const bo = s.bombs[n];
    bo.y += bo.v;
    if (bo.y > GROUND - 8) { s.bombs.splice(n, 1); s.ev.push({ k: 'puff', x: bo.x, y: GROUND - 4 }); continue; }
    const q = shieldHit(s, bo.x - 1, bo.y, 3, 10);
    if (q) { blast(s, q[1], q[2] + 2, 2); s.bombs.splice(n, 1); s.ev.push({ k: 'chip', x: q[1], y: q[2] }); continue; }
    if (!s.dead && !s.inv && hit(bo.x - 1, bo.y, 3, 10, s.px - PW / 2, PLAYER_Y - PH / 2, PW, PH)) {
      s.bombs.splice(n, 1); s.lives--; s.dead = 100; s.shot = null;
      s.ev.push({ k: 'die', x: s.px, y: PLAYER_Y });
    }
  }
  // the command saucer
  if (s.saucer) {
    s.saucer.x += s.saucer.d * 2;
    if (s.saucer.x < -20 || s.saucer.x > W + 20) s.saucer = null;
  } else if (s.t >= s.nextSaucer && s.left >= 8) {
    const d = roll(s, 2) ? 1 : -1;
    s.saucer = { x: d > 0 ? -16 : W + 16, d };
    s.nextSaucer = s.t + 1300 + roll(s, 900);
    s.ev.push({ k: 'saucerIn' });
  }
  if (s.left === 0 && !s.clearT) { s.clearT = 100; s.bombs = []; s.shot = null; addScore(s, 100 * s.wave); s.ev.push({ k: 'cleared', wave: s.wave, pts: 100 * s.wave }); }
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ wave: s.wave, kills: s.kills, saucers: s.saucers });
