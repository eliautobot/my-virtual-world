// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Editors. Furnish: place / move / rotate / recolour / remove objects on the focused floor or in a park, with a live
// preview checked against the same shared rules the server enforces. Build: edit the selected building (name, sign,
// floors, style, roof, colours), add new buildings with a placement ghost, demolish, add residents.
// Every change goes through POST /api/edit and comes back to every client as a patch.
import * as THREE from 'three';
import { S, bus, bld, levelOf, selectBuilding } from '../core/state.js';
import { post } from '../core/net.js';
import { h, esc } from '../core/util.js';
import { CATALOG, CATEGORIES } from '/shared/catalog.js';
import { INDOOR_SIGNS, signFace, signSize, signGeoKey, stylesOf, signStyle, signLit, SIGN_ACCENT, SIGN_LIGHTS } from '/shared/signs.js';
import { EDIT_TYPES, BUILD_TYPES, BUILD_STYLES, ROOF_KINDS, checkItem, normalizeSpec, checkBuilding, interiorBounds, levelMode, floorsName } from '/shared/edit.js';
import { DEFAULT_ENVELOPES, ENVELOPE_FALLBACK } from '/shared/lots.js';
import { auth } from '../core/auth.js';
import { mayOn, whyNot, rightsOn } from '../core/rights.js';
import { slot } from './docks.js';
import { toWorld, toLocal, bRot, corners, itemRect } from '/shared/geom.js';
import { floorAt, GROUND_Y, FLOOR_H, MAX_FLOORS } from '/shared/constants.js';
import { beyondCity, checkIslandBuilding, baseFor, ROAD_CLEAR } from '/shared/island-build.js';
import { doorReason } from '/shared/door-access.js';
import { pointAt as pointAtS } from '/shared/roads.js';
import { furnitureGeometry } from '../render/furniture.js';
import { initLibrary, saveLayout, openLibrary } from './floor-library.js';
import { initFloorThemes, openThemes, nameFloor } from './floor-themes.js';
import { themeOf, themeWhy } from '/shared/floor-themes.js';

export const ICON = {
  sign_stand: '🪧', sign_stand_wide: '🪧', sign_wall: '🖼️', sign_wall_tall: '🖼️',
  desk: '🖥️', desk_l: '🖥️', desk_exec: '💼', standing_desk: '🧍', meeting_table: '🤝', whiteboard: '📋', tv_wall: '📺', printer: '🖨️',
  bookshelf: '📚', filing: '🗄️', phone_booth: '☎️', server_rack: '💾', reception: '🛎️', sofa: '🛋️', sofa_l: '🛋️', armchair: '💺',
  beanbag: '🟤', coffee_table: '☕', rug: '🟫', tv_stand: '📺', kitchen: '🍳', counter: '🥣', fridge: '🧊', coffee_machine: '☕',
  water_cooler: '💧', vending: '🥤', dining_table: '🍽️', cafe_table: '🪑', cafe_table4: '🪑', bar_counter: '🍸', cafe_counter: '🧁',
  shop_shelf: '🛒', clothes_rack: '👗', checkout: '💳', display: '🏷️', shoe_wall: '👟', shoe_plinth: '✨', treadmill: '🏃', weights: '🏋️', yoga_mat: '🧘', lockers: '🔒',
  bed_double: '🛏️', bed_single: '🛏️', nightstand: '💡', wardrobe: '👔', shower: '🚿', sink: '🚰', toilet: '🚽', bathtub: '🛁', desk_home: '💻', mailboxes: '📬',
  pingpong: '🏓', arcade: '🕹️', piano: '🎹', dance_floor: '💃',
  pool_table: '🎱', bowling_lane: '🎳', mech_bull: '🐂', air_hockey: '🏓', claw_machine: '🧸', skeeball: '🎯', hoop_shot: '🏀', pinball: '👾',
  racing_sim: '🏎️', dance_machine: '💃', whack_mole: '🎮', boxer: '🥊', foosball: '🎮', photo_booth: '📷', prize_case: '🎁', prize_wall: '🧸',
  token_machine: '🪙', snack_bar: '🍿', neon_booth: '🛋️', hightop_table: '🍸', gaming_chair: '🪑', giant_joystick: '🕹️', led_pillar: '💡',
  curve_sofa: '🛋️', serp_sofa: '🛋️', boucle_chair: '💺', shell_chair: '💺', pouf: '🟤', stone_table: '☕', side_lamp_table: '💡', fire_table: '🔥', organic_rug: '🟫', chaise: '🛋️', floor_lantern: '💡', planter_box: '🌿', slat_screen: '🟫',
  arc_lamp: '💡', twist_sculpture: '✨', stone_stack: '✨', ring_sculpture: '⭕', vase_set: '🌿', planter_palm: '🌱', wall_niche: '✨', wall_slats: '🟫', wall_sconce: '💡',
  art_panel: '🖼️', cove_light: '✨', lounge_bar: '🍸', back_bar: '🍸', lounge_stage: '🎤',
  island_bar: '🍸', round_bar: '🍷', table_two: '☕', table_four: '🍽', highboy: '🍸', loveseat: '🛋️', sofa_lounge: '🛋️', club_chair: '💺', booth_round: '🍽',
  banquette_table: '🍽', drink_ledge: '🍷', fireplace: '🔥', bookcase: '📚', olive_tree: '🌳',
  dj_stage: '🎧', dance_ring: '💃', dance_ring_s: '💃', club_bar: '🍸', vip_booth: '🍾', party_table: '🍾', speaker_stack: '🔊', light_tower: '💡', laser_bar: '✨',
  led_wall: '📺', go_go_podium: '💃', neon_palm: '✨', neon_vip: '✨', royal_palm: '🌱', velvet_rope: '🎉',
  floor_neon: '✨', neon_arcade: '✨', neon_gameon: '✨', neon_prizes: '✨', neon_snacks: '✨', neon_joystick: '✨', neon_invader: '👾', pixel_mural: '👾', pixel_mural_maze: '👾', plant: '🌿', plant_tall: '🌱', floor_lamp: '💡', bench: '🪑',
  picnic_table: '🧺', tree: '🌳', tree_pine: '🌲', bush: '🌿', flowers: '🌷', fountain: '⛲',
};
const CAT_ICON = { Office: '💼', Lounge: '🛋️', Kitchen: '🍳', Retail: '🛍️', Gym: '🏋️', Home: '🏠', Fun: '🎲', Arcade: '🕹️', Club: '🎧', Decor: '🌿', Signs: '🪧', Outdoor: '🌳' };
const TINTS = ['#f1f0ec', '#d8d2c4', '#b08560', '#6e4a31', '#3b3f45', '#6d7b8f', '#1f2a44', '#3d6fb6', '#2a9d8f', '#4f8a3c', '#e9c46a', '#e76f51', '#c0392b', '#8e44ad', '#e84393'];
const TYPE_CAT = { office: 'Office', hq: 'Office', apartment: 'Home', cafe: 'Kitchen', restaurant: 'Kitchen', shop: 'Retail', gym: 'Gym', park: 'Outdoor' };
const STYLE_NAME = { glass: 'Glass', brick: 'Brick', concrete: 'Concrete', modern: 'Modern', classic: 'Classic', stucco: 'Stucco' };
const ROOF_NAME = { hvac: 'Machinery', garden: 'Garden', water_tower: 'Water tower', helipad: 'Helipad', none: 'Plain' };
export const NEW_DEF = {
  office: { w: 18, d: 16, floors: 8, style: 'glass' }, apartment: { w: 20, d: 18, floors: 6, style: 'brick' },
  cafe: { w: 12, d: 14, floors: 1, style: 'modern' }, restaurant: { w: 14, d: 16, floors: 1, style: 'classic' },
  shop: { w: 14, d: 14, floors: 1, style: 'stucco' }, gym: { w: 18, d: 18, floors: 2, style: 'concrete' }, park: { w: 30, d: 24, floors: 1, style: 'modern' },
};
const COLOR_KEYS = [['wall', 'Walls'], ['trim', 'Trim'], ['glass', 'Glass'], ['roof', 'Roof'], ['accent', 'Accent']];
const SNAP = 0.25, HALF = Math.PI / 2, STEP15 = Math.PI / 12;
const snap = v => Math.round(v / SNAP) * SNAP;
const normA = a => Math.atan2(Math.sin(a), Math.cos(a));
export const floorsCap = t => (t === 'office' || t === 'apartment' || t === 'hq' ? MAX_FLOORS : t === 'park' ? 1 : 4);

