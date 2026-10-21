// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// World modules (docs/features/play-modules.md §Placing modules): the big play modules that take up world space — an
// airport; the fishing docks (a beach marina, a lake dock: shared/dock-layout.js, docs/features/fishing.md). Only administrators place them (Edit dock → World modules); the
// small ones that go inside a building are interior modules, which players buy with Virtual Coin for their own places.
// A world module is { id, kind, name, x, z, rot (radians: forward is (sin rot, cos rot)), y (its level ground) }, kept in
// world.worldModules and edited with the wmod.* edit ops (server/world/edit.js: undo, rights, live patches). Each kind
// says how big it is (its pad, levelled like a building's), what stands on it (solid boxes: walls, roofs to land on),
// where people come in (its door, and the end the access road joins), and the play module it runs.
// Shared by the server (checks, pads, colliders) and the browser (the placing ghost gives the same reasons).
import { makeGrid } from './city.js';
import { GROUND_Y } from './constants.js';
import { CATALOG } from './catalog.js';
import { PAD, STRUCTURES, DOOR, ROAD_END, AIRCRAFT_SOLIDS, toWorldAt, toFrame, rectAt, standsAt } from './airport-layout.js';
import { DOCKS, isDock, dockPads, dockDecks, dockWalls, dockWhy, dockLadders, slipsAt, waterOf, deckTop, dockDecor } from './dock-layout.js';
import { roadProfile, profileAt, GATE_EASE } from './island-roads.js';
import { alignmentGeometry, pointAt } from './roads.js';

const cm = v => Math.round(v * 100) / 100;
/** The kinds of world module: what each is, its pad (frame half sizes), its structures and its entrances. */
export const WORLD_KINDS = Object.freeze({
  airport: Object.freeze({
    kind: 'airport', label: 'Airport', icon: '✈️', play: 'airport',
    blurb: 'A runway, taxiway and apron with 10 aircraft (3 propeller planes, 3 small jets, 4 helicopters), a terminal joined to a road, a control tower and a hangar. Players fly the ring courses from here.',
    pad: PAD, structures: STRUCTURES, door: DOOR, roadEnd: ROAD_END, maxSlope: 9, roadReach: 1500,
    size: '720 × 256 m',
  }),
  // the fishing docks: K.dock is the layout (shared/dock-layout.js); the store is the module's building
  marina: Object.freeze({
    kind: 'marina', label: 'Marina', icon: '⚓', play: 'fishing', dock: DOCKS.marina,
    blurb: 'A beach marina on the sea: a two-lane launch ramp, a pier with a fuel dock, a floating dock with 5 fishing boats (4 anglers each), a car park and the Dock Store. Players fish the sea trips from here.',
    pad: DOCKS.marina.pad, structures: [{ id: 'store', label: 'Dock Store', ...storeRect(DOCKS.marina), h: 5.2, kind: 'store', building: true }], door: DOCKS.marina.door, roadEnd: DOCKS.marina.roadEnd, maxSlope: 6, roadReach: 1500,
    size: DOCKS.marina.size,
  }),
  lakedock: Object.freeze({
    kind: 'lakedock', label: 'Lake Dock', icon: '🛶', play: 'fishing', dock: DOCKS.lakedock,
    blurb: 'A lake dock: a launch ramp, a short pier with 5 small boats (2 anglers each), a car park and the Bait Shack. Players fish the lake trips from here.',
    pad: DOCKS.lakedock.pad, structures: [{ id: 'store', label: 'Bait Shack', ...storeRect(DOCKS.lakedock), h: 4.2, kind: 'store', building: true }], door: DOCKS.lakedock.door, roadEnd: DOCKS.lakedock.roadEnd, maxSlope: 5, roadReach: 1500,
    size: DOCKS.lakedock.size,
  }),
});
function storeRect(K) { return { s0: K.store.s0, f0: K.store.f0, s1: K.store.s1, f1: K.store.f1 }; }
/** Whether a kind of module has a building of its own (the airport's terminal, a dock's store). */
export const hasBuilding = m => !!WORLD_KINDS[m?.kind]?.structures.some(S => S.building);
export const WORLD_KIND_IDS = Object.freeze(Object.keys(WORLD_KINDS));
export const modulesOf = world => world?.worldModules || [];

