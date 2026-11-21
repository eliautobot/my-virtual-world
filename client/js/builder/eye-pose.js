// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { BufferAttribute } from "three";

const clamp = (v, min, max) =>
  Math.min(max, Math.max(min, Number.isFinite(v) ? v : 0));
// The four look keys are rotations about the globe centre. Three small
// correction shapes keep intermediate and diagonal poses on the same sphere.
const yaw = Math.PI * 0.275,
  pitch = Math.PI * 0.235;
const sinH = Math.sin(yaw),
  sinV = Math.sin(pitch);
const lossH = 1 - Math.cos(yaw),
  lossV = 1 - Math.cos(pitch);

export function eyeMorphWeights(x = 0, y = 0, blink = 0) {
  x = clamp(x, -1, 1);
  y = clamp(y, -1, 1);
  blink = clamp(blink, 0, 1);
  const radius = Math.max(1, Math.hypot(x, y));
  x /= radius;
  y /= radius;
  const h = x * sinH,
    v = y * sinV;
  const divisor = 1 + Math.sqrt(Math.max(0, 1 - h * h - v * v));
  return {
    LookLeft: Math.max(0, -x),
    LookRight: Math.max(0, x),
    LookUp: Math.max(0, y),
    LookDown: Math.max(0, -y),
    LookArcX: Math.abs(x) * lossH - (h * h) / divisor,
    LookArcY: Math.abs(y) * lossV - (v * v) / divisor,
    LookArcXY: (-h * v) / divisor,
    BlinkMid: 1 - Math.abs(2 * blink - 1),
    Blink: Math.max(0, 2 * blink - 1),
  };
}

export function addGlobeGaze(geometry, center, restYaw, restPitch) {
  const sy = Math.sin(restYaw),
    cy = Math.cos(restYaw);
  const sp = Math.sin(restPitch),
    cp = Math.cos(restPitch);
  const shapes = {
    LookLeft: (x, y, z) => [-lossH * x - sinH * z, 0, sinH * x - lossH * z],
    LookRight: (x, y, z) => [-lossH * x + sinH * z, 0, -sinH * x - lossH * z],
    LookUp: (x, y, z) => [0, -lossV * y + sinV * z, -sinV * y - lossV * z],
    LookDown: (x, y, z) => [0, -lossV * y - sinV * z, sinV * y - lossV * z],
    LookArcX: (x, y, z) => [x, 0, z],
    LookArcY: (x, y, z) => [0, y, z],
    LookArcXY: (x, y) => [y, x, 0],
  };
  geometry.morphTargetsRelative = true;
  for (const kind of ["position", "normal"]) {
    const a = geometry.getAttribute(kind),
      origin = kind === "position" ? center : [0, 0, 0];
    const targets = Object.entries(shapes).map(([name, delta]) => {
      const attr = new BufferAttribute(new Float32Array(a.count * 3), 3);
      attr.name = name;
      (geometry.morphAttributes[kind] ??= []).push(attr);
      return [attr, delta];
    });
    for (let i = 0; i < a.count; i++) {
      const u = a.getX(i) - origin[0],
        v = a.getY(i) - origin[1],
        w = a.getZ(i) - origin[2];
      const back = cy * w - sy * u,
        x = cy * u + sy * w,
        y = cp * v + sp * back,
        z = cp * back - sp * v;
      a.setXYZ(i, origin[0] + x, origin[1] + y, origin[2] + z);
      for (const [attr, delta] of targets) attr.setXYZ(i, ...delta(x, y, z));
    }
  }
  return geometry;
}

export function setEyePose(meshes, x = 0, y = 0, blink = 0) {
  const weights = eyeMorphWeights(x, y, blink);
  const entries = Object.entries(weights);
  for (const mesh of meshes) {
    const dictionary = mesh.morphTargetDictionary;
    if (!dictionary) continue;
    for (const [name, value] of entries) {
      if (Object.hasOwn(dictionary, name))
        mesh.morphTargetInfluences[dictionary[name]] = value;
    }
  }
}

// Relative space keeps an expressive eye editable alongside the foundation rig.
export function addEyeMorph(rest, name, target) {
  rest.morphTargetsRelative = true;
  for (const kind of ["position", "normal"]) {
    const start = rest.getAttribute(kind),
      end = target.getAttribute(kind);
    if (!start || !end || start.count !== end.count)
      throw Error("Mismatched eyelid or gaze topology");
    const delta = new Float32Array(start.array.length);
    for (let j = 0; j < delta.length; j++)
      delta[j] = end.array[j] - start.array[j];
    const attr = new BufferAttribute(delta, 3);
    attr.name = name;
    (rest.morphAttributes[kind] ??= []).push(attr);
  }
  target.dispose();
}
