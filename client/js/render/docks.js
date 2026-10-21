// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing docks drawn (docs/features/fishing.md §Venues; layouts: shared/dock-layout.js): one mesh per dock, built in
// its own frame (s across: +s up the land, −s out over the water; f along the shore) like the airport's. The land: the
// promenade along the quay, the plaza and lawn round the store, the car park with its bays (long ones for trailers),
// kerbs, lamps, bins, the entrance sign (its benches, picnic tables and trees are the world's own decorations, which
// people sit at: shared/dock-layout.js dockDecor). The quay: a concrete cap on a corrugated steel wall,
// rocks at its foot, a guard rail. The launch ramp: grooved concrete down into the water between retaining walls. The
// pier: plank decking on stringers, pile caps and round piles braced across, rails, lamps, life rings, ladders, the
// T-head with the fuel pump and its kiosk and bollards. The gangway down to the floating dock: composite boards on black
// floats, white fascia, fingers with fenders, cleats, power pedestals and guide piles. The store is a building of the
// world (its own renderer). Lights glow at night (the furniture material's emissive channel). The boats: player/boating.js.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { FB } from './furniture.js';
import { makeFurnMat } from './mats.js';
import { DOCKS, waterOf, rampOf, toWorldAt } from '/shared/dock-layout.js';
import { modulesOf, boatSlips } from '/shared/world-modules.js';
import { boatGeometry, HULL_FORM } from './boat-models.js';
import { hullAt, waterMarks } from './water-marks.js';
import { boatQuat } from '/shared/boat-model.js';

const FAR = 3500;   // m: docks farther than this are not drawn
const SURF = { walk: '#b9b4aa', asphalt: '#4b4e53', pavers: '#bfae94', gravel: '#a39882' };
let app = null, group = null, gmat = null, meshes = new Map(), dirty = true, slips = [], boats = {};
const away = new Set();
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

export function init(a) {
  app = a;
  group = new THREE.Group(); group.name = 'docks'; a.stage.scene.add(group);
  gmat = makeFurnMat({ lit: true }); gmat.polygonOffset = true; gmat.polygonOffsetFactor = -1; gmat.polygonOffsetUnits = -4;
  for (const k of ['wmods', 'terrain', 'world']) bus.on(k, () => { dirty = true; });
  bus.on('ground', () => { drop(); dirty = true; });   // (the ground under a dock reshaped: its rocks on the new ground)
  bus.on('frame', update);
  app.marinas = {   // (app.docks is the side panels: ui/docks.js)
    /** The slips and their boats (shared/world-modules.js boatSlips). */
    get slips() { return slips; },
    isAway: id => away.has(id),
    /** A boat taken out of its slip (player/boating.js) or put back. */
    hide(id, on = true) { if (on) away.add(id); else away.delete(id); },
    /** The server's list of boats out of their slips: those slips drawn empty. */
    setAway(ids) { away.clear(); for (const i of ids) away.add(i); },
  };
}
/** The boats in their slips: one instanced mesh a type, bobbing gently on the basin's ripples (drawn only). */
function mooredBoats(t) {
  const n = {};
  for (const s of slips) {
    if (away.has(s.id)) continue;
    let im = boats[s.kind];
    if (!im) { im = boats[s.kind] = new THREE.InstancedMesh(boatGeometry(s.kind), gmat, 10); im.count = 0; im.castShadow = true; im.frustumCulled = false; im.name = `moored-${s.kind}`; group.add(im); }
    const k = n[s.kind] || 0; if (k >= im.instanceMatrix.count) continue;
    const ph = s.x * 0.37 + s.z * 0.21, q = boatQuat({ heading: s.yaw, pitch: Math.sin(t * 0.9 + ph) * 0.012, roll: Math.sin(t * 0.7 + ph * 1.3) * 0.025 });
    im.setMatrixAt(k, _m.compose(_p.set(s.x, s.y + Math.sin(t * 1.1 + ph) * 0.04, s.z), _q.set(q.x, q.y, q.z, q.w), _s));
    hullAt(`moored-${s.id}`, HULL_FORM[s.kind], { m: _m });   // (the water keeps out of it and laps at it)
    n[s.kind] = k + 1;
  }
  for (const [kind, im] of Object.entries(boats)) { im.count = n[kind] || 0; im.instanceMatrix.needsUpdate = true; }
}

// a small, steady dice for the planks' and rocks' variety (the same every build)
const hash = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
/** A colour a little lighter or darker (k: −1 … 1). */
function shade(hex, k) {
  const c = new THREE.Color(hex), t = k > 0 ? new THREE.Color('#ffffff') : new THREE.Color('#000000');
  return `#${c.lerp(t, Math.abs(k)).getHexString()}`;
}

/** One dock's geometry, in its frame, heights from its land level (m.y): the water at Wr. groundAt(s, f): the ground's
 *  height there (the terrain's, under the pads), from the land level. */
function dockGeometry(m, groundAt) {
  const K = DOCKS[m.kind], f = new FB(), Wr = waterOf(m) - m.y, G = -0.05, P0 = G - 0.02, P1 = G + 0.015, M1 = G + 0.03;
  const yOf = v => (typeof v === 'number' ? Wr + v : (v?.l || 0) + G);
  f.push(m.x, m.y, m.z, m.rot);
  land(f, K, G, P0, P1, M1);
  quay(f, m, K, G, Wr, groundAt);
  ramp(f, m, K, G, Wr, groundAt);
  for (const d of K.decks) deck(f, d, yOf(d.y0), yOf(d.y1), Wr, K);
  for (const w of K.walls) if (w[4] > 0.98 && w[4] < 1.2) rail(f, w, yOf(w[5]));   // (the rails: 1.05 m)
  fixtures(f, m, K, G, Wr, yOf);
  f.pop();
  return f.build().geo;
}

