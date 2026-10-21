// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The road kit (WP4 polish, the design review 2026-10-03): what every road and junction is made of, shared by the renderer,
// the traffic and the walkers so they all agree.
// - A road type's cross-section, band by band from the centre out: travel lanes (with their markings: a double or
//   dashed yellow centre line, dashed white lines between lanes going the same way, a solid white edge line), the
//   shoulder or parking lane, the gutter, the curb (raised CURB_RISE) and the sidewalk.
// - A junction's plan: every corner gets a curb return sized so a bus turns from its lane into the other road's
//   without cutting across (DESIGN_TURN_R at the outer lane's centre, wider than the classic release's, whose tight corners make
//   vehicles struggle); gutter, curb and sidewalk wrap round it and blend from one road's widths to the other's, a band
//   one road doesn't have tapering out round the corner; crosswalks where both sides have sidewalks, stop bars on the
//   lanes coming in, and traffic control by the junction's layout (2026-10-04: "junctions are missing signals around
//   the map ... signal poles should also be placed for all roadway types per their layout and requirements"):
//   traffic signals on the city's timetable (shared/constants.js) wherever two or more roads meet, of any type (the
//   country roads' poles stand beyond their shoulders); where a road only meets itself, stop signs - on the side
//   branch where the road carries on through (two-way stop), on every approach where it doesn't (all-way stop).
//   (lanesPerDir: kept for the record of the old rule, multi-lane or curbed only.)
import { pointAt } from './roads.js';
import { SIG_CYCLE, PED_WIN } from './constants.js';

const UM = 1e-6, TAU = Math.PI * 2;
export const CURB_RISE = 0.15;          // m: curb top and sidewalks above the road surface
export const DESIGN_TURN_R = 15;        // m: radius a bus's path needs at its outer lane's centre to turn without cutting in
export const MIN_RETURN = 7, MAX_RETURN = 17, MAX_TANGENT = 45;
export const CROSSWALK_W = 3.2;         // m along the road
const ARC_STEPS = 14;

// ---------------------------------------------------------------- cross-sections
/**
 * A road type's bands on one side of its centre line (mirrored on the other), metres from the centre:
 * { lanes: [o0, o1], shoulder: [o0, o1] | null (kind 'parking' | 'paved' | 'gravel'), gutter, curb, sidewalk: [o0, o1] |
 * null, laneEdge, carriage (curb face), outer, centre: 'double' | 'dashed' | 'none', laneLines: [offsets of the dashed
 * lines between lanes], edgeLine: offset | null, lanes: [{ o (centre), w }] }.
 */
export function sectionOf(P) {
  const laneEdge = Math.max(...P.lanes.map(l => l.offset + l.width / 2)) * UM, carriage = P.carriageHalf * UM, gutter = (P.gutter || 0) * UM;
  const curb = (P.curb || 0) * UM, side = (P.sidewalk || 0) * UM, shoulderEnd = carriage - gutter;
  const lanes = [...P.lanes].map(l => ({ o: l.offset * UM, w: l.width * UM })).sort((a, b) => a.o - b.o);
  const laneLines = []; for (let i = 0; i + 1 < lanes.length; i++) laneLines.push((lanes[i].o + lanes[i].w / 2 + lanes[i + 1].o - lanes[i + 1].w / 2) / 2);
  const shoulderW = shoulderEnd - laneEdge;
  return {
    id: P.id, laneEdge, carriage, outer: P.outerHalf * UM, lanes, laneLines,
    centre: P.centreLine || (lanes.length >= 2 ? 'double' : 'dashed'),
    shoulder: shoulderW > 0.05 ? { o0: laneEdge, o1: shoulderEnd, kind: P.parking ? 'parking' : curb > 0 ? 'paved' : 'gravel' } : null,
    gutter: gutter > 0 ? { o0: shoulderEnd, o1: carriage } : null,
    curb: curb > 0 ? { o0: carriage, o1: carriage + curb } : null,
    sidewalk: side > 0 ? { o0: carriage + curb, o1: carriage + curb + side } : null,
    edgeLine: shoulderW > 0.3 ? laneEdge - 0.08 : null,
    raised: curb > 0,
  };
}

/** Curb-return radius for a corner between two roads' sections: the bus path at the outer lane's centre stays at
 *  DESIGN_TURN_R or more; shoulders and parking lanes give room, so the curb itself can be tighter there. */
