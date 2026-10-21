// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fight with a hooked fish (docs/features/fishing.md §The fight): what makes the game. The fish has stamina (S, in
// seconds of good fighting) and a pull (P, kgf) from its species and weight, and a temperament that sets how it moves
// through its modes - runs (left, right, away), rests, dives, head-shakes, charges at the boat and jumps. The player
// holds REEL to gain line and tire it, and steers the rod AGAINST its run to turn it (tiring it faster, at more tension).
// Tension over the drag gives line (the fish gains ground); a spike over the line's strength snaps it. A jump wants a
// bow (release and tap in time) - miss it on a tight line and the spike can snap the line; on a slack line it throws the
// hook. Slack too long throws the hook too; all the line out spools the reel. Beaten and close: LAND.
//
// Deterministic for a seed (the fish's moves), stepped at FIGHT_DT; run in the angler's browser. The server doesn't
// replay it: it only checks that a landing came no sooner than the fastest fight that gear could have won
// (minFightSeconds). botInput() is a good player, for the tests and the balance.
import { RNG } from './rng.js';

export const FIGHT_DT = 1 / 30;
export const MAX_FIGHT_S = 240;        // a fight still going after this: the hook pulls free
const LAND_D = 3;                       // m: close enough to net
const READY_S = 0.22;                   // stamina (of S0) at which a fish close by can be landed
const SLACK_S = 2.4;                    // s of slack line before the hook falls out
const JUMP_WIN = 0.75;                  // s to bow to a jump
const BOW_BONUS = 0.06;                 // of S0: a bowed jump tires it
const ROD_LIMIT = 0.25;                 // drain when the fish is too heavy for the rod
// (2026-10-15, the fishing game's polish: a fight should be a minute's fun, not four) - a fish too heavy for the rod
// pulls free after HEAVY_S (the player is told when it's hooked), and every fish tires faster once a fight has gone on
// FATIGUE_T s: its drain grows by one more for every FATIGUE_RAMP s after that (minFightSeconds counts it)
export const HEAVY_S = 30;
const FATIGUE_T = 40, FATIGUE_RAMP = 25;
const fatigue = t => 1 + Math.max(0, t - FATIGUE_T) / FATIGUE_RAMP;

// The modes a temperament moves through: weights [run, rest, dive, shake, toward] (jumps: the species' jump × 6).
const MODES = {
  steady: [3, 4, 1, 1, 1], runner: [6, 3, 1, 1, 1.5], jumper: [4, 3, 0.5, 1.5, 1], diver: [3, 3, 5, 1, 0.5], thrasher: [3, 3, 1, 5, 1], bulldog: [2, 3, 6, 2, 0.3],
};
const MODE_IDS = ['run', 'rest', 'dive', 'shake', 'toward'];

/** The fish as the fight sees it: { P (kgf, its full pull), S0 (s), vs (m/s, its run speed), temper, jump, kg }. */
export function fishParams(sp, kg) {
  const F = sp.fight;
  return { kg, P: F.power * 1.25 * Math.pow(kg, 0.6) + 0.15, S0: 10 * Math.pow(kg, 0.36) * F.stamina, vs: F.speed * (1 + 0.6 * Math.pow(kg, 0.2)), temper: F.temper, jump: F.jump };
}

/**
 * A fight's state. sp: the species (shared/fish-species.js), fish: { kg }, L: the angler's loadout (shared/fishing-gear.js
 * loadout()), d0: the line out when hooked (m), seed: the fish's moves.
 */
export function fightSetup(sp, fish, L, { d0 = 20, seed = 1 } = {}) {
  const p = fishParams(sp, fish.kg);
  return {
    p, L, rng: new RNG(seed >>> 0), t: 0, d: Math.max(LAND_D + 1, d0), S: p.S0, T: 0,
    mode: 'run', modeT: 1.2, dir: 0, e: 1, slack: 0, jump: null, ready: 0, out: null, jumps: 0, bowed: 0, spikes: 0,
    heavy: fish.kg > L.maxKg,
  };
}

