// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The agent registry (PLAN WP2.1; DECISIONS A6, A17, C60, E20).
// - Every AI agent is a record owned by an account. owner_id NULL means "the installation's owner", resolved when
//   asked, so the platform agents that already live in the world stay correct if ownership is ever transferred.
// - An agent is shared with accounts or roles at "use" (chat, see its work) or "manage" (also configure, share, remove).
// - The record is the agent's stable subject id (agents.id). The economy (Virtual Coin wallet, ledger, employment
//   contracts, licences, Rep, XP and Civic Credit) gets its own tables keyed by that id later; the versioned extension
//   object ext_json is reserved for it and is empty today (E20).
// - The resident body, the appearance and the desks are OPAQUE references (body_ref, look_ref, desk_json). This module
//   never reads inside them; a resolver does, and only the resolver changes when the character system is reworked (E20).
import { RANK } from './auth/permissions.js';
import { nameProblem, NAME_REFUSED } from './mind/speech.js';

export const LEVELS = Object.freeze(['use', 'manage']);
export const EXT_VERSION = 1;
export const emptyExt = () => ({ v: EXT_VERSION });

export const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
/** An agent's badge: one emoji, whole - a sequence joined by zero-width joiners or with a skin tone is one character to
 *  a person, and cutting it by length leaves half of it. */
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const emojiOf = s => { const t = clean(s, 64); if (!t) return ''; const g = SEGMENTER.segment(t)[Symbol.iterator]().next().value; return g && g.segment.length <= 32 ? g.segment : ''; };

export class AgentError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

/** The resolver today: bodies are residents in people.json, keyed 'person:<id>'. The character rework replaces this. */
export function peopleResolver(getPeople) {
  const find = ref => {
    const m = /^person:(.+)$/.exec(String(ref || ''));
    if (!m) return -1;
    return getPeople().findIndex(p => p && p.id === m[1]);
  };
  return {
    bodyRef: person => `person:${person.id}`,
    /** The resident index of a body, or -1 when the body is gone. */
    resolveBody: ref => find(ref),
    /** The appearance is whatever the character system keeps; today the resident's own. Returned untouched. */
    resolveLook: ref => { const i = find(ref); return i < 0 ? null : getPeople()[i].app ?? null; },
  };
}

/** The key of a connected agent's record (WP2.14): ext-<slot id>. */
export const EXT_PREFIX = 'ext-';
export const isExtKey = key => typeof key === 'string' && key.startsWith(EXT_PREFIX);

export class Agents {
  constructor(dbs, { audit = null, ownerId = () => null, resolver, now = () => Date.now(), log = null } = {}) {
    this.db = dbs.db; this.w = dbs.worldId; this.audit = audit; this.ownerId = ownerId; this.resolver = resolver;
    this.now = now; this.log = log;
    const db = this.db;
    this.q = {
      all: db.prepare('SELECT * FROM agents WHERE world_id = ? AND deleted IS NULL ORDER BY id'),
      byKey: db.prepare('SELECT * FROM agents WHERE world_id = ? AND agent_key = ?'),
      byId: db.prepare('SELECT * FROM agents WHERE world_id = ? AND id = ?'),
      ins: db.prepare(`INSERT INTO agents (world_id, agent_key, owner_id, connection_id, native_id, name, emoji, role, body_ref, look_ref, desk_json, voice_json, ext_json, enabled, created, updated)
        VALUES (@w, @key, @owner, @conn, @native, @name, @emoji, @role, @body, @look, @desk, @voice, @ext, 1, @now, @now)`),
      upd: db.prepare('UPDATE agents SET name = @name, emoji = @emoji, role = @role, owner_id = @owner, connection_id = @conn, native_id = @native, enabled = @enabled, voice_json = @voice, desk_json = @desk, look_ref = @look, updated = @now WHERE world_id = @w AND id = @id'),
      del: db.prepare('UPDATE agents SET deleted = ?, enabled = 0, updated = ? WHERE world_id = ? AND id = ?'),
      shares: db.prepare('SELECT * FROM agent_shares WHERE world_id = ? AND agent_id = ? ORDER BY kind, who'),
      allShares: db.prepare('SELECT * FROM agent_shares WHERE world_id = ?'),
      putShare: db.prepare(`INSERT INTO agent_shares (world_id, agent_id, kind, who, level, created) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (world_id, agent_id, kind, who) DO UPDATE SET level = excluded.level`),
      delShare: db.prepare('DELETE FROM agent_shares WHERE world_id = ? AND agent_id = ? AND kind = ? AND who = ?'),
      delShares: db.prepare('DELETE FROM agent_shares WHERE world_id = ? AND agent_id = ?'),
    };
    this.cache = null;
    this.listeners = new Set();   // () => void: the set of agents changed
    this.created = new Set();     // (agent) => void: a new agent record (Free Will starts on: index.mjs)
  }
  changed() { this.cache = null; for (const fn of this.listeners) { try { fn(); } catch (e) { this.log?.error?.('[agents] listener', e.message); } } }

