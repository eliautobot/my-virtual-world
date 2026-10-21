// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Connections to agent platforms and model providers (PLAN WP2.2; DECISIONS C60, A8, A9, A17; CHECKLIST I8.1, I8.7, I8.13, X11).
// - scope 'account': one account's own connection. Members may add REMOTE kinds only (a connection that starts a program on
//   the server host is infrastructure).
// - scope 'installation': added by whoever holds connections.manage (admins by default), any kind, shared with roles or accounts.
// - Host-process kinds (Codex, Claude Code, OpenCode, Antigravity, Hermes by command line) are installation-only and need
//   connections.manage.
// - Credentials are sealed with the SecretBox (holder kind 'connections'), bound to the connection and the field. They come
//   back only as set / not set; a blank value on update keeps the stored one; only a server-side call to the helper reads them.
// - Someone who may not see a connection gets 404, never 403: nothing is confirmed. Another account's own connection is never
//   visible, not even to an admin (X11).
import { RANK } from './auth/permissions.js';
import { aadConnection } from './secret-holders.js';
import { connectionKindFor } from './providers/manifest.js';

export class ConnectionError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const SHORT = 300;

/** The non-secret settings of a connection, checked against its manifest; anything the manifest does not list is refused. */
export function checkConfig(manifest, config, { partial = false } = {}) {
  const out = {};
  const by = new Map(manifest.fields.filter(f => f.type !== 'secret').map(f => [f.key, f]));
  for (const [k, v] of Object.entries(config || {})) {
    const f = by.get(k);
    if (!f) throw new ConnectionError(400, 'bad_setting', `${k} is not a setting of ${manifest.label}`);
    if (v === '' || v === null || v === undefined) { if (f.required && !partial) throw new ConnectionError(400, 'bad_setting', `${f.label} is required`); continue; }
    if (f.type === 'boolean') { if (typeof v !== 'boolean') throw new ConnectionError(400, 'bad_setting', `${f.label} must be on or off`); out[k] = v; }
    else if (f.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new ConnectionError(400, 'bad_setting', `${f.label} must be a number`);
      if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) throw new ConnectionError(400, 'bad_setting', `${f.label} must be between ${f.min ?? '-∞'} and ${f.max ?? '∞'}`);
      out[k] = v;
    }
    else if (f.type === 'select') { if (!f.options.includes(v)) throw new ConnectionError(400, 'bad_setting', `${f.label} must be one of ${f.options.join(', ')}`); out[k] = v; }
    else if (f.type === 'url') {
      let u; try { u = new URL(String(v)); } catch { throw new ConnectionError(400, 'bad_setting', `${f.label} is not a web address`); }
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) throw new ConnectionError(400, 'bad_setting', `${f.label} must start with http, https, ws or wss`);
      if (u.username || u.password) throw new ConnectionError(400, 'bad_setting', `${f.label} must not contain a name or password; use the credential field`);
      out[k] = u.toString();
    } else out[k] = clean(v, 500);
  }
  if (!partial) for (const f of by.values()) if (f.required && out[f.key] === undefined && f.default === undefined) throw new ConnectionError(400, 'bad_setting', `${f.label} is required`);
  return out;
}

/** The settings with each field's default filled in (what the adapter goes by). */
const withDefaults = (m, cfg) => ({ ...Object.fromEntries(m.fields.filter(f => f.type !== 'secret' && f.default !== undefined).map(f => [f.key, f.default])), ...cfg });
/** Whether a field must have a value: required, or required with a setting (requiredIf: { auth: 'token' }) - unless a
 *  field it gives way to is set (unlessSet: a paired device's token stands in for the gateway's own). */
function needed(f, m, config, have = new Set()) {
  if (f.unlessSet && have.has(f.unlessSet)) return false;
  if (f.required) return true;
  if (!f.requiredIf) return false;
  const cfg = withDefaults(m, config || {});
  return Object.entries(f.requiredIf).every(([k, v]) => cfg[k] === v);
}

