// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The airport's aircraft (docs/features/play-modules.md §Airport), in the promotional aircraft's style (render/promo-models.js):
// the propeller plane is the banner plane itself (with its tail wheel on its leg); a small business jet (low swept
// wing, T-tail, two engines on the rear fuselage, tricycle gear) and a light helicopter (cabin, tail boom, fin, tail
// rotor, skids, two-blade rotor). Their paint and windows are DECALS on the lofted body itself (hullDecal: patches of
// the same surface, a centimetre and a half out), so they wrap round the nose and the cabin instead of standing off it
// as flat panels (2026-10-13 review). Each model is ONE geometry with vertex colours (the furniture material), so every
// aircraft of a type is one instanced draw; flying, the rotors and the propeller are parts of their own that turn
// (flyingParts, render/rotors.js). Nose along +z, up +y, metres. PARKED: how each stands on the ground.
import * as THREE from 'three';
import { FB } from './furniture.js';
import { bannerPlane, loft, slab, wheel, airfoil, hullPoint, hullDecal, both, PROP_ROTOR } from './promo-models.js';
import { stillBlades, rotorBlades, blurDisc } from './rotors.js';

/** How each stands: lift = the model's origin over the ground, pitch = nose up (radians: a taildragger sits on its
 *  tail wheel - mains at (y −1.37, z 0.75), tail wheel at (y −0.67, z −4.0)). */
const tail = Math.atan2(1.37 - 0.67, 0.75 + 4.0);
export const PARKED = Object.freeze({
  prop: { pitch: tail, lift: 1.37 * Math.cos(tail) - 0.75 * Math.sin(tail) },
  jet: { pitch: 0, lift: 1.62 },
  heli: { pitch: 0, lift: 1.43 },
});
export const GEAR = Object.freeze({ prop: 1.37, jet: 1.62, heli: 1.43 });

// ------------------------------------------------------------------ the propeller plane
export function propPlane() { return bannerPlane({ parked: true }); }

