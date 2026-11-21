// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions (docs/features/companions.md): an AI agent goes with someone, waits somewhere or meets up with others because
// its owner said so — in Player mode ("follow me", "let's go to the café", "get in") or in sim mode (send it somewhere,
// "you three meet at the park", "go with Max") — or because its own AI chose to (a brain's companion tool). One system for
// both ways of playing: every command becomes one order on the agent's body (server/sim/agents.js order, kinds 'follow'
// and 'hold', or a place to go), which comes before its routine until it is dismissed, done, or can't be carried on.
//
// Who may command: the agent's owner, or an account it is shared with to manage — never anyone else's agents (strangers'
// agents can't be controlled; the product owner, 2026-11-14). A player has at most companions.maxPerPlayer agents
// following it (3). An agent may go with another agent only when the person commanding may command that one too.
//
// The leader's side, watched here once a second (tick):
//   - a player walking: its followers keep their places round it (re-planned when it has moved on);
//   - a player in sim mode (its body parked, "observing"): they wait beside the parked body, and walk on with it again
//     when it plays again;
//   - a player driving: followers close to the car (BOARD_M) get in — each given a seat of its own for the ride
//     (server/world/car-seats.js: every page draws them sitting there, render/car-occupants.js; their bodies hidden in
//     the car for the simulation, carried along) — as long as the car has seats free; when it gets out they get out
//     beside it; those too far catch up on their own;
//   - a player who left the world: they wait where it was; after companions.waitMinutes (real minutes) they go back to
//     their day, and their owner is told. Orders a person gave (a wait, a meet-up, a place) end the same way when that
//     person has been gone that long;
//   - a player sitting down (a bench, a table, the edge of a fountain: their page's PF_USING on a seat the city knows,
//     Brain.seatAt): a follower sits down with them when told ('sit'; 'eat' joins their meal where food is served) — or,
//     an agent whose Free Will doesn't decide for it (decides), by itself once they have sat a few seconds — and gets
//     up when they walk off (server/sim/companion-moves.js: the seat on its follow order, the meal, the bill).
import { evalPlan } from '../sim/plan.js';
import { SEATED } from '../../shared/anims.js';
import { ctxB, ctxF } from '../../shared/constants.js';
import { CTX_OUT } from '../../shared/proto.js';
import { PF_OBSERVING, PF_USING } from '../../shared/playerproto.js';
import { foodName } from '../../shared/food.js';
import { vc } from '../economy/ledger.js';
import { parseCommand, confirmWords, norm } from './intent.js';

export class CompanionError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const TICK_MS = 500;           // (twice a second: a follower reacts to its leader turning, stopping or running off)
const BOARD_M = 20;          // m from its car a follower gets in
const COMING_M = 6;           // m: a follower farther than this from its leader is still on its way to them
const MOVED_NEAR_M = 1.2;     // m a leader moves before its followers close by re-plan
const MOVED_M = 2.2;         // m a leader moves before its followers re-plan
const LONG = 7 * 24 * 60;    // world minutes: "until dismissed" (a week of the world)
const MEETUP_MIN = 120;      // world minutes a meet-up lasts by default
const GO_MIN = 120;          // world minutes it stays at a place it was sent to by default
const AUTO_SIT_MS = 4000;    // real ms its leader has sat before a companion sits down with them by itself
const SIT_SOON_S = 10;       // sim s: a seat it gets to this soon it "sat down" on (its brain's words); later, it is on its way
const JOIN_FAR_M = 30;        // m: a companion farther than this from its leader who travelled (or after a restart) is put beside them
const BOND_M = 15;             // m: two companions this close, out with the same person, spend that time together
const BOND_PAST_MAX = 5;       // …the first time, at most this many of the outings they already shared count too
const TURN_JUDGE_MS = 3500;    // ms: who answers a line said to the group (the decision service), at most this long
const TURN_ANSWER_P = 0.5;    // …each one this likely to be meant answers (the one it is said to most of all always does)
const PENDING_MS = 3 * 3600000;   // real ms: one busy (or off on an errand) when its leader travelled joins them once free, within this
const VENUE_KINDS = Object.freeze({ cafe: 'cafe', restaurant: 'restaurant', shop: 'shop', gym: 'gym', park: 'park', arcade: 'arcade', lounge_bar: 'lounge_bar', club: 'club' });
const KIND_WORDS = Object.freeze({ cafe: ['cafe', 'coffee', 'coffee shop'], restaurant: ['restaurant', 'diner', 'food', 'dinner', 'lunch'], shop: ['shop', 'store', 'shops', 'mall'], gym: ['gym'],
  park: ['park'], arcade: ['arcade'], lounge_bar: ['bar', 'lounge', 'pub'], club: ['club', 'nightclub', 'night club'] });
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const WHY = Object.freeze({
  leader_left: 'you left the world', leader_gone: 'the one it was with is no longer around', nowhere: 'it could not get there',
  not_possible: 'it could not do that right now', done: 'its time there was up', dismissed: 'you dismissed it', no_money: 'it has too little money for that place',
  no_job: 'it has no job', no_home: 'it has no home', nobody: 'there was nobody to go with', needs: 'it was too hungry or too tired to go on',
});
/** Why it could not sit down (Brain.sitWith's why), in words: w = { me, meIs, lead, is } — for its owner (its name; they
 *  are "you") or for its own brain (it is "you"; they by name). */
