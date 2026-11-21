// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import {
  BufferAttribute,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from "three";

const clothTextures = new Map();
const tau = Math.PI * 2;

// The pattern is drawn once as a normal glTF-compatible base-color texture.
// Its UVs stay attached through shape changes and exported skeletal animation.
function printTexture(pattern) {
  if (clothTextures.has(pattern)) return clothTextures.get(pattern);
  const n = 1024,
    data = new Uint8Array(n * n * 4);
  data.fill(255);
  if (pattern === "tartan") {
    const sett = 64;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const u = ((x % sett) * 92) / sett,
          v = ((y % sett) * 92) / sett;
        const warp = u >= 44 && u <= 69,
          weft = v >= 44 && v <= 69;
        const interlace = (x + y) % 4 < 2;
        let ink =
          warp && weft
            ? [67, 119, 127]
            : warp || weft
              ? interlace === warp
                ? [112, 150, 151]
                : [165, 161, 154]
              : [244, 214, 215];
        if ((u >= 79 && u <= 81) || (v >= 79 && v <= 81)) ink = [114, 117, 106];
        if (Math.abs(u - 22) < 0.65 || Math.abs(v - 22) < 0.65)
          ink = [195, 170, 126];
        const w =
          1 +
          0.016 * Math.cos((x + y) * Math.PI) +
          0.012 * Math.cos(y * Math.PI * 0.5);
        const i = (y * n + x) * 4;
        for (let k = 0; k < 3; k++)
          data[i + k] = Math.min(255, Math.round(ink[k] * w));
      }
  } else if (pattern === "knit") {
    // Fine twisted yarn makes two opposing arcs in each stockinette loop.
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const row = Math.floor(y / 9),
          u = ((x + (row % 2) * 3.25) % 6.5) / 6.5 - 0.5;
        const v = (y % 9) / 9;
        const ridge = Math.exp(
          -((Math.abs(u) - (0.1 + 0.32 * v)) ** 2) / 0.016,
        );
        const light = Math.round(238 + 12 * ridge + 4 * Math.cos(tau * v));
        const i = (y * n + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = light;
      }
  } else {
    let state = 734281;
    const rand = () =>
      ((state = (Math.imul(1664525, state) + 1013904223) | 0) >>> 0) /
      4294967296;
    function ellipse(cx, cy, rx, ry, angle, color, opacity = 1) {
      const co = Math.cos(angle),
        si = Math.sin(angle),
        r = Math.max(rx, ry) + 1;
      for (
        let y = Math.max(0, Math.floor(cy - r));
        y <= Math.min(n - 1, Math.ceil(cy + r));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(cx - r));
          x <= Math.min(n - 1, Math.ceil(cx + r));
          x++
        ) {
          const dx = x + 0.5 - cx,
            dy = y + 0.5 - cy;
          const d =
            ((dx * co + dy * si) / rx) ** 2 + ((dy * co - dx * si) / ry) ** 2;
          if (d >= 1) continue;
          const a = Math.min(1, (1 - d) * Math.min(rx, ry)) * opacity,
            i = (y * n + x) * 4;
          for (let k = 0; k < 3; k++)
            data[i + k] = Math.round(data[i + k] * (1 - a) + color[k] * a);
        }
    }
    function sprig(cx, cy, size, angle) {
      const dx = Math.sin(angle),
        dy = Math.cos(angle);
      const xAt = (t) => cx + size * (dx * t + 0.2 * (1 - t * t));
      const yAt = (t) => cy + size * dy * t;
      for (let j = 0; j < 21; j++) {
        const t = j / 10 - 1;
        ellipse(xAt(t), yAt(t), 0.65, 0.85, angle, [114, 126, 95], 0.76);
      }
      const leaves = [
        [110, 132, 100],
        [137, 153, 115],
        [95, 123, 99],
      ];
      for (let j = 0; j < 5; j++) {
        const t = -0.69 + j * 0.29,
          side = j % 2 ? 1 : -1;
        ellipse(
          xAt(t) + 3.25 * side,
          yAt(t) - 1.1,
          4.8,
          1.8,
          side * -0.62 + angle,
          leaves[j % 3],
          0.85,
        );
      }
      const shades = [
        [230, 129, 139],
        [218, 102, 115],
        [213, 116, 134],
        [231, 148, 152],
      ];
      for (let k = 0; k < 3; k++) {
        const t = k === 0 ? -1 : k === 1 ? -0.54 : 0.23,
          side = k === 1 ? 1 : -1;
        const fx = xAt(t) + (k ? 4.3 * side : 0),
          fy = yAt(t),
          s = (k ? 0.83 : 1.18) * (size / 11);
        const rotation = rand() * tau;
        for (let p = 0; p < 5; p++) {
          const a = rotation + (p * tau) / 5;
          ellipse(
            fx + Math.cos(a) * 2.1 * s,
            fy + Math.sin(a) * 2.1 * s,
            3.0 * s,
            2.0 * s,
            a,
            shades[(p + k) % 4],
            0.92,
          );
        }
        ellipse(fx, fy, 1.25 * s, 1.4 * s, rotation, [141, 64, 75], 0.95);
      }
    }
    for (let row = 0; row < 31; row++)
      for (let col = 0; col < 27; col++) {
        const x = (col + (row % 2) * 0.5 + 0.63 * rand()) * 40 - 18;
        const y = (row + 0.55 * rand()) * 35 - 14;
        sprig(x, y, 8 + rand() * 8.7, (rand() - 0.5) * 2.8);
      }
  }
  const texture = new DataTexture(data, n, n);
  texture.colorSpace = SRGBColorSpace;
  texture.name =
    pattern === "sprigs"
      ? "Rose sprigs on ivory cotton"
      : pattern === "tartan"
        ? "Brushed crimson tartan"
        : "Stockinette yarn";
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  clothTextures.set(pattern, texture);
  return texture;
}