// ------------------------------------------------------------------ the land
function land(f, K, G, P0, P1, M1) {
  const L = K.plan;
  for (const [s0, f0, s1, f1, kind] of L.surfaces) { f.col(SURF[kind]); f.box(s0, P0, f0, s1, P1, f1, 'b'); }
  // the promenade's expansion joints; the plaza's paver courses
  f.col('#9d988e'); for (const [s0, f0, s1, f1, kind] of L.surfaces) if (kind === 'walk') for (let z = f0 + 2.5; z < f1; z += 2.5) f.box(s0, P1, z - 0.02, s1, P1 + 0.004, z + 0.02, 'b');
  f.col('#a8987f'); for (const [s0, f0, s1, f1, kind] of L.surfaces) if (kind === 'pavers') for (let x = s0 + 1.2; x < s1; x += 1.2) f.box(x - 0.02, P1, f0, x + 0.02, P1 + 0.004, f1, 'b');
  // parking bays: their lines and the line at their back (rows back to back share it) - no wheel stops (2026-10-15, the
  // product owner: two bars side by side read as long double bays)
  for (const [s0, s1, f0, f1, w, open] of L.bays) {
    f.col('#eeeeea');
    const back = open < 0 ? s1 : s0;
    for (let z = f0; z <= f1 + 1e-6; z += w) f.box(Math.min(s0, s1), P1, z - 0.06, Math.max(s0, s1), M1, z + 0.06, 'b');
    f.box(back - 0.06, P1, f0, back + 0.06, M1, f1, 'b');
  }
  // the planted islands between the rows: kerbs round them, a hedge
  for (const [s0, f0, s1, f1] of L.islands) {
    f.col('#c9c5bc'); f.box(s0, G, f0, s1, G + 0.15, f0 + 0.2); f.box(s0, G, f1 - 0.2, s1, G + 0.15, f1); f.box(s0, G, f0, s0 + 0.2, G + 0.15, f1); f.box(s1 - 0.2, G, f0, s1, G + 0.15, f1);
    f.col('#4f7a3c'); f.box(s0 + 0.6, G, f0 + 0.8, s1 - 0.6, G + 0.75, f1 - 0.8);
  }
  // kerbs along the drive where the lawn and the plaza meet it
  f.col('#c9c5bc'); f.box(L.lawn[2] - 0.18, G, L.lawn[1], L.lawn[2], G + 0.14, L.lawn[3]); f.box(L.lawn[0], G, L.lawn[1], L.lawn[2], G + 0.14, L.lawn[1] + 0.18);
  for (const [s, z] of L.lamps) lampPost(f, s, z, G, 6.5);
  // (its trees, benches and picnic tables are the world's own decorations, made with the dock: shared/dock-layout.js
  // dockDecor - people sit on them; render/decor.js draws them)
  // bins by the benches, a bike rack by the store, the entrance sign's stone base (its lettering: dockSigns)
  for (const [s, z] of L.benches) { f.col('#3d4a3f'); f.cyl(s + 0.4, z + 1.4, 0.28, G, G + 0.85, 10); f.col('#2c3530'); f.cyl(s + 0.4, z + 1.4, 0.3, G + 0.85, G + 0.92, 10); }
  const E = K.roadEnd;
  f.col('#8d8579'); f.box(E.s - 4.6, G, E.f - 9.6, E.s - 3.6, G + 1.6, E.f - 4.6);
  // its board both ways, the dock's name on each (dockSigns): to the road, arriving, and to the car park, leaving
  f.col('#2b3f55'); f.box(E.s - 4.68, G + 0.55, E.f - 9.4, E.s - 4.6, G + 1.45, E.f - 4.8); f.box(E.s - 3.6, G + 0.55, E.f - 9.4, E.s - 3.52, G + 1.45, E.f - 4.8);
  storeFront(f, K, G);
  if (L.weigh) weighStation(f, L.weigh[0], L.weigh[1], G);
}
/** The store's front to the water: a porch on posts with a navy roof and a red sign board (its name: dockSigns), an ice
 *  machine, a bait cooler, crates, buoys hung on the posts, a rack of rods for sale, a chalkboard. */
