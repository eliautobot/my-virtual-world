// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's life (docs/features/FREE-WILL.md §5): who it is (character, story, goals), what it plans (intentions),
// what it did (the activity log), what it remembers (short-term memories fade after SHORT_DAYS world days; long-term
// ones stay) and whom it knows (relationships).
// - It only watches. The simulation reports every planned activity (Sim.actObservers); for owned agents with a body
//   this turns it into a line of the activity log (consecutive parts of one activity at one place are one line), and a
//   few events into memories: the first time at a place, meeting someone, a friendship forming, a visit to a flat.
//   Nothing here changes what anyone does - a city with it attached plans exactly what one without it plans.
// - Writes are batched (one transaction every few seconds); the line still in progress is kept in memory and shown.
// - It gives Free Will (and later the Mind) a small context: the traits that stand out, purpose, today's plans, a few
//   relevant memories, what the agent did earlier today, and how well it knows each place it could go.
import { WEEKDAYS, formatClock, mod } from '../../shared/constants.js';
import { TRAITS, FLAGS, TRAIT_KEYS, traitsOf, flagsOf, applyBody, storedTraits, traitWords, isTrait } from './traits.js';
import { classifyAct } from './activity.js';
import { closenessLevel } from '../../shared/closeness.js';

export const SHORT_DAYS = 3;          // world days a short-term memory lasts
export const MAX_SHORT = 80;          // short-term memories kept per agent
export const MAX_LONG = 300;          // long-term memories kept per agent
export const AUTO_PER_DAY = 20;       // memories an agent's life writes by itself per world day
export const MAX_OPEN_INTENTIONS = 12;
const FLUSH_MS = 4000;
const REBUILD_MS = 60000;
const FRIEND_STEPS = [[0.5, 'friends with'], [0.75, 'close friends with']];   // (shared/closeness.js: Friend, Close friend)

export class LifeError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v, n, each) => (Array.isArray(v) ? v.map(x => clean(x, each)).filter(Boolean).slice(0, n) : null);
const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const r2 = v => Math.round(v * 100) / 100;
/** Places worth knowing (a first visit is remembered; Free Will says how well the agent knows them). */

