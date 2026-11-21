// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as T from "three";
import { extendedPortraits } from "./portrait-library.js";

const cache = new WeakMap();
const sat = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const oval = (x) => Math.exp(-x * x);
const clampScale = (x) =>
  T.MathUtils.clamp(Number.isFinite(x) ? x : 1, 0.75, 1.25);
function orbitalFloor(eyeX, eyeY, x, y, z) {
  const radius = Math.hypot((Math.abs(x) - eyeX) / 0.014, (y - eyeY) / 0.011);
  return 0.0052 * (1 - smooth(0.73, 1.45, radius)) * smooth(0.019, 0.044, z);
}

/** Constant, style-agnostic foundation with soft orbital beds. This neutral
 * surface contains neither eyelids/brow plaques nor an external pinna.
 * Keep this geometry cached; every expression fits to the same surface. */
export function neutralEarEye(gender, source) {
  if (cache.has(source)) return cache.get(source);
  const female = gender === "female",
    g = source.clone(),
    p = g.attributes.position,
    n = g.attributes.normal;
  const eyeX = female ? 0.0236 : 0.0213;
  const eyeY = female ? 0.9037 : 0.9219;
  // Recess the orbital floor under the aperture. The cheek and the brow
  // retain the bony rim which supports the visible eyelid margins.
  const orbitalRim = (x, y, z) => {
    const left = oval((x - eyeX) / 0.017);
    const right = oval((x + eyeX) / 0.017);
    const hollow =
      (female ? 0.0021 : 0.0023) * (left + right) * oval((y - eyeY) / 0.0128);
    return -hollow * smooth(0.019, 0.044, z);
  };
  const epsilon = 0.00008;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i),
      offset = orbitalRim(x, y, z) - orbitalFloor(eyeX, eyeY, x, y, z);
    if (Math.abs(offset) < 1e-8) continue;
    const dx =
      (orbitalRim(x + epsilon, y, z) - orbitalRim(x - epsilon, y, z)) /
      (2 * epsilon);
    const dy =
      (orbitalRim(x, y + epsilon, z) - orbitalRim(x, y - epsilon, z)) /
      (2 * epsilon);
    const dz =
      (orbitalRim(x, y, z + epsilon) - orbitalRim(x, y, z - epsilon)) /
      (2 * epsilon);
    const nz = n.getZ(i) / (1 + dz);
    const nx = n.getX(i) - dx * nz,
      ny = n.getY(i) - dy * nz;
    const len = Math.hypot(nx, ny, nz);
    p.setZ(i, z + offset);
    n.setXYZ(i, nx / len, ny / len, nz / len);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  cache.set(source, g);
  return g;
}

// Polar pinna cross sections run from the lobe through the rolled helix into
// the concha. The back is closed and extends through the temple at the root.
export function addReferenceEars({
  gender,
  style,
  skin,
  tint,
  add,
  mat,
  adjustments = {},
}) {
  if (style < 0) return;
  const female = gender === "female",
    fit = adjustments.ears ?? {},
    width = clampScale(fit.width),
    height = clampScale(fit.height),
    spread = clampScale(fit.projection);
  const root = new T.Color(skin),
    color = new T.Color(tint ?? skin),
    warm = color.clone().multiply(new T.Color("#c09382"));
  const segments = 80,
    rings = 26;
  const design = extendedPortraits[gender].ears[style - 3];
  for (const sign of [-1, 1]) {
    const pos = [],
      colors = [],
      indices = [];
    function vertex(u, v, r, back) {
      const top = smooth(-0.12, 0.9, v),
        lobe = smooth(0.02, -0.94, v);
      const wide =
        (female ? 0.9 : 1) *
        width *
        (design
          ? 1 + (design.crown - 1) * top + (design.lobe - 1) * lobe
          : style === 1
            ? 0.91 + 0.12 * top
            : style === 2
              ? 1 + 0.17 * lobe
              : 1);
      const tall =
        (female ? 0.016 : 0.0165) *
        height *
        (design?.tall ??
          (style === 1 ? 1 + 0.15 * top : style === 2 ? 1 + 0.13 * lobe : 1));
      // The swept upper ear overhangs the softer, attached lobe.
      const h =
        (u * (0.95 + 0.11 * v) + (design?.lean ?? 0.19) * v - 0.075 * lobe) *
        wide;
      const helix = oval((r - 0.79) / 0.145) * (0.82 + 0.18 * top);
      const antihelix =
        oval((u - (0.25 - 0.46 * v * v)) / 0.2) * oval((v - 0.08) / 0.56);
      const tragus = oval((u + 0.6) / 0.27) * oval((v + 0.07) / 0.24);
      const bowl = oval((u + 0.17) / 0.55) * oval((v - 0.05) / 0.5);
      const roundedEdge = Math.sqrt(Math.max(0, 1 - r * r));
      const thickness = back
        ? -0.0059 * roundedEdge
        : roundedEdge *
          (0.002 +
            0.005 * helix * (design?.rim ?? 1) +
            0.0027 * antihelix +
            0.003 * tragus -
            0.0014 * bowl * (design?.bowl ?? 1) +
            0.0024 * lobe);
      const x =
        0.049 +
        (female ? 0.0005 : 0) +
        0.0104 * h * spread +
        0.842 * thickness +
        0.00065 * v;
      const z =
        (female ? 0.0008 : -0.0024) -
        0.0118 * h +
        0.54 * thickness +
        0.0005 * v;
      const y =
        (female ? 0.8978 : 0.9096) +
        tall * (v + (design?.point ?? 0) * top ** 3 * oval((u - 0.36) / 0.35));
      pos.push(sign * x, y, z);
      const dye = root
        .clone()
        .lerp(color, smooth(-0.94, -0.4, h))
        .lerp(warm, back ? 0.028 : (0.065 + 0.2 * bowl) * (1 - 0.67 * helix));
      colors.push(dye.r, dye.g, dye.b);
    }
    let rim;
    for (const back of [false, true]) {
      let prev;
      for (let j = 0; j <= rings; j++) {
        const shared = back && j === rings,
          loop = shared ? rim : [],
          count = j ? segments : 1;
        if (!shared)
          for (let i = 0; i < count; i++) {
            const a = (2 * Math.PI * i) / segments,
              r = j / rings;
            loop.push(pos.length / 3);
            vertex(r * Math.cos(a), r * Math.sin(a), r, back);
          }
        if (prev)
          for (let i = 0; i < segments; i++) {
            const a = prev[i % prev.length],
              b = prev[(i + 1) % prev.length],
              c = loop[(i + 1) % segments],
              d = loop[i];
            if (back === sign < 0) {
              if (a !== b) indices.push(a, d, b);
              indices.push(b, d, c);
            } else {
              if (a !== b) indices.push(a, b, d);
              indices.push(b, c, d);
            }
          }
        prev = loop;
        if (!back && j === rings) rim = loop;
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    add(
      "Ear / " +
        (sign > 0 ? "Left" : "Right") +
        " / " +
        (design?.name ?? ["Shell", "Tapered", "Round"][style]),
      g,
      mat("white", true, { roughness: 0.76 }),
      "head",
    );
  }
}
