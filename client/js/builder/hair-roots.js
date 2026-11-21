// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as THREE from "three";
import { getReferenceHead } from "./reference-head.js";

const tau = Math.PI * 2;
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const mix = THREE.MathUtils.lerp;
const rootCache = new Map();

// Registered hairlines, from the centre forehead around the temple point,
// over the helix and behind the ear to the centre nape. Heights are expressed
// in the same normalized bind coordinates as the sculpt and original body.
const hairlines = {
  female: [
    [0, 0.958],
    [0.47, 0.958],
    [0.78, 0.95],
    [0.97, 0.936],
    [1.09, 0.92],
    [1.18, 0.9],
    [1.25, 0.897],
    [1.39, 0.911],
    [1.54, 0.9125],
    [1.7, 0.905],
    [1.84, 0.891],
    [1.99, 0.879],
    [2.22, 0.872],
    [2.63, 0.87],
    [Math.PI, 0.867],
  ],
  male: [
    [0, 0.962],
    [0.47, 0.962],
    [0.78, 0.955],
    [0.98, 0.945],
    [1.09, 0.933],
    [1.18, 0.913],
    [1.27, 0.909],
    [1.4, 0.92],
    [1.55, 0.922],
    [1.72, 0.917],
    [1.86, 0.901],
    [2.03, 0.889],
    [2.27, 0.883],
    [2.65, 0.88],
    [Math.PI, 0.879],
  ],
};

function hairlineHeight(landmarks, angle) {
  const a = Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle)));
  let i = 0;
  while (i < landmarks.length - 2 && a > landmarks[i + 1][0]) i++;
  const [x0, y0] = landmarks[i],
    [x1, y1] = landmarks[i + 1];
  const prior = landmarks[Math.max(0, i - 1)],
    next = landmarks[Math.min(landmarks.length - 1, i + 2)];
  const span = x1 - x0,
    t = (a - x0) / span;
  const m0 = i === 0 ? 0 : (y1 - prior[1]) / (x1 - prior[0]);
  const m1 = i + 2 === landmarks.length ? 0 : (next[1] - y0) / (next[0] - x0);
  return (
    (2 * t ** 3 - 3 * t * t + 1) * y0 +
    (t ** 3 - 2 * t * t + t) * span * m0 +
    (-2 * t ** 3 + 3 * t * t) * y1 +
    (t ** 3 - t * t) * span * m1
  );
}

function fittedScalp(shell) {
  const { position, normal, skinIndex, skinWeight } = shell.attributes;
  const count = shell.userData.ringSegments,
    pole = shell.userData.seamStart - 1;
  const rows = pole / count,
    centerZ = position.getZ(pole),
    top = position.getY(pole);
  const offset = Math.atan2(position.getX(0), position.getZ(0) - centerZ);
  // The head bake stores each latitude as a ring. Bilinear interpolation
  // samples the actual scalp all the way down to the postauricular hairline.
  return {
    top,
    sample(angle, y) {
      const s = (((((angle - offset) / tau) % 1) + 1) % 1) * count,
        start = Math.floor(s) % count;
      const influences = new Map(),
        p = new THREE.Vector3(),
        n = new THREE.Vector3();
      const accumulate = (id, w) => {
        p.x += position.getX(id) * w;
        p.y += position.getY(id) * w;
        p.z += position.getZ(id) * w;
        n.x += normal.getX(id) * w;
        n.y += normal.getY(id) * w;
        n.z += normal.getZ(id) * w;
        for (let k = 0; k < 4; k++) {
          const value = skinWeight.getComponent(id, k) * w;
          if (value > 0) {
            const joint = skinIndex.getComponent(id, k);
            influences.set(joint, (influences.get(joint) || 0) + value);
          }
        }
      };
      for (let j = 0; j < 2; j++) {
        const col = (start + j) % count,
          across = j ? s - Math.floor(s) : 1 - (s - Math.floor(s));
        let low = 0,
          high = rows;
        while (high - low > 1) {
          const mid = (high + low) >> 1;
          if (position.getY(mid * count + col) <= y) low = mid;
          else high = mid;
        }
        const below = low * count + col,
          above = high === rows ? pole : high * count + col;
        const rise = THREE.MathUtils.clamp(
          (y - position.getY(below)) /
            (position.getY(above) - position.getY(below)),
          0,
          1,
        );
        accumulate(below, across * (1 - rise));
        accumulate(above, across * rise);
      }
      const bones = Array.from(influences)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4),
        total = bones.reduce((s, b) => s + b[1], 0);
      return {
        p,
        n: n.normalize(),
        j: Array.from({ length: 4 }, (_, i) => bones[i]?.[0] || 0),
        w: Array.from({ length: 4 }, (_, i) => (bones[i]?.[1] || 0) / total),
      };
    },
  };
}

// The sculpted grooms use the same measured crown and temple landmarks as
// the weighted underlay. The surface itself is immutable and shared by cuts.
const groomScalps = new Map();
export function groomScalp(gender) {
  if (!groomScalps.has(gender)) {
    const scalp = fittedScalp(getReferenceHead(gender).skin);
    groomScalps.set(gender, {
      ...scalp,
      hairline: (angle) => hairlineHeight(hairlines[gender], angle),
    });
  }
  return groomScalps.get(gender);
}

