// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Residents' drives on the roads (2026-10-28, the product owner: people leaving the Radio Station "disappear ... their
// position is moving straight (not through roads)"; then "how would the car know where to go and what roads to follow?
// would it abide by traffic lights, traffic...etc?" → a real route, the lights, traffic keeping clear of it).
// - The route: the quickest way along the roads (the city's streets and the roads beyond it, one network:
//   shared/city-roads.js worldRoads) from the road beside where the drive starts to the road beside where it ends, by
//   each road's speed limit; in the kerbside lane for the way it goes, round each junction on a turning curve.
// - The timetable: driven along it from a standing start, up to each road's speed limit and slower round the turns;
//   at a junction with lights it stops for a red (or an amber it can stop for), and a left turn also goes on its arrow,
//   by the same timetable as the city's own traffic (shared/road-kit.js signalFor; an older grid's corners
//   shared/constants.js sigLight), the same in every browser at the same moment; at a stop sign it stops, then goes;
//   at the end it comes to a stop.
// Pure: the server plans a resident's drive with it (server/sim/plan.js drive: the resident rides in the car, so its
// place is the car's), every browser draws the car by it (render/resident-cars.js), and the server's traffic keeps
// clear of it (server/world/vehicles.js).
import { pointAt, tangentAt, project } from './roads.js';
import { connectorPoints, curveSpeed } from './lane-graph.js';
import { signalFor } from './road-kit.js';
import { sigLight } from './constants.js';
import { isCityRoad } from './city-roads.js';
import { ixIndex } from './city.js';

const UM = 1e-6;
/** How a resident drives: m/s² up and down, how far short of a stop bar its front stops (m), a stop sign's pause (s),
 *  the step (s), the slowest round a turn (m/s), its length (m). */
export const DRIVE = Object.freeze({ accel: 2.2, decel: 2.6, stopShort: 0.6, signPause: 1.5, dt: 0.25, minTurn: 3, carLen: 4.6 });
const CITY_STOP = 11.7;     // m from an older grid's corner where its traffic stops (shared/vehicle-traffic.js)
const JUNCTION_PAD = 2.5;   // m beyond the widest roadway at a junction without a plan (shared/lane-graph.js)
const yawTo = (dx, dz) => Math.atan2(dx, dz);   // (the renderer's yaw: render/resident-cars.js)
// s: setting off or arriving on the far side of the road from where its resident is (it would cross the street on foot:
// 2026-10-28, seen in the browser — a resident got out and walked across an avenue's lanes): it goes round instead, as a
// driver would, unless that is much longer
const WRONG_SIDE = 90;
const PULL_IN = 14;   // m over which it pulls out from the kerb and in to it

/** The roads as a graph, kept on the network: nodes the junctions (by key), edges the stretches of road between them.
 *  `grid` (shared/city.js makeGrid): on an older grid the roads beyond the city stop at its edge without meeting a
 *  street (the city's traffic carries on from them: shared/vehicle-traffic.js portals); each such end is linked to the
 *  street beside it by a short straight (a 'link' edge). */
