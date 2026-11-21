#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The crowd's parts library (2026-11-19, prototype: "unique characters for the population without a major performance
// cost"): from the character builder (client/js/builder/, its kits: client/dev/builder-kit.html), for each body —
// - its animation, baked once (tools/chars/custom-kind.mjs on the bare body: every clip the city plays, its grips, head
//   and seats), shared by every part and every resident drawn with it;
// - the body itself (bare: skin under clothes is pulled in by the shader where the clothes worn cover it, see coverage);
// - a library of heads (faces), hairstyles, beards, tops, bottoms and shoes, each a small mesh of its own on the same
//   skeleton, at three levels of detail; a resident wears one of each (render/characters.js crowd).
// Colours: each part is exported twice, once with the reference colours (REF) and once with each key colour darkened by
// its own factor; a vertex whose colour changed is tinted per resident by that key (skin, hair, eyes, top, bottom, shoes:
// the resident's own colours), the rest keeps its colour. Coverage: a garment exported alone drops the skin it covers,
// and the skin it wholly encloses (rays from the skin all meet it from inside: rayCover) — those body (and neck) vertices
// carry the garment's bit; when it is worn the renderer leaves out the skin wholly under it and pulls in the edge's.
// Usage: node tools/chars/crowd-pack.mjs --url http://<host>:<port> (a server of this tree) [--out client/assets/crowd]
//        [--sexes female,male] [--seed 7] [--small] (a few of each, for a quick look)
//        [--bake '{"near":0.0006,"middle":0.004,"far":0.012}'] (each level's error in metres, the studio's; else budgets)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { decodeKit } from '../../shared/char-kit.js';
import { buildKind, SCALE } from './custom-kind.mjs';
import { faceTags } from './face-tags.mjs';
import { buildBVH, bakeAO } from './bake-ao.mjs';
// (rayCover's: tilted 35° from a skin vertex's normal, four ways, besides the normal itself)
const COVER_TILT = Math.sin(35 * Math.PI / 180), COVER_UP = Math.cos(35 * Math.PI / 180);
/** The nearest triangle a ray from o along d meets within tmax, and whether it is met from behind (the ray going the way
 *  its face looks: from inside a garment): → [distance or Infinity, 1 from behind | 0]. (bake-ao.mjs's BVH) */
function hitFacing(B, ox, oy, oz, dx, dy, dz, tmax, stack) {
  const { T, order, N } = B, ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  let sp = 0, best = tmax, back = 0;
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
      const st = N[n + 6], c = N[n + 7];
      for (let i = st; i < st + c; i++) {
        const o = order[i] * 9;
        const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2], e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-12 && det < 1e-12) continue;
        const inv = 1 / det, sx = ox - T[o], sy = oy - T[o + 1], sz = oz - T[o + 2], u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > 1e-4 && t < best) { best = t; back = det < 0 ? 1 : 0; }
      }
    } else { stack[sp++] = N[n + 6]; stack[sp++] = N[n + 7]; }
  }
  return [best, back];
}
/** Meshes as one graph over the surface, a position one node (a seam's copies, the body's and the head's at the neck,
 *  joined): → { N, keys (node → position key), node (per mesh: vertex → node), off/nbr/len (edges, metres) }. */
