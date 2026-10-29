// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Interior modules in the Furniture panel (shared/interior-modules.js; 2026-10-27, the product owner: modules "placeable
// and resizeable", one system "for all type of inside spaces that will have unique playable or unique functions"): on the
// floor you are looking at, the kinds you may place there (a Radio Studio in a Radio Station's studio building, a kitchen
// where food is served …) and the modules already on it.
//   Place — choose a kind: its ghost (its size, its door side marked) follows the pointer, green, or red with the reason
//           (the server's own rules: shared checkModule); R turns it (the door to the next side); click to place it.
//   Select — click a module (or its name in the list): handles at its corners and sides resize it (to its kind's sizes),
//           the blue one in the middle moves it; Turn, Rename, Remove. Each change is one step to undo.
// Its own walls, doorway and pieces are laid by the server (imod.add / imod.set / imod.del). Handles are finger-sized on
// touch screens, and on a phone the tools float over the view like the wall tools.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { h, esc, isTouch } from '../core/util.js';
import { post } from '../core/net.js';
import { auth } from '../core/auth.js';
import * as docks from './docks.js';
import { toLocal, toWorld } from '/shared/geom.js';
import { floorAt } from '/shared/constants.js';
import { INTERIOR_KINDS, modsOf, normalizeModule, checkModule, sizeWords } from '/shared/interior-kinds.js';

const T = { kind: null, face: 0, sel: null, drag: null, why: '', busy: false, ghostRec: null };
const handlePx = () => (isTouch() ? 34 : 16);
let app = null, E = {}, ghost = null, ptr = { x: 0, y: 0, moved: true };
const MAT = {
  ok: new THREE.MeshBasicMaterial({ color: 0x5ee08f, transparent: true, opacity: 0.28, depthTest: false }),
  bad: new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.35, depthTest: false }),
  sel: new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.22, depthTest: false }),
  dim: new THREE.MeshBasicMaterial({ color: 0x8fb6ff, transparent: true, opacity: 0.12, depthTest: false }),
  edge: new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }),
  handle: new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }), move: new THREE.MeshBasicMaterial({ color: 0x5aa9ff, depthTest: false }),
  ring: new THREE.MeshBasicMaterial({ color: 0x1d2a3a, depthTest: false }), door: new THREE.MeshBasicMaterial({ color: 0xffd166, depthTest: false }),
};
const DISC = new THREE.CylinderGeometry(1, 1, 0.04, 24), RING = new THREE.CylinderGeometry(1.25, 1.25, 0.03, 24);
const isAdmin = () => ['owner', 'admin'].includes(auth.me?.role);

