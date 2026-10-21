// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The left edit dock and the right info dock (PLAN WP1.7; DECISIONS C112, C113). Collapsible panels hold the editing
// tools and the information, so no editor or settings panel covers the middle of the world view (CHECKLIST I3.1–I3.4,
// I3.12). A section appears only to accounts with the matching capability; a section whose tools arrive in a later
// package shows a one-line note today. Keys: B toggles the left dock, I the right one. Each dock's arrow turns to point
// the way the dock will move. Both docks step aside in play mode, as in the earlier release. On a phone both are
// drawers that start closed; the open one leaves a strip of world beside it, and a tap there closes it.
// Registry keys are "<side>:<id>" (and "<side>:<id>.<tab>" for a tabbed section), because the two docks both have
// sections called "Buildings" and "Outside spaces".
import { S, bus, selectBuilding } from '../core/state.js';
import { auth } from '../core/auth.js';
import { pref, setPref } from '../core/prefs.js';
import { h, esc } from '../core/util.js';
import { getJSON } from '../core/net.js';
import { isExt, stateOf } from '../core/agent-view.js';
import { icon } from '../core/icons.js';
import { openNewAgent } from './new-agent.js';

const EDIT = 'world.edit', VIEW = 'world.view';
const LEFT = [
  { id: 'terrain', cap: EDIT, icon: '🪴', title: 'Terrain' },   // filled by ui/terrain-tools.js (WP4.7)
  { id: 'roads', cap: EDIT, icon: '🛣️', title: 'Roads' },   // filled by ui/roads.js (WP4.4)
  { id: 'wmods', cap: EDIT, icon: '🌍', title: 'World modules' },   // filled by ui/world-modules.js: administrators place the big play modules (an airport)
  { id: 'lots', cap: 'property.admin', icon: '🏘️', title: 'Lots' },   // filled by ui/lot-tools.js: administrators make lots beside roads
  // Lot holders build and furnish on their own lots (WP4.6); the server checks every change against the lots.
  { id: 'buildings', cap: 'property.hold', icon: '🏙️', title: 'Buildings', tabs: [['build', '🏗️ Building'], ['furnish', '🪑 Furniture']] },
  { id: 'outside', cap: 'property.hold', icon: '🌳', title: 'Outside spaces', body: outsideBody },   // parks (admins) and decorating (ui/decor-tools.js)
  { id: 'marketing', cap: EDIT, icon: '📣', title: 'Marketing' },   // billboards, street signs, metro panels, aircraft, ads (ui/marketing.js)
  // residents (world editors) and AI agents: members make and manage their own agents here too, where their role allows
  { id: 'agents', cap: [EDIT, 'agents.manage'], icon: '🧑', title: 'Agents', body: agentsBody },
];
const RIGHT = [
  { id: 'team', cap: VIEW, icon: '👥', title: 'Team', open: true },
  { id: 'buildings', cap: VIEW, icon: '🏢', title: 'Buildings', body: buildingsList },
  { id: 'outside', cap: VIEW, icon: '🌳', title: 'Outside spaces', body: parksList },
  { id: 'property', cap: VIEW, icon: '🏡', title: 'Property' },   // filled by ui/property.js (WP4.14)
  { id: 'home', cap: VIEW, icon: '🏠', title: 'Home view' },   // filled by ui/home.js (WP1.9)
  { id: 'activity', cap: VIEW, icon: '📋', title: 'Activity log' },   // filled by ui/activity.js (WP1.8)
  { id: 'players', cap: VIEW, icon: '🌐', title: 'Online players' },   // filled by ui/social.js (WP1.10)
];
const NAMES = { left: 'edit dock', right: 'info dock' };
const KEYS = { left: 'B', right: 'I' };

let app = null, st = null;
const E = {}, sec = {};
/** Pixels each dock takes from the world view right now: 0 while it is closed, hidden or in play mode. The floor control
 *  and the other floating controls keep clear of it. */
export const inset = { l: 0, r: 0, tl: 0, tr: 0 };   // tl/tr: a closed dock's edge button still takes a strip
const phone = () => window.matchMedia('(max-width: 760px)').matches;
const allowed = d => (auth.can ? [].concat(d.cap).some(c => auth.can(c)) : false);   // a section's capability, or any of several
const defaults = () => ({ l: false, r: !phone(), open: {}, tab: 'build' });
const key = (side, id) => `${side[0]}:${id}`;
const base = k => k.slice(2);