function storeFront(f, K, G) {
  const St = K.store, s0 = St.s0, a = St.f0 + 2, b = St.f1 - 2, H = 3.3, deep = 2.8;
  f.col('#b9ab92'); f.box(s0 - deep - 0.2, G, a - 0.2, s0, G + 0.12, b + 0.2);                          // the porch's deck
  f.col('#eee9dc'); for (let z = a; z <= b + 1e-6; z += (b - a) / Math.max(1, Math.round((b - a) / 4))) { f.box(s0 - deep - 0.12, G + 0.12, z - 0.12, s0 - deep + 0.12, G + H, z + 0.12); }
  f.col('#24405e'); f.quad([[s0 - deep - 0.5, G + H, a - 0.5], [s0 + 0.05, G + H + 0.45, a - 0.5], [s0 + 0.05, G + H + 0.45, b + 0.5], [s0 - deep - 0.5, G + H, b + 0.5]], [-0.15, 1, 0]);
  f.box(s0 - deep - 0.55, G + H - 0.25, a - 0.5, s0 - deep - 0.45, G + H + 0.05, b + 0.5);
  const mid = (a + b) / 2, sw = Math.min(6.5, (b - a) / 2 + 0.3); f.col('#c8312a'); f.box(s0 - deep - 0.62, G + H + 0.05, mid - sw, s0 - deep - 0.5, G + H + 1.0, mid + sw);   // the sign board
  f.col('#fff6da', 0, 2); for (const z of [a + 1, mid - 3, mid + 3, b - 1]) f.box(s0 - 0.4, G + H + 0.1, z - 0.2, s0 - 0.05, G + H + 0.25, z + 0.2);   // porch lights
  // the ice machine and the bait cooler by the door
  f.col('#f4f4f0'); f.box(s0 - 1.1, G + 0.12, b - 2.2, s0 - 0.1, G + 2.0, b - 0.6); f.col('#2d6fb8'); f.box(s0 - 1.11, G + 1.45, b - 2.15, s0 - 1.09, G + 1.8, b - 0.65);
  f.col('#e8e8e2'); f.box(s0 - 1.0, G + 0.12, a + 0.6, s0 - 0.2, G + 0.9, a + 2.4); f.col('#3d7a54'); f.box(s0 - 1.02, G + 0.7, a + 0.6, s0 - 0.18, G + 0.78, a + 2.4);
  // crates and a coiled rope, buoys on the posts
  f.col('#9a7350'); f.box(s0 - 2.4, G + 0.12, mid + 4.2, s0 - 1.6, G + 0.8, mid + 5.0); f.box(s0 - 2.35, G + 0.8, mid + 4.3, s0 - 1.7, G + 1.35, mid + 4.95); f.col('#7d5c3e'); f.box(s0 - 2.4, G + 0.12, mid + 5.1, s0 - 1.7, G + 0.7, mid + 5.8);
  f.col('#d8c99a'); f.cyl(s0 - 2.2, mid - 4.6, 0.4, G + 0.12, G + 0.3, 12);
  const buoy = ['#ff6a1a', '#f4f4f0', '#e8c33a', '#2d6fb8'];
  for (let k = 0, z = a; z <= b + 1e-6; z += (b - a) / Math.max(1, Math.round((b - a) / 4)), k++) { f.col(buoy[k % 4]); f.sph(s0 - deep - 0.32, G + 2.2, z, 0.22, 0.3, 0.22, 8, 5); }
  // a rack of rods for sale, leaning on the wall; a chalkboard on an easel
  f.col('#5a4734'); f.box(s0 - 0.5, G + 0.12, mid + 1.4, s0 - 0.15, G + 0.3, mid + 3.6);
  for (let k = 0; k < 7; k++) { f.col(['#1d2023', '#7a2f22', '#2d6fb8', '#1d2023', '#3d7a54', '#c8a040', '#1d2023'][k]); const z = mid + 1.55 + k * 0.32; f.rod([s0 - 0.35, G + 0.3, z], [s0 - 0.1, G + 2.6, z + 0.05], 0.018, 4); }
  f.col('#3a2f26'); f.rod([s0 - 1.9, G + 0.12, mid - 2.0], [s0 - 1.7, G + 1.4, mid - 2.0], 0.03, 4); f.rod([s0 - 1.5, G + 0.12, mid - 2.0], [s0 - 1.7, G + 1.4, mid - 2.0], 0.03, 4);
  f.col('#1f2a24'); f.box(s0 - 1.86, G + 0.6, mid - 2.5, s0 - 1.8, G + 1.35, mid - 1.5);
}
/** The weigh-in station: a gallows of timber with a hanging scale and a records board beside it. */
function weighStation(f, s, z, G) {
  f.col('#6b5440'); for (const d of [-1.3, 1.3]) f.box(s - 0.1, G, z + d - 0.1, s + 0.1, G + 3.2, z + d + 0.1);
  f.box(s - 0.12, G + 3.0, z - 1.5, s + 0.12, G + 3.25, z + 1.5);
  f.col('#c9ced3'); f.rod([s, G + 3.0, z], [s, G + 2.5, z], 0.015, 4); f.box(s - 0.14, G + 2.2, z - 0.14, s + 0.14, G + 2.5, z + 0.14);
  f.col('#e8e2d0'); f.cyl(s - 0.15, z, 0.12, G + 2.27, G + 2.43, 10); f.col('#c9ced3'); f.rod([s, G + 2.2, z], [s, G + 1.95, z], 0.012, 4);
  f.col('#3a2f26'); f.box(s - 0.06, G, z + 2.2, s + 0.06, G + 2.2, z + 2.32); f.box(s - 0.06, G, z + 3.9, s + 0.06, G + 2.2, z + 4.02);
  f.col('#24405e'); f.box(s - 0.08, G + 1.0, z + 2.1, s + 0.04, G + 2.3, z + 4.1);
  f.col('#eee9dc'); for (let k = 0; k < 4; k++) f.box(s - 0.1, G + 1.15 + k * 0.25, z + 2.3, s - 0.08, G + 1.27 + k * 0.25, z + 3.9);
}
/** A harbour lamp: a tapered post on a base, a curved arm, a lantern hood with its glass glowing at night. */
function lampPost(f, s, z, y, h) {
  f.col('#2f3a44'); f.cyl(s, z, 0.2, y, y + 0.35, 10, 0.16); f.cyl(s, z, 0.085, y + 0.35, y + h, 8, 0.06);
  f.cyl(s, z, 0.1, y + h * 0.55, y + h * 0.58, 8);
  const ax = s + 0.62, top = y + h + 0.12;
  f.rod([s, y + h - 0.05, z], [s + 0.32, top, z], 0.04, 5); f.rod([s + 0.32, top, z], [ax, top - 0.06, z], 0.04, 5);
  f.lathe(ax, z, [[0.02, top + 0.02], [0.12, top - 0.04], [0.3, top - 0.22], [0.32, top - 0.26]], 12);
  f.col('#fff1c8', 0, 2); f.lathe(ax, z, [[0.24, top - 0.26], [0.18, top - 0.42], [0.0, top - 0.44]], 10);
}
// ------------------------------------------------------------------ the quay: its wall, cap, rocks at its foot
let rocks = 0;   // (how many rocks the last dock built has at its quay: lab checks)
function quay(f, m, K, G, Wr, groundAt) {
  const L = K.land, R = K.ramp, foot = Wr - 2.2, gap = [R.f0 - 0.6, R.f1 + 0.6];
  rocks = 0;
  const spans = [[L.f0, gap[0]], [gap[1], L.f1]];
  for (const [a, b] of spans) {
    f.col('#6d7278'); f.box(-0.55, foot, a, -0.35, G - 0.2, b);                       // the steel sheet piles
    f.col('#7d8389'); for (let z = a + 0.15; z < b - 0.3; z += 0.6) f.box(-0.7, foot, z, -0.55, G - 0.2, z + 0.3, 'tb');   // their corrugations
    f.col('#c3beb4'); f.box(-0.75, G - 0.25, a, 0.6, G + 0.08, b);                    // the concrete cap
    f.col('#3a3f45'); for (let z = a + 4; z < b - 1; z += 9) { f.cyl(-0.3, z, 0.17, G + 0.08, G + 0.42, 8); f.cyl(-0.3, z, 0.24, G + 0.4, G + 0.48, 8); }   // mooring bollards
    f.col('#2b3036'); for (let z = a + 2; z < b - 1; z += 4.5) f.box(-0.8, Wr - 0.3, z - 0.18, -0.72, Wr + 0.9, z + 0.18);   // rubbing strips (black)
    // rocks along the foot of the wall, on the ground there (not under the pier, the gangway or the courtesy dock where
    // they leave the quay)
    for (let z = a + 0.6; z < b - 0.4; z += 0.85) {
      if (K.decks.some(d => d.s1 >= -4 && d.s0 <= 0 && z > d.f0 - 1.2 && z < d.f1 + 1.2)) continue;
      const k = hash(z, a), s = -1.2 - k * 2.2, g = groundAt(s, z);
      if (g > G - 0.3) continue;
      const r = 0.25 + 0.35 * hash(z, 7); rocks++;
      f.col(shade('#7d7a74', (hash(z, 3) - 0.5) * 0.35)); f.sph(s, g + r * 0.3, z, r * (0.8 + 0.4 * hash(z, 9)), r * 0.65, r * (0.8 + 0.4 * hash(z, 11)), 5, 3);
    }
  }
}

