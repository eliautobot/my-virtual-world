// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Road network model (WP4.1, wp4-world-spec.md §3–4): road types, alignments made of straight lines and circular
// arcs, derived junctions at any angle, and the spatial queries the editor, renderer and simulation share.
// Pure module (no THREE, no DOM): runs in the server, the browser and workers.
//
// Storage: an alignment is a chain of points in integer micrometres (units.js) with an optional fillet radius at each
// interior point. A point with radius 0 is a sharp joint; a radius > 0 rounds the corner with a circular arc tangent to
// both straights, so curves are tangent-continuous where wanted and every value stays exact in storage.
// Geometry and queries run in metres (floating point) from the stored integers.
import { UM_PER_M, isUm, ftToUm, mToUm } from './units.js';
import { SIDEWALK } from './constants.js';

const TAU = Math.PI * 2;
/** Points closer than this are the same place (m). Stored geometry is exact; this only absorbs arc rounding. */
export const ROAD_EPS = 1e-6;
/** An alignment end within this distance of another road's centreline meets it (m). */
export const TOUCH_TOL = 0.01;
/** Junction events closer than this are one junction (m). */
export const CLUSTER_TOL = 0.05;
/** Arms within this angle of straight-through are one through road (rad). */
export const STRAIGHT_TOL = 10 * Math.PI / 180;
/** Largest deflection at one alignment point (rad); a sharper turn must be two roads meeting at a junction. */
export const MAX_DEFLECTION = 170 * Math.PI / 180;
/** Spatial index cell: one world chunk, 400 ft (m). */
export const INDEX_CELL_M = 121.92;

// ---------------------------------------------------------------------------------------------------------------
// Road types (profiles). Half-widths are measured from the centreline outwards, in µm:
//   centre marking/2 · lanes · shoulder · gutter  →  carriageHalf (curb face)  →  curb  →  sidewalk  →  outerHalf
// (outerHalf is the back of the sidewalk, where lots begin). Lanes list the right-hand lanes of one direction
// (centre offset and width); the other direction mirrors them.
// ---------------------------------------------------------------------------------------------------------------
const FT = ftToUm, M = mToUm, MPH = v => Math.round(v * 0.44704 * 1000) / 1000;
const freeze = o => { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };

/** Build a validated road type from its parts (µm). Throws with a readable message on bad input. */
export function makeProfile(def) {
  const p = { ...def };
  for (const k of ['carriageHalf', 'curb', 'sidewalk', 'shoulder', 'gutter', 'centre']) {
    p[k] = p[k] ?? 0;
    if (!isUm(p[k]) || p[k] < 0) throw new Error(`road type ${def.id}: ${k} must be a non-negative length`);
  }
  if (!p.id || typeof p.id !== 'string') throw new Error('road type needs an id');
  if (!Array.isArray(p.lanes) || !p.lanes.length) throw new Error(`road type ${p.id}: needs at least one lane per direction`);
  p.lanes = p.lanes.map(l => {
    if (!isUm(l.offset) || !isUm(l.width) || l.width <= 0 || l.offset - l.width / 2 < 0) throw new Error(`road type ${p.id}: bad lane`);
    return { offset: l.offset, width: l.width };
  });
  if (!(p.carriageHalf > 0)) throw new Error(`road type ${p.id}: carriageHalf must be positive`);
  const laneEdge = Math.max(...p.lanes.map(l => l.offset + l.width / 2));
  if (laneEdge > p.carriageHalf) throw new Error(`road type ${p.id}: lanes are wider than the roadway`);
  p.outerHalf = p.carriageHalf + p.curb + p.sidewalk;
  p.maxGrade = p.maxGrade ?? 0.08;
  if (!(p.maxGrade > 0 && p.maxGrade < 0.5)) throw new Error(`road type ${p.id}: maxGrade must be a fraction between 0 and 0.5`);
  // Speed limit (m/s): what traffic drives at on straight road (slower on curves and through junctions).
  p.speedLimit = p.speedLimit ?? MPH(30);
  if (!(p.speedLimit > 0 && p.speedLimit <= 45)) throw new Error(`road type ${p.id}: speedLimit must be a speed in m/s above 0 and at most 45`);
  /** Tightest centreline radius: the inner back of sidewalk must still be a real curve. */
  p.minRadius = p.minRadius ?? p.outerHalf + M(1);
  return freeze(p);
}

