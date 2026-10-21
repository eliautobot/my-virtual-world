// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The world modules in the browser (shared/world-modules.js, shared/airport-layout.js): each airport is ONE static mesh
// (runway, taxiways, apron, markings, helipads, car park, runway lights that glow at night, the terminal, the control
// tower and the hangar), and the parked aircraft are three instanced meshes for the whole world (one per type: render/
// aircraft-models.js) — a handful of draw calls however many airports there are (docs/features/play-modules.md
// §Performance). Rebuilt only when the world modules or the ground change. app.airports.hide(id) takes an aircraft off
// its stand while someone flies it (the flight, step 3).
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { FB } from './furniture.js';
import { makeFurnMat } from './mats.js';
import { MODELS, PARKED } from './aircraft-models.js';
import { controlTower } from './airport-structures.js';
import { SURFACES, BENDS, FILLETS, LANDSIDE, STRUCTURES, STANDS, HELIPAD_R, RUNWAY, toWorldAt } from '/shared/airport-layout.js';
import { modulesOf, aircraftStands } from '/shared/world-modules.js';

const FAR = 9000;   // m: airports farther than this are not drawn
const SURF = { runway: '#3b3f45', taxiway: '#4a4e55', apron: '#8e9196', parking: '#55595f', road: '#45494f', grass: null };
let app = null, group = null, mat = null, gmat = null, meshes = new Map(), planes = {}, dirty = true, hidden = new Set(), stands = [];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _y = new THREE.Vector3(0, 1, 0), _x = new THREE.Vector3(1, 0, 0);

export function init(a) {
  app = a;
  group = new THREE.Group(); group.name = 'world-modules'; a.stage.scene.add(group);
  mat = makeFurnMat({ lit: true });
  gmat = makeFurnMat({ lit: true }); gmat.polygonOffset = true; gmat.polygonOffsetFactor = -1; gmat.polygonOffsetUnits = -4;   // the paving over the pad's ground
  for (const [type, make] of Object.entries(MODELS)) {
    const im = new THREE.InstancedMesh(make(), mat, 4); im.count = 0; im.castShadow = true; im.frustumCulled = false; im.name = `aircraft-${type}`;
    planes[type] = im; group.add(im);
  }
  for (const k of ['wmods', 'terrain', 'roads', 'world']) bus.on(k, () => { dirty = true; });
  bus.on('frame', update);
  app.airports = {
    get stands() { return stands; },
    /** Takes an aircraft off its stand (someone is flying it) or puts it back. */
    hide(id, on = true) { if (on) hidden.add(id); else hidden.delete(id); placeAircraft(); bus.emit('aircraft'); },
    /** The stands whose aircraft is away (player.js leaves them out of its walls). */
    get away() { return hidden; },
    isAway: id => hidden.has(id),
    /** The server's list of aircraft away from their stands (player/flight.js): those stands are drawn empty. */
    setAway(ids) {
      const same = ids.size === hidden.size && [...ids].every(i => hidden.has(i));
      if (same) return;
      hidden.clear(); for (const i of ids) hidden.add(i);
      placeAircraft(); bus.emit('aircraft');
    },
    /** An aircraft type's model (shared with the stands' instanced meshes) and the material. */
    geometry: type => planes[type]?.geometry,
    get material() { return mat; },
    standAt(x, z, r = 6) { return stands.find(s => !hidden.has(s.id) && Math.hypot(s.x - x, s.z - z) < r) || null; },
  };
}

/** One airport's ground, markings, lights and buildings, in its own frame (s across, f along: FB's x and z). The pad's
 *  ground is at m.y − 0.05 (shared/terrain.js); paving sits flush on it (feet stand on it, not in it: the mesh draws
 *  with a polygon offset so it never flickers against the ground under it). */
