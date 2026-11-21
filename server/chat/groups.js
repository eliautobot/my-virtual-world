// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A group conversation (docs/features/companions.md §6e): what was said in it, by the person and by each agent, kept in one
// place so every agent in it is told what the others said — one conversation, not several private ones. Keyed by the person
// and the whole set of members (so the same group shares one thread, and nobody else's), bounded to the last lines, and told
// to each agent as a note with its message (server/chat/chat.js, server/mind/mind.js), never kept in its own chat's history.
// Who may be in a group is checked by the chat (Chat.groupOf): agents the person may chat with, at most GROUP_MAX.
export const GROUP_MAX = 8;   // agents in one group conversation
const KEEP = 60;              // lines kept per group (the note takes the newest few)
const LINE_MAX = 300;         // characters of one line in the note
const NOTE_MAX = 1500;        // characters of the whole note: the oldest lines go first

const flat = t => String(t ?? '').replace(/\s+/g, ' ').trim();

export class Groups {
  constructor(dbs, { now = () => Date.now(), log = null } = {}) {
    this.now = now; this.log = log;
    this.w = dbs.worldId;
    const q = dbs.db.prepare.bind(dbs.db);
    this.q = {
      add: q('INSERT INTO group_turns (world_id, owner_id, group_key, speaker, speaker_id, speaker_name, text, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
      last: q('SELECT * FROM group_turns WHERE world_id = ? AND owner_id = ? AND group_key = ? ORDER BY id DESC LIMIT ?'),
      trim: q('DELETE FROM group_turns WHERE world_id = ? AND owner_id = ? AND group_key = ? AND id NOT IN (SELECT id FROM group_turns WHERE world_id = ? AND owner_id = ? AND group_key = ? ORDER BY id DESC LIMIT ?)'),
    };
  }
  /** The one key for a set of members (order and repeats do not matter): "12,45,76". */
  key(ids) { return [...new Set((ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).join(','); }
  /** A line said in the group: speaker 'person' (the account) or 'agent' (one of the members). */
  say(owner, key, { speaker, id = null, name, text }) {
    const t = String(text || '').trim();
    if (!t || !key) return;
    try {
      this.q.add.run(this.w, Number(owner), String(key), String(speaker), id === null ? null : Number(id), String(name || '').slice(0, 40), t.slice(0, 4000), this.now());
      this.q.trim.run(this.w, Number(owner), String(key), this.w, Number(owner), String(key), KEEP);
    } catch (e) { this.log?.warn?.('[groups] keeping a line failed:', e.message); }
  }
  /** The newest lines of the group, oldest first: { speaker, speakerId, name, text, at }. */
  lines(owner, key, { limit = 14 } = {}) {
    if (!key) return [];
    let rows = [];
    try { rows = this.q.last.all(this.w, Number(owner), String(key), Math.max(1, Math.min(KEEP, limit))); } catch { rows = []; }
    return rows.reverse().map(r => ({ speaker: r.speaker, speakerId: r.speaker_id, name: r.speaker_name, text: r.text, at: r.at }));
  }
  /**
   * What agent `self` is told of the group it is in, as a note with its message: who else is here, and what was said, in
   * order — the person by name, the others by theirs, its own lines as "You". null with nothing said yet. Fits NOTE_MAX:
   * the oldest lines go first (what was just said always stays).
   */
  note(owner, key, { self = null, members = [], person = 'the person', limit = 14 } = {}) {
    const lines = this.lines(owner, key, { limit });
    if (!lines.length) return null;
    const who = flat(person).slice(0, 40) || 'the person';
    const others = (members || []).filter(m => m && Number(m.id) !== Number(self)).map(m => flat(m.name).slice(0, 40)).filter(Boolean);
    // (2026-11-17, the product owner: Lara and Sam "had the same very similar response to everything" — the second one, told what the first
    //  just said, said it again in other words: each one answers as itself, not as an echo)
    const head = `You are in a group conversation with ${[who, ...others].join(', ')}. What has been said in it, oldest first (your own lines are "You"). Answer only what is yours to answer, as yourself and not as an echo: your view comes from your own character and mood, and it may differ from the others'. Never reuse another's words, reasons or the shape of their answer, and don't just agree with them at length — if you would only be saying the same, say your part in a few words of your own, or add what they didn't:`;
    const said = lines.map(l => `${l.speaker === 'person' ? who : self !== null && Number(l.speakerId) === Number(self) ? 'You' : flat(l.name).slice(0, 40) || 'another agent'}: ${flat(l.text).slice(0, LINE_MAX)}`);
    let size = head.length + said.reduce((n, l) => n + l.length + 1, 0);
    while (said.length > 1 && size > NOTE_MAX) size -= said.shift().length + 1;
    return `${head}\n${said.join('\n')}`.slice(0, NOTE_MAX + LINE_MAX);
  }
}
