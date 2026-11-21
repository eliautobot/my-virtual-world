// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The diary (docs/features/awareness.md §1): what happened to each AI agent lately, as short lines with the world time —
// got into a car, arrived somewhere, someone came over, what was said near it, a co-worker late, a catch landed. It only
// records; the reader (./senses.js look, recent) reads it. Kept in memory, the last MAX lines an agent lived and the last
// EARS_MAX it heard or said (apart: a busy room's talk never pushes out what it did); a restart starts it again — these
// are moments, not its life (its life is server/agent-life/).
//
// The same line about the same thing again close together is one line (an owner stepping back and forth at the edge of
// "near" is not twenty lines): `key` names the thing; the same key and words as its last line within MERGE_MS replace it.

export const MAX = 60;              // lines of what it lived kept per agent
export const EARS_MAX = 24;         // lines heard and said kept per agent
export const MERGE_MS = 15000;      // a line with the same key and words this soon after the last replaces it
const EARS = new Set(['heard', 'said']);
// (control characters out; «…» kept: what others said stays marked as their words, never instructions)
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export class Diary {
  /** @param {{ now?: () => number, clock?: (t: number) => string }} o  now: real ms; clock: the world's time in words */
  constructor({ now = () => Date.now(), clock = () => '' } = {}) {
    this.now = now; this.clock = clock;
    this.lines = new Map();    // agent id → { lived: [line], ears: [line] }; line { n, at, clock, kind, text, key? }
    this.seq = 0;
    this.listeners = new Set();   // (agent id, line) for each line written (Free Will's moments: server/free-will/moments.js)
  }
  /** Calls fn(agentId, line) for each new line; returns a function that stops it. */
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /**
   * Writes a line in agent `id`'s diary. kind: 'move' | 'with' | 'heard' | 'said' | 'work' | 'activity' | 'note'. Returns
   * the line, or null (nothing to write).
   */
  add(id, kind, text, { key = null, at = this.now() } = {}) {
    const t = clean(text, 240);
    if (!Number.isInteger(id) || !t) return null;
    let d = this.lines.get(id);
    if (!d) this.lines.set(id, d = { lived: [], ears: [] });
    const k = String(kind || 'note'), list = EARS.has(k) ? d.ears : d.lived, cap = EARS.has(k) ? EARS_MAX : MAX;
    const line = { n: ++this.seq, at, clock: this.clock(at), kind: k, text: t, ...(key ? { key: String(key) } : {}) };
    const last = list[list.length - 1];
    if (key && last && last.key === line.key && last.text === line.text && at - last.at < MERGE_MS) list[list.length - 1] = line;
    else list.push(line);
    if (list.length > cap) list.splice(0, list.length - cap);
    for (const fn of this.listeners) { try { fn(id, line); } catch { /* a listener's own business */ } }
    return line;
  }
  /** Agent id's lines, oldest first: all, those after `since` (ms), the last `limit`. */
  read(id, { since = null, limit = MAX + EARS_MAX } = {}) {
    const d = this.lines.get(id);
    if (!d) return [];
    const all = d.ears.length ? [...d.lived, ...d.ears].sort((a, b) => a.n - b.n) : d.lived;
    const from = Number.isFinite(since) ? all.filter(l => l.at > since) : all;
    return from.slice(-Math.max(0, limit)).map(({ key, ...l }) => l);
  }
  /** The time of agent id's last line (0: none). */
  lastAt(id) { const r = this.read(id, { limit: 1 }); return r.length ? r[0].at : 0; }
  forget(id) { this.lines.delete(id); }
  stats() { let n = 0; for (const d of this.lines.values()) n += d.lived.length + d.ears.length; return { diaries: this.lines.size, lines: n }; }
}