// The classic street profile (tile = 4 ft): sidewalk 2.0, curb 0.3, gutter 0.35, lane 3.0, centre 0.3 tiles; the shoulder
// variant adds a 10 ft bike lane/shoulder each side (the classic release's "STREET_VARIANTS"). Next's avenue is today's city
// street: 14 m curb to curb, lanes centred 1.85 m and 5.0 m from the centreline, a 4.5 m sidewalk (constants.js).
const ftClassic = (shoulderFt) => ({
  centre: FT(1.2), gutter: FT(1.4), shoulder: FT(shoulderFt), curb: FT(1.2), sidewalk: FT(8),
  carriageHalf: FT(0.6 + 12 + shoulderFt + 1.4), lanes: [{ offset: FT(0.6 + 6), width: FT(12) }],
});
export const DEFAULT_ROAD_PROFILES = freeze({
  'two-lane': makeProfile({ id: 'two-lane', label: '2 Lane Roadway', description: 'Two 12 ft travel lanes with a centre line.', ...ftClassic(0), maxGrade: 0.1, speedLimit: MPH(30) }),
  'two-lane-shoulder': makeProfile({ id: 'two-lane-shoulder', label: '2 Lane Roadway + Shoulder', description: 'Two 12 ft travel lanes plus a 10 ft bike lane / shoulder on each side.', ...ftClassic(10), maxGrade: 0.1, speedLimit: MPH(35) }),
  'country': makeProfile({ id: 'country', label: 'Country Road', description: 'Two 12 ft lanes with 4 ft gravel shoulders, no sidewalks.',
    centre: FT(1.2), gutter: 0, shoulder: FT(4), curb: 0, sidewalk: 0, carriageHalf: FT(0.6 + 12 + 4), lanes: [{ offset: FT(0.6 + 6), width: FT(12) }], maxGrade: 0.09, speedLimit: MPH(55) }),
  // The city avenue (2026-10-03): two 11 ft lanes each way either side of a double yellow line, a 10 ft parking lane
  // each side (cars park without blocking the through lanes), gutter, curb and the city's sidewalk.
  'avenue-4': makeProfile({ id: 'avenue-4', label: '4 Lane Avenue', description: 'Two 11 ft lanes each way, a double yellow centre line and a 10 ft parking lane each side, with curbs and sidewalks; the city street.',
    centre: FT(1), lanes: [{ offset: FT(6), width: FT(11) }, { offset: FT(17), width: FT(11) }], parking: true, centreLine: 'double', gutter: FT(1.5), shoulder: FT(10),
    carriageHalf: FT(34), curb: FT(0.5), sidewalk: M(SIDEWALK) - FT(0.5), maxGrade: 0.06, speedLimit: MPH(30) }),   // curb + sidewalk = the city's 4.5 m
  // Today's city street (14 m curb to curb, no parking lanes), until the city's grid is widened to the avenue above.
  'city-14': makeProfile({ id: 'city-14', label: 'City street (14 m)', description: 'The city grid\'s street before it was widened.', hidden: true,
    carriageHalf: M(7), curb: 0, sidewalk: M(SIDEWALK), centre: 0, centreLine: 'double', lanes: [{ offset: M(1.85), width: M(3.1) }, { offset: M(5), width: M(3.2) }], maxGrade: 0.06, speedLimit: MPH(30) }),
});
/** Road types in use: the defaults plus any an installation adds or overrides (validated). */
export function resolveProfiles(overrides = {}) {
  const out = { ...DEFAULT_ROAD_PROFILES };
  for (const [id, def] of Object.entries(overrides || {})) out[id] = makeProfile({ ...def, id });
  return freeze(out);
}

// ---------------------------------------------------------------------------------------------------------------
// Alignment geometry
// ---------------------------------------------------------------------------------------------------------------
const toM = u => u / UM_PER_M;
const perp = (dx, dz) => [-dz, dx];
const normAng = a => { a %= TAU; return a < 0 ? a + TAU : a; };
const cross = (ax, az, bx, bz) => ax * bz - az * bx;

/**
 * Check one alignment record. Returns a list of problems (empty when valid); each is { code, message, point? }.
 * Record: { id, profile, name?, closed?, pts: [{ x, z, r? }] } with x, z, r in µm.
 */
export function checkAlignment(al, profiles = DEFAULT_ROAD_PROFILES) {
  const out = [], add = (code, message, point) => out.push(point === undefined ? { code, message } : { code, message, point });
  if (!al || typeof al.id !== 'string' || !al.id) { add('id', 'The road has no id.'); return out; }
  const prof = profiles[al.profile];
  if (!prof) add('profile', `Unknown road type "${al.profile}".`);
  const pts = al.pts;
  if (!Array.isArray(pts) || pts.length < 2) { add('points', 'A road needs at least two points.'); return out; }
  if (al.closed && pts.length < 3) { add('points', 'A loop needs at least three points.'); return out; }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p || !isUm(p.x) || !isUm(p.z) || (p.r !== undefined && (!isUm(p.r) || p.r < 0))) { add('point', `Point ${i + 1} is not a valid position.`, i); return out; }
  }
  if (out.length) return out;
  try { alignmentGeometry(al, profiles); } catch (e) { add(e.code || 'geometry', e.message, e.point); }
  return out;
}

class GeometryError extends Error { constructor(code, message, point) { super(message); this.code = code; this.point = point; } }

/**
 * Derived geometry in metres: { id, profile, closed, length, segs, bbox }.
 * segs: { type:'line', ax, az, bx, bz, dx, dz, len, s0 } | { type:'arc', cx, cz, r, a0, sweep, len, s0, ax, az, bx, bz }.
 * Throws GeometryError for zero-length legs, over-sharp turns and fillets that don't fit.
 */
