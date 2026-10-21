// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The local transcript (PLAN WP2.2; DECISIONS C14, C119; docs/features/CHAT.md §3): every chat message, kept in the
// database (chat_messages, schema 27) per account, agent and session, so history survives reloads and provider restarts,
// each message has an id (edit a message, write an answer again: everything from it on goes) and a meta (model, effort,
// tokens, cost, time, attachments), and an account's chats can be searched (chat_messages_fts). History shown to a user
// is the provider's own export merged with this mirror (see chat.js). Until schema 27 the mirror was one JSON file per
// session under <data>/chat/: those are imported once, at start, and the folder is renamed <data>/chat.imported.
import fs from 'node:fs';
import path from 'node:path';

const MAX_ENTRIES = 5000;      // messages kept per session (the oldest go first)
export const TEXT_MAX = 100000;
const META_MAX = 8000;         // bytes of a message's meta
const id = n => { if (!Number.isInteger(n) || n < 1) throw new Error('bad transcript id'); return n; };
const role = r => (r === 'user' || r === 'assistant' ? r : 'system');

export class Transcripts {
  /** dbs: the accounts database; root: the old per-session JSON folder, imported once when it is there. */
  constructor(dbs, { root = null, now = () => Date.now(), log = null } = {}) {
    this.db = dbs.db; this.w = dbs.worldId; this.now = now; this.log = log; this.appends = 0;
    this.q = {
      read: this.db.prepare('SELECT * FROM (SELECT * FROM chat_messages WHERE world_id = ? AND account_id = ? AND agent_id = ? AND session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id'),
      ins: this.db.prepare('INSERT INTO chat_messages (world_id, account_id, agent_id, session_id, role, text, run_id, status, meta_json, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      one: this.db.prepare('SELECT * FROM chat_messages WHERE world_id = ? AND account_id = ? AND session_id = ? AND id = ?'),
      upd: this.db.prepare('UPDATE chat_messages SET text = ?, status = ?, meta_json = ? WHERE id = ?'),
      from: this.db.prepare('DELETE FROM chat_messages WHERE world_id = ? AND account_id = ? AND session_id = ? AND id >= ?'),
      del: this.db.prepare('DELETE FROM chat_messages WHERE world_id = ? AND account_id = ? AND agent_id = ? AND session_id = ?'),
      count: this.db.prepare('SELECT COUNT(*) AS n FROM chat_messages WHERE world_id = ? AND session_id = ?'),
      userCount: this.db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE world_id = ? AND session_id = ? AND role = 'user'"),
      trim: this.db.prepare('DELETE FROM chat_messages WHERE id IN (SELECT id FROM chat_messages WHERE world_id = ? AND session_id = ? ORDER BY id LIMIT ?)'),
      any: this.db.prepare('SELECT 1 FROM chat_messages WHERE world_id = ? AND session_id = ? LIMIT 1'),
      search: this.db.prepare(`SELECT m.id, m.session_id, m.agent_id, m.role, m.ts, snippet(chat_messages_fts, 0, '\u0002', '\u0003', '…', 12) AS snip
        FROM chat_messages_fts JOIN chat_messages m ON m.id = chat_messages_fts.rowid
        JOIN chat_sessions s ON s.id = m.session_id AND s.world_id = m.world_id AND s.deleted IS NULL
        WHERE chat_messages_fts MATCH ? AND m.world_id = ? AND m.account_id = ? AND (? IS NULL OR m.agent_id = ?) ORDER BY m.id DESC LIMIT ?`),
    };
    if (root) this.importLegacy(root);
  }
  view(r) {
    const e = { id: r.id, role: r.role, text: r.text, ts: r.ts };
    if (r.run_id) e.runId = r.run_id;
    if (r.status) e.status = r.status;
    if (r.meta_json) { try { e.meta = JSON.parse(r.meta_json); } catch { /* unreadable: left out */ } }
    return e;
  }
  read(accountId, agentId, sessionId, limit = MAX_ENTRIES) {
    return this.q.read.all(this.w, id(accountId), id(agentId), id(sessionId), Math.max(1, Math.min(MAX_ENTRIES, limit))).map(r => this.view(r));
  }
  get(accountId, sessionId, messageId) {
    const r = this.q.one.get(this.w, id(accountId), id(sessionId), Number(messageId) || 0);
    return r ? this.view(r) : null;
  }
  /** Adds one entry { role, text, runId?, status?, meta? }; the oldest beyond the cap go. Returns the entry (with its id). */
  append(accountId, agentId, sessionId, { role: r, text, runId = null, status = null, meta = null }) {
    const m = meta ? JSON.stringify(meta) : null;
    const res = this.q.ins.run(this.w, id(accountId), id(agentId), id(sessionId), role(r), String(text ?? '').slice(0, TEXT_MAX), runId || null, status || null,
      m && m.length <= META_MAX ? m : null, this.now());
    if (++this.appends % 50 === 0) {   // (the cap is looked after now and then, not on every message)
      const n = this.q.count.get(this.w, sessionId).n;
      if (n > MAX_ENTRIES) this.q.trim.run(this.w, sessionId, n - MAX_ENTRIES);
    }
    return this.get(accountId, sessionId, Number(res.lastInsertRowid));
  }
  /** Changes a message's text, status or meta (a streamed answer's final form). */
  update(accountId, sessionId, messageId, { text, status, meta } = {}) {
    const cur = this.q.one.get(this.w, id(accountId), id(sessionId), Number(messageId) || 0);
    if (!cur) return null;
    const m = meta === undefined ? cur.meta_json : meta ? JSON.stringify(meta) : null;
    this.q.upd.run(text === undefined ? cur.text : String(text ?? '').slice(0, TEXT_MAX), status === undefined ? cur.status : status || null,
      m && m.length <= META_MAX ? m : null, cur.id);
    return this.get(accountId, sessionId, cur.id);
  }
  /** Removes a message and every later one of its session (editing it, or writing an answer again). */
  truncateFrom(accountId, sessionId, messageId) { return Number(this.q.from.run(this.w, id(accountId), id(sessionId), Number(messageId) || 0).changes); }
  remove(accountId, agentId, sessionId) { this.q.del.run(this.w, id(accountId), id(agentId), id(sessionId)); }
  /** An account's messages that match `query` (every word, as a prefix), newest first, with a snippet whose match is
   *  marked \u0002…\u0003; only live sessions. */
  search(accountId, query, limit = 30, agentId = null) {
    const words = String(query || '').normalize('NFKC').match(/[\p{L}\p{N}_]+/gu) || [];
    if (!words.length) return [];
    const fts = words.slice(0, 8).map(w => `"${w.replace(/"/g, '')}"*`).join(' ');
    const ag = Number.isInteger(agentId) && agentId > 0 ? agentId : null;
    return this.q.search.all(fts, this.w, id(accountId), ag, ag, Math.max(1, Math.min(100, limit)))
      .map(r => ({ id: r.id, session: r.session_id, agent: r.agent_id, role: r.role, ts: r.ts, snippet: r.snip }));
  }

  /** How many messages the person wrote in a session (a talk in the city counts them against its limit). */
  userCount(sessionId) { return this.q.userCount.get(this.w, Number(sessionId)).n; }

  /** The JSON files of schema 26 and before, into the table (sessions that have rows already are left as they are). */
  importLegacy(root) {
    if (!fs.existsSync(root)) return;
    let n = 0;
    try {
      for (const acc of fs.readdirSync(root)) for (const ag of safeDir(path.join(root, acc))) for (const f of safeDir(path.join(root, acc, ag))) {
        const s = /^(\d+)\.json$/.exec(f);
        if (!/^\d+$/.test(acc) || !/^\d+$/.test(ag) || !s || this.q.any.get(this.w, Number(s[1]))) continue;
        let list = [];
        try { list = JSON.parse(fs.readFileSync(path.join(root, acc, ag, f), 'utf8')); } catch { continue; }
        if (!Array.isArray(list)) continue;
        this.db.exec('BEGIN');
        try {
          for (const e of list.slice(-MAX_ENTRIES)) if (e && typeof e.text === 'string') {
            this.q.ins.run(this.w, Number(acc), Number(ag), Number(s[1]), role(e.role), e.text.slice(0, TEXT_MAX), e.runId || null, e.status || null, null, Number(e.ts) || this.now());
            n++;
          }
          this.db.exec('COMMIT');
        } catch (err) { this.db.exec('ROLLBACK'); throw err; }
      }
      fs.renameSync(root, `${root}.imported`);
      if (n) this.log?.info?.(`[chat] imported ${n} messages from the old transcript files`);
    } catch (e) { this.log?.warn?.('[chat] the old transcript files could not all be imported:', e.message); }
  }
}
function safeDir(p) { try { return fs.statSync(p).isDirectory() ? fs.readdirSync(p) : []; } catch { return []; } }

/** The provider's export and the mirror as one list: the provider's messages first, then mirror entries the provider does not have. */
export function mergeHistory(provider, mirror) {
  const key = m => `${m.role}\u0000${m.text}`;
  const out = (provider || []).filter(m => m && typeof m.text === 'string').map(m => ({ role: m.role === 'user' || m.role === 'assistant' ? m.role : 'system', text: m.text.slice(0, TEXT_MAX), ts: m.ts ?? null, source: 'provider' }));
  const seen = new Set(out.map(key));
  for (const m of mirror || []) if (!seen.has(key(m))) { out.push({ ...m, source: 'mirror' }); seen.add(key(m)); }
  return out;
}
