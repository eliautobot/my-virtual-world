// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Procedural city generator: blocks -> lots -> buildings -> floor layouts (shared templates), parks, stations, trees.
import { RNG } from '../../shared/rng.js';
import { makeGrid, blockRect, lotRect, blockIndex, streetTreePositions, SIDE_CORNERS, cornerPoint } from '../../shared/city.js';
import { CATALOG } from '../../shared/catalog.js';
import { WALL_T, WALK_BAND, SIDEWALK } from '../../shared/constants.js';
import { footprint, rectsOverlap, toWorld, itemToLocal } from '../../shared/geom.js';
import { buildGrid, flood, cellOf, nearestFree } from '../../shared/navgrid.js';
import { levelEntries, doorPoints } from '../../shared/building.js';
import { buildLevel, coreFor } from './layouts.js';
import * as N from '../../shared/names.js';

export const STYLES = ['glass', 'brick', 'concrete', 'modern', 'classic', 'stucco'];
export { PAL as PALETTES };
const PAL = {
  glass: { wall: ['#5f7f96', '#4d6a80', '#7896ab', '#3f5a6e', '#8aa2b2', '#56707a'], trim: ['#d7dde2', '#aab3bb', '#2c333a', '#8d969e'], glass: ['#2f5f7f', '#27526e', '#3d7896', '#224459', '#4a8198', '#2f5d58', '#3b5f8f'] },
  brick: { wall: ['#9c4f3a', '#8a4432', '#b0654a', '#7a3f30', '#a8745c', '#6e4a3c', '#b98a6a'], trim: ['#e8e0d0', '#d4c8b0', '#3a3530', '#f2ede4'], glass: ['#2b3d4a', '#34495a', '#2a3a44'] },
  concrete: { wall: ['#b8b4ac', '#a9a59d', '#c9c5bd', '#9a968e', '#d6d2c8', '#8f8e8a'], trim: ['#5a5a58', '#d0ccc4', '#2e3236'], glass: ['#33485a', '#2c4254', '#3d5566'] },
  modern: { wall: ['#e9e6df', '#2f3438', '#d9d4c8', '#44494f', '#c7c2b8', '#f4f1ea'], trim: ['#1e2226', '#c49a58', '#8a6a42', '#d9d9d9'], glass: ['#2d4452', '#355466', '#1f3340', '#3b5a5f'] },
  classic: { wall: ['#d8cbb2', '#cbbd9f', '#e2d7c1', '#bfae8f', '#d6c3a5'], trim: ['#f2ebdd', '#8a7a60', '#5a4e3c'], glass: ['#2c3a44', '#34424c'] },
  stucco: { wall: ['#f1e3c6', '#e8c9a8', '#d9e4d4', '#f2d0c2', '#cfe0ea', '#efe6d2', '#e9d8a6', '#d8c7e6'], trim: ['#ffffff', '#6b4f3a', '#3d5a6c', '#8c3b2f'], glass: ['#2f4450', '#3a505c'] },
};
const ROOF = ['#5c6066', '#4f5358', '#6b6e72', '#44474b', '#737678'];
const ACCENTS = ['#d94f3d', '#2a9d8f', '#e9a23b', '#3d6fb6', '#8e5bb5', '#2f855a', '#c2410c', '#0f766e', '#be185d', '#1d4ed8'];

const r2 = v => Math.round(v * 100) / 100;