function surfaceGraph(meshes) {
  const ids = new Map(), keys = [], node = [], pos = [];
  for (const M of meshes) {
    const a = new Int32Array(M.n);
    for (let v = 0; v < M.n; v++) { const k = key(M.pos[v * 3], M.pos[v * 3 + 1], M.pos[v * 3 + 2]); let i = ids.get(k); if (i === undefined) { i = keys.length; ids.set(k, i); keys.push(k); pos.push(M.pos[v * 3], M.pos[v * 3 + 1], M.pos[v * 3 + 2]); } a[v] = i; }
    node.push(a);
  }
  const N = keys.length, edges = new Map();
  meshes.forEach((M, m) => { for (let i = 0; i < M.idx.length; i += 3) for (let e = 0; e < 3; e++) { const a = node[m][M.idx[i + e]], b = node[m][M.idx[i + (e + 1) % 3]]; if (a !== b) edges.set(a < b ? a * N + b : b * N + a, 1); } });
  const deg = new Int32Array(N + 1);
  for (const k of edges.keys()) { deg[Math.floor(k / N)]++; deg[k % N]++; }
  const off = new Int32Array(N + 1); for (let i = 0; i < N; i++) off[i + 1] = off[i] + deg[i];
  const nbr = new Int32Array(off[N]), len = new Float32Array(off[N]), at = off.slice(0, N);
  for (const k of edges.keys()) { const a = Math.floor(k / N), b = k % N, l = Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]); nbr[at[a]] = b; len[at[a]++] = l; nbr[at[b]] = a; len[at[b]++] = l; }
  return { N, keys, node, off, nbr, len };
}
/** Each node's distance along the surface (m) to the nearest source node (Dijkstra, a binary heap). */
function surfaceDistance(G, source) {
  const d = new Float32Array(G.N).fill(Infinity), heap = [], push = (n, x) => { heap.push([x, n]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (let n = 0; n < G.N; n++) if (source(n)) { d[n] = 0; push(n, 0); }
  while (heap.length) { const [x, n] = pop(); if (x > d[n]) continue; for (let e = G.off[n]; e < G.off[n + 1]; e++) { const m = G.nbr[e], y = x + G.len[e]; if (y < d[m]) { d[m] = y; push(m, y); } } }
  return d;
}
/** How deep under the clothes skin must lie to be left out (m along the surface from the nearest skin a garment leaves
 *  bare: its collar, cuffs, hem). Nearer an opening it is drawn, pulled in (tuck): a collar or a hem moves off the skin
 *  as the body bends, sits or turns its head, and skin, not a hole, shows (2026-11-20: empty necks and waists). */
const DEEP = { top: 0.07, bottom: 0.07, shoes: 0.03 };
/** Bits (per position key) of what lies deep under each garment, from its coverage bits: → Map key → bits. */
function deepBitsOf(G, bitsAt, D) {
  const out = new Map(); let all = 0;
  for (let n = 0; n < G.N; n++) all |= bitsAt(n);
  for (let b = 0; b < 24; b++) {
    if (!(all & (1 << b))) continue;
    const d = surfaceDistance(G, n => !(bitsAt(n) & (1 << b)));
    for (let n = 0; n < G.N; n++) if (d[n] > D) out.set(G.keys[n], (out.get(G.keys[n]) || 0) | (1 << b));
  }
  return out;
}
import { normalizeTuning, BAKE_LEVELS, BAKE_WEIGHTS, bakeFlags } from '../../shared/crowd-tuning.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);
const { launch } = require('../lib/browser.cjs');
const { values: o } = parseArgs({ options: { url: { type: 'string' }, out: { type: 'string' }, sexes: { type: 'string' }, seed: { type: 'string' }, small: { type: 'boolean' }, bake: { type: 'string' } } });
// the detail each level keeps, as the owner set it in the Crowd Studio (shared/crowd-tuning.js bake: metres of error a level;
// a level not given keeps its budget), within four times the budgets (the crowd stays drawable)
const BAKE = o.bake ? normalizeTuning({ bake: JSON.parse(o.bake) }).bake : null;
// (baked occlusion: not drawn — 2026-11-19, the owner reverted the characters' lighting — so not worked out; the module
// stays, tools/chars/bake-ao.mjs, for another try)
const OCCLUSION = false;
const OUT = path.resolve(o.out || path.join(ROOT, 'client/assets/crowd'));
const SEXES = (o.sexes || 'female,male').split(',');
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ what the library holds
/** How many of each, per body (the first of each list is the reference worn while the others are exported). */
const COUNT = o.small ? { head: 3, hair: 3, beard: 2, top: 4, bottom: 3, shoes: 3 } : { head: 10, hair: 15, beard: 6, top: 18, bottom: 14, shoes: 10 };
/** Each part's budget (vertices) at each level of detail; triangles may be about twice. */
const BUDGET = { body: [5600, 1500, 550], head: [6000, 1900, 420], hair: [2600, 650, 180], beard: [1200, 300, 80], top: [3800, 950, 300], bottom: [2800, 700, 220], shoes: [1100, 280, 90] };
/** At a distance (levels 1 and 2) a part is drawn as one of a few look-alikes of its kind (by shape and what it covers):
 *  fewer models to draw for a crowd seen from further away, with each resident's own colours still. */
const FAR = { 1: { head: 3, hair: 6, beard: 2, top: 6, bottom: 5, shoes: 3 }, 2: { head: 1, hair: 3, beard: 1, top: 3, bottom: 3, shoes: 1 } };
/** The residents' feet (the builder's foot size: 0.7–1.05, 1 its source's): 85%, each resident's within 80–90% by the
 *  shader (render/characters.js uFeet; 2026-11-19, the product owner: "some have huge feet"). */
const FEET = 0.85;
const ROLES = { body: ['body'], head: ['base', 'ears', 'eyes', 'lid', 'brows', 'nose', 'mouth', 'lashes'], hair: ['hair'], beard: ['beard'], top: ['top'], bottom: ['bottom'], shoes: ['shoes'] };
/** Reference colours (sRGB) and the factor (linear) each key is darkened by in the second export. A part's vertex tinted
 *  by key k is drawn as its exported colour × resident's colour ÷ REF[k] (render/characters.js chTint). */
const KEYS = ['skin', 'hair', 'eyes', 'top', 'bottom', 'shoes'];
const REF = { skin: '#d8a888', hair: '#a88a6a', eyes: '#7a6050', top: '#c8c8c8', bottom: '#c8c8c8', shoes: '#c8c8c8', mouth: '#c4806e' };
const DARK = { skin: 0.85, hair: 0.7, eyes: 0.55, top: 0.45, bottom: 0.35, shoes: 0.25 };
const lin = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const srgb = v => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const hex2 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const darker = (h, f) => '#' + hex2(h).map(c => Math.round(srgb(lin(c) * f) * 255).toString(16).padStart(2, '0')).join('');
const colours = dark => {
  const c = {};
  for (const k of KEYS) c[k] = dark ? darker(REF[k], DARK[k]) : REF[k];
  c.mouth = dark ? darker(REF.mouth, DARK.skin) : REF.mouth;   // (the lips follow the skin)
  c.brows = null; c.beard = null; c.nose = null; c.ears = null;   // (brows and beard follow the hair, nose and ears the skin)
  return c;
};
/** A small seeded random (the library's picks repeat run after run). */
function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)), ((s ^= s >>> 16) >>> 0) / 4294967296); }
/** n of a list spread across it (the list's own order), never twice. */
const spread = (list, n) => { if (list.length <= n) return list.slice(); const out = []; for (let k = 0; k < n; k++) out.push(list[Math.floor((k + 0.5) * list.length / n)]); return [...new Set(out)]; };
// Tops kept out of the crowd: layered pieces that clip and warp once animated (the quilted gilet over its jersey,
// 2026-11-19). Each is swapped for its nearest neighbour in the catalogue not already picked, so the rest of the pick
// (what the spread chose) stays as it was.
const AVOID = /gilet|quilted/i;
const swapOut = (list, chosen, bad) => {
  const taken = new Set(chosen);
  return chosen.map((id) => {
    if (!bad.has(id)) return id;
    const at = list.indexOf(id);
    for (let d = 1; d < list.length; d++) for (const j of [at + d, at - d]) {
      const c = list[j];
      if (c !== undefined && !bad.has(c) && !taken.has(c)) { taken.add(c); return c; }
    }
    return null;
  }).filter((id) => id !== null);
};

// ------------------------------------------------------------------ a part from a kit
/** The kit's parts of these roles joined, in metres: { n, pos, nrm, uv, col, j, w, lid, idx, base: Uint8Array (a vertex of the head's 'base'), names }. */
function joined(kit) {
  let n = 0, t = 0; for (const p of kit.parts) { n += p.pos.length / 3; t += p.idx.length / 3; }
  const M = { n, pos: new Float32Array(n * 3), nrm: new Float32Array(n * 3), uv: new Float32Array(n * 2).fill(-1), col: new Uint8Array(n * 4), j: new Uint8Array(n * 4), w: new Uint8Array(n * 4), lid: new Float32Array(n).fill(-1), idx: new Uint32Array(t * 3), skinRole: new Uint8Array(n), names: [], roles: [], partOf: new Uint16Array(n), rm: new Uint8Array(n * 2) };
  let v0 = 0, t0 = 0;
  for (const p of kit.parts) {
    const pn = p.pos.length / 3, pt = p.idx.length / 3;
    for (let i = 0; i < pn * 3; i++) M.pos[v0 * 3 + i] = p.pos[i] * SCALE;
    M.nrm.set(p.nrm, v0 * 3); if (p.uv) M.uv.set(p.uv, v0 * 2); M.col.set(p.col, v0 * 4); M.j.set(p.j, v0 * 4);
    if (p.rm) M.rm.set(p.rm, v0 * 2); else for (let i = 0; i < pn; i++) { M.rm[(v0 + i) * 2] = 204; M.rm[(v0 + i) * 2 + 1] = 0; }   // (a kit without its finish: matte)
    for (let i = 0; i < pn; i++) {
      const ws = [0, 1, 2, 3].map(q => p.w[i * 4 + q]), s = ws.reduce((a, b) => a + b, 0) || 1, qn = ws.map(x => Math.round(x * 255 / s));
      qn[qn.indexOf(Math.max(...qn))] += 255 - qn.reduce((a, b) => a + b, 0); M.w.set(qn, (v0 + i) * 4);
      if (p.lid) M.lid[v0 + i] = p.lid[i] >= 0 ? p.lid[i] * SCALE : -1;
      if (p.role === 'body' || p.role === 'base') M.skinRole[v0 + i] = 1;
      M.partOf[v0 + i] = M.names.length;
    }
    for (let i = 0; i < pt * 3; i++) M.idx[t0 * 3 + i] = p.idx[i] + v0;
    M.names.push(p.name); M.roles.push(p.role); v0 += pn; t0 += pt;
  }
  return M;
}
/** The keys a part's colours may follow (a top's trim, darker than the top, is still the top's — never the eyes'). */
const ALLOWED = { body: ['skin'], head: ['skin', 'hair', 'eyes'], hair: ['hair'], beard: ['hair'], top: ['top', 'bottom', 'shoes'], bottom: ['top', 'bottom', 'shoes'], shoes: ['top', 'bottom', 'shoes'] };
/** Each vertex's tint key (1 + KEYS index, 0: its own colour) from the two exports' colours. */
function tints(A, B, cat) {
  if (A.n !== B.n) throw new Error(`exports differ (${A.n} / ${B.n} vertices)`);
  const out = new Uint8Array(A.n), f = KEYS.map(k => (ALLOWED[cat].includes(k) ? DARK[k] : 1e9));
  for (let v = 0; v < A.n; v++) {
    let s = 0, c = 0;
    for (let q = 0; q < 3; q++) { const a = lin(A.col[v * 4 + q] / 255), b = lin(B.col[v * 4 + q] / 255); if (a > 0.015) { s += b / a; c++; } }
    if (!c) continue;
    const r = s / c;
    if (Math.abs(r - 1) < 0.04) continue;
    let best = 0, bd = 1e9; f.forEach((x, k) => { const d = Math.abs(r - x); if (d < bd) { bd = d; best = k; } });
    if (bd < 0.25) out[v] = best + 1;   // (a shade mixed with a fixed colour changes less: still that key's)
  }
  return out;
}
const key = (x, y, z) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
/** The positions of the vertices still used by the kit's triangles. */
function usedPositions(M) {
  const used = new Uint8Array(M.n), out = new Set();
  for (const v of M.idx) used[v] = 1;
  for (let v = 0; v < M.n; v++) if (used[v]) out.add(key(M.pos[v * 3], M.pos[v * 3 + 1], M.pos[v * 3 + 2]));
  return out;
}

