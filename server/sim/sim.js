// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Simulation core: clock, agents, decision scheduling, plan broadcasting, agent info.
import { performance } from 'node:perf_hooks';
import { Nav, MinHeap } from './nav.js';
import { Router, evalPlan, continuePlan } from './plan.js';
import { WorldIndex } from './windex.js';
import { Brain, makeAgent } from './agents.js';
import { dialogLine } from './dialog.js';
import { validatePerson } from './population.js';
import { encodePlans } from '../../shared/proto.js';
import { simAt, hourAt, dayAt, worldSeconds, DEFAULT_DAY_SCALE, clamp, ctxB, ctxF, WEEKDAYS, mod } from '../../shared/constants.js';
import { hashStr, RNG } from '../../shared/rng.js';
import { appToArr } from '../../shared/appearance.js';

export const realNow = () => (performance.timeOrigin + performance.now()) / 1000;
const VK = 1048576;

/** A resident's look for the wire. Saved looks from before the textured characters have no character and no body type:
 *  their gender is the person's own `fem` flag, so the character picked for them is a male or a female to match. */
function lookOf(p) { return p.app && p.app.char ? p.app : { ...p.app, body: p.fem ? 1 : 0 }; }
export class Sim {
  constructor(world, people, o = {}) {
    this.world = world; this.people = people;
    this.seed = hashStr(world.seed + ':sim');
    this.clock = o.clock || Sim.defaultClock();
    this.presence = o.presence || { isWorking: () => false, info: () => null, ok: false };
    this.agentShown = o.agentShown || o.agentOk || (() => true);   // whether an agent's resident is drawn as an agent to the public (a hidden connected agent is not)
    this.agentOk = o.agentOk || (() => true);   // demo mode (WP1.11): only 3 agents are agents; the rest are residents
    this.nav = new Nav(world);
    this.router = new Router(world, this.nav);
    // Residents' drives (WP4.9): every browser draws the car along its lanes while the driver is at the wheel.
    this.drives = new Map();
    this.router.onDrive = rec => { this.drives.set(rec.i, rec); this.emit({ t: 'rcar', ...rec }); };
    this.index = o.index || new WorldIndex(world);
    this.brain = new Brain(this);
    this.agents = people.map((p, i) => makeAgent(i, p, this.seed));
    this.heap = new MinHeap();
    this.dirty = new Set();
    this.listeners = new Set();
    this.actObservers = new Set();   // fn(agent, act) after each planned activity; they only look (server/agent-life/)
    this.events = new Set();
    this.errors = []; this.errorCount = 0;
    this.budgetMs = o.budgetMs ?? 25;
    this.stats = { decisions: 0, lastTickMs: 0, maxTickMs: 0, lag: 0, plansSent: 0, bytesSent: 0, warmMs: 0 };
    this.rng = new RNG(this.seed ^ 0x5bd1e995);
  }
  static defaultClock() {
    // world starts on a Monday at 07:30
    return { simBase: 0, realBase: realNow(), rate: 1, dayBase: 7.5 * 3600, dayScale: DEFAULT_DAY_SCALE };
  }
  now() { return simAt(this.clock, realNow()); }
  /** Plan continuation keeps segments that ended within this window (client clocks may lag slightly). */
  margin() { return 2 + 2 * this.clock.rate; }
  /** Decide this long (sim s) before a plan runs out so clients receive the continuation in time. */
  lead() { return 1.5 + 1.5 * this.clock.rate; }
  hour(t = this.now()) { return hourAt(this.clock, t); }
  clockInfo() {
    const t = this.now();
    return { ...this.clock, serverTime: realNow(), sim: t, hour: hourAt(this.clock, t), day: dayAt(this.clock, t), weekday: WEEKDAYS[mod(dayAt(this.clock, t), 7)] };
  }
  emit(ev) { for (const fn of this.events) { try { fn(ev); } catch (e) { this.noteError(e); } } }

