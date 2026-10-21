// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Coasts and the island chain, in the Terrain section (WP4.15, wp4-world-spec.md §3.3–3.4): a small map of the island
// with its coast in sectors coloured by class — click a stretch to change it (public shore → growth coast → protected
// waterfront → open-ocean frontage) — and the expansion planner: pick a kind of island, see the free places for it out
// at sea (and why the others aren't free), preview one on your own screen, then raise it for everyone. The advisory
// measures beside it (spec §3.4): lots still unclaimed, residents. Administrators only; every change can be undone.
import { S, bus } from '../core/state.js';
import { h, esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { post } from '../core/net.js';
import { COAST_CLASSES, SECTORS, ISLE_SECTORS, coastline, coastClasses, protectedWhy, isleCoastline, isleClasses } from '/shared/coasts.js';
import { TEMPLATES, islandSlots, newIsland } from '/shared/island-chain.js';

const ORDER = ['s', 'g', 'w', 'o'], W = 280;
const C = { tpl: 'harbour', sel: -1, preview: null, slots: [], view: null };
let app = null, E = {};

export function init(a) {
  app = a;
  const slot = a.docks && a.docks.slot('l:terrain');
  if (!slot || !S.world.terrain) return;
  slot.appendChild(h(`<div class="ctools">
    <div class="sep"></div><h5>🌊 Coasts and islands</h5>
    <p class="hint">Click a stretch of coast to change it. New land, piers and bridges start only from a growth coast; protected waterfront keeps ${Math.round(500)} ft of clear water in front of it.</p>
    <canvas class="cmap" width="${W}" height="${W}" style="width:${W}px;height:${W}px;border-radius:8px;cursor:pointer"></canvas>
    <div class="clegend hint">${Object.entries(COAST_CLASSES).map(([k, c]) => `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${c.color};margin:0 4px 0 8px"></span>${esc(c.label)}`).join('')}</div>
    <div class="field"><label>A new island</label><div class="chips ctpl">${Object.entries(TEMPLATES).map(([k, t]) => `<span class="chip${k === C.tpl ? ' on' : ''}" data-t="${k}" title="${esc(t.description)}">${esc(t.label)}</span>`).join('')}</div></div>
    <p class="hint cslot">Pick a place on the map (the circles out at sea).</p>
    <div class="row"><input class="input cname" maxlength="40" placeholder="Name (optional)" style="flex:1"></div>
    <div class="row"><button type="button" class="btn small cprev">👁 Preview</button> <button type="button" class="btn small primary craise">🏝️ Raise this island</button></div>
    <div class="cisl"></div>
    <p class="hint cmetrics"></p></div>`));
  const q = s => slot.querySelector(s);
  E = { map: q('.cmap'), tpl: q('.ctpl'), slot: q('.cslot'), name: q('.cname'), prev: q('.cprev'), raise: q('.craise'), isl: q('.cisl'), metrics: q('.cmetrics') };
  E.tpl.onclick = e => { const c = e.target.closest('[data-t]'); if (!c) return; C.tpl = c.dataset.t; for (const x of E.tpl.children) x.classList.toggle('on', x === c); C.sel = -1; endPreview(); draw(); };
  E.map.onclick = onMap;
  E.prev.onclick = () => (C.preview ? endPreview() : startPreview());
  E.raise.onclick = raise;
  bus.on('terrain', () => { C.preview = null; E.prev.textContent = '👁 Preview'; draw(); });
  bus.on('msg:lots', () => setTimeout(metrics, 1500));
  const wait = setInterval(() => { if (app.terrain?.ground) { clearInterval(wait); draw(); } }, 500);
}
const admin = () => !!auth.account && auth.can('world.edit');
function island() { return app.terrain?.ground?.island || null; }
/** Map transform: the whole chain and its slots. */
function view() {
  const T = S.world.terrain, discs = [[T.center.x, T.center.z, T.radius * 1.1], ...(T.islands || []).map(I => [I.center.x, I.center.z, I.radius * 1.3]), ...C.slots.map(s => [s.center.x, s.center.z, s.radius])];
  const x0 = Math.min(...discs.map(d => d[0] - d[2])), x1 = Math.max(...discs.map(d => d[0] + d[2])), z0 = Math.min(...discs.map(d => d[1] - d[2])), z1 = Math.max(...discs.map(d => d[1] + d[2]));
  const s = (W - 16) / Math.max(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  return { s, X: x => W / 2 + (x - cx) * s, Z: z => W / 2 + (z - cz) * s, x: X => cx + (X - W / 2) / s, z: Z => cz + (Z - W / 2) / s };
}
function draw() {
  const I = island(); if (!I || !E.map) return;
  const T = S.world.terrain;
  C.slots = islandSlots(T, C.tpl, { coastsWhy: (x, z, r) => protectedWhy(I, x, z, r) });
  const v = C.view = view(), c = E.map.getContext('2d'), line = coastline(I), cls = coastClasses(T);
  c.fillStyle = '#0f2a38'; c.fillRect(0, 0, W, W);
  c.fillStyle = '#4f6b3a'; c.beginPath(); line.forEach((p, k) => (k ? c.lineTo(v.X(p.x), v.Z(p.z)) : c.moveTo(v.X(p.x), v.Z(p.z)))); c.closePath(); c.fill();
  c.lineWidth = 4; c.lineCap = 'round';
  for (let k = 0; k < SECTORS; k++) { const a = line[k], b = line[(k + 1) % SECTORS]; c.strokeStyle = COAST_CLASSES[cls[k]].color; c.beginPath(); c.moveTo(v.X(a.x), v.Z(a.z)); c.lineTo(v.X(b.x), v.Z(b.z)); c.stroke(); }
  for (const P of [...(T.islands || []), ...(C.preview ? [C.preview] : [])]) { c.fillStyle = P === C.preview ? 'rgba(244,162,97,.6)' : '#6b8a4a'; c.beginPath(); c.arc(v.X(P.center.x), v.Z(P.center.z), P.radius * v.s, 0, 7); c.fill(); c.fillStyle = '#fff'; c.font = '10px sans-serif'; c.fillText(P.name, v.X(P.center.x) - 20, v.Z(P.center.z) + 3); }
  // the islands of the chain have coasts of their own (click a stretch to change it, as on the main island)
  c.lineWidth = 3;
  for (const J of I._chain || []) {
    const L = isleCoastline(J), ic = isleClasses(J, T);
    for (let k = 0; k < ISLE_SECTORS; k++) { const a = L[k], b = L[(k + 1) % ISLE_SECTORS]; c.strokeStyle = COAST_CLASSES[ic[k]].color; c.beginPath(); c.moveTo(v.X(a.x), v.Z(a.z)); c.lineTo(v.X(b.x), v.Z(b.z)); c.stroke(); }
  }
  C.slots.forEach(sl => { c.lineWidth = sl.k === C.sel ? 3 : 1.5; c.strokeStyle = sl.free ? (sl.k === C.sel ? '#ffd166' : '#7bd389') : 'rgba(255,107,107,.55)'; c.setLineDash(sl.free ? [] : [3, 3]); c.beginPath(); c.arc(v.X(sl.center.x), v.Z(sl.center.z), sl.radius * v.s, 0, 7); c.stroke(); });
  c.setLineDash([]);
  const city = T.city; c.fillStyle = '#9a9a9a'; if (!S.grid?.empty) c.fillRect(v.X(city.x0), v.Z(city.z0), (city.x1 - city.x0) * v.s, (city.z1 - city.z0) * v.s);
  listIslands(); metrics();
}
function onMap(e) {
  if (!admin()) { app.toast?.('Only administrators shape the coasts and the island chain', 'bad'); return; }
  const I = island(), v = C.view; if (!I || !v) return;
  const r = E.map.getBoundingClientRect(), X = e.clientX - r.left, Z = e.clientY - r.top, x = v.x(X), z = v.z(Z);
  // a slot out at sea?
  const sl = C.slots.find(s => Math.hypot(s.center.x - x, s.center.z - z) < s.radius);
  if (sl) {
    C.sel = sl.k; endPreview(); draw();
    E.slot.textContent = sl.free ? `A place ${Math.round(Math.hypot(sl.center.x - S.world.terrain.center.x, sl.center.z - S.world.terrain.center.z) / 1609.34 * 10) / 10} miles out — free. Preview it, or raise the island.` : `Not here: ${sl.why}.`;
    return;
  }
  // the nearest stretch of coast within reach of the click: the main island's, or an island of the chain's
  const line = coastline(I); let best = -1, bd = 14 / v.s, isle = null;
  line.forEach((p, k) => { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = k; isle = null; } });
  for (const J of I._chain || []) isleCoastline(J).forEach((p, k) => { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = k; isle = J; } });
  if (best < 0) return;
  const T = S.world.terrain, cur = isle ? isleClasses(isle, T)[best] : coastClasses(T)[best], next = ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length];
  post('/api/edit', { ops: [{ op: 'coast.set', k: best, cls: next, ...(isle ? { island: isle.id } : {}) }] })
    .then(() => app.toast?.(`That stretch of ${isle ? `${isle.name}'s ` : ''}coast is now ${COAST_CLASSES[next].label.toLowerCase()}`, 'good', 1800)).catch(err => app.toast?.(err.message, 'bad'));
}
function candidate() {
  const sl = C.slots.find(s => s.k === C.sel);
  if (!sl || !sl.free) return null;
  return newIsland(S.world.terrain, sl, C.tpl, E.name.value.trim(), C.seed || (C.seed = Math.random().toString(36).slice(2, 10)));
}
function startPreview() {
  const I = candidate(); if (!I) { E.slot.textContent = 'Pick a free place on the map first.'; return; }
  C.preview = I; E.prev.textContent = '✕ End preview';
  app.terrain.setGround(S.world.roads, { ...S.world.terrain, islands: [...(S.world.terrain.islands || []), I] });
  app.cam.bounds = app.terrain.bounds();
  app.cam.flyTo(I.center.x, 40, I.center.z, I.radius * 2.6, 0.6, 0.55);
  E.slot.textContent = `Previewing ${I.name} on your screen only. Raise it to make it real for everyone.`;
  draw();
}
function endPreview() {
  if (!C.preview) return;
  C.preview = null; if (E.prev) E.prev.textContent = '👁 Preview';
  app.terrain.setGround(S.world.roads, S.world.terrain);
  app.cam.bounds = app.terrain.bounds();
}
async function raise() {
  if (!admin()) return;
  const sl = C.slots.find(s => s.k === C.sel);
  if (!sl || !sl.free) { E.slot.textContent = 'Pick a free place on the map first.'; return; }
  if (!confirm(`Raise a ${TEMPLATES[C.tpl].label.toLowerCase()} out at sea for everyone? You can undo it while nothing is built on it.`)) return;
  try {
    const r = await post('/api/edit', { ops: [{ op: 'island.add', k: sl.k, template: C.tpl, name: E.name.value.trim(), seed: C.seed }] });
    const res = r.results?.[0]; C.seed = null; C.sel = -1; E.name.value = '';
    E.slot.textContent = `🏝️ ${res?.name || 'The island'} is raised. Connect it with a bridge from a growth coast (Roads) or a subway station.`;
    if (res) app.cam.flyTo(res.center.x, 40, res.center.z, res.radius * 2.6, 0.6, 0.55);
  } catch (err) { E.slot.textContent = err.message; }
}
function listIslands() {
  const L = S.world.terrain.islands || [];
  E.isl.innerHTML = L.length ? `<p class="hint">Islands of the chain:</p>${L.map(I => `<div class="row"><span>🏝️ ${esc(I.name)} <span class="dim">${esc(TEMPLATES[I.template]?.label || '')}</span></span> <button type="button" class="btn sm" data-go="${I.id}">Go</button> <button type="button" class="btn sm danger" data-del="${I.id}">Take away</button></div>`).join('')}` : '';
  E.isl.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    const I = L.find(x => x.id === (b.dataset.go || b.dataset.del)); if (!I) return;
    if (b.dataset.go) { app.cam.flyTo(I.center.x, 40, I.center.z, I.radius * 2.6, 0.6, 0.55); return; }
    if (!confirm(`Take away ${I.name}? Only an island with nothing on it can go; you can undo.`)) return;
    try { await post('/api/edit', { ops: [{ op: 'island.del', id: I.id }] }); } catch (err) { app.toast?.(err.message, 'bad'); }
  };
}
/** Advisory measures for growth (spec §3.4): unclaimed city lots and residents (population alone is no trigger). */
function metrics() {
  if (!E.metrics) return;
  const lots = app.lots?.lots || [], city = lots.filter(l => l.holder?.kind === 'municipality'), free = city.filter(l => !l.buildings?.length);
  const pct = lots.length ? Math.round(free.length / lots.length * 100) : 0;
  E.metrics.textContent = `Lots: ${lots.length.toLocaleString()} · unclaimed city lots ${free.length.toLocaleString()} (${pct}%) · residents ${(S.people?.length || 0).toLocaleString()} · islands ${1 + (S.world.terrain.islands || []).length}. A new island is worth it when unclaimed lots run low (under about 20%).`;
}
