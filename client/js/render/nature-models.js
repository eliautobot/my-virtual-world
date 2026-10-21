// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The island's natural scatter as models in the city's style (the design review 2026-10-03: "it's no longer a low-poly, retro
// style ... this is a brand new style"): rounded, softly shaded crowns built like the city's street trees (render/
// furniture.js treeRound), each in a close version (a crown of several leafy masses, branches, a flared trunk) and a far
// one (the same silhouette from a few masses) - the terrain swaps between them by distance; layered firs; bushes of
// several masses; boulders with layered stone; grass tufts and wild-flower clumps for the ground near the camera.
// Geometry: position, normal, color (linear) and aTint (1 where the per-instance colour applies: leaves, petals).
import * as THREE from 'three';
import { FB } from './furniture.js';

const TAU = Math.PI * 2;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const noise3 = (a, b, c, k) => Math.sin(a * 5.1 + k) * Math.sin(b * 4.3 + k * 1.7) * Math.sin(c * 5.7 + k * 0.6);
// lighter on top, darker underneath and inside: a crown lit by the sky
const leafShade = (dx, dy) => 0.55 + 0.45 * Math.max(0, dy * 0.5 + 0.5);

/**
 * FB (aC: linear rgb + tint flag) → geometry with color and aTint. puff (0..1): the leaves' normals turned toward the
 * crown's own round shape (2026-10-03: "smooth ... cozy 3D"): the whole crown is lit as one soft, puffy mass with
 * its lobes still showing a little, instead of each little facet catching the light on its own - the way cozy games
 * shade foliage. The crown: an ellipsoid round the leaves' bounding box.
 */
function fromFB(f, puff = 0) {
  const { geo } = f.build(), aC = geo.attributes.aC, n = aC.count, col = new Float32Array(n * 3), tint = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = aC.getX(i); col[i * 3 + 1] = aC.getY(i); col[i * 3 + 2] = aC.getZ(i); tint[i] = aC.getW(i) % 2 >= 1 ? 1 : 0; }
  geo.deleteAttribute('aC');
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  if (puff > 0) {
    const P = geo.attributes.position, N = geo.attributes.normal, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) if (tint[i]) for (let k = 0; k < 3; k++) { const v = P.array[i * 3 + k]; lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v); }
    const c = lo.map((v, k) => (v + hi[k]) / 2), r = lo.map((v, k) => Math.max(0.3, (hi[k] - v) / 2));
    c[1] -= r[1] * 0.25;   // a little below the middle: the crown's top rounder, its underside flatter
    for (let i = 0; i < n; i++) {
      if (!tint[i]) continue;
      let ex = (P.getX(i) - c[0]) / (r[0] * r[0]), ey = (P.getY(i) - c[1]) / (r[1] * r[1]), ez = (P.getZ(i) - c[2]) / (r[2] * r[2]);
      const el = Math.hypot(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
      let nx = N.getX(i) * (1 - puff) + ex * puff, ny = N.getY(i) * (1 - puff) + ey * puff, nz = N.getZ(i) * (1 - puff) + ez * puff;
      const l = Math.hypot(nx, ny, nz) || 1; N.setXYZ(i, nx / l, ny / l, nz / l);
    }
    N.needsUpdate = true;
  }
  geo.computeBoundingSphere();
  return geo;
}
function trunk(f, h, r, seg = 8) { f.col('#5e4330'); f.lathe(0, 0, seg > 5 ? [[r * 1.6, 0], [r * 1.15, 0.25], [r, 0.6], [r * 0.82, h * 0.7], [r * 0.62, h]] : [[r * 1.3, 0], [r * 0.7, h]], seg); }

