#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The surfaces of the Amazon furniture library's tables, desks, shelves and cabinets that small things can be put on
// (PLAN-SURFACES.md 6.2), found from each host model's DRAWN shape (client/assets/abo/m/<id>.glb) and written to
// shared/abo-surfaces.js (generated: do not edit by hand; fix a model in tools/surf-overrides.json).
//
// Per model: the upward faces binned by height (1 cm, neighbours within 2 cm joined); each height's faces drawn into a
// 1 cm grid and closed (3 cm) so wire and slat shelves read as one board; cells where something stands on it (a side
// panel, a divider, a post, a baked vase: the shape cut 1.5 and 5 cm above) or with less than 8 cm free above (or inside
// something) left out; the largest rectangles left (up to 3 a height) kept when at least 15 x 10 cm after a 3 cm inset;
// then reached from the front or the back (rays 4 cm above: a drawer or a closed cabinet's inside is not a surface).
//
// Run from the repository's folder: ABO_TOOLS=<folder with @gltf-transform/* and meshoptimizer> node tools/surf-build.mjs [--jobs 24]
//   [--ids B0..,B0..] (those only, printed, nothing written) [--report <file.json>] (every model's surfaces and timings)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = path.join(ROOT, 'client/assets/abo/m');
const OUT_JS = path.join(ROOT, 'shared/abo-surfaces.js');
const OVR = path.join(ROOT, 'tools/surf-overrides.json');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

const MIN_W = 0.15, MIN_D = 0.10, INSET = 0.03, CLOSE = 3, CLOSE_WIDE = 6, MIN_CLEAR = 0.08, MIN_COVER = 0.2, MIN_ACCESS = 0.6;
const TABLE_KINDS = new Set(['dining_table', 'table', 'bar_table']);   // (a set's chairs: their seats are not surfaces)

function deps() {
  const req = createRequire(path.join(process.env.ABO_TOOLS ? path.resolve(process.env.ABO_TOOLS) : ROOT, 'noop.js'));
  return { core: req('@gltf-transform/core'), ext: req('@gltf-transform/extensions'), mo: req('meshoptimizer') };
}

// ------------------------------------------------------------------ geometry
async function triangles(D, io, file) {
  const doc = await io.read(file), out = [];
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh(); if (!mesh) continue;
    const W = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      if (p.getMode() !== 4) continue;
      const pos = p.getAttribute('POSITION'), ix = p.getIndices(), N = ix ? ix.getCount() : pos.getCount(), v = [0, 0, 0];
      for (let i = 0; i < N; i++) {
        pos.getElement(ix ? ix.getScalar(i) : i, v);
        out.push(W[0] * v[0] + W[4] * v[1] + W[8] * v[2] + W[12], W[1] * v[0] + W[5] * v[1] + W[9] * v[2] + W[13], W[2] * v[0] + W[6] * v[1] + W[10] * v[2] + W[14]);
      }
    }
  }
  return new Float64Array(out);
}

