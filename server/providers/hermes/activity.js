// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a Hermes backend's agents (its profiles) are doing, whatever started it (docs/features/agent-providers.md §3, live
// presence; §9). Hermes says it two ways, both read here:
// - its backend process's live sessions (session.active_list, per profile: idle, starting, working, streaming, waiting,
//   resuming) — every chat it runs itself: this installation's, its Desktop's and its dashboard's;
// - the stored sessions of every channel (its messaging gateway — Telegram and the rest — and its scheduled jobs write
//   their progress into the same session store: a session not ended whose agent recorded activity within the last
//   ACTIVE_WINDOW_S is at work). Hermes records that progress at most about once a minute during a turn, so a turn there
//   shows a little late and lingers a little after it ends.
// Read again when Hermes says its sessions changed (sessions.changed, settled), and every POLL_MS while connected. Per
// agent, working or not (and in which sessions: the chat window marks those chats) goes to the bus as agent.activity.
const SETTLE_MS = 400;
const POLL_MS = 20000;
const ACTIVE_WINDOW_S = 75;
const BUSY = new Set(['starting', 'working', 'streaming', 'waiting', 'resuming']);

export class LinkActivity {
  /** @param {import('./link.js').HermesLink} link  @param {{ emit: (e: object) => void, kind: string, profiles: () => string[] }} o */
  constructor(link, { emit, kind, profiles }) {
    Object.assign(this, { link, emit, kind, profiles });
    this.sent = new Map(); this.timer = null; this.poll = null; this.reading = false; this.again = false;
  }
  onReady() {
    clearInterval(this.poll);
    this.poll = setInterval(() => this.soon(), POLL_MS); this.poll.unref?.();
    this.soon();
  }
  onDown() { clearInterval(this.poll); this.poll = null; clearTimeout(this.timer); this.timer = null; this.report(new Map()); }
  onEvent(evt) { if (evt && evt.type === 'sessions.changed') this.soon(); }
  soon() { if (!this.timer) { this.timer = setTimeout(() => { this.timer = null; this.read(); }, SETTLE_MS); this.timer.unref?.(); } }
  async read() {
    if (this.reading) { this.again = true; return; }
    if (!this.link.connected) return;
    this.reading = true;
    try {
      const now = Date.now() / 1000, by = new Map();
      const add = (profile, key, title, waiting = false) => {
        const x = by.get(profile) || { keys: new Set(), waiting: new Set(), title: '' };
        x.keys.add(key); if (waiting) x.waiting.add(key); if (!x.title && title) x.title = title;
        by.set(profile, x);
      };
      for (const profile of this.profiles()) {
        const [live, rows] = await Promise.all([
          this.link.request('session.active_list', { profile }, { timeoutMs: 10000 }).catch(() => null),
          this.link.rest('GET', '/api/sessions', { query: { profile, limit: 25 }, timeoutMs: 10000 }).catch(() => null)]);
        // (Hermes' live list is its whole process's, every profile's: a session counts for this one when it is in its store)
        const mine = new Set((rows && Array.isArray(rows.sessions) ? rows.sessions : []).map(s => s && String(s.id)));
        // (a session this process runs says how it stands itself — idle, working, waiting for the person: as its Desktop
        // reads it; the activity window below is only for the other channels, which write their progress late)
        const inProcess = new Set();
        for (const s of (live && Array.isArray(live.sessions) ? live.sessions : [])) {
          if (!s.session_key || !mine.has(String(s.session_key))) continue;
          inProcess.add(String(s.session_key));
          if (BUSY.has(s.status)) add(profile, String(s.session_key), String(s.title || ''), s.status === 'waiting');
        }
        for (const s of (rows && Array.isArray(rows.sessions) ? rows.sessions : [])) {
          if (!s || !s.id || s.ended_at || s.parent_session_id || !Number.isFinite(s.last_activity_at) || inProcess.has(String(s.id))) continue;
          if (now - s.last_activity_at < ACTIVE_WINDOW_S) add(profile, String(s.id), String(s.title || ''));
        }
      }
      this.report(by);
    } finally {
      this.reading = false;
      if (this.again) { this.again = false; this.soon(); }
    }
  }
  report(by) {
    for (const profile of new Set([...by.keys(), ...this.sent.keys()])) {
      const x = by.get(profile), keys = x ? [...x.keys].sort() : [], waiting = x ? [...x.waiting].sort() : [];
      const sig = x ? `${keys.join(' ')}|${waiting.join(' ')}|${x.title}` : '';
      if ((this.sent.get(profile) || '') === sig) continue;
      if (x) this.sent.set(profile, sig); else this.sent.delete(profile);
      try {
        this.emit({ type: 'agent.activity', kind: this.kind, connectionId: this.link.connectionId, agentKey: profile, active: !!x, sessions: keys.length, keys, ...(waiting.length ? { waiting } : {}),
          ...(x && x.title ? { task: `Working on “${x.title.slice(0, 80)}”` } : {}) });
      } catch { /* the bus refused one event */ }
    }
  }
}
