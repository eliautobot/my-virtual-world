// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Interior walls in the Furniture panel (WP4.8, shared/walls.js; redesigned for the design review 2026-10-03: "interior
// building work like walls needs proper design tools, like snapping, handles for modifications etc, think of The Sims",
// and "more mobile friendly"). On the floor you are looking at:
//   Select — tap a wall: handles at its ends and its middle. Drag an end and every wall meeting there follows (a corner
//            moves as one); drag the middle and the wall slides sideways, the walls joined to it stretching to follow.
//            The selected wall's length and angle show beside it; make it glass or solid, split it, take it down.
//   Wall / Glass — draw: press and drag (or click its start, then its end; it carries on from there until Esc).
//   Room — drag out a rectangle: its walls go up at once (sides along the outer walls or a wall already there are left
//            out; if the room would shut something off, a doorway goes in the side facing the way in).
//   Doorway — choose its width, then click the wall where it goes.
//   Remove — click a wall, or drag across several to take them all down together.
// Points snap to wall ends, onto walls (a T-joint), to the outer walls and the quarter-metre grid; drawn walls keep to
// 15° steps (hold Shift for any angle). Lengths show as you go, in metres and feet. The ghost is green, or red with the
// reason (the same rules the server checks: nothing shut off, nothing cut through). Every change is one step to undo.
// Handles stay finger-sized on touch screens; a drag on a handle or while drawing never pans the camera.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { h, isTouch } from '../core/util.js';
import { post } from '../core/net.js';
import * as docks from './docks.js';
import { toLocal, toWorld } from '/shared/geom.js';
import { floorAt } from '/shared/constants.js';
import { normalizeWall, checkWall, checkLayout, editWalls, snapPoint, snapAngle, roomWalls, wallAt, doorway } from '/shared/walls.js';

const T = { tool: null, sel: -1, start: null, cur: null, why: '', hover: -1, busy: false, drag: null, door: 1.0, plan: null, kill: new Set() };
const handlePx = () => (isTouch() ? 34 : 16), HANDLE_SCREEN = 0.012, GHOST_H = 1.1, THICK = 0.14;
let app = null, E = {}, ghost = null, ptr = { x: 0, y: 0, moved: false, shift: false };
const MAT = {
  ok: new THREE.MeshBasicMaterial({ color: 0x5ee08f, transparent: true, opacity: 0.45, depthTest: false }),
  bad: new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.5, depthTest: false }),
  sel: new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.5, depthTest: false }),
  kill: new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.55, depthTest: false }),
  handle: new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }), ring: new THREE.MeshBasicMaterial({ color: 0x1d2a3a, depthTest: false }),
  move: new THREE.MeshBasicMaterial({ color: 0x5aa9ff, depthTest: false }),
};
const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), DISC = new THREE.CylinderGeometry(1, 1, 0.04, 24), RING = new THREE.CylinderGeometry(1.25, 1.25, 0.03, 24);

