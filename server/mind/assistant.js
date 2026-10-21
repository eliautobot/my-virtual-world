// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat window with its owner (docs/features/CHAT.md §2): the pieces of an agent's answer as a capable assistant
// that also lives in the city — server/mind/mind.js assistantRun() runs them.
// - The answer is plain text (Markdown) and is streamed as it is written. A model that wants the city's tools first
//   answers with nothing but {"use":[…]} (server/mind/tools.js): StreamSplit holds the first characters back until it can
//   tell which of the two it is, so a tool request is never shown as an answer.
// - What the agent keeps from the chat — plans its owner asked for, memories, the chat's title — comes after a marker
//   line at the very end (ACTIONS_MARK + one JSON object); StreamSplit never shows it, even split across pieces.
// - The conversation sent is bounded (CONTEXT_CHARS, newest first); attachments: images and PDFs go to the model as
//   they are, for the newest message that has them (and the one before); documents and text files as text
//   (server/chat/extract.js), for the last few messages, within DOCS_CHARS.
import fs from 'node:fs';
import { extractText, kindOf } from '../chat/extract.js';

export const ACTIONS_MARK = '[[mvw-actions]]';
export const CONTEXT_CHARS = 120000;      // the conversation sent (≈ 30,000 tokens), newest first
export const DOCS_CHARS = 200000;         // the text of attached documents in it
const MEDIA_BYTES = 20 * 1048576;         // images and PDFs sent with one call
const MEDIA_MESSAGES = 2;                 // … from the newest messages that have them
const DOC_MESSAGES = 8;                   // documents' text from this many of the newest messages with files
const TOOL_LOOK = 16;                     // characters looked at before an answer is known not to be a tool request
const TOOL_START = /^\{\s*"use"\s*:/;

/** Splits one streamed model answer into what is shown (the answer) and what is not (a tool request; the actions). */
export class StreamSplit {
  constructor(onText) { this.onText = onText; this.buf = ''; this.mode = 'start'; this.shown = 0; this.all = ''; }
  feed(piece) {
    if (!piece) return;
    this.all += piece;
    if (this.mode === 'tool' || this.mode === 'actions') return;
    this.buf += piece;
    if (this.mode === 'start' && !this.decide(false)) return;
    if (this.mode === 'text') this.flush(false);
  }
  /** Whether the answer's start shows yet what it is (at the end it must). */
  decide(end) {
    const lead = this.buf.replace(/^\s+/, '');
    if (!lead) { if (end) this.mode = 'text'; return end; }
    if (TOOL_START.test(lead)) { this.mode = 'tool'; return true; }
    const squeezed = lead.replace(/\s+/g, '');
    if (!end && lead.length < TOOL_LOOK && '{"use":'.startsWith(squeezed.slice(0, 7))) return false;   // could still be one
    this.mode = 'text'; this.buf = lead;
    return true;
  }
  /** Shows what is certainly answer: everything but a tail that could be the start of the marker. */
  flush(end) {
    const i = this.buf.indexOf(ACTIONS_MARK);
    if (i >= 0) { this.emit(this.buf.slice(0, i).replace(/\s+$/, '')); this.buf = ''; this.mode = 'actions'; return; }
    let keep = 0;
    if (!end) for (let k = Math.min(ACTIONS_MARK.length - 1, this.buf.length); k > 0; k--) if (ACTIONS_MARK.startsWith(this.buf.slice(-k))) { keep = k; break; }
    this.emit(this.buf.slice(0, this.buf.length - keep));
    this.buf = this.buf.slice(this.buf.length - keep);
  }
  emit(t) { if (t) { this.shown += t.length; this.onText(t); } }
  /** The end of the answer (full: the whole text, as the provider returned it): { tool } or { reply, actions }. cut: it
   *  ended before its time (stopped, or the stream broke) — a start of the marker at its end is not part of the answer. */
  end(full = this.all, { cut = false } = {}) {
    if (this.mode === 'start') this.decide(true);
    if (this.mode === 'text') { this.flush(!cut); if (cut) this.buf = ''; }
    let text = String(full || '');
    if (this.mode === 'tool') return { tool: text.trim() };
    if (cut && !text.includes(ACTIONS_MARK)) text = text.slice(0, text.length - markTail(text));
    const i = text.indexOf(ACTIONS_MARK);
    return i >= 0 ? { reply: text.slice(0, i).trim(), actions: text.slice(i + ACTIONS_MARK.length).trim() } : { reply: text.trim(), actions: null };
  }
}

/** How many characters at the end of `text` could be the start of the marker (0: none). */
function markTail(text) {
  for (let k = Math.min(ACTIONS_MARK.length - 1, text.length); k > 0; k--) if (ACTIONS_MARK.startsWith(text.slice(-k))) return k;
  return 0;
}

/** The JSON object after the marker (lenient: a code fence or words around it are tolerated), or null. */
export function parseActions(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { const o = JSON.parse(s.slice(a, b + 1)); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
}

/** A cache of documents' text by attachment id (an attachment never changes: it is stored by its content's hash). */
const textCache = new Map();
function docText(f) {
  const key = `${f.id}`;
  if (textCache.has(key)) return textCache.get(key);
  let v;
  try { v = extractText(f.path, f.name); } catch (e) { v = { error: e.message || 'This file could not be read.' }; }
  textCache.set(key, v);
  if (textCache.size > 300) textCache.delete(textCache.keys().next().value);
  return v;
}

/**
 * The turns of one call: the conversation (oldest first, ending with the newest message), each user turn with its
 * attachments — images and PDFs as parts, documents as text. history: [{ id, role, text, files: [{ id, name, mime,
 * size, path }] }] (the newest is the message being answered). Throws { code: 'unreadable', message } when the newest
 * message's own file cannot be read at all.
 */
export function buildTurns(history, { mediaMax = MEDIA_BYTES } = {}) {
  const msgs = history.filter(m => m && (m.role === 'user' || m.role === 'assistant'));
  const withFiles = msgs.filter(m => m.role === 'user' && m.files && m.files.length).map(m => m.id);
  const mediaFor = new Set(withFiles.slice(-MEDIA_MESSAGES)), docsFor = new Set(withFiles.slice(-DOC_MESSAGES));
  const newest = msgs.length ? msgs[msgs.length - 1].id : null;
  let mediaBytes = 0, docChars = 0, chars = 0;
  const out = [];
  for (let k = msgs.length - 1; k >= 0; k--) {
    const m = msgs[k];
    let text = m.text || '';
    const parts = [], notes = [];
    if (m.role === 'user') for (const f of m.files || []) {
      const how = kindOf(f.name).kind;
      if ((how === 'image' || how === 'pdf') && mediaFor.has(m.id)) {
        if (mediaBytes + f.size > mediaMax) { notes.push(`[${f.name}: attached, but too large to send again]`); continue; }
        let data;
        try { data = fs.readFileSync(f.path).toString('base64'); } catch { notes.push(`[${f.name}: no longer stored]`); continue; }
        mediaBytes += f.size;
        parts.push({ type: how, mime: f.mime, name: f.name, data });
      } else if (how === 'text' && docsFor.has(m.id)) {
        const d = docText(f);
        if (d.error) { if (m.id === newest && !text && (m.files || []).length === 1) throw Object.assign(new Error(`${f.name}: ${d.error}`), { code: 'unreadable' }); notes.push(`[${f.name}: ${d.error}]`); continue; }
        if (docChars + d.text.length > DOCS_CHARS) { notes.push(`[${f.name}: attached earlier; too long to include again]`); continue; }
        docChars += d.text.length;
        notes.push(`ATTACHED FILE «${f.name}»${d.truncated ? ' (only the first part: it is very long)' : ''}:\n\`\`\`\n${d.text}\n\`\`\``);
      } else if (!how) {
        const why = kindOf(f.name).why;
        if (m.id === newest && !text && (m.files || []).length === 1) throw Object.assign(new Error(`${f.name}: ${why}`), { code: 'unreadable' });
        notes.push(`[${f.name}: ${why}]`);
      } else notes.push(`[${f.name}: attached earlier]`);
    }
    if (notes.length) text = `${notes.join('\n\n')}${text ? `\n\n${text}` : ''}`;
    if (!text && !parts.length) continue;
    chars += text.length;
    if (chars > CONTEXT_CHARS && out.length) break;   // (the newest message always goes)
    out.unshift({ role: m.role, text: text || (parts.length ? 'See the attached file.' : ''), ...(parts.length ? { parts } : {}) });
  }
  // a conversation starts with the person (a cut that left an answer first drops it)
  while (out.length && out[0].role !== 'user') out.shift();
  return { turns: out, mediaBytes, docChars };
}

/** The providers that read PDFs (server/providers/models.js contentOf: the others refuse a call that has one). */
export const PDF_PROVIDERS = new Set(['openai', 'openrouter', 'anthropic']);

/** Room left for a chat's own images and PDFs once `reserved` bytes of the agent's own files go with every message. */
export const mediaRoom = reserved => Math.max(0, MEDIA_BYTES - Math.max(0, reserved || 0));

/**
 * The PDFs an agent knows for its job (docs/features/CHAT.md §13), sent with the first message of the conversation as it
 * goes to the model (the same place every time, so a provider's prompt cache keeps them). One no longer stored is said to
 * be missing. Returns the bytes sent.
 */
export function withPdfs(turns, pdfs = []) {
  const first = turns.find(t => t.role === 'user');
  if (!first || !pdfs.length) return 0;
  const parts = [], notes = [];
  let bytes = 0;
  for (const f of pdfs) {
    let data;
    try { data = fs.readFileSync(f.path).toString('base64'); } catch { notes.push(`[${f.name}: one of your job's files, no longer stored]`); continue; }
    bytes += f.size;
    parts.push({ type: 'pdf', mime: f.mime || 'application/pdf', name: f.name, data });
  }
  if (parts.length) first.parts = [...parts, ...(first.parts || [])];
  if (notes.length) first.text = `${notes.join('\n')}\n\n${first.text || ''}`;
  return bytes;
}
