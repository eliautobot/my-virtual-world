// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Roads section of the edit dock (WP4.4, wp4-world-spec.md §3, DECISIONS E25): administrators draw roads beyond the
// city — straight legs joined by curves — of a chosen road type, snapping to existing roads, road ends and the city's
// street ends; they select a road to rename it, change its type, move its points or remove it. Every change goes
// through /api/edit (road.set / road.del): the server checks it and says why in words, journals it (undo/redo) and
// sends it to everyone. Roads are selected and changed only with Edit roads switched on (handles sized for fingers and kept
// the same size on screen; drag a '+' between two points to add one, tap a point to remove it). With a road selected,
// administrators make lots beside it in the Lots section (ui/lot-tools.js; all along it, both sides, to start with).
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { h, esc, isTouch } from '../core/util.js';
import { auth } from '../core/auth.js';
import { post } from '../core/net.js';
import { RoadNetwork, alignmentGeometry, checkAlignment, samplePolyline, pointAt, project, DEFAULT_ROAD_PROFILES } from '/shared/roads.js';
import { mToUm, formatFt } from '/shared/units.js';
import { makeGrid } from '/shared/city.js';
import { gridLayout, gridLevel } from '/shared/road-grid.js';
import { cityProfileFor, cityRoads } from '/shared/city-roads.js';
import { normalizeStation, checkStation, KIOSK } from '/shared/stations.js';

const TYPES = ['country', 'two-lane', 'two-lane-shoulder', 'avenue-4'];
const CURVE = { country: 120, 'two-lane': 45, 'two-lane-shoulder': 60, 'avenue-4': 45 };   // default curve radius (m) at a bend
const SNAP = 14;            // m: snapping reach to roads, road ends and the city's street ends
const handlePx = () => (isTouch() ? 34 : 18);   // px: grabbing a point handle (a fingertip on touch screens)
const HANDLE_SCREEN = 0.014;                       // a handle's size against its distance from the camera
const FT = 0.3048;
const R = { tool: null, edit: false, profile: 'country', pts: [], cursor: null, sel: null, selPt: -1, drag: null, lastClick: { t: 0, x: 0, y: 0 }, busy: false, snapAng: localStorage.getItem('mvw.roadSnap') === '1' };
// The grid layout tool (2026-10-13, the product owner: "lay out the entire roadway system in a grid … leaving space for lots"):
// roads each way, the lots between them, the lot size, a turn; it follows the pointer until clicked in place.
// Its roads are flat, all at one level, and the land across the whole grid is levelled to it (2026-10-14: "make sure the
// terrain is adjusted so that the roadways are flat" — shared/island-build.js gridPads); it can make the lots too.
const GRID = { ns: 4, ew: 4, lotsX: 3, lotsZ: 2, lotFt: 100, rot: 0, name: 'Grid', lots: true, zoning: 'residential', at: null, pinned: null, why: null, plan: null };
const GRID_ZONES = ['residential', 'mixed', 'commercial', 'industrial', 'civic', 'agricultural'];
const PRESETS = { 'Small town': [3, 3, 3, 2], 'Town': [5, 4, 3, 2], 'City': [8, 7, 3, 2], 'Big city': [14, 12, 3, 2], 'Farmland': [4, 4, 6, 6] };
let app = null, cam = null, E = {}, net = null, ghost = null, ptr = { x: 0, y: 0, moved: false, shift: false };

