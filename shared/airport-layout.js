// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The airport's layout (docs/features/play-modules.md §Airport): everything in the airport's own frame - f forward along
// the runway (its take-off direction), s to the right of it - metres from the runway's centre, which is where an
// administrator places it (shared/world-modules.js gives the frame: x, z, rot; forward is (sin rot, cos rot), right is
// (cos rot, −sin rot), the same as subway stations and the terrain's pads). Airside: the runway, a parallel taxiway with
// three links, the apron with ten stands (3 propeller planes, 3 small jets, 4 helipads). Landside: the terminal (the
// station people walk and drive to), the control tower, a hangar and the car park, whose far side meets the access road.
// Shared by the server (pads, colliders, where the aircraft stand) and the browser (it draws the same rectangles).

export const RUNWAY = Object.freeze({ len: 720, w: 30 });
/** Flat rectangles on the ground: [s0, f0, s1, f1, surface]. Drawn in this order (later ones over earlier). The taxiway
 *  stops short of its ends, where it bends round into its end links (BENDS); the landside is LANDSIDE's. */
export const SURFACES = Object.freeze([
  [-24, -436, 232, 436, 'grass'],
  [-15, -360, 15, 360, 'runway'],
  [47, -322, 63, 322, 'taxiway'],
  [15, -338, 47, -322, 'taxiway'], [15, -8, 47, 8, 'taxiway'], [15, 322, 47, 338, 'taxiway'],
  [63, -175, 150, 175, 'apron'], [150, 93, 152.2, 167, 'apron'],   // (up to the hangar's door)
]);
/** Paving turned round curves, not square corners (2026-10-14: "the corner turns are at 90° … should be curved"). The
 *  taxiway's ends bend round into their links: quarter discs { s, f (centre), r, a0, a1 (angles from +s towards +f) }. */
export const BENDS = Object.freeze([
  { s: 47, f: -322, r: 16, a0: -Math.PI / 2, a1: 0 }, { s: 47, f: 322, r: 16, a0: 0, a1: Math.PI / 2 },
].map(Object.freeze));
/** Fillets in the inside corners where paving meets paving: { s, f (the corner), u, w (unit [s, f] along each edge away
 *  from it), r } - the runway's edge at each link, the taxiway's at each link, the apron's ends. */
const fil = (s, f, u, w, r) => Object.freeze({ s, f, u, w, r });
export const FILLETS = Object.freeze([
  ...[-338, -8, 322].flatMap(f0 => [fil(15, f0, [0, -1], [1, 0], 14), fil(15, f0 + 16, [0, 1], [1, 0], 14)]),
  fil(47, -322, [0, 1], [-1, 0], 9), fil(47, 322, [0, -1], [-1, 0], 9), fil(47, -8, [0, -1], [-1, 0], 10), fil(47, 8, [0, 1], [-1, 0], 10),
  fil(63, -175, [0, -1], [1, 0], 12), fil(63, 175, [0, 1], [1, 0], 12),
]);
/** The landside, s outwards from the terminal's front to the airport's edge (2026-10-14: a new canopy and floor along the
 *  terminal end to end, the car park tied in): the forecourt (paved, under the canopy) to the kerb, the drop-off lane
 *  (under the canopy too), the planted median, the car park (two rows of bays either side of an aisle), a planted verge,
 *  the entrance road from the edge - where the access road meets the airport - through to the drop-off lane. */