// a 2-D bucket grid over two axes (a, b) of every triangle, for rays along the third
function buckets(T, a, b, cell = 0.04) {
  const n = T.length / 9; let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
  for (let i = 0; i < n * 3; i++) { const u = T[i * 3 + a], v = T[i * 3 + b]; if (u < a0) a0 = u; if (u > a1) a1 = u; if (v < b0) b0 = v; if (v > b1) b1 = v; }
  const W = Math.max(1, Math.ceil((a1 - a0) / cell) + 1), H = Math.max(1, Math.ceil((b1 - b0) / cell) + 1), G = Array.from({ length: W * H }, () => []);
  for (let t = 0; t < n; t++) {
    let ua = Infinity, ub = -Infinity, va = Infinity, vb = -Infinity;
    for (let k = 0; k < 3; k++) { const u = T[t * 9 + k * 3 + a], v = T[t * 9 + k * 3 + b]; ua = Math.min(ua, u); ub = Math.max(ub, u); va = Math.min(va, v); vb = Math.max(vb, v); }
    const i0 = Math.floor((ua - a0) / cell), i1 = Math.floor((ub - a0) / cell), j0 = Math.floor((va - b0) / cell), j1 = Math.floor((vb - b0) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) G[j * W + i].push(t);
  }
  return { a, b, a0, b0, W, H, cell, G };
}
// first triangle along axis c (sign s) from point p: { t, out } (out: its face looks along the ray, so p is inside a solid)
function cast(T, N, B, p, c, s) {
  const i = Math.floor((p[B.a] - B.a0) / B.cell), j = Math.floor((p[B.b] - B.b0) / B.cell);
  if (i < 0 || j < 0 || i >= B.W || j >= B.H) return { t: Infinity, out: false };
  let best = Infinity, out = false;
  const pu = p[B.a], pv = p[B.b];
  for (const t of B.G[j * B.W + i]) {
    const o = t * 9, Au = T[o + B.a], Av = T[o + B.b], Bu = T[o + 3 + B.a], Bv = T[o + 3 + B.b], Cu = T[o + 6 + B.a], Cv = T[o + 6 + B.b];
    const d = (Bv - Cv) * (Au - Cu) + (Cu - Bu) * (Av - Cv); if (Math.abs(d) < 1e-12) continue;
    const l1 = ((Bv - Cv) * (pu - Cu) + (Cu - Bu) * (pv - Cv)) / d, l2 = ((Cv - Av) * (pu - Cu) + (Au - Cu) * (pv - Cv)) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
    const h = l1 * T[o + c] + l2 * T[o + 3 + c] + l3 * T[o + 6 + c], dist = (h - p[c]) * s;
    if (dist > 1e-5 && dist < best) { best = dist; out = N[t * 3 + c] * s > 0; }
  }
  return { t: best, out };
}

// the largest all-ones rectangle of a W x H grid (histogram method): [i0, j0, i1, j1] inclusive, or null
function largestRect(M, W, H) {
  const hgt = new Int32Array(W); let best = 0, R = null;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) hgt[i] = M[j * W + i] ? hgt[i] + 1 : 0;
    const st = [];
    for (let i = 0; i <= W; i++) {
      const h = i < W ? hgt[i] : 0;
      while (st.length && hgt[st[st.length - 1]] >= h) {
        const top = st.pop(), hh = hgt[top], left = st.length ? st[st.length - 1] + 1 : 0, area = hh * (i - left);
        if (area > best) { best = area; R = [left, j - hh + 1, i - 1, j]; }
      }
      st.push(i);
    }
  }
  return R;
}

