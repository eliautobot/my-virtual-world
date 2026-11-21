// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Where people sit in a vehicle, found in the vehicle's own model (2026-11-16, the product owner: "the driver should be
// visible, and other companions aswell. so they are visible on the seat"). The Classic models are vendored unchanged
// (vehicles-classic/PROVENANCE.json pins them), so the seats are not written down a second time here: they are read off
// each model's interior as built, in the asset's own frame (render/vehicle-assets.js: +Z forward, +X the vehicle's left,
// y up from the ground, metres). A seat is a cushion (a flat slab) with a backrest standing at its back edge; a bench
// is split into places by its headrests; the driver is the place behind the steering wheel (the one ring-shaped part of
// a cabin). Rays from each place find the roof lining over it, the floor in front of it and the door beside it, so the
// people put there (render/car-occupants.js) can be fitted to the room each seat really has.
import * as THREE from 'three';

// What counts as a cushion, a backrest, a headrest and a steering wheel (metres, in the asset's frame): ordinary car
// and bus parts, loose enough for every model, tight enough that a dashboard or a crate is none of them.
const CUSHION = { h: [0.08, 0.32], depth: [0.3, 0.8], width: [0.35, 1.6] };
const BACKREST = { minH: 0.35, maxDepth: 0.32 };
const HEADREST = { maxWidth: 0.4, maxH: 0.3 };
const WHEEL = { minTris: 100, size: [0.18, 0.5], maxDepth: 0.1 };
const PLACE_W = 0.6;   // a bench with no headrests: one place per this much of its width