export function init(a) {
  app = a;
  const body = document.querySelector('#furnp .fbody');
  if (!body) return;
  body.insertBefore(h(`<div class="wtools"><div class="row wrap">
    <button type="button" class="btn small" data-w="select" title="Select a wall to move or change it">✋ Select</button>
    <button type="button" class="btn small" data-w="wall" title="Draw a wall: drag, or click its start then its end">🧱 Wall</button>
    <button type="button" class="btn small" data-w="glass" title="Draw a glass wall">🪟 Glass</button>
    <button type="button" class="btn small" data-w="room" title="Drag out a room">⬛ Room</button>
    <button type="button" class="btn small" data-w="door" title="Cut a doorway into a wall">🚪 Doorway</button>
    <button type="button" class="btn small" data-w="del" title="Take walls down: click one, or drag across several">🧹 Remove</button></div>
    <div class="row wrap wdoor hidden"><span class="dim">Width</span>
      <button type="button" class="btn small" data-dw="0.9">0.9 m</button><button type="button" class="btn small on" data-dw="1">1 m</button>
      <button type="button" class="btn small" data-dw="1.2">1.2 m</button><button type="button" class="btn small" data-dw="1.8">Double 1.8 m</button></div>
    <div class="row wrap wsel hidden"><span class="wlen"></span>
      <button type="button" class="btn small" data-a="kind">Make glass</button><button type="button" class="btn small" data-a="split">Split</button>
      <button type="button" class="btn small" data-a="door">Doorway</button><button type="button" class="btn small" data-a="del">🗑 Remove</button></div>
    <div class="hint wstat"></div></div>`), body.firstChild);
  E = { box: body.querySelector('.wtools'), stat: body.querySelector('.wstat'), door: body.querySelector('.wdoor'), sel: body.querySelector('.wsel'), len: body.querySelector('.wlen') };
  E.box.onclick = e => {
    const b = e.target.closest('[data-w]'); if (b) { setTool(T.tool === b.dataset.w ? null : b.dataset.w); return; }
    const d = e.target.closest('[data-dw]'); if (d) { T.door = +d.dataset.dw; for (const x of E.door.querySelectorAll('[data-dw]')) x.classList.toggle('on', x === d); return; }
    const act = e.target.closest('[data-a]'); if (act) selAction(act.dataset.a);
  };
  // a floating label for lengths beside the wall being drawn or moved
  E.tag = document.body.appendChild(h('<div class="wall-len hidden"></div>'));
  E.tag2 = document.body.appendChild(h('<div class="wall-len hidden"></div>'));
  ghost = new THREE.Group(); ghost.name = 'wall-ghost'; ghost.renderOrder = 9; a.stage.scene.add(ghost);
  app.hooks.click.unshift(onClick); app.hooks.key.unshift(onKey); app.hooks.hover.unshift(() => !!T.tool);
  app.wallTool = () => !!T.tool;   // the furniture editor leaves the pointer to a wall tool (ui/editors.js)
  const canvas = a.stage.renderer.domElement;
  canvas.addEventListener('pointermove', e => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.moved = true; ptr.shift = e.shiftKey; onDragMove(e); });
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', () => { T.drag = null; ptr.moved = true; });
  bus.on('frame', frame);
  bus.on('mode', m => { if (m !== 'furnish') setTool(null); });
  bus.on('focus', () => setTool(null));
  bus.on('level', () => { ptr.moved = true; });
}
function say(t, bad = false) { E.stat.textContent = t; E.stat.classList.toggle('bad', bad); }
/**
 * On a phone the panels fold away while you work on the floor: the wall tools then float over the bottom of the view
 * (the same buttons, the status and the selected wall's actions, a Done to finish), and come back into the panel after.
 */
const phone = () => window.matchMedia('(max-width: 760px)').matches;
function float(on) {
  if (!E.box) return;
  const want = on && phone();
  if (want && !E.box.classList.contains('floating')) {
    E.home = E.box.parentNode; E.next = E.box.nextSibling;
    document.body.appendChild(E.box); E.box.classList.add('floating', 'panel');
    if (!E.done) { E.done = E.box.insertBefore(h('<div class="row wdone"><button type="button" class="btn small" data-wd="1">Done</button></div>'), E.box.firstChild); E.done.onclick = () => setTool(null); }
    E.done.classList.remove('hidden');
    docks.open('left', false); docks.open('right', false);
  } else if (!want && E.box.classList.contains('floating')) {
    E.box.classList.remove('floating', 'panel'); E.done?.classList.add('hidden');
    if (E.home) E.home.insertBefore(E.box, E.next && E.next.parentNode === E.home ? E.next : E.home.firstChild);
  }
}
function floor() {
  const b = S.focus?.b ?? -1, B = b >= 0 ? S.world.buildings[b] : null;
  if (!B || B.gone || B.type === 'park') return null;
  const f = S.focus.f, L = S.world.levels[B.lv[f]];
  return L ? { B, b, f, L, y: floorAt(B, f) } : null;
}
function setTool(t) {
  Object.assign(T, { tool: t, start: null, freshStart: false, hover: -1, drag: null, plan: null, kill: new Set() });
  if (t !== 'select') T.sel = -1;
  ptr.moved = true; clearGhost(); tags();
  for (const b of E.box?.querySelectorAll('[data-w]') || []) b.classList.toggle('on', b.dataset.w === t);
  float(!!t);
  E.door?.classList.toggle('hidden', t !== 'door'); E.sel?.classList.add('hidden');
  if (!t) { say(''); return; }
  if (!floor()) { say('Look inside a building first (double-click it), then choose a floor.', true); return; }
  const touch = isTouch();
  say({
    select: touch ? 'Tap a wall to select it, then drag its handles.' : 'Click a wall to select it, then drag its handles: an end moves the corner, the middle slides the wall.',
    wall: touch ? 'Drag to draw a wall (or tap its start, then its end).' : 'Drag to draw a wall, or click its start then its end. Shift: any angle. Esc stops.',
    glass: touch ? 'Drag to draw a glass wall.' : 'Drag to draw a glass wall, or click its start then its end.',
    room: touch ? 'Drag out the room from one corner to the other.' : 'Drag out the room from one corner to the other (or click two corners).',
    door: touch ? 'Pick a width, then tap the wall where the doorway goes.' : 'Pick a width, then click the wall where the doorway goes.',
    del: touch ? 'Tap a wall to take it down, or drag across several.' : 'Click a wall to take it down, or drag across several.',
  }[t]);
}

