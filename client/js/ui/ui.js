// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Main UI: the 56 px top bar (brand, explore, undo/redo, clock and speed, stats, search, help, settings, and the
// account chip), the floor widget, the zoom controls, the floating Player button, the minimap, toasts, help, hover /
// click picking and the follow camera. The editor panels and the lists live in the docks (ui/docks.js); this module
// mounts the agent list, the inspector and the city counts into the right dock (PLAN WP1.7, DECISIONS C112). The
// revision after the owner's review (C113, C114): one pause and one cycling speed button, a pointer for select, the
// counts in the info dock, and the floor control on the building itself, following the floor shown.
import { S, bus, setFocus, select, selectBuilding, bld, viewGrid } from '../core/state.js';
import { levelMode } from '/shared/edit.js';
import { initFlats, openFlat, flatRecord } from './flats.js';
import { getJSON, post } from '../core/net.js';
import * as THREE from 'three';
import { auth } from '../core/auth.js';
import { canEdit, mayOn } from '../core/rights.js';
import { pref, setPref } from '../core/prefs.js';
import { soundOn, setSoundOn } from '../audio/mixer.js';
import { icon } from '../core/icons.js';
import { h, esc, clamp } from '../core/util.js';
import { formatClock, WEEKDAYS, GROUND_Y, FLOOR_H, floorAt } from '/shared/constants.js';
import { USES, USE_LIST } from '/shared/catalog.js';
import { blockRect } from '/shared/city.js';
import { addressAt } from '/shared/island-build.js';
import { footprint, toWorld } from '/shared/geom.js';
import * as docks from './docks.js';
import { bodylessAgents, stateOf, isExt, studioAgentAt } from '../core/agent-view.js';
import { initIslandPicture, islandPicture, onIslandPicture } from '../render/island-picture.js';
import { drawAirports, isTerminal } from './airport-map.js';
import { openNewAgent } from './new-agent.js';

export const TYPE_ICON = { office: '🏢', hq: '🏢', apartment: '🏠', cafe: '☕', restaurant: '🍽️', shop: '🛍️', gym: '🏋️', park: '🌳' };
export const TYPE_NAME = { office: 'Office tower', hq: 'Headquarters', apartment: 'Apartments', cafe: 'Café', restaurant: 'Restaurant', shop: 'Shop', gym: 'Gym', park: 'Park' };
const MINI_COL = { office: '#7593bd', hq: '#ff5a4e', apartment: '#c9a26b', cafe: '#d98a5f', restaurant: '#d9735f', shop: '#b58ad9', gym: '#5fc2a8', park: '#4f8a3c' };
const NEEDS = [['hunger', '🍔', 'Food'], ['energy', '⚡', 'Energy'], ['social', '💬', 'Social'], ['fun', '🎈', 'Fun'], ['hygiene', '🧼', 'Hygiene']];
const WALL_LABEL = { cut: 'Cutaway', up: 'Full', down: 'Low' };
const SPEEDS = [1, 4, 16, 60];   // the speed button's cycle (C113)
const TRI = '<svg class="tri" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.6 10.4 6 3 10.4z"/></svg>';
const PAUSE = '<svg class="tri" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.6 1.8h2.6v8.4H2.6zM6.8 1.8h2.6v8.4H6.8z"/></svg>';
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]], _fw = {};
const MODES = [['explore', '🧭', 'Explore', 1], ['furnish', '🛋️', 'Furnish', 2], ['build', '🏗️', 'Build', 3], ['play', '🎮', 'Play', 4]];

let app, cam, agents, canvas;
const E = {};
let info = null, infoFor = -1, infoT = -1e9, occ = null, occFor = -1, occT = -1e9;
let lastRate = 1, searchIdx = null, vipIdx = [], tickN = 0;
const ptr = { x: 0, y: 0, in: false, moved: true, t: 0 };
let lastClick = { t: 0, key: '' }, hoverF = null;
const _tv = new THREE.Vector3();
const lastWorking = {};
const set = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };

export function init(a) {
  app = a; cam = a.cam; agents = a.agents; canvas = a.stage.renderer.domElement;
  app.hooks = app.hooks || { key: [], click: [], hover: [] };
  Object.assign(app, { toast, setMode, lookInside, flyToFloor, startFollow, stopFollow, exitFocus, placeOf, changeFloor, TYPE_ICON, TYPE_NAME, ui: E,
    fav: { has: isFav, owned: ownedBy, list: favList, toggle: toggleFav } });
  const root = document.getElementById('ui');
  buildTopbar(root);
  E.stats = (docks.strip() || root).appendChild(h('<div id="stats"></div>'));   // the city counts (C113)
  buildRoster(docks.slot('r:team') || root);
  buildInspector();
  buildFloorWidget(root); buildFloats(root); buildMinimap(root);
  E.toasts = root.appendChild(h('<div id="toasts"></div>'));
  E.tip = root.appendChild(h('<div id="tip" class="hidden"></div>'));
  E.ftag = root.appendChild(h('<button type="button" id="floortag" class="hidden" title="Go inside this floor"></button>'));
  E.ftag.onclick = () => { if (S.selB >= 0 && S.selF !== null) lookInside(S.selB, S.selF); };
  buildHelp(root);
  bindPicking(); bindKeys();
  for (const k in S.presence) lastWorking[k] = !!(S.presence[k] && S.presence[k].working);
  cam.onUserMove = () => { if (S.mode !== 'play') stopFollow(); };
  bus.on('select', onSelect);
  bus.on('selectB', onSelectB);
  bus.on('focus', onFocus);
  bus.on('people', () => {
    searchIdx = null; renderRoster();
    // a resident that was retired while selected (its agent was removed) is no longer in the city: close it instead of polling for it
    if (S.sel >= 0 && S.people[S.sel] && S.people[S.sel].x) { S.follow = false; select(-1); return; }
    if (S.sel >= 0) showAgent(S.sel);
  });
  bus.on('agentlist', renderRoster);
  initFlats(app);
  bus.on('focus:applied', () => { if (S.selB >= 0 && bld(S.selB)) showBuilding(S.selB); });
  bus.on('flats', () => { if (S.selB >= 0 && bld(S.selB)) showBuilding(S.selB); });
  bus.on('wmods', () => { if (E.mini?.isl?.img) paintIsland(E.mini.isl); });   // an airport placed, moved or closed: the island view again
  bus.on('world', () => { searchIdx = null; drawMiniStatic(); if (E.mini?.isl?.img) { if (E.mini.isl.terrain !== JSON.stringify(S.world.terrain)) { E.mini.isl = null; if (E.mini.view === 'island') setMiniView('island'); } else paintIsland(E.mini.isl); } if (S.selB >= 0) { if (bld(S.selB)) showBuilding(S.selB); else selectBuilding(-1); } onFocus(); });
  bus.on('msg:presence', presenceToast);
  bus.on('net', (ok, why) => { E.net.classList.toggle('ok', ok); if (!ok && why !== 'signin') toast('Lost connection — reconnecting…', 'bad'); });
  bus.on('clock', updateSpeed);
  bus.on('say', m => { if (m.i === S.sel && E.ag) showSaid(m.text); });
  bus.on('frame', (dt, now) => { followTick(); hoverTick(now); floorTag(); });
  bus.on('postframe', placeFloorw);
  window.addEventListener('resize', () => { if (!E.floorw.classList.contains('hidden')) measureFloorw(); });
  setInterval(tick, 500);
  renderRoster(); updateSpeed(); onFocus(); tick();
  E.net.classList.toggle('ok', app.net.connected);
  // The account's display preferences replaced this device's after a sign-in (core/prefs.js, DECISIONS C91).
  bus.on('prefs', names => {
    if (names.includes('labels')) updateToolbar();
    if (names.includes('walls')) { app.applyFocus(); onFocus(); }
    if (names.includes('teamSort') || names.includes('teamView')) renderRoster();
  });
  // (a signed-in account gets the welcome tour instead: ui/guide.js)
  if (!auth.account && !pref('seenHelp')) { setPref('seenHelp', true); setTimeout(() => toast('Tip: ❓ at the top answers “How do I…?”. Double-click a building to look inside.'), 1800); }
}

// ------------------------------------------------------------------ toasts
/** A passing note: text (escaped), kind ('good', 'bad' or ''), how long, an optional icon (an image of the app's own),
 *  an agent's emoji, and an optional action: { label, run } — a button in the note that does it and closes the note. */
export function toast(text, kind = '', ms = 3400, icon = '', avatar = '', action = null) {
  if (!E.toasts) return;
  const ico = icon && /^\/img\/[a-z0-9-]+\.png$/.test(icon) ? `<img class="toast-ico" src="${icon}" alt="" aria-hidden="true">` : '';
  const ava = avatar ? `<span data-avatar>${esc(avatar)}</span> ` : '';   // an agent's own emoji (Settings → Display → Agents' emoji)
  const act = action && action.label ? ` <button type="button" class="btn small primary toast-act">${esc(action.label)}</button>` : '';
  const e = E.toasts.appendChild(h(`<div class="toast ${kind}">${ico}${ava}${esc(text)}${act}</div>`));
  const b = e.querySelector('.toast-act');
  if (b) b.onclick = () => { e.remove(); try { action.run(); } catch (err) { console.error('[toast] action', err); } };
  setTimeout(() => { e.style.transition = 'opacity .3s'; e.style.opacity = '0'; setTimeout(() => e.remove(), 330); }, ms);
  while (E.toasts.children.length > 4) E.toasts.firstChild.remove();
}

// ------------------------------------------------------------------ helpers
export function placeOf(i) {
  const c = agents.ctx[i];
  if (c === -2) return 'Underground';
  if (c < 0) return addressAt(S.grid, agents.rx[i], agents.rz[i], app.terrain?.roadNet);
  const B = S.world.buildings[c >> 6];
  if (!B) return '';
  return B.floors > 1 ? `${B.name} · floor ${(c & 63) + 1}` : B.name;
}
function actOf(i) {
  const u = USES[USE_LIST[agents.use[i]]] || USES.idle;
  return { icon: u.icon === '•' ? '🧍' : u.icon, label: u.label };
}
function parkAt(cx, cy) {
  const p = cam.groundAt(cx, cy, GROUND_Y);
  for (const B of S.world.buildings) {
    if (!B || B.gone || B.type !== 'park') continue;
    const fp = footprint(B);
    if (p.x > fp.x0 && p.x < fp.x1 && p.z > fp.z0 && p.z < fp.z1) return B.idx;
  }
  return -1;
}

// ------------------------------------------------------------------ top bar
/** A top bar wider than the screen (a phone: app.css) scrolls sideways under the finger — no scroll bar, nothing squeezed
 *  or cut off; at an end with more beyond it, a fade with an arrow says so (a tap scrolls most of a screen that way); a
 *  mouse wheel scrolls it too. (2026-10-18, the product owner: "on mobile some buttons get cut off … make the top bar swipable") */
