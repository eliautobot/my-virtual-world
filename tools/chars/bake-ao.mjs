// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Ambient occlusion baked into a character's vertices (2026-11-19, the product owner: "the models in-game didn't have much
// lighting/shadows … improved while maintaining performance"): how open each vertex is to the light around it — the
// creases under the arms and the chin, collars, between the layers of clothes, inside sleeves and shoes darker — worked out
// once when a character is baked (tools/chars/crowd-pack.mjs, custom-kind.mjs) and drawn for nothing
// (render/characters.js: its indirect light, and a share of the sun's, times it).
//
// Rays from each vertex over the hemisphere about its normal (cosine-weighted, a fixed set turned per vertex), each a hit
// when a triangle of the meshes round it is met within `reach`, a near hit counting more; a bounding-volume hierarchy over
// the triangles keeps each ray to the few it can meet. Bind pose, metres.

const LEAF = 4;

/** A BVH over triangles (pos: Float32Array xyz, idx: Uint32Array, any number of meshes joined). */
export function buildBVH(meshes) {
  let nt = 0;
  for (const m of meshes) nt += m.idx.length / 3;
  const T = new Float32Array(nt * 9), C = new Float32Array(nt * 3), order = new Uint32Array(nt);
  let t = 0;
  for (const m of meshes) for (let i = 0; i < m.idx.length; i += 3, t++) {
    for (let k = 0; k < 3; k++) { const v = m.idx[i + k] * 3; T[t * 9 + k * 3] = m.pos[v]; T[t * 9 + k * 3 + 1] = m.pos[v + 1]; T[t * 9 + k * 3 + 2] = m.pos[v + 2]; }
    for (let a = 0; a < 3; a++) C[t * 3 + a] = (T[t * 9 + a] + T[t * 9 + 3 + a] + T[t * 9 + 6 + a]) / 3;
    order[t] = t;
  }
  const nodes = [];   // [minx, miny, minz, maxx, maxy, maxz, left|start, right|count, leaf]
  const build = (s, e) => {
    const id = nodes.length; nodes.push(null);
    let b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], cb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) {
      const o = order[i] * 9;
      for (let k = 0; k < 9; k += 3) for (let a = 0; a < 3; a++) { const v = T[o + k + a]; if (v < b[a]) b[a] = v; if (v > b[a + 3]) b[a + 3] = v; }
      for (let a = 0; a < 3; a++) { const v = C[order[i] * 3 + a]; if (v < cb[a]) cb[a] = v; if (v > cb[a + 3]) cb[a + 3] = v; }
    }
    if (e - s <= LEAF) { nodes[id] = [...b, s, e - s, 1]; return id; }
    const ax = [0, 1, 2].reduce((m, a) => (cb[a + 3] - cb[a] > cb[m + 3] - cb[m] ? a : m), 0), mid = (cb[ax] + cb[ax + 3]) / 2;
    let i = s, j = e - 1;
    while (i <= j) { if (C[order[i] * 3 + ax] < mid) i++; else { const x = order[i]; order[i] = order[j]; order[j] = x; j--; } }
    let m = i; if (m === s || m === e) m = (s + e) >> 1;
    const l = build(s, m), r = build(m, e);
    nodes[id] = [...b, l, r, 0];
    return id;
  };
  if (nt) build(0, nt);
  const N = new Float32Array(nodes.length * 9);
  nodes.forEach((n, k) => N.set(n, k * 9));
  return { T, order, N, nt };
}

