// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The world map and GPS (2026-10-05: "build it properly, something like how GTA works"; the M key opens it).
// - The map: the whole island and the city in a full-screen view — terrain, water, rivers, every road and street (named),
//   city blocks and buildings by kind, parks, metro stations, other players, you (an arrow), your home — pan by dragging,
//   zoom with the wheel, pinch or the buttons; a legend that shows and hides kinds of places; search for places, streets,
//   roads and players. Clicking picks something (a card: what, where, how far); double-clicking (or the card) sets the
//   waypoint. "Travel here" moves a player there (server: players.travel, dry open ground only, once every 10 s).
// - GPS: the way to the waypoint along the roads (shared/route.js), drawn on the map and the radar, with arrows on the
//   ground ahead and a beam at the destination (render/waypoint.js), and turn-by-turn directions with the distance and
//   time left; it re-routes when the player leaves the route and ends on arrival.
// - The radar: while playing, a GTA-style minimap that follows the player and turns with the camera, zooming out at
//   speed (the city/island minimap stays for exploring).
// The property map moved to L.
import { S, bus } from '../core/state.js';
import { h, esc, clamp } from '../core/util.js';
import { auth } from '../core/auth.js';
import { makeGrid, blockRect, addressOf } from '/shared/city.js';
import { footprint, toWorld } from '/shared/geom.js';
import { RoadNetwork, samplePolyline, DEFAULT_ROAD_PROFILES } from '/shared/roads.js';
import { Router, alongRoute } from '/shared/route.js';
import { TYPE_ICON, TYPE_NAME } from './ui.js';
import { drawIcon, iconFor } from '../core/icons.js';
import { WaypointLayer } from '../render/waypoint.js';
import { islandPicture, onIslandPicture, islandStrips } from '../render/island-picture.js';
import { drawAirports, airportPlaces, isTerminal } from './airport-map.js';

let app, cam;
const E = {};
const M = {
  open: false, cx: 0, cz: 0, s: 0.4, sel: null, hover: null, waypoint: null, route: null, routeAt: 0, routeFrom: null,
  hide: new Set(), home: null, img: null, imgB: null, imgLoading: false, roads: null, router: null, worldRef: null, dirty: true,
};
const KINDS = [   // legend entries: key, label, icon
  ['you', 'You', '➤'], ['players', 'Players', '🧑'], ['home', 'Home', '🏡'], ['waypoint', 'Waypoint', '📍'],
  ['cafe', 'Cafés', '☕'], ['restaurant', 'Restaurants', '🍽️'], ['shop', 'Shops', '🛍️'], ['gym', 'Gyms', '🏋️'],
  ['park', 'Parks', '🌳'], ['metro', 'Metro', '🚇'], ['airport', 'Airports', '✈️'], ['dock', 'Fishing docks', '⚓'], ['office', 'Offices', '🏢'], ['apartment', 'Apartments', '🏠'], ['hq', 'Headquarters', '⭐'],
];
const BCOL = { office: '#5b6f8c', hq: '#a5483f', apartment: '#7d6a50', cafe: '#8a5f45', restaurant: '#8a4d45', shop: '#73608c', gym: '#467d6f', park: '#3d6a37' };
const ROUTE_COL = '#2f8cff', PIN_COL = '#c054ff', SEA = '#26404f';   // the route blue (2026-10-05), the waypoint's pin
const WALK = 1.55, DRIVE = 12;
const LS = 'mvw.waypoint';
const HINT = 'Drag to move · scroll or pinch to zoom · click a place for details';

export function init(a) {
  app = a; cam = a.cam;
  css();
  build(document.getElementById('ui'));
  app.worldmap = { open: () => setOpen(true), close: () => setOpen(false), setWaypoint, clearWaypoint, get state() { return M; } };
  app.waypoint = new WaypointLayer(app);
  app.hooks.key.unshift(onKey);
  bus.on('world', () => { M.roads = null; M.router = null; M.dirty = true; });
  bus.on('roads', () => { M.roads = null; M.router = null; if (M.waypoint) reroute(); M.dirty = true; });   // a road added, moved, renamed or removed: a fresh route
  bus.on('terrain', () => { M.img = null; M.dirty = true; });
  bus.on('wmods', () => { M.dirty = true; });   // an airport placed, moved or closed
  bus.on('msg:phomeat', m => { M.home = m.where ? { x: m.x, z: m.z, where: m.where } : null; M.dirty = true; });
  bus.on('mode', m => { E.radar.classList.toggle('hidden', m !== 'play'); if (m === 'play') askHome(); });
  bus.on('preframe', (dt, now) => frame(dt, now / 1000));
  onIslandPicture(() => { needImage(); M.dirty = true; });   // the island picture arrives or sharpens
  try { const w = JSON.parse(localStorage.getItem(LS) || 'null'); if (w && Number.isFinite(w.x)) M.waypoint = w; } catch { /* none */ }
}

