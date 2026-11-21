// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI agents working a shift as a game, as players do (2026-11-17, the product owner: "If the player can do it then AI agents should also
// be able to do it"). A player works a role at a venue — barista, chef, server, cashier, trainer (shared/work.js, the work
// modules; server/economy/jobs.js, the core: the venue's real customers' tickets, a person's pace, pay × stars, tips,
// experience, reviews) — on the shift board, playing each order's steps (client/js/ui/work.js). Agents could work one only
// through the bearer Agent API (a connected agent sending its own inputs, or "auto"), and on a post (server/agent-posts/:
// paid hours, no orders); the decision model had no way to it. The registry's source 'work' here is that way:
//
// - What: a shift in a role the venue needs, at an open place near it (on its own: it walks there) or, out with its owner,
//   the place they are in (beside them: "work the counter while I have my coffee") — the place takes agents' shifts
//   (its staffing), has a place free in that role, and its owner allows it work (the economy's agent scopes, as the Agent
//   API asks). "Work a shift as Barista at «Pour Decisions» (about 6 min; your barista level 2; 3.10 VC a world hour × your
//   stars; 2 customers waiting)".
// - Worked for real: its body walks there and takes a free place behind the counter (a staff slot, held for it as a
//   resident's: else beside one), with the staff clip; the shift is the core's own (jobs.start, mode 'play'), each order
//   played by the work bot at its level in that role (shared/work-bot.js: from what a player's panel shows — never the
//   server's answer —, at a person's pace: the core refuses anything faster), sent as raw inputs and scored by the core
//   (stars, a customer's tip, a review, experience); at the end (its time up, asked, its owner walking off, its body
//   given something else) the core ends and pays it — wages for the time worked × its stars, tips, tax withheld — into
//   its own wallet.
// - Seen and said: "Working as Barista" as what it is doing; a bubble for a five-star order, a review, and its pay; its
//   owner's page told (a toast) when it starts and how it went; its diary.
// Nothing here draws a simulation random number: the city's routines are unchanged (tools/sim-digest.mjs).
import { evalPlan } from '../sim/plan.js';
import { isOpen } from '../sim/agents.js';
import { A } from '../../shared/anims.js';
import { USE_ID, USES } from '../../shared/catalog.js';
import { ctxOf, ctxB, ctxF, floorAt } from '../../shared/constants.js';
import { toWorld, bRot } from '../../shared/geom.js';
import { ROLES, levelOf } from '../../shared/work.js';
import { workOrder } from '../../shared/work-bot.js';
import { RNG } from '../../shared/rng.js';
import { vc } from '../economy/ledger.js';

export const TICK_MS = 500;
export const NEAR_M = 150;      // m: places this close to an agent on its own (it walks there)
export const LEAVE_M = 45;      // m: its owner this far from the place (or driving off): it ends its shift and goes with them
export const SHIFT_MIN = 6;     // real minutes a shift lasts unless it says otherwise
export const MAX_MIN = 30;      // …at most
export const GO_MS = 180000;    // real ms: the longest walk there before it gives up
const PER_KIND = 2;             // places offered at once (the nearest)
const WAIT_S = 90;              // sim s: in its place, waiting for its shift to begin (the watch begins it within a tick)
const U = USE_ID;
const clean = (s, n = 60) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const starsOf = n => (n > 0 ? '★'.repeat(Math.round(n)) : 'no stars');

