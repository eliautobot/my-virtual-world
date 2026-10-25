// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The property map and lot cards (WP4.14, wp4-world-spec.md §5.6; 2026-10-04: "lot specific settings ... a lot
// specific view to see lots for sale, available, sold, realty value map that is color coded and directly view in the
// world ... similar to how the latest SimCity games have a world property system and UI controls").
// - The map (🏘️ button, the O key, the Property section, any lot's menu): the world turns pale and every lot takes the
//   colour of the chosen lens — Status (for sale, yours, shared with you, owned, city land, on hold, not released),
//   Value (shared/land-value.js) or Zoning — on its ground and on the roofs standing on it (render/lots.js). The legend
//   counts each colour; tapping one shows only those lots. Pins in the world name the lots that matter for the lens.
// - Tapping a lot (or a building on it) opens its card: what it is, its size, zoning and what that allows, its value and
//   why, what stands on it, and the actions this account may take — build here, merge, split back — with the holder's
//   settings (name and note, who may enter, who it's shared with) and the city's (for sale, zoning, hold, transfer).
// - Merging happens in the world: the holder's own lots next to it get a ＋ pin; tap them, then Merge.
// - Towns (2026-10-23, shared/towns.js): the Town lens colours every lot by its town; administrators paint lots into a
//   town (a new name makes one) or rename it there, or set one lot's town on its card. A holder makes one of their lots
//   their home base on its card (where their agents live and work: server/towns.js); "My properties" marks it 🏠.
// Everything goes through /api/property (server-checked); the card only offers what the server would allow.
import * as THREE from 'three';
import { S, bus, selectBuilding } from '../core/state.js';
import { h, esc } from '../core/util.js';
import { icon } from '../core/icons.js';
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { LotLayer, STATUS, ZONES, statusOf, valueColor } from '../render/lots.js';
import { setLotLayer, setShared, rightsOn, isMine } from '../core/rights.js';
import { GU } from '../render/scene.js';
import { watchKeyboard } from '../core/viewport.js';
import { landValue } from '/shared/land-value.js';
import { DEFAULT_ENVELOPES, ENVELOPE_FALLBACK, DEFAULT_LOT_POLICY } from '/shared/lots.js';
import { LotGround } from '../render/lot-ground.js';
import { GROUND_Y, FLOOR_H } from '/shared/constants.js';
import { MAIN_TOWN, townName, townColor } from '/shared/towns.js';

const FT = 0.3048, ft = m => Math.round(m / FT), sq = n => `${Math.round(n).toLocaleString('en-US')} sq ft`;
const key = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const KINDS = { grant: 'Created', transfer: 'Transferred', merge: 'Merged', split: 'Split back', custodial_hold: 'Put on hold', release_hold: 'Hold released', surrender: 'Surrendered', correction: 'Corrected', retire: 'Retired' };
const ACCESS = [['public', 'Everyone'], ['friends', 'Friends'], ['private', 'Only me']];
const RIGHTS = [['build', 'build'], ['furnish', 'furnish'], ['decorate', 'decorate']];
const LENSES = [['status', '🏷️ Status'], ['value', '💎 Value'], ['zoning', '🧭 Zoning'], ['town', '🏙️ Town']];
// The economy's lenses (server/economy/views.js lens(); docs/features/ECONOMY.md §10), when the economy is on: a value
// per building, summed (takings, jobs) or averaged (rent, savings) over a lot's buildings, in five quantile bins of one
// blue ramp (light: little, dark: much); lots without any are grey.
const ECON_LENSES = [['revenue', '💰 Takings', 'sum'], ['rent', '🏠 Rent', 'avg'], ['wealth', '👛 Savings', 'avg'], ['jobs', '💼 Jobs', 'sum']];
const RAMP = ['#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#104281'], NODATA = '#9a9a9a';
let econ = null;   // { kind, byLot: Map(lot id → value), cuts: [4 thresholds], at }
const phone = () => matchMedia('(max-width: 760px)').matches;

let app, layer, cam, lens = 'status', only = null, sel = null, detail = null, merging = null, cfg = null, shared = new Set();
let mapOn = false, labT = 0, ground = null;
let homeBase = null;                                        // this account's (GET /api/property/mine)
const brush = { on: false, town: MAIN_TOWN, fresh: '' };    // painting lots into a town (administrators, the Town lens)
const E = {}, pins = [], _v = new THREE.Vector3();

