// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI agents at the airport (docs/features/play-modules.md §Airport, "Agents fly"; 2026-11-17, the product owner: "if the
// player can do it then AI agents should also be able to do it"): they fly with their owner, and they fly the ring courses
// themselves. Through the interaction registry (server/interactions/), source 'airport', as fishing is (./fishing-crew.js).
//
// - Aboard: a companion following its owner gets into the aircraft its owner takes (as it gets into its owner's car): a
//   passenger seat of its own (shared/aircraft-specs.js SEATS: the propeller plane takes one, the jet five, the helicopter
//   three — kept by the fleet as the cars' seats are, server/world/aircraft.js seats) while the aircraft is still on the
//   ground and slow and it is near; none free, it stays on the ground and says so. Aboard, its body is hidden in the
//   simulation (as in a car: a.ride with the seat's own place, carried along) — the models paint their windows on, so
//   nobody inside an aircraft is drawn, the pilot neither. It gets out with its owner when they land and step out (a crash
//   or a pilot who leaves in the air: the ground crew brings everyone back beside the stand, as for the pilot). It gets in
//   when asked ("get in", "come fly with me": the reflex, server/companions/intent.js), when its Free Will picks the
//   registry's 'board' (a moment is offered when its owner gets in), or — Free Will not deciding for it — by itself, as a
//   car's. Left behind (it chose not to, the aircraft full, or it was too far when they took off), it waits where it is
//   for them to land (server/companions/ playerLead, through leadFor here), and its owner's page and its diary say so.
// - At the controls: at an airport an agent may fly a ring course itself — the courses open to it (its own airport
//   progress, as minus its id), in an aircraft of the course's class standing free there. It walks out to the aircraft
//   (an order to wait at its door: everyone sees it go), gets in, and its autopilot (shared/autopilot.js) flies it with
//   the same flight model a person flies — taxi, take-off, the rings, the landing, back to the stand — the server
//   stepping it in real time and giving its poses to the fleet, which shares them with every page near as anyone's
//   aircraft (with its name as the pilot). Its run is a real run of the airport module (the play core, as minus its id,
//   unattended: half the experience), reported from its own sampled flight path when it is through the last ring, judged
//   by the module's own check (shared/airport.js verifyFlight: the speeds, the ring passes, the time) — a crash, the time
//   running out or giving up records nothing. A companion whose owner is flying the same course goes along on their run
//   (the same clock: a race). How well it flies is its airport level (a beginner slower and wider). Its body lands, gets
//   out beside the aircraft and goes back to what it was doing (its owner's side, for a companion).
// - Seen and said: its owner's page hears it get in and out, a left-behind, a take-off and its time; its diary has each
//   step (and the play core's own lines for its run: server/senses/play-activities.js); a word out loud now and then.
// Nothing here draws a simulation random number.
import { evalPlan } from '../sim/plan.js';
import { CTX_OUT } from '../../shared/proto.js';
import { AIRCRAFT, SEATS, passengerSeats } from '../../shared/aircraft-specs.js';
import { COURSES, COURSE_BY_ID } from '../../shared/airport.js';
import { AutoFlight } from '../../shared/autopilot.js';
import { qrot, anglesOf } from '../../shared/flight-model.js';
import { moduleLevel, playOf, formatScore, unlocked } from '../../shared/play.js';
import { modulesOf } from '../../shared/world-modules.js';
import { toFrame } from '../../shared/airport-layout.js';
import { USES } from '../../shared/catalog.js';

export const TICK_MS = 100;        // the agents' flights are stepped ten times a second (the fleet shares five a second)
export const BOARD_M = 25;         // m from its owner's aircraft a companion gets in (a car's 20, a wing's span more)
export const OFFER_M = 60;         // m: near enough to be offered getting in (it walks over with its owner)
export const STOP_V = 4;           // m/s: an aircraft slower than this on the ground can be got into
export const DOOR_M = 3.5;         // m from the door: in
export const WALK_MS = 150e3;      // the longest walk out to an aircraft before it gives up
export const FLIGHT_MS = 30 * 60e3;   // the longest flight before the ground crew takes it home
const GROUNDS = { s0: -40, s1: 240, f0: -460, f1: 460 };   // an airport's grounds in its frame (shared/airport-layout.js SURFACES)
const HOLD_MIN = 24 * 60;          // world minutes the order to fly lasts at most (ended when the flight is)
const clean = (s, n = 60) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const lower = t => String(t || '').toLowerCase();
const craftOf = type => lower(AIRCRAFT[type]?.label || 'aircraft');

export class FlightCrew {
  /**
   * @param {object} o
   * @param {object} o.play               server/play/play.js PlayCore
   * @param {() => object} o.fleet        server/world/aircraft.js Fleet
   * @param {object} o.players            server/world/players.js Players
   * @param {() => object} o.sim          the running Sim
   * @param {object} o.agents             the agent registry (byKey, get)
   * @param {() => object} [o.companions] server/companions/companions.js (decides, remark)
   * @param {() => object} [o.world]      the world (its airports)
   * @param {() => object} [o.ground]     the land: { height(x, z), water(x, z) → level | null, roof(x, z), hit(x, y, z) → a box | null }
   * @param {(i, text) => void} [o.say]   a line in a bubble over body i (not voiced)
   * @param {(accountId, frame) => void} [o.toAccount] a frame to an account's pages
   * @param {(agentId, kind, text, o) => void} [o.note] a line in an agent's diary
   */
  constructor({ play, fleet, players, sim, agents, companions = () => null, world = () => null, ground = () => null, say = () => {}, toAccount = () => {}, note = () => {}, now = () => Date.now(), log = null }) {
    Object.assign(this, { play, fleetOf: fleet, players, simOf: sim, agents, companionsOf: companions, worldOf: world, groundOf: ground, say, toAccount, note, now, log });
    this.riders = new Map();    // agent id → a passenger: { agent, i, name, aircraft, owner, seat, air, cx, cz, at }
    this.pilots = new Map();    // agent id → its flight: { agent, i, name, owner, aircraft, type, course, run, phase, flight, … }
    this.left = new Map();      // body index → { x, z, aircraft, owner, at }: left on the ground, waiting for its owner to land
    this.offered = new Map();   // agent id → the boarding its Free Will was told about (aircraft id and its time)
    this.wants = new Set();     // agent ids asked to get in (walking over to their owner's aircraft)
    this.timer = null;
    this.stats = { boarded: 0, full: 0, left: 0, alighted: 0, flights: 0, reported: 0, verified: 0, refused: 0, crashed: 0, gaveUp: 0 };
  }
  get sim() { return this.simOf(); }
  get fleet() { return this.fleetOf(); }
  attach() { this.timer = setInterval(() => { try { this.tick(); } catch (e) { this.log?.warn?.('[flight-crew] tick failed:', e.stack || e.message); } }, TICK_MS); this.timer.unref?.(); return this; }
  stop() { clearInterval(this.timer); this.timer = null; }

