// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What was said out loud around an AI agent, kept as its conversation history (2026-11-25, the product owner: "add a
// record of what agents say out loud to each other in person, like a conversation history. Add it in the agent's
// studio"). Its speech bubbles were seen and gone: now every line an AI agent says in the city with someone within earshot,
// and every line it hears in person (another agent, a resident, a player's proximity chat), is kept for its owner to read
// in the Studio's Conversations tab — grouped into conversations by place and pause, newest first.
// - Who hears: the senses' own rule (server/senses/senses.js heard: within HEAR_M, the same space); this only keeps it.
// - One row per line (spoken_lines: who said it, where, who else was near) and one per AI agent it concerns (spoken_ears:
//   said or heard), so an agent's history is one index walk and a line heard by three agents is kept once.
// - Kept spoken.keepDays days (30 by default), then deleted. Private to the agent's owner and its managers (the route
//   answers 404 to anyone else). Talks with a player through the talk bar are private and stay in Visitors (server/agent-talk/).
const DAY = 86400000;
export const SPOKEN = Object.freeze({
  keepDays: 30,        // how long lines are kept (setting spoken.keepDays)
  gapMs: 5 * 60000,    // a pause this long (real time), or another place, starts a new conversation
  pageLines: 400,      // lines read for one page of conversations
  maxLines: 150,       // a conversation longer than this (a whole shift side by side) goes on as the next one
  maxChars: 400,       // a line kept at most this long
  maxNear: 8,          // the others near it named with a line
});
const clean = (t, n) => String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const KINDS = new Set(['agent', 'resident', 'player']);