let app, cam, inter;
const F = { type: null, cat: null, rot: 0, tint: '#6d7b8f', it: null, ok: false, reason: '', sel: null, drag: null, dirty: true, scopeAll: false, tgKey: '',
  sv: {}, sc: SIGN_ACCENT };   // a new sign's style (by type) and light colour
const BS = { tab: 'edit', form: { type: 'office', ...NEW_DEF.office }, rot: 0, spec: null, ok: false, reason: '', pending: -1, delArm: 0, dirty: true };
const ptr = { x: 0, y: 0, in: false, moved: false };
const lastCam = new THREE.Vector3();
const E = {};
let ghost, bghost;

// ------------------------------------------------------------------ helpers
/** The floor being furnished: the focused floor, or a selected park — only where I may furnish (core/rights.js). */
function target() { const tg = focusTarget(); return tg && mayOn(tg.B, 'furnish') ? tg : null; }
function focusTarget() {
  if (S.focus.b >= 0) { const B = bld(S.focus.b); if (B && B.type !== 'park') return { B, b: S.focus.b, f: S.focus.f, y: floorAt(B, S.focus.f) }; }
  if (S.selB >= 0) { const B = bld(S.selB); if (B && B.type === 'park') return { B, b: S.selB, f: 0, y: floorAt(B, 0) }; }
  return null;
}
const tgKey = tg => (tg ? tg.b + ':' + tg.f : '');
function shared(tg) { if (!tg || tg.B.type === 'park') return 1; const lv = tg.B.lv[tg.f]; return tg.B.lv.filter(x => x === lv).length; }
function scopeOp(tg) { return F.scopeAll && shared(tg) > 1 ? { scope: 'all' } : {}; }
function ownItem(tg, e) { return !!(tg && e && e.b === tg.b && (tg.B.type === 'park' || e.f === tg.f) && CATALOG[e.t] && !CATALOG[e.t].fixed); }
async function edit(ops) {
  try {
    const r = await post('/api/edit', { ops, who: 'web' });
    if (r && r.ok === false) throw new Error(r.error || 'That change did not work');
    return r;
  } catch (err) { app.toast(String(err.message || err).replace(/^floors_unpaid: /, ''), 'bad', 2800); return null; }
}
function wallSnap(B, it) {
  const ib = interiorBounds(B), d = CATALOG[it.t], hz = Math.max(Math.abs(d.rect[1]), Math.abs(d.rect[3])) + 0.01;
  const opts = [[ib.z1 - it.z, 'n'], [it.z - ib.z0, 's'], [ib.x1 - it.x, 'e'], [it.x - ib.x0, 'w']].sort((a, b) => a[0] - b[0]);
  if (opts[0][0] > 1.6) return it;
  const o = { ...it }, side = opts[0][1];
  if (side === 'n') { o.z = ib.z1 - hz; o.r = Math.PI; }
  else if (side === 's') { o.z = ib.z0 + hz; o.r = 0; }
  else if (side === 'e') { o.x = ib.x1 - hz; o.r = -HALF; }
  else { o.x = ib.x0 + hz; o.r = HALF; }
  return o;
}

// ------------------------------------------------------------------ ghosts
class ItemGhost {
  constructor(scene) {
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.62, depthWrite: false, roughness: 0.55 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.renderOrder = 6; this.mesh.visible = false; this.mesh.frustumCulled = false;
    this.padMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    this.pad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.padMat);
    this.pad.renderOrder = 5; this.pad.visible = false;
    this.type = null;
    scene.add(this.mesh, this.pad);
  }
  setType(t) {
    if (t === this.type) return;
    this.type = t;
    this.mesh.geometry = (t && (furnitureGeometry(t).whole?.() || furnitureGeometry(t).geo)) || new THREE.BufferGeometry();   // (with its moving parts at rest)
  }
  show(tg, it, ok) {
    const [x0, z0, x1, z1] = itemRect(it, CATALOG[it.t].rect), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;   // (a sign's geometry is made at its size)
    const w = toWorld(tg.B, it.x, it.z), yaw = bRot(tg.B) + (it.r || 0), c = Math.cos(yaw), s = Math.sin(yaw);
    this.mesh.position.set(w.x, tg.y + 0.012, w.z); this.mesh.rotation.set(0, yaw, 0);
    this.pad.position.set(w.x + cx * c + cz * s, tg.y + 0.03, w.z - cx * s + cz * c); this.pad.rotation.set(0, yaw, 0);
    this.pad.scale.set(Math.max(0.1, x1 - x0), 1, Math.max(0.1, z1 - z0));
    const col = ok ? 0x5ee08f : 0xff6b6b;
    this.mat.color.set(ok ? 0xdcffe8 : 0xffd4d4); this.mat.emissive.set(col).multiplyScalar(0.3); this.padMat.color.set(col);
    this.mesh.visible = this.pad.visible = true;
  }
  hide() { this.mesh.visible = this.pad.visible = false; }
}
class BuildGhost {
  constructor(scene) {
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.mat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.34, depthWrite: false, roughness: 0.5 });
    this.box = new THREE.Mesh(box, this.mat);
    this.lineMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95 });
    this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), this.lineMat);
    this.door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 1.4), new THREE.MeshBasicMaterial({ color: 0xffcc4d }));
    this.box.renderOrder = 6; this.edges.renderOrder = 7;
    this.group = new THREE.Group(); this.group.add(this.box, this.edges, this.door); this.group.visible = false;
    scene.add(this.group);
  }
  /** base: m above the city's ground (a building on its own pad beyond the city). */
  show(spec, ok, base = 0) {
    const hgt = spec.type === 'park' ? 0.6 : spec.floors * FLOOR_H;
    this.group.position.set(spec.x, GROUND_Y + base + 0.02, spec.z); this.group.rotation.set(0, bRot(spec), 0);
    for (const m of [this.box, this.edges]) { m.position.set(0, 0, 0); m.scale.set(spec.w, hgt, spec.d); }
    this.door.position.set(0, 0.05, spec.d / 2 + 0.8); this.door.rotation.set(0, 0, 0);
    const col = ok ? 0x5ee08f : 0xff6b6b; this.mat.color.set(col); this.lineMat.color.set(col);
    this.group.visible = true;
  }
  hide() { this.group.visible = false; }
}