export function generateWorld(opts = {}) {
  const seed = String(opts.seed ?? 'next-city');
  // The starter headquarters is named by the configuration (MVW_HQ_NAME; DECISIONS C103).
  const hqName = String(opts.hqName ?? '').trim().slice(0, 40) || 'Headquarters';
  const rng = new RNG(seed + ':city');
  const nx = opts.nx ?? 9, nz = opts.nz ?? 7;
  const gspec = { nx, nz, bw: opts.bw ?? 64, bd: opts.bd ?? 52, road: 14 };
  const g = makeGrid(gspec);
  const world = { format: 1, seed, created: Date.now(), name: opts.name || 'Next City', grid: gspec,
    buildings: [], levels: [], stations: [], trees: [], population: opts.population ?? 4000 };
  const cx = (nx - 1) / 2, cz = (nz - 1) / 2;
  const zoneOf = (i, j) => {
    const dn = Math.max(Math.abs(i - cx) / (nx / 2), Math.abs(j - cz) / (nz / 2));
    return { dn, zone: dn < 0.36 ? 'down' : dn < 0.72 ? 'mid' : 'out' };
  };
  // --- special blocks ---
  const hqI = Math.min(nx - 1, Math.round(cx) + 1), hqJ = Math.round(cz);
  const parks = new Set();
  const parkCands = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (i === hqI && j === hqJ) continue;
    const { dn } = zoneOf(i, j);
    if (dn < 0.2) continue;
    parkCands.push({ i, j, w: rng.next() + (dn > 0.3 && dn < 0.6 ? 0.6 : 0) });
  }
  parkCands.sort((a, b) => b.w - a.w);
  const nParks = Math.max(2, Math.round(nx * nz / 12));
  for (const c of parkCands) {
    if (parks.size >= nParks) break;
    let ok = true;
    for (const p of parks) { const [pi, pj] = p.split(',').map(Number); if (Math.max(Math.abs(pi - c.i), Math.abs(pj - c.j)) < 3) ok = false; }
    if (ok) parks.add(c.i + ',' + c.j);
  }
  const used = { tower: new Set(), apt: new Set(), cafe: new Set(), shop: new Set(), gym: new Set(), rest: new Set(), park: new Set() };
  const uniqueName = (pool, key, fallback) => {
    for (let k = 0; k < 30; k++) { const n = rng.pick(pool); if (!used[key].has(n)) { used[key].add(n); return n; } }
    return fallback + ' ' + (used[key].size + 1);
  };
  const specs = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const lot = lotRect(g, i, j), bi = blockIndex(g, i, j);
    const { dn, zone } = zoneOf(i, j);
    if (parks.has(i + ',' + j)) {
      specs.push({ type: 'park', block: bi, rect: lot, face: 0, name: uniqueName(N.PARK_NAMES, 'park', 'Park') });
      continue;
    }
    if (i === hqI && j === hqJ) { planHQ(specs, lot, bi, rng, hqName); continue; }
    const p = rng.next();
    if (zone === 'down') {
      if (p < 0.42) planTower(specs, lot, bi, rng, dn, 1);
      else if (p < 0.8) planTower(specs, lot, bi, rng, dn, 2);
      else planRows(specs, lot, bi, rng, zone, dn);
    } else if (zone === 'mid') {
      if (p < 0.16) planTower(specs, lot, bi, rng, dn, 2);
      else planRows(specs, lot, bi, rng, zone, dn);
    } else planRows(specs, lot, bi, rng, zone, dn);
  }
  // --- materialise building records ---
  for (const s of specs) {
    const b = makeBuilding(world.buildings.length, s, rng, uniqueName);
    world.buildings.push(b);
  }
  ensureHousing(world, rng);
  for (const b of world.buildings) b.core = coreFor(b);
  // --- floor layouts (templates) ---
  for (const b of world.buildings) generateLevels(world, b, rng);
  // --- stations, street trees ---
  placeStations(world, g, rng);
  placeTrees(world, g, rng);
  return world;
}