// ------------------------------------------------------------------ the launch ramp
function ramp(f, m, K, G, Wr, groundAt) {
  const R = rampOf(m), top = R.top, yAt = s => (s - top) * R.slope + G + 0.03;
  const quad = (s0, z0, s1, z1, dy = 0, n = [0, 1, 0]) => f.quad([[s0, yAt(s0) + dy, z0], [s1, yAt(s1) + dy, z0], [s1, yAt(s1) + dy, z1], [s0, yAt(s0) + dy, z1]], n);
  f.col('#a9a49b'); quad(R.s0, R.f0, R.s1, R.f1);
  // grooves across it, for grip (the slab's V-grooves read as darker lines)
  f.col('#8e8981'); for (let s = R.s0 + 0.2; s < R.s1 - 0.2; s += 0.32) quad(s, R.f0 + 0.3, s + 0.07, R.f1 - 0.3, 0.006);
  // the lanes: a dashed white line between them on the dry part; side curbs out over the beach and the water
  if (R.lanes > 1) { f.col('#eeeeea'); const mid = (R.f0 + R.f1) / 2; for (let s = 1; s < top - 1; s += 3) quad(s, mid - 0.08, s + 1.6, mid + 0.08, 0.012); }
  f.col('#bdb8ae');
  for (const z of [R.f0, R.f1 - 0.3]) for (let s = R.s0; s < Math.min(0, R.s1); s += 2) { const s1 = Math.min(0, s + 2); f.quad([[s, yAt(s) + 0.25, z], [s1, yAt(s1) + 0.25, z], [s1, yAt(s1) + 0.25, z + 0.3], [s, yAt(s) + 0.25, z + 0.3]], [0, 1, 0]); f.quad([[s, yAt(s) - 0.3, z], [s1, yAt(s1) - 0.3, z], [s1, yAt(s1) + 0.25, z], [s, yAt(s) + 0.25, z]], [0, 0, -1]); f.quad([[s, yAt(s) - 0.3, z + 0.3], [s1, yAt(s1) - 0.3, z + 0.3], [s1, yAt(s1) + 0.25, z + 0.3], [s, yAt(s) + 0.25, z + 0.3]], [0, 0, 1]); }
  // retaining walls where it is cut below the land: from the quay to its top
  f.col('#c3beb4');
  for (const [z0, z1] of [[R.f0 - 0.6, R.f0], [R.f1, R.f1 + 0.6]]) for (let s = 0; s < top; s += 1) {
    const a = yAt(s) - 0.4, b = yAt(Math.min(top, s + 1)) - 0.4;
    f.quad([[s, G + 0.15, z0], [s + 1, G + 0.15, z0], [s + 1, G + 0.15, z1], [s, G + 0.15, z1]], [0, 1, 0]);
    f.quad([[s, a, z0], [s + 1, b, z0], [s + 1, G + 0.15, z0], [s, G + 0.15, z0]], [0, 0, -1]);
    f.quad([[s, a, z1], [s + 1, b, z1], [s + 1, G + 0.15, z1], [s, G + 0.15, z1]], [0, 0, 1]);
  }
  // the sign at its top
  const sz = R.f0 - 2.2; f.col('#3a3f45'); for (const d of [-0.8, 0.8]) f.cyl(top + 1.2, sz + d, 0.05, G, G + 2.4, 6);
  f.col('#1f5fa8'); f.box(top + 1.15, G + 1.5, sz - 1.05, top + 1.22, G + 2.5, sz + 1.05);   // (its words face the car park: dockSigns)
  void groundAt;
}

