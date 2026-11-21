// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as THREE from "three";

// Place the hairs on the actual sculpt, including surfaces hidden from a
// frontal ray under the jaw. Every strand follows its follicle's joint mix.
export function jawStubble(surface, mouthY, dye, cut = "", skin) {
  const { position, normal, skinWeight, skinIndex } = surface.attributes;
  const faces = surface.index.array;
  const xyz = [],
    rgb = [],
    triangles = [],
    joints = [],
    weights = [];
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const ab = new THREE.Vector3(),
    ac = new THREE.Vector3();
  const origin = new THREE.Vector3(),
    outward = new THREE.Vector3(),
    temp = new THREE.Vector3();
  const growth = new THREE.Vector3(),
    side = new THREE.Vector3(),
    cross = new THREE.Vector3();
  const color = new THREE.Color();
  let seed = 749531;
  function random() {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const smooth = (lo, hi, value) => THREE.MathUtils.smoothstep(value, lo, hi);
  function beardDensity({ x, y, z }) {
    const angle = Math.atan2(Math.abs(x), z - 0.002);
    const outer = smooth(0.2, 1.38, angle);
    const cheek = mouthY - 0.0055 + 0.044 * outer ** 1.65;
    const jaw = mouthY - 0.033 + 0.023 * outer ** 1.35;
    const lip = Math.exp(
      -((x / 0.01) ** 2 + ((y - mouthY + 0.006) / 0.0038) ** 2),
    );
    let mask = 1;
    if (cut === "Chin patch")
      mask =
        (1 - smooth(0.005, 0.013, Math.abs(x))) *
        smooth(jaw + 0.002, jaw + 0.012, y);
    if (cut === "Chin strap") mask = 1 - smooth(jaw + 0.008, jaw + 0.016, y);
    if (cut === "Sideburns")
      mask =
        smooth(0.91, 1.16, angle) * smooth(mouthY - 0.002, mouthY + 0.008, y);
    return (
      mask *
      ((1 - smooth(cheek - 0.006, cheek + 0.001, y)) *
        smooth(jaw - 0.002, jaw + 0.003, y) *
        (1 - smooth(1.23, 1.62, angle)) *
        smooth(0.01, 0.03, z + Math.abs(x) * 0.58) *
        (1 - 0.93 * lip))
    );
  }
  // A barycentric sample inherits interpolated attachment weights for the
  // entire strand. This keeps its tapered tip stable when the head turns.
  function addHair(ids, bary) {
    outward.set(0, 0, 0);
    const influences = new Map();
    for (let i = 0; i < 3; i++) {
      const id = ids[i],
        fraction = bary[i];
      outward.addScaledVector(temp.fromBufferAttribute(normal, id), fraction);
      for (let j = 0; j < 4; j++) {
        const joint = skinIndex.getComponent(id, j);
        const weight = fraction * skinWeight.getComponent(id, j);
        if (weight)
          influences.set(joint, (influences.get(joint) ?? 0) + weight);
      }
    }
    outward.normalize();
    // The underside is foreshortened in portrait views; taper coverage here
    // and keep the longest, most visible bristles along the bony jawline.
    const underside = smooth(0.3, 0.86, -outward.y);
    if (random() < 0.5 * underside) return;
    const ranked = [...influences].sort((l, r) => r[1] - l[1]).slice(0, 4);
    const sum = ranked.reduce((total, item) => total + item[1], 0);
    const joint = Array(4).fill(0),
      weight = Array(4).fill(0);
    ranked.forEach(([bone, w], i) => {
      joint[i] = bone;
      weight[i] = w / sum;
    });

    // Grain descends and fans out on the chin, then angles back and down
    // beneath the jaw. A small random swivel keeps the fields organic.
    growth.set(
      origin.x * 6 + (random() - 0.5) * 0.32,
      -1,
      -0.28 - 0.32 * random(),
    );
    growth.addScaledVector(outward, -growth.dot(outward)).normalize();
    growth
      .multiplyScalar(0.7 + 0.32 * random())
      .addScaledVector(outward, 0.35 + 0.34 * random())
      .normalize();
    side.crossVectors(growth, outward).normalize();
    cross.crossVectors(growth, side).normalize();
    const length =
        (0.00074 + 0.00085 * random()) *
        (1 - 0.21 * underside) *
        (cut ? 1.42 : 1),
      radius = (0.00013 + 0.00009 * random()) * (cut ? 1.42 : 1);
    const phase = (random() * Math.PI * 2) / 3,
      brightness = 0.86 + 0.52 * random();
    const offset = xyz.length / 3;
    function vertex(p, value) {
      xyz.push(p.x, p.y, p.z);
      color.copy(dye).multiplyScalar(value * brightness);
      rgb.push(color.r, color.g, color.b);
      joints.push(...joint);
      weights.push(...weight);
    }
    for (let ring = 0; ring < 2; ring++) {
      for (let i = 0; i < 3; i++) {
        const theta = phase + (i * Math.PI * 2) / 3,
          width = radius * (ring ? 0.81 : 1);
        temp
          .copy(origin)
          .addScaledVector(outward, -0.0001)
          .addScaledVector(growth, length * (ring ? 0.39 : 0))
          .addScaledVector(side, Math.cos(theta) * width)
          .addScaledVector(cross, Math.sin(theta) * width);
        vertex(temp, ring ? 0.94 : 0.82);
      }
    }
    vertex(
      temp
        .copy(origin)
        .addScaledVector(outward, -0.0001)
        .addScaledVector(growth, length),
      1.09,
    );
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3,
        ri = offset + i,
        rj = offset + j;
      triangles.push(
        ri,
        rj,
        rj + 3,
        ri,
        rj + 3,
        ri + 3,
        ri + 3,
        rj + 3,
        offset + 6,
      );
    }
  }

  // The groomed cuts have a velvet undercoat. Clip the actual jaw surface to
  // the design contour and share edge vertices so the undercoat stays smooth.
  const coatVertices = new Map();
  function coatVertex(i, j, di, dj) {
    if (i > j) return coatVertex(j, i, dj, di);
    const key = i + "/" + j;
    if (coatVertices.has(key)) return coatVertices.get(key);
    const t = i === j ? 0 : (0.18 - di) / (dj - di);
    const density = i === j ? di : 0.18;
    const n = new THREE.Vector3()
      .fromBufferAttribute(normal, i)
      .lerp(temp.fromBufferAttribute(normal, j), t)
      .normalize();
    const point = new THREE.Vector3()
      .fromBufferAttribute(position, i)
      .lerp(temp.fromBufferAttribute(position, j), t)
      .addScaledVector(n, 0.0002 + 0.0004 * density);
    const index = xyz.length / 3;
    xyz.push(point.x, point.y, point.z);
    color.copy(dye).lerp(skin, 0.06 + 0.64 * (1 - density) ** 4);
    rgb.push(color.r, color.g, color.b);
    const blend = new Map();
    for (const [id, fraction] of [
      [i, 1 - t],
      [j, t],
    ])
      for (let k = 0; k < 4; k++) {
        const bone = skinIndex.getComponent(id, k);
        blend.set(
          bone,
          (blend.get(bone) ?? 0) + fraction * skinWeight.getComponent(id, k),
        );
      }
    const sorted = [...blend].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = sorted.reduce((sum, pair) => sum + pair[1], 0);
    for (let k = 0; k < 4; k++) {
      joints.push(sorted[k]?.[0] ?? 0);
      weights.push((sorted[k]?.[1] ?? 0) / total);
    }
    coatVertices.set(key, index);
    return index;
  }
  function coatTriangle(ids) {
    const density = [a, b, c].map(beardDensity);
    const polygon = [];
    for (let u = 0; u < 3; u++) {
      const v = (u + 1) % 3;
      if (density[u] >= 0.18)
        polygon.push(coatVertex(ids[u], ids[u], density[u], density[u]));
      if (density[u] >= 0.18 !== density[v] >= 0.18)
        polygon.push(coatVertex(ids[u], ids[v], density[u], density[v]));
    }
    for (let i = 2; i < polygon.length; i++)
      triangles.push(polygon[0], polygon[i - 1], polygon[i]);
  }

  for (let k = 0; k < faces.length; k += 3) {
    const ids = [faces[k], faces[k + 1], faces[k + 2]];
    a.fromBufferAttribute(position, ids[0]);
    b.fromBufferAttribute(position, ids[1]);
    c.fromBufferAttribute(position, ids[2]);
    if (
      Math.min(a.y, b.y, c.y) > 0.919 ||
      Math.max(a.y, b.y, c.y) < 0.842 ||
      Math.max(a.z, b.z, c.z) < -0.012
    )
      continue;
    if (cut) coatTriangle(ids);
    const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    const expected = area * (cut ? 900000 : 285000);
    let count = Math.floor(expected);
    if (random() < expected - count) count++;
    for (let sample = 0; sample < count; sample++) {
      const r = Math.sqrt(random()),
        u = 1 - r,
        v = r * (1 - random()),
        w = 1 - u - v;
      origin
        .copy(a)
        .multiplyScalar(u)
        .addScaledVector(b, v)
        .addScaledVector(c, w);
      if (random() < beardDensity(origin)) addHair(ids, [u, v, w]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(triangles);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(xyz, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(rgb, 3));
  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(joints, 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(weights, 4),
  );
  geometry.computeVertexNormals();
  return geometry;
}
