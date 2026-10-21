// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Actions on things in the world, where they are (2026-10-04: "a sub menu (right click or press and hold) to show
// like edit building or modify ... the simplest yet most effective UI so that both desktop and phone work"):
// - press and hold (touch) or right-click (mouse) on a building, a lot, a person or the ground opens a menu right there
//   with what can be done to it — only what this account may do, the rest explained in one line;
// - a selected building also gets a small bar of its main actions just above it in the world (⋯ opens the full menu),
//   so nobody has to know about press-and-hold or open a drawer on a phone.
// A ring fills under the finger while holding, so the gesture explains itself; a hold that moves becomes a pan.
import * as THREE from 'three';
import { S, bus, bld, select, selectBuilding } from '../core/state.js';
import { post } from '../core/net.js';
import { h, esc } from '../core/util.js';
import { GROUND_Y, FLOOR_H } from '/shared/constants.js';
import { inFootprint } from '/shared/geom.js';
import { mayOn, whyNot, lotOf, rightsOn, lotLayer } from '../core/rights.js';

const HOLD_MS = 480, SLOP = 10;
const TYPE_NAME = { office: 'Office', apartment: 'Apartments', cafe: 'Café', restaurant: 'Restaurant', shop: 'Shop', gym: 'Gym', park: 'Park', hq: 'Headquarters' };
const ft2 = sqft => `${Math.round(sqft).toLocaleString('en-US')} sq ft`;
let app, cam, canvas, hold = null, rdown = null, swallow = false, menuFor = null, demolishArm = 0;
const E = {};
const _v = new THREE.Vector3();

export function init(a) {
  app = a; cam = a.cam; canvas = a.stage.renderer.domElement;
  const root = document.getElementById('ui');
  E.menu = root.appendChild(h('<div id="wmenu" class="panel hidden" role="menu"></div>'));
  E.ring = root.appendChild(h('<div id="holdring" class="hidden" aria-hidden="true"><i></i></div>'));
  E.bar = root.appendChild(h('<div id="selbar" class="panel hidden" role="toolbar" aria-label="Building actions"></div>'));
  canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancelHold);
  // a long press doesn't also select what's under the finger when it lifts
  a.hooks.click.unshift(() => { if (swallow) { swallow = false; return true; } return false; });
  a.hooks.key.unshift(e => { if (e.key === 'Escape' && !E.menu.classList.contains('hidden')) { closeMenu(); return true; } return false; });
  document.addEventListener('pointerdown', e => { if (!E.menu.classList.contains('hidden') && !E.menu.contains(e.target)) closeMenu(); }, true);
  E.menu.addEventListener('click', onMenuClick);
  E.bar.addEventListener('click', onBarClick);
  bus.on('selectB', () => { renderBar(); });
  bus.on('select', () => renderBar());
  bus.on('mode', () => { closeMenu(); renderBar(); });
  bus.on('world', () => renderBar());
  bus.on('auth', () => renderBar());
  bus.on('frame', placeBar);
  app.worldMenu = { openAt: (x, y) => openAt(x, y), close: closeMenu };
}

// ------------------------------------------------------------------ gestures
function down(e) {
  if (S.mode === 'play' || app.place?.active()) return;
  if (e.button === 2) { rdown = { x: e.clientX, y: e.clientY, t: performance.now() }; return; }
  if (e.pointerType === 'mouse' || e.button !== 0) return;
  if (cam.pointers && cam.pointers.size > 1) { cancelHold(); return; }    // a second finger: pinch, not a hold
  cancelHold();
  hold = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  hold.show = setTimeout(() => { if (!hold) return; E.ring.style.transform = `translate(${hold.x}px, ${hold.y}px) translate(-50%, -50%)`; E.ring.classList.remove('hidden'); E.ring.classList.remove('go'); void E.ring.offsetWidth; E.ring.classList.add('go'); }, 140);
  hold.fire = setTimeout(() => {
    if (!hold) return;
    const { x, y } = hold; cancelHold();
    if (cam.drag) cam.drag.kind = null;               // the finger stays down: no pan when it moves now
    swallow = true;
    navigator.vibrate?.(12);
    openAt(x, y);
  }, HOLD_MS);
}
function move(e) {
  if (hold && e.pointerId === hold.id && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > SLOP) cancelHold();
  if (hold && cam.pointers && cam.pointers.size > 1) cancelHold();
}
function up(e) {
  if (hold && e.pointerId === hold.id) cancelHold();
  if (e.button === 2 && rdown) {
    const r = rdown; rdown = null;
    if (Math.hypot(e.clientX - r.x, e.clientY - r.y) < 5 && performance.now() - r.t < 700) openAt(e.clientX, e.clientY);   // a right-click, not a turn
  }
}
function cancelHold() {
  if (!hold) return;
  clearTimeout(hold.show); clearTimeout(hold.fire); hold = null;
  E.ring.classList.add('hidden'); E.ring.classList.remove('go');
}

