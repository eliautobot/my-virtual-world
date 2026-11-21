// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions in the simulation (docs/features/companions.md): how an AI agent's body goes with someone — a player or
// another resident — waits somewhere, rides in its leader's car and gets out beside it. The orders themselves (who, until
// when, who gave them) are the Brain's (server/sim/agents.js order/setOrder); server/companions/ gives them, watches the
// leaders and ends them. Installed on Brain.prototype by agents.js.
//
// - follow: lead = { kind: 'player', id } (an account's player) or { kind: 'person', i } (a resident's body). The body
//   keeps a place in its leader's group — behind it, side by side (slot 0, 1, 2…) — walking, jogging or running to keep
//   up; anywhere its leader goes (a companion goes where its owner takes it, homes and offices too). A leader standing
//   still: it waits beside them. A player in sim mode (its body parked, "observing"): it waits beside the parked body. A
//   player who left: it waits where they were (server/companions/ ends it after a while).
// - hold: spot = { x, z, ctx, place }: it goes there and waits — alone ("Waiting at …") or as a meet-up with the others
//   given the same group ("Meeting up at …": in a ring round the spot, talking once someone else is there).
// - riding: a.ride = { vid }: hidden in its leader's car, kept at the car's place (server/companions/ moves it along).
// - its own attention (Free Will's moments, server/free-will/moments.js): a.attend = { x, z, until, label } — beside its
//   leader or waiting, it turns to look at that (an animal, someone walking up, what its owner mentioned) instead of at
//   its leader; a.detour = { x, z, ctx, until, label } — it goes over for a closer look, then back to its leader's side.
// - sitting with its leader (2026-11-17, the product owner after a walk with Sam and Lara: "in the park they can't sit down
//   next to me on the bench ... in a restaurant they can't sit down at the table and order food"): o.seat on a follow
//   order (not an order of its own: the outing, its view and its dividers go on) — a seat on its leader's piece (the
//   other end of the bench, another chair at their table, further round the fountain) or near them, held for it as a
//   resident's is (reserve: nobody else sits there), sat on with the city's own slots (slotBegin, slotHold); at a place
//   that serves food, a meal ordered as residents order there and paid from its own money (orderAt, the act's order:
//   the economy's purchase, sim.onAct). It gets up when its leader walks off, drives off or (sat down because they did)
//   gets up. server/companions/ sits it down (sitWith: 'sit', 'eat', or by itself) and gets it up (getUp).
// - using something beside its leader (2026-11-17, the product owner: "companion agents should be able to interact with
//   any current and future object the same way players can"): o.seat with mode 'use' — any piece's slot the world
//   declares (shared/catalog.js slots and their use: an arcade cabinet, the pool table, the dance floor, the piano …), in
//   its leader's space and near them; it plays, dances or plays on there for a while (the slot's own time) and is back
//   at their side, or gets up as soon as they walk off (USE_M). A paid one (an arcade's tokens) is the economy's bill
//   for its first round (the act's kind: the venue's, as a resident's visit), from its own money. useWith; the
//   interaction registry asks for it (server/interactions/).
// Nothing here draws a simulation random number: the city's routines are unchanged (tools/sim-digest.mjs).
import { A, PROP } from '../../shared/anims.js';
import { CATALOG, USE_ID, USES } from '../../shared/catalog.js';
import { GROUND_Y, floorAt, ctxB, ctxF, ctxOf, RUN_SPEED, JOG_SPEED } from '../../shared/constants.js';
import { F_HIDDEN, F_SNAP, CTX_OUT, CTX_UNDER } from '../../shared/proto.js';
import { toWorld, toLocal, footprint, inFootprint } from '../../shared/geom.js';
import { cellCenter } from '../../shared/navgrid.js';
import { hashStr } from '../../shared/rng.js';
import { foodName } from '../../shared/food.js';
import { evalPlan } from './plan.js';
import { deckAt, dockWay } from './dock-walk.js';

const U = USE_ID;
export const COMPANION_KINDS = new Set(['follow', 'hold']);
/** Where each follower stands round its leader (radians from straight behind it, metres away). */
// (beside them first — a companion walks at your side, where you can see it — then a step behind, then further round)
const SLOTS = Object.freeze([[-1.15, 1.9], [1.15, 1.9], [0, 2.6], [-2.0, 2.5], [2.0, 2.5], [Math.PI, 2.2]]);
const AHEAD_S = 0.4;    // s: a moving leader's place this far ahead is where its followers head for (rounds already start
                         // where it will be: leadAt), so they draw level with it rather than trail it
const ALONG_S = 1.2;    // s: at its place beside a moving leader, it walks on with it this long before looking again
const MAX_SPEED = 6.2;   // m/s: catching up with a running player (a player runs 5.33 m/s; the run's stride keeps the feet)
const NEAR = 1.3;        // m: at its place in the group
const WITH_M = 3;        // m: this close to its leader it is with them (for the first time: server/companions/ says so)
const DIRECT_M = 45;     // m: a walk this short in one space goes straight there when nothing is in the way
const OPEN_M = 160;      // m: …and out beyond the city's streets (a beach, a marina's grounds, open land): the island's footpaths
                         // follow its roads, and someone a stone's throw away across the sand is walked to, not round by a road
const RING = 1.6;        // m: a meet-up's ring round its spot
// sitting with its leader
export const SEAT_NEAR = 0.6;   // m: a body this close to a seat's place is on it (seatAt)
const SEAT_M = 4;        // m: a seat this close to its leader's (or, they standing, to itself) is one to sit on with them
const MEAL_M = 8;        // m: …and for a meal, an eating place this close to their table (their own table first)
const SEAT_FAR_M = 10;   // m: …and when every seat that close is taken, the nearest this far (a third beside a bench for two)
const SHORE_M = 60;      // m: its leader out on the water — the dry ground nearest them this close, where it waits
const MEAL_STAY_M = 18;  // m: eating at a table near its leader (not theirs): on while they stay this close in that place
const STAND_M = 3;       // m: its leader this far from its seat and not sitting: they walked off, it gets up
const SIT_ROUND = 4;     // world minutes a round of sitting (server/companions/ gets it up sooner when its leader goes)
const SEAT_HOLD = 30;    // world minutes ahead a companion's seat is held for it, renewed each round of sitting: free for it
                         // is free over that window (a resident's stay planned there later than that doesn't bar it — the
                         // restaurant's table its owner sits at, 2026-11-17), and whoever is bound for it within the window
                         // goes elsewhere as its time comes near (as for a player sitting: Brain.keepPlayerSeats)
const USE_M = 10;        // m: using something beside its leader (a cabinet next to theirs, the dance floor): while they are
                         // this close, in the same space, it keeps at it; further: it stops and goes on with them
const USE_ROUND = 6;     // world minutes a round of using it (the whole use: the slot's own time, or what was asked)
/** The venues where using their things is what one pays for (a resident's visit there, its act's kind: an arcade's
 *  tokens to play, a gym's session); elsewhere using something beside its leader costs nothing (a drink is ordered:
 *  'eat'). */
const PAID_USE = Object.freeze(new Set(['arcade', 'gym']));
/** The seats one sits down on with someone (not a desk, a bed, a machine or a stage), and what sitting there is. */
const SIT_USE = Object.freeze({ bench: 'bench', relax: 'relax', eat: 'chat', chat: 'chat', meeting: 'chat' });
const SIT_USES = new Set(Object.keys(SIT_USE)), EAT_USES = new Set(['eat']);
/** The places that serve what one sits down to eat or drink, as residents order there (agents.js mealAt, barVisit,
 *  loungeBarVisit, clubVisit): a meal, or a drink; and how long it takes (world minutes). (Not an arcade: what residents
 *  pay there is its tokens first.) */