function nextMode(F) {
  const { p, rng } = F, w = [...MODES[p.temper] || MODES.steady];
  const tired = 1 - F.S / p.S0;
  w[1] *= 1 + 2 * tired;                         // a tired fish rests more
  const jw = p.jump * 6 * (1 - 0.5 * tired);
  const entries = MODE_IDS.map((m, k) => [m, w[k]]);
  if (jw > 0) entries.push(['jump', jw]);
  if (F.d <= LAND_D + 0.5) for (const e of entries) if (e[0] === 'toward') e[1] = 0;
  F.mode = rng.weighted(entries);
  const big = Math.min(1.6, 0.6 + Math.pow(p.kg, 0.2) * 0.35);
  F.modeT = { run: rng.float(1.8, 4.5) * big, rest: rng.float(1.4, 3.4) * (1 + tired), dive: rng.float(1.8, 3.8) * big, shake: rng.float(0.9, 2.0), toward: rng.float(1.2, 2.6), jump: 1.25 }[F.mode];
  F.dir = F.mode === 'run' ? rng.pick([-1, 1, 0]) : F.mode === 'shake' ? rng.sign() : 0;
  if (F.mode === 'jump') { F.jump = { t: 0, bowed: false }; F.jumps++; }
}

/**
 * One step. input: { reel (bool), steer (−1 left … 1 right), bow (pressed this step), land (pressed) }. Returns the
 * events of this step: 'jump' (it leaps: show it and the prompt), 'bowed', 'spike', 'payout' (line running out),
 * 'slack', 'ready' (LAND now), or the end: 'landed', 'snap' (line broke), 'spat' (the hook fell out), 'spool' (no
 * line left), 'free' (too long).
 */
export function fightStep(F, input = {}, dt = FIGHT_DT) {
  if (F.out) return [];
  const ev = [], { p, L } = F;
  F.t += dt;
  if ((F.modeT -= dt) <= 0) { if (F.mode === 'jump' && F.jump && !F.jump.bowed) F.jump = null; nextMode(F); if (F.mode === 'jump') ev.push('jump'); }
  const energy = 0.2 + 0.8 * Math.max(0, F.S / p.S0);   // (a beaten fish hardly pulls: it comes in)
  const eff = { run: 1, rest: 0.22, dive: 0.85, shake: 0.55, toward: 0.25, jump: 0.6 }[F.mode] * energy;
  const reel = !!input.reel, against = F.dir ? Math.max(-1, Math.min(1, -(input.steer || 0) * F.dir)) : 0;
  // the tension: the fish's pull through the rod (more when held against its run), and the reel's own load
  let T = p.P * eff * (0.8 + 0.35 * against) * L.calm + (reel ? 0.2 * p.P * energy + 0.1 : 0);
  if (F.mode === 'toward') T *= reel ? 0.5 : 0.15;
  if (F.mode === 'shake') T *= 1 + 0.45 * Math.abs(Math.sin(F.t * 11));
  // over the drag: line runs out (the fish gains), the tension held at the drag
  if (T > L.drag) {
    const vf = p.vs * eff * (1 - 0.4 * Math.max(0, against));
    F.d += (vf * (1 - L.drag / T) + 0.15) * dt;
    T = L.drag; ev.push('payout');
  } else if (reel) {
    const vr = L.speed * (0.55 + 2.0 * Math.pow(Math.max(0, 1 - T / L.drag), 1.5)) * (F.mode === 'dive' ? 0.25 + 0.7 * (1 - energy) : 1);   // (a tired fish's dive gives way)
    F.d -= vr * dt;
  }
  if (F.mode === 'toward') F.d -= p.vs * 0.35 * energy * dt;
  // spikes: a head-shake's peaks; a jump not bowed to
  let spike = 0;
  if (F.mode === 'shake' && Math.abs(Math.sin(F.t * 11)) > 0.97) spike = T * 1.45;
  if (F.mode === 'jump' && F.jump) {
    F.jump.t += dt;
    if (!F.jump.bowed && input.bow && !reel && F.jump.t <= JUMP_WIN) { F.jump.bowed = true; F.bowed++; F.S -= BOW_BONUS * p.S0; ev.push('bowed'); }
    if (!F.jump.bowed && F.jump.t > JUMP_WIN && !F.jump.hit) {
      F.jump.hit = true;
      if (T < 0.12 * p.P && F.rng.chance(0.45)) { F.out = 'spat'; ev.push('spat'); return ev; }
      spike = Math.max(spike, (T + 0.35 * p.P) * 1.6);
    }
  }
  if (spike) { F.spikes++; ev.push('spike'); if (spike > L.kgf) { F.out = 'snap'; F.T = spike; ev.push('snap'); return ev; } }
  F.T = T;
  // the fish tires with the tension it pulls against and with every turn of the reel; it gets its wind back on a slack line
  const drain = L.power * (0.55 * Math.min(1.6, T / p.P) + (reel ? 0.45 : 0.1)) * (1 + 0.5 * Math.max(0, against)) * (F.heavy ? ROD_LIMIT : 1) * fatigue(F.t);
  F.S -= drain * dt;
  if (T < 0.2 * p.P && !reel) F.S += 0.02 * p.S0 * dt;
  F.S = Math.max(0, Math.min(p.S0, F.S));
  if (against > 0 && F.mode === 'run') F.modeT -= 0.8 * against * dt;   // turned: its run ends sooner
  // slack line
  if (T < 0.08 * p.P + 0.05 && F.mode !== 'rest' && F.mode !== 'jump') { F.slack += dt; if (F.slack > 0.6) ev.push('slack'); }
  else F.slack = Math.max(0, F.slack - 2 * dt);
  if (F.slack > SLACK_S) { F.out = 'spat'; ev.push('spat'); return ev; }
  // close by: beaten, it can be landed; not beaten, it fights beside the boat
  if (F.d <= LAND_D) {
    F.d = LAND_D;
    if (F.S <= READY_S * p.S0) {
      if (!F.ready) ev.push('ready');
      F.ready += dt;
      if (input.land) { F.out = 'landed'; ev.push('landed'); return ev; }
      if (F.ready > 4) { F.ready = 0; F.S += 0.15 * p.S0; F.mode = 'run'; F.modeT = 2; F.dir = F.rng.sign(); }
    }
  } else F.ready = 0;
  if (F.d >= L.cap) { F.out = 'spool'; ev.push('spool'); return ev; }
  if (F.heavy && F.t >= HEAVY_S) { F.out = 'free'; ev.push('heavy'); return ev; }   // (too much for the rod: it wins)
  if (F.t >= MAX_FIGHT_S) { F.out = 'free'; ev.push('free'); }
  return ev;
}

