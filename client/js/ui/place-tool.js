// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Placing and changing buildings with handles in the world (WP4.6; 2026-10-04: "provide UI elements in the actual
// canvas world, like handles for easy resizing ... so that both desktop and phone work and are intuitive"). One tool
// for a new building and for one that stands already:
// - a see-through ghost of the building where it will stand (green where it fits, red where it doesn't), and for a
//   standing one the outline of where it stands now;
// - round handles on it, the same with a mouse or a finger: ✥ in the middle (or the ghost itself) moves it, the four
//   side handles make it wider or deeper with the opposite side staying put, ⟳ in front turns it (a tap turns it a
//   quarter in the city, 15° beyond it), ⇕ on the roof adds or takes away floors;
// - its size in feet on its sides while you work, and a bar with what it is, why it can't go there yet (the same shared
//   rules the server checks: the city or the island, the lot and its setbacks and zoning, the furniture inside), and
//   Cancel / Build (or Apply). One Build or Apply is one change: one undo.
// - floor layouts on a new size (2026-10-04, shared/edit.js interiorPlan): generated floors are laid out again; on
//   floors changed by hand whatever would no longer fit is lit red while you drag (the ghost turns amber), and Apply
//   asks what to do: keep the layout and remove those pieces, regenerate those floors, or cancel (the tool stays open
//   with the pieces lit); with several such floors, also floor by floor.
import * as THREE from 'three';
import { S, bus, bld, selectBuilding } from '../core/state.js';
import { post } from '../core/net.js';
import { auth } from '../core/auth.js';
import { h, esc } from '../core/util.js';
import { watchKeyboard } from '../core/viewport.js';
import { normalizeSpec, checkBuilding, interiorPlan, planWords, conflictGroups, floorsName, piecesWords, BUILD_TYPES } from '/shared/edit.js';
import { beyondCity, checkIslandBuilding, baseFor } from '/shared/island-build.js';
import { makeGrid, blockAt, lotRect } from '/shared/city.js';
import { GROUND_Y, FLOOR_H } from '/shared/constants.js';
import { toWorld, inFootprint } from '/shared/geom.js';
import { mayOn, whyNot, lotLayer } from '../core/rights.js';
import { DEFAULT_ENVELOPES, ENVELOPE_FALLBACK } from '/shared/lots.js';
import { lotReason, doorReasonFor, facingRoad, NEW_DEF, floorsCap } from './editors.js';

const FT = 0.3048, ft = m => Math.round(m / FT);
const MIN_W = t => (t === 'park' ? 14 : t === 'apartment' ? 13 : 10), MIN_D = t => (t === 'apartment' ? 17 : 10), MAX_W = 60, MAX_D = 50;
const TYPE_NAME = { office: 'Office', apartment: 'Apartments', cafe: 'Café', restaurant: 'Restaurant', shop: 'Shop', gym: 'Gym', park: 'Park', hq: 'Headquarters' };
const TYPE_ICON = { office: '🏢', apartment: '🏠', cafe: '☕', restaurant: '🍽️', shop: '🛍️', gym: '🏋️', park: '🌳', hq: '⭐' };
const touch = () => matchMedia('(pointer: coarse)').matches;

let app, cam, D = null, drag = null, ghost = null, fitDone = null;
const E = {};
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const MAX_MARKS = 400;