function load() {
  let j = null;
  try { j = JSON.parse(pref('docks') || 'null'); } catch { /* a bad stored value falls back to the defaults */ }
  const d = defaults();
  if (!j || typeof j !== 'object') return d;
  return { l: !!j.l, r: typeof j.r === 'boolean' ? j.r : d.r, open: j.open && typeof j.open === 'object' ? j.open : {}, tab: j.tab === 'furnish' ? 'furnish' : 'build' };
}
const save = () => setPref('docks', JSON.stringify({ l: !!st.l, r: !!st.r, open: st.open, tab: st.tab }));

export function init(a) {
  app = a;
  a.hooks = a.hooks || { key: [], click: [], hover: [] };   // ui.js uses the same shape; the docks load first
  st = load();
  if (phone()) { st.l = false; st.r = false; }
  const root = document.getElementById('ui');
  // A tap on the world beside an open phone drawer closes it instead of selecting what is there (C113).
  E.scrim = root.appendChild(h('<div class="dock-scrim hidden" aria-hidden="true"></div>'));
  E.scrim.onclick = () => { st.l = false; st.r = false; apply(); };
  buildDock(root, 'left', LEFT, '🛠️ Edit world');
  buildDock(root, 'right', RIGHT, 'ℹ️ Info');
  updateVisibility();
  render(); apply();
  refresh();   // the world often arrives before this module loads; render once here so the lists are never empty
  a.docks = { state: st, inset, slot, strip, open, show, has, isOpen, text, visibility: updateVisibility, toggle: toggleDock, section: toggleSection };
  bus.on('mode', m => { onMode(m); layout(); });
  bus.on('select', mark); bus.on('selectB', mark);
  bus.on('world', refresh); bus.on('people', refresh); bus.on('favs', refresh); bus.on('synced', refresh);
  bus.on('auth', () => { updateVisibility(); apply(); });
  window.addEventListener('resize', layout);
  a.hooks.key.push(onKey);
}

// ------------------------------------------------------------------ DOM
function buildDock(root, side, defs, title) {
  const id = side === 'left' ? 'dockL' : 'dockR';
  const dock = root.appendChild(h(`<div id="${id}" class="dock ${side} closed">
    <button type="button" class="dock-toggle" aria-controls="${id}-body" aria-expanded="false"><span class="ca" aria-hidden="true">${side === 'left' ? '▶' : '◀'}</span></button>
    <div class="dock-head"><span class="dh">${esc(title)}</span></div>
    ${side === 'right' ? '<div class="dock-strip"></div>' : ''}
    <div class="dock-body scroll" id="${id}-body"></div></div>`));
  E[side] = dock;
  dock.querySelector('.dock-toggle').onclick = () => toggleDock(side);
  const body = dock.querySelector('.dock-body');
  for (const def of defs) {
    const el = body.appendChild(h(`<div class="dsec" data-sec="${def.id}" data-side="${side}">
      <button type="button" class="dsec-h" aria-expanded="false"><span class="caret">▸</span><span class="ic">${def.icon}</span><span class="tt">${esc(def.title)}</span></button>
      <div class="dsec-b"></div></div>`));
    const b = el.querySelector('.dsec-b'), rec = { key: key(side, def.id), def, el, body: b, side };
    sec[rec.key] = rec;
    if (def.open) st.open[rec.key] = st.open[rec.key] !== false;
    if (def.note) b.appendChild(h(`<p class="hint">${esc(def.note)}</p>`));
    if (def.tabs) {
      const tabs = b.appendChild(h(`<div class="dtabs" role="tablist">${def.tabs.map(([k, l]) => `<button type="button" class="dtab" data-tab="${k}" role="tab">${esc(l)}</button>`).join('')}</div>`));
      for (const [k] of def.tabs) sec[`${rec.key}.${k}`] = { def, el, side, key: `${rec.key}.${k}`, body: b.appendChild(h(`<div class="dpane" data-pane="${k}"></div>`)) };
      tabs.onclick = e => { const c = e.target.closest('.dtab'); if (c) selectTab(c.dataset.tab, true); };
    }
    if (def.body) def.body(b);
    el.querySelector('.dsec-h').onclick = () => toggleSection(rec.key);
  }
  return dock;
}

/** Shows the sections this account may use and hides the rest, plus a dock left with nothing to show. It runs again
 *  after a sign-in or sign-out: a guest's edit dock appears (or goes) without rebuilding anything, so the panels that
 *  ui.js and editors.js mounted into the sections stay where they are. */