export function alignmentGeometry(al, profiles = DEFAULT_ROAD_PROFILES) {
  const prof = profiles[al.profile];
  const P = al.pts.map(p => ({ x: toM(p.x), z: toM(p.z), r: toM(p.r || 0) }));
  const n = P.length, closed = !!al.closed;
  const legs = closed ? n : n - 1;
  const legDir = [];
  for (let i = 0; i < legs; i++) {
    const a = P[i], b = P[(i + 1) % n], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    if (L < ROAD_EPS * 10) throw new GeometryError('zero', `Points ${i + 1} and ${(i + 1) % n + 1} are in the same place.`, i);
    legDir.push({ dx: dx / L, dz: dz / L, L });
  }
  // Fillet at each vertex that has a leg on both sides.
  const fil = P.map(() => null);
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue;
    const din = legDir[(i - 1 + legs) % legs], dout = legDir[i % legs];
    const c = cross(din.dx, din.dz, dout.dx, dout.dz), d = din.dx * dout.dx + din.dz * dout.dz, delta = Math.atan2(c, d);
    if (Math.abs(delta) > MAX_DEFLECTION) throw new GeometryError('sharp', `The road turns back on itself at point ${i + 1}; end it there and start another road.`, i);
    const r = P[i].r;
    if (r <= 0 || Math.abs(delta) < 1e-9) { fil[i] = { T: 0, delta, r: 0 }; continue; }
    if (prof && r < toM(prof.minRadius) - ROAD_EPS) throw new GeometryError('radius', `The curve at point ${i + 1} is too tight for this road type (at least ${Math.ceil(toM(prof.minRadius) / 0.3048)} ft).`, i);
    fil[i] = { T: r * Math.tan(Math.abs(delta) / 2), delta, r };
  }
  for (let i = 0; i < legs; i++) {
    const t0 = fil[i]?.T || 0, t1 = fil[(i + 1) % n]?.T || 0;
    if (t0 + t1 > legDir[i].L + ROAD_EPS) throw new GeometryError('fit', `The curves at points ${i + 1} and ${(i + 1) % n + 1} don't fit on the straight between them; use smaller radii or move the points apart.`, (i + 1) % n);
  }
  const segs = [];
  let s = 0;
  const pushLine = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az);
    if (L <= ROAD_EPS) return;
    segs.push({ type: 'line', ax, az, bx, bz, dx: (bx - ax) / L, dz: (bz - az) / L, len: L, s0: s }); s += L;
  };
  const tangentIn = i => { const f = fil[i], d = legDir[(i - 1 + legs) % legs]; return { x: P[i].x - d.dx * (f?.T || 0), z: P[i].z - d.dz * (f?.T || 0) }; };
  const tangentOut = i => { const f = fil[i], d = legDir[i % legs]; return { x: P[i].x + d.dx * (f?.T || 0), z: P[i].z + d.dz * (f?.T || 0) }; };
  const pushArc = i => {
    const f = fil[i];
    if (!f || f.T <= 0) return;
    const din = legDir[(i - 1 + legs) % legs], p1 = tangentIn(i), sg = Math.sign(f.delta);
    const [nx, nz] = perp(din.dx, din.dz), cx = p1.x + nx * sg * f.r, cz = p1.z + nz * sg * f.r;
    const a0 = Math.atan2(p1.z - cz, p1.x - cx), sweep = f.delta, len = f.r * Math.abs(sweep), p2 = tangentOut(i);
    segs.push({ type: 'arc', cx, cz, r: f.r, a0, sweep, len, s0: s, ax: p1.x, az: p1.z, bx: p2.x, bz: p2.z }); s += len;
  };
  if (closed) {
    for (let i = 0; i < n; i++) { pushArc(i); const a = tangentOut(i), b = tangentIn((i + 1) % n); pushLine(a.x, a.z, b.x, b.z); }
  } else {
    for (let i = 0; i < legs; i++) {
      if (i > 0) pushArc(i);
      const a = i === 0 ? P[0] : tangentOut(i), b = i + 1 === n - 1 ? P[n - 1] : tangentIn(i + 1);
      pushLine(a.x, a.z, b.x, b.z);
    }
  }
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const g of segs) { const b = segBox(g); x0 = Math.min(x0, b.x0); z0 = Math.min(z0, b.z0); x1 = Math.max(x1, b.x1); z1 = Math.max(z1, b.z1); }
  return { id: al.id, profile: al.profile, closed, length: s, segs, bbox: { x0, z0, x1, z1 } };
}

function segBox(g) {
  if (g.type === 'line') return { x0: Math.min(g.ax, g.bx), z0: Math.min(g.az, g.bz), x1: Math.max(g.ax, g.bx), z1: Math.max(g.az, g.bz) };
  let x0 = Math.min(g.ax, g.bx), z0 = Math.min(g.az, g.bz), x1 = Math.max(g.ax, g.bx), z1 = Math.max(g.az, g.bz);
  for (let k = 0; k < 4; k++) { const ang = k * Math.PI / 2; if (angleOnArc(g, ang)) { const x = g.cx + g.r * Math.cos(ang), z = g.cz + g.r * Math.sin(ang); x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); } }
  return { x0, z0, x1, z1 };
}
/** Distance along the arc (m) at which it reaches angle `ang`, or -1 when the angle isn't on the arc. */
function arcParam(g, ang, tol = ROAD_EPS) {
  const u = normAng((ang - g.a0) * Math.sign(g.sweep)), span = Math.abs(g.sweep), slack = tol / g.r;
  if (u <= span + slack) return Math.min(u, span) * g.r;
  if (u >= TAU - slack) return 0;
  return -1;
}
const angleOnArc = (g, ang, tol) => arcParam(g, ang, tol) >= 0;

