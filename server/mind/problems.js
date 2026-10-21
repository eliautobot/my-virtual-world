// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What goes wrong in an agent's life (docs/features/FREE-WILL.md §2.7, §11.11): the world shows it, this notices it.
//   rent   - rent it could not pay (a debt to its landlord), or a flat it rents for VC whose rent is overdue (days of
//            grace counting down) or whose lease is ending
//   money  - money running out: less than a few days of its rent and living left (not while 'rent' is open: that says it)
//   home   - no home (its building went, its lease ended, the city had no free bed for it)
//   job    - no job (its workplace went and the city had no free place for it)
// No AI here: what the world shows decides. A problem opens when a scan has seen it twice in a row and resolves when two
// scans have not (a home or a desk is briefly empty while the city re-homes people after an edit; money crosses a line
// back and forth as the day's purchases settle - so money opens below MONEY_OPEN_DAYS and resolves above MONEY_CLOSE_DAYS).
// When one opens: the agent remembers it (its life writes the memory, as it writes "Met Lea at the park"), its owner is
// told, and - when it has a brain of its own - its Mind is given the problem to think about (server/mind/mind.js). When
// it resolves: a memory where there is something to remember (a new home, a new job, the rent paid), and its owner is
// told. (The Mind's scheduler finds open problems not yet thought about today; nothing here waits for it.) Every problem is a row of agent_problems: kept, read by its owner (and manage shares) in the Agent Studio.

export const KINDS = Object.freeze(['rent', 'money', 'home', 'job']);
export const SCAN_MS = 15000;
const CONFIRM = 2;                  // scans in a row before a problem opens or resolves
const MONEY_OPEN_DAYS = 3, MONEY_CLOSE_DAYS = 6;
const LIVING_PER_DAY = 2500;        // hundredths of a VC: food and the like on a modest day, besides the rent
const FREE_TITLES = /^(retired|student|moved away)$/i;
const KEEP_DAYS = 90;               // resolved problems kept this many real days
const vc = c => `${(c / 100).toFixed(c % 100 ? 2 : 0)} VC`;
const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

export class Problems {
  /**
   * @param {object} o
   * @param {{ db, worldId }} o.dbs
   * @param {object} o.agents            the server's agents (enabled(), get())
   * @param {() => object} o.sim
   * @param {object} o.life              server/agent-life/life.js (byAgent, remember, today, clockAt)
   * @param {() => object|null} o.money  server/economy/mind-money.js while the economy is on, else null
   * @param {() => object|null} o.wallets  { money(p) → { available, rentPerDay } } while the economy is on
   * @param {(accountId, message) => void} [o.notify]
   * @param {(agent) => number|null} [o.ownerOf]  who is told: its owner (an agent without one is the installation owner's)
   * @param {number} [o.scanMs]          how often to look (MVW_PROBLEM_SCAN_MS)
   */
  constructor({ dbs, agents, sim, life, money = () => null, wallets = () => null, notify = null, ownerOf = a => a.ownerId ?? null, scanMs = SCAN_MS, log = null, now = () => Date.now() }) {
    Object.assign(this, { dbs, agents, simOf: sim, life, moneyOf: money, walletsOf: wallets, notify, ownerOf, scanMs, log, now });
    this.w = dbs.worldId;
    const db = dbs.db;
    this.q = {
      open: db.prepare("SELECT * FROM agent_problems WHERE world_id = ? AND status = 'open'"),
      add: db.prepare(`INSERT INTO agent_problems (world_id, agent_id, kind, status, opened, opened_day, detail_json) VALUES ($w, $a, $kind, 'open', $at, $day, $detail)`),
      detail: db.prepare('UPDATE agent_problems SET detail_json = ? WHERE world_id = ? AND id = ?'),
      resolve: db.prepare("UPDATE agent_problems SET status = 'resolved', resolved = ?, detail_json = ? WHERE world_id = ? AND id = ?"),
      thought: db.prepare('UPDATE agent_problems SET thoughts = thoughts + 1, last_thought = ?, last_thought_day = ?, note = COALESCE(?, note) WHERE world_id = ? AND id = ?'),
      ofAgent: db.prepare('SELECT * FROM agent_problems WHERE world_id = ? AND agent_id = ? ORDER BY id DESC LIMIT ?'),
      purge: db.prepare("DELETE FROM agent_problems WHERE world_id = ? AND status = 'resolved' AND resolved < ?"),
    };
    this.rows = new Map();          // agent id → Map(kind → open row)
    for (const r of this.q.open.all(this.w)) this.keep(r);
    this.seen = new Map();          // `${agentId}:${kind}` → scans in a row that disagree with what is recorded
    this.names = new Map();         // agent id → { home, job } as last seen (what was lost is named in the memory)
    this.stats = { scans: 0, opened: 0, resolved: 0, lastMs: 0 };
    this.timers = [];
  }
  keep(r) {
    const row = { id: r.id, agentId: r.agent_id, kind: r.kind, opened: r.opened, openedDay: r.opened_day, detail: json(r.detail_json, {}), thoughts: r.thoughts || 0,
      lastThought: r.last_thought, lastThoughtDay: r.last_thought_day, note: r.note || null };
    if (!this.rows.has(r.agent_id)) this.rows.set(r.agent_id, new Map());
    this.rows.get(r.agent_id).set(r.kind, row);
    return row;
  }
  attach() {
    this.timers = [setInterval(() => this.scan(), this.scanMs), setInterval(() => this.purge(), 3600000)];
    for (const t of this.timers) t.unref?.();
    return this;
  }
  stop() { for (const t of this.timers) clearInterval(t); this.timers = []; }
  get sim() { return this.simOf(); }

