// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Chat sessions (PLAN WP2.2; DECISIONS C119): a session belongs to one account and one agent. Other accounts never see it, even
// when they may use the same agent. New Session never destroys the old one; delete is the only destructive action.
export const LAZY_KEY = '@new';
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

export class Sessions {
  constructor(dbs, { now = () => Date.now() } = {}) {
    this.db = dbs.db; this.w = dbs.worldId; this.now = now;
    this.q = {
      // (a talk in the city - kind 'talk', server/agent-talk/ - is never in the chat window's lists)
      list: this.db.prepare('SELECT * FROM chat_sessions WHERE world_id = ? AND account_id = ? AND agent_id = ? AND deleted IS NULL AND kind IS NULL ORDER BY updated DESC, id DESC'),
      get: this.db.prepare('SELECT * FROM chat_sessions WHERE world_id = ? AND id = ? AND account_id = ? AND deleted IS NULL'),
      ins: this.db.prepare('INSERT INTO chat_sessions (world_id, agent_id, account_id, native_key, label, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      insTalk: this.db.prepare("INSERT INTO chat_sessions (world_id, agent_id, account_id, native_key, label, created, updated, kind) VALUES (?, ?, ?, ?, ?, ?, ?, 'talk')"),
      talkLatest: this.db.prepare("SELECT * FROM chat_sessions WHERE world_id = ? AND account_id = ? AND agent_id = ? AND kind = 'talk' AND deleted IS NULL ORDER BY id DESC LIMIT 1"),
      talksOf: this.db.prepare("SELECT * FROM chat_sessions WHERE world_id = ? AND agent_id = ? AND kind = 'talk' AND deleted IS NULL ORDER BY updated DESC, id DESC LIMIT ?"),
      talkOne: this.db.prepare("SELECT * FROM chat_sessions WHERE world_id = ? AND agent_id = ? AND id = ? AND kind = 'talk' AND deleted IS NULL"),
      talkOld: this.db.prepare("UPDATE chat_sessions SET deleted = ? WHERE world_id = ? AND kind = 'talk' AND deleted IS NULL AND updated < ?"),
      key: this.db.prepare('UPDATE chat_sessions SET native_key = ?, updated = ? WHERE world_id = ? AND id = ?'),
      label: this.db.prepare('UPDATE chat_sessions SET label = ?, updated = ? WHERE world_id = ? AND id = ?'),
      touch: this.db.prepare('UPDATE chat_sessions SET updated = ? WHERE world_id = ? AND id = ?'),
      del: this.db.prepare('UPDATE chat_sessions SET deleted = ?, updated = ? WHERE world_id = ? AND id = ?'),
      ofAgent: this.db.prepare('SELECT id, account_id FROM chat_sessions WHERE world_id = ? AND agent_id = ? AND deleted IS NULL'),
      withKey: this.db.prepare('SELECT id, account_id FROM chat_sessions WHERE world_id = ? AND agent_id = ? AND native_key = ? AND deleted IS NULL AND kind IS NULL'),
      prefs: this.db.prepare('UPDATE chat_sessions SET model = ?, effort = ?, pinned = ?, mode = ?, updated = updated WHERE world_id = ? AND id = ?'),
      recent: this.db.prepare('SELECT * FROM chat_sessions WHERE world_id = ? AND account_id = ? AND deleted IS NULL AND kind IS NULL ORDER BY pinned DESC, updated DESC, id DESC LIMIT ?'),
      recentOf: this.db.prepare('SELECT * FROM chat_sessions WHERE world_id = ? AND account_id = ? AND agent_id = ? AND deleted IS NULL AND kind IS NULL ORDER BY pinned DESC, updated DESC, id DESC LIMIT ?'),
      project: this.db.prepare('UPDATE chat_sessions SET project_id = ? WHERE world_id = ? AND id = ?'),
      byKey: this.db.prepare('SELECT * FROM chat_sessions WHERE world_id = ? AND account_id = ? AND agent_id = ? AND native_key = ? AND deleted IS NULL AND kind IS NULL ORDER BY id DESC LIMIT 1'),
      adopt: this.db.prepare('INSERT INTO chat_sessions (world_id, agent_id, account_id, native_key, label, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      inProject: this.db.prepare('SELECT * FROM chat_sessions WHERE world_id = ? AND account_id = ? AND project_id = ? AND deleted IS NULL AND kind IS NULL ORDER BY pinned DESC, updated DESC, id DESC LIMIT ?'),
    };
  }
  view(r) {
    return r ? { id: r.id, agentId: r.agent_id, key: r.native_key, label: r.label, created: r.created, updated: r.updated,
      model: r.model ?? null, effort: r.effort ?? null, pinned: !!r.pinned, projectId: r.project_id ?? null, mode: r.mode ?? null, kind: r.kind ?? null } : null;
  }
  list(accountId, agentId) { return this.q.list.all(this.w, accountId, agentId).map(r => this.view(r)); }
  /** Every live session of this account, whatever the agent: pinned first, then the most recent (the window's list). */
  recent(accountId, limit = 200, agentId = null) {
    const n = Math.max(1, Math.min(500, limit));
    return (agentId ? this.q.recentOf.all(this.w, accountId, agentId, n) : this.q.recent.all(this.w, accountId, n)).map(r => this.view(r));
  }
  /** The live chats of one of the account's projects, pinned first, then the most recent. */
  inProject(accountId, projectId, limit = 200) { return this.q.inProject.all(this.w, accountId, projectId, Math.max(1, Math.min(500, limit))).map(r => this.view(r)); }
  /** Puts a chat in a project (null: none). */
  setProject(accountId, id, projectId) {
    const s = this.get(accountId, id); if (!s) return null;
    this.q.project.run(projectId ?? null, this.w, s.id);
    return this.get(accountId, s.id);
  }
  /** The session's own model, thinking effort and Work or Life mode (null: the agent's) and whether it is pinned. */
  setPrefs(accountId, id, { model, effort, pinned, mode } = {}) {
    const s = this.get(accountId, id); if (!s) return null;
    this.q.prefs.run(model === undefined ? s.model : model, effort === undefined ? s.effort : effort, pinned === undefined ? (s.pinned ? 1 : 0) : (pinned ? 1 : 0),
      mode === undefined ? s.mode : mode, this.w, s.id);
    return this.get(accountId, s.id);
  }
  /** One session of this account, or null: someone else's session is simply not found. */
  get(accountId, id) { return this.view(this.q.get.get(this.w, Number(id), accountId)); }
  create(accountId, agentId, nativeKey, label) {
    const now = this.now();
    const r = this.q.ins.run(this.w, agentId, accountId, nativeKey || LAZY_KEY, clean(label, 60) || 'New session', now, now);
    return this.get(accountId, Number(r.lastInsertRowid));
  }
  setKey(id, key) { this.q.key.run(String(key), this.now(), this.w, Number(id)); }
  /** This account's chat with the agent that is the provider's session `key`, or null. */
  byKey(accountId, agentId, key) { return this.view(this.q.byKey.get(this.w, accountId, agentId, String(key))); }
  /** A session the provider already has (Agent Providers: started elsewhere), kept as one of this account's chats. */
  adopt(accountId, agentId, key, label, updated) {
    const r = this.q.adopt.run(this.w, agentId, accountId, String(key), clean(label, 60) || 'Chat', updated, updated);
    return this.get(accountId, Number(r.lastInsertRowid));
  }
  touch(id) { this.q.touch.run(this.now(), this.w, Number(id)); }
  rename(accountId, id, label) {
    const s = this.get(accountId, id); if (!s) return null;
    this.q.label.run(clean(label, 60) || s.label, this.now(), this.w, s.id);
    return this.get(accountId, s.id);
  }
  remove(accountId, id) {
    const s = this.get(accountId, id); if (!s) return null;
    const now = this.now(); this.q.del.run(now, now, this.w, s.id);
    return s;
  }
  // ---- talks in the city (server/agent-talk/): an account's conversation with someone else's agent
  /** A new talk (its context starts empty). */
  createTalk(accountId, agentId, label) {
    const now = this.now();
    const r = this.q.insTalk.run(this.w, agentId, accountId, LAZY_KEY, clean(label, 60) || 'Talk', now, now);
    return this.get(accountId, Number(r.lastInsertRowid));
  }
  /** The account's latest talk with the agent, or null. */
  latestTalk(accountId, agentId) { return this.view(this.q.talkLatest.get(this.w, accountId, agentId)); }
  /** An agent's talks with others, newest first, with who they were with (account_id): its owner's review. */
  talksOf(agentId, limit = 100) { return this.q.talksOf.all(this.w, agentId, Math.max(1, Math.min(500, limit))).map(r => ({ ...this.view(r), accountId: r.account_id })); }
  talkOf(agentId, id) { const r = this.q.talkOne.get(this.w, agentId, Number(id)); return r ? { ...this.view(r), accountId: r.account_id } : null; }
  /** Talks not touched since `before` are let go (kept for their owners' review until then). */
  dropOldTalks(before) { return this.q.talkOld.run(this.now(), this.w, before).changes; }

  /** Every live session of an agent (for removing them with the agent). */
  ofAgent(agentId) { return this.q.ofAgent.all(this.w, agentId); }
  /** Every account's chat with this agent on this provider session ({ id, accountId }): who sees it working. */
  withKey(agentId, key) { return this.q.withKey.all(this.w, agentId, String(key)).map(r => ({ id: r.id, accountId: r.account_id })); }
}