// ------------------------------------------------------------------ init
export function init(a) {
  app = a; cam = a.cam; inter = a.inter;
  app.hooks = app.hooks || { key: [], click: [], hover: [] };
  const root = document.getElementById('ui'), canvas = a.stage.renderer.domElement;
  ghost = new ItemGhost(a.stage.scene); bghost = new BuildGhost(a.stage.scene);
  // The editor panels live in the left edit dock (PLAN WP1.7, DECISIONS C112); its tabs show one at a time.
  buildFurnish(slot('l:buildings.furnish') || root); buildBuild(slot('l:buildings.build') || root);
  app.hooks.key.push(onKey); app.hooks.click.push(onClick); app.hooks.hover.push(onHover);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', e => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.in = true; ptr.moved = true; });
  canvas.addEventListener('pointerleave', () => { ptr.in = false; ptr.moved = true; });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  bus.on('mode', onMode);
  bus.on('focus', refresh); bus.on('selectB', refresh);
  bus.on('world', onWorld);
  bus.on('frame', frame);
  app.editors = { F, BS, ICON, target, newType: setNewType, editItem };
  initLibrary(app); initFloorThemes(app, edit);
}
function refresh() {
  if (S.mode === 'furnish') refreshFurnish();
  else if (S.mode === 'build') { renderEdit(); }
}
function onWorld(ev) {
  F.dirty = true; BS.dirty = true;
  if (BS.pending >= 0 && bld(BS.pending)) { const b = BS.pending; BS.pending = -1; selectBuilding(b); }
  if (S.mode === 'furnish') refreshFurnish();
  if (S.mode === 'build' && ev && ev.blds && ev.blds.has(S.selB) && !E.tedit.contains(document.activeElement)) renderEdit();
}
function onMode(m, prev) {
  if (prev === 'furnish') {
    if (F.drag) { inter.setHidden(F.drag.e, false); F.drag = null; }
    setType(null); selectItem(null); ghost.hide();
  }
  if (prev === 'build') bghost.hide();
  E.fp.classList.toggle('hidden', m !== 'furnish');
  E.bp.classList.toggle('hidden', m !== 'build');
  if (m === 'furnish') { if (!target() && S.selB >= 0) app.lookInside(S.selB); refreshFurnish(); }
  if (m === 'build') { setTab(S.selB >= 0 ? 'edit' : 'new'); renderEdit(); }
}
function frame() {
  const moved = cam.cam.position.distanceToSquared(lastCam) > 1e-4;
  if (moved) lastCam.copy(cam.cam.position);
  placeHandles();
  if (S.mode === 'furnish') { if (ptr.moved || F.dirty || (moved && F.type)) { ptr.moved = false; updateFurnishGhost(); } }
  else if (S.mode === 'build' && BS.tab === 'new') { if (app.roadsActive?.() || app.lotTools?.active() || app.place?.active()) { bghost.hide(); return; } if (ptr.moved || BS.dirty || moved) { ptr.moved = false; updateBuildGhost(); } }
}
function onHover() {
  return (S.mode === 'furnish' && !!(F.type || (F.drag && F.drag.moved) || F.resize)) || (S.mode === 'build' && BS.tab === 'new');
}
function onKey(e) {
  const k = e.key;
  if (S.mode === 'furnish') {
    if (k === 'r' || k === 'R') {
      if (F.type) { F.rot = normA(F.rot + (e.shiftKey ? -HALF : HALF)); F.dirty = true; } else if (F.sel) rotateSel(e.shiftKey ? -HALF : HALF);
      return true;
    }
    if ((k === 'Delete' || k === 'Backspace') && F.sel) { deleteSel(); return true; }
    if (k === 'Escape') {
      if (F.drag) { inter.setHidden(F.drag.e, false); F.drag = null; ghost.hide(); F.dirty = true; return true; }
      if (F.resize) { endResize(false); return true; }
      if (F.type) { setType(null); return true; }
      if (F.sel) { selectItem(null); return true; }
    }
    return false;
  }
  if (S.mode === 'build') {
    if ((k === 'r' || k === 'R') && BS.tab === 'new') { BS.rot = (BS.rot + (e.shiftKey ? 270 : 90)) % 360; BS.dirty = true; return true; }
    if (k === 'Escape' && BS.tab === 'new') { setTab('edit'); return true; }
  }
  return false;
}
function onClick(e) {
  if (S.mode === 'furnish') return furnishClick(e);
  if (S.mode === 'build' && BS.tab === 'new' && !app.place?.active()) { buildClick(); return true; }
  return false;
}

