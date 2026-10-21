// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Hermes' chat view (docs/features/agent-providers.md §9 "Drawn as Hermes Desktop draws it"): the chat window keeps its
// frame, its composer and its Sidebar; a Hermes agent's turns inside it are laid out the way Hermes' own Desktop lays them
// out. A turn is Hermes' sections in Hermes' order - its thinking ("Thought for 2s", folded once the turn ends), its words,
// and its tool calls as quiet one-line rows ("Ran ls -la /tmp", "Read notes.md"), a run of calls folded into one line that
// says what they did ("Explored 3 files, ran 5 commands"), each row opening to what it ran and what came back; a file
// edit is its own row with what it changed (+3 −1). Red only for a call that failed. Built live from Hermes' own stream
// (server/providers/hermes/native.js) and, once kept, from Hermes' stored messages (their parts) - the same drawing for
// both. The wording, the grouping and its order follow Hermes Desktop's (MIT, Nous Research; THIRD-PARTY-NOTICES.md).
import { esc } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { render } from '../chat-md.js';

export const kind = 'hermes';

// ------------------------------------------------------------------ Hermes Desktop's words for its tools
/** A tool's row title while it runs and once done (Desktop's assistant.tool.titles). */
const TITLES = {
  browser_click: ['Clicking page element', 'Clicked page element'], browser_fill: ['Filling form field', 'Filled form field'], browser_navigate: ['Opening page', 'Opened page'],
  browser_snapshot: ['Capturing page snapshot', 'Captured page snapshot'], browser_take_screenshot: ['Capturing screenshot', 'Captured screenshot'], browser_type: ['Typing on page', 'Typed on page'],
  clarify: ['Asking a question', 'Asked a question'], cronjob: ['Scheduling cron job', 'Cron job'], edit_file: ['Editing file', 'Edited file'], execute_code: ['Scripting', 'Ran code'],
  image_generate: ['Generating image', 'Generated image'], list_files: ['Listing files', 'Listed files'], memory: ['Saving to memory', 'Saved to memory'], patch: ['Patching file', 'Patched file'],
  read_file: ['Reading file', 'Read file'], search_files: ['Searching files', 'Searched files'], session_search_recall: ['Searching session history', 'Searched session history'],
  terminal: ['Running command', 'Ran command'], todo: ['Updating todos', 'Updated todos'], vision_analyze: ['Analyzing image', 'Analyzed image'], web_extract: ['Reading webpage', 'Read webpage'],
  web_search: ['Searching web', 'Searched web'], write_file: ['Editing file', 'Edited file'], delegate_task: ['Delegating task', 'Delegated task'],
};
const FILE_EDIT = new Set(['edit_file', 'patch', 'write_file']);
/** Calls that are cards of their own, not rows of a run (Desktop's CARD_TOOL_NAMES and its file edits). */
const CARD = new Set(['clarify', 'delegate_task', 'image_generate', 'manage_catalog', 'manage_connections', ...FILE_EDIT]);
/** Calls Desktop shows nowhere in the turn (its todo list lives in the composer's status stack). */
const SILENT = new Set(['react_to_message', 'todo', 'todo_list']);
/** A run's summary: one clause per kind of work, in a fixed order (Desktop's run summary). */
const CATEGORY_ORDER = ['edit', 'explore', 'search', 'read', 'browse', 'interact', 'analyze', 'run', 'delegate', 'other'];
const CATEGORY = {
  analyze: { noun: ['image', 'images'], past: 'Analyzed', present: 'Analyzing' }, browse: { noun: ['page', 'pages'], past: 'Opened', present: 'Opening' },
  delegate: { noun: ['task', 'tasks'], past: 'Delegated', present: 'Delegating' }, edit: { noun: ['file', 'files'], past: 'Edited', present: 'Editing' },
  explore: { noun: ['file', 'files'], past: 'Explored', present: 'Exploring' }, interact: { noun: ['browser action', 'browser actions'], past: 'Performed', present: 'Performing' },
  other: { noun: ['tool', 'tools'], past: 'Used', present: 'Using' }, read: { noun: ['page', 'pages'], past: 'Read', present: 'Reading' },
  run: { noun: ['command', 'commands'], past: 'Ran', present: 'Running' }, search: { noun: ['query', 'queries'], past: 'Searched', present: 'Searching' },
};
const TOOL_CATEGORY = { browser_navigate: 'browse', delegate_task: 'delegate', execute_code: 'run', list_files: 'explore', read_file: 'explore', search_files: 'explore',
  session_search_recall: 'search', terminal: 'run', vision_analyze: 'analyze', web_extract: 'read', web_search: 'search' };
const categoryOf = name => (FILE_EDIT.has(name) ? 'edit' : TOOL_CATEGORY[name] || (name.startsWith('browser_') ? 'interact' : 'other'));
const ICON = { run: 'terminal', explore: 'doc', edit: 'pencil', search: 'search', read: 'globe', browse: 'globe', interact: 'globe', analyze: 'picture', delegate: 'robot', other: 'wrench' };

