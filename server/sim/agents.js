// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agent brain: needs, daily schedules, work, meals, leisure, sleep, meetings and chats.
// Every decision produces one motion plan (travel + activity) that starts where the previous plan ends.
import { RNG, hashStr } from '../../shared/rng.js';
import { A, PROP, SEATED } from '../../shared/anims.js';
import { USES, USE_ID } from '../../shared/catalog.js';
import { machineGame } from '../../shared/arcade/catalog.js';
import { GROUND_Y, floorAt, ctxOf, ctxB, ctxF, hourAt, dayAt, worldMin, worldSeconds, mod, clamp, RUN_SPEED, JOG_SPEED } from '../../shared/constants.js';
import { F_FACE, F_HIDDEN, CTX_OUT, CTX_UNDER } from '../../shared/proto.js';
import { toWorld, toLocal, bRot } from '../../shared/geom.js';
import { blockRect, blockAt, cornerPoint, SIDE_CORNERS } from '../../shared/city.js';
import { stationInside, stationY } from '../../shared/stations.js';
import { cellCenter } from '../../shared/navgrid.js';
import { Plan, truncatePlan, safeCutTime, evalPlan, continuePlan } from './plan.js';
import { SUBWAY_SPEED } from './nav.js';
import { pickOrder, courses as serveCourses, homeMeal as homeDish, onStove, deskLunch, picnic as picnicFood, guessCuisine, menuIds, FOOD_BY_ID } from '../../shared/food.js';
import { NIGHTLIFE_OPEN, DRINKS, roleAt, ROLE_TITLE, ROLE_USE } from '../../shared/nightlife.js';

const U = USE_ID;
const NEEDS = ['hunger', 'energy', 'social', 'fun', 'hygiene'];
const DECAY = { hunger: 0.066, energy: 0.052, social: 0.045, fun: 0.05, hygiene: 0.034 };
const OPEN = { cafe: [6.5, 21], restaurant: [11, 23.5], shop: [9, 21], gym: [6, 22], park: [6, 22.5], ...NIGHTLIFE_OPEN };
export const isOpen = (kind, h) => { const o = OPEN[kind]; return !o || (h >= o[0] && h < o[1]); };
const inHours = (h, a, b) => (a <= b ? h >= a && h < b : h >= a || h < b);
const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
/** A number 0..1 fixed by who, when and a tag: what someone orders draws no simulation random number (parity). */
const r01 = (pid, t, salt) => (hashStr(`${pid}:${Math.round(t * 10)}:${salt}`) % 10000) / 10000;
/** Free drinks in a workplace lounge (no menu, no bill). */
const LOUNGE_DRINKS = Object.freeze(['cola', 'lemonade', 'sparkling', 'iced_tea', 'beer', 'coffee', 'espresso', 'orange_juice']);
function wpick(rng, opts) {
  let t = 0; for (const o of opts) t += o[1];
  let r = rng.next() * t;
  for (let k = 0; k < opts.length; k++) { r -= opts[k][1]; if (r <= 0) return k; }
  return opts.length - 1;
}

/**
 * The routines that come before free time, in order (Brain.choose). when() only looks (no random draws, no changes), so
 * Brain.reflexAt can ask it ahead of time with predicted needs; act() does it and says whether it worked — when it does
 * not, the next routine is tried, and after the last one comes free time (Brain.leisure).
 */
/** What the lounge at work offers, with the routine's weights (Brain.loungeVisit, Brain.loungeHasRoom). */
// a laptop is worked on at a table (a chair at a table or a bar's stool: the 'eat' seats), never on a sofa, where it would
// have nothing to stand on
const LAPTOP_SEATS = Object.freeze(['eat']);
const LOUNGE_OPTS = Object.freeze([['pingpong', 2], ['play', 1.5], ['music', 0.8], ['dance', 1.2], ['eat', 1.2], ['relax', 1.5]]);
const LOUNGE_USES = LOUNGE_OPTS.map(o => o[0]);

// What a message (or a talk in the city) interrupted, it goes back to afterwards (Brain.bookmark / resumeActivity; 2026-10-12:
// "the bug itself is that it causes a redo of the decision, dismissing what it had already planned"). Not work (the
// shift brings it back, and its hours were counted), sleep (bedtime does), or a moment with someone that has passed.
const RESUME_SKIP_KINDS = new Set(['work', 'sleep', 'idle', 'talk', 'meet', 'chat']);
const RESUME_SKIP_USES = new Set(['phone', 'task', 'task_phone', 'greet', 'sleep', 'nap']);
const MEET_SEARCH_MIN = 180;   // world minutes an AI's "meet" keeps looking for its person before it gives up (the default; the admin's connected.meetSearchMinutes)
// the night's performers (shared/nightlife.js roles): there before their set (onShift: SHOW_EARLY hours more than the
// way there), no breaks during it (2026-10-24, the product owner: "the dj left and there was no music playing yet people
// kept dancing in the nightclub ... why would a dj leave?": a phone break mid-set, and a trip to the gym before it)
const SHOW_ROLES = new Set(['dj', 'musician']), SHOW_EARLY = 1.25;
const REFLEXES = Object.freeze([
  // an AI agent its owner posted at a piece of furniture stays there around the clock (server/agent-posts/): before
  // anything else, and never a Free Will choice
  { id: 'post', when: (B, a) => !!a.p.post, act: (B, a, P) => B.postDuty(a, P) },
  { id: 'task', when: (B, a) => !!a.p.vip && B.sim.presence.isWorking(a.p.agentId), act: (B, a, P, h, day) => B.taskWork(a, P, h, day) },
  { id: 'morning', when: (B, a, P, h) => a.queue.length > 0 && !(B.sleepTime(a, h) && B.justFinishedTask(a, P.t)), act: (B, a, P, h, day) => { while (a.queue.length) { const q = a.queue.shift(); if (B.task(a, P, q, h, day)) return true; } return false; } },
  { id: 'sleep', when: (B, a, P, h) => B.sleepTime(a, h), act: (B, a, P, h) => (B.sleep(a, P, h), true) },
  // (a performer in the middle of a set holds out till it ends unless there is nothing left: the show goes on)
  { id: 'starving', when: (B, a, P, h, day, n) => n.hunger < (B.onStage(a, h, day) ? 0.04 : 0.2), act: (B, a, P, h, day) => B.eat(a, P, h, day) },
  { id: 'filthy', when: (B, a, P, h, day, n) => n.hygiene < 0.18, act: (B, a, P) => !!B.homeUse(a, P, ['shower'], [6, 12]) },
  { id: 'shift', when: (B, a, P, h, day) => B.onShift(a, P, h, day), act: (B, a, P, h, day) => (B.work(a, P, h, day, false), true) },
  { id: 'meal', when: (B, a, P, h, day, n) => B.mealDue(a, h, day, n), act: (B, a, P, h, day) => B.eat(a, P, h, day) },
  { id: 'exhausted', when: (B, a, P, h, day, n) => n.energy < 0.22, act: (B, a, P, h) => B.rest(a, P, h) },
  { id: 'shower', when: (B, a, P, h, day, n) => n.hygiene < 0.35 && (h > 17 || h < 10), act: (B, a, P) => !!B.homeUse(a, P, ['shower'], [6, 12]) },
]);

export function makeAgent(i, p, seed) {
  const rng = new RNG((hashStr(p.id) ^ seed) >>> 0);
  return {
    i, p, rng, rnd: () => rng.next(),
    needs: { hunger: rng.float(0.45, 0.95), energy: rng.float(0.5, 1), social: rng.float(0.35, 1), fun: rng.float(0.35, 1), hygiene: rng.float(0.55, 1) },
    nt: 0, plan: null, act: null, res: null, queue: [], hv: 0, ver: 0,
    lastBreak: 0, breakGap: 0, lunchDay: -1, dinnerDay: -1, doneDay: -1, carry: 0, carryUntil: 0,
    actCtx: null, joinKey: null, busyUntil: 0,
  };
}

// Players at furniture (2026-10-24, the product owner: "multiple agents play over each other on the same spot for the
// same machine ... let's not allow playing on each other"): where players are using something right now, [{ x, z, ctx }]
// (server/index.mjs: the players' accepted states, PF_USING): a slot a player is at is nobody else's for the next
// PLAYER_HOLD world minutes, and agents on their way to it go elsewhere (playerTook).
let playerSpots = () => [];
export function setPlayerSpots(fn) { playerSpots = typeof fn === 'function' ? fn : () => []; }
const PLAYER_HOLD = 30, PLAYER_NEAR = 0.45;
/** Where a plan being made stands, to come back to (a seat that turns out taken when they would get there: useAt);
 *  the routes only add to a plan's own segments. */
const planMark = P => ({ n: P.segs.length, t: P.t, x: P.x, y: P.y, z: P.z, yaw: P.yaw, ctx: P.ctx, seat: P.seat, tele: P.tele, dest: P.meta.dest });
function planBack(P, m) { P.segs.length = m.n; P.t = m.t; P.x = m.x; P.y = m.y; P.z = m.z; P.yaw = m.yaw; P.ctx = m.ctx; P.seat = m.seat; P.tele = m.tele; P.meta.dest = m.dest; }
export class Brain {
  constructor(sim) { this.sim = sim; this.res = new Map(); this.at = new Map(); this.joinable = new Map(); }
  get W() { return this.sim.world; }
  get index() { return this.sim.index; }
  get router() { return this.sim.router; }
  get nav() { return this.sim.nav; }
  get clock() { return this.sim.clock; }
  wm(min) { return worldMin(this.clock, min); }
  hour(t) { return hourAt(this.clock, t); }
  day(t) { return dayAt(this.clock, t); }
  /** Hours from the world time at sim-time t until the clock next reads hour h (0 <= result < 24). */
  hoursUntil(t, h) { let d = (h % 24) - this.hour(t); if (d < 0) d += 24; return d; }
  hSecs(hours) { return hours * 3600 / this.clock.dayScale; }

  // ------------------------------------------------------------------ needs
  needsAt(a, t, out = null) {
    const n = out || a.needs;
    if (out) for (const k of NEEDS) out[k] = a.needs[k];
    if (a.p.post) { if (!out) a.nt = t; return n; }   // (on its post its needs wait: it isn't living its day)
    const dtH = (t - a.nt) * this.clock.dayScale / 3600;
    if (!(dtH > 0)) return n;
    const act = a.act, sleeping = !!act && (act.use === 'sleep' || act.use === 'nap');
    n.hunger -= DECAY.hunger * dtH * a.p.tr.food * (sleeping ? 0.35 : 1);
    n.energy -= sleeping ? 0 : DECAY.energy * dtH;
    n.social -= DECAY.social * dtH * (0.5 + a.p.tr.soc) * (sleeping ? 0.2 : 1);
    n.fun -= DECAY.fun * dtH * (sleeping ? 0.2 : 1);
    n.hygiene -= DECAY.hygiene * dtH;
    if (act && act.holdEnd > act.holdStart) {
      const s = Math.max(a.nt, act.holdStart), e = Math.min(t, act.holdEnd);
      if (e > s && act.rate) { const hh = (e - s) * this.clock.dayScale / 3600; for (const k in act.rate) n[k] += act.rate[k] * hh; }
      if (act.once && !act.onceDone && t >= (act.holdStart + act.holdEnd) / 2) {
        for (const k in act.once) n[k] += act.once[k];
        if (!out) act.onceDone = true;
      }
    }
    for (const k of NEEDS) n[k] = clamp(n[k], 0, 1);
    if (!out) a.nt = t;
    return n;
  }

