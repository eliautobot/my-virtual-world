// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Lots section of the edit dock (the product owner, 2026-10-09: "admins are the only ones that can create more lots. We
// need a lots tab in the edit panel so the admin can create the lot, give it zoning and value for sale. Make it
// intuitive and easy. Also lots should connect to roadways so that a building can be placed there that connects").
// Administrators tap the ground beside a road beyond the city: the lots appear there, fronting that road — a row centred
// on the tap, continuing a row of lots already beside it — with their size, how many (or all along the road, one side
// or both), zoning and sale: at the day's market value, at a price, or kept by the city. The preview is
// shared/plat-road.js, the same function the server makes them with (/api/property/plat-road), so what shows is what is
// made; then they go up for sale for Virtual Coin (the economy) or as city land for sale.
// Lots only ever front a road, and a building on one connects to it (its door must face the road: shared/door-access.js).
// Beside a grid's road (the grid layout tool) the tap fills the block (2026-10-14, the product owner: "fill this block"):
// its lots made exactly as the grid tool made the rest — runs from the back of one sidewalk to the next, lots of equal
// width, corner lots giving up the junction's rounded corner (shared/road-grid.js blockRuns, /api/property/plat-grid);
// a road's own rows keep clear of the whole circle round each junction, which in a grid leaves no room for a lot.
// Changing a lot afterwards — zoning, price, sale, hold, transfer — is its card on the lot map (ui/property.js).
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { h, esc, isTouch } from '../core/util.js';
import { auth } from '../core/auth.js';
import { post, getJSON } from '../core/net.js';
import { platAlongRoad, sideName } from '/shared/plat-road.js';
import { makeGrid } from '/shared/city.js';
import { blockRuns } from '/shared/road-grid.js';
import { DEFAULT_ENVELOPES, ENVELOPE_FALLBACK } from '/shared/lots.js';
import { ZONES } from '../render/lots.js';