export class WorkPlay {
  /**
   * @param {object} o
   * @param {() => object} o.econ      the economy's core (server/economy/economy.js: parts.jobs, parts.businesses, parts.agents)
   * @param {() => object} o.sim       the running Sim
   * @param {object} o.agents          the agent registry (get, byKey)
   * @param {object} o.players         server/world/players.js Players (byId, nav)
   * @param {() => object} o.companions server/companions/companions.js (playerLead, remark)
   * @param {(i, text) => void} [o.say]            a line in a bubble over body i (not voiced)
   * @param {(accountId, frame) => void} [o.toAccount] a frame to an account's pages
   * @param {(agentId, kind, text, o) => void} [o.note] a line in an agent's diary (server/senses/ note)
   */
  constructor({ econ, sim, agents, players, companions = () => null, ctxOf = () => null, say = () => {}, toAccount = () => {}, note = () => {}, now = () => Date.now(), log = null }) {
    Object.assign(this, { econOf: econ, simOf: sim, agents, players, companionsOf: companions, ctxOf, say, toAccount, note, now, log });
    this.working = new Map();   // agent id → its shift: { agent, i, name, owner, mode ('own' | 'with'), phase ('going' | 'working'), biz, role, … }
    this.timer = null;
    this.stats = { started: 0, orders: 0, ended: 0, refused: 0 };
  }
  get sim() { return this.simOf(); }
  get econ() { return this.econOf(); }
  get jobs() { return this.econ?.parts?.jobs || null; }
  attach() { this.timer = setInterval(() => { try { this.tick(); } catch (e) { this.log?.warn?.('[work-play] tick failed:', e.stack || e.message); } }, TICK_MS); this.timer.unref?.(); return this; }
  stop() { clearInterval(this.timer); this.timer = null; }

  // ------------------------------------------------------------------------------------------------ the places
  /** Why agent id may not work now (in words), or null: its owner's allowing it (the economy's scopes), a shift on. */
  mayWork(agentId) {
    const J = this.jobs, E = this.econ;
    if (!J || !E || !E.enabled?.() || E.paused?.()) return 'the economy is switched off here (no shifts to work)';
    try { E.parts.agents?.check?.(agentId, 'work', 0, { approved: true }); } catch (e) { return clean(e.message, 120).replace(/^Your owner/, 'your owner'); }
    if (this.working.has(agentId)) return 'it is working a shift already';
    try { if (J.of({ kind: 'agent', id: agentId }).active) return 'it is working a shift already'; } catch { /* none */ }
    return null;
  }
  /** Its level in a role (the core's experience): 1 … */
  levelIn(agentId, role) { try { const x = this.jobs.of({ kind: 'agent', id: agentId }).xp.find(r => r.role === role); return x ? x.level : 1; } catch { return 1; } }
  /** The roles a business needs worked with a place free now (the shift board's own count): [{ role, free, wage }]. */
  openRoles(biz) {
    let row = null; try { row = this.jobs.board().find(x => x.business.id === biz.id) || null; } catch { row = null; }
    return (row?.roles || []).filter(r => r.free > 0 && ROLES[r.role]).map(r => ({ role: r.role, free: r.free, wage: r.wage }));
  }
  /** Whether business biz takes an agent's shift now: open, its staffing, a floor in the world. */
  takes(biz) {
    if (!biz || biz.status !== 'open' || !(biz.f >= 0) || !this.jobs.rolesAt(biz.kind).length) return false;
    if ((biz.settings?.staffing || {}).agents === false) return false;
    const B = this.sim?.brain?.W?.buildings?.[biz.b];
    return !!B && !B.gone && isOpen(biz.kind, this.econ.hourOf());
  }
  placeOf(biz) { return clean(biz?.name || this.sim?.brain?.placeName?.(biz.b, biz.f) || 'the place', 50); }