const SEAT_WHY = Object.freeze({
  no_player: w => `${w.lead} ${w.is} not in the world`, not_following: w => `${w.lead} ${w.is} not around`, leader_gone: w => `${w.lead} ${w.is} not around`,
  riding: w => `${w.me} ${w.meIs} in a car`, not_seated: w => `${w.lead} ${w.is} not sitting at a table`, not_food: w => `${w.lead} ${w.is} not at a place that serves food`,
  no_seat: w => `there is no seat near ${w.lead}`, full: w => `every seat near ${w.lead} is taken`, taken: () => 'the seat was taken just then',
});
const listWords = l => (l.length < 2 ? l.join('') : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`);

/** How often (ms) orders left on bodies that are nobody's companions any more are let go (Companions.sweep). */
const SWEEP_MS = 30000;

export class Companions {
  /**
   * @param {object} o
   * @param {() => object} o.sim            the running Sim
   * @param {object} o.players              server/world/players.js Players
   * @param {() => object|null} o.vehicles  server/world/vehicles.js Vehicles
   * @param {object} o.agents               server/agents.js Agents
   * @param {() => object|null} o.life      server/agent-life/life.js (agent id → body index)
   * @param {() => object|null} o.world     server/agent-world.js AgentWorld (places by name)
   * @param {() => object|null} o.freeWill  server/free-will/ (the agent's decision service)
   * @param {(path) => any} o.setting
   * @param {(accountId, message) => void} o.notify   a notification for an account (and its pages)
   * @param {(accountId, frame) => void} o.send       a frame to an account's pages
   * @param {(accountId) => object|null} o.principalFor  the principal an account acts as (its pages' list)
   */
  constructor({ sim, players, vehicles = () => null, agents, life = () => null, world = () => null, freeWill = () => null, setting = () => undefined, notify = () => {}, send = () => {}, principalFor = () => null, log = null, now = () => Date.now() }) {
    Object.assign(this, { simOf: sim, players, vehiclesOf: vehicles, agents, lifeOf: life, worldOf: world, fwOf: freeWill, setting, notify, send, principalFor, log, now });
    this.last = new Map();       // account id → { x, z, ctx, at } where its player was last seen (it may leave)
    this.gone = new Map();       // account id → ms it was first seen gone
    this.sent = new Map();       // account id → the last list sent to its pages (JSON)
    this.ended = new Map();      // body index → the orderEnded already reported
    this.groupCache = null;
    this.timer = null;
    this.talked = new Map();     // `${i}|${j}` → ms its pair was last offered a word together (meet-ups, groups)
    this.remarked = new Map();   // body index → ms of its last remark
    this.arrived = new Set();    // `${i}:${order.at}`: a meet-up's arrival already remarked on
    this.mindOf = () => null;    // the Mind (set by the server): companions' words out loud
    this.outings = null;         // an outing's dividers in the person's chat (./outings.js; set by the server)
    this.flight = null;          // the airport's crew: in its owner's aircraft, flying a course (server/play/flight-crew.js; set by the server)
    // whether Free Will decides for an agent (its record): then its body waits to be told to sit down (Free Will may send
    // 'sit' or 'eat'); false — the default — it sits down with its leader by itself (autoSeat). Set by the server.
    this.decides = rec => Companions.decides(rec);
    this.sitting = new Map();    // leader ('p<account>' | 'r<body>') → { key (their seat), since (ms), token } while they sit
    this.autoTried = new Map();  // body index → the token of the sitting it sat down for (or tried to, or was told to stand)
    this.stats = { commands: 0, reflex: 0, understood: 0, boarded: 0, alighted: 0, replans: 0, ended: 0, sat: 0, stood: 0, joined: 0 };
    // what a companion may be busy at beside its leader besides a boat (a play module: Order Up's Rush alongside its owner's,
    // server/play/kitchen-play.js — later ones add theirs), each { watch(a, o, L) → true while it takes care of that body,
    // busyWith(a) → { kind, label } | null (its view: Free Will's moments don't pull it away for a glance), command(P, rec,
    // action, via, ctxOf) → the reflex's result for an action of its own, or null }. Set by the server.
    this.busy = [];
    this.errands = new Map();   // body index → { account (who it comes back to), kind, at (ms), name }: off on a quick errand, back after
    // body index → { account, at (ms) }: its leader travelled while it was busy beside them or off on an errand — it joins
    // them wherever they are once it is free (joinPending)
    this.pendingJoin = new Map();
    this.bonded = new Map();      // `${agent}|${agent}` → the outing (its two orders) they last spent together: bondTogether
    this.outingsTogether = () => 0;   // (account, agent, agent) → outings those two had together with that person before (set by the server)
    this.groupsOf = () => null;   // the group conversations' shared lines (../chat/groups.js; set by the server): who answers a line said to them all
  }
  /** The default for every Companions: nobody's Free Will decides (each instance's decides may be set instead). */
  static decides() { return false; }
  get sim() { return this.simOf(); }
  config() {
    const n = (k, d, lo, hi) => { const v = Number(this.setting(k)); return Number.isFinite(v) && v >= lo && v <= hi ? v : d; };
    return { enabled: this.setting('companions.enabled') !== false, maxPerPlayer: n('companions.maxPerPlayer', 3, 1, 6), waitMinutes: n('companions.waitMinutes', 10, 1, 120),
      understand: this.setting('companions.understand') !== false, agentInvites: this.setting('companions.agentInvites') !== false };
  }

  /** Starts watching leaders, and gives the simulation its view of them (sim.leads). */
  attach() {
    this.hookSim();
    this.timer = setInterval(() => { try { this.tick(); } catch (e) { this.log?.warn?.('[companions] tick failed:', e.stack || e.message); } }, TICK_MS);
    this.timer.unref?.();
    return this;
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  hookSim() {
    const sim = this.sim;
    if (!sim || sim.leads?.owner === this) return;
    const nav = () => this.players.nav;
    sim.leads = {
      owner: this,
      player: (id, a) => this.playerLead(id, a),
      // a straight walk from (x0, z0) to (x1, z1) on one floor (or outdoors) that nothing blocks: the players' own rules
      clear: (x0, z0, x1, z1, ctx) => {
        const N = nav(); if (!N) return false;
        const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / 0.75));
        for (let k = 1; k <= n; k++) { const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n; if (!N.ok(x, z, ctx) || (ctx < 0 && N.wet(x, z))) return false; }
        return ctx < 0 || !N.wallCrossed(ctx, x0, z0, x1, z1);
      },
      open: (x, z, ctx) => { const N = nav(); return !N || (N.ok(x, z, ctx) && !(ctx < 0 && N.wet(x, z))); },
      // the water at outdoor (x, z) — the sea, a lake, a river — where nobody stands (a swimmer's, a boat's)
      wet: (x, z) => { const N = nav(); return !!N?.wet?.(x, z); },
      group: g => this.groupMembers(g),
      seat: id => this.leaderSeat(id),
    };
  }
  /** Where account's player is sitting (Brain.seatAt: a bench, a table, an armchair…), or null — not sitting, or not on a
   *  seat the city knows (a page's PF_USING; the senses: "Kim — sitting on a bench"). */
  leaderSeat(account) {
    const p = this.players.byId.get(account), sim = this.sim;
    if (!p || !sim || !(p.flags & PF_USING) || (p.flags & PF_OBSERVING) || p.vehicleId) return null;
    try { return sim.brain.seatAt(p.x, p.z, p.ctx); } catch { return null; }
  }

  // ------------------------------------------------------------------------------------------------ who and where
  /** The agent record for an id, with its body (index i) — or a CompanionError. */
  bodyOf(agentId) {
    const a = this.agents.get(agentId);
    if (!a || !a.enabled) throw new CompanionError(404, 'not_found', 'No such agent');
    const i = this.lifeOf()?.byAgent?.get(a.id), sim = this.sim;
    if (i === undefined || !sim?.agents[i]?.plan || !sim.people[i] || sim.people[i].retired) throw new CompanionError(409, 'no_body', `${a.name} has no body in the city right now`);
    return { a, i };
  }
  /** Whether P may command agent a: its owner, or an account it is shared with to manage. */
  mayCommand(P, a) { return !!(P?.account && a && (this.agents.isOwner(P, a) || this.agents.canManage(P, a))); }
  need(P, agentId) {
    const a = this.agents.get(agentId);
    if (!a || !this.mayCommand(P, a)) throw new CompanionError(404, 'not_found', 'No such agent');   // (someone else's: as if it weren't there)
    return this.bodyOf(a.id);
  }
  /** Where an account's player is: the live player, or where it was last seen (gone: true). */
  playerLead(id, a = null) {
    const p = this.players.byId.get(id);
    const name = p?.name || this.last.get(id)?.name || 'you';
    if (!p) {
      const l = this.last.get(id);
      return l ? { x: l.x, y: 0, z: l.z, ctx: l.ctx, yaw: l.yaw || 0, moving: false, name, gone: true } : null;
    }
    // (flying an aircraft without this follower aboard: where it waits for them to land — server/play/flight-crew.js)
    if (p.aircraftId && a && this.flight?.leadFor) { const w = this.flight.leadFor(p, a); if (w) return w; }
    let car = null;
    if (p.vehicleId) { const c = this.vehiclesOf()?.all?.get(p.vehicleId); if (c) car = { id: c.id, x: c.x, z: c.z, yaw: c.yaw || 0 }; }
    const l = this.last.get(id), vx = l?.vx || 0, vz = l?.vz || 0, moving = Math.hypot(vx, vz) > 0.3 || (!!l && Math.hypot(p.x - l.x, p.z - l.z) > 0.15);
    void a;
    return { x: car ? car.x : p.x, y: p.y, z: car ? car.z : p.z, ctx: car ? CTX_OUT : p.ctx, yaw: car ? car.yaw : p.yaw || 0, moving, vx: car ? 0 : vx, vz: car ? 0 : vz, name, waiting: !!(p.flags & PF_OBSERVING), car, seated: !car && !!(p.flags & PF_USING) };
  }
  /** Bodies in meet-up g (their indexes), kept for one tick. */
  groupMembers(g) {
    if (!this.groupCache) {
      this.groupCache = new Map();
      for (const a of this.sim?.agents || []) { const o = a?.order; if (o?.group) { const l = this.groupCache.get(o.group) || []; l.push(a.i); this.groupCache.set(o.group, l); } }
    }
    return this.groupCache.get(g) || [];
  }
  /** The live companion orders: [{ a (sim agent), o (its order) }]. */
  live() {
    const sim = this.sim, out = [], now = sim?.now() ?? 0;
    // (a retired body — its agent removed — is nobody's companion, whatever order it was left with)
    for (const a of sim?.agents || []) { if (a?.order && (a.order.lead || a.order.spot || a.order.by || a.order.via) && a.p.vip && !a.p.retired) { const o = sim.brain.liveOrder(a, now); if (o) out.push({ a, o }); } }
    return out;
  }
  /** The agents following account id's player. */
  followersOf(id) { return this.live().filter(x => x.o.kind === 'follow' && x.o.lead?.kind === 'player' && x.o.lead.id === id); }
  agentRecOf(i) { const p = this.sim?.people[i]; return p?.vip && p.agentId ? this.agents.byKey(p.agentId) : null; }

  // ------------------------------------------------------------------------------------------------ commands
  /**
   * One command from a person (the routes, a chat, the decision service) — b: { agent | agents, action, target, place,
   * spot: { x, z, ctx } | { b, f }, minutes, goal } — action: follow (target: 'me', an agent's id, or a name), stay
   * (here, a place or a spot), go (a place or a spot), meetup (agents, a place or a spot), ride, dismiss; sit (with its
   * leader), eat (its leader's meal), stand (up from its seat).
   * → { ok, companions: [...], text } or a CompanionError; sit, eat, stand: { ok, action, text, brain, reason (not ok),
   * companion } — not ok is no error (its `brain` says it could not).
   */
  command(P, b, via = 'ui') {
    const cfg = this.config();
    if (!cfg.enabled) throw new CompanionError(409, 'off', 'Companions are switched off in this world');
    if (!P?.account) throw new CompanionError(401, 'sign_in', 'Sign in to give your agents orders');
    this.hookSim();
    this.groupCache = null;
    const action = String(b?.action || '');
    this.stats.commands++;
    if (action === 'meetup') return this.meetup(P, b, via);
    const { a, i } = this.need(P, Number(b?.agent));
    switch (action) {
      case 'follow': return this.follow(P, a, i, b, via);
      case 'come': return this.follow(P, a, i, { ...b, target: 'me' }, via);
      case 'stay': return this.stay(P, a, i, b, via);
      case 'go': return this.go(P, a, i, b, via);
      case 'ride': return this.ride(P, a, i);
      case 'dismiss': return this.dismiss(P, a, i, via);
      case 'sit': case 'eat': return this.sit(P, a, i, action, via, Array.isArray(b.items) ? b.items : b.item ? [b.item] : null);
      case 'stand': return this.stand(P, a, i, via);
      default: throw new CompanionError(400, 'bad_action', 'action is follow, come, stay, go, meetup, ride, sit, eat, stand or dismiss');
    }
  }
  byWho(P, via) { return { by: P.account.id, byName: clean(P.account.displayName || P.account.login, 40), via }; }
  done(i, text, extra = {}) {
    this.groupCache = null;
    setImmediate(() => { this.lookOutings(); this.push(); });
    return { ok: true, text, companion: this.view(this.sim.agents[i]), ...extra };
  }
  refuse(r, name) {
    const why = WHY[r.why] || 'it could not do that right now';
    throw new CompanionError(409, r.why || 'not_possible', `${name} can't: ${why}`);
  }
  /** Out of a car first (sent anywhere else). */
  outOfCar(a) { if (a.ride) { const sim = this.sim, e = evalPlan(a.plan, sim.now()); sim.brain.alight(a, e.x, e.z); this.stats.alighted++; this.syncSeats(); } }
  /** The cars' seats (server/world/car-seats.js): who rides where, as every page draws them. */
  get seats() { return this.vehiclesOf()?.seats || null; }
  /** Seats free for passengers in car vid (its kind's seats, less the driver's and those taken). */
  freeSeats(vid) { return this.seats?.free(vid) ?? 0; }
  /** Gets in car vid with its player: a seat first (the lowest free one, kept for the ride), then its body into the car. */
  getIn(a, vid) {
    const S = this.seats;
    if (!S || !S.seat(vid, { kind: 'resident', id: a.i })) return false;
    this.sim.brain.board(a, vid); this.stats.boarded++;
    if (!a.ride) S.unseat({ kind: 'resident', id: a.i });   // (no plan to ride with: not in it after all)
    return !!a.ride;
  }
  /** The seats made to match who is riding now (a.ride), however they got in or out — a command, the leader parking, an
   *  order ending, a plan that couldn't go on; one that can't keep a seat (its car gone) gets out where it is. */
  syncSeats() {
    const S = this.seats, sim = this.sim;
    if (!S || !sim) return;
    const want = [];
    for (const a of sim.agents) if (a?.ride && !a.ride.boat && !a.ride.aircraft) want.push({ kind: 'resident', id: a.i, car: a.ride.vid });   // (aboard a boat or an aircraft: no car seat — server/play/fishing-crew.js, flight-crew.js)
    for (const w of S.sync(want)) { const a = sim.agents[w.id], e = evalPlan(a.plan, sim.now()); sim.brain.alight(a, e.x, e.z); this.stats.alighted++; }
  }

  follow(P, a, i, b, via) {
    const sim = this.sim, me = P.account.id, t = b.target ?? 'me';
    const A = sim.agents[i];
    if (t === 'me' || t === me || t === String(me)) {
      if (!this.players.byId.has(me) && !this.last.has(me)) throw new CompanionError(409, 'no_player', 'You have no character in the world yet: play first (Play mode), then ask again');
      const now = this.followersOf(me).filter(x => x.a.i !== i);
      if (now.length >= this.config().maxPerPlayer) throw new CompanionError(409, 'full', `You already have ${now.length} companions with you: dismiss one first`);
      const already = A.order?.kind === 'follow' && A.order.lead?.kind === 'player' && A.order.lead.id === me && this.sim.brain.liveOrder(A, this.sim.now());
      if (already && !b.place) return this.done(i, `${a.name} is already with you`);
      if (A.ride && !already) this.outOfCar(A);
      const slot = already ? A.order.slot : this.freeSlot(now.map(x => x.o.slot));
      const goal = b.place ? `Going to ${clean(b.place, 60)} with ${clean(P.account.displayName || 'you', 40)}` : null;
      const r = sim.order(i, { kind: 'follow', lead: { kind: 'player', id: me }, slot, goal, minutes: LONG, maxMinutes: LONG, ...this.byWho(P, via) });
      if (!r.ok) this.refuse(r, a.name);
      // (a word about it, out loud, when it isn't answering in its chat anyway: a button, the map, a decision)
      if (via !== 'chat' && via !== 'brain' && !b.quiet) this.remark(i, `${clean(P.account.displayName || 'My owner', 40)} just asked me to come along with them${b.place ? ` to ${clean(b.place, 60)}` : ''}, and I'm on my way to them.`);
      return this.done(i, confirmWords({ action: 'follow', target: 'me' }, a.name, { place: b.place }));
    }
    // another agent (one this person may command too): its group — if it follows someone, that one leads
    const other = this.findAgent(P, t, i);
    if (!other) throw new CompanionError(404, 'no_such_agent', `${a.name} can only go with one of your own agents (no "${clean(t, 40)}" among them)`);
    const B = sim.agents[other.i];
    let lead = { kind: 'person', i: other.i }, leader = other.a.name;
    if (B.order?.kind === 'follow' && B.order.lead) {
      if (B.order.lead.kind === 'player') {
        if (B.order.lead.id !== me) throw new CompanionError(409, 'not_yours', `${other.a.name} is with someone else`);
        const now = this.followersOf(me).filter(x => x.a.i !== i);
        if (now.length >= this.config().maxPerPlayer) throw new CompanionError(409, 'full', `You already have ${now.length} companions with you: dismiss one first`);
        return this.follow(P, a, i, { ...b, target: 'me' }, via);
      }
      if (B.order.lead.i !== i) { lead = { ...B.order.lead }; leader = sim.people[lead.i]?.name || leader; }
    }
    if (lead.i === i) throw new CompanionError(400, 'self', `${a.name} can't follow itself`);
    const slot = this.freeSlot(this.live().filter(x => x.o.kind === 'follow' && x.o.lead?.kind === 'person' && x.o.lead.i === lead.i && x.a.i !== i).map(x => x.o.slot));
    this.outOfCar(A);
    const r = sim.order(i, { kind: 'follow', lead, slot, minutes: LONG, maxMinutes: LONG, ...this.byWho(P, via) });
    if (!r.ok) this.refuse(r, a.name);
    return this.done(i, confirmWords({ action: 'follow', target: leader }, a.name, { leader }));
  }
  freeSlot(taken) { const s = new Set(taken.filter(Number.isInteger)); let k = 0; while (s.has(k)) k++; return k; }
  /** One of P's own (or managed) agents by id or name, other than body `not`: { a, i } or null. */
  findAgent(P, t, not = -1) {
    const want = typeof t === 'number' ? null : norm(t);
    for (const a of this.agents.enabled()) {
      if (!this.mayCommand(P, a)) continue;
      if (typeof t === 'number' ? a.id !== t : !(norm(a.name) === want || norm(a.name).split(' ')[0] === want)) continue;
      try { const r = this.bodyOf(a.id); if (r.i !== not) return r; } catch { /* no body: not there */ }
    }
    return null;
  }

  /** Where a command means: b.spot ({ x, z, ctx } or { b, f }), a place's name, "here" (where it stands) → { spot } or
   *  { venue, kind, name } or { home } / { work } — or a CompanionError. */
  where(P, i, b) {
    const sim = this.sim;
    if (b.spot && typeof b.spot === 'object') {
      const s = b.spot;
      if (Number.isInteger(s.b) && Number.isInteger(s.f)) {
        const B = sim.world.buildings[s.b];
        if (!B || B.gone || s.f < 0 || s.f >= B.floors) throw new CompanionError(404, 'nowhere', 'No such place');
        const ctx = s.b * 64 + s.f, at = sim.brain.standAt(ctx, B.x, B.z);
        if (!at) throw new CompanionError(409, 'nowhere', 'Nobody can stand there');
        return { spot: { x: at.x, z: at.z, ctx, place: sim.brain.placeName(s.b, s.f) } };
      }
      const x = Number(s.x), z = Number(s.z), ctx = Number.isInteger(s.ctx) ? s.ctx : CTX_OUT;
      if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 1e5 || Math.abs(z) > 1e5) throw new CompanionError(400, 'bad_spot', 'That is not a place in the world');
      const at = sim.brain.standAt(ctx, x, z);
      if (!at) throw new CompanionError(409, 'nowhere', 'Nobody can stand there');
      return { spot: { x: at.x, z: at.z, ctx, place: ctx >= 0 ? sim.brain.placeName(ctxB(ctx), ctxF(ctx)) : sim.nav.addressAt(at.x, at.z) } };
    }
    const name = clean(b.place, 80), n = norm(name);
    if (!n || n === 'here' || n === 'there') {
      const e = evalPlan(sim.agents[i].plan, sim.now());
      return { spot: { x: e.x, z: e.z, ctx: e.ctx < -1 ? CTX_OUT : e.ctx, place: e.ctx >= 0 ? sim.brain.placeName(ctxB(e.ctx), ctxF(e.ctx)) : sim.nav.addressAt(e.x, e.z) } };
    }
    if (n === 'home' || n === 'my home' || n === 'your home') return { home: true };
    if (n === 'work' || n === 'the office' || n === 'office') return { work: true };
    // where its leader player is: "meet me at my place" is not a place; the player's own position is "here" for them
    const W = this.worldOf();
    if (W) {
      const f = W.findPlace(sim, i, name);
      if (f.place) return { venue: f.place.venue, kind: f.place.kind, name: f.place.name };
      // a kind of place ("the park", "a café", "the bar"): the nearest one
      for (const [k, list] of Object.entries(KIND_WORDS)) if (list.includes(n)) { const near = W.places(sim, i, k, 1)[0]; if (near) return { venue: near.venue, kind: near.kind, name: near.name }; }
      if (f.candidates) throw new CompanionError(409, 'which_place', `Which one? ${f.candidates.slice(0, 5).join('; ')}`);
    }
    // a building by its name (an office tower, an apartment block): its ground floor
    let best = null;
    for (const B of sim.world.buildings) { if (!B || B.gone || !B.name) continue; const bn = norm(B.name); if (bn === n || (n.length >= 4 && bn.includes(n))) { best = B; if (bn === n) break; } }
    if (best) { const at = sim.brain.standAt(best.idx * 64, best.x, best.z); if (at) return { spot: { x: at.x, z: at.z, ctx: best.idx * 64, place: best.name } }; }
    throw new CompanionError(404, 'no_place', `There is no place called "${name}" (try its name as the map shows it)`);
  }
  stay(P, a, i, b, via) {
    const sim = this.sim, w = this.where(P, i, b);
    if (!w.spot) return this.go(P, a, i, b, via);
    this.outOfCar(sim.agents[i]);
    const r = sim.order(i, { kind: 'hold', spot: w.spot, minutes: Number(b.minutes) > 0 ? Number(b.minutes) : LONG, maxMinutes: LONG, goal: b.goal ? clean(b.goal, 80) : null, ...this.byWho(P, via) });
    if (!r.ok) this.refuse(r, a.name);
    if (via === 'ui') this.remark(i, `${clean(P.account.displayName || 'My owner', 40)} asked me to wait ${b.place && norm(b.place) !== 'here' ? `at ${w.spot.place}` : 'right here'} for them.`);
    return this.done(i, confirmWords({ action: 'stay' }, a.name, { place: b.place && norm(b.place) !== 'here' ? w.spot.place : 'here' }));
  }
  go(P, a, i, b, via) {
    const sim = this.sim, w = this.where(P, i, b);
    this.outOfCar(sim.agents[i]);
    const minutes = Number(b.minutes) > 0 ? Number(b.minutes) : GO_MIN, who = this.byWho(P, via);
    let r, name;
    if (w.spot) { r = sim.order(i, { kind: 'hold', spot: w.spot, minutes, maxMinutes: LONG, goal: `At ${w.spot.place}`, ...who }); name = w.spot.place; }
    else if (w.home) { r = sim.order(i, { kind: 'home', minutes, maxMinutes: LONG, ...who }); name = 'home'; }
    else if (w.work) { r = sim.order(i, { kind: 'work', minutes, maxMinutes: LONG, ...who }); name = 'work'; }
    else { r = sim.order(i, { kind: VENUE_KINDS[w.kind] || w.kind, venue: w.venue, minutes, maxMinutes: LONG, ...who }); name = w.name; }
    if (!r.ok) this.refuse(r, a.name);
    if (via === 'ui') this.remark(i, `${clean(P.account.displayName || 'My owner', 40)} asked me to head over to ${name}; I'm on my way.`);
    return this.done(i, confirmWords({ action: 'go', place: name }, a.name, { place: name }));
  }
  /**
   * A quick errand while out with its owner (2026-11-17: hungry, told "go grab something to eat — I'll wait here", it had
   * no way to): off to a place near — a meal at a café or a restaurant, a coffee, the shop — by the Brain's own order (its
   * visit, its bill from its own money, its hunger met), and when that is over it comes back to them (tick: errandsDone).
   * go: { kind (the order's: 'meal', 'cafe', 'shop' …), venue, name, minutes }. → { ok, action, text, brain } (honest).
   */
  errand(P, rec, i, go, via = 'agent') {
    const sim = this.sim, A = sim.agents[i], owner = clean(P?.account?.displayName || P?.account?.login || 'your owner', 40);
    if (!A?.plan || !P?.account) return { ok: false, action: 'errand', text: `${rec.name} can't go now`, brain: 'you could not go: nobody to come back to' };
    this.outOfCar(A);
    // (back with them after, as it was with them before: their companion because they asked, not by its own choice)
    const was = A.order?.kind === 'follow' && A.order.lead?.kind === 'player' && A.order.lead.id === P.account.id ? A.order.via || 'ui' : 'agent';
    const r = sim.order(i, { kind: go.kind, venue: go.venue || null, minutes: go.minutes || 40, maxMinutes: 120, ...this.byWho(P, via) });
    if (!r.ok) return { ok: false, action: 'errand', text: `${rec.name} can't go to ${go.name || 'it'} now`, brain: `you could not go: ${r.why === 'no_money' ? 'it costs money and you have too little' : 'not possible just now (full or closed)'} — say so` };
    this.errands.set(i, { account: P.account.id, kind: go.kind, at: this.now(), name: go.name || '', via: was });
    this.remark(i, `${owner} said I could go — I'm off to ${go.name || 'get something'} and I'll come right back.`);
    return { ok: true, action: 'errand', text: `${rec.name} is off to ${go.name ? `«${go.name}»` : 'get something'} — back with you after`, brain: `you are on your way to ${go.name ? `«${go.name}»` : 'a place near'}${go.kind === 'meal' ? ' for a meal' : ''} (from your own money); when you are done you go back to ${owner} by yourself` };
  }
  /** Errands over (its visit done, or ended): back to the one it went from — following them again, wherever they are now. */
  errandsDone() {
    const sim = this.sim;
    for (const [i, e] of [...this.errands]) {
      const A = sim.agents[i], o = A?.order;
      if (o && o.kind === e.kind) continue;   // (still at it)
      this.errands.delete(i);
      const rec = this.agentRecOf(i), P = this.principalFor?.(e.account);
      if (!rec || !P || o?.kind === 'follow' || !this.players.byId.has(e.account)) continue;   // (told otherwise meanwhile, or they left)
      try { this.follow(P, rec, i, { target: 'me', quiet: true }, e.via || 'agent'); this.remark(i, `Done at ${e.name || 'the place'} — heading back to ${clean(P.account.displayName || P.account.login || 'them', 40)}.`); } catch (err) { this.log?.warn?.('[companions] back from an errand:', err.message); }
    }
  }
  meetup(P, b, via) {
    const sim = this.sim, ids = Array.isArray(b?.agents) ? [...new Set(b.agents.map(Number))].slice(0, 12) : [];
    if (ids.length < 1) throw new CompanionError(400, 'no_agents', 'Choose who meets up');
    const bodies = ids.map(id => this.need(P, id));
    // the place: a spot, a named place (a venue's floor: its middle), or where the first of them is
    let w = this.where(P, bodies[0].i, b);
    if (w.venue) {
      const v = w.venue, at = sim.brain.standAt(v.b * 64 + v.f, v.x, v.z);
      w = { spot: { x: at?.x ?? v.x, z: at?.z ?? v.z, ctx: v.b * 64 + v.f, place: w.name } };
    } else if (!w.spot) throw new CompanionError(400, 'bad_place', 'Choose a place to meet (a café, a park, a spot on the map)');
    const group = `m${this.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const minutes = Number(b.minutes) > 0 ? Number(b.minutes) : MEETUP_MIN, who = this.byWho(P, via), out = [];
    bodies.forEach(({ a, i }, k) => {
      this.outOfCar(sim.agents[i]);
      const r = sim.order(i, { kind: 'hold', spot: w.spot, slot: k, group, minutes, maxMinutes: LONG, goal: null, ...who });
      out.push({ agent: a.id, name: a.name, ok: r.ok, ...(r.ok ? {} : { why: WHY[r.why] || r.why }) });
    });
    this.groupCache = null;
    setImmediate(() => this.push());
    const went = out.filter(x => x.ok).map(x => x.name);
    if (!went.length) throw new CompanionError(409, 'not_possible', `Nobody could go: ${out.map(x => `${x.name} (${x.why})`).join(', ')}`);
    return { ok: true, group, place: w.spot.place, members: out, text: `${went.join(', ')} ${went.length > 1 ? 'are' : 'is'} meeting up at ${w.spot.place}` };
  }
  ride(P, a, i) {
    const p = this.players.byId.get(P.account.id), A = this.sim.agents[i];
    if (!p?.vehicleId) throw new CompanionError(409, 'not_driving', 'You are not in a car');
    if (!(A.order?.kind === 'follow' && A.order.lead?.kind === 'player' && A.order.lead.id === P.account.id)) this.follow(P, a, i, { target: 'me' }, 'ui');
    const L = this.playerLead(P.account.id), e = evalPlan(A.plan, this.sim.now());
    if (A.ride) return this.done(i, `${a.name} is already in your car`);
    if (e.ctx !== CTX_OUT || Math.hypot(e.x - L.x, e.z - L.z) > BOARD_M) return this.done(i, `${a.name} is coming to your car`);
    if (!this.freeSeats(p.vehicleId)) throw new CompanionError(409, 'car_full', 'Your car is full');
    if (!this.getIn(A, p.vehicleId)) return this.done(i, `${a.name} is coming to your car`);
    return this.done(i, confirmWords({ action: 'ride' }, a.name));
  }
  dismiss(P, a, i, via = 'ui') {
    const A = this.sim.agents[i];
    const had = !!A.order;
    this.outOfCar(A);
    this.remember(A, 'dismissed');
    this.sim.endOrder(i);
    A.ride = null; A.fspot = null;
    this.syncSeats();
    this.ended.set(i, null);
    this.autoTried.delete(i);
    if (had) this.sim.brain.interruptSoon(A);
    void via;
    return this.done(i, confirmWords({ action: 'dismiss' }, a.name), { dismissed: had });
  }
  /** Body i is nobody's companion any more (its agent removed: server/index.mjs retireAgentBody) — its order ended, out of
   *  any car or boat seat, nothing said. → whether it had one. */
  release(i, why = 'released') {
    const A = this.sim?.agents[i];
    if (!A?.order) return false;
    this.outOfCar(A);
    this.remember(A, why);
    this.sim.endOrder(i);
    A.ride = null; A.fspot = null;
    this.syncSeats();
    this.ended.set(i, null);
    this.autoTried.delete(i);
    this.stats.released = (this.stats.released || 0) + 1;
    return true;
  }
  /** Every companion following or waiting for account id's player let go (the account deleted: a new account given the
   *  same number later must never find them with it). → how many. */
  releaseLeader(id, why = 'leader_gone') {
    let n = 0;
    for (const { a, o } of this.live()) if (o.lead?.kind === 'player' && o.lead.id === id && this.release(a.i, why)) n++;
    return n;
  }
  /** Orders left on bodies that are nobody's companions any more: an agent removed (no record), a body retired. Kept to
   *  the sweep's own rate (tick). → how many let go. */
  sweep() {
    const sim = this.sim; let n = 0;
    for (const a of sim?.agents || []) {
      if (!a?.order || !a.p?.vip) continue;
      const gone = a.p.retired || !this.agentRecOf(a.i);   // (an account deleted lets go at once: releaseLeader)
      if (gone && this.release(a.i, 'released')) n++;
    }
    if (n) this.log?.info?.(`[companions] ${n} left without an agent or a leader let go`);
    return n;
  }
  // ------------------------------------------------------------------------------------------------ sitting down
  /** Its leader in words: for the person commanding ("you" when it is their own player) and for its brain (a name). */
  leadWords(P, o) {
    const me = P?.account?.id, own = clean(P?.account?.displayName || P?.account?.login || 'your owner', 40);
    if (o?.lead?.kind === 'player') { if (o.lead.id === me) return { you: 'you', them: own }; const n = clean(this.playerLead(o.lead.id)?.name || 'them', 40); return { you: n, them: n }; }
    if (o?.lead?.kind === 'person') { const n = clean(this.sim.people[o.lead.i]?.name || 'them', 40); return { you: n, them: n }; }
    return { you: 'you', them: own };
  }
  /**
   * 'sit': it sits down with its leader — the free seat nearest them, on their own piece first (the other end of the
   * bench, another chair at their table, further round the fountain), else within a few metres; they standing: a seat
   * near itself. 'eat': it joins its leader's meal — at their table where food is served, ordering as residents order
   * there and paying from its own money (too little: it sits with them, no order). Not with anyone yet: it comes along
   * with P first. The body side is the Brain's (sitWith). → { ok, action, text, brain, reason?, companion }.
   */
  sit(P, a, i, action, via, want = null) {
    const sim = this.sim, A = sim.agents[i], brain = sim.brain, me = P.account.id;
    let o = brain.liveOrder(A, sim.now());
    if (!(o?.kind === 'follow' && o.lead)) {
      if (!this.players.byId.has(me)) return this.seatRefused(P, a, i, action, 'no_player', { you: 'you', them: clean(P.account.displayName || 'your owner', 40) });
      this.follow(P, a, i, { target: 'me' }, via);   // (with them first: may be refused — too many with them already)
      o = A.order;
    }
    const w = this.leadWords(P, o), r = brain.sitWith(A, { mode: action, want: action === 'eat' ? want : null });
    if (!r.ok) return this.seatRefused(P, a, i, action, r.why, w);
    // (told to sit while they sit: not again by itself this time)
    const st = this.sittingOf(o, this.now());
    if (st) this.autoTried.set(i, st.token);
    this.stats.sat++;
    const s = r.seat, soon = r.arrive - sim.now() <= SIT_SOON_S, at = s.use === 'eat' ? 'at' : 'on', by = s.use === 'eat' ? 'with' : 'beside';
    let text = `${a.name} ${soon ? 'sits down' : 'is going over to sit down'} ${at} ${s.words} ${by} ${w.you}`;
    let note = soon ? `you sat down ${at} ${s.words} ${by} ${w.them}` : `you are walking over to sit down ${at} ${s.words} ${by} ${w.them} (the seat is kept for you)`;
    if (action === 'eat') { const m = this.mealWords(s.meal, w); text += m.text; note += m.brain; }
    if (via === 'ui') this.remark(i, `${clean(P.account.displayName || 'My owner', 40)} asked me to ${action === 'eat' ? 'join their meal' : 'sit down with them'}, so I ${at === 'at' ? 'took a seat at' : 'sat down on'} ${s.words}.`);
    return this.done(i, text, { action, brain: note });
  }
  /** A meal joined, in words (what it ordered and paid, or why it didn't order): { text, brain } to add. */
  mealWords(m, w) {
    const what = l => listWords((l || []).map(id => foodName(id).toLowerCase()));
    const drink = m?.kind === 'bar';
    if (!m) return { text: '', brain: '' };
    if (!m.order) {
      if (m.unpaid) return { text: ' but can\'t pay for anything', brain: ` but did not order anything: ${m.unpaid === 'limits' ? 'your owner\'s spending limits don\'t allow it' : 'you have too little money'} — you are only sitting with ${w.them}` };
      return { text: '', brain: ` (there was nothing to order) — you are sitting with ${w.them}` };
    }
    if (m.paid === false) return { text: ' but the order didn\'t go through', brain: ` but your order did not go through (it could not be paid) — you are only sitting with ${w.them}` };
    const paid = m.paid ? ` (${vc(m.paid.total)} from your own money)` : '';
    return { text: ` and orders ${what(m.order)}`, brain: ` and ordered ${what(m.order)}${paid}; you are ${drink ? 'having a drink' : 'eating'} with ${w.them}` };
  }
  /** It could not sit down: an honest answer (ok: false), for its owner and for its brain — no seat is claimed. */
  seatRefused(P, a, i, action, why, w) {
    const f = SEAT_WHY[why] || (() => 'it was not possible just then');
    const own = f({ me: a.name, meIs: 'is', lead: w.you, is: w.you === 'you' ? 'are' : 'is' }), self = f({ me: 'you', meIs: 'are', lead: w.them, is: 'is' });
    const meal = w.you === 'you' ? 'your meal' : `${w.you}'s meal`;
    const text = action === 'eat' ? `${a.name} can't join ${meal}: ${own}` : `${a.name} can't sit down: ${own}`;
    const brain = action === 'eat' ? `you could not join ${w.them}'s meal: ${self}` : `you could not sit down: ${self}`;
    return { ok: false, action, reason: why, text, brain, error: text, code: why, companion: this.view(this.sim.agents[i]) };
  }
  /** 'stand': up from its seat, and on with its leader (beside them again). */
  stand(P, a, i, via) {
    const sim = this.sim, A = sim.agents[i], o = sim.brain.liveOrder(A, sim.now()), s = o?.seat, w = this.leadWords(P, o);
    void via;
    if (!s) return { ok: true, action: 'stand', text: `${a.name} is already standing`, brain: `you were not sitting down: you are standing ${o?.kind === 'follow' ? `beside ${w.them}` : 'where you are'}`, companion: this.view(A) };
    const st = this.sittingOf(o, this.now());
    if (st) this.autoTried.set(i, st.token);   // (not down again by itself while they sit on)
    sim.brain.getUp(A);
    this.stats.stood++;
    return this.done(i, `${a.name} gets up`, { action: 'stand', brain: `you got up from ${s.words} and are standing beside ${w.them} again` });
  }
  /** Its leader sitting now: { key (their seat), since (ms first seen so), token (this time they sat) }, or null. */
  sittingOf(o, now) {
    if (!o?.lead) return null;
    const ls = this.sim.brain.leaderSeatOf(o), k = o.lead.kind === 'player' ? `p${o.lead.id}` : `r${o.lead.i}`;
    if (!ls) { this.sitting.delete(k); return null; }
    let s = this.sitting.get(k);
    if (!s || s.key !== ls.key) this.sitting.set(k, s = { key: ls.key, since: now, token: `${k}:${ls.key}:${now}` });
    return s;
  }
  /**
   * A companion sitting with its leader (o.seat): it stays put while it should (Brain.seatKeeps) — no re-plan for their
   * every step — else it gets up and goes on with them now. True: sitting, or just got up (nothing else this look).
   */
  seatWatch(a, o, L) {
    if (!o.seat) return false;
    const brain = this.sim.brain;
    if (brain.seatKeeps(a, o, L)) return true;
    brain.getUp(a, 'leader');
    this.stats.stood++;
    return true;
  }
  /**
   * The default for a companion whose agent's Free Will doesn't decide for it (decides(rec) false): its leader has sat
   * AUTO_SIT_MS and a seat is free near them — it sits down with them by itself (as 'sit'), once each time they sit (it
   * gets up when they do: Brain.seatKeeps). With Free Will it waits to be told (Free Will may send 'sit' or 'eat').
   */
  autoSeat(a, o, L, now) {
    if (o.seat || a.ride || L.gone || L.car || L.waiting) return;
    const st = this.sittingOf(o, now);
    if (!st || now - st.since < AUTO_SIT_MS || this.autoTried.get(a.i) === st.token) return;
    const rec = this.agentRecOf(a.i);
    if (!rec) return;
    let free = true;
    try { free = !!this.decides(rec); } catch { free = true; }   // (in doubt: its Free Will's to decide)
    if (free) return;
    // (still on its way over to them: when it gets there)
    const e = evalPlan(a.plan, this.sim.now());
    if (!this.sim.brain.sameSpace(e.ctx, L.ctx) || Math.hypot(e.x - L.x, e.z - L.z) > COMING_M + 2) return;
    this.autoTried.set(a.i, st.token);
    const r = this.sim.brain.sitWith(a, { mode: 'sit', auto: true });
    if (r.ok) { this.stats.sat++; this.groupCache = null; }
  }
  /** Lets every companion of P go (P's own and those it gave orders to). */
  dismissAll(P) {
    const out = [];
    for (const { a, o } of this.live()) {
      const rec = this.agentRecOf(a.i);
      // (theirs to end: what they asked for, who is following them — and their agents' own outings with other agents,
      // which their Companions bar shows too; not what someone else who manages the agent asked of it)
      if (!rec || !this.mayCommand(P, rec) || (o.by !== P.account.id && o.via !== 'agent' && !(o.lead?.kind === 'player' && o.lead.id === P.account.id))) continue;
      this.dismiss(P, rec, a.i); out.push(rec.id);
    }
    return { ok: true, dismissed: out };
  }
  /** A line in its life's memory when time with someone ends (its activity log keeps the moments; this the gist). */
  remember(A, why) {
    try {
      const o = A.order, life = this.lifeOf(), rec = this.agentRecOf(A.i);
      if (!o || !life || !rec || !o.lead) return;
      const with_ = o.leadName || (o.lead.kind === 'player' ? o.byName : this.sim.people[o.lead.i]?.name);
      if (!with_) return;
      const day = this.sim.brain.day(this.sim.now());
      life.remember?.(rec.id, { kind: 'person', text: `Went around the city with ${with_}${why === 'dismissed' ? '' : ''}`, importance: 2, people: [with_], day, time: this.sim.now() });
    } catch { /* a memory is a nicety */ }
  }

  // ------------------------------------------------------------------------------------------------ agents with agents
  /** Whether body i is free to go somewhere with another agent now: no order of anyone's (or only a meet-up it is part
   *  of), not on post, not at work on a message. */
  freeFor(i, group = null) {
    const sim = this.sim, A = sim?.agents[i], p = sim?.people[i];
    if (!A?.plan || !p || p.retired || p.post) return false;
    if (p.vip && sim.presence.isWorking(p.agentId)) return false;
    const o = sim.brain.liveOrder(A, sim.now());
    // (at a meet-up: once it got there — they meet up first; then two of them may go off somewhere together)
    return !o || (o.kind === 'hold' && !!o.group && !!o.reached && (group === null || o.group === group));
  }
  /** Whether agents a and b (records) may ask each other along (docs/features/companions.md §7): companions and agents'
   *  invitations on, both with bodies, both free — or in the same meet-up. Never a command: each one's own brain says yes. */
  mayGoTogether(a, b) {
    const cfg = this.config();
    if (!cfg.enabled || !cfg.agentInvites || !a || !b || a.id === b.id) return false;
    let ia, ib;
    try { ia = this.bodyOf(a.id).i; ib = this.bodyOf(b.id).i; } catch { return false; }
    const ga = this.sim.agents[ia].order?.group || null, gb = this.sim.agents[ib].order?.group || null;
    if ((ga || gb) && ga !== gb) return false;
    return this.freeFor(ia, ga) && this.freeFor(ib, gb);
  }
  /**
   * Agent a asked agent b along to `place` (one of a's places, or a walk) and b said yes, out loud: they go together —
   * a leads (to the place, or a stroll in the nearest park), b goes with a. Their own choice: no person gave the order
   * (via 'agent'); each owner sees it in their Companions. → { ok, place } or { ok: false, why }.
   */
  together(a, b, place) {
    try {
      if (!this.mayGoTogether(a, b)) return { ok: false, why: 'not_free' };
      const sim = this.sim, ia = this.bodyOf(a.id).i, ib = this.bodyOf(b.id).i;
      const group = `t${this.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, who = { via: 'agent', group };
      const walk = !place || /^a walk$/i.test(place);
      let r, name;
      if (walk) { r = sim.order(ia, { kind: 'park', minutes: 45, maxMinutes: LONG, ...who }); name = 'a walk in the park'; }
      else {
        const w = this.where(null, ia, { place });
        if (w.venue) { r = sim.order(ia, { kind: VENUE_KINDS[w.kind] || w.kind, venue: w.venue, minutes: 60, maxMinutes: LONG, ...who }); name = w.name; }
        else if (w.spot) { r = sim.order(ia, { kind: 'hold', spot: w.spot, minutes: 60, maxMinutes: LONG, goal: `At ${w.spot.place}`, ...who }); name = w.spot.place; }
        else return { ok: false, why: 'nowhere' };
      }
      if (!r.ok) return { ok: false, why: r.why };
      const f = sim.order(ib, { kind: 'follow', lead: { kind: 'person', i: ia }, slot: 0, minutes: walk ? 45 : 60, maxMinutes: LONG, ...who });
      if (!f.ok) { sim.endOrder(ia); return { ok: false, why: f.why }; }
      this.stats.together = (this.stats.together || 0) + 1;
      const life = this.lifeOf(), day = sim.brain.day(sim.now());
      try {
        life?.remember?.(a.id, { kind: 'person', text: `Asked ${b.name} along to ${name}, and they came`, importance: 3, people: [b.name], day, time: sim.now() });
        life?.remember?.(b.id, { kind: 'person', text: `Went with ${a.name} to ${name}`, importance: 3, people: [a.name], day, time: sim.now() });
      } catch { /* a memory is a nicety */ }
      this.groupCache = null;
      setImmediate(() => this.push());
      return { ok: true, place: name, group };
    } catch (e) { this.log?.warn?.('[companions] going together failed:', e.message); return { ok: false, why: e.code || 'failed' }; }
  }
  /** A word out loud from body i about what just happened (its Mind decides the words; at most one a minute each). */
  remark(i, situation) {
    const mind = this.mindOf(), rec = this.agentRecOf(i), t = this.now();
    if (!mind?.remark || !rec || t - (this.remarked.get(i) || 0) < 60000) return;
    this.remarked.set(i, t);
    mind.remark(rec, situation).catch(() => {});
  }
  /**
   * Agents out together with the same person (going round with them, waiting beside them, at their table) spend that time
   * together, as residents who chat do: they meet the first time — and remember it — and know each other a little better
   * with every outing after (the life's bond: once per pair per outing). 2026-11-18, the product owner: Lara and Sam, out with him time
   * and again, introduced themselves to each other in his car — nothing had ever told them they knew each other. The first
   * time a pair is together, the outings they already shared before count (their chats' outing lines: outingsTogether).
   */
  bondTogether(live) {
    const life = this.lifeOf?.(), sim = this.sim;
    if (!life?.bond || !sim) return;
    const t = sim.now(), groups = new Map();
    for (const { a, o } of live) {
      if (o.kind !== 'follow' || o.lead?.kind !== 'player' || !a.p?.vip) continue;
      const rec = this.agentRecOf(a.i);
      if (!rec) continue;
      const l = groups.get(o.lead.id) || [];
      l.push({ a, o, rec });
      groups.set(o.lead.id, l);
    }
    for (const [account, list] of groups) {
      if (list.length < 2) continue;
      for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
        const A = list[x], B = list[y], key = `${Math.min(A.rec.id, B.rec.id)}|${Math.max(A.rec.id, B.rec.id)}`;
        // (once per outing: the same two orders — either one starting again is a new outing)
        const outing = `${account}:${Math.min(A.o.at, B.o.at)}:${Math.max(A.o.at, B.o.at)}`;
        if (this.bonded.get(key) === outing) continue;
        // (together: near each other where they are, not one still on its way across town)
        const ea = evalPlan(A.a.plan, t), eb = evalPlan(B.a.plan, t);
        if (!sim.brain.sameSpace(ea.ctx, eb.ctx) || Math.hypot(ea.x - eb.x, ea.z - eb.z) > BOND_M) continue;
        this.bonded.set(key, outing);
        if (this.bonded.size > 5000) this.bonded.delete(this.bonded.keys().next().value);
        const owner = clean(this.playerLead(account)?.name || this.principalFor?.(account)?.account?.displayName || 'their owner', 40);
        const day = sim.brain.day(t), time = life.clockAt ? life.clockAt(t) : '', place = ea.ctx >= 0 ? sim.brain.placeName(ctxB(ea.ctx), ctxF(ea.ctx)) : sim.nav?.addressAt?.(ea.x, ea.z) || null;
        for (const [M, O] of [[A, B], [B, A]]) {
          try {
            // (never met yet: the outings they already had with this person, together, count too — at most a few)
            const first = !life.relationTo?.(M.rec.id, 'agent', O.a.p.id);
            const before = first ? Math.min(BOND_PAST_MAX, Math.max(0, Number(this.outingsTogether?.(account, M.rec.id, O.rec.id)) || 0)) : 0;
            for (let k = 0; k <= before; k++) life.bond(M.rec.id, { kind: 'agent', id: O.a.p.id, name: O.a.p.name }, day, time, place, { weight: 1, note: `We go out with ${owner} together` });
          } catch (e) { this.log?.warn?.('[companions] two out together could not be remembered:', e.message); }
        }
        this.stats.bonded = (this.stats.bonded || 0) + 1;
      }
    }
  }
  /** Agents of one group standing together (a meet-up there, or going round with the same person): a pair that hasn't
   *  had a word yet is offered one (the Mind's meeting: one says something, the other may answer — once a world day). */
  chatter(live) {
    const mind = this.mindOf();
    if (!mind?.onMet) return;
    const sim = this.sim, now = this.now(), groups = new Map();
    for (const { a, o } of live) {
      const key = o.group || (o.kind === 'follow' && o.lead ? `${o.lead.kind}:${o.lead.kind === 'player' ? o.lead.id : o.lead.i}` : null);
      if (!key || a.act?.kind !== 'follow' && !(o.via === 'agent') && !(o.seat && a.act?.id === o.seat.id)) continue;   // (at its meal with them too)
      const l = groups.get(key) || []; l.push(a); groups.set(key, l);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
        const A = list[x], B = list[y], k = `${Math.min(A.i, B.i)}|${Math.max(A.i, B.i)}`;
        if (now - (this.talked.get(k) || 0) < 45000) continue;
        if (now - (this.remarked.get(A.i) || 0) < 9000 || now - (this.remarked.get(B.i) || 0) < 9000) continue;   // (a word just said: a moment first)
        // (either one in a conversation with someone — its chat, the companions' voice —: no chat beside it)
        const ra = this.agentRecOf(A.i), rb = this.agentRecOf(B.i);
        if ((ra && mind.conversing?.(ra.id)) || (rb && mind.conversing?.(rb.id))) continue;
        const ea = evalPlan(A.plan, sim.now()), eb = evalPlan(B.plan, sim.now());
        if (ea.ctx !== eb.ctx || Math.hypot(ea.x - eb.x, ea.z - eb.z) > 5) continue;
        this.talked.set(k, now);
        const rec = this.agentRecOf(A.i), o = A.order, L = o?.lead?.kind === 'player' ? this.playerLead(o.lead.id) : null;
        // (what they are doing together, for their words: out with someone, at a meet-up, off together by their choice)
        const together = o?.kind === 'hold' && o.group ? `we're meeting up at ${o.spot?.place || 'our spot'}` : L ? (L.waiting ? `we're waiting together by ${L.name}` : `we're out and about with ${L.name}`) : o?.via === 'agent' ? 'we went off together' : 'we\'re out together';
        // (the first time today: they greet each other; after that they talk on now and then — the Mind's limits)
        if (rec) { try { mind.onMet(rec.id, B, { again: true, together }); } catch { /* a word is a nicety */ } }
        return;   // (one pair a tick: words come one at a time)
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ chats (the reflex)
  /**
   * A message a person wrote to an agent (its chat window, the talk in Player mode): a plain command is carried out now
   * (the reflex, ./intent.js) — only the agent's owner or manager. → null (no command, or not theirs to give), or
   * { ok, action, text } — what happened, in a line for the chat and for the agent's brain.
   */
  heard(P, a, text, { mode = null } = {}) {
    if (!this.config().enabled || !a || !this.mayCommand(P, a)) return null;
    const cmd = parseCommand(text, { name: a.name });
    if (!cmd) return null;
    try { this.bodyOf(a.id); } catch { return null; }   // (an agent with no body in the city: the words are only for its brain)
    this.stats.reflex++;
    return this.carry(P, a, cmd, 'chat', mode);
  }
  /** Carries out command cmd ({ action, target, place }) for agent record a: → { ok, action, text }. */
  carry(P, a, cmd, via, mode = null) {
    void mode;
    try {
      let r;
      switch (cmd.action) {
        case 'follow': r = this.command(P, { agent: a.id, action: 'follow', target: cmd.target === 'me' ? 'me' : cmd.target, place: cmd.place || null }, via); break;
        case 'stay': r = this.command(P, { agent: a.id, action: 'stay', place: cmd.place || 'here' }, via); break;
        case 'go': r = this.command(P, { agent: a.id, action: 'go', place: cmd.place }, via); break;
        case 'meet':
          if (cmd.target === 'me') r = this.command(P, { agent: a.id, action: 'stay', place: cmd.place, goal: `Waiting for ${clean(P.account.displayName || 'you', 40)}` }, via);
          else {
            const other = this.findAgent(P, cmd.target);
            r = other ? this.command(P, { action: 'meetup', agents: [a.id, other.a.id], place: cmd.place }, via) : this.command(P, { agent: a.id, action: 'go', place: cmd.place }, via);
          }
          break;
        case 'ride':
          // (its owner in an aircraft: "get in" is into that — server/play/flight-crew.js)
          if (this.flight && this.players.byId.get(P.account.id)?.aircraftId) return this.flight.command(P, a, 'fly', via, this.ctxOf) || null;
          r = this.command(P, { agent: a.id, action: 'ride' }, via); break;
        case 'dismiss': r = this.command(P, { agent: a.id, action: 'dismiss' }, via); break;
        // (its body with its leader: sit down beside them, get up, sit at their table and order — what it did, or that it
        //  could not, in its own words for its brain: a chat never claims a seat it didn't take)
        case 'sit': case 'eat': case 'stand': {
          r = this.command(P, { agent: a.id, action: cmd.action }, via);
          const ok = r.ok !== false;
          return { ok, action: cmd.action, text: r.text, brain: r.brain || r.text, ...(ok ? {} : { code: r.reason || null, reason: r.reason || null }) };
        }
        // (fishing with its owner: on board, a rod out, the rod away — server/play/fishing-crew.js, through the interaction
        //  registry's fishing source; what it did, or why it could not)
        case 'fish': case 'unfish': case 'board': case 'buybait': return this.aboard?.command?.(P, a, cmd.action, via, this.ctxOf) || null;
        // (playing them at the other end of a table for two, and stopping — server/play/versus.js, through the registry's
        //  versus source; "let's play" with no such table near is not this: its brain reads it)
        case 'versus': case 'unversus': return this.versus?.command?.(P, a, cmd, via, this.ctxOf) || null;
        // (the airport, server/play/flight-crew.js through the registry's airport source: into its owner's aircraft, a ring
        //  course flown itself, back to land)
        case 'fly': case 'pilot': case 'land': return this.flight?.command?.(P, a, cmd.action, via, this.ctxOf, cmd.course || cmd.sentence || '') || null;
        // (an action of what it may be busy at — "let's cook", "stop cooking": server/play/kitchen-play.js — its own result)
        default: { for (const h of this.busy) { const r = h.command?.(P, a, cmd.action, via, this.ctxOf); if (r) return r; } return null; }
      }
      return { ok: true, action: cmd.action, text: r.text, brain: this.brainNote(P, cmd, r) };
    } catch (e) {
      if (!(e instanceof CompanionError)) { this.log?.warn?.('[companions] a command failed:', e.stack || e.message); return { ok: false, action: cmd.action, text: `${a.name} could not do that` }; }
      return { ok: false, action: cmd.action, text: e.message, code: e.code };
    }
  }
  /** What a carried command means for the agent itself, for its brain (in its chat's answer it then speaks as one who is
   *  already doing it: "on my way", not "where to?"). */
  brainNote(P, cmd, r) {
    const who = clean(P.account.displayName || P.account.login || 'your owner', 40), c = r.companion || {}, place = c.place || cmd.place || '';
    switch (cmd.action) {
      case 'follow': return cmd.target === 'me' || !cmd.target
        ? `you are now ${who}'s companion: you are walking over to ${who} and going wherever they go (on foot beside them, in their car when they drive)${cmd.place ? `, to ${clean(cmd.place, 60)}` : ''} — "here", "me" and "come" mean ${who} themself, so don't ask where`
        : `you are now going along with ${clean(c.leader?.name || cmd.target, 40)}`;
      case 'stay': return `you are now waiting for ${who} right where you are${place && cmd.place && cmd.place !== 'here' ? ` (at ${clean(place, 60)})` : ''}, until they call you over or let you go`;
      case 'go': return `you are now on your way to ${clean(place || cmd.place || 'that place', 60)}`;
      case 'meet': return `you are now on your way to ${clean(place || cmd.place || 'the meeting place', 60)} to meet ${cmd.target === 'me' ? who : clean(cmd.target, 40)}`;
      case 'ride': return `you are getting into ${who}'s car with them`;
      case 'dismiss': return `you are no longer ${who}'s companion: you go back to your own day`;
      default: return r.text;
    }
  }
  /**
   * Who answers a line said out loud to a group of companions without calling anyone by name (the voice row: everyone
   * hears every line — 2026-11-18, the product owner: "I prefer both listen and respond as needed … not a fixed, assigned agent that gets
   * the speech first"). Judged as people in a group do, from the line and what was said just before it (the group's
   * thread, ../chat/groups.js): who it is said to, who it asks, whether it is for everyone — a companion only talked about
   * is not the one it is said to. One request to the decision service (the first of them that has one).
   * ids: the companions with the person (theirs to talk with). → { agents: [ids, the first to answer first], how } —
   * agents [] when there is no judgment (the page falls back to the one last spoken with).
   */
  async whoAnswers(P, ids, text) {
    const s = String(text || '').trim();
    const recs = [...new Set((Array.isArray(ids) ? ids : []).map(Number))].slice(0, 8).map(id => this.agents.get(id)).filter(a => a && a.enabled && this.mayCommand(P, a));
    if (!P?.account || recs.length < 2 || !s || s.length > 1000) return { agents: recs.length === 1 ? [recs[0].id] : [], how: 'none' };
    const fw = this.fwOf?.();
    let conn = null;
    for (const a of recs) { try { conn = fw?.resolveConnection?.(a, fw.settingsOf(a.id))?.connection || null; } catch { conn = null; } if (conn) break; }
    if (!conn || !fw?.decideFn) return { agents: [], how: 'no_service' };
    const who = clean(P.account.displayName || P.account.login || 'the person', 40), names = recs.map(a => clean(a.name, 40));
    let lines = [];
    try { const G = this.groupsOf?.(); lines = G ? G.lines(P.account.id, G.key(recs.map(a => a.id)), { limit: 8 }) : []; } catch { lines = []; }
    const said = lines.map(l => `${l.speaker === 'person' ? who : clean(l.name, 40) || 'one of them'}: ${clean(l.text, 220)}`);
    const request = {
      input: [`${who} is out with their AI companions ${names.join(', ')}, all together, talking out loud: everyone hears every line, and whoever a line is for answers it.`,
        said.length ? `What was said just before (oldest first):\n${said.join('\n')}` : 'Nothing was said just before.',
        `${who} now says: "${clean(s, 600)}"`].join('\n'),
      questions: [
        ...recs.map((a, k) => ({ type: 'predicate', name: `answers_${k}`, instructions: `Should ${names[k]} answer this line? Yes when it is said to ${names[k]} (a name heard a little wrong still counts: a nickname, a misheard name), asks ${names[k]} something ("can you tell me whether they …" asks the one listening, not the one talked about), carries on what ${who} and ${names[k]} were just talking about, or is for everyone and ${names[k]} would naturally answer. No when it is said to someone else — even when it talks about ${names[k]}.` })),
        { type: 'choice', name: 'first', instructions: `Who is ${who} talking to — the one being asked, who should reply first? Not the one the line is only about: "Does ${names[0]} have anything on their plate? Can you tell me?" is asked of ${names[1]}.`, choices: recs.map((a, k) => ({ value: `a${k}`, description: names[k] })) },
      ],
    };
    let res;
    try { res = await fw.decideFn(conn, request, TURN_JUDGE_MS); } catch (e) { this.log?.info?.('[companions] who answers: no judgment:', e.code || e.message); return { agents: [], how: 'no_answer' }; }
    const ans = res?.answers || [], pr = n => Number(ans.find(x => x && x.name === n && x.type === 'predicate')?.probability ?? 0);
    const first = ans.find(x => x && x.name === 'first' && x.type === 'choice')?.choice, k0 = /^a\d+$/.test(String(first)) ? Number(String(first).slice(1)) : -1;
    const scored = recs.map((a, k) => ({ id: a.id, k, p: pr(`answers_${k}`) })).sort((x, y) => (y.k === k0) - (x.k === k0) || y.p - x.p);
    let out = scored.filter(x => x.p >= TURN_ANSWER_P || x.k === k0).map(x => x.id);
    if (!out.length && scored[0]) out = [scored[0].id];
    this.stats.turns = (this.stats.turns || 0) + 1;
    return { agents: out, how: 'judged' };
  }
  /**
   * A message the reflex didn't take, read by the agent's own decision service (its Free Will connection, or the
   * installation's): is it asking for something in the city — to come along, to wait, to go somewhere, to let it go?
   * Only a plain answer (confidence ≥ 0.6) is acted on. → the carried command's { ok, action, text } or null.
   */
  async understand(P, a, text) {
    const cfg = this.config(), fw = this.fwOf();
    if (!cfg.enabled || !cfg.understand || !fw || !a || !this.mayCommand(P, a)) return null;
    const s = String(text || '').trim();
    if (!s || s.length > 400) return null;
    let body;
    try { body = this.bodyOf(a.id); } catch { return null; }
    const r = fw.resolveConnection?.(a, fw.settingsOf(a.id));
    if (!r?.connection) return null;
    const sim = this.sim, W = this.worldOf(), places = W ? W.places(sim, body.i, null, 10) : [];
    const p = this.players.byId.get(P.account.id), who = clean(P.account.displayName || P.account.login, 40);
    const where = p ? (p.flags & PF_OBSERVING ? `${who}'s character is parked in the world; ${who} is watching from above` : `${who} is walking in the world as a player`) : `${who} has no character in the world right now`;
    const request = {
      input: [`${who} (the owner of the AI agent ${a.name}) wrote to ${a.name}: "${clean(s, 400)}"`, where + '.', `${a.name}'s body is ${sim.agents[body.i].act?.label ? `${sim.agents[body.i].act.label.toLowerCase()}` : 'in the city'}.`].join('\n'),
      questions: [
        { type: 'choice', name: 'intent', instructions: `What does ${who} want ${a.name}'s body to do in the city now? "none" unless the message asks for it plainly.`,
          choices: [{ value: 'none', description: 'Nothing in the city: a question, a task, a chat' }, { value: 'follow', description: `Come along with ${who}, be their companion` },
            { value: 'stay', description: 'Wait where it is' }, { value: 'go', description: 'Go to a place' }, { value: 'dismiss', description: 'Stop being a companion and go back to its own day' }] },
        { type: 'choice', name: 'place', instructions: 'If a place is meant, which one?', choices: [{ value: 'none', description: 'No place, or here' }, ...places.map((x, k) => ({ value: `p${k}`, description: x.name }))] },
      ],
    };
    let res;
    try { res = await fw.decideFn(r.connection, request, 6000); } catch (e) { this.log?.warn?.('[companions] the decision service did not answer:', e.code || e.message); return null; }
    const ans = n => (res?.answers || []).find(x => x && x.name === n && x.type === 'choice');
    const it = ans('intent'), pl = ans('place');
    if (!it || it.choice === 'none' || !(Number(it.confidence) >= 0.6)) return null;
    const placeName = pl && pl.choice !== 'none' && Number(pl.confidence) >= 0.5 ? places[Number(String(pl.choice).slice(1))]?.name : null;
    if (it.choice === 'go' && !placeName) return null;
    this.stats.understood++;
    return this.carry(P, a, { action: it.choice, target: 'me', place: it.choice === 'go' ? placeName : it.choice === 'follow' ? placeName : 'here' }, 'decision');
  }

  // ------------------------------------------------------------------------------------------------ the watch
  tick() {
    const sim = this.sim;
    if (!sim) return;
    this.hookSim();
    this.groupCache = null;
    const now = this.now(), cfg = this.config();
    // where every player is (and was: a player that leaves is waited for where it was)
    for (const p of this.players.byId.values()) {
      const l = this.last.get(p.id);
      // (its pace: how far it went since the last look, a second ago — its followers head for where it is going)
      const dt = l ? Math.max(0.2, (now - l.at) / 1000) : 1, same = l && l.ctx === p.ctx;
      const vx = same ? (p.x - l.x) / dt : 0, vz = same ? (p.z - l.z) / dt : 0;
      if (!l || l.x !== p.x || l.z !== p.z || l.ctx !== p.ctx) this.last.set(p.id, { x: p.x, z: p.z, ctx: p.ctx, yaw: p.yaw, name: p.name, at: now, vx: Math.abs(vx) < 12 ? vx : 0, vz: Math.abs(vz) < 12 ? vz : 0 });
      else if (now - l.at > 600) { l.vx = 0; l.vz = 0; }   // (standing still: its followers stop with it)
      this.gone.delete(p.id);
    }
    // (now and then: orders left on bodies that are nobody's companions any more — sweep)
    if (now - (this.sweptAt || 0) > SWEEP_MS) { this.sweptAt = now; try { this.sweep(); } catch (e) { sim.noteError(e); } }
    const live = this.live();
    for (const { a, o } of live) {
      try { this.watch(a, o, now, cfg); } catch (e) { sim.noteError(e); }
      // (with its leader for the first time: a word about it)
      if (o.kind === 'follow' && o.reached && o.via !== 'agent' && !this.arrived.has(`${a.i}:${o.at}`)) {
        this.arrived.add(`${a.i}:${o.at}`);
        const L = o.lead?.kind === 'player' ? this.playerLead(o.lead.id) : null;
        this.remark(a.i, `I just caught up with ${o.leadName || 'them'}${L?.waiting ? ' — they are looking around from above, so I\'ll wait right here next to them' : L?.car ? '' : ' — we\'re going round together now'}.`);
      }
      // (a meet-up reached: a word about it)
      if (o.kind === 'hold' && o.group && o.reached && !this.arrived.has(`${a.i}:${o.at}`)) {
        this.arrived.add(`${a.i}:${o.at}`);
        const others = this.groupMembers(o.group).filter(j => j !== a.i).map(j => sim.people[j]?.name).filter(Boolean);
        this.remark(a.i, `I just arrived at ${o.spot?.place || 'the meeting place'}${others.length ? ` to meet up with ${others.join(' and ')}` : ''}.`);
      }
    }
    if (this.arrived.size > 5000) this.arrived.clear();
    try { this.errandsDone(); } catch (e) { sim.noteError(e); }
    try { this.joinPending(); } catch (e) { sim.noteError(e); }
    try { this.bondTogether(live); } catch (e) { sim.noteError(e); }
    try { this.chatter(live); } catch (e) { sim.noteError(e); }
    // orders that ended by themselves (its time was up, its leader gone, nowhere to go): its owner is told once
    for (const a of sim.agents) {
      const e = a?.orderEnded;
      if (!e || !e.by || this.ended.get(a.i) === e) continue;
      this.ended.set(a.i, e);
      const rec = this.agentRecOf(a.i);
      if (rec && e.why !== 'dismissed') {
        this.stats.ended++;
        this.notify(e.by, { t: 'mind', ev: 'note', agent: { id: rec.id, name: rec.name }, text: `${rec.name} went back to their day: ${WHY[e.why] || e.why}.` });
      }
    }
    // forget players long gone that nobody waits for
    for (const [id, l] of this.last) if (!this.players.byId.has(id) && now - l.at > 6 * 3600000 && !live.some(x => x.o.lead?.kind === 'player' && x.o.lead.id === id)) this.last.delete(id);
    try { this.syncSeats(); } catch (e) { sim.noteError(e); }   // (the seats as the riders are, however they changed)
    this.lookOutings();
    this.push();
  }
  // ------------------------------------------------------------------------------------------------ travelling along
  /**
   * Account p.id's player was moved across the map at once (Players.onJump: the map's "Travel here", "Go home", an admin's
   * warp): the companions out with them come along — beside them there at once, as a party travels together (Kim
   * 2026-11-17: "they should teleport with the player if they are active companions with the player"). One busy at
   * something of its own beside them (a Rush in the kitchen, a shift, aboard) or off on a quick errand finishes that
   * first, then joins them wherever they are (pendingJoin). One already close by walks on with them. → the bodies moved.
   */
  travelled(p, why = 'travel') {
    const sim = this.sim;
    if (!sim || !p) return [];
    this.hookSim();
    this.groupCache = null;
    const now = this.now(), moved = [];
    // (where they are now, standing: not a run across the map at a thousand metres a second)
    this.last.set(p.id, { x: p.x, z: p.z, ctx: p.ctx, yaw: p.yaw, name: p.name, at: now, vx: 0, vz: 0 });
    const live = this.live();
    for (const { a, o } of live) {
      if (o.kind !== 'follow' || o.lead?.kind !== 'player' || o.lead.id !== p.id) continue;
      if (this.isBusy(a)) { this.pendingJoin.set(a.i, { account: p.id, at: now }); continue; }
      if (this.joinLeader(a, o, p)) moved.push(a.i);
    }
    for (const [i, e] of this.errands) if (e.account === p.id) this.pendingJoin.set(i, { account: p.id, at: now });
    // (one going along with one of them: its leader came along, so does it)
    const near = new Set(moved);
    for (const { a, o } of live) {
      if (o.kind !== 'follow' || o.lead?.kind !== 'person' || !near.has(o.lead.i) || this.isBusy(a)) continue;
      const e = evalPlan(sim.agents[o.lead.i].plan, sim.now() + 0.1);
      if (this.joinLeader(a, o, { x: e.x, z: e.z, ctx: e.ctx, yaw: e.yaw })) moved.push(a.i);
    }
    // (a word about it from one of them — not a chorus; an admin's warp is a test, not a trip)
    if (moved.length && why !== 'warp') {
      const where = p.ctx >= 0 ? sim.brain.placeName(ctxB(p.ctx), ctxF(p.ctx)) : sim.nav?.addressAt?.(p.x, p.z);
      this.remark(moved[0], `${clean(p.name || 'My owner', 40)} just ${why === 'home' ? 'went home' : 'travelled across the city'} in an instant and I came along${moved.length > 1 ? ' with the others' : ''} — we're ${where ? `at ${where}` : 'there'} together now.`);
    }
    if (moved.length) setImmediate(() => { this.lookOutings(); this.push(); });
    return moved;
  }
  /** Whether a is busy at something of its own beside its leader (a play module, a work shift) or aboard a boat or aircraft. */
  isBusy(a) {
    if (a.ride?.boat || a.ride?.aircraft) return true;
    return this.busy.some(h => { try { return !!h.busyWith?.(a); } catch { return false; } });
  }
  /**
   * Puts companion a (order o) beside leader p ({ x, z, ctx, yaw }) at once when it is farther than JOIN_FAR_M (or in
   * another building, on another floor): its place in the group there (slotSpot), then on with them. False: close by
   * already (it walks on with them), or nowhere to put it.
   */
  joinLeader(a, o, p) {
    const sim = this.sim, brain = sim.brain, e = evalPlan(a.plan, sim.now());
    if (!a.ride && brain.sameSpace(e.ctx, p.ctx) && Math.hypot(e.x - p.x, e.z - p.z) <= JOIN_FAR_M) return false;
    const L = { x: p.x, z: p.z, ctx: p.ctx, yaw: p.yaw || 0, moving: false, vx: 0, vz: 0 };
    let s = brain.slotSpot(L, Number.isInteger(o.slot) ? o.slot : 0) || brain.standAt(p.ctx, p.x, p.z);
    // (never in the water: they on a boat or swimming — the nearest dry ground near them, else it walks over as it can)
    if (s && s.ctx < 0 && !brain.standable(s.x, s.z)) s = brain.shoreNear(p.x, p.z);
    if (!s || !brain.joinAt(a, s)) return false;
    this.autoTried.delete(a.i);
    this.stats.joined++;
    this.syncSeats();
    return true;
  }
  /** Companions that were busy, or off on an errand, when their leader travelled: beside them as soon as they are free. */
  joinPending() {
    const sim = this.sim, now = this.now();
    for (const [i, e] of [...this.pendingJoin]) {
      if (now - e.at > PENDING_MS) { this.pendingJoin.delete(i); continue; }
      if (this.errands.has(i)) continue;   // (still at it: errandsDone has it follow them again first)
      const a = sim.agents[i], o = a?.plan ? sim.brain.liveOrder(a, sim.now()) : null;
      if (!o || o.kind !== 'follow' || o.lead?.kind !== 'player' || o.lead.id !== e.account) { this.pendingJoin.delete(i); continue; }   // (told otherwise meanwhile)
      if (this.isBusy(a)) continue;
      const p = this.players.byId.get(e.account);
      if (!p || p.vehicleId || p.aircraftId || p.boatId) continue;   // (gone a moment, or driving: when they are back on foot)
      this.pendingJoin.delete(i);
      this.joinLeader(a, o, p);
    }
  }
  /**
   * After a restart (once, at startup): the companions that were out with a player when the server stopped (the follow
   * order kept on the resident) are put beside that player at once — where it is, or, not back yet, where its place was
   * saved (where it comes back) — instead of wherever their routine put them; there they wait for it as for anyone gone
   * a moment (watch: the order ends when it doesn't come back in companions.waitMinutes). Only those: an agent that was
   * not with anyone starts its day as it would. → the bodies moved.
   */
  restored() {
    const sim = this.sim;
    if (!sim) return [];
    this.hookSim();
    const now = this.now(), moved = [];
    for (const a of sim.agents) {
      if (!a?.plan || !a.p?.vip || (a.order || a.p.order)?.kind !== 'follow') continue;
      const o = sim.brain.liveOrder(a, sim.now());
      if (!o || o.kind !== 'follow' || o.lead?.kind !== 'player') continue;
      const id = o.lead.id, live = this.players.byId.get(id), at = live || this.players.savedAt?.(id);
      if (!at) continue;
      delete o.ended;   // (its warm start looked for its leader before anyone could say where they are)
      if (!live) {
        const name = this.last.get(id)?.name || o.leadName || clean(this.principalFor?.(id)?.account?.displayName || '', 40) || 'them';
        if (!this.last.has(id)) this.last.set(id, { x: at.x, z: at.z, ctx: at.ctx, yaw: at.yaw || 0, name, at: now, vx: 0, vz: 0 });
      }
      // (aboard their boat when the server stopped: back aboard at its spot when they are back at the helm — server/world/
      //  boats.js resume —, not put out on the water beside where they were saved, 2026-11-19)
      const rec = this.agentRecOf(a.i);
      if (rec && this.aboard?.harbour?.crewWaitingFor?.(rec.id)) continue;
      if (this.joinLeader(a, o, at)) moved.push(a.i);
    }
    if (moved.length) this.log?.info?.(`[companions] after the restart: ${moved.length} companion(s) back beside the player they were out with`);
    return moved;
  }
  /** A player came into the world (Players.onJoin): its companions that are far from it (left waiting elsewhere) join it. */
  rejoined(p) {
    const sim = this.sim;
    if (!sim || !p) return [];
    this.hookSim();
    const moved = [];
    for (const { a, o } of this.live()) {
      if (o.kind !== 'follow' || o.lead?.kind !== 'player' || o.lead.id !== p.id || this.isBusy(a)) continue;
      const rec = this.agentRecOf(a.i);
      if (rec && this.aboard?.harbour?.crewWaitingFor?.(rec.id)) continue;   // (back aboard their boat with them: harbour.resume)
      if (this.joinLeader(a, o, p)) moved.push(a.i);
    }
    return moved;
  }
  /** Who is out with whom, for the outings' dividers in the chat (./outings.js): an agent following a person's player (an
   *  outing may begin), or doing something else that person asked (one under way goes on: a wait, a place, a meet-up). */
  lookOutings() {
    if (!this.outings) return;
    try {
      const now = new Map();
      for (const { a, o } of this.live()) {
        const rec = this.agentRecOf(a.i);
        if (!rec) continue;
        if (o.kind === 'follow' && o.lead?.kind === 'player') now.set(rec.id, { account: o.lead.id, start: true });
        else if (o.by !== null && o.by !== undefined && o.via !== 'agent') now.set(rec.id, { account: o.by, start: false });
      }
      this.outings.look(now);
    } catch (e) { this.log?.warn?.('[companions] looking at outings failed:', e.message); }
  }
  /** One companion's leader looked at: keep its place, get in or out of the car, or wait for it. */
  watch(a, o, now, cfg) {
    const sim = this.sim, brain = sim.brain;
    // a person who gave the order and has been gone long enough: its orders end (the agent goes back to its day)
    const giver = o.by ?? null;
    if (giver !== null && !this.players.byId.has(giver)) {
      const since = this.gone.get(giver) ?? now;
      this.gone.set(giver, since);
      if (now - since > cfg.waitMinutes * 60000) { this.end(a, o, 'leader_left'); return; }
    }
    if (o.kind !== 'follow') return;
    if (o.lead?.kind === 'player') {
      const L = this.playerLead(o.lead.id, a);
      if (!L) { this.end(a, o, 'leader_gone'); return; }
      // (its leader's aircraft: in with them, out with them, or waiting for them to land — server/play/flight-crew.js)
      if (this.flight?.watch?.(a, o, L)) return;
      // (its leader's boat: getting on and off with them, carried along at its fishing spot — server/play/fishing-crew.js)
      if (this.aboard?.watch?.(a, o, L)) return;
      // (busy at something beside them — cooking a Rush in the kitchen they cook in: that keeps its body meanwhile)
      for (const h of this.busy) if (h.watch?.(a, o, L)) return;
      if (L.car) {
        // (its player in another car than the one it is riding in: out of that one first, then in with them as anyone would)
        if (a.ride && a.ride.vid !== L.car.id) { brain.alight(a, L.car.x, L.car.z); a.rideAt = null; this.stats.alighted++; this.syncSeats(); }
        if (a.ride) { if (!a.rideAt || Math.hypot(L.car.x - a.rideAt.x, L.car.z - a.rideAt.z) > 1) { a.rideAt = { x: L.car.x, z: L.car.z }; brain.reorder(a, true); this.stats.replans++; } return; }
        const e = evalPlan(a.plan, sim.now());
        if (e.ctx === CTX_OUT && Math.hypot(e.x - L.car.x, e.z - L.car.z) <= BOARD_M && this.freeSeats(L.car.id) > 0 && this.getIn(a, L.car.id)) { a.rideAt = { x: L.car.x, z: L.car.z }; this.remark(a.i, `I just got into ${L.name}'s car with them; we're driving off together.`); return; }
      } else if (a.ride) { const p = this.players.byId.get(o.lead.id); brain.alight(a, p ? p.x : L.x, p ? p.z : L.z); a.rideAt = null; this.stats.alighted++; this.syncSeats(); this.remark(a.i, `${L.name} just parked and we got out of the car${sim.nav?.addressAt ? ` at ${sim.nav.addressAt(L.x, L.z)}` : ''}.`); return; }
      if (this.seatWatch(a, o, L)) return;
      this.autoSeat(a, o, L, now);
      if (!o.seat) this.keepUp(a, L);
      return;
    }
    if (o.lead?.kind === 'person') {
      const L = brain.leadAt(a, o, sim.now());
      if (!L) { this.end(a, o, 'leader_gone'); return; }
      if (this.seatWatch(a, o, L)) return;
      this.autoSeat(a, o, L, now);
      if (!o.seat) this.keepUp(a, L);
    }
  }
  /** Re-plans a follower whose leader has moved away from where it last planned to stand. */
  keepUp(a, L) {
    const f = a.fspot;
    if (f && f.lctx === L.ctx) {
      // where its last plan expected the leader to be by now (a moving leader: on along its way); far behind (a long way
      // round, a ride across town): re-planned only when the leader has gone a good part of that distance again
      // (f.at: when its round starts — planned ahead of time, it may not have started yet: then the leader isn't there yet)
      const now = this.sim.now(), dt = Math.min(2.5, Math.max(-4, now - (f.at ?? now)));
      const ex = f.lx + (f.lvx || 0) * dt, ez = f.lz + (f.lvz || 0) * dt;
      const e = evalPlan(a.plan, now), apart = Math.hypot(e.x - L.x, e.z - L.z);
      const stopped = (f.lvx || f.lvz) && !L.moving && apart < 12;   // (it stopped: so do they, beside it)
      // (close by, it reacts to a step or two; far behind, to a good part of the distance between them)
      if (!stopped && Math.hypot(L.x - ex, L.z - ez) < (apart < 6 ? MOVED_NEAR_M : Math.max(MOVED_M, apart * 0.15))) return;
    }
    this.sim.brain.reorder(a);
    this.stats.replans++;
  }
  end(a, o, why) {
    const sim = this.sim;
    if (a.ride) { const e = evalPlan(a.plan, sim.now()); sim.brain.alight(a, e.x, e.z); }
    a.ride = null;
    this.syncSeats();
    this.remember(a, why);
    a.orderEnded = { kind: o.kind, who: null, why, at: sim.now(), by: o.by ?? null, lead: o.leadName || null };
    sim.brain.setOrder(a, null);
    a.ride = null;
    sim.brain.interruptSoon(a);
  }

  // ------------------------------------------------------------------------------------------------ views
  /** One companion as its owner's pages show it. */
  view(a) {
    if (!a?.order) return null;
    const o = a.order, sim = this.sim, rec = this.agentRecOf(a.i);
    if (!rec) return null;
    // (stopped to talk with its leader face to face — its owner talking with it in person: still with them, not stepped away)
    const act = a.act, talking = !!act && act.kind === 'talk' && o.lead?.kind === 'player' && act.withPlayer === o.lead.id;
    // (sitting with its leader — or on its way to the seat: with them, its meal too)
    // (a decoration's seat outdoors: its id as dec, b, f, id −1 — server/sim/decor-seats.js)
    const s = o.seat, onSeat = !!s && !!act && act.b === s.b && act.f === s.f && act.id === s.id && act.k === s.k && act.dec === s.dec, now = sim.now();
    // (seated: its body staying on that seat now, as its plan has it — not on its way there; the next round's act may be
    // planned a moment before this one ends)
    const e0 = onSeat && a.plan ? evalPlan(a.plan, now) : null;
    const at = !!e0?.s?.h && Math.hypot(e0.x - s.x, e0.z - s.z) < 0.4;
    // (using something beside its leader — a cabinet, the dance floor, the piano: not a seat, whatever its pose)
    const using = at && s.mode === 'use';
    const seated = at && !using && SEATED.has(e0.s.anim), eating = seated && (act.use === 'eat' || act.use === 'bar');
    const away = act && act.kind !== 'follow' && !talking && !onSeat && (o.kind === 'follow' || o.kind === 'hold');
    let leader = null, L = null;
    if (o.lead?.kind === 'player') { L = this.playerLead(o.lead.id, a); leader = { kind: 'player', id: o.lead.id, name: o.lead.id === o.by ? (o.byName || 'you') : L?.name || 'a player', away: !!L?.gone, parked: !!L?.waiting }; }
    else if (o.lead?.kind === 'person') { const p = sim.people[o.lead.i], lr = this.agentRecOf(o.lead.i); leader = { kind: 'agent', i: o.lead.i, name: p?.name || '', agent: lr?.id ?? null }; }
    const state = a.ride ? 'riding' : o.kind === 'follow' ? (away ? 'away' : L?.gone || L?.waiting ? 'waiting' : 'following') : o.kind === 'hold' ? (o.group ? 'meetup' : 'waiting') : 'going';
    const e = a.plan ? evalPlan(a.plan, sim.now()) : null;
    // (a follower still on its way to its leader — out of a building, across the street: "on the way", not "with you")
    const Lp = o.kind === 'follow' && !a.ride && !away && e ? (L || (o.lead?.kind === 'person' ? sim.brain.leadAt(a, o, sim.now()) : null)) : null;
    const coming = !!Lp && !onSeat && (!sim.brain.sameSpace(e.ctx, Lp.ctx) || Math.hypot(e.x - Lp.x, e.z - Lp.z) > COMING_M);
    const mates = o.group ? this.groupMembers(o.group).filter(j => j !== a.i).map(j => sim.people[j]?.name).filter(Boolean) : [];
    // (its seat in words: "Sitting with you on a bench", "Eating with you at «Restaurant 16»" — you: the one who asked)
    const you = o.lead?.kind === 'player' && o.lead.id === o.by ? 'you' : leader?.name || 'them';
    // (an arcade game it is playing: what, its score — server/play/arcade-crew.js)
    let arcade = null; try { arcade = this.playing?.view?.(rec.id) || null; } catch { arcade = null; }
    if (arcade && !arcade.phase) arcade = null;
    const sitting = seated ? (eating ? `${s.meal?.kind === 'bar' ? 'Having a drink' : 'Eating'} with ${you} at ${s.venue?.name ? `«${s.venue.name}»` : s.words}` : `Sitting with ${you} ${s.use === 'eat' ? 'at' : 'on'} ${s.words}`) : null;
    return {
      agent: rec.id, i: a.i, name: rec.name, emoji: rec.emoji || '', kind: o.kind, state, coming, talking, leader, group: o.group || null, goal: o.goal || null, with: mates,
      place: o.spot?.place || (o.venue ? sim.brain.placeName(o.venue.b, o.venue.f) : null) || act?.place || null,
      // (a talk's own words are the one it talks with's — "Talking with you" —: someone else walked up, it says who)
      doing: arcade?.doing || sitting || (act?.kind === 'talk' && !talking && act.withName ? `Talking with ${act.withName}` : act?.label || ''), icon: act?.icon || '', by: o.by ?? null, via: o.via || null, since: o.at ? Math.round((sim.now() - o.at) * 1000) : 0,
      // (sitting with its leader: on what, since when (ms seated), eating or not — the Companions bar and the senses)
      seat: seated ? { words: s.words, use: s.use, item: s.item, since: Math.max(0, Math.round((now - (s.since || now)) * 1000)), mode: s.mode, eating, auto: !!s.auto, venue: s.venue || null } : null,
      // (using something beside its leader: what, where, what it is doing there — "Playing arcade", the senses' too)
      using: using ? { words: s.words, use: s.useName, item: s.item, label: act?.label || '', since: Math.max(0, Math.round((now - (s.since || now)) * 1000)), venue: s.venue || null, paid: s.paid ? { total: s.paid.total } : null } : null,
      pos: e ? { x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10, ctx: e.ctx } : null,
      ...(a.ride?.boat && !a.ride.leaving ? { boat: a.ride.use === 'fish' ? 'fishing' : 'aboard' } : {}),   // (aboard its leader's boat, fishing or not: server/play/fishing-crew.js)
      ...(arcade ? { arcade: { playing: arcade.playing, game: arcade.game, title: arcade.title, icon: arcade.icon, score: arcade.score } } : {}),   // (an arcade game: server/play/arcade-crew.js)
      ...(() => { for (const h of this.busy) { try { const b = h.busyWith?.(a); if (b) return { busy: b }; } catch { /* a module's trouble isn't the view's */ } } return {}; })(),   // (busy at a play module: what, in words)
      // (in its owner's aircraft, or flying a ring course itself: server/play/flight-crew.js view)
      ...(() => { try { const air = this.flight?.view?.(rec.id); return air ? { air } : {}; } catch { return {}; } })(),
      // (its shift now, if it has one: out with you while it should be at work — server/workplace/presence.js)
      work: (() => { try { const w = this.workOf?.(a.i); return w && w.onShift ? { state: w.state, text: w.text, place: w.place, role: w.role } : null; } catch { return null; } })(),
    };
  }
  /** P's companions — its own and managed agents with an order from a person or with someone — and the limits. */
  list(P) {
    const out = [];
    for (const { a } of this.live()) {
      const rec = this.agentRecOf(a.i);
      if (!rec || !this.mayCommand(P, rec)) continue;
      const v = this.view(a);
      if (v) out.push(v);
    }
    out.sort((x, y) => x.name.localeCompare(y.name));
    const me = P?.account?.id;
    return { companions: out, max: this.config().maxPerPlayer, following: out.filter(c => c.kind === 'follow' && c.leader?.kind === 'player' && c.leader.id === me).length, enabled: this.config().enabled };
  }
  /** Sends each online account with companions its list when it changed (its pages' Companions panel). */
  push() {
    const ids = new Set();
    for (const { a, o } of this.live()) { const rec = this.agentRecOf(a.i); if (rec?.ownerId !== null && rec?.ownerId !== undefined) ids.add(rec.ownerId); if (o.by !== null && o.by !== undefined) ids.add(o.by); }
    for (const id of this.sent.keys()) ids.add(id);
    for (const id of ids) {
      if (!this.players.byId.has(id)) continue;
      const P = this.principalFor?.(id);
      if (!P) continue;
      const l = this.list(P), j = JSON.stringify(l.companions.map(c => [c.agent, c.state, c.kind, c.leader?.name, c.place, c.doing, c.group, c.seat?.words || null, c.using?.use || null]));
      if (this.sent.get(id) === j) continue;
      this.sent.set(id, j);
      try { this.send(id, { t: 'companions', ...l }); } catch { /* the page asks again */ }
    }
  }
}