export function init(a) {
  app = a;
  const body = document.querySelector('#furnp .fbody');
  if (!body) return;
  const box = h(`<div class="mtools"><div class="row wrap mkinds"></div><div class="mlist"></div>
    <div class="row wrap msel hidden"><span class="mname"></span><button type="button" class="btn small" data-a="turn" title="Turn it: its door to the next side (R)">↻ Turn</button>
      <button type="button" class="btn small" data-a="name">✎ Rename</button><button type="button" class="btn small" data-a="relay" title="Lay it out again as it comes: an arrangement by hand is lost (Ctrl+Z puts it back)">↺ Lay out again</button><button type="button" class="btn small hidden" data-a="station" title="Its station: playlist, hosts, frequency (Settings → Radio)">📻 Station</button><button type="button" class="btn small" data-a="del">🗑 Remove</button></div>
    <div class="hint mstat"></div></div>`);
  const walls = body.querySelector('.wtools');
  body.insertBefore(box, walls ? walls.nextSibling : body.firstChild);
  E = { box, kinds: box.querySelector('.mkinds'), list: box.querySelector('.mlist'), sel: box.querySelector('.msel'), name: box.querySelector('.mname'), stat: box.querySelector('.mstat') };
  box.onclick = e => {
    const k = e.target.closest('[data-k]'); if (k) { place(T.kind === k.dataset.k ? null : k.dataset.k); return; }
    const m = e.target.closest('[data-m]'); if (m) { select(m.dataset.m); return; }
    const act = e.target.closest('[data-a]'); if (act) action(act.dataset.a);
  };
  ghost = new THREE.Group(); ghost.name = 'module-ghost'; ghost.renderOrder = 9; a.stage.scene.add(ghost);
  app.hooks.click.unshift(onClick); app.hooks.key.unshift(onKey); app.hooks.hover.unshift(() => !!T.kind || !!T.drag);
  const was = app.wallTool; app.wallTool = () => !!T.kind || !!T.drag || !!was?.();   // (the furniture editor leaves the pointer to us too)
  const canvas = a.stage.renderer.domElement;
  canvas.addEventListener('pointermove', e => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.moved = true; onMove(e); });
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', () => { T.drag = null; ptr.moved = true; });
  bus.on('frame', frame);
  bus.on('mode', () => { place(null); select(null); paint(); });
  bus.on('focus', () => { place(null); select(null); paint(); });
  for (const ev of ['level', 'world']) bus.on(ev, () => { ptr.moved = true; paint(); });
  app.modulesTool = { get state() { return { kind: T.kind, sel: T.sel, why: T.why, ghost: T.ghostRec, drag: T.drag && { k: T.drag.k, why: T.drag.why, moved: T.drag.moved } }; }, place, select };
  paint();
}
function say(t, bad = false) { if (!E.stat) return; E.stat.textContent = t; E.stat.classList.toggle('bad', bad); }
function floor() {
  const b = S.focus?.b ?? -1, B = b >= 0 ? S.world.buildings[b] : null;
  if (!B || B.gone || B.type === 'park') return null;
  const f = S.focus.f, L = S.world.levels[B.lv[f]];
  return L ? { B, b, f, L, y: floorAt(B, f) } : null;
}
/** The kinds this player may place on this floor (allowed here, and theirs to place). */
function kindsHere(Fl) { return Object.values(INTERIOR_KINDS).filter(K => (K.who !== 'admin' || isAdmin()) && !K.allowed(Fl.B, Fl.f, Fl.L)); }
function paint() {
  if (!E.box) return;
  const Fl = S.mode === 'furnish' ? floor() : null, kinds = Fl ? kindsHere(Fl) : [], mods = Fl ? modsOf(Fl.L) : [];
  E.box.classList.toggle('hidden', !Fl || (!kinds.length && !mods.length));
  if (!Fl) return;
  E.kinds.innerHTML = kinds.length ? `<span class="dim">🧩 Modules</span>${kinds.map(K => `<button type="button" class="btn small${T.kind === K.kind ? ' on' : ''}" data-k="${K.kind}" title="${esc(`${K.blurb} ${sizeWords(K)}${K.price ? ` · ${K.price} VC` : ' · free'}`)}">${K.icon} ${esc(K.label)}</button>`).join('')}` : '<span class="dim">🧩 Modules</span>';
  E.list.innerHTML = mods.map(m => `<button type="button" class="btn small ditem${T.sel === m.id ? ' on' : ''}" data-m="${esc(m.id)}">${INTERIOR_KINDS[m.kind]?.icon || '🧩'} ${esc(m.name || m.kind)} <span class="dim">${(m.x1 - m.x0).toFixed(2)} × ${(m.z1 - m.z0).toFixed(2)} m</span></button>`).join(' ');
}
const phone = () => window.matchMedia('(max-width: 760px)').matches;
function float(on) {
  const want = on && phone();
  if (want && !E.box.classList.contains('floating')) {
    E.home = E.box.parentNode; E.next = E.box.nextSibling;
    document.body.appendChild(E.box); E.box.classList.add('floating', 'panel', 'wtools');
    if (!E.done) { E.done = E.box.insertBefore(h('<div class="row wdone"><button type="button" class="btn small">Done</button></div>'), E.box.firstChild); E.done.onclick = () => { place(null); select(null); }; }
    E.done.classList.remove('hidden'); docks.open('left', false); docks.open('right', false);
  } else if (!want && E.box.classList.contains('floating')) {
    E.box.classList.remove('floating', 'panel', 'wtools'); E.done?.classList.add('hidden');
    if (E.home) E.home.insertBefore(E.box, E.next && E.next.parentNode === E.home ? E.next : E.home.firstChild);
  }
}
function place(kind) {
  T.kind = kind; T.face = 0; T.ghostRec = null; T.why = ''; if (kind) T.sel = null;
  ptr.moved = true; clear(); paint(); float(!!kind || !!T.sel);
  E.sel?.classList.add('hidden');
  if (!kind) { say(''); return; }
  const K = INTERIOR_KINDS[kind];
  say(`${K.label}: ${sizeWords(K)}. ${isTouch() ? 'Tap where it goes' : 'Click where it goes, R turns its door'}.`);
}
function select(id) {
  const Fl = floor(), m = id && Fl ? modsOf(Fl.L).find(x => x.id === id) : null;
  T.sel = m ? m.id : null; if (m) T.kind = null;
  ptr.moved = true; clear(); paint(); float(!!m);
  E.sel?.classList.toggle('hidden', !m);
  if (!m) return;
  const K = INTERIOR_KINDS[m.kind];
  E.name.textContent = `${K?.icon || '🧩'} ${m.name}`;
  E.sel.querySelector('[data-a="station"]').classList.toggle('hidden', m.kind !== 'studio' || !isAdmin());
  say(isTouch() ? 'Drag a white handle to resize it, the blue one to move it.' : 'Drag a white handle to resize it, the blue one to move it. R turns it, Delete removes it, Esc lets go.');
}