function textileCoordinates(g) {
  const p = g.attributes.position,
    idx = g.index,
    part = g.userData.fitParts;
  const sourceIds = [],
    uv = [],
    remap = new Map(),
    indices = new Uint32Array(idx.count);
  function point(id, chart) {
    const x = p.getX(id),
      y = p.getY(id),
      z = p.getZ(id);
    const cx =
      chart * (0.105 + 0.049 * Math.max(0, Math.min(1, (0.773 - y) / 0.25)));
    const cz = chart ? -0.015 : -0.012;
    const a = Math.atan2(x - cx, z - cz) + Math.PI;
    return [a, 0.05 + (y - 0.285) / 0.65];
  }
  for (let i = 0; i < idx.count; i += 3) {
    const ids = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    // Torso and each sleeve have separate grain lines. Duplicate only vertices
    // along this pattern boundary and the cylinder seam at the center back.
    const arms = ids.filter((id) => part?.[id]?.endsWith("Arm"));
    const chart = arms.length >= 2 ? Math.sign(p.getX(arms[0])) : 0;
    const coords = ids.map((id) => point(id, chart));
    const angles = coords.map((pt) => pt[0]);
    const across = Math.max(...angles) - Math.min(...angles) > Math.PI;
    for (let j = 0; j < 3; j++) {
      const [theta, v] = coords[j],
        wrap = across && theta < Math.PI ? 1 : 0;
      const key = ids[j] * 12 + (chart + 1) * 2 + wrap;
      let id = remap.get(key);
      if (id === undefined) {
        id = sourceIds.length;
        remap.set(key, id);
        sourceIds.push(ids[j]);
        uv.push(0.055 + (theta / tau + wrap) * (chart ? 0.28 : 0.79), v);
      }
      indices[i + j] = id;
    }
  }
  for (const [name, buffer] of Object.entries(g.attributes)) {
    const next = new buffer.array.constructor(
      sourceIds.length * buffer.itemSize,
    );
    for (let j = 0; j < sourceIds.length; j++) {
      const src = sourceIds[j] * buffer.itemSize,
        dest = j * buffer.itemSize;
      for (let k = 0; k < buffer.itemSize; k++)
        next[dest + k] = buffer.array[src + k];
    }
    g.setAttribute(
      name,
      new BufferAttribute(next, buffer.itemSize, buffer.normalized),
    );
  }
  g.setIndex(
    new BufferAttribute(
      sourceIds.length <= 65535 ? Uint16Array.from(indices) : indices,
      1,
    ),
  );
  if (part) g.userData.fitParts = sourceIds.map((id) => part[id]);
  const ab = g.userData.armBlend;
  if (ab) g.userData.armBlend = Uint8Array.from(sourceIds, (id) => ab[id]);
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
}
export function applyTripoTextile(geometry, materials, design) {
  if (!design?.source) return;
  if (design.cut === "armor") {
    for (const k of [0, 2, 4]) {
      materials[k].metalness = 0.31;
      materials[k].roughness = 0.35;
    }
    materials[5].emissive.set("#339db5");
    materials[5].emissiveIntensity = 0.55;
  }
  if (!design.textile) return;
  textileCoordinates(geometry);
  const texture = printTexture(design.textile);
  for (const k of [0, 1, 2]) materials[k].map = texture;
}