/** A world module from a request: { kind, name, x, z, rot } (or an Error). */
/** The layout version: a module placed under an older one is levelled again when the server starts (2026-10-13 v2: the
 *  pad levels to where its access road meets it, and it is longer, for the approach lights). */
export const LAYOUT_V = 2;
export function normalizeWorldModule(o) {
  const K = WORLD_KINDS[o?.kind];
  if (!K) return new Error('Unknown kind of world module');
  const x = +o.x, z = +o.z, rot = +(o.rot || 0);
  if (![x, z, rot].every(Number.isFinite)) return new Error('Bad position');
  const name = String(o.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
  return { kind: K.kind, name, x: cm(x), z: cm(z), rot: Math.round((((rot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 1000) / 1000 };
}
/** A module's pad (world): { x, z, hw, hd, rot } — hw across the frame (s), hd along it (f). */
export function padOf(m) {
  const P = WORLD_KINDS[m.kind].pad;
  return rectAt(m, P.sc - P.hs, -P.hf, P.sc + P.hs, P.hf);
}
/** A rectangle's corners in the world (grown by g). */
export function rectCorners(r, g = 0) {
  const c = Math.cos(r.rot), n = Math.sin(r.rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const s = a * (r.hw + g), f = b * (r.hd + g); return { x: r.x + s * c + f * n, z: r.z - s * n + f * c }; });
}
/** Whether (x, z) is on rectangle r (grown by g). */
export function inRect(r, x, z, g = 0) {
  const dx = x - r.x, dz = z - r.z, c = Math.cos(r.rot), n = Math.sin(r.rot);
  return Math.abs(dx * c - dz * n) <= r.hw + g && Math.abs(dx * n + dz * c) <= r.hd + g;
}
/** Whether two rectangles overlap (separating axes). */
export function rectsOverlap(a, b, g = 0) {
  const ca = rectCorners(a, g), cb = rectCorners(b, g);
  return ca.some(p => inRect(b, p.x, p.z, g)) || cb.some(p => inRect(a, p.x, p.z, g)) || inRect(a, b.x, b.z, g) || inRect(b, a.x, a.z, g)
    || edgesCross(ca, cb);
}
function edgesCross(A, B) {
  const X = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const a = A[i], b = A[(i + 1) % 4], c = B[j], d = B[(j + 1) % 4];
    if (X(a, b, c) * X(a, b, d) < 0 && X(c, d, a) * X(c, d, b) < 0) return true;
  }
  return false;
}
/** A grid of points over a rectangle, every step metres (its edges included). */
export function sampleRect(r, step = 24) {
  const out = [], ns = Math.max(1, Math.ceil(2 * r.hw / step)), nf = Math.max(1, Math.ceil(2 * r.hd / step)), c = Math.cos(r.rot), n = Math.sin(r.rot);
  for (let i = 0; i <= ns; i++) for (let j = 0; j <= nf; j++) {
    const s = -r.hw + 2 * r.hw * i / ns, f = -r.hd + 2 * r.hd * j / nf;
    out.push({ x: r.x + s * c + f * n, z: r.z - s * n + f * c });
  }
  return out;
}
/** The level a module's pad is graded to: the ground where its access road meets it (the far side of the car park),
 *  so the road arrives level with the car park (2026-10-13: a pad levelled to its runway's ground stood 5 m over the road
 *  beside it). The rest of its land is cut or filled to that (checkWorldModule allows maxSlope). heightAt must not
 *  include this module's own pad. */
export function levelFor(heightAt, m) {
  const K = WORLD_KINDS[m.kind], hs = [];
  for (const df of [-12, -6, 0, 6, 12]) { const p = toWorldAt(m, K.roadEnd.s + 3, K.roadEnd.f + df); hs.push(heightAt(p.x, p.z)); }
  hs.sort((a, b) => a - b);
  return clampLevel(m, cm(hs[2]));
}
/** A dock's land stands a little above its water, whatever the road brings (shared/dock-layout.js above). */
export function clampLevel(m, y) {
  const K = WORLD_KINDS[m.kind];
  if (!K?.dock || !Number.isFinite(m.wy)) return y;
  return cm(Math.max(m.wy + K.dock.above[0], Math.min(m.wy + K.dock.above[1], y)));
}
/** Where the access road starts (the far side of the car park) and the door people walk to, in the world. */
export const roadEndOf = m => toWorldAt(m, WORLD_KINDS[m.kind].roadEnd.s, WORLD_KINDS[m.kind].roadEnd.f);
export const doorOf = m => toWorldAt(m, WORLD_KINDS[m.kind].door.s, WORLD_KINDS[m.kind].door.f);
/** The roads that end where the module's entrance road meets its edge (its access road: replaced when it moves). */
export function accessRoadsOf(world, m) {
  const e = roadEndOf(m), near = p => p && Math.hypot(p.x / 1e6 - e.x, p.z / 1e6 - e.z) < 3;
  return (world?.roads || []).filter(r => near(r.pts?.[0]) || near(r.pts?.[r.pts.length - 1]));
}
/**
 * The module's access road (2026-10-14: "the roadway connection at the entrance doesn't connect well, especially at an
 * angle" — it ran straight to the nearest road at whatever angle, askew to the entrance): it leaves square to the
 * module's edge where the entrance road ends (roadEndOf) — straight on to a road if one lies ahead; else out a little
 * way and one curve round to the nearest road, met square on; else (the road is behind it) out, along the module past
 * its nearer end, and on to the nearest road from there; else out and along beside it (a road climbing alongside the
 * one above it) — curves at each turn, every stretch well clear of the module (more than the road rules ask) and of the
 * other roads until it meets its own. [{ x, z, r? }] in metres (r: the curve's radius there), or null when a road is
 * already there or none is within reach. roads: a RoadNetwork.
 *
 * o.heightAt (and o.level, the module's land's level): the road must lie well between the module's land and the road it
 * joins (2026-10-14: a marina by the sea 20 m below a road 11 m higher got a 20 m road — a wall; 2026-10-15, the product
 * owner: "a slope/elevation parameter needs to be in place so that placing the marina always looks good, and doesn't
 * cause drops, clipping, or roadway disconnections"): each route is profiled as the road will be (lieOf: held level at
 * its gate, eased into its grade, level across its junction) and the first that keeps its grade everywhere and stays
 * within CUT_MAX of the ground is taken — a square junction before a slanting one; when none does, the best, marked
 * .steep = { dh, len, need, cut } (the placing check refuses it: checkWorldModule).
 */
export function accessRoadPath(m, roads, o = {}) {
  const K = WORLD_KINDS[m.kind]; if (!K || !roads) return null;
  const e = roadEndOf(m), near0 = roads.nearest(e.x, e.z, K.roadReach);
  if (!near0 || near0.dist < 2) return null;
  const ox = Math.cos(m.rot), oz = -Math.sin(m.rot), pad = padOf(m), E = { x: e.x, z: e.z }, end = p => ({ x: p.x, z: p.z });   // out of the module (+s)
  const cands = [], level = Number.isFinite(o.level) ? o.level : m.y;
  const lenOf = P => P.reduce((L, p, k) => (k ? L + Math.hypot(p.x - P[k - 1].x, p.z - P[k - 1].z) : 0), 0);
  // the climb it needs: from the land to where it joins, at the gentlest country road's grade (with a margin)
  const needOf = P => { if (!o.heightAt || !Number.isFinite(level)) return 0; const q = P.at(-1); return Math.abs(o.heightAt(q.x, q.z) - level) / (ACCESS_GRADE * 0.85); };
  const pick = () => {
    if (!cands.length) return null;
    if (!o.heightAt || !Number.isFinite(level)) return cands[0];
    let best = null;
    for (const P of cands) {
      const q = P.at(-1), lie = lieOf(P, o.heightAt, level, o.heightAt(q.x, q.z));
      if (lie.ok) return P;
      const bad = Math.max(0, lie.grade / ACCESS_GRADE - 1) + Math.max(0, lie.cut / CUT_MAX - 1);
      if (!best || bad < best.bad) best = { P, bad, lie, dh: Math.abs(o.heightAt(q.x, q.z) - level) };
    }
    const P = best.P;
    P.steep = { dh: Math.round(best.dh * 10) / 10, len: Math.round(lenOf(P)), need: Math.round(needOf(P)), cut: Math.round(best.lie.cut * 10) / 10, grade: Math.round(best.lie.grade * 1000) / 10 };
    return P;
  };
  for (let d = 4, max = Math.min(400, near0.dist * 3 + 60); d <= max; d += 2) {   // a road straight ahead
    const hit = roads.nearest(e.x + ox * d, e.z + oz * d, 1.2);
    if (hit) { cands.push([E, end(hit)]); break; }
  }
  if (cands.length && !o.heightAt) return cands[0];
  // a route through corner points: clear of the module (8 m; but the first 15 m out of its entrance) and of every road
  // but where it meets its own at the end (the road's half width and some), and a curve at each corner that fits its
  // stretches (at least 15 m round, 8 m straight out of the entrance), or null
  const route = corners => {
    const P = [E, ...corners.map(end)], last = P.at(-1), joins = corners.at(-1)?.id;
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i], b = P[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 5));
      for (let k = 0; k <= n; k++) {
        const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n;
        if (Math.hypot(x - e.x, z - e.z) >= 15 && inRect(pad, x, z, 8)) return null;
        if (o.heightAt && Math.hypot(x - last.x, z - last.z) > 14) {   // (across another road on the way; the last leg may run in to its own)
          const hit = roads.nearest(x, z, 9);
          if (hit && (i + 2 < P.length || hit.id !== joins)) return null;
        }
      }
    }
    for (let i = 1; i + 1 < P.length; i++) {
      const a = P[i - 1], c = P[i], b = P[i + 1], la = Math.hypot(c.x - a.x, c.z - a.z), lb = Math.hypot(b.x - c.x, b.z - c.z);
      if (la < 1 || lb < 1) return null;
      const turn = Math.abs(Math.atan2((c.x - a.x) * (b.z - c.z) - (c.z - a.z) * (b.x - c.x), (c.x - a.x) * (b.x - c.x) + (c.z - a.z) * (b.z - c.z)));
      if (turn < 0.06) continue;
      if (turn > 2.6) return null;
      const room = Math.min(i === 1 ? la - 8 : la / 2 - 3, i + 2 === P.length ? lb - 6 : lb / 2 - 3), r = Math.min(60, room / Math.tan(turn / 2));
      if (r < 15) return null;
      P[i] = { ...c, r };
    }
    return P;
  };
  for (const L of [40, 70, 110, 160]) {   // out, then round to the nearest road
    const p1 = { x: e.x + ox * L, z: e.z + oz * L }, near = roads.nearest(p1.x, p1.z, K.roadReach);
    const R = near && route([p1, near]); if (R) { cands.push(R); if (!o.heightAt) return R; }
  }
  // round the module: out, along it past its nearer end (towards the nearest road first), on to the road from there
  const S = K.roadEnd, f0 = toFrame(m, near0.x, near0.z).f, sides = f0 < 0 ? [-1, 1] : [1, -1];
  for (const side of sides) for (const L of [40, 80]) {
    const p1 = toWorldAt(m, S.s + L, S.f), p2 = toWorldAt(m, S.s + L, side * (K.pad.hf + 35)), near = roads.nearest(p2.x, p2.z, K.roadReach);
    const R = near && route([p1, p2, near]); if (R) { cands.push(R); if (!o.heightAt) return R; }
  }
  // (only when the climb counts) out a little and along beside it, gaining height alongside the road above, then up to it
  // (square on to that road where the last bend has room; else meeting it further along, slanting up to it)
  if (o.heightAt) for (const slant of [false, true]) for (const side of sides) for (const D of [90, 140, 200, 260]) for (const L of [24, 30, 38]) {
    const p1 = toWorldAt(m, S.s + L, S.f), p2 = toWorldAt(m, S.s + L, S.f + side * D), ahead = slant ? toWorldAt(m, S.s + L, S.f + side * (D + 45)) : p2, near = roads.nearest(ahead.x, ahead.z, K.roadReach);
    const R = near && route([p1, p2, near]); if (R) cands.push(R);
  }
  return pick() || [E, end(near0)];   // (none of those: straight to the nearest, as before — the road rules will say why not)
}
/** A module's own outdoor things as the world's decorations (a dock's benches, picnic tables, trees: dockDecor). */
export const moduleDecor = m => (isDock(m.kind) ? dockDecor(m) : []);
/** The steepest an access road is laid at (a country road's limit: shared/roads.js); the deepest it cuts into the ground
 *  or stands on a bank (m); how far each end is held level (its gate, its junction). */
