// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Exact lot geometry and lot rules (WP4.13, wp4-world-spec.md §5). Lots are simple polygons with integer micrometre
// vertices (units.js). Every predicate here is exact: integer inputs, BigInt arithmetic, rational intersection points,
// so two lots either overlap or they don't, areas add up to the last µm², and merges/splits never drift.
// Pure module: server, browser and workers.
import { UM_PER_FT, ftToUm } from './units.js';

const B = BigInt, ZERO = 0n, TWO = 2n;

/** Defaults; installations override them through settings (spec §5.0a). */
export const DEFAULT_LOT_POLICY = Object.freeze({
  /** Standard lot side lengths (µm): 100 × 100 ft. */
  standardLotW: ftToUm(100), standardLotD: ftToUm(100),
  /** Most original lots a holder may join into one lot. */
  maxMergeLots: 4,
  /** 'rectangle': a merge must form a rectangle (1×2, 1×3, 1×4, 2×2 of standard lots); 'any': any side-to-side group. */
  mergeShapes: 'rectangle',
});
/** Building envelope per zoning (spec §5.3): the least setback (m) from every lot line and the most floors. Shared by the
 *  server's checks (server/lot-rights.js) and the browser's placement preview; installations can override it. */
export const DEFAULT_ENVELOPES = Object.freeze({
  residential: { setback: 1.0, maxFloors: 24 }, mixed: { setback: 1.0, maxFloors: 34 }, commercial: { setback: 1.0, maxFloors: 60 },
  industrial: { setback: 2.0, maxFloors: 6 }, civic: { setback: 1.0, maxFloors: 24 }, park: { setback: 0, maxFloors: 1 }, agricultural: { setback: 3.0, maxFloors: 3 },
});
export const ENVELOPE_FALLBACK = Object.freeze({ setback: 1.0, maxFloors: 24 });
/** Lifecycle states in which a holder may merge or unmerge (no lease, listing or hold in the way). */
const MERGEABLE = new Set(['owned', 'municipal']);

// ---------------------------------------------------------------------------------------------------------------
// Polygons
// ---------------------------------------------------------------------------------------------------------------
const isInt = v => Number.isSafeInteger(v);
const key = p => `${p.x},${p.z}`;
function cross3(o, a, b) { return (B(a.x) - B(o.x)) * (B(b.z) - B(o.z)) - (B(a.z) - B(o.z)) * (B(b.x) - B(o.x)); }
const sgn = v => (v > ZERO ? 1 : v < ZERO ? -1 : 0);

/** Twice the signed area (µm², BigInt): positive for counter-clockwise in (x, z). */
export function area2(poly) {
  let s = ZERO;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += B(poly[j].x) * B(poly[i].z) - B(poly[i].x) * B(poly[j].z);
  return s;
}
/** Area in µm² as an exact BigInt pair { twice } plus a float in square feet for display. */
export function area(poly) { const t = area2(poly), a = t < ZERO ? -t : t; return { twice: a, sqft: Number(a) / 2 / (UM_PER_FT * UM_PER_FT) }; }

/**
 * Canonical form: integer vertices, no repeats, no collinear midpoints, counter-clockwise, starting at the smallest
 * (x, then z) vertex. Throws on non-integer coordinates or a degenerate polygon.
 */
export function normalize(poly) {
  const pts = cleanPoints(poly);
  if (pts.length < 3 || area2(pts) === ZERO) throw new LotGeometryError('degenerate', 'The lot has no area.');
  if (area2(pts) < ZERO) pts.reverse();
  let k = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].x < pts[k].x || (pts[i].x === pts[k].x && pts[i].z < pts[k].z)) k = i;
  return pts.slice(k).concat(pts.slice(0, k));
}
/** Integer corners without repeats or collinear midpoints (orientation and area untouched). */
function cleanPoints(poly) {
  if (!Array.isArray(poly) || poly.length < 3) throw new LotGeometryError('points', 'A lot needs at least three corners.');
  let pts = [];
  for (const p of poly) {
    if (!p || !isInt(p.x) || !isInt(p.z)) throw new LotGeometryError('points', 'Lot corners must be whole micrometres.');
    const last = pts.at(-1);
    if (!last || last.x !== p.x || last.z !== p.z) pts.push({ x: p.x, z: p.z });
  }
  if (pts.length > 1 && pts[0].x === pts.at(-1).x && pts[0].z === pts.at(-1).z) pts.pop();
  for (let changed = true; changed && pts.length >= 3;) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      if (cross3(a, b, c) === ZERO) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
}
export class LotGeometryError extends Error { constructor(code, message) { super(message); this.code = code; } }
export const samePolygon = (a, b) => { const A = normalize(a), C = normalize(b); return A.length === C.length && A.every((p, i) => p.x === C[i].x && p.z === C[i].z); };
export function bbox(poly) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return { x0, z0, x1, z1 };
}
const boxesMeet = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;

