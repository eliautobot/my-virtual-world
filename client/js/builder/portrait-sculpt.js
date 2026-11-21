// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as THREE from "three";

const clamp = (x) => Math.max(0, Math.min(1, x));
const mix = (x, y, t) => x + (y - x) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const bell = (x) => Math.exp(-x * x);
const models = new WeakMap();

// Join duplicated UV/part vertices only for the shading calculation. The
// underlying mesh remains untouched. Angle weighting avoids broad chin fans
// overpowering the shorter cheek triangles in the source triangulation.
function shadePortrait(g) {
  const p = g.attributes.position,
    n = g.attributes.normal,
    indices = g.index.array,
    keys = [],
    buckets = new Map(),
    nodes = [];
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i),
      key = [v.x, v.y, v.z].map((x) => Math.round(x * 1e5)).join(":");
    let k = buckets.get(key);
    if (k === undefined) {
      k = nodes.length;
      buckets.set(key, k);
      nodes.push({ v, n: new THREE.Vector3(), neighbors: new Set() });
    }
    keys[i] = k;
  }
  const ab = new THREE.Vector3(),
    ac = new THREE.Vector3(),
    fn = new THREE.Vector3();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = [0, 1, 2].map((j) => keys[indices[i + j]]);
    for (let j = 0; j < 3; j++) {
      const k = tri[j],
        l = tri[(j + 1) % 3],
        r = tri[(j + 2) % 3],
        v = nodes[k];
      if (k === l || k === r || l === r) continue;
      ab.subVectors(nodes[l].v, v.v);
      ac.subVectors(nodes[r].v, v.v);
      fn.crossVectors(ab, ac).normalize();
      v.n.addScaledVector(fn, ab.angleTo(ac));
      v.neighbors.add(l).add(r);
    }
  }
  for (const v of nodes) v.n.normalize();
  const avg = nodes.map((v) => {
    const a = v.n.clone().multiplyScalar(2.5);
    for (const k of v.neighbors) {
      const d = nodes[k];
      a.addScaledVector(d.n, clamp((d.n.dot(v.n) - 0.12) / 0.75));
    }
    return a.normalize();
  });
  for (let i = 0; i < p.count; i++) {
    const v = nodes[keys[i]],
      blend = smooth(0.836, 0.86, v.v.y) * smooth(-0.04, -0.006, v.v.z);
    if (blend === 0) continue;
    ab.fromBufferAttribute(n, i).lerp(avg[keys[i]], blend).normalize();
    n.setXYZ(i, ab.x, ab.y, ab.z);
  }
}