// ------------------------------------------------------------------ data
function grid() { return makeGrid(S.world.grid); }
/** Island roads as polylines (the city's streets are drawn from the grid). */
function roadLines() {
  if (M.roads && M.worldRef === S.world.roads) return M.roads;
  M.worldRef = S.world.roads; M.roads = [];
  try {
    const net = RoadNetwork.fromJSON(S.world.roads || []);
    for (const r of net.all()) {
      const P = DEFAULT_ROAD_PROFILES[r.profile], w = P ? 2 * P.carriageHalf / 1e6 : 8;
      M.roads.push({ id: r.id, name: r.name || '', w, pts: samplePolyline(net.geometry(r.id), 0, { maxErr: 0.5, maxChord: 30 }) });
    }
  } catch { M.roads = []; }
  return M.roads;
}
/** In front of a building's door (where a route to it ends), or null. */
function doorOf(B) { return B.door && B.type !== 'park' ? toWorld(B, B.door.x, B.d / 2 + 2) : null; }
function router() { return (M.router ??= new Router(S.world)); }
/** Where the player is (playing: its body; otherwise its waiting character, if signed in). */
function me() {
  const P = app.player;
  if (P?.active) return { x: P.x, z: P.z, yaw: P.yaw, ctx: P.ctx };
  const r = app.remote?.me; return r ? { x: r.x, z: r.z, yaw: r.yaw || 0, ctx: r.ctx } : null;
}
function askHome() { if (auth.account && app.net?.connected) app.net.send({ t: 'phomeat' }); }
/** The island picture (render/island-picture.js: built once per land, kept in the browser, shared with the minimap). */
function needImage() { const p = islandPicture(); if (p) { M.img = p.canvas; M.imgB = p.bounds; } }
/** Every place the map shows and finds: { kind, name, x, z, icon, b? }. */
function places() {
  const out = [], airports = airportPlaces(S.world), terminals = new Map();
  for (const B of S.world.buildings) {
    if (!B || B.gone) continue;
    if (B.module && airports.some(a => a.module === B.module)) { terminals.set(B.module, B); continue; }   // (its airport or dock stands for it: the terminal, the store)
    out.push({ kind: B.type, name: B.name || TYPE_NAME[B.type] || 'Building', x: B.x, z: B.z, icon: TYPE_ICON[B.type] || '🏢', b: B.idx, door: doorOf(B) });
  }
  for (const st of S.world.stations || []) out.push({ kind: 'metro', name: `${st.name} station`, x: st.x, z: st.z, icon: '🚇' });
  for (const a of airports) { const B = terminals.get(a.module); out.push(B ? { ...a, b: B.idx, door: doorOf(B) } : a); }
  return out;
}