const parse = a => { if (a && typeof a === 'object') return a; try { const j = JSON.parse(a || '{}'); return j && typeof j === 'object' ? j : {}; } catch { return {}; } };
const first = (o, keys) => { for (const k of keys) if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim(); return ''; };
const compact = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const basename = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
const hostOf = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return compact(u, 40); } };
const firstUrl = o => { const v = o.url || (Array.isArray(o.urls) ? o.urls[0] : ''); return typeof v === 'string' ? v : ''; };
/** A shell command as a row names it: its first line, compacted (Desktop's summarizeShellCommand, in short). */
const shell = c => compact(String(c || '').split('\n').find(l => l.trim()) || '', 160);
const titleCase = n => String(n || 'tool').replace(/^mcp_+/, '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
const dur = ms => (!Number.isFinite(ms) ? '' : ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : ms < 60000 ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);

/** One call's row title, as Desktop words it: the action and what it acted on ("Ran ls -la /tmp", "Read notes.md"). */
export function toolTitle(p) {
  const args = parse(p.args), done = !!p.done, verb = (a, b) => (done ? b : a);
  const name = p.name;
  // (a file edit's row is its file's name, as Desktop's - what changed is in its diff and +/−)
  if (FILE_EDIT.has(name)) { const path = first(args, ['path', 'file_path', 'target_file', 'filename']); if (path) return basename(path); }
  if (name === 'terminal' || name === 'execute_code') {
    const cmd = shell(first(args, ['command', 'code']) || p.ctx);
    if (cmd) return `${name === 'execute_code' ? verb('Running code', 'Ran code') : verb('Running', 'Ran')} ${name === 'execute_code' ? '' : cmd}`.trim();
  }
  if (name === 'read_file') { const t = first(args, ['path', 'file', 'filepath']) || p.ctx; if (t) return `${verb('Reading', 'Read')} ${basename(t)}`; }
  if (name === 'web_search') { const q = first(args, ['query', 'search_term']) || p.ctx; if (q) return `${verb('Searching', 'Searched')} “${compact(q, 48)}”`; }
  if (name === 'web_extract') { const u = firstUrl(args); if (u) return `${verb('Reading', 'Read')} ${hostOf(u)}`; }
  if (name === 'browser_navigate') { const u = firstUrl(args); if (u) return `${p.done && p.ok === false ? 'Failed to open' : verb('Opening', 'Opened')} ${hostOf(u)}`; }
  if (FILE_EDIT.has(name)) { const f = first(args, ['path', 'file', 'filepath']) || p.ctx; if (f) return `${verb('Editing', 'Edited')} ${basename(f)}`; }
  const t = TITLES[name];
  if (t) return done ? t[1] : t[0];
  return done ? titleCase(name) : `Running ${titleCase(name)}`;
}
/** What one call acted on, as a run's summary names a lone one. */
function target(p, cat) {
  const args = parse(p.args);
  if (cat === 'run') return shell(first(args, ['command', 'code']) || p.ctx);
  if (cat === 'search') { const q = first(args, ['query', 'search_term']); return q ? `“${compact(q, 48)}”` : ''; }
  if (cat === 'read' || cat === 'browse') return firstUrl(args) ? hostOf(firstUrl(args)) : '';
  const path = first(args, ['path', 'file', 'filepath']);
  return path ? basename(path) : first(args, ['query', 'url']);
}
const failed = p => p.done && (p.blocked || (p.ok === false && !!p.err));
/** A run of calls as the one grey line that stands in for it ("Explored 3 files, ran 5 commands"); live: the kind of the
 *  call under way speaks in the present. */
export function summarize(tools, live) {
  const narrating = live ? (tools.find(t => !t.done) || tools.at(-1)) : null;
  const liveCat = narrating ? categoryOf(narrating.name) : null;
  const by = new Map();
  for (const t of tools) { const c = categoryOf(t.name); if (!by.has(c)) by.set(c, []); by.get(c).push(t); }
  const clauses = CATEGORY_ORDER.filter(c => by.has(c)).map(c => {
    const list = by.get(c), copy = CATEGORY[c], v = c === liveCat ? copy.present : copy.past;
    const n = list.reduce((sum, t) => sum + (t.name === 'web_extract' && Array.isArray(parse(t.args).urls) ? Math.max(1, parse(t.args).urls.length) : 1), 0);
    const tg = n === 1 && c !== 'interact' ? target(list[0], c) : '';
    return tg && (c === liveCat || c !== 'run') ? `${v} ${tg}` : `${v} ${n} ${copy.noun[n === 1 ? 0 : 1]}`;
  });
  const bad = tools.filter(failed).length;
  if (bad) clauses.push(`${bad} failed`);
  return clauses.map((t, i) => (i ? t.charAt(0).toLowerCase() + t.slice(1) : t)).join(', ');
}

// ------------------------------------------------------------------ the live turn, from Hermes' own stream
/** A run's view state, made when the run starts. */
export function startRun(R) { R.hv = { items: [], t0: Date.now(), status: null }; }
/** One operation of Hermes' stream (native.js) into the run's sections. */
export function onNative(R, op) {
  if (!R.hv) startRun(R);
  const hv = R.hv, now = Date.now();
  const closeThink = () => { const last = hv.items.at(-1); if (last && last.t === 'think' && !last.t1) last.t1 = now; };
  if (op.op === 'seg') {
    closeThink();
    hv.items.push({ t: op.k, at: op.at, t0: now });
    hv.status = null;
  } else if (op.op === 'tool') {
    let p = hv.items.find(x => x.t === 'tool' && x.id === op.id);
    if (!p) { closeThink(); p = { t: 'tool', id: op.id, name: op.name, t0: now }; hv.items.push(p); }
    if (op.ph === 'start') Object.assign(p, op.ctx ? { ctx: op.ctx } : {}, op.args ? { args: op.args } : {});
    else Object.assign(p, { done: true, ok: op.ok !== false, ms: op.ms }, ...['exit', 'out', 'diff', 'err', 'blocked'].filter(k => op[k] !== undefined).map(k => ({ [k]: op[k] })));
    hv.status = null;
  } else if (op.op === 'ask') (hv.asks = hv.asks || {})[op.id] = op;
  else if (op.op === 'status') hv.status = op.text ? { kind: op.kind || '', text: op.text, at: now } : null;
  else if (op.op === 'todo') hv.todo = { items: op.items || [], rev: op.rev };
}
/** The live turn as kept parts (history's shape): each section's words cut from the run's text and reasoning by where
 *  the next one begins. */
export function partsOf(R) {
  const items = R.hv ? R.hv.items : [], out = [];
  const nextAt = (k, i) => { for (let j = i + 1; j < items.length; j++) if (items[j].t === k) return items[j].at; return undefined; };
  items.forEach((x, i) => {
    if (x.t === 'text') { const text = R.text.slice(x.at, nextAt('text', i)); if (text.trim()) out.push({ t: 'text', text }); }
    else if (x.t === 'think') { const text = R.thinking.slice(x.at, nextAt('think', i)); if (text.trim()) out.push({ t: 'think', text, ms: x.t1 ? x.t1 - x.t0 : null, open: !x.t1 }); }
    else out.push({ ...x });
  });
  // (words that came before any section said where it begins: shown, never lost)
  if (!items.some(x => x.t === 'text') && R.text.trim()) out.push({ t: 'text', text: R.text });
  return out;
}
/** What the live turn showed so far, kept above a message the person sends while it works; the turn goes on from where it
 *  is (an open section continues from here). */
export function cut(R) {
  const parts = partsOf(R).map(p => (p.t === 'think' ? { ...p, open: false } : p));
  if (R.hv) {
    const last = R.hv.items.at(-1);
    R.hv.items = last && (last.t === 'text' || last.t === 'think') ? [{ ...last, at: last.t === 'text' ? R.text.length : R.thinking.length }] : [];
  }
  return parts;
}

// ------------------------------------------------------------------ drawing
/** The turn's parts as Desktop groups them: words and thinking as they come, card calls on their own, the other calls in
 *  runs (Desktop's splitRunItems); silent calls nowhere. */
function blocks(parts) {
  const out = [];
  let run = null;
  parts.forEach((p, i) => {
    if (p.t !== 'tool') { run = null; out.push({ k: `${p.t}${i}`, p }); return; }
    if (SILENT.has(p.name)) return;
    if (CARD.has(p.name)) { run = null; out.push({ k: `card:${p.id}`, p, card: true }); return; }
    if (!run) { run = { k: `run:${p.id}`, run: [] }; out.push(run); }
    run.run.push(p);
  });
  return out;
}
function thinkHtml(p, live) {
  const label = p.open ? 'Thinking…' : !live ? 'Thought' : Number.isFinite(p.ms) && p.ms >= 1500 ? `Thought for ${Math.round(p.ms / 1000)}s` : 'Thought briefly';
  return `<details class="hv-think${p.open ? ' live' : ''}"${live ? ' open' : ''}><summary>${esc(label)}</summary><div class="hv-think-t" data-noicon>${esc(p.text.trim())}</div></details>`;
}
function outBody(p) {
  const args = parse(p.args), bits = [];
  if (p.name === 'terminal') { const c = first(args, ['command']) || p.ctx; if (c) bits.push(`<pre class="hv-cmd" data-noicon><span class="hv-ps">$</span> ${esc(c)}${Number.isFinite(p.exit) ? `<span class="hv-exit${p.exit ? ' bad' : ''}">exit ${p.exit}</span>` : ''}</pre>`); }
  else if (p.name === 'execute_code') { const c = first(args, ['code']); if (c) bits.push(`<pre class="hv-code" data-noicon>${esc(c)}</pre>`); }
  else if ((p.ctx || p.args) && !(FILE_EDIT.has(p.name) && p.diff)) bits.push(`<div class="hv-args" data-noicon>${esc(p.ctx || compact(p.args, 600))}</div>`);
  if (p.err && (p.ok === false || p.blocked)) bits.push(`<div class="hv-err" data-noicon>${esc(p.err)}</div>`);
  if (p.diff) bits.push(diffHtml(p.diff));
  else if (p.out && p.out.trim()) bits.push(`<pre class="hv-out" data-noicon>${esc(p.out)}</pre>`);
  return bits.join('');
}
/** An edit's diff as Desktop shows it: the changed lines and their context, removed red, added green - no file headers,
 *  no hunk markers, no +/− signs. */
function diffHtml(diff) {
  const lines = String(diff).split('\n').filter(l => !/^(---|\+\+\+|@@|diff |index |\\ No newline)/.test(l));
  while (lines.length && !lines.at(-1)) lines.pop();
  return `<pre class="hv-diff" data-noicon>${lines.slice(0, 400).map(l => `<span class="${/^\+/.test(l) ? 'add' : /^-/.test(l) ? 'del' : ''}">${esc(l.replace(/^[+\- ]/, '')) || ' '}</span>`).join('')}</pre>`;
}
const diffStats = diff => { let a = 0, d = 0; for (const l of String(diff || '').split('\n')) { if (/^\+(?!\+\+)/.test(l)) a++; else if (/^-(?!--)/.test(l)) d++; } return { a, d }; };
function rowHtml(p, live) {
  const bad = failed(p), cat = categoryOf(p.name);
  const st = p.diff ? diffStats(p.diff) : null;
  const tail = `${st && (st.a || st.d) ? `<span class="hv-stat"><b class="add">+${st.a}</b> <b class="del">−${st.d}</b></span>` : ''}${live && p.done && Number.isFinite(p.ms) ? `<span class="hv-dur">${dur(p.ms)}</span>` : ''}${!p.done ? '<span class="hv-spin" aria-hidden="true"></span>' : ''}`;
  const body = p.done ? outBody(p) : '';
  // (an edit with its diff starts open, as Desktop's)
  const open = FILE_EDIT.has(p.name) && p.done && !!p.diff && !bad;
  return `<details class="hv-tool${bad ? ' bad' : ''}${p.done ? '' : ' live'}${open ? ' edit' : ''}" data-tool="${esc(p.id)}"${open ? ' open' : ''}><summary><span class="hv-ic" aria-hidden="true">${bad ? icon('x-circle') : icon(FILE_EDIT.has(p.name) ? 'doc' : ICON[cat] || 'wrench')}</span><span class="hv-tt" data-noicon>${esc(toolTitle(p))}</span>${tail}</summary>${body ? `<div class="hv-tb">${body}</div>` : ''}</details>`;
}
function runHtml(tools, live) {
  if (tools.length === 1) return rowHtml(tools[0], live);
  const going = live && tools.some(t => !t.done);
  return `<details class="hv-run${going ? ' live' : ''}"><summary><span class="hv-tt" data-noicon>${esc(summarize(tools, going))}</span>${going ? '<span class="hv-spin" aria-hidden="true"></span>' : ''}</summary><div class="hv-rows">${tools.map(t => rowHtml(t, live)).join('')}</div></details>`
    + (going ? `<div class="hv-ticker">${rowHtml(tools.find(t => !t.done) || tools.at(-1), live)}</div>` : '');
}
/** Hermes' questions once answered: each question and what was answered, no row (Desktop's settled clarify). */
function clarifyHtml(p) {
  if (!p.done) return '';
  const qs = (Array.isArray(parse(p.args).questions) ? parse(p.args).questions : []);
  let res = []; try { const j = JSON.parse(p.out || '{}'); res = Array.isArray(j.responses) ? j.responses : []; } catch { /* plain text */ }
  const rows = (res.length ? res : qs).map((x, i) => {
    const q = x.question || qs[i]?.question || '', a = x.user_response ?? x.answer ?? '';
    return q ? `<div class="hv-qa"><div class="hv-q" data-noicon>${esc(q)}</div><div class="hv-a" data-noicon>${esc(String(a || (x.status === 'skipped' ? 'Skipped' : '-')))}</div></div>` : '';
  }).join('');
  return rows ? `<div class="hv-widget hv-clarify">${rows}</div>` : '';
}
function cardHtml(p, live, sid) {
  if (p.name === 'clarify') return clarifyHtml(p);
  if (p.name === 'delegate_task') return delegHtml(p, sid);
  return rowHtml(p, live);
}
/** Drawn parts, keyed (the live turn replaces a block only when what it shows changed); sid: the chat they are in (its
 *  subagents fill a delegation's card). */
export function blockList(parts, { live = false, sid = null } = {}) {
  return blocks(parts).map(b => {
    if (b.run) return { k: b.k, html: runHtml(b.run, live) };
    if (b.card) return { k: b.k, html: cardHtml(b.p, live, sid) };
    if (b.p.t === 'think') return { k: b.k, html: thinkHtml(b.p, live) };
    return { k: b.k, text: String(b.p.text).replace(/^\s+/, '') };
  });
}
/** The files a turn edited - one each, in the order first touched, the +/− of all its edits summed (Desktop's changed
 *  files: only edits that landed with a diff). */
function changedFiles(parts) {
  const by = new Map();
  for (const p of parts) {
    if (p.t !== 'tool' || !FILE_EDIT.has(p.name) || !p.done || !p.diff || failed(p)) continue;
    const a = parse(p.args), path = first(a, ['path', 'file_path', 'target_file', 'filename']);
    if (!path) continue;
    const st = diffStats(p.diff), f = by.get(path) || { path, name: basename(path), a: 0, d: 0, ids: [] };
    f.a += st.a; f.d += st.d; f.ids.push(p.id); by.set(path, f);
  }
  return [...by.values()];
}
/** "1 file changed" closing the last answer once it has settled, as Desktop's: each file and its +/−; Review (or a file)
 *  opens its edits in the turn. */
function filesHtml(parts) {
  const files = changedFiles(parts);
  if (!files.length) return '';
  return `<div class="hv-widget hv-files"><div class="hv-files-h"><span>${files.length === 1 ? '1 file changed' : `${files.length} files changed`}</span><button type="button" class="hv-files-r" data-a="hv-review">Review</button></div>
    ${files.map(f => `<button type="button" class="hv-file" data-a="hv-file" data-tools="${esc(f.ids.join(' '))}" title="${esc(f.path)}"><span class="hv-ic" aria-hidden="true">${icon('doc')}</span><span class="hv-file-n" data-noicon>${esc(f.name)}</span><span class="hv-stat"><b class="add">+${f.a}</b> <b class="del">−${f.d}</b></span></button>`).join('')}</div>`;
}
/** A kept answer's turn, drawn whole (last: the chat's latest answer, settled - it closes with the files it changed). */
export function answerHtml(m, { last = false, sid = null } = {}) {
  const parts = Array.isArray(m.meta?.parts) ? m.meta.parts : [{ t: 'text', text: m.text || '' }];
  return blockList(parts, { sid }).map(b => (b.text !== undefined ? `<div class="cw-md hv-text" data-noicon>${render(b.text).html}</div>` : b.html)).join('') + (last ? filesHtml(parts) : '');
}
/** Brings the live turn's drawing up to date, touching only what changed: earlier blocks are compared whole, the words
 *  being written from their first changed paragraph on. */
export function updateFlow(box, R) {
  const list = blockList(partsOf(R), { live: true, sid: R.session ?? null });
  const have = new Map([...box.children].map(el => [el.dataset.k, el]));
  let prev = null;
  for (const b of list) {
    let el = have.get(b.k);
    if (b.text !== undefined) {
      if (!el || !el.classList.contains('hv-text')) { const n = document.createElement('div'); n.className = 'cw-md hv-text'; n.dataset.noicon = ''; n.dataset.k = b.k; if (el) el.replaceWith(n); el = n; }
      if (el._t !== b.text) {
        el._t = b.text;
        const tpl = document.createElement('template');
        tpl.innerHTML = render(b.text).html;
        const fresh = [...tpl.content.childNodes], old = [...el.childNodes];
        let k = 0;
        while (k < old.length && k < fresh.length && old[k].isEqualNode(fresh[k])) k++;
        for (const n of old.slice(k)) n.remove();
        el.append(...fresh.slice(k));
      }
    } else if (!el || el._h !== b.html) {
      const n = document.createElement('div');
      n.dataset.k = b.k; n.className = 'hv-blk'; n.innerHTML = b.html; n._h = b.html;
      // (a row or run the person opened stays open as it is drawn again)
      if (el) { for (const d of el.querySelectorAll('details[open]')) { const key = d.dataset.tool; const twin = key ? n.querySelector(`details[data-tool="${CSS.escape(key)}"]`) : d.classList.contains('hv-run') ? n.querySelector('details.hv-run') : null; if (twin) twin.open = true; } el.replaceWith(n); }
      el = n;
    }
    have.delete(b.k);
    if ((prev ? prev.nextElementSibling : box.firstElementChild) !== el) { if (prev) prev.after(el); else box.prepend(el); }
    prev = el;
  }
  for (const el of have.values()) el.remove();
}
/** The live turn's last line: Hermes' status (a retry and its countdown, compacting…) and how long it has been at it. */
// The status row under the live turn, as Desktop's turn activity: a pulse, Hermes' status words when it has some (a retry
// and its countdown, compacting…) and a clock - shown only when there is such a status or the turn has been quiet for 2 s
// (the clock counting from then); never while Hermes waits for the person, nor while a call shows its own progress.
const QUIET_MS = 2000;
export function footHtml(R) {
  const st = R.hv && R.hv.status;
  return `<div class="hv-act" role="status" hidden><span class="hv-pulse" aria-hidden="true"></span>${st && st.text ? `<span class="hv-act-l" data-noicon>${esc(st.text)}</span>` : ''}<span class="hv-act-t"></span></div>`;
}
/** Written each second by the window's own timer (waiting: an approval or a question of the turn waits for the person). */
export function tick(live, R, waiting = false) {
  const el = live.querySelector('.hv-act');
  if (!el) return;
  const hv = R.hv || (R.hv = { items: [], t0: Date.now(), status: null }), now = Date.now();
  const sig = `${R.text.length}|${R.thinking.length}|${hv.items.length}|${(hv.items.filter(x => x.t === 'tool' && x.done)).length}`;
  if (hv.sig !== sig) { hv.sig = sig; hv.lastAct = now; }
  const quiet = now - (hv.lastAct || now) >= QUIET_MS;
  const calling = hv.items.some(x => x.t === 'tool' && !x.done && !SILENT.has(x.name));
  const active = !waiting && !calling && (!!(hv.status && hv.status.text) || quiet);
  el.hidden = !active;
  if (active) el.querySelector('.hv-act-t').textContent = dur(Math.max(0, now - (quiet ? hv.lastAct : (R.t0 || now)))).replace(/\.\d/, '').replace(/^\d+ms$/, '0s');
}
/** Esc while a turn runs stops it (and pauses the queue), as Desktop's - not while it waits for the person. */
export function escape(ctx) {
  if (!ctx.busy() || ctx.blocking()) return false;
  stop(ctx);
  return true;
}

// ------------------------------------------------------------------ the composer while Hermes works (Desktop's)
// While a turn runs: Enter with words redirects the turn (Hermes' session.redirect: it stops at a safe point and goes on
// with the correction, which shows under what was written so far); Ctrl/Cmd+Enter - and anything Hermes can't take into
// the turn (files, a slash command, a turn waiting for an approval or an answer) - waits in the queue above the composer,
// sent by itself when the turn ends; Enter on an empty composer stops it. Stop pauses the queue ("Queued - paused") until
// Resume, Send now, or an edit. Each queued message: delete, edit (back into the composer), steer now (into the running
// turn), send now (now if idle; else first in line, the running turn stopped to reach it).
const MOD = () => (/Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl');
const qOf = ctx => ctx.queue();
const steerable = (text, files) => !!text.trim() && !files.length && !text.trim().startsWith('/');
/** Enter, Ctrl/Cmd+Enter (ctrl), the send button (button) or the queue button (queue). */
export function submit(ctx, { ctrl = false, button = false, queue = false } = {}) {
  const text = ctx.text(), files = ctx.files(), payload = !!text.trim() || files.length > 0;
  if (ctx.uploading()) return;
  // (a command runs now, whatever the turn - as Desktop's; with files it is a message)
  if (!files.length && isSlash(text) && !queue && !ctrl) { ctx.take(); runSlash(ctx, text); return; }
  if (!ctx.busy()) { if (payload) ctx.send({}); return; }
  if (!payload) { if (!ctrl && !queue) stop(ctx); return; }
  // (words while Hermes waits on its question: they are the answer "none of these" - the question is skipped and the
  // words go into the turn, as Desktop's; an approval, a password or a secret can't be answered by words: they queue)
  const asked = ctx.waiting();
  if (!ctrl && !queue && steerable(text, files) && asked.clarify.length && !asked.others) { skipThenRedirect(ctx, asked.clarify); return; }
  if (ctrl || queue || !steerable(text, files) || ctx.blocking()) { enqueue(ctx); return; }
  ctx.send({ redirect: true });
  void button;
}
async function skipThenRedirect(ctx, ids) {
  const item = ctx.take();
  if (!item) return;
  await Promise.all(ids.map(id => ctx.answer(id, null).catch(() => {})));
  if (ctx.busy()) ctx.send({ item, redirect: true }); else ctx.send({ item });
}
function enqueue(ctx) {
  const q = qOf(ctx), item = ctx.take();
  if (!item) return;
  q.items.push({ id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: item.text, files: item.files });
  ctx.paint();
}
/** Stop (the button, an empty Enter): the turn stops and the queue waits (parked) until resumed. */
export function stop(ctx) {
  const q = qOf(ctx);
  if (q.items.length) q.parked = true;
  ctx.stop();
  ctx.paint();
}
/** The turn ended: the next queued message goes, unless the queue is paused. */
export function afterRun(ctx) {
  const q = qOf(ctx);
  if (ctx.busy() || q.parked || !q.items.length) return;
  const item = q.items.shift();
  ctx.paint();
  go(ctx, item);
}
/** A queued message goes: a command runs, anything else is sent. */
function go(ctx, item, o = {}) { if (!item.files.length && !item.display && isSlash(item.text)) runSlash(ctx, item.text); else ctx.send({ item, ...o }); }
/** A click in the queue panel. */
export function queueAction(ctx, act, id, el) {
  const q = qOf(ctx), k = q.items.findIndex(x => x.id === id), item = q.items[k];
  const ui = uiOf(q);
  if (act === 'sec') { const sec = el.dataset.sec; ui.open[sec] = !(ui.open[sec] ?? defaultOpen(sec, ctx)); ctx.paint(); return; }
  if (act === 'ridge') { ui.hidden = !ui.hidden; ctx.paint(); return; }
  if (act === 'sub') { ui.sub = ui.sub === id ? null : id; ctx.paint(); return; }
  if (act === 'agents') { ctx.openTasks(); return; }
  if (act === 'ctl-menu') { controlMenu(ctx, el.dataset.ctl, el); return; }
  if (act === 'ctl-details') { goalDetails(ctx); return; }
  if (act === 'ctl-rm') { const i = Number(el.dataset.i); ctx.confirm({ title: `Remove criterion ${i + 1}?`, body: `Are you sure you want to remove criterion ${i + 1}?`, yes: `Remove criterion ${i + 1}` }).then(ok => { if (ok) controlAction(ctx, 'subgoal.remove', { index: i + 1 }); }); return; }   // (Hermes numbers criteria from 1, as its Desktop)
  if (act === 'sub-stop') { ctx.stopTask(id); return; }
  if (act === 'sub-steer') {
    const text = (ui.drafts[id] || '').trim();
    if (!text) return;
    el.disabled = true;
    ctx.steer(id, text).then(ok => { if (ok) { ui.drafts[id] = ''; ctx.toast('Queued for its next step'); } }).finally(() => { el.disabled = false; ctx.paint(); });
    return;
  }
  if (act === 'resume') { q.parked = false; ctx.paint(); afterRun(ctx); return; }
  if (!item) return;
  if (act === 'delete') q.items.splice(k, 1);
  else if (act === 'edit') { q.items.splice(k, 1); q.parked = false; ctx.put(item); }
  else if (act === 'steer' && ctx.busy() && steerable(item.text, item.files)) { q.items.splice(k, 1); ctx.send({ item, redirect: true }); }
  else if (act === 'send') {
    q.items.splice(k, 1); q.parked = false;
    if (ctx.busy()) { q.items.unshift(item); ctx.stop(); } else go(ctx, item);
  } else if (act === 'more') item.open = !item.open;
  ctx.paint();
  // (as Desktop's queue: nothing running and not paused, what waits goes)
  if (!ctx.busy() && !q.parked && q.items.length) afterRun(ctx);
}
// ------------------------------------------------------------------ the status stack above the composer (Desktop's)
// Hermes' todo list - "Tasks 2/5", open while a turn runs, each item done (a check), under way (a spinner) or to do (a
// dashed ring); once the turn ends, "Previous tasks 2/5", folded -, its live subagents - "2 Subagents" (folded): each its
// goal, what it does now and how long it has run, opening to a box to steer it ("Instructions for this subagent") and
// Stop; Agents opens the side panel's Tasks -, then the queue. A ridge on its top edge hides or shows the whole stack.
// Sections start folded except the todo list; a section the person opened or folded stays so for the chat.
const LIVE = new Set(['running', 'queued']);
const uiOf = q => (q.ui = q.ui || { open: {}, hidden: false, sub: null, drafts: {} });
const defaultOpen = sec => sec === 'todo';   // (Desktop's: the todo list open; the goal, loop and heartbeat folded)
const ago = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
// (each chat's subagents as the page knows them - chat id → list: the strip and the turn's delegation cards both read them;
// two windows may each show a Hermes chat)
const SUBS = new Map();
const subsOf = sid => SUBS.get(sid) || [];
function section(ctx, sec, label, iconName, body, { indicator = '', acc = '', tone = '' } = {}) {
  const ui = uiOf(qOf(ctx)), open = ui.open[sec] ?? defaultOpen(sec, ctx);
  return `<section class="hv-sec${open ? ' open' : ''}${acc ? ' acc' : ''}" data-sec="${sec}"><button type="button" class="hv-sec-h" data-qa="sec" data-sec="${sec}" aria-expanded="${open}"><span class="hv-sec-chev" aria-hidden="true">${icon('caret-right')}</span><span class="hv-ic${tone ? ` ${tone}` : ''}" aria-hidden="true">${icon(iconName)}</span><span class="hv-sec-l">${esc(label)}</span>${!open ? indicator : ''}</button>${acc}${open ? `<div class="hv-sec-b">${body}</div>` : ''}</section>`;
}
// ------------------------------------------------------------------ the session's goal, loop and heartbeat (Desktop's)
// Hermes' session control - /goal (a standing goal it works on turn after turn until a judge says it is done), /loop (a
// prompt run again on a cadence), /heartbeat (a prompt that comes back when the chat is idle) - first in the status
// stack, as Desktop's: each a section saying how it stands ("Goal active · Turn 3/20", "Loop active · Run 1/3 · next
// ~29m", "Heartbeat active · every 45m · next 00:44:59"), folded; open, what it is (the goal and its criteria, the loop's
// prompt and cadence …); its ⋯ menu Desktop's actions (pause, resume, resume now, add a criterion, details, clear / stop -
// asked first). Read when the chat opens (session.control.read), followed live (session.control.update), changed through
// Hermes' own session.control. A resumed goal sends its continuation as the person's next message (queued while busy).
const CONTROL = new Map();   // (chat id → Hermes' control snapshot)
const CTL_SECS = ['goal', 'loop', 'heartbeat'];
const ms = t => (t > 1e11 ? t : t * 1000);
const approx = t => { if (!t) return ''; const d = ms(t) - Date.now(); if (d <= 0) return '~0s'; const sec = Math.round(d / 1000); if (sec < 60) return `~${sec}s`; const m = Math.round(sec / 60); if (m < 60) return `~${m}m`; const h = Math.round(m / 60); return h < 24 ? `~${h}h` : `~${Math.round(h / 24)}d`; };
const countdown = t => { const r = Math.max(0, Math.ceil((ms(t) - Date.now()) / 1000)), d = Math.floor(r / 86400), p = v => String(v).padStart(2, '0'); const c = `${p(Math.floor((r % 86400) / 3600))}:${p(Math.floor((r % 3600) / 60))}:${p(r % 60)}`; return d > 0 ? `${d}d ${c}` : c; };
const every = sec => (!Number.isFinite(sec) ? '' : sec % 3600 === 0 ? `every ${sec / 3600}h` : sec % 60 === 0 ? `every ${sec / 60}m` : `every ${sec}s`);
const row = (iconName, html, cls = '') => `<div class="hv-ctl-row${cls ? ` ${cls}` : ''}">${iconName ? `<span class="hv-ic" aria-hidden="true">${icon(iconName)}</span>` : '<span class="hv-ic"></span>'}<span data-noicon>${html}</span></div>`;
const menuBtn = (sec, label) => `<button type="button" class="hv-sec-acc" data-qa="ctl-menu" data-ctl="${sec}" title="${esc(label)}" aria-label="${esc(label)}" aria-haspopup="menu">⋯</button>`;
export function setControl(sid, control) {
  // (the latest word, whichever way it came - Hermes' updated_at goes back when an item is cleared: no ordering by it)
  if (sid === null || sid === undefined) return;
  CONTROL.set(sid, control || null);
}
function goalHtml(ctx, g) {
  const waiting = !!g.wait_barrier, st = waiting ? 'waiting' : g.status;
  const state = g.last_verdict === 'blocked' ? 'Goal blocked' : st === 'waiting' ? 'Goal waiting' : st === 'paused' ? 'Goal paused' : st === 'done' ? 'Goal done' : 'Goal active';
  const label = st === 'done' ? `${state} · ${g.turns_used} turn${g.turns_used === 1 ? '' : 's'}` : g.max_turns > 0 ? `${state} · Turn ${g.turns_used}/${g.max_turns}` : g.turns_used > 0 ? `${state} · Turn ${g.turns_used}` : state;
  const tone = g.last_verdict === 'blocked' ? 'red' : st === 'done' ? 'muted' : st === 'active' ? 'green' : 'amber';
  const w = g.wait_barrier;
  const body = [row('flag', esc(g.title), 'title'),
    w ? row('', esc(w.reason ? `Wait condition: ${w.reason}` : 'Wait condition')) : '',
    !w && g.paused_reason ? row('', esc(g.paused_reason)) : '',
    g.last_reason && (g.last_verdict === 'blocked' || g.last_verdict === 'wait' || st !== 'active') ? row('', esc(g.last_reason)) : '',
    `<button type="button" class="hv-ctl-link" data-qa="ctl-details">${icon('eye')}<span>View details</span></button>`,
    g.subgoals.length ? `<div class="hv-ctl-crit"><div class="hv-ctl-ch">Criteria · ${g.subgoals.length}</div>${g.subgoals.map((c, i) => `<div class="hv-ctl-ci"><span class="hv-ctl-n">${i + 1}.</span><span data-noicon>${esc(c)}</span><button type="button" class="cw-ic" data-qa="ctl-rm" data-i="${i}" title="Remove criterion ${i + 1}" aria-label="Remove criterion ${i + 1}">×</button></div>`).join('')}</div>` : ''].join('');
  return section(ctx, 'goal', label, 'target', body, { acc: menuBtn('goal', 'Goal actions'), tone });
}
function loopHtml(ctx, l) {
  const state = l.deferred_by_goal ? 'Loop deferred' : l.status === 'paused' ? 'Loop paused' : l.status === 'done' ? 'Loop finished' : l.awaiting_response ? 'Loop active · Awaiting response' : 'Loop active';
  const runs = l.times > 0 ? `Run ${l.ticks_fired}/${l.times}` : `${l.ticks_fired} run${l.ticks_fired === 1 ? '' : 's'}`;
  const next = l.status === 'active' && !l.deferred_by_goal && l.next_due_at ? ` · next ${approx(l.next_due_at)}` : '';
  const tone = l.status === 'done' ? 'muted' : l.status === 'paused' || l.deferred_by_goal ? 'amber' : 'green';
  const body = [row('chat', esc(l.prompt), 'title'), row('clock', `Cadence: ${esc(l.mode === 'self_paced' ? 'self-paced' : every(l.interval_seconds))}`),
    l.until ? row('flag', `Until condition: ${esc(l.until)}`) : '', l.deferred_by_goal ? row('', 'An active goal currently controls the session.') : ''].join('');
  return section(ctx, 'loop', `${state} · ${runs}${next}`, 'cycle', body, { acc: menuBtn('loop', 'Loop actions'), tone });
}
function heartbeatHtml(ctx, h) {
  const due = (h.last_fired_at || h.created_at || 0) + (h.interval_seconds || 0), isDue = h.status === 'active' && ms(due) <= Date.now();
  const next = h.status === 'active' ? ` · ${isDue ? 'due - waiting for idle' : `next <span data-until="${ms(due)}">${countdown(due)}</span>`}` : '';
  const tone = h.status === 'paused' ? 'red' : isDue ? 'amber' : 'green';
  const body = [row('chat', esc(h.prompt), 'title'), row('', `Fired ${h.fire_count} time${h.fire_count === 1 ? '' : 's'}`)].join('');
  const label = `${h.status === 'paused' ? 'Heartbeat paused' : 'Heartbeat active'} · ${every(h.interval_seconds)}`;
  // (the countdown ticks: written as HTML into the label after it is escaped)
  return section(ctx, 'heartbeat', label, 'pulse', body, { acc: menuBtn('heartbeat', 'Heartbeat actions'), tone }).replace(`${esc(label)}</span>`, `${esc(label)}${next}</span>`);
}
function controlHtml(ctx) {
  const c = CONTROL.get(ctx.sessionId());
  if (!c) return [];
  const out = [];
  if (c.goal) out.push(goalHtml(ctx, c.goal));
  if (c.loop) out.push(loopHtml(ctx, c.loop));
  if (c.heartbeat) out.push(heartbeatHtml(ctx, c.heartbeat));
  if (out.length) tickSince(true);
  return out;
}
/** One of Hermes' control actions; a resumed goal's continuation goes as the person's next message. */
async function controlAction(ctx, action, args = {}) {
  let r;
  try { r = await ctx.native('session.control', { action, args }); }
  catch (e) { ctx.toast(`Action failed: ${e.message}`, 'bad'); return; }
  setControl(ctx.sessionId(), r.control);
  const d = r.dispatch || {};
  if (d.type === 'send' && d.message) {
    const item = { id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: d.message, files: [], ...(d.display ? { display: d.display } : {}) };
    if (ctx.busy()) { qOf(ctx).items.push(item); ctx.toast('Goal resumed - continuation queued until the current turn finishes'); }
    else ctx.send({ item });
  }
  ctx.paint();
}
function controlMenu(ctx, sec, anchor) {
  const c = CONTROL.get(ctx.sessionId()) || {}, act = (a, args) => () => controlAction(ctx, a, args);
  const ask = (title, body, yes, a) => () => ctx.confirm({ title, body, yes }).then(ok => { if (ok) controlAction(ctx, a); });
  let items = [];
  if (sec === 'goal' && c.goal) {
    const g = c.goal, waiting = !!g.wait_barrier;
    items = [{ label: 'View details', run: () => goalDetails(ctx) }, { label: 'Add criterion', run: () => addCriterion(ctx) },
      ...(waiting ? [{ label: 'Resume now', run: act('goal.unwait') }, { label: 'Pause goal', run: act('goal.pause') }]
        : g.status === 'active' ? [{ label: 'Pause goal', run: act('goal.pause') }] : g.status === 'paused' ? [{ label: 'Resume goal', run: act('goal.resume') }] : []),
      ...(g.subgoals.length ? [{ label: 'Clear all criteria', danger: true, run: ask('Clear all criteria?', 'Are you sure you want to remove all criteria from this goal?', 'Clear all criteria', 'subgoal.clear') }] : []),
      { label: 'Clear goal', danger: true, run: ask('Clear goal?', 'Are you sure you want to clear the active goal? This cannot be undone.', 'Clear goal', 'goal.clear') }];
  } else if (sec === 'loop' && c.loop) {
    const l = c.loop;
    items = [...(l.status === 'active' ? [{ label: 'Pause loop', run: act('loop.pause') }] : l.status === 'paused' ? [{ label: 'Resume loop', run: act('loop.resume') }] : []),
      l.status === 'done' ? { label: 'Dismiss loop', run: act('loop.stop') } : { label: 'Stop loop', danger: true, run: ask('Stop loop?', 'Are you sure you want to stop this loop?', 'Stop loop', 'loop.stop') }];
  } else if (sec === 'heartbeat' && c.heartbeat) {
    const h = c.heartbeat;
    items = [h.status === 'active' ? { label: 'Pause heartbeat', run: act('heartbeat.pause') } : { label: 'Resume heartbeat', run: act('heartbeat.resume') },
      { label: 'Clear heartbeat', danger: true, run: ask('Clear heartbeat?', 'Are you sure you want to clear this heartbeat?', 'Clear heartbeat', 'heartbeat.clear') }];
  }
  if (items.length) ctx.menu(anchor, items);
}
function goalDetails(ctx) {
  const g = (CONTROL.get(ctx.sessionId()) || {}).goal;
  if (!g) return;
  const k = g.contract || {}, field = (l, v) => (v ? `<div class="hv-gd-f"><div class="hv-gd-l">${esc(l)}</div><div data-noicon>${esc(v)}</div></div>` : '');
  ctx.overlay(`<div class="hv-dlg hv-gd" role="dialog" aria-label="Goal details"><div class="hv-dlg-h">Goal details</div>
    ${field('Objective', g.title)}${field('Outcome', k.outcome)}${field('Verification', k.verification)}${field('Constraints', k.constraints)}${field('Boundaries', k.boundaries)}${field('Stop when', k.stop_when)}
    ${g.wait_barrier ? field('Wait condition', g.wait_barrier.type === 'until' ? `Waiting until ${new Date(ms(g.wait_barrier.until_at)).toLocaleString()}` : g.wait_barrier.type === 'session' ? `Waiting on session ${g.wait_barrier.target}` : `Waiting on process ${g.wait_barrier.target}`) : ''}
    ${g.gates.length ? `<div class="hv-gd-f"><div class="hv-gd-l">Quality gates</div>${g.gates.map(x => `<div class="hv-gd-g"><code data-noicon>${esc(x.command)}</code><span>${x.attempts ?? 0}/${x.max_retries ?? 0} attempts · ${x.timeout_seconds ?? 0}s timeout · ${x.last_exit_code === null || x.last_exit_code === undefined ? 'Pending' : `Exit code: ${x.last_exit_code}`}</span></div>`).join('')}</div>` : ''}
    ${g.subgoals.length ? `<div class="hv-gd-f"><div class="hv-gd-l">Criteria · ${g.subgoals.length}</div>${g.subgoals.map((c, i) => `<div data-noicon>${i + 1}. ${esc(c)}</div>`).join('')}</div>` : ''}
    <div class="hv-dlg-b"><button type="button" class="btn small primary" data-a="hv-dlg-close">Close</button></div></div>`, 'goal-details');
}
function addCriterion(ctx) {
  ctx.overlay(`<div class="hv-dlg" role="dialog" aria-label="Add criterion"><div class="hv-dlg-h">Add criterion</div><p class="hv-dlg-p">Enter criterion text...</p>
    <input class="input hv-ctl-in" maxlength="2000" placeholder="Enter criterion text..." aria-label="Criterion">
    <div class="hv-dlg-b"><button type="button" class="btn small" data-a="hv-dlg-close">Cancel</button><button type="button" class="btn small primary" data-a="hv-ctl-add">Add</button></div></div>`, 'goal-criterion');
}
function todoRows(steps, live) {
  return steps.map(x => {
    const st = x.status === 'completed' ? 'done' : x.status === 'in_progress' ? (live ? 'now' : 'paused') : 'todo';
    return `<div class="hv-todo ${st}"><span class="hv-todo-ic" aria-hidden="true">${st === 'done' ? icon('check-circle') : st === 'now' ? '<span class="hv-spin"></span>' : ''}</span><span data-noicon>${esc(x.step)}</span></div>`;
  }).join('');
}
function subRow(ctx, t) {
  const ui = uiOf(qOf(ctx)), open = ui.sub === t.id;
  return `<div class="hv-sub${open ? ' open' : ''}" data-q="${esc(t.id)}"><button type="button" class="hv-sub-row" data-qa="sub"><span class="hv-spin purple" aria-label="${t.status === 'queued' ? 'Queued' : 'Running'}"></span>
      <span class="hv-sub-t"><b data-noicon>${esc(t.title || 'Subagent')}</b><small data-noicon>${esc(t.lastActivity || t.progressSummary || (t.status === 'queued' ? 'Queued' : 'Waiting for activity…'))}</small></span>
      <span class="hv-since" data-since="${Number(t.startedAt || t.createdAt || Date.now())}">${ago(Date.now() - (t.startedAt || t.createdAt || Date.now()))}</span></button>
    ${open ? `<div class="hv-sub-d"><input class="input hv-sub-in" data-sub="${esc(t.id)}" maxlength="4000" placeholder="Instructions for this subagent" aria-label="Instructions for this subagent"><button type="button" class="btn small" data-qa="sub-steer">Steer</button><button type="button" class="btn small hv-btn-text" data-qa="sub-stop">Stop</button></div>` : ''}</div>`;
}
/** The status stack above the composer (nothing in it: nothing). */
export function queueHtml(ctx) {
  const q = qOf(ctx), ui = uiOf(q), busy = ctx.busy(), out = [...controlHtml(ctx)];
  SUBS.set(ctx.sessionId(), ctx.subs());
  const plan = ctx.plan(), steps = plan && Array.isArray(plan.steps) ? plan.steps : [];
  if (steps.length) {
    const done = steps.filter(x => x.status === 'completed').length, running = busy && steps.some(x => x.status === 'in_progress');
    out.push(section(ctx, busy ? 'todo' : 'prev', busy ? `Tasks ${done}/${steps.length}` : `Previous tasks ${done}/${steps.length}`, 'clipboard', todoRows(steps, busy), { indicator: running ? '<span class="hv-spin"></span>' : '' }));
  }
  const live = subsOf(ctx.sessionId()).filter(t => LIVE.has(t.status));
  if (live.length) out.push(section(ctx, 'subs', `${live.length} Subagent${live.length === 1 ? '' : 's'}`, 'robot', `<div class="hv-subs">${live.map(t => subRow(ctx, t)).join('')}</div><button type="button" class="btn small hv-btn-text hv-agents" data-qa="agents">Agents</button>`, { indicator: '<span class="hv-spin purple"></span>' }));
  const queued = queueRows(ctx, busy);
  if (queued) out.push(queued);
  if (!out.length) return '';
  tickSince(live.length > 0);
  return `<button type="button" class="hv-ridge" data-qa="ridge" title="${ui.hidden ? 'Show status stack' : 'Hide status stack'}" aria-label="${ui.hidden ? 'Show status stack' : 'Hide status stack'}" aria-expanded="${!ui.hidden}"></button>${ui.hidden ? '' : `<div class="hv-stack">${out.join('')}</div>`}`;
}
/** After the stack is drawn again: what the person was typing to a subagent stays, and its focus. */
export function restore(el, ctx) {
  const ui = uiOf(qOf(ctx));
  for (const i of el.querySelectorAll('.hv-sub-in')) {
    i.value = ui.drafts[i.dataset.sub] || '';
    i.oninput = () => { ui.drafts[i.dataset.sub] = i.value; };
    i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); i.parentElement.querySelector('[data-qa="sub-steer"]').click(); } };
    if (ui.focus === i.dataset.sub) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    i.onfocus = () => { ui.focus = i.dataset.sub; }; i.onblur = () => { if (ui.focus === i.dataset.sub) ui.focus = null; };
  }
}
let sinceTimer = null;
function tickSince(on) {
  if (on && !sinceTimer) sinceTimer = setInterval(() => {
    const els = document.querySelectorAll('[data-since]'), until = document.querySelectorAll('[data-until]');
    if (!els.length && !until.length && !document.querySelector('.hv-sec[data-sec="loop"], .hv-sec[data-sec="goal"]')) { clearInterval(sinceTimer); sinceTimer = null; return; }
    for (const e of els) e.textContent = ago(Date.now() - Number(e.dataset.since));
    for (const e of until) e.textContent = countdown(Number(e.dataset.until));
  }, 1000);
}
/** The chat's subagents changed (a task event, or read again): the strip and every delegation card on the page. */
export function onTasks(ctx) {
  const sid = ctx.sessionId();
  SUBS.set(sid, ctx.subs());
  for (const el of ctx.root().querySelectorAll('.chatwin .hv-deleg[data-tool]')) {
    const p = DELEG.get(el.dataset.tool);
    if (p) { const html = delegHtml(p, sid); if (el.outerHTML !== html) el.outerHTML = html; }
  }
}
function queueRows(ctx, busy) {
  const q = qOf(ctx);
  if (!q.items.length) return '';
  return `<div class="hv-q-h"><span class="hv-ic" aria-hidden="true">${icon('layers')}</span><span>${q.items.length} Queued${q.parked ? ' - paused' : ''}</span>${q.parked ? '<button type="button" class="btn small" data-qa="resume" title="Paused by Stop - resume sending the queued turns">Resume</button>' : ''}</div>`
    + q.items.map(x => {
      const words = (x.display || x.text).trim() || (x.files.length ? 'Attachment-only turn' : 'Empty turn');
      const long = words.length > 140 || words.includes('\n');
      return `<div class="hv-q-row${x.open ? ' open' : ''}" data-q="${esc(x.id)}"><button type="button" class="cw-ic hv-q-x" data-qa="delete" title="Delete" aria-label="Delete">${icon('x')}</button>
        <div class="hv-q-t" data-noicon>${esc(words)}${x.files.length ? `<span class="hv-q-f">${x.files.map(f => `<span class="hv-ic" aria-hidden="true">${icon('doc')}</span>${esc(f.name)}`).join(' ')}</span>` : ''}</div>
        <span class="hv-q-acts">${long ? `<button type="button" class="cw-ic" data-qa="more" title="${x.open ? 'Collapse' : 'Expand'}" aria-label="${x.open ? 'Collapse' : 'Expand'}">${icon(x.open ? 'caret-up' : 'caret-down')}</button>` : ''}
        <button type="button" class="cw-ic" data-qa="edit" title="Edit" aria-label="Edit">${icon('pencil')}</button>
        ${busy && steerable(x.text, x.files) ? `<button type="button" class="cw-ic" data-qa="steer" title="Steer the current run with it" aria-label="Steer now">${icon('nav')}</button>` : ''}
        <button type="button" class="cw-ic" data-qa="send" title="${busy ? 'Send now (stops the current turn)' : 'Send now'}" aria-label="Send now">${icon('return')}</button></span></div>`;
    }).join('');
}