// Rational numbers as [numerator, denominator] BigInt pairs with a positive denominator.
const rat = (n, d) => (d < ZERO ? [-n, -d] : [n, d]);
const rcmp = (a, b) => sgn(a[0] * b[1] - b[0] * a[1]);

/** Parameters t ∈ [0, 1] (rationals) at which segment a0→a1 meets segment b0→b1, incl. collinear-overlap ends. */
function meetParams(a0, a1, b0, b1) {
  const dax = B(a1.x) - B(a0.x), daz = B(a1.z) - B(a0.z), dbx = B(b1.x) - B(b0.x), dbz = B(b1.z) - B(b0.z);
  const wx = B(b0.x) - B(a0.x), wz = B(b0.z) - B(a0.z), den = dax * dbz - daz * dbx;
  if (den !== ZERO) {
    const ta = rat(wx * dbz - wz * dbx, den), tb = rat(wx * daz - wz * dax, den);
    const inUnit = t => t[0] >= ZERO && t[0] <= t[1];
    return inUnit(ta) && inUnit(tb) ? [ta] : [];
  }
  if (wx * daz - wz * dax !== ZERO) return [];               // parallel, not on one line
  const len2 = dax * dax + daz * daz, out = [];
  for (const p of [b0, b1]) { const t = rat((B(p.x) - B(a0.x)) * dax + (B(p.z) - B(a0.z)) * daz, len2); if (t[0] >= ZERO && t[0] <= t[1]) out.push(t); }
  return out;
}
/** Proper crossing: the two segments cross at one point inside both (not at an end, not collinear). */
function properCross(a0, a1, b0, b1) {
  const d1 = sgn(cross3(b0, b1, a0)), d2 = sgn(cross3(b0, b1, a1)), d3 = sgn(cross3(a0, a1, b0)), d4 = sgn(cross3(a0, a1, b1));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Where a rational point (X/D, Z/D) lies relative to a polygon: 'inside', 'outside' or 'boundary'. Exact.
 */
export function classifyPoint(X, Z, D, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = B(poly[j].x) * D, az = B(poly[j].z) * D, bx = B(poly[i].x) * D, bz = B(poly[i].z) * D;
    const c = (ax - X) * (bz - Z) - (az - Z) * (bx - X);
    if (c === ZERO && X >= (ax < bx ? ax : bx) && X <= (ax > bx ? ax : bx) && Z >= (az < bz ? az : bz) && Z <= (az > bz ? az : bz)) return 'boundary';
    if ((az > Z) !== (bz > Z)) {
      const dz = bz - az, lhs = (X - ax) * dz, rhs = (Z - az) * (bx - ax);
      if (dz > ZERO ? lhs < rhs : lhs > rhs) inside = !inside;
    }
  }
  return inside ? 'inside' : 'outside';
}
const classifyInt = (p, poly) => classifyPoint(B(p.x), B(p.z), 1n, poly);

/** Each piece of polygon A's boundary, cut wherever it meets B: yields the exact midpoint of every piece. */
function* boundaryPieces(A, Bp) {
  const bb = bbox(Bp);
  for (let i = 0; i < A.length; i++) {
    const a0 = A[i], a1 = A[(i + 1) % A.length];
    const ts = [[ZERO, 1n], [1n, 1n]];
    if (boxesMeet(bbox([a0, a1]), bb)) for (let j = 0; j < Bp.length; j++) ts.push(...meetParams(a0, a1, Bp[j], Bp[(j + 1) % Bp.length]));
    ts.sort(rcmp);
    for (let k = 1; k < ts.length; k++) {
      const t0 = ts[k - 1], t1 = ts[k];
      if (rcmp(t0, t1) === 0) continue;
      // midpoint t = (t0 + t1) / 2 → point a0 + t (a1 − a0) with a common denominator.
      const tn = t0[0] * t1[1] + t1[0] * t0[1], td = TWO * t0[1] * t1[1];
      const X = B(a0.x) * td + (B(a1.x) - B(a0.x)) * tn, Z = B(a0.z) * td + (B(a1.z) - B(a0.z)) * tn;
      yield [X, Z, td];
    }
  }
}