function graphOf(net, grid = null) {
  if (net._carGraph) return net._carGraph;
  const J = net.junctions(), at = new Map(), adj = new Map(), links = [];
  for (const j of J) for (const a of j.arms) {
    const l = at.get(a.id) || at.set(a.id, []).get(a.id);
    if (!l.some(x => x.key === j.key && Math.abs(x.s - a.s) < 0.5)) l.push({ s: a.s, key: j.key });
  }
  if (grid) {
    const edge = 40, near = (x, z) => x > grid.minX - edge && x < grid.maxX + edge && z > grid.minZ - edge && z < grid.maxZ + edge;
    for (const j of J) {
      if (j.kind !== 'end' || j.arms.some(a => isCityRoad(a.id)) || !near(j.x, j.z)) continue;
      let best = null;
      for (const id of net.candidates({ x0: j.x - 60, z0: j.z - 60, x1: j.x + 60, z1: j.z + 60 })) {
        if (!isCityRoad(id)) continue;
        const q = project(net.geometry(id), j.x, j.z); if (q && q.dist < 60 && (!best || q.dist < best.q.dist)) best = { id, q };
      }
      if (!best) continue;
      const key = `link:${j.key}`;
      (at.get(best.id) || at.set(best.id, []).get(best.id)).push({ s: best.q.s, key });
      links.push({ a: j.key, b: key, x0: j.x, z0: j.z, x1: best.q.x, z1: best.q.z, len: Math.max(1, best.q.dist), lim: net.profiles[net.get(best.id).profile].speedLimit });
    }
  }
  const add = (from, e) => (adj.get(from) || adj.set(from, []).get(from)).push(e);
  for (const L of links) {
    add(L.a, { from: L.a, to: L.b, link: true, x0: L.x0, z0: L.z0, x1: L.x1, z1: L.z1, len: L.len, cost: L.len / L.lim });
    add(L.b, { from: L.b, to: L.a, link: true, x0: L.x1, z0: L.z1, x1: L.x0, z1: L.z0, len: L.len, cost: L.len / L.lim });
  }
  for (const [id, list] of at) {
    list.sort((p, q) => p.s - q.s);
    const G = net.geometry(id), lim = net.profiles[net.get(id).profile].speedLimit;
    const pairs = [];
    for (let k = 0; k + 1 < list.length; k++) pairs.push([list[k], list[k + 1], list[k + 1].s - list[k].s]);
    if (G.closed && list.length > 1) pairs.push([list.at(-1), list[0], G.length - list.at(-1).s + list[0].s]);
    for (const [p, q, L] of pairs) {
      if (L < 0.5) continue;
      add(p.key, { from: p.key, to: q.key, id, s0: p.s, s1: q.s, dir: 1, len: L, cost: L / lim });
      add(q.key, { from: q.key, to: p.key, id, s0: q.s, s1: p.s, dir: -1, len: L, cost: L / lim });
    }
  }
  return (net._carGraph = { J: new Map(J.map(j => [j.key, j])), adj, at });
}
/** s on road G after going d from s0 in direction dir (round a ring). */
function sOn(G, s0, dir, d) { const s = s0 + dir * d; return G.closed ? ((s % G.length) + G.length) % G.length : Math.max(0, Math.min(G.length, s)); }
/** How far from s0 to s1 going dir along road G. */
function span(G, s0, s1, dir) { const d = (s1 - s0) * dir; return G.closed ? ((d % G.length) + G.length) % G.length : Math.max(0, d); }

/**
 * The quickest way along the roads from (ax, az) to (bx, bz): the road nearest each (within `reach` m), then by the
 * roads' speed limits. [{ id, s0, s1, dir, len, from, to }] (from/to: junction keys, 'A'/'B' at the ends), or null.
 */