export class Connections {
  /**
   * @param {{ db: object, worldId: string }} dbs
   * @param {{ box: object, registry: import('./providers/registry.js').Registry, host?: import('./providers/host.js').ProviderHost|null,
   *   can: (P: object, cap: string) => boolean, audit?: object, now?: () => number, log?: object }} o
   */
  constructor(dbs, { box, registry, host = null, can, audit = null, now = () => Date.now(), log = null }) {
    this.probes = new Map();   // kind → async (connection, secrets, action) => result: kinds the server tests itself
    this.db = dbs.db; this.w = dbs.worldId; this.box = box; this.registry = registry; this.host = host; this.can = can;
    this.audit = audit; this.now = now; this.log = log;
    this.listeners = new Set();   // (id, why: 'create' | 'update' | 'tested' | 'remove') => void - besides onChange
    const db = this.db;
    this.q = {
      all: db.prepare('SELECT * FROM connections WHERE world_id = ? AND deleted IS NULL ORDER BY id'),
      byId: db.prepare('SELECT * FROM connections WHERE world_id = ? AND id = ? AND deleted IS NULL'),
      ins: db.prepare('INSERT INTO connections (world_id, kind, label, scope, owner_id, config_json, enabled, created, updated) VALUES (@w, @kind, @label, @scope, @owner, @config, 1, @now, @now)'),
      upd: db.prepare('UPDATE connections SET label = @label, config_json = @config, enabled = @enabled, updated = @now WHERE world_id = @w AND id = @id'),
      status: db.prepare('UPDATE connections SET status_json = ?, updated = ? WHERE world_id = ? AND id = ?'),
      del: db.prepare('UPDATE connections SET deleted = ?, enabled = 0, updated = ? WHERE world_id = ? AND id = ?'),
      shares: db.prepare('SELECT kind, who FROM connection_shares WHERE world_id = ? AND connection_id = ? ORDER BY kind, who'),
      putShare: db.prepare('INSERT OR IGNORE INTO connection_shares (world_id, connection_id, kind, who, created) VALUES (?, ?, ?, ?, ?)'),
      delShare: db.prepare('DELETE FROM connection_shares WHERE world_id = ? AND connection_id = ? AND kind = ? AND who = ?'),
      delShares: db.prepare('DELETE FROM connection_shares WHERE world_id = ? AND connection_id = ?'),
      secrets: db.prepare('SELECT field, sealed FROM connection_secrets WHERE world_id = ? AND connection_id = ?'),
      putSecret: db.prepare('INSERT INTO connection_secrets (world_id, connection_id, field, sealed) VALUES (?, ?, ?, ?) ON CONFLICT (world_id, connection_id, field) DO UPDATE SET sealed = excluded.sealed'),
      delSecret: db.prepare('DELETE FROM connection_secrets WHERE world_id = ? AND connection_id = ? AND field = ?'),
      delSecrets: db.prepare('DELETE FROM connection_secrets WHERE world_id = ? AND connection_id = ?'),
      unlinkAgents: db.prepare('UPDATE agents SET connection_id = NULL WHERE world_id = ? AND connection_id = ?'),
    };
  }

  // ---------------------------------------------------------------- records
  row(r) {
    if (!r) return null;
    let config, status; try { config = JSON.parse(r.config_json); } catch { config = {}; }
    try { status = r.status_json ? JSON.parse(r.status_json) : null; } catch { status = null; }
    return { id: r.id, kind: r.kind, label: r.label, scope: r.scope, ownerId: r.owner_id, config, enabled: !!r.enabled, status, created: r.created, updated: r.updated };
  }
  list() { return this.q.all.all(this.w).map(r => this.row(r)); }
  get(id) { return this.row(this.q.byId.get(this.w, Number(id))); }
  shares(id) { return this.q.shares.all(this.w, Number(id)); }
  /** Which of a connection's credentials are set (the ones a person types in; the server's own - a device key - are not listed). */
  secretState(id) {
    const m = this.registry.manifest(this.get(id)?.kind); if (!m) return {};
    const have = new Set(this.q.secrets.all(this.w, Number(id)).map(s => s.field));
    return Object.fromEntries(m.fields.filter(f => f.type === 'secret' && !f.system).map(f => [f.key, have.has(f.key)]));
  }
  /** The plain credentials of a connection, for a call to the helper. Never put the result in a response, a frame or a log. */
  secretsFor(id) {
    const out = {};
    for (const s of this.q.secrets.all(this.w, Number(id))) out[s.field] = this.box.open(s.sealed, aadConnection(this.w, Number(id), s.field));
    return out;
  }

