// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI agents cooking a Rush of Order Up as something they choose to do (2026-11-17, the product owner: "companion agents should be able to
// interact with any current and future object the same way players can … play games and modules with me … they are
// essentially AI Agent Players"). A player walks into a kitchen and cooks a Rush any time; an agent does too — not only
// on its kitchen shift (./kitchen-shifts.js) — through the interaction registry (server/interactions/registry.js), the
// source 'orderup' here, as fishing's companions do (./fishing-crew.js):
//
// - A Rush of its own ('cook'): in a kitchen it may use — a public place's (a café's, a bar's, an arcade's), its own
//   workplace's, its owner's (a business its owner owns) — open now, near it (on its own: it walks there) or, out with its
//   owner, right beside them (they are in that café: it goes into the kitchen while they are near). "Cook a Lunch Rush in
//   «Pour Decisions»'s kitchen (your Order Up level 3, best 2★)".
// - Alongside its owner ('along'): its owner is cooking a Rush in a kitchen near it (their page's Order Up) — it goes into
//   that kitchen and cooks a Rush of its own alongside theirs: the same Rush level and the same orders (their Rush's seed),
//   on the same clock (the play core's along: their start), so their scores compare dish for dish. It joins when its Free
//   Will picks it (the moment: "Kim started a Lunch Rush"), when asked ("let's cook", its brain's do), or — without Free
//   Will of its own — by itself a moment after its owner's Rush begins (as it gets into their boat with them). A Rush is one
//   cook's (the play core scores one cook's log); a true co-op kitchen, two cooks in one Rush, is not this — see
//   docs/features/interactions.md "Order Up".
// - Cooked for real: the Rush is laid out by the server in that kitchen (its stations, its place's menu, the agent's own
//   skills), cooked beat by beat by the cook bot at the agent's Order Up level (shared/orderup/cook-bot.js: the coach's
//   steps at the pace and with the slips of its level; joining late, nothing before it got there), played again and
//   recorded by the server once its minutes have passed, exactly as a shift's (./kitchen-shifts.js lay / record: score,
//   stars, half the experience as any unattended run, its level and badges, the Cookbook, its skill points with Free
//   Will, its owner told of a new level or badge) — the same daily cap as its shifts.
// - Seen and said: its body walks into the kitchen and goes from station to station as its cook bot does (the fridge, the
//   espresso machine, the pass … the stations it spends a while at, in order, a cook's brisk steps between them), with the
//   cooking clip; "Cooking a Lunch Rush" as what it is doing; a bubble when it starts and with its result ("🍳 Lunch Rush:
//   412 pts ★★"); its owner's page told (a toast) when it starts and finishes; its diary (its start and stop here, the
//   play core's own line for its result: server/senses/play-activities.js).
// - Stopping: asked ("stop cooking", the registry's stop), its owner walking or driving off from the kitchen, its body
//   given anything else (an order, its own choice), or a walk there that never gets there: the Rush is given up and
//   nothing is recorded — it says so, it never claims a Rush it didn't finish.
// Nothing here draws a simulation random number: the city's routines are unchanged (tools/sim-digest.mjs).
import { evalPlan } from '../sim/plan.js';
import { isOpen } from '../sim/agents.js';
import { A } from '../../shared/anims.js';
import { CATALOG, USE_ID, USES } from '../../shared/catalog.js';
import { ctxOf, ctxB, ctxF, floorAt } from '../../shared/constants.js';
import { CTX_OUT, CTX_UNDER } from '../../shared/proto.js';
import { toWorld, itemToLocal, bRot } from '../../shared/geom.js';
import { COURSES, BEAT } from '../../shared/orderup/module.js';
import { kitchenOf } from '../../shared/orderup/kitchens.js';

export const TICK_MS = 500;
export const NEAR_M = 150;      // m: kitchens this close to an agent on its own (it walks there)
export const WITH_M = 15;       // m: a kitchen this close to its owner (its pass): a companion cooks there beside them
export const ALONG_M = 120;     // m: its owner's kitchen this close: it goes in and cooks alongside them
export const LEAVE_M = 45;      // m: its owner this far from the kitchen, or driving off: it stops and goes with them
export const JOIN_MS = 4000;    // without Free Will: it joins its owner's Rush this long after it begins
export const GO_MS = 180000;    // real ms: the longest walk to a kitchen before it gives up
export const LATE_S = 25;       // s: less than this of its owner's Rush left when it gets there: too late to start one
const MIN_STAY_S = 2.4;         // s: a station its cook bot is at for less than this, its body doesn't walk over to
const MAX_STOPS = 90;           // stations its body walks to in one Rush, at most (the longer stays first)
const STEP_SPEED = 1.9;         // m/s: a cook's brisk steps between stations
const PER_KIND = 2;             // kitchens offered at once (the nearest)
const WAIT_S = 90;              // sim s: at the pass, waiting for its Rush to begin (the watch begins it within a tick)
const U = USE_ID;
const clean = (s, n = 60) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const stars = n => (n > 0 ? '★'.repeat(n) : 'no stars');
const an = w => (/^[aeiou]/i.test(w) ? 'an' : 'a');

