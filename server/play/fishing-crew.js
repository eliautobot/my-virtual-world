// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions out fishing with their owner (docs/features/fishing.md §Companions aboard; 2026-11-17, the product owner: "I noticed that if
// I went fishing they don't come with me as companions" — companions are AI agent players: they use what a player uses,
// with real effects, seen, chosen by their Free Will). The first play module open to agents, through the interaction
// registry (server/interactions/registry.js): the source `fishing` here is the pattern every later module follows.
//
// - Aboard: a companion following its owner gets on the boat its owner takes (as it gets into its owner's car): beside the
//   boat it steps straight aboard; on the dock's grounds it walks down the pier, the gangway and the float to the slip
//   first (the sim's own walk: everyone sees it go). Each takes a fishing spot of its own on the deck (the boat's anglers:
//   four on the coastal boat, two on the skiff, the skipper one of them) — none free, it stays ashore and says so. Aboard,
//   its body is hidden in the simulation (as in a car: a.ride, carried along at its spot) and every page draws it at that
//   spot on the boat (client render/boat-crew.js, from the harbour's crew rows: server/world/boats.js).
// - Fishing: while its owner is on a trip (the play core's fishing run), it fishes too — when asked (a command, its
//   brain), when its Free Will picks the registry's 'fish', or, without Free Will, it simply joins in. Its trip is a
//   real run of the fishing module of its own (the play core, as minus its id), going along on its owner's: the same
//   grounds (the owner's seed), the same clock (the run's start: hour, dusk, freshness), its own kit (server/play/
//   angler.js: what it holds, else the dock lends the starter's rod and bait). It casts from its spot out over the side it
//   faces; the ground the lure lands on is the trip's (shared/fishing-trip.js groundAt), the wait for a bite the module's
//   own pacing (biteEvery, by the ground, the lure and the hour), the bite the server's roll (act hook), the fight the
//   module's fight played by a hand as good as its fishing level (shared/fishing-fight.js botInput) in real time, and the
//   landing the server's check (act land: no sooner than that gear could win it). Never faster than a person: a cast
//   cycle of at least MIN_CYCLE_MS from one hook to the next.
// - Seen and said: casting, waiting, reeling, fighting, netting (the crew rows' phases → the fishing clips with the rod);
//   a catch in a bubble over its head, on its owner's page as the module's own catch toast ("Lara landed a 2.3 kg Red
//   Snapper!"), and in its diary (the play core's own lines for its run: server/senses/play-activities.js).
// - Its own: the trip ends with its owner's (or when it gets off): weighed in as any angler's (score, half the experience
//   as any unattended run — server/play/play.js AUTO_XP —, its fishing level, badges, the Fishdex), the catch into its own
//   inventory (server/play/fish-market.js stow), the bait it used out of it, and sold at the dock's store when it gets off
//   there, paid into its own wallet from the economy's Fish market. Its fun need rises while it fishes (shared/catalog.js
//   USES.fish).
// - Off: its owner leaves the boat — at a dock it walks back up the pier with them; on a shore it steps off beside them —
//   the rod is put away and it follows again.
// Nothing here draws a simulation random number (its dice are its own: RNG by agent and trip).
import { evalPlan } from '../sim/plan.js';
import { A } from '../../shared/anims.js';
import { USE_ID, USES } from '../../shared/catalog.js';
import { F_SNAP, CTX_OUT } from '../../shared/proto.js';
import { BOATS } from '../../shared/boat-model.js';
import { DOCKS, dockDecks, deckTop } from '../../shared/dock-layout.js';
import { toWorldAt, toFrame } from '../../shared/airport-layout.js';
import { modulesOf } from '../../shared/world-modules.js';
import { TRIP_BY_ID, groundAt, biteEvery } from '../../shared/fishing-trip.js';
import { kitFor, hourAt, AFTER_DUSK_MIN } from '../../shared/fishing.js';
import { luresFor, LURE_BY_ID } from '../../shared/fishing-gear.js';
import { speciesOf, findOf, RARITY, valueOf } from '../../shared/fish-species.js';
import { fightSetup, fightStep, botInput, minFightSeconds, FIGHT_DT, MAX_FIGHT_S } from '../../shared/fishing-fight.js';
import { moduleLevel } from '../../shared/play.js';
import { RNG } from '../../shared/rng.js';
import { dockRoute, dockRouteUp, dockPoints } from '../sim/dock-walk.js';
import { REACH, FIGHT, THINK_MS, lureChoices, habit, due, request, readAnswers, narration, planWords, groundsByReach } from './fishing-tactics.js';

export const TICK_MS = 500;
export const MIN_CYCLE_MS = 15000;   // the least time from one hook to the next (a person: cast, wait, fight or reel in, unhook)
export const CAST_MS = 2200;         // the rod coming over and the lure flying out
export const MIN_WAIT_MS = 6000;     // the least wait for a bite after the lure lands
export const MAX_WAIT_MS = 120000;   // the longest wait for a bite (shared/fishing-trip.js biteEvery's own cap)
export const REEL_IN_MS = 3500;      // reeling an empty line in
export const NET_MS = 1800;          // netting a beaten fish
export const SHOW_MS = 3500;         // looking at the catch, unhooking it, into the cooler
export const JOIN_MS = 4000;         // everyone aboard starts fishing this long after its owner's trip begins
export const CREW_TELL_MS = 2000;    // the crew's tallies to the skipper's pages at most this often…
export const CREW_TELL_FULL_MS = 15000;   // …and at least this often while the trip is on
export const SESSION_KEEP_MS = 30 * 60e3;   // a session's results kept this long (its owner's choice of the catch)
const BOARD_NEAR_M = 14;             // m from the boat: it steps straight aboard
const BOARD_DOCK_M = 160;            // m from the boat at its dock: it walks down the pier to it
const LEFT_SLIP_M = 30;              // m: a boat this far from its slip has left (one still on its way down stays ashore)
const STOP = 1.5;                    // m/s: slow enough to step aboard
const PIER_SPEED = 3.4;              // m/s: a brisk walk down the pier (a jog when the boat waits)
const KEEN_MS = 30 * 60e3;          // a yes to fishing given on the shore holds this long (its owner may take a while to get a boat)
const FISH_SPEED = 2.5;              // m/s: the boat slower than this (drifting, at anchor, idling): it fishes; faster, the rod waits
const U = USE_ID;
const clean = (s, n = 60) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const an = w => (/^[aeiou]/i.test(w) ? 'an' : 'a');
/** A fish's weight in words: "2.3 kg" (two decimals under a kilo). */
export const kgWords = kg => `${kg < 1 ? kg.toFixed(2) : kg < 100 ? kg.toFixed(1) : Math.round(kg)} kg`;
/** The phases of a companion fishing, as the pages draw them (render/boat-crew.js): their index in the crew rows. */
/** A trip's `where` made by the server for a run along another's (a crew member's on their skipper's trip): its dock and
 *  seed are that trip's — a key no page's request can carry (server/index.mjs fishingContext). */
export const ALONG = Symbol('fishing-along');
export const PHASES = Object.freeze(['aboard', 'ready', 'cast', 'wait', 'reel', 'fight', 'net', 'show', 'rest']);

export class FishingCrew {
  /**
   * @param {object} o
   * @param {object} o.play            server/play/play.js PlayCore
   * @param {() => object} o.harbour   server/world/boats.js Harbour
   * @param {object} o.players         server/world/players.js Players
   * @param {() => object} o.sim       the running Sim
   * @param {object} o.agents          the agent registry (byKey, get)
   * @param {() => object} o.companions server/companions/companions.js (decides, remark)
   * @param {() => object} o.world     the world (its docks)
   * @param {object} [o.angler]        server/play/angler.js (after a trip: bait used, the Fishdex)
   * @param {object} [o.market]        server/play/fish-market.js (the catch into the inventory, the sale)
   * @param {() => object} [o.freeWill] server/free-will/free-will.js (decideNow: how each companion fishes — ./fishing-tactics.js)
   * @param {(i, text) => void} [o.say]            a line in a bubble over body i (not voiced)
   * @param {(accountId, frame) => void} [o.toAccount] a frame to an account's pages
   * @param {(agentId, kind, text, o) => void} [o.note] a line in an agent's diary (server/senses/ note)
   */
  constructor({ play, harbour, players, sim, agents, companions = () => null, world = () => null, angler = null, market = null, freeWill = () => null, say = () => {}, toAccount = () => {}, note = () => {}, now = () => Date.now(), log = null }) {
    Object.assign(this, { play, harbourOf: harbour, players, simOf: sim, agents, companionsOf: companions, worldOf: world, angler, market, freeWillOf: freeWill, say, toAccount, note, now, log });
    this.crew = new Map();      // agent id → its member: { agent, i, name, owner, boat, spot, phase, … }
    this.sales = new Map();     // agent id → { at (ms), module, i, owner }: its catch to sell once it is ashore at the dock
    this.keen = new Map();      // agent id → ms: it said yes to fishing before its owner had a boat (it fishes once aboard and the trip is on)
    this.sessions = new Map();  // its owner's trip (run id) → { run, owner, at, crew: agent id → its result, decided, players }: the session's results
    this.told = new Map();      // session (root run) → { key, at }: everyone's tallies last told the players' pages
    this.wantBait = new Map();  // agent id → ms: asked to buy bait away from a store — it buys at the next one it is at
    this.invited = new Map();   // account → the trip (root run) its page was asked to join (fish_join)
    this.afterFinish = null;    // (account, result) → the after-math of a player's run the server ended (set by the server: the catch stowed)
    this.ver = 0;               // crew rows changed (the harbour sends them again)
    this.timer = null;
    this.stats = { boarded: 0, walked: 0, missed: 0, alighted: 0, trips: 0, hooks: 0, landed: 0, lost: 0, sold: 0, refused: 0, thought: 0, answered: 0 };
  }
  get sim() { return this.simOf(); }
  get harbour() { return this.harbourOf(); }
  attach() {
    this.timer = setInterval(() => { try { this.tick(); } catch (e) { this.log?.warn?.('[fishing-crew] tick failed:', e.stack || e.message); } }, TICK_MS); this.timer.unref?.();
    this.off = this.play?.on?.(ev => { try { this.onPlay(ev); } catch (e) { this.log?.warn?.('[fishing-crew] after a trip:', e.message); } }) || null;   // (a player's trip finished: its crew's with it)
    return this;
  }
  stop() { clearInterval(this.timer); this.timer = null; this.off?.(); this.off = null; }
  changed() { this.ver++; const H = this.harbour; if (H) H.ver++; }