// ------------------------------------------------------------------ geometry helpers
/** The pointer on the floor, in the building's frame. */
function local(Fl, cx = ptr.x, cy = ptr.y) { const p = app.cam.groundAt(cx, cy, Fl.y + 0.02); return toLocal(Fl.B, p.x, p.z); }
/** A building-frame point on screen (px), or null behind the camera. */
function screen(Fl, x, z, y = 0.1) {
  const w = toWorld(Fl.B, x, z), v = new THREE.Vector3(w.x, Fl.y + y, w.z).project(app.stage.camera), r = app.stage.renderer.domElement.getBoundingClientRect();
  return v.z < 1 ? { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height } : null;
}
/** Metres per screen pixel near a building-frame point (for touch tolerances). */
function mPerPx(Fl, x, z) { const a = screen(Fl, x, z), b = screen(Fl, x + 1, z); return a && b ? 1 / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) : 0.05; }
const feet = m => { const inch = Math.round(m / 0.0254), ft = Math.floor(inch / 12); return `${ft}′ ${inch - ft * 12}″`; };
const lenText = w => { const L = Math.hypot(w[2] - w[0], w[3] - w[1]); return `${L.toFixed(2)} m · ${feet(L)}`; };
function tags(list = []) {
  for (const [k, el] of [[0, E.tag], [1, E.tag2]]) {
    const t = list[k]; if (!el) continue;
    if (!t) { el.classList.add('hidden'); continue; }
    el.textContent = t.text; el.classList.remove('hidden'); el.classList.toggle('bad', !!t.bad);
    el.style.left = `${t.x}px`; el.style.top = `${t.y}px`;
  }
}
function tagFor(Fl, w, bad = false) { const s = screen(Fl, (w[0] + w[2]) / 2, (w[1] + w[3]) / 2, GHOST_H + 0.25); return s ? { ...s, text: lenText(w), bad } : null; }

// ------------------------------------------------------------------ the ghost: walls as translucent slabs, handles
function clearGhost() { while (ghost?.children.length) ghost.remove(ghost.children[0]); }
function slab(Fl, w, mat, hgt = GHOST_H) {
  const L = Math.hypot(w[2] - w[0], w[3] - w[1]); if (L < 0.01) return;
  const a = toWorld(Fl.B, w[0], w[1]), b = toWorld(Fl.B, w[2], w[3]), m = new THREE.Mesh(BOX, mat);
  m.position.set((a.x + b.x) / 2, Fl.y + 0.01, (a.z + b.z) / 2); m.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
  m.scale.set(L, hgt, THICK + 0.04); m.renderOrder = 9; ghost.add(m);
}
function handle(Fl, x, z, kind = 'end') {
  const w = toWorld(Fl.B, x, z), cam = app.stage.camera.position, d = Math.hypot(w.x - cam.x, Fl.y - cam.y, w.z - cam.z), s = Math.max(0.12, d * HANDLE_SCREEN) * (isTouch() ? 1.6 : 1);
  const ring = new THREE.Mesh(RING, MAT.ring), disc = new THREE.Mesh(DISC, kind === 'mid' ? MAT.move : MAT.handle);
  for (const m of [ring, disc]) { m.position.set(w.x, Fl.y + 0.06, w.z); m.scale.set(s, 1, s); m.renderOrder = 10; ghost.add(m); }
}
function showSelected(Fl, walls = Fl.L.walls, i = T.sel, bad = false) {
  const w = walls[i]; if (!w) return;
  slab(Fl, w, bad ? MAT.bad : MAT.sel, GHOST_H + 0.05);
  handle(Fl, w[0], w[1]); handle(Fl, w[2], w[3]); handle(Fl, (w[0] + w[2]) / 2, (w[1] + w[3]) / 2, 'mid');
}

