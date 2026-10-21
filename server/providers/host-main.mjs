// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The provider helper process (see host.js). It loads the adapters named in its first argument (a JSON list of module paths),
// tells the server which manifests it serves, answers calls over IPC and forwards adapter events. It has no access to the
// server's secrets: its environment is minimal, it reads none of it, and credentials arrive with each call.
import { pathToFileURL } from 'node:url';

const adapters = new Map();          // kind → adapter
const send = m => { if (process.connected) process.send(m); };
const ctx = { emit: event => send({ t: 'event', event }) };

async function load() {
  let list = [];
  try { list = JSON.parse(process.argv[2] || '[]'); } catch { list = []; }
  for (const entry of list) {
    // (an entry is a module path, or { path, options } — options only ever from the server's tests: a fake service's address)
    const p = typeof entry === 'string' ? entry : entry && entry.path;
    try {
      const mod = await import(pathToFileURL(p).href);
      const a = mod.default || mod.adapter;
      if (!a || !a.manifest || !a.manifest.id) throw new Error('no adapter or manifest exported');
      // an adapter that keeps connections open (Agent Providers) reports events, and hands back a credential its provider
      // issued (persist: a device token), outside any call; the server seals it — the helper writes nothing itself
      if (entry && typeof entry === 'object' && entry.options) a.setup?.(entry.options);
      const kind = a.manifest.id;
      a.attach?.({ emit: ctx.emit, persist: (connectionId, field, value) => send({ t: 'persist', kind, connectionId: String(connectionId), field: String(field), value: value ?? null }) });
      adapters.set(kind, a);
    } catch (e) { console.error(`could not load adapter ${p}: ${e.message}`); }
  }
  send({ t: 'ready', manifests: [...adapters.values()].map(a => a.manifest) });
}

process.on('message', async m => {
  if (!m || m.t !== 'call') return;
  const a = adapters.get(m.kind);
  try {
    if (!a) throw Object.assign(new Error(`No adapter for ${m.kind}`), { code: 'no_adapter' });
    const fn = a[m.method];
    if (typeof fn !== 'function') throw Object.assign(new Error(`${m.kind} does not support ${m.method}`), { code: 'unsupported' });
    // delta: a piece of a streamed answer, to the call that asked for it (host.js call's onDelta), not to the bus
    const value = await fn.call(a, m.params || {}, { ...ctx, delta: d => send({ t: 'delta', id: m.id, d }) });
    send({ t: 'result', id: m.id, ok: true, value: value === undefined ? null : value });
  } catch (e) {
    send({ t: 'result', id: m.id, ok: false, error: { code: e.code || 'provider_error', message: String(e.message || e).slice(0, 500), ...(e.fix ? { fix: String(e.fix).slice(0, 500) } : {}) } });
  }
});
// (an adapter with open connections closes them first: its provider sees a clean goodbye)
async function shutdown() { for (const a of adapters.values()) { try { await a.shutdown?.(); } catch { /* going anyway */ } } process.exit(0); }
process.on('disconnect', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', e => { console.error('helper crashed:', e.message); process.exit(1); });
load();
