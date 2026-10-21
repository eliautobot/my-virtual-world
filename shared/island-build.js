// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Buildings beyond the city (WP4.6, wp4-world-spec.md §4–5): a building outside the city's grid stands on a level pad
// at the height of the ground along its front (its base, B.base, metres above the city's ground level), so its door
// meets the path to its road; the ground around is graded to that pad (shared/terrain.js pads) and the back is cut or
// filled. The rules where it may go — the same in the browser's ghost and on the server: on dry
// ground, not too steep, clear of roads and other buildings, with a road within reach of its door (lots and rights are
// checked separately, server/lot-rights.js).
import { makeGrid, addressOf } from './city.js';
import { corners, footprintsOverlap, toWorld, inFootprint } from './geom.js';
import { CATALOG } from './catalog.js';
import { KIOSK } from './stations.js';
import { GROUND_Y } from './constants.js';
import { doorPoints } from './building.js';
import { worldModulePads, moduleAt } from './world-modules.js';
import { DEFAULT_ROAD_PROFILES } from './roads.js';
import { sectionOf, CURB_RISE } from './road-kit.js';
import { DRAW_LIFT } from './island-roads.js';

export const MAX_PAD_SLOPE = 3.5;      // m the ground may rise or fall from the pad's level anywhere on the footprint
export const ROAD_REACH = 80;          // m from the door to a road's edge
export const ROAD_CLEAR = 2;           // m from the footprint to the back of a road (the pad reaches 1.5 m out)

/** Where (x, z) is in words: the street corner in the city (g: its makeGrid); beyond it the nearest road's name
 *  (net: a RoadNetwork). */
export function addressAt(g, x, z, net = null) {
  if (x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ) return addressOf(g, x, z);
  const near = net ? net.nearest(x, z, 250) : null;
  return near ? net.get(near.id)?.name || 'Beside the road' : 'Out in the country';
}
/** Whether (x, z) is beyond the city's grid (an island building, not a city one). */
export function beyondCity(world, x, z) { const g = makeGrid(world.grid); return x < g.minX || x > g.maxX || z < g.minZ || z > g.maxZ; }

/** The footprint's corners and centre (world m). */
function samples(spec) { return [...corners(spec).map(p => [p.x, p.z]), [spec.x, spec.z]]; }

/** The level pad's height (m) for a footprint, to the centimetre: the ground along its front (its two front corners and
 *  the spot outside its door), or for a park the mean over its corners and centre. */
export function padHeight(heightAt, spec) {
  let pts = samples(spec);
  if (spec.type !== 'park') { const dp = doorPoints(spec).outside, d = toWorld(spec, dp.x, dp.z); pts = [pts[0], pts[1], [d.x, d.z]]; }
  let s = 0; for (const [x, z] of pts) s += heightAt(x, z);
  return Math.round(s / pts.length * 100) / 100;
}
/** A grid's blocks: the rectangles between its roads, from the back of one road's sidewalk to the next's — [u0, u1,
 *  v0, v1] in the grid's frame (u along (co, si)) — each closed on all four sides by roads running past it. */