// ------------------------------------------------------------------ selection and its actions
function select(i) {
  const Fl = floor(); T.sel = i; ptr.moved = true;
  const w = Fl?.L.walls?.[i];
  E.sel.classList.toggle('hidden', !w);
  if (!w) return;
  E.sel.querySelector('[data-a="kind"]').textContent = w[4] ? 'Make solid' : 'Make glass';
  const ang = ((Math.atan2(w[3] - w[1], w[2] - w[0]) * 180 / Math.PI) + 360) % 180;
  E.len.textContent = `${lenText(w)} · ${ang.toFixed(0)}°`;
  say(isTouch() ? 'Drag an end to move the corner, the blue handle to slide the wall.' : 'Drag an end to move the corner, the blue handle to slide the wall. Delete removes it, Esc lets go.');
}
function selAction(a) {
  const Fl = floor(), w = Fl?.L.walls?.[T.sel]; if (!w) return;
  if (a === 'del') { send({ op: 'wall.del', b: Fl.b, f: Fl.f, i: T.sel, ...scope() }, 'Taken down. Ctrl+Z puts it back.'); T.sel = -1; E.sel.classList.add('hidden'); clearGhost(); tags(); return; }
  if (a === 'kind') { edit(Fl, { set: [[T.sel, [w[0], w[1], w[2], w[3], w[4] ? 0 : 1]]] }, w[4] ? 'Made solid.' : 'Made glass.'); return; }
  if (a === 'split') {
    const mx = (w[0] + w[2]) / 2, mz = (w[1] + w[3]) / 2, g = v => Math.round(v * 4) / 4;
    const p = Math.abs(w[0] - w[2]) < 0.01 ? { x: w[0], z: g(mz) } : Math.abs(w[1] - w[3]) < 0.01 ? { x: g(mx), z: w[1] } : { x: mx, z: mz };
    edit(Fl, { set: [[T.sel, [w[0], w[1], p.x, p.z, w[4]]]], add: [[p.x, p.z, w[2], w[3], w[4]]] }, 'Split in two: each half moves on its own now.');
    return;
  }
  if (a === 'door') setTool('door');
}

