// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing boats (docs/features/fishing.md §Boats; their handling: shared/boat-model.js), built in code like the
// aircraft: bow along +z, port along +x, the waterline at y = 0, one piece each. Hulls lofted from cross-sections
// (render/vessels.js hull: a fine entry, flare, a deep V for the sea boat, the transom), painted in bands.
//   · Coastal Fisher 26 - a centre console sport fisher: deep-V hull with a boot stripe and sheer stripe, a rub rail; the
//     cockpit sole; a raised bow casting deck with cushions and a bow rail; the console (windscreen and grab rail, the
//     wheel and throttle, a chartplotter and fish finder), the T-top on four posts with its rocket launcher of rods; a
//     leaning post with a tackle station; a cooler seat; the livewell in the transom; gunwale rod holders, cleats,
//     navigation lights, the anchor at the bow; twin outboards (their own parts: they turn with the wheel).
//   · Lake Skiff 16 - a riveted aluminium modified-V: green topsides, raised casting decks fore and aft (carpeted) with
//     pedestal seats, a side console, a bow trolling motor, a livewell, a single 40 hp outboard (its own part).
// boatParts(type) → { body, motors: [{ geo, at: [x, y, z] (the pivot) }] }; boatGeometry(type) → all in one (moored).
import { FB } from './furniture.js';
import { hull, rail } from './vessels.js';
import { BOATS } from '/shared/boat-model.js';

const TAU = Math.PI * 2;
/** Each boat's hull (render/vessels.js hull; the water keeps out of it: render/water-marks.js hullAt). */
export const HULL_FORM = Object.freeze({
  coastal: Object.freeze({ L: BOATS.coastal.L, B: BOATS.coastal.B, free: 0.95, rise: 0.38, draft: 0.55, vee: 0.9, transom: 0.86 }),
  skiff: Object.freeze({ L: BOATS.skiff.L, B: BOATS.skiff.B, free: 0.58, rise: 0.16, draft: 0.3, vee: 0.45, transom: 0.92 }),
});
/** A steering wheel facing aft at (x, y, z), radius r, tilted back. */
function wheel(f, x, y, z, r) {
  const n = 14, tilt = 0.5, P = a => [x + Math.cos(a) * r, y + Math.sin(a) * r * Math.cos(tilt), z - Math.sin(a) * r * Math.sin(tilt)];
  f.col('#1d2023'); for (let k = 0; k < n; k++) f.rod(P(k / n * TAU), P((k + 1) / n * TAU), 0.022, 4);
  f.col('#9aa1a8'); for (let k = 0; k < 3; k++) f.rod([x, y, z], P(k / 3 * TAU + 0.5), 0.012, 4);
  f.cyl(x, z + 0.06, 0.04, y - 0.03, y + 0.03, 6);
}
/** A rod standing in a holder, tip up and out (its line's guides as dots), from the holder's mouth (x, y, z). */
function rodAt(f, x, y, z, dx, dz, len, col) {
  f.col('#2b2f33'); f.cyl(x, z, 0.03, y - 0.25, y, 6);                                                      // the holder
  f.col(col); f.rod([x, y - 0.1, z], [x + dx * len * 0.35, y + len * 0.93, z + dz * len * 0.35], 0.016, 4);
  f.col('#c9ced3'); f.cyl(x, z, 0.045, y + 0.05, y + 0.16, 8);                                            // the reel
}
/** An outboard motor (its pivot at the transom's top, y0): cowling, the mid-section and the leg down into the water. */
function outboard(f, hp, colour = '#f4f4f0') {
  const big = hp > 100, w = big ? 0.34 : 0.22, h = big ? 0.85 : 0.55, d = big ? 0.7 : 0.48;
  f.col('#3a3e45'); f.box(-0.08, -0.15, -0.05, 0.08, 0.1, 0.12);                                             // the bracket
  f.col(colour); f.box(-w, 0.05, -d, w, 0.05 + h * 0.62, 0.05);                                             // the cowling
  f.col('#1d2023'); f.box(-w * 0.98, 0.05 + h * 0.62, -d * 0.95, w * 0.98, 0.05 + h, 0.02);                 // its cap
  f.col('#c8312a'); f.box(-w - 0.005, 0.05 + h * 0.3, -d * 0.8, w + 0.005, 0.05 + h * 0.4, -0.05);          // a band of colour
  const leg = big ? 1.45 : 0.92;
  f.col('#2b2f33'); f.box(-0.08, -leg, -d * 0.55, 0.08, 0.05, -d * 0.2);                                     // the mid-section, the leg
  f.col('#3a3e45'); f.box(-0.12, -leg + 0.12, -d * 0.75, 0.12, -leg + 0.2, 0.02);                            // the anti-ventilation plate
  f.lathe(0, -d * 0.4, [[0.0, -leg - 0.12], [0.07, -leg - 0.1], [0.07, -leg + 0.02], [0.0, -leg + 0.04]], 8);   // (the gearcase's torpedo)
  f.col('#8a9097'); f.box(-0.01, -leg - 0.22, -d * 0.48, 0.01, -leg - 0.12, -d * 0.3);                        // the skeg
  return { w, h };
}