export function returnRadius(a, b) {
  const room = s => s.carriage - (s.lanes.at(-1).o);   // from the outer lane's centre out to the curb face
  return Math.max(MIN_RETURN, Math.min(MAX_RETURN, DESIGN_TURN_R - (room(a) + room(b)) / 2));
}

// ---------------------------------------------------------------- junction plans
/**
 * The plan of every junction of a RoadNetwork where two or more roads (or one road's two ends) meet:
 * { key, x, z, kind, arms: [{ id, s, d (out of the junction), n (left of d), along, sec, mouth (m from the centre
 * where the road's own cross-section starts) }], corners: [{ i, k, curb: [{x, z}] (from arm i's mouth round to arm
 * k's, at the curb face), bands: { gutter, curb, sidewalk }: [inner, outer] polylines }], surface: [{x, z}] (the paved
 * area inside the curbs), crosswalks: [{ arm, poly }], stops: [{ arm, poly }], signals: [{ arm, x, z, yaw, reach }],
 * signs: [{ arm, x, z, yaw (facing the traffic), allWay, raised }] (stop signs; their arms carry stopSign), signalized,
 * allWay, phases: [phase per arm] }.
 */
export function junctionPlans(net, profiles, { skip = () => false, rules = () => null } = {}) {
  const out = [];
  for (const j of net.junctions()) {
    if (j.kind === 'end' || j.kind === 'joint' || skip(j)) continue;
    if (j.arms.length < 2) continue;
    const plan = planJunction(net, profiles, j, rules(j) || {});
    if (plan) out.push(plan);
  }
  return out;
}
/**
 * One junction's plan. rules (a city's own junctions): { R: curb-return radius, crosswalkAt (m from the centre),
 * scramble (diagonal crossings too), sigOffset, phaseOf(arm) (0 or 1) } - so the city's corners, crossings and lights
 * stay where its walkers and traffic already use them.
 */