/** Whether a ray from o along d (unit) meets a triangle within tmax: the nearest hit's distance, or Infinity. */
function nearest(B, ox, oy, oz, dx, dy, dz, tmax, stack) {
  const { T, order, N } = B, ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  let sp = 0, best = tmax;
  stack[sp++] = 0;
  while (sp) {
    const n = stack[--sp] * 9;
    let t0 = ((ix >= 0 ? N[n] : N[n + 3]) - ox) * ix, t1 = ((ix >= 0 ? N[n + 3] : N[n]) - ox) * ix;
    const ty0 = ((iy >= 0 ? N[n + 1] : N[n + 4]) - oy) * iy, ty1 = ((iy >= 0 ? N[n + 4] : N[n + 1]) - oy) * iy;
    if (ty0 > t0) t0 = ty0; if (ty1 < t1) t1 = ty1;
    const tz0 = ((iz >= 0 ? N[n + 2] : N[n + 5]) - oz) * iz, tz1 = ((iz >= 0 ? N[n + 5] : N[n + 2]) - oz) * iz;
    if (tz0 > t0) t0 = tz0; if (tz1 < t1) t1 = tz1;
    if (t0 > t1 || t1 < 0 || t0 > best) continue;
    if (N[n + 8]) {
      const s = N[n + 6], c = N[n + 7];
      for (let i = s; i < s + c; i++) {
        const o = order[i] * 9;
        const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2], e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-12 && det < 1e-12) continue;
        const inv = 1 / det, sx = ox - T[o], sy = oy - T[o + 1], sz = oz - T[o + 2], u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 1e-4 && t < best) best = t;
      }
    } else { stack[sp++] = N[n + 6]; stack[sp++] = N[n + 7]; }
  }
  return best;
}

/** Cosine-weighted directions over the hemisphere about +z (Hammersley), k of them. */
function hemisphere(k) {
  const out = new Float32Array(k * 3);
  for (let i = 0; i < k; i++) {
    let b = i, r = 0, f = 0.5; while (b) { if (b & 1) r += f; b >>= 1; f *= 0.5; }
    const u = (i + 0.5) / k, phi = 2 * Math.PI * r, s = Math.sqrt(u);
    out[i * 3] = Math.cos(phi) * s; out[i * 3 + 1] = Math.sin(phi) * s; out[i * 3 + 2] = Math.sqrt(1 - u);
  }
  return out;
}

/**
 * How open each vertex of a mesh is (1 open, 0 closed in), against `bvh` (the mesh itself and those round it).
 * mesh: { pos, nrm, n }; o: { rays (24), reach (m, 0.22), only (Uint8Array: the vertices to work out; the rest 1) }.
 * → Float32Array per vertex.
 */
export function bakeAO(mesh, bvh, o = {}) {
  const K = o.rays || 24, reach = o.reach || 0.22, H = hemisphere(K), out = new Float32Array(mesh.n).fill(1), stack = new Uint32Array(128);
  if (!bvh.nt) return out;
  const P = mesh.pos, Nn = mesh.nrm;
  for (let v = 0; v < mesh.n; v++) {
    if (o.only && !o.only[v]) continue;
    let nx = Nn[v * 3], ny = Nn[v * 3 + 1], nz = Nn[v * 3 + 2];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // a basis about the normal, turned per vertex (its rays a little different from its neighbours': no banding)
    const a = ((v * 2654435761) >>> 0) / 4294967296 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    let tx = Math.abs(nx) < 0.9 ? 1 : 0, ty = Math.abs(nx) < 0.9 ? 0 : 1, tz = 0;
    let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx; const bl = Math.hypot(bx, by, bz); bx /= bl; by /= bl; bz /= bl;
    tx = by * nz - bz * ny; ty = bz * nx - bx * nz; tz = bx * ny - by * nx;
    const ux = tx * ca + bx * sa, uy = ty * ca + by * sa, uz = tz * ca + bz * sa, wx = bx * ca - tx * sa, wy = by * ca - ty * sa, wz = bz * ca - tz * sa;
    const ox = P[v * 3] + nx * 0.002, oy = P[v * 3 + 1] + ny * 0.002, oz = P[v * 3 + 2] + nz * 0.002;
    let shut = 0;
    for (let i = 0; i < K; i++) {
      const hx = H[i * 3], hy = H[i * 3 + 1], hz = H[i * 3 + 2];
      const dx = ux * hx + wx * hy + nx * hz, dy = uy * hx + wy * hy + ny * hz, dz = uz * hx + wz * hy + nz * hz;
      const t = nearest(bvh, ox, oy, oz, dx, dy, dz, reach, stack);
      if (t < reach) shut += 1 - (t / reach) * 0.6;   // (a near wall closes it in more than a far one)
    }
    out[v] = Math.max(0, 1 - shut / K);
  }
  return out;
}
