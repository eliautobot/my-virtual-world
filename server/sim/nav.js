// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Street + indoor navigation for the simulation.
// Street network: walking-band corners of every block, joined along block sides and by crosswalks
// (orthogonal + diagonal scramble crossings) at every intersection. All-pairs shortest paths are precomputed.
// Beyond the city (WP4.5) residents walk the footpaths along its roads (./island-walk.js), which meet these streets
// where the roads leave the city; an access record there has walk = true and the footpath point it joins.
import { makeGrid, blockRect, cornerPoint, blockIndex, blockIJ, SIDE_CORNERS, rotToSide, bandPoint, ixIndex } from '../../shared/city.js';
import { WALK_SPEED, CROSS_SPEED, GROUND_Y, clamp } from '../../shared/constants.js';
import { buildGrid, findPath, flood, nearestFree, wallBetween } from '../../shared/navgrid.js';
import { toWorld, bRot } from '../../shared/geom.js';
import { doorPoints, gatePoints, levelEntries } from '../../shared/building.js';
import { MinHeap } from './minheap.js';
import { IslandWalk } from './island-walk.js';
import { Island } from '../../shared/terrain.js';
import { buildingPads } from '../../shared/island-build.js';
import { addressOf } from '../../shared/city.js';
import { docksOf } from '../../shared/ferries.js';
import { worldRoads, cityRoadSet } from '../../shared/city-roads.js';
import { tangentAt } from '../../shared/roads.js';
import { stationY } from '../../shared/stations.js';

export const SUBWAY_SPEED = 18;
/** Driving beyond the city (WP4.5 until residents' own cars arrive with WP4.9): average speed (m/s) and the time to get
 *  the car out and park it (s). */
export const RIDE_SPEED = 14, RIDE_EXTRA = 45;
const WAIT_EST = 14;
const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export { MinHeap };

export class Nav {
  constructor(world) {
    this.world = world;
    this.g = makeGrid(world.grid);
    this.grids = new Map();
    this.cache = new Map();
    this.reachCache = new Map();
    this.approachCache = new Map();
    this.stats = { searches: 0, failed: 0, detours: 0, straight: 0 };   // indoor path searches (read by tools/simhealth.mjs)
    this.buildGraph();
    this.refreshAccess();
  }