  // ------------------------------------------------------------------ bookkeeping
  // A slot is held by whoever is to be in it, for the time they are to be in it (2026-10-24, the product owner: "a lot of
  // agents are sitting on the same seat"): a plan with several stops (a drink at the bar, then the dance floor, then a
  // booth) keeps each of them, each for its stay (from the arrival to the end of its hold: act), so nobody planning
  // meanwhile is given a seat someone will be in then, and a seat someone will only get to later is free until then. It
  // held one slot a resident: choosing the next stop let go of the last, which they had yet to get to, and a club's bar
  // filled its first stool with a dozen people at once. res: slot key → [[who, from, until], …], a stay each (until:
  // Infinity while the stay is being planned; several games in a row at one machine: several stays); a.resv: the keys a
  // resident's plan holds; a.res: the last of them.
  key(b, f, id, k) { return b + ':' + f + ':' + id + ':' + k; }
  /** Is the slot held by someone else at any time in [t0, t1) (by default, right now)? */
  heldBy(key, who, win = null) {
    const l = this.res.get(key); if (!l) return false;
    const t0 = win ? win[0] : this.sim.now(), t1 = win ? win[1] : t0 + 1;
    return l.some(r => r[0] !== who && r[2] > t0 && r[1] < t1);
  }
  taken(b, f, id, k, who, win = null) { return this.heldBy(this.key(b, f, id, k), who, win) || this.playerOn(b, f, id, k, win); }
  /** Where slot k of item id on floor f of building b is in the world: { x, z }, or null. */
  slotAt(b, f, id, k) { const B = this.W.buildings[b], s = this.index.entry(b, f, id)?.slots[k]; return B && s ? toWorld(B, s.lx, s.lz) : null; }
  /** A player at that slot now, for a stay starting within PLAYER_HOLD world minutes (win: by default now). */
  playerOn(b, f, id, k, win = null) {
    const ps = playerSpots(); if (!ps.length) return false;
    const now = this.sim.now(); if (win && win[0] > now + this.wm(PLAYER_HOLD)) return false;
    const ctx = ctxOf(b, f); let at = null;
    for (const p of ps) {
      if (p.ctx !== ctx) continue;
      at = at || this.slotAt(b, f, id, k);
      if (at && Math.hypot(p.x - at.x, p.z - at.z) < PLAYER_NEAR) return true;
    }
    // a table played against the computer (air hockey, foosball): a player at either end holds all of it
    const e = at !== null ? this.index.entry(b, f, id) : null;
    if (e && e.slots.length > 1 && machineGame(e.it?.t)?.cpu) {
      for (let j = 0; j < e.slots.length; j++) {
        const o = j === k ? null : this.slotAt(b, f, id, j);
        if (o && ps.some(p => p.ctx === ctx && Math.hypot(p.x - o.x, p.z - o.z) < PLAYER_NEAR)) return true;
      }
    }
    return false;
  }
  /** A player sat down or started playing at (x, z) on floor ctx: whoever was to be in that slot soon goes elsewhere. */
  playerTook(x, z, ctx) {
    if (!(ctx >= 0)) return 0;
    const b = ctxB(ctx), f = ctxF(ctx), B = this.W.buildings[b], L = B && !B.gone ? this.W.levels[B.lv[f]] : null;
    if (!L) return 0;
    const now = this.sim.now(), soon = now + this.wm(PLAYER_HOLD);
    let n = 0;
    for (const it of L.items || []) {
      const e = this.index.entry(b, f, it.id); if (!e) continue;
      // (a table played against the computer is all the player's: those bound for its other end go elsewhere too)
      const whole = e.slots.length > 1 && machineGame(it.t)?.cpu && e.slots.some(s => { const w = toWorld(B, s.lx, s.lz); return Math.hypot(w.x - x, w.z - z) <= PLAYER_NEAR; });
      e.slots.forEach((s, k) => {
        const w = toWorld(B, s.lx, s.lz);
        if (!whole && Math.hypot(w.x - x, w.z - z) > PLAYER_NEAR) return;
        for (const r of [...(this.res.get(this.key(b, f, it.id, k)) || [])]) {
          const a = r[2] > now && r[1] < soon ? this.sim.agents[r[0]] : null;
          if (a?.plan) { this.interruptSoon(a); n++; }
        }
      });
    }
    return n;
  }
  /** Hold a slot for resident a over win ([from, until]; by default from now on) if nobody else has it then. */
  reserve(a, b, f, id, k, win = null) {
    const key = this.key(b, f, id, k), now = this.sim.now(), w = win || [now, Infinity];
    let l = this.res.get(key);
    if (l) { l = l.filter(r => r[2] > now); if (l.some(r => r[0] !== a.i && r[2] > w[0] && r[1] < w[1])) return false; }
    else l = [];
    if (this.playerOn(b, f, id, k, w)) return false;
    l.push([a.i, w[0], Infinity]);
    this.res.set(key, l);
    if (!a.resv) a.resv = [];
    if (!a.resv.includes(key)) a.resv.push(key);
    a.res = key;
    return true;
  }
  /** Undo the reservation of slot key just made (its stay still being planned). */
  unreserve(a, key) {
    const l = this.res.get(key); if (!l) return;
    const r = l.findLast(q => q[0] === a.i && q[2] === Infinity); if (!r) return;
    l.splice(l.indexOf(r), 1); if (!l.length) this.res.delete(key);
    if (!l.some(q => q[0] === a.i)) { a.resv = (a.resv || []).filter(k => k !== key); a.res = a.resv.length ? a.resv[a.resv.length - 1] : null; }
  }
  /** Its stay at slot key (the one being planned) is from t0 to t1 (act): before and after it the slot is free to others. */
  holdFor(a, key, t0, t1) { const r = this.res.get(key)?.findLast(q => q[0] === a.i && q[2] === Infinity); if (r) { r[1] = t0; r[2] = t1; } }
  /** When a stop on floor f of building b would surely have them there: from their arrival (the router's estimate, give
   *  or take) through the shortest stay of dur (world minutes: [min, max], or a time) — a slot not free then is no
   *  choice; the stay as planned is checked to the second after (useAt). */
  stayWindow(P, b, f, dur) {
    const B = this.W.buildings[b], est = B ? this.router.estimate(P.ctx, P.x, P.z, { ctx: ctxOf(b, f), x: B.x, z: B.z }) : 0;
    const d = typeof dur === 'number' ? dur : this.wm(dur[0]);
    return [P.t + est * 0.9, P.t + est * 1.1 + d];
  }
  release(a) {
    for (const key of a.resv || []) {
      const l = this.res.get(key); if (!l) continue;
      const m = l.filter(r => r[0] !== a.i);
      if (m.length) this.res.set(key, m); else this.res.delete(key);
    }
    a.resv = []; a.res = null;
  }
  setAct(a, act) {
    if (a.actCtx !== null) { const s = this.at.get(a.actCtx); if (s) { s.delete(a.i); if (!s.size) this.at.delete(a.actCtx); } }
    a.act = act; a.actCtx = null;
    if (act && act.ctx >= 0) { let s = this.at.get(act.ctx); if (!s) this.at.set(act.ctx, s = new Set()); s.add(a.i); a.actCtx = act.ctx; }
  }
  join(a, key) { this.leaveJoin(a); let s = this.joinable.get(key); if (!s) this.joinable.set(key, s = new Set()); s.add(a.i); a.joinKey = key; }
  leaveJoin(a) {
    if (!a.joinKey) return;
    const s = this.joinable.get(a.joinKey);
    if (s) { s.delete(a.i); if (!s.size) this.joinable.delete(a.joinKey); }
    a.joinKey = null;
  }
  regionKey(ctx, x, z) { return ctx >= 0 ? 'c' + ctx : 'o' + Math.floor(x / 30) + ',' + Math.floor(z / 30); }
  act(a, kind, useName, P, info = {}) {
    const def = USES[useName] || USES.idle;
    const act = {
      kind, use: useName, label: info.label || def.label, icon: info.icon || def.icon, rate: def.rate || null, once: def.once || null, onceDone: false,
      place: info.place || '', ctx: info.ctx ?? P.ctx, b: info.b ?? -1, f: info.f ?? -1, id: info.id ?? -1, k: info.k ?? -1,
      // (the way there ends where its stay begins: an act given its hold but not its arrival arrived at the hold)
      start: P.base, travelEnd: info.arrive ?? info.holdStart ?? P.t, holdStart: info.holdStart ?? P.t, holdEnd: info.holdEnd ?? P.t,
    };
    if (info.order) act.order = info.order;   // what they ordered or made (shared/food.js ids): the bill, the activity's words
    if (Number.isInteger(info.talkWith)) act.talkWith = info.talkWith;   // whom it talks with (an AI's meet or say --to): its life's log
    this.setAct(a, act);
    if (act.id >= 0 && act.k >= 0) this.holdFor(a, this.key(act.b, act.f, act.id, act.k), Math.min(act.travelEnd, act.holdStart), act.holdEnd);   // (its seat: held from its arrival until it gets up)
    if (this.sim.onAct) this.sim.onAct(a, act);   // the economy: purchases at venues, hours at work (server/economy/households.js)
    for (const fn of this.sim.actObservers) fn(a, act);   // observers only (an agent's activity log and memories: server/agent-life/)
    return act;
  }
  placeName(b, f) {
    const B = this.W.buildings[b]; if (!B) return '';
    const L = this.W.levels[B.lv[f]];
    if (L && NIGHTLIFE_OPEN[L.venue] && L.name && !L.named) return `${B.name} ${L.name}`;   // (a night out with its theme's name: whose it is)
    if (L && L.venue && L.venue !== 'lounge' && L.name) return L.name;
    if (B.type === 'park' || f === 0) return B.name;
    if (L && L.venue === 'lounge') return `${B.name} ${L.name}`;
    return `${B.name}, floor ${f + 1}`;
  }
  // ------------------------------------------------------------------ food (shared/food.js)
  /** Orders and what is on the table travel with the plans; off (tools/sim-digest.mjs --no-food): the plans of before. */
  get food() { return this.sim.food !== false; }
  /** What the café or restaurant at (b, f) sells: its business's menu, else (no economy) its cuisine's from its name. */
  menuAt(b, f) {
    const m = this.sim.econ?.menuAt?.(b, f); if (m) return m;
    const B = this.W.buildings[b], L = B && this.W.levels[B.lv[f]];
    return L ? menuIds(guessCuisine(L.name || B.name, L.venue, b)) : [];
  }
  /** Resident a's order at (b, f) for an occasion (shared/food.js pickOrder) as hold options: { order, courses }. */
  orderAt(a, b, f, occasion, t) {
    if (!this.food) return {};
    const pid = a.p.id, h = this.hour(t);
    if (occasion === 'meal' && h >= 5 && h < 11) occasion = 'breakfast';
    const order = pickOrder(this.menuAt(b, f), occasion, h, tag => r01(pid, t, tag));
    return order.length ? { order, courses: serveCourses(order) } : {};
  }
  /** Working at a café: a drink (maybe a snack) bought, the drink beside the laptop. */
  workCoffee(a, v, t) {
    const o = this.orderAt(a, v.b, v.f, 'coffee', t);
    const d = o.order?.map(id => FOOD_BY_ID[id]).find(i => i?.course === 'drink');
    return o.order ? { order: o.order, item: d ? d.n : 0 } : {};
  }
  /** A meal made at home at time t, as hold options; k: the home's kitchen (homeKitchen: no stove, no table → what can be). */
  homeFood(a, t, k = {}) { const pid = a.p.id; return this.served(this.food ? homeDish(this.hour(t), tag => r01(pid, t, tag), k) : []); }
  /**
   * What a home has to cook and eat with (2026-10-08: "food type and seating type need to go hand in hand"): a stove
   * (a kitchen unit's hob: use cook), a counter (prep), a table (eat), a seat (relax). null: no home.
   */
  homeKitchen(a) {
    const lv = this.homeLv(a);
    if (lv < 0) return null;
    const ids = this.index.unitItems(lv, a.p.home.u), has = u => this.index.findUses(lv, u, ids).length > 0;
    return { stove: has('cook'), prep: has('prep'), table: has('eat'), seat: has('relax') };
  }
  /**
   * Eating a home meal (hold options `meal`): at the table; without one on a seat or standing in the kitchen, with the
   * food in the hands (the dish was picked for that: homeFood). Its length on a table (dur) and elsewhere (short).
   */
  eatAtHome(a, P, k, meal, dur, short) {
    return !!((k.table && this.homeUse(a, P, ['eat'], dur, meal)) ||
      (k.seat && this.homeUse(a, P, ['relax'], short, meal)) ||
      this.homeUse(a, P, ['prep', 'cook', 'wash', 'fridge'], short, { ...meal, anim: A.idle }));
  }
  /** Food that is no purchase (made at home, brought to work, a picnic): ids → hold options. */
  served(order) { return this.food && order.length ? { order, courses: serveCourses(order) } : {}; }
  topt(a, o = {}, t = 0) {
    let prop = o.prop || 0;
    if (!prop && a.carry && a.carryUntil > t) prop = a.carry;
    return { speed: o.speed || a.p.speed, anim: o.anim ?? A.walk, use: o.use ?? U.walk, off: a.p.off, rng: a.rnd, prop, stop: a.i, i: a.i, noSubway: !!o.noSubway };
  }

  // ------------------------------------------------------------------ furniture use primitives
  freeSlots(b, f, uses, who, win = null) {
    const B = this.W.buildings[b]; if (!B || B.gone || f < 0 || f >= B.floors) return [];
    const list = this.index.findUsesCached(B.lv[f], uses), out = [];
    for (const e of list) if (!this.taken(b, f, e[0], e[1], who, win)) out.push(e);
    return out;
  }
  pickNear(a, list, x, z, B) {
    // mildly prefer closer slots
    if (list.length <= 1) return list[0];
    let best = list[0], bs = Infinity;
    for (let k = 0; k < Math.min(list.length, 24); k++) {
      const e = list[Math.floor(a.rng.next() * list.length)], s = e[2];
      const w = B ? toWorld(B, s.ax, s.az) : { x: s.ax, z: s.az };
      const sc = hyp(w.x, w.z, x, z) * (0.6 + a.rng.next() * 0.8);
      if (sc < bs) { bs = sc; best = e; }
    }
    return best;
  }
  /** Travel to a slot's approach point and settle into it. Returns a settle record or null. */
  slotBegin(a, P, b, f, id, k, o = {}) {
    const B = this.W.buildings[b], e = this.index.entry(b, f, id);
    if (!B || !e || !e.slots[k]) return null;
    if (!o.noReserve && !this.reserve(a, b, f, id, k, o.win || [P.t, Infinity])) return null;
    const s = e.slots[k], ctx = ctxOf(b, f), y = floorAt(this.W.buildings[b], f);
    // Normally the approach point; nav.approach moves it when no entrance reaches it or a wall separates it from the slot.
    const ap = this.nav.approach(B.lv[f], s);
    const tw = toWorld(B, ap.x, ap.z);                              // where the route ends
    const aw = ap.via ? toWorld(B, ap.via.x, ap.via.z) : tw;        // where the resident stands to use the slot
    const sw = toWorld(B, s.lx, s.lz), yaw = s.yaw + bRot(B);
    const use = o.use != null ? (U[o.use] ?? U.idle) : s.uid, anim = o.anim ?? s.anim, prop = o.prop ?? s.prop;
    const sk = this.key(b, f, id, k);
    if (P.seat && P.seat.key === sk) {
      // already sitting here: just keep going
      P.meta.dest = ctx;
      return { b, f, id, k, s, aw, sw, y, yaw, ctx, use, anim, prop, arrive: P.t, B, sk };
    }
    if (P.tele) {
      P.tele = false;
      if (!P.place(sw.x, y + s.y, sw.z, ctx, yaw)) P.jump(sw.x, y + s.y, sw.z, ctx, yaw);   // (mid-plan: posted this moment, postNow)
      P.meta.dest = ctx;
      return { b, f, id, k, s, aw, sw, y, yaw, ctx, use, anim, prop, arrive: P.t, B, sk };
    }
    this.router.travel(P, { ctx, x: tw.x, z: tw.z, lx: ap.x, lz: ap.z }, this.topt(a, o.travel || {}, P.t));
    if (ap.via) P.move(aw.x, y, aw.z, 0.7, A.walk, use, { ctx });   // squeeze into the gap beside the slot
    const arrive = P.t;
    if (s.moveIn) {
      P.seg(0.35, aw.x, y, aw.z, yaw, A.idle, use, prop, F_FACE, ctx, { nocut: 1 });
      P.seg(Math.max(0.8, hyp(aw.x, aw.z, sw.x, sw.z) / 1.1), sw.x, y + s.y, sw.z, yaw, anim, use, prop, F_FACE, ctx, { nocut: 1 });
    } else {
      if (hyp(P.x, P.z, sw.x, sw.z) > 0.03 || Math.abs(P.y - y - s.y) > 0.02) P.move(sw.x, y + s.y, sw.z, 0.9, A.walk, use, { ctx });
      P.seg(0.3, sw.x, y + s.y, sw.z, yaw, A.idle, use, prop, 0, ctx);
    }
    P.meta.dest = ctx;
    return { b, f, id, k, s, aw, sw, y, yaw, ctx, use, anim, prop, arrive, B, sk };
  }
  slotHold(a, P, st, dur, o = {}) {
    dur = Math.max(dur, 2);
    const holdStart = P.t, extra = { h: 1 };
    if (st.s.moveIn) { extra.up = { x: st.aw.x, y: st.y, z: st.aw.z }; extra.sk = st.sk; }
    const cs = this.food ? o.courses : null;
    if (cs?.length) {
      // what they ordered, course by course (shared/food.js courses): each segment carries its item (shared/proto.js)
      // (the hold ends exactly where one segment of dur would: P.t + (end - P.t) is end, so every later time is unchanged)
      const end = P.t + dur, n = cs.length;
      cs.forEach((c, k) => {
        const d = k === n - 1 ? end - P.t : Math.min(end - P.t - 0.4 * (n - 1 - k), Math.max(0.4, dur * c.f));
        const prop = o.prop === PROP.phone ? PROP.phone : c.sip ? PROP.cup : 0;
        P.seg(d, st.sw.x, st.y + st.s.y, st.sw.z, st.yaw, o.anim ?? st.anim, st.use, prop, 0, st.ctx, { ...extra, veh: c.item });
      });
    } else P.seg(dur, st.sw.x, st.y + st.s.y, st.sw.z, st.yaw, o.anim ?? st.anim, st.use, o.prop ?? st.prop, 0, st.ctx, this.food && o.item ? { ...extra, veh: o.item } : extra);
    P.seat = st.s.moveIn ? { key: st.sk, up: extra.up } : null;
    return { holdStart, holdEnd: P.t };
  }
  slotInfo(st) { return { b: st.b, f: st.f, id: st.id, k: st.k, ctx: st.ctx, arrive: st.arrive }; }
  /** Pick a free slot with one of `uses` on (b, f) and use it for dur world minutes ([min, max] or number). */
  useAt(a, P, b, f, uses, dur, o = {}) {
    const win = this.stayWindow(P, b, f, dur);
    let list = this.freeSlots(b, f, uses, a.i, win), st = null, hs = null;
    const B = this.W.buildings[b], snap = planMark(P);
    for (let tries = 0; tries < 4 && list.length; tries++) {
      const e = o.pick ? o.pick(list) : this.pickNear(a, list, P.x, P.z, B);
      if (!e) return null;   // (a pick that wanted one kind of piece and found none free)
      const key = this.key(b, f, e[0], e[1]);
      st = this.slotBegin(a, P, b, f, e[0], e[1], { ...o, win });
      if (!st) { list = list.filter(x => x !== e); continue; }   // (held then after all: the next)
      const d = typeof dur === 'number' ? dur : this.wm(a.rng.float(dur[0], dur[1]));
      hs = this.slotHold(a, P, st, d, o);
      // the stay as planned, to the second: someone else in that seat then (the way there took longer or shorter than
      // reckoned) → back, and another seat; none of a few: not this stop
      if (this.heldBy(key, a.i, [st.arrive, hs.holdEnd]) || this.playerOn(b, f, e[0], e[1], [st.arrive, hs.holdEnd])) {
        planBack(P, snap); this.unreserve(a, key);
        list = list.filter(x => x !== e); st = null;
        continue;
      }
      break;
    }
    if (!st) return null;
    const useName = o.use || st.s.use;
    this.act(a, o.kind || 'visit', useName, P, { ...this.slotInfo(st), ...hs, place: o.place || this.placeName(b, f), ...(this.food && o.order ? { order: o.order } : {}) });
    return { st, hs };
  }