function updateVisibility() {
  let anyLeft = false, anyRight = false;
  for (const [k, r] of Object.entries(sec)) {
    if (k.includes('.')) continue;
    const on = allowed(r.def);
    r.el.classList.toggle('hidden', !on);
    if (on) { if (r.side === 'left') anyLeft = true; else anyRight = true; }
  }
  for (const [side, any, k] of [['left', anyLeft, 'l'], ['right', anyRight, 'r']]) {
    const dock = E[side];
    if (!dock) continue;
    dock.classList.toggle('hidden', !any);
    if (!any) st[k] = false;
  }
}

/** Where a section's (or a tabbed section's tab's) content mounts: slot('r:team'), slot('l:buildings.furnish'). */
export function slot(k) { return sec[k] ? sec[k].body : null; }
/** The strip under the info dock's title, always shown while the dock is open (the city counts, C113). */
export function strip() { return E.right ? E.right.querySelector('.dock-strip') : null; }
export function open(side, on = true) { st[side === 'left' ? 'l' : 'r'] = on; apply(); }
export function show(k) {
  const r = sec[k];
  if (!r) return;
  if (r.side === 'left') for (const o of Object.values(sec)) if (o.side === 'left' && !o.key.includes('.')) st.open[o.key] = false;
  st.open[k] = true; st[r.side === 'left' ? 'l' : 'r'] = true;
  if (phone()) st[r.side === 'left' ? 'r' : 'l'] = false;
  render(); apply();
}
export function has(k) { return !!sec[k] && allowed(sec[k].def); }
/** Takes a section out of the dock while what it shows lives elsewhere, or puts it back. */
export function away(k, on) { const r = sec[k]; if (!r) return; r.el.classList.toggle('away', !!on); mark(); }
export function isOpen(k) { return !!(sec[k] && st.open[k]); }
export function text(k) { return sec[k] ? String(sec[k].body.textContent || '') : ''; }

// ------------------------------------------------------------------ state
function render() {
  for (const [k, r] of Object.entries(sec)) {
    if (k.includes('.')) continue;
    const on = !!st.open[k];
    r.el.classList.toggle('open', on);
    r.el.querySelector('.dsec-h').setAttribute('aria-expanded', String(on));
    r.el.querySelector('.caret').textContent = on ? '▾' : '▸';
  }
  const b = sec['l:buildings'];
  if (b) {
    for (const t of b.el.querySelectorAll('.dtab')) t.classList.toggle('on', t.dataset.tab === st.tab);
    for (const p of b.el.querySelectorAll('.dpane')) p.classList.toggle('hidden', p.dataset.pane !== st.tab);
  }
}
function apply() {
  layout();
  mark();
  save();
}
/** The docks on screen: open or closed, the toggles' state and tooltips (the arrows turn in CSS), the room each takes
 *  from the world view, and the phone scrim. Play mode hides both docks without changing their saved state. */