// ------------------------------------------------------------------ the small jet
const JET = [
  { t: -6.2, w: 0.05, h: 0.1, c: 0.55, n: 2.4 }, { t: -5.4, w: 0.32, h: 0.38, c: 0.42, n: 2.4 }, { t: -3.6, w: 0.68, h: 0.76, c: 0.18, n: 2.6 },
  { t: -1.2, w: 0.82, h: 0.88, c: 0.04, n: 2.8 }, { t: 1.6, w: 0.82, h: 0.88, c: 0.02, n: 2.8 }, { t: 3.6, w: 0.7, h: 0.72, c: -0.06, n: 2.6 },
  { t: 4.9, w: 0.48, h: 0.46, c: -0.14, n: 2.3 }, { t: 5.7, w: 0.26, h: 0.25, c: -0.2, n: 2.1 }, { t: 6.25, w: 0.03, h: 0.04, c: -0.23, n: 2 },
];
/** A very light business jet: ≈ 12.4 m long, 13.2 m span. */
export function jetPlane() {
  const f = new FB(), white = '#f4f5f7', blue = '#1f4e8c', gold = '#c9a227', glass = '#1b2733', grey = '#9aa1a9';
  f.col(white); loft(f, JET, 28);
  // paint: a blue cheat line with a thin gold one under it, both sides, from the tail to the nose
  both(f, JET, blue, -5.3, 5.5, -0.34, -0.17, { nt: 24, na: 3 });
  both(f, JET, gold, -5.0, 5.2, -0.42, -0.36, { nt: 24, na: 2 });
  hullDecal(f, JET, '#2c3440', 5.55, 6.25, 0, 2 * Math.PI, { nt: 4, na: 18, off: 0.01 });   // the dark radome
  // windows: six oval-ish cabin windows a side, the cockpit side windows, the two-piece windscreen
  for (let k = 0; k < 6; k++) { const t = -2.4 + k * 0.82; both(f, JET, glass, t, t + 0.42, 0.1, 0.3, { nt: 2, na: 2 }); }
  both(f, JET, glass, 3.25, 3.85, 0.18, 0.5, { nt: 3, na: 3 });
  for (const [a0, a1] of [[0.55, 1.5], [1.64, 2.59]]) hullDecal(f, JET, glass, 3.95, 4.75, a0, a1, { nt: 4, na: 5 });
  both(f, JET, '#d5d8dc', -0.4, 0.9, -0.05, 0.42, { nt: 1, na: 1, off: 0.008 });   // the door outline (a lighter panel)
  // the low, swept wing - solid airfoils, a little dihedral - out to its winglets, which stand on its tips (there was a
  // gap at the tips' leading edges, 2026-10-14)
  f.col(white);
  for (const s of [1, -1]) {
    const W = [{ s: s * 0.5, le: 1.12, te: -1.42, o: -0.5, t: 0.13 }, { s: s * 6.56, le: -0.95, te: -1.62, o: -0.38, t: 0.09 }];
    airfoil(f, s > 0 ? W : W.reverse(), 'xz');
  }
  f.col(blue); for (const s of [1, -1]) airfoil(f, [{ s: -0.46, le: -0.92, te: -1.63, o: s * 6.55, t: 0.08 }, { s: 0.55, le: -1.3, te: -1.67, o: s * 6.63, t: 0.08 }], 'yz');
  // two engines on the rear fuselage, each on a pylon reaching from inside the fuselage into the nacelle (they floated
  // beside it, 2026-10-14): a metal intake lip, the fan's dark face with its spinner, the exhaust nozzle and its cone
  for (const s of [1, -1]) {
    f.col(white); { const Y = [{ s: s * 0.4, le: -3.1, te: -4.5, o: 0.58, t: 0.13 }, { s: s * 1.02, le: -3.35, te: -4.25, o: 0.58, t: 0.14 }]; airfoil(f, s > 0 ? Y : Y.reverse(), 'xz', { n: 8 }); }
    f.push(s * 1.32, 0.58, 0);
    const N = [{ t: -5.0, w: 0.24, h: 0.24 }, { t: -4.6, w: 0.4, h: 0.4 }, { t: -3.0, w: 0.45, h: 0.45 }, { t: -2.66, w: 0.42, h: 0.42 }];
    f.col(grey); loft(f, N, 20, 'z', false);
    f.col('#c9ccd1'); loft(f, [{ t: -2.67, w: 0.425, h: 0.425 }, { t: -2.6, w: 0.405, h: 0.405 }, { t: -2.585, w: 0.36, h: 0.36 }, { t: -2.66, w: 0.35, h: 0.35 }], 20, 'z', false);   // the lip, rolling in
    f.col('#22262b'); f.push(0, 0, -2.66); f.stack.push(f.m.clone()); f.m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)); f.lathe(0, 0, [[0.36, 0], [0.0, 0.0]], 20); f.pop(); f.pop();
    f.col('#aab0b7'); f.push(0, 0, -2.66); f.stack.push(f.m.clone()); f.m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)); f.lathe(0, 0, [[0.11, 0], [0.07, -0.08], [0, -0.13]], 10); f.pop(); f.pop();   // the fan's spinner
    f.col('#4a4f55'); loft(f, [{ t: -5.18, w: 0.21, h: 0.21 }, { t: -4.95, w: 0.25, h: 0.25 }], 16, 'z', false);   // the nozzle
    f.col('#2b2f34'); f.push(0, 0, -5.1); f.stack.push(f.m.clone()); f.m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)); f.lathe(0, 0, [[0.2, 0], [0.09, 0.1], [0, 0.22]], 12); f.pop(); f.pop();   // its cone
    f.pop();
  }
  // gear doors beside the main legs; antennas (no flap-track fairings under the wings, no landing lights in their roots:
  // the product owner 2026-10-14)
  f.col('#e9ebee'); for (const s of [1, -1]) slab(f, [[-0.56, -0.95], [-1.02, -0.9], [-1.02, -0.3], [-0.56, -0.25]], 'yz', 0.05, [s * 1.65, 0, 0]);
  f.col('#e9ebee'); for (const s of [1, -1]) slab(f, [[-0.6, 4.15], [-0.98, 4.2], [-0.98, 4.72], [-0.6, 4.72]], 'yz', 0.045, [s * 0.12, 0, 0]);
  f.col('#3a3f45'); slab(f, [[0.85, -1.4], [1.12, -1.7], [1.12, -1.82], [0.85, -1.75]], 'yz', 0.03, [0, 0, 0]); slab(f, [[-0.82, 0.8], [-1.0, 0.55], [-1.0, 0.45], [-0.82, 0.55]], 'yz', 0.03, [0, 0, 0]);
  // the T-tail: the fin (its cap blue) and the tailplane on top, solid airfoils
  f.col(white); airfoil(f, [{ s: 0.55, le: -4.55, te: -6.3, t: 0.1 }, { s: 1.9, le: -5.45, te: -6.45, t: 0.1 }], 'yz');
  f.col(blue); airfoil(f, [{ s: 1.9, le: -5.45, te: -6.45, t: 0.1 }, { s: 2.66, le: -5.92, te: -6.62, t: 0.1 }], 'yz');
  f.col(white); airfoil(f, [{ s: -2.3, le: -5.68, te: -6.2, o: 2.64, t: 0.09 }, { s: 0, le: -5.55, te: -6.55, o: 2.64, t: 0.09 }, { s: 2.3, le: -5.68, te: -6.2, o: 2.64, t: 0.09 }], 'xz');
  // tricycle gear: the nose leg and the mains, with their doors
  f.col('#8a9097'); f.rod([0, -0.55, 4.4], [0, -1.35, 4.45], 0.05, 6);
  for (const s of [1, -1]) f.rod([s * 1.55, -0.55, -0.6], [s * 1.6, -1.25, -0.6], 0.06, 6);
  wheel(f, 0, -1.4, 4.45, 0.22, 0.14);
  wheel(f, 1.6, -1.3, -0.6, 0.32, 0.2); wheel(f, -1.6, -1.3, -0.6, 0.32, 0.2);
  // navigation lights and the beacon
  f.col('#ff3b30', 0, 2); f.cyl(6.6, -1.6, 0.05, -0.1, 0.0, 6);
  f.col('#34c759', 0, 2); f.cyl(-6.6, -1.6, 0.05, -0.1, 0.0, 6);
  f.col('#ffffff', 0, 2); f.cyl(0, -6.55, 0.05, 2.62, 2.75, 6);
  f.col('#ff3b30', 0, 2); f.cyl(0, 0.2, 0.08, 0.9, 1.0, 8);
  return f.build().geo;
}