// ------------------------------------------------------------------ what is there
function groundAt(x, y) {
  const T = app.terrain, r = cam.rayAt(x, y);
  const g = cam.groundAt(x, y, GROUND_Y), city = S.grid && g.x >= S.grid.minX && g.x <= S.grid.maxX && g.z >= S.grid.minZ && g.z <= S.grid.maxZ;
  if (city || !T?.rayHit) return g;
  return T.rayHit(r) || g;
}
function targetAt(x, y) {
  const hit = app.blds?.pick(cam.rayAt(x, y), S.focus.b, app.inter?.cutY ?? 1e9);
  const i = app.agents?.pick(x, y) ?? -1;
  if (i >= 0 && !(hit && hit.b !== S.focus.b && hit.d < app.agents.camDist(i) - 1)) return { kind: 'person', i };   // not someone behind a wall
  const g = groundAt(x, y);
  if (hit) { const B = bld(hit.b); return { kind: 'building', b: hit.b, g, pt: hit.point.clone(), f: B && B.type !== 'park' && B.floors > 1 && S.focus.b !== hit.b ? app.blds.floorOf(B, hit.point.y) : null }; }
  for (const B of S.world.buildings) if (B && !B.gone && B.type === 'park' && inFootprint(B, g.x, g.z)) return { kind: 'building', b: B.idx, g };
  const L = lotLayer()?.at(g.x, g.z);
  if (L) return { kind: 'lot', id: L.id, g };
  return { kind: 'ground', g };
}