// ------------------------------------------------------------------ levels of detail
let S = null;
async function simplifier() { if (!S) { S = (await import('meshoptimizer')).MeshoptSimplifier; await S.ready; } return S; }
/** Three levels within their budgets (vertices; triangles twice), each made from the one before; locked vertices stay
 *  (the seam between the body and the head). → [index runs] per level, into M's own vertices. */
async function levels(M, budget, lock = null) {
  const S = await simplifier(), attrs = new Float32Array(M.n * 6);
  for (let v = 0; v < M.n; v++) { for (let q = 0; q < 3; q++) attrs[v * 6 + q] = M.col[v * 4 + q] / 255; for (let q = 0; q < 3; q++) attrs[v * 6 + 3 + q] = M.nrm[v * 3 + q]; }
  const W = BAKE_WEIGHTS, mark = new Uint32Array(M.n);
  let stamp = 0, cur = M.idx;
  const out = [];
  for (let L = 0; L < 3; L++) {
    // (the owner's detail for this level: its error, the result within four times the budget — else the budget's search)
    const err = BAKE?.[['near', 'middle', 'far'][L]], k = err != null ? 4 : 1;
    const maxV = budget[L] * k, maxT = budget[L] * 2 * k;
    const fits = ix => { stamp++; let v = 0; for (let i = 0; i < ix.length; i++) if (mark[ix[i]] !== stamp) { mark[ix[i]] = stamp; v++; } return v <= maxV && ix.length / 3 <= maxT; };
    if (err != null) { const r = S.simplifyWithAttributes(cur, M.pos, 3, attrs, 6, W, lock, 3, err, bakeFlags(err))[0]; if (fits(r)) { out.push(r); cur = r; continue; } }
    let best = cur;
    if (!fits(cur)) {
      for (const flags of [L === 0 ? ['ErrorAbsolute'] : ['ErrorAbsolute', 'Prune'], ['ErrorAbsolute', 'Prune', 'Permissive']]) {
        const at = err => S.simplifyWithAttributes(cur, M.pos, 3, attrs, 6, W, lock, 3, err, flags)[0];
        let lo = 1e-5, hi = 0.1, b = at(hi);
        for (let k = 0; k < 12; k++) { const mid = Math.sqrt(lo * hi), r = at(mid); if (!fits(r)) lo = mid; else { hi = mid; b = r; } }
        best = b; if (fits(b)) break;
      }
      if (!fits(best)) { let target = Math.floor(maxT * 3 / 3) * 3; for (let k = 0; k < 20 && !fits(best); k++) { best = S.simplifySloppy(cur, M.pos, 3, lock, target, 1)[0]; target = Math.floor(target * 0.85 / 3) * 3; } }
    }
    out.push(best); cur = best;
  }
  return out;
}

/** The close-up level (the owner's bake.close, an error in metres): from the full mesh, within four times the near level's
 *  budget (else the coarsest that fits) — only the few residents nearest the camera are drawn with it. → index run. */
async function closeLevel(M, budget, lock = null) {
  const S = await simplifier(), err = BAKE?.close;
  if (err == null) return null;
  const attrs = new Float32Array(M.n * 6);
  for (let v = 0; v < M.n; v++) { for (let q = 0; q < 3; q++) attrs[v * 6 + q] = M.col[v * 4 + q] / 255; for (let q = 0; q < 3; q++) attrs[v * 6 + 3 + q] = M.nrm[v * 3 + q]; }
  const mark = new Uint32Array(M.n), maxV = budget[0] * 4; let stamp = 0;
  const fits = ix => { stamp++; let v = 0; for (let i = 0; i < ix.length; i++) if (mark[ix[i]] !== stamp) { mark[ix[i]] = stamp; v++; } return v <= maxV && ix.length / 3 <= maxV * 2; };
  let e = err, r = S.simplifyWithAttributes(M.idx, M.pos, 3, attrs, 6, BAKE_WEIGHTS, lock, 3, e, bakeFlags(e))[0];
  for (let k = 0; !fits(r) && k < 14; k++) { e *= 1.5; r = S.simplifyWithAttributes(M.idx, M.pos, 3, attrs, 6, BAKE_WEIGHTS, lock, 3, e, bakeFlags(e))[0]; }
  return r;
}

/**
 * A head's levels with its eyes apart (2026-11-20, the product owner: eyes flickering on people walking): simplified with
 * the rest of the face, an eye's globe — sclera, iris and pupil, layers a millimetre apart — came apart at the middle
 * level (its sclera through its iris: a jagged eye that changes as the head moves), seen since the levels go by the size on
 * the screen (the middle level from ~14 m). The eyes (face tags 6, 7) are simplified on their own, within EYE_ERR at the
 * near and middle levels (their layers kept apart), whole at the close-up level, left out at the far level (a few pixels);
 * the rest of the head as any part. → { L: [index runs], CL }.
 */
