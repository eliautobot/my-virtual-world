// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's senses (docs/features/awareness.md): the one place that works out what an AI agent can tell about the world
// around it, for every brain — the built-in Mind (its chat), OpenClaw and Hermes (a header on its owner's message) and
// connected agents (their now and look tools). Three pieces:
//   the diary  (./diary.js)    what happened to it lately — written here, by tick() and the hooks below
//   the reader (look(), recent(), ./where.js, ./activities.js)   what is around it now, read from the live world
//   the line   (line())        the tiny line that goes with a message
// and its owner's choice of how much its brain is told (mode(), Studio → Awareness): off, only when it asks ('ask'), when
// its owner is with it ('together': the full picture together, the line apart) or always. pack() puts it together for one
// message and says what it did, so every answer can show what the agent knew.
import { evalPlan } from '../sim/plan.js';
import { F_HIDDEN } from '../../shared/proto.js';
import { formatClock, EYES_M } from '../../shared/constants.js';
import { PF_USING, PF_DRIVING } from '../../shared/playerproto.js';
import { activeAt } from '../../shared/species.js';
import { Diary } from './diary.js';
import { Activities, BUILT_IN } from './activities.js';
import { Sights, carSights, waterSights } from './sights.js';
import { mealSeen, foodWords } from './meals.js';
import { whereOf, sideOf, metres, clean, q, ctxB, spaceOf } from './where.js';
import { cleanView, viewCaption } from './view.js';

export const MODES = Object.freeze(['off', 'ask', 'together', 'always']);
export const MODE_INFO = Object.freeze([
  { id: 'off', label: 'Off', help: 'Told nothing about its surroundings in its chats. Best for an agent you only use as an assistant.' },
  { id: 'ask', label: 'Only when it asks', help: 'Nothing is sent with your messages; it looks around itself when a question needs it.' },
  { id: 'together', label: 'When it\'s with me', help: 'The full picture while you are together (out with you, in your car, near you); one short line when you are apart.' },
  { id: 'always', label: 'Always', help: 'The full picture with every message, wherever you both are. The most aware, and the most words sent.' },
]);
const KIND_WORD = { cafe: 'café', restaurant: 'restaurant', park: 'park', shop: 'shop', gym: 'gym', arcade: 'arcade', lounge_bar: 'lounge', club: 'night club' };
export const NEAR_M = 15;          // a writer this close (the same space) is with its agent
/** The word before a seat's words: at a table, on a bench (its use 'eat' or a table: "at"). */
const seatPrep = seat => (seat.use === 'eat' || /\btable\b/.test(String(seat.words || '')) ? 'at' : /\b(armchair|sofa|couch)\b/.test(String(seat.words || '')) ? 'in' : 'on');
export const HEAR_M = 12;          // lines said this close reach it
export const AROUND_M = 25;        // people this close are around it
export const AROUND_MAX = 6;
export const SIGHT_M = 80;         // the writer this close (the same space) is in sight: the line says where
export { EYES_M };                 // its eyes (./eye.js): a picture from where it stands only this close to the writer's character, in
                                   // the same space — where the writer's page has the world drawn around it, people included
export const ANIMAL_M = 120;       // animals this close are around it (open land: seen from afar — deer keep 40 m from people)
export const ANIMALS_MAX = 3;      // herds told at most (after the people)
export const SAW_M = 70;           // a herd this close goes in its diary ("Saw 3 deer nearby"): shy animals never come nearer
export const SAW_MS = 10 * 60e3;   // …once per herd in this long (real)
export const SENT_MS = 10 * 60e3;  // the full picture again, all of it, after this long without one (real)
export const HEARD_MS = 4 * 60e3;  // what it heard in the last minutes (real)
export const TICK_MS = 2000;
export const TEXT_MAX = 1600;      // the full picture, in characters at most
export const tokensOf = s => Math.ceil(String(s || '').length / 4);

/** What it set about, as a line of its diary: what it is doing there, or where it set off for (and to do what). */
function actLine(act, now, w = null) {
  const label = clean(act.label, 80), place = act.place ? clean(act.place, 60) : '';
  // (already there — at home for something at home, in the building it is going to —: only what it does)
  const there = w && ((place === 'Home' && w.home) || (Number.isInteger(act.b) && act.b >= 0 && act.b === w.b));
  if (!there && Number.isFinite(act.travelEnd) && act.travelEnd > now && place && place !== 'Out of town') {
    return `Set off ${place === 'Home' ? 'home' : `for «${place}»`} (${label.charAt(0).toLowerCase()}${label.slice(1)})`;
  }
  return `${label}${place && place !== 'Home' && place !== 'Out of town' && !label.includes(place) ? ` at «${place}»` : ''}`;
}

/** A wildlife catalogue's plain names (shared/world-config/species: "Wild horses", "Deer", "Wolves"): species id →
 *  { sp, one ("wild horse"), many ("wild horses") }. */
const SPECIES_WORDS = new WeakMap();
function speciesInfo(W) {
  const list = Array.isArray(W?.species) ? W.species : [];
  let m = SPECIES_WORDS.get(list);
  if (!m) {
    SPECIES_WORDS.set(list, m = new Map());
    for (const sp of list) {
      const many = clean(sp?.name || sp?.id || '', 40).toLowerCase();
      if (!many) continue;
      const one = /ves$/.test(many) ? many.replace(/ves$/, 'f') : /[^s]s$/.test(many) ? many.slice(0, -1) : many;   // (deer, sheep, moose, boar: the same)
      m.set(sp.id, { sp, one, many });
    }
  }
  return m;
}

export class SensesError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

