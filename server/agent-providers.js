// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agent Providers (docs/features/agent-providers.md): the server's side of the live provider connections — OpenClaw
// first. A kind whose manifest says live: true keeps a connection open in the provider helper (its adapter); this:
// - opens every enabled one when the helper (re)starts, and again whenever the connection is changed; closes it when it
//   is switched off or removed;
// - keeps what the helper hands back (persist: the device key and the token the provider issued it) sealed with the
//   connection, for a field its manifest says the server keeps (system: true);
// - stores each connection's live state (provider.status) and tells the pages that may see it at once;
// - keeps an agent record for each of the provider's own agents (agents: true): created, renamed, switched off when the
//   provider no longer lists it, removed with the connection. Each lives in the city like an agent made here (useBodies):
//   a body with a home, a desk and a routine while its provider lists it, retired when it no longer does or is removed.
import crypto from 'node:crypto';
import { clean, emojiOf } from './agents.js';

export const PROVIDER_PREFIX = 'prov-';
export const isProviderKey = key => typeof key === 'string' && key.startsWith(PROVIDER_PREFIX);
const STATES = new Set(['connecting', 'connected', 'pairing', 'error', 'offline']);

export class ProviderError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/** The agent key of a provider's agent: stable, unique per connection. */
export function providerAgentKey(connectionId, nativeId) {
  const k = `${PROVIDER_PREFIX}${connectionId}-${nativeId}`;
  return /^[A-Za-z0-9._:-]{1,64}$/.test(k) ? k : `${PROVIDER_PREFIX}${connectionId}-${crypto.createHash('sha256').update(String(nativeId)).digest('hex').slice(0, 20)}`;
}

export class AgentProviders {
  /**
   * @param {{ connections: import('./connections.js').Connections, registry: object, host: import('./providers/host.js').ProviderHost,
   *   bus: import('./providers/bus.js').EventBus, agents: import('./agents.js').Agents, push: (pred: (P: object) => boolean, frame: object) => void,
   *   log?: object, now?: () => number }} o
   */
  constructor({ connections, registry, host, bus, agents, push, audit = null, log = null, now = () => Date.now() }) {
    Object.assign(this, { connections, registry, host, bus, agents, push, audit, log, now });
    this.body = null;           // the city's body hooks, once the city is up (useBodies)
    this.kinds = new Map();     // connection id → kind, for closing one that is gone
    this.syncing = new Map();   // connection id → a pending agent sync
  }
  start() {
    this.host.readyListeners.add(() => this.openAll());
    this.host.onPersist = m => this.keep(m);
    this.bus.on(e => { if (e.type === 'provider.status') this.onStatus(e); });
    this.connections.listeners.add((id, why) => this.onChange(id, why));
    this.connections.beforeUnlink = c => this.dropAgents(c);
    if (this.host.ready) this.openAll();
    return this;
  }

  // ---------------------------------------------------------------- which connections are live
  manifestOf(c) { return c ? this.registry.manifest(c.kind) : null; }
  isLive(c) { const m = this.manifestOf(c); return !!(m && m.live && this.registry.implemented(c.kind)); }
  /** What every call for a connection carries: its settings (each default filled in), its credentials, and whether its
   *  address may be on this machine or the local network. */
  params(c, extra = {}) {
    const m = this.manifestOf(c);
    const config = { ...Object.fromEntries(m.fields.filter(f => f.type !== 'secret' && f.default !== undefined).map(f => [f.key, f.default])), ...c.config };
    return { connectionId: String(c.id), config, secrets: this.connections.secretsFor(c.id), allowPrivate: c.scope === 'installation', ...extra };
  }
  openAll() { for (const c of this.connections.list()) if (c.enabled && this.isLive(c)) this.open(c); }
  /** Opens (or re-configures) a connection's live link; what goes wrong before the provider is reached (an address a
   *  person's own connection may not use, the helper being down) is its state too. */
  async open(c) {
    this.kinds.set(c.id, c.kind);
    try { await this.call(c.kind, 'connect', this.params(c)); }
    catch (e) { this.setStatus(c, { state: 'error', code: e.code || 'host_down', detail: e.message, fix: e.fix }); }
  }
  async close(id, kind) {
    this.kinds.delete(id);
    if (kind) await this.call(kind, 'disconnect', { connectionId: String(id) }).catch(() => {});
  }
  call(kind, method, params, opts) { return this.host.call(kind, method, params, opts); }
  onChange(id, why) {
    const c = this.connections.get(id);
    const kind = c ? c.kind : this.kinds.get(Number(id));
    // removed: its device takes itself off the provider where it may (the adapter's forget), then the link closes
    if (why === 'remove' && kind) { this.kinds.delete(Number(id)); this.call(kind, 'forget', { connectionId: String(id) }).catch(() => {}); return; }
    if (!c || !c.enabled) { this.close(Number(id), kind); if (c && !c.enabled) this.setStatus(c, { state: 'offline', code: 'switched_off', detail: 'Switched off.' }); return; }
    if (this.isLive(c) && (why === 'create' || why === 'update')) this.open(c);
  }