// ------------------------------------------------------------------ the menu
function itemsFor(t) {
  const out = [], add = (a, icon, label, o = {}) => out.push({ a, icon, label, ...o });
  if (t.kind === 'person') {
    const p = S.people[t.i];
    return { head: `<b>${esc(p?.n || p?.name || 'Resident')}</b>`, items: [
      { a: 'follow', icon: '🎥', label: 'Follow' }, { a: 'talk', icon: '💬', label: 'Talk' }, { a: 'details', icon: '🔎', label: 'Details' }] };
  }
  if (t.kind === 'building') {
    const B = bld(t.b); if (!B) return null;
    const L = lotOf(B), park = B.type === 'park', can = mayOn(B, 'build'), canF = mayOn(B, 'furnish');
    if (t.f !== null && t.f !== undefined) add('lookf', '🔍', `Look inside floor ${t.f + 1}`);
    add('look', '🏢', park ? 'Visit' : t.f !== null && t.f !== undefined ? 'Look inside (ground floor)' : 'Look inside');
    if (canF && !park) add('furnish', '🛋️', 'Furnish');
    if (can) { add('move', '✥', 'Move, resize, turn, floors'); add('edit', '🏗️', 'Name, style, colours'); }
    if (L) add('lot', '🏡', `Lot ${esc(L.name || L.id)}`);
    if (can && B.type !== 'hq') add('demolish', '🗑️', 'Demolish…', { danger: true });
    const note = can ? '' : `<div class="wm-note">${esc(whyNot(B, 'build'))}</div>`;
    return { head: `<b>${esc(B.name)}</b><span class="dim">${esc(TYPE_NAME[B.type] || B.type)}${park ? '' : ` · ${B.floors} floor${B.floors > 1 ? 's' : ''}`}</span>${note}`, items: out };
  }
  if (t.kind === 'lot') {
    const L = lotLayer().byId.get(t.id), r = rightsOn(L);
    add('lot', '🏡', 'Lot details & settings');
    if (r.has('build')) add('build', '🏗️', 'Build here');
    if (r.has('merge')) add('merge', '➕', L.holder?.kind === 'municipality' ? 'Merge with city lots next to it' : 'Merge with my lots next to it');
    if (r.has('merge') && L.origins > 1) add('split', '✂️', 'Split back');
    add('lots', '🗺️', lotLayer().visible ? 'Hide the data map' : 'Show the data map');
    const who = L.holder?.kind === 'municipality' ? (L.lifecycle === 'available' ? 'For sale' : 'City land') : L.holder?.name || 'Owned';
    return { head: `<b>Lot ${esc(L.name || L.id)}</b><span class="dim">${esc(who)} · ${ft2(L.sqft)}</span>`, items: out };
  }
  add('lots', '🗺️', lotLayer()?.visible ? 'Hide the data map' : 'Show the data map');
  add('goto', '🎯', 'Centre the view here');
  return { head: '<b>Here</b><span class="dim">Not on a lot: streets, parks and open land belong to the city</span>', items: out };
}
function openAt(x, y) {
  if (S.mode === 'play') return;
  const t = targetAt(x, y), m = itemsFor(t);
  if (!m) return;
  menuFor = t; demolishArm = 0;
  E.menu.innerHTML = `<div class="wm-head">${m.head}</div>${m.items.map(i => `<button type="button" role="menuitem" class="wm-item${i.danger ? ' danger' : ''}" data-a="${i.a}"><span class="ic">${i.icon}</span>${i.label}</button>`).join('')}`;
  E.menu.classList.remove('hidden');
  // next to the finger or pointer, kept on the screen
  const r = E.menu.getBoundingClientRect(), W = innerWidth, H = innerHeight;
  const left = Math.max(8, Math.min(W - r.width - 8, x + 12)), top = Math.max(56, Math.min(H - r.height - 8, y - 20));
  E.menu.style.left = `${left}px`; E.menu.style.top = `${top}px`;
  if (t.kind === 'building') selectBuilding(t.b, t.f ?? null, t.pt || null);
}
function closeMenu() { E.menu.classList.add('hidden'); menuFor = null; }
async function onMenuClick(e) {
  const b = e.target.closest('[data-a]'); if (!b || !menuFor) return;
  const t = menuFor;
  if (b.dataset.a === 'demolish' && performance.now() - demolishArm > 3500) { demolishArm = performance.now(); b.innerHTML = '<span class="ic">⚠️</span>Tap again to demolish'; return; }
  closeMenu();
  await act(b.dataset.a, t);
}
async function act(a, t) {
  const B = t.b !== undefined ? bld(t.b) : null, L = t.kind === 'lot' ? lotLayer().byId.get(t.id) : B ? lotOf(B) : null;
  switch (a) {
    case 'follow': select(t.i); app.startFollow?.(); break;
    case 'talk': select(t.i); if (S.people[t.i]?.v && app.talk) app.talk.to(t.i); else app.chat?.openPerson(t.i); break;   // (its owner's chat window or the talk bar; a resident is told it can't chat)
    case 'details': select(t.i); app.selection?.open(); break;   // (a floating card opens by itself)
    case 'look': app.lookInside(t.b, t.useSel && S.selB === t.b ? S.selF : 0); break;
    case 'lookf': app.lookInside(t.b, t.f); break;
    case 'furnish': if (B.type !== 'park') app.lookInside(t.b); app.setMode('furnish'); break;
    case 'move': app.place?.edit(t.b); break;
    case 'edit': selectBuilding(t.b); app.setMode('build'); app.docks?.show?.('l:buildings'); break;
    case 'lot': if (L) app.property?.open(L.id); break;
    case 'build': app.place?.newOnLot(t.id); break;
    case 'merge': app.property?.merge(t.id); break;
    case 'split': app.property?.split(t.id); break;
    case 'lots': app.property?.toggle(); break;
    case 'goto': cam.flyTo(t.g.x, t.g.y ?? 0, t.g.z, null); break;
    case 'demolish': {
      try {
        const r = await post('/api/edit', { ops: [{ op: 'bld.del', b: t.b }], who: 'web' });
        if (r && r.ok === false) throw new Error(r.error);
        app.toast(`${B.name} was demolished — undo with ↶`, '', 3200); selectBuilding(-1);
      } catch (err) { if (!err.quiet) app.toast(err.message || String(err), 'bad', 4000); }
      break;
    }
    default: break;
  }
}

