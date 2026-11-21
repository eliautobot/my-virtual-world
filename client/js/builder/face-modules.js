// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { sculptLips } from "./lip-sculpt.js";
import * as T from "three";
import { sculptNose } from "./nose-sculpt.js";

// Build the skin and the removable inserts in the same bind coordinate space.
const landmark = {
  female: { nose: 0.8835, lip: 0.8635, eye: 0.9037 },
  male: { nose: 0.8977, lip: 0.8791, eye: 0.9219 },
};
const neutralCache = new WeakMap(),
  rayCache = new WeakMap();
const mix = T.MathUtils.lerp,
  clip = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => {
  const t = clip((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const exp = (x) => Math.exp(-x * x);
function ray(g) {
  if (!g) return () => -0.12;
  if (rayCache.has(g)) return rayCache.get(g);
  const p = g.attributes.position.array,
    f = g.index.array,
    bins = new Map(),
    key = (a, b) => a + 128 * b;
  const tile = 0.006;
  for (let i = 0; i < f.length; i += 3) {
    const a = f[i] * 3,
      b = f[i + 1] * 3,
      c = f[i + 2] * 3;
    if (Math.max(p[a + 2], p[b + 2], p[c + 2]) < 0.025) continue;
    for (
      let x = Math.floor(Math.min(p[a], p[b], p[c]) / tile);
      x <= Math.floor(Math.max(p[a], p[b], p[c]) / tile);
      x++
    )
      for (
        let y = Math.floor(Math.min(p[a + 1], p[b + 1], p[c + 1]) / tile);
        y <= Math.floor(Math.max(p[a + 1], p[b + 1], p[c + 1]) / tile);
        y++
      ) {
        const k = key(x, y);
        if (!bins.has(k)) bins.set(k, []);
        bins.get(k).push(i);
      }
  }
  function sample(x, y) {
    let z = -0.12;
    for (const i of bins.get(key(Math.floor(x / tile), Math.floor(y / tile))) ||
      []) {
      const a = f[i] * 3,
        b = f[i + 1] * 3,
        c = f[i + 2] * 3,
        dx = p[b] - p[a],
        dy = p[b + 1] - p[a + 1],
        ex = p[c] - p[a],
        ey = p[c + 1] - p[a + 1],
        den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const u = ((x - p[a]) * ey - (y - p[a + 1]) * ex) / den,
        v = (dx * (y - p[a + 1]) - dy * (x - p[a])) / den;
      if (u >= -0.000001 && v >= -0.000001 && u + v <= 1.000001)
        z = Math.max(
          z,
          p[a + 2] + u * (p[b + 2] - p[a + 2]) + v * (p[c + 2] - p[a + 2]),
        );
    }
    return z;
  }
  rayCache.set(g, sample);
  return sample;
}

// Garment and head proportions can change a live insert after it is bound.
// Keep a rest-space depth field for complexion marks on the selected nose.
export function insertDepth(geometry) {
  return ray({
    index: geometry.index,
    attributes: { position: geometry.attributes.position.clone() },
  });
}

// Carry the front plane of each cheek inward to the nasal wing. Its crest
// rises toward the outer eye, with a gradual return into the lower cheek.
// The removable nose and the eyelid rims both sample this finished surface.
function innerCheekSupport(x, y, lm, female) {
  const across = Math.abs(x);
  const span = smooth(0.002, 0.023, across) * (1 - smooth(0.018, 0.045, across));
  const crest = lm.nose + 0.0045 * smooth(0.012, 0.039, across);
  const fromLip = smooth(lm.lip + 0.001, crest, y);
  const belowLid = 1 - smooth(crest, lm.eye - 0.008, y);
  return (female ? 0.0036 : 0.0032) * span * fromLip * belowLid;
}

// Fair the skin after the baked nose and lips have been lifted out. The polar
// grid continues around the jaw, so the sides of the mouth have no patch edge.
function fairMidface(g, lm, female) {
  const p = g.attributes.position, columns = g.userData.ringSegments;
  const rows = (g.userData.seamStart - 1) / columns;
  if (!Number.isInteger(rows)) return;
  const horizontal = new Float32Array(rows * columns);
  const adjusted = new Uint8Array(horizontal.length);
  const angular = [], vertical = [];
  for (let k = -10; k <= 10; k++) angular.push(exp(k / 5.5));
  for (let k = -15; k <= 15; k++) vertical.push(exp(k / 7.8));
  const divisor = angular.reduce((a, b) => a + b) * vertical.reduce((a, b) => a + b);
  const ring = (row, col) => row * columns + (col + columns) % columns;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const k = ring(j, i);
      for (let a = -10; a <= 10; a++)
        horizontal[k] += angular[a + 10] * p.getZ(ring(j, i + a));
    }
  }
  const normals = g.attributes.normal.clone();
  g.computeVertexNormals();
  const originalSurfaceNormals = g.attributes.normal.clone();
  for (let j = 15; j < rows - 15; j++) {
    for (let i = 0; i < columns; i++) {
      const k = ring(j, i);
      const x = p.getX(k), height = p.getY(k), z = p.getZ(k);
      const y = height - lm.lip, front = smooth(0.010, 0.037, z);
      const w = smooth(-0.013, 0.001, y) * (1 - smooth(0.018, 0.033, y)) * front;
      const cheek = innerCheekSupport(x, height, lm, female) * front;
      if (!w && !cheek) continue;
      let sum = 0;
      for (let b = -15; b <= 15; b++) sum += vertical[b + 15] * horizontal[ring(j + b, i)];
      const support = (female ? 0.0037 : 0.0012) * exp(x / 0.017) * exp((y - 0.010) / 0.012);
      const lateral = 0.0017 * exp((Math.abs(x) - 0.022) / 0.014) * exp((y - 0.010) / 0.014);
      p.setZ(k, z + w * (0.93 * (sum / divisor - z) + support - lateral) + cheek);
      adjusted[k] = 1;
    }
  }
  g.computeVertexNormals();
  const newN = g.attributes.normal, a = new T.Vector3(), b = new T.Vector3(),
    previous = new T.Vector3(), rotation = new T.Quaternion();
  for (let i = 0; i < p.count; i++) {
    a.fromBufferAttribute(normals, i);
    if (adjusted[i]) {
      b.fromBufferAttribute(newN, i);
      previous.fromBufferAttribute(originalSurfaceNormals, i);
      a.applyQuaternion(rotation.setFromUnitVectors(previous, b)).normalize();
      // The donor normals record a short fold below each cheek crest.
      // Shade the continuous inner cheek from its actual surface tangent.
      const x = Math.abs(p.getX(i)), y = p.getY(i);
      const follow = smooth(0.011, 0.021, x) * (1 - smooth(0.032, 0.045, x)) *
        smooth(lm.lip + 0.004, lm.lip + 0.013, y) *
        (1 - smooth(lm.nose + 0.003, lm.eye - 0.008, y)) * smooth(0.023, 0.045, p.getZ(i));
      a.lerp(b, follow).normalize();
    }
    newN.setXYZ(i, a.x, a.y, a.z);
  }
}

export function neutralizeFront(geometry, gender) {
  if (neutralCache.has(geometry)) return neutralCache.get(geometry);
  const lm = landmark[gender],
    g = geometry.clone(),
    src = ray(geometry),
    a = g.attributes.position;
  // A cubic Bézier meridian between the original chin and forehead establishes
  // a featureless midface. Sampling the eye sockets for that meridian would
  // leave two horizontal ridges where the removable bridge meets the forehead.
  const sourceAO = geometry.userData.ao;
  g.userData.ao = sourceAO
    ? Uint8Array.from(sourceAO)
    : new Uint8Array(a.count).fill(255);
  const noseHalf = 0.02,
    lo = lm.lip - 0.013,
    hi = lm.eye + 0.012;
  const start = src(0, lo),
    end = src(0, hi),
    d0 = (src(0, lo) - src(0, lo - 0.002)) / 0.002,
    d1 = (src(0, hi + 0.002) - end) / 0.002;
  function bed(x, y) {
    const samples = [
      [-0.0033, 0.22],
      [0, 0.56],
      [0.0033, 0.22],
    ];
    let l = 0,
      r = 0;
    for (const [d, w] of samples) {
      // The jaw is narrower below the lower lip. Keep the cheek anchors on
      // the skin while fading smoothly into the unmodified chin.
      const yy = Math.max(lm.lip - 0.01, y + d);
      l += w * src(-noseHalf, yy);
      r += w * src(noseHalf, yy);
    }
    const t = clip((y - lo) / (hi - lo)),
      s = 1 - t,
      dt = (hi - lo) / 3;
    const center =
      s * s * s * start +
      3 * s * s * t * (start + clip(d0, -0.1, 0.3) * dt) +
      3 * s * t * t * (end - clip(d1, -0.1, 0.26) * dt) +
      t * t * t * end;
    const u = clip(x / noseHalf, -1.5, 1.5);
    const oralY = y - lm.lip;
    // The upper jaw supports the mouth between the cheeks. The oral mound
    // and philtrum belong to the skin so each lip can sit close to its bed.
    const oralPlane =
      (gender === "female" ? 0.0039 : 0.0043) *
      exp(x / 0.02) *
      exp((oralY - 0.002) / 0.016);
    const philtrum =
      0.00064 *
      exp((Math.abs(x) - 0.0041) / 0.0028) *
      exp((oralY - 0.009) / 0.006);
    return (
      center +
      (0.5 * (r + l) - center) * u * u +
      0.5 * (r - l) * u +
      oralPlane +
      philtrum
    );
  }
  function neutral(x, y, z, maskOut = false) {
    const abs = Math.abs(x),
      mid = 1 - smooth(lm.nose - 0.008, lm.nose + 0.004, y);
    const nz = smooth(0.029, 0.052, z) *
      smooth(lm.lip - 0.014, lm.lip - 0.006, y) *
      (1 - smooth(lm.eye + 0.001, lm.eye + 0.012, y)) *
      (1 - smooth(0.012 + 0.009 * mid, 0.021 + 0.009 * mid, abs));
    if (maskOut) return nz;
    return nz > 0.0001 ? mix(z, bed(x, y), nz) : z;
  }
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i),
      y = a.getY(i),
      z = a.getZ(i),
      w = neutral(x, y, z, true);
    if (w <= 0.00001) continue;
    const result = neutral(x, y, z);
    a.setZ(i, result);
    g.userData.ao[i] = Math.round(mix(g.userData.ao[i], 252, w));
  }
  const depth = ray(g),
    pos = g.attributes.position,
    nor = g.attributes.normal,
    e = 0.00035;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i),
      w = neutral(x, y, z, true);
    if (w <= 0) continue;
    const dx = (depth(x + e, y) - depth(x - e, y)) / (2 * e),
      dy = (depth(x, y + e) - depth(x, y - e)) / (2 * e);
    if (!Number.isFinite(dx + dy) || Math.abs(dx) + Math.abs(dy) > 9) continue;
    const n = new T.Vector3(-dx, -dy, 1).normalize();
    const orig = new T.Vector3()
      .fromBufferAttribute(nor, i)
      .lerp(n, w)
      .normalize();
    nor.setXYZ(i, orig.x, orig.y, orig.z);
  }
  fairMidface(g, lm, gender === "female");
  rayCache.delete(g);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  neutralCache.set(geometry, g);
  return g;
}
function generated(tag, slot, g, m, add) {
  const obj = add(tag, g, m);
  if (obj) {
    obj.userData.feature = slot;
    obj.userData.slot = slot;
  }
  return obj;
}
export function addFaceModules({
  female,
  selections,
  colors,
  skin,
  depth,
  meshGrid,
  mat,
  add,
  adjustments = {},
}) {
  const gender = female ? "female" : "male",
    lm = landmark[gender],
    nose = selections.nose ?? 0,
    mouth = selections.mouth ?? 0;
  if (nose >= 0) {
    sculptNose({
      gender,
      style: nose,
      origin: lm.nose,
      skin,
      dye: colors.nose,
      fit: adjustments.nose,
      depth,
      meshGrid,
      mat,
      add: (name, geometry, material) =>
        generated(name, "nose", geometry, material, add),
    });
  }
  if (mouth >= 0) {
    return sculptLips({
      gender,
      style: mouth,
      origin: lm.lip,
      fit: adjustments.mouth,
      skin,
      dye: colors.mouth || (female ? "#d98772" : "#bd8363"),
      depth,
      meshGrid,
      mat,
      add: (name, g, m) => generated(name, "mouth", g, m, add),
    });
  }
}
