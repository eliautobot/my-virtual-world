// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Walking beyond the city (WP4.5, wp4-world-spec.md §9): a footpath along each side of every road beyond the city (on
// its sidewalk, or along the outer edge of a country road's shoulder), joined across every junction, across the road
// every CROSS_EVERY m and round dead ends, and linked to the city's street network where roads leave the city.
// Buildings beyond the city reach it by a short path from the door (Nav.accessFor). Points carry the ground's height, so
// walkers follow the roads' rises and falls. Routes are searched on demand (Dijkstra, cached per start point); routes
// from the city's edge are kept, since every trip between the city and the island passes one of them.
import { pointAt } from '../../shared/roads.js';
import { WALK_SPEED, CROSS_SPEED } from '../../shared/constants.js';
import { MinHeap } from './minheap.js';
import { timetable } from '../../shared/ferries.js';
import { sectionOf, CROSSWALK_W } from '../../shared/road-kit.js';

const RAISE = 0.225;   // m: a raised sidewalk's top above the graded ground (curb rise + the drawn road's lift)
const ROAD_RAISE = 0.075;   // m: the drawn road's top above the graded ground (FORMATION + DRAW_LIFT): walkers on a
                            // road without sidewalks walk its shoulder, not 7.5 cm under it (2026-10-05)

const UM = 1e-6;
export const STEP = 12;            // m between footpath points
export const CROSS_EVERY = 150;    // m between places to cross the road between junctions
const WAIT = 6;                    // s to look both ways before crossing (no signals beyond the city)
const LINK_R = 45;                 // m: how far a footpath's end at the city's edge may be from a city street corner
const CELL = 64;                   // m: spatial index cells
const KEEP = 48;                   // routes kept from start points other than the city's edge
const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** The footpath's distance (m) from a road's centreline: mid-sidewalk, or just inside a country road's shoulder edge. */
export const footpathOffset = P => (P.sidewalk > 0 ? P.carriageHalf + P.curb + P.sidewalk / 2 : Math.max(P.carriageHalf - 0.5e6, P.carriageHalf * 0.8)) * UM;

