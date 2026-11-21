// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An AI agent as its owner's opponent at the two-player tables (docs/features/versus.md; 2026-11-17, the product owner:
// "Today the player plays the CPU … I want to play with my AI agents" — companions are AI agent players: they use what a
// player uses, with real effects, seen, chosen by their decision model). The second play module open to agents through
// the interaction registry (server/interactions/), after fishing (./fishing-crew.js), and the same pattern.
//
// - Which tables: every piece played by two (shared/versus.js versusOf — a machine whose game is two-sided: the pool
//   table, air hockey, foosball; a piece with two places facing each other for a pastime done together: the ping-pong
//   table), today's and any added later.
// - Asked: its owner steps up to such a table — their game opened at it (POST /api/versus/table from the game's page:
//   client/js/play/machine-play.js), or at one of its ends in Player mode — and a companion with them is offered the
//   other end: Free Will's moment ('owner_game', its decision model chooses among what the registry offers it there), or
//   without Free Will it simply joins in; its owner's plain words ("let's play pool", "play with me": the reflex,
//   server/companions/intent.js 'versus'); its chat brain's do, connected agents' use. No button: the registry's
//   affordance "Play Puck Rush (air hockey) against Kim — from the other end of the Air Hockey" is what they all choose.
// - The other end: its body walks there and plays (the slot's own clip and gear: the cue, the striker, the paddle —
//   Brain.useWith at that slot, a guest of the piece its owner's game holds: server/sim/agents.js pieceGuest), billed as
//   any use there (an arcade's tokens, from its own money); it stays while the game goes on, then is back at their side.
// - Its play: the game on its owner's screen has it as the other player by name and face, and the computer's side is
//   played with its hand — its arcade level and its stars at that game (shared/versus.js handFor: never weaker than
//   the computer, so a game against it is never an easier score) — through the run's own data (shared/arcade.js
//   prepare: data.vs), so the server's check plays the very same game again.
// - Its result, real: each game its owner finishes is its own run too — the same game played again by the module's own
//   check from its side (PlayCore.start side: data.side −1, shared/arcade.js verifyArcade: the sim's other()), recorded as
//   its own (score, half the experience as any unattended run, its arcade level, badges by the platform's rules; no
//   prize: an agent's play is never paid). A word in a bubble over its head ("Good game! 3–2 to you"), the result on its
//   owner's results card, a line in its diary and near its owner; now and then a word of its own (its Mind's remark,
//   within its limits).
// Nothing here draws a simulation random number: the city's routines are unchanged (tools/sim-digest.mjs).
import { evalPlan } from '../sim/plan.js';
import { CATALOG, USES } from '../../shared/catalog.js';
import { ctxB, ctxF, ctxOf } from '../../shared/constants.js';
import { CTX_OUT, CTX_UNDER } from '../../shared/proto.js';
import { PF_USING } from '../../shared/playerproto.js';
import { toWorld, toLocal } from '../../shared/geom.js';
import { moduleLevel, playOf, courseOf } from '../../shared/play.js';
import { versusOf, farSlot, handFor, handWords, goodGame, tally } from '../../shared/versus.js';
import { effectWords } from '../interactions/sources/furniture.js';
import { vc } from '../economy/ledger.js';

export const TICK_MS = 500;
export const PENDING_MS = 20000;   // a companion deciding whether to play (its Free Will's moment): its owner's game waits this long at most
export const AT_M = 1.0;           // m: a player this close to a place at a two-player piece is at it
export const NEAR_M = 10;          // m: a companion takes the other end of a table this close to its owner (Brain.useWith's USE_M)
export const LINGER_MS = 12000;    // its owner's game closed and they are not at the table: the match ends this long after
export const AWAIT_MS = 120000;    // asked to play before its owner is at the table ("let's play pool"): it waits there this long for them
export const ROUND_MIN = 20;       // world minutes its place at the other end is kept ahead, topped up while the match is on
export const RETRY_MS = 5000;      // its owner at a table whose other end nobody could take yet: looked at again this often
const PAID = new Set(['arcade', 'gym']);   // (what bills a use beside its owner: Brain.useWith's PAID_USE)
const clean = (s, n = 60) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>«»]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const lower = s => s.charAt(0).toLowerCase() + s.slice(1);
const pieceName = t => clean(CATALOG[t]?.name || 'table', 40).replace(/\s*\(.*?\)\s*/g, ' ').trim();
/** The game a piece is played with in words: 'Puck Rush (air hockey)'; a pastime's own ('Playing ping-pong': 'ping-pong'). */
const gameWords = v => (v.game ? `${v.game.title} (${v.game.like})` : /^Playing /.test(USES[v.use]?.label || '') ? lower(USES[v.use].label.slice(8)) : `at the ${pieceName(v.t)}`);

