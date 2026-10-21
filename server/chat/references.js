// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Chat references (PLAN WP2.2; DECISIONS C53, decided in batch 10): notes and links attached to an agent, shown in every chat
// window with that agent. They are shared by every account allowed to chat with it; whoever manages the agent adds and removes.
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/g, '').trim().slice(0, n);
export const KINDS = Object.freeze(['note', 'link']);

export class References {
  constructor(dbs, { now = () => Date.now() } = {}) {
    this.db = dbs.db; this.w = dbs.worldId; this.now = now;
    this.q = {
      list: this.db.prepare('SELECT * FROM chat_references WHERE world_id = ? AND agent_id = ? ORDER BY id'),
      get: this.db.prepare('SELECT * FROM chat_references WHERE world_id = ? AND agent_id = ? AND id = ?'),
      ins: this.db.prepare('INSERT INTO chat_references (world_id, agent_id, kind, ref_json, created_by, created) VALUES (?, ?, ?, ?, ?, ?)'),
      del: this.db.prepare('DELETE FROM chat_references WHERE world_id = ? AND agent_id = ? AND id = ?'),
      delAll: this.db.prepare('DELETE FROM chat_references WHERE world_id = ? AND agent_id = ?'),
    };
  }
  view(r) { let ref; try { ref = JSON.parse(r.ref_json); } catch { ref = {}; } return { id: r.id, kind: r.kind, ...ref, by: r.created_by, created: r.created }; }
  list(agentId) { return this.q.list.all(this.w, agentId).map(r => this.view(r)); }
  add(agentId, { kind, title, text, url }, accountId) {
    if (!KINDS.includes(kind)) return { error: 'bad_kind', message: 'A reference is a note or a link' };
    const ref = { title: clean(title, 80) };
    if (kind === 'note') ref.text = clean(text, 4000);
    else {
      let u; try { u = new URL(String(url)); } catch { return { error: 'bad_url', message: 'That is not a web address' }; }
      if (!['http:', 'https:'].includes(u.protocol)) return { error: 'bad_url', message: 'A link must start with http or https' };
      ref.url = u.toString();
    }
    if (!ref.title && !ref.text && !ref.url) return { error: 'empty', message: 'Give the reference a title or text' };
    const r = this.q.ins.run(this.w, agentId, kind, JSON.stringify(ref), accountId ?? null, this.now());
    return { reference: this.view(this.q.get.get(this.w, agentId, Number(r.lastInsertRowid))) };
  }
  remove(agentId, id) { return this.q.del.run(this.w, agentId, Number(id)).changes > 0; }
  removeAll(agentId) { this.q.delAll.run(this.w, agentId); }
}
