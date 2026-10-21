// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing docks' layouts (docs/features/fishing.md §Venues): a beach marina on the sea and a smaller lake dock, both
// world modules (shared/world-modules.js) placed by administrators where land meets water. Everything is in the dock's
// own frame, the same as the airport's (shared/airport-layout.js toWorldAt): s across - +s up the land to the car park and
// the road, −s out over the water - and f along the shore. s = 0 is the bulkhead: the quay wall where the land stops.
//
// The land part is levelled (its pad) a little above the water; the launch ramp is a sloped pad from the land into the
// water; the water under the slips is dredged to a flat basin (a pad below the water). Piers stand on piles over the
// water: their decks are walkable (deck rectangles with heights over the water or the land, some sloped - the pier's
// root up from the promenade, the gangway down to the floating dock). Five boats lie in their slips, bows out to the
// water. The dock store is a real building (a shop with a tackle counter). Shared by the server (checks, pads, walls)
// and the browser (it draws the same rectangles).
import { toWorldAt, toFrame, rectAt } from './airport-layout.js';

/** A deck: [s0, f0, s1, f1, kind, y0, y1, along] - y0/y1 its top at the low and high end along s or f: a number is
 *  metres over the water, { l: n } metres over the land's level. kind: pier (fixed, on piles), head (the pier's T),
 *  gang (gangway), float (floating dock), finger (floating finger between slips), courtesy (by the ramp). */
const D = (s0, f0, s1, f1, kind, y0, y1 = y0, along = 's') => Object.freeze({ s0, f0, s1, f1, kind, y0, y1, along });

