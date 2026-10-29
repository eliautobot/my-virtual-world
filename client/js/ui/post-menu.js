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
// A piece whose seats are each a post of their own (CATALOG seatPosts: a radio studio's broadcast desk, three hosts'
// chairs; 2026-10-27, the product owner: "a ... button for each chair so I can assign 3 ... agents"): a ⋯ over each
// seat, each its own menu, its own agent (posted at that seat: the seat's number goes with the request).
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { esc, h } from '../core/util.js';
import { getJSON, post } from '../core/net.js';
import { auth } from '../core/auth.js';
import { CATALOG, isServiceDesk } from '/shared/catalog.js';
import { itemToLocal, toWorld } from '/shared/geom.js';
import { PRESETS, hours, spanText, hoursOk, hoursBody, hoursHtml, hoursInput } from './work-hours.js';

const ICON = { ou_pass: '🍳', cafe_counter: '☕', counter_bistro: '☕', counter_nordic: '☕', counter_loft: '☕', counter_library: '☕', counter_garden: '☕', fish_counter: '🐟', checkout: '🛒', reception: '🛎️' };
const isDesk = t => !isServiceDesk(t) && (!!CATALOG[t]?.slots?.some(s => s.use === 'work') || t === 'ou_pass');   // (a kitchen's pass: its cook, 2026-10-28)
/** A piece's name inside a sentence: lower case, its acronyms kept ("the studio DJ booth"). */
const lc = n => String(n).split(' ').map(w => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(' ');
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
      for (const [pk, el] of st.pins) if (!st.items.has(Number(String(pk).split(':')[0]))) { el.remove(); st.pins.delete(pk); }
      if (st.open && !st.items.has(st.open.id)) closeMenu();
      else if (st.open) paintMenu();
    } while (st.again);
  })().finally(() => { st.busy = null; });
  return st.busy;
}
/** An agent at the piece (on post, or working its shifts there), and one of the viewer's. */
const agentAt = it => it.slots.find(s => s.holder?.agent) || null;
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
/** The ⋯'s key: the piece (id), or one of its seats (id:k). */
const pkOf = (id, k) => (k === null || k === undefined ? String(id) : `${id}:${k}`);
const isOpen = (id, k) => !!st.open && st.open.id === id && (st.open.k ?? null) === (k ?? null);
/** Seat k of piece it, as a seat of its own (k's place in the piece's seats: 1, 2, 3 …). */
const seatNo = (it, k) => it.slots.findIndex(s => s.k === k) + 1;
/** Where seat k of piece e (an interiors entry) is, in the world (as server/sim/windex.js lays the seats). */
function seatAt(e, k) {
  const B = S.world?.buildings?.[S.focus.b], wit = S.world?.levels?.[B?.lv?.[S.focus.f]]?.items?.find(x => x.id === e.id), sd = CATALOG[e.t]?.slots?.[k];
  if (!B || !wit || !sd) return null;
  const l = itemToLocal(wit, sd.x, sd.z), w = toWorld(B, l.x, l.z);
  return { x: w.x, y: e.y, z: w.z };
}
function pinOf(it, k = null) {
  const pk = pkOf(it.id, k);
  let el = st.pins.get(pk);
  if (el) return el;
  const id = it.id;
  el = h(`<button type="button" class="pp-pin" aria-haspopup="menu" title="${esc(it.name)}${k !== null ? ` · seat ${seatNo(it, k)}` : ''}: assign an agent"><span class="pp-dots" aria-hidden="true"><i></i><i></i><i></i></span></button>`);
  // A press and release on the ⋯ itself (a phone's late click after a tap on the piece lands on the ⋯ that tap brought
  // up: not a press on it), or Enter / Space on it.
  const toggle = () => { if (isOpen(id, k)) closeMenu(); else openMenu(id, k); };
  el.addEventListener('pointerdown', ev => { ev.stopPropagation(); el._down = ev.pointerId; });
  el.addEventListener('pointerup', ev => { ev.stopPropagation(); if (el._down === ev.pointerId && ev.button === 0) { el._down = null; el._at = performance.now(); toggle(); } });
  el.addEventListener('pointercancel', () => { el._down = null; });
  el.addEventListener('click', ev => { ev.stopPropagation(); if (ev.detail === 0 && performance.now() - (el._at || 0) > 600) toggle(); });
  layer.appendChild(el); st.pins.set(pk, el);
  return el;
}
function dropPins() { for (const el of st.pins.values()) el.remove(); st.pins.clear(); }
function frame() {
  const show = (S.mode === 'explore' || S.mode === 'furnish') && st.key && st.key === floorKey();
  const cam = app.stage.camera, F = app.editors?.F;
  for (const it of st.items.values()) {
    const e = show ? app.inter.findEntry(S.focus.b, S.focus.f, it.id) : null;
    const spots = it.seats ? it.slots.map(s => s.k) : [null];   // (a piece of seats: a ⋯ over each)
    for (const k of spots) {
      // (a counter, a reception desk or a seat with no agent pulses; a desk shows its ⋯ only when picked: an office has many)
      const sl = k === null ? null : it.slots.find(s => s.k === k);
      const sel = !!e && selected(it.id), empty = it.kind !== 'desk' && !(sl ? sl.holder?.agent : agentAt(it)), open = isOpen(it.id, k);
      // (one of the viewer's own agents works or is on post there: its ⋯ stays, small and still, so its hours, pay and
      // Unassign are a tap away — 2026-10-28: "how can i access the ... menu if the agent is already placed and posted?";
      // a click on the piece itself mostly found the agent standing at it)
      const mine = (sl ? [sl] : it.slots).some(s => (s.holders || []).some(x => x.agent?.mine));
      let on = !!e && (empty || sel || open || mine) && !(F?.drag?.moved && F.drag.e?.id === it.id);
      let x = 0, y = 0;
      if (on) {
        const at = k === null ? { x: e.x, y: e.y + (CATALOG[e.t]?.h || 1.1) + LIFT, z: e.z } : (() => { const p = seatAt(e, k); return p && { x: p.x, y: p.y + 1.35 + LIFT, z: p.z }; })();
        if (at) _v.set(at.x, at.y, at.z).project(cam);
        on = !!at && _v.z < 1 && _v.x > -1.05 && _v.x < 1.05 && _v.y > -1.05 && _v.y < 1.05;
        x = (_v.x + 1) * 0.5 * innerWidth; y = (1 - _v.y) * 0.5 * innerHeight;
      }
      if (!on) { const el = st.pins.get(pkOf(it.id, k)); if (el && !el.hidden) el.hidden = true; if (open) closeMenu(); continue; }
      const pin = pinOf(it, k);
      if (pin.hidden) pin.hidden = false;
      const t = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
      if (pin._t !== t) { pin.style.transform = t; pin._t = t; }
      const cls = `pp-pin${empty ? ' pp-pulse' : mine ? ' pp-mine' : ''}${sel || open ? ' on' : ''}`;   // (pp-pulse: the online edition styles a .pulse panel of its own)
      if (pin.className !== cls) pin.className = cls;
      if (open) placeMenu(x, y);
    }
  }
}