const EYE_ERR = 0.0004;
async function headLevels(M, budget, lock = null) {
  const eye = [], rest = [];
  for (let i = 0; i < M.idx.length; i += 3) {
    const a = M.idx[i], b = M.idx[i + 1], c = M.idx[i + 2];
    if (!(M.face[a] >= 6 && M.face[b] >= 6 && M.face[c] >= 6)) { rest.push(a, b, c); continue; }
    // (the back of an eye's globe, inside the head, never seen — even as it glances about — left out)
    const P = v => [M.pos[v * 3], M.pos[v * 3 + 1], M.pos[v * 3 + 2]], A = P(a), B = P(b), C = P(c);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz) || 1;
    if (nz / nl > -0.35) eye.push(a, b, c);
  }
  if (!eye.length) return { L: await levels(M, budget, lock), CL: await closeLevel(M, budget, lock) };
  const S = await simplifier(), attrs = new Float32Array(M.n * 6);
  for (let v = 0; v < M.n; v++) { for (let q = 0; q < 3; q++) attrs[v * 6 + q] = M.col[v * 4 + q] / 255; for (let q = 0; q < 3; q++) attrs[v * 6 + 3 + q] = M.nrm[v * 3 + q]; }
  const E = Uint32Array.from(eye), eyes = S.simplifyWithAttributes(E, M.pos, 3, attrs, 6, BAKE_WEIGHTS, null, 3, EYE_ERR, ['ErrorAbsolute'])[0];
  // (the rest of the head within what the budget leaves after the eyes, at the levels that draw them)
  const ev = new Set(eyes).size, R = { ...M, idx: Uint32Array.from(rest) }, rb = budget.map((b, i) => (i < 2 ? Math.max(b - ev, Math.round(b / 2)) : b));
  const L = await levels(R, rb, lock), CL = await closeLevel(R, budget, lock);
  const join = (a, b) => { const o = new Uint32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
  return { L: L.map((ix, li) => (li < 2 ? join(ix, eyes) : ix)), CL: CL ? join(CL, E) : null };
}

// ------------------------------------------------------------------ the files
class Bin {
  constructor() { this.chunks = []; this.off = 0; }
  add(arr, type, shape) {
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), at = this.off;
    this.chunks.push(b); this.off += b.length;
    const pad = (4 - (this.off % 4)) % 4; if (pad) { this.chunks.push(Buffer.alloc(pad)); this.off += pad; }
    return { off: at, len: b.length, type, shape };
  }
  buffer() { return Buffer.concat(this.chunks); }
}
/** A level of a part as render/characters.js reads a model's: its vertices (those its triangles use), with the tint key
 *  in mask.x, a head's face for its motion in mask.yzw (faceTags), coverage (cat 9 in info.y: top bits in cov.x, bottom bits in cov.y, shoes bits in info.z), eyelids. */
function lodEntry(bin, M, ix, extra) {
  const remap = new Int32Array(M.n).fill(-1); let n = 0;
  for (const v of ix) if (remap[v] < 0) remap[v] = n++;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Uint8Array(n * 4), j = new Uint8Array(n * 4), w = new Uint8Array(n * 4);
  const mask = new Uint8Array(n * 4), limb = new Float32Array(n * 2), info = new Float32Array(n * 3), cov = new Float32Array(n * 2), deep = extra.cov?.deep ? new Float32Array(n * 3) : null;
  for (let v = 0; v < M.n; v++) {
    const k = remap[v]; if (k < 0) continue;
    for (let q = 0; q < 3; q++) { pos[k * 3 + q] = M.pos[v * 3 + q]; nrm[k * 3 + q] = M.nrm[v * 3 + q]; }
    uv[k * 2] = M.uv[v * 2]; uv[k * 2 + 1] = M.uv[v * 2 + 1];
    for (let q = 0; q < 4; q++) { col[k * 4 + q] = M.col[v * 4 + q]; j[k * 4 + q] = M.j[v * 4 + q]; w[k * 4 + q] = M.w[v * 4 + q]; }
    // its light, in room the model has (no attribute more to draw — render/characters.js): how open it is (baked ambient
    // occlusion) in limb.y; its material's finish in col.a with the normal map's flag — bit 0 the flag, bit 1 metal, bits
    // 2–7 its roughness
    limb[k * 2 + 1] = M.ao ? Math.max(0, Math.min(1, M.ao[v])) : 1;
    col[k * 4 + 3] = (M.col[v * 4 + 3] > 127 ? 1 : 0) | (M.rm[v * 2 + 1] > 76 ? 2 : 0) | (Math.round(M.rm[v * 2] / 255 * 63) << 2);
    mask[k * 4] = extra.tint[v];
    if (M.face?.[v]) { mask[k * 4 + 1] = M.face[v]; mask[k * 4 + 2] = Math.round(M.faceU[v] * 255); mask[k * 4 + 3] = Math.round(M.faceW[v] * 255); }
    if (M.lid[v] >= 0) { info[k * 3] = 11; limb[k * 2] = M.lid[v]; }
    else if (extra.cov && (extra.cov.top[v] || extra.cov.bottom[v] || extra.cov.shoes[v])) {
      info[k * 3 + 1] = 9; cov[k * 2] = extra.cov.top[v]; cov[k * 2 + 1] = extra.cov.bottom[v]; info[k * 3 + 2] = extra.cov.shoes[v];
      // (what lies deep under them: left out where a whole triangle does — render/characters.js)
      if (deep) { const D = extra.cov.deep; deep[k * 3] = D.top[v]; deep[k * 3 + 1] = D.bottom[v]; deep[k * 3 + 2] = D.shoes[v]; }
    }
  }
  const idx = n < 65536 ? Uint16Array.from(ix, v => remap[v]) : Uint32Array.from(ix, v => remap[v]);
  return {
    verts: n, tris: ix.length / 3,
    pos: bin.add(pos, 'float32', [n, 3]), nrm: bin.add(nrm, 'float32', [n, 3]), j: bin.add(j, 'uint8', [n, 4]), w: bin.add(w, 'uint8', [n, 4]),
    mask: bin.add(mask, 'uint8', [n, 4]), limb: bin.add(limb, 'float32', [n, 2]), info: bin.add(info, 'float32', [n, 3]), cov: bin.add(cov, 'float32', [n, 2]),
    idx: bin.add(idx, idx instanceof Uint16Array ? 'uint16' : 'uint32', [idx.length]), uv: bin.add(uv, 'float32', [n, 2]), col: bin.add(col, 'uint8', [n, 4]),
    ...(deep ? { deep: bin.add(deep, 'float32', [n, 3]) } : {}),
  };
}