function coastal(withMotors) {
  const S = BOATS.coastal, f = new FB(), tf = withMotors ? f : new FB();   // (a boat out: its T-top's canopy a part of its own, hidden when it's in the way of the camera on deck)
  const st = hull(f, { ...HULL_FORM.coastal, open: true, wall: 0.08,
    bands: [[-0.05, '#22344a'], [0.14, '#14263a'], [0.72, '#f4f4f0'], [0.82, '#1f6fb2'], [9, '#f4f4f0']] });
  const at = z => { let best = st[0]; for (const s of st) if (Math.abs(s.z - z) < Math.abs(best.z - z)) best = s; return best; };
  // the cockpit sole, a little over the water (self-bailing), non-skid grey; the gunwale's cap and the rub rail
  f.col('#dcd8cf');
  for (let i = 0; i + 1 < st.length; i++) { const a = st[i], b = st[i + 1]; if (a.z > 2.6) break; const wa = a.b * 0.86, wb = b.b * 0.86; const v = [[-wa, S.floor, a.z], [wa, S.floor, a.z], [wb, S.floor, b.z], [-wb, S.floor, b.z]].map(p => f.vert(p[0], p[1], p[2], 0, 1, 0)); f.tri(v[0], v[1], v[2]); f.tri(v[0], v[2], v[3]); }
  f.col('#2b2f33'); for (let i = 0; i + 1 < st.length; i++) for (const sd of [1, -1]) f.rod([sd * (st[i].b + 0.015), st[i].s - 0.06, st[i].z], [sd * (st[i + 1].b + 0.015), st[i + 1].s - 0.06, st[i + 1].z], 0.035, 4);
  // the bow casting deck: raised, cushioned; the anchor locker's hatch; a bow rail; the anchor on its roller
  const bd = st.filter(s => s.z >= 2.4);
  f.col('#e9e6df');
  for (let i = 0; i + 1 < bd.length; i++) { const a = bd[i], b = bd[i + 1], y = 0.66; const v = [[-a.b * 0.88, y, a.z], [a.b * 0.88, y, a.z], [b.b * 0.88, y, b.z], [-b.b * 0.88, y, b.z]].map(p => f.vert(p[0], p[1], p[2], 0, 1, 0)); f.tri(v[0], v[1], v[2]); f.tri(v[0], v[2], v[3]); }
  { const a = at(2.4); f.col('#e9e6df'); f.box(-a.b * 0.88, S.floor, 2.36, a.b * 0.88, 0.66, 2.44); }
  f.col('#24405e'); f.box(-0.6, 0.66, 2.48, 0.6, 0.72, 2.82); f.box(-0.4, 0.66, 2.82, 0.4, 0.72, 3.18);         // cushions (inside the bow's taper)
  f.col('#c9c5bc'); f.box(-0.32, 0.66, 3.4, 0.32, 0.68, 3.75);                                               // the locker's hatch
  const fwd = st.filter(s => s.z > 1.0).map(s => [s.b - 0.07, s.s, s.z]);
  rail(f, fwd, 0.62, '#d7dbe0', 1.0); rail(f, fwd.map(([x, y, z]) => [-x, y, z]), 0.62, '#d7dbe0', 1.0);
  f.col('#c9ced3'); f.box(-0.06, st.at(-1).s - 0.05, 4.0, 0.06, st.at(-1).s + 0.05, 4.3); f.col('#8a9097'); f.box(-0.12, st.at(-1).s - 0.25, 4.15, 0.12, st.at(-1).s - 0.05, 4.32);   // the anchor's roller and fluke
  f.col('#ff3b30', 0, 2); f.box(0.12, st.at(-2).s, 3.75, 0.2, st.at(-2).s + 0.08, 3.9); f.col('#3ddc84', 0, 2); f.box(-0.2, st.at(-2).s, 3.75, -0.12, st.at(-2).s + 0.08, 3.9);   // navigation lights
  // the cooler seat before the console
  f.col('#f4f4f0'); f.box(-0.5, S.floor, 0.45, 0.5, 0.88, 1.05); f.col('#24405e'); f.box(-0.48, 0.88, 0.47, 0.48, 0.96, 1.03); f.col('#c9ced3'); f.box(-0.5, 0.6, 1.05, -0.38, 0.66, 1.08); f.box(0.38, 0.6, 1.05, 0.5, 0.66, 1.08);
  // the console: its walls, a raked windscreen over the dash, the grab rail, the electronics, the wheel and the lever
  const c0 = -0.85, c1 = 0.3, cy = 1.55;   // (the dash 1.1 m over the sole: the wheel at a standing skipper's hands - shared/boat-model.js helm)
  f.col('#f4f4f0'); f.box(-0.56, S.floor, c0, 0.56, cy, c1);
  f.quad([[-0.56, cy, c1], [0.56, cy, c1], [0.56, cy + 0.12, c0 + 0.25], [-0.56, cy + 0.12, c0 + 0.25]], [0, 0.9, 0.4]);   // the dash, sloping to the skipper
  f.col('#7fa6bf'); f.quad([[-0.55, cy, c1 + 0.02], [0.55, cy, c1 + 0.02], [0.5, cy + 0.42, c1 - 0.2], [-0.5, cy + 0.42, c1 - 0.2]], [0, 0.45, 0.9]);   // the windscreen
  f.col('#c9ced3'); f.rod([-0.6, cy + 0.05, c1 + 0.05], [-0.6, cy + 0.32, c1 - 0.12], 0.02, 5); f.rod([0.6, cy + 0.05, c1 + 0.05], [0.6, cy + 0.32, c1 - 0.12], 0.02, 5); f.rod([-0.6, cy + 0.32, c1 - 0.12], [0.6, cy + 0.32, c1 - 0.12], 0.02, 5);
  f.col('#1d2023'); f.box(-0.32, cy + 0.02, c0 + 0.32, 0.12, cy + 0.32, c0 + 0.38); f.col('#3a8ae8', 0, 1); f.box(-0.3, cy + 0.05, c0 + 0.31, 0.1, cy + 0.29, c0 + 0.315);   // the chartplotter / fish finder
  wheel(f, 0.0, cy - 0.12, c0 - 0.06, 0.2);
  f.col('#3a3e45'); f.box(-0.45, cy - 0.05, c0 - 0.06, -0.32, cy + 0.05, c0 + 0.1); f.col('#1d2023'); f.rod([-0.38, cy + 0.05, c0 + 0.02], [-0.38, cy + 0.3, c0 - 0.05], 0.018, 4); f.sph(-0.38, cy + 0.32, c0 - 0.06, 0.04, 0.04, 0.04, 6, 4);   // the throttle lever
  // the T-top: four posts from the console's corners up to its canopy, the rocket launcher of rods on its aft edge
  const ty = 2.62;
  f.col('#d7dbe0'); for (const [x, z] of [[-0.62, c1 + 0.05], [0.62, c1 + 0.05], [-0.62, c0 - 0.6], [0.62, c0 - 0.6]]) f.rod([x, x === -0.62 || x === 0.62 ? (z > 0 ? cy - 0.2 : S.floor) : S.floor, z], [x * 0.95, ty, z], 0.035, 6);
  tf.col('#24405e'); tf.box(-0.85, ty, c0 - 0.85, 0.85, ty + 0.08, c1 + 0.35);
  tf.col('#ffe9b0', 0, 2); tf.box(-0.2, ty - 0.02, c0 - 0.2, 0.2, ty, c0 + 0.1);                               // its light, over the helm
  for (let k = 0; k < 4; k++) rodAt(tf, -0.6 + k * 0.4, ty + 0.08, c0 - 0.8, 0, -0.5, 2.0, ['#1d2023', '#c8a040', '#7a2f22', '#2d6fb8'][k]);
  // the leaning post behind the console: a bolster seat, its backrest, the tackle station's drawers
  f.col('#f4f4f0'); f.box(-0.5, S.floor, c0 - 1.3, 0.5, 0.95, c0 - 0.95);
  f.col('#24405e'); f.box(-0.5, 0.95, c0 - 1.32, 0.5, 1.12, c0 - 0.93); f.box(-0.5, 1.12, c0 - 1.32, 0.5, 1.45, c0 - 1.22);
  f.col('#c9c5bc'); for (let k = 0; k < 3; k++) f.box(-0.4, S.floor + 0.08 + k * 0.15, c0 - 1.31, 0.4, S.floor + 0.2 + k * 0.15, c0 - 1.3);
  f.col('#c9ced3'); for (const sd of [-1, 1]) { f.cyl(sd * 0.35, c0 - 1.4, 0.03, 1.12, 1.4, 6); }   // its rod holders
  // the transom: the livewell's lid, a swim ladder, the stern light; rod holders and cleats along the gunwales
  const T = st[0];
  f.col('#e9e6df'); f.box(-T.b * 0.8, S.floor, T.z + 0.06, T.b * 0.8, 0.85, T.z + 0.6);
  f.col('#c9c5bc'); f.box(-0.4, 0.85, T.z + 0.12, 0.4, 0.87, T.z + 0.52);
  f.col('#c9ced3'); for (const sd of [1, -1]) f.rod([sd * 0.95, 0.85, T.z + 0.1], [sd * 0.95, -0.4, T.z - 0.25], 0.02, 4); for (let y = -0.3; y < 0.8; y += 0.28) f.rod([0.85, y, T.z - 0.25 + (0.85 - y) * 0.25], [1.05, y, T.z - 0.25 + (0.85 - y) * 0.25], 0.018, 4);
  f.col('#d7dbe0'); f.rod([T.b * 0.6, 0.85, T.z + 0.15], [T.b * 0.6, 1.9, T.z + 0.15], 0.018, 5); f.col('#ffffff', 0, 2); f.sph(T.b * 0.6, 1.95, T.z + 0.15, 0.05, 0.06, 0.05, 6, 4);
  for (const sd of [1, -1]) for (const z of [-2.8, -1.8, 1.4]) { const s = at(z); f.col('#2b2f33'); f.cyl(sd * (s.b - 0.12), z, 0.04, s.s - 0.3, s.s + 0.01, 6); }
  for (const sd of [1, -1]) for (const z of [-3.6, 0.1, 3.0]) { const s = at(z); f.col('#c9ced3'); f.box(sd * (s.b - 0.1) - 0.04, s.s, z - 0.12, sd * (s.b - 0.1) + 0.04, s.s + 0.06, z + 0.12); }
  // the outboards on the transom (own parts, unless drawn moored all in one)
  const motors = [-0.55, 0.55].map(x => ({ x, y: 0.75, z: T.z - 0.02 }));
  if (withMotors) for (const m of motors) { f.push(m.x, m.y, m.z, 0); outboard(f, 200); f.pop(); }
  return { f, motors, hp: 200, top: withMotors ? null : tf, topBox: { x: 0.85, z0: c0 - 0.85, z1: c1 + 0.35, y: ty } };
}