// The starter headquarters (DECISIONS C103): a normal building that admins may rename or demolish. AI agents prefer its
// desks on floor 1 and use its top-floor lounge; without it they work at office desks.
function planHQ(specs, lot, bi, rng, name = 'Headquarters') {
  const W = lot.x1 - lot.x0, D = lot.z1 - lot.z0;
  const w = Math.min(38, W - 8), d = Math.min(26, D - 10);
  specs.push({ type: 'hq', block: bi, face: 0, floors: 10, style: 'modern', name, sign: name.slice(0, 28),
    rect: { x0: (lot.x0 + lot.x1 - w) / 2, x1: (lot.x0 + lot.x1 + w) / 2, z0: lot.z1 - 7 - d, z1: lot.z1 - 7 } });
  void rng;
}
function planTower(specs, lot, bi, rng, dn, count) {
  const W = lot.x1 - lot.x0, D = lot.z1 - lot.z0;
  const tall = f => Math.max(8, Math.round(f));
  if (count === 1) {
    const w = r2(rng.float(28, Math.min(40, W - 6))), d = r2(rng.float(22, Math.min(30, D - 6)));
    const face = rng.chance(0.5) ? 0 : 2;
    const x0 = lot.x0 + (W - w) / 2 + rng.float(-2, 2);
    const set = rng.float(4, Math.max(4.5, D - d - 2));
    const z0 = face === 0 ? lot.z1 - set - d : lot.z0 + set;
    const floors = tall(40 - dn * 60 + rng.float(-5, 5));
    specs.push({ type: 'office', block: bi, face, floors, style: rng.pick(['glass', 'glass', 'modern', 'concrete']), mixed: rng.chance(0.35) ? 'cafe' : null,
      rect: { x0, x1: x0 + w, z0, z1: z0 + d } });
  } else {
    const gap = rng.float(4, 8);
    const w1 = r2(rng.float(20, (W - gap) / 2)), w2 = r2(Math.min(rng.float(20, (W - gap) / 2), W - gap - w1));
    for (let k = 0; k < 2; k++) {
      const w = k ? w2 : w1;
      const d = r2(rng.float(20, Math.min(28, D - 4)));
      const face = rng.chance(0.5) ? 0 : 2;
      const x0 = k ? lot.x1 - w : lot.x0;
      const set = rng.float(1.5, Math.max(2, D - d - 1));
      const z0 = face === 0 ? lot.z1 - set - d : lot.z0 + set;
      const floors = tall(34 - dn * 55 + rng.float(-6, 6));
      specs.push({ type: 'office', block: bi, face, floors, style: rng.pick(['glass', 'modern', 'concrete', 'classic']), mixed: rng.chance(0.3) ? 'cafe' : null,
        rect: { x0, x1: x0 + w, z0, z1: z0 + d } });
    }
  }
}
function planRows(specs, lot, bi, rng, zone, dn) {
  const W = lot.x1 - lot.x0, D = lot.z1 - lot.z0;
  const gap = r2(rng.float(1.2, 2.2));
  const twoRows = D >= 34;
  const rowDepth = twoRows ? (D - 3) / 2 : D;
  const faces = twoRows ? [0, 2] : [rng.chance(0.5) ? 0 : 2];
  for (const face of faces) {
    const n = zone === 'out' ? rng.pick([2, 3, 3, 4]) : rng.pick([2, 2, 3]);
    const avail = W - (n - 1) * gap;
    let ws = [];
    for (let k = 0; k < n; k++) ws.push(rng.float(0.7, 1.3));
    const tot = ws.reduce((a, v) => a + v, 0);
    ws = ws.map(v => Math.max(11.5, (v / tot) * avail));
    const scale = avail / ws.reduce((a, v) => a + v, 0);
    ws = ws.map(v => r2(v * scale));
    let x = lot.x0;
    for (let k = 0; k < n; k++) {
      const w = ws[k];
      const type = pickRowType(rng, zone, w, rowDepth);
      let d = r2(Math.min(rowDepth, type === 'apartment' ? rng.float(17, 21) : type === 'office' ? rng.float(15, 24) : rng.float(13, 18)));
      d = Math.max(12, Math.min(d, rowDepth));
      const set = r2(rng.float(0, Math.min(2.5, rowDepth - d)));
      const z0 = face === 0 ? lot.z1 - set - d : lot.z0 + set;
      const s = { type, block: bi, face, rect: { x0: x, x1: x + w, z0, z1: z0 + d } };
      if (type === 'office') { s.floors = Math.max(3, Math.round(zone === 'down' ? rng.float(12, 24) : zone === 'mid' ? rng.float(5, 14) : rng.float(3, 6))); s.style = rng.pick(['concrete', 'glass', 'modern', 'classic', 'brick']); s.mixed = rng.chance(0.25) ? 'cafe' : null; }
      else if (type === 'apartment') { s.floors = Math.max(3, Math.round(zone === 'mid' ? rng.float(6, 13) : rng.float(4, 9))); s.style = rng.pick(['brick', 'brick', 'stucco', 'classic', 'modern', 'concrete']); s.mixed = rng.chance(zone === 'mid' ? 0.45 : 0.3) ? rng.pick(['cafe', 'shop', 'restaurant', 'shop']) : null; }
      else if (type === 'gym') { s.floors = rng.int(1, 3); s.style = rng.pick(['concrete', 'modern', 'brick']); }
      else { s.floors = type === 'shop' ? rng.int(1, 2) : rng.int(1, 2); s.style = rng.pick(['stucco', 'brick', 'classic', 'modern']); }
      void dn;
      specs.push(s);
      x += w + gap;
    }
  }
}
function pickRowType(rng, zone, w, depth) {
  const canApt = w >= 13 && depth >= 17;
  let t;
  if (zone === 'down') t = rng.weighted([['office', 70], ['cafe', 10], ['restaurant', 10], ['shop', 10]]);
  else if (zone === 'mid') t = rng.weighted([['office', 30], ['apartment', 48], ['cafe', 6], ['restaurant', 6], ['shop', 6], ['gym', 4]]);
  else t = rng.weighted([['apartment', 58], ['cafe', 9], ['restaurant', 9], ['shop', 12], ['gym', 7], ['office', 5]]);
  if (t === 'apartment' && !canApt) t = rng.pick(['shop', 'cafe', 'restaurant']);
  return t;
}

