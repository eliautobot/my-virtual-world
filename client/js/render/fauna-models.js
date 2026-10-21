// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Animals for the wildlife (WP4.17, wp4-world-spec.md §6.3; reshaped for the design review 2026-10-03: "animals need to be
// more detailed, they look too blocky ... this is a brand new style"), built from code (nothing to license) as smooth,
// rounded forms — bodies, necks, legs and tails swept along their lines with tapering girths, heads with muzzles, ears
// and horns, markings painted on — and animated in the vertex shader from per-instance state, so each species is one
// instanced draw call. Every vertex carries its part (aPart): 0 body, 1 left wing, 2 right wing, 3–6 legs (front-left,
// front-right, back-left, back-right), 7 head (and neck), 8 tail; and a marking (aTone: rgb, amount — how far the
// instance's colour gives way to it; amount −1 paints patches). Each instance carries aAnim = (phase, rate, mode,
// extra): modes 0 rest, 1 walk, 2 run, 3 fly (flapping), 4 glide, 5 swim, 6 hop, 7 glow; extra = the hip height of
// legged animals (0 for others). Forward is +x, up +y.
import * as THREE from 'three';
import { GU } from './scene.js';

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * A tube swept along points [[x, y, z, r, ry?], ...] (ry: a vertical radius for an oval section), seg sides, its ends
 * rounded shut. Smooth (indexed) geometry.
 */
function tube(pts, seg = 10, caps = true) {
  const P = pts.map(p => V(p[0], p[1], p[2])), n = P.length, pos = [], idx = [];
  let up = V(0, 1, 0);
  const frames = P.map((p, i) => {
    const t = P[Math.min(n - 1, i + 1)].clone().sub(P[Math.max(0, i - 1)]).normalize();
    if (Math.abs(t.dot(up)) > 0.9) up = V(1, 0, 0);
    const side = V().crossVectors(t, up).normalize(), u = V().crossVectors(side, t).normalize();
    return { t, side, u };
  });
  for (let i = 0; i < n; i++) {
    const { side, u } = frames[i], r = pts[i][3], ry = pts[i][4] ?? r;
    for (let k = 0; k < seg; k++) { const a = k / seg * TAU, c = Math.cos(a), s = Math.sin(a); pos.push(P[i].x + side.x * c * r + u.x * s * ry, P[i].y + side.y * c * r + u.y * s * ry, P[i].z + side.z * c * r + u.z * s * ry); }
  }
  for (let i = 0; i + 1 < n; i++) for (let k = 0; k < seg; k++) { const a = i * seg + k, b = i * seg + (k + 1) % seg, c = a + seg, d = b + seg; idx.push(a, c, b, b, c, d); }
  if (caps) for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
    const o = pos.length / 3, t = frames[i].t, r = Math.min(pts[i][3], pts[i][4] ?? pts[i][3]) * 0.6;
    pos.push(P[i].x + t.x * dir * r, P[i].y + t.y * dir * r, P[i].z + t.z * dir * r);
    for (let k = 0; k < seg; k++) { const a = i * seg + k, b = i * seg + (k + 1) % seg; if (dir < 0) idx.push(o, a, b); else idx.push(o, b, a); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** An ellipsoid, smooth; optional lumps (wool). */
function blob(x, y, z, rx, ry, rz, w = 12, h = 8, lumps = 0) {
  const g = new THREE.SphereGeometry(1, w, h);
  if (lumps) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), k = 1 + lumps * Math.sin(vx * 9.1 + vy * 3.3) * Math.sin(vy * 8.7 + vz * 2.9) * Math.sin(vz * 9.7 + vx * 4.1); p.setXYZ(i, vx * k, vy * k, vz * k); } }
  g.scale(rx, ry, rz).translate(x, y, z); g.deleteAttribute('uv'); g.computeVertexNormals();
  return g;
}
/**
 * A flat leaf-like plate (wing, fin, ear, tail fan) from a polygon outline in the x–z plane, lifted to y; both faces.
 * Fanned from its centroid, or from c = [x, z] for an outline that isn't star-shaped about it (a notched fluke).
 */
function plate(outline, y = 0, camber = 0, c = null) {
  const pos = [], idx = [], n = outline.length;
  let cx = 0, cz = 0; for (const [x, z] of outline) { cx += x / n; cz += z / n; }
  if (c) [cx, cz] = c;
  pos.push(cx, y + camber, cz);
  for (const [x, z] of outline) pos.push(x, y, z);
  for (let k = 0; k < n; k++) idx.push(0, 1 + k, 1 + (k + 1) % n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** Tag a part: its id and marking (rgb, amount; amount −1 = patches). */
function part(g, id, tone = [1, 1, 1, 0]) {
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(id), 1));
  const t = new Float32Array(n * 4); for (let i = 0; i < n; i++) t.set(tone, i * 4);
  g.setAttribute('aTone', new THREE.BufferAttribute(t, 4));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
function merge(parts) {
  let n = 0, m = 0; for (const g of parts) { n += g.attributes.position.count; m += g.index.count; }
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), prt = new Float32Array(n), tone = new Float32Array(n * 4), idx = new Uint32Array(m);
  let o = 0, q = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3); prt.set(g.attributes.aPart.array, o); tone.set(g.attributes.aTone.array, o * 4);
    const I = g.index.array; for (let i = 0; i < I.length; i++) idx[q + i] = I[i] + o;
    o += g.attributes.position.count; q += I.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('aPart', new THREE.BufferAttribute(prt, 1)); out.setAttribute('aTone', new THREE.BufferAttribute(tone, 4));
  out.setIndex(new THREE.BufferAttribute(n > 65535 ? idx : new Uint16Array(idx), 1));
  out.computeBoundingSphere();
  return out;
}
// markings
const HOOF = [0.13, 0.11, 0.1, 1], NOSE = [0.55, 0.42, 0.4, 0.85], HORN = [0.86, 0.8, 0.68, 1], EYE = [0.05, 0.05, 0.05, 1], DARK = [0.12, 0.1, 0.09, 0.85];
const SHADE = k => [k, k, k, -2];   // the coat a little darker (an underside, an inner ear, a folded wing)
const PATCH = [0.93, 0.91, 0.87, -1];

