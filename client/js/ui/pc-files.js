// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The PC's Files app (client/js/ui/pc-app.js): the agent's home (~), its teams' folders (/teams/<team>) - or one team's
// space as the Teams app opens it - and the trash. Folders and files, uploads (a button, or dropped from the computer),
// new folders and documents, rename, move, copy (to a team's folder: shared with the team), delete into the trash, search.
// A text file opens in an editor (saved with Ctrl+S; if someone saved it meanwhile, it says so and offers both ways), a
// Markdown file also as it reads, a picture, a recording or a video as itself, a document's words read-only, anything else
// as a download; every file's older versions, and bringing one back. An Agent Providers' agent's own computer is one more
// place here, opening its own app (./pc-own.js).
import { esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { md } from './chat-md.js';
import { size, when, popMenu } from './pc-ui.js';

const TEXT = /\.(md|markdown|txt|log|csv|tsv|json|xml|ya?ml|toml|ini|html?|css|m?js|ts|py|sh|sql)$/i;
const DOC = /\.(docx|xlsx|pptx|odt|ods|odp)$/i;
const icon = e => (e.dir ? (e.team ? '👥' : '📂') : /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(e.name) ? '🖼' : /\.(mp4|webm|mov)$/i.test(e.name) ? '🎥'
  : /\.(mp3|wav|ogg|m4a)$/i.test(e.name) ? '🎧' : /\.pdf$/i.test(e.name) ? '📄' : '📄');

export function filesApp(P, el, args = {}) {
  let soon = null;
  const F = { space: args.space ?? null, spaceLabel: args.spaceLabel || null, path: args.path || (args.space != null ? '/' : '~/Documents'),
    list: null, file: null, view: 'list', query: '', err: null, busy: false, ups: [], seq: 0, mark: args.mark ?? null };
  // (a team's space as the Teams app opens it: its own paths start at /; the server answers with /teams/<team>/…)
  const rel = v => (F.space != null ? (String(v).replace(/^\/teams\/[^/]+/, '') || '/') : v);
  const where = (path = F.path) => (F.space != null ? { space: F.space, path: rel(path) } : { profile: P.agent, path });
  const qs = (path, extra = {}) => new URLSearchParams(Object.entries({ ...where(path), ...extra }).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();
  const fileUrl = (path, extra = {}) => `/api/pc/file?${qs(path, extra)}`;
  const say = (e, bad = true) => { F.err = bad ? (e?.message || String(e)) : null; if (!bad) P.toast(e, 'good'); paint(); };

  // ---------------------------------------------------------------- reading
  async function load(path = F.path) {
    const my = ++F.seq;
    try {
      const r = await fetchJSON(`/api/pc/ls?${qs(path)}`);
      if (my !== F.seq) return;
      if (r.file) return openFile(r.file.path || path);
      F.path = r.path; F.list = r; F.view = 'list'; F.err = null; F.file = null;
    } catch (e) { if (my === F.seq) F.err = e.message; }
    paint();
  }
  /** o.live: the agent's window on this file (server/pc/views.js) - it is shown live, its changed lines marked. */
  async function openFile(path, o = {}) {
    clearTimeout(soon); const my = ++F.seq;   // (a folder being read meanwhile is not shown over the file)
    if (!o.live) { F.busy = true; paint(); }
    try {
      const st = await fetchJSON(`/api/pc/stat?${qs(path)}`);
      const f = { path: st.path || path, info: st, kind: kindOf(st), text: null, dirty: false, mode: 'edit', versions: null, live: o.live || null };
      if (f.kind === 'text' || f.kind === 'doc') { const t = await fetchJSON(`/api/pc/text?${qs(path)}`); f.text = t.text; f.version = t.info.version; f.truncated = t.truncated; }
      if (f.kind === 'text' && /\.(md|markdown)$/i.test(st.name)) f.mode = 'read';
      if (o.live && (f.kind === 'text' || f.kind === 'doc')) f.mode = 'live';
      if (my !== F.seq) return;
      F.file = f; F.view = 'file'; F.err = null;
    } catch (e) { if (my === F.seq) F.err = e.message; }
    if (my !== F.seq) return;
    F.busy = false; paint();
    if (F.file?.mode === 'live') liveScroll();
  }
  /** The agent's lines in view: those it just changed, else where it reads. */
  function liveScroll() {
    const box = el.querySelector('.pc-live'), at = box?.querySelector('.hl') || box?.querySelector(`[data-ln="${F.file?.live?.first || 1}"]`);
    if (box && at) box.scrollTop = Math.max(0, at.offsetTop - box.clientHeight / 3);
  }
  const kindOf = st => (TEXT.test(st.name) || /^text\//.test(st.mime || '') || /json|xml/.test(st.mime || '') ? 'text' : DOC.test(st.name) ? 'doc'
    : /^image\/(png|jpeg|gif|webp|avif)$/.test(st.mime || '') ? 'image' : /^video\//.test(st.mime || '') ? 'video' : /^audio\//.test(st.mime || '') ? 'audio' : st.mime === 'application/pdf' ? 'pdf' : 'other');
  async function fetchJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(j?.error || `HTTP ${r.status}`), { code: j?.code, status: r.status, version: j?.version });
    return j;
  }

  // ---------------------------------------------------------------- doing
  async function act(fn, ok) { try { await fn(); if (ok) P.toast(ok, 'good'); await load(); } catch (e) { say(e); } }
  const ask = (q, v = '') => { const r = prompt(q, v); return r === null ? null : r.trim(); };
  async function save(force = false) {
    const f = F.file;
    if (!f || f.kind !== 'text') return;
    const ta = el.querySelector('textarea.pc-text');
    if (ta) f.text = ta.value;
    try {
      const r = await P.post('write', { ...where(f.path), text: f.text, expect: force ? undefined : f.version, force });
      f.version = r.info.version; f.info = { ...f.info, version: r.info.version, size: r.info.size, modified: r.info.modified }; f.dirty = false; F.err = null;
      P.toast(r.same ? 'No changes to save' : `Saved (version ${r.info.version})`, 'good');
      paint();
    } catch (e) {
      if (e.code === 'changed') {
        if (confirm(`${f.info.name} was saved by someone else since you opened it.\n\nOK: keep your text and save it over theirs (theirs stays in the versions).\nCancel: open their version instead (your changes are lost).`)) return save(true);
        return openFile(f.path);
      }
      say(e);
    }
  }
  function newFile() {
    const name = ask('Name of the new document', 'Untitled.md');
    if (!name) return;
    act(async () => { await P.post('write', { ...where(join(F.path, name)), text: '' }); }).then(() => openFile(join(F.path, name)));
  }
  const join = (dir, name) => `${dir.replace(/\/$/, '')}/${name}`;
  function upload(files) {
    for (const file of files) {
      const up = { name: file.name, pct: 0, err: null };
      F.ups.push(up); paint();
      const exists = F.list?.entries.some(e => e.name.toLowerCase() === file.name.toLowerCase());
      if (exists && !confirm(`${file.name} is there already. Replace it? (The old one is kept as a version.)`)) { F.ups.splice(F.ups.indexOf(up), 1); paint(); continue; }
      const x = new XMLHttpRequest();
      x.open('POST', `/api/pc/upload?${qs(join(F.path, file.name), exists ? { replace: 1 } : {})}`);
      x.setRequestHeader('content-type', file.type || 'application/octet-stream');
      if (auth.csrf) x.setRequestHeader('x-csrf-token', auth.csrf);
      x.upload.onprogress = e => { if (e.lengthComputable) { up.pct = Math.round((e.loaded / e.total) * 100); paintUps(); } };
      x.onload = () => {
        let j = null; try { j = JSON.parse(x.responseText); } catch { /* not JSON */ }
        if (x.status >= 400) up.err = j?.error || `HTTP ${x.status}`; else F.ups.splice(F.ups.indexOf(up), 1);
        load();
      };
      x.onerror = () => { up.err = 'The upload broke off'; paint(); };
      x.send(file);
    }
  }
  function rowMenu(btn, e) {
    const teams = P.teams.filter(t => t.members.some(m => m.agent === P.agent));
    const items = [
      { label: 'Open', icon: e.dir ? '📂' : '📄', run: () => (e.dir ? load(e.path) : openFile(e.path)) },
      ...(!e.dir ? [{ label: 'Download', icon: '⬇', run: () => { location.href = fileUrl(e.path, { download: 1 }); } }] : []),
      ...(!e.system ? [{ label: 'Rename', icon: '✏', run: () => { const n = ask('New name', e.name); if (n && n !== e.name) act(() => P.post('move', { ...where(e.path), to: rel(join(F.path, n)) }), 'Renamed'); } },
        { label: 'Move to…', icon: '↗', run: () => { const to = ask('Move to which folder? (e.g. ~/Documents/Old)', F.path); if (to) act(() => P.post('move', { ...where(e.path), to: `${rel(to).replace(/\/$/, '')}/` }), 'Moved'); } }] : []),
      { label: 'Copy to…', icon: '📋', run: () => { const to = ask('Copy to which folder?', F.path); if (to) act(() => P.post('copy', { ...where(e.path), to: `${rel(to).replace(/\/$/, '')}/` }), 'Copied'); } },
      ...(F.space == null && teams.length ? teams.map(t => ({ label: `Share with ${t.name}`, icon: '👥', run: () => act(() => P.post('copy', { ...where(e.path), to: `/teams/${t.slug}/` }), `Copied into ${t.name}'s folder`) })) : []),
      ...(!e.system ? ['-', { label: 'Delete', icon: '🗑', danger: true, run: () => { if (confirm(`Put ${e.name} in the trash? It is kept 30 days.`)) act(() => P.post('remove', where(e.path)), 'In the trash'); } }] : []),
    ];
    popMenu(btn, items);
  }
  async function showTrash() {
    try { const r = await fetchJSON(`/api/pc/trash?${qs(F.space != null ? '/' : (F.path.startsWith('/teams/') ? F.path.split('/').slice(0, 3).join('/') : '~'))}`); F.trash = r.items; F.view = 'trash'; F.err = null; } catch (e) { F.err = e.message; }
    paint();
  }
  async function search(q) {
    F.query = q;
    if (!q.trim()) return load();
    // (in an agent's view: what that agent reaches; in a team's space: the person's whole PC, as they see it)
    try { const r = await fetchJSON(`/api/pc/find?${new URLSearchParams({ ...(F.space == null ? { profile: P.agent } : {}), q })}`); F.found = r.results; F.view = 'search'; F.err = null; } catch (e) { F.err = e.message; }
    paint();
  }
  async function versions() {
    const f = F.file;
    try { f.versions = (await fetchJSON(`/api/pc/versions?${qs(f.path)}`)).older; } catch (e) { say(e); }
    paint();
  }

  // ---------------------------------------------------------------- drawing
  function places() {
    if (F.space != null) return `<div class="pc-sh">${esc(F.spaceLabel || 'Team')}</div><button class="on" data-go="/">👥 Its folder</button>`;
    const teams = P.teams.filter(t => t.members.some(m => m.agent === P.agent));
    const on = p => (F.view === 'list' && F.path === p ? 'on' : '');
    return `<div class="pc-sh">${esc(P.me()?.name || 'Home')}</div>
      ${['~', '~/Documents', '~/Downloads', '~/Skills', '~/Public'].map(p => `<button class="${on(p)}" data-go="${p}">${p === '~' ? '🏠 Home' : `📂 ${p.slice(2)}`}</button>`).join('')}
      ${teams.length ? `<div class="pc-sh">Teams</div>${teams.map(t => `<button class="${on(`/teams/${t.slug}`)}" data-go="/teams/${esc(t.slug)}">👥 ${esc(t.name)}</button>`).join('')}` : ''}
      ${P.me()?.own ? `<div class="pc-sh">Its own computer</div><button data-own="1">💻 On ${esc(P.me().own.label)}</button>` : ''}
      <div class="pc-sh">&nbsp;</div><button class="${F.view === 'trash' ? 'on' : ''}" data-trash="1">🗑 Trash</button>`;
  }
  /** The same places as the side list, as one list (a narrow PC has no room for the side). */
  function placeSelect() {
    if (F.space != null) return '';
    const teams = P.teams.filter(t => t.members.some(m => m.agent === P.agent));
    const opts = [['~', 'Home'], ['~/Documents', 'Documents'], ['~/Downloads', 'Downloads'], ['~/Skills', 'Skills'], ['~/Public', 'Public'], ...teams.map(t => [`/teams/${t.slug}`, `${t.name} (team)`]), ...(P.me()?.own ? [['own', `On ${P.me().own.label} (its own computer)`]] : []), ['trash', 'Trash']];
    const cur = F.view === 'trash' ? 'trash' : opts.find(o => o[0] === F.path)?.[0] || '';
    return `<select class="pc-places" title="Places">${cur ? '' : '<option value="" selected>Places…</option>'}${opts.map(([v, n]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  }
  function crumbs() {
    const parts = F.path.split('/').filter(Boolean);
    const out = [];
    let acc = F.path.startsWith('/') ? '' : '';
    parts.forEach((p, k) => { acc = k === 0 ? (F.path.startsWith('/') ? `/${p}` : p) : `${acc}/${p}`; out.push(`<button data-go="${esc(acc)}">${esc(p === '~' ? (P.me()?.name || 'Home') : p)}</button>`); });
    return out.join('<i>›</i>') || '<button data-go="/">/</button>';
  }
  function listHtml() {
    const r = F.list;
    if (!r) return '<div class="pc-empty">Opening…</div>';
    if (!r.entries.length) return `<div class="pc-empty">This folder is empty.${r.access === 'r' ? '' : ' Drop files here, or use Upload.'}</div>`;
    return r.entries.map((e, k) => `<div class="pc-file${F.mark != null && e.name === F.mark ? ' pc-mark' : ''}" data-k="${k}"><span class="pc-fi" aria-hidden="true">${icon(e)}</span><span class="pc-fn">${esc(e.title || e.name)}</span>
      <span class="pc-fs">${e.dir ? '' : size(e.size)}</span><span class="pc-fm" title="${e.byName ? esc(`by ${e.byName}`) : ''}">${e.modified ? when(e.modified) : ''}</span>
      <button class="pc-more" data-menu="${k}" title="More">⋯</button></div>`).join('') + (r.more ? '<div class="pc-empty">…more in this folder: narrow it with Search</div>' : '');
  }
  /** A file as the agent has it open now: every line numbered, the lines it just wrote, added or changed marked. */
  function liveHtml(f) {
    const v = f.live || {}, hl = v.hl || null;
    const what = { write: 'Writing', append: 'Adding to it', edit: 'Changing it', read: 'Reading', open: 'Looking at it' }[v.mode] || 'Open';
    const lines = String(f.text ?? '').split('\n');
    return `<div class="pc-livebar"><span class="pc-dot on"></span><b>${esc(P.me()?.name || 'It')}</b> · ${what}${hl ? ` · line${hl[0] === hl[1] ? ` ${hl[0]}` : `s ${hl[0]}–${hl[1]}`}` : ''}</div>
      <div class="pc-live" role="document">${lines.map((l, k) => `<div class="pc-ln${hl && k + 1 >= hl[0] && k + 1 <= hl[1] ? ' hl' : ''}" data-ln="${k + 1}"><i>${k + 1}</i><span>${esc(l) || ' '}</span></div>`).join('')}</div>`;
  }
  function fileHtml() {
    const f = F.file, src = fileUrl(f.path);
    const head = `<div class="pc-tools"><button class="pc-btn" data-back="1">↩</button><b class="pc-grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.info.name)}
      <span class="dim" style="font-weight:400"> · ${size(f.info.size)} · version ${f.info.version}${f.dirty ? ' · not saved' : ''}</span></b>
      ${f.mode === 'live' ? `<button class="pc-btn" data-mode="${f.kind === 'text' ? 'edit' : 'read'}" title="Stop following and open it yourself">✏ ${f.kind === 'text' ? 'Edit' : 'Open'}</button>`
        : f.kind === 'text' ? `${/\.(md|markdown)$/i.test(f.info.name) ? `<button class="pc-btn" data-mode="${f.mode === 'read' ? 'edit' : 'read'}">${f.mode === 'read' ? '✏ Edit' : '👁 Read'}</button>` : ''}<button class="pc-btn primary" data-save="1" ${f.info.access === 'r' ? 'disabled' : ''}>💾 Save</button>` : ''}
      <button class="pc-btn" data-vers="1">⏳ Versions</button><a class="pc-btn" href="${fileUrl(f.path, { download: 1 })}">⬇</a></div>`;
    let body;
    if (f.mode === 'live') body = liveHtml(f);
    else if (f.kind === 'text') body = f.mode === 'read' ? `<div class="pc-md">${md(f.text || '')}</div>` : `<textarea class="pc-text" spellcheck="false" ${f.info.access === 'r' ? 'readonly' : ''}>${esc(f.text || '')}</textarea>`;
    else if (f.kind === 'doc') body = `<div class="pc-note">The words of this document, to read (edit it in its own program: download it, change it, upload it again).</div><div class="pc-md">${md(f.text || '')}</div>`;
    else if (f.kind === 'image') body = `<div class="pc-media"><img src="${src}" alt="${esc(f.info.name)}"></div>`;
    else if (f.kind === 'video') body = `<div class="pc-media"><video src="${src}" controls></video></div>`;
    else if (f.kind === 'audio') body = `<div class="pc-media"><audio src="${src}" controls></audio></div>`;
    else body = `<div class="pc-empty">${f.kind === 'pdf' ? 'A PDF.' : 'This kind of file opens in its own program.'}<br><br><a class="pc-btn primary" href="${fileUrl(f.path, { download: 1 })}">⬇ Download ${esc(f.info.name)}</a></div>`;
    const vers = f.versions ? `<div class="pc-versions">${f.versions.length ? f.versions.map(v => `<div><span>Version ${v.version} · ${size(v.size)} · ${when(v.at)}</span>
      <a class="pc-btn" href="${fileUrl(f.path, { version: v.version, download: 1 })}">⬇</a><button class="pc-btn" data-revert="${v.version}">↺ Bring back</button></div>`).join('') : '<div><span class="dim">No older versions</span></div>'}</div>` : '';
    return `<div class="pc-view">${head}${body}${vers}</div>`;
  }
  function trashHtml() {
    return `<div class="pc-tools"><button class="pc-btn" data-back="1">↩</button><b class="pc-grow">Trash</b><span class="dim">Kept 30 days, then deleted</span>
      <button class="pc-btn danger" data-empty="1" ${F.trash?.length ? '' : 'disabled'}>Empty the trash</button></div>
      <div class="pc-list">${F.trash?.length ? F.trash.map(i => `<div class="pc-file"><span class="pc-fi">${i.dir ? '📂' : '📄'}</span><span class="pc-fn">${esc(i.path)}</span><span class="pc-fs">${i.dir ? '' : size(i.size)}</span>
        <span class="pc-fm">${when(i.deleted)}</span><button class="pc-more" data-restore="${i.id}" title="Put it back">↩</button></div>`).join('') : '<div class="pc-empty">The trash is empty.</div>'}</div>`;
  }
  function searchHtml() {
    return `<div class="pc-list">${F.found?.length ? F.found.map(x => `<div class="pc-file" data-open="${esc(x.path)}" data-dir="${x.dir ? 1 : 0}"><span class="pc-fi">${x.dir ? '📂' : '📄'}</span>
      <span class="pc-fn">${esc(x.path)}${x.snippet ? `<br><small class="dim">${esc(x.snippet)}</small>` : ''}</span><span class="pc-fs">${x.dir ? '' : size(x.size)}</span><span class="pc-fm">${when(x.modified)}</span><span></span></div>`).join('')
      : `<div class="pc-empty">Nothing found for “${esc(F.query)}”.</div>`}</div>`;
  }
  function paintUps() {
    const box = el.querySelector('.pc-ups');
    if (box) box.innerHTML = F.ups.map(u => `<div class="pc-up">${u.err ? `<span class="bad">${esc(u.name)}: ${esc(u.err)}</span>` : `${esc(u.name)} - ${u.pct} %`}</div>`).join('');
  }
  function paint() {
    if (!P.alive) return;
    const ro = F.list?.access === 'r';
    el.innerHTML = `<div class="pc-split"><nav class="pc-side">${places()}</nav><div class="pc-main">
      ${F.view === 'file' ? fileHtml() : F.view === 'trash' ? trashHtml() : `
      <div class="pc-tools">${F.view === 'search' ? '<button class="pc-btn" data-back="1">↩</button>' : ''}${placeSelect()}<div class="pc-crumbs">${F.view === 'search' ? `<b>Search</b>` : crumbs()}</div>
        <input type="search" class="pc-q" placeholder="Search files" value="${esc(F.query)}" style="width:150px">
        ${F.view === 'list' && !ro ? '<button class="pc-btn" data-new="1" title="New document">📄 New</button><button class="pc-btn" data-mkdir="1" title="New folder">📂 Folder</button><button class="pc-btn primary" data-up="1">⬆ Upload</button>' : ''}
        <input type="file" multiple hidden class="pc-file-in"></div>
      ${F.err ? `<div class="pc-err">${esc(F.err)}</div>` : ''}<div class="pc-ups"></div>
      ${F.view === 'search' ? searchHtml() : `<div class="pc-list">${listHtml()}</div>`}`}
      ${F.view !== 'list' && F.err ? `<div class="pc-err">${esc(F.err)}</div>` : ''}</div></div>`;
    paintUps();
    const ta = el.querySelector('textarea.pc-text');
    if (ta) ta.addEventListener('input', () => { if (!F.file.dirty) { F.file.dirty = true; F.file.text = ta.value; const b = el.querySelector('.pc-tools b span'); if (b) b.textContent += ' · not saved'; } else F.file.text = ta.value; });
  }

  // ---------------------------------------------------------------- input
  el.addEventListener('click', e => {
    const t = e.target.closest('button, .pc-file, a');
    if (!t || !el.contains(t)) return;
    if (t.dataset.go !== undefined) return load(t.dataset.go);
    if (t.dataset.trash) return showTrash();
    if (t.dataset.own) return P.open('computer');
    if (t.dataset.back) { if (F.file?.dirty && !confirm('Leave without saving?')) return; F.query = ''; return load(F.path); }
    if (t.dataset.menu !== undefined) { e.stopPropagation(); return rowMenu(t, F.list.entries[Number(t.dataset.menu)]); }
    if (t.dataset.k !== undefined && t.classList.contains('pc-file')) { const x = F.list.entries[Number(t.dataset.k)]; return x.dir ? load(x.path) : openFile(x.path); }
    if (t.dataset.open) return t.dataset.dir === '1' ? load(t.dataset.open) : openFile(t.dataset.open);
    if (t.dataset.up) return el.querySelector('.pc-file-in').click();
    if (t.dataset.new) return newFile();
    if (t.dataset.mkdir) { const n = ask('Name of the new folder', 'New folder'); if (n) act(() => P.post('mkdir', where(join(F.path, n))), 'Folder made'); return; }
    if (t.dataset.save) return save();
    if (t.dataset.mode) { const ta = el.querySelector('textarea.pc-text'); if (ta) F.file.text = ta.value; F.file.mode = t.dataset.mode; return paint(); }
    if (t.dataset.vers) return F.file.versions ? (F.file.versions = null, paint()) : versions();
    if (t.dataset.revert) { if (confirm(`Bring back version ${t.dataset.revert}? The current one is kept as a version.`)) act(() => P.post('revert', { ...where(F.file.path), version: Number(t.dataset.revert) }), 'Brought back').then(() => openFile(F.file.path)); return; }
    if (t.dataset.restore) return act(() => P.post('restore', { id: Number(t.dataset.restore) }), 'Put back').then(showTrash);
    if (t.dataset.empty) { if (confirm('Delete everything in the trash for good?')) act(() => P.post('empty-trash', where(F.space != null ? '/' : '~')), 'The trash is empty').then(showTrash); }
  });
  el.addEventListener('change', e => {
    if (e.target.classList.contains('pc-file-in') && e.target.files.length) upload([...e.target.files]);
    if (e.target.classList.contains('pc-places') && e.target.value) { if (e.target.value === 'trash') showTrash(); else if (e.target.value === 'own') P.open('computer'); else load(e.target.value); }
  });
  el.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && F.view === 'file') { e.preventDefault(); save(); }
    if (e.key === 'Enter' && e.target.classList.contains('pc-q')) search(e.target.value);
  });
  el.addEventListener('dragover', e => { if (F.view !== 'list' || F.list?.access === 'r' || ![...(e.dataTransfer?.types || [])].includes('Files')) return; e.preventDefault(); el.querySelector('.pc-list')?.classList.add('drop'); });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.querySelector('.pc-list')?.classList.remove('drop'); });
  el.addEventListener('drop', e => { if (F.view !== 'list' || !e.dataTransfer?.files?.length) return; e.preventDefault(); el.querySelector('.pc-list')?.classList.remove('drop'); upload([...e.dataTransfer.files]); });

  // (opened following the agent: its file live, its search, the folder with what it made marked)
  if (args.live) openFile(args.path, { live: args.live }); else if (args.find) search(args.find); else load();
  return {
    go(a) {
      if (a.space !== undefined) { F.space = a.space; F.spaceLabel = a.spaceLabel || null; }
      F.mark = a.mark ?? null;
      if (a.live) { if (F.file?.dirty) return; openFile(a.path, { live: a.live }); return; }
      if (a.find) { search(a.find); return; }
      load(a.path || F.path);
    },
    // (a change somewhere on the PC: the folder shown is read again - only while a folder is shown, never pulling the
    // person out of a file they opened meanwhile)
    onFrame(f) { if (f.kind === 'files' && F.view === 'list') { clearTimeout(soon); soon = setTimeout(() => { if (F.view === 'list') load(); }, 300); } },
    destroy() { clearTimeout(soon); },
  };
}
