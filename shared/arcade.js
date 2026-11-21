// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade as a play module (docs/features/arcade.md, docs/features/play-modules.md): each built-in game is a course
// of the 'arcade' module, so its leaderboard, best scores, stars, experience, badges and prizes are the platform's own.
// A run starts with a seed from the server (prepare); the browser plays and sends the buttons held at every step
// (shared/arcade/core.js InputLog); verify() plays the same game again from the seed and works the score out itself.
import { registerPlay, liveInt, liveOf } from './play.js';
import { GAMES } from './arcade/catalog.js';
import { SIMS } from './arcade/sims.js';
import { replay, TICK_HZ, MAX_TICKS } from './arcade/core.js';

const SLACK_MS = 5000;   // the clock's allowance for the network (a run can't take less real time than it played)
const seed = () => { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0] >>> 0; };

/**
 * Plays a reported run of a built-in game again: { ok, score, ms, detail } or { ok: false, why }. A two-sided game played
 * against someone (ctx.data.vs: an AI agent at the other end, server/play/versus.js) is played again with their hand;
 * the run of that other one (ctx.data.side −1: the same game, its own record) scores their side of it (the sim's other()).
 */
export function verifyArcade(course, report, ctx) {
  const sim = SIMS[course.id], side = ctx.data?.side === -1;
  if (!sim) return { ok: false, why: 'This game has no check' };
  if (side && typeof sim.other !== 'function') return { ok: false, why: 'This game has one side' };
  if (!report || typeof report.log !== 'string') return { ok: false, why: 'The run sent no play' };
  const s0 = ctx.data?.seed;
  if (!Number.isSafeInteger(s0)) return { ok: false, why: 'That run has no seed' };
  let r;
  try { r = replay(sim, s0, report.log, MAX_TICKS, ctx.data?.vs || null); } catch { return { ok: false, why: 'That run could not be read' }; }
  if (!r.over) return { ok: false, why: 'The game had not ended' };
  const ms = Math.round((r.ticks * 1000) / TICK_HZ);
  if (ms > (ctx.serverMs ?? 0) + SLACK_MS) return { ok: false, why: 'That run was quicker than the clock' };
  if (side) { const o = sim.other(r.state); return { ok: true, score: o.score, ms, detail: { ...o.detail, vs: true } }; }
  const score = sim.score(r.state), claimed = Number(report.score);
  return { ok: true, score, ms, detail: { ...(sim.detail ? sim.detail(r.state) : {}), ...(ctx.data?.vs ? { vs: true } : {}), ...(Number.isFinite(claimed) && claimed !== score ? { claimed } : {}) } };
}

/**
 * Where a game stands, as the cabinet says (POST /api/play/moment): { score, lives?, detail: { a few of the game's own
 * counts: level, wave, lines … } } — whole numbers only, at most four counts with short plain names.
 */
export function arcadeMoment(live) {
  const score = liveInt(live.score, 0, 1e9);
  if (score == null) return null;
  const detail = {};
  for (const [k, v] of Object.entries(live.detail && typeof live.detail === 'object' && !Array.isArray(live.detail) ? live.detail : {})) {
    if (Object.keys(detail).length >= 4) break;
    if (!/^[a-z][a-zA-Z]{0,11}$/.test(k) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    detail[k] = liveInt(v, 0, 1e7);
  }
  return liveOf({ score, lives: liveInt(live.lives, 0, 99), detail: Object.keys(detail).length ? detail : null, over: live.over === true ? true : null });
}

const played = (s, n) => Object.keys(s.best || {}).length >= n;
export const ARCADE = registerPlay({
  id: 'arcade', version: 2, label: 'Arcade', icon: '🕹️', placement: 'interior', price: 25000,
  blurb: 'Classic arcade games on the cabinets: verified high scores on every game.',
  score: { kind: 'points', unit: 'pts', better: 'higher' },
  courses: GAMES.filter(g => g.kind === 'builtin').map(g => ({ id: g.id, label: g.title, difficulty: g.difficulty, stars: g.stars, blurb: g.blurb })),
  // (a two-sided game with someone at the other end — an AI agent, server/play/versus.js: ctx.vs, its name and hand — is
  //  laid out with them: the sim plays their side with their hand, here and in the browser)
  prepare: (c, ctx) => ({ seed: seed(), ...(ctx?.vs && ctx.vs.game === c.id && GAMES.find(g => g.id === c.id)?.cpu ? { vs: ctx.vs } : {}) }),
  verify: verifyArcade,
  moment: arcadeMoment,
  badges: [
    { id: 'arc_coin_op', label: 'Coin-op', icon: '🕹️', desc: 'Finish your first arcade game', tier: 'bronze', when: s => s.runs >= 1 },
    { id: 'arc_regular', label: 'Arcade regular', icon: '🎟️', desc: 'Finish 50 arcade games', tier: 'silver', when: s => s.runs >= 50 },
    { id: 'arc_sampler', label: 'Sampler', icon: '🎮', desc: 'Set a score on two arcade games', tier: 'bronze', when: s => played(s, 2) },
    { id: 'arc_explorer', label: 'Arcade explorer', icon: '💎', desc: 'Set a score on six arcade games', tier: 'silver', when: s => played(s, 6) },
    { id: 'arc_ace', label: 'Arcade ace', icon: '⭐', desc: 'Three stars on any arcade game', tier: 'gold', when: s => Object.values(s.best || {}).some(b => b.stars >= 3) },
    { id: 'arc_blockbuster', label: 'Blockbuster', icon: '🧱', desc: 'Clear five rows at once in Block Drop', tier: 'silver', when: (s, run) => run?.course === 'block-drop' && run.detail?.blockbusters > 0 },
    { id: 'arc_siege_breaker', label: 'Siege breaker', icon: '🚀', desc: 'Reach wave 5 in Star Siege', tier: 'silver', when: (s, run) => run?.course === 'star-siege' && run.detail?.wave >= 5 },
  ],
});
