// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The presence coordinator (PLAN WP2.3; DECISIONS A8, C120; CHECKLIST I8.6): the one place that decides whether an agent is
// offline, idle, working, finishing or waiting for an approval. It listens to the provider event bus, so every provider feeds the
// same rules.
//   - a run keeps its agent "working" while events arrive; a run that goes quiet is watched, not dropped, up to a limit
//   - a run that ends, fails, is stopped or is interrupted finishes normally: a short "finishing" grace, then idle, with the error kept
//   - a provider or helper restart ends its runs as interrupted; nobody stays "working" forever
//   - "meeting" is derived later (WP2.10) and is reported false until then
const WORKING = new Set(['working', 'finishing', 'awaiting_approval']);
const TASK_MAX = 100;
const ERROR_MAX = 300;
const ENDED_KEEP = 500;
const one = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const OFFLINE = Object.freeze({ working: false, state: 'offline', task: '', meeting: false, since: null, lastRunError: null, source: null });

export class PresenceCoordinator {
  /**
   * @param {{ bus, agents, connections, registry, limits?: () => { graceMs?: number, quietMs?: number },
   *   onChange?: (key: string, info: object, extra: { workingChanged: boolean }) => void, now?: () => number, log?: object }} o
   */
  constructor({ bus, agents, connections, registry, limits = () => ({}), online = null, onChange = null, quietRun = null, now = () => Date.now(), log = null }) {
    // online(key): false when a connected agent (WP2.14) has no live session, so it shows offline instead of idle; undefined for the rest
    // quietRun(runId): true for a run that isn't work to show — a talk in the city (server/agent-talk/): private, the
    // agent standing with whom it talks, never "started working" for everyone to see
    Object.assign(this, { bus, agents, connections, registry, limits, online, onChange, quietRun, now, log });
    this.by = new Map();      // agent key → { key, runs: Map runId → run, lastRunError, finishingUntil }
    this.ended = new Map();   // runId → when it ended (late events for it are ignored)
    this.last = new Map();    // agent key → { sig, since, working } of the last state reported
    this.unsub = bus.on(e => { try { this.handle(e); } catch (err) { this.log?.error?.('[presence] event failed:', err.message); } });
  }

  limitsNow() {
    const l = this.limits() || {};
    return { graceMs: Number.isFinite(l.graceMs) ? l.graceMs : 8000, quietMs: Number.isFinite(l.quietMs) ? l.quietMs : 60 * 60000 };
  }
  start(intervalMs = 1000) { if (this.timer) return; this.timer = setInterval(() => this.tick(), intervalMs); this.timer.unref?.(); }
  stop() { clearInterval(this.timer); this.timer = null; this.unsub?.(); }

  // ---------------------------------------------------------------- who
  /** Whether an agent talks through an enabled connection whose adapter exists. */
  linked(a) {
    if (!a || !a.enabled || !a.connectionId) return false;
    const c = this.connections.get(a.connectionId);
    return !!(c && c.enabled && this.registry.implemented(c.kind));
  }
  /** True when anything can report presence: an agent linked to a provider. */
  live() { return this.agents.list().some(a => this.linked(a)); }
  /** The agent a run's events are about: its own key first — the server's own brain (the Mind) names the agent by its key,
   *  and every agent on it shares one platform id ('mind'), so that id alone would name the first of them — else the
   *  platform's id for it on that connection (an agent platform names its agents its own way). */
  agentOf(e) {
    if (!e.agentKey || e.connectionId === undefined) return null;
    const on = this.agents.list().filter(a => a.connectionId && String(a.connectionId) === String(e.connectionId));
    return on.find(a => a.key === e.agentKey) || on.find(a => (a.nativeId || a.key) === e.agentKey) || null;
  }
  slot(key) { let s = this.by.get(key); if (!s) this.by.set(key, s = { key, runs: new Map(), lastRunError: null, finishingUntil: 0 }); return s; }

  // ---------------------------------------------------------------- events
  handle(e) {
    if (e.type === 'provider.disconnected') return this.dropConnection(e.connectionId, e.reason);
    if (e.type === 'agent.activity') return this.activity(e);
    if (!e.runId || this.ended.has(e.runId) || this.quietRun?.(e.runId)) return;
    const a = this.agentOf(e);
    if (!a) return;
    const st = this.slot(a.key), now = this.now();
    let run = st.runs.get(e.runId);
    if (!run) {   // a missed run.start is adopted, so an agent that works is never shown idle
      run = { kind: e.kind, connectionId: String(e.connectionId), agentKey: e.agentKey, sessionKey: e.sessionKey, startedAt: now, lastEventAt: now, task: '', approvals: new Set() };
      st.runs.set(e.runId, run);
    }
    run.lastEventAt = now;
    switch (e.type) {
      case 'run.progress': if (e.text) run.task = one(e.text, TASK_MAX); break;
      case 'tool.start': run.task = one(`Using ${e.name}`, TASK_MAX); break;
      case 'approval.requested': run.approvals.add(e.approvalId); break;
      case 'approval.resolved': run.approvals.delete(e.approvalId); break;
      case 'run.end':
        st.runs.delete(e.runId); this.markEnded(e.runId);
        st.lastRunError = e.status === 'error' ? one(e.error || 'The run failed', ERROR_MAX) : e.status === 'interrupted' ? one(e.error || 'The run was interrupted', ERROR_MAX) : null;
        if (!st.runs.size) st.finishingUntil = now + this.limitsNow().graceMs;
        break;
      default: break;
    }
    this.refresh(a.key);
  }
  /** What a provider says its agent is doing, whatever started it (Agent Providers: OpenClaw's own session feed — its
   *  other channels, its schedules): working while it says so, then the usual finishing grace. */
  activity(e) {
    const a = this.agentOf(e);
    if (!a) return;
    const st = this.slot(a.key), now = this.now();
    if (e.active) st.external = { connectionId: String(e.connectionId), task: one(e.task || '', TASK_MAX), since: (st.external && st.external.since) || now };
    else if (st.external) { st.external = null; if (!st.runs.size) st.finishingUntil = now + this.limitsNow().graceMs; }
    this.refresh(a.key);
  }
  /** A provider connection went away: its runs are over (the host also reports each as interrupted; this is the safety net). */
  dropConnection(connectionId, reason) {
    const now = this.now(), touched = [];
    for (const st of this.by.values()) {
      let hit = false;
      for (const [id, r] of [...st.runs]) {
        if (r.connectionId !== String(connectionId)) continue;
        st.runs.delete(id); this.markEnded(id); hit = true;
        st.lastRunError = one(reason || 'The provider disconnected', ERROR_MAX);
      }
      if (st.external && st.external.connectionId === String(connectionId)) { st.external = null; hit = true; }
      if (hit) { if (!st.runs.size) st.finishingUntil = now + this.limitsNow().graceMs; touched.push(st.key); }
    }
    for (const k of touched) this.refresh(k);
  }
  markEnded(runId) {
    this.ended.set(runId, this.now());
    if (this.ended.size > ENDED_KEEP) for (const k of this.ended.keys()) { this.ended.delete(k); if (this.ended.size <= ENDED_KEEP) break; }
  }

