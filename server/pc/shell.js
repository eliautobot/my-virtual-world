// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The PC's command line (docs/features/agent-pc.md §4): how agents work their PC. Made for small models — the words
// every model knows (ls, read, write, mkdir, mv, cp, rm), a few for the apps (task, cal, team, and the browser's open,
// search), forgiving input (quotes or none, a mistyped path answered with the nearest real one, times as people write
// them), several commands in one go (one per line; a command's text after <<EOF … EOF), short answers in plain words,
// long ones in pages with the command for the next page. Every command goes through the engine (./os.js), which decides
// what the agent may reach; the shell only reads commands and words the answers.
//
// A command's text can also come beside it (the brain's JSON: {"tool":"pc","run":"write ~/a.md","text":"…"}, or MCP's
// `text`), and edit's two passages as `find` and `replace`.
import { PcError, COLUMNS, COLUMN_NAMES, mbText } from './os.js';
import { parseWhen, parseLength, showWhen, dayStart, lengthText } from './when.js';
import { fileView, folderView, parentView, findView, boardView, calView, pictureSize } from './views.js';

const READ_LINES = 200, READ_CHARS = 12000, OUT_MAX = 12000, LIST_MAX = 200;
const MOVE = { todo: 'todo', 'to-do': 'todo', start: 'doing', doing: 'doing', started: 'doing', review: 'review', done: 'done', finish: 'done', finished: 'done', complete: 'done' };

/** Splits a command line into words: "double" and 'single' quotes keep spaces; \ escapes inside double quotes. */
export function words(s) {
  const out = [];
  let cur = null, q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q) { q = null; continue; }
      if (q === '"' && ch === '\\' && i + 1 < s.length && '"\\'.includes(s[i + 1])) { cur += s[++i]; continue; }
      cur += ch; continue;
    }
    if (ch === '"' || ch === '\'' || ch === '“' || ch === '”') { q = ch === '“' ? '”' : ch === '”' ? '”' : ch; cur ??= ''; continue; }
    if (/\s/.test(ch)) { if (cur !== null) { out.push(cur); cur = null; } continue; }
    cur = (cur ?? '') + ch;
  }
  if (cur !== null) out.push(cur);
  return out;
}
/** Words → { args, flags } (--name value, --name=value, -f). A flag in `phrases` takes every word up to the next flag:
 *  models write `--due tomorrow 9am` or `--to Mrs Lee` without quotes. */
function parseArgs(ws, takesValue = [], phrases = []) {
  const args = [], flags = {};
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    let m;
    if ((m = /^--([a-z][a-z-]*)=(.*)$/.exec(w))) flags[m[1]] = m[2];
    else if ((m = /^--([a-z][a-z-]*)$/.exec(w))) {
      if (phrases.includes(m[1]) && i + 1 < ws.length && !/^--/.test(ws[i + 1])) {
        const v = [];
        while (i + 1 < ws.length && !/^--[a-z]/.test(ws[i + 1])) v.push(ws[++i]);
        flags[m[1]] = v.join(' ');
      } else if (takesValue.includes(m[1]) && i + 1 < ws.length) flags[m[1]] = ws[++i];
      else flags[m[1]] = true;
    } else if (/^-[a-z]$/.test(w)) flags[w.slice(1)] = true;
    else args.push(w);
  }
  return { args, flags };
}
/** One request into commands: one per line, a line ending in <<WORD takes the lines up to WORD as its text. */
export function commandsOf(input) {
  const lines = String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#')) continue;
    const m = /^(.*?)\s*<<\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2\s*$/.exec(raw);
    if (m) {
      const body = [];
      let j = i + 1;
      for (; j < lines.length && lines[j].trim() !== m[3]; j++) body.push(lines[j]);
      out.push({ line: m[1].trim(), text: body.join('\n') });
      i = j;
    } else out.push({ line: raw.replace(/^\$\s+/, '') });
  }
  return out;
}

const COMMANDS = [];
const cmd = (names, group, usage, about, run, o = {}) => COMMANDS.push({ names: [].concat(names), group, usage, about, run, ...o });

export class PcShell {
  /**
   * os: PcOS. who: { agent } | { visitor } | { human, profile }. tz: the work time zone (IANA). people: account → the
   * agents of that account [{ id, name, role }]. names(tag, me): how an author shows ('you', 'Mo', 'your owner').
   * browser: the PC's browser (./browser.js) or null. say(app, title, detail): what the agent's screen shows.
   */
  constructor(os, { who, tz = 'UTC', names = t => t, browser = null, now = () => Date.now() } = {}) {
    this.os = os; this.who = who; this.tz = tz; this.namesFn = names; this.browser = browser; this.now = now;
    this.c = os.caller(who);
    this.profile = this.c.kind === 'human' ? Number(who.profile) : this.c.agent;
    this.cwd = '~';
    this.seen = new Map();   // path → the version it read (a save on top of someone else's change is refused)
    this.page = null;        // the browser's current page
    this.show = null;        // () => the window the last command left open (./views.js): what its screen shows
  }
  opt(extra = {}) { return { cwd: this.cwd, profile: this.profile, ...extra }; }
  by(tag) { return this.namesFn(tag, this.c.tag); }
  when(t, allDay = false) { return showWhen(t, this.tz, { allDay, now: this.now() }); }
  agentNamed(name) {
    const n = String(name ?? '').trim().toLowerCase().replace(/^@/, '');
    if (!n) return null;
    if (n === 'me' || n === 'myself') return this.c.agent ?? null;
    if (['nobody', 'none', 'no one', 'noone'].includes(n)) return 'none';
    const list = this.os.agentsOf(this.c.account);
    const hit = list.find(a => a.name.toLowerCase() === n) || (list.filter(a => a.name.toLowerCase().startsWith(n)).length === 1 ? list.find(a => a.name.toLowerCase().startsWith(n)) : null);
    if (!hit) throw new PcError(404, 'no_agent', `There is no agent called "${name}" here. ${list.length ? `Agents: ${list.slice(0, 20).map(a => a.name).join(', ')}` : ''}`);
    return hit.id;
  }
  boardName(view) { return view === '~' ? 'your board' : `the ${view.replace('/teams/', '')} team's board`; }