// ------------------------------------------------------------------ the map's drawing
/** Draws the world into ctx (W × H css px) for view { cx, cz, s (px per m), rot (radians, radar) }. */
function draw(ctx, W, H, v, opts = {}) {
  const g = grid(), s = v.s, rot = v.rot || 0;
  const X = x => (x - v.cx) * s, Z = z => (z - v.cz) * s;
  ctx.save();
  ctx.fillStyle = SEA; ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2); if (rot) ctx.rotate(rot);
  // the island
  needImage();
  if (M.img) {
    const b = M.imgB;
    ctx.filter = 'saturate(0.72) brightness(0.9) contrast(1.05)';
    ctx.drawImage(M.img, X(b.x0), Z(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
    const st = islandStrips(); if (st) { const H = Math.round(st.rows * st.canvas.height); if (H > 0) ctx.drawImage(st.canvas, 0, 0, st.canvas.width, H, X(b.x0), Z(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s * H / st.canvas.height); }
    ctx.filter = 'none';
  }
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // rivers
  const rivers = app.terrain?.ground?.island?.rivers || [];
  ctx.strokeStyle = '#3f7896'; ctx.lineWidth = Math.max(1, 6 * s);
  for (const R of rivers) { ctx.beginPath(); R.pts.forEach((q, k) => (k ? ctx.lineTo(X(q.x), Z(q.z)) : ctx.moveTo(X(q.x), Z(q.z)))); ctx.stroke(); }
  // airports: their paving, under the roads that lead to them (ui/airport-map.js)
  if (!M.hide.has('airport') || !M.hide.has('dock')) drawAirports(ctx, S.world, X, Z, s, { detail: !opts.radar || s > 0.3 });
  // what other parts mark on the map (the fishing trip's grounds and its course: play/fishing-game.js): app.mapMarks,
  // each drawn with the map's frame (rot: the radar's turn, for upright icons)
  for (const f of app.mapMarks || []) { try { f(ctx, X, Z, s, { radar: !!opts.radar, rot }); } catch { /* one layer's own problem */ } }
  // roads beyond the city: a dark edge, then the surface
  const roads = roadLines();
  for (const pass of [0, 1]) for (const r of roads) {
    ctx.strokeStyle = pass ? '#d9d4c7' : '#1d2226';
    ctx.lineWidth = Math.max(pass ? 1.6 : 3, r.w * s + (pass ? 0 : 2));
    ctx.beginPath(); r.pts.forEach((q, k) => (k ? ctx.lineTo(X(q.x), Z(q.z)) : ctx.moveTo(X(q.x), Z(q.z)))); ctx.stroke();
  }
  // the city: its streets, then the blocks, buildings by kind and parks
  if (!g.empty) { ctx.fillStyle = '#c9c5bb'; ctx.fillRect(X(g.minX), Z(g.minZ), (g.maxX - g.minX) * s, (g.maxZ - g.minZ) * s); }
  ctx.fillStyle = '#3a3f44';
  for (let i = 0; i < g.nx; i++) for (let j = 0; j < g.nz; j++) { const r = blockRect(g, i, j); ctx.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s); }
  if (s > 0.12) for (const B of S.world.buildings) {
    if (!B || B.gone || isTerminal(B)) continue;
    const fp = footprint(B);
    ctx.fillStyle = B.type === 'park' ? '#3d6a37' : (BCOL[B.type] || '#5a5f66');
    ctx.fillRect(X(fp.x0), Z(fp.z0), Math.max(1, (fp.x1 - fp.x0) * s), Math.max(1, (fp.z1 - fp.z0) * s));
  }
  // the route
  const R = M.route;
  if (R && !M.hide.has('waypoint')) {
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? ROUTE_COL : 'rgba(0,14,40,.7)'; ctx.lineWidth = pass ? Math.max(3, 4 * s) : Math.max(6, 4 * s + 3);
      ctx.beginPath(); R.pts.forEach((q, k) => (k ? ctx.lineTo(X(q[0]), Z(q[1])) : ctx.moveTo(X(q[0]), Z(q[1])))); ctx.stroke();
    }
  }
  // labels: roads, streets, the city (upright even on the turned radar)
  const label = (text, x, z, size, col = '#f2efe6', ang = 0) => {
    ctx.save(); ctx.translate(X(x), Z(z)); ctx.rotate(ang - (opts.upright ? rot : 0));
    ctx.font = `600 ${size}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = col === '#2b2b2b' ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.65)'; ctx.strokeText(text, 0, 0); ctx.fillStyle = col; ctx.fillText(text, 0, 0); ctx.restore();
  };
  if (!opts.radar) {
    if (s < 0.25 && s > 0.03 && !g.empty) label(S.world.name || 'The City', (g.minX + g.maxX) / 2, (g.minZ + g.maxZ) / 2, 13);
    if (s > 0.06) for (const r of roads) {
      if (!r.name || r.pts.length < 2) continue;
      const k = Math.floor(r.pts.length / 2), a = r.pts[k - 1] || r.pts[0], b = r.pts[k];
      let ang = Math.atan2(b.z - a.z, b.x - a.x); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      label(r.name, (a.x + b.x) / 2, (a.z + b.z) / 2, 11, '#fff7da', ang);
    }
    if (s > 0.7) {
      const mid = (arr, i) => (arr[i] + arr[i + 1]) / 2;
      g.X.forEach((x, i) => label(addressOf(g, x, g.Z[0]).split(' & ')[0], x, mid(g.Z, Math.floor(g.nz / 2)), 10, '#2b2b2b', -Math.PI / 2));
      g.Z.forEach((z, j) => label(addressOf(g, g.X[0], z).split(' & ')[1], mid(g.X, Math.floor(g.nx / 2)), z, 10, '#2b2b2b'));
    }
  }
  // icons
  const icon = (ch, x, z, size, ring = '#14171a') => {
    ctx.save(); ctx.translate(X(x), Z(z)); if (rot) ctx.rotate(-rot);
    ctx.beginPath(); ctx.arc(0, 0, size * 0.62, 0, Math.PI * 2); ctx.fillStyle = 'rgba(15,17,20,.82)'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = ring; ctx.stroke();
    if (!drawIcon(ctx, iconFor(ch), 0, 0, size * 0.74, '#f2f2f2')) { ctx.font = `${size * 0.72}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, 0, 1); }
    ctx.restore();
  };
  const big = opts.radar ? 15 : 20;
  if (!opts.radar || s > 0.5) for (const p of places()) {
    if (M.hide.has(p.kind)) continue;
    const show = p.kind === 'airport' || p.kind === 'dock' ? s > 0.03 : p.kind === 'park' || p.kind === 'hq' || p.kind === 'metro' ? s > 0.08 : (p.kind === 'office' || p.kind === 'apartment') ? s > 1.1 : s > 0.45;
    if (show) icon(p.icon, p.x, p.z, big * (p.kind === 'park' || p.kind === 'hq' ? 1.1 : 0.9), M.sel && M.sel.x === p.x && M.sel.z === p.z ? '#ffd76a' : '#14171a');
    if (!opts.radar && p.kind === 'park' && s > 0.3) label(p.name, p.x, p.z + 22 / s, 11, '#d9f2c9');
    if (!opts.radar && (p.kind === 'airport' || p.kind === 'dock') && s > 0.05) label(p.name, p.x, p.z + 24 / s, 12, '#e6f0ff');
  }
  if (M.home && !M.hide.has('home')) icon('🏡', M.home.x, M.home.z, big * 1.1, '#ffd76a');
  // players
  if (!M.hide.has('players')) for (const r of app.remote?.byPid?.values?.() || []) {
    if (r.you || r.gone || !r.extra) continue;
    ctx.save(); ctx.translate(X(r.extra.x), Z(r.extra.z)); if (rot) ctx.rotate(-rot);
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fillStyle = '#4aa8ff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#0b2235'; ctx.stroke();
    if (!opts.radar && s > 0.3 && r.name) { ctx.font = '600 11px system-ui'; ctx.fillStyle = '#cfe8ff'; ctx.textAlign = 'center'; ctx.fillText(r.name, 0, -10); }
    ctx.restore();
  }
  // the waypoint
  if (M.waypoint && !M.hide.has('waypoint')) {
    ctx.save(); ctx.translate(X(M.waypoint.x), Z(M.waypoint.z)); if (rot) ctx.rotate(-rot);
    ctx.fillStyle = PIN_COL; ctx.strokeStyle = '#1a0526'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-9, -12, -9, -24, 0, -24); ctx.bezierCurveTo(9, -24, 9, -12, 0, 0); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -17, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
  }
  // you: an arrow along your heading
  const m = me();
  if (m && !M.hide.has('you')) {
    ctx.save(); ctx.translate(X(m.x), Z(m.z)); ctx.rotate(Math.PI - m.yaw);   // the arrow points up (−z); a heading yaw faces (sin, cos)
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7.5, 8); ctx.lineTo(0, 4); ctx.lineTo(-7.5, 8); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#111'; ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  if (M.placing && M.pinAt && !opts.radar) {   // the pin riding with the pointer
    ctx.save(); ctx.translate(M.pinAt.x, M.pinAt.y);
    ctx.fillStyle = PIN_COL; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-11, -15, -11, -30, 0, -30); ctx.bezierCurveTo(11, -30, 11, -15, 0, 0); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -21, 4.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
  }
}