  // ------------------------------------------------------------------------------------------------ who, where
  recOf(i) { const p = this.sim?.people[i]; return p?.vip && p.agentId ? this.agents.byKey(p.agentId) : null; }
  nameOf(account) { return clean(this.players.byId.get(account)?.name || 'your owner', 40); }
  /** The boat player `id` is on — at its helm, or aboard as one of its crew — or null. */
  boatOfLead(id) { const H = this.harbour; return H ? (H.boatOf ? H.boatOf(id) : H.bySkipper.get(id)) || null : null; }
  /** The dock module a boat belongs to (its slips'), or null. */
  dockOf(b) { return modulesOf(this.worldOf()).find(m => m.id === b.module && DOCKS[m.kind]) || null; }
  /** Where spot k of boat b is in the world now: { x, y, z, yaw } (yaw: the way it faces, out over the side). */
  spotAt(b, k) {
    const S = BOATS[b.type], sp = S.deck.spots[k] || S.deck.spots[0], p = this.harbour.place(b), c = Math.cos(p.h), s = Math.sin(p.h);
    return { x: p.x + sp.x * c + sp.z * s, y: p.y + sp.y, z: p.z - sp.x * s + sp.z * c, yaw: p.h + sp.yaw };
  }
  /** The fishing spots of boat b taken now (by its crew, and the one its skipper stands at). */
  takenOn(b, but = null) {
    const S = BOATS[b.type], out = new Set();
    for (const m of this.crew.values()) if (m.boat === b.id && m.agent !== but) out.add(m.spot);
    const at = this.harbour.place(b), c = Math.cos(at.h), s = Math.sin(at.h);
    // (the skipper and the crew of players on deck, at or near a spot: theirs)
    for (const id of this.harbour.playersOn?.(b) || (b.skipper != null ? [b.skipper] : [])) {
      const p = this.players.byId.get(id);
      if (!p) continue;
      const dx = p.x - at.x, dz = p.z - at.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
      S.deck.spots.forEach((sp, k) => { if (Math.hypot(sp.x - lx, sp.z - lz) < 0.9) out.add(k); });
    }
    return out;
  }
  /** Places for anglers on boat b besides its players' (BOATS anglers), less the companions aboard. */
  freePlaces(b) { const players = this.harbour?.playersOn?.(b)?.length || 1; return Math.max(0, BOATS[b.type].anglers - players - this.countOn(b.id)); }
  freeSpot(b, but = null) {
    const S = BOATS[b.type], taken = this.takenOn(b, but);
    // (the bow and the sides first, the stern last: the skipper comes and goes from the wheel at the stern side)
    const order = S.deck.spots.map((sp, k) => k).sort((x, y) => (S.deck.spots[x].name === 'stern') - (S.deck.spots[y].name === 'stern'));
    return order.find(k => !taken.has(k)) ?? -1;
  }
  /** Where agent id's body fishes from (its spot on the boat), for the play core's check of the ground it claims. */
  whereIs(agentId) { const m = this.crew.get(Number(agentId)), b = m && this.harbour?.all.get(m.boat); return b ? this.spotAt(b, m.spot) : null; }

  // ------------------------------------------------------------------------------------------------ the dock's ways
  /** The way down a dock to its slip at f (dock frame: s up the land, f across) — the quay at the pier's root, along the
   *  pier to the gangway, down it on to the float, along the float to beside the slip: [[s, f]]. */
  static route(kind, f) { return dockRoute(kind, f); }
  /** The way back up from a point on dock m's decks to its quay: [[s, f]] (dock frame) — server/sim/dock-walk.js. */
  static routeUp(m, x, z) { return dockRouteUp(m, x, z); }
  /** World points with heights on dock m's decks (the land's level off them) for dock-frame points [[s, f]]. */
  pointsOn(m, sf) { return dockPoints(m, sf); }

  // ------------------------------------------------------------------------------------------------ the companions' hook
  /**
   * One follower of a player looked at (server/companions/ watch, twice a second): aboard — carried along at its spot,
   * off again with its owner; its owner on a boat — aboard too when it can. → true when this took care of it.
   */
  watch(a, o, L) {
    const H = this.harbour;
    if (!H || !a?.plan || o?.lead?.kind !== 'player') return false;
    const rec = this.recOf(a.i);
    if (!rec) return false;
    const lead = o.lead.id;
    L = { ...(L || {}), id: lead };   // (who it follows: the skipper, or one of the boat's crew of players)
    if (a.ride?.boat) {
      const b = H.all.get(a.ride.boat), m = this.crew.get(rec.id);
      if (a.ride.leaving) { this.leaving(a); return true; }
      if (b && this.boatOfLead(lead) === b) { this.carry(a, rec, b, m, L); return true; }   // (its owner aboard: at the helm, or one of the crew)
      this.getOff(a, rec, m, b, L);
      return true;
    }
    const b = this.boatOfLead(lead);
    if (!b) return false;
    return this.tryBoard(a, rec, b, L).ok;
  }
  /** Gets on boat b (its owner at the helm) when it can now: → { ok, why, text }. */
  tryBoard(a, rec, b, L) {
    const sim = this.sim, H = this.harbour, e = evalPlan(a.plan, sim.now()), at = H.place(b);
    const owner = L?.name || this.nameOf(Number.isInteger(L?.id) ? L.id : b.skipper), boat = BOATS[b.type].label;
    if (e.ctx !== CTX_OUT) return { ok: false, why: 'far', text: `${rec.name} is indoors — not near the boat` };
    if (Math.abs(at.v || 0) > STOP) return { ok: false, why: 'under_way', text: `${owner}'s boat is under way — it can't get on now` };
    const d = Math.hypot(e.x - at.x, e.z - at.z), dock = this.dockOf(b);
    const atSlip = dock && Math.hypot(at.x - b.home.x, at.z - b.home.z) < LEFT_SLIP_M;
    if (d > BOARD_NEAR_M && !(atSlip && d <= BOARD_DOCK_M)) return { ok: false, why: 'far', text: `${rec.name} is too far from ${owner}'s boat (${Math.round(d)} m)` };
    if (!this.freePlaces(b) || this.freeSpot(b) < 0) {
      const k = `${rec.id}:${b.id}:${b.at}`;
      if (this.fullSaid !== k) { this.fullSaid = k; this.note(rec.id, 'move', `${owner}'s ${boat} is full (${BOATS[b.type].anglers} anglers) — you stayed on the dock`, { key: 'boat' }); this.stats.refused++; }
      return { ok: false, why: 'full', text: `${owner}'s ${boat} is full: it takes ${BOATS[b.type].anglers} anglers` };
    }
    this.board(a, rec, b, owner, d > BOARD_NEAR_M ? { dock, from: e } : null, { lead: Number.isInteger(L?.id) ? L.id : Number.isInteger(L?.account) ? L.account : b.skipper });
    return { ok: true, why: null, text: d > BOARD_NEAR_M ? `${rec.name} is walking down to ${owner}'s boat` : `${rec.name} got on ${owner}'s boat` };
  }
  /** Aboard boat b: its spot taken, its body hidden there (walking down the dock to it first, when `walk`). o.spot: the spot
   *  it had (back aboard after a restart: its own again when free); o.quiet: no word about it (it was aboard already). */
  board(a, rec, b, owner, walk = null, o = {}) {
    const sim = this.sim, brain = sim.brain, want = Number.isInteger(o.spot) && BOATS[b.type].deck.spots[o.spot] && !this.takenOn(b, rec.id).has(o.spot) ? o.spot : -1;
    const spot = want >= 0 ? want : this.freeSpot(b), sp = BOATS[b.type].deck.spots[spot], at = this.spotAt(b, spot);
    a.ride = { vid: `boat:${b.id}`, boat: b.id, at: sim.now(), label: `On ${owner}'s boat`, icon: '🚤', use: 'commute', x: at.x, y: at.y, z: at.z, yaw: at.yaw };
    a.detour = null; a.attend = null;
    const lead = Number.isInteger(o.lead) ? o.lead : b.skipper;
    const m = { agent: rec.id, i: a.i, name: clean(rec.name, 40), owner: lead, boat: b.id, spot, phase: 'aboard', seq: 1, until: 0, fishing: false, why: null, declined: false,
      run: null, tripSeen: null, hook: null, lure: null, ground: null, d0: 0, lastHook: -1e9, rng: new RNG(`crew:${rec.id}:${b.id}:${this.now()}`), landed: 0, lost: 0, best: null, cx: at.x, cz: at.z, rideKey: '' };
    // (it said yes to fishing on the shore a while ago: it fishes as soon as the trip is on)
    const keen = this.keen.get(rec.id);
    if (keen && this.now() - keen < KEEN_MS) m.wants = true;
    this.keen.delete(rec.id);
    this.crew.set(rec.id, m);
    this.stats.boarded++;
    if (walk) {
      // down the dock: from where it stands to the pier's root by the city's ways, then down the pier, the gangway and the
      // float to the slip — then aboard (its next round hides it at its spot: server/sim/companion-moves.js rideStep)
      const P = brain.cut(a, sim.now(), true), slip = toFrame(walk.dock, b.home.x, b.home.z), pts = this.pointsOn(walk.dock, FishingCrew.route(walk.dock.kind, slip.f)), q = pts[0];
      const far = Math.hypot(q.x - P.x, q.z - P.z);
      if (far > 1.5) brain.goToward(a, P, { ctx: CTX_OUT, x: q.x, z: q.z }, far);
      for (const p of pts) P.move(p.x, p.y, p.z, PIER_SPEED, A.jog, U.walk, { ctx: CTX_OUT });
      P.move(at.x, at.y, at.z, 1.4, A.walk, U.walk, { ctx: CTX_OUT });   // (a step across on to the deck)
      brain.act(a, 'follow', 'walk', P, { ctx: CTX_OUT, label: `Going down to ${owner}'s boat`, icon: '🚤', place: walk.dock.name || 'the dock', arrive: P.t, holdStart: P.t, holdEnd: P.t });
      sim.commit(a, P);
      a.ride.until = P.t;
      this.stats.walked++;
      this.toAccount(lead, { t: 'crew_note', agent: rec.id, i: a.i, text: `${m.name} is coming down the pier to the boat — give them a moment` });
    } else brain.reorder(a, true);
    if (o.quiet) this.note(rec.id, 'move', `Back aboard ${owner}'s ${BOATS[b.type].label} at the ${sp.name}, where you were before the city's restart`, { key: 'boat' });
    else {
      this.note(rec.id, 'move', `Got into ${owner}'s boat, the ${BOATS[b.type].label} — fishing from the ${sp.name}`, { key: 'boat' });
      this.remark(a.i, `I just got on ${owner}'s boat with them, the ${BOATS[b.type].label}${this.play.runOf(lead)?.module === 'fishing' ? ' — they are on a fishing trip' : ''}.`);
    }
    this.changed();
  }
  /** The companions aboard boat id (not those still walking down to it or getting off), to keep across a restart: [{ agent, spot }]. */
  crewOn(id) {
    const out = [], sim = this.sim;
    for (const m of this.crew.values()) {
      if (m.boat !== id) continue;
      const a = sim?.agents[m.i];
      if (!a?.ride?.boat || a.ride.leaving || (a.ride.until && sim.now() < a.ride.until)) continue;
      out.push({ agent: m.agent, spot: m.spot, owner: m.owner });
    }
    return out;
  }
  /** How many companions are aboard boat id (walking down to it too): the deck's room is shared with its players. */
  countOn(id) { let n = 0; for (const m of this.crew.values()) if (m.boat === id) n++; return n; }
  /**
   * Boat b's skipper is back after a restart (server/world/boats.js resume): the companions that were aboard it — still out
   * with them — back at their spots at once, as they were (2026-11-19: the restart dropped Lara and Sam in the sea). → how many.
   */
  resumeCrew(b, list) {
    const sim = this.sim, C = this.companionsOf();
    if (!sim || !C || !b || b.skipper == null || !Array.isArray(list)) return 0;
    let n = 0;
    for (const { agent, spot, owner } of list) {
      try {
        const rec = this.agents.get(agent);
        if (!rec || this.crew.has(rec.id)) continue;
        let body = null; try { body = C.bodyOf(rec.id); } catch { body = null; }
        const a = body ? sim.agents[body.i] : null, o = a?.plan ? sim.brain.liveOrder(a, sim.now()) : null;
        const lead = Number.isInteger(owner) ? owner : b.skipper;
        if (!o || o.kind !== 'follow' || o.lead?.kind !== 'player' || o.lead.id !== lead) continue;   // (let go meanwhile)
        if (!this.freePlaces(b)) break;
        if (o.seat) sim.brain.seatEnd(a, o, 'leader');
        a.ride = null;
        this.board(a, rec, b, this.nameOf(lead), null, { spot, quiet: true, lead });
        n++;
      } catch (e) { this.log?.warn?.('[fishing-crew] back aboard after a restart:', e.message); }
    }
    if (n) this.log?.info?.(`[fishing-crew] after the restart: ${n} companion(s) back aboard ${this.nameOf(b.skipper)}'s boat`);
    return n;
  }
  /** Aboard and its owner at the helm: carried along at its spot (re-planned when the boat has moved on a metre). */
  carry(a, rec, b, m, L) {
    const sim = this.sim, H = this.harbour;
    if (!m) {   // (aboard without a place here — a restart of this part: one again)
      const spot = this.freeSpot(b);
      if (spot < 0) { this.getOff(a, rec, null, b, L); return; }
      this.crew.set(rec.id, m = { agent: rec.id, i: a.i, name: clean(rec.name, 40), owner: Number.isInteger(L?.id) ? L.id : b.skipper, boat: b.id, spot, phase: 'aboard', seq: 1, until: 0, fishing: false, why: null, declined: false,
        run: null, tripSeen: null, hook: null, lure: null, ground: null, d0: 0, lastHook: -1e9, rng: new RNG(`crew:${rec.id}:${b.id}:${this.now()}`), landed: 0, lost: 0, best: null, cx: 0, cz: 0, rideKey: '' });
      this.changed();
    }
    // still on its way down the pier: the boat gone meanwhile — it missed it, and stays ashore
    if (a.ride.until && sim.now() < a.ride.until) {
      const at = H.place(b);
      if (Math.hypot(at.x - b.home.x, at.z - b.home.z) > LEFT_SLIP_M || Math.abs(at.v || 0) > STOP * 2) {
        this.crew.delete(rec.id); a.ride = null; sim.brain.reorder(a, true); this.stats.missed++; this.changed();
        this.note(rec.id, 'move', `${L?.name || this.nameOf(m.owner)}'s boat left before you got down to it — you stayed on the dock`, { key: 'boat' });
        this.toAccount(m.owner, { t: 'crew_note', agent: rec.id, i: a.i, text: `${m.name} didn't make it on board — the boat left` });
      }
      return;
    }
    // its spot: the skipper walked to it — another one free
    if (this.takenOn(b, rec.id).has(m.spot)) { const k = this.freeSpot(b, rec.id); if (k >= 0 && k !== m.spot) { m.spot = k; this.changed(); } }
    const at = this.spotAt(b, m.spot), owner = L?.name || this.nameOf(m.owner), spot = BOATS[b.type].deck.spots[m.spot].name;
    const use = m.fishing ? 'fish' : 'commute', label = m.fishing ? `Fishing from the ${spot} of ${owner}'s boat` : `On ${owner}'s boat`;
    Object.assign(a.ride, { x: at.x, y: at.y, z: at.z, yaw: at.yaw, use, label, icon: m.fishing ? '🎣' : '🚤' });
    if (Math.hypot(at.x - m.cx, at.z - m.cz) > 1 || m.rideKey !== `${use}|${label}`) { m.cx = at.x; m.cz = at.z; m.rideKey = `${use}|${label}`; sim.brain.reorder(a, true); }
  }
  /** Its owner left the boat: the rod away, the trip weighed in, and off with them — up the dock's pier at a dock, beside
   *  them on a shore. */
  getOff(a, rec, m, b, L) {
    const sim = this.sim, brain = sim.brain, p = this.players.byId.get(m?.owner ?? L?.id), owner = L?.name || (m ? this.nameOf(m.owner) : 'your owner');
    if (m) { this.endTrip(m, 'off'); this.crew.delete(rec.id); }
    const at = p ? { x: p.x, y: p.y, z: p.z } : b ? this.harbour.besideSlip(b) : { x: L?.x ?? evalPlan(a.plan, sim.now()).x, y: 0, z: L?.z ?? evalPlan(a.plan, sim.now()).z };
    const dock = modulesOf(this.worldOf()).find(x => DOCKS[x.kind] && dockDecks(x).some(D => deckTop(D, at.x, at.z, 0.5) !== null)) || null;
    this.stats.alighted++;
    if (dock) {
      // on a dock's deck: up the float, the gangway and the pier to the quay (a breath there, then it follows again)
      const from = b ? this.spotAt(b, m?.spot ?? 0) : at, pts = this.pointsOn(dock, FishingCrew.routeUp(dock, at.x, at.z));
      const P = brain.cut(a, sim.now(), true);
      P.seg(0.05, from.x, from.y ?? at.y, from.z, from.yaw ?? P.yaw, A.idle, U.idle, 0, F_SNAP, CTX_OUT);
      P.move(at.x, at.y, at.z, 1.4, A.walk, U.walk, { ctx: CTX_OUT });
      for (const q of pts) P.move(q.x, q.y, q.z, PIER_SPEED * 0.8, A.walk, U.walk, { ctx: CTX_OUT });
      brain.act(a, 'follow', 'walk', P, { ctx: CTX_OUT, label: `Walking up the dock with ${owner}`, icon: '🚤', place: dock.name || 'the dock', arrive: P.t, holdStart: P.t, holdEnd: P.t });
      const end = P.t;
      P.hold(3, A.idle, U.wait, 0, P.yaw);
      sim.commit(a, P);
      a.ride = { vid: a.ride?.vid || 'boat', boat: a.ride?.boat || b?.id || 'boat', leaving: true, until: end, label: `Walking up the dock with ${owner}`, icon: '🚤', use: 'walk' };
      if (m) this.sellLater(rec.id, a.i, m.owner, dock, end);
    } else {
      a.ride = a.ride || { boat: b?.id || 'boat' };
      brain.alight(a, at.x, at.z);
    }
    this.note(rec.id, 'move', `Got out of ${owner}'s boat${dock ? ` at ${clean(dock.name || 'the dock', 60)}` : ''}`, { key: 'boat' });
    this.changed();
  }
  /** Walking up the dock after getting off: once at the quay, it follows again as anyone would. */
  leaving(a) {
    const sim = this.sim;
    if (sim.now() < (a.ride.until ?? 0) - 0.2) return;
    a.ride = null;
    sim.brain.reorder(a, true);
  }

