// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The provider host: one supervised helper process that runs every adapter (PLAN WP2.2; DECISIONS A9, C120).
// - The world simulation never waits on a provider: while the helper is down, call() fails at once with host_down.
// - The helper starts with a minimal environment, so the server's secrets never reach it; credentials travel per call.
// - A crash restarts it with exponential backoff. Every run that was in progress gets run.end "interrupted" with a reason
//   and is never resubmitted (C120). A run submission that timed out or was caught by a crash is reported as
//   run_uncertain and never retried (A9): an agent never does the same work twice.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('./host-main.mjs', import.meta.url));

export class HostError extends Error {
  constructor(code, message, fix) { super(message); this.code = code; if (fix) this.fix = fix; }   // fix: what a person can do about it
}

/** The environment the helper gets: enough to run, nothing from the server's own environment. */
export function minimalEnv(env = process.env, extra = {}) {
  const keep = {};
  for (const k of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR']) if (env[k] !== undefined) keep[k] = env[k];
  return { ...keep, NODE_ENV: env.NODE_ENV || 'production', ...extra };
}

export function backoffDelay(attempt, base, max) { return Math.min(max, base * 2 ** Math.max(0, attempt)); }

export class ProviderHost {
  /**
   * @param {{ adapters?: string[], bus: import('./bus.js').EventBus, registry?: import('./registry.js').Registry, log?: object,
   *   backoff?: { base?: number, max?: number, stableMs?: number }, callTimeoutMs?: number, runTimeoutMs?: number, main?: string }} o
   */
  constructor({ adapters = [], bus, registry = null, log = null, backoff = {}, callTimeoutMs = 15000, runTimeoutMs = 30000, main = MAIN } = {}) {
    this.adapters = adapters; this.bus = bus; this.registry = registry; this.log = log; this.main = main;
    this.backoff = { base: 500, max: 30000, stableMs: 60000, ...backoff };
    this.callTimeoutMs = callTimeoutMs; this.runTimeoutMs = runTimeoutMs;
    this.child = null; this.ready = false; this.stopping = false; this.attempt = 0;
    this.nextId = 1; this.pending = new Map();      // call id → { resolve, reject, timer, method }
    this.runs = new Map();                          // runId → { kind, connectionId, agentKey, sessionKey }
    this.connected = new Map();                     // `${kind}:${connectionId}` → { kind, connectionId }
    this.restarts = 0; this.timer = null; this.stableTimer = null; this.readyWaiters = [];
    this.onPersist = null;          // ({ kind, connectionId, field, value }) => void: a credential an adapter's provider issued
    this.readyListeners = new Set(); // () => void: the helper (re)started - live connections are opened again
    // events from the helper flow to the bus; the host keeps a note of what is in flight
    this.bus.on(e => {
      if (e.type === 'run.start') this.runs.set(e.runId, { kind: e.kind, connectionId: e.connectionId, agentKey: e.agentKey, sessionKey: e.sessionKey });
      else if (e.type === 'run.end') this.runs.delete(e.runId);
      else if (e.type === 'provider.connected') this.connected.set(`${e.kind}:${e.connectionId}`, { kind: e.kind, connectionId: e.connectionId });
      else if (e.type === 'provider.disconnected') this.connected.delete(`${e.kind}:${e.connectionId}`);
    });
  }

  /** Starts the helper; resolves when it reports ready (or rejects if it cannot within timeoutMs). */
  start(timeoutMs = 10000) {
    this.stopping = false;
    this.spawn();
    return this.whenReady(timeoutMs);
  }
  whenReady(timeoutMs = 10000) {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.readyWaiters = this.readyWaiters.filter(w => w.resolve !== resolve); reject(new HostError('host_down', 'The provider helper did not start')); }, timeoutMs);
      t.unref?.();
      this.readyWaiters.push({ resolve: () => { clearTimeout(t); resolve(); } });
    });
  }
  spawn() {
    if (this.child || this.stopping) return;
    // the adapter list travels as an argument, so the helper reads no environment at all
    const child = fork(this.main, [JSON.stringify(this.adapters)], {
      execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json',
      env: minimalEnv(process.env),
    });
    this.child = child;
    const relay = level => d => { for (const line of String(d).split('\n')) if (line.trim()) this.log?.[level]?.(`[providers] helper: ${line}`); };
    child.stdout.on('data', relay('info')); child.stderr.on('data', relay('warn'));
    child.on('message', m => this.onMessage(child, m));
    child.on('exit', (code, sig) => this.onExit(child, code, sig));
    child.on('error', e => this.log?.error?.('[providers] helper error:', e.message));
  }
  onMessage(child, m) {
    if (child !== this.child || !m) return;
    if (m.t === 'ready') {
      this.ready = true;
      this.registry?.adopt(m.manifests);
      if (this.registry?.problems?.length) this.log?.warn?.('[providers] adapter problems:', this.registry.problems.join(' | '));
      this.stableTimer = setTimeout(() => { this.attempt = 0; }, this.backoff.stableMs); this.stableTimer.unref?.();
      const w = this.readyWaiters; this.readyWaiters = []; for (const x of w) x.resolve();
      this.log?.info?.(`[providers] helper ready: ${(m.manifests || []).map(x => x.id).join(', ') || 'no adapters'}`);
      for (const fn of this.readyListeners) { try { fn(); } catch (e) { this.log?.warn?.('[providers] a ready listener failed:', e.message); } }
    } else if (m.t === 'persist') {
      // only a kind this helper serves, for a field its manifest says the server keeps (checked again where it is stored)
      if (!this.registry || this.registry.implemented(m.kind)) { try { this.onPersist?.(m); } catch (e) { this.log?.warn?.('[providers] could not keep a credential:', e.message); } }
    } else if (m.t === 'result') {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id); clearTimeout(p.timer);
      if (m.ok) p.resolve(m.value);
      else p.reject(new HostError(m.error?.code || 'provider_error', m.error?.message || 'The provider failed', m.error?.fix));
    } else if (m.t === 'delta') {
      const p = this.pending.get(m.id);
      if (p && p.onDelta) { try { p.onDelta(m.d); } catch (e) { this.log?.warn?.('[providers] a stream reader failed:', e.message); } }
    } else if (m.t === 'event') {
      try { this.bus.emit(m.event); } catch (e) { this.log?.warn?.('[providers] dropped an event from the helper:', e.message); }
    }
  }
  onExit(child, code, sig) {
    if (child !== this.child) return;
    this.child = null; this.ready = false; clearTimeout(this.stableTimer);
    const why = this.stopping ? 'The server is stopping' : `The provider helper stopped (${sig || `exit ${code}`}) and was restarted`;
    // calls in flight: a run submission's fate is unknown → run_uncertain, never retried; the rest fail cleanly
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(p.method === 'run' ? new HostError('run_uncertain', `${why}. The run may or may not have started; check before sending it again.`) : new HostError('host_down', why));
      this.pending.delete(id);
    }
    // runs that had started: interrupted with a reason, shown to the user, never replayed (C120)
    for (const [runId, r] of [...this.runs]) {
      this.runs.delete(runId);
      try { this.bus.emit({ type: 'run.end', kind: r.kind, connectionId: r.connectionId, agentKey: r.agentKey, sessionKey: r.sessionKey, runId, status: 'interrupted', error: why }); } catch { /* ignore */ }
    }
    for (const c of [...this.connected.values()]) {
      try { this.bus.emit({ type: 'provider.disconnected', kind: c.kind, connectionId: c.connectionId, reason: why }); } catch { /* ignore */ }
    }
    this.connected.clear();
    if (this.stopping) return;
    const delay = backoffDelay(this.attempt++, this.backoff.base, this.backoff.max);
    this.restarts++;
    this.log?.warn?.(`[providers] ${why}; restarting in ${delay} ms`);
    this.timer = setTimeout(() => { this.timer = null; this.spawn(); }, delay); this.timer.unref?.();
  }

  /** Calls one adapter method in the helper. Rejects at once when the helper is down. onDelta: what the adapter streams
   *  while it works (a piece of an answer), in order, before the call resolves. */
  call(kind, method, params = {}, { timeoutMs, onDelta = null } = {}) {
    if (!this.ready || !this.child) return Promise.reject(new HostError('host_down', 'The provider helper is not running'));
    const id = this.nextId++;
    const isRun = method === 'run';
    const ms = timeoutMs ?? (isRun ? this.runTimeoutMs : this.callTimeoutMs);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(isRun ? new HostError('run_uncertain', 'No answer to the run request in time. It may or may not have started; check before sending it again.') : new HostError('timeout', `${method} took too long`));
      }, ms);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method, onDelta });
      try { this.child.send({ t: 'call', id, kind, method, params }); } catch (e) {
        this.pending.delete(id); clearTimeout(timer);
        reject(isRun ? new HostError('run_uncertain', 'The run request could not be delivered cleanly; check before sending it again.') : new HostError('host_down', e.message));
      }
    });
  }

  status() { return { running: this.ready, restarts: this.restarts, inFlight: this.runs.size, pending: this.pending.size, connected: this.connected.size }; }

  async stop() {
    this.stopping = true; clearTimeout(this.timer); clearTimeout(this.stableTimer);
    const c = this.child;
    if (!c) return;
    await new Promise(resolve => { c.once('exit', resolve); try { c.kill('SIGTERM'); } catch { resolve(); } setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* gone */ } }, 3000).unref?.(); });
  }
}