function gridBlocks(rs, co, si) {
  const along = [], across = [];
  for (const r of rs) {
    if (r.pts.length !== 2) return [];
    const [a, b] = r.pts.map(p => ({ u: (p.x * co + p.z * si) / 1e6, v: (-p.x * si + p.z * co) / 1e6 }));
    const half = (DEFAULT_ROAD_PROFILES[r.profile]?.outerHalf ?? 0) / 1e6;
    if (Math.abs(a.v - b.v) < 0.05) along.push({ at: (a.v + b.v) / 2, lo: Math.min(a.u, b.u), hi: Math.max(a.u, b.u), half });
    else if (Math.abs(a.u - b.u) < 0.05) across.push({ at: (a.u + b.u) / 2, lo: Math.min(a.v, b.v), hi: Math.max(a.v, b.v), half });
    else return [];
  }
  along.sort((p, q) => p.at - q.at); across.sort((p, q) => p.at - q.at);
  const out = [], spans = (R, lo, hi) => R.lo <= lo + 0.05 && R.hi >= hi - 0.05;
  for (let i = 0; i + 1 < across.length; i++) for (let j = 0; j + 1 < along.length; j++) {
    const A = across[i], B = across[i + 1], C = along[j], D = along[j + 1];
    if (!spans(A, C.at, D.at) || !spans(B, C.at, D.at) || !spans(C, A.at, B.at) || !spans(D, A.at, B.at)) continue;
    const u0 = A.at + A.half, u1 = B.at - B.half, v0 = C.at + C.half, v1 = D.at - D.half;
    if (u1 - u0 > 1 && v1 - v0 > 1) out.push([u0, u1, v0, v1]);
  }
  return out;
}
/** Whether (x, z) is inside one of grid pad P's blocks (P.blocks, in its own frame). */
export function inGridBlock(P, x, z) {
  if (!P.blocks?.length) return false;
  const dx = x - P.x, dz = z - P.z, u = dx * Math.cos(P.rot) - dz * Math.sin(P.rot), v = dx * Math.sin(P.rot) + dz * Math.cos(P.rot);
  return P.blocks.some(b => u > b[0] && u < b[1] && v > b[2] && v < b[3]);
}
/** The grid pad (gridPads) whose land (x, z) is on, or null. */
export function gridPadAt(world, x, z) {
  for (const P of gridPads(world)) { const dx = x - P.x, dz = z - P.z, u = dx * Math.cos(P.rot) - dz * Math.sin(P.rot), v = dx * Math.sin(P.rot) + dz * Math.cos(P.rot); if (Math.abs(u) <= P.hw && Math.abs(v) <= P.hd) return P; }
  return null;
}
/** The base (m above the city's ground level) a new building there gets: on a grid's land, its lots' level (the
 *  building's floor flush with the lot and the sidewalks, as in the city). */
export const baseFor = (heightAt, spec, world = null) => {
  const G = world && gridPadAt(world, spec.x, spec.z);
  return Math.round(((G ? G.lot : padHeight(heightAt, spec)) - GROUND_Y) * 100) / 100;
};

/**
 * Why a building can't stand there beyond the city, or null. env: { heightAt(x, z), isWater(x, z), roads (a RoadNetwork
 * or null) }. ignoreIdx: the building being moved (skipped among the others).
 */
export function checkIslandBuilding(world, spec, env, ignoreIdx = -1) {
  if (![spec.x, spec.z, spec.w, spec.d].every(Number.isFinite)) return 'Bad position';
  const pts = samples(spec);
  if (pts.some(([x, z]) => env.isWater(x, z))) return 'That is in the water';
  const level = padHeight(env.heightAt, spec), off = Math.max(...pts.map(([x, z]) => Math.abs(env.heightAt(x, z) - level)));
  if (off > MAX_PAD_SLOPE) return `The ground rises or falls ${off.toFixed(1)} m across it; find flatter ground`;
  if (env.roads) {
    const hit = env.roads.corridorHits(corners(spec, ROAD_CLEAR))[0];
    if (hit) return `It is on ${env.roads.get(hit.id)?.name || 'a road'}`;
  }
  for (const o of world.buildings) {
    if (!o || o.gone || o.idx === ignoreIdx) continue;
    if (footprintsOverlap(spec, o, 0.5)) return `Too close to ${o.name}`;
  }
  for (const d of world.decorations || []) if (inFootprint(spec, d.x, d.z, 1.5)) return `A ${(CATALOG[d.t]?.name || 'decoration').toLowerCase()} is in the way; move it first`;
  { const m = [...pts, ...corners(spec, 4).map(p => [p.x, p.z])].map(([x, z]) => moduleAt(world, x, z, 4)).find(Boolean); if (m && m.id !== spec.module) return `That is ${m.name || 'a world module'}'s land`; }   // (a module's own building: its terminal)
  if (spec.type !== 'park') {
    const dp = doorPoints(spec), door = toWorld(spec, dp.outside.x, dp.outside.z);
    const near = env.roads ? env.roads.nearest(door.x, door.z, ROAD_REACH + 15) : null;
    const edge = near ? near.dist - env.roads.profiles[env.roads.get(near.id).profile].outerHalf / 1e6 : Infinity;
    if (edge > ROAD_REACH) return `No road within ${Math.round(ROAD_REACH / 0.3048)} ft of the door; build nearer a road`;
  }
  return null;
}