export class AgentLife {
  /**
   * @param {object} o
   * @param {{ db, worldId, tx }} o.dbs
   * @param {object} o.agents             server/agents.js Agents (list, get, resolver, listeners, update)
   * @param {() => object} o.sim          the running Sim
   * @param {(i: number) => void} o.savePerson  persist a resident whose traits changed
   * @param {() => { activityDays }} o.config
   */
  constructor({ dbs, agents, sim, savePerson = () => {}, config = () => ({ activityDays: 7 }), audit = null, log = null, now = () => Date.now() }) {
    Object.assign(this, { dbs, agents, simOf: sim, savePerson, configFn: config, audit, log, now });
    this.w = dbs.worldId;
    this.byPerson = new Map();   // resident index → { agentId, key, name }
    this.byAgent = new Map();    // agent id → resident index
    this.open = new Map();       // agent id → the activity line in progress (not written yet)
    this.queue = [];             // finished activity lines to write
    this.memQueue = [];          // memories to write
    this.relQueue = new Map();   // `${agentId}|${kind}|${id}` → relation row to write
    this.known = new Map();      // agent id → Map(placeKey → { n, lastDay }) - how well it knows each place
    this.relCache = new Map();   // agent id → Map(`${kind}|${id}` → { affinity, trust, interactions, name })
    this.autoToday = new Map();  // agent id → { day, n }: memories written by itself today
    this.timers = [];
    this.observer = (a, act) => { if (this.byPerson.has(a.i)) { try { this.observe(a, act); } catch (e) { this.log?.warn?.('[agent-life] observing failed:', e.message); } } };
    this.onAgentsChanged = () => this.rebuild();
    const db = dbs.db;
    this.q = {
      profile: db.prepare('SELECT * FROM agent_profiles WHERE world_id = ? AND agent_id = ?'),
      putProfile: db.prepare(`INSERT INTO agent_profiles (world_id, agent_id, traits_json, bio, values_json, likes_json, dislikes_json, purpose, aspirations_json, outlook, locked_json, updated, updated_by)
        VALUES ($w, $a, $traits, $bio, $values, $likes, $dislikes, $purpose, $asp, $outlook, $locked, $at, $by)
        ON CONFLICT (world_id, agent_id) DO UPDATE SET traits_json = excluded.traits_json, bio = excluded.bio, values_json = excluded.values_json,
          likes_json = excluded.likes_json, dislikes_json = excluded.dislikes_json, purpose = excluded.purpose, aspirations_json = excluded.aspirations_json,
          outlook = excluded.outlook, locked_json = excluded.locked_json, updated = excluded.updated, updated_by = excluded.updated_by`),
      intentions: db.prepare("SELECT * FROM agent_intentions WHERE world_id = ? AND agent_id = ? AND (status = 'open' OR updated > ?) ORDER BY status = 'open' DESC, id DESC LIMIT 60"),
      openIntentions: db.prepare("SELECT * FROM agent_intentions WHERE world_id = ? AND agent_id = ? AND status = 'open' AND (world_day IS NULL OR world_day >= ?) ORDER BY kind = 'must' DESC, id LIMIT ?"),
      countOpen: db.prepare("SELECT COUNT(*) AS n FROM agent_intentions WHERE world_id = ? AND agent_id = ? AND status = 'open'"),
      addIntention: db.prepare(`INSERT INTO agent_intentions (world_id, agent_id, world_day, kind, text, status, source, created, updated) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`),
      intention: db.prepare('SELECT * FROM agent_intentions WHERE world_id = ? AND agent_id = ? AND id = ?'),
      setIntention: db.prepare('UPDATE agent_intentions SET status = ?, updated = ? WHERE world_id = ? AND agent_id = ? AND id = ?'),
      delIntention: db.prepare('DELETE FROM agent_intentions WHERE world_id = ? AND agent_id = ? AND id = ?'),
      memories: db.prepare('SELECT * FROM agent_memories WHERE world_id = ? AND agent_id = ? AND term = ? AND id < ? ORDER BY id DESC LIMIT ?'),
      memory: db.prepare('SELECT * FROM agent_memories WHERE world_id = ? AND agent_id = ? AND id = ?'),
      recall: db.prepare('SELECT * FROM agent_memories WHERE world_id = ? AND agent_id = ? AND (term = \'long\' OR world_day >= ?) ORDER BY importance DESC, id DESC LIMIT 40'),
      addMemory: db.prepare(`INSERT INTO agent_memories (world_id, agent_id, term, kind, text, importance, place, people_json, world_day, world_time, source, created)
        VALUES ($w, $a, $term, $kind, $text, $imp, $place, $people, $day, $time, $source, $at)`),
      promote: db.prepare("UPDATE agent_memories SET term = 'long' WHERE world_id = ? AND agent_id = ? AND id = ?"),
      delMemory: db.prepare('DELETE FROM agent_memories WHERE world_id = ? AND agent_id = ? AND id = ?'),
      relations: db.prepare('SELECT * FROM agent_relations WHERE world_id = ? AND agent_id = ? ORDER BY interactions DESC, affinity DESC LIMIT ?'),
      relation: db.prepare('SELECT * FROM agent_relations WHERE world_id = ? AND agent_id = ? AND other_kind = ? AND other_id = ?'),
      putRelation: db.prepare(`INSERT INTO agent_relations (world_id, agent_id, other_kind, other_id, other_name, affinity, trust, interactions, first_day, last_day, last_place, note, updated)
        VALUES ($w, $a, $kind, $id, $name, $aff, $trust, $n, $first, $last, $place, '', $at)
        ON CONFLICT (world_id, agent_id, other_kind, other_id) DO UPDATE SET other_name = excluded.other_name, affinity = excluded.affinity, trust = excluded.trust,
          interactions = excluded.interactions, last_day = excluded.last_day, last_place = excluded.last_place, updated = excluded.updated`),
      noteRelation: db.prepare('UPDATE agent_relations SET note = ?, updated = ? WHERE world_id = ? AND agent_id = ? AND other_kind = ? AND other_id = ?'),
      // (agents and friends, server/agent-social/: a change of closeness, an ended friendship, its own block; fading with time apart)
      setRelation: db.prepare(`INSERT INTO agent_relations (world_id, agent_id, other_kind, other_id, other_name, affinity, trust, interactions, first_day, last_day, last_place, note, updated, ended_until, blocked, faded_day)
        VALUES ($w, $a, $kind, $id, $name, $aff, 0, 0, $day, $day, NULL, '', $at, $ended, $blocked, $day)
        ON CONFLICT (world_id, agent_id, other_kind, other_id) DO UPDATE SET affinity = excluded.affinity, ended_until = excluded.ended_until, blocked = excluded.blocked, updated = excluded.updated`),
      fadeDue: db.prepare(`SELECT agent_id, other_kind, other_id, other_name, affinity FROM agent_relations WHERE world_id = $w AND affinity != 0
        AND last_day < $today - $after AND (faded_day IS NULL OR faded_day < $today) AND affinity >= $friend AND other_kind = 'agent'`),
      // (faded_day: the last world day its fading was counted - NULL: never; the days counted are those since then, or
      // since the week apart began, whichever is later)
      fade: db.prepare(`UPDATE agent_relations SET
        affinity = ROUND(CASE WHEN affinity > 0 THEN MAX(0, affinity - $rate * ($today - MAX(COALESCE(faded_day, last_day + $after), last_day + $after)) * (1 - 0.5 * affinity))
          ELSE MIN(0, affinity + $rate * ($today - MAX(COALESCE(faded_day, last_day + $after), last_day + $after))) END, 3),
        faded_day = $today
        WHERE world_id = $w AND affinity != 0 AND last_day < $today - $after AND (faded_day IS NULL OR faded_day < $today)`),
      addActivity: db.prepare(`INSERT INTO agent_activity (world_id, agent_id, at, world_day, world_time, kind, label, place, place_key, minutes, with_name)
        VALUES ($w, $a, $at, $day, $time, $kind, $label, $place, $key, $min, $with)`),
      activity: db.prepare('SELECT * FROM agent_activity WHERE world_id = ? AND agent_id = ? AND id < ? ORDER BY id DESC LIMIT ?'),
      todayActivity: db.prepare('SELECT * FROM agent_activity WHERE world_id = ? AND agent_id = ? AND world_day = ? ORDER BY id DESC LIMIT ?'),
      known: db.prepare('SELECT agent_id, place_key, COUNT(*) AS n, MAX(world_day) AS last FROM agent_activity WHERE world_id = ? AND place_key IS NOT NULL GROUP BY agent_id, place_key'),
      purgeActivity: db.prepare('DELETE FROM agent_activity WHERE world_id = ? AND at < ?'),
      purgeShort: db.prepare("DELETE FROM agent_memories WHERE world_id = ? AND term = 'short' AND world_day < ?"),
      overflow: db.prepare(`DELETE FROM agent_memories WHERE world_id = $w AND agent_id = $a AND term = $term AND id NOT IN (
        SELECT id FROM agent_memories WHERE world_id = $w AND agent_id = $a AND term = $term ORDER BY importance DESC, id DESC LIMIT $keep)`),
      gone: db.prepare('SELECT DISTINCT agent_id FROM agent_memories WHERE world_id = ? UNION SELECT DISTINCT agent_id FROM agent_activity WHERE world_id = ? UNION SELECT DISTINCT agent_id FROM agent_relations WHERE world_id = ?'),
    };
    this.forget = ['agent_profiles', 'agent_intentions', 'agent_memories', 'agent_relations', 'agent_activity'].map(t => db.prepare(`DELETE FROM ${t} WHERE world_id = ? AND agent_id = ?`));
  }