/** True when the two lots' interiors overlap (sharing an edge or a corner is not overlapping). Exact. */
export function overlaps(a, b) {
  const A = normalize(a), C = normalize(b);
  if (!boxesMeet(bbox(A), bbox(C))) return false;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < C.length; j++) if (properCross(A[i], A[(i + 1) % A.length], C[j], C[(j + 1) % C.length])) return true;
  for (const [X, Z, D] of boundaryPieces(A, C)) if (classifyPoint(X, Z, D, C) === 'inside') return true;
  for (const [X, Z, D] of boundaryPieces(C, A)) if (classifyPoint(X, Z, D, A) === 'inside') return true;
  return samePolygon(A, C);
}
/** True when polygon `inner` lies within `outer` (touching its boundary allowed). Exact. */
export function contains(outer, inner) {
  const O = normalize(outer), I = normalize(inner);
  for (const p of I) if (classifyInt(p, O) === 'outside') return false;
  for (const [X, Z, D] of boundaryPieces(I, O)) if (classifyPoint(X, Z, D, O) === 'outside') return false;
  return true;
}
/** No edge crosses or touches another except neighbours at their shared corner. */
export function isSimple(poly) {
  const P = cleanPoints(poly), n = P.length;
  if (n < 3 || area2(P) === ZERO) return false;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    if (meetParams(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n]).length) return false;
  }
  return true;
}
/** Exact rectangle test (any rotation): four corners, every corner square. */
export function isRectangle(poly) {
  const P = normalize(poly);
  if (P.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = P[i], b = P[(i + 1) % 4], c = P[(i + 2) % 4];
    if ((B(b.x) - B(a.x)) * (B(c.x) - B(b.x)) + (B(b.z) - B(a.z)) * (B(c.z) - B(b.z)) !== ZERO) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Union of lots that join side to side
// ---------------------------------------------------------------------------------------------------------------
/**
 * The single polygon covering lots that join side to side, or a LotGeometryError:
 * 'overlap' (two lots overlap), 'apart' (not one side-to-side group: separate, or touching only at a corner),
 * 'hole' (the group would enclose land that isn't part of it). Also returns which lots share sides.
 */
export function unionLots(polys) {
  const P = polys.map(normalize);
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) if (overlaps(P[i], P[j])) throw new LotGeometryError('overlap', 'Two of these lots overlap.');
  // Directed edges, split at every other polygon's corners that lie on them, so shared sides cancel exactly.
  const corners = P.flat();
  const edges = [];
  P.forEach((poly, owner) => {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const cuts = [];
      for (const c of corners) {
        if ((c.x === a.x && c.z === a.z) || (c.x === b.x && c.z === b.z) || cross3(a, b, c) !== ZERO) continue;
        const t = (B(c.x) - B(a.x)) * (B(b.x) - B(a.x)) + (B(c.z) - B(a.z)) * (B(b.z) - B(a.z)), len2 = (B(b.x) - B(a.x)) ** 2n + (B(b.z) - B(a.z)) ** 2n;
        if (t > ZERO && t < len2) cuts.push({ t, c });
      }
      cuts.sort((u, v) => sgn(u.t - v.t));
      let prev = a;
      for (const { c } of cuts) { if (c.x !== prev.x || c.z !== prev.z) { edges.push({ a: prev, b: c, owner }); prev = c; } }
      edges.push({ a: prev, b, owner });
    }
  });
  const byKey = new Map();
  for (const e of edges) { const k = `${key(e.a)}>${key(e.b)}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(e); }
  const adjacent = P.map(() => new Set()), keep = [];
  for (const e of edges) {
    const rev = byKey.get(`${key(e.b)}>${key(e.a)}`);
    if (rev && rev.length) { for (const r of rev) { adjacent[e.owner].add(r.owner); adjacent[r.owner].add(e.owner); } continue; }
    keep.push(e);
  }
  // Every lot must be reachable through shared sides.
  const seen = new Set([0]), stack = [0];
  while (stack.length) for (const n of adjacent[stack.pop()]) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  if (seen.size !== P.length) throw new LotGeometryError('apart', 'These lots don\'t all join side to side.');
  // Chain the outer edges into one loop.
  const out = new Map();
  for (const e of keep) { const k = key(e.a); if (out.has(k)) throw new LotGeometryError('apart', 'These lots only touch at a corner.'); out.set(k, e); }
  if (!keep.length) throw new LotGeometryError('degenerate', 'Nothing to merge.');
  const loop = [], start = keep[0];
  for (let e = start, guard = 0; guard <= keep.length; guard++) {
    loop.push(e.a);
    e = out.get(key(e.b));
    if (!e) throw new LotGeometryError('apart', 'These lots don\'t form one outline.');
    if (e === start) break;
  }
  if (loop.length !== keep.length) throw new LotGeometryError('hole', 'Merging these lots would surround land that isn\'t part of them.');
  const poly = normalize(loop), total = P.reduce((s, p) => s + area2(p), ZERO);
  if (area2(poly) !== total) throw new LotGeometryError('hole', 'Merging these lots would surround land that isn\'t part of them.');
  return { poly, adjacent: adjacent.map(s => [...s]) };
}

// ---------------------------------------------------------------------------------------------------------------
// Lot rules (spec §5.0, §5.0a, §5.5)
// ---------------------------------------------------------------------------------------------------------------
const sameSubject = (a, b) => !!a && !!b && a.kind === b.kind && String(a.id) === String(b.id);

/**
 * Can `actor` merge these lots? Lots: { id, poly, holder:{kind,id}, zoning, lifecycle, origins (original lots inside,
 * ≥ 1), encumbrances? }. `admin` lifts the holder rules (administrators plat without the merge limit).
 * Returns { ok, problems: [{code, message}], merged?: { poly, origins, areaTwice, parents } }.
 */
export function checkMerge(lots, { actor, admin = false, policy = DEFAULT_LOT_POLICY } = {}) {
  const problems = [], add = (code, message) => problems.push({ code, message });
  if (!Array.isArray(lots) || lots.length < 2) { add('count', 'Choose at least two lots to merge.'); return { ok: false, problems }; }
  if (new Set(lots.map(l => l.id)).size !== lots.length) add('count', 'A lot is listed twice.');
  const origins = lots.reduce((n, l) => n + (Number.isInteger(l.origins) && l.origins > 0 ? l.origins : 1), 0);
  if (!admin) {
    const holder = lots[0].holder;
    if (!lots.every(l => sameSubject(l.holder, holder))) add('holder', 'All the lots must have the same holder.');
    if (!sameSubject(actor, holder)) add('rights', 'Only the lots\' holder can merge them.');
    if (origins > policy.maxMergeLots) add('limit', `A merged lot can hold at most ${policy.maxMergeLots} lots; this would be ${origins}.`);
    for (const l of lots) {
      if (!MERGEABLE.has(l.lifecycle)) add('state', `Lot ${l.id} is ${l.lifecycle} and can't be merged now.`);
      if (l.encumbrances?.length) add('state', `Lot ${l.id} is leased, listed or on hold.`);
    }
  }
  if (!lots.every(l => l.zoning === lots[0].zoning)) add('zoning', 'The lots have different zoning.');
  let merged = null;
  try {
    const u = unionLots(lots.map(l => l.poly));
    if (!admin && policy.mergeShapes === 'rectangle' && !isRectangle(u.poly)) add('shape', 'Merged lots must form a rectangle (side by side in a row, or 2 × 2).');
    merged = { poly: u.poly, origins, areaTwice: area2(u.poly), parents: lots.map(l => l.id) };
  } catch (e) { if (e instanceof LotGeometryError) add(e.code, e.message); else throw e; }
  return problems.length ? { ok: false, problems } : { ok: true, problems, merged };
}