// ----------------------------------------------------------------------------------------------- its menu
function openMenu(id, k = null) {
  closeMenu();
  const it = st.items.get(id); if (!it) return;
  const d = PRESETS[it.kind === 'desk' ? 0 : 1];
  st.open = { id, k: it.seats ? k : null, view: 'main', busy: false, mode: 'shifts', hrs: { start: d[2], end: d[3], days: d[4] }, edit: null };   // (work hours by default, or on duty 24/7)
  menu = h('<div class="pp-menu panel" role="menu" style="visibility:hidden"></div>');   // (shown once placed: frame)
  menu.addEventListener('pointerdown', ev => ev.stopPropagation());
  menu.addEventListener('click', onMenuClick);
  menu.addEventListener('change', onMenuChange);
  menu.addEventListener('input', onMenuInput);
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
  const here = it.slots.find(s => s.holder?.agent?.id === a.id && (st.open?.k === null || st.open?.k === undefined || s.k === st.open.k));
  if (here) return { text: here.holder.post ? 'On duty here 24/7' : 'Works here', here: true, post: !!here.holder.post };
  if (p.po) { const B = S.world?.buildings?.[p.pb]; return { text: `On post at ${B?.name || 'another place'}` }; }
  return { text: p.jt || 'Free' };
}
/** Who covers which hours at each seat shown: a bar of the day (24/7 the whole of it), a line each. */
function coverHtml(slots) {
  const rows = slots.filter(s => (s.holders || []).length);
  if (!rows.length) return '';
  const seg = x => { if (x.all) return [[0, 24]]; const e = x.end; return e > 24 ? [[x.start, 24], [0, e - 24]] : [[x.start, e]]; };
  return `<div class="pp-cov">${rows.map(s => `<div class="pp-cbar" aria-hidden="true">${s.holders.flatMap(x => seg(x).map(([a, b]) => `<i class="${x.agent?.mine ? 'mine' : ''}" style="left:${(a / 24 * 100).toFixed(2)}%;width:${((b - a) / 24 * 100).toFixed(2)}%"></i>`)).join('')}</div>
    ${s.holders.map(x => `<div class="pp-cl"><span>${x.agent?.emoji ? esc(x.agent.emoji) + ' ' : ''}${esc(x.name)}</span><small>${esc(spanText(x))}</small></div>`).join('')}`).join('')}</div>`;
}
// what a position pays (2026-10-28, the product owner: "every post should have a Pay ... the user picks a payment amount"):
// an hour, to whoever works there; who pays it (the business there, the city for a world module, else its owner)
const vcH = c => `${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} VC/h`;
const PAYER = { business: n => `paid by ${n}`, city: () => 'paid by the city', owner: () => 'paid from your wallet' };
function payLine(slots) {
  const ps = slots.map(s => s.pay).filter(Boolean); if (!ps.length) return '';
  const lo = Math.min(...ps.map(p => p.rate)), hi = Math.max(...ps.map(p => p.rate)), p = ps[0];
  const what = hi === 0 ? 'Unpaid' : lo === hi ? vcH(lo) : `${vcH(lo)} to ${vcH(hi)}`;
  return `${what}${hi > 0 ? ` · ${esc(PAYER[p.payer](p.name))}` : ''}${ps.some(x => x.set) ? '' : hi > 0 ? ' (the usual)' : ''}`;
}
/** A week of it at rate (cents an hour) for those working the seats shown (24/7: every hour), or an 8-hour day's. */
function costText(slots, rate) {
  const hs = slots.flatMap(s => s.holders || []);
  if (!(rate > 0)) return 'Unpaid: nobody is paid for working here.';
  const week = x => (x.all ? 168 : (x.end - x.start) * [0, 1, 2, 3, 4, 5, 6].filter(k => (x.days ?? 31) & (1 << k)).length);
  if (!hs.length) return `An 8-hour day here costs ${Math.round(8 * rate / 100).toLocaleString('en-US')} VC.`;
  const total = hs.reduce((t, x) => t + week(x) * rate, 0);
  return `About ${Math.round(total / 100).toLocaleString('en-US')} VC a week for ${hs.length === 1 ? esc(hs[0].name) : `the ${hs.length} working here`} (${hs.map(x => (x.all ? '24/7' : `${week(x)} h`)).join(', ')}).`;
}
function payView(only) {
  const p = only.slots.map(s => s.pay).find(Boolean), rate = Math.round(Number(st.open.rate) * 100);
  const who = p.payer === 'business' ? `${esc(p.name)} pays it from its wallet each night.` : p.payer === 'city' ? 'The city pays it: this is a world module.' : 'There is no business here: it comes from your own wallet each night. Nothing is unpaid.';
  const chips = [['Usual', p.usual], ['+25%', Math.round(p.usual * 1.25 / 50) * 50], ['+50%', Math.round(p.usual * 1.5 / 50) * 50], ...(p.free ? [['Unpaid', 0]] : [])];
  return `<button type="button" class="pp-back" data-pp="back">‹ Back</button>
    <p class="pp-none">What ${only.slots.length > 1 ? 'each place here' : 'this place'} pays an hour, to whoever works it: your agents or anyone the city hires. ${who}</p>
    <div class="pp-pay"><label>Pay an hour <span><input class="input" type="number" inputmode="decimal" min="0" step="0.5" data-pay value="${esc(String(st.open.rate))}" aria-label="VC an hour"> VC</span></label>
      <div class="pp-chips">${chips.map(([t, c]) => `<button type="button" class="pp-pre${rate === c ? ' on' : ''}" data-pp="rate-${c}">${t}<small>${c ? vcH(c) : '0'}</small></button>`).join('')}</div>
      <small class="pp-cost">${costText(only.slots, rate)}</small>
      <small class="pp-sum">At least the minimum wage, ${vcH(p.min)}${p.free ? ', or nothing' : ''}. Agents you put here never quit, even when the money runs short: you are told instead.</small></div>
    <div class="row"><button type="button" class="btn small primary" data-pp="save-pay" ${st.open.busy ? 'disabled' : ''}>Save pay</button>${p.set ? '<button type="button" class="btn small" data-pp="usual-pay">Back to the usual</button>' : ''}</div>`;
}
function paintMenu() {
  const it = st.items.get(st.open?.id); if (!menu || !it) return;
  const sl = st.open.k !== null && st.open.k !== undefined ? it.slots.find(s => s.k === st.open.k) : null, only = sl ? { ...it, slots: [sl] } : it;   // (a seat: that seat only)
  const icon = ICON[it.t] || (it.t === 'broadcast_desk' ? '🎙️' : it.kind === 'desk' ? '💼' : '🛎️'), who = agentAt(only);
  const all = only.slots.flatMap(s => s.holders || []), mine = all.filter(x => x.agent?.mine);
  const now = who ? `${who.holder.agent?.emoji ? who.holder.agent.emoji + ' ' : ''}${esc(who.holder.name)} ${who.holder.post ? 'is on duty 24/7' : 'works here'}${all.length > 1 ? ` · ${all.length} share it` : ''}`
    : only.slots.find(s => s.holder) ? `${esc(only.slots.find(s => s.holder).holder.name)} works here` : sl ? 'This seat is free' : 'No one works here yet';
  const head = `<div class="pp-h"><span class="pp-ic" aria-hidden="true">${icon}</span><div><b>${esc(it.name)}${sl ? ` · seat ${seatNo(it, sl.k)}` : ''}</b><small>${now}</small></div><button type="button" class="pp-x" data-pp="close" aria-label="Close">✕</button></div>`;
  let body;
  if (st.open.view === 'pay') body = payView(only);
  else if (st.open.view === 'hours') {
    const x = mine.find(m => m.agent.id === st.open.edit);
    body = `<button type="button" class="pp-back" data-pp="back">‹ Back</button><p class="pp-none"><b>${esc(x?.name || 'Your agent')}</b>'s hours here</p>${hoursHtml(st.open.hrs)}
      <button type="button" class="btn small primary pp-save" data-pp="save-hours" data-agent="${st.open.edit}" ${st.open.busy ? 'disabled' : ''}>Save hours</button>`;
  } else if (st.open.view === 'agents') {
    const list = (S.agentList || []).filter(a => a.mine);
    body = list.length ? `<div class="pp-list" role="group" aria-label="Your agents">${list.map(a => {
      const w = agentWhere(a, it);
      const same = w.here && w.post && st.open.mode === 'post';   // (already on duty here: nothing to do; working shifts here, new hours)
      return `<button type="button" class="pp-ag${w.here ? ' here' : ''}" data-agent="${a.id}" ${w.off || same || st.open.busy ? 'disabled' : ''}><span class="pp-em" aria-hidden="true">${esc(a.emoji || '🤖')}</span><span><b>${esc(a.name)}</b><small>${esc(w.text)}</small></span></button>`;
    }).join('')}</div>` : '<p class="pp-none">You have no agents yet. Make one in the Agent Studio, then come back here.</p>';
    const modes = `<div class="pp-modes" role="radiogroup" aria-label="How it works here">${[['shifts', '💼 Work hours'], ['post', '🛎️ 24/7']].map(([k, t]) => `<button type="button" role="radio" aria-checked="${st.open.mode === k}" class="pp-mode${st.open.mode === k ? ' on' : ''}" data-pp="mode-${k}">${t}</button>`).join('')}</div>`;
    const note = st.open.mode === 'post' ? 'On duty here day and night: no sleep or free time; its plans wait until you let it go.' : 'It works these hours here, then lives its day: home, meals, friends, its own plans. On shift now, it is here at once.';
    body = `<button type="button" class="pp-back" data-pp="back">‹ Back</button>${modes}${st.open.mode === 'shifts' ? hoursHtml(st.open.hrs) : ''}<p class="pp-note">Then choose the agent:</p>${body}<p class="pp-note">${note}${only.slots.some(s => s.holder && !s.holder.agent) ? ' Whoever works here now looks for other work.' : ''}</p>`;
  } else {
    const pl = payLine(only.slots);
    body = `${coverHtml(only.slots)}<button type="button" class="pp-item" role="menuitem" data-pp="edit"><span aria-hidden="true">✏️</span> Edit</button>
      ${pl ? `<button type="button" class="pp-item" role="menuitem" data-pp="pay"><span aria-hidden="true">💰</span> Pay<small class="pp-paynow">${pl}</small><span class="pp-more" aria-hidden="true">›</span></button>` : ''}
      <button type="button" class="pp-item" role="menuitem" data-pp="assign"><span aria-hidden="true">🤖</span> ${who ? 'Assign another agent' : 'Assign agent'}<span class="pp-more" aria-hidden="true">›</span></button>
      ${mine.map(x => `${x.post ? '' : `<button type="button" class="pp-item" role="menuitem" data-pp="hours" data-agent="${x.agent.id}"><span aria-hidden="true">🕐</span> ${esc(x.agent.name)}'s hours</button>`}
        <button type="button" class="pp-item" role="menuitem" data-pp="${x.post ? 'leave' : 'unwork'}" data-agent="${x.agent.id}"><span aria-hidden="true">↩</span> Unassign ${esc(x.agent.name)}</button>`).join('')}`;
  }
  const html = head + body;
  if (menu._h !== html) { menu.innerHTML = html; menu._h = html; menu._w = menu.offsetWidth; menu._hh = menu.offsetHeight; }
}
/** From and to chosen in the hours chooser. */
/** An amount typed in Pay: kept, and what it costs said again (the field keeps its caret: no repaint). */
function onMenuInput(ev) {
  const t = ev.target.closest('[data-pay]'); if (!t || !st.open) return;
  st.open.rate = t.value;
  const it = st.items.get(st.open.id), sl = st.open.k !== null && st.open.k !== undefined ? it?.slots.filter(s => s.k === st.open.k) : it?.slots;
  const c = menu?.querySelector('.pp-cost'); if (c && sl) c.innerHTML = costText(sl, Math.round(Number(t.value) * 100));
  menu?.querySelectorAll('.pp-chips .pp-pre').forEach(b => b.classList.toggle('on', Number(b.dataset.pp.slice(5)) === Math.round(Number(t.value) * 100)));
}
function onMenuChange(ev) {
  const t = ev.target.closest('[data-hr]'); if (!t || !st.open) return;
  if (hoursInput(st.open.hrs, t)) paintMenu();
}
async function onMenuClick(ev) {
  const t = ev.target.closest('[data-pp], [data-agent]'); if (!t || t.disabled || !st.open) return;
  const it = st.items.get(st.open.id); if (!it) return;
  const [b, f] = st.key.split(':').map(Number), a = t.dataset.pp;
  if (a === 'close') return closeMenu();
  if (a === 'back') { st.open.view = 'main'; return paintMenu(); }
  if (a === 'assign') { st.open.view = 'agents'; return paintMenu(); }
  if (a === 'mode-shifts' || a === 'mode-post') { st.open.mode = a.slice(5); return paintMenu(); }
  if (hoursInput(st.open.hrs, t)) return paintMenu();
  if (a === 'hours') {   // (its hours here: the chooser on what it has)
    const x = it.slots.flatMap(s => s.holders || []).find(m => m.agent?.mine && m.agent.id === +t.dataset.agent);
    if (x) { st.open.view = 'hours'; st.open.edit = x.agent.id; st.open.hrs = { start: x.start, end: x.end % 24, days: x.days }; }
    return paintMenu();
  }
  if (a === 'edit') { closeMenu(); deselect(); app.editors?.editItem(b, f, it.id); return; }
  // its pay: the view, a quick amount, saved or back to the usual
  const seat = st.open.k !== null && st.open.k !== undefined ? { slot: st.open.k } : {};
  if (a === 'pay') { const p = (seat.slot !== undefined ? it.slots.filter(x => x.k === seat.slot) : it.slots).map(x => x.pay).find(Boolean); st.open.view = 'pay'; st.open.rate = p ? p.rate / 100 : 0; return paintMenu(); }
  if (a?.startsWith('rate-')) { st.open.rate = Number(a.slice(5)) / 100; return paintMenu(); }
  if (a === 'save-pay' || a === 'usual-pay') {
    const rate = a === 'usual-pay' ? null : Math.round(Number(st.open.rate) * 100);
    if (rate !== null && !(Number.isFinite(rate) && rate >= 0)) { app.toast('Choose an amount an hour', 'bad', 2600); return; }
    st.open.busy = true; paintMenu();
    try {
      const r = await post('/api/agent-posts/pay', { b, f, item: it.id, ...seat, rate });
      const p = r?.pay?.[0];
      app.toast(`💰 The ${lc(it.name)} ${p && p.rate > 0 ? `pays ${vcH(p.rate)}, ${PAYER[p.payer](p.name)}` : 'is unpaid'}`, 'good', 3200);
      st.open.busy = false; st.open.view = 'main';
      await load(); paintMenu();
    } catch (err) { app.toast(String(err.message || err), 'bad', 3400); if (st.open) { st.open.busy = false; paintMenu(); } }
    return;
  }
  const id = +t.dataset.agent, ag = (S.agentList || []).find(x => x.id === id);
  if (!ag) return;
  st.open.busy = true; paintMenu();
  try {
    if (a === 'save-hours') {
      if (!hoursOk(st.open.hrs)) throw new Error('Choose 1 to 16 hours and at least one day');
      const r = await post('/api/agent-posts/work/hours', { agent: id, ...hoursBody(st.open.hrs) });
      app.toast(`🕐 ${ag.name} works ${spanText(r.work)} now`, 'good', 3200);
    } else if (a === 'leave') {
      await post('/api/agent-posts/leave', { agent: id });
      app.toast(`${ag.name} is back to its day`, 'good', 2600);
    } else if (a === 'unwork') {
      await post('/api/agent-posts/work/auto', { agent: id });
      app.toast(`${ag.name} will find its own work`, 'good', 2600);
    } else if (st.open.mode === 'shifts') {
      if (!hoursOk(st.open.hrs)) throw new Error('Choose 1 to 16 hours and at least one day');
      const r = await post('/api/agent-posts/work', { agent: id, b, f, item: it.id, ...hoursBody(st.open.hrs), ...(st.open.k !== null && st.open.k !== undefined ? { slot: st.open.k } : {}) });
      const by = r?.replaced ? ` ${r.replaced.name} ${r.replaced.post ? 'goes back to its day' : 'looks for other work'}.` : '', w = r?.work;
      app.toast(`💼 ${ag.name} works at the ${lc(it.name)}${w ? `, ${spanText(w)}` : ''}.${by}`, 'good', 3600);
    } else {
      const r = await post('/api/agent-posts/here', { agent: id, b, f, item: it.id, ...(st.open.k !== null && st.open.k !== undefined ? { slot: st.open.k } : {}) });
      const by = r?.replaced ? (r.replaced.post ? ` ${r.replaced.name} goes back to its day.` : ` ${r.replaced.name} looks for other work.`) : '';
      app.toast(`🛎️ ${ag.name} is on post at the ${lc(it.name)}.${by}`, 'good', 3400);
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