/** A leg from the hip down: upper and lower leg, the joint, a hoof (or a paw). */
function legPart(id, x, z, hip, r, bend = 0.06, hoof = HOOF, coat = [1, 1, 1, 0]) {
  return [
    part(tube([[x, hip + 0.18, z, r * 1.25], [x + bend * 0.4, hip * 0.62, z, r * 0.9], [x - bend * 0.3, hip * 0.5, z, r * 0.78], [x, hip * 0.16, z, r * 0.62], [x + 0.01, 0.04, z, r * 0.66]], 8), id, coat),
    part(tube([[x + 0.01, 0.07, z, r * 0.68], [x + 0.03, 0.0, z, r * 0.72]], 8), id, hoof),
  ];
}
const eyes = (x, y, z, r) => [part(blob(x, y, z, r, r, r, 6, 4), 7, EYE), part(blob(x, y, -z, r, r, r, 6, 4), 7, EYE)];
/** A fin with some thickness: two plates cambered apart (a lens), for fins seen edge-on (a dolphin nose-on). */
const fin = (outline, y, t, c) => [plate(outline, y, t, c), plate(outline, y, -t, c)];
/** Countershading on a smooth body (a dolphin): by each vertex's normal, the back toward `back`, the belly toward `belly`. */
function countershade(g, back, belly) {
  const N = g.attributes.normal, T = g.attributes.aTone;
  for (let i = 0; i < N.count; i++) {
    const ny = N.getY(i), b = Math.min(1, Math.max(0, (-ny - 0.1) / 0.45)), d = Math.min(1, Math.max(0, (ny - 0.2) / 0.5));
    if (b > 0) T.setXYZW(i, belly[0], belly[1], belly[2], belly[3] * b); else T.setXYZW(i, back[0], back[1], back[2], back[3] * d);
  }
  return g;
}

