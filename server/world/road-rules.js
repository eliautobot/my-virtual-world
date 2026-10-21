// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a road an administrator draws must satisfy (WP4.4, wp4-world-spec.md §3, §5.0): a valid alignment of a known
// road type; with the other roads, no two running on top of each other and no junctions crowding each other; outside
// the city (its streets are the grid; a road may start on the city's edge); on the island, crossing water no deeper than
// a causeway can; clear of every building and every lot (roads go between lots — a lot must be re-platted or retired
// first). Problems come back in words. Pure: the editor applies, journals and syncs.
import { RoadNetwork, checkAlignment, samplePolyline, project, DEFAULT_ROAD_PROFILES } from '../../shared/roads.js';
import { isUm } from '../../shared/units.js';
import { makeGrid } from '../../shared/city.js';
import { corners } from '../../shared/geom.js';
import { protectedWhy, growthAt, landOf } from '../../shared/coasts.js';
import { WORLD_HALF } from '../../shared/island-chain.js';
import { BRIDGE_DEPTH } from '../../shared/island-roads.js';
import { decorCorners } from '../../shared/decor.js';
import { CATALOG } from '../../shared/catalog.js';
import { cityRoads, isCityRoad } from '../../shared/city-roads.js';
import { modulesOf, padOf, inRect, roadEndOf, WORLD_KINDS } from '../../shared/world-modules.js';

export const ROAD_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MAX_POINTS = 64, MAX_BRIDGE_DEPTH = 600, MAX_BRIDGE_LENGTH = 4000;   // deep water is spanned (piers stand where they reach the floor)

/** A road record from a request, normalised (µm integers, trimmed name), or an Error with the reason. */
export function normalizeRoad(input, profiles = DEFAULT_ROAD_PROFILES) {
  if (!input || typeof input !== 'object') return new Error('Bad road');
  const id = String(input.id || ''), name = String(input.name ?? '').trim().slice(0, 60), profile = String(input.profile || '');
  if (!ROAD_ID.test(id)) return new Error('A road id is 1–48 lowercase letters, digits or dashes');
  if (isCityRoad(id)) return new Error("That id belongs to one of the city's streets");
  if (!profiles[profile]) return new Error(`Unknown road type "${profile}"`);
  if (!Array.isArray(input.pts) || input.pts.length < 2 || input.pts.length > MAX_POINTS) return new Error(`A road has 2 to ${MAX_POINTS} points`);
  const pts = [];
  for (const p of input.pts) {
    const x = Number(p?.x), z = Number(p?.z), r = Number(p?.r || 0);
    if (!isUm(x) || !isUm(z) || !isUm(r) || r < 0) return new Error('Road points are whole micrometres');
    pts.push(r ? { x, z, r } : { x, z });
  }
  const out = { id, profile, name, closed: !!input.closed, pts };
  // A grid's roads (the grid layout tool): one flat level for all of them (m) and the grid they belong to — the land
  // across the whole grid is levelled to it (shared/island-build.js gridPads), so its lots are level too.
  if (input.level !== undefined && input.level !== null) {
    const y = Number(input.level);
    if (!Number.isFinite(y) || y < -10 || y > 900) return new Error('Bad road level');
    out.level = Math.round(y * 100) / 100;
  }
  if (input.grid !== undefined && input.grid !== null) {
    const g = String(input.grid);
    if (!/^[a-z0-9-]{1,40}$/.test(g)) return new Error('Bad grid id');
    if (out.level === undefined) return new Error('A grid road needs its level');
    out.grid = g;
  }
  return out;
}

/**
 * Problems with putting road `rec` into `world` (replacing the road with its id, if any): [] when it may be built.
 * opts: { island (shared/terrain.js Island, for water), lots: [{ id, poly (µm), holder }] }.
 */