  start() {
    const now = this.now(), t0 = performance.now();
    for (const a of this.agents) this.brain.warm(a, now);
    this.stats.warmMs = Math.round(performance.now() - t0);
  }
  commit(a, P) {
    a.plan = P; a.ver++;
    this.dirty.add(a.i);
    this.heap.push(P.t - this.lead(), a.ver * VK + a.i);
    if (this.onCommit) this.onCommit(a, P);   // Free Will asks ahead for the decision at the end of this plan (server/free-will/)
  }
  noteError(e) {
    this.errorCount++;
    const msg = String(e && e.stack || e).split('\n').slice(0, 4).join(' | ');
    if (this.errors.length < 40 && !this.errors.some(x => x.msg === msg)) this.errors.push({ at: new Date().toISOString(), msg });
  }
  tick() {
    const t0 = performance.now(), now = this.now();
    let n = 0;
    while (this.heap.size && this.heap.peekKey() <= now) {
      if (performance.now() - t0 > this.budgetMs) break;
      const v = this.heap.pop(), i = v % VK, ver = Math.floor(v / VK);
      const a = this.agents[i];
      if (!a || a.ver !== ver) continue;
      if (a.p.retired) continue;   // a removed agent's body is no longer planned (WP2.1)
      this.brain.decide(a, now);
      n++;
    }
    this.stats.decisions += n;
    this.stats.lag = this.heap.size ? Math.max(0, now - this.heap.peekKey()) : 0;
    const ms = performance.now() - t0;
    this.stats.lastTickMs = Math.round(ms * 10) / 10;
    this.stats.maxTickMs = Math.max(this.stats.maxTickMs * 0.999, ms);
  }
  flush() {
    if (!this.dirty.size) return null;
    const list = [];
    for (const i of this.dirty) { const a = this.agents[i]; if (a && a.plan && !a.p.retired) list.push([i, a.plan]); }
    this.dirty.clear();
    const bufs = [];
    for (let k = 0; k < list.length; k += 4000) bufs.push(encodePlans(list.slice(k, k + 4000)));
    for (const b of bufs) { this.stats.bytesSent += b.byteLength; for (const fn of this.listeners) fn(b); }
    this.stats.plansSent += list.length;
    return bufs;
  }
  snapshot() {
    const t = this.now() - this.margin();
    const list = this.agents.filter(a => a.plan && !a.p.retired).map(a => [a.i, continuePlan(a.plan, t)]);
    const bufs = [];
    for (let k = 0; k < list.length; k += 2000) bufs.push(encodePlans(list.slice(k, k + 2000)));
    return bufs;
  }
  /** Change speed (0 = paused). Sim time stays continuous. */
  setRate(rate) {
    const r = clamp(+rate || 0, 0, 60), t = this.now();
    this.clock = { ...this.clock, simBase: t, realBase: realNow(), rate: r };
    this.emit({ t: 'clock', clock: this.clockInfo() });
  }
  /** Jump the world clock forward to hour h; every agent re-plans from scratch. */
  skipTo(h) {
    const t = this.now(), cur = hourAt(this.clock, t);
    let dh = (((+h % 24) + 24) % 24) - cur; if (dh <= 0) dh += 24;
    this.clock = { ...this.clock, dayBase: this.clock.dayBase + dh * 3600 };
    this.rewarm();
    this.emit({ t: 'clock', clock: this.clockInfo() });
  }
  rewarm() {
    const now = this.now();
    this.heap = new MinHeap();
    this.brain.res.clear(); this.brain.at.clear(); this.brain.joinable.clear();
    for (const a of this.agents) { a.res = null; a.act = null; a.actCtx = null; a.joinKey = null; a.queue.length = 0; a.busyUntil = 0; }
    for (const a of this.agents) this.brain.warm(a, now);
  }