/** Point and unit direction at distance t along one segment. */
function segAt(g, t, out) {
  if (g.type === 'line') { out.x = g.ax + g.dx * t; out.z = g.az + g.dz * t; out.dx = g.dx; out.dz = g.dz; return out; }
  const sg = Math.sign(g.sweep), a = g.a0 + sg * t / g.r, c = Math.cos(a), s = Math.sin(a);
  out.x = g.cx + g.r * c; out.z = g.cz + g.r * s; out.dx = -s * sg; out.dz = c * sg; return out;
}
/** Segment index containing station s (binary search). */
function segIndexAt(geom, s) {
  const S = geom.segs; let lo = 0, hi = S.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (S[mid].s0 <= s) lo = mid; else hi = mid - 1; }
  return lo;
}
/** Point and unit direction at station s (m from the start), clamped to the road. */
export function pointAt(geom, s, out = {}) {
  const S = geom.segs;
  if (!S.length) return null;
  s = Math.max(0, Math.min(geom.length, s));
  const g = S[segIndexAt(geom, s)];
  segAt(g, Math.min(g.len, Math.max(0, s - g.s0)), out); out.s = s; return out;
}
/**
 * Unit direction of travel at station s. At a sharp joint the direction differs on each side: `before` gives the
 * direction arriving at s, otherwise the direction leaving it. Closed loops wrap around.
 */
export function tangentAt(geom, s, before = false) {
  const S = geom.segs, L = geom.length, tmp = {};
  if (geom.closed) { s = ((s % L) + L) % L; if (before && s < ROAD_EPS) s = L; }
  else s = Math.max(0, Math.min(L, s));
  let k = segIndexAt(geom, s);
  if (before) { while (k > 0 && s - S[k].s0 <= ROAD_EPS) k--; }
  else if (s - S[k].s0 >= S[k].len - ROAD_EPS && k + 1 < S.length) k++;
  const g = S[k];
  segAt(g, Math.min(g.len, Math.max(0, s - g.s0)), tmp);
  return { dx: tmp.dx, dz: tmp.dz };
}
/** Point offset sideways from station s; positive offsets lie on the (−dz, dx) side of travel. */
export function offsetPoint(geom, s, offset, out = {}) {
  const p = pointAt(geom, s, out); if (!p) return null;
  p.x += -p.dz * offset; p.z += p.dx * offset; return p;
}

function projectSeg(g, x, z, out) {
  if (g.type === 'line') {
    const t = Math.max(0, Math.min(g.len, (x - g.ax) * g.dx + (z - g.az) * g.dz));
    out.t = t; out.px = g.ax + g.dx * t; out.pz = g.az + g.dz * t; out.d = Math.hypot(x - out.px, z - out.pz); return out;
  }
  const ang = Math.atan2(z - g.cz, x - g.cx);
  let t = arcParam(g, ang, 0);
  if (t < 0) { const ds = Math.hypot(x - g.ax, z - g.az), de = Math.hypot(x - g.bx, z - g.bz); t = ds <= de ? 0 : g.len; }
  const p = segAt(g, t, {}); out.t = t; out.px = p.x; out.pz = p.z; out.d = Math.hypot(x - p.x, z - p.z); return out;
}
/** Nearest point on the centreline: { s, x, z, dist, offset } (offset signed as in offsetPoint). */
export function project(geom, x, z) {
  let best = null; const tmp = {};
  for (const g of geom.segs) {
    projectSeg(g, x, z, tmp);
    if (!best || tmp.d < best.dist) best = { s: g.s0 + tmp.t, x: tmp.px, z: tmp.pz, dist: tmp.d };
  }
  if (!best) return null;
  const p = pointAt(geom, best.s, {});
  best.offset = (x - best.x) * -p.dz + (z - best.z) * p.dx;
  return best;
}

/**
 * Points along a line `offset` metres beside the centreline, at most `maxChord` metres apart and never further than
 * `maxErr` from the true curve. Lines give their two ends; arcs are subdivided. For rendering and footprints.
 */
export function samplePolyline(geom, offset = 0, { maxErr = 0.01, maxChord = 25 } = {}) {
  const out = [], tmp = {};
  const push = (x, z) => { const l = out.at(-1); if (!l || Math.hypot(l.x - x, l.z - z) > ROAD_EPS) out.push({ x, z }); };
  for (const g of geom.segs) {
    let steps = 1;
    if (g.type === 'arc') {
      const r = Math.max(ROAD_EPS, g.r + (Math.sign(g.sweep) > 0 ? -offset : offset));
      const dAng = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - maxErr / r)));
      steps = Math.max(1, Math.ceil(Math.abs(g.sweep) / Math.max(1e-4, dAng)), Math.ceil(g.len / maxChord));
    } else steps = Math.max(1, Math.ceil(g.len / maxChord));
    for (let k = out.length ? 1 : 0; k <= steps; k++) { segAt(g, g.len * k / steps, tmp); push(tmp.x - tmp.dz * offset, tmp.z + tmp.dx * offset); }
  }
  return out;
}