// ------------------------------------------------------------------ the full map
function build(root) {
  // a window the size of the Agent Studio over a dimmed world (2026-10-07: the same size, so the two feel alike); a
  // click on the dimmed world closes it. Everything inside is measured from the window, not the screen.
  E.wrap = root.appendChild(h(`<div id="wmap" class="hidden" role="dialog" aria-label="Map"><div class="wm-win">
    <canvas></canvas>
    <div class="wm-top panel"><b class="wm-title">🗺️ Map</b><div class="wm-search"><input type="search" placeholder="Search places, streets, players…" aria-label="Search the map"><div class="wm-res hidden"></div></div><button type="button" class="btn small wm-x" title="Close (M or Esc)">✕</button></div>
    <div class="wm-legend panel"><div class="wm-lh">Legend</div><div class="wm-lk"></div></div>
    <div class="wm-ctl"><div class="panel"><button type="button" class="btn wm-setwp" title="Set a waypoint: press, then click the place on the map (Esc cancels)" aria-label="Set a waypoint">📍</button><button type="button" class="btn wm-clrwp hidden" title="Clear the waypoint" aria-label="Clear the waypoint">🗑</button></div>
      <div class="panel wm-zoom"><button type="button" class="btn" data-z="1.6" title="Zoom in (+)" aria-label="Zoom in">＋</button><button type="button" class="btn" data-z="0.625" title="Zoom out (−)" aria-label="Zoom out">－</button><button type="button" class="btn wm-me" title="Center on you" aria-label="Center on you">◎</button></div></div>
    <div class="wm-card panel hidden"></div>
    <div class="wm-hint"></div>
  </div></div>`));
  E.win = E.wrap.querySelector('.wm-win');
  E.wrap.addEventListener('pointerdown', e => { if (e.target === E.wrap) setOpen(false); });
  E.cv = E.wrap.querySelector('canvas'); E.ctx = E.cv.getContext('2d');
  E.hint = E.wrap.querySelector('.wm-hint'); E.hint.textContent = HINT;
  E.setwp = E.wrap.querySelector('.wm-setwp'); E.setwp.onclick = () => placing(!M.placing);
  // Clear the waypoint (2026-10-06): under the pin, only while there is one
  E.clrwp = E.wrap.querySelector('.wm-clrwp'); E.clrwp.onclick = () => { clearWaypoint(); app.toast?.('Waypoint cleared', '', 1400); };
  wpButtons();
  E.card = E.wrap.querySelector('.wm-card'); E.q = E.wrap.querySelector('input'); E.res = E.wrap.querySelector('.wm-res');
  E.wrap.querySelector('.wm-x').onclick = () => setOpen(false);
  E.wrap.querySelector('.wm-me').onclick = () => { const m = me() || { x: cam.target.x, z: cam.target.z }; M.cx = m.x; M.cz = m.z; M.dirty = true; };
  E.wrap.querySelectorAll('[data-z]').forEach(b => { b.onclick = () => zoomAt(+b.dataset.z, E.W / 2, E.H / 2); });
  const lk = E.wrap.querySelector('.wm-lk');
  lk.innerHTML = KINDS.map(([k, l, ic]) => `<button type="button" class="wm-li" data-k="${k}"><span>${ic}</span>${esc(l)}</button>`).join('');
  lk.onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k; M.hide.has(k) ? M.hide.delete(k) : M.hide.add(k); b.classList.toggle('off', M.hide.has(k)); M.dirty = true; };
  E.wrap.querySelector('.wm-lh').onclick = () => E.wrap.querySelector('.wm-legend').classList.toggle('shut');
  if (matchMedia('(pointer: coarse)').matches) E.wrap.querySelector('.wm-legend').classList.add('shut');   // phones: the legend opens on a tap
  // search
  E.q.addEventListener('input', search);
  E.q.addEventListener('keydown', e => { if (e.key === 'Enter') { const f = E.res.querySelector('[data-i]'); if (f) f.click(); e.preventDefault(); } if (e.key === 'Escape') { E.q.value = ''; search(); E.q.blur(); } e.stopPropagation(); });
  E.res.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const r = E.found[+b.dataset.i]; E.res.classList.add('hidden'); E.q.blur(); pick(r, true); };
  // pan, zoom, pick
  const pts = new Map(); let drag = null, pinch = null, moved = false;
  /** A pointer's place on the map's canvas (its own box, in CSS pixels). */
  const at = e => { const r = E.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  E.cv.addEventListener('pointerdown', e => { E.cv.setPointerCapture(e.pointerId); const p = at(e); pts.set(e.pointerId, p); moved = false;
    if (pts.size === 1) drag = { x: p.x, y: p.y, cx: M.cx, cz: M.cz };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: M.s }; drag = null; } });
  E.cv.addEventListener('pointermove', e => {
    const p = at(e);
    if (!pts.has(e.pointerId)) { hoverAt(p.x, p.y); if (M.placing) { M.pinAt = p; M.dirty = true; } return; }
    pts.set(e.pointerId, p);
    if (pinch && pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); zoomTo(pinch.s * d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2); moved = true; return; }
    if (drag) { const dx = p.x - drag.x, dy = p.y - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) moved = true; M.cx = drag.cx - dx / M.s; M.cz = drag.cz - dy / M.s; M.dirty = true; }
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { if (drag && !moved) { const p = at(e); clickAt(p.x, p.y); } drag = null; } };
  E.cv.addEventListener('pointerup', up); E.cv.addEventListener('pointercancel', up);
  E.cv.addEventListener('contextmenu', e => { if (M.placing) { e.preventDefault(); placing(false); } });
  E.cv.addEventListener('wheel', e => { e.preventDefault(); const p = at(e); zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y); }, { passive: false });
  // the radar and the directions
  E.radar = root.appendChild(h('<div id="radar" class="hidden" title="Map (M)"><canvas></canvas><b class="rn">N</b></div>'));
  E.rcv = E.radar.querySelector('canvas'); E.rctx = E.rcv.getContext('2d');
  E.radar.onclick = () => setOpen(true);
  E.gps = root.appendChild(h('<div id="gpshud" class="panel hidden"><span class="gi"></span><div><b class="gd"></b> <span class="gt"></span><div class="gr dim"></div></div><button type="button" class="btn small icon gx" title="End the route">✕</button></div>'));
  E.gps.querySelector('.gx').onclick = clearWaypoint;
  // the map button with the floating buttons while exploring; playing, a tap on the radar opens the map (and M)
  const fb = document.querySelector('#floatbtns .fb-main') || document.getElementById('floatbtns');
  if (fb) { const b = h('<button type="button" class="btn wmapbtn" title="Map (M)" aria-label="Map">🗺️</button>'); b.onclick = () => setOpen(!M.open); fb.prepend(b); }
}
function setOpen(on) {
  if (on === M.open) return;
  M.open = on; app.mapOpen = on;
  E.wrap.classList.toggle('hidden', !on); document.body.classList.toggle('wmap-open', on);
  if (on) {
    needImage(); askHome();
    const m = me(); const c = m || { x: cam.target.x, z: cam.target.z };
    M.cx = c.x; M.cz = c.z; M.s = Math.max(M.s, 0.25);
    M.camKeys = cam.keysEnabled; cam.keysEnabled = false;
    resize(); M.dirty = true;
  } else { cam.keysEnabled = M.camKeys ?? true; E.res.classList.add('hidden'); if (M.placing) placing(false); }
}
/** The canvas takes the window's size (E.W × E.H, CSS pixels): the map's points are measured from it. */
function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1), W = Math.max(1, E.win.clientWidth), H = Math.max(1, E.win.clientHeight);
  E.W = W; E.H = H;
  E.cv.width = Math.round(W * dpr); E.cv.height = Math.round(H * dpr); E.cv.style.width = W + 'px'; E.cv.style.height = H + 'px';
  E.dpr = dpr; M.dirty = true;
}
addEventListener('resize', () => { if (M.open) resize(); });
const scr2w = (sx, sy) => ({ x: M.cx + (sx - E.W / 2) / M.s, z: M.cz + (sy - E.H / 2) / M.s });
function zoomTo(s, sx, sy) { const w = scr2w(sx, sy); M.s = clamp(s, 0.015, 6); M.cx = w.x - (sx - E.W / 2) / M.s; M.cz = w.z - (sy - E.H / 2) / M.s; M.dirty = true; }
function zoomAt(f, sx, sy) { zoomTo(M.s * f, sx, sy); }
/** What lies at a world point, in words. */
function describe(x, z) {
  const g = grid();
  if (x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ) return addressOf(g, x, z);
  const near = router().attach(x, z, 60);
  return near ? `Near ${router().name(near.id)}` : 'The island';
}
/** The nearest thing under a screen point: a place's icon, a building, a road, or just the spot. */
function hit(sx, sy) {
  const w = scr2w(sx, sy), R = 16 / M.s;
  let best = null, bd = R;
  for (const p of places()) { if (M.hide.has(p.kind)) continue; const d = Math.hypot(p.x - w.x, p.z - w.z); if (d < bd) { bd = d; best = p; } }
  if (M.home && Math.hypot(M.home.x - w.x, M.home.z - w.z) < bd) best = { kind: 'home', name: 'Home', x: M.home.x, z: M.home.z, icon: '🏡', sub: M.home.where };
  for (const r of app.remote?.byPid?.values?.() || []) { if (r.you || r.gone || !r.extra) continue; const d = Math.hypot(r.extra.x - w.x, r.extra.z - w.z); if (d < bd) { bd = d; best = { kind: 'player', name: r.name || 'A player', x: r.extra.x, z: r.extra.z, icon: '🧑' }; } }
  if (best) return best;
  for (const B of S.world.buildings) { if (!B || B.gone || isTerminal(B)) continue; const fp = footprint(B); if (w.x >= fp.x0 && w.x <= fp.x1 && w.z >= fp.z0 && w.z <= fp.z1) return { kind: B.type, name: B.name, x: B.x, z: B.z, icon: TYPE_ICON[B.type] || '🏢', b: B.idx, door: doorOf(B) }; }
  return { kind: 'spot', name: describe(w.x, w.z), x: w.x, z: w.z, icon: '📌' };
}
function hoverAt(sx, sy) { const t = hit(sx, sy); E.cv.style.cursor = t.kind === 'spot' ? 'grab' : 'pointer'; E.cv.title = t.kind === 'spot' ? '' : t.name; }
function clickAt(sx, sy) {
  if (M.placing) {   // dropping the carried pin: on a building, at its door; else just there
    const t = hit(sx, sy), d = t.kind === 'spot' ? scr2w(sx, sy) : (t.door || t);
    placing(false); setWaypoint(d.x, d.z, t.kind === 'spot' ? describe(d.x, d.z) : t.name); pick({ ...t, x: d.x, z: d.z, door: null }, false);
    return;
  }
  pick(hit(sx, sy), false);
}
/** "Set waypoint" (2026-10-05: press it first, then the pin rides with the pointer until a click drops it). */
function placing(on) {
  M.placing = on; M.pinAt = on ? M.pinAt : null; M.dirty = true;
  E.wrap.classList.toggle('placing', on);
  E.setwp.textContent = on ? '✕' : '📍';
  E.setwp.title = on ? 'Cancel the waypoint (Esc)' : 'Set a waypoint: press, then click the place on the map (Esc cancels)';
  E.setwp.setAttribute('aria-label', on ? 'Cancel the waypoint' : 'Set a waypoint'); E.setwp.classList.toggle('on', on);
  E.hint.textContent = on ? (matchMedia('(pointer: coarse)').matches ? 'Tap the place for the waypoint' : 'Click the place for the waypoint · Esc or right-click cancels') : HINT;
}
function pick(t, center) {
  M.sel = t; M.dirty = true;
  if (center) { M.cx = t.x; M.cz = t.z; M.s = Math.max(M.s, 0.8); }
  const m = me(), d = m ? Math.hypot(t.x - m.x, t.z - m.z) : null;
  const kind = TYPE_NAME[t.kind] || { metro: 'Metro station', airport: 'Airport', dock: 'Fishing dock', terminal: 'Airport terminal', home: 'Your home', player: 'Player', spot: 'Location' }[t.kind] || '';
  const playing = app.player?.active, isWp = M.waypoint && Math.hypot(M.waypoint.x - (t.door || t).x, M.waypoint.z - (t.door || t).z) < 1;
  E.card.innerHTML = `<div class="wc-h"><span class="wc-i">${t.icon}</span><div><b>${esc(t.name)}</b><div class="dim">${esc(kind)}${t.sub ? ' · ' + esc(t.sub) : ''}${t.kind !== 'spot' ? ' · ' + esc(describe(t.x, t.z)) : ''}</div></div><button type="button" class="btn small icon wc-x" title="Close">✕</button></div>
    ${d !== null ? `<div class="wc-d">${fmtDist(d)} away · ${fmtTime(d / WALK)} on foot · ${fmtTime(d / DRIVE)} by car</div>` : ''}
    <div class="wc-b">${isWp ? '<button type="button" class="btn small wc-clear">✕ Remove waypoint</button>' : center ? '<button type="button" class="btn small primary wc-wp">📍 Set waypoint here</button>' : ''}
    ${playing && auth.account ? '<button type="button" class="btn small wc-tr" title="Travel there now (once every 10 s)">🚀 Travel here</button>' : ''}
    ${!playing ? '<button type="button" class="btn small wc-look">🔭 Look here</button>' : ''}</div>`;
  E.card.classList.remove('hidden');
  E.wrap.classList.add('card-open');
  E.card.querySelector('.wc-x').onclick = () => { E.card.classList.add('hidden'); E.wrap.classList.remove('card-open'); M.sel = null; M.dirty = true; };
  E.card.querySelector('.wc-wp')?.addEventListener('click', () => { const d = t.door || t; setWaypoint(d.x, d.z, t.name); pick(t, false); });
  E.card.querySelector('.wc-clear')?.addEventListener('click', () => { clearWaypoint(); pick(t, false); });
  E.card.querySelector('.wc-tr')?.addEventListener('click', () => { const d = t.door || t; app.net.send({ t: 'ptravel', x: d.x, z: d.z }); setOpen(false); });
  E.card.querySelector('.wc-look')?.addEventListener('click', () => { setOpen(false); app.stopFollow?.(); cam.flyTo(t.x, 0, t.z, 60); });
}
const fold = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();   // café = cafe
function search() {
  const q = fold(E.q.value.trim());
  if (!q) { E.res.classList.add('hidden'); return; }
  const out = [];
  for (const p of places()) if (fold(p.name).includes(q) || fold(TYPE_NAME[p.kind]).includes(q)) out.push(p);
  for (const r of roadLines()) if (fold(r.name).includes(q)) { const k = Math.floor(r.pts.length / 2); out.push({ kind: 'road', name: r.name, x: r.pts[k].x, z: r.pts[k].z, icon: '🛣️' }); }
  const g = grid(), names = new Set();
  g.X.forEach((x, i) => { const n = addressOf(g, x, g.Z[0]).split(' & ')[0]; if (fold(n).includes(q) && !names.has(n)) { names.add(n); out.push({ kind: 'road', name: n, x, z: (g.minZ + g.maxZ) / 2, icon: '🛣️' }); } void i; });
  g.Z.forEach(z => { const n = addressOf(g, g.X[0], z).split(' & ')[1]; if (fold(n).includes(q) && !names.has(n)) { names.add(n); out.push({ kind: 'road', name: n, x: (g.minX + g.maxX) / 2, z, icon: '🛣️' }); } });
  for (const r of app.remote?.byPid?.values?.() || []) if (!r.you && r.name && fold(r.name).includes(q) && r.extra) out.push({ kind: 'player', name: r.name, x: r.extra.x, z: r.extra.z, icon: '🧑' });
  if (M.home && 'home'.includes(q)) out.unshift({ kind: 'home', name: 'Home', x: M.home.x, z: M.home.z, icon: '🏡', sub: M.home.where });
  E.found = out.slice(0, 9);
  E.res.innerHTML = E.found.length ? E.found.map((r, i) => `<button type="button" data-i="${i}"><span>${r.icon}</span>${esc(r.name)}<small>${esc(TYPE_NAME[r.kind] || (r.kind === 'road' ? 'Road' : r.kind === 'metro' ? 'Metro' : r.kind === 'airport' ? 'Airport' : r.kind === 'dock' ? 'Fishing dock' : r.kind === 'player' ? 'Player' : ''))}</small></button>`).join('') : '<div class="dim" style="padding:8px">Nothing found</div>';
  E.res.classList.remove('hidden');
}