  // ---------------------------------------------------------------- who may do what
  kindOf(c) { const m = this.registry.manifest(c.kind); return m ? connectionKindFor(m, c.config) : 'remote'; }
  /** 'manage', 'use' or null. An account's own connection is its owner's alone. Installation ones belong to connections.manage
   *  holders and are usable by the roles and accounts they are shared with. */
  level(P, c) {
    if (!c || !P || !P.account) return null;
    if (c.scope === 'account') return c.ownerId === P.account.id ? 'manage' : null;
    if (this.can(P, 'connections.manage')) return 'manage';
    if (!this.can(P, 'connections.use')) return null;
    for (const s of this.q.shares.all(this.w, c.id)) {
      if (s.kind === 'account' ? s.who === String(P.account.id) : (RANK[P.role] ?? 0) >= (RANK[s.who] ?? 99)) return 'use';
    }
    return null;
  }
  canUse(P, c) { return this.level(P, c) !== null; }
  visible(P) { return this.list().filter(c => this.canUse(P, c)); }
  /** What a principal may see of one connection: use gives its label and status; manage adds settings, which credentials are set and the shares. */
  view(P, c) {
    const m = this.registry.manifest(c.kind), level = this.level(P, c);
    const o = { id: c.id, kind: c.kind, label: c.label, scope: c.scope, level, mine: c.scope === 'account' && c.ownerId === P.account?.id, enabled: c.enabled,
      connectionKind: this.kindOf(c), implemented: this.registry.implemented(c.kind), arrivesIn: this.registry.implemented(c.kind) ? undefined : m?.arrivesIn,
      status: c.status };
    if (level === 'manage') { o.config = c.config; o.secrets = this.secretState(c.id); if (c.scope === 'installation') o.shares = this.shares(c.id); }
    // a provider device paired with its own token (Agent Providers): it needs no gateway token any more
    if (level === 'manage' && m && m.fields.some(f => f.key === 'deviceToken' && f.system)) o.paired = this.q.secrets.all(this.w, c.id).some(s => s.field === 'deviceToken');
    // a brain (Model provider): which model it thinks with is for everyone who may use it - the Agent Studio's brain
    // picker shows it; nothing else of its settings (an address, prices) leaves the managers
    if (c.kind === 'models') o.brain = { provider: c.config.provider || 'openrouter', model: c.config.model || '', thinking: c.config.thinking || 'off' };
    // a voice service: which service, what it can do and its voice (the pickers), never its address or prices
    if (c.kind === 'voice') {
      const def = m?.providers?.[c.config.provider || 'openai'] || {};
      o.voice = { provider: c.config.provider || 'openai', label: def.label || c.config.provider, speak: !!def.speak, listen: !!def.listen, voice: c.config.voice || def.voice || '' };
    }
    return o;
  }
  need(P, id, level = 'use') {
    const c = this.get(id);
    const have = this.level(P, c);
    if (!c || !have) throw new ConnectionError(404, 'not_found', 'No such connection');
    if (level === 'manage' && this.isSystem(c)) throw new ConnectionError(409, 'managed_by_system', 'This connection belongs to a connected agent; manage that agent in Settings → Third-party agents');
    if (level === 'manage' && have !== 'manage') throw new ConnectionError(403, 'forbidden', 'Only its owner, or an administrator for a shared connection, may change it');
    return c;
  }

  /** A kind the server manages itself (the connected-agent kind): never added, changed or removed by hand. */
  isSystem(c) { const m = c && this.registry.manifest(c.kind); return !!(m && m.system); }
  /** Made by the server when an owner enrols a connected agent (WP2.14); an account-scope connection with no credentials. */
  createSystem({ kind, label, ownerId, config = {} }) {
    const m = this.registry.manifest(kind);
    if (!m || !m.system) throw new ConnectionError(400, 'bad_kind', 'Not a server-managed kind');
    const now = this.now();
    const r = this.q.ins.run({ w: this.w, kind, label: clean(label, 60) || m.label, scope: 'account', owner: ownerId, config: JSON.stringify(config), now });
    return this.get(Number(r.lastInsertRowid));
  }
  removeSystem(id) {
    const c = this.get(id);
    if (!c || !this.isSystem(c)) return;
    const now = this.now();
    this.q.del.run(now, now, this.w, c.id); this.q.delSecrets.run(this.w, c.id); this.q.delShares.run(this.w, c.id); this.q.unlinkAgents.run(this.w, c.id);
  }

