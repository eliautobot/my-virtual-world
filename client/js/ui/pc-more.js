// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The PC's other apps (client/js/ui/pc-app.js): Teams (the account's teams - who is in each and as what, its brief,
// its folder; made, renamed, deleted and brought back), Browser (what the agent is reading: its browser service's screen
// when it has one, the pages it opened - or, for an Agent Providers' agent, its provider's own browser, live), Activity (what it did on its PC, live), Terminal (the agent's own command line,
// as it uses it), Settings (storage, whether it works on tasks by itself, its browser and search, the trash).
import { esc } from '../core/util.js';
import { getJSON } from '../core/net.js';
import { size, when } from './pc-ui.js';
import { mountProviderBrowser } from './provider-browser.js';
import { mountProviderScreen } from './provider-screen.js';

const ROLE = { lead: 'Lead', member: 'Member', viewer: 'Viewer (reads only)' };
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#84cc16'];

// ------------------------------------------------------------------------------------------- Teams
export function teamsApp(P, el) {
  const T = { teams: [], gone: [], open: null, err: null };
  async function load() {
    try { const r = await getJSON('/api/pc/teams'); T.teams = r.teams; T.gone = r.gone; T.err = null; P.teams = r.teams; } catch (e) { T.err = e.message; }
    paint();
  }
  const team = () => T.teams.find(t => t.id === T.open) || null;
  async function call(path, body, ok) { try { const r = await P.post(path, body); if (ok) P.toast(ok, 'good'); return r; } catch (e) { P.err(e); return null; } finally { load(); } }
  function detail(t) {
    const others = P.agents.filter(a => !t.members.some(m => m.agent === a.id));
    return `<div class="pc-pad"><div style="display:flex;gap:8px;align-items:center"><button class="pc-btn" data-list="1">↩</button><h3 style="margin:0;flex:1">${esc(t.name)}</h3>
        <button class="pc-btn" data-folder="1">📂 Its folder</button><button class="pc-btn" data-board="1">📋 Its board</button></div>
      <form class="pc-form pc-tform" style="margin-top:12px"><div class="pc-row2"><label>Name<input name="name" value="${esc(t.name)}" maxlength="40"></label>
        <label>Colour<input name="color" type="color" value="${esc(t.color || COLORS[t.id % COLORS.length])}"></label></div>
        <label>Brief - what the team is for and how it works (every member reads it)<textarea name="brief" rows="4" maxlength="4000">${esc(t.brief)}</textarea></label>
        <div><button class="pc-btn primary">Save</button> <span class="dim">${size(t.used)} in its folder</span></div></form>
      <h4 style="margin:16px 0 6px">Members</h4>
      ${t.members.length ? t.members.map(m => `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--line)"><span style="flex:1">${esc(P.agents.find(a => a.id === m.agent)?.emoji || '🤖')} ${esc(P.name(m.agent))}</span>
        <select data-role="${m.agent}">${Object.entries(ROLE).map(([r, n]) => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <button class="pc-btn" data-out="${m.agent}" title="Take out of the team">✕</button></div>`).join('') : '<p class="dim">No one yet.</p>'}
      ${others.length ? `<form class="pc-add pc-mform" style="margin-top:8px"><select name="agent">${others.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
        <select name="role">${Object.entries(ROLE).map(([r, n]) => `<option value="${r}" ${r === 'member' ? 'selected' : ''}>${n}</option>`).join('')}</select><button class="pc-btn">➕ Add</button></form>` : ''}
      <p class="dim" style="margin-top:14px">Members share the team's folder, board and calendar. They never see each other's own files. A file made in the team's folder belongs to the team.</p>
      <button class="pc-btn danger" data-delteam="1">🗑 Delete the team</button></div>`;
  }
  function paint() {
    if (!P.alive) return;
    const t = team();
    el.innerHTML = `<div class="pc-main">${T.err ? `<div class="pc-err">${esc(T.err)}</div>` : ''}${t ? detail(t) : `<div class="pc-pad">
      <form class="pc-add pc-newteam"><input name="name" placeholder="A new team's name" maxlength="40"><button class="pc-btn primary">➕ Make the team</button></form>
      ${T.teams.length ? T.teams.map(x => `<div class="pc-file" data-team="${x.id}" style="grid-template-columns:26px minmax(0,1fr) auto auto"><span class="pc-fi" style="color:${esc(x.color || COLORS[x.id % COLORS.length])}">👥</span>
        <span class="pc-fn"><b>${esc(x.name)}</b> <span class="dim">· ${x.members.length} member${x.members.length === 1 ? '' : 's'}</span><br><small class="dim">${esc(x.brief.slice(0, 120) || 'No brief yet')}</small></span>
        <span class="pc-fs">${size(x.used)}</span><span>›</span></div>`).join('') : '<div class="pc-empty">No teams yet. Make one, then add your agents to it.</div>'}
      ${T.gone.length ? `<h4 style="margin:18px 0 6px">Recently deleted</h4>${T.gone.map(x => `<div class="pc-file" style="grid-template-columns:26px minmax(0,1fr) auto"><span class="pc-fi">🗑</span><span class="pc-fn">${esc(x.name)} <small class="dim">· kept until ${when(x.until)}</small></span>
        <button class="pc-btn" data-restore="${x.id}">↩ Bring back</button></div>`).join('')}` : ''}</div>`}</div>`;
  }
  el.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    if (f.classList.contains('pc-newteam') && f.name.value.trim()) { const r = await call('teams', { name: f.name.value.trim() }, 'Team made'); if (r) T.open = r.id; }
    if (f.classList.contains('pc-tform')) call('teams/update', { id: T.open, name: f.name.value, brief: f.brief.value, color: f.color.value }, 'Saved');
    if (f.classList.contains('pc-mform')) call('teams/member', { team: T.open, agent: Number(f.agent.value), role: f.role.value }, 'Added');
  });
  el.addEventListener('change', e => { const r = e.target.dataset.role; if (r) call('teams/member', { team: T.open, agent: Number(r), role: e.target.value }); });
  el.addEventListener('click', e => {
    const row = e.target.closest('[data-team]');
    if (row) { T.open = Number(row.dataset.team); return paint(); }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.list) { T.open = null; return paint(); }
    if (b.dataset.out && confirm(`Take ${P.name(b.dataset.out)} out of the team? Its tasks there go back to no one.`)) call('teams/member', { team: T.open, agent: Number(b.dataset.out), role: null }, 'Taken out');
    if (b.dataset.delteam && confirm('Delete this team? Its folder, board and calendar are kept 30 days in case you bring it back.')) { call('teams/delete', { id: T.open }, 'Deleted'); T.open = null; }
    if (b.dataset.restore) call('teams/restore', { id: Number(b.dataset.restore) }, 'Brought back');
    const t = team();
    if (b.dataset.folder && t) P.open('files', { space: t.space, spaceLabel: t.name, path: '/' });
    if (b.dataset.board && t) {
      if (t.members.some(m => m.agent === P.agent)) P.open('board', { board: `/teams/${t.slug}` });
      else P.toast(`${P.me()?.name || 'This agent'} isn't in ${t.name}: switch to one of its members, or add it`, 'bad');
    }
  });
  load();
  return { onFrame(f) { if (f.kind === 'teams') load(); } };
}