function analyse(T, kind, nyMin = 0.97) {
  const n = T.length / 9, Nn = new Float64Array(n * 3);
  let ymax = -Infinity;
  for (let i = 1; i < T.length; i += 3) ymax = Math.max(ymax, T[i]);
  const bins = new Map();
  for (let t = 0; t < n; t++) {
    const o = t * 9, ux = T[o + 3] - T[o], uy = T[o + 4] - T[o + 1], uz = T[o + 5] - T[o + 2], vx = T[o + 6] - T[o], vy = T[o + 7] - T[o + 1], vz = T[o + 8] - T[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz);
    if (!L) continue;
    Nn[t * 3] = nx / L; Nn[t * 3 + 1] = ny / L; Nn[t * 3 + 2] = nz / L;
    if (ny / L < nyMin) continue;
    const y = (T[o + 1] + T[o + 4] + T[o + 7]) / 3, k = Math.round(y * 100);
    const e = bins.get(k) || { area: 0, ay: 0, tris: [] };
    e.area += L / 2; e.ay += y * L / 2; e.tris.push(t); bins.set(k, e);
  }
  const ks = [...bins.keys()].sort((a, b) => a - b), cl = [];
  for (const k of ks) {
    const e = bins.get(k), last = cl[cl.length - 1];
    if (last && k - last.k1 <= 2) { last.area += e.area; last.ay += e.ay; last.tris.push(...e.tris); last.k1 = k; }
    else cl.push({ area: e.area, ay: e.ay, tris: [...e.tris], k0: k, k1: k });
  }
  const BY = buckets(T, 0, 2), BZ = buckets(T, 0, 1);
  const found = [];
  for (const c of cl) {
    if (c.area < 0.004) continue;
    const y = c.ay / c.area; let ytop = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const t of c.tris) for (let k = 0; k < 3; k++) { const o = t * 9 + k * 3; ytop = Math.max(ytop, T[o + 1]); x0 = Math.min(x0, T[o]); x1 = Math.max(x1, T[o]); z0 = Math.min(z0, T[o + 2]); z1 = Math.max(z1, T[o + 2]); }
    if (y < 0.005 || x1 - x0 < MIN_W + 2 * INSET - 0.01 || z1 - z0 < MIN_D + 2 * INSET - 0.01) continue;
    // the grid: 1 cm cells over the faces' bounds, padded by the close
    const P = CLOSE_WIDE + 1, gx0 = Math.floor(x0 * 100) - P, gz0 = Math.floor(z0 * 100) - P, W = Math.ceil(x1 * 100) - gx0 + P + 1, H = Math.ceil(z1 * 100) - gz0 + P + 1;
    const cx = i => (gx0 + i + 0.5) / 100, cz = j => (gz0 + j + 0.5) / 100, ci = x => Math.floor(x * 100) - gx0, cj = z => Math.floor(z * 100) - gz0;
    const occ = new Uint8Array(W * H), mark = (G, x, z) => { const i = ci(x), j = cj(z); if (i >= 0 && j >= 0 && i < W && j < H) G[j * W + i] = 1; };
    const seg = (G, ax, az, bx, bz) => { const L = Math.hypot(bx - ax, bz - az), st = Math.max(1, Math.ceil(L / 0.005)); for (let s = 0; s <= st; s++) mark(G, ax + (bx - ax) * s / st, az + (bz - az) * s / st); };
    for (const t of c.tris) {
      const o = t * 9, A = [T[o], T[o + 2]], Bp = [T[o + 3], T[o + 5]], C = [T[o + 6], T[o + 8]];
      const d = (Bp[1] - C[1]) * (A[0] - C[0]) + (C[0] - Bp[0]) * (A[1] - C[1]);
      if (Math.abs(d) > 1e-12) {
        const i0 = Math.max(0, ci(Math.min(A[0], Bp[0], C[0]))), i1 = Math.min(W - 1, ci(Math.max(A[0], Bp[0], C[0]))), j0 = Math.max(0, cj(Math.min(A[1], Bp[1], C[1]))), j1 = Math.min(H - 1, cj(Math.max(A[1], Bp[1], C[1])));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const px = cx(i), pz = cz(j), l1 = ((Bp[1] - C[1]) * (px - C[0]) + (C[0] - Bp[0]) * (pz - C[1])) / d, l2 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (pz - C[1])) / d;
          if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) occ[j * W + i] = 1;
        }
      }
      seg(occ, A[0], A[1], Bp[0], Bp[1]); seg(occ, Bp[0], Bp[1], C[0], C[1]); seg(occ, C[0], C[1], A[0], A[1]);
    }
    // what stands on it: the shape's cut 1.5 and 5 cm above the faces' top (grown by a cell)
    const cut = new Uint8Array(W * H);
    for (const Y of [ytop + 0.015, ytop + 0.05]) {
      for (let t = 0; t < n; t++) {
        const o = t * 9, ys = [T[o + 1], T[o + 4], T[o + 7]];
        if (Math.min(...ys) >= Y || Math.max(...ys) <= Y) continue;
        const pts = [];
        for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
          const ya = ys[a], yb = ys[b];
          if ((ya - Y) * (yb - Y) < 0) { const f = (Y - ya) / (yb - ya); pts.push([T[o + a * 3] + (T[o + b * 3] - T[o + a * 3]) * f, T[o + a * 3 + 2] + (T[o + b * 3 + 2] - T[o + a * 3 + 2]) * f]); }
        }
        if (pts.length === 2) seg(cut, pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
      }
    }
    // closed (dilated then eroded, square) by 3 cm; by 6 when that leaves under half the faces' box (a lean wire shelf
    // missing wires), the wider kept when it gives 20 % more
    let best = [], bestA = 0;
    const boxA = Math.max(1e-6, (x1 - x0 - 2 * INSET) * (z1 - z0 - 2 * INSET));
    for (const [R, cover] of [[CLOSE, MIN_COVER], [CLOSE_WIDE, MIN_COVER / 2]]) {
      const dil = new Uint8Array(W * H), clo = new Uint8Array(W * H);
      const rowMax = (src, dst, r, val) => {   // separable square max/min filter
        const tmp = new Uint8Array(W * H);
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let v = val ? 0 : 1; for (let k = -r; k <= r; k++) { const ii = i + k; const s = ii < 0 || ii >= W ? (val ? 0 : 0) : src[j * W + ii]; if (val ? s : !s) { v = val ? 1 : 0; break; } } tmp[j * W + i] = v; }
        for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let v = val ? 0 : 1; for (let k = -r; k <= r; k++) { const jj = j + k; const s = jj < 0 || jj >= H ? 0 : tmp[jj * W + i]; if (val ? s : !s) { v = val ? 1 : 0; break; } } dst[j * W + i] = v; }
      };
      rowMax(occ, dil, R, 1); rowMax(dil, clo, R, 0);
      const M = new Uint8Array(W * H), clr = new Float64Array(W * H);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const q = j * W + i; if (!clo[q]) continue;
        let blocked = false;
        for (let dj = -1; dj <= 1 && !blocked; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < W && jj < H && cut[jj * W + ii]) { blocked = true; break; } }
        if (blocked) continue;
        const r = cast(T, Nn, BY, [cx(i), ytop + 0.005, cz(j)], 1, 1);
        if (r.out || r.t < MIN_CLEAR) continue;
        M[q] = 1; clr[q] = r.t;
      }
      if (process.env.SURF_DEBUG) {   // (a picture of the grids: o faces, c closed, x cut, # usable)
        let txt = `y ${y.toFixed(3)} ytop ${ytop.toFixed(3)} W ${W} H ${H}\n`;
        for (let j = 0; j < H; j += 2) { let line = ''; for (let i = 0; i < W; i += 2) { const q = j * W + i; line += M[q] ? '#' : cut[q] ? 'x' : occ[q] ? 'o' : clo[q] ? 'c' : '.'; } txt += line + '\n'; }
        fs.writeFileSync(`/tmp/surf-${Math.round(y * 100)}.txt`, txt);
      }
      // the largest rectangles left (up to 3 at this height)
      const got = [];
      for (let pass = 0; pass < 3; pass++) {
        const R0 = largestRect(M, W, H); if (!R0) break;
        const [i0, j0, i1, j1] = R0;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) M[j * W + i] = 0;
        const rx0 = (gx0 + i0) / 100 + INSET, rz0 = (gz0 + j0) / 100 + INSET, rx1 = (gx0 + i1 + 1) / 100 - INSET, rz1 = (gz0 + j1 + 1) / 100 - INSET;
        if (rx1 - rx0 < MIN_W - 1e-6 && rz1 - rz0 < MIN_W - 1e-6) break;
        if (Math.max(rx1 - rx0, rz1 - rz0) < MIN_W - 1e-6 || Math.min(rx1 - rx0, rz1 - rz0) < MIN_D - 1e-6) continue;
        let covered = 0, cells = 0, clear = Infinity;
        for (let j = cj(rz0); j < cj(rz1); j++) for (let i = ci(rx0); i < ci(rx1); i++) { cells++; covered += occ[j * W + i]; clear = Math.min(clear, clr[j * W + i]); }
        if (!cells || covered / cells < cover) continue;
        // reached from the front (+z) or the back (-z): rays 4 cm above (or half the room there is)
        const ya = ytop + Math.min(0.04, Number.isFinite(clear) ? clear / 2 : 0.04);
        let fr = 0, bk = 0, k = 0;
        for (const fx of [0.15, 0.5, 0.85]) for (const fz of [0.2, 0.5, 0.8]) {
          const p = [rx0 + fx * (rx1 - rx0), ya, rz0 + fz * (rz1 - rz0)]; k++;
          if (cast(T, Nn, BZ, p, 2, 1).t === Infinity) fr++;
          if (cast(T, Nn, BZ, p, 2, -1).t === Infinity) bk++;
        }
        const side = (fr / k >= MIN_ACCESS ? 1 : 0) | (bk / k >= MIN_ACCESS ? 2 : 0);
        if (!side) continue;
        got.push({ y, x0: rx0, z0: rz0, x1: rx1, z1: rz1, clear, side, cover: covered / cells });
      }
      const A = got.reduce((a, f) => a + (f.x1 - f.x0) * (f.z1 - f.z0), 0);
      if (A > bestA * 1.2) { best = got; bestA = A; }
      if (bestA >= 0.5 * boxA) break;
    }
    found.push(...best);
  }
  // a table set's chairs: open faces well below the table's own top are their seats
  if (TABLE_KINDS.has(kind)) {
    const top = Math.max(-Infinity, ...found.filter(f => f.clear === Infinity).map(f => f.y));
    for (let i = found.length - 1; i >= 0; i--) if (found[i].clear === Infinity && found[i].y < top * 0.85) found.splice(i, 1);
  }
  found.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  return found.map(f => ({ ...f, kind: kindOf(f) }));
}
const kindOf = f => (f.clear === Infinity ? (f.y > 1.6 ? 'high' : f.z1 - f.z0 < 0.2 && f.x1 - f.x0 >= 0.2 ? 'ledge' : 'top') : f.clear >= 1 ? 'top' : 'shelf');

