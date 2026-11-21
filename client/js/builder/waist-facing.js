// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { BufferAttribute } from "three";

// Return the sewn edge of the waistband. Pockets, tabs, stitching, and the
// two thigh openings may also have boundaries, but only the waist surrounds
// the torso this high. Armor has a second, lower loop on the undersuit.
export function waistbandSeam(geometry, waist) {
  const p = geometry.attributes.position, index = geometry.index;
  const edges = new Map(), n = p.count;
  for (let i = 0; i < index.count; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = index.getX(i + j), b = index.getX(i + (j + 1) % 3);
      if (Math.min(p.getY(a), p.getY(b)) < waist - .025) continue;
      const key = Math.min(a, b) * n + Math.max(a, b);
      if (edges.has(key)) edges.set(key, null);
      else edges.set(key, [a, b, i]);
    }
  }
  const neighbors = new Map();
  for (const edge of edges.values()) {
    if (!edge) continue;
    for (const i of edge.slice(0, 2)) {
      if (!neighbors.has(i)) neighbors.set(i, []);
      neighbors.get(i).push(edge);
    }
  }
  let highest = -Infinity, waistLoop = [];
  const visited = new Set();
  for (const start of neighbors.keys()) {
    if (visited.has(start)) continue;
    const stack = [start], loop = new Set();
    let left = Infinity, right = -Infinity, front = -Infinity, rear = Infinity, sum = 0, count = 0;
    while (stack.length) {
      const i = stack.pop();
      if (visited.has(i)) continue;
      visited.add(i);
      sum += p.getY(i);
      count++;
      left = Math.min(left, p.getX(i));
      right = Math.max(right, p.getX(i));
      front = Math.max(front, p.getZ(i));
      rear = Math.min(rear, p.getZ(i));
      for (const edge of neighbors.get(i)) {
        loop.add(edge);
        stack.push(edge[0] === i ? edge[1] : edge[0]);
      }
    }
    if (left < -.03 && right > .03 && rear < -.02 && front > .02 && sum / count > highest) {
      waistLoop = [...loop];
      highest = sum / count;
    }
  }
  const rim = [...new Set(waistLoop.flatMap(([a, b]) => [a, b]))];
  const turned = new Set();
  // The rolled edge on sewn pants runs up from its open inside edge, over
  // the crest, then back down outside. Fitting the outer rise can flatten
  // those first rows into the exterior, producing intermittent triangles on
  // the front of the band. Track only the rising, interior side of this fold.
  if (rim.length && rim.every(i => Math.abs(p.getY(i) - waist + .005) < .00035)) {
    const next = new Map();
    for (let k = 0; k < index.count; k += 3)
      for (let j = 0; j < 3; j++) {
        let a = index.getX(k + j), b = index.getX(k + (j + 1) % 3);
        if (p.getY(a) > p.getY(b)) [a, b] = [b, a];
        const lo = p.getY(a), hi = p.getY(b);
        if (lo < waist - .0055 || hi > waist + .00003 || hi - lo < .00008) continue;
        if (!next.has(a)) next.set(a, []);
        next.get(a).push(b);
      }
    const stack = rim.slice();
    while (stack.length) {
      const i = stack.pop();
      if (turned.has(i)) continue;
      turned.add(i);
      stack.push(...next.get(i) ?? []);
    }
  }
  return { edges: waistLoop, rim, turned, waist };
}

export function sewWaistFacing(g, { edges, rim, turned, waist }, innerPoint) {
  if (!edges.length) return;
  const original = g.attributes.position;
  for (const i of turned) {
    const x = original.getX(i), y = original.getY(i), z = original.getZ(i);
    const depth = Math.min(.0023, .00045 + 1.2 * (waist - y));
    const scale = 1 - depth / Math.hypot(x, z);
    original.setXYZ(i, x * scale, y, z * scale);
  }
  const outer = g.attributes.position.count;
  const inner = new Map(rim.map((id, i) => [id, outer + i]));
  for (const key of ["position", "skinIndex", "skinWeight"]) {
    const attr = g.attributes[key];
    const data = new attr.array.constructor((outer + rim.length) * attr.itemSize);
    data.set(attr.array);
    for (const [id, dst] of inner) {
      const from = id * attr.itemSize;
      data.set(attr.array.subarray(from, from + attr.itemSize), dst * attr.itemSize);
    }
    g.setAttribute(key, new BufferAttribute(data, attr.itemSize));
  }
  const p = g.attributes.position;
  for (const [id, i] of inner) {
    const point = innerPoint(p.getX(id), p.getY(id), p.getZ(id), i);
    p.setXYZ(i, ...point);
    g.userData.fitParts[i] = "torso";
  }
  const triangles = g.index.array, index = new triangles.constructor(triangles.length + edges.length * 6);
  index.set(triangles);
  for (const [k, [a, b]] of edges.entries()) {
    index.set([b, a, inner.get(a), b, inner.get(a), inner.get(b)], triangles.length + k * 6);
  }
  const face = edges[0][2];
  const material = g.groups.find(({ start, count }) => face >= start && face < start + count);
  g.addGroup(triangles.length, index.length - triangles.length, material.materialIndex);
  g.setIndex(new BufferAttribute(index, 1));
}
