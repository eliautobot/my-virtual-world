// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Indoor / park navigation grid: shared by the server (pathfinding) and the client (player collision).
// Coordinates are building-local metres (origin = footprint centre).
import { CATALOG } from './catalog.js';
import { CELL, WALL_T } from './constants.js';
import { inItemRect, segDist, itemAABB, itemRect } from './geom.js';

const INFLATE = 0.17;     // item clearance
const WALL_CLEAR = 0.2;   // interior wall clearance (from wall centre-line, includes half thickness)
const WALL_EXT = 0.05;    // walls count as this much longer at both ends, so no move slips past a wall end or a corner
// Wall edges: bits per cell for the moves to its neighbours that cross a wall (g.edge). Blocking cells near a wall is
// not enough on its own: cell centres are 0.5 m apart, so a wall lying between two rows of centres blocks no cell.
const E_E = 1, E_S = 2, E_SE = 4, E_SW = 8;   // to (i+1, j), (i, j+1), (i+1, j+1), (i-1, j+1)

export function buildGrid(b, level) {
  const open = b.type === 'park';
  const m = open ? 0 : WALL_T;
  const x0 = -b.w / 2 + m, z0 = -b.d / 2 + m;
  const gw = Math.max(1, Math.floor((b.w - 2 * m) / CELL)), gh = Math.max(1, Math.floor((b.d - 2 * m) / CELL));
  const blocked = new Uint8Array(gw * gh), edge = new Uint8Array(gw * gh), walls = extendWalls(level.walls);
  const g = { gw, gh, x0, z0, cell: CELL, blocked, open, edge, walls, items: level.items || [] };
  const cellRange = (bb) => [
    Math.max(0, Math.floor((bb.x0 - x0) / CELL)), Math.max(0, Math.floor((bb.z0 - z0) / CELL)),
    Math.min(gw - 1, Math.floor((bb.x1 - x0) / CELL)), Math.min(gh - 1, Math.floor((bb.z1 - z0) / CELL)),
  ];
  for (const it of level.items || []) {
    const def = CATALOG[it.t]; if (!def || def.block === false) continue;
    const bb = itemAABB(it, def.rect, INFLATE + CELL);
    const [a, c, bI, d] = cellRange(bb);
    for (let j = c; j <= d; j++) for (let i = a; i <= bI; i++) {
      const cx = x0 + (i + 0.5) * CELL, cz = z0 + (j + 0.5) * CELL;
      if (inItemRect(cx, cz, it.x, it.z, it.r || 0, itemRect(it, def.rect), INFLATE)) blocked[j * gw + i] = 2;   // 2: furniture (may be stood on, shared/standable.js); walls below: 1
    }
  }
  for (const w of level.walls || []) {
    const bb = { x0: Math.min(w[0], w[2]) - 0.6, z0: Math.min(w[1], w[3]) - 0.6, x1: Math.max(w[0], w[2]) + 0.6, z1: Math.max(w[1], w[3]) + 0.6 };
    const [a, c, bI, d] = cellRange(bb);
    for (let j = c; j <= d; j++) for (let i = a; i <= bI; i++) {
      const cx = x0 + (i + 0.5) * CELL, cz = z0 + (j + 0.5) * CELL;
      if (segDist(cx, cz, w[0], w[1], w[2], w[3]) < WALL_CLEAR) blocked[j * gw + i] = 1;
    }
  }
  for (let k = 0; k < walls.length; k += 4) {
    const ax = walls[k], az = walls[k + 1], bx = walls[k + 2], bz = walls[k + 3];
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - x0) / CELL) - 1), i1 = Math.min(gw - 1, Math.floor((Math.max(ax, bx) - x0) / CELL) + 1);
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - z0) / CELL) - 1), j1 = Math.min(gh - 1, Math.floor((Math.max(az, bz) - z0) / CELL) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = x0 + (i + 0.5) * CELL, cz = z0 + (j + 0.5) * CELL, c = j * gw + i;
      if (i + 1 < gw && segCross(cx, cz, cx + CELL, cz, ax, az, bx, bz)) edge[c] |= E_E;
      if (j + 1 < gh) {
        if (segCross(cx, cz, cx, cz + CELL, ax, az, bx, bz)) edge[c] |= E_S;
        if (i + 1 < gw && segCross(cx, cz, cx + CELL, cz + CELL, ax, az, bx, bz)) edge[c] |= E_SE;
        if (i > 0 && segCross(cx, cz, cx - CELL, cz + CELL, ax, az, bx, bz)) edge[c] |= E_SW;
      }
    }
  }
  return g;
}
/** Interior walls as a flat array [ax, az, bx, bz, ...], each WALL_EXT longer at both ends. */
function extendWalls(list) {
  const out = [];
  for (const w of list || []) {
    const dx = w[2] - w[0], dz = w[3] - w[1], L = Math.hypot(dx, dz);
    if (!(L > 1e-6)) continue;
    const ux = dx / L * WALL_EXT, uz = dz / L * WALL_EXT;
    out.push(w[0] - ux, w[1] - uz, w[2] + ux, w[3] + uz);
  }
  return Float64Array.from(out);
}
/** Whether segment a-b properly crosses segment c-d. */
export function segCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
}
/** Whether an interior wall of the grid's level crosses the straight line from (ax, az) to (bx, bz). */
export function wallBetween(g, ax, az, bx, bz) {
  const W = g.walls;
  if (!W || !W.length) return false;
  const minx = Math.min(ax, bx), maxx = Math.max(ax, bx), minz = Math.min(az, bz), maxz = Math.max(az, bz);
  for (let k = 0; k < W.length; k += 4) {
    const cx = W[k], cz = W[k + 1], dx = W[k + 2], dz = W[k + 3];
    if (Math.max(cx, dx) < minx || Math.min(cx, dx) > maxx || Math.max(cz, dz) < minz || Math.min(cz, dz) > maxz) continue;
    if (segCross(ax, az, bx, bz, cx, cz, dx, dz)) return true;
  }
  return false;
}
/** Whether (x, z) is closer than r to an interior wall's centre line (collision for the player). */
export function nearWall(g, x, z, r) {
  const W = g.walls;
  if (!W) return false;
  for (let k = 0; k < W.length; k += 4) if (segDist(x, z, W[k], W[k + 1], W[k + 2], W[k + 3]) < r) return true;
  return false;
}
/** Whether the move from cell (i, j) to its neighbour (i + di, j + dj) crosses a wall. */
export function edgeCut(g, i, j, di, dj) {
  const e = g.edge, gw = g.gw;
  if (!e) return false;
  if (dj === 0) return (e[j * gw + (di > 0 ? i : i - 1)] & E_E) !== 0;
  if (di === 0) return (e[(dj > 0 ? j : j - 1) * gw + i] & E_S) !== 0;
  if (di === dj) return (e[dj > 0 ? j * gw + i : (j - 1) * gw + i - 1] & E_SE) !== 0;
  return (e[dj > 0 ? j * gw + i : (j - 1) * gw + i + 1] & E_SW) !== 0;
}