export function makeBuilding(idx, s, rng, uniqueName) {
  const rect = s.rect;
  const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
  const ww = rect.x1 - rect.x0, dd = rect.z1 - rect.z0;
  // s.rot (beyond the city): turned freely, rect given unturned; else s.face picks a square turn and rect is the world box.
  const turned = s.rot !== undefined, rot = turned ? s.rot : s.face === 0 ? 0 : s.face === 1 ? 90 : s.face === 2 ? 180 : 270;
  const b = { id: 'b' + idx, idx, type: s.type, block: s.block, x: r2(cx), z: r2(cz), rot,
    w: r2(turned || rot % 180 === 0 ? ww : dd), d: r2(turned || rot % 180 === 0 ? dd : ww), floors: s.type === 'park' ? 1 : (s.floors || 1),
    style: s.style || 'stucco' };
  if (s.base !== undefined) b.base = s.base;   // m above the city's ground: a building on its own pad beyond the city
  const pal = PAL[b.style] || PAL.stucco;
  b.colors = { wall: rng.pick(pal.wall), trim: rng.pick(pal.trim), glass: rng.pick(pal.glass), roof: rng.pick(ROOF), accent: rng.pick(ACCENTS) };
  b.seed = rng.int(1, 1e9);
  switch (s.type) {
    case 'park': b.name = s.name; b.style = 'park'; b.colors = { wall: '#6d9a4c', trim: '#8a8a80', glass: '#000000', roof: '#6d9a4c', accent: '#3f7a3a' }; break;
    case 'hq': b.name = s.name; b.sign = s.sign; b.colors = { wall: '#eef1f2', trim: '#1c2226', glass: '#1d4d5c', roof: '#3f4448', accent: '#e8453c' }; b.roofKind = 'garden'; break;
    case 'office':
      if (s.module && s.radio) {   // MVW Radio's studio (a Radio Station world module: shared/world-modules.js terminalSpec): charcoal and glass, a red sign
        b.name = s.name || 'MVW Radio'; b.sign = s.sign || 'MVW RADIO'; b.module = s.module; b.radio = true; b.style = 'glass';
        b.colors = { wall: '#2b2f36', trim: '#16181c', glass: '#2c4a63', roof: '#3a3f46', accent: '#e23b3b' }; b.roofKind = 'hvac';
      } else b.name = uniqueName(N.TOWER_PREFIX, 'tower', 'Tower') + ' ' + rng.pick(N.TOWER_WORDS);
      break;
    case 'apartment': b.name = rng.pick(N.TOWER_PREFIX) + ' ' + rng.pick(N.APT_WORDS); break;
    case 'cafe': b.name = uniqueName(N.CAFE_NAMES, 'cafe', 'Café'); b.sign = b.name; break;
    case 'restaurant': b.name = uniqueName(N.REST_NAMES, 'rest', 'Restaurant'); b.sign = b.name; break;
    case 'shop':
      if (s.module) {   // a fishing dock's store (shared/world-modules.js terminalSpec): white clapboard, a navy trim, a red sign
        b.name = s.name || 'Dock Store'; b.sign = s.sign || b.name; b.module = s.module; b.tackle = true; b.clothes = false; b.style = 'classic';
        b.colors = { wall: '#eee9dc', trim: '#cfc8b8', glass: '#35556b', roof: '#56697a', accent: '#c8312a' }; b.roofKind = 'hvac';
      } else { b.name = uniqueName(N.SHOP_NAMES, 'shop', 'Store'); b.sign = b.name; b.clothes = rng.chance(0.4); }
      break;
    case 'gym': b.name = uniqueName(N.GYM_NAMES, 'gym', 'Gym'); b.sign = b.name; break;
    case 'terminal': b.name = s.name || 'Terminal'; b.sign = s.sign || b.name; b.style = 'glass'; b.module = s.module; b.colors = { wall: '#dfe6ec', trim: '#9aa4ae', glass: '#5d8fb0', roof: '#c9ced4', accent: '#1f4e8c' }; b.roofKind = 'hvac'; break;   // an airport's (shared/world-modules.js)
  }
  if (s.mixed) {
    b.mixed = s.mixed;
    b.shopName = s.mixed === 'cafe' ? uniqueName(N.CAFE_NAMES, 'cafe', 'Café') : s.mixed === 'shop' ? uniqueName(N.SHOP_NAMES, 'shop', 'Store') : uniqueName(N.REST_NAMES, 'rest', 'Restaurant');
    b.sign = b.shopName;
  }
  if (!b.roofKind) {
    const tall = b.floors >= 20;
    b.roofKind = b.type === 'park' ? 'none' : tall && b.style === 'glass' && rng.chance(0.4) ? 'helipad'
      : b.style === 'brick' && b.floors >= 5 && rng.chance(0.5) ? 'water_tower' : rng.chance(0.2) ? 'garden' : 'hvac';
  }
  if (b.type !== 'park') b.door = { x: 0, w: b.type === 'apartment' && !b.mixed ? 1.8 : b.type === 'terminal' ? 6 : 2.4 };
  b.core = coreFor(b);
  b.lv = [];
  return b;
}