  // ------------------------------------------------------------------ home
  homeLv(a) {
    const h = a.p.home; if (!h) return -1;
    const B = this.W.buildings[h.b];
    return B && !B.gone && h.f < B.floors ? B.lv[h.f] : -1;
  }
  homeUse(a, P, uses, dur, o = {}) {
    const h = a.p.home, lv = this.homeLv(a);
    if (lv < 0) return null;
    const ids = this.index.unitItems(lv, h.u), mine = new Set(ids);
    const list = this.index.findUses(lv, new Set(uses), ids).filter(e => !this.taken(h.b, h.f, e[0], e[1], a.i));
    if (!list.length) return null;
    // (of the floor's free slots for the stay, the home's own: someone of the household may be at the table then)
    return this.useAt(a, P, h.b, h.f, uses, dur, { ...o, place: 'Home', kind: o.kind || 'home', pick: free => { const own = free.filter(e => mine.has(e[0])); return own.length ? own[Math.floor(a.rng.next() * own.length)] : null; } });
  }
  homeMeal(a, P) {
    const k = this.homeKitchen(a);
    if (!k) return false;
    const pid = a.p.id, t = P.t, dish = this.food ? homeDish(this.hour(t), tag => r01(pid, t, tag), k) : [];
    const item = dish.length ? FOOD_BY_ID[dish[0]].n : 0, o = { item, ...(item ? { order: dish.slice(0, 1) } : {}) };
    // cooking is at a stove (the pan on its hob holds what they will eat); without one — or for a dish that isn't cooked —
    // something cold is made on the counter's board (2026-10-08: they cooked in a pan on the counter, without a stove)
    if (a.rng.chance(0.55)) {
      const made = k.stove && (!item || onStove(dish[0])) ? this.homeUse(a, P, ['cook'], [8, 18], { use: 'cook', anim: A.cook, ...o })
        : k.prep ? this.homeUse(a, P, ['prep'], [3, 8], { use: 'prep', ...o }) : null;
      if (!made) this.homeUse(a, P, ['fridge'], [1, 2]);
    } else this.homeUse(a, P, ['fridge'], [1, 2]);
    return this.eatAtHome(a, P, k, { kind: 'meal', use: 'eat', ...this.served(dish) }, [18, 32], [12, 22]);
  }
  homeRelax(a, P, h) {
    const lv = this.homeLv(a); if (lv < 0) return false;
    const types = this.index.unitTypes(lv, a.p.home.u);
    let dur = [20, 60];
    if (h >= 19) {
      const untilBed = this.hoursUntil(P.t, a.p.sched.bed) * 60;
      dur = untilBed < 300 ? [Math.max(10, Math.min(40, untilBed * 0.5)), Math.max(20, Math.min(150, untilBed))] : [30, 90];
    }
    const r = a.rng.next();
    if (r < 0.5) return !!this.homeUse(a, P, ['relax'], dur, { use: types.has('tv_stand') ? 'tv' : 'relax' });
    if (r < 0.72) return !!(this.homeUse(a, P, ['computer'], dur) || this.homeUse(a, P, ['relax'], dur));
    if (r < 0.88) {
      this.homeUse(a, P, ['browse'], [1, 3], { use: 'read', prop: PROP.book });
      return !!(this.homeUse(a, P, ['relax'], dur, { use: 'read', prop: PROP.book }) || this.homeUse(a, P, ['eat'], dur, { use: 'read', prop: PROP.book, anim: A.sit_relax }));
    }
    return !!(this.homeUse(a, P, ['eat'], [10, 30], { use: 'phone', anim: A.sit_phone, prop: PROP.phone }) || this.homeUse(a, P, ['relax'], dur));
  }

  // ------------------------------------------------------------------ decisions
  decide(a, now) {
    const old = a.plan, t0 = Math.max(old.t, now);
    this.needsAt(a, t0);
    this.release(a); this.leaveJoin(a); this.setAct(a, null);
    let P = continuePlan(old, now);
    if (P.ctx === CTX_UNDER) P.ctx = CTX_OUT;
    if (a.away) {   // back from out of town (outOfTown): onto a footpath, if there is one now
      a.away = false;
      const s = this.nowhere(a) ? null : this.outdoorSpot(a);
      if (s) P.place(s.x, s.y, s.z, CTX_OUT);
    }
    P.extendTo(now);
    try { this.choose(a, P); }
    catch (e) {
      this.sim.noteError(e);
      this.release(a); this.leaveJoin(a); this.setAct(a, null);
      P = continuePlan(old, now);
      if (P.ctx === CTX_UNDER) P.ctx = CTX_OUT;
    }
    if (P.t - t0 < 1) {
      P.hold(this.wm(a.rng.float(3, 8)), A.idle, U.idle);
      if (!a.act) this.act(a, 'idle', 'idle', P, { holdStart: t0, holdEnd: P.t });
    }
    this.sim.commit(a, P);
  }
  /** The next thing to do: the first routine (REFLEXES) that applies and succeeds, otherwise free time. */
  choose(a, P) {
    const h = this.hour(P.t), day = this.day(P.t), n = a.needs;
    if (this.nowhere(a)) return this.outOfTown(a, P);
    if (a.taskWay && !(a.p.vip && this.sim.presence.isWorking(a.p.agentId))) { a.taskWay = null; a.taskEnded = P.t; }   // the task is done
    const fw = this.sim.freeWill, free = !!(fw && fw.isActive(a.i));
    // what a message interrupted: back to it once the message is dealt with (no new decision); a bookmark it can't go back
    // to is let go here, and the day goes on as usual (Free Will was told what it was doing)
    if (a.resume && !(a.p.vip && this.sim.presence.isWorking(a.p.agentId))) {
      if (this.resumeValid(a, P, P.t, n) && this.resumeActivity(a, P, h, day)) return;
      a.resume = null;
    }
    // its outside AI's order comes first — after a post, a task in hand and a body in trouble
    if (this.orderNow(a, P) && !a.p.post && !(a.p.vip && this.sim.presence.isWorking(a.p.agentId)) && n.hunger >= 0.2 && n.energy >= 0.22) {
      if (this.doOrder(a, P, h, day)) return;
      // it can't any more (closed, full, no money, they went somewhere private): the routine goes on, and its AI is told
      a.orderEnded = { kind: a.order.kind, who: a.order.who, why: a.order.ended || 'not_possible', at: P.t };
      this.setOrder(a, null);
    }
    for (const r of REFLEXES) {
      if (!r.when(this, a, P, h, day, n)) continue;
      // an agent with Free Will chooses how (where to eat, how to start the day, where to work on a task…); when its
      // choice did not arrive or cannot be done, the routine does it as always
      const t = free ? this.choiceType(r.id, a, P, P.t) : null;
      if (t) {
        const pick = fw.take(a, P, h, day, t);
        if (pick) {
          const ok = this.doChoice(a, P, h, day, pick);
          fw.done(a, pick, ok !== false);
          if (ok === true) return;
          if (ok === 'skip') continue;
        }
      }
      if (r.act(this, a, P, h, day)) return;
    }
    return this.leisure(a, P, h, day);
  }
  /**
   * For an agent with Free Will: the kind of choice routine rule `id` becomes, or null when the routine decides alone
   * (asleep, a shower, carrying on with a task already started). Pure; Free Will asks ahead with it.
   */
  choiceType(id, a, P, t) {
    switch (id) {
      case 'task': return a.taskWay ? null : 'task';
      case 'sleep': return this.justFinishedTask(a, t) ? 'after_task' : null;
      case 'morning': return a.morningDay === this.day(t) ? null : 'morning';
      case 'starving': case 'meal': return 'meal';
      case 'shift': return a.shiftDay === this.day(t) || (P.ctx >= 0 && ctxB(P.ctx) === a.p.job.b) ? null : 'shift';
      case 'exhausted': return 'rest';
      default: return null;
    }
  }
  /** Marks what it is doing as something to go back to (a message or a talk in the city is about to interrupt it); true
   *  when it made a bookmark. A second interruption while it handles the first keeps the first. */
  bookmark(a, now = this.sim.now()) {
    const x = a.act;
    if (a.resume && a.resume.until > now) return false;
    if (!x || x.holdEnd - now < this.wm(5) || RESUME_SKIP_KINDS.has(x.kind) || RESUME_SKIP_USES.has(x.use)) return false;
    const e = a.plan ? evalPlan(a.plan, Math.max(now, x.holdStart + 0.01)) : null, seg = e && e.s;
    a.resume = {
      at: now, until: x.holdEnd, kind: x.kind, use: x.use, label: x.label, icon: x.icon, place: x.place || '', enRoute: x.holdStart > now + 0.5,
      b: x.b, f: x.f, id: x.id, k: x.k, slot: x.b >= 0 && x.id >= 0 && x.k >= 0, anim: seg ? seg.anim : undefined, prop: seg ? seg.prop : undefined,
    };
    return true;
  }
  /**
   * A message (or a job) starts or ends for an AI agent (index.mjs, its presence). At a screen already — its desk, its
   * computer, a laptop — it answers right there and carries on: nothing changes. Otherwise it marks what it is doing to go
   * back to, notes when it woke it, and turns to it (its phone, a laptop, its desk; up from bed at night); when the work
   * ends it goes back to what it was doing (choose → resumeActivity), or to bed.
   */
  workChanged(a, working) {
    if (working) {
      if (this.atScreen(a)) { a.msgHere = true; return; }
      a.msgHere = false;
      if (a.act?.use === 'sleep') a.wokenAt = this.sim.now();
      this.bookmark(a);
      this.interruptSoon(a);
    } else if (a.msgHere && !a.taskWay) a.msgHere = false;
    else { a.msgHere = false; this.interruptSoon(a); }
  }
  /** Whether it is at a screen now — a desk, its computer at home, a laptop (typing): a message is answered right there. */
  atScreen(a, now = this.sim.now()) {
    const x = a.act;
    if (!x || !a.plan || x.holdStart > now || x.holdEnd <= now) return false;
    const e = evalPlan(a.plan, now);
    return !!(e.s && e.s.anim === A.sit_type);
  }
  /** Whether it can go back at t to what it was doing (pure: Free Will asks nothing then): the same day, enough of it left,
   *  nothing that comes first (a post, its AI's order, a body in trouble, bedtime, its shift), and a kind it can go back to. */
  resumeValid(a, P, t, n) {
    const r = a.resume;
    if (!r || (a.p.vip && this.sim.presence.isWorking(a.p.agentId))) return false;
    if (r.until - t < this.wm(5) || this.day(r.at) !== this.day(t)) return false;
    if (a.p.post || (a.order && a.order.until > t)) return false;
    if (n.hunger < 0.2 || n.energy < 0.22 || n.hygiene < 0.18) return false;
    const h = this.hour(t);
    if (this.sleepTime(a, h) || this.onShift(a, P, h, this.day(t))) return false;
    if (r.slot) {
      const B = this.W.buildings[r.b];
      if (!B || B.gone || r.f >= B.floors) return false;
      const venue = this.W.levels[B.lv[r.f]]?.venue;
      return !venue || isOpen(venue, h);
    }
    return r.kind === 'jog' || r.kind === 'wander';
  }
  /** Goes back to the bookmarked activity until it was to end: the same seat or spot (walking back if it moved), the same
   *  pose and props; a jog or a stroll starts again. False when it can't (the seat was taken). */
  resumeActivity(a, P, h, day) {
    const r = a.resume; a.resume = null;
    if (r.slot) {
      const st = this.slotBegin(a, P, r.b, r.f, r.id, r.k, { use: r.use, ...(r.anim !== undefined ? { anim: r.anim } : {}), ...(r.prop !== undefined ? { prop: r.prop } : {}) });
      if (!st) return false;
      const hs = this.slotHold(a, P, st, Math.max(this.wm(3), r.until - P.t), { ...(r.anim !== undefined ? { anim: r.anim } : {}), ...(r.prop !== undefined ? { prop: r.prop } : {}) });
      this.act(a, r.kind, r.use, P, { ...this.slotInfo(st), ...hs, place: r.place, label: r.label, icon: r.icon });
      return true;
    }
    if (r.kind === 'jog') return this.jog(a, P);
    if (r.kind === 'wander') return r.b >= 0 && this.W.buildings[r.b] && !this.W.buildings[r.b].gone ? this.stroll(a, P, r.b, r.f) : this.wander(a, P);
    return false;
  }
  /** Whether the agent has just finished a task (woken by a message at night, it may go back to bed — or not). */
  justFinishedTask(a, t) {
    return !!(a.taskWay && !(a.p.vip && this.sim.presence.isWorking(a.p.agentId))) || (a.taskEnded !== undefined && t - a.taskEnded < this.wm(30));
  }
  /**
   * Carries out a Free Will choice (from server/free-will/: { type, option, venue }). true: done; 'skip': the rule needs
   * nothing more (the next one applies); false or 'routine': the rule's routine does it.
   */
  doChoice(a, P, h, day, pick) {
    const o = pick.option;
    switch (pick.type) {
      case 'task': return this.taskDo(a, P, h, day, o.way);
      case 'meal': return this.mealDo(a, P, h, day, o, pick.venue);
      case 'morning': {
        a.morningDay = day;
        a.queue = [...o.steps];
        while (a.queue.length) { const q = a.queue.shift(); if (this.task(a, P, q, h, day)) return true; }
        return 'skip';
      }
      case 'shift':
        a.shiftDay = day;
        return o.way === 'coffee' ? this.coffeeToGo(a, P, pick.venue) : 'routine';
      case 'rest': return o.way === 'nap' ? this.restNap(a, P) : this.restCoffee(a, P, pick.venue);
      case 'after_task':
        if (o.way === 'sleep') { this.sleep(a, P, h); return true; }
        return this.homeRelax(a, P, h);
      default: return false;
    }
  }
  /** The routine that would apply at the next decision, given needs n (predicted ones allowed), or null when the next
   *  decision is free time. Pure: no random draws, no change to the resident (Free Will asks ahead with it). */
  reflexAt(a, P, h, day, n) {
    for (const r of REFLEXES) if (r.when(this, a, P, h, day, n)) return r.id;
    return null;
  }
  sleepTime(a, h) { const s = a.p.sched; return inHours(h, s.bed % 24, s.wake); }
  /** A performer (SHOW_ROLES) during their set today. */
  onStage(a, h, day) {
    const j = a.p.job;
    return !!j && SHOW_ROLES.has(j.role) && a.doneDay !== day && !!((j.days ?? 31) & (1 << mod(day, 7))) && h >= j.start && h < j.end - 0.05;
  }
  onShift(a, P, h, day) {
    const j = a.p.job;
    if (!j || j.kind === 'free' || a.doneDay === day) return false;
    if (!((j.days ?? 31) & (1 << mod(day, 7)))) return false;
    if (h >= j.end - 0.05) return false;
    if (h >= j.start) return true;
    const dest = this.jobDest(a);
    const est = dest ? this.router.estimate(P.ctx, P.x, P.z, dest) : 0;
    // (a performer — the club's DJ, the lounge's band — goes in good time and gets ready there: nothing started an hour
    // or two before the set (the gym, a meal) makes the show start late: work)
    return h >= j.start - (est * this.clock.dayScale / 3600 + (SHOW_ROLES.has(j.role) ? SHOW_EARLY : 0.12));
  }
  jobDest(a) {
    const j = a.p.job;
    if (j.kind === 'remote') {
      const h = a.p.home; if (!h) return null;
      const B = this.W.buildings[h.b]; return { ctx: ctxOf(h.b, h.f), x: B.x, z: B.z, lx: 0, lz: 0 };
    }
    const B = this.W.buildings[j.b]; if (!B || B.gone) return null;
    const s = this.index.entry(j.b, j.f, j.id)?.slots[j.k];
    const ap = s ? this.nav.approach(B.lv[j.f], s) : null;
    const w = ap ? toWorld(B, ap.x, ap.z) : { x: B.x, z: B.z };
    return { ctx: ctxOf(j.b, j.f), x: w.x, z: w.z, lx: ap ? ap.x : 0, lz: ap ? ap.z : 0 };
  }
  mealDue(a, h, day, needs = a.needs) {
    const n = needs.hunger;
    if (h >= 11.5 && h < 14.5 && a.lunchDay !== day && n < 0.75) return true;
    if (h >= 18 && h < 21.5 && a.dinnerDay !== day && n < 0.8) return true;
    return n < 0.33;
  }