// ------------------------------------------------------------------ piers, gangways and floating docks
function deck(f, d, y0, y1, Wr, K) {
  const { s0, f0, s1, f1, kind, along } = d, fixed = kind === 'pier' || kind === 'head' || kind === 'courtesy', gang = kind === 'gang';
  const yAt = u => y0 + (y1 - y0) * u;   // u: 0 … 1 along the deck's slope (a gangway's)
  const bottom = Wr - (K.basin.depth + 1.6);
  if (gang) {   // aluminium: a treaded plate between two trussed rails
    for (let k = 0; k < 10; k++) { const a = k / 10, b = (k + 1) / 10, za = f0 + (f1 - f0) * a, zb = f0 + (f1 - f0) * b; f.col('#b8bec4'); f.quad([[s0, yAt(a), za], [s1, yAt(a), za], [s1, yAt(b), zb], [s0, yAt(b), zb]], [0, 1, 0]); f.col('#9aa1a8'); f.quad([[s0 + 0.1, yAt((a + b) / 2) + 0.01, (za + zb) / 2 - 0.03], [s1 - 0.1, yAt((a + b) / 2) + 0.01, (za + zb) / 2 - 0.03], [s1 - 0.1, yAt((a + b) / 2) + 0.01, (za + zb) / 2 + 0.03], [s0 + 0.1, yAt((a + b) / 2) + 0.01, (za + zb) / 2 + 0.03]], [0, 1, 0]); }
    f.col('#c8cdd2');
    for (const x of [s0 + 0.05, s1 - 0.05]) {
      f.rod([x, y0 + 1.0, f0], [x, y1 + 1.0, f1], 0.035, 6); f.rod([x, y0 + 0.5, f0], [x, y1 + 0.5, f1], 0.025, 5);
      for (let k = 0; k <= 6; k++) { const u = k / 6, z = f0 + (f1 - f0) * u; f.rod([x, yAt(u), z], [x, yAt(u) + 1.0, z], 0.025, 5); }
    }
    f.col('#3a3f45'); f.box(s0, y1 - 0.08, f1 - 0.15, s1, y1 + 0.02, f1 + 0.4);   // its roller plate on the float
    return;
  }
  // the boards: across the deck's long way (a sloped deck - a pier's root - in steps, a board at a time)
  const longS = s1 - s0 >= f1 - f0, len = longS ? s1 - s0 : f1 - f0, wid = longS ? f1 - f0 : s1 - s0;
  const yS = s => (along === 's' && y1 !== y0 ? y0 + (y1 - y0) * (s - s0) / (s1 - s0) : y0);
  const P = (u, v, y) => (longS ? [s0 + u, y, f0 + v] : [s0 + v, y, f0 + u]);   // u along the deck, v across it
  const bw = fixed ? 0.19 : 0.15, base = fixed ? '#8a6a4b' : '#9da3a8';
  for (let a = 0; a < len - 1e-6; a += bw + 0.02) {
    const b = Math.min(len, a + bw);
    f.col(shade(base, (hash(a + s0, f0 + b) - 0.5) * 0.18));
    if (longS) { const y = yS(s0 + (a + b) / 2); f.box(s0 + a, y - 0.05, f0, s0 + b, y, f1, 'b'); }
    else f.box(s0, y0 - 0.05, f0 + a, s1, y0, f0 + b, 'b');
  }
  if (fixed) {
    // stringers under the boards (a level deck's), pile caps across it every 3.5 m on round piles, braced in pairs
    if (y0 === y1) { f.col('#5f4a36'); for (const v of [0.25, wid / 2, wid - 0.25]) { const A = P(0, v - 0.06, y0 - 0.3), B = P(len, v + 0.06, y0 - 0.05); f.box(A[0], A[1], A[2], B[0], B[1], B[2], 't'); } }
    const n = Math.max(1, Math.round(len / 3.5)), across = wid > 6 ? [0.15, wid / 2, wid - 0.15] : [0.15, wid - 0.15];
    for (let k = 0; k <= n; k++) {
      const u = len * k / n, y = longS ? yS(s0 + u) : y0;
      f.col('#4d3c2c'); { const A = P(u - 0.15, -0.1, y - 0.6), B = P(u + 0.15, wid + 0.1, y - 0.3); f.box(A[0], A[1], A[2], B[0], B[1], B[2]); }
      for (const v of across) { const [x, , z] = P(u, v, 0); f.col('#5a4734'); f.cyl(x, z, 0.17, bottom, y + 0.12, 8); f.col('#6e6a62'); f.cyl(x, z, 0.19, Wr - 0.5, Wr + 0.15, 8); }   // (a band of weed and barnacles at the waterline)
      if (k < n && Wr < y - 1.2) {
        const u2 = len * (k + 1) / n; f.col('#4d3c2c');
        for (const v of [0.15, wid - 0.15]) { f.rod(P(u, v, y - 0.6), P(u2, v, Wr + 0.1), 0.06, 5); f.rod(P(u2, v, y - 0.6), P(u, v, Wr + 0.1), 0.06, 5); }
      }
    }
  } else {
    // floating: white fascia round the edge, black float pontoons at the waterline, cleats, fenders on the fingers
    f.col('#eef0f0');
    f.box(s0, y0 - 0.32, f0 - 0.06, s1, y0 - 0.02, f0, 't'); f.box(s0, y0 - 0.32, f1, s1, y0 - 0.02, f1 + 0.06, 't');
    f.box(s0 - 0.06, y0 - 0.32, f0, s0, y0 - 0.02, f1, 't'); f.box(s1, y0 - 0.32, f0, s1 + 0.06, y0 - 0.02, f1, 't');
    f.col('#1d2023'); f.box(s0 + 0.08, Wr - 0.3, f0 + 0.08, s1 - 0.08, y0 - 0.32, f1 - 0.08);
    if (kind === 'finger') {
      f.col('#2d6fb8'); for (const z of [f0 - 0.08, f1]) for (let s = s0 + 0.8; s < s1 - 0.6; s += 2.2) f.box(s, y0 - 0.3, z, s + 1.4, y0 - 0.04, z + 0.08);
      for (const z of [f0 + 0.12, f1 - 0.12]) for (const s of [s0 + 0.7, (s0 + s1) / 2, s1 - 0.6]) cleat(f, s, y0, z);
      f.col('#e8e8e4'); f.box(s1 - 0.5, y0, f0 + 0.3, s1 - 0.2, y0 + 1.05, f1 - 0.3);   // the power pedestal at its root
      f.col('#4ade80', 0, 2); f.box(s1 - 0.52, y0 + 0.8, f0 + 0.35, s1 - 0.5, y0 + 0.92, f0 + 0.45);
      f.col('#9aa0a7'); f.cyl((s0 + s1) / 2 - 0.1, f0 - 0.35, 0.2, Wr - K.basin.depth - 1, y0 + 2.4, 10);   // a guide pile, and its cap
      f.col('#eef0f0'); f.cyl((s0 + s1) / 2 - 0.1, f0 - 0.35, 0.24, y0 + 2.4, y0 + 2.5, 10);
      f.cyl(s0 + 0.2, (f0 + f1) / 2, 0.2, Wr - K.basin.depth - 1, y0 + 2.2, 10); f.col('#eef0f0'); f.cyl(s0 + 0.2, (f0 + f1) / 2, 0.24, y0 + 2.2, y0 + 2.3, 10);
    } else for (let z = f0 + 2; z < f1 - 1; z += 6) cleat(f, s0 + 0.15, y0, z);
  }
}
function cleat(f, s, y, z) {
  f.col('#c9ced3'); f.box(s - 0.06, y, z - 0.07, s + 0.06, y + 0.08, z + 0.07); f.box(s - 0.03, y + 0.07, z - 0.18, s + 0.03, y + 0.11, z + 0.18);
}
/** A rail along a wall line: posts every 2 m, a top rail and a middle one (galvanised). */
function rail(f, [s0, f0, s1, f1, h], y) {
  const alongS = s1 - s0 > f1 - f0, len = alongS ? s1 - s0 : f1 - f0, c = alongS ? (f0 + f1) / 2 : (s0 + s1) / 2, n = Math.max(1, Math.round(len / 2));
  const P = (u, yy) => (alongS ? [s0 + len * u, yy, c] : [c, yy, f0 + len * u]);
  f.col('#aab1b8');
  for (let k = 0; k <= n; k++) { const [x, , z] = P(k / n, 0); f.cyl(x, z, 0.035, y, y + h, 6); }
  f.rod(P(0, y + h), P(1, y + h), 0.03, 6); f.rod(P(0, y + h * 0.5), P(1, y + h * 0.5), 0.022, 5);
}