export function init(a) {
  app = a; cam = a.cam;
  const slot = a.docks && a.docks.slot('l:roads');
  if (!slot) return;
  slot.appendChild(h(`<div class="roads">
    <p class="hint">Roads beyond the city: straight legs with curves at the bends. Lengths and radii in feet; the server checks every road.</p>
    <div class="row types">${TYPES.map(t => `<button type="button" class="btn sm rtype" data-t="${t}" title="${esc(DEFAULT_ROAD_PROFILES[t].description || '')}">${esc(DEFAULT_ROAD_PROFILES[t].label || t)}</button>`).join(' ')}</div>
    <div class="row"><button type="button" class="btn draw">✏️ Draw a road</button> <button type="button" class="btn redit" title="Select roads to move their points, change or remove them">🛠 Edit roads</button> <button type="button" class="btn rgrid" title="Lay out a whole grid of roads with room for lots between them">🏘️ Grid layout</button> <button type="button" class="btn undo hidden">↶ Undo point</button> <button type="button" class="btn finish hidden">✔ Finish</button> <button type="button" class="btn cancel hidden">✕ Cancel</button></div>
    <div class="row"><button type="button" class="btn sm rsnap" title="Keep every leg at 45° or 90° — to the map and to the leg before it (hold Shift to switch it for a moment)">📐 Snap 45°/90°</button></div>
    <div class="gridbox hidden">
      <p class="hint">A grid of roads with room for lots between them. Pick a size, then move it over the map and click to put it there; ✔ Build makes it (one undo).</p>
      <div class="row gpresets">${Object.keys(PRESETS).map(k => `<button type="button" class="btn sm gpre" data-p="${esc(k)}">${esc(k)}</button>`).join(' ')}</div>
      <label class="row">Roads running north–south <input class="gin" data-k="ns" type="number" min="2" max="25" step="1"></label>
      <label class="row">Roads running east–west <input class="gin" data-k="ew" type="number" min="2" max="25" step="1"></label>
      <label class="row">Lots between roads, east–west <input class="gin" data-k="lotsX" type="number" min="1" max="20" step="1"></label>
      <label class="row">Lots between roads, north–south <input class="gin" data-k="lotsZ" type="number" min="1" max="20" step="1"></label>
      <label class="row">Lot size (ft) <input class="gin" data-k="lotFt" type="number" min="30" max="400" step="10"></label>
      <label class="row">Turn (°) <input class="gin" data-k="rot" type="number" min="-180" max="180" step="5"> <button type="button" class="btn sm grot" data-d="-15">↺</button> <button type="button" class="btn sm grot" data-d="15">↻</button></label>
      <label class="row">Name the roads <input class="gname" maxlength="40"></label>
      <label class="row"><input type="checkbox" class="glots"> Make the lots too, zoned <select class="gzone">${GRID_ZONES.map(z => `<option value="${z}">${z[0].toUpperCase() + z.slice(1)}</option>`).join('')}</select></label>
      <p class="hint gsum"></p>
      <div class="row"><button type="button" class="btn gbuild" disabled>✔ Build the grid</button> <button type="button" class="btn gcancel">✕ Close</button></div>
    </div>
    <label class="row namerow hidden">Name <input class="rname" maxlength="60" value="New Road"></label>
    <div class="row"><button type="button" class="btn placest">🚇 Place a subway station</button></div>
    <div class="stlist"></div>
    <div class="inspector hidden"></div>
    <p class="hint status"></p></div>`));
  E = { root: slot.querySelector('.roads'), types: [...slot.querySelectorAll('.rtype')], draw: slot.querySelector('.draw'), finish: slot.querySelector('.finish'), cancel: slot.querySelector('.cancel'),
    namerow: slot.querySelector('.namerow'), name: slot.querySelector('.rname'), insp: slot.querySelector('.inspector'), status: slot.querySelector('.status'),
    placest: slot.querySelector('.placest'), stlist: slot.querySelector('.stlist'), edit: slot.querySelector('.redit'), undo: slot.querySelector('.undo'),
    grid: slot.querySelector('.rgrid'), snap: slot.querySelector('.rsnap'), gbox: slot.querySelector('.gridbox'), gsum: slot.querySelector('.gsum'), gbuild: slot.querySelector('.gbuild'), gname: slot.querySelector('.gname') };
  E.snap.onclick = () => { R.snapAng = !R.snapAng; localStorage.setItem('mvw.roadSnap', R.snapAng ? '1' : '0'); E.snap.classList.toggle('on', R.snapAng); if (R.tool === 'draw') { ptr.moved = true; } };
  E.snap.classList.toggle('on', R.snapAng);
  E.grid.onclick = () => (R.tool === 'grid' ? stopGrid() : startGrid());
  for (const inp of slot.querySelectorAll('.gin')) { inp.value = GRID[inp.dataset.k]; inp.oninput = () => { const v = Number(inp.value); if (Number.isFinite(v)) { GRID[inp.dataset.k] = v; gridChanged(); } }; }
  for (const b of slot.querySelectorAll('.gpre')) b.onclick = () => { const [ns, ew, lx, lz] = PRESETS[b.dataset.p]; Object.assign(GRID, { ns, ew, lotsX: lx, lotsZ: lz }); syncGridInputs(); gridChanged(); };
  for (const b of slot.querySelectorAll('.grot')) b.onclick = () => turnGrid(Number(b.dataset.d));
  E.gname.value = GRID.name; E.gname.oninput = () => { GRID.name = E.gname.value; };
  { const c = slot.querySelector('.glots'), z = slot.querySelector('.gzone'); c.checked = GRID.lots; z.value = GRID.zoning; c.onchange = () => { GRID.lots = c.checked; gridChanged(); }; z.onchange = () => { GRID.zoning = z.value; }; }
  E.gbuild.onclick = () => buildGrid();
  slot.querySelector('.gcancel').onclick = () => stopGrid();
  E.edit.onclick = () => setEdit(!R.edit);
  E.undo.onclick = () => { R.pts.pop(); drawGhost(); };
  E.placest.onclick = () => (R.tool === 'station' ? stopDraw('') : startStation());
  bus.on('stations', listStations); listStations();
  for (const b of E.types) b.onclick = () => setProfile(b.dataset.t);
  E.draw.onclick = () => startDraw();
  E.finish.onclick = () => finishDraw();
  E.cancel.onclick = () => stopDraw('');
  setProfile(R.profile);
  ghost = new THREE.Group(); ghost.name = 'road-ghost'; ghost.renderOrder = 5; a.stage.scene.add(ghost);
  // Road drawing comes before the building tools (which also listen in Build mode) while it is active.
  app.hooks.click.unshift(onClick); app.hooks.key.unshift(onKey); app.hooks.hover.unshift(() => R.tool === 'draw' || R.tool === 'station' || R.tool === 'grid' || R.edit || !!R.drag);
  app.roadsActive = () => R.tool === 'draw' || R.tool === 'station' || R.tool === 'grid' || R.edit || !!R.drag;
  const canvas = a.stage.renderer.domElement;
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', e => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.shift = e.shiftKey; ptr.moved = true; });
  window.addEventListener('keydown', e => { if (e.key === 'Shift' && !ptr.shift) { ptr.shift = true; ptr.moved = true; } });
  window.addEventListener('keyup', e => { if (e.key === 'Shift') { ptr.shift = false; ptr.moved = true; } });
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onUp);
  bus.on('roads', () => { net = null; if (R.sel && !(S.world.roads || []).some(r => r.id === R.sel)) select(null); else if (R.sel) select(R.sel); });
  bus.on('mode', m => { if (m === 'play' || m === 'furnish') { stopDraw(''); stopGrid(); setEdit(false); } });
  bus.on('frame', frame);
}
const can = () => !!auth.account && auth.can('world.edit') && !!S.world.terrain;
function network() { if (!net) { net = new RoadNetwork(); for (const r of S.world.roads || []) { try { net.set(r); } catch { /* skipped */ } } } return net; }
function say(text, bad = false) { E.status.textContent = text; E.status.classList.toggle('bad', bad); }
function setProfile(t) {
  R.profile = t;
  for (const b of E.types) b.classList.toggle('on', b.dataset.t === t);
  if (R.tool === 'draw') drawGhost();
  if (R.tool === 'grid') gridChanged();
}

// ------------------------------------------------------------------ the ground under the pointer
/** Where a screen point's ray meets the island's ground (or the sea surface), or null. */
function groundAt(cx, cy) {
  const p = app.terrain?.rayHit(cam.rayAt(cx, cy));
  return p ? { x: p.x, z: p.z } : null;
}
/** Road ends a point may snap to: the city's street ends on its edge (on a widened city the centres of its edge
 *  junctions, shared/city-roads.js) and the ends of the roads beyond it. */
