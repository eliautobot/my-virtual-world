// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";

// Each strip is drafted from tear duct to temple. Lengths and follicle radii
// are millimetres on the normalized studio foundation. Alternate lengths,
// cluster direction and the lower strip give each cut its own silhouette.
function strip(start, end, lengths, radius, sweep, curl, extra = {}) {
  return { start, end, lengths, radius, sweep, curl, ...extra };
}
const styles = [
  {
    name: "Everyday wisps",
    upper: strip(
      -0.7,
      0.91,
      [1.4, 1.8, 2.4, 2.8, 3, 3.1, 3, 2.7, 2.1],
      0.22,
      0.18,
      0.75,
    ),
  },
  {
    name: "Outer corner flick",
    upper: strip(
      0.24,
      0.95,
      [1.8, 2.6, 3.3, 4, 4.8, 5.4, 5.8],
      0.36,
      0.98,
      0.57,
    ),
  },
  {
    name: "Doll fan",
    upper: strip(
      -0.78,
      0.9,
      [2.1, 3, 4.1, 5, 5.4, 5.8, 5.4, 4.9, 4.2, 3.1, 2.5],
      0.35,
      0.04,
      0.94,
    ),
    lower: strip(
      -0.59,
      0.76,
      [1.7, 2.2, 2.7, 3, 2.8, 2.3, 1.8],
      0.21,
      0.06,
      0.8,
    ),
  },
  {
    name: "Wisp clusters",
    upper: strip(
      -0.69,
      0.94,
      [2.1, 3.6, 4.5, 4.1, 5.3, 4.5, 4.2],
      0.32,
      0.37,
      0.9,
      { fan: 3, spread: 0.39 },
    ),
  },
  {
    name: "Cat-eye sweep",
    upper: strip(
      -0.72,
      0.95,
      [1.5, 1.9, 2.2, 2.5, 2.9, 3.35, 3.8, 4.3, 4.9, 5.5, 6.2, 6.3],
      0.43,
      0.96,
      0.66,
    ),
    lower: strip(0.48, 0.9, [1.5, 2, 2.6], 0.2, 0.75, 0.65),
  },
  {
    name: "Velvet volume",
    upper: strip(
      -0.79,
      0.93,
      [2.2, 2.8, 3.3, 3.8, 4.2, 4.5, 4.5, 4.6, 4.5, 4.3, 4.2, 3.8, 3.3],
      0.39,
      0.25,
      0.89,
      { fan: 3, spread: 0.28 },
    ),
    lower: strip(
      -0.35,
      0.88,
      [1.4, 1.8, 2.1, 2.2, 2.1, 1.9, 1.5],
      0.18,
      0.23,
      0.72,
    ),
  },
  {
    name: "Crossed feathers",
    upper: strip(
      -0.69,
      0.93,
      [2.1, 2.7, 3.4, 3.9, 4.5, 4.8, 4.8, 4.4, 4.1, 3.7],
      0.3,
      0.38,
      0.68,
      { cross: 0.65, fan: 2, spread: 0.21 },
    ),
  },
  {
    name: "Petal points",
    upper: strip(-0.68, 0.9, [2.5, 3.6, 4.8, 5.5, 5.1, 4.8], 0.49, 0.24, 0.96, {
      fan: 3,
      spread: -0.5,
    }),
    lower: strip(-0.33, 0.78, [1.1, 1.8, 1.9, 1.25], 0.22, 0.28, 0.7, {
      fan: 2,
      spread: -0.25,
    }),
  },
  {
    name: "Runway spikes",
    upper: strip(
      -0.73,
      0.94,
      [2.2, 1.75, 4.1, 2, 5.5, 2.7, 6.4, 2.8, 5.9, 2.8, 5.8],
      0.47,
      0.37,
      0.68,
    ),
    lower: strip(-0.45, 0.8, [1.8, 2.3, 2.7, 2.1], 0.3, 0.27, 0.68),
  },
  {
    name: "Lower flutter",
    upper: strip(
      -0.57,
      0.87,
      [1.4, 2, 2.3, 2.5, 2.6, 2.4, 2.2],
      0.22,
      0.35,
      0.84,
    ),
    lower: strip(
      -0.68,
      0.88,
      [1.9, 2.5, 3, 3.6, 3.9, 3.8, 3.6, 3, 2.4],
      0.33,
      0.18,
      0.77,
    ),
  },
  {
    name: "Squirrel lift",
    upper: strip(
      -0.82,
      0.95,
      [1.4, 1.7, 2.2, 2.9, 3.6, 4.5, 5.5, 6.1, 5.4, 3.8, 2.8, 1.9],
      0.37,
      0.22,
      1.12,
      { fan: 2, spread: 0.19 },
    ),
  },
  {
    name: "Butterfly flare",
    upper: strip(
      -0.76,
      0.96,
      [2, 2.6, 3.3, 3.6, 3.1, 4.6, 6.1, 6.8],
      0.41,
      0.71,
      0.97,
      { fan: 3, spread: 0.48 },
    ),
    lower: strip(0.17, 0.92, [1.6, 2.1, 2.7, 3.3, 3.5], 0.25, 0.64, 0.69, {
      fan: 2,
      spread: 0.29,
    }),
  },
];
export const lashNames = styles.map((style) => style.name);

