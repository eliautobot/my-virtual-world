// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A circuit breaker per connection (the Mind's brains, Free Will's decision services): a connection that keeps failing
// is left alone for a while instead of being called again and again. Closed → open → half-open:
// - Failures in a row (after) open it for a while (baseMs, doubling up to maxMs).
// - A fault its owner fixes themselves — no credit left, a refused key (longCodes) — opens it at once, but only briefly:
//   a minute, doubling up to probeMaxMs (5 minutes). Waiting longer would keep a refilled account idle for nothing.
// - When the time is up it is half-open: ONE call goes through as the trial (allow() marks it) and its result closes the
//   breaker (ok) or opens it again (fail). Others wait for that answer, so a broken provider is never called in a burst.
// - A person's own request (allow({ person: true })) may be the trial at once when the breaker opened on such a fault:
//   whoever just added credit or a new key gets an answer the moment they ask, never "try again in a few minutes".
//   A request made to find out (allow({ force: true }): an owner's "think now", a connection's test) is the trial at once
//   whatever the fault.
// A trial that ends without hearing from the provider gives the trial back (release); one never resolved is let go
// after trialMs. No timers: state is only read and written by the calls themselves.
export class Breakers {
  constructor({ after, baseMs, maxMs, longCodes = ['auth', 'quota'], probeMs = 60000, probeMaxMs = 300000, trialMs = 660000, now = () => Date.now(), log = null, name = 'connection' } = {}) {
    Object.assign(this, { after, baseMs, maxMs, long: new Set(longCodes), probeMs, probeMaxMs, trialMs, now, log, name });
    this.map = new Map();   // connection id → { fails, openUntil, backoff, probe, code, long, trialAt }
  }
  get(id) {
    const b = this.map.get(id);
    if (b && b.trialAt && this.now() - b.trialAt > this.trialMs) b.trialAt = 0;   // (a trial that never came back)
    return b;
  }
  /** Whether calls to `id` are held back now (paused, or a trial is under way). Reads only. */
  open(id) { const b = this.get(id); return !!b && (!!b.trialAt || b.openUntil > this.now()); }
  /** Whether a call may go to `id` now; when it is the trial of a paused connection, it is marked as the trial. */
  allow(id, { person = false, force = false } = {}) {
    const b = this.get(id);
    if (!b || (!b.openUntil && !b.trialAt)) return true;
    if (b.trialAt) return false;
    if (b.openUntil > this.now() && !force && !(person && b.long)) return false;
    b.trialAt = this.now();
    return true;
  }
  fail(id, code) {
    const b = this.get(id) || { fails: 0, openUntil: 0, backoff: this.baseMs, probe: 0 };
    const t = this.now(), wasTrial = !!b.trialAt;
    b.trialAt = 0; b.fails++; b.code = code;
    if (this.long.has(code)) {
      b.long = true; b.probe = Math.min(this.probeMaxMs, b.probe ? b.probe * 2 : this.probeMs); b.openUntil = t + b.probe; b.fails = 0;
      this.log?.warn?.(`[breaker] ${this.name} ${id}: ${code} — paused ${Math.round(b.probe / 1000)} s, then one trial call (a person's own request may try at once)`);
    } else if (wasTrial || b.fails >= this.after) {
      b.long = false; b.openUntil = t + b.backoff; b.backoff = Math.min(this.maxMs, b.backoff * 2); b.fails = 0;
      this.log?.warn?.(`[breaker] ${this.name} ${id}: paused ${Math.round((b.openUntil - t) / 1000)} s after failures (${code})`);
    }
    this.map.set(id, b);
  }
  /** It answered: closed, forgotten. */
  ok(id) { this.map.delete(id); }
  /** A trial that ended without hearing from the provider (the call never went out): the next one may try. */
  release(id) { const b = this.map.get(id); if (b) b.trialAt = 0; }
  /** Why it is held back, for the person asking: { code, until, trial } or null. */
  state(id) {
    const b = this.get(id);
    if (!b || (!b.trialAt && !(b.openUntil > this.now()))) return null;
    return { code: b.code || null, until: b.openUntil || null, trial: !!b.trialAt, fixable: !!b.long };
  }
  /** The connections held back now: [{ id, code, until, trial, fixable }]. */
  list() { return [...this.map.keys()].map(id => [id, this.state(id)]).filter(([, s]) => s).map(([id, s]) => ({ id, ...s })); }
}

/** One line for a person whose agent's brain (or service) is held back: what is wrong and what fixes it. */
export function pausedWords(name, st) {
  const who = name ? `${name}'s` : 'Its';
  if (st?.code === 'quota') return `${who} AI provider account has no credit left. Add credit to it — it works again the moment the account has funds.`;
  if (st?.code === 'auth') return `${who} AI provider refused its API key. Put a working key in its connection (Settings → Connections) — it works again at once.`;
  if (st?.code === 'blocked') return `${who} AI provider is at an address this server may not reach. Check the connection's address.`;
  return `${who} brain isn't answering at the moment; try again in a minute.`;
}