export async function init(a) {
  app = a; cam = a.cam; watchKeyboard();
  layer = app.lots = new LotLayer(app); setLotLayer(layer);
  ground = new LotGround(app.stage.scene, S.world);   // the grids' lots: lawn or paving, flush with the sidewalks
  app.stage.scene.add(layer.group);
  const root = document.getElementById('ui');
  // the Property section of the info dock: the way in, and the account's own lots
  const slot = a.docks && a.docks.slot('r:property');
  if (slot) {
    slot.appendChild(h(`<div class="property">
      <div class="row"><button type="button" class="btn primary pmap">${icon('layers')} Open the data map</button></div>
      <p class="hint">Lots for sale, yours and everyone's, land value and zoning, coloured in the world. Tap a lot for its card. Shortcut: M.</p>
      <div class="mine hidden"><h4>My properties</h4><div class="mylist hint">You don't hold any lots yet.</div><div class="sharedlist"></div></div>
      <p class="hint status"></p></div>`));
    E.dockMap = slot.querySelector('.pmap'); E.mine = slot.querySelector('.mine'); E.mylist = slot.querySelector('.mylist'); E.sharedlist = slot.querySelector('.sharedlist'); E.dockStatus = slot.querySelector('.status');
    E.dockMap.onclick = () => setMap(!mapOn);
    slot.addEventListener('click', e => { const b = e.target.closest('[data-lot]'); if (b) { setMap(true); open(b.dataset.lot, true); } });
  }
  // the map's button beside Play and Chat, so it is one tap away on a phone too
  // "Data map" (2026-10-06: it shows more than property now — SimCity's data maps, Cities: Skylines' info views)
  const fb = document.querySelector('#floatbtns .fb-main') || document.getElementById('floatbtns');
  if (fb) { E.fab = h(`<button type="button" class="btn pmapbtn" title="Data map (O): lots and owners, status, values, zoning" aria-label="Data map">${icon('layers')}</button>`); fb.prepend(E.fab); E.fab.onclick = () => setMap(!mapOn); }
  E.bar = root.appendChild(h(`<div id="propbar" class="panel hidden" role="region" aria-label="Data map">
    <div class="pbar-top"><b>${icon('layers')} Data map</b><div class="seg lenses" role="tablist">${LENSES.map(([k, t]) => `<button type="button" class="btn small" role="tab" data-lens="${k}">${t}</button>`).join('')}${ECON_LENSES.map(([k, t]) => `<button type="button" class="btn small ec-lens hidden" role="tab" data-lens="${k}">${t}</button>`).join('')}</div><button type="button" class="btn small icon pclose" title="Close the map (Esc)" aria-label="Close the map">✕</button></div>
    <div class="legend" role="list"></div></div>`));
  E.lenses = E.bar.querySelector('.lenses'); E.legend = E.bar.querySelector('.legend');
  E.lenses.onclick = e => { const b = e.target.closest('[data-lens]'); if (b) setLens(b.dataset.lens); };
  E.bar.querySelector('.pclose').onclick = () => setMap(false);
  E.legend.onclick = e => {
    if (e.target.closest('.lg-paint')) { brushSet(!brush.on); return; }
    if (e.target.closest('.lg-rename')) { renameTown(); return; }
    const c = e.target.closest('[data-k]'); if (!c) return; only = only === c.dataset.k ? null : c.dataset.k; paint();
  };
  E.legend.addEventListener('change', e => {
    if (e.target.matches('.lg-tsel')) { brush.town = e.target.value; paint(); if (brush.town === '__new') E.legend.querySelector('.lg-tnew')?.focus(); }
  });
  E.legend.addEventListener('input', e => { if (e.target.matches('.lg-tnew')) brush.fresh = e.target.value; });
  E.card = root.appendChild(h('<div id="lotcard" class="panel hidden" role="dialog" aria-label="Lot"></div>'));
  E.card.addEventListener('click', onCardClick);
  E.merge = root.appendChild(h(`<div id="mergebar" class="panel hidden" role="dialog" aria-label="Merge lots">
    <div class="mb-text"></div><div class="mb-btns"><button type="button" class="btn mb-cancel">✕ Cancel</button><button type="button" class="btn primary mb-go">➕ Merge</button></div></div>`));
  E.merge.querySelector('.mb-cancel').onclick = () => stopMerge();
  E.merge.querySelector('.mb-go').onclick = () => doMerge();
  E.pins = root.appendChild(h('<div id="lotpins" aria-label="Lots"></div>'));
  app.hooks.click.unshift(onWorldClick);
  app.hooks.key.unshift(onKey);
  bus.on('msg:lots', () => reload());
  bus.on('auth', () => reload());
  bus.on('world', () => { ground.update(layer.lots, S.world); if (mapOn) { layer.buildCaps(); for (const L of layer.lots) L.top = topOf(L); } });
  bus.on('roads', () => ground.update(layer.lots, S.world));   // a grid built, moved or taken away
  bus.on('frame', frame);
  bus.on('mode', m => { if (m === 'play' && mapOn) setMap(false); });
  app.property = { open: id => { setMap(true); open(id, true); }, toggle: () => setMap(!mapOn), show: on => setMap(on), active: () => mapOn, merge: id => { setMap(true); startMerge(id); }, split: id => split(id),
    valueOf: id => { const L = layer.byId.get(id); return L ? valueOf(L) : null; }, lots: () => layer.lots, homeBase: () => homeBase };
  app.lotsReload = () => reload();
  bus.on('econ:listings', () => { labT = 0; if (mapOn) paint(); });
  getJSON('/shared/world-config/land-value.json').then(c => { cfg = c; for (const L of layer.lots) L.value = null; if (mapOn) paint(); }).catch(() => {});
  await reload();
}

