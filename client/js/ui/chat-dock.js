// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat window's side panel (Agent Providers, docs/features/agent-providers.md §4), as beside a chat in OpenClaw's
// Control UI, for whoever manages the provider. Tasks: the background work the agent started from this chat -
// subagents, scheduled jobs, CLI and ACP runs - the running ones and the latest finished, each with what it is doing or
// waiting for, kept up to date as the provider announces changes; a task's prompt, output and transcript; Stop. Under the
// composer, a row says how many are running and opens the panel. Browser: the provider's own browser, the one its agents
// browse with - its tabs, the page live, and the person's clicks, scrolling and typing on it (a browser shared with the
// agent). Phone: the agent's phone (./phone-app.js, docs/features/phone.md) - any agent's, for its owner or whoever it is
// shared with to manage: its texts, calls, voicemail and contacts beside the chat. PC: the agent's PC (./pc-app.js,
// docs/features/agent-pc.md) - for the account whose PC it is: what it is doing on it, live, beside the chat (the
// Sidebar's 💻 PC opens it too). The panel sits beside the conversation
// when the window has room, and slides over it when it hasn't.
import { getJSON, post } from '../core/net.js';
import { esc } from '../core/util.js';
import { icon } from '../core/icons.js';
import { render } from './chat-md.js';
import { auth } from '../core/auth.js';
import { bus } from '../core/state.js';
import { mountPhone } from './phone-app.js';
import { providerBrowser } from './provider-browser.js';
import { mountProviderScreen } from './provider-screen.js';
import { mountPc } from './pc-app.js';