export function cellOf(g, x, z) {
  const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((z - g.z0) / g.cell);
  if (i < 0 || j < 0 || i >= g.gw || j >= g.gh) return -1;
  return j * g.gw + i;
}
export function cellCenter(g, c, out = {}) {
  out.x = g.x0 + ((c % g.gw) + 0.5) * g.cell; out.z = g.z0 + (Math.floor(c / g.gw) + 0.5) * g.cell;
  return out;
}
export function walkable(g, x, z) { const c = cellOf(g, x, z); return c >= 0 && !g.blocked[c]; }
/** Whether (x, z) is blocked by furniture only (no wall): a body high enough may stand there (shared/standable.js). */
export function furnitureOnly(g, x, z) { const c = cellOf(g, x, z); return c >= 0 && g.blocked[c] === 2; }
export const ITEM_CLEAR = INFLATE;

/** Nearest walkable cell to (x, z) that no wall separates from it, searched in rings of cells (bounded). When no such
 *  cell lies within maxR rings, the nearest walkable cell on any side. -1 when there is none. */
export function nearestFree(g, x, z, maxR = 12) {
  let i0 = Math.floor((x - g.x0) / g.cell), j0 = Math.floor((z - g.z0) / g.cell);
  i0 = Math.min(Math.max(i0, 0), g.gw - 1); j0 = Math.min(Math.max(j0, 0), g.gh - 1);
  const c0 = j0 * g.gw + i0, x0c = g.x0 + (i0 + 0.5) * g.cell, z0c = g.z0 + (j0 + 0.5) * g.cell;
  if (!g.blocked[c0] && !wallBetween(g, x, z, x0c, z0c)) return c0;
  let best = -1, bd = 1e9, any = g.blocked[c0] ? -1 : c0, ad = any >= 0 ? (x0c - x) ** 2 + (z0c - z) ** 2 : 1e9;
  for (let r = 1; r <= maxR; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= g.gw || j >= g.gh) continue;
      const c = j * g.gw + i; if (g.blocked[c]) continue;
      const px = g.x0 + (i + 0.5) * g.cell, pz = g.z0 + (j + 0.5) * g.cell, dd = (px - x) ** 2 + (pz - z) ** 2;
      if (dd < ad) { ad = dd; any = c; }
      if (dd < bd && !wallBetween(g, x, z, px, pz)) { bd = dd; best = c; }
    }
    if (best >= 0) return best;
  }
  return any;
}

