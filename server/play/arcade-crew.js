// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI agents playing the arcade for real (docs/features/arcade.md §Agents at the arcade; 2026-11-17, the product owner:
// "Companion agents should be able to interact with any current and future object the same way players can … play games
// and modules with me … they are essentially AI Agent Players"). Every arcade piece that plays a game — a cabinet (the
// game it shows: shared/arcade/catalog.js cabinetGame) or a machine of its own (the skee-ball lane, the hoops, the pool
// table: machineGame) — is played by an agent as a player plays it: a real run of the arcade module, its own.
//
// - Chosen, not pushed: the registry's source 'arcade' (server/interactions/registry.js) offers each such piece near the
//   agent (on its own) or near its owner (out with them: "Play Neon Snake on the cabinet next to Kim's (your best:
//   8,200)") — Free Will's moments, its chat brain, its owner (GET/POST /api/interactions) and connected agents choose from
//   it. It claims those pieces: the furniture's plain 'play' at them is no longer offered (one honest way).
// - Its body: beside its owner, at the machine with them (Brain.useWith: it keeps at it while they are near — they walk
//   off, it stops and follows: the game left unfinished does not count); on its own, it walks there (the Brain's order
//   'use', the whole game in one stay). The machine's slot is held for it, its animation is the slot's own, the tokens are
//   billed as any visit there (the economy).
// - The game: a run of the arcade module started by the server for the agent (the play core as minus its id: the seed
//   is the server's), played in real time by the arcade's own player (shared/arcade/player.js — one player for every
//   game, as good as its arcade level), its input log sent at the end and checked by the module's own verify like
//   anyone's (replayed from the seed; no quicker than the clock). Recorded as the agent's own: its level, experience
//   (half: an unattended run, server/play/play.js AUTO_XP), badges, the leaderboards under its name; no prizes (the
//   platform's rule for unattended runs).
// - Never forever: it plays a game to its end, at most SESSION_MS (or the minutes it was given), then lets it run out
//   (the player winds up); a game still going WIND_MS after that it walks away from (not recorded, and said so).
// - Seen and said: while it plays, the run's moments (score, lives) as any player's page sends them (its card in the
//   senses: "Kai is playing Neon Snake at the arcade, score 1,240"), its Companions bar ("Playing Neon Snake · 1,240");
//   at the end a bubble over its head ("🕹️ 12,400 on Neon Snake!"), a toast on its owner's page when it played beside them
//   ("Kai scored 12,400 on Neon Snake", crew_arcade), its diary (one line: the score, stars, a new best, its place), and a
//   word of its own for a new best.
// - CPU: thinking is bounded per player (shared/arcade/player.js THINK_US by skill) and for all of them together
//   (THINK_US_ALL: more players at once, less each), on this crew's beat (TICK_MS), with a cap on any one beat.
import { evalPlan } from '../sim/plan.js';
import { CATALOG, USES } from '../../shared/catalog.js';
import { gameOf, machineGame, cabinetGame } from '../../shared/arcade/catalog.js';
import { SIMS } from '../../shared/arcade/sims.js';
import { TICK_HZ } from '../../shared/arcade/core.js';
import { ArcadePlayer, skillOfLevel, THINK_US } from '../../shared/arcade/player.js';
import { moduleLevel } from '../../shared/play.js';
import { ctxOf } from '../../shared/constants.js';
import { toWorld } from '../../shared/geom.js';
import { spaceAt, piecesOn, worthUsing, effectWords } from '../interactions/sources/furniture.js';
import { vc } from '../economy/ledger.js';