  // ------------------------------------------------------------------ work
  work(a, P, h, day, live) {
    const p = a.p, j = p.job;
    if (j.kind === 'remote') return this.remoteWork(a, P, h, day);
    const atWork = P.ctx >= 0 && ctxB(P.ctx) === j.b;
    if (!live && atWork) {
      if (j.kind !== 'staff' && a.lunchDay !== day && h >= p.sched.lunch && h < j.end - 0.6) {
        a.lunchDay = day;
        if (this.lunch(a, P, h, day)) return;
      }
      if (!SHOW_ROLES.has(j.role) && P.t - a.lastBreak > a.breakGap && h < j.end - 0.35 && h > j.start + 0.15) {   // (no breaks in the middle of a set)
        a.lastBreak = P.t;
        a.breakGap = this.wm(j.kind === 'staff' ? a.rng.float(110, 200) : a.rng.float(50, 130));
        if (this.workBreak(a, P, h)) return;
      }
    } else if (!atWork) {
      a.lastBreak = P.t; a.breakGap = this.wm(a.rng.float(40, 110));
    }
    const travel = {};
    if (!atWork && j.kind !== 'staff' && (hashStr(p.id) % 3 === 0)) travel.prop = PROP.briefcase;
    if (!atWork && !live && h > j.start + 0.2) { travel.speed = RUN_SPEED * 0.85; travel.anim = A.run; }
    // (a bartender, a DJ, a musician, a club dancer: what the piece they work at makes them, seen doing it — shared/nightlife.js)
    const role = j.kind === 'staff' ? roleAt(this.W, j.b, j.f, j.id, j.k) : null, wuse = role && ROLE_USE[role] ? ROLE_USE[role] : j.kind === 'staff' ? 'staff' : 'work';
    if (role && j.role !== role) { j.role = role; j.title = `${ROLE_TITLE[role]} at ${this.placeName(j.b, j.f)}`; }
    const st = this.slotBegin(a, P, j.b, j.f, j.id, j.k, { use: wuse, travel, noReserve: true });
    if (!st) { a.doneDay = day; return this.leisure(a, P, h, day); }
    // a performer there before the set: getting ready at the stage (a look at the phone, the set list) until it starts —
    // not playing yet (render: no music till then)
    const early = SHOW_ROLES.has(role) && !live ? this.hSecs(j.start - this.hour(P.t)) : 0;
    if (early > this.wm(1)) {
      const hs0 = this.slotHold(a, P, { ...st, use: U.staff ?? U.idle }, early, { anim: SEATED.has(st.anim) ? A.sit_phone : A.phone, prop: PROP.phone });
      this.act(a, 'work', 'staff', P, { ...this.slotInfo(st), ...hs0, place: this.placeName(j.b, j.f), label: 'Getting ready', icon: '🎧' });
    }
    const untilEnd = Math.max(this.wm(3), this.hSecs(j.end - this.hour(P.t)));
    let dur = live ? this.wm(15) : Math.min(untilEnd, this.wm(j.kind === 'staff' ? a.rng.float(60, 150) : a.rng.float(40, 110)));
    if (!live && untilEnd - dur < this.wm(12)) dur = untilEnd;
    const hs = this.slotHold(a, P, st, dur);
    this.act(a, 'work', wuse === 'work' ? 'work' : wuse, P, { ...this.slotInfo(st), ...hs, place: this.placeName(j.b, j.f) });
  }
  // ------------------------------------------------------------------ tasks (an AI agent working on what its owner asked)
  /**
   * The ways an agent can work on a task from where it is: { way: 'desk' | 'home' | 'laptop' | 'phone', b, f, place,
   * minutes } — its desk at work, the computer (or a table, with a laptop) at home, a laptop at a free table where it is
   * or at a café nearby, or its phone right where it stands. Pure (no random draws): Free Will offers these.
   */
  taskWays(a, P) {
    const out = [], p = a.p, j = p.job, here = P.ctx >= 0 ? ctxB(P.ctx) : -1, hf = ctxF(P.ctx);
    const mins = dest => Math.max(1, Math.round(this.router.estimate(P.ctx, P.x, P.z, dest) * this.clock.dayScale / 60));
    if (j && j.b !== undefined && j.kind !== 'free' && j.kind !== 'remote') {
      const d = this.jobDest(a);
      if (d) out.push({ way: 'desk', b: j.b, f: j.f, place: this.placeName(j.b, j.f), minutes: here === j.b ? 0 : mins(d) });
    }
    const hm = p.home, lv = this.homeLv(a), atHome = !!(hm && here === hm.b && hf === hm.f);
    if (hm && lv >= 0) {
      const ids = this.index.unitItems(lv, hm.u);
      if (this.index.findUses(lv, new Set(['computer', 'eat']), ids).some(e => !this.taken(hm.b, hm.f, e[0], e[1], a.i))) {
        const B = this.W.buildings[hm.b];
        out.push({ way: 'home', b: hm.b, f: hm.f, place: 'Home', minutes: atHome ? 0 : mins({ ctx: ctxOf(hm.b, hm.f), x: B.x, z: B.z }) });
      }
    }
    if (here >= 0 && !atHome && !(j && here === j.b) && this.freeSlots(here, hf, LAPTOP_SEATS, a.i).length) {
      out.push({ way: 'laptop', b: here, f: hf, place: this.placeName(here, hf), minutes: 0 });
    } else {
      let best = null, bd = 400;
      for (const v of this.index.venues.cafe || []) {
        const d = hyp(v.x, v.z, P.x, P.z);
        if (d < bd && this.freeSlots(v.b, v.f, LAPTOP_SEATS, a.i).length) { bd = d; best = v; }
      }
      if (best) out.push({ way: 'laptop', b: best.b, f: best.f, place: this.placeName(best.b, best.f), minutes: mins({ ctx: ctxOf(best.b, best.f), x: best.x, z: best.z }) });
    }
    out.push({ way: 'phone', place: here >= 0 ? this.placeName(here, hf) : '', minutes: 0 });
    return out;
  }
  /** Works on the task one way for a while (a quarter of a world hour; then it decides again). */
  taskDo(a, P, h, day, w) {
    const dur = this.wm(15), seat = { use: 'task', kind: 'work', anim: A.sit_type };
    let ok = false;
    switch (w && w.way) {
      case 'desk': {
        const j = a.p.job, st = this.slotBegin(a, P, j.b, j.f, j.id, j.k, { use: 'work', noReserve: true });
        if (st) { const hs = this.slotHold(a, P, st, dur); this.act(a, 'work', 'task', P, { ...this.slotInfo(st), ...hs, place: this.placeName(j.b, j.f) }); ok = true; }
        break;
      }
      case 'home': ok = !!(this.homeUse(a, P, ['computer'], dur, seat) || this.homeUse(a, P, ['eat'], dur, { ...seat, prop: PROP.laptop })); break;
      case 'laptop': {
        const B = this.W.buildings[w.b];
        ok = !!(B && !B.gone && w.f < B.floors && this.useAt(a, P, w.b, w.f, LAPTOP_SEATS, dur, { ...seat, prop: PROP.laptop, place: this.placeName(w.b, w.f) }));
        break;
      }
      case 'phone': {
        const hs = P.t;
        P.hold(this.wm(10), A.phone, U.task_phone, PROP.phone);
        this.act(a, 'work', 'task_phone', P, { holdStart: hs, holdEnd: P.t, place: w.place || '' });
        ok = true;
        break;
      }
      default: ok = false;
    }
    if (ok) a.taskWay = { way: w.way, b: w.b, f: w.f };
    return ok;
  }
  /**
   * The routine way to work on a task: carry on where it is working; otherwise its desk when it is at work, the
   * computer when it is at home, a laptop at a table where it is, its desk during working hours when it is close, a
   * laptop at a café nearby, else its phone.
   */
  taskWork(a, P, h, day) {
    const ways = this.taskWays(a, P), j = a.p.job;
    const pick = (way, f = () => true) => ways.find(w => w.way === way && f(w));
    const cur = a.taskWay && ways.find(w => w.way === a.taskWay.way && w.b === a.taskWay.b && w.f === a.taskWay.f);
    const inHoursNow = j && Number.isFinite(j.start) && h >= j.start - 0.5 && h < j.end;
    const order = [cur, pick('desk', w => w.minutes === 0), pick('home', w => w.minutes === 0), pick('laptop', w => w.minutes === 0),
      inHoursNow ? pick('desk', w => w.minutes <= 20) : null, pick('laptop', w => w.minutes <= 12), pick('phone')];
    for (const w of order) if (w && this.taskDo(a, P, h, day, w)) return true;
    return false;
  }
  remoteWork(a, P, h, day) {
    const j = a.p.job;
    const untilEnd = Math.max(this.wm(5), this.hSecs(j.end - h));
    const dur = Math.min(untilEnd, this.wm(a.rng.float(50, 120)));
    if (a.rng.chance(0.7) && this.homeUse(a, P, ['computer'], dur, { use: 'work', kind: 'work' })) return;
    const v = isOpen('cafe', h) ? this.pickVenue(a, P, 'cafe') : null;
    if (v && this.useAt(a, P, v.b, v.f, 'eat', Math.min(dur, this.wm(90)), { use: 'work', anim: A.sit_type, prop: PROP.coffee, kind: 'work', ...this.workCoffee(a, v, P.t) })) return;
    if (this.homeUse(a, P, ['computer', 'eat'], dur, { use: 'work', anim: A.sit_type, kind: 'work' })) return;
    a.doneDay = day;
    return this.leisure(a, P, h, day);
  }
  lunch(a, P, h, day) {
    const j = a.p.job;
    if (a.rng.chance(0.55) && this.eatInBuilding(a, P, j.b, j.f)) return true;
    return this.eatOut(a, P, h, a.rng.chance(0.5) && isOpen('restaurant', h) ? 'restaurant' : 'cafe', { maxDist: 280 });
  }
  eatInBuilding(a, P, b, f) {
    const B = this.W.buildings[b];
    const floors = [f, ...Array.from({ length: Math.min(B.floors, 12) }, (_, k) => k).filter(k => k !== f)];
    for (const ff of floors.slice(0, 4)) {
      if (!this.freeSlots(b, ff, 'eat', a.i).length) continue;
      if (a.rng.chance(0.6)) this.useAt(a, P, b, ff, ['fridge', 'snack', 'coffee'], [1, 3]);
      const pid = a.p.id, t = P.t;
      if (this.useAt(a, P, b, ff, 'eat', [20, 38], { kind: 'meal', use: 'eat', ...this.served(this.food ? deskLunch(tag => r01(pid, t, tag)) : []) })) return true;
    }
    return false;
  }
  workBreak(a, P, h) {
    const p = a.p, j = p.job, b = j.b, f = j.f;
    if (j.kind === 'staff') {
      return !!(this.useAt(a, P, b, f, ['water', 'snack', 'coffee'], [2, 5], { kind: 'break' }) || this.lookAround(a, P, this.wm(a.rng.float(2, 5)), 'phone'));
    }
    if (a.rng.chance(0.14) && this.meeting(a, P)) return true;
    if (a.rng.chance(0.12) && this.chat(a, P)) return true;
    const opts = [
      ['coffee', 3, [2, 5]], ['water', 2.2, [3, 7]], ['snack', 0.8, [1, 3]], ['fridge', 0.5, [1, 3]], ['print', 1.3, [1, 4]],
      ['file', 0.7, [2, 5]], ['relax', 0.9, [8, 15]], ['present', 0.35, [8, 15]], ['browse', 0.5, [3, 8]],
      ['pingpong', p.vip ? 2.2 : 0.7, [10, 20]], ['play', p.vip ? 1.6 : 0.5, [8, 15]], ['music', 0.4, [8, 20]], ['eat', 0.3, [8, 12]],
    ];
    for (let tries = 0; tries < 4 && opts.length; tries++) {
      const k = wpick(a.rng, opts), [use, , dur] = opts[k];
      opts.splice(k, 1);
      const o = { kind: 'break' };
      if (use === 'water') o.prop = PROP.cup;
      if (use === 'eat') { o.use = 'coffee'; o.prop = PROP.coffee; }
      if (use === 'browse') o.prop = PROP.book;
      const r = this.useAt(a, P, b, f, use, dur, o);
      if (r) { if (use === 'water' || use === 'coffee') this.join(a, this.regionKey(ctxOf(b, f), 0, 0)); return true; }
    }
    return false;
  }
  meeting(a, P) {
    const j = a.p.job, B = this.W.buildings[j.b], lv = B.lv[j.f];
    const now = this.sim.now();
    const byItem = new Map();
    for (const e of this.index.findUsesCached(lv, 'meeting')) {
      if (byItem.get(e[0]) === null) continue;
      if (this.taken(j.b, j.f, e[0], e[1], a.i)) { byItem.set(e[0], null); continue; }
      if (!byItem.has(e[0])) byItem.set(e[0], []);
      byItem.get(e[0]).push(e);
    }
    const items = [...byItem.values()].filter(v => v && v.length >= 3);
    if (!items.length) return false;
    const free = items[Math.floor(a.rng.next() * items.length)];
    const ctx = ctxOf(j.b, j.f);
    const pool = [];
    for (const i of this.at.get(ctx) || []) {
      const o = this.sim.agents[i];
      if (o === a || !o.act || o.act.kind !== 'work' || o.act.holdEnd - now < this.wm(25) || o.busyUntil > now) continue;
      if (o.p.vip && this.sim.presence.isWorking(o.p.agentId)) continue;
      pool.push(o);
    }
    if (!pool.length) return false;
    a.rng.shuffle(pool);
    const n = Math.min(free.length - 1, pool.length, a.rng.int(2, 5));
    const people = [a, ...pool.slice(0, n)], plans = [], sts = [];
    for (let q = 0; q < people.length; q++) {
      const o = people[q];
      const Pq = q === 0 ? P : this.cut(o, now + 0.2);
      const st = this.slotBegin(o, Pq, j.b, j.f, free[q][0], free[q][1], { use: 'meeting' });
      if (!st) {
        if (q === 0) return false;
        o.busyUntil = 0; this.sim.commit(o, Pq, true);
        continue;
      }
      plans.push([o, Pq, st]);
    }
    const start = Math.max(...plans.map(x => x[1].t));
    const end = start + this.wm(a.rng.float(25, 55));
    for (const [o, Pq, st] of plans) {
      const hs = this.slotHold(o, Pq, st, end - Pq.t);
      this.act(o, 'meeting', 'meeting', Pq, { ...this.slotInfo(st), ...hs, place: this.placeName(j.b, j.f) });
      o.busyUntil = end;
      if (o !== a) this.sim.commit(o, Pq);
    }
    return true;
  }

