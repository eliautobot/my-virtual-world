// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// World editor: furniture (per floor or per shared layout), buildings (properties, floors, add, delete), residents.
// Every op is validated with the shared rules; patches are broadcast to clients and agents re-plan around changes.
// The journal (PLAN WP1.8, DECISIONS C35, C116): each accepted batch records, for every piece of the world it changed,
// the state before and after (the state keys below) with the account that made it; restore() writes such states back
// for undo, redo and revert once server/world/journal.js has checked that nobody changed them since.
// State keys: bp:<b> a building's properties · bx:<b> whether it stands (1) or not (0) · bf:<b> its floors (count,
// elevator core, the layout of each floor and a hash of each floor's furniture) · i:<lv>:<id> one item of a floor
// layout · p:<i> a resident's name and look · bg:<b> where a building stands and its size (x, z, w, d, rot, base,
// block, lot) · lw:<lv> a floor layout's inner walls · lv:<lv> a whole floor layout (a floor generated again) ·
// lm:<lv> how a floor layout came to be (auto / custom / empty, shared/edit.js levelMode) · fl:<b>:<f>:<u> a flat's
// record (owner, deal, rent, tenants, visitors, lock).
import crypto from 'node:crypto';
import { RNG } from '../../shared/rng.js';
import { CATALOG, TYPE_LIST } from '../../shared/catalog.js';
import { checkItem, levelConnected, checkBuilding, normalizeSpec, interiorPlan, conflictGroups, planWords, levelMode, floorsName, piecesWords, followCore, floorUse, fitSaved, USE_NAME, ROOF_KINDS, BUILD_STYLES } from '../../shared/edit.js';
import { GROUND_Y, floorY, ctxOf, ctxB, MAX_FLOORS } from '../../shared/constants.js';
import { doorPoints } from '../../shared/building.js';
import { toWorld, footprint } from '../../shared/geom.js';
import { makeGrid, blockAt } from '../../shared/city.js';
import { alignmentGeometry, project, DEFAULT_ROAD_PROFILES } from '../../shared/roads.js';
import { beyondCity, checkIslandBuilding, baseFor, buildingPads, gridPadAt } from '../../shared/island-build.js';
import { doorReason } from '../../shared/door-access.js';
import { Island } from '../../shared/terrain.js';
import { normalizeRoad, roadProblems, nextRoadId } from './road-rules.js';
import { joinCityEdge } from '../../shared/city-roads.js';
import { terrainWhy } from '../../shared/terrain-rules.js';
import { normalizeEdit, EDIT_KINDS } from '../../shared/terrain-edits.js';
import { normalizeDecor, checkDecor, DECOR_LIMITS } from '../../shared/decor.js';
import { isAdAsset, isIndoorSign, INDOOR_SIGNS, signFace, signSize, signStyle, normalizeSignSettings, normalizeRoofSigns, SIGN_ACCENT } from '../../shared/signs.js';
import { normalizeStation, checkStation } from '../../shared/stations.js';
import { normalizeWorldModule, checkWorldModule, levelFor, WORLD_KINDS, roadEndOf, LAYOUT_V, terminalSpec, accessRoadsOf, hasBuilding, clampLevel, dockWhy, moduleDecor } from '../../shared/world-modules.js';
import { profileAt, DRAW_LIFT } from '../../shared/island-roads.js';
import { normalizeWall, checkWall, checkLayout, editWalls, doorway } from '../../shared/walls.js';
import { coastClasses, protectedWhy, COAST_CLASSES, SECTORS, ISLE_SECTORS, isleClasses } from '../../shared/coasts.js';
import { islandSlots, newIsland, TEMPLATES, ISLAND_GAP } from '../../shared/island-chain.js';
import { createBuilding, generateLevels, addLevel, validate, freshLevels, freshLevel } from './generate.js';
import { normalizeFerry, nextFerryId, ferryWhy } from '../../shared/ferries.js';
import { buildLevel, coreFor } from './layouts.js';
import { makeCitizen, reassign, sanitizeName, sanitizeAppearance, freeBed, freeWork } from '../sim/population.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const r3 = v => Math.round(v * 1000) / 1000;
const clean = s => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim();
const sortKeys = v => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v);
/** A state as a string that is equal for equal states (keys sorted). */
export const canon = v => JSON.stringify(sortKeys(v === undefined ? null : v));
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const lowerFirst = s => (s ? s[0].toLowerCase() + s.slice(1) : s);
const itemName = t => (CATALOG[t] && CATALOG[t].name) || t;
const floorName = (B, f) => (B.floors > 1 ? `${B.name}, floor ${f + 1}` : B.name);

/** The floors whose layout differs between two floor states of one building (bf keys). */
export function changedFloors(a, b) {
  const out = [], n = Math.max(a?.lv?.length || 0, b?.lv?.length || 0);
  for (let f = 0; f < n; f++) if ((a?.lv?.[f] ?? null) !== (b?.lv?.[f] ?? null)) out.push(f);
  return out;
}

/**
 * A sign's face to the size op o asks (fw, fh: m, either or both; shared/signs.js signSize keeps it within its kind's
 * sizes, larger in a park, open to the sky): stored as fw × fh, none when it is the type's own size; a sign scaled
 * the old way (s) is sized from then on.
 */
function sizeSign(it, o, open) {
  if (o.fw === undefined && o.fh === undefined) return;
  const F = signFace(it), T = INDOOR_SIGNS[it.t], z = signSize(it.t, o.fw ?? F.w, o.fh ?? F.h, open);
  delete it.s;
  if (z.w === T.face.w && z.h === T.face.h) { delete it.fw; delete it.fh; } else { it.fw = z.w; it.fh = z.h; }
}

