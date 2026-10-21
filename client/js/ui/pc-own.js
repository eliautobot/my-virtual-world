// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see
// LICENSE).
// The PC's "Its computer" app (client/js/ui/pc-app.js; docs/features/agent-pc.md §4.1), for an Agent Providers' agent —
// OpenClaw, Hermes — that lives on a real computer of its own: that computer's files as its provider shows them (OpenClaw:
// the agent's workspace, read-only, and its agent documents — AGENTS.md, SOUL.md… — to read and change; Hermes: Hermes'
// managed files, to change too when the connection has Full access), and a file copied from there into its PC. Everything
// goes through the server (/api/pc/own: its provider's own interfaces, for whoever manages that provider); a change asks
// for the password when it wasn't entered lately.
import { esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { md } from './chat-md.js';
import { size, when, popMenu } from './pc-ui.js';

const TEXT = /\.(md|markdown|txt|log|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|cfg|conf|env\.example|html?|css|m?[jt]sx?|py|rb|go|rs|java|c|h|cpp|sh|sql)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif)$/i;
const MEDIA = /\.(mp4|webm|mov|mp3|wav|ogg|m4a|pdf)$/i;
const icon = e => (e.dir ? '📂' : IMAGE.test(e.name) ? '🖼' : /\.(mp4|webm|mov)$/i.test(e.name) ? '🎥' : /\.(mp3|wav|ogg|m4a)$/i.test(e.name) ? '🎧' : '📄');

