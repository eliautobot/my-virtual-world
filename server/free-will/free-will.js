// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Free Will (docs/features/FREE-WILL.md §2): an agent whose owner switched it on lets a decision service choose what it
// does with its free time, from the options the world offers.
//
// - Ask ahead, never wait. When an agent's plan is committed (Sim.commit), its next choice point is the end of that plan.
//   A few real seconds before it, the agent's state at that moment is predicted (needs, place, hour); if a routine would
//   apply (sleep, work, a meal: Brain.reflexAt) nothing is asked; otherwise the options are built and one request goes
//   out. When the simulation reaches the choice point (Brain.leisure → take()) it uses the answer if it is there, for
//   this plan, and still possible; otherwise the routine chooses, and the why-log says why. The simulation never waits.
// - One pick from the answer's probabilities, sharpened or flattened by the agent's spontaneity (./sampling.js).
// - Every paid request and every choice point is written to the why-log (agent_decisions) in batches.
// - Spending is bounded: an installation-wide daily number of decisions, a per-agent daily number, a limit on requests in
//   flight; a decision service that keeps failing is left alone for a while (a circuit breaker, per connection).
// - Who may use what: an agent uses the decision connection its owner chose, or the installation's default; the owner
//   must be allowed to use that connection (Connections.level), and the connection must be an enabled decision service.
import { Breakers } from '../providers/breaker.js';
import { MinHeap } from '../sim/minheap.js';
import { RNG, hashStr } from '../../shared/rng.js';
import { WEEKDAYS, formatClock, mod, ctxOf } from '../../shared/constants.js';
import { isDecisionKind } from '../providers/manifest.js';
import { buildChoice, stillPossible, choicePossible, placeOf, describeVenue } from './options.js';
import { decisionRequest } from './prompt.js';
import { drawChoice } from './sampling.js';

export const ASK_AHEAD_S = 5;          // real seconds before a choice point that the question goes out
export const MIN_WINDOW_MS = 400;      // less time than this before the choice point: not worth asking
export const MAX_TIMEOUT_MS = 8000;    // a decision that takes longer is useless anyway
export const MAX_IN_FLIGHT = 32;
export const RECENT_PER_AGENT = 3;     // "Earlier today" lines in the snapshot
/** How much of an agent's spontaneity goes into each kind of choice: it shapes free time fully, how it does its job
 *  hardly (an impulsive agent still works on a task the sensible way, mostly). */
export const SPONTANEITY_SHARE = Object.freeze({ leisure: 1, meal: 0.8, morning: 0.8, rest: 0.6, after_task: 0.5, shift: 0.4, task: 0.3 });
const VK = 1048576;                    // like Sim's heap values: version * VK + agent index
const FLUSH_MS = 2000;
const REBUILD_MS = 60000;
const BREAKER = { after: 5, baseMs: 30000, maxMs: 600000 };
const LONG_TRIP = new Set(['auth', 'quota']);   // failures a retry in seconds will not fix

export class FreeWillError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const utcDay = ms => new Date(ms).toISOString().slice(0, 10);
const r3 = v => Math.round(v * 1000) / 1000;