  /** Runs a request (one command or several): { text, results: [{ line, ok, out }] }. extra: { text, find, replace }. */
  async run(input, extra = {}) {
    const list = commandsOf(input);
    if (!list.length) return { text: 'error: no command given. Try: help', results: [] };
    if (list.length > 12) return { text: 'error: at most 12 commands at a time', results: [] };
    const results = [];
    // (text beside the request goes to its command that takes text — the last such one — else to its last command)
    const takes = list.map(x => TEXT_TAKERS.has((words(x.line)[0] || '').toLowerCase()) && x.text === undefined);
    const target = takes.lastIndexOf(true) >= 0 ? takes.lastIndexOf(true) : list.length - 1;
    for (let k = 0; k < list.length; k++) {
      const one = list[k];
      const ex = { ...(one.text !== undefined ? { text: one.text } : {}), ...(k === target ? pick(extra) : {}) };
      results.push(await this.one(one.line, ex));
    }
    const text = results.length === 1 ? results[0].out : results.map(r => `$ ${r.line}\n${r.out}`).join('\n\n');
    return { text: clip(text, OUT_MAX * 2), results };
  }
  async one(line, ex) {
    const ws = words(line);
    if (!ws.length) return { line, ok: false, out: 'error: empty command' };
    const name = ws[0].toLowerCase();
    const c = COMMANDS.find(x => x.names.includes(name));
    if (!c) {
      const near = COMMANDS.flatMap(x => x.names).filter(n => n[0] === name[0]).slice(0, 4);
      return { line, ok: false, out: `error: "${ws[0]}" isn't a PC command.${near.length ? ` Did you mean ${near.join(', ')}?` : ''} See: help` };
    }
    if (this.c.kind === 'visitor' && !c.visitor) return { line, ok: false, out: 'error: while you talk with a visitor only your Public folder can be read (ls, read, find, info)' };
    if ((typeof c.browser === 'function' ? c.browser(ws.slice(1)) : c.browser) && !this.browser) return { line, ok: false, out: 'error: this PC has no browser' };
    this.show = null;
    try {
      const out = await c.run(this, ws.slice(1), ex, name);
      this.onScreen(c, line, String(out ?? ''));
      return { line, ok: true, out: clip(String(out ?? 'ok'), OUT_MAX) };
    } catch (e) {
      if (e instanceof PcError || e?.pcUser) { this.show = null; this.onScreen(c, line, `error: ${e.message}`); return { line, ok: false, out: `error: ${e.message}` }; }
      throw e;
    }
  }
  /** What its screen shows after a command (an agent's own commands only; seen only by its owner — os.screen()): the
   *  window the command left open, else its terminal; the command and the start of what it said go to its terminal. */
  onScreen(c, line, out) {
    if (this.c.kind !== 'agent') return;
    let view;
    try { view = this.show ? this.show() : undefined; } catch { view = undefined; }   // (a window that can't be shown: the terminal)
    this.show = null;
    this.os.screen(this.c.agent, c.group, line, out.split('\n')[0], { view, log: [`$ ${line}`, ...out.split('\n').slice(0, 3)] });
  }
  /** The short menu for a prompt (the commands this caller has). */
  static menu({ browser = false, visitor = false } = {}) {
    if (visitor) return 'PC (only your Public folder, to read): ls ~/Public · read <file> · find <words>';
    const g = (k, list) => `${k}: ${list}`;
    return [
      'PC COMMANDS — your own computer. ~ is your home folder, /teams/<team> a team\'s shared folder. Several commands may go in one request, one per line.',
      g('files', 'ls [folder] · read <file> [from-line] · write <file> (+text) · append <file> (+text) · edit <file> (+find, +replace) · mkdir <folder> · mv <from> <to> · cp <from> <to> · rm <path> · find <words> · info <file> · trash · restore <id>'),
      g('tasks', 'tasks [board] · task <id> · task add "<title>" [--to <agent>] [--due <when>] [--on <board>] (+text = notes) · task <id> doing|review|done · task <id> note "<words>" · task <id> to <agent>'),
      g('calendar', 'cal [today|tomorrow|week|<date>] · cal add "<title>" <when> [--for 30m] [--on <board>] [--at <place>] · cal move <id> <when> · cal rm <id>'),
      ...(browser ? [g('browser', 'search <words> · open <url or link number> · more · links · save <file> · back · history · click f<n> · type f<n> "<words>" · press Enter (the last three in a browser service)')] : []),
      g('other', 'team · whoami · skills · help <command>'),
      'Boards and calendars: ~ (yours) or /teams/<team>. Times like "tomorrow 9am", "fri 5pm", "2026-10-20 14:00", "in 2 hours".',
    ].join('\n');
  }
}
const TEXT_TAKERS = new Set(['write', 'save-file', 'append', 'edit', 'replace', 'task', 'cal', 'calendar', 'type']);
const pick = e => Object.fromEntries(['text', 'find', 'replace'].filter(k => typeof e?.[k] === 'string').map(k => [k, e[k]]));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n… (cut: the answer was too long)` : s);
const plural = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
function need(cond, msg) { if (!cond) throw new PcError(400, 'usage', msg); }
const textOf = (ex, rest, what) => {
  if (typeof ex.text === 'string') return ex.text;
  if (rest.length) return rest.join(' ');
  throw new PcError(400, 'usage', `${what} needs the text: give it as "text" beside the command, or after <<EOF on the lines below (ending with EOF)`);
};

// --------------------------------------------------------------------------------------------- files
cmd(['ls', 'dir', 'list'], 'files', 'ls [folder]', 'list a folder (default: the one you are in)', (sh, a) => {
  const { args, flags } = parseArgs(a);
  const r = sh.os.list(sh.who, args[0] || sh.cwd, sh.opt({ limit: LIST_MAX, offset: Math.max(0, Number(flags.from) || 0) }));
  sh.show = () => folderView(sh, r.path);
  if (r.file) return `${r.path} is a file (${mbText(r.file.size)}). Read it: read ${r.path}`;
  if (!r.entries.length) return `${r.path} is empty`;
  const lines = r.entries.map(e => e.dir ? `${e.name}/${e.title ? `  (${e.title}${e.role ? `, you are ${e.role}` : ''})` : ''}`
    : `${e.name}  ${mbText(e.size)}  ${sh.when(e.modified)}${e.by && e.by !== sh.c.tag ? `  by ${sh.by(e.by)}` : ''}`);
  return `${r.path}${r.access === 'r' ? ' (read only)' : ''} — ${plural(r.total, 'item')}\n${lines.join('\n')}${r.more ? `\n… more: ls ${r.path} --from ${(Number(flags.from) || 0) + r.entries.length}` : ''}`;
}, { visitor: true });
cmd('cd', 'files', 'cd <folder>', 'go into a folder (relative paths start there)', (sh, a) => {
  const p = a[0] || '~';
  const st = sh.os.stat(sh.who, p, sh.opt());
  if (!st.dir) throw new PcError(400, 'not_folder', `${st.path} is a file`);
  sh.cwd = st.path;
  sh.show = () => folderView(sh, st.path);
  return `now in ${st.path}`;
});
cmd('pwd', 'files', 'pwd', 'the folder you are in', sh => sh.cwd);
cmd('tree', 'files', 'tree [folder]', 'folders and files below, 3 levels', (sh, a) => {
  const start = a[0] || sh.cwd, out = [];
  const walk = (p, depth) => {
    if (out.length > 150) return;
    const r = sh.os.list(sh.who, p, sh.opt({ limit: 60 }));
    for (const e of r.entries) {
      out.push(`${'  '.repeat(depth)}${e.name}${e.dir ? '/' : `  ${mbText(e.size)}`}`);
      if (e.dir && depth < 2 && r.path !== '/') walk(e.path, depth + 1);
    }
    if (r.more) out.push(`${'  '.repeat(depth)}…`);
  };
  walk(start, 0);
  sh.show = () => folderView(sh, start);
  return out.length ? out.join('\n') : `${start} is empty`;
});
cmd(['read', 'cat', 'view', 'show'], 'files', 'read <file> [from-line] [lines]', 'show a text file or a document\'s words (in pages) — or a picture, on your screen', (sh, a) => {
  const { args } = parseArgs(a);
  need(args[0], 'usage: read <file> [from-line]');
  // (a picture is opened on its screen — the agent is told what it is; anything else not text says what it is)
  const st = sh.os.stat(sh.who, args[0], sh.opt());
  if (st.dir) throw new PcError(400, 'is_folder', `${st.path} is a folder: ls ${st.path}`);
  if (/^image\/(png|jpeg|gif|webp|avif)$/.test(st.mime || '')) {
    const px = pictureSize(sh.os.readFile(sh.who, st.path, sh.opt()).buf);
    sh.show = () => fileView(sh, st.path);
    return `${st.path} — a picture (${(st.mime || '').replace('image/', '').toUpperCase()}${px ? `, ${px.w}×${px.h}` : ''}, ${mbText(st.size)}), open on your screen. Its pixels can't be read as words here: say what it is for from its name and where it came from.`;
  }
  const f = sh.os.readText(sh.who, args[0], sh.opt());
  sh.seen.set(f.path, f.info.version);
  const all = f.text.split('\n');
  const from = Math.max(1, Math.floor(Number(args[1]) || 1));
  sh.show = () => fileView(sh, f.path, 'read', { line: from });
  const want = Math.max(1, Math.min(1000, Math.floor(Number(args[2]) || READ_LINES)));
  let out = [], chars = 0, i = from - 1;
  for (; i < all.length && out.length < want; i++) { if (chars + all[i].length > READ_CHARS && out.length) break; out.push(all[i]); chars += all[i].length + 1; }
  const head = `${f.path} — ${f.kind === 'doc' ? 'a document\'s words, ' : ''}${plural(all.length, 'line')}, ${mbText(f.info.size)}, version ${f.info.version}, changed ${sh.when(f.info.modified)}${f.info.by !== sh.c.tag ? ` by ${sh.by(f.info.by)}` : ''}`;
  if (!f.text) return `${head}\n(empty)`;
  const range = from > 1 || i < all.length ? ` (lines ${from}–${i} of ${all.length})` : '';
  return `${head}${range}\n${out.join('\n')}${i < all.length ? `\n… ${plural(all.length - i, 'more line')}: read ${f.path} ${i + 1}` : ''}`;
}, { visitor: true });
cmd(['write', 'save-file'], 'files', 'write <file> (+text)', 'make or replace a file with the text (folders are made as needed)', (sh, a, ex) => {
  const { args, flags } = parseArgs(a);
  need(args[0], 'usage: write <file>, with the text beside it');
  const text = textOf(ex, args.slice(1), 'write');
  const path = sh.os.resolve(sh.c, args[0], sh.opt()).view;
  const r = sh.os.write(sh.who, args[0], text, sh.opt({ expect: sh.seen.get(path), force: !!(flags.f || flags.force) }));
  sh.seen.set(r.info.path, r.info.version);
  sh.show = () => fileView(sh, r.info.path, r.same ? 'open' : 'write');
  return r.same ? `${r.info.path} already says exactly that (nothing changed)` : `${r.created ? 'made' : 'saved'} ${r.info.path} (${mbText(r.info.size)}, version ${r.info.version})`;
});
cmd('append', 'files', 'append <file> (+text)', 'add the text at the end of a file (made when missing)', (sh, a, ex) => {
  const { args } = parseArgs(a);
  need(args[0], 'usage: append <file>, with the text beside it');
  const added = textOf(ex, args.slice(1), 'append');
  const r = sh.os.append(sh.who, args[0], added, sh.opt());
  sh.seen.set(r.info.path, r.info.version);
  sh.show = () => fileView(sh, r.info.path, 'append', { part: added });
  return `added to ${r.info.path} (now ${mbText(r.info.size)}, version ${r.info.version})`;
});
cmd(['edit', 'replace'], 'files', 'edit <file> (+find, +replace)', 'change one passage of a text file: find is copied exactly from the file', (sh, a, ex) => {
  const { args, flags } = parseArgs(a);
  need(args[0], 'usage: edit <file>, with "find" (the exact words now) and "replace" (the new words)');
  let find = ex.find, repl = ex.replace;
  if (find === undefined && typeof ex.text === 'string') {
    const m = /^([\s\S]*?)\n={5,}\n([\s\S]*)$/.exec(ex.text);
    need(m, 'edit needs "find" and "replace" — or a text with the old words, a line of =====, then the new words');
    find = m[1]; repl = m[2];
  }
  need(typeof find === 'string' && find.length, 'edit needs "find": the exact words to change');
  const path = sh.os.resolve(sh.c, args[0], sh.opt()).view;
  const r = sh.os.edit(sh.who, args[0], find, repl ?? '', sh.opt({ all: !!flags.all, expect: sh.seen.get(path) }));
  sh.seen.set(r.info.path, r.info.version);
  sh.show = () => fileView(sh, r.info.path, 'edit', { part: repl || null });
  return `changed ${r.info.path} (${plural(r.replaced, 'place')}, version ${r.info.version})`;
});
cmd(['mkdir', 'md'], 'files', 'mkdir <folder>', 'make a folder (and the ones above it)', (sh, a) => {
  need(a[0], 'usage: mkdir <folder>');
  const r = sh.os.mkdir(sh.who, a[0], sh.opt());
  sh.show = () => parentView(sh, r.path);
  return r.existed ? `${r.path} is there already` : `made ${r.path}/`;
});
cmd(['mv', 'move', 'rename'], 'files', 'mv <from> <to>', 'move or rename (into a folder, or to a new name)', (sh, a) => {
  need(a.length >= 2, 'usage: mv <from> <to>');
  const r = sh.os.move(sh.who, a[0], a[1], sh.opt());
  sh.show = () => parentView(sh, r.info.path);
  return `moved ${r.from} → ${r.info.path}`;
});
cmd(['cp', 'copy'], 'files', 'cp <from> <to>', 'copy a file or folder (to share it with a team: cp ~/x /teams/<team>/)', (sh, a) => {
  need(a.length >= 2, 'usage: cp <from> <to>');
  const r = sh.os.copy(sh.who, a[0], a[1], sh.opt());
  sh.show = () => parentView(sh, r.info.path);
  return `copied ${r.from} → ${r.info.path}`;
});
cmd(['rm', 'del', 'delete'], 'files', 'rm <path>', 'put a file or folder in the trash (restore brings it back)', (sh, a) => {
  const { args } = parseArgs(a);
  need(args[0], 'usage: rm <path>');
  const r = sh.os.remove(sh.who, args[0], sh.opt());
  sh.show = () => parentView(sh, r.path);
  return `${r.path} is in the trash (restore it with: trash, then restore <id>)`;
});
cmd('trash', 'files', 'trash [~ or /teams/<team>]', 'what is in the trash', (sh, a) => {
  const r = sh.os.trashList(sh.who, a[0] || '~', sh.opt());
  if (!r.items.length) return 'the trash is empty';
  return r.items.slice(0, 40).map(i => `[${i.id}] ${i.path}${i.dir ? '/' : ''} — deleted ${sh.when(i.deleted)}`).join('\n') + '\nrestore <id> brings one back';
});
cmd(['restore', 'undelete'], 'files', 'restore <id>', 'bring something back from the trash', (sh, a) => {
  need(/^\d+$/.test(a[0] || ''), 'usage: restore <id> (the number "trash" shows)');
  const r = sh.os.restore(sh.who, Number(a[0]), sh.opt());
  sh.show = () => parentView(sh, r.info.path);
  return `restored ${r.info.path}`;
});
cmd(['find', 'grep', 'search-files'], 'files', 'find <words> [--in <folder>]', 'look for files by their name or the words in them', (sh, a) => {
  const { args, flags } = parseArgs(a, ['in']);
  need(args.length, 'usage: find <words>');
  const r = sh.os.find(sh.who, args.join(' '), sh.opt({ in: typeof flags.in === 'string' ? flags.in : null }));
  sh.show = () => findView(r.query, r.results);
  if (!r.results.length) return `nothing found for "${r.query}"`;
  return `${plural(r.results.length, 'match', 'matches')} for "${r.query}":\n${r.results.map(x => `${x.path}${x.dir ? '/' : ''}${x.snippet ? ` — ${x.snippet}` : ''}`).join('\n')}`;
}, { visitor: true });
cmd(['info', 'stat'], 'files', 'info <path>', 'size, version and who changed it last', (sh, a) => {
  need(a[0], 'usage: info <path>');
  const s = sh.os.stat(sh.who, a[0], sh.opt());
  sh.show = () => (s.dir ? folderView(sh, s.path) : fileView(sh, s.path));
  if (s.dir) return `${s.path} is a folder${s.access === 'r' ? ' (read only)' : ''}`;
  return `${s.path}: ${s.mime}, ${mbText(s.size)}, version ${s.version}, changed ${sh.when(s.modified)} by ${sh.by(s.by)}, made ${sh.when(s.created)}${s.access === 'r' ? ', read only' : ''}.${s.versions ? ` ${plural(s.versions, 'older version')}: versions ${s.path}` : ''}`;
}, { visitor: true });
cmd('versions', 'files', 'versions <file>', 'a file\'s older versions', (sh, a) => {
  need(a[0], 'usage: versions <file>');
  const v = sh.os.versions(sh.who, a[0], sh.opt());
  sh.show = () => fileView(sh, v.path);
  return [`${v.path} now: version ${v.current.version} (${mbText(v.current.size)}, ${sh.when(v.current.at)} by ${sh.by(v.current.by)})`,
    ...v.older.map(o => `version ${o.version}: ${mbText(o.size)}, ${sh.when(o.at)} by ${sh.by(o.by)}`),
    ...(v.older.length ? [`bring one back: revert ${v.path} <version>`] : ['no older versions'])].join('\n');
});
cmd('revert', 'files', 'revert <file> <version>', 'bring an older version back (the current one is kept as a version too)', (sh, a) => {
  need(a[0] && /^\d+$/.test(a[1] || ''), 'usage: revert <file> <version>');
  const r = sh.os.revert(sh.who, a[0], Number(a[1]), sh.opt());
  sh.seen.set(r.info.path, r.info.version);
  sh.show = () => fileView(sh, r.info.path, 'write');
  return `${r.info.path} is version ${a[1]} again (saved as version ${r.info.version})`;
});
cmd(['du', 'space', 'storage', 'df'], 'files', 'du', 'how much of the PC\'s storage is used', sh => {
  const u = sh.os.usage(sh.c.account);
  return `${mbText(u.used)} used${u.limit ? ` of ${mbText(u.limit)} (${Math.round((u.used / u.limit) * 100)} %), shared by the account's ${plural(u.agents, 'agent')} and ${plural(u.teams, 'team')}` : ' (no limit)'}. A file is at most ${u.fileMax ? mbText(u.fileMax) : 'any size'}.`;
});
cmd('skills', 'other', 'skills', 'your skills: how-to notes in ~/Skills (the first line says what each is for)', sh => {
  const r = sh.os.list(sh.who, '~/Skills', sh.opt({ limit: 100 }));
  const files = r.entries.filter(e => !e.dir);
  if (!files.length) return 'no skills yet. Write one: write ~/Skills/<name>.md — first line: what it is for; then the steps that worked.';
  return files.map(e => { let first = ''; try { first = sh.os.readText(sh.who, e.path, sh.opt()).text.split('\n').find(l => l.trim()) || ''; } catch { /* not text */ } return `${e.path} — ${first.replace(/^#+\s*/, '').slice(0, 120)}`; }).join('\n');
});