// Preserve source topology and bone weights. Only the facial envelope changes.
// In particular the neck border, scalp and back of the head remain in place.
export function portraitSurface(rest, female, ears, enabled) {
  if (!enabled && ears < 0) return { geometry: rest, offsets: null };
  let entries = models.get(rest);
  if (!entries) models.set(rest, (entries = new Map()));
  const key = (enabled ? "portrait-" : "base-") + ears;
  if (entries.has(key)) return entries.get(key);
  const g = rest.clone(),
    p = g.attributes.position,
    offsets = new Float32Array(p.count * 3);
  const origN = g.attributes.normal.clone();
  g.computeVertexNormals();
  const baseN = g.attributes.normal.clone();
  const cy = female ? 0.905 : 0.919;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i),
      abs = Math.abs(x),
      sign = Math.sign(x);
    const face =
      smooth(0.002, 0.05, z) *
      smooth(0.828, 0.85, y) *
      (1 - smooth(0.913, 0.935, y));
    let dx = 0,
      dy = 0,
      dz = 0;
    if (enabled) {
      // A squarer mandibular curve for the male and softer cheek pads for the female.
      const cheek =
        bell((abs - 0.029) / 0.02) *
        bell((y - (female ? 0.888 : 0.898)) / 0.018);
      dx =
        sign *
        face *
        (female
          ? 0.0022 * cheek
          : 0.0066 * smooth(0.009, 0.031, abs) * bell((y - 0.863) / 0.022));
      dz =
        face *
        ((female ? 0.0037 : 0.0027) * cheek +
          (female ? 0.0009 : 0.0029) *
            bell(x / (female ? 0.013 : 0.023)) *
            bell((y - (female ? 0.847 : 0.85)) / 0.013));
      dy =
        face *
        (female ? -0.001 : 0.0006) *
        bell(x / 0.018) *
        bell((y - 0.851) / 0.021);
    }
    if (ears >= 0) {
      // Compress the lateral projection into the skull, rather than scaling the entire head.
      const k =
        smooth(0.042, 0.059, abs) *
        (1 - smooth(0.018, 0.04, z)) *
        (1 - smooth(0.022, 0.04, Math.abs(y - cy)));
      const top = smooth(cy - 0.004, cy + 0.019, y),
        lobe = 1 - smooth(cy - 0.02, cy + 0.003, y);
      dx +=
        sign *
        k *
        ((female ? -0.0102 : -0.0088) +
          (ears === 1 ? 0.0008 * top : ears === 2 ? 0.0022 * lobe : 0));
      dy +=
        k *
          ((female ? -0.003 : -0.006) +
            (ears === 1 ? 0.0046 * top : ears === 2 ? -0.0034 * lobe : 0)) -
        (y - cy) * 0.1 * k;
      dz += k * (ears === 2 ? 0.003 : ears === 1 ? 0.0004 : 0.002);
    }
    p.setXYZ(i, x + dx, y + dy, z + dz);
    offsets.set([dx, dy, dz], 3 * i);
  }
  g.computeVertexNormals();
  const na = g.attributes.normal,
    a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    o = new THREE.Vector3(),
    q = new THREE.Quaternion();
  for (let i = 0; i < p.count; i++) {
    a.fromBufferAttribute(baseN, i);
    b.fromBufferAttribute(na, i);
    o.fromBufferAttribute(origN, i);
    if (a.lengthSq() > 0.9 && b.lengthSq() > 0.9)
      o.applyQuaternion(q.setFromUnitVectors(a, b)).normalize();
    na.setXYZ(i, o.x, o.y, o.z);
  }
  if (enabled) shadePortrait(g);
  const result = { geometry: g, offsets };
  entries.set(key, result);
  return result;
}