const ACCESS_GRADE = 0.09, CUT_MAX = 4, GATE_HOLD = 10, JOIN_HOLD = 14;
/**
 * How a route would lie as a road (shared/island-roads.js roadProfile, as the island will profile it): held at the land's
 * level for its gate and eased into its grade, held at the joined road's level across the junction. → { ok, grade (the
 * steepest between samples: over the limit is a step), cut (the most it stands off the ground, m), len }.
 */
function lieOf(P, heightAt, level, joinY) {
  const um = v => Math.round(v * 1e6);
  let G;
  try { G = alignmentGeometry({ id: 'probe', profile: 'country', pts: P.map(p => (p.r ? { x: um(p.x), z: um(p.z), r: um(p.r) } : { x: um(p.x), z: um(p.z) })) }); } catch { return { ok: false, grade: 1, cut: 99, len: 0 }; }
  const L = G.length, gate = Math.min(GATE_HOLD, L / 3), join = Math.min(JOIN_HOLD, L / 3);
  const prof = roadProfile(G, (x, z) => heightAt(x, z), { maxGrade: ACCESS_GRADE, fixed: [{ s0: 0, s1: gate, y: level, ease: GATE_EASE }, { s0: L - join, s1: L, y: joinY }] });
  let grade = 0, cut = 0;
  for (let i = 1; i < prof.y.length; i++) grade = Math.max(grade, Math.abs(prof.y[i] - prof.y[i - 1]) / prof.d);
  const q = {};
  for (let s = gate; s <= L - join; s += 4) { pointAt(G, s, q); cut = Math.max(cut, Math.abs(profileAt(prof, s) - heightAt(q.x, q.z))); }
  return { ok: grade <= ACCESS_GRADE * 1.02 && cut <= CUT_MAX, grade, cut, len: L };
}
/** The level a module's land will stand at, placed as it is (for its access road's climb). */
export function placeLevel(m, env) {
  const K = WORLD_KINDS[m.kind]; if (!K || !env?.heightAt) return null;
  if (K.dock) { if (!env.waterAt) return null; const r = dockWhy(m, env); return r.why ? null : levelFor(env.heightAt, { ...m, wy: r.level }); }
  return levelFor(env.heightAt, m);
}
/** The module (of the world) at (x, z), within g metres of its pad, or null. */
export function moduleAt(world, x, z, g = 0) {
  for (const m of modulesOf(world)) if (WORLD_KINDS[m.kind] && inRect(padOf(m), x, z, g)) return m;
  return null;
}
/** The pads to level (shared/island-build.js buildingPads takes these too). */
export function worldModulePads(world) {
  const out = [];
  for (const m of modulesOf(world)) {
    if (!WORLD_KINDS[m.kind] || !Number.isFinite(m.y)) continue;
    // a module's land carries its gate: where its access road meets it, at its level (shared/island-roads.js holds the
    // road there level with the land — 2026-10-14, the product owner: the docks' roads "don't connect well")
    // (y: its paving's top, 3.5 cm under the module's level — server/world/edit.js roadLevel reads it back as m.y)
    const e = roadEndOf(m), gate = { x: Math.round(e.x * 100) / 100, z: Math.round(e.z * 100) / 100, y: Math.round((m.y - 0.035) * 1000) / 1000 };
    if (isDock(m.kind)) { const P = dockPads(m); P[1].gate = gate; out.push(...P); }   // its land, its ramp into the water, its dredged basin
    else out.push({ ...padOf(m), y: m.y, gate });
  }
  return out;
}
/** The solid boxes standing on the modules: [{ id, mid, label, x, z, hw, hd, rot, y0, y1 }] (walls to walk and drive
 *  round, roofs a helicopter lands on). */