// ------------------------------------------------------------------ the helicopter
const HELI = [
  { t: -1.85, w: 0.34, h: 0.4, c: 0.3, n: 2.4 }, { t: -1.3, w: 0.7, h: 0.8, c: 0.12, n: 2.6 }, { t: -0.2, w: 0.86, h: 0.98, c: 0.06, n: 2.8 },
  { t: 1.0, w: 0.86, h: 0.98, c: 0.04, n: 2.8 }, { t: 1.9, w: 0.76, h: 0.84, c: -0.04, n: 2.5 }, { t: 2.5, w: 0.52, h: 0.56, c: -0.16, n: 2.2 },
  { t: 2.85, w: 0.06, h: 0.08, c: -0.26, n: 2 },
];
/** The helicopter's rotors (render/rotors.js): the main rotor's two long blades with white tips over the hub, the tail
 *  rotor's two small ones with red tips on the fin's side. */
export const HELI_MAIN = Object.freeze({ blades: 2, r0: 0.24, R: 5.0, chord: 0.3, tipChord: 0.25, thick: 0.05, twist0: 0.14, twist1: 0.02, color: '#2a2f36', tip: '#f2f1ec', tipLen: 0.35, grip: '#3a3f45', axis: 'y', at: Object.freeze([0, 1.68, -0.2]), blur: 0.3 });   // (its blur faint: a big grey disc was the 'faded shape')
export const HELI_TAIL = Object.freeze({ blades: 2, r0: 0.07, R: 0.68, chord: 0.12, tipChord: 0.09, thick: 0.025, twist0: 0.2, twist1: 0.07, color: '#2a2f36', tip: '#c62f2f', tipLen: 0.1, grip: '#3a3f45', axis: 'x', at: Object.freeze([0.18, 1.2, -6.75]), blur: 0.8 });
/** A light helicopter: ≈ 9.7 m long (10 m rotor), on skids. opts.noRotors: without its blades (turning ones are drawn
 *  on a flying one). */