/** A broad-leaved tree (oak-like, round crown) or (tall) a lime-like tree with an oval crown. */
function broadleaf(tall, near) {
  const f = new FB(), r = rng(tall ? 31 : 17), h = tall ? 8.5 : 6.4;
  trunk(f, h * (tall ? 0.62 : 0.55), tall ? 0.2 : 0.24, near ? 8 : 5);
  if (near) {
    // main limbs reaching into the crown
    f.col('#5e4330');
    for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + 0.4, y0 = h * 0.45; f.rod([0, y0, 0], [Math.cos(a) * 1.4, y0 + 1.5, Math.sin(a) * 1.4], 0.09, 5); }
  }
  const leaf = tall ? '#5a8f3a' : '#4f8a34';
  f.col(leaf, 1);
  const blobs = tall
    ? [[0, h * 0.62, 0, 1.75, 1.5], [0.2, h * 0.82, 0.1, 1.45, 1.25], [-0.5, h * 0.5, 0.4, 1.3, 1.0], [0.6, h * 0.55, -0.4, 1.25, 1.0], [0, h * 0.97, 0, 1.0, 0.9]]
    : [[0, h * 0.66, 0, 2.15, 1.7], [1.25, h * 0.58, 0.5, 1.45, 1.2], [-1.15, h * 0.62, -0.7, 1.5, 1.25], [0.35, h * 0.86, -0.45, 1.5, 1.2], [-0.6, h * 0.55, 1.1, 1.3, 1.0]];
  // far off, the crown's two biggest masses, a little fuller
  const use = near ? blobs : blobs.slice(0, 2);
  for (const [x, y, z, rad, ry] of use) {
    const k = r() * 10;
    f.sph(x, y, z, rad * (near ? 1 : 1.25), ry * (near ? 1 : 1.15), rad * (near ? 1 : 1.25), near ? 12 : 9, near ? 8 : 6, { shade: leafShade, disp: near ? (a, b, c) => 0.12 * noise3(a, b, c, k) + 0.04 * noise3(a * 2.3, b * 2.1, c * 2.7, k + 3) : null });
  }
  return fromFB(f, near ? 0.6 : 0.75);
}
/** A birch: a slender pale trunk with dark marks, a light, airy crown of small masses. */
function birch(near) {
  const f = new FB(), r = rng(53), h = 8;
  f.col('#e4e0d6'); f.lathe(0, 0, near ? [[0.2, 0], [0.15, 0.4], [0.13, h * 0.5], [0.07, h * 0.85]] : [[0.17, 0], [0.08, h * 0.8]], near ? 7 : 5);
  if (near) { f.col('#2b2622'); for (let k = 0; k < 6; k++) { const y = 0.8 + k * 0.6, a = r() * TAU; f.boxC(Math.cos(a) * 0.13, y, Math.sin(a) * 0.13, 0.04, 0.02, 0.04, a); } }
  f.col('#86b04f', 1);
  const blobs = [[0, h * 0.72, 0, 1.25, 1.6], [0.6, h * 0.58, 0.3, 0.95, 1.1], [-0.55, h * 0.62, -0.35, 1.0, 1.2], [0.15, h * 0.9, -0.2, 0.8, 1.0], [-0.3, h * 0.5, 0.6, 0.8, 0.9]];
  for (const [x, y, z, rad, ry] of near ? blobs : blobs.slice(0, 2)) {
    const k = r() * 10;
    f.sph(x, y, z, rad * (near ? 1 : 1.2), ry * (near ? 1 : 1.15), rad * (near ? 1 : 1.2), near ? 11 : 8, near ? 7 : 5, { shade: leafShade, disp: near ? (a, b, c) => 0.14 * noise3(a, b, c, k) : null });
  }
  return fromFB(f, near ? 0.55 : 0.7);
}
/** A fir: tiers of drooping boughs, their rims uneven. */
function conifer(near) {
  const f = new FB(), h = 9;
  trunk(f, h * 0.5, 0.17, near ? 7 : 5);
  f.col('#356b33', 1);
  const tiers = near ? 6 : 3;
  for (let t = 0; t < tiers; t++) {
    const y0 = h * (0.16 + t * 0.78 / tiers), r0 = 2.3 * (1 - t / (tiers + 0.6)), seg = near ? 11 : 7;
    // (from the underside's middle out to the rim and up to the tip: the lathe lights and culls a profile that runs
    // upward - listed tip-first, every tier was inside out, and from outside one saw into it and the trunk, 2026-10-04)
    const prof = [[0, y0 - 0.25], [r0 * 0.82, y0 - 0.35], [r0, y0 - 0.15], [r0 * 0.35, y0 + h * 0.1], [0, y0 + h * (near ? 0.2 : 0.32)]];
    if (near) {
      // boughs: the rim pulled in and out around the tier
      const b = f.buf().P.length / 3;
      f.lathe(0, 0, prof, seg);
      const P = f.buf().P, n = (f.buf().P.length / 3) - b;
      for (let v = 0; v < n; v++) { const i = (b + v) * 3, a = Math.atan2(P[i + 2], P[i]), k = 1 + 0.13 * Math.sin(a * 5 + t * 1.7) + 0.06 * Math.sin(a * 11 + t); P[i] *= k; P[i + 2] *= k; }
    } else f.lathe(0, 0, prof, seg);
  }
  return fromFB(f, 0.35);
}
/** A bush of several leafy masses. */
function bush() {
  const f = new FB(), r = rng(5);
  f.col('#5a8a33', 1);
  for (const [x, y, z, s] of [[0, 0.5, 0, 0.62], [0.42, 0.4, 0.22, 0.45], [-0.38, 0.42, -0.2, 0.48], [0.1, 0.62, -0.38, 0.4]]) {
    const k = r() * 10;
    f.sph(x, y, z, s, s * 0.85, s, 10, 7, { cut: -0.45, shade: leafShade, disp: (a, b, c) => 0.1 * noise3(a, b, c, k) });
  }
  return fromFB(f, 0.6);
}
/**
 * A boulder with two smaller stones beside it (2026-10-03: "rocks ... more natural, not lego"): each stone a
 * sphere cut by a few planes - the flat, chipped faces of broken rock - its edges worn round, a little rough; greys
 * and browns that vary over it, darker in its hollows and underneath, lichen on its top, moss low down on one side.
 */