function fittedRoots(gender, style) {
  const key = gender + style;
  if (rootCache.has(key)) return rootCache.get(key);
  const f = gender === "female",
    knot = f && style === 2,
    short = !f && style === 2;
  const scalp = fittedScalp(getReferenceHead(gender).skin);
  const sides = 176,
    rows = 57,
    pos = [],
    color = [],
    weights = [],
    joints = [],
    faces = [];
  const push = (q, projection, light) => {
    q.p.addScaledVector(q.n, projection);
    pos.push(...q.p.toArray());
    color.push(light, light, light);
    joints.push(...q.j);
    weights.push(...q.w);
  };
  const tie = new THREE.Vector3(
    knot ? 0 : 0.1,
    knot ? 0.82 : 0.94,
    knot ? -0.57 : -0.32,
  ).normalize();
  const right = new THREE.Vector3(1, 0, 0)
    .addScaledVector(tie, -tie.x)
    .normalize();
  const tangent = new THREE.Vector3().crossVectors(tie, right);
  const volume = style === 0 ? 0.00115 : short ? 0.0029 : 0.0037;
  push(
    scalp.sample(0, scalp.top),
    volume + (style === 0 ? 0 : 0.0025),
    style === 0 ? 0.78 : 0.93,
  );
  for (let i = 1; i <= rows; i++) {
    const t = i / rows,
      crown = Math.cos((t * Math.PI) / 2);
    for (let k = 0; k < sides; k++) {
      const a = (tau * k) / sides;
      let hem = hairlineHeight(hairlines[gender], a);
      const temple = Math.sin(a) ** 2,
        back = (1 - Math.cos(a)) * 0.5;
      const frontal =
        1 - smooth(0.59, 1.1, Math.abs(Math.atan2(Math.sin(a), Math.cos(a))));
      if (style !== 0)
        hem -= frontal * ((f ? 0.0063 : 0.0034) + 0.0012 * Math.sin(2.5 * a));
      // Minor changes in silhouette follow the clump size of each groom.
      const scallop =
        0.00055 * Math.cos(18 * a + 0.43 * Math.sin(3 * a)) +
        0.00024 * Math.sin(27 * a);
      hem +=
        scallop * temple +
        (style === 0 ? 0.002 : 0) +
        (short ? 0.002 * back : 0);
      const q = scalp.sample(a, mix(hem, scalp.top, crown));
      const nx = q.p.x / 0.055,
        ny = (q.p.y - 0.938) / 0.064,
        nz = (q.p.z + 0.005) / 0.062;
      const dir = new THREE.Vector3(nx, ny, nz).normalize(),
        along = dir.dot(tie);
      const yaw = Math.atan2(dir.dot(right), dir.dot(tangent));
      const phase =
        (knot ? 13 : short ? 18 : 12) * yaw +
        (knot ? 3.5 : 1.5) * along +
        0.44 * Math.sin(2 * yaw + 0.6 * along);
      const taper =
        smooth(0.006, 0.18, Math.sqrt(Math.max(0, 1 - along * along))) *
        smooth(0, 0.09, t);
      const grooves =
        (0.57 * Math.cos(phase) +
          0.22 * Math.cos(phase * 2 + 0.45) +
          0.12 * Math.sin(phase * 3 - 0.52)) *
        taper;
      const edge = smooth(0.91, 1, t),
        edgeRoot = smooth(0.971, 1, t);
      const rise =
        volume +
        (style === 0 ? 0.00037 : 0.0013) * grooves * (1 - edge) +
        (style === 0 ? 0 : 0.0025 * crown * crown);
      const lift = mix(rise, 0.00038, edge) - 0.00165 * edgeRoot;
      push(
        q,
        lift,
        (style === 0 ? 0.78 : 0.93) +
          (style === 0 ? 0.032 : 0.075) * grooves -
          0.095 * edge,
      );
      const b = 1 + (i - 1) * sides,
        kn = (k + 1) % sides;
      if (i === 1) faces.push(0, b + k, b + kn);
      else
        faces.push(
          b - sides + k,
          b + k,
          b - sides + kn,
          b - sides + kn,
          b + k,
          b + kn,
        );
    }
  }
  // The lip curls beneath the outer scalp and closes inside the cranium.
  const first = 1 + (rows - 1) * sides,
    inside = pos.length / 3;
  pos.push(0, 0.935, -0.006);
  color.push(0.66, 0.66, 0.66);
  joints.push(39, 0, 0, 0);
  weights.push(1, 0, 0, 0);
  for (let i = 0; i < sides; i++)
    faces.push(first + i, inside, first + ((i + 1) % sides));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(joints, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  g.setIndex(faces);
  g.computeVertexNormals();
  rootCache.set(key, g);
  return g;
}

export function tintFade(geometry, gender, hair, skin) {
  const { position, color } = geometry.attributes;
  const shade = new THREE.Color(),
    scalp = groomScalp(gender);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      z = position.getZ(i),
      y = position.getY(i);
    const angle = Math.atan2(x, z + 0.003),
      hairline = scalp.hairline(angle);
    const grain = 0.92 + 0.08 * Math.cos(4941 * x + 3149 * y);
    const level = mix(hairline, 0.929, 0.78);
    const band =
      (1 - smooth(-0.012, 0.032, y - level)) *
      (1 - smooth(0.43, 0.95, Math.cos(angle)));
    shade
      .copy(hair)
      .lerp(skin, 0.53 * band * grain)
      .multiplyScalar(color.getX(i));
    color.setXYZ(i, shade.r, shade.g, shade.b);
  }
}
export function addFittedRoots(
  female,
  style,
  color,
  material,
  add,
  fadeSkin = null,
) {
  const geo = fittedRoots(female ? "female" : "male", style).clone();
  if (fadeSkin) tintFade(geo, female ? "female" : "male", color, fadeSkin);
  add(
    "Hair / rooted scalp",
    geo,
    material(fadeSkin ? "white" : color, true, {
      roughness: style === 0 ? 0.61 : 0.54,
    }),
  );
}