export const LANDSIDE = Object.freeze({
  front: 180, kerb: 191, lane: 191.3, median: 199, park: 201.5, parkEnd: 220.6, edge: 232, f0: -95, f1: 45, entry: Object.freeze([-25, -15]),
  rows: Object.freeze([[201.5, 206.9, 1], [213.9, 219.3, -1]].map(Object.freeze)),   // bays: [s0, s1, which way they open (+s / −s)], either side of the aisle
  // (the car park keeps 11 m inside the airport's edge - a verge, a hedge, trees: from afar the ground's coarser mesh
  // over a hillside beyond the edge rose through paving out to the edge, 2026-10-14)
  crossings: Object.freeze([-62, -36, 12]),   // zebra crossings over the drop-off lane (their middles, f)
  canopy: Object.freeze({ f0: -97, f1: 47, s1: 200, y0: 5.4, y1: 6.0, deck: 0.42 }),   // its underside rises 5.4 → 6.0 m outwards
  columns: Object.freeze({ s: 189.4, f: Object.freeze([-93, -81, -65, -49, -33, -17, -1, 15, 31, 43]), branch: 3.6 }),
});
/** Solid buildings: { id, label, s0, f0, s1, f1, h (m tall), roof (m: its flat top for a helicopter), kind }. */
export const STRUCTURES = Object.freeze([
  { id: 'terminal', label: 'Terminal', s0: 150, f0: -95, s1: 180, f1: 45, h: 6.8, kind: 'terminal', building: true },   // a real building (world-modules.js terminalSpec)
  { id: 'tower', label: 'Control tower', s0: 158, f0: 60, s1: 170, f1: 72, h: 30, kind: 'tower' },   // (its two-storey base, 12 m square)
  { id: 'hangar', label: 'Hangar', s0: 152, f0: 95, s1: 190, f1: 165, h: 13, kind: 'hangar' },   // its door faces the apron (−s)
  ...LANDSIDE.columns.f.map((f, k) => ({ id: `col${k + 1}`, label: 'a canopy column', s0: LANDSIDE.columns.s - 0.32, f0: f - 0.32, s1: LANDSIDE.columns.s + 0.32, f1: f + 0.32, h: LANDSIDE.columns.branch, kind: 'column' })),
].map(Object.freeze));
/** Where the aircraft stand: { id, type (prop | jet | heli), s, f, heading (radians in the frame: 0 = along +f) }.
 *  Planes face the taxiway (−s); helicopters stand on helipads. */
const facing = -Math.PI / 2;
export const STANDS = Object.freeze([
  { id: 'p1', type: 'prop', s: 92, f: -158, heading: facing }, { id: 'p2', type: 'prop', s: 92, f: -138, heading: facing }, { id: 'p3', type: 'prop', s: 92, f: -118, heading: facing },
  { id: 'j1', type: 'jet', s: 98, f: -82, heading: facing }, { id: 'j2', type: 'jet', s: 98, f: -50, heading: facing }, { id: 'j3', type: 'jet', s: 98, f: -18, heading: facing },
  { id: 'h1', type: 'heli', s: 112, f: 30, heading: facing }, { id: 'h2', type: 'heli', s: 112, f: 60, heading: facing },
  { id: 'h3', type: 'heli', s: 112, f: 90, heading: facing }, { id: 'h4', type: 'heli', s: 112, f: 120, heading: facing },
].map(Object.freeze));
export const HELIPAD_R = 9;
/** Where people come in: the terminal's doors (landside), and where the access road meets the airport's edge. */
export const DOOR = Object.freeze({ s: 181, f: -25 });
export const ROAD_END = Object.freeze({ s: 232, f: -20 });
/** The levelled pad under all of it (half sizes along s and f, centred at s = PAD.sc). */
export const PAD = Object.freeze({ sc: 104, hs: 128, hf: 436 });   // (the approach lights reach 70 m beyond each end)

/** A point of the frame in the world. */
export function toWorldAt(m, s, f) {
  const c = Math.cos(m.rot), n = Math.sin(m.rot);
  return { x: m.x + s * c + f * n, z: m.z - s * n + f * c };
}
/** A world point in the frame: { s, f }. */
export function toFrame(m, x, z) {
  const dx = x - m.x, dz = z - m.z, c = Math.cos(m.rot), n = Math.sin(m.rot);
  return { s: dx * c - dz * n, f: dx * n + dz * c };
}
/** A frame rectangle as a world pad / box: { x, z, hw (along s), hd (along f), rot }. */
export function rectAt(m, s0, f0, s1, f1) {
  const c = toWorldAt(m, (s0 + s1) / 2, (f0 + f1) / 2);
  return { x: c.x, z: c.z, hw: (s1 - s0) / 2, hd: (f1 - f0) / 2, rot: m.rot };
}
/** What of a standing aircraft people can't walk through: rectangles in its own frame [across0, along0, across1,
 *  along1] (along: towards the nose) - the fuselage, and a low wing (a high wing and a rotor are walked under). */
export const AIRCRAFT_SOLIDS = Object.freeze({
  prop: [[-0.55, -4.2, 0.55, 2.7], [-1.1, 0.4, 1.1, 1.1]],
  jet: [[-0.9, -6.2, 0.9, 6.2], [-6.6, -1.7, 6.6, 1.1], [-1.9, -4.9, 1.9, -2.6]],
  heli: [[-1.15, -1.9, 1.15, 2.8], [-0.35, -7.0, 0.35, -1.9]],
});
/** The stands in the world: [{ id, type, x, z, yaw (world heading: the nose points along (sin yaw, cos yaw)) }]. */
export function standsAt(m) {
  return STANDS.map(st => { const p = toWorldAt(m, st.s, st.f); return { id: st.id, type: st.type, x: p.x, z: p.z, yaw: m.rot + st.heading }; });
}