// ------------------------------------------------------------------ fittings: lamps on the pier, life rings, ladders, fuel, cleaning
function fixtures(f, m, K, G, Wr, yOf) {
  const sea = K.water === 'sea', head = K.decks.find(d => d.kind === 'head');
  const pier = K.decks.filter(d => d.kind === 'pier' && d.y0 === d.y1).sort((a, b) => (a.s0 - a.s1) - (b.s0 - b.s1))[0];   // the main pier: the longest level one
  const Y = Wr + pier.y0;
  // lamps along the pier's outer side, life rings on posts
  for (let s = pier.s1 - 6; s > pier.s0 + 2; s -= sea ? 16 : 10) lampPost(f, s, pier.f0 + 0.25, Y, sea ? 4.2 : 3.4);
  const ring = (s, z) => {
    f.col('#3a3f45'); f.cyl(s, z, 0.05, Y, Y + 1.5, 6);
    f.col('#ff6a1a'); for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, b = (k + 1) / 12 * Math.PI * 2; f.rod([s, Y + 1.1 + Math.sin(a) * 0.32, z + 0.08 + Math.cos(a) * 0.32], [s, Y + 1.1 + Math.sin(b) * 0.32, z + 0.08 + Math.cos(b) * 0.32], 0.07, 5); }
    f.col('#f4f4f0'); for (const a of [0.3, 1.9, 3.4, 5]) f.rod([s, Y + 1.1 + Math.sin(a) * 0.32, z + 0.08 + Math.cos(a) * 0.32], [s, Y + 1.1 + Math.sin(a + 0.25) * 0.32, z + 0.08 + Math.cos(a + 0.25) * 0.32], 0.075, 5);
  };
  ring((pier.s0 + pier.s1) / 2, pier.f0 + 0.2);
  if (head) { ring(head.s0 + 0.3, head.f0 + 0.2); for (let z = head.f0 + 1; z < head.f1; z += 4) { f.col('#22262a'); f.cyl(head.s0 + 0.35, z, 0.14, Y, Y + 0.45, 8); f.cyl(head.s0 + 0.35, z, 0.2, Y + 0.42, Y + 0.5, 8); } }
  // ladders down to the water
  for (const [s, z] of K.ladders) {
    const outF = Math.abs(z - pier.f0) < 0.3 ? -1 : Math.abs(z - pier.f1) < 0.3 ? 1 : 0, outS = outF ? 0 : -1, dz = outF * 0.12, ds = outS * 0.12;
    f.col('#c8cdd2');
    for (const e of [-0.22, 0.22]) f.rod([s + ds + (outF ? e : 0), Wr - 1.2, z + dz + (outF ? 0 : e)], [s + ds + (outF ? e : 0), Y + 0.9, z + dz + (outF ? 0 : e)], 0.03, 5);
    for (let y = Wr - 1; y < Y; y += 0.3) f.rod([s + ds - (outF ? 0.22 : 0), y, z + dz - (outF ? 0 : 0.22)], [s + ds + (outF ? 0.22 : 0), y, z + dz + (outF ? 0 : 0.22)], 0.025, 4);
  }
  // the fuel pump and its kiosk on the T-head (the marina's)
  const kiosk = K.walls.find(w => w[4] > 2);
  if (kiosk) {
    const [s0, f0, s1, f1, h] = kiosk, y = yOf(kiosk[5]);
    f.col('#f2f0ea'); f.box(s0, y, f0, s1, y + h - 0.2, f1);
    f.col('#2b5a8a'); f.box(s0 - 0.3, y + h - 0.2, f0 - 0.3, s1 + 0.3, y + h + 0.05, f1 + 0.3);
    f.col('#1b2a36'); f.box(s1, y + 1.0, f0 + 0.6, s1 + 0.02, y + 2.0, f1 - 0.6);
    f.col('#ffe9b0', 0, 2); f.box(s1 + 0.01, y + 1.1, f0 + 0.7, s1 + 0.025, y + 1.9, f1 - 0.7);
    const ps = (s0 + s1) / 2, pz = f0 - 1.5;   // (the pump on the head's deck beside the kiosk, toward its open end: shared/dock-layout.js walls)
    f.col('#c8312a'); f.box(ps - 0.35, y, pz - 0.3, ps + 0.35, y + 1.55, pz + 0.3);
    f.col('#f4f4f0'); f.box(ps - 0.36, y + 1.0, pz - 0.31, ps + 0.36, y + 1.4, pz + 0.31);
    f.col('#1b1d20'); f.box(ps - 0.37, y + 1.12, pz - 0.2, ps - 0.36, y + 1.32, pz + 0.2);
    f.col('#232629'); f.rod([ps - 0.35, y + 1.2, pz + 0.3], [ps - 0.9, y + 0.6, pz + 0.7], 0.03, 5); f.rod([ps - 0.9, y + 0.6, pz + 0.7], [ps - 0.5, y + 0.15, pz + 0.9], 0.03, 5);
  }
  // the fish-cleaning station: a stainless bench with sinks under a small roof, a hose reel
  const bench = K.walls.find(w => w[4] < 1);
  if (bench) {
    const [s0, f0, s1, f1] = bench, y = yOf(bench[5]);
    f.col('#c9ced3'); f.box(s0, y + 0.85, f0, s1, y + 0.95, f1);
    f.col('#8e959c'); for (const [x, z] of [[s0 + 0.1, f0 + 0.1], [s1 - 0.1, f0 + 0.1], [s0 + 0.1, f1 - 0.1], [s1 - 0.1, f1 - 0.1]]) f.box(x - 0.04, y, z - 0.04, x + 0.04, y + 0.85, z + 0.04);
    f.col('#6f767d'); for (let z = f0 + 1; z < f1 - 0.8; z += 2.2) f.box(s0 + 0.3, y + 0.8, z, s1 - 0.3, y + 0.951, z + 1.4);
    f.col('#3a3f45'); for (const [x, z] of [[s0 - 0.2, f0 - 0.2], [s1 + 0.2, f0 - 0.2], [s0 - 0.2, f1 + 0.2], [s1 + 0.2, f1 + 0.2]]) f.cyl(x, z, 0.06, y, y + 2.7, 6);
    f.col('#2b5a8a'); f.box(s0 - 0.5, y + 2.7, f0 - 0.5, s1 + 0.5, y + 2.82, f1 + 0.5);
    f.col('#2f855a'); f.cyl(s1 + 0.25, (f0 + f1) / 2, 0.22, y + 0.6, y + 0.75, 10);
  }
}

