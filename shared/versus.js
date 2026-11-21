// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Two-player pieces, and an AI agent as the other player (docs/features/versus.md; 2026-11-17, the product owner: "Today
// the player plays the CPU … I want to play with my AI agents"). What the server (server/play/versus.js) and the game on
// its player's page (client/js/play/machine-play.js) both read: which pieces are played by two, where the other one
// stands, how good an agent's hand is, and a game's result in words. Nothing listed by hand: a piece is two-player by
// what the catalog declares of it.
import { CATALOG, USES } from './catalog.js';
import { machineGame } from './arcade/catalog.js';

// (sitting down together and eating together are the body's own: server/interactions/sources/body.js — not a game)
const TOGETHER = new Set(['eat', 'bench', 'relax', 'chat', 'meeting', 'sleep', 'nap']);
const cache = new Map();
const facing = (a, b) => { const T = 2 * Math.PI, d = ((((a.yaw - b.yaw) % T) + T) % T); return Math.abs(d - Math.PI) < 0.35; };

/**
 * The piece of type t as a two-player piece, or null: { t, name, game (shared/arcade/catalog.js: its two-sided game —
 * the computer's side played by someone else — or null), use (its slots' use), slots ([k …]: those of that use), you
 * ([x, z]: the way to its player's end in its frame, a game's own; null: either end) }. Two-player: a machine whose game
 * is two-sided (`cpu`), or a piece with exactly two places for one pastime done with someone (its use: fun and company,
 * not sitting or eating together), facing each other across it (a ping-pong table's two ends).
 */
export function versusOf(t) {
  if (cache.has(t)) return cache.get(t);
  const def = CATALOG[t], slots = def?.slots || [];
  let out = null;
  const g = machineGame(t);
  if (g?.cpu && slots.length > 1) {
    const use = slots[0].use, ks = slots.map((s, k) => (s.use === use ? k : -1)).filter(k => k >= 0);
    if (ks.length > 1) out = { t, name: def.name, game: g, use, slots: ks, you: Array.isArray(g.you) ? g.you : null };
  } else if (slots.length > 1) {
    const by = new Map();
    slots.forEach((s, k) => { const l = by.get(s.use) || []; l.push(k); by.set(s.use, l); });
    for (const [use, ks] of by) {
      const u = USES[use], r = u?.rate || {};
      if (ks.length !== 2 || TOGETHER.has(use) || !(r.fun > 0) || !(r.social > 0)) continue;
      if (!facing(slots[ks[0]], slots[ks[1]])) continue;
      out = { t, name: def.name, game: null, use, slots: ks, you: null };
      break;
    }
  }
  cache.set(t, out);
  return out;
}

/**
 * The slot the other player takes at a two-player piece (v: versusOf's): a game's far end (the slot most opposite its
 * player's end, `you`), else the end farthest from where its player is (at: [x, z] in the piece's frame), leaving out
 * those in `not` (taken: the player's own). → k, or -1.
 */
export function farSlot(v, at = null, not = []) {
  const S = CATALOG[v?.t]?.slots || [];
  let best = -1, bs = -Infinity;
  for (const k of v?.slots || []) {
    if (not.includes(k) || !S[k]) continue;
    const x = S[k].x, z = S[k].z;
    const score = v.you ? -(x * v.you[0] + z * v.you[1]) : at ? Math.hypot(x - at[0], z - at[1]) : 0;
    if (score > bs + 1e-9) { bs = score; best = k; }
  }
  return best;
}

/** An agent's hand at a two-sided game (shared/arcade/core.js handOf: 50 the computer's own, up to 95): from its arcade
 *  level and its stars at that game — never weaker than the computer, so a game against it is never an easier score than
 *  one against the computer (its player's scores, the board and the prizes stay fair). */
export const HAND_MIN = 50, HAND_MAX = 95;
export function handFor(level = 1, stars = 0) {
  const l = Math.max(1, Math.floor(Number(level) || 1)), s = Math.max(0, Math.min(3, Math.floor(Number(stars) || 0)));
  return Math.max(HAND_MIN, Math.min(HAND_MAX, HAND_MIN + 4 * (l - 1) + 3 * s));
}

/** The words for a hand: 'as good as the computer', 'better than the computer', 'a lot better than the computer'. */
export const handWords = k => (k >= 80 ? 'a lot better than the computer' : k > HAND_MIN ? 'better than the computer' : 'as good as the computer');

/** A tally in words: '3–2'. */
export const tally = (a, b) => `${Math.max(0, a | 0)}–${Math.max(0, b | 0)}`;

/**
 * The other player's word after a game (its bubble; r: its side's result — { win, draw, me, them } — and count: what the
 * tally counts, 'goals' or 'balls'): 'Good game! 3–2 to you', 'Good game! 5–3 to me', 'Good game! A draw, 2–2'.
 */
export function goodGame(r, count = 'goals') {
  if (!r) return 'Good game!';
  if (count === 'balls') return r.draw ? 'Good game! Nobody sank the eight' : r.win ? `Good game! That one's mine — ${r.me} of my balls down to your ${r.them}` : `Good game! You got me — your ${r.them} down to my ${r.me}`;
  if (r.draw) return `Good game! A draw, ${tally(r.me, r.them)}`;
  return `Good game! ${tally(Math.max(r.me, r.them), Math.min(r.me, r.them))} to ${r.win ? 'me' : 'you'}`;
}

/** Who the other player is, for the game's screen: the computer (null) or someone's agent ({ name, emoji }) — its name,
 *  a short one for the machine's panel (8 letters, upper case), and 'the computer' / its name in a sentence. */
export function foeOf(vs) {
  const name = String(vs?.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
  if (!name) return { agent: false, name: 'the computer', Name: 'The computer', short: 'CPU', emoji: '🖥️' };
  const short = name.split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9'-]/g, '').slice(0, 8) || 'AGENT';
  return { agent: true, name, Name: name, short, emoji: String(vs.emoji || '🤖').slice(0, 8) };
}

/** The longest its player's game waits for a companion to decide and walk over (it can always play the computer now). */
export const WAIT_MAX_MS = 30000;
/**
 * What its player's game does with how things stand (server/play/versus.js view(); ms: how long it has waited): { wait
 * (keep waiting), text (the waiting card's words, or a word on why it plays the computer), foe (the one at the other
 * end, ready: the run is laid out with them) }.
 */
export function waitState(v, ms = 0, max = WAIT_MAX_MS) {
  if (!v || typeof v !== 'object') return { wait: false, text: null, foe: null };
  const who = x => `${x.emoji ? `${x.emoji} ` : ''}${x.name}`;
  if (v.vs?.state === 'ready') return { wait: false, text: null, foe: v.vs };
  const coming = v.vs?.state === 'coming', thinking = !coming && v.pending?.agents?.length > 0;
  if ((coming || thinking) && ms >= max) return { wait: false, text: `${coming ? who(v.vs) : 'Your companion'} isn't there yet: you play the computer`, foe: null };
  if (coming) return { wait: true, text: `${who(v.vs)} is walking to the other end to play you…`, foe: null };
  if (thinking) {
    const n = v.pending.agents.map(who);
    return { wait: true, text: `${n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]} are` : `${n[0]} is`} thinking about a game with you…`, foe: null };
  }
  return { wait: false, text: v.declined ? `${who(v.declined)} ${v.declined.why}: you play the computer` : null, foe: null };
}