// ------------------------------------------------------------------ data
async function reload() {
  try {
    const r = await getJSON('/api/property/lots');
    layer.setLots(r.lots || [], auth.account?.id ?? null);
    ground.update(layer.lots, S.world);
    for (const L of layer.lots) { L.value = null; L.top = topOf(L); }
    await loadMine();
    paint();
    if (sel && layer.byId.has(sel) && !E.card.classList.contains('hidden')) await open(sel, false);
    else if (sel && !layer.byId.has(sel)) closeCard();
    if (merging) { merging.ids = merging.ids.filter(id => layer.byId.has(id)); if (merging.ids.length) { merging.cand = candidates(); showMerge(); } else stopMerge(); }
  } catch (e) { if (E.dockStatus) E.dockStatus.textContent = `Lots could not load: ${e.message}`; }
}
async function loadMine() {
  const can = !!auth.account && auth.can('property.hold');
  E.mine?.classList.toggle('hidden', !can);
  if (!can) { setShared([]); shared = new Set(); return; }
  const r = await getJSON('/api/property/mine').catch(() => ({ lots: [], shared: [] }));
  setShared(r.shared); shared = new Set((r.shared || []).map(d => d.id));
  homeBase = r.homeBase || null;
  if (!E.mylist) return;
  const mine = r.lots || [];
  E.mylist.innerHTML = mine.length ? mine.map(l => `<button type="button" class="btn sm mylot" data-lot="${esc(l.id)}"${homeBase?.lot === l.id ? ' title="Your home base: your agents live and work in its town"' : ''}>${homeBase?.lot === l.id ? '🏠' : '⭐'} ${esc(l.name || l.id)} · ${sq(l.sqft)}${l.origins > 1 ? ` · ${l.origins} lots` : ''}${l.town && l.town !== MAIN_TOWN ? ` · ${esc(l.town)}` : ''}</button>`).join(' ') : 'You don\'t hold any lots yet. Open the data map (the layers button, or <kbd>O</kbd>) and tap a lot marked For sale to buy it.';
  E.sharedlist.innerHTML = r.shared?.length ? `<h4>Shared with me</h4>${r.shared.map(d => `<button type="button" class="btn sm" data-lot="${esc(d.id)}">🤝 ${esc(layer.byId.get(d.id)?.name || d.id)} · ${esc(d.rights.join(', '))}</button>`).join(' ')}` : '';
}
/** The highest roof on a lot (for its pin), or its ground. */
function topOf(L) {
  let y = GROUND_Y + 0.5;
  for (const i of L.buildings || []) { const B = S.world?.buildings[i]; if (B && !B.gone) y = Math.max(y, GROUND_Y + (B.base || 0) + (B.type === 'park' ? 1 : B.floors * FLOOR_H + 1.5)); }
  if (!L.buildings?.length && app.terrain?.ground && !layer.flat(L.c)) y = app.terrain.heightAt(L.c.x, L.c.z) + 0.5;
  return y;
}
function valueOf(L) {
  if (L.value || !cfg) return L.value || null;
  const T = app.terrain, g = S.grid;
  const env = {
    centre: !g ? { x: 0, z: 0 } : g.empty ? null : { x: (g.minX + g.maxX) / 2, z: (g.minZ + g.maxZ) / 2 },   // (no city: no downtown)
    isWater: T?.ground ? (x, z) => T.isWater(x, z) : null,
    heightAt: T?.ground ? (x, z) => T.heightAt(x, z) : null, seaLevel: T?.params?.seaLevel ?? 0,
    parks: (S.world?.buildings || []).filter(B => B && !B.gone && B.type === 'park').map(B => ({ x: B.x, z: B.z })),
    stations: (S.world?.stations || []).filter(s => Number.isFinite(s.x)).map(s => ({ x: s.x, z: s.z })),
  };
  L.value = landValue(L.c.x, L.c.z, env, cfg);
  return L.value;
}
const me = () => auth.account?.id ?? null;
const sameHolder = (a, b) => !!(a?.holder && b?.holder && a.holder.kind === b.holder.kind && String(a.holder.id) === String(b.holder.id));
// on the market: a listing for Virtual Coin (ui/economy.js)
const listed = L => app.econ?.lotListing?.(L.id) || null;
const priceText = p => app.econ.vc(p.price);
const statusKey = L => { const k = statusOf(L, me(), shared); return k === 'owned' && listed(L) ? 'forSale' : k; };
const tierOf = L => valueOf(L)?.tier || '';
const isEcon = () => ECON_LENSES.some(x => x[0] === lens);
const econBin = L => { const v = econ?.byLot.get(L.id); if (!(v > 0)) return -1; let k = 0; while (k < 4 && v > econ.cuts[k]) k++; return k; };
const townOf = L => L.town || MAIN_TOWN;
const tName = id => townName(id, S.world?.name);
function keyOf(L) { return lens === 'status' ? statusKey(L) : lens === 'value' ? tierOf(L) : lens === 'town' ? townOf(L) : isEcon() ? String(econBin(L)) : L.zoning; }
function colorOf(L) {
  if (lens === 'town') return townColor(townOf(L));
  if (isEcon()) { const k = econBin(L); return k < 0 ? NODATA : RAMP[k]; }
  if (lens === 'value') { const v = valueOf(L); return v ? valueColor(v.score) : '#666666'; }
  if (lens === 'zoning') return ZONES[L.zoning]?.color || '#888888';
  return STATUS[statusKey(L)]?.color || '#888888';
}