// ------------------------------------------------------------------ a delegation in the turn (Desktop's)
// delegate_task as the fan-out it is: one row per child - its goal and the model running it, its time while it works,
// one ticking line of what it does; a check once done, a dot once sent to the background, red when it failed. Its live
// state is the chat's subagents (the same the strip shows); its goal opens the side panel's Tasks.
const DELEG = new Map();   // (tool call id → its part: a card drawn again when its children change)
function delegRows(p, sid) {
  const args = parse(p.args), res = parse(p.out);
  const goals = Array.isArray(args.tasks) && args.tasks.length ? args.tasks.map((t, i) => (parse(t).goal || `Task ${i + 1}`)) : args.goal ? [String(args.goal)] : Array.isArray(res.goals) ? res.goals.map(String) : [];
  const done = Array.isArray(res.results) ? res.results.map(parse) : [];
  const idle = !p.done ? 'running' : res.status === 'dispatched' ? 'dispatched' : 'completed';
  const unclaimed = [...subsOf(sid)];
  return goals.map((goal, i) => {
    const e = done[i], k = unclaimed.findIndex(t => t.title === goal), t = k >= 0 ? unclaimed.splice(k, 1)[0] : null;
    const status = t ? (LIVE.has(t.status) ? 'running' : t.status === 'completed' ? 'completed' : 'failed') : e ? (!e.status || /^(ok|completed)$/.test(e.status) ? 'completed' : 'failed') : idle;
    const dur = t && t.startedAt && t.endedAt ? (t.endedAt - t.startedAt) / 1000 : e && Number.isFinite(e.duration_seconds) ? e.duration_seconds : null;
    return { goal, status, id: t ? t.id : null, model: (t && t.model) || (e && e.model) || '', dur, since: t && (t.startedAt || t.createdAt),
      activity: (t && (LIVE.has(t.status) ? t.lastActivity || t.progressSummary : t.terminalSummary || t.lastActivity)) || (e && e.summary) || '' };
  });
}
function delegHtml(p, sid) {
  DELEG.set(p.id, p);
  const glyph = st => (st === 'running' ? '<span class="hv-breathe" aria-label="Running"></span>' : st === 'failed' ? `<span class="hv-ic bad" aria-label="Failed">${icon('x-circle')}</span>` : st === 'dispatched' ? '<span class="hv-dot" aria-label="Sent to the background"></span>' : `<span class="hv-ic ok" aria-label="Done">${icon('check-circle')}</span>`);
  return `<div class="hv-deleg" data-tool="${esc(p.id)}">${delegRows(p, sid).map(r => `<div class="hv-dl-row"><div class="hv-dl-h">${glyph(r.status)}
      <button type="button" class="hv-dl-goal" data-a="hv-deleg-open"${r.id ? ` data-task="${esc(r.id)}"` : ''} data-noicon>${esc(r.goal)}</button>
      ${[r.model, r.status !== 'running' && Number.isFinite(r.dur) ? dur(r.dur * 1000) : ''].filter(Boolean).length ? `<span class="hv-dl-meta" data-noicon>${esc([r.model, r.status !== 'running' && Number.isFinite(r.dur) ? dur(r.dur * 1000) : ''].filter(Boolean).join(' · '))}</span>` : ''}
      ${r.status === 'running' && r.since ? `<span class="hv-since hv-dl-time" data-since="${Number(r.since)}">${ago(Date.now() - r.since)}</span>` : ''}<span class="hv-ic hv-dl-ag" aria-hidden="true">${icon('robot')}</span></div>
      ${r.activity ? `<div class="hv-dl-act${r.status === 'running' ? ' shimmer' : ''}" data-noicon>${esc(String(r.activity).split('\n').filter(Boolean).pop() || '')}</div>` : ''}</div>`).join('')}</div>`;
}
/** The send button and the composer's words while it works (Desktop: Send with words, Stop without; Queue message beside). */
export function sendLook(ctx) {
  const busy = ctx.busy(), payload = !!ctx.text().trim() || ctx.files().length > 0;
  return { stop: busy && !payload, queue: busy && payload,
    title: !busy ? 'Send (Enter)' : payload ? (steerable(ctx.text(), ctx.files()) && !ctx.blocking() ? 'Redirect the answer with this (Enter)' : 'Queue it for after this turn (Enter)') : 'Stop (Enter on an empty message)',
    placeholder: busy ? `Redirect it (Enter), queue (${MOD()}+Enter), or stop…` : null };
}