function endCands(skipId) {
  const g = makeGrid(S.world.grid), cands = [], wide = cityProfileFor(S.world.grid) === 'avenue-4';
  const [z0, z1, x0, x1] = wide ? [g.Z[0], g.Z.at(-1), g.X[0], g.X.at(-1)] : [g.minZ, g.maxZ, g.minX, g.maxX];
  for (const x of g.X) cands.push({ x, z: z0 }, { x, z: z1 });
  for (const z of g.Z) cands.push({ x: x0, z }, { x: x1, z });
  const N = network();
  for (const r of N.all()) { if (r.id === skipId || r.closed) continue; const G = N.geometry(r.id); cands.push(pointAt(G, 0, {}), pointAt(G, G.length, {})); }
  return cands;
}
/** Whether the 45°/90° snap applies now: the switch, turned over while Shift is held. */
const angleSnapOn = (shift = ptr.shift) => R.snapAng !== !!shift;
/**
 * Snap a ground point: the city's street ends on its edge, road ends, a point on a road's centreline, else whole feet.
 * guide: { from, prev } — with the angle snap on, the leg from `from` keeps to a multiple of 45° (to the map, or to the
 * leg prev → from), a whole number of feet long, and stops on a road or a road end it reaches along that line
 * (2026-10-13, the product owner: "a snap tool to activate snapping at 45 and 90 degrees").
 */
function snap(p, skipId = null, guide = null) {
  if (!p) return null;
  if (guide?.from && angleSnapOn()) { const q = angleSnap(p, guide.from, guide.prev, skipId); if (q) return q; }
  const cands = endCands(skipId), N = network();
  let best = null, bd = SNAP;
  for (const c of cands) { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < bd) { bd = d; best = { x: c.x, z: c.z, snapped: 'end' }; } }
  if (best) return best;
  let near = null;
  for (const id of N.candidates({ x0: p.x, z0: p.z, x1: p.x, z1: p.z }, SNAP)) {
    if (id === skipId) continue;
    const q = project(N.geometry(id), p.x, p.z);
    if (q && q.dist < SNAP && (!near || q.dist < near.dist)) near = q;
  }
  if (near) return { x: near.x, z: near.z, snapped: 'road' };
  const f = v => Math.round(v / FT) * FT;
  return { x: f(p.x), z: f(p.z) };
}
/** The point along the nearest 45° line from `from` (to the map or to the leg prev → from) — on a road end or a road's
 *  centreline when the line meets one near the pointer, else at a whole number of feet. */
function angleSnap(p, from, prev, skipId) {
  const dx = p.x - from.x, dz = p.z - from.z, L = Math.hypot(dx, dz);
  if (L < 1) return null;
  const want = Math.atan2(dz, dx), base = [0], step = Math.PI / 4, wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  if (prev && Math.hypot(from.x - prev.x, from.z - prev.z) > 0.5) base.push(Math.atan2(from.z - prev.z, from.x - prev.x));
  let ang = want, bd = Infinity, rel = false;
  base.forEach((b0, bi) => { for (let k = 0; k < 8; k++) { const a = b0 + k * step, d = Math.abs(wrap(a - want)); if (d < bd - 1e-9) { bd = d; ang = a; rel = bi > 0; } } });
  const ux = Math.cos(ang), uz = Math.sin(ang), along = dx * ux + dz * uz;
  if (along < 1) return null;
  // a road end on the line near the pointer
  let hit = null;
  for (const c of endCands(skipId)) {
    const t = (c.x - from.x) * ux + (c.z - from.z) * uz, off = Math.abs(-(c.x - from.x) * uz + (c.z - from.z) * ux);
    if (t > 1 && off < 1.5 && Math.abs(t - along) < SNAP && (!hit || Math.abs(t - along) < Math.abs(hit.t - along))) hit = { t, x: c.x, z: c.z, snapped: 'end' };
  }
  // else where the line crosses a road's centreline near the pointer (a T junction square to it)
  if (!hit) {
    const N = network(), t0 = Math.max(1, along - SNAP), t1 = along + SNAP, P = t => ({ x: from.x + ux * t, z: from.z + uz * t });
    const a = P(t0), b = P(t1);
    for (const id of N.candidates({ x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) }, 2)) {
      if (id === skipId) continue;
      const G = N.geometry(id), side = t => { const q = P(t), pr = project(G, q.x, q.z); if (!pr) return null; const tg = pointAt(G, pr.s, {}); return pr.dist < SNAP * 2 ? Math.sign((q.x - pr.x) * -tg.dz + (q.z - pr.z) * tg.dx) * pr.dist : null; };
      for (let t = t0; t < t1; t += 1) {
        const s0 = side(t), s1 = side(Math.min(t1, t + 1));
        if (s0 === null || s1 === null || s0 * s1 > 0) continue;
        let lo = t, hi = Math.min(t1, t + 1);
        for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2, sm = side(m); if (sm === null || sm * s0 > 0) lo = m; else hi = m; }
        const tt = (lo + hi) / 2;
        if (!hit || Math.abs(tt - along) < Math.abs(hit.t - along)) hit = { t: tt, ...P(tt), snapped: 'road' };
        break;
      }
    }
  }
  // what the status line says: the compass heading (north is −z), and the turn from the leg before
  const heading = Math.round((Math.atan2(ux, -uz) * 180 / Math.PI + 360) % 360) % 360, turn = base.length > 1 ? Math.round(Math.abs(wrap(ang - base[1])) * 180 / Math.PI) : null;
  if (hit) return { x: hit.x, z: hit.z, snapped: hit.snapped, heading, turn };
  const t = Math.max(FT, Math.round(along / FT) * FT);
  return { x: from.x + ux * t, z: from.z + uz * t, snapped: 'angle', heading, turn };
}
/** A road record from points (m): curves at the bends, each as large as fits (shrunk until the alignment is valid). */
function record(pts, base = {}) {
  const P = pts.map((p, i) => ({ x: mToUm(p.x), z: mToUm(p.z), r: i > 0 && i < pts.length - 1 ? mToUm(p.r ?? CURVE[R.profile] ?? 60) : 0 }));
  const rec = { id: base.id || 'draft', profile: base.profile || R.profile, name: base.name ?? 'New Road', closed: false, pts: P };
  for (let k = 0; k < 12; k++) {
    const probs = checkAlignment(rec);
    if (!probs.length) break;
    let fixed = false;
    for (const pr of probs) {
      const i = Number.isInteger(pr.point) ? pr.point : -1;
      if (i > 0 && i < P.length - 1 && P[i].r > 0) { P[i].r = P[i].r > mToUm(8) ? Math.round(P[i].r * 0.6) : 0; fixed = true; }
    }
    if (!fixed) for (const q of P) if (q.r > 0) { q.r = q.r > mToUm(8) ? Math.round(q.r * 0.6) : 0; fixed = true; }
    if (!fixed) break;
  }
  for (const q of P) if (!q.r) delete q.r;
  return rec;
}