export function init(a) {
  app = a; cam = a.cam; watchKeyboard();
  const root = document.getElementById('ui');
  E.handles = root.appendChild(h('<div id="placehandles" class="hidden" aria-hidden="false"></div>'));
  E.bar = root.appendChild(h(`<div id="placebar" class="panel hidden" role="dialog" aria-label="Place a building">
    <div class="pb-types chips" role="listbox" aria-label="Kind of building">${BUILD_TYPES.map(t => `<button type="button" class="chip" data-t="${t}">${TYPE_ICON[t]} ${TYPE_NAME[t]}</button>`).join('')}</div>
    <div class="pb-head"><b class="pb-title"></b><span class="pb-dims"></span></div>
    <div class="pb-why" aria-live="polite"></div>
    <div class="pb-help hint"></div>
    <div class="pb-btns"><button type="button" class="btn pb-cancel">✕ Cancel</button><button type="button" class="btn primary pb-go">✓ Build</button></div></div>`));
  E.types = E.bar.querySelector('.pb-types'); E.title = E.bar.querySelector('.pb-title'); E.dims = E.bar.querySelector('.pb-dims');
  E.why = E.bar.querySelector('.pb-why'); E.help = E.bar.querySelector('.pb-help'); E.go = E.bar.querySelector('.pb-go');
  E.bar.querySelector('.pb-cancel').onclick = () => close();
  E.go.onclick = () => apply();
  E.types.onclick = e => { const c = e.target.closest('[data-t]'); if (c && D?.kind === 'new') setType(c.dataset.t); };
  ghost = new Ghost(a.stage.scene);
  // the handles: made once, placed every frame
  E.h = {};
  const mk = (k, icon, title) => { const el = E.handles.appendChild(h(`<button type="button" class="ph ph-${k}" title="${title}" aria-label="${title}"><i>${icon}</i></button>`)); el.addEventListener('pointerdown', e => down(e, k)); E.h[k] = el; return el; };
  mk('move', '✥', 'Drag to move');
  const ARROW = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M1.5 12 7 6.5v3.6h10V6.5l5.5 5.5-5.5 5.5v-3.6H7v3.6z" fill="currentColor"/></svg>';
  for (const k of ['e', 'w', 'n', 's']) mk(k, ARROW, 'Drag to resize');
  mk('rot', '⟳', 'Drag to turn · tap to turn a step');
  mk('up', '⇕', 'Drag up or down for more or fewer floors');
  E.dimW = E.handles.appendChild(h('<span class="pdim"></span>')); E.dimD = E.handles.appendChild(h('<span class="pdim"></span>'));
  E.dimF = E.handles.appendChild(h('<span class="pdim pdim-f"></span>'));
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  // the ghost itself can be dragged to move it (the camera pans everywhere else)
  a.stage.renderer.domElement.addEventListener('pointerdown', bodyDown);
  a.hooks.click.unshift(() => !!D);                        // taps on the world don't change the selection meanwhile
  a.hooks.key.unshift(onKey);
  bus.on('frame', frame);
  bus.on('mode', m => { if (m === 'play' && D) close(); });
  bus.on('world', () => { if (D?.kind === 'edit' && !bld(D.b)) close(); else if (D) D.dirty = true; });
  app.place = { edit: startEdit, newAt: startNew, newOnLot, active: () => !!D, close };
}

