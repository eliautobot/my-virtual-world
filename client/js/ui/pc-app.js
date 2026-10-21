// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The agents' PC (docs/features/agent-pc.md) as a person uses it: a desktop for one agent at a time (its profile - the
// person can switch to another agent of theirs unless the PC is an agent's own screen), a taskbar with the apps that are
// open, what the agent is doing on it right now and the time, and the apps: Files, Board, Calendar, Browser, Teams,
// Activity, Terminal, Settings - and, for an Agent Providers' agent, Its computer (its real one: ./pc-own.js). One
// component, mounted wherever the PC shows - the Agent Studio, its own window, the agent's desk in the world. The server
// decides everything (server/pc/); this asks, shows, and follows the 'pc' frames (only the PC's own account ever
// receives them).
import { bus } from '../core/state.js';
import { getJSON, post } from '../core/net.js';
import { esc } from '../core/util.js';
import { filesApp } from './pc-files.js';
import { boardApp, calendarApp } from './pc-plan.js';
import { teamsApp, browserApp, activityApp, terminalApp, settingsApp } from './pc-more.js';
import { computerApp } from './pc-own.js';
import { watchScreens } from './pc-watch.js';

export const APPS = [
  { id: 'files', label: 'Files', icon: '📂', run: filesApp },
  // (an Agent Providers' agent's own computer - OpenClaw's, Hermes' - for whoever manages its provider: ./pc-own.js)
  { id: 'computer', label: 'Its computer', icon: '💻', run: computerApp, when: me => !!me?.own, labelOf: me => me.own.label },
  { id: 'board', label: 'Board', icon: '📋', run: boardApp },
  { id: 'calendar', label: 'Calendar', icon: '🗓', run: calendarApp },
  { id: 'browser', label: 'Browser', icon: '🌐', run: browserApp },
  { id: 'teams', label: 'Teams', icon: '👥', run: teamsApp },
  { id: 'activity', label: 'Activity', icon: '📜', run: activityApp },
  { id: 'terminal', label: 'Terminal', icon: '⌨', run: terminalApp },
  { id: 'settings', label: 'Settings', icon: '⚙', run: settingsApp },
];
const appOf = id => APPS.find(a => a.id === id);
const ACTIVE_MS = 15 * 60000;   // what it did that long ago is not "what it is doing" (▶ Follow then shows its desktop)
const WORKING_MS = 2 * 60000;   // opened while it works (a step in the last two minutes): straight to what it is doing
/** The apps this agent's PC has (Its computer: only an agent that has one), and what each is called on it. */
const appsFor = me => APPS.filter(a => !a.when || a.when(me));
const labelOf = (a, me) => (a.labelOf && me && (!a.when || a.when(me)) ? a.labelOf(me) : a.label);
const OPEN_MAX = 6;
let mounts = 0;

import { size, when, popMenu } from './pc-ui.js';
export { size, when, popMenu };

/**
 * @param {HTMLElement} el  where the PC is drawn
 * @param {{ agent: number, lock?: boolean, start?: string|null, args?: object, toast?: Function, onClose?: Function }} o
 *   lock: the PC is this agent's own screen (no switching to another agent's); start: an app to open at once
 */
