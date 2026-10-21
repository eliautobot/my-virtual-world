// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What an agent's PC screen shows (docs/features/agent-pc.md §2.1): after each command it runs, the window it would have
// open - the file it read or wrote with the lines it changed, the folder, its search, a task board with the task it
// touched, its calendar's week, the web page it reads - or its terminal. Kept small (about 4 KB: a window of lines, a
// few dozen rows), built only for an agent's own commands, and sent to its owner's account alone with its screen
// (os.screen). Every builder reads through the engine as the agent itself, so a view never holds more than it may see.
import { COLUMNS } from './os.js';

export const VIEW_LINES = 40;      // lines of a file in its window
const LINE_MAX = 180, ROWS = 40, BYTES_MAX = 6000;
const clipLine = s => (s.length > LINE_MAX ? `${s.slice(0, LINE_MAX - 1)}…` : s);
const IMAGE = /^image\/(png|jpeg|gif|webp|avif)$/;

/** A window of a text: `around` (0-based line) near the top, or the lines `hl` (0-based, inclusive) in view. */
function windowOf(text, { first = 0, hl = null } = {}) {
  const all = String(text ?? '').split('\n');
  let start = first;
  if (hl) start = Math.max(0, Math.min(hl[0] - 3, hl[1] - VIEW_LINES + 4));
  start = Math.max(0, Math.min(start, Math.max(0, all.length - VIEW_LINES)));
  return { total: all.length, first: start + 1, lines: all.slice(start, start + VIEW_LINES).map(clipLine),
    ...(hl ? { hl: [hl[0] + 1, hl[1] + 1] } : {}) };
}
/** The 0-based lines `part` takes in `text`, when it is there (the last place it is: what was just written). */
function linesOf(text, part) {
  if (!part) return null;
  const at = text.lastIndexOf(part);
  if (at < 0) return null;
  // (the blank lines it starts or ends with are spacing, not words written)
  const lead = /^\n*/.exec(part)[0].length, body = part.slice(lead).replace(/\n+$/, '');
  const a = text.slice(0, at + lead).split('\n').length - 1;
  return [a, a + Math.max(0, body.split('\n').length - 1)];
}

/**
 * A file in its window. mode: read (from `line`, 1-based), write (all of it new), append (`part` added at the end),
 * edit (`part` the new words), open (its start).
 */
export function fileView(sh, path, mode = 'open', { line = 1, part = null } = {}) {
  const st = sh.os.stat(sh.who, path, sh.opt());
  // (who changed it last, by name - its screen is seen by its owner, not by the agent: never "you")
  const base = { path: st.path, name: st.name, version: st.version, size: st.size, mode, by: st.by === sh.c.tag ? null : sh.namesFn(st.by) };
  if (IMAGE.test(st.mime || '')) return { kind: 'image', ...base, mime: st.mime };
  let f;
  try { f = sh.os.readText(sh.who, st.path, sh.opt()); } catch { return { kind: 'file', ...base, binary: true, mime: st.mime }; }
  const text = f.text || '';
  const hl = mode === 'write' ? [0, Math.min(text.split('\n').length, VIEW_LINES) - 1]
    : mode === 'append' || mode === 'edit' ? linesOf(text, part) : null;
  return { kind: 'file', ...base, doc: f.kind === 'doc', ...windowOf(text, { first: mode === 'read' ? Math.max(0, line - 1) : 0, hl }) };
}
/** A folder, with the entry just made, moved or put back marked. */
export function folderView(sh, path, mark = null) {
  const r = sh.os.list(sh.who, path, sh.opt({ limit: ROWS }));
  if (r.file) return fileView(sh, r.path);
  return { kind: 'folder', path: r.path, total: r.total, readOnly: r.access === 'r',
    entries: r.entries.map(e => ({ name: e.name, dir: !!e.dir, size: e.dir ? null : e.size, team: !!e.team })), ...(mark ? { mark } : {}) };
}
/** The folder something is in, with it marked. */
export function parentView(sh, path) {
  const p = String(path).replace(/\/+$/, ''), cut = p.lastIndexOf('/');
  return folderView(sh, cut > 0 ? p.slice(0, cut) : cut === 0 ? '/' : '~', p.slice(cut + 1));
}
export function findView(query, results) {
  return { kind: 'find', query: String(query).slice(0, 100), results: results.slice(0, 14).map(x => ({ path: x.path, dir: !!x.dir, snippet: x.snippet ? clipLine(x.snippet) : '' })) };
}
/** A task board, with the task just added or changed marked. */
export function boardView(sh, where = '~', mark = null) {
  const b = sh.os.board(sh.who, where, sh.opt());
  const cards = COLUMNS.flatMap(col => { const ks = b.cards.filter(k => k.col === col); return col === 'done' ? ks.slice(-6) : ks.slice(0, 12); });
  return { kind: 'board', board: b.board, cards: cards.map(k => ({ id: k.id, title: clipLine(k.title), col: k.col, who: k.assignee ? sh.namesFn(`a:${k.assignee}`) : null, due: k.due || null,
    working: k.work?.state === 'working' })), ...(mark ? { mark } : {}) };
}
/** A week of its calendars (from `from`'s day), with the event just added or moved marked. */
export function calView(sh, from, mark = null) {
  const r = sh.os.events(sh.who, from, from + 7 * 86400000, sh.opt());
  return { kind: 'calendar', from, tz: sh.tz, events: r.events.slice(0, ROWS).map(e => ({ id: e.id, title: clipLine(e.title), start: e.start, end: e.end, allDay: e.allDay, team: e.calendar !== '~' })),
    ...(mark ? { mark } : {}) };
}
/** A web page as its browser shows it: its address, its title, the part being read (server/pc/browser.js). */
export function pageView(p, chunk) {
  return { kind: 'page', url: String(p.url || '').slice(0, 500), title: String(p.title || '').slice(0, 200), live: !!p.live, part: p.part || 1,
    ...(p.shotAt ? { shot: p.shotAt } : {}),   // (a browser service's screen: its picture, GET /api/pc/browser/shot)
    ...windowOf(chunk, {}) };
}
export function webView(query, results) {
  return { kind: 'web', query: String(query).slice(0, 100), results: results.slice(0, 10).map(x => ({ title: clipLine(x.title || ''), href: String(x.href || '').slice(0, 300), text: clipLine(x.text || '') })) };
}
/** A picture's width and height from its first bytes (PNG, JPEG, GIF, WebP), or null. */
export function pictureSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.toString('ascii', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const k = buf.toString('ascii', 12, 16);
    if (k === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (k === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (k === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    // (a JPEG: its frame header, past the segments before it)
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}
/** A view as sent: never more than BYTES_MAX (a file's window shortened first, then any list). */
export function capView(v) {
  if (!v) return null;
  let s = JSON.stringify(v);
  for (const k of ['lines', 'entries', 'cards', 'events', 'results']) {
    while (s.length > BYTES_MAX && Array.isArray(v[k]) && v[k].length > 4) { v[k] = v[k].slice(0, Math.ceil(v[k].length * 0.7)); s = JSON.stringify(v); }
  }
  if (s.length <= BYTES_MAX) return v;
  // (still too big: what it is, without its contents - and where it is: on the agent's own computer, its provider's browser)
  const o = { kind: v.kind, path: v.path, title: v.title, url: v.url };
  for (const k of ['remote', 'provider', 'app', 'name', 'mode', 'heading', 'query']) if (v[k] !== undefined) o[k] = typeof v[k] === 'string' ? v[k].slice(0, 200) : v[k];
  return o;
}
