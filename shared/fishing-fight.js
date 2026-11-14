// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fight with a hooked fish (docs/features/fishing.md §The fight): what makes the game. The fish has stamina (S, in
// seconds of good fighting) and a pull (P, kgf) from its species and weight, and a temperament that sets how it moves
// through its modes — runs (left, right, away), rests, dives, head-shakes, charges at the boat and jumps. The player
// holds REEL to gain line and tire it, and steers the rod AGAINST its run to turn it (tiring it faster, at more tension).
// Tension over the drag gives line (the fish gains ground); a spike over the line's strength snaps it. A jump wants a
// bow (release and tap in time) — miss it on a tight line and the spike can snap the line; on a slack line it throws the
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
const SLACK_S = 1.9;                    // s of slack line before the hook falls out (2.4 until 2026-11-13: "fishing seems fairly easy")
const JUMP_WIN = 0.65;                  // s to bow to a jump (0.75 until 2026-11-13)
// Strain (2026-11-13, the owner: "fishing seems fairly easy"): cranking the reel while the fish takes line off it (the
// tension at the drag) strains the line; held there STRAIN_S s it snaps. Easing off lets it recover — so reeling all
// fight long no longer wins: you reel when it gives, hold when it runs.
const STRAIN_S = 1.3, STRAIN_AT = 0.97;
const BOW_BONUS = 0.06;                 // of S0: a bowed jump tires it
const ROD_LIMIT = 0.25;                 // drain when the fish is too heavy for the rod
// (2026-10-15, the fishing game's polish: a fight should be a minute's fun, not four) — a fish too heavy for the rod
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
// Each kind of fish fights its own way (2026-11-13, the owner: "smaller fishes ... how they naturally act when hooked —
// make that behavior part of the game"): a small one darts, zigzagging, in short bursts; a big one makes long, slow, heavy
// runs. And a fish's signature, by its temperament and its build:
//   runners (tuna, wahoo, jacks, bonefish) open with a screaming run ('blitz'): line peels off — let it go, don't crank;
//   divers and bulldogs (groupers, amberjack, catfish, snapper) bolt for the rocks ('rocks'): keep cranking, keep its head
//     up, or it wraps the line round them ('snag');
//   jumpers (tarpon, sailfish, marlin, mahi, trout) leap again and again (a tail-walk: 'jump' chains);
//   toothy fish (pike, barracuda, mackerel, sharks, gar) shake their heads — on a tight line without a leader the teeth
//     cut it ('bite');
//   flat fish (flounder, rays) plant themselves on the bottom ('plant'): pump them up — reel, ease, reel.
const TOOTHY = new Set(['pike', 'musky', 'pickerel', 'barracuda', 'bluefish', 'kingmack', 'spanishmack', 'wahoo', 'longgar', 'alligatorgar', 'bowfin', 'blacktip', 'bullshark', 'hammerhead', 'lakequeen', 'lionfish']);
const sizeClass = kg => (kg < 0.8 ? 'small' : kg < 8 ? 'medium' : kg < 40 ? 'large' : 'giant');

/** The fish as the fight sees it: { P (kgf, its full pull), S0 (s), vs (m/s, its run speed), temper, jump, kg }. */
export function fishParams(sp, kg) {
  const F = sp.fight;
  const b = sp.body || {};
  return { kg, P: F.power * 1.25 * Math.pow(kg, 0.6) + 0.15, S0: 10 * Math.pow(kg, 0.36) * F.stamina, vs: F.speed * (1 + 0.6 * Math.pow(kg, 0.2)), temper: F.temper, jump: F.jump,
    size: sizeClass(kg), toothy: TOOTHY.has(sp.id) || b.shape === 'shark', flat: b.shape === 'flat' || b.shape === 'ray' || b.mark === 'ray',
    // (it lives by cover — rocks, a reef, a wreck, weed, a hole: that's where it runs when hooked)
    cover: (sp.hab || []).some(h => ['rocks', 'reef', 'wreck', 'weed', 'pads', 'hole'].includes(h)) };
}