function planJunction(net, profiles, j, rules = {}) {
  const C = { x: j.x, z: j.z };
  const arms = [...j.arms].sort((a, b) => a.angle - b.angle).map(a => {
    const G = net.geometry(a.id), t = pointAt(G, a.s, {}), along = a.dirX * t.dx + a.dirZ * t.dz >= 0 ? 1 : -1;
    const P = profiles[net.get(a.id).profile];
    return { id: a.id, s: a.s, d: { x: a.dirX, z: a.dirZ }, n: { x: -a.dirZ, z: a.dirX }, along, angle: a.angle, sec: sectionOf(P), rank: P.lanes.length * 1000 + (P.speedLimit || 0), mouth: 0 };
  });
  const N = arms.length, corners = [];
  for (let i = 0; i < N; i++) {
    const A = arms[i], B = arms[(i + 1) % N];
    let phi = ((B.angle - A.angle) % TAU + TAU) % TAU; if (N === 1 || phi === 0) phi = TAU;
    // the curb faces: arm A's left side (+n) and arm B's right side (−n) bound this corner
    const pa = add(C, A.n, A.sec.carriage), pb = add(C, B.n, -B.sec.carriage);
    const corner = { i, k: (i + 1) % N, phi, straight: Math.abs(phi - Math.PI) < 0.08, reflex: phi > Math.PI + 0.08 };
    if (corner.straight || corner.reflex) {
      corner.X = lineMeet(pa, A.d, pb, B.d) || mid(pa, pb);
      corner.tA = Math.max(0, dot(sub(corner.X, C), A.d)); corner.tB = Math.max(0, dot(sub(corner.X, C), B.d));
    } else {
      const X = lineMeet(pa, A.d, pb, B.d); if (!X) return null;
      const half = phi / 2, R = Math.min(rules.R ?? returnRadius(A.sec, B.sec), MAX_TANGENT * Math.tan(half)), td = R / Math.tan(half);
      const T1 = add(X, A.d, td), T2 = add(X, B.d, td), O = add(T1, A.n, R);   // the arc's centre is on the land side (+n of A)
      Object.assign(corner, { X, R, T1, T2, O, tA: dot(sub(T1, C), A.d), tB: dot(sub(T2, C), B.d) });
    }
    corners.push(corner);
  }
  // each arm's mouth: past both of its corners' tangent points (its own cross-section starts there)
  for (const c of corners) { arms[c.i].mouth = Math.max(arms[c.i].mouth, c.tA + 0.4); arms[c.k].mouth = Math.max(arms[c.k].mouth, c.tB + 0.4); }
  for (const A of arms) A.mouth = Math.max(A.mouth, Math.max(...arms.filter(B => B !== A).map(B => B.sec.carriage)) * 0.5 + 1);
  // the curb line of each corner, mouth to mouth, and the bands offset from it towards the land
  for (const c of corners) {
    const A = arms[c.i], B = arms[c.k];
    const MA = add(add(C, A.d, A.mouth), A.n, A.sec.carriage), MB = add(add(C, B.d, B.mouth), B.n, -B.sec.carriage);
    const pts = [], nrm = [], w = [];   // the curb line, its land-side normal, and how far along it each point is (0..1)
    const push = (p, nv) => { pts.push(p); nrm.push(nv); };
    if (c.straight || c.reflex) {
      push(MA, A.n); push(c.X, norm(add(A.n, B.n, -1))); push(MB, scale(B.n, -1));
    } else {
      push(MA, A.n);
      for (let t = 0; t <= ARC_STEPS; t++) {
        const a0 = Math.atan2(c.T1.z - c.O.z, c.T1.x - c.O.x); let sw = Math.atan2(c.T2.z - c.O.z, c.T2.x - c.O.x) - a0;
        while (sw > Math.PI) sw -= TAU; while (sw < -Math.PI) sw += TAU;
        const a = a0 + sw * t / ARC_STEPS, p = { x: c.O.x + Math.cos(a) * c.R, z: c.O.z + Math.sin(a) * c.R };
        push(p, norm(sub(c.O, p)));
      }
      push(MB, scale(B.n, -1));
    }
    let L = 0; const cum = [0]; for (let k = 1; k < pts.length; k++) { L += dist(pts[k - 1], pts[k]); cum.push(L); }
    for (const v of cum) w.push(L ? v / L : 0);
    c.curb = pts;
    // a band boundary at distance f(t) from the curb line, blending arm A's width into arm B's (smoothly)
    const offset = (fa, fb, sign = 1) => pts.map((p, k) => { const t = smooth(w[k]), f = fa + (fb - fa) * t; return add(p, nrm[k], sign * f); });
    const width = (sec, band) => (sec[band] ? sec[band].o1 - sec[band].o0 : 0), gravel = sec => (sec.shoulder?.kind === 'gravel' ? width(sec, 'shoulder') : 0);
    c.bands = {};
    if (A.sec.gutter || B.sec.gutter) c.bands.gutter = [pts, offset(width(A.sec, 'gutter'), width(B.sec, 'gutter'), -1)];   // road side of the curb
    // A curbed road meeting one without curbs (a country road at the city's edge, 2026-10-06: corners not smooth,
    // gaps in the sidewalk): the uncurbed road's gravel shoulder carries on round the corner inside the gutter, tapering
    // out, and the curb and sidewalk come down to the road by its mouth (rise: 0..1 of CURB_RISE at each curb point).
    const gA = width(A.sec, 'gutter'), gB = width(B.sec, 'gutter'), sA = gravel(A.sec), sB = gravel(B.sec);
    if (sA || sB) c.bands.gravel = [c.bands.gutter ? c.bands.gutter[1] : pts, offset(gA + sA, gB + sB, -1)];
    const ramp = t => smooth(Math.min(1, Math.max(0, t / 0.35)));
    c.rise = w.map(t => (A.sec.raised === B.sec.raised ? (A.sec.raised ? 1 : 0) : A.sec.raised ? ramp(1 - t) : ramp(t)));
    if (A.sec.curb || B.sec.curb) {
      const ca = width(A.sec, 'curb'), cb = width(B.sec, 'curb'), sa = width(A.sec, 'sidewalk'), sb = width(B.sec, 'sidewalk');
      c.bands.curb = [pts, offset(ca, cb)];
      if (sa || sb) c.bands.sidewalk = [offset(ca, cb), sidewalkOuter(c, A, B, ca + sa, cb + sb, offset)];
    }
  }
  // the paved surface inside the curbs: mouths and corners in turn
  const surface = [];
  for (let i = 0; i < N; i++) {
    const A = arms[i], c = corners[i];
    surface.push(add(add(C, A.d, A.mouth), A.n, -A.sec.carriage));
    for (const p of c.curb) surface.push(p);
  }
  // crosswalks across arms with sidewalks on both sides, stop bars on the lanes coming in, signals at busier junctions
  const crosswalks = [], stops = [], signals = [], signs = [];
  const lanesPerDir = Math.max(...arms.map(A => A.sec.lanes.length)), roads = new Set(arms.map(A => A.id));
  const signalized = rules.signalized ?? (N >= 3 && roads.size >= 2);   // (any road type: country roads too - 2026-10-04)
  // without signals: a stop sign on each approach that gives way - the through road is the busiest pair of arms facing
  // each other (more lanes, then the faster road); with no such pair, every approach stops (all-way)
  let through = null;
  if (!signalized && N >= 3) {
    const opp = (a, b) => Math.abs(Math.abs(((a.angle - b.angle) % TAU + TAU) % TAU - Math.PI)) < 0.5;
    for (let i = 0; i < N; i++) for (let k = i + 1; k < N; k++) if (opp(arms[i], arms[k])) { const r = Math.min(arms[i].rank, arms[k].rank) + (arms[i].id === arms[k].id ? 0.5 : 0); if (!through || r > through.r) through = { i, k, r }; }
  }
  const allWay = !signalized && N >= 3 && !through;
  arms.forEach((A, i) => {
    const left = corners[i], right = corners[(i - 1 + N) % N];
    const walkable = !!(left.bands.sidewalk && right.bands.sidewalk) && A.sec.raised;
    const cw0 = rules.crosswalkAt !== undefined ? rules.crosswalkAt - CROSSWALK_W / 2 : A.mouth - CROSSWALK_W - 0.6;
    if (walkable) crosswalks.push({ arm: i, poly: across(C, A, cw0, cw0 + CROSSWALK_W, -A.sec.carriage, A.sec.carriage) });
    // the stop bar: at a signal, a little before its mast arm (2026-10-03: a driver stopped past the heads can't see
    // them), so the lanes coming in end there too (A.stopAt: where a car's front stops, shared/lane-graph.js)
    const armAt = A.mouth + 1.2, sb0 = walkable ? Math.max(cw0 + CROSSWALK_W + 0.6, rules.crosswalkAt !== undefined ? 0 : A.mouth + 0.3) : A.mouth + 0.6;
    const sb = signalized ? Math.max(sb0, armAt + 2.2) : sb0;
    const sign = !signalized && N >= 3 && (allWay || (i !== through.i && i !== through.k));
    if (signalized || sign) A.stopAt = sb + 0.75;
    if (sign) {
      // the sign on the right of the lanes coming in, at the stop bar, facing the traffic
      A.stopSign = true;
      const p = add(add(C, A.d, sb + 0.4), A.n, -(A.sec.carriage + (A.sec.curb ? 0.55 : 1.3)));
      signs.push({ arm: i, x: p.x, z: p.z, yaw: Math.atan2(A.d.x, A.d.z), allWay, raised: A.sec.raised });
    }
    stops.push({ arm: i, poly: across(C, A, sb, sb + 0.45, -A.sec.laneEdge, -0.12) });   // the lanes coming in are right of travel: −n
    if (signalized) {
      // a pole on the corner of the incoming lanes' side, its mast arm reaching over all of them (past the innermost
      // lane's head, so no head hangs in the air)
      const pole = A.sec.carriage + (A.sec.curb ? 0.9 : 1.6), p = add(add(C, A.d, armAt), A.n, -pole);
      signals.push({ arm: i, x: p.x, z: p.z, yaw: Math.atan2(A.n.x, A.n.z), reach: pole - Math.min(...A.sec.lanes.map(l => l.o)) + 0.45, lanes: A.sec.lanes.length });
    }
  });
  // the all-way scramble's diagonal crossings, corner to corner (the city's)
  const diagonals = [];
  if (rules.scramble && signalized && N === 4) for (const [a, b] of [[0, 2], [1, 3]]) {
    const mid = c => c.curb[Math.floor(c.curb.length / 2)], p = mid(corners[a]), q = mid(corners[b]);
    const dx = q.x - p.x, dz = q.z - p.z, L = Math.hypot(dx, dz) || 1, nx = -dz / L * CROSSWALK_W / 2, nz = dx / L * CROSSWALK_W / 2, k = 1.2 / L;
    diagonals.push([{ x: p.x + dx * k - nx, z: p.z + dz * k - nz }, { x: q.x - dx * k - nx, z: q.z - dz * k - nz }, { x: q.x - dx * k + nx, z: q.z - dz * k + nz }, { x: p.x + dx * k + nx, z: p.z + dz * k + nz }]);
  }
  const phases = signalized ? (rules.phaseOf ? arms.map(rules.phaseOf) : phasesOf(arms)) : null;
  return { key: j.key, x: j.x, z: j.z, kind: j.kind, arms, corners, surface, crosswalks, diagonals, stops, signals, signs, signalized, allWay, phases, sigOffset: rules.sigOffset ?? hashOffset(j.key) };
}
/** The outer edge of a corner's sidewalk: the two roads' property lines meeting square (the lot's corner stays a corner;
 *  the sidewalk widens round the curb return). */