// ------------------------------------------------------------------ pointer: handles, drawing, rooms, removing
function onDown(e) {
  if (e.button !== 0 || !T.tool || S.mode !== 'furnish' || T.busy) return;
  if (app.cam.pointers.size > 1) { T.drag = null; return; }   // two fingers: the camera's
  const Fl = floor(); if (!Fl) return;
  const take = () => { if (app.cam.drag) app.cam.drag.kind = null; };   // this drag is ours, not the camera's
  ptr.x = e.clientX; ptr.y = e.clientY;
  if (T.tool === 'select' && T.sel >= 0) {
    const w = Fl.L.walls[T.sel];
    if (w) {
      const near = (x, z) => { const s = screen(Fl, x, z, 0.06); return s ? Math.hypot(s.x - e.clientX, s.y - e.clientY) : Infinity; }, px = handlePx();
      const hits = [['a', near(w[0], w[1])], ['b', near(w[2], w[3])], ['mid', near((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)]].filter(h2 => h2[1] < px).sort((p, q) => p[1] - q[1]);
      if (hits.length) { take(); T.drag = { kind: hits[0][0], w: w.slice(), sx: e.clientX, sy: e.clientY, moved: false }; return; }
    }
  }
  if (T.tool === 'wall' || T.tool === 'glass' || T.tool === 'room') {
    take();
    const q = local(Fl), p = snapPoint(Fl.B, Fl.L, q.x, q.z);
    T.drag = { kind: 'draw', sx: e.clientX, sy: e.clientY, moved: false, fresh: !T.start };
    if (!T.start) { T.start = p; T.freshStart = true; }
    return;
  }
  if (T.tool === 'del') { take(); T.drag = { kind: 'sweep', sx: e.clientX, sy: e.clientY, moved: false }; T.kill = new Set(); sweep(Fl); }
}
function onDragMove(e) {
  const d = T.drag; if (!d) return;
  if (app.cam.pointers.size > 1) { T.drag = null; ptr.moved = true; return; }
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > (isTouch() ? 10 : 5)) d.moved = true;
  if (d.kind === 'sweep') { const Fl = floor(); if (Fl) sweep(Fl); }
}
/** Remove tool: the walls under the pointer's path so far. */
function sweep(Fl) {
  const p = local(Fl), i = wallAt(Fl.L, p.x, p.z, Math.max(0.35, handlePx() * 0.6 * mPerPx(Fl, p.x, p.z)));
  if (i >= 0) T.kill.add(i);
  ptr.moved = true;
}
async function onUp() {
  const d = T.drag; if (!d) return;
  T.drag = null; ptr.moved = true;
  const Fl = floor(); if (!Fl) return;
  if (d.kind === 'sweep') {
    if (!d.moved) return;   // a click: the click hook takes one wall down
    const del = [...T.kill]; T.kill = new Set();
    if (del.length) edit(Fl, { del }, `Took down ${del.length} wall${del.length > 1 ? 's' : ''}. Ctrl+Z puts ${del.length > 1 ? 'them' : 'it'} back.`);
    app.cam.moved = 99;   // not a click
    return;
  }
  if (d.kind === 'draw') {
    if (!d.moved) return;   // a click: the click hook handles click-click drawing
    app.cam.moved = 99;
    T.freshStart = false;
    if (T.why || !T.plan) { if (T.why) app.toast?.(T.why, 'bad', 2000); if (d.fresh) T.start = null; return; }
    commitPlan(Fl, T.tool === 'room' ? 'Room built. Ctrl+Z takes it down.' : 'Built. Drag again for the next one.');
    T.start = null;
    return;
  }
  // a handle: moved → the edit; a tap → nothing
  app.cam.moved = 99;
  if (!d.moved || !T.plan) return;
  if (T.why) { app.toast?.(T.why, 'bad', 2200); return; }
  edit(Fl, T.plan.edit, d.kind === 'mid' ? 'Moved. Ctrl+Z puts it back.' : 'Corner moved. Ctrl+Z puts it back.');
}

