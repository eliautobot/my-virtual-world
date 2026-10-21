// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The grid layout tool's plan (client/js/ui/roads.js; the product owner 2026-10-13: "lay out the entire roadway system
// in a grid … leaving space for lots"; 2026-10-14: the roadways "as flat as possible, so that the lots are also placed on
// even level", and "an option to place lots along with the roadway"). The roads are flat at one level (their `level`;
// shared/island-roads.js holds them there, shared/island-build.js gridPads levels the land across the grid) and the lots
// are runs along them (shared/plat-road.js, /api/property/plat-grid). Shared so a test checks the browser's own plan.
import { DEFAULT_ROAD_PROFILES } from './roads.js';
import { mToUm } from './units.js';

const FT = 0.3048;
const clampInt = (v, a, b) => Math.max(a, Math.min(b, Math.round(Number(v) || a)));

/**
 * o: { c: { x, z } (m, the middle), ns, ew (roads running north–south, east–west: 2–25), lotsX, lotsZ (lots between
 * roads each way: 1–20), lotFt (30–400), rot (°), profile, name, level (m, or null), grid (its id) }.
 * Returns { roads (records: avenues first, then streets; µm), ns, ew, W, D, oh, blocks (rings and lot lines, m, for the
 * preview), lots (room for), runs ([{ road (index into roads), side, from, to, count }]), inner (lots with no road beside
 * them, left out), lot: { w, d } (m, as platted), at (u, v) → world point, extent: [u0, u1, v0, v1] (m) }.
 */
export function gridLayout(o) {
  const ns = clampInt(o.ns, 2, 25), ew = clampInt(o.ew, 2, 25), lx = clampInt(o.lotsX, 1, 20), lz = clampInt(o.lotsZ, 1, 20), lot = Math.max(30, Math.min(400, Number(o.lotFt) || 100)) * FT;
  const P = DEFAULT_ROAD_PROFILES[o.profile], oh = P.outerHalf / 1e6, sx = lx * lot + 2 * oh, sz = lz * lot + 2 * oh;
  const W = (ns - 1) * sx, D = (ew - 1) * sz, th = (Number(o.rot) || 0) * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
  const cx = Math.round(o.c.x / FT) * FT, cz = Math.round(o.c.z / FT) * FT;
  const at = (u, v) => ({ x: cx + u * co - v * si, z: cz + u * si + v * co }), um = v => mToUm(Math.round(v * 100) / 100), pt = q => ({ x: um(q.x), z: um(q.z) });
  const us = Array.from({ length: ns }, (_, i) => -W / 2 + i * sx), vs = Array.from({ length: ew }, (_, j) => -D / 2 + j * sz);
  const base = String(o.name || '').trim().slice(0, 40), nm = (kind, k) => `${base ? `${base} ` : ''}${kind} ${k + 1}`;
  const lv = Number.isFinite(o.level) ? { level: Math.round(o.level * 100) / 100, ...(o.grid ? { grid: o.grid } : {}) } : {};
  const roads = [];
  us.forEach((u, i) => roads.push({ id: `grid-draft-a${i}`, profile: o.profile, name: nm('Avenue', i), ...lv, pts: [pt(at(u, vs[0])), pt(at(u, vs.at(-1)))] }));
  vs.forEach((v, j) => roads.push({ id: `grid-draft-s${j}`, profile: o.profile, name: nm('Street', j), ...lv, pts: [pt(at(us[0], v)), pt(at(us.at(-1), v))] }));
  // The lots: each block's rows along its streets, the rows between them along its avenues; a lot with no road beside it
  // (deep inside a big block) is left out. Avenue i runs +v (its side a faces −u, b +u), street j runs +u (a faces +v,
  // b −v); stations from each road's start.
  // (even runs: exactly from the back of one sidewalk to the next, 2 cm clear of each; rows meet 2 cm apart)
  const runs = [], E0 = 0.02, w = lot, d = lot - 0.03;
  let inner = 0;
  for (let i = 0; i + 1 < ns; i++) for (let j = 0; j + 1 < ew; j++) {
    const u0 = us[i] + oh - us[0], u1 = us[i + 1] - oh - us[0], v0 = vs[j] + oh - vs[0], v1 = vs[j + 1] - oh - vs[0];
    runs.push({ road: ns + j, side: 'a', from: u0 + E0, to: u1 - E0, count: lx, even: true });
    if (lz >= 2) runs.push({ road: ns + j + 1, side: 'b', from: u0 + E0, to: u1 - E0, count: lx, even: true });
    if (lz >= 3) {
      runs.push({ road: i, side: 'b', from: v0 + lot - 0.01, to: v1 - lot + 0.01, count: lz - 2, even: true });
      if (lx >= 2) runs.push({ road: i + 1, side: 'a', from: v0 + lot - 0.01, to: v1 - lot + 0.01, count: lz - 2, even: true });
      inner += Math.max(0, lx - 2) * (lz - 2);
    }
  }
  const blocks = [];
  for (let i = 0; i + 1 < ns; i++) for (let j = 0; j + 1 < ew; j++) {
    const u0 = us[i] + oh, u1 = us[i + 1] - oh, v0 = vs[j] + oh, v1 = vs[j + 1] - oh;
    blocks.push({ ring: [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], lines: [...Array.from({ length: lx - 1 }, (_, k) => [at(u0 + (k + 1) * lot, v0), at(u0 + (k + 1) * lot, v1)]), ...Array.from({ length: lz - 1 }, (_, k) => [at(u0, v0 + (k + 1) * lot), at(u1, v0 + (k + 1) * lot)])] });
  }
  return { roads, ns, ew, W, D, oh, blocks, lots: blocks.length * lx * lz, runs, inner, lot: { w, d }, at, extent: [-W / 2 - oh, W / 2 + oh, -D / 2 - oh, D / 2 + oh] };
}