// ------------------------------------------------------------------ geometry
function local(Fl, cx = ptr.x, cy = ptr.y) { const p = app.cam.groundAt(cx, cy, Fl.y + 0.02); return toLocal(Fl.B, p.x, p.z); }
function screen(Fl, x, z, y = 0.1) {
  const w = toWorld(Fl.B, x, z), v = new THREE.Vector3(w.x, Fl.y + y, w.z).project(app.stage.camera), r = app.stage.renderer.domElement.getBoundingClientRect();
  return v.z < 1 ? { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height } : null;
}
const q = v => Math.round(v * 4) / 4;
/** A kind's first size, turned to its face (w across x, d across z). */
function firstSize(K, face) {
  const s = K.size.start ? [...K.size.start] : K.size.sizes?.[0] ? [K.size.sizes[0].w, K.size.sizes[0].d] : [Math.max(K.size.min[0], Math.min(K.size.max[0], 5)), Math.max(K.size.min[1], Math.min(K.size.max[1], 4))];
  return face % 2 ? [s[1], s[0]] : s;
}
function clear() { while (ghost?.children.length) ghost.remove(ghost.children[0]); }
function rect(Fl, r, mat) {
  const pts = [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1], [r.x0, r.z0]].map(([x, z]) => { const w = toWorld(Fl.B, x, z); return new THREE.Vector3(w.x, Fl.y + 0.05, w.z); });
  const g = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]].map(v => v.clone().setY(Fl.y + 0.03)));   // (its corners in the world: the building's turn as it is)
  const m = new THREE.Mesh(g, mat); m.material.side = THREE.DoubleSide; m.renderOrder = 9; ghost.add(m);
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), MAT.edge); l.renderOrder = 10; ghost.add(l);
}
function dot(Fl, x, z, mat, s0 = 1) {
  const w = toWorld(Fl.B, x, z), cam = app.stage.camera.position, d = Math.hypot(w.x - cam.x, Fl.y - cam.y, w.z - cam.z), s = Math.max(0.12, d * 0.012) * (isTouch() ? 1.6 : 1) * s0;
  const ring = new THREE.Mesh(RING, MAT.ring), disc = new THREE.Mesh(DISC, mat);
  for (const m of [ring, disc]) { m.position.set(w.x, Fl.y + 0.07, w.z); m.scale.set(s, 1, s); m.renderOrder = 11; ghost.add(m); }
}
/** Its door side, marked with a small yellow tab in the middle of that side. */
function doorMark(Fl, r) {
  const [x, z] = [[(r.x0 + r.x1) / 2, r.z1], [r.x1, (r.z0 + r.z1) / 2], [(r.x0 + r.x1) / 2, r.z0], [r.x0, (r.z0 + r.z1) / 2]][r.face || 0];
  dot(Fl, x, z, MAT.door, 0.7);
}
const handlesOf = r => {
  const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
  return [['x0z0', r.x0, r.z0], ['x1z0', r.x1, r.z0], ['x1z1', r.x1, r.z1], ['x0z1', r.x0, r.z1], ['z0', mx, r.z0], ['x1', r.x1, mz], ['z1', mx, r.z1], ['x0', r.x0, mz], ['move', mx, mz]];
};

