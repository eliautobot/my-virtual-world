// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Reputation and trust (docs/features/ECONOMY.md §8.3; jobs plan addendum 3): standing is earned, never bought or
// transferred. Each subject (a player or an agent) has scores by dimension - pay (paying rent on time, honouring payment
// requests, no debts) and work (the stars customers give) - from 0 to 1000, starting at 500 ("new"). Earning is slow,
// losing quicker (trust, not a counter). Every change is an append-only event; one with a reference counts once.
// Trust (0–5 stars) is their blend; it shows with every wallet, orders the shift board and lets owners ask for a minimum.
const START = 500;
export const DIMS = Object.freeze(['pay', 'work']);
const clamp = v => Math.max(0, Math.min(1000, v));

export class Trust {
  /** @param {import('./economy.js').Economy} econ */
  constructor(econ) {
    this.e = econ; this.db = econ.db; this.w = econ.w;
    const db = this.db;
    this.q = {
      get: db.prepare('SELECT dim, score, n FROM econ_rep WHERE world_id = ? AND subject = ?'),
      put: db.prepare(`INSERT INTO econ_rep (world_id, subject, dim, score, n, updated) VALUES ($w, $s, $dim, $score, 1, $at)
        ON CONFLICT (world_id, subject, dim) DO UPDATE SET score = $score, n = n + 1, updated = $at`),
      event: db.prepare('INSERT OR IGNORE INTO econ_rep_events (world_id, subject, dim, delta, reason, ref, at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      recent: db.prepare('SELECT dim, delta, reason, at FROM econ_rep_events WHERE world_id = ? AND subject = ? ORDER BY seq DESC LIMIT ?'),
    };
  }
  /**
   * Changes a subject's score in one dimension. Gains shrink as the score rises (slow to earn); losses don't (quick to
   * lose). ref: a reference that makes the event count once (a debt's id, an order). Returns the new score.
   */
  note(subject, dim, delta, reason, ref = null) {
    if (!DIMS.includes(dim) || !delta) return null;
    const s = typeof subject === 'string' ? subject : `${subject.kind}:${subject.id}`;
    if (!/^(account|agent):/.test(s)) return null;   // residents' standing is the simulation's
    return this.e.dbs.tx(() => {
      const r = this.q.event.run(this.w, s, dim, Math.round(delta), String(reason).slice(0, 60), ref == null ? null : String(ref).slice(0, 120), this.e.now());
      if (!r.changes) return null;   // counted already
      const cur = this.q.get.all(this.w, s).find(x => x.dim === dim)?.score ?? START;
      const eff = delta > 0 ? delta * (1 - cur / 1200) : delta;
      const next = clamp(Math.round(cur + eff));
      this.q.put.run({ w: this.w, s, dim, score: next, at: this.e.now() });
      return next;
    });
  }
  /** A subject's standing: each dimension, the trust in stars (0–5), a word for it, and the latest events. */
  of(subject, { events = 0 } = {}) {
    const s = typeof subject === 'string' ? subject : `${subject.kind}:${subject.id}`;
    const rows = this.q.get.all(this.w, s), dims = {};
    let n = 0;
    for (const d of DIMS) { const r = rows.find(x => x.dim === d); dims[d] = r ? r.score : START; n += r ? r.n : 0; }
    const score = Math.round(dims.pay * 0.5 + dims.work * 0.5), stars = Math.round(score / 200 * 10) / 10;
    const word = n < 5 ? 'New' : stars >= 4.2 ? 'Highly trusted' : stars >= 3.4 ? 'Trusted' : stars >= 2.4 ? 'Building trust' : 'Low trust';
    return { score, stars, word, dims, events: n, ...(events ? { recent: this.q.recent.all(this.w, s, events) } : {}) };
  }
}