function sidewalkOuter(c, A, B, fa, fb, offset) {
  if (!fa || !fb) return offset(fa, fb);   // one road has no sidewalk: it tapers out round the curb (no square corner to make)
  const C = c.curb, first = C[0], last = C.at(-1);
  const pA = add(first, A.n, fa), pB = add(last, B.n, -fb);
  const X = lineMeet(pA, A.d, pB, B.d);
  if (!X || dist(X, pA) > 200) return offset(fa, fb);
  return [pA, X, pB];
}
/** Signal phases: arms facing each other go together (phase 0 the busier pair), the rest in phase 1. */
function phasesOf(arms) {
  const ph = arms.map(() => -1), N = arms.length;
  const opposite = (a, b) => Math.abs(Math.abs(((a.angle - b.angle) % TAU + TAU) % TAU - Math.PI)) < 0.5;
  const pairs = [];
  for (let i = 0; i < N; i++) for (let k = i + 1; k < N; k++) if (opposite(arms[i], arms[k])) pairs.push([i, k, arms[i].sec.lanes.length + arms[k].sec.lanes.length]);
  pairs.sort((a, b) => b[2] - a[2]);
  if (pairs.length) { ph[pairs[0][0]] = 0; ph[pairs[0][1]] = 0; }
  for (let i = 0; i < N; i++) if (ph[i] < 0) ph[i] = pairs.length ? 1 : i % 2;
  return ph;
}
const hashOffset = key => { let h = 2166136261; for (const ch of String(key)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000 * SIG_CYCLE; };

/** A junction's light for arm `arm` at time t (the city's timetable): 2 green, 1 yellow, 3 protected left, 0 red. */
export function signalFor(plan, arm, t) {
  if (!plan.signalized) return 2;
  const c = (((t + plan.sigOffset) % SIG_CYCLE) + SIG_CYCLE) % SIG_CYCLE, axis = plan.phases[arm];
  if (axis === 0) return c < 10 ? 2 : c < 12 ? 1 : c < 16 ? 3 : 0;
  return c >= 17 && c < 27 ? 2 : c >= 27 && c < 29 ? 1 : c >= 29 && c < 33 ? 3 : 0;
}
/** Pedestrians' light at a signalized junction: 2 walk, 1 flashing, 0 don't walk (the all-way scramble). */
export function walkFor(plan, t) {
  if (!plan.signalized) return 2;
  const c = (((t + plan.sigOffset) % SIG_CYCLE) + SIG_CYCLE) % SIG_CYCLE;
  return c >= PED_WIN[0] ? (c < 46 ? 2 : 1) : 0;
}
/** Earliest time ≥ t a pedestrian can start crossing (dur s) and be across before the walk window closes. */
export function walkStart(plan, t, dur) {
  if (!plan.signalized) return t;
  const c = (((t + plan.sigOffset) % SIG_CYCLE) + SIG_CYCLE) % SIG_CYCLE, latest = PED_WIN[1] - Math.min(dur, PED_WIN[1] - PED_WIN[0] - 1) - 0.3;
  if (c >= PED_WIN[0] && c <= latest) return t;
  let dt = PED_WIN[0] - c; if (dt < 0) dt += SIG_CYCLE;
  return t + dt + 0.15;
}

// ---------------------------------------------------------------- little vector helpers
const add = (p, v, k = 1) => ({ x: p.x + v.x * k, z: p.z + v.z * k });
const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.z * b.z;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
const scale = (v, k) => ({ x: v.x * k, z: v.z * k });
const norm = v => { const l = Math.hypot(v.x, v.z) || 1; return { x: v.x / l, z: v.z / l }; };
const smooth = t => t * t * (3 - 2 * t);
function lineMeet(p, d, q, e) {
  const den = d.x * e.z - d.z * e.x; if (Math.abs(den) < 1e-9) return null;
  const t = ((q.x - p.x) * e.z - (q.z - p.z) * e.x) / den;
  return { x: p.x + d.x * t, z: p.z + d.z * t };
}
/** A quad across arm A from distance a to b out of the junction, between lateral offsets o0..o1. */
function across(C, A, a, b, o0, o1) {
  const P = (t, o) => add(add(C, A.d, t), A.n, o);
  return [P(a, o0), P(b, o0), P(b, o1), P(a, o1)];
}