export const DOCKS = Object.freeze({
  marina: Object.freeze({
    water: 'sea', boat: 'coastal',
    land: Object.freeze({ s0: 0, s1: 78, f0: -64, f1: 64 }),
    above: Object.freeze([1.2, 3.5]),               // the land's level over the water: least, most
    ramp: Object.freeze({ f0: -58, f1: -44, top: 16, slope: 0.13, toe: 1.6, lanes: 2 }),
    basin: Object.freeze({ s0: -94, s1: -27, f0: -34, f1: 42, depth: 3.2 }),
    open: Object.freeze({ reach: 220, depth: 2.2 }),   // past the basin's mouth, water this deep within this far
    shore: 16,                                         // the water's edge at most this far out from the bulkhead
    decks: Object.freeze([
      D(-8, -6, 0, -2, 'pier', 1.6, { l: 0 }),         // the pier's root: up from the promenade (or down) to the deck
      D(-72, -6, -8, -2, 'pier', 1.6),
      D(-80, -30, -72, -2, 'head', 1.6),               // the pier's head, an L away from the slips (their way out clear): the fuel dock
      D(-33.6, -2, -31.4, 4, 'gang', 1.6, 0.45, 'f'),  // the gangway down to the floating dock
      D(-35, 4, -31, 33.4, 'float', 0.45),             // the floating walkway along the slips
      ...[4.6, 10, 15.4, 20.8, 26.2, 31.6].map(f => D(-46, f, -35, f + 1.2, 'finger', 0.45)),
      D(-24, -43, 0, -41.4, 'courtesy', 0.9, { l: 0 }), // the courtesy dock beside the ramp (its root up to the promenade)
    ]),
    slips: Object.freeze([7.9, 13.3, 18.7, 24.1, 29.5].map((f, k) => Object.freeze({ id: `b${k + 1}`, s: -40.2, f, heading: -Math.PI / 2 }))),
    // walls on the decks and the land (rails along the pier and the promenade's edge; the fuel kiosk; the cleaning
    // station's bench) - [s0, f0, s1, f1, h, base (as a deck's y)]
    walls: Object.freeze([
      [-72, -6.12, -8, -6, 1.05, 1.6], [-72, -2, -35, -1.88, 1.05, 1.6], [-30, -2, -8, -1.88, 1.05, 1.6],
      [-72.12, -30, -72, -6, 1.05, 1.6], [-80, -30.12, -72, -30, 1.05, 1.6], [-80, -2, -72, -1.88, 1.05, 1.6], [-80, -30, -79.88, -16, 1.05, 1.6],
      [-79.2, -27, -77, -24, 2.7, 1.6],                                                                    // the fuel kiosk (boats take fuel alongside the head's open end)
      [-78.45, -28.8, -77.75, -28.2, 1.55, 1.6],                                                           // its pump, on the deck beside it (it stood out over the water)
      [0, -64, 0.14, -58.6, 1.05, { l: 0 }], [0, -43.4, 0.14, -43, 1.05, { l: 0 }], [0, -41.4, 0.14, -6, 1.05, { l: 0 }], [0, -2, 0.14, 64, 1.05, { l: 0 }],   // the promenade's guard rail
      [2.6, -18, 4.4, -11, 0.95, { l: 0 }],                                                                 // the fish-cleaning bench
    ].map(Object.freeze)),
    ladders: Object.freeze([[-50, -6.1], [-79.9, -10], [-20, -1.9]].map(Object.freeze)),
    store: Object.freeze({ s0: 13, f0: 18, s1: 31, f1: 46, face: -1, floors: 1, name: 'Dock Store' }),   // face −1: its door to the water
    // the land: paving [s0, f0, s1, f1, surface] in order (later over earlier; grass is the ground's own), parking bays
    // [s0, s1, f0, f1, bay width, the way they open (+1 / −1 along s), trailer?], lamps [s, f], trees [s, f], benches
    // [s, f, facing (radians from +s)], picnic tables [s, f]
    plan: Object.freeze({
      surfaces: Object.freeze([
        [0, -64, 8, -58.6, 'walk'], [0, -43.4, 8, 64, 'walk'],                      // the promenade along the quay
        [8, -64, 34, -58.6, 'asphalt'], [8, -43.4, 34, -38, 'asphalt'], [16, -58.6, 34, -43.4, 'asphalt'],   // the ramp's approach (round its cut): room to back a trailer
        [8, -38, 34, -34, 'walk'], [8, 6, 34, 64, 'pavers'], [8, -34, 12, 6, 'pavers'], [30, -34, 34, 6, 'pavers'],   // the plaza round the store, the lawn's edges
        [34, -64, 75, 64, 'asphalt'],                                               // the drive and the car park
        [75, 24.4, 78, 35.6, 'asphalt'],                                            // the entrance from the road (as wide as the road: shared/roads.js country)
      ].map(Object.freeze)),
      // the car park (2026-10-15, the product owner: an aisle to every bay, no odd green block, no long double bays):
      // aisles 7 m wide along it (s 34–41 by the plaza, 51–58, 68–75 to the entrance), rows of 5 m bays back to back
      // between them, each opening on to its aisle; cross aisles at both ends and in the middle join the aisles
      bays: Object.freeze([
        ...[[-58, -3], [3, 58]].flatMap(([f0, f1]) => [[41, 46, f0, f1, 2.6, -1], [46, 51, f0, f1, 2.6, 1], [58, 63, f0, f1, 2.6, -1], [63, 68, f0, f1, 2.6, 1]]),
      ].map(Object.freeze)),
      islands: Object.freeze([].map(Object.freeze)),
      // (none in front of the store's porch, f 18 … 46: its door, its sign board)
      lamps: Object.freeze([[5.5, -60], [5.5, -36], [5.5, -24], [5.5, -12], [5.5, 4], [5.5, 15], [5.5, 50], [5.5, 62], [46, -60.5], [46, 0], [46, 60.5], [63, -60.5], [63, 0], [63, 60.5], [33, -40]].map(Object.freeze)),   // (the car park's at its rows' ends)
      trees: Object.freeze([[76.6, -56], [76.6, -38], [76.6, -20], [76.6, -2], [76.6, 16], [76.6, 44], [76.6, 60], [16, -30], [27, -28], [16, 2], [27, 3], [31, 60], [10, 60]].map(Object.freeze)),   // (along its back edge, clear of the entrance)
      benches: Object.freeze([[3.2, -30, Math.PI], [3.2, 0, Math.PI], [3.2, 12, Math.PI], [3.2, 24, Math.PI], [3.2, 50, Math.PI]].map(Object.freeze)),
      picnic: Object.freeze([[18, -22], [24, -14], [18, -6], [25, -2]].map(Object.freeze)),
      lawn: Object.freeze([12, -34, 30, 6]),
      weigh: Object.freeze([4.6, -26]),   // the weigh-in station: a gallows scale and the day's board
    }),
    roadEnd: Object.freeze({ s: 78, f: 30 }),
    door: Object.freeze({ s: 11.5, f: 32 }),
    pad: Object.freeze({ sc: -8, hs: 86, hf: 64 }),    // the whole of it: land and water (−94 … 78)
    size: '170 × 128 m',
  }),
  lakedock: Object.freeze({
    water: 'lake', boat: 'skiff',
    land: Object.freeze({ s0: 0, s1: 46, f0: -34, f1: 34 }),
    above: Object.freeze([0.8, 2.5]),
    ramp: Object.freeze({ f0: -30, f1: -23, top: 10, slope: 0.13, toe: 1.0, lanes: 1 }),
    basin: Object.freeze({ s0: -34, s1: -11, f0: -16, f1: 24, depth: 1.9 }),
    open: Object.freeze({ reach: 70, depth: 1.4 }),
    shore: 10,
    decks: Object.freeze([
      D(-5, -5, 0, -2.6, 'pier', 0.9, { l: 0 }),
      D(-24, -5, -5, -2.6, 'pier', 0.9),
      D(-28, -14, -24, -2.6, 'head', 0.9),
      D(-14.4, -2.6, -12.6, 0, 'gang', 0.9, 0.35, 'f'),
      D(-15, 0, -12, 20.3, 'float', 0.35),
      ...[0.4, 4.2, 8, 11.8, 15.6, 19.4].map(f => D(-22, f, -15, f + 0.9, 'finger', 0.35)),
    ]),
    slips: Object.freeze([2.75, 6.55, 10.35, 14.15, 17.95].map((f, k) => Object.freeze({ id: `b${k + 1}`, s: -17.7, f, heading: -Math.PI / 2 }))),
    walls: Object.freeze([[2.4, -14, 3.8, -9, 0.95, { l: 0 }]].map(Object.freeze)),   // the cleaning bench
    ladders: Object.freeze([[-27.9, -9], [-16, -5.1]].map(Object.freeze)),
    store: Object.freeze({ s0: 9, f0: 8, s1: 19, f1: 22, face: -1, floors: 1, name: 'Bait Shack' }),
    plan: Object.freeze({
      surfaces: Object.freeze([
        [0, -34, 5, -30.6, 'walk'], [0, -22.4, 5, 34, 'walk'],
        [5, -34, 24, -30.6, 'gravel'], [5, -22.4, 24, -20, 'gravel'], [10, -30.6, 24, -22.4, 'gravel'],
        [5, 6, 24, 24, 'pavers'],
        [24, -34, 44, 34, 'asphalt'],
        [44, 12.4, 46, 23.6, 'asphalt'],
      ].map(Object.freeze)),
      // aisles: s 24–31 by the plaza, 39–44 to the entrance; two rows back to back between, cross aisles at the ends
      bays: Object.freeze([[31, 35, -28, 28, 2.6, -1], [35, 39, -28, 28, 2.6, 1]].map(Object.freeze)),
      islands: Object.freeze([].map(Object.freeze)),
      lamps: Object.freeze([[3.5, -18], [3.5, -4], [3.5, 5], [3.5, 26], [35, -29.5], [35, 29.5]].map(Object.freeze)),   // (none in front of the porch, f 8 … 22; the car park's at its row's ends)
      trees: Object.freeze([[45, -30], [45, -14], [45, 2], [45, 30], [12, -12], [21, -2], [8, 30]].map(Object.freeze)),   // (along its back edge, clear of the entrance)
      benches: Object.freeze([[2.2, -12, Math.PI], [2.2, 4, Math.PI], [2.2, 24, Math.PI]].map(Object.freeze)),
      picnic: Object.freeze([[12, -4], [18, -10]].map(Object.freeze)),
      lawn: Object.freeze([5, -20, 24, 6]),
      weigh: Object.freeze([3.4, -6]),
    }),
    roadEnd: Object.freeze({ s: 46, f: 18 }),
    door: Object.freeze({ s: 7.5, f: 15 }),
    pad: Object.freeze({ sc: 5, hs: 41, hf: 34 }),     // (−36 … 46)
    size: '82 × 68 m',
  }),
});
export const isDock = kind => !!DOCKS[kind];