function airportGeometry(m) {
  const f = new FB(), G = -0.05, P0 = G - 0.02, P1 = G + 0.015, M1 = G + 0.03;   // ground, paving bottom and top, markings
  f.push(m.x, m.y, m.z, m.rot);
  for (const [s0, f0, s1, f1, kind] of SURFACES) if (SURF[kind]) { f.col(SURF[kind]); f.box(s0, P0, f0, s1, P1, f1, 'b'); }
  // the paving turns round curves (the taxiway's ends bend into their links; fillets in every inside corner)
  f.col(SURF.taxiway);
  for (const B of BENDS) fan(f, [B.s, B.f], arcPts(B.s, B.f, B.r, B.a0, B.a1, 14), P1);
  for (const F of FILLETS) {
    f.col(F.s > 60 ? SURF.apron : SURF.taxiway);
    const pts = []; for (let k = 0; k <= 12; k++) { const t = k / 12 * Math.PI / 2, a = 1 - Math.sin(t), b = 1 - Math.cos(t); pts.push([F.s + F.r * (F.u[0] * a + F.w[0] * b), F.f + F.r * (F.u[1] * a + F.w[1] * b)]); }
    fan(f, [F.s, F.f], pts, P1);
  }
  const W = RUNWAY.w / 2, L = RUNWAY.len / 2, mark = (s0, f0, s1, f1, c = '#f4f4f0') => { f.col(c); f.box(s0, P1, f0, s1, M1, f1, 'b'); };
  for (let z = -L + 120; z < L - 120; z += 50) mark(-0.45, z, 0.45, z + 28);                              // centreline dashes
  for (const e of [-1, 1]) mark(e * (W - 1.2) - 0.4, -L + 2, e * (W - 1.2) + 0.4, L - 2);                 // edge lines
  for (const end of [-1, 1]) {
    const z0 = end * (L - 6);
    for (let s = -W + 3; s <= W - 4; s += 2.6) mark(s, Math.min(z0, z0 - end * 30), s + 1.5, Math.max(z0, z0 - end * 30));   // threshold piano keys
    for (const s of [-8, 8]) mark(s - 2, end * (L - 150) - 22, s + 2, end * (L - 150) + 22);           // aiming points
    for (const s of [-8, 8]) for (const k of [0, 1]) mark(s - 1.5, end * (L - 260 - k * 40) - 9, s + 1.5, end * (L - 260 - k * 40) + 9);   // touchdown zone
    const hdg = (((Math.round(((m.rot * 180 / Math.PI) + (end < 0 ? 0 : 180)) / 10) % 36) + 36) % 36) || 36;   // the runway's number at each end
    digits(f, String(hdg).padStart(2, '0'), end * (L - 60), end, P1, M1);
  }
  mark(54.6, -322, 55.4, 322, '#e8c33a');                                                                 // taxiway centreline
  for (const z of [-330, 330]) mark(15, z - 0.4, 47, z + 0.4, '#e8c33a');                                // the end links' (from the bends)
  mark(15, -0.4, 55, 0.4, '#e8c33a');
  f.col('#e8c33a');                                                                                        // curved: round the bends, and off the middle link both ways
  arcStrip(f, 47, -322, 8, -Math.PI / 2, 0, 0.8, P1, M1); arcStrip(f, 47, 322, 8, 0, Math.PI / 2, 0.8, P1, M1);
  arcStrip(f, 47, -8, 8, 0, Math.PI / 2, 0.8, P1, M1); arcStrip(f, 47, 8, 8, -Math.PI / 2, 0, 0.8, P1, M1);
  for (const z of [-330, 0, 330]) for (const d of [-1.2, 0, 1.2]) mark(17.5 + d - 0.2, z - 8, 17.5 + d + 0.2, z + 8, '#e8c33a');   // hold lines
  for (const st of STANDS) {
    if (st.type === 'heli') {                                                                              // helipads: a circle and an H
      f.col('#2f6b3a'); f.cyl(st.s, st.f, HELIPAD_R, P0, P1 + 0.005, 28);
      f.col('#f4f4f0'); f.cyl(st.s, st.f, HELIPAD_R - 0.6, P1 + 0.005, P1 + 0.012, 28);
      f.col('#2f6b3a'); f.cyl(st.s, st.f, HELIPAD_R - 1.2, P1 + 0.012, P1 + 0.02, 28);
      f.col('#f4f4f0'); for (const d of [-1.6, 1.6]) f.box(st.s + d - 0.45, P1 + 0.02, st.f - 2.6, st.s + d + 0.45, M1 + 0.01, st.f + 2.6, 'b'); f.box(st.s - 1.6, P1 + 0.02, st.f - 0.45, st.s + 1.6, M1 + 0.01, st.f + 0.45, 'b');
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; f.col('#fff3a0', 0, 2); f.cyl(st.s + Math.cos(a) * (HELIPAD_R + 0.4), st.f + Math.sin(a) * (HELIPAD_R + 0.4), 0.14, G, G + 0.22, 6); }   // perimeter lights
    } else { mark(st.s - 30, st.f - 0.3, st.s + 6, st.f + 0.3, '#e8c33a'); mark(st.s + 4, st.f - 6, st.s + 4.6, st.f + 6, '#e8c33a'); }   // lead-in line, stop bar
  }
  landside(f, G, P0, P1, M1);                                                                              // the forecourt, canopy, drop-off lane, median, car park
  // lights: runway edges (white), thresholds (green) and ends (red), the approach lights beyond each end, PAPI beside
  // the touchdown zone, taxiway edges (blue); all glow at night (the furniture material's emissive channel)
  const lamp = (s, z, c, h = 0.42, r = 0.17) => { f.col('#5d6168'); f.cyl(s, z, r * 0.6, G, G + h - 0.12, 5); f.col(c, 0, 2); f.cyl(s, z, r, G + h - 0.12, G + h, 6); };
  for (let z = -L; z <= L; z += 60) for (const e of [-1, 1]) lamp(e * (W + 1.5), z, '#fff1c4');
  for (const end of [-1, 1]) {
    for (let s = -W; s <= W; s += 3) { lamp(s, end * (L + 1.5), end < 0 ? '#5df08a' : '#ff5a5a', 0.38); lamp(s, -end * (L + 3), end < 0 ? '#ff5a5a' : '#5df08a', 0.38); }
    for (let k = 1; k <= 5; k++) {                                                                         // approach light bars on posts
      const z = end * (L + 12 * k), h = 0.6 + k * 0.25;
      f.col('#5d6168'); f.cyl(0, z, 0.12, G, G + h, 5); f.box(-6, G + h - 0.1, z - 0.12, 6, G + h, z + 0.12);
      for (let s = -5.5; s <= 5.5; s += 1.4) { f.col('#fff7e0', 0, 2); f.box(s - 0.22, G + h, z - 0.18, s + 0.22, G + h + 0.2, z + 0.18); }
    }
    for (let k = 0; k < 4; k++) {                                                                           // PAPI: four boxes, left of the touchdown zone
      const s = -(W + 10 + k * 9), z = end * (L - 300);
      f.col('#d8d8d8'); f.box(s - 1.2, G, z - 0.6, s + 1.2, G + 0.9, z + 0.6);
      f.col(k < 2 ? '#ffffff' : '#ff4b4b', 0, 2); f.box(s - 0.9, G + 0.35, z - end * 0.62, s + 0.9, G + 0.7, z - end * 0.58);
    }
  }
  for (let z = -312; z <= 312; z += 26) {                                                                // taxiway edge lights (not where links and the apron join it)
    if (Math.abs(z) > 20) lamp(46.4, z, '#3d7bff', 0.32, 0.13);
    if (Math.abs(z) > 189) lamp(63.6, z, '#3d7bff', 0.32, 0.13);
  }
  for (const B of BENDS) for (const [s, z] of arcPts(B.s, B.f, B.r + 0.6, B.a0, B.a1, 4)) lamp(s, z, '#3d7bff', 0.32, 0.13);   // round the bends
  for (const [a, b] of [[-338, -322], [-8, 8], [322, 338]]) { lamp(31, a - 0.6, '#3d7bff', 0.32, 0.13); lamp(31, b + 0.6, '#3d7bff', 0.32, 0.13); }   // the links' edges
  // the windsock, beside the runway's middle; floodlight masts on the apron
  { const s = -W - 30, z = 40; f.col('#d9dadc'); f.cyl(s, z, 0.1, G, G + 7, 6); f.col('#3a3d42'); f.box(s - 0.6, G, z - 0.6, s + 0.6, G + 0.3, z + 0.6);
    for (let k = 0; k < 5; k++) { f.col(k % 2 ? '#f4f4f0' : '#ff6a1a'); f.push(s, G + 6.6, z + 0.3 + k * 0.7); f.stack.push(f.m.clone()); f.m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 - 0.25)); f.lathe(0, 0, [[0.55 - k * 0.07, 0], [0.48 - k * 0.07, 0.7]], 10); f.pop(); f.pop(); } }
  for (const z of [-178, -60, 60, 178]) { const s = 152; f.col('#9aa0a7'); f.cyl(s, z, 0.28, G, G + 22, 8); f.col('#3a3d42'); f.box(s - 1.6, G + 21.6, z - 0.8, s + 1.6, G + 22.6, z + 0.8);
    f.col('#fff6da', 0, 2); for (const d of [-1, 0, 1]) f.box(s - 1.5, G + 21.4, z + d * 0.55 - 0.22, s - 1.1, G + 21.8, z + d * 0.55 + 0.22); }
  for (const B of STRUCTURES) building(f, B, 0);
  f.pop();
  return f.build().geo;
}
/** A runway's number in seven-segment strokes (each digit 9 m wide, 18 m long), read by a pilot landing towards −end. */
function digits(f, text, z0, end, y0, y1) {
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  const w = 9, hgt = 18, t = 1.5, dir = -end;   // the digits face a pilot coming in from beyond this end
  [...text].forEach((ch, i) => {
    const cx = (i - (text.length - 1) / 2) * (w + 3) * dir;   // left to right as the pilot sees it
    const S = (a, b, c, d) => { const [x0, x1] = [cx - a * dir, cx - c * dir].sort((p, q) => p - q), [z1a, z1b] = [z0 + b * dir, z0 + d * dir].sort((p, q) => p - q); f.col('#f4f4f0'); f.box(x0, y0, z1a, x1, y1, z1b, 'b'); };
    const hw = w / 2, hh = hgt / 2;
    for (const sg of SEG[ch] || '') ({
      a: () => S(-hw, hh - t, hw, hh), d: () => S(-hw, -hh, hw, -hh + t), g: () => S(-hw, -t / 2, hw, t / 2),
      b: () => S(hw - t, 0, hw, hh), c: () => S(hw - t, -hh, hw, 0), f: () => S(-hw, 0, -hw + t, hh), e: () => S(-hw, -hh, -hw + t, 0),
    })[sg]();
  });
}
/** Points round an arc in the frame (angles from +s towards +f). */
function arcPts(cs, cf, r, a0, a1, n) { const out = []; for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; out.push([cs + Math.cos(a) * r, cf + Math.sin(a) * r]); } return out; }
/** A flat fan at height y from a point through a run of points (a quarter disc, a fillet). */
function fan(f, c, pts, y) {
  const i0 = f.vert(c[0], y, c[1], 0, 1, 0);
  let prev = f.vert(pts[0][0], y, pts[0][1], 0, 1, 0);
  for (let k = 1; k < pts.length; k++) { const cur = f.vert(pts[k][0], y, pts[k][1], 0, 1, 0); f.tri(i0, prev, cur); prev = cur; }
}
/** A painted line round an arc (its middle at radius r, w wide), from y0 up to y1. */
function arcStrip(f, cs, cf, r, a0, a1, w, y0, y1) {
  const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) * r / 1.5)), A = arcPts(cs, cf, r - w / 2, a0, a1, n), B = arcPts(cs, cf, r + w / 2, a0, a1, n);
  for (let k = 0; k < n; k++) f.quad([[A[k][0], y1, A[k][1]], [B[k][0], y1, B[k][1]], [B[k + 1][0], y1, B[k + 1][1]], [A[k + 1][0], y1, A[k + 1][1]]], [0, 1, 0]);
}
/** The landside (2026-10-14, the product owner: the old canopy, its columns and kerb gone; "a new outside roof with columns and a new
 *  floor that look better, connect to the terminal and extend end to end of the building"; the car park tied into it):
 *  the forecourt along the terminal's whole front in pale stone, a tactile strip and a granite kerb; the drop-off lane;
 *  the canopy over both, on tree columns; a planted median with gaps where people cross; the car park — rows of bays and
 *  its lamps — and the entrance road from the airport's edge (where the access road meets it) to the drop-off lane. */