  // ---------------------------------------------------------------- time
  /** Runs that went quiet past the limit end as interrupted; finishing graces expire; state changes are reported. */
  tick() {
    const now = this.now(), { quietMs, graceMs } = this.limitsNow();
    const stale = [];
    for (const st of this.by.values()) for (const [id, r] of st.runs) if (now - r.lastEventAt > quietMs) stale.push([st, id, r]);
    for (const [st, id, r] of stale) {
      st.runs.delete(id); this.markEnded(id);
      st.lastRunError = `No activity for ${Math.round(quietMs / 60000)} minutes; the run was marked finished`;
      if (!st.runs.size) st.finishingUntil = now + graceMs;
      // tell the chat as well, so its session is free again
      try { this.bus.emit({ type: 'run.end', kind: r.kind, connectionId: r.connectionId, agentKey: r.agentKey, sessionKey: r.sessionKey, runId: id, status: 'interrupted', error: st.lastRunError }); } catch { /* the run is over here regardless */ }
    }
    for (const key of new Set([...this.by.keys(), ...this.last.keys()])) this.refresh(key);
    for (const [id, at] of this.ended) if (now - at > 10 * 60000) this.ended.delete(id);
  }

  // ---------------------------------------------------------------- reading
  /** The presence of one agent, or null when nothing reports on it (the world then treats it as not present). */
  info(key) {
    const now = this.now(), st = this.by.get(key);
    let state = null, task = '';
    if (st) {
      if (st.runs.size) {
        let newest = null;
        for (const r of st.runs.values()) if (!newest || r.lastEventAt >= newest.lastEventAt) newest = r;
        state = [...st.runs.values()].some(r => r.approvals.size) ? 'awaiting_approval' : 'working';
        task = newest.task || (st.external && st.external.task) || '';
      } else if (st.external) { state = 'working'; task = st.external.task || ''; }   // (at work elsewhere: its provider says so)
      else if (st.finishingUntil > now) state = 'finishing';
    }
    if (!state) {
      const a = this.agents.byKey(key);
      if (!a || !this.linked(a)) return null;
      if (this.online && this.online(key) === false) return null;
      state = 'idle';
    }
    return { working: WORKING.has(state), state, task, meeting: false, since: this.last.get(key)?.since ?? null, lastRunError: st ? st.lastRunError : null, source: 'provider' };
  }
  /** Like info(), but an agent nothing reports on is shown offline. */
  stateOf(key) { return this.info(key) || { ...OFFLINE }; }
  isWorking(key) { return !!(key && this.info(key)?.working); }
  workingList() {
    const out = new Set();
    for (const key of this.by.keys()) if (this.info(key)?.working) out.add(key);
    return [...out];
  }
  snapshot(ids) { const o = {}; for (const id of ids) { const i = this.info(id); if (i) o[id] = i; } return o; }
  status() {
    let runs = 0; for (const st of this.by.values()) runs += st.runs.size;
    const { graceMs, quietMs } = this.limitsNow();
    return { activeRuns: runs, working: this.workingList().length, finishGraceSec: Math.round(graceMs / 1000), quietLimitMin: Math.round(quietMs / 60000) };
  }

  // ---------------------------------------------------------------- reporting
  /** Reports a change of state (not of task text) to the world; the first look at an idle agent is only a baseline. */
  refresh(key) {
    const i = this.info(key), sig = i ? i.state : 'none', prev = this.last.get(key);
    if (prev && prev.sig === sig) return;
    this.last.set(key, { sig, since: this.now(), working: !!(i && i.working) });
    // The first sighting of an agent is not news when it is offline (pages assume that); an agent that first shows as idle or working is
    // (a connected agent signing in for the first time, WP2.14), or open pages would keep showing it offline.
    if (!this.onChange || (!prev && (!i || i.state === 'offline'))) return;
    const s = this.info(key) || { ...OFFLINE };
    try { this.onChange(key, s, { workingChanged: (prev ? prev.working : false) !== s.working }); } catch (err) { this.log?.error?.('[presence] change handler failed:', err.message); }
  }
}