// ------------------------------------------------------------------ furnish
function buildFurnish(root) {
  const el = E.fp = root.appendChild(h(`<div id="furnp" class="toolpanel panel hidden">
  <h4><span>🛋️ Furnish <span class="where dim"></span></span><span class="row"><label class="scope hidden"><input type="checkbox"> <span></span></label><button class="btn small done" title="Done (1)">Done</button></span></h4>
  <div class="notarget hint">Double-click a building to furnish one of its floors, or click a park.</div>
  <div class="fbody"><div class="floorbar"></div><div class="cats"></div><div class="items scroll"></div><div class="selbar"></div><div class="hint status"></div></div></div>`));
  E.fwhere = el.querySelector('.where'); E.fscope = el.querySelector('.scope'); E.fscopeT = E.fscope.querySelector('span'); E.fscopeC = E.fscope.querySelector('input');
  E.fnot = el.querySelector('.notarget'); E.fbody = el.querySelector('.fbody'); E.fcats = el.querySelector('.cats');
  E.fitems = el.querySelector('.items'); E.fsel = el.querySelector('.selbar'); E.fstat = el.querySelector('.status');
  E.ffloor = el.querySelector('.floorbar');
  E.ffloor.onclick = e => { const b = e.target.closest('[data-lop]'); if (b && !b.disabled) floorOp(b); };
  el.querySelector('.done').onclick = () => app.setMode('explore');
  E.fscopeC.onchange = () => { F.scopeAll = E.fscopeC.checked; };
  const cats = CATEGORIES.filter(c => EDIT_TYPES.some(t => CATALOG[t].cat === c));
  E.fcats.innerHTML = cats.map(c => `<button class="btn small" data-c="${c}">${CAT_ICON[c] || ''} ${c}</button>`).join('');
  E.fcats.onclick = e => { const b = e.target.closest('[data-c]'); if (b) setCat(b.dataset.c); };
  E.fitems.onclick = e => { const b = e.target.closest('[data-t]'); if (b) setType(F.type === b.dataset.t ? null : b.dataset.t); };
  E.fsel.onclick = e => {
    const b = e.target.closest('[data-a]'); if (!b || b.tagName === 'INPUT') return;
    const a = b.dataset.a;
    if (a === 'rot') rotateSel(HALF); else if (a === 'del') deleteSel();
    else if (a === 'sign') { const e2 = selEntry(); if (e2) import('./sign-design.js').then(m => m.editIndoorSign(app, { b: e2.b, f: e2.f, id: e2.id })); }
    else if (a === 'tint') tintSel(b.dataset.v); else if (a === 'ntint') { F.tint = b.dataset.v; renderSel(); }
    else if (a === 'nsv') { F.sv[F.type] = b.dataset.v; F.dirty = true; renderSel(); } else if (a === 'nsc') { F.sc = b.dataset.v; renderSel(); }
  };
  E.fsel.addEventListener('change', e => {
    const t = e.target; if (!t.matches('input[type=color]')) return;
    if (t.dataset.a === 'tintc') tintSel(t.value); else if (t.dataset.a === 'nscc') { F.sc = t.value; renderSel(); } else { F.tint = t.value; renderSel(); }
  });
}
function setCat(c) {
  F.cat = c;
  for (const b of E.fcats.children) b.classList.toggle('on', b.dataset.c === c);
  E.fitems.innerHTML = EDIT_TYPES.filter(t => CATALOG[t].cat === c)
    .map(t => `<div class="item-btn${F.type === t ? ' on' : ''}" data-t="${t}" title="${esc(CATALOG[t].name)}"><span class="em">${ICON[t] || '📦'}</span>${esc(CATALOG[t].name)}</div>`).join('');
}
function setType(t) {
  F.type = t && CATALOG[t] ? t : null;
  for (const b of E.fitems.children) b.classList.toggle('on', b.dataset.t === F.type);
  if (F.type) { selectItem(null); ghost.setType(F.type); } else ghost.hide();
  F.it = null; F.ok = false; F.reason = ''; F.dirty = true;
  renderSel();
}
function selEntry() { return F.sel ? inter.findEntry(F.sel.b, F.sel.f, F.sel.id) : null; }
/** Piece id on floor f of building b, selected in the furniture editor (a piece's own ⋯ menu, Edit: ui/post-menu.js). */
function editItem(b, f, id) {
  if (S.focus.b !== b || S.focus.f !== f) app.lookInside(b, f);
  if (S.mode !== 'furnish') app.setMode('furnish');
  const e = inter.findEntry(b, f, id);
  if (e && ownItem(target(), e)) { setType(null); selectItem(e); }
}
function selectItem(e) {
  F.sel = e ? { b: e.b, f: e.f, id: e.id } : null;
  inter.highlight(e || null);
  renderSel();
}
function reselect() {
  if (F.sel) {
    const e = selEntry();
    if (!e || !ownItem(target(), e)) { F.sel = null; inter.highlight(null); }
    else if (!(F.drag && F.drag.moved)) inter.highlight(e);
  } else inter.highlight(null);
  renderSel();
}
function swatches(action, cur, list = TINTS) {
  const c = String(cur || '').toLowerCase();
  return `<span class="swatches">${list.map(t => `<span class="sw${t === c ? ' on' : ''}" data-a="${action}" data-v="${t}" style="background:${t}" title="${t}"></span>`).join('')}<input type="color" data-a="${action}c" value="${/^#[0-9a-f]{6}$/.test(c) ? c : '#888888'}" title="Custom color"></span>`;
}
function renderSel() {
  let html = '';
  if (F.type && INDOOR_SIGNS[F.type]) {   // a new sign: its style, and its light's colour in a lit style
    const L = stylesOf(F.type), v = signStyle(F.type, F.sv[F.type]) || L[0].id;
    html = `<span class="dim">Style:</span><span class="chips">${L.map(x => `<span class="chip${x.id === v ? ' on' : ''}" data-a="nsv" data-v="${x.id}" title="${esc(x.blurb)}">${esc(x.label)}${x.light ? ' 💡' : ''}</span>`).join('')}</span>${signLit(F.type, v) ? `<span class="dim">Light:</span>${swatches('nsc', F.sc, SIGN_LIGHTS)}` : ''}`;
  }
  else if (F.type && CATALOG[F.type].tint) html = `<span class="dim">Color:</span>${swatches('ntint', F.tint)}`;
  else if (!F.type && F.sel) {
    const e = selEntry(), d = e && CATALOG[e.t];
    if (d) html = `<b>${ICON[e.t] || ''} ${esc(d.name)}</b>${INDOOR_SIGNS[e.t] ? `<span class="dim">${(F0 => sizeText(F0.w, F0.h))(signFace(e.it))}</span><button class="btn small primary" data-a="sign" title="Its size, style, design, ads">🪧 Sign settings</button>` : ''}<button class="btn small" data-a="rot" title="Rotate (R)">⟳ Rotate</button><button class="btn small danger" data-a="del" title="Remove (Del)">🗑 Remove</button>${!d.tint ? '' : !INDOOR_SIGNS[e.t] ? swatches('tint', e.c) : signLit(e.t, e.it.v) ? `<span class="dim">Light:</span>${swatches('tint', e.c, SIGN_LIGHTS)}` : ''}`;
  }
  if (E.fsel._h !== html) { E.fsel.innerHTML = html; E.fsel._h = html; }
  setStatus();
}
function setStatus() {
  let t;
  const nm = F.type ? CATALOG[F.type].name.toLowerCase() : '';
  if (F.drag && F.drag.moved) t = F.drag.reason ? '⚠️ ' + F.drag.reason : 'Release to move it here';
  else if (F.type) t = F.it ? (F.ok ? `Click to place the ${nm} · R rotate · Esc stop placing` : '⚠️ ' + F.reason) : `Point at the floor to place the ${nm}`;
  else if (F.resize) t = F.resize.reason ? `⚠️ ${F.resize.reason}` : `${sizeText(F.resize.w, F.resize.h)} · release to keep this size${F.resize.spot[0] && F.resize.spot[1] ? ' · Shift keeps its shape' : ''}`;
  else if (F.sel && INDOOR_SIGNS[selEntry()?.t]) t = 'Drag a handle to size the sign (corners: width and height; Shift keeps its shape) · drag the sign to move · R rotate · Del remove';
  else if (F.sel) t = 'Drag to move · R rotate · Del remove · Esc deselect';
  else t = 'Pick an item to place it — or click something in the room to select it, then drag to move it.';
  if (E.fstat.textContent !== t) E.fstat.textContent = t;
}
function refreshFurnish() {
  const ft = focusTarget(), tg = target(), k = tgKey(tg);
  if (ft && !tg) E.fnot.textContent = `${whyNot(ft.B, 'furnish')}. You can furnish buildings on your own lots.`;
  else E.fnot.textContent = 'Double-click a building to furnish one of its floors, or click a park.';
  E.fnot.classList.toggle('hidden', !!tg); E.fbody.classList.toggle('hidden', !tg);
  if (tg) {
    E.fwhere.textContent = '· ' + tg.B.name + (tg.B.type !== 'park' && tg.B.floors > 1 ? ` · floor ${tg.f + 1}` : '');
    const n = shared(tg);
    E.fscope.classList.toggle('hidden', n < 2);
    if (n >= 2) E.fscopeT.textContent = `Same on all ${n} floors with this layout`;
    E.fscopeC.checked = F.scopeAll;
    if (k !== F.tgKey) { F.tgKey = k; setCat(TYPE_CAT[tg.B.type] || 'Office'); }
  } else { E.fwhere.textContent = ''; E.fscope.classList.add('hidden'); F.tgKey = ''; ghost.hide(); }
  renderFloorBar(tg);
  reselect(); F.dirty = true;
}
// ------------------------------------------------------------------ the whole floor (floor layouts, 2026-10-04)
const FMODE = {
  auto: ['⚙️', 'Auto', 'Laid out for you: it rearranges itself when the building is resized'],
  custom: ['✎', 'Custom', 'Changed by hand: kept when the building is resized'],
  empty: ['○', 'Empty', 'Cleared: it stays empty when the building is resized'],
};
/** The floor's mode and its whole-floor actions (Clear floor · Regenerate · Reset to auto) on top of the Furnish panel. */
function renderFloorBar(tg) {
  let html = '';
  if (tg) {
    const L = levelOf(tg.b, tg.f), m = levelMode(L), [ic, nm, tip] = FMODE[m], park = tg.B.type === 'park', th = themeOf(L?.theme);
    // Floor Themes (a floor without flats, on a lot I may build on) and the floor's own name (furnishing rights)
    const themes = !park && mayOn(tg.B, 'build') && !themeWhy(tg.B, tg.f, L) ? `<button type="button" class="btn small ft-open" data-lop="themes" title="Lay this floor out as an arcade, a lounge, a club, a café…">🎨 Floor Themes</button>` : '';
    const naming = !park && mayOn(tg.B, 'furnish') ? `<button type="button" class="btn small" data-lop="name" title="Give this floor its own name (shown on the floor buttons and when you point at it)">✏️ Name</button>` : '';
    const acts = mayOn(tg.B, 'build') ? `<span class="fm-acts">
      <button type="button" class="btn small" data-lop="clear"${m === 'empty' ? ' disabled' : ''} title="Take out all furniture and inner walls (the elevator stays)">${park ? 'Clear park' : 'Clear floor'}</button>
      <button type="button" class="btn small" data-lop="regen" title="A new arrangement of the same kind of ${park ? 'park' : 'floor'}">🎲 Regenerate</button>
      ${m !== 'auto' ? '<button type="button" class="btn small" data-lop="reset" title="Back to the layout made for this building">↺ Reset to auto</button>' : ''}</span>` : '';
    const lib = `<span class="fm-acts"><button type="button" class="btn small" data-lop="save" title="Keep this layout in your layouts">💾 Save layout</button><button type="button" class="btn small" data-lop="lib" title="Your saved layouts and the ones shared with you">📂 Layouts</button></span>`;
    const named = L?.name && !park ? `<span class="ft-name" title="This floor's name">${th ? `${th.icon} ` : ''}${esc(L.name)}</span>` : '';
    html = `<span class="fmode fm-${m}" title="${esc(tip)}">${ic} ${nm}</span>${named}<span class="fm-tip">${esc(th ? `${tip}. Theme: ${th.name} (🎲 Regenerate rolls it again)` : tip)}</span>${themes || naming ? `<span class="fm-acts">${themes}${naming}</span>` : ''}${acts}${lib}`;
  }
  if (E.ffloor._h !== html) { E.ffloor.innerHTML = html; E.ffloor._h = html; }
}
/** Clear / regenerate / reset the floor being furnished: one change, one undo. Losing changes made by hand takes a second
 *  tap (the button asks for 3 s). */