// ------------------------------------------------------------------ what waits for the person (Desktop's panels)
// An approval: one card under the turn - "Command" (or "Command details" for a rule's label), what it would run, then
// Reject · Always allow… ▾ (Allow this session, Always allow…, Reject) · Run; Always allow asks first, as Desktop's
// dialog does (it goes into Hermes' permanent allowlist). Several waiting: one at a time, "1 / 2". Hermes' questions
// (clarify): its widget - "0 of 2 answered", each question, its choices lettered A, B… (its preferred one marked
// "(Recommended)"), "Other (type your answer)", or a box for a question without choices; Skip and "Confirm and continue"
// under it (Confirm once anything is answered; letters and 1–9 pick, inside the card). A sudo password or a secret:
// Desktop's dialog over the window - "Administrator password" with the command it is for, or the variable a secret goes
// into - Cancel or Send; the value goes to Hermes only, never shown back.
const RECOMMENDED = /\s*\(Recommended\)\s*$/i;
const letter = i => String.fromCharCode(65 + i);
const SYNTHETIC = /^<[^>]+> \(/;
function apprCard(a, n, total) {
  const cmd = String(a.command || '').trim(), details = !cmd || SYNTHETIC.test(cmd);
  const more = a.options.includes('allow-session') || a.options.includes('allow-always');
  return `<div class="hv-appr" data-appr-id="${esc(a.id)}" tabindex="0" role="group" aria-label="Approval needed">
    <div class="hv-appr-h"><span class="hv-ic" aria-hidden="true">${icon('terminal')}</span><span>${details ? 'Command details' : 'Command'}</span>${total > 1 ? `<span class="hv-appr-n">${n} / ${total}</span>` : ''}</div>
    <pre class="hv-appr-cmd" data-noicon>${esc(details ? (a.summary || cmd || a.title || '') : cmd)}</pre>
    <div class="hv-appr-b"><button type="button" class="btn small hv-btn-text" data-a="appr-dec" data-dec="deny">Reject</button>
      ${more ? `<button type="button" class="btn small" data-a="hv-appr-more" aria-haspopup="menu" title="More approval options">Always allow… <span class="hv-chev" aria-hidden="true">${icon('chevdown')}</span></button>` : ''}
      <button type="button" class="btn small primary" data-a="appr-dec" data-dec="allow-once">Run <span class="hv-kbd" aria-hidden="true">${icon('return')}</span></button></div></div>`;
}
function clarifyCard(q) {
  return `<div class="hv-cl" data-qid="${esc(q.id)}"><div class="hv-widget hv-cl-w"><div class="hv-cl-prog">0 of ${q.questions.length} answered</div>
    ${q.questions.map(x => {
      const opts = x.options.map((o, i) => `<button type="button" class="hv-cl-o" data-a="hv-q-opt" aria-pressed="false" data-label="${esc(o.label)}"><span class="hv-cl-k">${letter(i)}</span><span data-noicon>${esc(o.label.replace(RECOMMENDED, ''))}${RECOMMENDED.test(o.label) ? ' <i>(Recommended)</i>' : ''}</span></button>`).join('');
      const free = x.options.length ? (x.other ? `<label class="hv-cl-other"><span class="hv-cl-k">${letter(x.options.length)}</span><textarea class="hv-cl-text" rows="1" maxlength="2000" placeholder="Other (type your answer)"></textarea></label>` : '')
        : '<textarea class="hv-cl-text solo" rows="1" maxlength="2000" placeholder="Type your answer…"></textarea>';
      return `<div class="hv-cl-q" data-q="${esc(x.questionId)}" data-multi="${x.multiSelect ? 1 : 0}"><div class="hv-cl-t" data-noicon>${esc(x.question)}</div>${opts}${free}</div>`;
    }).join('')}</div>
    <div class="hv-cl-acts"><button type="button" class="btn small hv-btn-text" data-a="hv-q-skip">Skip</button><button type="button" class="btn small primary" data-a="hv-q-send" disabled>Confirm and continue</button></div></div>`;
}
/** The panels of the live turn that wait for the person; returns { appr, qs } markup for the window's parts. Unchanged
 *  while it waits (what the person picks or types lives in the page, never drawn over). */
export function panels(R, ctx) {
  const waiting = (R.approvals || []).filter(a => a.options && ctx.apprState(a.id) === 'pending');
  const appr = waiting.length ? `<div class="hv-apprs">${apprCard(waiting[0], 1, waiting.length)}</div>` : '';
  const qs = (R.questions || []).filter(q => q.status === 'pending' && !q.questions.some(x => x.secret)).map(clarifyCard).join('');
  // (a sudo password or a secret: a dialog over the window)
  const secret = (R.questions || []).find(q => q.status === 'pending' && q.questions.some(x => x.secret));
  ctx.overlay(secret ? secretDialog(secret, (R.hv && R.hv.asks && R.hv.asks[secret.id]) || {}) : null, secret ? `q:${secret.id}` : null);
  return { appr, qs };
}
function secretDialog(q, ask) {
  const sudo = ask.kind === 'sudo' || q.questions[0].header === 'Password';
  const title = sudo ? 'Administrator password' : ask.env || 'Secret required';
  const desc = sudo ? (ask.desc || 'Review the command before entering your sudo password. Your password is sent to the agent running it and cached for this session.') : (ask.prompt || 'Hermes needs a credential to continue.');
  return `<div class="hv-dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}" data-qid="${esc(q.id)}"><div class="hv-dlg-h"><span class="hv-ic" aria-hidden="true">${icon(sudo ? 'lock' : 'key')}</span><b data-noicon>${esc(title)}</b></div>
    <p class="hv-dlg-d" data-noicon>${esc(desc)}</p>
    ${sudo ? (ask.command ? `<div class="hv-dlg-f"><span>Command</span><pre data-noicon>${esc(ask.command)}</pre></div>` : '<p class="hv-dlg-d warn">This agent did not provide the command. Cancel if you cannot verify it in the conversation.</p>') : ''}
    <input type="password" class="input hv-dlg-in" autocomplete="off" placeholder="${esc(sudo ? 'sudo password' : ask.env || 'secret value')}" aria-label="${esc(title)}">
    <div class="hv-dlg-b"><button type="button" class="btn small" data-a="hv-dlg-cancel">Cancel</button><button type="button" class="btn small primary" data-a="hv-dlg-send">Send</button></div></div>`;
}
/** The answers a clarify card holds now: { qid: [choices and words] } for each question answered. */
function staged(card) {
  const out = {};
  for (const el of card.querySelectorAll('.hv-cl-q')) {
    const picked = [...el.querySelectorAll('.hv-cl-o[aria-pressed="true"]')].map(b => b.dataset.label);
    const text = el.querySelector('.hv-cl-text')?.value.trim();
    const list = [...picked, ...(text ? [text] : [])];
    if (list.length) out[el.dataset.q] = el.dataset.multi === '1' ? list : [list[list.length - 1]];
  }
  return out;
}
function progress(card) {
  const n = Object.keys(staged(card)).length, total = card.querySelectorAll('.hv-cl-q').length;
  card.querySelector('.hv-cl-prog').textContent = `${n} of ${total} answered`;
  card.querySelector('[data-a="hv-q-send"]').disabled = n === 0;
}
/** A click on one of the view's own controls (data-a="hv-…"). */
export function click(ctx, b) {
  const a = b.dataset.a;
  if (a === 'hv-dlg-close' && b.closest('.hv-ovl')?.querySelector('.hv-gd, .hv-ctl-in')) { ctx.overlay(null); return; }
  if (a === 'hv-ctl-add') { const t = b.closest('.hv-dlg').querySelector('.hv-ctl-in').value.trim(); if (!t) return; ctx.overlay(null); controlAction(ctx, 'subgoal.add', { text: t }); return; }
  if (a === 'hv-deleg-open') { ctx.openTasks(); return; }
  if (messageClick(ctx, b)) return;
  if (a === 'hv-q-opt') {
    const q = b.closest('.hv-cl-q'), on = b.getAttribute('aria-pressed') !== 'true';
    if (q.dataset.multi !== '1') { q.querySelectorAll('.hv-cl-o').forEach(x => x.setAttribute('aria-pressed', 'false')); const t = q.querySelector('.hv-cl-text'); if (t && on) t.value = ''; }
    b.setAttribute('aria-pressed', String(on));
    progress(b.closest('.hv-cl'));
  } else if (a === 'hv-q-send' || a === 'hv-q-skip') {
    const card = b.closest('.hv-cl');
    card.querySelectorAll('button, textarea').forEach(x => { x.disabled = true; });
    ctx.answer(card.dataset.qid, a === 'hv-q-skip' ? null : staged(card)).catch(() => { card.querySelectorAll('button, textarea').forEach(x => { x.disabled = false; }); progress(card); });
  } else if (a === 'hv-appr-more') {
    const card = b.closest('.hv-appr'), id = card.dataset.apprId;
    ctx.menu(b, [{ label: 'Allow this session', run: () => ctx.approve(id, 'allow-session', b) },
      { label: 'Always allow…', run: () => confirmAlways(ctx, card, b) },
      { label: 'Reject', danger: true, run: () => ctx.approve(id, 'deny', b) }]);
  } else if (a === 'hv-dlg-send' || a === 'hv-dlg-cancel') {
    const d = b.closest('.hv-dlg'), v = d.querySelector('.hv-dlg-in').value;
    if (a === 'hv-dlg-send' && !v) { d.querySelector('.hv-dlg-in').focus(); return; }
    d.querySelectorAll('button, input').forEach(x => { x.disabled = true; });
    ctx.answer(d.dataset.qid, a === 'hv-dlg-cancel' ? null : { value: [v] }).catch(() => d.querySelectorAll('button, input').forEach(x => { x.disabled = false; }));
  }
}
function confirmAlways(ctx, card, b) {
  const cmd = card.querySelector('.hv-appr-cmd').textContent;
  ctx.confirm({ title: 'Always allow this command?', body: `This adds the pattern to your permanent allowlist (~/.hermes/config.yaml). Hermes won’t ask again for commands like this - in this session or any future one.`,
    code: cmd, yes: 'Always allow' }).then(ok => { if (ok) ctx.approve(card.dataset.apprId, 'allow-always', b); });
}
/** Typing in a clarify box counts as an answer (a single-choice question's choice is let go); keys inside a clarify
 *  card pick its choices (A, B… or 1–9, in the question in focus or the first unanswered); Enter in a dialog sends. */
export function input(ctx, el) {
  if (el.classList.contains('hv-cl-text')) {
    const q = el.closest('.hv-cl-q');
    if (q.dataset.multi !== '1' && el.value.trim()) q.querySelectorAll('.hv-cl-o').forEach(x => x.setAttribute('aria-pressed', 'false'));
    progress(el.closest('.hv-cl'));
  }
}
export function key(ctx, e) {
  const card = e.target.closest?.('.hv-cl'), dlg = e.target.closest?.('.hv-dlg'), appr = e.target.closest?.('.hv-appr');
  // (editing a message: Enter sends it from that point, Esc lets it be)
  if (e.target.classList?.contains('hv-edit-in')) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.closest('.cw-msg').querySelector('[data-a="hv-edit-send"]').click(); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.target.closest('.cw-msg').querySelector('[data-a="hv-edit-cancel"]').click(); return true; }
    return false;
  }
  if (dlg && e.key === 'Enter') { e.preventDefault(); dlg.querySelector('[data-a="hv-dlg-send"], [data-a="hv-ctl-add"], .primary[data-a="hv-dlg-close"]')?.click(); return true; }
  if (dlg && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dlg.querySelector('[data-a="hv-dlg-cancel"], [data-a="hv-dlg-close"]')?.click(); return true; }
  if (appr && e.key === 'Enter' && e.target === appr) { e.preventDefault(); appr.querySelector('[data-dec="allow-once"]').click(); return true; }
  if (!card || e.target.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return false;
  const k = e.key.toLowerCase(), idx = /^[1-9]$/.test(k) ? Number(k) - 1 : k.length === 1 && k >= 'a' && k <= 'z' ? k.charCodeAt(0) - 97 : -1;
  if (idx < 0) return false;
  const qs = [...card.querySelectorAll('.hv-cl-q')];
  const done = Object.keys(staged(card));
  const q = e.target.closest('.hv-cl-q') || qs.find(x => !done.includes(x.dataset.q)) || qs[0];
  const opts = [...q.querySelectorAll('.hv-cl-o')];
  if (idx < opts.length) { e.preventDefault(); opts[idx].click(); return true; }
  if (idx === opts.length) { const t = q.querySelector('.hv-cl-text'); if (t) { e.preventDefault(); t.focus(); return true; } }
  return false;
}