// ------------------------------------------------------------------ names
/**
 * The dock's words - its name on the entrance sign (to the road), the store's on its porch board, BOAT RAMP, WEIGH-IN,
 * FUEL - as one mesh: every line in one canvas, a quad each (one draw call for all of them).
 */
function dockSigns(m) {
  const K = DOCKS[m.kind], G = -0.05, E = K.roadEnd, Wr = waterOf(m) - m.y, St = K.store, R = K.ramp, items = [];
  items.push({ text: (m.name || 'Marina').toUpperCase(), w: 4.4, h: 0.42, s: E.s - 3.5, f: E.f - 7.1, y: G + 1.0, face: 1 });
  items.push({ text: (m.name || 'Marina').toUpperCase(), w: 4.4, h: 0.42, s: E.s - 4.7, f: E.f - 7.1, y: G + 1.0, face: -1 });
  items.push({ text: St.name.toUpperCase(), w: Math.min(11, St.f1 - St.f0 - 5), h: 0.62, s: St.s0 - 2.8 - 0.64, f: (St.f0 + St.f1) / 2, y: G + 3.3 + 0.55, face: -1 });
  items.push({ text: 'BOAT RAMP', w: 1.9, h: 0.34, s: R.top + 1.24, f: R.f0 - 2.2, y: G + 2.05, face: 1 });
  if (K.plan.weigh) items.push({ text: 'WEIGH-IN', w: 1.8, h: 0.26, s: K.plan.weigh[0] - 0.13, f: K.plan.weigh[1], y: G + 3.38, face: -1 });
  const kiosk = K.walls.find(w => w[4] > 2);
  if (kiosk) items.push({ text: 'FUEL', w: 2.2, h: 0.36, s: kiosk[0] - 0.33, f: (kiosk[1] + kiosk[3]) / 2, y: Wr + kiosk[5] + kiosk[4] - 0.05, face: -1 });
  const px = 96, c = document.createElement('canvas'), g = c.getContext('2d'), font = `700 ${Math.round(px * 0.74)}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  g.font = font; const widths = items.map(it => Math.ceil(g.measureText(it.text).width + px * 0.6));
  c.width = Math.min(2048, Math.max(...widths)); c.height = px * items.length;
  g.font = font; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  items.forEach((it, k) => g.fillText(it.text, Math.min(c.width, widths[k]) / 2, px * (k + 0.54), c.width));
  const pos = [], uv = [], idx = [];
  items.forEach((it, k) => {
    const aspect = Math.min(c.width, widths[k]) / px, ww = Math.min(it.w, it.h * aspect), hh = ww / aspect;
    const p = toWorldAt(m, it.s, it.f), yaw = m.rot + it.face * Math.PI / 2, ax = Math.cos(yaw), az = -Math.sin(yaw), y = m.y + it.y;
    const u1 = Math.min(c.width, widths[k]) / c.width, v0 = 1 - (k + 1) / items.length, v1 = 1 - k / items.length, b = pos.length / 3;
    for (const [sx, sy, u, v] of [[-1, -1, 0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, 0, v1]]) { pos.push(p.x + ax * sx * ww / 2, y + sy * hh / 2, p.z + az * sx * ww / 2); uv.push(u, v); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  mesh.renderOrder = 3; mesh.name = 'dock-signs';
  return mesh;
}

// ------------------------------------------------------------------ building and keeping them
function build() {
  dirty = false;
  const list = modulesOf(S.world).filter(m => DOCKS[m.kind] && Number.isFinite(m.y)), keep = new Set();
  for (const m of list) {
    const key = `${m.id}:${m.kind}:${m.x}:${m.z}:${m.rot}:${m.y}:${m.wy}:${m.name}`; keep.add(key);
    if (meshes.has(key)) continue;
    const T = app.terrain, at = (s, fz) => { const p = toWorldAt(m, s, fz); return (T?.pointHeight(p.x, p.z) ?? m.y) - m.y; };
    const mesh = new THREE.Mesh(dockGeometry(m, at), gmat); mesh.receiveShadow = true; mesh.castShadow = true; mesh.name = `dock-${m.id}`;
    const signs = dockSigns(m); signs.matrixAutoUpdate = false;   // (in world coordinates: the dock's mesh is not moved)
    mesh.add(signs);
    mesh.userData.at = { x: m.x, z: m.z }; mesh.userData.rocks = rocks;
    meshes.set(key, mesh); group.add(mesh);
  }
  for (const [key, mesh] of meshes) if (!keep.has(key)) unbuild(key, mesh);
}
function unbuild(key, mesh) { group.remove(mesh); mesh.geometry.dispose(); for (const c of mesh.children) { c.geometry.dispose(); c.material.map?.dispose(); c.material.dispose(); } meshes.delete(key); }
/** Every dock built again on the next frame (the ground changed under them). */
function drop() { for (const [key, mesh] of [...meshes]) unbuild(key, mesh); }
let farCheck = 0;
function update(dt, now) {
  if (!S.world) return;
  if (dirty) { if (!app.terrain?.ground && modulesOf(S.world).length) return; build(); slips = boatSlips(S.world); }
  if (slips.length) { waterMarks(app.stage); mooredBoats((now ?? performance.now()) / 1000); }   // (the water lapping at them: its marks)
  if (performance.now() - farCheck < 500 || !meshes.size) return;
  farCheck = performance.now();
  const c = app.stage.camera.position;
  for (const mesh of meshes.values()) mesh.visible = Math.hypot(mesh.userData.at.x - c.x, mesh.userData.at.z - c.z) < FAR;
}