export class Versus {
  /**
   * @param {object} o
   * @param {object} o.play         server/play/play.js PlayCore
   * @param {object} o.players      server/world/players.js Players
   * @param {() => object} o.sim    the running Sim
   * @param {object} o.agents       the agent registry (get, byKey)
   * @param {() => object} [o.companions] server/companions/companions.js (remark, decides)
   * @param {object} [o.interactions] server/interactions/ (its owner's game opened: the companion that simply joins in)
   * @param {(rec, text, after) => boolean} [o.ask] offers Free Will's moment (server/free-will/moments.js): true when asked
   * @param {(rec) => boolean} [o.decides] whether its Free Will decides for it (else it joins in by itself)
   * @param {(i, text) => void} [o.say]               a line in a bubble over body i (not voiced)
   * @param {(accountId, frame) => void} [o.toAccount] a frame to an account's pages
   * @param {(agentId, kind, text, o) => void} [o.note] a line in an agent's diary
   * @param {(accountId, text) => void} [o.noteNear]    a line for the agents with a player (their diaries)
   * @param {(account) => string} [o.nameOf]           a player's name as people know them
   */
  constructor({ play, players, sim, agents, companions = () => null, interactions = null, ask = () => false, decides = () => false, say = () => {}, toAccount = () => {},
    note = () => {}, noteNear = () => {}, nameOf = null, remarks = true, now = () => Date.now(), log = null }) {
    Object.assign(this, { play, players, simOf: sim, agents, compOf: companions, interactions, ask, decides, say, toAccount, note, noteNear, nameOfFn: nameOf, remarks, now, log });
    this.tables = new Map();     // owner account → { b, f, id, t, at }: its game open at a two-player piece (the page says)
    this.matches = new Map();    // agent id → its match: { agent, i, name, emoji, owner, b, f, id, t, k, use, game, state, … }
    this.pending = new Map();    // owner account → { key, agents: Set, until, left }: companions deciding whether to play
    this.declined = new Map();   // owner account → { name, why, at }: the last no, for its game's page
    this.invited = new Map();    // owner account → { key, at, done }: its companions asked to play at that table (done: until they leave it)
    this.timer = null; this.off = null;
    this.stats = { invited: 0, asked: 0, joined: 0, refused: 0, games: 0, recorded: 0, ended: 0 };
  }
  get sim() { return this.simOf(); }
  /** Listens to the play core (its owner's games against it) and keeps the matches going (timer: twice a second). */
  attach({ timer = true } = {}) {
    this.off = this.play?.on?.(ev => { try { this.onPlay(ev); } catch (e) { this.log?.warn?.('[versus] a game\'s result:', e.stack || e.message); } }) || null;
    if (timer) { this.timer = setInterval(() => { try { this.tick(); } catch (e) { this.log?.warn?.('[versus] tick failed:', e.stack || e.message); } }, TICK_MS); this.timer.unref?.(); }
    return this;
  }
  stop() { clearInterval(this.timer); this.timer = null; this.off?.(); this.off = null; }

  // ------------------------------------------------------------------------------------------------ who, where
  nameOf(account) { let n = null; try { n = this.nameOfFn?.(account) || null; } catch { n = null; } return clean(n || this.players.byId.get(account)?.name || 'your owner', 40); }
  recOf(i) { const p = this.sim?.people[i]; return p?.vip && p.agentId ? this.agents.byKey(p.agentId) : null; }
  key(b, f, id) { return `${b}.${f}.${id}`; }
  /** The two-player piece id on floor f of building b: { b, f, id, t, v (versusOf's), B, e (the index entry) } or null. */
  pieceAt(b, f, id) {
    const brain = this.sim?.brain, B = brain?.W.buildings[b];
    if (!B || B.gone || ![b, f, id].every(Number.isInteger)) return null;
    const e = brain.index.entry(b, f, id), v = e ? versusOf(e.it.t) : null;
    return v ? { b, f, id, t: e.it.t, v, B, e } : null;
  }
  /** Where slot k of a piece is in the world: { x, z }. */
  slotAt(T, k) { const s = T.e.slots[k]; return toWorld(T.B, s.lx, s.lz); }
  /** The floor a body at (x, z) on ctx is on: { b, f } (a park's grounds from the street), or null. */
  floorAt(x, z, ctx) {
    if (ctx >= 0) return { b: ctxB(ctx), f: ctxF(ctx) };
    if (ctx === CTX_OUT || ctx === CTX_UNDER) { const B = this.sim?.brain?.parkAt?.(x, z); return B ? { b: B.idx, f: 0 } : null; }
    return null;
  }
  /** The place of a two-player piece a player stands at now (Player mode: using it): { …pieceAt, k } or null. */
  playerAt(account) {
    const p = this.players.byId.get(account);
    if (!p || !(p.flags & PF_USING) || p.vehicleId) return null;
    const fl = this.floorAt(p.x, p.z, p.ctx), brain = this.sim?.brain;
    if (!fl || !brain) return null;
    const B = brain.W.buildings[fl.b];
    if (!B || B.gone || !(fl.f >= 0) || fl.f >= B.floors) return null;
    let best = null, bd = AT_M;
    for (const [id, e] of brain.index.slots(B.lv[fl.f])) {
      const v = versusOf(e.it.t);
      if (!v) continue;
      for (const k of v.slots) { const s = e.slots[k], w = toWorld(B, s.lx, s.lz), d = Math.hypot(w.x - p.x, w.z - p.z); if (d < bd) { bd = d; best = { b: fl.b, f: fl.f, id, t: e.it.t, v, B, e, k }; } }
    }
    return best;
  }
  /** Its owner's two-player table now: their game open at one (the page said), or at one of its ends — { …pieceAt, k
   *  (their place, or null), open } or null. */
  tableOf(account) {
    const o = this.tables.get(account);
    if (o) { const T = this.pieceAt(o.b, o.f, o.id); if (T) { const at = this.playerAt(account); return { ...T, k: at && at.id === T.id && at.b === T.b && at.f === T.f ? at.k : null, open: true }; } }
    const at = this.playerAt(account);
    return at ? { ...at, open: false } : null;
  }
  /** The other end of table T for body a (its owner at their end): a free place of its use there — the game's far end,
   *  else the end farthest from its owner — → k or -1. */
  otherEnd(T, a, owner) {
    const brain = this.sim.brain, p = this.players.byId.get(owner);
    const at = p ? (() => { const L = toLocal(T.B, p.x, p.z), it = T.e.it; const dx = L.x - it.x, dz = L.z - it.z, r = -(it.r || 0), c = Math.cos(r), s = Math.sin(r); return [dx * c + dz * s, -dx * s + dz * c]; })() : null;
    const not = T.k != null ? [T.k] : [];
    const was = brain.isGuest(T.b, T.f, T.id, a.i);
    if (!was) brain.pieceGuest(T.b, T.f, T.id, a.i, true);
    try {
      for (let tries = 0; tries < T.v.slots.length; tries++) {
        const k = farSlot(T.v, at, not);
        if (k < 0) return -1;
        if (brain.seatFree(a, T.b, T.f, T.id, k)) return k;
        not.push(k);
      }
      return -1;
    } finally { if (!was) brain.pieceGuest(T.b, T.f, T.id, a.i, false); }
  }
  /** Its owner's companions now (following them): [{ rec, i, a, d (m from the table) }], nearest first. */
  followers(owner, T = null) {
    const sim = this.sim, out = [];
    if (!sim) return out;
    for (const a of sim.agents) {
      const o = a?.order;
      if (!a?.plan || o?.kind !== 'follow' || o.lead?.kind !== 'player' || o.lead.id !== owner || a.ride) continue;
      const rec = this.recOf(a.i);
      if (!rec) continue;
      const e = evalPlan(a.plan, sim.now()), ec = e.ctx === CTX_UNDER ? CTX_OUT : e.ctx;
      let d = 0;
      if (T) { const w = this.slotAt(T, T.v.slots[0]); d = sim.brain.sameSpace(ec, ctxOf(T.b, T.f)) ? Math.hypot(e.x - w.x, e.z - w.z) : Infinity; }
      out.push({ rec, i: a.i, a, d });
    }
    return out.sort((x, y) => x.d - y.d);
  }
  matchOf(owner, T = null) { for (const m of this.matches.values()) if (m.owner === owner && (!T || (m.b === T.b && m.f === T.f && m.id === T.id))) return m; return null; }