export function moduleBoxes(world) {
  const out = [];
  for (const m of modulesOf(world)) {
    const K = WORLD_KINDS[m.kind]; if (!K || !Number.isFinite(m.y)) continue;
    for (const S of K.structures) if (!S.building) out.push({ id: S.id, mid: m.id, label: S.label, ...rectAt(m, S.s0, S.f0, S.s1, S.f1), y0: m.y, y1: m.y + S.h });   // (the terminal is a building of its own)
    if (K.dock) dockWalls(m).forEach((w, k) => out.push({ id: `w${k}`, mid: m.id, ...w }));   // a dock's rails, kiosk and bench
  }
  return out;
}
/** The decks people walk on over the water (a dock's piers, gangways, floating docks): shared/dock-layout.js deckTop. */
export function moduleDecks(world) {
  const out = [];
  for (const m of modulesOf(world)) if (WORLD_KINDS[m.kind]?.dock && Number.isFinite(m.y)) out.push(...dockDecks(m));
  return out;
}
/** The ladders out of the water on to the docks' piers: [{ x, z, top }]. */
export function moduleLadders(world) {
  const out = [];
  for (const m of modulesOf(world)) if (WORLD_KINDS[m.kind]?.dock && Number.isFinite(m.y)) out.push(...dockLadders(m));
  return out;
}
/** The highest deck under (x, z) that feet at y can stand on (its top no higher than a step above them, no lower than
 *  3 m under them: a swimmer under a pier is not on it): its top, or null. decks: moduleDecks(). */
