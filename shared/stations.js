// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Subway stations as map objects (WP4.5, wp4-world-spec.md §9: residents use the subway between the city and the land
// beyond it): the city's stations stand on its sidewalks (server/world/generate.js); beyond the city administrators
// place more, each a kiosk beside a road, turned to face it and level on its own small pad. A station: { id, name, x,
// z (kiosk centre), rot (radians; 0: the kiosk runs along z with its steps going down towards −z), y (its floor; absent
// in the city: the sidewalk), len, entry: { x, z } (where people walk up to it) }.
import { GROUND_Y } from './constants.js';
import { makeGrid } from './city.js';
import { inItemRect } from './geom.js';
import { CATALOG } from './catalog.js';
import { moduleAt } from './world-modules.js';

export const KIOSK = Object.freeze({ hw: 0.72, hd: 1.98 });
export const STATION_SPACING = 120;   // m between stations beyond the city
export const STATION_REACH = 45;      // m from the kiosk to the back of a road
const cm = v => Math.round(v * 100) / 100;

export const stationY = st => (Number.isFinite(st.y) ? st.y : GROUND_Y);
/** A point in the station's own frame (lx across, lz along the kiosk) in the world. */
export function stationPoint(st, lx, lz) {
  const r = st.rot || 0, c = Math.cos(r), s = Math.sin(r);
  return { x: st.x + lx * c + lz * s, z: st.z - lx * s + lz * c };
}
/** Where a rider stands inside the kiosk (at the top of the steps). */
export const stationInside = st => stationPoint(st, 0, -0.7);
/** The kiosk's corners (grown by pad). */
export function kioskCorners(st, pad = 0) {
  return [[-KIOSK.hw - pad, -KIOSK.hd - pad], [KIOSK.hw + pad, -KIOSK.hd - pad], [KIOSK.hw + pad, KIOSK.hd + pad], [-KIOSK.hw - pad, KIOSK.hd + pad]].map(([a, b]) => stationPoint(st, a, b));
}
/** A new station beyond the city from a request: { name, x, z, rot } with its entry in front (or an Error). */
export function normalizeStation(o) {
  const x = +o.x, z = +o.z, rot = +(o.rot || 0);
  if (![x, z, rot].every(Number.isFinite)) return new Error('Bad position');
  const name = String(o.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 28);
  const st = { name, x: cm(x), z: cm(z), rot: Math.round((((rot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 1000) / 1000, len: 3.6 };
  const e = stationPoint(st, 0, KIOSK.hd + 0.45); st.entry = { x: cm(e.x), z: cm(e.z) };
  return st;
}
/**
 * Why station st can't stand there, or null. env: { heightAt, isWater, roads (RoadNetwork) }. ignoreId: the station
 * being moved.
 */
export function checkStation(world, st, env, ignoreId = null) {
  const g = makeGrid(world.grid), pts = kioskCorners(st, 0.6);
  if (pts.some(p => p.x >= g.minX - 6 && p.x <= g.maxX + 6 && p.z >= g.minZ - 6 && p.z <= g.maxZ + 6)) return "The city's stations are part of its plan; place this one beyond the city";
  if (pts.some(p => env.isWater(p.x, p.z))) return 'That is in the water';
  { const m = pts.map(p => moduleAt(world, p.x, p.z, 4)).find(Boolean); if (m) return `That is ${m.name || 'a world module'}'s land`; }
  const hs = pts.map(p => env.heightAt(p.x, p.z));
  if (Math.max(...hs) - Math.min(...hs) > 2) return 'The ground is too steep there';
  if (env.roads?.corridorHits(kioskCorners(st, 1)).length) return 'Keep it off the road';
  const near = env.roads ? env.roads.nearest(st.entry.x, st.entry.z, STATION_REACH + 30) : null;
  if (!near || near.dist - env.roads.profiles[env.roads.get(near.id).profile].outerHalf / 1e6 > STATION_REACH) return `Place it within ${Math.round(STATION_REACH / 0.3048)} ft of a road`;
  for (const B of world.buildings || []) {
    if (!B || B.gone) continue;
    const r = (B.rot || 0) * Math.PI / 180, rect = [-B.w / 2 - 2, -B.d / 2 - 2, B.w / 2 + 2, B.d / 2 + 2];
    if (pts.some(p => inItemRect(p.x, p.z, B.x, B.z, r, rect))) return `Too close to ${B.name || 'a building'}`;
  }
  for (const d of world.decorations || []) {
    const R = CATALOG[d.t]?.rect; if (!R) continue;
    if (Math.hypot(d.x - st.x, d.z - st.z) < Math.hypot(R[2] - R[0], R[3] - R[1]) / 2 + 3) return `A ${(CATALOG[d.t].name || 'decoration').toLowerCase()} is in the way`;
  }
  for (const o of world.stations || []) {
    if (o.id === ignoreId) continue;
    if (Math.hypot(o.x - st.x, o.z - st.z) < STATION_SPACING) return `${o.name} station is only ${Math.round(Math.hypot(o.x - st.x, o.z - st.z) / 0.3048)} ft away; stations stand at least ${Math.round(STATION_SPACING / 0.3048)} ft apart`;
  }
  return null;
}
