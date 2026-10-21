// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Ferry lines in the Roads section (WP4.15, shared/ferries.js): administrators draw a line over the water — the first
// click is the first dock (a short way off the shore), each next click a turn, a double-click (or Enter) the second
// dock — pick how many boats run it, and open it. The ghost is green, or red with the reason (the same rules the server
// checks). Lines are listed with their crossing time and how often a boat leaves; each can get more boats or be closed.
// Every change goes through /api/edit and can be undone.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { h, esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { post } from '../core/net.js';
import { makeGrid } from '/shared/city.js';
import { ferryWhy, ferryPath, timetable, normalizeFerry, docksOf, nextSailing } from '/shared/ferries.js';

const F = { tool: null, pts: [], cursor: null, busy: false, last: { t: 0, x: 0, y: 0 }, why: '', checkedAt: 0 };
let app = null, E = {}, ghost = null, ptr = { x: 0, y: 0, moved: false };

export function init(a) {
  app = a;
  const slot = a.docks && a.docks.slot('l:roads');
  if (!slot || !S.world.terrain) return;
  slot.appendChild(h(`<div class="ferries"><div class="sep"></div><h5>⛴️ Ferries</h5>
    <p class="hint">Boats on a timetable between two docks. Docks go a short way off the shore with a road near it — on the main island at a growth coast.</p>
    <div class="row"><button type="button" class="btn fdraw">✏️ Draw a ferry line</button> <button type="button" class="btn ffinish hidden">✔ Open it</button> <button type="button" class="btn fcancel hidden">✕ Cancel</button></div>
    <div class="row fopts hidden"><input class="input fname" maxlength="40" placeholder="Name" value="Island Ferry" style="flex:1"> <label>Boats <select class="input fboats"><option>1</option><option selected>2</option><option>3</option></select></label></div>
    <div class="flist"></div>
    <p class="hint fstat"></p></div>`));
  const q = s => slot.querySelector(s);
  E = { draw: q('.fdraw'), finish: q('.ffinish'), cancel: q('.fcancel'), opts: q('.fopts'), name: q('.fname'), boats: q('.fboats'), list: q('.flist'), stat: q('.fstat') };
  E.draw.onclick = start; E.finish.onclick = finish; E.cancel.onclick = () => stop('');
  E.list.onclick = onList;
  ghost = new THREE.Group(); ghost.name = 'ferry-ghost'; a.stage.scene.add(ghost);
  app.hooks.click.unshift(onClick); app.hooks.key.unshift(onKey); app.hooks.hover.unshift(() => F.tool === 'draw');
  a.stage.renderer.domElement.addEventListener('pointermove', e => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.moved = true; });
  bus.on('ferries', list); bus.on('mode', m => { if (m === 'play' || m === 'furnish') stop(''); });
  bus.on('frame', frame);
  setInterval(list, 30000);   // the next sailings move on
  list();
}
const can = () => !!auth.account && auth.can('world.edit') && !!S.world.terrain;
function say(t, bad = false) { E.stat.textContent = t; E.stat.classList.toggle('bad', bad); }
const mins = s => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
function list() {
  const L = S.world.ferries || [], t = S.simT ?? 0;
  E.list.innerHTML = L.map(f => {
    const T = timetable(f), a = nextSailing(f, 'a', t);
    return `<div class="ditem" data-f="${esc(f.id)}">⛴️ ${esc(f.name)} <span class="dim">${(ferryPath(f).length / 1609.34).toFixed(1)} mi · crossing ${mins(T.cross)} · a boat every ${mins(T.headway)} · next in ${mins(Math.max(0, a.depart - t))}</span>
      ${can() ? `<span class="row"><button type="button" class="btn sm" data-boats="${esc(f.id)}" title="How many boats run it">🚤 ${f.boats} boat${f.boats > 1 ? 's' : ''}</button> <button type="button" class="btn sm" data-fly="${esc(f.id)}">👁 Show</button> <button type="button" class="btn sm danger" data-close="${esc(f.id)}">Close</button></span>` : ''}</div>`;
  }).join('');
}
async function onList(e) {
  const b = e.target.closest('button'); if (!b) return;
  const f = (S.world.ferries || []).find(x => x.id === (b.dataset.boats || b.dataset.fly || b.dataset.close)); if (!f) return;
  if (b.dataset.fly) { const p = f.pts[Math.floor(f.pts.length / 2)]; app.cam?.flyTo?.(p.x, 0, p.z, 900); return; }
  try {
    if (b.dataset.boats) await post('/api/edit', { ops: [{ op: 'ferry.set', ferry: { ...f, boats: f.boats % 3 + 1 } }] });
    else if (confirm(`Close the ${f.name} ferry? You can undo it.`)) await post('/api/edit', { ops: [{ op: 'ferry.del', id: f.id }] });
  } catch (err) { say(err.message, true); }
}
// ------------------------------------------------------------------ drawing
function start() {
  if (!can()) { say('Only administrators run ferries.', true); return; }
  if (S.mode === 'play' || S.mode === 'furnish') app.setMode('explore');
  F.tool = 'draw'; F.pts = []; F.cursor = null;
  E.draw.classList.add('hidden'); for (const x of [E.finish, E.cancel, E.opts]) x.classList.remove('hidden');
  say('Click the water just off a shore for the first dock, click at each turn, double-click (or Enter) at the second dock. Backspace takes the last point back, Esc stops.');
}
function stop(text) {
  F.tool = null; F.pts = []; F.cursor = null; clear();
  E.draw.classList.remove('hidden'); for (const x of [E.finish, E.cancel, E.opts]) x.classList.add('hidden');
  if (text !== undefined) say(text);
}
function draft(pts) { return normalizeFerry({ id: 'fy-0', name: E.name.value, boats: +E.boats.value, pts }); }
function env() {
  const g = makeGrid(S.world.grid);
  return { island: app.terrain.ground.island, roads: app.terrain.roadNet, city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, buildings: S.world.buildings };
}
function groundAt(cx, cy) { const p = app.terrain?.rayHit(app.cam.rayAt(cx, cy)); return p ? { x: p.x, z: p.z } : null; }
function clear() { for (const m of [...ghost.children]) { ghost.remove(m); m.geometry.dispose(); m.material.dispose(); } }
function draw(pts, check) {
  clear();
  if (!pts.length || !app.terrain?.ground) return;
  const f = pts.length >= 2 ? draft(pts) : null;
  if (check && f && !(f instanceof Error)) { F.why = ferryWhy(f, env()) || ''; F.checkedAt = performance.now(); }
  const col = F.why ? 0xf87171 : 0x4ade80, y = app.terrain.params.seaLevel + 1.2;
  if (f && !(f instanceof Error)) {
    const P = ferryPath(f), v = [];
    for (let k = 0; k <= P.n; k += 2) v.push(new THREE.Vector3(P.x[k], y, P.z[k]));
    const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color: col, depthTest: false })); m.renderOrder = 6; ghost.add(m);
    for (const D of docksOf(f, app.terrain.ground.island)) if (D.land) {
      const pier = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(D.land.x, y, D.land.z), new THREE.Vector3(D.dock.x, y, D.dock.z)]), new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false }));
      pier.renderOrder = 6; ghost.add(pier);
    }
    const T = timetable(f);
    say(F.why ? `⚠️ ${F.why}` : `${(P.length / 1609.34).toFixed(2)} mi · crossing ${mins(T.cross)} · a boat every ${mins(T.headway)}. Double-click or Enter to open it.`, !!F.why);
  }
  for (const p of pts) { const s = new THREE.Mesh(new THREE.SphereGeometry(3, 10, 8), new THREE.MeshBasicMaterial({ color: col, depthTest: false })); s.position.set(p.x, y, p.z); s.renderOrder = 7; ghost.add(s); }
}
function frame() {
  if (F.tool !== 'draw' || !ptr.moved) return;
  ptr.moved = false;
  F.cursor = groundAt(ptr.x, ptr.y);
  draw([...F.pts, ...(F.cursor ? [F.cursor] : [])], performance.now() - F.checkedAt > 120);
}
async function finish() {
  if (F.busy) return;
  if (F.pts.length < 2) { say('A ferry line needs two docks.', true); return; }
  const f = draft(F.pts); if (f instanceof Error) { say(f.message, true); return; }
  const why = ferryWhy(f, env()); if (why) { say(`⚠️ ${why}`, true); return; }
  F.busy = true; say('Opening…');
  try { await post('/api/edit', { ops: [{ op: 'ferry.set', ferry: { name: f.name, boats: f.boats, pts: f.pts } }] }); stop(`The ${f.name} ferry is running.`); }
  catch (e) { say(e.message, true); }
  finally { F.busy = false; }
}
/** Click hook (synchronous: true when the click was this tool's). */
function onClick(e) {
  if (F.tool !== 'draw' || S.mode === 'play') return false;
  const now = performance.now(), dbl = now - F.last.t < 350 && Math.hypot(e.clientX - F.last.x, e.clientY - F.last.y) < 8;
  F.last = { t: now, x: e.clientX, y: e.clientY };
  if (dbl) { finish(); return true; }
  const p = groundAt(e.clientX, e.clientY);
  if (p) { F.pts.push(p); draw(F.pts, true); }
  return true;
}
function onKey(e) {
  if (F.tool !== 'draw') return false;
  if (e.key === 'Escape') { stop(''); return true; }
  if (e.key === 'Enter') { finish(); return true; }
  if (e.key === 'Backspace') { F.pts.pop(); draw(F.pts, true); return true; }
  return false;
}