  // ------------------------------------------------------------------ meals / rest
  eat(a, P, h, day) {
    const home = a.p.home, dinner = h >= 17;
    if (dinner) a.dinnerDay = day; else if (h >= 11 && h < 15) a.lunchDay = day;
    const atHome = home && P.ctx === ctxOf(home.b, home.f);
    const r = a.rng.next();
    if (home && (atHome ? r < 0.8 : r < (dinner ? 0.5 : 0.3)) && this.homeMeal(a, P)) return true;
    const kind = dinner && isOpen('restaurant', h) && a.rng.chance(0.65) ? 'restaurant' : (isOpen('cafe', h) ? 'cafe' : 'restaurant');
    if (isOpen(kind, h) && this.eatOut(a, P, h, kind)) return true;
    return home ? this.homeMeal(a, P) : false;
  }
  pickVenue(a, P, kind, o = {}) {
    const list = this.index.venues[kind];
    if (!list || !list.length) return null;
    // the economy (when it is on): a resident who can't afford it doesn't go; dearer or worse-rated venues weigh as farther
    const econ = this.sim.econ;
    if (econ && !econ.canSpend(a, kind, !!o.essential)) return null;
    let best = null, bs = Infinity;
    for (const v of list) {
      if (o.exclude === v.b) continue;
      const d = hyp(v.x, v.z, P.x, P.z);
      if (o.maxDist && d > o.maxDist && best) continue;
      const s = d * (0.5 + a.rng.next()) * (econ ? econ.venueFactor(v.b, v.f) : 1);
      if (s < bs) { bs = s; best = v; }
    }
    return best;
  }
  eatOut(a, P, h, kind, o = {}) {
    o = { ...o, essential: true };   // a meal: affordable is enough (anything else keeps a few nights' rent in hand)
    for (let tries = 0; tries < 2; tries++) {
      const v = this.pickVenue(a, P, kind, o);
      if (!v || !this.freeSlots(v.b, v.f, 'eat', a.i).length) { o = { ...o, exclude: v?.b }; continue; }
      if (this.mealAt(a, P, kind, v)) return true;
    }
    return false;
  }
  /** A meal at venue v (a café or a restaurant) that has a free table. */
  mealAt(a, P, kind, v) {
    if (kind === 'cafe' && a.rng.chance(0.75)) this.useAt(a, P, v.b, v.f, 'order', [1, 2], { anim: A.talk });
    else if (kind === 'restaurant' && a.rng.chance(0.6)) this.useAt(a, P, v.b, v.f, 'reception', [0.5, 1.5], { anim: A.talk });
    const prop = kind === 'cafe' ? PROP.coffee : 0;
    return !!this.useAt(a, P, v.b, v.f, 'eat', kind === 'cafe' ? [18, 35] : [28, 50], { kind: 'meal', use: 'eat', prop, ...this.orderAt(a, v.b, v.f, 'meal', P.t) });
  }
  /** Free Will's meal: at home, at a named venue, or in the kitchen at work — with the routine's own bookkeeping. */
  mealDo(a, P, h, day, o, venue) {
    if (h >= 17) a.dinnerDay = day; else if (h >= 11 && h < 15) a.lunchDay = day;
    if (o.way === 'home') return this.homeMeal(a, P);
    if (o.way === 'office') return this.eatInBuilding(a, P, a.p.job.b, a.p.job.f);
    if (o.way === 'venue' && venue && this.freeSlots(venue.b, venue.f, 'eat', a.i).length) return this.mealAt(a, P, o.vkind, venue);
    return false;
  }
  rest(a, P, h) {
    const home = a.p.home, atHome = home && P.ctx >= 0 && ctxB(P.ctx) === home.b;
    if (home && (atHome || a.rng.chance(0.5)) && this.restNap(a, P)) return true;
    const v = isOpen('cafe', h) ? this.pickVenue(a, P, 'cafe') : null;
    return v ? this.restCoffee(a, P, v) : false;
  }
  /** A nap in its own bed. */
  restNap(a, P) {
    const home = a.p.home; if (!home) return false;
    const st = this.slotBegin(a, P, home.b, home.f, home.bed[0], home.bed[1], { use: 'nap' });
    if (!st) return false;
    const hs = this.slotHold(a, P, st, this.wm(a.rng.float(30, 70)));
    this.act(a, 'home', 'nap', P, { ...this.slotInfo(st), ...hs, place: 'Home' });
    return true;
  }
  /** A coffee at café v to wake up. */
  restCoffee(a, P, v) {
    if (!v) return false;
    this.useAt(a, P, v.b, v.f, 'order', [1, 2], { anim: A.talk }); a.carry = PROP.coffee; a.carryUntil = P.t + this.wm(30); a.needs.energy = Math.min(1, a.needs.energy + 0.2);
    return !!this.useAt(a, P, v.b, v.f, 'eat', [10, 20], { use: 'coffee', prop: PROP.coffee, ...this.orderAt(a, v.b, v.f, 'coffee', P.t) }) || true;
  }
  /** A coffee to go at café v on the way to work. */
  coffeeToGo(a, P, v) {
    if (!v || !this.useAt(a, P, v.b, v.f, 'order', [1, 2], { anim: A.talk, ...(this.food ? { order: ['coffee_to_go'] } : {}) })) return false;
    a.carry = PROP.coffee; a.carryUntil = P.t + this.wm(40);
    return true;
  }

  // ------------------------------------------------------------------ sleep
  sleep(a, P, h) {
    const home = a.p.home;
    const wake = a.p.sched.wake + (a.rng.next() - 0.5) * 0.4;
    if (home) {
      const st = this.slotBegin(a, P, home.b, home.f, home.bed[0], home.bed[1], { use: 'sleep' });
      if (st) {
        let hrs = this.hoursUntil(P.t, wake);
        if (hrs > 15) hrs = 0.25;
        const hs = this.slotHold(a, P, st, this.hSecs(hrs));
        this.act(a, 'sleep', 'sleep', P, { ...this.slotInfo(st), ...hs, place: 'Home' });
        this.queueMorning(a);
        return;
      }
    }
    return this.sleepAway(a, P, wake);
  }
  /** No home: take the subway out of town for the night; re-emerge at a random station in the morning. */
  sleepAway(a, P, wake, warm = false) {
    const st = this.W.stations;
    if (!st.length) return this.lookAround(a, P, this.wm(60));
    if (warm) {
      const sb = this.nav.stAcc[Math.floor(a.rng.next() * this.nav.stAcc.length)];
      let hrs = this.hoursUntil(P.t, wake); if (hrs > 15) hrs = 0.3;
      const ib = stationInside(sb.st), y = stationY(sb.st);
      P.place(ib.x, y, ib.z, CTX_UNDER);
      const hs = P.t;
      P.seg(this.hSecs(hrs), ib.x, y, ib.z, 0, A.idle, U.sleep, 0, F_HIDDEN, CTX_UNDER);
      this.act(a, 'sleep', 'sleep', P, { holdStart: hs, holdEnd: P.t, place: 'Out of town', ctx: CTX_UNDER });
      P.move(sb.x, y, sb.z, a.p.speed, A.walk, U.walk, { ctx: CTX_OUT });
      this.queueMorning(a);
      return;
    }
    const from = P.ctx >= 0 ? null : this.nav.accessAt(P.x, P.z);
    let sa;
    if (from) sa = this.nav.nearestStation(from)?.s;
    else {
      const B = this.W.buildings[ctxB(P.ctx)];
      sa = this.nav.nearestStation(this.nav.pickAccess(B.idx, B.x, B.z))?.s;
    }
    if (!sa) return this.lookAround(a, P, this.wm(60));
    this.router.travel(P, { ctx: CTX_OUT, x: sa.x, z: sa.z }, this.topt(a, {}, P.t));
    const sb = this.nav.stAcc[Math.floor(a.rng.next() * this.nav.stAcc.length)];
    let hrs = this.hoursUntil(P.t, wake); if (hrs > 15) hrs = 0.3;
    const ia = stationInside(sa.st), ib = stationInside(sb.st);
    P.move(ia.x, stationY(sa.st), ia.z, a.p.speed, A.walk, U.commute, { ctx: CTX_OUT });
    const hs = P.t;
    P.seg(this.hSecs(hrs), ib.x, stationY(sb.st), ib.z, P.yaw, A.idle, U.sleep, 0, F_HIDDEN, CTX_UNDER);
    this.act(a, 'sleep', 'sleep', P, { holdStart: hs, holdEnd: P.t, place: 'Out of town', ctx: CTX_UNDER });
    P.move(sb.x, stationY(sb.st), sb.z, a.p.speed, A.walk, U.walk, { ctx: CTX_OUT });
    this.queueMorning(a);
  }
  queueMorning(a) {
    a.queue.length = 0;
    if (!a.p.home) { if (a.rng.chance(0.6)) a.queue.push('breakfast_out'); return; }
    if (a.rng.chance(0.65)) a.queue.push('shower');
    if (a.rng.chance(0.45)) a.queue.push('dress');
    if (a.rng.chance(0.75)) a.queue.push('breakfast');
  }
  task(a, P, q, h, day) {
    switch (q) {
      case 'shower': return a.needs.hygiene < 0.85 && !!this.homeUse(a, P, ['shower'], [6, 12]);
      case 'dress': return !!this.homeUse(a, P, ['dress'], [2, 5]);
      case 'breakfast':
        if (a.needs.hunger > 0.85) return false;
        if (a.p.job.kind === 'office' && a.rng.chance(0.3)) return false;
        { const k = this.homeKitchen(a);
          if (!k) return false;
          this.homeUse(a, P, ['fridge'], [1, 2]);
          return this.eatAtHome(a, P, k, { kind: 'meal', use: 'eat', prop: PROP.cup, ...this.homeFood(a, P.t, k) }, [10, 20], [8, 14]); }
      case 'breakfast_out': return isOpen('cafe', h) && this.eatOut(a, P, h, 'cafe');
      default: return false;
    }
  }