  // ------------------------------------------------------------------------------------------------ the registry's source
  /** The registry's source (server/interactions/registry.js): playing its owner at the other end of their table, and
   *  stopping. */
  source() {
    return { id: 'versus', kinds: ['versus', 'versus_stop'], notes: true, near: ctx => this.near(ctx), run: (ctx, aff, params) => this.run(ctx, aff, params) };   // (notes: its diary lines are its own)
  }
  near(ctx) {
    const out = [], rec = ctx?.rec, a = ctx?.a, L = ctx?.leader, sim = this.sim;
    if (!rec || !a?.plan || !sim || !L || L.kind !== 'player' || L.gone || L.car || a.ride || a.order?.kind !== 'follow') return out;
    const owner = this.nameOf(L.account), m = this.matches.get(rec.id);
    if (m) {
      const T = this.pieceAt(m.b, m.f, m.id), w = T ? this.slotAt(T, m.k) : null;
      out.push({ key: 'stop', kind: 'versus_stop', label: `Stop playing ${owner} at the ${pieceName(m.t)} and come back to their side${m.games ? ` (${m.games} ${m.games === 1 ? 'game' : 'games'}: ${m.wins} won, ${m.losses} lost)` : ''}`,
        where: w ? { x: w.x, z: w.z, ctx: ctxOf(m.b, m.f), place: pieceName(m.t) } : null, cost: null, effects: {}, withLeader: true, d: 0 });
      return out;
    }
    const T = this.tableOf(L.account);
    if (!T) return out;
    const k = this.otherEnd(T, a, L.account);
    if (k < 0) return out;
    const w = this.slotAt(T, k), e = evalPlan(a.plan, sim.now()), dl = Number.isFinite(L.x) ? Math.hypot(w.x - L.x, w.z - L.z) : Infinity;
    if (dl > NEAR_M) return out;
    const Bv = sim.world.levels[T.B.lv[T.f]]?.venue || (T.B.type === 'park' ? 'park' : null);
    let cost = null;
    try { const q = PAID.has(Bv) ? sim.econ?.quote?.(a, { kind: Bv, use: T.v.use, b: T.b, f: T.f, holdStart: sim.now() }) : null; if (q && q.total) cost = q.total; } catch { cost = null; }
    out.push({ key: this.key(T.b, T.f, T.id), kind: 'versus', label: `Play ${gameWords(T.v)} against ${owner} — from the other end of the ${pieceName(T.t)}${cost ? ` (about ${vc(cost)})` : ''}`,
      where: { x: w.x, z: w.z, ctx: ctxOf(T.b, T.f), place: sim.brain.placeName(T.b, T.f) }, cost,
      // (its owner at that table now: joining them there, first of all — d 0)
      effects: { rate: USES[T.v.use]?.rate || null, once: null, words: effectWords(T.v.use) }, withLeader: true, d: T.open || T.k != null ? 0 : Math.round(Math.hypot(w.x - e.x, w.z - e.z)),
      piece: { b: T.b, f: T.f, id: T.id, k, game: T.v.game?.id || null } });
    return out;
  }
  /** Does what aff says (looked at again now): → { ok, kind, text (for the page), brain (for its chat), effects }. */
  run(ctx, aff, params = {}) {
    const rec = ctx?.rec, a = ctx?.a, kind = aff?.kind, name = clean(rec?.name || 'It', 40);
    const no = (text, brain) => ({ ok: false, kind, text, brain });
    if (!rec || !a?.plan || !this.sim) return no(`${name} has no body here`, 'your body is not in the city right now');
    if (kind === 'versus_stop') {
      const m = this.matches.get(rec.id);
      if (!m) return no(`${name} isn't playing anyone`, 'you are not playing anyone now');
      this.end(m, 'asked');
      return { ok: true, kind, text: `${name} stops playing and comes back to ${this.nameOf(m.owner)}`, brain: `you stopped playing ${this.nameOf(m.owner)} at the ${pieceName(m.t)} and are back at their side (${m.games} ${m.games === 1 ? 'game' : 'games'}: ${m.wins} won, ${m.losses} lost)`, effects: {} };
    }
    if (kind !== 'versus') return no('Nothing like that to do here', 'there is nothing like that to do here');
    const L = ctx.leader, T = L ? this.tableOf(L.account) : null;
    if (!T || !aff.piece || T.b !== aff.piece.b || T.f !== aff.piece.f || T.id !== aff.piece.id) return no(`${name}'s owner is not at that table now`, 'your owner is not at that table now');
    return this.begin(ctx, T, params?.via || ctx.via || 'asked');
  }
  /** Its body to the other end of table T to play its owner (looked at again now): → the registry's result. */
  begin(ctx, T, via) {
    const rec = ctx.rec, a = ctx.a, sim = this.sim, brain = sim.brain, owner = ctx.leader?.account ?? ctx.owner, oname = this.nameOf(owner), name = clean(rec.name, 40);
    const no = (text, brain) => { this.stats.refused++; return { ok: false, kind: 'versus', text, brain }; };
    const have = this.matches.get(rec.id);
    if (have && have.b === T.b && have.f === T.f && have.id === T.id) return { ok: true, kind: 'versus', text: `${name} is at the other end already`, brain: `you are already playing ${oname} at the ${pieceName(T.t)}`, effects: {} };
    if (have) this.end(have, 'other');
    const other = this.matchOf(owner, T);
    if (other) return no(`${clean(other.name, 40)} is playing ${oname} there already`, `${clean(other.name, 40)} is already at the other end of that table, playing ${oname}`);
    const k = this.otherEnd(T, a, owner);
    if (k < 0) return no(`There is no free place at the other end of the ${pieceName(T.t)}`, `the other end of the ${pieceName(T.t)} is taken: you can't play ${oname} there now`);
    brain.pieceGuest(T.b, T.f, T.id, a.i, true);
    const r = brain.useWith(a, { b: T.b, f: T.f, id: T.id, use: T.v.use, minutes: ROUND_MIN, k });
    if (!r.ok) {
      brain.pieceGuest(T.b, T.f, T.id, a.i, false);
      const why = { not_following: `you are not with ${oname} now`, riding: 'you are in a car', leader_gone: `${oname} left`, gone: 'the table is not there any more', far: `the table is too far from ${oname}`,
        full: 'the other end is taken', taken: 'someone else just took the other end', money: 'you have too little money to play there', limits: 'your owner\'s spending limits don\'t allow it' }[r.why] || 'it was not possible just then';
      return no(`${name} can't play: ${why}`, `you could not: ${why} — say so, don't pretend you did it`);
    }
    // (its hand: its arcade level, and its stars at this game)
    let level = 1, stars = 0;
    if (T.v.game) { try { const M = this.play.progress(-rec.id).modules.arcade; level = moduleLevel(M?.xp || 0); stars = M?.best?.[T.v.game.id]?.stars || 0; } catch { level = 1; } }
    const m = { agent: rec.id, i: a.i, name, emoji: clean(rec.emoji || '🤖', 8), owner, b: T.b, f: T.f, id: T.id, t: T.t, k, use: T.v.use, game: T.v.game?.id || null, count: T.v.game?.count || null, words: gameWords(T.v),
      state: 'coming', since: this.now(), arrived: null, met: false, hand: T.v.game ? handFor(level, stars) : null, level, via, games: 0, wins: 0, losses: 0, draws: 0, last: null, playing: false, leftAt: null };
    this.matches.set(rec.id, m);
    this.pending.delete(owner); this.declined.delete(owner);
    this.stats.joined++;
    const words = gameWords(T.v), piece = pieceName(T.t);
    this.note(rec.id, 'activity', `Went to the other end of the ${piece} to play ${words} against ${oname}`, { key: 'versus' });
    this.frame(owner, { state: 'coming', text: `${m.emoji} ${name} is heading to the other end of the ${piece} to play you` });
    const paid = r.paid ? `; ${vc(r.paid.total)} for it from your own money` : '';
    const hand = m.hand != null ? ` — your own play, at your arcade level ${level} (${handWords(m.hand)}); every game you finish against them is recorded as yours too` : '';
    return { ok: true, kind: 'versus', text: `${name} is going to the other end of the ${piece} to play ${oname}`,
      brain: `you are walking to the other end of the ${piece} to play ${words} against ${oname}: on their screen the other player is you${hand}${paid}`, effects: { rate: USES[T.v.use]?.rate || null } };
  }
  /** Its owner's plain words (the reflex: 'versus' — "let's play pool", "play with me" —, 'unversus'): → { ok, action,
   *  text, brain } or null (no body; "let's play" with no table for two near: not this — its brain and Free Will read it).
   *  cmd.game: the game asked for in words ('pool', 'air hockey' …), or null. */
  command(P, rec, cmd, via = 'chat', ctxOf = null) {
    const ctx = ctxOf ? ctxOf(rec) : null;
    if (!ctx?.a) return null;
    const action = cmd?.action || 'versus';
    if (action === 'unversus') {
      const r = this.run({ ...ctx, via }, { kind: 'versus_stop' });
      return { ok: r.ok, action, text: r.text, brain: r.brain };
    }
    const L = ctx.leader, owner = L?.account ?? P?.account?.id ?? null, oname = this.nameOf(owner);
    if (!L || L.kind !== 'player' || L.gone || ctx.a.order?.kind !== 'follow') return { ok: false, action, text: `${clean(rec.name, 40)} is not out with you`, brain: `you are not out with ${oname} now: they can call you over first` };
    let T = this.tableOf(owner);
    if (T && cmd.game && !this.wants(T, cmd.game)) T = null;
    if (!T) T = this.tableNear(owner, cmd.game, ctx.a);
    if (!T && !cmd.game) return null;
    const what = cmd.game ? clean(cmd.game, 30) : 'a game for two';
    if (!T) return { ok: false, action, text: `There is no ${what === 'a game for two' ? 'table for two' : what} free near you`, brain: `there is no ${what === 'a game for two' ? 'table for two players' : `${what} table`} free near ${oname} — say so; they can walk up to one and ask again` };
    const r = this.begin({ ...ctx, via }, T, via);
    return { ok: r.ok, action, text: r.text, brain: r.brain };
  }
  /** Whether table T is the game asked for in words ('pool', 'air hockey', 'foosball', 'ping-pong' …). */
  wants(T, words) {
    const w = String(words || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!w || /^(agame|game|around|amatch|match|something)$/.test(w)) return true;
    const hay = [T.v.game?.title, T.v.game?.like, T.v.game?.id, CATALOG[T.t]?.name, T.t, USES[T.v.use]?.label].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z]/g, '');
    const alias = { billiards: 'pool', snooker: 'pool', eightball: 'pool', hockey: 'airhockey', tabletennis: 'pingpong', foos: 'foosball', tablefootball: 'foosball', tablesoccer: 'foosball' };
    return hay.includes(w) || (alias[w] && hay.includes(alias[w])) || (w.length > 4 && hay.includes(w.slice(0, -1)));
  }
  /** The nearest two-player piece near its owner (within NEAR_M, its owner's floor) with both ends free — the one asked
   *  for in words —: { …pieceAt, k: null, open: false } or null. */
  tableNear(owner, words, a) {
    const p = this.players.byId.get(owner), brain = this.sim?.brain;
    if (!p || !brain || p.vehicleId) return null;
    const fl = this.floorAt(p.x, p.z, p.ctx), B = fl ? brain.W.buildings[fl.b] : null;
    if (!B || B.gone || !(fl.f >= 0) || fl.f >= B.floors) return null;
    let best = null, bd = NEAR_M;
    for (const [id, e] of brain.index.slots(B.lv[fl.f])) {
      const v = versusOf(e.it.t);
      if (!v) continue;
      const T = { b: fl.b, f: fl.f, id, t: e.it.t, v, B, e, k: null, open: false };
      if (words && !this.wants(T, words)) continue;
      if (v.slots.some(k => brain.taken(fl.b, fl.f, id, k, a.i))) continue;
      const d = Math.min(...v.slots.map(k => { const w = this.slotAt(T, k); return Math.hypot(w.x - p.x, w.z - p.z); }));   // (the nearest end)
      if (d < bd) { bd = d; best = T; }
    }
    return best;
  }

  // ------------------------------------------------------------------------------------------------ its owner's game
  /** Its owner's game opened (on) or closed at piece (b, f, id) (POST /api/versus/table): → view(). An opened one asks a
   *  companion with them to play (invite). */
  table(account, { b, f, id, on = true } = {}) {
    if (on === false) { this.tables.delete(account); this.pending.delete(account); return this.view(account); }
    const T = this.pieceAt(Number(b), Number(f ?? 0), Number(id));
    if (!T) return { ok: false, error: 'not_two_player', message: 'That is not a table for two' };
    this.tables.set(account, { b: T.b, f: T.f, id: T.id, t: T.t, at: this.now() });
    this.invited.delete(account);
    if (!this.matchOf(account, T)) this.invite(account, { ...T, k: null, open: true }, 'table');
    return this.view(account);
  }
  /**
   * Asks the companions with owner to play them at table T: one whose Free Will decides is offered the moment (its decision
   * model chooses among what the registry has for it there — the other end first); one without it simply joins in (the
   * nearest). Once a table while its owner stays at it (their game opened again: again). → how many were asked or joined.
   */
  invite(owner, T, why) {
    const k0 = this.key(T.b, T.f, T.id), t = this.now(), last = this.invited.get(owner);
    if ((last && last.key === k0 && (last.done || t - last.at < RETRY_MS)) || this.matchOf(owner)) return 0;
    const list = this.followers(owner, T).filter(c => c.d <= NEAR_M + 4 && !this.matches.has(c.rec.id));
    if (!list.length) return 0;
    const mark = { key: k0, at: t, done: false };   // (nobody could yet — the other end booked a while: looked at again in a moment)
    this.invited.set(owner, mark);
    this.stats.invited++;
    const oname = this.nameOf(owner), text = `${oname} (your owner) stepped up to the ${pieceName(T.t)} to play ${gameWords(T.v)} — a game for two: the other end is free for you`;
    const P = { key: k0, agents: new Set(), until: t + PENDING_MS, left: 0, why };
    for (const c of list) {
      let free = false; try { free = !!this.decides(c.rec); } catch { free = false; }
      if (free) {
        let asked = false;
        try { asked = !!this.ask(c.rec, text, pick => this.decided(owner, c.rec, pick)); } catch { asked = false; }
        if (asked) { P.agents.add(c.rec.id); P.left++; this.stats.asked++; }
        continue;
      }
      // (no Free Will to decide: it simply joins in, the nearest — through the registry, as any other way of asking)
      if (!this.interactions) continue;
      const r = this.interactions.doFor(c.rec, `versus:${k0}`, { via: 'self' });
      if (r && typeof r.then !== 'function' && r.ok) { mark.done = true; return 1; }
    }
    if (P.agents.size) { mark.done = true; this.pending.set(owner, P); this.frame(owner, { state: 'pending', text: null }); }
    return P.agents.size;
  }
  /** A companion's moment was decided (Free Will: pick, what it chose and did — null: nothing) — no match from it: one
   *  fewer to wait for. */
  decided(owner, rec, pick) {
    const P = this.pending.get(owner);
    if (!P || !P.agents.has(rec.id)) return;
    P.agents.delete(rec.id);
    if (this.matches.has(rec.id)) return;
    if (!P.agents.size) {
      this.pending.delete(owner);
      // (what it chose instead, in its decision's own words: "Carry on as I am, with Kim", "Turn and look at the dog" …)
      const l = pick?.label ? lower(clean(pick.label, 80)) : '';
      const why = !l || pick.kind === 'stay' ? 'chose to carry on as they were' : `chose to ${l.replace(/^to /, '')} instead`;
      this.declined.set(owner, { name: clean(rec.name, 40), emoji: clean(rec.emoji || '🤖', 8), why, at: this.now() });
      this.frame(owner, { state: 'declined', text: null });
    }
  }
  /** Where things stand for owner's page (its game at a table): { table, vs, pending, declined }. */
  view(owner) {
    const t = this.now(), o = this.tables.get(owner), m = this.matchOf(owner), P = this.pending.get(owner), D = this.declined.get(owner);
    return {
      ok: true, table: o ? { b: o.b, f: o.f, id: o.id } : null,
      vs: m ? { agent: m.agent, name: m.name, emoji: m.emoji, state: m.state, b: m.b, f: m.f, id: m.id, game: m.game, level: m.level, hand: m.hand, words: m.hand != null ? handWords(m.hand) : null,
        games: m.games, wins: m.wins, losses: m.losses, draws: m.draws, last: m.last } : null,
      pending: P && t < P.until ? { agents: [...P.agents].map(id => { const r = this.agents.get(id); return { agent: id, name: clean(r?.name || '', 40), emoji: clean(r?.emoji || '🤖', 8) }; }), ms: P.until - t } : null,
      declined: D && t - D.at < 60000 ? { name: D.name, emoji: D.emoji, why: D.why } : null,
    };
  }
  /** Its owner's pages hear how it stands (the game waiting for it: client/js/play/machine-play.js). */
  frame(owner, { state, text }) { try { this.toAccount(owner, { t: 'versus', state, text, view: this.view(owner) }); } catch { /* a page gone */ } }
  /** What a run of a two-sided game starts with (the arcade module's prepare: shared/arcade.js): its owner's match at that
   *  table, its companion there and ready — { vs: { agent, name, emoji, k (its hand), level, game } } — else {}. */
  context(where, account) {
    const m = account?.id != null ? this.matchOf(account.id) : null;
    if (!m || !m.game || m.state !== 'ready') return {};
    // (the run started at that table — its page says where —: not the player's game elsewhere, nor one they chose to play the computer)
    if (!where || typeof where !== 'object' || Number(where.b) !== m.b || Number(where.f ?? 0) !== m.f || Number(where.id) !== m.id) return {};
    return { vs: { agent: m.agent, name: m.name, emoji: m.emoji, k: m.hand, level: m.level, game: m.game } };
  }

  // ------------------------------------------------------------------------------------------------ the games
  /** The play core's events: its owner's game against it finished — its own side recorded. */
  onPlay(ev) {
    if (ev?.type !== 'finish' || !(ev.account > 0) || ev.run?.module !== 'arcade' || !ev.run.data?.vs) return;
    const r = this.record(ev);
    if (r && ev.result && typeof ev.result === 'object') ev.result.vs = r;   // (on its owner's results card: the route returns this result)
  }
  /** Its side of a game its owner just finished against it: its own run of it, played again by the module's check from
   *  its side, recorded as its own → what its owner's page shows of it, or null. */
  record(ev) {
    const vs = ev.run.data.vs, rec = this.agents.get(vs.agent), m = this.matches.get(vs.agent) || null;
    if (!rec) return null;
    const acct = { id: -rec.id };
    let res = null;
    try {
      const st = this.play.start(acct, 'arcade', ev.run.course, null, { auto: true, side: ev.run });
      res = this.play.finish(acct, st.run, { log: ev.report?.log });
    } catch (e) { this.log?.warn?.('[versus] its side was not recorded:', e.message); return null; }
    if (!res?.ok) { this.log?.warn?.('[versus] its side did not count:', res?.why); return null; }
    this.stats.recorded++;
    const d = res.detail || {}, owner = ev.account, oname = this.nameOf(owner), name = clean(rec.name, 40), count = m?.count || (d.me != null && ev.run.course === 'pool-shark' ? 'balls' : 'goals');
    const title = clean(courseOf(playOf(ev.run.module), ev.run.course)?.label || ev.run.course, 40), line = goodGame(d, count), t = count === 'balls' ? `${d.me} balls to ${d.them}` : tally(d.me, d.them);
    if (m) { m.games++; if (d.win) m.wins++; else if (d.draw) m.draws++; else m.losses++; m.last = { win: !!d.win, draw: !!d.draw, me: d.me, them: d.them, score: res.score, at: this.now() }; m.playing = false; }
    const i = m?.i ?? (() => { const S = this.sim; return S ? S.people.findIndex(p => p?.agentId === rec.key) : -1; })();
    if (i >= 0) this.say(i, line);
    this.note(rec.id, 'activity', `${d.win ? 'Beat' : d.draw ? 'Drew with' : 'Lost to'} ${oname} at ${title}: ${t}, ${res.score} pts for your side${res.newBest ? ' (your best yet)' : ''}`, { key: 'versus' });
    try { this.noteNear(owner, `${oname} ${d.win ? 'lost to' : d.draw ? 'drew with' : 'beat'} ${name} at ${title} (${count === 'balls' ? `${d.them} balls to ${d.me}` : tally(d.them, d.me)})`); } catch { /* a nicety */ }
    // (a word of its own now and then: its Mind's, within its limits — a win, a shutout, a new best; after the bubble)
    if (this.remarks && i >= 0 && (d.win || res.newBest || (d.them === 0 && d.me > 0))) {
      const T = setTimeout(() => { try { this.compOf?.()?.remark?.(i, `I just played ${title} against ${oname} (my owner) at the other end of the table and ${d.win ? 'won' : d.draw ? 'drew' : 'lost'} ${t}${res.newBest ? ' — my best score yet' : ''}.`); } catch { /* a word is a nicety */ } }, 6000);
      T.unref?.();
    }
    return { agent: rec.id, name, emoji: clean(rec.emoji || '🤖', 8), score: res.score, stars: res.stars, xp: res.xp, newBest: !!res.newBest, level: res.module?.level ?? null, levelUp: !!(res.module && res.module.level > res.module.was),
      badges: (res.badges || []).map(b => ({ id: b.id, label: b.label, icon: b.icon })), win: !!d.win, draw: !!d.draw, me: d.me ?? null, them: d.them ?? null, count, line, hand: vs.k ?? null };
  }

  // ------------------------------------------------------------------------------------------------ keeping it going
  tick() {
    const sim = this.sim, t = this.now();
    if (!sim) return;
    // (its owner at one end of a two-player table in Player mode — or their game opened at one: a companion is asked)
    for (const [owner] of this.ownersWithCompanions()) {
      const T = this.tableOf(owner);
      if (!T) { this.invited.delete(owner); continue; }   // (away from every table: the next one asks again)
      if (this.matchOf(owner) || this.pending.has(owner)) continue;
      this.invite(owner, T, T.open ? 'table' : 'at');
    }
    for (const [owner, P] of this.pending) if (t >= P.until) {
      this.pending.delete(owner);
      const r = this.agents.get([...P.agents][0]);
      if (r) { this.declined.set(owner, { name: clean(r.name, 40), emoji: clean(r.emoji || '🤖', 8), why: 'didn\'t take you up on it', at: t }); this.frame(owner, { state: 'declined', text: null }); }
    }
    for (const m of [...this.matches.values()]) this.keep(m, t);
  }
  /** The owners with a companion following them now (once a tick): Map owner → n. */
  ownersWithCompanions() {
    const out = new Map(), sim = this.sim;
    for (const a of sim.agents) { const o = a?.order; if (a?.plan && o?.kind === 'follow' && o.lead?.kind === 'player' && a.p?.vip) out.set(o.lead.id, (out.get(o.lead.id) || 0) + 1); }
    return out;
  }
  /** One match, every tick: there yet; kept going while its owner plays (or is at the table); over when they leave. */
  keep(m, t) {
    const sim = this.sim, brain = sim.brain, a = sim.agents[m.i], o = a?.order, s = o?.seat;
    const sk = brain.key(m.b, m.f, m.id, m.k);
    if (!a?.plan || o?.kind !== 'follow' || !s || s.key !== sk || s.mode !== 'use') { this.end(m, o?.lastSeat?.why === 'leader' ? 'walked' : 'gone'); return; }
    // (there: its body holding still at that place now, as its plan has it — its next round is planned a little ahead)
    const now = sim.now(), e = m.state === 'coming' ? evalPlan(a.plan, now) : null;
    if (e && e.s?.h && Math.hypot(e.x - s.x, e.z - s.z) < 0.5) {
      m.state = 'ready'; m.arrived = t;
      this.frame(m.owner, { state: 'ready', text: `${m.emoji} ${m.name} is at the other end${m.game ? ' — ready to play' : ''}` });
    }
    // (its owner still at it: their game open there, a run against it in flight, or at one of its ends)
    const T0 = this.tables.get(m.owner), open = !!T0 && T0.b === m.b && T0.f === m.f && T0.id === m.id;
    const run = this.play.runOf?.(m.owner), playing = !!run && run.data?.vs?.agent === m.agent;
    const at = this.playerAt(m.owner), there = !!at && at.b === m.b && at.f === m.f && at.id === m.id;
    if (open || playing || there) {
      m.leftAt = null; m.met = true;
      if (s.until - now < brain.wm(ROUND_MIN / 2)) s.until = now + brain.wm(ROUND_MIN);   // (its place at the other end kept ahead)
      return;
    }
    if (m.leftAt == null) { m.leftAt = t; return; }
    // (not there yet — asked by its owner's words, it waits at its end for them a while; after playing, a moment)
    if (t - m.leftAt >= (!m.met ? AWAIT_MS : m.game ? LINGER_MS : LINGER_MS / 2)) this.end(m, m.met ? 'done' : 'stood_up');
  }
  /** A match is over: its body back at its owner's side (unless it is gone already), the table no longer its. */
  end(m, why) {
    if (!this.matches.has(m.agent)) return;
    this.matches.delete(m.agent);
    this.stats.ended++;
    const sim = this.sim, brain = sim?.brain, a = sim?.agents[m.i], o = a?.order;
    brain?.pieceGuest(m.b, m.f, m.id, m.i, false);
    if (o?.seat && o.seat.key === brain.key(m.b, m.f, m.id, m.k)) { brain.seatEnd(a, o, why === 'asked' ? 'asked' : 'done'); try { brain.reorder(a); } catch { /* planned again on its next round */ } }
    const oname = this.nameOf(m.owner), piece = pieceName(m.t), mins = Math.max(1, Math.round((this.now() - (m.arrived || m.since)) / 60000));
    const games = m.games ? `${m.games} ${m.games === 1 ? 'game' : 'games'}: ${m.wins} won, ${m.losses} lost${m.draws ? `, ${m.draws} drawn` : ''}` : null;
    // (what it did there, honestly: games played, a pastime for a while, or waited for them in vain)
    const did = games ? `Played ${m.words} against ${oname} at the ${piece} (${games})` : m.met && !m.game ? `Played ${m.words} against ${oname} at the ${piece} for ${mins} min`
      : m.met ? `Was at the other end of the ${piece} to play ${oname}; no game was finished` : `Waited at the other end of the ${piece} for ${oname} to play; they didn't come`;
    if (m.arrived) this.note(m.agent, 'activity', did, { key: 'versus' });
    if (!m.game && m.arrived && why === 'done' && a?.plan) this.say(m.i, `Good game, ${oname}!`);
    this.frame(m.owner, { state: 'ended', text: why === 'done' || why === 'other' ? null : why === 'stood_up' ? `${m.emoji} ${m.name} waited at the ${piece} and came back to you` : `${m.emoji} ${m.name} left the ${piece}` });
  }
  /** Its match now, for its owner's views and the tests. */
  matchView(agentId) { const m = this.matches.get(Number(agentId)); return m ? { ...m } : null; }
}

/**
 * Its player's page (the game at a table for two: client/js/play/machine-play.js): POST /api/versus/table { b, f, id, on }
 * — their game opened (on) or closed there: a companion with them is asked to play them; GET /api/versus — how it stands
 * ({ table, vs, pending, declined }). Only the player's own companions are ever asked.
 */
export function addVersusRoutes(router, versus) {
  router.add({ method: 'POST', path: '/api/versus/table', cap: 'play.use', handler: ({ body, P }) => {
    const V = versus();
    if (!V) return { status: 200, json: { ok: true, table: null, vs: null, pending: null, declined: null } };
    const r = V.table(P.account.id, { b: Number(body?.b), f: Number(body?.f ?? 0), id: Number(body?.id), on: body?.on !== false });
    return r.ok === false ? { status: 400, json: { error: r.error, message: r.message } } : { status: 200, json: r };
  } });
  router.add({ method: 'GET', path: '/api/versus', cap: 'play.use', handler: ({ P }) => {
    const V = versus();
    return { status: 200, json: V ? V.view(P.account.id) : { ok: true, table: null, vs: null, pending: null, declined: null } };
  } });
}