// --------------------------------------------------------------------------------------------- tasks
const taskLine = (sh, k, withBoard = false) => `#${k.id} [${COLUMN_NAMES[k.col]}] ${k.title}${k.assignee != null && k.assignee !== sh.c.agent ? ` — ${sh.by(`a:${k.assignee}`)}` : ''}${k.due ? ` · due ${sh.when(k.due, dayStart(k.due, sh.tz) === k.due)}` : ''}${withBoard ? ` · ${sh.boardName(k.board)}` : ''}`;
cmd(['tasks', 'board'], 'tasks', 'tasks [board]', 'your open tasks, or a whole board (~ yours, /teams/<team>)', (sh, a) => {
  sh.show = () => boardView(sh, a[0] || '~');
  if (!a[0] && sh.c.kind === 'agent') {
    const mine = sh.os.myTasks(sh.who);
    const own = sh.os.board(sh.who, '~', sh.opt()).cards.filter(k => k.col !== 'done' && !mine.some(m => m.id === k.id));
    const all = [...mine, ...own];
    return all.length ? `your open tasks (${all.length}):\n${all.map(k => taskLine(sh, k, true)).join('\n')}` : 'you have no open tasks';
  }
  const b = sh.os.board(sh.who, a[0] || '~', sh.opt());
  const cols = COLUMNS.map(col => {
    const ks = b.cards.filter(k => k.col === col);
    const shown = col === 'done' ? ks.slice(-5) : ks;
    return `${COLUMN_NAMES[col]}${ks.length ? ` (${ks.length})` : ''}: ${shown.length ? `\n${shown.map(k => `  ${taskLine(sh, k)}`).join('\n')}` : '—'}`;
  });
  return `${sh.boardName(b.board)}${b.access === 'r' ? ' (read only)' : ''}:\n${cols.join('\n')}`;
});
cmd('task', 'tasks', 'task add "<title>" … | task <id> [doing|review|done|note|to|due|rm]', 'add a task, or show / move / change one', (sh, a, ex) => {
  const { args, flags } = parseArgs(a, ['to', 'due', 'on', 'note', 'notes', 'title'], ['to', 'due', 'note', 'notes', 'title']);
  need(args.length || flags.title, 'usage: task add "<title>" [--to <agent>] [--due <when>] [--on <board>] — or task <id>');
  if (args[0]?.toLowerCase() === 'add' || args[0]?.toLowerCase() === 'new') {
    const title = flags.title || args.slice(1).join(' ');
    need(title, 'usage: task add "<title>"');
    const to = flags.to != null ? sh.agentNamed(flags.to) : null;
    const due = flags.due != null ? whenOf(sh, flags.due) : null;
    const k = sh.os.addCard(sh.who, flags.on || '~', { title, notes: flags.note || flags.notes || ex.text || '', assignee: to === 'none' ? null : to, due: due?.t ?? null }, sh.opt());
    sh.show = () => boardView(sh, k.board, k.id);
    return `added ${taskLine(sh, k)} to ${sh.boardName(k.board)}`;
  }
  const id = Number(String(args[0]).replace(/^#/, ''));
  need(Number.isInteger(id) && id > 0, 'usage: task <id> — the number after # in "tasks"');
  const verb = (args[1] || '').toLowerCase();
  // (the board the task is on, with it marked — after the change; one deleted: its board as it is now)
  const board = (() => { try { return sh.os.card(sh.who, id).board; } catch { return null; } })();
  if (board) sh.show = () => boardView(sh, board, verb === 'rm' || verb === 'delete' ? null : id);
  if (!verb) {
    const k = sh.os.card(sh.who, id);
    return [taskLine(sh, k, true), `made by ${sh.by(k.by)} ${sh.when(k.created)}${k.done ? ` · done ${sh.when(k.done)}` : ''}`, k.notes ? `notes:\n${k.notes}` : 'no notes'].join('\n');
  }
  if (MOVE[verb]) { const k = sh.os.updateCard(sh.who, id, { col: MOVE[verb], ...(ex.text ? { addNote: ex.text } : {}) }); return `${taskLine(sh, k)} (on ${sh.boardName(k.board)})`; }
  if (verb === 'move') { const col = MOVE[(args[2] || '').toLowerCase()]; need(col, `usage: task ${id} move todo|doing|review|done`); return taskLine(sh, sh.os.updateCard(sh.who, id, { col })); }
  if (verb === 'note' || verb === 'notes' || verb === 'comment') { const t = ex.text || args.slice(2).join(' '); need(t, `usage: task ${id} note "<words>"`); sh.os.updateCard(sh.who, id, { addNote: t }); return `added the note to #${id}`; }
  if (verb === 'to' || verb === 'give' || verb === 'assign') { const to = sh.agentNamed(args.slice(2).join(' ')); return taskLine(sh, sh.os.updateCard(sh.who, id, { assignee: to === 'none' ? null : to })); }
  if (verb === 'due') { const w = args.slice(2).join(' '); return taskLine(sh, sh.os.updateCard(sh.who, id, { due: /^(none|no|-)$/.test(w) ? null : whenOf(sh, w).t })); }
  if (verb === 'title' || verb === 'rename') { const t = args.slice(2).join(' '); need(t, `usage: task ${id} title "<new title>"`); return taskLine(sh, sh.os.updateCard(sh.who, id, { title: t })); }
  if (verb === 'rm' || verb === 'delete') { sh.os.removeCard(sh.who, id); return `deleted the task #${id}`; }
  throw new PcError(400, 'usage', `task ${id} ${verb}? Use doing, review, done, todo, note, to, due, title or rm`);
});
/** The week a calendar opens on to show `t`: this one (from today) when `t` is in it, else the week from its day. */
function weekOf(sh, t) {
  const today = dayStart(sh.now(), sh.tz);
  return t >= today && t < today + 7 * 86400000 ? today : dayStart(t, sh.tz);
}
function whenOf(sh, raw) {
  const w = parseWhen(raw, sh.tz, sh.now());
  if (!w) throw new PcError(400, 'bad_time', `"${raw}" isn't a time I can read. Write it like: tomorrow 9am, fri 5pm, 2026-10-20 14:00, in 2 hours`);
  return w;
}

// --------------------------------------------------------------------------------------------- calendar
cmd(['cal', 'calendar'], 'calendar', 'cal [today|tomorrow|week|<date>] · cal add "<title>" <when> · cal move <id> <when> · cal rm <id>', 'your calendars and your teams\'', (sh, a, ex) => {
  const { args, flags } = parseArgs(a, ['for', 'until', 'on', 'at', 'note', 'title', 'to'], ['for', 'until', 'at', 'note', 'title', 'to']);
  const verb = (args[0] || '').toLowerCase();
  if (verb === 'add' || verb === 'new') {
    let title = flags.title || null, rest = args.slice(1), w = null;
    if (title) w = whenOf(sh, rest.join(' '));
    else {
      // the title is the first words, the time the longest ending that reads as one
      for (let k = 1; k < rest.length && !w; k++) { const p = parseWhen(rest.slice(k).join(' '), sh.tz, sh.now()); if (p) { w = p; title = rest.slice(0, k).join(' '); } }
      need(w, 'usage: cal add "<title>" <when> — e.g. cal add "Team call" tomorrow 3pm --for 30m');
    }
    let end = null;
    if (flags.for) { const l = parseLength(flags.for); need(l, `"${flags.for}" isn't a length: e.g. 30m, 1h, 2 days`); end = w.t + l; }
    else if (flags.until || flags.to) { const u = parseWhen(flags.until || flags.to, sh.tz, w.t); need(u, `"${flags.until || flags.to}" isn't a time`); end = u.t <= w.t ? u.t + 86400000 : u.t; }
    else if (w.allDay) end = w.t + 86400000;
    const e = sh.os.addEvent(sh.who, flags.on || '~', { title, start: w.t, end, allDay: w.allDay && !flags.for, place: flags.at || '', notes: flags.note || ex.text || '' }, sh.opt());
    sh.show = () => calView(sh, weekOf(sh, e.start), e.id);
    return `put on ${e.calendar === '~' ? 'your calendar' : `the ${e.calendar.replace('/teams/', '')} team's calendar`}: [${e.id}] ${e.title} — ${sh.when(e.start, e.allDay)}${e.allDay ? '' : ` for ${lengthText(e.end - e.start)}`}${e.place ? ` at ${e.place}` : ''}`;
  }
  if (verb === 'rm' || verb === 'delete' || verb === 'cancel') { need(/^\d+$/.test(args[1] || ''), 'usage: cal rm <id>'); sh.os.removeEvent(sh.who, Number(args[1])); sh.show = () => calView(sh, dayStart(sh.now(), sh.tz)); return `took [${args[1]}] off the calendar`; }
  if (verb === 'move') {
    need(/^\d+$/.test(args[1] || '') && args.length > 2, 'usage: cal move <id> <when>');
    const w = whenOf(sh, args.slice(2).join(' '));
    const e = sh.os.updateEvent(sh.who, Number(args[1]), { start: w.t, allDay: w.allDay });
    sh.show = () => calView(sh, weekOf(sh, e.start), e.id);
    return `[${e.id}] ${e.title} is now ${sh.when(e.start, e.allDay)}`;
  }
  // a view: today (default), tomorrow, week, or a date
  const now = sh.now();
  let from, to, label;
  if (!verb || verb === 'today') { from = dayStart(now, sh.tz); to = from + 86400000; label = 'today'; }
  else if (verb === 'tomorrow') { from = dayStart(now, sh.tz) + 86400000; to = from + 86400000; label = 'tomorrow'; }
  else if (verb === 'week') { from = dayStart(now, sh.tz); to = from + 7 * 86400000; label = 'the next 7 days'; }
  else { const w = whenOf(sh, args.join(' ')); from = dayStart(w.t, sh.tz); to = from + 86400000; label = sh.when(from, true); }
  const ev = sh.os.events(sh.who, from, to + 3600000, sh.opt({ where: flags.on || null })).events.filter(e => e.end > from && e.start < to);
  sh.show = () => calView(sh, from);
  if (!ev.length) return `nothing on the calendar ${label === 'today' || label === 'tomorrow' ? label : `for ${label}`} (now: ${sh.when(now)})`;
  return `${label} (now: ${sh.when(now)}):\n${ev.map(e => `[${e.id}] ${sh.when(e.start, e.allDay)}${e.allDay ? ' (all day)' : `–${showWhen(e.end, sh.tz, { now }).split(', ').pop()}`} ${e.title}${e.place ? ` at ${e.place}` : ''}${e.calendar !== '~' ? ` · ${e.calendar.replace('/teams/', '')} team` : ''}`).join('\n')}`;
});

// --------------------------------------------------------------------------------------------- team, me, help
cmd(['team', 'teams'], 'other', 'team [name]', 'your teams: who is in them and what each is for', (sh, a) => {
  const ts = sh.os.teamsOf(sh.c, sh.profile);
  const want = a[0] ? a.join(' ').toLowerCase() : null;
  const list = want ? ts.filter(t => t.slug === want || t.name.toLowerCase() === want || t.slug.startsWith(want)) : ts;
  if (!ts.length) return 'you are not in any team';
  if (!list.length) return `you are not in a team called "${a.join(' ')}". Your teams: ${ts.map(t => t.slug).join(', ')}`;
  return list.map(t => {
    const ms = t.members.filter(m => m.agent !== sh.c.agent).map(m => `${sh.by(`a:${m.agent}`)} (${m.role})`);
    return `${t.name} — folder /teams/${t.slug}${t.role ? `, you are ${t.role}` : ''}\n  co-workers: ${ms.join(', ') || 'none yet'}${t.brief ? `\n  brief: ${want ? t.brief : t.brief.slice(0, 300)}` : ''}`;
  }).join('\n');
});
cmd(['whoami', 'me', 'status'], 'other', 'whoami', 'who and where you are, the time, your teams and the storage', sh => {
  const ts = sh.os.teamsOf(sh.c, sh.profile);
  const u = sh.os.usage(sh.c.account);
  const me = sh.os.agents.get(sh.profile);
  return [`You are ${me ? `${me.name}${me.role ? ` (${me.role})` : ''}` : 'an agent'}, on your own PC, in ${sh.cwd}.`,
    `Now: ${sh.when(sh.now())} (${sh.tz}).`,
    `Teams: ${ts.length ? ts.map(t => `${t.slug} (${t.role})`).join(', ') : 'none'}.`,
    `Storage: ${mbText(u.used)}${u.limit ? ` of ${mbText(u.limit)}` : ''} used by the account.`].join('\n');
});
cmd(['help', '?', 'man'], 'other', 'help [command]', 'the commands, or how one works', (sh, a) => {
  if (a[0]) {
    const c = COMMANDS.find(x => x.names.includes(a[0].toLowerCase()));
    if (!c) return `no command "${a[0]}". ${PcShell.menu({ browser: !!sh.browser })}`;
    return `${c.usage}\n${c.about}${c.names.length > 1 ? `\n(also: ${c.names.slice(1).join(', ')})` : ''}${c.example ? `\nexample: ${c.example}` : ''}`;
  }
  return PcShell.menu({ browser: !!sh.browser, visitor: sh.c.kind === 'visitor' });
}, { visitor: true });

// --------------------------------------------------------------------------------------------- browser (./browser.js)
const pcPath = p => /^(~(\/|$)|\/teams\/|\/home(\/|$))/.test(String(p || ''));
cmd(['search', 'google', 'web'], 'browser', 'search <words>', 'search the web', async (sh, a) => {
  need(a.length, 'usage: search <words>');
  return sh.browser.search(sh, a.join(' '));
}, { browser: true });
cmd(['open', 'go', 'visit', 'browse'], 'browser', 'open <url | link number | file>', 'open a web page (a number follows that link of the page you are on) — or a file of your PC (~/…)', async (sh, a, ex) => {
  need(a.length, 'usage: open <url> — or open <n> for a link of the page you are on');
  // (a path of the PC — ~/…, /teams/…: that file, as read shows it — a picture on the screen)
  if (pcPath(a[0])) return COMMANDS.find(x => x.names.includes('read')).run(sh, a, ex, 'read');
  return sh.browser.open(sh, a.join(' '));
}, { browser: a => !pcPath(a[0]) });   // (a file of the PC opens without a browser)
cmd(['more', 'next'], 'browser', 'more', 'the next part of the page you are on', async sh => sh.browser.more(sh), { browser: true });
cmd('links', 'browser', 'links', 'the links of the page you are on', async sh => sh.browser.links(sh), { browser: true });
cmd('back', 'browser', 'back', 'the page before', async sh => sh.browser.back(sh), { browser: true });
cmd('history', 'browser', 'history', 'pages you opened lately', async sh => sh.browser.history(sh), { browser: true });
cmd('click', 'browser', 'click f<n> | click <n>', 'click a field or button of the page (f<n>, in a browser service), or follow link <n>', async (sh, a) => {
  need(a[0], 'usage: click f<n> — the fields and buttons are listed under the page');
  return sh.browser.click(sh, a[0]);
}, { browser: true });
cmd('type', 'browser', 'type f<n> "<words>"', 'type into a field of the page (in a browser service)', async (sh, a, ex) => {
  need(a[0] && (a.length > 1 || ex.text), 'usage: type f<n> "<words>"');
  return sh.browser.type(sh, a[0], ex.text ?? a.slice(1).join(' '));
}, { browser: true });
cmd('press', 'browser', 'press Enter|Tab|Escape', 'press a key on the page (in a browser service)', async (sh, a) => {
  need(a[0], 'usage: press Enter');
  return sh.browser.press(sh, a[0]);
}, { browser: true });
cmd('save', 'browser', 'save <file>', 'keep the page you are on as a file (its words and link)', async (sh, a) => {
  need(a[0], 'usage: save <file> — e.g. save ~/Downloads/article.md');
  return sh.browser.save(sh, a[0]);
}, { browser: true });

COMMANDS.find(c => c.names[0] === 'write').example = 'write ~/Documents/plan.md <<EOF\n# Plan\n- call Sam\nEOF';
COMMANDS.find(c => c.names[0] === 'edit').example = '{"tool":"pc","run":"edit ~/Documents/plan.md","find":"call Sam","replace":"call Sam on Friday"}';
COMMANDS.find(c => c.names[0] === 'task').example = 'task add "Write the weekly report" --to Mo --due "fri 5pm" --on /teams/ops';
COMMANDS.find(c => c.names[0] === 'cal').example = 'cal add "Standup" tomorrow 9am --for 15m --on /teams/ops';
export const COMMAND_NAMES = Object.freeze(COMMANDS.map(c => c.names[0]));