// ------------------------------------------------------------------ drawing
function startDraw() {
  if (!can()) { say('Only administrators change roads (on an island world).', true); return; }
  if (S.mode === 'play' || S.mode === 'furnish') app.setMode('explore');
  setEdit(false); stopGrid();
  R.tool = 'draw'; R.pts = []; R.cursor = null;
  E.draw.classList.add('hidden'); E.edit.classList.add('hidden'); for (const b of [E.finish, E.cancel, E.namerow, E.undo]) b.classList.remove('hidden');
  say('Click the ground to start the road, click again at each bend, double-click (or Enter) to finish. Backspace removes the last point, Esc cancels. It snaps to roads, road ends and the city\'s street ends; 📐 (or Shift held) keeps legs at 45°/90°.');
}
/** The leg being drawn: from the last point, turning from the leg before it. */
function drawGuide() { const n = R.pts.length; return n ? { from: R.pts[n - 1], prev: n > 1 ? R.pts[n - 2] : null } : null; }
function stopDraw(text) {
  if (R.tool === 'station' && E.placest) E.placest.textContent = '🚇 Place a subway station';
  R.tool = null; R.pts = []; R.cursor = null; clearGhost();
  E.draw.classList.remove('hidden'); E.edit.classList.remove('hidden'); for (const b of [E.finish, E.cancel, E.namerow, E.undo]) b.classList.add('hidden');
  if (text !== undefined) say(text);
}
async function finishDraw() {
  if (R.busy) return;
  if (R.pts.length < 2) { say('A road needs at least two points.', true); return; }
  const rec = record(R.pts, { name: E.name.value.trim() || 'New Road' }), road = { name: rec.name, profile: rec.profile, pts: rec.pts };
  R.busy = true; say('Building…');
  try {
    const r = await post('/api/edit', { ops: [{ op: 'road.set', road }] });
    const id = r.results?.[0]?.id;
    stopDraw(`Built ${rec.name}.`);
    if (id) setTimeout(() => select(id), 0);
  } catch (e) { say(e.message, true); }
  finally { R.busy = false; }
}
function onClick(e) {
  if (R.picked && performance.now() - R.picked < 700) { R.picked = 0; return true; }   // the click that selected a road
  if (R.tool === 'station' && S.mode !== 'play') { placeStation(); return true; }
  if (R.tool === 'grid' && S.mode !== 'play') { const p = groundAt(e.clientX, e.clientY); if (p) { GRID.at = p; GRID.pinned = p; gridGhost(true); } return true; }
  if (R.edit && R.tool !== 'draw' && S.mode !== 'play') { if (!roadAt(e.clientX, e.clientY)) select(null); return true; }   // editing roads: clicks are the tool's
  if (R.tool !== 'draw' || S.mode === 'play') return false;
  const now = performance.now(), dbl = now - R.lastClick.t < 350 && Math.hypot(e.clientX - R.lastClick.x, e.clientY - R.lastClick.y) < 8;
  R.lastClick = { t: now, x: e.clientX, y: e.clientY };
  if (dbl) { finishDraw(); return true; }
  ptr.shift = e.shiftKey;
  const p = snap(groundAt(e.clientX, e.clientY), null, drawGuide());
  if (p) { R.pts.push(p); drawGhost(); }
  return true;
}
function onKey(e) {
  if (R.tool === 'grid') {
    if (e.key === 'Escape') { if (GRID.pinned) { GRID.pinned = null; ptr.moved = true; } else stopGrid(); return true; }
    if (e.key === 'Enter') { buildGrid(); return true; }
    if (e.key === 'r' || e.key === 'R') { turnGrid(e.shiftKey ? -15 : 15); return true; }
    return false;
  }
  if (R.tool === 'station') { if (e.key === 'Escape') { stopDraw(''); return true; } return false; }
  if (R.tool !== 'draw') {
    if (!R.edit) return false;
    if (e.key === 'Escape') { if (R.sel) select(null); else setEdit(false); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && R.selPt >= 0) { removePoint(); return true; }
    return false;
  }
  if (e.key === 'Escape') { stopDraw(''); return true; }
  if (e.key === 'Enter') { finishDraw(); return true; }
  if (e.key === 'Backspace') { R.pts.pop(); drawGhost(); return true; }
  return false;
}
function frame() {
  if (R.edit && !app.docks?.isOpen?.('l:roads')) setEdit(false);   // the section closed: editing ends with it
  if (ghost.children.length) {   // handles keep their size on screen at any distance
    const c = app.stage.camera.position;
    for (const m of ghost.children) if (m.userData.handle) { const s = Math.max(1, m.position.distanceTo(c) * HANDLE_SCREEN); m.scale.set(s, 1, s); }
  }
  if (R.tool === 'draw' && ptr.moved) { ptr.moved = false; R.cursor = snap(groundAt(ptr.x, ptr.y), null, drawGuide()); drawGhost(); }
  if (R.tool === 'grid' && ptr.moved) { ptr.moved = false; if (!GRID.pinned) { GRID.at = groundAt(ptr.x, ptr.y); gridGhost(); } }
  if (R.tool === 'station' && ptr.moved) { ptr.moved = false; stationGhost(); }
}