// ------------------------------------------------------------------ GPS
function setWaypoint(x, z, label = '') {
  M.waypoint = { x, z, label }; M.route = null; M.routeAt = 0;
  try { localStorage.setItem(LS, JSON.stringify(M.waypoint)); } catch { /* private mode */ }
  reroute(); M.dirty = true;
  app.toast?.(`📍 Waypoint: ${label || describe(x, z)}`, 'good', 2200);
  wpButtons();
}
function clearWaypoint() {
  M.waypoint = null; M.route = null;
  try { localStorage.removeItem(LS); } catch { /* none */ }
  E.gps.classList.add('hidden'); M.dirty = true;
  wpButtons();
}
/** The map's Clear button shows while there is a waypoint. */
function wpButtons() { E.clrwp?.classList.toggle('hidden', !M.waypoint); }
function reroute() {
  let m = me();
  if (m && m.ctx >= 0) { const B = S.world.buildings[m.ctx >> 6], d = B && doorOf(B); if (d) m = { ...m, x: d.x, z: d.z }; }   // inside: from its door
  if (!M.waypoint || !m) { M.route = null; return; }
  try { M.route = router().route({ x: m.x, z: m.z }, M.waypoint); } catch { M.route = null; }
  M.routeFrom = { x: m.x, z: m.z }; M.routeAt = performance.now();
}
const TURN_ICON = { left: '↰', right: '↱', 'slight left': '↖', 'slight right': '↗', straight: '↑', 'u-turn': '⤾', arrive: '🏁', start: '↑' };
function fmtDist(d) { return d >= 1000 ? `${(d / 1000).toFixed(d >= 10000 ? 0 : 1)} km` : `${Math.max(5, Math.round(d / 5) * 5)} m`; }
function fmtTime(sec) { return sec < 60 ? 'under a minute' : sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`; }
/** The directions panel and re-routing, while playing with a waypoint. */
function gpsFrame() {
  const m = me(), playing = app.player?.active;
  if (!M.waypoint || !m || !playing) { E.gps.classList.add('hidden'); return; }
  const dw = Math.hypot(M.waypoint.x - m.x, M.waypoint.z - m.z);
  if (dw < 12) { app.toast?.(`🏁 You've arrived${M.waypoint.label ? ': ' + M.waypoint.label : ''}`, 'good', 3000); clearWaypoint(); return; }
  const now = performance.now();
  if (!M.route) { if (now - M.routeAt > 1500) reroute(); }
  const R = M.route;
  if (!R) { E.gps.classList.remove('hidden'); E.gps.querySelector('.gi').textContent = '📍'; E.gps.querySelector('.gd').textContent = fmtDist(dw); E.gps.querySelector('.gt').textContent = 'to the waypoint'; E.gps.querySelector('.gr').textContent = ''; return; }
  const on = alongRoute(R.pts, m.x, m.z);
  if (on.off > 25 && now - M.routeAt > 1500) { reroute(); return; }   // off the route: a new one
  const next = R.steps.find(s => s.turn !== 'start' && s.at > on.along + 4) || R.steps.at(-1);
  const left = Math.max(0, R.length - on.along), speed = app.driving?.id ? DRIVE : WALK;
  E.gps.classList.remove('hidden');
  E.gps.querySelector('.gi').textContent = TURN_ICON[next.turn] || '↑';
  E.gps.querySelector('.gd').textContent = fmtDist(Math.max(0, next.at - on.along));
  E.gps.querySelector('.gt').textContent = next.turn === 'arrive' ? `to ${M.waypoint.label || 'the waypoint'}` : `${next.turn === 'straight' ? 'Continue onto' : next.turn === 'u-turn' ? 'Make a U-turn onto' : 'Turn ' + next.turn + ' onto'} ${next.road}`;
  E.gps.querySelector('.gr').textContent = `${fmtDist(left)} · ${fmtTime(left / speed)}`;
  M.routeOn = on;
}

