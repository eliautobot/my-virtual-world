// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's work (docs/features/CHAT.md §13): what it is on the job for its owner, kept apart from its life in the city.
// - The brief: who it works for (company), what it is to do and how (instructions: its system prompt for work), its tone,
//   the time zone it works in, what it knows (knowledge), whether it keeps work notes, the mode a new chat starts in
//   (defaultMode) and what others who talk with it get (publicMode: its job, its life, or only a greeting — CHAT.md §14.3).
//   Its job title is the agent's own role.
// - Work notes: what it keeps from work chats (its owner's preferences, decisions, names, deadlines) — never mixed with its
//   memories of its life (agent_memories). Its owner adds and removes them too.
// - Knowledge files: a copy of each (deleting the upload from the Library leaves it), the text of documents read once;
//   PDFs go to the model as they are with each work message (images are not taken: a model that cannot see would refuse
//   every work message).
// Everything it knows goes with every work message, so it is bounded: KNOW_CHARS of text in all (typed and files' text),
// PDF_MAX bytes of PDFs, FILES_MAX files.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { extractText, kindOf } from '../chat/extract.js';

export class WorkError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export const TONES = ['own', 'friendly', 'professional', 'concise', 'formal'];
export const MODES = ['work', 'life'];
export const PUBLIC_MODES = ['work', 'life', 'greet'];   // (others: its job, its life in the city, or a greeting and no more)
export const KNOW_CHARS = 60000;          // text it knows for its job, typed and from files (≈ 15,000 tokens a message)
export const PDF_MAX = 8 * 1048576;       // its PDFs, in all
export const FILES_MAX = 10;
export const NOTES_MAX = 200;             // notes kept (the oldest go first)
export const NOTES_SENT = 40;             // the newest notes that go with a work message
const INSTRUCTIONS_MAX = 8000, COMPANY_MAX = 80, NOTE_MAX = 500, TZ_MAX = 64;
export const DEFAULT_BRIEF = Object.freeze({ company: '', instructions: '', tone: 'own', timezone: '', knowledge: '', notes: true, defaultMode: 'work', publicMode: 'life' });

const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const text = (s, n) => String(s ?? '').replace(/\r\n?/g, '\n').replace(CTRL, '').trim().slice(0, n);
const line = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const safeName = n => String(n ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '').trim().slice(0, 120);

/** Whether `tz` is a time zone this server knows (IANA, e.g. "America/New_York"). */
export function validZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > TZ_MAX || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** The server's own time zone (the last resort for the time at work). */
export const serverZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
/** The real date and time at `t` in `zone`, as a person says it ("Thursday, October 8, 2026 at 2:05 PM EDT"). */
export function realTime(t, zone) {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(t));
}