  // ------------------------------------------------------------------ leisure
  /** What a resident may do with free time at hour h, with the routine's weight for each: [[kind, weight > 0], …]. Pure
   *  (no random draws); n may be predicted needs. The routine draws from it; Free Will offers the same choices. */
  leisureOptions(a, h, day, n = a.needs) {
    const p = a.p, weekend = mod(day, 7) >= 5;
    const late = h >= 21.25 || h < 6.5;
    const lowFun = 1 - n.fun, lowSoc = 1 - n.social;
    const opts = [];
    const has = k => (this.index.venues[k] || []).length > 0;   // (nights out: only where the city has one)
    if (late) {
      if (p.tr.night && isOpen('restaurant', h)) opts.push(['bar', 1.2]);
      opts.push(['home', p.home ? 6 : 0], ['wander', p.home ? 0.3 : 2]);
      if (isOpen('club', h) && h < 23.2 && has('club')) opts.push(['club', (p.tr.night ? 2.2 : 0.5) + (weekend ? 1.4 : 0) + lowFun * 0.8 + lowSoc * 0.5]);
      if (isOpen('lounge_bar', h) && h < 23 && has('lounge_bar')) opts.push(['lounge_bar', 0.5 + lowSoc * 0.9 + (p.tr.night ? 0.6 : 0)]);
      if (isOpen('arcade', h) && h < 22.75 && has('arcade')) opts.push(['arcade', 0.25 + lowFun * 0.5]);
    } else {
      opts.push(['home', p.home ? 0.6 + p.tr.home * 1.4 + (h >= 19.5 ? 3 : 0) : 0]);
      if (isOpen('cafe', h)) opts.push(['cafe', 0.8 + lowSoc * 2 + (weekend ? 0.6 : 0)]);
      if (isOpen('park', h) && h >= 7 && h < 20.5) opts.push(['park', 1 + lowFun * 1.6 + p.tr.act * 0.6 + (weekend ? 0.8 : 0)]);
      if (isOpen('shop', h)) opts.push(['shop', 0.6 + lowFun * 0.9 + (weekend ? 1 : 0)]);
      if (isOpen('gym', h) && n.energy > 0.4) opts.push(['gym', p.tr.act * 1.8]);
      if (n.energy > 0.45 && ((h >= 6 && h < 9.5) || (h >= 17 && h < 20.5))) opts.push(['jog', p.tr.act * 1.6]);
      opts.push(['wander', 0.9]);
      if (h >= 18 && isOpen('restaurant', h)) opts.push(['bar', 0.4 + lowSoc]);
      if (this.loungeFor(a)) opts.push(['lounge', 1.6]);
      if (isOpen('arcade', h) && h < 22.75 && has('arcade')) opts.push(['arcade', 0.2 + lowFun * 0.9 + (weekend ? 0.5 : 0) + p.tr.act * 0.15]);
      if (isOpen('lounge_bar', h) && h >= 16.5 && h < 23 && has('lounge_bar')) opts.push(['lounge_bar', 0.35 + lowSoc * 1.3 + (h >= 18.5 ? 0.6 : 0) + (weekend ? 0.3 : 0)]);
      if (isOpen('club', h) && h < 23 && has('club')) opts.push(['club', 0.3 + lowFun * 0.9 + lowSoc * 0.6 + (weekend ? 1 : 0) + p.tr.night * 1.2]);
      opts.push(['chat', lowSoc * 2.5]);
      if (this.invitation(a)) opts.push(['visit', 3 + lowSoc * 3]);   // invited to someone's flat (server/world/edit.js flat.invite)
    }
    return opts.filter(o => o[1] > 0);
  }
  leisure(a, P, h, day) {
    const live = this.leisureOptions(a, h, day);
    // Free Will (server/free-will/): the agent's own choice when its decision arrived in time and is still possible; when it
    // cannot be carried out, the routine below chooses from the rest
    const fw = this.sim.freeWill;
    if (fw && fw.isActive(a.i)) {
      const pick = fw.take(a, P, h, day, 'leisure', live);
      if (pick) {
        const ok = this.doLeisure(a, P, pick.kind, h, pick.venue);
        fw.done(a, pick, ok);
        if (ok) return;
        const k = live.findIndex(o => o[0] === pick.kind);
        if (k >= 0) live.splice(k, 1);
      }
    }
    for (let tries = 0; tries < 4 && live.length; tries++) {
      const k = wpick(a.rng, live), name = live[k][0];
      live.splice(k, 1);
      if (this.doLeisure(a, P, name, h)) return;
    }
    this.lookAround(a, P, this.wm(a.rng.float(5, 15)));
  }
  /** A flat this resident is invited to now: { b, f, u } (the world doc flats' visitors), or null. */
  invitation(a) {
    const now = Date.now();
    for (const [key, r] of Object.entries(this.W.flats || {})) {
      if (!(r.visitors || []).some(v => v.kind === 'person' && v.id === a.i && v.until > now)) continue;
      const [b, f, u] = key.split(':').map(Number), B = this.W.buildings[b];
      if (B && !B.gone && f < B.floors && this.W.levels[B.lv[f]]?.units?.[u]) return { b, f, u };
    }
    return null;
  }
  /** Goes over to the flat it is invited to and spends a while there: on the sofa, at the table. */
  visitFlat(a, P) {
    const v = this.invitation(a); if (!v) return false;
    const B = this.W.buildings[v.b], lv = B.lv[v.f], ids = this.index.unitItems(lv, v.u);
    const list = this.index.findUses(lv, new Set(['relax', 'eat']), ids).filter(e => !this.taken(v.b, v.f, e[0], e[1], a.i));
    if (!list.length) return false;
    return !!this.useAt(a, P, v.b, v.f, ['relax', 'eat'], [30, 60], { place: `Visiting a flat in ${B.name}`, kind: 'visit', use: 'chat', pick: () => list[Math.floor(a.rng.next() * list.length)] });
  }
  /** Does one kind of free-time activity. venue (an index.venues entry) is a place already chosen (Free Will); without
   *  it the resident picks one as usual. */
  doLeisure(a, P, name, h, venue = null) {
    switch (name) {
      case 'visit': return this.visitFlat(a, P);
      case 'home': return this.homeRelax(a, P, h);
      case 'cafe': return this.cafeVisit(a, P, h, venue);
      case 'park': return this.parkVisit(a, P, h, venue);
      case 'shop': return this.shopVisit(a, P, venue);
      case 'gym': return this.gymVisit(a, P, venue);
      case 'jog': return this.jog(a, P);
      case 'wander': return this.wander(a, P);
      case 'bar': return this.barVisit(a, P, h, venue);
      case 'lounge': return this.loungeVisit(a, P);
      case 'arcade': return this.arcadeVisit(a, P, h, venue);
      case 'lounge_bar': return this.loungeBarVisit(a, P, h, venue);
      case 'club': return this.clubVisit(a, P, h, venue);
      case 'chat': return this.chat(a, P);
      default: return false;
    }
  }
  cafeVisit(a, P, h, venue = null) {
    const v = venue || this.pickVenue(a, P, 'cafe'); if (!v) return false;
    if (a.rng.chance(0.8)) this.useAt(a, P, v.b, v.f, 'order', [1, 2], { anim: A.talk });
    const anim = a.p.tr.phone && a.rng.chance(0.35) ? A.sit_phone : A.sit_eat;
    if (this.useAt(a, P, v.b, v.f, 'eat', [20, 45], { use: 'cafe', prop: anim === A.sit_phone ? PROP.phone : PROP.coffee, anim, ...this.orderAt(a, v.b, v.f, 'cafe', P.t) })) return true;
    if (this.useAt(a, P, v.b, v.f, 'relax', [15, 30], { use: 'cafe', prop: PROP.coffee, ...this.orderAt(a, v.b, v.f, 'coffee', P.t) })) return true;
    a.carry = PROP.coffee; a.carryUntil = P.t + this.wm(25);
    return this.wander(a, P);
  }
  parkVisit(a, P, h, venue = null) {
    const v = venue || this.pickVenue(a, P, 'park'); if (!v) return false;
    const r = a.rng.next();
    if (r < 0.4) {
      const prop = a.rng.chance(0.25) ? PROP.book : a.p.tr.phone && a.rng.chance(0.3) ? PROP.phone : 0;
      if (this.useAt(a, P, v.b, v.f, 'bench', [15, 45], { prop, use: prop === PROP.book ? 'read' : 'bench', anim: prop === PROP.phone ? A.sit_phone : undefined })) return true;
    } else if (r < 0.55) {
      const pid = a.p.id, t = P.t;
      if (this.useAt(a, P, v.b, v.f, 'eat', [20, 40], { use: 'picnic', ...this.served(this.food ? picnicFood(tag => r01(pid, t, tag)) : []) })) return true;
    } else if (r < 0.66 && h >= 16) {
      if (this.useAt(a, P, v.b, v.f, 'dance', [10, 25])) return true;
    }
    return this.stroll(a, P, v.b, v.f);
  }
  stroll(a, P, b, f) {
    const B = this.W.buildings[b], lv = B.lv[f], g = this.nav.grid(lv), R = this.nav.reach(lv);
    if (!R.cells.length) return false;
    const ctx = ctxOf(b, f);
    const holdStart0 = [];
    const stops = a.rng.int(2, 4);
    for (let s = 0; s < stops; s++) {
      const c = R.cells[Math.floor(a.rng.next() * R.cells.length)], p = cellCenter(g, c);
      const w = toWorld(B, p.x, p.z);
      this.router.travel(P, { ctx, x: w.x, z: w.z, lx: p.x, lz: p.z }, this.topt(a, { use: U.wander, speed: a.p.speed * 0.85 }, P.t));
      holdStart0.push(P.t);
      const phone = a.p.tr.phone && a.rng.chance(0.3);
      P.hold(this.wm(a.rng.float(1.5, 5)), phone ? A.phone : A.idle, phone ? U.phone : U.wander, phone ? PROP.phone : 0);
    }
    this.act(a, 'wander', 'wander', P, { ctx, b, f, place: B.name, holdStart: holdStart0[0], holdEnd: P.t, arrive: holdStart0[0] });
    this.join(a, this.regionKey(ctx, 0, 0));
    return true;
  }
  shopVisit(a, P, venue = null) {
    const v = venue || this.pickVenue(a, P, 'shop'); if (!v) return false;
    let ok = null;
    const n = a.rng.int(1, 3);
    for (let q = 0; q < n; q++) { const r = this.useAt(a, P, v.b, v.f, 'browse', [4, 12], { kind: 'shop' }); if (!r) break; ok = r; }
    if (!ok) return false;
    const start = ok.hs.holdStart;
    if (a.rng.chance(0.75) && this.useAt(a, P, v.b, v.f, 'buy', [1, 3], { kind: 'shop' })) { a.carry = PROP.bag; a.carryUntil = P.t + this.wm(90); }
    if (a.act) a.act.holdStart = Math.min(a.act.holdStart, start);
    return true;
  }
  gymVisit(a, P, venue = null) {
    const v = venue || this.pickVenue(a, P, 'gym'); if (!v) return false;
    if (a.rng.chance(0.6)) this.useAt(a, P, v.b, v.f, 'locker', [1, 3]);
    const uses = a.rng.chance(0.5) ? ['run'] : a.rng.chance(0.5) ? ['lift'] : ['yoga'];
    if (this.useAt(a, P, v.b, v.f, uses, [20, 45], { kind: 'gym' }) || this.useAt(a, P, v.b, v.f, ['run', 'lift', 'yoga'], [20, 40], { kind: 'gym' })) return true;
    return false;
  }
  barVisit(a, P, h, venue = null) {
    const v = venue || this.pickVenue(a, P, 'restaurant'); if (!v) return false;
    const B = this.W.buildings[v.b], L = this.W.levels[B.lv[v.f]];
    const bar = L.items.find(it => it.t === 'bar_counter');
    const pick = bar ? (list) => list.find(e => e[0] === bar.id) || list[0] : undefined;
    return !!this.useAt(a, P, v.b, v.f, 'eat', [25, 60], { use: 'bar', anim: bar ? undefined : A.sit_talk, pick, kind: 'bar', ...this.orderAt(a, v.b, v.f, 'bar', P.t) });
  }
  loungeFor(a) {
    const j = a.p.job;
    if (!j || (j.kind !== 'vip' && j.kind !== 'office')) return null;
    const B = this.W.buildings[j.b];
    if (!B || B.type !== 'hq') return null;
    return (this.index.venues.lounge || []).find(v => v.b === j.b) || null;
  }
  /** Whether the lounge at work has a free spot for any of its activities (pure: Free Will offers it only then). */
  loungeHasRoom(a) {
    const v = this.loungeFor(a);
    return !!v && this.freeSlots(v.b, v.f, LOUNGE_USES, a.i).length > 0;
  }
  loungeVisit(a, P) {
    const v = this.loungeFor(a); if (!v) return false;
    const opts = LOUNGE_OPTS.map(o => [...o]);
    for (let t = 0; t < 3; t++) {
      const k = wpick(a.rng, opts), use = opts[k][0]; opts.splice(k, 1);
      const o = { kind: 'lounge' };
      if (use === 'eat') { o.use = 'bar'; if (this.food) { const pid = a.p.id, t = P.t; Object.assign(o, this.served(pickOrder(LOUNGE_DRINKS, 'bar', this.hour(t), tag => r01(pid, t, tag)))); } }
      if (this.useAt(a, P, v.b, v.f, use, [15, 40], o)) return true;
    }
    return false;
  }
  // ------------------------------------------------------------------ nights out (shared/nightlife.js)
  /** A drink from a place's list (deterministic per resident and time: what they order draws no simulation number). */
  drinkAt(a, t, kind, tag) { const list = DRINKS[kind] || []; return this.food && list.length ? this.served([list[Math.floor(r01(a.p.id, t, tag) * list.length) % list.length]]) : {}; }
  /** An arcade: tokens at the prize counter, then a few games (cabinets, pinball, the bull, billiards, air hockey, the
   *  dance machine …), maybe a soda in a booth. */
  arcadeVisit(a, P, h, venue = null) {
    const v = venue || this.pickVenue(a, P, 'arcade'); if (!v) return false;
    let first = a.rng.chance(0.7) ? this.useAt(a, P, v.b, v.f, 'reception', [1, 2], { anim: A.talk, use: 'buy', kind: 'arcade' }) : null;
    const n = a.rng.int(2, 4);
    for (let q = 0; q < n; q++) {
      const r = this.useAt(a, P, v.b, v.f, a.rng.chance(0.15) ? ['dance', 'play', 'pingpong'] : ['play', 'pingpong'], [6, 18], { kind: 'arcade' });
      if (r && !first) first = r;
    }
    if (!first) return false;
    if (a.rng.chance(0.3)) this.useAt(a, P, v.b, v.f, ['eat', 'relax'], [8, 15], { kind: 'arcade', use: 'bar', ...this.drinkAt(a, P.t, 'arcade', 's') });
    return true;
  }
  /** A lounge: a cocktail at the bar or with company in the seats while the band plays, perhaps another round. */
  loungeBarVisit(a, P, h, venue = null) {
    const v = venue || this.pickVenue(a, P, 'lounge_bar'); if (!v) return false;
    const atBar = a.rng.chance(0.4);
    const first = this.useAt(a, P, v.b, v.f, atBar ? ['eat'] : ['relax', 'eat', 'chat'], [25, 55], { kind: 'lounge_bar', use: 'bar', ...this.drinkAt(a, P.t, 'lounge_bar', 'a') });
    if (!first) return false;
    if (a.rng.chance(0.4)) this.useAt(a, P, v.b, v.f, ['relax', 'chat', 'eat'], [15, 35], { kind: 'lounge_bar', use: 'bar', ...this.drinkAt(a, P.t, 'lounge_bar', 'b') });
    return true;
  }
  /** A club: the cover at the door, a drink at the bar, the dance floor; a VIP booth for those who can afford a table. */
  clubVisit(a, P, h, venue = null) {
    const v = venue || this.pickVenue(a, P, 'club'); if (!v) return false;
    const econ = this.sim.econ, rich = !econ || (econ.available?.(a.p) ?? 0) > 60000;
    let first = null;
    if (a.rng.chance(0.55)) first = this.useAt(a, P, v.b, v.f, 'eat', [10, 20], { kind: 'club', use: 'bar', pick: list => { const bar = list.filter(e => this.itemType(v.b, v.f, e[0]) === 'club_bar'); return bar.length ? this.pickNear(a, bar, P.x, P.z, this.W.buildings[v.b]) : list[0]; }, ...this.drinkAt(a, P.t, 'club', 'a') });   // (a free stool near them, not the bar's first)
    const n = a.rng.int(1, 3);
    for (let q = 0; q < n; q++) { const r = this.useAt(a, P, v.b, v.f, 'dance', [12, 30], { kind: 'club' }); if (r && !first) first = r; }
    if (rich && a.rng.chance(0.35)) {
      const r = this.useAt(a, P, v.b, v.f, 'eat', [25, 50], { kind: 'club', use: 'vip', pick: list => list.find(e => this.itemType(v.b, v.f, e[0]) === 'vip_booth') || null, ...this.drinkAt(a, P.t, 'club', 'v') });
      if (r && !first) first = r;
    }
    return !!first;
  }
  /** The type of item id on floor f of building b (or null). */
  itemType(b, f, id) { return this.index.entry(b, f, id)?.it?.t ?? this.W.levels[this.W.buildings[b]?.lv?.[f]]?.items?.find(i => i.id === id)?.t ?? null; }
  jog(a, P) {
    if (P.ctx >= 0) {
      const B = this.W.buildings[ctxB(P.ctx)];
      const acc = this.nav.pickAccess(B.idx, B.x, B.z);
      this.router.travel(P, { ctx: CTX_OUT, x: acc.x, z: acc.z }, this.topt(a, {}, P.t));
    }
    const A0 = this.nav.accessAt(P.x, P.z), g = this.nav.g;
    if (A0.walk) return this.jogTrail(a, P, A0);
    P.move(A0.bx, GROUND_Y, A0.bz, a.p.speed, A.walk, U.walk, { ctx: CTX_OUT });
    const corners = [0, 1, 2, 3].map(c => cornerPoint(g, A0.i, A0.j, c));
    let start = 0, bd = Infinity;
    corners.forEach((c, k) => { const d = hyp(c.x, c.z, P.x, P.z); if (d < bd) { bd = d; start = k; } });
    const dir = a.rng.chance(0.5) ? 1 : 3;
    const speed = JOG_SPEED * a.rng.float(0.9, 1.12);
    const hs = P.t;
    const loops = a.rng.int(1, 3);
    for (let l = 0; l < loops; l++) for (let s = 0; s <= 4; s++) {
      const c = corners[(start + s * dir) % 4];
      P.move(c.x, GROUND_Y, c.z, speed, A.jog, U.jog, { ctx: CTX_OUT });
    }
    P.move(A0.bx, GROUND_Y, A0.bz, speed, A.jog, U.jog, { ctx: CTX_OUT });
    const he = P.t;
    P.hold(this.wm(a.rng.float(1, 3)), A.idle, U.jog);
    this.act(a, 'jog', 'jog', P, { ctx: CTX_OUT, place: this.nav.addressAt(P.x, P.z), holdStart: hs, holdEnd: he, arrive: hs });
    return true;
  }
  /** Beyond the city: a jog out along the footpath beside the road and back. */
  jogTrail(a, P, A0) {
    const W = this.nav.walk();
    if (!W || A0.node < 0) return false;
    for (const q of this.nav.spurPts(P.x, P.z, A0.node).slice(1)) P.move(q.x, q.y, q.z, a.p.speed, A.walk, U.walk, { ctx: CTX_OUT });
    const speed = JOG_SPEED * a.rng.float(0.9, 1.12), hs = P.t;
    for (const n of W.trail(A0.node, a.rng.float(300, 1100), a.rng).slice(1)) P.move(W.X[n], W.Y[n], W.Z[n], speed, A.jog, U.jog, { ctx: CTX_OUT });
    const he = P.t;
    P.hold(this.wm(a.rng.float(1, 3)), A.idle, U.jog);
    this.act(a, 'jog', 'jog', P, { ctx: CTX_OUT, place: this.nav.addressAt(P.x, P.z), holdStart: hs, holdEnd: he, arrive: hs });
    return true;
  }
  wander(a, P) {
    const g = this.nav.g;
    let x = P.x, z = P.z;
    if (P.ctx >= 0) { const B = this.W.buildings[ctxB(P.ctx)]; x = B.x; z = B.z; }
    const W = this.nav.beyond(x, z) ? this.nav.walk() : null;
    if (W) {   // beyond the city: somewhere along the roads nearby
      const n = W.nearestNode(x + a.rng.float(-120, 120), z + a.rng.float(-120, 120), 250);
      if (n >= 0) {
        this.router.travel(P, { ctx: CTX_OUT, x: W.X[n], z: W.Z[n] }, this.topt(a, { use: U.wander }, P.t));
        return this.lookAround(a, P, this.wm(a.rng.float(2, 6)), a.p.tr.phone && a.rng.chance(0.4) ? 'phone' : 'wander');
      }
    }
    if (g.empty) {   // no city: anywhere along the footpaths, or out of town without them
      const s = this.outdoorSpot(a);
      if (!s) return this.outOfTown(a, P);
      this.router.travel(P, { ctx: CTX_OUT, x: s.x, z: s.z }, this.topt(a, { use: U.wander }, P.t));
      return this.lookAround(a, P, this.wm(a.rng.float(2, 6)), a.p.tr.phone && a.rng.chance(0.4) ? 'phone' : 'wander');
    }
    const i = clamp(Math.floor((x - g.X[0]) / g.px) + a.rng.int(-2, 2), 0, g.nx - 1);
    const j = clamp(Math.floor((z - g.Z[0]) / g.pz) + a.rng.int(-2, 2), 0, g.nz - 1);
    const side = a.rng.int(0, 3), [c0, c1] = SIDE_CORNERS[side];
    const p0 = cornerPoint(g, i, j, c0), p1 = cornerPoint(g, i, j, c1), u = a.rng.float(0.15, 0.85);
    const dx = p0.x + (p1.x - p0.x) * u, dz = p0.z + (p1.z - p0.z) * u;
    this.router.travel(P, { ctx: CTX_OUT, x: dx, z: dz }, this.topt(a, { use: U.wander }, P.t));
    return this.lookAround(a, P, this.wm(a.rng.float(2, 6)), a.p.tr.phone && a.rng.chance(0.4) ? 'phone' : 'wander');
  }
  /** Whether a resident has nowhere to be: no home, in a world without a city whose island has no footpaths yet (a clean
   *  island before its first roads). */
  nowhere(a) { return !a.p.home && this.nav.g.empty && !this.nav.walk(); }
  /** Somewhere outdoors to stand: a corner of the city's blocks, or (no city) a point of the footpaths; null without either. */
  outdoorSpot(a) {
    const g = this.nav.g;
    if (!g.empty) {
      const i = Math.floor(a.rng.next() * g.nx), j = Math.floor(a.rng.next() * g.nz), side = a.rng.int(0, 3);
      const [c0, c1] = SIDE_CORNERS[side], p0 = cornerPoint(g, i, j, c0), p1 = cornerPoint(g, i, j, c1), u = a.rng.float(0.1, 0.9);
      return { x: p0.x + (p1.x - p0.x) * u, y: GROUND_Y, z: p0.z + (p1.z - p0.z) * u };
    }
    const W = this.nav.walk();
    if (!W || !W.X.length) return null;
    const n = Math.floor(a.rng.next() * W.X.length);
    return { x: W.X[n], y: W.Y[n], z: W.Z[n] };
  }
  /** Nowhere to be (nowhere()): out of town, unseen, for an hour or two; then it looks again. */
  outOfTown(a, P) {
    P.place(0, GROUND_Y, 0, CTX_UNDER);
    const hs = P.t;
    P.seg(this.wm(a.rng.float(60, 180)), 0, GROUND_Y, 0, 0, A.idle, U.idle, 0, F_HIDDEN, CTX_UNDER);
    this.act(a, 'idle', 'idle', P, { holdStart: hs, holdEnd: P.t, place: 'Out of town', ctx: CTX_UNDER });
    a.away = true;
    return true;
  }
  lookAround(a, P, dur, use = 'idle') {
    const hs = P.t;
    const phone = use === 'phone';
    P.hold(dur, phone ? A.phone : A.idle, U[use] ?? U.idle, phone ? PROP.phone : 0);
    this.act(a, 'idle', use, P, { ctx: P.ctx, place: P.ctx >= 0 ? this.placeName(ctxB(P.ctx), ctxF(P.ctx)) : this.nav.addressAt(P.x, P.z), holdStart: hs, holdEnd: P.t, arrive: hs });
    if (P.ctx !== CTX_UNDER) this.join(a, this.regionKey(P.ctx, P.x, P.z));
    return true;
  }