function swipeBar(el) {
  const ends = ['l', 'r'].map(s => el.parentElement.appendChild(h(`<button type="button" class="tb-more ${s}" tabindex="-1" aria-hidden="true">${s === 'l' ? '‹' : '›'}</button>`)));
  ends.forEach((b, k) => { b.onclick = () => el.scrollBy({ left: (k ? 1 : -1) * Math.max(80, el.clientWidth * 0.7), behavior: 'smooth' }); });
  let queued = false;
  const update = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const max = el.scrollWidth - el.clientWidth, scrolls = getComputedStyle(el).overflowX !== 'visible';
      ends[0].classList.toggle('on', scrolls && el.scrollLeft > 2);
      ends[1].classList.toggle('on', scrolls && el.scrollLeft < max - 2);
    });
  };
  el.addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  // (its buttons come and go — the bell, the wallet, Agent Providers, the account — as the modules and the account say)
  new MutationObserver(update).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  el.addEventListener('wheel', e => {
    if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY) || getComputedStyle(el).overflowX === 'visible') return;
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, { passive: false });
  update();
}
function buildTopbar(root) {
  const skips = [[7, 'Morning · 7 AM'], [9, 'Work · 9 AM'], [12.5, 'Lunch · 12:30'], [18, 'Evening · 6 PM'], [21.5, 'Night · 9:30 PM']];
  const el = E.topbar = root.appendChild(h(`<div id="topbar" class="panel">
  <div class="brand"><img class="logo" src="/img/brand/mvw-mark.webp" alt="My Virtual World" draggable="false"></div>
  <button type="button" class="btn icon undo" disabled title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
  <button type="button" class="btn icon redo" disabled title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
  <div id="clock" title="World time — a day lasts 90 real minutes at 1×"><span class="sun">☀️</span><span class="t">--:--</span><span class="d"></span></div>
  <div id="speed" data-cap="world.clock" title="Only admins change the world clock">
    <button type="button" class="btn pause" title="Pause (Space)" aria-label="Pause" aria-pressed="false">${PAUSE}</button>
    <button type="button" class="btn spd" title="Speed" aria-label="Speed"></button>
    <select class="input skip" title="Skip ahead in time"><option value="">Skip to…</option>${skips.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
  <div class="spacer"></div>
  <button type="button" class="btn icon searchb" title="Search people & places (/)" aria-label="Search">🔍</button>
  <div id="search"><input class="input" placeholder="${innerWidth <= 760 ? 'Search people & places' : 'Search people & places   /'}" spellcheck="false" autocomplete="off"><div class="results panel scroll hidden"></div></div>
  <button type="button" class="btn icon soundb" title="Sound on — tap to mute" aria-label="Mute all sound" aria-pressed="false">🔊</button>
  <button type="button" class="btn icon helpb" title="Controls (H)" aria-label="Controls">❓</button>
  <button type="button" class="btn icon setb" title="Settings" aria-label="Settings">⚙️</button>
  <div id="net" title="Server connection"></div>
</div>`));
  swipeBar(el);
  E.clockT = el.querySelector('#clock .t'); E.clockD = el.querySelector('#clock .d'); E.sun = el.querySelector('#clock .sun');
  E.pause = el.querySelector('#speed .pause'); E.spd = el.querySelector('#speed .spd');
  E.pause.onclick = togglePause;
  E.spd.onclick = cycleSpeed;
  const sk = el.querySelector('.skip');
  sk.onchange = async () => {
    const v = sk.value; sk.value = '';
    if (!v) return;
    if (!auth.can('world.clock')) return toast('Only admins can change the world clock', 'bad');
    try { await post('/api/clock', { skip: +v }); toast(`Skipped ahead to ${formatClock(+v)} — everyone re-plans their day`); } catch (e) { toast(e.message, 'bad'); }
  };
  // sound on/off for this device (audio/mixer.js; the volumes are in Settings → Sound)
  const sb = el.querySelector('.soundb');
  const paintSound = () => {
    const on = soundOn();
    sb.innerHTML = icon(on ? 'speaker' : 'speaker-off');
    sb.title = on ? 'Sound on — tap to mute' : 'Sound off — tap to turn it on';
    sb.setAttribute('aria-label', on ? 'Mute all sound' : 'Turn sound on');
    sb.setAttribute('aria-pressed', String(!on));
  };
  sb.onclick = () => { const on = !soundOn(); setSoundOn(on); toast(on ? 'Sound on' : 'Sound off — Settings → Sound has the volumes', '', 2200); };
  bus.on('sound', paintSound);
  paintSound();
  el.querySelector('.helpb').onclick = toggleHelp;
  el.querySelector('.setb').onclick = () => import('./settings.js').then(m => m.open(app, 'display'));
  // Settings' code (about twenty files: its tabs' and theirs), fetched while the page is idle once the world is up, so
  // its first open doesn't wait for it — a chain of requests, one after another, on a phone's network (2026-10-08)
  const warmSettings = () => import('./settings.js').catch(() => { /* fetched when it opens */ });
  bus.on('ready', () => { if (typeof requestIdleCallback === 'function') requestIdleCallback(warmSettings, { timeout: 8000 }); else setTimeout(warmSettings, 3000); });
  E.net = el.querySelector('#net');
  E.search = el.querySelector('#search input'); E.results = el.querySelector('#search .results');
  bindSearch();
}
async function setRate(r) {
  if (!auth.can('world.clock')) { toast('Only admins can change the world clock', 'bad'); return false; }
  try { await post('/api/clock', { rate: r }); if (r > 0) lastRate = r; return true; } catch (e) { toast(e.message, 'bad'); return false; }
}
function togglePause() { const r = app.net.clock ? app.net.clock.rate : 1; setRate(r > 0 ? 0 : (lastRate || 1)); }
/** The speed after `r` in the cycle 1× → 4× → 16× → 60× → 1× (a speed outside the cycle moves to the next one up). */
function nextSpeed(r) {
  const i = SPEEDS.indexOf(r), j = i >= 0 ? i + 1 : SPEEDS.findIndex(s => s > r);
  return SPEEDS[j >= 0 && j < SPEEDS.length ? j : 0];
}
/** The one speed button (DECISIONS C113). While the clock runs a click moves to the next speed; while it is paused the
 *  click only changes the speed to resume at, and the pause button (or Space) resumes. */
function cycleSpeed() {
  if (!auth.can('world.clock')) return toast('Only admins can change the world clock', 'bad');
  const r = app.net.clock ? app.net.clock.rate : 1, next = nextSpeed(r > 0 ? r : lastRate || 1);
  if (r === 0) { lastRate = next; updateSpeed(); toast(`Resumes at ${next}× — press pause or Space to resume`); return; }
  setRate(next);
}
function updateSpeed() {
  const r = app.net.clock ? app.net.clock.rate : 1;
  if (r > 0) lastRate = r;
  const shown = r > 0 ? r : lastRate || 1, next = nextSpeed(shown), paused = r === 0;
  if (E.spd._r !== shown) { E.spd._r = shown; E.spd.innerHTML = TRI + (shown > 1 ? `<b>${shown}×</b>` : ''); }
  E.spd.dataset.r = String(shown);
  const t = `Speed ${shown}×${shown === 1 ? ' (a day lasts 90 minutes)' : ''}${paused ? ' when resumed' : ''} — click for ${next}×`;
  if (E.spd.title !== t) { E.spd.title = t; E.spd.setAttribute('aria-label', t); }
  E.pause.classList.toggle('on', paused);
  E.pause.setAttribute('aria-pressed', String(paused));
  E.pause.title = paused ? 'Resume (Space)' : 'Pause (Space)';
}
function buildIndex() {
  const out = [];
  for (const p of S.people) if (p) out.push({ k: 'p', i: p.i, name: p.n, vip: !!p.v, em: p.e || '🙂', sub: p.v ? (p.r || 'AI agent') : (p.jt || 'Resident'), s: `${p.n} ${p.r || ''} ${p.jt || ''} ${p.v ? 'ai agent' : ''}`.toLowerCase() });
  S.world.buildings.forEach((B, b) => {
    if (!B || B.gone) return;
    out.push({ k: 'b', b, name: B.name, em: TYPE_ICON[B.type] || '🏢', sub: `${TYPE_NAME[B.type] || B.type}${B.floors > 1 ? ` · ${B.floors} floors` : ''}${B.shopName && B.shopName !== B.name ? ' · ' + B.shopName : ''}`, s: `${B.name} ${B.sign || ''} ${B.shopName || ''} ${B.type} ${TYPE_NAME[B.type] || ''}`.toLowerCase() });
  });
  for (const st of S.world.stations) out.push({ k: 's', st, name: `${st.name} Station`, em: '🚇', sub: 'Subway entrance', s: `${st.name} station subway metro`.toLowerCase() });
  return out;
}
function bindSearch() {
  let hl = 0, list = [];
  const paint = () => [...E.results.children].forEach((c, k) => c.classList.toggle('hl', k === hl));
  const render = () => {
    const q = E.search.value.trim().toLowerCase();
    if (!q) { E.results.classList.add('hidden'); list = []; return; }
    if (!searchIdx) searchIdx = buildIndex();
    const words = q.split(/\s+/);
    list = searchIdx.filter(r => words.every(w => r.s.includes(w)))
      .map(r => ({ r, sc: (r.name.toLowerCase().startsWith(q) ? 0 : r.s.split(/\s+/).some(w => w.startsWith(words[0])) ? 1 : 2) - (r.vip ? 0.6 : 0) + (r.k === 'p' && !r.vip ? 0.3 : 0) }))
      .sort((a, b) => a.sc - b.sc || a.r.name.localeCompare(b.r.name)).slice(0, 14).map(x => x.r);
    hl = 0;
    E.results.innerHTML = list.length
      ? list.map((r, k) => `<div class="result${k === hl ? ' hl' : ''}" data-k="${k}"><span class="em"${r.k === 'p' ? ' data-avatar' : ''}>${esc(r.em)}</span><div style="min-width:0"><div>${esc(r.name)}</div><div class="sub">${esc(r.sub)}</div></div></div>`).join('')
      : '<div class="result dim">No matches</div>';
    E.results.classList.remove('hidden');
  };
  const pick = r => { if (!r) return; E.search.value = ''; E.results.classList.add('hidden'); E.search.blur(); goTo(r); };
  E.search.addEventListener('input', render);
  E.search.addEventListener('focus', render);
  E.search.addEventListener('blur', () => setTimeout(() => { E.results.classList.add('hidden'); if (document.activeElement !== E.search) E.topbar.querySelector('#search').classList.remove('open'); }, 160));
  // a phone: search is a button in the top bar; the field opens across the bar while it is used
  // (the bar back at its start first: it may be scrolled sideways, and the field opens over the part on screen)
  E.topbar.querySelector('.searchb').onclick = () => { E.topbar.scrollLeft = 0; E.topbar.querySelector('#search').classList.add('open'); E.search.focus(); };
  E.search.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (list.length) { hl = (hl + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length; paint(); } }
    else if (e.key === 'Enter') pick(list[hl]);
    else if (e.key === 'Escape') { E.search.value = ''; E.results.classList.add('hidden'); E.search.blur(); }
  });
  E.results.addEventListener('mousedown', e => { e.preventDefault(); const el = e.target.closest('.result'); if (el && el.dataset.k !== undefined) pick(list[+el.dataset.k]); });
}
function goTo(r) {
  if (r.k === 'p') { select(r.i, { fly: true }); return; }
  stopFollow();
  if (r.k === 'b') {
    const B = bld(r.b); if (!B) return;
    if (S.focus.b >= 0 && S.focus.b !== r.b) exitFocus();
    selectBuilding(r.b);
    cam.flyTo(B.x, 0, B.z, clamp(Math.max(B.w, B.d) * 2 + B.floors * 2.6, 40, 260));
  } else if (r.k === 's') cam.flyTo(r.st.x, 0, r.st.z, 40);
}