export function roadRoute(net, ax, az, bx, bz, { reach = 60, grid = null } = {}) {
  const A = net.nearest(ax, az, reach), B = net.nearest(bx, bz, reach);
  if (!A || !B) return null;
  const g = graphOf(net, grid), lim = id => net.profiles[net.get(id).profile].speedLimit;
  // the ends: on their road between its junctions (either way along it)
  const ends = (E, key) => {
    const G = net.geometry(E.id), list = g.at.get(E.id) || [], out = [];
    let lo = null, hi = null;
    for (const q of list) { if (q.s <= E.s && (!lo || q.s > lo.s)) lo = q; if (q.s >= E.s && (!hi || q.s < hi.s)) hi = q; }
    if (G.closed && list.length) { lo ||= list.at(-1); hi ||= list[0]; }
    if (hi) out.push({ key: hi.key, id: E.id, s: hi.s, dir: 1, len: span(G, E.s, hi.s, 1) });
    if (lo) out.push({ key: lo.key, id: E.id, s: lo.s, dir: -1, len: span(G, E.s, lo.s, -1) });
    return out;
  };
  const adj = (k) => g.adj.get(k) || [];
  const extra = new Map();   // node → edges from A, and into B
  // (its kerb: the side of the road where its resident is — the right as it goes, the way right-hand traffic pulls over)
  const sideOf = E => (Math.abs(E.offset) > 0.5 ? Math.sign(E.offset) : 0), sA = sideOf(A), sB = sideOf(B);
  const wrong = (side, dir) => (side && dir !== side ? WRONG_SIDE : 0);
  for (const e of ends(A, 'A')) (extra.get('A') || extra.set('A', []).get('A')).push({ from: 'A', to: e.key, id: e.id, s0: A.s, s1: e.s, dir: e.dir, len: e.len, cost: e.len / lim(e.id) + wrong(sA, e.dir) });
  const intoB = new Map();
  for (const e of ends(B, 'B')) (intoB.get(e.key) || intoB.set(e.key, []).get(e.key)).push({ from: e.key, to: 'B', id: e.id, s0: e.s, s1: B.s, dir: -e.dir, len: e.len, cost: e.len / lim(e.id) + wrong(sB, -e.dir) });
  // both on the same stretch of one road: straight there
  if (A.id === B.id) {
    const G = net.geometry(A.id), dir = B.s >= A.s ? 1 : -1, len = span(G, A.s, B.s, dir);
    const between = (g.at.get(A.id) || []).some(q => (q.s - A.s) * dir > 0.5 && (B.s - q.s) * dir > 0.5);
    if (!between) (extra.get('A') || extra.set('A', []).get('A')).push({ from: 'A', to: 'B', id: A.id, s0: A.s, s1: B.s, dir, len, cost: len / lim(A.id) + wrong(sA, dir) + wrong(sB, dir) });
  }
  // Dijkstra (a few hundred junctions: a plain scan is enough)
  const dist = new Map([['A', 0]]), via = new Map(), done = new Set(), open = new Set(['A']);
  while (open.size) {
    let k = null, best = Infinity; for (const n of open) { const d = dist.get(n); if (d < best) { best = d; k = n; } }
    open.delete(k); done.add(k);
    if (k === 'B') break;
    const out = [...(k === 'A' ? extra.get('A') || [] : adj(k)), ...(intoB.get(k) || [])];
    for (const e of out) {
      if (done.has(e.to)) continue;
      const turn = k === 'A' ? 0 : 2;   // (s: a junction costs a little: the straighter way wins a near tie)
      const d = best + e.cost + turn;
      if (d < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, d); via.set(e.to, e); open.add(e.to); }
    }
  }
  if (!via.has('B')) return null;
  const legs = []; for (let k = 'B'; k !== 'A'; k = via.get(k).from) legs.unshift(via.get(k));
  return legs;
}

/** The arm of junction plan P a car on road id arrives by, heading `dir` along it to the junction at s: its index or −1. */
function armIn(P, id, s, dir) { return P ? P.arms.findIndex(A => A.id === id && Math.abs(A.s - s) < 1 && A.along === -dir) : -1; }

/**
 * A drive's path and its stops: the route's lanes (the kerbside lane of each road for the way it goes), cut back at each
 * junction (at its stop bar) and joined round it by a turning curve. `plans`: junction key → shared/road-kit.js plan
 * (signals, stop signs, stop bars); `grid` (shared/city.js makeGrid): an older grid's lights at its corners.
 * { pts: [x, z, …] (m, 0.1), S: [arc length per point], vmax: [m/s per point], stops: [{ s, kind: 'signal'|'sign',
 * key, arm, turn, city? }], len } or null.
 */