/**
 * A fight's state. sp: the species (shared/fish-species.js), fish: { kg }, L: the angler's loadout (shared/fishing-gear.js
 * loadout()), d0: the line out when hooked (m), seed: the fish's moves.
 */
export function fightSetup(sp, fish, L, { d0 = 20, seed = 1 } = {}) {
  const p = fishParams(sp, fish.kg);
  return {
    p, L, rng: new RNG(seed >>> 0), t: 0, d: Math.max(LAND_D + 1, d0), S: p.S0, T: 0,
    mode: 'run', modeT: 1.2, dir: 0, e: 1, slack: 0, strain: 0, jump: null, ready: 0, out: null, jumps: 0, bowed: 0, spikes: 0,
    heavy: fish.kg > L.maxKg, zig: 0, loose: 0, pumpT: 0, chain: 0, wasReel: false, blitzed: false,
  };
}
/** Its signature moves by its temperament and build (weights added to the modes'). */
function signature(p) {
  const e = [];
  if (p.temper === 'runner' || (p.temper === 'jumper' && p.size !== 'small')) e.push(['blitz', p.temper === 'runner' ? 2.2 : 0.8]);
  if (p.cover && (p.temper === 'diver' || p.temper === 'bulldog')) e.push(['rocks', p.temper === 'bulldog' ? 2.6 : 1.8]);
  else if (p.cover && (p.size === 'large' || p.size === 'giant')) e.push(['rocks', 0.5]);
  if (p.flat) e.push(['plant', 3]);
  return e;
}

function nextMode(F) {
  const { p, rng } = F, w = [...MODES[p.temper] || MODES.steady];
  const tired = 1 - F.S / p.S0;
  w[1] *= 1 + 2 * tired;                         // a tired fish rests more
  const jw = p.jump * 6 * (1 - 0.5 * tired);
  const entries = MODE_IDS.map((m, k) => [m, w[k]]);
  if (jw > 0) entries.push(['jump', jw]);
  for (const [m, x] of signature(p)) entries.push([m, x * (1 - 0.6 * tired)]);
  if (F.d <= LAND_D + 0.5) for (const e of entries) if (e[0] === 'toward' || e[0] === 'blitz') e[1] = 0;
  // (a runner's first move is its screaming run; a jumper's leap may chain into another — a tail-walk)
  if (F.chain > 0 && p.jump > 0) { F.chain--; F.mode = 'jump'; }
  else if (!F.blitzed && p.temper === 'runner' && F.t < 2) { F.mode = 'blitz'; F.blitzed = true; }
  else F.mode = rng.weighted(entries);
  // how long: a small fish's bursts are short, a big fish's runs long
  const big = Math.min(1.6, 0.6 + Math.pow(p.kg, 0.2) * 0.35), quick = p.size === 'small' ? 0.55 : p.size === 'giant' ? 1.3 : 1;
  F.modeT = { run: rng.float(1.8, 4.5) * big * quick, rest: rng.float(1.4, 3.4) * (1 + tired) * (p.size === 'small' ? 0.6 : 1), dive: rng.float(1.8, 3.8) * big * quick, shake: rng.float(0.9, 2.0), toward: rng.float(1.2, 2.6) * quick, jump: 1.25,
    blitz: rng.float(2.4, 4.2) * big, rocks: rng.float(2.0, 3.4), plant: rng.float(2.4, 4.0) }[F.mode];
  F.dir = F.mode === 'run' || F.mode === 'blitz' ? rng.pick([-1, 1, 0]) : F.mode === 'shake' ? rng.sign() : 0;
  F.zig = rng.float(0.35, 0.75); F.loose = 0;
  if (F.mode === 'jump') { F.jump = { t: 0, bowed: false }; F.jumps++; if (!F.chain && p.temper === 'jumper' && p.size !== 'small' && rng.chance(0.45)) F.chain = rng.int(1, 2); }
  else F.chain = 0;
}