// Each tuft grows forward out of the lid before turning upwards (downwards
// on the lower lid). As the eye closes, its entire upper fan pitches forward
// about the moving root. The tapered ellipse preserves volume in profile.
export function lashGeometry(index, side, blink, rootAt) {
  const style = styles[index];
  const positions = [],
    triangles = [];
  const sections = 7,
    around = 6;
  function filament(u, length, radius, sweep, curl, upper) {
    const { root, lateral, forward } = rootAt(u, upper, blink);
    const sign = upper ? 1 : -1;
    const startPitch = sign * (upper ? 0.54 - 0.9 * blink : 0.45);
    const bend = sign * (0.33 + 0.64 * curl);
    const spine = [root];
    for (let k = 1; k <= sections; k++) {
      const t = (k - 0.5) / sections,
        pitch = startPitch + bend * t;
      const direction = lateral
        .clone()
        .multiplyScalar(side * sweep * (0.62 + 0.52 * t))
        .addScaledVector(forward, Math.cos(pitch));
      direction.y += Math.sin(pitch);
      spine.push(
        spine[k - 1]
          .clone()
          .addScaledVector(direction.normalize(), length / sections),
      );
    }
    const base = positions.length / 3;
    for (let k = 0; k < sections; k++) {
      const t = k / sections,
        path = spine[k + 1]
          .clone()
          .sub(spine[Math.max(0, k - 1)])
          .normalize();
      const wide = lateral
        .clone()
        .addScaledVector(path, -lateral.dot(path))
        .normalize();
      const deep = new Vector3().crossVectors(path, wide);
      const r = radius * (1 - 0.12 * t) * (1 - t * t) ** 0.73;
      for (let q = 0; q < around; q++) {
        const angle = (q * 2 * Math.PI) / around;
        const p = spine[k]
          .clone()
          .addScaledVector(wide, r * Math.cos(angle))
          .addScaledVector(deep, 0.57 * r * Math.sin(angle));
        positions.push(p.x, p.y, p.z);
        if (k) {
          const a = base + (k - 1) * around + q,
            b = base + (k - 1) * around + ((q + 1) % around);
          triangles.push(a, b, a + around, b, b + around, a + around);
        }
      }
    }
    const tip = positions.length / 3;
    spine.at(-1).toArray(positions, positions.length);
    for (let q = 0; q < around; q++) {
      const last = base + (sections - 1) * around;
      triangles.push(last + q, last + ((q + 1) % around), tip);
    }
    for (let q = 1; q < around - 1; q++)
      triangles.push(base, base + q + 1, base + q);
  }
  function grow(row, upper) {
    if (!row) return;
    const count = row.lengths.length,
      group = row.fan ?? 1;
    const step = (row.end - row.start) / (count - 1);
    for (let n = 0; n < count; n++) {
      const u = row.start + n * step;
      for (let j = 0; j < group; j++) {
        const lane = group === 1 ? 0 : (2 * j) / (group - 1) - 1;
        const crossing = (row.cross ?? 0) * (n % 2 ? 1 : -1);
        const length =
          row.lengths[n] *
          (group === 2 ? (j === 1 ? 1 : 0.79) : 1 - 0.23 * Math.abs(lane));
        const spread = row.spread ?? 0;
        filament(
          u + lane * Math.min(step * 0.19, 0.985 - Math.abs(u)),
          length / 1000,
          (row.radius / 1000) * (1 - 0.23 * Math.abs(lane)),
          0.34 * u + row.sweep + lane * spread + crossing,
          row.curl,
          upper,
        );
      }
    }
  }
  grow(style.upper, true);
  grow(style.lower, false);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  return geometry;
}