// ------------------------------------------------------------------ starting
function startEdit(b) {
  const B = bld(b);
  if (!B) return;
  if (!mayOn(B, 'build')) { app.toast(whyNot(B, 'build'), 'bad', 3200); return; }
  if (S.mode === 'play') app.setMode('explore');
  open({ kind: 'edit', b, spec: { type: B.type, style: B.style, floors: B.floors, x: B.x, z: B.z, w: B.w, d: B.d, rot: B.rot || 0 }, orig: { x: B.x, z: B.z, w: B.w, d: B.d, rot: B.rot || 0, floors: B.floors, base: B.base || 0 } });
}
/** A new building of `type` at (x, z): facing the nearest street in the city, the nearest road beyond it. */
function startNew(x, z, type = 'office', o = {}) {
  if (S.mode === 'play') app.setMode('explore');
  const def = NEW_DEF[type] || NEW_DEF.office;
  let spec = { type, style: o.style || def.style, floors: o.floors || def.floors, w: o.w || def.w, d: o.d || def.d, x, z, rot: 0 };
  spec = face(spec);
  open({ kind: 'new', spec, name: o.name || '' });
}
/** A new building on lot `id`, in its middle, as big as its setbacks allow (up to the kind's usual size). */
function newOnLot(id, type = 'office') {
  const L = lotLayer()?.byId.get(id);
  if (!L) return;
  const env = DEFAULT_ENVELOPES[L.zoning] || ENVELOPE_FALLBACK, def = NEW_DEF[type] || NEW_DEF.office;
  const room = Math.min(L.box.x1 - L.box.x0, L.box.z1 - L.box.z0) - 2 * (env.setback || 0) - 1;
  const w = Math.max(MIN_W(type), Math.min(def.w, Math.floor(room * 2) / 2)), d = Math.max(MIN_D(type), Math.min(def.d, Math.floor(room * 2) / 2));
  startNew((L.box.x0 + L.box.x1) / 2, (L.box.z0 + L.box.z1) / 2, type, { w, d, floors: Math.min(def.floors, env.maxFloors || def.floors) });
}
/** Turns a spec to face its street (city) or road (island). */
function face(spec) {
  const W = S.world;
  if (beyondCity(W, spec.x, spec.z)) {
    const net = app.terrain?.roadNet;
    if (net) { const p = facingRoad(net, { x: spec.x, z: spec.z }, spec); return { ...spec, x: p.x, z: p.z, rot: p.rot }; }
    return spec;
  }
  const g = makeGrid(W.grid), blk = blockAt(g, spec.x, spec.z);
  if (!blk) return spec;
  const r = lotRect(g, blk.i, blk.j);
  const opts = [[r.z1 - spec.z, 0], [r.x1 - spec.x, 90], [spec.z - r.z0, 180], [spec.x - r.x0, 270]].sort((a, b) => a[0] - b[0]);
  return { ...spec, rot: opts[0][1] };
}
function open(d) {
  if (D) close();
  // the data map's lots and pins would sit over the building being placed (2026-10-09: buying a lot from the map, then
  // Build here): it closes, and the world shows as it is
  if (app.property?.active()) app.property.show(false);
  D = { ...d, dirty: true, ok: false, reason: '', norm: null, base: d.orig?.base || 0 };
  E.types.classList.toggle('hidden', D.kind !== 'new');
  E.go.textContent = D.kind === 'new' ? '✓ Build' : '✓ Apply';
  E.help.textContent = touch() ? 'Drag ✥ to move · ⇔ to resize · ⟳ to turn · ⇕ for floors' : 'Drag ✥ (or the building) to move · ⇔ to resize · ⟳ to turn · ⇕ for floors · Enter applies, Esc cancels';
  E.bar.classList.remove('hidden'); E.handles.classList.remove('hidden');
  if (matchMedia('(max-width: 760px)').matches && app.docks) { app.docks.open('left', false); app.docks.open('right', false); }   // the world, not a drawer
  document.body.classList.add('placing');
  ghost.orig(D.kind === 'edit' ? d.orig : null);
  setType(D.spec.type, true);
  if (D.kind === 'edit') selectBuilding(D.b);
  const B = D.spec;
  cam.flyTo(B.x, GROUND_Y + D.base, B.z, Math.max(55, Math.max(B.w, B.d) * 2.6 + B.floors * 1.5));
}
function close() {
  if (fitDone) fitDone(null);
  D = null; drag = null;
  E.bar.classList.add('hidden'); E.handles.classList.add('hidden');
  document.body.classList.remove('placing');
  ghost.hide();
}
function setType(t, keep = false) {
  if (!D) return;
  if (!keep && D.kind === 'new') { const def = NEW_DEF[t] || NEW_DEF.office; D.spec = face({ ...D.spec, type: t, style: def.style, floors: t === 'park' ? 1 : def.floors, w: Math.max(MIN_W(t), D.spec.w), d: Math.max(MIN_D(t), D.spec.d) }); }
  for (const c of E.types.children) c.classList.toggle('on', c.dataset.t === D.spec.type);
  D.dirty = true;
}

// ------------------------------------------------------------------ rules
function validate(full) {
  const W = S.world, sp = normalizeSpec(D.spec, W), T = app.terrain, ignore = D.kind === 'edit' ? D.b : -1;
  const island = beyondCity(W, sp.x, sp.z);
  let why = '', base = 0;
  if (D.kind === 'edit') { const B = bld(D.b); if (B && (B.base !== undefined) !== island) why = B.base !== undefined ? 'Keep it beyond the city' : 'Keep it on its city block'; }
  if (!why) {
    if (island) {
      if (!T?.ground) why = 'The land here is still loading';
      else {
        const env = { heightAt: (x, z) => T.heightAt(x, z), isWater: (x, z) => T.isWater(x, z), roads: T.roadNet };
        why = checkIslandBuilding(W, sp, env, ignore) || ''; base = baseFor(env.heightAt, sp, W);
      }
    } else why = checkBuilding(W, sp, ignore) || '';
  }
  if (!why) why = lotReason(sp) || doorReasonFor({ ...sp, door: D.kind === 'edit' ? bld(D.b)?.door : undefined }, ignore) || '';
  D.plan = null;
  if (!why && D.kind === 'edit') {
    const plan = interiorPlan(bld(D.b), { x: sp.x, z: sp.z, w: sp.w, d: sp.d, rot: sp.rot }, lv => W.levels[lv], full);
    if (plan.why) why = plan.why; else D.plan = plan;
  }
  D.norm = sp; D.base = base; D.ok = !why; D.reason = why; D.dirty = false; D.full = full;
  ghost.marks(D.ok && D.plan?.choose ? misfitBoxes(sp, base, D.plan) : []);
}
function changed() {
  if (D.kind === 'new') return true;
  const o = D.orig, s = D.norm;
  return s.x !== o.x || s.z !== o.z || s.w !== o.w || s.d !== o.d || (s.rot % 360) !== (o.rot % 360) || s.floors !== o.floors;
}