  get sim() { return this.simOf(); }

  attach() {
    const sim = this.sim;
    sim.actObservers.add(this.observer);
    this.agents.listeners?.add(this.onAgentsChanged);
    this.loadKnown();
    this.rebuild();
    this.timers = [setInterval(() => this.flush(), FLUSH_MS), setInterval(() => this.rebuild(), REBUILD_MS), setInterval(() => this.purge(), 3600000)];
    for (const t of this.timers) t.unref?.();
    return this;
  }
  stop() {
    for (const t of this.timers) clearInterval(t);
    this.agents.listeners?.delete(this.onAgentsChanged);
    this.sim?.actObservers.delete(this.observer);
    for (const row of this.open.values()) this.queue.push(row);
    this.open.clear();
    this.flush();
  }

  /** Every owned agent with a body in the world has a life; its stored body traits are put on the resident. */
  rebuild() {
    const sim = this.sim;
    if (!sim) return;
    const byPerson = new Map(), byAgent = new Map();
    for (const a of this.agents.list()) {
      if (!a.enabled || !a.bodyRef) continue;
      const i = this.agents.resolver.resolveBody(a.bodyRef);
      const p = i >= 0 ? sim.people[i] : null;
      if (!p || p.retired || !sim.agents[i]) continue;
      byPerson.set(i, { agentId: a.id, key: a.key, name: a.name });
      byAgent.set(a.id, i);
    }
    for (const id of this.byAgent.keys()) if (!byAgent.has(id)) { const row = this.open.get(id); if (row) { this.queue.push(row); this.open.delete(id); } }
    this.byPerson = byPerson; this.byAgent = byAgent;
  }
  loadKnown() {
    this.known.clear();
    for (const r of this.q.known.all(this.w)) {
      let m = this.known.get(r.agent_id);
      if (!m) this.known.set(r.agent_id, m = new Map());
      m.set(r.place_key, { n: r.n, lastDay: r.last });
    }
  }

  // ------------------------------------------------------------------------------------------- watching
  worldDay(t) { return this.sim.brain.day(t); }
  clockAt(t) { const b = this.sim.brain; return `${WEEKDAYS[mod(b.day(t), 7)]} ${formatClock(b.hour(t))}`; }