/**
 * Can a merged lot be split back into the original lots it came from? `originals` are the predecessor polygons from
 * its lineage; `footprints` the polygons of buildings standing on it. A building may not cross an original line.
 */
export function checkUnmerge(lot, originals, footprints = [], { actor, admin = false } = {}) {
  const problems = [], add = (code, message) => problems.push({ code, message });
  if (!admin) {
    if (!sameSubject(actor, lot.holder)) add('rights', 'Only the lot\'s holder can split it.');
    if (!MERGEABLE.has(lot.lifecycle) || lot.encumbrances?.length) add('state', 'The lot is leased, listed or on hold.');
  }
  try {
    const u = unionLots(originals);
    if (!samePolygon(u.poly, lot.poly)) add('lineage', 'The original lots no longer make up this lot.');
  } catch (e) { if (e instanceof LotGeometryError) add('lineage', 'The original lots no longer make up this lot.'); else throw e; }
  footprints.forEach((f, i) => { if (!originals.some(o => contains(o, f))) add('building', `Building ${i + 1} stands across an original lot line.`); });
  return { ok: !problems.length, problems };
}

/** Split [0, total) into n whole-µm parts as equal as possible (the first parts take the leftover µm). */
function parts(total, n) { const base = Math.floor(total / n), extra = total - base * n; return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0)); }