  // ------------------------------------------------------------------ social
  /** Walk up to a nearby idle person and chat with them. */
  /** Whether someone to chat with is around (ctx, x, z) right now — the same first checks as chat(), without moving
   *  anyone (pure: Free Will offers a chat only then). */
  chatPartnerNear(a, ctx, x, z) {
    const set = this.joinable.get(this.regionKey(ctx, x, z));
    if (!set || !set.size) return false;
    const now = this.sim.now();
    for (const i of set) {
      const o = this.sim.agents[i];
      if (o === a || !o.act || o.act.holdEnd - now < this.wm(4) || o.busyUntil > now) continue;
      const e = evalPlan(o.plan, safeCutTime(o.plan, now + 0.3));
      if (e.ctx === ctx && hyp(e.x, e.z, x, z) <= 22) return true;
    }
    return false;
  }
  chat(a, P) {
    const key = this.regionKey(P.ctx, P.x, P.z);
    const set = this.joinable.get(key);
    if (!set || !set.size) return false;
    const now = this.sim.now();
    const g = this.nav.g, myBlock = P.ctx < 0 ? blockAt(g, P.x, P.z) : null;
    for (const i of set) {
      const o = this.sim.agents[i];
      if (o === a || !o.act || o.act.holdEnd - now < this.wm(4) || o.busyUntil > now) continue;
      const tc = safeCutTime(o.plan, now + 0.3);
      const e = evalPlan(o.plan, tc);
      if (e.ctx !== P.ctx || hyp(e.x, e.z, P.x, P.z) > 22) continue;
      let mx = P.x - e.x, mz = P.z - e.z; const L = Math.hypot(mx, mz) || 1;
      mx = e.x + (mx / L) * 1.05; mz = e.z + (mz / L) * 1.05;
      let dest;
      if (P.ctx >= 0) {
        const B = this.W.buildings[ctxB(P.ctx)], lv = B.lv[ctxF(P.ctx)];
        const l = { x: (mx - B.x), z: (mz - B.z) };
        const r = bRot(B), c = Math.cos(r), s = Math.sin(r);
        const lx = l.x * c - l.z * s, lz = l.x * s + l.z * c;
        const R = this.nav.reach(lv), gg = this.nav.grid(lv);
        const ci = Math.floor((lx - gg.x0) / gg.cell), cj = Math.floor((lz - gg.z0) / gg.cell);
        if (ci < 0 || cj < 0 || ci >= gg.gw || cj >= gg.gh || !R.mask[cj * gg.gw + ci]) continue;
        dest = { ctx: P.ctx, x: mx, z: mz, lx, lz };
      } else if (myBlock) {
        const bo = blockAt(g, e.x, e.z), bm = blockAt(g, mx, mz);
        if (!bo || !bm || bo.bi !== myBlock.bi || bm.bi !== bo.bi) continue;
        dest = { ctx: CTX_OUT, x: mx, z: mz };
      } else {
        // beyond the city (WP4.5): both out on the island, meeting on dry ground (the walk over keeps to the footpaths)
        const nav = this.nav;
        if (!nav.beyond(P.x, P.z) || !nav.beyond(e.x, e.z) || !nav.beyond(mx, mz) || !nav.walk() || nav._walk.island.waterAt(mx, mz)) continue;
        dest = { ctx: CTX_OUT, x: mx, z: mz };
      }
      // commit: partner waits, we walk over, both talk
      const Pb = this.cut(o, now + 0.3);
      this.router.travel(P, dest, this.topt(a, {}, P.t));
      const arrive = Math.max(P.t, Pb.t + 0.5);
      const dur = this.wm(a.rng.float(3, 9));
      const yawA = Math.atan2(Pb.x - P.x, Pb.z - P.z), yawB = Math.atan2(P.x - Pb.x, P.z - Pb.z);
      if (arrive > P.t) P.hold(arrive - P.t, A.idle, U.chat, 0, yawA);
      const endT = arrive + dur;
      if (arrive - Pb.t > 1.6) Pb.hold(arrive - Pb.t - 1.5, A.idle, U.idle, 0, yawB);
      Pb.hold(Math.min(1.5, Math.max(0.1, arrive - Pb.t)), A.wave, U.chat, 0, yawB);
      Pb.hold(endT - Pb.t, A.talk, U.chat, 0, yawB);
      P.hold(endT - P.t, A.talk, U.chat, 0, yawA);
      const place = P.ctx >= 0 ? this.placeName(ctxB(P.ctx), ctxF(P.ctx)) : this.nav.addressAt(P.x, P.z);
      a.chatWith = o.i; o.chatWith = a.i;   // before act(): observers learn who is talking with whom
      this.act(a, 'chat', 'chat', P, { ctx: P.ctx, place, holdStart: arrive, holdEnd: endT, arrive });
      this.act(o, 'chat', 'chat', Pb, { ctx: Pb.ctx, place, holdStart: arrive, holdEnd: endT, arrive });
      o.busyUntil = endT; a.busyUntil = endT;
      this.sim.commit(o, Pb);
      return true;
    }
    return false;
  }
  /** Player walks up and talks: stop, face them, talk for a while. Returns true if the agent can talk now. */
  /** Turns to (px, pz) and talks a while; label: what it is doing, said from its side ("Talking with Nova"; default the
   *  greeting's own, as a player who walked up to it sees it). */
  talkTo(a, px, pz, secs = 22, label = '', withIdx = null) {
    const now = this.sim.now();
    if (a.act && (a.act.use === 'sleep' || a.act.use === 'shower') && a.act.holdEnd > now) return false;
    const P = this.cut(a, now + 0.1);
    if (P.ctx === CTX_UNDER) return false;
    const yaw = Math.atan2(px - P.x, pz - P.z);
    const hs = P.t;
    if (P.seat) {
      P.seg(secs, P.x, P.y, P.z, P.yaw, A.sit_talk, U.greet, 0, 0, P.ctx, { h: 1, up: P.seat.up, sk: P.seat.key });
    } else {
      P.hold(1.2, A.wave, U.greet, 0, yaw);
      P.hold(secs, A.talk, U.greet, 0, yaw);
    }
    this.act(a, 'talk', 'greet', P, { ctx: P.ctx, holdStart: hs, holdEnd: P.t, ...(label ? { label } : {}), ...(Number.isInteger(withIdx) ? { talkWith: withIdx } : {}), place: P.ctx >= 0 ? this.placeName(ctxB(P.ctx), ctxF(P.ctx)) : '' });
    a.busyUntil = P.t;
    this.sim.commit(a, P);
    return true;
  }
  // ------------------------------------------------------------------ orders from its own outside AI
  // A connected agent's AI (server/agent-world.js) gives an order — a kind of activity, maybe at a named place, or to be
  // with someone, for a while — and the body keeps doing it until then: it comes before Free Will and the routine
  // (choose). Only a post, a task it is working on, or a body in trouble (starving, exhausted) comes first; an order that
  // can no longer be carried out ends, and the routine goes on.
  /** Floors anyone may walk into: the city's venues (cafés, restaurants, shops, gyms, parks, lounges). */
  publicCtx() {
    if (this._pub && this._pubOf === this.index) return this._pub;
    const set = new Set();
    for (const list of Object.values(this.index.venues)) for (const v of list) set.add(ctxOf(v.b, v.f));
    this._pub = set; this._pubOf = this.index;
    return set;
  }
  /** Whether one may walk up to someone there: outdoors, a public place, or the floor one is on already. */
  reachable(ctx, myCtx) { return ctx < 0 || ctx === myCtx || this.publicCtx().has(ctx); }
  /** Whether an order of this kind could start now, without touching the plan: null, or why not. */
  orderBlocked(a, kind, venue, x, z, o = {}) {
    const econ = this.sim.econ, j = a.p.job;
    switch (kind) {
      case 'work': return !j || j.kind === 'free' ? 'no_job' : null;
      case 'home': return a.p.home ? null : 'no_home';
      case 'jog': return null;
      case 'dance': return this.loungeFor(a) || (this.index.venues.park || []).length ? null : 'nowhere';
      case 'meet': {
        const t = this.sim.agents[o.who];
        if (!t?.plan || o.who === a.i || this.sim.people[o.who]?.retired) return 'nobody';
        const e = evalPlan(t.plan, this.sim.now()), me = evalPlan(a.plan, this.sim.now());
        return this.reachable(e.ctx, me.ctx) ? null : 'private';
      }
      case 'park': case 'cafe': case 'gym': case 'shop': case 'restaurant': case 'arcade': case 'lounge_bar': case 'club': {
        if (econ && !econ.canSpend(a, kind, kind === 'restaurant')) return 'no_money';
        if (venue) return null;
        return (this.index.venues[kind] || []).length ? null : 'nowhere';
      }
      default: return 'unknown';
    }
  }
  /** The order still running at P (null: none, or its time is up). */
  orderNow(a, P) { return this.liveOrder(a, P.t, true); }
  /** Its order at time t, or null; one whose time is up ends there (a meet that never reached them: it gave up), and its
   *  AI is told on its next look — whether a choice point or a look notices first. (Not orderAt: that is what it orders
   *  at a café.) */
  liveOrder(a, t, planning = false) {
    if (!a.order && a.p.order) this.restoreOrder(a);
    const o = a.order;
    if (!o) return null;
    if (t >= o.until) {
      a.orderEnded = { kind: o.kind, who: o.who, why: o.kind === 'meet' && !o.reached ? 'not_found' : 'done', at: o.until };
      this.setOrder(a, null);
      // a meet over while it is still walking over to them: that walk stops now (planning: the next plan replaces it)
      if (!planning && o.kind === 'meet' && a.act?.kind === 'meet' && a.plan) this.interruptSoon(a);
      return null;
    }
    return o;
  }
  /** Its order, kept on the resident (world times, the person's id) so a restart of the server doesn't lose it. */
  setOrder(a, o) {
    a.order = o;
    if (o) {
      a.resume = null;   // its AI asked for something else: that comes instead of what a message interrupted
      const who = o.who !== null && o.who !== undefined ? this.sim.people[o.who]?.id ?? null : null;
      a.p.order = { kind: o.kind, venue: o.venue ? { b: o.venue.b, f: o.venue.f, x: o.venue.x, z: o.venue.z } : null, who, stay: o.stay ?? null,
        until: worldSeconds(this.clock, o.until), reached: o.reached ? worldSeconds(this.clock, o.reached) : 0, at: worldSeconds(this.clock, o.at) };
    } else delete a.p.order;
    this.sim.savePerson?.(a.i);
  }
  /** A saved order back on its body (after a restart): what is left of it, its person found again by their id. */
  restoreOrder(a) {
    const s = a.p.order, c = this.clock, back = ws => (ws - c.dayBase) / c.dayScale;
    if (!s || !s.kind || !Number.isFinite(s.until)) { delete a.p.order; return; }
    let who = null;
    if (s.who !== null && s.who !== undefined) { who = this.sim.people.findIndex(p => p && p.id === s.who); if (who < 0) { delete a.p.order; a.orderEnded = { kind: s.kind, who: null, why: 'nobody', at: this.sim.now() }; return; } }
    a.order = { kind: s.kind, venue: s.venue || null, who, stay: s.stay ?? undefined, until: back(s.until), reached: s.reached ? back(s.reached) : 0, at: back(s.at ?? s.until) };
  }
  /** One round of the order (true: it is doing it). */
  doOrder(a, P, h, day) {
    const o = a.order;
    switch (o.kind) {
      case 'work': return a.p.job.kind !== 'free' && (this.work(a, P, h, day, false), true);
      case 'home': return this.homeRelax(a, P, h);
      case 'jog': return this.jog(a, P);
      case 'dance': {
        const l = this.loungeFor(a);
        if (l && this.useAt(a, P, l.b, l.f, 'dance', [15, 30])) return true;
        const v = this.pickVenue(a, P, 'park');
        return !!(v && this.useAt(a, P, v.b, v.f, 'dance', [15, 30]));
      }
      case 'restaurant': { const v = o.venue || this.pickVenue(a, P, 'restaurant', { essential: true }); return !!(v && this.mealAt(a, P, 'restaurant', v)); }
      case 'meet': {
        // with someone: walk up to where they are now, then stay with them a little; they may have moved on by the next
        // round, and it follows — unless they went somewhere private (the order ends: it doesn't follow people home)
        const t = this.sim.agents[o.who];
        if (!t?.plan || this.sim.people[o.who]?.retired) return false;
        const e = evalPlan(t.plan, P.t);
        if (!this.reachable(e.ctx, P.ctx)) { o.ended = 'private'; return false; }
        const name = this.sim.people[o.who].name;
        if (e.ctx === P.ctx && Math.hypot(e.x - P.x, e.z - P.z) < 2.5) {
          // (the time together starts when they meet: the walk there doesn't use it up)
          if (!o.reached) { o.reached = P.t; o.until = P.t + (o.stay || this.wm(20)); this.setOrder(a, o); }
          const hs = P.t;
          P.hold(this.wm(4), A.talk, U.greet, 0, Math.atan2(e.x - P.x, e.z - P.z));
          this.act(a, 'talk', 'greet', P, { ctx: P.ctx, arrive: hs, holdStart: hs, holdEnd: P.t, label: `With ${name}`, talkWith: o.who, place: P.ctx >= 0 ? this.placeName(ctxB(P.ctx), ctxF(P.ctx)) : '' });
          return true;
        }
        return this.approachOn(a, P, e.x, e.z, e.ctx, `Going over to ${name}`, t);
      }
      default: return this.doLeisure(a, P, o.kind, h, o.venue);
    }
  }
  /** Gives the order now: { kind, venue, who, minutes }. Returns { ok, why }; when it can't start, nothing is cut. */
  order(a, { kind, venue = null, who = null, minutes = 60, maxMinutes = 8 * 60, searchMinutes = MEET_SEARCH_MIN }) {
    const now = this.sim.now(), e = evalPlan(a.plan, now);
    const why = this.orderBlocked(a, kind, venue, e.x, e.z, { who });
    if (why) return { ok: false, why };
    const before = a.order, span = this.wm(clamp(minutes, 5, Math.max(5, maxMinutes)));
    // a meet: `minutes` together once it has reached them; on the way it gives up after searchMinutes (the admin's)
    a.order = kind === 'meet' ? { kind, who, stay: span, until: now + this.wm(clamp(searchMinutes, 5, 24 * 60)), reached: 0, at: now } : { kind, venue, who, until: now + span, at: now };
    const P = this.cut(a, now + 0.1);
    const h = this.hour(P.t), day = this.day(P.t);
    let ok = false;
    try { ok = !!this.doOrder(a, P, h, day); } catch (err) { this.sim.noteError(err); }
    if (ok) {
      // (its time counts from when it gets there: the walk doesn't use it up)
      if (kind !== 'meet' && a.act && a.act.travelEnd > now) a.order.until = a.act.travelEnd + span;
      a.orderEnded = null;
      this.setOrder(a, a.order);
    } else { a.order = before && before.until > now ? before : null; this.lookAround(a, P, this.wm(2)); }
    this.sim.commit(a, P);
    return ok ? { ok: true } : { ok: false, why: 'not_possible' };
  }
  /** On plan P: walks over to (x, z) — outdoors, or on floor ctx of a building — and waits there a little, facing it.
   *  False when there is no way there. */
  approachOn(a, P, x, z, ctx = CTX_OUT, label = '', target = null) {
    if (P.ctx === CTX_UNDER) P.ctx = CTX_OUT;
    // someone on the move (a walk, a jog): it hurries when they are far, and heads for where they will be when it gets
    // there — their plan is known ahead — rather than where they were (at the same pace it would never catch them up)
    let hurry = false;
    if (target?.plan && ctx === CTX_OUT) {
      const far = Math.hypot(x - P.x, z - P.z) > 25, speed = far ? JOG_SPEED : (a.p.speed || 1.35);
      hurry = far;
      for (let k = 0; k < 3; k++) {
        const f = evalPlan(target.plan, P.t + Math.hypot(x - P.x, z - P.z) * 1.3 / speed);
        if (f.ctx !== CTX_OUT) break;   // (they'll be indoors by then: go to where they are now)
        x = f.x; z = f.z;
      }
    }
    const ang = Math.atan2(P.x - x, P.z - z), nx = x + Math.sin(ang) * 1.1, nz = z + Math.cos(ang) * 1.1;
    let dest = { ctx: CTX_OUT, x: nx, z: nz };
    if (ctx >= 0) {
      const B = this.W.buildings[ctxB(ctx)];
      if (!B || B.gone) return false;
      const lv = B.lv[ctxF(ctx)], g = this.nav.grid(lv), R = this.nav.reach(lv), L = toLocal(B, nx, nz);
      let best = null, bd = Infinity;
      for (const c of R.cells) { const q = cellCenter(g, c), d = (q.x - L.x) ** 2 + (q.z - L.z) ** 2; if (d < bd) { bd = d; best = q; } }
      if (!best) return false;
      const w = toWorld(B, best.x, best.z);
      dest = { ctx, x: w.x, z: w.z, lx: best.x, lz: best.z };
    }
    const t0 = P.t;
    this.router.travel(P, dest, this.topt(a, { use: U.wander, ...(hurry ? { speed: JOG_SPEED, anim: A.jog } : {}) }, P.t));
    const hs = P.t;
    // a moment to look again (someone still: they're there; someone walking: the next round catches them up)
    P.hold(target ? this.wm(0.5) : this.wm(3), A.idle, U.greet, 0, Math.atan2(x - dest.x, z - dest.z));
    // (its own kind: walking over to someone is not a conversation — its life's log keeps it out)
    this.act(a, 'meet', 'greet', P, { ctx: dest.ctx, arrive: hs, holdStart: hs, holdEnd: P.t, ...(label ? { label } : {}), place: dest.ctx >= 0 ? this.placeName(ctxB(dest.ctx), ctxF(dest.ctx)) : this.nav.addressAt(dest.x, dest.z) });
    return P.t > t0;
  }
  /** Ends its order (its AI said stop): the routine and Free Will decide again from the next choice. */
  endOrder(a) { const had = !!(a.order || a.p.order); a.orderEnded = null; this.setOrder(a, null); return had; }