// ------------------------------------------------------------------ every frame
let lastRadar = 0;
function frame(dt, t) {
  if (M.open && M.dirty) {
    M.dirty = false;
    E.ctx.setTransform(E.dpr, 0, 0, E.dpr, 0, 0);
    draw(E.ctx, E.W, E.H, { cx: M.cx, cz: M.cz, s: M.s });
  }
  if (M.open && (app.remote?.byPid?.size || app.player?.active) && t - (M.lastLive || 0) > 0.25) { M.lastLive = t; M.dirty = true; }   // players move
  gpsFrame();
  app.waypoint?.update(M.waypoint);
  // the radar, ~20 times a second
  if (!E.radar.classList.contains('hidden') && t - lastRadar > 0.05) {
    lastRadar = t; needImage();
    const m = me(); if (!m) return;
    const r = E.radar.getBoundingClientRect(), W = r.width || 180, H = r.height || 180, dpr = Math.min(2, devicePixelRatio || 1);
    if (E.rcv.width !== Math.round(W * dpr)) { E.rcv.width = Math.round(W * dpr); E.rcv.height = Math.round(H * dpr); }
    const speed = app.player?.speed || 0, s = clamp(1.5 - speed * 0.06, 0.45, 1.5) * (W / 180);
    // up on the radar is where the camera looks
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rot = -Math.PI / 2 - Math.atan2(fz, fx);
    E.rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(E.rctx, W, H, { cx: m.x, cz: m.z, s, rot }, { radar: true, upright: true });
    E.radar.querySelector('.rn').style.transform = `translate(-50%, -50%) rotate(${rot}rad) translateY(${-(Math.min(W, H) / 2 - 10)}px) rotate(${-rot}rad)`;
    // the waypoint off the radar: a mark on its edge
    if (M.waypoint) {
      const dx = (M.waypoint.x - m.x) * s, dz = (M.waypoint.z - m.z) * s, c = Math.cos(rot), sn = Math.sin(rot), px = dx * c - dz * sn, pz = dx * sn + dz * c;
      const lim = Math.min(W, H) / 2 - 8;
      if (Math.max(Math.abs(px), Math.abs(pz)) > lim) {
        const k = lim / Math.max(Math.abs(px), Math.abs(pz)), ctx = E.rctx;
        ctx.save(); ctx.translate(W / 2 + px * k, H / 2 + pz * k); ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fillStyle = PIN_COL; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore();
      }
    }
  }
  if (M.waypoint && !M.route && me() && performance.now() - M.routeAt > 3000) reroute();
}