  /** What one planned activity means for the log (./activity.js, shared with every resident's recent activity). */
  classify(a, act) { return classifyAct(this.sim, a, act); }

  observe(a, act) {
    const c = this.classify(a, act);
    if (!c) return;
    const e = this.byPerson.get(a.i), sim = this.sim;
    const day = this.worldDay(act.holdStart), minutes = Math.max(0, Math.round((act.holdEnd - act.holdStart) * sim.clock.dayScale / 60));
    const cur = this.open.get(e.agentId);
    // one line for consecutive parts of the same activity at the same place (a shift between breaks, browsing then buying)
    if (cur && cur.$kind === c.kind && cur.$place === (c.place || null) && cur.$day === day && c.kind !== 'chat') {
      cur.$min = Math.max(cur.$min, Math.round((act.holdEnd - cur.start) * sim.clock.dayScale / 60));
      return;
    }
    if (cur) this.queue.push(cur);
    const row = { $w: this.w, $a: e.agentId, $at: this.now(), $day: day, $time: this.clockAt(act.holdStart), $kind: c.kind, $label: clean(c.label, 120),
      $place: c.place ? clean(c.place, 80) : null, $key: c.key, $min: minutes, $with: c.with ? clean(c.with.p.name, 40) : null, start: act.holdStart };
    this.open.set(e.agentId, row);
    if (c.key) this.visited(e.agentId, c, day, row.$time);
    if (c.with) {
      this.met(e.agentId, a, c.with, day, row.$time, c.place);
      // someone walked up to it and stayed (a connected agent's meet, or words said to it): the time together is the other
      // agent's too - unless its own act says so already (both meeting each other). Being sought out counts half: someone
      // who keeps following an agent around doesn't win it over as fast as time it chose
      const back = act.kind === 'talk' ? this.byPerson.get(c.with.i) : null;
      if (back && !(c.with.act?.kind === 'talk' && c.with.act.talkWith === a.i)) this.met(back.agentId, c.with, a, day, row.$time, c.place, { quiet: true, weight: 0.5 });
    }
    if (c.kind === 'visit') this.remember(e.agentId, { kind: 'event', text: c.label, importance: 2, place: c.place, day, time: row.$time });
  }

  visited(agentId, c, day, time) {
    let m = this.known.get(agentId);
    if (!m) this.known.set(agentId, m = new Map());
    const k = m.get(c.key);
    if (!k) this.remember(agentId, { kind: 'place', text: `First time at ${c.place}`, importance: 2, place: c.place, day, time });
    m.set(c.key, { n: (k?.n || 0) + 1, lastDay: day });
  }

  met(agentId, a, o, day, time, place, { quiet = false, weight = 1 } = {}) {
    const kind = o.p.vip && o.p.agentId ? 'agent' : 'resident', id = String(o.p.id), name = clean(o.p.name, 40);
    let cache = this.relCache.get(agentId);
    if (!cache) this.relCache.set(agentId, cache = new Map());
    const ck = `${kind}|${id}`;
    let r = cache.get(ck);
    if (!r) {
      const row = this.q.relation.get(this.w, agentId, kind, id);
      r = row ? this.relRow(row) : { affinity: 0, trust: 0, interactions: 0, first: day, endedUntil: null, blocked: false };
      cache.set(ck, r);
    }
    const kindness = this.traitsFor(agentId).kindness ?? 0.5;
    const before = r.affinity;
    r.interactions++;
    // (a friendship it ended grows again only after its cooling-off; one it blocked never does)
    const frozen = r.blocked || (r.endedUntil !== null && r.endedUntil > day);
    if (!frozen) {
      // a grudge thaws with time together too: from below zero it climbs back at the same pace
      r.affinity = r2(Math.min(1, r.affinity + weight * (0.03 + 0.04 * kindness) * (1 - r.affinity)));
      r.trust = r2(Math.min(1, r.trust + 0.03 * (1 - r.trust)));
    }
    this.relQueue.set(`${agentId}|${ck}`, { $w: this.w, $a: agentId, $kind: kind, $id: id, $name: name, $aff: r.affinity, $trust: r.trust, $n: r.interactions,
      $first: r.first, $last: day, $place: place ? clean(place, 80) : null, $at: this.now() });
    if (r.interactions === 1) this.remember(agentId, { kind: 'person', text: `Met ${name}${place ? ` at ${place}` : ''}`, importance: 2, place, people: [name], day, time });
    if (!quiet) this.onMet?.(agentId, o);   // (the Mind: an agent with a brain of its own may say something - server/mind/mind.js onMet)
    for (const [step, words] of FRIEND_STEPS) {
      if (!frozen && before < step && r.affinity >= step) this.remember(agentId, { term: 'long', kind: 'person', text: `Became ${words} ${name}`, importance: 3, place, people: [name], day, time });
    }
  }

