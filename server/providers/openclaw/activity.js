// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What an OpenClaw gateway's agents are doing, whatever started it (docs/features/agent-providers.md §3, live presence):
// this installation's chats, OpenClaw's other channels, its scheduled jobs and heartbeats. The gateway's own session feed
// - sessions.subscribe, then sessions.changed: the rows its Control UI shows, each with hasActiveRun - says which of its
// sessions have a turn running, without following every session's events. Per agent, working or not (and in how many
// sessions, and which: the chat window marks those chats working) goes to the provider bus as agent.activity; the presence
// coordinator decides the rest (server/presence-coordinator.js).

const SNAPSHOT = { limit: 200, sortBy: 'activity' };   // (a session with a turn running is among the most recently active)
const SETTLE_MS = 250;                                  // (a burst of changes - a turn starting - is reported once; a turn shorter than this isn't shown)

export class LinkActivity {
  /** @param {import('./link.js').GatewayLink} link  @param {{ emit: (e: object) => void, kind: string }} o */
  constructor(link, { emit, kind }) {
    Object.assign(this, { link, emit, kind });
    this.rows = new Map();   // session key → { agentId, title } of a session with a turn running
    this.sent = new Map();   // agent id → what was last reported for it
    this.timer = null;
  }
  /** (Re)connected: the subscription is the connection's, so it is taken again, with the sessions as they are now. */
  async onHello() {
    if (!this.link.offers('sessions.subscribe')) return;
    try {
      const r = await this.link.request('sessions.subscribe', SNAPSHOT, { timeoutMs: 20000 });
      this.rows.clear();
      for (const s of (r && r.list && Array.isArray(r.list.sessions) ? r.list.sessions : [])) this.take(s);
      this.flush();
    } catch { /* presence from this installation's own runs still works */ }
  }
  /** The connection went: nothing is known to be running any more. */
  onDown() { clearTimeout(this.timer); this.timer = null; this.rows.clear(); this.flush(); }
  /** A sessions.changed event: its row (the nested one wins; the top level clears what it omits). */
  onEvent(evt) {
    if (!evt || evt.event !== 'sessions.changed') return;
    const p = evt.payload || {}, s = p.session || null, key = (s && s.key) || p.sessionKey || p.key;
    if (!key) return;
    const active = s && typeof s.hasActiveRun === 'boolean' ? s.hasActiveRun : p.hasActiveRun;
    if (typeof active !== 'boolean') return;
    this.take({ ...(s || {}), key, agentId: (s && s.agentId) || p.agentId, hasActiveRun: active });
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, SETTLE_MS);
  }
  take(s) {
    if (!s || !s.key) return;
    if (s.hasActiveRun && s.agentId) this.rows.set(String(s.key), { agentId: String(s.agentId), title: String(s.label || s.derivedTitle || s.displayName || '').slice(0, 80) });
    else this.rows.delete(String(s.key));
  }
  /** Each agent whose state changed, to the bus. */
  flush() {
    const by = new Map();
    for (const [key, r] of this.rows) {
      const x = by.get(r.agentId) || { sessions: 0, title: '', keys: [] };
      x.sessions += 1; x.keys.push(key); if (!x.title && r.title) x.title = r.title;
      by.set(r.agentId, x);
    }
    for (const agentId of new Set([...by.keys(), ...this.sent.keys()])) {
      const x = by.get(agentId), sig = x ? `${x.sessions}|${x.title}|${x.keys.sort().join(' ')}` : '';
      if ((this.sent.get(agentId) || '') === sig) continue;
      if (x) this.sent.set(agentId, sig); else this.sent.delete(agentId);
      try {
        this.emit({ type: 'agent.activity', kind: this.kind, connectionId: this.link.connectionId, agentKey: agentId, active: !!x, sessions: x ? x.sessions : 0,
          keys: x ? x.keys : [], ...(x && x.title ? { task: `Working on “${x.title}”` } : {}) });
      } catch { /* the bus refused one event */ }
    }
  }
}