export function roadProblems(world, rec, { island = null, lots = [], profiles = DEFAULT_ROAD_PROFILES } = {}) {
  const out = [];
  const geom = checkAlignment(rec, profiles);
  if (geom.length) return geom.map(p => p.message);
  if (!world.terrain) return ['Roads beyond the city need an island'];
  // One network with the city's streets (shared/city-roads.js): a new road may not run on top of one or crowd its junctions.
  const net = new RoadNetwork({ profiles });
  if (world.grid) for (const r of cityRoads(world.grid)) net.set(r);
  for (const r of world.roads || []) if (r.id !== rec.id && !isCityRoad(r.id)) { try { net.set(r); } catch { /* an older invalid road is left out */ } }
  try { net.set(rec); } catch (e) { return [e.message]; }
  for (const p of net.validate()) if ((p.roads || []).includes(rec.id) || (p.junctions || []).some(k => k.split('@')[0].split('+').includes(rec.id))) out.push(p.message);
  const G = net.geometry(rec.id), pts = samplePolyline(G, 0, { maxChord: 4 }), g = makeGrid(world.grid), T = world.terrain;
  // The city's own streets serve the inside of the city; a road may start or end on its edge.
  // (a road may end on an edge street's centre line, joining the city's junction there — shared/city-roads.js)
  const ix0 = g.X[0] + 0.5, ix1 = g.X.at(-1) - 0.5, iz0 = g.Z[0] + 0.5, iz1 = g.Z.at(-1) - 0.5;
  if (g.empty) { /* no city: no streets to keep clear of */ }
  else if (pts.some(p => p.x > ix0 && p.x < ix1 && p.z > iz0 && p.z < iz1)) out.push('Roads inside the city are its streets; start the road at the city\'s edge');
  else {
    // ... and meets them there, never running alongside one closer than both their widths (away from where it meets them)
    const half = profiles[rec.profile].outerHalf / 1e6, cityHalf = profiles[cityRoads(world.grid)[0].profile].outerHalf / 1e6, reach = half + cityHalf;
    const a = pts[0], b = pts.at(-1);
    for (const p of pts) {
      if (Math.hypot(p.x - a.x, p.z - a.z) < reach + 2 || Math.hypot(p.x - b.x, p.z - b.z) < reach + 2) continue;
      const hit = [...net.candidates({ x0: p.x, z0: p.z, x1: p.x, z1: p.z }, reach)].find(id => isCityRoad(id) && project(net.geometry(id), p.x, p.z)?.dist < reach - 0.01);
      if (hit) { out.push(`The road runs too close along ${net.get(hit).name}; keep it ${Math.ceil(reach / 0.3048)} ft from the street's centre, or end it there`); break; }
    }
  }
  if (pts.some(p => Math.abs(p.x) > WORLD_HALF || Math.abs(p.z) > WORLD_HALF)) out.push("Part of the road is beyond the edge of the world's ocean");
  if (island) {
    // Water: shallow water is crossed on a causeway; deep sea on a bridge, which only leaves the main island from a
    // growth coast and never enters the clear water kept in front of protected waterfront (WP4.15, shared/coasts.js).
    const atSea = p => island.waterAt(p.x, p.z)?.kind === 'sea' || island.baseHeight(p.x, p.z) < T.seaLevel;
    if (atSea(pts[0]) || atSea(pts.at(-1))) out.push('A road starts and ends on land');
    let deep = 0, seaRun = 0, longest = 0, prevSea = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], w = island.waterAt(p.x, p.z), sea = w?.kind === 'sea' || (!w && island.baseHeight(p.x, p.z) < T.seaLevel - BRIDGE_DEPTH);
      if (w || sea) deep = Math.max(deep, (w ? w.level : T.seaLevel) - island.baseHeight(p.x, p.z));
      if (sea) {
        seaRun += i ? Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0; longest = Math.max(longest, seaRun);
        const why = protectedWhy(island, p.x, p.z, 0);
        if (why) { out.push(why.replace(/^It/, 'The road')); break; }
      } else seaRun = 0;
      if (sea !== prevSea && i > 0) {   // where the road leaves or reaches land
        const q = sea ? pts[i - 1] : p;
        if (landOf(island, q.x, q.z) && !growthAt(island, q.x, q.z)) { out.push('A road leaves an island over the sea only from a growth coast; mark the coast there as one first'); break; }
      }
      prevSea = sea;
    }
    if (deep > MAX_BRIDGE_DEPTH) out.push(`The water is ${deep.toFixed(0)} m deep there; bridges stand in water up to ${MAX_BRIDGE_DEPTH} m deep`);
    if (longest > MAX_BRIDGE_LENGTH) out.push(`That bridge would be ${(longest / 1609.34).toFixed(1)} miles long; bridges are at most ${(MAX_BRIDGE_LENGTH / 1609.34).toFixed(1)} miles`);
  }
  // Buildings and lots in the road's way (its full width, sidewalks included).
  for (const B of world.buildings || []) {
    if (!B || B.gone) continue;
    const poly = corners(B);
    if (net.corridorHits(poly).some(h => h.id === rec.id)) { out.push(`The road crosses ${B.name || 'a building'}`); if (out.length > 6) break; }
  }
  for (const d of world.decorations || []) {
    if (net.corridorHits(decorCorners(d)).some(h => h.id === rec.id)) { out.push(`The road crosses a ${(CATALOG[d.t]?.name || 'decoration').toLowerCase()}; move it first`); if (out.length > 7) break; }
  }
  { // a world module (an airport): no road crosses it; its access road meets it only where its car park ends (roadEndOf)
    const half = profiles[rec.profile].outerHalf / 1e6;
    for (const m of modulesOf(world)) {
      if (!WORLD_KINDS[m.kind]) continue;
      const pad = padOf(m), door = roadEndOf(m);
      if (pts.some(p => inRect(pad, p.x, p.z, half - 0.5) && Math.hypot(p.x - door.x, p.z - door.z) > half + 6)) { out.push(`The road crosses ${m.name || WORLD_KINDS[m.kind].label}; go round it`); break; }
    }
  }
  for (const L of lots) {
    const poly = L.poly.map(p => ({ x: p.x / 1e6, z: p.z / 1e6 }));
    if (net.corridorHits(poly).some(h => h.id === rec.id)) { out.push(`The road crosses lot ${L.id}; re-plat or retire the lot first`); if (out.length > 8) break; }
  }
  return out;
}

/** The next free road id for new roads ("road-1", "road-2", …). */
export function nextRoadId(roads) {
  let n = 0;
  for (const r of roads || []) { const m = /^road-(\d+)$/.exec(r.id); if (m) n = Math.max(n, +m[1]); }
  return `road-${n + 1}`;
}