  // ------------------------------------------------------------------------------------------------ the watch
  /** Twice a second: each companion aboard — its trip with its owner's, and its fishing; catches to sell at the dock. */
  tick() {
    const t = this.now(), sim = this.sim;
    if (!sim) return;
    for (const m of [...this.crew.values()]) {
      try { this.step(m, t); } catch (e) { this.log?.warn?.('[fishing-crew] a companion failed:', e.stack || e.message); }
    }
    for (const [id, s] of [...this.sales]) if (t >= s.at) { this.sales.delete(id); try { this.sellNow(id, s); } catch (e) { this.log?.warn?.('[fishing-crew] a sale failed:', e.message); } }
    try { this.tellCrew(t); } catch (e) { this.log?.warn?.('[fishing-crew] the crew\'s tallies:', e.message); }
    try { this.inviteCrew(); } catch (e) { this.log?.warn?.('[fishing-crew] the crew of players\' trips:', e.message); }
    try { this.baitErrands(t); } catch (e) { this.log?.warn?.('[fishing-crew] the bait asked for:', e.message); }
  }
  step(m, t) {
    const sim = this.sim, a = sim.agents[m.i];
    // no longer aboard (its order ended, it was sent somewhere, dismissed): out of the crew — ashore, if that left it on
    // the water (nobody stands on the sea)
    if (!a?.ride || a.ride.boat !== m.boat || a.ride.leaving) {
      this.endTrip(m, 'off');
      this.crew.delete(m.agent);
      if (a?.plan && !a.ride) this.ashore(a, m);
      this.changed();
      return;
    }
    if (a.ride.until && sim.now() < a.ride.until) return;   // (still walking down the pier)
    const H = this.harbour, b = H.all.get(m.boat);
    if (!b) return;
    // its owner's trip (the play core's fishing run): a new one, or none any more
    const own = this.play.runOf(m.owner), trip = own?.module === 'fishing' ? own : null;
    if (m.run && (!trip || m.run.along !== trip.id)) this.endTrip(m, trip ? 'new' : 'over');
    if (!trip) { m.tripSeen = null; if (m.fishing) this.rodAway(m, null); return; }
    if (m.tripSeen !== trip.id) {
      m.tripSeen = trip.id; m.tripAt = t; m.declined = false;
      const c = TRIP_BY_ID[trip.course];
      let kit = ''; try { kit = this.angler?.kitWords?.(-m.agent) || ''; } catch { kit = ''; }
      this.note(m.agent, 'activity', `${this.nameOf(m.owner)} started a fishing trip: ${c?.label || trip.course} — you are aboard, a rod to hand${kit ? ` (your tackle: ${kit})` : ''}`);
    }
    // one session (2026-11-19, the product owner: "when a fishing session is activated, all companions in the boat are also accounted
    // for"): everyone aboard is in its owner's trip from its start — its own run along on theirs, scored — and fishes a
    // moment after it begins, unless it was asked to stop; how it fishes is its own (its Free Will: tactics); a start
    // that fails waits for the next trip
    if (!m.run && !m.declined) { const r = this.beginTrip(m, trip); if (!r.ok) m.declined = true; }
    if (!m.fishing && !m.declined && t - m.tripAt >= JOIN_MS) { const r = this.startFishing(m, m.wants ? 'asked' : 'session'); m.wants = false; if (!r.ok) m.declined = true; }
    if (m.fishing) this.fishStep(m, b, trip, t);
  }
  /** Whether Free Will decides for this agent (server/companions/ decides: its switch on and moments on). */
  decides(agentId) { try { const rec = this.agents.get(agentId); return !!(rec && this.companionsOf()?.decides?.(rec)); } catch { return false; } }
  remark(i, text) { try { this.companionsOf()?.remark?.(i, text); } catch { /* its words are a bonus */ } }
  /** A body left on the water (dismissed out at sea): put ashore beside the boat's slip, as the harbour master does. */
  ashore(a, m) {
    const sim = this.sim, e = evalPlan(a.plan, sim.now()), N = this.players.nav;
    if (!N?.wet?.(e.x, e.z)) return;
    const b = this.harbour?.all.get(m.boat), p = b ? this.harbour.besideSlip(b) : null, dock = b ? this.dockOf(b) : null;
    const q = dock ? this.pointsOn(dock, [[1.5, toFrame(dock, p.x, p.z).f]])[0] : p;
    if (!q) return;
    a.ride = { boat: m.boat };
    sim.brain.alight(a, q.x, q.z);
  }