// ------------------------------------------------------------------ output
const KCODE = { top: 't', shelf: 's', high: 'h', ledge: 'l' };
const mm = v => Math.round(v * 1000);
function rowOf(id, list) {
  return `${id}|` + list.map(f => [mm(f.y), mm(f.x0), mm(f.z0), mm(f.x1), mm(f.z1), Number.isFinite(f.clear) ? mm(f.clear) : 0, KCODE[f.kind] + (f.side === 3 ? 'fb' : f.side === 2 ? 'b' : 'f')].join(',')).join(';');
}
function applyOverride(list, o) {
  if (!o) return list;
  if (o.none) return [];
  let L = o.replace ? [] : list.filter((_, i) => !(o.drop || []).includes(i));
  for (const a of o.replace || o.add || []) { const [y, x0, z0, x1, z1, clear, kind = 'top', side = 1] = a; L.push({ y, x0, z0, x1, z1, clear: clear ? clear : Infinity, kind, side, cover: 1 }); }
  if (o.replace && o.add) for (const a of o.add) { const [y, x0, z0, x1, z1, clear, kind = 'top', side = 1] = a; L.push({ y, x0, z0, x1, z1, clear: clear ? clear : Infinity, kind, side, cover: 1 }); }
  return L.sort((a, b) => a.y - b.y || a.x0 - b.x0);
}