  // ---------------------------------------------------------------- what the helper reports
  /** A credential the provider issued the connection (or a device key made for it): sealed with it. */
  keep(m) {
    const c = this.connections.get(Number(m.connectionId));
    if (!c || c.kind !== m.kind) return;
    this.connections.setSystemSecret(c.id, m.field, m.value);
  }
  /** The server is shutting down: what the helper still reports as it closes (every link going offline) is not
   *  recorded — the database is closing, and the next start finds the true state. */
  stop() { this.stopped = true; }
  onStatus(e) {
    if (this.stopped) return;
    const c = this.connections.get(Number(e.connectionId));
    if (!c || c.kind !== e.kind || !STATES.has(e.state)) return;
    this.setStatus(c, e);
    if (e.state === 'connected') this.syncSoon(c.id);
  }
  /** Stores a connection's live state and tells the pages of everyone who may see the connection. */
  setStatus(c, s) {
    const st = { ok: s.state === 'connected', state: s.state, checkedAt: this.now(), action: 'live' };
    for (const k of ['detail', 'fix', 'requestId', 'version', 'code']) if (s[k]) st[k] = String(s[k]).slice(0, 400);
    if (!st.ok && st.detail) st.error = st.detail;
    this.connections.saveLiveStatus(c.id, st);
    try { this.push(P => this.connections.canUse(P, c), { t: 'provider', id: c.id, status: st }); } catch (err) { this.log?.warn?.('[providers] could not tell the pages:', err.message); }
  }

  // ---------------------------------------------------------------- the provider's agents
  syncSoon(id) {
    if (this.syncing.has(id)) return this.syncing.get(id);
    const p = new Promise(r => setTimeout(r, 50)).then(() => this.syncAgents(id)).catch(e => this.log?.warn?.(`[providers] could not list the agents of connection ${id}:`, e.message))
      .finally(() => this.syncing.delete(id));
    this.syncing.set(id, p);
    return p;
  }
  /** Brings the agent records of a connection in line with the agents its provider lists. Returns the records. */
  async syncAgents(id) {
    const c = this.connections.get(id);
    const m = this.manifestOf(c);
    if (!c || !c.enabled || !m || !m.capabilities?.agents) return [];
    const r = await this.call(c.kind, 'agents', this.params(c));
    const listed = Array.isArray(r && r.agents) ? r.agents : [];
    const owner = c.scope === 'account' ? c.ownerId : null;
    const mine = this.agents.list().filter(a => a.connectionId === c.id && isProviderKey(a.key));
    const seen = new Set(), role = `${m.label} agent`;   // (its job in the city: "OpenClaw agent at …"; its owner may change it)
    for (const x of listed) {
      const key = providerAgentKey(c.id, x.id);
      seen.add(key);
      const name = clean(x.name || x.id, 32) || clean(x.id, 32), emoji = emojiOf(x.emoji);   // (as the record keeps them: compared as kept)
      const a = mine.find(v => v.key === key);
      if (!a) {
        try { this.agents.create({ key, name, emoji, role, ownerId: owner, connectionId: c.id, nativeId: x.id }, null, { quiet: true }); }
        catch (e) {
          // a name this city refuses (its speech rules) gets a plain one; the provider's own name stays the provider's
          if (e.code !== 'bad_name') throw e;
          this.agents.create({ key, name: `${m.label} agent`, emoji, role, ownerId: owner, connectionId: c.id, nativeId: x.id }, null, { quiet: true });
        }
      } else {
        const patch = {};
        if (!a.enabled) patch.enabled = true;
        if (a.name !== name) patch.name = name;
        if (a.emoji !== emoji) patch.emoji = emoji;
        if (a.role === m.label) patch.role = role;   // (records made before 2026-10-16 carried the bare label)
        if (a.ownerId !== owner) patch.ownerId = owner;
        if (Object.keys(patch).length) { try { this.agents.update(a.id, patch); } catch (e) { if (e.code !== 'bad_name') throw e; delete patch.name; if (Object.keys(patch).length) this.agents.update(a.id, patch); } }
      }
    }
    // an agent the provider no longer lists is switched off (its chats stay; it comes back if the provider lists it again)
    for (const a of mine) if (!seen.has(a.key) && a.enabled) this.agents.update(a.id, { enabled: false });
    const kept = this.agents.list().filter(a => a.connectionId === c.id && isProviderKey(a.key));
    for (const a of kept) this.followBody(a, a.enabled);
    return kept;
  }
  /** The connection is being removed: its provider's agents go with it (their records are kept, marked removed; their
   *  bodies retire, as any removed agent's). */
  dropAgents(c) {
    for (const a of this.agents.list()) if (a.connectionId === c.id && isProviderKey(a.key)) { this.followBody(a, false); this.agents.remove(a.id); }
  }