export class Senses {
  /**
   * @param {object} o
   * @param {object} o.dbs                          the world's database
   * @param {() => object} o.sim                    the simulation
   * @param {object} o.agents                       the agent registry (server/agents.js)
   * @param {() => object} o.life                   agents' lives (byAgent: agent id → body; relations)
   * @param {object} [o.players]                    server/world/players.js
   * @param {() => object} [o.vehicles]             server/world/vehicles.js (all, seats)
   * @param {() => object} [o.fleet]                server/world/aircraft.js
   * @param {() => object} [o.harbour]              server/world/boats.js
   * @param {() => object} [o.weather]              server/world/weather.js
   * @param {() => object} [o.companions]           server/companions/companions.js
   * @param {() => object} [o.work]                 server/workplace/presence.js
   * @param {(k: string) => any} o.setting          the installation's settings
   * @param {(id: number) => string|null} [o.accountName]  an account's display name
   * @param {(agent: object) => number|null} [o.ownerOf]   an agent's owner's account id (no owner: the installation's)
   * @param {() => object} [o.wildlife]             server/world/wildlife.js (the herds near someone)
   * @param {() => object} [o.ground]               the island's ground (a GroundQuery or an Island; default: the players')
   */
  constructor({ dbs, sim, agents, life, players = null, vehicles = () => null, fleet = () => null, harbour = () => null, weather = () => null,
    companions = () => null, work = () => null, wildlife = () => null, ground = null, setting = () => undefined, accountName = () => null, ownerOf = a => a?.ownerId ?? null, now = () => Date.now(), log = null }) {
    Object.assign(this, { sim, agents, players, setting, accountName, ownerOf, now, log });
    this.lifeOf = life; this.vehiclesOf = vehicles; this.fleetOf = fleet; this.harbourOf = harbour; this.weatherOf = weather;
    this.companionsOf = companions; this.workOf = work; this.wildlifeOf = wildlife;
    this.groundOf = ground || (() => this.players?.ground || null);
    this.saw = new Map();         // "agent id|herd id" → when it last had that herd near (real ms): its diary's "Saw …"
    this.sent = new Map();        // "agent id:account" → { at, secs: section key → text }: the full picture last sent
    this.w = dbs.worldId; this.db = dbs.db;
    this.q = {
      all: this.db.prepare('SELECT agent_id, mode FROM agent_awareness WHERE world_id = ?'),
      put: this.db.prepare(`INSERT INTO agent_awareness (world_id, agent_id, mode, updated, updated_by) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (world_id, agent_id) DO UPDATE SET mode = excluded.mode, updated = excluded.updated, updated_by = excluded.updated_by`),
      del: this.db.prepare('DELETE FROM agent_awareness WHERE world_id = ? AND agent_id = ?'),
    };
    this.modes = new Map(this.q.all.all(this.w).map(r => [r.agent_id, r.mode]));
    this.diary = new Diary({ now, clock: t => this.clockAt(t) });
    this.activities = new Activities({ log });
    for (const p of BUILT_IN) this.activities.add(p);
    // what is in view besides people and animals: cars (one on its side after a crash), a waterfall, a lake, the river
    this.sights = new Sights({ log });
    this.sights.add(carSights);
    this.sights.add(waterSights(() => this.wildlifeOf?.()));
    this.state = new Map();       // agent id → what tick() saw last (the diary writes the changes)
    this.tracks = new Map();      // a value watched a moment (an aircraft's height: climbing or descending)
    this.tuned = new Map();       // account id → { station, at }: its car radio (the page says)
    this.radioWords = () => null; // station id → "«MVW 98.4» — Sara on the air" (server/radio/, set by the server)
    this.stats = { ticks: 0, tickMs: 0, tickMaxMs: 0, packs: 0, looks: 0, heard: 0 };
    this.timer = null; this.offs = [];
  }

  // ------------------------------------------------------------------------------------------- its owner's choice
  enabled() { return this.setting('awareness.enabled') !== false; }
  defaultMode() { const d = this.setting('awareness.defaultMode'); return MODES.includes(d) ? d : 'together'; }
  /** How much agent `id`'s brain is told: its owner's choice, else the installation's default; off when switched off. */
  modeOf(id) { if (!this.enabled()) return 'off'; return this.modes.get(Number(id)) || this.defaultMode(); }
  /** Its owner's own choice (null: the default). */
  ownMode(id) { return this.modes.get(Number(id)) || null; }
  /** Sets agent id's mode (null: back to the default). */
  setMode(id, mode, actor = null) {
    if (mode !== null && !MODES.includes(mode)) throw new SensesError(400, 'bad_mode', 'Awareness is off, ask, together or always');
    if (mode === null) { this.q.del.run(this.w, Number(id)); this.modes.delete(Number(id)); }
    else { this.q.put.run(this.w, Number(id), mode, this.now(), actor ?? null); this.modes.set(Number(id), mode); }
    return this.modeOf(id);
  }

  // ------------------------------------------------------------------------------------------- the world it reads
  env() {
    let ground = null; try { ground = this.groundOf?.() || null; } catch { ground = null; }
    return { sim: this.sim(), players: this.players, vehicles: this.vehiclesOf?.(), fleet: this.fleetOf?.(), harbour: this.harbourOf?.(),
      work: this.workOf?.(), companions: this.companionsOf?.(), ground, track: (k, v) => this.track(k, v) };
  }
  /** Agent record `agent` → its body's index, or -1. */
  bodyOf(agent) {
    const i = this.lifeOf?.()?.byAgent?.get(Number(agent?.id ?? agent));
    const sim = this.sim();
    return Number.isInteger(i) && sim?.agents[i]?.plan && sim.people[i] && !sim.people[i].retired ? i : -1;
  }
  clockAt(t) { try { const sim = this.sim(); return sim ? formatClock(sim.hour(this.simAt(t))) : ''; } catch { return ''; } }
  /** The world's time at real time t (the diary's lines are written in real time). */
  simAt(t) { const sim = this.sim(); return sim.now() - (this.now() - t) / 1000 * (sim.clock?.rate || 1); }
  /** A value watched for a moment: how it changed per second since it was last read (0 the first time). */
  track(k, v) {
    const t = this.now(), o = this.tracks.get(k);
    this.tracks.set(k, { v: Number(v) || 0, t });
    if (this.tracks.size > 2000) this.tracks.delete(this.tracks.keys().next().value);
    return o && t - o.t > 200 && t - o.t < 60000 ? ((Number(v) || 0) - o.v) / ((t - o.t) / 1000) : 0;
  }
  nameOf(account) { let n = null; try { n = this.accountName?.(account); } catch { n = null; } return clean(n || this.players?.byId?.get(account)?.name || '', 40) || 'your owner'; }

  /**
   * Whether the writer (account) is with agent `agent` now: { yes, how } — its companion (following, waiting beside it,
   * riding in its car) or within NEAR_M in the same space.
   */
  together(agent, account) {
    const i = this.bodyOf(agent), sim = this.sim();
    if (i < 0 || account == null) return { yes: false, how: null };
    const w = whereOf(this.env(), i);
    if (w?.car?.riding && w.car.driverId === account) return { yes: true, how: `riding in your ${w.car.kind === 'bus' ? 'bus' : 'car'}` };
    if (w?.air && !w.air.own && this.fleetOf?.()?.all?.get(w.air.id)?.pilot === account) return { yes: true, how: `flying with you in your ${w.air.craft}` };
    const p = this.players?.byId?.get(account);
    const a = sim.agents[i], o = a?.order;
    // (its companion: going around with them, waiting beside them, on its way to them — not one that stepped away to sleep,
    //  eat or work: then it is wherever it is, and together only if they are really near)
    const led = o && o.kind === 'follow' && o.lead?.kind === 'player' && o.lead.id === account;
    let state = null;
    if (led) { try { state = this.companionsOf?.()?.view?.(a)?.state || null; } catch { state = null; } }
    const with_ = led && state !== 'away';
    if (!p) return { yes: false, how: null };
    const pctx = p.vehicleId || this.fleetOf?.()?.byPilot?.has(account) || this.harbourOf?.()?.bySkipper?.has(account) ? -1 : p.ctx;
    const d = w ? Math.hypot(p.x - w.x, p.z - w.z) : Infinity, same = w && pctx === w.ctx && (w.ctx < 0 || spaceOf(sim.world, p.x, p.z, pctx) === spaceOf(sim.world, w.x, w.z, w.ctx));
    if (same && d <= NEAR_M) return { yes: true, how: with_ ? 'out with you, as your companion' : d < 3 ? 'right beside you' : `near you (${Math.round(d)} m)` };
    // (its companion still on its way: with them in what it does, not yet beside them — said so, or it would think it is)
    if (with_ && state === 'following') return { yes: true, how: 'out with you, as your companion (on your way to each other)', coming: true, d: Number.isFinite(d) ? Math.round(d) : null };
    return { yes: false, how: null };
  }