  // ------------------------------------------------------------------------------------------------ its trip
  /** Its trip begins — its own run of the fishing module, along on its owner's: the same grounds and clock, its own kit. */
  beginTrip(m, trip) {
    const acct = { id: -m.agent };
    let st;
    // (its run along on this trip already under way — kept across the server's restart, or its owner's page reloading: taken
    //  up again, its catch so far with it; else a new one)
    const had = this.play.runOf(acct.id);
    if (had && had.module === 'fishing' && had.along === trip.id) st = { run: had.id };
    else {
      try { st = this.play.start(acct, 'fishing', trip.course, { dock: trip.data?.dock?.id, seed: trip.data?.seed }, { auto: true, along: trip.id }); }
      catch (e) { return { ok: false, why: e.message || 'it could not start' }; }
    }
    const run = this.play.runs.get(st.run);
    let level = 1; try { level = moduleLevel(this.play.progress(acct.id).modules.fishing?.xp || 0); } catch { level = 1; }
    m.run = { id: st.run, along: trip.id, root: trip.along || trip.id, course: trip.course, label: TRIP_BY_ID[trip.course]?.label || trip.course };
    // (its hand: a beginner misses more strikes and loses more fish; better with every fishing level)
    m.skill = clamp(0.62 + 0.03 * (level - 1), 0.62, 0.95); m.level = level;
    m.lastHook = -1e9; m.landed = 0; m.lost = 0; m.best = null;
    if (st.run === had?.id) {   // (taken up again: its tallies from the run's own catch)
      const fish = (run?.state?.caught || []).filter(c => c.species);
      m.landed = (run?.state?.caught || []).length;
      for (const c of fish) if (!m.best || c.kg > m.best.kg) m.best = { species: c.species, kg: c.kg };
    }
    m.plan = null; m.thinking = null; m.dry = 0; m.lostBig = false;   // (its plan for the water: thought over at its first cast)
    this.stats.trips++;
    void run;
    return { ok: true };
  }
  /** Its trip ends (its owner's ended, it got off, a new one): weighed in, its catch into its inventory. */
  endTrip(m, why) {
    if (m.fishing) this.rodAway(m, null);
    const r = m.run;
    if (!r) return null;
    m.run = null;
    const acct = { id: -m.agent };
    if (m.hook && this.play.runs.has(r.id)) { try { this.play.act(acct, r.id, 'lose', { hook: m.hook.n, why: 'spat' }); } catch { /* over */ } m.hook = null; }
    let res = null;
    try { res = this.play.runs.has(r.id) ? this.play.finish(acct, r.id, {}) : null; } catch (e) { this.log?.warn?.('[fishing-crew] a trip did not finish:', e.message); return null; }
    if (!res?.ok) return res;
    let stowed = null, after = null;
    try { stowed = this.market?.stow?.(acct, res) || null; } catch (e) { this.log?.warn?.('[fishing-crew] the catch was not stowed:', e.message); }
    try { after = this.angler?.afterTrip?.(acct, res) || null; } catch (e) { this.log?.warn?.('[fishing-crew] after the trip:', e.message); }
    m.lastTrip = { why, score: res.score, stars: res.stars, xp: res.xp, fish: res.detail?.fish || 0, stowed: stowed?.stowed || 0, level: res.module?.level, dex: after?.dex || null, badges: [...(res.badges || []), ...(after?.badges || [])].map(x => x.id) };
    // (the shared session's results: its owner's trip's — shown with theirs, the catch theirs to take if they choose)
    this.keepResult(r.root || r.along, m, res, stowed, after);
    if (res.module && res.module.level > res.module.was) this.toAccount(m.owner, { t: 'crew_note', agent: m.agent, i: m.i, text: `🎣 ${m.name} reached fishing level ${res.module.level}!` });
    return res;
  }
  // ------------------------------------------------------------------------------------------------ the shared session
  // One fishing trip on one boat is one session (2026-11-19, the product owner: "when a fishing session is activated, all companions in the
  // boat are also accounted for … including all players and agents"; "like a multiplayer co-op so up to 4 players can fish
  // together"): its skipper's run is its root; the crew of players fish on runs along it (joinTrip), the companions on runs
  // along their owner's. The root's end ends them all, at once; everyone's results are the session's, shown to each player
  // with their own. Only a player with their companions alone may take the companions' catch (claim).
  /** The session of root run `root` (made on first use: its owner, the root's account). */
  sessionOf(root, owner = null) {
    let S = this.sessions.get(root);
    if (!S) {
      S = { run: root, owner: owner ?? this.play.runs.get(root)?.account ?? null, at: this.now(), crew: new Map(), people: new Map(), players: new Set(), decided: null };
      this.sessions.set(root, S);
      for (const [id, x] of this.sessions) if (this.now() - x.at > SESSION_KEEP_MS) this.sessions.delete(id);
    }
    return S;
  }
  /** The root of a run: the run it goes along on, all the way up (a companion's: its owner's; a crew member's: the skipper's). */
  rootOf(runId) {
    let r = this.play.runs.get(runId), id = runId;
    for (let k = 0; r?.along && k < 4; k++) { id = r.along; r = this.play.runs.get(r.along); }
    return id;
  }
  /** A companion's trip result, kept with its session (root run id) — for the session's results. */
  keepResult(root, m, res, stowed, after) {
    if (!root) return;
    const S = this.sessionOf(root, m.owner);
    const d = res.detail || {}, best = d.best ? { what: d.best.species, kg: d.best.kg, cm: d.best.cm } : null;
    S.crew.set(m.agent, { agent: m.agent, i: m.i, name: m.name, owner: m.owner, ownerName: this.nameOf(m.owner), score: res.score, stars: res.stars, xp: res.xp, fish: d.fish || 0, finds: d.finds || 0, value: Math.round((Number(d.sale ?? d.value) || 0) * 100),
      best, level: res.module?.level || null, levelUp: !!(res.module && res.module.level > res.module.was), badges: [...(res.badges || []), ...(after?.badges || [])].map(x => x.label || x.id).slice(0, 4),
      stowed: stowed?.stowed || 0, stacks: Array.isArray(stowed?.stacks) ? stowed.stacks.slice(0, 60) : [] });
  }
  /** A player's trip result, kept with its session. */
  keepPlayer(S, account, res) {
    const d = res.detail || {}, best = d.best ? { what: d.best.species, kg: d.best.kg, cm: d.best.cm } : null;
    S.players.add(account);
    S.people.set(account, { account, name: this.nameOf(account), score: res.score, stars: res.stars, xp: res.xp, fish: d.fish || 0, finds: d.finds || 0, value: Math.round((Number(d.sale ?? d.value) || 0) * 100), best,
      level: res.module?.level || null, levelUp: !!(res.module && res.module.level > res.module.was) });
  }
  /**
   * The play core's word that a run finished — a player's fishing trip: its companions' trips end with it; the session's
   * root (its skipper's): everyone's do — the crew of players' too, their catch stowed and their pages told (fish_end) —, so
   * every result carries everyone's.
   */
  onPlay(ev) {
    if (ev?.type !== 'finish' || ev.run?.module !== 'fishing' || !(ev.account > 0) || !ev.result?.ok) return;
    const root = ev.run.along || ev.run.id, S = this.sessionOf(root, ev.run.along ? null : ev.account);
    this.keepPlayer(S, ev.account, ev.result);
    // (its companions: their trips end with theirs)
    for (const m of [...this.crew.values()]) if (m.run?.along === ev.run.id) { try { this.endTrip(m, 'over'); m.tripSeen = null; } catch (e) { this.log?.warn?.('[fishing-crew] a crew trip did not end:', e.message); } }
    if (ev.run.along) { ev.result.session = this.sessionView(S, ev.account); return; }
    // the root: the crew of players' trips along it end now — weighed in, stowed, their pages told
    if (this.ending) return;
    this.ending = true;
    const ended = [];
    try {
      for (const r of [...this.play.runs.values()]) {
        if (r.along !== root || !(r.account > 0) || r.module !== 'fishing') continue;
        let res = null;
        try { res = this.play.finish({ id: r.account }, r.id, {}); } catch (e) { this.log?.warn?.('[fishing-crew] a crew member\'s trip did not end:', e.message); continue; }
        if (!res?.ok) continue;
        try { const x = this.afterFinish?.(r.account, res); if (x && typeof x === 'object') Object.assign(res, x); } catch (e) { this.log?.warn?.('[fishing-crew] after a crew member\'s trip:', e.message); }
        ended.push({ account: r.account, run: r.id, res });
      }
    } finally { this.ending = false; }
    ev.result.session = this.sessionView(S, ev.account);
    for (const x of ended) { x.res.session = this.sessionView(S, x.account); this.toAccount(x.account, { t: 'fish_end', run: x.run, root, by: this.nameOf(ev.account), result: x.res }); }
  }
  /** What a session's results show player `viewer`: the companions' trips, the other players', and — one player with
   *  their companions only, its owner — the choice of whose catch it is. */
  sessionView(S, viewer = S.owner) {
    const crew = [...S.crew.values()].map(({ stacks, ...x }) => ({ ...x, items: stacks.length, mine: x.owner === viewer }));
    const people = [...S.people.values()].filter(x => x.account !== viewer);
    const solo = S.players.size <= 1 && viewer === S.owner;
    return { run: S.run, crew, people, players: S.players.size, choice: solo && !S.decided && crew.some(x => x.items > 0) ? ['keep', 'take'] : null, decided: S.decided };
  }
  /** One companion's tallies now: { agent, i, name, owner, fishing, phase, lure, thinking, fish (landed), kept, kg, value
   *  (hundredths: the fish's worth as the player's page counts its own, shared/fish-species.js valueOf), best }. */
  liveOf(m) {
    const run = this.play.runs.get(m.run.id), caught = run?.state?.caught || [];
    const kept = caught.filter(c => c.kept && c.species), best = kept.reduce((b, c) => (!b || c.kg > b.kg ? c : b), null);
    return { agent: m.agent, i: m.i, name: m.name, owner: m.owner, fishing: !!m.fishing, phase: m.phase, lure: m.lure || null, thinking: !!m.thinking, fish: caught.filter(c => c.species).length, kept: kept.length,
      kg: Math.round(kept.reduce((a, c) => a + (c.kg || 0), 0) * 100) / 100, value: Math.round(kept.reduce((a, c) => a + valueOf(speciesOf(c.species), c.kg, c.u), 0) * 100), best: best ? { what: best.species, kg: best.kg } : null };
  }
  /** A player's tallies on their run now (the same counts). */
  livePlayer(run) {
    const caught = run?.state?.caught || [], kept = caught.filter(c => c.kept && c.species), best = kept.reduce((b, c) => (!b || c.kg > b.kg ? c : b), null);
    return { account: run.account, name: this.nameOf(run.account), fish: caught.filter(c => c.species).length, kept: kept.length, kg: Math.round(kept.reduce((a, c) => a + (c.kg || 0), 0) * 100) / 100,
      value: Math.round(kept.reduce((a, c) => a + valueOf(speciesOf(c.species), c.kg, c.u), 0) * 100), best: best ? { what: best.species, kg: best.kg } : null };
  }
  /** Everyone fishing in session `root` now: { crew: the companions' tallies, players: the players' (the skipper's first) }. */
  liveSession(root) {
    const crew = [], players = [];
    for (const m of this.crew.values()) if (m.run && (m.run.root || m.run.along) === root) crew.push(this.liveOf(m));
    const top = this.play.runs.get(root);
    if (top) players.push(this.livePlayer(top));
    for (const r of this.play.runs.values()) if (r.along === root && r.account > 0 && r.module === 'fishing') players.push(this.livePlayer(r));
    return { crew, players };
  }
  /** Back-compatible: the companions of `owner` on trip `tripId` (their run along it). */
  liveCrew(owner, tripId) { const out = []; for (const m of this.crew.values()) if (m.owner === owner && m.run?.along === tripId) out.push(this.liveOf(m)); return out; }
  /** Every couple of seconds while a trip is on: everyone's tallies to every player in the session (when they changed). */
  tellCrew(t) {
    if (t - (this.toldAt || 0) < CREW_TELL_MS) return;
    this.toldAt = t;
    const roots = new Set();
    for (const m of this.crew.values()) if (m.run) roots.add(m.run.root || m.run.along);
    for (const r of this.play.runs.values()) if (r.module === 'fishing' && r.account > 0 && r.along && this.play.runs.has(r.along)) roots.add(r.along);
    for (const root of roots) {
      const top = this.play.runs.get(root);
      if (!top || top.module !== 'fishing' || !(top.account > 0)) continue;
      const L = this.liveSession(root), key = JSON.stringify(L), was = this.told.get(root);
      if (was && was.key === key && t - was.at < CREW_TELL_FULL_MS) continue;
      this.told.set(root, { key, at: t });
      for (const p of L.players) this.toAccount(p.account, { t: 'fish_crew', run: root, crew: L.crew, players: L.players });
    }
    for (const [root] of this.told) if (!this.play.runs.has(root)) this.told.delete(root);
  }
  /**
   * A player aboard someone's boat as its crew joins their skipper's fishing trip (2026-11-19, co-op): a run of their own
   * along on it — the same grounds and clock, their own kit, scored as their own. → the play core's start, or a refusal.
   */
  joinTrip(P, runId) {
    const id = P?.account?.id, H = this.harbour, top = this.play.runs.get(String(runId || ''));
    if (!id || !top || top.module !== 'fishing' || top.along) return { ok: false, why: 'no_run', text: 'That fishing trip is over' };
    const b = this.boatOfLead(id);
    if (!b || b.skipper !== top.account || b.skipper === id) return { ok: false, why: 'not_aboard', text: 'Get aboard the skipper\'s boat to fish on their trip' };
    const mine = this.play.runOf(id);
    if (mine?.along === top.id) return { ok: false, why: 'already', text: 'You are on this trip already', run: mine.id };
    const r = this.play.start({ id }, 'fishing', top.course, { dock: top.data?.dock?.id, seed: top.data?.seed, [ALONG]: true }, { along: top.id });
    this.sessionOf(top.id, top.account).players.add(id);
    this.sessionOf(top.id).players.add(top.account);
    return { ok: true, ...r, root: top.id, skipper: this.nameOf(top.account) };
  }
  /** Bait asked for away from a store: bought the moment its body is at one (an hour's wish at most). */
  baitErrands(t) {
    for (const [id, at] of [...this.wantBait]) {
      if (t - at > KEEN_MS * 2) { this.wantBait.delete(id); continue; }
      const rec = this.agents.get(id), C = this.companionsOf();
      let body = null; try { body = rec && C?.bodyOf ? C.bodyOf(rec.id) : null; } catch { body = null; }
      const a = body ? this.sim?.agents[body.i] : null, st = a?.plan ? this.storeNear(a) : null;
      if (!st) continue;
      this.wantBait.delete(id);
      const lure = this.baitFor(id, st.b)[0]?.id;
      if (lure) { const r = this.buyBait(id, body.i, st.b, lure, 1); if (!r.ok) this.note(id, 'activity', `Could not buy bait at ${clean(st.b.name || 'the Dock Store', 60)}: ${r.text}`); }
    }
  }
  /** Twice a second: the crew of players aboard a boat whose skipper is on a fishing trip, not on it yet — their pages
   *  asked to join (fish_join; once a trip each). */
  inviteCrew() {
    const H = this.harbour;
    if (!H?.byGuest) return;
    for (const [id, b] of H.byGuest) {
      const top = this.play.runOf(b.skipper);
      if (top?.module !== 'fishing') continue;
      const mine = this.play.runOf(id);
      if (mine?.along === top.id || this.invited.get(id) === top.id) continue;
      this.invited.set(id, top.id);
      this.toAccount(id, { t: 'fish_join', run: top.id, course: top.course, skipper: this.nameOf(b.skipper) });
    }
  }
  /**
   * The owner's choice at the end of a session of theirs with their companions only (2026-11-19, the product owner: "companions keep
   * their catch or the whole catch from everyone is transferred to the player" — only for one player and companions):
   * take → every fish and find stowed from the trip moves from each companion of theirs to them. Once. → { ok, moved, kept }.
   */
  claim(P, runId, take) {
    const S = this.sessions.get(String(runId || ''));
    if (!S || S.owner !== P?.account?.id) return { ok: false, why: 'no_session', text: 'That fishing trip is over and done' };
    if (S.players.size > 1) return { ok: false, why: 'not_solo', text: 'Only a trip with your companions alone can be shared out this way' };
    if (S.decided) return { ok: false, why: 'decided', text: S.decided === 'take' ? 'You took the catch already' : 'Your companions kept their catch' };
    S.decided = take ? 'take' : 'keep';
    if (!take) return { ok: true, decided: S.decided, moved: 0, kept: [...S.crew.values()].reduce((a, x) => a + x.stacks.length, 0) };
    // (only their own companions' catch: S.crew holds the companions of everyone who fished in it)
    const inv = this.market?.inv;
    if (!inv) { S.decided = null; return { ok: false, why: 'no_inventory', text: 'Inventories are off here' }; }
    let moved = 0, value = 0, full = false, notYours = 0;
    for (const x of S.crew.values()) {
      if (x.owner !== P.account.id) continue;
      const rec = this.agents.get(x.agent);
      if (!rec || !this.agents.isOwner?.(P, rec)) { notYours += x.stacks.length; continue; }   // (an agent shared with them to manage: its catch stays its own)
      for (const st of x.stacks) {
        try {
          const r = inv.move({ kind: 'agent', id: x.agent }, { kind: 'account', id: P.account.id }, st, 1, { kind: 'give', actor: `account:${P.account.id}`, memo: `${x.name}'s catch from your fishing trip`, idem: `fish-session:${S.run}:${st}` });
          if (!r?.dup) { moved++; value += r?.value || 0; }
        } catch (e) { if (e.code === 'full') { full = true; break; } if (e.code !== 'not_found') this.log?.warn?.('[fishing-crew] a catch did not move:', e.message); }
      }
      if (full) break;
    }
    return { ok: true, decided: S.decided, moved, value, full, notYours };
  }
  /** Its catch to sell at dock `dock`'s store once it has walked up the dock (at: sim time). */
  sellLater(agentId, i, owner, dock, at) {
    const dt = Math.max(0, (at - this.sim.now()) / Math.max(0.01, this.sim.clock?.rate || 1)) * 1000;
    this.sales.set(agentId, { at: this.now() + dt, module: dock.id, i, owner });
  }
  sellNow(agentId, s) {
    const W = this.worldOf(), m = modulesOf(W).find(x => x.id === s.module), B = m && Number.isInteger(m.terminal) ? W.buildings[m.terminal] : null;
    if (!B || B.gone || !B.tackle || !this.market) return null;
    const r = this.sell(agentId, B);
    if (r.ok && r.paid > 0) {
      const rec = this.agents.get(agentId), name = clean(rec?.name || 'Your agent', 40);
      this.say(s.i, `Sold my catch: ${(r.paid / 100).toFixed(2)} VC`);
      this.toAccount(s.owner, { t: 'crew_note', agent: agentId, i: s.i, text: `${name} sold their catch at the ${clean(B.name || 'Dock Store', 40)} for ${(r.paid / 100).toFixed(2)} VC` });
    }
    return r;
  }
  /** Sells agent id's fish at store B (the fish market, its own wallet): → { ok, paid (hundredths), n, text, why }. */
  sell(agentId, B) {
    let r;
    try { r = this.market.sell({ id: -agentId }, null, B); }
    catch (e) { return { ok: false, paid: 0, n: 0, why: e.code || 'failed', text: e.message || 'It could not sell' }; }
    const n = r.sold.length;
    this.stats.sold += n;
    this.note(agentId, 'activity', `Sold your catch at ${clean(B.name || 'the Dock Store', 60)}: ${n} ${n === 1 ? 'thing' : 'things'} for ${(r.paid / 100).toFixed(2)} VC${r.capped ? ' (the fish market buys no more from you today)' : ''}`);
    return { ok: true, paid: r.paid, n, capped: r.capped, text: `sold ${n} for ${(r.paid / 100).toFixed(2)} VC` };
  }

