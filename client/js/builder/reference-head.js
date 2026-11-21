// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as THREE from "three";
import packets from "/assets/builder/contiguous-heads.js";

const cache = new Map();
const bytes = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

function decode(packet) {
  const positions = Float32Array.from(
    new Uint16Array(bytes(packet.xyz).buffer),
    (sample, i) => {
      const axis = i % 3;
      return (
        packet.min[axis] +
        ((packet.max[axis] - packet.min[axis]) * sample) / 65535
      );
    },
  );
  const normals = packet.normal16
    ? Float32Array.from(
        new Int16Array(bytes(packet.normal16).buffer),
        (value) => value / 32767,
      )
    : Float32Array.from(new Int8Array(bytes(packet.n).buffer), (v) => v / 127);
  const joints = Uint16Array.from(bytes(packet.j));
  const weights = packet.weight16
    ? Float32Array.from(
        new Uint16Array(bytes(packet.weight16).buffer),
        (value) => value / 65535,
      )
    : Float32Array.from(bytes(packet.w), (v) => v / 255);
  const seam = packet.seamStart;
  if (seam != null) {
    // These shared perimeter positions, weights and normals match the GLB
    // torso in full precision through joint rotation and proportion changes.
    positions.set(new Float32Array(bytes(packet.seamXYZ).buffer), 3 * seam);
    normals.set(new Float32Array(bytes(packet.seamN).buffer), 3 * seam);
    joints.set(bytes(packet.seamJ), 4 * seam);
    weights.set(new Float32Array(bytes(packet.seamW).buffer), 4 * seam);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  g.setAttribute("skinIndex", new THREE.BufferAttribute(joints, 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
  g.setIndex(
    new THREE.BufferAttribute(new Uint16Array(bytes(packet.tri).buffer), 1),
  );
  g.userData.ao = packet.ao
    ? bytes(packet.ao)
    : new Uint8Array(positions.length / 3).fill(255);
  if (seam != null) {
    g.userData.neutralPinna = true;
    g.userData.seamStart = seam;
    g.userData.ringSegments = packet.ringSegments;
  }
  return g;
}

export const headLandmarks = {
  female: {
    eyeX: 0.0236,
    eyeY: 0.9037,
    noseY: 0.8835,
    mouthY: 0.8635,
    browY: 0.9255,
  },
  male: {
    eyeX: 0.0213,
    eyeY: 0.9219,
    noseY: 0.8977,
    mouthY: 0.8791,
    browY: 0.94,
  },
};

export function getReferenceHead(gender) {
  if (!cache.has(gender)) {
    const packet = packets[gender];
    cache.set(gender, {
      skin: decode(packet.skin),
      nose: packet.nose ? decode(packet.nose) : null,
    });
  }
  return cache.get(gender);
}