/** The water's level a dock stands on (m.wy, set when it is placed), else the sea's. */
export const waterOf = m => (Number.isFinite(m.wy) ? m.wy : -2.4);
/** A height given as metres over the water (a number) or over the land ({ l }), absolute. */
export const levelAt = (m, v) => (typeof v === 'number' ? waterOf(m) + v : m.y + (v?.l || 0));
/** The ramp's length: from its top at the land's level down into the water to toe metres below it. */
export function rampOf(m) {
  const K = DOCKS[m.kind], R = K.ramp, drop = m.y - (waterOf(m) - R.toe), len = Math.max(8, drop / R.slope);
  return { ...R, s0: R.top - len, s1: R.top, len, y0: waterOf(m) - R.toe, y1: m.y };
}

/** The pads that shape the ground: the ramp (sloped), the land (level), the dredged basin (level, under the water).
 *  Terrain pads: { x, z, hw (along s), hd (along f), rot, y, k (rise a metre along +s) }. The ramp first (it wins
 *  where it cuts into the land). */
/**
 * The dock's outdoor things as the world's own decorations (2026-10-14, the product owner: use the benches the game
 * already has - they work: people sit on them): its benches along the promenade, the picnic tables on its lawn and its
 * trees - [{ t: 'bench' | 'picnic_table' | 'tree', x, z, r }] (r: world yaw; the catalog's bench faces its +z, its length
 * along x: facing a (from +s) is a yaw of rot + a + π/2 - a promenade bench along the quay, looking out over the water).
 * server/world/edit.js makes them with the dock (each marked with its id: mod), moves and removes them with it.
 */