  // ------------------------------------------------------------------------------------------- noticing
  /** What is wrong for one agent's body now: kind → detail, for each kind that applies. */
  detect(agentId, p, troubles, wallets) {
    const out = {}, j = p.job || {}, W = this.sim.world;
    if (!p.home) out.home = { lost: this.names.get(agentId)?.home || null };
    if ((!j.kind || j.kind === 'free') && !j.retired && !FREE_TITLES.test(j.title || '')) out.job = { lost: this.names.get(agentId)?.job || null };
    const tr = troubles.get(agentId);
    if (tr && (tr.owed > 0 || tr.lease)) out.rent = { owed: tr.owed, lease: tr.lease };
    if (!out.rent && wallets) {
      const m = wallets.money(p), day = (m.rentPerDay || 0) + LIVING_PER_DAY, days = m.available / day;
      const open = this.rows.get(agentId)?.has('money');
      if (days < (open ? MONEY_CLOSE_DAYS : MONEY_OPEN_DAYS)) out.money = { available: m.available, rentPerDay: m.rentPerDay || 0, days: Math.max(0, Math.round(days * 10) / 10) };
    }
    // what it has now, to name later what it lost
    if (p.home || (j.kind && j.kind !== 'free')) {
      const n = this.names.get(agentId) || { home: null, job: null };
      if (p.home) n.home = W.buildings[p.home.b]?.name || n.home;
      if (j.kind && j.kind !== 'free') n.job = j.title || n.job;
      this.names.set(agentId, n);
    }
    return out;
  }
  /** One pass over every agent with a body: problems seen twice open, problems gone twice resolve. */
  scan() {
    const sim = this.sim, life = this.life;
    if (!sim || !life.byAgent) return;
    const t0 = performance.now();
    const money = this.moneyOf(), troubles = money ? money.troubles() : new Map(), wallets = money ? this.walletsOf() : null;
    for (const agent of this.agents.enabled()) {
      const i = life.byAgent.get(agent.id), p = i === undefined ? null : sim.people[i];
      if (!p || p.retired) continue;
      const now = this.detect(agent.id, p, troubles, wallets), mine = this.rows.get(agent.id);
      for (const kind of KINDS) {
        const has = !!now[kind], row = mine?.get(kind) || null, key = `${agent.id}:${kind}`;
        if (has === !!row) {
          this.seen.delete(key);
          if (row && now[kind] && JSON.stringify(now[kind]) !== JSON.stringify(row.detail)) this.update(row, now[kind]);
          continue;
        }
        const n = (this.seen.get(key) || 0) + 1;
        if (n < CONFIRM) { this.seen.set(key, n); continue; }
        this.seen.delete(key);
        try {
          if (has) this.open(agent, kind, now[kind]);
          else this.resolve(agent, row, p);
        } catch (e) { this.log?.warn?.(`[mind] a problem of agent ${agent.id} could not be recorded:`, e.message); }
      }
    }
    this.stats.scans++; this.stats.lastMs = Math.round((performance.now() - t0) * 10) / 10;
  }
  update(row, detail) {
    row.detail = detail;
    this.q.detail.run(JSON.stringify(detail), this.w, row.id);
  }
  open(agent, kind, detail) {
    const day = this.life.today();
    const r = this.q.add.run({ $w: this.w, $a: agent.id, $kind: kind, $at: this.now(), $day: day, $detail: JSON.stringify(detail) });
    const row = this.keep({ id: Number(r.lastInsertRowid), agent_id: agent.id, kind, opened: this.now(), opened_day: day, detail_json: JSON.stringify(detail), thoughts: 0 });
    this.stats.opened++;
    const text = openWords(kind, detail);
    this.remember(agent.id, text, kind === 'money' ? 2 : 3);
    this.tell(agent, 'problem', kind, text);
    return row;
  }
  resolve(agent, row, p) {
    const detail = { ...row.detail, now: solvedDetail(row.kind, p, this.sim) };
    this.q.resolve.run(this.now(), JSON.stringify(detail), this.w, row.id);
    this.rows.get(agent.id)?.delete(row.kind);
    this.stats.resolved++;
    const text = solvedWords(row.kind, detail.now);
    if (text) this.remember(agent.id, text, 3);
    this.tell(agent, 'solved', row.kind, text || solvedNote(row.kind));
  }
  remember(agentId, text, importance) {
    const sim = this.sim;
    this.life.remember(agentId, { kind: 'event', text, importance, day: this.life.today(), time: sim ? this.life.clockAt(sim.now()) : null });
  }
  tell(agent, ev, kind, text) {
    const owner = this.ownerOf(agent);
    if (owner == null || !this.notify) return;
    try { this.notify(owner, { t: 'mind', ev, agent: { id: agent.id, name: agent.name, emoji: agent.emoji || '' }, kind, text }); } catch { /* the owner is offline */ }
  }