export function routePath(net, legs, { plans = new Map(), grid = null } = {}) {
  if (!legs?.length) return null;
  const g = graphOf(net, grid), P = [], vmax = [], stops = [];
  const laneOff = id => { const L = net.profiles[net.get(id).profile].lanes; return (L.at(-1)?.offset ?? 0) * UM; };
  // how far from a junction its lanes end on an arm: its stop bar, else its roadway's half width and a little
  const trim = (key, id, s, dir) => {
    if (key === 'A' || key === 'B' || key.startsWith('link:')) return 0;
    const J = g.J.get(key), Pl = plans.get(key), k = armIn(Pl, id, s, dir) >= 0 ? armIn(Pl, id, s, dir) : Pl ? Pl.arms.findIndex(A => A.id === id && Math.abs(A.s - s) < 1) : -1;
    if (Pl && k >= 0 && Number.isFinite(Pl.arms[k].stopAt)) return Pl.arms[k].stopAt;
    if (grid && J && J.arms.every(a => isCityRoad(a.id))) return CITY_STOP;
    return J ? J.carriageHalf * UM + JUNCTION_PAD : 0;
  };
  const pose = (id, s, dir) => {
    const G = net.geometry(id), p = pointAt(G, s, {}), t = tangentAt(G, s, dir < 0), tx = t.dx * dir, tz = t.dz * dir, off = laneOff(id);
    return { x: p.x - tz * off, z: p.z + tx * off, dx: tx, dz: tz };
  };
  const push = (x, z, v) => { const l = P.at(-1); if (l && Math.hypot(x - l[0], z - l[1]) < 0.3) { vmax[vmax.length - 1] = Math.min(vmax.at(-1), v); return; } P.push([x, z]); vmax.push(v); };
  let prevEnd = null;
  legs.forEach((e, n) => {
    if (e.link) {
      // a road's end at an older city's edge to the street beside it: round onto it, straight across
      const L = Math.hypot(e.x1 - e.x0, e.z1 - e.z0) || 1, dx = (e.x1 - e.x0) / L, dz = (e.z1 - e.z0) / L, lim = prevEnd?.lim ?? 8;
      if (prevEnd) for (const q of connectorPoints({ ...prevEnd.p, y: 0 }, { x: e.x0, z: e.z0, dx, dz, y: 0 }, { n: 6 }).slice(1)) push(q.x, q.z, Math.min(lim, 8));
      for (let d = 4; d < L; d += 4) push(e.x0 + dx * d, e.z0 + dz * d, Math.min(lim, 8));
      push(e.x1, e.z1, Math.min(lim, 8));
      prevEnd = { p: { x: e.x1, z: e.z1, dx, dz }, key: e.to, id: null, s: 0, dir: 1, lim: Math.min(lim, 8) };
      return;
    }
    const G = net.geometry(e.id), lim = net.profiles[net.get(e.id).profile].speedLimit;
    const t0 = n === 0 ? 0 : trim(e.from, e.id, e.s0, -e.dir), t1 = n === legs.length - 1 ? 0 : trim(e.to, e.id, e.s1, e.dir);
    const usable = e.len - t0 - t1, a = sOn(G, e.s0, e.dir, Math.min(t0, e.len / 2)), b = sOn(G, e.s1, -e.dir, Math.min(t1, e.len / 2));
    const startPose = pose(e.id, a, e.dir);
    // round the junction from the last lane into this one
    if (prevEnd) {
      const c = connectorPoints({ ...prevEnd.p, y: 0 }, { ...startPose, y: 0 }, { n: 10 }), v = curveSpeed(c, Math.min(prevEnd.lim, lim));
      const ix = prevEnd.p, out = startPose, cross = ix.dx * out.dz - ix.dz * out.dx, turn = ix.dx * out.dx + ix.dz * out.dz > 0.7 ? 'straight' : (-ix.dz * out.dx + ix.dx * out.dz) > 0 ? 'right' : 'left';
      void cross;
      // the stop bar: where the last lane ended (its arc length), and what rules it
      const J = g.J.get(prevEnd.key), Pl = plans.get(prevEnd.key), arm = armIn(Pl, prevEnd.id, prevEnd.s, prevEnd.dir);
      const sBar = P.length - 1;   // (the bar: where the last lane ended — its point; its arc length once the path is done)
      if (Pl && Pl.signalized && arm >= 0) stops.push({ s: sBar, kind: 'signal', key: prevEnd.key, arm, turn });
      else if (Pl && arm >= 0 && Pl.arms[arm].stopSign) stops.push({ s: sBar, kind: 'sign', key: prevEnd.key, arm, turn });
      else if (!Pl && grid && J && J.arms.every(q => isCityRoad(q.id))) {
        const i = Math.round((J.x - grid.X[0]) / grid.px), k = Math.round((J.z - grid.Z[0]) / grid.pz);
        stops.push({ s: sBar, kind: 'signal', key: prevEnd.key, city: { ix: ixIndex(grid, i, k), axis: Math.abs(ix.dz) > Math.abs(ix.dx) ? 0 : 1 }, turn });
      }
      for (const q of c.slice(1)) push(q.x, q.z, v);
    }
    // along this road's lane: short steps round its curves, long ones on its straights
    if (usable > 0.3 || n === 0 || n === legs.length - 1) {
      const L = span(G, a, b, e.dir);
      let d = 0, lastYaw = null;
      for (;;) {
        const s = sOn(G, a, e.dir, d), q = pose(e.id, s, e.dir), yaw = Math.atan2(q.dz, q.dx);
        if (d === 0 || d >= L || lastYaw === null || Math.abs(((yaw - lastYaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) > 0.03 || d % 40 < 4.01) { push(q.x, q.z, lim); lastYaw = yaw; }
        if (d >= L) break;
        d = Math.min(L, d + 4);
      }
    }
    prevEnd = { p: pose(e.id, b, e.dir), key: e.to, id: e.id, s: e.s1, dir: e.dir, lim };
  });
  if (P.length < 2) return null;
  // at the kerb where it sets off and arrives (a city street's parking lane, a country road's shoulder): pulled over
  // there, pulling out to its lane and in again over PULL_IN m
  const kerb = id => { if (!id) return 0; const Pr = net.profiles[net.get(id).profile]; return Math.max(0, Pr.carriageHalf * UM - 1.1 - laneOff(id)); };
  const first = legs.find(e => !e.link)?.id, last = [...legs].reverse().find(e => !e.link)?.id, kA = kerb(first), kB = kerb(last);
  const L0 = [0]; for (let k = 1; k < P.length; k++) L0.push(L0[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
  const total = L0.at(-1), ease = d => { const u = Math.max(0, 1 - d / PULL_IN); return u * u * (3 - 2 * u); };
  if (kA || kB) {
    const Q = P.map(p => [...p]);
    for (let k = 0; k < P.length; k++) {
      const sh = kA * ease(L0[k]) + kB * ease(total - L0[k]); if (sh < 0.01) continue;
      const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      Q[k][0] += -dz / l * sh; Q[k][1] += dx / l * sh;
    }
    P.splice(0, P.length, ...Q);
  }
  const pts = [], S = [0];
  for (let k = 0; k < P.length; k++) { pts.push(Math.round(P[k][0] * 10) / 10, Math.round(P[k][1] * 10) / 10); if (k) S.push(S[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1])); }
  for (const st of stops) st.s = S[Math.min(st.s, S.length - 1)];
  return { pts, S, vmax, stops, len: S.at(-1) };
}

/** The light a stop shows at time t: 0 red, 1 amber, 2 green, 3 left arrow. */
function lightAt(st, plans, t) {
  if (st.city) return sigLight(st.city.ix, t, st.city.axis);
  const P = plans.get(st.key); return P ? signalFor(P, st.arm, t) : 2;
}
/**
 * The timetable of a drive along `path` (routePath) starting from a standstill at time t0: as the city's traffic
 * drives (shared/vehicle-traffic.js: speed limits, slower round turns, a red or an amber it can stop for holds it at the
 * bar, a left turn also goes on its arrow, a stop sign stops it first), to a stop at the end. Knots { ks: [arc length],
 * ts: [time] } kept where its speed changes (straight lines between them in time), t1 when it has stopped there.
 */
export function driveTimetable(path, t0, { plans = new Map() } = {}) {
  const { S, vmax, stops, len } = path, D = DRIVE, dt = D.dt, ks = [0], ts = [t0];
  let s = 0, v = 0, t = t0, next = 0, waited = 0, lastV = 0, lastT = t0, here = 0;
  const limitAt = x => { let lo = 0, hi = S.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m] <= x) lo = m; else hi = m - 1; } return Math.min(vmax[lo], vmax[Math.min(lo + 1, vmax.length - 1)]); };
  for (let guard = 0; guard < 40000; guard++) {
    // as fast as the road here and the slower stretches ahead allow (slowing in time for them), and the end
    let want = limitAt(s);
    while (here < S.length - 1 && S[here + 1] <= s) here++;
    for (let k = here + 1; k < S.length; k++) { const d = S[k] - s; if (d <= 0) continue; if (d > v * v / (2 * D.decel) + 40) break; want = Math.min(want, Math.sqrt(vmax[k] * vmax[k] + 2 * D.decel * d)); }
    want = Math.min(want, Math.max(0.6, Math.sqrt(2 * D.decel * Math.max(0, len - s))));   // (creeping the last bit: it gets there)
    // the next stop: its light or sign
    const st = stops[next];
    if (st) {
      const d = st.s - D.stopShort - D.carLen / 2 - s;   // (s: the car's middle; its front stops short of the bar)
      let go = false;
      if (st.kind === 'sign') go = waited >= D.signPause;
      else { const lt = lightAt(st, plans, t); go = lt === 2 || (lt === 3 && st.turn === 'left') || (lt === 1 && d < v * v / 6 + 0.5); }
      if (!go) {
        want = Math.min(want, Math.sqrt(2 * D.decel * Math.max(0, d)));
        if (d < 0.4 && v < 0.2) { v = 0; waited += dt; }
      }
      if (go && s > st.s - D.carLen / 2) { next++; waited = 0; }
      else if (go && st.kind === 'signal') { /* through on green: passes it as it goes */ if (s + D.carLen / 2 > st.s) { next++; waited = 0; } }
    }
    const dv = want - v;
    v = Math.max(0, v + (dv > 0 ? Math.min(dv, D.accel * dt) : Math.max(dv, -2.5 * D.decel * dt)));
    s = Math.min(len, s + v * dt); t += dt;
    if (Math.abs(v - lastV) > 0.8 || t - lastT >= 6 || (v === 0) !== (lastV === 0) || s >= len) { ks.push(+s.toFixed(2)); ts.push(+t.toFixed(2)); lastV = v; lastT = t; }
    if (s >= len - 0.05) { s = len; break; }
  }
  if (ks.at(-1) !== len) { ks.push(+len.toFixed(2)); ts.push(+t.toFixed(2)); }
  return { ks, ts, t0, t1: ts.at(-1) };
}

