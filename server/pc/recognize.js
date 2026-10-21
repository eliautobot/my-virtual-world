// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a step works on (docs/features/agent-pc.md §2.2): an Agent Providers' agent's step (OpenClaw's, Hermes') says what
// it touches — a web address, a file, a picture, its calendar, its tasks — whatever tool it went through: a terminal
// command that drives a browser (agent-browser … --cdp) is browsing, `sed -n 1,80p notes.md` is reading a file. Each app
// of the PC recognizes its own work (RECOGNIZERS: one entry per app, a new app adds its own) and the strongest claim
// shows; a step no app claims is the terminal's (a build, an install, a script: then the terminal is the work). A claim
// is the app, a line of what it does, and the window it has open — built from the step's own input, then filled in from
// its result (the text of the file it read, what it found): the view kinds of ./views.js, `remote` (it is on the agent's
// own computer, not on this PC). Nothing here reaches anything: it reads the step and nothing else.
import { capView } from './views.js';

const LINES = 40, LINE_MAX = 180, ROWS = 14;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;
const URL_RE = /https?:\/\/[^\s'"<>`)\]]+/i;
const clipLine = s => (s.length > LINE_MAX ? `${s.slice(0, LINE_MAX - 1)}…` : s);
const one = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const nameOf = p => String(p || '').replace(/\/+$/, '').split('/').pop() || String(p || '');

// ------------------------------------------------------------------------------------------- reading a step
/** The step's arguments as an object: its input when that is JSON (even cut short: the fields that came whole), else {}. */
export function argsOf(input) {
  const s = String(input ?? '').trim();
  if (!s.startsWith('{')) return {};
  try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch { /* cut short */ }
  const o = {};
  // (a cut-short JSON: each "key": "string" that came whole, and the last one that didn't — what it was writing)
  const re = /"([A-Za-z_]+)"\s*:\s*"((?:[^"\\]|\\.)*)("?)/g;
  for (let m; (m = re.exec(s));) { try { o[m[1]] = JSON.parse(`"${m[2].replace(/\\$/, '')}"`); } catch { o[m[1]] = m[2]; } }
  return o;
}
const PATH_KEYS = ['path', 'file_path', 'filePath', 'file', 'filename', 'target_file', 'notebook_path', 'image', 'image_path', 'imagePath'];
/** The file a step names in its arguments. */
function argPath(a) { for (const k of PATH_KEYS) if (typeof a[k] === 'string' && a[k] && !URL_RE.test(a[k])) return a[k]; return null; }
/** The command of a step that runs one (its input when it isn't JSON). */
function commandOf(step) {
  if (typeof step.args.command === 'string') return step.args.command;
  if (typeof step.args.cmd === 'string') return step.args.cmd;
  return step.kind === 'execute' && !String(step.input || '').trim().startsWith('{') ? String(step.input || '') : '';
}
/** A command's parts, in order, without what only sets the scene (cd, export, sleep, echo…). */
const SCENE = new Set(['cd', 'export', 'source', '.', 'sleep', 'echo', 'printf', 'true', 'false', 'set', 'unset', 'pwd', 'clear', 'time', 'timeout', 'env', 'nohup', 'sudo']);
function partsOf(cmd) {
  return String(cmd).split(/\s*(?:&&|\|\||;|\n|\|)\s*/).map(p => p.trim()).filter(Boolean).map(p => {
    let ws = p.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    // (a wrapper's own options: timeout 60 node x → node x)
    while (ws.length && (SCENE.has(ws[0]) && ['timeout', 'time', 'env', 'nohup', 'sudo'].includes(ws[0]))) { ws = ws.slice(1); while (ws.length && (/^-/.test(ws[0]) || /^\d+[smh]?$/.test(ws[0]) || /^\w+=/.test(ws[0]))) ws = ws.slice(1); }
    return ws.map(w => w.replace(/^(["'])(.*)\1$/, '$2'));
  }).filter(ws => ws.length && !SCENE.has(ws[0]) && !/^\w+=/.test(ws[0]));
}
/**
 * One step, as recognizers read it.
 * @param {{ name?: string, kind?: string, input?: string, title?: string }} s  tool.start's fields (the provider bus)
 */
export function stepOf(s) {
  const step = { name: String(s.name || ''), kind: String(s.kind || s.toolKind || 'other'), input: String(s.input || '') };
  step.n = step.name.toLowerCase().replace(/^mcp[_-]+/, '');
  // (its provider's own words for it — "Run agent-browser", "Read MEMORY.md" — not just its tool's name tidied: "exec", "Read file")
  const bare = x => String(x || '').toLowerCase().replace(/^mcp[_-]+/, '').replace(/[\s_-]+/g, '');
  step.title = s.title && bare(s.title) !== bare(s.name) ? one(s.title, 120) : '';
  step.args = argsOf(step.input);
  step.cmd = commandOf(step);
  step.parts = step.cmd ? partsOf(step.cmd) : [];
  // (a step whose whole input is one word with no spaces — Hermes' short context, OpenClaw's lone path — names its file)
  step.path = argPath(step.args) || (!step.cmd && step.kind !== 'execute' && /^[^\s{}"]+$/.test(step.input.trim()) && !URL_RE.test(step.input) ? step.input.trim() : null);
  // (named before its arguments come — "Read README.md": its title says the file)
  if (!step.path && !step.cmd && ['read', 'edit', 'delete', 'move'].includes(step.kind)) step.path = /([\w.~/-]+\.\w{1,8})\s*$/.exec(step.title)?.[1] || null;
  step.url = (typeof step.args.url === 'string' && step.args.url) || (Array.isArray(step.args.urls) && step.args.urls[0]) || URL_RE.exec(step.input)?.[0] || null;
  return step;
}

// ------------------------------------------------------------------------------------------- what a view holds
/** A text's window: its lines from `first` (1-based), the lines `hl` marked. */
function windowOf(text, first = 1, hl = null) {
  const all = String(text ?? '').split('\n');
  if (all.length > 1 && all[all.length - 1] === '') all.pop();
  let start = 0;
  if (hl) start = Math.max(0, Math.min(hl[0] - first - 3, all.length - LINES));
  return { first: first + start, total: first - 1 + all.length, lines: all.slice(start, start + LINES).map(clipLine), ...(hl ? { hl } : {}) };
}
/** A file's text as a read tool gives it back: its own numbers taken off ("  12\tline", "12: line", "12|line"), with
 *  the first line's number; a note a tool adds after it ("[… more lines]") left out. */
export function readText(text, from = 1) {
  const lines = String(text ?? '').replace(/\n+\[[^\]\n]{0,200}\]\s*$/, '').replace(/\n+$/, '').split('\n');
  const num = /^\s*(\d+)(?:\t|: |\||→)(.*)$/;
  const full = lines.filter(l => l.trim());
  // (most of its lines numbered — or its one line, numbered where it was read from)
  const numbered = full.length > 1 ? full.filter(l => num.test(l)).length >= Math.ceil(full.length * 0.8) : full.length === 1 && Number(num.exec(full[0])?.[1]) === from;
  if (!numbered) return { text: lines.join('\n'), first: from };
  const m = num.exec(lines.find(l => num.test(l)));
  return { text: lines.map(l => { const x = num.exec(l); return x ? x[2] : l; }).join('\n'), first: Number(m[1]) || from };
}
/** A file being read, written or changed, on the agent's own computer. */
function fileOf(path, mode, o = {}) {
  return { kind: 'file', remote: true, path: String(path).slice(0, 400), name: nameOf(path).slice(0, 200), mode, lines: [], first: 1, total: 0, ...o };
}
const fileText = (v, text, { first = 1, mark = false, diff = false } = {}) => {
  const w = windowOf(text, first, null);
  const hl = mark ? [w.first, w.first + Math.max(0, w.lines.length - 1)] : null;
  return { ...v, ...w, ...(hl ? { hl } : {}), ...(diff ? { diff: true } : {}) };
};
/** Results a search or a listing printed, as rows: "path:line:text", "path", a URL with its title. */
function hitsOf(text) {
  const out = [];
  for (const l of String(text ?? '').split('\n')) {
    const m = /^([^\s:][^:]{0,300}):(\d+)[:-](.*)$/.exec(l) || /^([^\s:][^:]{0,300}):(.*)$/.exec(l);
    if (m) out.push({ path: m[1], snippet: clipLine((m[3] ?? m[2]).trim()) });
    else if (l.trim() && !/^\s*$/.test(l)) out.push({ path: clipLine(l.trim()), snippet: '' });
    if (out.length >= ROWS) break;
  }
  return out;
}
/** A folder's entries as ls printed them: `ls -l`'s rows (a d first: a folder), else its names. */
function entriesOf(text) {
  const out = [];
  for (const l of String(text ?? '').split('\n')) {
    if (!l.trim() || /^total \d+/.test(l)) continue;
    const m = /^([dlcbps-])[rwxsStT-]{9}[.+@]?\s+\d+\s+\S+\s+\S+\s+([\d,.]+[KMGT]?)\s+\S+\s+\S+\s+\S+\s+(.+)$/.exec(l);
    if (m) { if (!/^\.\.?$/.test(m[3])) out.push({ name: clipLine(m[3].replace(/ -> .*$/, '')), dir: m[1] === 'd', size: /^\d+$/.test(m[2]) ? Number(m[2]) : null }); }
    else for (const n of l.trim().split(/\s{2,}|\t/)) if (n && !/^\.\.?\/?$/.test(n)) out.push({ name: clipLine(n.replace(/\/$/, '')), dir: /\/$/.test(n), size: null });
    if (out.length >= 60) break;
  }
  return out;
}
/** Web results a search printed: each address with the words beside it. */
function webHits(text) {
  const out = [];
  const lines = String(text ?? '').split('\n');
  for (let k = 0; k < lines.length && out.length < 10; k++) {
    const u = URL_RE.exec(lines[k]);
    if (!u) continue;
    const title = lines[k].replace(u[0], '').replace(/^[\s\-*\d.#:|>[\]()]+/, '').replace(/\]\(\s*$/, '').trim() || lines[k - 1]?.replace(/^[\s\-*\d.#]+/, '').trim() || u[0];
    out.push({ title: clipLine(title), href: u[0].slice(0, 300), text: clipLine((lines[k + 1] || '').trim()) });
  }
  return out;
}
/** A plain list of lines (what a calendar or task command printed), for an app with nothing richer. */
const listOf = (app, heading, text) => ({ kind: 'text', remote: true, app, heading: one(heading, 140), lines: String(text ?? '').split('\n').filter(l => l.trim()).slice(0, LINES).map(clipLine) });

// ------------------------------------------------------------------------------------------- the apps' recognizers
const FILE_READ = new Set(['cat', 'head', 'tail', 'less', 'more', 'nl', 'bat', 'batcat', 'view', 'sed', 'awk', 'jq', 'yq']);
const FILE_FIND = new Set(['grep', 'rg', 'ag', 'ack', 'egrep', 'fgrep', 'find', 'fd', 'fdfind', 'locate']);
const FILE_LIST = new Set(['ls', 'tree', 'exa', 'eza', 'dir']);
const FILE_CHANGE = new Set(['tee', 'touch', 'mkdir', 'cp', 'mv', 'rm', 'rmdir', 'ln', 'chmod', 'trash', 'trash-put', 'patch']);
const EDITORS = new Set(['vim', 'vi', 'nano', 'emacs', 'code', 'micro']);
const BROWSERS = /^(agent-browser|playwright|playwright-cli|puppeteer|chromium|chromium-browser|google-chrome|chrome|firefox|lynx|w3m|links|xdg-open|browser-use|stagehand)$/;
// (a browser program by its file's name: agent-browser's own build — ~/…/agent-browser/bin/agent-browser-linux-x64 —
// counts as agent-browser; a script of one run by node, the same)
const progOf = w => String(w || '').split('/').pop().replace(/\.(exe|js|mjs|cjs)$/i, '').replace(/-(linux|darwin|macos|mac|win(dows)?|win32)(-[\w]+)?$/i, '');
const isBrowserProg = (ws, k = 0) => BROWSERS.test(progOf(ws[k])) || /(^|\/)node_modules\/(agent-browser|playwright|puppeteer)\//.test(ws[k] || '');
const isLocal = u => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[::1\])/i.test(u);
// (a command's file: its last word that looks like one — not an option, a line range, a sed or awk program, an address)
const pathArg = ws => ws.slice(1).filter(w => !/^-/.test(w) && !/^\d+(,\d+)?p?$/.test(w) && !/^[sy]([/|#,:]).*\1/.test(w) && !/^[{'"<>]|[{}]/.test(w) && /[./~]/.test(w) && !URL_RE.test(w)).pop() || null;
/** A file a command writes with a here-document or a redirect (cat > f <<EOF … EOF, tee f <<EOF, echo … > f), with its words. */
function writtenBy(cmd) {
  const lines = String(cmd).split('\n'), head = lines[0];
  const doc = /<<-?\s*(['"]?)(\w+)\1/.exec(head);
  if (doc && /(^|[\s;&|(])(cat|tee)\b/.test(head)) {
    const to = /(?:^|[^<0-9&])>>?\s*([^\s<>|;&]+)/.exec(head.replace(doc[0], '')) || /\btee\s+(?:-a\s+)?([^\s<>|;&-][^\s<>|;&]*)/.exec(head);
    if (!to || /^\/dev\//.test(to[1])) return null;
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === doc[2]);
    return { path: to[1].replace(/^(["'])(.*)\1$/, '$2'), text: lines.slice(1, end > 0 ? end : undefined).join('\n') };
  }
  const e = /(?:^|[\s;&|(])(?:echo|printf)\s+(?:-[a-z]+\s+)*(['"])([\s\S]*?)\1\s*>>?\s*([^\s<>|;&]+)/.exec(cmd);
  return e && /[./~]/.test(e[3]) && !/^\/dev\//.test(e[3]) ? { path: e[3], text: e[2].replace(/\\n/g, '\n') } : null;
}

/**
 * Each app's recognizer: claim(step) → { score, title, view } or null. finish(step, claim, result) fills its window in
 * from the step's result ({ text, ok }) — or leaves it as it was (returns null).
 */
export const RECOGNIZERS = [
  // MVW's own PC, reached as a tool (the connector's `pc`): the PC shows that step itself (./shell.js)
  { app: 'pc', claim: s => (/(^|[_-])pc$|__pc$|virtual[_-]?world.*pc$/.test(s.n) ? { score: 9, skip: true } : null) },
  { app: 'browser', claim(s) {
    // a browser tool (OpenClaw's browser, Hermes' browser_*, any navigate/click/screenshot), or a command that drives one
    const tool = /(^|_)(browser|navigate|playwright|puppeteer|screenshot|page|click|scroll|tab)s?($|_)|^browser/.test(s.n);
    const drive = s.parts.find(ws => isBrowserProg(ws) || ws.includes('--cdp') || (/^(npx|pnpm|bunx|node|bun|deno)$/.test(ws[0]) && isBrowserProg(ws, 1)) || (ws[0] === 'openclaw' && ws[1] === 'browser'));
    if (!tool && !drive) return null;
    const url = s.url && !isLocal(s.url) ? s.url : drive ? (drive.find(w => URL_RE.test(w)) || null) : s.url;
    return { score: 6, title: url ? `Browsing ${url.replace(/^https?:\/\//, '')}` : s.title || (drive ? one(`${progOf(drive[0])} ${drive.slice(1).join(' ')}`, 120) : ''),
      view: { kind: 'page', provider: true, url: String(url || '').slice(0, 500), title: one(url ? url.replace(/^https?:\/\//, '') : '', 200) } };
  } },
  { app: 'browser', claim(s) {
    // searching the web
    if (!/(^|_)web_?search$|^search_?web|^(google|bing|brave|duckduckgo|perplexity|tavily|exa)(_search)?$/.test(s.n)) return null;
    const q = one(s.args.query ?? s.args.q ?? s.args.search ?? s.input, 100);
    return { score: 5, title: `Searching the web: ${q}`, view: { kind: 'web', remote: true, query: q, results: [] } };
  }, finish: (s, c, r) => (r.ok !== false ? { ...c.view, results: webHits(r.text) } : null) },
  { app: 'browser', claim(s) {
    // reading a page: a fetch tool, or curl/wget of a page out on the web (not an API on its own machine)
    const tool = /(^|_)(web_?fetch|web_?extract|fetch_?url|read_?url|http_?get|url)$|^fetch$/.test(s.n);
    const get = s.parts.find(ws => /^(curl|wget|http|xh)$/.test(ws[0]) && !ws.some(w => /^(-X|--request|-d|--data.*|-F|--form|-T|--upload-file)$/.test(w)));
    const url = tool ? s.url : get ? get.find(w => URL_RE.test(w)) : null;
    if (!url || isLocal(url)) return null;
    return { score: 4, title: s.title || `Reading ${url}`, view: { kind: 'page', remote: true, url: url.slice(0, 500), title: one(url.replace(/^https?:\/\//, ''), 200), lines: [] } };
  }, finish: (s, c, r) => (r.ok !== false && r.text ? { ...c.view, ...windowOf(r.text) } : null) },
  { app: 'files', claim(s) {
    // a picture: looked at, made, or a file of one
    const tool = /(^|_)(image|images|vision|view_image|image_generate|generate_image|analy[sz]e_image|look)/.test(s.n);
    const p = s.path && IMAGE.test(s.path) ? s.path : (s.parts.map(pathArg).find(x => x && IMAGE.test(x)) || null);
    if (!p && !tool) return null;
    if (!p) return { score: 3, title: s.title, view: { kind: 'image', remote: true, name: one(s.args.prompt || s.title, 120), made: /generat|create|draw|edit/.test(s.n) } };
    // (a picture a tool is given beats any other claim; one a command names, a browser it drives — its screenshot)
    return { score: s.path && IMAGE.test(s.path) ? 7 : 5, title: s.title || `Looking at ${nameOf(p)}`, view: { kind: 'image', remote: true, path: p.slice(0, 400), name: nameOf(p).slice(0, 200) } };
  } },
  { app: 'files', claim(s) {
    // a file read, written or changed through a file tool
    const a = s.args, p = s.path || (typeof a.input === 'string' && /\*\*\* (?:Update|Add|Delete) File: (.+)/.exec(a.input)?.[1]) || null;
    const write = /(^|_)(write|create)(_?file)?$|^write/.test(s.n) || (s.kind === 'edit' && typeof (a.content ?? a.contents ?? a.text) === 'string' && !(a.old_string ?? a.oldText ?? a.old_str));
    const patch = /apply_?patch|^patch|(^|_)(edit|replace|str_replace|multi_?edit)/.test(s.n) || s.kind === 'edit';
    const search = /(^|_)(grep|glob|search_files|find_files|list_dir|ls)$|^search_files/.test(s.n) || (s.kind === 'search' && !s.url && !/web/.test(s.n));
    const read = /(^|_)(read|read_file|view|open|cat|memory_get|get_file)$|^read/.test(s.n) || s.kind === 'read';
    if (!p && !search) return null;
    if (write && p) {
      const text = a.content ?? a.contents ?? a.text ?? '';
      return { score: 6, title: s.title || `Writing ${nameOf(p)}`, view: fileText(fileOf(p, 'write'), text, { mark: true }) };
    }
    if (patch && p) {
      // (what it puts in: the new words of each change, or the patch itself)
      const edits = Array.isArray(a.edits) ? a.edits : [a];
      const neu = edits.map(e => e?.new_string ?? e?.newText ?? e?.new_str ?? e?.replace ?? '').filter(x => typeof x === 'string' && x).join('\n…\n');
      if (neu) return { score: 6, title: s.title || `Changing ${nameOf(p)}`, view: fileText(fileOf(p, 'edit'), neu, { mark: true }) };
      if (typeof a.input === 'string' || typeof a.patch === 'string') return { score: 6, title: s.title || `Changing ${nameOf(p)}`, view: fileText(fileOf(p, 'edit'), a.input ?? a.patch, { diff: true }) };
      return { score: 5, title: s.title || `Changing ${nameOf(p)}`, view: fileOf(p, 'edit') };
    }
    if (search) {
      const q = one(a.pattern ?? a.query ?? a.regex ?? a.glob ?? s.input, 100);
      return { score: 5, title: s.title || `Searching for ${q}`, view: { kind: 'find', remote: true, query: q, results: [] } };
    }
    if (read && p) return { score: 5, title: s.title || `Reading ${nameOf(p)}`, view: fileOf(p, 'read', { first: Number(a.offset ?? a.from ?? a.start_line ?? a.line) || 1 }) };
    return null;
  }, finish(s, c, r) {
    if (r.ok === false || !r.text) return null;
    const v = c.view;
    if (v.kind === 'find') return { ...v, results: hitsOf(r.text) };
    if (v.kind === 'file' && v.mode === 'read') { const t = readText(r.text, v.first); return fileText(v, t.text, { first: t.first }); }
    // (a change: a tool that gives back the changed part shows it — Hermes' diff)
    if (v.kind === 'file' && !v.lines.length && /^[-+@]{1,3}[ @]/m.test(r.text)) return fileText(v, r.text, { diff: true });
    return null;
  } },
  { app: 'files', claim(s) {
    // a file written from the terminal: a here-document, tee, echo … > file
    const w = s.cmd && writtenBy(s.cmd);
    return w ? { score: 5, title: `Writing ${nameOf(w.path)}`, view: fileText(fileOf(w.path, 'write'), w.text, { mark: true }) } : null;
  } },
  { app: 'files', claim(s) {
    // reviewing changes: git diff / show / log -p, gh pr diff — the changes, as a diff
    const ws = s.parts.find(x => (x[0] === 'git' && /^(diff|show|log)$/.test(x[1] || '')) || (x[0] === 'gh' && x[1] === 'pr' && /^(diff|view)$/.test(x[2] || '')));
    if (!ws) return null;
    const p = ws.slice(2).filter(x => !/^-/.test(x) && /[./]/.test(x) && !/^[0-9a-f]{7,40}$|\.\./.test(x)).pop();
    const what = ws[0] === 'gh' ? `pull request ${ws.slice(3).find(x => /^\d+$/.test(x)) || ''}`.trim() : p ? nameOf(p) : 'the changes';
    return { score: 4, title: `Reviewing ${what}`, view: fileOf(p || (ws[0] === 'gh' ? what : 'changes'), 'review', { name: what }) };
  }, finish: (s, c, r) => (r.ok !== false && r.text ? fileText(c.view, r.text, { diff: true }) : null) },
  { app: 'files', claim(s) {
    // a file read, searched or changed from the terminal: cat, sed -n, grep, find, an editor…
    for (const ws of s.parts) {
      const w = ws[0].split('/').pop();
      if (FILE_READ.has(w) || EDITORS.has(w)) {
        if (w === 'sed' && ws.includes('-i')) { const p = pathArg(ws); return p ? { score: 4, title: `Changing ${nameOf(p)}`, view: fileOf(p, 'edit') } : null; }
        const p = pathArg(ws);
        if (!p) continue;
        const from = w === 'sed' ? Number(/^(\d+),?\d*p$/.exec(ws.find(x => /^\d+,?\d*p$/.test(x)) || '')?.[1]) || 1 : 1;
        return { score: 4, title: `Reading ${nameOf(p)}`, view: fileOf(p, 'read', { first: from, cmd: w }) };
      }
      if (FILE_FIND.has(w)) {
        const q = ws.slice(1).filter(x => !/^-/.test(x))[0] || '';
        return { score: 3, title: `Searching for ${one(q, 80)}`, view: { kind: 'find', remote: true, query: one(q, 100), results: [] } };
      }
      if (FILE_LIST.has(w)) { const p = ws.slice(1).filter(x => !/^-/.test(x)).pop() || '.'; return { score: 3, title: `Looking in ${p}`, view: { kind: 'folder', remote: true, path: p.slice(0, 400), total: 0, entries: [] } }; }
      if (FILE_CHANGE.has(w)) { const p = pathArg(ws); if (p) return { score: 3, title: `${w} ${nameOf(p)}`, view: fileOf(p, w === 'rm' || w === 'trash' || w === 'trash-put' ? 'delete' : 'open') }; }
      // (anything else first — a build, a script — is the terminal's work, whatever it reads after)
      return null;
    }
    return null;
  }, finish(s, c, r) {
    if (r.ok === false || !r.text) return null;
    const v = c.view;
    if (v.kind === 'find') return { ...v, results: hitsOf(r.text) };
    if (v.kind === 'folder') { const entries = entriesOf(r.text); return { ...v, total: entries.length, entries: entries.slice(0, ROWS * 3) }; }
    if (v.kind === 'file' && v.mode === 'read') return fileText(v, readText(r.text, v.first).text, { first: v.first });
    return null;
  } },
  { app: 'calendar', claim(s) {
    const tool = /calendar|(^|_)(cal|gcal|events?|schedule_?meeting|meeting)(_|$)/.test(s.n) && !/cron/.test(s.n);
    const cmd = s.parts.find(ws => /^(gcalcli|khal|calcurse|icalbuddy)$/.test(ws[0]) || (ws[0] === 'gog' && /^cal/.test(ws[1] || '')) || (/outlook-cli$/.test(ws[0]) && ws[1] === 'cal'));
    if (!tool && !cmd) return null;
    return { score: 5, title: s.title || 'On its calendar', view: listOf('calendar', s.title || cmd?.join(' ') || 'Calendar', '') };
  }, finish: (s, c, r) => (r.ok !== false && r.text ? { ...c.view, lines: listOf('calendar', '', r.text).lines } : null) },
  { app: 'board', claim(s) {
    // its tasks: a todo list it keeps (Hermes' todo: the whole list), a task or issue tracker
    const todos = Array.isArray(s.args.todos) ? s.args.todos : null;
    if (todos) return { score: 5, title: s.title || 'Its to-do list', view: boardOf(todos) };
    const tool = /(^|_)(todo|todos|task|tasks|kanban|board|trello|linear|jira|asana|issue|issues|ticket)(_|$)/.test(s.n) && !/(^|_)(sessions?|subagent|spawn|delegate|cron)/.test(s.n);
    const cmd = s.parts.find(ws => (ws[0] === 'gh' && /^(issue|project)$/.test(ws[1] || '')) || /^(linear|jira|trello|task|taskwarrior|todo\.sh|todo)$/.test(ws[0]));
    if (!tool && !cmd) return null;
    return { score: 4, title: s.title || 'On its tasks', view: listOf('board', s.title || cmd?.join(' ') || 'Tasks', '') };
  }, finish: (s, c, r) => (c.view.kind === 'text' && r.ok !== false && r.text ? { ...c.view, lines: listOf('board', '', r.text).lines } : null) },
  { app: 'chat', claim(s) {
    // a message it sends somewhere (another channel, a person): what it writes
    if (!/(^|_)(message|send_?message|send|reply|post|discord|slack|telegram|whatsapp|signal|sms|email|mail|notify)(_|$)/.test(s.n) || /search|read|list|get/.test(s.n)) return null;
    const text = s.args.message ?? s.args.text ?? s.args.content ?? s.args.body;
    if (typeof text !== 'string' || !text.trim()) return null;
    return { score: 3, title: s.title || 'Sending a message', view: { kind: 'chat', text: one(text, 600), done: true, to: one(s.args.target ?? s.args.channel ?? s.args.to ?? '', 80) } };
  } },
];
/** A to-do list as a board: each item a card in its column. */
function boardOf(todos) {
  const col = st => (/progress|doing|active|working/i.test(st) ? 'doing' : /done|complete|finished|cancel/i.test(st) ? 'done' : /review/i.test(st) ? 'review' : 'todo');
  return { kind: 'board', remote: true, board: 'its list', cards: todos.slice(0, 40).map((t, k) => ({ id: String(t?.id ?? k), title: clipLine(one(t?.content ?? t?.title ?? t?.text ?? t?.step ?? '', 160)), col: col(String(t?.status ?? '')), who: null, due: null, working: /progress|doing|active/i.test(String(t?.status ?? '')) })) };
}
/** Its plan (a run's plan.update — OpenClaw's update_plan, Hermes' todo list) as a board. */
export function planBoard(steps, title = 'Its plan') {
  const v = boardOf((steps || []).map((x, k) => (typeof x === 'string' ? { id: k, content: x } : { id: x?.id ?? k, content: x?.step ?? x?.title ?? x?.content ?? x?.text, status: x?.status })));
  return { ...v, board: one(title, 80) || 'Its plan' };
}

/**
 * What a step works on: the strongest claim — { app, title, view, score } — null for one the PC shows itself (skip), and
 * the terminal's ({ app: 'terminal' }) when no app claims it.
 */
export function recognize(raw) {
  const s = stepOf(raw);
  let best = null;
  for (const r of RECOGNIZERS) {
    let c;
    try { c = r.claim(s); } catch { c = null; }   // (one app's trouble never stops the others)
    if (c && (!best || c.score > best.score)) best = { ...c, app: r.app, r };
  }
  if (best?.skip) return null;
  if (!best) return { app: 'terminal', title: s.title || one(s.cmd, 120) || one(s.name, 60), score: 0, step: s };
  return { app: best.app, title: one(best.title || s.title || s.name, 120), view: capView(best.view), score: best.score, step: s, r: best.r };
}
/** The claim's window filled in from the step's result, or null when the result adds nothing to see. */
export function finish(claim, result) {
  if (!claim?.r?.finish || !claim.view) return null;
  try { const v = claim.r.finish(claim.step, claim, { text: String(result?.text ?? ''), ok: result?.ok }); return v ? capView(v) : null; } catch { return null; }
}