export function deckUnder(decks, x, z, y, step = 0.36) {
  let best = null;
  for (const d of decks) {
    if (Math.abs(x - d.x) > d.hw + d.hd || Math.abs(z - d.z) > d.hw + d.hd) continue;
    const t = deckTop(d, x, z); if (t === null || t > y + step || t < y - 3) continue;
    if (best === null || t > best) best = t;
  }
  return best;
}
/** The boats lying in every dock's slips: [{ id: '<module>:<slip>', module, kind ('coastal' | 'skiff'), x, z, yaw, y }]. */
export function boatSlips(world) {
  const out = [];
  for (const m of modulesOf(world)) { const K = WORLD_KINDS[m.kind]; if (K?.dock && Number.isFinite(m.y)) for (const s of slipsAt(m)) out.push({ ...s, id: `${m.id}:${s.id}`, module: m.id, kind: K.dock.boat }); }
  return out;
}
/** The aircraft standing at every airport: [{ id: '<module>:<stand>', module, type, x, z, y, yaw }]. */
export function aircraftStands(world) {
  const out = [];
  for (const m of modulesOf(world)) if (m.kind === 'airport' && Number.isFinite(m.y)) for (const s of standsAt(m)) out.push({ ...s, id: `${m.id}:${s.id}`, module: m.id, y: m.y });
  return out;
}
/** What of the standing aircraft people can't walk through: [{ x, z, rot, rect, stand }] (shared/geom.js inItemRect's
 *  form). skip: stand ids whose aircraft is away (being flown). */
