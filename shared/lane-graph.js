// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Traffic lanes on alignment roads (WP4.5, wp4-world-spec.md §3–4): every road type's lanes in both directions, along
// each road's curves and graded height, cut back at junctions; short connector curves through each junction for the
// moves a driver may make (straight, left from the inner lane, right from the outer lane; a turnaround at a dead end),
// with the connectors that cross or merge marked as conflicting so only one of them is used at a time. Road ends on a
// city's edge are "portals", where the city's own lanes link in. Pure data and geometry: VehicleTraffic drives on it.
import { pointAt } from './roads.js';
import { profileAt, FORMATION } from './island-roads.js';

const UM = 1e-6;
const PORTAL_TRIM = 25;     // m from a city edge where road lanes begin, leaving room to merge from the city's lanes
const DEAD_TRIM = 9;        // m short of a dead end where lanes stop, so the turnaround stays on the road's end
const JOINT_TRIM = 2;       // m either side of a straight continuation between two roads
const JUNCTION_PAD = 2.5;   // m beyond the widest roadway at a junction (stop line)
const A_LAT = 2.2;          // m/s² comfortable sideways acceleration: the speed through a curve
const MIN_TURN_V = 3;       // m/s, the slowest a turn is taken
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const yawOf = (dx, dz) => Math.atan2(-dz, dx);   // vehicle yaw: forward is (cos yaw, −sin yaw)

/** A lane along a road between two stations, in the road's direction (dir 1) or against it (dir −1). */
export class RoadLane {
  constructor({ id, road, G, prof, off, dir, s0, s1, limit, index }) {
    Object.assign(this, { id, road, G, prof, off, dir, s0, s1, limit, index, len: s1 - s0, cars: [], next: [], feeders: [], kind: 'road', graph: true });
    this._p = {};
  }
  /** Pose at distance s along the lane: c.x, c.y (the graded ground), c.z, c.yaw. */
  at(s, c) {
    const L = this.G.length, st0 = this.dir > 0 ? this.s0 + s : this.s1 - s, st = this.G.closed ? ((st0 % L) + L) % L : st0;
    const p = pointAt(this.G, st, this._p), o = this.off * this.dir, dx = p.dx * this.dir, dz = p.dz * this.dir;
    c.x = p.x - p.dz * o; c.z = p.z + p.dx * o; c.y = profileAt(this.prof, st) - FORMATION; c.yaw = yawOf(dx, dz);
    return c;
  }
  /** Position and heading at the lane's start or end ({ x, y, z, dx, dz }). */
  end(atEnd) { const c = this.at(atEnd ? this.len : 0, {}); return { x: c.x, y: c.y, z: c.z, dx: Math.cos(c.yaw), dz: -Math.sin(c.yaw) }; }
}

/** A short lane given as a polyline (junction connectors, turnarounds, links into a city's lanes). */
export class PathLane {
  constructor({ id, pts, limit, junction = null, from = null, to = null, turn = 'straight' }) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    // the heading at each point: halfway between the pieces either side (a car's heading turns smoothly along each piece
    // rather than jumping where two meet: the product owner 2026-10-21, traffic "very choppy on turns")
    const hx = new Float64Array(pts.length), hz = new Float64Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      let x = 0, z = 0;
      for (const k of [i, i + 1]) if (k >= 1 && k < pts.length) { const dx = pts[k].x - pts[k - 1].x, dz = pts[k].z - pts[k - 1].z, l = Math.hypot(dx, dz); if (l > 1e-9) { x += dx / l; z += dz / l; } }
      const l = Math.hypot(x, z); hx[i] = l > 1e-9 ? x / l : 1; hz[i] = l > 1e-9 ? z / l : 0;
    }
    Object.assign(this, { id, pts, cum, hx, hz, len: cum.at(-1), limit, junction, from, to, turn, cars: [], next: to ? [to] : [], feeders: [], conflicts: [], reserved: new Set(), kind: 'path', graph: true });
  }
  at(s, c) {
    const { pts, cum } = this; let i = 1;
    if (s <= 0) i = 1; else if (s >= this.len) i = pts.length - 1; else { let lo = 1, hi = pts.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m + 1; else hi = m; } i = lo; }
    const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, t = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg));
    c.x = a.x + (b.x - a.x) * t; c.y = a.y + (b.y - a.y) * t; c.z = a.z + (b.z - a.z) * t;
    c.yaw = yawOf(this.hx[i - 1] + (this.hx[i] - this.hx[i - 1]) * t, this.hz[i - 1] + (this.hz[i] - this.hz[i - 1]) * t);
    return c;
  }
  /** Free to enter: nobody on (or committed to) a conflicting connector. */
  free(car) {
    for (const k of this.conflicts) { if (k.cars.length) return false; for (const id of k.reserved) if (id !== car.id) return false; }
    return true;
  }
}