// ------------------------------------------------------------------ each frame: the ghost, the outlines, the handles
function frame() {
  if (!ptr.moved || !ghost) return;
  ptr.moved = false; clear();
  const Fl = S.mode === 'furnish' ? floor() : null; if (!Fl) return;
  for (const m of modsOf(Fl.L)) if (m.id !== T.sel) rect(Fl, m, MAT.dim);
  if (T.kind) {
    const K = INTERIOR_KINDS[T.kind], p = local(Fl), [w, d] = firstSize(K, T.face);
    const rec = normalizeModule({ kind: T.kind, x0: q(p.x) - w / 2, z0: q(p.z) - d / 2, x1: q(p.x) + w / 2, z1: q(p.z) + d / 2, face: T.face });
    if (rec instanceof Error) return;
    T.why = checkModule(Fl.B, Fl.f, Fl.L, rec) || ''; T.ghostRec = rec;
    rect(Fl, rec, T.why ? MAT.bad : MAT.ok); doorMark(Fl, rec);
    say(T.why ? `⚠️ ${T.why}` : `${K.label} · ${(rec.x1 - rec.x0).toFixed(2)} × ${(rec.z1 - rec.z0).toFixed(2)} m · ${isTouch() ? 'tap' : 'click'} to place it${isTouch() ? '' : ', R turns it'}.`, !!T.why);
    return;
  }
  const m = T.sel && modsOf(Fl.L).find(x => x.id === T.sel); if (!m) return;
  const r = T.drag?.rec || m;
  rect(Fl, r, T.drag?.why ? MAT.bad : MAT.sel); doorMark(Fl, r);
  for (const [k, x, z] of handlesOf(r)) dot(Fl, x, z, k === 'move' ? MAT.move : MAT.handle);
  if (T.drag) say(T.drag.why ? `⚠️ ${T.drag.why}` : `${(r.x1 - r.x0).toFixed(2)} × ${(r.z1 - r.z0).toFixed(2)} m · let go to keep it`, !!T.drag.why);
}