  // ------------------------------------------------------------------------------------------------ fishing
  /** It starts fishing (asked, its own choice, or joining in): → { ok, why, text }. */
  startFishing(m, why) {
    const trip = this.play.runOf(m.owner);
    if (!trip || trip.module !== 'fishing') return { ok: false, why: 'no_trip', text: `There is no fishing trip under way — ${this.nameOf(m.owner)} starts one from the boat (🎣 Trips)` };
    const minute = (this.now() - trip.at) / 60000, c = TRIP_BY_ID[trip.course];
    if (c && minute > c.minutes + AFTER_DUSK_MIN - 0.5) return { ok: false, why: 'dusk', text: 'It\'s dark — the trip is over; time to head back to the dock' };
    if (!m.run || m.run.along !== trip.id) { const r = this.beginTrip(m, trip); if (!r.ok) return { ok: false, why: 'no_run', text: `It could not join the trip: ${r.why}` }; }
    if (m.fishing) return { ok: true, why: 'already', text: `${m.name} is fishing already` };
    m.fishing = true; m.why = why; m.declined = false;
    this.phase(m, 'ready', 1200);
    const b = this.harbour.all.get(m.boat), spot = b ? BOATS[b.type].deck.spots[m.spot].name : 'side';
    this.note(m.agent, 'activity', `Started fishing from the ${spot} of ${this.nameOf(m.owner)}'s boat (${m.run.label})`);
    return { ok: true, why: null, text: `${m.name} is fishing from the ${spot}` };
  }
  /** The rod away (asked, the trip over, dusk, no bait): → { ok, text }. why: words for its diary, or null. */
  rodAway(m, why) {
    const was = m.fishing;
    if (m.hook && m.run && this.play.runs.has(m.run.id)) { try { this.play.act({ id: -m.agent }, m.run.id, 'lose', { hook: m.hook.n, why: 'spat' }); } catch { /* over */ } }
    m.hook = null; m.fishing = false; m.lure = null;
    this.phase(m, 'aboard', 0);
    if (was && why) this.note(m.agent, 'activity', `Put your rod away: ${why}`);
    return { ok: true, text: `${m.name} puts the rod away` };
  }
  phase(m, p, ms) { if (m.phase !== p) { m.phase = p; m.seq = (m.seq + 1) % 1000; this.changed(); } m.until = this.now() + ms; }
  /** The lure it fishes with now: of those it has left that suit this water, the one this ground's fish come to soonest. */
  pickLure(run, ground, hour) {
    const plan = run.data.plan, st = run.state, have = id => (st.kit?.lures ? Math.max(0, (st.kit.lures[id] || 0) - (st.used?.[id] || 0)) : Infinity);
    let best = null, bw = Infinity;
    for (const l of luresFor(plan.water)) {
      if (l.kind === 'troll' || !(have(l.id) > 0)) continue;
      const w = biteEvery(ground, l.id, hour, plan.water);
      if (w < bw) { bw = w; best = l.id; }
    }
    return best;
  }
  /** What it can see of the water from its spot: the ground each cast length lands on ({ close, mid, far }: a ground, or
   *  null — a hidden one it hasn't found is open water to it, as to a player). */
  sightOf(run, b, m, L, minute) {
    const plan = run.data.plan, seen = new Set(run.state?.revealed || []);
    const s = groundsByReach(plan, d0 => this.castPoint(b, m.spot, d0), L.reach, minute);
    for (const k of Object.keys(s)) if (s[k]?.hidden && !seen.has(s[k].id)) s[k] = null;
    return s;
  }
  /**
   * It thinks its plan over (its decision service: Free Will's decideNow — its own model, its daily limits): asked, the rod
   * held ready until its answer or THINK_MS; then its plan (or its habit, no answer), a line in its diary, and — if it
   * chose to — a word about it in its own voice (its brain: companions' remark). → false: nothing to ask (no Free Will for
   * it), its habit at once.
   */
  think(m, run, b, { sight, choices, why, hour, minute, L, c }) {
    const fw = this.freeWillOf?.();
    if (!fw?.decideNow || !this.decides(m.agent)) return false;
    const rec = this.agents.get(m.agent);
    if (!rec) return false;
    let ctx = null; try { ctx = fw.contextFn ? fw.contextFn(rec.id) : null; } catch { ctx = null; }
    const who = [`${clean(rec.name, 40)}${rec.role ? `, ${clean(rec.role, 60)}` : ''}.`, ctx?.personality?.length ? `Personality: ${ctx.personality.slice(0, 6).join(', ')}.` : '', ctx?.likes?.length ? `Likes ${ctx.likes.slice(0, 4).map(x => clean(x, 40)).join(', ')}.` : ''].filter(Boolean).join(' ');
    const others = [];
    const own = this.play.runOf(m.owner);
    if (own?.module === 'fishing') others.push({ name: this.nameOf(m.owner), caught: own.state?.caught || [] });
    for (const o of this.crew.values()) if (o !== m && o.run?.along === m.run?.along) others.push({ name: o.name, caught: this.play.runs.get(o.run.id)?.state?.caught || [] });
    const B = BOATS[b.type], st = run.state || {};
    const s = { name: rec.name, who, owner: this.nameOf(m.owner), boat: B?.label || 'boat', spot: B?.deck.spots[m.spot]?.name || 'side', trip: m.run?.label || 'fishing', water: run.data.plan.water,
      hour, minute, minutes: c?.minutes || 12, reach: L.reach, grounds: sight, choices, mine: st.caught || [], crew: others,
      cooler: { used: (st.caught || []).filter(x => x.kept).reduce((a, x) => a + (x.slots || 1), 0), size: L.boat?.cooler || 12 }, lost: m.lost, dry: m.dry, plan: m.plan, reason: why, level: m.level };
    const req = request(s), t0 = this.now(), was = m.plan, token = { until: t0 + THINK_MS + 600 };
    m.thinking = token; this.stats.thought++;
    const done = (P, say) => {
      if (this.crew.get(m.agent) !== m || !m.run) return;
      m.plan = { ...P, at: this.now(), ground: sight.mid?.id || null };
      if (m.thinking === token) { m.thinking = null; m.until = Math.min(m.until, this.now()); }
      if (P.by !== 'model') return;
      this.stats.answered++;
      if (!was || was.by !== 'model' || planWords(was) !== planWords(P)) this.note(m.agent, 'activity', `Fishing: ${planWords(P)}`);
      const words = say ? narration(s, P, was?.by === 'model' ? was : null, why) : null;
      if (words) this.remark(m.i, words);
    };
    fw.decideNow(rec.id, req, { type: 'fishing', when: `${Math.floor(hour)}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`, place: `${s.owner}'s boat`, timeoutMs: THINK_MS,
      options: choices.map(x => ({ id: x.id, kind: 'lure', label: x.name })),
      summary: answers => { const r = readAnswers(answers, choices, was); return { chosen: r.plan.lure, label: planWords(r.plan), conf: r.conf, reason: why }; } })
      .then(res => { const r = res?.answers?.length ? readAnswers(res.answers, choices, was) : null; done(r?.answered ? r.plan : { ...habit() }, !!r?.say); },
        err => { this.log?.warn?.('[fishing-crew] a fishing decision failed:', err?.message || err); done({ ...habit() }, false); });
    return true;
  }
  /** Where its cast lands: out from its spot the way it faces, d0 m. */
  castPoint(b, spot, d0) { const at = this.spotAt(b, spot); return { x: at.x + Math.sin(at.yaw) * d0, z: at.z + Math.cos(at.yaw) * d0 }; }
  /** The fight with what took it, as its hand plays it (the module's own fight, stepped to the end): { secs, out }. */
  fightOf(m, what, L, d0, seed, push = 0) {
    if (what.kind === 'find') {
      const least = Math.max(0, d0 - 3) / (L.speed * 2.55) * 0.8;   // (shared/fishing.js land: a find is just reeled in)
      return { secs: least + 2 + m.rng.float(0, 3), out: 'landed' };
    }
    const sp = speciesOf(what.species), F = fightSetup(sp, { kg: what.kg }, L, { d0, seed });
    for (let k = 0; !F.out && k < MAX_FIGHT_S / FIGHT_DT + 10; k++) fightStep(F, botInput(F, m.skill, push));
    const least = minFightSeconds(sp, what.kg, L, d0);
    return { secs: Math.max(F.t, least + 0.6), out: F.out || 'free' };
  }
  /** One step of fishing, when the phase's time is up. */
  fishStep(m, b, trip, t) {
    if (t < m.until) return;
    const run = m.run && this.play.runs.get(m.run.id);
    if (!run) { m.run = null; this.rodAway(m, null); return; }
    const acct = { id: -m.agent }, plan = run.data.plan, L = kitFor(run.state.kit || {}, plan.water), minute = (t - run.at) / 60000, c = TRIP_BY_ID[run.course];
    const hour = hourAt(run.data, minute);
    // the boat under way: nobody casts from a boat at speed — a line out is reeled in, the rod held ready until it slows
    // (a fish on is still fought)
    if (Math.abs(this.harbour.place(b).v || 0) > FISH_SPEED && m.phase !== 'fight' && m.phase !== 'net' && m.phase !== 'show') {
      if (m.phase === 'cast' || m.phase === 'wait') this.phase(m, 'reel', REEL_IN_MS);
      else this.phase(m, 'ready', 1500);
      return;
    }
    switch (m.phase) {
      case 'aboard': case 'ready': case 'rest': case 'reel': {
        if (c && minute > c.minutes + AFTER_DUSK_MIN - 0.5) { this.rodAway(m, 'it\'s dark, the trip is over'); return; }
        // its plan for the water (./fishing-tactics.js): thought over now and then by its decision service — the rod held
        // ready while it thinks — else its habit
        if (m.thinking) { if (t < m.thinking.until) { if (m.phase !== 'ready') this.phase(m, 'ready', 500); m.until = t + 400; return; } m.thinking = null; }
        const sight = this.sightOf(run, b, m, L, minute), choices = lureChoices(run, sight.mid, hour);
        if (!choices.length) { this.rodAway(m, 'no bait left (the dock store sells more)'); return; }
        const why = due(m, t, sight.mid, choices);
        if (why) {
          m.dry = 0; m.lostBig = false;
          if (this.think(m, run, b, { sight, choices, why, hour, minute, L, c })) { this.phase(m, 'ready', 500); m.until = t + 400; return; }
          m.plan = { ...habit(), at: t, ground: sight.mid?.id || null };
        }
        // the cooler full (and nothing it would swap): it keeps fishing, letting what it catches go
        const P = m.plan || habit(), [r0, r1] = REACH[P.reach] || REACH.mid;
        m.d0 = clamp(L.reach * m.rng.float(r0, r1), 4, L.reach);
        const at = this.castPoint(b, m.spot, m.d0), g = groundAt(plan, at.x, at.z, minute);
        m.ground = g?.id || null;
        m.lure = P.lure && choices.some(x => x.id === P.lure) ? P.lure : this.pickLure(run, g, hour);
        if (!m.lure) { this.rodAway(m, 'no bait left (the dock store sells more)'); return; }
        m.vis = { d0: m.d0, kind: LURE_BY_ID[m.lure]?.kind === 'float' ? 0 : 1, fish: null, caught: null };   // (what the pages draw: rows)
        this.phase(m, 'cast', CAST_MS);
        return;
      }
      case 'cast': {
        // the module's own pacing (as the browser waits a player's lure: the ground, the lure, the hour), give or take
        const g = plan.grounds.find(x => x.id === m.ground) || null, every = biteEvery(g, m.lure, hour, plan.water) * 1000 * m.rng.float(0.55, 1.45);
        // (and never a hook sooner than a cast cycle after the last: a person's pace)
        this.phase(m, 'wait', Math.max(clamp(every, MIN_WAIT_MS, MAX_WAIT_MS), m.lastHook + MIN_CYCLE_MS - t));
        return;
      }
      case 'wait': {
        // the strike: set in time or not (a beginner is often too soon or too late)
        if (m.rng.chance(0.04 + 0.3 * (1 - m.skill))) { m.missed = (m.missed || 0) + 1; m.dry = (m.dry || 0) + 1; this.phase(m, 'reel', REEL_IN_MS); return; }
        let r;
        try { r = this.play.act(acct, run.id, 'hook', { ground: m.ground, lure: m.lure, d0: m.d0 }); }
        catch (e) {
          if (e.status === 429) { m.until = t + 1000; return; }
          if (/no .* left/i.test(e.message)) { this.phase(m, 'reel', REEL_IN_MS); return; }   // (that bait ran out: another next cast)
          this.rodAway(m, clean(e.message, 80)); return;
        }
        m.lastHook = t; this.stats.hooks++;
        if (!r.hook) { m.dry = (m.dry || 0) + 1; this.phase(m, 'reel', REEL_IN_MS); return; }
        m.dry = 0;
        const push = FIGHT[m.plan?.fight] ?? 0, f = this.fightOf(m, r.what, L, r.d0, r.seed, push);
        m.hook = { n: r.hook, what: r.what, out: f.out };
        // (the pages play the same fight, on its seed, over its time: its runs, its leaps, landed or not)
        m.vis = { ...(m.vis || { kind: 0 }), d0: r.d0 || m.d0, fish: { id: r.what.kind === 'find' ? r.what.id : r.what.species, find: r.what.kind === 'find', kg: r.what.kg || 0, cm: r.what.cm || 0, seed: r.seed >>> 0, secs: f.secs, out: f.out === 'landed' ? 1 : 0, skill: m.skill, push }, caught: null };
        this.phase(m, 'fight', f.secs * 1000);
        return;
      }
      case 'fight': {
        const h = m.hook;
        if (h?.out === 'landed') { this.phase(m, 'net', NET_MS); return; }
        if (h) { try { this.play.act(acct, run.id, 'lose', { hook: h.n, why: ['snap', 'bite', 'bent'].includes(h.out) ? 'snap' : 'spat' }); } catch { /* over */ } this.lost(m, h); }
        m.hook = null;
        this.phase(m, 'rest', m.rng.float(3000, 6500));
        return;
      }
      case 'net': {
        const h = m.hook; m.hook = null;
        let r = null;
        try { r = h ? this.play.act(acct, run.id, 'land', { hook: h.n }) : null; } catch (e) { this.log?.info?.(`[fishing-crew] ${m.name}'s landing refused: ${e.message}`); r = null; }
        if (!r?.caught) { this.phase(m, 'rest', 3000); return; }
        // the cooler full — or a small one, its plan to let those go (room for bigger ones) —: it lets the fish go (catch
        // and release counts too)
        const small = !!r.caught.kept && m.plan?.keep === 'better' && r.caught.size === 'small';
        if (r.caught.species && (!r.caught.kept || small)) { try { this.play.act(acct, run.id, 'release', { n: r.caught.n }); r.caught = { ...r.caught, kept: false, released: small ? 'small' : 'full' }; } catch { /* kept out anyway */ } }
        this.landed(m, r.caught, r.cooler);
        if (m.vis) m.vis.caught = { id: r.caught.find || r.caught.species, find: !!r.caught.find, kg: r.caught.kg || 0, cm: r.caught.cm || 0, kept: !!r.caught.kept && !r.caught.released, size: r.caught.size || '' };
        this.phase(m, 'show', SHOW_MS);
        return;
      }
      case 'show': this.phase(m, 'rest', m.rng.float(3000, 6500)); return;
      default: this.phase(m, 'rest', 1000);
    }
  }
  /** A catch, told: a bubble over its head, its owner's page, a word of its own for a notable one. */
  landed(m, k, cooler) {
    m.landed++; this.stats.landed++;
    const find = k.find ? findOf(k.find) : null, sp = k.species ? speciesOf(k.species) : null;
    if (!find && !sp) return;
    const what = find ? find.name : `${kgWords(k.kg)} ${sp.name}`;
    const notable = !!sp && (k.size === 'trophy' || k.legend || ['rare', 'epic', 'legendary'].includes(sp.rarity));
    if (sp && (!m.best || k.kg > m.best.kg)) m.best = { species: sp.id, kg: k.kg };
    const one = `${an(what)} ${what}!`;
    this.say(m.i, find ? `🎣 Pulled up ${an(find.name)} ${find.name}!` : `🎣 ${notable ? `${k.size === 'trophy' ? '👑 ' : ''}What a fish — ${one}` : one.charAt(0).toUpperCase() + one.slice(1)}${k.released === 'small' ? ' — a small one, back it goes' : k.released ? ' (no room in the cooler — let it go)' : ''}`);
    this.toAccount(m.owner, { t: 'crew_catch', agent: m.agent, i: m.i, name: m.name, text: find ? `${m.name} pulled up ${an(find.name)} ${find.name}` : `${m.name} landed ${an(what)} ${what}!`,
      species: sp?.id || null, find: find?.id || null, kg: k.kg || 0, cm: k.cm || 0, size: k.size || null, rarity: sp?.rarity || null, rarityLabel: sp ? RARITY[sp.rarity]?.label || sp.rarity : null, kept: !!k.kept, cooler: cooler || null });
    if (notable) this.remark(m.i, `I just landed ${an(what)} ${what} from ${this.nameOf(m.owner)}'s boat${k.size === 'trophy' ? ' — a trophy' : ''}!`);
  }
  lost(m, h) {
    m.lost++; this.stats.lost++;
    if (h.what?.kind === 'fish' && (h.what.size === 'trophy' || h.what.size === 'large')) {
      m.lostBig = true;   // (a reason to think its plan over: ./fishing-tactics.js due)
      this.say(m.i, h.out === 'snap' || h.out === 'bite' ? '🎣 The line snapped — a big one, too!' : '🎣 Lost it — that was a big one!');
    }
  }