function layout() {
  const play = S.mode === 'play', ph = phone();
  const tglW = ph ? 50 : 40;   // what a closed dock's edge button takes at that edge
  let anyOpen = false;
  inset.tl = inset.tr = 0;
  for (const [side, k] of [['left', 'l'], ['right', 'r']]) {
    const dock = E[side];
    if (!dock) continue;
    const on = !!st[k];
    dock.classList.toggle('closed', !on);
    const t = dock.querySelector('.dock-toggle');
    t.setAttribute('aria-expanded', String(on));
    const label = `${on ? 'Hide' : 'Show'} the ${NAMES[side]} (${KEYS[side]})`;
    if (t.title !== label) { t.title = label; t.setAttribute('aria-label', label); }
    const useable = !dock.classList.contains('hidden') && !play;   // in play mode the whole dock goes, button and all
    const shown = on && useable;
    inset[k] = shown ? dock.offsetWidth : 0;   // the layout width; the slide transform does not change it
    if (!shown && useable) inset[side === 'left' ? 'tl' : 'tr'] = tglW;
    if (shown) anyOpen = true;
    // One strip per side: the open dock's width, or just the edge button of a closed one. The floating controls and
    // the floor control keep clear of it.
    const strip = shown ? (side === 'left' ? 'var(--dock-lw)' : 'var(--dock-rw)') : (useable ? `${tglW}px` : '0px');
    document.documentElement.style.setProperty(side === 'left' ? '--dock-l' : '--dock-r', strip);
    // the floating controls at the bottom keep clear of an open dock only: a closed one's edge button is up at the top
    document.documentElement.style.setProperty(side === 'left' ? '--dock-lb' : '--dock-rb', shown ? strip : '0px');
    // how far in from the screen's edge the dock's toggle button reaches (open: beside the dock; closed: at the edge): the
    // selection card lines up beside the right one and never covers it (ui.js, css/selection.css)
    document.documentElement.style.setProperty(side === 'left' ? '--dock-lt' : '--dock-rt', useable ? `${(shown ? dock.offsetWidth : 0) + (ph ? 49 : 35)}px` : '0px');
    // and the height of its top (the slide moves it sideways only), so the card's top is level with it on every screen
    if (side === 'right' && useable) document.documentElement.style.setProperty('--dock-rtop', `${Math.round(t.getBoundingClientRect().top)}px`);
  }
  if (E.scrim) E.scrim.classList.toggle('hidden', !(ph && anyOpen));
  // While a phone drawer is open it is the only thing on screen: the other drawer's edge button and the floating
  // controls would sit on it or over it (found in the phone audit, 2026-09-28).
  document.documentElement.classList.toggle('drawer-open', ph && anyOpen);
  // The camera centres the area left between the docks (C114); drawers on a phone cover the world instead.
  if (app && app.cam) app.cam.lensGoal = ph ? 0 : Math.round((inset.r - inset.l) / 2);
  bus.emit('docks', inset);   // (what floats over the world keeps clear of them: the chat window, ui/chat.js)
}
function mark() {
  // (a dot on the closed Info panel used to say "something selected is shown in it": the selection is the widget across
  // the top now, ui.js - nothing to mark)
  E.right?.querySelector('.dock-toggle').classList.remove('mark');
}
function toggleDock(side) {
  if (!E[side] || E[side].classList.contains('hidden')) return;
  const k = side === 'left' ? 'l' : 'r';
  st[k] = !st[k];
  if (st[k] && phone()) st[side === 'left' ? 'r' : 'l'] = false;
  apply();
}
function toggleSection(k) {
  const r = sec[k];
  if (!r) return;
  const on = !st.open[k];
  // A list renders when its section opens, so it is never left empty just because the world arrived before this
  // module loaded (found 2026-09-28).
  if (on && r.render) r.render();
  if (on && r.side === 'left') for (const o of Object.values(sec)) if (o.side === 'left' && !o.key.includes('.')) st.open[o.key] = false;
  st.open[k] = on;
  render(); save();
  if (!app.setMode) return;
  if (on && r.side === 'left' && base(k) !== 'buildings' && S.mode !== 'explore') app.setMode('explore');
  if (!on && base(k) === 'buildings' && (S.mode === 'build' || S.mode === 'furnish')) app.setMode('explore');
}
function selectTab(tab, byUser) {
  st.tab = tab === 'furnish' ? 'furnish' : 'build';
  if (byUser) st.open['l:buildings'] = true;
  render(); save();
  if (byUser && app.setMode) app.setMode(st.tab);
}
function onMode(m) {
  if (m !== 'furnish' && m !== 'build') return;
  if (!sec['l:buildings']) return;
  st.tab = m; st.open['l:buildings'] = true; st.l = true;
  if (phone()) st.r = false;
  render(); apply();
}
function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || S.mode === 'play') return false;
  if (e.key === 'b' || e.key === 'B') { toggleDock('left'); return true; }
  if (e.key === 'i' || e.key === 'I') { toggleDock('right'); return true; }
  return false;
}
function refresh() {
  for (const r of Object.values(sec)) if (r.render) r.render();
}