// ------------------------------------------------------------------ one body's library
async function pack(page, sex, seed) {
  const t0 = Date.now(), log = (...a) => console.log(`[${sex} ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
  const cat = await page.evaluate(g => window.__open(g), sex), R = rng(seed);
  const styles = k => cat.styles[k] || [], piece = (k, i) => cat.pieces[k]?.[styles(k).findIndex(([x]) => x === i)] || null;
  // the picks: tops without the armour (a costume, not a resident's), at most two dresses; the beards' library only
  const pick = {
    hair: spread(styles('hair').filter(([, n]) => !/helmet|android|cuirass/i.test(n)).map(([i]) => i), COUNT.hair),
    // (no armour — a costume, not a resident's — nor the quilted gilet over a jersey, swapped for a neighbour: AVOID)
    top: (() => { const ok = styles('top').filter(([i, n]) => !/cuirass|armou?r/i.test(n) && piece('top', i)?.cut !== 'armor'); const dresses = ok.filter(([i]) => piece('top', i)?.dress).slice(0, 2); const rest = ok.filter(([i]) => !piece('top', i)?.dress); const ids = rest.map(([i]) => i), bad = new Set(rest.filter(([, n]) => AVOID.test(n)).map(([i]) => i)); return [...swapOut(ids, spread(ids, COUNT.top - dresses.length), bad), ...dresses.map(([i]) => i)]; })(),
    bottom: spread(styles('bottom').map(([i]) => i), COUNT.bottom),
    shoes: spread(styles('shoes').map(([i]) => i), COUNT.shoes),
    beard: sex === 'male' ? spread(styles('beard').map(([i]) => i), COUNT.beard) : [],
  };
  // heads: the face's libraries mixed (seeded); the first is the reference worn while everything else is exported
  const faceSlots = ['eyes', 'brows', 'nose', 'mouth', 'ears', ...(sex === 'female' ? ['lashes'] : [])];
  const base = { ...cat.state.selections, top: -1, bottom: -1, shoes: -1, detail: -1, ...(sex === 'male' ? { beard: -1 } : { lashes: -1 }), hair: pick.hair[0] };
  const heads = [{}];
  for (let h = 1; h < COUNT.head; h++) { const sel = {}; for (const k of faceSlots) { const s = styles(k); if (s.length) sel[k] = s[Math.floor(R() * s.length)][0]; } heads.push(sel); }
  const preset = (sel, dark = false) => ({ gender: sex, shape: { feet: FEET }, selections: { ...base, ...sel }, colors: colours(dark) });
  const exportK = async (sel, roles, dark = false) => decodeKit(Buffer.from(await page.evaluate(([p, r]) => window.__export(p, r), [preset(sel, dark), roles]), 'base64'));
  const pair = async (sel, cat) => { const A = joined(await exportK(sel, ROLES[cat])), B = joined(await exportK(sel, ROLES[cat], true)); return { M: A, tint: tints(A, B, cat) }; };

  // 1. the animation: the bare body with its reference head and hair, baked as a built character is
  log('animation…');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-crowd-')), full = await exportK({}, null);
  const id = 'c_' + crypto.createHash('sha256').update(`${sex}:${seed}:crowd`).digest('hex').slice(0, 16);
  const baked = await buildKind(full, { id, out: tmp });
  const man0 = baked.man, bin0 = fs.readFileSync(path.join(tmp, id + '.bin'));
  fs.rmSync(tmp, { recursive: true, force: true });
  // 2. the body and the reference head (their seam locked), and what each garment worn alone leaves of their skin
  log('body…');
  const body = await pair({}, 'body'), head0 = await pair({}, 'head');
  for (let v = 0; v < body.M.n; v++) if (body.M.skinRole[v]) body.tint[v] = 1;   // (bare skin: always the resident's)
  const garments = {}, covBits = {};
  for (const g of ['top', 'bottom', 'shoes']) {
    covBits[g] = new Map();   // position → bits of the garments of this kind that cover it
    garments[g] = [];
    for (const [b, i] of pick[g].entries()) {
      const alone = joined(await exportK({ [g]: i }, ['body', 'base'])), left = usedPositions(alone);
      let covered = 0;
      for (const M of [body.M, head0.M]) for (let v = 0; v < M.n; v++) {
        if (!M.skinRole[v]) continue;
        const k = key(M.pos[v * 3], M.pos[v * 3 + 1], M.pos[v * 3 + 2]);
        if (!left.has(k)) { covBits[g].set(k, (covBits[g].get(k) || 0) | (1 << b)); covered++; }
      }
    }
  }
  /** The neck and shoulders' skin (the head's 'base', which the builder never drops) under top b's collar and shoulders:
   *  each of its vertices up to the neck's middle with the top's surface within 2.5 cm outside it gets the top's bit — pulled
   *  in under it as the body's covered skin is (2026-11-19: the neck showed through collars). */
  const neckY = full.joints[38 * 3 + 1] * SCALE, headY = full.joints[39 * 3 + 1] * SCALE, upTo = neckY + (headY - neckY) * 0.5;
  /** Which of mesh I's vertices (those `only` allows) lie under mesh O: O's surface within `reach` metres of it, on its
   *  outer side. → Uint8Array (1: under). */
  const under = (I, O, reach, only = null) => {
    const cell = reach, grid = new Map(), g = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    for (let v = 0; v < O.n; v++) { const k = g(O.pos[v * 3], O.pos[v * 3 + 1], O.pos[v * 3 + 2]); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(v); }
    const out = new Uint8Array(I.n);
    for (let v = 0; v < I.n; v++) {
      if (only && !only(v)) continue;
      const x = I.pos[v * 3], y = I.pos[v * 3 + 1], z = I.pos[v * 3 + 2], nx = I.nrm[v * 3], ny = I.nrm[v * 3 + 1], nz = I.nrm[v * 3 + 2];
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      let hit = false;
      for (let a = -1; a <= 1 && !hit; a++) for (let b2 = -1; b2 <= 1 && !hit; b2++) for (let c = -1; c <= 1 && !hit; c++) for (const t of grid.get(`${cx + a},${cy + b2},${cz + c}`) || []) {
        const dx = O.pos[t * 3] - x, dy = O.pos[t * 3 + 1] - y, dz = O.pos[t * 3 + 2] - z;
        if (dx * dx + dy * dy + dz * dz < reach * reach && dx * nx + dy * ny + dz * nz > -0.002) { hit = true; break; }
      }
      out[v] = hit ? 1 : 0;
    }
    return out;
  };
  const neckUnder = (T, b) => {
    const H = head0.M, u = under(H, T.M ?? T, 0.025, v => H.skinRole[v] && H.pos[v * 3 + 1] <= upTo);
    for (let v = 0; v < H.n; v++) if (u[v]) { const k = key(H.pos[v * 3], H.pos[v * 3 + 1], H.pos[v * 3 + 2]); covBits.top.set(k, (covBits.top.get(k) || 0) | (1 << b)); }
  };
  /** Garment b of kind g: the set of the body's vertices it covers (its bit in covBits). */
  const coverSet = (g, b) => { const out = new Set(); for (const [k, bits] of covBits[g]) if (bits & (1 << b)) out.add(k); return out; };
  let deepBits = null;   // (per kind: position key → bits of the garments it lies deep under; after the coverage)
  let covBroad = null;   // (per kind: position key → bits — the skin under each garment as it stands, the bind pose)
  /** A skin mesh's coverage for its levels: the near and close-up levels' (seen up close: under each garment in every
   *  pose, left out only deep under it), and far: the lighter levels' (seen from 14 m and more, their clothes simplified:
   *  all the skin under each garment as it stands, all of it left out — a few centimetres' gap unseen from there, the skin
   *  through the clothes not). */
  const coverOf = M => {
    const z = () => ({ top: new Float32Array(M.n), bottom: new Float32Array(M.n), shoes: new Float32Array(M.n) });
    const c = { ...z(), deep: z(), far: { ...z(), deep: null } };
    for (let v = 0; v < M.n; v++) {
      if (!M.skinRole[v]) continue;
      const k = key(M.pos[v * 3], M.pos[v * 3 + 1], M.pos[v * 3 + 2]);
      for (const g of ['top', 'bottom', 'shoes']) { c[g][v] = covBits[g].get(k) || 0; c.deep[g][v] = deepBits?.[g].get(k) || 0; c.far[g][v] = (covBroad?.[g].get(k) || 0) | c[g][v]; }
    }
    c.far.deep = { top: c.far.top, bottom: c.far.bottom, shoes: c.far.shoes };
    return c;
  };
  // the seam between body and head: their shared positions, locked in both
  const bodyKeys = new Set(); for (let v = 0; v < body.M.n; v++) bodyKeys.add(key(body.M.pos[v * 3], body.M.pos[v * 3 + 1], body.M.pos[v * 3 + 2]));
  const seamLock = M => { const l = new Uint8Array(M.n); for (let v = 0; v < M.n; v++) if (M.skinRole[v] && bodyKeys.has(key(M.pos[v * 3], M.pos[v * 3 + 1], M.pos[v * 3 + 2]))) l[v] = 1; return l; };
  const headKeys = new Set(); for (let v = 0; v < head0.M.n; v++) if (head0.M.skinRole[v]) headKeys.add(key(head0.M.pos[v * 3], head0.M.pos[v * 3 + 1], head0.M.pos[v * 3 + 2]));
  const bodyLock = new Uint8Array(body.M.n); for (let v = 0; v < body.M.n; v++) if (headKeys.has(key(body.M.pos[v * 3], body.M.pos[v * 3 + 1], body.M.pos[v * 3 + 2]))) bodyLock[v] = 1;

  const bin = new Bin(), closeBin = new Bin(), parts = {}, stats = {};
  // (the animation first: the same texture every part samples)
  const a = man0.anim, animData = bin0.subarray(a.data.off, a.data.off + a.data.len);
  const anim = { w: a.w, h: a.h, frames: a.frames, data: bin.add(new Uint16Array(animData.buffer.slice(animData.byteOffset, animData.byteOffset + animData.byteLength)), 'uint16', a.data.shape) };
  const feats = {};   // per category: each part's shape (its bounds) and the skin it covers, for the look-alikes
  const add = async (cat, name, P, extra = {}) => {
    if (cat === 'head') { const ft = faceTags(P.M); Object.assign(P.M, { face: ft.face, faceU: ft.u, faceW: ft.w }); extra = { ...extra, meta: { ...(extra.meta || {}), eyes: ft.eyes } }; }
    let L, CL;
    if (cat === 'head') ({ L, CL } = await headLevels(P.M, BUDGET[cat], extra.lock || null));
    else { L = await levels(P.M, BUDGET[cat], extra.lock || null); CL = await closeLevel(P.M, BUDGET[cat], extra.lock || null); }
    // its ambient occlusion (bind pose): against itself and what it is worn on — the bare body, the reference head for hair
    // and beards; clothes, hair and shoes from whichever of their sides is the more open (their faces turn either way);
    // worked out only for the vertices its levels draw
    {
      const around = cat === 'body' ? [] : cat === 'head' ? [body.M] : cat === 'hair' || cat === 'beard' ? [head0.M, body.M] : [body.M];
      const B = buildBVH([P.M, ...around]), two = !['body', 'head'].includes(cat), only = new Uint8Array(P.M.n);
      for (const ix of [...L, ...(CL ? [CL] : [])]) for (let i = 0; i < ix.length; i++) only[ix[i]] = 1;
      const up = OCCLUSION ? bakeAO(P.M, B, { rays: 24, only }) : new Float32Array(P.M.n).fill(1);
      if (OCCLUSION && two) { const flip = { ...P.M, nrm: P.M.nrm.map(x => -x) }, dn = bakeAO(flip, B, { rays: 24, only }); for (let v = 0; v < P.M.n; v++) up[v] = Math.max(up[v], dn[v]); }
      P.M.ao = up;
    }
    { const mn = [9, 9, 9], mx = [-9, -9, -9]; for (let v = 0; v < P.M.n; v++) for (let q = 0; q < 3; q++) { const x = P.M.pos[v * 3 + q]; if (x < mn[q]) mn[q] = x; if (x > mx[q]) mx[q] = x; } (feats[cat] ??= []).push({ box: [...mn, ...mx], cover: extra.covers || null, dress: !!extra.meta?.dress }); }
    const cov = extra.cov || (extra.cover ? coverOf(P.M) : null);
    const entry = { name, ...(extra.meta || {}), lods: L.map((ix, li) => lodEntry(bin, P.M, ix, { tint: P.tint, cov: li && cov?.far ? cov.far : cov })), ...(CL ? { close: lodEntry(closeBin, P.M, CL, { tint: P.tint, cov }) } : {}) };
    (parts[cat] ??= []).push(entry);
    stats[cat] ??= []; stats[cat].push(entry.lods.map(l => l.verts).join('/'));
  };
  log('hair, beards…');
  for (const i of pick.hair) await add('hair', styles('hair').find(([x]) => x === i)[1], await pair({ hair: i }, 'hair'));
  for (const i of pick.beard) await add('beard', styles('beard').find(([x]) => x === i)[1], await pair({ beard: i }, 'beard'));
  log('clothes…');
  // (a top over the reference bottoms, the bottoms over the reference shoes: as they are worn)
  // (the bottoms first: the tops are fitted over the widest of them at the hips and thighs, so none shows through a coat)
  const widths = [], bottomsP = [];
  for (const i of pick.bottom) {
    const P = await pair({ bottom: i, shoes: pick.shoes[0] }, 'bottom'), hy = man0.land.waist;
    let r = 0, n = 0; for (let v = 0; v < P.M.n; v++) { const y = P.M.pos[v * 3 + 1]; if (y > hy - 0.32 && y < hy - 0.05) { r += Math.hypot(P.M.pos[v * 3], P.M.pos[v * 3 + 2]); n++; } }
    widths.push(n ? r / n : 0); bottomsP.push(P);
  }
  const wideBottom = pick.bottom[widths.indexOf(Math.max(...widths))];
  log(`tops fitted over the widest bottoms: ${styles('bottom').find(([x]) => x === wideBottom)?.[1]}`);
  const topsP = [];
  for (const [b, i] of pick.top.entries()) { const P = await pair({ top: i, bottom: wideBottom }, 'top'); neckUnder(P.M, b); topsP.push(P); }
  // the skin each garment wholly encloses (2026-11-20, the product owner saw skin through the lighter levels' clothes: the
  // builder's own drop leaves most of the skin under a garment, and the clothes, simplified on their own, sank through it):
  // a skin vertex whose rays — along its normal and 35° off it four ways — all meet the garment, from inside it, within
  // `reach`, in the bind pose and in every pose below (the crowd's own animation: sitting, a head bent over a phone,
  // bending, arms up …; a collar or a hem moves off the skin as the body moves — empty necks and waists otherwise).
  // One near an opening has a ray out of it; skin beside a garment but not under it (an arm by a sleeveless top) meets it
  // from outside: both stay drawn.
  const POSE_CLIPS = ['idle', 'walk', 'run', 'sit', 'sit_idle', 'sit_work', 'sit_talk', 'hold_sit_phone', 'hold_sit_read', 'eat_lap', 'lie', 'jump', 'dance_01', 'dance_03', 'dance_05', 'cheer', 'bow',
    'warm_up', 'scratch', 'play_mobile_game', 'look_around', 'act_cook', 'act_wash', 'act_lift', 'act_browse', 'act_pool', 'fish_cast', 'fish_fight', 'act_drive', 'car_ride'];
  const poseFrames = [];
  for (const n of POSE_CLIPS) { const c = (man0.clips || []).find(x => x.name === n); if (c) for (const u of [0.25, 0.75]) poseFrames.push(c.off + Math.min(c.len - 1, Math.floor(c.len * u))); }
  const BONES = man0.bones || 65, A0 = man0.anim, animH = new Uint16Array(bin0.buffer.slice(bin0.byteOffset + A0.data.off, bin0.byteOffset + A0.data.off + A0.data.len));
  const HALF = new Float32Array(65536); for (let h = 0; h < 65536; h++) { const sg = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023; HALF[h] = e === 0 ? sg * f * 2 ** -24 : e === 31 ? (f ? NaN : sg * Infinity) : sg * (1 + f / 1024) * 2 ** (e - 15); }
  /** Mesh M as frame f of the animation poses it (bind space → posed, metres; its normals turned with it). */
  const posed = (M, f) => {
    const P = new Float32Array(M.n * 3), Nn = new Float32Array(M.n * 3);
    for (let v = 0; v < M.n; v++) {
      const x = M.pos[v * 3], y = M.pos[v * 3 + 1], z = M.pos[v * 3 + 2], nx = M.nrm[v * 3], ny = M.nrm[v * 3 + 1], nz = M.nrm[v * 3 + 2];
      for (let k = 0; k < 4; k++) {
        const w = M.w[v * 4 + k] / 255; if (!w) continue;
        const o = (f * BONES + M.j[v * 4 + k]) * 12, m = i => HALF[animH[o + i]];
        P[v * 3] += w * (m(0) * x + m(1) * y + m(2) * z + m(3)); P[v * 3 + 1] += w * (m(4) * x + m(5) * y + m(6) * z + m(7)); P[v * 3 + 2] += w * (m(8) * x + m(9) * y + m(10) * z + m(11));
        Nn[v * 3] += w * (m(0) * nx + m(1) * ny + m(2) * nz); Nn[v * 3 + 1] += w * (m(4) * nx + m(5) * ny + m(6) * nz); Nn[v * 3 + 2] += w * (m(8) * nx + m(9) * ny + m(10) * nz);
      }
    }
    return { n: M.n, pos: P, nrm: Nn, idx: M.idx, skinRole: M.skinRole };
  };
  const skinPoses = [[body.M, head0.M], ...poseFrames.map(f => [posed(body.M, f), posed(head0.M, f)])];
  const rayCover = (G, g, b, reach) => {
    const stack = new Int32Array(512);
    const still = [new Uint8Array(body.M.n), new Uint8Array(head0.M.n)];
    [body.M, head0.M].forEach((M, mi) => { for (let v = 0; v < M.n; v++) if (M.skinRole[v]) still[mi][v] = 1; });
    let hits = 0, backs = 0;
    let bindStill = null;
    skinPoses.forEach((skins, pi) => {
      if (pi === 1) bindStill = still.map(a => a.slice());   // (the bind pose's: the lighter levels')
      const Gp = pi ? posed(G, poseFrames[pi - 1]) : G, B = buildBVH([Gp]), mn = [99, 99, 99], mx = [-99, -99, -99];
      for (let v = 0; v < Gp.n; v++) for (let q = 0; q < 3; q++) { const x = Gp.pos[v * 3 + q]; if (x < mn[q]) mn[q] = x; if (x > mx[q]) mx[q] = x; }
      skins.forEach((M, mi) => {
        const S = still[mi];
        for (let v = 0; v < M.n; v++) {
          if (!S[v]) continue;
          const x = M.pos[v * 3], y = M.pos[v * 3 + 1], z = M.pos[v * 3 + 2];
          if (x < mn[0] - reach || x > mx[0] + reach || y < mn[1] - reach || y > mx[1] + reach || z < mn[2] - reach || z > mx[2] + reach) { S[v] = 0; continue; }
          let nx = M.nrm[v * 3], ny = M.nrm[v * 3 + 1], nz = M.nrm[v * 3 + 2]; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          // two directions across the surface
          const ax = Math.abs(ny) < 0.9 ? 0 : 1, ay = Math.abs(ny) < 0.9 ? 1 : 0, az = 0;
          let ux = ny * az - nz * ay, uy = nz * ax - nx * az, uz = nx * ay - ny * ax; const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
          const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;
          const ox = x - nx * 0.002, oy = y - ny * 0.002, oz = z - nz * 0.002;
          for (const [cu, cw] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const up = cu || cw ? COVER_UP : 1, tl = cu || cw ? COVER_TILT : 0;
            const dx = nx * up + (ux * cu + wx * cw) * tl, dy = ny * up + (uy * cu + wy * cw) * tl, dz = nz * up + (uz * cu + wz * cw) * tl;
            const [t, back] = hitFacing(B, ox, oy, oz, dx, dy, dz, reach, stack);
            if (!pi && !cu && !cw && t < reach) { hits++; backs += back; }
            if (!(t < reach) || !back) { S[v] = 0; break; }
          }
        }
      });
    });
    let added = 0;
    bindStill ??= still.map(a => a.slice());
    [body.M, head0.M].forEach((M, mi) => { for (let v = 0; v < M.n; v++) if (bindStill[mi][v]) { const k = key(M.pos[v * 3], M.pos[v * 3 + 1], M.pos[v * 3 + 2]); covBroad[g].set(k, (covBroad[g].get(k) || 0) | (1 << b)); } });
    [body.M, head0.M].forEach((M, mi) => { for (let v = 0; v < M.n; v++) if (still[mi][v]) { const k = key(M.pos[v * 3], M.pos[v * 3 + 1], M.pos[v * 3 + 2]), was = covBits[g].get(k) || 0; if (!(was & (1 << b))) { covBits[g].set(k, was | (1 << b)); added++; } } });
    return { added, inside: hits ? backs / hits : 0 };
  };
  const coverT0 = Date.now();
  covBroad = Object.fromEntries(['top', 'bottom', 'shoes'].map(g => [g, new Map(covBits[g])]));   // (the builder's drop and the necks', then the rays')
  const coverLog = [];
  for (const [b] of pick.top.entries()) { const r = rayCover(topsP[b].M, 'top', b, 0.12); coverLog.push(`top ${b} +${r.added} (${Math.round(r.inside * 100)}% from inside)`); }
  for (const [b] of pick.bottom.entries()) { const r = rayCover(bottomsP[b].M, 'bottom', b, 0.15); coverLog.push(`bottom ${b} +${r.added} (${Math.round(r.inside * 100)}%)`); }
  const shoesP = [];
  for (const [b, i] of pick.shoes.entries()) { const P = await pair({ shoes: i }, 'shoes'); shoesP.push(P); const r = rayCover(P.M, 'shoes', b, 0.06); coverLog.push(`shoes ${b} +${r.added} (${Math.round(r.inside * 100)}%)`); }
  log(`skin wholly under each garment in ${skinPoses.length} poses (rays, ${((Date.now() - coverT0) / 1000).toFixed(0)} s): ${coverLog.join(', ')}`);
  { // what lies deep under each garment, along the skin from its openings (body and reference head as one surface)
    const G = surfaceGraph([body.M, head0.M]), skinKey = new Set();
    for (const M of [body.M, head0.M]) for (let v = 0; v < M.n; v++) if (M.skinRole[v]) skinKey.add(key(M.pos[v * 3], M.pos[v * 3 + 1], M.pos[v * 3 + 2]));
    deepBits = {};
    for (const g of ['top', 'bottom', 'shoes']) deepBits[g] = deepBitsOf(G, n => (skinKey.has(G.keys[n]) ? covBits[g].get(G.keys[n]) || 0 : 0), DEEP[g]);
    const share = g => { let c = 0, t = 0; for (const [k, bits] of covBits[g]) { t++; if (deepBits[g].get(k)) c++; } return t ? Math.round(c / t * 100) : 0; };
    log(`skin deep under the clothes (of the covered): tops ${share('top')}%, bottoms ${share('bottom')}%, shoes ${share('shoes')}%`);
  }
  for (const [b, i] of pick.top.entries()) await add('top', styles('top').find(([x]) => x === i)[1], topsP[b], { meta: { dress: !!piece('top', i)?.dress, source: piece('top', i)?.source || '' }, covers: coverSet('top', b) });
  // (each bottoms' parts under each top — a coat's skirts over shorts — pulled in when it is worn: the tops' bits)
  for (const [b, i] of pick.bottom.entries()) {
    const P = bottomsP[b], bits = new Float32Array(P.M.n);
    topsP.forEach((T, t) => { if (topsP[t] && !piece('top', pick.top[t])?.dress) { const u = under(P.M, T.M, 0.03); for (let v = 0; v < P.M.n; v++) if (u[v]) bits[v] += 1 << t; } });
    await add('bottom', styles('bottom').find(([x]) => x === i)[1], P, { covers: coverSet('bottom', b), cov: { top: bits, bottom: new Float32Array(P.M.n), shoes: new Float32Array(P.M.n) } });   // (pulled in only: a top's hem moves off them as the body moves)
  }
  for (const [b, i] of pick.shoes.entries()) await add('shoes', styles('shoes').find(([x]) => x === i)[1], shoesP[b]);
  log(`body, heads (after the clothes: the skin they cover known)… (seam: ${bodyLock.reduce((a, b) => a + b, 0)} body / ${seamLock(head0.M).reduce((a, b) => a + b, 0)} head vertices locked)`);
  await add('body', 'Body', body, { cover: true, lock: bodyLock });
  await add('head', 'Head 1', head0, { cover: true, lock: seamLock(head0.M) });
  for (let h = 1; h < heads.length; h++) { const P = await pair(heads[h], 'head'); await add('head', `Head ${h + 1}`, P, { cover: true, lock: seamLock(P.M) }); }

  // the look-alikes: for each category and distance, a few parts chosen (farthest apart), every part drawn as the nearest
  // of them (a dress only as a dress); distance: the difference of bounds (metres) and of the skin covered (share)
  const dist = (a, b) => {
    let d = 0; for (let q = 0; q < 6; q++) d += Math.abs(a.box[q] - b.box[q]);
    if (a.cover && b.cover) { let both = 0; for (const k of a.cover) if (b.cover.has(k)) both++; const any = a.cover.size + b.cover.size - both; d += any ? (1 - both / any) * 0.6 : 0; }
    return d + (a.dress !== b.dress ? 100 : 0);
  };
  for (const [cat, list] of Object.entries(parts)) {
    if (cat === 'body') continue;
    const F = feats[cat];
    for (const lvl of [1, 2]) {
      const K = Math.min(F.length, FAR[lvl][cat] + (F.some(f => f.dress) ? 1 : 0));
      // (the first: the most typical — least far from the others; then each next the farthest from those chosen)
      const total = F.map((f, a) => F.reduce((s2, g) => s2 + dist(f, g), 0));
      const chosen = [total.indexOf(Math.min(...total))];
      while (chosen.length < K) { let best = -1, bd = -1; F.forEach((f, a) => { if (chosen.includes(a)) return; const d = Math.min(...chosen.map(c => dist(f, F[c]))); if (d > bd) { bd = d; best = a; } }); chosen.push(best); }
      list.forEach((e, a) => { let best = chosen[0], bd = Infinity; for (const c of chosen) { const d = dist(F[a], F[c]); if (d < bd) { bd = d; best = c; } } (e.far ??= {})[lvl] = best; });
    }
  }
  const man = {
    kind: `crowd_${sex[0]}`, crowd: true, scale: man0.scale, bones: man0.bones, names: man0.names, textured: true, vcol: true, land: man0.land,
    clips: man0.clips, anim, grips: man0.grips, head: man0.head, seated: man0.seated, normalMap: `/assets/builder/${sex}_normal.jpg`,
    feet: { L: [0, 1, 2].map(q => full.joints[3 * 3 + q] * SCALE), R: [0, 1, 2].map(q => full.joints[8 * 3 + q] * SCALE), size: FEET },   // (LeftFoot, RightFoot: the ankles)
    custom: { ...man0.custom, gender: sex }, tints: Object.fromEntries(KEYS.map(k => [k, hex2(REF[k]).map(lin)])), keys: KEYS, parts,
    made: { seed, picks: pick, heads, bake: BAKE }, light: 1,   // (light: its occlusion and finish baked in — render/characters.js uShade)
  };
  const out = bin.buffer();
  fs.writeFileSync(path.join(OUT, `${sex}.bin`), out);
  // (the close-up level: a file of its own, fetched only by the pages that draw it — render/characters.js loadCrowdClose)
  if (BAKE?.close != null) { const cb = closeBin.buffer(); man.close = { file: `${sex}-close.bin`, bytes: cb.length }; fs.writeFileSync(path.join(OUT, `${sex}-close.bin`), cb); }
  else fs.rmSync(path.join(OUT, `${sex}-close.bin`), { force: true });
  fs.writeFileSync(path.join(OUT, `${sex}.json`), JSON.stringify(man));
  log(`written: ${(out.length / 1e6).toFixed(1)} MB;`, Object.entries(stats).map(([k, v]) => `${k} ${v.length}× (${v[0]}…)`).join(', '));
  return { sex, mb: out.length / 1e6, stats };
}

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 800 } });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`${o.url}/dev/builder-kit.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  page.setDefaultTimeout(180000);
  for (const [k, sex] of SEXES.entries()) await pack(page, sex, Number(o.seed || 7) + k);
} finally { await browser.close(); }