  // ------------------------------------------------------------------------------------------------ what the pages draw
  /** The crew aboard boats now, for the harbour's frames (server/world/boats.js tick): [[boat id, body index, spot, phase,
   *  seq, detail]] — phase is PHASES' index (what its body does: render/boat-crew.js), seq changes with each new phase.
   *  Those still walking down the pier are drawn walking by the simulation, not here. detail (what the pages draw of its
   *  fishing, as a player's own is drawn: render/crew-fishing.js) — casting, waiting, reeling in: [d0 (dm), lure (0 under a
   *  bobber, 1 a lure)]; fighting: + [what, find (1), kg (g), seed, secs (ds), landed (1), skill (%), cm, push (-1 easy … 1 hard)]; netting and holding
   *  it up: + [what, find, kg (g), cm, kept (1)]; else 0. */
  rows() {
    const out = [], now = this.sim?.now?.() ?? 0;
    for (const m of this.crew.values()) {
      const a = this.sim?.agents[m.i];
      if (!a?.ride || a.ride.boat !== m.boat || (a.ride.until && now < a.ride.until)) continue;
      out.push([m.boat, m.i, m.spot, Math.max(0, PHASES.indexOf(m.phase)), m.seq, this.detail(m)]);
    }
    return out;
  }
  detail(m) {
    const v = m.vis;
    if (!m.fishing || !v) return 0;
    const base = [Math.round((v.d0 || 0) * 10), v.kind ? 1 : 0];
    if (m.phase === 'fight' && v.fish) { const f = v.fish; return [...base, f.id, f.find ? 1 : 0, Math.round(f.kg * 1000), f.seed, Math.round(f.secs * 10), f.out, Math.round((f.skill || 0.7) * 100), Math.round(f.cm || 0), f.push || 0]; }
    if ((m.phase === 'net' || m.phase === 'show') && (v.caught || v.fish)) { const c = v.caught || v.fish; return [...base, c.id, c.find ? 1 : 0, Math.round((c.kg || 0) * 1000), Math.round(c.cm || 0), c.kept ? 1 : 0]; }
    if (m.phase === 'cast' || m.phase === 'wait' || m.phase === 'reel') return base;
    return 0;
  }
  /** One companion's fishing, for its owner's views and the tests. */
  view(agentId) {
    const m = this.crew.get(Number(agentId));
    if (!m) return null;
    const b = this.harbour?.all.get(m.boat);
    return { agent: m.agent, boat: m.boat, spot: b ? BOATS[b.type].deck.spots[m.spot]?.name : null, phase: m.phase, fishing: m.fishing, run: m.run?.id || null, trip: m.run?.course || null,
      landed: m.landed, lost: m.lost, best: m.best, lure: m.lure, lastTrip: m.lastTrip || null };
  }