// ------------------------------------------------------------------ dragging
function groundPt(x, y) { return cam.groundAt(x, y, GROUND_Y + (D?.base || 0)); }
function down(e, k) {
  if (!D || e.button > 0) return;
  e.preventDefault(); e.stopPropagation();
  e.currentTarget.setPointerCapture?.(e.pointerId);
  begin(e, k);
}
function bodyDown(e) {
  if (!D || drag || e.button > 0 || (cam.pointers && cam.pointers.size > 1)) return;
  const g = groundPt(e.clientX, e.clientY);
  if (!g || !inFootprint(D.spec, g.x, g.z, 1)) return;
  if (cam.drag) cam.drag.kind = null;       // grab the building instead of panning the camera
  begin(e, 'move');
}
function begin(e, k) {
  const g = groundPt(e.clientX, e.clientY);
  drag = { k, id: e.pointerId, sx: e.clientX, sy: e.clientY, g0: g ? { x: g.x, z: g.z } : null, s0: { ...D.spec }, moved: false };
  if (k === 'up') { const a = screenOf(D.spec.x, roofY(D.spec.floors), D.spec.z), b = screenOf(D.spec.x, roofY(D.spec.floors + 1), D.spec.z); drag.ppf = Math.max(6, a && b ? Math.abs(a.y - b.y) : 20); }
  E.handles.classList.add('dragging'); E.h[k]?.classList.add('on');
}
function move(e) {
  if (!drag || e.pointerId !== drag.id || !D) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
  drag.moved = true; e.preventDefault();
  const s0 = drag.s0, k = drag.k, sp = D.spec;
  if (k === 'up') {
    const n = Math.round((drag.sy - e.clientY) / drag.ppf);
    sp.floors = Math.max(1, Math.min(floorsCap(sp.type), s0.floors + n));
  } else {
    const g = groundPt(e.clientX, e.clientY); if (!g || !drag.g0) return;
    const dx = g.x - drag.g0.x, dz = g.z - drag.g0.z;
    if (k === 'move') { sp.x = s0.x + dx; sp.z = s0.z + dz; }
    else if (k === 'rot') {
      const a = Math.atan2(g.x - s0.x, g.z - s0.z) * 180 / Math.PI;
      const city = !beyondCity(S.world, s0.x, s0.z), step = city ? 90 : e.shiftKey ? 1 : 5;
      sp.rot = ((Math.round(a / step) * step) % 360 + 360) % 360;
    } else {
      // a side: the axis it moves along (local x for e/w, local z for n/s), the opposite side stays where it was
      const lx = k === 'e' || k === 'w', o = toWorld(s0, 0, 0), ax = toWorld(s0, lx ? 1 : 0, lx ? 0 : 1);
      const ux = ax.x - o.x, uz = ax.z - o.z, sign = k === 'e' || k === 'n' ? 1 : -1;
      const t = dx * ux + dz * uz, size0 = lx ? s0.w : s0.d;
      let size = Math.round((size0 + sign * t) * 2) / 2;
      size = Math.max(lx ? MIN_W(sp.type) : MIN_D(sp.type), Math.min(lx ? MAX_W : MAX_D, size));
      const shift = sign * (size - size0) / 2;
      if (lx) sp.w = size; else sp.d = size;
      sp.x = s0.x + ux * shift; sp.z = s0.z + uz * shift;
    }
  }
  D.dirty = true;
}
function up(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  E.handles.classList.remove('dragging'); for (const el of Object.values(E.h)) el.classList.remove('on');
  if (!D) return;
  if (!d.moved && d.k === 'rot') {   // a tap on ⟳: a quarter turn in the city, 15° beyond it
    const city = !beyondCity(S.world, D.spec.x, D.spec.z);
    D.spec.rot = ((Math.round(D.spec.rot / (city ? 90 : 15)) * (city ? 90 : 15) + (city ? 90 : 15)) % 360 + 360) % 360;
  }
  if (!d.moved && d.k === 'up') D.spec.floors = Math.min(floorsCap(D.spec.type), D.spec.floors + 1);
  if (D.kind === 'new' && d.k !== 'up' && d.k !== 'rot' && d.moved && beyondCity(S.world, D.spec.x, D.spec.z) && d.k === 'move') D.spec = face(D.spec);   // beyond the city it turns to its road
  validate(true);
  show();
}
function onKey(e) {
  if (fitDone) {   // the dialog is open: Esc cancels, Enter / Space press its focused button
    if (e.key === 'Escape') fitDone(null);
    else if ((e.key === 'Enter' || e.key === ' ') && e.target?.closest?.('.fitdlg button')) e.target.click();
    return e.key !== 'Tab';
  }
  if (!D) return false;
  if (e.key === 'Escape') { close(); return true; }
  if (e.key === 'Enter') { apply(); return true; }
  if (e.key === 'r' || e.key === 'R') { const city = !beyondCity(S.world, D.spec.x, D.spec.z), st = city ? 90 : 15; D.spec.rot = ((D.spec.rot + (e.shiftKey ? -st : st)) % 360 + 360) % 360; D.dirty = true; return true; }
  return false;
}