// ------------------------------------------------------------------ left dock: outside spaces and agents
function outsideBody(b) {
  const el = b.appendChild(h(`<div class="dpad">
    <button type="button" class="btn primary wide newout">＋ New outside space</button>
    <p class="hint">A park with gates and paths, on a city block or a park lot beyond the city (administrators).</p></div>`));
  el.querySelector('.newout').onclick = () => {
    if (!auth.can(EDIT)) return app.toast('Your role cannot edit the world', 'bad');
    app.setMode('build');
    if (app.editors && app.editors.newType) app.editors.newType('park');
    app.toast('Pick a spot on the map for the outside space');
  };
}
function agentsBody(b) {
  const el = b.appendChild(h(`<div class="dpad">
    <div class="ag-res"><button type="button" class="btn wide newres">➕ New resident</button>
    <div class="row wrap"><button type="button" class="btn small teambtn">👥 Team</button><button type="button" class="btn small cust">🎨 Customize selected</button></div>
    <div class="sep"></div></div>
    <h5>🤖 AI agents</h5>
    <button type="button" class="btn wide newagent" data-cap="agents.new" title="A built-in agent, or your Grok Bot, OpenAI Dot or Meta Muse">➕ New agent</button>
    <p class="err hidden agerr"></p>
    <div class="dlist scroll aglist"></div>
    <p class="hint">A built-in agent gets a body, a home and a desk; a third-party one (Grok Bot, OpenAI Dot, Meta Muse) brings its own AI. Its Studio button opens everything about it.</p></div>`));
  agentsBlock(el);
  // the residents' tools are for those who edit the world; everyone else here has the AI agents block alone
  const res = el.querySelector('.ag-res'), resOn = () => res.classList.toggle('hidden', !auth.can(EDIT));
  resOn(); bus.on('auth', resOn);
  el.querySelector('.newres').onclick = () => (app.openCustomizer ? app.openCustomizer({ kind: 'new' }) : app.toast('Still loading…'));
  el.querySelector('.teambtn').onclick = () => show('r:team');
  el.querySelector('.cust').onclick = () => {
    if (S.sel < 0) return app.toast('Select a resident first', 'bad');
    if (app.openCustomizer) app.openCustomizer({ kind: 'person', i: S.sel });
  };
}

/** The AI agents block (WP2.1): who is an agent, add one, share it, remove it. The server decides what each account may do. */
function agentsBlock(el) {
  const list = el.querySelector('.aglist'), err = el.querySelector('.agerr');
  const say = m => { err.textContent = m || ''; err.classList.toggle('hidden', !m); };
  const call = async (path, body) => {
    say('');
    try { await auth.call(path, body); await load(); return true; } catch (e) { if (!e.quiet) say(e.message); return false; }
  };
  let agents = [];
  async function load() {
    try { agents = (await getJSON('/api/agents')).agents; } catch { agents = []; }
    paint();
  }
  // a world editor sees every agent (they look after the city); anyone else only the ones that are theirs to manage
  const shown = () => (auth.can(EDIT) ? agents : agents.filter(a => a.mine || a.level === 'manage'));
  function paint() {
    const agents = shown();
    if (!agents.length) { list.innerHTML = `<p class="hint">${auth.can(EDIT) ? 'No agents yet.' : 'You have no agents yet: ➕ New agent makes one.'}</p>`; return; }
    list.innerHTML = agents.map(a => `<div class="ditem agrow" data-id="${a.id}" data-i="${a.i}">
      <span class="di" data-avatar>${esc(a.emoji || '🤖')}</span><span class="dn">${esc(a.name)}</span>
      <small>${isExt(a) ? esc(stateOf(a, S.presence[a.key]).label + ' · connected') : a.presence && a.presence.working ? '● working' : esc(a.role || '')}</small>
      ${isExt(a) ? '<button type="button" class="btn small agchat" title="Chat">💬</button>' : ''}
      ${a.mine || a.level === 'manage' ? `<button type="button" class="btn small agstudio" title="Agent Studio: everything about it">${icon('agent')}</button>` : ''}
      ${a.mine && a.level === 'manage' ? `<button type="button" class="btn small agshare" title="Share">👥</button><button type="button" class="btn small agdel" title="Remove">🗑</button>` : ''}</div>`).join('');
  }
  list.onclick = async e => {
    const row = e.target.closest('.agrow');
    if (!row) return;
    const id = +row.dataset.id, a = agents.find(x => x.id === id);
    if (e.target.closest('.agchat')) return void bus.emit('openagent', id);
    if (e.target.closest('.agstudio')) return void bus.emit('openstudio', id);
    if (e.target.closest('.agdel')) {
      if (a && confirm(`Remove ${a.name}? Its body leaves the city; its history is kept.`)) await call('/api/agents/remove', { id });
    } else if (e.target.closest('.agshare')) shareDialog(a);
    else if (a && isExt(a) && !(a.i >= 0)) bus.emit('openagent', id);
    else if (+row.dataset.i >= 0 && app.selectPerson) app.selectPerson(+row.dataset.i);
  };
  function shareDialog(a) {
    const who = prompt(`Share ${a.name} with an account id, or a role (member, admin, owner):`, '');
    if (!who) return;
    const kind = /^\d+$/.test(who.trim()) ? 'account' : 'role';
    const level = confirm('OK = may use and manage. Cancel = may use only.') ? 'manage' : 'use';
    call('/api/agents/share', { id: a.id, kind, who: who.trim(), level });
  }
  // ➕ New agent (ui/new-agent.js): a built-in agent or a third-party one; both end in its Studio
  el.querySelector('.newagent').onclick = () => openNewAgent(app);
  bus.on('msg:agents', load); bus.on('auth', load); bus.on('presence', paint); bus.on('agentlist', load);
  load();
}

