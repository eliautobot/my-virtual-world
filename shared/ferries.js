// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Ferries (WP4.15/4.9/4.5, wp4-world-spec.md §3.4, §6.5): scheduled boats between two docks, on the shared timetable.
// An administrator draws a line over the water: its first and last points are the docks (a pier runs from the nearest
// shore to each), the points between are where it turns; the boat rounds them in arcs. One to three boats shuttle on
// it, each waiting DWELL s at a dock; where every boat is at any moment follows from the simulation clock alone, so the
// browsers draw them and residents board and leave them at the same times (server/sim: a ferry crossing is a hidden
// ride from dock to dock, as the subway is). Docks need water deep enough for the boat, a shore within PIER_MAX m with
// a road near it, and - on the sea - a growth coast (as bridges do).
import { growthAt, landOf } from './coasts.js';
import { inFootprint } from './geom.js';

export const FERRY = Object.freeze({ DRAFT: 2.5, SPEED: 9, DWELL: 45, MIN_LEN: 150, MAX_LEN: 12000, PIER_MAX: 400, ROAD_REACH: 250, DECK: 1.3, TURN_R: 90, MAX_PTS: 40 });
export const FERRY_ID = /^fy-\d{1,6}$/;
const r2 = v => Math.round(v * 100) / 100;
const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** A ferry line from a request, normalised, or an Error with the reason. */
export function normalizeFerry(input) {
  if (!input || typeof input !== 'object') return new Error('Bad ferry line');
  const id = String(input.id || ''), name = String(input.name ?? '').trim().slice(0, 40) || 'Ferry';
  if (!FERRY_ID.test(id)) return new Error('Bad ferry id');
  if (!Array.isArray(input.pts) || input.pts.length < 2 || input.pts.length > FERRY.MAX_PTS) return new Error(`A ferry line has 2 to ${FERRY.MAX_PTS} points`);
  const pts = [];
  for (const p of input.pts) {
    const x = Number(p?.x), z = Number(p?.z);
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 1e6 || Math.abs(z) > 1e6) return new Error('Bad ferry point');
    pts.push({ x: r2(x), z: r2(z) });
  }
  const boats = Math.max(1, Math.min(3, Math.round(Number(input.boats) || 1)));
  return { id, name, pts, boats };
}
export function nextFerryId(list) { let n = 0; for (const f of list || []) { const m = /^fy-(\d+)$/.exec(f.id); if (m) n = Math.max(n, +m[1]); } return `fy-${n + 1}`; }

// ---------------------------------------------------------------- the route the boat follows
const paths = new WeakMap();
/** The boat's route: the line with its corners rounded (arcs of up to TURN_R m), sampled every few metres.
 *  { x, z (Float64Array), s (distance along), length }. */
export function ferryPath(f) {
  let P = paths.get(f); if (P) return P;
  const pts = f.pts, X = [pts[0].x], Z = [pts[0].z];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1], la = hyp(a.x, a.z, b.x, b.z), lc = hyp(b.x, b.z, c.x, c.z);
    const cut = Math.min(FERRY.TURN_R, la / 2, lc / 2);
    if (cut < 1) { X.push(b.x); Z.push(b.z); continue; }
    const p0 = { x: b.x + (a.x - b.x) * cut / la, z: b.z + (a.z - b.z) * cut / la }, p1 = { x: b.x + (c.x - b.x) * cut / lc, z: b.z + (c.z - b.z) * cut / lc };
    for (let k = 0; k <= 8; k++) { const t = k / 8, u = 1 - t; X.push(u * u * p0.x + 2 * u * t * b.x + t * t * p1.x); Z.push(u * u * p0.z + 2 * u * t * b.z + t * t * p1.z); }
  }
  X.push(pts.at(-1).x); Z.push(pts.at(-1).z);
  // resample evenly (every ~5 m) so positions along it are cheap
  const raw = [0]; for (let i = 1; i < X.length; i++) raw.push(raw[i - 1] + hyp(X[i - 1], Z[i - 1], X[i], Z[i]));
  const L = raw.at(-1), n = Math.max(2, Math.ceil(L / 5)), x = new Float64Array(n + 1), z = new Float64Array(n + 1);
  for (let k = 0, i = 0; k <= n; k++) {
    const s = L * k / n; while (i < raw.length - 2 && raw[i + 1] < s) i++;
    const t = raw[i + 1] > raw[i] ? (s - raw[i]) / (raw[i + 1] - raw[i]) : 0;
    x[k] = X[i] + (X[i + 1] - X[i]) * t; z[k] = Z[i] + (Z[i + 1] - Z[i]) * t;
  }
  P = { x, z, n, length: L };
  paths.set(f, P);
  return P;
}
/** Position and heading at distance s along the route. */
export function along(P, s, out = {}) {
  const u = Math.max(0, Math.min(1, s / (P.length || 1))) * P.n, k = Math.min(P.n - 1, Math.floor(u)), t = u - k;
  out.x = P.x[k] + (P.x[k + 1] - P.x[k]) * t; out.z = P.z[k] + (P.z[k + 1] - P.z[k]) * t;
  out.yaw = Math.atan2(P.x[k + 1] - P.x[k], P.z[k + 1] - P.z[k]);
  return out;
}