/** The level pads of the buildings (and subway kiosks) beyond the city: [{ x, z, hw, hd, rot (radians), y }] for the
 *  terrain to grade to. */
export function buildingPads(world) {
  const out = [];
  for (const B of world.buildings || []) {
    if (!B || B.gone || B.base === undefined) continue;
    out.push({ x: B.x, z: B.z, hw: B.w / 2 + 1.5, hd: B.d / 2 + 1.5, rot: ((B.rot || 0) * Math.PI) / 180, y: GROUND_Y + B.base });
  }
  for (const st of world.stations || []) if (Number.isFinite(st.y)) out.push({ x: st.x, z: st.z, hw: KIOSK.hw + 1.2, hd: KIOSK.hd + 1.2, rot: st.rot || 0, y: st.y });
  out.push(...worldModulePads(world));   // the world modules' pads (an airport's runway, apron and terminal: shared/world-modules.js)
  out.push(...gridPads(world));
  return out;
}

export const GRID_BLEND = 30;   // m over which a levelled grid's land eases back into the hills round it
/**
 * The level land under each grid of roads (the grid layout tool, client/js/ui/roads.js; the product owner 2026-10-14:
 * "make sure the terrain is adjusted so that the roadways are flat" — and the lots between them on even level): one pad
 * per grid, the rectangle round all its roads (straight, square to each other) out past their sidewalks, at the grid's
 * level. `under`: roads still shape their own corridors over it (shared/terrain.js); its edge eases out over GRID_BLEND.
 */
export function gridPads(world) {
  const by = new Map();
  for (const r of world.roads || []) if (r && r.grid && Number.isFinite(r.level) && r.pts?.length >= 2) (by.get(r.grid) || by.set(r.grid, []).get(r.grid)).push(r);
  const out = [];
  for (const [, rs] of [...by].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const a = rs[0].pts[0], b = rs[0].pts.at(-1), th = Math.atan2(b.z - a.z, b.x - a.x), co = Math.cos(th), si = Math.sin(th);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, half = 0, y = 0, raised = false;
    for (const r of rs) {
      const P = DEFAULT_ROAD_PROFILES[r.profile];
      half = Math.max(half, (P?.outerHalf ?? 0) / 1e6); y += r.level; raised ||= !!(P && sectionOf(P).raised);
      for (const p of r.pts) { const x = p.x / 1e6, z = p.z / 1e6, u = x * co + z * si, v = -x * si + z * co; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    }
    const m = half + 4, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, r2 = v => Math.round(v * 100) / 100;
    // (shared/terrain.js padDist: local hw-axis = dx·cos(rot) − dz·sin(rot); the grid's u-axis is (cos th, sin th): rot = −th)
    // its lots' ground: flush with the top of the back of its sidewalks (2026-10-14, the product owner: "flat and flush
    // with the back of sidewalks", as in the city), the land just under it (shared/terrain.js; render/lot-ground.js)
    const lot = y / rs.length + DRAW_LIFT + (raised ? CURB_RISE : 0);
    const x = r2(cu * co - cv * si), z = r2(cu * si + cv * co), pu = x * co + z * si, pv = -x * si + z * co;
    out.push({ x, z, hw: r2((u1 - u0) / 2 + m), hd: r2((v1 - v0) / 2 + m), rot: -th, y: lot + 0.02, lot, under: 1, blend: GRID_BLEND, blocks: gridBlocks(rs, co, si).map(([a, b, c, d]) => [a - pu, b - pu, c - pv, d - pv]) });
  }
  return out;
}