  // ------------------------------------------------------------------ people
  publicPerson(p, i) {
    const j = p.job || {};
    const ag = !!p.vip && this.agentShown(p.agentId);
    return { i, x: p.retired ? 1 : 0, id: p.id, n: p.name, v: ag ? p.vip : 0, e: ag ? p.emoji : '', r: ag ? p.role : '', ag: ag ? p.agentId : '', a: appToArr(lookOf(p)),
      jk: j.kind === 'vip' && !ag ? 'office' : j.kind || 'free', jt: this.publicTitle(j, ag), jb: j.b ?? -1, jf: j.f ?? -1, hb: p.home ? p.home.b : -1, hf: p.home ? p.home.f : -1, hu: p.home ? p.home.u ?? -1 : -1,
      ...(ag && p.post ? { po: 1, pb: p.post.b, pf: p.post.f } : {}) };   // (on duty around the clock: anyone may walk up and ask)
  }
  /** A job title as the public reads it: an agent's own title ("Agent at HQ") is never shown for a resident that is not shown as an agent. */
  publicTitle(j, ag) {
    if (ag) return j.title || '';
    if (j.kind === 'vip') return 'Office worker';
    return (j.prev === 'vip' ? 'Newcomer' : j.title) || '';
  }
  /** The drives still under way or to come (for a browser that connects now). */
  activeDrives() { const now = this.now(), out = []; for (const [i, r] of this.drives) { if (r.t1 < now) this.drives.delete(i); else out.push(r); } return out; }
  peopleList() { return this.people.map((p, i) => this.publicPerson(p, i)); }
  agentInfo(i) {
    const a = this.agents[i]; if (!a || !a.plan) return null;
    const now = this.now(), p = a.p, B = this.world.buildings;
    const e = evalPlan(a.plan, now);
    const needs = this.brain.needsAt(a, now, {});
    const act = a.act, j = p.job || {};
    const ag = !!p.vip && this.agentShown(p.agentId);
    const jobPlace = (j.b ?? -1) >= 0 && B[j.b] ? this.brain.placeName(j.b, j.f) : '';
    const r = x => Math.round(x * 100) / 100;
    return {
      i, id: p.id, name: p.name, vip: ag ? p.vip : 0, emoji: ag ? p.emoji : '', role: ag ? p.role : '', agentId: ag ? p.agentId : '', app: p.app,
      job: { kind: j.kind || 'free', title: this.publicTitle(j, ag), b: j.b ?? -1, f: j.f ?? -1, start: j.start ?? null, end: j.end ?? null, place: jobPlace },
      home: p.home ? { b: p.home.b, f: p.home.f, u: p.home.u, place: this.brain.placeName(p.home.b, p.home.f), name: B[p.home.b]?.name || '' } : null,
      post: ag && p.post ? { b: p.post.b, f: p.post.f, place: this.brain.placeName(p.post.b, p.post.f), since: p.post.since || null } : null,
      sched: p.sched, traits: p.tr,
      needs: Object.fromEntries(Object.entries(needs).map(([k, v]) => [k, r(v)])),
      act: act ? { label: act.label, icon: act.icon, use: act.use, kind: act.kind, place: act.place, holdStart: act.holdStart, holdEnd: act.holdEnd, travelEnd: act.travelEnd, b: act.b, f: act.f } : null,
      pos: { x: r(e.x), y: r(e.y), z: r(e.z), ctx: e.ctx }, moving: !!(e.s && !e.s.h),
      presence: p.vip ? this.presence.info(p.agentId) : null, now,
    };
  }
  updatePerson(i, patch) {
    const a = this.agents[i]; if (!a) return null;
    if (patch.name) a.p.name = patch.name;
    if (patch.app) a.p.app = patch.app;
    this.emit({ t: 'person', i, person: this.publicPerson(a.p, i) });
    return this.publicPerson(a.p, i);
  }
  talk(i, x, z) {
    const a = this.agents[i]; if (!a) return null;
    const prev = a.act ? { ...a.act } : null;
    const secs = this.brain.wm(4);
    const ok = this.brain.talkTo(a, x, z, secs);
    const text = dialogLine(this, a, a.rng, prev, a.p.vip ? this.presence.info(a.p.agentId) : null);
    this.emit({ t: 'say', i, text, until: this.now() + Math.min(14, Math.max(7, secs * 0.6)) });
    return { ok, text };
  }
  /** An AI agent stopping to talk with someone in person (a talk in the city, server/agent-talk/): it turns to (x, z) and
   *  stays `secs` - no line of its own and nothing shown to others (what it says is its answer, seen only by whom it talks
   *  with); while it talks it is not called away to work on a message (index.mjs: presence). False when it can't (asleep). */
  hold(i, x, z, secs = this.brain.wm(10), label = '', withIdx = null) {
    const a = this.agents[i]; if (!a) return false;
    const marked = this.brain.bookmark(a);   // (after the talk it goes back to what it was doing: Brain.resumeActivity)
    const ok = this.brain.talkTo(a, x, z, secs, label, withIdx);
    if (ok) a.talkUntil = this.now() + secs;
    else if (marked) a.resume = null;
    return ok;
  }
  command(i, cmd) { const a = this.agents[i]; if (!a) return false; return this.brain.command(a, cmd); }
  /** An order from a connected agent's own AI (server/agent-world.js): { kind, venue, minutes } → { ok, why }. */
  order(i, o) { const a = this.agents[i]; if (!a || !a.plan) return { ok: false, why: 'no_body' }; return this.brain.order(a, o); }
  endOrder(i) { const a = this.agents[i]; return !!(a && this.brain.endOrder(a)); }
  orderOf(i) { const a = this.agents[i]; return a ? this.brain.liveOrder(a, this.now()) : null; }
  /** How its last order ended (until its next order), or null. */
  orderEndedOf(i) { const a = this.agents[i]; if (a) this.brain.liveOrder(a, this.now()); return a?.orderEnded || null; }
  /** Posts AI agent i at a piece of furniture around the clock ({ b, f, id, k, since }), or lets it go (null): it goes
   *  there, or back to its day, at once; everyone sees it (server/agent-posts/). */
  setPost(i, post) {
    const a = this.agents[i]; if (!a) return false;
    if (post) a.p.post = { b: post.b, f: post.f, id: post.id, k: post.k, since: post.since }; else delete a.p.post;
    a.resume = null;
    this.brain.interruptSoon(a);
    this.emit({ t: 'person', i, person: this.publicPerson(a.p, i) });
    return true;
  }