async function floorOp(btn) {
  const tg = target(); if (!tg) return;
  const op = btn.dataset.lop, L = levelOf(tg.b, tg.f), custom = levelMode(L) === 'custom';
  if (op === 'save') return saveLayout(tg);
  if (op === 'lib') return openLibrary(tg, scopeOp(tg));
  if (op === 'themes') return openThemes(tg, scopeOp(tg), scopeOp(tg).scope ? shared(tg) : 1);
  if (op === 'name') return nameFloor(tg, scopeOp(tg));
  if (custom && !btn.dataset.armed) {
    btn.dataset.armed = '1'; btn.dataset.label = btn.textContent; btn.classList.add('danger');
    btn.textContent = op === 'clear' ? 'Tap again: clear your changes' : op === 'regen' ? 'Tap again: replace your changes' : 'Tap again: undo your changes';
    setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; btn.classList.remove('danger'); } }, 3000);
    return;
  }
  for (const b of E.ffloor.querySelectorAll('button')) b.disabled = true;
  selectItem(null); setType(null);
  const n = scopeOp(tg).scope ? shared(tg) : 1, where = tg.B.type === 'park' ? 'The park' : n > 1 ? `All ${n} floors with this layout` : `${floorsName(tg.B, [tg.f]).replace(/^./, c => c.toUpperCase())}`;
  const r = await edit([{ op: `lvl.${op}`, b: tg.b, f: tg.f, ...scopeOp(tg) }]);
  E.ffloor._h = ''; refreshFurnish();
  if (r) app.toast(`${where} ${op === 'clear' ? (n > 1 ? 'were cleared' : 'was cleared') : op === 'regen' ? (n > 1 ? 'were laid out anew' : 'was laid out anew') : (n > 1 ? 'are back to their generated layout' : 'is back to its generated layout')} — undo with ↶`, 'good', 3200);
}
function updateFurnishGhost() {
  F.dirty = false;
  const tg = target();
  if (F.drag) { if (F.drag.moved) dragGhost(); return; }
  if (F.resize) return;   // the ghost shows the sign at its new size (moveResize)
  if (!tg || !F.type || !ptr.in) { ghost.hide(); F.it = null; F.ok = false; setStatus(); return; }
  const p = inter.floorPoint(cam.rayAt(ptr.x, ptr.y), tg.y);
  if (!p) { ghost.hide(); F.it = null; setStatus(); return; }
  const l = toLocal(tg.B, p.x, p.z);
  let it = { t: F.type, x: snap(l.x), z: snap(l.z), r: F.rot };
  if (CATALOG[F.type].wall && tg.B.type !== 'park') it = wallSnap(tg.B, it);
  const reason = checkItem(tg.B, tg.f, levelOf(tg.b, tg.f), it);
  F.it = it; F.ok = !reason; F.reason = reason || '';
  ghost.setType(INDOOR_SIGNS[F.type] ? signGeoKey({ t: F.type, v: signStyle(F.type, F.sv[F.type]) }) : F.type); ghost.show(tg, it, F.ok);
  setStatus();
}
function furnishClick(e) {
  const tg = target();
  if (!tg) {
    const hit = app.blds.pick(cam.rayAt(e.clientX, e.clientY), S.focus.b, inter.cutY);
    if (hit) { app.lookInside(hit.b); return true; }
    return false;   // default handling selects parks, which makes them the target
  }
  if (F.type) {
    if (F.it && F.ok) place(tg, F.it);
    else if (F.reason) app.toast(F.reason, 'bad', 1800);
    return true;
  }
  const hit = inter.pickItem(cam.rayAt(e.clientX, e.clientY), true);
  if (hit && ownItem(tg, hit.e)) { selectItem(hit.e); return true; }
  if (F.sel) { selectItem(null); return true; }
  return false;
}
async function place(tg, it) {
  const op = { op: 'item.add', b: tg.b, f: tg.f, t: it.t, x: it.x, z: it.z, r: it.r, ...scopeOp(tg) };
  if (INDOOR_SIGNS[it.t]) { const v = signStyle(it.t, F.sv[it.t]); if (v) op.v = v; op.c = F.sc; }   // a sign in its style, its light's colour
  else if (CATALOG[it.t].tint) op.c = F.tint;
  const r = await edit([op]);
  if (r) app.toast(`${ICON[it.t] || ''} Placed the ${CATALOG[it.t].name.toLowerCase()}`, 'good', 1500);
}
function onDown(e) {
  if (e.button !== 0 || S.mode !== 'furnish' || F.type || app.wallTool?.()) return;   // a wall tool owns the pointer (ui/walls-tool.js)
  const tg = target(); if (!tg) return;
  if (startResize(e, tg)) return;   // a sign's corner handle
  const hit = inter.pickItem(cam.rayAt(e.clientX, e.clientY), true);
  if (!hit || !ownItem(tg, hit.e)) return;
  if (cam.drag) cam.drag.kind = null;      // grab the item instead of panning the camera
  const p = inter.floorPoint(cam.rayAt(e.clientX, e.clientY), tg.y), src = hit.e.it;
  const l = p ? toLocal(tg.B, p.x, p.z) : { x: src.x, z: src.z };
  F.drag = { e: hit.e, tg, sx: e.clientX, sy: e.clientY, moved: false, gx: src.x - l.x, gz: src.z - l.z, it: null, ok: false, reason: '' };
  selectItem(hit.e);
}
function onMove(e) {
  if (F.resize) { ptr.x = e.clientX; ptr.y = e.clientY; F.resize.keep = e.shiftKey; moveResize(); return; }
  const d = F.drag; if (!d) return;
  ptr.x = e.clientX; ptr.y = e.clientY;
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) { d.moved = true; inter.setHidden(d.e, true); inter.highlight(null); }
  if (d.moved) dragGhost();
}
function dragGhost() {
  const d = F.drag, tg = d.tg;
  const p = inter.floorPoint(cam.rayAt(ptr.x, ptr.y), tg.y); if (!p) return;
  const l = toLocal(tg.B, p.x, p.z), src = d.e.it;
  let it = { ...src, x: snap(l.x + d.gx), z: snap(l.z + d.gz), r: src.r || 0 };
  if (CATALOG[src.t].wall && tg.B.type !== 'park') it = wallSnap(tg.B, it);
  const reason = checkItem(tg.B, tg.f, levelOf(tg.b, tg.f), it, src.id);
  d.it = it; d.ok = !reason; d.reason = reason || '';
  ghost.setType(signGeoKey(src) || src.t); ghost.show(tg, it, d.ok);
  setStatus();
}
async function onUp() {
  if (F.resize) { endResize(true); return; }
  const d = F.drag; if (!d) return;
  F.drag = null;
  if (!d.moved) return;                      // plain click: the click hook keeps it selected
  ghost.hide(); F.dirty = true;
  if (!d.ok || !d.it) { inter.setHidden(d.e, false); app.toast(d.reason || 'It does not fit there', 'bad', 1800); reselect(); return; }
  const src = d.e.it;
  if (Math.abs(d.it.x - src.x) < 1e-3 && Math.abs(d.it.z - src.z) < 1e-3 && Math.abs((d.it.r || 0) - (src.r || 0)) < 1e-3) { inter.setHidden(d.e, false); reselect(); return; }
  const r = await edit([{ op: 'item.move', b: d.tg.b, f: d.tg.f, id: d.e.id, x: d.it.x, z: d.it.z, r: d.it.r, ...scopeOp(d.tg) }]);
  if (!r) { inter.setHidden(d.e, false); reselect(); }
}
// ------------------------------------------------------------------ sizing a sign's face by hand (2026-10-05)
// A selected sign inside shows handles round its face — the corners size its width and height (Shift keeps its
// shape), the sides one of them. The face takes any size within its kind's (shared/signs.js SIGN_SIZE); a standing
// sign's board keeps its bottom on its post and grows up and to both sides, a wall sign round its centre. The base
// keeps its size. The new size is checked like any move; the design follows the face's shape.
const HANDLE = new THREE.BoxGeometry(1, 1, 0.25), _hv = new THREE.Vector3(), _pl = new THREE.Plane(), _hit = new THREE.Vector3();
const SPOTS = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];   // round the face: corners and sides
const SIZE_STEP = 0.05;   // m: a face is sized in steps of this
let handles = null;
function handleSet() {
  if (handles) return handles;
  handles = new THREE.Group(); handles.name = 'sign-handles'; handles.visible = false;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }), rim = new THREE.MeshBasicMaterial({ color: 0x1d4ed8, depthTest: false, transparent: true });
  for (const [x, y] of SPOTS) {
    const g = new THREE.Group(); g.userData.spot = [x, y];
    const side = x === 0 || y === 0;   // a side's handle is a bar along it
    const back = new THREE.Mesh(HANDLE, rim); back.renderOrder = 21; back.scale.set(side && y ? 1.9 : 1.35, side && x ? 1.9 : 1.35, 1.35);
    const m = new THREE.Mesh(HANDLE, mat); m.renderOrder = 22; m.position.z = 0.02; m.scale.set(side && y ? 1.5 : 1, side && x ? 1.5 : 1, 1);
    m.userData.spot = back.userData.spot = [x, y];
    g.add(back, m); handles.add(g);
  }
  app.stage.scene.add(handles);
  return handles;
}
/** The handles a sign offers: a standing sign's board keeps its bottom, so none below it. */
const spotsOf = t => (INDOOR_SIGNS[t].family === 'stand' ? SPOTS.filter(([, y]) => y >= 0) : SPOTS);
/** The face of sign entry e at size { w, h } (or its own), in the world: its centre, right, normal and half sizes. */
function signFrame(e, size = null) {
  const it = size ? { ...e.it, fw: size.w, fh: size.h } : e.it, F = signFace(it), c = Math.cos(e.yaw), sn = Math.sin(e.yaw);
  const right = new THREE.Vector3(c, 0, -sn), normal = new THREE.Vector3(sn, 0, c);
  const center = new THREE.Vector3(e.x, e.y + F.y, e.z).addScaledVector(normal, (INDOOR_SIGNS[e.t].two ? 0.028 : 0.034) + 0.012);
  return { T: INDOOR_SIGNS[e.t], F, right, normal, center, hw: F.w / 2, hh: F.h / 2 };
}
function placeHandles() {
  const e = S.mode === 'furnish' && !F.type && !(F.drag && F.drag.moved) ? (F.resize ? F.resize.e : selEntry()) : null;
  if (!e || !INDOOR_SIGNS[e.t]) { if (handles) handles.visible = false; return; }
  const H = handleSet(), Fr = signFrame(e, F.resize), k = Math.max(0.05, cam.cam.position.distanceTo(Fr.center) * 0.014), on = spotsOf(e.t);
  H.visible = true;
  for (const g of H.children) {
    const [x, y] = g.userData.spot;
    g.visible = on.some(([a, b]) => a === x && b === y);
    g.position.copy(Fr.center).addScaledVector(Fr.right, x * Fr.hw).add(_hv.set(0, y * Fr.hh, 0));
    g.rotation.set(0, e.yaw, 0); g.scale.setScalar(k);
  }
}
function startResize(ev, tg) {
  if (!handles?.visible) return false;
  const e = selEntry(); if (!e || !INDOOR_SIGNS[e.t] || !ownItem(tg, e)) return false;
  const hit = new THREE.Raycaster(); hit.ray.copy(cam.rayAt(ev.clientX, ev.clientY));
  const got = hit.intersectObjects(handles.children.filter(g => g.visible), true)[0];
  if (!got) return false;
  if (cam.drag) cam.drag.kind = null;
  const F0 = signFace(e.it);
  F.resize = { e, tg, spot: got.object.userData.spot, w0: F0.w, h0: F0.h, w: F0.w, h: F0.h, keep: false, ok: true, reason: '' };
  inter.setHidden(e, true); inter.highlight(null);
  moveResize(true);
  return true;
}
function moveResize(first = false) {
  const R = F.resize, e = R.e, T = INDOOR_SIGNS[e.t];
  if (!first) {
    const Fr = signFrame(e, R);
    _pl.setFromNormalAndCoplanarPoint(Fr.normal, Fr.center);
    if (!cam.rayAt(ptr.x, ptr.y).intersectPlane(_pl, _hit)) return;
    const [sx, sy] = R.spot, step = v => Math.round(v / SIZE_STEP) * SIZE_STEP;
    let w = R.w0, h = R.h0;
    if (sx) w = Math.abs(_hit.clone().sub(Fr.center).dot(Fr.right)) * 2;   // the sides move apart evenly
    if (sy) h = T.family === 'stand' ? _hit.y - (e.y + Fr.F.y - Fr.F.h / 2) : Math.abs(_hit.y - Fr.center.y) * 2;
    if (sx && sy && R.keep) { const k = Math.max(w / R.w0, h / R.h0); w = R.w0 * k; h = R.h0 * k; }   // Shift: in its shape
    const z = signSize(e.t, step(w), step(h), R.tg.B.type === 'park');   // (a park's signs, under the sky, may be taller)
    R.w = z.w; R.h = z.h;
  }
  const it = { ...e.it, fw: R.w, fh: R.h }, why = checkItem(R.tg.B, R.tg.f, levelOf(R.tg.b, R.tg.f), it, e.id);
  R.ok = !why; R.reason = why || '';
  ghost.setType(signGeoKey(it)); ghost.show(R.tg, it, R.ok);
  app.signs?.preview?.(e.lv, e.id, { w: R.w, h: R.h });
  setStatus();
}
async function endResize(keep) {
  const R = F.resize; F.resize = null;
  ghost.hide(); inter.setHidden(R.e, false); app.signs?.preview?.(R.e.lv, R.e.id, null);
  reselect();
  if (!keep || (Math.abs(R.w - R.w0) < 1e-3 && Math.abs(R.h - R.h0) < 1e-3)) return;
  if (!R.ok) { app.toast(R.reason || 'It does not fit at that size', 'bad', 2200); return; }
  const r = await edit([{ op: 'item.sign', b: R.tg.b, f: R.tg.f, id: R.e.id, fw: R.w, fh: R.h, ...scopeOp(R.tg) }]);
  if (r) app.toast(`Resized: ${sizeText(R.w, R.h)}`, 'good', 1600);
}
/** A face's size for people: '1.2 × 0.8 m'. */
const sizeText = (w, h) => `${+w.toFixed(2)} × ${+h.toFixed(2)} m`;
async function rotateSel(dr) {
  const e = selEntry(), tg = target(); if (!e || !ownItem(tg, e)) return;
  const it = e.it, r = normA(Math.round(((it.r || 0) + dr) / STEP15) * STEP15);
  const why = checkItem(tg.B, tg.f, levelOf(tg.b, tg.f), { ...it, r }, it.id);
  if (why) { app.toast(why, 'bad', 1800); return; }
  await edit([{ op: 'item.move', b: tg.b, f: tg.f, id: e.id, x: it.x, z: it.z, r, ...scopeOp(tg) }]);
}
async function deleteSel() {
  const e = selEntry(), tg = target(); if (!e || !ownItem(tg, e)) return;
  const name = CATALOG[e.t].name.toLowerCase();
  const r = await edit([{ op: 'item.del', b: tg.b, f: tg.f, id: e.id, ...scopeOp(tg) }]);
  if (r) { F.sel = null; inter.highlight(null); renderSel(); app.toast(`Removed the ${name}`, '', 1500); }
}
async function tintSel(c) {
  const e = selEntry(), tg = target(); if (!e || !ownItem(tg, e) || !CATALOG[e.t].tint) return;
  await edit([{ op: 'item.tint', b: tg.b, f: tg.f, id: e.id, c, ...scopeOp(tg) }]);
}