export function dockDecor(m) {
  const P = DOCKS[m.kind]?.plan; if (!P) return [];
  const at = (s, f) => toWorldAt(m, s, f), yaw = a => (((m.rot + a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), r3 = v => Math.round(v * 1000) / 1000, cm = v => Math.round(v * 100) / 100;
  const out = [];
  for (const [s, f, a] of P.benches) { const p = at(s, f); out.push({ t: 'bench', x: cm(p.x), z: cm(p.z), r: r3(yaw(a + Math.PI / 2)) }); }
  for (const [s, f] of P.picnic) { const p = at(s, f); out.push({ t: 'picnic_table', x: cm(p.x), z: cm(p.z), r: r3(yaw(Math.PI / 2)) }); }
  for (const [s, f] of P.trees) { const p = at(s, f); out.push({ t: 'tree', x: cm(p.x), z: cm(p.z), r: 0 }); }
  return out;
}
/** The dock's pads: [the ramp, the land (its gate: shared/world-modules.js worldModulePads), the basin]. */
export function dockPads(m) {
  const K = DOCKS[m.kind], L = K.land, B = K.basin, R = rampOf(m), out = [];
  out.push({ ...rectAt(m, R.s0, R.f0, R.s1, R.f1), y: Math.round(((R.y0 + R.y1) / 2) * 100) / 100, k: R.slope, round: true, dryOnly: true, wy: waterOf(m) });   // (under the water: not drawn - shared/terrain.js undrawn)
  out.push({ ...rectAt(m, L.s0, L.f0, L.s1, L.f1), y: m.y });
  // (the basin's sides slope gently, rounded at its corners - 2026-10-15, polish: a flat hole with 8 m walls showed as a
  // sharp square in the sea, the shallows' foam following its edges)
  out.push({ ...rectAt(m, B.s0, B.f0, B.s1, B.f1), y: Math.round((waterOf(m) - B.depth) * 100) / 100, blend: 24, round: true, undrawn: true });   // (the boats' depth, not the drawn sea floor)
  // the shore in front of the quay, under the pier and the gangway: kept clear of palms and rocks (clear: the ground
  // as it is - shared/terrain.js nearPad only)
  out.push({ ...rectAt(m, B.s1 - 2, L.f0, 0, L.f1), y: m.y, clear: true });
  return out;
}

/** The decks in the world: [{ x, z, hw, hd, rot, y0, y1, along: 's' | 'f', kind, mid }] (y0 at the low end along s/f). */
export function dockDecks(m) {
  const K = DOCKS[m.kind];
  return K.decks.map(d => ({ ...rectAt(m, d.s0, d.f0, d.s1, d.f1), y0: levelAt(m, d.y0), y1: levelAt(m, d.y1), along: d.along, kind: d.kind, mid: m.id }));
}
/** The deck's top at (x, z) (on deck rectangle d, the world's), or null off it (grown by g). */
export function deckTop(d, x, z, g = 0) {
  const dx = x - d.x, dz = z - d.z, c = Math.cos(d.rot), n = Math.sin(d.rot), s = dx * c - dz * n, f = dx * n + dz * c;
  if (Math.abs(s) > d.hw + g || Math.abs(f) > d.hd + g) return null;
  if (d.y0 === d.y1) return d.y0;
  const u = d.along === 'f' ? (Math.max(-d.hd, Math.min(d.hd, f)) + d.hd) / (2 * d.hd) : (Math.max(-d.hw, Math.min(d.hw, s)) + d.hw) / (2 * d.hw);
  return d.y0 + (d.y1 - d.y0) * u;
}
/** The walls on a dock (rails, the kiosk, the cleaning bench): boxes { label, x, z, hw, hd, rot, y0, y1 }. */
export function dockWalls(m) {
  return DOCKS[m.kind].walls.map(([s0, f0, s1, f1, h, base]) => { const y0 = levelAt(m, base); return { label: h > 2 ? 'the fuel kiosk' : h > 1 ? 'a rail' : 'a bench', ...rectAt(m, s0, f0, s1, f1), y0, y1: y0 + h }; });
}
/** The ladders up a fixed pier from the water: [{ x, z, top }] (a swimmer at one climbs out on to the deck). */
export function dockLadders(m) {
  const K = DOCKS[m.kind], fixed = K.decks.find(d => d.kind === 'pier' && typeof d.y0 === 'number');
  return K.ladders.map(([s, f]) => { const p = toWorldAt(m, s, f); return { x: p.x, z: p.z, top: levelAt(m, fixed ? fixed.y0 : 1) }; });
}
/** Where the boats lie: [{ id, x, z, yaw (bow along (sin yaw, cos yaw)), y (the water) }]. */
export function slipsAt(m) {
  const K = DOCKS[m.kind], walk = K.decks.find(d => d.kind === 'float'), wy = waterOf(m);
  return K.slips.map(sl => {
    const p = toWorldAt(m, sl.s, sl.f), d = toWorldAt(m, (walk.s0 + walk.s1) / 2, sl.f);   // (and the floating walkway at its stern: where you step aboard)
    return { id: sl.id, x: p.x, z: p.z, yaw: m.rot + sl.heading, y: wy, deck: { x: d.x, z: d.z, y: wy + walk.y0 } };   // (heading from +f, as the airport's stands: −π/2 is out, −s)
  });
}

/**
 * Where a dock may stand (beyond the general rules of shared/world-modules.js checkWorldModule): its land part on dry,
 * fairly flat land, the water's edge close in front of its bulkhead, its piers and slips over water of its kind (the
 * sea for a marina, one lake for a lake dock), clear water from the basin's mouth out to depth, and on the sea outside
 * the clear water kept in front of protected waterfront. env: { heightAt, waterAt → { kind, level, id } | null,
 * coastWhy?(x, z) }. → a reason, or null; and the water's level (for m.wy).
 */
export function dockWhy(m, env, level = null) {
  const K = DOCKS[m.kind], L = K.land, at = (s, f) => toWorldAt(m, s, f), wet = (s, f) => { const p = at(s, f); return env.waterAt(p.x, p.z); };
  const want = K.water === 'sea' ? 'the sea' : 'a lake';
  // the slips: on the right water
  const mid = K.slips[2], w0 = wet(mid.s, mid.f);
  if (!w0 || w0.kind !== K.water) return { why: `Its slips must be over ${want} - turn its water side to ${want}` };
  const same = w => w && w.kind === K.water && (K.water === 'sea' || w.id === w0.id);
  // the land part: dry (but the strip along the bulkhead, filled in)
  let wetLand = 0, n = 0;
  for (let s = L.s0 + 2; s <= L.s1; s += 6) for (let f = L.f0 + 2; f <= L.f1 - 2; f += 8) { n++; if (wet(s, f)) { if (s > 10) return { why: 'Its car park and store must be on dry land - move it up the shore' }; wetLand++; } }
  if (wetLand > n * 0.25) return { why: 'Too much of its land part is in the water - move it up the shore' };
  // the water's edge: close in front of the bulkhead, along it
  for (const f of [L.f0 + 12, 0, L.f1 - 12]) {
    let edge = null; for (let s = 0; s >= -K.shore; s -= 2) if (wet(s, f)) { edge = s; break; }
    if (edge === null) return { why: `The water is more than ${K.shore} m out from its quay - move it down to the water's edge` };
  }
  // the piers, floats and slips: over the water (the first metres from the bulkhead may be beach)
  for (const d of K.decks) for (const [s, f] of [[d.s0, d.f0], [d.s0, d.f1], [d.s1, d.f0], [d.s1, d.f1], [(d.s0 + d.s1) / 2, (d.f0 + d.f1) / 2]]) {
    if (s > -14) continue;
    if (!same(wet(s, f))) return { why: `Its pier must reach out over ${want} - more water in front of it` };
  }
  // out from the basin's mouth: water all the way, and deep enough within reach (the boats must get out)
  const B = K.basin, fm = (B.f0 + B.f1) / 2;
  let deep = false;
  for (let s = B.s0; s >= B.s0 - K.open.reach; s -= 6) {
    const p = at(s, fm), w = env.waterAt(p.x, p.z);
    if (!same(w)) return { why: 'Land in the way of the boats - its basin must open on to open water' };
    if (w.level - env.heightAt(p.x, p.z) >= K.open.depth) { deep = true; break; }
  }
  if (!deep) return { why: `The water out there is too shallow for boats (${K.open.depth} m needed within ${K.open.reach} m)` };
  if (K.water === 'sea' && env.coastWhy) for (const [s, f] of [[-80, -20], [-80, 12], [B.s0, B.f0], [B.s0, B.f1]]) { const p = at(s, f), why = env.coastWhy(p.x, p.z); if (why) return { why }; }
  return { why: null, level: w0.level, lake: w0.id || null };
}

/**
 * Turns a dock to face its water from where it is put (the placing ghost: point at the shore, it squares itself to it):
 * the direction with the most water close by, the bulkhead moved to the water's edge. → { x, z, rot } or null.
 */
export function fitToShore(kind, x, z, env) {
  const K = DOCKS[kind]; if (!K) return null;
  let best = null;
  for (let k = 0; k < 36; k++) {
    const a = k / 36 * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
    let score = 0;
    for (let r = 10; r <= 90; r += 10) { const w = env.waterAt(x + dx * r, z + dz * r); if (w && w.kind === K.water) score += 1 + Math.min(4, w.level - env.heightAt(x + dx * r, z + dz * r)) * 0.3; }
    if (!best || score > best.score) best = { score, dx, dz };
  }
  if (!best || best.score < 2) return null;
  // the seaward way is −s: (−cos rot, sin rot) = (dx, dz)
  const rot = Math.atan2(best.dz, -best.dx);
  // the quay at the water's edge: from a point on land, out along the seaward way to where the water starts; from one in
  // the water, back up the shore to where it ends
  let edge = 0;
  if (env.waterAt(x, z)) { for (let r = 0; r <= 150; r += 1) if (!env.waterAt(x - best.dx * r, z - best.dz * r)) { edge = -r; break; } }
  else for (let r = 0; r <= 150; r += 1) if (env.waterAt(x + best.dx * r, z + best.dz * r)) { edge = r; break; }
  const at = edge - 1;   // (the quay's face a metre up from the water's edge)
  return { x: x + best.dx * at, z: z + best.dz * at, rot: ((rot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) };
}

export { toWorldAt, toFrame, rectAt };