  // ---------------------------------------------------------------- records
  row(r) {
    if (!r) return null;
    let ext; try { ext = JSON.parse(r.ext_json); } catch { ext = emptyExt(); }
    return { id: r.id, key: r.agent_key, ownerId: r.owner_id, connectionId: r.connection_id, nativeId: r.native_id, name: r.name, emoji: r.emoji, role: r.role,
      bodyRef: r.body_ref, lookRef: r.look_ref, desk: r.desk_json ? JSON.parse(r.desk_json) : null, voice: r.voice_json ? JSON.parse(r.voice_json) : null,
      ext, enabled: !!r.enabled, created: r.created, updated: r.updated };
  }
  list() { return this.cache || (this.cache = this.q.all.all(this.w).map(r => this.row(r))); }
  get(id) { return this.list().find(a => a.id === Number(id)) || null; }
  byKey(key) { return this.list().find(a => a.key === key) || null; }
  /** Agents in registry order: the demo mode's 3 are the first 3 enabled ones (E19). */
  enabled() { return this.list().filter(a => a.enabled); }
  shares(id) { return this.q.shares.all(this.w, Number(id)).map(s => ({ kind: s.kind, who: s.who, level: s.level })); }

  /** Makes sure every agent that lives in the world as a resident has a record (the platform agents; idempotent). */
  sync(people) {
    let n = 0;
    for (const p of people) {
      if (!p || !p.vip || !p.agentId) continue;
      if (this.q.byKey.get(this.w, p.agentId)) continue;
      const now = this.now();
      this.q.ins.run({ w: this.w, key: p.agentId, owner: null, conn: null, native: p.agentId, name: clean(p.name, 32) || p.agentId, emoji: emojiOf(p.emoji), role: clean(p.role, 60),
        body: this.resolver.bodyRef(p), look: null, desk: null, voice: null, ext: JSON.stringify(emptyExt()), now });
      n++;
    }
    if (n) { this.changed(); this.log?.info?.(`[agents] ${n} agent record(s) created for residents that were agents already`); }
    return n;
  }

  /** quiet: no created hooks (an agent of a provider's own, Agent Providers: Free Will starts when it gets a body). */
  create({ key, name, emoji = '', role = '', ownerId = null, connectionId = null, nativeId = null, bodyRef = null, lookRef = null, desk = null, voice = null }, actor = null, { quiet = false } = {}) {
    const nm = clean(name, 32);
    if (!nm) throw new AgentError(400, 'bad_name', 'The agent needs a name');
    if (nameProblem(nm)) throw new AgentError(400, 'bad_name', NAME_REFUSED);
    const k = clean(key, 64);
    if (!k) throw new AgentError(400, 'bad_key', 'The agent needs an id');
    if (this.q.byKey.get(this.w, k)) throw new AgentError(409, 'exists', 'An agent with this id already exists');
    const now = this.now();
    this.q.ins.run({ w: this.w, key: k, owner: ownerId, conn: connectionId, native: nativeId, name: nm, emoji: emojiOf(emoji), role: clean(role, 60),
      body: bodyRef, look: lookRef, desk: desk ? JSON.stringify(desk) : null, voice: voice ? JSON.stringify(voice) : null, ext: JSON.stringify(emptyExt()), now });
    this.changed();
    const a = this.byKey(k);
    this.audit?.log('agent.create', { actor, detail: { id: a.id, name: a.name } });
    if (!quiet) this.started(a);
    return a;
  }
  /** Runs the created hooks (Free Will starts, …) for an agent made quietly, once it has its body (Agent Providers). */
  started(a) { for (const fn of this.created) { try { fn(a); } catch (e) { this.log?.error?.('[agents] created hook', e.message); } } }
  update(id, patch, actor = null) {
    const a = this.get(id);
    if (!a) throw new AgentError(404, 'not_found', 'No such agent');
    const n = { ...a };
    if (patch.name !== undefined) { n.name = clean(patch.name, 32); if (!n.name) throw new AgentError(400, 'bad_name', 'The agent needs a name'); if (n.name !== a.name && nameProblem(n.name)) throw new AgentError(400, 'bad_name', NAME_REFUSED); }
    if (patch.emoji !== undefined) n.emoji = emojiOf(patch.emoji);
    if (patch.role !== undefined) n.role = clean(patch.role, 60);
    if (patch.enabled !== undefined) n.enabled = !!patch.enabled;
    if (patch.voice !== undefined) n.voice = patch.voice;
    if (patch.desk !== undefined) n.desk = patch.desk;
    if (patch.lookRef !== undefined) n.lookRef = patch.lookRef;
    if (patch.ownerId !== undefined) n.ownerId = patch.ownerId;
    if (patch.connectionId !== undefined) n.connectionId = patch.connectionId === null ? null : Number(patch.connectionId);
    if (patch.nativeId !== undefined) n.nativeId = patch.nativeId === null ? null : clean(patch.nativeId, 120);
    this.q.upd.run({ w: this.w, id: a.id, name: n.name, emoji: n.emoji, role: n.role, owner: n.ownerId, conn: n.connectionId ?? null, native: n.nativeId ?? null, enabled: n.enabled ? 1 : 0,
      voice: n.voice ? JSON.stringify(n.voice) : null, desk: n.desk ? JSON.stringify(n.desk) : null, look: n.lookRef ?? null, now: this.now() });
    this.changed();
    this.audit?.log('agent.update', { actor, detail: { id: a.id, fields: Object.keys(patch) } });
    return this.get(a.id);
  }
  /** Records the opaque reference of the body a new agent was given. */
  setBodyRef(id, ref) {
    this.db.prepare('UPDATE agents SET body_ref = ?, updated = ? WHERE world_id = ? AND id = ?').run(ref, this.now(), this.w, Number(id));
    this.changed();
  }
  /** Removes the record and its shares. The record is kept (marked deleted) so history that names it still resolves. */
  remove(id, actor = null) {
    const a = this.get(id);
    if (!a) throw new AgentError(404, 'not_found', 'No such agent');
    const now = this.now();
    this.q.del.run(now, now, this.w, a.id);
    this.q.delShares.run(this.w, a.id);
    this.changed();
    this.audit?.log('agent.remove', { actor, detail: { id: a.id, name: a.name } });
    return a;
  }