const FOOD_VENUES = Object.freeze({ restaurant: 'meal', cafe: 'meal', lounge_bar: 'bar', club: 'bar' });
const MEAL_MIN = Object.freeze({ restaurant: [28, 50], cafe: [18, 35], lounge_bar: [25, 55], club: [15, 35] });
/** A piece's words where its name alone would not do. */
export const PIECE_WORDS = Object.freeze({ fountain: 'the edge of the fountain' });

/** The gait for a pace (m/s): a walk, a jog, a run (the client keeps the feet to the ground at any pace: its stride). */
function gaitOf(speed) { return speed < 2.1 ? A.walk : speed < 3.3 ? A.jog : A.run; }

/** A spot's height: a building's floor, the city's street level, the island's ground beyond it. */
function yAt(brain, x, z, ctx) {
  if (ctx >= 0) { const B = brain.W.buildings[ctxB(ctx)]; return B ? floorAt(B, ctxF(ctx)) : GROUND_Y; }
  const d = deckAt(brain.W, x, z);   // (a dock's deck over the water: its top)
  if (d) return d.y;
  return brain.nav.beyond(x, z) ? brain.nav.groundY(x, z) : GROUND_Y;
}

export const COMPANION_MOVES = {
  /** Whether a's order is a companion's (it goes with someone or waits somewhere for them). */
  isCompanion(a) { return !!(a.order && (COMPANION_KINDS.has(a.order.kind) || a.order.by)); },
  /** Whether order o is one a person gave it as a companion — to go with them or someone, to wait beside or for them
   *  (not agents off together by their own choice): it holds until they let it go, whatever its own day says (choose). */
  heldByPerson(o) { return !!o && COMPANION_KINDS.has(o.kind) && o.by !== null && o.by !== undefined; },
  /** Where its leader is at sim time t: { x, y, z, ctx, yaw, moving, name, waiting, gone, car } or null (no such
   *  leader any more). A player's comes from the live players (server/companions/ sets sim.leads). */
  leadAt(a, o, t) {
    const L = o.lead;
    if (!L) return null;
    if (L.kind === 'player') {
      const l = this.sim.leads?.player(L.id, a);
      if (!l) return null;
      // (a round planned ahead of time — the city plans everyone a few seconds ahead — starts where a walking player will
      // be by then, on along its way, not where it is now: else its followers trail by those seconds)
      const dt = Math.min(4, t - this.sim.now());
      if (dt > 0.05 && l.moving && !l.car && (l.vx || l.vz)) {
        const x = l.x + l.vx * dt, z = l.z + l.vz * dt, open = this.sim.leads?.open;
        if (!open || open(x, z, l.ctx)) return { ...l, x, z };
      }
      return l;
    }
    const b = this.sim.agents[L.i], p = this.sim.people[L.i];
    if (!b?.plan || !p || p.retired || L.i === a.i) return null;
    const e = evalPlan(b.plan, t), f = evalPlan(b.plan, t + 1);
    const vx = f.ctx === e.ctx ? f.x - e.x : 0, vz = f.ctx === e.ctx ? f.z - e.z : 0;
    return { x: e.x, y: e.y, z: e.z, ctx: e.ctx === CTX_UNDER ? CTX_OUT : e.ctx, yaw: e.yaw, moving: !!(e.s && !e.s.h), vx, vz, name: p.name, hidden: !!(e.s && e.s.flags & F_HIDDEN) };
  },
  /** A walkable spot close to (x, z) on floor ctx (the nav grid's nearest reachable cell), or outdoors the point itself
   *  when it is open ground (else the leader's own place). */
  standAt(ctx, x, z, fx = x, fz = z) {
    if (ctx >= 0) {
      const B = this.W.buildings[ctxB(ctx)];
      if (!B || B.gone) return null;
      const lv = B.lv[ctxF(ctx)], g = this.nav.grid(lv), R = this.nav.reach(lv), L = toLocal(B, x, z);
      let best = null, bd = Infinity;
      for (const c of R.cells) { const q = cellCenter(g, c), d = (q.x - L.x) ** 2 + (q.z - L.z) ** 2; if (d < bd) { bd = d; best = q; } }
      if (!best) return null;
      const w = toWorld(B, best.x, best.z);
      return { ctx, x: w.x, z: w.z, lx: best.x, lz: best.z };
    }
    const ok = this.sim.leads?.open;
    if (!ok || ok(x, z, CTX_OUT) || deckAt(this.W, x, z, -0.25)) return { ctx: CTX_OUT, x, z };   // (a dock's deck, over the water: ground to stand on)
    return { ctx: CTX_OUT, x: fx, z: fz };
  },
  /** Whether one can stand at outdoor (x, z): anywhere but the water — a dock's deck over it is ground too. */
  standable(x, z) { const wet = this.sim.leads?.wet; return !wet || !wet(x, z) || !!deckAt(this.W, x, z, -0.25); },
  /** The nearest place to stand to outdoor (x, z) within SHORE_M (rings outward), or null. */
  shoreNear(x, z) {
    if (this.standable(x, z)) return { ctx: CTX_OUT, x, z };
    for (let r = 2; r <= SHORE_M; r += 2) for (let k = 0; k < 16; k++) {
      const px = x + Math.sin(k * 0.3927) * r, pz = z + Math.cos(k * 0.3927) * r;
      if (this.standable(px, pz)) return { ctx: CTX_OUT, x: px, z: pz };
    }
    return null;
  },
  /** Its leader out on the water: over to the shore nearest them (or where it stands, on dry ground already), and waiting
   *  there, facing them. */
  waitAshore(a, P, L) {
    const t0 = P.t, to = this.shoreNear(L.x, L.z) || (this.standable(P.x, P.z) ? { ctx: CTX_OUT, x: P.x, z: P.z } : this.shoreNear(P.x, P.z));
    const place = this.nav.addressAt(P.x, P.z);
    if (to && this.sameSpace(P.ctx, CTX_OUT)) {
      const d = Math.hypot(to.x - P.x, to.z - P.z);
      if (d > NEAR && this.goToward(a, P, to, d)) {
        this.act(a, 'follow', 'walk', P, { ctx: CTX_OUT, label: `Going down to the water's edge near ${L.name}`, icon: '🧭', place, arrive: P.t, holdStart: P.t, holdEnd: P.t });
        return true;
      }
    }
    const hs = P.t;
    P.hold(this.wm(1), A.idle, U.wait, 0, Math.atan2(L.x - P.x, L.z - P.z));
    this.act(a, 'follow', 'wait', P, { ctx: P.ctx, label: `Waiting on the shore for ${L.name}`, icon: '⏳', place, arrive: t0, holdStart: hs, holdEnd: P.t });
    return true;
  },
  /** Its place in the group round leader L (slot k), on walkable ground. */
  slotSpot(L, k) {
    const [ang, dist] = SLOTS[k % SLOTS.length];
    // a moving leader: where it will be a moment from now, facing the way it goes (its yaw when it stands)
    const v = Math.hypot(L.vx || 0, L.vz || 0), moving = L.moving && v > 0.3;
    const lx = moving ? L.x + L.vx * AHEAD_S : L.x, lz = moving ? L.z + L.vz * AHEAD_S : L.z;
    const yaw = moving ? Math.atan2(L.vx, L.vz) : L.yaw || 0;
    // (behind the way the leader faces: yaw points ahead along +z of its own frame)
    const x = lx - Math.sin(yaw + ang) * dist, z = lz - Math.cos(yaw + ang) * dist;
    return this.standAt(L.ctx, x, z, L.x, L.z);
  },
  /**
   * Goes on plan P to spot s (a { ctx, x, z, lx?, lz? }): straight there when it is close in the same space and nothing
   * stands in the way, else along the city's ways (doors, lifts, streets, the subway, a drive). Faster the farther it is.
   */
  goToward(a, P, s, dist, pace = 0) {
    // (keeping up: a moving leader's own pace and a little more the farther behind; a jog a few steps behind, running
    // when far — a player walks faster than a resident strolls, and a running player is caught up with)
    const speed = pace > 0.3 ? Math.min(MAX_SPEED, Math.max(1.2, pace + dist * 0.9, dist > 11 ? RUN_SPEED : 0))
      : dist > 11 ? RUN_SPEED : dist > 3.5 ? JOG_SPEED : Math.max(1.7, a.p.speed || 1.35);
    const anim = gaitOf(speed);
    if (P.ctx === CTX_UNDER) P.ctx = CTX_OUT;
    const clear = this.sim.leads?.clear;
    // (from a park's grounds, where it sat down, out on the park's open ground with its leader: one space — pc)
    const pc = s.ctx === P.ctx ? P.ctx : this.openCtx(P.ctx);
    const open = pc === CTX_OUT && (this.nav.beyond?.(P.x, P.z) || this.nav.beyond?.(s.x, s.z));
    if (s.ctx === pc && dist <= (open ? OPEN_M : DIRECT_M) && clear && clear(P.x, P.z, s.x, s.z, pc)) {
      P.move(s.x, yAt(this, s.x, s.z, s.ctx), s.z, speed, anim, U.walk, { ctx: s.ctx });
      return true;
    }
    const t0 = P.t;
    // (on a dock's decks, or going on to one: the dock's own way — ./dock-walk.js — the city's stops at the water's edge)
    if (s.ctx === CTX_OUT && pc === CTX_OUT) {
      const dw = dockWay(this.W, P, s);
      if (dw) {
        const o = () => this.topt(a, { speed, anim, use: U.walk }, P.t);
        // (the legs on land — to the dock's quay, or on from it — straight across the marina's grounds when nothing is in
        //  the way, as any short walk is; the city's ways only when they must: 2026-11-20, the product owner "they always go to the very
        //  entrance of the fishing module and come back" — the street router's way to the quay began at the module's
        //  entrance, the street access nearest them)
        const onLand = (to) => {
          const d = Math.hypot(to.x - P.x, to.z - P.z);
          if (d <= 1) return;
          const lim = this.nav.beyond?.(P.x, P.z) || this.nav.beyond?.(to.x, to.z) ? OPEN_M : DIRECT_M;
          if (d <= lim && clear && clear(P.x, P.z, to.x, to.z, CTX_OUT)) P.move(to.x, yAt(this, to.x, to.z, CTX_OUT), to.z, speed, anim, U.walk, { ctx: CTX_OUT });
          else this.router.travel(P, { ctx: CTX_OUT, x: to.x, z: to.z }, o());
        };
        if (dw.land) onLand(dw.land);
        for (const q of dw.pts) if (Math.hypot(q.x - P.x, q.z - P.z) > 0.05) P.move(q.x, q.y, q.z, speed, anim, U.walk, { ctx: CTX_OUT });
        if (dw.then) onLand(dw.then);
        return P.t > t0;
      }
    }
    if (pc !== P.ctx && s.ctx === CTX_OUT) {
      // (still within that park, something in the way: round it on the park's own ways, not out by its gate and back)
      const B = this.W.buildings[ctxB(P.ctx)];
      if (inFootprint(B, s.x, s.z)) { const l = toLocal(B, s.x, s.z); this.router.travel(P, { ctx: P.ctx, x: s.x, z: s.z, lx: l.x, lz: l.z }, this.topt(a, { speed, anim, use: U.walk }, P.t)); return P.t > t0; }
    }
    this.router.travel(P, s, this.topt(a, { speed, anim, use: U.walk }, P.t));
    return P.t > t0;
  },
  /** One round of following its leader. False when there is nobody to follow any more (the order ends). */
  followStep(a, P, o) {
    const L = this.leadAt(a, o, P.t);
    if (!L) { o.ended = 'leader_gone'; return false; }
    o.leadName = L.name;
    if (a.ride) { a.detour = null; if (o.seat) this.seatEnd(a, o, 'car'); return this.rideStep(a, P, o, L); }
    // (sitting with them: a round on its seat — or, the seat over, up and on with them)
    if (o.seat && this.seatStep(a, P, o, L)) return true;
    if (a.detour && this.detourStep(a, P, L)) return true;
    const k = Number.isInteger(o.slot) ? o.slot : 0;
    const s = this.slotSpot(L, k);
    if (!s) { o.ended = 'leader_gone'; return false; }
    // (its leader out on the water — swimming, on a boat it isn't aboard —: it waits on the shore nearest them, never wades
    //  in after them; 2026-11-19, Lara "in the water off Marina Road")
    if (s.ctx < 0 && !this.standable(s.x, s.z)) return this.waitAshore(a, P, L);
    // a leader on the move (not in a car): its pace, and where it is heading
    const pace = L.moving && !L.car ? Math.hypot(L.vx || 0, L.vz || 0) : 0, going = pace > 0.3;
    a.fspot = { x: s.x, z: s.z, ctx: s.ctx, lx: L.x, lz: L.z, lctx: L.ctx, lvx: going ? L.vx : 0, lvz: going ? L.vz : 0, at: P.t };
    const dist = this.sameSpace(s.ctx, P.ctx) ? Math.hypot(s.x - P.x, s.z - P.z) : Infinity;
    const label = L.label || (L.gone ? `Waiting for ${L.name}` : L.waiting ? `Waiting with ${L.name}` : `With ${L.name}`);   // (L.label: its leader's own words — waiting for them to land: server/play/flight-crew.js)
    const place = s.ctx >= 0 ? this.placeName(ctxB(s.ctx), ctxF(s.ctx)) : this.nav.addressAt(s.x, s.z);
    const t0 = P.t;
    if (!o.reached && this.sameSpace(P.ctx, L.ctx) && Math.hypot(L.x - P.x, L.z - P.z) <= WITH_M) o.reached = P.t;
    if (dist > NEAR && !this.goToward(a, P, s, Number.isFinite(dist) ? dist : 60, going ? pace : 0)) {
      // no way there now (a floor it can't reach): it waits where it is and looks again soon
      P.hold(this.wm(0.5), A.idle, U.wait, 0, Math.atan2(L.x - P.x, L.z - P.z));
      this.act(a, 'follow', 'wait', P, { ctx: P.ctx, label: `Looking for ${L.name}`, icon: '🧭', place, holdStart: t0, holdEnd: P.t, arrive: t0 });
      return true;
    }
    const hs = P.t;
    if (!o.reached && dist <= NEAR) o.reached = P.t;   // (with them for the first time: server/companions/ may have it say so)
    // beside a leader on the move: it walks on with it, at its pace, the way it goes (no stop-and-go: the next round
    // follows on, and server/companions/ re-plans it the moment the leader turns, stops or speeds up)
    if (going && this.sameSpace(P.ctx, L.ctx) && P.t - t0 < 4) {
      const nx = P.x + L.vx * ALONG_S, nz = P.z + L.vz * ALONG_S, clear = this.sim.leads?.clear, pc = L.ctx === P.ctx ? P.ctx : this.openCtx(P.ctx);
      if (clear && clear(P.x, P.z, nx, nz, pc)) {
        P.move(nx, yAt(this, nx, nz, pc), nz, pace, gaitOf(pace), U.walk, { ctx: pc });
        this.act(a, 'follow', 'walk', P, { ctx: P.ctx, label, icon: '🧭', place, arrive: P.t, holdStart: P.t, holdEnd: P.t });
        return true;
      }
    }
    // beside them: a short look (they move on: the next round, or server/companions/ when they walk off, catches up);
    // waiting for someone who isn't walking — a parked body, a player gone for a moment — with its phone, longer
    const still = L.gone || L.waiting;
    // (something has its attention: it looks at that, standing by its leader)
    const at = this.attention(a, P);
    const face = at ? Math.atan2(at.x - P.x, at.z - P.z) : Math.atan2(L.x - P.x, L.z - P.z);
    if (at) P.hold(this.wm(L.moving ? 0.3 : 1.2), A.idle, U.wait, 0, face);
    else if (still) P.hold(this.wm(2), A.phone, U.phone, PROP.phone, face);
    else P.hold(this.wm(L.moving ? 0.3 : 1.2), A.idle, U.greet, 0, face);
    this.act(a, 'follow', at ? 'wait' : still ? 'phone' : 'greet', P, { ctx: P.ctx, label: at ? `${label} — ${at.label}` : label, icon: L.gone || L.waiting ? '⏳' : at ? '👁' : '🧭', place, arrive: hs, holdStart: hs, holdEnd: P.t });
    return true;
  },
  /** What has its attention now (a.attend, still fresh): { x, z, label } or null. */
  attention(a, P) {
    const t = a.attend;
    if (!t) return null;
    if (P.t > t.until) { a.attend = null; return null; }
    return t;
  },
  /** Going over for a closer look (a.detour) while its leader stays near: there, then a moment looking, then back. False
   *  when it is over (its leader went on, the time is up, it can't get there): the round goes on as following. */
  detourStep(a, P, L) {
    const d = a.detour;
    if (P.t > d.until || P.ctx !== d.ctx || L.ctx !== d.ctx || Math.hypot(L.x - d.x, L.z - d.z) > 45 || (L.moving && Math.hypot(L.vx || 0, L.vz || 0) > 0.5)) { a.detour = null; return false; }
    // (a few steps short of it, on its own side: an animal is not walked into)
    const dx = d.x - P.x, dz = d.z - P.z, len = Math.hypot(dx, dz) || 1, stop = Math.min(len, d.near ?? 3);
    const s = this.standAt(d.ctx, d.x - dx / len * stop, d.z - dz / len * stop, P.x, P.z);
    if (!s) { a.detour = null; return false; }
    const dist = Math.hypot(s.x - P.x, s.z - P.z), t0 = P.t, place = d.ctx >= 0 ? this.placeName(ctxB(d.ctx), ctxF(d.ctx)) : this.nav.addressAt(s.x, s.z);
    if (dist > NEAR) {
      if (!this.goToward(a, P, s, dist)) { a.detour = null; return false; }
      this.act(a, 'follow', 'walk', P, { ctx: P.ctx, label: `Going over to ${d.label}`, icon: '👁', place, arrive: P.t, holdStart: P.t, holdEnd: P.t });
      return true;
    }
    // there: it looks a while (then the detour is done, and it goes back to its leader's side)
    if (!d.there) d.there = P.t;
    P.hold(this.wm(1.5), A.idle, U.wait, 0, Math.atan2(d.x - P.x, d.z - P.z));
    this.act(a, 'follow', 'wait', P, { ctx: P.ctx, label: `Looking at ${d.label}`, icon: '👁', place, arrive: t0, holdStart: t0, holdEnd: P.t });
    if (P.t - d.there >= (d.look ?? this.wm(6))) a.detour = null;
    return true;
  },
  /** Free Will's attention for a's body (server/free-will/moments.js): look at (x, z) for `secs` sim seconds. */
  attendTo(a, { x, z, label = 'something', secs = 8 } = {}) {
    if (!a?.plan || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    a.attend = { x, z, label: String(label).slice(0, 80), until: this.sim.now() + secs };
    if (a.order && !a.ride) this.reorder(a);
    return true;
  },
  /** Free Will's choice to go over for a closer look at (x, z) on ctx — while following someone who isn't walking on. */
  goSee(a, { x, z, ctx = CTX_OUT, label = 'have a look', secs = 40, near = 3 } = {}) {
    if (!a?.plan || !a.order || a.order.kind !== 'follow' || a.ride || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    a.detour = { x, z, ctx, label: String(label).slice(0, 80), until: this.sim.now() + secs, near };
    this.reorder(a);
    return true;
  },
  /** In its leader's car: hidden there, at the car's place, a few seconds at a time (server/companions/ moves it along). */
  rideStep(a, P, o, L) {
    const hs = P.t, R = a.ride;
    // (a ride with a place of its own — its fishing spot on its leader's boat, server/play/fishing-crew.js —: there, with
    //  that ride's words and activity; else the car's)
    const own = Number.isFinite(R.x) && Number.isFinite(R.z);
    const x = own ? R.x : L.car ? L.car.x : L.x, z = own ? R.z : L.car ? L.car.z : L.z, yaw = Number.isFinite(R.yaw) ? R.yaw : L.car?.yaw ?? P.yaw;
    const use = R.use && U[R.use] !== undefined ? R.use : 'commute', y = Number.isFinite(R.y) ? R.y : yAt(this, x, z, CTX_OUT);
    // (to where the car is now over the next second — it is looked at again then — and on there a moment)
    P.seg(1, x, y, z, yaw, A.idle, U[use], 0, F_HIDDEN, CTX_OUT);
    P.hold(this.wm(0.6), A.idle, U[use], 0, yaw, F_HIDDEN);
    this.act(a, 'follow', use, P, { ctx: CTX_OUT, label: R.label || `Riding with ${L.name}`, icon: R.icon || '🚗', place: this.nav.addressAt(x, z), arrive: hs, holdStart: hs, holdEnd: P.t });
    return true;
  },
  /** One round of waiting at its spot — alone, or meeting up with the others of its group there. */
  holdStep(a, P, o) {
    const sp = o.spot;
    if (!sp) return false;
    // (in an aircraft it flies itself — sent to its door to fly a ring course, server/play/flight-crew.js —: hidden there,
    //  carried along as a ride with a place of its own)
    if (a.ride && Number.isFinite(a.ride.x) && Number.isFinite(a.ride.z)) return this.rideStep(a, P, o, { name: sp.place || '' });
    const n = Number.isInteger(o.slot) ? o.slot : 0, members = o.group ? this.sim.leads?.group?.(o.group) || [] : [];
    // a meet-up: each in its own place round the spot (a ring), so the group stands together
    let x = sp.x, z = sp.z;
    if (members.length > 1) { const ang = (n / members.length) * Math.PI * 2; x += Math.sin(ang) * RING; z += Math.cos(ang) * RING; }
    const s = this.standAt(sp.ctx, x, z, sp.x, sp.z);
    if (!s) { o.ended = 'nowhere'; return false; }
    const dist = s.ctx === P.ctx ? Math.hypot(s.x - P.x, s.z - P.z) : Infinity;
    const place = sp.place || (s.ctx >= 0 ? this.placeName(ctxB(s.ctx), ctxF(s.ctx)) : this.nav.addressAt(s.x, s.z));
    const meeting = !!o.group && members.length > 1;
    const t0 = P.t;
    if (dist > NEAR && !this.goToward(a, P, s, Number.isFinite(dist) ? dist : 60)) { o.ended = 'nowhere'; return false; }
    const at = this.attention(a, P), arrived = P.t, face = at ? Math.atan2(at.x - P.x, at.z - P.z) : Math.atan2(sp.x - P.x, sp.z - P.z);
    if (!o.reached && dist <= NEAR) { o.reached = P.t; this.setOrder(a, o); }
    // the others of the meet-up who are there already: they talk; alone, it waits (on its phone now and then)
    const here = meeting ? members.filter(j => j !== a.i && this.sim.agents[j]?.act?.kind === 'follow' && this.sim.agents[j].act.holdStart <= P.t + 1).length : 0;
    if (here > 0) P.hold(this.wm(3), A.talk, U.chat, 0, face);
    else P.hold(this.wm(meeting ? 1.5 : 3), (a.i + Math.floor(P.t / 30)) % 3 === 0 ? A.phone : A.idle, U.wait, (a.i + Math.floor(P.t / 30)) % 3 === 0 ? PROP.phone : 0, face);
    const label = meeting ? `Meeting up at ${place}` : o.goal ? o.goal : `Waiting at ${place}`;
    this.act(a, 'follow', here > 0 ? 'chat' : 'wait', P, { ctx: P.ctx, label, icon: meeting ? '👥' : '📍', place, arrive: t0 === arrived ? arrived : arrived, holdStart: arrived, holdEnd: P.t });
    return true;
  },
  // ------------------------------------------------------------------ seats
  /** Whether ctx is a park's grounds (residents walk a park as its own floor; players at street level: CTX_OUT). */
  parkCtx(ctx) { if (!(ctx >= 0)) return false; const B = this.W.buildings[ctxB(ctx)]; return !!B && !B.gone && B.type === 'park'; },
  /** A park's grounds as the open ground they are (CTX_OUT); any other place as it is. */
  openCtx(ctx) { return this.parkCtx(ctx) ? CTX_OUT : ctx; },
  /** Whether two places are one space to walk about in: the same floor, or the street and a park's grounds. */
  sameSpace(c1, c2) { return c1 === c2 || (c1 === CTX_OUT && this.parkCtx(c2)) || (c2 === CTX_OUT && this.parkCtx(c1)); },
  /** The park whose grounds (x, z) is on, or null (the parks' footprints, kept while the city's venues stay the same). */
  parkAt(x, z) {
    const list = this.index.venues.park || [];
    if (this._parks?.of !== list) {
      const parks = [];
      for (const v of list) { const B = this.W.buildings[v.b]; if (B && !B.gone && B.type === 'park' && !parks.some(p => p.B === B)) parks.push({ B, r: footprint(B) }); }
      this._parks = { of: list, parks };
    }
    for (const p of this._parks.parks) if (x >= p.r.x0 && x <= p.r.x1 && z >= p.r.z0 && z <= p.r.z1 && inFootprint(p.B, x, z)) return p.B;
    return null;
  },
  /** The seats on floor f of building b (a park: its grounds) in the building's own frame, kept while its furniture stays
   *  the same: { list: [{ id, k, lx, lz, use, t, anim }], cell: 'i,j' (a metre's cell) → [those there] }, or null. */
  seatsOn(b, f) {
    const B = this.W.buildings[b];
    if (!B || B.gone || !(f >= 0) || f >= B.floors) return null;
    const lv = B.lv[f], m = this.index.slots(lv);
    if (this._seats?.idx !== this.index) this._seats = { idx: this.index, lv: new Map() };
    let c = this._seats.lv.get(lv);
    if (!c || c.m !== m) {
      c = { m, list: [], cell: new Map() };
      for (const [id, e] of m) for (const s of e.slots) {
        if (!s.seated) continue;
        const r = { id, k: s.k, lx: s.lx, lz: s.lz, use: s.use, t: e.it.t, anim: s.anim }, key = `${Math.floor(s.lx)},${Math.floor(s.lz)}`;
        c.list.push(r);
        (c.cell.get(key) || c.cell.set(key, []).get(key)).push(r);
      }
      this._seats.lv.set(lv, c);
    }
    return c;
  },
  /**
   * The seat a body at (x, z) on ctx is on — indoors by its building and floor, outdoors in a park's grounds or on a
   * decoration (a bench on open land, a dock's picnic table: ./decor-seats.js) — within SEAT_NEAR of it (a player
   * sitting: PF_USING; a resident): { b, f, id, k, key, ctx, x, z, use (the slot's: 'bench', 'eat', 'relax', …), item (its
   * catalog type), words ("a bench", "the edge of the fountain", "a table at «Restaurant 16»", "an armchair", "a bench at
   * «Bayside Marina»"), venue: { kind, name } | null } (a decoration's: dec, its id; b, f, id −1), or null.
   */
  seatAt(x, z, ctx) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    let b, f;
    if (ctx >= 0) { b = ctxB(ctx); f = ctxF(ctx); }
    else if (ctx === CTX_OUT) { const B = this.parkAt(x, z); if (!B) return this.decorSeatAt(x, z); b = B.idx; f = 0; }
    else return null;
    const c = this.seatsOn(b, f);
    if (!c) return ctx === CTX_OUT ? this.decorSeatAt(x, z) : null;
    const L = toLocal(this.W.buildings[b], x, z), i0 = Math.floor(L.x), j0 = Math.floor(L.z);
    let best = null, bd = SEAT_NEAR;
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (const r of c.cell.get(`${i},${j}`) || []) {
      const d = Math.hypot(r.lx - L.x, r.lz - L.z);
      if (d < bd) { bd = d; best = r; }
    }
    // (a decoration someone placed in the park: on it)
    return best ? this.seatInfo(b, f, best.id, best.k) : ctx === CTX_OUT ? this.decorSeatAt(x, z) : null;
  },
  /** Seat k of piece id on floor f of building b, as seatAt gives it (or null). */
  seatInfo(b, f, id, k) {
    const B = this.W.buildings[b], e = this.index.entry(b, f, id), s = e?.slots[k];
    if (!B || !s) return null;
    const L = this.W.levels[B.lv[f]], kind = L?.venue || (B.type === 'park' ? 'park' : null);
    const w = toWorld(B, s.lx, s.lz), venue = kind ? { kind, name: this.placeName(b, f) } : null;
    return { b, f, id, k, key: this.key(b, f, id, k), ctx: ctxOf(b, f), x: w.x, z: w.z, use: s.use, item: e.it.t, words: this.seatWords(e.it.t, s, venue), venue };
  },
  /** A seat in plain words: "a bench", "the edge of the fountain", "a table at «Restaurant 16»", "an armchair". */
  seatWords(t, s, venue) {
    const name = String(CATALOG[t]?.name || 'seat').replace(/\s*\(.*?\)\s*/g, ' ').trim().toLowerCase().slice(0, 40) || 'seat';
    let w = PIECE_WORDS[t] || (s.use === 'bench' && !/bench/.test(name) ? 'a bench' : null);
    if (!w && s.use === 'eat') w = s.anim === A.sit_high ? `a stool at the ${name}` : /table|booth|banquette|set\b/.test(name) ? 'a table' : `a seat at the ${name}`;
    if (!w) w = `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`;
    return venue && venue.kind !== 'park' && venue.name ? `${w} at «${venue.name}»` : w;
  },
  /** Whether seat (b, f, id, k) is free for body a from now on: nobody else's stay is held there within SEAT_HOLD (its
   *  own is held that far ahead, renewed while it sits: keepSeat), no player is on it. */
  seatFree(a, b, f, id, k) { const now = this.sim.now(); return !this.taken(b, f, id, k, a.i, [now, now + this.wm(SEAT_HOLD)]); },
  /**
   * The free seat for body a to sit down with someone: on their piece `with` (their seat: the other end of the bench,
   * another chair at their table, further round the fountain) first, else the nearest within `radius` m of `near`
   * ({ x, z, ctx }) in the same place; uses: the kinds of seats. → { seat } (seatInfo's) or { why: 'no_seat' | 'full' }.
   */
  pickSeat(a, { near, with: ls = null, uses = SIT_USES, radius = SEAT_M }) {
    // outdoors, the decorations' seats too (./decor-seats.js: a bench on open land, a dock's picnic table) — on theirs
    // first when they sit on one, else whichever is nearest, a park's or a decoration's
    const onDecor = ls?.dec !== undefined, dp = near.ctx === CTX_OUT || onDecor ? this.decorPick(a, near, ls, uses, radius) : null;
    const orDecor = () => (dp?.seat ? { seat: dp.seat } : { why: dp ? 'full' : 'no_seat' });
    if (onDecor && dp?.seat && dp.score < -500) return { seat: dp.seat };
    let b, f;
    if (ls && !onDecor) { b = ls.b; f = ls.f; }
    else if (near.ctx >= 0) { b = ctxB(near.ctx); f = ctxF(near.ctx); }
    else { const B = near.ctx === CTX_OUT ? this.parkAt(near.x, near.z) : null; if (!B) return orDecor(); b = B.idx; f = 0; }
    const c = this.seatsOn(b, f);
    if (!c) return orDecor();
    const L = toLocal(this.W.buildings[b], near.x, near.z);
    let best = null, bs = dp?.seat ? dp.score : Infinity, any = !!dp;
    for (const r of c.list) {
      if (!uses.has(r.use)) continue;
      const same = !!ls && r.id === ls.id;
      if (same && r.k === ls.k) continue;   // (theirs)
      const d = Math.hypot(r.lx - L.x, r.lz - L.z);
      if (!same && d > radius) continue;
      any = true;
      const score = same ? d - 1000 : d;
      if (score < bs && this.seatFree(a, b, f, r.id, r.k)) { bs = score; best = r; }
    }
    return best ? { seat: this.seatInfo(b, f, best.id, best.k) } : dp?.seat ? { seat: dp.seat } : { why: any ? 'full' : 'no_seat' };
  },
  /** Where order o's leader is sitting now (seatAt's), or null: a player on a seat (their page's PF_USING: sim.leads),
   *  a resident on one (its stay in a seat, now). */
  leaderSeatOf(o, t = this.sim.now()) {
    const L = o?.lead;
    if (!L) return null;
    if (L.kind === 'player') return this.sim.leads?.seat?.(L.id) || null;
    const x = this.sim.agents[L.i]?.act;
    if (!x || !(x.k >= 0) || x.holdStart > t || x.holdEnd <= t) return null;
    if (x.dec !== undefined) return this.decorEntry(x.dec)?.slots[x.k]?.seated ? this.decorInfo(x.dec, x.k) : null;   // (a decoration's)
    if (!(x.id >= 0)) return null;
    return this.index.entry(x.b, x.f, x.id)?.slots[x.k]?.seated ? this.seatInfo(x.b, x.f, x.id, x.k) : null;
  },
  /** What body a has at a seat in a place that serves food, as residents order there: { kind: 'meal' | 'bar', use,
   *  order, courses, dur } (order null: nothing on its menu), or null (not such a place). */
  mealFor(a, seat, t, want = null) {
    const v = seat?.venue?.kind, how = FOOD_VENUES[v];
    if (!how) return null;
    // (what it chose from the place's menu — its own words: "the double smash burger and a cola" — when the place has it;
    //  else as residents order there)
    const chosen = this.menuChoice(seat, want);
    const o = chosen ? this.served(chosen) : how === 'meal' ? this.orderAt(a, seat.b, seat.f, 'meal', t) : this.drinkAt(a, t, v, 'c');
    const [lo, hi] = MEAL_MIN[v], u = (hashStr(`${a.p.id}:${Math.round(t)}:meal`) % 1000) / 1000;
    return { kind: how, use: how === 'meal' ? 'eat' : 'bar', order: o.order?.length ? o.order : null, courses: o.courses || null, dur: this.wm(lo + (hi - lo) * u) };
  },
  /** The ids on the menu at seat's place that `want` names (ids, or the dishes' names in its own words), at most three — or
   *  null (nothing asked, or nothing of it on this menu). */
  menuChoice(seat, want) {
    if (!Array.isArray(want) || !want.length || !this.food) return null;
    const menu = this.menuAt(seat.b, seat.f), norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const out = [];
    for (const w of want.slice(0, 3)) {
      const n = norm(w);
      if (!n) continue;
      const id = menu.find(m => m === w) || menu.find(m => norm(foodName(m)) === n) || menu.find(m => norm(foodName(m)).includes(n) || n.includes(norm(foodName(m))));
      if (id && !out.includes(id)) out.push(id);
    }
    return out.length ? out : null;
  },
  /**
   * Sits body a down with its leader (its follow order's): mode 'sit' — a seat on their piece first, else near them
   * (they are not sitting: near itself); 'eat' — at their table in a place that serves food, its meal ordered as
   * residents order there (the economy quoted first: it can't pay, it sits with them without ordering). auto: it sat
   * down because they did (it gets up when they do). The round is planned at once (it walks over and sits; its seat is
   * held for it). → { ok: true, seat (o.seat), lead (their seat or null), arrive (sim time it sits) } or { ok: false,
   * why: 'not_following' | 'riding' | 'leader_gone' | 'not_seated' | 'not_food' | 'no_seat' | 'full' | 'taken', lead }.
   */
  sitWith(a, { mode = 'sit', auto = false, want = null } = {}) {
    const now = this.sim.now(), o = a.plan ? this.liveOrder(a, now) : null;
    if (!o || o.kind !== 'follow' || !o.lead) return { ok: false, why: 'not_following', lead: null };
    const L = this.leadAt(a, o, now);
    if (!L || L.gone) return { ok: false, why: 'leader_gone', lead: null };
    if (a.ride || L.car) return { ok: false, why: 'riding', lead: null };
    const ls = this.leaderSeatOf(o, now), eat = mode === 'eat';
    // (a meal: at their table — or, they on a sofa or standing at the counter in a place that serves food, at a table near
    //  them there: 2026-11-18, at The Roastery with its owner on the sofa it had no way to eat beside them)
    const atTable = !!(ls && ls.use === 'eat' && FOOD_VENUES[ls.venue?.kind]);
    const here = eat && !atTable ? this.foodPlaceOf(L.ctx) : null;
    if (eat && !atTable && !here) return { ok: false, why: 'not_food', lead: ls };
    const e = evalPlan(a.plan, now);
    const near = ls ? { x: ls.x, z: ls.z, ctx: ls.ctx } : here ? { x: L.x, z: L.z, ctx: L.ctx } : { x: e.x, z: e.z, ctx: e.ctx === CTX_UNDER ? CTX_OUT : e.ctx };
    let pick = this.pickSeat(a, { near, with: here ? null : ls, uses: eat ? EAT_USES : SIT_USES, radius: eat ? (here ? SEAT_FAR_M + 4 : MEAL_M) : SEAT_M });
    // (theirs and the seats beside taken — a bench for two, a third with them —: the nearest a few steps further)
    if (!pick.seat && !eat) { const far = this.pickSeat(a, { near, with: ls, uses: SIT_USES, radius: SEAT_FAR_M }); if (far.seat) pick = far; }
    if (!pick.seat) return { ok: false, why: pick.why, lead: ls };
    const seat = pick.seat, meal = eat ? this.mealFor(a, seat, now, want) : null;
    // (what it would pay, by the economy's own rules: too little money, or past its owner's limits — no order)
    const econ = this.sim.econ;
    if (meal?.order && econ?.quote) {
      const q = econ.quote(a, { kind: meal.kind, use: meal.use, b: seat.b, f: seat.f, order: meal.order, holdStart: now });
      meal.total = q.total;
      if (!q.ok) { meal.unpaid = q.why; meal.order = null; meal.courses = null; }
    }
    // (reach: how far from them it may sit on while they sit — a seat a few steps further, theirs being full)
    o.seat = { ...seat, mode: eat ? 'eat' : 'sit', auto: !!auto, at: now, since: 0, lead: ls?.key || null, meal, near: !!here, reach: Math.max(MEAL_M, Math.hypot(seat.x - near.x, seat.z - near.z) + 1.5) };
    this.reorder(a);
    const s = a.order?.seat;
    if (!s || s.key !== seat.key) return { ok: false, why: 'taken', lead: ls };
    return { ok: true, seat: s, lead: ls, arrive: a.act?.holdStart ?? now };
  },
  /** Gets up from its seat and goes on with its leader (a person asked it to stand): false when it wasn't sitting. */
  getUp(a, why = 'asked') {
    const o = a.order;
    if (!o?.seat) return false;
    this.seatEnd(a, o, why);
    this.reorder(a);
    return true;
  },
  /**
   * Uses piece `id` on floor f of building b beside its leader (its follow order's) — one of its slots with that `use`
   * (shared/catalog.js: 'play', 'pingpong', 'dance', 'music', 'bench' …), the free one nearest them — for `minutes`
   * (world; default: the slot's own time) — or its slot k (the other end of a two-sided table, its leader playing it
   * against it: server/play/versus.js). The round is planned at once (it walks over, the slot held for it). A paid
   * one (PAID_USE: an arcade's tokens) is quoted first: it can't pay, it doesn't. → { ok: true, seat (o.seat), arrive,
   * paid ({ total } | null) } or { ok: false, why: 'not_following' | 'riding' | 'leader_gone' | 'gone' | 'far' | 'full'
   * | 'money' | 'limits' | 'taken' }. A decoration's (dec: its id — a bench on open land, a dock's picnic table:
   * ./decor-seats.js): the same, outdoors; it costs nothing.
   */
  useWith(a, { b, f, id, use, minutes = 0, dec, k = null }) {
    const now = this.sim.now(), o = a.plan ? this.liveOrder(a, now) : null;
    if (!o || o.kind !== 'follow' || !o.lead) return { ok: false, why: 'not_following' };
    const L = this.leadAt(a, o, now);
    if (!L || L.gone) return { ok: false, why: 'leader_gone' };
    if (a.ride || L.car) return { ok: false, why: 'riding' };
    if (dec !== undefined && dec !== null) return this.useDecorWith(a, o, L, { dec, use, minutes, now });
    const B = this.W.buildings[b], e = B && !B.gone ? this.index.entry(b, f, id) : null;
    if (!e) return { ok: false, why: 'gone' };
    const ctx = ctxOf(b, f);
    // (in its leader's space and near them: a park's grounds and the street are one)
    let best = null, bd = Infinity, any = false;
    for (const s of e.slots) {
      if (s.use !== use || (k != null && s.k !== k)) continue;
      const w = toWorld(B, s.lx, s.lz), d = Math.hypot(w.x - L.x, w.z - L.z);
      if (!this.sameSpace(ctx, L.ctx) || d > USE_M) continue;
      any = true;
      if (d < bd && this.seatFree(a, b, f, id, s.k)) { bd = d; best = s; }
    }
    if (!best) return { ok: false, why: any ? 'full' : 'far' };
    const info = this.seatInfo(b, f, id, best.k), kind = info.venue?.kind;
    const dur = minutes > 0 ? minutes : Array.isArray(best.dur) ? (best.dur[0] + best.dur[1]) / 2 : 15;
    let paid = null;
    if (PAID_USE.has(kind) && this.sim.econ?.quote) {
      const q = this.sim.econ.quote(a, { kind, use, b, f, holdStart: now });
      if (!q.ok) return { ok: false, why: q.why === 'limits' ? 'limits' : 'money' };
      paid = q.total ? { total: q.total } : null;
    }
    if (o.seat) this.seatEnd(a, o, 'other');
    o.seat = { ...info, mode: 'use', useName: use, auto: false, at: now, since: 0, lead: null, meal: null, until: now + this.wm(Math.max(1, dur)), pay: PAID_USE.has(kind) ? kind : null };
    this.reorder(a);
    const s = a.order?.seat;
    if (!s || s.key !== info.key) return { ok: false, why: 'taken' };
    return { ok: true, seat: s, arrive: a.act?.holdStart ?? now, paid };
  },
  /** useWith for a decoration's slot (o: its follow order, L: its leader now): the free one with that use nearest them. */
  useDecorWith(a, o, L, { dec, use, minutes, now }) {
    const e = this.decorEntry(dec);
    if (!e) return { ok: false, why: 'gone' };
    let best = null, bd = Infinity, any = false;
    for (const s of e.slots) {
      if (s.use !== use) continue;
      const d = Math.hypot(s.lx - L.x, s.lz - L.z);
      if (!this.sameSpace(CTX_OUT, L.ctx) || d > USE_M) continue;
      any = true;
      if (d < bd && this.decorFree(a, e.id, s.k)) { bd = d; best = s; }
    }
    if (!best) return { ok: false, why: any ? 'full' : 'far' };
    const info = this.decorInfo(e.id, best.k), dur = minutes > 0 ? minutes : Array.isArray(best.dur) ? (best.dur[0] + best.dur[1]) / 2 : 15;
    const act = this.decorAct(best);   // (a picnic table's seat: sat at — nothing is served there)
    if (!act) return { ok: false, why: 'gone' };
    if (o.seat) this.seatEnd(a, o, 'other');
    o.seat = { ...info, mode: 'use', useName: act, auto: false, at: now, since: 0, lead: null, meal: null, until: now + this.wm(Math.max(1, dur)), pay: null };
    this.reorder(a);
    const s = a.order?.seat;
    if (!s || s.key !== info.key) return { ok: false, why: 'taken' };
    return { ok: true, seat: s, arrive: a.act?.holdStart ?? now, paid: null };
  },
  /** Its seat is over (o.seat gone; the plan it makes next gets it up). */
  seatEnd(a, o, why = 'up') { if (o?.seat) { o.lastSeat = { words: o.seat.words, why, at: this.sim.now() }; o.seat = null; } },
  /** Its seat held for it until it gets up, not only for this round's stay: nobody planning meanwhile takes it. */
  keepSeat(a, key, until) {
    const r = this.res.get(key)?.findLast(q => q[0] === a.i);
    if (r) r[2] = Math.max(r[2] === Infinity ? 0 : r[2], until);
    // (whoever else is bound for it within the hold — a stay planned there before it sat down — goes elsewhere now)
    const now = this.sim.now();
    for (const q of [...(this.res.get(key) || [])]) {
      if (q[0] === a.i || !(q[2] > now) || !(q[1] < until)) continue;
      const o = this.sim.agents[q[0]];
      if (o?.plan && !o.order?.seat) this.interruptSoon(o);
    }
  },
  /**
   * Whether a stays sitting with leader L: not when they drove off, nor (sat down because they did) once they are up,
   * nor when they walked off from its seat (STAND_M; MEAL_M while they sit, at their table or near) — they left the
   * world: it waits there, sitting.
   */
  seatKeeps(a, o, L, t = this.sim.now()) {
    const s = o?.seat;
    if (!s || !L || L.car || a.ride || a.detour) return false;
    if (L.gone) return true;
    // (using something beside them: while they are near, until its time is up)
    if (s.mode === 'use') return !(s.until && t >= s.until) && this.sameSpace(L.ctx, s.ctx) && Math.hypot(L.x - s.x, L.z - s.z) <= USE_M;
    const ls = this.leaderSeatOf(o, t);
    if (s.auto && !ls) return false;
    // (eating near them where they are, not at their table: while they stay in that place, sitting or standing)
    if (s.near && s.mode === 'eat' && !(s.meal?.done)) return this.sameSpace(L.ctx, s.ctx) && Math.hypot(L.x - s.x, L.z - s.z) <= Math.max(s.reach || MEAL_M, MEAL_STAY_M);
    return this.sameSpace(L.ctx, s.ctx) && Math.hypot(L.x - s.x, L.z - s.z) <= (ls ? s.reach || MEAL_M : STAND_M);
  },
  /** The place that serves food floor ctx is ({ b, f, kind }), or null (none there, or outdoors). */
  foodPlaceOf(ctx) {
    if (!(ctx >= 0)) return null;
    const b = ctxB(ctx), f = ctxF(ctx), B = this.W.buildings[b], kind = B && !B.gone ? this.W.levels[B.lv[f]]?.venue : null;
    return FOOD_VENUES[kind] ? { b, f, kind } : null;
  },
  /**
   * A round of sitting with its leader (o.seat): to the seat — held for it from now on — and sitting there; at a meal,
   * what it ordered served course by course, the order on its act (the economy's bill: sim.onAct) the first time. False:
   * the seat is over (its leader walked or drove off; the seat taken or gone) — it goes on following.
   */
  seatStep(a, P, o, L) {
    const s = o.seat;
    if (!this.seatKeeps(a, o, L, P.t)) { this.seatEnd(a, o, s.mode === 'use' && s.until && P.t >= s.until ? 'done' : 'leader'); return false; }
    // (a decoration's seat outdoors — a bench on open land, a dock's picnic table: ./decor-seats.js — or a piece's)
    const dec = s.dec !== undefined, B = dec ? null : this.W.buildings[s.b];
    if (dec ? !this.decorEntry(s.dec)?.slots[s.k] : !B || B.gone || !this.index.entry(s.b, s.f, s.id)?.slots[s.k]) { this.seatEnd(a, o, 'gone'); return false; }
    // (a park's seat from its open ground: its grounds are one space — over on the park's own ways, not round by its gate)
    const c0 = P.ctx;
    if (!dec && P.ctx === CTX_OUT && B.type === 'park' && inFootprint(B, P.x, P.z)) P.ctx = ctxOf(s.b, 0);
    const m = s.meal, was = P.seat?.key === s.key;   // (was: sitting there already, a round before this one)
    if (m?.until && m.until - P.t < this.wm(1)) m.done = true;   // (its meal is over: it sits on with them)
    const using = s.mode === 'use', eating = !!m?.order && !m.done, use = eating ? m.use : using ? s.useName : SIT_USE[s.use] || 'chat';
    const hold = [P.t, P.t + this.wm(SEAT_HOLD)];   // (held for it that far ahead: renewed each round — keepSeat)
    const st = dec ? this.decorBegin(a, P, s.dec, s.k, { use, win: hold }) : this.slotBegin(a, P, s.b, s.f, s.id, s.k, { use, win: hold });
    if (!st) { P.ctx = c0; this.seatEnd(a, o, 'taken'); return false; }
    let dur = this.wm(SIT_ROUND), first = false;
    if (eating) {
      // its meal: from when it sits down, the whole of it in one stay (cut short when its leader goes)
      if (!m.until) { m.until = P.t + m.dur; first = true; }
      dur = Math.max(this.wm(1), m.until - P.t);
    }
    // (using it: rounds until its time is up; a paid use is billed with its first round, as a resident's visit there)
    if (using) { dur = Math.max(this.wm(1), Math.min(this.wm(USE_ROUND), (s.until || P.t + this.wm(USE_ROUND)) - P.t)); first = !s.started; s.started = true; }
    const hs = this.slotHold(a, P, st, dur, eating ? { courses: m.courses } : {});
    const label = eating ? `${m.kind === 'bar' ? 'Having a drink' : 'Eating'} with ${L.name}` : using ? `${USES[use]?.label || 'Busy'} with ${L.name}` : `Sitting with ${L.name}`;
    const kind = !first ? 'follow' : using ? s.pay || 'follow' : m.kind;
    const act = this.act(a, kind, use, P, { ...this.slotInfo(st), ...(dec ? { dec: s.dec } : {}), ...hs, label, place: s.venue?.name || (dec ? s.place : this.placeName(s.b, s.f)), ...(first && !using && this.food ? { order: m.order } : {}) });
    this.keepSeat(a, st.sk, hs.holdEnd + this.wm(SEAT_HOLD));
    if (first && !using) m.paid = this.paidFor(a, act);
    if (first && using && s.pay) s.paid = this.paidFor(a, act);
    if (!was || !s.since) s.since = hs.holdStart;   // (sitting there since)
    a.fspot = null;
    return true;
  },
  /** What the economy charged for act (its last receipt, for this stay): { total, items, biz }, false (no sale: it
   *  could not pay after all), or null (no economy here: what it had is on the table, no bill). */
  paidFor(a, act) {
    const econ = this.sim.econ;
    if (!econ) return null;
    const rc = econ.receipts?.get(a.p.id), r = rc?.[rc.length - 1];
    return r && r.t === act.holdStart ? { total: r.total, items: r.items, biz: r.biz } : false;
  },
  /** Gets in its leader's car now: hidden in it from this moment (it was close enough to get in). */
  board(a, vid) {
    if (!a.plan) return false;
    a.ride = { vid, at: this.sim.now() };
    this.reorder(a, true);
    return true;
  },
  /** Gets out of the car beside it (x, z: where the car stands), and goes on following. */
  alight(a, x, z) {
    if (!a.ride) return false;
    a.ride = null;
    const P = this.cut(a, this.sim.now(), true);
    const s = this.standAt(CTX_OUT, x, z) || { ctx: CTX_OUT, x, z };
    P.seg(0.05, s.x, yAt(this, s.x, s.z, CTX_OUT), s.z, P.yaw, A.idle, U.idle, 0, F_SNAP, CTX_OUT);
    this.finishRound(a, P);
    return true;
  },
  /**
   * At its leader's side at once (they travelled across the map, or the server restarted while it was out with them): up
   * from any seat, off any closer look, out of a car — then on with them from s ({ ctx, x, z }: its place beside them,
   * slotSpot). False when it has no body or no order to go on with.
   */
  joinAt(a, s) {
    const o = a.order;
    if (!a.plan || !o || !s) return false;
    if (o.seat) this.seatEnd(a, o, 'leader');
    a.ride = null; a.detour = null; a.attend = null; a.fspot = null; a.rideAt = null;
    const P = this.cut(a, this.sim.now(), true);
    P.seat = null;   // (sitting or lying where it was: not stood up back there afterwards)
    P.seg(0.05, s.x, yAt(this, s.x, s.z, s.ctx), s.z, P.yaw, A.idle, U.idle, 0, F_SNAP, s.ctx);
    this.finishRound(a, P);
    return true;
  },
  /** Does its companion order again from now (its leader moved on, it got in or out of a car, a new order): cut where it
   *  may be cut — anywhere, for a body hidden in a car — and plan the next round. */
  reorder(a, anyTime = false) {
    if (!a.plan || !a.order) return false;
    const P = this.cut(a, this.sim.now() + (anyTime ? 0 : 0.1), anyTime || !!a.ride);
    return this.finishRound(a, P);
  },
  finishRound(a, P) {
    const h = this.hour(P.t), day = this.day(P.t);
    let ok = false;
    try { ok = !!this.doOrder(a, P, h, day); } catch (e) { this.sim.noteError(e); }
    if (!ok) {
      if (a.order) { a.orderEnded = { kind: a.order.kind, who: a.order.who ?? null, why: a.order.ended || 'not_possible', at: P.t, by: a.order.by ?? null, lead: a.order.leadName || null }; this.setOrder(a, null); }
      a.ride = null; a.attend = null; a.detour = null;
      this.lookAround(a, P, this.wm(1));
    }
    this.sim.commit(a, P);
    return ok;
  },
};