export function helicopter(opts = {}) {
  const f = new FB(), red = '#c62f2f', white = '#f2f1ec', dark = '#2a2f36', glass = '#1f2c38';
  f.col(red); loft(f, HELI, 24);
  // the canopy: one sweep of glass over the front and down the sides; the chin windows; the cabin doors' windows
  hullDecal(f, HELI, glass, 1.45, 2.85, -0.38, Math.PI + 0.38, { nt: 10, na: 18 });   // (round the nose: it was a red ring round a dark spot)
  both(f, HELI, glass, 2.0, 2.74, -1.0, -0.46, { nt: 4, na: 3 });
  both(f, HELI, glass, -0.85, 0.35, 0.08, 0.72, { nt: 4, na: 4 });
  both(f, HELI, glass, 0.5, 1.3, 0.08, 0.72, { nt: 3, na: 4 });
  both(f, HELI, white, -1.75, 0.95, -0.52, -0.3, { nt: 12, na: 2 });   // a white band low along the sides (ending before the nose curves in)
  // the tail boom, its fin and tailplane, the tail rotor
  f.col(white); loft(f, [{ t: -6.55, w: 0.035, h: 0.045, c: 0.76 }, { t: -6.3, w: 0.12, h: 0.14, c: 0.7 }, { t: -1.6, w: 0.3, h: 0.32, c: 0.35 }], 14);   // (a tail cone, not a cut end)
  f.col(red); airfoil(f, [{ s: 0.42, le: -5.78, te: -6.56, t: 0.12 }, { s: 1.2, le: -6.2, te: -6.92, t: 0.12 }, { s: 1.92, le: -6.6, te: -7.03, t: 0.12 }], 'yz');   // the fin, a solid airfoil
  f.col(white); airfoil(f, [{ s: -0.9, le: -5.4, te: -5.76, o: 0.62, t: 0.12 }, { s: 0.9, le: -5.4, te: -5.76, o: 0.62, t: 0.12 }], 'xz', { n: 8 });
  f.col(dark); f.rod([0.04, 1.2, -6.75], [0.16, 1.2, -6.75], 0.05, 8);   // the tail rotor's axle, out of the fin
  if (!opts.noRotors) stillBlades(f, HELI_TAIL, 0.5);
  // the engine cowling over the cabin, the mast and the hub
  f.col(white); loft(f, [{ t: -1.5, w: 0.4, h: 0.22, c: 1.0 }, { t: 0.4, w: 0.42, h: 0.26, c: 1.02 }, { t: 0.75, w: 0.18, h: 0.1, c: 0.98 }], 12);
  f.col(dark); hullDecal(f, [{ t: -1.5, w: 0.4, h: 0.22, c: 1.0 }, { t: 0.4, w: 0.42, h: 0.26, c: 1.02 }], '#3a3f45', -1.2, -0.6, 0.1, 0.9, { nt: 2, na: 3 });   // its intake grille
  f.col('#7c838c'); f.cyl(0, -0.2, 0.09, 1.2, 1.62, 8);
  f.col(dark); f.cyl(0, -0.2, 0.2, 1.58, 1.7, 10);
  // the main rotor, standing still (one that turns is drawn on a flying helicopter)
  if (!opts.noRotors) stillBlades(f, HELI_MAIN, 0.35);
  // skids, with their cross tubes up into the body
  f.col('#8a9097');
  for (const s of [1, -1]) { f.rod([s * 1.05, -1.38, -1.6], [s * 1.05, -1.38, 1.9], 0.05, 6); f.rod([s * 1.05, -1.38, 1.9], [s * 1.05, -1.2, 2.25], 0.05, 6); }
  for (const z of [-0.9, 1.1]) for (const s of [1, -1]) { const p = hullPoint(HELI, z, s > 0 ? -0.9 : Math.PI + 0.9); f.rod([s * 1.05, -1.38, z], [p.x, p.y, z], 0.045, 6); }
  // the steps, on the front cross tubes either side (they floated beside the skids, 2026-10-14)
  for (const s of [1, -1]) {
    const p = hullPoint(HELI, 1.1, s > 0 ? -0.9 : Math.PI + 0.9), u = (1.05 - 0.88) / (1.05 - Math.abs(p.x)), y = -1.38 + u * (p.y + 1.38);
    f.col('#8a9097'); f.box(s * 0.88 - 0.17, y + 0.03, 0.74, s * 0.88 + 0.17, y + 0.075, 1.46);
    f.col('#2f3338'); for (const z of [0.86, 1.04, 1.22, 1.4]) f.box(s * 0.88 - 0.16, y + 0.075, z - 0.025, s * 0.88 + 0.16, y + 0.082, z + 0.025);   // its tread
  }
  // the engine's exhaust out of the cowling's back; a tail skid guarding the tail rotor; end plates on the tailplane;
  // a landing light under the chin; an antenna on the boom
  f.col('#3a3f45'); f.rod([0.12, 1.15, -1.22], [0.17, 1.33, -1.66], 0.075, 8); f.col('#16191c'); f.cyl(0.17, -1.66, 0.055, 1.33, 1.335, 8);
  f.col('#8a9097'); f.rod([0, 0.56, -5.95], [0, 0.14, -6.45], 0.03, 6); f.rod([0, 0.14, -6.45], [0, 0.14, -6.85], 0.026, 6);
  f.col(red); for (const s of [1, -1]) airfoil(f, [{ s: 0.5, le: -5.37, te: -5.77, o: s * 0.92, t: 0.1 }, { s: 0.77, le: -5.45, te: -5.79, o: s * 0.92, t: 0.1 }], 'yz', { n: 8 });
  f.col('#fff6da', 0, 2); f.box(-0.14, -0.82, 2.16, 0.14, -0.74, 2.34);
  f.col('#3a3f45'); f.rod([0, 0.62, -3.0], [0, 1.25, -3.35], 0.012, 4);
  // beacons
  f.col('#ff3b30', 0, 2); f.cyl(0, -0.9, 0.06, 1.12, 1.22, 6);
  f.col('#ffffff', 0, 2); f.cyl(0, -7.0, 0.05, 1.8, 1.9, 6);
  return f.build().geo;
}
/** Standing on their stands (one instanced mesh a type): rotors and propeller still. */
export const MODELS = { prop: propPlane, jet: jetPlane, heli: helicopter };

/**
 * A flying aircraft's parts (player/flight.js - yours and everyone else's): the body without its rotors, and each rotor
 * that turns - its blades (centred on the hub, on its axis), its motion-blur disc, where its hub is, which axis, how fast
 * it turns at full power (rad/s) and the tips' colour; the jet has none (no propeller: its engines' exhausts glow with
 * the power instead - where they are, how big). Made once a type.
 */
const ROTORS = { prop: [{ ...PROP_ROTOR, rate: 56 }], jet: [], heli: [{ ...HELI_MAIN, rate: 28 }, { ...HELI_TAIL, rate: 56 }] };
const BODIES = { prop: () => bannerPlane({ parked: true, noProp: true }), jet: jetPlane, heli: () => helicopter({ noRotors: true }) };
const parts = {};
export function flyingParts(type) {
  return parts[type] ||= {
    body: BODIES[type](),
    rotors: ROTORS[type].map(r => ({ ...r, geo: rotorBlades(r), disc: blurDisc(r.R * 1.02, r.axis) })),
    exhausts: type === 'jet' ? [[1.38, 0.58, -4.97], [-1.38, 0.58, -4.97]].map(at => ({ at, r: 0.23 })) : [],
  };
}
