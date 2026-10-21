// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Interior walls (WP4.8, PLAN WP4.8, wp4-world-spec.md §9): draw and erase partitions on a floor, solid or glass,
// snapping to the floor's quarter-metre grid, to the ends of existing walls and to the outer walls; cut doorways into
// them. A wall may not run through furniture or the lift and stair core, double an existing wall, or shut anyone or
// anything off: every entrance and every piece of furniture someone uses must stay reachable (the rule residents need
// to path around walls). The same rules run in the browser's ghost and on the server. A wall: [x1, z1, x2, z2, kind]
// in the building's own frame (kind 0 solid, 1 glass).
import { CATALOG } from './catalog.js';
import { itemAABB } from './geom.js';
import { interiorBounds } from './edit.js';
import { buildGrid, flood, nearestFree } from './navgrid.js';
import { levelEntries } from './building.js';

export const WALL_GRID = 0.25, MIN_WALL = 0.5, DOOR_WIDTH = 1.0, SNAP_END = 0.45;
const r2 = v => Math.round(v * 100) / 100;

/** A wall from a request, or an Error. */
export function normalizeWall(w) {
  if (!Array.isArray(w) || w.length < 4) return new Error('Bad wall');
  const [x1, z1, x2, z2] = w.slice(0, 4).map(Number), kind = w[4] === 1 ? 1 : 0;
  if (![x1, z1, x2, z2].every(Number.isFinite)) return new Error('Bad wall');
  return [r2(x1), r2(z1), r2(x2), r2(z2), kind];
}
/**
 * Snap a floor point (building frame): to an existing wall's end (except those listed in `skip`, [x, z] pairs being
 * moved), onto a wall's length (a T-joint), to the outer walls, else to the quarter-metre grid. Returns { x, z, to }
 * where `to` says what it snapped to ('end', 'wall', 'grid').
 */