// ------------------------------------------------------------------ pointer
function onDown(e) {
  if (e.button !== 0 || S.mode !== 'furnish' || T.busy || !T.sel || T.kind) return;
  if (app.cam.pointers.size > 1) { T.drag = null; return; }
  const Fl = floor(), m = Fl && modsOf(Fl.L).find(x => x.id === T.sel); if (!m) return;
  const near = (x, z) => { const s = screen(Fl, x, z, 0.07); return s ? Math.hypot(s.x - e.clientX, s.y - e.clientY) : Infinity; };
  const hit = handlesOf(m).map(([k, x, z]) => [k, near(x, z)]).filter(x => x[1] < handlePx()).sort((a, b) => a[1] - b[1])[0];
  if (!hit) return;
  if (app.cam.drag) app.cam.drag.kind = null;   // this drag is ours, not the camera's
  const p = local(Fl);
  T.drag = { k: hit[0], m: { ...m }, p0: p, rec: m, why: '', moved: false, sx: e.clientX, sy: e.clientY };
}
function onMove(e) {
  const d = T.drag; if (!d) return;
  if (app.cam.pointers.size > 1) { T.drag = null; ptr.moved = true; return; }
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > (isTouch() ? 10 : 5)) d.moved = true;
  const Fl = floor(); if (!Fl) return;
  const p = local(Fl), dx = q(p.x - d.p0.x), dz = q(p.z - d.p0.z), m = d.m, r = { ...m };
  if (d.k === 'move') { r.x0 = m.x0 + dx; r.x1 = m.x1 + dx; r.z0 = m.z0 + dz; r.z1 = m.z1 + dz; }
  else {
    if (d.k.includes('x0')) r.x0 = m.x0 + dx; if (d.k.includes('x1')) r.x1 = m.x1 + dx;
    if (d.k.includes('z0')) r.z0 = m.z0 + dz; if (d.k.includes('z1')) r.z1 = m.z1 + dz;
  }
  const rec = normalizeModule(r, m);
  if (rec instanceof Error) return;
  rec.id = m.id;
  if (d.k !== 'move') {   // (a resize keeps the side not dragged where it was: normalizeModule centred the snapped size)
    const w = rec.x1 - rec.x0, dd = rec.z1 - rec.z0;
    if (d.k.includes('x1')) { rec.x0 = m.x0; rec.x1 = m.x0 + w; } else if (d.k.includes('x0')) { rec.x1 = m.x1; rec.x0 = m.x1 - w; }
    if (d.k.includes('z1')) { rec.z0 = m.z0; rec.z1 = m.z0 + dd; } else if (d.k.includes('z0')) { rec.z1 = m.z1; rec.z0 = m.z1 - dd; }
  }
  d.rec = rec; d.why = checkModule(Fl.B, Fl.f, Fl.L, rec, m.id) || '';
  ptr.moved = true;
}
function onUp() {
  const d = T.drag; if (!d) return;
  T.drag = null; ptr.moved = true;
  if (!d.moved) return;
  app.cam.moved = 99;   // not a click
  const Fl = floor(); if (!Fl) return;
  if (d.why) { app.toast?.(d.why, 'bad', 2400); return; }
  const r = d.rec;
  send({ op: 'imod.set', b: Fl.b, f: Fl.f, id: d.m.id, mod: { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 } }, d.k === 'move' ? 'Moved. Ctrl+Z puts it back.' : 'Resized. Ctrl+Z puts it back.');
}
function onClick() {
  if (S.mode !== 'furnish') return false;
  const Fl = floor(); if (!Fl) return false;
  if (T.kind) {
    if (T.why || !T.ghostRec) { if (T.why) app.toast?.(T.why, 'bad', 2400); return true; }
    const r = T.ghostRec, K = INTERIOR_KINDS[T.kind];
    send({ op: 'imod.add', b: Fl.b, f: Fl.f, mod: { kind: r.kind, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, face: r.face } }, `${K.label} placed. Ctrl+Z takes it away.`, res => { place(null); if (res?.id) select(res.id); });
    return true;
  }
  // a click on a module's outline (within half a metre of its edge) selects it; inside, the click is the furniture's
  const p = local(Fl), edge = x => p.x > x.x0 - 0.5 && p.x < x.x1 + 0.5 && p.z > x.z0 - 0.5 && p.z < x.z1 + 0.5 && Math.min(Math.abs(p.x - x.x0), Math.abs(p.x - x.x1), Math.abs(p.z - x.z0), Math.abs(p.z - x.z1)) < 0.5;
  const m = modsOf(Fl.L).find(edge);
  if (m) { select(m.id); return true; }
  if (T.sel) select(null);
  return false;
}
function onKey(e) {
  if (S.mode !== 'furnish' || (!T.kind && !T.sel)) return false;
  if (e.key === 'Escape') { if (T.kind) place(null); else select(null); return true; }
  if (e.key === 'r' || e.key === 'R') { if (T.kind) { T.face = (T.face + 1) % 4; ptr.moved = true; } else action('turn'); return true; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && T.sel) { action('del'); return true; }
  return false;
}
function action(a) {
  const Fl = floor(), m = Fl && T.sel && modsOf(Fl.L).find(x => x.id === T.sel); if (!m) return;
  if (a === 'station') { const st = (app.radio?.all || []).find(x => x.studio && x.studio.b === Fl.b && x.studio.f === Fl.f && x.studio.room === m.id); if (st) import('./station-panel.js').then(M => M.openStation(app, st.id)); else app.toast?.('Its station goes on the air in a few seconds', 'info', 2400); return; }   // (its own window: ui/station-panel.js)
  if (a === 'turn') send({ op: 'imod.set', b: Fl.b, f: Fl.f, id: m.id, mod: { face: (m.face + 1) % 4 } }, 'Turned: its door is on the next side.');
  if (a === 'relay' && confirm(`Lay ${m.name} out again as it comes? Your own arrangement of it is lost. (Ctrl+Z puts it back.)`)) send({ op: 'imod.set', b: Fl.b, f: Fl.f, id: m.id, reset: true, mod: {} }, 'Laid out again. Ctrl+Z puts your arrangement back.');
  if (a === 'name') { const n = prompt('Its name', m.name || ''); if (n != null && n.trim()) send({ op: 'imod.set', b: Fl.b, f: Fl.f, id: m.id, mod: { name: n.trim() } }, 'Renamed.'); }
  if (a === 'del' && confirm(`Remove ${m.name}? Its walls and pieces go with it${m.kind === 'studio' ? ', and its station goes off the air' : ''}. (Ctrl+Z puts it back.)`)) {
    send({ op: 'imod.del', b: Fl.b, f: Fl.f, id: m.id }, 'Removed. Ctrl+Z puts it back.', () => select(null));
  }
}
function send(op, done, then) {
  if (T.busy) return;
  T.busy = true;
  return post('/api/edit', { ops: [op] }).then(r => {
    if (r && r.ok === false && r.code === 'custom' && !op.reset) {   // arranged by hand: a resize or a turn lays it out again, asked first
      if (!confirm(`${r.error}.\n\nGo ahead?`)) { say('Left as it is'); return; }
      T.busy = false; return send({ ...op, reset: true }, done, then);
    }
    if (r && r.ok === false) throw new Error(r.error); say(done); then?.(r?.results?.[0]); })
    .catch(e => say(e.message, true)).finally(() => { T.busy = false; ptr.moved = true; paint(); });
}