export class KitchenPlay {
  /**
   * @param {object} o
   * @param {object} o.play            server/play/play.js PlayCore
   * @param {object} o.shifts          ./kitchen-shifts.js KitchenShifts (lay, record, the daily cap, who is on a shift)
   * @param {() => object} o.sim       the running Sim
   * @param {object} o.agents          the agent registry (get, byKey)
   * @param {object} o.players         server/world/players.js Players (byId)
   * @param {() => object} o.companions server/companions/companions.js (decides, remark, playerLead)
   * @param {() => object} o.world     the world (its kitchens)
   * @param {(rec) => object} [o.ctxOf] the interaction registry's context for an agent (server/interactions/context.js)
   * @param {(owner, rec, b, f) => boolean} [o.owns] whether the place at (b, f) is its owner's (or its own) business
   * @param {(i, text) => void} [o.say]            a line in a bubble over body i (not voiced)
   * @param {(accountId, frame) => void} [o.toAccount] a frame to an account's pages
   * @param {(agentId, kind, text, o) => void} [o.note] a line in an agent's diary (server/senses/ note)
   */
  constructor({ play, shifts, sim, agents, players, companions = () => null, world = () => null, ctxOf = () => null, owns = () => false, say = () => {}, toAccount = () => {}, note = () => {}, now = () => Date.now(), log = null }) {
    Object.assign(this, { play, shifts, simOf: sim, agents, players, companionsOf: companions, worldOf: world, ctxOf, owns, say, toAccount, note, now, log });
    this.cooking = new Map();   // agent id → its Rush: { agent, i, name, owner, mode ('own' | 'with' | 'along'), phase ('going' | 'cooking'), k (its kitchen), … }
    this.seen = new Map();      // agent id → its owner's Rush (run id) it was told of / joined / declined: { run, at, joined, declined }
    this.kitchens = null;       // the world's Order Up kitchens (by the world's version)
    this.timer = null;
    this.stats = { started: 0, along: 0, recorded: 0, stopped: 0, refused: 0, joined: 0 };
  }
  get sim() { return this.simOf(); }
  attach() { this.timer = setInterval(() => { try { this.tick(); } catch (e) { this.log?.warn?.('[kitchen-play] tick failed:', e.stack || e.message); } }, TICK_MS); this.timer.unref?.(); return this; }
  stop() { clearInterval(this.timer); this.timer = null; }

  // ------------------------------------------------------------------------------------------------ the kitchens
  /** The world's Order Up kitchens (a kitchen module with its pass): [{ b, f, ctx, x, z, venue, stations: [{ id, t, lx, lz,
   *  yaw }], pass }] — kept until the world changes. */
  allKitchens() {
    const W = this.worldOf();
    if (!W) return [];
    if (this.kitchens && this.kitchens.ver === W.version && this.kitchens.W === W) return this.kitchens.list;
    const list = [];
    for (const B of W.buildings || []) {
      if (!B || B.gone) continue;
      for (let f = 0; f < (B.lv || []).length; f++) {
        const L = W.levels[B.lv[f]], rec = (L?.mods || []).find(m => m.kind === 'kitchen');
        if (!rec) continue;
        const K = kitchenOf(rec.data?.kitchen), its = (L.items || []).filter(it => it.mod === rec.id && K.stations[it.t]);
        const stations = its.map(it => ({ id: it.id, t: it.t, ...KitchenPlay.spotOf(it) }));
        const pass = stations.find(s => s.t === 'ou_pass');
        if (!pass) continue;
        const w = toWorld(B, pass.lx, pass.lz);
        list.push({ b: B.idx ?? W.buildings.indexOf(B), f, ctx: ctxOf(B.idx ?? W.buildings.indexOf(B), f), x: w.x, z: w.z, venue: L.venue || null, stations, pass, B });
      }
    }
    this.kitchens = { ver: W.version, W, list };
    return list;
  }
  /** Where a cook stands at station `it` (level frame): its own cook's place when it has one (shared/catalog.js slots), else
   *  just in front of it, facing it. → { lx, lz, yaw }. */
  static spotOf(it) {
    const def = CATALOG[it.t], s = def?.slots?.[0];
    if (s) { const p = itemToLocal(it, s.x, s.z); return { lx: p.x, lz: p.z, yaw: s.yaw + (it.r || 0) }; }
    const front = (def?.rect?.[3] ?? 0.34) + 0.42, p = itemToLocal(it, 0, front);
    return { lx: p.x, lz: p.z, yaw: Math.PI + (it.r || 0) };
  }
  kitchenAt(b, f) { return this.allKitchens().find(k => k.b === b && k.f === f) || null; }
  placeOf(k) { return clean(this.sim?.brain?.placeName?.(k.b, k.f) || k.B?.name || 'the kitchen', 50); }
  /** Whether agent rec (person p) may cook in kitchen k: a public place's, its workplace's, its owner's (or its own). */
  mayUse(rec, p, k, owner) {
    const brain = this.sim?.brain;
    if (brain?.index?.isPublicFloor?.(k.b, k.f)) return true;
    if ((p?.job && p.job.b === k.b) || (p?.post && p.post.b === k.b)) return true;
    try { return !!this.owns(owner, rec, k.b, k.f); } catch { return false; }
  }
  /** Whether kitchen k's place is open now (a resident would go in): its venue's hours. */
  openNow(k) { const brain = this.sim?.brain; return !k.venue || !brain ? true : isOpen(k.venue, brain.hour(this.sim.now())); }