// ------------------------------------------------------------------ build
function buildBuild(root) {
  const TI = app.TYPE_ICON || {}, TN = app.TYPE_NAME || {};
  const el = E.bp = root.appendChild(h(`<div id="buildp" class="toolpanel panel hidden">
  <h4><span>Build</span><span class="row"><button class="btn small addp" title="Create a new resident">➕ New resident</button><button class="btn small done" title="Done (Esc)">Done</button></span></h4>
  <div class="seg be-tabs tabs" role="tablist"><button type="button" class="btn small" data-tab="edit" role="tab">✏️ Selected building</button><button type="button" class="btn small" data-tab="new" role="tab">➕ New building</button></div>
  <div class="tedit"></div>
  <div class="tnew be hidden">
    <section class="be-sec first"><h5>Type</h5><div class="be-chips wide ntype">${BUILD_TYPES.map(t => `<span class="chip" data-v="${t}">${TI[t] || ''} ${esc(TN[t] || t)}</span>`).join('')}</div></section>
    <section class="be-sec nstyle-f"><h5>Look</h5><div class="be-chips nstyle">${BUILD_STYLES.map(s => `<span class="chip" data-v="${s}">${STYLE_NAME[s]}</span>`).join('')}</div></section>
    <section class="be-sec"><h5>Size</h5>
      <label class="be-slider nfl-f"><span>Floors</span><input type="range" class="nfl" min="1" max="48" step="1"><b class="nflv"></b></label>
      <label class="be-slider"><span>Width</span><input type="range" class="nw" min="10" max="60" step="0.5"><b class="nwv"></b></label>
      <label class="be-slider"><span>Depth</span><input type="range" class="nd" min="10" max="50" step="0.5"><b class="ndv"></b></label></section>
    <section class="be-sec"><h5>Name</h5><input class="input nname" maxlength="40" placeholder="Automatic" spellcheck="false"></section>
    <div class="hint nstat"></div>
  </div></div>`));
  el.querySelector('.done').onclick = () => app.setMode('explore');
  el.querySelector('.addp').onclick = () => (app.openCustomizer ? app.openCustomizer({ kind: 'new' }) : app.toast('Still loading…'));
  E.btabs = el.querySelector('.tabs'); E.tedit = el.querySelector('.tedit'); E.tnew = el.querySelector('.tnew');
  E.btabs.onclick = e => { const c = e.target.closest('[data-tab]'); if (c) setTab(c.dataset.tab); };
  const q = s => el.querySelector(s);
  E.ntype = q('.ntype'); E.nstyle = q('.nstyle'); E.nstyleF = q('.nstyle-f'); E.nflF = q('.nfl-f');
  E.nfl = q('.nfl'); E.nw = q('.nw'); E.nd = q('.nd'); E.nflv = q('.nflv'); E.nwv = q('.nwv'); E.ndv = q('.ndv'); E.nname = q('.nname'); E.nstat = q('.nstat');
  E.ntype.onclick = e => { const c = e.target.closest('[data-v]'); if (c) setNewType(c.dataset.v); };
  E.nstyle.onclick = e => { const c = e.target.closest('[data-v]'); if (c) { BS.form.style = c.dataset.v; syncNew(); } };
  E.nfl.oninput = () => { BS.form.floors = +E.nfl.value; syncNew(); };
  E.nw.oninput = () => { BS.form.w = +E.nw.value; syncNew(); };
  E.nd.oninput = () => { BS.form.d = +E.nd.value; syncNew(); };
  E.tedit.addEventListener('click', onEditClick);
  E.tedit.addEventListener('change', onEditChange);
  E.tedit.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input.input')) e.target.blur(); });
  setNewType('office');
}
function setTab(t) {
  BS.tab = t;
  for (const c of E.btabs.children) { c.classList.toggle('on', c.dataset.tab === t); c.setAttribute('aria-selected', String(c.dataset.tab === t)); }
  E.tedit.classList.toggle('hidden', t !== 'edit'); E.tnew.classList.toggle('hidden', t !== 'new');
  if (t !== 'new') bghost.hide();
  BS.dirty = true;
  if (t === 'edit') renderEdit();
}
function setNewType(t) {
  BS.form = { type: t, ...NEW_DEF[t] };
  syncNew();
}
function syncNew() {
  const f = BS.form, cap = floorsCap(f.type);
  f.floors = Math.max(1, Math.min(cap, f.floors | 0));
  for (const c of E.ntype.children) c.classList.toggle('on', c.dataset.v === f.type);
  for (const c of E.nstyle.children) c.classList.toggle('on', c.dataset.v === f.style);
  E.nstyleF.classList.toggle('hidden', f.type === 'park'); E.nflF.classList.toggle('hidden', cap <= 1);
  E.nfl.max = String(cap); E.nfl.value = String(f.floors); E.nw.value = String(f.w); E.nd.value = String(f.d);
  E.nflv.textContent = String(f.floors); E.nwv.textContent = f.w + ' m'; E.ndv.textContent = f.d + ' m';
  BS.dirty = true;
}
function updateBuildGhost() {
  BS.dirty = false;
  if (!ptr.in) { bghost.hide(); BS.spec = null; setBuildStatus(); return; }
  let p = cam.groundAt(ptr.x, ptr.y, GROUND_Y), spec, reason, base = 0;
  const T = app.terrain;
  if (T?.ground && beyondCity(S.world, p.x, p.z)) {
    // Beyond the city (WP4.6): on the ground under the pointer, facing the nearest road (R turns it a quarter), and
    // near a road its front snaps to just inside the lots along it.
    const hit = T.rayHit(cam.rayAt(ptr.x, ptr.y));
    if (!hit) { bghost.hide(); BS.spec = null; setBuildStatus(); return; }
    p = facingRoad(T.roadNet, hit, BS.form);
    spec = normalizeSpec({ ...BS.form, rot: p.rot + BS.rot, x: p.x, z: p.z }, S.world);
    reason = checkIslandBuilding(S.world, spec, { heightAt: (x, z) => T.heightAt(x, z), isWater: (x, z) => T.isWater(x, z), roads: T.roadNet });
    base = baseFor((x, z) => T.heightAt(x, z), spec, S.world);
  } else {
    spec = normalizeSpec({ ...BS.form, rot: BS.rot, x: p.x, z: p.z });
    reason = checkBuilding(S.world, spec);
  }
  reason = reason || lotReason(spec) || doorReasonFor(spec);
  BS.spec = spec; BS.ok = !reason; BS.reason = reason || '';
  bghost.show(spec, BS.ok, base);
  setBuildStatus();
}
/** Where a new building beyond the city goes for a pointer at p: facing the nearest road within reach ({ x, z, rot }
 *  with rot in degrees); within a few metres of the road's lots its front sits FRONT_GAP m behind the back of the road. */