// ------------------------------------------------------------------------------------------- Browser
export function browserApp(P, el, args = {}) {
  // (its real browser, live - an Agent Providers' agent's: its provider's own (OpenClaw's), or its own screen where its
  // browser opens (Hermes' Bot Desktop, ./provider-screen.js); a built-in agent's: the installation's built-in Chrome -
  // ./provider-browser.js; beside it the reader's pages. No real browser here: the reader)
  const me = P.me();
  if (me?.own?.browser) return twoBrowsers(P, el, args, { label: `${me.own.label}'s browser` });
  if (me?.own?.screen) return twoBrowsers(P, el, args, { label: 'Its screen', icon: '🖥', screen: true });
  if (!me?.own && P.realBrowser) return twoBrowsers(P, el, args, { label: 'Its browser', base: '/api/pc/browser', idle: `${me?.name || 'Its'} browser isn't open.` });
  return readerApp(P, el, args);
}
/** Its real browser (live, to use as the agent does) and the built-in reader's pages, one at a time. */
function twoBrowsers(P, el, args, o = {}) {
  el.innerHTML = `<div class="pc-main"><div class="pc-tools pc-seg" role="tablist"><button role="tab" data-b="own">${o.icon || '🌐'} ${esc(o.label)}</button><button role="tab" data-b="reader">📖 Reader</button></div><div class="pc-bwhost"></div></div>`;
  const host = el.querySelector('.pc-bwhost');
  let which = null, inst = null;
  function show(b) {
    if (b === which) return;
    inst?.destroy?.(); host.innerHTML = '';
    which = b;
    for (const x of el.querySelectorAll('[data-b]')) { const on = x.dataset.b === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); }
    const box = document.createElement('div');
    box.className = 'pc-bwbox';
    host.append(box);
    inst = b !== 'own' ? readerApp(P, box, args) : o.screen ? mountProviderScreen(box, P.agent, { toast: P.toast }) : mountProviderBrowser(box, P.agent, { base: o.base, idle: o.idle });
  }
  el.querySelector('.pc-seg').addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (b) show(b.dataset.b); });
  // (following the agent: its real browser for a page it opened there; the reader's for one it read with the reader)
  const readerFor = a => !!(a.reader || (a.live && !a.live.provider && !a.live.live));
  show(readerFor(args) ? 'reader' : 'own');
  return {
    go(a) { args = a; show(readerFor(a) ? 'reader' : 'own'); if (which === 'reader') inst?.go?.(a); },
    onFrame(f) { if (which === 'reader') inst?.onFrame?.(f); },
    destroy() { inst?.destroy?.(); },
  };
}
function readerApp(P, el, args = {}) {
  const W = { pages: [], shot: null, shotAt: 0, err: null, url: null, live: args.live || null };
  let img = null, timer = null, gone = false;
  async function load() {
    try { W.pages = (await getJSON(`/api/pc/history?agent=${P.agent}&limit=40`)).pages; W.err = null; } catch (e) { W.err = e.message; }
    paint(); shot();
  }
  async function shot() {
    try {
      const r = await fetch(`/api/pc/browser/shot?agent=${P.agent}`, { cache: 'no-store' });
      if (r.status === 200) {
        const at = Number(r.headers.get('x-shot-at')) || 0;
        if (at !== W.shotAt) { if (W.shot) URL.revokeObjectURL(W.shot); W.shot = URL.createObjectURL(await r.blob()); W.shotAt = at; W.url = decodeURIComponent(r.headers.get('x-page-url') || ''); paint(); }
      }
    } catch { /* the next look */ }
    if (gone) return;
    if (P.alive && !el.closest('[hidden]')) { clearTimeout(timer); timer = setTimeout(shot, 2500); } else { clearTimeout(timer); timer = setTimeout(shot, 6000); }
  }
  /** The page the agent reads now (following it): its words as it has them, or the results of its search. */
  function liveHtml() {
    const v = W.live;
    if (!v || (v.kind !== 'page' && v.kind !== 'web') || (v.kind === 'page' && v.shot && W.shot)) return '';
    if (v.kind === 'web') return `<div class="pc-reading"><div class="pc-livebar"><span class="pc-dot on"></span><b>${esc(P.me()?.name || 'It')}</b> · searching the web for “${esc(v.query)}”</div>
      ${v.results.map(r => `<a href="${esc(r.href)}" target="_blank" rel="noopener noreferrer"><b>${esc(r.title)}</b><small>${esc(r.href)}</small>${r.text ? `<small>${esc(r.text)}</small>` : ''}</a>`).join('')}</div>`;
    return `<div class="pc-reading"><div class="pc-livebar"><span class="pc-dot on"></span><b>${esc(P.me()?.name || 'It')}</b> · reading${v.part > 1 ? ` (part ${v.part})` : ''}</div>
      <h3>${esc(v.title || v.url)}</h3><div class="pc-md">${(v.lines || []).map(l => (/^#{1,6}\s/.test(l) ? `<h4>${esc(l.replace(/^#{1,6}\s/, ''))}</h4>` : l.trim() ? `<p>${esc(l)}</p>` : '')).join('')}</div></div>`;
  }
  function paint() {
    if (!P.alive) return;
    const cur = (W.live?.kind === 'page' && W.live.url) || W.url || W.pages[0]?.url || '';
    el.innerHTML = `<div class="pc-main"><div class="pc-tools"><span class="pc-addr"><span aria-hidden="true">🌐</span><span>${esc(cur || 'Nothing open yet')}</span></span>
      ${cur ? `<a class="pc-btn" href="${esc(cur)}" target="_blank" rel="noopener noreferrer">↗ Open it yourself</a>` : ''}</div>
      ${W.err ? `<div class="pc-err">${esc(W.err)}</div>` : ''}
      ${liveHtml()}${W.shot ? `<div class="pc-shot"><img alt="What its browser shows" src="${W.shot}"></div>` : W.live ? '' : `<div class="pc-note">${esc(P.me()?.name || 'It')} reads pages with the built-in reader: their words and links, no pictures. To have it use a full browser - sign in to sites, click and type - add a <b>Browser service</b> in Settings → Connections; its screen then shows here.</div>`}
      <div class="pc-hist" style="${W.shot ? 'max-height:30%;' : ''}overflow:auto;flex:${W.shot ? 'none' : '1'}">${W.pages.length ? W.pages.map(p => `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(p.title)}</b><small>${esc(when(p.at))} · ${esc(p.url)}</small>${p.summary ? `<small>${esc(p.summary)}</small>` : ''}</a>`).join('') : '<div class="pc-empty">It hasn\'t opened any page yet.</div>'}</div></div>`;
    img = el.querySelector('.pc-shot img');
  }
  load();
  return {
    go(a) { W.live = a.live || null; paint(); if (a.live?.shot) shot(); },
    onFrame(f) { if (f.kind === 'screen' && f.screen?.agent === P.agent && f.screen.app === 'browser') { load(); } },
    destroy() { gone = true; clearTimeout(timer); if (W.shot) URL.revokeObjectURL(W.shot); img = null; },
  };
}

// ------------------------------------------------------------------------------------------- Activity
export function activityApp(P, el) {
  let items = [], err = null;
  async function load() { try { items = (await getJSON(`/api/pc/activity?agent=${P.agent}&limit=150`)).items; err = null; } catch (e) { err = e.message; } paint(); }
  const row = (x, isNew = false) => `<div class="${isNew ? 'pc-new' : ''}"><span>${esc(when(x.at))}</span><span>${esc(x.what)}</span></div>`;
  function paint() {
    if (!P.alive) return;
    el.innerHTML = `<div class="pc-main"><div class="pc-tools"><b class="pc-grow">What ${esc(P.me()?.name || 'it')} did on its PC</b><span class="dim">kept 7 days</span></div>
      ${err ? `<div class="pc-err">${esc(err)}</div>` : ''}<div class="pc-feed">${items.length ? items.map(x => row(x)).join('') : '<div class="pc-empty">Nothing yet.</div>'}</div></div>`;
  }
  load();
  return {
    onFrame(f) {
      if (f.kind !== 'activity' || f.item?.agent !== P.agent) return;
      items.unshift(f.item); if (items.length > 300) items.pop();
      const feed = el.querySelector('.pc-feed');
      if (feed) { feed.querySelector('.pc-empty')?.remove(); feed.insertAdjacentHTML('afterbegin', row(f.item, true)); }
    },
  };
}

// ------------------------------------------------------------------------------------------- Terminal
export function terminalApp(P, el, args = {}) {
  const hist = [];
  let at = -1, cwd = '~';
  el.innerHTML = `<div class="pc-term"><pre class="pc-agentlog" hidden></pre><pre>${esc(`${P.me()?.name || 'Agent'}'s PC - the command line it uses. Type help for the commands.\n`)}</pre>
    <form><span style="align-self:center">${'>'}</span><input autocomplete="off" spellcheck="false" placeholder="ls ~/Documents"><button class="pc-btn">Run</button></form></div>`;
  const out = el.querySelector('pre'), input = el.querySelector('input');
  const print = (html) => { out.insertAdjacentHTML('beforeend', html); out.scrollTop = out.scrollHeight; };
  el.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const line = input.value.trim();
    if (!line) return;
    hist.unshift(line); at = -1; input.value = '';
    print(`<span class="pc-cmd">${esc(cwd)} $ ${esc(line)}</span>\n`);
    try {
      const r = await P.post('shell', { agent: P.agent, run: line, session: 'terminal' });
      cwd = r.cwd || cwd;
      print(`${r.text.split('\n').map(l => (/^error:/.test(l) ? `<span class="pc-errl">${esc(l)}</span>` : esc(l))).join('\n')}\n\n`);
    } catch (err) { print(`<span class="pc-errl">${esc(err.message)}</span>\n\n`); }
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' && hist.length) { at = Math.min(hist.length - 1, at + 1); input.value = hist[at]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { at = Math.max(-1, at - 1); input.value = at >= 0 ? hist[at] : ''; e.preventDefault(); }
  });
  // (following the agent: its own terminal - the commands it ran and what they said - above this one)
  const log = el.querySelector('.pc-agentlog');
  const showLog = lines => {
    log.hidden = !lines?.length;
    if (lines?.length) { log.innerHTML = `<span class="pc-livebar"><span class="pc-dot on"></span><b>${esc(P.me()?.name || 'It')}</b> · its terminal</span>\n${lines.map(l => (/^\$ /.test(l) ? `<span class="pc-cmd">${esc(l)}</span>` : /^(error|✗)/.test(l) ? `<span class="pc-errl">${esc(l)}</span>` : esc(l))).join('\n')}`; log.scrollTop = log.scrollHeight; }
  };
  showLog(args.log);
  if (!args.log) setTimeout(() => input.focus(), 50);
  return { go(a = {}) { if (a.log) showLog(a.log); else input.focus(); } };
}

// ------------------------------------------------------------------------------------------- Settings
export function settingsApp(P, el) {
  let prof = null, err = null;
  async function load() {
    try { prof = await getJSON(`/api/pc/profile?agent=${P.agent}`); const o = await getJSON('/api/pc'); P.usage = o.usage; P.teams = o.teams; err = null; } catch (e) { err = e.message; }
    paint();
  }
  function paint() {
    if (!P.alive) return;
    const u = P.usage, pct = u && u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0, me = P.me();
    const spaces = (u?.spaces || []).filter(s => s.used > 0).sort((a, b) => b.used - a.used).slice(0, 12);
    const label = s => (s.kind === 'agent' ? P.name(s.ref) : `${P.teams.find(t => t.id === s.ref)?.name || 'A team'} (team)`);
    el.innerHTML = `<div class="pc-pad">${err ? `<div class="pc-err">${esc(err)}</div>` : ''}
      <h3 style="margin-top:0">Storage</h3>${u ? `<div class="pc-meter ${pct >= 100 ? 'full' : pct >= 80 ? 'warn' : ''}"><i style="width:${pct}%"></i></div>
        <p>${size(u.used)} used${u.limit ? ` of ${size(u.limit)} (${pct} %)` : ' (no limit)'} - ${u.agents} agent${u.agents === 1 ? '' : 's'} × ${size(u.perAgent)}${u.teams ? ` + ${u.teams} team${u.teams === 1 ? '' : 's'} × ${size(u.perTeam)}` : ''}, shared by them all. One file is at most ${size(u.fileMax)}. The trash and older versions don't count.</p>
        ${spaces.length ? spaces.map(s => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--line)"><span>${esc(label(s))}</span><span class="dim">${size(s.used)}</span></div>`).join('') : ''}` : ''}
      <h3>${esc(me?.name || 'This agent')} at work</h3>
      ${prof ? `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" class="pc-auto" ${prof.autoWork !== false ? 'checked' : ''} style="width:auto">
        Works on a task by itself when someone gives it one</label>` : '<p class="dim">…</p>'}
      <p class="dim">Off: tasks wait until you press ▶ Work on it. Each session counts toward its thinking limits (Settings → The Mind).</p>
      ${prof?.working ? `<p class="good">⚡ Working on task #${prof.working.card} now · step ${prof.working.steps + 1}</p>` : ''}${prof?.queued?.length ? `<p class="dim">Waiting: ${prof.queued.map(q => `#${q.card}`).join(', ')}</p>` : ''}
      <h3>Browser and search</h3>
      <p>Pages are read with the built-in reader, unless you add a <b>Browser service</b> (any Chrome DevTools browser: a cloud browser for AI agents, a Lightpanda, your own Chrome) - then ${esc(me?.name || 'it')} can sign in, click and type. Web search uses your <b>Search service</b> (Brave or your own SearXNG) if you add one. Both: Settings → Connections.</p>
      <h3>Who can see this PC</h3><p class="dim">Only your account. Other players see a glowing screen on its desk; people your agent is shared with, administrators and visitors can't open any of it. In a chat with a visitor, your agent can only read its Public folder.</p></div>`;
  }
  el.addEventListener('change', async e => {
    if (!e.target.classList.contains('pc-auto')) return;
    try { await P.post('profile', { agent: P.agent, autoWork: e.target.checked }); P.toast(e.target.checked ? 'It works on tasks by itself' : 'Tasks wait for you now', 'good'); } catch (er) { P.err(er); }
    load();
  });
  load();
  return { onFrame(f) { if (f.kind === 'files' || f.kind === 'board') { clearTimeout(this.t); this.t = setTimeout(load, 800); } } };
}
