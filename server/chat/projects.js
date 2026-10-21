// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Chat projects (docs/features/CHAT.md §12): an account's folders of chats with one agent, each with its own
// instructions — what the agent should know or do in every chat of the project ("we're planning the bakery; answer in
// Spanish"). Private to the account (another account never finds them, even with the same agent); a project removed
// leaves its chats where they were, outside it.
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, n);
export const NAME_MAX = 60, INSTRUCTIONS_MAX = 4000, PROJECTS_MAX = 100;

export class Projects {
  constructor(dbs, { now = () => Date.now() } = {}) {
    this.db = dbs.db; this.w = dbs.worldId; this.now = now;
    this.q = {
      list: this.db.prepare('SELECT p.*, (SELECT COUNT(*) FROM chat_sessions s WHERE s.world_id = p.world_id AND s.project_id = p.id AND s.deleted IS NULL) AS chats FROM chat_projects p WHERE p.world_id = ? AND p.account_id = ? AND p.agent_id = ? ORDER BY p.updated DESC, p.id DESC'),
      get: this.db.prepare('SELECT p.*, (SELECT COUNT(*) FROM chat_sessions s WHERE s.world_id = p.world_id AND s.project_id = p.id AND s.deleted IS NULL) AS chats FROM chat_projects p WHERE p.world_id = ? AND p.account_id = ? AND p.id = ?'),
      count: this.db.prepare('SELECT COUNT(*) AS n FROM chat_projects WHERE world_id = ? AND account_id = ? AND agent_id = ?'),
      ins: this.db.prepare('INSERT INTO chat_projects (world_id, account_id, agent_id, name, instructions, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      upd: this.db.prepare('UPDATE chat_projects SET name = ?, instructions = ?, updated = ? WHERE world_id = ? AND id = ?'),
      del: this.db.prepare('DELETE FROM chat_projects WHERE world_id = ? AND id = ?'),
      free: this.db.prepare('UPDATE chat_sessions SET project_id = NULL WHERE world_id = ? AND project_id = ?'),
      touch: this.db.prepare('UPDATE chat_projects SET updated = ? WHERE world_id = ? AND id = ?'),
    };
  }
  view(r) { return r ? { id: r.id, agentId: r.agent_id, name: r.name, instructions: r.instructions, chats: Number(r.chats) || 0, created: r.created, updated: r.updated } : null; }
  list(accountId, agentId) { return this.q.list.all(this.w, accountId, agentId).map(r => this.view(r)); }
  /** One project of this account, or null (someone else's is simply not found). */
  get(accountId, id) { return this.view(this.q.get.get(this.w, accountId, Number(id) || 0)); }
  create(accountId, agentId, { name, instructions = '' }) {
    const n = clean(name, NAME_MAX);
    if (!n) throw Object.assign(new Error('Give the project a name'), { status: 400, code: 'bad_name' });
    if (this.q.count.get(this.w, accountId, agentId).n >= PROJECTS_MAX) throw Object.assign(new Error(`At most ${PROJECTS_MAX} projects with one agent`), { status: 409, code: 'too_many' });
    const t = this.now(), r = this.q.ins.run(this.w, accountId, agentId, n, clean(instructions, INSTRUCTIONS_MAX), t, t);
    return this.get(accountId, Number(r.lastInsertRowid));
  }
  update(accountId, id, { name, instructions } = {}) {
    const p = this.get(accountId, id);
    if (!p) return null;
    const n = name === undefined ? p.name : clean(name, NAME_MAX);
    if (!n) throw Object.assign(new Error('Give the project a name'), { status: 400, code: 'bad_name' });
    this.q.upd.run(n, instructions === undefined ? p.instructions : clean(instructions, INSTRUCTIONS_MAX), this.now(), this.w, p.id);
    return this.get(accountId, p.id);
  }
  remove(accountId, id) {
    const p = this.get(accountId, id);
    if (!p) return null;
    this.q.free.run(this.w, p.id);
    this.q.del.run(this.w, p.id);
    return p;
  }
  touch(id) { this.q.touch.run(this.now(), this.w, Number(id)); }
}