  /**
   * Where its eyes are for a picture the writer's page can draw (./eye.js): { i (its body), x, z, ctx, d (metres from the
   * writer's character) } — or null when no page of theirs can show what it sees: no body, hidden (a lift, the subway, the
   * ferry, at the wheel of its own car), the writer with no character in the world, or not in the same space within EYES_M
   * of it (outside, or the same floor and the same room or flat). A page draws the world around its own character; far
   * from it, or behind walls it doesn't draw, a picture "from where you stand" would show something else.
   */
  eyesFor(agent, account) {
    const i = this.bodyOf(agent);
    if (i < 0 || account == null) return null;
    const w = whereOf(this.env(), i);
    if (!w || w.transit || w.car?.own || !Number.isFinite(w.x) || !Number.isFinite(w.z)) return null;
    const p = this.players?.byId?.get(account);
    if (!p) return null;
    const pctx = p.vehicleId || this.fleetOf?.()?.byPilot?.has(account) || this.harbourOf?.()?.bySkipper?.has(account) ? -1 : p.ctx;
    const d = Math.hypot(p.x - w.x, p.z - w.z), ctx = Number.isFinite(w.ctx) ? w.ctx : -1;
    if (pctx !== ctx || !(d <= EYES_M)) return null;
    if (ctx >= 0 && spaceOf(this.sim().world, p.x, p.z, pctx) !== spaceOf(this.sim().world, w.x, w.z, ctx)) return null;
    return { i, x: Math.round(w.x * 10) / 10, z: Math.round(w.z * 10) / 10, ctx, d: Math.round(d * 10) / 10 };
  }
  /** Exactly where it is, in a phrase (./where.js), or null (no body). */
  whereWords(agent) { const i = this.bodyOf(agent); return i < 0 ? null : (whereOf(this.env(), i)?.text || '').replace(/, walking( home| to «[^»]*»)?$/, '') || null; }   // (where it is heading is its activity's to say)
  /**
   * The one-liner: "Mon 2:14 PM — in the front passenger seat of Kim's sedan …" (null: no body). With the writer
   * (account) in sight — the same space, within SIGHT_M — where they are: "Kim is about 25 m away, on your left (not with you)."
   */
  line(agent, o = {}) { return this.lineOf(agent, o)?.text ?? null; }
  /** line()'s words and whether the writer is in sight: { text, seen } or null. */
  lineOf(agent, { short = false, answering = false, account = null } = {}) {
    const i = this.bodyOf(agent);
    if (i < 0) return null;
    const sim = this.sim(), w = whereOf(this.env(), i), comp = this.companionWords(agent);
    // (answering a message it is awake: asleep a moment ago, the message woke it — its note says so —, never "sleeping")
    const act = sim.agents[i].act, asleep = answering && (act?.use === 'sleep' || act?.use === 'nap');
    const doing = act?.label && !asleep && !w.car && !/^(Following|Waiting for|Riding)/i.test(act.label) ? clean(act.label, 80) : '';
    const seen = this.sight(w, account);
    const who = seen ? `${this.nameOf(account)} is ${metres(seen.d)}${seen.d >= 1.5 ? `, ${seen.side}` : ''}${seen.d > NEAR_M ? ' (not with you)' : ''}.` : '';
    return { text: `${this.when()} — ${short ? w.short : w.text}${comp ? `; ${comp}` : doing ? `; ${doing.charAt(0).toLowerCase()}${doing.slice(1)}` : ''}.${who ? ` ${who}` : ''}`, seen };
  }
  /** Where player `account` is from a body at w when it can see them (the same space, within SIGHT_M): { d, side } or null. */
  sight(w, account) {
    if (account == null || !w || w.transit || (w.car && w.car.driverId === account)) return null;
    const p = this.players?.byId?.get(account);
    if (!p) return null;
    const pctx = p.vehicleId || this.fleetOf?.()?.byPilot?.has(account) || this.harbourOf?.()?.bySkipper?.has(account) ? -1 : p.ctx;
    if (pctx !== w.ctx) return null;
    const d = Math.hypot(p.x - w.x, p.z - w.z), sim = this.sim();
    if (!(d <= SIGHT_M) || (w.ctx >= 0 && spaceOf(sim.world, p.x, p.z, pctx) !== spaceOf(sim.world, w.x, w.z, w.ctx))) return null;
    return { d, side: sideOf(w.yaw, p.x - w.x, p.z - w.z) };
  }
  when() {
    const sim = this.sim(), c = sim.clockInfo();
    return `${c.weekday} ${formatClock(c.hour)}`;
  }
  /** Its companion state in words (server/companions/), or ''. */
  /** What a player is sitting on, in words ("sitting on a bench", "sitting at a table at «Restaurant 16»"), or '' — the
   *  seat their character is in (server/companions/ leaderSeat → the sim's seatAt). */
  seatWords(account) {
    let seat = null;
    try { seat = this.companionsOf?.()?.leaderSeat?.(account) || null; } catch { seat = null; }
    return seat?.words ? `sitting ${seatPrep(seat)} ${clean(seat.words, 80)}` : '';
  }
  companionWords(agent) {
    try {
      const C = this.companionsOf?.(), i = this.bodyOf(agent), a = i >= 0 ? this.sim().agents[i] : null;
      const v = a?.order && C ? C.view(a) : null;
      if (!v) return '';
      const who = v.leader?.name || '';
      // (sitting with them: on the bench beside them, at their table — what its body really does)
      if (v.seat?.words) return `you are ${who}'s companion, ${v.seat.eating ? 'eating with them' : 'sitting with them'} ${seatPrep(v.seat)} ${clean(v.seat.words, 80)}`;
      // (its owner sitting and it not: standing beside them — its words never sit it down when its body didn't)
      const ls = v.leader?.kind === 'player' ? C.leaderSeat?.(v.leader.id) : null;
      if (ls?.words && !v.using && v.state !== 'riding') return `you are ${who}'s companion, ${a.order?.seat && a.order.seat.mode !== 'use' ? 'on your way to a seat beside them (not sitting yet)' : 'standing beside them (not sitting)'} — ${who} is sitting ${seatPrep(ls)} ${clean(ls.words, 80)}`;
      // (the airport: in their aircraft with them, or flying a ring course yourself — server/play/flight-crew.js)
      if (v.air?.role === 'passenger') return `you are ${who}'s companion, ${v.air.air ? 'flying with them' : 'aboard'} in their ${v.air.craft} (${clean(v.air.seatWords, 40)})`;
      if (v.air?.role === 'pilot') return `you are flying the ${clean(v.air.courseLabel, 40)} ring course yourself in the ${v.air.craft} (${v.air.phase}${v.air.rings ? `, ${v.air.passes} of ${v.air.rings} rings` : ''})${who ? `; ${who}'s companion, back with them when you land` : ''}`;
      if (v.state === 'waiting' && v.kind === 'follow' && /to land/.test(v.doing || '')) return `you are ${who}'s companion, waiting on the ground for them to land`;
      switch (v.state) {
        case 'riding': return `you are ${who}'s companion, riding with them`;
        // (stopped to talk with them face to face — its owner talking with it in person: with them, not stepped away)
        case 'following': return v.talking ? `you are ${who}'s companion, beside them, talking with them` : v.coming ? `you are ${who}'s companion, on your way to them` : `you are ${who}'s companion, going around with them`;
        case 'waiting': return v.kind === 'follow' ? `you are ${who}'s companion, ${v.talking ? 'beside them, talking with them' : 'waiting beside them'}` : `you are waiting at ${v.place ? q(v.place, 60) : 'a spot'}${v.goal ? ` (${clean(v.goal, 60)})` : ''}`;
        case 'meetup': return `you are meeting up with others at ${v.place ? q(v.place, 60) : 'a place'}`;
        case 'away': return `you are ${who ? `${who}'s companion` : 'on an errand'} but stepped away: ${clean(v.doing, 60).toLowerCase()}`;
        default: return v.place ? `you are out at ${q(v.place, 60)} because your owner sent you` : '';
      }
    } catch { return ''; }
  }