// ------------------------------------------------------------------ subway stations beyond the city (WP4.5)
function startStation() {
  if (!can()) { say('Only administrators place subway stations (on an island world).', true); return; }
  setEdit(false); stopDraw(); stopGrid();
  R.tool = 'station'; R.st = null; E.placest.textContent = '✕ Stop placing';
  say('Point beside a road beyond the city: the station faces the road. Click to open it, Esc to stop.');
}
/** The station the pointer would place: beside the nearest road, its entrance towards it. */
function stationAt(p) {
  const N = network(), near = N.nearest(p.x, p.z, 80);
  if (!near) return normalizeStation({ x: p.x, z: p.z, rot: 0 });
  const G = N.geometry(near.id), half = N.profiles[N.get(near.id).profile].outerHalf / 1e6, q = pointAt(G, near.s, {});
  const side = near.offset >= 0 ? 1 : -1, nx = -q.dz * side, nz = q.dx * side, r = half + 1.6 + KIOSK.hd;
  return normalizeStation({ x: near.x + nx * r, z: near.z + nz * r, rot: Math.atan2(-nx, -nz) });
}
function stationGhost() {
  clearGhost();
  const p = groundAt(ptr.x, ptr.y), T = app.terrain; if (!p || !T?.ground) return;
  const st = R.st = stationAt(p);
  const why = st instanceof Error ? st.message : checkStation(S.world, st, { heightAt: (x, z) => T.heightAt(x, z), isWater: (x, z) => T.isWater(x, z), roads: T.roadNet });
  R.stWhy = why;
  const col = why ? 0xf87171 : 0x4ade80, y = T.heightAt(st.x, st.z);
  const m = new THREE.Mesh(new THREE.BoxGeometry(KIOSK.hw * 2, 2.6, KIOSK.hd * 2).translate(0, 1.3, 0), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.45, depthWrite: false }));
  m.position.set(st.x, y, st.z); m.rotation.y = st.rot; m.renderOrder = 7; ghost.add(m);
  marker(st.entry, col);
  if (performance.now() < (R.keepMsg || 0)) return;   // the last result stays readable for a moment
  say(why ? `⚠️ ${why}` : '✅ Click to open a station here (Esc to stop)', !!why);
}
async function placeStation() {
  if (!R.st || R.stWhy || R.busy) { if (R.stWhy) app.toast?.(R.stWhy, 'bad', 2000); return; }
  R.busy = true;
  try {
    const r = await post('/api/edit', { ops: [{ op: 'station.add', station: { x: R.st.x, z: R.st.z, rot: R.st.rot } }] });
    say(`🚇 Opened ${r.results?.[0]?.name || 'a station'} station. Residents nearby can now take the subway.`); R.keepMsg = performance.now() + 3500;
  } catch (e) { say(e.message, true); R.keepMsg = performance.now() + 3500; }
  finally { R.busy = false; ptr.moved = true; }
}
function listStations() {
  if (!E.stlist) return;
  const list = (S.world.stations || []).filter(s => !Number.isInteger(s.block));
  E.stlist.innerHTML = list.length ? `<p class="hint">Stations beyond the city:</p>${list.map(s => `<div class="row"><span>🚇 ${esc(s.name)}</span> <button type="button" class="btn sm" data-go="${s.id}">Go</button> <button type="button" class="btn sm" data-ren="${s.id}">Rename</button> <button type="button" class="btn sm danger" data-del="${s.id}">Close</button></div>`).join('')}` : '';
  E.stlist.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    const s = (S.world.stations || []).find(x => x.id === (b.dataset.go || b.dataset.ren || b.dataset.del)); if (!s) return;
    if (b.dataset.go) { app.cam.flyTo(s.x, app.terrain ? app.terrain.heightAt(s.x, s.z) : 0, s.z, 60); return; }
    try {
      if (b.dataset.ren) { const n = prompt('Station name', s.name); if (n && n.trim()) await post('/api/edit', { ops: [{ op: 'station.set', id: s.id, name: n.trim() }] }); }
      if (b.dataset.del && confirm(`Close ${s.name} station? Residents stop using it; you can undo.`)) await post('/api/edit', { ops: [{ op: 'station.del', id: s.id }] });
    } catch (err) { say(err.message, true); }
  };
}

// ------------------------------------------------------------------ the grid layout tool
function startGrid() {
  if (!can()) { say('Only administrators change roads (on an island world).', true); return; }
  if (S.mode === 'play' || S.mode === 'furnish') app.setMode('explore');
  setEdit(false); stopDraw();
  R.tool = 'grid'; GRID.pinned = null; GRID.at = null; GRID.plan = null;
  E.grid.classList.add('on'); E.gbox.classList.remove('hidden'); E.draw.classList.add('hidden'); E.edit.classList.add('hidden');
  syncGridInputs(); gridChanged();
  say(`Move over the map: the grid follows. ${isTouch() ? 'Tap' : 'Click'} to put it there, then ✔ Build. R turns it 15°, Esc lets it follow again.`);
}
function stopGrid() {
  if (R.tool !== 'grid') return;
  R.tool = null; GRID.pinned = null; GRID.plan = null; clearGhost();
  E.grid.classList.remove('on'); E.gbox.classList.add('hidden'); E.draw.classList.remove('hidden'); E.edit.classList.remove('hidden');
  say('');
}
function syncGridInputs() { for (const inp of E.gbox.querySelectorAll('.gin')) inp.value = GRID[inp.dataset.k]; }
function turnGrid(d) { GRID.rot = ((Math.round(GRID.rot + d) + 540) % 360) - 180; syncGridInputs(); gridChanged(); }
function gridChanged() { if (R.tool === 'grid') gridGhost(true); }
/**
 * The grid's roads around centre c (m): `ns` roads running north–south and `ew` east–west, as far apart as `lotsX` ×
 * `lotsZ` lots of `lotFt` feet need between their sidewalks (lots begin at the back of the sidewalk), turned `rot`°.
 * Every road runs the whole way across, so they meet as crossings inside, T junctions round the edge and corners.
 */