  /** A memory the agent's life writes by itself (at most AUTO_PER_DAY a world day). */
  remember(agentId, m) {
    const t = this.autoToday.get(agentId);
    const n = t && t.day === m.day ? t.n : 0;
    if (n >= AUTO_PER_DAY) return;
    this.autoToday.set(agentId, { day: m.day, n: n + 1 });
    this.memQueue.push({ $w: this.w, $a: agentId, $term: m.term || 'short', $kind: m.kind, $text: clean(m.text, 240), $imp: m.importance || 1,
      $place: m.place ? clean(m.place, 80) : null, $people: JSON.stringify(m.people || []), $day: m.day, $time: m.time || null, $source: 'auto', $at: this.now() });
  }

  flush() {
    if (!this.queue.length && !this.memQueue.length && !this.relQueue.size) return;
    const acts = this.queue, mems = this.memQueue, rels = [...this.relQueue.values()];
    this.queue = []; this.memQueue = []; this.relQueue.clear();
    try {
      this.dbs.tx(() => {
        for (const r of acts) { const { start, ...row } = r; this.q.addActivity.run(row); }
        for (const m of mems) this.q.addMemory.run(m);
        for (const r of rels) this.q.putRelation.run(r);
      });
    } catch (e) { this.log?.error?.('[agent-life] writing failed:', e.message); }
  }

  purge() {
    const sim = this.sim;
    try {
      const days = Math.max(1, Number(this.configFn().activityDays) || 7);
      this.q.purgeActivity.run(this.w, this.now() - days * 86400000);
      if (sim) this.q.purgeShort.run(this.w, this.worldDay(sim.now()) - SHORT_DAYS);
      for (const id of this.byAgent.keys()) {
        this.q.overflow.run({ $w: this.w, $a: id, $term: 'short', $keep: MAX_SHORT });
        this.q.overflow.run({ $w: this.w, $a: id, $term: 'long', $keep: MAX_LONG });
      }
      // agents that were removed: their life goes with them
      const live = new Set(this.agents.list().map(a => a.id));
      for (const r of this.q.gone.all(this.w, this.w, this.w)) if (!live.has(r.agent_id)) this.forgetAgent(r.agent_id);
      this.loadKnown();
    } catch (e) { this.log?.warn?.('[agent-life] pruning failed:', e.message); }
  }
  forgetAgent(agentId) { this.dbs.tx(() => { for (const q of this.forget) q.run(this.w, agentId); }); this.known.delete(agentId); this.relCache.delete(agentId); }

  // ------------------------------------------------------------------------------------------- the profile
  person(agentId) { const i = this.byAgent.get(agentId); return i === undefined ? null : this.sim.people[i]; }
  traitsFor(agentId) {
    const a = this.agents.get(agentId);
    const row = this.q.profile.get(this.w, agentId);
    return traitsOf(a?.key || String(agentId), this.person(agentId), json(row?.traits_json, {}));
  }

  profile(agentId) {
    const a = this.agents.get(agentId);
    if (!a) throw new LifeError(404, 'not_found', 'No such agent');
    const row = this.q.profile.get(this.w, agentId), p = this.person(agentId);
    return {
      agent: { id: a.id, name: a.name, emoji: a.emoji, role: a.role, hasBody: !!p },
      traits: traitsOf(a.key, p, json(row?.traits_json, {})), flags: flagsOf(p),
      traitInfo: TRAITS.map(t => ({ key: t.key, label: t.label, low: t.low, high: t.high, body: !!t.body })),
      flagInfo: FLAGS.map(f => ({ key: f.key, label: f.label })),
      bio: row?.bio || '', values: json(row?.values_json, []), likes: json(row?.likes_json, []), dislikes: json(row?.dislikes_json, []),
      purpose: row?.purpose || '', aspirations: json(row?.aspirations_json, []), outlook: row?.outlook || '', locked: json(row?.locked_json, []),
      updated: row?.updated || null,
    };
  }