/** Evenly spaced points along one side (lamps, street trees, signs), skipping station ranges (e.g. junction areas). */
export function spotsAlong(geom, offset, spacing, { startPad = 0, endPad = 0, skip = [] } = {}) {
  const out = [], L = geom.length - startPad - endPad;
  if (!(spacing > 0) || L <= 0) return out;
  const n = Math.max(1, Math.floor(L / spacing) + 1), step = n > 1 ? L / (n - 1) : 0;
  for (let k = 0; k < n; k++) {
    const s = startPad + (n > 1 ? step * k : L / 2);
    if (skip.some(([a, b]) => s >= a && s <= b)) continue;
    const p = offsetPoint(geom, s, offset, {}); out.push({ x: p.x, z: p.z, s, dx: p.dx, dz: p.dz });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Intersections and distances between segments
// ---------------------------------------------------------------------------------------------------------------
/** Crossing points of two segments: [{ x, z, ta, tb }] (t = distance along each); { overlap: true } when they run together. */
export function intersectSegs(a, b) {
  if (a.type === 'line' && b.type === 'line') return lineLine(a, b);
  if (a.type === 'line') return lineArc(a, b);
  if (b.type === 'line') { const r = lineArc(b, a); return r.overlap ? r : r.map(p => ({ x: p.x, z: p.z, ta: p.tb, tb: p.ta })); }
  return arcArc(a, b);
}
function lineLine(a, b) {
  const den = cross(a.dx, a.dz, b.dx, b.dz), wx = b.ax - a.ax, wz = b.az - a.az;
  if (Math.abs(den) < 1e-12) {
    if (Math.abs(cross(a.dx, a.dz, wx, wz)) > ROAD_EPS) return [];
    const t0 = wx * a.dx + wz * a.dz, t1 = (b.bx - a.ax) * a.dx + (b.bz - a.az) * a.dz;
    const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(a.len, Math.max(t0, t1));
    if (hi - lo > ROAD_EPS) { const r = []; r.overlap = true; r.span = [lo, hi]; return r; }
    if (hi - lo >= -ROAD_EPS) { const t = (lo + hi) / 2, x = a.ax + a.dx * t, z = a.az + a.dz * t; return [{ x, z, ta: t, tb: Math.max(0, Math.min(b.len, (x - b.ax) * b.dx + (z - b.az) * b.dz)) }]; }
    return [];
  }
  const ta = cross(wx, wz, b.dx, b.dz) / den, tb = cross(wx, wz, a.dx, a.dz) / den;
  if (ta < -ROAD_EPS || ta > a.len + ROAD_EPS || tb < -ROAD_EPS || tb > b.len + ROAD_EPS) return [];
  const t = Math.max(0, Math.min(a.len, ta));
  return [{ x: a.ax + a.dx * t, z: a.az + a.dz * t, ta: t, tb: Math.max(0, Math.min(b.len, tb)) }];
}
function lineArc(l, g) {
  const fx = l.ax - g.cx, fz = l.az - g.cz, B = fx * l.dx + fz * l.dz, C = fx * fx + fz * fz - g.r * g.r, disc = B * B - C;
  if (disc < -ROAD_EPS * g.r) return [];
  const sq = Math.sqrt(Math.max(0, disc)), out = [];
  for (const t of sq < 1e-9 ? [-B] : [-B - sq, -B + sq]) {
    if (t < -ROAD_EPS || t > l.len + ROAD_EPS) continue;
    const tt = Math.max(0, Math.min(l.len, t)), x = l.ax + l.dx * tt, z = l.az + l.dz * tt, u = arcParam(g, Math.atan2(z - g.cz, x - g.cx));
    if (u >= 0) out.push({ x, z, ta: tt, tb: u });
  }
  return out;
}
function arcArc(a, b) {
  const dx = b.cx - a.cx, dz = b.cz - a.cz, d = Math.hypot(dx, dz);
  if (d < ROAD_EPS && Math.abs(a.r - b.r) < ROAD_EPS) {
    // Same circle: compare the two arcs as counter-clockwise angle intervals.
    const iv = g => (g.sweep >= 0 ? [g.a0, g.sweep] : [g.a0 + g.sweep, -g.sweep]);
    const [s1, l1] = iv(a), [s2, l2] = iv(b), off = normAng(s2 - s1), r = [];
    let shared = 0;
    for (const o of [off, off - TAU]) shared = Math.max(shared, Math.min(l1, o + l2) - Math.max(0, o));
    if (shared * a.r > ROAD_EPS) { r.overlap = true; return r; }
    for (const e of [[a.ax, a.az], [a.bx, a.bz]]) {
      const tb = arcParam(b, Math.atan2(e[1] - b.cz, e[0] - b.cx));
      if (tb >= 0) r.push({ x: e[0], z: e[1], ta: arcParam(a, Math.atan2(e[1] - a.cz, e[0] - a.cx)), tb });
    }
    return r;
  }
  if (d > a.r + b.r + ROAD_EPS || d < Math.abs(a.r - b.r) - ROAD_EPS || d < ROAD_EPS) return [];
  const along = (a.r * a.r - b.r * b.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a.r * a.r - along * along));
  const mx = a.cx + dx * along / d, mz = a.cz + dz * along / d, out = [];
  for (const sg of h < 1e-9 ? [0] : [-1, 1]) {
    const x = mx - sg * h * dz / d, z = mz + sg * h * dx / d;
    const ta = arcParam(a, Math.atan2(z - a.cz, x - a.cx)), tb = arcParam(b, Math.atan2(z - b.cz, x - b.cx));
    if (ta >= 0 && tb >= 0) out.push({ x, z, ta, tb });
  }
  return out;
}
const distPtSeg = (x, z, g) => projectSeg(g, x, z, {}).d;
/** Shortest distance between a straight piece (px,pz)→(qx,qz) and a road segment (exact for lines and arcs). */
export function distLineToSeg(px, pz, qx, qz, g) {
  const L = Math.hypot(qx - px, qz - pz);
  if (L < ROAD_EPS) return distPtSeg(px, pz, g);
  const l = { type: 'line', ax: px, az: pz, bx: qx, bz: qz, dx: (qx - px) / L, dz: (qz - pz) / L, len: L, s0: 0 };
  const hit = intersectSegs(l, g);
  if (hit.length || hit.overlap) return 0;
  let d = Math.min(distPtSeg(px, pz, g), distPtSeg(qx, qz, g), distPtSeg(g.ax, g.az, l), distPtSeg(g.bx, g.bz, l));
  if (g.type === 'arc') for (const sg of [1, -1]) {
    // Arc points whose tangent is parallel to the line are the other candidates.
    const ang = Math.atan2(-l.dx * sg, l.dz * sg), t = arcParam(g, ang, 0);
    if (t >= 0) { const p = segAt(g, t, {}); d = Math.min(d, distPtSeg(p.x, p.z, l)); }
  }
  return d;
}
function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------------------------------------------
// The network: alignments, a spatial index and derived junctions
// ---------------------------------------------------------------------------------------------------------------
const boxesTouch = (a, b, pad = 0) => a.x0 <= b.x1 + pad && a.x1 >= b.x0 - pad && a.z0 <= b.z1 + pad && a.z1 >= b.z0 - pad;

export class RoadNetwork {
  /** @param {{ profiles?: object, cell?: number }} [o] */
  constructor({ profiles = DEFAULT_ROAD_PROFILES, cell = INDEX_CELL_M } = {}) {
    this.profiles = profiles; this.cell = cell;
    this.roads = new Map();   // id → stored record (µm)
    this.geom = new Map();    // id → derived geometry (m)
    this.index = new Map();   // "cx,cz" → Set of ids
    this._junctions = null;
  }
  get size() { return this.roads.size; }
  get(id) { return this.roads.get(id) || null; }
  geometry(id) { return this.geom.get(id) || null; }
  all() { return [...this.roads.values()]; }
  profileOf(id) { const r = this.roads.get(id); return r ? this.profiles[r.profile] : null; }
  _cells(box, pad = 0, fn) {
    const c = this.cell, i0 = Math.floor((box.x0 - pad) / c), i1 = Math.floor((box.x1 + pad) / c), j0 = Math.floor((box.z0 - pad) / c), j1 = Math.floor((box.z1 + pad) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(`${i},${j}`);
  }
  /** Add or replace a road. Throws (with .problems) when the record is invalid; the network is unchanged then. */
  set(al) {
    const problems = checkAlignment(al, this.profiles);
    if (problems.length) { const e = new Error(problems[0].message); e.problems = problems; throw e; }
    const rec = { id: al.id, profile: al.profile, name: al.name ?? '', closed: !!al.closed, pts: al.pts.map(p => (p.r ? { x: p.x, z: p.z, r: p.r } : { x: p.x, z: p.z })), ...(Number.isFinite(al.level) ? { level: al.level } : {}) };   // level: a flat road (a grid's), m
    if (this.roads.has(al.id)) this.delete(al.id);
    const g = alignmentGeometry(rec, this.profiles);
    this.roads.set(rec.id, rec); this.geom.set(rec.id, g);
    for (const s of g.segs) this._cells(segBox(s), TOUCH_TOL, k => { let set = this.index.get(k); if (!set) this.index.set(k, set = new Set()); set.add(rec.id); });
    this._junctions = null;
    return rec;
  }
  delete(id) {
    const g = this.geom.get(id); if (!g) return false;
    for (const s of g.segs) this._cells(segBox(s), TOUCH_TOL, k => { const set = this.index.get(k); if (set) { set.delete(id); if (!set.size) this.index.delete(k); } });
    this.roads.delete(id); this.geom.delete(id); this._junctions = null; return true;
  }
  /** Ids of roads whose cells overlap a box (m), optionally padded. */
  candidates(box, pad = 0) { const ids = new Set(); this._cells(box, pad, k => { const s = this.index.get(k); if (s) for (const id of s) ids.add(id); }); return ids; }

  /** Nearest road centreline to (x, z) within maxDist: { id, s, x, z, dist, offset } or null. */
  nearest(x, z, maxDist = 50) {
    let best = null;
    for (const id of this.candidates({ x0: x, z0: z, x1: x, z1: z }, maxDist)) {
      const p = project(this.geom.get(id), x, z);
      if (p && p.dist <= maxDist && (!best || p.dist < best.dist)) best = { id, ...p };
    }
    return best;
  }

  /**
   * Roads whose corridor (back of sidewalk + pad, m) overlaps a footprint polygon [{x,z}] (m).
   * Returns [{ id, dist, half }] (distance from the footprint to the centreline and the corridor half-width, m), nearest
   * first; empty when the footprint is clear of every road. Touching the back of the sidewalk is clear.
   */
  corridorHits(poly, pad = 0) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
    const box = { x0, z0, x1, z1 }, hits = [];
    let maxHalf = 0; for (const p of Object.values(this.profiles)) maxHalf = Math.max(maxHalf, toM(p.outerHalf));
    for (const id of this.candidates(box, maxHalf + pad)) {
      const g = this.geom.get(id), half = toM(this.profiles[g.profile].outerHalf) + pad;
      if (!boxesTouch(g.bbox, box, half)) continue;
      let dist = Infinity;
      for (const sg of g.segs) {
        if (!boxesTouch(segBox(sg), box, half)) continue;
        if (pointInPoly(sg.ax, sg.az, poly)) { dist = 0; break; }
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) dist = Math.min(dist, distLineToSeg(poly[j].x, poly[j].z, poly[i].x, poly[i].z, sg));
      }
      if (dist < half - ROAD_EPS) hits.push({ id, dist, half });
    }
    return hits.sort((a, b) => a.dist - b.dist);
  }

  /** Roads that run along each other (overlapping centrelines): [{ a, b }]. A valid network has none. */
  overlaps() {
    const out = [], ids = [...this.geom.keys()];
    for (let i = 0; i < ids.length; i++) {
      const A = this.geom.get(ids[i]);
      for (const idB of this.candidates(A.bbox, TOUCH_TOL)) {
        if (idB <= ids[i]) continue;
        const B = this.geom.get(idB);
        if (!boxesTouch(A.bbox, B.bbox, TOUCH_TOL)) continue;
        if (A.segs.some(sa => B.segs.some(sb => boxesTouch(segBox(sa), segBox(sb), TOUCH_TOL) && intersectSegs(sa, sb).overlap))) out.push({ a: ids[i], b: idB });
      }
    }
    return out;
  }

  /**
   * Junctions derived from where roads meet: crossings, ends on another road, ends meeting ends, and lone ends.
   * Each: { key, x, z, kind: 'X'|'T'|'Y'|'turn'|'joint'|'end'|'multi', arms: [{ id, s, dirX, dirZ, angle, profile }],
   *         carriageHalf, outerHalf } (half-widths in µm, from the widest road meeting there).
   * Junction keys are derived (sorted road ids + position) and change when the roads move; they are not stored ids.
   */
  junctions() {
    if (this._junctions) return this._junctions;
    const events = [], ids = [...this.geom.keys()].sort(), done = new Set();
    for (const idA of ids) {
      const A = this.geom.get(idA);
      // Ends (lone ends become dead ends; ends on another road join that road's junction).
      if (!A.closed) { const e0 = pointAt(A, 0, {}), e1 = pointAt(A, A.length, {}); events.push({ x: e0.x, z: e0.z, id: idA, s: 0 }, { x: e1.x, z: e1.z, id: idA, s: A.length }); }
      for (const idB of this.candidates(A.bbox, TOUCH_TOL)) {
        if (idB < idA || done.has(`${idA}|${idB}`)) continue;
        done.add(`${idA}|${idB}`);
        const B = this.geom.get(idB);
        if (!boxesTouch(A.bbox, B.bbox, TOUCH_TOL)) continue;
        for (let i = 0; i < A.segs.length; i++) for (let j = 0; j < B.segs.length; j++) {
          const sa = A.segs[i], sb = B.segs[j];
          if (idA === idB && j <= i) continue;
          if (!boxesTouch(segBox(sa), segBox(sb), TOUCH_TOL)) continue;
          const hits = intersectSegs(sa, sb);
          for (const h of hits) {
            const s1 = sa.s0 + h.ta, s2 = sb.s0 + h.tb;
            if (idA === idB && Math.abs(s1 - s2) < CLUSTER_TOL) continue;   // consecutive pieces of one road
            if (idA === idB && A.closed && Math.abs(Math.abs(s1 - s2) - A.length) < CLUSTER_TOL) continue;
            events.push({ x: h.x, z: h.z, id: idA, s: s1 }, { x: h.x, z: h.z, id: idB, s: s2 });
          }
        }
        // Near-touching ends (within TOUCH_TOL but not exactly on the other centreline).
        for (const [P, Q, idP, idQ] of [[A, B, idA, idB], [B, A, idB, idA]]) {
          if (P.closed || idP === idQ) continue;
          for (const s of [0, P.length]) {
            const e = pointAt(P, s, {}), q = project(Q, e.x, e.z);
            if (q && q.dist <= TOUCH_TOL && q.dist > ROAD_EPS) events.push({ x: e.x, z: e.z, id: idP, s }, { x: e.x, z: e.z, id: idQ, s: q.s });
          }
        }
      }
    }
    // Cluster events that are the same place.
    const grid = new Map(), clusters = [], c = CLUSTER_TOL;
    for (const ev of events) {
      const gi = Math.floor(ev.x / c), gj = Math.floor(ev.z / c);
      let hit = null;
      for (let di = -1; di <= 1 && !hit; di++) for (let dj = -1; dj <= 1 && !hit; dj++) for (const cl of grid.get(`${gi + di},${gj + dj}`) || []) if (Math.hypot(cl.x - ev.x, cl.z - ev.z) <= c) { hit = cl; break; }
      if (!hit) { hit = { x: ev.x, z: ev.z, ev: [] }; clusters.push(hit); const k = `${gi},${gj}`; (grid.get(k) || grid.set(k, []).get(k)).push(hit); }
      hit.ev.push(ev);
    }
    const out = [];
    for (const cl of clusters) {
      const arms = [], seen = [];
      for (const raw of cl.ev) {
        const G = this.geom.get(raw.id), s = G.closed && G.length - raw.s < CLUSTER_TOL ? 0 : raw.s;
        if (seen.some(o => o.id === raw.id && Math.abs(o.s - s) < CLUSTER_TOL)) continue;
        seen.push({ id: raw.id, s });
        const prof = this.profiles[G.profile];
        const atStart = !G.closed && s < CLUSTER_TOL, atEnd = !G.closed && G.length - s < CLUSTER_TOL;
        if (!atEnd) { const d = tangentAt(G, s, false); arms.push({ id: raw.id, s, dirX: d.dx, dirZ: d.dz, profile: G.profile, prof }); }
        if (!atStart) { const d = tangentAt(G, s, true); arms.push({ id: raw.id, s, dirX: -d.dx, dirZ: -d.dz, profile: G.profile, prof }); }
      }
      if (arms.length < 1) continue;
      const roads = new Set(arms.map(a => a.id));
      if (arms.length === 2 && roads.size === 1) continue;   // a road's own interior point, not a junction
      for (const a of arms) a.angle = Math.atan2(a.dirZ, a.dirX);
      arms.sort((a, b) => a.angle - b.angle);
      const kind = classify(arms);
      const carriageHalf = Math.max(...arms.map(a => a.prof.carriageHalf)), outerHalf = Math.max(...arms.map(a => a.prof.outerHalf));
      const x = cl.ev.reduce((n, e) => n + e.x, 0) / cl.ev.length, z = cl.ev.reduce((n, e) => n + e.z, 0) / cl.ev.length;
      const key = `${[...roads].sort().join('+')}@${Math.round(x * 100)},${Math.round(z * 100)}`;
      out.push({ key, x, z, kind, arms: arms.map(({ prof, ...a }) => a), carriageHalf, outerHalf });
    }
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return (this._junctions = out);
  }

  /**
   * Problems with the whole network (empty when valid): overlapping roads, and junctions so close that their
   * corners would collide (centres closer than the sum of their outer half-widths).
   */
  validate() {
    const out = [];
    for (const { a, b } of this.overlaps()) out.push({ code: 'overlap', message: `${this.get(a).name || a} and ${this.get(b).name || b} run on top of each other.`, roads: [a, b] });
    const J = this.junctions().filter(j => j.kind !== 'end' && j.kind !== 'joint');
    for (let i = 0; i < J.length; i++) for (let k = i + 1; k < J.length; k++) {
      const d = Math.hypot(J[i].x - J[k].x, J[i].z - J[k].z), need = toM(J[i].outerHalf) + toM(J[k].outerHalf);
      if (d < need - ROAD_EPS && J[i].arms.some(a => J[k].arms.some(b => b.id === a.id))) out.push({ code: 'close', message: `Two junctions are only ${Math.round(d / 0.3048)} ft apart; they need ${Math.ceil(need / 0.3048)} ft.`, junctions: [J[i].key, J[k].key] });
    }
    return out;
  }

  /** Plain records (µm) for saving; the same records rebuild an identical network. */
  toJSON() { return this.all().sort((a, b) => (a.id < b.id ? -1 : 1)); }
  static fromJSON(records, opts) { const n = new RoadNetwork(opts); for (const r of records) n.set(r); return n; }
}