// ------------------------------------------------------------------ applying
async function apply() {
  if (!D || fitDone) return;
  validate(true); show();
  if (!D.ok) { app.toast(D.reason, 'bad', 3200); return; }
  const s = D.norm;
  let ops;
  if (D.kind === 'new') ops = [{ op: 'bld.add', spec: { ...s, name: D.name || '' } }];
  else {
    if (!changed()) { close(); return; }
    ops = [];
    const o = D.orig, placeOp = s.x !== o.x || s.z !== o.z || s.w !== o.w || s.d !== o.d || s.rot !== o.rot;
    let fit;
    if (placeOp && D.plan?.choose) {
      // floors changed by hand where something no longer fits: the person chooses (Cancel leaves them lit red)
      fit = await chooseFit(bld(D.b), D.plan);
      if (!D) return;
      if (!fit) { show(); return; }
    }
    if (placeOp) ops.push({ op: 'bld.place', b: D.b, x: s.x, z: s.z, w: s.w, d: s.d, rot: s.rot, ...(fit ? { fit } : {}) });
    if (s.floors !== o.floors) {
      // between one floor and several every floor is rebuilt: that goes as its own change after the move
      if (placeOp && (o.floors === 1) !== (s.floors === 1)) D.after = [{ op: 'bld.floors', b: D.b, floors: s.floors }];
      else ops.push({ op: 'bld.floors', b: D.b, floors: s.floors });
    }
  }
  E.go.disabled = true;
  try {
    const r = await post('/api/edit', { ops, who: 'web' });
    if (r && r.ok === false) throw new Error(r.error || 'That change did not work');
    if (D?.after) { const r2 = await post('/api/edit', { ops: D.after, who: 'web' }); if (r2 && r2.ok === false) throw new Error(r2.error || 'The floors did not change'); }
    const kind = D?.kind, b = D?.b;
    close();
    if (kind === 'new') {
      const res = r?.results?.[0];
      if (res) {
        app.toast(`🏗️ Built ${res.name}`, 'good', 2400);
        if (bld(res.b)) selectBuilding(res.b);
      }
    }
    else {
      const res = r?.results?.[0] || {}, n = res.removed || 0;
      app.toast(`${bld(b)?.name || 'The building'} changed${n ? ` · ${n} piece${n > 1 ? 's' : ''} removed` : ''} — undo with ↶`, 'good', n ? 3600 : 2400);
      selectBuilding(b);
    }
  } catch (err) {
    const m = String(err.message || err);
    app.toast(m, 'bad', 4000);
  }
  finally { E.go.disabled = false; }
}