function rock(stones = [[0, 0, 0.95, 0.66, 2, 7], [1.05, 0.5, 0.42, 0.75, 1, 5], [-0.8, 0.62, 0.32, 0.8, 1, 5]], seed = 9) {
  const pos = [], nrm = [], col = [], tint = [], idx = [], r = rng(seed);
  const lin = c => c.map(v => v * v * (0.8 + 0.2 * v));
  const grey = lin([0.56, 0.54, 0.5]), brown = lin([0.55, 0.49, 0.42]), dark = lin([0.36, 0.35, 0.33]), lichen = lin([0.72, 0.7, 0.42]), moss = lin([0.36, 0.44, 0.24]);
  for (const [x, z, s, sq, subdiv, cuts] of stones) {
    const ico = new THREE.IcosahedronGeometry(1, subdiv), P = ico.attributes.position, base = pos.length / 3, k = r() * 10;
    // the cutting planes: their normals spread round the stone, each a little way in
    const planes = [];
    for (let c = 0; c < cuts; c++) { const u = (r() * 2 - 1) * 0.8, a = r() * TAU, q = Math.sqrt(1 - u * u); planes.push([q * Math.cos(a), u, q * Math.sin(a), 0.72 + r() * 0.2]); }
    planes.push([0, -1, 0, 0.42]);   // its base, sunk in the ground
    // the icosahedron's vertices are shared along its edges (non-indexed copies): weld them so the stone is closed
    const key = new Map(), uniq = [], map = [];
    for (let i = 0; i < P.count; i++) { const kk = `${P.getX(i).toFixed(4)},${P.getY(i).toFixed(4)},${P.getZ(i).toFixed(4)}`; let j = key.get(kk); if (j === undefined) { j = uniq.length; key.set(kk, j); uniq.push([P.getX(i), P.getY(i), P.getZ(i)]); } map.push(j); }
    const V = uniq.map(([dx, dy, dz]) => {
      // the nearest cut along this direction (a convex stone), worn round toward the sphere, roughened a little
      let rad = 1;
      for (const [nx, ny, nz, d] of planes) { const c = dx * nx + dy * ny + dz * nz; if (c > 0.05) rad = Math.min(rad, d / c); }
      rad = rad * 0.86 + 0.14 * Math.min(1, rad + 0.1);
      rad *= 1 + 0.05 * noise3(dx * 2.1, dy * 2.3, dz * 1.9, k) + 0.025 * noise3(dx * 5.3, dy * 4.9, dz * 5.7, k + 3);
      return [x + dx * rad * s * 1.2, (dy * rad + 0.42) * s * sq, z + dz * rad * s, rad, dx, dy, dz];
    });
    // smooth normals from the faces (the cut faces stay flat, their edges shade round)
    const N = V.map(() => [0, 0, 0]), F = [];
    for (let i = 0; i < map.length; i += 3) {
      const [a, b, c] = [map[i], map[i + 1], map[i + 2]], A = V[a], B = V[b], Cc = V[c];
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = Cc[0] - A[0], vy = Cc[1] - A[1], vz = Cc[2] - A[2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { N[q][0] += fx; N[q][1] += fy; N[q][2] += fz; }
      F.push(a, b, c);
    }
    V.forEach(([px, py, pz, rad, dx, dy, dz], i) => {
      const n = N[i], l = Math.hypot(n[0], n[1], n[2]) || 1, ny = n[1] / l;
      pos.push(px, py, pz); nrm.push(n[0] / l, ny, n[2] / l);
      // colour: greys into browns over the stone, darker where cut deep (hollows) and underneath, lichen on top,
      // moss low on one side
      const m = 0.5 + 0.5 * noise3(dx * 1.7, dy * 1.9, dz * 1.6, k + 5);
      let c = grey.map((g, q) => g + (brown[q] - g) * m);
      c = c.map((v, q) => v + (dark[q] - v) * Math.min(1, (1 - rad) * 1.6 + Math.max(0, -dy) * 0.5));
      const li = Math.max(0, ny) * Math.max(0, noise3(dx * 3.1, dy * 2.7, dz * 3.3, k + 9) * 2.2 - 0.6);
      c = c.map((v, q) => v + (lichen[q] - v) * Math.min(0.8, li));
      const mo = Math.max(0, 0.35 - (dy + 0.42) / 1.42) * 2.4 * Math.max(0, dz * 0.7 + dx * 0.3 + 0.2);
      c = c.map((v, q) => v + (moss[q] - v) * Math.min(0.75, mo));
      col.push(...c); tint.push(1);
    });
    for (const i of F) idx.push(base + i);
    ico.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
  g.setIndex(idx);
  // the faces' winding: outward (the icosahedron's own)
  g.computeBoundingSphere();
  return g;
}

/** A single big boulder, rounder and more weathered (rivers' rocks of every size, 2026-10-03). */
const boulder = () => rock([[0, 0, 1.0, 0.72, 2, 6]], 23);
/** A scatter of small stones and pebbles. */
function pebbles() {
  const r = rng(47), st = [];
  for (let k = 0; k < 9; k++) { const a = r() * TAU, d = Math.sqrt(r()) * 1.1, s = 0.12 + r() * 0.2; st.push([Math.cos(a) * d, Math.sin(a) * d, s, 0.55 + r() * 0.3, 1, 5]); }
  return rock(st, 51);
}

/** A grass tuft: slender blades fanning out, dark at the base, light at the tips; for a double-sided material. */
function grassTuft() {
  const pos = [], nrm = [], col = [], tint = [], r = rng(77), N = 11;
  for (let k = 0; k < N; k++) {
    const a = k / N * TAU + r() * 0.6, lean = 0.25 + r() * 0.35, h = 0.42 + r() * 0.4, w = 0.03 + r() * 0.018, d = 0.04 + r() * 0.14, ox = Math.cos(a) * d, oz = Math.sin(a) * d;
    const tx = ox + Math.cos(a) * lean * h, tz = oz + Math.sin(a) * lean * h, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, tx, h, tz);
    for (let q = 0; q < 3; q++) { nrm.push(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3); tint.push(1); }
    // the base takes the ground's colour, the tips catch the light
    const tip = 1.12 + r() * 0.1;   // the tips catch the light (fresh, not pale), the base in the grass's shade
    col.push(0.7, 0.74, 0.68, 0.7, 0.74, 0.68, tip * 0.98, tip * 1.05, tip * 0.82);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
  g.computeBoundingSphere();
  return g;
}
/** A clump of wild flowers: stems with open six-petalled heads (the petals take the instance's colour, the hearts stay gold). */
function flowerClump() {
  const pos = [], nrm = [], col = [], tint = [], r = rng(41);
  const v = (x, y, z, nx, ny, nz, c, t) => { pos.push(x, y, z); nrm.push(nx, ny, nz); col.push(...c); tint.push(t); };
  const stem = [0.2, 0.36, 0.12], heart = [0.95, 0.75, 0.15], petal = [1, 1, 1];
  for (let k = 0; k < 5; k++) {
    const a = k * 1.3 + r(), d = 0.05 + r() * 0.16, x = Math.cos(a) * d, z = Math.sin(a) * d, h = 0.32 + r() * 0.26, R = 0.045 + r() * 0.03;
    // stem: a thin blade, two-sided
    v(x - 0.008, 0, z, 0, 0.3, 1, stem, 0); v(x + 0.008, 0, z, 0, 0.3, 1, stem, 0); v(x, h, z, 0, 0.3, 1, stem, 0);
    // head: six petals round a heart, facing up and a little out
    const tx = Math.cos(a) * 0.3, tz = Math.sin(a) * 0.3;
    for (let p = 0; p < 6; p++) {
      const b0 = p / 6 * TAU, b1 = (p + 0.5) / 6 * TAU, b2 = (p + 1) / 6 * TAU;
      const rim = b => [x + Math.cos(b) * R, h + (Math.cos(b) * tx + Math.sin(b) * tz) * R * 0.5, z + Math.sin(b) * R];
      const c0 = [x, h + 0.005, z], p0 = rim(b0), p1 = rim(b1).map((q, i) => (i === 1 ? q : c0[i] + (q - c0[i]) * 1.45)), p2 = rim(b2);
      v(...c0, tx, 1, tz, heart, 0); v(...p0, tx, 1, tz, petal, 1); v(...p1, tx, 1, tz, petal, 1);
      v(...c0, tx, 1, tz, heart, 0); v(...p1, tx, 1, tz, petal, 1); v(...p2, tx, 1, tz, petal, 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
  g.computeBoundingSphere();
  return g;
}

/** Reeds by still water: tall leaves in a fan, a few bulrushes standing among them. */
function reeds() {
  const pos = [], nrm = [], col = [], tint = [], r = rng(91);
  const v = (x, y, z, nx, ny, nz, c, t) => { pos.push(x, y, z); nrm.push(nx, ny, nz); col.push(...c); tint.push(t); };
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * TAU + r() * 0.5, d = r() * 0.25, x = Math.cos(a) * d, z = Math.sin(a) * d, h = 1.1 + r() * 0.8, lean = 0.08 + r() * 0.15, w = 0.03;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    v(x - px, 0, z - pz, Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3, [0.45, 0.5, 0.3], 1); v(x + px, 0, z + pz, Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3, [0.45, 0.5, 0.3], 1);
    v(x + Math.cos(a) * lean * h, h, z + Math.sin(a) * lean * h, Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3, [0.85, 0.88, 0.62], 1);
  }
  for (let k = 0; k < 3; k++) {
    // a bulrush: a thin stem and a brown velvet head
    const a = r() * TAU, d = r() * 0.15, x = Math.cos(a) * d, z = Math.sin(a) * d, h = 1.3 + r() * 0.5, R = 0.035;
    v(x - 0.01, 0, z, 0, 0.3, 1, [0.4, 0.45, 0.25], 0); v(x + 0.01, 0, z, 0, 0.3, 1, [0.4, 0.45, 0.25], 0); v(x, h + 0.25, z, 0, 0.3, 1, [0.5, 0.55, 0.3], 0);
    for (let q = 0; q < 6; q++) {
      const b0 = q / 6 * TAU, b1 = (q + 1) / 6 * TAU, c = [0.32, 0.2, 0.11];
      const p0 = [x + Math.cos(b0) * R, z + Math.sin(b0) * R], p1 = [x + Math.cos(b1) * R, z + Math.sin(b1) * R];
      v(p0[0], h - 0.16, p0[1], Math.cos(b0), 0, Math.sin(b0), c, 0); v(p1[0], h - 0.16, p1[1], Math.cos(b1), 0, Math.sin(b1), c, 0); v(p1[0], h, p1[1], Math.cos(b1), 0, Math.sin(b1), c, 0);
      v(p0[0], h - 0.16, p0[1], Math.cos(b0), 0, Math.sin(b0), c, 0); v(p1[0], h, p1[1], Math.cos(b1), 0, Math.sin(b1), c, 0); v(p0[0], h, p0[1], Math.cos(b0), 0, Math.sin(b0), c, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
  g.computeBoundingSphere();
  return g;
}

/** Water-lily pads on still water, a few in flower (the instance's colour tints the pads' green and the flowers). */
/**
 * A coral clump for the shallow sea floor (2026-10-03: "corals or underwater grass ... realistic, but not too
 * realistic"): a rounded rock seat with soft, chunky coral on it - branching fingers, a ridged brain coral, a fan, a few
 * tube sponges - in cheerful colours (the instance's colour tints them a little, so no two clumps match).
 */
function coral() {
  const f = new FB(), r = rng(71), lin = h => '#' + h;
  f.col('#7c7a86', 0); f.sph(0, 0.0, 0, 0.75, 0.32, 0.6, 9, 5, { cut: -0.2, shade: (dx, dy) => 0.7 + 0.3 * Math.max(0, dy), disp: (a, b, c) => 0.1 * noise3(a, b, c, 3) });
  // branching coral: chunky fingers fanning up and out
  f.col(lin('b26ce0'), 1);
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * TAU + r() * 0.5, h = 0.45 + r() * 0.35, x0 = -0.25 + Math.cos(a) * 0.12, z0 = 0.05 + Math.sin(a) * 0.12, x1 = x0 + Math.cos(a) * 0.25, z1 = z0 + Math.sin(a) * 0.25;
    f.rod([x0, 0.15, z0], [x1, 0.15 + h, z1], 0.055, 5); f.sph(x1, 0.15 + h, z1, 0.065, 0.065, 0.065, 5, 3);
  }
  // a brain coral: a ridged dome
  f.col(lin('f2c53d'), 1); f.sph(0.32, 0.18, -0.18, 0.32, 0.24, 0.3, 11, 7, { cut: -0.3, disp: (a, b, c) => 0.06 * Math.sin(a * 22 + b * 9) * Math.sin(c * 21 + b * 7) });
  // a fan
  f.col(lin('ff6f91'), 1); f.push(0.05, 0.12, 0.38, 0.5); f.sph(0, 0.35, 0, 0.32, 0.3, 0.04, 9, 6); f.pop();
  // tube sponges
  f.col(lin('ff9a3c'), 1);
  for (let k = 0; k < 3; k++) { const x = 0.45 + r() * 0.2, z = 0.2 + r() * 0.2, h = 0.25 + r() * 0.25; f.lathe(x, z, [[0.07, 0.1], [0.085, 0.1 + h * 0.6], [0.07, 0.1 + h], [0.04, 0.1 + h]], 6); }
  return fromFB(f, 0.25);
}
// ---- the reef (2026-10-04: "corals too small, randomly repeat across the floor ... coral reefs should be sections
// of coral, different types, not small pieces scattered"): the reef is laid out in sections by the terrain worker
// (render/terrain.worker.js reefAt); these are its colonies, each a big one of a kind, metres across, on reef rock.
// Their living parts take the instance's colour (aTint), so a thicket, a dome or a fan is its own shade of its type.
const reefRock = (f, r, w = 0.9, h = 0.3) => { f.col('#6f6a62', 0); f.sph(0, -0.05, 0, w, h, w * 0.85, 9, 5, { cut: -0.2, shade: (dx, dy) => 0.65 + 0.35 * Math.max(0, dy), disp: (a, b, c) => 0.14 * noise3(a, b, c, r() * 9) }); };
/** Staghorn thicket: a mound of antler-like branches forking up and out, paler at their growing tips. */
function coralBranch() {
  const f = new FB(), r = rng(91);
  reefRock(f, r, 0.85, 0.22);
  const branch = (x, y, z, a, tilt, len, rad, depth) => {
    const ex = x + Math.cos(a) * Math.sin(tilt) * len, ey = y + Math.cos(tilt) * len, ez = z + Math.sin(a) * Math.sin(tilt) * len;
    f.col('#c9a46a', 1); f.rod([x, y, z], [ex, ey, ez], rad, 5);
    if (depth > 0) for (let k = 0; k < 2; k++) branch(ex, ey, ez, a + (k ? 0.6 : -0.6) + (r() - 0.5) * 0.5, Math.min(1.2, tilt + 0.15 + r() * 0.25), len * (0.62 + r() * 0.15), rad * 0.72, depth - 1);
    else { f.col('#efe0c2', 1); f.sph(ex, ey, ez, rad * 1.2, rad * 1.2, rad * 1.2, 5, 3); }
  };
  for (let k = 0; k < 9; k++) { const a = k / 9 * TAU + r() * 0.5, d = r() * 0.55; branch(Math.cos(a) * d, 0.12, Math.sin(a) * d, a, 0.25 + r() * 0.45, 0.32 + r() * 0.12, 0.05, 2); }
  return fromFB(f, 0.15);
}
/** Brain coral: a broad boulder dome with meandering ridges, a smaller one beside it. */
function coralBrain() {
  const f = new FB(), r = rng(93);
  reefRock(f, r, 0.8, 0.2);
  const ridges = (a, b, c) => 0.05 * Math.sin(a * 17 + Math.sin(c * 6) * 3 + b * 5) * Math.sin(c * 15 + Math.sin(a * 5) * 3);
  f.col('#c8b46a', 1); f.sph(0, 0.12, 0, 0.62, 0.48, 0.58, 22, 12, { cut: -0.25, disp: ridges, shade: (dx, dy) => 0.7 + 0.3 * Math.max(0, dy) });
  f.col('#a9b06a', 1); f.sph(0.62, 0.05, 0.38, 0.32, 0.24, 0.3, 14, 8, { cut: -0.3, disp: ridges });
  return fromFB(f, 0.2);
}
/** Table coral: wide flat plates on short stalks, in tiers, their rims a little upturned. */
function coralTable() {
  const f = new FB(), r = rng(95);
  reefRock(f, r, 0.6, 0.18);
  // each plate lobed round its rim and tilted a little, a crust of short branchlets on top (not a smooth disc)
  const plate = (x, y, z, R, tilt) => {
    f.col('#8a8a62', 1); f.cyl(x, z, 0.1, 0.05, y, 7, 0.06);
    f.col('#a9a876', 1);
    f.sph(x, y, z, R, 0.06, R * 0.9, 20, 4, { disp: (a, b, c) => 0.18 * Math.sin(Math.atan2(c, a) * 7 + R * 9) * Math.hypot(a, c) + tilt * a * 0.5 });
    f.col('#c2bd86', 1); for (let k = 0; k < 14; k++) { const a = r() * TAU, d = r() * R * 0.8; f.sph(x + Math.cos(a) * d, y + 0.06 + a * 0.0, z + Math.sin(a) * d * 0.9, 0.05, 0.07, 0.05, 5, 3); }
  };
  plate(0, 0.55, 0, 0.8, 0.15); plate(0.55, 0.3, -0.45, 0.42, -0.2); plate(-0.45, 0.25, 0.4, 0.36, 0.1);
  return fromFB(f, 0.1);
}
/** Sea fans and soft corals: flat lacy fans standing across the current, tufts of soft coral at their feet. */
function coralFan() {
  const f = new FB(), r = rng(97);
  reefRock(f, r, 0.7, 0.2);
  for (let k = 0; k < 3; k++) {
    const x = (r() - 0.5) * 0.8, z = (r() - 0.5) * 0.6, h = 0.7 + r() * 0.5, w = 0.4 + r() * 0.25;
    f.col('#8a4fa8', 1); f.push(x, 0.1, z, 0.3 + (r() - 0.5) * 0.5);
    f.sph(0, h * 0.55, 0, w, h * 0.5, 0.025, 12, 8, { disp: (a, b, c) => 0.08 * Math.abs(Math.sin(a * 9 + b * 7)) });
    f.col('#6a3a86', 1); f.rod([0, 0, 0], [0, h * 0.3, 0], 0.03, 4);
    f.pop();
  }
  for (let k = 0; k < 6; k++) { const a = r() * TAU, d = 0.25 + r() * 0.5; f.col(k % 2 ? '#e0703a' : '#e4a0b8', 1); f.sph(Math.cos(a) * d, 0.18, Math.sin(a) * d, 0.12, 0.2, 0.12, 8, 5, { disp: (a1, b, c) => 0.25 * Math.max(0, b) * Math.abs(Math.sin(a1 * 7 + c * 5)) }); }
  return fromFB(f, 0.15);
}
/** Tube sponges and pillar coral: a clump of hollow tubes of different heights, pillars rising beside them. */
function coralTube() {
  const f = new FB(), r = rng(99);
  reefRock(f, r, 0.65, 0.2);
  for (let k = 0; k < 7; k++) {
    const a = r() * TAU, d = r() * 0.45, x = Math.cos(a) * d, z = Math.sin(a) * d, h = 0.35 + r() * 0.75, R = 0.07 + r() * 0.06;
    f.col(['#d8762e', '#e4c13d', '#7a52a6'][k % 3], 1); f.lathe(x, z, [[R * 0.8, 0.05], [R * 1.1, h * 0.5], [R * 1.25, h], [R * 0.85, h], [R * 0.75, h - 0.15]], 9);
  }
  for (let k = 0; k < 3; k++) { const x = 0.45 + r() * 0.25, z = -0.3 + r() * 0.6, h = 0.6 + r() * 0.6; f.col('#c9b98a', 1); f.lathe(x, z, [[0.09, 0.05], [0.08, h * 0.7], [0.065, h], [0, h + 0.04]], 8); }
  return fromFB(f, 0.1);
}
/**
 * A coconut palm (2026-10-04: "add palms so that the beach areas look the part"; reshaped: "the trunk looks like a
 * bunch of pieces of cylinders one on top of the other"). The trunk is one smooth tube swept up its leaning curve -
 * a flared foot, tapering as it climbs, ringed with the faint bands of old leaf scars (painted, not stepped), a crown
 * shaft where the fronds spring. Each frond's midrib arches out and droops; many narrow leaflets hang from it either
 * side in a V, each a tapering strip, darker at its base. Coconuts under the crown. near: full; far: fewer, plainer.
 * The fronds take the instance's colour (aTint).
 */
function palm(near) {
  const f = new FB(), r = rng(near ? 81 : 83), H = 7.2, lean = 1.1;
  // the trunk's line (x, y; it leans along +x) and its radius
  const C = t => [lean * t * t + 0.12 * Math.sin(t * 3.4), H * t], dC = t => [2 * lean * t + 0.408 * Math.cos(t * 3.4), H];
  const rad = t => 0.17 * (1 - 0.3 * t) + 0.14 * Math.exp(-t * 26) + 0.012 * Math.sin(t * H / 0.34 * TAU);
  const rows = near ? 48 : 14, sides = near ? 10 : 6, base = [];
  f.col('#8f7d62');
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, [cx, cy] = C(t), [tx, ty] = dC(t), tl = Math.hypot(tx, ty), vx = ty / tl, vy = -tx / tl, R = rad(t);
    // leaf-scar bands: a soft light-dark rhythm every ~0.34 m, fading out toward the foot
    const band = near ? 0.9 + 0.1 * Math.cos(t * H / 0.34 * TAU) * Math.min(1, t * 6) : 1, top = t > 0.93 ? 0.85 : 1;
    const row = [];
    for (let j = 0; j < sides; j++) {
      const th = j / sides * TAU, c = Math.cos(th), sn = Math.sin(th), nx = c * vx, ny = c * vy, nz = sn;
      row.push(f.vert(cx + nx * R, cy + ny * R - (i === 0 ? 0.3 : 0), nz * R, nx, ny, nz, band * top * (0.94 + 0.06 * c)));
    }
    base.push(row);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < sides; j++) { const j1 = (j + 1) % sides; f.tri(base[i][j], base[i][j1], base[i + 1][j]); f.tri(base[i][j1], base[i + 1][j1], base[i + 1][j]); }
  const [topX, topY] = C(1), top = [topX, topY, 0];
  // the crown shaft: a smooth swelling where the fronds spring, greener
  f.col('#6d6b3e'); f.sph(topX, topY + 0.05, 0, 0.24, 0.42, 0.24, near ? 10 : 6, near ? 6 : 4);
  const nF = near ? 11 : 6;
  for (let k = 0; k < nF; k++) {
    const a = k / nF * TAU + r() * 0.35, L = 3.3 + r() * 1.0, rise = 0.45 + r() * 0.45, droop = 1.7 + r() * 1.0, ca = Math.cos(a), sa = Math.sin(a), old = near && k % 5 === 4;
    const P = t => [top[0] + ca * L * t, top[1] + 0.25 + Math.sin(t * Math.PI * 0.55) * rise - t * t * droop * (old ? 1.6 : 1), top[2] + sa * L * t];
    const N = near ? 18 : 8;
    f.col(old ? '#8a7a3e' : '#7d8a3c', old ? 0 : 1);
    {   // the midrib: one thin three-sided tube along the frond, tapering to its tip
      const sx = -sa, sz = ca, ring = [];
      for (let q = 0; q <= N; q++) {
        const t = q / N, p = P(t), p2 = P(Math.min(1, t + 0.02)), p1 = P(Math.max(0, t - 0.02)), tx = p2[0] - p1[0], ty = p2[1] - p1[1], tz = p2[2] - p1[2], tl = Math.hypot(tx, ty, tz) || 1;
        const ux = (ty * sz) / tl, uy = (tz * sx - tx * sz) / tl, uz = (-ty * sx) / tl, rr = 0.045 * (1 - t * 0.8), row = [];
        for (let j = 0; j < 3; j++) { const th = j / 3 * TAU, c = Math.cos(th), sn = Math.sin(th), nx = sx * c + ux * sn, ny = uy * sn, nz = sz * c + uz * sn; row.push(f.vert(p[0] + nx * rr, p[1] + ny * rr, p[2] + nz * rr, nx, ny, nz)); }
        ring.push(row);
      }
      for (let q = 0; q < N; q++) for (let j = 0; j < 3; j++) { const j1 = (j + 1) % 3; f.tri(ring[q][j], ring[q][j1], ring[q + 1][j]); f.tri(ring[q][j1], ring[q + 1][j1], ring[q + 1][j]); }
    }
    f.col(old ? '#9a8a48' : '#4c862c', old ? 0 : 1);
    for (let q = 1; q < N; q++) {
      // leaflets either side, longest a third of the way out, hanging further toward the tip
      const t = q / N, p = P(t), p2 = P(Math.min(1, t + 0.5 / N)), dx = p2[0] - p[0], dy = p2[1] - p[1], dz = p2[2] - p[2], l = Math.hypot(dx, dy, dz) || 1, fx = dx / l, fy = dy / l, fz = dz / l;
      const len = (0.55 + 0.55 * Math.sin(Math.min(1, t * 1.4) * Math.PI)) * (1 - t * 0.3), hang = 0.45 + 0.35 * t, w = near ? 0.075 : 0.11;
      for (const side of [1, -1]) {
        const sx = -sa * side, sz = ca * side;   // out to the side, level
        // base on the midrib, a bend a little past half way, the tip: out, forward a little, and down
        const pt = (u, down) => [p[0] + sx * len * u + fx * len * 0.18 * u, p[1] - len * hang * down, p[2] + sz * len * u + fz * len * 0.18 * u];
        const b0 = [p[0] - fx * w, p[1] - fy * w, p[2] - fz * w], b1 = [p[0] + fx * w, p[1] + fy * w, p[2] + fz * w];
        const m = pt(0.55, 0.32), m0 = [m[0] - fx * w * 0.8, m[1] - fy * w * 0.8, m[2] - fz * w * 0.8], m1 = [m[0] + fx * w * 0.8, m[1] + fy * w * 0.8, m[2] + fz * w * 0.8], tip = pt(1, 1);
        for (const up of [1, -1]) {
          const v = (q3, sh) => f.vert(q3[0], q3[1], q3[2], sx * 0.25, up, sz * 0.25, sh);
          if (!near) { f.tri(v(b0, 0.85), v(b1, 0.85), v(tip, 1.05)); continue; }   // (far: one tapering blade)
          const i0 = v(b0, 0.82), i1 = v(b1, 0.82), i2 = v(m0, 0.97), i3 = v(m1, 0.97), i4 = v(tip, 1.08);
          f.tri(i0, i1, i3); f.tri(i0, i3, i2); f.tri(i2, i3, i4);
        }
      }
    }
  }
  if (near) { f.col('#6b5a2a'); for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + 0.4; f.sph(top[0] + Math.cos(a) * 0.24, top[1] - 0.22, top[2] + Math.sin(a) * 0.24, 0.13, 0.15, 0.13, 7, 5); } }
  return fromFB(f, 0);
}
/** Sea grass: long, soft ribbons swaying in the swell, darker at the root. */
function seagrass() {
  const pos = [], nrm = [], col = [], tint = [], r = rng(61), N = 9;
  for (let k = 0; k < N; k++) {
    const a = k / N * TAU + r() * 0.7, d = 0.03 + r() * 0.16, ox = Math.cos(a) * d, oz = Math.sin(a) * d, h = 0.5 + r() * 0.5, w = 0.035 + r() * 0.02, lean = 0.12 + r() * 0.2;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w, mx = ox + Math.cos(a) * lean * h * 0.4, mz = oz + Math.sin(a) * lean * h * 0.4, tx = ox + Math.cos(a) * lean * h, tz = oz + Math.sin(a) * lean * h;
    // two segments, so the ribbon bends
    const q = [[ox - px, 0, oz - pz], [ox + px, 0, oz + pz], [mx + px * 0.9, h * 0.5, mz + pz * 0.9], [mx - px * 0.9, h * 0.5, mz - pz * 0.9], [tx, h, tz]];
    const tri = (A, B, C, cA, cB, cC) => { pos.push(...A, ...B, ...C); for (let i = 0; i < 3; i++) { nrm.push(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3); tint.push(1); } col.push(...cA, ...cB, ...cC); };
    const lo = [0.55, 0.62, 0.45], midc = [0.85, 0.95, 0.75], hi = [1.05, 1.1, 0.85];
    tri(q[0], q[1], q[2], lo, lo, midc); tri(q[0], q[2], q[3], lo, midc, midc); tri(q[3], q[2], q[4], midc, midc, hi);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
  g.computeBoundingSphere();
  return g;
}
function lilies() {
  const pos = [], nrm = [], col = [], tint = [], r = rng(13);
  const v = (x, y, z, c, t) => { pos.push(x, y, z); nrm.push(0, 1, 0); col.push(...c); tint.push(t); };
  for (let k = 0; k < 5; k++) {
    const a = r() * TAU, d = r() * 0.9, x = Math.cos(a) * d, z = Math.sin(a) * d, R = 0.22 + r() * 0.2, notch = r() * TAU, N = 10, g = [0.26 + r() * 0.1, 0.45 + r() * 0.1, 0.2];
    for (let q = 0; q < N; q++) {
      const b0 = notch + 0.35 + q / N * (TAU - 0.5), b1 = notch + 0.35 + (q + 1) / N * (TAU - 0.5);
      v(x, 0, z, g, 0); v(x + Math.cos(b1) * R, 0, z + Math.sin(b1) * R, g, 0); v(x + Math.cos(b0) * R, 0, z + Math.sin(b0) * R, g, 0);
    }
    if (k < 2) {   // a flower: two rings of pointed petals round a gold heart
      const fx = x + 0.05, fz = z, petal = [1, 1, 1];
      for (let q = 0; q < 8; q++) {
        const b = q / 8 * TAU, w = 0.18, rr = q % 2 ? 0.1 : 0.13, h = q % 2 ? 0.1 : 0.06;
        v(fx + Math.cos(b - w) * 0.03, 0.02, fz + Math.sin(b - w) * 0.03, petal, 1); v(fx + Math.cos(b + w) * 0.03, 0.02, fz + Math.sin(b + w) * 0.03, petal, 1); v(fx + Math.cos(b) * rr, h, fz + Math.sin(b) * rr, petal, 1);
      }
      v(fx - 0.03, 0.05, fz, [0.95, 0.75, 0.15], 0); v(fx + 0.03, 0.05, fz, [0.95, 0.75, 0.15], 0); v(fx, 0.05, fz + 0.03, [0.95, 0.75, 0.15], 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
  g.computeBoundingSphere();
  return g;
}

/** A tree seen from far off (hundreds of metres): one rounded crown on a short trunk, the same size and colour. */
// (lighter than before, 2026-10-04: forests now carry on past a kilometre, thinned, and each crown is a few pixels there)
function distantTree(kind) {
  const f = new FB();
  f.col('#5e4330'); f.lathe(0, 0, [[0.25, 0], [0.12, 3.2]], 3);
  if (kind === 'conifer') { f.col('#356b33', 1); f.lathe(0, 0, [[2.1, 1.4], [0, 9.2]], 6); }
  else if (kind === 'birch') { f.col('#86b04f', 1); f.sph(0, 5.6, 0, 1.6, 2.3, 1.6, 6, 4, { shade: leafShade }); }
  else if (kind === 'tree2') { f.col('#5a8f3a', 1); f.sph(0, 5.6, 0, 2.0, 2.9, 2.0, 6, 4, { shade: leafShade }); }
  else { f.col('#4f8a34', 1); f.sph(0, 4.4, 0, 2.9, 2.2, 2.9, 6, 4, { shade: leafShade }); }
  return fromFB(f, 1);
}

/**
 * The scatter's models: { kind: { near, far } } - `far` only where a simpler version exists. Kinds: tree, tree2, birch,
 * conifer, bush, rock, grass, flower.
 */
export function natureModels() {
  return {
    tree: { near: broadleaf(false, true), far: broadleaf(false, false), distant: distantTree('tree') },
    tree2: { near: broadleaf(true, true), far: broadleaf(true, false), distant: distantTree('tree2') },
    birch: { near: birch(true), far: birch(false), distant: distantTree('birch') },
    conifer: { near: conifer(true), far: conifer(false), distant: distantTree('conifer') },
    bush: { near: bush() },
    rock: { near: rock() },
    boulder: { near: boulder() },
    pebbles: { near: pebbles() },
    grass: { near: grassTuft() },
    flower: { near: flowerClump() },
    reed: { near: reeds() },
    lily: { near: lilies() },
    coral: { near: coral() },
    palm: { near: palm(true), far: palm(false) },
    coralBranch: { near: coralBranch() }, coralBrain: { near: coralBrain() }, coralTable: { near: coralTable() }, coralFan: { near: coralFan() }, coralTube: { near: coralTube() },
    seagrass: { near: seagrass() },
  };
}