export function aircraftSolids(world, skip = null) {
  const out = [];
  for (const s of aircraftStands(world)) {
    if (skip?.has(s.id)) continue;
    for (const rect of AIRCRAFT_SOLIDS[s.type] || []) out.push({ x: s.x, z: s.z, rot: s.yaw, rect, stand: s.id });
  }
  return out;
}
/**
 * A module's own building (server/world/generate.js createBuilding), on the module's level, its length along f: an
 * airport's terminal (a two-floor glass hall, its front — local +z, the door — facing the car park, +s), a dock's store
 * (a one-floor shop with a tackle counter, its door to the water, −s).
 */
export function terminalSpec(m) {
  const K = WORLD_KINDS[m.kind], T = K?.structures.find(S => S.building);
  if (!T || !Number.isFinite(m.y)) return null;
  const c = toWorldAt(m, (T.s0 + T.s1) / 2, (T.f0 + T.f1) / 2), w = T.f1 - T.f0, d = T.s1 - T.s0, face = K.dock ? K.dock.store.face : 1;
  const rot = ((Math.round(m.rot * 180 / Math.PI) + (face > 0 ? 90 : 270)) % 360 + 360) % 360;
  const at = { block: null, rot, base: Math.round((m.y - GROUND_Y) * 100) / 100, module: m.id, rect: { x0: c.x - w / 2, x1: c.x + w / 2, z0: c.z - d / 2, z1: c.z + d / 2 } };
  if (K.dock) return { ...at, type: 'shop', floors: K.dock.store.floors, style: 'classic', tackle: true, sign: K.dock.store.name, name: `${m.name || K.label} ${K.dock.store.name}` };
  const name = String(m.name || K.label).slice(0, 28);   // one name: the terminal's, its sign's, the canopy's, the entrance sign's
  return { ...at, type: 'terminal', floors: 2, style: 'glass', name, sign: name };
}
export { toFrame };
export { DOCKS, isDock, dockWhy, waterOf, deckTop };