export function snapPoint(B, L, x, z, skip = null) {
  const skipped = (px, pz) => skip && skip.some(([sx, sz]) => Math.abs(sx - px) < 0.02 && Math.abs(sz - pz) < 0.02);
  let best = null, bd = SNAP_END;
  for (const w of L.walls || []) for (const [px, pz] of [[w[0], w[1]], [w[2], w[3]]]) { if (skipped(px, pz)) continue; const d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; best = { x: px, z: pz, to: 'end' }; } }
  if (best) return best;
  // onto a wall's length, at a quarter-metre along it
  bd = 0.3;
  for (const w of L.walls || []) {
    if (skip && (skipped(w[0], w[1]) || skipped(w[2], w[3]))) continue;
    const dx = w[2] - w[0], dz = w[3] - w[1], len = Math.hypot(dx, dz); if (len < 0.01) continue;
    const t = Math.max(0, Math.min(len, ((x - w[0]) * dx + (z - w[1]) * dz) / len)), ts = Math.round(t / WALL_GRID) * WALL_GRID;
    const px = w[0] + dx / len * ts, pz = w[1] + dz / len * ts, d = segDist(x, z, w[0], w[1], w[2], w[3]);
    if (d < bd && ts > 0.01 && ts < len - 0.01) { bd = d; best = { x: r2(px), z: r2(pz), to: 'wall' }; }
  }
  if (best) return best;
  const ib = interiorBounds(B), g = v => Math.round(v / WALL_GRID) * WALL_GRID;
  let sx = g(x), sz = g(z);
  if (Math.abs(x - ib.x0) < 0.3) sx = ib.x0; else if (Math.abs(x - ib.x1) < 0.3) sx = ib.x1;
  if (Math.abs(z - ib.z0) < 0.3) sz = ib.z0; else if (Math.abs(z - ib.z1) < 0.3) sz = ib.z1;
  return { x: r2(Math.max(ib.x0, Math.min(ib.x1, sx))), z: r2(Math.max(ib.z0, Math.min(ib.z1, sz))), to: 'grid' };
}
/** A wall's end from `a` towards pointer `p`, its direction held to 15° steps and its length to quarter-metres. */
export function snapAngle(a, p, step = Math.PI / 12) {
  const dx = p.x - a.x, dz = p.z - a.z, len = Math.round(Math.hypot(dx, dz) / WALL_GRID) * WALL_GRID, ang = Math.round(Math.atan2(dz, dx) / step) * step;
  return { x: r2(a.x + Math.cos(ang) * len), z: r2(a.z + Math.sin(ang) * len), to: 'angle' };
}
const segDist = (px, pz, a, b, c, d) => { const dx = c - a, dz = d - b, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - a) * dx + (pz - b) * dz) / L2)); return Math.hypot(a + dx * t - px, b + dz * t - pz); };
/** Whether segment w passes within pad of rectangle bb. */
function hitsRect(w, bb, pad) {
  const n = Math.max(2, Math.ceil(Math.hypot(w[2] - w[0], w[3] - w[1]) / 0.08));
  for (let k = 0; k <= n; k++) { const t = k / n, x = w[0] + (w[2] - w[0]) * t, z = w[1] + (w[3] - w[1]) * t; if (x > bb.x0 - pad && x < bb.x1 + pad && z > bb.z0 - pad && z < bb.z1 + pad) return true; }
  return false;
}
/** What on floor f of B a wall layout shuts off: { entrance: bool, items: [names] } (empty when everything is reachable). */
export function shutOff(B, f, L, walls) {
  const g = buildGrid(B, { ...L, walls });
  const seeds = levelEntries(B, f).map(p => nearestFree(g, p.x, p.z, 3));
  if (!seeds.length) return { entrance: false, items: [] };
  if (seeds.some(s => s < 0)) return { entrance: true, items: [] };
  const reach = flood(g, [seeds[0]]);
  const out = { entrance: !seeds.every(s => reach[s]), items: [] };
  for (const it of L.items) {
    const def = CATALOG[it.t]; if (!def || !def.slots?.length) continue;
    const c = Math.cos(it.r || 0), s = Math.sin(it.r || 0), ok = def.slots.some(sl => {
      const ax = sl.ax ?? sl.x, az = sl.az ?? sl.z, x = it.x + ax * c + az * s, z = it.z - ax * s + az * c, cell = nearestFree(g, x, z, 2);
      return cell >= 0 && reach[cell];
    });
    if (!ok) out.items.push(def.name || it.t);
  }
  return out;
}
/** Why wall w can't stand among `others` (too short, outside, through furniture or the core, doubling a wall), or null. */
function conflict(B, L, w, others) {
  const len = Math.hypot(w[2] - w[0], w[3] - w[1]), ib = interiorBounds(B);
  if (len < MIN_WALL) return 'Too short for a wall';
  for (const [x, z] of [[w[0], w[1]], [w[2], w[3]]]) if (x < ib.x0 - 0.01 || x > ib.x1 + 0.01 || z < ib.z0 - 0.01 || z > ib.z1 + 0.01) return 'Keep it inside the building';
  for (const it of L.items) {
    const def = CATALOG[it.t]; if (!def) continue;
    if (hitsRect(w, itemAABB(it, def.rect), def.fixed ? 0.25 : 0.05)) return def.fixed ? `That would cut through the ${(def.name || 'core').toLowerCase()}` : `The ${(def.name || it.t).toLowerCase()} is in the way`;
  }
  for (const o of others) {   // doubling an existing wall
    const along = segDist(w[0], w[1], o[0], o[1], o[2], o[3]) < 0.08 && segDist(w[2], w[3], o[0], o[1], o[2], o[3]) < 0.08;
    const mid = segDist((w[0] + w[2]) / 2, (w[1] + w[3]) / 2, o[0], o[1], o[2], o[3]) < 0.08;
    if (along || (mid && Math.abs((w[2] - w[0]) * (o[3] - o[1]) - (w[3] - w[1]) * (o[2] - o[0])) < 1e-3 * len * Math.hypot(o[2] - o[0], o[3] - o[1]))) return 'There is a wall there already';
  }
  return null;
}
/** What a new set of walls newly shuts off (compared with the floor's walls now), as a reason, or null. */
function newlyShut(B, f, L, walls) {
  // only what the change newly shuts off counts (a layout may already hold an odd unreachable corner)
  const before = shutOff(B, f, L, L.walls || []), cut = shutOff(B, f, L, walls);
  if (cut.entrance && !before.entrance) return 'That would shut off an entrance';
  const left = [...before.items], added = cut.items.filter(n => { const k = left.indexOf(n); if (k >= 0) { left.splice(k, 1); return false; } return true; });
  if (added.length) return `That would shut off the ${added[0].toLowerCase()}${added.length > 1 ? ` and ${added.length - 1} more` : ''}`;
  return null;
}
/** Why wall w can't go on floor f of building B (layout L), or null. */
export function checkWall(B, f, L, w) {
  return conflict(B, L, w, L.walls || []) || newlyShut(B, f, L, [...(L.walls || []), w]);
}
/**
 * A whole edit of a floor's walls at once (a corner dragged moves every wall meeting there; a wall slid stretches its
 * neighbours; a room is four walls): `walls` the floor's walls after it, `changed` the indices in it that are new or
 * moved. Why it can't stand, or null.
 */