/** Geometry per model, at unit size (scaled by the species' size per instance). */
export const MODELS = {
  cow: () => merge([
    // a deep barrel of a body, square hips, the belly hanging low; patches on some coats
    part(tube([[-0.86, 1.08, 0, 0.16, 0.2], [-0.74, 1.1, 0, 0.3, 0.34], [-0.45, 1.06, 0, 0.33, 0.4], [-0.05, 1.0, 0, 0.34, 0.42], [0.32, 1.02, 0, 0.32, 0.38], [0.62, 1.08, 0, 0.26, 0.3], [0.76, 1.12, 0, 0.16, 0.2]], 14), 0, PATCH),
    part(blob(-0.45, 0.66, 0, 0.16, 0.1, 0.13, 8, 6), 0, [0.86, 0.66, 0.62, 0.9]),   // udder
    // neck and head: long face sloping down to a broad, pale muzzle; ears out to the sides, short horns
    part(tube([[0.62, 1.14, 0, 0.2, 0.24], [0.88, 1.2, 0, 0.17, 0.2], [1.02, 1.22, 0, 0.15, 0.17]], 12), 7, PATCH),
    part(tube([[0.98, 1.27, 0, 0.13, 0.13], [1.14, 1.16, 0, 0.12, 0.12], [1.3, 1.02, 0, 0.1, 0.09]], 12), 7),
    part(blob(1.33, 1.0, 0, 0.09, 0.08, 0.1, 10, 7), 7, NOSE),
    part(blob(1.02, 1.28, 0.17, 0.05, 0.03, 0.12, 8, 5), 7, SHADE(0.85)), part(blob(1.02, 1.28, -0.17, 0.05, 0.03, 0.12, 8, 5), 7, SHADE(0.85)),
    part(tube([[0.98, 1.36, 0.08, 0.025], [1.0, 1.42, 0.14, 0.02], [1.04, 1.46, 0.15, 0.01]], 6), 7, HORN), part(tube([[0.98, 1.36, -0.08, 0.025], [1.0, 1.42, -0.14, 0.02], [1.04, 1.46, -0.15, 0.01]], 6), 7, HORN),
    ...eyes(1.13, 1.22, 0.1, 0.022),
    // tail: hanging from the tail-head, a dark tuft at its end
    part(tube([[-0.84, 1.2, 0, 0.035], [-0.88, 0.9, 0, 0.025], [-0.86, 0.62, 0, 0.022]], 6), 8),
    part(blob(-0.86, 0.55, 0, 0.04, 0.09, 0.04, 6, 5), 8, DARK),
    ...legPart(3, 0.55, 0.19, 0.68, 0.08), ...legPart(4, 0.55, -0.19, 0.68, 0.08), ...legPart(5, -0.55, 0.19, 0.68, 0.09, -0.08), ...legPart(6, -0.55, -0.19, 0.68, 0.09, -0.08),
  ]),
  horse: () => merge([
    part(tube([[-0.8, 1.32, 0, 0.14, 0.18], [-0.68, 1.36, 0, 0.27, 0.3], [-0.35, 1.3, 0, 0.29, 0.33], [0.1, 1.27, 0, 0.28, 0.33], [0.45, 1.32, 0, 0.27, 0.31], [0.66, 1.42, 0, 0.2, 0.24]], 14), 0),
    // an arched neck rising to a long head, a mane along its crest, small upright ears
    part(tube([[0.55, 1.42, 0, 0.21, 0.26], [0.78, 1.66, 0, 0.16, 0.2], [0.94, 1.9, 0, 0.12, 0.15]], 12), 7),
    part(tube([[0.92, 1.98, 0, 0.11, 0.12], [1.1, 1.86, 0, 0.1, 0.1], [1.3, 1.7, 0, 0.075, 0.08]], 12), 7),
    part(blob(1.32, 1.68, 0, 0.075, 0.07, 0.08, 10, 7), 7, NOSE),
    part(tube([[0.58, 1.58, 0, 0.05, 0.09], [0.78, 1.86, 0, 0.045, 0.08], [0.93, 2.06, 0, 0.035, 0.06]], 8), 7, DARK),
    part(tube([[0.95, 2.05, 0.06, 0.03], [0.93, 2.16, 0.07, 0.01]], 6), 7), part(tube([[0.95, 2.05, -0.06, 0.03], [0.93, 2.16, -0.07, 0.01]], 6), 7),
    ...eyes(1.08, 1.94, 0.09, 0.02),
    part(tube([[-0.8, 1.42, 0, 0.07], [-0.92, 1.25, 0, 0.08], [-0.97, 0.95, 0, 0.06], [-0.95, 0.72, 0, 0.03]], 8), 8, DARK),
    ...legPart(3, 0.5, 0.15, 0.98, 0.07), ...legPart(4, 0.5, -0.15, 0.98, 0.07), ...legPart(5, -0.52, 0.15, 0.98, 0.075, -0.09), ...legPart(6, -0.52, -0.15, 0.98, 0.075, -0.09),
  ]),
  deer: () => merge([
    part(tube([[-0.62, 1.04, 0, 0.12, 0.15], [-0.5, 1.06, 0, 0.21, 0.25], [-0.15, 1.0, 0, 0.23, 0.27], [0.25, 1.02, 0, 0.22, 0.26], [0.5, 1.08, 0, 0.17, 0.2]], 12), 0),
    part(blob(-0.12, 0.84, 0, 0.42, 0.06, 0.16, 10, 6), 0, [0.92, 0.88, 0.8, 0.7]),   // pale belly
    part(tube([[0.45, 1.12, 0, 0.15, 0.18], [0.6, 1.4, 0, 0.11, 0.13], [0.7, 1.62, 0, 0.09, 0.1]], 10), 7),
    part(tube([[0.68, 1.68, 0, 0.09], [0.82, 1.64, 0, 0.075], [0.96, 1.56, 0, 0.05]], 10), 7),
    part(blob(0.98, 1.55, 0, 0.045, 0.04, 0.045, 8, 5), 7, EYE),
    part(blob(0.7, 1.78, 0.1, 0.03, 0.08, 0.05, 8, 5), 7, SHADE(0.85)), part(blob(0.7, 1.78, -0.1, 0.03, 0.08, 0.05, 8, 5), 7, SHADE(0.85)),
    ...eyes(0.84, 1.69, 0.07, 0.018),
    // antlers: two beams with tines
    ...[1, -1].flatMap(s => [
      part(tube([[0.68, 1.8, 0.05 * s, 0.022], [0.66, 1.98, 0.14 * s, 0.018], [0.6, 2.16, 0.2 * s, 0.012]], 6), 7, [0.7, 0.62, 0.5, 1]),
      part(tube([[0.665, 1.95, 0.12 * s, 0.014], [0.76, 2.06, 0.15 * s, 0.008]], 5), 7, [0.7, 0.62, 0.5, 1]),
    ]),
    part(blob(-0.64, 1.1, 0, 0.06, 0.09, 0.07, 8, 6), 8, [0.95, 0.93, 0.9, 1]),
    ...legPart(3, 0.4, 0.12, 0.8, 0.05), ...legPart(4, 0.4, -0.12, 0.8, 0.05), ...legPart(5, -0.42, 0.12, 0.8, 0.055, -0.09), ...legPart(6, -0.42, -0.12, 0.8, 0.055, -0.09),
  ]),
  sheep: () => merge([
    // a fleece of soft lumps, a dark face and legs
    part(blob(0, 0.8, 0, 0.62, 0.44, 0.44, 16, 11, 0.07), 0),
    part(blob(-0.5, 0.82, 0, 0.18, 0.2, 0.2, 10, 7, 0.08), 0),
    part(blob(0.56, 0.98, 0, 0.17, 0.17, 0.17, 10, 7, 0.1), 7),   // wool on the poll
    part(tube([[0.56, 0.92, 0, 0.11, 0.12], [0.7, 0.86, 0, 0.1, 0.11], [0.82, 0.78, 0, 0.07, 0.08]], 10), 7, [0.15, 0.13, 0.12, 0.95]),
    part(blob(0.64, 0.95, 0.13, 0.04, 0.025, 0.09, 8, 5), 7, [0.15, 0.13, 0.12, 0.95]), part(blob(0.64, 0.95, -0.13, 0.04, 0.025, 0.09, 8, 5), 7, [0.15, 0.13, 0.12, 0.95]),
    part(blob(-0.6, 0.78, 0, 0.06, 0.1, 0.06, 6, 5), 8),
    ...legPart(3, 0.3, 0.16, 0.42, 0.045, 0.03, HOOF, [0.15, 0.13, 0.12, 0.95]), ...legPart(4, 0.3, -0.16, 0.42, 0.045, 0.03, HOOF, [0.15, 0.13, 0.12, 0.95]),
    ...legPart(5, -0.3, 0.16, 0.42, 0.05, -0.03, HOOF, [0.15, 0.13, 0.12, 0.95]), ...legPart(6, -0.3, -0.16, 0.42, 0.05, -0.03, HOOF, [0.15, 0.13, 0.12, 0.95]),
  ]),
  rabbit: () => merge([
    part(blob(-0.05, 0.42, 0, 0.5, 0.36, 0.34, 14, 10), 0),
    part(blob(-0.32, 0.36, 0, 0.3, 0.3, 0.32, 12, 8), 0),   // haunches
    part(blob(0.42, 0.72, 0, 0.24, 0.22, 0.2, 12, 9), 7),
    part(blob(0.62, 0.68, 0, 0.08, 0.07, 0.08, 8, 6), 7, [0.85, 0.6, 0.6, 0.6]),
    part(tube([[0.38, 0.88, 0.08, 0.06, 0.03], [0.33, 1.15, 0.12, 0.07, 0.03], [0.28, 1.35, 0.13, 0.03, 0.02]], 8), 7), part(tube([[0.38, 0.88, -0.08, 0.06, 0.03], [0.33, 1.15, -0.12, 0.07, 0.03], [0.28, 1.35, -0.13, 0.03, 0.02]], 8), 7),
    ...eyes(0.55, 0.8, 0.12, 0.035),
    part(blob(-0.55, 0.5, 0, 0.13, 0.13, 0.13, 8, 6), 8, [0.97, 0.96, 0.94, 1]),
    ...legPart(3, 0.28, 0.12, 0.3, 0.05, 0.02), ...legPart(4, 0.28, -0.12, 0.3, 0.05, 0.02),
    part(blob(-0.3, 0.12, 0.18, 0.26, 0.09, 0.08, 8, 6), 5), part(blob(-0.3, 0.12, -0.18, 0.26, 0.09, 0.08, 8, 6), 6),
  ]),
  bird: () => merge([
    // a streamlined body, a round head and a fine beak, shaped wings and a fanned tail
    part(tube([[-0.55, 0.02, 0, 0.06, 0.05], [-0.3, 0.05, 0, 0.22, 0.2], [0.1, 0.07, 0, 0.27, 0.25], [0.42, 0.1, 0, 0.2, 0.19]], 10), 0),
    part(blob(0.5, 0.17, 0, 0.19, 0.18, 0.18, 10, 8), 7),
    part(tube([[0.66, 0.15, 0, 0.05], [0.84, 0.12, 0, 0.005]], 6, false), 7, [0.9, 0.7, 0.2, 0.8]),
    ...eyes(0.6, 0.22, 0.12, 0.03),
    part(plate([[-0.45, 0], [-0.95, 0.22], [-1.0, 0.0], [-0.95, -0.22]], 0.04), 8, SHADE(0.85)),
    part(plate([[0.25, 0.08], [0.02, 1.05], [-0.25, 1.1], [-0.42, 0.85], [-0.36, 0.08]], 0.08, 0.04), 1, SHADE(0.9)),
    part(plate([[0.25, -0.08], [0.02, -1.05], [-0.25, -1.1], [-0.42, -0.85], [-0.36, -0.08]], 0.08, 0.04), 2, SHADE(0.9)),
  ]),
  duck: () => merge([
    part(tube([[-0.6, 0.3, 0, 0.1, 0.08], [-0.42, 0.22, 0, 0.3, 0.24], [0, 0.18, 0, 0.36, 0.3], [0.3, 0.22, 0, 0.3, 0.26], [0.45, 0.3, 0, 0.15, 0.15]], 12), 0),
    part(tube([[0.38, 0.32, 0, 0.13], [0.48, 0.56, 0, 0.1], [0.55, 0.78, 0, 0.1]], 10), 7),
    part(blob(0.6, 0.86, 0, 0.17, 0.15, 0.14, 10, 8), 7),
    part(tube([[0.72, 0.84, 0, 0.07, 0.035], [0.9, 0.8, 0, 0.06, 0.025]], 8), 7, [0.95, 0.6, 0.12, 1]),
    ...eyes(0.68, 0.92, 0.1, 0.025),
    part(plate([[-0.5, 0.05], [-0.72, 0.16], [-0.74, -0.16], [-0.5, -0.05]], 0.36), 8, SHADE(0.85)),
    part(blob(-0.08, 0.32, 0.25, 0.32, 0.08, 0.06, 10, 6), 0, SHADE(0.8)), part(blob(-0.08, 0.32, -0.25, 0.32, 0.08, 0.06, 10, 6), 0, SHADE(0.8)),   // folded wings
  ]),
  butterfly: () => merge([
    part(tube([[-0.3, 0, 0, 0.04], [0.3, 0, 0, 0.05]], 6), 0, [0.1, 0.08, 0.06, 1]),
    part(plate([[0.05, 0.03], [0.45, 0.55], [0.15, 0.95], [-0.15, 0.7], [-0.4, 0.75], [-0.35, 0.35], [-0.05, 0.03]], 0, 0.02), 1),
    part(plate([[0.05, -0.03], [0.45, -0.55], [0.15, -0.95], [-0.15, -0.7], [-0.4, -0.75], [-0.35, -0.35], [-0.05, -0.03]], 0, 0.02), 2),
  ]),
  firefly: () => merge([part(blob(0, 0, 0, 0.5, 0.5, 0.5, 8, 6), 0)]),
  fish: () => merge([
    part(tube([[-0.5, 0, 0, 0.04, 0.06], [-0.3, 0, 0, 0.13, 0.2], [0.1, 0, 0, 0.17, 0.26], [0.42, 0, 0, 0.1, 0.15], [0.55, 0, 0, 0.03, 0.04]], 10), 0),
    part(plate([[-0.48, 0], [-0.78, 0.22], [-0.7, 0], [-0.78, -0.22]], 0).rotateX(Math.PI / 2), 8, SHADE(0.85)),
    part(plate([[-0.05, 0], [0.2, 0], [-0.15, 0.16]], 0).rotateX(-Math.PI / 2).translate(0, 0.22, 0), 0, SHADE(0.8)),
    ...eyes(0.4, 0.04, 0.08, 0.025),
  ]),
  // a reef fish (2026-10-03: "marine life"): a deep, flat body in bright colours with a pale belly and a dark
  // stripe, tall fins above and below, a forked tail
  reeffish: () => merge([
    part(tube([[-0.42, 0, 0, 0.03, 0.05], [-0.28, 0, 0, 0.09, 0.22], [0.0, 0, 0, 0.12, 0.34], [0.26, 0.01, 0, 0.1, 0.26], [0.44, 0.02, 0, 0.03, 0.06]], 12), 0),
    part(tube([[-0.05, -0.12, 0, 0.1, 0.12], [0.2, -0.1, 0, 0.08, 0.1]], 10), 0, [0.96, 0.94, 0.86, 0.75]),   // belly
    part(tube([[0.1, 0.02, 0, 0.125, 0.34], [0.16, 0.02, 0, 0.12, 0.32]], 12), 0, [0.08, 0.08, 0.12, 0.85]),   // a dark band
    part(plate([[-0.42, 0], [-0.68, 0.24], [-0.58, 0], [-0.68, -0.24]], 0).rotateX(Math.PI / 2), 8, SHADE(0.9)),
    part(plate([[-0.3, 0], [0.18, 0], [0.0, 0.2], [-0.32, 0.14]], 0).rotateX(-Math.PI / 2).translate(0, 0.3, 0), 0, SHADE(0.85)),   // back fin
    part(plate([[-0.25, 0], [0.05, 0], [-0.2, -0.16]], 0).rotateX(-Math.PI / 2).translate(0, -0.3, 0), 0, SHADE(0.85)),
    ...eyes(0.32, 0.06, 0.09, 0.03),
  ]),
  // a sea turtle: a domed, patterned shell, a head on a short neck, four flippers (the front pair stroke: parts 1, 2)
  turtle: () => merge([
    part(blob(0, 0.08, 0, 0.5, 0.17, 0.4, 16, 10, 0.03), 0, [0.36, 0.3, 0.18, -1]),
    part(blob(0, 0.0, 0, 0.47, 0.06, 0.37, 14, 6), 0, [0.86, 0.8, 0.6, 0.8]),   // the pale underside
    part(tube([[0.42, 0.04, 0, 0.08], [0.56, 0.06, 0, 0.09], [0.66, 0.06, 0, 0.07]], 10), 7, [0.55, 0.5, 0.35, 0.5]),
    ...eyes(0.66, 0.1, 0.05, 0.018),
    part(plate([[0.15, 0.3], [0.25, 0.85], [0.0, 0.95], [-0.05, 0.32]], 0.02), 1, [0.55, 0.5, 0.35, 0.5]),
    part(plate([[0.15, -0.3], [0.25, -0.85], [0.0, -0.95], [-0.05, -0.32]], 0.02), 2, [0.55, 0.5, 0.35, 0.5]),
    part(plate([[-0.3, 0.22], [-0.45, 0.48], [-0.55, 0.36], [-0.42, 0.18]], 0.0), 0, [0.55, 0.5, 0.35, 0.5]),
    part(plate([[-0.3, -0.22], [-0.45, -0.48], [-0.55, -0.36], [-0.42, -0.18]], 0.0), 0, [0.55, 0.5, 0.35, 0.5]),
  ]),
  // an otter swimming: a long sleek body low in the water, its head up, whiskered muzzle, small ears, a thick tapering tail
  otter: () => merge([
    part(tube([[-0.5, -0.02, 0, 0.08], [-0.3, 0.0, 0, 0.15, 0.13], [0.0, 0.02, 0, 0.17, 0.15], [0.25, 0.05, 0, 0.14, 0.13], [0.38, 0.1, 0, 0.1]], 12), 0),
    part(tube([[-0.5, -0.02, 0, 0.08], [-0.8, -0.04, 0, 0.05], [-1.0, -0.05, 0, 0.012]], 8), 8),
    part(blob(0.48, 0.17, 0, 0.12, 0.1, 0.1, 12, 8), 7),
    part(blob(0.59, 0.15, 0, 0.06, 0.05, 0.06, 8, 6), 7, [0.85, 0.78, 0.66, 0.6]),   // muzzle
    part(blob(0.645, 0.165, 0, 0.022, 0.018, 0.026, 6, 4), 7, DARK),
    part(blob(0.43, 0.26, 0.07, 0.025, 0.02, 0.015, 6, 4), 7), part(blob(0.43, 0.26, -0.07, 0.025, 0.02, 0.015, 6, 4), 7),
    ...eyes(0.55, 0.2, 0.06, 0.018),
    part(blob(0.15, -0.06, 0, 0.13, 0.06, 0.12, 10, 6), 0, [0.82, 0.74, 0.6, 0.55]),   // pale chest
  ]),
  // an alligator in the water: mostly under it — the ridged back, the snout and the raised eyes and nostrils show
  alligator: () => merge([
    part(tube([[-0.35, -0.05, 0, 0.13, 0.08], [-0.1, -0.03, 0, 0.17, 0.1], [0.15, -0.02, 0, 0.16, 0.09], [0.32, -0.02, 0, 0.11, 0.07]], 12), 0),
    part(tube([[-0.35, -0.05, 0, 0.12, 0.08], [-0.7, -0.06, 0, 0.07, 0.06], [-1.05, -0.07, 0, 0.012, 0.02]], 10), 8),
    part(tube([[0.3, -0.02, 0, 0.1, 0.06], [0.5, -0.02, 0, 0.075, 0.045], [0.7, -0.03, 0, 0.05, 0.03]], 10), 7),
    ...[-0.25, -0.1, 0.05, 0.2, -0.45, -0.6].map(x => part(blob(x, 0.06 - (x < -0.3 ? 0.02 : 0), 0, 0.045, 0.035, 0.03, 6, 4), 0, SHADE(0.8))),   // the back's ridge
    part(blob(0.36, 0.035, 0.05, 0.03, 0.03, 0.03, 8, 6), 7, [0.75, 0.68, 0.25, 1]), part(blob(0.36, 0.035, -0.05, 0.03, 0.03, 0.03, 8, 6), 7, [0.75, 0.68, 0.25, 1]),
    part(blob(0.68, 0.0, 0.015, 0.012, 0.012, 0.012, 6, 4), 7, DARK), part(blob(0.68, 0.0, -0.015, 0.012, 0.012, 0.012, 6, 4), 7, DARK),
    part(blob(0.0, -0.11, 0, 0.18, 0.04, 0.12, 10, 6), 0, [0.78, 0.74, 0.55, 0.6]),
  ]),
  // a beaver swimming (2026-10-03: otters and beavers in the rivers): a broad, rounded body low in the water, a
  // blunt head up with small round ears, and the flat, dark paddle of its tail trailing on the surface behind
  beaver: () => merge([
    part(tube([[-0.42, -0.03, 0, 0.12, 0.1], [-0.25, 0.0, 0, 0.21, 0.17], [0.0, 0.02, 0, 0.23, 0.19], [0.22, 0.04, 0, 0.18, 0.15], [0.34, 0.08, 0, 0.11]], 12), 0),
    part(blob(0.44, 0.13, 0, 0.13, 0.11, 0.115, 12, 8), 7),
    part(blob(0.56, 0.1, 0, 0.065, 0.055, 0.07, 8, 6), 7, [0.42, 0.33, 0.25, 0.5]),   // muzzle
    part(blob(0.615, 0.115, 0, 0.024, 0.018, 0.032, 6, 4), 7, DARK),
    part(blob(0.37, 0.23, 0.085, 0.032, 0.032, 0.02, 6, 4), 7, SHADE(0.8)), part(blob(0.37, 0.23, -0.085, 0.032, 0.032, 0.02, 6, 4), 7, SHADE(0.8)),
    ...eyes(0.51, 0.17, 0.075, 0.016),
    part(plate([[-0.38, 0.05], [-0.52, 0.11], [-0.74, 0.11], [-0.82, 0.0], [-0.74, -0.11], [-0.52, -0.11], [-0.38, -0.05]], 0.02, 0.01), 8, [0.17, 0.14, 0.12, 0.9]),   // the flat tail, awash
  ]),
  // a bottlenose dolphin (2026-10-04: "more sea life like dolphins"; reshaped: it looked stubby nose-on): a slim
  // body about five times as long as it is deep, the beak long and distinct under a rounded forehead (the melon), the
  // tail stock tall and narrow; a curved dorsal fin, flippers angled down and back, notched flukes, every fin with some
  // thickness; dark back, pale belly. Body and flukes are part 8: the back half bends as the flukes beat up and down.
  dolphin: () => {
    const CAPE = [0.3, 0.34, 0.39, 0.65], BELLY = [0.9, 0.9, 0.92, 0.9];
    const body = [[-1.0, 0.0, 0, 0.02, 0.025], [-0.9, 0.01, 0, 0.03, 0.055], [-0.72, 0.02, 0, 0.056, 0.104], [-0.5, 0.03, 0, 0.112, 0.155], [-0.25, 0.035, 0, 0.171, 0.203],
      [0.0, 0.04, 0, 0.203, 0.23], [0.2, 0.045, 0, 0.203, 0.235], [0.42, 0.045, 0, 0.187, 0.214], [0.6, 0.04, 0, 0.152, 0.173], [0.72, 0.03, 0, 0.112, 0.128],
      [0.8, 0.005, 0, 0.075, 0.08], [0.86, -0.01, 0, 0.05, 0.045], [0.95, -0.015, 0, 0.04, 0.034], [1.04, -0.02, 0, 0.028, 0.024], [1.1, -0.025, 0, 0.012, 0.012]];
    const flip = sd => fin([[0.0, 0.0], [0.1, 0.04], [0.07, 0.13], [-0.03, 0.22], [-0.1, 0.255], [-0.11, 0.19], [-0.09, 0.09], [-0.11, 0.0]].map(([x, z]) => [x, z * sd]), 0, 0.022)
      .map(g => part(g.rotateX(0.62 * sd).translate(0.4, -0.08, 0.12 * sd), 0, SHADE(0.8)));
    return merge([
      countershade(part(tube(body, 16), 8), CAPE, BELLY),   // (part 8 all along; only its back half bends)
      // dorsal fin: swept back, the trailing edge hollowed
      ...fin([[0.14, 0], [0.06, 0.1], [-0.04, 0.19], [-0.14, 0.27], [-0.23, 0.31], [-0.2, 0.23], [-0.16, 0.14], [-0.15, 0.06], [-0.2, 0]], 0, 0.02)
        .map(g => part(g.rotateX(-Math.PI / 2).translate(0, 0.22, 0), 0, [0.3, 0.34, 0.39, 0.6])),
      ...flip(1), ...flip(-1),
      // flukes: swept-back lobes with a notch between, fanned from inside the notch
      ...fin([[-0.96, 0.03], [-1.02, 0.14], [-1.1, 0.26], [-1.2, 0.36], [-1.25, 0.35], [-1.23, 0.25], [-1.19, 0.12], [-1.17, 0.0], [-1.19, -0.12], [-1.23, -0.25], [-1.25, -0.35], [-1.2, -0.36], [-1.1, -0.26], [-1.02, -0.14], [-0.96, -0.03]], 0.0, 0.012, [-1.06, 0])
        .map(g => part(g, 8, [0.3, 0.34, 0.39, 0.5])),
      ...eyes(0.62, 0.0, 0.13, 0.021),
      part(blob(0.47, 0.235, 0, 0.012, 0.006, 0.022, 6, 4), 0, DARK),   // blowhole
    ]);
  },
  // a gull (2026-10-04: seagulls): white head and body, grey back and wings with black tips, a yellow bill, pale legs
  seagull: () => merge([
    part(tube([[-0.5, 0.03, 0, 0.06, 0.05], [-0.28, 0.05, 0, 0.18, 0.17], [0.08, 0.07, 0, 0.22, 0.21], [0.36, 0.1, 0, 0.16, 0.16]], 10), 0),
    part(blob(0.46, 0.17, 0, 0.15, 0.14, 0.14, 10, 8), 7),
    part(tube([[0.58, 0.15, 0, 0.04, 0.035], [0.74, 0.12, 0, 0.012, 0.015]], 6, false), 7, [0.95, 0.78, 0.15, 1]),
    ...eyes(0.54, 0.21, 0.09, 0.022),
    part(plate([[-0.42, 0], [-0.78, 0.18], [-0.82, 0.0], [-0.78, -0.18]], 0.05), 8, [0.55, 0.58, 0.62, 0.9]),
    part(plate([[0.22, 0.08], [0.08, 0.7], [-0.2, 0.75], [-0.36, 0.5], [-0.32, 0.08]], 0.08, 0.04), 1, [0.62, 0.65, 0.7, 0.9]),
    part(plate([[0.08, 0.7], [0.02, 1.15], [-0.16, 1.18], [-0.2, 0.75]], 0.08, 0.02), 1, [0.06, 0.06, 0.07, 1]),
    part(plate([[0.22, -0.08], [0.08, -0.7], [-0.2, -0.75], [-0.36, -0.5], [-0.32, -0.08]], 0.08, 0.04), 2, [0.62, 0.65, 0.7, 0.9]),
    part(plate([[0.08, -0.7], [0.02, -1.15], [-0.16, -1.18], [-0.2, -0.75]], 0.08, 0.02), 2, [0.06, 0.06, 0.07, 1]),
    part(tube([[0.02, -0.08, 0.06, 0.015], [0.04, -0.3, 0.06, 0.012]], 4), 0, [0.85, 0.75, 0.6, 1]), part(tube([[0.02, -0.08, -0.06, 0.015], [0.04, -0.3, -0.06, 0.012]], 4), 0, [0.85, 0.75, 0.6, 1]),
  ]),
  // a shore crab (2026-10-04: crabs): a wide flat shell, two claws held up in front (the head part), eight jointed
  // legs splayed out (they scuttle: parts 3–6, two a side each)
  crab: () => merge([
    part(blob(0, 0.32, 0, 0.42, 0.16, 0.55, 14, 8), 0),
    part(blob(0, 0.26, 0, 0.36, 0.08, 0.48, 12, 5), 0, [0.92, 0.86, 0.72, 0.7]),   // pale underside
    ...eyes(0.36, 0.48, 0.12, 0.04),
    ...[1, -1].flatMap(sd => [
      part(tube([[0.3, 0.3, 0.32 * sd, 0.06], [0.52, 0.38, 0.52 * sd, 0.07], [0.7, 0.42, 0.46 * sd, 0.08]], 6), 7),
      part(blob(0.82, 0.44, 0.42 * sd, 0.16, 0.12, 0.1, 8, 6), 7, SHADE(0.85)),
      ...[0, 1, 2, 3].map(k => {
        const x = 0.18 - k * 0.14, id = k < 2 ? (sd > 0 ? 3 : 4) : (sd > 0 ? 5 : 6);
        return part(tube([[x, 0.3, 0.42 * sd, 0.04], [x - 0.04, 0.42, 0.82 * sd, 0.035], [x - 0.08, 0.02, 1.08 * sd, 0.02]], 5), id, SHADE(0.9));
      }),
    ]),
  ]),
};