  /** Whether this principal may add a connection of manifest m (the add form lists only these): the rules create() keeps. */
  addable(P, m) {
    if (!P || !P.account || !m || m.system) return false;
    const host = m.modes ? m.modes.every(x => x.connectionKind === 'host-process') : m.connectionKind === 'host-process';
    return host ? this.can(P, 'connections.manage') : (this.can(P, 'connections.manage') || this.can(P, 'connections.use'));
  }

  // ---------------------------------------------------------------- change
  create(P, { kind, label, scope = 'account', config = {}, secrets = {} }, actor = null) {
    if (!P || !P.account) throw new ConnectionError(401, 'signed_out', 'Sign in first');
    const m = this.registry.manifest(kind);
    if (!m) throw new ConnectionError(400, 'bad_kind', 'Unknown kind of connection');
    if (m.system) throw new ConnectionError(400, 'managed_by_system', 'This kind is made by the server when you connect an agent in Settings → Third-party agents');
    // (a bring-your-own-key service - a voice service: a public vendor's API with the member's own key, nothing on the
    // server's network - is the exception: members bring their own voice, docs/features/CHAT.md §9)
    if (scope !== 'account' && scope !== 'installation') throw new ConnectionError(400, 'bad_scope', 'Scope is account or installation');
    const cfg = checkConfig(m, config);
    const host = connectionKindFor(m, cfg) === 'host-process';
    if (host && scope !== 'installation') throw new ConnectionError(403, 'host_process_is_infrastructure', `${m.label} runs a program on the server, so it is set up by an administrator for the whole installation`);
    if (scope === 'installation' || host) { if (!this.can(P, 'connections.manage')) throw new ConnectionError(403, 'forbidden', 'Only an administrator may add an installation-wide connection'); }
    else if (!this.can(P, 'connections.use')) throw new ConnectionError(403, 'forbidden', 'You may not add connections');
    const lbl = clean(label, 60) || m.label;
    const now = this.now();
    const r = this.q.ins.run({ w: this.w, kind, label: lbl, scope, owner: scope === 'account' ? P.account.id : null, config: JSON.stringify(cfg), now });
    const id = Number(r.lastInsertRowid);
    try { this.setSecrets(id, m, secrets, withDefaults(m, cfg)); } catch (e) { this.q.del.run(now, now, this.w, id); this.q.delSecrets.run(this.w, id); throw e; }
    this.audit?.log('connection.create', { actor, detail: { id, kind, label: lbl, scope } });
    this.fire(id, 'create');
    return this.get(id);
  }
  /** Seals the given credential fields. A blank or missing value keeps what is stored; null clears one. A field required
   *  only with some setting (requiredIf: { auth: 'token' }) is required when the connection's settings say so. */
  setSecrets(id, manifest, secrets, config = this.get(id)?.config || {}) {
    // (the server's own credentials - system: a device key and token - are set only by setSystemSecret)
    const fields = new Map(manifest.fields.filter(f => f.type === 'secret' && !f.system).map(f => [f.key, f]));
    for (const [k, v] of Object.entries(secrets || {})) {
      if (!fields.has(k)) throw new ConnectionError(400, 'bad_setting', `${k} is not a credential of ${manifest.label}`);
      if (v === null) { this.q.delSecret.run(this.w, id, k); continue; }
      if (v === undefined || v === '') continue;
      if (typeof v !== 'string' || v.length > 4000) throw new ConnectionError(400, 'bad_setting', `${fields.get(k).label} is not valid`);
      this.q.putSecret.run(this.w, id, k, this.box.seal(v, aadConnection(this.w, id, k)));
    }
    const have = new Set(this.q.secrets.all(this.w, id).map(s => s.field));
    for (const f of fields.values()) if (needed(f, manifest, config, have) && !have.has(f.key)) throw new ConnectionError(400, 'bad_setting', `${f.label} is required`);
  }
  /** A credential the server keeps for the connection itself (manifest field system: true - a device key, the token a
   *  provider issued it): sealed like the rest; null forgets it. Never from a request. */
  setSystemSecret(id, field, value) {
    const c = this.get(id), m = c && this.registry.manifest(c.kind);
    const f = m && m.fields.find(x => x.key === field);
    // (a credential handed off - the gateway's own token once the device is paired - may only be forgotten this way)
    const forget = value === null || value === undefined || value === '';
    if (!f || !(f.system || (f.handoff && forget))) throw new ConnectionError(400, 'bad_setting', `${field} is not kept by the server`);
    if (forget) { this.q.delSecret.run(this.w, c.id, field); return; }
    if (typeof value !== 'string' || value.length > 8000) throw new ConnectionError(400, 'bad_setting', `${f.label} is not valid`);
    this.q.putSecret.run(this.w, c.id, field, this.box.seal(value, aadConnection(this.w, c.id, field)));
  }
  /** Calls everyone listening for a change of a connection. */
  fire(id, why) {
    try { this.onChange?.(id, why); } catch { /* a listener's fault is its own */ }
    for (const fn of this.listeners) { try { fn(id, why); } catch (e) { this.log?.warn?.('[connections] a change listener failed:', e.message); } }
  }
  update(P, id, patch, actor = null) {
    const c = this.need(P, id, 'manage');
    const m = this.registry.manifest(c.kind);
    const cfg = patch.config !== undefined ? { ...c.config, ...checkConfig(m, patch.config, { partial: true }) } : c.config;
    if (patch.config !== undefined) for (const [k, v] of Object.entries(patch.config)) if (v === '' || v === null) delete cfg[k];
    if (c.scope === 'account' && connectionKindFor(m, cfg) === 'host-process') throw new ConnectionError(403, 'host_process_is_infrastructure', 'A connection that runs a program on the server cannot be a personal one');
    if (c.scope === 'installation' && connectionKindFor(m, cfg) !== this.kindOf(c) && !this.can(P, 'connections.manage')) throw new ConnectionError(403, 'forbidden', 'Only an administrator may change how it connects');
    const label = patch.label !== undefined ? (clean(patch.label, 60) || c.label) : c.label;
    const enabled = patch.enabled !== undefined ? !!patch.enabled : c.enabled;
    // (credentials are checked against the new settings before anything is stored: a switch to password sign-in needs the password)
    if (patch.secrets || patch.config !== undefined) this.setSecrets(c.id, m, patch.secrets || {}, withDefaults(m, cfg));
    this.q.upd.run({ w: this.w, id: c.id, label, config: JSON.stringify(cfg), enabled: enabled ? 1 : 0, now: this.now() });
    // a token a provider issued this connection (a device's, a sign-in's: perAddress) is for that provider: another address forgets it
    if (cfg.url !== c.config.url) for (const f of m.fields) if (f.system && f.perAddress) this.setSystemSecret(c.id, f.key, null);
    this.audit?.log('connection.update', { actor, detail: { id: c.id, fields: Object.keys(patch).filter(k => k !== 'secrets'), secretsChanged: patch.secrets ? Object.keys(patch.secrets) : [] } });
    this.fire(c.id, 'update');
    return this.get(c.id);
  }
  remove(P, id, actor = null) {
    const c = this.need(P, id, 'manage');
    const now = this.now();
    this.q.del.run(now, now, this.w, c.id);
    this.q.delSecrets.run(this.w, c.id); this.q.delShares.run(this.w, c.id);
    // (an agent of the provider's own goes with it - Agent Providers; any other agent linked to it is only unlinked)
    try { this.beforeUnlink?.(c); } catch (e) { this.log?.warn?.('[connections] removing its agents failed:', e.message); }
    this.q.unlinkAgents.run(this.w, c.id);
    this.audit?.log('connection.remove', { actor, detail: { id: c.id, kind: c.kind, label: c.label } });
    this.fire(c.id, 'remove');
    return c;
  }
  share(P, id, kind, who, actor = null) {
    const c = this.need(P, id, 'manage');
    if (c.scope !== 'installation') throw new ConnectionError(400, 'not_shareable', 'Only installation-wide connections are shared; a personal one stays with its owner');
    if (kind !== 'account' && kind !== 'role') throw new ConnectionError(400, 'bad_share', 'Share with an account or a role');
    who = String(who ?? '');
    if (kind === 'role' && !Object.hasOwn(RANK, who)) throw new ConnectionError(400, 'bad_role', 'Unknown role');
    if (kind === 'account' && !/^\d+$/.test(who)) throw new ConnectionError(400, 'bad_account', 'Unknown account');
    this.q.putShare.run(this.w, c.id, kind, who, this.now());
    this.audit?.log('connection.share', { actor, detail: { id: c.id, kind, who } });
    return this.shares(c.id);
  }
  unshare(P, id, kind, who, actor = null) {
    const c = this.need(P, id, 'manage');
    this.q.delShare.run(this.w, c.id, kind, String(who));
    this.audit?.log('connection.unshare', { actor, detail: { id: c.id, kind, who } });
    return this.shares(c.id);
  }