export class IslandWalk {
  /**
   * @param roads   shared/island-roads.js IslandRoads (network and road types)
   * @param heightAt (x, z) → the ground's height (m) with the roads graded in
   * @param city    { g (makeGrid), P (Float64Array of the city's street-corner nodes), N, isEdge(x, z) }
   * @param ferries [{ f (shared/ferries.js line), docks: docksOf(f) }]: each joins the footpaths nearest its two piers
   */
  constructor(roads, heightAt, city, ferries = []) {
    const net = this.net = roads.net, profiles = roads.profiles;
    const X = [], Z = [], Y = [], R = [], adj = [];
    this.roadIds = [];
    const roadIx = new Map();
    const node = (x, z, rid, raise = 0) => { X.push(x); Z.push(z); Y.push(heightAt(x, z) + raise); R.push(rid); adj.push([]); return X.length - 1; };
    const link = (a, b, cost) => { if (a === b) return; adj[a].push(b, cost); adj[b].push(a, cost); };
    const walk = (a, b) => link(a, b, hyp(X[a], Z[a], X[b], Z[b]) / WALK_SPEED);
    const cross = (a, b) => link(a, b, hyp(X[a], Z[a], X[b], Z[b]) / CROSS_SPEED + WAIT);
    // crossings on the road surface ("a>b" both ways): where walkers step down off a raised sidewalk, and at a signalled
    // junction (shared/road-kit.js) which junction's walk light they wait for
    this.xing = new Map(); this.plans = roads.plans || new Map();
    const xcross = (a, b, info) => { cross(a, b); this.xing.set(`${a}>${b}`, info); this.xing.set(`${b}>${a}`, info); };
    // Where junctions cut each road, and how far short of them its footpaths stop (the crossing road's back edge).
    const J = net.junctions().filter(j => j.kind !== 'joint' || new Set(j.arms.map(a => a.id)).size > 1);
    const cuts = new Map(), ends = J.map(() => []);
    J.forEach((j, ji) => {
      const half = Math.max(...j.arms.map(a => profiles[net.get(a.id).profile].outerHalf * UM));
      const trim = j.kind === 'end' ? (city.trim && city.isEdge(j.x, j.z) ? city.trim : 0) : j.kind === 'joint' ? 0.5 : half + 0.8, plan = this.plans.get(j.key);
      for (const a of j.arms) {
        const list = cuts.get(a.id) || cuts.set(a.id, []).get(a.id);
        // with a plan the footpath stops at the arm's crosswalk (on a sidewalk), else at its mouth
        const A = plan?.arms.find(x => x.id === a.id && Math.abs(x.s - a.s) < 0.5);
        const t = A ? (A.sec.sidewalk ? A.mouth - 0.6 - CROSSWALK_W / 2 : A.mouth) : trim;
        if (!list.some(c => c.ji === ji && Math.abs(c.s - a.s) < 0.5)) list.push({ s: a.s, trim: t, ji });
      }
    });
    for (const r of net.all()) {
      const G = net.geometry(r.id), P = profiles[r.profile], off = footpathOffset(P), L = G.length, raise = sectionOf(P).sidewalk ? RAISE : ROAD_RAISE;
      if (!roadIx.has(r.id)) { roadIx.set(r.id, this.roadIds.length); this.roadIds.push(r.id); }
      const rid = roadIx.get(r.id), list = (cuts.get(r.id) || []).sort((a, b) => a.s - b.s), iv = [];
      if (G.closed) {
        if (!list.length) iv.push({ s0: 0, s1: L, a: null, b: null, loop: true });
        for (let i = 0; i < list.length; i++) { const a = list[i], b = list[(i + 1) % list.length]; iv.push({ s0: a.s + a.trim, s1: b.s + (i + 1 === list.length ? L : 0) - b.trim, a, b }); }
      } else {
        if (!list.length || list[0].s > 0.5) list.unshift({ s: 0, trim: 0, ji: -1 });
        if (list.at(-1).s < L - 0.5) list.push({ s: L, trim: 0, ji: -1 });
        for (let i = 0; i + 1 < list.length; i++) iv.push({ s0: list[i].s + list[i].trim, s1: list[i + 1].s - list[i + 1].trim, a: list[i], b: list[i + 1] });
      }
      for (const { s0, s1, a, b, loop } of iv) {
        if (s1 - s0 < 1) continue;
        const n = Math.max(1, Math.ceil((s1 - s0) / STEP)), sides = [[], []], q = {};
        for (let k = 0; k <= n; k++) {
          if (loop && k === n) break;
          const s = s0 + (s1 - s0) * k / n; pointAt(G, ((s % L) + L) % L, q);
          sides[0].push(node(q.x - q.dz * off, q.z + q.dx * off, rid, raise));
          sides[1].push(node(q.x + q.dz * off, q.z - q.dx * off, rid, raise));
        }
        for (const S of sides) { for (let k = 1; k < S.length; k++) walk(S[k - 1], S[k]); if (loop) walk(S.at(-1), S[0]); }
        const every = Math.max(1, Math.round(CROSS_EVERY / ((s1 - s0) / n)));
        for (let k = every; k < sides[0].length - 1; k += every) cross(sides[0][k], sides[1][k]);
        // each end knows its road, which way it leaves the junction (along) and its side of that arm (lat, +1 left)
        if (a && a.ji >= 0) ends[a.ji].push({ e: sides[0][0], id: r.id, s: a.s, along: 1, lat: 1, raise }, { e: sides[1][0], id: r.id, s: a.s, along: 1, lat: -1, raise });
        if (b && b.ji >= 0) ends[b.ji].push({ e: sides[0].at(-1), id: r.id, s: b.s, along: -1, lat: -1, raise }, { e: sides[1].at(-1), id: r.id, s: b.s, along: -1, lat: 1, raise });
        // a road's own open end (no junction): round the end of the road
        if (a && a.ji < 0) cross(sides[0][0], sides[1][0]);
        if (b && b.ji < 0) cross(sides[0].at(-1), sides[1].at(-1));
      }
    }
    // Junctions: every footpath end meets the others across or round the corner; dead ends join their two sides; at
    // the city's edge the ends link to the nearest city street corner (a portal).
    this.portals = [];
    J.forEach((j, ji) => {
      const E = ends[ji].map(x => x.e), plan = this.plans.get(j.key);
      if (j.kind === 'end' && city.isEdge(j.x, j.z)) {
        for (const e of E) {
          let best = -1, bd = LINK_R;
          for (let c = 0; c < city.N; c++) { const d = hyp(X[e], Z[e], city.P[c * 2], city.P[c * 2 + 1]); if (d < bd) { bd = d; best = c; } }
          if (best >= 0) this.portals.push({ node: e, city: best, cost: bd / WALK_SPEED });
        }
        return;
      }
      if (plan) { this.joinPlanned(plan, ends[ji], { node, walk, xcross, X, Z, heightAt }); return; }
      for (let i = 0; i < E.length; i++) for (let k = i + 1; k < E.length; k++) {
        const a = E[i], b = E[k], mx = (X[a] + X[b]) / 2, mz = (Z[a] + Z[b]) / 2;
        const on = net.nearest(mx, mz, 30), carriage = on ? profiles[net.get(on.id).profile].carriageHalf * UM : 0;
        if (on && on.dist < carriage) cross(a, b); else walk(a, b);
      }
    });
    this.X = Float64Array.from(X); this.Z = Float64Array.from(Z); this.Y = Float64Array.from(Y); this.R = Int32Array.from(R); this.adj = adj;
    this.N = X.length;
    this.cells = new Map();
    for (let n = 0; n < this.N; n++) { const k = `${Math.floor(X[n] / CELL)},${Math.floor(Z[n] / CELL)}`; (this.cells.get(k) || this.cells.set(k, []).get(k)).push(n); }
    this.fromPortal = new Map(); this.kept = new Map();
    // Ferries: from the footpath nearest one pier to the footpath nearest the other, at the mean wait plus the crossing.
    this.ferry = new Map();   // "a>b" → { id, from ('a' | 'b'), pts: the walk to the dock, the dock across, the walk on }
    for (const { f, docks } of ferries) {
      const [A, B] = docks; if (!A.land || !B.land) continue;
      const na = this.nearestNode(A.land.x, A.land.z, 400), nb = this.nearestNode(B.land.x, B.land.z, 400);
      if (na < 0 || nb < 0 || na === nb) continue;
      const T = timetable(f), w = (n, D) => (hyp(X[n], Z[n], D.land.x, D.land.z) + hyp(D.land.x, D.land.z, D.dock.x, D.dock.z)) / WALK_SPEED;
      link(na, nb, w(na, A) + T.headway / 2 + T.cross + w(nb, B));
      const leg = (D, E, from) => [{ x: D.land.x, z: D.land.z, y: heightAt(D.land.x, D.land.z) }, { x: D.dock.x, z: D.dock.z, y: D.deck },
        { x: E.dock.x, z: E.dock.z, y: E.deck, ferry: f.id, from }, { x: E.land.x, z: E.land.z, y: heightAt(E.land.x, E.land.z) }];
      this.ferry.set(`${na}>${nb}`, leg(A, B, 'a')); this.ferry.set(`${nb}>${na}`, leg(B, A, 'b'));
    }
  }
  /**
   * A planned junction's footpaths (shared/road-kit.js): across each arm at its crosswalk; round each corner along the
   * sidewalk's middle; at a signalled junction also diagonally (the all-way scramble). Crossings wait for the walk light.
   */
  joinPlanned(plan, ends, { node, walk, xcross, X, Z, heightAt }) {
    const N = plan.arms.length, armOf = x => plan.arms.findIndex(A => A.id === x.id && A.along === x.along && Math.abs(A.s - x.s) < 0.5);
    const at = ends.map(x => ({ ...x, arm: armOf(x) })).filter(x => x.arm >= 0), sig = plan.signalized ? plan.key : null;
    const info = (u, v) => ({ key: sig, step: u.raise || v.raise ? Math.max(u.raise, v.raise) : 0 });
    for (let i = 0; i < at.length; i++) for (let k = i + 1; k < at.length; k++) {
      const u = at[i], v = at[k];
      if (u.arm === v.arm && u.lat !== v.lat) { xcross(u.e, v.e, info(u, v)); continue; }   // across the arm
      const ci = plan.corners.findIndex(c => (c.i === u.arm && c.k === v.arm && u.lat > 0 && v.lat < 0) || (c.i === v.arm && c.k === u.arm && v.lat > 0 && u.lat < 0));
      if (ci >= 0) {   // round the corner on the sidewalk (or straight along the shoulders)
        const c = plan.corners[ci], [p, q] = c.i === u.arm ? [u, v] : [v, u], A = plan.arms[c.i], B = plan.arms[c.k];
        let prev = p.e;
        if (c.bands.sidewalk && p.raise) {
          const [inner, outerRaw] = c.bands.sidewalk, outer = resample(outerRaw, inner.length), C = { x: plan.x, z: plan.z };
          const reachA = (X[p.e] - C.x) * A.d.x + (Z[p.e] - C.z) * A.d.z, reachB = (X[q.e] - C.x) * B.d.x + (Z[q.e] - C.z) * B.d.z;
          for (let m = 0; m < inner.length; m++) {
            const mx = (inner[m].x + outer[m].x) / 2, mz = (inner[m].z + outer[m].z) / 2;
            if ((mx - C.x) * A.d.x + (mz - C.z) * A.d.z > reachA - 0.3 || (mx - C.x) * B.d.x + (mz - C.z) * B.d.z > reachB - 0.3) continue;
            const n = node(mx, mz, this.roadIds.indexOf(A.id), p.raise); walk(prev, n); prev = n;
          }
        }
        walk(prev, q.e);
        continue;
      }
      if (sig && u.raise && v.raise) xcross(u.e, v.e, info(u, v));   // diagonally in the scramble
    }
    void heightAt;
  }
  /** Points along a route of footpath points, with each ferry crossing on it (pier, dock, dock across, pier) and each
   *  crossing at a junction stepping down onto the road and back up (`jx`: the signalled junction whose walk light
   *  the walker waits for at the curb). */
  pts(nodes) {
    const out = [];
    for (let k = 0; k < nodes.length; k++) {
      const key = k > 0 ? `${nodes[k - 1]}>${nodes[k]}` : null;
      const fy = key && this.ferry.size ? this.ferry.get(key) : null;
      if (fy) out.push(...fy.map(p => ({ ...p })));
      const xg = key && this.xing.size ? this.xing.get(key) : null;
      if (xg) {
        const a = nodes[k - 1], b = nodes[k], ax = this.X[a], az = this.Z[a], bx = this.X[b], bz = this.Z[b], L = hyp(ax, az, bx, bz) || 1, f = Math.min(0.45, 1.2 / L);
        const ya = this.Y[a] - xg.step, yb = this.Y[b] - xg.step;
        out.push({ x: ax + (bx - ax) * f, y: ya, z: az + (bz - az) * f, ...(xg.key ? { jx: xg.key } : {}) }, { x: bx - (bx - ax) * f, y: yb, z: bz - (bz - az) * f });
      }
      out.push(this.point(nodes[k]));
    }
    return out;
  }
  /** Whether the route of footpath points takes a ferry. */
  takesFerry(nodes) { if (this.ferry.size && nodes) for (let k = 1; k < nodes.length; k++) if (this.ferry.has(`${nodes[k - 1]}>${nodes[k]}`)) return true; return false; }
  /** The footpath point nearest (x, z) within maxD m, or -1. */
  nearestNode(x, z, maxD = 150) {
    let best = -1, bd = maxD;
    const r = Math.ceil(maxD / CELL), ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const L = this.cells.get(`${i},${j}`); if (!L) continue;
      for (const n of L) { const d = hyp(x, z, this.X[n], this.Z[n]); if (d < bd) { bd = d; best = n; } }
    }
    return best;
  }
  /** Shortest walking times (s) from footpath point src to every point: { d: Float64Array, pr: Int32Array }. */
  from(src) {
    const portal = this.portals.some(p => p.node === src), store = portal ? this.fromPortal : this.kept;
    let t = store.get(src);
    if (t) { if (!portal) { store.delete(src); store.set(src, t); } return t; }
    const N = this.N, d = new Float64Array(N).fill(Infinity), pr = new Int32Array(N).fill(-1), done = new Uint8Array(N), h = new MinHeap();
    d[src] = 0; h.push(0, src);
    while (h.size) {
      const du = h.peekKey(), u = h.pop();
      if (done[u]) continue; done[u] = 1;
      const L = this.adj[u];
      for (let k = 0; k < L.length; k += 2) { const v = L[k], nd = du + L[k + 1]; if (nd < d[v]) { d[v] = nd; pr[v] = u; h.push(nd, v); } }
    }
    t = { d, pr };
    store.set(src, t);
    if (!portal && store.size > KEEP) store.delete(store.keys().next().value);
    return t;
  }
  cost(a, b) { return a === b ? 0 : this.from(a).d[b]; }
  /** Footpath points from a to b (inclusive), or null when b can't be reached. */
  path(a, b) {
    if (a === b) return [a];
    const { d, pr } = this.from(a);
    if (!Number.isFinite(d[b])) return null;
    const out = [b];
    for (let v = b, guard = 0; v !== a && guard++ < this.N; ) { v = pr[v]; out.push(v); }
    return out.reverse();
  }
  point(n) { return { x: this.X[n], y: this.Y[n], z: this.Z[n] }; }
  /** The name of the road a footpath point runs along. */
  roadName(n) { const id = this.roadIds[this.R[n]]; return this.net.get(id)?.name || 'the road'; }
  /** A walk of about `metres` along the footpath from point n and back (for joggers): point indices out and back. */
  trail(n, metres, rng) {
    const out = [n], seen = new Set([n]);
    let cur = n, prev = -1, done = 0;
    while (done < metres) {
      const L = this.adj[cur], opts = [];
      for (let k = 0; k < L.length; k += 2) if (!seen.has(L[k]) && L[k + 1] < STEP * 1.6 / WALK_SPEED) opts.push(L[k]);   // footpath steps, not crossings
      if (!opts.length) break;
      let nx = opts[0];
      if (prev >= 0 && opts.length > 1) {   // keep going the same way; at a junction pick a way at random
        const dx = this.X[cur] - this.X[prev], dz = this.Z[cur] - this.Z[prev];
        opts.sort((p, q) => ((this.X[q] - this.X[cur]) * dx + (this.Z[q] - this.Z[cur]) * dz) - ((this.X[p] - this.X[cur]) * dx + (this.Z[p] - this.Z[cur]) * dz));
        nx = rng && rng.chance(0.25) ? opts[opts.length - 1] : opts[0];
      } else if (rng) nx = opts[Math.floor(rng.next() * opts.length)];
      done += hyp(this.X[cur], this.Z[cur], this.X[nx], this.Z[nx]);
      prev = cur; cur = nx; seen.add(cur); out.push(cur);
    }
    return out.concat(out.slice(0, -1).reverse());
  }
}

/** A polyline resampled to n points evenly by length. */
function resample(pts, n) {
  if (pts.length === n) return pts;
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hyp(pts[i].x, pts[i].z, pts[i - 1].x, pts[i - 1].z));
  const L = cum.at(-1) || 1, out = [];
  for (let k = 0; k < n; k++) {
    const s = L * k / (n - 1); let i = 1; while (i < pts.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t });
  }
  return out;
}