  /** Direct command from the UI. */
  command(a, cmd) {
    const now = this.sim.now();
    const P = this.cut(a, now + 0.1);
    const h = this.hour(P.t), day = this.day(P.t);
    let ok = false;
    try {
      switch (cmd) {
        case 'home': ok = this.homeRelax(a, P, h); break;
        case 'work': ok = a.p.job.kind !== 'free' && (this.work(a, P, h, day, false), true); break;
        case 'eat': ok = this.eat(a, P, h, day); break;
        case 'sleep': this.sleep(a, P, h); ok = true; break;
        case 'park': ok = this.parkVisit(a, P, h); break;
        case 'cafe': ok = this.cafeVisit(a, P, h); break;
        case 'gym': ok = this.gymVisit(a, P); break;
        case 'shop': ok = this.shopVisit(a, P); break;
        case 'arcade': ok = this.arcadeVisit(a, P, h); break;
        case 'lounge_bar': ok = this.loungeBarVisit(a, P, h); break;
        case 'club': ok = this.clubVisit(a, P, h); break;
        case 'jog': ok = this.jog(a, P); break;
        case 'dance': {
          const lounge = this.loungeFor(a);
          ok = !!(lounge && this.useAt(a, P, lounge.b, lounge.f, 'dance', [15, 30]));
          if (!ok) { const v = this.pickVenue(a, P, 'park'); ok = !!(v && this.useAt(a, P, v.b, v.f, 'dance', [15, 30])); }
          break;
        }
        default: ok = false;
      }
    } catch (e) { this.sim.noteError(e); ok = false; }
    if (!ok) this.lookAround(a, P, this.wm(2));
    this.sim.commit(a, P);
    return ok;
  }
  /** Cut the plan at the earliest safe time >= t and return a new plan cursor (standing up first if seated). anyTime: at t
   *  itself, even mid-ride or mid-crossing (it is about to be put somewhere else at once: postNow). */
  cut(a, t, anyTime = false) {
    const now = this.sim.now();
    const tc = anyTime ? Math.max(t, now) : safeCutTime(a.plan, Math.max(t, now));
    this.needsAt(a, tc);
    if (a.act) a.act.holdEnd = Math.min(a.act.holdEnd, tc);
    this.release(a); this.leaveJoin(a); this.setAct(a, null);
    truncatePlan(a.plan, tc);
    const P = continuePlan(a.plan, now);
    if (P.ctx === CTX_UNDER) P.ctx = CTX_OUT;
    return P;
  }
  /**
   * On its post (an AI agent's, around the clock — server/agent-posts/): to the piece of furniture its owner chose, and
   * there an hour at a time. Taken by someone else for now: it waits close by and tries again. Its furniture gone: false
   * (its day goes on; the post itself is dropped when the world is checked — population.js validatePerson).
   */
  postDuty(a, P) {
    const r = a.p.post;
    if (!this.index.entry(r.b, r.f, r.id)?.slots[r.k]) return false;
    const st = this.slotBegin(a, P, r.b, r.f, r.id, r.k);
    if (!st) { this.lookAround(a, P, this.wm(2)); return true; }
    const hs = this.slotHold(a, P, st, this.wm(60));
    this.act(a, 'post', st.s.use, P, { ...this.slotInfo(st), ...hs, place: this.placeName(r.b, r.f), label: 'On duty', icon: '🛎' });
    return true;
  }
  /**
   * Posted this moment from the furniture itself (2026-10-23: "i want the agent to transport right away, not walk there
   * that way its instant"): it is at its post at once. From then on it is like any post: let go, or its furniture gone,
   * it walks off to its day. False when its spot is taken right now (it then goes there as usual: interruptSoon).
   */
  postNow(a) {
    const r = a.p.post;
    if (!r || !a.plan || !this.index.entry(r.b, r.f, r.id)?.slots[r.k]) return false;
    if (this.heldBy(this.key(r.b, r.f, r.id, r.k), a.i)) return false;
    const P = this.cut(a, this.sim.now(), true);   // (now, even in a lift or on a crossing: it is put at its post this moment)
    P.tele = true;
    let ok = false;
    try { ok = this.postDuty(a, P) && !P.tele; } catch (e) { this.sim.noteError(e); }
    P.tele = false;
    if (!ok) { P.hold(0.5, A.idle, U.idle); this.act(a, 'idle', 'idle', P, { holdStart: P.base, holdEnd: P.t }); }
    this.sim.commit(a, P);
    return ok;
  }
  /** Given its work from the piece itself during its shift (posts.js work): at its desk or counter at once, like postNow;
   *  off shift (or someone at that spot right now), false: it goes there when its shift starts. */
  workNow(a) {
    const j = a.p.job;
    if (!j || j.b === undefined || j.id === undefined || !a.plan || a.p.post) return false;
    const now = this.sim.now(), h = this.hour(now), day = this.day(now);
    if (!((j.days ?? 127) & (1 << mod(day, 7))) || h < j.start || h >= j.end - 0.05) return false;
    if (this.heldBy(this.key(j.b, j.f, j.id, j.k), a.i)) return false;
    if (a.doneDay === day) a.doneDay = null;
    const P = this.cut(a, now, true);
    P.tele = true;
    let ok = false;
    try { this.work(a, P, h, day, false); ok = !P.tele; } catch (e) { this.sim.noteError(e); }
    P.tele = false;
    if (!ok) { P.hold(0.5, A.idle, U.idle); this.act(a, 'idle', 'idle', P, { holdStart: P.base, holdEnd: P.t }); }
    this.sim.commit(a, P);
    return ok;
  }
  /** Stop what you are doing and decide again right away (after world edits). */
  interruptSoon(a, jumpTo = null) {
    const now = this.sim.now();
    const P = this.cut(a, now);
    if (jumpTo) P.jump(jumpTo.x, jumpTo.y, jumpTo.z, jumpTo.ctx);
    const fw = this.sim.freeWill;
    if (fw && fw.isActive(a.i) && !jumpTo) {
      // an agent with Free Will looks at its phone for a few seconds while it decides what to do about it (the question
      // goes out now; the routine takes over if the answer is late)
      P.hold(this.sim.lead() + 2.5 * Math.max(1, this.clock.rate), A.phone, U.phone, PROP.phone);
      this.act(a, 'idle', 'phone', P, { holdStart: P.base, holdEnd: P.t });
    } else {
      P.hold(0.4 + a.rng.next() * 1.5, A.idle, U.idle);
      this.act(a, 'idle', 'idle', P, { holdStart: P.base, holdEnd: P.t });
    }
    this.sim.commit(a, P);
  }

  // ------------------------------------------------------------------ warm start
  warm(a, now) {
    const p = a.p, h = this.hour(now), day = this.day(now);
    a.nt = now;
    const g = this.nav.g;
    const P = new Plan(now, { x: g.X[0] ?? 0, y: GROUND_Y, z: g.Z[0] ?? 0, ctx: CTX_OUT, yaw: 0 });
    const outdoorStart = () => {
      P.tele = false;
      const s = this.outdoorSpot(a);
      if (s) P.place(s.x, s.y, s.z, CTX_OUT, a.rng.float(-3, 3));
    };
    if (p.home) { const B = this.W.buildings[p.home.b]; P.place(B.x, floorAt(B, 0), B.z, CTX_OUT); } else outdoorStart();
    P.tele = true;
    try {
      if (this.nowhere(a)) { P.tele = false; this.outOfTown(a, P); }
      // (an order its AI gave before the server restarted goes on: it starts where its order has it)
      else if (this.liveOrder(a, now, true) && !(a.p.post) && this.doOrder(a, P, h, day)) { /* resumed */ }
      // on post (server/agent-posts/): it starts the world at its post, day or night (2026-10-15: after a restart a posted
      // agent was put to bed at home until morning)
      else if (p.post && this.postDuty(a, P)) { /* on duty */ }
      else if (p.vip && p.job.kind === 'vip' && this.sim.presence.isWorking(p.agentId)) this.work(a, P, h, day, true);
      else if (this.sleepTime(a, h)) {
        if (p.home) this.sleep(a, P, h); else { outdoorStart(); this.sleepAway(a, P, p.sched.wake, true); }
      } else if (this.onShift(a, P, h, day) && h >= p.job.start && p.job.kind !== 'remote') this.work(a, P, h, day, false);
      else {
        const r = a.rng.next();
        if (p.home && r < 0.4) { if (!this.homeRelax(a, P, h)) { outdoorStart(); this.leisure(a, P, h, day); } }
        else if (r < 0.72) {
          const kind = a.rng.pick(['cafe', 'park', 'shop', 'park', 'cafe']);
          if (!(isOpen(kind, h) && this.doLeisure(a, P, kind, h))) { outdoorStart(); this.leisure(a, P, h, day); }
        } else { outdoorStart(); this.leisure(a, P, h, day); }
      }
    } catch (e) {
      this.sim.noteError(e);
      this.release(a); this.setAct(a, null);
    }
    if (P.tele) outdoorStart();
    if (!P.segs.length) { P.hold(this.wm(a.rng.float(1, 10)), A.idle, U.idle); this.act(a, 'idle', 'idle', P, { holdStart: now, holdEnd: P.t }); }
    // stagger: shorten long first holds so decisions spread out
    const first = P.segs.find(s => s.h);
    if (first && first.dur > 30 && a.act && a.act.use !== 'sleep') {
      const cutBy = first.dur * a.rng.next() * 0.85;
      first.dur -= cutBy; P.t -= cutBy;
      if (a.act.holdEnd) a.act.holdEnd -= cutBy;
    }
    this.sim.commit(a, P);
  }
}