/**
 * Plat an axis-aligned rectangle (µm, e.g. a block inside its sidewalks) into lots as close to the standard size as
 * its sides allow: columns = round(width / standard), rows likewise (at least 1), sizes differing by at most 1 µm.
 * Returns polygons that cover the rectangle exactly, row by row.
 */
export function platRectangle({ x0, z0, x1, z1 }, { lotW = DEFAULT_LOT_POLICY.standardLotW, lotD = DEFAULT_LOT_POLICY.standardLotD, cols, rows } = {}) {
  if (![x0, z0, x1, z1].every(isInt) || x1 <= x0 || z1 <= z0) throw new LotGeometryError('points', 'Bad rectangle.');
  const W = x1 - x0, D = z1 - z0, nc = cols ?? Math.max(1, Math.round(W / lotW)), nr = rows ?? Math.max(1, Math.round(D / lotD));
  const cw = parts(W, nc), rd = parts(D, nr), out = [];
  let z = z0;
  for (const d of rd) {
    let x = x0;
    for (const w of cw) { out.push([{ x, z }, { x: x + w, z }, { x: x + w, z: z + d }, { x, z: z + d }]); x += w; }
    z += d;
  }
  return out;
}

/**
 * Check a set of lots against the partition invariants (spec §5.4 1): none overlap, and (optionally) they cover
 * `region` exactly together with the listed public polygons. Uses a bounding-box sweep, exact tests.
 * Returns problems: [{ code, message, lots? }].
 */
export function checkPartition(lots, { region = null, publicAreas = [] } = {}) {
  const problems = [], items = lots.map(l => ({ id: l.id, P: normalize(l.poly) }));
  for (const it of items) { it.b = bbox(it.P); if (!isSimple(it.P)) problems.push({ code: 'simple', message: `Lot ${it.id} crosses itself.`, lots: [it.id] }); }
  const order = [...items].sort((a, b) => a.b.x0 - b.b.x0);
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length && order[j].b.x0 <= order[i].b.x1; j++) {
    if (boxesMeet(order[i].b, order[j].b) && overlaps(order[i].P, order[j].P)) problems.push({ code: 'overlap', message: `Lots ${order[i].id} and ${order[j].id} overlap.`, lots: [order[i].id, order[j].id] });
  }
  if (region) {
    const R = normalize(region), total = items.reduce((s, it) => s + area2(it.P), ZERO) + publicAreas.reduce((s, p) => s + area2(normalize(p)), ZERO);
    for (const it of items) if (!contains(R, it.P)) problems.push({ code: 'outside', message: `Lot ${it.id} reaches outside its region.`, lots: [it.id] });
    // Coverage by areas is only meaningful once every lot is inside and none overlap; fix those first.
    if (total !== area2(R) && !problems.some(p => p.code === 'overlap' || p.code === 'outside')) problems.push({ code: 'cover', message: 'Lots and public land don\'t cover the region exactly.' });
  }
  return problems;
}