export class Editor {
  constructor(app) { this.app = app; this.rng = new RNG('editor:' + Date.now()); this.journal = null; this.rights = null; this.actor = null; this.library = null; this.accounts = null; this.guard = null; }
  get world() { return this.app.world; }
  get sim() { return this.app.sim; }
  bld(b) {
    const B = this.world.buildings[b | 0];
    if (!B || B.gone) throw new Error('No such building');
    return B;
  }
  floorOf(B, f) {
    f = f | 0;
    if (f < 0 || f >= B.floors) throw new Error('No such floor');
    return f;
  }
  refs(B, lv) { return B.lv.reduce((n, x) => n + (x === lv ? 1 : 0), 0); }
  /** Level to edit for (b, f). Shared layouts are copied for the single floor unless scope === 'all'. The layout is
   *  changed by hand from here on (custom: a resize keeps it and asks about whatever no longer fits). */
  editable(B, f, scope, st, { byHand = true, furniture = false } = {}) {
    const lv = B.lv[f];
    if (st.touched.has(`lv:${lv}`)) throw new Error('That floor was just laid out again; change it in a separate step');
    if (scope === 'all' || this.refs(B, lv) <= 1) {
      // (furniture alone: only the people using or standing at the pieces that changed re-plan — softTouch, finish)
      if (!furniture) for (let k = 0; k < B.floors; k++) if (B.lv[k] === lv) st.ctx.add(ctxOf(B.idx, k));
      st.levels.add(lv);
      if (byHand) this.byHand(lv, st);
      return lv;
    }
    const copy = JSON.parse(JSON.stringify(this.world.levels[lv]));
    this.world.levels.push(copy);
    const nlv = this.world.levels.length - 1;
    B.lv[f] = nlv;
    st.levels.add(nlv); if (!furniture) st.ctx.add(ctxOf(B.idx, f)); st.blv.add(B.idx);
    if (byHand) this.byHand(nlv, st);
    return nlv;
  }
  /** Marks a floor layout as changed by hand (journaled: undoing the change makes it generated again). */
  byHand(lv, st) {
    const L = this.world.levels[lv];
    if (!L || levelMode(L) === 'custom') return;
    this.touch(st, `lm:${lv}`);
    this.setMode(L, 'custom');
  }
  setMode(L, mode) {
    delete L.auto; delete L.mode;
    if (mode === 'auto') L.auto = 1; else L.mode = mode;
  }
  newState() {
    return {
      levels: new Set(), ctx: new Set(), soft: new Map(), blv: new Set(), blds: new Set(), newB: [], grown: [], removedB: [], people: new Set(), added: [],
      jumps: new Map(), notes: [], touched: new Map(), fp: new Map(), summary: [], logOnly: [], place: null, roads: new Set(), terrain: false, decor: false, stations: false, ferries: false, wmods: false, flats: false, doors: false, replan: new Set(),
    };
  }
  /**
   * Apply a batch of ops atomically-ish (each op validated; failing op stops the batch). actor: { id, name } of the
   * account (or a name, for tools); the batch is journaled as one undo step. A server package acting on its own
   * (actor.system, e.g. 'economy' recording a flat sold or rented) passes journal: false: its changes aren't edits anyone
   * may undo.
   */
  apply(ops, actor = null, { journal = true, atomic = false } = {}) {
    if (!Array.isArray(ops)) ops = [ops];
    const who = typeof actor === 'string' ? actor : actor?.name || '';
    // Who acts, for lot rights (WP4.6): an account with its admin flag; tools (a string actor) act as administrators.
    this.actor = typeof actor === 'string' || !actor ? { admin: true, subject: null, name: who } : { admin: actor.admin !== false, subject: actor.subject || null, name: who, system: actor.system || null, agentBody: actor.agentBody || null };
    let st = this.newState();
    const results = [];
    let error = null, forbidden = false;
    // All or nothing (the road grid tool, 2026-10-13: a grid half built is worse than none): a batch of road changes
    // only, asked for atomically, leaves the roads as they were when any of its ops is refused.
    // (a world module and its access road are placed the same way: an airport not joined to a road is not placed)
    const whole = atomic && ops.length && ops.every(o => o && /^(road\.(set|del)|wmod\.(add|set|del))$/.test(o.op)), roadsBefore = this.world.roads, wmodsBefore = this.world.worldModules, decoBefore = this.world.decorations, nb0 = this.world.buildings.length, nl0 = this.world.levels.length;
    for (const op of ops.slice(0, 50)) {
      try { results.push(this.op(op || {}, st)); }
      catch (e) { error = e.message || String(e); forbidden = !!e.forbidden; break; }
    }
    const failedAt = error ? results.length : null;
    if (error && whole) {
      this.world.roads = roadsBefore; if (wmodsBefore === undefined) delete this.world.worldModules; else this.world.worldModules = wmodsBefore;
      if (decoBefore === undefined) delete this.world.decorations; else this.world.decorations = decoBefore;   // (a dock's benches and trees made in the batch)
      this.world.buildings.length = nb0; this.world.levels.length = nl0;   // an airport's terminal made in the batch goes too
      for (const k of st.touched.keys()) if (k.startsWith('bx:') && +k.slice(3) < nb0) { const B = this.world.buildings[+k.slice(3)]; if (B && B.gone && st.removedB.includes(B.idx)) delete B.gone; }   // and one it removed stands again
      st = this.newState(); results.length = 0;
    }
    // A road or a world module changed: each module meets its access road level (in the same edit: undone with it)
    else if (ops.some(o => /^(road|wmod)\./.test(o?.op || ''))) { try { this.levelToRoads(st); } catch (e) { console.warn('[world] levelling modules to their roads:', e.message); } }
    const entry = journal ? this.entryOf(st) : null;
    let rec = null, done = false;
    // The changed rows of the world and the journal entry commit together (WP4.1, server/world/world-db.js).
    const commit = () => {
      const patches = this.finish(st);
      if (patches.length) this.app.onPatches(patches, who);
      if (entry && this.journal) {
        try { rec = this.journal.record(entry, typeof actor === 'string' ? { id: null, name: actor } : actor); }
        catch (e) { this.journal.onError?.(e); }   // the edit stands; it just cannot be undone
      }
      done = true;
    };
    try { if (this.app.commit) this.app.commit(commit); else commit(); }
    catch (e) { if (!done) throw e; this.journal?.onError?.(e); rec = null; }   // not written: the store's next sweep writes the world
    return { ok: !error, error, ...(forbidden ? { code: 'forbidden' } : {}), ...(error ? { failedAt } : {}), results, version: this.world.version, edit: rec ? rec.id : null };
  }
  op(o, st) {
    if (this.rights && !/^(flat|door)\./.test(String(o.op || ''))) {   // (flats and doors have their own: the owner, the buyer, tenants)
      const why = this.rights.check(o, this.actor, o.op === 'bld.add' ? normalizeSpec(o.spec || o, this.world) : o.op === 'bld.place' ? this.placeSpec(o) : null);
      if (why) throw Object.assign(new Error(why), { forbidden: true });
    }
    // what the economy sold or lets stays as it was sold (server/economy/realty.js: flats sold, rented or being bought)
    if (this.guard && !this.actor?.system) {   // the server's own packages (the economy) aren't held back by them
      const why = this.guard(o, this);
      if (why) throw Object.assign(new Error(why), { forbidden: true });
    }
    switch (o.op) {
      case 'item.add': case 'item.move': case 'item.del': case 'item.tint': case 'item.sign': return this.itemOp(o, st);
      case 'wall.add': case 'wall.del': case 'wall.door': case 'wall.edit': return this.wallOp(o, st);
      case 'lvl.clear': case 'lvl.regen': case 'lvl.reset': case 'lvl.apply': return this.levelOp(o, st);
      case 'flat.set': case 'flat.invite': case 'flat.uninvite': return this.flatOp(o, st);
      case 'flat.add': case 'flat.del': return this.flatPlanOp(o, st);
      case 'flat.lease': return this.flatLease(o, st);
      case 'door.set': return this.doorOp(o, st);
      case 'bld.set': return this.bldSet(o, st);
      case 'bld.signs': return this.bldSigns(o, st);
      case 'sign.hide': return this.signHide(o, st);
      case 'bld.floors': return this.bldFloors(o, st);
      case 'bld.del': return this.bldDel(o, st);
      case 'bld.add': return this.bldAdd(o, st);
      case 'bld.place': return this.bldPlace(o, st);
      case 'person.set': return this.personSet(o, st);
      case 'person.add': return this.personAdd(o, st);
      case 'person.del': return this.personDel(o, st);
      case 'road.set': return this.roadSet(o, st);
      case 'road.del': return this.roadDel(o, st);
      case 'terrain.add': return this.terrainAdd(o, st);
      case 'terrain.del': return this.terrainDel(o, st);
      case 'deco.add': case 'deco.move': return this.decoSet(o, st);
      case 'deco.del': return this.decoDel(o, st);
      case 'station.add': return this.stationAdd(o, st);
      case 'station.set': return this.stationSet(o, st);
      case 'station.del': return this.stationDel(o, st);
      case 'ferry.set': return this.ferrySet(o, st);
      case 'ferry.del': return this.ferryDel(o, st);
      case 'wmod.add': return this.wmodAdd(o, st);
      case 'wmod.set': return this.wmodSet(o, st);
      case 'wmod.del': return this.wmodDel(o, st);
      case 'wmod.level': if (!this.actor?.admin) throw new Error('Only administrators level world modules'); return { levelled: this.levelToRoads(st) };
      case 'wmod.decor': if (!this.actor?.admin) throw new Error('Only administrators furnish world modules'); for (const m of this.world.worldModules || []) if (!this.decorAsLaid(m)) { this.removeModuleDecor(m, st); this.addModuleDecor(m, st); } return {};
      case 'coast.set': return this.coastSet(o, st);
      case 'island.add': return this.islandAdd(o, st);
      case 'island.del': return this.islandDel(o, st);
      default: throw new Error('Unknown edit');
    }
  }
  note(st, text, place = null) {
    st.summary.push(text);
    if (!st.place && place) st.place = place;
  }
  // ------------------------------------------------------------------ interior walls (WP4.8, shared/walls.js)
  wallOp(o, st) {
    const B = this.bld(o.b), f = this.floorOf(B, o.f);
    if (B.type === 'park') throw new Error('Parks have no walls');
    const lv = this.editable(B, f, o.scope, st), L = this.world.levels[lv], where = { b: B.idx, f };
    const walls = L.walls || (L.walls = []);
    this.touch(st, `lw:${lv}`);
    if (o.op === 'wall.add') {
      const w = normalizeWall(o.wall);
      if (w instanceof Error) throw w;
      const why = checkWall(B, f, L, w);
      if (why) throw new Error(why);
      walls.push(w);
      this.note(st, `Built a ${w[4] ? 'glass ' : ''}wall · ${floorName(B, f)}`, where);
      return { lv, i: walls.length - 1 };
    }
    if (o.op === 'wall.edit') {
      // several walls at once (a corner dragged, a wall slid, a room, walls taken down together): all or nothing
      const r = editWalls(L, { set: o.set, add: o.add, del: o.del });
      if (r instanceof Error) throw r;
      if ((o.set || []).length + (o.add || []).length + (o.del || []).length > 64) throw new Error('Too many walls at once');
      const why = checkLayout(B, f, L, r.walls, r.changed);
      if (why) throw new Error(why);
      walls.splice(0, walls.length, ...r.walls);
      const what = o.add?.length && !o.set?.length && !o.del?.length ? `Built ${o.add.length > 2 ? 'a room' : `${o.add.length} walls`}` : o.del?.length && !o.set?.length && !o.add?.length ? `Took down ${o.del.length} wall${o.del.length > 1 ? 's' : ''}` : 'Moved walls';
      this.note(st, `${what} · ${floorName(B, f)}`, where);
      return { lv };
    }
    const i = o.i | 0, w = walls[i];
    if (!w) throw new Error('No such wall');
    if (o.op === 'wall.del') { walls.splice(i, 1); this.note(st, `Took down a wall · ${floorName(B, f)}`, where); return { lv }; }
    const parts = doorway(w, +o.x, +o.z, Math.max(0.8, Math.min(2.4, +o.width || 1)));
    walls.splice(i, 1, ...parts);
    this.note(st, `Made a doorway · ${floorName(B, f)}`, where);
    return { lv };
  }
  // ------------------------------------------------------------------ whole floors (floor layouts, 2026-10-04)
  /** A whole floor at once: lvl.clear empties it (the elevator stays; it stays empty when the building is resized),
   *  lvl.regen lays it out again with a new roll of the dice, lvl.reset gives it back the building's own generated
   *  layout, lvl.apply lays a saved layout onto it (o.layout: its id in the caller's library, fitted to this floor's size;
   *  pieces that don't fit need o.fit 'keep'). Shared layouts are copied for the single floor unless scope === 'all'.
   *  One undo brings the floor back. */
  levelOp(o, st) {
    const B = this.bld(o.b), f = this.floorOf(B, o.f);
    for (const k of st.touched.keys()) if (k.startsWith(`i:${B.lv[f]}:`) || k === `lw:${B.lv[f]}` || k === `lm:${B.lv[f]}`) throw new Error('Change the whole floor in a separate step from its furniture');
    let rec = null, fit = null;
    if (o.op === 'lvl.apply') {   // everything is checked before anything changes
      const me = this.actor?.subject?.kind === 'account' ? Number(this.actor.subject.id) : null;
      rec = me !== null && this.library ? this.library.usable(o.layout, me) : null;
      if (!rec) throw new Error('No such saved layout');
      const use = floorUse(B, f), a = t => (/^[aeiou]/i.test(t) ? `an ${t}` : `a ${t}`);
      if (rec.use !== use) throw new Error(`“${rec.name}” is for ${a(USE_NAME[rec.use] || rec.use)}; this is ${a(USE_NAME[use] || use)}`);
      fit = fitSaved(B, f, rec, this.world.levels[B.lv[f]]);
      if (fit.why) throw new Error(fit.why);
      if (!fit.keepOk) throw new Error(`${fit.keepWhy}: “${rec.name}” doesn't suit this floor`);
      const n = fit.remove.length;
      if (n && o.fit !== 'keep') throw new Error(`${n} piece${n > 1 ? 's' : ''} of “${rec.name}” ${n > 1 ? "don't" : "doesn't"} fit this floor (${piecesWords(fit.remove)}): apply it without ${n > 1 ? 'them' : 'it'}, or cancel`);
    }
    const lv = this.editable(B, f, o.scope, st, { byHand: false }), L = this.world.levels[lv], where = { b: B.idx, f };
    this.touch(st, `lv:${lv}`);
    const floors = B.lv.map((x, k) => (x === lv ? k : -1)).filter(k => k >= 0), name = floorsName(B, floors);
    const keep = { b: L.b ?? B.idx, ...(L.ground ? { ground: 1 } : {}) };
    if (o.op === 'lvl.clear') {
      const fixed = L.items.filter(it => CATALOG[it.t]?.fixed || it.t === 'door');
      this.setLevel(L, { ...keep, name: B.type === 'park' ? L.name : 'Empty floor', items: structuredClone(fixed), walls: [], zones: [], mode: 'empty' });
      this.note(st, `Cleared ${name} · ${B.name}`, where);
    } else if (o.op === 'lvl.regen') {
      const roll = this.rng.int(1, 1e9);
      this.setLevel(L, { ...freshLevel(B, floors[0], roll), ...keep });
      this.note(st, `Laid out ${name} anew · ${B.name}`, where);
    } else if (o.op === 'lvl.apply') {
      const items = fit.layout.items.map((it, k) => ({ ...it, id: k + 1 }));
      this.setLevel(L, { ...keep, ...fit.layout, items, nid: items.length + 1, mode: 'custom' });
      this.note(st, `Laid out ${name} as “${rec.name}”${fit.remove.length ? ` without ${piecesWords(fit.remove)}` : ''} · ${B.name}`, where);
    } else {
      const want = freshLevels(B)(floors[0]);
      if (!want) throw new Error('That floor cannot be generated');
      this.setLevel(L, { ...want, ...keep });
      this.note(st, `Reset ${name} to its generated layout · ${B.name}`, where);
    }
    return { lv, mode: levelMode(L) };
  }
  // ------------------------------------------------------------------ flats (2026-10-05)
  // The building's owner holds every flat and may assign it, rent it out or sell it; tenants are characters, AI agents
  // or users; tenants and the buyer invite visitors until a time; a locked flat lets only its people through its door.
  // A record lives in the world doc `flats` under "<b>:<f>:<u>" (no record: the owner's, lived in as the city decides).
  /** Who may change flat (B, f) record rec: 'own' (the building's owner or an administrator: the deal, the buyer, the rent,
   *  tenants), 'keep' (the flat's buyer: tenants, lock, visitors), 'live' (a tenant who is a user: lock, visitors), or null. */
  flatPower(B, rec) {
    const a = this.actor || {};
    if (a.admin) return 'own';
    if (this.rights && !this.rights.check({ op: 'bld.set', b: B.idx }, a)) return 'own';
    const me = a.subject?.kind === 'account' ? String(a.subject.id) : null;
    if (me && rec?.owner?.kind === 'account' && String(rec.owner.id) === me) return 'keep';
    if (me && rec?.tenants?.some(t => t.kind === 'account' && String(t.id) === me)) return 'live';
    return null;
  }
  /** A person (a character or an AI agent's character, by index) or a user (by username or id), checked. */
  flatWho(w) {
    if (w?.kind === 'person') { const p = this.sim.people[w.id | 0]; if (!p || p.retired) throw new Error('No such resident'); return { kind: 'person', id: w.id | 0 }; }
    if (w?.kind === 'account') {
      const a = w.login !== undefined ? this.accounts?.byLogin(String(w.login).trim().toLowerCase()) : this.accounts?.byId(Number(w.id));
      if (!a) throw new Error('No player with that username');
      return { kind: 'account', id: a.id, name: a.name };
    }
    throw new Error('Choose a resident, an agent or a player');
  }
  /** A free bed in flat u of floor f of B for person i (or null). */
  flatBed(B, f, u, i) {
    const lv = B.lv[f], idx = this.sim.index, used = new Set();
    this.sim.people.forEach((p, k) => { if (k !== i && !p.retired && p.home) used.add(`${p.home.b}:${p.home.f}:${p.home.bed[0]}:${p.home.bed[1]}`); });
    for (const id of idx.unitItems(lv, u)) { const e = idx.slots(lv).get(id); for (const sl of e.slots) if (sl.use === 'sleep' && !used.has(`${B.idx}:${f}:${id}:${sl.k}`)) return { b: B.idx, f, u, bed: [id, sl.k] }; }
    return null;
  }
  flatOp(o, st) {
    const B = this.bld(o.b), f = this.floorOf(B, o.f), L = this.world.levels[B.lv[f]], u = o.u | 0, W = this.world;
    if (B.type !== 'apartment' || !L?.units?.[u]) throw new Error('No such flat');
    const key = `${B.idx}:${f}:${u}`, was = W.flats?.[key] || null, power = this.flatPower(B, was);
    if (!power) throw Object.assign(new Error("Only the building's owner, the flat's buyer or its tenants can change this flat"), { forbidden: true });
    const rec = structuredClone(was || { deal: 'own', tenants: [], visitors: [] }), name = `flat ${u + 1} on ${floorsName(B, [f])} of ${B.name}`;
    const now = Date.now();
    rec.visitors = (rec.visitors || []).filter(v => v.until > now);
    const same = (a, b) => a.kind === b.kind && String(a.id) === String(b.id);
    if (o.op === 'flat.set') {
      if ((o.deal !== undefined || o.owner !== undefined || o.rent !== undefined) && power !== 'own') throw Object.assign(new Error("Only the building's owner deals in its flats"), { forbidden: true });
      if (o.deal !== undefined) {
        if (!['own', 'assigned', 'rented', 'sold'].includes(o.deal)) throw new Error('Assign, rent or sell');
        rec.deal = o.deal;
        if (o.deal === 'sold') rec.owner = this.flatWho(o.owner); else delete rec.owner;
        if (o.deal === 'rented') rec.rent = Math.max(0, Math.min(1e7, Math.round(+o.rent || 0))); else delete rec.rent;
      } else if (o.rent !== undefined && rec.deal === 'rented') rec.rent = Math.max(0, Math.min(1e7, Math.round(+o.rent || 0)));
      if (o.tenants !== undefined) {
        if (power === 'live') throw Object.assign(new Error('Tenants cannot choose the tenants'), { forbidden: true });
        const list = (Array.isArray(o.tenants) ? o.tenants : []).slice(0, 8).map(w => this.flatWho(w)).filter((w, k, a) => a.findIndex(x => same(x, w)) === k);
        // characters and agents who are tenants live here (a bed each); people who lived here and aren't any more move out
        for (const [i, p] of this.sim.people.entries()) {
          if (p.retired) continue;
          const tenant = list.some(w => w.kind === 'person' && w.id === i), here = p.home && p.home.b === B.idx && p.home.f === f && p.home.u === u;
          if (tenant && !here) { const h = this.flatBed(B, f, u, i); if (!h) throw new Error(`No free bed for ${p.name} in ${name}`); this.touch(st, `pl:${i}`); p.home = h; st.people.add(p); st.replan.add(i); }
          else if (!tenant && here) { this.touch(st, `pl:${i}`); p.home = null; st.people.add(p); st.replan.add(i); }
        }
        rec.tenants = list;
      }
      if (o.locked !== undefined) rec.locked = !!o.locked;
    } else {
      const w = this.flatWho(o.who);
      rec.visitors = rec.visitors.filter(v => !same(v, w));
      if (o.op === 'flat.invite') rec.visitors.push({ ...w, until: now + Math.round(Math.max(0.25, Math.min(72, +o.hours || 2)) * 3600e3) });
    }
    this.touch(st, `fl:${key}`);
    W.flats = { ...(W.flats || {}), [key]: rec };
    st.flats = true;
    this.note(st, o.op === 'flat.invite' ? `Invited a visitor to ${name}` : o.op === 'flat.uninvite' ? `Took back an invitation to ${name}` : `Changed ${name}`, { b: B.idx, f });
    return { key, flat: rec };
  }
  /**
   * The economy's part of a flat's record (server/economy/realty.js; never from a browser): 'sold' for Virtual Coin to a
   * player (its owner), 'rented' for Virtual Coin to a player or an AI agent's character (the tenant; o.rent: whole VC a
   * month) — whoever lived there moves out, a character who rents it moves in — or 'own' again when a lease ends (o.vacate
   * moves out). Records it touches carry vc: 1.
   */
  flatLease(o, st) {
    if (this.actor?.system !== 'economy') throw Object.assign(new Error('Flats are sold and rented for Virtual Coin through the economy'), { forbidden: true });
    const B = this.bld(o.b), f = this.floorOf(B, o.f), L = this.world.levels[B.lv[f]], u = o.u | 0, W = this.world;
    if (B.type !== 'apartment' || !L?.units?.[u]) throw new Error('No such flat');
    const key = `${B.idx}:${f}:${u}`, rec = structuredClone(W.flats?.[key] || { deal: 'own', tenants: [], visitors: [] });
    const who = w => (w?.kind === 'person' ? { kind: 'person', id: w.id | 0 } : { kind: 'account', id: Number(w?.id), name: this.accounts?.byId(Number(w?.id))?.name || 'A player' });
    const name = `flat ${u + 1} on ${floorsName(B, [f])} of ${B.name}`;
    let moveOut = false, keep = null, text;
    if (o.deal === 'sold') {
      Object.assign(rec, { deal: 'sold', owner: who(o.owner), tenants: [], visitors: [], locked: false, vc: 1 }); delete rec.rent; delete rec.cur;
      moveOut = true; text = `Sold ${name} for Virtual Coin`;
    } else if (o.deal === 'rented') {
      if (!Number.isSafeInteger(o.rent) || o.rent <= 0) throw new Error('Bad rent');
      const t = who(o.tenant);
      Object.assign(rec, { deal: 'rented', rent: o.rent, tenants: [t], visitors: [], locked: false, vc: 1 }); delete rec.cur;
      moveOut = true; keep = t.kind === 'person' ? t.id : null; text = `Let ${name} for Virtual Coin`;
      if (keep !== null) {
        const p = this.sim.people[keep];
        if (!p || p.retired) throw new Error('No such resident');
        const here = p.home && p.home.b === B.idx && p.home.f === f && p.home.u === u;
        if (!here) { const h = this.flatBed(B, f, u, keep); if (!h) throw new Error(`No free bed in ${name}`); this.touch(st, `pl:${keep}`); p.home = h; st.people.add(p); st.replan.add(keep); }
      }
    } else if (o.deal === 'own') {
      const v = o.vacate || {};
      rec.tenants = (rec.tenants || []).filter(t => !(t.kind === v.kind && String(t.id) === String(v.id)));
      if (!rec.tenants.length && rec.deal === 'rented') { rec.deal = 'own'; delete rec.rent; delete rec.vc; }
      if (v.kind === 'person') { const p = this.sim.people[v.id | 0]; if (p && p.home && p.home.b === B.idx && p.home.f === f && p.home.u === u) { this.touch(st, `pl:${v.id | 0}`); p.home = null; st.people.add(p); st.replan.add(v.id | 0); } }
      rec.visitors = []; rec.locked = false; text = `The lease of ${name} ended`;
    } else throw new Error('Bad deal');
    if (moveOut) for (const [i, p] of this.sim.people.entries()) {
      if (i === keep || p.retired || !p.home || p.home.b !== B.idx || p.home.f !== f || p.home.u !== u) continue;
      this.touch(st, `pl:${i}`); p.home = null; st.people.add(p); st.replan.add(i);
    }
    this.touch(st, `fl:${key}`);
    W.flats = { ...(W.flats || {}), [key]: rec };
    st.flats = true;
    this.note(st, text, { b: B.idx, f });
    return { key, flat: rec };
  }
  /** Holds a door open or lets it close, for everyone (the world doc `doors`, "<b>:<f>:<door key>"; not journaled: a door
   *  is opened and shut all day). A locked flat's door: only its people — its owner, tenants, visitors — or the building's. */
  doorOp(o, st) {
    const B = this.bld(o.b), f = this.floorOf(B, o.f), key = String(o.key || '').slice(0, 40), W = this.world;
    if (!/^(entrance|flat:-?\d+:-?\d+|room:-?\d+:-?\d+)$/.test(key)) throw new Error('No such door');
    if (key.startsWith('flat:')) {
      const L = W.levels[B.lv[f]], [, x, z] = key.split(':').map(Number);
      const u = (L?.units || []).findIndex(n => n.door && Math.abs(n.door[0] * 20 - x) < 7 && Math.abs(n.door[1] * 20 - z) < 7), rec = W.flats?.[`${B.idx}:${f}:${u}`];
      const me = this.actor?.subject?.kind === 'account' ? String(this.actor.subject.id) : null, now = Date.now(), mine = w => w?.kind === 'account' && String(w.id) === me;
      if (rec?.locked && this.flatPower(B, rec) !== 'own' && !mine(rec.owner) && !(rec.tenants || []).some(mine) && !(rec.visitors || []).some(v => v.until > now && mine(v))) throw Object.assign(new Error('This flat is locked'), { forbidden: true });
    }
    const dk = `${B.idx}:${f}:${key}`, next = { ...(W.doors || {}) };
    if (o.open) next[dk] = 1; else delete next[dk];
    W.doors = next;
    st.doors = true;
    return { key: dk, open: !!o.open };
  }
  /** A floor's plan of flats: two rows (along the corridor's two sides) of { k: kind, w: width, s: the flat's own dice }. */
  planOf(B, f, L) {
    if (B.flatPlans?.[f]) return structuredClone(B.flatPlans[f]);
    if (L.plan) return structuredClone(L.plan);
    const rows = [0, 1].map(side => (L.units || []).map((u, i) => ({ u, i })).filter(({ u }) => (u.z0 + u.z1 > 0) === (side === 0)).sort((a, b) => a.u.x0 - b.u.x0));
    return rows.map((r, side) => r.map(({ u }, k) => {
      const x0 = k ? (r[k - 1].u.x1 + u.x0) / 2 : u.x0, x1 = k < r.length - 1 ? (u.x1 + r[k + 1].u.x0) / 2 : u.x1;
      return { k: u.kind, w: r3(x1 - x0), s: u.s || `${side}:${k}` };
    }));
  }
  /** Takes flat o.u away (flat.del: its width goes to the flat beside it) or makes it two (flat.add); the floor is laid out
   *  again from its plan — every other flat as it was — and flat records and residents follow their flats. */
  flatPlanOp(o, st) {
    const B = this.bld(o.b), f = this.floorOf(B, o.f), W = this.world, L0 = W.levels[B.lv[f]], u = o.u | 0;
    if (B.type !== 'apartment' || f === 0 || !L0?.units?.[u]) throw new Error('No such flat');
    if (this.flatPower(B, null) !== 'own') throw Object.assign(new Error("Only the building's owner adds or takes away flats"), { forbidden: true });
    const plan = this.planOf(B, f, L0), s0 = L0.units[u].s || null;
    const side = L0.units[u].z0 + L0.units[u].z1 > 0 ? 0 : 1, row = plan[side];
    const at = s0 ? row.findIndex(x => x.s === s0) : -1, k = at >= 0 ? at : row.findIndex((x, i) => i === L0.units.filter((v, j) => j < u && (v.z0 + v.z1 > 0) === (side === 0)).length);
    if (k < 0) throw new Error('No such flat');
    if (o.op === 'flat.del') {
      if (row.length < 2) throw new Error('Each side of the corridor keeps at least one flat');
      const n = k > 0 ? k - 1 : k + 1;
      row[n].w = r3(row[n].w + row[k].w);
      row.splice(k, 1);
    } else {
      if (row[k].w < 10) throw new Error('That flat is too narrow to make two (it takes 10 m)');
      const a = r3(Math.round(row[k].w / 2 * 10) / 10), used = new Set(plan.flat().map(x => x.s));
      let sn = 1; while (used.has(`${row[k].s}+${sn}`)) sn++;
      row.splice(k, 1, { ...row[k], w: a }, { k: row[k].k, w: r3(row[k].w - a), s: `${row[k].s}+${sn}` });
    }
    this.touch(st, `fp:${B.idx}`);
    B.flatPlans = { ...(B.flatPlans || {}), [f]: plan };
    st.blds.add(B.idx);
    const lv = this.editable(B, f, undefined, st, { byHand: false }), L = W.levels[lv];
    this.touch(st, `lv:${lv}`);
    const want = freshLevels(B)(f);
    this.setLevel(L, { ...want, b: L.b ?? B.idx });
    // flat records and residents follow their flats (a flat is known by its dice); those of a flat taken away move out
    const sideOf = x => (x.z0 + x.z1 > 0 ? 0 : 1), sOf = i => L0.units[i].s || `${sideOf(L0.units[i])}:${L0.units.slice(0, i).filter(x => sideOf(x) === sideOf(L0.units[i])).length}`;   // (floors from before plans: by order)
    const map = new Map(L0.units.map((x, i) => [i, L.units.findIndex(y => y.s === sOf(i))]));
    const recs = { ...(W.flats || {}) };
    for (let i = 0; i < L0.units.length; i++) {
      const old = `${B.idx}:${f}:${i}`;
      if (recs[old] === undefined) continue;
      this.touch(st, `fl:${old}`);
    }
    const moved = {};
    for (let i = 0; i < L0.units.length; i++) { const old = `${B.idx}:${f}:${i}`, r = recs[old]; if (r === undefined) continue; delete recs[old]; if (map.get(i) >= 0) moved[`${B.idx}:${f}:${map.get(i)}`] = r; }
    for (const key of Object.keys(moved)) this.touch(st, `fl:${key}`);
    W.flats = { ...recs, ...moved };
    st.flats = true;
    for (const [i, p] of this.sim.people.entries()) {
      if (p.retired || !p.home || p.home.b !== B.idx || p.home.f !== f) continue;
      this.touch(st, `pl:${i}`);
      const nu = map.get(p.home.u);
      p.home = nu >= 0 ? this.flatBed(B, f, nu, i) : null;   // the same flat on the new floor, or a new home elsewhere
      st.people.add(p); st.replan.add(i);
    }
    this.note(st, `${o.op === 'flat.del' ? 'Took away' : 'Split'} flat ${u + 1} on ${floorsName(B, [f])} of ${B.name}`, { b: B.idx, f });
    return { b: B.idx, f, units: L.units.length };
  }
  // ------------------------------------------------------------------ furniture
  /**
   * A piece of furniture changed on level lv of B (was / now: the item before and after, null when there was none):
   * remember it for every floor using that level, so finish() re-plans only the people who use it, hold a place at it,
   * or stand where it was or now is — not everyone on the floor (2026-10-07: moving a chair woke the sleepers).
   */
  softTouch(st, B, lv, was, now) {
    const pts = [];
    for (const it of [was, now]) {
      if (!it) continue;
      const w = toWorld(B, it.x, it.z), R = CATALOG[it.t]?.rect || [-0.5, -0.5, 0.5, 0.5];
      pts.push({ x: w.x, z: w.z, r: Math.max(...R.map(Math.abs)) + 0.6 });
    }
    const id = (now || was).id;
    B.lv.forEach((x, f) => {
      if (x !== lv) return;
      const ctx = ctxOf(B.idx, f);
      if (!st.soft.has(ctx)) st.soft.set(ctx, []);
      st.soft.get(ctx).push({ b: B.idx, f, id, pts });
    });
  }
  itemOp(o, st) {
    const B = this.bld(o.b), f = this.floorOf(B, o.f);
    const lv = this.editable(B, f, o.scope, st, { furniture: true });
    const L = this.world.levels[lv];
    const where = { b: B.idx, f };
    if (o.op === 'item.add') {
      const t = String(o.t || o.item?.t || '');
      if (!TYPE_LIST.includes(t)) throw new Error('Unknown item type');
      if (CATALOG[t].outdoor) throw new Error(`The ${itemName(t).toLowerCase()} stands outdoors only (Marketing)`);
      const src = o.item || o;
      const it = { t, x: r3(+src.x), z: r3(+src.z), r: r3(+src.r || 0) };
      if (CATALOG[t].tint) it.c = HEX.test(src.c) ? src.c.toLowerCase() : isIndoorSign(t) ? SIGN_ACCENT : '#8a8f99';
      if (isIndoorSign(t)) {   // a sign: its face's size, its style and its settings (the owner's design, or ads)
        sizeSign(it, src, B.type === 'park');
        const v = signStyle(t, src.v); if (v) it.v = v;
        if (src.sg) { const sg = normalizeSignSettings(src.sg); if (sg instanceof Error) throw sg; it.sg = sg; }
      }
      const why = checkItem(B, f, L, it);
      if (why) throw new Error(why);
      it.id = L.nid = (L.nid || (Math.max(0, ...L.items.map(i => i.id || 0)) + 1));
      L.nid++;
      L.items.push(it);
      if (!levelConnected(B, f, L)) { L.items.pop(); throw new Error('That would block the way through'); }
      const key = `i:${lv}:${it.id}`;
      if (!st.touched.has(key)) st.touched.set(key, 'null');
      this.softTouch(st, B, lv, null, it);
      this.note(st, `Placed ${itemName(t)} · ${floorName(B, f)}`, where);
      return { id: it.id, lv };
    }
    const k = L.items.findIndex(i => i.id === (o.id | 0));
    if (k < 0) throw new Error('No such item');
    const it = L.items[k];
    if (CATALOG[it.t]?.fixed) throw new Error('That is part of the building');
    this.touch(st, `i:${lv}:${it.id}`);
    if (o.op === 'item.del') {
      L.items.splice(k, 1);
      this.softTouch(st, B, lv, it, null);
      this.note(st, `Removed ${itemName(it.t)} · ${floorName(B, f)}`, where);
      return { id: it.id, lv };
    }
    if (o.op === 'item.tint') {
      if (!CATALOG[it.t].tint || !HEX.test(o.c)) throw new Error('This item cannot be recolored');
      it.c = o.c.toLowerCase();
      this.note(st, `Recoloured ${itemName(it.t)} · ${floorName(B, f)}`, where);
      return { id: it.id, lv };
    }
    if (o.op === 'item.sign') {   // a sign: its size, its settings; administrators may hide one that breaks the rules
      if (!isIndoorSign(it.t)) throw new Error('That is not a sign');
      const old = { ...it };
      sizeSign(it, o, B.type === 'park');
      if (o.v !== undefined) { const v = signStyle(it.t, o.v); if (v) it.v = v; else delete it.v; }
      if (o.c !== undefined) { if (!HEX.test(o.c)) throw new Error('Choose a colour'); it.c = o.c.toLowerCase(); }
      if (o.sg !== undefined) {
        const sg = normalizeSignSettings(o.sg, { keep: it.sg });
        if (sg instanceof Error) throw sg;
        it.sg = sg;
      }
      if (it.fw !== old.fw || it.fh !== old.fh || it.s !== old.s) {
        const undo = () => { for (const k of Object.keys(it)) if (!(k in old)) delete it[k]; Object.assign(it, old); };
        const why = checkItem(B, f, L, it, it.id);
        if (why) { undo(); throw new Error(why); }
        if (!levelConnected(B, f, L)) { undo(); throw new Error('That would block the way through'); }
        this.softTouch(st, B, lv, old, it);
      }
      this.note(st, `Changed ${itemName(it.t)} · ${floorName(B, f)}`, where);
      return { id: it.id, lv };
    }
    const moved = { ...it, x: r3(+o.x), z: r3(+o.z), r: r3(Number.isFinite(+o.r) ? +o.r : it.r) };
    const why = checkItem(B, f, L, moved, it.id);
    if (why) throw new Error(why);
    const old = { ...it };
    Object.assign(it, moved);
    if (!levelConnected(B, f, L)) { Object.assign(it, old); throw new Error('That would block the way through'); }
    this.softTouch(st, B, lv, old, it);
    const turned = old.x === it.x && old.z === it.z;
    this.note(st, `${turned ? 'Turned' : 'Moved'} ${itemName(it.t)} · ${floorName(B, f)}`, where);
    return { id: it.id, lv };
  }
  // ------------------------------------------------------------------ buildings
  bldSet(o, st) {
    const B = this.bld(o.b);
    this.touch(st, `bp:${B.idx}`);
    const was = { name: B.name, sign: B.sign, style: B.style, roofKind: B.roofKind, colors: JSON.stringify(B.colors) };
    if (o.name !== undefined) { const n = clean(o.name).slice(0, 40); if (n) B.name = n; }
    if (o.sign !== undefined) { const s = clean(o.sign).slice(0, 28); if (s) B.sign = s; else delete B.sign; }
    const port = this.airportOf(B);
    if (port && (B.name !== was.name || B.sign !== was.sign)) {   // an airport's terminal: one name on its sign, canopy and entrance
      const n = (B.name !== was.name ? B.name : B.sign) || port.name;
      this.nameAirport(port, n, st);
    }
    if (o.style && BUILD_STYLES.includes(o.style) && B.type !== 'park') B.style = o.style;
    if (o.roofKind && ROOF_KINDS.includes(o.roofKind)) B.roofKind = o.roofKind;
    if (o.colors && typeof o.colors === 'object') {
      for (const k of ['wall', 'trim', 'glass', 'roof', 'accent']) if (HEX.test(o.colors[k])) B.colors[k] = o.colors[k].toLowerCase();
    }
    const where = { b: B.idx };
    if (B.name !== was.name) this.note(st, `Renamed ${was.name} to ${B.name}`, where);
    else if (B.sign !== was.sign) this.note(st, `Changed the sign of ${B.name}`, where);
    else if (B.style !== was.style) this.note(st, `Changed the style of ${B.name} to ${B.style}`, where);
    else if (B.roofKind !== was.roofKind) this.note(st, `Changed the roof of ${B.name}`, where);
    else if (JSON.stringify(B.colors) !== was.colors) this.note(st, `Changed the colours of ${B.name}`, where);
    st.blds.add(B.idx);
    return { b: B.idx };
  }
  /** A building's rooftop billboards (shared/signs.js: at most 2, the owner's own content, never paid ads). */
  bldSigns(o, st) {
    const B = this.bld(o.b);
    if (B.type === 'park') throw new Error('Parks have no roof');
    const want = Array.isArray(o.signs) ? o.signs : [];
    for (const x of want) if (x?.cr) { const c = normalizeSignSettings({ cr: x.cr }); if (c instanceof Error) throw c; }
    const next = normalizeRoofSigns(want, { keep: B.roofSigns || [] });
    this.touch(st, `bp:${B.idx}`);
    if (next.length) B.roofSigns = next; else delete B.roofSigns;
    this.note(st, next.length ? `Changed the rooftop billboard${next.length > 1 ? 's' : ''} of ${B.name}` : `Took down the rooftop billboards of ${B.name}`, { b: B.idx });
    st.blds.add(B.idx);
    return { b: B.idx, signs: next.length };
  }
  /**
   * An administrator hides an owner's sign that breaks the rules (or lifts it): a sign inside ({ b, f, id }) or a
   * rooftop billboard ({ b, roof: k }); blocked: the reason (the owner reads it), '' to lift. Owners can't change it.
   */
  signHide(o, st) {
    if (!this.actor?.admin) throw Object.assign(new Error('Only administrators hide signs'), { forbidden: true });
    const B = this.bld(o.b), why = String(o.blocked || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 200);
    if (o.roof !== undefined) {
      const sg = (B.roofSigns || [])[o.roof | 0];
      if (!sg) throw new Error('No such rooftop billboard');
      this.touch(st, `bp:${B.idx}`);
      if (why) sg.blocked = why; else delete sg.blocked;
      st.blds.add(B.idx);
    } else {
      const f = this.floorOf(B, o.f), lv = this.editable(B, f, 'all', st), L = this.world.levels[lv], it = L.items.find(i => i.id === (o.id | 0));
      if (!it || !isIndoorSign(it.t)) throw new Error('No such sign');
      this.touch(st, `i:${lv}:${it.id}`);
      it.sg = { ...(it.sg || { mode: 'private', cr: null }) };
      if (why) it.sg.blocked = why; else delete it.sg.blocked;
    }
    this.note(st, `${why ? 'Hid' : 'Showed again'} a sign of ${B.name}`, { b: B.idx });
    return { b: B.idx };
  }
  /** Why a batch of edit ops needs a recent password entry because it destroys interiors (DECISIONS C65), or null:
   *  demolishing, removing floors, or switching between one floor and several (which rebuilds every floor). */
  destructive(ops) {
    for (const o of Array.isArray(ops) ? ops : [ops]) {
      if (!o || typeof o !== 'object') continue;
      if (o.op === 'bld.del') return 'Demolishing a building';
      if (o.op === 'road.del') return 'Removing a road';
      if (o.op !== 'bld.floors') continue;
      const B = this.world.buildings[o.b];
      if (!B || B.gone || B.type === 'park') continue;
      const cap = B.type === 'office' || B.type === 'apartment' || B.type === 'hq' ? MAX_FLOORS : 4;   // as in bldFloors
      const n = B.floors, m = Math.max(1, Math.min(cap, o.floors | 0));
      if (m < n) return 'Removing floors';
      if ((n === 1) !== (m === 1)) return 'Rebuilding every floor';
    }
    return null;
  }
  bldFloors(o, st) {
    const B = this.bld(o.b);
    if (B.type === 'park') throw new Error('Parks have no floors');
    const cap = B.type === 'office' || B.type === 'apartment' || B.type === 'hq' ? MAX_FLOORS : 4;
    const n = B.floors, m = Math.max(1, Math.min(cap, o.floors | 0));
    if (m === n) return { b: B.idx, floors: n };
    if ((n === 1) !== (m === 1) && st.touched.has(`bg:${B.idx}`)) throw new Error('Change the size and the number of floors in two steps');
    this.touch(st, `bf:${B.idx}`);
    const rng = new RNG('floors:' + B.idx + ':' + Date.now());
    const allCtx = () => { for (let k = 0; k < Math.max(n, m); k++) st.ctx.add(ctxOf(B.idx, k)); };
    if ((n === 1) !== (m === 1)) {
      // elevator core appears / disappears: renovate every floor
      allCtx();
      B.floors = m; B.core = coreFor(B);
      generateLevels(this.world, B, rng);
      for (const lv of B.lv) st.levels.add(lv);
      for (const p of this.sim.people) {
        if (p.home && p.home.b === B.idx) { p.home = null; st.people.add(p); }
        if (p.job && p.job.b === B.idx && p.job.id !== undefined) { p.job = { kind: 'free', title: 'Between jobs', lost: 1, prev: p.job.kind }; st.people.add(p); }
      }
      this.jumpInside(B, st, 0);
    } else if (m > n) {
      for (let f = n; f < m; f++) {
        let lv;
        if (B.type === 'hq') lv = addLevel(this.world, B, validate(B, buildLevel({ ...B, floors: m + 1 }, Math.max(2, Math.min(f, m - 2)), rng), 1), false);
        else lv = B.lv[Math.min(1, n - 1)];
        B.lv[f] = lv; st.levels.add(lv);
      }
      B.floors = m;
      if (B.type === 'hq') { const top = B.lv[n - 1]; B.lv[n - 1] = B.lv[m - 1]; B.lv[m - 1] = top; st.ctx.add(ctxOf(B.idx, n - 1)); st.ctx.add(ctxOf(B.idx, m - 1)); }
    } else {
      for (let f = m; f < n; f++) st.ctx.add(ctxOf(B.idx, f));
      this.jumpInside(B, st, m);
      B.lv.length = m; B.floors = m;
    }
    if (m > n) st.grown.push([B.idx, n]);
    st.blds.add(B.idx); st.blv.add(B.idx);
    this.note(st, `Gave ${B.name} ${m} floor${m === 1 ? '' : 's'} (was ${n})`, { b: B.idx });
    return { b: B.idx, floors: B.floors };
  }
  /** Agents standing on floors >= fromF of B will be moved to the lobby. */
  jumpInside(B, st, fromF) {
    const dp = doorPoints(B), w = toWorld(B, dp.inside.x, dp.inside.z);
    st.jumps.set(B.idx, { fromF, to: { x: w.x, y: GROUND_Y, z: w.z, ctx: ctxOf(B.idx, 0) } });
  }
  bldDel(o, st) {
    const B = this.bld(o.b);
    this.touch(st, `bx:${B.idx}`);
    st.fp.set(B.idx, this.fingerprint(B.idx));
    this.removeBuilding(B, st);
    this.note(st, `Demolished ${B.name}`, { b: B.idx });
    return { b: B.idx };
  }
  /** Takes a building out of the city: whoever is inside steps out; its residents and staff look for a new home or job. */
  removeBuilding(B, st) {
    const acc = this.sim.nav.acc[B.idx]?.[0];
    const out = acc ? { x: acc.x, y: GROUND_Y, z: acc.z, ctx: -1 } : { x: B.x, y: GROUND_Y, z: B.z + B.d / 2 + 3, ctx: -1 };
    for (let f = 0; f < B.floors; f++) st.ctx.add(ctxOf(B.idx, f));
    st.jumps.set(B.idx, { fromF: 0, to: out });
    B.gone = 1;
    for (const p of this.sim.people) {
      if (p.home && p.home.b === B.idx) { p.home = null; st.people.add(p); }
      if (p.job && p.job.b === B.idx && p.job.id !== undefined) { p.job = { kind: 'free', title: 'Between jobs', lost: 1, prev: p.job.kind }; st.people.add(p); }
    }
    st.removedB.push(B.idx); st.blds.add(B.idx);
  }
  bldAdd(o, st) {
    const alive = this.world.buildings.filter(b => !b.gone).length;
    if (alive >= 900) throw new Error('The city is full');
    const spec = normalizeSpec(o.spec || o, this.world);
    let B;
    if (beyondCity(this.world, spec.x, spec.z)) {
      // Beyond the city (WP4.6): on a level pad at the ground's height, turned to face its road.
      const G = this.ground();
      if (!G) throw new Error('Place it on a city block, not on a street');
      const why = checkIslandBuilding(this.world, spec, G.env) || this.doorWhy(spec);
      if (why) throw new Error(why);
      const rect = { x0: spec.x - spec.w / 2, x1: spec.x + spec.w / 2, z0: spec.z - spec.d / 2, z1: spec.z + spec.d / 2 };
      B = createBuilding(this.world, { type: spec.type, block: null, rot: spec.rot, base: baseFor(G.env.heightAt, spec, this.world), floors: spec.floors, style: spec.style, rect }, Date.now());
    } else {
      const why = checkBuilding(this.world, spec) || this.doorWhy(spec);
      if (why) throw new Error(why);
      const g = makeGrid(this.world.grid), blk = blockAt(g, spec.x, spec.z);
      const fp = footprint(spec);
      B = createBuilding(this.world, { type: spec.type, block: blk.bi, face: spec.rot / 90, floors: spec.floors, style: spec.style, rect: fp }, Date.now());
    }
    if (this.rights) { const lot = this.rights.lotFor(spec); if (lot) B.lot = lot; }   // the lot it stands on (WP4.6)
    const n = clean(o.spec?.name ?? o.name).slice(0, 40);
    if (n) { B.name = n; if (B.sign) B.sign = n.slice(0, 28); }
    for (const lv of B.lv) st.levels.add(lv);
    st.newB.push(B.idx); st.blds.add(B.idx); st.blv.add(B.idx);
    st.touched.set(`bx:${B.idx}`, '0');
    this.note(st, `Placed a new ${B.type === 'park' ? 'park' : B.type}, ${B.name}`, { b: B.idx });
    return { b: B.idx, name: B.name };
  }
  /** The normalised spec a bld.place op asks for (missing fields keep the building's), or null for no building. */
  placeSpec(o) {
    const B = this.world.buildings[o.b | 0];
    if (!B || B.gone) return null;
    const num = (v, cur) => (v === undefined || v === null || !Number.isFinite(+v) ? cur : +v);
    return normalizeSpec({ type: B.type, floors: B.floors, style: B.style, x: num(o.x, B.x), z: num(o.z, B.z), rot: num(o.rot, B.rot || 0), w: num(o.w, B.w), d: num(o.d, B.d) }, this.world);
  }
  /** Why building B can't stand as spec now (where it goes, and anything inside that no choice can fix), or null;
   *  `base` and `block` come back in out. */
  placeWhy(B, spec, out = {}, { interior = true } = {}) {
    const W = this.world, island = B.base !== undefined;
    if (island !== beyondCity(W, spec.x, spec.z)) return island ? 'Keep it beyond the city: buildings out on the island stay out there' : 'Keep it in the city: city buildings stay on the city\'s blocks';
    if (island) {
      const G = this.ground();
      if (!G) return 'This world has no land beyond the city';
      const why = checkIslandBuilding(W, spec, G.env, B.idx) || this.doorWhy({ ...spec, door: B.door }, B.idx);
      if (why) return why;
      out.base = baseFor(G.env.heightAt, spec, W);
    } else {
      const why = checkBuilding(W, spec, B.idx) || this.doorWhy({ ...spec, door: B.door }, B.idx);
      if (why) return why;
      out.block = blockAt(makeGrid(W.grid), spec.x, spec.z).bi;
    }
    return interior ? interiorPlan(B, { x: spec.x, z: spec.z, w: spec.w, d: spec.d, rot: spec.rot }, lv => W.levels[lv], false).why : null;
  }
  /**
   * Moves, turns or resizes a standing building (WP4.6 handles; floor layouts, 2026-10-04). Moving or turning keeps
   * the inside as it is. On a new size its generated floors are laid out again for it (from the building's seed), and the
   * floors changed by hand keep their layout, furniture against a moving side going with it (shared/edit.js interiorPlan).
   * When something on such a floor no longer fits, o.fit says what to do: 'keep' (the layout without the pieces that
   * don't fit: they are deleted, and one undo brings everything back), 'regen' (lay the floor out again), or per floor
   * layout { <lv>: 'keep' | 'regen' }. Without it the change is refused, naming the floors and the pieces. Whoever is
   * inside steps to its lobby.
   */
  bldPlace(o, st) {
    const B = this.bld(o.b), spec = this.placeSpec(o);
    const same = spec.x === B.x && spec.z === B.z && spec.w === B.w && spec.d === B.d && (spec.rot % 360) === ((B.rot || 0) % 360);
    if (same) return { b: B.idx };
    const out = {}, why = this.placeWhy(B, spec, out, { interior: false });
    if (why) throw new Error(why);
    const W = this.world, was = { x: B.x, z: B.z, w: B.w, d: B.d, rot: B.rot || 0 }, g = { x: spec.x, z: spec.z, w: spec.w, d: spec.d, rot: spec.rot };
    const plan = interiorPlan(B, g, lv => W.levels[lv]);
    if (plan.why) throw new Error(plan.why);
    const fitFor = G => { const f = o.fit && typeof o.fit === 'object' ? o.fit[G.lv] : o.fit; return f === 'keep' || f === 'regen' ? f : null; };
    for (const G of conflictGroups(plan)) {
      G.fit = fitFor(G);
      if (!G.fit) throw new Error(`${planWords(B, plan)}. Choose: keep the layout without what doesn't fit, or lay ${G.floors.length > 1 || conflictGroups(plan).length > 1 ? 'those floors' : 'the floor'} out again`);
      if (G.fit === 'keep' && !G.keepOk) throw new Error(`${G.keepWhy}: lay it out again, or move its walls first`);
    }
    const remade = plan.groups.filter(G => G.regen || G.fit === 'regen');
    for (const G of remade) if ([...st.touched.keys()].some(k => k.startsWith(`i:${G.lv}:`) || k === `lw:${G.lv}` || k === `lm:${G.lv}`)) throw new Error('Change the size in a separate step from the furniture');
    this.touch(st, `bg:${B.idx}`);
    // every floor laid out again: the elevator goes where a new building of this size has it; else it follows its side
    const core = plan.sized && remade.length === plan.groups.length ? coreFor({ ...B, ...g }) : followCore(B, g);
    let fresh = null;
    const removed = [];
    for (const G of plan.groups) {
      const L = W.levels[G.lv]; if (!L) continue;
      if (G.regen || G.fit === 'regen') {
        fresh ||= freshLevels({ ...B, ...g, core });
        const want = G.regen && L.roll ? freshLevel({ ...B, ...g, core }, G.floors[0], L.roll) : fresh(G.floors[0]);   // a re-rolled floor keeps its roll
        if (!want) continue;
        this.touch(st, `lv:${G.lv}`);
        this.setLevel(L, { ...want, b: L.b ?? B.idx });
        continue;
      }
      if (!G.layout) continue;
      // what stands against a side that moves goes with it, what doesn't fit goes (each piece journaled)
      const keep = new Map(G.layout.items.map(it => [it.id, it]));
      for (let k = L.items.length - 1; k >= 0; k--) {
        const it = L.items[k], n = keep.get(it.id);
        if (!n) { this.touch(st, `i:${G.lv}:${it.id}`); L.items.splice(k, 1); continue; }
        if (n.x !== it.x || n.z !== it.z) { this.touch(st, `i:${G.lv}:${it.id}`); it.x = n.x; it.z = n.z; }
      }
      if (JSON.stringify(G.layout.walls) !== JSON.stringify(L.walls || [])) { this.touch(st, `lw:${G.lv}`); L.walls = G.layout.walls; }
      if (G.remove.length) removed.push(G);
    }
    if (core) B.core = core;
    Object.assign(B, g);
    if (out.base !== undefined) B.base = out.base;
    if (out.block !== undefined) B.block = out.block;
    if (this.rights) { const lot = this.rights.lotFor(spec); if (lot) B.lot = lot; else delete B.lot; }
    this.placed(B, st);
    const moved = spec.x !== was.x || spec.z !== was.z, sized = spec.w !== was.w || spec.d !== was.d, turned = spec.rot !== was.rot;
    const what = [moved && 'Moved', turned && (moved ? 'turned' : 'Turned'), sized && (moved || turned ? 'resized' : 'Resized')].filter(Boolean);
    const chose = remade.filter(G => G.fit === 'regen');
    let text = `${what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what.at(-1)}` : what[0]} ${B.name}`;
    if (chose.length) text += ` · laid out ${floorsName(B, chose.flatMap(G => G.floors))} again`;
    if (removed.length) text += ` · removed ${piecesWords(removed.flatMap(G => G.remove))}`;
    this.note(st, text, { b: B.idx });
    return { b: B.idx, remade: remade.flatMap(G => G.floors), removed: removed.reduce((n, G) => n + G.remove.length, 0) };
  }
  /** Writes a whole floor layout (a floor laid out again, or one coming back with undo); its id counter never goes back,
   *  so a piece placed later never takes the id of one the journal still knows. */
  setLevel(L, want) {
    const nid = Math.max(L.nid || 0, want.nid || 0, ...(want.items || []).map(i => (i.id || 0) + 1));
    for (const k of Object.keys(L)) delete L[k];
    Object.assign(L, structuredClone(want), { nid });
  }
  /** After a building's place changed: its floors are re-walked, its people step into the lobby, its access re-made. */
  placed(B, st) {
    for (let f = 0; f < B.floors; f++) st.ctx.add(ctxOf(B.idx, f));
    for (const lv of new Set(B.lv)) st.levels.add(lv);
    this.jumpInside(B, st, 0);
    st.blds.add(B.idx); st.blv.add(B.idx);
  }
  setGeom(b, want, st) {
    const B = this.world.buildings[b];
    if (!B || !want) return;
    Object.assign(B, { x: want.x, z: want.z, w: want.w, d: want.d, rot: want.rot });
    for (const k of ['base', 'block', 'lot', 'core']) { if (want[k] === null || want[k] === undefined) delete B[k]; else B[k] = structuredClone(want[k]); }
    if (!B.gone) this.placed(B, st);
  }
  // ------------------------------------------------------------------ residents
  personSet(o, st) {
    const i = o.i | 0, p = this.sim.people[i];
    if (!p) throw new Error('No such person');
    this.touch(st, `p:${i}`);
    const was = p.name, look = JSON.stringify(p.app);
    if (o.name !== undefined) { const n = sanitizeName(o.name); if (n) { p.name = n; p.renamed = 1; } }
    if (o.app) p.app = sanitizeAppearance(o.app, p.app);
    if (p.name !== was) this.note(st, `Renamed ${was} to ${p.name}`, { i });
    else if (JSON.stringify(p.app) !== look) this.note(st, `Changed ${p.name}'s look`, { i });
    if (o.home !== undefined || o.job !== undefined || o.hours !== undefined || o.sched !== undefined) this.personLife(i, p, o, st);
    st.people.add(p);
    return { i };
  }
  /** The resident editor (WP4.12): home (a building, or 'auto'), job ('free', 'auto' or a building), work hours and the
   *  daily routine. The bed or desk is a free one in the chosen building. */
  personLife(i, p, o, st) {
    if (p.vip && (o.job !== undefined || o.hours || o.sched || o.home?.u === undefined && o.home !== undefined)) throw new Error("An agent's resident keeps the work its agent gives it; its home can be a chosen flat");
    if (p.retired) throw new Error('That resident has left the world');
    const clock = h => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
    const W = this.world, idx = this.sim.index, hr = (v, lo, hi, what) => { const n = +v; if (!(n >= lo && n <= hi)) throw new Error(`${what} must be between ${clock(lo)} and ${clock(hi)}`); return Math.round(n * 100) / 100; };
    this.touch(st, `pl:${i}`);
    if (o.home !== undefined) {
      if (o.home === 'auto') p.home = null;   // a free home anywhere (given below)
      else if (o.home?.u !== undefined) {   // a chosen flat (tenants of a flat with a list of tenants join it)
        const B = this.bld(o.home.b), f = this.floorOf(B, o.home.f), u = o.home.u | 0, h = B.type === 'apartment' && W.levels[B.lv[f]]?.units?.[u] ? this.flatBed(B, f, u, i) : null;
        if (!h) throw new Error(`No free bed in flat ${u + 1} on ${floorsName(B, [f])}`);
        p.home = h;
        const key = `${B.idx}:${f}:${u}`, rec = W.flats?.[key];
        if (rec && (rec.deal !== 'own' || rec.tenants?.length) && !(rec.tenants || []).some(t => t.kind === 'person' && t.id === i)) { this.touch(st, `fl:${key}`); W.flats = { ...W.flats, [key]: { ...rec, tenants: [...(rec.tenants || []), { kind: 'person', id: i }] } }; st.flats = true; }
      }
      else { const b = o.home?.b ?? o.home, h = freeBed(W, idx, this.sim.people, b | 0, i); if (!h) throw new Error(`No free bed in ${W.buildings[b | 0]?.name || 'that building'}`); p.home = h; }
    }
    let hours = null;
    if (o.hours) { hours = { start: hr(o.hours.start, 0, 23, 'The start'), end: hr(o.hours.end, 1, 26, 'The end') }; if (!(hours.end > hours.start && hours.end - hours.start <= 14)) throw new Error('Work ends after it starts, at most 14 hours later'); }
    if (o.job !== undefined) {
      if (o.job === 'free') p.job = { kind: 'free', title: 'Free time' };
      else if (o.job === 'auto') p.job = { kind: 'free', title: 'Looking for work', seek: 1, prev: 'office' };
      else {
        const b = o.job?.b ?? o.job, w = freeWork(W, idx, this.sim.people, b | 0, i);
        if (!w) throw new Error(`No free work place in ${W.buildings[b | 0]?.name || 'that building'}`);
        const h = hours || { start: 9, end: 17 };
        p.job = { kind: w.kind, b: w.b, f: w.f, id: w.id, k: w.k, start: h.start, end: h.end, days: 0b0011111, title: w.title, ...(w.kind === 'staff' ? { venue: w.venue } : {}) };
      }
    } else if (hours && p.job && p.job.b !== undefined) { p.job.start = hours.start; p.job.end = hours.end; }
    if (o.sched) p.sched = { wake: hr(o.sched.wake, 4, 13, 'Waking'), lunch: hr(o.sched.lunch, 10.5, 15.5, 'Lunch'), bed: hr(o.sched.bed, 19, 27, 'Bedtime') };
    if (p.job?.start !== undefined && p.sched && p.sched.wake > p.job.start - 0.5) p.sched.wake = Math.max(4, Math.round((p.job.start - 1) * 100) / 100);
    st.replan.add(i);
    this.note(st, `Changed ${p.name}'s ${o.home !== undefined ? 'home' : o.job !== undefined ? 'work' : 'day'}`, { i });
  }
  /** Removing a resident (WP4.12): retired, never deleted (indices are shared by the sim, the pages and the files). */
  personDel(o, st) {
    const i = o.i | 0, p = this.sim.people[i];
    if (!p) throw new Error('No such person');
    if (p.vip || p.agentId) throw new Error("Remove the agent instead; its resident goes with it");
    if (p.retired) return { i };
    this.touch(st, `pl:${i}`);
    p.retired = 1; p.home = null; p.job = { kind: 'free', title: 'Moved away', retired: 1 };
    st.people.add(p); st.replan.add(i);
    this.note(st, `${p.name} moved away`, { i });
    return { i };
  }
  setPersonLife(i, want, st) {
    const p = this.sim.people[i];
    if (!p || !want) return;
    p.home = want.home ? structuredClone(want.home) : null; p.job = structuredClone(want.job); if (want.sched) p.sched = structuredClone(want.sched);
    if (want.retired) p.retired = 1; else delete p.retired;
    // the bed or desk it gets back may have gone to someone else since: then a free one (finish() re-homes and re-hires)
    const bed = h => h && h.bed && `${h.b}:${h.f}:${h.bed[0]}:${h.bed[1]}`, desk = j => j && j.id !== undefined && `${j.b}:${j.f}:${j.id}:${j.k}`;
    const hb = !p.retired && bed(p.home), jd = !p.retired && desk(p.job);
    if (hb || jd) this.sim.people.forEach((q, k) => {
      if (k === i || q.retired) return;
      if (hb && p.home && bed(q.home) === hb) p.home = null;
      if (jd && p.job.id !== undefined && desk(q.job) === jd) p.job = { kind: 'free', title: 'Between jobs', lost: 1, prev: p.job.kind };
    });
    st.people.add(p); st.replan.add(i);
  }
  personAdd(o, st) {
    if (this.sim.people.length >= 12000) throw new Error('Population limit reached');
    // (counting those added earlier in the same batch: each its own id, name and looks)
    const p = makeCitizen([...this.sim.people, ...st.added], { name: o.name, app: o.app }, Date.now() + st.added.length);
    st.added.push(p);
    st.logOnly.push(`Added a new resident, ${p.name}`);   // cannot be undone (DECISIONS C116)
    return { name: p.name };
  }
  /** Why the way from a building's door to its street or road would be blocked (shared/door-access.js), or null. */
  doorWhy(spec, ignoreIdx = -1) {
    const lots = this.rights?.active ? this.rights : null;
    return doorReason(this.world, spec, { net: this.ground()?.env.roads || null, lotAt: lots ? (x, z) => lots.lotAt(x, z) : null, lot: lots ? lots.lotFor(spec) : null, ignoreIdx });
  }
  /** The island's ground as browsers see it (roads graded in, building pads level) and its road network, for placing
   *  buildings beyond the city; cached until the island, its roads or the pads change. */
  ground() {
    const W = this.world, T = W.terrain; if (!T) return null;
    let base = this._groundBase;
    if (!base || base.of !== T || base.roads !== W.roads) { base = this._groundBase = { of: T, roads: W.roads, island: new Island(T, { roads: W.roads || null }) }; this._ground = null; }
    const pads = buildingPads(W), key = JSON.stringify(pads);
    if (this._ground?.key === key) return this._ground;
    const island = base.island.withPads(pads);
    const env = { heightAt: (x, z) => island.height(x, z), isWater: (x, z) => !!island.waterAt(x, z), waterAt: (x, z) => island.waterAt(x, z), coastWhy: (x, z) => protectedWhy(island, x, z, 0), roads: island.roads?.net || null };
    return (this._ground = { key, env, island });
  }
  // ------------------------------------------------------------------ terrain beyond the city (WP4.7)
  /** Why terrain stroke rec can't go into the world now, or null (a pond gets its water level). */
  terrainWhy(rec) {
    const G = this.ground(); if (!G) return 'This world has no land beyond the city';
    const pad = rec.r * 1.3 + 2, um = v => Math.round(v * 1e6);
    const lots = this.rights?.property ? this.rights.property.inBox({ x0: um(rec.x - pad), z0: um(rec.z - pad), x1: um(rec.x + pad), z1: um(rec.z + pad) }) : [];
    return terrainWhy(this.world, rec, { island: G.island, lots });
  }
  terrainAdd(o, st) {
    const T = this.world.terrain;
    if (!T) throw new Error('This world has no land beyond the city');
    const rec = normalizeEdit(o.edit || o);
    if (rec instanceof Error) throw rec;
    let n = 0; for (const e of T.edits || []) { const m = /^te-(\d+)$/.exec(e.id); if (m) n = Math.max(n, +m[1]); }
    rec.id = `te-${n + 1}`;
    const why = this.terrainWhy(rec);
    if (why) throw new Error(why);
    this.touch(st, `te:${rec.id}`);
    this.setTerrainEdit(rec.id, rec, st);
    this.note(st, `${EDIT_KINDS[rec.kind].label}${rec.kind === 'pond' ? ' dug' : ''} beyond the city`, { x: rec.x, z: rec.z });
    return { id: rec.id, level: rec.level ?? null };
  }
  terrainDel(o, st) {
    const id = String(o.id || ''), had = (this.world.terrain?.edits || []).find(e => e.id === id);
    if (!had) throw new Error('No such terrain change');
    this.touch(st, `te:${id}`);
    this.setTerrainEdit(id, null, st);
    this.note(st, `Took back a terrain change (${EDIT_KINDS[had.kind].label.toLowerCase()})`);
    return { id };
  }
  /** Puts stroke id in (want) or takes it out (null); strokes stay in the order they were first made. */
  setTerrainEdit(id, want, st) {
    const W = this.world, num = e => +(/^te-(\d+)$/.exec(e.id)?.[1] ?? 0);
    const rest = (W.terrain.edits || []).filter(e => e.id !== id);
    const edits = want ? [...rest, structuredClone(want)].sort((a, b) => num(a) - num(b)) : rest;
    W.terrain = { ...W.terrain, edits };   // a new object: everything keyed on the island rebuilds
    st.terrain = true;
  }
  // ------------------------------------------------------------------ decorations (WP4.7)
  /** Throws when decoration d can't stand there: the land's rules, then who may place it (a forbidden error). */
  decoCheck(d, ignoreId = null) {
    const W = this.world, G = this.ground();
    const why = checkDecor(d, { isWater: G ? G.env.isWater : null, roads: G ? G.env.roads : null, city: makeGrid(W.grid), buildings: W.buildings, decorations: W.decorations || [], modules: W.worldModules || [] }, ignoreId);
    if (why) throw new Error(why);
    const no = this.rights ? this.rights.decorWhy(d, this.actor) : null;
    if (no) throw Object.assign(new Error(no), { forbidden: true });
  }
  decoSet(o, st) {
    const W = this.world, list = W.decorations || [];
    const d = normalizeDecor(o.deco || o);
    if (d instanceof Error) throw d;
    let had = null;
    if (o.op === 'deco.move') {
      had = list.find(x => x.id === String(o.id || ''));
      if (!had) throw new Error('No such decoration');
      if (this.rights) { const why = this.rights.decorWhy(had, this.actor); if (why) throw Object.assign(new Error(why), { forbidden: true }); }
      d.id = had.id;
      if (isAdAsset(d.t) && had.hc && (o.deco || o).hc === undefined) d.hc = had.hc;   // its content goes with it
    } else {
      if (list.length >= DECOR_LIMITS.total) throw new Error('The world has as many decorations as it can keep');
      let n = 0; for (const x of list) { const m = /^d-(\d+)$/.exec(x.id); if (m) n = Math.max(n, +m[1]); }
      d.id = `d-${n + 1}`;
    }
    this.decoCheck(d, d.id);
    if (this.rights) { const lot = this.rights.decorLot(d); if (lot) { d.lot = lot; if (!had && list.filter(x => x.lot === lot).length >= DECOR_LIMITS.perLot) throw new Error(`Lot ${lot} has as many decorations as it can keep`); } }
    this.touch(st, `dc:${d.id}`);
    this.setDecor(d.id, d, st);
    const name = CATALOG[d.t]?.name || d.t;
    this.note(st, had ? `Moved a ${name.toLowerCase()}` : `Placed a ${name.toLowerCase()} outdoors`, { x: d.x, z: d.z });
    return { id: d.id };
  }
  decoDel(o, st) {
    const id = String(o.id || ''), had = (this.world.decorations || []).find(x => x.id === id);
    if (!had) throw new Error('No such decoration');
    if (this.rights) { const why = this.rights.decorWhy(had, this.actor, { removing: true }); if (why) throw Object.assign(new Error(why), { forbidden: true }); }
    this.touch(st, `dc:${id}`);
    this.setDecor(id, null, st);
    this.note(st, `Removed a ${(CATALOG[had.t]?.name || had.t).toLowerCase()}`);
    return { id };
  }
  /**
   * A module's own outdoor things (a dock's benches, picnic tables and trees: shared/world-modules.js moduleDecor) — the
   * world's own decorations, which people sit at — made with it, each marked with its id (mod), moved and removed with
   * it, in the same edit (one undo).
   */
  addModuleDecor(m, st) {
    const want = moduleDecor(m); if (!want.length) return;
    let n = 0; for (const x of this.world.decorations || []) { const k = /^d-(\d+)$/.exec(x.id); if (k) n = Math.max(n, +k[1]); }
    for (const d0 of want) {
      const d = normalizeDecor(d0); if (d instanceof Error) continue;
      d.id = `d-${++n}`; d.mod = m.id;
      this.touch(st, `dc:${d.id}`); this.setDecor(d.id, d, st);
    }
  }
  removeModuleDecor(m, st) {
    for (const d of (this.world.decorations || []).filter(x => x.mod === m.id)) { this.touch(st, `dc:${d.id}`); this.setDecor(d.id, null, st); }
  }
  setDecor(id, want, st) {
    const W = this.world, rest = (W.decorations || []).filter(x => x.id !== id);
    W.decorations = want ? [...rest, structuredClone(want)] : rest;
    st.decor = true;
  }
  // ------------------------------------------------------------------ coasts and the island chain (WP4.15)
  coastSet(o, st) {
    const T = this.world.terrain;
    if (!T) throw new Error('This world has no coast');
    const k = o.k | 0, cls = String(o.cls || '');
    if (o.island) {   // a stretch of an island of the chain
      const I = (T.islands || []).find(x => x.id === String(o.island));
      if (!I) throw new Error('No such island');
      if (k < 0 || k >= ISLE_SECTORS || !COAST_CLASSES[cls]) throw new Error('Bad coast');
      if (isleClasses(I, T)[k] === cls) return { k, island: I.id };
      this.touch(st, `co:${I.id}:${k}`);
      this.setIsleCoast(I.id, k, cls, st);
      this.note(st, `Made a stretch of ${I.name}'s coast a ${COAST_CLASSES[cls].label.toLowerCase()}`);
      return { k, island: I.id };
    }
    if (k < 0 || k >= SECTORS || !COAST_CLASSES[cls]) throw new Error('Bad coast');
    if (coastClasses(T)[k] === cls) return { k };
    this.touch(st, `co:${k}`);
    this.setCoast(k, cls, st);
    this.note(st, `Made a stretch of coast a ${COAST_CLASSES[cls].label.toLowerCase()}`);
    return { k };
  }
  setIsleCoast(id, k, cls, st) {
    const T = this.world.terrain;
    this.world.terrain = { ...T, islands: (T.islands || []).map(I => { if (I.id !== id) return I; const s = isleClasses(I, T); return { ...I, coasts: s.slice(0, k) + cls + s.slice(k + 1) }; }) };
    st.terrain = true;
  }
  setCoast(k, cls, st) {
    const T = this.world.terrain, s = coastClasses(T);
    this.world.terrain = { ...T, coasts: s.slice(0, k) + cls + s.slice(k + 1) };
    st.terrain = true;
  }
  /** The free slots for a new island now (the planner shows the same). */
  islandSlotsNow(template) {
    const G = this.ground();
    return islandSlots(this.world.terrain, template, { coastsWhy: (x, z, r) => (G ? protectedWhy(G.island, x, z, r) : null) });
  }
  islandAdd(o, st) {
    const T = this.world.terrain;
    if (!T) throw new Error('This world has no ocean to grow into');
    if (!TEMPLATES[o.template]) throw new Error('Pick a kind of island');
    const slot = this.islandSlotsNow(o.template)[o.k | 0];
    if (!slot) throw new Error('No such place for an island');
    if (!slot.free) throw new Error(slot.why);
    const seed = /^[a-z0-9-]{4,40}$/i.test(o.seed || '') ? o.seed : crypto.randomBytes(6).toString('hex');
    const rec = newIsland(T, slot, o.template, clean(o.name || '').slice(0, 40), seed);
    if ((T.islands || []).some(I => I.id === rec.id)) rec.id = `isl-${Date.now().toString(36)}`;
    this.touch(st, `is:${rec.id}`);
    this.setIsland(rec.id, rec, st);
    this.note(st, `Raised a new island, ${rec.name}`, { x: rec.center.x, z: rec.center.z });
    return { id: rec.id, name: rec.name, center: rec.center, radius: rec.radius };
  }
  islandDel(o, st) {
    const T = this.world.terrain, I = (T?.islands || []).find(x => x.id === String(o.id || ''));
    if (!I) throw new Error('No such island');
    const why = this.islandInUse(I);
    if (why) throw new Error(why);
    this.touch(st, `is:${I.id}`);
    this.setIsland(I.id, null, st);
    this.note(st, `Took away the island ${I.name}`);
    return { id: I.id };
  }
  /** Whether anything stands on island I (it can only be taken away empty). */
  islandInUse(I) {
    const W = this.world, on = (x, z) => Math.hypot(x - I.center.x, z - I.center.z) < I.radius * 1.5;
    if ((W.roads || []).some(r => r.pts.some(q => on(q.x / 1e6, q.z / 1e6)))) return `A road reaches ${I.name}; remove it first`;
    if ((W.ferries || []).some(f => [f.pts[0], f.pts.at(-1)].some(q => on(q.x, q.z)))) return `A ferry docks at ${I.name}; close it first`;
    if (W.buildings.some(B => B && !B.gone && on(B.x, B.z))) return `Buildings stand on ${I.name}; remove them first`;
    if (W.stations.some(s => on(s.x, s.z))) return `A station stands on ${I.name}; close it first`;
    if ((W.decorations || []).some(d => on(d.x, d.z))) return `Decorations stand on ${I.name}; remove them first`;
    if ((W.terrain.edits || []).some(e => on(e.x, e.z))) return `The land of ${I.name} was reshaped; take those changes back first`;
    const um = v => Math.round(v * 1e6), R = I.radius * 1.5;
    if (this.rights?.property?.inBox({ x0: um(I.center.x - R), z0: um(I.center.z - R), x1: um(I.center.x + R), z1: um(I.center.z + R) }).length) return `Lots are platted on ${I.name}; retire them first`;
    return null;
  }
  /** Puts island id into the chain (want) or takes it out (null); the chain keeps the order islands were raised in. */
  setIsland(id, want, st) {
    const T = this.world.terrain, rest = (T.islands || []).filter(I => I.id !== id);
    this.world.terrain = { ...T, islands: want ? [...rest, structuredClone(want)] : rest };
    st.terrain = true;
  }
  // ------------------------------------------------------------------ subway stations beyond the city (WP4.5)
  stationAdd(o, st) {
    const W = this.world, G = this.ground();
    if (!G) throw new Error('This world has no land beyond the city');
    const s = normalizeStation(o.station || o);
    if (s instanceof Error) throw s;
    const why = checkStation(W, s, G.env);
    if (why) throw new Error(why);
    let n = 0; for (const x of W.stations) { const m = /^s(\d+)$/.exec(x.id); if (m) n = Math.max(n, +m[1] + 1); }
    s.id = `s${n}`;
    s.y = Math.round(G.env.heightAt(s.x, s.z) * 100) / 100;
    if (!s.name) {   // named after its road
      const near = G.env.roads?.nearest(s.x, s.z, 120), base = (near && G.env.roads.get(near.id)?.name) || 'Country';
      let name = base, k = 2; while (W.stations.some(x => x.name === name)) name = `${base} ${k++}`;
      s.name = name;
    }
    this.touch(st, `sn:${s.id}`);
    this.setStation(s.id, s, st);
    this.note(st, `Opened ${s.name} station`, { x: s.x, z: s.z });
    return { id: s.id, name: s.name };
  }
  stationSet(o, st) {
    const s = this.world.stations.find(x => x.id === String(o.id || ''));
    if (!s) throw new Error('No such station');
    const next = structuredClone(s);
    if (o.name !== undefined) {
      const name = String(o.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 28);
      if (!name) throw new Error('Give the station a name');
      next.name = name;
    }
    if (o.ads !== undefined) { if (o.ads === false) next.ads = false; else delete next.ads; }   // its ad panel (Marketing)
    this.touch(st, `sn:${s.id}`);
    this.setStation(s.id, next, st);
    this.note(st, next.name !== s.name ? `Renamed ${s.name} station to ${next.name}` : `${next.ads === false ? 'Took down' : 'Put up'} the ad panel at ${s.name} station`);
    return { id: s.id };
  }
  stationDel(o, st) {
    const s = this.world.stations.find(x => x.id === String(o.id || ''));
    if (!s) throw new Error('No such station');
    if (Number.isInteger(s.block)) throw new Error("The city's stations are part of its plan");
    this.touch(st, `sn:${s.id}`);
    this.setStation(s.id, null, st);
    this.note(st, `Closed ${s.name} station`);
    return { id: s.id };
  }
  /** Stations keep their order (the city's first); a new or returning one goes to its place by id. */
  setStation(id, want, st) {
    const W = this.world, num = x => +(/^s(\d+)$/.exec(x.id)?.[1] ?? 1e9);
    const rest = W.stations.filter(x => x.id !== id);
    W.stations = want ? [...rest, structuredClone(want)].sort((a, b) => num(a) - num(b)) : rest;
    st.stations = true;
  }
  // ------------------------------------------------------------------ world modules (shared/world-modules.js): an airport
  /** The lots under a world polygon (land made into lots is never built over). */
  lotsUnder(pts) {
    const P = this.rights?.property; if (!P) return [];
    try { return P.under(pts.map(p => ({ x: Math.round(p.x * 1e6), z: Math.round(p.z * 1e6) }))); } catch { return []; }
  }
  /** A module's own building — an airport's terminal, a dock's store: a real building (shared/world-modules.js
   *  terminalSpec: people and residents go in), made with the module, moved and removed with it, in the same edit (one
   *  undo). */
  addTerminal(m, st) {
    const spec = terminalSpec(m); if (!spec) return null;
    const B = createBuilding(this.world, spec, Date.now());
    for (const lv of B.lv) st.levels.add(lv);
    st.newB.push(B.idx); st.blds.add(B.idx); st.blv.add(B.idx);
    st.touched.set(`bx:${B.idx}`, '0');
    return B.idx;
  }
  removeTerminal(m, st) {
    const B = Number.isInteger(m.terminal) ? this.world.buildings[m.terminal] : null;
    if (!B || B.gone || B.module !== m.id) return;
    this.touch(st, `bx:${B.idx}`);
    st.fp.set(B.idx, this.fingerprint(B.idx));
    this.removeBuilding(B, st);
  }
  /** The airport whose terminal B is, or null (a dock's store keeps its own sign). */
  airportOf(B) {
    if (!B || B.gone || B.type !== 'terminal' || !B.module) return null;
    const m = (this.world.worldModules || []).find(x => x.id === B.module);
    return m && m.terminal === B.idx && !WORLD_KINDS[m.kind]?.dock ? m : null;
  }
  /** One name for an airport (2026-10-14, the product owner: the terminal's name, its sign, the canopy and the entrance
   *  sign must be the same field): the terminal's name and sign and the module's name, in the same edit (one undo). */
  nameAirport(m, name, st) {
    const n = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 28);
    if (!n) return;
    const B = this.world.buildings[m.terminal];
    if (B) { this.touch(st, `bp:${B.idx}`); B.name = B.sign = n; st.blds.add(B.idx); }
    if (m.name !== n) { this.touch(st, `wm:${m.id}`); this.setWorldModule(m.id, { ...m, name: n }, st); }
  }
  /** Modules made before their buildings were real ones get them (once, at start; not an edit anyone undoes). */
  ensureTerminals() {
    const W = this.world, made = [], renamed = [];
    let modsRenamed = false;
    if (!this.ground()) return made;
    for (const m of [...(W.worldModules || [])]) {
      if (!hasBuilding(m) || !Number.isFinite(m.y)) continue;
      const B = Number.isInteger(m.terminal) ? W.buildings[m.terminal] : null;
      if (B && !B.gone && B.module === m.id) {
        // terminals named before one name was the rule: a sign renamed by hand (neither the airport's name nor the one its
        // terminal was given) names the whole airport — its canopy and entrance sign too; otherwise the airport's name
        // names the terminal
        if (this.airportOf(B)) {
          const auto = `${m.name || WORLD_KINDS[m.kind].label} Terminal`, s = typeof B.sign === 'string' ? B.sign.trim().slice(0, 28) : '';
          const hand = s && s !== m.name && s !== auto ? s : null, n = hand || String(m.name || '').slice(0, 28);
          if (hand) { W.worldModules = W.worldModules.map(x => (x.id === m.id ? { ...x, name: hand } : x)); modsRenamed = true; }
          if (n && (B.name !== n || B.sign !== n)) { B.name = B.sign = n; renamed.push(B); }
        }
        continue;
      }
      const spec = terminalSpec(m); if (!spec) continue;
      const nb = createBuilding(W, spec, Date.now());
      W.worldModules = W.worldModules.map(x => (x.id === m.id ? { ...x, terminal: nb.idx } : x));
      made.push(nb);
    }
    if (made.length) {
      W.version = (W.version || 1) + 1;
      const sim = this.sim; if (sim) { for (const b of made) for (const lv of b.lv) { sim.nav.invalidate(lv); sim.index.invalidate(lv); } sim.index.rebuild(); sim.nav.refreshAccess(); }
      this.app.save({ docs: '*', buildings: made.map(b => b.idx), levels: made.flatMap(b => b.lv) });
    }
    if (renamed.length || modsRenamed) { W.version = (W.version || 1) + 1; this.app.save({ ...(modsRenamed ? { docs: '*' } : {}), buildings: renamed.map(b => b.idx) }); }
    // buildings on a grid's land stand at its lots' level (2026-10-14: the lots flush with the sidewalks; those built
    // before stood on the old, lower ground)
    const rebased = [];
    for (const B of W.buildings || []) {
      if (!B || B.gone || B.base === undefined || B.module) continue;
      const want = baseFor(null, B, W), P = gridPadAt(W, B.x, B.z);
      if (P && Math.abs(B.base - want) > 0.005) { B.base = want; rebased.push(B); }
    }
    if (rebased.length) {
      W.version = (W.version || 1) + 1;
      const sim = this.sim; if (sim) { for (const b of rebased) for (const lv of b.lv) { sim.nav.invalidate(lv); sim.index.invalidate(lv); } sim.index.rebuild(); sim.nav.refreshAccess(); }
      this.app.save({ buildings: rebased.map(b => b.idx), levels: rebased.flatMap(b => b.lv) });
    }
    return made.map(b => b.name);
  }
  /** A module's level, on the ground as it is without that module's own pad. */
  levelWithout(m, id) {
    const W = this.world, all = W.worldModules;
    W.worldModules = (all || []).filter(x => x.id !== id);
    try { return levelFor(this.ground().env.heightAt, m); } finally { W.worldModules = all; }
  }
  /** Where a module's access road meets it, the level the module must stand at for its paving to meet the road's top
   *  flush (2026-10-14, the product owner: "the airport roadway doesn't connect properly to the road, at any angle" — a road laid again,
   *  or meeting it lower than the land it had been levelled to, started up to 30 cm below the airport's ground: buried,
   *  grass between the airport and its road). null without an access road. */
  roadLevel(m) {
    const R = this.ground()?.island.roads; if (!R) return null;
    const e = roadEndOf(m);
    for (const r of accessRoadsOf(this.world, m)) {
      const prof = R.prof.get(r.id), G = R.net.geometry(r.id); if (!prof || !G) continue;
      const first = Math.hypot(r.pts[0].x / 1e6 - e.x, r.pts[0].z / 1e6 - e.z) < 3;
      return clampLevel(m, Math.round((profileAt(prof, first ? 0 : G.length) + DRAW_LIFT + 0.035) * 100) / 100);   // (its paving's top is 3.5 cm under the module's level; a dock's stays near its water)
    }
    return null;
  }
  /** Each module whose level is off its access road's by 2 cm or more levelled to meet it (its terminal with it). */
  levelToRoads(st) {
    const out = [];
    for (const m of [...(this.world.worldModules || [])]) {
      if (!Number.isFinite(m.y)) continue;
      const y = this.roadLevel(m); if (y === null || Math.abs(y - m.y) < 0.02) continue;
      this.touch(st, `wm:${m.id}`);
      const next = { ...m, y };
      if (hasBuilding(m)) { this.removeTerminal(m, st); next.terminal = this.addTerminal(next, st); }
      this.setWorldModule(m.id, next, st);
      out.push(`${m.name} ${m.y} → ${y}`);
    }
    return out;
  }
  /** Whether a module's own decorations are as its layout has them (each of them there, turned that way). */
  decorAsLaid(m) {
    const want = moduleDecor(m), have = (this.world.decorations || []).filter(d => d.mod === m.id);
    if (want.length !== have.length) return false;
    const turn = (a, b) => Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) < 0.01;
    return want.every(w => have.some(d => d.t === w.t && Math.abs(d.x - w.x) < 0.05 && Math.abs(d.z - w.z) < 0.05 && turn(d.r || 0, w.r || 0)));
  }
  /** At start: docks placed before their benches and trees were the world's own get them, and ones laid out an older way
   *  are laid again (an edit of the system's). → names */
  ensureModuleDecor() {
    const W = this.world, need = (W.worldModules || []).filter(m => moduleDecor(m).length && !this.decorAsLaid(m));
    if (!need.length || !this.ground()) return [];
    const r = this.apply([{ op: 'wmod.decor' }], 'system', { journal: false });
    return r.ok ? need.map(m => m.name) : [];
  }
  /** At start: modules off their access roads' level levelled to them (an edit of the system's, not undone by anyone). */
  levelModulesToRoads() {
    if (!(this.world.worldModules || []).length || !this.ground()) return [];
    let out = [];
    const r = this.apply([{ op: 'wmod.level' }], 'system', { journal: false });
    if (r.ok) out = r.results[0]?.levelled || [];
    return out;
  }
  /** World modules placed under an older layout, levelled again (once, at start): [names]. */
  relevelModules() {
    const W = this.world, out = [];
    for (const m of W.worldModules || []) {
      if ((m.v || 1) >= LAYOUT_V || !this.ground()) continue;
      const y = this.levelWithout(m, m.id);
      W.worldModules = W.worldModules.map(x => (x.id === m.id ? { ...x, y, v: LAYOUT_V } : x));
      out.push(`${m.name} ${m.y} → ${y}`);
    }
    if (out.length) { W.version = (W.version || 1) + 1; this.app.save({ docs: '*' }); }
    return out;
  }
  wmodWhy(m, ignoreId = null) {
    const G = this.ground(); if (!G) return 'This world has no land beyond the city';
    return checkWorldModule(this.world, m, G.env, { ignoreId, lotsUnder: pts => this.lotsUnder(pts) });
  }
  wmodAdd(o, st) {
    const W = this.world, G = this.ground();
    if (!G) throw new Error('This world has no land beyond the city');
    const m = normalizeWorldModule(o.module || o);
    if (m instanceof Error) throw m;
    const why = this.wmodWhy(m);
    if (why) throw new Error(why);
    const list = W.worldModules || [];
    let n = 0; for (const x of list) { const k = /^wm(\d+)$/.exec(x.id); if (k) n = Math.max(n, +k[1] + 1); }
    m.id = `wm${n}`;
    if (WORLD_KINDS[m.kind].dock) { const r = dockWhy(m, G.env); m.wy = Math.round(r.level * 100) / 100; if (r.lake) m.lake = r.lake; }   // a dock: its water's level (its land a little above it)
    m.y = levelFor(G.env.heightAt, m); m.v = LAYOUT_V;
    if (!m.name) {   // named after the road it is joined to
      const e = roadEndOf(m), near = G.env.roads?.nearest(e.x, e.z, 2000), label = WORLD_KINDS[m.kind].label;
      const rn = (near && G.env.roads.get(near.id)?.name?.replace(/\s+(Road|Rd|Lane|Way|Avenue|Street)$/i, '')) || 'Island';
      const base = new RegExp(`\\b${label}$`, 'i').test(rn) ? rn : label === 'Lake Dock' && /\blake\b/i.test(rn) ? `${rn} Dock` : `${rn} ${label}`;   // (by "Airport Road": "Airport", not "Airport Airport"; by "Lake 2 Road": "Lake 2 Dock")
      let name = base, k = 2; while (list.some(x => x.name === name)) name = `${base} ${k++}`;
      m.name = name;
    }
    this.touch(st, `wm:${m.id}`);
    if (hasBuilding(m)) m.terminal = this.addTerminal(m, st);
    this.setWorldModule(m.id, m, st);
    this.addModuleDecor(m, st);
    this.note(st, `Opened ${m.name}`, { x: m.x, z: m.z });
    return { id: m.id, name: m.name, y: m.y };
  }
  wmodSet(o, st) {
    const W = this.world, cur = (W.worldModules || []).find(x => x.id === String(o.id || ''));
    if (!cur) throw new Error('No such world module');
    const next = structuredClone(cur);
    if (o.name !== undefined) {
      const name = String(o.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, WORLD_KINDS[cur.kind].dock ? 40 : 28);   // an airport's name is its terminal's sign too
      if (!name) throw new Error('Give it a name');
      next.name = name;
    }
    const moved = ['x', 'z', 'rot'].some(k => o[k] !== undefined);
    if (moved) {
      const m = normalizeWorldModule({ kind: cur.kind, name: next.name, x: o.x ?? cur.x, z: o.z ?? cur.z, rot: o.rot ?? cur.rot });
      if (m instanceof Error) throw m;
      Object.assign(next, { x: m.x, z: m.z, rot: m.rot });
      const why = this.wmodWhy(next, cur.id);
      if (why) throw new Error(why);
      if (WORLD_KINDS[cur.kind].dock) { const r = dockWhy(next, this.ground().env); next.wy = Math.round(r.level * 100) / 100; if (r.lake) next.lake = r.lake; else delete next.lake; }
      next.y = this.levelWithout(next, cur.id); next.v = LAYOUT_V;
    }
    if (moved && hasBuilding(cur)) { this.removeTerminal(cur, st); next.terminal = this.addTerminal(next, st); }   // its building moves with it
    else if (next.name !== cur.name && this.airportOf(this.world.buildings[cur.terminal])) {   // the terminal takes the airport's new name
      const B = this.world.buildings[cur.terminal]; this.touch(st, `bp:${B.idx}`); B.name = B.sign = next.name; st.blds.add(B.idx);
    }
    this.touch(st, `wm:${cur.id}`);
    this.setWorldModule(cur.id, next, st);
    if (moved) { this.removeModuleDecor(cur, st); this.addModuleDecor(next, st); }   // (its benches and trees go with it)
    this.note(st, moved ? `Moved ${next.name}` : `Renamed ${cur.name} to ${next.name}`, moved ? { x: next.x, z: next.z } : null);
    return { id: cur.id };
  }
  wmodDel(o, st) {
    const cur = (this.world.worldModules || []).find(x => x.id === String(o.id || ''));
    if (!cur) throw new Error('No such world module');
    this.touch(st, `wm:${cur.id}`);
    this.removeTerminal(cur, st);
    this.removeModuleDecor(cur, st);
    this.setWorldModule(cur.id, null, st);
    this.note(st, `Closed ${cur.name}`);
    return { id: cur.id };
  }
  /** World modules keep their order by id. */
  setWorldModule(id, want, st) {
    const num = x => +(/^wm(\d+)$/.exec(x.id)?.[1] ?? 1e9), rest = (this.world.worldModules || []).filter(x => x.id !== id);
    this.world.worldModules = want ? [...rest, structuredClone(want)].sort((a, b) => num(a) - num(b)) : rest;
    st.wmods = true;
  }
  // ------------------------------------------------------------------ ferries (WP4.15, shared/ferries.js)
  /** Why ferry line rec can't run, or null. */
  ferryWhy(rec) {
    const W = this.world, island = this.bareIsland(); if (!island) return 'Ferries need water beyond the city';
    const g = makeGrid(W.grid), um = v => Math.round(v * 1e6), pad = 120;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of [rec.pts[0], rec.pts.at(-1)]) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
    const lots = this.rights?.property ? this.rights.property.inBox({ x0: um(x0 - pad), z0: um(z0 - pad), x1: um(x1 + pad), z1: um(z1 + pad) }) : [];
    return ferryWhy(rec, { island, roads: this.ground()?.env.roads || null, city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, buildings: W.buildings, lots });
  }
  ferrySet(o, st) {
    const W = this.world, input = { ...(o.ferry || o) };
    const had = input.id ? (W.ferries || []).find(f => f.id === input.id) : null;
    if (input.id && !had) throw new Error('No such ferry line');
    if (!input.id) input.id = nextFerryId(W.ferries);
    const rec = normalizeFerry(input);
    if (rec instanceof Error) throw rec;
    const why = this.ferryWhy(rec);
    if (why) throw new Error(why);
    this.touch(st, `fy:${rec.id}`);
    this.setFerry(rec.id, rec, st);
    this.note(st, `${had ? 'Changed' : 'Opened'} the ${rec.name} ferry`, { x: rec.pts[0].x, z: rec.pts[0].z });
    return { id: rec.id };
  }
  ferryDel(o, st) {
    const f = (this.world.ferries || []).find(x => x.id === String(o.id || ''));
    if (!f) throw new Error('No such ferry line');
    this.touch(st, `fy:${f.id}`);
    this.setFerry(f.id, null, st);
    this.note(st, `Closed the ${f.name} ferry`);
    return { id: f.id };
  }
  setFerry(id, want, st) {
    const W = this.world, num = f => +(/^fy-(\d+)$/.exec(f.id)?.[1] ?? 1e9), rest = (W.ferries || []).filter(f => f.id !== id);
    W.ferries = want ? [...rest, structuredClone(want)].sort((a, b) => num(a) - num(b)) : rest;
    st.ferries = true;
  }
  // ------------------------------------------------------------------ roads beyond the city (WP4.4)
  /** The island without its roads (water depth before any causeway), cached per island. */
  bareIsland() {
    const T = this.world.terrain; if (!T) return null;
    if (this._bare?.of !== T) this._bare = { of: T, island: new Island(T) };
    return this._bare.island;
  }
  /** Why road record `rec` can't go into the world, or null. */
  roadWhy(rec) {
    const G = alignmentGeometry(rec), pad = 30, b = G.bbox, um = v => Math.round(v * 1e6);
    const lots = this.rights?.property ? this.rights.property.inBox({ x0: um(b.x0 - pad), z0: um(b.z0 - pad), x1: um(b.x1 + pad), z1: um(b.z1 + pad) }) : [];
    const probs = roadProblems(this.world, rec, { island: this.bareIsland(), lots });
    return probs.length ? probs.slice(0, 3).join('; ') : null;
  }
  /**
   * Why road `id` can't become `rec` (null: removed), or null: lots made beside it front it (their frontage, from the Lots
   * tool), and a lot left without its road leaves whatever stands on it unconnected (2026-10-09: "lots should connect to
   * roadways … flawlessly"). The road may change while it still runs along their fronts.
   */
  frontWhy(id, rec) {
    const P = this.rights?.property; if (!P) return null;
    const fronting = P.all().filter(l => (l.frontage || []).some(f => f.road === id));
    if (!fronting.length) return null;
    const list = ls => `${ls.slice(0, 4).map(l => l.id).join(', ')}${ls.length > 4 ? ` and ${ls.length - 4} more` : ''}`;
    if (!rec) return `${fronting.length === 1 ? `lot ${fronting[0].id} fronts it` : `${fronting.length} lots front it (${list(fronting)})`}: retire ${fronting.length === 1 ? 'that lot' : 'those lots'} first, or keep the road`;
    let G; try { G = alignmentGeometry(rec); } catch { return null; }
    const half = (DEFAULT_ROAD_PROFILES[rec.profile]?.outerHalf ?? 0) / 1e6;
    const cut = fronting.filter(l => Math.min(...l.poly.map(q => project(G, q.x / 1e6, q.z / 1e6)?.dist ?? Infinity)) > half + 6);
    return cut.length ? `it would leave ${cut.length === 1 ? `lot ${cut[0].id}, which fronts it,` : `${cut.length} lots that front it (${list(cut)})`} without the road: keep it beside them, or retire them first` : null;
  }
  roadSet(o, st) {
    const W = this.world, input = { ...(o.road || {}) };
    if (!input.id) input.id = nextRoadId(W.roads);
    { const was = (W.roads || []).find(r => r.id === input.id); if (was && input.level === undefined && Number.isFinite(was.level)) { input.level = was.level; if (was.grid && input.grid === undefined) input.grid = was.grid; } }   // a grid road stays flat when its points move
    const raw = normalizeRoad(input);
    if (raw instanceof Error) throw raw;
    const rec = joinCityEdge(W.grid, raw);   // an end just short of a city edge junction joins it
    let why; try { why = this.roadWhy(rec); } catch (e) { why = e.message; }
    if (why) throw new Error(why);
    const had = (W.roads || []).find(r => r.id === rec.id);
    const cut = had ? this.frontWhy(rec.id, rec) : null;
    if (cut) throw new Error(`${had.name || 'The road'}: ${cut}`);
    this.touch(st, `r:${rec.id}`);
    W.roads = had ? W.roads.map(r => (r.id === rec.id ? rec : r)) : [...(W.roads || []), rec];
    st.roads.add(rec.id);
    this.note(st, `${had ? 'Changed' : 'Built'} ${rec.name || 'a road'}`);
    return { id: rec.id };
  }
  roadDel(o, st) {
    const W = this.world, id = String(o.id || ''), had = (W.roads || []).find(r => r.id === id);
    if (!had) throw new Error('No such road');
    const cut = this.frontWhy(id, null);
    if (cut) throw new Error(`${had.name || 'The road'} can't go: ${cut}`);
    this.touch(st, `r:${id}`);
    W.roads = W.roads.filter(r => r.id !== id);
    st.roads.add(id);
    this.note(st, `Removed ${had.name || 'a road'}`);
    return { id };
  }
  setRoad(id, want, st) {
    const W = this.world, rest = (W.roads || []).filter(r => r.id !== id);
    W.roads = want ? [...rest, structuredClone(want)] : rest;
    st.roads.add(id);
  }
  // ------------------------------------------------------------------ states (the journal)
  /** The current state behind a state key (see the top of this file). */
  stateOf(key) {
    const [t, a, c] = String(key).split(':'), W = this.world;
    if (t === 'bp') {
      const B = W.buildings[+a];
      return B ? { name: B.name, sign: B.sign ?? null, style: B.style ?? null, roofKind: B.roofKind ?? null, colors: { ...(B.colors || {}) }, ...(B.roofSigns ? { roofSigns: structuredClone(B.roofSigns) } : {}) } : null;
    }
    if (t === 'bx') { const B = W.buildings[+a]; return B && !B.gone ? 1 : 0; }
    if (t === 'bg') { const B = W.buildings[+a]; return B ? { x: B.x, z: B.z, w: B.w, d: B.d, rot: B.rot || 0, base: B.base ?? null, block: B.block ?? null, lot: B.lot ?? null, core: B.core ?? null } : null; }
    if (t === 'bf') {
      const B = W.buildings[+a];
      return B ? { floors: B.floors, core: B.core ?? null, lv: [...B.lv], h: B.lv.map(l => this.floorHash(l)) } : null;
    }
    if (t === 'i') { const L = W.levels[+a], it = L ? L.items.find(x => x.id === +c) : null; return it ? { ...it } : null; }
    if (t === 'p') { const p = this.sim.people[+a]; return p ? { name: p.name, renamed: p.renamed ? 1 : 0, app: p.app ?? null } : null; }
    if (t === 'pl') { const p = this.sim.people[+a]; return p ? { home: p.home ?? null, job: p.job ?? null, sched: p.sched ?? null, retired: p.retired ? 1 : 0 } : null; }
    if (t === 'r') { const r = (W.roads || []).find(x => x.id === key.slice(2)); return r ? structuredClone(r) : null; }
    if (t === 'te') { const e = (W.terrain?.edits || []).find(x => x.id === key.slice(3)); return e ? structuredClone(e) : null; }
    if (t === 'dc') { const d = (W.decorations || []).find(x => x.id === key.slice(3)); return d ? structuredClone(d) : null; }
    if (t === 'sn') { const s = (W.stations || []).find(x => x.id === key.slice(3)); return s ? structuredClone(s) : null; }
    if (t === 'fy') { const f = (W.ferries || []).find(x => x.id === key.slice(3)); return f ? structuredClone(f) : null; }
    if (t === 'wm') { const m = (W.worldModules || []).find(x => x.id === key.slice(3)); return m ? structuredClone(m) : null; }
    if (t === 'lw') { const L = W.levels[+a]; return L ? structuredClone(L.walls || []) : null; }
    if (t === 'lv') { const L = W.levels[+a]; if (!L) return null; const { nid, ...rest } = L; void nid; return structuredClone(rest); }   // the id counter only grows
    if (t === 'lm') { const L = W.levels[+a]; return L ? levelMode(L) : null; }
    if (t === 'fl') { const r = W.flats?.[key.slice(3)]; return r ? structuredClone(r) : null; }
    if (t === 'fp') { const B = W.buildings[+a]; return B?.flatPlans ? structuredClone(B.flatPlans) : null; }
    if (t === 'co') { if (!W.terrain) return null; if (c === undefined) return coastClasses(W.terrain)[+a]; const I = (W.terrain.islands || []).find(x => x.id === a); return I ? isleClasses(I, W.terrain)[+c] : null; }
    if (t === 'is') { const I = (W.terrain?.islands || []).find(x => x.id === key.slice(3)); return I ? structuredClone(I) : null; }
    throw new Error(`Unknown state key ${key}`);
  }
  touch(st, key) { if (!st.touched.has(key)) st.touched.set(key, canon(this.stateOf(key))); }
  /** A hash of one floor layout's furniture, the same however the items are ordered. */
  floorHash(lv) {
    const L = this.world.levels[lv];
    return L ? sha(canon([...L.items].sort((x, y) => (x.id || 0) - (y.id || 0)))) : null;
  }
  /** A hash of everything a building holds: its properties, floors and every floor's furniture. */
  fingerprint(b) {
    const B = this.world.buildings[b];
    return B ? sha(canon({ p: this.stateOf(`bp:${b}`), floors: B.floors, core: B.core ?? null, h: B.lv.map(l => this.floorHash(l)) })) : null;
  }
  /** The building a floor layout belongs to (copies made for a single floor keep their building). */
  levelOwner(lv) {
    const W = this.world, L = W.levels[lv];
    if (L && Number.isInteger(L.b) && W.buildings[L.b]) return L.b;
    const B = W.buildings.find(x => x && x.lv.includes(lv));
    return B ? B.idx : -1;
  }
  levelsOf(b) { return [...new Set(this.world.buildings[b]?.lv || [])]; }
  standing(b) { const B = this.world.buildings[b]; return !!(B && !B.gone); }
  /** Whether a floor layout is in use by a standing building (so its furniture can be seen and edited). */
  levelInUse(lv) { const b = this.levelOwner(lv), B = this.world.buildings[b]; return !!(B && !B.gone && B.lv.includes(lv)); }
  /** Whether key's current state is the state an entry left (want). Floors compare the count, the core and the
   *  furniture of the floors a restore would change (changed): their layouts may have been copied since for a
   *  single-floor edit, which changes nothing anyone sees. */
  same(key, want, changed = null) {
    const cur = this.stateOf(key);
    if (key.startsWith('bf:') && cur && want) {
      if (cur.floors !== want.floors || canon(cur.core) !== canon(want.core)) return false;
      for (const f of changed || []) if ((cur.h[f] ?? null) !== (want.h?.[f] ?? null)) return false;
      return true;
    }
    return canon(cur) === canon(want);
  }
  /** The journal entry of a finished batch: the states before and after of every key it changed. */
  entryOf(st) {
    const keys = [], before = {}, after = {};
    for (const [k, b] of st.touched) {
      const a = canon(this.stateOf(k));
      if (a !== b) { keys.push(k); before[k] = JSON.parse(b); after[k] = JSON.parse(a); }
    }
    if (!keys.length && !st.logOnly.length) return null;
    // A restore that removes a building needs everything inside it unchanged since (DECISIONS C116).
    const watch = {};
    for (const k of keys) {
      if (!k.startsWith('bx:')) continue;
      const b = k.slice(3);
      if (after[k] === 1) (watch.undo ||= {})[b] = this.fingerprint(+b);              // undoing a new building removes it
      else if (st.fp.has(+b)) (watch.redo ||= {})[b] = st.fp.get(+b);                 // redoing a demolition removes it again
    }
    const texts = [...st.summary, ...st.logOnly];
    const summary = texts.length > 1 ? `${texts[0]} and ${texts.length - 1} more change${texts.length > 2 ? 's' : ''}` : texts[0] || 'Changed the world';
    return { keys, before, after, watch, summary, place: st.place, undoable: keys.length > 0 };
  }
  /**
   * Writes journaled states back (undo, redo, revert) once the journal has checked nobody changed them since. A building
   * that comes back needs its lot free, and furniture that comes back must not overlap anything placed since or block a
   * floor; then nothing changes and the reason is returned. Restores never bring newcomers (DECISIONS C116).
   * floors: for each bf key's building, the floors whose layout the restore changes.
   */
  restore(states, { floors = {} } = {}, who = '') {
    const W = this.world, st = this.newState(), keys = Object.keys(states);
    for (const k of keys) {
      if (!k.startsWith('bx:') || states[k] !== 1) continue;
      const B = W.buildings[+k.slice(3)];
      if (B && B.gone && !B.module) { const why = B.base !== undefined ? (this.ground() ? checkIslandBuilding(W, B, this.ground().env, B.idx) : null) : checkBuilding(W, B, B.idx); if (why) return { ok: false, error: `${B.name} cannot come back: ${lowerFirst(why)}` }; }
    }
    for (const k of keys) {
      if (!k.startsWith('bg:') || !states[k]) continue;   // a building going back to where it stood must still fit there
      const B = W.buildings[+k.slice(3)], want = states[k];
      if (!B || B.gone) continue;
      const spec = { type: B.type, floors: B.floors, style: B.style, x: want.x, z: want.z, w: want.w, d: want.d, rot: want.rot };
      const why = this.placeWhy(B, spec, {}, { interior: false });   // the furniture coming back with it is checked below
      if (why) return { ok: false, error: `${B.name} cannot go back: ${lowerFirst(why)}` };
    }
    for (const k of keys) {
      if (!k.startsWith('r:')) continue;
      // a road going back: it must still fit, and never leave lots made beside it since without it
      const cut = this.frontWhy(k.slice(2), states[k] || null), name = states[k]?.name || (W.roads || []).find(r => r.id === k.slice(2))?.name || 'The road';
      if (cut) return { ok: false, error: `${name} cannot change back: ${cut}` };
      if (!states[k]) continue;
      let why; try { why = this.roadWhy(states[k]); } catch (e) { why = e.message; }
      if (why) return { ok: false, error: `${states[k].name || 'The road'} cannot come back: ${lowerFirst(why)}` };
    }
    for (const k of keys) {
      if (!k.startsWith('te:') || !states[k] || this.stateOf(k)) continue;   // a stroke coming back must still fit
      const why = this.terrainWhy(structuredClone(states[k]));
      if (why) return { ok: false, error: `That terrain change cannot come back: ${lowerFirst(why)}` };
    }
    for (const k of keys) {
      const want = states[k];
      if (k.startsWith('is:') && want && !this.stateOf(k)) {   // an island coming back: its place must still be open water
        const T = W.terrain, G = this.ground();
        for (const I of T.islands || []) if (Math.hypot(I.center.x - want.center.x, I.center.z - want.center.z) < I.radius + want.radius + ISLAND_GAP) return { ok: false, error: `${want.name} cannot come back: ${I.name} is there now` };
        const why = G ? protectedWhy(G.island, want.center.x, want.center.z, want.radius * 1.3) : null;
        if (why) return { ok: false, error: `${want.name} cannot come back: ${lowerFirst(why)}` };
      }
      if (k.startsWith('is:') && !want) { const I = this.stateOf(k); const why = I ? this.islandInUse(I) : null; if (why) return { ok: false, error: why }; }
    }
    for (const k of keys) {
      if (!k.startsWith('fy:') || !states[k]) continue;   // a ferry line coming back or changing back must still run
      const why = this.ferryWhy(states[k]);
      if (why) return { ok: false, error: `The ${states[k].name} ferry cannot come back: ${lowerFirst(why)}` };
    }
    for (const k of keys) {
      if (!k.startsWith('wm:') || !states[k]) continue;   // a world module coming back or moving back must still fit
      const why = this.wmodWhy(states[k], k.slice(3));
      if (why) return { ok: false, error: `${states[k].name} cannot come back: ${lowerFirst(why)}` };
    }
    for (const k of keys) {
      if (!k.startsWith('sn:') || !states[k] || this.stateOf(k)) continue;   // a station coming back must still fit
      const G = this.ground(), why = G ? checkStation(W, states[k], G.env, k.slice(3)) : null;
      if (why) return { ok: false, error: `${states[k].name} station cannot come back: ${lowerFirst(why)}` };
    }
    for (const k of keys) {
      if (!k.startsWith('dc:') || !states[k]) continue;   // a decoration coming back or moving must still fit
      const why = checkDecor(states[k], { isWater: this.ground()?.env.isWater, roads: this.ground()?.env.roads, city: makeGrid(W.grid), buildings: W.buildings, decorations: W.decorations || [], modules: W.worldModules || [] }, k.slice(3));
      if (why) return { ok: false, error: `That ${(CATALOG[states[k].t]?.name || 'decoration').toLowerCase()} cannot come back: ${lowerFirst(why)}` };
    }
    // Where buildings stand and their inner walls go back first (furniture is checked inside them), then the furniture,
    // so a floor that would be blocked rolls all of these back before anything else changed.
    const undoItems = [], check = new Map(), undoPre = [];
    for (const k of keys) {
      const [t, a] = k.split(':'), want = states[k];
      if (t === 'bg') { const B = W.buildings[+a]; if (!B || !want) continue; const was = structuredClone(this.stateOf(k)); undoPre.push(() => this.setGeom(+a, was, st)); this.setGeom(+a, want, st); }
      else if (t === 'lw') { const L = W.levels[+a]; if (!L || !want) continue; const was = structuredClone(L.walls || []); undoPre.push(() => { L.walls = was; }); L.walls = structuredClone(want); st.levels.add(+a); for (const B of W.buildings) if (B && B.lv) B.lv.forEach((x, f) => { if (x === +a) st.ctx.add(ctxOf(B.idx, f)); }); }
      else if (t === 'lv') { const L = W.levels[+a]; if (!L || !want) continue; const was = structuredClone(L); undoPre.push(() => this.setLevel(L, was)); this.setLevel(L, want); st.levels.add(+a); for (const B of W.buildings) if (B && B.lv) B.lv.forEach((x, f) => { if (x === +a) st.ctx.add(ctxOf(B.idx, f)); }); }
    }
    const rollback = () => { for (const [L, id, prev] of undoItems.reverse()) this.setItem(L, id, prev); for (const u of undoPre.reverse()) u(); };
    // every piece goes back first, then each one coming back is checked against the floor as it will be (pieces a
    // resize moved and removed come back together: checked one by one, they would bump into each other halfway)
    const back = [];
    for (const k of keys) {
      if (!k.startsWith('i:')) continue;
      const [, a, c] = k.split(':'), lv = +a, id = +c, L = W.levels[lv], want = states[k];
      const B = L ? W.buildings[this.levelOwner(lv)] : null;
      if (!L || !B) { rollback(); return { ok: false, error: 'That floor is gone' }; }
      const prev = L.items.find(x => x.id === id);
      undoItems.push([L, id, prev ? { ...prev } : null]);
      this.setItem(L, id, want);
      if (want) back.push([B, lv, L, id]);
      st.levels.add(lv);
      this.softTouch(st, B, lv, prev ? { ...prev } : null, want ? L.items.find(x => x.id === id) || null : null);
      B.lv.forEach((x, f) => { if (x === lv) check.set(`${B.idx}:${f}`, [B, f, L]); });
    }
    for (const [B, lv, L, id] of back) {
      const it = L.items.find(x => x.id === id), why = it ? checkItem(B, Math.max(0, B.lv.indexOf(lv)), L, it, id) : null;
      if (why && why.startsWith('Overlaps the ')) { rollback(); return { ok: false, error: `${lowerFirst(why)}, placed there since` }; }
    }
    for (const [B, f, L] of check.values()) if (!levelConnected(B, f, L)) { rollback(); return { ok: false, error: 'that would block the way through' }; }
    for (const k of keys) {
      const [t, a, c] = k.split(':'), want = states[k];
      if (t === 'bp') this.setProps(+a, want, st);
      else if (t === 'p') this.setPerson(+a, want, st);
      else if (t === 'pl') this.setPersonLife(+a, want, st);
      else if (t === 'lm') { const L = W.levels[+a]; if (L && want) { this.setMode(L, want); st.levels.add(+a); } }
      else if (t === 'fp') { const B = W.buildings[+a]; if (B) { if (want) B.flatPlans = structuredClone(want); else delete B.flatPlans; st.blds.add(+a); } }
      else if (t === 'fl') { const fk = k.slice(3), next = { ...(W.flats || {}) }; if (want) next[fk] = structuredClone(want); else delete next[fk]; W.flats = next; st.flats = true; }
      else if (t === 'bf') this.setFloors(+a, want, floors[a] || changedFloors(this.stateOf(k), want), st);
      else if (t === 'bx') { if (want === 1) this.standUp(+a, st); else if (this.standing(+a)) this.removeBuilding(W.buildings[+a], st); }
      else if (t === 'r') this.setRoad(k.slice(2), want, st);
      else if (t === 'te') this.setTerrainEdit(k.slice(3), want, st);
      else if (t === 'dc') this.setDecor(k.slice(3), want, st);
      else if (t === 'sn') this.setStation(k.slice(3), want, st);
      else if (t === 'fy') this.setFerry(k.slice(3), want, st);
      else if (t === 'wm') this.setWorldModule(k.slice(3), want, st);
      else if (t === 'co') { if (want && W.terrain) { if (c === undefined) this.setCoast(+a, want, st); else if ((W.terrain.islands || []).some(I => I.id === a)) this.setIsleCoast(a, +c, want, st); } }
      else if (t === 'is') this.setIsland(k.slice(3), want, st);
    }
    const patches = this.app.commit ? this.app.commit(() => this.finish(st)) : this.finish(st);
    if (patches.length) this.app.onPatches(patches, who);
    return { ok: true };
  }
  setItem(L, id, want) {
    const k = L.items.findIndex(x => x.id === id);
    if (!want) { if (k >= 0) L.items.splice(k, 1); return; }
    if (k >= 0) {
      const it = L.items[k];
      for (const p of Object.keys(it)) if (!(p in want)) delete it[p];
      Object.assign(it, want);
    } else {
      L.items.push({ ...want });
      if (!(L.nid > id)) L.nid = id + 1;
    }
  }
  setProps(b, want, st) {
    const B = this.world.buildings[b];
    if (!B || !want) return;
    B.name = want.name;
    if (want.sign) B.sign = want.sign; else delete B.sign;
    if (want.style) B.style = want.style; else delete B.style;
    if (want.roofKind) B.roofKind = want.roofKind; else delete B.roofKind;
    B.colors = { ...(want.colors || {}) };
    if (want.roofSigns?.length) B.roofSigns = structuredClone(want.roofSigns); else delete B.roofSigns;
    st.blds.add(b);
  }
  setPerson(i, want, st) {
    const p = this.sim.people[i];
    if (!p || !want) return;
    p.name = want.name;
    if (want.renamed) p.renamed = 1; else delete p.renamed;
    if (want.app) p.app = structuredClone(want.app);
    st.people.add(p);
  }
  /** Sets the floor count and core, and the layout of the changed floors only: the other floors keep theirs. */
  setFloors(b, want, changed, st) {
    const B = this.world.buildings[b];
    if (!B || !want) return;
    const old = B.floors, lv = [...B.lv];
    for (const f of changed) if (f < want.floors) lv[f] = want.lv[f];
    lv.length = want.floors;
    for (let k = 0; k < Math.max(old, want.floors); k++) st.ctx.add(ctxOf(B.idx, k));
    if (changed.length) this.jumpInside(B, st, Math.min(...changed, want.floors));
    B.lv = lv; B.floors = want.floors;
    if ((old === 1) !== (want.floors === 1)) { if (want.core) B.core = structuredClone(want.core); else delete B.core; }   // else the core is where bld.place put it
    for (const l of lv) st.levels.add(l);
    st.blds.add(b); st.blv.add(b);
  }
  /** Brings a demolished building back, as it was (its floors never went away). */
  standUp(b, st) {
    const B = this.world.buildings[b];
    if (!B || !B.gone) return;
    delete B.gone;
    for (let f = 0; f < B.floors; f++) st.ctx.add(ctxOf(b, f));
    for (const l of B.lv) st.levels.add(l);
    st.blds.add(b); st.blv.add(b);
  }
  // ------------------------------------------------------------------ post-processing
  finish(st) {
    const W = this.world, sim = this.sim;
    const patches = [];
    if (!st.levels.size && !st.blds.size && !st.people.size && !st.added.length && !st.roads.size && !st.terrain && !st.decor && !st.stations && !st.ferries && !st.wmods && !st.flats && !st.doors) return patches;
    W.version = (W.version || 1) + 1;
    if (!st.levels.size && !st.blds.size && !st.people.size && !st.added.length) {
      // Only roads, the land beyond the city or decorations changed: nobody's home, job or floor did; footpaths follow.
      if (st.roads.size || st.terrain || st.stations || st.ferries || st.wmods) sim.nav.refreshAccess();
      if (st.roads.size) patches.push({ k: 'roads', roads: W.roads || [] });
      if (st.terrain) patches.push({ k: 'terrain', terrain: W.terrain });
      if (st.decor) patches.push({ k: 'decor', decorations: W.decorations || [] });
      if (st.stations) patches.push({ k: 'stations', stations: W.stations });
      if (st.ferries) patches.push({ k: 'ferries', ferries: W.ferries || [] });
      if (st.wmods) patches.push({ k: 'wmods', wmods: W.worldModules || [] });
      if (st.flats) patches.push({ k: 'flats', flats: W.flats || {} });
      if (st.doors) patches.push({ k: 'doors', doors: W.doors || {} });
      for (const n of st.notes) { patches.push({ k: 'note', text: n }); this.app.onNote?.(n); }
      this.app.save({ docs: '*' });
      return patches;
    }
    for (const lv of st.levels) { sim.nav.invalidate(lv); sim.index.invalidate(lv); }
    if (st.blds.size || st.newB.length || st.removedB.length || st.roads.size || st.terrain || st.stations || st.ferries || st.wmods) sim.nav.refreshAccess();
    sim.index.rebuild();
    // (new homes bring no one at once: the city's residents settle towards its homes by themselves — server/sim/housing.js)
    // agents: jump out of removed floors / buildings, re-plan everyone touching changed floors
    const jumpFor = (a, e) => {
      const b = ctxB(e.ctx);
      const j = st.jumps.get(b);
      if (!j) return null;
      const f = e.ctx & 63;
      return f >= j.fromF ? j.to : null;
    };
    if (st.ctx.size) sim.touchAgents(ctx => st.ctx.has(ctx), jumpFor);
    if (st.soft.size) sim.touchUsers(st.soft, st.ctx);
    // people: invalid refs -> lost, then re-home / re-hire (incl. newcomers)
    const changed = new Set(st.people);
    for (const a of sim.agents) if (sim.revalidateOne(a)) changed.add(a.p);
    let addedIdx = [];
    if (st.added.length) addedIdx = sim.addPeople(st.added);
    const re = reassign(W, sim.index, sim.people, this.rng);
    for (const i of re.changed) changed.add(sim.people[i]);
    const pi = [];
    for (const p of changed) {
      const i = sim.people.indexOf(p);
      if (i >= 0) pi.push(i);
      if (i < 0 || addedIdx.includes(i)) continue;
      const a = sim.agents[i];
      patches.push({ k: 'person', i, person: sim.publicPerson(p, i) });
      if (a && p.retired && st.replan.has(i)) { sim.brain.release(a); sim.brain.leaveJoin(a); sim.brain.setAct(a, null); a.plan = null; a.ver++; continue; }   // moved away
      if (a && (st.people.has(p) && !re.changed.includes(i) && !st.replan.has(i))) continue;
      if (a && a.plan) sim.brain.interruptSoon(a);
      else if (a && !a.plan && !p.retired && st.replan.has(i)) sim.brain.warm(a, sim.now());   // back from moving away
    }
    if (addedIdx.length) {
      for (const i of addedIdx) sim.brain.warm(sim.agents[i], sim.now());
      patches.push({ k: 'people-add', list: addedIdx.map(i => sim.publicPerson(sim.people[i], i)) });
    }
    for (const lv of st.levels) patches.push({ k: 'level', lv, level: W.levels[lv] });
    for (const b of new Set([...st.blds, ...st.blv])) patches.push({ k: 'bld', b, building: W.buildings[b] });
    if (st.roads.size) patches.push({ k: 'roads', roads: W.roads || [] });
    if (st.terrain) patches.push({ k: 'terrain', terrain: W.terrain });
    if (st.decor) patches.push({ k: 'decor', decorations: W.decorations || [] });
    if (st.stations) patches.push({ k: 'stations', stations: W.stations });
    if (st.ferries) patches.push({ k: 'ferries', ferries: W.ferries || [] });
    if (st.wmods) patches.push({ k: 'wmods', wmods: W.worldModules || [] });
    if (st.flats) patches.push({ k: 'flats', flats: W.flats || {} });
    if (st.doors) patches.push({ k: 'doors', doors: W.doors || {} });
    for (const n of st.notes) { patches.push({ k: 'note', text: n }); this.app.onNote?.(n); }
    this.app.save({ buildings: [...st.blds, ...st.blv, ...st.newB, ...st.removedB, ...st.grown.map(g => g[0])], levels: st.levels, people: pi, docs: '*' });
    return patches;
  }
}