/** 8-connected flood fill from seed cells -> Uint8Array reach mask. */
export function flood(g, seeds) {
  const N = g.gw * g.gh, reach = new Uint8Array(N), q = new Int32Array(N);
  let h = 0, t = 0;
  for (const s of seeds) if (s >= 0 && !g.blocked[s] && !reach[s]) { reach[s] = 1; q[t++] = s; }
  while (h < t) {
    const c = q[h++], ci = c % g.gw, cj = (c / g.gw) | 0;
    for (let dj = -1; dj <= 1; dj++) {
      const nj = cj + dj; if (nj < 0 || nj >= g.gh) continue;
      for (let di = -1; di <= 1; di++) {
        const ni = ci + di; if ((!di && !dj) || ni < 0 || ni >= g.gw) continue;
        const n = nj * g.gw + ni; if (reach[n] || g.blocked[n]) continue;
        if (di && dj && (g.blocked[cj * g.gw + ni] || g.blocked[nj * g.gw + ci])) continue;
        if (edgeCut(g, ci, cj, di, dj)) continue;
        reach[n] = 1; q[t++] = n;
      }
    }
  }
  return reach;
}

/** Straight-line walkability test: no wall crossed, and no blocked cell (samples every quarter cell). */
export function lineFree(g, ax, az, bx, bz) {
  if (wallBetween(g, ax, az, bx, bz)) return false;
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(L / (g.cell * 0.25)));
  for (let k = 0; k <= n; k++) {
    const t = k / n, c = cellOf(g, ax + dx * t, az + dz * t);
    if (c < 0 || g.blocked[c]) return false;
  }
  return true;
}