  // ------------------------------------------------------------------------------------------------ who, where
  recOf(i) { const p = this.sim?.people[i]; return p?.vip && p.agentId ? this.agents.byKey(p.agentId) : null; }
  nameOf(account) { return clean(this.players.byId.get(account)?.name || 'your owner', 40); }
  decides(rec) { try { return !!(rec && this.companionsOf()?.decides?.(rec)); } catch { return false; } }
  remark(i, text) { try { this.companionsOf()?.remark?.(i, text); } catch { /* its words are a bonus */ } }
  /** The airports of the world: their modules ({ id, name, x, z, y, rot }). */
  airports() { return modulesOf(this.worldOf()).filter(m => m.kind === 'airport' && Number.isFinite(m.y)); }
  /** The airport whose grounds (x, z) is on, or null. */
  airportAt(x, z) {
    for (const m of this.airports()) { const q = toFrame(m, x, z); if (q.s >= GROUNDS.s0 && q.s <= GROUNDS.s1 && q.f >= GROUNDS.f0 && q.f <= GROUNDS.f1) return m; }
    return null;
  }
  /** Where seat k of aircraft A is in the world now: { x, y, z, yaw }. */
  seatAt(A, k) {
    const p = this.fleet.place(A), q = { x: p.q[0], y: p.q[1], z: p.q[2], w: p.q[3] }, st = SEATS[A.type]?.[k] || { x: 0, y: 0, z: 0 }, o = qrot(q, st.x, st.y, st.z);
    return { x: p.x + o.x, y: p.y + o.y - 0.5, z: p.z + o.z, yaw: anglesOf(q).heading };
  }
  /** The free aircraft of class `type` at airport m nearest to (x, z): on its stand or left on its grounds. */
  freeAircraft(m, type, x, z) {
    let best = null, bd = Infinity;
    for (const A of this.fleet?.all.values() || []) {
      if (A.module !== m.id || A.type !== type || A.pilot != null) continue;
      const p = this.fleet.place(A), d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = A; }
    }
    return best;
  }
  /** The flight model's world for a flight (its state s): the ground — or a roof it is over —, the water, walls. */
  envFor(fl) {
    const G = this.groundOf() || {}, S = AIRCRAFT[fl.type], height = G.height || (() => 0), roof = G.roof || (() => -Infinity), pad = S.kind === 'heli' ? 0.5 : 0;
    return {
      ground: (x, z) => { const t = height(x, z), r = roof(x, z, pad); return r > t && fl.s.p.y - S.gearH > r - 1.5 ? r : t; },
      water: (x, z) => (G.water ? G.water(x, z) : null),
      solid: (x, y, z) => { const b = G.hit ? G.hit(x, y, z) : null; return b ? (b.label || 'a building') : null; },
    };
  }
  /** The highest ground or roof at (x, z) (what the autopilot keeps clear of; what the rings stand clear of). */
  clearAt() { const G = this.groundOf() || {}; return (x, z) => Math.max(G.height ? G.height(x, z) : -Infinity, G.roof ? G.roof(x, z) : -Infinity); }

  // ------------------------------------------------------------------------------------------------ aboard (the companions' hook)
  /**
   * One follower of a player looked at (server/companions/ watch, twice a second, before the cars and the boats): aboard —
   * carried along in its seat, out again with its owner; its owner in an aircraft — in too when it can, else waiting for
   * them to land. → true when this took care of it.
   */
  watch(a, o, L) {
    const F = this.fleet;
    if (!F || !a?.plan || o?.lead?.kind !== 'player') return false;
    const rec = this.recOf(a.i);
    if (!rec) return false;
    const owner = o.lead.id;
    if (a.ride?.aircraft) {
      if (a.ride.pilot) return true;   // (at the controls itself: its own flight, tick)
      const m = this.riders.get(rec.id), A = F.all.get(a.ride.aircraft);
      if (A && m && A.pilot === owner) { this.carry(a, A, m); return true; }
      this.getOff(a, rec, m, A, owner, L);
      return true;
    }
    const A = F.byPilot.get(owner);
    if (!A || A.agent) { if (this.left.delete(a.i)) a.fspot = null; return false; }   // (its owner is not flying: it follows as ever)
    const pose = F.place(A), still = pose.g && (pose.v || 0) < STOP_V;
    if (still) {
      // on the ground: in with them — asked, or by itself when its Free Will doesn't decide; with Free Will, the moment is
      // offered (its owner got in) and its choice is the registry's 'board'
      if (this.left.delete(a.i)) a.fspot = null;
      const want = this.wants.has(rec.id) || !this.decides(rec);
      if (want) { const r = this.tryBoard(a, rec, A, L); if (r.ok) return true; if (r.why === 'full') this.wants.delete(rec.id); }
      else this.offer(a, rec, A);
      return false;
    }
    // rolling or in the air without it: it waits where it is for them to land
    if (!this.left.has(a.i)) this.leftBehind(a, rec, A, owner);
    return false;
  }
  /** Where its owner is for a follower left on the ground while they fly (server/companions/ playerLead): where it waits —
   *  or null (aboard, or not left behind: as ever). p: the owner's player. */
  leadFor(p, a) {
    if (!p?.aircraftId || !a) return null;
    const w = this.left.get(a.i);
    if (!w || w.aircraft !== p.aircraftId || a.ride?.aircraft) return null;
    const name = clean(p.name || 'your owner', 40), craft = craftOf(this.fleet?.all.get(p.aircraftId)?.type);
    return { x: w.x, y: 0, z: w.z, ctx: CTX_OUT, yaw: 0, moving: false, vx: 0, vz: 0, name, waiting: true, label: `Waiting for ${name} to land the ${craft}` };
  }
  /** Gets into aircraft A (its owner at the controls) when it can now: → { ok, why, text }. */
  tryBoard(a, rec, A, L) {
    const F = this.fleet, sim = this.sim, e = evalPlan(a.plan, sim.now()), pose = F.place(A), owner = L?.name || this.nameOf(A.pilot), craft = craftOf(A.type), name = clean(rec.name, 40);
    if (e.ctx !== CTX_OUT) return { ok: false, why: 'far', text: `${name} is indoors — not near the ${craft}` };
    if (!pose.g || (pose.v || 0) >= STOP_V) return { ok: false, why: 'moving', text: `${owner}'s ${craft} is ${pose.g ? 'rolling already' : 'in the air'} — too late to get in` };
    const d = Math.hypot(e.x - pose.x, e.z - pose.z);
    if (d > BOARD_M) return { ok: false, why: 'far', text: `${name} is too far from ${owner}'s ${craft} (${Math.round(d)} m)` };
    const seat = F.seats.seat(A.id, { kind: 'resident', id: a.i });
    if (!seat) {
      const n = passengerSeats(A.type), k = `${rec.id}:${A.id}:${A.at}`;
      if (this.fullSaid !== k) {
        this.fullSaid = k; this.stats.full++;
        this.note(rec.id, 'move', `${owner}'s ${craft} was full (it takes ${n} passenger${n === 1 ? '' : 's'}) — you stayed on the ground`, { key: 'air' });
        this.toAccount(A.pilot, { t: 'crew_note', agent: rec.id, i: a.i, text: `${name} stays on the ground — your ${craft} has no free seat (it takes ${n} passenger${n === 1 ? '' : 's'})` });
        this.remark(a.i, `${owner}'s ${craft} is full, so I'm staying on the ground and waiting for them here.`);
      }
      return { ok: false, why: 'full', text: `${owner}'s ${craft} is full: it takes ${n} passenger${n === 1 ? '' : 's'}` };
    }
    this.board(a, rec, A, seat, owner);
    return { ok: true, why: null, text: `${name} got into ${owner}'s ${craft}` };
  }
  /** In aircraft A, seat `seat`: hidden there for the simulation, carried along. */
  board(a, rec, A, seat, owner) {
    const sim = this.sim, at = this.seatAt(A, seat), craft = craftOf(A.type), words = SEATS[A.type]?.[seat]?.words || 'a seat', name = clean(rec.name, 40);
    a.ride = { vid: `air:${A.id}`, aircraft: A.id, at: sim.now(), label: `In ${owner}'s ${craft}`, icon: AIRCRAFT[A.type].icon, use: 'commute', x: at.x, y: at.y, z: at.z, yaw: at.yaw };
    a.detour = null; a.attend = null; a.fspot = null;
    this.riders.set(rec.id, { agent: rec.id, i: a.i, name, aircraft: A.id, owner: A.pilot, ownerName: owner, seat, air: false, cx: at.x, cz: at.z, cy: at.y, at: this.now(), rideKey: '' });
    this.left.delete(a.i); this.wants.delete(rec.id); this.offered.delete(rec.id);
    this.stats.boarded++;
    sim.brain.reorder(a, true);
    this.note(rec.id, 'move', `Got into ${owner}'s ${craft} with them — ${words}`, { key: 'air' });
    this.toAccount(A.pilot, { t: 'crew_note', agent: rec.id, i: a.i, text: `${name} got in with you — ${words} of your ${craft}` });
    this.remark(a.i, `I just got into ${owner}'s ${craft} with them (${words}); we're going flying.`);
  }
  /** Aboard and its owner flying: carried along in its seat (planned again as the aircraft moves on a metre). */
  carry(a, A, m) {
    const sim = this.sim, at = this.seatAt(A, m.seat), pose = this.fleet.place(A), craft = craftOf(A.type), air = !pose.g;
    if (air && !m.air) this.note(m.agent, 'activity', `Took off with ${m.ownerName} in their ${craft}`);
    m.air = air;
    const label = air ? `Flying with ${m.ownerName} in their ${craft}` : `In ${m.ownerName}'s ${craft}`, use = air ? 'fly' : 'commute';
    Object.assign(a.ride, { x: at.x, y: at.y, z: at.z, yaw: at.yaw, label, use });
    if (Math.hypot(at.x - m.cx, at.z - m.cz, at.y - m.cy) > 1 || m.rideKey !== label) { m.cx = at.x; m.cz = at.z; m.cy = at.y; m.rideKey = label; sim.brain.reorder(a, true); }
  }
  /** Its owner is out of the aircraft (landed and stepped out; or the ground crew brought it back): out too — beside them. */
  getOff(a, rec, m, A, owner, L) {
    const sim = this.sim, F = this.fleet, p = this.players.byId.get(owner), craft = craftOf(A?.type), name = L?.name || m?.ownerName || this.nameOf(owner);
    F.seats.unseat({ kind: 'resident', id: a.i });
    this.riders.delete(rec.id);
    const crew = !!m?.air;   // (out while it was in the air: a crash, or its pilot left — the ground crew)
    const at = p && !p.aircraftId ? { x: p.x, z: p.z } : A ? (crew ? F.besideStand(A) : F.exitPoint(A, F.place(A))) : (() => { const e = evalPlan(a.plan, sim.now()); return { x: e.x, z: e.z }; })();
    sim.brain.alight(a, at.x, at.z);
    a.ride = null;
    this.stats.alighted++;
    this.note(rec.id, 'move', crew ? `Out of ${name}'s ${craft}: the ground crew brought it back to its stand` : `Got out of ${name}'s ${craft} with them`, { key: 'air' });
    this.remark(a.i, crew ? `Our flight in ${name}'s ${craft} ended early — the ground crew brought us back to the stand.` : `${name} landed the ${craft} and we got out together.`);
  }
  /** Its owner got into an aircraft and its Free Will decides for it: the moment is offered (once a boarding) — its diary
   *  line, which Free Will's moments read (server/free-will/moments.js), the registry's 'board' among its options. */
  offer(a, rec, A) {
    const k = `${A.id}:${A.at}`;
    if (this.offered.get(rec.id) === k) return;
    this.offered.set(rec.id, k);
    const owner = this.nameOf(A.pilot), craft = craftOf(A.type), n = passengerSeats(A.type), free = this.fleet.seats.free(A.id);
    this.note(rec.id, 'activity', free > 0 ? `${owner} (your owner) got into the ${craft} — there is room for you (${free} of ${n} passenger seat${n === 1 ? '' : 's'} free): you could fly with them` : `${owner} (your owner) got into the ${craft}; it is full`);
  }
  /** Its owner took off without it: it waits where it is, and says so. */
  leftBehind(a, rec, A, owner) {
    const e = evalPlan(a.plan, this.sim.now()), name = this.nameOf(owner), craft = craftOf(A.type);
    this.left.set(a.i, { x: e.x, z: e.z, aircraft: A.id, owner, at: this.now() });
    this.stats.left++;
    a.fspot = null;
    this.note(rec.id, 'move', `${name} took off in the ${craft} without you — you are waiting on the ground for them to land`, { key: 'air' });
    this.toAccount(owner, { t: 'crew_note', agent: rec.id, i: a.i, text: `${clean(rec.name, 40)} is waiting on the ground for you to land` });
    try { this.sim.brain.reorder(a); } catch { /* the next round */ }
  }

  // ------------------------------------------------------------------------------------------------ at the controls
  /** Its airport level's hand (0–1): a beginner slower and wider, better with every level. */
  skillOf(agentId) { let xp = 0; try { xp = this.play.progress(-agentId).modules.airport?.xp || 0; } catch { xp = 0; } return Math.max(0, Math.min(1, (moduleLevel(xp) - 1) / 9)); }
  /** Its owner's run of course c now, if they are flying one (it goes along: the same clock). */
  alongOf(ctx, c) {
    const lead = ctx?.leader?.account ?? null, run = lead != null ? this.play.runOf(lead) : null;
    return run && run.module === 'airport' && run.course === c.id ? run : null;
  }
  /**
   * Flies course `courseId` from the airport its body is at (asked, or its own choice): its run started, an aircraft of
   * the course's class taken, its body walking out to it. → { ok, text, brain, why }.
   */
  fly(ctx, courseId, via = 'agent') {
    const rec = ctx?.rec, a = ctx?.a, sim = this.sim, F = this.fleet, name = clean(rec?.name || 'It', 40);
    const no = (why, text, brain) => { this.stats.refused++; return { ok: false, why, text, brain: brain || text }; };
    if (!rec || !a?.plan || !F) return no('no_body', `${name} has no body here`, 'your body is not in the city right now');
    if (this.pilots.has(rec.id)) return no('already', `${name} is flying already`, 'you are flying a course already');
    if (a.ride) return no('riding', `${name} is ${a.ride.aircraft ? 'aboard an aircraft' : a.ride.boat ? 'on a boat' : 'in a car'}`, 'you are riding in something now: get out first');
    const c = COURSE_BY_ID[courseId];
    if (!c) return no('no_course', 'No such ring course', 'there is no such ring course');
    const e = evalPlan(a.plan, sim.now()), m = this.airportAt(e.x, e.z);
    if (!m || e.ctx !== CTX_OUT) return no('not_here', `${name} is not out on an airport's grounds`, 'you are not out on an airport\'s grounds: the ring courses start from an airport');
    const along = this.alongOf(ctx, c);
    let prog = null; try { prog = this.play.progress(-rec.id).modules.airport; } catch { prog = null; }
    if (!along && prog && !prog.unlocked.includes(c.id)) { const before = COURSE_BY_ID[c.after]; return no('locked', `${c.label} isn't open to ${name} yet: finish ${before?.label || 'the course before'} first`); }
    const A = this.freeAircraft(m, c.aircraft, e.x, e.z), craft = craftOf(c.aircraft);
    if (!A) return no('no_aircraft', `No ${craft} is free at ${clean(m.name || 'the airport', 40)} now`);
    let st;
    try { st = this.play.start({ id: -rec.id }, 'airport', c.id, m.id, { auto: true, ...(along ? { along: along.id } : {}) }); }
    catch (err) { return no('no_run', `${name} could not start ${c.label}: ${err.message}`); }
    const taken = F.takeFor(A.id, rec.id, name);
    if (!taken) { this.play.abandon({ id: -rec.id }, st.run); return no('taken', `Someone else took the ${craft} just then`); }
    taken.pilotBody = a.i;
    // its body: out to the aircraft's door (an order to wait there: it walks, everyone sees it go) — what it was doing
    // before (its owner's side) kept to go back to afterwards
    const door = F.exitPoint(A, F.place(A)), saved = a.order ? this.keep(a.order) : null, goal = `Flying ${c.label}`;
    const r = sim.order(a.i, { kind: 'hold', spot: { x: door.x, z: door.z, ctx: CTX_OUT, place: `the ${craft} at ${clean(m.name || 'the airport', 40)}` }, minutes: HOLD_MIN, maxMinutes: HOLD_MIN, goal, via: 'agent' });
    if (!r.ok) { F.landFor(taken, { crashed: false }); this.play.abandon({ id: -rec.id }, st.run); return no('nowhere', `${name} can't get out to the ${craft}`); }
    const run = this.play.runs.get(st.run), owner = rec.ownerId ?? null;
    this.pilots.set(rec.id, { agent: rec.id, i: a.i, name, owner, aircraft: A.id, type: c.aircraft, course: c.id, run: st.run, runAt: run?.at ?? this.now(), rings: st.data?.rings || [], airport: m,
      phase: 'walk', since: this.now(), saved, goal, door, flight: null, passes: 0, said: 0, reported: false, result: null, along: along?.id || null, via, lastT: 0, rideAt: 0, cx: 0, cz: 0, cy: 0 });
    this.stats.flights++;
    const best = prog?.best?.[c.id];
    this.note(rec.id, 'activity', `Set off to fly the ${c.label} ring course in the ${craft} at ${clean(m.name || 'the airport', 40)}${along ? ` alongside ${this.nameOf(along.account)}'s run` : ''} — walking out to it${best ? ` (your best: ${formatScore(playOf('airport'), best.score)})` : ''}`);
    if (owner != null) this.toAccount(owner, { t: 'crew_note', agent: rec.id, i: a.i, text: `✈️ ${name} is going to fly ${c.label} in the ${craft}${along ? ' alongside you' : ''}` });
    return { ok: true, why: null, text: `${name} is walking out to the ${craft} to fly ${c.label}`,
      brain: `you are walking out to the ${craft} at ${clean(m.name || 'the airport', 40)} to fly the ${c.label} ring course yourself${along ? ` alongside ${this.nameOf(along.account)}'s run (the same clock: a race)` : ''} — your autopilot flies it with the real flight model; the module's own check judges your time when you are through the last ring`, effects: { fun: USES.fly?.rate?.fun ?? 0 } };
  }
  /** The order it had (to go back to after the flight): a copy of what a new order needs. */
  keep(o) { return { kind: o.kind, lead: o.lead ? { ...o.lead } : null, slot: o.slot, goal: o.goal || null, by: o.by ?? null, byName: o.byName || null, via: o.via || null, spot: o.spot ? { ...o.spot } : null, venue: o.venue || null, until: o.until }; }
  /** Gives up its course (asked): on the ground, out at once; in the air, back to land. → { ok, text, brain }. */
  giveUp(agentId, why = 'asked') {
    const f = this.pilots.get(agentId);
    if (!f) return { ok: false, text: 'Not flying', brain: 'you are not flying a course' };
    this.dropRun(f, why === 'asked' ? 'You gave up the course' : why);
    if (!f.flight || f.flight.s.onGround && ['taxi', 'lineup', 'spinup', 'stop', 'done', 'taxiin'].includes(f.flight.phase)) { this.end(f, { why: 'gave up' }); return { ok: true, text: `${f.name} isn't flying after all`, brain: 'you gave up the course before taking off' }; }
    this.home(f);
    return { ok: true, text: `${f.name} is flying back to land`, brain: 'you gave up the course and are flying back to land at the airport' };
  }
  /** Back to land now (the course over: done, given up or out of time). */
  home(f) { const ap = f.flight?.ap; if (ap) ap.k = ap.rings.length; }   // (no rings left: the autopilot flies back and lands)
  /** Its run ended without a result (given up, out of time, a crash): nothing is recorded. */
  dropRun(f, why) {
    if (f.reported) return;
    f.reported = true; f.result = { ok: false, why };
    try { this.play.abandon({ id: -f.agent }, f.run); } catch { /* gone */ }
  }

  // ------------------------------------------------------------------------------------------------ the flights
  /** Ten times a second: each agent flying — out to its aircraft, in the air, out again. */
  tick() {
    const sim = this.sim, t = this.now();
    if (!sim || !this.fleet) return;
    for (const f of [...this.pilots.values()]) {
      try { this.step(f, t); } catch (e) { this.log?.warn?.('[flight-crew] a flight failed:', e.stack || e.message); this.end(f, { why: 'failed', crashed: true }); }
    }
  }
  step(f, t) {
    const sim = this.sim, F = this.fleet, a = sim.agents[f.i], A = F.all.get(f.aircraft);
    if (!a?.plan || !A || A.pilot !== -f.agent) { this.end(f, { why: A ? 'taken' : 'gone', crashed: !!f.flight && !f.flight.s.onGround }); return; }
    if (f.phase === 'walk') {
      // still out to its aircraft (its order to wait at the door, as given)
      if (a.order?.kind !== 'hold' || a.order.goal !== f.goal) { this.end(f, { why: 'sent elsewhere' }); return; }
      const e = evalPlan(a.plan, sim.now());
      if (Math.hypot(e.x - f.door.x, e.z - f.door.z) <= DOOR_M && e.ctx === CTX_OUT) { this.takeOff(f, a, A); return; }
      if (t - f.since > WALK_MS) { this.end(f, { why: 'could not get to it' }); }
      return;
    }
    // in the air (or taxiing): its autopilot, the flight model, in real time
    const fl = f.flight, dt = Math.min(1, Math.max(0, (t - f.lastT) / 1000));
    f.lastT = t;
    fl.step(dt, f.env);
    F.drive(A, fl.pose());
    this.carryPilot(f, a, A);
    if (fl.passes.length > f.passes) this.passed(f, fl);
    const c = COURSE_BY_ID[f.course];
    // out of time: the clock ran past the course's limit before the last ring — no run any more, back to land
    if (!f.reported && fl.passes.length && !fl.through && c?.limit && fl.ms() - fl.passes[0] > c.limit * 1000) {
      this.dropRun(f, 'Out of time'); this.home(f);
      this.note(f.agent, 'activity', `Ran out of time on ${c.label} (${fl.passes.length} of ${f.rings.length} rings) — flying back to land`);
      if (f.owner != null) this.toAccount(f.owner, { t: 'crew_note', agent: f.agent, i: f.i, text: `${f.name} ran out of time on ${c.label} — flying back` });
    }
    if (fl.through && !f.reported) this.report(f, fl);
    if (fl.crashed) { this.crashed(f, fl.crashed); return; }
    if (fl.done) { this.end(f, { why: 'landed' }); return; }
    if (t - f.flyAt > FLIGHT_MS) { this.dropRun(f, 'Too long in the air'); this.end(f, { why: 'too long', crashed: true }); }
  }
  /** At the door: in, and its autopilot takes the aircraft out. */
  takeOff(f, a, A) {
    const sim = this.sim, F = this.fleet, p = F.place(A), q = { x: p.q[0], y: p.q[1], z: p.q[2], w: p.q[3] }, c = COURSE_BY_ID[f.course], m = f.airport;
    const ground = this.groundOf()?.height?.(p.x, p.z) ?? (p.y - AIRCRAFT[A.type].gearH);
    const run = this.play.runs.get(f.run);
    if (!run) { this.end(f, { why: 'the run ended' }); return; }
    f.flight = new AutoFlight(A.type, { rings: f.rings, airport: { x: m.x, z: m.z, y: m.y, rot: m.rot }, stand: { x: A.home.x, z: A.home.z, yaw: A.home.yaw }, start: { x: p.x, z: p.z, yaw: anglesOf(q).heading },
      y: ground, clearAt: this.clearAt(), skill: this.skillOf(f.agent), t0: this.now() - run.at });
    f.env = this.envFor(f.flight);
    f.phase = 'fly'; f.lastT = this.now(); f.flyAt = this.now();
    const at = this.seatAt(A, 0), craft = craftOf(A.type);
    a.ride = { vid: `air:${A.id}`, aircraft: A.id, pilot: true, at: sim.now(), label: `Flying ${c.label} in the ${craft}`, icon: AIRCRAFT[A.type].icon, use: 'fly', x: at.x, y: at.y, z: at.z, yaw: at.yaw };
    a.detour = null; a.attend = null;
    sim.brain.reorder(a, true);
    this.note(f.agent, 'move', `Got into the ${craft} at the controls`, { key: 'air' });
    this.say(f.i, `✈️ Off to fly ${c.label}!`);
  }
  /** Its body at the controls, carried along (planned again as the aircraft moves on, at most twice a second). */
  carryPilot(f, a, A) {
    if (!a.ride?.pilot) return;
    const at = this.seatAt(A, 0), t = this.now();
    Object.assign(a.ride, { x: at.x, y: at.y, z: at.z, yaw: at.yaw });
    if (t - f.rideAt >= 500 && Math.hypot(at.x - f.cx, at.z - f.cz, at.y - f.cy) > 1) { f.rideAt = t; f.cx = at.x; f.cz = at.z; f.cy = at.y; this.sim.brain.reorder(a, true); }
  }
  /** Through a ring (the passes its own path shows, as the run check will find them): where its run stands, for the play
   *  core's moment (its senses' card, server/senses/play-activities.js). */
  passed(f, fl) {
    f.passes = fl.passes.length;
    if (f.reported) return;
    const live = { passed: f.passes, secs: Math.max(0, (fl.ms() - fl.passes[0]) / 1000) };
    try { this.play.moment({ id: -f.agent }, f.run, live); } catch { /* (a few a second at most: the next ring says it) */ }
    if (f.passes === 1) this.note(f.agent, 'activity', `Through the gate of ${COURSE_BY_ID[f.course]?.label || 'the course'} — the clock is running`);
  }
  /** Through the last ring: its run reported (its own flight path), judged by the module's own check. */
  report(f, fl) {
    f.reported = true;
    const c = COURSE_BY_ID[f.course], craft = craftOf(f.type);
    let res;
    try { res = this.play.finish({ id: -f.agent }, f.run, fl.report()); }
    catch (e) { res = { ok: false, why: e.message || 'it could not be reported' }; }
    f.result = res; this.stats.reported++;
    this.home(f);
    if (!res.ok) {
      this.note(f.agent, 'activity', `Your ${c.label} run didn't count: ${clean(res.why, 80)}`);
      if (f.owner != null) this.toAccount(f.owner, { t: 'crew_note', agent: f.agent, i: f.i, text: `${f.name}'s ${c.label} didn't count: ${clean(res.why, 80)}` });
      return;
    }
    this.stats.verified++;
    const t = formatScore(playOf('airport'), res.score), stars = '★'.repeat(res.stars) + '☆'.repeat(3 - res.stars);
    this.say(f.i, `✈️ ${c.label}: ${t} ${stars}`);
    if (f.owner != null) this.toAccount(f.owner, { t: 'crew_note', agent: f.agent, i: f.i, text: `✈️ ${f.name} flew ${c.label} in ${t} ${stars}${res.newBest && res.prevBest ? ' — a new best' : ''}` });
    if (res.stars >= 3 || (res.newBest && res.prevBest)) this.remark(f.i, `I just flew the ${c.label} ring course in the ${craft} in ${t}${res.stars >= 3 ? ', three stars' : ', my best yet'}!`);
  }
  /** Crashed: the ground crew takes the aircraft home and it stands beside its stand (as a person does). */
  crashed(f, why) {
    this.stats.crashed++;
    this.dropRun(f, 'Crashed');
    const c = COURSE_BY_ID[f.course], craft = craftOf(f.type);
    this.note(f.agent, 'activity', `💥 Crashed the ${craft} on ${c?.label || 'the course'}: ${clean(why, 80)} — the ground crew took it back to its stand`);
    if (f.owner != null) this.toAccount(f.owner, { t: 'crew_note', agent: f.agent, i: f.i, text: `💥 ${f.name} crashed the ${craft}: ${clean(why, 60)}` });
    this.end(f, { why: 'crashed', crashed: true });
  }
  /** Its flight over (landed, crashed, given up, its aircraft gone): the aircraft back to the fleet, its body out beside it
   *  (or beside its stand), and back to what it was doing. */
  end(f, { why = 'landed', crashed = false } = {}) {
    if (this.pilots.get(f.agent) !== f) return;
    this.pilots.delete(f.agent);
    const sim = this.sim, F = this.fleet, a = sim?.agents[f.i], A = F?.all.get(f.aircraft), c = COURSE_BY_ID[f.course], craft = craftOf(f.type);
    this.dropRun(f, why);
    let point = null;
    if (A && A.pilot === -f.agent) point = F.landFor(A, { crashed: crashed || !f.flight?.s.onGround });
    if (!a?.plan) return;
    if (a.ride?.pilot) {
      const e = evalPlan(a.plan, sim.now()), at = point || { x: e.x, z: e.z };
      sim.brain.alight(a, at.x, at.z);
      a.ride = null;
      if (!crashed) this.note(f.agent, 'move', `Got out of the ${craft}${why === 'landed' ? ' after landing' : ''}`, { key: 'air' });
    }
    // back to what it was doing: its owner's side, or its own day
    const o = a.order, ours = o?.kind === 'hold' && o.goal === f.goal;
    if (ours) {
      const s = f.saved;
      let back = false;
      if (s?.kind === 'follow' && s.lead?.kind === 'player' && this.players.byId.has(s.lead.id)) {
        const r = sim.order(f.i, { kind: 'follow', lead: s.lead, slot: s.slot, goal: s.goal, by: s.by, byName: s.byName, via: s.via, minutes: 7 * 24 * 60, maxMinutes: 7 * 24 * 60 });
        back = !!r.ok;
      }
      if (!back) { sim.brain.setOrder(a, null); a.ride = null; sim.brain.interruptSoon(a); }
    }
    if (why === 'landed' && f.result?.ok) this.say(f.i, `Back on the ground — ${c?.label}: ${formatScore(playOf('airport'), f.result.score)}`);
  }

  // ------------------------------------------------------------------------------------------------ views
  /** One agent at the airport, for its owner's views, its senses and the tests: aboard (a passenger) or flying. */
  view(agentId) {
    const id = Number(agentId), m = this.riders.get(id), f = this.pilots.get(id), F = this.fleet;
    if (m) { const A = F?.all.get(m.aircraft); return { agent: id, role: 'passenger', aircraft: m.aircraft, type: A?.type || null, craft: craftOf(A?.type), seat: m.seat, seatWords: SEATS[A?.type]?.[m.seat]?.words || null, owner: m.owner, ownerName: m.ownerName, air: !!(A && !F.place(A).g) }; }
    if (f) {
      const c = COURSE_BY_ID[f.course];
      return { agent: id, role: 'pilot', aircraft: f.aircraft, type: f.type, craft: craftOf(f.type), course: f.course, courseLabel: c?.label || f.course, phase: f.phase === 'walk' ? 'walking out' : f.flight?.phase || 'flying',
        passes: f.flight?.passes.length || 0, rings: f.rings.length, run: f.run, result: f.result ? { ok: !!f.result.ok, score: f.result.score ?? null, stars: f.result.stars ?? null, why: f.result.why || null } : null, along: !!f.along };
    }
    return null;
  }
  /** Who rides in aircraft id (body indexes, their seats) — the senses' "in the back seat of Kim's propeller plane". */
  ridersOf(id) { return [...this.riders.values()].filter(m => m.aircraft === id).map(m => ({ i: m.i, seat: m.seat, name: m.name })); }

  // ------------------------------------------------------------------------------------------------ the interaction registry
  /** The registry's source for the airport: getting into its owner's aircraft, flying a ring course, giving one up. */
  source() {
    return { id: 'airport', kinds: ['board', 'fly', 'stop'], notes: true, near: ctx => this.near(ctx), run: (ctx, aff, params) => this.run(ctx, aff, params) };   // (notes: its diary lines are its own)
  }
  /** What it can do here now (ctx: the registry's — rec, i, a, leader). */
  near(ctx) {
    const out = [], rec = ctx?.rec, a = ctx?.a, F = this.fleet, sim = this.sim;
    if (!rec || !a?.plan || !F || !sim) return out;
    const f = this.pilots.get(rec.id);
    if (f) {
      const c = COURSE_BY_ID[f.course], fl = f.flight, inAir = fl && !fl.s.onGround;
      out.push({ key: 'stop', kind: 'stop', label: inAir ? `Give up ${c.label} and fly back to land (${fl.passes.length} of ${f.rings.length} rings so far)` : `Don't fly ${c.label} after all`, where: null, cost: null, effects: {}, withLeader: false, d: 0 });
      return out;
    }
    if (a.ride) return out;   // (riding: in its owner's aircraft it gets out with them; in a car or on a boat, nothing here)
    const e = evalPlan(a.plan, sim.now()), lead = ctx.leader?.account ?? null, A = lead != null ? F.byPilot.get(lead) : null;
    if (A && !A.agent) {
      const p = F.place(A), d = Math.hypot(e.x - p.x, e.z - p.z), n = passengerSeats(A.type);
      if (p.g && (p.v || 0) < STOP_V && d <= OFFER_M && e.ctx === CTX_OUT && n > 0 && F.seats.free(A.id) > 0) {   // (full: nothing to choose — 'board' would only be refused)
        const owner = this.nameOf(lead), craft = craftOf(A.type);
        out.push({ key: `board:${A.id}`, kind: 'board', label: `Get into ${owner}'s ${craft} with them and fly along (${F.seats.free(A.id)} of ${n} passenger seat${n === 1 ? '' : 's'} free)`, where: { x: p.x, z: p.z, ctx: CTX_OUT, place: `${owner}'s ${craft}` }, cost: null, effects: { fun: USES.fly?.rate?.fun ?? 0 }, withLeader: true, d: Math.round(d) });
      }
    }
    // at an airport: the ring courses open to it, each in an aircraft of its class standing free here
    const m = e.ctx === CTX_OUT ? this.airportAt(e.x, e.z) : null;
    if (!m) return out;
    let prog = null; try { prog = this.play.progress(-rec.id).modules.airport; } catch { prog = null; }
    const open = new Set(prog?.unlocked || unlocked(playOf('airport'), {}));
    for (const c of COURSES) {
      const along = this.alongOf(ctx, c);
      if (!open.has(c.id) && !along) continue;
      const A2 = this.freeAircraft(m, c.aircraft, e.x, e.z);
      if (!A2) continue;
      const p = F.place(A2), best = prog?.best?.[c.id], craft = craftOf(c.aircraft);
      const was = best ? `your best: ${formatScore(playOf('airport'), best.score)} ${'★'.repeat(best.stars)}` : 'not flown yet';
      out.push({ key: `fly:${c.id}`, kind: 'fly', label: `Fly ${c.label} in the ${craft}${along ? ` alongside ${this.nameOf(along.account)}'s run` : ''} (${was})`, where: { x: p.x, z: p.z, ctx: CTX_OUT, place: clean(m.name || 'the airport', 40) }, cost: null, effects: { fun: USES.fly?.rate?.fun ?? 0 }, withLeader: !!along, d: Math.round(Math.hypot(p.x - e.x, p.z - e.z)) });
    }
    return out;
  }
  /** Does what aff says (checked again now): → { ok, kind, text (for the page), brain (for its chat), effects }. */
  run(ctx, aff, params = {}) {
    const rec = ctx?.rec, a = ctx?.a, kind = aff?.kind, name = clean(rec?.name || 'It', 40), F = this.fleet;
    const no = (text, brain) => ({ ok: false, kind, text, brain: brain || text });
    if (!rec || !a?.plan || !F) return no(`${name} has no body here`, 'your body is not in the city right now');
    if (kind === 'fly') {
      const id = String(aff.key || '').split(':')[1] || params?.course;
      const r = this.fly(ctx, id, params?.via || ctx.via || 'agent');
      return r.ok ? { ok: true, kind, text: r.text, brain: r.brain, effects: r.effects || {} } : no(r.text, `you could not fly that course: ${r.brain}`);
    }
    if (kind === 'stop') {
      const r = this.giveUp(rec.id);
      return r.ok ? { ok: true, kind, text: r.text, brain: r.brain, effects: {} } : no(r.text, r.brain);
    }
    if (kind === 'board') {
      const lead = ctx.leader?.account ?? null, A = lead != null ? F.byPilot.get(lead) : null;
      if (a.ride?.aircraft && this.riders.has(rec.id)) return { ok: true, kind, text: `${name} is aboard already`, brain: 'you are in the aircraft already', effects: {} };
      if (!A || A.agent) return no(`${name}'s owner is not in an aircraft`, 'your owner is not in an aircraft now');
      const owner = this.nameOf(lead), craft = craftOf(A.type);
      const r = this.tryBoard(a, rec, A, { name: owner });
      if (r.ok) return { ok: true, kind, text: r.text, brain: `you got into ${owner}'s ${craft} with them (${SEATS[A.type]?.[this.riders.get(rec.id)?.seat]?.words || 'a passenger seat'}): you fly with them and get out when they land`, effects: { fun: USES.fly?.rate?.fun ?? 0 } };
      // (not near enough yet, still on the ground: it walks over with them and gets in)
      if (r.why === 'far' && F.place(A).g) { this.wants.add(rec.id); return { ok: true, kind, text: `${name} is coming over to ${owner}'s ${craft} to get in`, brain: `you are walking over to ${owner}'s ${craft} to get in with them`, effects: {} }; }
      return no(r.text, `you could not get in: ${r.text}`);
    }
    return no('Nothing like that to do here', 'there is nothing like that to do here');
  }
  /**
   * A plain command from its owner (the reflex): 'fly' (get into their aircraft with them), 'pilot' (fly a ring course
   * itself: params.course words, else the next one it has to win), 'land' (give it up). → { ok, action, text, brain } or null.
   */
  command(P, rec, action, via = 'chat', ctxOf = null, words = '') {
    const ctx = ctxOf ? ctxOf(rec) : null;
    if (!ctx?.a) return null;
    if (action === 'land') { const r = this.giveUp(rec.id); return { ok: r.ok, action, text: r.text, brain: r.brain }; }
    if (action === 'fly') { const r = this.run({ ...ctx, via }, { kind: 'board' }); return { ok: r.ok, action, text: r.text, brain: r.brain }; }
    // fly a course itself: the one named, else the first open one it hasn't three stars on (in an aircraft free here)
    const opts = this.near(ctx).filter(x => x.kind === 'fly');
    if (!opts.length) {
      const e = evalPlan(ctx.a.plan, this.sim.now()), at = e.ctx === CTX_OUT ? this.airportAt(e.x, e.z) : null;
      const text = at ? `No aircraft is free at ${clean(at.name || 'the airport', 40)} for a course ${clean(rec.name, 40)} can fly now` : `${clean(rec.name, 40)} is not at an airport — the ring courses start from one`;
      return { ok: false, action, text, brain: `you could not fly a course: ${text}` };
    }
    const w = lower(words), named = opts.find(x => { const c = COURSE_BY_ID[x.key.split(':')[1]]; return c && w.includes(lower(c.label)); });
    let prog = null; try { prog = this.play.progress(-rec.id).modules.airport; } catch { prog = null; }
    const pick = named || opts.find(x => (prog?.best?.[x.key.split(':')[1]]?.stars || 0) < 3) || opts[0];
    const r = this.run({ ...ctx, via }, { kind: 'fly', key: pick.key });
    return { ok: r.ok, action, text: r.text, brain: r.brain };
  }
}