// ------------------------------------------------------------------ roster
function buildRoster(root) {
  // The list fills its section of the right dock; the section itself folds it away (I3.4).
  const el = E.roster = root.appendChild(h(`<div id="roster" class="panel">
    <div class="drow"><span class="seg teamview" role="tablist" aria-label="Which agents">
      <button type="button" class="btn small" role="tab" data-tv="mine" title="Your own agents">My agents</button>
      <button type="button" class="btn small" role="tab" data-tv="public" title="Anyone's agents that anyone may talk with">Public</button></span>
      <select class="input minisel sortsel" aria-label="Sort the team list" title="Sort the team list">
      <option value="world">Default order</option><option value="name">By name</option>
      <option value="work">Group by work building</option><option value="home">Group by home building</option></select></div>
    <div class="head"><span>Agents <span class="cnt"></span></span><button type="button" class="btn small ros-add" data-cap="agents.new" title="A built-in agent, or your Grok Bot, OpenAI Dot or Meta Muse">➕ New agent</button></div>
    <div class="list scroll"></div></div>`));
  E.rosterList = el.querySelector('.list'); E.rosterCnt = el.querySelector('.cnt'); E.sortSel = el.querySelector('.sortsel'); E.teamView = el.querySelector('.teamview');
  E.teamView.onclick = e => { const b = e.target.closest('[data-tv]'); if (b) { setPref('teamView', b.dataset.tv); renderRoster(); } };
  // ➕ New agent (ui/new-agent.js): a built-in agent, or a third-party one (Grok Bot, OpenAI Dot, Meta Muse); both end in its Studio
  el.querySelector('.ros-add').onclick = () => openNewAgent(app);
  E.sortSel.onchange = () => { setPref('teamSort', E.sortSel.value); renderRoster(); };
  E.rosterList.addEventListener('click', e => {
    const row = e.target.closest('.agent-row'); if (!row) return;
    if (row.dataset.ext) return bus.emit('openagent', +row.dataset.ext);   // a connected agent has no body to fly to: its chat opens
    select(+row.dataset.i, { fly: true, force: true });
  });
}
/** Which agents the team list shows (2026-10-09): this account's own — the ones it owns or may manage — or the public
 *  ones, anyone's agent that anyone may talk with (the server's `public`: its owner gives visitors its work or its life).
 *  Another account's private agent is never listed. A guest has no agents of its own: it sees the public ones. */
const teamView = () => (auth.account && pref('teamView') !== 'public' ? 'mine' : 'public');
const isMine = a => !!(a && (a.mine || a.level === 'manage'));
const listed = a => !!a && (teamView() === 'mine' ? isMine(a) : !isMine(a) && !!a.public);
/** The team list's order and its groups (DECISIONS C115): the world's order by default, or by name, or grouped
 *  under the workplace or the home building. The choice follows the account (display.teamSort). */