// ------------------------------------------------------------------ floors changed by hand that no longer fit
/** Boxes (world) for the pieces a plan would remove: on every floor of their layout, at the building's new place. */
function misfitBoxes(s, base, plan) {
  const out = [];
  for (const G of conflictGroups(plan)) {
    for (const r of G.remove) {
      for (const f of G.floors) {
        const y = GROUND_Y + base + f * FLOOR_H + 0.02;
        if (r.bb) { const p = toWorld(s, (r.bb.x0 + r.bb.x1) / 2, (r.bb.z0 + r.bb.z1) / 2); out.push({ x: p.x, y, z: p.z, w: r.bb.x1 - r.bb.x0, d: r.bb.z1 - r.bb.z0, h: 1.1 }); }
        else if (r.seg) { const [x1, z1, x2, z2] = r.seg, p = toWorld(s, (x1 + x2) / 2, (z1 + z2) / 2); out.push({ x: p.x, y, z: p.z, w: Math.max(0.16, Math.abs(x2 - x1)), d: Math.max(0.16, Math.abs(z2 - z1)), h: 2.6 }); }
      }
    }
  }
  return out;
}
const cap = t => `${t[0].toUpperCase()}${t.slice(1)}`;
/** Asks what to do with floors changed by hand where something no longer fits (2026-10-04): resolves 'keep' (the
 *  layout without those pieces: they are deleted, undo brings them back), 'regen' (those floors laid out again),
 *  { <layout>: 'keep' | 'regen' } floor by floor, or null (cancel). */
function chooseFit(B, plan) {
  const C = conflictGroups(plan), auto = plan.groups.filter(G => G.regen), n = plan.remove, fl = floorsName(B, C.flatMap(G => G.floors));
  const many = C.length > 1 || C[0].floors.length > 1, allKeep = C.every(G => G.keepOk);
  const autoFl = auto.length ? floorsName(B, auto.flatMap(G => G.floors)) : '';
  const el = document.body.appendChild(h(`<div class="modal-back fit-back"><div class="panel fitdlg" role="dialog" aria-modal="true" aria-labelledby="fit-t">
    <h3 id="fit-t">Resizing ${esc(B.name)}</h3>
    <p>${esc(cap(fl))} ${many ? 'were' : 'was'} changed by hand. ${n ? `${n} piece${n > 1 ? 's' : ''} ${n > 1 ? 'don’t' : 'doesn’t'} fit the new size:` : 'The new size would block the way through:'}</p>
    <ul class="fit-list">${C.map(G => `<li><b>${esc(cap(floorsName(B, G.floors)))}</b>${G.remove.length ? `: ${esc(piecesWords(G.remove, 5))}` : ''}${G.keepOk ? '' : ` <span class="bad">— ${esc(G.keepWhy.toLowerCase())}</span>`}</li>`).join('')}</ul>
    ${autoFl ? `<p class="hint">${esc(cap(autoFl))} ${auto.length > 1 || auto[0].floors.length > 1 ? 'weren’t' : 'wasn’t'} changed by hand: ${auto.length > 1 || auto[0].floors.length > 1 ? 'they' : 'it'}’ll be laid out again for the new size.</p>` : ''}
    <div class="fit-btns">
      <button type="button" class="btn primary" data-fit="keep"${allKeep ? '' : ' disabled'}>Keep my layout, remove ${n === 1 ? 'the conflicting piece' : `the ${n} conflicting pieces`}</button>
      <button type="button" class="btn" data-fit="regen">Regenerate ${esc(fl)}</button>
      <button type="button" class="btn" data-fit="cancel">Cancel</button>
    </div>
    ${allKeep ? '' : '<p class="hint">Keeping the layout isn’t possible where the floor’s own walls would block the way: regenerate it, or cancel and move them.</p>'}
    ${C.length > 1 ? `<button type="button" class="fit-more" aria-expanded="false">Choose floor by floor ▾</button>
    <div class="fit-each hidden">${C.map(G => `<div class="fit-row" data-lv="${G.lv}"><span>${esc(cap(floorsName(B, G.floors)))}</span><span class="seg">
      <button type="button" class="btn${G.keepOk ? ' on' : ''}" data-v="keep"${G.keepOk ? '' : ' disabled'}>Keep, remove ${G.remove.length}</button>
      <button type="button" class="btn${G.keepOk ? '' : ' on'}" data-v="regen">Regenerate</button></span></div>`).join('')}
      <button type="button" class="btn primary" data-fit="each">Apply these choices</button></div>` : ''}
  </div></div>`));
  return new Promise(resolve => {
    const done = v => { fitDone = null; el.remove(); resolve(v); };
    fitDone = done;
    el.addEventListener('click', e => {
      if (e.target === el) return done(null);
      const more = e.target.closest('.fit-more');
      if (more) { const box = el.querySelector('.fit-each'), open = box.classList.toggle('hidden') === false; more.setAttribute('aria-expanded', String(open)); more.textContent = open ? 'Choose floor by floor ▴' : 'Choose floor by floor ▾'; return; }
      const v = e.target.closest('[data-v]');
      if (v && !v.disabled) { for (const b of v.parentElement.children) b.classList.toggle('on', b === v); return; }
      const b = e.target.closest('[data-fit]');
      if (!b || b.disabled) return;
      if (b.dataset.fit === 'cancel') return done(null);
      if (b.dataset.fit !== 'each') return done(b.dataset.fit);
      const each = {};
      for (const row of el.querySelectorAll('.fit-row')) each[row.dataset.lv] = row.querySelector('.btn.on')?.dataset.v || 'regen';
      done(each);
    });
    (el.querySelector('[data-fit="keep"]:not([disabled])') || el.querySelector('[data-fit="regen"]')).focus();
  });
}