const FT = 0.3048;
const SIZES = [['std', 'Standard', 100, 100], ['narrow', 'Narrow', 50, 100], ['deep', 'Deep', 100, 200], ['large', 'Large', 200, 200]];
const SKIP = { water: 'in water', city: 'in the city', road: 'on another road', junction: 'at a junction', lot: 'on lots already there', building: 'on a building', shape: 'twisted on a tight bend' };
const REACH = 60;      // m: a tap this close to a road picks it
const MAX_N = 20;      // lots in a row, each side
const T = { on: false, at: null, hover: null, size: 'std', w: 100, d: 100, n: 1, both: false, all: false, block: true, zoning: 'residential', sale: 'market', busy: false, res: null, range: null };
let app = null, cam = null, E = {}, ghost = null, ptr = { x: 0, y: 0, moved: false };
const key = () => `lots-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const phone = () => matchMedia('(max-width: 760px)').matches;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export function init(a) {
  app = a; cam = a.cam;
  const slot = a.docks && a.docks.slot('l:lots');
  if (!slot) return;
  slot.appendChild(h(`<div class="lottools">
    <p class="hint">New lots go beside a road beyond the city, fronting it, so whatever is built on them connects to the road.</p>
    <div class="row"><button type="button" class="btn primary lt-make">📐 Make lots</button><button type="button" class="btn lt-map" title="Every lot, coloured by status, value or zoning: tap one to change it">🗺️ Lot map</button></div>
    <div class="lt-form hidden">
      <p class="lt-step"><b>1</b> <span class="lt-where">Tap the ground beside a road.</span></p>
      <div class="lt-f"><span class="lt-l">Size</span><div class="chips lt-sizes">${SIZES.map(([k, t, w, d]) => `<button type="button" class="chip" data-k="${k}">${t}<small>${w} × ${d} ft</small></button>`).join('')}<button type="button" class="chip" data-k="custom">Custom</button></div>
        <div class="row lt-custom hidden"><input type="number" class="input lt-w" min="20" max="600" step="5" value="100" aria-label="Width along the road (ft)"> × <input type="number" class="input lt-d" min="20" max="600" step="5" value="100" aria-label="Depth from the road (ft)"> ft <small class="dim">along the road × back from it</small></div></div>
      <div class="lt-f"><span class="lt-l">How many</span><div class="row"><span class="stepper"><button type="button" class="btn small lt-minus" aria-label="Fewer">−</button><b class="lt-n">1</b><button type="button" class="btn small lt-plus" aria-label="More">＋</button></span>
        <button type="button" class="chip lt-both" aria-pressed="false">Both sides</button><button type="button" class="chip lt-all" aria-pressed="false">All along the road</button></div>
        <button type="button" class="chip lt-block hidden" aria-pressed="true" title="A grid's block filled like the rest of the grid: its lots of this size, both rows">🏘️ Fill the block</button></div>
      <div class="lt-f"><span class="lt-l">Zoning</span><div class="chips lt-zones">${Object.keys(DEFAULT_ENVELOPES).map(z => `<button type="button" class="chip" data-z="${z}"><i class="dot" style="background:${ZONES[z]?.color || '#888'}"></i>${esc(ZONES[z]?.label || cap(z))}</button>`).join('')}</div><small class="dim lt-zhint"></small></div>
      <div class="lt-f lt-salef"><span class="lt-l">For sale</span><div class="lt-sale"></div></div>
      <p class="hint lt-stat"></p>
      <div class="row"><button type="button" class="btn primary lt-go" disabled>✅ Create</button><button type="button" class="btn lt-stop">Done</button></div>
    </div>
    <div class="lt-made"></div>
  </div>`));
  const q = s => slot.querySelector(s);
  E = { root: q('.lottools'), make: q('.lt-make'), map: q('.lt-map'), form: q('.lt-form'), where: q('.lt-where'), sizes: q('.lt-sizes'), custom: q('.lt-custom'), w: q('.lt-w'), d: q('.lt-d'),
    n: q('.lt-n'), minus: q('.lt-minus'), plus: q('.lt-plus'), both: q('.lt-both'), all: q('.lt-all'), block: q('.lt-block'), zones: q('.lt-zones'), zhint: q('.lt-zhint'), sale: q('.lt-sale'),
    stat: q('.lt-stat'), go: q('.lt-go'), stop: q('.lt-stop'), made: q('.lt-made') };
  E.make.onclick = () => (T.on ? stop() : start());
  E.stop.onclick = () => stop();
  E.map.onclick = () => app.property?.show(true);
  E.sizes.onclick = e => { const b = e.target.closest('[data-k]'); if (b) setSize(b.dataset.k); };
  E.w.oninput = E.d.oninput = () => { T.w = clampFt(E.w.value); T.d = clampFt(E.d.value); preview(); };
  E.minus.onclick = () => setN(T.n - 1); E.plus.onclick = () => setN(T.n + 1);
  E.both.onclick = () => { T.both = !T.both; sync(); preview(); };
  E.all.onclick = () => { T.all = !T.all; sync(); preview(); };
  E.block.onclick = () => { T.block = !T.block; sync(); where(); preview(); };
  E.zones.onclick = e => { const b = e.target.closest('[data-z]'); if (b) { T.zoning = b.dataset.z; sync(); } };
  E.go.onclick = () => create();
  E.made.onclick = e => { const b = e.target.closest('[data-lot]'); if (b) app.property?.open(b.dataset.lot); };
  // with the edit dock closed (a phone's drawer, mostly): a bar over the world says what's happening and makes the lots
  E.bar = document.getElementById('ui').appendChild(h(`<div id="lotbar" class="panel hidden" role="toolbar" aria-label="Making lots">
    <span class="lb-stat"></span><div class="lb-btns"><button type="button" class="btn small lb-opts">⚙️ Options</button><button type="button" class="btn small primary lb-go" disabled>✅ Create</button><button type="button" class="btn small lb-stop" aria-label="Stop making lots">✕</button></div></div>`));
  E.bar.querySelector('.lb-opts').onclick = () => { app.docks.open('left', true); app.docks.show('l:lots'); };
  E.bar.querySelector('.lb-go').onclick = () => create();
  E.bar.querySelector('.lb-stop').onclick = () => stop();
  ghost = new THREE.Group(); ghost.name = 'lot-ghost'; ghost.renderOrder = 6; a.stage.scene.add(ghost);
  // while making lots, taps on the world are this tool's (before the road and building tools)
  app.hooks.click.unshift(onClick); app.hooks.key.unshift(onKey); app.hooks.hover.unshift(() => T.on);
  app.lotTools = { active: () => T.on, forRoad };
  a.stage.renderer.domElement.addEventListener('pointermove', e => { ptr.x = e.clientX; ptr.y = e.clientY; ptr.moved = true; });
  bus.on('frame', frame);
  bus.on('mode', m => { if (m === 'play' || m === 'furnish') stop(); });
  bus.on('auth', () => { if (!may()) stop(); });
  setSize('std'); sync();
}

const may = () => !!auth.account && auth.can('property.admin');
const net = () => app.terrain?.roadNet || null;
const clampFt = v => Math.max(20, Math.min(600, Math.round(+v || 100)));
function say(text, bad = false) {
  E.stat.textContent = text; E.stat.classList.toggle('bad', bad);
  const st = E.bar.querySelector('.lb-stat'); st.textContent = text || (isTouch() ? 'Tap the ground beside a road.' : 'Click the ground beside a road.'); st.classList.toggle('bad', bad);
}
/** The bar shows while making lots with the edit dock closed; its Create follows the form's. */
function bar() {
  E.bar.classList.toggle('hidden', !(T.on && !app.docks?.state?.l));
  const go = E.bar.querySelector('.lb-go'); go.disabled = E.go.disabled; go.textContent = E.go.textContent;
}

// ------------------------------------------------------------------ the form
function setSize(k) {
  T.size = k;
  const s = SIZES.find(x => x[0] === k);
  if (s) { T.w = s[2]; T.d = s[3]; E.w.value = s[2]; E.d.value = s[3]; }
  E.custom.classList.toggle('hidden', k !== 'custom');
  for (const b of E.sizes.querySelectorAll('[data-k]')) b.classList.toggle('on', b.dataset.k === k);
  preview();
}
function setN(n) { T.n = Math.max(1, Math.min(MAX_N, n)); T.all = false; sync(); preview(); }
/** The sale choices this world has: the economy (Virtual Coin), or city land marked for sale. */
function saleKind() { return app.econ?.status()?.enabled ? 'vc' : 'city'; }
/** How many: a number, all along the road, or (beside a grid's road) the block. */
function syncCount() {
  const blk = blockMode(T.at || T.hover);
  E.n.textContent = blk ? 'block' : T.all ? 'all' : String(T.n);
  E.minus.disabled = blk || T.all || T.n <= 1; E.plus.disabled = blk || T.all || T.n >= MAX_N; E.both.disabled = E.all.disabled = blk;
  E.block.classList.toggle('hidden', !isGridRoad(T.at || T.hover)); E.block.classList.toggle('on', T.block); E.block.setAttribute('aria-pressed', String(T.block));
}
function sync() {
  syncCount();
  E.both.classList.toggle('on', T.both); E.both.setAttribute('aria-pressed', String(T.both));
  E.all.classList.toggle('on', T.all); E.all.setAttribute('aria-pressed', String(T.all));
  for (const b of E.zones.querySelectorAll('[data-z]')) b.classList.toggle('on', b.dataset.z === T.zoning);
  const env = DEFAULT_ENVELOPES[T.zoning] || ENVELOPE_FALLBACK;
  E.zhint.textContent = T.zoning === 'park' ? 'Parks only.' : `Buildings up to ${plural(env.maxFloors, 'floor')}, ${Math.round(env.setback / FT)} ft from the lot lines.`;
  // the sale choices, kept as chosen when the form is drawn again
  const kind = saleKind(), cur = E.sale.querySelector('input[name="lt-sale"]:checked')?.value || T.sale, price = E.sale.querySelector('.lt-price')?.value || '';
  const opts = kind === 'vc' ? [['price', 'For Virtual Coin', ''], ['none', 'Not yet', 'the city keeps them']]
    : [['offer', 'Mark them for sale', ''], ['none', 'Not yet', 'the city keeps them']];
  T.sale = opts.some(o => o[0] === cur) ? cur : opts[0][0];
  E.sale.innerHTML = opts.map(([v, t, sub]) => `<label class="lt-opt"><input type="radio" name="lt-sale" value="${v}"${v === T.sale ? ' checked' : ''}> ${t}${sub ? ` <small class="dim">${sub}</small>` : ''}${v === 'price' ? ` <input class="input lt-price" inputmode="decimal" placeholder="VC" size="7" value="${esc(price)}">` : ''}</label>`).join('');
  E.sale.onchange = () => { T.sale = E.sale.querySelector('input[name="lt-sale"]:checked')?.value || T.sale; };
}

// ------------------------------------------------------------------ the tool
function start(road = null) {
  if (!may()) { app.toast?.('Only administrators make lots.', 'bad'); return; }
  if (!S.world.terrain || !net() || !net().all().length) { app.toast?.('Lots go beside roads beyond the city: draw a road first (Roads).', 'bad', 4200); return; }
  if (S.mode === 'play' || S.mode === 'furnish') app.setMode('explore');
  T.on = true; T.at = null; T.hover = null;
  E.make.textContent = '✕ Stop making lots'; E.make.classList.remove('primary');
  E.form.classList.remove('hidden'); E.made.innerHTML = '';
  sync();
  if (road) { const G = net().geometry(road); if (G) { T.at = anchorFor(road, G.length / 2, 'a'); T.all = true; T.both = true; sync(); } }
  where(); preview();
  if (phone()) app.docks?.open('left', false);   // a phone's drawer covers the world: the bar takes over
  bar();
}
function stop() {
  if (!T.on) return;
  T.on = false; T.at = null; T.hover = null; T.res = null; clear();
  E.make.textContent = '📐 Make lots'; E.make.classList.add('primary');
  E.form.classList.add('hidden');
  bar();
}
/** The Roads tool's "lots beside this road": the whole road, both sides. */
function forRoad(id) { app.docks?.show('l:lots'); stop(); T.block = false; start(id); }
/** Whether anchor A is beside a grid's road (the grid layout tool's), and whether it fills the block there. */
function isGridRoad(A) { return !!A && !!(S.world.roads || []).find(r => r && r.id === A.road)?.grid; }
function blockMode(A) { return T.block && isGridRoad(A); }

function anchorFor(road, s, side) {
  const N = net(), rec = N?.get(road), G = N?.geometry(road);
  return rec && G ? { road, s, side, G, name: rec.name || 'the road' } : null;
}
/** The road beside ground point p (within REACH m): which road, how far along it, which side. */
function anchorAt(p) {
  const N = net(); if (!N || !p) return null;
  const near = N.nearest(p.x, p.z, REACH);
  return near ? anchorFor(near.id, near.s, near.offset >= 0 ? 'a' : 'b') : null;
}
function groundAt(cx, cy) { const p = app.terrain?.rayHit(cam.rayAt(cx, cy)); return p ? { x: p.x, z: p.z } : null; }
function where() {
  const A = T.at;
  E.where.innerHTML = A && blockMode(A) ? `The block beside <b>${esc(A.name)}</b>, ${esc(sideName(A.G, A.side === 'a' ? 1 : -1))} side: filled like the rest of its grid. <span class="dim">Tap another block to move.</span>`
    : A ? `Beside <b>${esc(A.name)}</b>${T.both ? ', both sides' : `, ${esc(sideName(A.G, A.side === 'a' ? 1 : -1))} side`}. <span class="dim">Tap elsewhere to move them.</span>`
    : isTouch() ? 'Tap the ground beside a road.' : 'Click the ground beside a road.';
}

/** Where along the road: a row of n centred on the tap — or carrying on a row of lots already there — or all of it. */
function range(A) {
  const L = A.G.length, w = T.w * FT;
  if (T.all) return { from: 0, to: L, count: null };
  let from = A.s - T.n * w / 2;
  const snap = w * 0.6;
  for (const l of app.lots?.lots || []) for (const f of l.frontage || []) {
    if (f.road !== A.road || f.side !== A.side) continue;
    if (Math.abs(f.s1 - from) < snap) from = f.s1;
    else if (Math.abs(f.s0 - (from + T.n * w)) < snap) from = f.s0 - T.n * w;
  }
  from = Math.max(0, Math.min(L, from));
  return { from, to: Math.min(L, from + T.n * w * 1.6 + 12), count: T.n };
}
function preview() {
  if (!T.on) return;
  clear(); T.res = null;
  const A = T.at || T.hover, N = net();
  E.go.disabled = true; E.go.textContent = '✅ Create';
  if (!A || !N) { syncCount(); say(''); return; }
  const g = makeGrid(S.world.grid), r = range(A), Tn = app.terrain;
  syncCount();
  if (blockMode(A)) return previewBlock(A, N, g, Tn);
  let res;
  try {
    res = platAlongRoad(N, A.road, { side: T.both ? 'both' : A.side, from: r.from, to: r.to, count: r.count, width: T.w * FT, depth: T.d * FT, isWater: (x, z) => Tn.isWater(x, z),
      city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, lots: app.lots?.lots || [], buildings: (S.world.buildings || []).filter(B => B && !B.gone), pads: Tn.ground?.island.roads?.pads || [] });
  } catch (err) { say(err.message, true); return; }
  T.res = res; T.range = r;
  draw(res.lots, !!T.at);
  const left = Object.entries(res.skipped).filter(([, n]) => n).map(([k, n]) => `${n} ${SKIP[k]}`);
  const n = res.lots.length;
  if (!T.at) { say(n ? `${plural(n, 'lot')} would go here. ${isTouch() ? 'Tap' : 'Click'} to place ${n === 1 ? 'it' : 'them'}.` : `No lot fits here${left.length ? ` (${left.join(', ')})` : ''}.`, !n); return; }
  say(n ? `${plural(n, 'lot')} of ${T.w} × ${T.d} ft${left.length ? `; left out: ${left.join(', ')}` : ''}.` : `No lot fits here${left.length ? ` (${left.join(', ')})` : ''}: try another spot, size or side.`, !n);
  E.go.disabled = !n; E.go.textContent = n ? `✅ Create ${plural(n, 'lot')}` : '✅ Create';
  bar();
}

/** A grid's block beside A, filled as the grid tool fills its blocks: what would be made, and why anything is left out. */
function previewBlock(A, N, g, Tn) {
  const B = blockRuns(S.world.roads || [], A.road, A.side, A.s, { width: T.w * FT, depth: T.d * FT, lots: app.lots?.lots || [] });
  if (!B) { T.res = null; say(`No block of the grid on this side of ${A.name}: ${isTouch() ? 'tap' : 'click'} beside a block.`, true); bar(); return; }
  if (!B.runs.length) { T.res = null; say(`Lots of ${T.w} × ${T.d} ft don't fit in this block: try a smaller size.`, true); bar(); return; }
  const lots = [], skipped = {}, base = { isWater: (x, z) => Tn.isWater(x, z), city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, buildings: (S.world.buildings || []).filter(x => x && !x.gone), pads: Tn.ground?.island.roads?.pads || [] };
  try {
    for (const run of B.runs) {
      const res = platAlongRoad(N, run.road, { ...base, side: run.side, from: run.from, to: run.to, count: run.count, width: T.w * FT, depth: B.depth, lots: [...(app.lots?.lots || []), ...lots], feet: true, even: true });
      lots.push(...res.lots);
      for (const [k, n] of Object.entries(res.skipped)) if (n) skipped[k] = (skipped[k] || 0) + n;
    }
  } catch (err) { T.res = null; say(err.message, true); bar(); return; }
  T.res = { lots, skipped, block: true, runs: B.runs, depth: B.depth };
  draw(lots, !!T.at);
  const left = Object.entries(skipped).map(([k, n]) => `${n} ${SKIP[k]}`), n = lots.length;
  if (!T.at) { say(n ? `${plural(n, 'lot')} would fill this block. ${isTouch() ? 'Tap' : 'Click'} to place ${n === 1 ? 'it' : 'them'}.` : `No lot fits in this block${left.length ? ` (${left.join(', ')})` : ''}.`, !n); bar(); return; }
  say(n ? `${plural(n, 'lot')} of ${T.w} × ${T.d} ft fill this block${left.length ? `; left out: ${left.join(', ')}` : ''}.` : `No lot fits in this block${left.length ? ` (${left.join(', ')})` : ''}.`, !n);
  E.go.disabled = !n; E.go.textContent = n ? `✅ Create ${plural(n, 'lot')}` : '✅ Create';
  bar();
}