// ------------------------------------------------------------------ plans: what the pointer would do now
/** A corner or a wall moved: every wall end at the moved point(s) follows. */
function movePlan(Fl, d) {
  const walls = Fl.L.walls, w0 = d.w, p = local(Fl);
  let moves;   // [[from, to]]
  if (d.kind === 'mid') {
    const dx = w0[2] - w0[0], dz = w0[3] - w0[1], len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
    const m0 = local(Fl, d.sx, d.sy), off = Math.round(((p.x - m0.x) * nx + (p.z - m0.z) * nz) / 0.25) * 0.25;
    moves = [[[w0[0], w0[1]], [w0[0] + nx * off, w0[1] + nz * off]], [[w0[2], w0[3]], [w0[2] + nx * off, w0[3] + nz * off]]];
  } else {
    const from = d.kind === 'a' ? [w0[0], w0[1]] : [w0[2], w0[3]], other = d.kind === 'a' ? { x: w0[2], z: w0[3] } : { x: w0[0], z: w0[1] };
    let to = snapPoint(Fl.B, Fl.L, p.x, p.z, [from]);
    if (to.to === 'grid' && !ptr.shift) to = snapAngle(other, p);
    moves = [[from, [to.x, to.z]]];
  }
  const r2 = v => Math.round(v * 100) / 100, same = (x, z, q) => Math.abs(x - q[0]) < 0.02 && Math.abs(z - q[1]) < 0.02;
  const set = [];
  walls.forEach((w, i) => {
    let n = null;
    for (const [from, to] of moves) {
      if (same(w[0], w[1], from)) (n ||= w.slice()).splice(0, 2, r2(to[0]), r2(to[1]));
      if (same(w[2], w[3], from)) (n ||= w.slice()).splice(2, 2, r2(to[0]), r2(to[1]));
    }
    if (n) set.push([i, n]);
  });
  return { edit: { set } };
}
function planNow(Fl) {
  const p = local(Fl);
  if (T.drag && (T.drag.kind === 'a' || T.drag.kind === 'b' || T.drag.kind === 'mid')) return T.drag.moved ? movePlan(Fl, T.drag) : null;
  if ((T.tool === 'wall' || T.tool === 'glass') && T.start) {
    let end = snapPoint(Fl.B, Fl.L, p.x, p.z);
    if (end.to === 'grid' && !ptr.shift) end = snapAngle(T.start, p);
    T.cur = end;
    const w = normalizeWall([T.start.x, T.start.z, end.x, end.z, T.tool === 'glass' ? 1 : 0]);
    return w instanceof Error ? { error: w.message } : { edit: { add: [w] } };
  }
  if (T.tool === 'room' && T.start) {
    const end = snapPoint(Fl.B, Fl.L, p.x, p.z); T.cur = end;
    if (Math.abs(end.x - T.start.x) < 0.5 || Math.abs(end.z - T.start.z) < 0.5) return { error: 'Drag it out wider', corners: [T.start, end] };
    return { edit: { add: roomWalls(Fl.B, Fl.f, Fl.L, T.start, end) }, corners: [T.start, end] };
  }
  return null;
}
function frame() {
  if (!T.tool || S.mode !== 'furnish') return;
  if (!ptr.moved && !T.drag) return;
  ptr.moved = false;
  clearGhost(); tags();
  const Fl = floor(); if (!Fl) return;
  if (T.tool === 'del') {
    const p = local(Fl), i = wallAt(Fl.L, p.x, p.z, Math.max(0.35, handlePx() * 0.6 * mPerPx(Fl, p.x, p.z)));
    T.hover = i;
    for (const k of T.kill) if (Fl.L.walls[k]) slab(Fl, Fl.L.walls[k], MAT.kill);
    if (i >= 0 && !T.kill.has(i)) slab(Fl, Fl.L.walls[i], MAT.kill);
    return;
  }
  if (T.tool === 'door') {
    const p = local(Fl), i = wallAt(Fl.L, p.x, p.z, Math.max(0.5, handlePx() * 0.6 * mPerPx(Fl, p.x, p.z)));
    T.hover = i; if (i < 0) return;
    const w = Fl.L.walls[i], parts = doorway(w, p.x, p.z, T.door);
    for (const q of parts) slab(Fl, q, MAT.ok);
    if (!parts.length) slab(Fl, w, MAT.bad);
    return;
  }
  if (T.tool === 'select' && T.sel >= 0 && !Fl.L.walls[T.sel]) { select(-1); return; }
  const plan = planNow(Fl);
  T.plan = plan?.edit ? plan : null; T.why = plan?.error || '';
  if (plan?.edit) {
    const r = editWalls(Fl.L, plan.edit);
    T.why = r instanceof Error ? r.message : (plan.edit.add?.length === 1 && !plan.edit.set ? checkWall(Fl.B, Fl.f, Fl.L, plan.edit.add[0]) : checkLayout(Fl.B, Fl.f, Fl.L, r.walls, r.changed)) || '';
    const bad = !!T.why;
    if (!(r instanceof Error)) for (const i of r.changed) slab(Fl, r.walls[i], bad ? MAT.bad : MAT.ok);
    if (T.drag && (T.drag.kind === 'a' || T.drag.kind === 'b' || T.drag.kind === 'mid') && !(r instanceof Error)) {
      const k = plan.edit.set.findIndex(([i]) => i === T.sel), w = k >= 0 ? plan.edit.set[k][1] : null;
      if (w) { handle(Fl, w[0], w[1]); handle(Fl, w[2], w[3]); handle(Fl, (w[0] + w[2]) / 2, (w[1] + w[3]) / 2, 'mid'); tags([tagFor(Fl, w, bad)]); }
    } else if (T.tool === 'room' && plan.corners) {
      const [a, c] = plan.corners;
      tags([tagFor(Fl, [a.x, a.z, c.x, a.z], bad), tagFor(Fl, [c.x, a.z, c.x, c.z], bad)]);
    } else if (plan.edit.add?.length === 1) tags([tagFor(Fl, plan.edit.add[0], bad)]);
    if (bad) say(`⚠️ ${T.why}`, true);
    else if (T.tool === 'room') say(`${plan.edit.add.length} wall${plan.edit.add.length === 1 ? '' : 's'} — release to build${plan.edit.add.length < 4 ? ' (sides along walls already there are left out)' : ''}`);
    else if (T.tool === 'wall' || T.tool === 'glass') say(`${lenText(plan.edit.add[0])} — ${T.drag ? 'release' : 'click'} to build it · Esc stops`);
  } else if (T.why) say(`⚠️ ${T.why}`, true);
  // the start point and the selection
  if (T.start && (T.tool === 'wall' || T.tool === 'glass' || T.tool === 'room')) handle(Fl, T.start.x, T.start.z);
  else if (T.tool === 'wall' || T.tool === 'glass' || T.tool === 'room') { const p = local(Fl), s = snapPoint(Fl.B, Fl.L, p.x, p.z); handle(Fl, s.x, s.z); }
  if (T.tool === 'select') {
    if (T.sel >= 0 && !(T.drag && T.drag.moved)) { showSelected(Fl); const t = tagFor(Fl, Fl.L.walls[T.sel]); tags(t ? [t] : []); }
    else if (T.sel < 0) { const p = local(Fl), i = wallAt(Fl.L, p.x, p.z, Math.max(0.35, handlePx() * 0.6 * mPerPx(Fl, p.x, p.z))); if (i >= 0) slab(Fl, Fl.L.walls[i], MAT.sel, GHOST_H * 0.6); }
  }
}