// ------------------------------------------------------------------ drawing
const roofY = floors => GROUND_Y + (D?.base || 0) + (D?.spec.type === 'park' ? 0.6 : floors * FLOOR_H);
function screenOf(x, y, z) {
  _v.set(x, y, z).project(cam.cam);
  if (_v.z > 1 || _v.z < -1) return null;
  return { x: (_v.x + 1) / 2 * innerWidth, y: (1 - _v.y) / 2 * innerHeight };
}
function put(el, p, dx = 0, dy = 0) {
  if (!p) { el.style.display = 'none'; return; }
  el.style.display = ''; el.style.transform = `translate(${Math.round(p.x + dx)}px, ${Math.round(p.y + dy)}px) translate(-50%, -50%)`;
}
function frame() {
  if (!D) return;
  if (D.dirty) { validate(!drag); show(); }
  const s = D.spec, y0 = GROUND_Y + D.base + 0.2, hw = s.w / 2, hd = s.d / 2;
  const at = (lx, lz, y = y0) => { const p = toWorld(s, lx, lz); return screenOf(p.x, y, p.z); };
  const c = at(0, 0);
  put(E.h.move, c);
  const pe = at(hw, 0), pw = at(-hw, 0), pn = at(0, hd), ps = at(0, -hd);
  put(E.h.e, pe); put(E.h.w, pw); put(E.h.n, pn); put(E.h.s, ps);
  // the arrows point along the side's axis on screen
  if (pe && pw) { const a = Math.atan2(pe.y - pw.y, pe.x - pw.x) * 180 / Math.PI; for (const k of ['e', 'w']) E.h[k].style.setProperty('--a', `${a}deg`); }
  if (pn && ps) { const a = Math.atan2(pn.y - ps.y, pn.x - ps.x) * 180 / Math.PI; for (const k of ['n', 's']) E.h[k].style.setProperty('--a', `${a}deg`); }
  put(E.h.rot, at(0, hd + Math.max(3, Math.min(8, s.d * 0.25))));
  E.h.up.classList.toggle('hidden', s.type === 'park');
  put(E.h.up, s.type === 'park' ? null : at(0, 0, roofY(s.floors) + 1.2));
  // measurements in feet on the front and the side; floors by the roof handle
  E.dimW.textContent = `${ft(s.w)} ft`; E.dimD.textContent = `${ft(s.d)} ft`; E.dimF.textContent = s.type === 'park' ? '' : `${s.floors} floor${s.floors > 1 ? 's' : ''}`;
  put(E.dimW, at(hw * 0.5, hd + 1.5)); put(E.dimD, at(hw + 1.5, -hd * 0.5)); put(E.dimF, s.type === 'park' ? null : at(0, 0, roofY(s.floors) + 1.2), 0, -34);
  ghost.show(D.norm || s, D.ok, D.base, D.ok && !!D.plan?.choose);
}
function show() {
  if (!D) return;
  const s = D.norm || D.spec, B = D.kind === 'edit' ? bld(D.b) : null;
  E.title.textContent = D.kind === 'new' ? `New ${(TYPE_NAME[s.type] || s.type).toLowerCase()}` : B?.name || 'Building';
  E.dims.textContent = ` · ${ft(s.w)} × ${ft(s.d)} ft${s.type === 'park' ? '' : ` · ${s.floors} floor${s.floors > 1 ? 's' : ''}`}`;
  const P = D.plan, warn = D.ok && !!P?.choose && changed(), words = D.ok && P && changed() ? planWords(B, P) : '';
  const t = !D.ok ? `⚠️ ${D.reason}` : D.kind === 'new' ? '✅ It fits here' : !changed() ? 'Drag a handle to change it'
    : warn ? `⚠️ ${words} — lit red. Move ${P.remove === 1 ? 'it' : 'them'} first, or Apply and choose` : `✅ It fits here${words ? ` · ${words}` : ''}`;
  if (E.why.textContent !== t) E.why.textContent = t;
  E.why.classList.toggle('bad', !D.ok);
  E.why.classList.toggle('warn', warn);
  E.go.disabled = !D.ok || (D.kind === 'edit' && !changed());
}