/**
 * The fastest a fish could be landed with this gear (s), whatever the player did: its stamina at the most it can drain
 * (the tension at its most, reeling, held against it, every jump bowed to), or the line to reel in at the reel's top
 * speed - and 20 % to spare. The server refuses a landing sooner than this.
 */
export function minFightSeconds(sp, kg, L, d0) {
  const p = fishParams(sp, kg), heavy = kg > L.maxKg ? ROD_LIMIT : 1;
  const maxDrain = L.power * (0.55 * Math.min(1.6, L.drag * 1.05 / p.P) + 0.45) * 1.5 * heavy;   // (the tension never above the drag but in a spike)
  // the stamina to drain at the most, the fight's fatigue counted (it grows after FATIGUE_T)
  let need = (1 - READY_S - 5 * BOW_BONUS) * p.S0, stam = 0;
  while (need > 0 && stam < MAX_FIGHT_S) { need -= maxDrain * fatigue(stam) * 0.1; stam += 0.1; }
  const reel = Math.max(0, d0 - LAND_D) / (L.speed * 2.55 + p.vs * 0.35);
  return 0.8 * Math.max(stam, reel);
}

/** A good player: reels unless the tension is near the drag, holds the rod against every run, bows to jumps, lands. */
export function botInput(F, skill = 1) {
  const near = F.T > F.L.drag * (0.86 - 0.1 * (1 - skill)), bow = !!(F.jump && !F.jump.bowed && F.jump.t > 0.15 + 0.7 * (1 - skill));
  return { reel: !bow && !(F.jump && !F.jump.bowed && skill > 0.5) && (!near || F.mode === 'toward'), steer: F.dir ? -F.dir * skill : 0, bow, land: F.ready > 0.2 };
}