// Small hue glazes use the source triangles themselves, so the ear coloration
// stays registered through a head turn with the exact same four bone weights.
export function tintEars(rest, portrait, female, skin, earColor, mat, add) {
  const p = rest.attributes.position,
    fit = portrait.attributes.position,
    fitN = portrait.attributes.normal;
  const js = rest.attributes.skinIndex,
    ws = rest.attributes.skinWeight,
    idx = rest.index.array;
  const points = [],
    normals = [],
    colors = [],
    joints = [],
    weights = [],
    faces = [],
    cy = female ? 0.905 : 0.919;
  const warm = earColor.clone().multiply(new THREE.Color("#e0a292"));
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i],
      b = idx[i + 1],
      c = idx[i + 2];
    if (
      ![a, b, c].every(
        (j) =>
          Math.abs(p.getX(j)) > 0.045 &&
          Math.abs(p.getY(j) - cy) < 0.037 &&
          p.getZ(j) < 0.032,
      )
    )
      continue;
    for (const j of [a, b, c]) {
      const x = p.getX(j),
        y = p.getY(j),
        z = p.getZ(j),
        ax = Math.abs(x);
      const amt = smooth(0.047, 0.059, ax),
        bowl =
          bell((ax - 0.056) / 0.0059) *
          bell((y - cy) / 0.0095) *
          smooth(-0.03, -0.008, z);
      const col = skin
        .clone()
        .lerp(earColor, amt)
        .lerp(warm, amt * (0.065 + 0.58 * bowl));
      const nx = fitN.getX(j),
        ny = fitN.getY(j),
        nz = fitN.getZ(j);
      points.push(
        fit.getX(j) + nx * 0.000125,
        fit.getY(j) + ny * 0.000125,
        fit.getZ(j) + nz * 0.000125,
      );
      colors.push(col.r, col.g, col.b);
      normals.push(nx, ny, nz);
      for (let k = 0; k < 4; k++) {
        joints.push(js.getComponent(j, k));
        weights.push(ws.getComponent(j, k));
      }
      faces.push(faces.length);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(faces);
  for (const [key, av] of [
    ["position", points],
    ["normal", normals],
    ["color", colors],
  ])
    g.setAttribute(key, new THREE.Float32BufferAttribute(av, 3));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(joints, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  add("Ear shell · warm concha", g, mat("white", true), "ear");
}

function hermite(knots, u, dim) {
  let i = 0;
  while (i < knots.length - 2 && u > knots[i + 1][0]) i++;
  const a = knots[i],
    b = knots[i + 1],
    l = knots[Math.max(0, i - 1)],
    r = knots[Math.min(knots.length - 1, i + 2)];
  const step = b[0] - a[0],
    t = clamp((u - a[0]) / step),
    t2 = t * t,
    t3 = t2 * t;
  const da = (b[dim] - l[dim]) / (b[0] - l[0]),
    db = (r[dim] - a[dim]) / (r[0] - a[0]);
  return (
    (2 * t3 - 3 * t2 + 1) * a[dim] +
    (t3 - 2 * t2 + t) * step * da +
    (-2 * t3 + 3 * t2) * b[dim] +
    (t3 - t2) * step * db
  );
}

// A narrow bridge opens into a soft triangular tip. Its lower plane turns back
// under the tip. No separate nostril discs or pasted-on dark outlines.
export function sculptNose({
  style,
  female,
  noseY,
  depth,
  skin,
  tint,
  meshGrid,
  mat,
  add,
}) {
  const widths = female ? [0.0106, 0.0095, 0.0121] : [0.0116, 0.013, 0.0106],
    heights = female ? [0.033, 0.038, 0.028] : [0.037, 0.032, 0.042],
    lifts = female ? [0.0086, 0.0104, 0.0084] : [0.0103, 0.0097, 0.0116];
  const w = widths[style],
    h = heights[style],
    amp = lifts[style];
  const knots = [
    [-0.26, 0.68, 0],
    [-0.19, 0.74, 0.04],
    [-0.115, 0.84, 0.3],
    [-0.042, 1.0, 0.86],
    [0.036, 0.97, 0.99],
    [0.12, 0.83, 0.84],
    [0.37, 0.64, style === 2 && !female ? 0.77 : 0.66],
    [0.67, 0.54, 0.42],
    [0.88, 0.57, 0.14],
    [1.02, 0.62, 0],
  ];
  function lift(x, y) {
    // Curve both tip and nostril planes around the apex; the broad transition
    // onto the cheeks has zero slope where it leaves the source.
    const xx = x / w,
      k = (y - noseY) / h - 0.055 * Math.min(1.1, xx * xx),
      d = Math.abs(xx) / Math.max(0.12, hermite(knots, k, 1));
    if (k < -0.26 || k > 1.02 || d >= 1.42) return 0;
    const arch = (1 - smooth(0, 1.42, d)) ** 1.48;
    return Math.max(0, hermite(knots, k, 2)) * amp * arch;
  }
  const g = meshGrid(72, 80, (u, v) => {
    const x = (u * 2 - 1) * w * 1.53,
      y = noseY + h * mix(-0.275, 1.085, v),
      z = lift(x, y);
    const k = clamp(z / (amp * 0.35)),
      warm = 0.085 * bell((y - noseY + h * 0.1) / (h * 0.12)) * k;
    const c = skin
      .clone()
      .lerp(tint, k)
      .lerp(tint.clone().multiply(new THREE.Color("#d8ac93")), warm);
    return [x, y, depth(x, y) + z - 0.000075, c];
  });
  const pa = g.attributes.position,
    n = new THREE.Vector3(),
    e = 0.0001;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i),
      y = pa.getY(i);
    depth(x, y, n);
    const dx = (lift(x + e, y) - lift(x - e, y)) / (2 * e),
      dy = (lift(x, y + e) - lift(x, y - e)) / (2 * e);
    n.set(n.x - dx * n.z, n.y - dy * n.z, n.z).normalize();
    g.attributes.normal.setXYZ(i, n.x, n.y, n.z);
  }
  add(
    "Sculpted bridge and turning tip",
    g,
    mat("white", true, { roughness: 0.78 }),
  );
}