/**
 * One block of a grid that is already built, filled the way the grid tool fills its blocks (the product owner,
 * 2026-10-14: "fill this block" — lots taken away from one block put back like the rest). The block is the one beside
 * road `roadId` on its `side` at station `s` (m); its lots are runs along the roads round it, exactly as gridLayout makes
 * them: rows along the pair of roads the grid's lots face, each run exactly from the back of one sidewalk to the next,
 * `count` lots of equal width, rows meeting in the middle, the rows between them along the other pair (square lots only).
 * roads: the world's road records (µm); lots: the lots there now ({ frontage: [{ road }] }) — the grid's lots face the
 * roads most of them face, else the road given; width, depth: the lots' (m). Returns { runs: [{ road (id), side, from,
 * to, count, even: true }], lx, lz, ring (the block, m), depth (as platted, as the grid tool: 3 cm short, rows meeting 2 cm
 * apart) }, or null when the road is
 * not a grid's or no block is on that side.
 */
export function blockRuns(roads, roadId, side, s, { width, depth, lots = [] } = {}) {
  const rec = (roads || []).find(r => r && r.id === roadId);
  if (!rec?.grid || rec.pts?.length !== 2 || !(width > 0) || !(depth > 0)) return null;
  const rs = roads.filter(r => r && r.grid === rec.grid && r.pts?.length === 2);
  // the grid's own frame (as shared/island-build.js gridPads): its first road's direction is u
  const p0 = rs[0].pts[0], p1 = rs[0].pts[1], th = Math.atan2(p1.z - p0.z, p1.x - p0.x), co = Math.cos(th), si = Math.sin(th);
  const toU = p => ({ u: (p.x * co + p.z * si) / 1e6, v: (-p.x * si + p.z * co) / 1e6 }), toW = (u, v) => ({ x: u * co - v * si, z: u * si + v * co });
  const along = [], across = [];
  for (const r of rs) {
    const [a, b] = r.pts.map(toU), half = (DEFAULT_ROAD_PROFILES[r.profile]?.outerHalf ?? 0) / 1e6;
    if (Math.abs(a.v - b.v) < 0.05) along.push({ r, at: (a.v + b.v) / 2, lo: Math.min(a.u, b.u), hi: Math.max(a.u, b.u), half });
    else if (Math.abs(a.u - b.u) < 0.05) across.push({ r, at: (a.u + b.u) / 2, lo: Math.min(a.v, b.v), hi: Math.max(a.v, b.v), half });
    else return null;   // (not a grid's straight, square roads)
  }
  along.sort((p, q) => p.at - q.at); across.sort((p, q) => p.at - q.at);
  // the point beside the road, on its side, just past its sidewalk
  const A0 = { x: rec.pts[0].x / 1e6, z: rec.pts[0].z / 1e6 }, B0 = { x: rec.pts[1].x / 1e6, z: rec.pts[1].z / 1e6 };
  const L = Math.hypot(B0.x - A0.x, B0.z - A0.z), tx = (B0.x - A0.x) / L, tz = (B0.z - A0.z) / L, sg = side === 'b' ? -1 : 1;
  const half0 = (DEFAULT_ROAD_PROFILES[rec.profile]?.outerHalf ?? 0) / 1e6;
  const P = toU({ x: (A0.x + tx * s - tz * sg * (half0 + 1)) * 1e6, z: (A0.z + tz * s + tx * sg * (half0 + 1)) * 1e6 });
  const ia = across.findIndex((x, i) => i + 1 < across.length && x.at <= P.u && across[i + 1].at >= P.u);
  const ja = along.findIndex((x, j) => j + 1 < along.length && x.at <= P.v && along[j + 1].at >= P.v);
  if (ia < 0 || ja < 0) return null;
  const A = across[ia], B = across[ia + 1], C = along[ja], D = along[ja + 1];
  const spans = (R, lo, hi) => R.lo <= lo + 0.05 && R.hi >= hi - 0.05;
  if (!spans(A, C.at, D.at) || !spans(B, C.at, D.at) || !spans(C, A.at, B.at) || !spans(D, A.at, B.at)) return null;
  const u0 = A.at + A.half, u1 = B.at - B.half, v0 = C.at + C.half, v1 = D.at - D.half;
  if (!(u1 - u0 > 1 && v1 - v0 > 1)) return null;
  // which pair the lots face: the one most of the grid's lots face now, else the road given
  const ids = new Set(rs.map(r => r.id)), alongIds = new Set(along.map(x => x.r.id));
  let nAlong = 0, nAcross = 0;
  for (const l of lots || []) for (const f of l.frontage || []) if (ids.has(f.road)) { if (alongIds.has(f.road)) nAlong++; else nAcross++; }
  const faceAlong = nAlong || nAcross ? nAlong >= nAcross : alongIds.has(rec.id);
  // in the facing pair's terms: front runs along f (from f0 to f1), the rows stack along g (from g0 to g1)
  const [F1, F2, G1, G2, f0, f1, g0, g1] = faceAlong ? [C, D, A, B, u0, u1, v0, v1] : [A, B, C, D, v0, v1, u0, u1];
  const pt = (f, g) => (faceAlong ? toW(f, g) : toW(g, f));
  const lx = Math.max(1, Math.round((f1 - f0) / width)), lz = Math.floor((g1 - g0) / depth + 0.01);
  const ring = [toW(u0, v0), toW(u1, v0), toW(u1, v1), toW(u0, v1)];
  if (lz < 1) return { runs: [], lx, lz: 0, ring, depth: depth - 0.03 };
  const mid = pt((f0 + f1) / 2, (g0 + g1) / 2);
  const run = (R, fa, fb, count) => {
    const a = { x: R.r.pts[0].x / 1e6, z: R.r.pts[0].z / 1e6 }, b = { x: R.r.pts[1].x / 1e6, z: R.r.pts[1].z / 1e6 }, l = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / l, uz = (b.z - a.z) / l;
    const st = q => (q.x - a.x) * ux + (q.z - a.z) * uz, s0 = st(fa), s1 = st(fb);
    return { road: R.r.id, side: (mid.x - a.x) * -uz + (mid.z - a.z) * ux > 0 ? 'a' : 'b', from: Math.min(s0, s1), to: Math.max(s0, s1), count, even: true };
  };
  const E0 = 0.02, runs = [run(F1, pt(f0 + E0, g0), pt(f1 - E0, g0), lx)];
  if (lz >= 2) runs.push(run(F2, pt(f0 + E0, g1), pt(f1 - E0, g1), lx));
  if (lz >= 3 && Math.abs(width - depth) < 0.01) {   // (the rows between, along the other pair: as the grid tool, square lots)
    runs.push(run(G1, pt(f0, g0 + depth - 0.01), pt(f0, g1 - depth + 0.01), lz - 2));
    if (lx >= 2) runs.push(run(G2, pt(f1, g0 + depth - 0.01), pt(f1, g1 - depth + 0.01), lz - 2));
  }
  return { runs, lx, lz, ring, depth: depth - 0.03 };
}

/**
 * The grid's one level: the middle of the ground under it (half cut, half filled), never down at the water. heightAt,
 * isWater(x, z); returns { level, cut, fill (m: the most the land is cut or filled), wet (water samples) }.
 */
export function gridLevel(L, heightAt, isWater, seaLevel, n = 20) {
  const hs = []; let wet = 0;
  const [u0, u1, v0, v1] = L.extent;
  for (let a = 0; a <= n; a++) for (let b = 0; b <= n; b++) {
    const q = L.at(u0 + (u1 - u0) * a / n, v0 + (v1 - v0) * b / n);
    hs.push(heightAt(q.x, q.z)); if (isWater && isWater(q.x, q.z)) wet++;
  }
  hs.sort((a, b) => a - b);
  const level = Math.round(Math.max(hs[hs.length >> 1], seaLevel + 1.5) * 100) / 100;
  return { level, cut: Math.max(0, hs.at(-1) - level), fill: Math.max(0, level - hs[0]), wet };
}