/** The see-through building where it will stand, and (for a standing one) the outline of where it stands now. */
class Ghost {
  constructor(scene) {
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.28, depthWrite: false, depthTest: false, fog: false });
    this.lineMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false, fog: false });
    this.box = new THREE.Mesh(box, this.mat); this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), this.lineMat);
    this.door = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffcc4d, depthTest: false, transparent: true, opacity: 0.9, fog: false }));
    this.box.renderOrder = 20; this.edges.renderOrder = 21; this.door.renderOrder = 21;
    this.group = new THREE.Group(); this.group.add(this.box, this.edges, this.door); this.group.visible = false;
    const og = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.5, 0, 0.5), new THREE.Vector3(0.5, 0, 0.5), new THREE.Vector3(0.5, 0, -0.5), new THREE.Vector3(-0.5, 0, -0.5)]);
    this.was = new THREE.LineLoop(og, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.04, gapSize: 0.03, transparent: true, opacity: 0.8, depthTest: false, fog: false }));
    this.was.computeLineDistances(); this.was.renderOrder = 19; this.was.visible = false;
    // the pieces that would not fit (floors changed by hand): red boxes seen through the walls
    this.misfit = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.6, depthWrite: false, depthTest: false, fog: false }), MAX_MARKS);
    this.misfit.renderOrder = 22; this.misfit.count = 0; this.misfit.visible = false; this.misfit.frustumCulled = false;
    scene.add(this.group, this.was, this.misfit);
  }
  marks(list) {
    const m = this.misfit, n = Math.min(MAX_MARKS, list.length);
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((D?.norm || D?.spec)?.rot || 0) * Math.PI / 180);
    for (let k = 0; k < n; k++) { const b = list[k]; _m.compose(_p.set(b.x, b.y, b.z), rot, _s.set(b.w, b.h, b.d)); m.setMatrixAt(k, _m); }
    m.count = n; m.visible = n > 0;
    if (n) m.instanceMatrix.needsUpdate = true;
  }
  orig(o) {
    this.was.visible = !!o;
    if (o) { this.was.position.set(o.x, GROUND_Y + (o.base || 0) + 0.15, o.z); this.was.rotation.set(0, (o.rot || 0) * Math.PI / 180, 0); this.was.scale.set(o.w, 1, o.d); }
  }
  show(s, ok, base, warn = false) {
    const hgt = s.type === 'park' ? 0.6 : s.floors * FLOOR_H;
    this.group.position.set(s.x, GROUND_Y + base + 0.03, s.z); this.group.rotation.set(0, (s.rot || 0) * Math.PI / 180, 0);
    for (const m of [this.box, this.edges]) m.scale.set(s.w, hgt, s.d);
    this.door.position.set(0, 0.06, s.d / 2 + 1.0);
    const col = !ok ? 0xff6b6b : warn ? 0xffb347 : 0x5ee08f; this.mat.color.set(col); this.lineMat.color.set(col);
    this.group.visible = true;
  }
  hide() { this.group.visible = false; this.was.visible = false; this.marks([]); }
}