  // ------------------------------------------------------------------------------------------------ its Order Up
  /** Its Order Up as the play core has it: { level, best (per course: { score, stars }), unlocked }. */
  cookOf(agentId) { try { return this.play.progress(-agentId).modules.orderup; } catch { return { level: 1, best: {}, unlocked: [COURSES[0].id] }; } }
  /** Why it can't cook a Rush now (in words), or null: on its kitchen shift, cooking already, its Rushes for today done. */
  busyWhy(agentId) {
    if (this.cooking.has(agentId)) return 'it is cooking a Rush already';
    if (this.shifts?.view?.(agentId)?.cooking) return 'it is cooking on its kitchen shift';
    try { if (this.shifts?.onDuty?.().some(d => d.agent.id === agentId)) return 'it is on its kitchen shift (it cooks its Rushes there)'; } catch { /* no posts here */ }
    const d = this.shifts?.today?.(agentId);
    if (d && d.today >= d.cap) return `it has cooked its ${d.cap} Rushes for today`;
    const r = this.play.runOf(-agentId);
    if (r && r.module !== 'orderup') return 'it is in the middle of another game';
    return null;
  }
  /** The run its leader (a player's account) is cooking now, live: { run, course, k (its kitchen), left (s) } or null. */
  ownerRush(account) {
    if (account == null) return null;
    const run = this.play.runOf(account);
    if (!run || run.module !== 'orderup' || run.auto || !run.data) return null;
    const course = COURSES.find(c => c.id === run.course), left = course ? course.dur - (this.now() - run.at) / 1000 : 0;
    if (!course || left <= 0) return null;
    const k = this.kitchenAt(run.data.b, run.data.f);
    return k ? { run, course, k, left } : null;
  }