  /** The owner changes the profile. Body traits and flags go onto the resident (they change its routine too). */
  setProfile(agentId, patch, actor) {
    const cur = this.profile(agentId), a = this.agents.get(agentId);
    const next = { ...cur };
    if (patch.traits !== undefined) {
      if (!patch.traits || typeof patch.traits !== 'object') throw new LifeError(400, 'bad_traits', 'traits is { name: 0..1 }');
      next.traits = { ...cur.traits };
      for (const [k, v] of Object.entries(patch.traits)) {
        if (!isTrait(k)) throw new LifeError(400, 'bad_traits', `${String(k).slice(0, 30)} is not a trait`);
        if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw new LifeError(400, 'bad_traits', `${k} is a number from 0 to 1`);
        next.traits[k] = r2(v);
      }
    }
    if (patch.flags !== undefined) {
      if (!patch.flags || typeof patch.flags !== 'object') throw new LifeError(400, 'bad_flags', 'flags is { name: true/false }');
      next.flags = { ...cur.flags };
      for (const [k, v] of Object.entries(patch.flags)) {
        if (!FLAGS.some(f => f.key === k)) throw new LifeError(400, 'bad_flags', `${String(k).slice(0, 30)} is not a flag`);
        if (typeof v !== 'boolean') throw new LifeError(400, 'bad_flags', `${k} is true or false`);
        next.flags[k] = v;
      }
    }
    const text = (k, n) => { if (patch[k] !== undefined) { if (typeof patch[k] !== 'string') throw new LifeError(400, 'bad_text', `${k} is text`); next[k] = clean(patch[k], n); } };
    text('bio', 600); text('purpose', 200); text('outlook', 200);
    const lists = { values: [8, 60], likes: [10, 60], dislikes: [10, 60], aspirations: [5, 140] };
    for (const [k, [n, each]] of Object.entries(lists)) {
      if (patch[k] === undefined) continue;
      const v = list(patch[k], n, each);
      if (!v) throw new LifeError(400, 'bad_list', `${k} is a list of short texts`);
      next[k] = v;
    }
    if (patch.locked !== undefined) {
      const ok = new Set([...TRAIT_KEYS, ...FLAGS.map(f => f.key), 'bio', 'values', 'likes', 'dislikes', 'purpose', 'aspirations', 'outlook']);
      if (!Array.isArray(patch.locked) || patch.locked.some(k => !ok.has(k))) throw new LifeError(400, 'bad_locked', 'locked lists traits or fields of the profile');
      next.locked = [...new Set(patch.locked)];
    }
    this.q.putProfile.run({ $w: this.w, $a: agentId, $traits: JSON.stringify(storedTraits(next.traits)), $bio: next.bio, $values: JSON.stringify(next.values),
      $likes: JSON.stringify(next.likes), $dislikes: JSON.stringify(next.dislikes), $purpose: next.purpose, $asp: JSON.stringify(next.aspirations),
      $outlook: next.outlook, $locked: JSON.stringify(next.locked), $at: this.now(), $by: actor?.id ?? null });
    const i = this.byAgent.get(agentId);
    if (i !== undefined && applyBody(this.sim.people[i], next.traits, next.flags)) this.savePerson(i);
    this.audit?.log('agent.profile', { actor, detail: { agent: a.id, fields: Object.keys(patch) } });
    return this.profile(agentId);
  }

  // ------------------------------------------------------------------------------------------- plans
  today() { return this.sim ? this.worldDay(this.sim.now()) : 0; }
  intentions(agentId) {
    return this.q.intentions.all(this.w, agentId, this.now() - 86400000).map(r => ({ id: r.id, kind: r.kind, text: r.text, status: r.status, today: r.world_day !== null, source: r.source, created: r.created }));
  }
  addIntention(agentId, { kind, text, today = false }, source = 'owner') {
    if (kind !== 'must' && kind !== 'want') throw new LifeError(400, 'bad_kind', 'A plan is a "must" or a "want"');
    const t = clean(text, 140);
    if (!t) throw new LifeError(400, 'bad_text', 'Write what the plan is');
    if (this.q.countOpen.get(this.w, agentId).n >= MAX_OPEN_INTENTIONS) throw new LifeError(409, 'too_many', `At most ${MAX_OPEN_INTENTIONS} open plans; finish or drop one first`);
    const at = this.now();
    this.q.addIntention.run(this.w, agentId, today ? this.today() : null, kind, t, source, at, at);
    return this.intentions(agentId);
  }
  setIntention(agentId, id, status) {
    if (!['open', 'done', 'dropped'].includes(status)) throw new LifeError(400, 'bad_status', 'A plan is open, done or dropped');
    if (!this.q.intention.get(this.w, agentId, Number(id))) throw new LifeError(404, 'not_found', 'No such plan');
    this.q.setIntention.run(status, this.now(), this.w, agentId, Number(id));
    return this.intentions(agentId);
  }
  removeIntention(agentId, id) {
    if (!this.q.intention.get(this.w, agentId, Number(id))) throw new LifeError(404, 'not_found', 'No such plan');
    this.q.delIntention.run(this.w, agentId, Number(id));
    return this.intentions(agentId);
  }