  /**
   * The full picture (docs/features/awareness.md §2): where exactly, who is around, what it heard, the car's radio, what
   * is in hand (its own and, together, the writer's), the time and the weather, what happened since `since`, the places
   * near it (`places`, the Mind's list). Returns { text, data } or null (no body).
   * memo (pack(): one conversation's messages): a section the same as the last one sent to this writer is left out and
   * named in a closing line (where, around and the time always go); a new conversation (since null) or SENT_MS without one
   * sends it all again; the places near it go only with a conversation's first picture (else through its look tool).
   */
  look(agent, { account = null, since = null, places = null, together = null, memo = false, only = null } = {}) {
    const i = this.bodyOf(agent);
    if (i < 0) return null;
    this.stats.looks++;
    const env = this.env(), sim = env.sim, w = whereOf(env, i), t = sim.now(), me = sim.people[i];
    const writer = account != null && account > 0 ? this.nameOf(account) : null;
    const tog = together || (account != null ? this.together(agent, account) : { yes: false });
    const S = [];   // [key, its name in the closing line (null: always sent), text]
    // (only: what matters to the message it answers — RELEVANT groups, Free Will's check (server/free-will/moments.js):
    //  those sections, and where it is in short — no street, no speed — unless the place matters; null: all of it)
    const want = g => !only || only.has(g);
    const comp = this.companionWords(agent);
    S.push(['where', null, `Where: ${want('place') ? w.text : w.short}${comp ? ` — ${comp}` : ''}.`]);
    // who is around: people (residents and agents) and players, nearest first, with which way and what they are doing;
    // then the animals
    const around = this.around(env, i, w, account);
    if (want('around')) S.push(['around', null, around.length ? `Around you: ${around.map(x => x.words).join('; ')}.` : 'Around you: nobody close by.']);
    // what else is in view: cars near it (one on its side after a crash), the island's water (a waterfall, a lake, the river)
    const sights = want('around') ? this.sights.of({ env, w, facing: w.yaw, nameOf: id => this.nameOf(id) }) : [];
    if (sights.length) S.push(['sights', 'what is in view', `In view: ${sights.map(x => x.words).join('; ')}.`]);
    // what it heard lately (the diary's lines out loud near it)
    const heard = this.diary.read(agent.id, { since: this.now() - HEARD_MS }).filter(l => l.kind === 'heard' || l.kind === 'said').slice(-5);
    if (heard.length && want('around')) S.push(['heard', 'what you heard', `Heard lately: ${heard.map(l => `${l.text} (${this.ago(l.at)})`).join('; ')}.`]);
    // the car's radio (what its driver's page plays)
    const radio = this.radioIn(env, w);
    if (radio && want('activity')) S.push(['radio', 'the car radio', `Car radio: ${radio}.`]);
    // what is in hand: its own, and the writer's when they are together
    const cards = this.activities.cards({ env, i, account: -Number(agent.id), who: 'you', self: true, now: t });
    if (tog.yes && account != null) cards.push(...this.activities.cards({ env, i: -1, account, who: writer || 'your owner', self: false, now: t }));
    // (what it is eating or drinking, or that it has nothing, goes whatever the message is about: it is never left to guess)
    for (const c of cards) if (want('activity') || c.id === 'meal' || c.id === 'writer-meal') S.push([`card:${c.title}`, c.id === 'work' ? 'your work' : clean(c.title.split(/:| \(/)[0], 60), `${c.title}${c.lines.length ? `: ${c.lines.join('; ')}` : ''}.`]);
    // the time of day and the weather
    if (want('time')) S.push(['time', null, `Time: ${this.when()}, ${this.partOfDay()}${this.weatherWords(w)}.`]);
    // what happened since the writer's last message (else the last few things)
    const since0 = Number.isFinite(since) ? since : null;
    const lines = this.diary.read(agent.id, { since: since0 ?? undefined, limit: 8 }).filter(l => l.kind !== 'heard' && l.kind !== 'said');
    if (lines.length && want('lately')) S.push(['lately', 'what happened lately', `${since0 ? `Since ${writer || 'your owner'}'s last message` : 'Lately'}: ${lines.map(l => `${l.clock} ${l.text}`).join('; ')}.`]);
    if (Array.isArray(places) && places.length && want('place')) S.push(['places', 'places near you', `Places near you (use these exact names): ${places.slice(0, 8).map(p => `${KIND_WORD[p.kind] || p.kind || 'place'} ${q(p.name, 60)} (${p.minutes} min walk${p.price ? `, about ${(p.price / 100).toFixed(p.price % 100 ? 2 : 0)} VC` : p.kind === 'park' ? ', free' : ''})`).join('; ')}.`]);
    const { L, unchanged } = memo && account != null ? this.unrepeated(agent, account, S, since0) : { L: S.map(s => s[2]), unchanged: [] };
    let text = L.join('\n');
    if (text.length > TEXT_MAX) text = `${text.slice(0, TEXT_MAX - 1)}…`;
    return { text, data: { where: w, around: around.map(({ words, ...x }) => x), heard, radio, activities: cards, since: lines, together: tog, name: me.name, unchanged } };
  }
  /**
   * The sections S ([key, name, text]) of a full picture for agent's conversation with `account`, without those the same as
   * last sent to them: { L (the lines to send, the closing line last), unchanged (their names) }. Remembers what it sent.
   */
  unrepeated(agent, account, S, since) {
    const key = `${agent.id}:${account}`, now = this.now(), last = this.sent.get(key);
    const fresh = !last || since == null || now - last.at > SENT_MS;
    // (what it was told and is still so; a section gone since is forgotten: back again, it is new)
    const secs = new Map(), L = [], unchanged = [];
    let morePlaces = false;
    for (const [k, name, text] of S) {
      if (!fresh && name && last.secs.get(k) === text) { unchanged.push(name); secs.set(k, text); continue; }
      // (the places near it: with a conversation's first picture; later only through its look tool)
      if (k === 'places' && !fresh) { morePlaces = true; if (last.secs.has(k)) secs.set(k, last.secs.get(k)); continue; }
      secs.set(k, text); L.push(text);
    }
    if (unchanged.length) L.push(`Unchanged since the last message: ${unchanged.join(', ')}.`);
    if (morePlaces) L.push('The places near you now: look around (tool "look").');
    this.sent.delete(key); this.sent.set(key, { at: now, secs });
    if (this.sent.size > 2000) this.sent.delete(this.sent.keys().next().value);
    return { L, unchanged };
  }
  ago(at) { const s = (this.now() - at) / 1000; return s < 50 ? 'just now' : `${Math.max(1, Math.round(s / 60))} min ago`; }
  partOfDay() {
    const h = this.sim().hour();
    return h < 5 || h >= 21 ? 'night' : h < 9 ? 'morning' : h < 12 ? 'late morning' : h < 14 ? 'midday' : h < 17 ? 'afternoon' : 'evening';
  }
  weatherWords(w) {
    try {
      const x = this.weatherOf?.()?.now?.();
      if (!x) return '';
      const k = String(x.kind || '');
      const words = { clear: 'clear skies', partly: 'partly cloudy', overcast: 'overcast', rain: 'raining', storm: 'stormy', fog: 'foggy' }[k] || k;   // (shared/weather.js WEATHER_KINDS)
      return words ? `; outside: ${words}${w && !w.outside ? ' (you are indoors)' : ''}` : '';
    } catch { return ''; }
  }
  /** People and players around body i (nearest first), then the animals: { name, kind, rel, d, side, doing, words }. */
  around(env, i, w, account) {
    const sim = env.sim, t = sim.now(), out = [], me = sim.people[i];
    const life = this.lifeOf?.(), rec = me?.vip && me.agentId ? this.agents.byKey(me.agentId) : null;
    const known = new Map();
    try { for (const r of life?.relations?.(rec?.id, 60) || []) known.set(r.name, r); } catch { /* no relations */ }
    const ownerId = rec ? this.ownerOf(rec) : null;
    const carMates = w.car?.id != null ? new Set((env.vehicles?.seats?.of(w.car.id) || []).filter(r => r.kind === 'resident').map(r => r.id)) : null;
    const facing = w.yaw, mySpace = spaceOf(sim.world, w.x, w.z, w.ctx);
    for (let j = 0; j < sim.agents.length; j++) {
      if (j === i) continue;
      const o = sim.agents[j], p = sim.people[j];
      if (!o?.plan || !p || p.retired) continue;
      const inCar = carMates?.has(j);
      let x, z, e = null;
      if (inCar) { x = w.x; z = w.z; }
      else {
        e = evalPlan(o.plan, t);
        if ((e.s && (e.s.flags & F_HIDDEN)) || e.ctx !== w.ctx) continue;
        if (Math.abs(e.x - w.x) > AROUND_M || Math.abs(e.z - w.z) > AROUND_M) continue;
        if (w.ctx >= 0 && spaceOf(sim.world, e.x, e.z, e.ctx) !== mySpace) continue;   // (behind a flat's walls)
        x = e.x; z = e.z;
      }
      const d = Math.hypot(x - w.x, z - w.z);
      if (d > AROUND_M) continue;
      const r = known.get(p.name), ag = p.vip && p.agentId ? this.agents.byKey(p.agentId) : null;
      const rel = ag && ownerId != null && this.ownerOf(ag) === ownerId ? 'another of your owner\'s agents' : r ? (r.kind === 'friend' || (r.affinity || 0) > 0.5 ? 'a friend' : 'someone you know') : '';
      // (what they are doing as it looks from here: walking past, or what they are at)
      const walking = !inCar && e.s && !e.s.h;
      // (and what they are eating or drinking, as anyone at the next seat sees it)
      const meal = !inCar && !walking ? mealSeen(o, t) : '';
      const doing = inCar ? 'in the car with you' : walking ? (o.act?.label && Number.isFinite(o.act.travelEnd) && o.act.travelEnd > t ? `walking (next: ${clean(o.act.label, 40).toLowerCase()})` : 'walking') : `${o.act?.label ? clean(o.act.label, 60).toLowerCase() : 'standing'}${meal ? ` — ${meal}` : ''}`;
      out.push({ name: clean(p.name, 40), kind: ag ? 'agent' : 'resident', rel, d, x, z, side: inCar ? 'in the car with you' : sideOf(facing, x - w.x, z - w.z), doing });
    }
    for (const p of this.players?.byId?.values() || []) {
      const flying = env.fleet?.byPilot?.has(p.id), boating = env.harbour?.bySkipper?.has(p.id);
      const pctx = p.vehicleId || flying || boating ? -1 : p.ctx;
      if (pctx !== w.ctx) continue;
      const driving = w.car?.id != null && p.vehicleId === w.car.id;
      const d = driving ? 0 : Math.hypot(p.x - w.x, p.z - w.z);
      if (d > AROUND_M || (!driving && w.ctx >= 0 && spaceOf(sim.world, p.x, p.z, pctx) !== mySpace)) continue;
      const isOwner = ownerId != null ? p.id === ownerId : false, isWriter = account != null && p.id === account;
      const rel = isWriter ? (isOwner ? 'your owner, the one writing to you' : 'the one writing to you') : isOwner ? 'your owner' : 'a player';
      const doing = driving ? `driving the ${w.car.kind === 'bus' ? 'bus' : 'car'} you are in` : flying ? 'flying' : boating ? 'out on a boat' : (p.flags & PF_DRIVING) ? 'driving' : (p.flags & PF_USING) ? this.seatWords(p.id) || 'busy with something' : 'here';
      // (a player's meal at their seat: what is in front of them — server/world/players.js serveMeal)
      const pm = (p.flags & PF_USING) ? this.players?.mealOf?.(p) : null;
      const doing2 = pm?.ids?.length ? `${doing} — having ${foodWords(pm.ids)}` : doing;
      out.push({ name: clean(p.name, 40), kind: 'player', rel, d, x: p.x, z: p.z, side: driving ? 'beside you, at the wheel' : sideOf(facing, p.x - w.x, p.z - w.z), doing: doing2, writer: isWriter });
    }
    out.sort((a, b) => (b.writer ? 1 : 0) - (a.writer ? 1 : 0) || a.d - b.d);
    const people = out.slice(0, AROUND_MAX).map(x => ({ ...x, words: `${x.name}${x.rel ? ` (${x.rel})` : ''} — ${x.doing}, ${x.side === 'in the car with you' || x.side === 'beside you, at the wheel' ? x.side : `${metres(x.d)}${x.d >= 1.5 ? `, ${x.side}` : ''}`}` }));
    // the animals out there with it (the shared wildlife: deer, horses, a bear by the falls), after the people
    const animals = w.outside && !w.transit ? this.herdsNear(w.x, w.z, ANIMAL_M).slice(0, ANIMALS_MAX) : [];
    for (const H of animals) {
      const side = sideOf(facing, H.x - w.x, H.z - w.z);
      people.push({ name: H.what, kind: 'animal', rel: '', d: H.d, x: H.x, z: H.z, side, doing: H.doing, species: H.species, count: H.count, words: `${H.what} — ${H.doing}, ${metres(H.d)}${H.d >= 1.5 ? `, ${side}` : ''}` });
    }
    return people;
  }
  /**
   * The herds of the shared wildlife with an animal within r m of (x, z), nearest first: { id, species, count, what
   * ("3 deer", "a wild horse"), x, z (the herd's middle now), d, doing ("grazing", "resting", "walking away", "running
   * towards you") }. Read from the plans the pages draw them with, on the wildlife's own clock.
   */
  herdsNear(x, z, r = ANIMAL_M) {
    const W = this.wildlifeOf?.();
    if (!W || typeof W.view !== 'function') return [];
    // (no herd comes near the city: the streets cost nothing)
    // (well inside the city — more than 60 m from its edge — no herd is there to see: the streets cost nothing)
    try { const c = W.island?.()?.p?.city; if (c && x > c.x0 + 60 && x < c.x1 - 60 && z > c.z0 + 60 && z < c.z1 - 60) return []; } catch { /* no island */ }
    let v; try { v = W.view(x, z); } catch { return []; }
    const wt = Number(v?.wt) || 0, info = speciesInfo(W), out = [];
    let hour = 12; try { hour = this.sim()?.hour?.() ?? 12; } catch { /* no clock */ }
    for (const H of v?.herds || []) {
      let cx = 0, cz = 0, n = 0, near = Infinity, vx = 0, vz = 0, run = 0, walk = 0;
      for (const m of H.m || []) {
        const [x0, z0, x1, z1, t0, t1, mode] = m, u = t1 > t0 ? Math.min(1, Math.max(0, (wt - t0) / (t1 - t0))) : 1;
        const px = x0 + (x1 - x0) * u, pz = z0 + (z1 - z0) * u;
        cx += px; cz += pz; n++; near = Math.min(near, Math.hypot(px - x, pz - z));
        if (mode && u < 1) { vx += (x1 - x0) / (t1 - t0); vz += (z1 - z0) / (t1 - t0); if (mode === 2) run++; else walk++; }
      }
      if (!n || near > r) continue;
      cx /= n; cz /= n;
      const sp = info.get(H.s), d = Math.hypot(cx - x, cz - z);
      let doing;
      if (run || walk * 2 >= n) {
        const sv = Math.hypot(vx, vz), rad = sv > 1e-6 && d > 1 ? ((cx - x) * vx + (cz - z) * vz) / (d * sv) : 0;
        doing = `${run ? 'running' : 'walking'}${rad > 0.5 ? ' away' : rad < -0.5 ? ' towards you' : ''}`;
      } else doing = !sp?.sp || activeAt(sp.sp, hour) ? 'grazing' : 'resting';
      const one = sp?.one || clean(H.s, 30).replace(/-/g, ' '), many = sp?.many || one;
      out.push({ id: H.id, species: H.s, count: n, what: n === 1 ? `${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}` : `${n} ${many}`, x: cx, z: cz, d, doing });
    }
    return out.sort((a, b) => a.d - b.d);
  }
  /** The radio playing in the car body i rides in (its driver's page said which station), in words, or null. */
  radioIn(env, w) {
    if (!w?.car?.riding || !w.car.driverId) return null;
    const r = this.tuned.get(w.car.driverId);
    if (!r || !r.station) return null;
    try { return this.radioWords(r.station) || null; } catch { return null; }
  }
  /** A player's car radio: the station its page plays now (null: off). */
  tune(account, station) {
    if (station == null || station === '') this.tuned.delete(account);
    else this.tuned.set(account, { station: clean(station, 60), at: this.now() });
  }

  /** What it did lately: the diary and, when given, today's activity from its life. Returns { text, items }. */
  recent(agent, { since = null, today = [] } = {}) {
    const items = this.diary.read(agent.id, { since: Number.isFinite(since) ? since : undefined, limit: 20 });
    const L = [];
    if (today.length) L.push(`Today so far: ${today.map(e => `${e.when ? `${e.when} ` : ''}${clean(e.label, 100)}`).join('; ')}.`);
    if (items.length) L.push(`Lately (what you lived and heard): ${items.map(l => `${l.clock} ${l.text}`).join('; ')}.`);
    if (!L.length) L.push('Nothing in particular has happened lately.');
    return { text: L.join('\n'), items };
  }

  /**
   * What goes with a message to agent `agent` from `account` (its owner or a manager), by its mode: { mode, together,
   * told: 'full'|'line'|'pointer'|'none', text, tokens, tools (it may look and read what happened) }.
   * o: { since (the time of the previous answer), places (the Mind's places near it) }
   */
  pack(agent, account, { since = null, places = null, canLook = true, answering = false, only = null } = {}) {
    this.stats.packs++;
    const mode = this.modeOf(agent.id), i = this.bodyOf(agent);
    if (i < 0) return { mode, together: null, told: 'none', text: '', tokens: 0, tools: false };
    const tog = this.together(agent, account);
    const how = tog.yes ? tog.how : null, writer = this.nameOf(account);
    let told, text;
    // (a brain that can't look around from a chat — another platform's agent without its body's tools — gets the line
    //  where it would only have been told it may look)
    const m = mode === 'ask' && !canLook ? 'line' : mode;
    if (m === 'off') { told = 'none'; text = `It is ${this.when()} in the city. Your owner has switched off your awareness of your surroundings: if you are asked where you are or what is around you, say you can't tell right now.`; }
    else if (m === 'ask') { told = 'pointer'; text = this.pointer(); }
    else if (m === 'always' || (m === 'together' && tog.yes)) {
      told = 'full';
      const L = this.look(agent, { account, since, places, together: tog, memo: true, only });
      // (only what matters to this message: the rest is one look away — and that it is, said once)
      const rest = only && canLook ? '\n(What else you notice — who and what is around, the time, what happened lately — is a look away: tool "look". Only when it matters.)' : '';
      // (what they are doing with their body — sitting on a bench, at a table —: always said, whatever else is)
      const pose = tog.yes && !tog.coming ? this.seatWords(account) : '';
      const head = !tog.yes ? `You and ${writer} are apart right now.` : tog.coming ? `You are ${writer}'s companion, on your way to each other — not beside them yet${tog.d ? ` (${metres(tog.d)})` : ''}.` : `You and ${writer} are together right now: ${how}${pose ? `; ${writer} is ${pose}` : ''}.`;
      text = `${head}\n${L.text}${rest}`;
    } else {
      // (the writer in sight: the line says where they are; else that they are not with it)
      told = 'line';
      const l = this.lineOf(agent, { answering, account }), more = canLook ? 'For more, look around: tool "look"; what happened lately: tool "recent".' : '';
      text = `${l.text}${tog.yes ? '' : l.seen ? (more ? ` ${more}` : '') : ` (${writer} is not with you right now.${more ? ` ${more}` : ''})`}`;
    }
    return { mode, together: how, told, text, tokens: tokensOf(text), tools: mode !== 'off' };
  }
  /** What goes with a message when it looks only when it asks ('ask'): the time, and that it may look. */
  pointer() { return `It is ${this.when()} in the city. You are not told about your surroundings with each message: when a question needs it, look around (tool "look") or read what happened lately (tool "recent") before you answer.`; }
  /** What a picture its owner shared shows (./view.js), for agent `agent` — or null (not a picture of the city now). */
  viewNote(agent, account, view) {
    const v = cleanView(view, this.now());
    if (!v) return null;
    return viewCaption(this.env(), v, { me: this.bodyOf(agent), writer: this.nameOf(account), clock: this.clockAt(v.at), ago: this.ago(v.at) });
  }

  // ------------------------------------------------------------------------------------------- the diary's pen
  /** Writes a line in agent id's diary. */
  note(id, kind, text, o = {}) { return this.diary.add(Number(id), kind, text, o); }
  /** AI agents' bodies now: [{ i, rec }]. */
  aiBodies() {
    const sim = this.sim(), life = this.lifeOf?.(), out = [];
    if (!sim || !life?.byAgent) return out;
    for (const [id, i] of life.byAgent) {
      const p = sim.people[i];
      if (!p || p.retired || !sim.agents[i]?.plan) continue;
      const rec = this.agents.get(id);
      if (rec && rec.enabled !== false) out.push({ i, rec });
    }
    return out;
  }
  /**
   * Writes what changed for each AI agent since the last look: the place it is in, a car it got into or out of, what it
   * set about, being someone's companion, its owner coming over or walking off.
   */
  tick() {
    const t0 = this.now(), sim = this.sim();
    if (!sim) return;
    const env = this.env();
    for (const { i, rec } of this.aiBodies()) {
      let w; try { w = whereOf(env, i); } catch { w = null; }
      if (!w) continue;
      const a = sim.agents[i], act = a.act;
      const owner = this.ownerOf(rec), op = owner != null ? this.players?.byId?.get(owner) : null;
      const opctx = op ? (op.vehicleId || env.fleet?.byPilot?.has(owner) || env.harbour?.bySkipper?.has(owner) ? -1 : op.ctx) : null;
      const od = op && opctx === w.ctx && (w.ctx < 0 || spaceOf(sim.world, op.x, op.z, opctx) === spaceOf(sim.world, w.x, w.z, w.ctx)) ? Math.hypot(op.x - w.x, op.z - w.z) : Infinity;
      const cv = (() => { try { return a.order && env.companions ? env.companions.view(a) : null; } catch { return null; } })();
      const now = {
        place: w.car ? null : w.home ? 'home' : w.ctx >= 0 ? `b${ctxB(w.ctx)}:${w.f}` : 'out',
        placeWords: w.car ? '' : w.placeWords || '',
        car: w.car ? `${w.car.id ?? 'own'}` : null, carWords: w.car ? (w.car.own ? 'your car' : `${w.car.driver ? `${w.car.driver}'s` : 'a'} ${w.car.kind}`) : '',
        seat: w.car && !(w.car.kind === 'bus' && w.car.seat !== 0) ? w.car.seatWords || '' : '', street: w.address || '',
        act: act ? `${act.use}|${act.place}|${act.label}` : '', actWords: act?.label ? actLine(act, sim.now(), w) : '',
        comp: cv ? `${cv.state}:${cv.leader?.name || ''}` : '', compWho: cv?.leader?.name || '', compState: cv?.state || '',
        near: od <= NEAR_M ? 'near' : od <= NEAR_M * 2 ? (this.state.get(rec.id)?.near === 'near' ? 'near' : 'far') : 'far', ownerName: op ? clean(op.name, 40) : '',
      };
      const was = this.state.get(rec.id);
      // (in a lift, the subway or the ferry: still where it was until it is somewhere else)
      if (w.transit && was) { now.place = was.place; now.placeWords = was.placeWords; }
      this.state.set(rec.id, now);
      if (!was) continue;   // (the first look only learns where it is)
      const id = rec.id;
      if (was.car !== now.car) {
        if (was.car && !now.car) this.note(id, 'move', `Got out of ${was.carWords}${now.street ? ` at ${q(now.street, 60)}` : ''}`, { key: 'car' });
        if (now.car) this.note(id, 'move', `Got into ${now.carWords}${now.seat && !now.carWords.startsWith('your') ? ` (${now.seat})` : ''}`, { key: 'car' });
      }
      if (now.place && now.place !== 'out' && was.place !== now.place && now.placeWords && now.placeWords !== was.placeWords) this.note(id, 'move', now.place === 'home' ? 'Came home' : `Went into ${now.placeWords}`, { key: 'place' });
      else if (now.place === 'out' && was.place && was.place !== 'out' && !now.car) this.note(id, 'move', `Went outside${was.place === 'home' ? ' (left home)' : was.placeWords ? ` from ${was.placeWords}` : ''}${now.street ? `, at ${q(now.street, 60)}` : ''}`, { key: 'place' });
      if (was.comp !== now.comp) {
        if (now.compState && (!was.compState || was.compWho !== now.compWho)) this.note(id, 'with', now.compState === 'meetup' ? 'Went to meet up with others' : now.compWho ? `Became ${now.compWho}'s companion` : 'Sent on an errand by your owner', { key: 'comp' });
        else if (!now.compState && was.compState) this.note(id, 'with', `Stopped being ${was.compWho || 'a'} companion: back to your own day`, { key: 'comp' });
        else if (now.compState === 'waiting' && was.compState !== 'waiting') this.note(id, 'with', `Waiting for ${now.compWho || 'your owner'}`, { key: 'comp' });
      }
      if (was.act !== now.act && now.actWords && !now.compState && !/^(Following|Waiting|Riding)/i.test(now.actWords)) this.note(id, 'move', now.actWords, { key: 'act' });
      if (was.near !== now.near && now.ownerName) this.note(id, 'with', now.near === 'near' ? `${now.ownerName} (your owner) came over to you` : `${now.ownerName} (your owner) went off`, { key: 'owner' });
      if (w.outside && !w.transit) this.sawHerds(id, w);
    }
    const ms = this.now() - t0;
    this.stats.ticks++; this.stats.tickMs = Math.round(ms * 10) / 10; this.stats.tickMaxMs = Math.max(this.stats.tickMaxMs, this.stats.tickMs);
  }
  /** Herds that came within SAW_M of agent id's body at w: "Saw 3 deer nearby, on the beach" — once while it has them near,
   *  again only after SAW_MS without. */
  sawHerds(id, w) {
    const herds = this.herdsNear(w.x, w.z, SAW_M);
    if (!herds.length) return;
    const t = this.now();
    for (const H of herds) {
      const k = `${id}|${H.id}`, at = this.saw.get(k);
      this.saw.delete(k); this.saw.set(k, t);
      if (at == null || t - at >= SAW_MS) this.note(id, 'saw', `Saw ${H.what} nearby${w.ground?.words ? `, ${w.ground.words}` : ''}`, { key: `herd:${H.id}` });
    }
    // (bounded: the oldest first, those long gone)
    for (const [k, at] of this.saw) { if (this.saw.size <= 1000 || t - at < SAW_MS) break; this.saw.delete(k); }
  }
  /** A line said out loud by body ev.i (the simulation's 'say'): into the diaries of the AI agents that heard it. */
  heard(ev) {
    const sim = this.sim();
    if (!sim || !ev || !Number.isInteger(ev.i) || !ev.text) return;
    const sp = sim.agents[ev.i], who = sim.people[ev.i];
    if (!sp?.plan || !who) return;
    const s = evalPlan(sp.plan, sim.now());
    if (s.s && (s.s.flags & F_HIDDEN)) return;
    for (const { i, rec } of this.aiBodies()) {
      if (i === ev.i) { this.note(rec.id, 'said', `You said: ${q(ev.text, 160)}`); continue; }
      const m = evalPlan(sim.agents[i].plan, sim.now());
      if (m.ctx !== s.ctx || Math.hypot(m.x - s.x, m.z - s.z) > HEAR_M || (m.ctx >= 0 && spaceOf(sim.world, m.x, m.z, m.ctx) !== spaceOf(sim.world, s.x, s.z, s.ctx))) continue;
      this.note(rec.id, 'heard', `${clean(who.name, 40)}: ${q(ev.text, 160)}`);
      this.stats.heard++;
    }
  }
  /** A player said something in proximity chat: the AI agents near them heard it. */
  heardPlayer(p, text) {
    const sim = this.sim();
    if (!sim || !p || !text) return;
    for (const { i, rec } of this.aiBodies()) {
      const m = evalPlan(sim.agents[i].plan, sim.now());
      if (m.ctx !== p.ctx || Math.hypot(m.x - p.x, m.z - p.z) > HEAR_M || (m.ctx >= 0 && spaceOf(sim.world, m.x, m.z, m.ctx) !== spaceOf(sim.world, p.x, p.z, p.ctx))) continue;
      const own = this.ownerOf(rec) === p.id;
      this.note(rec.id, 'heard', `${clean(p.name, 40)}${own ? ' (your owner)' : ''}: ${q(text, 160)}`);
      this.stats.heard++;
    }
  }
  /** Something happened to a player (a catch landed, a rush done): the AI agents with them saw it. */
  noteNear(account, text, kind = 'activity', o = {}) {
    for (const { rec } of this.aiBodies()) {
      try { if (this.together(rec, account).yes) this.note(rec.id, kind, text, o); } catch { /* not with them */ }
    }
  }
  /** A moment at work (server/workplace/presence.js): in the diaries of the one it is about and its co-workers there. */
  workMoment(e) {
    const sim = this.sim(), W = this.workOf?.();
    const p = sim?.people[e.i];
    if (!p) return;
    const place = e.status?.place || 'work', role = e.pos?.role || 'co-worker', why = clean(e.reason ?? e.status?.reason, 80);
    const mine = e.type === 'arrived' && e.lateBy ? `Got to work at ${q(place, 60)}, ${e.lateBy} minutes late` : e.type === 'arrived' ? `Got to work at ${q(place, 60)}`
      : e.type === 'left' ? `Left work at ${q(place, 60)} during your shift` : e.type === 'back' ? `Back at work at ${q(place, 60)}` : e.type === 'late' ? `Late for work at ${q(place, 60)}` : null;
    const them = e.type === 'late' ? `${clean(p.name, 40)} (the ${role}) is late for work${why ? ` — ${why}` : ''}` : e.type === 'arrived' && e.lateBy ? `${clean(p.name, 40)} (the ${role}) got in ${e.lateBy} minutes late`
      : e.type === 'left' ? `${clean(p.name, 40)} (the ${role}) left during their shift${why ? ` — ${why}` : ''}` : e.type === 'back' ? `${clean(p.name, 40)} (the ${role}) is back at work` : null;
    const byI = new Map(this.aiBodies().map(x => [x.i, x.rec]));
    const me = byI.get(e.i);
    if (me && mine) this.note(me.id, 'work', mine);
    if (!them || !W || !e.pos?.key) return;
    for (const x of W.team(e.pos.key, { exclude: e.i }) || []) {
      const r = byI.get(x.i);
      if (r && x.state === 'on_duty') this.note(r.id, 'work', them);
    }
  }

  // ------------------------------------------------------------------------------------------- running
  attach() {
    const sim = this.sim();
    if (!this.timer) { this.timer = setInterval(() => { try { this.tick(); this.watchSim(); } catch (e) { this.log?.warn?.('[senses] tick failed:', e.message); } }, TICK_MS); this.timer.unref?.(); }
    this.watchSim(sim);
    const W = this.workOf?.();
    if (W?.on) this.offs.push(W.on(e => { try { this.workMoment(e); } catch (err) { this.log?.warn?.('[senses] a work moment:', err.message); } }));
    return this;
  }
  /** Listens to the simulation's lines out loud (a new simulation after a reload too). */
  watchSim(sim = this.sim()) {
    if (!sim?.events || this.earSim === sim) return;
    if (this.earSim && this.earFn) this.earSim.events.delete(this.earFn);
    this.earSim = sim; this.earFn = ev => { if (ev && ev.t === 'say') { try { this.heard(ev); } catch { /* a line missed */ } } };
    sim.events.add(this.earFn);
  }
  stop() {
    clearInterval(this.timer); this.timer = null;
    for (const f of this.offs) { try { f(); } catch { /* gone */ } }
    this.offs = [];
    if (this.earSim && this.earFn) this.earSim.events.delete(this.earFn);
  }
  view() { return { ...this.stats, ...this.diary.stats(), agents: this.state.size, enabled: this.enabled(), defaultMode: this.defaultMode() }; }
}