export class Work {
  /** root: where the knowledge files are kept (<data>/work-files/<agent>/<sha256>). */
  constructor(dbs, root, { now = () => Date.now() } = {}) {
    this.db = dbs.db; this.w = dbs.worldId; this.root = root; this.now = now;
    this.q = {
      brief: this.db.prepare('SELECT brief_json FROM agent_work WHERE world_id = ? AND agent_id = ?'),
      setBrief: this.db.prepare(`INSERT INTO agent_work (world_id, agent_id, brief_json, updated) VALUES (?, ?, ?, ?)
        ON CONFLICT (world_id, agent_id) DO UPDATE SET brief_json = excluded.brief_json, updated = excluded.updated`),
      notes: this.db.prepare('SELECT id, text, source, created FROM agent_work_notes WHERE world_id = ? AND agent_id = ? ORDER BY id DESC LIMIT ?'),
      note: this.db.prepare('SELECT id FROM agent_work_notes WHERE world_id = ? AND agent_id = ? AND text = ? COLLATE NOCASE'),
      addNote: this.db.prepare('INSERT INTO agent_work_notes (world_id, agent_id, text, source, created) VALUES (?, ?, ?, ?, ?)'),
      delNote: this.db.prepare('DELETE FROM agent_work_notes WHERE world_id = ? AND agent_id = ? AND id = ?'),
      countNotes: this.db.prepare('SELECT COUNT(*) AS n FROM agent_work_notes WHERE world_id = ? AND agent_id = ?'),
      trimNotes: this.db.prepare(`DELETE FROM agent_work_notes WHERE id IN (SELECT id FROM agent_work_notes WHERE world_id = ? AND agent_id = ? ORDER BY id LIMIT ?)`),
      files: this.db.prepare('SELECT id, sha256, name, mime, size, kind, text, created FROM agent_work_files WHERE world_id = ? AND agent_id = ? ORDER BY id'),
      file: this.db.prepare('SELECT id, sha256, name, mime, size, kind, text, created FROM agent_work_files WHERE world_id = ? AND agent_id = ? AND id = ?'),
      fileBySha: this.db.prepare('SELECT id FROM agent_work_files WHERE world_id = ? AND agent_id = ? AND sha256 = ?'),
      addFile: this.db.prepare('INSERT INTO agent_work_files (world_id, agent_id, sha256, name, mime, size, kind, text, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      delFile: this.db.prepare('DELETE FROM agent_work_files WHERE world_id = ? AND agent_id = ? AND id = ?'),
    };
  }

  // ---------------------------------------------------------------- the brief
  brief(agentId) {
    const r = this.q.brief.get(this.w, Number(agentId));
    let b = {};
    try { b = r ? JSON.parse(r.brief_json) : {}; } catch { b = {}; }
    // (anything unknown or no longer valid falls back to the default: a brief written by a newer release still reads)
    const out = { ...DEFAULT_BRIEF };
    for (const k of Object.keys(DEFAULT_BRIEF)) if (b[k] !== undefined && typeof b[k] === typeof DEFAULT_BRIEF[k]) out[k] = b[k];
    if (!TONES.includes(out.tone)) out.tone = DEFAULT_BRIEF.tone;
    if (!MODES.includes(out.defaultMode)) out.defaultMode = DEFAULT_BRIEF.defaultMode;
    if (!PUBLIC_MODES.includes(out.publicMode)) out.publicMode = DEFAULT_BRIEF.publicMode;
    if (out.timezone && !validZone(out.timezone)) out.timezone = '';
    return out;
  }
  /** Changes the fields given; each is checked, and what it knows stays within KNOW_CHARS with its files' text. */
  setBrief(agentId, patch = {}) {
    const b = this.brief(agentId), p = patch && typeof patch === 'object' ? patch : {};
    let changed = false;
    const set = (k, v) => { if (b[k] !== v) { b[k] = v; changed = true; } };
    if (p.company !== undefined) set('company', line(p.company, COMPANY_MAX));
    if (p.instructions !== undefined) {
      if (typeof p.instructions !== 'string') throw new WorkError(400, 'bad_instructions', 'The instructions are text');
      if (p.instructions.length > INSTRUCTIONS_MAX) throw new WorkError(400, 'too_long', `The instructions may be at most ${INSTRUCTIONS_MAX.toLocaleString('en-US')} characters`);
      set('instructions', text(p.instructions, INSTRUCTIONS_MAX));
    }
    if (p.knowledge !== undefined) {
      if (typeof p.knowledge !== 'string') throw new WorkError(400, 'bad_knowledge', 'What it knows is text');
      const k = text(p.knowledge, KNOW_CHARS + 1), files = this.fileChars(agentId);
      if (k.length + files > KNOW_CHARS) throw new WorkError(400, 'knowledge_full', `What it knows may be at most ${KNOW_CHARS.toLocaleString('en-US')} characters in all; its files already hold ${files.toLocaleString('en-US')}`);
      set('knowledge', k);
    }
    if (p.tone !== undefined) { if (!TONES.includes(p.tone)) throw new WorkError(400, 'bad_tone', `The tone is one of ${TONES.join(', ')}`); set('tone', p.tone); }
    if (p.timezone !== undefined) {
      if (p.timezone !== '' && !validZone(p.timezone)) throw new WorkError(400, 'bad_timezone', 'That is not a time zone this server knows (like America/New_York)');
      set('timezone', p.timezone);
    }
    if (p.notes !== undefined) { if (typeof p.notes !== 'boolean') throw new WorkError(400, 'bad_notes', 'Notes are on (true) or off (false)'); set('notes', p.notes); }
    if (p.defaultMode !== undefined) { if (!MODES.includes(p.defaultMode)) throw new WorkError(400, 'bad_mode', 'The mode is work or life'); set('defaultMode', p.defaultMode); }
    if (p.publicMode !== undefined) { if (!PUBLIC_MODES.includes(p.publicMode)) throw new WorkError(400, 'bad_mode', 'Others get work, life or greet'); set('publicMode', p.publicMode); }
    if (changed) this.q.setBrief.run(this.w, Number(agentId), JSON.stringify(b), this.now());
    return b;
  }

  // ---------------------------------------------------------------- notes
  notes(agentId, limit = NOTES_MAX) {
    return this.q.notes.all(this.w, Number(agentId), Math.max(1, Math.min(NOTES_MAX, Number(limit) || NOTES_MAX))).map(r => ({ id: r.id, text: r.text, source: r.source, created: r.created }));
  }
  /** Keeps a note (source 'agent': it kept it from a chat; 'owner': written in the Studio). One already kept is not kept
   *  twice; past NOTES_MAX the oldest go. Returns the note, or null when there was nothing (new) to keep. */
  addNote(agentId, t, source = 'agent') {
    const s = line(t, NOTE_MAX);
    if (!s) { if (source === 'owner') throw new WorkError(400, 'empty', 'Write the note'); return null; }
    if (String(t).length > NOTE_MAX && source === 'owner') throw new WorkError(400, 'too_long', `A note may be at most ${NOTE_MAX} characters`);
    if (this.q.note.get(this.w, Number(agentId), s)) return null;
    const r = this.q.addNote.run(this.w, Number(agentId), s, source === 'owner' ? 'owner' : 'agent', this.now());
    const n = this.q.countNotes.get(this.w, Number(agentId)).n;
    if (n > NOTES_MAX) this.q.trimNotes.run(this.w, Number(agentId), n - NOTES_MAX);
    return { id: Number(r.lastInsertRowid), text: s, source: source === 'owner' ? 'owner' : 'agent' };
  }
  removeNote(agentId, id) {
    const r = this.q.delNote.run(this.w, Number(agentId), Number(id));
    if (!r.changes) throw new WorkError(404, 'not_found', 'No such note');
    return true;
  }

  // ---------------------------------------------------------------- knowledge files
  view(f) { return { id: f.id, name: f.name, mime: f.mime, size: f.size, kind: f.kind, chars: f.text ? f.text.length : 0, created: f.created }; }
  files(agentId) { return this.q.files.all(this.w, Number(agentId)).map(f => this.view(f)); }
  fileChars(agentId) { return this.q.files.all(this.w, Number(agentId)).reduce((n, f) => n + (f.text ? f.text.length : 0), 0); }
  /** What it knows takes, against its limits. */
  budget(agentId) {
    const all = this.q.files.all(this.w, Number(agentId)), b = this.brief(agentId);
    return { chars: b.knowledge.length + all.reduce((n, f) => n + (f.text ? f.text.length : 0), 0), maxChars: KNOW_CHARS,
      pdf: all.filter(f => f.kind === 'pdf').reduce((n, f) => n + f.size, 0), maxPdf: PDF_MAX, files: all.length, maxFiles: FILES_MAX };
  }
  /** Adds a copy of a file (src: { path, name }) to what it knows. A document's text is read now; one that cannot be
   *  read, or that does not fit, is refused with the reason. The same file twice is the one already there. */
  addFile(agentId, src) {
    const name = safeName(src?.name);
    if (!name || !src?.path) throw new WorkError(400, 'bad_file', 'Which file?');
    const k = kindOf(name);
    if (!k.kind) throw new WorkError(415, 'unreadable', k.why);
    if (k.kind === 'image') throw new WorkError(415, 'unreadable', 'Images can\'t be part of what it knows: write down what is in it, or add a PDF or a document');
    let buf;
    try { buf = fs.readFileSync(src.path); } catch { throw new WorkError(404, 'not_found', 'That file is no longer stored'); }
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const have = this.q.fileBySha.get(this.w, Number(agentId), sha);
    if (have) return { file: this.view(this.q.file.get(this.w, Number(agentId), have.id)), duplicate: true };
    const b = this.budget(agentId);
    if (b.files >= FILES_MAX) throw new WorkError(400, 'too_many_files', `It may know at most ${FILES_MAX} files; remove one first`);
    let body = null;
    if (k.kind === 'text') {
      let x;
      try { x = extractText(src.path, name); } catch (e) { throw new WorkError(415, 'unreadable', `${name}: ${e.message}`); }
      body = x.text.trim();
      if (!body) throw new WorkError(415, 'unreadable', `${name} has no text in it`);
      if (x.truncated || b.chars + body.length > KNOW_CHARS) {
        throw new WorkError(400, 'knowledge_full', `${name} has ${x.truncated ? 'more than ' : ''}${body.length.toLocaleString('en-US')} characters of text; what it knows may be at most ${KNOW_CHARS.toLocaleString('en-US')} in all (${Math.max(0, KNOW_CHARS - b.chars).toLocaleString('en-US')} left). Remove something, or add a shorter file.`);
      }
    } else if (b.pdf + buf.length > PDF_MAX) {
      throw new WorkError(400, 'knowledge_full', `The PDFs it knows may be at most ${Math.round(PDF_MAX / 1048576)} MB in all (${Math.max(0, (PDF_MAX - b.pdf) / 1048576).toFixed(1)} MB left)`);
    }
    const dir = path.join(this.root, String(Number(agentId)));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const dest = path.join(dir, sha);
    if (!fs.existsSync(dest)) {
      const tmp = `${dest}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, buf, { mode: 0o600 });
      fs.renameSync(tmp, dest);
    }
    const mime = typeof src.mime === 'string' && src.mime ? src.mime.slice(0, 120) : 'application/octet-stream';
    const r = this.q.addFile.run(this.w, Number(agentId), sha, name, mime, buf.length, k.kind, body, this.now());
    return { file: this.view(this.q.file.get(this.w, Number(agentId), Number(r.lastInsertRowid))), duplicate: false };
  }
  /** Where one of its files is kept (to open it), or null. */
  fileOf(agentId, id) {
    const f = this.q.file.get(this.w, Number(agentId), Number(id));
    return f ? { ...this.view(f), path: path.join(this.root, String(Number(agentId)), f.sha256) } : null;
  }
  removeFile(agentId, id) {
    const f = this.q.file.get(this.w, Number(agentId), Number(id));
    if (!f) throw new WorkError(404, 'not_found', 'No such file');
    this.q.delFile.run(this.w, Number(agentId), f.id);
    if (!this.q.fileBySha.get(this.w, Number(agentId), f.sha256)) {
      try { fs.rmSync(path.join(this.root, String(Number(agentId)), f.sha256), { force: true }); } catch { /* already gone */ }
    }
    return true;
  }

  // ---------------------------------------------------------------- for a work chat
  /** Everything a work answer needs: the brief, the newest notes, the documents' text and the PDFs to send. */
  forRun(agentId) {
    const id = Number(agentId), all = this.q.files.all(this.w, id);
    return {
      brief: this.brief(id),
      notes: this.q.notes.all(this.w, id, NOTES_SENT).map(r => r.text),
      docs: all.filter(f => f.kind === 'text' && f.text).map(f => ({ name: f.name, text: f.text })),
      pdfs: all.filter(f => f.kind === 'pdf').map(f => ({ name: f.name, mime: f.mime, size: f.size, path: path.join(this.root, String(id), f.sha256) })),
    };
  }
  /** What a visitor's work chat goes with (CHAT.md §14.3): its brief and its documents' text — never its work notes
   *  (from its owner's chats) nor its PDFs (sent as they are, at a stranger's every message). */
  forVisitor(agentId) {
    const id = Number(agentId);
    return { brief: this.brief(id), docs: this.q.files.all(this.w, id).filter(f => f.kind === 'text' && f.text).map(f => ({ name: f.name, text: f.text })) };
  }
  /** All of it, for the Studio. */
  all(agentId) { return { brief: this.brief(agentId), notes: this.notes(agentId), files: this.files(agentId), budget: this.budget(agentId) }; }
}