  // ------------------------------------------------------------------------------------------------ the registry
  /** The registry's source (server/interactions/registry.js): a Rush of its own, one alongside its owner's, stopping. */
  source() {
    return { id: 'orderup', kinds: ['cook', 'along', 'stop'], notes: true, near: ctx => this.near(ctx), run: (ctx, aff, params) => this.run(ctx, aff, params) };   // (notes: its diary lines are its own)
  }
  /** What it can do here now (ctx: the registry's — rec, i, a, p, me, leader). */
  near(ctx) {
    const out = [], rec = ctx?.rec, a = ctx?.a, sim = this.sim;
    if (!rec || !a?.plan || !sim) return out;
    const fun = USES.cook?.rate?.fun ?? 0, effects = { rate: USES.cook?.rate || null, once: null, words: fun > 0 ? 'fun up' : '' };
    const m = this.cooking.get(rec.id);
    if (m) {
      const where = { x: m.k.x, z: m.k.z, ctx: m.k.ctx, place: this.placeOf(m.k) };
      const left = m.run ? Math.max(0, Math.round((m.run.due - this.now()) / 1000)) : null;
      out.push({ key: 'stop', kind: 'stop', label: `Stop cooking (${m.course.label} in «${this.placeOf(m.k)}»'s kitchen${left != null ? `, ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} to go` : ', on the way there'} — a Rush given up doesn't count)`, where, cost: null, effects: {}, withLeader: m.mode !== 'own', d: 0 });
      return out;
    }
    if (a.ride || this.busyWhy(rec.id)) return out;
    const me = ctx.me, pr = this.cookOf(rec.id), lead = ctx.leader && !ctx.leader.gone && ctx.leader.kind === 'player' && a.order?.kind === 'follow' ? ctx.leader : null;
    if (lead?.car) return out;
    // alongside its owner's Rush (the same orders, the same clock)
    const own = lead ? this.ownerRush(lead.account) : null;
    if (own && own.left > LATE_S) {   // (its owner took it there: their kitchen is one it may cook in beside them)
      const d = Math.hypot(own.k.x - me.x, own.k.z - me.z);
      if (d <= ALONG_M) {
        const gone = Math.max(0, Math.round(own.course.dur - own.left)), best = pr.best?.[own.course.id];
        out.push({ key: `along:${own.run.id}`, kind: 'along', label: `Cook alongside ${clean(lead.name, 40)} in «${this.placeOf(own.k)}»'s kitchen: your own ${own.course.label}, the same orders on their clock (${Math.floor(gone / 60)}:${String(gone % 60).padStart(2, '0')} of ${Math.floor(own.course.dur / 60)}:${String(own.course.dur % 60).padStart(2, '0')} gone; your Order Up level ${pr.level}${best ? `, best ${stars(best.stars)}` : ''})`,
          where: { x: own.k.x, z: own.k.z, ctx: own.k.ctx, place: this.placeOf(own.k) }, cost: null, effects, withLeader: true, d: Math.round(d), kitchen: { b: own.k.b, f: own.k.f }, course: own.course.id, along: own.run.id });
      }
    }
    // a Rush of its own: beside its owner (a kitchen right where they are), or near it on its own
    const course = this.shifts?.courseFor?.(rec.id) || COURSES[0], best = pr.best?.[course.id];
    // (beside its owner: a kitchen on the floor they are on, close to them; on its own: one near it, wherever)
    const at = lead || me, reach = lead ? WITH_M : NEAR_M;
    const list = this.allKitchens().map(k => ({ k, d: Math.hypot(k.x - at.x, k.z - at.z) })).filter(x => x.d <= reach && (!lead || lead.ctx === x.k.ctx) && !(own && own.k === x.k)).sort((p, q) => p.d - q.d);
    let n = 0;
    for (const { k, d } of list) {
      if (n >= PER_KIND) break;
      // (on its own: a kitchen it may use, open now; beside its owner, the one right where they are)
      if (!lead && (!this.mayUse(rec, ctx.p, k, ctx.owner) || !this.openNow(k))) continue;
      n++;
      out.push({ key: `cook:${k.b}.${k.f}`, kind: 'cook', label: `Cook ${an(course.label)} ${course.label} in «${this.placeOf(k)}»'s kitchen (${Math.round(course.dur / 60)} min; your Order Up level ${pr.level}${best ? `, best ${stars(best.stars)}` : ', a first go at it'}${lead ? `, near ${clean(lead.name, 40)}` : ''})`,
        where: { x: k.x, z: k.z, ctx: k.ctx, place: this.placeOf(k) }, cost: null, effects, withLeader: false, d: Math.round(lead ? Math.hypot(k.x - me.x, k.z - me.z) : d), kitchen: { b: k.b, f: k.f }, course: course.id });
    }
    return out;
  }
  /** Does what aff says (validated again now): → { ok, kind, text (for the page), brain (for its chat), effects }. */
  run(ctx, aff, params = {}) {
    const rec = ctx?.rec, a = ctx?.a, kind = aff?.kind, name = clean(rec?.name || 'It', 40);
    const no = (text, brain) => { this.stats.refused++; return { ok: false, kind, text, brain }; };
    if (!rec || !a?.plan || !this.sim) return no(`${name} has no body here`, 'your body is not in the city right now');
    if (kind === 'stop') {
      const m = this.cooking.get(rec.id);
      if (!m) return no(`${name} isn't cooking`, 'you are not cooking a Rush now');
      this.end(m, 'asked');
      return { ok: true, kind, text: `${name} stops cooking`, brain: `you stopped cooking (${m.course.label}): a Rush given up doesn't count, nothing is recorded`, effects: {} };
    }
    const why = this.busyWhy(rec.id);
    if (why) return no(`${name} can't cook now: ${why}`, `you can't cook a Rush now: ${why}`);
    if (kind === 'along') {
      const lead = ctx.leader, own = lead && !lead.gone ? this.ownerRush(lead.account) : null;
      if (!own || own.run.id !== aff.along) return no(`${clean(lead?.name || 'Your owner', 40)} isn't cooking a Rush now`, 'your owner is not cooking a Rush now (or it just ended)');
      return this.begin(ctx, { mode: 'along', k: own.k, course: own.course, along: own.run.id, leader: lead.account, via: params.via || ctx.via || 'asked' });
    }
    if (kind === 'cook') {
      const k = this.kitchenAt(aff.kitchen?.b, aff.kitchen?.f), pr = this.cookOf(rec.id);
      const lead = ctx.leader && !ctx.leader.gone && ctx.leader.kind === 'player' && a.order?.kind === 'follow' ? ctx.leader : null;
      if (!k) return no('That kitchen is gone', 'that kitchen is not there any more');
      if (!lead && !this.mayUse(rec, ctx.p, k, ctx.owner)) return no(`${name} may not cook there`, 'that kitchen is not one you may use (a public place\'s, your workplace\'s or your owner\'s)');
      if (!lead && !this.openNow(k)) return no(`${this.placeOf(k)} is closed now`, `${this.placeOf(k)} is closed now`);
      const want = COURSES.find(c => c.id === (params.course || aff.course)) || this.shifts.courseFor(rec.id);
      if (!pr.unlocked.includes(want.id)) return no(`${name} hasn't opened ${want.label} yet`, `you haven't opened ${want.label} yet: finish the Rush level before it first`);
      return this.begin(ctx, { mode: lead ? 'with' : 'own', k, course: want, leader: lead?.account ?? null, via: params.via || ctx.via || 'asked' });
    }
    return no('Nothing like that to do here', 'there is nothing like that to do here');
  }
  /** A plain command from its owner (the reflex: 'cook', 'uncook') → { ok, action, text, brain } or null (not its action). */
  command(P, rec, action, via = 'chat', ctxOf = null) {
    if (action !== 'cook' && action !== 'uncook') return null;
    const ctx = (ctxOf || this.ctxOf)(rec);
    if (!ctx?.a) return { ok: false, action, text: `${rec.name} has no body in the city right now`, brain: 'your body is not in the city right now' };
    const list = this.near(ctx);
    // "let's cook": alongside them when they cook, else a Rush of its own in the kitchen nearest them; "stop cooking"
    const aff = action === 'uncook' ? list.find(x => x.kind === 'stop') : list.find(x => x.kind === 'along') || list.find(x => x.kind === 'cook');
    if (!aff) {
      if (action === 'uncook') return this.others?.(ctx, action) ? null : { ok: false, action, text: `${rec.name} isn't cooking`, brain: 'you are not cooking a Rush now' };   // (a chef's shift to end instead: server/play/work-play.js)
      const why = this.busyWhy(rec.id);
      if (!why && this.others?.(ctx, action)) return null;   // (no Order Up kitchen here, but a kitchen to work in: the next handler's — a chef's shift)
      return { ok: false, action, text: why ? `${rec.name} can't cook now: ${why}` : `There's no kitchen ${rec.name} may cook in here`, brain: why ? `you can't cook a Rush now: ${why}` : 'there is no Order Up kitchen here you may use (a café\'s, a bar\'s, an arcade\'s; your workplace\'s or your owner\'s): say so' };
    }
    const r = this.run({ ...ctx, via }, aff, { via });
    return { ok: r.ok, action, text: r.text, brain: r.brain };
  }

  // ------------------------------------------------------------------------------------------------ the companions' hook
  /** Busy at a Rush: { kind, label } for its companion view (Free Will's moments don't pull it away for a glance). */
  busyWith(a) {
    const rec = this.recOf(a?.i), m = rec ? this.cooking.get(rec.id) : null;
    return m ? { kind: 'orderup', label: m.phase === 'going' ? `Going into «${this.placeOf(m.k)}»'s kitchen` : `Cooking ${an(m.course.label)} ${m.course.label}` } : null;
  }
  /**
   * One follower of a player looked at (server/companions/ watch, twice a second): cooking (or on its way into the kitchen)
   * — its body is this module's (true); its owner just started a Rush — told, and without Free Will of its own it joins in.
   */
  watch(a, o, L) {
    const rec = this.recOf(a?.i);
    if (!rec || o?.lead?.kind !== 'player') return false;
    if (this.cooking.has(rec.id)) return true;
    const own = this.ownerRush(o.lead.id);
    if (!own) return false;
    let s = this.seen.get(rec.id);
    if (!s || s.run !== own.run.id) {
      this.seen.set(rec.id, s = { run: own.run.id, at: this.now(), joined: false, declined: false });
      // (its Free Will's moment: what its owner is doing, with what it may do about it — server/free-will/moments.js)
      this.note(rec.id, 'activity', `${clean(L?.name || 'Your owner', 40)} started ${an(own.course.label)} ${own.course.label} in «${this.placeOf(own.k)}»'s kitchen (Order Up) — you could cook one alongside them`);
    }
    if (s.joined || s.declined || this.decides(rec) || this.now() - s.at < JOIN_MS) return false;
    s.joined = true;
    const ctx = this.ctxOf(rec), aff = ctx ? this.near(ctx).find(x => x.kind === 'along') : null;
    if (!aff) { s.declined = true; return false; }
    const r = this.run({ ...ctx, via: 'joined' }, aff, { via: 'joined' });
    if (r.ok) this.stats.joined++; else s.declined = true;
    return !!r.ok;
  }
  recOf(i) { const p = this.sim?.people?.[i]; return p?.vip && p.agentId ? this.agents.byKey(p.agentId) : null; }
  /** Whether Free Will decides for this agent (server/companions/ decides). */
  decides(rec) { try { return !!this.companionsOf()?.decides?.(rec); } catch { return false; } }
  remark(i, text) { try { this.companionsOf()?.remark?.(i, text); } catch { /* its words are a bonus */ } }
  ownerName(account) { return clean(this.players?.byId?.get(account)?.name || this.companionsOf()?.playerLead?.(account)?.name || 'your owner', 40); }

  // ------------------------------------------------------------------------------------------------ cooking
  /** Into the kitchen: its body walks to the pass (at once there when it is in the kitchen already), then its Rush. */
  begin(ctx, { mode, k, course, along = null, leader = null, via = 'asked' }) {
    const rec = ctx.rec, a = ctx.a, sim = this.sim, brain = sim.brain, name = clean(rec.name, 40), place = this.placeOf(k);
    const owner = ctx.owner ?? rec.ownerId ?? null;
    const m = { agent: rec.id, i: ctx.i, name, owner, mode, via, k, course, along, leader, phase: 'going', since: this.now(), order: a.order || null, act: null, arrive: 0, run: null };
    if (!this.walkIn(m, a)) return { ok: false, kind: mode === 'along' ? 'along' : 'cook', text: `${name} can't get to «${place}»'s kitchen from here`, brain: `there is no way from where you are to «${place}»'s kitchen just now` };
    this.cooking.set(rec.id, m);
    if (sim.now() >= m.arrive - 0.05) this.start(m);   // (in the kitchen already: the Rush begins now)
    const who = leader != null ? this.ownerName(leader) : null;
    if (m.phase === 'going') this.note(rec.id, 'move', `Going into «${place}»'s kitchen to cook ${an(course.label)} ${course.label}${mode === 'along' ? ` alongside ${who}` : ''}`, { key: 'orderup' });
    if (!this.cooking.has(rec.id)) return { ok: false, kind: mode === 'along' ? 'along' : 'cook', text: m.why || `${name} could not start cooking`, brain: `you could not start cooking: ${m.why || 'the Rush could not be laid out'}` };
    const brainWords = mode === 'along'
      ? `you are cooking your own ${course.label} alongside ${who} in «${place}»'s kitchen — the same orders on their clock; the server scores it as a player's (your Order Up level, badges, Cookbook)`
      : `you are ${m.phase === 'going' ? 'on your way into' : 'cooking in'} «${place}»'s kitchen: ${an(course.label)} ${course.label} (${Math.round(course.dur / 60)} min), scored by the server as a player's Rush${mode === 'with' ? ` — ${who} is right there` : ''}`;
    return { ok: true, kind: mode === 'along' ? 'along' : 'cook', text: `${name} ${m.phase === 'going' ? 'is going into' : 'is cooking in'} «${place}»'s kitchen: ${course.label}${mode === 'along' ? ` alongside ${who}` : ''}`, brain: brainWords, effects: { rate: USES.cook?.rate || null } };
  }
  /** Its body walks to the kitchen's pass and waits there for its Rush (m.arrive: when it gets there, sim time). */
  walkIn(m, a) {
    const sim = this.sim, brain = sim.brain, k = m.k, B = sim.brain.W.buildings[k.b];
    if (!B || B.gone) return false;
    const P = brain.cut(a, sim.now() + 0.1), sp = k.pass, w = toWorld(B, sp.lx, sp.lz);
    try { brain.router.travel(P, { ctx: k.ctx, x: w.x, z: w.z, lx: sp.lx, lz: sp.lz }, brain.topt(a, {}, P.t)); } catch (e) { this.log?.info?.(`[kitchen-play] no way to ${k.b}:${k.f}: ${e.message}`); }
    if (P.ctx !== k.ctx) { brain.lookAround(a, P, brain.wm(0.5)); sim.commit(a, P); return false; }
    const arrive = P.t, y = floorAt(B, k.f);
    P.seg(0.3, w.x, y, w.z, sp.yaw + bRot(B), A.idle, U.wait, 0, 0, k.ctx);
    P.hold(WAIT_S, A.idle, U.wait, 0, sp.yaw + bRot(B));
    m.act = brain.act(a, m.mode === 'own' ? 'play' : 'follow', 'cook', P, { ctx: k.ctx, label: `Going into «${this.placeOf(k)}»'s kitchen to cook`, icon: '🍳', place: this.placeOf(k), arrive, holdStart: arrive, holdEnd: P.t });
    m.arrive = arrive;
    sim.commit(a, P);
    return true;
  }
  /** At the pass: the Rush laid out by the server and cooked by its cook bot; its body to the stations. */
  start(m) {
    const sim = this.sim, a = sim.agents[m.i], t = this.now();
    let from = 0, where = { b: m.k.b, f: m.k.f }, along = null;
    if (m.mode === 'along') {
      const own = this.play.runs.get(m.along);
      const left = own ? m.course.dur - (t - own.at) / 1000 : 0;
      if (!own || left < LATE_S) return this.end(m, 'late');
      from = Math.ceil((t - own.at) / 1000 / BEAT);
      where = { ...where, seed: own.data?.seed };
      along = own.id;
    }
    try { m.run = this.shifts.lay(m.agent, where, m.course, { along, from }); }
    catch (e) { m.why = clean(e.message || 'the Rush could not be laid out', 120); return this.end(m, 'refused'); }
    m.phase = 'cooking'; m.startedAt = t;
    const pr = this.play.runs.get(m.run.id); if (pr) pr.chosen = m.mode === 'along' ? 'along' : 'own';   // (its diary's card: not a shift — server/senses/play-activities.js)
    this.stats.started++; if (m.mode === 'along') this.stats.along++;
    this.layStations(m, a);
    const place = this.placeOf(m.k), who = m.leader != null ? this.ownerName(m.leader) : null;
    this.say(m.i, `🍳 ${m.course.label}${m.mode === 'along' ? ` with ${who}` : ''} — orders up!`);
    if (m.owner != null) this.toAccount(m.owner, { t: 'crew_note', agent: m.agent, i: m.i, text: `🍳 ${m.name} started cooking ${an(m.course.label)} ${m.course.label} in «${place}»'s kitchen${m.mode === 'along' ? ' alongside you — the same orders' : ''}` });
    this.note(m.agent, 'activity', `Started cooking ${an(m.course.label)} ${m.course.label} in «${place}»'s kitchen${m.mode === 'along' ? ` alongside ${who} (the same orders, on their clock${from > 0 ? `, ${Math.round(from * BEAT)} s in` : ''})` : m.mode === 'with' ? ` near ${who}` : ''} — at your Order Up level ${m.run.level}`, { key: 'orderup' });
    return true;
  }
  /**
   * Its body through the Rush: the stations its cook bot works at (the log's presses and held beats), the longer stays
   * first, in order — a brisk step to each, the cooking clip there — until the Rush's minutes are over.
   */
  layStations(m, a) {
    const sim = this.sim, brain = sim.brain, k = m.k, B = brain.W.buildings[k.b], y = floorAt(B, k.f), rate = Math.max(0.01, sim.clock?.rate || 1);
    const byId = new Map(k.stations.map(s => [s.id, s]));
    // the cook's stays: [station, from s, to s] (into the Rush), from what it pressed
    const ev = m.run.log.map(x => [x[0] * BEAT, x[2]]).sort((p, q) => p[0] - q[0]), stays = [];
    for (const [t, id] of ev) { const last = stays[stays.length - 1]; if (last && last[0] === id) continue; if (last) last[2] = t; stays.push([id, t, m.course.dur]); }
    let min = MIN_STAY_S, keep = stays;
    for (let n = 0; n < 6; n++) { keep = stays.filter(s => s[2] - s[1] >= min && byId.has(s[0])); if (keep.length <= MAX_STOPS) break; min *= 1.5; }
    const simNow = sim.now(), t0 = simNow - (this.now() - m.run.start) / 1000 * rate, end = t0 + m.course.dur * rate;   // (the Rush's clock in sim time)
    const P = brain.cut(a, simNow + 0.1, true), o = { ...brain.topt(a, {}, P.t), speed: STEP_SPEED, use: U.cook };
    const hs = P.t;
    for (let j = 0; j < keep.length; j++) {
      const [id, , to] = keep[j], s = byId.get(id), until = Math.min(end, t0 + (j + 1 < keep.length ? keep[j + 1][1] : to) * rate);
      if (until - P.t < 0.8) continue;   // (behind: on to where it is wanted next)
      const w = toWorld(B, s.lx, s.lz);
      if (Math.hypot(P.x - w.x, P.z - w.z) > 0.15) brain.router.walkIndoor(P, B, k.f, s.lx, s.lz, o);
      if (until - P.t > 0.2) P.seg(until - P.t, w.x, y, w.z, s.yaw + bRot(B), A.cook, U.cook, 0, 0, k.ctx);
    }
    if (end - P.t > 0.2) P.hold(end - P.t, A.cook, U.cook, 0, P.yaw);
    // (the end bell: its result is in before its next round is planned — the sim plans it a little ahead: sim.lead())
    P.hold(3 + 5 * rate, A.idle, U.wait, 0, P.yaw);
    const who = m.leader != null ? this.ownerName(m.leader) : null;
    m.act = brain.act(a, m.mode === 'own' ? 'play' : 'follow', 'cook', P, { ctx: k.ctx, label: `Cooking ${an(m.course.label)} ${m.course.label}${m.mode === 'along' ? ` alongside ${who}` : m.mode === 'with' ? ` near ${who}` : ''}`, icon: '🍳', place: this.placeOf(k), arrive: hs, holdStart: hs, holdEnd: P.t });
    sim.commit(a, P);
  }

  // ------------------------------------------------------------------------------------------------ the watch
  /** Twice a second: each cook — into the kitchen, its Rush begun; over, recorded; given up when it has to be. */
  tick() {
    const sim = this.sim;
    if (!sim) return;
    for (const m of [...this.cooking.values()]) {
      try { this.step(m); } catch (e) { this.log?.warn?.('[kitchen-play] a cook failed:', e.stack || e.message); }
    }
    const t = this.now();
    for (const [id, s] of this.seen) if (t - s.at > 30 * 60000) this.seen.delete(id);
  }
  step(m) {
    const sim = this.sim, a = sim.agents[m.i], t = this.now();
    if (!a?.plan || sim.people[m.i]?.retired) return this.end(m, 'gone');
    if (m.phase === 'cooking' && t >= m.run.due) return this.finish(m);
    // its body given anything else meanwhile (an order, its own choice, its owner's word): the Rush is given up
    if (a.act !== m.act || (a.order || null) !== m.order) return this.end(m, 'other');
    if (m.leader != null) {
      const L = this.companionsOf()?.playerLead?.(m.leader);
      if (!L || L.car || (!L.gone && (!this.sameBuilding(L, m.k) && Math.hypot(L.x - m.k.x, L.z - m.k.z) > LEAVE_M))) return this.end(m, 'leader');
    }
    if (m.phase === 'going') {
      if (sim.now() >= m.arrive) return this.start(m);
      if (t - m.since > GO_MS) return this.end(m, 'far');
      return null;
    }
    return null;
  }
  sameBuilding(L, k) { return Number.isInteger(L.ctx) && L.ctx >= 0 && ctxB(L.ctx) === k.b; }
  /** Its Rush's minutes over: played again and recorded by the server (as a player's); its result said. */
  finish(m) {
    this.cooking.delete(m.agent);
    const r = this.shifts.record(m.agent, m.run), place = this.placeOf(m.k), sim = this.sim, a = sim.agents[m.i];
    if (!r) {
      this.say(m.i, `🍳 ${m.course.label}: it didn't count`);
      this.note(m.agent, 'activity', `Your ${m.course.label} in «${place}»'s kitchen didn't count (the server's replay refused it)`, { key: 'orderup' });
    } else {
      this.stats.recorded++;
      const up = r.module && r.module.level > r.module.was ? ` — Order Up level ${r.module.level}!` : '', badge = r.badges?.[0] ? ` ${r.badges[0].icon} ${r.badges[0].label}` : '';
      this.say(m.i, `🍳 ${m.course.label}: ${r.score} pts ${stars(r.stars)}${up}${badge}`);
      if (m.owner != null) this.toAccount(m.owner, { t: 'crew_note', agent: m.agent, i: m.i, tone: r.stars >= 2 ? 'good' : '', text: `🍳 ${m.name} finished ${an(m.course.label)} ${m.course.label} in «${place}»'s kitchen: ${r.score} pts, ${stars(r.stars)}${r.detail ? ` — ${r.detail.served} served, ${r.detail.lost} walked out` : ''}${up}` });
      if (r.stars === 3 || up) this.remark(m.i, `I just cooked ${an(m.course.label)} ${m.course.label} in «${place}»'s kitchen: ${r.score} points, ${stars(r.stars)}${up}`);
    }
    m.result = r ? { score: r.score, stars: r.stars, xp: r.xp, level: r.module?.level, badges: (r.badges || []).map(b => b.id) } : null;
    this.last = m;
    if (a?.plan) this.release(m, a);
    return r;
  }
  /** Its Rush given up (asked, its owner gone off, its body taken elsewhere, too late, refused): nothing recorded. */
  end(m, why) {
    this.cooking.delete(m.agent);
    this.stats.stopped++;
    if (m.run && this.play.runs.has(m.run.id)) { try { this.play.abandon({ id: -m.agent }, m.run.id); } catch { /* over */ } }
    const place = this.placeOf(m.k), who = m.leader != null ? this.ownerName(m.leader) : 'your owner';
    const words = { asked: 'you stopped', leader: `${who} left the kitchen`, other: 'you went to do something else', gone: 'you left the city', far: `you never got to «${place}»'s kitchen`,
      late: `${who}'s Rush was nearly over when you got there`, refused: m.why || 'the Rush could not be laid out' }[why] || why;
    m.stopped = why;
    this.last = m;
    if (m.phase === 'cooking' || why !== 'other') this.note(m.agent, 'activity', `${m.phase === 'cooking' ? `Gave up your ${m.course.label} in «${place}»'s kitchen` : `Didn't cook in «${place}»'s kitchen`}: ${words}${m.phase === 'cooking' ? ' — it doesn\'t count' : ''}`, { key: 'orderup' });
    if (m.phase === 'cooking' && m.owner != null && why !== 'asked') this.toAccount(m.owner, { t: 'crew_note', agent: m.agent, i: m.i, text: `🍳 ${m.name} stopped cooking (${words})` });
    const a = this.sim?.agents?.[m.i];
    if (a?.plan && why !== 'other' && why !== 'gone') this.release(m, a);
    return null;
  }
  /** Out of the kitchen: a companion back at its owner's side; one on its own on with its day (it decides again now). */
  release(m, a) {
    const brain = this.sim.brain;
    if (a.order?.kind === 'follow') { brain.reorder(a, true); return; }
    try { brain.interruptSoon(a); } catch (e) { this.log?.warn?.('[kitchen-play] on with its day:', e.message); }
  }
  /** One agent's cooking, for its owner's views and the tests. */
  view(agentId) {
    const m = this.cooking.get(Number(agentId));
    if (!m) return null;
    return { agent: m.agent, mode: m.mode, phase: m.phase, course: m.course.id, label: m.course.label, kitchen: { b: m.k.b, f: m.k.f }, place: this.placeOf(m.k), run: m.run?.id || null, ends: m.run?.due || null, along: m.along || null };
  }
}