// ------------------------------------------------------------------ in the world
function onClick(e) {
  if (!T.on || S.mode === 'play') return false;
  const A = anchorAt(groundAt(e.clientX, e.clientY));
  if (!A) { say(`That isn't beside a road: ${isTouch() ? 'tap' : 'click'} within ${Math.round(REACH / FT)} ft of one.`, true); return true; }
  T.at = A; T.hover = null; where(); preview();
  return true;
}
function onKey(e) {
  if (!T.on) return false;
  if (e.key === 'Escape') { if (T.at) { T.at = null; where(); preview(); } else stop(); return true; }
  if (e.key === 'Enter' && !E.go.disabled) { create(); return true; }
  return false;
}
function frame() {
  if (!T.on) return;
  if (!app.docks?.isOpen?.('l:lots')) { stop(); return; }   // the section folded: the tool ends with it
  if (E.bar.classList.contains('hidden') === !app.docks?.state?.l) bar();
  if (!T.at && ptr.moved && !isTouch()) { ptr.moved = false; const A = anchorAt(groundAt(ptr.x, ptr.y)); const k = A ? `${A.road}:${Math.round(A.s)}:${A.side}` : ''; if (k !== T.hoverKey) { T.hoverKey = k; T.hover = A; preview(); } }
}
function clear() { for (const m of [...ghost.children]) { ghost.remove(m); m.geometry.dispose(); m.material.dispose(); } }
/** The lots on the ground: a see-through fill and their outlines (placed: green; following the pointer: paler). */
function draw(lots, placed) {
  const Tn = app.terrain, y = (x, z) => Math.max(Tn.params.seaLevel, Tn.heightAt(x, z)) + 0.3;
  const tri = [], lin = [];
  for (const l of lots) {
    const m = l.poly.map(p => ({ x: p.x / 1e6, z: p.z / 1e6 }));
    let cx = 0, cz = 0; for (const p of m) { cx += p.x / m.length; cz += p.z / m.length; }
    for (let i = 0; i < m.length; i++) {
      const a = m[i], b = m[(i + 1) % m.length];
      tri.push(cx, y(cx, cz), cz, a.x, y(a.x, a.z), a.z, b.x, y(b.x, b.z), b.z);
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4));
      for (let k = 0; k < n; k++) { const p0 = [a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n], p1 = [a.x + (b.x - a.x) * (k + 1) / n, a.z + (b.z - a.z) * (k + 1) / n]; lin.push(p0[0], y(p0[0], p0[1]) + 0.05, p0[1], p1[0], y(p1[0], p1[1]) + 0.05, p1[1]); }
    }
  }
  const col = placed ? 0x4ade80 : 0xbbf7d0;
  if (tri.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: placed ? 0.35 : 0.22, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    fill.renderOrder = 6; ghost.add(fill);
  }
  if (lin.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(lin, 3));
    const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: placed ? 0xf5c542 : 0xffffff, transparent: true, opacity: 0.95, depthTest: false, fog: false }));
    line.renderOrder = 7; ghost.add(line);
  }
}