export function computerApp(P, el, args = {}) {
  const own = () => P.me()?.own || null;
  const C = { view: args.view === 'docs' ? 'docs' : 'files', path: null, list: null, file: null, docs: null, doc: null, err: null, seq: 0, busy: false, ups: [], live: args.live || null };
  const q = o => new URLSearchParams(Object.entries({ agent: P.agent, ...o }).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();
  async function getJ(o) {
    const r = await fetch(`/api/pc/own?${q(o)}`, { cache: 'no-store' });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(j?.error || `HTTP ${r.status}`), { code: j?.code, status: r.status });
    return j;
  }
  const fileUrl = (path, extra = {}) => `/api/pc/own/file?${q({ path, ...extra })}`;
  const say = e => { C.err = e?.message || String(e); C.busy = false; paint(); };
  const label = () => own()?.label || 'Its computer';

  // ---------------------------------------------------------------- its files
  async function list(path = C.path) {
    const my = ++C.seq;
    C.busy = true; paint();
    try {
      const r = await getJ({ op: 'list', path: path ?? '' });
      if (my !== C.seq) return;
      Object.assign(C, { view: 'files', path: r.path ?? '', list: r, file: null, err: null });
    } catch (e) { if (my === C.seq) C.err = e.message; }
    if (my === C.seq) { C.busy = false; paint(); }
  }
  async function openFile(e) {
    const my = ++C.seq;
    const f = { path: e.path, name: e.name, size: e.size, modified: e.modified, kind: TEXT.test(e.name) ? 'text' : IMAGE.test(e.name) ? 'image' : MEDIA.test(e.name) ? 'media' : 'other', text: null, dirty: false };
    C.file = f; C.busy = f.kind === 'text'; C.err = null; paint();
    if (f.kind !== 'text') return;
    try {
      const r = await getJ({ op: 'read', path: e.path });
      if (my !== C.seq) return;
      f.text = r.encoding === 'base64' ? decode(r.content) : String(r.content ?? '');
      if (f.text === null) f.kind = 'other';
      f.mode = /\.(md|markdown)$/i.test(f.name) ? 'read' : 'edit';
    } catch (err) { if (my === C.seq) { C.err = err.message; f.kind = 'other'; } }
    if (my === C.seq) { C.busy = false; paint(); }
  }
  /** Base64 as text, or null when it isn't text (UTF-8). */
  function decode(b64) {
    try { const bytes = Uint8Array.from(atob(String(b64 || '')), c => c.charCodeAt(0)); return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
  }
  const canWrite = () => !!own()?.write && own()?.where === 'machine';
  async function change(body, ok) {
    try { await P.post('own', { agent: P.agent, ...body }); if (ok) P.toast(ok, 'good'); return true; } catch (e) { if (e.code !== 'reauth_required') say(e); return false; }
  }
  const join = (dir, name) => (!dir ? name : `${dir.replace(/\/+$/, '')}/${name}`);
  async function saveFile() {
    const f = C.file, ta = el.querySelector('textarea.pc-text');
    if (!f || !ta) return;
    f.text = ta.value;
    if (await change({ op: 'write', path: f.path, content: f.text, encoding: 'utf8', mime: 'text/plain', overwrite: true }, `Saved on ${label()}`)) { f.dirty = false; paint(); }
  }
  function upload(files) {
    for (const file of files) {
      const up = { name: file.name, pct: 0, err: null };
      C.ups.push(up); paint();
      const exists = C.list?.entries.some(e => e.name === file.name);
      if (exists && !confirm(`${file.name} is there already on ${label()}. Replace it?`)) { C.ups.splice(C.ups.indexOf(up), 1); paint(); continue; }
      const send = (again = false) => {
        const x = new XMLHttpRequest();
        x.open('POST', `/api/pc/own/upload?${q({ path: join(C.path, file.name), replace: exists ? 1 : undefined })}`);
        x.setRequestHeader('content-type', file.type || 'application/octet-stream');
        if (auth.csrf) x.setRequestHeader('x-csrf-token', auth.csrf);
        x.upload.onprogress = e => { if (e.lengthComputable) { up.pct = Math.round((e.loaded / e.total) * 100); paintUps(); } };
        x.onload = async () => {
          let j = null; try { j = JSON.parse(x.responseText); } catch { /* not JSON */ }
          if (x.status === 403 && j?.code === 'reauth_required' && !again && auth.ui && await auth.ui.confirmPassword(j.error)) return send(true);
          if (x.status >= 400) { up.err = j?.error || `HTTP ${x.status}`; paintUps(); } else { C.ups.splice(C.ups.indexOf(up), 1); list(); }
        };
        x.onerror = () => { up.err = 'The upload broke off'; paintUps(); };
        x.send(file);
      };
      send();
    }
  }
  /** A file of its computer copied into its PC (~/Downloads): the file as its provider sends it. */
  async function intoPc(e) {
    try {
      const r = await fetch(fileUrl(e.path, { download: 1 }), { cache: 'no-store' });
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(j?.error || `HTTP ${r.status}`); }
      const blob = await r.blob();
      const to = `~/Downloads/${e.name}`;
      const w = await fetch(`/api/pc/upload?${new URLSearchParams({ profile: String(P.agent), path: to, replace: '1' })}`,
        { method: 'POST', body: blob, headers: { 'content-type': blob.type || 'application/octet-stream', ...(auth.csrf ? { 'x-csrf-token': auth.csrf } : {}) } });
      const j = await w.json().catch(() => null);
      if (!w.ok) throw new Error(j?.error || `HTTP ${w.status}`);
      P.toast(`Copied into ${P.me()?.name || 'its'}'s PC: ${to}`, 'good');
    } catch (err) { say(err); }
  }
  function rowMenu(btn, e) {
    const items = [
      { label: 'Open', icon: e.dir ? '📂' : '📄', run: () => (e.dir ? list(e.path) : openFile(e)) },
      ...(!e.dir ? [{ label: 'Download', icon: '⬇', run: () => { location.href = fileUrl(e.path, { download: 1 }); } },
        { label: 'Copy into its PC', icon: '💻', run: () => intoPc(e) }] : []),
      ...(canWrite() ? ['-', { label: 'Delete', icon: '🗑', danger: true, run: async () => {
        if (!confirm(`Delete ${e.name} from ${label()}? This is its real computer: there is no trash here.`)) return;
        if (await change({ op: 'remove', path: e.path, recursive: !!e.dir }, 'Deleted')) list();
      } }] : []),
    ];
    popMenu(btn, items);
  }

  // ---------------------------------------------------------------- its documents (OpenClaw)
  async function docs() {
    const my = ++C.seq;
    C.view = 'docs'; C.doc = null; C.busy = true; paint();
    try { const r = await getJ({ op: 'docs' }); if (my === C.seq) { C.docs = r.files; C.err = null; } } catch (e) { if (my === C.seq) C.err = e.message; }
    if (my === C.seq) { C.busy = false; paint(); }
  }
  async function openDoc(name) {
    const my = ++C.seq;
    C.busy = true; paint();
    try { const r = await getJ({ op: 'doc', name }); if (my === C.seq) { C.doc = { name, text: r.content || '', hash: r.hash, missing: r.missing, dirty: false, mode: 'edit' }; C.err = null; } }
    catch (e) { if (my === C.seq) C.err = e.message; }
    if (my === C.seq) { C.busy = false; paint(); }
  }
  async function saveDoc() {
    const d = C.doc, ta = el.querySelector('textarea.pc-text');
    if (!d || !ta) return;
    d.text = ta.value;
    try {
      const r = await P.post('own', { agent: P.agent, op: 'docSet', name: d.name, content: d.text, ...(d.hash ? { expectedHash: d.hash } : {}) });
      d.hash = r.hash || null; d.dirty = false; d.missing = false; C.err = null;
      P.toast(`${d.name} saved on ${label()}`, 'good');
      if (!d.hash) return openDoc(d.name);   // (its new hash: read it again, so the next save is checked too)
      paint();
    } catch (e) {
      if (e.code === 'reauth_required') return;
      if (/hash|changed|conflict/i.test(`${e.code} ${e.message}`)) { if (confirm(`${d.name} was changed on ${label()} since you opened it. Open the current one? (Your changes here are lost.)`)) openDoc(d.name); return; }
      say(e);
    }
  }

  // ---------------------------------------------------------------- drawing
  function side() {
    const o = own();
    return `<div class="pc-sh">${esc(label())}</div>
      <button class="${C.view === 'files' ? 'on' : ''}" data-v="files">${o?.where === 'machine' ? '💻 Its files' : '📂 Its workspace'}</button>
      ${o?.docs ? `<button class="${C.view === 'docs' ? 'on' : ''}" data-v="docs">📃 Its documents</button>` : ''}
      ${o?.browser ? '<button data-v="browser">🌐 Its browser</button>' : ''}`;
  }
  /** Where the folder is, a step at a time: from its workspace (OpenClaw: paths inside it), or from Hermes' locked
   *  folder when it has one, else from the computer's / (Hermes: whole paths). */
  function crumbs() {
    const p = C.path || '', root = C.list?.root || null;
    if (!p.startsWith('/')) {
      const out = [`<button data-go="">${esc('Workspace')}</button>`];
      let acc = '';
      for (const part of p.split('/').filter(Boolean)) { acc = acc ? `${acc}/${part}` : part; out.push(`<button data-go="${esc(acc)}">${esc(part)}</button>`); }
      return out.join('<i>›</i>');
    }
    const base = root && (p === root || p.startsWith(`${root.replace(/\/+$/, '')}/`)) ? root.replace(/\/+$/, '') : '';
    const out = [`<button data-go="${esc(base || '/')}">${esc(base ? 'Files' : '/')}</button>`];
    let acc = base;
    for (const part of p.slice(base.length).split('/').filter(Boolean)) { acc = `${acc}/${part}`; out.push(`<button data-go="${esc(acc)}">${esc(part)}</button>`); }
    return out.join('<i>›</i>');
  }
  function filesHtml() {
    if (C.file) return fileHtml();
    const r = C.list, w = canWrite();
    const rows = !r ? '<div class="pc-empty">Opening…</div>' : !r.entries.length ? '<div class="pc-empty">This folder is empty.</div>'
      : r.entries.map((e, k) => `<div class="pc-file" data-k="${k}"><span class="pc-fi" aria-hidden="true">${icon(e)}</span><span class="pc-fn">${esc(e.name)}</span>
        <span class="pc-fs">${e.dir || e.size == null ? '' : size(e.size)}</span><span class="pc-fm">${e.modified ? when(e.modified) : ''}</span>
        <button class="pc-more" data-menu="${k}" title="More">⋯</button></div>`).join('') + (r.total > r.entries.length ? `<div class="pc-empty">…and ${r.total - r.entries.length} more in this folder</div>` : '');
    return `<div class="pc-tools">${r && r.parent != null ? `<button class="pc-btn" data-go="${esc(r.parent)}" title="Up">↑</button>` : ''}<div class="pc-crumbs">${crumbs()}</div>
        ${w ? '<button class="pc-btn" data-mkdir="1" title="New folder">📂 Folder</button><button class="pc-btn primary" data-up="1">⬆ Upload</button><input type="file" multiple hidden class="pc-file-in">' : ''}
        <button class="pc-btn" data-reload="1" title="Read it again">↻</button></div>
      <div class="pc-note">${esc(own()?.where === 'machine' ? `The real files of the computer ${label()} runs on, as ${label()} shows them${w ? '' : ' (to read: this connection has Chat only access)'}.` : `${P.me()?.name || 'Its'}'s real workspace on ${label()}, to read. Its documents (AGENTS.md, SOUL.md…) can be changed under Its documents.`)}</div>
      ${err()}<div class="pc-ups"></div><div class="pc-list">${rows}</div>`;
  }
  function fileHtml() {
    const f = C.file, src = fileUrl(f.path), w = canWrite() && f.kind === 'text';
    const head = `<div class="pc-tools"><button class="pc-btn" data-back="1">↩</button><b class="pc-grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}
      <span class="dim" style="font-weight:400">${f.size != null ? ` · ${size(f.size)}` : ''}${f.dirty ? ' · not saved' : ''}</span></b>
      ${f.kind === 'text' && /\.(md|markdown)$/i.test(f.name) ? `<button class="pc-btn" data-mode="${f.mode === 'read' ? 'edit' : 'read'}">${f.mode === 'read' ? (w ? '✏ Edit' : '📄 Text') : '👁 Read'}</button>` : ''}
      ${w ? '<button class="pc-btn primary" data-save="file">💾 Save</button>' : ''}
      <button class="pc-btn" data-into="1" title="Copy into its PC (Downloads)">💻 Into its PC</button><a class="pc-btn" href="${fileUrl(f.path, { download: 1 })}" title="Download">⬇</a></div>`;
    let body;
    if (C.busy) body = '<div class="pc-empty">Opening…</div>';
    else if (f.kind === 'text' && f.text != null) body = f.mode === 'read' ? `<div class="pc-md">${md(f.text)}</div>` : `<textarea class="pc-text" spellcheck="false" ${w ? '' : 'readonly'}>${esc(f.text)}</textarea>`;
    else if (f.kind === 'image') body = `<div class="pc-media"><img src="${src}" alt="${esc(f.name)}"></div>`;
    else if (f.kind === 'media' && /\.(mp4|webm|mov)$/i.test(f.name)) body = `<div class="pc-media"><video src="${src}" controls></video></div>`;
    else if (f.kind === 'media' && /\.(mp3|wav|ogg|m4a)$/i.test(f.name)) body = `<div class="pc-media"><audio src="${src}" controls></audio></div>`;
    else body = `<div class="pc-empty">This kind of file opens in its own program.<br><br><a class="pc-btn primary" href="${fileUrl(f.path, { download: 1 })}">⬇ Download ${esc(f.name)}</a></div>`;
    return `<div class="pc-view">${head}${err()}${body}</div>`;
  }
  function docsHtml() {
    const d = C.doc, w = !!own()?.write;
    if (d) {
      return `<div class="pc-view"><div class="pc-tools"><button class="pc-btn" data-back="1">↩</button><b class="pc-grow">${esc(d.name)}<span class="dim" style="font-weight:400">${d.missing ? ' · not made yet' : ''}${d.dirty ? ' · not saved' : ''}</span></b>
        <button class="pc-btn" data-mode="${d.mode === 'read' ? 'edit' : 'read'}">${d.mode === 'read' ? '✏ Edit' : '👁 Read'}</button>
        ${w ? '<button class="pc-btn primary" data-save="doc">💾 Save</button>' : ''}</div>${err()}
        ${C.busy ? '<div class="pc-empty">Opening…</div>' : d.mode === 'read' ? `<div class="pc-md">${md(d.text)}</div>` : `<textarea class="pc-text" spellcheck="false" ${w ? '' : 'readonly'}>${esc(d.text)}</textarea>`}</div>`;
    }
    const rows = !C.docs ? '<div class="pc-empty">Opening…</div>' : !C.docs.length ? '<div class="pc-empty">No documents.</div>'
      : C.docs.map(x => `<div class="pc-file" data-doc="${esc(x.name)}"><span class="pc-fi" aria-hidden="true">📃</span><span class="pc-fn">${esc(x.name)}${x.missing ? ' <small class="dim">not made yet</small>' : ''}</span>
        <span class="pc-fs">${x.size != null && !x.missing ? size(x.size) : ''}</span><span class="pc-fm">${x.modified ? when(x.modified) : ''}</span><span></span></div>`).join('');
    return `<div class="pc-tools"><b class="pc-grow">Its documents</b><button class="pc-btn" data-reload="1" title="Read them again">↻</button></div>
      <div class="pc-note">What ${esc(P.me()?.name || 'it')} reads every time it works: who it is, how it works, what it remembers. ${w ? 'A change goes to its computer at once, with your password.' : 'To read here: this connection has Chat only access.'}</div>
      ${err()}<div class="pc-list">${rows}</div>`;
  }
  /**
   * What it works on there now, following it (server/pc/recognize.js — a step's window, `remote`): the file it reads,
   * writes or changes with its own line numbers (its changes as a diff), a picture, a folder, its search, what a calendar
   * or task command printed, its list. Only what the step showed: ↩ goes back to its files.
   */
  function liveHtml() {
    const v = C.live, who = esc(P.me()?.name || 'It');
    const bar = what => `<div class="pc-tools"><button class="pc-btn" data-unlive="1" title="Its files">↩</button><div class="pc-livebar pc-grow"><span class="pc-dot on"></span><b>${who}</b> · ${what}</div>
      ${v.kind === 'file' && v.path && !v.diff && v.mode !== 'delete' ? `<button class="pc-btn" data-open="${esc(v.path)}" title="Open the whole file">📄 Open</button>` : ''}</div>`;
    switch (v.kind) {
      case 'file': {
        const what = { write: 'Writing', edit: 'Changing', read: 'Reading', review: 'Reviewing', delete: 'Deleting', open: 'Looking at' }[v.mode] || 'Looking at';
        const hl = v.hl || null, first = v.first || 1;
        const rows = (v.lines || []).map((l, k) => {
          const n = first + k, d = v.diff ? (/^(\+\+\+|---) |^diff --git/.test(l) ? ' dh' : /^@@/.test(l) ? ' dat' : /^\+/.test(l) ? ' dadd' : /^-/.test(l) ? ' ddel' : '') : '';
          return `<div class="pc-ln${hl && n >= hl[0] && n <= hl[1] ? ' hl' : ''}${d}"><i>${v.diff ? '' : n}</i><span>${esc(l) || ' '}</span></div>`;
        }).join('');
        return `${bar(`${what} <b>${esc(v.name || v.path)}</b>${hl && !v.diff ? ` · line${hl[0] === hl[1] ? ` ${hl[0]}` : `s ${hl[0]}–${hl[1]}`}` : ''}`)}
          <div class="pc-live" role="document">${rows || `<div class="pc-empty">${what} ${esc(v.name || v.path)}…</div>`}</div>`;
      }
      case 'image': return `${bar(v.made ? 'making a picture' : `looking at <b>${esc(v.name || 'a picture')}</b>`)}
          ${v.path ? `<div class="pc-media"><img src="${fileUrl(v.path)}" alt="${esc(v.name || '')}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'pc-empty',textContent:'This picture can\'t be shown from here.'}))"></div>` : `<div class="pc-empty">${esc(v.name || '')}</div>`}`;
      case 'folder': return `${bar(`looking in <b>${esc(v.path)}</b>`)}<div class="pc-list">${(v.entries || []).map(e => `<div class="pc-file"><span class="pc-fi" aria-hidden="true">${icon(e)}</span><span class="pc-fn">${esc(e.name)}</span><span class="pc-fs">${e.dir || e.size == null ? '' : size(e.size)}</span><span></span><span></span></div>`).join('') || '<div class="pc-empty">Looking in it…</div>'}</div>`;
      case 'find': return `${bar(`searching for <b>${esc(v.query)}</b>`)}<div class="pc-list">${(v.results || []).map(r => `<div class="pc-file"><span class="pc-fi" aria-hidden="true">📄</span><span class="pc-fn">${esc(r.path)}${r.snippet ? ` <small class="dim">${esc(r.snippet)}</small>` : ''}</span><span></span><span></span><span></span></div>`).join('') || '<div class="pc-empty">Searching…</div>'}</div>`;
      case 'board': return `${bar(`on <b>${esc(v.board || 'its list')}</b>`)}<div class="pc-list">${['doing', 'todo', 'review', 'done'].flatMap(col => (v.cards || []).filter(k => k.col === col).map(k => `<div class="pc-file"><span class="pc-fi" aria-hidden="true">${col === 'done' ? '✅' : col === 'doing' ? '▶' : '📋'}</span><span class="pc-fn">${esc(k.title)}</span><span class="pc-fs">${esc({ todo: 'To do', doing: 'Doing', review: 'Review', done: 'Done' }[col])}</span><span></span><span></span></div>`)).join('')}</div>`;
      default: return `${bar(esc(v.heading || 'working'))}<div class="pc-list">${(v.lines || []).map(l => `<div class="pc-file"><span class="pc-fi" aria-hidden="true">${v.app === 'calendar' ? '🗓' : v.app === 'board' ? '📋' : '•'}</span><span class="pc-fn">${esc(l)}</span><span></span><span></span><span></span></div>`).join('') || '<div class="pc-empty">Looking…</div>'}</div>`;
    }
  }
  const err = () => (C.err ? `<div class="pc-err">${esc(C.err)}</div>` : '');
  function paintUps() {
    const box = el.querySelector('.pc-ups');
    if (box) box.innerHTML = C.ups.map(u => `<div class="pc-up">${u.err ? `<span class="bad">${esc(u.name)}: ${esc(u.err)}</span>` : `${esc(u.name)} — ${u.pct} %`}</div>`).join('');
  }
  function paint() {
    if (!P.alive) return;
    if (!own()) { el.innerHTML = '<div class="pc-empty">This agent has no computer of its own here: it lives on this PC.</div>'; return; }
    el.innerHTML = `<div class="pc-split"><nav class="pc-side">${side()}</nav><div class="pc-main">${C.live ? `<div class="pc-view">${liveHtml()}</div>` : C.view === 'docs' ? docsHtml() : filesHtml()}</div></div>`;
    if (C.live) { const box = el.querySelector('.pc-live'), at = box?.querySelector('.hl'); if (at) at.scrollIntoView({ block: 'center' }); }
    paintUps();
    const ta = el.querySelector('textarea.pc-text'), cur = C.view === 'docs' ? C.doc : C.file;
    if (ta && cur) ta.addEventListener('input', () => { cur.text = ta.value; if (!cur.dirty) { cur.dirty = true; const b = el.querySelector('.pc-tools b span'); if (b) b.textContent += ' · not saved'; } });
  }

  // ---------------------------------------------------------------- input
  const leave = () => !((C.file?.dirty || C.doc?.dirty) && !confirm('Leave without saving?'));
  el.addEventListener('click', e => {
    const t = e.target.closest('button, .pc-file, a');
    if (!t || !el.contains(t)) return;
    if (t.dataset.unlive) { C.live = null; return C.list ? paint() : list(); }
    if (t.dataset.open) { const p = t.dataset.open; C.live = null; return openFile({ path: p, name: p.split('/').pop() }); }
    if (t.dataset.v) { if (!leave()) return; if (t.dataset.v === 'browser') return P.open('browser', { own: true }); C.file = null; C.doc = null; C.live = null; return t.dataset.v === 'docs' ? docs() : list(); }
    if (t.dataset.go !== undefined) return list(t.dataset.go);
    if (t.dataset.reload) return C.view === 'docs' ? docs() : list();
    if (t.dataset.back) { if (!leave()) return; if (C.view === 'docs') { C.doc = null; return docs(); } C.file = null; return paint(); }
    if (t.dataset.menu !== undefined) { e.stopPropagation(); return rowMenu(t, C.list.entries[Number(t.dataset.menu)]); }
    if (t.dataset.k !== undefined && t.classList.contains('pc-file')) { const x = C.list.entries[Number(t.dataset.k)]; return x.dir ? list(x.path) : openFile(x); }
    if (t.dataset.doc) return openDoc(t.dataset.doc);
    if (t.dataset.mode) { const cur = C.view === 'docs' ? C.doc : C.file, ta = el.querySelector('textarea.pc-text'); if (ta && cur) cur.text = ta.value; if (cur) { cur.mode = t.dataset.mode; paint(); } return; }
    if (t.dataset.save === 'file') return saveFile();
    if (t.dataset.save === 'doc') return saveDoc();
    if (t.dataset.into) return intoPc(C.file);
    if (t.dataset.up) return el.querySelector('.pc-file-in')?.click();
    if (t.dataset.mkdir) { const n = prompt('Name of the new folder', 'New folder'); if (n && n.trim()) change({ op: 'mkdir', path: join(C.path, n.trim()) }, 'Folder made').then(ok => ok && list()); }
  });
  el.addEventListener('change', e => { if (e.target.classList.contains('pc-file-in') && e.target.files.length) upload([...e.target.files]); });
  el.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { if (C.view === 'docs' && C.doc) { e.preventDefault(); saveDoc(); } else if (C.file && canWrite()) { e.preventDefault(); saveFile(); } }
  });
  el.addEventListener('dragover', e => { if (C.view !== 'files' || C.file || !canWrite() || ![...(e.dataTransfer?.types || [])].includes('Files')) return; e.preventDefault(); el.querySelector('.pc-list')?.classList.add('drop'); });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.querySelector('.pc-list')?.classList.remove('drop'); });
  el.addEventListener('drop', e => { if (C.view !== 'files' || C.file || !canWrite() || !e.dataTransfer?.files?.length) return; e.preventDefault(); el.querySelector('.pc-list')?.classList.remove('drop'); upload([...e.dataTransfer.files]); });

  if (C.live) paint(); else if (C.view === 'docs') docs(); else list(args.path ?? null);
  return {
    // (following it: what it works on there now — never over a file or document the person is changing)
    go(a) { if (a.live) { if (C.file?.dirty || C.doc?.dirty) return; C.live = a.live; return paint(); } C.live = null; if (a.view === 'docs') docs(); else list(a.path ?? C.path); },
    destroy() { ++C.seq; },
  };
}