  // ---------------------------------------------------------------- shares and who may do what
  share(id, kind, who, level, actor = null) {
    const a = this.get(id);
    if (!a) throw new AgentError(404, 'not_found', 'No such agent');
    if (kind !== 'account' && kind !== 'role') throw new AgentError(400, 'bad_share', 'Share with an account or a role');
    if (!LEVELS.includes(level)) throw new AgentError(400, 'bad_level', 'The level is use or manage');
    who = String(who ?? '');
    if (kind === 'role' && !Object.hasOwn(RANK, who)) throw new AgentError(400, 'bad_role', 'Unknown role');
    // everyone of a role may use it - manage it, only people its owner names one by one (step 8, 2026-10-08)
    if (kind === 'role' && level === 'manage') throw new AgentError(400, 'bad_level', 'Share it to manage with a person, not with everyone of a role');
    if (kind === 'account' && !/^\d+$/.test(who)) throw new AgentError(400, 'bad_account', 'Unknown account');
    // a connected agent: who may chat with it is its slot's audience - it is shared only to manage, with a person
    if (isExtKey(a.key) && (kind !== 'account' || level !== 'manage')) throw new AgentError(400, 'connected_share', 'A connected agent is shared only to manage, with a person: who may chat with it is set in Settings → Third-party agents');
    this.q.putShare.run(this.w, a.id, kind, who, level, this.now());
    this.audit?.log('agent.share', { actor, detail: { id: a.id, kind, who, level } });
    return this.shares(a.id);
  }
  unshare(id, kind, who, actor = null) {
    const a = this.get(id);
    if (!a) throw new AgentError(404, 'not_found', 'No such agent');
    this.q.delShare.run(this.w, a.id, kind, String(who));
    this.audit?.log('agent.unshare', { actor, detail: { id: a.id, kind, who } });
    return this.shares(a.id);
  }
  isOwner(P, a) {
    if (!P || !P.account) return false;
    return a.ownerId === null ? P.role === 'owner' : a.ownerId === P.account.id;
  }
  /** 'manage', 'use' or null: what this principal may do with this agent. Owners manage; shares give use or manage;
   *  a role share applies to that role and every role above it. Nothing else grants access: not even an admin's role. */
  level(P, a) {
    if (!a || !P || !P.account) return null;
    // A connected agent (WP2.14; 2026-10-11): its owner manages it in its Agent Studio like any agent, and so does a person it
    // is shared with to manage. Who may chat with it is its slot's audience (Settings → Third-party agents): no 'use' or role
    // share widens that, and its name, connection and removal stay with the slot (routes.js refuses them here).
    if (isExtKey(a.key)) {
      if (this.isOwner(P, a)) return 'manage';
      if (this.q.shares.all(this.w, a.id).some(s => s.kind === 'account' && s.level === 'manage' && s.who === String(P.account.id))) return 'manage';
      return this.extraUse && this.extraUse(P, a) ? 'use' : null;   // extraUse: the slot's chat audience (index.mjs)
    }
    if (this.isOwner(P, a)) return 'manage';
    let best = null;
    for (const s of this.q.shares.all(this.w, a.id)) {
      const hit = s.kind === 'account' ? s.who === String(P.account.id) : (RANK[P.role] ?? 0) >= (RANK[s.who] ?? 99);
      if (!hit) continue;
      // (a role share gives use, never manage - even one made before that rule: step 8, 2026-10-08)
      if (s.level === 'manage' && s.kind === 'account') return 'manage';
      best = 'use';
    }
    return best;
  }
  canUse(P, a) { return this.level(P, a) !== null; }
  canManage(P, a) { return this.level(P, a) === 'manage'; }
  /** The agents this principal may use (the chat picker). */
  usable(P) { return this.enabled().filter(a => this.canUse(P, a)); }
}