const ANIM = /* glsl */`
attribute float aPart;
attribute vec4 aTone, aAnim;
uniform float uTime;
varying vec4 vTone;
varying vec3 vObj;
varying float vGlow;
vec3 rotX(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z); }
vec3 animate(vec3 p) {
  float t = uTime * aAnim.y + aAnim.x, mode = aAnim.z;
  vTone = aTone; vObj = p; vGlow = 0.0;
  // wings: flap when flying, spread when gliding, folded at rest
  if (aPart > 0.5 && aPart < 2.5) {
    float side = aPart < 1.5 ? 1.0 : -1.0;
    float a = mode > 2.5 && mode < 3.5 ? sin(t * 6.2832) * 0.95 : mode > 3.5 && mode < 4.5 ? 0.12 + sin(t * 1.3) * 0.06 : -1.25;
    p = rotX(p, a * side);
  }
  // legs swing about the hip when walking or running
  if (aPart > 2.5 && aPart < 6.5) {
    float front = aPart < 4.5 ? 1.0 : 0.0, left = mod(aPart, 2.0) > 0.5 ? 1.0 : 0.0;
    float amp = mode > 0.5 && mode < 1.5 ? 0.35 : mode > 1.5 && mode < 2.5 ? 0.85 : 0.0;
    float hip = aAnim.w;   // the model's hip height (per species)
    float ph = t * 6.2832 + (left > 0.5 ? 0.0 : 3.1416) + (front > 0.5 ? 0.0 : 1.5708);
    vec3 q = p - vec3(0.0, hip, 0.0);
    p = rotZ(q, sin(ph) * amp) + vec3(0.0, hip, 0.0);
  }
  // heads dip to graze at rest; tails flick
  if (aPart > 6.5 && aPart < 7.5 && mode < 0.5 && aAnim.w > 0.0) { vec3 pv = vec3(0.45, aAnim.w + 0.45, 0.0); p = rotZ(p - pv, -0.9 * (0.5 + 0.5 * sin(t * 0.7))) + pv; }
  if (aPart > 7.5 && aAnim.w < -0.5) { float u = max(0.0, -p.x - 0.5); p.y += sin(t * 3.0 - u * 2.0) * 0.17 * u * u; }   // (a dolphin's back half bends, the flukes beating up and down)
  else if (aPart > 7.5) p.z += sin(t * 9.0) * 0.04 * (1.0 + max(0.0, 1.0 - p.y));
  // bodies: hop (rabbits), bob (swimmers and flyers), glow (fireflies)
  if (mode > 5.5 && mode < 6.5) p.y += abs(sin(t * 3.1416)) * 0.45;
  if (mode > 4.5 && mode < 5.5) p.y += sin(t * 1.7) * 0.03;
  if (mode > 2.5 && mode < 3.5) p.y -= sin(t * 6.2832) * 0.05;
  if (mode > 6.5) vGlow = 0.5 + 0.5 * sin(t * 2.4);
  return p;
}`;
/** The material for a model: vertex animation, per-instance colour with painted markings. */
export function faunaMaterial(model) {
  const glow = model === 'firefly';
  const m = glow ? new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: ['butterfly', 'bird', 'fish', 'duck', 'reeffish', 'turtle', 'dolphin', 'seagull'].includes(model) ? THREE.DoubleSide : THREE.FrontSide });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = GU.uTime;
    sh.vertexShader = ANIM + '\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = animate(vec3(position));');
    sh.fragmentShader = `varying vec4 vTone;\nvarying vec3 vObj;\nvarying float vGlow;
float fH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fN(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fH(i), fH(i + vec3(1, 0, 0)), f.x), mix(fH(i + vec3(0, 1, 0)), fH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(fH(i + vec3(0, 0, 1)), fH(i + vec3(1, 0, 1)), f.x), mix(fH(i + vec3(0, 1, 1)), fH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      if (vTone.a < -1.5) diffuseColor.rgb *= vTone.r;   // a shaded part of the coat
      else if (vTone.a < -0.5) {
        // patches (a dark coat with white, a pale one with brown)
        float n = fN(vObj * 4.2) * 0.65 + fN(vObj * 9.0) * 0.35, coat = dot(diffuseColor.rgb, vec3(0.33));
        diffuseColor.rgb = mix(diffuseColor.rgb, coat < 0.5 ? vTone.rgb : vec3(0.42, 0.26, 0.16), smoothstep(0.56, 0.6, n) * 0.95);
      } else diffuseColor.rgb = mix(diffuseColor.rgb, vTone.rgb, vTone.a);
      ${glow ? 'diffuseColor.a *= 0.25 + 0.75 * vGlow; diffuseColor.rgb *= 1.0 + vGlow * 2.0;' : ''}`);
  };
  m.customProgramCacheKey = () => `fauna2-${model}`;
  return m;
}