export function checkLayout(B, f, L, walls, changed) {
  for (const i of changed) {
    const why = conflict(B, L, walls[i], walls.filter((_, k) => k !== i));
    if (why) return why;
  }
  return newlyShut(B, f, L, walls);
}
/**
 * Apply an edit { set: [[i, wall]], add: [wall], del: [i] } to a floor's walls: { walls, changed } (changed: indices in
 * the new list of the walls set or added), or an Error.
 */
export function editWalls(L, e) {
  const old = L.walls || [], out = old.map(w => w.slice()), changed = new Set();
  for (const [i, w] of e.set || []) {
    if (!out[i]) return new Error('No such wall');
    const n = normalizeWall(w); if (n instanceof Error) return n;
    out[i] = n; changed.add(i);
  }
  const del = new Set((e.del || []).map(i => i | 0));
  for (const i of del) if (!old[i]) return new Error('No such wall');
  const kept = [], map = new Map();
  out.forEach((w, i) => { if (!del.has(i)) { map.set(i, kept.length); kept.push(w); } });
  const ch = [...changed].filter(i => map.has(i)).map(i => map.get(i));
  for (const w of e.add || []) { const n = normalizeWall(w); if (n instanceof Error) return n; ch.push(kept.length); kept.push(n); }
  return { walls: kept, changed: ch };
}
/**
 * The walls of a room dragged out from corner a to corner c (building frame, square to the building): its four sides,
 * leaving out any that lie along the outer walls or along a wall already there. If the room would shut something off,
 * a doorway goes in the middle of the side facing the floor's way in.
 */
export function roomWalls(B, f, L, a, c) {
  const ib = interiorBounds(B), x0 = Math.min(a.x, c.x), x1 = Math.max(a.x, c.x), z0 = Math.min(a.z, c.z), z1 = Math.max(a.z, c.z);
  const onOuter = w => (Math.abs(w[0] - w[2]) < 0.01 && (Math.abs(w[0] - ib.x0) < 0.05 || Math.abs(w[0] - ib.x1) < 0.05)) || (Math.abs(w[1] - w[3]) < 0.01 && (Math.abs(w[1] - ib.z0) < 0.05 || Math.abs(w[1] - ib.z1) < 0.05));
  const sides = [[x0, z0, x1, z0, 0], [x1, z0, x1, z1, 0], [x1, z1, x0, z1, 0], [x0, z1, x0, z0, 0]].map(w => w.map(r2));
  let walls = sides.filter(w => !onOuter(w) && !conflict(B, L, w, L.walls || [])?.startsWith('There is a wall'));
  const all = [...(L.walls || []), ...walls];
  if (walls.length && newlyShut(B, f, L, all)) {
    // a doorway in the side nearest the floor's way in
    const ent = levelEntries(B, f)[0] || { x: (ib.x0 + ib.x1) / 2, z: ib.z1 };
    let k = 0, bd = Infinity;
    walls.forEach((w, i) => { const d = Math.hypot((w[0] + w[2]) / 2 - ent.x, (w[1] + w[3]) / 2 - ent.z); if (d < bd && Math.hypot(w[2] - w[0], w[3] - w[1]) >= DOOR_WIDTH + 0.6) { bd = d; k = i; } });
    const w = walls[k];
    walls = [...walls.slice(0, k), ...doorway(w, (w[0] + w[2]) / 2, (w[1] + w[3]) / 2), ...walls.slice(k + 1)];
  }
  return walls;
}
/** Wall w with a doorway of `width` m centred at its point nearest (x, z): the pieces left either side. */
export function doorway(w, x, z, width = DOOR_WIDTH) {
  const dx = w[2] - w[0], dz = w[3] - w[1], L = Math.hypot(dx, dz);
  const t = Math.max(0, Math.min(1, ((x - w[0]) * dx + (z - w[1]) * dz) / (L * L))), half = width / 2 / L;
  const a = Math.max(0, t - half), b = Math.min(1, t + half), out = [];
  if (a * L >= 0.25) out.push([w[0], w[1], r2(w[0] + dx * a), r2(w[1] + dz * a), w[4]]);
  if ((1 - b) * L >= 0.25) out.push([r2(w[0] + dx * b), r2(w[1] + dz * b), w[2], w[3], w[4]]);
  return out;
}
/** The wall of layout L nearest building-frame point (x, z) within r m: its index, or -1. */
export function wallAt(L, x, z, r = 0.4) {
  let best = -1, bd = r;
  (L.walls || []).forEach((w, i) => { const d = segDist(x, z, w[0], w[1], w[2], w[3]); if (d < bd) { bd = d; best = i; } });
  return best;
}