  // ------------------------------------------------------------------------------------------- the Mind's side
  /** The open problems of an agent, oldest first. */
  openOf(agentId) { return [...(this.rows.get(agentId)?.values() || [])].sort((a, b) => a.opened - b.opened); }
  /** Its Mind thought about its open problems on world day `day`; note: what it did, in a few words. */
  thought(agentId, day, note = null) {
    for (const row of this.openOf(agentId)) {
      row.thoughts++; row.lastThought = this.now(); row.lastThoughtDay = day; if (note) row.note = note;
      this.q.thought.run(row.lastThought, day, note ? String(note).slice(0, 300) : null, this.w, row.id);
    }
  }
  /** Its problems as words for a prompt (the Mind's and Free Will's): ["My rent is behind: I owe 44 VC", …]. */
  words(agentId) { return this.openOf(agentId).map(r => openWords(r.kind, r.detail, true)); }

  // ------------------------------------------------------------------------------------------- reading
  list(agentId, limit = 20) {
    return this.q.ofAgent.all(this.w, agentId, Math.max(1, Math.min(100, limit))).map(r => ({ id: r.id, kind: r.kind, status: r.status, opened: r.opened, resolved: r.resolved,
      day: r.opened_day, detail: json(r.detail_json, {}), thoughts: r.thoughts, lastThought: r.last_thought, note: r.note, text: r.status === 'open' ? openWords(r.kind, json(r.detail_json, {}), true) : solvedWords(r.kind, json(r.detail_json, {}).now) || solvedNote(r.kind) }));
  }
  overview() {
    let open = 0; const byKind = {};
    for (const m of this.rows.values()) for (const r of m.values()) { open++; byKind[r.kind] = (byKind[r.kind] || 0) + 1; }
    return { open, byKind, ...this.stats };
  }
  purge() { try { this.q.purge.run(this.w, this.now() - KEEP_DAYS * 86400000); } catch (e) { this.log?.warn?.('[mind] purging problems failed:', e.message); } }
}

/** A problem in the agent's own words: a memory when it opens (now = false) or a line of a prompt (now = true). */
export function openWords(kind, d = {}, now = false) {
  if (kind === 'home') return now ? 'I have no home' : `Lost my home${d.lost ? ` at ${d.lost}` : ''}`;
  if (kind === 'job') return now ? `I have no job${d.lost ? ` (I was ${d.lost})` : ''}` : `Lost my job${d.lost ? ` (${d.lost})` : ''}`;
  if (kind === 'rent') {
    const L = d.lease;
    if (L && L.status === 'ending') return now ? `My lease of ${L.title} is ending: the rent went unpaid` : `My lease of ${L.title} is ending: I couldn't pay the rent`;
    if (L && L.status === 'due') return now ? `My rent for ${L.title} is overdue (${L.perDay ? `${vc(L.perDay)} a day; ` : ''}${L.graceLeft ?? 0} day${L.graceLeft === 1 ? '' : 's'} of grace left)${d.owed ? `; I owe ${vc(d.owed)}` : ''}` : `Couldn't pay the rent for ${L.title}`;
    return now ? `My rent is behind: I owe ${vc(d.owed || 0)}` : `Couldn't pay all my rent (I owe ${vc(d.owed || 0)})`;
  }
  if (kind === 'money') return now ? `Money is tight: ${vc(d.available || 0)} left, about ${d.days ?? 0} days of rent and food` : `Money is running low (${vc(d.available || 0)} left)`;
  return kind;
}
function solvedDetail(kind, p, sim) {
  const W = sim?.world;
  if (kind === 'home') return { home: p.home ? W?.buildings[p.home.b]?.name || null : null };
  if (kind === 'job') return { job: p.job?.title || null };
  return {};
}
function solvedWords(kind, now = {}) {
  if (kind === 'home') return now?.home ? `Moved into a new home at ${now.home}` : null;
  if (kind === 'job') return now?.job ? `Started a new job: ${now.job}` : null;
  if (kind === 'rent') return 'Caught up on my rent';
  return null;
}
const solvedNote = kind => ({ home: 'Has a home again', job: 'Has a job again', rent: 'The rent is paid', money: 'Money is fine again' }[kind] || 'Solved');