function landside(f, G, P0, P1, M1) {
  const L = LANDSIDE, fa = L.f0, fb = L.f1, [e0, e1] = L.entry;
  const pave = (s0, f0, s1, f1, c) => { f.col(c); f.box(s0, P0, f0, s1, P1, f1, 'b'); };
  const mark = (s0, f0, s1, f1, c = '#f4f4f0') => { f.col(c); f.box(s0, P1, f0, s1, M1, f1, 'b'); };
  // the forecourt: big stone tiles (their joints), the tactile strip, the kerb (a little proud of the paving)
  pave(L.front, fa, L.kerb, fb, '#d8d3c6');
  for (let s = L.front + 1.6; s < L.kerb - 0.8; s += 1.6) mark(s - 0.03, fa, s + 0.03, fb, '#bdb6a7');
  for (let z = fa + 3.2; z < fb - 0.5; z += 3.2) mark(L.front, z - 0.03, L.kerb - 0.75, z + 0.03, '#bdb6a7');
  mark(L.kerb - 0.75, fa, L.kerb - 0.2, fb, '#d6c06a');
  f.col('#a19f99'); f.box(L.kerb, P0, fa, L.lane, P1 + 0.06, fb, 'b');
  // the drop-off lane: its far edge line, zebra crossings
  pave(L.lane, fa, L.median, fb, '#474b51');
  mark(L.median - 0.5, fa, L.median - 0.35, fb);
  for (const c of L.crossings) for (let s = L.lane + 0.45; s < L.median - 0.5; s += 1.0) mark(s, c - 1.7, s + 0.5, c + 1.7);
  // the median: planters with low shrubs and a few small trees; open where people cross and where the entrance road runs
  const gaps = [...L.crossings.map(c => [c - 2.2, c + 2.2]), [e0, e1]].sort((a, b) => a[0] - b[0]);
  let z0 = fa;
  for (const [g0, g1] of [...gaps, [fb, fb]]) {
    if (g0 - z0 > 1) {
      pave(L.median, z0, L.park, g0, '#9c9a93');
      f.col('#a9a69e'); f.box(L.median + 0.1, P1, z0 + 0.1, L.park - 0.1, P1 + 0.28, g0 - 0.1, 'b');
      f.col('#4f6f36'); f.box(L.median + 0.25, P1 + 0.28, z0 + 0.25, L.park - 0.25, P1 + 0.3, g0 - 0.25, 'b');
      for (let z = z0 + 1.4; z < g0 - 1; z += 2.8) { f.col(((z * 7) | 0) % 3 ? '#3f6a2e' : '#4b7a35'); f.sph((L.median + L.park) / 2, P1 + 0.5, z, 0.5, 0.36, 0.55, 7, 4); }
    } else if (g0 > z0) pave(L.median, z0, L.park, g0, '#9c9a93');
    pave(L.median, g0, L.park, g1, g0 === e0 ? '#474b51' : '#d8d3c6');   // (a crossing's paving, or the entrance road)
    z0 = g1;
  }
  for (const z of [-88, -75, -50, -9, 4, 26, 38]) { const s = (L.median + L.park) / 2; f.col('#6b4f36'); f.cyl(s, z, 0.13, P1 + 0.3, G + 2.4, 6, 0.1); f.col('#3d6b2f'); f.sph(s, G + 3.3, z, 1.35, 1.15, 1.35, 9, 6); }
  // the car park: asphalt either side of the entrance road; the bays (lines, and each row's back line); its lamps; then a
  // verge to the airport's edge: a low hedge along the car park and trees
  pave(L.park, fa, L.parkEnd, e0, '#55595f'); pave(L.park, e1, L.parkEnd, fb, '#55595f');
  for (const [a, b] of [[fa, e0 - 1.5], [e1 + 1.5, fb]]) { f.col('#3f6630'); f.box(L.parkEnd + 0.6, G, a, L.parkEnd + 1.7, G + 0.85, b); }
  let k = 0;
  for (let z = fa + 6; z < fb - 2; z += 13) if (z < e0 - 9 || z > e1 + 4) { const s = L.parkEnd + 5.5 + (k++ % 2) * 2.5; f.col('#6b4f36'); f.cyl(s, z, 0.16, G, G + 2.6, 6, 0.11); f.col(k % 2 ? '#3d6b2f' : '#4a7a36'); f.sph(s, G + 3.7, z, 1.7, 1.45, 1.7, 9, 6); }
  for (const [s0, s1, dir] of L.rows) {
    const back = dir > 0 ? s0 : s1;
    for (const [a, b] of [[fa + 1, e0 - 1.4], [e1 + 1.4, fb - 1]]) {
      mark(back - 0.06, a, back + 0.06, b);
      for (let z = a; z <= b + 0.01; z += 2.7) mark(s0, z - 0.06, s1, z + 0.06);
    }
  }
  for (let z = fa + 9; z < fb - 4; z += 22) {
    if (z > e0 - 4 && z < e1 + 4) continue;
    const s = L.rows[1][1] + 0.65;
    f.col('#8a9097'); f.cyl(s, z, 0.13, G, G + 8, 6); f.box(s - 1.7, G + 7.8, z - 0.12, s + 1.7, G + 8, z + 0.12);
    f.col('#fff3d6', 0, 2); for (const d of [-1.45, 1.45]) f.box(s + d - 0.35, G + 7.62, z - 0.2, s + d + 0.35, G + 7.8, z + 0.2);
  }
  // the entrance road: from the edge, through the car park and the median, into the drop-off lane
  pave(L.park, e0, L.edge, e1, '#474b51');
  for (let s = L.park + 1.5; s < L.edge - 1.5; s += 6) mark(s, (e0 + e1) / 2 - 0.07, s + 3, (e0 + e1) / 2 + 0.07);
  for (const z of [e0, e1]) mark(L.parkEnd, z + (z === e0 ? 0.3 : -0.45), L.edge, z + (z === e0 ? 0.45 : -0.3));   // its edge lines out to the road
  // the airport's sign beside the entrance (facing those arriving), lit at night
  { const s = L.edge - 4.5, z = e0 - 6.5;
    f.col('#b9b3a5'); f.box(s - 0.35, G, z - 4.2, s + 0.35, G + 1.9, z + 4.2);
    f.col('#1f4e8c'); f.box(s + 0.35, G + 0.75, z - 3.6, s + 0.42, G + 1.6, z + 3.6);
  }   // (its name: nameSigns)
  canopy(f, G);
}
/** The canopy: one long thin deck from the terminal's front out over the drop-off lane, rising a little outwards, past
 *  both ends of the building; white tree columns (a trunk, a capital, four branches up to it), light strips beneath that
 *  glow at night, a metal fascia with the airport's name, a flashing strip where it meets the terminal. */