export function mountPc(el, { agent, lock = false, start = null, args = null, toast = () => {}, onClose = null } = {}) {
  const P = {
    agent: Number(agent), lock, toast, agents: [], teams: [], usage: null, limits: null, profile: null, screen: null, alive: true,
    follow: true,   // (it shows what the agent does, as it does it - until the person takes over: setFollow)
    place: `pc-${++mounts}`,   // (this PC, among the places watching agents' screens: ./pc-watch.js)
    open: (id, a) => open(id, a), close: () => closeApp(cur), refresh: () => load(),
    /** The query naming this PC's profile, with more fields: "profile=3&path=…". */
    q(extra = {}) {
      const u = new URLSearchParams();
      if (extra.space === undefined || extra.space === null) u.set('profile', String(P.agent));   // (a team's space is named by itself)
      for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null) u.set(k, String(v));
      return u.toString();
    },
    get: (path, params = {}) => getJSON(`/api/pc/${path}?${P.q(params)}`),
    post: (path, body = {}) => post(`/api/pc/${path}`, body),
    me: () => P.agents.find(a => a.id === P.agent) || null,
    name: id => P.agents.find(a => a.id === Number(id))?.name || 'someone',
    err: e => toast(e?.message || String(e), 'bad'),
  };
  el.classList.add('pc');
  el.innerHTML = `<div class="pc-desk"></div><div class="pc-bar"><button class="pc-me" title="Whose PC"></button><div class="pc-apps"></div>
    <button class="pc-follow" data-act="follow"></button><div class="pc-status" title="What it is doing on its PC"><i class="pc-dot"></i><span></span></div><span class="pc-clock"></span>${onClose ? '<button class="pc-x" data-act="exit" title="Close the PC">✕</button>' : ''}</div>`;
  const desk = el.querySelector('.pc-desk'), bar = el.querySelector('.pc-apps');
  const wins = new Map();   // app id → { app, el, inst }
  let cur = null, menu = null;

  // ---------------------------------------------------------------- loading
  async function load() {
    try {
      const o = await getJSON('/api/pc');
      if (!P.alive) return;
      P.agents = o.agents; P.teams = o.teams; P.usage = o.usage; P.limits = o.limits; P.realBrowser = !!o.realBrowser;
      if (!P.agents.some(a => a.id === P.agent) && P.agents.length && !lock) P.agent = P.agents[0].id;
      const me = P.me();
      P.screen = me?.screen || null;
      // (an Agent Providers' agent's PC open: its work elsewhere - another channel, a schedule - is followed onto it meanwhile)
      watchScreens(P.place, me?.own ? [P.agent] : []);
      loadProfile();
      // (opened while it works: straight to what it is doing)
      if (P.follow && !cur && !start && P.screen?.view && Date.now() - P.screen.at < WORKING_MS) follow(P.screen.view);
    } catch (e) { P.err(e); }
    paintBar(); if (!cur) paintDesk();
  }
  async function loadProfile() {
    try { P.profile = await getJSON(`/api/pc/profile?agent=${P.agent}`); } catch { P.profile = null; }
    if (P.alive) paintStatus();
  }

  // ---------------------------------------------------------------- the desktop
  function paintDesk() {
    const me = P.me(), u = P.usage;
    const pct = u && u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
    desk.innerHTML = `<div class="pc-icons">${appsFor(me).map(a => `<button class="pc-icon" data-app="${a.id}"><span class="pc-ig" aria-hidden="true">${a.icon}</span><span>${esc(labelOf(a, me))}</span></button>`).join('')}</div>
      <div class="pc-widgets">
        <div class="pc-widget"><h4>${esc(me ? `${me.name}'s PC` : 'PC')}</h4>
          <div class="pc-wrow"><span class="dim">Now</span><span class="pc-now">${esc(nowText())}</span></div>
          <div class="pc-wrow pc-tasksw"><span class="dim">Tasks</span><span>…</span></div></div>
        ${u ? `<div class="pc-widget"><h4>Storage</h4><div class="pc-meter ${pct >= 100 ? 'full' : pct >= 80 ? 'warn' : ''}"><i style="width:${pct}%"></i></div>
          <span class="dim">${size(u.used)} used${u.limit ? ` of ${size(u.limit)}` : ''} · shared by your agents and teams</span></div>` : ''}
      </div>`;
    for (const w of wins.values()) desk.append(w.el);
    for (const [id, w] of wins) w.el.hidden = id !== cur;
    tasksWidget();
  }
  async function tasksWidget() {
    try {
      const b = await P.get('board', { path: '~' });
      const open = b.cards.filter(k => k.col !== 'done');
      const box = desk.querySelector('.pc-tasksw span:last-child');
      if (box) box.textContent = open.length ? `${open.length} open · ${open[0].title}` : 'none open';
    } catch { /* no board yet */ }
  }
  const nowText = () => {
    const w = P.profile?.working;
    if (w) return `Working on task #${w.card} · step ${w.steps + 1}`;
    if (P.screen && Date.now() - P.screen.at < 10 * 60000) return `${P.screen.title}`;
    return 'Nothing right now';
  };

  // ---------------------------------------------------------------- the taskbar
  function paintBar() {
    const me = P.me();
    el.querySelector('.pc-me').innerHTML = `<span class="pc-av" aria-hidden="true">${esc(me?.emoji || '🤖')}</span><b>${esc(me ? me.name : 'PC')}</b>`;
    bar.innerHTML = [...wins.keys()].map(id => { const a = appOf(id), n = esc(labelOf(a, me)); return `<button class="pc-tab ${id === cur ? 'on' : ''}" data-tab="${id}" title="${n}"><span aria-hidden="true">${a.icon}</span><span class="pc-tl">${n}</span></button>`; }).join('');
    paintStatus();
  }
  function paintStatus() {
    const fb = el.querySelector('.pc-follow');
    fb.classList.toggle('on', P.follow);
    fb.textContent = P.follow ? '👁 Following' : '▶ Follow';
    fb.title = P.follow ? `Showing what ${P.me()?.name || 'it'} does as it does it - touch anything to take over` : `Show what ${P.me()?.name || 'it'} does again`;
    const s = el.querySelector('.pc-status');
    s.classList.toggle('working', !!P.profile?.working || !!(P.screen && Date.now() - P.screen.at < 90000));
    s.querySelector('span').textContent = nowText();
    const n = desk.querySelector('.pc-now'); if (n) n.textContent = nowText();
  }
  const clock = () => { el.querySelector('.pc-clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  clock();
  const clockTimer = setInterval(clock, 15000);

  // ---------------------------------------------------------------- following the agent
  /** The app and place for the window the agent has open (server/pc/views.js), opened here too. */
  function follow(v) {
    if (!v || !P.alive) return;
    // (on its own computer - an Agent Providers' agent's file, picture, folder, search, list: Its computer, following it)
    if (v.remote && v.kind !== 'page' && v.kind !== 'web') return P.me()?.own ? open('computer', { live: v }) : undefined;
    switch (v.kind) {
      case 'file': case 'image': return open('files', { path: v.path, live: v });
      case 'folder': return open('files', { path: v.path, mark: v.mark ?? null });
      case 'find': return open('files', { find: v.query });
      case 'board': return open('board', { board: v.board, mark: v.mark ?? null });
      case 'calendar': return open('calendar', { from: v.from, mark: v.mark ?? null });
      case 'page': case 'web': return open('browser', { live: v });
      case 'terminal': return open('terminal', { log: v.lines });
      default: return undefined;
    }
  }
  function setFollow(on) {
    P.follow = !!on;
    paintStatus();
    if (P.follow && P.screen?.view && Date.now() - P.screen.at < ACTIVE_MS) follow(P.screen.view);
  }
  // (the person takes over: a click or a key in a window stops following; ▶ Follow brings it back)
  el.addEventListener('pointerdown', e => { if (e.isTrusted && P.follow && e.target.closest('.pc-win .pc-body')) setFollow(false); }, true);
  el.addEventListener('keydown', e => { if (e.isTrusted && P.follow && e.target.closest('.pc-win .pc-body') && !['Escape', 'Tab'].includes(e.key)) setFollow(false); }, true);

  // ---------------------------------------------------------------- windows
  function open(id, a = null) {
    const app = appOf(id);
    if (!app || (app.when && !app.when(P.me()))) return;
    let w = wins.get(id);
    if (!w) {
      if (wins.size >= OPEN_MAX) closeApp([...wins.keys()].find(k => k !== cur));
      const node = document.createElement('div');
      node.className = 'pc-win';
      node.innerHTML = `<div class="pc-tb"><span class="pc-ti" aria-hidden="true">${app.icon}</span><b>${esc(labelOf(app, P.me()))}</b><button class="pc-x" data-act="min" title="Back to the desktop"> - </button><button class="pc-x" data-act="close" title="Close">✕</button></div><div class="pc-body"></div>`;
      desk.append(node);
      w = { app, el: node, inst: null };
      wins.set(id, w);
      try { w.inst = app.run(P, node.querySelector('.pc-body'), a || {}) || {}; } catch (e) { P.err(e); }
    } else if (a && w.inst?.go) w.inst.go(a);
    cur = id;
    for (const [k, x] of wins) x.el.hidden = k !== cur;
    desk.classList.add('app-open');
    paintBar();
  }
  function closeApp(id) {
    const w = id && wins.get(id);
    if (!w) return;
    try { w.inst?.destroy?.(); } catch { /* closing */ }
    w.el.remove(); wins.delete(id);
    if (cur === id) { cur = null; desk.classList.remove('app-open'); }
    paintBar(); if (!cur) paintDesk();
  }
  function minimize() { cur = null; desk.classList.remove('app-open'); for (const x of wins.values()) x.el.hidden = true; paintBar(); paintDesk(); }
  function switchTo(id) {
    if (id === P.agent) return;
    for (const k of [...wins.keys()]) closeApp(k);
    P.agent = id; P.profile = null; P.screen = P.agents.find(a => a.id === id)?.screen || null;
    load();
  }

  // ---------------------------------------------------------------- input
  el.addEventListener('click', e => {
    const icon = e.target.closest('[data-app]');
    if (icon) return open(icon.dataset.app);
    const tab = e.target.closest('[data-tab]');
    if (tab) { if (tab.dataset.tab === cur) minimize(); else open(tab.dataset.tab); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') return closeApp(cur);
    if (act === 'min') return minimize();
    if (act === 'exit') return onClose?.();
    if (act === 'follow') return setFollow(!P.follow);
    if (e.target.closest('.pc-me')) {
      if (menu) { menu.remove(); menu = null; return; }
      const items = [...(lock ? [] : P.agents.map(a => ({ label: a.name, icon: a.emoji || '🤖', run: () => switchTo(a.id), on: a.id === P.agent }))),
        ...(lock ? [] : ['-']), ...appsFor(P.me()).map(a => ({ label: labelOf(a, P.me()), icon: a.icon, run: () => open(a.id) }))];
      popMenu(e.target.closest('.pc-me'), items);
    }
  });
  el.addEventListener('keydown', e => { if (e.key === 'Escape' && cur && !e.target.closest('input, textarea, select')) { e.stopPropagation(); minimize(); } });

  // ---------------------------------------------------------------- live
  let profileSoon = null;
  let followSoon = null;
  const unFrame = bus.on('msg:pc', f => {
    if (!P.alive) return;
    if (f.kind === 'screen' && f.screen?.agent === P.agent) {
      P.screen = f.screen; paintStatus();
      // (several steps at once: the last one is shown)
      if (P.follow && f.screen.view) { clearTimeout(followSoon); followSoon = setTimeout(() => follow(P.screen?.view), 250); }
    }
    if (f.kind === 'board' || f.kind === 'teams') { clearTimeout(profileSoon); profileSoon = setTimeout(loadProfile, 400); }
    if (f.kind === 'teams' || f.kind === 'files') { clearTimeout(P.ovSoon); P.ovSoon = setTimeout(async () => { try { const o = await getJSON('/api/pc'); P.teams = o.teams; P.usage = o.usage; } catch { /* next time */ } }, 600); }
    for (const w of wins.values()) { try { w.inst?.onFrame?.(f); } catch { /* one app's trouble */ } }
  });

  // (an app to open at once: once the PC is read - what the agent's own computer offers decides how some open)
  load().then(() => { if (start && P.alive) open(start, args); });
  return {
    el, P,
    open, setAgent: switchTo,
    destroy() { P.alive = false; watchScreens(P.place, []); clearInterval(clockTimer); clearTimeout(followSoon); unFrame(); for (const k of [...wins.keys()]) closeApp(k); el.innerHTML = ''; el.classList.remove('pc'); },
  };
}

/** The PC in its own window, over the page (Escape or ✕ closes it): returns its handle. */
export function openPcWindow(agent, o = {}) {
  document.querySelector('.pc-window')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'pc-window';
  wrap.innerHTML = '<div></div>';
  document.body.append(wrap);
  const close = () => { pc.destroy(); wrap.remove(); document.removeEventListener('keydown', key, true); };
  const key = e => { if (e.key === 'Escape' && !e.target.closest?.('.pc input, .pc textarea, .pc-pop, .psc-view')) { e.stopPropagation(); close(); } };   // (on an agent's own screen, Escape is the screen's)
  const pc = mountPc(wrap.firstElementChild, { ...o, agent, onClose: close });
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', key, true);
  return { ...pc, close };
}