// ---------------------------------------------------------------- the timetable (simulation seconds)
const phaseOf = id => { let h = 2166136261; for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
/** { cross (s on the water), dwell, cycle (a boat's round trip), boats, headway (between sailings from one dock), phase } */
export function timetable(f) {
  const cross = ferryPath(f).length / FERRY.SPEED, dwell = FERRY.DWELL, cycle = 2 * (cross + dwell), boats = f.boats || 1;
  return { cross, dwell, cycle, boats, headway: cycle / boats, phase: phaseOf(f.id) * cycle };
}
const mod = (a, n) => ((a % n) + n) % n;
/** Boat k at simulation time t: { x, z, yaw, sailing (0/1), at ('a' | 'b' | null), p (0..1 along the crossing) }. */
export function boatAt(f, k, t, out = {}) {
  const T = timetable(f), P = ferryPath(f), u = mod(t - T.phase + k * T.cycle / T.boats, T.cycle);
  const ease = p => p - Math.sin(2 * Math.PI * p) / (2 * Math.PI);   // gentle start and stop, the same mean speed
  if (u < T.dwell) { along(P, 0, out); out.sailing = 0; out.at = 'a'; out.p = 0; }
  else if (u < T.dwell + T.cross) { const p = (u - T.dwell) / T.cross; along(P, ease(p) * P.length, out); out.sailing = 1; out.at = null; out.p = p; }
  else if (u < 2 * T.dwell + T.cross) { along(P, P.length, out); out.sailing = 0; out.at = 'b'; out.p = 1; out.yaw += Math.PI; }
  else { const p = (u - 2 * T.dwell - T.cross) / T.cross; along(P, (1 - ease(p)) * P.length, out); out.yaw += Math.PI; out.sailing = 1; out.at = null; out.p = 1 - p; }
  return out;
}
/** The next sailing from dock e ('a' first point, 'b' last) leaving at or after t: { depart, arrive } (simulation s). */
export function nextSailing(f, e, t) {
  const T = timetable(f), leave = e === 'a' ? T.dwell : 2 * T.dwell + T.cross;   // where in a boat's cycle it leaves e
  let best = Infinity;
  for (let k = 0; k < T.boats; k++) {
    const base = T.phase - k * T.cycle / T.boats + leave, n = Math.ceil((t - base) / T.cycle);
    best = Math.min(best, base + n * T.cycle);
  }
  return { depart: best, arrive: best + T.cross };
}

// ---------------------------------------------------------------- docks and the rules
/** Water at (x, z) for a boat: { kind, level, depth } or null (land, or a causeway across a lake). */
export function waterFor(island, x, z) {
  const b = island.baseHeight(x, z), sea = island.p.seaLevel;
  if (b < sea) return { kind: 'sea', level: sea, depth: sea - b };
  const w = island.waterAt(x, z);
  return w && w.kind !== 'sea' ? { kind: w.kind, level: w.level, depth: w.level - b } : null;
}
/** The shore a dock's pier runs to (within PIER_MAX m), or null: straight towards where the seabed rises fastest (or a
 *  little either side, whichever reaches dry land first). Gently shelving beaches make long piers. */
export function landing(island, x, z) {
  const dry = (px, pz) => !waterFor(island, px, pz);
  if (dry(x, z)) return null;
  let best = -Infinity, dir = 0;
  for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, h = island.baseHeight(x + Math.cos(a) * 40, z + Math.sin(a) * 40); if (h > best) { best = h; dir = a; } }
  let hit = null;
  for (const da of [0, -0.35, 0.35, -0.7, 0.7]) {
    const c = Math.cos(dir + da), sn = Math.sin(dir + da);
    for (let r = 4; r <= FERRY.PIER_MAX && (!hit || r < hit.r); r += 4) if (dry(x + c * r, z + sn * r)) { hit = { x: x + c * r, z: z + sn * r, r }; break; }
  }
  return hit ? { x: r2(hit.x), z: r2(hit.z) } : null;
}
/** Both docks: [{ dock: { x, z }, land: { x, z } | null, level (water surface m), deck (m) }] for the first and last point. */
export function docksOf(f, island) {
  return [f.pts[0], f.pts.at(-1)].map(p => { const w = waterFor(island, p.x, p.z), level = w ? w.level : island.p.seaLevel; return { dock: { x: p.x, z: p.z }, land: landing(island, p.x, p.z), level, deck: level + FERRY.DECK }; });
}
/**
 * Why ferry line f can't run, or null. env: { island (shared/terrain.js Island), roads (RoadNetwork of the roads beyond
 * the city, or null), city: { x0, z0, x1, z1 } (m), buildings: [], lots: [{ id, poly (µm) }] }.
 */
