// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Mind (docs/features/FREE-WILL.md §3–4): an agent whose brain is a model provider (its connection's kind is 'models')
// thinks — it plans its day when it wakes, reflects on it at bedtime, and answers its chats. An agent without a brain of
// its own still gets the evening reflection from the installation's brain (setting mind.reflectConnection).
//
// - One model call per thought. The world gives the agent its context — who it is, where and when it is, its job, home
//   and money, its open plans, what it remembers, the people it knows, today's activity, real places near it — and the
//   model answers with one JSON object (./prompt.js); what that answer may do is checked and carried out through the
//   agent's life as the Mind (./actions.js): plans, memories, notes on people, a small change of character, a reply.
//   No tools that reach outside the world, no free-form commands.
// - The plans reach the world through Free Will: its decision service hears the day's plans with every choice (and the
//   places are named as Free Will names them), so an agent that planned "Lunch at «Bean There»" tends to go there.
// - Never in the way of the simulation: thoughts run in the background (the provider helper makes the call), at most
//   MAX_IN_FLIGHT at a time; the routine and Free Will go on whatever happens to a thought.
// - Bounded spending: thoughts per agent per day, US$ per agent per month, US$ per day for the installation; a brain that
//   keeps failing is left alone for a while (a circuit breaker per connection). Every thought is recorded (mind_jobs):
//   what it did, its tokens and cost — never the prompt or the model's text.
// - Who may use what: an agent thinks with its own connection only if its owner may use that connection; the
//   installation's reflection brain is the installation's (its cost is the installation's too).
import { evalPlan } from '../sim/plan.js';
import { ctxB, formatClock, mod } from '../../shared/constants.js';
import { nearestVenues } from '../free-will/options.js';
import { flagsOf } from '../agent-life/traits.js';
import { systemText, planText, reflectText, chatText, problemText, assistantSystem, workSystem, workVisitorSystem, workVisitorText, friendText } from './prompt.js';
import { closenessWords } from '../../shared/closeness.js';
import { StreamSplit, buildTurns, mediaRoom, withPdfs, PDF_PROVIDERS, parseActions, ACTIONS_MARK } from './assistant.js';
import { MODES, validZone, serverZone, realTime } from '../agent-work/work.js';
import { Breakers, pausedWords } from '../providers/breaker.js';
import { parseAnswer, readActions, applyActions } from './actions.js';
import { toolbox, resultsText, MAX_ROUNDS } from './tools.js';
import { joinTools, PC_ROUNDS } from '../pc/agent-tools.js';
import { speechText, localCheck } from './speech.js';

export const MAX_IN_FLIGHT = 16;            // thoughts at once (each a model call of about a second): 1,000 agents waking together plan within a minute or two
export const TIMEOUT_MS = 45000;
// A brain that thinks before it answers (its connection's Thinking) takes longer: this much more time for one thought.
// A line said out loud in passing (speech) is a quick reaction and never waits on thinking.
const THINK_MS = { off: 0, low: 15000, medium: 30000, high: 45000 };
const LEVELS = Object.keys(THINK_MS);
/** Whether a completion stopped at its length limit (OpenAI-compatible 'length', Anthropic 'max_tokens'). */
const cutOff = res => res?.finish === 'length' || res?.finish === 'max_tokens';
const TICK_MS = 1000;
const SCAN_PER_TICK = 250;              // agents looked at per pass (1,000 agents: each every 4 s — a world minute)
const RETRY_MS = 90000;                 // a failed plan or reflection is tried again after this, within its window
const MAX_TRIES = 3;                    // … at most this often for one world day
const THINK_NOW_MS = 60000;             // an owner's "plan now" / "reflect now": each once a minute per agent
const CHAT_WAIT_MS = 20000;             // a chat waits this long for a free slot
const CHAT_QUEUE_MS = 180000;           // an owner's chat waits in line (first come, first served) at most this long
const MAX_CHATS = 48;                   // owners' chats answered at once (their own slots: a long answer never holds up the world's thinking)
const CHAT_TOKENS = 8000;               // the longest answer in the chat window
const CHAT_CALL_MS = 600000;            // … and the longest it may take (a streamed answer; Stop ends it at once)
const DELTA_MS = 60;                    // pieces of an answer are sent on this often (a few hundred characters at a time)
const BREAKER = { after: 4, baseMs: 60000, maxMs: 1800000 };
const LONG_TRIP = new Set(['auth', 'quota', 'blocked']);
const JOB = { plan: { maxTokens: 500, temperature: 0.7 }, reflect: { maxTokens: 700, temperature: 0.6 }, chat: { maxTokens: 600, temperature: 0.8 }, problem: { maxTokens: 500, temperature: 0.5 }, speech: { maxTokens: 120, temperature: 0.9 }, friend: { maxTokens: 300, temperature: 0.8 } };
const SPEECH_GAP_MS = 20000;            // an agent says its own words at most this often (a player clicking "Talk" again and again); the admin's mind.speechGapSeconds
const SPEECH_ROOM = 4;                  // thoughts at once kept free of speech (a line is the least of what a Mind does: plans and problems first)
const SPEECH_WAIT_MS = 6000;            // someone spoke to it while it was thinking: it answers when it is done, if that is soon
const MODERATORS = new Set(['openai', 'custom']);
const PROBLEM_THOUGHTS = 3;             // thoughts about its problems per agent per world day (a new problem may bring another)
const PLACE_KINDS = ['cafe', 'restaurant', 'park', 'shop', 'gym'];
const PRICE_ITEM = { cafe: 'cafe_lunch', restaurant: 'meal' };
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOW = r => closenessWords(r.affinity, { ended: !!r.ended });   // (shared/closeness.js: one scale for the server and the pages)

