// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The activity log (PLAN WP1.8, DECISIONS C116): world edits from the journal (kept) and live events - residents
// arriving, AI agents starting and stopping work, players joining and leaving, undos and redos - of which the latest
// 200 stay in memory for pages opened later. Readers need activity.read; an agent's task text only goes to accounts
// with agents.view_tasks.
export class Activity {
  constructor({ journal, perms, now = () => Date.now(), keep = 200 }) {
    this.journal = journal; this.perms = perms; this.now = now; this.keep = keep;
    this.ring = []; this.seq = 0; this.listeners = new Set();
    this.boot = now().toString(36);   // live ids stay unique across restarts
    journal.listeners.add(m => {
      if (m.live) this.add(m.live);
      else this.emit(m);
    });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(m) { for (const fn of this.listeners) { try { fn(m); } catch { /* ignore */ } } }
  /** Adds a live line: { kind, text, actor?, place?, task? }. */
  add(ev) {
    const item = { id: `l${this.boot}.${++this.seq}`, at: this.now(), ...ev };
    this.ring.push(item);
    if (this.ring.length > this.keep) this.ring.shift();
    this.emit({ item });
    return item;
  }
  /** What one reader may see of a line: task text only with agents.view_tasks. */
  view(item, P) {
    if (item && item.task !== undefined && !this.perms.allowed(P, 'agents.view_tasks')) {
      const { task, ...rest } = item;
      return rest;
    }
    return item;
  }
  /** The log for one reader, newest first: world edits and live lines before a time (ms). */
  list(P, { before = null, limit = 50 } = {}) {
    const b = Number.isFinite(before) && before > 0 ? before : Number.MAX_SAFE_INTEGER;
    const n = Math.max(1, Math.min(200, limit | 0 || 50));
    const all = [...this.journal.list({ before: b, limit: n }), ...this.ring.filter(x => x.at < b)]
      .sort((x, y) => y.at - x.at || (y.n || 0) - (x.n || 0)).slice(0, n);
    return { items: all.map(x => this.view(x, P)), more: all.length === n };
  }
}