  // ---------------------------------------------------------------- their bodies in the city
  /**
   * The city's body hooks ({ spawn, retire, revive, rename, state }: server/index.mjs, the same as a connected agent's): from
   * now on every listed agent of a provider lives in the city — a home, a desk, a routine, like an agent made here — and
   * one the provider no longer lists retires. The agents already listed get theirs now.
   */
  useBodies(body) {
    this.body = body;
    for (const a of this.agents.list()) if (isProviderKey(a.key) && this.connections.get(a.connectionId)) this.followBody(a, a.enabled);
  }
  /** An agent listed by its provider has a body in the city, one no longer listed has none (it retires); the body follows
   *  its name and badge. The first time it gets one, it starts like any new agent (Free Will…). Safe to repeat. */
  followBody(a, wantOn) {
    if (!this.body || !a) return;
    try {
      const st = this.body.state(a);
      if (wantOn) {
        if (st === 'none') { this.agents.setBodyRef(a.id, this.body.spawn(a)); this.agents.started(this.agents.get(a.id)); }
        else if (st === 'retired') this.body.revive(a);
        else this.body.rename(a);
      } else if (st === 'live') this.body.retire(a);
    } catch (e) { this.log?.warn?.(`[providers] could not update the body of agent ${a.id}:`, e.message); }
  }