function gridPlan(c) {
  const T = app.terrain, o = { c, ns: GRID.ns, ew: GRID.ew, lotsX: GRID.lotsX, lotsZ: GRID.lotsZ, lotFt: GRID.lotFt, rot: GRID.rot, profile: R.profile, name: GRID.name };
  const lv = T ? gridLevel(gridLayout(o), (x, z) => T.heightAt(x, z), (x, z) => T.isWater(x, z), T.params.seaLevel) : { level: null, cut: 0, fill: 0, wet: 0 };
  const L = gridLayout({ ...o, level: lv.level, grid: GRID.gid || (GRID.gid = `g${Date.now().toString(36)}`) });
  return { ...L, ...lv };
}
/** What stops the grid being built, as far as the browser can tell (the server checks water, lots and buildings too). */
function gridWhy(plan) {
  if (plan.roads.length > 50) return 'At most 50 roads in one grid: fewer roads each way';
  if (plan.wet) return 'There is water inside the grid: move it onto dry land (its land is levelled)';
  const g = makeGrid(S.world.grid), ix0 = g.X[0] + 0.5, ix1 = g.X.at(-1) - 0.5, iz0 = g.Z[0] + 0.5, iz1 = g.Z.at(-1) - 0.5;
  const N = new RoadNetwork();
  try { for (const r of cityRoads(S.world.grid)) N.set(r); } catch { /* no city */ }
  for (const r of S.world.roads || []) { try { N.set(r); } catch { /* skipped */ } }
  for (const rec of plan.roads) {
    const probs = checkAlignment(rec); if (probs.length) return probs[0].message;
    const G = alignmentGeometry(rec);
    if (samplePolyline(G, 0, { maxChord: 8 }).some(p => p.x > ix0 && p.x < ix1 && p.z > iz0 && p.z < iz1)) return 'The grid covers the city: move it beyond the city\'s edge';
    try { N.set(rec); } catch (e) { return e.message; }
  }
  const mine = id => id.startsWith('grid-draft-');
  const bad = N.validate().find(p => (p.roads || []).some(mine) || (p.junctions || []).some(k => k.split('@')[0].split('+').some(mine)));
  return bad ? bad.message.replace(/grid-draft-[as]\d+/g, 'the grid') : null;
}
function gridGhost(force = false) {
  const now = performance.now();
  if (!force && now - (GRID.t || 0) < 90) { ptr.moved = true; return; }   // (follows the pointer a few times a second)
  GRID.t = now;
  clearGhost();
  const c = GRID.pinned || GRID.at, T = app.terrain;
  if (!c || !T) { gridSummary(null); return; }
  const plan = GRID.plan = gridPlan(c), why = GRID.why = gridWhy(plan), col = why ? 0xf87171 : GRID.pinned ? 0x4ade80 : 0x93c5fd;
  const y = plan.level !== null ? () => plan.level + 0.6 : (x, z) => Math.max(T.params.seaLevel, T.heightAt(x, z)) + 0.6, road = [], lots = [];   // (flat: where the grid will stand)
  const seg = (out, a, b, step = 12) => { const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / step)); let p = a; for (let k = 1; k <= n; k++) { const q = { x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }; out.push(p.x, y(p.x, p.z), p.z, q.x, y(q.x, q.z), q.z); p = q; } };
  for (const rec of plan.roads) { const a = { x: rec.pts[0].x / 1e6, z: rec.pts[0].z / 1e6 }, b = { x: rec.pts[1].x / 1e6, z: rec.pts[1].z / 1e6 }, dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, nx = -dz / L * plan.oh, nz = dx / L * plan.oh; seg(road, a, b); seg(road, { x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }); seg(road, { x: a.x - nx, z: a.z - nz }, { x: b.x - nx, z: b.z - nz }); }
  for (const B of plan.blocks) { for (let k = 0; k < 4; k++) seg(lots, B.ring[k], B.ring[(k + 1) % 4], 16); for (const [a, b] of B.lines) seg(lots, a, b, 16); }
  for (const [list, colr, op] of [[road, col, 1], [lots, 0xfde68a, 0.7]]) {
    if (!list.length) continue;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
    const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colr, transparent: true, opacity: op, depthTest: false, fog: false }));
    m.renderOrder = 6; ghost.add(m);
  }
  gridSummary(plan, why);
}
function gridSummary(plan, why = null) {
  E.gbuild.disabled = !plan || !GRID.pinned || !!why || R.busy;
  if (!plan) { E.gsum.textContent = 'Move over the map to see the grid.'; E.gsum.classList.remove('bad'); return; }
  const blocks = (plan.ns - 1) * (plan.ew - 1);
  const flat = plan.level === null ? '' : ` · flat at ${formatFt(Math.round(plan.level * 1e6))}${plan.cut > 0.3 || plan.fill > 0.3 ? ` (land cut up to ${formatFt(Math.round(plan.cut * 1e6))}, filled up to ${formatFt(Math.round(plan.fill * 1e6))})` : ''}`;
  const made = GRID.lots ? ` · makes ${plan.lots - plan.inner} lots${plan.inner ? ` (${plan.inner} inside big blocks have no road and are left out)` : ''}` : ` · room for ${plan.lots} lots`;
  E.gsum.textContent = `${plan.ns} × ${plan.ew} roads · ${blocks} block${blocks === 1 ? '' : 's'}${made} · ${formatFt(Math.round((plan.W + 2 * plan.oh) * 1e6))} × ${formatFt(Math.round((plan.D + 2 * plan.oh) * 1e6))} · ${DEFAULT_ROAD_PROFILES[R.profile].label || R.profile}${flat}${why ? ` — ⚠️ ${why}` : GRID.pinned ? ' — ready: ✔ Build' : ` — ${isTouch() ? 'tap' : 'click'} to put it here`}`;
  E.gsum.classList.toggle('bad', !!why);
}
async function buildGrid() {
  if (R.busy || R.tool !== 'grid') return;
  const plan = GRID.pinned && GRID.plan;
  if (!plan) { say(`${isTouch() ? 'Tap' : 'Click'} the map to put the grid there first.`, true); return; }
  if (GRID.why) { say(GRID.why, true); return; }
  const withLots = GRID.lots && auth.can('property.admin');
  if (!confirm(`Build ${plan.roads.length} flat roads (${(plan.ns - 1) * (plan.ew - 1)} blocks${withLots ? ` and ${plan.lots - plan.inner} ${GRID.zoning} lots` : `, room for ${plan.lots} lots`}), levelling the land under the grid?${withLots ? ' To take the grid away later, retire its lots first, then undo.' : ' One undo takes it all away again.'}`)) return;
  R.busy = true; E.gbuild.disabled = true; say('Building the grid…');
  try {
    // all or nothing: if the server refuses any road (water, a lot, a building in the way), none is built
    const r = await post('/api/edit', { atomic: true, ops: plan.roads.map(({ id, ...road }) => (void id, { op: 'road.set', road })) });
    const n = plan.roads.length, ids = plan.roads.map((_, k) => r.results?.[k]?.id);
    GRID.gid = null; stopGrid();
    if (!withLots) { say(`Built the grid: ${n} flat roads, room for ${plan.lots} lots. Ctrl+Z takes it away. To make the lots, select a road in 🛠 Edit roads → 🏘️ Make lots beside this road.`); return; }
    say(`Built ${n} roads; making the lots…`);
    try {
      const runs = plan.runs.map(x => ({ ...x, road: ids[x.road] })).filter(x => x.road);
      const L = await post('/api/property/plat-grid', { runs, width: plan.lot.w, depth: plan.lot.d, zoning: GRID.zoning, key: `grid-${Date.now().toString(36)}` });
      const sk = Object.values(L.skipped || {}).reduce((a, b) => a + b, 0);
      say(`Built the grid: ${n} flat roads and ${L.ids.length} lots${sk ? ` (${sk} didn't fit: water, a junction, a building or a lot in the way)` : ''}. Price or sell them from the 🗺️ Lot map.`);
    } catch (e) { say(`Built the grid's ${n} roads, but not its lots: ${e.message}. Make them from 🛠 Edit roads → 🏘️ Make lots beside this road.`, true); }
  } catch (e) { say(`The grid wasn't built: ${e.message}`, true); }
  finally { R.busy = false; if (R.tool === 'grid') gridSummary(GRID.plan, GRID.why); }
}

// ------------------------------------------------------------------ the ghost (centreline and both edges)
function clearGhost() { for (const m of [...ghost.children]) { ghost.remove(m); m.geometry.dispose(); m.material.dispose(); } }
function drawGhost(pts = null, base = {}) {
  clearGhost();
  const list = pts || [...R.pts, ...(R.cursor ? [R.cursor] : [])];
  if (list.length < 2) { if (list.length) marker(list[0]); return; }
  const rec = record(list, base), probs = checkAlignment(rec), P = DEFAULT_ROAD_PROFILES[rec.profile], half = P.outerHalf / 1e6;
  let G; try { G = alignmentGeometry(rec); } catch { return; }
  const col = probs.length ? 0xf87171 : 0x4ade80, T = app.terrain;
  for (const off of [-half, 0, half]) {
    const line = samplePolyline(G, off, { maxChord: 4 }).map(q => new THREE.Vector3(q.x, (T ? Math.max(T.params.seaLevel, T.heightAt(q.x, q.z)) : 0) + 0.6, q.z));
    const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints(line), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: off ? 0.75 : 1, depthTest: false }));
    m.renderOrder = 6; ghost.add(m);
  }
  for (const q of list) marker(q, col);
  const len = G.length;
  const c = R.tool === 'draw' ? R.cursor : R.drag ? R.drag.pts[R.drag.k] : null, ang = c && c.heading !== undefined ? ` · 📐 ${c.heading}°${c.turn !== null ? ` (turn ${c.turn}°)` : ''}${c.snapped === 'road' ? ' onto the road' : c.snapped === 'end' ? ' to the road end' : ''}` : '';
  if (R.tool === 'draw') say(`${formatFt(Math.round(len * 1e6))} · ${list.length} points${ang}${probs.length ? ` — ${probs[0].message}` : ''}. Double-click or Enter to finish.${angleSnapOn() ? '' : ' Hold Shift (or 📐) to keep 45°/90° angles.'}`, !!probs.length);
  else if (R.drag && ang) say(`Moving point ${R.drag.k + 1}${ang}.`);
}
function marker(q, col = 0x4ade80, r = 1.2, data = {}) {
  const T = app.terrain, y = (T ? Math.max(T.params.seaLevel, T.heightAt(q.x, q.z)) : 0) + 0.6;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 20), new THREE.MeshBasicMaterial({ color: col, depthTest: false }));
  m.position.set(q.x, y, q.z); m.renderOrder = 7; m.userData = { handle: true, ...data }; ghost.add(m);
  return m;
}