  // ------------------------------------------------------------------------------------------------ the registry
  source() {
    return { id: 'work', kinds: ['work', 'stop'], notes: true, near: ctx => this.near(ctx), run: (ctx, aff, params) => this.run(ctx, aff, params) };   // (notes: its diary lines are its own)
  }
  /** The cooking role near ctx's body (a chef's shift: the work that is cooking), as its affordance — or null. */
  cookingShift(ctx) { return (this.near(ctx) || []).find(x => x.kind === 'work' && /:chef$/.test(x.key)) || null; }
  /**
   * A plain command from its owner (the reflex — server/companions/ busy handlers): "let's cook" where there is no Order Up
   * kitchen but a kitchen to work in — a chef's shift, the cooking there is; "stop cooking" ends it. → { ok, action, text,
   * brain } or null (not this one's).
   */
  command(P, rec, action, via = 'chat', ctxOf = null) {
    if (action !== 'cook' && action !== 'uncook') return null;
    const ctx = (ctxOf || this.ctxOf)(rec);
    if (!ctx?.a) return null;
    const aff = action === 'uncook' ? (this.near(ctx) || []).find(x => x.kind === 'stop') : this.cookingShift(ctx);
    if (!aff) return null;
    const r = this.run({ ...ctx, via }, aff, { via });
    return { ok: !!r.ok, action, text: r.text, brain: r.brain };
  }
  near(ctx) {
    const out = [], rec = ctx?.rec, a = ctx?.a, sim = this.sim;
    if (!rec || !a?.plan || !sim || !this.jobs) return out;
    const w = this.working.get(rec.id);
    if (w) {
      const role = ROLES[w.role];
      out.push({ key: 'stop', kind: 'stop', label: `End your shift (${role.label} at «${w.place}»${w.phase === 'working' ? `: ${w.done} ${w.done === 1 ? role.unit : role.units}${w.done ? `, ${(w.stars / w.done).toFixed(1)}★` : ''} so far` : ', on the way there'} — paid for the time worked)`,
        where: { x: w.x, z: w.z, ctx: w.ctx, place: w.place }, cost: null, effects: {}, withLeader: w.mode === 'with', d: 0 });
      return out;
    }
    if (a.ride || this.mayWork(rec.id)) return out;
    const lead = ctx.leader && !ctx.leader.gone && ctx.leader.kind === 'player' && a.order?.kind === 'follow' ? ctx.leader : null;
    if (lead?.car) return out;
    const me = ctx.me, bz = this.econ.parts.businesses, W = sim.brain.W, list = [];
    for (const biz of bz.open()) {
      if (!this.takes(biz)) continue;
      const B = W.buildings[biz.b];
      // (beside its owner: the place they are in; on its own: near it)
      if (lead) { if (!(lead.ctx >= 0 && ctxB(lead.ctx) === biz.b && ctxF(lead.ctx) === biz.f)) continue; list.push({ biz, B, d: Math.hypot(B.x - me.x, B.z - me.z) }); continue; }
      const d = me.ctx >= 0 && ctxB(me.ctx) === biz.b ? 0 : Math.hypot(B.x - me.x, B.z - me.z);
      if (d <= NEAR_M) list.push({ biz, B, d });
    }
    list.sort((p, q) => p.d - q.d);
    const minutes = SHIFT_MIN;
    for (const { biz, B, d } of list.slice(0, PER_KIND)) {
      const waiting = this.jobs.waiting(biz.id);
      for (const r of this.openRoles(biz)) {
        const role = ROLES[r.role], lv = this.levelIn(rec.id, r.role);
        out.push({ key: `${biz.id}:${r.role}`, kind: 'work', label: `Work a shift as ${role.label} at «${this.placeOf(biz)}» (about ${minutes} min; your ${role.label.toLowerCase()} level ${lv}; ${vc(r.wage)} a world hour × your stars${waiting ? `; ${waiting} ${waiting === 1 ? 'customer' : 'customers'} waiting` : ''}${lead ? `, where ${clean(lead.name, 40)} is` : ''})`,
          where: { x: B.x, z: B.z, ctx: ctxOf(biz.b, biz.f), place: this.placeOf(biz) }, cost: null, effects: { rate: USES.staff?.rate || null, once: null, words: 'pays wages' }, withLeader: false, d: Math.round(d), biz: biz.id, role: r.role });
      }
    }
    return out;
  }
  run(ctx, aff, params = {}) {
    const rec = ctx?.rec, a = ctx?.a, kind = aff?.kind, name = clean(rec?.name || 'It', 40);
    const no = (text, brain) => { this.stats.refused++; return { ok: false, kind, text, brain }; };
    if (!rec || !a?.plan || !this.sim) return no(`${name} has no body here`, 'your body is not in the city right now');
    if (!this.jobs) return no('There is no economy here', 'there are no shifts to work here');
    if (kind === 'stop') {
      const w = this.working.get(rec.id);
      if (!w) return no(`${name} isn't working a shift`, 'you are not working a shift now');
      const r = this.end(w, 'asked');
      return { ok: true, kind, text: `${name} ends the shift${r?.pay != null ? `: ${vc(r.pay)}` : ''}`, brain: r ? `you ended your shift: ${w.done} ${w.done === 1 ? ROLES[w.role].unit : ROLES[w.role].units}, paid ${vc(r.pay)} into your wallet` : 'you ended your shift (nothing had been worked yet)', effects: {} };
    }
    if (kind !== 'work') return no('Nothing like that to do here', 'there is nothing like that to do here');
    const why = this.mayWork(rec.id);
    if (why) return no(`${name} can't work now: ${why}`, `you can't work a shift now: ${why}`);
    const biz = this.econ.parts.businesses.get(aff.biz);
    if (!this.takes(biz)) return no(`«${this.placeOf(biz)}» has no shift for ${name} now`, `«${this.placeOf(biz)}» isn't taking an agent's shift now (closed, or it doesn't take agents)`);
    if (!this.openRoles(biz).some(r => r.role === aff.role)) return no(`Every ${ROLES[aff.role]?.label.toLowerCase() || 'such'} place at «${this.placeOf(biz)}» is taken`, `every ${ROLES[aff.role]?.label.toLowerCase() || 'such'} place at «${this.placeOf(biz)}» is taken now`);
    const minutes = Math.max(1, Math.min(MAX_MIN, Number(params.minutes) > 0 ? Number(params.minutes) : SHIFT_MIN));
    const lead = ctx.leader && !ctx.leader.gone && ctx.leader.kind === 'player' && a.order?.kind === 'follow' ? ctx.leader : null;
    const w = { agent: rec.id, i: ctx.i, name, owner: ctx.owner ?? rec.ownerId ?? null, mode: lead ? 'with' : 'own', leader: lead?.account ?? null, biz: biz.id, role: aff.role, place: this.placeOf(biz),
      b: biz.b, f: biz.f, ctx: ctxOf(biz.b, biz.f), x: 0, z: 0, phase: 'going', since: this.now(), minutes, order: a.order || null, act: null, arrive: 0, session: null, done: 0, stars: 0, tips: 0,
      rng: new RNG(`work:${rec.id}:${biz.id}:${aff.role}:${this.now()}`), level: this.levelIn(rec.id, aff.role), via: params.via || ctx.via || 'asked' };
    if (!this.walkIn(w, a)) return no(`${name} can't get to «${w.place}» from here`, `there is no way from where you are to «${w.place}» just now`);
    this.working.set(rec.id, w);
    if (this.sim.now() >= w.arrive - 0.05) this.start(w);
    if (!this.working.has(rec.id)) return no(w.why || `${name} could not start the shift`, `you could not start the shift: ${w.why || 'it was refused'}`);
    const role = ROLES[w.role];
    if (w.phase === 'going') this.note(rec.id, 'move', `Going to «${w.place}» to work a shift as ${role.label}`, { key: 'work' });
    return { ok: true, kind, text: `${name} ${w.phase === 'going' ? 'is going to work' : 'is working'} a shift as ${role.label} at «${w.place}»`,
      brain: `you are ${w.phase === 'going' ? 'on your way to work' : 'working'} a shift as ${role.label} at «${w.place}» for about ${minutes} min: each order played at your level (${role.label.toLowerCase()} level ${w.level}), scored by the venue's own rules; wages for the time worked × your stars, and tips, go into your wallet at the end`, effects: { rate: USES.staff?.rate || null } };
  }