  // ---------------------------------------------------------------- for the routes
  /** The live connections this principal may see, with their state and their agents. */
  list(P) {
    return this.connections.visible(P).filter(c => this.isLive(c)).map(c => this.view(P, c));
  }
  view(P, c) {
    const v = this.connections.view(P, c);
    const m = this.manifestOf(c);
    v.capabilities = { ...m.capabilities };
    v.agents = this.agents.list().filter(a => a.connectionId === c.id && isProviderKey(a.key) && a.enabled)
      .map(a => ({ id: a.id, name: a.name, emoji: a.emoji, nativeId: a.nativeId, level: this.agents.level(P, a) })).filter(a => a.level);
    return v;
  }
  /** Which of the addresses where a provider of this kind usually listens answer as one (administrators only: it looks
   *  at this machine and the local network). */
  async detect(kind) {
    const m = this.registry.manifest(kind);
    if (!m || !m.live || !this.registry.implemented(kind)) throw new ProviderError(400, 'bad_kind', 'Unknown kind of provider');
    const url = m.fields.find(f => f.key === 'url');
    const candidates = [...new Set([url && url.default, ...(m.detect || []), ...this.connections.list().filter(c => c.kind === kind && c.config.url).map(c => c.config.url)].filter(Boolean))];
    const r = await this.call(kind, 'detect', { candidates }, { timeoutMs: 8000 });
    return { found: Array.isArray(r && r.found) ? r.found : [] };
  }
  /**
   * One call of a provider's sub-menu (its settings, agents, skills, automations…): for whoever manages the connection
   * only; the adapter takes only its listed calls; a change (manifest menuWrite) is recorded in the audit log — which call,
   * on which connection, never what it carried. The agents are listed again after a change to them.
   */
  async menu(P, id, method, params, actor = null) {
    const c = this.connections.need(P, id, 'manage');
    const m = this.manifestOf(c);
    if (!this.isLive(c) || !m.menu) throw new ProviderError(400, 'no_menu', 'This provider has no sub-menu');
    if (typeof method !== 'string' || !/^[a-z][A-Za-z0-9.]{1,80}$/.test(method)) throw new ProviderError(400, 'bad_request', 'Which call?');
    if (params !== undefined && params !== null && (typeof params !== 'object' || Array.isArray(params))) throw new ProviderError(400, 'bad_request', 'Bad parameters');
    if (params && JSON.stringify(params).length > 512 * 1024) throw new ProviderError(413, 'too_large', 'That change is too large');
    const change = (m.menuWrite || []).includes(method);
    const out = await this.call(c.kind, 'menu', this.params(c, { method, params: params || {} }), { timeoutMs: 35000 });
    if (change) {
      this.audit?.log('provider.change', { actor, detail: { id: c.id, kind: c.kind, method } });
      if (/^agents\./.test(method)) this.syncSoon(c.id);
    }
    return out;
  }
  // ---------------------------------------------------------------- its own computer (docs/features/agent-pc.md §4.1)
  /**
   * What of an agent's own computer its owner's PC may show this person: the computer its provider lives on (OpenClaw:
   * the agent's workspace and its documents; Hermes: Hermes' managed files), its provider's browser and its own screen
   * (Hermes' Bot Desktop). Null for an agent
   * made here, one whose provider is off or can't, and anyone who doesn't manage its provider — the files and browser of
   * an agent platform are its managers' (as its sub-menu is).
   */
  computerOf(P, a) {
    if (!a || !isProviderKey(a.key) || !a.enabled) return null;
    const c = this.connections.get(a.connectionId), m = this.manifestOf(c);
    if (!c || !c.enabled || !this.isLive(c) || !m.capabilities?.computer || !m.computer || this.connections.level(P, c) !== 'manage') return null;
    const chatOnly = this.params(c).config.access === 'chat';
    return { kind: c.kind, label: m.label, connection: c.id, where: m.computer.where, docs: !!m.computer.docs,
      write: !chatOnly && m.computer.writes.length > 0, browser: !!m.capabilities.browser,
      // (its own screen — Hermes' Bot Desktop, where its browser opens: Full access, as it is its machine's)
      ...(m.capabilities.screen && !chatOnly ? { screen: true } : {}) };
  }
  /**
   * One call on an agent's own computer: { op, params } — only its manifest's listed calls (computer.ops); change: true
   * for one that changes something (computer.writes: only those then, and only on a connection with Full access; recorded
   * in the audit log — which call, on which connection and agent, never a path or what it carried), false for a reading
   * (never one of those). Errors come back as ProviderError, in the provider's words.
   */
  async computer(P, a, op, params = {}, actor = null, { change = false } = {}) {
    const own = this.computerOf(P, a);
    if (!own) throw new ProviderError(404, 'no_computer', 'This agent has no computer of its own here');
    const m = this.manifestOf(this.connections.get(own.connection));
    if (typeof op !== 'string' || !m.computer.ops.includes(op) || m.computer.writes.includes(op) !== !!change) throw new ProviderError(400, 'bad_request', 'Which call?');
    if (change && !own.write) throw new ProviderError(403, 'forbidden', `This ${own.label} connection has Chat only access: nothing on its computer is changed from here`);
    const c = this.connections.get(own.connection);
    let out;
    try { out = await this.call(c.kind, 'files', this.params(c, { op, params: { ...params, agentId: a.nativeId } }), { timeoutMs: change ? 130000 : 65000 }); }
    catch (e) {
      const code = String(e.code || 'provider_error');
      const status = { not_found: 404, forbidden: 403, conflict: 409, too_large: 413, timeout: 504, unavailable: 503, UNAVAILABLE: 503, not_connected: 503, unreachable: 503 }[code]
        ?? (['INVALID_REQUEST', 'bad_request', 'unsupported', 'unreadable'].includes(code) ? 400 : 502);
      throw new ProviderError(status, code, e.message || `${own.label} did not answer`);
    }
    if (change) this.audit?.log('provider.computer', { actor, detail: { id: c.id, kind: c.kind, agent: a.id, op } });
    return out;
  }
  /** Whether a sub-menu call changes something (its manifest's menuWrite): such a call needs a recent password. */
  isChange(P, id, method) {
    const c = this.connections.need(P, id, 'manage'), m = this.manifestOf(c);
    return !!(m && (m.menuWrite || []).includes(method));
  }
  /**
   * Removes a provider connection, telling the truth about its device: first the device takes itself off the provider
   * (the adapter's forget, while the link is still signed in — covered by operator.admin for OpenClaw), then the
   * connection goes (its agents with it). `unpaired`: whether the provider confirmed it; if not, the person revokes it there.
   */
  async remove(P, id, actor = null) {
    const c = this.connections.need(P, id, 'manage');
    let unpaired = false;
    if (this.isLive(c) && this.kinds.has(c.id)) {
      const r = await this.call(c.kind, 'forget', { connectionId: String(c.id) }, { timeoutMs: 8000 }).catch(() => null);
      unpaired = !!(r && r.unpaired);
    }
    this.connections.remove(P, c.id, actor);   // (its 'remove' event finds the link gone already)
    return { removed: c.id, unpaired };
  }
  /** Connects one again now (a person pressed Reconnect, or approved the device). */
  async reconnect(P, id) {
    const c = this.connections.need(P, id, 'manage');
    if (!this.isLive(c)) throw new ProviderError(400, 'not_live', 'This connection is not an agent provider');
    await this.close(c.id, c.kind);
    if (c.enabled) await this.open(c);
    return { ok: true };
  }
}