function skiff(withMotors) {
  const S = BOATS.skiff, f = new FB();
  const st = hull(f, { ...HULL_FORM.skiff, open: true, wall: 0.05,
    bands: [[-0.02, '#7a8086'], [0.3, '#8b9197'], [0.5, '#2f6b3a'], [9, '#d8dde2']] });
  const at = z => { let best = st[0]; for (const s of st) if (Math.abs(s.z - z) < Math.abs(best.z - z)) best = s; return best; };
  // rivet lines and ribs (aluminium); the floor
  f.col('#a6acb2'); for (let i = 0; i + 1 < st.length; i++) for (const sd of [1, -1]) f.rod([sd * st[i].b * 0.98, 0.1, st[i].z], [sd * st[i + 1].b * 0.98, 0.1, st[i + 1].z], 0.012, 3);
  f.col('#9aa0a6'); for (let i = 1; i + 1 < st.length; i += 2) { const s = st[i]; f.box(-s.b * 0.85, S.floor - 0.02, s.z - 0.03, s.b * 0.85, S.floor + 0.02, s.z + 0.03); }
  // the casting decks fore and aft: carpeted, raised; pedestal seats on them
  const deck = (z0, z1, y, aft = false) => { f.col('#4a5a48'); for (let i = 0; i + 1 < st.length; i++) { const a = st[i], b = st[i + 1]; if (b.z < z0 || a.z > z1) continue; const za = Math.max(z0, a.z), zb = Math.min(z1, b.z), wa = at(za).b * 0.9, wb = at(zb).b * 0.9; const v = [[-wa, y, za], [wa, y, za], [wb, y, zb], [-wb, y, zb]].map(p => f.vert(p[0], p[1], p[2], 0, 1, 0)); f.tri(v[0], v[1], v[2]); f.tri(v[0], v[2], v[3]); } f.col('#7a8086'); const ze = aft ? z1 : z0; f.box(-at(ze).b * 0.9, S.floor, ze - (aft ? 0 : 0.03), at(ze).b * 0.9, y, ze + (aft ? 0.03 : 0)); };
  deck(1.15, 2.35, 0.48); deck(-2.45, -2.08, 0.48, true);   // (the skipper stands on the floor behind the console: shared/boat-model.js deck)
  const seat = (x, z, y) => { f.col('#9aa0a6'); f.cyl(x, z, 0.035, y, y + 0.32, 6); f.col('#e8e2d0'); f.box(x - 0.22, y + 0.32, z - 0.2, x + 0.22, y + 0.4, z + 0.2); f.box(x - 0.2, y + 0.4, z - 0.22, x + 0.2, y + 0.6, z - 0.17); };
  seat(0, 1.85, 0.48);
  // the side console (to starboard), its wheel, the lever, a small screen
  f.col('#d8dde2'); f.box(-0.85, S.floor, -1.45, -0.35, 1.25, -0.95);
  f.col('#7fa6bf'); f.quad([[-0.85, 1.25, -0.95], [-0.35, 1.25, -0.95], [-0.38, 1.5, -1.08], [-0.82, 1.5, -1.08]], [0, 0.4, 0.9]);
  f.col('#1d2023'); f.box(-0.75, 1.26, -1.3, -0.45, 1.42, -1.26); f.col('#3a8ae8', 0, 1); f.box(-0.73, 1.28, -1.31, -0.47, 1.4, -1.305);
  wheel(f, -0.6, 1.14, -1.5, 0.15);
  f.col('#1d2023'); f.rod([-0.38, 1.2, -1.4], [-0.33, 1.38, -1.5], 0.016, 4);
  // the bow trolling motor, the livewell, rod straps, the stern light
  const B = st.at(-1);
  f.col('#1d2023'); f.box(-0.1, B.s - 0.05, B.z - 0.55, 0.1, B.s + 0.02, B.z - 0.2); f.rod([0, B.s, B.z - 0.25], [0, -0.6, B.z - 0.15], 0.025, 5); f.lathe(0, B.z - 0.15, [[0, -0.7], [0.07, -0.68], [0.07, -0.55], [0, -0.53]], 8);
  f.col('#e8e2d0'); f.box(-0.45, S.floor, -1.0, 0.25, 0.42, -0.6); f.col('#4a5a48'); f.box(-0.43, 0.42, -0.98, 0.23, 0.44, -0.62);
  for (const sd of [1, -1]) { const s = at(-0.4); f.col('#1d2023'); f.box(sd * (s.b - 0.15) - 0.03, s.s - 0.1, -0.5, sd * (s.b - 0.15) + 0.03, s.s, -0.3); }
  const T = st[0];
  f.col('#d7dbe0'); f.rod([-T.b * 0.7, 0.5, T.z + 0.1], [-T.b * 0.7, 1.4, T.z + 0.1], 0.016, 5); f.col('#ffffff', 0, 2); f.sph(-T.b * 0.7, 1.44, T.z + 0.1, 0.045, 0.05, 0.045, 6, 4);
  for (const sd of [1, -1]) for (const z of [-2.2, 2.1]) { const s = at(z); f.col('#c9ced3'); f.box(sd * (s.b - 0.08) - 0.03, s.s, z - 0.08, sd * (s.b - 0.08) + 0.03, s.s + 0.05, z + 0.08); }
  const motors = [{ x: 0, y: 0.48, z: T.z - 0.02 }];
  if (withMotors) for (const m of motors) { f.push(m.x, m.y, m.z, 0); outboard(f, 40, '#1d2023'); f.pop(); }
  return { f, motors, hp: 40 };
}

const BUILD = { coastal, skiff };
const cache = new Map();
/** A boat all in one geometry (moored in its slip; instanced). */
export function boatGeometry(type) {
  if (!cache.has(type)) cache.set(type, BUILD[type](true).f.build().geo);
  return cache.get(type);
}
/**
 * A boat out: its body, and its outboards as parts (turned with the wheel about their pivots); a T-top's canopy as a
 * part too (top: hidden while it blocks the view on deck; topBox: its extent in the boat's frame - x half-width, z
 * from and to, y).
 */
export function boatParts(type) {
  const key = `${type}:parts`;
  if (!cache.has(key)) {
    const b = BUILD[type](false), body = b.f.build().geo;
    const mf = new FB(); outboard(mf, b.hp, type === 'skiff' ? '#1d2023' : '#f4f4f0');
    cache.set(key, { body, motor: mf.build().geo, motors: b.motors.map(m => ({ at: [m.x, m.y, m.z] })), top: b.top ? b.top.build().geo : null, topBox: b.topBox || null });
  }
  return cache.get(key);
}