function classify(arms) {
  const n = arms.length;
  if (n === 1) return 'end';
  const opposite = (a, b) => Math.abs(Math.abs(normAng(a.angle - b.angle + Math.PI) - Math.PI) - Math.PI) < STRAIGHT_TOL;
  if (n === 2) return opposite(arms[0], arms[1]) ? 'joint' : 'turn';
  if (n === 3) { for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (opposite(arms[i], arms[j])) return 'T'; return 'Y'; }
  if (n === 4) return 'X';
  return 'multi';
}

// ---------------------------------------------------------------------------------------------------------------
// Today's grid city → alignments (WP4.1 conversion; the same centrelines, road type and street names)
// ---------------------------------------------------------------------------------------------------------------
/**
 * Alignment records for a grid city ({ nx, nz, bw, bd, road } in metres, as in world.json `grid`): avenues along z at
 * each x = X[i] and streets along x at each z = Z[j], from edge street to edge street. Names come from `names`
 * (avenues and streets lists), ids are `grid-a<i>` / `grid-s<j>`.
 */
export function alignmentsFromGrid(spec, { profile = 'city-14', names = null } = {}) {
  const nx = spec.nx | 0, nz = spec.nz | 0, bw = +spec.bw, bd = +spec.bd, road = +spec.road;
  if (!(nx > 0 && nz > 0 && bw > 0 && bd > 0 && road > 0)) throw new Error('grid needs nx, nz, bw, bd and road');
  // Same arithmetic as shared/city.js makeGrid, kept in µm so the centrelines are exact.
  const px = mToUm(bw + road), pz = mToUm(bd + road), x0 = -nx * px / 2, z0 = -nz * pz / 2;
  if (!Number.isInteger(x0) || !Number.isInteger(z0)) throw new Error('grid origin is not a whole micrometre');
  const X = Array.from({ length: nx + 1 }, (_, i) => x0 + i * px), Z = Array.from({ length: nz + 1 }, (_, j) => z0 + j * pz);
  const av = names?.avenues || [], st = names?.streets || [], out = [];
  for (let i = 0; i <= nx; i++) out.push({ id: `grid-a${i}`, profile, name: av[i] ?? `Avenue ${i + 1}`, pts: [{ x: X[i], z: Z[0] }, { x: X[i], z: Z[nz] }] });
  for (let j = 0; j <= nz; j++) out.push({ id: `grid-s${j}`, profile, name: st[j] ?? `Street ${j + 1}`, pts: [{ x: X[0], z: Z[j] }, { x: X[nx], z: Z[j] }] });
  return out;
}