export class SpokenLog {
  /** @param {{ dbs: object, keepDays?: () => number, now?: () => number, log?: object }} o */
  constructor({ dbs, keepDays = () => SPOKEN.keepDays, now = () => Date.now(), log = null }) {
    Object.assign(this, { keepDays, now, log });
    this.w = dbs.worldId; this.db = dbs.db; this.dbs = dbs;
    this.q = {
      line: this.db.prepare(`INSERT INTO spoken_lines (world_id, at, speaker_kind, speaker_id, speaker_name, text, place, near_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      ear: this.db.prepare('INSERT OR IGNORE INTO spoken_ears (world_id, agent_id, line_id, said) VALUES (?, ?, ?, ?)'),
      of: this.db.prepare(`SELECT l.id, l.at, l.speaker_kind, l.speaker_id, l.speaker_name, l.text, l.place, l.near_json, e.said
        FROM spoken_ears e JOIN spoken_lines l ON l.id = e.line_id
        WHERE e.world_id = ? AND e.agent_id = ? AND e.line_id < ? ORDER BY e.line_id DESC LIMIT ?`),
      count: this.db.prepare('SELECT COUNT(*) AS n FROM spoken_ears WHERE world_id = ? AND agent_id = ?'),
      lastOld: this.db.prepare('SELECT MAX(id) AS id FROM spoken_lines WHERE world_id = ? AND at < ?'),
      dropEars: this.db.prepare('DELETE FROM spoken_ears WHERE world_id = ? AND line_id <= ?'),
      dropLines: this.db.prepare('DELETE FROM spoken_lines WHERE world_id = ? AND id <= ?'),
      forget: this.db.prepare('DELETE FROM spoken_ears WHERE world_id = ? AND agent_id = ?'),
    };
    this.stats = { lines: 0, ears: 0, failed: 0 };
    this.timer = null;
  }

  /**
   * Keeps one line said out loud.
   * @param {{ speaker: { kind: 'agent'|'resident'|'player', id?: string|number|null, name: string, agent?: number|null },
   *   text: string, place?: string, ears: number[], near?: { kind: string, id?: string|number|null, name: string }[] }} l
   *   ears: the AI agents (ids) it concerns — the speaker (when it is one) and every one that heard it.
   * @returns {number|null} the line's id, or null when there was nothing to keep
   */
  record({ speaker, text, place = '', ears = [], near = [] }) {
    const words = clean(text, SPOKEN.maxChars), who = clean(speaker?.name, 60);
    const kind = KINDS.has(speaker?.kind) ? speaker.kind : 'resident';
    const said = Number.isInteger(speaker?.agent) ? speaker.agent : null;
    const ids = [...new Set(ears.map(Number).filter(n => Number.isInteger(n) && n > 0))];
    if (!words || !who || !ids.length) return null;
    const others = near.slice(0, SPOKEN.maxNear).map(x => ({ kind: KINDS.has(x?.kind) ? x.kind : 'resident', ...(x?.id != null ? { id: String(x.id) } : {}), name: clean(x?.name, 60) }))
      .filter(x => x.name);
    try {
      let id = null;
      this.dbs.tx(() => {
        id = Number(this.q.line.run(this.w, this.now(), kind, speaker.id == null ? null : String(speaker.id), who, words, clean(place, 120), JSON.stringify(others)).lastInsertRowid);
        for (const a of ids) this.q.ear.run(this.w, a, id, a === said ? 1 : 0);
      });
      this.stats.lines++; this.stats.ears += ids.length;
      return id;
    } catch (e) { this.stats.failed++; this.log?.warn?.('[spoken] a line could not be kept:', e.message); return null; }
  }

  /**
   * Agent agentId's conversations, newest first: its lines (said and heard) grouped by place and by pauses of
   * SPOKEN.gapMs, at most SPOKEN.maxLines each (so a page always ends on a whole one). before: a line id (the page's
   * `next`), to read older ones.
   * @returns {{ conversations: object[], next: number|null, keepDays: number, total: number }}
   */
  conversations(agentId, { before = null, limit = SPOKEN.pageLines } = {}) {
    const n = Math.max(20, Math.min(SPOKEN.pageLines, Number(limit) || SPOKEN.pageLines));
    const rows = this.q.of.all(this.w, Number(agentId), Number.isInteger(before) && before > 0 ? before : Number.MAX_SAFE_INTEGER, n + 1);
    const more = rows.length > n;
    if (more) rows.length = n;
    const groups = [];
    let g = null;
    for (const r of rows) {   // (newest first: a group grows backwards in time)
      const place = r.place || '';
      if (!g || g.place !== place || g.started - r.at > SPOKEN.gapMs || g.lines.length >= SPOKEN.maxLines) { g = { place, started: r.at, ended: r.at, lines: [] }; groups.push(g); }
      g.started = r.at;
      let near = []; try { near = JSON.parse(r.near_json || '[]'); } catch { near = []; }
      g.lines.push({ id: r.id, at: r.at, said: !!r.said, speaker: { kind: r.speaker_kind, ...(r.speaker_id != null ? { id: r.speaker_id } : {}), name: r.speaker_name }, text: r.text, near });
    }
    // a page that ran out mid-conversation: that one comes whole with the next page (unless it is all there is)
    if (more && groups.length > 1) groups.pop();
    const out = groups.map(x => {
      x.lines.reverse();   // (a conversation reads oldest first)
      const who = new Map();
      for (const l of x.lines) {
        if (!l.said) who.set(`${l.speaker.kind}:${l.speaker.id ?? l.speaker.name}`, { kind: l.speaker.kind, name: l.speaker.name });
        for (const o of l.near) if (o.kind !== 'agent' || String(o.id) !== String(agentId)) who.set(`${o.kind}:${o.id ?? o.name}`, { kind: o.kind, name: o.name });
      }
      return { id: x.lines[0].id, place: x.place, started: x.started, ended: x.ended, lines: x.lines, with: [...who.values()].slice(0, 12),
        said: x.lines.filter(l => l.said).length, heard: x.lines.filter(l => !l.said).length };
    });
    const oldest = out.length ? Math.min(...out.at(-1).lines.map(l => l.id)) : null;
    return { conversations: out, next: more && oldest ? oldest : null, keepDays: this.days(), total: this.q.count.get(this.w, Number(agentId)).n };
  }

  days() { const d = Number(this.keepDays()); return Number.isFinite(d) && d >= 1 ? Math.min(365, Math.floor(d)) : SPOKEN.keepDays; }
  /** Deletes lines older than keepDays (and who they concerned). */
  tidy() {
    try {
      const last = this.q.lastOld.get(this.w, this.now() - this.days() * DAY)?.id;
      if (!last) return 0;
      let n = 0;
      this.dbs.tx(() => { this.q.dropEars.run(this.w, last); n = this.q.dropLines.run(this.w, last).changes; });
      return n;
    } catch (e) { this.log?.warn?.('[spoken] tidy failed:', e.message); return 0; }
  }
  /** Its owner clears agent agentId's history (the lines others also heard stay theirs). */
  forget(agentId) { return this.q.forget.run(this.w, Number(agentId)).changes; }
  start(everyMs = 3600000) { if (!this.timer) { this.tidy(); this.timer = setInterval(() => this.tidy(), everyMs); this.timer.unref?.(); } return this; }
  stop() { clearInterval(this.timer); this.timer = null; }
}