const SIDE_W = 268;     // the Sidebar's width beside the conversation (css: .chatwin.wide)
const DOCK_W = 360;     // the panel's width beside it (css: --cw-dock-w)
const DOCK_W_BROWSER = 560;   // … wider while it shows the browser (css: .chatwin.dock-browsing)
const MAIN_MIN = 440;   // the conversation keeps at least this much beside the panel; less, and the panel slides over it
const RECENT_MAX = 100;
// the agents whose PC is this account's (GET /api/pc): read once, again after a minute - the PC tab is theirs alone
let pcIds = null, pcAt = 0, pcLoading = null;
function readPcIds() {
  if (!auth.can('agents.pc')) { pcIds = new Set(); return Promise.resolve(pcIds); }
  if (pcIds && Date.now() - pcAt < 60000) return Promise.resolve(pcIds);
  pcLoading ||= getJSON('/api/pc').then(o => { pcIds = new Set(o.agents.map(a => a.id)); pcAt = Date.now(); return pcIds; }, () => pcIds || new Set()).finally(() => { pcLoading = null; });
  return pcLoading;
}
// Which tasks the Tasks tab lists: this chat's (as beside a chat in OpenClaw's Control UI), or all of the agent's - its
// scheduled jobs and command runs belong to no chat (OpenClaw's Tasks page). The person's choice, kept in this browser.
const SCOPE_KEY = 'mvw.chat.taskScope';
const AGENT_POLL_MS = 15000;    // all of an agent's tasks with no chat followed (one just begun): read again this often
const readScope = () => { try { return localStorage.getItem(SCOPE_KEY) === 'agent' ? 'agent' : 'chat'; } catch { return 'chat'; } };
const RUNTIME = { subagent: 'Subagent', cron: 'Automation', acp: 'ACP', cli: 'CLI' };
const STATUS = { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', timed_out: 'Timed out' };
const WAITING = { children: 'Waiting for children', external: 'Waiting for an external result', agent_messages: 'Waiting for agent messages', approval: 'Waiting for approval', user_input: 'Waiting for your input' };
const DELIVERY = { pending: 'Waiting to send to parent', session_queued: 'Queued for parent', delivered: 'Delivered to parent', failed: 'Delivery failed · result retained',
  dismissed: 'Delivery dismissed · result retained', parent_missing: 'Parent unavailable · result retained' };
const live = t => t.status === 'queued' || t.status === 'running';
const titleOf = t => t.title || 'Background task';
/** How long: "42s", "3m 05s", "2h 10m". */
function span(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
}
function ago(t) {
  const s = (Date.now() - t) / 1000;
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(t).toLocaleDateString();
}

/** @param {{ el: HTMLElement, agentId: number|null, session: object|null, can: () => object|null, wide: () => boolean, toast: Function }} host */
export function attach(host) {
  const D = { open: false, tab: 'tasks', key: null, scope: readScope(), active: [], recent: [], loaded: false, loading: false, error: null, finishedOpen: false,
    detail: null, details: new Map(), transcripts: new Map(), stopping: new Set(), timer: null, seq: 0, poll: null };
  const $ = s => host.el.querySelector(s);
  /** What the panel has for this agent: its tasks, its provider's browser (whoever manages the provider). */
  const has = () => {
    const c = host.can(), ok = !!(c && c.ok && c.manage), a = host.agent;
    return { tasks: ok && !!c.caps?.tasks, browser: ok && !!c.caps?.browser, screen: ok && !!c.caps?.screen, phone: !!(a && (a.mine || a.level === 'manage') && auth.can('agents.phone')),
      pc: !!(host.agentId && pcIds?.has(host.agentId)) };
  };
  const enabled = () => { const h = has(); return h.tasks || h.browser || h.screen || h.phone || h.pc; };
  // the Screen tab: the agent's own screen (Hermes' Bot Desktop - ./provider-screen.js), mounted while the tab shows
  const Sc = { agent: null, app: null };
  function dropScreen() { Sc.app?.destroy(); Sc.app = null; Sc.agent = null; }
  // the PC tab: the agent's PC, mounted while the tab shows (its own window component; it follows what the agent does)
  const Pc = { agent: null, app: null };
  function dropPc() { Pc.app?.destroy(); Pc.app = null; Pc.agent = null; }
  // the Phone tab: the agent's phone, mounted while the tab shows (M), and what is new on it (the button's and tab's badge)
  const M = { agent: null, app: null, counts: null, want: null, timer: null };
  const phoneCount = () => (M.counts ? (M.counts.unread || 0) + (M.counts.missed || 0) + (M.counts.drafts || 0) : 0);
  function dropPhone() { M.app?.destroy(); M.app = null; M.agent = null; }
  async function readPhoneCounts() {
    const id = host.agentId;
    if (!has().phone) { M.counts = null; return; }
    try { const r = await getJSON('/api/phone/summary'); if (host.agentId === id) { const x = r.phones.find(p => p.agent === id); M.counts = x ? { unread: x.unread, missed: x.missed, drafts: x.drafts } : null; paint(); } }
    catch { /* the badge waits for the next change */ }
  }
  const offPhone = bus.on('msg:phone', m => { if (Number(m?.agent) === host.agentId && !M.app) { clearTimeout(M.timer); M.timer = setTimeout(readPhoneCounts, 300); } });
  const chatOf = () => (host.session && host.session.key !== '@new' ? host.session.id : null);
  const keyOf = () => (D.scope === 'agent' ? (host.agentId ? `${host.agentId}|agent` : null) : chatOf() ? `${host.agentId}|${chatOf()}|chat` : null);
  const q = () => `agent=${host.agentId}${chatOf() ? `&session=${chatOf()}` : ''}${D.scope === 'agent' ? '&scope=agent' : ''}`;
  /** This chat's running tasks (the row under the conversation and the counts say these, whichever list shows). */
  const running = () => D.active.filter(t => t.here !== false);

  // ---------------------------------------------------------------- reading
  /** The chat changed (another agent, another chat, a chat just begun): its tasks are read; the same chat: nothing. */
  function sync() {
    if (bw.agent !== (has().browser ? host.agentId : null)) resetBrowser();
    if (M.agent !== null && M.agent !== host.agentId) dropPhone();
    if (Pc.agent !== null && Pc.agent !== host.agentId) dropPc();
    if (Sc.agent !== null && Sc.agent !== host.agentId) dropScreen();
    if (!pcIds || Date.now() - pcAt > 60000) readPcIds().then(() => paint());
    if (M.countsFor !== host.agentId) { M.counts = null; M.countsFor = host.agentId; readPhoneCounts(); }
    const k = has().tasks ? keyOf() : null;
    if (k === D.key) { paint(); return; }
    D.key = k; D.active = []; D.recent = []; D.loaded = false; D.error = null; D.detail = null; D.details.clear(); D.transcripts.clear(); D.stopping.clear();
    if (k) load(); else paint();
  }
  async function load() {
    if (!D.key) return;
    const seq = ++D.seq, key = D.key;
    D.loading = true; D.error = null; paint();
    try {
      const r = await getJSON(`/api/providers/tasks?${q()}`);
      if (seq !== D.seq || key !== D.key) return;
      D.active = r.active || []; D.recent = r.recent || []; D.loaded = true;
    } catch (e) { if (seq === D.seq) D.error = e.message || 'Could not load tasks.'; }
    finally { if (seq === D.seq) { D.loading = false; paint(); } }
  }
  /** A task's prompt, output and transcript (read again when it ends: its result is there then). */
  async function loadDetail(id) {
    const key = D.key;
    D.transcripts.set(id, { loading: true });
    paint();
    const [one, tr] = await Promise.allSettled([getJSON(`/api/providers/tasks/one?${q()}&task=${encodeURIComponent(id)}`), getJSON(`/api/providers/tasks/history?${q()}&task=${encodeURIComponent(id)}`)]);
    if (key !== D.key) return;
    if (one.status === 'fulfilled') { D.details.set(id, one.value.task); upsert(one.value.task, false); }
    else D.details.set(id, { error: one.reason?.status === 404 ? 'This task is no longer available.' : 'Could not load task details.' });
    D.transcripts.set(id, tr.status === 'fulfilled' ? { messages: tr.value.messages || [], next: tr.value.nextCursor || null } : { error: 'Could not load task transcript.' });
    paint();
  }
  async function moreTranscript(id) {
    const t = D.transcripts.get(id), key = D.key;
    if (!t || !t.next || t.more) return;
    t.more = true; paint();
    try {
      const r = await getJSON(`/api/providers/tasks/history?${q()}&task=${encodeURIComponent(id)}&cursor=${encodeURIComponent(t.next)}`);
      if (key !== D.key) return;
      t.messages = [...(r.messages || []), ...t.messages]; t.next = r.nextCursor || null;
    } catch { host.toast('Could not load task transcript.', 'bad'); }
    finally { t.more = false; paint(); }
  }

  // ---------------------------------------------------------------- changes
  /** One task as it stands now, into its list (a running one first; the finished, the latest ended first). */
  function upsert(t, repaint = true) {
    if (!t || !t.id) return;
    D.active = D.active.filter(x => x.id !== t.id); D.recent = D.recent.filter(x => x.id !== t.id);
    if (live(t)) D.active = [t, ...D.active];
    else { D.recent = [t, ...D.recent].sort((a, b) => (b.endedAt || b.updatedAt || 0) - (a.endedAt || a.updatedAt || 0)).slice(0, RECENT_MAX); D.stopping.delete(t.id); }
    const d = D.details.get(t.id);
    if (d && !d.error) {
      const ended = live(d) && !live(t);
      D.details.set(t.id, { ...d, ...t });
      if (ended && D.detail === t.id) loadDetail(t.id);   // (its output and the end of its transcript)
    }
    if (repaint) paint();
  }
  /** A change the provider announced for the open chat's agent (server: session.task) - `here`: the chat's own. */
  function onTask(c) {
    if (!D.key || !c) return;
    if (c.change === 'upserted' && c.task) { if (D.scope === 'agent' || c.here !== false) upsert({ ...c.task, here: c.here !== false }); }
    else if (c.change === 'deleted' && c.taskId) { D.active = D.active.filter(x => x.id !== c.taskId); D.recent = D.recent.filter(x => x.id !== c.taskId); if (D.detail === c.taskId) D.detail = null; paint(); }
    else if (c.change === 'restored') load();
  }
  async function stopTask(id) {
    if (D.stopping.has(id)) return;
    const key = D.key;
    D.stopping.add(id); paint();
    try {
      const r = await post('/api/providers/tasks/cancel', { agent: host.agentId, session: chatOf(), task: id, scope: D.scope });
      if (key !== D.key) return;
      if (r.task) upsert(r.task, false);
      if (!r.cancelled) host.toast(r.reason || 'Could not cancel the task.', 'bad');
    } catch (e) { host.toast(e.message || 'Could not cancel the task.', 'bad'); }
    finally { D.stopping.delete(id); paint(); }
  }

  // ---------------------------------------------------------------- the browser (./provider-browser.js)
  const showingBrowser = () => D.open && D.tab === 'browser' && host.el.isConnected && !document.hidden;
  const bw = providerBrowser({ showing: showingBrowser, repaint: () => paint() });
  const resetBrowser = () => bw.reset(has().browser ? host.agentId : null);

  // ---------------------------------------------------------------- the panel
  /** This chat's tasks, or all of the agent's: read afresh, and kept as the person's choice. */
  function setScope(scope) {
    if (scope === D.scope) return;
    D.scope = scope === 'agent' ? 'agent' : 'chat';
    try { localStorage.setItem(SCOPE_KEY, D.scope); } catch { /* this page only */ }
    D.key = null; sync();
  }
  /** quiet: opened as it was when the window comes back with the page (the keys stay where they are). */
  function toggle(open = !D.open, tab = D.tab, { quiet = false } = {}) {
    const h = has();
    D.open = !!open && enabled(); D.tab = h[tab] ? tab : h.tasks ? 'tasks' : h.browser ? 'browser' : h.screen ? 'screen' : h.phone ? 'phone' : 'pc';
    if (D.open && D.tab === 'tasks' && D.key && !D.loading) load();
    layout(); paint();
    if (D.open && !quiet) $('.cw-dock .cw-dock-tab.on')?.focus({ preventScroll: true });
    host.changed?.();   // (kept with the window: open on its tab when the page comes back)
  }
  /** Beside the conversation when the window has room for both; over it when it hasn't. */
  function layout() {
    const box = $('.chatwin');
    if (!box) return;
    const side = host.wide() && !box.classList.contains('side-hidden') ? SIDE_W : 0;
    const browsing = D.open && (D.tab === 'browser' || D.tab === 'screen' || D.tab === 'pc');   // (wider: a browser, a screen, a PC)
    const beside = D.open && host.wide() && box.getBoundingClientRect().width - side - (browsing ? DOCK_W_BROWSER : DOCK_W) >= MAIN_MIN;
    box.classList.toggle('dock-open', D.open);
    box.classList.toggle('dock-beside', beside);
    box.classList.toggle('dock-browsing', browsing);
  }
  function statusLine(t) {
    const bits = [`<span class="cw-tk-st">${STATUS[t.status] || t.status}</span>`];
    if (live(t)) {
      const since = t.startedAt || t.createdAt;
      if (since) bits.push(`<span data-since="${since}"></span>`);
      const x = t.execution || {};
      if (x.wait) bits.push(esc(`${WAITING[x.wait.kind] || 'Waiting'}${x.wait.pending ? ` (${x.wait.pending === 1 ? '1 child pending' : `${x.wait.pending} children pending`})` : ''}`));
      else if (x.tool) bits.push(`Current tool: <code>${esc(x.tool.name)}</code>`);
      else if (t.lastToolName) bits.push(`Last tool: <code>${esc(t.lastToolName)}</code>`);
    } else {
      const end = t.endedAt || t.updatedAt;
      if (end) bits.push(`<span data-ago="${end}"></span>`);
    }
    if (t.toolUseCount) bits.push(t.toolUseCount === 1 ? '1 tool use' : `${t.toolUseCount} tool uses`);
    if (D.scope === 'agent' && t.here === false && t.runtime !== 'cron') bits.push('from another chat');
    return bits.join(' · ');
  }
  /** A task's row, field by field: its marker, title, kind, how it stands, its latest words, Stop (only what changed is
   *  written: a running task reports several times a second, and its Stop button must stay the one under the pointer). */
  const ROW = `<span class="cw-tk-mk" aria-hidden="true"></span><div class="cw-tk-b"><div class="cw-tk-l1"><b data-noicon></b><span class="cw-tk-rt"></span></div>
    <div class="cw-tk-l2"></div><div class="cw-tk-l3" data-noicon></div></div><button type="button" class="cw-ic cw-tk-stop" data-a="task-stop">${icon('stop')}</button>`;
  function fillRow(el, t) {
    if (!el.firstElementChild) el.innerHTML = ROW;
    const put = (sel, prop, v) => { const n = el.querySelector(sel); if (n[prop] !== v) n[prop] = v; return n; };
    const title = titleOf(t), note = t.error || (live(t) ? t.progressSummary || t.lastActivity : t.terminalSummary || t.progressSummary) || '';
    put('.cw-tk-mk', 'className', `cw-tk-mk ${t.status}`);
    put('.cw-tk-l1 b', 'textContent', title);
    put('.cw-tk-rt', 'textContent', RUNTIME[t.runtime] || 'Task');
    const l2 = el.querySelector('.cw-tk-l2'), st = statusLine(t);
    if (l2._h !== st) { l2._h = st; l2.innerHTML = st; }
    const l3 = put('.cw-tk-l3', 'textContent', note);
    l3.hidden = !note; l3.classList.toggle('bad', !!t.error);
    const b = el.querySelector('.cw-tk-stop'), label = `Stop ${title}`;
    b.hidden = !live(t); b.disabled = D.stopping.has(t.id);
    if (b.title !== label) { b.title = label; b.setAttribute('aria-label', label); }
  }
  /** A list of rows kept in place: a row is made once and only what it shows is written again; order follows the list. */
  function fillRows(box, items) {
    const have = new Map([...box.children].map(el => [el.dataset.task, el]));
    let prev = null;
    for (const t of items) {
      let el = have.get(t.id);
      if (el) have.delete(t.id);
      else { el = document.createElement('div'); el.className = 'cw-tk'; el.dataset.task = t.id; el.setAttribute('role', 'button'); el.tabIndex = 0; el.title = 'Task details'; }
      fillRow(el, t);
      const next = prev ? prev.nextElementSibling : box.firstElementChild;
      if (next !== el) box.insertBefore(el, next);
      prev = el;
    }
    for (const el of have.values()) el.remove();
  }
  const LIST = `<div class="cw-tk-scope" role="radiogroup" aria-label="Which tasks"><button type="button" role="radio" data-scope="chat">This chat</button><button type="button" role="radio" data-scope="agent"></button></div>
    <div class="cw-tk-msg"></div>
    <section class="cw-tk-sec cw-tk-run"><h4 class="cw-tk-sh"></h4><div class="cw-tk-rows"></div><div class="cw-tk-none">No queued or running tasks.</div></section>
    <details class="cw-tk-sec cw-tk-fin"><summary class="cw-tk-sh"></summary><div class="cw-tk-rows"></div><div class="cw-tk-none">No recent completed tasks.</div></details>`;
  function paintList(body) {
    if (body._view !== 'list') { body.innerHTML = LIST; body._view = 'list'; body._h = ''; body.querySelector('.cw-tk-fin').open = D.finishedOpen; }
    const a = D.active, r = D.recent, ready = D.loaded, name = host.agent?.name || 'the agent';
    for (const b of body.querySelectorAll('.cw-tk-scope [data-scope]')) { const on = b.dataset.scope === D.scope; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    const all = body.querySelector('.cw-tk-scope [data-scope="agent"]'), allText = `All of ${name}'s`;
    if (all.textContent !== allText) all.textContent = allText;
    const empty = D.scope === 'agent' ? `<div class="cw-tk-empty"><b>${esc(name)} has no background tasks.</b><br>Its subagents, scheduled jobs and command runs show here.</div>`
      : !chatOf() ? `<div class="cw-tk-empty"><b>Nothing from this chat yet.</b><br>Subagents it starts show here. <button type="button" class="btn small" data-scope="agent">See all of ${esc(name)}'s tasks</button></div>`
      : `<div class="cw-tk-empty"><b>No background tasks from this chat.</b><br>${esc(name)}'s scheduled jobs and the work it started elsewhere are in <button type="button" class="btn small" data-scope="agent">All of ${esc(name)}'s</button></div>`;
    const msg = D.error && !ready ? `<div class="cw-tk-err" role="alert">${esc(D.error)} <button type="button" class="btn small" data-a="tasks-reload">Try again</button></div>`
      : !ready && D.key ? '<div class="cw-tk-empty">Loading background tasks…</div>'
      : `${D.error ? `<div class="cw-tk-err" role="alert">${esc(D.error)}</div>` : ''}${!a.length && !r.length ? empty : ''}`;
    const m = body.querySelector('.cw-tk-msg');
    if (m._h !== msg) { m._h = msg; m.innerHTML = msg; }
    for (const [sec, list, label] of [[body.querySelector('.cw-tk-run'), a, 'Running'], [body.querySelector('.cw-tk-fin'), r, 'Finished']]) {
      sec.hidden = !ready || (!a.length && !r.length);
      const head = sec.querySelector('.cw-tk-sh'), text = `${label} (${list.length})`;
      if (head.textContent !== text) head.textContent = text;
      fillRows(sec.querySelector('.cw-tk-rows'), list);
      sec.querySelector('.cw-tk-none').hidden = list.length > 0;
    }
  }
  /** The running ones' time, a second at a time: only those words. */
  function tick(root) {
    for (const el of root.querySelectorAll('[data-since]')) { const v = span(Date.now() - Number(el.dataset.since)); if (el.textContent !== v) el.textContent = v; }
    for (const el of root.querySelectorAll('[data-ago]')) { const v = ago(Number(el.dataset.ago)); if (el.textContent !== v) el.textContent = v; }
  }
  function transcriptHtml(id) {
    const tr = D.transcripts.get(id);
    if (!tr || tr.loading) return '<div class="cw-tk-none">Loading task transcript…</div>';
    if (tr.error) return `<div class="cw-tk-none bad">${esc(tr.error)}</div>`;
    if (!tr.messages.length) return '<div class="cw-tk-none">No transcript messages yet.</div>';
    return `${tr.next ? `<button type="button" class="btn small cw-tk-more" data-a="task-more"${tr.more ? ' disabled' : ''}>${tr.more ? 'Loading earlier…' : 'Show earlier'}</button>` : ''}
      ${tr.messages.map(m => `<div class="cw-tk-m ${m.role === 'user' ? 'user' : 'agent'}"><span class="cw-tk-who">${m.role === 'user' ? 'Prompt' : m.role === 'system' ? 'Note' : 'Agent'}${Number.isFinite(Number(m.ts)) && Number(m.ts) > 0 ? `<time>${new Date(Number(m.ts)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>` : ''}</span>
        ${m.steps && m.steps.length ? `<div class="cw-tk-steps" data-noicon>${m.steps.length === 1 ? '1 tool call' : `${m.steps.length} tool calls`}: ${esc(m.steps.slice(0, 6).map(x => x.title).join(', '))}${m.steps.length > 6 ? '…' : ''}</div>` : ''}
        ${m.text ? `<div class="cw-md" data-noicon>${render(m.text).html}</div>` : ''}</div>`).join('')}`;
  }
  function detailHtml(id) {
    const t = D.details.get(id) || [...D.active, ...D.recent].find(x => x.id === id);
    const back = '<button type="button" class="btn small cw-tk-back" data-a="task-back">⟨ Back to tasks</button>';
    if (!t) return `${back}<div class="cw-tk-none">Loading task details…</div>`;
    if (t.error && !t.id) return `${back}<div class="cw-tk-err" role="alert">${esc(t.error)} <button type="button" class="btn small" data-a="task-retry">Try again</button></div>`;
    const title = titleOf(t), read = D.details.has(id) && !D.details.get(id).error;   // (its prompt and output asked for and come)
    return `${back}
      <div class="cw-tk-dt"><span class="cw-tk-mk ${t.status}" aria-hidden="true"></span><div class="cw-tk-b"><div class="cw-tk-l1"><b data-noicon>${esc(title)}</b><span class="cw-tk-rt">${RUNTIME[t.runtime] || 'Task'}</span></div>
        <div class="cw-tk-l2">${statusLine(t)}</div></div>
        ${live(t) ? `<button type="button" class="btn small cw-tk-dstop" data-a="task-stop" data-task="${esc(t.id)}"${D.stopping.has(t.id) ? ' disabled' : ''}>${icon('stop')} ${D.stopping.has(t.id) ? 'Cancelling…' : 'Stop'}</button>` : ''}</div>
      ${t.error ? `<div class="cw-tk-err" data-noicon>${esc(t.error)}</div>` : ''}
      ${t.progressSummary && live(t) ? `<h4 class="cw-tk-h">Latest update</h4><div class="cw-tk-p" data-noicon>${esc(t.progressSummary)}</div>` : ''}
      <h4 class="cw-tk-h">Prompt</h4><div class="cw-tk-p">${t.prompt ? `<div class="cw-md" data-noicon>${render(t.prompt).html}</div>` : `<span class="dim">${read ? 'Prompt unavailable.' : 'Loading task details…'}</span>`}</div>
      <h4 class="cw-tk-h">Output</h4><div class="cw-tk-p">${t.result ? `<div class="cw-md" data-noicon>${render(t.result).html}</div>` : t.terminalSummary ? `<div class="cw-md" data-noicon>${render(t.terminalSummary).html}</div>` : '<span class="dim">No output yet.</span>'}</div>
      ${DELIVERY[t.deliveryStatus] ? `<div class="cw-tk-dl">${DELIVERY[t.deliveryStatus]}</div>` : ''}
      ${t.hasTranscript === false ? '' : `<h4 class="cw-tk-h">Transcript</h4><div class="cw-tk-tr">${transcriptHtml(id)}</div>`}`;
  }
  function paint() {
    const c = enabled(), mine = c ? running() : [];
    // the header's button (with how many run) and the row under the composer
    const b = $('.cw-dockb');
    if (b) {
      b.classList.toggle('hidden', !c); b.setAttribute('aria-pressed', String(D.open));
      const k = mine.length + (has().phone ? phoneCount() : 0);
      const n = b.querySelector('.cw-dockb-n'); n.textContent = k ? String(k) : ''; n.classList.toggle('hidden', !k);
    }
    const chip = $('.cw-tchip');
    if (chip) {
      const show = mine.length > 0 && !(D.open && D.tab === 'tasks');
      chip.classList.toggle('hidden', !show);
      if (show) {
        const html = `<span class="cw-tchip-mk" aria-hidden="true"></span><b>${mine.length === 1 ? '1 running task' : `${mine.length} running tasks`}</b><span class="cw-tchip-t" data-noicon>${esc(titleOf(mine[0]))}${mine.length > 1 ? ` · +${mine.length - 1} more` : ''}</span>`;
        if (chip._h !== html) { chip._h = html; chip.innerHTML = html; }
      }
    }
    const dock = $('.cw-dock');
    if (!dock) return;
    dock.hidden = !D.open;
    clearInterval(D.timer); D.timer = null;
    // (all of the agent's tasks with no chat followed - one just begun - have no live news: read again now and then)
    const pollAll = D.open && D.tab === 'tasks' && D.scope === 'agent' && !chatOf() && !!D.key;
    if (pollAll && !D.poll) D.poll = setInterval(() => { if (!D.loading) load(); }, AGENT_POLL_MS);
    if (!pollAll && D.poll) { clearInterval(D.poll); D.poll = null; }
    if (!D.open || D.tab !== 'phone') dropPhone();
    if (!D.open || D.tab !== 'pc') dropPc();
    if (!D.open || D.tab !== 'screen') dropScreen();
    // (the Sidebar's 💻 PC: there for an agent whose PC is this account's)
    const nav = $('.cw-nav[data-pc]');
    if (nav) { nav.classList.toggle('hidden', !has().pc); nav.classList.toggle('on', D.open && D.tab === 'pc'); }
    if (!D.open) { bw.live(); return; }
    if (!dock.firstElementChild) dock.innerHTML = '<header class="cw-dock-h"></header><div class="cw-dock-body" role="tabpanel"></div>';
    const h = has(), tabBtn = (id, label) => `<button type="button" class="cw-dock-tab${D.tab === id ? ' on' : ''}" data-dock="${id}" role="tab" aria-selected="${D.tab === id}">${label}</button>`;
    const head = `<div class="cw-dock-tabs" role="tablist" aria-label="Side panel">${h.tasks ? tabBtn('tasks', `Tasks${mine.length ? ` <span class="cw-dock-n">${mine.length}</span>` : ''}`) : ''}${h.browser ? tabBtn('browser', 'Browser') : ''}${h.screen ? tabBtn('screen', 'Screen') : ''}${h.phone ? tabBtn('phone', `Phone${phoneCount() ? ` <span class="cw-dock-n">${phoneCount()}</span>` : ''}`) : ''}${h.pc ? tabBtn('pc', 'PC') : ''}</div><span class="cw-grow"></span>
        ${D.tab === 'tasks' ? `<button type="button" class="cw-ic" data-a="tasks-reload" title="Refresh background tasks" aria-label="Refresh background tasks"${D.loading ? ' disabled' : ''}>↻</button>` : ''}
        <button type="button" class="cw-ic" data-a="dock-x" title="Close the side panel" aria-label="Close the side panel">✕</button>`;
    const hd = dock.querySelector('.cw-dock-h'), body = dock.querySelector('.cw-dock-body');
    if (hd._h !== head) { hd._h = head; hd.innerHTML = head; }
    dock.classList.toggle('browsing', D.tab === 'browser' || D.tab === 'screen' || D.tab === 'pc');
    if (D.tab === 'browser') { bw.paint(body); bw.live(); return; }
    if (D.tab === 'screen') {
      bw.live();
      if (!Sc.app || Sc.agent !== host.agentId || !body.querySelector('.cw-screen')) {
        dropScreen();
        body._view = 'screen'; body._h = null; body.innerHTML = '<div class="cw-screen"></div>';
        Sc.agent = host.agentId;
        Sc.app = mountProviderScreen(body.querySelector('.cw-screen'), host.agentId, { toast: host.toast });
      }
      return;
    }
    if (D.tab === 'pc') {
      bw.live();
      if (!Pc.app || Pc.agent !== host.agentId || !body.querySelector('.cw-pc')) {
        dropPc();
        body._view = 'pc'; body._h = null; body.innerHTML = '<div class="cw-pc"></div>';
        Pc.agent = host.agentId;
        Pc.app = mountPc(body.querySelector('.cw-pc'), { agent: host.agentId, lock: true, toast: host.toast });
      }
      return;
    }
    if (D.tab === 'phone') {
      bw.live();
      if (!M.app || M.agent !== host.agentId || !body.querySelector('.ph-host')) {
        dropPhone();
        body._view = 'phone'; body._h = null; body.innerHTML = '<div class="ph-host"></div>';
        M.agent = host.agentId;
        M.app = mountPhone(body.querySelector('.ph-host'), host.agentId, { compact: true, toast: host.toast, onCounts: c => { const was = phoneCount(); M.counts = c; if (phoneCount() !== was) paint(); } });
      }
      if (M.want) { const w = M.want; M.want = null; M.app.show(w.view, w.arg); }
      return;
    }
    bw.live();
    if (D.detail) {
      const html = detailHtml(D.detail), view = `detail:${D.detail}`;
      if (body._view !== view || body._h !== html) { const top = body._view === view ? body.scrollTop : 0; body._view = view; body._h = html; body.innerHTML = html; body.scrollTop = top; }
    } else paintList(body);
    tick(dock);
    if (D.active.length || D.detail) D.timer = setInterval(() => { if (!D.open || !host.el.isConnected) { clearInterval(D.timer); return; } tick(dock); }, 1000);
  }
  function onClick(e) {
    const a = e.target.closest('[data-a]'), row = e.target.closest('.cw-tk[data-task]');
    const sc = e.target.closest('[data-scope]');
    if (sc) { setScope(sc.dataset.scope); return; }
    if (bw.click(e)) return;
    if (a) {
      const id = a.dataset.task || row?.dataset.task || D.detail;
      if (a.dataset.a === 'dock-x') toggle(false);
      else if (a.dataset.a === 'tasks-reload') { if (D.detail) loadDetail(D.detail); load(); }
      else if (a.dataset.a === 'task-stop' && id) stopTask(id);
      else if (a.dataset.a === 'task-back') { D.detail = null; paint(); }
      else if (a.dataset.a === 'task-retry' && D.detail) { D.details.delete(D.detail); loadDetail(D.detail); }
      else if (a.dataset.a === 'task-more' && D.detail) moreTranscript(D.detail);
      return;
    }
    if (e.target.closest('[data-dock]')) { D.tab = e.target.closest('[data-dock]').dataset.dock; D.detail = null; if (D.tab === 'tasks' && D.key) load(); layout(); paint(); host.changed?.(); return; }
    if (row) { D.detail = row.dataset.task; paint(); loadDetail(D.detail); }
  }
  function onKey(e) {
    if (bw.key(e)) return;
    const row = e.target.closest('.cw-tk[data-task]');
    if (row && (e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); D.detail = row.dataset.task; paint(); loadDetail(D.detail); }
    if (e.key === 'Escape' && D.open && !host.el.querySelector('.chatwin.dock-beside')) { e.stopPropagation(); toggle(false); }
  }
  const dock = $('.cw-dock');
  dock.addEventListener('click', onClick);
  dock.addEventListener('keydown', onKey);
  dock.addEventListener('toggle', e => { if (e.target.classList?.contains('cw-tk-fin')) D.finishedOpen = e.target.open; }, true);
  dock.addEventListener('wheel', bw.wheel, { passive: false });
  dock.addEventListener('paste', bw.paste);
  dock.addEventListener('focusin', bw.focusin);
  dock.addEventListener('focusout', bw.focusout);
  $('.cw-dockb').addEventListener('click', () => toggle(!D.open, D.tab));
  $('.cw-tchip').addEventListener('click', () => toggle(true, 'tasks'));
  /** The side panel's Browser tab, on one of the browser's tabs (a browser card's Open). */
  async function openTab(id) {
    if (!has().browser) return;
    toggle(true, 'browser');
    await bw.openTab(id);
  }
  /** The side panel's PC tab (the Sidebar's 💻 PC): the agent's PC beside the chat; false when it isn't this account's. */
  async function openPc() {
    await readPcIds();
    if (!has().pc) return false;
    toggle(true, 'pc');
    return true;
  }
  /** The side panel's Phone tab, on a conversation or the calls (a phone notification's). */
  function openPhone({ peer = null, calls = false } = {}) {
    if (!has().phone) return false;
    M.want = peer ? { view: 'thread', arg: peer } : calls ? { view: 'calls' } : null;
    toggle(true, 'phone');
    return true;
  }
  return { sync, onTask, toggle, layout, paint, openTab, openPhone, openPc, isOpen: () => D.open, tab: () => D.tab, close() { offPhone(); dropPhone(); dropPc(); clearInterval(D.timer); clearInterval(D.poll); D.seq++; bw.close(); dropScreen(); } };
}