export const TICK_MS = 100;              // the crew's beat: each game brought up to the clock
export const SESSION_MS = 5 * 60e3;      // the longest it plays one game (unless given its own minutes): then it lets it run out
export const WIND_MS = 3 * 60e3;         // a game still going this long after that: it walks away (not recorded)
export const GOING_MS = 4 * 60e3;        // the longest its body may take to get to the machine
export const GRACE_MS = 3000;            // away from the machine this long while playing: it has left it
export const MOMENT_MS = 3000;           // how often its run says where it stands (the play core's moments)
export const THINK_US_ALL = 60000;       // all its players' thinking together, µs a second (6% of a core)
const BEAT_MS = 40;                      // the most one beat may take (the rest catch up on the next)
const NEAR_M = 18, WITH_M = 10, NEXT_TO_M = 4.5;   // m: machines near it on its own; near its owner; next to its owner's
const BEST_TTL = 30e3;
const clean = (s, n = 60) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const num = n => Math.max(0, Math.round(Number(n) || 0)).toLocaleString('en-US');
const stars = n => (n > 0 ? `${'★'.repeat(n)}${'☆'.repeat(3 - n)}` : 'no stars');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** The game a piece plays (its type t, where it is, its item's own choice g): a machine's own, a cabinet's, or null. */
export function gameAt(t, b, f, id, g = null) {
  const m = machineGame(t);
  if (m) return m;
  return CATALOG[t]?.arcade ? gameOf(cabinetGame(b, f, id, g)) : null;
}
/** What a piece is called in a sentence: "the cabinet", "the skee-ball lane" (the catalog's own name, lower case). */
const pieceWord = t => (CATALOG[t]?.arcade ? 'cabinet' : clean(CATALOG[t]?.name || 'machine', 30).replace(/\s*\(.*?\)\s*/g, ' ').trim().toLowerCase());

export class ArcadeCrew {
  /**
   * @param o { play (PlayCore), sim () → the Sim, agents (the registry: get, byKey), players (Players: where its owner
   *   is), companions () → Companions (remark), say (i, text) a bubble, toAccount (account, frame), note (agentId, kind,
   *   text) its diary, now () → ms (the play core's clock by default), log }
   */
  constructor({ play, sim, agents, players = null, companions = () => null, say = () => {}, toAccount = () => {}, note = () => {}, now = null, log = null, thinkAll = THINK_US_ALL }) {
    Object.assign(this, { play, simOf: sim, agents, players, companionsOf: companions, say, toAccount, note, log, thinkAll });
    this.now = now || (() => play.now());
    this.crew = new Map();    // agent id → its member: { agent, i, name, owner, mode, piece, game, phase, run, player, … }
    this.bests = new Map();   // agent id → { at, best: { course → score }, level }
    this.timer = null;
    this.turn = 0;
    this.stats = { started: 0, finished: 0, recorded: 0, abandoned: 0, refused: 0, ticks: 0, thinkMs: 0 };
  }
  get sim() { return this.simOf(); }
  attach() { this.timer = setInterval(() => { try { this.tick(); } catch (e) { this.log?.warn?.('[arcade-crew] tick failed:', e.stack || e.message); } }, TICK_MS); this.timer.unref?.(); return this; }
  stop() { clearInterval(this.timer); this.timer = null; }

  // ------------------------------------------------------------------------------------------------ what it knows
  /** Its arcade: best per game, level (cached a little: the registry asks often). */
  record(agentId) {
    const t = this.now(), c = this.bests.get(agentId);
    if (c && t - c.at < BEST_TTL) return c;
    let best = {}, level = 1;
    try { const M = this.play.progress(-agentId).modules.arcade; level = moduleLevel(M?.xp || 0); for (const [k, v] of Object.entries(M?.best || {})) best[k] = v.score; } catch { best = {}; }
    const r = { at: t, best, level };
    this.bests.set(agentId, r);
    if (this.bests.size > 2000) this.bests.delete(this.bests.keys().next().value);
    return r;
  }
  nameOf(account) { return clean(this.players?.byId?.get(account)?.name || 'your owner', 40); }
  /** Where its body is now: its sim agent, or null (gone, retired, another body in that place now). */
  bodyOf(m) {
    const S = this.sim, a = S?.agents[m.i], p = S?.people[m.i];
    if (!a?.plan || !p || p.retired || (m.key != null && p.agentId !== m.key)) return null;
    return a;
  }
  /** Whether its body is at the machine now, using it: its stays are at that piece (the sim plans the next round ahead,
   *  so its act may be the next one already) and its body is at that slot this moment. */
  atMachine(a, m) {
    const act = a.act, pc = m.piece, S = this.sim;
    if (!act || act.b !== pc.b || act.f !== pc.f || act.id !== pc.id || !(act.k >= 0)) return false;
    const e = evalPlan(a.plan, S.now()), at = S.brain.slotAt(pc.b, pc.f, pc.id, act.k);
    return !!at && e.ctx === ctxOf(pc.b, pc.f) && Math.hypot(e.x - at.x, e.z - at.z) < 0.8;
  }

  // ------------------------------------------------------------------------------------------------ the beat
  tick() {
    const t0 = Date.now();
    this.stats.ticks++;
    const all = [...this.crew.values()];
    const playing = all.filter(m => m.phase === 'playing').length;
    // (its share of the thinking: its own budget, less when many play at once)
    const share = playing ? Math.floor(this.thinkAll / playing) : this.thinkAll;
    const k0 = this.turn++ % Math.max(1, all.length);
    for (let n = 0; n < all.length; n++) {
      const m = all[(k0 + n) % all.length];
      if (Date.now() - t0 > BEAT_MS && m.phase === 'playing') continue;   // (it catches up on the next beat)
      try { this.step(m, share); } catch (e) { this.log?.warn?.('[arcade-crew] a game failed:', e.stack || e.message); this.end(m, 'trouble'); }
    }
    this.stats.thinkMs += Date.now() - t0;
  }
  step(m, share) {
    const a = this.bodyOf(m), t = this.now();
    if (!a) return this.end(m, 'gone');
    if (m.phase === 'going') {
      if (this.atMachine(a, m)) return this.begin(m);
      if (!this.stillGoing(a, m)) return this.end(m, m.mode === 'with' ? 'went_on' : 'never_got_there');
      if (t - m.since > GOING_MS) return this.end(m, 'never_got_there');
      return;
    }
    if (m.phase !== 'playing') return;
    const run = this.play.runs.get(m.run.id);
    if (!run) return this.end(m, 'run_gone');
    if (this.atMachine(a, m)) m.awayAt = 0;
    else if (!m.awayAt) m.awayAt = t;
    else if (t - m.awayAt > GRACE_MS) return this.end(m, m.mode === 'with' ? 'followed' : 'left');
    const P = m.player;
    P.budget(Math.min(share, m.think));
    // its game up to the clock (never ahead of it: the server checks a run against the time it took)
    const due = Math.floor(((t - run.at) * TICK_HZ) / 1000) - P.ticks;
    if (due > 0) P.play(Math.min(due, 3 * TICK_HZ));
    if (!P.over && !P.wrap && t - run.at >= m.session) P.windUp();
    if (P.over) return this.finish(m);
    if (t - run.at > m.session + WIND_MS) return this.end(m, 'too_long');
    if (t - (m.momentAt || 0) >= MOMENT_MS) this.moment(m);
  }
  /** Its order there still stands (on its own: its 'use' order for that piece; beside its owner: its seat there). */
  stillGoing(a, m) {
    const o = a.order, pc = m.piece;
    if (m.mode === 'own') return o?.kind === 'use' && o.piece === pc.id && o.venue?.b === pc.b && o.venue?.f === pc.f;
    return o?.kind === 'follow' && o.seat?.mode === 'use' && o.seat.b === pc.b && o.seat.f === pc.f && o.seat.id === pc.id;
  }
  /** At the machine: its run of the game starts (the server's seed), played by its own player as good as its level. */
  begin(m) {
    const acct = { id: -m.agent }, course = m.game.id;
    let st;
    try { st = this.play.start(acct, 'arcade', course, null, { auto: true }); }
    catch (e) {
      if (e.code === 'too_fast' && this.now() - m.since < 10000) return;   // (a moment: the play core's own pace)
      this.stats.refused++;
      return this.end(m, 'no_start', e.message);
    }
    const run = this.play.runs.get(st.run), rec = this.record(m.agent), skill = skillOfLevel(rec.level);
    m.run = { id: st.run, seed: st.data.seed };
    m.level = rec.level; m.best = rec.best[course] ?? null;
    m.player = new ArcadePlayer(SIMS[course], st.data.seed, { skill, stars: st.stars, dice: (st.data.seed ^ Math.imul(m.agent, 2654435761)) >>> 0 });
    m.think = THINK_US.low + (THINK_US.high - THINK_US.low) * skill;
    m.phase = 'playing'; m.playAt = run?.at ?? this.now(); m.momentAt = 0; m.awayAt = 0;
    this.stats.started++;
    this.moment(m);
  }
  /** Where its run stands, as a player's page says it (the senses' card: score, lives). */
  moment(m) {
    m.momentAt = this.now();
    const P = m.player, s = P.s, d = {};
    try { for (const [k, v] of Object.entries(P.sim.detail ? P.sim.detail(s) : {})) if (typeof v === 'number') d[k] = v; } catch { /* its words are a bonus */ }
    try { this.play.moment({ id: -m.agent }, m.run.id, { score: P.score, ...(typeof s.lives === 'number' ? { lives: s.lives } : {}), detail: d, over: P.over }); } catch { /* the play core's pace: the next one */ }
  }
  /** The game over: its input log to the play core, checked by the module's own verify, recorded as its own. */
  finish(m) {
    const acct = { id: -m.agent }, P = m.player;
    let res = null;
    try { res = this.play.finish(acct, m.run.id, { log: P.encode(), score: P.score }); }
    catch (e) { res = { ok: false, why: e.message }; }
    this.stats.finished++;
    this.bests.delete(m.agent);
    const title = m.game.title, where = m.mode === 'with' ? ` beside ${m.ownerName}` : '';
    if (!res?.ok) {
      this.note(m.agent, 'activity', `You played ${title}${where} (${num(P.score)} points) but the game did not count: ${clean(res?.why || 'it was not accepted', 80).toLowerCase()}`);
      m.last = { game: m.game.id, score: P.score, ok: false, why: res?.why || null };
      return this.release(m, 'done');
    }
    this.stats.recorded++;
    const r = res, best = r.newBest && r.prevBest, lvl = r.module && r.module.level > r.module.was ? r.module.level : null;
    m.last = { game: m.game.id, title, score: r.score, stars: r.stars, newBest: !!r.newBest, place: r.place, xp: r.xp, level: r.module?.level ?? null, badges: (r.badges || []).map(b => b.id), ok: true };
    this.say(m.i, `🕹️ ${num(r.score)} on ${title}!${best ? ' A new best!' : ''}`);
    // (its diary: one line, all of it — the play core's own arcade line leaves an agent's own game to this one)
    this.note(m.agent, 'activity', `You played ${title} on the ${m.piece.word}${where}${m.place ? ` at ${m.place}` : ''}: ${num(r.score)} points, ${stars(r.stars)}${best ? ` — a new personal best (was ${num(r.prevBest.score)})` : r.newBest ? ' — your first score on it' : ''}${r.place ? `, #${r.place} on the board` : ''}${lvl ? `; you reached arcade level ${lvl}` : ''}${r.badges?.length ? `; badge: ${r.badges.map(b => b.label).join(', ')}` : ''}`);
    if (this.ownerSees(m)) this.toAccount(m.owner, { t: 'crew_arcade', agent: m.agent, i: m.i, name: m.name, game: m.game.id, title, icon: m.game.icon || '🕹️', score: r.score, stars: r.stars, newBest: !!best, place: r.place ?? null,
      text: `${m.name} scored ${num(r.score)} on ${title}${best ? ' — a new best!' : ''}` });
    if (lvl) this.toAccount(m.owner, { t: 'crew_note', agent: m.agent, i: m.i, text: `🕹️ ${m.name} reached arcade level ${lvl}!` });
    if (best || (r.place != null && r.place <= 3)) { try { this.companionsOf()?.remark?.(m.i, `I just scored ${num(r.score)} on ${title}${best ? ', my best ever' : ''}${r.place === 1 ? ' — the top score on the board' : r.place <= 3 ? ` — #${r.place} on the board` : ''}!`); } catch { /* its words are a bonus */ } }
    return this.release(m, 'done');
  }
  /** Its owner is beside it (it played with them, or they are near it now: the same floor, a few steps): the toast. */
  ownerSees(m) {
    if (m.mode === 'with') return true;
    const p = this.players?.byId?.get(m.owner), a = this.sim?.agents[m.i];
    if (!p || !a?.plan) return false;
    const e = evalPlan(a.plan, this.sim.now());
    return p.ctx === e.ctx && Math.hypot(p.x - e.x, p.z - e.z) <= 15;
  }
  /** It stops without a recorded game (it left, it was asked, it never got there): said in its diary. */
  end(m, why, detail = '') {
    if (!this.crew.has(m.agent)) return;
    const P = m.player, title = m.game.title;
    if (m.run && this.play.runs.has(m.run.id)) { try { this.play.abandon({ id: -m.agent }, m.run.id); } catch { /* gone already */ } }
    if (m.phase === 'playing') this.stats.abandoned++;
    const so = P ? ` at ${num(P.score)} points` : '';
    const text = {
      followed: `You stopped playing ${title}${so} to go with ${m.ownerName} — a game left unfinished does not count`,
      left: `You walked away from ${title}${so} — a game left unfinished does not count`,
      asked: m.phase === 'playing' ? `You stopped playing ${title}${so} — a game left unfinished does not count` : `You didn't play ${title} after all`,
      too_long: `You left ${title} still going${so} after a long game — a game left unfinished does not count`,
      never_got_there: `You didn't get to play ${title}: you never got to the ${m.piece.word}`,
      went_on: `You didn't play ${title} after all: you went on with ${m.ownerName}`,
      no_start: `You couldn't start ${title}${detail ? `: ${clean(detail, 60).toLowerCase()}` : ''}`,
      run_gone: `Your game of ${title} was lost${so} (the arcade restarted)`,
    }[why];
    if (text) this.note(m.agent, 'activity', text);
    m.last = { game: m.game.id, title, score: P?.score ?? null, ok: false, why };
    this.release(m, why);
  }
  /** Its body free again: on its own the order ends (it gets up); beside its owner its seat there is over (it follows). */
  release(m, why) {
    this.crew.delete(m.agent);
    this.lastOf = this.lastOf || new Map();
    this.lastOf.set(m.agent, { ...m.last, at: this.now() });
    if (this.lastOf.size > 2000) this.lastOf.delete(this.lastOf.keys().next().value);
    const S = this.sim, a = this.bodyOf(m);
    if (!a || why === 'gone') return;
    const o = a.order, pc = m.piece;
    try {
      if (m.mode === 'own' && o?.kind === 'use' && o.piece === pc.id && o.venue?.b === pc.b) { S.endOrder(m.i); S.brain.interruptSoon(a); }
      else if (m.mode === 'with' && o?.seat?.mode === 'use' && o.seat.id === pc.id && o.seat.b === pc.b) { o.seat.until = S.now(); S.brain.reorder(a); }
    } catch (e) { this.log?.warn?.('[arcade-crew] its body was not let go:', e.message); }
  }

  // ------------------------------------------------------------------------------------------------ what the pages show
  /** One agent's game now (its Companions bar, its owner's views, the tests), or its last one; null when none. */
  view(agentId) {
    const m = this.crew.get(Number(agentId));
    if (!m) { const l = this.lastOf?.get(Number(agentId)); return l ? { playing: false, last: l } : null; }
    const P = m.player;
    return { playing: m.phase === 'playing', phase: m.phase, game: m.game.id, title: m.game.title, icon: m.game.icon || '🕹️', piece: m.piece.word, mode: m.mode,
      score: P ? P.score : null, secs: P ? Math.round(P.ticks / TICK_HZ) : 0, best: m.best ?? null, level: m.level ?? null, run: m.run?.id || null,
      doing: m.phase === 'playing' ? `Playing ${m.game.title} · ${num(P.score)}` : `Going to play ${m.game.title}` };
  }

  // ------------------------------------------------------------------------------------------------ the interaction registry
  /** The registry's source (server/interactions/registry.js): every arcade piece that plays a game, near the agent or its
   *  owner, played for real; and stopping. It claims those pieces (the furniture's plain 'play' at them is not offered). */
  source() {
    return { id: 'arcade', kinds: ['play_game', 'stop_game'], notes: true, claims: it => !!gameAt(it?.t, 0, 0, 0, it?.g),
      near: ctx => this.near(ctx), run: (ctx, aff, params) => this.run(ctx, aff, params) };   // (notes: its diary lines are its own)
  }
  /** What it can do here now (ctx: the registry's). */
  near(ctx) {
    const out = [], rec = ctx?.rec, a = ctx?.a, sim = ctx?.sim;
    if (!rec || !a?.plan || !sim?.brain) return out;
    const m = this.crew.get(rec.id);
    if (m) {
      const where = { x: m.piece.x, z: m.piece.z, ctx: ctxOf(m.piece.b, m.piece.f), place: m.place || '' };
      out.push({ key: 'stop', kind: 'stop_game', label: m.phase === 'playing' ? `Stop playing ${m.game.title} (${num(m.player.score)} so far — a game left unfinished does not count)` : `Don't play ${m.game.title} after all`,
        where, cost: null, effects: {}, withLeader: m.mode === 'with', d: 0 });
      return out;
    }
    const { p, me, leader, now } = ctx, brain = sim.brain, H = sim.econ || null;
    const withLead = !!(leader && !leader.gone && Number.isFinite(leader.x) && a.order?.kind === 'follow');
    if (withLead && (leader.car || a.ride)) return out;
    const at = withLead ? leader : me, sp = spaceAt(brain, at.x, at.z, at.ctx);
    if (!sp) return out;
    const pieces = piecesOn(brain, p, sp);
    if (!pieces) return out;
    const B = brain.W.buildings[sp.b], L = brain.W.levels[B.lv[sp.f]], vkind = L?.venue || (B.type === 'park' ? 'park' : null);
    const mine = this.record(rec.id), win = [now, now + brain.wm(20)];
    for (const [id, e] of pieces) {
      const game = gameAt(e.it?.t, sp.b, sp.f, id, e.it?.g);
      if (!game || !SIMS[game.id]) continue;
      const slots = e.slots.filter(s => worthUsing(s.use));
      const free = slots.filter(s => (withLead ? brain.seatFree(a, sp.b, sp.f, id, s.k) : !brain.taken(sp.b, sp.f, id, s.k, a.i, win)));
      if (!free.length) continue;
      const w = toWorld(B, free[0].lx, free[0].lz), d = Math.hypot(w.x - me.x, w.z - me.z), dl = withLead ? Math.hypot(w.x - leader.x, w.z - leader.z) : 0;
      if (withLead ? dl > WITH_M : d > NEAR_M) continue;
      const use = free[0].use, word = pieceWord(e.it.t);
      let cost = null;
      try { const q = H?.quote?.(a, { kind: vkind || 'visit', use, b: sp.b, f: sp.f, holdStart: now }); if (q && q.total) cost = q.total; } catch { cost = null; }
      // (next to its owner's: they are playing something here, a few steps from this one)
      const nextTo = withLead && leader.using && dl <= NEXT_TO_M;
      const best = mine.best[game.id];
      const here = nextTo ? `the ${word} next to ${leader.name}'s` : withLead ? `the ${word} near ${leader.name}` : `the ${word}${L?.venue ? ` at ${brain.placeName(sp.b, sp.f)}` : ''}`;
      const label = `Play ${game.title} on ${here} (${best != null ? `your best: ${num(best)}` : 'you have not played it yet'})${cost ? ` (about ${vc(cost)})` : ''}`;
      out.push({ key: `${sp.b}.${sp.f}.${id}`, kind: 'play_game', label, where: { x: w.x, z: w.z, ctx: ctxOf(sp.b, sp.f), place: brain.placeName(sp.b, sp.f) },
        cost, effects: { rate: USES[use]?.rate || null, once: USES[use]?.once || null, words: effectWords(use) }, withLeader: nextTo, d: Math.round(d),
        piece: { b: sp.b, f: sp.f, id, use, word, x: w.x, z: w.z, game: game.id }, mode: withLead ? 'with' : 'own', near: withLead ? dl : d });
    }
    // (next to its owner's first, then the nearest — to its owner when it is with them: where they are is where it plays)
    out.sort((x, y) => (y.withLeader ? 1 : 0) - (x.withLeader ? 1 : 0) || x.near - y.near);
    return out.slice(0, 12);
  }
  /** Does it (checked again now): → { ok, kind, text (for the page), brain (for its chat), effects }. */
  run(ctx, aff, params = {}) {
    const rec = ctx?.rec, a = ctx?.a, sim = ctx?.sim, name = clean(rec?.name || 'It', 40), kind = aff?.kind;
    const no = (text, brain) => ({ ok: false, kind, text, brain });
    if (!rec || !a?.plan || !sim) return no(`${name} has no body here`, 'your body is not in the city right now');
    const m = this.crew.get(rec.id);
    if (kind === 'stop_game') {
      if (!m) return no(`${name} isn't playing anything`, 'you are not playing an arcade game now');
      const was = m.phase === 'playing', score = m.player?.score ?? 0, title = m.game.title;
      this.end(m, 'asked');
      return { ok: true, kind, text: was ? `${name} stops playing ${title}` : `${name} won't play ${title} after all`, brain: was ? `you stopped playing ${title} at ${num(score)} points: a game left unfinished does not count` : `you are not going to play ${title} after all`, effects: {} };
    }
    if (kind !== 'play_game') return no('Nothing like that to do here', 'there is nothing like that to do here');
    if (m) return no(`${name} is already ${m.phase === 'playing' ? 'playing' : 'on the way to play'} ${m.game.title}`, `you are already ${m.phase === 'playing' ? 'playing' : 'on your way to play'} ${m.game.title}: stop that first`);
    const pc = aff.piece, game = gameOf(pc?.game);
    if (!game || !SIMS[game.id]) return no('That machine has no game', 'that machine has no game to play');
    const brain = sim.brain, leader = ctx.leader;
    // its time there: what it was given (world minutes), else a session; the stay held that long and a little more (the
    // game is played in real time, the stay is the sim's: a clock running faster holds it for more world minutes)
    const scale = brain.clock?.dayScale || 16, rate = Math.max(1, Number(brain.clock?.rate) || 1), toWm = ms => (ms / 1000) * rate * scale / 60;
    const session = Number(params.minutes) > 0 ? clamp(((Number(params.minutes) * 60) / scale / rate) * 1000, 60e3, 10 * 60e3) : SESSION_MS;
    const minutes = Math.ceil(toWm(session + WIND_MS) + 2);
    const mine = this.record(rec.id), level = mine.level;
    let paid = '';
    if (aff.mode === 'with') {
      const r = brain.useWith(a, { b: pc.b, f: pc.f, id: pc.id, use: pc.use, minutes });
      if (!r.ok) {
        const why = { not_following: `you are not with ${leader?.name || 'anyone'} now`, riding: 'you are in a car', leader_gone: `${leader?.name || 'they'} left`, gone: 'it is not there any more',
          far: `it is too far from ${leader?.name || 'them'}`, full: 'every place at it is taken', taken: 'someone else just took it', money: 'you have too little money for the tokens', limits: 'your owner\'s spending limits don\'t allow it' }[r.why] || 'it was not possible just then';
        return no(`${name} can't play ${game.title}: ${why}`, `you could not play ${game.title}: ${why} — say so, don't pretend you played`);
      }
      if (r.paid) paid = `, ${vc(r.paid.total)} in tokens from your own money`;
    } else {
      const B = brain.W.buildings[pc.b], r = sim.order(ctx.i, { kind: 'use', venue: { b: pc.b, f: pc.f, x: B?.x ?? 0, z: B?.z ?? 0 }, piece: pc.id, use: pc.use, minutes, maxMinutes: minutes, whole: true, via: params.via || 'agent' });
      if (!r.ok) {
        const why = { no_money: 'the tokens cost money and you have too little', nowhere: 'it is not there any more', not_possible: 'every place at it is taken just now', no_body: 'you have no body in the city right now' }[r.why] || 'it was not possible just then';
        return no(`${name} can't play ${game.title}: ${why}`, `you could not play ${game.title}: ${why} — say so, don't pretend you played`);
      }
      if (aff.cost) paid = ' (the tokens are paid from your own money when you get there)';
    }
    const place = clean(aff.where?.place || '', 50);
    this.crew.set(rec.id, { agent: rec.id, i: ctx.i, key: ctx.p?.agentId ?? null, name, owner: ctx.owner ?? null, ownerName: leader?.name || this.nameOf(ctx.owner), mode: aff.mode === 'with' ? 'with' : 'own', piece: pc, game, place,
      phase: 'going', since: this.now(), session, run: null, player: null, best: mine.best[game.id] ?? null, level });
    const best = mine.best[game.id];
    return { ok: true, kind, text: `${name} is ${aff.mode === 'with' ? 'stepping up to' : 'off to'} the ${pc.word} to play ${game.title}`,
      brain: `you are ${aff.mode === 'with' ? `stepping up to the ${pc.word} near ${leader?.name || 'your owner'}` : `on your way to the ${pc.word}${place ? ` at ${place}` : ''}`} to play ${game.title} — a real game you play yourself at your arcade level (${level})${best != null ? `; your best on it is ${num(best)}` : ''}. The score is recorded as your own (half the experience of a game a person plays; no prizes)${paid}. You haven't played it yet: say what you will do, not a score`,
      effects: aff.effects };
  }
}