// ------------------------------------------------------------------ selecting, inspecting, editing
function roadAt(cx, cy) {
  const p = groundAt(cx, cy); if (!p) return null;
  const q = network().nearest(p.x, p.z, 12);
  return q ? q.id : null;
}
function onDown(e) {
  if (e.button !== 0 || !R.edit || S.mode === 'play' || S.mode === 'furnish' || R.tool === 'draw' || R.tool === 'station' || !can()) return;
  if (R.sel) {
    const rec = (S.world.roads || []).find(r => r.id === R.sel);
    if (rec) {
      const pts = rec.pts.map(q => ({ x: q.x / 1e6, z: q.z / 1e6, r: q.r ? q.r / 1e6 : undefined }));
      const near = (x, z) => { const s = project3(x, z); return s ? Math.hypot(s.x - e.clientX, s.y - e.clientY) : Infinity; }, px = handlePx();
      let k = -1, bd = px;
      pts.forEach((q, i) => { const d = near(q.x, q.z); if (d < bd) { bd = d; k = i; } });
      let insert = false;
      if (k < 0) for (let i = 0; i + 1 < pts.length; i++) {   // a '+' between two points: a new point there
        const mx = (pts[i].x + pts[i + 1].x) / 2, mz = (pts[i].z + pts[i + 1].z) / 2, d = near(mx, mz);
        if (d < bd) { bd = d; k = i + 1; insert = true; }
      }
      if (k >= 0) {
        if (cam.drag) cam.drag.kind = null;   // move the point instead of panning the camera
        if (insert) pts.splice(k, 0, { x: (pts[k - 1].x + pts[k].x) / 2, z: (pts[k - 1].z + pts[k].z) / 2 });
        R.drag = { k, rec, pts, insert, moved: false, sx: e.clientX, sy: e.clientY };
        return;
      }
    }
  }
  const id = roadAt(e.clientX, e.clientY);
  if (id) { select(id); R.picked = performance.now(); }
}
/** Edit roads on or off: off, nothing can be selected or moved (the world's clicks go to people and buildings). */
function setEdit(on) {
  on = !!on && can();
  if (on) { stopDraw(); stopGrid(); }
  R.edit = on; E.edit?.classList.toggle('on', on);
  if (!on) { R.drag = null; select(null); }
  if (on) say(isTouch() ? 'Tap a road to select it. Drag a handle to move a point, drag a + to add one, tap a point to remove it.' : 'Click a road to select it. Drag a handle to move a point, drag a + to add one, click a point and press Delete to remove it. Esc ends editing.');
}
function removePoint() {
  const rec = (S.world.roads || []).find(r => r.id === R.sel), k = R.selPt;
  if (!rec || k < 0) return;
  if (rec.pts.length <= 2) { say('A road keeps at least two points; remove the road instead.', true); return; }
  const pts = rec.pts.map(q => ({ x: q.x / 1e6, z: q.z / 1e6, r: q.r ? q.r / 1e6 : undefined }));
  pts.splice(k, 1); R.selPt = -1;
  const out = record(pts, rec);
  post('/api/edit', { ops: [{ op: 'road.set', road: { id: rec.id, name: rec.name, profile: rec.profile, pts: out.pts } }] }).then(() => say('Point removed. Ctrl+Z puts it back.')).catch(err => say(err.message, true));
}
function project3(x, z) {
  const T = app.terrain, v = new THREE.Vector3(x, (T ? T.heightAt(x, z) : 0) + 0.6, z).project(app.stage.camera), r = app.stage.renderer.domElement.getBoundingClientRect();
  return v.z < 1 ? { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height } : null;
}
function onDragMove(e) {
  const d = R.drag; if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
  if (!d.moved) return;
  ptr.shift = e.shiftKey;
  // with the angle snap: the moved point keeps 45° to its neighbour (the one before it, or after it for the first point)
  const k = d.k, P = d.pts, guide = k > 0 ? { from: P[k - 1], prev: P[k - 2] || null } : P[1] ? { from: P[1], prev: P[2] || null } : null;
  const p = snap(groundAt(e.clientX, e.clientY), d.rec.id, guide); if (!p) return;
  d.pts[d.k] = { ...p, r: d.pts[d.k].r };
  drawGhost(d.pts, d.rec);
}
async function onUp() {
  const d = R.drag; if (!d) return;
  R.drag = null;
  if (!d.moved) {   // a tap on a point selects it (to remove it); a tap on a '+' does nothing
    if (!d.insert) { R.selPt = d.k; select(d.rec.id); say(`Point ${d.k + 1} selected.${d.rec.pts.length > 2 ? ' Remove it with the button below, or press Delete.' : ''}`); }
    return;
  }
  const rec = record(d.pts, d.rec);
  say('Moving the point…');
  try { await post('/api/edit', { ops: [{ op: 'road.set', road: { id: d.rec.id, name: d.rec.name, profile: d.rec.profile, pts: rec.pts } }] }); say(`Changed ${d.rec.name || 'the road'}.`); }
  catch (err) { say(err.message, true); }
  select(d.rec.id);
}
function select(id) {
  if (id !== R.sel) R.selPt = -1;
  R.sel = id; clearGhost();
  const rec = id ? (S.world.roads || []).find(r => r.id === id) : null;
  E.insp.classList.toggle('hidden', !rec);
  if (!rec) { E.insp.innerHTML = ''; return; }
  let G = null; try { G = alignmentGeometry(rec); } catch { G = null; }
  const radii = rec.pts.filter(q => q.r).map(q => q.r), prof = app.terrain?.roadLayer?.roads?.prof?.get(rec.id);
  let grade = 0; if (prof) for (let i = 1; i < prof.y.length; i++) grade = Math.max(grade, Math.abs(prof.y[i] - prof.y[i - 1]) / prof.d);
  E.insp.innerHTML = `<h4>${esc(rec.name || rec.id)}</h4>
    <label class="row">Name <input class="iname" maxlength="60" value="${esc(rec.name || '')}"></label>
    <label class="row">Type <select class="itype">${TYPES.map(t => `<option value="${t}"${t === rec.profile ? ' selected' : ''}>${esc(DEFAULT_ROAD_PROFILES[t].label || t)}</option>`).join('')}</select></label>
    <p class="hint">${G ? formatFt(Math.round(G.length * 1e6)) : '?'} long · ${rec.pts.length} points${radii.length ? ` · tightest curve ${formatFt(Math.min(...radii))} radius` : ''}${prof ? ` · steepest ${(grade * 100).toFixed(1)}%` : ''}. Drag a point's handle to move it.</p>
    <div class="row"><button type="button" class="btn sm save">Save</button>${R.selPt >= 0 && rec.pts.length > 2 ? ` <button type="button" class="btn sm rmpt">✕ Remove point ${R.selPt + 1}</button>` : ''} <button type="button" class="btn sm danger del">🗑 Remove road</button> <button type="button" class="btn sm done">Done</button></div>
    ${G && auth.can('property.admin') && app.lotTools ? '<div class="platbox"><button type="button" class="btn sm plots">🏘️ Make lots beside this road…</button></div>' : ''}`;
  E.insp.querySelector('.save').onclick = async () => {
    try { await post('/api/edit', { ops: [{ op: 'road.set', road: { ...rec, name: E.insp.querySelector('.iname').value.trim() || rec.name, profile: E.insp.querySelector('.itype').value } }] }); say('Saved.'); }
    catch (err) { say(err.message, true); }
  };
  E.insp.querySelector('.del').onclick = async () => {
    if (!confirm(`Remove ${rec.name || 'this road'}? Traffic on it disappears; you can undo.`)) return;
    try { await post('/api/edit', { ops: [{ op: 'road.del', id: rec.id }] }); say(`Removed ${rec.name || 'the road'}.`); }
    catch (err) { if (err.code !== 'reauth_required') say(err.message, true); }
  };
  E.insp.querySelector('.done').onclick = () => select(null);
  const rm = E.insp.querySelector('.rmpt'); if (rm) rm.onclick = removePoint;
  const pl = E.insp.querySelector('.plots'); if (pl) pl.onclick = () => { setEdit(false); app.lotTools.forRoad(rec.id); };
  // the road highlighted, with a handle at each point (the selected one in yellow) and a '+' between each two
  const pts = rec.pts.map(q => ({ x: q.x / 1e6, z: q.z / 1e6, r: q.r ? q.r / 1e6 : undefined }));
  drawGhost(pts, rec);
  if (R.selPt >= 0 && pts[R.selPt]) marker(pts[R.selPt], 0xffd166, 1.5);
  for (let i = 0; i + 1 < pts.length; i++) marker({ x: (pts[i].x + pts[i + 1].x) / 2, z: (pts[i].z + pts[i + 1].z) / 2 }, 0xffffff, 0.7, { mid: i + 1 });
}
