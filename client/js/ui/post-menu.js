// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent put on post right at the counter (2026-10-23: "i want to be able to assign an agents to their a post just by
// cliking on actual item. In this case the Cashier /counters and also Reception desks ... a three dot menu that pops up
// on to and pulses, almost like indicating somthing needs to be done ... an edit and an "Assing Agent" option ... once
// the agent is assigned the three dot menu is then not displayed/hidden and it opens up only after the object is
// selected again").
// On the floor being looked into, over each counter, checkout and reception desk on its viewer's own property (a lot
// their account holds, a flat it owns: server/agent-posts/posts.js floor; anywhere else, even for an administrator,
// nothing): a ⋯ that pulses while no agent is on post there; with one there it shows only while the piece is selected
// (a click or tap on it; in the furniture editor, its selection). Its menu: Edit (the furniture editor, the piece
// selected) and Assign agent — the viewer's own agents only; the one picked is there at once, not walking (posts.js
// here); a resident working there makes way, another agent of theirs there is switched and walks off. With an agent of
// theirs there: Unassign (it walks off to its day).
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { esc, h } from '../core/util.js';
import { getJSON, post } from '../core/net.js';
import { auth } from '../core/auth.js';
import { CATALOG, isServiceDesk } from '/shared/catalog.js';