// ------------------------------------------------------------------ the bar over a selected building
function renderBar() {
  const B = S.selB >= 0 && S.mode !== 'play' && S.focus.b < 0 ? bld(S.selB) : null;
  if (!B || app.place?.active()) { E.bar.classList.add('hidden'); E.bar._b = -1; return; }
  const can = mayOn(B, 'build'), park = B.type === 'park';
  const fl = !park && S.selB === B.idx && S.selF !== null && B.floors > 1 ? S.selF : null;
  E.bar.innerHTML = `<button type="button" class="btn" data-a="look" title="${park ? 'Visit' : fl !== null ? `Look inside floor ${fl + 1}` : 'Look inside'}">🔍<span>${park ? 'Visit' : fl !== null ? `Floor ${fl + 1}` : 'Inside'}</span></button>${can ? '<button type="button" class="btn" data-a="move" title="Move, resize, turn, floors">✥<span>Move</span></button><button type="button" class="btn" data-a="edit" title="Name, style, colours">🏗️<span>Edit</span></button>' : ''}${lotOf(B) ? '<button type="button" class="btn" data-a="lot" title="Its lot">🏡<span>Lot</span></button>' : ''}<button type="button" class="btn more" data-a="more" title="More (or press and hold / right-click the building)">⋯</button>`;
  E.bar._b = B.idx;
  E.bar.classList.remove('hidden');
  placeBar();
}
function placeBar() {
  if (E.bar.classList.contains('hidden')) return;
  const B = bld(E.bar._b); if (!B || app.place?.active()) { E.bar.classList.add('hidden'); return; }
  _v.set(B.x, GROUND_Y + (B.base || 0) + (B.type === 'park' ? 1 : B.floors * FLOOR_H) + 2, B.z).project(cam.cam);
  const vis = _v.z < 1 && _v.x > -1.1 && _v.x < 1.1 && _v.y > -1.1 && _v.y < 1.1;
  E.bar.style.visibility = vis ? '' : 'hidden';
  if (!vis) return;
  const w = E.bar.offsetWidth, x = (_v.x + 1) / 2 * innerWidth, y = (1 - _v.y) / 2 * innerHeight;
  const left = Math.max(6, Math.min(innerWidth - w - 6, x - w / 2)), top = Math.max(54, Math.min(innerHeight - 120, y - 56));
  E.bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
function onBarClick(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const B = bld(E.bar._b); if (!B) return;
  if (b.dataset.a === 'more') { const r = b.getBoundingClientRect(); menuFor = null; openFor({ kind: 'building', b: B.idx, g: { x: B.x, z: B.z } }, r.right, r.bottom); return; }
  act(b.dataset.a, { kind: 'building', b: B.idx, useSel: true });
}
function openFor(t, x, y) {
  const m = itemsFor(t); if (!m) return;
  menuFor = t; demolishArm = 0;
  E.menu.innerHTML = `<div class="wm-head">${m.head}</div>${m.items.map(i => `<button type="button" role="menuitem" class="wm-item${i.danger ? ' danger' : ''}" data-a="${i.a}"><span class="ic">${i.icon}</span>${i.label}</button>`).join('')}`;
  E.menu.classList.remove('hidden');
  const r = E.menu.getBoundingClientRect();
  E.menu.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width))}px`; E.menu.style.top = `${Math.max(56, Math.min(innerHeight - r.height - 8, y + 6))}px`;
}