function canopy(f, G) {
  const L = LANDSIDE, C = L.canopy, s0 = L.front, s1 = C.s1, d = C.deck, under = s => G + C.y0 + (C.y1 - C.y0) * (s - s0) / (s1 - s0);
  const y0 = under(s0), y1 = under(s1), k = (y1 - y0) / (s1 - s0);
  f.col('#eceef0'); f.quad([[s0, y0 + d, C.f0], [s1, y1 + d, C.f0], [s1, y1 + d, C.f1], [s0, y0 + d, C.f1]], [-k, 1, 0]);   // the top
  f.col('#e1e4e8'); f.quad([[s0, y0, C.f0], [s1, y1, C.f0], [s1, y1, C.f1], [s0, y0, C.f1]], [k, -1, 0]);                  // beneath
  f.col('#a9bccb'); for (let s = s0 + 3; s < s1 - 2; s += 4.4) { const a = under(s) + d + 0.02, b = under(s + 1.5) + d + 0.02; f.quad([[s, a, C.f0 + 3], [s + 1.5, b, C.f0 + 3], [s + 1.5, b, C.f1 - 3], [s, a, C.f1 - 3]], [-k, 1, 0]); }   // skylights along it
  f.col('#c6ccd2'); for (const z of [C.f0, C.f1]) f.quad([[s0, y0, z], [s1, y1, z], [s1, y1 + d, z], [s0, y0 + d, z]], [0, 0, z === C.f0 ? -1 : 1]);
  f.box(s1 - 0.05, y1 - 0.22, C.f0 - 0.06, s1 + 0.25, y1 + d + 0.2, C.f1 + 0.06);                                            // the fascia
  const fm = (L.f0 + L.f1) / 2;
  f.col('#1f4e8c'); f.box(s1 + 0.25, y1 - 0.6, fm - 13, s1 + 0.38, y1 + d + 0.12, fm + 13);                                  // the name board (its name: nameSigns)
  f.col('#5b636d'); f.box(s0 - 0.12, y0 - 0.16, C.f0, s0 + 0.32, y0 + d + 0.1, C.f1);                                      // where it meets the terminal
  for (let s = s0 + 2.4; s < s1 - 0.8; s += 3.9) { const y = under(s); f.col('#fffaf0', 0, 2); f.box(s - 0.11, y - 0.05, C.f0 + 1.4, s + 0.11, y - 0.004, C.f1 - 1.4); }   // light strips
  const cs = L.columns.s, yB = G + L.columns.branch;
  for (const z of L.columns.f) {
    f.col('#8d939a'); f.cyl(cs, z, 0.44, G, G + 0.22, 10);                                                                     // its foot
    f.col('#eceef0'); f.cyl(cs, z, 0.3, G + 0.22, yB, 10, 0.25);
    f.col('#dcdfe3'); f.sph(cs, yB, z, 0.36, 0.3, 0.36, 8, 5);
    f.col('#eceef0'); for (const [ds, dz] of [[-3.4, -3.4], [-3.4, 3.4], [4.4, -3.4], [4.4, 3.4]]) f.rod([cs, yB, z], [cs + ds, under(cs + ds) + 0.02, z + dz], 0.12, 6);
  }
}
function building(f, B, y) {
  const { s0, f0, s1, f1, h } = B, sm = (s0 + s1) / 2, fm = (f0 + f1) / 2;
  if (B.kind === 'terminal') {   // the hall itself is a building (render/buildings.js; people go in); landside() draws its front
    f.col('#4b5560');
    for (let z = f0 + 14; z < f1 - 10; z += 26) {                                                  // jet bridges out over the apron
      f.box(s0 - 14, y + 3.2, z - 1.6, s0 - 0.2, y + 6.0, z + 1.6);
      f.col('#7fa7c4'); f.box(s0 - 14.2, y + 3.6, z - 1.3, s0 - 0.2, y + 5.6, z - 1.0); f.box(s0 - 14.2, y + 3.6, z + 1.0, s0 - 0.2, y + 5.6, z + 1.3);
      f.col('#9aa0a7'); f.cyl(s0 - 12, z, 0.25, y, y + 3.2, 6); f.col('#4b5560');
    }
  } else if (B.kind === 'tower') {
    controlTower(f, sm, fm, y, h);   // (render/airport-structures.js)
  } else if (B.kind === 'hangar') {   // its door faces the apron, the taxiway and the runway (−s); the arch spans its width (f)
    const wf = (f1 - f0) / 2, wall = h * 0.55, N = 14, rise = h - wall;
    f.col('#b9bcc0'); f.box(s0, y - 0.05, f0, s1, y + wall, f1, 't');
    for (let k = 0; k < N; k++) {                                                                   // the arched roof, along s
      const a0 = Math.PI * k / N, a1 = Math.PI * (k + 1) / N;
      const p0 = [fm - Math.cos(a0) * wf, y + wall + Math.sin(a0) * rise], p1 = [fm - Math.cos(a1) * wf, y + wall + Math.sin(a1) * rise];
      const nz = -(p1[1] - p0[1]), ny = p1[0] - p0[0], l = Math.hypot(nz, ny) || 1;
      f.col('#cfd2d6'); f.quad([[s0, p0[1], p0[0]], [s0, p1[1], p1[0]], [s1, p1[1], p1[0]], [s1, p0[1], p0[0]]], [0, ny / l, nz / l]);
      f.col('#b9bcc0'); for (const s of [s0, s1]) f.quad([[s, p0[1], p0[0]], [s, p1[1], p1[0]], [s, y + wall, fm], [s, y + wall, fm]], [s === s0 ? -1 : 1, 0, 0]);   // the gables
    }
    f.col('#8f969d'); for (let s = s0 + 4; s < s1 - 1; s += 6) for (let k = 0; k < N; k++) {   // the roof's ribs
      const a0 = Math.PI * k / N, a1 = Math.PI * (k + 1) / N;
      f.rod([s, y + wall + Math.sin(a0) * rise + 0.05, fm - Math.cos(a0) * wf], [s, y + wall + Math.sin(a1) * rise + 0.05, fm - Math.cos(a1) * wf], 0.09, 4);
    }
    f.col('#5d6670'); f.box(s0 - 0.15, y, f0 + 3, s0 + 0.05, y + wall - 0.6, f1 - 3);              // the big door, on the apron side
    f.col('#4a525b'); for (let z = f0 + 5; z < f1 - 3; z += 3.2) f.box(s0 - 0.2, y, z, s0 - 0.1, y + wall - 0.6, z + 0.12);   // its panels
    f.col('#3a4048'); f.box(s0 - 0.25, y, f0 + 2.6, s0 - 0.05, y + 0.25, f1 - 2.6);                  // its rail
    f.col('#fff6da', 0, 2); for (let z = f0 + 6; z < f1 - 4; z += 8) f.box(s0 - 0.4, y + wall - 0.4, z - 0.5, s0 - 0.1, y + wall - 0.2, z + 0.5);   // lamps over it
    f.col('#1f4e8c'); f.box(s0 - 0.12, y + wall + 0.9, fm - 9, s0 - 0.05, y + wall + 2.6, fm + 9);   // a band on the gable
    // (on it, HANGAR: nameSigns)
  }
}