export function sculptSmile({
  style,
  female,
  mouthY,
  depth,
  skin,
  lip,
  meshGrid,
  mat,
  add,
}) {
  const w = (female ? [0.0165, 0.0176, 0.0157] : [0.0176, 0.0169, 0.0172])[
    style
  ];
  const up = (female ? [0.00205, 0.0025, 0.0033] : [0.00155, 0.0026, 0.00285])[
      style
    ],
    lo = (female ? [0.00325, 0.003, 0.00435] : [0.00245, 0.00295, 0.00385])[
      style
    ];
  const smile = (female ? [0.002, 0.0033, 0.0011] : [0.0021, 0.0032, 0.0012])[
      style
    ],
    plump = [0.00145, 0.00155, 0.0021][style];
  function seam(u) {
    return mouthY + smile * Math.pow(Math.abs(u), 2.9) - 0.0002 * (1 - u * u);
  }
  const pigment = skin.clone().lerp(lip, female ? 0.6 : 0.38);
  function surface(x, y) {
    const u = x / w,
      arch = Math.max(0, 1 - u * u),
      delta = y - seam(u),
      upper = delta > 0;
    const cupid =
      1 +
      (style === 1 ? 0.42 : style === 2 ? 0.28 : 0.09) *
        bell((Math.abs(u) - 0.28) * 5.1);
    const ht = (upper ? up * cupid : lo * 1.30) * Math.pow(arch, upper ? 0.7 : 0.86);
    const v = Math.abs(delta) / Math.max(0.00001, ht);
    if (arch === 0 || v >= 1) return { z: 0, v: 1, upper };
    const base = plump * (upper ? 0.69 : 1) * Math.pow(arch, 0.72);
    const z = base * (0.52 * (1 - v) + .72 * Math.sin(Math.PI * v) ** 1.28);
    return { z, v, upper };
  }
  // One continuous soft surface for the lips plus the warm, tapered opening.
  // Feather the vermilion border back to skin instead of a lipstick sticker.
  const g = meshGrid(80, 36, (t, k) => {
    const u = 2 * t - 1,
      x = u * w,
      arch = Math.max(0, 1 - u * u),
      v = k * 2 - 1;
    const lobe =
      1 +
      (style === 1 ? 0.42 : style === 2 ? 0.28 : 0.09) *
        bell((Math.abs(u) - 0.28) * 5.1);
    const y =
      seam(u) +
      (v > 0 ? up * lobe * Math.pow(arch, 0.7) : lo * 1.30 * Math.pow(arch, 0.86)) * v;
    const f = surface(x, y),
      edge = 1 - smooth(0.45, 1, f.v);
    const q = skin
      .clone()
      .lerp(pigment, edge * (f.upper ? 0.86 : 1) * smooth(0, 0.15, arch));
    return [
      x,
      y,
      depth(x, y) + f.z + 0.000055 - 0.00014 * smooth(0.8, 1, f.v),
      q,
    ];
  });
  const n = new THREE.Vector3(),
    e = 0.00012,
    p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i);
    depth(x, y, n);
    const dx = (surface(x + e, y).z - surface(x - e, y).z) / (e * 2),
      dy = (surface(x, y + e).z - surface(x, y - e).z) / (e * 2);
    n.set(n.x - n.z * dx * 0.39, n.y - n.z * dy * 0.39, n.z).normalize();
    g.attributes.normal.setXYZ(i, n.x, n.y, n.z);
  }
  add("Soft lip planes", g, mat("white", true, { roughness: 0.65 }));
  const seamColor = skin
    .clone()
    .lerp(lip, 0.62)
    .multiply(new THREE.Color(female ? "#d4a88f" : "#c7a58b"));
  const gg = meshGrid(76, 6, (s, t) => {
    const u = s * 2 - 1,
      x = w * u,
      arch = Math.max(0, 1 - u * u),
      vv = t * 2 - 1;
    const thickness = (female ? 0.00055 : 0.00048) * Math.pow(arch, 0.47),
      y = seam(u) + thickness * vv,
      f = surface(x, y);
    const ink = seamColor
      .clone()
      .lerp(pigment, 0.56 * smooth(0.24, 1, Math.abs(vv)));
    return [
      x,
      y,
      depth(x, y) + f.z + 0.00016 + 0.00016 * (1 - vv * vv) * arch,
      ink,
    ];
  });
  const gn = gg.attributes.normal,
    gp = gg.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    depth(gp.getX(i), gp.getY(i), n);
    gn.setXYZ(i, n.x, n.y, n.z);
  }
  add("Smile aperture", gg, mat("white", true, { roughness: 0.82 }));
}