/** Make sure there is enough housing for the target population (raise apartment heights). */
export function ensureHousing(world, rng) {
  const apts = world.buildings.filter(b => b.type === 'apartment');
  const est = () => apts.reduce((a, b) => a + (b.floors - 1) * 2 * Math.max(1, Math.round((b.w - 0.5) / 7.6)), 0);
  let guard = 0;
  while (est() * 1.55 < world.population && guard++ < 40) {
    for (const b of apts) if (b.floors < 22) b.floors++;
  }
  void rng;
}

// ------------------------------------------------------------------------------------------------
export function addLevel(world, b, lvl, ground) {
  lvl.b = b.idx;
  if (ground) lvl.ground = 1;
  lvl.auto = 1;   // generated, not changed by hand: a resize may generate it again (shared/edit.js levelMode)
  let n = 1;
  for (const it of lvl.items) it.id = n++;
  lvl.nid = n;
  world.levels.push(lvl);
  return world.levels.length - 1;
}
/** The floor layouts building b gets from its seed at its size and floor count, without touching the world:
 *  f → a fresh layout for floor f (the same building gives the same floors back). */
export function freshLevels(b) {
  const scratch = { levels: [], buildings: [] }, nb = structuredClone(b);
  generateLevels(scratch, nb, null);
  return f => (nb.lv[f] === undefined ? null : structuredClone(scratch.levels[nb.lv[f]]));
}
/** Floor f of building b laid out with its own roll of the dice (Regenerate, a floor's `roll`): the same kind of floor,
 *  a different arrangement; the same roll at the same size gives the same floor back. theme: lay it out as that theme
 *  (Floor Themes, shared/floor-themes.js) — it stays the floor's (its `theme`), so a re-roll or a resize keeps it. */
export function freshLevel(b, f, roll, theme = null, style = null) {
  const rng = new RNG(`${b.seed}:roll:${roll}:${f}${theme ? `:${theme}` : ''}`);
  const built = buildLevel(b, f, rng, b.type === 'park' ? { dance: rng.chance(0.3) } : theme ? { theme, style } : {});
  const lvl = validate(b, built, f);
  if (built.style) lvl.style = built.style;   // (a café's style, kept by a re-roll: shared/floor-themes.js CAFE_STYLES)
  lvl.b = b.idx;
  if (f === 0) lvl.ground = 1;
  lvl.auto = 1; lvl.roll = roll;
  if (theme) lvl.theme = theme;
  let n = 1;
  for (const it of lvl.items) it.id = n++;
  lvl.nid = n;
  return lvl;
}
/** Themed floors laid out before they were places of their own (2026-10-23: arcades, lounges and clubs were a building's
 *  staff lounge) take their theme's venue kind, so the city comes to them (server/sim/windex.js, server/economy). Every
 *  boot, cheap; returns how many changed. */