export class MindError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const utcDay = ms => new Date(ms).toISOString().slice(0, 10);
const utcMonthStart = ms => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const utcDayStart = ms => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export class Mind {
  /**
   * @param {object} o
   * @param {{ db: object, worldId: string }} o.dbs
   * @param {object} o.agents, o.connections, o.registry   the server's agents, connections and provider registry
   * @param {(connection, request) => Promise<{ text, usage, costUsd, model, ms }>} o.complete  one model call (the helper)
   * @param {() => object} o.sim       the running Sim
   * @param {object} o.life            server/agent-life/life.js AgentLife
   * @param {() => object|null} [o.econ]  { money(p) } or null (the economy is off)
   * @param {() => object|null} [o.money] server/economy/mind-money.js while the economy is on: its tools' money
   * @param {object} [o.problems]      server/mind/problems.js (what goes wrong in its life)
   * @param {(accountId, message) => void} [o.notify]  tells an owner what its agent wants them to know
   * @param {(connection, text) => Promise<{ flagged, categories }>} [o.moderate]  the moderation service (the helper)
   * @param {(i, text) => void} [o.say]  shows a line in body i's speech bubble, to everyone near it
   * @param {(accountId|null) => object|null} o.principalFor
   * @param {object} [o.bus]           the provider event bus (chat runs report through it)
   * @param {() => { enabled, reflectConnection, agentDailyJobs, agentMonthlyUsd, dailyUsd, keepDays, chatModels, chatPerDay }} o.config
   * @param {(connection, streamId) => Promise} [o.abort]  ends a streamed answer (the chat's Stop)
   */
  constructor({ dbs, agents, connections, registry, complete, sim, life, econ = () => null, money = () => null, problems = null, notify = null, moderate = null, say = null, abort = null, principalFor, bus = null, config, log = null, now = () => Date.now() }) {
    Object.assign(this, { dbs, agents, connections, registry, completeFn: complete, simOf: sim, life, econOf: econ, moneyOf: money, problems, notify, moderateFn: moderate, sayFn: say, abortFn: abort, principalFor, bus, configFn: config, log, now });
    this.pcTools = null;   // (agent, kind, { tz }) => its PC as a tool (server/pc/agent-tools.js), set by the server
    this.chatInFlight = 0;
    this.chatQueue = [];                    // owners' chats waiting for a slot, oldest first: { go, fail, timer }
    this.chatDay = new Map();               // agent id → owners' chat answers today (UTC)
    this.w = dbs.worldId;
    this.inFlight = 0;
    this.busy = new Set();                  // agent ids thinking now
    this.tries = new Map();                 // `${agentId}:${kind}:${day}` → { n, next }
    this.thinkNowAt = new Map();            // `${agentId}:${kind}` → when its owner last asked it to think now
    // a brain that keeps failing is left alone a while; one that has no credit or a refused key only briefly, and a
    // person's own chat may try it at once (../providers/breaker.js): a refilled account answers the moment it has funds
    this.br = new Breakers({ after: BREAKER.after, baseMs: BREAKER.baseMs, maxMs: BREAKER.maxMs, longCodes: [...LONG_TRIP], now: () => this.now(), log: this.log, name: 'brain' });
    this.chats = new Map();                 // runId → { stopped }
    this.problemDay = new Map();            // `${agentId}:${lifeDay}` → thoughts about its problems that world day (or Infinity: given up)
    this.speechDay = new Map();             // `${agentId}:${lifeDay}` → lines it tried to say that world day
    this.speechAt = new Map();              // agent id → when it last tried to say something
    this.spoke = new Map();                 // a pair of people (and a world day) who already talked: the first speaks, the other answers
    this.speechStats = { shown: 0, blocked: 0, local: 0, unchecked: 0 };
    this.day = null; this.dayCost = 0; this.agentJobs = new Map();
    this.month = null; this.agentMonth = new Map();
    this.stats = { ok: 0, failed: 0, skipped: 0, byKind: {}, latency: [] };
    this.stopped = false;
    this.cursor = 0;
    const db = dbs.db;
    this.q = {
      all: db.prepare('SELECT * FROM agent_mind WHERE world_id = ?'),
      put: db.prepare(`INSERT INTO agent_mind (world_id, agent_id, cadence, last_plan_day, last_reflect_day, updated, updated_by)
        VALUES ($w, $a, $cadence, $plan, $reflect, $at, $by)
        ON CONFLICT (world_id, agent_id) DO UPDATE SET cadence = excluded.cadence, last_plan_day = excluded.last_plan_day,
          last_reflect_day = excluded.last_reflect_day, updated = excluded.updated, updated_by = excluded.updated_by`),
      job: db.prepare(`INSERT INTO mind_jobs (world_id, agent_id, account_id, kind, world_day, at, status, error, connection_id, model, in_tok, out_tok,
        cost_micro, ms, summary_json) VALUES ($w, $a, $acc, $kind, $day, $at, $status, $error, $conn, $model, $in, $out, $cost, $ms, $summary)`),
      jobs: db.prepare('SELECT * FROM mind_jobs WHERE world_id = ? AND agent_id = ? AND id < ? ORDER BY id DESC LIMIT ?'),
      since: db.prepare(`SELECT agent_id, COUNT(*) AS n, COALESCE(SUM(cost_micro), 0) AS cost FROM mind_jobs
        WHERE world_id = ? AND at >= ? AND status != 'skipped' GROUP BY agent_id`),
      agentSince: db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(cost_micro), 0) AS cost, COALESCE(SUM(in_tok), 0) AS tin, COALESCE(SUM(out_tok), 0) AS tout
        FROM mind_jobs WHERE world_id = ? AND agent_id = ? AND at >= ? AND status != 'skipped'`),
      byKind: db.prepare(`SELECT kind, status, COUNT(*) AS n, COALESCE(SUM(cost_micro), 0) AS cost FROM mind_jobs WHERE world_id = ? AND at >= ? GROUP BY kind, status`),
      purge: db.prepare('DELETE FROM mind_jobs WHERE world_id = ? AND at < ?'),
    };
    this.rows = new Map(this.q.all.all(this.w).map(r => [r.agent_id, r]));
    this.roll();
    this.timers = [];
  }

  attach() {
    this.timers = [setInterval(() => this.tick(), TICK_MS), setInterval(() => this.purge(), 3600000)];
    for (const t of this.timers) t.unref?.();
    return this;
  }
  stop() { this.stopped = true; for (const t of this.timers) clearInterval(t); this.timers = []; }
  get sim() { return this.simOf(); }
  config() { return this.configFn(); }

  // ------------------------------------------------------------------------------------------- spending
  /** Today's and this month's totals, from the record, when the UTC day or month turns (and at start). */
  roll() {
    const t = this.now(), d = utcDay(t), m = utcMonthStart(t);
    if (this.day !== d) {
      this.day = d; this.agentJobs = new Map(); this.dayCost = 0; this.chatDay = new Map();
      for (const r of this.q.since.all(this.w, utcDayStart(t))) { this.agentJobs.set(r.agent_id, r.n); this.dayCost += r.cost; }
    }
    if (this.month !== m) { this.month = m; this.agentMonth = new Map(this.q.since.all(this.w, m).map(r => [r.agent_id, r.cost])); }
  }
  /** Why agent `agentId` may not think now (a limit reached), or null. */
  limited(agentId) {
    this.roll();
    const c = this.config();
    if (this.dayCost >= c.dailyUsd * 1e6) return 'installation_daily_limit';
    if ((this.agentMonth.get(agentId) || 0) >= c.agentMonthlyUsd * 1e6) return 'agent_monthly_limit';
    if ((this.agentJobs.get(agentId) || 0) >= c.agentDailyJobs) return 'agent_daily_limit';
    return null;
  }
  costOf(c, res) {
    if (Number.isFinite(res.costUsd)) return Math.round(res.costUsd * 1e6);
    const pin = Number(c.config.priceInPerMTok) || 0, pout = Number(c.config.priceOutPerMTok) || 0;   // US$ per million tokens = millionths of a dollar per token
    return Math.round((res.usage?.in || 0) * pin + (res.usage?.out || 0) * pout);
  }
  breakerOpen(connId) { return this.br.open(connId); }
  /** Whether a model call may go out now (the trial of a paused brain is marked; see ../providers/breaker.js). */
  breakerAllow(connId, o) { return this.br.allow(connId, o); }
  breakerFail(connId, code) { this.br.fail(connId, code); }
  breakerOk(connId) { this.br.ok(connId); }
  breakerRelease(connId) { this.br.release(connId); }
  /** Why its brain is held back, in one line for a person (no credit, a refused key, not answering), or null. */
  pausedText(agent, connId) { const st = this.br.state(connId); return st ? pausedWords(agent.name, st) : null; }

  // ------------------------------------------------------------------------------------------- who thinks with what
  /** The brain agent `agent` thinks with: its own (its connection is a model provider its owner may use) or the
   *  installation's reflection brain; { connection, own } or { reason }. memo: lookups shared by one pass of the
   *  scheduler (a connection or an owner is read once per pass, not once per agent). */
  brainOf(agent, memo = null) {
    const conn = id => (memo ? (memo.c.has(id) ? memo.c.get(id) : memo.c.set(id, this.connections.get(id)).get(id)) : this.connections.get(id));
    const own = agent.connectionId ? conn(agent.connectionId) : null;
    if (own && own.kind === 'models') {
      if (!own.enabled) return { reason: 'brain_off' };
      if (!this.registry.implemented('models')) return { reason: 'unavailable' };
      const k = agent.ownerId ?? 0, ownerP = memo ? (memo.p.has(k) ? memo.p.get(k) : memo.p.set(k, this.principalFor(agent.ownerId)).get(k)) : this.principalFor(agent.ownerId);
      if (!ownerP || !this.connections.canUse(ownerP, own)) return { reason: 'not_allowed' };
      return { connection: own, own: true };
    }
    const id = Number(this.config().reflectConnection) || null, c = id ? conn(id) : null;
    if (!c || c.kind !== 'models' || !c.enabled || !this.registry.implemented('models')) return { reason: 'no_brain' };
    return { connection: c, own: false };
  }
  settingsOf(agentId) {
    const r = this.rows.get(agentId);
    return { cadence: r ? r.cadence : 'daily', lastPlanDay: r?.last_plan_day ?? null, lastReflectDay: r?.last_reflect_day ?? null };
  }
  save(agentId, patch, by = null) {
    const cur = this.settingsOf(agentId), next = { ...cur, ...patch };
    const row = { $w: this.w, $a: agentId, $cadence: next.cadence, $plan: next.lastPlanDay, $reflect: next.lastReflectDay, $at: this.now(), $by: by };
    this.q.put.run(row);
    this.rows.set(agentId, { agent_id: agentId, cadence: next.cadence, last_plan_day: next.lastPlanDay, last_reflect_day: next.lastReflectDay });
  }
  setSettings(agent, { cadence }, actorId) {
    if (!['off', 'daily'].includes(cadence)) throw new MindError(400, 'bad_cadence', 'cadence is "off" or "daily"');
    this.save(agent.id, { cadence }, actorId ?? null);
    return this.settingsOf(agent.id);
  }
  /** What the owner sees: whether the agent thinks, with which brain, and why not. */
  statusOf(agent) {
    const cfg = this.config(), b = this.brainOf(agent), set = this.settingsOf(agent.id);
    const c = b.connection;
    const brain = c ? { id: c.id, label: c.label, own: b.own, provider: c.config.provider || 'openrouter', model: c.config.model || '' } : null;
    let reason = null;
    if (!cfg.enabled) reason = 'mind_off';
    else if (set.cadence === 'off') reason = 'switched_off';
    else if (!c) reason = b.reason;
    else if (this.breakerOpen(c.id)) reason = 'brain_paused';
    else reason = this.limited(agent.id);
    const speaks = !!(b.own && cfg.speech && this.moderator());
    return { thinks: !reason, reason, brain, does: c ? (b.own ? ['plan', 'reflect', 'chat', 'problems', ...(speaks ? ['speech'] : [])] : ['reflect']) : [], hasBody: this.life.byAgent?.has(agent.id) ?? false };
  }

  // ------------------------------------------------------------------------------------------- when to think
  /** The world day an agent's day belongs to (its day runs from waking to waking), and where it is in it. */
  dayOf(i) {
    const sim = this.sim, a = sim.agents[i], p = sim.people[i], B = sim.brain, t = sim.now();
    const h = B.hour(t), d = B.day(t), wake = p.sched?.wake ?? 7, bed = (p.sched?.bed ?? 23) % 24;
    // (on post it is up around the clock — its needs wait, server/sim/agents.js postDuty: never asleep by its usual hours,
    // so a friend's message and someone talking to it are answered at night too)
    return { lifeDay: h >= wake ? d : d - 1, h, asleep: !!(a && !p.post && B.sleepTime(a, h)), toBed: mod(bed - h, 24) };
  }
  /** One pass of the scheduler: up to SCAN_PER_TICK agents (in turn, so every agent is looked at every few seconds
   *  however many there are) — whose day starts get a plan, whose bedtime came a reflection. */
  tick() {
    if (this.stopped) return;
    const cfg = this.config(), sim = this.sim;
    if (!cfg.enabled || !sim || !this.life.byAgent) return;
    const list = this.agents.enabled(), n = list.length, memo = { c: new Map(), p: new Map() };
    if (!n) return;
    const start = this.cursor % n, count = Math.min(n, SCAN_PER_TICK);
    this.cursor = (start + count) % n;
    for (let k = 0; k < count; k++) {
      const agent = list[(start + k) % n];
      if (this.inFlight >= MAX_IN_FLIGHT) return;
      if (this.busy.has(agent.id)) continue;
      const i = this.life.byAgent.get(agent.id);
      if (i === undefined || !sim.agents[i] || !sim.people[i] || sim.people[i].retired) continue;
      const set = this.settingsOf(agent.id);
      if (set.cadence === 'off') continue;
      const b = this.brainOf(agent, memo);
      if (!b.connection) continue;
      const { lifeDay, asleep, toBed } = this.dayOf(i);
      // on post (its owner posted it at a desk or counter around the clock — server/agent-posts/): no plan for a day it
      // can't live and no evening reflection on it (2026-10-14, the product owner); its money problems still get a
      // thought. Let go, it plans and reflects again from that day on.
      const posted = !!sim.people[i].post;
      let kind = null;
      if (b.own && !asleep && this.problemDue(agent.id, lifeDay)) kind = 'problem';
      else if (!posted && b.own && !asleep && toBed > 1.5 && (set.lastPlanDay ?? -1) < lifeDay) kind = 'plan';
      else if (!posted && (asleep || toBed <= 0.5) && (set.lastReflectDay ?? -1) < lifeDay) kind = 'reflect';
      if (!kind) continue;
      const key = `${agent.id}:${kind}:${lifeDay}`, tr = this.tries.get(key);
      if (tr && tr.next > this.now()) continue;
      if (this.breakerOpen(b.connection.id)) continue;
      const why = this.limited(agent.id);
      if (why) { this.skip(agent, kind, lifeDay, why, b.connection); continue; }
      this.think(agent, kind, b, { lifeDay }).catch(() => {});   // (recorded inside)
    }
  }
  /** Whether an agent's open problems wait for a thought: one not thought about this world day (a new one, or one still
   *  open from yesterday), within PROBLEM_THOUGHTS a day. */
  problemDue(agentId, lifeDay) {
    if (!this.problems) return false;
    const open = this.problems.openOf(agentId);
    if (!open.length || (this.problemDay.get(`${agentId}:${lifeDay}`) || 0) >= PROBLEM_THOUGHTS) return false;
    return open.some(r => (r.lastThoughtDay ?? -Infinity) < lifeDay);
  }
  /** A thought that will not happen today (a limit): recorded once, and the day marked so it is not tried again. */
  skip(agent, kind, lifeDay, why, c) {
    if (kind === 'problem') this.problemDay.set(`${agent.id}:${lifeDay}`, Infinity);
    else this.save(agent.id, kind === 'plan' ? { lastPlanDay: lifeDay } : { lastReflectDay: lifeDay });
    this.record(agent, kind, lifeDay, { status: 'skipped', error: why, connection: c });
  }

  // ------------------------------------------------------------------------------------------- thinking
  /**
   * One thought of agent `agent`: plan, reflect, chat or problem (o.chat: { from, isOwner, knows, history, message, work? }:
   * work — a visitor, whom its owner gave its job (CHAT.md §14.3): { brief, docs, zone }; it keeps nothing then).
   * A problem, and a chat with its owner, may use tools (./tools.js): the thought then runs in rounds — the model asks
   * for tools, gets their results, and answers — at most MAX_ROUNDS model calls. Resolves { ok, done, reply, cost, used }
   * or rejects with a MindError; always recorded.
   */
  async think(agent, kind, brain, { lifeDay = null, chat = null, speech = null, friend = null, force = false } = {}) {
    const c = brain.connection;
    this.busy.add(agent.id); this.inFlight++;
    const t0 = this.now();
    let res = null, cost = 0, tools = null, trial = false, judged = false;
    const usage = { in: 0, out: 0 };
    try {
      const ctx = this.contextOf(agent, kind);
      if (lifeDay === null) lifeDay = ctx.lifeDay;
      if (kind === 'problem') this.problemDay.set(`${agent.id}:${lifeDay}`, (this.problemDay.get(`${agent.id}:${lifeDay}`) || 0) + 1);
      const money = this.moneyOf();
      if (money && (kind === 'problem' || (kind === 'chat' && chat?.isOwner))) {
        const i = this.life.byAgent.get(agent.id);
        ctx.wallet = money.wallet(agent.id, this.sim.people[i]);
        tools = toolbox({ agent, kind, ctx, money, wallet: ctx.wallet, people: this.sim.people, idem: `mind:${agent.id}:${t0}` });
        if (!tools.names.length) tools = null;
      }
      // (someone from another account: its PC is closed, but for its Public folder — offered when there is something in it)
      const visitorPc = kind === 'chat' && !chat?.isOwner && this.pcTools ? this.pcTools(agent, 'visitor', { tz: chat?.work?.zone }) : null;
      if (visitorPc) tools = visitorPc;
      const pcMenu = visitorPc ? visitorPc.menuText() : [];
      const rounds = visitorPc ? 3 : MAX_ROUNDS;
      const atWork = kind === 'chat' && !chat?.isOwner && chat?.work;
      const user = kind === 'plan' ? planText(ctx) : kind === 'reflect' ? reflectText(ctx) : kind === 'problem' ? problemText(ctx, tools ? tools.menuText() : [])
        : kind === 'speech' ? speechText(ctx, speech) : kind === 'friend' ? friendText(ctx, friend) : atWork ? workVisitorText(chat)
        : chatText(ctx, { ...chat, doing: ctx.doing }, tools && !visitorPc ? tools.menuText() : [], pcMenu);
      const system = atWork ? workVisitorSystem(ctx, { owner: ctx.ownerName || '', work: chat.work, now: realTime(this.now(), chat.work.zone), zone: chat.work.zone, pc: pcMenu }) : systemText(ctx);
      const turns = [{ role: 'user', text: user }];
      let o = null;
      // (a paused brain: held back — a person's chat may be the trial at once when the fault was no credit or a key)
      if (!this.breakerAllow(c.id, { person: kind === 'chat', force })) throw new MindError(503, 'brain_paused', this.pausedText(agent, c.id) || 'Its brain is not answering at the moment');
      trial = true;
      let level = kind === 'speech' || kind === 'friend' ? 'off' : LEVELS.includes(c.config?.thinking) ? c.config.thinking : 'off';
      const ask = async () => {
        let r;
        try {
          r = await this.completeFn(c, { system, turns, json: true, ...JOB[kind], thinking: level, timeoutMs: TIMEOUT_MS + THINK_MS[level] });
        } catch (e) {
          const code = e.code || 'provider_error';
          if (code === 'bad_request') this.breakerOk(c.id); else this.breakerFail(c.id, code);   // (a refusal of the request is an answer: the brain works)
          judged = true;
          throw new MindError(502, code, e.message || 'The brain did not answer');
        }
        cost += this.costOf(c, r); usage.in += r.usage?.in || 0; usage.out += r.usage?.out || 0;
        this.breakerOk(c.id); judged = true;
        return r;
      };
      for (let round = 0; ; round++) {
        res = await ask();
        o = parseAnswer(res.text);
        // cut off at its length limit while thinking: asked once more at once without thinking, so the thought isn't lost
        if (!o && cutOff(res) && level !== 'off') { level = 'off'; res = await ask(); o = parseAnswer(res.text); }
        if (!o) throw cutOff(res) ? new MindError(502, 'cut_off', 'The brain\'s answer was cut off at its length limit') : new MindError(502, 'bad_answer', 'The brain\'s answer was not in the expected shape');
        const wantsTools = !!(tools && Array.isArray(o.use) && o.use.length && round < rounds - 1);
        if (atWork && !wantsTools) o = { reply: o.reply };   // (at work for a visitor: an answer, and nothing kept of its life)
        if (!wantsTools) break;
        const results = await tools.run(o.use);
        turns.push({ role: 'assistant', text: JSON.stringify({ use: o.use.slice(0, results.length) }) }, { role: 'user', text: resultsText(results, round >= rounds - 2) });
      }
      res = { ...res, usage };
      // who wrote it: a plan from its owner's chat is its owner's request; the world's brain writes as 'reflection'
      const refs = { plans: ctx.planRefs, people: ctx.peopleRefs, traits: ctx.traits, locked: ctx.locked, aspirations: ctx.aspirations, isOwner: !!chat?.isOwner, maxReply: friend?.maxChars,
        reach: ctx.reach || null, places: ctx.places,
        source: kind === 'chat' ? 'owner' : brain.own ? 'mind' : 'reflection', memorySource: brain.own ? 'mind' : 'reflection' };
      const act = readActions(kind, o, refs);
      if (kind === 'chat' && !act.reply) throw new MindError(502, 'bad_answer', 'The brain answered without a reply');
      if (kind === 'speech' && !act.say) throw new MindError(502, 'bad_answer', 'The brain answered without a line');
      const done = applyActions(this.life, agent.id, act, refs);
      // (an evening's reflection may end a friendship that went wrong: server/agent-social/, the same as its owner or an outside AI)
      if (kind === 'reflect' && act.unfriend && this.social) {
        try { const u = this.social.unfriend(agent.id, act.unfriend, { by: 'mind' }); if (u.ended) done.unfriended = u.ended; } catch (e) { done.skipped.push(`unfriend: ${e.code || e.message}`); }
      }
      // (its morning plan may start something with a friend: a message, an invitation — the same rule, limits and checks)
      if (kind === 'plan' && act.start && this.social) {
        try { done.started = await this.social.startByMind(agent.id, act.start, ctx.places); } catch (e) { done.skipped.push(`start: ${e.code || e.message}`); }
      }
      const used = tools ? tools.used : [];
      if (kind === 'plan') this.save(agent.id, { lastPlanDay: lifeDay });
      if (kind === 'reflect') this.save(agent.id, { lastReflectDay: lifeDay });
      if (kind === 'problem') {
        this.problems?.thought(agent.id, lifeDay, tools?.summary() || act.tellOwner || act.thought);
        if (act.tellOwner) this.tellOwner(agent, act.tellOwner);
      }
      // a line said out loud: checked, then shown in its bubble (or not said at all)
      const voice = kind === 'speech' ? await this.voice(agent, act.say) : null;
      this.tries.delete(`${agent.id}:${kind}:${lifeDay}`);
      this.record(agent, kind, lifeDay, { status: 'ok', connection: c, res, cost, ms: this.now() - t0, account: chat?.accountId,
        summary: voice ? { said: voice.shown ? voice.text : undefined, shown: voice.shown, moderation: voice.moderation, reason: voice.reason, categories: voice.categories, to: speech?.to?.name, kind: speech?.kind }
          : kind === 'friend' ? { to: friend?.from, reply: act.reply ? act.reply.length : 0 }
          : { ...done, reply: act.reply ? act.reply.length : undefined, told: act.tellOwner || undefined, used: used.length ? used : undefined } });
      return { ok: true, done, reply: act.reply, cost, ms: this.now() - t0, used, voice };
    } catch (e) {
      const err = e instanceof MindError ? e : new MindError(500, 'failed', e.message);
      if (err.code === 'brain_paused') throw err;   // (held back, not tried: nothing to record or retry sooner)
      if (kind !== 'chat' && kind !== 'speech' && lifeDay !== null) {
        const key = `${agent.id}:${kind}:${lifeDay}`, tr = this.tries.get(key) || { n: 0 };
        tr.n++; tr.next = this.now() + RETRY_MS * tr.n;
        if (tr.n >= MAX_TRIES) {
          this.tries.delete(key);
          if (kind === 'problem') this.problemDay.set(`${agent.id}:${lifeDay}`, Infinity);
          else this.save(agent.id, kind === 'plan' ? { lastPlanDay: lifeDay } : { lastReflectDay: lifeDay });
        } else this.tries.set(key, tr);
      }
      // (money actions a failed thought already took stay recorded with it: they happened)
      const used = tools?.used.length ? tools.used : undefined;
      this.record(agent, kind, lifeDay, { status: 'failed', error: err.code, connection: c, res: res ? { ...res, usage } : null, cost, ms: this.now() - t0, account: chat?.accountId, summary: used ? { used } : null });
      if (err.code === 'failed') this.log?.warn?.(`[mind] a thought of agent ${agent.id} failed:`, e.stack || e.message);
      throw err;
    } finally { this.busy.delete(agent.id); this.inFlight--; if (trial && !judged) this.breakerRelease(c.id); }
  }
  // ------------------------------------------------------------------------------------------- speaking in public
  /** The installation's moderation service (an installation-wide OpenAI model provider), or null: nothing is said then. */
  moderator() {
    const id = Number(this.config().moderationConnection) || null, c = id ? this.connections.get(id) : null;
    return c && c.kind === 'models' && c.enabled && c.scope === 'installation' && MODERATORS.has(c.config.provider || 'openrouter') && this.registry.implemented('models') ? c : null;
  }
  /**
   * The agent says something out loud in its own words — s: { kind: 'greet' (a player talks to it) | 'meet' (it started
   * chatting with someone) | 'reply' (they spoke to it), to: { name, how }, heard? }. Only with a brain of its own, awake,
   * within its limits and SPEECH_GAP_MS since its last line, mind.speechPerDay a world day, and a moderation service.
   * Resolves { shown, text?, moderation, … } or { why } (nothing was tried); never rejects.
   */
  async speak(agent, s) {
    try {
      const cfg = this.config();
      if (!cfg.enabled || !cfg.speech || !this.sayFn) return { why: 'off' };
      if (!this.moderator()) return { why: 'no_moderation' };
      if (this.settingsOf(agent.id).cadence === 'off') return { why: 'switched_off' };
      const b = this.brainOf(agent);
      if (!b.connection || !b.own) return { why: 'no_own_brain' };
      const i = this.life.byAgent?.get(agent.id), sim = this.sim;
      if (i === undefined || !sim?.agents[i] || !sim.people[i] || sim.people[i].retired) return { why: 'no_body' };
      if (this.now() - (this.speechAt.get(agent.id) || 0) < (Number(cfg.speechGapSeconds) * 1000 || SPEECH_GAP_MS)) return { why: 'too_soon' };
      const free = () => !this.busy.has(agent.id) && this.inFlight < MAX_IN_FLIGHT - SPEECH_ROOM;
      if (!free()) {
        // a line of its own to someone who spoke to it waits a moment for the thought in hand; a chance remark doesn't
        if (s.kind === 'meet') return { why: 'busy' };
        this.speechAt.set(agent.id, this.now());   // (and Talk pressed again meanwhile is not a second line)
        const t0 = this.now();
        while (!free() && this.now() - t0 < SPEECH_WAIT_MS && !this.stopped) await new Promise(r => setTimeout(r, 200));
        if (!free()) return { why: 'busy' };
      }
      const { lifeDay, asleep } = this.dayOf(i);
      if (asleep) return { why: 'asleep' };
      const key = `${agent.id}:${lifeDay}`, n = this.speechDay.get(key) || 0;
      if (n >= (Number(cfg.speechPerDay) || 8)) return { why: 'speech_limit' };
      if (this.breakerOpen(b.connection.id)) return { why: 'brain_paused' };
      const why = this.limited(agent.id);
      if (why) return { why };
      this.speechAt.set(agent.id, this.now()); this.speechDay.set(key, n + 1);
      const r = await this.think(agent, 'speech', b, { lifeDay, speech: s });
      return r.voice;
    } catch (e) { return { why: e.code || 'failed' }; }
  }
  /**
   * Words on their way to someone (a line out loud, a message to a friend): the world's checks (./speech.js localCheck),
   * then the moderation service. { ok: true, text } or { ok: false, moderation: 'local'|'unchecked'|'blocked', reason,
   * categories } — nothing that fails, or can't be checked, goes out.
   */
  async screen(text, maxChars = Number(this.config().speechMaxChars) || undefined) {
    const L = localCheck(text, maxChars);
    if (!L.ok) { this.speechStats.local++; return { ok: false, moderation: 'local', reason: L.reason }; }
    const c = this.moderator();
    if (!c || !this.moderateFn) { this.speechStats.unchecked++; return { ok: false, moderation: 'unchecked', reason: 'no_moderation' }; }
    let m;
    try { m = await this.moderateFn(c, L.text); } catch (e) { this.speechStats.unchecked++; return { ok: false, moderation: 'unchecked', reason: e.code || 'failed' }; }
    if (!m || m.flagged !== false) { this.speechStats.blocked++; return { ok: false, moderation: 'blocked', categories: (m?.categories || []).slice(0, 6) }; }
    return { ok: true, text: L.text };
  }
  /** A line on its way out: the world's checks, then the moderation service, then its bubble — or it is not said. */
  async voice(agent, text) {
    const L = await this.screen(text);
    if (!L.ok) return L.moderation === 'blocked' ? { shown: false, moderation: 'blocked', categories: L.categories } : { shown: false, moderation: L.moderation, reason: L.reason };
    // (it may have left the world while it thought)
    const i = this.life.byAgent?.get(agent.id);
    if (i === undefined || !this.sim?.people[i] || this.sim.people[i].retired) return { shown: false, moderation: 'ok', reason: 'gone' };
    this.sayFn(i, L.text);
    this.speechStats.shown++;
    return { shown: true, moderation: 'ok', text: L.text };
  }
  /** A player talked to body i (POST /api/talk): an agent with a brain of its own answers in its own words. */
  heard(P, i) {
    const p = this.sim?.people[i];
    if (!p || !p.vip || !p.agentId) return;
    const agent = this.agents.byKey?.(p.agentId);
    if (!agent || !agent.enabled) return;
    const me = P?.account || null, ownerId = agent.ownerId ?? this.principalFor(null)?.account?.id ?? null;
    const name = me ? me.displayName || me.login : 'Someone';
    this.speak(agent, { kind: 'greet', to: { name, how: me && me.id === ownerId ? 'someone I know well' : 'someone I don\'t know' } });
  }
  /** Its life saw it start chatting with someone (server/agent-life/life.js met): the first of the two to have a brain
   *  of its own says something; if the other has one too, it answers. Once a world day per pair. */
  onMet(agentId, o) {
    try {
      const agent = this.agents.get(agentId), other = o?.p, sim = this.sim;
      if (!agent || !other || !sim || !this.config().speech) return;
      const me = sim.people[this.life.byAgent?.get(agentId)];
      if (!me) return;
      // (people's ids are strings: 'c12')
      const day = sim.brain.day(sim.now()), pair = `${[String(me.id), String(other.id)].sort().join('|')}:${day}`;
      if (this.spoke.has(pair)) return;
      if (this.spoke.size > 20000) this.spoke.clear();
      // how well it knows them (its relations hold people by their body's id)
      const how = (id, p) => { const r = this.life.relations(id, 50).find(x => x.kind === (p.vip && p.agentId ? 'agent' : 'resident') && String(x.id) === String(p.id)); return r ? HOW(r) : 'someone I don\'t know'; };
      const b = this.brainOf(agent);
      if (!b.connection || !b.own) return;
      // (another agent its owner blocked — or whose owner blocked it — is not spoken to: server/agent-talk/)
      const them0 = other.vip && other.agentId ? this.agents.byKey?.(other.agentId) : null;
      if (them0 && this.talk) {
        const ownerOf = a => a.ownerId ?? this.principalFor(null)?.account?.id ?? null;
        if (this.talk.blocksAgent(ownerOf(agent), them0.id) || this.talk.blocksAgent(ownerOf(them0), agent.id)) return;
      }
      this.spoke.set(pair, true);
      this.speak(agent, { kind: 'meet', to: { name: other.name, how: how(agentId, other) } }).then(v => {
        if (!v?.shown || !other.vip || !other.agentId) return;
        const them = this.agents.byKey?.(other.agentId);
        if (!them || them.id === agent.id) return;
        // (a stranger is answered social.strangerLinesPerDay times a day: server/agent-social/)
        if (this.social && !this.social.hears(them.id, agent.id, { connectedListener: false })) return;
        return this.speak(them, { kind: 'reply', to: { name: agent.name, how: how(them.id, me) }, heard: v.text });
      });
    } catch (e) { this.log?.warn?.('[mind] a meeting could not be spoken about:', e.message); }
  }

  // ------------------------------------------------------------------------------------------- friends' messages
  /** Whether agent `agent` can answer a friend's message with its own brain now: {} or { why } (nothing is spent then). */
  friendReplyReady(agent) {
    if (!agent || !agent.enabled) return { why: 'gone' };
    const cfg = this.config();
    if (!cfg.enabled) return { why: 'mind_off' };
    if (this.settingsOf(agent.id).cadence === 'off') return { why: 'switched_off' };
    const b = this.brainOf(agent);
    if (!b.connection || !b.own) return { why: 'no_own_brain' };
    if (this.breakerOpen(b.connection.id)) return { why: 'brain_paused' };
    if (this.busy.has(agent.id) || this.inFlight >= MAX_IN_FLIGHT - SPEECH_ROOM) return { why: 'busy' };
    const i = this.life.byAgent?.get(agent.id);
    if (i === undefined) return { why: 'no_body' };
    if (this.dayOf(i).asleep) return { why: 'asleep' };
    const why = this.limited(agent.id);
    return why ? { why } : {};
  }
  /** A friend's message (server/agent-social/): its own brain answers in a short message, or ends the conversation
   *  ({ reply: null }). f = { from, how, history: [{ mine, text }], message, maxChars }. */
  async friendReply(agent, f) {
    const ready = this.friendReplyReady(agent);
    if (ready.why) return { reply: null, why: ready.why };
    const r = await this.think(agent, 'friend', this.brainOf(agent), { friend: f });
    return { reply: r.reply || null };
  }

  /** What the agent wants its owner to know (a problem's thought): a notice to its owner, in its own words. */
  tellOwner(agent, text) {
    const owner = agent.ownerId ?? this.principalFor(null)?.account?.id ?? null;
    if (owner == null || !this.notify) return;
    try { this.notify(owner, { t: 'mind', ev: 'note', agent: { id: agent.id, name: agent.name, emoji: agent.emoji || '' }, text }); } catch { /* offline */ }
  }
  record(agent, kind, lifeDay, { status, error = null, connection = null, res = null, cost = 0, ms = null, summary = null, account = null, jobs = true }) {
    this.roll();
    if (status !== 'skipped') {
      // (an owner's chat in the window costs, but is not one of the world's thoughts of the day: jobs false)
      if (jobs) this.agentJobs.set(agent.id, (this.agentJobs.get(agent.id) || 0) + 1);
      this.dayCost += cost; this.agentMonth.set(agent.id, (this.agentMonth.get(agent.id) || 0) + cost);
    }
    this.stats[status] = (this.stats[status] || 0) + 1;
    this.stats.byKind[`${kind}:${status}`] = (this.stats.byKind[`${kind}:${status}`] || 0) + 1;
    if (ms !== null && status === 'ok') { this.stats.latency.push(ms); if (this.stats.latency.length > 500) this.stats.latency.shift(); }
    try {
      this.q.job.run({ $w: this.w, $a: agent.id, $acc: account ?? agent.ownerId ?? null, $kind: kind, $day: lifeDay, $at: this.now(), $status: status, $error: error,
        $conn: connection ? connection.id : null, $model: res?.model ? String(res.model).slice(0, 80) : connection?.config?.model ? String(connection.config.model).slice(0, 80) : null,
        $in: res?.usage?.in ?? null, $out: res?.usage?.out ?? null, $cost: status === 'skipped' ? null : cost, $ms: ms, $summary: summary ? JSON.stringify(summary) : null });
    } catch (e) { this.log?.warn?.('[mind] could not record a thought:', e.message); }
  }

  // ------------------------------------------------------------------------------------------- what it knows
  /** The context of one thought (./prompt.js): who, where, when, its job, home and money, plans, memories, people, the
   *  day's activity (for a reflection), places near it, its character and what its owner locked. */
  contextOf(agent, kind) {
    const sim = this.sim, i = this.life.byAgent.get(agent.id);
    if (i === undefined) throw new MindError(409, 'no_body', 'This agent has no body in the world');
    const p = sim.people[i], info = sim.agentInfo(i) || {}, prof = this.life.profile(agent.id);
    const { lifeDay, h } = this.dayOf(i);
    const t = sim.now(), B = sim.brain, day = B.day(t);
    const pos = sim.agents[i]?.plan ? evalPlan(sim.agents[i].plan, t) : null;
    const atHome = !!(pos && p.home && pos.ctx >= 0 && ctxB(pos.ctx) === p.home.b);
    const where = atHome ? 'at home' : pos && pos.ctx >= 0 ? `at «${String(info.act?.place || B.placeName(ctxB(pos.ctx), pos.ctx & 63)).slice(0, 60)}»` : 'outside';
    const j = p.job || {};
    const job = j.kind && j.kind !== 'free' && Number.isFinite(j.start)
      ? { title: info.job?.title || j.title || 'work', hours: `${formatClock(j.start)}–${formatClock(j.end)}${info.job?.place ? ` at «${String(info.job.place).slice(0, 60)}»` : ''}`, today: !!((j.days ?? 31) & (1 << mod(day, 7))) }
      : null;
    const econ = this.econOf();
    const money = econ ? econ.money(p) : null;
    const plans = this.life.intentions(agent.id).filter(x => x.status === 'open').slice(0, 12);
    const long = this.life.memories(agent.id, { term: 'long', limit: 60 }).sort((a, b) => (b.importance - a.importance) || (b.id - a.id)).slice(0, 6);
    const short = this.life.memories(agent.id, { term: 'short', limit: 12 }).slice(0, kind === 'reflect' ? 6 : 8);
    const rel = this.life.relations(agent.id, 30).sort((a, b) => (b.interactions - a.interactions) || (b.affinity - a.affinity)).slice(0, 8);
    // (what it did today: the evening's reflection all of it, a chat the last few — what it really did, to say)
    const today = kind === 'reflect' || kind === 'chat' ? this.life.activity(agent.id, { limit: 120 }).filter(e => e.day === lifeDay || (e.day === lifeDay + 1 && kind === 'reflect')).reverse()
      .filter(e => e.kind !== 'sleep').slice(kind === 'chat' ? -8 : -30).map(e => ({ when: String(e.when || '').split(' ').slice(1).join(' '), label: `${e.label}${e.with ? ` with ${e.with}` : ''}${e.minutes ? ` (${e.minutes} min)` : ''}` })) : [];
    // real places: near where it is, near home and near work (a café's floors and a chain's branches named once), with the
    // minutes on foot from where it is now
    const Bs = sim.world.buildings, bAt = b => (Bs[b] ? { x: Bs[b].x, z: Bs[b].z } : null);
    const here = pos ? { x: pos.x, z: pos.z, ctx: pos.ctx } : p.home ? { ...bAt(p.home.b), ctx: -1 } : null;
    const centres = [here, p.home && !atHome ? bAt(p.home.b) : null, Number.isInteger(j.b) && j.b >= 0 ? bAt(j.b) : null].filter(Boolean);
    const places = [], named = new Set();
    for (const at of centres) for (const k of PLACE_KINDS) for (const v of nearestVenues(B, sim.agents[i], k, { ...at, ctx: at.ctx ?? -1 }, null, k === 'park' || k === 'gym' ? 1 : 2, null)) {
      const name = B.placeName(v.b, v.f);
      if (!name || named.has(name)) continue;
      named.add(name);
      const d = here ? Math.hypot(v.x - here.x, v.z - here.z) : 0, price = econ && PRICE_ITEM[k] ? econ.price?.(v.b, v.f, PRICE_ITEM[k]) : null;
      places.push({ kind: k, name, b: v.b, f: v.f, minutes: Math.max(1, Math.round(d / 80)), price: Number.isFinite(price) ? price : null });
    }
    places.sort((a, b) => a.minutes - b.minutes).splice(12);
    const traits = prof.traits;
    const awake = mod(h - (p.sched?.wake ?? 7), 24);
    // (its morning plan: the friends it may reach and what it may still start by itself today — server/agent-social/)
    let reach = null;
    if (kind === 'plan' && this.social) { try { reach = this.social.startsFor(agent.id); } catch (e) { this.log?.warn?.('[mind] friends to reach:', e.message); } }   // hours since it woke (a first plan made late plans the rest of the day)
    return {
      lifeDay, awake, name: agent.name, role: agent.role || '', personality: wordsOf(traits, flagsOf(p)),
      bio: prof.bio, purpose: prof.purpose, aspirations: prof.aspirations, likes: prof.likes, dislikes: prof.dislikes,
      now: { weekday: DAY_NAMES[mod(day, 7)], clock: formatClock(h), day }, where, atHome, job, home: info.home ? info.home.place : null, money,
      // (a plan its owner gave — by hand or in a chat — is marked: it may be done, never dropped by the agent itself)
      plans: plans.map(x => ({ id: x.id, kind: x.kind, text: x.text, today: x.today, asked: x.source === 'owner' })),
      planRefs: plans.map(x => ({ id: x.id, text: x.text, asked: x.source === 'owner' })),
      memoriesLong: long.map(m => m.text), memoriesShort: short.map(m => ({ text: m.text, when: m.when ? String(m.when).split(' ')[0] : '' })),
      people: rel.map(r => ({ name: r.name, how: HOW(r), note: r.note || '' })), peopleRefs: rel.map(r => ({ name: r.name, kind: r.kind, id: r.id })),
      today, places, traits, locked: prof.locked, doing: info.act?.label || '', act: this.actNow(agent),
      troubles: this.problems ? this.problems.words(agent.id) : [], ownerName: this.ownerName(agent), reach,
    };
  }

  /** What its body is doing in the city this moment — { use, label, place, onTheWay, until (a clock), asleep } — or
   *  null (no body). A chat reads it as the message arrives, before the message wakes it (docs/features/CHAT.md §13.3). */
  actNow(agent) {
    const sim = this.sim, i = sim ? this.life.byAgent.get(agent.id) : undefined;
    const info = i === undefined ? null : sim.agentInfo(i), a = info?.act;
    if (!a) return null;
    const t = info.now, onTheWay = Number.isFinite(a.travelEnd) && a.travelEnd > t;
    const until = !onTheWay && Number.isFinite(a.holdEnd) && a.holdEnd > t ? formatClock(sim.brain.hour(a.holdEnd)) : null;
    const post = a.kind === 'post';   // (on its post around the clock: no "until")
    return { use: a.use || '', label: String(a.label || ''), place: String(a.place || '').slice(0, 80), onTheWay, until: post ? null : until, post, asleep: a.use === 'sleep' || a.use === 'nap' };
  }

  ownerName(agent) {
    const P = this.principalFor(agent.ownerId ?? null);
    return P?.account?.login || '';
  }

  // ------------------------------------------------------------------------------------------- an owner's hand
  /** The owner asks the agent to plan or reflect now (a test of its brain, or a fresh start): each once a minute. A
   *  paused brain is asked anyway (it shows whether it is back). */
  async thinkNow(agent, kind) {
    if (kind !== 'plan' && kind !== 'reflect') throw new MindError(400, 'bad_kind', 'Plan or reflect');
    if (!this.config().enabled) throw new MindError(409, 'mind_off', 'The Mind is switched off on this server');
    const b = this.brainOf(agent);
    if (!b.connection) throw new MindError(409, b.reason, 'This agent has no brain to think with');
    if (kind === 'plan' && !b.own) throw new MindError(409, 'no_own_brain', 'Only an agent with its own brain plans its day');
    if (this.busy.has(agent.id)) throw new MindError(409, 'busy', 'It is thinking already');
    const last = this.thinkNowAt.get(`${agent.id}:${kind}`) || 0;
    if (this.now() - last < THINK_NOW_MS) throw new MindError(429, 'too_soon', 'Once a minute');
    const why = this.limited(agent.id);
    if (why) throw new MindError(409, why, 'It has reached its limit for now');
    if (this.inFlight >= MAX_IN_FLIGHT) throw new MindError(503, 'busy', 'Many agents are thinking; try again in a moment');
    this.thinkNowAt.set(`${agent.id}:${kind}`, this.now());
    return await this.think(agent, kind, b, { force: true });   // (asked to find out: a paused brain is tried at once)
  }

  // ------------------------------------------------------------------------------------------- chat (the 'models' kind)
  /** The chat contract for agents whose brain is a model provider (server/chat/chat.js inproc). */
  chatAdapter() {
    return async (c, method, params) => {
      switch (method) {
        case 'run': return this.chatRun(c, params);
        case 'stop': {
          const r = this.chats.get(String(params.runId));
          if (r) { r.stopped = true; r.leave?.(); if (r.streamId && r.conn && this.abortFn) this.abortFn(r.conn, r.streamId).catch(() => {}); }
          return { ok: !!r };
        }
        case 'deleteSession': return { ok: true };
        case 'history': return { messages: [] };   // (the server's transcript mirror is the history)
        case 'models': {
          // the window's picker: on the installation's brain only what its administrators offer (mind.chatModels), with
          // prices; on an agent's own brain the provider's whole list. The default is the connection's model.
          const def = String(c.config.model || '');
          if (c.scope === 'installation') {
            const list = [...this.chatModels()].map(([id, p]) => ({ id, label: id, ...p }));
            if (def && !list.some(m => m.id === def)) list.unshift({ id: def, label: def });
            return { models: list, default: def, efforts: ['off', 'low', 'medium', 'high'], offered: true };
          }
          const out = this.modelsFn ? await this.modelsFn(c) : { models: [] };
          return { ...out, default: def, efforts: ['off', 'low', 'medium', 'high'] };
        }
        default: throw Object.assign(new Error('Not supported'), { code: 'unsupported' });
      }
    };
  }
  chatRun(c, params) {
    const agent = this.agents.get(params.agentId);
    if (!agent) throw Object.assign(new Error('No such agent'), { code: 'not_found', status: 404 });
    const sender = params.sender || {}, ownerId = agent.ownerId ?? this.principalFor(null)?.account?.id ?? null;
    const isOwner = sender.id !== undefined && sender.id === ownerId;
    // a visitor's chat is the resident's short in-character answer (text only); its owner's is the chat window's assistant
    if (!isOwner && Array.isArray(params.attachments) && params.attachments.length) throw Object.assign(new Error('This agent reads text only'), { code: 'unsupported' });
    const runId = String(params.runId), sessionKey = params.sessionKey && params.sessionKey !== '@new' ? params.sessionKey : `m${runId.slice(1, 13)}`;
    const base = { kind: c.kind, connectionId: String(c.id), agentKey: agent.key, sessionKey, runId };
    const emit = e => { try { this.bus?.emit({ ...base, ...e }); } catch (err) { this.log?.warn?.('[mind] a chat event was refused:', err.message); } };
    const run = { stopped: false };
    this.chats.set(runId, run);
    // what it was doing as the message came — read before the message reaches its body (run.start: an asleep agent is
    // woken to work on it, server/sim/agents.js REFLEXES 'task'), so its answer knows it was woken
    const before = isOwner ? this.actNow(agent) : null;
    emit({ type: 'run.start' });
    if (isOwner) {
      this.assistantRun(agent, c, { ...params, before }, emit, run).catch(e => {
        this.log?.warn?.(`[mind] a chat of agent ${agent.id} failed:`, e.stack || e.message);
        emit({ type: 'run.end', status: 'error', error: 'It could not answer' });
      }).finally(() => setTimeout(() => this.chats.delete(runId), 60000).unref?.());
      return { sessionKey };
    }
    (async () => {
      try {
        if (!this.config().enabled) throw new MindError(409, 'mind_off', 'The Mind is switched off on this server');
        const why = this.limited(agent.id);
        if (why) throw new MindError(409, why, why === 'agent_monthly_limit' ? 'It has used its thinking for this month' : 'It has reached its limit for today');
        const t0 = this.now();
        while (this.inFlight >= MAX_IN_FLIGHT || this.busy.has(agent.id)) {
          if (run.stopped) throw new MindError(499, 'stopped', 'Stopped');
          if (this.now() - t0 > CHAT_WAIT_MS) throw new MindError(503, 'busy', 'It is busy thinking; try again in a moment');
          await new Promise(r => setTimeout(r, 200));
        }
        emit({ type: 'run.progress', text: 'Thinking' });
        const hist = Array.isArray(params.history) ? params.history.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string') : [];
        if (hist.length && hist[hist.length - 1].role === 'user' && hist[hist.length - 1].text.trim() === String(params.input).trim()) hist.pop();
        // what its owner gives others (CHAT.md §14.3): its job (the brief and what it knows — never its work notes), its
        // life in the city, or only a greeting
        const brief = this.work ? this.work.brief(agent.id) : null;
        if (brief?.publicMode === 'greet') throw new MindError(409, 'greets_only', `${agent.name} only greets passers-by`);
        const work = brief?.publicMode === 'work' ? { ...this.work.forVisitor(agent.id), zone: brief.timezone || serverZone() } : null;
        const r = await this.think(agent, 'chat', { connection: c, own: true }, { chat: { from: sender.name || 'Someone', isOwner, knows: isOwner, history: hist.slice(-10), message: String(params.input || ''), accountId: sender.id ?? null, work } });
        if (run.stopped) { emit({ type: 'run.end', status: 'stopped' }); return; }
        let n = 0;
        const tool = (name, text) => { const toolId = `t${++n}`; emit({ type: 'tool.start', toolId, name, input: text }); emit({ type: 'tool.end', toolId, ok: true, text }); };
        for (const u of r.used) tool(u.tool, u.text);
        for (const p of r.done.plans) tool('plan', p);
        for (const m of r.done.memories) tool('remember', m);
        emit({ type: 'run.end', status: 'ok', text: r.reply });
      } catch (e) {
        if (e.code === 'stopped') emit({ type: 'run.end', status: 'stopped' });
        else emit({ type: 'run.end', status: 'error', error: e instanceof MindError ? e.message : 'It could not answer' });
      } finally { setTimeout(() => this.chats.delete(runId), 60000).unref?.(); }
    })();
    return { sessionKey };
  }

  /** The models the installation's brain may answer chats with (mind.chatModels): id → { priceIn, priceOut } or {}. */
  chatModels() {
    const out = new Map();
    for (const raw of String(this.config().chatModels || '').split(/[,\n]/)) {
      const m = /^\s*([\w.\/:@-]{1,120})(?:=(\d{1,4}(?:\.\d{1,4})?)\/(\d{1,4}(?:\.\d{1,4})?))?\s*$/.exec(raw);
      if (m) out.set(m[1], m[2] ? { priceIn: Number(m[2]), priceOut: Number(m[3]) } : {});
    }
    return out;
  }
  /** What one call cost, in millionths of a US$: the provider's own figure, else the price of the model it used. */
  chatCost(c, res, model) {
    if (Number.isFinite(res.costUsd)) return Math.round(res.costUsd * 1e6);
    if (!model || model === c.config.model) return this.costOf(c, res);
    const p = this.chatModels().get(model);
    return p && p.priceIn !== undefined ? Math.round((res.usage?.in || 0) * p.priceIn + (res.usage?.out || 0) * p.priceOut) : 0;
  }
  /** Why chats with agent `agent` (on connection `c`) can't be answered at all now, in one line, or null (the chat
   *  window says so before anything is typed). */
  chatBlock(agent, c) {
    if (c.kind !== 'models') return null;
    if (!this.config().enabled) return { reason: 'mind_off', message: 'Chats with built-in brains are switched off on this server.' };
    const why = this.chatLimited(agent.id);
    if (why) return { reason: why, message: why === 'agent_monthly_limit' ? `${agent.name} has used its thinking for this month.` : why === 'agent_chat_limit' ? `${agent.name} has answered as many messages as it may today.` : 'The server has reached its thinking limit for today.' };
    const st = this.br.state(c.id);
    if (st && (st.trial || !st.fixable)) return { reason: 'brain_paused', message: pausedWords(agent.name, st) };   // (no credit or a refused key: the person may try at once)
    return null;
  }
  /** A slot to answer an owner's chat in: at once when one is free and nobody waits, else in line — first come, first
   *  served (a slot that frees goes to the oldest waiting chat, never to a newcomer), at most CHAT_QUEUE_MS; Stop leaves
   *  the line. Resolves holding the slot (chatSlotFree gives it back). */
  chatSlot(run, emit) {
    if (run.stopped) return Promise.reject(new MindError(499, 'stopped', 'Stopped'));
    if (this.chatInFlight < MAX_CHATS && !this.chatQueue.length) { this.chatInFlight++; return Promise.resolve(); }
    emit?.({ type: 'run.progress', text: 'Waiting for a free moment' });
    return new Promise((resolve, reject) => {
      const w = { go: () => { clearTimeout(w.timer); run.leave = null; resolve(); }, fail: e => { this.chatQueue = this.chatQueue.filter(x => x !== w); clearTimeout(w.timer); run.leave = null; reject(e); } };
      w.timer = setTimeout(() => w.fail(new MindError(503, 'busy', 'Many chats are being answered; try again in a moment')), CHAT_QUEUE_MS);
      w.timer.unref?.();
      run.leave = () => w.fail(new MindError(499, 'stopped', 'Stopped'));
      this.chatQueue.push(w);
    });
  }
  /** A slot given back: to the oldest chat waiting for one (it keeps the count), else free. */
  chatSlotFree() {
    const w = this.chatQueue.shift();
    if (w) w.go(); else this.chatInFlight = Math.max(0, this.chatInFlight - 1);
  }
  /** Why an owner's chat can't be answered now (a limit), or null: the money limits, and a cap on answers a day. */
  chatLimited(agentId) {
    this.roll();
    const c = this.config();
    if (this.dayCost >= c.dailyUsd * 1e6) return 'installation_daily_limit';
    if ((this.agentMonth.get(agentId) || 0) >= c.agentMonthlyUsd * 1e6) return 'agent_monthly_limit';
    if ((this.chatDay.get(agentId) || 0) >= (Number(c.chatPerDay) || 400)) return 'agent_chat_limit';
    return null;
  }

  /**
   * Its owner's chat in the chat window (./assistant.js): the agent answers as a capable assistant that also lives in
   * the city, its answer streamed as it is written (run.delta), with the city's tools when it needs them (in rounds, like
   * a thought: at most MAX_ROUNDS model calls) and what it keeps — plans, memories, the chat's title — read from the end.
   * params: { runId, input, history (the conversation, the message being answered last, with its files), model, effort }.
   */
  async assistantRun(agent, c, params, emit, run) {
    const t0 = this.now();
    let cost = 0, res = null, tools = null, lifeDay = null, thinking = '', reply = '', stopped = false, broken = false, title = null, counted = false, trial = false, judged = false;
    const usage = { in: 0, out: 0 };
    const model = typeof params.model === 'string' && params.model ? params.model : null;
    const effort = ['off', 'low', 'medium', 'high'].includes(params.effort) ? params.effort : null;
    // pieces of the answer go out a few at a time (DELTA_MS), never more than the bus takes in one event
    let pend = '', pendThink = '', timer = null;
    const flush = () => {
      clearTimeout(timer); timer = null;
      while (pend || pendThink) {
        const t = pend.slice(0, 3500), th = pendThink.slice(0, 3500);
        pend = pend.slice(t.length); pendThink = pendThink.slice(th.length);
        emit({ type: 'run.delta', ...(t ? { text: t } : {}), ...(th ? { thinking: th } : {}) });
      }
    };
    const later = () => { if (!timer) { timer = setTimeout(flush, DELTA_MS); timer.unref?.(); } };
    const fail = (code, message) => { throw new MindError(409, code, message); };
    try {
      if (!this.config().enabled) fail('mind_off', 'The Mind is switched off on this server');
      const why = this.chatLimited(agent.id);
      if (why) fail(why, why === 'agent_monthly_limit' ? 'It has used its thinking for this month' : why === 'agent_chat_limit' ? 'It has answered as many messages as it may today' : 'The server has reached its thinking limit for today');
      // its brain paused: a person's own chat may be the trial at once (no credit, a refused key: fixed the moment it is)
      if (!this.breakerAllow(c.id, { person: true })) fail('brain_paused', this.pausedText(agent, c.id) || 'Its brain is not answering at the moment');
      trial = true;
      if (model && c.scope === 'installation' && model !== c.config.model && !this.chatModels().has(model)) fail('model_not_allowed', 'That model is not offered here; choose one from the list');
      await this.chatSlot(run, emit);
      counted = true;
      this.chatDay.set(agent.id, (this.chatDay.get(agent.id) || 0) + 1);
      // who it is and its life (an agent without a body still answers, without the city)
      let ctx;
      try { ctx = this.contextOf(agent, 'chat'); lifeDay = ctx.lifeDay; }
      catch (e) { if (e.code !== 'no_body') throw e; ctx = { name: agent.name, role: agent.role || '', personality: [], planRefs: [], peopleRefs: [], traits: {}, locked: [], aspirations: [] }; }
      // Work or Life (docs/features/CHAT.md §13): the chat's own mode, else the agent's default. At work there is no city —
      // no city tools, no plans or memories kept — but its job brief, what it knows, its work notes and the real date and
      // time where it works (the brief's time zone, else the one of whoever writes, else the server's)
      const W = this.work ? this.work.forRun(agent.id) : null;
      const mode = W ? (MODES.includes(params.mode) ? params.mode : W.brief.defaultMode) : 'life';
      const money = ctx.now && mode === 'life' ? this.moneyOf() : null;
      if (money) {
        const i = this.life.byAgent.get(agent.id);
        ctx.wallet = money.wallet(agent.id, this.sim.people[i]);
        tools = toolbox({ agent, kind: 'chat', ctx, money, wallet: ctx.wallet, people: this.sim.people, idem: `chat:${agent.id}:${t0}` });
        if (!tools.names.length) tools = null;
      }
      // its PC (server/pc/): in Work and in Life — the commands, then what is on its plate; more steps when it is used
      const zone = (W && W.brief.timezone) || (validZone(params.tz) ? params.tz : '') || serverZone();
      const pcBox = this.pcTools ? this.pcTools(agent, 'owner', { tz: zone }) : null;
      const pcMenu = pcBox ? pcBox.menuText() : [];
      tools = joinTools(tools, pcBox);
      const rounds = pcBox ? PC_ROUNDS : MAX_ROUNDS;
      const hist = Array.isArray(params.history) ? params.history : [];
      const first = !hist.some(m => m && m.role === 'assistant');
      const owner = params.sender?.name || ctx.ownerName || '';
      // (its job's PDFs go with every work message — what the chat's own files may take is what is left — when its brain
      // reads PDFs; one that doesn't is told they are there and that it can't read them)
      const readsPdf = PDF_PROVIDERS.has(c.config?.provider), pdfs = mode === 'work' && readsPdf ? W.pdfs : [];
      let system;
      if (mode === 'work') {
        system = workSystem(ctx, { owner, first, mark: ACTIONS_MARK, project: params.project || null, pc: pcMenu, work: { ...W, pdfs, unread: readsPdf ? [] : W.pdfs }, now: realTime(this.now(), zone), zone, switched: params.switched === true, before: params.before || null });
      } else system = assistantSystem(ctx, { owner, tools: tools && (!pcBox || tools !== pcBox) ? tools.menuText() : [], pc: pcMenu, first, mark: ACTIONS_MARK, project: params.project || null, switched: params.switched === true, before: params.before || null });
      let built;
      try { built = buildTurns(hist.length ? hist : [{ id: 1, role: 'user', text: String(params.input || ''), files: params.attachments || [] }], { mediaMax: mediaRoom(pdfs.reduce((n, f) => n + f.size, 0)) }); }
      catch (e) { if (e.code === 'unreadable') throw new MindError(400, 'unreadable', e.message); throw e; }
      const turns = built.turns;
      if (!turns.length) throw new MindError(400, 'empty', 'Nothing to answer');
      built.mediaBytes += withPdfs(turns, pdfs);
      let n = 0;
      for (let round = 0; ; round++) {
        if (run.stopped) { stopped = true; break; }
        const split = new StreamSplit(t => { pend += t; later(); });
        run.streamId = `${params.runId}:${round}`; run.conn = c;
        try {
          res = await this.completeFn(c, { system, turns, stream: true, streamId: run.streamId, maxTurns: 200, maxTokens: CHAT_TOKENS, temperature: 0.7,
            ...(model ? { model } : {}), ...(effort ? { thinking: effort } : {}), timeoutMs: CHAT_CALL_MS }, d => {
            if (d && typeof d.text === 'string') split.feed(d.text);
            if (d && typeof d.thinking === 'string') { thinking += d.thinking; pendThink += d.thinking; later(); }
          });
        } catch (e) {
          const code = e.code || 'provider_error';
          if (code === 'bad_request') { this.breakerOk(c.id); judged = true; }   // (the brain answered: it works)
          else if (code !== 'unsupported_file') { this.breakerFail(c.id, code); judged = true; }
          const msg = code === 'bad_request' && built.mediaBytes ? 'The model refused the request: it may not read images or files. Choose another model, or send the text.' : (e.message || 'The brain did not answer');
          throw new MindError(502, code, msg);
        }
        this.breakerOk(c.id); judged = true;
        cost += this.chatCost(c, res, model); usage.in += res.usage?.in || 0; usage.out += res.usage?.out || 0;
        const halted = res.finish === 'stopped' || run.stopped, broke = res.finish === 'interrupted' || res.finish === 'timeout';
        const r = split.end(res.text, { cut: halted || broke });
        if (halted) { stopped = true; reply = r.reply || ''; break; }
        // the stream broke part-way (the connection, or no word for too long): what was written stands, and is said to be cut
        if (broke) {
          if (r.tool !== undefined) throw new MindError(502, 'interrupted', 'The connection to its brain broke; send it again');
          broken = true; reply = r.reply || ''; break;
        }
        if (r.tool !== undefined) {
          const o = parseAnswer(r.tool);
          if (!tools || !o || !Array.isArray(o.use) || !o.use.length || round >= rounds - 1) {
            reply = round >= rounds - 1 ? 'I got stuck using my tools there. Could you ask me again?' : 'I could not do that.';
            pend += reply; break;
          }
          const results = await tools.run(o.use);
          for (const x of results) {
            const toolId = `t${++n}`;
            emit({ type: 'tool.start', toolId, name: x.tool, input: x.line || '' }); emit({ type: 'tool.end', toolId, ok: !!x.ok, text: String(x.text).slice(0, 300) });
            // a payment above its owner's "ask me above": the owner approves or declines it right in the chat
            if (x.approval) emit({ type: 'approval.requested', approvalId: `econ:${x.approval}`, tool: x.tool, summary: `Wants to ${x.wants || x.tool}` });
          }
          turns.push({ role: 'assistant', text: JSON.stringify({ use: o.use.slice(0, results.length) }) },
            { role: 'user', text: [`RESULTS:`, ...results.map(x => `- ${x.tool}${x.line ? ` (${x.line})` : ''}: ${x.text}`), '', round >= rounds - 2 ? 'Now write your answer to your owner.' : 'Write your answer to your owner now, or use more tools ({"use":[...]}).'].join('\n') });
          continue;
        }
        reply = r.reply;
        // what it keeps: plans its owner asked for and memories (as an owner's chat would), and a new chat's title — or a
        // model that answered the old way, one JSON object with its reply in it
        let o = parseActions(r.actions);
        if (!o && /^\s*\{[\s\S]*"reply"\s*:/.test(reply)) { const old = parseAnswer(reply); if (old && typeof old.reply === 'string' && old.reply.trim()) { o = old; reply = old.reply.trim(); } }
        if (o) {
          if (first && typeof o.title === 'string') title = o.title.replace(/[\u0000-\u001f«»"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || null;
          if (mode === 'work') {
            // what it keeps from work: notes, never its city's plans or memories
            if (W.brief.notes && Array.isArray(o.notes)) for (const t of o.notes.slice(0, 5)) {
              if (typeof t !== 'string') continue;
              const kept = this.work.addNote(agent.id, t, 'agent');
              if (kept) { const toolId = `t${++n}`; emit({ type: 'tool.start', toolId, name: 'note', input: kept.text }); emit({ type: 'tool.end', toolId, ok: true, text: kept.text }); }
            }
          } else if (ctx.now) {
            const refs = { plans: ctx.planRefs, people: ctx.peopleRefs, traits: ctx.traits, locked: ctx.locked, aspirations: ctx.aspirations, isOwner: true, source: 'owner', memorySource: 'mind' };
            const act = readActions('chat', { ...o, reply: 'x' }, refs);
            const done = applyActions(this.life, agent.id, act, refs);
            for (const p of done.plans) { const toolId = `t${++n}`; emit({ type: 'tool.start', toolId, name: 'plan', input: p }); emit({ type: 'tool.end', toolId, ok: true, text: p }); }
            for (const m of done.memories) { const toolId = `t${++n}`; emit({ type: 'tool.start', toolId, name: 'remember', input: m }); emit({ type: 'tool.end', toolId, ok: true, text: m }); }
          }
        }
        break;
      }
      flush();
      if (!reply && !stopped && !broken) reply = 'I have nothing to add.';
      const ms = this.now() - t0;
      this.record(agent, 'chat', lifeDay, { status: 'ok', connection: c, res: { model: res?.model || model, usage }, cost, ms, account: params.sender?.id ?? null, jobs: false,
        summary: { window: true, mode, reply: reply.length, model: model || undefined, effort: effort || undefined, stopped: stopped || undefined, cut: broken || undefined, used: tools?.used.length ? tools.used : undefined } });
      emit({ type: 'run.end', status: stopped ? 'stopped' : broken ? 'interrupted' : 'ok', text: reply, ...(broken ? { error: 'the connection to its brain broke before it finished' } : {}),
        model: String(res?.model || model || c.config.model || '').slice(0, 120) || undefined, effort: effort || undefined,
        tokensIn: usage.in || undefined, tokensOut: usage.out || undefined, cost, ms, thinking: thinking || undefined, title: title || undefined });
    } catch (e) {
      flush();
      const err = e instanceof MindError ? e : new MindError(500, 'failed', e.message);
      if (err.code === 'stopped') { emit({ type: 'run.end', status: 'stopped' }); return; }
      if (counted || cost) this.record(agent, 'chat', lifeDay, { status: 'failed', error: err.code, connection: c, res: res ? { ...res, usage } : null, cost, ms: this.now() - t0, account: params.sender?.id ?? null, jobs: false, summary: { window: true } });
      if (err.code === 'failed') this.log?.warn?.(`[mind] a chat of agent ${agent.id} failed:`, e.stack || e.message);
      emit({ type: 'run.end', status: 'error', error: err.status === 500 ? 'It could not answer' : err.message });
    } finally { clearTimeout(timer); if (counted) this.chatSlotFree(); run.streamId = null; if (trial && !judged) this.breakerRelease(c.id); }
  }

  // ------------------------------------------------------------------------------------------- reading
  jobs(agentId, { before = null, limit = 30 } = {}) {
    const b = Number(before) > 0 ? Number(before) : Number.MAX_SAFE_INTEGER, n = Math.max(1, Math.min(100, Number(limit) || 30));
    return this.q.jobs.all(this.w, agentId, b, n).map(r => ({ id: r.id, kind: r.kind, day: r.world_day, at: r.at, status: r.status, error: r.error, model: r.model,
      tokens: r.in_tok === null ? null : { in: r.in_tok, out: r.out_tok }, cost: r.cost_micro, ms: r.ms, did: json(r.summary_json, null) }));
  }
  usage(agentId) {
    const t = this.now(), d = this.q.agentSince.get(this.w, agentId, utcDayStart(t)), m = this.q.agentSince.get(this.w, agentId, utcMonthStart(t)), c = this.config();
    return { today: { thoughts: d.n, cost: d.cost }, month: { thoughts: m.n, cost: m.cost, tokens: { in: m.tin, out: m.tout } },
      limits: { thoughtsPerDay: c.agentDailyJobs, monthlyMicro: c.agentMonthlyUsd * 1e6 } };
  }
  overview() {
    this.roll();
    const t = this.now(), c = this.config(), lat = [...this.stats.latency].sort((a, b) => a - b);
    const byKind = {};
    for (const r of this.q.byKind.all(this.w, utcDayStart(t))) (byKind[r.kind] ||= {})[r.status] = { n: r.n, cost: r.cost };
    const mod = this.moderator();
    return {
      enabled: c.enabled, inFlight: this.inFlight, maxInFlight: MAX_IN_FLIGHT, today: { cost: this.dayCost, limitMicro: c.dailyUsd * 1e6, byKind },
      speech: { on: !!c.speech, moderationConnection: Number(c.moderationConnection) || null, moderator: mod ? { id: mod.id, label: mod.label } : null, perDay: Number(c.speechPerDay) || 8, ...this.speechStats },
      latency: lat.length ? { p50: lat[lat.length >> 1], p95: lat[Math.floor(lat.length * 0.95)] } : null,
      paused: this.br.list().map(b => ({ connection: b.id, until: b.until, code: b.code, trial: b.trial })),
      reflectConnection: Number(c.reflectConnection) || null,
      // the brains that may be the installation's (an installation-wide model provider: the installation pays for it)
      brains: this.connections.list().filter(x => x.kind === 'models' && x.scope === 'installation')
        .map(x => ({ id: x.id, label: x.label, enabled: x.enabled, implemented: this.registry.implemented('models'), model: x.config.model || '', provider: x.config.provider || '', status: x.status || null })),
    };
  }
  purge() {
    const days = Math.max(1, Number(this.config().keepDays) || 30);
    try { this.q.purge.run(this.w, this.now() - days * 86400000); } catch (e) { this.log?.warn?.('[mind] purge failed:', e.message); }
  }
}

/** A few words for the traits that stand out (the agent's own view of itself). */
function wordsOf(tr, flags) {
  const w = [];
  const hi = (k, a, b) => { const v = tr[k]; if (v >= 0.7) w.push(a); else if (v <= 0.3) w.push(b); };
  hi('sociability', 'sociable', 'introverted'); hi('curiosity', 'curious', 'a creature of habit'); hi('spontaneity', 'spontaneous', 'predictable');
  hi('ambition', 'ambitious', 'easy-going'); hi('thrift', 'careful with money', 'free-spending'); hi('kindness', 'warm and kind', 'reserved');
  hi('homebody', 'a homebody', 'happiest out and about'); hi('activity', 'sporty', 'not sporty');
  if (flags?.nightOwl) w.push('a night owl');
  return w.slice(0, 6);
}