function renderRoster() {
  const sort = pref('teamSort') || 'world', view = teamView();
  const byKey = new Map((S.agentList || []).map(a => [a.key, a]));
  vipIdx = S.people.filter(p => p && p.v && listed(byKey.get(p.ag))).map(p => p.i);
  if (E.teamView) {
    E.teamView.querySelector('[data-tv="mine"]').classList.toggle('hidden', !auth.account);
    for (const b of E.teamView.querySelectorAll('[data-tv]')) { const on = b.dataset.tv === view; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
  }
  const ppl = i => S.people[i] || {};
  const byName = (a, b) => String(ppl(a).n || '').localeCompare(String(ppl(b).n || ''));
  const rowHTML = i => { const p = ppl(i); return `<div class="agent-row" data-i="${i}"><div class="em"><span data-avatar>${esc(p.e || '⭐')}</span><i></i></div><div style="min-width:0"><div class="nm">${esc(p.n)}</div><div class="ac"></div></div></div>`; };
  const parts = [];
  if (sort === 'name') {
    vipIdx.sort(byName);
    for (const i of vipIdx) parts.push(rowHTML(i));
  } else if (sort === 'work' || sort === 'home') {
    const at = i => (sort === 'work' ? ppl(i).jb : ppl(i).hb) ?? -1;
    vipIdx.sort((a, b) => at(a) - at(b) || byName(a, b));
    let cur = null;
    for (const i of vipIdx) {
      const b = at(i);
      if (b !== cur) { cur = b; const B = bld(b); parts.push(`<div class="tgroup">${esc(B ? B.name : (sort === 'work' ? 'No workplace' : 'No home'))}</div>`); }
      parts.push(rowHTML(i));
    }
  } else for (const i of vipIdx) parts.push(rowHTML(i));
  // connected agents (WP2.14) have no body in the city; they are listed here in their own right and open their chat (the
  // server lists another's only to those its owner lets see it: in the public list)
  const ext = bodylessAgents(S.agentList).filter(a => (view === 'mine' ? isMine(a) : !isMine(a)));
  if (!parts.length && !ext.length) parts.push(`<p class="hint team-none">${view === 'mine' ? 'You have no agents yet. ➕ New agent makes one: it moves into town with a home and a job.'
    : 'No public agents yet. An agent shows here when its owner lets anyone talk with it (its Studio\'s Visitors tab).'}</p>`);
  if (ext.length) {
    parts.push('<div class="tgroup">Connected agents</div>');
    for (const a of ext) parts.push(`<div class="agent-row" data-ext="${a.id}"><div class="em">🤖<i></i></div><div style="min-width:0"><div class="nm">${esc(a.name)}</div><div class="ac"></div></div></div>`);
  }
  E.rosterList.innerHTML = parts.join('');
  E.rosterRows = [...E.rosterList.children].filter(e => e.dataset.i !== undefined);
  if (E.sortSel) E.sortSel.value = sort;
  tickRoster();
}
/** Favourites (DECISIONS C115). A place is a building's permanent id, such as "b0"; a place this account owns
 *  counts as a favourite and shows a house instead of a star. */
const favList = () => String(pref('favourites') || '').split(',').map(s => s.trim()).filter(Boolean);
const ownedBy = B => !!(B && B.owner && auth.account && B.owner === auth.account.id);
const isFav = B => !!(B && favList().includes(B.id));
function toggleFav(B) {
  if (!B) return;
  const l = favList(), i = l.indexOf(B.id);
  if (i >= 0) l.splice(i, 1); else l.push(B.id);
  setPref('favourites', l.slice(0, 80).join(','));
  bus.emit('favs');
  toast(i >= 0 ? `${B.name} is no longer a favourite` : `${B.name} is a favourite`, '', 1600);
}
function favBtn(B) {
  const own = ownedBy(B), on = own || isFav(B);
  const label = own ? 'Yours — always a favourite' : on ? 'Remove from favourites' : 'Add to favourites';
  return `<button type="button" class="fbtn${on ? ' on' : ''}${own ? ' owned' : ''}" data-fav="${esc(B.id)}" title="${label}" aria-label="${label}" aria-pressed="${on}">${own ? '🏠' : '★'}</button>`;
}
function tickRoster() {
  if (!E.rosterRows) return;
  let live = 0;
  for (const row of E.rosterRows) {
    const i = +row.dataset.i, p = S.people[i]; if (!p) continue;
    const pr = S.presence[p.ag], w = !!(pr && pr.working);
    if (w) live++;
    row.querySelector('i').classList.toggle('live', w);
    const a = actOf(i);
    set(row.querySelector('.ac'), `${a.icon} ${a.label} · ${placeOf(i)}`);
    row.classList.toggle('sel', i === S.sel);
    row.title = w ? `Working now${pr.task ? ': ' + pr.task : ''}` : `${p.n} — ${p.r || ''}`;
  }
  const view = teamView(), ext = bodylessAgents(S.agentList).filter(a => (view === 'mine' ? isMine(a) : !isMine(a)));
  for (const a of ext) {
    const row = E.rosterList.querySelector(`[data-ext="${a.id}"]`); if (!row) continue;
    const st = stateOf(a, S.presence[a.key]);
    if (st.working) live++;
    set(row.querySelector('.ac'), `${st.label} · connected agent`);
    row.querySelector('i').classList.toggle('live', st.live);
    row.title = `${a.name}: ${st.label}. Click to chat.`;
  }
  set(E.rosterCnt, live ? `· ${live} working` : `· ${vipIdx.length + ext.length}`);
}
function presenceToast(m) {
  const w = !!(m.info && m.info.working), was = !!lastWorking[m.id];
  lastWorking[m.id] = w;
  if (w && !was) {
    const p = S.people.find(q => q && q.v && q.ag === m.id);
    if (p) toast(`${p.n} started working${m.info.task ? ': ' + m.info.task : ''}`, 'good', 3400, '', p.e || '⭐');
  }
}

// ------------------------------------------------------------------ the selection widget
// What is selected shows in a widget that comes down from under the top bar (2026-10-07, 2026-10-08): no header —
// its kind is a badge beside the name — and a handle at its lower middle that folds it up under the top bar and down
// again. Beside the handle, Auto / Manual: Auto (the default) opens it when something is selected and folds it away
// when nothing is; Manual leaves it as the person put it (selecting only changes what it shows). The account's display
// preference `selectionWidget`: 'auto', or 'open' / 'closed' (manual, as left). css/selection.css.
const SEL_GAP = 8, GRIP_H = 18;
function buildInspector() {
  E.selHost = (document.getElementById('ui') || document.body).appendChild(h(`<aside id="selcard" class="selcard" aria-label="Selection">
    <div class="insp panel" data-kind="none" id="selbody"><div class="body scroll"></div></div>
    <div class="sel-grip"><span></span>
      <button type="button" class="sel-handle" aria-controls="selbody" aria-expanded="false"><i class="sel-bar" aria-hidden="true"></i><span class="sel-peek" data-noicon></span></button>
      <button type="button" class="sel-mode" aria-pressed="true"></button></div></aside>`));
  E.insp = E.selHost.querySelector('.insp'); E.inspBody = E.insp.querySelector('.body');
  E.selHandle = E.selHost.querySelector('.sel-handle'); E.selMode = E.selHost.querySelector('.sel-mode'); E.selPeek = E.selHost.querySelector('.sel-peek');
  E.selHandle.onclick = () => setSelOpen(!E.selOpen, { by: 'hand' });
  E.selMode.onclick = () => {
    const auto = selAuto();
    setPref('selectionWidget', auto ? (E.selOpen ? 'open' : 'closed') : 'auto');
    paintSelMode();
    if (!auto) setSelOpen(S.sel >= 0 || S.selB >= 0);   // (back to Auto: as it would be now)
    toast(auto ? 'Manual: the selection stays open or folded as you leave it' : 'Auto: the selection opens when you select something and folds away when you don\'t', '', 3000);
  };
  bus.on('prefs', names => { if (names.includes('selectionWidget')) { paintSelMode(); applySelPref(); } });
  // the room it takes at the top, for what keeps clear of it: the toasts and floor control (--sel-b) and the chat window
  let rf = 0;
  new ResizeObserver(() => { if (!rf) rf = requestAnimationFrame(() => { rf = 0; selRoom(); }); }).observe(E.selHost);
  addEventListener('resize', () => selRoom(true));
  E.inspBody.addEventListener('click', e => {
    // nothing selected: one of the account's agents, picked from the widget
    const pick = e.target.closest('[data-pick]');
    if (pick) { select(+pick.dataset.pick, { force: true, fly: true }); return; }
    // A home's name goes inside its building, to its floor, and marks the flat (render/flat-marker.js); a workplace's name
    // goes inside, to the floor where they work (2026-10-07: the name itself takes you there)
    const go = e.target.closest('a[data-go]');
    if (go) {
      e.preventDefault();
      const [b, f, u] = go.dataset.go.split(':').map(Number), p = S.people[S.sel];
      if (!bld(b)) return;
      if (S.mode === 'play') setMode('explore');
      lookInside(b, f);
      if (u >= 0) app.flatMarker?.show(b, f, u, `🏠 ${p ? `${p.n}'s` : 'Their'} home · floor ${f + 1}, flat ${u + 1}`);
      return;
    }
    // A home or work row selects that building and frames it (DECISIONS C115); the floor list inside the building's
    // own panel is what looks inside.
    const a = e.target.closest('a[data-b]');
    if (a) {
      e.preventDefault();
      const b = +a.dataset.b, B = bld(b);
      if (!B) return;
      stopFollow();
      if (S.mode === 'play') setMode('explore');
      selectBuilding(b);
      cam.flyTo(B.x, 0, B.z + Math.max(B.d, 8) * 0.6, clamp(Math.max(B.w, B.d) * 2.1 + 45, 40, 260));
    }
  });
  bus.on('agentlist', () => { if (S.sel < 0 && S.selB < 0) emptySel(); });
  app.selection = { open: () => setSelOpen(true), close: () => setSelOpen(false), isOpen: () => !!E.selOpen };
  paintSelMode();
  emptySel();
  applySelPref();
}
const selAuto = () => !['open', 'closed'].includes(pref('selectionWidget'));
function paintSelMode() {
  const auto = selAuto(), b = E.selMode;
  b.textContent = auto ? 'Auto' : 'Manual';
  b.setAttribute('aria-pressed', String(auto));
  b.title = auto ? 'Auto: opens when you select something, folds away when you don\'t — click for Manual' : 'Manual: stays open or folded as you leave it — click for Auto';
  b.setAttribute('aria-label', b.title);
}
/** Open or folded as the preference says now (Auto: open while something is selected). */
function applySelPref() {
  const v = pref('selectionWidget');
  setSelOpen(v === 'open' ? true : v === 'closed' ? false : (S.sel >= 0 || S.selB >= 0));
}
/** Opens or folds the widget. By hand in Manual, the choice is kept for the account. */
function setSelOpen(on, { by = '' } = {}) {
  const host = E.selHost; if (!host) return;
  on = !!on;
  if (by === 'hand' && !selAuto()) setPref('selectionWidget', on ? 'open' : 'closed');
  E.selOpen = on;
  host.classList.toggle('open', on);
  E.selHandle.setAttribute('aria-expanded', String(on));
  E.selHandle.title = on ? 'Fold the selection away' : 'Show the selection';
  E.selHandle.setAttribute('aria-label', E.selHandle.title);
  paintPeek();
  selRoom();
}
/** Folded with something selected: its name on the handle. */
function paintPeek() {
  const p = S.sel >= 0 ? S.people[S.sel] : null, B = S.selB >= 0 ? bld(S.selB) : null;
  const name = !E.selOpen ? (p ? p.n : B ? B.name : '') : '';
  set(E.selPeek, name);
  E.selHandle.classList.toggle('peek', !!name);
}
/** Nothing selected: what the widget can do, and the account's agents to pick from. */
function emptySel() {
  E.bd = null; E.ag = null; E.selKey = null;
  setKind('none');
  const mine = (S.agentList || []).filter(a => a.i >= 0 && S.people[a.i] && (a.mine || a.level)).slice(0, 8);
  E.inspBody.className = 'body scroll sel-none';
  E.inspBody.innerHTML = `<div class="sel-empty"><span class="sel-empty-ic" aria-hidden="true">🔍</span><div class="sel-empty-t"><b>Nothing selected</b>
    <span>Click a person or a building in the world${mine.length ? ', or one of your agents' : ''} to see them here.</span></div>
    ${mine.length ? `<div class="sel-empty-agents">${mine.map(a => `<button type="button" class="btn small" data-pick="${a.i}"><span data-avatar>${esc(a.emoji || '🤖')}</span> <span data-noicon>${esc(a.name)}</span></button>`).join('')}</div>` : ''}</div>`;
}
function hideInsp() {
  emptySel();
  if (selAuto()) setSelOpen(false); else paintPeek();
}
/** Something is selected (`key`: who or what): its contents come in; Auto opens the widget. */
function selCard(key) {
  const was = E.selKey; E.selKey = key;
  if (selAuto() && !E.selOpen) setSelOpen(true);
  else {
    paintPeek();
    // another person or building while it is open: its contents come in; the same one redrawn (a live update) stays still
    if (E.selOpen && key !== was) { E.inspBody.getAnimations?.().forEach(a => a.cancel()); E.inspBody.animate?.([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
  }
}
/** Where the widget ends at the top — open, its card and the handle under it; folded, the handle under the top bar — for
 *  the toasts and the floor control under it (--sel-b, E.selB) and the chat window (bus 'selcard'). From the layout,
 *  not the moving picture, so it is right at once. */
function selRoom(force = false) {
  const host = E.selHost; if (!host) return;
  const b = Math.round(E.selOpen ? host.offsetTop + host.offsetHeight + GRIP_H / 2 + SEL_GAP : (E.topbar ? E.topbar.offsetHeight : 56) + GRIP_H + SEL_GAP);
  if (b === E.selB && !force) return;
  E.selB = b;
  document.documentElement.style.setProperty('--sel-b', `${b}px`);
  bus.emit('selcard', E.selOpen);
}
/** What is selected, for the card's colour: 'agent', 'resident' or a building's type. */
function setKind(k) { if (E.insp) { E.insp.dataset.kind = k; E.selHost.dataset.kind = k; } }   // (the handle wears it too)
function showAgent(i) {
  const p = S.people[i]; if (!p) return hideInsp();
  E.bd = null;
  setKind(p.v ? 'agent' : 'resident');
  // one panel, two tabs (ui/sel-feeds.js fills them): Activity — what they are doing now, then what they did, newest first —
  // and Money; an agent this account manages is dressed in its Agent Studio, a resident by administrators in the Customizer
  const mine = !!p.v && !!studioAgentAt(S.agentList, i);
  E.inspBody.innerHTML = `
  <div class="title"><div class="big" data-avatar>${esc(p.e || '🙂')}</div><div style="min-width:0"><div class="name"><span data-noicon>${esc(p.n)}</span><span class="kind">${p.v ? 'AI agent' : 'Resident'}</span></div><div class="role">${esc(p.v ? (p.r || '') : (p.jt || 'Resident'))}</div><div class="row tags"></div></div></div>
  <div class="row sel-btns"><button class="btn primary follow" title="Follow (F)">🎥 Follow</button><button class="btn talk" title="Talk (T)">💬 Talk</button><button class="btn cust"${mine ? ' title="Its look, in its Agent Studio"' : ' data-cap="world.edit"'}>🎨 Customize</button><button class="btn agchat hidden" title="Chat with this agent">🤖 Chat</button><button class="btn agpc hidden" title="Use its PC on its screen">💻 PC</button></div>
  <div class="sel-feed">
    <div class="sf-tabs" role="tablist"><button type="button" class="sf-tab" data-ft="act" role="tab">📜 Activity</button><button type="button" class="sf-tab hidden" data-ft="thoughts" role="tab">🧠 Thoughts</button><button type="button" class="sf-tab hidden" data-ft="money" role="tab"><img class="vc-ico sm" src="/img/vc-64.png" alt="" aria-hidden="true" draggable="false"> Money <small class="sf-bal"></small></button></div>
    <div class="sf-pane" data-pane="act"><div class="feed-scroll"><div class="act"><div class="ic"></div><div style="min-width:0"><div class="lb"></div><div class="pl"></div></div></div><div class="feed-items"></div></div></div>
    <div class="sf-pane hidden" data-pane="thoughts"><div class="feed-scroll"><div class="feed-items"></div></div></div>
    <div class="sf-pane hidden" data-pane="money"><div class="mf-head"></div><div class="feed-scroll"><div class="feed-items"></div></div></div>
  </div>
  <div class="sel-info"><div class="said hidden"></div><div class="task hint hidden"></div><div class="needs"></div><div class="kv"></div></div>`;
  E.inspBody.className = 'body scroll sel-person';
  selCard(`p${i}`);
  const q = s => E.inspBody.querySelector(s);
  E.ag = { i, ic: q('.act .ic'), lb: q('.act .lb'), pl: q('.act .pl'), tags: q('.tags'), task: q('.task'), said: q('.said'), needs: q('.needs'), kv: q('.kv'), follow: q('.follow') };
  E.ag.follow.onclick = () => (S.follow ? stopFollow() : startFollow());
  q('.talk').onclick = talkSel;
  // a connected agent's body: its chat opens from here too (the agent list only holds what this viewer may see)
  const rec = (S.agentList || []).find(a => isExt(a) && a.i === i);
  if (rec) { const b = q('.agchat'); b.classList.remove('hidden'); b.onclick = () => bus.emit('openagent', rec.id); }
  q('.cust').onclick = () => (app.openCustomizer ? app.openCustomizer({ kind: 'person', i }) : toast('The customizer is still loading'));   // (an agent's goes to its Studio: ui/customizer.js)
  // its PC, used on its screen (render/pc-screens.js knows this account's own agents — the PC is its owner's alone)
  const pcA = app.pcScreens && [...app.pcScreens.mine.values()].find(a => a.i === i);
  if (pcA) { const b = q('.agpc'); b.classList.remove('hidden'); b.onclick = () => bus.emit('pc:use', pcA.id); }
  updateAgentLocal();
  if (info && infoFor === i) updateAgentInfo();
  fetchInfo(true);
  for (const fn of app.inspHooks?.resident || []) fn(E.inspBody, i);   // other modules' lines (ui/economy.js: their money)
}
async function fetchInfo(force) {
  const i = S.sel; if (i < 0 || document.hidden) return;
  const now = performance.now();
  if (!force && now - infoT < 2500) return;
  infoT = now;
  try { const j = await getJSON('/api/agent/' + i); if (S.sel === i && !j.retired) { info = j; infoFor = i; updateAgentInfo(); updateAgentLocal(); } } catch { /* offline */ }
}
function updateAgentLocal() {
  const i = S.sel; if (i < 0 || !E.ag || E.ag.i !== i) return;
  const p = S.people[i]; if (!p) return;
  const now = S.simT, fresh = info && infoFor === i && performance.now() - infoT < 8000, ds = app.net.clock ? app.net.clock.dayScale : 16;
  let icon, label, place = placeOf(i), extra = '';
  if (fresh && info.act) {
    icon = info.act.icon; label = info.act.label;
    if (agents.mov[i] && info.act.travelEnd > now) { extra = info.act.place ? ` → ${info.act.place}` : ''; label += ' (on the way)'; }
    else if (info.act.holdEnd > now) { const m = Math.round((info.act.holdEnd - now) * ds / 60); if (m >= 2) extra = ` · ${m >= 90 ? Math.round(m / 60) + ' h' : m + ' min'} left`; }
  } else { const a = actOf(i); icon = a.icon; label = a.label; }
  if (agents.ctx[i] === -2) { icon = '🚇'; label = 'Riding the subway'; place = 'Underground'; extra = ''; }
  set(E.ag.ic, icon || '🧍'); set(E.ag.lb, label || ''); set(E.ag.pl, place + extra);
  const pr = p.v ? S.presence[p.ag] : null;
  const tags = `${pr && pr.working ? '<span class="tag live">● Working now</span>' : ''}${S.follow ? '<span class="tag">🎥 Following</span>' : ''}`;
  if (E.ag.tags._h !== tags) { E.ag.tags.innerHTML = tags; E.ag.tags._h = tags; }
  if (pr && pr.working && pr.task) { set(E.ag.task, '🛠️ ' + pr.task); E.ag.task.classList.remove('hidden'); } else E.ag.task.classList.add('hidden');
  E.ag.follow.classList.toggle('on', S.follow); set(E.ag.follow, S.follow ? '🎥 Following' : '🎥 Follow');
  const say = S.says && S.says.get(i);
  if (say && S.simT < say.until) showSaid(say.text); else E.ag.said.classList.add('hidden');
}
function showSaid(text) { if (!E.ag) return; set(E.ag.said, `“${text}”`); E.ag.said.classList.remove('hidden'); }
function updateAgentInfo() {
  if (!E.ag || !info || infoFor !== E.ag.i) return;
  E.ag.needs.innerHTML = NEEDS.map(([k, ic, lb]) => {
    const v = clamp(+(info.needs && info.needs[k]) || 0, 0, 1), c = v > 0.6 ? 'var(--good)' : v > 0.3 ? 'var(--gold)' : 'var(--bad)';
    return `<span class="nd" title="${lb} ${Math.round(v * 100)}%"><span class="nd-l">${ic} ${lb}</span><div class="bar"><i style="width:${Math.round(v * 100)}%;background:${c}"></i></div></span>`;
  }).join('');
  const j = info.job || {}, hm = info.home, sc = info.sched || {};
  // the name takes you there: inside the building, at the floor (and, for a home, the flat marked)
  const link = (b, f, u, t, title) => (b >= 0 && bld(b) ? `<a data-go="${b}:${Math.max(0, f | 0)}:${u ?? -1}" title="${esc(title)}">${esc(t)}</a>` : esc(t));
  E.ag.kv.innerHTML = `
    ${j.kind !== 'free' && j.title && !info.vip ? `<span class="k">Job</span><span>${esc(j.title)}</span>` : ''}
    ${j.b >= 0 ? `<span class="k">Works at</span><span>${link(j.b, j.f, -1, j.place || '', 'Go inside, to the floor where they work')}${j.start != null ? ` <span class="dim">${formatClock(j.start)}–${formatClock(j.end)}</span>` : ''}</span>` : `<span class="k">Work</span><span class="dim">Between jobs</span>`}
    ${hm ? `<span class="k">Home</span><span>${link(hm.b, hm.f, hm.u >= 0 ? hm.u : -1, `${hm.place || hm.name}${hm.u >= 0 ? `, flat ${hm.u + 1}` : ''}`, hm.u >= 0 ? 'Go inside and see their flat' : 'Go inside, to their floor')}</span>` : '<span class="k">Home</span><span class="dim">Looking for a place</span>'}
    ${sc.wake != null ? `<span class="k">Routine</span><span>Up ${formatClock(sc.wake)} · lunch ${formatClock(sc.lunch)} · bed ${formatClock(sc.bed)}</span>` : ''}`;
}
/** Talk (the selection card's button, T): the chat window on one's own agent, the talk bar on someone else's (ui/talk-bar.js:
 *  its answers in its bubble), and a resident who isn't an AI agent is said so in one line (ui/chat.js openPerson). Out
 *  loud in the world is Player mode's E, face to face. */
function talkSel() {
  const i = S.sel; if (i < 0) return;
  if (S.people[i]?.v && app.talk) app.talk.to(i); else app.chat?.openPerson(i);
}
/** The flats of the floor being looked at (an apartment floor): a button each, opening the flat's window (ui/flats.js). */
function flatsRow(B, b) {
  if (S.focus.b !== b || B.type !== 'apartment') return '';
  const L = S.world.levels[B.lv[S.focus.f]], n = L?.units?.length || 0;
  if (!n) return '';
  const tag = u => { const r = flatRecord(b, S.focus.f, u); return r ? (r.locked ? '🔒' : '') + (r.deal === 'sold' ? ' sold' : r.deal === 'rented' ? ' let' : r.deal === 'assigned' ? ' assigned' : '') : ''; };
  return `<div class="hint">Flats on floor ${S.focus.f + 1} — tap one for who lives there, visitors and the deal</div><div class="flatrow">${Array.from({ length: n }, (_, u) => `<button class="btn" data-u="${u}" title="Flat ${u + 1}">${u + 1}<small>${esc(tag(u))}</small></button>`).join('')}</div>`;
}
function showBuilding(b) {
  const B = bld(b); if (!B) return hideInsp();
  E.ag = null;
  const park = B.type === 'park';
  setKind(B.type || 'building');
  E.inspBody.innerHTML = `
  <div class="title"><div class="big">${TYPE_ICON[B.type] || '🏢'}</div><div style="min-width:0;flex:1"><div class="name"><span data-noicon>${esc(B.name)}</span><span class="kind">${esc(TYPE_NAME[B.type] || 'Building')}</span></div>
    <div class="role">${park ? 'Open to everyone' : `${B.floors} floor${B.floors > 1 ? 's' : ''} · ${esc(B.style)}`}</div>
    <div class="role">${esc(addressAt(S.grid, B.x, B.z, app.terrain?.roadNet))}${ownedBy(B) ? ' · <span class="own">yours</span>' : ''}</div>
    ${B.mixed && B.shopName ? `<div class="role">Street level: ${esc(B.shopName)}</div>` : ''}</div>${favBtn(B)}</div>
  <div class="act"><div class="ic">👥</div><div><div class="lb occ">Counting people…</div><div class="pl occ2"></div></div></div>
  <div class="row bld-btns">${park ? '<button class="btn primary look">🔍 Visit</button>' : '<button class="btn primary look">🔍 Look inside</button>'}${mayOn(B, 'furnish') ? '<button class="btn furn">🛋️ Furnish</button>' : ''}${mayOn(B, 'build') ? '<button class="btn edit">🏗️ Edit</button><button class="btn place" title="Handles on the building: move, resize, turn, floors">✥ Move</button>' : ''}</div>
  <div class="sel-place">${flatsRow(B, b)}${park ? '' : `<div class="hint">Floors — click one to look inside${B.lv.some(lv => levelMode(S.world.levels[lv]) !== 'auto') ? ' · ✎ changed by hand · ○ empty' : ''}</div><div class="floors">${Array.from({ length: B.floors }, (_, f) => `<button class="btn" data-f="${f}" data-fm="${levelMode(S.world.levels[B.lv[f]])}">${f + 1}<small></small></button>`).join('')}</div>`}</div>
  <div class="sel-slot"></div>`;
  E.inspBody.className = 'body scroll sel-place-card';
  selCard(`b${b}`);
  const q = s => E.inspBody.querySelector(s);
  E.bd = { b, occ: q('.occ'), occ2: q('.occ2'), floors: q('.floors') };
  const fb = q('.fbtn');
  if (fb && !fb.classList.contains('owned')) fb.onclick = () => { toggleFav(B); showBuilding(b); };
  if (S.selF !== null && !park && B.floors > 1) { q('.look').textContent = `🔍 Floor ${S.selF + 1}`; q('.look').title = `Look inside floor ${S.selF + 1}`; }   // (short: the buttons stay on one line)
  q('.look').onclick = () => lookInside(b, S.selB === b ? S.selF : null);
  if (q('.furn')) q('.furn').onclick = () => { if (!park) lookInside(b); setMode('furnish'); };
  if (q('.edit')) q('.edit').onclick = () => setMode('build');
  if (q('.place')) q('.place').onclick = () => app.place?.edit(b);
  if (E.bd.floors) E.bd.floors.onclick = e => { const btn = e.target.closest('.btn'); if (btn) lookInside(b, +btn.dataset.f); };
  if (q('.flatrow')) q('.flatrow').onclick = e => { const btn = e.target.closest('[data-u]'); if (btn) openFlat(b, S.focus.f, +btn.dataset.u); };
  markFloors();
  E.flRO?.disconnect();
  if (E.bd.floors) { E.flRO = new ResizeObserver(() => floorInView()); E.flRO.observe(E.bd.floors); }
  if (occ && occFor === b) updateOcc();
  fetchOcc(true);
  for (const fn of app.inspHooks?.building || []) fn(E.inspBody, b);   // other modules' lines (ui/economy.js: the business here)
}
async function fetchOcc(force) {
  const b = S.selB; if (b < 0 || document.hidden) return;
  const now = performance.now();
  if (!force && now - occT < 4000) return;
  occT = now;
  try { const j = await getJSON('/api/building?b=' + b); if (S.selB === b) { occ = j.occupancy; occFor = b; updateOcc(); } } catch { /* gone / offline */ }
}
function updateOcc() {
  if (!E.bd || !occ || occFor !== E.bd.b) return;
  const B = bld(E.bd.b); if (!B) return;
  set(E.bd.occ, B.type === 'park' ? `${occ.total} visitor${occ.total === 1 ? '' : 's'} right now` : `${occ.total} ${occ.total === 1 ? 'person' : 'people'} inside now`);
  set(E.bd.occ2, B.type === 'park' ? 'Open all day' : [occ.residents ? `${occ.residents} residents` : '', occ.workers ? `${occ.workers} work here` : ''].filter(Boolean).join(' · ') || 'Nobody lives or works here yet');
  E.bd.occ.closest('.act')?.setAttribute('title', `${E.bd.occ.textContent} · ${E.bd.occ2.textContent}`);   // (the widget may cut them short)
  if (E.bd.floors) [...E.bd.floors.children].forEach(btn => { const n = (occ.floors && occ.floors[btn.dataset.f]) || 0; set(btn.querySelector('small'), n ? String(n) : ''); btn.title = `Floor ${+btn.dataset.f + 1}: ${n} ${n === 1 ? 'person' : 'people'}${btn.dataset.fm === 'custom' ? ' · changed by hand' : btn.dataset.fm === 'empty' ? ' · empty' : ''}`; });
}
function markFloors() {
  if (!E.bd || !E.bd.floors) return;
  [...E.bd.floors.children].forEach(btn => { btn.classList.toggle('on', S.focus.b === E.bd.b && +btn.dataset.f === S.focus.f); btn.classList.toggle('pick', S.focus.b !== E.bd.b && S.selB === E.bd.b && +btn.dataset.f === S.selF); });
  floorInView();
}
/** The list shows three rows: the floor looked at or picked is scrolled into them (the page itself never moves) — again
 *  whenever the list changes size (the business column coming in a moment later narrows it). */
function floorInView() {
  const fl = E.bd?.floors, at = fl?.querySelector('.btn.on, .btn.pick');
  if (!at || fl.scrollHeight <= fl.clientHeight) return;
  const d = at.getBoundingClientRect().top - fl.getBoundingClientRect().top;
  if (d < 0 || d + at.offsetHeight > fl.clientHeight) fl.scrollTop += d - (fl.clientHeight - at.offsetHeight) / 2;
}
function onSelect(i, opts = {}) {
  info = null; infoFor = -1;
  if (i >= 0) { app.blds.setSel(-1); showAgent(i); if (opts.fly || opts.follow) startFollow(); }
  else { stopFollow(); if (S.selB < 0) hideInsp(); }
  tickRoster();
}
function onSelectB(b) {
  app.blds.setSel(b);
  app.blds.setFloor(b, S.selF);
  occ = null; occFor = -1;
  if (b >= 0) showBuilding(b); else if (S.sel < 0) hideInsp();
}

// ------------------------------------------------------------------ floors / focus
function buildFloorWidget(root) {
  // The floor control sits on the building being looked into (DECISIONS C113): on its corner furthest right on screen,
  // at the level of the floor shown, moving with it. placeFloorw() places it after every frame.
  const el = E.floorw = root.appendChild(h(`<div id="floorw" class="panel hidden" role="group" aria-label="Floor">
    <button type="button" class="btn icon up" title="Up a floor (PageUp or ])" aria-label="Up a floor">▲</button>
    <div class="fl"><b>1</b><small>/1</small></div>
    <button type="button" class="btn icon dn" title="Down a floor (PageDown or [)" aria-label="Down a floor">▼</button>
    <i class="sep2"></i>
    <button type="button" class="btn walls" title="Walls (V)"></button>
    <button type="button" class="btn exit" title="Leave the building (Esc)">Leave</button></div>`));
  E.fl = el.querySelector('.fl b'); E.flt = el.querySelector('.fl small'); E.fnm = el.querySelector('.fl');
  E.fup = el.querySelector('.up'); E.fdn = el.querySelector('.dn'); E.walls = el.querySelector('.walls');
  E.fup.onclick = () => changeFloor(1); E.fdn.onclick = () => changeFloor(-1);
  E.walls.onclick = cycleWalls;
  el.querySelector('.exit').onclick = exitFocus;
  E.fv = new app.THREE.Vector3(); E.fpos = { x: -1, y: -1 };
}
function onFocus() {
  const { b, f } = S.focus, B = b >= 0 ? bld(b) : null;
  if (B) { S.selF = null; S.selPt = null; app.blds.setFloor(-1, null); }   // inside now: the picked floor's glow has done its job
  E.floorw.classList.toggle('hidden', !B);
  if (B) {
    set(E.fl, String(f + 1)); set(E.flt, `/${B.floors}`);
    E.fnm.title = `${B.name} · floor ${f + 1} of ${B.floors}`;
    E.floorw.setAttribute('aria-label', `${B.name}, floor ${f + 1} of ${B.floors}`);
    E.fup.disabled = f >= B.floors - 1; E.fdn.disabled = f <= 0;
  }
  const wl = WALL_LABEL[S.walls] || 'Cutaway';
  set(E.walls, wl);
  E.walls.title = `Walls: ${wl} — click to change (V)`;
  if (B) { measureFloorw(); placeFloorw(); }
  markFloors();
}
/** The control's size and the top bar's height, read when the control shows or the window resizes — never per frame,
 *  so placing it forces no layout. */
function measureFloorw() {
  const el = E.floorw;
  E.fsize = { w: el.offsetWidth || 62, h: el.offsetHeight || 210 };
  E.topH = E.topbar ? E.topbar.offsetHeight : 56;
}
/** Places the floor control on the building's corner furthest right on screen, at the middle of the floor shown, kept
 *  inside the part of the world the top bar and the docks leave visible (C113). Runs after every frame while inside. */
function placeFloorw() {
  const el = E.floorw;
  if (!el || el.classList.contains('hidden') || S.mode === 'play') return;
  const { b, f } = S.focus, B = bld(b);
  if (!B) return;
  const camera = app.stage.camera, W = innerWidth, H = innerHeight, y = floorAt(B, f) + FLOOR_H * 0.5;
  let bx = -Infinity, by = 0;
  for (const [sx, sz] of CORNERS) {
    const p = toWorld(B, sx * B.w / 2, sz * B.d / 2, _fw);
    E.fv.set(p.x, y, p.z).project(camera);
    if (E.fv.z > 1) continue;
    const px = (E.fv.x + 1) * 0.5 * W;
    if (px > bx) { bx = px; by = (1 - E.fv.y) * 0.5 * H; }
  }
  if (bx === -Infinity) return;
  // (below the selection widget across the top, when it is there: E.selB, selRoom)
  const fs = E.fsize || { w: 62, h: 210 }, w = fs.w, hh = fs.h, top = Math.max((E.topH || 56) + 8, E.selB || 0), ins = docks.inset;
  const yy = Math.round(clamp(by - hh / 2, top, Math.max(top, H - hh - 8)));
  const minX = ins.l + (ins.tl || 0) + 8;               // clear of a closed dock's edge button
  let maxX = Math.max(minX, W - ins.r - (ins.tr || 0) - w - 8);
  // When the right dock is closed its edge button and the Home/Player/Chat column sit at the right; the control keeps
  // left of them (found in the phone audit, 2026-09-28).
  if (!ins.r && yy + hh > H - 240) maxX = Math.max(minX, Math.min(maxX, W - (ins.tr || 0) - 10 - 48 - 8 - w));
  const x = Math.round(clamp(bx - 8, minX, maxX));
  if (x !== E.fpos.x || yy !== E.fpos.y) { E.fpos.x = x; E.fpos.y = yy; el.style.transform = `translate3d(${x}px, ${yy}px, 0)`; }
}
export function flyToFloor(B, f) {
  // Frame the building for the width the docks leave visible (DECISIONS C114).
  const vis = Math.max(320, innerWidth - docks.inset.l - docks.inset.r), k = Math.min(1.6, innerWidth / vis);
  cam.flyTo(B.x, floorAt(B, f), B.z, clamp(Math.max(B.w, B.d) * 1.3 * k, 16, 120), null, Math.max(cam.goalPitch, 0.82));
}
export function lookInside(b, f = null) {
  const B = bld(b); if (!B) return;
  stopFollow();
  if (B.type === 'park') { cam.flyTo(B.x, floorAt(B, 0), B.z, clamp(Math.max(B.w, B.d) * 1.25, 30, 120)); return; }
  if (f === null || !Number.isFinite(f)) f = S.focus.b === b ? S.focus.f : 0;
  f = clamp(f, 0, B.floors - 1);
  S.focusByFollow = false;
  setFocus(b, f);
  flyToFloor(B, f);
}
export function changeFloor(d) {
  const { b, f } = S.focus, B = bld(b); if (!B) return;
  const nf = clamp(f + d, 0, B.floors - 1); if (nf === f) return;
  stopFollow(); S.focusByFollow = false;
  setFocus(b, nf);
  cam.goal.y = floorAt(B, nf);
}
export function exitFocus() {
  if (S.focus.b < 0) return;
  stopFollow(); S.focusByFollow = false;
  setFocus(-1);
  cam.goal.y = 0; cam.goalDist = Math.max(cam.goalDist, 55);
}
function cycleWalls() {
  setPref('walls', S.walls === 'cut' ? 'up' : S.walls === 'up' ? 'down' : 'cut');
  app.applyFocus(); onFocus();
  toast(`Walls: ${WALL_LABEL[S.walls]}`);
}

// ------------------------------------------------------------------ follow camera
export function startFollow() {
  if (S.sel < 0 || S.mode === 'play') return;
  S.follow = true;
  cam.follow = () => { const i = S.sel; if (i < 0 || !agents.seen[i]) return null; return { x: agents.rx[i], y: agents.ry[i], z: agents.rz[i] }; };
  cam.goalDist = Math.min(cam.goalDist, 34);
  if (E.ag) updateAgentLocal();
}
export function stopFollow() {
  if (!S.follow) return;
  S.follow = false;
  if (S.mode !== 'play') cam.follow = null;
  if (E.ag) updateAgentLocal();
}
function followTick() {
  if (!S.follow || S.sel < 0 || S.mode === 'play') return;
  const c = agents.ctx[S.sel];
  if (c >= 0) {
    const b = c >> 6, f = c & 63;
    if (!agents.parkB[b] && (S.focus.b !== b || S.focus.f !== f)) { S.focusByFollow = true; setFocus(b, f); }
  } else if (c === -1 && S.focus.b >= 0 && S.focusByFollow) { S.focusByFollow = false; setFocus(-1); }
}

// ------------------------------------------------------------------ toolbar / modes / help

/** Back to the city: the ⌂ button and Home (C113): this account's home view, else the city's default, else the whole city
 *  (ui/home.js). */
function goHome() {
  if (S.mode === 'play') return;
  stopFollow(); exitFocus();
  if (app.home) app.home.go(true); else if (app.hq) cam.flyTo(app.hq.x, 0, app.hq.z + 8, 190);
}

/** Z: zooms to fit the selected resident or building, the building being looked into, or else the whole city. */
function zoomFit() {
  if (S.mode === 'play') return;
  if (S.sel >= 0 && agents.seen[S.sel]) { cam.flyTo(agents.rx[S.sel], agents.ry[S.sel], agents.rz[S.sel], 14); return; }
  const b = S.selB >= 0 ? S.selB : S.focus.b, B = b >= 0 ? bld(b) : null;
  if (B) {
    if (S.focus.b === b) { flyToFloor(B, S.focus.f); return; }
    cam.flyTo(B.x, 0, B.z, clamp(Math.max(B.w, B.d) * 2 + B.floors * 2.6, 40, 260)); return;
  }
  stopFollow();
  const g = viewGrid(S.world);   // (the city, or without one its island's plain)
  cam.flyTo((g.minX + g.maxX) / 2, 0, (g.minZ + g.maxZ) / 2, clamp(Math.max(g.maxX - g.minX, g.maxZ - g.minZ) * 1.05, 250, cam.maxDist));
}

/** The floating buttons in the bottom-right corner (2026-10-06, top to bottom): Chat on its own (it arrives with the agent
 *  work), then one panel with Play, the map, the data map and Home (back to the city; the wheel and touch gestures zoom, so
 *  no zoom buttons). The map and data map buttons come from ui/worldmap.js and ui/property.js into .fb-main; their order is
 *  set in app.css, so it doesn't depend on which module loads first. */
function buildFloats(root) {
  const el = root.appendChild(h(`<div id="floatbtns">
    <div class="fb-chat panel"><button type="button" class="btn chat soon" disabled title="Chats with your agents" aria-label="Chat">💬</button></div>
    <div class="fb-main panel">
      <button type="button" class="btn player" title="Play as yourself (4)" aria-label="Play">🎮</button>
      <button type="button" class="btn icon zfit" title="Your home view (Home)" aria-label="Your home view">⌂</button></div></div>`));
  E.playBtn = el.querySelector('.player');
  E.playBtn.onclick = () => setMode(S.mode === 'play' ? 'explore' : 'play');
  el.querySelector('.zfit').onclick = goHome;
}
function updateToolbar() {
  if (E.modes) E.modes.forEach(b => b.classList.toggle('on', b.dataset.m === S.mode));
  if (E.playBtn) E.playBtn.classList.toggle('on', S.mode === 'play');
}
export function setMode(m) {
  if (!MODES.some(x => x[0] === m)) m = 'explore';
  if ((m === 'furnish' || m === 'build') && !canEdit()) {
    toast(auth.account ? 'Your role cannot build or furnish' : 'Sign in to build on your own land', 'bad');
    return;
  }
  const prev = S.mode; if (m === prev) return;
  if (prev === 'play' && m !== 'play' && app.driving?.pending) { toast('Waiting for the vehicle action to be confirmed', 'bad'); return; }
  if (prev === 'play' && m !== 'play' && app.driving?.id) {
    app.driving.exit().then(() => setMode(m)).catch(e => toast(e.message || 'Stop and exit the vehicle first', 'bad'));
    return;
  }
  S.mode = m; updateToolbar();
  E.tip.classList.add('hidden');
  bus.emit('mode', m, prev);
}
function toggleLabels() { setPref('labels', !S.labels); toast(S.labels ? 'Name tags on' : 'Name tags off'); }

function buildHelp(root) {
  const K = s => s.split(' ').map(k => `<kbd>${k}</kbd>`).join(' ');
  const rows = [
    ['Move the camera', `Left-drag · ${K('W A S D')} · arrows`], ['Rotate / tilt', `Right-drag (or Ctrl + drag) · ${K('Q E')}`], ['Zoom', `Mouse wheel · ${K('+ -')} · pinch on a touch screen`],
    ['Back to the city · zoom to fit', `${K('Home')} or ⌂ · ${K('Z')} fits the selection (or the whole city)`],
    ['Select a person or building', 'Click'], ['Follow a person', `Double-click them · ${K('F')}`], ['Look inside a building', 'Double-click it · “Look inside”'],
    ['Change floor', `The control on the building · ${K('PageUp PageDown')} · ${K('[ ]')}`], ['Walls: cutaway / full / low', `${K('V')} · the control on the building`], ['Leave the building / deselect', `${K('Esc')} · Leave on the building`],
    ['Docks', `${K('B')} the edit dock (left) · ${K('I')} the info dock (right)`],
    ['Time (admins)', `${K('Space')} or the pause button · ▶ cycles 1×, 4×, 16×, 60×`],
    ['Undo · redo your own changes', `${K('Ctrl+Z')} · ${K('Ctrl+Y')} or ${K('Ctrl+Shift+Z')} · ↶ ↷ in the top bar (the edit drawer on a phone)`],
    ['Activity log', 'Who changed what, residents arriving, agents at work; click a line to go there; admins revert any change'],
    ['Map · GPS', `${K('M')} the map: search, legend, double-click for a waypoint, the route on the radar and the ground`], ['Data map', `${K('O')} the city's data over the world: lots and owners, status, values, zoning`],
    ['Name tags · search', `${K('L')} · ${K('/')}`], ['Talk to the selected person · the headquarters', `${K('T')} · ${K('G')}`],
    ['Modes', `${K('1')} Explore · ${K('2')} Furniture · ${K('3')} Buildings · ${K('4')} Play`],
    ['Editing', `Pick a tool in the edit dock, then click in the world · ${K('R')} rotate · drag to move · ${K('Del')} remove`],
    ['Play', `The mouse looks around (${K('Esc')} frees the cursor, a click on the world takes it back) · ${K('W A S D')} walk · ${K('Shift')} run · ${K('E')} talk / sit / elevator / drive · ${K('Space')} jump · ${K('Z X C')} wave, dance, clap · keep scrolling in for first person (out again to step back) · ${K('Esc')} again leaves`],
    ['Chat with players near you', `Walk up to them and press ${K('E')} (or ${K('Enter')}) · ${K('Enter')} sends · what they say shows above the stick on a phone; tap it to answer`],
    ['Swimming', `${K('W A S D')} swim · ${K('Shift')} faster · ${K('Space')} dives and comes up (⤓ on a touch screen)`],
    ['Play on a touch screen', 'The stick walks (pushed all the way it runs) · a finger anywhere on the world looks around · E interacts or talks · ⤒ jumps · tap the radar for the map'],
    ['Driving', `${K('W S')} throttle / brake / reverse · ${K('A D')} steer · ${K('Shift')} boost (from a stop: a burnout) · ${K('Space')} handbrake · ${K('E')} exit when stopped`],
    ['Touch', 'One finger pans · pinch to zoom · two fingers twist to turn and move up or down to tilt · tap to select · double-tap to follow or look inside'],
    ['Drawers (phones and tablets)', 'The edge buttons open the edit and info drawers; a tap on the world beside an open drawer closes it'],
    ['Settings', 'Theme, agents\' emoji, quality, name tags, your account and the admin tabs behind ⚙️ in the top bar'],
  ];
  E.help = root.appendChild(h(`<div id="help" class="panel hidden"><h3>Controls <button class="btn small icon" title="Close">✕</button></h3><table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
    <div class="hint">Everyone in the city has a home, a job and a daily routine. AI agents work at the headquarters; a green dot means an agent is working for real right now.</div></div>`));
  E.help.querySelector('button').onclick = toggleHelp;
}
function toggleHelp() { E.help.classList.toggle('hidden'); }

// ------------------------------------------------------------------ minimap
// Two views: the city's streets and buildings, and on an island world (WP4.2) the whole island — terrain, water, roads
// and the city — shown while the view (or the player) is out of the city.
function buildMinimap(root) {
  initIslandPicture(app);   // start building (or fetch the kept) island picture right away
  const g = viewGrid(S.world), pad = 6, W = 236, s = (W - 2 * pad) / (g.maxX - g.minX), H = Math.round((g.maxZ - g.minZ) * s + 2 * pad);
  const el = root.appendChild(h('<div id="minimap" class="panel" title="Click to go there"><canvas></canvas></div>'));
  const cv = el.querySelector('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const stat = document.createElement('canvas'); stat.width = Math.round(W * dpr); stat.height = Math.round(H * dpr);
  const city = { s, W, H, stat, X: x => pad + (x - g.minX) * s, Z: z => pad + (z - g.minZ) * s, x: X => g.minX + (X - pad) / s, z: Z => g.minZ + (Z - pad) / s, ready: true };
  E.mini = { cv, ctx: cv.getContext('2d'), pad, W, dpr, city, isl: null, view: null };
  cv.addEventListener('click', e => {
    const v = E.mini.v, r = cv.getBoundingClientRect(), x = v.x(e.clientX - r.left), z = v.z(e.clientY - r.top);
    if (S.mode === 'play') return;
    stopFollow();
    cam.flyTo(x, S.focus.b >= 0 ? cam.goal.y : 0, z);
  });
  setMiniView(S.grid.empty && app.terrain ? 'island' : 'city');   // (no city: the island view only)
  drawMiniStatic();
}
function setMiniView(name) {
  const m = E.mini, v = name === 'island' ? islandView() : m.city;
  if (!v) return;
  m.view = name; m.v = v;
  m.cv.width = Math.round(v.W * m.dpr); m.cv.height = Math.round(v.H * m.dpr); m.cv.style.width = v.W + 'px'; m.cv.style.height = v.H + 'px';
  m.cv.parentElement.title = name === 'island' ? 'The island · click to go there' : 'Click to go there';
}
/** Which view fits where the view (or the player) is: the island beyond the city's edge, with some hysteresis. */
function miniViewFor() {
  const m = E.mini, g = S.grid;
  if (!app.terrain) return 'city';
  if (g.empty) return 'island';
  const p = app.player && app.player.active ? app.player : cam.target, x = p.x, z = p.z;
  const out = Math.max(g.minX - x, x - g.maxX, g.minZ - z, z - g.maxZ);
  return out > 120 ? 'island' : out < 40 ? 'city' : m.view;
}
function islandView() {
  const m = E.mini, T = app.terrain;
  if (!T) return null;
  if (m.isl && m.isl.terrain === S.world.terrain) return m.isl;   // a new object whenever the land changes
  const b = T.landBounds(), pad = m.pad, W = m.W, s = (W - 2 * pad) / (b.x1 - b.x0), H = W;
  const stat = document.createElement('canvas'); stat.width = Math.round(W * m.dpr); stat.height = Math.round(H * m.dpr);
  const v = m.isl = { b, s, W, H, stat, terrain: S.world.terrain, img: null, ready: false,
    X: x => pad + (x - b.x0) * s, Z: z => pad + (z - b.z0) * s, x: X => b.x0 + (X - pad) / s, z: Z => b.z0 + (Z - pad) / s };
  // the island's picture is built once and kept (render/island-picture.js, shared with the world map): shown as soon as
  // there is one, repainted as it sharpens
  const show = () => { const p = islandPicture(); if (p && m.isl === v && p.canvas !== v.img) { v.img = p.canvas; paintIsland(v); } };
  v.off?.(); v.off = onIslandPicture(show); show();
  return v;
}
/** The island view's picture: terrain (built once in the terrain worker), then the roads and the city over it. */
async function paintIsland(v) {
  const m = E.mini, c = v.stat.getContext('2d'), pad = m.pad, g = S.grid;
  let lines = [];
  if (S.world.roads?.length) {
    const { RoadNetwork, samplePolyline } = await import('/shared/roads.js');
    try { const net = RoadNetwork.fromJSON(S.world.roads); lines = net.all().map(rd => samplePolyline(net.geometry(rd.id), 0, { maxErr: 2, maxChord: 60 })); } catch { lines = []; }
  }
  c.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
  c.fillStyle = '#0f2a38'; c.fillRect(0, 0, v.W, v.H);
  c.drawImage(v.img, pad, pad, v.W - 2 * pad, v.H - 2 * pad);
  // rivers (WP4.18), under the roads
  const rivers = app.terrain?.ground?.island?.rivers || [];
  c.strokeStyle = '#3f86b8'; c.lineJoin = 'round'; c.lineCap = 'round';
  for (const R of rivers) { c.lineWidth = 1.1; c.beginPath(); R.pts.forEach((q, k) => (k ? c.lineTo(v.X(q.x), v.Z(q.z)) : c.moveTo(v.X(q.x), v.Z(q.z)))); c.stroke(); }
  c.strokeStyle = '#f1ead2'; c.lineWidth = 1.4; c.lineJoin = 'round';
  for (const pts of lines) { c.beginPath(); pts.forEach((q, k) => (k ? c.lineTo(v.X(q.x), v.Z(q.z)) : c.moveTo(v.X(q.x), v.Z(q.z)))); c.stroke(); }
  drawAirports(c, S.world, v.X, v.Z, v.s, { detail: false });   // (their paving: ui/airport-map.js)
  if (!g.empty) { c.fillStyle = '#4a4a4a'; c.fillRect(v.X(g.minX), v.Z(g.minZ), (g.maxX - g.minX) * v.s, (g.maxZ - g.minZ) * v.s); }
  c.fillStyle = '#9a9a9a';
  for (const B of S.world.buildings) { if (!B || B.gone || B.type === 'park' || isTerminal(B)) continue; const fp = footprint(B); c.fillRect(v.X(fp.x0), v.Z(fp.z0), Math.max(0.6, (fp.x1 - fp.x0) * v.s), Math.max(0.6, (fp.z1 - fp.z0) * v.s)); }
  v.ready = true;
}
function drawMiniStatic() {
  const m = E.mini, v = m.city, c = v.stat.getContext('2d'), g = S.grid;
  c.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
  c.fillStyle = '#1c1c1c'; c.fillRect(0, 0, v.W, v.H);
  c.fillStyle = '#3b3b3b';
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) { const r = blockRect(g, i, j); c.fillRect(v.X(r.x0), v.Z(r.z0), (r.x1 - r.x0) * v.s, (r.z1 - r.z0) * v.s); }
  for (const B of S.world.buildings) {
    if (!B || B.gone || isTerminal(B)) continue;
    const fp = footprint(B);
    c.fillStyle = MINI_COL[B.type] || '#888';
    c.fillRect(v.X(fp.x0), v.Z(fp.z0), Math.max(1, (fp.x1 - fp.x0) * v.s), Math.max(1, (fp.z1 - fp.z0) * v.s));
  }
  c.fillStyle = '#ff4d4d';
  for (const st of S.world.stations) { c.beginPath(); c.arc(v.X(st.x), v.Z(st.z), 2.2, 0, 7); c.fill(); }
}
function drawMini() {
  const m = E.mini; if (!m) return;
  const want = miniViewFor(); if (want !== m.view) setMiniView(want);
  const v = m.v, c = m.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (v.ready) c.drawImage(v.stat, 0, 0); else { c.fillStyle = '#0f2a38'; c.fillRect(0, 0, m.cv.width, m.cv.height); }
  c.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
  if (m.view === 'city') {
    c.fillStyle = '#ffcc4d';
    for (const i of vipIdx) { if (!agents.seen[i] || agents.ctx[i] === -2) continue; c.beginPath(); c.arc(v.X(agents.rx[i]), v.Z(agents.rz[i]), 1.9, 0, 7); c.fill(); }
  }
  const dot = (x, z, col, ring = '#fff') => { c.fillStyle = col; c.strokeStyle = ring; c.lineWidth = 1.2; c.beginPath(); c.arc(v.X(x), v.Z(z), 3.2, 0, 7); c.fill(); c.stroke(); };
  if (S.sel >= 0 && agents.seen[S.sel]) dot(agents.rx[S.sel], agents.rz[S.sel], '#f2f2f2', '#111');
  if (app.player && app.player.active) dot(app.player.x, app.player.z, '#5ee08f');
  const tx = v.X(cam.target.x), tz = v.Z(cam.target.z), R = Math.max(5, cam.dist * 0.5 * v.s), a = Math.atan2(-Math.cos(cam.yaw), -Math.sin(cam.yaw));
  c.fillStyle = 'rgba(255,255,255,.14)'; c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.1;
  c.beginPath(); c.moveTo(tx, tz); c.arc(tx, tz, Math.min(R * 1.6, v.W * 0.45), a - 0.55, a + 0.55); c.closePath(); c.fill(); c.stroke();
}

// ------------------------------------------------------------------ picking + input
function setHover(i, b) {
  if (S.hover !== i) S.hover = i;
  if (S.hoverB !== b) { S.hoverB = b; app.blds.setHover(b); }
  canvas.style.cursor = i >= 0 || b >= 0 ? 'pointer' : '';
  if (b >= 0 && i < 0) {
    const B = bld(b);
    if (B) {
      const fl = hoverF !== null && B.floors > 1 ? `<div class="sub">Floor ${hoverF + 1} — ${S.selB === b && S.selF === hoverF ? 'click to go in' : 'click to pick it, double-click to go in'}</div>` : '';
      const html = `<b>${esc(B.name)}</b><div class="sub">${esc(TYPE_NAME[B.type] || B.type)}${B.floors > 1 ? ` · ${B.floors} floors` : ''}</div>${fl}`;
      if (E.tip._h !== html) { E.tip.innerHTML = html; E.tip._h = html; }
      E.tip.classList.remove('hidden');
      E.tip.style.transform = `translate(${ptr.x + 14}px, ${ptr.y + 16}px)`;
      return;
    }
  }
  E.tip.classList.add('hidden');
}
/** A small tag where the picked floor was touched: its number, and a tap on it (or the floor again) goes in. */
function floorTag() {
  const B = S.selB >= 0 && S.selF !== null && S.focus.b !== S.selB && S.mode !== 'play' ? bld(S.selB) : null;
  if (!B || !S.selPt || B.floors < 2) { E.ftag.classList.add('hidden'); return; }
  const v = _tv.set(S.selPt.x, floorAt(B, S.selF) + 1.7, S.selPt.z).project(cam.cam);
  if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) { E.ftag.classList.add('hidden'); return; }
  const t = `Floor ${S.selF + 1} of ${B.floors} · ${matchMedia('(pointer: coarse)').matches ? 'tap' : 'click'} again to go in`;
  if (E.ftag._t !== t) { E.ftag.textContent = t; E.ftag._t = t; }
  E.ftag.classList.remove('hidden');
  E.ftag.style.transform = `translate(${Math.round((v.x + 1) / 2 * innerWidth)}px, ${Math.round((1 - v.y) / 2 * innerHeight)}px) translate(-50%, -130%)`;
}
function hoverTick(now) {
  if (cam.drag && cam.drag.kind === null && (S.hover >= 0 || S.hoverB >= 0)) setHover(-1, -1);   // a tool holds the pointer (moving or resizing a piece): no building's tip
  if (!ptr.in || cam.drag || S.mode === 'play') return;
  if (!ptr.moved && now - ptr.t < 160) return;
  ptr.moved = false; ptr.t = now;
  for (const fn of app.hooks.hover) if (fn(ptr)) { setHover(-1, -1); return; }
  const i = visiblePick(ptr.x, ptr.y);
  let b = -1, f = null;
  if (i < 0) { const hit = app.blds.pick(cam.rayAt(ptr.x, ptr.y), S.focus.b, app.inter.cutY); b = hit ? hit.b : parkAt(ptr.x, ptr.y); if (hit && bld(b)?.type !== 'park' && S.focus.b !== b) f = app.blds.floorOf(bld(b), hit.point.y); }
  hoverF = f; app.blds.setFloor(b, f, true);
  setHover(i, b);
}
/** The person under the pointer, unless a building stands in front of them (the person picker draws no depth: a click on
 *  a tower's wall picked someone walking on the street behind it). People inside the building being looked into count. */
function visiblePick(x, y) {
  const i = agents.pick(x, y);
  if (i < 0) return i;
  const hit = app.blds.pick(cam.rayAt(x, y), S.focus.b, app.inter.cutY);
  return hit && hit.b !== S.focus.b && hit.d < agents.camDist(i) - 1 ? -1 : i;
}
function onClick(e) {
  // Play mode with the mouse captured (it turns the camera): clicks are not aimed at anything; the click that captured it neither
  if (cam.locked || cam.swallowClick) { cam.swallowClick = false; return; }
  for (const fn of app.hooks.click) if (fn(e)) return;
  if (S.mode === 'play') return;
  const now = performance.now(), i = visiblePick(e.clientX, e.clientY);
  if (i >= 0) {
    const dbl = lastClick.key === 'a' + i && now - lastClick.t < 400;
    lastClick = { t: now, key: 'a' + i };
    select(i);
    if (dbl) startFollow();
    return;
  }
  const hit = app.blds.pick(cam.rayAt(e.clientX, e.clientY), S.focus.b, app.inter.cutY);
  const b = hit ? hit.b : parkAt(e.clientX, e.clientY);
  if (b >= 0) {
    const B = bld(b), f = hit && B && B.type !== 'park' ? app.blds.floorOf(B, hit.point.y) : null;
    const dbl = lastClick.key === 'b' + b && now - lastClick.t < 400;
    lastClick = { t: now, key: 'b' + b };
    // A floor picked from outside (2026-10-04: "select any floor from the outside if I select/touch it"): the touch
    // lights that floor; touching the lit floor again (or a double-click) goes inside it; looking inside already, a
    // touch on another floor of the same building goes straight there.
    if (S.focus.b === b) { if (f !== null && f !== S.focus.f && hit.point.y < app.inter.cutY - 0.3) lookInside(b, f); else selectBuilding(b); return; }
    if (f !== null && S.selB === b && S.selF === f) { lookInside(b, f); return; }
    selectBuilding(b, f, hit ? hit.point.clone() : null);
    if (dbl) lookInside(b, f ?? undefined);
    return;
  }
  lastClick = { t: now, key: '' };
  select(-1); selectBuilding(-1);
}
function bindPicking() {
  canvas.addEventListener('pointermove', e => {
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.in = true; ptr.moved = true;
    if (!E.tip.classList.contains('hidden')) E.tip.style.transform = `translate(${ptr.x + 14}px, ${ptr.y + 16}px)`;
  });
  canvas.addEventListener('pointerleave', () => { ptr.in = false; setHover(-1, -1); });
  canvas.addEventListener('pointerup', e => { if (e.button === 0 && cam.wasClick()) onClick(e); });
}
function escape() {
  if (!E.help.classList.contains('hidden')) return toggleHelp();
  if (S.follow) return stopFollow();
  if (S.focus.b >= 0) return exitFocus();
  if (S.sel >= 0 || S.selB >= 0) { select(-1); selectBuilding(-1); return; }
  if (S.mode !== 'explore') setMode('explore');
}
function bindKeys() {
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    for (const fn of app.hooks.key) if (fn(e)) { e.preventDefault(); return; }
    switch (e.key) {
      case 'Escape': escape(); break;
      case 'f': case 'F': if (S.sel >= 0) (S.follow ? stopFollow() : startFollow()); break;
      case 'l': case 'L': toggleLabels(); break;
      case 'h': case 'H': case '?': toggleHelp(); break;
      case '/': e.preventDefault(); E.search.focus(); break;
      case 'PageUp': case ']': e.preventDefault(); changeFloor(1); break;
      case 'PageDown': case '[': e.preventDefault(); changeFloor(-1); break;
      case 'v': case 'V': if (S.focus.b >= 0) cycleWalls(); break;
      case ' ': e.preventDefault(); togglePause(); break;
      case 't': case 'T': talkSel(); break;
      case 'Home': e.preventDefault(); goHome(); break;
      case 'z': case 'Z': zoomFit(); break;
      case 'g': case 'G': if (S.mode !== 'play' && app.hq) { stopFollow(); exitFocus(); cam.flyTo(app.hq.x, 0, app.hq.z + 8, 120); } break;
      case '1': setMode('explore'); break;
      case '2': setMode('furnish'); break;
      case '3': setMode('build'); break;
      case '4': case 'p': case 'P': setMode(S.mode === 'play' ? 'explore' : 'play'); break;
      default: break;
    }
  });
}

// ------------------------------------------------------------------ periodic
function tick() {
  tickN++;
  if (app.net.clock) {
    set(E.clockT, formatClock(S.hour));
    set(E.clockD, `${WEEKDAYS[((S.day % 7) + 7) % 7]} · day ${S.day + 1}${app.net.clock.rate === 0 ? ' · paused' : ''}`);
    set(E.sun, S.hour >= 6.5 && S.hour < 19.5 ? '☀️' : '🌙');
  }
  const st = agents.stats;
  const html = `<span><b>${S.people.length.toLocaleString()}</b> people</span><span><b>${(st.out || 0).toLocaleString()}</b> outside</span><span><b>${(st.moving || 0).toLocaleString()}</b> moving</span><span><b>${Math.round(app.fps)}</b> fps</span>`;
  if (E.stats._h !== html) { E.stats.innerHTML = html; E.stats._h = html; }
  if (tickN % 2 === 0) tickRoster();
  if (S.sel >= 0) { updateAgentLocal(); fetchInfo(false); }
  if (S.selB >= 0) fetchOcc(false);
  drawMini();
}