export function themeVenues(world) {
  const want = { arcade: 'arcade', lounge: 'lounge_bar', club: 'club' };
  let n = 0;
  for (const L of world.levels || []) if (L && want[L.theme] && L.venue !== want[L.theme]) { L.venue = want[L.theme]; n++; }
  return n;
}
const sortKeys = v => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v);
const layoutKey = L => JSON.stringify(sortKeys({ name: L.name ?? null, items: L.items || [], walls: L.walls || [], zones: L.zones || [], venue: L.venue ?? null, units: L.units ?? null }));
/**
 * Floor modes for a world from before they were recorded (procedural floor layouts, 2026-10-04): a floor whose layout is
 * exactly what its building's seed generates at its size is 'auto' (a resize generates it again); any other was changed
 * by hand and is marked 'custom' (kept as it is). Runs once per world (world.levelModes); returns how many it marked.
 */
export function markLevelModes(world) {
  if (world.levelModes) return 0;
  let n = 0;
  for (const B of world.buildings || []) {
    if (!B || !Array.isArray(B.lv) || !B.lv.length) continue;
    let fresh = null;
    try { fresh = freshLevels(B); } catch { fresh = null; }
    for (let f = 0; f < B.lv.length; f++) {
      const L = world.levels[B.lv[f]];
      if (!L || L.auto || L.mode) continue;
      const g = fresh && fresh(f);
      if (g && layoutKey(g) === layoutKey(L)) L.auto = 1; else L.mode = 'custom';
      n++;
    }
  }
  world.levelModes = 1;
  return n;
}

export function generateLevels(world, b, rng) {
  void rng;
  // every floor has its own dice (seeded by the building and the floor), so one floor's layout never depends on how many
  // draws another one took — a resize that changes the lobby leaves the dice of the floors above as they were
  const fr = k => new RNG(`${b.seed}:floor:${k}`);
  b.lv = [];
  if (b.type === 'park') { const r = fr(0); b.lv = [addLevel(world, b, validate(b, buildLevel(b, 0, r, { dance: r.chance(0.3) }), 0), true)]; return; }
  b.lv[0] = addLevel(world, b, validate(b, buildLevel(b, 0, fr(0)), 0), true);
  if (b.floors <= 1) return;
  if (b.type === 'hq') {
    for (let f = 1; f < b.floors; f++) b.lv[f] = addLevel(world, b, validate(b, buildLevel(b, f, fr(f)), f), false);
    return;
  }
  const nT = b.type === 'office' ? Math.min(2, b.floors - 1) : 1;
  const tpl = [];
  for (let k = 0; k < nT; k++) tpl.push(addLevel(world, b, validate(b, buildLevel(b, 1 + k, fr(1 + k)), 1), false));
  // a floor whose flats were added or taken away by hand has its own layout from its plan (the same dice as its neighbours)
  for (let f = 1; f < b.floors; f++) b.lv[f] = b.flatPlans?.[f] ? addLevel(world, b, validate(b, buildLevel(b, f, fr(1), { plan: b.flatPlans[f] }), 1), false) : tpl[(f - 1) % nT];
}
/** Create a building record from a spec (used by the editor's "new building" tool). */
export function createBuilding(world, spec, seed = Date.now()) {
  const rng = new RNG('build:' + seed);
  const used = { tower: new Set(), apt: new Set(), cafe: new Set(), shop: new Set(), gym: new Set(), rest: new Set(), park: new Set() };
  const uniqueName = (pool) => rng.pick(pool);
  const b = makeBuilding(world.buildings.length, spec, rng, uniqueName);
  void used;
  world.buildings.push(b);
  generateLevels(world, b, rng);
  return b;
}

