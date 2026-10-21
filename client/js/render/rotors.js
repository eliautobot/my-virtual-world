// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Propellers and rotors that really turn (2026-10-14, the product owner: "the helicopter's propeller remains visible and still when
// flying, and a faded shape represents it spinning — is there any way to make it actually spin? Same for the smaller
// plane"). The blades are their own geometry, turned about the hub every frame (render/aircraft-models.js says where
// each hub is; player/flight.js, render/promo-aircraft.js turn them), with a faint motion-blur disc over them that
// thickens as they speed up — darker towards the hub, a ring where the painted tips sweep.
//
// Blades are lofted, tapered and twisted (more pitch at the root than at the tip), their tips painted. Built about +y
// (blades out along x and round), then laid on the hub's axis: 'y' a helicopter's main rotor, 'x' its tail rotor, 'z' a
// propeller. Turning fast, a wheel seen at a frame rate can seem to turn backwards (each frame it moves nearly as far as
// from one blade to the next): spinStep keeps each frame's turn under 60% of the way to the next blade.
import * as THREE from 'three';
import { FB } from './furniture.js';

const TAU = Math.PI * 2;

/**
 * A rotor's blades drawn into a furniture builder f at its current place, about +y (bladesInto) — or as one geometry
 * of their own, centred on the hub and laid on its axis (rotorBlades). o: { blades, r0 (root, m from the axis), R (tip),
 * chord (at the root), tipChord, thick, twist0 / twist1 (pitch at root / tip, radians), color, tip (the painted tip's
 * colour), tipLen (m), grip (the hub with its blade grips: its colour), axis 'x' | 'y' | 'z' }.
 */
export function bladesInto(f, o) {
  const B = o.blades || 2, N = 10;
  for (let k = 0; k < B; k++) {
    f.stack.push(f.m.clone()); f.m.multiply(new THREE.Matrix4().makeRotationY(k * TAU / B));
    // one blade out along +x: lens-shaped sections (the leading edge towards −z, the way it turns), twisted about x
    const sec = (x, c, th) => {
      const cs = Math.cos(th), sn = Math.sin(th), P = [[0, -c * 0.45, 0, -1], [o.thick / 2, -c * 0.05, 1, 0], [0, c * 0.55, 0, 1], [-o.thick / 2, -c * 0.05, -1, 0]];   // [y, z, ny, nz]
      return P.map(([y, z, ny, nz]) => ({ x, y: y * cs - z * sn, z: y * sn + z * cs, ny: ny * cs - nz * sn, nz: ny * sn + nz * cs }));
    };
    // the chord: full at the root, tapering to the tip, the last part rounded off
    const cAt = u => { const c = o.chord + (o.tipChord - o.chord) * u; return u > 0.94 ? c * Math.sqrt(Math.max(0.05, 1 - ((u - 0.94) / 0.06) ** 2)) : c; };
    const strip = (x0, x1, col, n) => {
      f.col(col);
      const rows = [];
      for (let i = 0; i <= n; i++) {
        const x = x0 + (x1 - x0) * i / n, u = (x - o.r0) / (o.R - o.r0), th = o.twist0 + (o.twist1 - o.twist0) * u;
        rows.push(sec(x, cAt(u), th).map(p => f.vert(p.x, p.y, p.z, 0, p.ny, p.nz)));
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) { const j1 = (j + 1) % 4; f.tri(rows[i][j], rows[i + 1][j], rows[i + 1][j1]); f.tri(rows[i][j], rows[i + 1][j1], rows[i][j1]); }
      return rows;
    };
    const split = o.R - (o.tipLen || 0), root = strip(o.r0, split, o.color, N), tip = o.tipLen ? strip(split, o.R, o.tip, 3) : root;
    for (const [r, x, d] of [[root[0], o.r0, -1], [tip[tip.length - 1], o.R, 1]]) { f.col(r === root[0] ? o.color : (o.tip || o.color)); const c = f.vert(x, 0, 0, d, 0, 0); for (let j = 0; j < 4; j++) f.tri(c, r[j], r[(j + 1) % 4]); }   // (the root and tip closed)
    f.pop();
  }
  if (o.grip) {
    f.col(o.grip); f.cyl(0, 0, o.r0 * 0.9, -o.thick * 1.6, o.thick * 1.6, 10);
    for (let k = 0; k < B; k++) { f.stack.push(f.m.clone()); f.m.multiply(new THREE.Matrix4().makeRotationY(k * TAU / B)); f.box(0, -o.thick * 0.9, -o.chord * 0.28, o.r0 + 0.08, o.thick * 0.9, o.chord * 0.28); f.pop(); }
  }
  return f;
}
/** The matrix that lays something built about +y onto an axis. */
export function axisMatrix(axis) { return axis === 'z' ? new THREE.Matrix4().makeRotationX(Math.PI / 2) : axis === 'x' ? new THREE.Matrix4().makeRotationZ(-Math.PI / 2) : new THREE.Matrix4(); }
/** The blades as their own geometry, centred on the hub, on its axis (to turn about it). */
export function rotorBlades(o) { const f = new FB(); f.m.multiply(axisMatrix(o.axis)); return bladesInto(f, o).build().geo; }
/** Standing still, as part of a model: the blades at their hub (at), on its axis, at an angle a about it. */
export function stillBlades(f, o, a = 0) {
  f.stack.push(f.m.clone()); f.m.multiply(new THREE.Matrix4().makeTranslation(o.at[0], o.at[1], o.at[2])).multiply(axisMatrix(o.axis)).multiply(new THREE.Matrix4().makeRotationY(a));
  bladesInto(f, o); f.pop();
}
/** The motion-blur disc of a rotor of radius R (on its axis, centred on the hub). */
export function blurDisc(R, axis) { const g = new THREE.CircleGeometry(R, 48); g.rotateX(-Math.PI / 2); return g.applyMatrix4(axisMatrix(axis)); }
const blurMats = new Map();
/** Its material: a soft disc, darker towards the hub, a ring of the tips' colour (one per tip colour; opacity per use). */
export function blurMaterial(tip = '#f2c94c') {
  if (blurMats.has(tip)) return blurMats.get(tip).clone();
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), R = 128, t = new THREE.Color(tip), tc = a => `rgba(${Math.round(t.r * 255)},${Math.round(t.g * 255)},${Math.round(t.b * 255)},${a})`, d = a => `rgba(28,30,34,${a})`;
  const gr = g.createRadialGradient(R, R, 0, R, R, R);
  gr.addColorStop(0, d(0)); gr.addColorStop(0.12, d(0.5)); gr.addColorStop(0.45, d(0.26)); gr.addColorStop(0.86, d(0.18));
  gr.addColorStop(0.885, tc(0.55)); gr.addColorStop(0.965, tc(0.5)); gr.addColorStop(0.99, d(0.08)); gr.addColorStop(1, d(0));
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  blurMats.set(tip, m);
  return m.clone();
}

/** How far a rotor turns this frame: rate (rad/s at full) × how fast it is going (0..1), no more than 60% of the way
 *  from one blade to the next (it would seem to turn backwards). */
export function spinStep(rate, level, dt, blades = 2) { return Math.min(rate * level * dt, 0.6 * Math.PI / blades); }
/** The blur's opacity for a speed (0..1): none while the blades are seen turning, thicker as they speed up. */
export const blurOpacity = (level, max = 0.85) => Math.max(0, Math.min(1, (level - 0.25) / 0.6)) * max;