/** A cubic curve from a (position, heading) to b (position, heading), sampled; heights interpolated along it. */
export function connectorPoints(a, b, { n = 20, reach = null } = {}) {
  const d = Math.hypot(b.x - a.x, b.z - a.z), back = a.dx * b.dx + a.dz * b.dz < -0.8;
  const k = reach ?? (back ? Math.max(8, d * 1.4) : Math.max(1, d * 0.42));
  const c1 = { x: a.x + a.dx * k, z: a.z + a.dz * k }, c2 = { x: b.x - b.dx * k, z: b.z - b.dz * k }, out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    out.push({ x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x, y: a.y + (b.y - a.y) * t, z: w0 * a.z + w1 * c1.z + w2 * c2.z + w3 * b.z });
  }
  return out;
}
/**
 * Round a dead end's turning circle: from the arriving lane's end out to a circle of radius r − 3.5 about its centre,
 * round the far side, and back into the leaving lane (a, b: { x, y, z, dx, dz }; circle: { x, z, r }).
 */
export function turnaroundPoints(a, b, circle) {
  const rho = Math.max(4, circle.r - 3.5), t = { x: a.dx, z: a.dz }, n = { x: -t.z, z: t.x }, y = (a.y + b.y) / 2;
  const R0 = { x: circle.x + n.x * rho, y, z: circle.z + n.z * rho, dx: t.x, dz: t.z }, L0 = { x: circle.x - n.x * rho, y, z: circle.z - n.z * rho, dx: -t.x, dz: -t.z };
  const out = connectorPoints(a, R0, { n: 8 }), an = Math.atan2(n.z, n.x);
  let sweep = Math.atan2(t.z, t.x) - an; while (sweep > Math.PI) sweep -= 2 * Math.PI; while (sweep < -Math.PI) sweep += 2 * Math.PI;
  for (let k = 1; k < 16; k++) { const ang = an + 2 * sweep * k / 16; out.push({ x: circle.x + Math.cos(ang) * rho, y, z: circle.z + Math.sin(ang) * rho }); }
  return out.concat(connectorPoints(L0, b, { n: 8 }));
}
/** The speed a polyline can be driven at: from its tightest turn (radius through three consecutive points). */
export function curveSpeed(pts, cap) {
  let rMin = Infinity;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ac = Math.hypot(c.x - a.x, c.z - a.z);
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    if (area2 > 1e-9) rMin = Math.min(rMin, (ab * bc * ac) / (2 * area2));
  }
  return Math.max(MIN_TURN_V, Math.min(cap, Math.sqrt(A_LAT * rMin)));
}
function segsCross(p, q) {
  for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) {
    const a = p[i - 1], b = p[i], c = q[j - 1], d = q[j];
    const d1 = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x), d2 = (b.x - a.x) * (d.z - a.z) - (b.z - a.z) * (d.x - a.x);
    const d3 = (d.x - c.x) * (a.z - c.z) - (d.z - c.z) * (a.x - c.x), d4 = (d.x - c.x) * (b.z - c.z) - (d.z - c.z) * (b.x - c.x);
    if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
  }
  return false;
}

/**
 * The lane graph of a set of alignment roads. `roads`: shared/island-roads.js IslandRoads (network, vertical profiles,
 * road types). `isPortal(x, z)`: whether a road end there meets a city's own lanes. Returns { lanes, roadLanes,
 * connectors, portals: [{ x, z, ux, uz, out: [lanes leaving the city edge], in: [lanes arriving at it] }] }.
 */
