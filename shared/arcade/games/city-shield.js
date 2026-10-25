// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// City Shield (docs/features/arcade.md): our own sky defence. Missiles rain down on six domed cities; tap the sky (or
// click, or aim with ▲ ▼ ◀ ▶ and press A) and the nearest of three launchers fires an interceptor that bursts there,
// taking out everything in its blast; a missile caught in it bursts too, so a good shot sets off a chain. From wave 3
// some missiles split in three, from wave 4 bombers cross and drop their own. Each launcher has ten shots a wave. Save
// cities for the bonus; a city is rebuilt for every 10,000 points. When the last city falls the game is over. The sim
// (rules only; the screen is client/arcade/games/city-shield.js): deterministic, see shared/arcade/core.js.
import { BTN, baseState, roll } from '../core.js';

export const W = 360, H = 480, GROUND = 440, CEIL = 24;
export const LAUNCHERS = [32, 180, 328], DOMES = [74, 110, 146, 214, 250, 286];
const AMMO = 10, BLAST_R = 30, CHAIN_R = 18, GROW = 22, HOLD = 10, SHRINK = 16;
export const multOf = s => Math.min(6, 1 + Math.floor((s.wave - 1) / 2));
const missileSpeed = s => Math.min(1.6, 0.42 + s.wave * 0.07);

function targets(s) {
  const t = [];
  s.domes.forEach((a, i) => { if (a) t.push([DOMES[i], GROUND - 4, 'dome', i]); });
  s.launchers.forEach((l, i) => { if (l.alive) t.push([LAUNCHERS[i], GROUND - 8, 'base', i]); });
  return t;
}
function missile(s, x, y, kindFrom = 'top') {
  const T = targets(s); if (!T.length) return null;
  // two times in three a city, else anything
  const domes = T.filter(t => t[2] === 'dome'), pick = domes.length && roll(s, 3) ? domes[roll(s, domes.length)] : T[roll(s, T.length)];
  const v = missileSpeed(s) * (0.85 + roll(s, 30) / 100), dx = pick[0] - x, dy = pick[1] - y, m = Math.sqrt(dx * dx + dy * dy) || 1;
  const split = kindFrom === 'top' && s.wave >= 3 && roll(s, 100) < Math.min(40, 10 + s.wave * 4) ? 120 + roll(s, 120) : 0;
  return { id: s.nextId++, x0: x, y0: y, x, y, vx: (dx / m) * v, vy: (dy / m) * v, tx: pick[0], ty: pick[1], what: pick[2], idx: pick[3], split };
}
function newWave(s) {
  s.toLaunch = Math.min(32, 10 + s.wave * 2); s.releaseT = 60;
  for (const l of s.launchers) { l.alive = true; l.ammo = AMMO; }
  if (s.spare > 0) { const i = s.domes.findIndex(a => !a); if (i >= 0) { s.domes[i] = true; s.spare--; s.ev.push({ k: 'rebuilt', i }); } }
  s.bomberT = s.wave >= 4 ? 300 + roll(s, 300) : -1;
}
export function init(seed) {
  const s = { ...baseState(seed), wave: 1, score: 0, spare: 0, extraAt: 10000, domes: DOMES.map(() => true), launchers: LAUNCHERS.map(() => ({ alive: true, ammo: AMMO })),
    missiles: [], shots: [], blasts: [], bombers: [], cross: { x: W / 2, y: 200 }, toLaunch: 0, releaseT: 0, tallyT: 0, overT: 0, nextId: 1, prev: 0, over: false, killed: 0, bestChain: 0, tally: null };
  newWave(s);
  return s;
}
function addScore(s, n) { s.score += n; while (s.score >= s.extraAt) { s.spare++; s.ev.push({ k: 'spare' }); s.extraAt += 10000; } }
function blast(s, x, y, r, chain) { s.blasts.push({ x, y, r: 0, max: r, t: 0, chain }); }
const blastR = b => (b.t < GROW ? (b.max * b.t) / GROW : b.t < GROW + HOLD ? b.max : Math.max(0, b.max * (1 - (b.t - GROW - HOLD) / SHRINK)));