  // ------------------------------------------------------------------------------------------------ the interaction registry
  /** The registry's source for fishing (server/interactions/registry.js): getting on its owner's boat, fishing on the
   *  trip, putting the rod away, selling the catch at a dock store. */
  source() {
    return { id: 'fishing', kinds: ['board', 'fish', 'stop', 'sell', 'buy'], notes: true, near: ctx => this.near(ctx), run: (ctx, aff, params) => this.run(ctx, aff, params) };   // (notes: its diary lines are its own)
  }
  /** What it can do here now (ctx: the registry's — rec, i, a, leader). */
  near(ctx) {
    const out = [], rec = ctx?.rec, a = ctx?.a, H = this.harbour;
    if (!rec || !a || !H) return out;
    const m = this.crew.get(rec.id), fun = USES.fish?.rate?.fun ?? 0;
    if (m && a.ride?.boat === m.boat && !a.ride.leaving) {
      const b = H.all.get(m.boat), owner = this.nameOf(m.owner), spot = b ? BOATS[b.type].deck.spots[m.spot]?.name : 'side', trip = this.play.runOf(m.owner);
      const at = b ? this.spotAt(b, m.spot) : null, where = at ? { x: at.x, z: at.z, ctx: CTX_OUT, place: `${owner}'s boat` } : null;
      const left = this.baitLeft(m);
      if (m.fishing) out.push({ key: 'stop', kind: 'stop', label: `Put the rod away (fishing from the ${spot}: ${m.landed} landed so far${left ? `; bait left this trip: ${left}` : ''})`, where, cost: null, effects: {}, withLeader: true, d: 0 });
      else if (trip?.module === 'fishing') out.push({ key: 'fish', kind: 'fish', label: `Fish from the ${spot} of ${owner}'s boat with them (${TRIP_BY_ID[trip.course]?.label || 'their trip'})`, where, cost: null, effects: { fun }, withLeader: true, d: 0 });
      return out;
    }
    const lead = ctx.leader?.account ?? null, b = lead != null ? this.boatOfLead(lead) : null;
    if (b) {
      const e = evalPlan(a.plan, this.sim.now()), at = H.place(b), d = Math.hypot(e.x - at.x, e.z - at.z);
      if (d <= BOARD_DOCK_M) out.push({ key: `board:${b.id}`, kind: 'board', label: `Get on ${this.nameOf(lead)}'s ${BOATS[b.type].label} with them (${this.freePlaces(b)} of ${BOATS[b.type].anglers - 1} places free)`, where: { x: at.x, z: at.z, ctx: CTX_OUT, place: `${this.nameOf(lead)}'s boat` }, cost: null, effects: {}, withLeader: true, d: Math.round(d) });
    }
    // its catch, at a dock's store
    const st = this.storeNear(a);
    if (st && this.market) {
      let items = [];
      try { items = this.market.view({ id: -rec.id }, st).items; } catch { items = []; }
      if (items.length) {
        const worth = items.reduce((s, x) => s + x.price * x.qty, 0);
        out.push({ key: `sell:${st.b.idx ?? st.b.id ?? 'store'}`, kind: 'sell', label: `Sell my catch at ${clean(st.b.name || 'the Dock Store', 40)} (${items.length} ${items.length === 1 ? 'thing' : 'things'}, about ${(worth / 100).toFixed(2)} VC)`, where: { x: st.b.x, z: st.b.z, ctx: CTX_OUT, place: st.b.name || 'Dock Store' }, cost: null, effects: {}, withLeader: false, d: Math.round(st.d) });
      }
    }
    // bait and lures at a dock store, with its own money (what it holds of each said: an honest choice)
    if (st && this.angler?.buyForAgent) {
      for (const b of this.baitFor(rec.id, st.b)) out.push({ key: `buy:${b.id}`, kind: 'buy', label: `Buy ${b.pack} ${b.name} at ${clean(st.b.name || 'the Dock Store', 40)} for ${b.price} VC (${b.have ? `I have ${b.have}` : 'I have none of my own'})`, where: { x: st.b.x, z: st.b.z, ctx: CTX_OUT, place: st.b.name || 'Dock Store' }, cost: Math.round(b.price * 100), effects: {}, withLeader: false, d: Math.round(st.d) });
    }
    return out;
  }
  /** The bait and lures for dock store B's water it may buy (its fishing level), cheapest first: [{ id, name, pack,
   *  price (VC), have (its own) }]. */
  baitFor(agentId, B) {
    const W = this.worldOf(), mod = modulesOf(W).find(x => Number.isInteger(x.terminal) && W.buildings[x.terminal] === B), water = mod?.kind === 'lakedock' ? 'lake' : 'sea';
    let lvl = 1, have = {}; try { lvl = this.angler.level(-agentId); have = this.angler.holds(-agentId)?.lures || {}; } catch { /* the defaults */ }
    return luresFor(water).filter(l => l.kind !== 'troll' && l.level <= lvl).sort((a, b) => (b.bait ? 1 : 0) - (a.bait ? 1 : 0) || a.price - b.price).slice(0, 4).map(l => ({ id: l.id, name: l.name, pack: l.pack, price: l.price, have: have[l.id] || 0 }));
  }
  /** Buys a pack of `lure` at store B for agent id (its money, its owner's rules): → { ok, bought, n, paid, text }. */
  buyBait(agentId, i, B, lure, packs = 1) {
    let r;
    try { r = this.angler.buyForAgent(agentId, B, { id: lure, packs }); }
    catch (e) {
      const text = e.code === 'approval_required' ? 'its owner must agree to that first' : e.code === 'funds' || /funds|enough/i.test(e.message) ? 'not enough money' : e.message || 'it could not buy that';
      return { ok: false, why: e.code || 'failed', text };
    }
    this.note(agentId, 'activity', `Bought ${r.bought} at ${clean(B.name || 'the Dock Store', 60)} for ${(r.paid / 100).toFixed(2)} VC — your own bait now (${r.n} in all)`);
    this.say(i, `🎣 Bought ${r.bought}`);
    return { ok: true, ...r };
  }
  /** Bait it has left on its trip now, in words ("6 Live Shrimp, 1 Spinnerbait"), or ''. */
  baitLeft(m) {
    const run = m.run && this.play.runs.get(m.run.id), st = run?.state;
    if (!st?.kit?.lures) return '';
    return Object.entries(st.kit.lures).map(([id, n]) => [id, Math.max(0, n - (st.used?.[id] || 0))]).filter(([, n]) => n > 0).map(([id, n]) => `${n} ${LURE_BY_ID[id]?.name || id}`).join(', ') || 'none';
  }
  /** A dock store its body is at (inside it, or by it): { b, d } or null. */
  storeNear(a) {
    const W = this.worldOf(), e = evalPlan(a.plan, this.sim.now());
    if (e.ctx >= 0) { const B = W?.buildings?.[e.ctx >> 6]; return B && B.tackle && !B.gone ? { b: B, d: 0 } : null; }
    let best = null;
    for (const B of W?.buildings || []) {
      if (!B || B.gone || !B.tackle) continue;
      const d = Math.hypot(B.x - e.x, B.z - e.z) - Math.max(B.w || 0, B.d || 0) / 2;
      if (d < 18 && (!best || d < best.d)) best = { b: B, d: Math.max(0, d) };
    }
    return best;
  }
  /** Does what aff says (validated again now): → { ok, kind, text (for the page), brain (for its chat), effects }. */
  run(ctx, aff, params = {}) {
    const rec = ctx?.rec, a = ctx?.a, kind = aff?.kind, H = this.harbour, name = clean(rec?.name || 'It', 40);
    const no = (text, brain) => ({ ok: false, kind, text, brain });
    if (!rec || !a?.plan || !H) return no(`${name} has no body here`, 'your body is not in the city right now');
    const m = this.crew.get(rec.id);
    if (kind === 'fish' || kind === 'stop') {
      if (!m || a.ride?.boat !== m.boat) return no(`${name} is not on a boat`, 'you are not on a boat now: get on your owner\'s boat with them first');
      if (kind === 'stop') {
        if (!m.fishing) return no(`${name} isn't fishing`, 'your rod is already put away');
        this.rodAway(m, 'asked'); m.declined = true; m.wants = false;
        return { ok: true, kind, text: `${name} puts the rod away`, brain: `you put your rod away (${m.landed} landed this trip); you can fish again while the trip lasts`, effects: {} };
      }
      const r = this.startFishing(m, params?.via || ctx.via || 'asked');
      // (no trip yet: it will fish once its owner's begins — kept, and said so)
      if (!r.ok && r.why === 'no_trip') { m.wants = true; return no(`${r.text}; ${name} will fish once it begins`, `there is no fishing trip under way yet: you'll fish as soon as ${this.nameOf(m.owner)} starts one`); }
      if (!r.ok) return no(r.text, `you could not start fishing: ${r.text.toLowerCase()}`);
      const b = H.all.get(m.boat), spot = b ? BOATS[b.type].deck.spots[m.spot].name : 'side', run = this.play.runs.get(m.run?.id), kit = run?.state?.kit || {};
      return { ok: true, kind, text: r.why === 'already' ? r.text : `${name} is fishing from the ${spot}`,
        brain: `you are fishing from the ${spot} of ${this.nameOf(m.owner)}'s boat (${m.run?.label || 'their trip'}) with ${kit.rod && kit.rod !== 'rod_starter' ? 'your own rod' : 'the dock\'s starter rod'} — what you land is yours: it goes in your cooler and you sell it at the dock store when the trip ends`, effects: { fun: USES.fish?.rate?.fun ?? 0 } };
    }
    if (kind === 'board') {
      const lead = ctx.leader?.account ?? null, b = lead != null ? this.boatOfLead(lead) : null;
      if (m && a.ride?.boat === m.boat) return { ok: true, kind, text: `${name} is aboard already`, brain: 'you are on the boat already', effects: {} };
      if (!b) return no(`${name}'s owner is not on a boat`, 'your owner is not on a boat now');
      const r = this.tryBoard(a, rec, b, { name: this.nameOf(lead), id: lead });
      return r.ok ? { ok: true, kind, text: r.text, brain: `you are getting on ${this.nameOf(lead)}'s boat with them: a fishing spot of your own on deck`, effects: {} } : no(r.text, `you could not get on the boat: ${r.text}`);
    }
    if (kind === 'buy') {
      const st = this.storeNear(a);
      if (!st) return no(`${name} is not at a dock store`, 'you are not at a dock store: bait is sold in the marina\'s and the lake dock\'s stores');
      const lure = String(params?.lure || aff?.key?.split(':')[1] || '') || this.baitFor(rec.id, st.b)[0]?.id;
      const r = this.buyBait(rec.id, a.i, st.b, lure, params?.packs || 1);
      return r.ok ? { ok: true, kind, text: `${name} bought ${r.bought} at ${clean(st.b.name || 'the Dock Store', 40)}`, brain: `you bought ${r.bought} at the dock store for ${(r.paid / 100).toFixed(2)} VC — your own now (${r.n} in all); you fish with it on the next trip`, effects: {} } : no(r.text, `you could not buy bait: ${r.text}`);
    }
    if (kind === 'sell') {
      const st = this.storeNear(a);
      if (!st) return no(`${name} is not at a dock store`, 'you are not at a dock store: the fish market is in the marina\'s and the lake dock\'s stores');
      if (!this.market) return no('The fish market is closed', 'the fish market is closed here');
      const r = this.sell(rec.id, st.b);
      return r.ok ? { ok: true, kind, text: `${name} ${r.text} at ${clean(st.b.name || 'the Dock Store', 40)}`, brain: `you ${r.text} at the dock store: the money is in your wallet`, effects: {} } : no(r.text, `you could not sell: ${r.text}`);
    }
    return no('Nothing like that to do here', 'there is nothing like that to do here');
  }
  /** A plain command from its owner (the reflex: 'fish', 'unfish', 'board') → { ok, action, text, brain } or null. */
  command(P, rec, action, via = 'chat', ctxOf = null) {
    const ctx = ctxOf ? ctxOf(rec) : null;
    if (!ctx?.a) return null;
    // "buy some bait": at a dock store now — bought; else it will, the next time it is at one (its owner going there)
    if (action === 'buybait') {
      const st = this.storeNear(ctx.a), name = clean(rec.name, 40);
      if (st) { const r = this.run({ ...ctx, via }, { kind: 'buy' }); return { ok: r.ok, action, text: r.text, brain: r.brain }; }
      this.wantBait.set(rec.id, this.now());
      return { ok: true, action, text: `${name} will buy bait at the next dock store you go to`, brain: 'you said yes to buying bait: you are not at a dock store now — you buy some (with your own money) as soon as you are at one; you hold no bait you bought yet, so don\'t say you do' };
    }
    const kind = action === 'unfish' ? 'stop' : action === 'board' ? 'board' : 'fish';
    const m = this.crew.get(rec.id);
    // "let's fish" on the dock while its owner is on a boat: on board first
    if (kind === 'fish' && !m && ctx.leader && this.boatOfLead(ctx.leader.account)) {
      const r = this.run({ ...ctx, via }, { kind: 'board' });
      return { ok: r.ok, action, text: r.text, brain: r.ok ? `${r.brain}; you'll fish once you are aboard and the trip is on` : r.brain };
    }
    // "let's go fishing" on the shore, its owner on no boat yet: a yes to it — it gets on with them and fishes once the
    // trip is on (2026-11-17: "Sam is not on a boat", said twice on the beach, was a no to a plan nobody had made yet)
    if (kind === 'fish' && !m && !(ctx.leader && this.boatOfLead(ctx.leader.account))) {
      this.keen.set(rec.id, this.now());
      const owner = ctx.leader?.name || 'your owner', name = clean(rec.name, 40);
      return { ok: true, action, text: `${name} is up for fishing — they'll get on the boat with you`, brain: `you said yes to fishing: when ${owner} takes a boat out you get on with them and fish once the trip is on — you are not on a boat yet, so don't say you are` };
    }
    const r = this.run({ ...ctx, via }, { kind });
    return { ok: r.ok, action, text: r.text, brain: r.brain };
  }
}
