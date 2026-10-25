// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Claw Catch (docs/features/arcade.md "The machines"): the Claw Machine played for real (its glass box of prizes, its
// gantry and claw, its chute: shared/arcade/machines.js CLAW). Five tries. Steer the claw over the prizes, press A: it
// drops, closes and lifts. Right over a prize it has it; to one side it may not, or it slips on the way up. What it holds
// it carries to the chute and lets go: bears 100, bunnies 150, dinosaurs 250, the golden star 1000 (hard to hold). Twenty
// seconds a try to steer; then it drops where it is. Win all five tries: 500 more.
// Controls: ▲ ▼ ◀ ▶ steer (▲ away from you), A drops; or the pointer on the glass (where it points over the prizes: the
// game in the world tells it, px and py across the field) and a tap drops. The sim (rules only; the game in the world is
// client/js/play/machines/claw-catch.js): deterministic, see shared/arcade/core.js; metres in the machine's frame (x
// right, z toward you), steps of 1/60 s.
import { BTN, baseState, roll } from '../core.js';
import { CLAW } from '../machines.js';

export const TRIES = 5, STEER = 20 * 60, KINDS = Object.freeze([
  { id: 'bear', pts: 100, grip: 0.92, r: 0.05, chance: 60 },
  { id: 'bunny', pts: 150, grip: 0.82, r: 0.045, chance: 25 },
  { id: 'dino', pts: 250, grip: 0.7, r: 0.05, chance: 11 },
  { id: 'star', pts: 1000, grip: 0.45, r: 0.045, chance: 4 },
]);
const R = CLAW.reach, SPEED = 0.3 / 60, REACH = 0.085, DROP = 46, CLOSE = 18, LIFT = 46, OPEN = 16;
const [CX, CZ] = CLAW.chute;
/** The pointer's place over the field (px, py: 0 … 255 across it, as the game in the world sends it) and back. */
export const toPx = (x, z) => [Math.round(((x + R) / (2 * R)) * 255), Math.round(((z + R) / (2 * R)) * 255)];
const fromPx = (px, py) => [(px / 255) * 2 * R - R, (py / 255) * 2 * R - R];
function prizes(s) {
  const out = [];
  for (let tries = 0; out.length < 14 && tries < 400; tries++) {
    const x = (roll(s, 1000) / 1000) * 1.7 * R - 0.85 * R, z = (roll(s, 1000) / 1000) * 1.7 * R - 0.85 * R;
    if ((x - CX) ** 2 + (z - CZ) ** 2 < 0.16 * 0.16) continue;   // (not on the chute)
    if (out.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < 0.095 * 0.095)) continue;
    const r = roll(s, 100);
    let k = 0, acc = 0; for (; k < KINDS.length - 1; k++) { acc += KINDS[k].chance; if (r < acc) break; }
    out.push({ id: out.length, kind: k, x, z, yaw: roll(s, 1024), won: false });
  }
  // the golden star, always one, in the middle third
  if (!out.some(p => p.kind === 3)) { const p = out[roll(s, out.length)]; p.kind = 3; }
  return out;
}
export function init(seed) {
  const s = { ...baseState(seed), try: 0, ph: 'steer', pt: 0, x: CX, z: CZ, drop: 0, open: 1, hold: -1, slip: -1, wins: 0, score: 0, prev: 0, over: false, won: [] };
  s.prizes = prizes(s);
  return s;
}
/** The prize the claw would take from here, and how surely (0 … 1). */
function takes(s) {
  let best = null, bd = REACH;
  for (const p of s.prizes) { if (p.won || p.held) continue; const d = Math.sqrt((p.x - s.x) ** 2 + (p.z - s.z) ** 2); if (d < bd) { bd = d; best = p; } }
  return best ? { p: best, sure: (1 - bd / REACH) * KINDS[best.kind].grip } : null;
}
function next(s) {
  s.try++;
  if (s.try >= TRIES) { if (s.wins === TRIES) { s.score += 500; s.ev.push({ k: 'master' }); } s.over = true; s.ev.push({ k: 'over' }); return; }
  s.ph = 'steer'; s.pt = 0; s.hold = -1; s.slip = -1; s.open = 1;
  s.ev.push({ k: 'ready', n: s.try + 1 });
}
export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev;
  s.prev = b;
  s.pt++;
  if (s.ph === 'steer') {
    let dx = 0, dz = 0;
    if (inp.pd && !(b & (BTN.L | BTN.R | BTN.U | BTN.D))) { const [tx, tz] = fromPx(inp.px, inp.py); dx = tx - s.x; dz = tz - s.z; const d = Math.sqrt(dx * dx + dz * dz); if (d > SPEED) { dx = (dx / d) * SPEED; dz = (dz / d) * SPEED; } }
    else {
      if (b & BTN.L) dx -= SPEED; if (b & BTN.R) dx += SPEED; if (b & BTN.U) dz -= SPEED; if (b & BTN.D) dz += SPEED;
      if (dx && dz) { dx *= 0.7071; dz *= 0.7071; }
    }
    s.x = Math.max(-R, Math.min(R, s.x + dx)); s.z = Math.max(-R, Math.min(R, s.z + dz));
    s.moving = dx || dz ? 1 : 0;
    if (pressed & BTN.A || s.pt >= STEER) { s.ph = 'drop'; s.pt = 0; s.ev.push({ k: 'drop', auto: s.pt >= STEER }); }
    else if (s.pt === STEER - 5 * 60) s.ev.push({ k: 'hurry' });
    return;
  }
  if (s.ph === 'drop') { s.drop = s.pt / DROP; if (s.pt >= DROP) { s.drop = 1; s.ph = 'close'; s.pt = 0; } return; }
  if (s.ph === 'close') {
    s.open = 1 - s.pt / CLOSE;
    if (s.pt >= CLOSE) {
      s.open = 0;
      const t = takes(s);
      // a sure grip holds; an unsure one may hold, and may let go on the way up
      if (t && roll(s, 1000) < t.sure * 1000 + 120) { s.hold = t.p.id; t.p.held = true; s.slip = t.sure < 0.55 && roll(s, 100) < 55 ? 10 + roll(s, LIFT - 14) : -1; s.ev.push({ k: 'grab', kind: t.p.kind }); }
      else s.ev.push({ k: 'miss' });
      s.ph = 'lift'; s.pt = 0;
    }
    return;
  }
  if (s.ph === 'lift') {
    s.drop = 1 - s.pt / LIFT;
    if (s.hold >= 0 && s.pt === s.slip) {   // it slips out and drops back on the pile, a little to one side
      const p = s.prizes[s.hold]; p.held = false; p.x = Math.max(-R, Math.min(R, s.x + (roll(s, 41) - 20) / 1000)); p.z = Math.max(-R, Math.min(R, s.z + (roll(s, 41) - 20) / 1000));
      s.ev.push({ k: 'slip', kind: p.kind, x: p.x, z: p.z, h: s.drop }); s.hold = -1;
    }
    if (s.pt >= LIFT) { s.drop = 0; s.ph = 'carry'; s.pt = 0; }
    return;
  }
  if (s.ph === 'carry') {   // back over the chute
    const dx = CX - s.x, dz = CZ - s.z, d = Math.sqrt(dx * dx + dz * dz), v = SPEED * 1.4;
    if (d > v) { s.x += (dx / d) * v; s.z += (dz / d) * v; } else { s.x = CX; s.z = CZ; s.ph = 'release'; s.pt = 0; }
    return;
  }
  if (s.ph === 'release') {
    s.open = s.pt / OPEN;
    if (s.pt === 4 && s.hold >= 0) {
      const p = s.prizes[s.hold]; p.won = true; p.held = false; s.wins++; s.score += KINDS[p.kind].pts; s.won.push(p.kind);
      s.ev.push({ k: 'win', kind: p.kind, pts: KINDS[p.kind].pts }); s.hold = -1;
    }
    if (s.pt >= OPEN + 30) next(s);
  }
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ wins: s.wins, won: s.won });