const FRONT_GAP = ROAD_CLEAR + 0.5;
export function facingRoad(net, p, form) {
  const near = net ? net.nearest(p.x, p.z, 90) : null;
  if (!near) return { x: p.x, z: p.z, rot: 0 };
  const G = net.geometry(near.id), half = net.profiles[net.get(near.id).profile].outerHalf / 1e6;
  const side = near.offset >= 0 ? 1 : -1, t = pointAtS(G, near.s), nx = -t.dz * side, nz = t.dx * side;   // road → pointer
  const rot = Math.atan2(-nx, -nz) * 180 / Math.PI;      // the front (+z) faces back towards the road
  const want = half + FRONT_GAP + form.d / 2, dist = Math.abs(near.offset);
  const r = dist < want + 6 ? want : dist;               // close in: the front lines up behind the road
  return { x: near.x + nx * r, z: near.z + nz * r, rot };
}
/** The way from its door to its street or road (shared/door-access.js): the same rule the server checks — not through
 *  the building itself, another building beyond the city, or someone else's lot. ignoreIdx: the building being moved. */
export function doorReasonFor(spec, ignoreIdx = -1) {
  const L = app.lots, has = !!L?.lots?.length;
  return doorReason(S.world, spec, { net: app.terrain?.roadNet || null, lotAt: has ? (x, z) => L.at(x, z)?.id || null : null, lot: has ? L.at(spec.x, spec.z)?.id || null : null, ignoreIdx }) || '';
}
/** On a world with lots (WP4.6): the same rules the server checks — inside one lot you may build on, clear of its lines,
 *  within its zoning's floors — explained in words before you click. */