export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev;
  s.prev = b;
  if (s.overT) { if (--s.overT <= 0) { s.over = true; s.ev.push({ k: 'over' }); } }
  // the crosshair: where the pointer is, or moved with the buttons
  const c = s.cross;
  if (inp.pd) { c.x = (inp.px / 255) * W; c.y = (inp.py / 255) * H; }
  else { c.x += ((b & BTN.R) ? 5 : 0) - ((b & BTN.L) ? 5 : 0); c.y += ((b & BTN.D) ? 5 : 0) - ((b & BTN.U) ? 5 : 0); }
  c.x = Math.max(6, Math.min(W - 6, c.x)); c.y = Math.max(CEIL + 6, Math.min(GROUND - 30, c.y));
  if (s.tallyT) {
    if (--s.tallyT <= 0) { s.tally = null; if (!s.domes.some(Boolean)) { s.overT = 1; } else { s.wave++; newWave(s); s.ev.push({ k: 'wave', wave: s.wave }); } }
    return;
  }
  // firing: the nearest launcher with a shot left
  if ((pressed & BTN.A) && !s.overT) {
    let best = -1, bd = Infinity;
    s.launchers.forEach((l, i) => { if (l.alive && l.ammo > 0) { const d = Math.abs(LAUNCHERS[i] - c.x); if (d < bd) { bd = d; best = i; } } });
    if (best < 0) s.ev.push({ k: 'empty' });
    else {
      const L = s.launchers[best], x = LAUNCHERS[best], y = GROUND - 14, dx = c.x - x, dy = c.y - y, m = Math.sqrt(dx * dx + dy * dy) || 1, v = best === 1 ? 7.5 : 5.5;
      L.ammo--; s.shots.push({ x, y, x0: x, y0: y, tx: c.x, ty: c.y, vx: (dx / m) * v, vy: (dy / m) * v });
      s.ev.push({ k: 'fire', i: best });
    }
  }
  // releasing the wave's missiles a few at a time
  if (s.toLaunch > 0 && --s.releaseT <= 0) {
    const n = Math.min(s.toLaunch, 1 + roll(s, Math.min(4, 1 + Math.floor(s.wave / 2))));
    for (let k = 0; k < n; k++) { const m = missile(s, 10 + roll(s, W - 20), CEIL); if (m) s.missiles.push(m); s.toLaunch--; }
    s.releaseT = Math.max(40, 150 - s.wave * 8) + roll(s, 60);
  }
  // bombers cross and drop their own
  if (s.bomberT > 0 && --s.bomberT === 0) { const left = roll(s, 2) === 0; s.bombers.push({ x: left ? -20 : W + 20, y: 110 + roll(s, 70), vx: left ? 1 : -1, dropT: 60 }); s.ev.push({ k: 'bomber' }); s.bomberT = s.toLaunch > 0 ? 500 + roll(s, 400) : -1; }
  for (let i = s.bombers.length - 1; i >= 0; i--) {
    const bo = s.bombers[i]; bo.x += bo.vx;
    if (--bo.dropT <= 0 && bo.x > 20 && bo.x < W - 20) { const m = missile(s, bo.x, bo.y + 6, 'bomber'); if (m) s.missiles.push(m); bo.dropT = 110; }
    if (bo.x < -30 || bo.x > W + 30) s.bombers.splice(i, 1);
  }
  // interceptors fly to their mark and burst
  for (let i = s.shots.length - 1; i >= 0; i--) {
    const sh = s.shots[i], dx = sh.tx - sh.x, dy = sh.ty - sh.y;
    if (dx * dx + dy * dy <= sh.vx * sh.vx + sh.vy * sh.vy) { blast(s, sh.tx, sh.ty, BLAST_R, 0); s.shots.splice(i, 1); s.ev.push({ k: 'burst', x: sh.tx, y: sh.ty }); }
    else { sh.x += sh.vx; sh.y += sh.vy; }
  }
  // missiles fall; some split
  for (let i = s.missiles.length - 1; i >= 0; i--) {
    const m = s.missiles[i];
    m.x += m.vx; m.y += m.vy;
    if (m.split && m.y >= m.split) {
      s.missiles.splice(i, 1);
      for (let k = 0; k < 3; k++) { const n = missile(s, m.x, m.y, 'split'); if (n) { n.x0 = m.x0; n.y0 = m.y0; n.sx = m.x; n.sy = m.y; s.missiles.push(n); } }
      s.ev.push({ k: 'split', x: m.x, y: m.y });
      continue;
    }
    if (m.y >= m.ty) {
      s.missiles.splice(i, 1);
      if (m.what === 'dome' && s.domes[m.idx]) { s.domes[m.idx] = false; s.ev.push({ k: 'dome', i: m.idx, x: m.tx }); }
      else if (m.what === 'base' && s.launchers[m.idx].alive) { s.launchers[m.idx].alive = false; s.launchers[m.idx].ammo = 0; s.ev.push({ k: 'base', i: m.idx, x: m.tx }); }
      else s.ev.push({ k: 'thud', x: m.tx });
      if (!s.domes.some(Boolean) && !s.overT) { s.overT = 150; s.ev.push({ k: 'fallen' }); }
    }
  }
  // blasts grow, hold and fade, catching what's in them (a caught missile bursts: chains)
  for (let i = s.blasts.length - 1; i >= 0; i--) {
    const bl = s.blasts[i]; bl.t++;
    const r = blastR(bl);
    if (bl.t > GROW + HOLD + SHRINK) { s.blasts.splice(i, 1); continue; }
    for (let j = s.missiles.length - 1; j >= 0; j--) {
      const m = s.missiles[j], dx = m.x - bl.x, dy = m.y - bl.y;
      if (dx * dx + dy * dy <= r * r) {
        s.missiles.splice(j, 1); s.killed++;
        const chain = bl.chain + 1; s.bestChain = Math.max(s.bestChain, chain);
        const pts = 25 * multOf(s) * Math.min(chain, 5);
        addScore(s, pts); blast(s, m.x, m.y, CHAIN_R, chain);
        s.ev.push({ k: 'kill', x: m.x, y: m.y, pts, chain });
      }
    }
    for (let j = s.bombers.length - 1; j >= 0; j--) {
      const bo = s.bombers[j], dx = bo.x - bl.x, dy = bo.y - bl.y;
      if (dx * dx + dy * dy <= (r + 8) * (r + 8)) { s.bombers.splice(j, 1); const pts = 100 * multOf(s); addScore(s, pts); blast(s, bo.x, bo.y, CHAIN_R + 6, bl.chain + 1); s.ev.push({ k: 'bomberDown', x: bo.x, y: bo.y, pts }); }
    }
  }
  // the wave is over: the tally
  if (!s.overT && s.toLaunch === 0 && !s.missiles.length && !s.shots.length && !s.blasts.length && !s.bombers.length) {
    const mult = multOf(s), domes = s.domes.filter(Boolean).length, ammo = s.launchers.reduce((a, l) => a + (l.alive ? l.ammo : 0), 0);
    const bonus = (domes * 100 + ammo * 5) * mult;
    addScore(s, bonus);
    s.tally = { domes, ammo, mult, bonus };
    s.tallyT = 170; s.ev.push({ k: 'tally', bonus });
  }
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ wave: s.wave, missiles: s.killed, chain: s.bestChain });
export { blastR };