export function ferryWhy(f, env) {
  const { island } = env, P = ferryPath(f), a = f.pts[0], b = f.pts.at(-1);
  if (P.length < FERRY.MIN_LEN || hyp(a.x, a.z, b.x, b.z) < FERRY.MIN_LEN) return `The docks are less than ${Math.round(FERRY.MIN_LEN / 0.3048)} ft apart`;
  if (P.length > FERRY.MAX_LEN) return `A ferry line is at most ${(FERRY.MAX_LEN / 1609.34).toFixed(1)} miles long`;
  const c = env.city;
  for (let k = 0; k <= P.n; k++) {
    const x = P.x[k], z = P.z[k];
    if (c && x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return 'A ferry line keeps out of the city';
    const w = waterFor(island, x, z);
    if (!w) return k === 0 || k === P.n ? 'A dock goes in the water, a short way off the shore' : 'The line crosses land; turn it round the coast';
    if (w.depth < FERRY.DRAFT) return `The water is only ${w.depth.toFixed(1)} m deep ${k === 0 || k === P.n ? 'at the dock' : 'on the way'}; the boats need ${FERRY.DRAFT} m`;
  }
  for (const [i, D] of docksOf(f, island).entries()) {
    const which = i ? 'The second dock' : 'The first dock';
    if (!D.land) return `${which} is more than ${Math.round(FERRY.PIER_MAX / 0.3048)} ft from the shore`;
    const w = waterFor(island, D.dock.x, D.dock.z);
    if (w?.kind === 'sea' && landOf(island, D.land.x, D.land.z, 0.3) && !growthAt(island, D.land.x, D.land.z)) return `${which} is not on a growth coast; ferries dock at one (mark the coast there as one first)`;
    if (env.roads && !env.roads.nearest(D.land.x, D.land.z, FERRY.ROAD_REACH)) return `No road comes within ${Math.round(FERRY.ROAD_REACH / 0.3048)} ft of ${which.toLowerCase()}; build one to the shore first`;
    for (const B of env.buildings || []) if (B && !B.gone && inFootprint(B, D.land.x, D.land.z, 1)) return `${which}'s pier lands on ${B.name || 'a building'}`;
    for (const L of env.lots || []) if (inPoly(L.poly, D.land.x * 1e6, D.land.z * 1e6)) return `${which}'s pier lands on lot ${L.id}`;
  }
  return null;
}
function inPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