// ------------------------------------------------------------------ the map
function setMap(on) {
  if (on === mapOn) return;
  mapOn = on;
  if (on && S.mode === 'play') app.setMode('explore');
  document.body.classList.toggle('propmap', on);
  E.bar.classList.toggle('hidden', !on); E.fab?.classList.toggle('on', on);
  if (E.dockMap) E.dockMap.innerHTML = `${icon('layers')} ${on ? 'Close the data map' : 'Open the data map'}`;
  if (on) { paint(); layer.show(true); if (phone() && app.docks) { app.docks.open('left', false); app.docks.open('right', false); } }
  else { layer.show(false); stopMerge(); closeCard(); hidePins(); only = null; brush.on = false; }
}
function setLens(l) { lens = l; only = null; if (l !== 'town') brush.on = false; paint(); if (isEcon()) loadEcon(); }
/** The economy's values for the lens, per lot (kept for ten seconds). */
async function loadEcon(force = false) {
  const kind = lens, def = ECON_LENSES.find(x => x[0] === kind);
  if (!def || (!force && econ?.kind === kind && performance.now() - econ.at < 10000)) return;
  let r;
  try { r = await getJSON(`/api/economy/lens?kind=${kind}`); } catch (e) { app.toast?.(e.message, 'bad'); return; }
  if (lens !== kind) return;
  const per = new Map(r.buildings), byLot = new Map();
  for (const L of layer.lots) {
    const vals = (L.buildings || []).map(i => per.get(i)).filter(v => Number.isFinite(v));
    if (vals.length) byLot.set(L.id, def[2] === 'sum' ? vals.reduce((a, b) => a + b, 0) : vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  const sorted = [...byLot.values()].filter(v => v > 0).sort((a, b) => a - b), q = f => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] ?? 0;
  econ = { kind, byLot, cuts: [q(0.2), q(0.4), q(0.6), q(0.8)], unit: r.unit, at: performance.now() };
  paint();
}
const econText = (v, unit) => (unit === 'people' ? `${Math.round(v)}` : unit === '%' ? `${Math.round(v)}%` : `${v >= 1e5 ? `${(v / 1e5).toFixed(1)}K` : Math.round(v / 100).toLocaleString('en-US')} VC`);
function paint() {
  const econOn = !!app.econ?.status()?.enabled;
  for (const b of E.lenses.children) { b.classList.toggle('on', b.dataset.lens === lens); if (b.classList.contains('ec-lens')) b.classList.toggle('hidden', !econOn); }
  if (isEcon() && !econOn) lens = 'status';
  if (isEcon() && econ?.kind !== lens) { layer.paint(() => NODATA, () => false); E.legend.innerHTML = '<span class="lg-note">Loading…</span>'; return; }
  layer.paint(colorOf, L => only !== null && keyOf(L) !== only);
  // the legend: each colour with how many lots have it
  const count = new Map();
  for (const L of layer.lots) { const k = keyOf(L); count.set(k, (count.get(k) || 0) + 1); }
  let items;
  if (lens === 'status') items = Object.entries(STATUS).filter(([k]) => count.get(k)).map(([k, s]) => [k, s.color, s.label]);
  else if (lens === 'zoning') items = Object.entries(ZONES).filter(([k]) => count.get(k)).map(([k, z]) => [k, z.color, z.label]);
  else if (lens === 'town') items = [...count.keys()].sort((a, b) => (a === MAIN_TOWN ? -1 : b === MAIN_TOWN ? 1 : tName(a).localeCompare(tName(b)))).map(k => [k, townColor(k), tName(k)]);
  else if (isEcon()) {
    const c = econ.cuts, rng = k => (k === 0 ? `up to ${econText(c[0], econ.unit)}` : k === 4 ? `over ${econText(c[3], econ.unit)}` : `${econText(c[k - 1], econ.unit)}–${econText(c[k], econ.unit)}`);
    items = [0, 1, 2, 3, 4].filter(k => count.get(String(k))).map(k => [String(k), RAMP[k], rng(k)]);
    if (count.get('-1')) items.push(['-1', NODATA, 'None']);
  } else items = (cfg?.tiers || []).map((t, i, a) => [t.name, valueColor(Math.min(99, (t.below + (a[i - 1]?.below ?? 0)) / 2)), t.name]).filter(([k]) => count.get(k));
  E.legend.innerHTML = items.map(([k, c, t]) => `<button type="button" class="lg${only === k ? ' on' : ''}${only !== null && only !== k ? ' off' : ''}" data-k="${esc(k)}" role="listitem" title="Show only these (tap again for all)"><i style="background:${c}"></i>${esc(t)} <span class="n">${count.get(k)}</span></button>`).join('')
    + (lens === 'value' ? '<span class="lg-note">Low → high: how wanted a place is (not a price)</span>' : '')
    + (lens === 'town' ? townTools() : '')
    + (isEcon() ? `<span class="lg-note">${{ revenue: 'What its businesses took yesterday', rent: 'A night\'s rent, on average', wealth: 'Its residents\' savings, on average', jobs: 'People working there' }[lens]}</span>` : '');
  labT = 0;
}
// ------------------------------------------------------------------ towns: the brush (administrators)
const isAdmin = () => !!auth.can?.('property.admin');
const allTowns = () => [...new Set([MAIN_TOWN, ...layer.lots.map(townOf)])].sort((a, b) => (a === MAIN_TOWN ? -1 : b === MAIN_TOWN ? 1 : tName(a).localeCompare(tName(b))));
function townTools() {
  if (!isAdmin()) return '<span class="lg-note">Each town is its own place to live and work</span>';
  const opts = allTowns().map(t => `<option value="${esc(t)}"${brush.town === t ? ' selected' : ''}>${esc(tName(t))}</option>`).join('');
  return `<span class="lg-tools"><select class="input lg-tsel" aria-label="Town to paint">${opts}<option value="__new"${brush.town === '__new' ? ' selected' : ''}>＋ New town…</option></select>`
    + `${brush.town === '__new' ? `<input class="input lg-tnew" maxlength="32" placeholder="New town's name" value="${esc(brush.fresh)}">` : ''}`
    + `<button type="button" class="btn small lg-paint${brush.on ? ' primary' : ''}" title="Tap lots to put them in this town">${brush.on ? '✓ Done' : '✏️ Paint lots'}</button>`
    + `${brush.town !== MAIN_TOWN && brush.town !== '__new' ? '<button type="button" class="btn small lg-rename">Rename</button>' : ''}`
    + `${brush.on ? `<span class="lg-note">Tap lots to put them in ${esc(brushName())}</span>` : ''}</span>`;
}
const brushTown = () => (brush.town === '__new' ? brush.fresh.trim() : brush.town);
const brushName = () => (brush.town === '__new' ? brush.fresh.trim() || 'the new town' : tName(brush.town));
function brushSet(on) {
  if (on && !brushTown()) { app.toast('Name the new town first', 'bad', 2200); E.legend.querySelector('.lg-tnew')?.focus(); return; }
  brush.on = on;
  if (on) closeCard();
  paint();
}
/** Puts lot L in the brush's town (at once on the map; the server's word follows: msg:lots). */
async function brushLot(L) {
  const town = brushTown(); if (!town) return;
  const was = L.town, want = brush.town === '__new' ? town : brush.town;
  if ((was || MAIN_TOWN) === want) return;
  L.town = want; paint();
  try {
    const r = await post('/api/property/town', { ids: [L.id], town, key: key() });
    if (brush.town === '__new' && r?.town) { brush.town = r.town; brush.fresh = ''; L.town = r.town; paint(); }
  } catch (e) { L.town = was; paint(); app.toast(e.message || 'That did not work', 'bad', 2600); }
}
async function renameTown() {
  const from = brush.town; if (!from || from === MAIN_TOWN || from === '__new') return;
  const to = prompt(`A new name for ${tName(from)}:`, tName(from));
  if (!to || to.trim() === from) return;
  try { const r = await post('/api/property/town-rename', { from, to, key: key() }); brush.town = r.town; await reload(); app.toast(`${tName(from)} is now ${r.name}`, 'good', 2200); }
  catch (e) { app.toast(e.message || 'That did not work', 'bad', 2600); }
}

function frame() {
  const goal = mapOn ? 1 : 0, u = GU.uMap;
  if (u.value !== goal) u.value = goal > u.value ? Math.min(goal, u.value + 0.06) : Math.max(goal, u.value - 0.08);
  if (!mapOn) return;
  const now = performance.now();
  if (now - labT > 120) { labT = now; placePins(); }
}

// ------------------------------------------------------------------ pins in the world
function pinFor(L) {
  if (merging) {
    if (merging.ids.includes(L.id)) return { text: '✓ In the merge', cls: 'pk' };
    if (merging.cand.has(L.id)) return { text: '＋ Add', cls: 'add' };
    return null;
  }
  if (L.id === sel) return { text: L.name || `Lot ${L.id}`, cls: 'sel' };
  if (lens === 'status') {
    const k = statusKey(L);
    const p = listed(L);
    if (k === 'forSale') return { text: p ? `🏷️ ${priceText(p)} · ${sq(L.sqft)}` : `🏷️ For sale · ${sq(L.sqft)}`, cls: 'sale' };
    if (k === 'mine') return { text: `⭐ ${L.name || 'Your lot'}${p ? ` · listed ${priceText(p)}` : ''}`, cls: 'mine' };
    if (k === 'shared') return { text: `🤝 ${L.name || 'Shared'}`, cls: 'mine' };
    return null;
  }
  if (lens === 'value') { const v = valueOf(L); return v ? { text: String(v.score), cls: 'val', bg: valueColor(v.score) } : null; }
  if (isEcon()) { const v = econ?.byLot.get(L.id), k = econBin(L); return v > 0 ? { text: econText(v, econ.unit), cls: 'val', bg: RAMP[k], fg: k >= 2 ? '#ffffff' : '#0b0b0b' } : null; }
  return { text: ZONES[L.zoning]?.label || L.zoning, cls: 'zone' };
}
/** The Town lens names each town once, over the lot nearest its middle: { lot id → town }. */
function townLabels() {
  const by = new Map();
  for (const L of layer.lots) { const t = townOf(L); let g = by.get(t); if (!g) by.set(t, g = { x: 0, z: 0, n: 0, list: [] }); g.x += L.c.x; g.z += L.c.z; g.n++; g.list.push(L); }
  const out = new Map();
  for (const [t, g] of by) {
    const cx = g.x / g.n, cz = g.z / g.n;
    let best = null, bd = Infinity;
    for (const L of g.list) { const d = Math.hypot(L.c.x - cx, L.c.z - cz); if (d < bd) { bd = d; best = L; } }
    if (best) out.set(best.id, t);
  }
  return out;
}
function placePins() {
  const W = innerWidth, H = innerHeight, t = cam.target, reach = Math.max(260, (cam.dist || 200) * 2.4), list = [];
  const named = lens === 'town' && !merging ? townLabels() : null;
  for (const L of layer.lots) {
    if (only !== null && keyOf(L) !== only && L.id !== sel) continue;
    if (!named && Math.hypot(L.c.x - t.x, L.c.z - t.z) > reach) continue;
    const p = named ? (named.has(L.id) ? { text: `🏙️ ${tName(named.get(L.id))}`, cls: 'val', bg: townColor(named.get(L.id)), fg: '#ffffff' } : L.id === sel ? pinFor(L) : null) : pinFor(L);
    if (!p) continue;
    _v.set(L.c.x, L.top ?? GROUND_Y, L.c.z).project(cam.cam);
    if (_v.z > 1 || _v.x < -1.05 || _v.x > 1.05 || _v.y < -1.05 || _v.y > 1.05) continue;
    list.push({ L, p, x: (_v.x + 1) / 2 * W, y: (1 - _v.y) / 2 * H, d: Math.abs(_v.x) + Math.abs(_v.y) });
  }
  list.sort((a, b) => a.d - b.d);
  const max = phone() ? 22 : 40;
  let k = 0;
  for (const it of list.slice(0, max)) {
    let el = pins[k];
    if (!el) { el = pins[k] = E.pins.appendChild(h('<button type="button" class="lotpin"></button>')); el.addEventListener('click', onPin); }
    if (el._t !== it.p.text) { el.textContent = it.p.text; el._t = it.p.text; }
    el.className = `lotpin ${it.p.cls}`; el.dataset.lot = it.L.id;
    el.style.background = it.p.bg || ''; el.style.color = it.p.fg || ''; el.style.display = '';
    el.style.pointerEvents = brush.on ? 'none' : '';   // (painting: a tap goes to the lot under it, never a label's)
    el.style.transform = `translate(${Math.round(it.x)}px, ${Math.round(it.y)}px) translate(-50%, -100%)`;
    k++;
  }
  for (; k < pins.length; k++) pins[k].style.display = 'none';
}
function hidePins() { for (const p of pins) p.style.display = 'none'; }
function onPin(e) {
  const id = e.currentTarget.dataset.lot; if (!id) return;
  if (brush.on) { const L = layer.byId.get(id); if (L) brushLot(L); } else if (merging) togglePick(id); else open(id, false);
}

// ------------------------------------------------------------------ choosing a lot in the world
function lotUnder(e) {
  const hit = app.blds?.pick(cam.rayAt(e.clientX, e.clientY), S.focus.b, app.inter?.cutY ?? 1e9);
  if (hit) { const B = S.world.buildings[hit.b]; if (B?.lot && layer.byId.has(B.lot)) return layer.byId.get(B.lot); }
  const g = cam.groundAt(e.clientX, e.clientY, GROUND_Y);
  let L = layer.at(g.x, g.z);
  if (!L && app.terrain?.rayHit) { const p = app.terrain.rayHit(cam.rayAt(e.clientX, e.clientY)); if (p) L = layer.at(p.x, p.z); }
  return L;
}
function onWorldClick(e) {
  if (!mapOn || S.mode === 'play' || app.place?.active()) return false;
  const L = lotUnder(e);
  if (brush.on) { if (L) brushLot(L); return true; }
  if (merging) { if (L) togglePick(L.id); return true; }
  if (!L) { closeCard(); return true; }
  open(L.id, false);
  return true;
}
function onKey(e) {
  if (e.key === 'o' || e.key === 'O') { if (S.mode === 'play') return false; setMap(!mapOn); return true; }   // O for ownership (M opens the world map, ui/worldmap.js)
  if (e.key === 'Escape' && mapOn) { if (brush.on) brushSet(false); else if (merging) stopMerge(); else if (!E.card.classList.contains('hidden')) closeCard(); else setMap(false); return true; }
  return false;
}

// ------------------------------------------------------------------ the lot card
async function open(id, fly) {
  sel = id; layer.select(id); labT = 0;
  try { detail = await getJSON(`/api/property/lot/${encodeURIComponent(id)}`); } catch (e) { app.toast(e.message, 'bad'); return; }
  const L = layer.byId.get(id);
  if (fly && L) cam.flyTo(L.c.x, 0, L.c.z, Math.max(90, (L.box.x1 - L.box.x0) * 3));
  render();
}
function closeCard() { E.card.classList.add('hidden'); sel = null; detail = null; layer.select(null); labT = 0; }
function render() {
  if (!detail) return;
  const l = detail.lot, L = layer.byId.get(l.id) || l, can = detail.can || {}, r = rightsOn(L);
  const st = statusOf(L, me(), shared), S0 = STATUS[st], env = DEFAULT_ENVELOPES[l.zoning] || ENVELOPE_FALLBACK;
  const w = L.box ? ft(L.box.x1 - L.box.x0) : 0, d = L.box ? ft(L.box.z1 - L.box.z0) : 0;
  const blds = (l.buildings || []).map(i => S.world.buildings[i]).filter(B => B && !B.gone);
  const v = L.m ? valueOf(L) : null, city = l.holder?.kind === 'municipality';
  const who = city ? (st === 'forSale' ? 'For sale by the city' : 'City land') : isMine(L) ? 'Yours' : `Owned by ${l.holder?.name || 'someone'}`;
  const myNeighbours = L.m ? layer.neighbours(L).filter(o => sameHolder(o, L) && rightsOn(o).has('merge') && o.zoning === L.zoning) : [];
  // an administrator retires unused city land (2026-10-14, the product owner: retire a lot from the lot card, admins only)
  const retirable = can.admin && city && !blds.length && ['municipal', 'available', 'unreleased'].includes(L.lifecycle ?? l.lifecycle);
  const acts = [];
  if (r.has('build')) acts.push('<button type="button" class="btn primary" data-a="build">🏗️ Build here</button>');
  if (r.has('merge') && myNeighbours.length) acts.push(`<button type="button" class="btn" data-a="merge">➕ Merge with ${isMine(L) ? 'my' : 'the city\'s'} lots next to it</button>`);
  if (r.has('merge') && l.origins > 1) acts.push(`<button type="button" class="btn" data-a="split">✂️ Split back into ${l.origins} lots</button>`);
  if (isMine(L) && homeBase?.lot !== l.id) acts.push('<button type="button" class="btn" data-a="home" title="Your agents live and work in your home base\'s town">🏠 Make it my home base</button>');
  acts.push('<button type="button" class="btn" data-a="fly">🎯 Go there</button>');
  const vcSale = app.econ?.status()?.enabled;   // with the economy on: land for Virtual Coin
  const sale = vcSale ? '<div class="lc-econ"></div>' : st === 'forSale' && !can.admin ? '<p class="hint">Buying land arrives with the world\'s economy.</p>' : '';
  const dels = detail.delegations || [];
  E.card.innerHTML = `
    <div class="lc-head"><i class="dot" style="background:${S0?.color || '#888'}"></i><div class="lc-title"><b>${esc(l.name || `Lot ${l.id}`)}</b><span class="dim">${l.name ? `Lot ${esc(l.id)} · ` : ''}${esc(who)}</span></div><button type="button" class="btn small icon" data-a="close" aria-label="Close">✕</button></div>
    ${l.note ? `<p class="lc-note">${esc(l.note)}</p>` : ''}
    <div class="lc-stats">
      <div><span>Size</span><b>${w} × ${d} ft</b><small>${sq(l.sqft)}${l.origins > 1 ? ` · ${l.origins} lots merged` : ''}</small></div>
      <div><span>Zoning</span><b>${esc(ZONES[l.zoning]?.label || l.zoning)}</b><small>up to ${env.maxFloors} floor${env.maxFloors > 1 ? 's' : ''} · ${ft(env.setback)} ft from the lines</small></div>
      <div><span>Value</span>${v ? `<b style="color:${valueColor(v.score)}">${v.score} · ${esc(v.tier)}</b><small>${v.factors.slice(0, 2).map(f => esc(f.label)).join(' · ') || 'Out of the way'}</small>` : '<b>—</b>'}</div>
      <div><span>On it</span><b>${blds.length ? blds.map(B => `<a href="#" data-b="${B.idx}">${esc(B.name)}</a>`).join(', ') : 'Nothing yet'}</b><small>${{ public: 'Everyone may enter', friends: 'Friends may enter', private: 'Only the holder enters' }[l.access] || ''}</small></div>
      <div class="lc-town"><span>Town</span><b><i class="dot" style="background:${townColor(l.town || MAIN_TOWN)}"></i> ${esc(tName(l.town || MAIN_TOWN))}</b><small>${isMine(L) && homeBase?.lot === l.id ? '🏠 Your home base: your agents live and work in this town' : isMine(L) ? 'One of your lots' : ''}</small></div>
    </div>
    <div class="lc-acts">${acts.join('')}</div>${sale}
    ${can.manage ? `<details class="lc-sec"${isMine(L) ? ' open' : ''}><summary>⚙️ Lot settings</summary>
      <label class="fld">Name <input class="input lc-name" maxlength="40" placeholder="e.g. Harbour Corner" value="${esc(l.name || '')}"></label>
      <label class="fld">Note <textarea class="input lc-notein" maxlength="200" rows="2" placeholder="A line about this lot">${esc(l.note || '')}</textarea></label>
      <div class="row"><button type="button" class="btn small primary" data-a="info">Save name &amp; note</button></div>
      <div class="fld">Who may enter <div class="seg acc">${ACCESS.map(([k, t]) => `<button type="button" class="btn small${l.access === k ? ' on' : ''}" data-acc="${k}">${t}</button>`).join('')}</div></div>
      <div class="fld">Shared with ${dels.length ? `<ul class="dels">${dels.map(x => `<li><b>${esc(x.who?.name || x.subject.id)}</b> <span class="dim">${esc(x.rights.join(', '))}</span> <button type="button" class="btn small" data-unshare="${esc(x.subject.kind)}:${esc(x.subject.id)}">Remove</button></li>`).join('')}</ul>` : '<span class="dim">nobody yet</span>'}
        <div class="row share"><input class="input lc-login" placeholder="Their username" size="12">${RIGHTS.map(([k, t]) => `<label><input type="checkbox" class="r-${k}" ${k !== 'decorate' ? 'checked' : ''}> ${t}</label>`).join('')}<button type="button" class="btn small" data-a="share">Share</button></div></div>
    </details>` : ''}
    ${can.admin ? `<details class="lc-sec"><summary>🏛️ City</summary>
      ${city ? `<div class="row"><button type="button" class="btn small${st === 'forSale' ? '' : ' primary'}" data-a="${st === 'forSale' ? 'withdraw' : 'offer'}">${st === 'forSale' ? 'Take off sale' : '🏷️ Put up for sale'}</button></div>` : ''}
      <div class="row"><select class="input lc-zone">${Object.entries(ZONES).map(([k, z]) => `<option value="${k}"${k === l.zoning ? ' selected' : ''}>${z.label}</option>`).join('')}</select><button type="button" class="btn small" data-a="zone">Set zoning</button></div>
      <div class="row"><select class="input lc-tsel" aria-label="Town">${allTowns().map(t => `<option value="${esc(t)}"${t === (l.town || MAIN_TOWN) ? ' selected' : ''}>${esc(tName(t))}</option>`).join('')}</select><input class="input lc-tnew" maxlength="32" placeholder="or a new town's name" size="14"><button type="button" class="btn small" data-a="town">Set town</button></div>
      <div class="row"><input class="input lc-hreason" placeholder="Reason (kept in the history)" size="18"><button type="button" class="btn small" data-a="hold">${l.lifecycle === 'custodial' ? 'Release the hold' : 'Put on hold'}</button></div>
      <div class="row"><input class="input lc-tlogin" placeholder="Username, or city" size="12"><input class="input lc-treason" placeholder="Reason" size="12"><button type="button" class="btn small" data-a="transfer">Transfer</button></div>
      ${retirable ? '<div class="row"><button type="button" class="btn small danger" data-a="retire" title="Remove this lot from the map: the land goes back to plain city land">🗑️ Retire lot</button></div>' : `<p class="hint">${blds.length ? 'A building stands on it: it can\'t be retired.' : 'Only unused city land can be retired.'}</p>`}
    </details>` : ''}
    <details class="lc-sec"><summary>📜 History (${detail.history.length})</summary><ol class="hist">${detail.history.map(e => `<li>${new Date(e.at).toLocaleDateString()} · ${esc(KINDS[e.kind] || e.kind)}${e.to && e.kind !== 'merge' && e.kind !== 'split' ? ` → ${esc(e.to.name)}` : ''} <span class="dim">${esc(e.reason || '')}</span></li>`).join('')}</ol></details>
    <p class="hint lc-status" aria-live="polite"></p>`;
  E.card.classList.remove('hidden');
  const ebox = E.card.querySelector('.lc-econ');
  if (ebox) app.econ.lotSection(ebox, { lot: l, mine: isMine(L), city, admin: !!can.admin, title: `${l.name || `Lot ${l.id}`} (${sq(l.sqft)})`, reload: () => open(l.id, false) });
}
async function onCardClick(e) {
  const a = e.target.closest('[data-a]')?.dataset.a, q = s => E.card.querySelector(s);
  const bl = e.target.closest('[data-b]');
  if (bl) { e.preventDefault(); selectBuilding(+bl.dataset.b); return; }
  const acc = e.target.closest('[data-acc]');
  if (acc && detail) { await act('/api/property/access', { id: detail.lot.id, access: acc.dataset.acc, revision: detail.lot.revision }, 'Saved.'); return; }
  const un = e.target.closest('[data-unshare]');
  if (un && detail) { const [kind, id] = un.dataset.unshare.split(':'); await act('/api/property/delegate', { id: detail.lot.id, to: { kind, id }, rights: [] }, 'No longer shared.'); return; }
  if (!a || !detail) return;
  const l = detail.lot;
  switch (a) {
    case 'close': closeCard(); break;
    case 'fly': { const L = layer.byId.get(l.id); if (L) cam.flyTo(L.c.x, 0, L.c.z, Math.max(90, (L.box.x1 - L.box.x0) * 3)); break; }
    case 'build': closeCard(); app.place?.newOnLot(l.id); break;
    case 'merge': startMerge(l.id); break;
    case 'split': await split(l.id); break;
    case 'info': await act('/api/property/info', { id: l.id, name: q('.lc-name').value, note: q('.lc-notein').value, revision: l.revision }, 'Saved.'); break;
    case 'share': { const rights = RIGHTS.map(([k]) => q(`.r-${k}`).checked && k).filter(Boolean); await act('/api/property/delegate', { id: l.id, login: q('.lc-login').value.trim(), rights }, 'Shared.'); break; }
    case 'offer': await act('/api/property/offer', { id: l.id, revision: l.revision }, 'Up for sale.'); break;
    case 'withdraw': await act('/api/property/withdraw', { id: l.id, revision: l.revision }, 'Taken off sale.'); break;
    case 'zone': await act('/api/property/zoning', { id: l.id, zoning: q('.lc-zone').value, revision: l.revision }, 'Zoning set.'); break;
    case 'town': { const t = q('.lc-tnew').value.trim() || q('.lc-tsel').value; await act('/api/property/town', { ids: [l.id], town: t }, `In ${tName(t)} now.`); break; }
    case 'home': await act('/api/property/home-base', { lot: l.id }, '🏠 Your home base now: your agents live and work in its town.'); break;
    case 'hold': await act(l.lifecycle === 'custodial' ? '/api/property/release' : '/api/property/hold', { id: l.id, reason: q('.lc-hreason').value, revision: l.revision }, 'Done.'); break;
    case 'retire': {
      if (!confirm(`Retire ${l.name || `lot ${l.id}`}? It leaves the map and its land goes back to plain city land. This can't be undone (make a new lot there instead).`)) break;
      const r = await act('/api/property/retire', { ids: [l.id], reason: 'Retired from the lot card' }, `Retired ${l.name || `lot ${l.id}`}.`);
      if (r && !layer.byId.has(l.id)) closeCard();
      break;
    }
    case 'transfer': { const t = q('.lc-tlogin').value.trim(); await act('/api/property/transfer', { id: l.id, ...(t.toLowerCase() === 'city' ? { to: 'city' } : { login: t }), reason: q('.lc-treason').value, revision: l.revision }, 'Transferred.'); break; }
    default: break;
  }
}
async function act(url, body, done = '') {
  const st = E.card.querySelector('.lc-status');
  if (st) st.textContent = 'Working…';
  try {
    const r = await post(url, { ...body, key: key() });
    if (r === null || r === undefined) throw new Error('refused');
    if (url.endsWith('/merge') && r.id) sel = r.id;
    if (url.endsWith('/unmerge') && r.ids?.length) sel = r.ids[0];
    const keep = sel;
    await reload();
    if (keep && layer.byId.has(keep)) await open(keep, false);
    app.toast(done || 'Done', 'good', 1800);
    return r;
  } catch (e) {
    const s2 = E.card.querySelector('.lc-status'); if (s2) s2.textContent = e.message || 'The server refused this.';
    if (!e.quiet) app.toast(e.message || 'The server refused this.', 'bad', 3500);
    return null;
  }
}
async function split(id) {
  const L = layer.byId.get(id); if (!L) return;
  sel = id;
  await act('/api/property/unmerge', { id, revision: L.revision }, 'Split back into its original lots.');
}

// ------------------------------------------------------------------ merging in the world
function candidates() {
  const max = DEFAULT_LOT_POLICY.maxMergeLots, base = layer.byId.get(merging.ids[0]);
  const used = merging.ids.reduce((n, id) => n + (layer.byId.get(id)?.origins || 1), 0), out = new Set();
  for (const id of merging.ids) {
    const L = layer.byId.get(id); if (!L) continue;
    for (const o of layer.neighbours(L)) if (!merging.ids.includes(o.id) && sameHolder(o, base) && rightsOn(o).has('merge') && o.zoning === base?.zoning && (base.holder?.kind === 'municipality' || used + (o.origins || 1) <= max)) out.add(o.id);
  }
  return out;
}
function startMerge(id) {
  const L = layer.byId.get(id); if (!L) return;
  if (!rightsOn(L).has('merge')) { app.toast('Only your own lots can be merged', 'bad'); return; }
  merging = { ids: [id], cand: new Set() };
  merging.cand = candidates();
  E.card.classList.add('hidden');
  if (!merging.cand.size) { app.toast('None of your lots touch this one along a side', 'bad', 3000); merging = null; render(); return; }
  showMerge();
}
function togglePick(id) {
  if (!merging) return;
  if (merging.ids.includes(id)) { if (id !== merging.ids[0]) merging.ids = merging.ids.filter(x => x !== id); }
  else if (merging.cand.has(id)) merging.ids.push(id);
  else { const L = layer.byId.get(id), base = layer.byId.get(merging.ids[0]); app.toast(L && !sameHolder(L, base) ? `Lot ${L.name || L.id} has another holder` : 'That lot doesn\'t touch the ones you picked along a side', 'bad', 2400); return; }
  merging.cand = candidates();
  showMerge();
}
function showMerge() {
  layer.picked(merging.ids);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, sqft = 0;
  for (const id of merging.ids) { const L = layer.byId.get(id); if (!L) continue; x0 = Math.min(x0, L.box.x0); z0 = Math.min(z0, L.box.z0); x1 = Math.max(x1, L.box.x1); z1 = Math.max(z1, L.box.z1); sqft += L.sqft; }
  const n = merging.ids.length;
  E.merge.querySelector('.mb-text').innerHTML = n < 2 ? '<b>Merge lots</b><br><span class="dim">Tap ＋ on the lots next to it (side by side; a holder joins up to 4).</span>'
    : `<b>Merge ${n} lots</b> · ${ft(x1 - x0)} × ${ft(z1 - z0)} ft · ${sq(sqft)}<br><span class="dim">Tap ＋ to add more, ✓ to take one out.</span>`;
  E.merge.querySelector('.mb-go').disabled = n < 2;
  E.merge.classList.remove('hidden');
  labT = 0;
}
function stopMerge() { if (!merging) return; merging = null; layer.picked([]); E.merge.classList.add('hidden'); labT = 0; if (sel && detail) render(); }
async function doMerge() {
  if (!merging || merging.ids.length < 2) return;
  const ids = merging.ids;
  merging = null; layer.picked([]); E.merge.classList.add('hidden');
  await act('/api/property/merge', { ids }, 'Merged.');
}