export function lotReason(spec) {
  const L = app.lots;
  if (!L || !L.lots.length) return '';
  const pts = corners(spec).map(q => [q.x, q.z]);
  const lots = pts.map(([x, z]) => L.at(x, z));
  if (lots.some(l => !l)) return 'Keep it on a lot';
  if (lots.some(l => l.id !== lots[0].id)) return 'Keep it inside one lot (it crosses a lot line)';
  const lot = lots[0];
  if (!rightsOn(lot).has('build')) return lot.holder?.kind === 'municipality' ? `Lot ${lot.id} belongs to the city` : `Lot ${lot.id} isn't yours`;
  const env = DEFAULT_ENVELOPES[lot.zoning] || ENVELOPE_FALLBACK;
  if (env.setback > 0 && corners(spec, env.setback).some(q => { const l = L.at(q.x, q.z); return !l || l.id !== lot.id; }))
    return `Keep it at least ${Math.round(env.setback / 0.3048)} ft from the lot lines`;
  if (spec.floors > env.maxFloors) return `${lot.zoning} zoning allows at most ${env.maxFloors} floors here`;
  return '';
}
function setBuildStatus() {
  const t = !BS.spec ? 'Point at (or tap) an empty spot on your lot.' : BS.ok ? '✅ It fits here — click (or tap) to place it, then adjust it with its handles' : '⚠️ ' + BS.reason + ' — you can still place it and move it with its handles';
  if (E.nstat.textContent !== t) E.nstat.textContent = t;
}
async function buildClick() {
  if (!BS.spec) return;
  // a draft with handles (ui/place-tool.js): adjust it there, then Build
  if (app.place) { app.place.newAt(BS.spec.x, BS.spec.z, BS.form.type, { ...BS.form, name: E.nname.value.trim() }); bghost.hide(); return; }
  if (!BS.ok) { app.toast(BS.reason || 'It does not fit here', 'bad', 2000); return; }
  const name = E.nname.value.trim();
  const r = await edit([{ op: 'bld.add', spec: { ...BS.spec, name } }]);
  if (!r) return;
  const res = r.results && r.results[0];
  if (!res) return;
  app.toast(`🏗️ Built ${res.name}`, 'good');
  E.nname.value = '';
  if (bld(res.b)) selectBuilding(res.b); else BS.pending = res.b;
  setTab('edit');
}
function renderEdit() {
  if (!E.tedit || S.mode !== 'build') return;
  const b = S.selB, B = b >= 0 ? bld(b) : null;
  if (!B) { E.tedit.innerHTML = '<div class="be-empty"><span>🏙️</span><p>Click a building or park in the world to edit it — or switch to <b>New building</b> to add one.</p></div>'; return; }
  if (!mayOn(B, 'build')) { E.tedit.innerHTML = `<div class="hint">${esc(whyNot(B, 'build'))}. You can change buildings on your own lots.</div>`; return; }
  const park = B.type === 'park', cap = floorsCap(B.type), TI = app.TYPE_ICON || {}, TN = app.TYPE_NAME || {};
  const sub = [TN[B.type] || B.type, park ? '' : `${B.floors} floor${B.floors > 1 ? 's' : ''}`, park ? '' : STYLE_NAME[B.style] || ''].filter(Boolean).join(' · ');
  // Laid out in sections (2026-10-06: "too messy"): who it is, its billboards (right under the name, 2026-10-23: no
  // scrolling to find them), its size and place, how it looks, and what to do with it — labels above their fields,
  // choices in even grids.
  E.tedit.innerHTML = `<div class="be">
  <div class="be-head"><span class="be-ic">${TI[B.type] || '🏢'}</span><div class="be-id"><b>${esc(B.name)}</b><small>${esc(sub)}</small></div></div>
  <section class="be-sec"><h5>${park ? 'Name' : 'Name and sign'}</h5>
    <label class="be-f"><span>Name</span><input class="input bname" maxlength="40" value="${esc(B.name)}" spellcheck="false"></label>
    ${park ? '' : `<label class="be-f"><span>Sign over the entrance</span><input class="input bsign" maxlength="28" placeholder="No sign" value="${esc(B.sign || '')}" spellcheck="false"></label>`}</section>
  ${park ? '' : `<section class="be-sec"><h5>Rooftop billboards</h5>
    <button type="button" class="btn wide" data-a="roofsigns" title="Your own billboards on the roof (never paid ads)">🪧 ${B.roofSigns?.length ? `${B.roofSigns.length} on the roof · edit them` : 'Put one up'}</button></section>`}
  <section class="be-sec"><h5>${park ? 'Place' : 'Size and place'}</h5>
    ${park ? '' : `<div class="be-row"><span class="be-lbl">Floors</span><div class="be-step"><button type="button" class="btn small" data-a="fl-" title="Remove the top floor" aria-label="Remove the top floor">−</button><input type="number" class="input bfl" min="1" max="${cap}" value="${B.floors}" aria-label="Floors"><button type="button" class="btn small" data-a="fl+" title="Add a floor" aria-label="Add a floor">+</button></div><small class="dim">up to ${cap}</small></div>`}
    <button type="button" class="btn wide" data-a="place" title="Handles on the building: move, resize, turn${park ? '' : ', floors'}">✥ Move, resize or turn</button></section>
  ${park ? '' : `<section class="be-sec"><h5>Look</h5>
    <div class="be-f"><span>Style</span><div class="be-chips">${BUILD_STYLES.map(s => `<span class="chip${B.style === s ? ' on' : ''}" data-a="style" data-v="${s}">${STYLE_NAME[s]}</span>`).join('')}</div></div>
    <div class="be-f"><span>Roof</span><div class="be-chips">${ROOF_KINDS.map(s => `<span class="chip${(B.roofKind || 'hvac') === s ? ' on' : ''}" data-a="roof" data-v="${s}">${ROOF_NAME[s]}</span>`).join('')}</div></div>
    <div class="be-f"><span>Colours</span><div class="be-colors">${COLOR_KEYS.map(([k, n]) => `<label class="be-color" title="${n}"><input type="color" data-k="${k}" value="${(B.colors && B.colors[k]) || '#888888'}"><span>${n}</span></label>`).join('')}</div></div></section>`}
  <div class="be-acts"><button type="button" class="btn" data-a="look">🔍 ${park ? 'Visit' : 'Look inside'}</button><button type="button" class="btn" data-a="furn">🛋️ Furnish</button>${B.type === 'hq' ? '' : '<button type="button" class="btn danger" data-a="del">🗑 Demolish</button>'}</div></div>`;
}
async function setFloors(n) {
  const b = S.selB, B = bld(b); if (!B) return;
  n = Math.max(1, Math.min(floorsCap(B.type), n | 0));
  if (n === B.floors) { renderEdit(); return; }
  const r = await edit([{ op: 'bld.floors', b, floors: n }]);
  if (r) app.toast(`${B.name} now has ${n} floor${n > 1 ? 's' : ''}`, 'good', 1800);
}
async function onEditClick(e) {
  const t = e.target.closest('[data-a]'); if (!t || t.tagName === 'INPUT') return;
  const b = S.selB, B = bld(b); if (!B) return;
  const a = t.dataset.a;
  if (a === 'fl-') setFloors(B.floors - 1);
  else if (a === 'fl+') setFloors(B.floors + 1);
  else if (a === 'style') await edit([{ op: 'bld.set', b, style: t.dataset.v }]);
  else if (a === 'roof') await edit([{ op: 'bld.set', b, roofKind: t.dataset.v }]);
  else if (a === 'look') app.lookInside(b);
  else if (a === 'roofsigns') import('./sign-design.js').then(m => m.editRoofSigns(app, b));
  else if (a === 'place') app.place?.edit(b);
  else if (a === 'furn') { app.lookInside(b); app.setMode('furnish'); }
  else if (a === 'del') {
    const now = performance.now();
    if (now - BS.delArm > 3500) { BS.delArm = now; t.textContent = '⚠️ Click again to demolish'; setTimeout(() => { if (t.isConnected) t.textContent = '🗑 Demolish'; }, 3500); return; }
    BS.delArm = 0;
    const name = B.name, r = await edit([{ op: 'bld.del', b }]);
    if (r) { app.toast(`${name} was demolished — its people will find new places`, '', 3200); selectBuilding(-1); }
  }
}
async function onEditChange(e) {
  const t = e.target, b = S.selB, B = bld(b); if (!B) return;
  if (t.matches('.bname')) { const v = t.value.trim(); if (v && v !== B.name) await edit([{ op: 'bld.set', b, name: v }]); }
  else if (t.matches('.bsign')) { const v = t.value.trim(); if (v !== (B.sign || '')) await edit([{ op: 'bld.set', b, sign: v }]); }
  else if (t.matches('.bfl')) setFloors(+t.value);
  else if (t.matches('input[type=color][data-k]')) await edit([{ op: 'bld.set', b, colors: { [t.dataset.k]: t.value } }]);
}