// ------------------------------------------------------------------ making them
function priceIn() {
  const raw = E.sale.querySelector('.lt-price')?.value || '', n = Number(String(raw).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : NaN;
}
async function create() {
  if (!T.at || !T.res?.lots.length || T.busy) return;
  const kind = saleKind(), sale = T.sale, price = sale === 'price' ? priceIn() : null;
  if (sale === 'price' && !Number.isSafeInteger(price)) { say('What price? Enter it next to "For Virtual Coin".', true); return; }
  const A = T.at, r = T.range, n = T.res.lots.length;
  T.busy = true; E.go.disabled = true; say(`Making ${plural(n, 'lot')}…`);
  let made;
  try {
    // a grid's block: its runs made as the grid tool makes them (corner lots clear of the junction's paving, even widths)
    made = T.res.block ? await post('/api/property/plat-grid', { runs: T.res.runs, width: T.w * FT, depth: T.res.depth, zoning: T.zoning, key: key() })
      : await post('/api/property/plat-road', { road: A.road, side: T.both ? 'both' : A.side, from: r.from, to: r.to, count: r.count, widthFt: T.w, depthFt: T.d, zoning: T.zoning, key: key() });
  } catch (err) { T.busy = false; say(err.message, true); preview(); return; }
  const ids = made.ids || [];
  let note = '';
  try { note = await putOnSale(ids, kind, sale, price); } catch (err) { note = ` They are made, but not for sale yet: ${err.message} (sell them from their cards on the lot map).`; }
  await app.lotsReload?.();   // the new lots on the map before the next tap (so a preview never overlaps them)
  T.busy = false;
  const zl = ZONES[T.zoning]?.label || cap(T.zoning);
  say(`✅ Made ${plural(ids.length, 'lot')} ${T.res?.block ? `in the block beside ${A.name}` : `beside ${A.name}`}, ${zl.toLowerCase()}.${note}`);
  app.toast?.(`📐 ${plural(ids.length, 'new lot')} beside ${A.name}`, 'good');
  E.made.innerHTML = `<p class="hint">Tap one to see or change it:</p><div class="chips">${ids.slice(0, 40).map(id => `<button type="button" class="chip" data-lot="${esc(id)}">${esc(id)}</button>`).join('')}${ids.length > 40 ? `<span class="dim">and ${ids.length - 40} more</span>` : ''}</div>`;
  // (the pointer still where it tapped: no fresh preview of that spot until it moves on, so what was made stays said)
  T.hoverKey = `${A.road}:${Math.round(A.s)}:${A.side}`; T.hover = null;
  T.at = null; where(); clear(); T.res = null; E.go.disabled = true; E.go.textContent = '✅ Create'; bar();
}
/** Puts new lots up for sale the way this world sells land; a few words on how it went. */
async function putOnSale(ids, kind, sale, price) {
  if (sale === 'none' || !ids.length) return ` The city keeps ${ids.length === 1 ? 'it' : 'them'} for now: put ${ids.length === 1 ? 'it' : 'them'} up for sale from ${ids.length === 1 ? 'its card' : 'their cards'} on the lot map.`;
  let done = 0, why = '';
  for (const id of ids) {
    try {
      if (kind === 'vc') await post('/api/economy/realty/list', { kind: 'lot', target: id, price });
      else await post('/api/property/offer', { id });
      done++;
    } catch (err) { why = why || err.message; }
  }
  const how = kind === 'vc' ? `for ${app.econ.vc(price)}` : 'as city land';
  return ` ${done === ids.length ? (ids.length === 1 ? 'Up' : 'All up') : `${done} of ${ids.length} up`} for sale ${how}${why ? ` (${why})` : ''}.`;
}