const ICON = { cafe_counter: '☕', fish_counter: '🐟', checkout: '🛒', reception: '🛎️' };
const isDesk = t => !isServiceDesk(t) && !!CATALOG[t]?.slots?.some(s => s.use === 'work');
const hours = h => { const m = Math.round((h % 24) * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const LIFT = 0.42;            // m over the piece's top
const REFETCH_MS = 1500;      // (at most this often again for the people's changes)
const _v = new THREE.Vector3();
let app = null, layer = null, menu = null;
const st = { key: '', items: new Map(), pins: new Map(), busy: null, again: false, last: 0, later: null, sel: null, selE: null, open: null };

// ----------------------------------------------------------------------------------------------- what is on this floor
const floorKey = () => (S.focus.b >= 0 && auth.account ? `${S.focus.b}:${S.focus.f}` : '');
/** Who is at the counters and desks of the floor looked into (once at a time; asked again after if asked meanwhile). */
async function load() {
  if (st.busy) { st.again = true; return st.busy; }
  st.busy = (async () => {
    do {
      st.again = false;
      const key = floorKey();
      if (!key) { st.key = ''; st.items = new Map(); break; }
      const [b, f] = key.split(':').map(Number);
      const has = S.world?.levels?.[S.world.buildings[b]?.lv?.[f]]?.items?.some(it => isServiceDesk(it.t) || isDesk(it.t));
      let items = [];
      if (has) { try { items = (await getJSON(`/api/agent-posts/floor?b=${b}&f=${f}`)).items || []; } catch { items = []; } }
      if (floorKey() !== key) { st.again = true; continue; }
      st.key = key; st.items = new Map(items.map(it => [it.id, it])); st.last = performance.now();
      for (const [id, el] of st.pins) if (!st.items.has(id)) { el.remove(); st.pins.delete(id); }
      if (st.open && !st.items.has(st.open.id)) closeMenu();
      else if (st.open) paintMenu();
    } while (st.again);
  })().finally(() => { st.busy = null; });
  return st.busy;
}
/** An agent at the piece (on post, or working its shifts there), and one of the viewer's. */
const agentAt = it => it.slots.find(s => s.holder?.agent) || null;
const mineAt = it => it.slots.find(s => s.holder?.agent?.mine) || null;
/** The piece selected: clicked looking inside (st.sel), or the furniture editor's. */
function selected(id) {
  if (S.mode === 'furnish') { const F = app.editors?.F; return !!(F?.sel && F.sel.b === S.focus.b && F.sel.f === S.focus.f && F.sel.id === id && !F.type); }
  return !!(st.sel && st.sel.b === S.focus.b && st.sel.f === S.focus.f && st.sel.id === id);
}
function deselect() {
  if (st.selE && app.inter.sel === st.selE) app.inter.highlight(null);   // (never the furniture editor's own selection)
  st.sel = null; st.selE = null;
}

// ----------------------------------------------------------------------------------------------- the ⋯ over each piece
function pinOf(it) {
  let el = st.pins.get(it.id);
  if (el) return el;
  const id = it.id;
  el = h(`<button type="button" class="pp-pin" aria-haspopup="menu" title="${esc(it.name)}: assign an agent"><span class="pp-dots" aria-hidden="true"><i></i><i></i><i></i></span></button>`);
  // A press and release on the ⋯ itself (a phone's late click after a tap on the piece lands on the ⋯ that tap brought
  // up: not a press on it), or Enter / Space on it.
  const toggle = () => { if (st.open?.id === id) closeMenu(); else openMenu(id); };
  el.addEventListener('pointerdown', ev => { ev.stopPropagation(); el._down = ev.pointerId; });
  el.addEventListener('pointerup', ev => { ev.stopPropagation(); if (el._down === ev.pointerId && ev.button === 0) { el._down = null; el._at = performance.now(); toggle(); } });
  el.addEventListener('pointercancel', () => { el._down = null; });
  el.addEventListener('click', ev => { ev.stopPropagation(); if (ev.detail === 0 && performance.now() - (el._at || 0) > 600) toggle(); });
  layer.appendChild(el); st.pins.set(id, el);
  return el;
}
function dropPins() { for (const el of st.pins.values()) el.remove(); st.pins.clear(); }
function frame() {
  const show = (S.mode === 'explore' || S.mode === 'furnish') && st.key && st.key === floorKey();
  const cam = app.stage.camera, F = app.editors?.F;
  for (const it of st.items.values()) {
    const e = show ? app.inter.findEntry(S.focus.b, S.focus.f, it.id) : null;
    // (a counter or a reception desk with no agent pulses; a desk shows its ⋯ only when picked: an office has many)
    const sel = !!e && selected(it.id), empty = it.kind !== 'desk' && !agentAt(it), open = st.open?.id === it.id;
    let on = !!e && (empty || sel || open) && !(F?.drag?.moved && F.drag.e?.id === it.id);
    let x = 0, y = 0;
    if (on) {
      _v.set(e.x, e.y + (CATALOG[e.t]?.h || 1.1) + LIFT, e.z).project(cam);
      on = _v.z < 1 && _v.x > -1.05 && _v.x < 1.05 && _v.y > -1.05 && _v.y < 1.05;
      x = (_v.x + 1) * 0.5 * innerWidth; y = (1 - _v.y) * 0.5 * innerHeight;
    }
    if (!on) { const el = st.pins.get(it.id); if (el && !el.hidden) el.hidden = true; if (open) closeMenu(); continue; }
    const pin = pinOf(it);
    if (pin.hidden) pin.hidden = false;
    const t = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
    if (pin._t !== t) { pin.style.transform = t; pin._t = t; }
    const cls = `pp-pin${empty ? ' pp-pulse' : ''}${sel || open ? ' on' : ''}`;   // (pp-pulse: the online edition styles a .pulse panel of its own)
    if (pin.className !== cls) pin.className = cls;
    if (open) placeMenu(x, y);
  }
}

// ----------------------------------------------------------------------------------------------- its menu
function openMenu(id) {
  closeMenu();
  const it = st.items.get(id); if (!it) return;
  st.open = { id, view: 'main', busy: false, mode: it.kind === 'desk' ? 'shifts' : 'post' };   // (Works here (shifts), or On duty 24/7)
  menu = h('<div class="pp-menu panel" role="menu" style="visibility:hidden"></div>');   // (shown once placed: frame)
  menu.addEventListener('pointerdown', ev => ev.stopPropagation());
  menu.addEventListener('click', onMenuClick);
  document.body.appendChild(menu);
  paintMenu();
}
function closeMenu() { menu?.remove(); menu = null; st.open = null; }
/** The menu under the ⋯ at (px, py) (its middle on the screen), else over it; inside the window. */
function placeMenu(px, py) {
  if (!menu) return;
  const w = menu._w, hh = menu._hh, R = 16;   // (its size, measured when painted; the ⋯'s half size)
  let x = px - w / 2, y = py + R + 6;
  if (y + hh > innerHeight - 8) y = Math.max(8, py - R - 6 - hh);
  x = Math.max(8, Math.min(innerWidth - w - 8, x));
  const t = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  if (menu._t !== t) { menu.style.transform = t; menu._t = t; menu.style.visibility = ''; }
}
function agentWhere(a, it) {
  const p = a.i >= 0 ? S.people[a.i] : null;
  if (!p) return { text: 'No body in the city', off: true };
  const here = it.slots.find(s => s.holder?.agent?.id === a.id);
  if (here) return { text: here.holder.post ? 'On duty here 24/7' : 'Works here', here: true, post: !!here.holder.post };
  if (p.po) { const B = S.world?.buildings?.[p.pb]; return { text: `On post at ${B?.name || 'another place'}` }; }
  return { text: p.jt || 'Free' };
}
function paintMenu() {
  const it = st.items.get(st.open?.id); if (!menu || !it) return;
  const icon = ICON[it.t] || (it.kind === 'desk' ? '💼' : '🛎️'), who = agentAt(it), mine = mineAt(it);
  const now = who ? `${who.holder.agent?.emoji ? who.holder.agent.emoji + ' ' : ''}${esc(who.holder.name)} ${who.holder.post ? 'is on duty 24/7' : 'works here (shifts)'}`
    : it.slots.find(s => s.holder) ? `${esc(it.slots.find(s => s.holder).holder.name)} works here` : 'No one works here yet';
  const head = `<div class="pp-h"><span class="pp-ic" aria-hidden="true">${icon}</span><div><b>${esc(it.name)}</b><small>${now}</small></div><button type="button" class="pp-x" data-pp="close" aria-label="Close">✕</button></div>`;
  let body;
  if (st.open.view === 'agents') {
    const list = (S.agentList || []).filter(a => a.mine);
    body = list.length ? `<div class="pp-list" role="group" aria-label="Your agents">${list.map(a => {
      const w = agentWhere(a, it);
      const same = w.here && w.post === (st.open.mode === 'post');   // (already so: nothing to do; the other way round: it changes)
      return `<button type="button" class="pp-ag${w.here ? ' here' : ''}" data-agent="${a.id}" ${w.off || same || st.open.busy ? 'disabled' : ''}><span class="pp-em" aria-hidden="true">${esc(a.emoji || '🤖')}</span><span><b>${esc(a.name)}</b><small>${esc(w.text)}</small></span></button>`;
    }).join('')}</div>` : '<p class="pp-none">You have no agents yet. Make one in the Agent Studio, then come back here.</p>';
    const modes = `<div class="pp-modes" role="radiogroup" aria-label="How it works here">${[['shifts', '💼 Works here (shifts)'], ['post', '🛎️ On duty 24/7']].map(([k, t]) => `<button type="button" role="radio" aria-checked="${st.open.mode === k}" class="pp-mode${st.open.mode === k ? ' on' : ''}" data-pp="mode-${k}">${t}</button>`).join('')}</div>`;
    const note = st.open.mode === 'post' ? 'Your agent is put here at once, on duty day and night: no sleep or free time.' : 'Your agent works its shifts here and goes home after; on shift now, it is here at once.';
    body = `<button type="button" class="pp-back" data-pp="back">‹ Back</button>${modes}${body}<p class="pp-note">${note}${it.slots.some(s => s.holder && !s.holder.agent) ? ' Whoever works here now looks for other work.' : ''}</p>`;
  } else {
    body = `<button type="button" class="pp-item" role="menuitem" data-pp="edit"><span aria-hidden="true">✏️</span> Edit</button>
      <button type="button" class="pp-item" role="menuitem" data-pp="assign"><span aria-hidden="true">🤖</span> ${who ? 'Assign another agent' : 'Assign agent'}<span class="pp-more" aria-hidden="true">›</span></button>
      ${mine ? `<button type="button" class="pp-item" role="menuitem" data-pp="${mine.holder.post ? 'leave' : 'unwork'}" data-agent="${mine.holder.agent.id}"><span aria-hidden="true">↩</span> Unassign ${esc(mine.holder.agent.name)}</button>` : ''}`;
  }
  const html = head + body;
  if (menu._h !== html) { menu.innerHTML = html; menu._h = html; menu._w = menu.offsetWidth; menu._hh = menu.offsetHeight; }
}
async function onMenuClick(ev) {
  const t = ev.target.closest('[data-pp], [data-agent]'); if (!t || t.disabled || !st.open) return;
  const it = st.items.get(st.open.id); if (!it) return;
  const [b, f] = st.key.split(':').map(Number), a = t.dataset.pp;
  if (a === 'close') return closeMenu();
  if (a === 'back') { st.open.view = 'main'; return paintMenu(); }
  if (a === 'assign') { st.open.view = 'agents'; return paintMenu(); }
  if (a === 'mode-shifts' || a === 'mode-post') { st.open.mode = a.slice(5); return paintMenu(); }
  if (a === 'edit') { closeMenu(); deselect(); app.editors?.editItem(b, f, it.id); return; }
  const id = +t.dataset.agent, ag = (S.agentList || []).find(x => x.id === id);
  if (!ag) return;
  st.open.busy = true; paintMenu();
  try {
    if (a === 'leave') {
      await post('/api/agent-posts/leave', { agent: id });
      app.toast(`${ag.name} is back to its day`, 'good', 2600);
    } else if (a === 'unwork') {
      await post('/api/agent-posts/work/auto', { agent: id });
      app.toast(`${ag.name} will find its own work`, 'good', 2600);
    } else if (st.open.mode === 'shifts') {
      const r = await post('/api/agent-posts/work', { agent: id, b, f, item: it.id });
      const by = r?.replaced ? ` ${r.replaced.name} ${r.replaced.post ? 'goes back to its day' : 'looks for other work'}.` : '', w = r?.work;
      app.toast(`💼 ${ag.name} works at the ${it.name.toLowerCase()} now${w ? ` (${hours(w.start)}–${hours(w.end)})` : ''}.${by}`, 'good', 3600);
    } else {
      const r = await post('/api/agent-posts/here', { agent: id, b, f, item: it.id });
      const by = r?.replaced ? (r.replaced.post ? ` ${r.replaced.name} goes back to its day.` : ` ${r.replaced.name} looks for other work.`) : '';
      app.toast(`🛎️ ${ag.name} is on post at the ${it.name.toLowerCase()}.${by}`, 'good', 3400);
    }
    closeMenu(); deselect();
  } catch (err) {
    app.toast(String(err.message || err), 'bad', 3000);
    if (st.open) { st.open.busy = false; paintMenu(); }
  }
  load();
}

// ----------------------------------------------------------------------------------------------- selecting a piece
/** Looking inside (exploring): a click or tap on a counter or a desk here selects it, its ⋯ showing — unless someone
 *  stands in front of it (a click on them is theirs). Anything else clears it. */
function onClick(ev) {
  if (S.mode !== 'explore' || S.focus.b < 0 || !st.items.size) { deselect(); return false; }
  const hit = app.inter.pickItem(app.cam.rayAt(ev.clientX, ev.clientY), false);
  const it = hit && hit.e.b === S.focus.b && hit.e.f === S.focus.f ? st.items.get(hit.e.id) : null;
  if (!it) { deselect(); return false; }
  const i = app.agents.pick(ev.clientX, ev.clientY);
  if (i >= 0 && app.agents.camDist(i) < hit.d + 0.4) { deselect(); return false; }
  st.sel = { b: hit.e.b, f: hit.e.f, id: it.id }; st.selE = hit.e;
  app.inter.highlight(hit.e);
  return true;
}

export function init(a) {
  app = a;
  layer = document.body.appendChild(h('<div id="postpins" aria-label="Counters and desks"></div>'));
  app.postMenu = { load, get items() { return st.items; }, get sel() { return st.sel; }, get open() { return st.open; }, show: openMenu };
  app.hooks = app.hooks || { key: [], click: [], hover: [] };
  app.hooks.click.push(onClick);
  bus.on('frame', frame);
  bus.on('focus', () => { closeMenu(); deselect(); dropPins(); st.items = new Map(); st.key = ''; load(); });
  bus.on('mode', () => { closeMenu(); deselect(); });
  bus.on('world', ev => {
    const B = S.focus.b >= 0 ? S.world?.buildings?.[S.focus.b] : null;
    if (B && (!ev || ev.blds?.has?.(S.focus.b) || ev.levels?.has?.(B.lv[S.focus.f]))) load();
  });
  bus.on('people', () => { if (st.key && performance.now() - st.last > REFETCH_MS) load(); else if (st.key && !st.later) st.later = setTimeout(() => { st.later = null; load(); }, REFETCH_MS); });
  bus.on('auth', load);
  bus.on('agentlist', () => { if (st.open) paintMenu(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && st.open) { ev.stopPropagation(); closeMenu(); } }, true);
  document.addEventListener('pointerdown', ev => { if (st.open && !ev.target.closest('.pp-menu, .pp-pin')) closeMenu(); }, true);
  load();
}