// ------------------------------------------------------------------ right dock: the lists
function listBody(b, filterPlaceholder, pick) {
  // A ★ on every row, and a ★ only filter beside the box (Jev batch 33, DECISIONS C115). The row itself is a div with
  // role button, so the star can be a real button inside it.
  const el = b.appendChild(h(`<div class="dpad"><div class="dfilters"><input class="input dfilter" placeholder="${esc(filterPlaceholder)}" aria-label="${esc(filterPlaceholder)}">
    <button type="button" class="btn small staronly" title="Only favourites" aria-pressed="false">★ only</button></div><div class="dlist scroll"></div></div>`));
  const input = el.querySelector('.dfilter'), list = el.querySelector('.dlist'), only = el.querySelector('.staronly');
  let favsOnly = false;
  // This module loads before ui.js, which sets app.fav, and the first render happens at init: fall back to "nothing is
  // a favourite" until it arrives.
  const fav = () => app.fav || { has: () => false, owned: () => false, toggle: () => {}, list: () => [] };
  const star = x => {
    const B = S.world.buildings[x.b], own = fav().owned(B), on = own || fav().has(B);
    const label = own ? 'Yours - always a favourite' : on ? 'Remove from favourites' : 'Add to favourites';
    return `<button type="button" class="fbtn${on ? ' on' : ''}${own ? ' owned' : ''}" data-fav="${x.b}" title="${label}" aria-label="${label}" aria-pressed="${on}">${own ? '🏠' : '★'}</button>`;
  };
  const rec = { render: () => {
    const q = input.value.trim().toLowerCase();
    const rows = pick().filter(x => (!q || x.name.toLowerCase().includes(q)) && (!favsOnly || fav().has(S.world.buildings[x.b]) || fav().owned(S.world.buildings[x.b])));
    list.innerHTML = rows.map(x => `<div class="ditem" role="button" tabindex="0" data-b="${x.b}">
      <span class="di">${x.icon}</span><span class="dn">${esc(x.name)}</span><small>${esc(x.sub)}</small>${star(x)}</div>`).join('')
      || `<p class="hint">${favsOnly ? 'No favourites here yet' : 'Nothing matches'}</p>`;
  } };
  only.onclick = () => { favsOnly = !favsOnly; only.classList.toggle('on', favsOnly); only.setAttribute('aria-pressed', String(favsOnly)); rec.render(); };
  input.oninput = () => rec.render();
  list.onclick = e => {
    const s = e.target.closest('.fbtn');
    if (s) {
      const B = S.world.buildings[+s.dataset.fav];
      if (B && !s.classList.contains('owned')) fav().toggle(B);
      return;
    }
    const c = e.target.closest('.ditem');
    if (!c) return;
    const B = S.world.buildings[+c.dataset.b];
    if (!B) return;
    if (app.player && app.player.active) app.setMode('explore');
    selectBuilding(+c.dataset.b);
    app.cam.flyTo(B.x, 0, B.z + Math.max(B.d, 8) * 0.6, Math.max(B.w, B.d) * 2.1 + 45);
  };
  return rec;
}
function buildingsList(b) {
  Object.assign(sec['r:buildings'], listBody(b, 'Filter buildings', () => (S.world.buildings || []).map((B, i) => (B && !B.gone ? {
    b: i, icon: (app.TYPE_ICON || {})[B.type] || '🏢', name: B.name || 'Building',
    sub: `${(app.TYPE_NAME || {})[B.type] || B.type}${B.floors > 1 ? ` · ${B.floors} floors` : ''}`,
  } : null)).filter(Boolean)));
}
function parksList(b) {
  Object.assign(sec['r:outside'], listBody(b, 'Filter outside spaces', () => (S.world.buildings || []).map((B, i) => (B && !B.gone && B.type === 'park' ? {
    b: i, icon: '🌳', name: B.name || 'Outside space', sub: 'Outside space',
  } : null)).filter(Boolean)));
}