// ------------------------------------------------------------------ sending
const scope = () => { const c = document.querySelector('#furnp .scope'); return c && !c.classList.contains('hidden') && c.querySelector('input').checked ? { scope: 'all' } : {}; };
function send(op, done) {
  if (T.busy) return;
  T.busy = true;
  post('/api/edit', { ops: [op] }).then(r => { if (r && r.ok === false) throw new Error(r.error); say(done); })
    .catch(e => say(e.message, true)).finally(() => { T.busy = false; ptr.moved = true; if (T.sel >= 0) select(T.sel); });
}
function edit(Fl, e, done) { send({ op: 'wall.edit', b: Fl.b, f: Fl.f, ...e, ...scope() }, done); }
function commitPlan(Fl, done) {
  const add = T.plan.edit.add;
  if (add.length === 1) send({ op: 'wall.add', b: Fl.b, f: Fl.f, wall: add[0], ...scope() }, done);
  else edit(Fl, { add }, done);
}
/** Click hook (synchronous: true when the click was this tool's). */
function onClick() {
  if (!T.tool || S.mode !== 'furnish') return false;
  const Fl = floor(); if (!Fl) return true;
  const p = local(Fl), tol = Math.max(0.35, handlePx() * 0.6 * mPerPx(Fl, p.x, p.z));
  if (T.tool === 'select') { select(wallAt(Fl.L, p.x, p.z, tol)); return true; }
  if (T.tool === 'door' || T.tool === 'del') {
    if (T.hover < 0) return true;
    send(T.tool === 'del' ? { op: 'wall.del', b: Fl.b, f: Fl.f, i: T.hover, ...scope() } : { op: 'wall.door', b: Fl.b, f: Fl.f, i: T.hover, x: p.x, z: p.z, width: T.door, ...scope() }, T.tool === 'del' ? 'Taken down. Ctrl+Z puts it back.' : 'Doorway made. Ctrl+Z undoes it.');
    return true;
  }
  // click-click drawing: the first click (its press) set the start; the next click ends the wall (or the room)
  if (!T.start) return true;
  if (T.freshStart) { T.freshStart = false; say(T.tool === 'room' ? 'Now click the opposite corner.' : 'Now click where it ends.'); return true; }
  if (!T.plan) { say(T.tool === 'room' ? 'Now click the opposite corner.' : 'Now click where it ends.'); return true; }
  if (T.why) { app.toast?.(T.why, 'bad', 2000); return true; }
  const wasRoom = T.tool === 'room';
  commitPlan(Fl, wasRoom ? 'Room built. Ctrl+Z takes it down.' : 'Built. Carry on from here, or Esc to stop.');
  T.start = wasRoom ? null : T.cur;
  return true;
}
function onKey(e) {
  if (!T.tool) return false;
  if (e.key === 'Escape') {
    if (T.start) { T.start = null; T.freshStart = false; ptr.moved = true; say('Stopped. Drag or click to start again.'); }
    else if (T.sel >= 0) { select(-1); say('Click a wall to select it.'); }
    else setTool(null);
    return true;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && T.tool === 'select' && T.sel >= 0) { selAction('del'); return true; }
  return false;
}
void normalizeWall;