  buildGraph() {
    const g = this.g, nb = g.nx * g.nz, N = nb * 4;
    this.N = N;
    const P = this.P = new Float64Array(N * 2);
    for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) for (let c = 0; c < 4; c++) {
      const p = cornerPoint(g, i, j, c), n = blockIndex(g, i, j) * 4 + c;
      P[n * 2] = p.x; P[n * 2 + 1] = p.z;
    }
    const adj = Array.from({ length: N }, () => []);
    const edges = this.edges = new Map();
    const add = (a, b, ix) => {
      const len = hyp(P[a * 2], P[a * 2 + 1], P[b * 2], P[b * 2 + 1]);
      const cost = ix >= 0 ? len / CROSS_SPEED + WAIT_EST : len / WALK_SPEED;
      adj[a].push(b, cost); adj[b].push(a, cost);
      edges.set(a * N + b, ix); edges.set(b * N + a, ix);
    };
    for (let bi = 0; bi < nb; bi++) { const o = bi * 4; add(o, o + 1, -1); add(o + 1, o + 2, -1); add(o + 2, o + 3, -1); add(o + 3, o, -1); }
    const blk = (i, j) => (i >= 0 && j >= 0 && i < g.nx && j < g.nz ? blockIndex(g, i, j) * 4 : -1);
    for (let j = 0; j <= g.nz; j++) for (let i = 0; i <= g.nx; i++) {
      const ix = ixIndex(g, i, j);
      const A = blk(i - 1, j - 1), B = blk(i, j - 1), C = blk(i - 1, j), D = blk(i, j);
      const a = A >= 0 ? A + 2 : -1, b = B >= 0 ? B + 3 : -1, c = C >= 0 ? C + 1 : -1, d = D >= 0 ? D : -1;
      for (const [p, q] of [[a, b], [c, d], [a, c], [b, d], [a, d], [b, c]]) if (p >= 0 && q >= 0) add(p, q, ix);
    }
    const dist = this.dist = new Float32Array(N * N), pred = this.pred = new Int16Array(N * N);
    const d = new Float64Array(N), done = new Uint8Array(N), pr = new Int16Array(N);
    for (let s = 0; s < N; s++) {
      d.fill(Infinity); done.fill(0); pr.fill(-1); d[s] = 0;
      const h = new MinHeap(); h.push(0, s);
      while (h.size) {
        const du = h.peekKey(), u = h.pop();
        if (done[u]) continue; done[u] = 1;
        const L = adj[u];
        for (let k = 0; k < L.length; k += 2) {
          const v = L[k], nd = du + L[k + 1];
          if (nd < d[v]) { d[v] = nd; pr[v] = u; h.push(nd, v); }
        }
      }
      for (let v = 0; v < N; v++) { dist[s * N + v] = d[v]; pred[s * N + v] = pr[v]; }
    }
  }
  pathNodes(a, b) {
    const N = this.N, out = [b]; let v = b, guard = 0;
    while (v !== a && guard++ < N) { v = this.pred[a * N + v]; if (v < 0) return [a, b]; out.push(v); }
    return out.reverse();
  }
  _best(A, B) {
    const g = this.g, N = this.N, P = this.P;
    const ba = blockIndex(g, A.i, A.j), bb = blockIndex(g, B.i, B.j);
    let best = Infinity, pair = null;
    if (ba === bb && A.side === B.side) best = hyp(A.bx, A.bz, B.bx, B.bz) / WALK_SPEED;
    for (const ca of SIDE_CORNERS[A.side]) {
      const na = ba * 4 + ca, da = hyp(A.bx, A.bz, P[na * 2], P[na * 2 + 1]) / WALK_SPEED;
      for (const cb of SIDE_CORNERS[B.side]) {
        const nb2 = bb * 4 + cb;
        const dd = da + this.dist[na * N + nb2] + hyp(P[nb2 * 2], P[nb2 * 2 + 1], B.bx, B.bz) / WALK_SPEED;
        if (dd < best - 1e-6) { best = dd; pair = [na, nb2]; }
      }
    }
    return { cost: best + (hyp(A.x, A.z, A.bx, A.bz) + hyp(B.x, B.z, B.bx, B.bz)) / WALK_SPEED, pair };
  }
  streetCost(A, B) { return A.walk || B.walk ? this.walkRoute(A, B).cost : this._best(A, B).cost; }
  /** Polyline [{x, z, y?, c?, ix?, ba?, bb?}] from A's point to B's point; c=1 marks a crosswalk segment ending here;
   *  y: the ground's height beyond the city (absent: the city's sidewalks). */
  streetPolyline(A, B) {
    if (A.walk || B.walk) return this.walkRoute(A, B, true).pts;
    const { pair } = this._best(A, B), P = this.P, N = this.N;
    const pts = [{ x: A.x, z: A.z }, { x: A.bx, z: A.bz }];
    if (pair) {
      const nodes = this.pathNodes(pair[0], pair[1]);
      for (let k = 0; k < nodes.length; k++) {
        const n = nodes[k], p = { x: P[n * 2], z: P[n * 2 + 1] };
        if (k > 0) { const ix = this.edges.get(nodes[k - 1] * N + n); if (ix >= 0) { p.c = 1; p.ix = ix; p.ba = nodes[k - 1] >> 2; p.bb = n >> 2; } }
        pts.push(p);
      }
    }
    pts.push({ x: B.bx, z: B.bz }, { x: B.x, z: B.z });
    const out = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      const q = out[out.length - 1];
      if (Math.abs(pts[k].x - q.x) < 0.05 && Math.abs(pts[k].z - q.z) < 0.05) continue;
      out.push(pts[k]);
    }
    return out;
  }
  blockRectOf(bi) { const { i, j } = blockIJ(this.g, bi); return blockRect(this.g, i, j); }

  // ---- beyond the city (WP4.5) ----
  /** The footpaths beyond the city, rebuilt when the island or its roads change; null without them. */
  walk() {
    const W = this.world;
    if (!W.terrain || !(W.roads || []).length) return null;
    const c = this._walk;
    if (c && c.terrain === W.terrain && c.roads === W.roads && c.ferries === W.ferries) return c.walk;
    const island = new Island(W.terrain, { roads: W.roads }), g = this.g, e = 1;
    // a road joins the city at its edge, or (widened, shared/city-roads.js) at the centre of an edge street's junction:
    // its footpaths then stop just outside the city and link to the nearest street corner
    const wide = !!cityRoadSet(W.grid), [x0, x1, z0, z1] = wide ? [g.X[0], g.X.at(-1), g.Z[0], g.Z.at(-1)] : [g.minX, g.maxX, g.minZ, g.maxZ];
    const isEdge = (x, z) => x >= x0 - e && x <= x1 + e && z >= z0 - e && z <= z1 + e && (Math.abs(x - x0) < e || Math.abs(x - x1) < e || Math.abs(z - z0) < e || Math.abs(z - z1) < e);
    const ferries = (W.ferries || []).map(f => ({ f, docks: docksOf(f, island) }));
    const walk = island.roads ? new IslandWalk(island.roads, (x, z) => island.height(x, z), { g, P: this.P, N: this.N, isEdge, trim: wide ? g.hr + 1.5 : 0 }, ferries) : null;
    this._walk = { terrain: W.terrain, roads: W.roads, ferries: W.ferries, island, walk, padsKey: null, ground: null };
    return walk;
  }
  /** The ground's height beyond the city with the buildings' pads (for the paths from doors to the footpaths). */
  groundY(x, z) {
    let c = this._walk;
    if (!c) {   // no roads yet: the island's own ground (a world without a city starts with none)
      const T = this.world.terrain; if (!T) return GROUND_Y;
      if (!this._bare || this._bare.terrain !== T) this._bare = { terrain: T, island: new Island(T), padsKey: null, ground: null };
      c = this._bare;
    }
    const pads = buildingPads(this.world), key = JSON.stringify(pads);
    if (c.padsKey !== key) { c.padsKey = key; c.ground = c.island.withPads(pads); }
    return c.ground.height(x, z);
  }
  /** Whether (x, z) is beyond the city's streets (on the island). */
  beyond(x, z) { const g = this.g; return x < g.minX || x > g.maxX || z < g.minZ || z > g.maxZ; }
  /** An access record beyond the city: point (x, z) joined to the nearest footpath point by a straight path. */
  walkAccess(x, z, extra = {}) {
    const W = this.walk(), n = W ? W.nearestNode(x, z, 400) : -1;
    const spur = n >= 0 ? hyp(x, z, W.X[n], W.Z[n]) : 0;
    return { x, z, walk: true, node: n, spur, ...extra };
  }
  /** Points from (x, z) to footpath point n every ~4 m, on the ground. */
  spurPts(x, z, n, reverse = false) {
    const W = this._walk.walk, tx = W.X[n], tz = W.Z[n], L = hyp(x, z, tx, tz), k = Math.max(1, Math.ceil(L / 4)), out = [];
    for (let i = 0; i <= k; i++) { const u = i / k, px = x + (tx - x) * u, pz = z + (tz - z) * u; out.push({ x: px, z: pz, y: i === k ? W.Y[n] : this.groundY(px, pz) }); }
    return reverse ? out.reverse() : out;
  }
  /** Cost (s) and, with pts, the points from city access A to city street-corner node n. */
  cityToNode(A, n, pts = false) {
    const N = this.N, P = this.P, ba = blockIndex(this.g, A.i, A.j);
    let best = Infinity, na = -1;
    for (const ca of SIDE_CORNERS[A.side]) {
      const m = ba * 4 + ca, c = hyp(A.bx, A.bz, P[m * 2], P[m * 2 + 1]) / WALK_SPEED + this.dist[m * N + n];
      if (c < best) { best = c; na = m; }
    }
    best += hyp(A.x, A.z, A.bx, A.bz) / WALK_SPEED;
    if (!pts) return { cost: best };
    const out = [{ x: A.x, z: A.z }, { x: A.bx, z: A.bz }], nodes = this.pathNodes(na, n);
    for (let k = 0; k < nodes.length; k++) {
      const v = nodes[k], p = { x: P[v * 2], z: P[v * 2 + 1] };
      if (k > 0) { const ix = this.edges.get(nodes[k - 1] * N + v); if (ix >= 0) { p.c = 1; p.ix = ix; p.ba = nodes[k - 1] >> 2; p.bb = v >> 2; } }
      out.push(p);
    }
    return { cost: best, pts: out };
  }
  /**
   * A walk between two access records where one or both are beyond the city: along the footpaths, through the best
   * link with the city's streets when one end is in the city. { cost (s), pts } — with no way through (a building cut
   * off from every road), a straight walk over the ground.
   */
  walkRoute(A, B, wantPts = false) {
    const W = this.walk();
    const straight = () => {
      const L = hyp(A.x, A.z, B.x, B.z), k = Math.max(1, Math.ceil(L / 10)), pts = [];
      if (wantPts) for (let i = 0; i <= k; i++) { const px = A.x + (B.x - A.x) * i / k, pz = A.z + (B.z - A.z) * i / k; pts.push({ x: px, z: pz, y: this.beyond(px, pz) ? this.groundY(px, pz) : undefined }); }
      return { cost: L / WALK_SPEED * 1.5 + 30, pts };
    };
    if (!W || (A.walk && A.node < 0) || (B.walk && B.node < 0)) return straight();
    const fp = nodes => W.pts(nodes);
    if (A.walk && B.walk) {
      const c = A.spur / WALK_SPEED + W.cost(A.node, B.node) + B.spur / WALK_SPEED;
      if (!Number.isFinite(c)) return straight();
      const nodes = W.ferry.size || wantPts ? W.path(A.node, B.node) : null;
      return { cost: c, ferry: W.takesFerry(nodes), pts: wantPts ? [...this.spurPts(A.x, A.z, A.node), ...fp(nodes).slice(1), ...this.spurPts(B.x, B.z, B.node, true).slice(1)] : null };
    }
    // one end in the city: through the best link at the city's edge
    const [C, I] = A.walk ? [B, A] : [A, B];
    let best = Infinity, link = null;
    for (const p of W.portals) {
      const c = this.cityToNode(C, p.city).cost + p.cost + W.from(p.node).d[I.node] + I.spur / WALK_SPEED;
      if (c < best) { best = c; link = p; }
    }
    if (!link) return straight();
    const nodes = W.ferry.size || wantPts ? W.path(link.node, I.node) : null, ferry = W.takesFerry(nodes);
    if (!wantPts) return { cost: best, ferry, pts: null };
    const city = this.cityToNode(C, link.city, true).pts;
    if (!A.walk) return { cost: best, ferry, pts: [...city, ...fp(nodes), ...this.spurPts(I.x, I.z, I.node, true).slice(1)] };
    // From the island into the city: the same way backwards (a ferry on it is taken from the other side); a crosswalk
    // flag marks the segment ending at its point.
    const L = city.length, back = city.map((p, m) => ({ x: city[L - 1 - m].x, z: city[L - 1 - m].z }));
    for (let k = 1; k < L; k++) if (city[k].c) Object.assign(back[L - k], { c: 1, ix: city[k].ix, ba: city[k].bb, bb: city[k].ba });
    return { cost: best, ferry, pts: [...this.spurPts(I.x, I.z, I.node), ...fp([...nodes].reverse()).slice(1), ...back] };
  }
  /**
   * A drive between two access records where one or both are beyond the city: from the road nearest each (the
   * footpath beside it beyond the city, the kerb in the city), the length of the walking route at RIDE_SPEED.
   * { cost (s, door to door), time (s at the wheel), from, to: { x, y, z } }, or null.
   */
  rideCost(A, B) {
    const W = this.walk();
    if (!W || (A.walk && A.node < 0) || (B.walk && B.node < 0)) return null;
    const r = this.walkRoute(A, B);
    if (!Number.isFinite(r.cost) || r.ferry) return null;   // across the water by ferry: on foot (cars don't board yet)
    const end = E => (E.walk ? { ...W.point(E.node), d: E.spur } : { x: E.bx, y: GROUND_Y, z: E.bz, d: hyp(E.x, E.z, E.bx, E.bz) });
    const from = end(A), to = end(B), len = Math.max(0, r.cost * WALK_SPEED - from.d - to.d);
    const time = len / RIDE_SPEED + RIDE_EXTRA;
    return { cost: (from.d + to.d) / WALK_SPEED + time, time, from, to };
  }
  /**
   * The lanes a resident's car follows from access A to B (WP4.9): the route's walking points moved from the footpath
   * onto the nearest road (city streets included, shared/city-roads.js), in the right-hand lane for the way it goes,
   * crossings left out and corners softened. A flat [x, z, …] (0.1 m), or null.
   */
  carPath(A, B) {
    const W = this.world, r = this.walkRoute(A, B, true);
    if (!r.pts || r.pts.length < 2) return null;
    if (!this._roads || this._roads.grid !== W.grid || this._roads.roads !== W.roads) this._roads = { grid: W.grid, roads: W.roads, net: worldRoads(W) };
    const net = this._roads.net, out = [];
    let px = r.pts[0].x, pz = r.pts[0].z;
    for (let k = 1; k < r.pts.length; k++) {
      const p = r.pts[k], dx = p.x - px, dz = p.z - pz, L = Math.hypot(dx, dz);
      if (p.c || p.ferry || L < 0.5) { px = p.x; pz = p.z; continue; }
      px = p.x; pz = p.z;
      const n = net.nearest(p.x, p.z, 30); if (!n) continue;
      const G = net.geometry(n.id), t = tangentAt(G, n.s), dot = (t.dx * dx + t.dz * dz) / L;
      if (Math.abs(dot) < 0.5) continue;   // crossing the road, not along it
      const sg = dot > 0 ? 1 : -1, tx = t.dx * sg, tz = t.dz * sg, lanes = net.profiles[net.get(n.id).profile].lanes, off = lanes[0].offset / 1e6;
      const x = n.x - tz * off, z = n.z + tx * off, last = out.length ? out[out.length - 1] : null;
      if (!last || Math.hypot(x - last[0], z - last[1]) > 3) out.push([x, z]);
    }
    if (out.length < 2) return null;
    // Where two points aren't joined by road (the walk behind them cut across a park or took the scramble's diagonal),
    // the car goes round by the streets: the corner between them on the city's grid whose two legs are both on roads.
    // Long straights in short steps.
    const onRoad = (x, z) => { const n = net.nearest(x, z, 20); return !!n && n.dist <= net.profiles[net.get(n.id).profile].carriageHalf / 1e6 + 0.5; };
    const byRoad = (a, b) => { const L = hyp(a[0], a[1], b[0], b[1]); for (let t = 0; t <= L; t += 3) { const f = t / (L || 1); if (!onRoad(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)) return false; } return true; };
    const leg = (a, b, into) => { const L = hyp(a[0], a[1], b[0], b[1]), n = Math.ceil(L / 25); for (let i = 1; i <= n; i++) into.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); };
    const filled = [out[0]];
    for (let k = 1; k < out.length; k++) {
      const a = filled[filled.length - 1], b = out[k];
      if (hyp(a[0], a[1], b[0], b[1]) > 12 && !byRoad(a, b)) {
        const c = [[a[0], b[1]], [b[0], a[1]]].find(q => byRoad(a, q) && byRoad(q, b));
        if (c) { leg(a, c, filled); leg(c, b, filled); continue; }
      }
      leg(a, b, filled);
    }
    out.length = 0; out.push(...filled);
    // one round of corner cutting (Chaikin), the ends kept
    const sm = [out[0]];
    for (let k = 0; k + 1 < out.length; k++) { const a = out[k], b = out[k + 1]; if (k) sm.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]); if (k + 2 < out.length) sm.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
    sm.push(out[out.length - 1]);
    const flat = [];
    for (const [x, z] of sm) flat.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10);
    return flat;
  }
  /** Where (x, z) is, for activity labels: the street corner in the city, the road beyond it. */
  addressAt(x, z) {
    if (!this.beyond(x, z)) return addressOf(this.g, x, z);
    const W = this.walk(), n = W ? W.nearestNode(x, z, 400) : -1;
    return n >= 0 ? W.roadName(n) : 'Out in the country';
  }

  // ---- access points (doors, park gates, subway entrances) ----
  refreshAccess() {
    const g = this.g;
    if (this._walk && (this._walk.terrain !== this.world.terrain || this._walk.roads !== this.world.roads || this._walk.ferries !== this.world.ferries)) this._walk = null;
    this.acc = this.world.buildings.map(b => (b.gone ? [] : this.accessFor(b)));
    this.stAcc = this.world.stations.map(s => {
      if (!Number.isInteger(s.block)) return this.walkAccess(s.entry.x, s.entry.z, { st: s, y: stationY(s) });   // beyond the city
      const { i, j } = blockIJ(g, s.block);
      const bp = bandPoint(g, i, j, 3, s.entry.x, s.entry.z);
      return { x: s.entry.x, z: s.entry.z, i, j, side: 3, bx: bp.x, bz: bp.z, st: s };
    });
  }
  accessFor(b) {
    if (b.base !== undefined) {   // beyond the city: a path from the door to the nearest footpath
      const dp = doorPoints(b), o = toWorld(b, dp.outside.x, dp.outside.z), w = toWorld(b, dp.inside.x, dp.inside.z), s = toWorld(b, dp.sill.x, dp.sill.z);
      return [this.walkAccess(o.x, o.z, { lx: dp.inside.x, lz: dp.inside.z, wx: w.x, wz: w.z, sx: s.x, sz: s.z, b: b.idx })];
    }
    const g = this.g, { i, j } = blockIJ(g, b.block);
    const mk = (out, inn, side) => {
      const o = toWorld(b, out.x, out.z), w = toWorld(b, inn.x, inn.z);
      const bp = bandPoint(g, i, j, side, o.x, o.z);
      return { x: o.x, z: o.z, i, j, side, bx: bp.x, bz: bp.z, lx: inn.x, lz: inn.z, wx: w.x, wz: w.z, b: b.idx };
    };
    if (b.type === 'park') return gatePoints(b).map(gp => {
      const n = [[0, 1], [1, 0], [0, -1], [-1, 0]][gp.k], r = bRot(b), c = Math.cos(r), s = Math.sin(r);
      const nx = n[0] * c + n[1] * s, nz = -n[0] * s + n[1] * c;
      const side = Math.abs(nz) > Math.abs(nx) ? (nz > 0 ? 0 : 2) : (nx > 0 ? 1 : 3);
      return mk(gp.outside, gp.inside, side);
    });
    const dp = doorPoints(b);
    const a = mk(dp.outside, dp.inside, rotToSide(b.rot));
    const s = toWorld(b, dp.sill.x, dp.sill.z); a.sx = s.x; a.sz = s.z;
    return [a];
  }
  pickAccess(bIdx, x, z) {
    const list = this.acc[bIdx];
    let best = list[0], bd = Infinity;
    for (const a of list) { const d = hyp(a.x, a.z, x, z); if (d < bd) { bd = d; best = a; } }
    return best;
  }
  /** Outdoor pseudo-access for an arbitrary street-level point (interrupted agents, players). */
  accessAt(x, z) {
    const g = this.g;
    if (g.empty || (this.beyond(x, z) && this.walk())) return this.walkAccess(x, z);
    const i = clamp(Math.floor((x - g.X[0]) / g.px), 0, g.nx - 1), j = clamp(Math.floor((z - g.Z[0]) / g.pz), 0, g.nz - 1);
    let side = 0, bd = Infinity, bp = null;
    for (let s = 0; s < 4; s++) {
      const p = bandPoint(g, i, j, s, x, z), d = hyp(x, z, p.x, p.z);
      if (d < bd) { bd = d; side = s; bp = p; }
    }
    return { x, z, i, j, side, bx: bp.x, bz: bp.z };
  }
  nearestStation(A) {
    let best = null, bd = Infinity;
    for (const s of this.stAcc) { const d = this.streetCost(A, s); if (d < bd) { bd = d; best = s; } }
    return best ? { s: best, cost: bd } : null;
  }

  // ---- indoor grids + cached A* paths (building-local coordinates) ----
  grid(lv) {
    let g = this.grids.get(lv);
    if (!g) { const L = this.world.levels[lv], b = this.world.buildings[L.b]; g = buildGrid(b, L); this.grids.set(lv, g); }
    return g;
  }
  invalidate(lv) { this.grids.delete(lv); this.cache.delete(lv); this.reachCache.delete(lv); this.approachCache.delete(lv); }
  /** Cells reachable from the level's entrances: { mask, cells }. */
  reach(lv) {
    let r = this.reachCache.get(lv);
    if (!r) {
      const L = this.world.levels[lv], b = this.world.buildings[L.b], g = this.grid(lv);
      const seeds = levelEntries(b, L.ground ? 0 : 1).map(p => nearestFree(g, p.x, p.z, 3)).filter(c => c >= 0);
      const mask = flood(g, seeds), cells = [];
      for (let c = 0; c < mask.length; c++) if (mask[c]) cells.push(c);
      r = { mask, cells };
      this.reachCache.set(lv, r);
    }
    return r;
  }
  path(lv, sx, sz, ex, ez) {
    const key = `${Math.round(sx * 4)},${Math.round(sz * 4)},${Math.round(ex * 4)},${Math.round(ez * 4)}`;
    let m = this.cache.get(lv); if (!m) { m = new Map(); this.cache.set(lv, m); }
    let pts = m.get(key);
    if (!pts) {
      this.stats.searches++;
      pts = findPath(this.grid(lv), sx, sz, ex, ez);
      if (!pts) { this.stats.failed++; pts = this.detour(lv, sx, sz, ex, ez); }
      if (m.size > 4000) m.clear();
      m.set(key, pts);
    }
    return pts;
  }
  /** Path when A* finds none because the start or the end lies in a pocket that the floor's entrances do not reach
   *  (a bed pushed against a wall): the real path between the nearest reachable spots that no wall separates from
   *  them, plus the short straight squeezes into and out of the pocket (pts.detour = their total length in m).
   *  A straight line from start to end (pts.straight) remains the last resort. */
  detour(lv, sx, sz, ex, ez) {
    const a = this.reachablePoint(lv, sx, sz), b = this.reachablePoint(lv, ex, ez);
    const mid = a && b ? findPath(this.grid(lv), a.x, a.z, b.x, b.z) : null;
    if (!mid) {
      this.stats.straight++;
      const line = [[sx, sz], [ex, ez]];
      line.straight = true;
      return line;
    }
    this.stats.detours++;
    const pts = [[sx, sz]];
    const add = (x, z) => { const q = pts[pts.length - 1]; if (Math.hypot(x - q[0], z - q[1]) > 0.01) pts.push([x, z]); };
    for (const p of mid) add(p[0], p[1]);
    add(ex, ez);
    pts.detour = Math.hypot(a.x - sx, a.z - sz) + Math.hypot(ex - b.x, ez - b.z);
    return pts;
  }
  /** Whether an interior wall of level lv crosses the straight line between building-local points a and b
   *  (walls count as slightly longer at their ends, like in the nav grid). */
  crossesWall(lv, ax, az, bx, bz) { return wallBetween(this.grid(lv), ax, az, bx, bz); }
  /** Whether a path from the floor's entrances reaches building-local (x, z): the cell findPath would start from
   *  (its own, or the nearest walkable one on its side of every wall) lies in the reachable area. */
  isReachable(lv, x, z) {
    const c = nearestFree(this.grid(lv), x, z);
    return c >= 0 && !!this.reach(lv).mask[c];
  }
  /** The nearest point to building-local (x, z) that the floor's entrances reach and that no wall separates from it:
   *  the point itself when its own cell qualifies, else the centre of the closest such cell within maxR cells, else
   *  null. */
  reachablePoint(lv, x, z, maxR = 16) {
    const g = this.grid(lv), mask = this.reach(lv).mask;
    const ci = Math.floor((x - g.x0) / g.cell), cj = Math.floor((z - g.z0) / g.cell);
    if (ci >= 0 && cj >= 0 && ci < g.gw && cj < g.gh && mask[cj * g.gw + ci]
      && !wallBetween(g, x, z, g.x0 + (ci + 0.5) * g.cell, g.z0 + (cj + 0.5) * g.cell)) return { x, z };
    let best = null, bd = Infinity;
    for (let r = 0; r <= maxR; r++) {
      if (best && (r - 0.5) * g.cell > Math.sqrt(bd)) break;      // no cell of this ring can be nearer
      for (let dj = -r; dj <= r; dj++) {
        const j = cj + dj;
        if (j < 0 || j >= g.gh) continue;
        const step = Math.abs(dj) === r ? 1 : 2 * r;               // whole top and bottom rows, only the ends between
        for (let di = -r; di <= r; di += step || 1) {
          const i = ci + di;
          if (i < 0 || i >= g.gw || !mask[j * g.gw + i]) continue;
          const px = g.x0 + (i + 0.5) * g.cell, pz = g.z0 + (j + 0.5) * g.cell, d = (px - x) ** 2 + (pz - z) ** 2;
          if (d < bd && !wallBetween(g, x, z, px, pz)) { bd = d; best = { x: px, z: pz }; }
        }
      }
    }
    return best;
  }
  /** Where to walk to use slot s (building-local: lx/lz = the slot point, ax/az = its approach point) on level lv.
   *  Normally the approach point: { x, z, via: null }. When no entrance reaches it (a bed pushed against a wall), the
   *  route ends at the nearest reachable spot and via = the approach point, the short squeeze before the slot. When a
   *  wall separates the approach point from the slot, the route ends at the nearest reachable spot on the slot's side
   *  of every wall (via = null). Cached per level; Nav.invalidate clears it. */
  approach(lv, s) {
    let m = this.approachCache.get(lv);
    if (!m) { m = new Map(); this.approachCache.set(lv, m); }
    const key = `${Math.round(s.ax * 100)},${Math.round(s.az * 100)},${Math.round(s.lx * 100)},${Math.round(s.lz * 100)}`;
    let p = m.get(key);
    if (!p) {
      const sameRoom = !this.crossesWall(lv, s.lx, s.lz, s.ax, s.az);
      if (sameRoom && this.isReachable(lv, s.ax, s.az)) p = { x: s.ax, z: s.az, via: null };
      else {
        const q = sameRoom ? this.reachablePoint(lv, s.ax, s.az) : this.reachablePoint(lv, s.lx, s.lz);
        if (!q) p = { x: s.ax, z: s.az, via: null };             // nothing better: keep the approach point
        else p = { x: q.x, z: q.z, via: sameRoom && (q.x !== s.ax || q.z !== s.az) ? { x: s.ax, z: s.az } : null };
      }
      m.set(key, p);
    }
    return p;
  }
}