export class FreeWill {
  /**
   * @param {object} o
   * @param {{ db: object, worldId: string, tx: function }} o.dbs
   * @param {object} o.agents         server/agents.js Agents
   * @param {object} o.connections    server/connections.js Connections
   * @param {object} o.registry       server/providers/registry.js Registry
   * @param {(connection, request, timeoutMs) => Promise<{answers, usage, ms}>} o.decide  one call to a decision service
   * @param {() => object} o.sim      the running Sim
   * @param {() => object|null} [o.econ]  { canSpend, venueFactor, price, rating, money } or null (the economy is off)
   * @param {(accountId|null) => object|null} o.principalFor  the principal an agent's owner acts as (null: the installation's owner)
   * @param {() => { enabled, defaultConnection, dailyDecisions, agentDailyDecisions, keepDays }} o.config
   * @param {(agentId) => object|null} [o.context]  who the agent is and what it lived (server/agent-life/: contextFor)
   * @param {{ get(agentId): number, set(agentId, value, actorId) }} [o.spontaneity]  where spontaneity lives (a
   *   character trait of the agent's profile); without it, the Free Will settings keep it
   */
  constructor({ dbs, agents, connections, registry, decide, sim, econ = () => null, principalFor, config, context = null, spontaneity = null, log = null, now = () => Date.now(), rand = null }) {
    Object.assign(this, { dbs, agents, connections, registry, decideFn: decide, simOf: sim, econOf: econ, principalFor, configFn: config, contextFn: context, spontStore: spontaneity, log, now });
    this.w = dbs.worldId;
    this.rand = rand;                       // tests make draws repeatable; otherwise each agent has its own generator
    this.byPerson = new Map();              // resident index → active entry
    this.status = new Map();                // agent id → { active, reason } (shown to owners)
    this.heap = new MinHeap();              // when to ask (sim time) → version * VK + index
    this.pending = new Map();               // index → a request in flight
    this.ready = new Map();                 // index → an answer (or error) waiting for its choice point
    this.notAsked = new Map();              // index → { ver, reason }: why nothing was asked for this plan
    this.taking = new Map();                // index → the why-log row of a choice being carried out
    // a decision service that keeps failing is left alone a while; one with no credit or a refused key only briefly,
    // then one trial request (../providers/breaker.js): a refilled account decides again within minutes
    this.br = new Breakers({ after: BREAKER.after, baseMs: BREAKER.baseMs, maxMs: BREAKER.maxMs, longCodes: [...LONG_TRIP], now: () => this.now(), log: this.log, name: 'decision service' });
    this.inFlight = 0;
    this.rows = [];
    this.day = null; this.dayCalls = 0; this.dayCost = 0; this.agentCalls = new Map();
    this.stats = { asked: 0, answered: 0, chosen: 0, routine: 0, unused: 0, skippedRoutine: 0, reasons: {}, latency: [] };
    this.cfgAt = 0; this.cfg = null;
    const db = dbs.db;
    this.q = {
      settings: db.prepare('SELECT * FROM agent_free_will WHERE world_id = ?'),
      one: db.prepare('SELECT * FROM agent_free_will WHERE world_id = ? AND agent_id = ?'),
      put: db.prepare(`INSERT INTO agent_free_will (world_id, agent_id, enabled, connection_id, spontaneity, updated, updated_by)
        VALUES ($w, $agent, $enabled, $conn, $spont, $at, $by)
        ON CONFLICT (world_id, agent_id) DO UPDATE SET enabled = excluded.enabled, connection_id = excluded.connection_id,
          spontaneity = excluded.spontaneity, updated = excluded.updated, updated_by = excluded.updated_by`),
      row: db.prepare(`INSERT INTO agent_decisions (world_id, agent_id, at, world_time, place, outcome, reason, choice, chosen, chosen_label, options_json,
        probs_json, confidence, connection_id, latency_ms, input_tokens, cost_micro) VALUES ($w, $agent, $at, $wt, $place, $outcome, $reason,
        $choice, $chosen, $label, $options, $probs, $conf, $conn, $lat, $tok, $cost)`),
      log: db.prepare('SELECT * FROM agent_decisions WHERE world_id = ? AND agent_id = ? AND id < ? ORDER BY id DESC LIMIT ?'),
      today: db.prepare(`SELECT agent_id, COUNT(*) AS n, COALESCE(SUM(cost_micro), 0) AS cost FROM agent_decisions
        WHERE world_id = ? AND at >= ? AND input_tokens IS NOT NULL GROUP BY agent_id`),
      agentToday: db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(cost_micro), 0) AS cost,
        SUM(CASE WHEN outcome = 'chosen' THEN 1 ELSE 0 END) AS chosen FROM agent_decisions WHERE world_id = ? AND agent_id = ? AND at >= ?`),
      purge: db.prepare('DELETE FROM agent_decisions WHERE world_id = ? AND at < ?'),
    };
    this.loadToday();
    this.timers = [];
    this.onAgentsChanged = () => this.rebuild();
  }

  /** Starts Free Will on the running simulation: the commit hook, the choice hook (sim.freeWill), timers. */
  attach() {
    const sim = this.sim;
    sim.freeWill = this;
    sim.onCommit = (a, P) => this.onCommit(a, P);
    this.agents.listeners?.add(this.onAgentsChanged);
    this.timers = [setInterval(() => this.flush(), FLUSH_MS), setInterval(() => this.rebuild(), REBUILD_MS), setInterval(() => this.purge(), 3600000)];
    for (const t of this.timers) t.unref?.();
    this.rebuild();
    return this;
  }

  // ------------------------------------------------------------------------------------------- configuration
  /** Forget the cached configuration (the installation's Free Will settings changed). */
  invalidate() { this.cfgAt = -Infinity; this.config(); }
  config() {
    const t = this.now();
    if (!this.cfg || t - this.cfgAt > 2000) {
      const prev = this.cfg;
      this.cfg = this.configFn(); this.cfgAt = t;
      // the installation's switch or decision service changed (Settings): who is active changes with it, right away
      if (prev && (prev.enabled !== this.cfg.enabled || String(prev.defaultConnection) !== String(this.cfg.defaultConnection))) setImmediate(() => this.rebuild());
    }
    return this.cfg;
  }
  get sim() { return this.simOf(); }

  /** An agent's own switch: { enabled, connectionId (null: the installation's default), spontaneity }. */
  settingsOf(agentId) {
    const r = this.q.one.get(this.w, Number(agentId));
    const own = r ? { enabled: !!r.enabled, connectionId: r.connection_id ?? null, spontaneity: r.spontaneity } : { enabled: false, connectionId: null, spontaneity: 0.5 };
    if (this.spontStore) own.spontaneity = this.spontStore.get(Number(agentId)) ?? own.spontaneity;
    return own;
  }

  /** The decision connections an agent's owner may choose from: [{ id, label, kind, isDefault }]. */
  choicesFor(ownerP) {
    const def = Number(this.config().defaultConnection) || null;
    return this.connections.list()
      .filter(c => c.enabled && isDecisionKind(this.registry.manifest(c.kind)) && this.connections.canUse(ownerP, c))
      .map(c => ({ id: c.id, label: c.label, kind: c.kind, isDefault: c.id === def, implemented: this.registry.implemented(c.kind) }));
  }

  /** The connection an agent would use, or { reason } why it has none. */
  resolveConnection(agent, row) {
    const ownerP = this.principalFor(agent.ownerId);
    if (!ownerP) return { reason: 'no_owner' };
    const id = row.connectionId ?? (Number(this.config().defaultConnection) || null);
    if (!id) return { reason: 'no_service' };
    const c = this.connections.get(id);
    if (!c || !c.enabled) return { reason: 'no_service' };
    const m = this.registry.manifest(c.kind);
    if (!isDecisionKind(m)) return { reason: 'no_service' };
    if (!this.registry.implemented(c.kind)) return { reason: 'service_unavailable' };
    if (!this.connections.canUse(ownerP, c)) return { reason: 'not_allowed' };
    return { connection: c, price: Number(c.config.priceInPerMTok ?? m.fields.find(f => f.key === 'priceInPerMTok')?.default ?? 0) };
  }

  /** A new agent starts with Free Will on (the product owner, 2026-10-10: on by default; its owner may switch it off). An
   *  agent that already has a switch keeps it. */
  startOn(agent) {
    if (!agent || this.q.one.get(this.w, agent.id)) return;
    this.q.put.run({ $w: this.w, $agent: agent.id, $enabled: 1, $conn: null, $spont: 0.5, $at: this.now(), $by: null });
    this.rebuild();
  }
  /** Changes an agent's switch (the route checked who may). Returns the new settings. */
  setSettings(agent, patch, actorId) {
    const cur = this.settingsOf(agent.id);
    const next = { ...cur };
    if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
    if (patch.spontaneity !== undefined) {
      const s = Number(patch.spontaneity);
      if (!Number.isFinite(s) || s < 0 || s > 1) throw new FreeWillError(400, 'bad_spontaneity', 'Spontaneity is a number from 0 to 1');
      next.spontaneity = Math.round(s * 100) / 100;
    }
    if (patch.connectionId !== undefined) {
      if (patch.connectionId === null) next.connectionId = null;
      else {
        const ownerP = this.principalFor(agent.ownerId);
        const c = this.connections.get(patch.connectionId);
        if (!c || !ownerP || !this.connections.canUse(ownerP, c)) throw new FreeWillError(404, 'not_found', 'No such decision service');
        if (!isDecisionKind(this.registry.manifest(c.kind))) throw new FreeWillError(400, 'not_a_decision_service', `${c.label} is not a decision service`);
        next.connectionId = c.id;
      }
    }
    if (patch.spontaneity !== undefined && this.spontStore) this.spontStore.set(agent.id, next.spontaneity, actorId);
    this.q.put.run({ $w: this.w, $agent: agent.id, $enabled: next.enabled ? 1 : 0, $conn: next.connectionId, $spont: next.spontaneity, $at: this.now(), $by: actorId ?? null });
    this.rebuild();
    return this.settingsOf(agent.id);
  }

  /** Recomputes which residents have Free Will now. Cheap; runs on changes and every minute. */
  rebuild() {
    const sim = this.sim;
    if (!sim) return;
    const next = new Map(), status = new Map(), cfg = this.config();
    for (const r of this.q.settings.all(this.w)) {
      if (!r.enabled) continue;
      const a = this.agents.get(r.agent_id);
      if (!a || !a.enabled) { status.set(r.agent_id, { active: false, reason: 'agent_off' }); continue; }
      const i = a.bodyRef ? this.agents.resolver.resolveBody(a.bodyRef) : -1;
      const p = i >= 0 ? sim.people[i] : null;
      if (!p || p.retired || !sim.agents[i]) { status.set(a.id, { active: false, reason: 'no_body' }); continue; }
      const res = this.resolveConnection(a, { connectionId: r.connection_id ?? null });
      if (!res.connection) { status.set(a.id, { active: false, reason: res.reason }); continue; }
      if (!cfg.enabled) { status.set(a.id, { active: false, reason: 'off' }); continue; }
      const old = this.byPerson.get(i);
      next.set(i, {
        agentId: a.id, key: a.key, name: a.name, role: a.role || p.role || '', connection: res.connection, price: res.price,
        spontaneity: this.spontStore ? (this.spontStore.get(a.id) ?? r.spontaneity) : r.spontaneity,
        rng: old?.rng && old.agentId === a.id ? old.rng : new RNG(hashStr(`fw:${a.key}:${this.now()}`)),
        recent: old?.agentId === a.id ? old.recent : [],
      });
      status.set(a.id, { active: true, reason: null });
    }
    // residents that just lost Free Will: their pending work is dropped (the routine simply carries on)
    for (const i of this.byPerson.keys()) if (!next.has(i)) { this.ready.delete(i); this.notAsked.delete(i); }
    if (next.size !== this.byPerson.size || status.size !== this.status.size) {
      const waiting = [...status.values()].filter(x => !x.active).reduce((m, x) => (m[x.reason] = (m[x.reason] || 0) + 1, m), {});
      this.log?.info?.(`[free-will] ${next.size} agent(s) choosing for themselves${Object.keys(waiting).length ? `; switched on but waiting: ${Object.entries(waiting).map(([k, n]) => `${n} ${k}`).join(', ')}` : ''}`);
    }
    this.byPerson = next; this.status = status;
  }

  /** Whether resident index i has Free Will right now (Brain.leisure asks this at every free-time choice). */
  isActive(i) { return this.byPerson.has(i); }

  // ------------------------------------------------------------------------------------------- asking ahead
  /** Sim.commit hook: a new plan for resident a; its end is the next choice point. */
  onCommit(a, P) {
    if (!this.byPerson.has(a.i)) return;
    const sim = this.sim;
    this.ready.delete(a.i);   // an answer for an earlier plan is no use for this one
    this.notAsked.delete(a.i);
    const ahead = ASK_AHEAD_S * Math.max(1, sim.clock.rate);
    this.heap.push(P.t - sim.lead() - ahead, a.ver * VK + a.i);
  }

  /** Called by the server's main loop after Sim.tick: sends the questions that are due. */
  tick() {
    const sim = this.sim;
    if (!sim) return;
    this.config();   // notices a changed switch or service within two seconds
    const now = sim.now();
    while (this.heap.size && this.heap.peekKey() <= now) {
      const v = this.heap.pop(), i = v % VK, ver = Math.floor(v / VK);
      const a = sim.agents[i];
      if (!a || a.ver !== ver || !a.plan || !this.byPerson.has(i)) continue;
      try { this.ask(a, now); } catch (e) { this.log?.warn?.('[free-will] preparing a decision failed:', e.message); this.skip(a, 'error'); }
    }
  }

  skip(a, reason) { this.notAsked.set(a.i, { ver: a.ver, reason }); this.bump(reason); }
  bump(reason) { this.stats.reasons[reason] = (this.stats.reasons[reason] || 0) + 1; }

  rollDay() {
    const d = utcDay(this.now());
    if (d !== this.day) { this.day = d; this.dayCalls = 0; this.dayCost = 0; this.agentCalls.clear(); }
  }
  loadToday() {
    this.rollDay();
    const since = Date.parse(`${this.day}T00:00:00Z`);
    for (const r of this.q.today.all(this.w, since)) { this.agentCalls.set(r.agent_id, r.n); this.dayCalls += r.n; this.dayCost += r.cost; }
  }

  breakerOpen(connId) { return this.br.open(connId); }
  breakerFail(connId, code) { this.br.fail(connId, code); }
  breakerOk(connId) { this.br.ok(connId); }

  /** Predicts the agent's choice point at the end of its plan and, when it is free time, asks. */
  ask(a, now) {
    const sim = this.sim, brain = sim.brain, e = this.byPerson.get(a.i), cfg = this.config();
    const P = a.plan, T = P.t;
    const needs = brain.needsAt(a, Math.max(T, now), {});
    const h = brain.hour(T), day = brain.day(T);
    // what kind of choice is coming: free time, or a routine moment the agent decides how to handle (a task, a meal, the
    // morning, the way to work, rest); sleep and the like are left to the routine (nothing to ask)
    // (its own outside AI gave it something to do until later: nothing to ask)
    if (a.order && a.order.until > T) return this.skip(a, 'order');
    // (it goes back to what a message interrupted: nothing to decide)
    if (a.resume && brain.resumeValid(a, P, T, needs)) return this.skip(a, 'resume');
    const rid = brain.reflexAt(a, P, h, day, needs);
    const type = rid ? brain.choiceType(rid, a, P, T) : 'leisure';
    if (!type) { this.stats.skippedRoutine++; return; }
    if (!cfg.enabled) return this.skip(a, 'off');
    const conn = e.connection;
    if (this.breakerOpen(conn.id)) return this.skip(a, 'service_paused');
    this.rollDay();
    if (this.dayCalls >= cfg.dailyDecisions) return this.skip(a, 'daily_limit');
    if ((this.agentCalls.get(e.agentId) || 0) >= cfg.agentDailyDecisions) return this.skip(a, 'agent_daily_limit');
    if (this.inFlight >= MAX_IN_FLIGHT) return this.skip(a, 'busy');
    const leadS = (T - sim.lead() - now) / Math.max(1e-6, sim.clock.rate);
    const windowMs = Math.min(MAX_TIMEOUT_MS, leadS * 1000 - 150);
    if (windowMs < MIN_WINDOW_MS) return this.skip(a, 'no_time');
    const home = a.p.home, atHome = !!(home && P.ctx === ctxOf(home.b, home.f));
    const at = { x: P.x, z: P.z, ctx: P.ctx, h, day, needs, atHome };
    const econ = this.econOf();
    const options = buildChoice(type, brain, a, at, econ, P);
    if (options.length < 2) return this.skip(a, 'one_option');
    const ctx = this.contextFn ? this.contextFn(e.agentId) : null;
    if (ctx) {
      // how well it knows each place: curious agents look for new ones, creatures of habit go back to their favourites
      for (const o of options) if (o.venue) { o.visits = ctx.familiarity(`${o.b}.${o.f}`); o.label = describeVenue(o.kind, o); }
      e.spontaneity = ctx.spontaneity ?? e.spontaneity;
    }
    const snap = {
      name: e.name || a.p.name, role: e.role, tr: a.p.tr, needs, h, day, place: placeOf(brain, P.ctx), atHome, job: a.p.job,
      money: econ && econ.money ? econ.money(a.p) : null,
      recent: ctx ? ctx.earlier : e.recent.filter(r => r.day === day).slice(-RECENT_PER_AGENT),
      // what a message interrupted and it can't simply go back to: carrying on is natural unless something matters more
      ...(a.resume && a.resume.until > T ? { interrupted: { label: a.resume.label, place: a.resume.place, until: brain.hour(a.resume.until) } } : {}),
      ...(ctx ? { personality: ctx.personality, bio: ctx.bio, purpose: ctx.purpose, aspirations: ctx.aspirations, likes: ctx.likes, dislikes: ctx.dislikes, plans: ctx.plans, memories: ctx.memories, worries: ctx.worries } : {}),
    };
    snap.type = type;
    const request = decisionRequest(snap, options);
    // (the last check before it goes: a paused service's single trial request is this one, or none)
    if (!this.br.allow(conn.id)) return this.skip(a, 'service_paused');
    const ver = a.ver, t0 = this.now();
    this.inFlight++; this.dayCalls++; this.agentCalls.set(e.agentId, (this.agentCalls.get(e.agentId) || 0) + 1); this.stats.asked++;
    const job = { ver, T, type, options, t0, connId: conn.id, price: e.price, agentId: e.agentId, place: snap.place, when: `${WEEKDAYS[mod(day, 7)]} ${formatClock(h)}`, late: null };
    this.pending.set(a.i, job);
    Promise.resolve()
      .then(() => this.decideFn(conn, request, Math.round(windowMs)))
      .then(res => this.answered(a.i, job, res), err => this.failed(a.i, job, err))
      .finally(() => { this.inFlight--; if (this.pending.get(a.i) === job) this.pending.delete(a.i); });
  }

  cost(job, res) {
    const tok = Number.isFinite(res?.usage?.inputTokens) ? res.usage.inputTokens : null;
    return { tok, micro: tok === null ? null : Math.round(tok * job.price) };
  }

  answered(i, job, res) {
    const ms = this.now() - job.t0, { tok, micro } = this.cost(job, res);
    this.breakerOk(job.connId);
    this.stats.answered++;
    this.stats.latency.push(ms); if (this.stats.latency.length > 2000) this.stats.latency.splice(0, 1000);
    if (micro) this.dayCost += micro;
    const answer = (res?.answers || []).find(x => x && x.name === 'next_action');
    const allowed = new Set(job.options.map(o => o.id));
    let out;
    if (!answer || answer.type === 'refusal') out = { error: 'refused' };
    else {
      const e = this.byPerson.get(i);
      const rand = this.rand || (() => (e ? e.rng.next() : Math.random()));
      const pick = drawChoice(answer, allowed, (e ? e.spontaneity : 0.5) * (SPONTANEITY_SHARE[job.type] ?? 1), rand);
      out = pick ? { pick: pick.value, conf: Number.isFinite(answer.confidence) ? answer.confidence : null,
        probs: (answer.probabilities || []).filter(x => allowed.has(x.value)).map(x => ({ id: x.value, p: r3(Number(x.probability) || 0) })) } : { error: 'invalid_answer' };
    }
    this.settle(i, job, { ...out, ms, tok, micro });
  }

  failed(i, job, err) {
    const code = (err && err.code) || 'provider_error';
    if (code === 'bad_request') { this.log?.warn?.('[free-will] a decision service refused a request as malformed - check the connection\'s model setting'); this.breakerOk(job.connId); }
    else this.breakerFail(job.connId, code);
    this.settle(i, job, { error: code === 'timeout' ? 'timeout' : `service_${code}`, ms: this.now() - job.t0, tok: null, micro: null });
  }

  /** An answer (or failure) arrived: kept for its choice point, or logged now when the choice point has passed. */
  settle(i, job, r) {
    const sim = this.sim, a = sim && sim.agents[i];
    if (job.late) {   // the choice point came first and the routine chose: log that, with what this request cost
      this.record({ ...job.late, outcome: 'routine', reason: 'late', probs: r.probs, conf: r.conf, ms: r.ms, tok: r.tok, micro: r.micro });
      return;
    }
    if (!a || a.ver !== job.ver || !this.byPerson.has(i)) {   // the plan changed (interrupted, Free Will off): paid for, not used
      if (r.tok !== null) this.record({ agentId: job.agentId, type: job.type, when: job.when, place: job.place, options: job.options, connId: job.connId,
        outcome: 'unused', reason: 'plan_changed', probs: r.probs, conf: r.conf, ms: r.ms, tok: r.tok, micro: r.micro });
      this.stats.unused++;
      return;
    }
    this.ready.set(i, { ...r, job });
  }

  // ------------------------------------------------------------------------------------------- at the choice point
  /**
   * At a choice point of the given type (Brain.choose; Brain.leisure for free time): { type, kind, venue, option } to carry
   * out, or null (the routine does it; the reason is logged). live = the routine's free-time options now ([[kind, w]]).
   */
  take(a, P, h, day, type, live = null) {
    const e = this.byPerson.get(a.i);
    if (!e) return null;
    const base = { agentId: e.agentId, type, when: `${WEEKDAYS[mod(day, 7)]} ${formatClock(h)}`, place: placeOf(this.sim.brain, P.ctx), connId: e.connection.id };
    const r = this.ready.get(a.i);
    if (r && r.job.ver === a.ver) {
      this.ready.delete(a.i);
      const row = { ...base, type: r.job.type, options: r.job.options, probs: r.probs, conf: r.conf, ms: r.ms, tok: r.tok, micro: r.micro, connId: r.job.connId };
      if (r.job.type !== type) { this.routine(row, 'situation_changed'); return null; }   // it asked about something else
      if (r.error) { this.routine(row, r.error); return null; }
      // the pick, or when it is no longer possible (the café filled up), the next most likely option of the same answer
      const first = r.job.options.find(x => x.id === r.pick);
      const ranked = [first, ...(r.probs || []).filter(x => x.id !== r.pick).sort((x, y) => y.p - x.p).map(x => r.job.options.find(o => o.id === x.id))].filter(Boolean);
      for (const o of ranked) {
        let venue = null, option = o;
        if (type === 'leisure') {
          const v = stillPossible(this.sim.brain, a, o, live || [], { ctx: P.ctx, x: P.x, z: P.z });
          if (!v) continue;
          venue = v === true ? null : v;
        } else {
          const c = choicePossible(this.sim.brain, a, type, o, P, h);
          if (!c) continue;
          venue = c.venue; if (c.way) option = { ...o, way: c.way };
        }
        this.taking.set(a.i, { ...row, chosen: o.id, label: o.label, day, next: o !== first ? first?.label : null });
        return { type, kind: o.kind, venue, option };
      }
      this.routine({ ...row, chosen: r.pick, label: first?.label }, 'not_possible');
      return null;
    }
    const pend = this.pending.get(a.i);
    if (pend && pend.ver === a.ver) {   // still in flight: the routine decides; the request's outcome is logged when it settles
      pend.late = { ...base, type: pend.type, options: pend.options };
      this.stats.routine++; this.bump('late');
      return null;
    }
    const na = this.notAsked.get(a.i);
    this.routine({ ...base, options: [] }, na && na.ver === a.ver ? na.reason : 'not_asked');
    return null;
  }

  routine(row, reason) {
    this.stats.routine++; this.bump(reason);
    // choice points the agent was never asked about are counted, not logged one by one, unless something went wrong
    if (reason === 'not_asked' || reason === 'one_option') return;
    this.record({ ...row, outcome: 'routine', reason });
  }

  /** Brain.leisure after trying the pick: ok = it is being carried out. */
  done(a, pick, ok) {
    const row = this.taking.get(a.i);
    this.taking.delete(a.i);
    if (!row) return;
    if (!ok) { this.routine(row, 'could_not_do'); return; }
    this.stats.chosen++;
    if (row.next) this.bump('next_best');
    this.record({ ...row, outcome: 'chosen', reason: row.next ? 'next_best' : null });
    const e = this.byPerson.get(a.i);
    if (e) { e.recent.push({ day: row.day, clock: row.when.split(' ').slice(1).join(' '), label: shortLabel(pick.option) }); if (e.recent.length > 12) e.recent.splice(0, e.recent.length - 12); }
  }

  // ------------------------------------------------------------------------------------------- the why-log
  record(x) {
    this.rows.push({
      $w: this.w, $agent: x.agentId, $at: this.now(), $wt: x.when || null, $place: x.place || null, $outcome: x.outcome, $reason: x.reason ?? null, $choice: x.type || 'leisure',
      $chosen: x.chosen ?? null, $label: x.label ?? null,
      $options: JSON.stringify((x.options || []).map(o => ({ id: o.id, kind: o.kind, label: o.label, w: r3(o.w) }))),
      $probs: x.probs ? JSON.stringify(x.probs) : null, $conf: Number.isFinite(x.conf) ? r3(x.conf) : null, $conn: x.connId ?? null,
      $lat: Number.isFinite(x.ms) ? Math.round(x.ms) : null, $tok: Number.isFinite(x.tok) ? x.tok : null, $cost: Number.isFinite(x.micro) ? x.micro : null,
    });
    if (this.rows.length >= 2000) this.flush();
  }
  flush() {
    if (!this.rows.length) return;
    const rows = this.rows; this.rows = [];
    try { this.dbs.tx(() => { for (const r of rows) this.q.row.run(r); }); }
    catch (e) { this.log?.error?.('[free-will] writing the why-log failed:', e.message); }
  }
  purge() {
    const days = Math.max(1, Number(this.config().keepDays) || 7);
    try { this.q.purge.run(this.w, this.now() - days * 86400000); } catch (e) { this.log?.warn?.('[free-will] pruning the why-log failed:', e.message); }
  }

  /** The why-log of one agent, newest first: up to limit rows older than before (an id). */
  decisions(agentId, { before = null, limit = 50 } = {}) {
    this.flush();
    const lim = Math.max(1, Math.min(200, Number(limit) || 50));
    return this.q.log.all(this.w, Number(agentId), Number(before) > 0 ? Number(before) : Number.MAX_SAFE_INTEGER, lim).map(r => ({
      id: r.id, at: r.at, when: r.world_time, place: r.place, outcome: r.outcome, reason: r.reason, choice: r.choice || 'leisure', chosen: r.chosen, label: r.chosen_label,
      options: safeJson(r.options_json, []), probs: safeJson(r.probs_json, null), confidence: r.confidence, latencyMs: r.latency_ms,
      inputTokens: r.input_tokens, costMicro: r.cost_micro,
    }));
  }

  /** Today's numbers for one agent (UTC day): requests, chosen, cost (millionths of a US$). */
  agentToday(agentId) {
    this.flush();
    this.rollDay();
    const r = this.q.agentToday.get(this.w, Number(agentId), Date.parse(`${this.day}T00:00:00Z`));
    return { requests: this.agentCalls.get(Number(agentId)) || 0, chosen: r?.chosen || 0, costMicro: r?.cost || 0 };
  }

  /** The service at a glance (administrators). */
  overview() {
    const lat = [...this.stats.latency].sort((x, y) => x - y), q = p => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : null);
    const cfg = this.config();
    this.rollDay();
    return {
      enabled: cfg.enabled, activeAgents: this.byPerson.size, inFlight: this.inFlight, maxInFlight: MAX_IN_FLIGHT,
      today: { requests: this.dayCalls, limit: cfg.dailyDecisions, costMicro: this.dayCost },
      latencyMs: { p50: q(0.5), p95: q(0.95), samples: lat.length },
      counts: { asked: this.stats.asked, answered: this.stats.answered, chosen: this.stats.chosen, routine: this.stats.routine, unused: this.stats.unused, skippedRoutine: this.stats.skippedRoutine },
      reasons: { ...this.stats.reasons },
      paused: this.br.list().map(b => ({ connectionId: b.id, until: b.until, code: b.code })),
    };
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.agents.listeners?.delete(this.onAgentsChanged);
    const sim = this.sim;
    if (sim && sim.freeWill === this) { sim.freeWill = null; sim.onCommit = null; }
    this.flush();
  }
}

function shortLabel(o) {
  if (!o) return '';
  if (o.name) return o.name;
  return o.label.split(/[(,]/)[0].trim().slice(0, 50);
}
function safeJson(s, fallback) { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } }
