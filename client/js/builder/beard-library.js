// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as THREE from "three";

// Angles are measured around the actual jaw. Length and loft are in
// thousandths of the normalized foundation height.
const styles = [
  {
    name: "Short boxed beard",
    cut: "box",
    cheek: [10.5, 19, 16],
    span: 1.54,
    loft: 2.5,
    length: 3,
    fullness: 0.95,
  },
  {
    name: "Rounded full beard",
    cut: "round",
    cheek: [16.5, 20, 13],
    span: 1.6,
    loft: 6.0,
    length: 12,
    fullness: 0.98,
  },
  {
    name: "Ducktail beard",
    cut: "duck",
    cheek: [12.5, 17, 15],
    span: 1.52,
    loft: 6.5,
    length: 20,
    fullness: 0.98,
  },
  {
    name: "Square full beard",
    cut: "square",
    cheek: [15, 15, 17],
    span: 1.58,
    loft: 7.2,
    length: 17,
    fullness: 0.98,
  },
  {
    name: "Classic goatee",
    cut: "goatee",
    span: 0.57,
    loft: 3.0,
    length: 5,
    fullness: 0.96,
  },
  {
    name: "Van Dyke point",
    cut: "point",
    span: 0.43,
    loft: 4.2,
    length: 15,
    fullness: 0.98,
  },
  {
    name: "Balbo beard",
    cut: "balbo",
    span: 1.17,
    loft: 3.8,
    length: 7,
    fullness: 0.95,
  },
  {
    name: "Anchor beard",
    cut: "anchor",
    span: 1.02,
    loft: 2.4,
    length: 4,
    fullness: 0.94,
  },
  {
    name: "Mutton chops",
    cut: "chops",
    span: 1.59,
    start: 0.34,
    loft: 4.8,
    length: 6,
    fullness: 0.97,
  },
  {
    name: "Chin curtain",
    cut: "curtain",
    span: 1.59,
    loft: 3.8,
    length: 8,
    fullness: 0.96,
  },
  {
    name: "Forked beard",
    cut: "fork",
    cheek: [14, 18, 14],
    span: 1.43,
    loft: 6,
    length: 23,
    fullness: 0.97,
  },
  {
    name: "Faded stubble",
    cut: "fade",
    cheek: [15.5, 20, 13],
    span: 1.55,
    loft: 0.42,
    length: 0.25,
    fullness: 0.46,
  },
];
export const beardNames = Object.freeze(styles.map((style) => style.name));
const named = new Map(styles.map((style) => [style.name, style]));
const charts = new WeakMap();
const pi = Math.PI;
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
function smooth(lo, hi, x) {
  const v = clamp((x - lo) / (hi - lo));
  return v * v * (3 - 2 * v);
}
const bell = (x) => Math.exp(-x * x);

// A frontal depth projection misses the bottom face of the chin. Each row
// intersects the real head triangles with horizontal rays emanating from
// inside the jaw. The atlas also retains the intersected triangle's joint mix.
function jawChart(head, mouthY) {
  const previous = charts.get(head);
  if (previous?.mouthY === mouthY) return previous;
  const {
    position: p,
    normal: n,
    skinIndex: j,
    skinWeight: w,
  } = head.attributes;
  const indices = head.index.array,
    boneIds = new Set(),
    buckets = new Map();
  const low = mouthY - 0.042,
    high = mouthY + 0.056,
    limit = 1.62,
    originZ = 0.002;
  const bottomAt = (a) => low + 0.01 * smooth(0.08, 1.61, Math.abs(a));
  const topAt = (a) => mouthY + 0.04 + 0.016 * smooth(0.86, 1.34, Math.abs(a));
  const col = (a) => Math.floor((a + limit) / 0.082),
    row = (y) => Math.floor((y - low) / 0.004);
  for (let i = 0; i < indices.length; i += 3) {
    const ids = [indices[i], indices[i + 1], indices[i + 2]];
    const ys = ids.map((id) => p.getY(id));
    if (Math.max(...ys) < low || Math.min(...ys) > high) continue;
    const angles = ids.map((id) =>
      Math.atan2(p.getX(id), p.getZ(id) - originZ),
    );
    const amin = Math.min(...angles),
      amax = Math.max(...angles);
    if (amax - amin > pi || amax < -limit || amin > limit) continue;
    for (const id of ids)
      for (let k = 0; k < 4; k++)
        if (w.getComponent(id, k) > 0) boneIds.add(j.getComponent(id, k));
    for (
      let iy = row(Math.max(low, Math.min(...ys)));
      iy <= row(Math.min(high, Math.max(...ys)));
      iy++
    ) {
      for (
        let ia = col(Math.max(-limit, amin));
        ia <= col(Math.min(limit, amax));
        ia++
      ) {
        const key = iy * 64 + ia;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(i);
      }
    }
  }
  const bones = [...boneIds],
    boneIndex = new Map(bones.map((bone, i) => [bone, i]));
  const na = 145,
    ny = 83,
    stride = 6 + bones.length;
  const data = new Float32Array(na * ny * stride);
  for (let iy = 0; iy < ny; iy++) {
    for (let ia = 0; ia < na; ia++) {
      const angle = -limit + (2 * limit * ia) / (na - 1),
        sin = Math.sin(angle),
        cos = Math.cos(angle);
      const floor = bottomAt(angle),
        y = floor + ((topAt(angle) - floor) * iy) / (ny - 1);
      let selected = -1,
        far = 0,
        blend;
      for (const i of buckets.get(row(y) * 64 + col(angle)) ?? []) {
        const a = indices[i],
          b = indices[i + 1],
          c = indices[i + 2];
        const sx = p.getX(a) * cos - (p.getZ(a) - originZ) * sin,
          sy = p.getY(a) - y;
        const bx =
            (p.getX(b) - p.getX(a)) * cos - (p.getZ(b) - p.getZ(a)) * sin,
          by = p.getY(b) - p.getY(a);
        const cx =
            (p.getX(c) - p.getX(a)) * cos - (p.getZ(c) - p.getZ(a)) * sin,
          cy = p.getY(c) - p.getY(a);
        const det = bx * cy - cx * by;
        if (Math.abs(det) < 1e-12) continue;
        const u = (cx * sy - sx * cy) / det,
          v = (sx * by - bx * sy) / det,
          t = 1 - u - v;
        if (Math.min(t, u, v) < -0.00001) continue;
        const x = p.getX(a) * t + p.getX(b) * u + p.getX(c) * v;
        const z = p.getZ(a) * t + p.getZ(b) * u + p.getZ(c) * v;
        const r = x * sin + (z - originZ) * cos;
        if (r > far) {
          far = r;
          selected = i;
          blend = [t, u, v];
        }
      }
      if (selected < 0)
        throw new Error(`Could not intersect male jaw at ${angle} / ${y}`);
      const offset = (iy * na + ia) * stride;
      data[offset] = sin * far;
      data[offset + 1] = y;
      data[offset + 2] = originZ + cos * far;
      for (let k = 0; k < 3; k++) {
        const id = indices[selected + k],
          fraction = Math.max(0, blend[k]);
        for (let c = 0; c < 3; c++)
          data[offset + 3 + c] += fraction * n.getComponent(id, c);
        for (let c = 0; c < 4; c++) {
          const weight = w.getComponent(id, c);
          if (weight)
            data[offset + 6 + boneIndex.get(j.getComponent(id, c))] +=
              fraction * weight;
        }
      }
    }
  }
  function sample(a, y) {
    const u = clamp(((a + limit) / (2 * limit)) * (na - 1), 0, na - 1.00001);
    const floor = bottomAt(a),
      v = clamp(((y - floor) / (topAt(a) - floor)) * (ny - 1), 0, ny - 1.00001);
    const x = Math.floor(u),
      h = Math.floor(v),
      du = u - x,
      dv = v - h,
      base = (x + h * na) * stride;
    const out = new Float64Array(stride);
    for (let k = 0; k < stride; k++) {
      out[k] =
        (1 - dv) * ((1 - du) * data[base + k] + du * data[base + stride + k]) +
        dv *
          ((1 - du) * data[base + na * stride + k] +
            du * data[base + (na + 1) * stride + k]);
    }
    const len = Math.hypot(out[3], out[4], out[5]);
    for (let k = 3; k < 6; k++) out[k] /= len;
    return out;
  }
  const chart = { bones, sample, mouthY };
  charts.set(head, chart);
  return chart;
}

// Fit the cut to the mouth before wrapping it around the jaw. The rim
// and both corners follow the selected sculpt, including asymmetrical smiles.
function combLines(style, chart, lip) {
  const halfWidth = lip?.halfWidth ?? 0.0182;
  const count = 241,
    step = (2 * style.span) / (count - 1);
  const low = new Float32Array(count),
    high = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const angle = -style.span + i * step,
      a = Math.abs(angle);
    const x = chart.sample(angle, chart.mouthY)[0];
    const u = Math.abs(x) / halfWidth;
    const edgeX = clamp(x, -halfWidth, halfWidth);
    const lowerLip = lip?.lowerAt
      ? (lip.lowerAt(edgeX) - chart.mouthY) * 1000
      : 1.4 * Math.min(u * u, 1) - 5.4 * Math.max(0, 1 - u * u) ** 0.7;
    // Leave a narrow strip of skin under the lower vermilion and two small
    // recesses beside the central soul patch. The outer pillars start beyond
    // the corners so raising the cheek line never paints over the lips.
    const chin = lowerLip - 0.66 - 5.7 * bell((u - 0.49) / 0.26);
    const temple = smooth(0.88, 1.42, a);
    let bottom = -34.8 + 14 * smooth(0.09, 1.57, a),
      top;
    if (style.cheek) {
      const [outside, sweep, sideburn] = style.cheek;
      const pastCorner = (Math.abs(x) - halfWidth) * 1000;
      const run = .5 * (pastCorner + Math.hypot(pastCorner, 2.1));
      // A continuous diagonal from the corner of the mouth up the cheek.
      // Ease into the sideburn as the face turns away from the frontal plane.
      top = chin + (outside + 9) * Math.tanh(run/19)
        + .77*sweep * smooth(0.48,1.54,a) + .84*sideburn*temple;
      top += smooth(.27,.52,a) * (.31*Math.sin(38*angle+.7) + .17*Math.sin(73*angle));
      if (style.cut === "box") bottom += 2.3;
    } else {
      switch (style.cut) {
        case "goatee": {
          const pillar = bell((u-1.27)/.29);
          const wing = 0.6 + 8.8*pillar - 9*smooth(1.31,1.70,u);
          top = chin + (wing-chin)*smooth(.78,1.26,u);
          bottom += 2.7;
          break;
        }
        case "point":
          top = Math.min(chin, -4.6 - 6.5 * smooth(0.1, 0.42, a));
          bottom += 4;
          break;
        case "balbo":
          top =
            Math.min(chin, -4.5 - 7.5 * smooth(0.06, 0.28, a)) +
            19 * smooth(0.32, 1.07, a);
          bottom += 3.2;
          break;
        case "anchor":
          top =
            Math.min(chin, -18.3 + 14.5 * bell(a / 0.125)) +
            23 * smooth(0.3, 1.0, a);
          bottom = -31.4 + 23 * smooth(0.14, 1.02, a);
          break;
        case "chops":
          top =
            3.0 +
            16.0 * smooth(0.34, 0.64, a) +
            15 * smooth(0.64, 1.45, a) +
            14 * temple;
          bottom =
            -6.3 - 14 * smooth(0.34, 0.7, a) + 12 * smooth(0.88, 1.54, a);
          break;
        case "curtain":
          top =
            -16.8 +
            23 * smooth(0.29, 0.88, a) +
            27 * smooth(0.83, 1.47, a) +
            10 * temple;
          bottom += 1.5;
          break;
      }
    }
    low[i] = bottom;
    high[i] = top;
  }
  return (angle) => {
    const u = clamp((angle + style.span) / step, 0, count - 1),
      i = Math.min(count - 2, Math.floor(u)),
      t = u - i;
    return [
      low[i] + t * (low[i + 1] - low[i]),
      high[i] + t * (high[i + 1] - high[i]),
    ];
  };
}

function silhouette(style, a) {
  switch (style.cut) {
    case "duck":
      return 0.11 + 0.89 * bell(a / 0.44);
    case "point":
      return 0.22 + 0.78 * bell(a / 0.23);
    case "square":
      return 1 - 0.76 * smooth(0.55, 1.46, a);
    case "fork":
      return 0.28 + 0.72 * bell((a - 0.3) / 0.23);
    case "chops":
      return 0.27 + 0.73 * bell((a - 0.62) / 0.33);
    case "anchor":
    case "balbo":
      return 0.4 + 0.6 * bell(a / 0.4);
    default:
      return 0.27 + 0.73 * bell(a / 0.74);
  }
}

function coatSample(style, chart, a, v) {
  const abs = Math.abs(a),
    start = style.start ?? 0;
  const u = (abs - start) / (style.span - start);
  // Turn the neckline forward beneath the ears. A straight vertical border
  // here reads as a flat flap in profile, particularly on the longer cuts.
  const tucked =
    0.2 * style.span * smooth(0.42, 1, u) * (1 - smooth(0.1, 0.83, v));
  const chops = style.start
    ? 0.13 * (1 - smooth(0, 0.65, u)) * (1 - smooth(0.1, 0.64, v))
    : 0;
  const angle = Math.sign(a) * (abs - tucked + chops),
    [lo, hi] = chart.comb(angle);
  const hit = chart.sample(angle, chart.mouthY + (lo + (hi - lo) * v) / 1000);
  const fringe = style.cut === "fade" ? 0.17 : 0.095;
  const side =
    smooth(0, fringe, style.span - abs) *
    (style.start ? smooth(0, 0.085, abs - style.start) : 1);
  const lower = smooth(0, style.cut === "fade" ? 0.29 : 0.2, v);
  // Feather in surface distance. A fixed fraction of a tall cheek would
  // erase most of the coverage just gained above the mouth corners.
  const belowLine = (1 - v) * (hi - lo);
  const upper = smooth(0, style.cut === "fade" ? 8.0 : 4.3, belowLine);
  const tide = side * lower * upper;
  const growth =
    a * (17 + 2 * Math.cos(v * pi)) +
    0.64 * Math.sin(4.5 * a + v * 2) -
    0.8 * v * Math.sin(a * 2);
  const grain =
    0.51 * Math.cos(growth) +
    0.29 * Math.cos(growth * 1.91 + 0.9) +
    0.2 * Math.cos(growth * 3.73 + 0.54);
  const length = style.length * silhouette(style, abs);
  const haired = smooth(1, 10, style.length);
  const bulk =
    style.loft *
    (0.6 + 0.4 * bell((v - 0.46) / 0.34)) *
    (1 + (0.1 + 0.14 * haired) * grain);
  const height = lo + v * (hi - lo);
  const chinFall = bell((height + 20 - 10 * smooth(0.26, 1.35, abs)) / 13);
  const drop = length * chinFall * smooth(2.6,14,belowLine) * (1 + haired * 0.045 * grain);
  // The shell returns to the skin on both its cheek line and the underside.
  // Interior follicles grow away from the real face before turning downward.
  const offset = 0.000105 + tide * bulk * 0.001;
  hit[0] += hit[3] * offset;
  hit[1] += hit[4] * offset - tide * drop * 0.001;
  hit[2] += hit[5] * offset + tide * drop * 0.0002;
  const boundary = Math.min(
    style.span - abs,
    style.start ? abs - style.start : 3,
  );
  const edge = smooth(0, style.cut === "fade" ? 0.15 : 0.04, boundary);
  const pigment =
    style.fullness *
    edge *
    smooth(0, 0.12, v) *
    smooth(0, style.cut === "fade" ? 7.3 : 1.18+1.7*smooth(.20,.72,abs), belowLine);
  return { hit, pigment, grain, tide };
}

function createGeometry(style, chart, skin, tint) {
  const pos = [],
    colors = [],
    joints = [],
    weights = [],
    indices = [],
    rimNormals = [];
  const dye = new THREE.Color(),
    shade = tint.clone();
  function vertex(sample, extra = 0, bristle = false) {
    const { hit, pigment, grain } = sample;
    const i = pos.length / 3;
    pos.push(
      hit[0] + extra * hit[3],
      hit[1] + extra * hit[4],
      hit[2] + extra * hit[5],
    );
    if (!bristle && sample.tide < 0.52) {
      rimNormals.push([
        i,
        hit[3],
        hit[4],
        hit[5],
        1 - smooth(0, 0.52, sample.tide),
      ]);
    }
    const rank = chart.bones
      .map((joint, k) => [joint, hit[6 + k]])
      .sort((l, r) => r[1] - l[1])
      .slice(0, 4);
    const total = rank.reduce((s, entry) => s + entry[1], 0);
    for (let j = 0; j < 4; j++) {
      joints.push(rank[j]?.[0] ?? 0);
      weights.push((rank[j]?.[1] ?? 0) / total);
    }
    shade
      .copy(tint)
      .multiplyScalar(
        (bristle ? 1.12 : 0.92) + (bristle ? 0.29 : 0.25) * grain,
      );
    const shine = (bristle ? 0.014 : 0.009) * (0.5 + 0.5 * grain) ** 2;
    shade.r += shine;
    shade.g += shine * 0.82;
    shade.b += shine * 0.71;
    dye.copy(skin).lerp(shade, clamp(pigment * (bristle ? 1.25 : 1)));
    colors.push(dye.r, dye.g, dye.b);
    return i;
  }
  let seed = 54319;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const halves = style.start
    ? [
        [-style.span, -style.start],
        [style.start, style.span],
      ]
    : [[-style.span, style.span]];
  for (const [min, max] of halves) {
    const columns = Math.max(42, Math.ceil((max - min) * 47)),
      rows = 37,
      start = pos.length / 3;
    for (let y = 0; y <= rows; y++)
      for (let x = 0; x <= columns; x++) {
        const a = min + ((max - min) * x) / columns;
        vertex(coatSample(style, chart, a, y / rows));
        if (x && y) {
          const d = start + y * (columns + 1) + x,
            b = d - columns - 1,
            c = d - 1,
            l = b - 1;
          indices.push(l, b, d, l, d, c);
        }
      }
    // Seeded follicle groups grow with the shape. Each tapered fiber has two
    // illuminated flanks, a pointed tip and roots sewn to the underlying coat.
    const count = Math.ceil((max - min) * (style.cut === "fade" ? 1060 : 380));
    for (let f = 0; f < count; f++) {
      const a = min + (max - min) * random(),
        v = 0.065 + 0.925 * random();
      const { pigment } = coatSample(style, chart, a, v);
      if (random() > (style.cut === "fade" ? pigment * 2.6 : pigment)) continue;
      const dense = style.cut !== "fade";
      const len =
        (dense ? 0.047 : 0.026) *
        (1 + random()) *
        (0.83 + 0.34 * Math.sin(pi * v));
      const width = (dense ? 0.0039 : 0.0024) * (0.65 + 0.65 * random());
      const bend = -Math.sign(a) * len * 0.21 + len * (random() - 0.5) * 0.4;
      const tip = Math.max(0.01, v - len),
        mid = v - len * 0.45;
      const base = pos.length / 3,
        height = dense ? 0.00024 : 0.00018;
      const nodes = [
        [a - width * 0.3, v, 0],
        [a + width * 0.3, v, 0],
        [a + bend * 0.38 - width, mid, 0.00004],
        [a + bend * 0.38, mid, height],
        [a + bend * 0.38 + width, mid, 0.00004],
        [a + bend, tip, height * 0.22],
      ];
      for (const [ang, vv, offset] of nodes) {
        const sample = coatSample(style, chart, clamp(ang, min, max), vv);
        if (!dense) sample.pigment = Math.max(0.65, pigment * 1.7);
        vertex(sample, offset + 0.000055, true);
      }
      for (const j of [0, 1, 3, 0, 3, 2, 1, 4, 3, 2, 3, 5, 3, 4, 5])
        indices.push(base + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(joints, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  g.computeVertexNormals();
  const normals = g.attributes.normal,
    normal = new THREE.Vector3();
  for (const [index, x, y, z, blend] of rimNormals) {
    normal.fromBufferAttribute(normals, index).multiplyScalar(1 - blend);
    normal.x += blend * x;
    normal.y += blend * y;
    normal.z += blend * z;
    normal.normalize();
    normals.setXYZ(index, normal.x, normal.y, normal.z);
  }
  return g;
}

export function addBeard({ name, head, mouthY, skin, tint, add, mat, lip }) {
  const style = named.get(name);
  if (!style) return;
  const jaw = jawChart(head, mouthY);
  const cut = { ...jaw, comb: combLines(style, jaw, lip) };
  const geometry = createGeometry(style, cut, skin, tint);
  add("Beard / " + name, geometry, mat("white", true, { roughness: 0.83 }));
}