/** Lettering that glows (2026-10-14, the product owner: "the name of the airport on the front sign and the front of the roof"): text
 *  drawn once on a canvas, white on a clear ground, on a plane at most w × h m; the blue bands under it are the airport's. */
export function lettering(text, w, h) {
  const px = 128, c = document.createElement('canvas'), g = c.getContext('2d'), font = `700 ${Math.round(px * 0.74)}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  g.font = font; g.letterSpacing = '6px';
  c.width = Math.min(4096, Math.ceil(g.measureText(text).width + px * 0.4)); c.height = px;
  g.font = font; g.letterSpacing = '6px'; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, px * 0.54);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const aspect = c.width / c.height, ww = Math.min(w, h * aspect);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ww, ww / aspect), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  mesh.renderOrder = 3;
  return mesh;
}
/** The airport's name on its canopy's fascia and on the sign at its entrance (both facing the car park: +s), HANGAR on
 *  the hangar's door gable (facing the apron: −s) — placed in the world from the airport's frame. */
function nameSigns(m) {
  const name = (m.name || 'Airport').toUpperCase(), L = LANDSIDE, C = L.canopy, G = -0.05, out = [];
  const put = (mesh, s, f, y, face) => { const p = toWorldAt(m, s, f); mesh.position.set(p.x, m.y + y, p.z); mesh.rotation.y = m.rot + face * Math.PI / 2; out.push(mesh); return mesh; };
  put(lettering(name, 24, 0.8), C.s1 + 0.4, (L.f0 + L.f1) / 2, G + C.y1 + (C.deck - 0.48) / 2, 1);
  put(lettering(name, 6.8, 0.6), L.edge - 4.5 + 0.44, L.entry[0] - 6.5, G + 1.175, 1);
  const H = STRUCTURES.find(B => B.kind === 'hangar');
  if (H) put(lettering('HANGAR', 15, 1.1), H.s0 - 0.14, (H.f0 + H.f1) / 2, H.h * 0.55 + 1.75, -1);
  return out;
}
function build() {
  dirty = false;
  const W = S.world, list = modulesOf(W).filter(m => m.kind === 'airport' && Number.isFinite(m.y)), keep = new Set();
  for (const m of list) {
    const key = `${m.id}:${m.x}:${m.z}:${m.rot}:${m.y}:${m.name}`; keep.add(key);
    if (meshes.has(key)) continue;
    const mesh = new THREE.Mesh(airportGeometry(m), gmat); mesh.receiveShadow = true; mesh.castShadow = true; mesh.name = `airport-${m.id}`;
    for (const sg of nameSigns(m)) mesh.add(sg);
    mesh.userData.at = { x: m.x, z: m.z };
    meshes.set(key, mesh); group.add(mesh);
  }
  for (const [key, mesh] of meshes) if (!keep.has(key)) { group.remove(mesh); mesh.geometry.dispose(); for (const c of mesh.children) { c.geometry.dispose(); c.material.map?.dispose(); c.material.dispose(); } meshes.delete(key); }
  stands = aircraftStands(W);
  placeAircraft();
}
function placeAircraft() {
  const by = { prop: [], jet: [], heli: [] };
  for (const s of stands) if (!hidden.has(s.id) && by[s.type]) by[s.type].push(s);
  for (const [type, list] of Object.entries(by)) {
    let im = planes[type];
    if (im.instanceMatrix.count < list.length) {   // grow (another airport): a new instanced mesh with room for all
      group.remove(im); const next = new THREE.InstancedMesh(im.geometry, mat, Math.ceil(list.length * 1.5)); next.castShadow = true; next.frustumCulled = false; next.name = im.name;
      im.dispose(); planes[type] = im = next; group.add(im);
    }
    const pr = PARKED[type];   // a taildragger rests nose up, on its main wheels and its tail wheel
    list.forEach((s, k) => { _q.setFromAxisAngle(_y, s.yaw).multiply(_qp.setFromAxisAngle(_x, -pr.pitch)); im.setMatrixAt(k, _m.compose(_p.set(s.x, s.y - 0.05 + pr.lift, s.z), _q, _s)); });
    im.count = list.length; im.instanceMatrix.needsUpdate = true;
  }
}
let farCheck = 0;
function update() {
  if (!S.world) return;
  if (dirty) { if (!app.terrain?.ground && modulesOf(S.world).length) return; build(); }
  if (performance.now() - farCheck < 500 || !meshes.size) return;   // twice a second: distant airports are not drawn
  farCheck = performance.now();
  const c = app.stage.camera.position;
  for (const mesh of meshes.values()) mesh.visible = Math.hypot(mesh.userData.at.x - c.x, mesh.userData.at.z - c.z) < FAR;
}