/** Remove items that make the level unreachable, and items whose slots can't be reached. */
export function validate(b, lvl, f) {
  for (let pass = 0; pass < 4; pass++) {
    const g = buildGrid(b, lvl);
    const entries = levelEntries(b, f);
    const seeds = entries.map(p => nearestFree(g, p.x, p.z, 3));
    const reach = flood(g, seeds.filter(s => s >= 0));
    let removed = 0;
    // every entry must be reachable from the first entry
    const unreachableEntry = seeds.findIndex(s => s < 0 || !reach[s]);
    const first = flood(g, [seeds[0]].filter(s => s >= 0));
    const disconnected = entries.findIndex((p, k) => seeds[k] < 0 || !first[seeds[k]]);
    if (disconnected >= 0 || unreachableEntry >= 0) {
      // remove the closest movable item to the disconnected entry path
      const p = entries[Math.max(disconnected, unreachableEntry, 0)], q = entries[0];
      let best = -1, bd = 1e9;
      lvl.items.forEach((it, k) => {
        const def = CATALOG[it.t]; if (!def || def.fixed || def.block === false) return;
        const dd = distToSeg(it.x, it.z, p.x, p.z, q.x, q.z);
        if (dd < bd) { bd = dd; best = k; }
      });
      if (best >= 0) { lvl.items.splice(best, 1); continue; }
    }
    const keep = [];
    for (const it of lvl.items) {
      const def = CATALOG[it.t];
      if (!def) continue;
      if (!def.slots.length || def.fixed) { keep.push(it); continue; }
      let ok = false;
      for (const s of def.slots) {
        const a = itemToLocal(it, s.ax ?? s.x, s.az ?? s.z);
        const c = cellOf(g, a.x, a.z);
        const c2 = c >= 0 && !g.blocked[c] ? c : nearestFree(g, a.x, a.z, 1);
        if (c2 >= 0 && reach[c2]) { ok = true; break; }
      }
      if (ok) keep.push(it); else removed++;
    }
    lvl.items = keep;
    if (!removed) break;
  }
  return lvl;
}
function distToSeg(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / L2));
  return Math.hypot(x1 + dx * t - px, z1 + dz * t - pz);
}

// ------------------------------------------------------------------------------------------------
export function placeStations(world, g, rng) {
  const is = [], js = [];
  for (let i = 1; i < g.nx; i += 3) is.push(i);
  for (let j = 1; j < g.nz; j += 3) js.push(j);
  if (g.nx >= 6 && is[is.length - 1] < g.nx - 2) is.push(g.nx - 1);
  let n = 0;
  for (const j of js) for (const i of is) {
    // kiosk on the -x sidewalk of block (i, j), just south of its x0z0 corner
    if (i >= g.nx || j >= g.nz) continue;
    const r = blockRect(g, i, j);
    const st = { id: 's' + n, name: N.STATION_NAMES[n % N.STATION_NAMES.length], block: blockIndex(g, i, j), i, j,
      x: r2(r.x0 + 0.95), z: r2(r.z0 + 11), len: 3.6, // kiosk centre, runs along z
      entry: { x: r2(r.x0 + 0.95), z: r2(r.z0 + 13.4) }, band: { x: r2(r.x0 + WALK_BAND), z: r2(r.z0 + 13.4) } };
    world.stations.push(st); n++;
  }
  void rng;
}
export function placeTrees(world, g, rng) {
  const doors = [];
  for (const b of world.buildings) {
    if (b.type === 'park') {
      // gates on all four sides
      for (const [lx, lz] of [[0, b.d / 2 + 1], [b.w / 2 + 1, 0], [0, -b.d / 2 - 1], [-b.w / 2 - 1, 0]]) doors.push(toWorld(b, lx, lz));
    } else doors.push(toWorld(b, b.door.x, b.d / 2 + 1));
  }
  const near = (x, z) => {
    for (const d of doors) if (Math.abs(d.x - x) < 3.2 && Math.abs(d.z - z) < 3.2) return true;
    for (const s of world.stations) if (Math.abs(s.x - x) < 2 && Math.abs(s.z - z) < 4.5) return true;
    // keep block corners clear for crosswalks
    const i = Math.floor((x - g.X[0]) / g.px), j = Math.floor((z - g.Z[0]) / g.pz);
    if (i >= 0 && j >= 0 && i < g.nx && j < g.nz) {
      const r = blockRect(g, i, j);
      const dx = Math.min(x - r.x0, r.x1 - x), dz = Math.min(z - r.z0, r.z1 - z);
      if (dx < 7.5 && dz < 7.5) return true;
    }
    return false;
  };
  for (const t of streetTreePositions(g, near)) {
    if (rng.chance(0.12)) continue;
    world.trees.push([r2(t.x), r2(t.z), rng.int(0, 5), r2(rng.float(0.85, 1.2))]);
  }
}

export { SIDEWALK, SIDE_CORNERS, cornerPoint, footprint, rectsOverlap, doorPoints, WALL_T };