  // ---------------------------------------------------------------- talking to the provider
  /** Test, refresh or discover through the helper. The result is stored as the connection's status (test and refresh) and never
   *  contains a credential: any secret value in a message is blanked. */
  async probe(P, id, action, actor = null) {
    if (!['test', 'refresh', 'discover'].includes(action)) throw new ConnectionError(400, 'bad_action', 'Test, refresh or discover');
    const c = this.need(P, id, 'manage');
    const m = this.registry.manifest(c.kind);
    let res;
    // (a kind the server serves itself - a browser service - is tested by the server: probes)
    if (this.probes.has(c.kind)) {
      try { res = await this.probes.get(c.kind)(c, this.secretsFor(c.id), action); } catch (e) { res = { ok: false, error: e.message, code: e.code }; }
    } else if (!this.registry.implemented(c.kind)) res = { ok: false, error: `${m.label} isn't available on this server.`, fix: 'Nothing to do here: this kind of connection does not work on this server.' };
    else if (!this.host) res = { ok: false, error: 'The provider helper is not running.', fix: 'Ask an administrator to check the server.' };
    else {
      // (allowPrivate: an installation's connection - an administrator's - may name a server on the local network)
      try { res = await this.host.call(c.kind, action, { connectionId: String(c.id), config: c.config, secrets: this.secretsFor(c.id), allowPrivate: c.scope === 'installation' }); }
      catch (e) { res = { ok: false, error: e.message, code: e.code }; }
    }
    const out = this.scrub(res, c.id);
    if (action !== 'discover' || out.ok === false) this.saveStatus(c, action, out);
    // a test that worked: whatever paused this connection is over (a brain, a decision service: they may go again at once)
    if (action === 'test' && out.ok !== false) this.fire(c.id, 'tested');
    this.audit?.log(`connection.${action}`, { actor, detail: { id: c.id, ok: out.ok !== false } });
    return out;
  }
  /** A live connection's state (Agent Providers), as its provider reports it. */
  saveLiveStatus(id, st) { this.q.status.run(JSON.stringify(st), this.now(), this.w, Number(id)); }
  saveStatus(c, action, out) {
    const st = { ok: out.ok !== false, checkedAt: this.now(), action };
    if (out.error) st.error = out.error;
    if (out.fix) st.fix = out.fix;
    if (out.detail) st.detail = out.detail;
    // (a live connection's - Agent Providers - also says its state, the provider's version and a pairing request)
    for (const k of ['state', 'requestId', 'version', 'code']) if (typeof out[k] === 'string' && out[k]) st[k] = out[k].slice(0, 200);
    this.q.status.run(JSON.stringify(st), this.now(), this.w, c.id);
  }
  /** A provider result, reduced to plain values with every stored credential blanked. */
  scrub(res, id) {
    const secrets = Object.values(this.secretsFor(id)).filter(v => v && v.length >= 4);
    const wipe = v => {
      if (typeof v === 'string') { let s = v.slice(0, SHORT * 4); for (const x of secrets) s = s.split(x).join('[hidden]'); return s; }
      if (Array.isArray(v)) return v.slice(0, 200).map(wipe);
      if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 50).filter(([k]) => !/token|secret|password|apikey|api_key|authorization/i.test(k)).map(([k, x]) => [k, wipe(x)]));
      return v;
    };
    return wipe(res && typeof res === 'object' ? res : { ok: false, error: 'No answer' });
  }
}