  // ------------------------------------------------------------------------------------------- memories
  memories(agentId, { term = 'short', before = null, limit = 50 } = {}) {
    if (term !== 'short' && term !== 'long') throw new LifeError(400, 'bad_term', 'Memories are short or long term');
    this.flush();
    return this.q.memories.all(this.w, agentId, term, Number(before) > 0 ? Number(before) : Number.MAX_SAFE_INTEGER, Math.max(1, Math.min(200, Number(limit) || 50)))
      .map(r => ({ id: r.id, term: r.term, kind: r.kind, text: r.text, importance: r.importance, place: r.place, people: json(r.people_json, []), when: r.world_time, day: r.world_day, source: r.source }));
  }
  addMemory(agentId, { term = 'long', kind = 'note', text, importance = 3 }, source = 'owner') {
    if (term !== 'short' && term !== 'long') throw new LifeError(400, 'bad_term', 'Memories are short or long term');
    if (!['event', 'lesson', 'note', 'person', 'place'].includes(kind)) throw new LifeError(400, 'bad_kind', 'A memory is an event, a lesson, a note, a person or a place');
    const t = clean(text, 240);
    if (!t) throw new LifeError(400, 'bad_text', 'Write what it remembers');
    if (!Number.isInteger(importance) || importance < 1 || importance > 5) throw new LifeError(400, 'bad_importance', 'Importance is 1 to 5');
    const sim = this.sim, now = sim ? sim.now() : 0;
    this.q.addMemory.run({ $w: this.w, $a: agentId, $term: term, $kind: kind, $text: t, $imp: importance, $place: null, $people: '[]', $day: this.today(),
      $time: sim ? this.clockAt(now) : null, $source: source, $at: this.now() });
    return { ok: true };
  }
  promoteMemory(agentId, id) {
    this.flush();
    const m = this.q.memory.get(this.w, agentId, Number(id));
    if (!m) throw new LifeError(404, 'not_found', 'No such memory');
    this.q.promote.run(this.w, agentId, Number(id));
    return { ok: true };
  }
  removeMemory(agentId, id) {
    this.flush();
    if (!this.q.memory.get(this.w, agentId, Number(id))) throw new LifeError(404, 'not_found', 'No such memory');
    this.q.delMemory.run(this.w, agentId, Number(id));
    return { ok: true };
  }

  // ------------------------------------------------------------------------------------------- people and activity
  relations(agentId, limit = 50) {
    this.flush();
    const today = this.sim ? this.today() : 0;
    return this.q.relations.all(this.w, agentId, Math.max(1, Math.min(200, Number(limit) || 50))).map(r => {
      const ended = r.ended_until !== null && r.ended_until !== undefined && r.ended_until > today;
      return {
        kind: r.other_kind, id: r.other_id, name: r.other_name, affinity: r.affinity, trust: r.trust, interactions: r.interactions,
        firstDay: r.first_day, lastDay: r.last_day, lastPlace: r.last_place, note: r.note,
        level: closenessLevel(r.affinity, { ended }).key, ended, endedUntil: ended ? r.ended_until : null, blocked: !!r.blocked };
    });
  }
  /** A relation row as its cache holds it. */
  relRow(row) {
    return { affinity: row.affinity, trust: row.trust, interactions: row.interactions, first: row.first_day, lastDay: row.last_day,
      endedUntil: row.ended_until ?? null, blocked: !!row.blocked };
  }
  /** How agent `agentId` feels about someone now (written or not yet): { affinity, trust, interactions, lastDay, endedUntil,
   *  blocked } or null when it never met them. */
  relationNow(agentId, kind, id) {
    const c = this.relCache.get(agentId)?.get(`${kind}|${id}`);
    if (c) return c;
    const row = this.q.relation.get(this.w, agentId, String(kind), String(id));
    return row ? this.relRow(row) : null;
  }
  /**
   * Changes how agent `agentId` feels about someone (server/agent-social/): delta (closeness, kept within -1..1), floor/cap
   * (at most / at least), endedUntil (a world day: a friendship it ended, frozen until then; null clears), blocked. Written
   * at once (what the life still had to write first). Returns { before, after }.
   */
  changeRelation(agentId, kind, id, name, { delta = 0, atMost = null, endedUntil, blocked } = {}) {
    this.flush();
    const day = this.sim ? this.today() : 0, cur = this.relationNow(agentId, kind, String(id));
    const before = cur ? cur.affinity : 0;
    let after = Math.max(-1, Math.min(1, before + Number(delta || 0)));
    if (atMost !== null) after = Math.min(after, atMost);
    after = Math.round(after * 1000) / 1000;
    const ended = endedUntil === undefined ? (cur ? cur.endedUntil : null) : endedUntil;
    const blk = blocked === undefined ? !!cur?.blocked : !!blocked;
    this.q.setRelation.run({ $w: this.w, $a: agentId, $kind: kind, $id: String(id), $name: clean(name, 40) || 'Someone', $aff: after, $day: day, $at: this.now(),
      $ended: ended ?? null, $blocked: blk ? 1 : 0 });
    const cache = this.relCache.get(agentId), c = cache?.get(`${kind}|${id}`);
    if (c) Object.assign(c, { affinity: after, endedUntil: ended ?? null, blocked: blk });
    return { before, after };
  }
  /**
   * Time apart (server/agent-social/): every relation whose last meeting was more than afterDays world days ago moves
   * toward zero by rate a world day - close ones more slowly (rate × (1 − closeness / 2)), grudges thaw the same way.
   * Counted once a world day, however long since. Returns the agents' friendships that fell below the friend level
   * ([{ agentId, kind, id, name }]) so they can be remembered.
   */
  fade(today, { afterDays, rate, friendAt }) {
    this.flush();
    const p = { $w: this.w, $today: today, $after: afterDays };
    const before = this.q.fadeDue.all({ ...p, $friend: friendAt });
    const changed = this.q.fade.run({ ...p, $rate: rate }).changes;
    if (!changed) return { changed: 0, lost: [] };
    this.relCache.clear();
    const lost = [];
    for (const r of before) {
      const now = this.q.relation.get(this.w, r.agent_id, r.other_kind, r.other_id);
      if (now && now.affinity < friendAt) lost.push({ agentId: r.agent_id, kind: r.other_kind, id: r.other_id, name: r.other_name });
    }
    return { changed, lost };
  }
  /** A memory of its social life (an ended friendship, a date kept or missed), within the day's memories it writes itself. */
  rememberSocial(agentId, text, { term = 'short', importance = 2, people = [] } = {}) {
    const sim = this.sim, t = sim ? sim.now() : 0;
    this.remember(agentId, { term, kind: 'person', text, importance, people, day: this.today(), time: sim ? this.clockAt(t) : null });
  }
  noteRelation(agentId, kind, id, note) {
    if (!this.q.relation.get(this.w, agentId, String(kind), String(id))) throw new LifeError(404, 'not_found', 'It does not know them yet');
    this.q.noteRelation.run(clean(note, 140), this.now(), this.w, agentId, String(kind), String(id));
    return this.relations(agentId);
  }
  activity(agentId, { before = null, limit = 60 } = {}) {
    this.flush();
    const rows = this.q.activity.all(this.w, agentId, Number(before) > 0 ? Number(before) : Number.MAX_SAFE_INTEGER, Math.max(1, Math.min(300, Number(limit) || 60)));
    const out = rows.map(r => ({ id: r.id, when: r.world_time, day: r.world_day, kind: r.kind, label: r.label, place: r.place, minutes: r.minutes, with: r.with_name }));
    const cur = !before && this.open.get(agentId);
    if (cur) out.unshift({ id: null, when: cur.$time, day: cur.$day, kind: cur.$kind, label: cur.$label, place: cur.$place, minutes: cur.$min, with: cur.$with, now: true });
    return out;
  }