/** Connected parts of a non-indexed triangle soup (triangles sharing a corner), each with its bounds. */
function partsOf(geometry) {
  const p = geometry.attributes.position, nt = p.count / 3;
  const parent = new Int32Array(nt).map((_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const owner = new Map(), key = i => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const kk = key(t * 3 + k), o = owner.get(kk);
    if (o === undefined) owner.set(kk, t);
    else { const a = find(o), b = find(t); if (a !== b) parent[a] = b; }
  }
  const parts = new Map(), v = new THREE.Vector3();
  for (let t = 0; t < nt; t++) {
    const r = find(t);
    let P = parts.get(r);
    if (!P) parts.set(r, P = { tris: 0, box: new THREE.Box3() });
    P.tris++;
    for (let k = 0; k < 3; k++) P.box.expandByPoint(v.fromBufferAttribute(p, t * 3 + k));
  }
  return [...parts.values()].map(P => ({ ...P, size: P.box.getSize(new THREE.Vector3()), centre: P.box.getCenter(new THREE.Vector3()) }));
}
const within = (v, [lo, hi]) => v >= lo && v <= hi;
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * The seats of a vehicle. interior: its cabin's geometry in the asset's frame (non-indexed, as the Classic batches are);
 * solid: an Object3D of the whole vehicle in the same frame (what the rays hit). Returns the places in boarding order —
 * the driver, the front passenger, then row by row toward the back, the driver's side first — each
 * { role: 'driver' | 'passenger', row, side (+1 the left, -1 the right), x, top (the cushion's top), back (z of the
 *   backrest's face 0.12 m over the cushion), tilt (how its face leans back higher up: metres in z per metre up), front
 *   (z of the cushion's front edge), room (its share of the cushion's width), lining (y of the roof lining over the
 *   head), floor (y of the floor in front), wallIn (x distance to the door's inside face), wheel ({ x, y, z, r } for the
 *   driver) }.
 */
export function findVehicleSeats(interior, solid) {
  const parts = partsOf(interior), boxes = parts.filter(p => p.tris === 12);
  const wheels = parts.filter(p => p.tris >= WHEEL.minTris && p.size.z <= WHEEL.maxDepth && within(p.size.x, WHEEL.size) && Math.abs(p.size.x - p.size.y) < 0.05);
  const seats = [];
  for (const c of boxes) {
    const s = c.size;
    if (!within(s.y, CUSHION.h) || !within(s.z, CUSHION.depth) || !within(s.x, CUSHION.width)) continue;
    const top = c.box.max.y;
    // its backrest: tall and thin, across most of its width, standing at its back edge (the vehicle faces +Z)
    const back = boxes.find(b => b !== c && b.size.y >= BACKREST.minH && b.size.z <= BACKREST.maxDepth
      && overlap(b.box.min.x, b.box.max.x, c.box.min.x, c.box.max.x) > 0.6 * s.x
      && within(b.box.min.y, [top - 0.2, top + 0.12]) && within(b.centre.z, [c.box.min.z - 0.3, c.box.min.z + 0.15]));
    if (!back) continue;
    const heads = boxes.filter(h => h !== back && h !== c && h.size.x <= HEADREST.maxWidth && h.size.y <= HEADREST.maxH
      && within(h.box.min.y, [back.box.max.y - 0.2, back.box.max.y + 0.2]) && within(h.centre.x, [c.box.min.x, c.box.max.x])
      && Math.abs(h.centre.z - back.centre.z) < 0.25);
    let xs;
    if (heads.length >= 2) xs = heads.map(h => h.centre.x);
    else if (s.x > 2 * PLACE_W - 0.1) { const n = Math.round(s.x / PLACE_W); xs = Array.from({ length: n }, (_, k) => c.box.min.x + (k + 0.5) * s.x / n); }
    else xs = [c.centre.x];
    const room = s.x / xs.length;
    for (const x of xs) seats.push({ x, top, cushion: c, backrest: back, room, z: c.centre.z });
  }
  // rows: front to back (cushions whose middles are within 0.3 m of each other share a row)
  seats.sort((a, b) => b.z - a.z);
  let row = -1, rowZ = Infinity;
  for (const s of seats) { if (rowZ - s.z > 0.3) { row++; rowZ = s.z; } s.row = row; }
  // the driver: the place a steering wheel is in front of (the nearest such, by its middle)
  let driver = null;
  for (const w of wheels) {
    let best = null, bd = Infinity;
    for (const s of seats) {
      if (w.centre.z <= s.cushion.box.max.z - 0.05 || Math.abs(w.centre.x - s.x) > 0.25) continue;
      const d = Math.hypot(w.centre.x - s.x, w.centre.z - s.cushion.box.max.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (best && (!driver || bd < driver.d)) driver = { s: best, w, d: bd };
  }
  const ray = new THREE.Raycaster(), o = new THREE.Vector3(), dir = new THREE.Vector3();
  const hit = (x, y, z, dx, dy, dz, far = 4) => {
    ray.set(o.set(x, y, z), dir.set(dx, dy, dz)); ray.far = far;
    const h = ray.intersectObject(solid, true).find(q => q.object.name !== 'wheel' && !q.object.material?.transparent);
    return h ? h.distance : Infinity;
  };
  const dSide = driver ? Math.sign(driver.s.x) || 1 : 1;
  const out = seats.map(s => {
    const c = s.cushion.box, mid = (c.min.z + c.max.z) / 2;
    // the backrest's face just over the cushion, and how it leans back higher up (at the shoulders)
    const back = mid - hit(s.x, s.top + 0.12, mid, 0, 0, -1, 1.5), high = mid - hit(s.x, s.top + 0.45, mid, 0, 0, -1, 1.5);
    const tilt = Number.isFinite(high) ? Math.max(-0.6, Math.min(0.1, (high - back) / 0.33)) : 0;
    const front = c.max.z;
    // the roof lining over where a head is (in front of the headrest), the floor where feet go, the door beside it
    const lining = s.top + 0.25 + hit(s.x, s.top + 0.25, back + 0.22, 0, 1, 0, 3);
    // (the floor: the lowest of a few rays down in front of the cushion — the nearer ones clear of the seat ahead's cushion)
    let floor = Infinity;
    for (const dz of [0.06, 0.14, 0.25]) { const d = hit(s.x, s.top - 0.02, front + dz, 0, -1, 0, 2); if (Number.isFinite(d)) floor = Math.min(floor, s.top - 0.02 - d); }
    const side = Math.sign(s.x) || 1, wallIn = hit(s.x, s.top + 0.15, back + 0.25, side, 0, 0, 2);
    const seat = { role: driver?.s === s ? 'driver' : 'passenger', row: s.row, side, x: s.x, top: s.top, back, tilt, front, room: s.room, lining, floor, wallIn };
    if (driver?.s === s) { const w = driver.w; seat.wheel = { x: w.centre.x, y: w.centre.y, z: w.centre.z, r: (w.size.x + w.size.y) / 4 }; }
    return seat;
  }).filter(s => Number.isFinite(s.back) && Number.isFinite(s.lining) && Number.isFinite(s.floor));
  // boarding order: the driver, the front passenger beside them, then row by row, the driver's side first
  out.sort((a, b) => (b.role === 'driver') - (a.role === 'driver') || a.row - b.row || (b.side === dSide) - (a.side === dSide) || dSide * (b.x - a.x));
  return out;
}