export function buildLaneGraph(roads, { isPortal = () => false, portalTrim = PORTAL_TRIM } = {}) {
  const net = roads.net, profiles = roads.profiles, roadLanes = [], connectors = [], portals = [];
  const J = net.junctions().filter(j => j.kind !== 'joint' || new Set(j.arms.map(a => a.id)).size > 1);
  // Cut stations per road: where each junction touches it, and how far its lanes stop short of it.
  const cuts = new Map();
  J.forEach((j, ji) => {
    const portal = j.kind === 'end' && isPortal(j.x, j.z);
    j.portal = portal;
    // A dead end's lanes stop just short of its turning circle's centre (shared/island-roads.js pads).
    j.circle = j.kind === 'end' && !portal ? (roads.pads || []).find(P => P.key === j.key) || null : null;
    // A junction's lanes stop at its stop bars: past the curb returns (shared/road-kit.js, so turns follow them), and at a
    // signal before its mast arm.
    j.plan = roads.plans?.get(j.key) || null;
    const trim = portal ? portalTrim : j.kind === 'end' ? (j.circle ? j.circle.r + 2 : DEAD_TRIM) : j.kind === 'joint' ? JOINT_TRIM : j.carriageHalf * UM + JUNCTION_PAD;
    for (const a of j.arms) {
      const list = cuts.get(a.id) || cuts.set(a.id, []).get(a.id);
      const A = j.plan?.arms.find(x => x.id === a.id && Math.abs(x.s - a.s) < 0.5);
      if (!list.some(c => c.ji === ji && Math.abs(c.s - a.s) < 0.5)) list.push({ s: a.s, trim: A ? A.stopAt ?? A.mouth + 0.8 : trim, ji });   // at a signal: its stop bar
    }
  });
  // Lane intervals between consecutive cuts; at each cut, which lanes arrive and which leave.
  const at = J.map(() => ({ arrive: [], leave: [] }));
  for (const r of net.all()) {
    const G = net.geometry(r.id), P = profiles[r.profile], prof = roads.prof.get(r.id), L = G.length;
    const list = (cuts.get(r.id) || []).sort((a, b) => a.s - b.s), iv = [];
    if (G.closed) {
      if (!list.length) iv.push({ s0: 0, s1: L, a: null, b: null });
      for (let i = 0; i < list.length; i++) { const a = list[i], b = list[(i + 1) % list.length], s1 = b.s + (i + 1 === list.length ? L : 0); iv.push({ s0: a.s + a.trim, s1: s1 - b.trim, a, b }); }
    } else {
      for (let i = 0; i + 1 < list.length; i++) iv.push({ s0: list[i].s + list[i].trim, s1: list[i + 1].s - list[i + 1].trim, a: list[i], b: list[i + 1] });
    }
    for (const { s0, s1, a, b } of iv) {
      if (s1 - s0 < 1) continue;
      P.lanes.forEach((ln, index) => {
        for (const dir of [1, -1]) {
          const lane = new RoadLane({ id: `${r.id}:${Math.round(s0)}:${dir > 0 ? 'f' : 'b'}${index}`, road: r.id, G, prof, off: ln.offset * UM, dir, s0, s1, limit: P.speedLimit, index });
          roadLanes.push(lane);
          // forward lanes leave cut a and arrive at cut b; backward lanes the other way round
          const [from, to] = dir > 0 ? [a, b] : [b, a];
          if (from) at[from.ji].leave.push(lane);
          if (to) at[to.ji].arrive.push(lane);
          if (!a && !b) lane.next.push(lane);   // a closed road with no junction: round and round
        }
      });
    }
  }
  // Connectors through each junction; portals list their lanes for the city to link to.
  J.forEach((j, ji) => {
    const { arrive, leave } = at[ji];
    if (j.portal) {
      const arm = j.arms[0];
      portals.push({ x: j.x, z: j.z, ux: arm.dirX, uz: arm.dirZ, out: leave, in: arrive });
      return;
    }
    const made = [];
    // at a signalled junction each lane coming in obeys its approach's light (shared/road-kit.js signalFor)
    if (j.plan?.signalized) for (const A of arrive) { const arm = j.plan.arms.findIndex(x => x.id === A.road && x.along === -A.dir); if (arm >= 0) A.signal = { plan: j.plan, arm }; }
    // a stop sign on an approach (shared/road-kit.js signs): a car comes to a stop at its bar before it goes on
    else if (j.plan?.signs?.length) for (const A of arrive) { const arm = j.plan.arms.findIndex(x => x.id === A.road && x.along === -A.dir); if (arm >= 0 && j.plan.arms[arm].stopSign) A.stopSign = true; }
    for (const A of arrive) {
      const a = A.end(true), lastA = Math.max(...profiles[net.get(A.road).profile].lanes.map((_, i) => i));
      for (const B of leave) {
        const sameRoadBack = B.road === A.road && B.dir !== A.dir && Math.abs((B.dir > 0 ? B.s0 : B.s1) - (A.dir > 0 ? A.s1 : A.s0)) < 0.5;
        if (j.kind === 'end' ? !sameRoadBack || B.index !== A.index : sameRoadBack) continue;
        const b = B.end(false), dyaw = wrap(yawOf(b.dx, b.dz) - yawOf(a.dx, a.dz)), lastB = Math.max(...profiles[net.get(B.road).profile].lanes.map((_, i) => i));
        const turn = j.kind === 'end' ? 'around' : Math.abs(dyaw) < 0.45 ? 'straight' : dyaw > 0 ? 'left' : 'right';
        if (turn === 'straight' && Math.min(A.index, lastB) !== Math.min(B.index, lastA)) continue;
        if (turn === 'left' && (A.index !== 0 || B.index !== 0)) continue;
        if (turn === 'right' && (A.index !== lastA || B.index !== lastB)) continue;
        const pts = turn === 'around' && j.circle ? turnaroundPoints(a, b, j.circle) : connectorPoints(a, b), C = new PathLane({ id: `${j.key}:${A.id}>${B.id}`, pts, limit: curveSpeed(pts, Math.min(A.limit, B.limit)), junction: j.key, from: A, to: B, turn });
        A.next.push(C); B.feeders.push(C); made.push(C); connectors.push(C);
      }
    }
    // Connectors that merge into the same lane or cross each other are used one at a time.
    for (let i = 0; i < made.length; i++) for (let k = i + 1; k < made.length; k++) {
      const p = made[i], q = made[k];
      if (p.from === q.from) continue;
      if (p.to === q.to || segsCross(p.pts, q.pts)) { p.conflicts.push(q); q.conflicts.push(p); }
    }
    for (const C of made) C.conflicts.push(C);   // one car committed to a connector at a time; followers queue behind
  });
  return { lanes: [...roadLanes, ...connectors], roadLanes, connectors, portals };
}