  // ------------------------------------------------------------------ world edits support
  /** Interrupt every agent that is (or will soon be) on any floor using level lv, or inside building b. */
  touchAgents(pred, jumpFn = null) {
    const now = this.now();
    let n = 0;
    for (const a of this.agents) {
      if (!a.plan) continue;
      let hit = false;
      const e = evalPlan(a.plan, now);
      if (pred(e.ctx)) hit = true;
      else for (const s of a.plan.segs) if (pred(s.ctx)) { hit = true; break; }
      if (!hit) continue;
      this.brain.interruptSoon(a, jumpFn ? jumpFn(a, e) : null);
      n++;
    }
    return n;
  }
  /**
   * Furniture changed (server/world/edit.js softTouch: ctx → [{ b, f, id, pts: [{ x, z, r }] }]): re-plan only the people
   * using one of those pieces or holding a place at it, those standing (or lying) where a piece was or now is, and those
   * walking on that floor (a new way round it) - everyone else carries on (a sleeper sleeps on). skip: floors already
   * re-planned as a whole.
   */
  touchUsers(soft, skip = new Set()) {
    const now = this.now();
    let n = 0;
    for (const a of this.agents) {
      if (!a.plan) continue;
      const e = evalPlan(a.plan, now);
      if (skip.has(e.ctx)) continue;
      let hit = false;
      for (const [ctx, list] of soft) {
        for (const c of list) {
          const act = a.act;
          if (act && act.b === c.b && act.f === c.f && act.id === c.id) hit = true;
          else if (a.res && a.res.startsWith(`${c.b}:${c.f}:${c.id}:`)) hit = true;
          else if (e.ctx === ctx && c.pts.some(p => Math.hypot(e.x - p.x, e.z - p.z) < p.r)) hit = true;
          else if (e.ctx === ctx && e.s && !e.s.h) hit = true;   // walking there: a new way round the furniture
          if (hit) break;
        }
        if (hit) break;
      }
      if (!hit) continue;
      this.brain.interruptSoon(a, null);
      n++;
    }
    return n;
  }
  revalidateOne(a) { return validatePerson(this.world, this.index, a.p); }
  addPeople(list) {
    const out = [];
    for (const p of list) {
      this.people.push(p);
      const i = this.people.length - 1;
      this.agents.push(makeAgent(i, p, this.seed));
      out.push(i);
    }
    return out;
  }
  revalidatePeople() {
    let n = 0;
    for (const a of this.agents) if (validatePerson(this.world, this.index, a.p)) { n++; this.emit({ t: 'person', i: a.i, person: this.publicPerson(a.p, a.i) }); }
    return n;
  }
  buildingOccupancy(b) {
    const now = this.now(), floors = {};
    let total = 0;
    for (const a of this.agents) {
      if (!a.plan) continue;
      const e = evalPlan(a.plan, now);
      if (e.ctx >= 0 && ctxB(e.ctx) === b) { const f = ctxF(e.ctx); floors[f] = (floors[f] || 0) + 1; total++; }
    }
    let residents = 0, workers = 0;
    for (const p of this.people) {
      if (p.home && p.home.b === b) residents++;
      if (p.job && p.job.b === b && p.job.id !== undefined) workers++;
    }
    return { total, floors, residents, workers };
  }
  health() {
    const counts = { out: 0, inside: 0, under: 0, moving: 0 };
    const now = this.now();
    for (const a of this.agents) {
      if (!a.plan) continue;
      const e = evalPlan(a.plan, now);
      if (e.ctx === -2) counts.under++; else if (e.ctx < 0) counts.out++; else counts.inside++;
      if (e.s && !e.s.h) counts.moving++;
    }
    return { agents: this.agents.length, ...counts, stats: this.stats, heap: this.heap.size, errors: this.errorCount, lastErrors: this.errors.slice(-8),
      presence: { ok: !!this.presence.ok, source: this.presence.source || '', working: this.presence.workingList ? this.presence.workingList() : [] },
      clock: this.clockInfo(), mem: Math.round(process.memoryUsage().rss / 1048576) };
  }
}
export { ctxB, ctxF, worldSeconds };