// ------------------------------------------------------------------ a message's actions (Desktop's)
// The person's message: Edit message (in place: Hermes' record goes back to before it and the new words go from there),
// Restore checkpoint (asked first: everything after it goes and it runs again from there), Copy. An answer: Branch in new
// chat (the chat up to it, copied into a new one Hermes names), Copy, Read aloud, and on the last one Refresh (written
// again from the person's last message). Going back waits for the turn under way to end.
export function userHtml(m, { editing, busy }) {
  const files = (m.meta?.attachments || []).map(f => `<span class="cw-file"><span data-noicon>${esc(f.name)}</span></span>`).join('');
  if (editing) return `<div class="cw-msg user editing" data-id="${m.id}"><textarea class="cw-edit-in input hv-edit-in" aria-label="Edit message">${esc(m.text)}</textarea>
    <div class="cw-edit-acts"><button type="button" class="btn small" data-a="hv-edit-cancel">Cancel</button><button type="button" class="btn small primary" data-a="hv-edit-send">Send</button></div></div>`;
  const can = !busy && Number.isInteger(m.meta?.row);
  return `<div class="cw-msg user" data-id="${m.id}">${files ? `<div class="cw-files">${files}</div>` : ''}${m.text ? `<div class="cw-bubble" data-noicon>${esc(m.text)}</div>` : ''}
    <div class="cw-mact">${can ? `<button type="button" class="cw-ic" data-a="hv-edit" title="Edit message" aria-label="Edit message">${icon('pencil')}</button><button type="button" class="cw-ic" data-a="hv-restore" title="Restore checkpoint - rerun from this prompt" aria-label="Restore checkpoint">${icon('undo')}</button>` : ''}<button type="button" class="cw-ic" data-a="copy" title="Copy" aria-label="Copy">⧉</button></div></div>`;
}
export function actionsHtml(m, { last, busy, read, meta, caps }) {
  const branch = caps.branch && Number.isInteger(m.meta?.upto) && !busy;
  return `<div class="cw-mact">${branch ? `<button type="button" class="cw-ic" data-a="hv-branch" title="Branch in new chat" aria-label="Branch in new chat">${icon('arrow-ur')}</button>` : ''}<button type="button" class="cw-ic" data-a="copy" title="Copy" aria-label="Copy">⧉</button>${read}${last && caps.rewind && !busy ? `<button type="button" class="cw-ic" data-a="hv-refresh" title="Refresh" aria-label="Refresh">${icon('rotate')}</button>` : ''}${meta}</div>`;
}
/** Back to before message `m`, then `text` from there - a skill's command expanded again into the skill's words (the
 *  message still shows the command). */