  // ------------------------------------------------------------------------------------------- for decisions
  /**
   * What Free Will (and later the Mind) is told about the agent: { personality, purpose, aspirations, plans, memories,
   * earlier, known(placeKey) }. Small on purpose; ids are never in it.
   */
  contextFor(agentId) {
    const a = this.agents.get(agentId);
    if (!a) return null;
    const row = this.q.profile.get(this.w, agentId), p = this.person(agentId);
    const day = this.today();
    const traits = traitsOf(a.key, p, json(row?.traits_json, {}));
    const plans = this.q.openIntentions.all(this.w, agentId, day, 3).map(r => `${r.kind === 'must' ? 'must' : 'wants to'} ${r.text}`);
    const mem = this.q.recall.all(this.w, agentId, day - 1).sort((x, y) => (y.importance - x.importance) || (y.id - x.id)).slice(0, 3).map(r => r.text);
    const earlier = [];
    const cur = this.open.get(agentId);
    if (cur && cur.$day === day && cur.$kind !== 'sleep') earlier.push({ clock: cur.$time.split(' ').slice(1).join(' '), label: cur.$label });
    for (const r of this.q.todayActivity.all(this.w, agentId, day, 6)) {
      if (earlier.length >= 3) break;
      if (r.kind === 'sleep' || r.kind === 'work') continue;
      earlier.push({ clock: r.world_time.split(' ').slice(1).join(' '), label: r.label });
    }
    const known = this.known.get(agentId);
    return {
      personality: traitWords(traits, flagsOf(p)), spontaneity: traits.spontaneity, bio: row?.bio || '', purpose: row?.purpose || '',
      aspirations: json(row?.aspirations_json, []).slice(0, 2), likes: json(row?.likes_json, []).slice(0, 3), dislikes: json(row?.dislikes_json, []).slice(0, 3),
      plans, memories: mem, earlier: earlier.reverse(), familiarity: key => (known && known.get(key)?.n) || 0,
    };
  }
}