/**
 * Why module m can't stand there, or null. env: { heightAt, isWater, roads (a RoadNetwork) }; lotsUnder(corners) → the
 * lots under a world polygon (optional, the server's: land made into lots is never built over); ignoreId: the module
 * being moved.
 */
export function checkWorldModule(world, m, env, { ignoreId = null, lotsUnder = null } = {}) {
  const K = WORLD_KINDS[m.kind]; if (!K) return 'Unknown kind of world module';
  const pad = padOf(m), corners = rectCorners(pad), g = makeGrid(world.grid), a = /^[aeiou]/i.test(K.label) ? 'an' : 'a';
  if (corners.some(p => p.x >= g.minX - 20 && p.x <= g.maxX + 20 && p.z >= g.minZ - 20 && p.z <= g.maxZ + 20) || inRect(pad, (g.minX + g.maxX) / 2, (g.minZ + g.maxZ) / 2))
    return `Too close to the city; ${a} ${K.label.toLowerCase()} needs open land beyond it`;
  let pts = sampleRect(pad), level;
  if (K.dock) {   // half on the land, half over the water (shared/dock-layout.js): its own rules, the land part flat enough
    if (!env.waterAt) return 'The water can\'t be read here';
    const r = dockWhy(m, env); if (r.why) return r.why;
    const L = K.dock.land; pts = sampleRect(rectAt(m, L.s0 + 8, L.f0, L.s1, L.f1), 12);
    level = levelFor(env.heightAt, { ...m, wy: r.level });
  } else {
    if (pts.some(p => env.isWater(p.x, p.z))) return 'Part of it is in the water';
    level = levelFor(env.heightAt, m);
  }
  let off = 0; for (const p of pts) off = Math.max(off, Math.abs(env.heightAt(p.x, p.z) - level));
  if (off > K.maxSlope) return `The ground rises or falls ${off.toFixed(0)} m across it; find flatter land (at most ${K.maxSlope} m)`;
  if (env.roads) {
    const hit = env.roads.corridorHits(rectCorners(pad, 2))[0];
    if (hit) return `${env.roads.get(hit.id)?.name || 'A road'} runs through it; place it beside the road`;
  }
  for (const B of world.buildings || []) {
    if (!B || B.gone || (B.module && B.module === ignoreId)) continue;   // (its own terminal, when it moves)
    if (rectsOverlap(pad, { x: B.x, z: B.z, hw: B.w / 2, hd: B.d / 2, rot: (B.rot || 0) * Math.PI / 180 }, 4)) return `${B.name || 'A building'} is in the way`;
  }
  for (const d of world.decorations || []) if ((!d.mod || d.mod !== ignoreId) && inRect(pad, d.x, d.z, 2)) return `A ${(CATALOG[d.t]?.name || 'decoration').toLowerCase()} is in the way; move it first`;   // (its own benches and trees, when it moves)
  for (const s of world.stations || []) if (inRect(pad, s.x, s.z, 6)) return `${s.name} station is in the way`;
  for (const o of modulesOf(world)) {
    if (o.id === ignoreId || !WORLD_KINDS[o.kind]) continue;
    if (rectsOverlap(pad, padOf(o), 30)) return `Too close to ${o.name || WORLD_KINDS[o.kind].label}`;
  }
  if (lotsUnder && lotsUnder(rectCorners(pad, 2)).length) return `There are lots on that land; ${a} ${K.label.toLowerCase()} goes on open land`;
  if (env.roads) {
    const e = roadEndOf(m), near = env.roads.nearest(e.x, e.z, K.roadReach);
    if (!near) return `No road within ${(K.roadReach / 1000).toFixed(1)} km; its car park must be joined to a road`;
    // its access road must be able to climb from its land to the road it joins (2026-10-14: a marina's 20 m wall of a road)
    const R = accessRoadPath(m, env.roads, { heightAt: env.heightAt, level });
    if (R?.steep) return R.steep.grade > ACCESS_GRADE * 102 ? `The nearest road is ${R.steep.dh} m ${env.heightAt(R.at(-1).x, R.at(-1).z) > level ? 'above' : 'below'} its land: its road can't climb that cleanly (about ${R.steep.need} m of road needed; the best way here is ${R.steep.len} m) — place it where the shore is lower or the road further off`
      : `Its road would cut ${R.steep.cut} m into the ground (or stand that high on a bank) on its way to the nearest road — place it where the land between is flatter`;
  }
  return null;
}