// ---- A* (8-connected, octile) with reusable scratch buffers ----
let S = null;
function scratch(n) {
  if (!S || S.n < n) {
    S = { n, g: new Float32Array(n), f: new Float32Array(n), par: new Int32Array(n), mark: new Uint32Array(n), closed: new Uint32Array(n), heap: new Int32Array(n * 4), gen: 0 };
  }
  S.gen++; if (S.gen > 0xfffffff0) { S.mark.fill(0); S.closed.fill(0); S.gen = 1; }
  return S;
}
const SQ2 = Math.SQRT2;
export function findPath(g, sx, sz, ex, ez) {
  const N = g.gw * g.gh, s = scratch(N), gen = s.gen;
  const sc = nearestFree(g, sx, sz), ec = nearestFree(g, ex, ez);   // own cell unless blocked or across a wall
  if (sc < 0 || ec < 0) return null;
  const gw = g.gw, gh = g.gh, bl = g.blocked;
  const ei = ec % gw, ej = (ec / gw) | 0;
  const H = (c) => { const di = Math.abs((c % gw) - ei), dj = Math.abs(((c / gw) | 0) - ej); return (di + dj) + (SQ2 - 2) * Math.min(di, dj); };
  let hn = 0; const heap = s.heap, fv = s.f, gv = s.g;
  const push = (c) => { let i = hn++; heap[i] = c; while (i > 0) { const p = (i - 1) >> 1; if (fv[heap[p]] <= fv[c]) break; heap[i] = heap[p]; i = p; } heap[i] = c; };
  const pop = () => {
    const top = heap[0], last = heap[--hn]; let i = 0;
    if (hn > 0) {
      for (;;) { let l = 2 * i + 1; if (l >= hn) break; const r = l + 1; if (r < hn && fv[heap[r]] < fv[heap[l]]) l = r; if (fv[heap[l]] >= fv[last]) break; heap[i] = heap[l]; i = l; }
      heap[i] = last;
    }
    return top;
  };
  s.mark[sc] = gen; gv[sc] = 0; fv[sc] = H(sc); s.par[sc] = -1; push(sc);
  let found = false, iter = 0;
  while (hn > 0) {
    const c = pop();
    if (s.closed[c] === gen) continue;
    s.closed[c] = gen;
    if (c === ec) { found = true; break; }
    if (++iter > N * 2) break;
    const ci = c % gw, cj = (c / gw) | 0, gc = gv[c];
    for (let dj = -1; dj <= 1; dj++) {
      const nj = cj + dj; if (nj < 0 || nj >= gh) continue;
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di; if (ni < 0 || ni >= gw) continue;
        const n = nj * gw + ni; if (bl[n]) continue;
        if (di && dj && (bl[cj * gw + ni] || bl[nj * gw + ci])) continue; // no corner cutting
        if (edgeCut(g, ci, cj, di, dj)) continue;                          // no walking through walls
        if (s.closed[n] === gen) continue;
        const ng = gc + (di && dj ? SQ2 : 1);
        if (s.mark[n] !== gen || ng < gv[n]) {
          s.mark[n] = gen; gv[n] = ng; fv[n] = ng + H(n); s.par[n] = c; push(n);
        }
      }
    }
  }
  if (!found) return null;
  // Reconstruct cells -> points
  const cells = [];
  for (let c = ec; c >= 0; c = s.par[c]) { cells.push(c); if (c === sc) break; }
  cells.reverse();
  // Every cell centre, including the first and last, so no leg between the exact end points and the grid is left
  // unchecked; smoothPath drops the ones a straight line can skip.
  const pts = [[sx, sz]];
  const tmp = {};
  for (let k = 0; k < cells.length; k++) {
    cellCenter(g, cells[k], tmp);
    const q = pts[pts.length - 1];
    if (Math.abs(tmp.x - q[0]) + Math.abs(tmp.z - q[1]) > 0.01) pts.push([tmp.x, tmp.z]);
  }
  const q = pts[pts.length - 1];
  if (pts.length > 1 && Math.abs(ex - q[0]) + Math.abs(ez - q[1]) <= 0.01) pts[pts.length - 1] = [ex, ez];
  else pts.push([ex, ez]);
  return smoothPath(g, pts);
}
/** Greedy string-pulling with line-of-sight checks. */
export function smoothPath(g, pts) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && !lineFree(g, pts[a][0], pts[a][1], pts[b][0], pts[b][1])) b--;
    out.push(pts[b]); a = b;
  }
  return out;
}
export function pathLength(pts) { let L = 0; for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); return L; }