  // ------------------------------------------------------------------------------------------------ the companions' hook
  busyWith(a) {
    const rec = this.recOf(a?.i), w = rec ? this.working.get(rec.id) : null;
    return w ? { kind: 'work', label: w.phase === 'going' ? `Going to work at «${w.place}»` : `Working as ${ROLES[w.role].label}` } : null;
  }
  watch(a) { const rec = this.recOf(a?.i); return !!(rec && this.working.has(rec.id)); }
  recOf(i) { const p = this.sim?.people?.[i]; return p?.vip && p.agentId ? this.agents.byKey(p.agentId) : null; }
  ownerName(account) { return clean(this.players?.byId?.get(account)?.name || this.companionsOf()?.playerLead?.(account)?.name || 'your owner', 40); }

  // ------------------------------------------------------------------------------------------------ its shift
  /** Its body to a place behind the counter: a free staff place (held for it as a resident's), else beside one. */
  walkIn(w, a) {
    const sim = this.sim, brain = sim.brain, B = brain.W.buildings[w.b];
    if (!B || B.gone) return false;
    const P = brain.cut(a, sim.now() + 0.1), span = w.minutes * 60 * Math.max(0.01, sim.clock?.rate || 1) + 120;
    const at = evalPlan(a.plan, sim.now()), free = brain.freeSlots(w.b, w.f, ['staff'], a.i, [P.t, P.t + span])
      .map(e => ({ e, d: Math.hypot(toWorld(B, e[2].ax, e[2].az).x - at.x, toWorld(B, e[2].ax, e[2].az).z - at.z) })).sort((p, q) => p.d - q.d || String(p.e[0]).localeCompare(String(q.e[0])));
    let st = null;
    for (const { e } of free) { st = brain.slotBegin(a, P, w.b, w.f, e[0], e[1], { win: [P.t, P.t + span], use: 'staff', anim: A.staff }); if (st) break; }
    if (st && P.ctx !== w.ctx) { brain.unreserve(a, st.sk); brain.lookAround(a, P, brain.wm(0.5)); sim.commit(a, P); return false; }   // (no way there: its place let go)
    let arrive, info;
    if (st) { arrive = st.arrive; info = brain.slotInfo(st); w.x = st.sw.x; w.z = st.sw.z; w.yaw = st.yaw; w.slot = st; }
    else {
      // (every staff place held: beside the first one, where it can stand)
      const list = brain.index.findUsesCached(B.lv[w.f], ['staff']), s = list[0]?.[2];
      if (!s) { brain.lookAround(a, P, brain.wm(0.5)); sim.commit(a, P); w.why = `«${w.place}» has nowhere behind the counter`; return false; }
      const nav = this.players?.nav, yaw = s.yaw + bRot(B);
      let spot = null;
      for (const side of [0.75, -0.75, 1.3, -1.3]) { const p = toWorld(B, s.lx + Math.cos(s.yaw) * side, s.lz - Math.sin(s.yaw) * side); if (!nav || nav.ok(p.x, p.z, w.ctx)) { spot = { ...p, lx: s.lx + Math.cos(s.yaw) * side, lz: s.lz - Math.sin(s.yaw) * side }; break; } }
      if (!spot) spot = { ...toWorld(B, s.ax, s.az), lx: s.ax, lz: s.az };
      try { brain.router.travel(P, { ctx: w.ctx, x: spot.x, z: spot.z, lx: spot.lx, lz: spot.lz }, brain.topt(a, {}, P.t)); } catch (e) { this.log?.info?.(`[work-play] no way to ${w.b}:${w.f}: ${e.message}`); }
      if (P.ctx !== w.ctx) { brain.lookAround(a, P, brain.wm(0.5)); sim.commit(a, P); return false; }
      arrive = P.t; w.x = spot.x; w.z = spot.z; w.yaw = yaw; info = { ctx: w.ctx };
      P.seg(0.3, spot.x, floorAt(B, w.f), spot.z, yaw, A.idle, U.wait, 0, 0, w.ctx);
    }
    const role = ROLES[w.role];
    // there: waiting for its shift to begin (the watch begins it within a tick), then the whole shift in its place
    const hold = WAIT_S + span;
    if (st) brain.slotHold(a, P, st, hold, { anim: A.staff });
    else P.hold(hold, A.staff, U.staff, 0, w.yaw);
    w.act = brain.act(a, w.mode === 'with' ? 'follow' : 'shift', 'staff', P, { ...info, label: `Working as ${role.label}`, icon: role.icon, place: w.place, arrive, holdStart: arrive, holdEnd: P.t });
    w.arrive = arrive;
    sim.commit(a, P);
    return true;
  }
  /** In its place: the shift begins (the core's own), its first order. */
  start(w) {
    let s;
    try { s = this.jobs.start({ kind: 'agent', id: w.agent }, { business: w.biz, role: w.role, mode: 'play' }); }
    catch (e) { w.why = clean(e.message || 'the shift was refused', 120); return this.end(w, 'refused'); }
    w.session = s.id; w.phase = 'working'; w.startedAt = this.now(); w.due = this.now() + w.minutes * 60000;
    this.stats.started++;
    this.next(w, s);
    const role = ROLES[w.role];
    this.say(w.i, `${role.icon} On shift: ${role.label}`);
    if (w.owner != null) this.toAccount(w.owner, { t: 'crew_note', agent: w.agent, i: w.i, text: `${role.icon} ${w.name} started a shift as ${role.label} at «${w.place}»` });
    this.note(w.agent, 'activity', `Started a shift as ${role.label} at «${w.place}» (your ${role.label.toLowerCase()} level ${w.level}${w.mode === 'with' ? `, where ${this.ownerName(w.leader)} is` : ''})`, { key: 'work' });
    return true;
  }
  /** Its next order (from the core's session view), played by the work bot: sent when its time is up. */
  next(w, s) {
    const o = s?.order;
    if (!o) { w.pending = null; return; }
    const r = workOrder(o, { level: w.level, rng: w.rng });
    w.pending = { n: o.n ?? s.n, reports: r.reports, at: this.now() + r.ms, title: o.title };
  }
  tick() {
    if (!this.sim) return;
    for (const w of [...this.working.values()]) {
      try { this.step(w); } catch (e) { this.log?.warn?.('[work-play] a worker failed:', e.stack || e.message); }
    }
  }
  step(w) {
    const sim = this.sim, a = sim.agents[w.i], t = this.now();
    if (!a?.plan || sim.people[w.i]?.retired) return this.end(w, 'gone');
    if (a.act !== w.act || (a.order || null) !== w.order) return this.end(w, 'other');
    if (w.leader != null) {
      const L = this.companionsOf()?.playerLead?.(w.leader);
      if (!L || L.car || (!L.gone && !(L.ctx >= 0 && ctxB(L.ctx) === w.b) && Math.hypot(L.x - w.x, L.z - w.z) > LEAVE_M)) return this.end(w, 'leader');
    }
    if (w.phase === 'going') {
      if (sim.now() >= w.arrive) return this.start(w);
      if (t - w.since > GO_MS) return this.end(w, 'far');
      return null;
    }
    if (t >= w.due) return this.end(w, 'done');
    if (!w.pending || t < w.pending.at) return null;
    let r;
    try { r = this.jobs.act({ kind: 'agent', id: w.agent }, { session: w.session, n: w.pending.n, reports: w.pending.reports }); }
    catch (e) {
      if (e.status === 429) { w.pending.at = t + 1500; return null; }   // (a person's pace: a moment more)
      if (e.status === 409) { try { this.next(w, this.jobs.of({ kind: 'agent', id: w.agent }).active); } catch { w.pending = null; } return null; }
      return this.end(w, 'ended');   // (the shift ended meanwhile: swept, or ended elsewhere)
    }
    this.stats.orders++;
    const res = r.result || {}, role = ROLES[w.role];
    w.done++; w.stars += res.stars || 0; w.tips += res.tip || 0;
    if (res.review) this.say(w.i, `${role.icon} “${clean(res.review.text, 80)}” — ${res.review.by}, ${starsOf(res.review.stars)}`);
    else if (res.stars === 5 && w.rng.chance(0.35)) this.say(w.i, `${role.icon} ${clean(res.title || w.pending.title, 40)} — ${starsOf(5)}${res.tip ? ' + a tip' : ''}`);
    this.next(w, r.session);
    return r;
  }
  /** Its shift over (its time up, asked, its owner gone off, its body given something else, refused): the core ends and
   *  pays it; said. */
  end(w, why) {
    this.working.delete(w.agent);
    this.stats.ended++;
    w.stopped = why;
    this.last = w;
    const role = ROLES[w.role];
    let r = null;
    if (w.session) {
      try { r = this.jobs.end({ kind: 'agent', id: w.agent }, { session: w.session }); }
      catch (e) { this.log?.info?.(`[work-play] ${w.name}'s shift: ${e.message}`); }
    }
    w.result = r ? { pay: r.pay, owed: r.owed, served: w.done, avgStars: r.avgStars, tips: r.tips } : null;
    const who = w.leader != null ? this.ownerName(w.leader) : 'your owner';
    const words = { done: 'its time was up', asked: 'you ended it', leader: `${who} left`, other: 'you went to do something else', gone: 'you left the city', far: `you never got to «${w.place}»`, refused: w.why || 'it was refused', ended: 'it had ended' }[why] || why;
    if (r) {
      const paid = r.pay > 0 ? `${vc(r.pay)}` : r.owed > 0 ? `${vc(r.owed)} owed by the venue` : 'nothing (too short to pay)';
      this.say(w.i, `${role.icon} Shift done: ${w.done} ${w.done === 1 ? role.unit : role.units}${w.done ? `, ${(w.stars / w.done).toFixed(1)}★` : ''} — ${paid}`);
      if (w.owner != null) this.toAccount(w.owner, { t: 'crew_note', agent: w.agent, i: w.i, tone: r.pay > 0 ? 'good' : '', text: `${role.icon} ${w.name} worked a shift as ${role.label} at «${w.place}»: ${w.done} ${w.done === 1 ? role.unit : role.units}${w.done ? `, ${(w.stars / w.done).toFixed(1)}★ average` : ''} — paid ${paid}` });
      this.note(w.agent, 'activity', `Worked a shift as ${role.label} at «${w.place}» (${words}): ${w.done} ${w.done === 1 ? role.unit : role.units}${w.done ? `, ${(w.stars / w.done).toFixed(1)}★ average` : ''}${w.tips ? `, ${vc(w.tips)} in tips` : ''} — paid ${paid} into your wallet`, { key: 'work' });
    } else if (why !== 'other') this.note(w.agent, 'activity', `Didn't work at «${w.place}»: ${words}`, { key: 'work' });
    const a = this.sim?.agents?.[w.i];
    if (a?.plan && why !== 'other' && why !== 'gone') this.release(w, a);
    return r;
  }
  release(w, a) {
    const brain = this.sim.brain;
    if (a.order?.kind === 'follow') { brain.reorder(a, true); return; }
    try { brain.interruptSoon(a); } catch (e) { this.log?.warn?.('[work-play] on with its day:', e.message); }
  }
  view(agentId) {
    const w = this.working.get(Number(agentId));
    return w ? { agent: w.agent, mode: w.mode, phase: w.phase, role: w.role, biz: w.biz, place: w.place, session: w.session, done: w.done, stars: w.done ? Math.round(w.stars / w.done * 10) / 10 : null, ends: w.due || null } : null;
  }
}