/**
 * One step. input: { reel (bool), steer (−1 left … 1 right), bow (pressed this step), land (pressed) }. Returns the
 * events of this step: 'jump' (it leaps: show it and the prompt), 'bowed', 'spike', 'payout' (line running out),
 * 'strain' (reeling against it at the drag: ease off or it snaps), 'blitz' (a screaming run), 'rocks' (it bolts for
 * them: crank), 'plant' (on the bottom: pump), 'pump', 'teeth' (a toothy fish's head-shakes), 'zig' (a small one darts), 'slack', 'ready' (LAND now), or the end: 'landed', 'snap' (line broke), 'spat' (the hook fell out), 'spool' (no
 * line left), 'free' (too long), 'snag' (round the rocks), 'bite' (teeth through the line), 'bent' (the hook straightened).
 */
export function fightStep(F, input = {}, dt = FIGHT_DT) {
  if (F.out) return [];
  const ev = [], { p, L } = F;
  F.t += dt;
  if ((F.modeT -= dt) <= 0) { if (F.mode === 'jump' && F.jump && !F.jump.bowed) F.jump = null; nextMode(F); if (['jump', 'blitz', 'rocks', 'plant'].includes(F.mode)) ev.push(F.mode); else if (F.mode === 'shake' && p.toothy) ev.push('teeth'); }
  const energy = 0.2 + 0.8 * Math.max(0, F.S / p.S0);   // (a beaten fish hardly pulls: it comes in)
  const eff = { run: 1, rest: 0.22, dive: 0.85, shake: 0.55, toward: 0.25, jump: 0.6, blitz: 1.25, rocks: 0.95, plant: 0.4 }[F.mode] * energy;
  const reel = !!input.reel, against = F.dir ? Math.max(-1, Math.min(1, -(input.steer || 0) * F.dir)) : 0;
  const assist = L.assist || 0, hold = L.hookHold || 1;
  // a small fish darts: its run zigzags, turning every fraction of a second
  if ((F.mode === 'run' || F.mode === 'blitz') && p.size === 'small' && (F.zig -= dt) <= 0) { F.zig = F.rng.float(0.35, 0.75); F.dir = F.dir ? -F.dir : F.rng.sign(); ev.push('zig'); }
  // the tension: the fish's pull through the rod (more when held against its run), and the reel's own load
  let T = p.P * eff * (0.8 + 0.35 * against) * L.calm + (reel ? 0.2 * p.P * energy + 0.1 : 0);
  if (F.mode === 'toward') T *= reel ? 0.5 : 0.15;
  if (F.mode === 'shake') T *= 1 + 0.45 * Math.abs(Math.sin(F.t * 11));
  // over the drag: line runs out (the fish gains), the tension held at the drag
  if (T > L.drag) {
    const vf = p.vs * eff * (1 - 0.4 * Math.max(0, against)) * (F.mode === 'blitz' ? 1.8 : 1);
    F.d += (vf * (1 - L.drag / T) + 0.15) * dt;
    T = L.drag; ev.push('payout');
  } else if (reel) {
    const vr = L.speed * (0.55 + 2.0 * Math.pow(Math.max(0, 1 - T / L.drag), 1.5)) * (F.mode === 'dive' || F.mode === 'rocks' ? 0.25 + 0.7 * (1 - energy) : F.mode === 'plant' ? 0.12 : 1);   // (a tired fish's dive gives way; a planted one hardly comes)
    F.d -= vr * dt;
  }
  // pumping a planted fish up: each new turn of the reel (once in PUMP_S) lifts it a little
  if (F.mode === 'plant' && reel && !F.wasReel && F.t - F.pumpT >= 0.35) { F.pumpT = F.t; F.d = Math.max(LAND_D, F.d - 0.45); ev.push('pump'); }
  F.wasReel = reel;
  if (F.mode === 'toward') F.d -= p.vs * 0.35 * energy * dt;
  // spikes: a head-shake's peaks; a jump not bowed to
  let spike = 0;
  if (F.mode === 'shake' && Math.abs(Math.sin(F.t * 11)) > 0.97) {
    spike = T * 1.45;
    // teeth: a head-shake on a tight line can cut it (a leader mostly stops it)
    if (p.toothy && T > 0.8 * L.drag && Math.abs(Math.sin((F.t - dt) * 11)) <= 0.97 && F.rng.chance(L.leader ? 0.01 : 0.04)) { F.out = 'bite'; ev.push('bite'); return ev; }
  }
  // the rocks: it must be held up (cranking, or the line at the drag) — let it be and it wraps the line round them
  if (F.mode === 'rocks') { if (!reel && T < 0.9 * L.drag) F.loose += dt; if (F.loose > 1.3 * (1 + 0.5 * assist)) { F.out = 'snag'; ev.push('snag'); return ev; } }
  if (F.mode === 'jump' && F.jump) {
    F.jump.t += dt;
    const win = JUMP_WIN + 0.25 * assist;
    if (!F.jump.bowed && input.bow && !reel && F.jump.t <= win) { F.jump.bowed = true; F.bowed++; F.S -= BOW_BONUS * p.S0; ev.push('bowed'); }
    if (!F.jump.bowed && F.jump.t > win && !F.jump.hit) {
      F.jump.hit = true;
      if (T < 0.12 * p.P && F.rng.chance(Math.min(0.9, 0.45 / hold))) { F.out = 'spat'; ev.push('spat'); return ev; }   // (a better hook stays in)
      spike = Math.max(spike, (T + 0.35 * p.P) * 1.6);
    }
  }
  if (spike) {
    F.spikes++; ev.push('spike');
    if (spike > L.kgf) { F.out = 'snap'; F.T = spike; ev.push('snap'); return ev; }
    if (spike > (L.hookKgf || Infinity)) { F.out = 'bent'; F.T = spike; ev.push('bent'); return ev; }   // (the hook straightened before the line broke)
  }
  F.T = T;
  // strain: reeling against a fish taking line
  // (heading for the rocks it must be held hard: no strain then)
  if (reel && T >= STRAIN_AT * L.drag && F.mode !== 'rocks') { F.strain += dt * (F.mode === 'blitz' ? 1.6 : 1); if (F.strain > 0.35 && F.strain - dt <= 0.35) ev.push('strain'); }
  else F.strain = Math.max(0, F.strain - 1.5 * dt);
  if (F.strain > STRAIN_S * (1 + 0.8 * assist)) { F.out = 'snap'; ev.push('snap'); return ev; }   // (a beginner's line guard: longer)
  // the fish tires with the tension it pulls against and with every turn of the reel; it gets its wind back on a slack line
  const drain = L.power * (0.55 * Math.min(1.6, T / p.P) + (reel ? 0.45 : 0.1)) * (1 + 0.5 * Math.max(0, against)) * (F.heavy ? ROD_LIMIT : 1) * fatigue(F.t);
  F.S -= drain * dt;
  if (T < 0.2 * p.P && !reel) F.S += 0.02 * p.S0 * dt;
  F.S = Math.max(0, Math.min(p.S0, F.S));
  if (against > 0 && F.mode === 'run') F.modeT -= 0.8 * against * dt;   // turned: its run ends sooner
  // slack line
  if (T < 0.08 * p.P + 0.05 && F.mode !== 'rest' && F.mode !== 'jump') { F.slack += dt; if (F.slack > 0.6) ev.push('slack'); }
  else F.slack = Math.max(0, F.slack - 2 * dt);
  if (F.slack > SLACK_S * hold * (1 + 0.4 * assist)) { F.out = 'spat'; ev.push('spat'); return ev; }
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
 * speed — and 20 % to spare. The server refuses a landing sooner than this.
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
  // (and the signatures: cranks a fish heading for the rocks, eases off a toothy one's head-shakes, pumps a planted one)
  let reel = !bow && !(F.jump && !F.jump.bowed && skill > 0.5) && (!near || F.mode === 'toward');
  if (F.mode === 'rocks') reel = true;
  if (F.mode === 'shake' && F.p.toothy && skill > 0.5) reel = false;
  if (F.mode === 'plant') reel = Math.floor(F.t / 0.4) % 2 === 0;
  return { reel, steer: F.dir ? -F.dir * skill : 0, bow, land: F.ready > 0.2 };
}