// ------------------------------------------------------------------ keys
function onKey(e) {
  if (e.code === 'KeyM' && !e.repeat) { setOpen(!M.open); return true; }
  if (!M.open) return false;
  if (e.key === 'Escape' && M.placing) { placing(false); return true; }
  if (e.key === 'Escape') { if (!E.card.classList.contains('hidden')) { E.card.classList.add('hidden'); E.wrap.classList.remove('card-open'); M.sel = null; M.dirty = true; } else setOpen(false); return true; }
  if (e.key === '+' || e.key === '=') { zoomAt(1.4, E.W / 2, E.H / 2); return true; }
  if (e.key === '-' || e.key === '_') { zoomAt(1 / 1.4, E.W / 2, E.H / 2); return true; }
  const pan = 120 / M.s, k = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.code];
  if (k) { M.cx += k[0] * pan; M.cz += k[1] * pan; M.dirty = true; return true; }
  return true;   // the map takes the keyboard while it is open
}

function css() {
  const st = document.createElement('style');
  st.textContent = `
#wmap { position: fixed; inset: 0; z-index: 60; background: var(--scrim, rgba(0, 0, 0, .45)); display: grid; place-items: center; }
#wmap.hidden { display: none; }
/* the same size and place as the Agent Studio (css/studio.css .studio) */
#wmap .wm-win { position: relative; overflow: hidden; touch-action: none; background: ${SEA}; border-radius: 18px; border: 1px solid var(--line-2, rgba(255,255,255,.12));
  box-shadow: 0 24px 60px rgba(0, 0, 0, .45); width: var(--win-w, min(1260px, calc(100vw - 24px))); height: var(--win-h, min(840px, calc(100dvh - var(--topbar-height, 56px) - 20px)));
  margin-top: var(--topbar-height, 56px); animation: wm-in .28s cubic-bezier(.2, .9, .3, 1.1); }
@keyframes wm-in { from { opacity: 0; transform: translateY(14px) scale(.985); } }
#wmap canvas { position: absolute; inset: 0; cursor: grab; }
#wmap .wm-top { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; align-items: center; gap: 10px; padding: 8px 10px; }
#wmap .wm-title { white-space: nowrap; }
#wmap .wm-search { position: relative; flex: 1; max-width: 460px; }
#wmap .wm-search input { width: 100%; box-sizing: border-box; }
#wmap .wm-res { position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: var(--panel, #1b1f24); border: 1px solid var(--line, #333); border-radius: 10px; max-height: 50vh; overflow: auto; z-index: 2; }
#wmap .wm-res button { display: flex; width: 100%; align-items: center; gap: 8px; padding: 8px 10px; background: none; border: 0; color: inherit; text-align: left; cursor: pointer; font: inherit; }
#wmap .wm-res button:hover { background: rgba(255,255,255,.07); }
#wmap .wm-res small { margin-left: auto; opacity: .6; }
#wmap .wm-x { margin-left: auto; }
#wmap .wm-legend { position: absolute; right: 10px; top: 68px; padding: 8px; max-height: calc(100% - 160px); overflow: auto; width: 168px; }
#wmap .wm-legend.shut .wm-lk { display: none; }
#wmap .wm-lh { font-weight: 700; cursor: pointer; padding: 2px 4px 6px; }
#wmap .wm-li { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 6px; background: none; border: 0; color: inherit; cursor: pointer; border-radius: 7px; font: inherit; text-align: left; }
#wmap .wm-li:hover { background: rgba(255,255,255,.07); }
#wmap .wm-li.off { opacity: .38; text-decoration: line-through; }
#wmap .wm-li span { width: 22px; text-align: center; }
/* the map's buttons (2026-10-06): like the main screen's corner — the waypoint in a panel of its own above one with zoom
   and centre, the same button size and style, 12 px from the side and the bottom */
#wmap .wm-ctl { position: absolute; right: 12px; bottom: 12px; display: flex; flex-direction: column; gap: 8px; }
#wmap .wm-ctl .panel { display: flex; flex-direction: column; gap: 4px; padding: 6px; }
#wmap .wm-ctl .btn { width: 36px; height: 34px; padding: 0; border-radius: 9px; font-size: 16px; display: inline-grid; place-items: center; }
@media (pointer: coarse) { #wmap .wm-ctl .btn { width: 42px; height: 40px; font-size: 18px; } }
#wmap .wm-setwp.on { border-color: #5aa2ff; color: #8ec1ff; background: rgba(47, 140, 255, .18); }   /* placing: the route's blue */
#wmap.placing canvas { cursor: none; }
#wmap .wm-card { position: absolute; left: 10px; bottom: 20px; width: min(360px, calc(100% - 80px)); padding: 10px 12px; }
#wmap .wc-h { display: flex; gap: 10px; align-items: center; }
#wmap .wc-h .wc-x { margin-left: auto; }
#wmap .wc-i { font-size: 26px; }
#wmap .wc-d { margin: 8px 0; opacity: .85; }
#wmap .wc-b { display: flex; gap: 8px; flex-wrap: wrap; }
#wmap .wm-hint { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); font-size: 12px; opacity: .7; pointer-events: none; white-space: nowrap; }
#radar { position: fixed; left: calc(var(--dock-lb, 0px) + 12px); bottom: 12px; width: 190px; height: 190px; border-radius: 18px; overflow: hidden; z-index: 3; border: 2px solid rgba(255,255,255,.35); box-shadow: 0 6px 24px rgba(0,0,0,.45); cursor: pointer; }
#radar canvas { width: 100%; height: 100%; display: block; }
#radar .rn { position: absolute; left: 50%; top: 50%; font: 700 11px system-ui; color: #fff; background: rgba(0,0,0,.6); border-radius: 50%; width: 18px; height: 18px; line-height: 18px; text-align: center; pointer-events: none; }
body.play #minimap { display: none !important; }
#gpshud { position: fixed; top: 66px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 8px 12px; z-index: 4; min-width: 220px; max-width: calc(100vw - 30px); }
#gpshud .gi { font-size: 28px; color: ${ROUTE_COL}; width: 32px; text-align: center; }
#gpshud .gd { font-size: 17px; }
#gpshud .gr { font-size: 12px; }
body.wmap-open #gpshud, body.wmap-open #radar { display: none; }
@media (max-width: 760px) {
  #wmap .wm-win { width: 100vw; height: calc(100dvh - var(--topbar-height, 44px)); border-radius: 0; border: 0; }   /* a phone: the screen under the top bar, as the Studio */
}
@media (max-width: 760px), (pointer: coarse) {
  #radar { width: 112px; height: 112px; left: 10px; top: calc(var(--topbar-height, 44px) + 8px); bottom: auto; border-radius: 14px; }   /* the corner under the top bar */
  #gpshud { top: 108px; left: 132px; right: 10px; transform: none; min-width: 0; padding: 6px 10px; }
  #gpshud .gi { font-size: 22px; width: 24px; }
  #gpshud .gd { font-size: 15px; }
  #wmap .wm-card:not(.hidden) ~ .wm-legend, #wmap.card-open .wm-legend { display: none; }
  #wmap .wm-legend { top: auto; bottom: 12px; right: 78px; width: 150px; max-height: 40vh; }   /* beside the buttons */
  #wmap .wm-legend:not(.shut) { }
  #wmap .wm-title { display: none; }
  #wmap .wm-hint { display: none; }
}`;
  document.head.appendChild(st);
}