async function workerMain() {
  const D = deps(); await D.mo.MeshoptDecoder.ready;
  const io = new D.core.NodeIO().setLogger(new D.core.Logger(D.core.Logger.Verbosity.ERROR)).registerExtensions(D.ext.ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': D.mo.MeshoptDecoder });
  parentPort.on('message', async ({ id, kind }) => {
    const t0 = performance.now();
    try {
      const T = await triangles(D, io, path.join(MODELS, `${id}.glb`));
      let s = analyse(T, kind);
      if (!s.length) s = analyse(T, kind, 0.5);   // (round wires with no flat top: their upper faces)
      parentPort.postMessage({ id, s, tris: T.length / 9, ms: Math.round(performance.now() - t0) });
    } catch (e) { parentPort.postMessage({ id, error: String(e?.message || e).slice(0, 200) }); }
  });
}

async function main() {
  const { CATALOG } = await import('../shared/catalog.js');
  const { ABO_HOST_KINDS } = await import('../shared/surfaces.js');
  const only = arg('--ids', '') ? arg('--ids', '').split(',') : null;
  const hosts = Object.entries(CATALOG).filter(([t, d]) => t.startsWith('a:') && d.abo && d.cat !== 'Goods' && ABO_HOST_KINDS.has(d.kind) && (!only || only.includes(d.abo)))
    .map(([, d]) => ({ id: d.abo, kind: d.kind })).filter(h => fs.existsSync(path.join(MODELS, `${h.id}.glb`)));
  const jobs = Math.max(1, Math.min(+arg('--jobs', Math.max(1, os.cpus().length - 2)), hosts.length));
  const res = new Map(); let next = 0, errors = 0; const t0 = Date.now();
  await new Promise(resolve => {
    let live = jobs;
    for (let w = 0; w < jobs; w++) {
      const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { worker: true } });
      const feed = () => { if (next >= hosts.length) { wk.terminate(); if (--live === 0) resolve(); return; } wk.postMessage(hosts[next++]); };
      wk.on('message', r => { if (r.error) { errors++; if (errors < 10) console.log('error', r.id, r.error); } else res.set(r.id, r); feed(); });
      wk.on('error', e => { console.log('worker died', String(e).slice(0, 200)); if (--live === 0) resolve(); });
      feed();
    }
  });
  const ovr = fs.existsSync(OVR) ? JSON.parse(fs.readFileSync(OVR, 'utf8')) : {};
  const rows = [], counts = {}, none = {};
  let total = 0;
  for (const h of hosts) {
    const r = res.get(h.id); if (!r) continue;
    const o = ovr[h.id], list = applyOverride(r.s, o && { ...o, add: o.add?.map(a => a.map((v, i) => (i < 6 && typeof v === 'number' ? v / 1000 : v))), replace: o.replace?.map(a => a.map((v, i) => (i < 6 && typeof v === 'number' ? v / 1000 : v))) });
    r.final = list;
    if (!list.length) { none[h.kind] = (none[h.kind] || 0) + 1; continue; }
    for (const f of list) { counts[f.kind] = (counts[f.kind] || 0) + 1; total++; }
    rows.push(rowOf(h.id, list));
  }
  const ms = [...res.values()].map(r => r.ms).sort((a, b) => a - b);
  console.log(`hosts ${hosts.length}, with surfaces ${rows.length}, surfaces ${total} ${JSON.stringify(counts)}, none by kind ${JSON.stringify(none)}, errors ${errors}, ms p50 ${ms[ms.length >> 1]} max ${ms[ms.length - 1]}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (arg('--report', '')) fs.writeFileSync(arg('--report', ''), JSON.stringify(hosts.map(h => ({ ...h, tris: res.get(h.id)?.tris, ms: res.get(h.id)?.ms, s: res.get(h.id)?.final })), null, 0));
  if (only) { for (const h of hosts) console.log(h.id, h.kind, res.get(h.id)?.tris, 'tris', res.get(h.id)?.ms, 'ms', rowOf('', res.get(h.id)?.final || []).slice(1)); return; }
  rows.sort();
  const head = `// My Virtual World — generated by tools/surf-build.mjs (do not edit by hand; fix a model in tools/surf-overrides.json): the
// surfaces of the Amazon furniture library's hosts (tables, desks, shelves, cabinets) found from their drawn models,
// ${rows.length} of ${hosts.length} hosts, ${total} surfaces (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}).
// One line per model: id | surfaces separated by ';', each y,x0,z0,x1,z1,clear,kind+side in MILLIMETRES in the model's own
// frame (+z its front, standing on y = 0; shared/surfaces.js scales and lifts it as the piece is drawn): y the top of the
// face, x0..z1 the usable rectangle (3 cm in from its edges), clear the free height above (0 = open), kind t top, s shelf,
// h high (open, above 1.6 m), l ledge (under 20 cm deep); side f reached from the front, b from the back, fb both.
export const ABO_SURF_ROWS = \`
${rows.join('\n')}
\`;
`;
  fs.writeFileSync(OUT_JS, head);
  console.log(`wrote ${path.relative(ROOT, OUT_JS)} (${(head.length / 1024).toFixed(0)} KB)`);
}

if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
else if (workerData?.worker) workerMain();