async function rewindTo(ctx, m, text) {
  if (isSlash(text) && ctx.manages()) {
    const { name, arg } = parseSlash(text);
    if (resolve(`/${name}`, lastCatalog(ctx)).exec) {
      try {
        const d = await ctx.native('command.dispatch', { name, arg });
        if ((d.type === 'skill' || d.type === 'send') && String(d.message || '').trim()) { ctx.rewind(m, d.message, d.display || text); return; }
      } catch { /* not a skill: sent as written */ }
    }
  }
  ctx.rewind(m, text);
}
function messageOf(ctx, b) { const el = b.closest('.cw-msg'); return el && el.dataset.id !== undefined ? ctx.message(Number(el.dataset.id)) : null; }
export function messageClick(ctx, b) {
  const a = b.dataset.a, m = messageOf(ctx, b);
  if (!m) return false;
  if (a === 'hv-edit') { ctx.edit(m.id); return true; }
  if (a === 'hv-edit-cancel') { ctx.edit(null); return true; }
  if (a === 'hv-edit-send') { const t = b.closest('.cw-msg').querySelector('.hv-edit-in').value.trim(); if (t) rewindTo(ctx, m, t); return true; }
  if (a === 'hv-restore') {
    ctx.confirm({ title: 'Restore to this checkpoint?', body: 'Everything after this prompt is removed from the conversation, and the prompt runs again from here.', yes: 'Restore & rerun' })
      .then(ok => { if (ok) rewindTo(ctx, m, m.text); });
    return true;
  }
  if (a === 'hv-refresh') { const all = ctx.messages(), k = all.indexOf(m), u = all.slice(0, k).reverse().find(x => x.role === 'user'); if (u) rewindTo(ctx, u, u.text); return true; }
  if (a === 'hv-branch') { ctx.branch(m.meta.upto); return true; }
  if (a === 'hv-review' || a === 'hv-file') {
    // (Desktop's Review opens its diff pane: here, the turn's own edit cards - opened, the first brought into view)
    const box = b.closest('.cw-msg'), ids = a === 'hv-file' ? b.dataset.tools.split(' ') : null;
    const cards = [...box.querySelectorAll('details.hv-tool.edit, details.hv-tool[data-tool]')].filter(d => (ids ? ids.includes(d.dataset.tool) : d.classList.contains('edit')));
    for (const d of cards) { d.open = true; d.closest('details.hv-run')?.setAttribute('open', ''); }
    cards[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }
  return false;
}

/** A chat's age in the Sidebar, as Desktop's list says it: now, 3m, 2h, 4d, then the date. */
export function since(ms) {
  if (!Number.isFinite(ms)) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : s < 7 * 86400 ? `${Math.floor(s / 86400)}d` : new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ------------------------------------------------------------------ slash commands and @references (Desktop's)
// A message beginning with / is a command, run as Hermes Desktop runs it - never sent to the model as words, and at once,
// even while a turn runs: a few by the window itself (/new, /branch, /model, /resume), the rest through the call Hermes
// has for them (/status, /save, /compress, /title, /reasoning, /yolo, /stop, /help, /btw, /bg) or by Hermes itself
// (slash.exec; a skill, a quick command or a plugin's through command.dispatch - whose message then goes as the person's,
// shown as the command). What a command says is a quiet line in the conversation ("/status · …"), kept for the page's
// life as Desktop keeps it for its window's; a side question's (/btw) or a background task's (/bg) answer comes there
// later. A command Hermes marks as not for its Desktop (the terminal's, messaging platforms'…) says so instead, and is not
// suggested, nor are Desktop's own (its pets, its wake word, its skins). Typing / suggests Hermes' commands (its catalog
// by category for a bare /, else complete.slash: commands, skills, a command's options); @ suggests its references
// (complete.path: @diff, @staged, @file:…, the chat folder's files). Only for whoever manages the provider.
const SLASH_RE = /^\/[^\s/]*(?:\s|$)/;
export const isSlash = t => SLASH_RE.test(String(t || '').trim());
const parseSlash = c => { const m = /^(\S+)([\s\S]*)$/.exec(String(c).replace(/^\/+/, '')); return m ? { name: m[1].toLowerCase(), arg: m[2].trim() } : { name: '', arg: '' }; };
/** Desktop's own handling of its commands (desktop-slash-commands.ts), as far as this window has each: act - the window
 *  or a call of Hermes' does it; rpc - Hermes' own call for it; off - Desktop's alone, said so. */
const SPECS = [
  { name: '/new', desc: 'Start a new chat', aliases: ['/reset', '/clear'], act: 'new' },
  { name: '/stop', desc: 'Stop the active turn and background processes', act: 'stop' },
  { name: '/branch', desc: 'Branch the latest message into a new chat', aliases: ['/fork'], act: 'branch' },
  { name: '/yolo', desc: 'Toggle YOLO - auto-approve dangerous commands', act: 'yolo' },
  { name: '/reasoning', desc: 'Reasoning effort or display [<level> [--global]|show|hide|full|clamp]', act: 'reasoning' },
  { name: '/title', desc: 'Rename the current session', act: 'title' },
  { name: '/help', desc: 'Show slash commands', aliases: ['/commands'], act: 'help' },
  { name: '/model', desc: 'Switch the model for this session', act: 'model', hidden: true },
  { name: '/resume', desc: 'Resume a saved session', aliases: ['/sessions', '/switch'], act: 'resume' },
  { name: '/compress', desc: 'Compress this conversation context', aliases: ['/compact'], act: 'compress' },
  { name: '/btw', desc: 'Ask a side question about this conversation without interrupting it', act: 'btw' },
  { name: '/bg', desc: 'Run a prompt in a background session', aliases: ['/background'], act: 'background' },
  { name: '/save', desc: 'Save the current transcript to JSON', rpc: 'session.save' },
  { name: '/status', desc: 'Show current session status', rpc: 'session.status' },
  { name: '/wake', off: 'desktop' }, { name: '/handoff', off: 'desktop' }, { name: '/profile', off: 'profile' }, { name: '/skin', off: 'desktop' },
  { name: '/journey', aliases: ['/learning', '/memory-graph'], off: 'desktop' }, { name: '/pet', off: 'desktop' }, { name: '/hatch', aliases: ['/generate-pet'], off: 'desktop' },
  { name: '/browser', off: 'browser' }, { name: '/pets', off: 'settings' },
  { name: '/density', off: 'terminal' }, { name: '/details', off: 'terminal' }, { name: '/logs', off: 'terminal' }, { name: '/mouse', off: 'terminal' },
];
const SPEC = new Map(SPECS.map(x => [x.name, x])), ALIAS = new Map(SPECS.flatMap(x => (x.aliases || []).map(a => [a, x.name])));
const OFF = {
  desktop: c => `${c} is Hermes Desktop's own - it isn't available here.`,
  profile: c => `${c}: each Hermes profile is its own agent here - choose it in the agent menu.`,
  browser: c => `${c} manages a Chromium-family browser on the gateway host - only available when connected to a local gateway.`,
  advanced: c => `${c} is not offered here. Use Hermes' terminal interface instead.`,
  'composer-voice': () => 'Voice lives in the composer here: use its microphone button.',
  messaging: c => `${c} is only used from messaging platforms.`,
  settings: c => `${c} is managed in Hermes' own settings, not from the chat.`,
  terminal: c => `${c} is only available in the terminal interface.`,
};
const CATALOGS = new Map();   // (chat or agent → { at, catalog }: Hermes' commands, read again after a minute)
const SUGGEST = new Map();    // (a query → { at, items }: Hermes' suggestions, for a few seconds)
// (a chat's catalog adds the skills of its folder; reading it takes Hermes a moment - the agent's, when known, is used
// meanwhile, the chat's read in the background)
const fetchCatalog = async (ctx, k) => { const catalog = await ctx.native('commands.catalog', {}); CATALOGS.set(k, { at: Date.now(), catalog }); CATALOGS.set(`a${ctx.agentId()}`, { at: Date.now(), catalog }); return catalog; };
const pendingCat = new Map();
async function catalogOf(ctx) {
  const k = ctx.sessionId() ?? `a${ctx.agentId()}`, have = CATALOGS.get(k);
  if (have && Date.now() - have.at < 60000) return have.catalog;
  let p = pendingCat.get(k);
  if (!p) { p = fetchCatalog(ctx, k).finally(() => pendingCat.delete(k)); pendingCat.set(k, p); }
  const agent = CATALOGS.get(`a${ctx.agentId()}`);
  if (agent && k !== `a${ctx.agentId()}`) { p.catch(() => {}); return agent.catalog; }
  return p;
}
const lastCatalog = ctx => (CATALOGS.get(ctx.sessionId() ?? `a${ctx.agentId()}`) || CATALOGS.get(`a${ctx.agentId()}`) || {}).catalog || null;
const norm = c => { const t = String(c || '').trim(); return ((t.startsWith('/') ? t : `/${t}`).split(/\s+/, 1)[0] || '').toLowerCase(); };
function canonical(c, cat) { const n = norm(c); return ALIAS.get(n) || (cat && cat.canon && (cat.canon[n] || cat.canon[n.toLowerCase()])) || n; }
const isAlias = (c, cat) => { const n = norm(c); if (ALIAS.has(n)) return true; const r = cat && cat.canon && cat.canon[n]; return !!(r && r.toLowerCase() !== n); };
/** How a command is handled here: { act } | { rpc } | { off: reason } | { exec, hidden } (Hermes runs it). */
function resolve(c, cat) {
  const name = canonical(c, cat), local = SPEC.get(name);
  if (local) return local.off ? { name, off: local.off } : local;
  const meta = cat && cat.commands && cat.commands[name];
  if (meta && OFF[meta.desktop] && meta.desktop !== 'desktop' && meta.desktop !== 'profile' && meta.desktop !== 'browser') return { name, off: meta.desktop };
  return { name, exec: true, hidden: !!(meta && meta.desktop === 'hidden') };
}
function suggested(c, cat, exactAlias) {
  const n = norm(c);
  if (isAlias(n, cat)) return exactAlias !== undefined && norm(exactAlias) === n && !resolve(n, cat).off;
  const r = resolve(n, cat);
  return !r.off && !r.hidden;
}
// (Desktop's own words for the commands - its composer.commandDescs; "desktop chat" said "chat" here)
const DESCS = {"/help": "Show slash commands", "/clear": "start a new session", "/resume": "Resume a saved session", "/details": "control transcript detail level", "/copy": "copy selection or last assistant message", "/quit": "exit hermes", "/start": "Acknowledge platform start pings without a reply", "/new": "Start a new chat", "/topic": "Enable or inspect Telegram DM topic sessions", "/save": "Save the current transcript to JSON", "/retry": "Retry the last message (resend to agent)", "/prompt": "Compose your next prompt in $EDITOR (markdown), then send it", "/undo": "Back up N user turns and re-prompt (default 1)", "/title": "Rename the current session", "/handoff": "Hand off this session to a messaging platform", "/branch": "Branch the latest message into a new chat", "/worktree": "Show, list, create, or prune isolated git worktrees", "/compress": "Compress this conversation context", "/rollback": "List or restore filesystem checkpoints (restores keep your hand-edits; --all overrides)", "/export": "Export a profile (config, skills, theme) to a shareable archive", "/import": "Import a shared profile archive as a new profile", "/stop": "Stop the active turn and background processes", "/pause": "Pause new work globally (emergency stop); '/pause off' resumes", "/bg": "Run a prompt in a separate background session", "/btw": "Ask a side question about this conversation without interrupting it", "/agents": "Show active agents and running tasks", "/journey": "Open the memory graph - skills + memories over time", "/queue": "Queue a prompt for the next turn, or list/edit/rm/move/clear queued prompts", "/steer": "Inject a message after the next tool call without interrupting", "/goal": "Set a standing goal Hermes works on across turns until achieved", "/heartbeat": "Set a recurring prompt that re-enters this session when idle", "/refine": "Review this conversation now and save lessons to memory/skills", "/review": "Spawn an independent subagent to review the work just discussed (PR, code, docs)", "/loop": "Re-run a prompt on a recurring interval in this session", "/plan": "Write a markdown implementation plan to .hermes/plans/ without executing anything", "/moa": "Run one prompt through the default Mixture of Agents preset, then restore your model", "/subgoal": "Add or manage extra criteria on the active goal", "/status": "Show current session status", "/egress": "Show Docker egress proxy status", "/context": "Show detailed context window view with usage gauge, category breakdown, compression stats, and throughput", "/whoami": "Show your slash command access (admin / user)", "/profile": "Switch the active Hermes profile", "/codex-runtime": "Toggle codex app-server runtime for OpenAI/Codex models", "/personality": "Set a predefined personality", "/battery": "Toggle a color-coded battery indicator in the status bar", "/timestamps": "Toggle [HH:MM] timestamps on messages and /history", "/diff": "Show git changes in the working directory", "/focus": "Toggle focus view - show only your prompt and the final response", "/yolo": "Toggle YOLO - auto-approve dangerous commands", "/approvals": "Show or set the persistent dangerous-command approval mode", "/reasoning": "Reasoning effort or display [<level> [--global]|show|hide|full|clamp]", "/skin": "Switch desktop theme or cycle to the next one", "/wake": "Control the desktop wake-word listener [on|off|status]", "/tools": "Manage tools: /tools [list|disable|enable] [name...]", "/memory": "Review pending memory writes / toggle the approval gate", "/bundles": "List skill bundles (aliases /<name> for multiple skills)", "/pet": "Toggle or adopt a petdex mascot (/pet, /pet list, /pet boba)", "/hatch": "Generate a new pet (opens the pet generator)", "/learn": "Learn a reusable skill from anything you describe (dirs, URLs, this chat, notes)", "/init": "Generate or update AGENTS.md project instructions from a repo scan", "/suggestions": "Review suggested automations (accept/dismiss)", "/blueprint": "Set up an automation from a blueprint template", "/browser": "Manage browser CDP connection [connect|disconnect|status] (local gateway only)", "/palette": "Open the fuzzy command palette (also Ctrl+P)", "/usage": "Show token usage and rate limits; `reset` redeems a banked Codex limit reset", "/subscription": "View your Nous plan and change it in the browser", "/topup": "Show your Nous balance and manage billing on the portal", "/platform": "Pause, resume, or list a failing gateway platform", "/version": "Show Hermes Agent version", "/debug": "Upload debug report (system info + logs) and get shareable links", "/model": "Switch the model for this session"};
const describe = (c, fallback, cat) => { const k = canonical(c, cat), s = SPEC.get(k), d = DESCS[k] || (s && s.desc); const usage = String(fallback || '').match(/\s+\(usage:\s+(.+)\)$/s)?.[0] || ''; return d ? `${d}${usage}` : fallback || ''; };

// ---- what a command says: a quiet line in the conversation, kept for the page's life
const NOTES = new Map();   // (chat id → its lines: system messages with meta.note { cmd, kind, at: how many messages came before it })
let noteSeq = 0;
function addNote(ctx, { cmd = '', text, kind = 'slash', id = null, before = null }, sid = ctx ? ctx.sessionId() : null) {
  if (sid === null || sid === undefined || !String(text || '').trim()) return;
  const list = NOTES.get(sid) || [];
  if (id && list.some(n => n.meta.note.id === id)) return;
  const msgs = ctx ? ctx.messages() : null;
  // (after what is on the page - and after the answer being written, when one is; a side task's acknowledgement before
  // its answer, should the answer have come first)
  const next = before ? list.find(n => n.meta.note.id === before) : null;
  const at = next ? next.meta.note.at : msgs ? msgs.filter(m => !m.meta?.note).length + (ctx.busy() ? 1 : 0) : null;
  const n = { role: 'system', text: String(text).slice(0, 40000), meta: { note: { cmd, kind, at, n: next ? next.meta.note.n - 0.5 : ++noteSeq, ...(id ? { id } : {}) } } };
  list.push(n); NOTES.set(sid, list);
  if (msgs) { const k = next ? msgs.indexOf(next) : -1; if (k >= 0) msgs.splice(k, 0, n); else msgs.push(n); ctx.repaint(); }
}
/** A chat's messages with its lines among them, where each was written. */
export function withNotes(sid, messages) {
  const list = NOTES.get(sid);
  if (!list || !list.length) return messages;
  const plain = messages.filter(m => !m.meta?.note);
  for (const n of list) if (n.meta.note.at === null) n.meta.note.at = plain.length;   // (an answer that came while the chat was closed: here)
  // (a kept partial that Hermes' record has after all - the same words where it was - is not shown twice)
  const twice = n => { if (n.meta.note.kind !== 'partial') return false; const m = plain[n.meta.note.at], t = String(n.text || '').trim().slice(0, 80); return !!(m && m.role === 'assistant' && t && String(m.text || '').trim().startsWith(t)); };
  const sorted = [...list].filter(n => !twice(n)).sort((a, b) => a.meta.note.at - b.meta.note.at || a.meta.note.n - b.meta.note.n), out = [];
  let k = 0;
  plain.forEach((m, i) => { while (k < sorted.length && sorted[k].meta.note.at <= i) out.push(sorted[k++]); out.push(m); });
  while (k < sorted.length) out.push(sorted[k++]);
  return out;
}
/** What a turn wrote before the person redirected it (cut off under their correction): Hermes keeps it out of its record,
 *  Desktop keeps showing it for the window's life - kept here for the page's, where it was. */
export function kept(ctx, m) {
  const sid = ctx.sessionId();
  if (sid === null || sid === undefined) return;
  const msgs = ctx.messages(), at = msgs.filter(x => x !== m && !x.meta?.note).slice(0, Math.max(0, msgs.indexOf(m))).length;
  m.meta = { ...(m.meta || {}), note: { kind: 'partial', at, n: ++noteSeq } };
  const list = NOTES.get(sid) || [];
  list.push(m); NOTES.set(sid, list);
}
/** Gone back to before the message at `count`: the lines after it go too (as Desktop's do). */
export function dropNotesAfter(sid, count) { const list = NOTES.get(sid); if (list) NOTES.set(sid, list.filter(n => n.meta.note.at === null || n.meta.note.at <= count)); }
const linkify = s => esc(s).replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
export function noteHtml(m) {
  const n = m.meta.note, text = String(m.text || '').trim(), multi = text.includes('\n');
  if (n.kind === 'review') {
    const k = text.indexOf(':'), label = k > 0 ? text.slice(0, k).trim() : text, detail = k > 0 ? text.slice(k + 1).trim() : '';
    return `<div class="cw-msg sys hv-note review"><span class="hv-ic" aria-hidden="true">${icon('brain')}</span><span class="hv-rv-l" data-noicon>${esc(label)}</span>${detail ? `<span class="hv-rv-d" data-noicon>${esc(detail)}</span>` : ''}</div>`;
  }
  return `<div class="cw-msg sys hv-note${multi ? ' multi' : ''}${n.kind === 'side' ? ' side' : ''}">${n.cmd ? `<span class="hv-note-c" data-noicon>${esc(n.cmd)}</span>${multi ? '' : '<span class="hv-note-dot">·</span>'}` : ''}<span class="hv-note-t" data-noicon>${linkify(text)}</span></div>`;
}
/** A side question's or a background task's answer (Hermes' btw.complete / background.complete), whichever chat is open. */
export function onSide(m, ctx) {
  const ev = m.side;
  // (its goal, loop or heartbeat changed: the status stack follows)
  if (ev && ev.op === 'control') { setControl(m.session, ev.control); if (ctx) ctx.paint(); return; }
  if (!ev || ev.op !== 'side' || !String(ev.text || '').trim()) return;
  // (what Hermes' self-improvement review saved after a turn: its own line, as Desktop's memory-write row)
  if (ev.kind === 'review') { addNote(ctx, { text: ev.text.trim(), kind: 'review' }, m.session); return; }
  const head = ev.kind === 'btw' ? `[btw${ev.question ? ` "${ev.question}"` : ''}${ev.id ? ` (${ev.id})` : ''}]` : ev.id ? `[bg ${ev.id}]` : '';
  addNote(ctx, { text: head ? `${head}\n${ev.text.trim()}` : ev.text.trim(), kind: 'side', id: ev.id ? `side:${ev.id}` : null }, m.session);
}

// ---- running one
const renderRpc = (r, name) => {
  if (!r || typeof r !== 'object') return '';
  const sm = r.summary;
  if (sm && sm.headline) return [`${sm.noop ? '' : '✓ '}${sm.headline}`, sm.token_line ? `  ${sm.token_line}` : '', sm.note ? `  ${sm.note}` : ''].filter(Boolean).join('\n');
  if (Number.isInteger(r.killed)) return r.killed > 0 ? `Stopped ${r.killed} background process${r.killed === 1 ? '' : 'es'}.` : 'No background processes to stop.';
  if (r.file) return `Saved transcript to ${r.file}`;
  if (r.output) return r.output;
  return `/${name}: ${JSON.stringify(r)}`;
};
function renderCatalog(cat) {
  const keep = pairs => (pairs || []).filter(([c]) => suggested(c, cat)).map(([c, d]) => [c, describe(c, d, cat)]);
  const sections = cat.categories && cat.categories.length ? cat.categories.map(s => ({ name: s.name, pairs: keep(s.pairs) })) : [{ name: 'Commands', pairs: keep(cat.pairs) }];
  const body = sections.filter(s => s.pairs.length).map(s => [`${s.name}:`, ...s.pairs.map(([c, d]) => `${c.padEnd(18)} ${d}`)].join('\n')).join('\n\n');
  const tail = [cat.skill_count ? `${cat.skill_count} skill command${cat.skill_count === 1 ? '' : 's'} available - type / to browse them.` : '', cat.warning ? `warning: ${cat.warning}` : ''].filter(Boolean).join('\n');
  return [body || 'No commands available.', tail].filter(Boolean).join('\n\n');
}
function reasoningParams(arg) {
  let scope; const values = [];
  for (const part of arg.trim().split(/\s+/).filter(Boolean)) { const f = part.toLowerCase(); if (['--global', '-g', 'global'].includes(f)) scope = 'global'; else if (['--session', '-s', 'session'].includes(f)) scope = 'session'; else values.push(part); }
  return values.length ? { key: 'reasoning', value: values.join(' '), ...(scope ? { scope } : {}) } : null;
}
const COMPRESSING = new Set();
/** Runs a command typed into the composer (or waiting in its queue). */
export async function runSlash(ctx, text, { record = true } = {}) {
  const command = String(text).trim(), { name, arg } = parseSlash(command);
  const out = async t => { try { await ctx.ensure(); } catch { /* no chat yet: said in the toast */ } addNote(ctx, { cmd: record ? `/${name}` : '', text: t }); };
  if (!name) { await out('empty slash command'); return; }
  if (!ctx.manages()) { await out('Commands are run by whoever manages this agent\'s provider. Leave out the / to send it as a message.'); return; }
  const call = (method, params = {}) => ctx.native(method, params, { ensure: true, preview: command });
  // (the window's own commands need nothing of Hermes' to be known; any other one, its catalog - how its Desktop takes it)
  let cat = lastCatalog(ctx);
  if (!cat && !SPEC.has(ALIAS.get(`/${name}`) || `/${name}`)) { try { cat = await catalogOf(ctx); } catch { cat = null; } }
  const r = resolve(`/${name}`, cat);
  try {
    if (r.off) { await out(OFF[r.off](r.name)); return; }
    if (r.rpc) { await out(renderRpc(await call(r.rpc), name) || `/${name}: no output`); return; }
    if (r.exec) { await runExec(ctx, { name, arg, command, out, call }); return; }
    switch (r.act) {
      case 'new': ctx.newChat(); return;
      case 'branch': if (!ctx.hasProviderSession()) { await out('Nothing to branch yet.'); return; } await ctx.branch(); return;
      case 'model': if (!arg) { ctx.models(); return; } await runExec(ctx, { name, arg, command, out, call }); return;
      case 'resume': {
        if (!arg) { ctx.openChats(); return; }
        const q = arg.toLowerCase(), list = ctx.chats();
        const hit = list.find(s => s.key === arg || String(s.id) === arg) || list.find(s => String(s.label || '').toLowerCase().includes(q));
        if (hit) ctx.openChat(hit.id); else ctx.toast('No chat by that name or id', 'bad');
        return;
      }
      case 'stop': {
        const lines = [];
        try { if (ctx.busy()) stop(ctx); else await call('session.interrupt'); lines.push('Stopped the active turn.'); } catch (e) { lines.push(`Could not stop the active turn: ${e.message}`); }
        try { const x = renderRpc(await call('process.stop'), name); if (x) lines.push(x); } catch (e) { lines.push(`Could not stop background processes: ${e.message}`); }
        await out(lines.join('\n'));
        return;
      }
      case 'btw': case 'background': {
        const bg = r.act === 'background';
        if (!arg) { await out(bg ? 'Usage: /background <prompt> - the task runs in a separate session and the result appears here when done.' : 'Usage: /btw <question> - answered from a snapshot of this conversation without interrupting it.'); return; }
        const x = await call(bg ? 'prompt.background' : 'prompt.btw', { text: arg });
        await ctx.ensure();
        addNote(ctx, { cmd: `/${name}`, text: bg ? `Background task ${x.task_id ? `${x.task_id} ` : ''}started - you can continue chatting; the result will appear here when done.` : `btw ${x.task_id ? `${x.task_id} ` : ''}- answering from a conversation snapshot`,
          before: x.task_id ? `side:${x.task_id}` : null });
        return;
      }
      case 'compress': {
        const key = ctx.sessionId() ?? 'new';
        if (COMPRESSING.has(key)) return;
        COMPRESSING.add(key);
        ctx.toast(arg ? `Compressing context for: ${arg}` : 'Compressing context…');
        try {
          const x = await call('session.compress', arg ? { focus_topic: arg } : {});
          if (x.status === 'pending') { ctx.toast(x.message || 'Compression still running in the background'); return; }
          await ctx.reload();
          if (x.usage) ctx.usage(x.usage);
          if (x.summary && x.summary.headline) {
            const lines = [x.summary.headline, x.summary.token_line, x.summary.note].filter(Boolean).join('\n');
            if (!(x.status === 'aborted' || x.summary.aborted)) await out(lines);
            ctx.toast(lines, x.status === 'aborted' || x.summary.aborted ? 'bad' : '');
            return;
          }
          const msg = x.host || (x.removed > 0 ? `compressed ${x.removed} messages` : 'nothing to compress');
          await out(msg); ctx.toast(msg);
        } finally { COMPRESSING.delete(key); }
        return;
      }
      case 'reasoning': {
        const p = reasoningParams(arg);
        if (!p) { const x = await call('config.get', { key: 'reasoning' }); await out(`reasoning: ${x.value || 'medium'} · display ${x.display || 'hide'}`); return; }
        const x = await call('config.set', p);
        // (an effort level for this chat: the window's thinking picker shows it too)
        if (p.scope !== 'global' && ctx.efforts().includes(x.value || p.value)) ctx.effort(x.value || p.value);
        await out(`reasoning: ${x.value || p.value}`);
        return;
      }
      case 'yolo': { const x = await call('config.set', { key: 'yolo', value: 'toggle' }); await ctx.ensure(); addNote(ctx, { text: `YOLO ${x.value === '1' ? 'on' : 'off'} for this session` }); return; }
      case 'title': {
        if (!arg) { await runExec(ctx, { name, arg, command, out, call }); return; }
        const x = await call('session.title', { title: arg }), t = String(x.title || arg).trim();
        await out(t ? `Session title set: ${t}${x.pending ? ' (queued while session initializes)' : ''}` : 'Session title cleared.');
        return;
      }
      case 'help': await out(renderCatalog(await catalogOf(ctx))); return;
      default: await runExec(ctx, { name, arg, command, out, call });
    }
  } catch (e) { await out(`error: ${e.message}`); }
}
const CONTROL_CMDS = new Set(['goal', 'subgoal', 'loop', 'heartbeat', 'hb']);
/** After a goal, loop or heartbeat command: the session's control read again (a new chat's first change can come before
 *  the window follows its session). */
function rereadControl(ctx, name) {
  const sid = ctx.sessionId();
  if (!CONTROL_CMDS.has(name) || sid === null || !ctx.hasProviderSession()) return;
  ctx.native('session.control.read', {}).then(r => { setControl(sid, r.control); if (ctx.sessionId() === sid) ctx.paint(); }).catch(() => {});
}
/** Hermes runs it (slash.exec), or - a skill, a quick command, a plugin's - says what to do with it (command.dispatch). */
async function runExec(ctx, args) {
  try { await runExec1(ctx, args); } finally { rereadControl(ctx, args.name); }
}
async function runExec1(ctx, { name, arg, command, out, call }) {
  let execErr = null;
  try {
    const x = await call('slash.exec', { command: command.replace(/^\/+/, '') });
    if (x.type) { await dispatched(ctx, x, { name, arg, out }); return; }
    const body = x.output || `/${name}: no output`;
    await out(x.warning ? `warning: ${x.warning}\n${body}` : body);
    return;
  } catch (e) {
    if (e.code === 'forbidden' || e.code === 'not_supported' || e.code === 'bad_request') { await out(`error: ${e.message}`); return; }
    execErr = e;
  }
  try {
    const d = await call('command.dispatch', { name, arg });
    if (!d.type) { await out('error: invalid response: command.dispatch'); return; }
    await dispatched(ctx, d, { name, arg, out });
  } catch (e) {
    if (execErr && /not a quick\/plugin\/(?:bundle\/)?skill command/i.test(e.message)) { await out(`error: /${name} failed: ${execErr.message}`); return; }
    await out(`error: ${e.message}`);
  }
}
async function dispatched(ctx, d, { name, arg, out }) {
  if (d.type === 'exec' || d.type === 'plugin') { await out(d.output || '(no output)'); return; }
  if (d.type === 'alias') { await runSlash(ctx, `/${d.target}${arg ? ` ${arg}` : ''}`, { record: false }); return; }
  if ((d.type === 'send' || d.type === 'prefill') && d.notice && d.notice.trim()) await out(d.notice.trim());
  const message = String(d.message || '').trim();
  if (d.type === 'prefill') { if (message) ctx.put({ text: message, files: [] }); return; }
  if (!message) { await out(`/${name}: ${d.type === 'skill' ? 'skill payload missing message' : 'empty message'}`); return; }
  // (the skill's words go to the model; the person's message shows the command - as Desktop's bubble does)
  const item = { id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: message, files: [], ...(d.display ? { display: d.display } : {}) };
  if (ctx.busy()) { qOf(ctx).items.push(item); ctx.paint(); await out('session busy - message queued to send when the current turn finishes'); return; }
  ctx.send({ item });
}

// ---- suggestions while typing: / commands, @ references
const REF_STARTERS = ['file', 'folder', 'url', 'image', 'tool', 'git'];
const STARTER_META = { file: 'Attach a file reference', folder: 'Attach a folder reference', url: 'Attach a URL reference', image: 'Attach an image reference', tool: 'Attach a tool reference', git: 'Attach git context' };
const REF_ICON = { file: 'doc', folder: 'folder', url: 'globe', image: 'picture', tool: 'wrench', git: 'clock', '@diff': 'panel', '@staged': 'plus' };
async function cached(key, fn) {
  const have = SUGGEST.get(key);
  if (have && Date.now() - have.at < 8000) return have.v;
  const v = await fn();
  SUGGEST.set(key, { at: Date.now(), v });
  if (SUGGEST.size > 300) SUGGEST.delete(SUGGEST.keys().next().value);
  return v;
}
/** What to suggest at the caret: { groups: [{ label, items: [{ label, sub, icon, insert, again }] }], from, to } - the
 *  composer's text from `from` to `to` is replaced by the item picked - or null. */
export async function completions(ctx, value, caret) {
  if (!ctx.manages()) return null;
  const before = value.slice(0, caret), at = /(?:^|\s)(@[^\s]*)$/.exec(before);
  if (at) return refs(ctx, at[1], caret - at[1].length, caret);
  if (!before.startsWith('/') || before.includes('\n') || /^\/\S*\//.test(before)) return null;
  return commands(ctx, before, caret);
}
/** A chat opened: Hermes' commands are read for it now, as its Desktop reads them when its composer appears. */
export function loaded(ctx) {
  if (!ctx.manages()) return;
  catalogOf(ctx).catch(() => {});
  // (its goal, loop and heartbeat: read for the status stack)
  const sid = ctx.sessionId();
  if (sid !== null && ctx.hasProviderSession()) ctx.native('session.control.read', {}).then(r => { setControl(sid, r.control); if (ctx.sessionId() === sid) ctx.paint(); }).catch(() => {});
}
async function commands(ctx, text, caret) {
  const scope = ctx.sessionId() ?? `a${ctx.agentId()}`;
  // (the catalog - read when the chat opened - and Hermes' completer, asked together)
  const ask = text === '/' ? null : cached(`s|${scope}|${text.toLowerCase()}`, () => ctx.native('complete.slash', { text }));
  ask?.catch(() => {});
  const cat = await catalogOf(ctx).catch(() => null);
  if (text === '/') {
    if (!cat) return null;
    const keep = pairs => (pairs || []).filter(([c]) => suggested(c, cat)).map(([c, d]) => ({ label: c, sub: describe(c, d, cat), icon: icon('terminal'), insert: `${c} ` }));
    const groups = (cat.categories && cat.categories.length ? cat.categories : [{ name: '', pairs: cat.pairs }]).map(s => ({ label: s.name, items: keep(s.pairs) }));
    const inCats = new Set(groups.flatMap(g => g.items.map(x => x.label.toLowerCase())));
    const skills = (cat.pairs || []).filter(([c]) => !inCats.has(c.toLowerCase()) && suggested(c, cat) && !SPEC.has(canonical(c, cat)) && !(cat.commands && cat.commands[canonical(c, cat)]))
      .filter(([c]) => { const s = cat.skills && cat.skills[canonical(c, cat)]; return !s || s.origin !== 'bundled' || (s.usage || 0) > 0; });
    if (skills.length) groups.push({ label: 'Skills', items: skills.map(([c, d]) => ({ label: c, sub: d, icon: icon('sparkles'), insert: `${c} ` })) });
    return { groups, from: 0, to: caret };
  }
  const r = await ask;
  const rf = Number.isInteger(r.replace_from) ? r.replace_from : 1, isArg = rf > 1, prefix = isArg ? text.slice(0, rf) : '';
  const list = (r.items || []).map(x => ({ ...x, cmd: isArg ? `${prefix}${x.text}` : `/${String(x.text).replace(/^\//, '')}` }))
    .filter(x => isArg || suggested(x.cmd, cat, norm(text)));
  if (isArg) return { groups: [{ label: 'Options', items: list.map(x => ({ label: x.display || x.text, sub: x.meta || '', icon: '', insert: `${x.cmd} ` })) }], from: 0, to: caret };
  const skill = x => x.kind === 'skill' || (x.kind !== 'command' && !SPEC.has(canonical(x.cmd, cat)) && !(cat && cat.commands && cat.commands[canonical(x.cmd, cat)]));
  const row = x => ({ label: x.display || x.cmd, sub: describe(x.cmd, x.meta, cat), icon: icon(skill(x) ? 'sparkles' : 'terminal'), insert: `${x.cmd} ` });
  return { groups: [{ label: 'Commands', items: list.filter(x => !skill(x)).map(row) }, { label: 'Skills', items: list.filter(skill).map(row) }], from: 0, to: caret };
}
async function refs(ctx, word, from, to) {
  const query = word.slice(1), w = REF_STARTERS.includes(query) ? `@${query}:` : word, scope = ctx.sessionId() ?? `a${ctx.agentId()}`;
  let list = [];
  try { list = (await cached(`p|${scope}|${w}`, () => ctx.native('complete.path', { word: w }))).items || []; } catch { list = []; }
  if (!list.length) list = REF_STARTERS.filter(k => !query || k.startsWith(query.toLowerCase())).map(k => ({ text: `@${k}:`, display: `@${k}:`, meta: STARTER_META[k] }));
  const kindOf = t => (/^@(file|folder|url|image|tool|git):/.exec(t) || [])[1] || t;
  const items = list.map(x => {
    const k = kindOf(x.text), more = /[:/]$/.test(x.text);
    return { label: x.display || x.text, sub: x.meta || '', icon: icon(REF_ICON[k] || 'robot'), insert: more ? x.text : `${x.text} `, again: more };
  });
  const listing = /^@(file|folder):/.exec(w);
  return { groups: [{ label: listing ? (listing[1] === 'file' ? 'Files' : 'Folders') : '', items }], from, to };
}