/** The point at arc length s along a drive's path: { x, z, dx, dz, yaw } (out reused). */
export function pathAt(D, s, out = {}) {
  const S = D.S, P = D.pts, n = S.length;
  if (!(s > 0)) s = 0; if (s > S[n - 1]) s = S[n - 1];
  let lo = 0, hi = n - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m] <= s) lo = m; else hi = m - 1; }
  const k = Math.min(lo, n - 2), L = S[k + 1] - S[k], u = L > 1e-6 ? (s - S[k]) / L : 0;
  const ax = P[2 * k], az = P[2 * k + 1], bx = P[2 * k + 2], bz = P[2 * k + 3];
  out.x = ax + (bx - ax) * u; out.z = az + (bz - az) * u;
  const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1; out.dx = dx / l; out.dz = dz / l; out.yaw = yawTo(out.dx, out.dz);
  return out;
}
/** How far along its path a drive is at time t (before it starts: 0; after: its length). */
export function driveS(D, t) {
  const ts = D.ts, ks = D.ks, n = ts.length;
  if (t <= ts[0]) return 0; if (t >= ts[n - 1]) return ks[n - 1];
  let lo = 0, hi = n - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ts[m] <= t) lo = m; else hi = m - 1; }
  const dt = ts[lo + 1] - ts[lo];
  return ks[lo] + (ks[lo + 1] - ks[lo]) * (dt > 1e-6 ? (t - ts[lo]) / dt : 1);
}
/** Where a drive's car is at time t: { x, z, dx, dz, yaw, s } (parked at its start before it goes, at its end after). */
export function carAt(D, t, out = {}) { const s = driveS(D, t); pathAt(D, s, out); out.s = s; return out; }
/** A flat path's arc lengths (a drive as sent to the browsers carries its points; they work these out once). */
export function arcLengths(pts) { const S = [0]; for (let k = 2; k < pts.length; k += 2) S.push(S.at(-1) + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1])); return S; }
