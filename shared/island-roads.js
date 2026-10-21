// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Roads across the island (WP4.3/4.5, wp4-world-spec.md §3–4): the network generated once around the city (stored as
// alignment records in world.roads, like any road an administrator draws later), and each road's vertical profile -
// the terrain along it, smoothed and held within the road type's grade, starting level with the city's streets - that
// the terrain is graded to (cuttings and embankments), so the ground, the road surface, the physics and the
// simulation agree.
import { RoadNetwork, alignmentGeometry, pointAt, project, DEFAULT_ROAD_PROFILES } from './roads.js';
import { mToUm, UM_PER_M } from './units.js';
import { makeGrid, AVENUES, STREETS } from './city.js';
import { junctionPlans, sectionOf, CURB_RISE } from './road-kit.js';
import { cityProfileFor, CITY_RETURN } from './city-roads.js';

const STEP = 2.4384;          // profile sample spacing (m): the 8 ft terrain cell
const SMOOTH = 18;            // moving-average half-window (samples): ±44 m
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Vertical profile of a road (heights every STEP metres along it). `ground(x, z)` is the terrain before grading;
 * `fixed` pins heights at stations: [{ s, y }] (e.g. level with the city at the city edge). Water is crossed on a
 * causeway at least 1.2 m above it.
 */
export function roadProfile(geom, ground, { maxGrade = 0.08, fixed = [], minY = -Infinity } = {}) {
  // A closed road (a ring) is profiled all the way round: smoothing and grade limits wrap across its start, so the
  // height is continuous where the ring joins up. Its last sample repeats the first.
  const ring = !!geom.closed, n = Math.max(2, Math.ceil(geom.length / STEP) + (ring ? 0 : 1)), d = geom.length / (ring ? n : n - 1);
  const raw = new Float64Array(n), p = {}, at = i => (ring ? ((i % n) + n) % n : clamp(i, 0, n - 1));
  for (let i = 0; i < n; i++) { pointAt(geom, i * d, p); raw[i] = Math.max(ground(p.x, p.z), minY); }
  // Smooth (moving average), pin, then limit the grade both ways (the steepest a road type allows).
  const out = new Float64Array(n);
  let acc = 0;
  for (let i = -SMOOTH; i <= SMOOTH; i++) acc += raw[at(i)];
  for (let i = 0; i < n; i++) { out[i] = acc / (2 * SMOOTH + 1); acc += raw[at(i + SMOOTH + 1)] - raw[at(i - SMOOTH)]; }
  // Pinned stations keep their height; everything else is graded toward them (forward and backward passes).
  const pinned = new Uint8Array(n), gk = new Float64Array(n).fill(1);
  // A fixed entry is a station { s, y } or a level stretch { s0, s1, y } (s1 may run past a ring's start); ease: metres
  // past it over which the grade comes on gently (a vertical curve: a module's gate, 2026-10-15 - the road bent sharply
  // from level to its full grade)
  for (const f of fixed) {
    const i0 = Math.round((f.s0 ?? f.s) / d), i1 = Math.round((f.s1 ?? f.s) / d);
    for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) { const k = ring ? at(i) : clamp(i, 0, n - 1); out[k] = f.y; pinned[k] = 1; }
    if (f.ease > 0 && !ring) {
      const a = Math.min(i0, i1), b = Math.max(i0, i1), e = Math.max(1, Math.round(f.ease / d));
      for (let k = 1; k <= e; k++) for (const i of [a - k, b + k]) if (i >= 0 && i < n) gk[i] = Math.min(gk[i], 0.25 + 0.75 * k / e);
    }
  }
  const g = maxGrade * d;
  for (let pass = 0; pass < 3; pass++) {
    if (ring) {
      for (let k = 1; k <= 2 * n; k++) { const i = at(k), j = at(k - 1); if (!pinned[i]) out[i] = clamp(out[i], out[j] - g, out[j] + g); }
      for (let k = 2 * n - 1; k >= 0; k--) { const i = at(k), j = at(k + 1); if (!pinned[i]) out[i] = clamp(out[i], out[j] - g, out[j] + g); }
    } else {
      for (let i = 1; i < n; i++) if (!pinned[i]) out[i] = clamp(out[i], out[i - 1] - g * gk[i], out[i - 1] + g * gk[i]);
      for (let i = n - 2; i >= 0; i--) if (!pinned[i]) out[i] = clamp(out[i], out[i + 1] - g * gk[i], out[i + 1] + g * gk[i]);
    }
  }
  const y = new Float32Array(ring ? n + 1 : n); y.set(out); if (ring) y[n] = out[0];
  return { d, y };
}
/** Road surface height at station s. */
export function profileAt(prof, s) {
  const t = s / prof.d, y = prof.y, n = y.length;
  if (t <= 0) return y[0]; if (t >= n - 1) return y[n - 1];
  const i = Math.floor(t);
  return y[i] + (y[i + 1] - y[i]) * (t - i);
}

/**
 * The island's roads for a city grid and an island (shared/terrain.js Island): city exits (the middle avenue north,
 * the middle street east and west, a beach road south), an island loop inland of the coast, spurs to the lakes.
 * Every exit ends exactly on the loop and meets it square (a T junction); every lake road leaves its road square.
 * Returns alignment records (µm). Deterministic for the same island; generated once and stored (world.roads).
 */
export function generateIslandRoads(island, grid) {
  const g = makeGrid(grid), I = island, out = [], um = v => mToUm(Math.round(v * 100) / 100);
  const P = (x, z, r = 0) => (r ? { x: um(x), z: um(z), r: um(r) } : { x: um(x), z: um(z) });
  const land = (x, z) => I.landness(x, z);
  // The loop: points inland of the coast all around the island centre (where land-ness ≈ 0.16), skipping the city side.
  // Where a straight stretch between two of them would cut across a bay (2026-10-03: the road ran out over the sea
  // at the straight shore's corners), a point on the same line round the bay between them, until none does.
  const c = I.p.center, contour = a => {
    const dx = Math.cos(a), dz = Math.sin(a);
    let lo = 0, hi = I.p.radius * 1.4;
    for (let it = 0; it < 24; it++) { const m = (lo + hi) / 2; if (land(c.x + dx * m, c.z + dz * m) > 0.16) lo = m; else hi = m; }
    return [c.x + dx * lo, c.z + dz * lo, a];
  };
  let loop = [];
  for (let k = 0; k < 28; k++) {
    const p = contour((k / 28) * Math.PI * 2);
    if (I.cityDist(p[0], p[1]) < I.p.plainMargin + 200) continue;   // the city's own streets serve its side
    loop.push(p);
  }
  const acrossBay = (a, b) => { for (let t = 0.05; t < 0.96; t += 0.05) if (land(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) < 0.07) return true; return false; };
  for (let pass = 0; pass < 4; pass++) {
    const next = [];
    loop.forEach((a, i) => {
      next.push(a);
      const b = loop[(i + 1) % loop.length];
      if (!acrossBay(a, b)) return;
      let da = b[2] - a[2]; while (da < 0) da += Math.PI * 2;
      const m = contour(a[2] + da / 2);
      if (I.cityDist(m[0], m[1]) >= I.p.plainMargin + 200 && Math.hypot(m[0] - a[0], m[1] - a[1]) > 120 && Math.hypot(m[0] - b[0], m[1] - b[1]) > 120) next.push(m);
    });
    if (next.length === loop.length) break;
    loop = next;
  }
  const loopRec = { id: 'isl-loop', profile: 'country', name: 'Island Loop', closed: true, pts: filleted(loop.map(([x, z]) => ({ x, z })), 260) };
  out.push(loopRec);
  const net = new RoadNetwork();
  net.set(loopRec);
  // Roads are added one at a time; each candidate layout is kept only when it is a valid alignment and meets the roads
  // already there exactly as intended (no extra crossings, no overlaps, junctions far enough apart).
  const tryAdd = (variants, meets) => {
    for (const rec of variants) {
      try { net.set(rec); } catch { continue; }
      const J = net.junctions().filter(j => j.kind !== 'end' && j.arms.some(a => a.id === rec.id));
      if (!net.validate().length && meets(J)) { out.push(rec); return rec; }
      net.delete(rec.id);
    }
    return null;
  };
  const LG = net.geometry('isl-loop');
  // A point on the loop near (x, z), and the point APPROACH m from it on the city's side, square to the loop.
  const onLoop = (x, z, approach) => {
    const pr = project(LG, x, z), q = pointAt(LG, pr.s, {}), cx = (g.minX + g.maxX) / 2, cz = (g.minZ + g.maxZ) / 2;
    let nx = -q.dz, nz = q.dx; if (nx * (cx - q.x) + nz * (cz - q.z) < 0) { nx = -nx; nz = -nz; }
    return { x: q.x, z: q.z, qx: q.x + nx * approach, qz: q.z + nz * approach };
  };
  const tLoop = J => J.length === 1 && J[0].kind === 'T' && J[0].arms.some(a => a.id === 'isl-loop');
  // City exits: from the city's road edge to the loop. The loop point nearest a target among those on the right side
  // of the city (north / east / west of it).
  const mid = Math.floor(g.nx / 2), midZ = Math.floor(g.nz / 2);
  const nearestLoop = (x, z, side) => {
    const ok = loop.filter(([px, pz]) => (side === 'n' ? pz < g.minZ - 600 : side === 'e' ? px > g.maxX + 400 : px < g.minX - 400));
    const list = ok.length ? ok : loop;
    return list.reduce((b, p) => (Math.hypot(p[0] - x, p[1] - z) < Math.hypot(b[0] - x, b[1] - z) ? p : b), list[0]);
  };
  const exit = (id, name, start, lead, aim) => {
    const variants = [];
    for (const approach of [160, 110, 70]) {
      const T = onLoop(aim[0], aim[1], approach);
      for (const r of [260, 180, 120]) {
        variants.push({ id, profile: 'country', name, pts: [P(...start), P(...lead, r), P(T.qx, T.qz, r * 0.8), P(T.x, T.z)] });
        variants.push({ id, profile: 'country', name, pts: [P(...start), P(T.qx, T.qz, r), P(T.x, T.z)] });
      }
    }
    return tryAdd(variants, tLoop);
  };
  // A widened city (shared/city-roads.js): exits start at the centre of the edge street's junction, its fourth arm.
  const wide = cityProfileFor(grid) === 'avenue-4', eN = wide ? g.Z[0] : g.minZ, eS = wide ? g.Z.at(-1) : g.maxZ, eW = wide ? g.X[0] : g.minX, eE = wide ? g.X.at(-1) : g.maxX;
  exit('isl-north', `North ${AVENUES[mid] || 'Road'}`, [g.X[mid], eN], [g.X[mid], g.minZ - 700], nearestLoop(g.X[mid], g.minZ - 2000, 'n'));
  exit('isl-east', `East ${STREETS[midZ] || 'Road'}`, [eE, g.Z[midZ]], [g.maxX + 500, g.Z[midZ]], nearestLoop(g.maxX + 2000, g.Z[midZ], 'e'));
  exit('isl-west', `West ${STREETS[midZ] || 'Road'}`, [eW, g.Z[midZ]], [g.minX - 500, g.Z[midZ]], nearestLoop(g.minX - 2000, g.Z[midZ], 'w'));
  // The beach: south from the middle avenue to just above the shore (it may cross the loop square on the way).
  let sz = g.maxZ; while (I.height(g.X[mid], sz + 10) > I.p.seaLevel + 2 && sz < g.maxZ + 3000) sz += 10;
  if (sz - g.maxZ > 60) {
    const beach = tryAdd([{ id: 'isl-beach', profile: 'country', name: 'Beach Road', pts: [P(g.X[mid], eS), P(g.X[mid], sz)] }], J => J.every(j => j.kind === 'X' || j.kind === 'T'));
    // Crossing the loop with only a short stub left to the shore: end at the loop instead (a T junction).
    const X = beach && net.junctions().find(j => j.kind === 'X' && j.arms.some(a => a.id === 'isl-beach') && j.arms.some(a => a.id === 'isl-loop'));
    if (X) {
      const B = net.geometry('isl-beach'), at = X.arms.find(a => a.id === 'isl-beach').s;
      if (B.length - at < 80) {
        const q = pointAt(LG, X.arms.find(a => a.id === 'isl-loop').s, {});
        out.splice(out.indexOf(beach), 1); net.delete('isl-beach');
        tryAdd([{ id: 'isl-beach', profile: 'country', name: 'Beach Road', pts: [P(g.X[mid], eS), P(q.x, q.z)] }], tLoop);   // (from the edge street's centre, like the first try: g.maxZ, its curb, never joined the city - 2026-10-06)
      }
    }
  }
  // Spurs to each lake: leave the nearest road square, then head for the lake's shore.
  for (const k of I.lakes) {
    if (k.tarn || k.pool) continue;   // the mountain tarns and the waterfalls' plunge pools are reached on foot
    const near = net.nearest(k.x, k.z, 6000); if (!near) continue;
    const G = net.geometry(near.id), q = pointAt(G, near.s, {});
    let nx = -q.dz, nz = q.dx; if (nx * (k.x - q.x) + nz * (k.z - q.z) < 0) { nx = -nx; nz = -nz; }
    const dx = k.x - q.x, dz = k.z - q.z, L = Math.hypot(dx, dz), stop = k.r * 1.45;
    if (L < stop + 120) continue;
    const ex = k.x - dx / L * stop, ez = k.z - dz / L * stop, id = `isl-${k.id}`, name = `${k.id.replace('lake', 'Lake ')} Road`;
    const variants = [];
    for (const lead of [90, 60]) for (const r of [120, 80, 50]) variants.push({ id, profile: 'country', name, pts: [P(q.x, q.z), P(q.x + nx * lead, q.z + nz * lead, r), P(ex, ez)] });
    variants.push({ id, profile: 'country', name, pts: [P(q.x, q.z), P(ex, ez)] });
    tryAdd(variants, J => J.length === 1 && J[0].kind === 'T' && J[0].arms.some(a => a.id === near.id));
  }
  return out;
}
/**
 * A closed chain of points (m) as alignment points (µm) with a fillet at each: up to rMax, smaller where the straights
 * either side are short (a fillet uses at most half of each), so every corner is a smooth curve that fits; points too
 * close to their neighbour are dropped first.
 */
function filleted(pts, rMax) {
  let P = [];
  for (const p of pts) { const q = P.at(-1); if (!q || Math.hypot(p.x - q.x, p.z - q.z) > 140) P.push(p); }
  if (P.length > 3 && Math.hypot(P[0].x - P.at(-1).x, P[0].z - P.at(-1).z) <= 140) P.pop();
  const n = P.length, um = v => mToUm(Math.round(v * 100) / 100), MINR = 30;
  return P.map((p, i) => {
    const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], l1 = Math.hypot(p.x - a.x, p.z - a.z), l2 = Math.hypot(b.x - p.x, b.z - p.z);
    const d = Math.abs(Math.atan2((p.x - a.x) * (b.z - p.z) - (p.z - a.z) * (b.x - p.x), (p.x - a.x) * (b.x - p.x) + (p.z - a.z) * (b.z - p.z)));
    const fit = d > 1e-6 ? (Math.min(l1, l2) / 2 - 0.5) / Math.tan(d / 2) : rMax;
    return { x: um(p.x), z: um(p.z), r: um(Math.max(MINR, Math.min(rMax, fit))) };
  });
}

/**
 * Roads on the island: the network, each road's profile, and the grading query the terrain uses. `natural(x, z)` is the
 * terrain before grading; `cityRect` and `cityY` pin roads level with the city's streets where they leave it.
 */
export class IslandRoads {
  /** depthAt(x, z): water depth (m) under a point (for bridges, WP4.15); skipBridges: leave the ground under bridge spans
   *  as it is (the browser's terrain: water shows under a bridge), else the deck is the ground (walking, driving). */
  constructor(records, natural, { cityRect = null, cityY = 0, seaLevel = -2.4, profiles = DEFAULT_ROAD_PROFILES, depthAt = null, skipBridges = false, gates = [], drawn = false } = {}) {
    // drawn: the drawn terrain's ground (render/terrain.worker.js) - held lower under a road's corridor (DRAWN_FORMATION:
    // within the road's sides, which reach DROP down) so its 2.4 m cells never poke up through the asphalt in a cutting
    // (2026-10-15, the product owner: grass through a marina's access road); walking and driving keep FORMATION
    this.formation = drawn ? DRAWN_FORMATION : FORMATION;
    this.net = RoadNetwork.fromJSON(records || [], { profiles });
    this.skipBridges = skipBridges;
    this.profiles = profiles; this.prof = new Map(); this.half = new Map();
    const inCity = (x, z) => cityRect && x >= cityRect.x0 - 0.01 && x <= cityRect.x1 + 0.01 && z >= cityRect.z0 - 0.01 && z <= cityRect.z1 + 0.01;
    // Two passes. First every road on its own, level with the city's streets where it leaves the city. Then every
    // junction takes one shared height - the mean of its roads' first-pass heights there - and the roads are profiled
    // again through those heights, level across the junction's pad (so the pad is flat and meets every road).
    // Where a road leaves the city (2026-10-03: "the junction between the 4lane and the 2lane needs work"): it
    // starts in the city's edge junction, which the city draws at street level out to its mouth past the edge. The road
    // runs level with that paving (its drawn surface, DRAW_LIFT above its profile, exactly at street level) from the
    // junction's middle to a little past the junction's reach, and the ground under the whole junction is held just
    // below the paving (a pad), so no grass shows through the corners and the road meets the junction without a step.
    const cityEnds = id => {
      const G = this.net.geometry(id), out = [];
      for (const [s, dir] of [[0, 1], [G.length, -1]]) {
        const q = pointAt(G, s, {}); if (!inCity(q.x, q.z)) continue;
        let t = 0; for (; t < 400 && t < G.length; t += 1) { const p = pointAt(G, s + dir * t, {}); if (!inCity(p.x, p.z)) break; }
        out.push({ s, dir, x: q.x, z: q.z, exit: t });
      }
      return out;
    };
    const cityPins = id => cityEnds(id).map(E => ({ s0: E.s, s1: E.s + E.dir * (E.exit + EDGE_REACH), y: cityY - DRAW_LIFT }));
    // A flat road (a grid's, the grid layout tool: the product owner 2026-10-14 "the roadways are supposed to be as flat
    // as possible, so that the lots are also placed on even level") is held at its level all along; its junctions take
    // that level, and roads meeting it climb to it.
    const flatPins = id => { const r = this.net.get(id); return Number.isFinite(r.level) ? [{ s0: 0, s1: this.net.geometry(id).length, y: r.level }] : []; };
    // A world module's gate (2026-10-14, the product owner: the docks' roads "don't connect well"): an access road's end
    // at a module (an airport, a dock: shared/world-modules.js worldModulePads) is held level with the module's land for
    // GATE_REACH, its surface flush with the paving it runs on to, then climbs to the land as its grade allows; the end
    // is open there (no curb across it: render/island-roads.js).
    this.gateEnds = new Set();
    const gatePins = id => {
      const G = this.net.geometry(id), out = [];
      if (G.closed || !gates.length) return out;
      for (const [s, dir] of [[0, 1], [G.length, -1]]) {
        const q = pointAt(G, s, {}), g = gates.find(t => Math.hypot(t.x - q.x, t.z - q.z) < 3);
        if (g) { out.push({ s0: s, s1: s + dir * Math.min(GATE_REACH, G.length / 3), y: g.y - DRAW_LIFT, ease: GATE_EASE }); this.gateEnds.add(`${id}@${Math.round(s)}`); }
      }
      return out;
    };
    const first = new Map();
    for (const r of this.net.all()) first.set(r.id, roadProfile(this.net.geometry(r.id), natural, { maxGrade: profiles[r.profile].maxGrade, fixed: [...cityPins(r.id), ...flatPins(r.id), ...gatePins(r.id)], minY: seaLevel + 1.2 }));
    // Level stretches { s0, s1, y } per road (on a ring they may run past its start; open roads are clipped to the road).
    const pins = new Map(), level = (id, s0, s1, y) => {
      const G = this.net.geometry(id); if (!G.closed) { s0 = clamp(s0, 0, G.length); s1 = clamp(s1, 0, G.length); }
      (pins.get(id) || pins.set(id, []).get(id)).push({ s0: Math.min(s0, s1), s1: Math.max(s0, s1), y });
    };
    const along = (a, G) => { const t = pointAt(G, a.s, {}); return a.dirX * t.dx + a.dirZ * t.dz >= 0 ? 1 : -1; };
    /** Junction pads (m): what the renderer paves, the terrain levels and traffic turns on.
     *  Each junction's plan (shared/road-kit.js: curb returns, bands, crosswalks, signals) sets how far it reaches. */
    this.pads = [];
    for (const r of this.net.all()) for (const E of cityEnds(r.id)) this.pads.push({ key: `city:${r.id}:${E.s ? 'b' : 'a'}`, kind: 'city', x: E.x, z: E.z, y: cityY - DRAW_LIFT, r: E.exit + CITY_RETURN + 9, road: r.id });
    this.plans = new Map();
    for (const P of junctionPlans(this.net, profiles, { skip: j => inCity(j.x, j.z) })) this.plans.set(P.key, P);
    const JS = [];
    for (const j of this.net.junctions()) {
      // A dead end simply stops (2026-10-13, the product owner: "lets remove that round end, vehicles can still turn
      // around"): no turning circle is paved or graded; traffic turns round within the roadway (shared/lane-graph.js).
      if (j.kind === 'end') continue;
      const flat = j.arms.map(a => this.net.get(a.id).level).filter(Number.isFinite);
      const ys = j.arms.map(a => profileAt(first.get(a.id), a.s)), city = inCity(j.x, j.z), y = city ? cityY : flat.length ? flat.reduce((a, b) => a + b, 0) / flat.length : ys.reduce((a, b) => a + b, 0) / ys.length;
      const plan = this.plans.get(j.key), half = j.carriageHalf / UM_PER_M;
      const r = plan ? Math.max(...plan.arms.map(A => A.mouth + A.sec.outer)) + 2 : half + CURB_RETURN + 3;
      // (a road through the junction is two arms with the same station: each side by its direction - 2026-10-13: both took
      // the first side's mouth, so where the paving reached further on the other side the road dipped under it)
      const lv = a => { const dir = along(a, this.net.geometry(a.id)), A = plan?.arms.find(x => x.id === a.id && Math.abs(x.s - a.s) < 0.5 && x.along === dir); return A ? A.mouth + 3 : r; };
      const runs = j.arms.map(a => { const e = a.s + along(a, this.net.geometry(a.id)) * lv(a); return { id: a.id, s0: Math.min(a.s, e), s1: Math.max(a.s, e) }; });
      JS.push({ j, y, city, plan, r, lv, runs, g: JS.length, flat: flat.length > 0 });
    }
    // Junctions close together on one road share one height (2026-10-13): each holds its roads level out past its
    // mouths, and where two such stretches overlap - or lie closer than the road's grade can climb between their
    // heights - the later one used to win, so the road beside a junction stood off its paving (and ground over it).
    const grp = i => (JS[i].g === i ? i : (JS[i].g = grp(JS[i].g)));
    for (let pass = 0; pass < 4; pass++) {
      let merged = false;
      const yOf = new Map();
      for (let i = 0; i < JS.length; i++) { const k = grp(i), m = yOf.get(k) || yOf.set(k, { s: 0, n: 0, fs: 0, fn: 0, city: false }).get(k); m.s += JS[i].y; m.n++; if (JS[i].flat) { m.fs += JS[i].y; m.fn++; } m.city ||= JS[i].city; }
      const Y = i => { const m = yOf.get(grp(i)); return m.city ? cityY : m.fn ? m.fs / m.fn : m.s / m.n; };
      for (let i = 0; i < JS.length; i++) for (let k = i + 1; k < JS.length; k++) {
        if (grp(i) === grp(k)) continue;
        const dy = Math.abs(Y(i) - Y(k));
        for (const A of JS[i].runs) for (const B of JS[k].runs) {
          if (A.id !== B.id) continue;
          const G = this.net.geometry(A.id), gap = Math.max(A.s0, B.s0) - Math.min(A.s1, B.s1);
          if (G.closed && gap > G.length / 2) continue;
          if (gap < dy / profiles[this.net.get(A.id).profile].maxGrade + 2) { JS[grp(k)].g = grp(i); merged = true; }
        }
      }
      if (!merged) break;
    }
    {
      const sum = new Map();
      for (let i = 0; i < JS.length; i++) { const k = grp(i), m = sum.get(k) || sum.set(k, { s: 0, n: 0, fs: 0, fn: 0, city: false }).get(k); m.s += JS[i].y; m.n++; if (JS[i].flat) { m.fs += JS[i].y; m.fn++; } m.city ||= JS[i].city; }
      for (let i = 0; i < JS.length; i++) { const m = sum.get(grp(i)); if (m.n > 1) JS[i].y = m.city ? cityY : m.fn ? m.fs / m.fn : m.s / m.n; }
    }
    for (const { j, y, plan, r, lv, runs } of JS) {
      for (const R of runs) level(R.id, R.s0, R.s1, y);
      if (!inCity(j.x, j.z)) this.pads.push({ key: j.key, kind: j.kind, x: j.x, z: j.z, y, r, foot: footOf(plan), arms: j.arms.map(a => ({ id: a.id, s: a.s, lv: lv(a), dirX: a.dirX, dirZ: a.dirZ, angle: a.angle, along: along(a, this.net.geometry(a.id)), half: profiles[a.profile].carriageHalf / UM_PER_M, laneEdge: Math.max(...profiles[a.profile].lanes.map(l => l.offset + l.width / 2)) / UM_PER_M })) });
    }
    for (const r of this.net.all()) {
      const G = this.net.geometry(r.id), prof = profiles[r.profile];
      this.prof.set(r.id, roadProfile(G, natural, { maxGrade: prof.maxGrade, fixed: [...cityPins(r.id), ...flatPins(r.id), ...gatePins(r.id), ...(pins.get(r.id) || [])], minY: seaLevel + 1.2 }));
      this.half.set(r.id, prof.outerHalf / UM_PER_M);
    }
    let maxHalf = 0; for (const h of this.half.values()) maxHalf = Math.max(maxHalf, h);
    this.reach = maxHalf + BLEND;
    // Bridge spans: every stretch over water (sea, lake or river), [[s0, s1], …] per road, reaching onto both banks for
    // the abutments; spans a few metres apart are one bridge.
    this.spans = new Map();
    if (depthAt) for (const r of this.net.all()) {
      const G = this.net.geometry(r.id), out = [];
      let open = null;
      for (let s = 0; s <= G.length + 2; s += 2) {
        const q = pointAt(G, Math.min(s, G.length), {}), wet = s <= G.length && depthAt(q.x, q.z) > WET;
        if (wet && open === null) open = s;
        if (!wet && open !== null) {
          const a = Math.max(0, open - ABUT), b = Math.min(G.length, s + ABUT), last = out.at(-1);
          if (last && a - last[1] < 12) last[1] = b; else out.push([a, b]);
          open = null;
        }
      }
      if (out.length) this.spans.set(r.id, out);
    }
    // Pads by cell, for grading the ground under them.
    this.padCells = new Map();
    for (const P of this.pads) {
      const R = P.r + BLEND;
      for (let i = Math.floor((P.x - R) / PAD_CELL); i <= Math.floor((P.x + R) / PAD_CELL); i++) for (let k = Math.floor((P.z - R) / PAD_CELL); k <= Math.floor((P.z + R) / PAD_CELL); k++) { const key = `${i},${k}`; (this.padCells.get(key) || this.padCells.set(key, []).get(key)).push(P); }
    }
  }
  get size() { return this.net.size; }
  /** Whether a road's end (station s) is a world module's gate: open, at the module's level. */
  isGate(id, s) { return this.gateEnds.has(`${id}@${Math.round(s)}`); }
  /** Whether station s of a pad's arm road lies on the stretch held level at its junction (on a ring, either way round). */
  alongLevel(a, s) {
    const G = this.net.geometry(a.id);
    let t = (s - a.s) * a.along;
    if (G.closed && t < -G.length / 2) t += G.length; else if (G.closed && t > G.length / 2) t -= G.length;
    return t >= -0.5 && t <= a.lv;
  }
  /** Graded ground at (x, z) given the natural height h: the road's formation within its corridor (and level under
   *  junction pads and turning circles), blending out. */
  grade(x, z, h, skipDecks = this.skipBridges) {
    if (!this.net.size) return h;
    let best = null;
    const cand = this.net.candidates({ x0: x, z0: z, x1: x, z1: z }, this.reach);
    for (const id of cand) {
      const pr = project(this.net.geometry(id), x, z), half = this.half.get(id);
      if (!pr || pr.dist > half + BLEND) continue;
      // over a bridge: the deck only (open water beside it - never a ramp out over the water, 2026-10-03); for
      // drawing and vehicle physics not even that (render/terrain.worker.js, shared/terrain-physics.js)
      if (this.onBridge(id, pr.s) && (skipDecks || pr.dist > half)) continue;
      const ry = profileAt(this.prof.get(id), pr.s), t = pr.dist <= half ? 0 : (pr.dist - half) / BLEND, w = t * t * (3 - 2 * t);
      const y = ry - this.formation + (h - ry + this.formation) * w;
      if (!best || pr.dist - half < best.d) best = { d: pr.dist - half, y, id, s: pr.s };
    }
    // Within a road's own width its profile rules. A junction levels what it paves - its footprint: the paved area and
    // the corners' gutters, curbs and sidewalks (shared/road-kit.js plan) - and the ground blends away from that edge.
    // (2026-10-13, the product owner: "the terrain doesn't clear … seems to happen a lot at intersections". A circle
    // round the junction was levelled instead: past the stretch its roads are held level it stood as a bank over a
    // sloped road; and where a wide road meets a narrow one, the paved corners lie outside the narrow road, so letting
    // the narrow road's slope win there buried the paving under the hillside.)
    const pads = best && best.d <= 0 ? null : this.padCells.get(`${Math.floor(x / PAD_CELL)},${Math.floor(z / PAD_CELL)}`);
    if (pads) for (const P of pads) {
      const c = Math.hypot(x - P.x, z - P.z) - P.r;
      if (c > BLEND) continue;
      const d = P.foot ? footDist(P.foot, x, z) : c;
      if (d > BLEND || (best && d >= best.d)) continue;
      // (a pad without a plan - where a road leaves the city - keeps to the stretch its road is held level on)
      if (!P.foot && best && P.arms?.some(a => a.id === best.id) && !P.arms.some(a => a.id === best.id && this.alongLevel(a, best.s))) continue;
      const t = d <= 0 ? 0 : d / BLEND, w = t * t * (3 - 2 * t);
      best = { d, y: P.y - FORMATION + (h - P.y + FORMATION) * w };
    }
    return best ? best.y : h;
  }
  /** The drawn surface at (x, z) where something stands on a road - lanes and shoulders at the road's drawn top
   *  (DRAW_LIFT over its profile), curbs and sidewalks CURB_RISE above that, junction pads and turning circles, bridge
   *  decks - or null off the roads. Exact (no height grid): feet, wheels' tilt and tyre marks meet what is drawn (the product owner
   *  2026-10-05: feet sank into the 2-lane roads; people and traffic sank into bridge decks near their edges). */
  top(x, z) {
    if (!this.net.size) return null;
    // inside a junction what it draws decides: its paving at the road's level, its corners' curbs and sidewalks
    // CURB_RISE over that (2026-10-14: the roads' own sections, running on undrawn through a junction, put a mouth's
    // paving at sidewalk height, and an outer corner's sidewalk at the road's)
    const J = this.junctionTop(x, z); if (J !== null) return J;
    this.sections ??= new Map();
    let best = null;
    for (const id of this.net.candidates({ x0: x, z0: z, x1: x, z1: z }, this.reach - BLEND)) {
      const half = this.half.get(id), pr = project(this.net.geometry(id), x, z);
      if (!pr || pr.dist > half || (this.skipBridges && this.onBridge(id, pr.s))) continue;
      let sec = this.sections.get(id);
      if (!sec) this.sections.set(id, sec = sectionOf(this.profiles[this.net.get(id).profile]));
      const y = profileAt(this.prof.get(id), pr.s) + DRAW_LIFT + (sec.raised && pr.dist >= sec.carriage ? CURB_RISE : 0);
      if (!best || pr.dist / half < best.k) best = { k: pr.dist / half, y };
    }
    if (best) return best.y;
    const pads = this.padCells.get(`${Math.floor(x / PAD_CELL)},${Math.floor(z / PAD_CELL)}`);
    if (pads) for (const P of pads) if (Math.hypot(x - P.x, z - P.z) <= P.r && (!P.foot || footDist(P.foot, x, z) <= 0)) return P.y + DRAW_LIFT;
    return null;
  }
  /** What a junction draws at (x, z): 'raised' (a corner's curb or sidewalk), 'paved' (its paving, gutters: at the
   *  road's level), or null outside every junction's footprint. Inside a junction the roads' own corridors run on
   *  undrawn, so their sections don't say what is there (2026-10-14: a grid's land rose through a junction's paving). */
  junctionAt(x, z) { const J = this.junctionHit(x, z); return J ? J.kind : null; }
  /** The drawn top of a junction at (x, z) (junctionAt), or null outside every junction's footprint. */
  junctionTop(x, z) { const J = this.junctionHit(x, z); return J ? J.P.y + DRAW_LIFT + (J.kind === 'raised' ? CURB_RISE : 0) : null; }
  junctionHit(x, z) {
    const pads = this.padCells?.get(`${Math.floor(x / PAD_CELL)},${Math.floor(z / PAD_CELL)}`);
    if (!pads) return null;
    let paved = null;
    for (const P of pads) {
      if (!P.foot || Math.hypot(x - P.x, z - P.z) > P.r + 1) continue;
      for (const F of P.foot) {
        if (x < F.x0 || x > F.x1 || z < F.z0 || z > F.z1 || !inRing(F.p, x, z)) continue;
        if (F.k === 'curb' || F.k === 'sidewalk') return { kind: 'raised', P };
        paved ??= { kind: 'paved', P };
      }
    }
    return paved;
  }
  /** A bridge deck's drawn top over (x, z) (or within margin m of its edges), or null where no deck stands. */
  deckAt(x, z, margin = 0) {
    if (!this.spans.size) return null;
    for (const id of this.net.candidates({ x0: x, z0: z, x1: x, z1: z }, this.reach - BLEND + margin)) {
      if (!this.spans.has(id)) continue;
      const pr = project(this.net.geometry(id), x, z);
      if (pr && pr.dist <= this.half.get(id) + margin && this.onBridge(id, pr.s)) return profileAt(this.prof.get(id), pr.s) + DRAW_LIFT;
    }
    return null;
  }
  /** Whether station s of road id is on a bridge span. */
  onBridge(id, s) { const L = this.spans.get(id); if (L) for (const [a, b] of L) if (s >= a && s <= b) return true; return false; }
  /** Road surface height at (x, z) on road `id`. */
  surface(id, x, z) { const pr = project(this.net.geometry(id), x, z); return profileAt(this.prof.get(id), pr.s); }
}
/**
 * Where the graded ground moved between two sets of island roads (shared/island-roads.js IslandRoads, either may be
 * null): boxes (m) round each stretch of a road whose profile changed by more than a centimetre, round every junction
 * pad that came, went or changed, and round every bridge span that changed. 
 */
export function roadShifts(before, after) {
  const out = [], box = (x0, z0, x1, z1) => out.push({ x0, z0, x1, z1 });
  const ids = new Set([...(before?.net.all() || []), ...(after?.net.all() || [])].map(r => r.id));
  for (const id of ids) {
    const A = before?.prof.get(id), B = after?.prof.get(id), G = (after?.net.get(id) ? after : before)?.net.geometry(id);
    if (!G || !B || !A) continue;   // a road added or removed: its own record changed, its box is there already
    const n = Math.max(A.y.length, B.y.length), d = G.length / Math.max(1, B.y.length - 1);
    let i0 = -1, i1 = -1;
    for (let i = 0; i < n; i++) {
      const s = i * d, ya = profileAt(A, s), yb = profileAt(B, s);
      if (Math.abs(ya - yb) > 0.01) { if (i0 < 0) i0 = i; i1 = i; }
    }
    if (i0 < 0 && JSON.stringify(before.spans.get(id) || null) === JSON.stringify(after.spans.get(id) || null)) continue;
    if (i0 < 0) { i0 = 0; i1 = n - 1; }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = Math.max(0, i0 - 1); i <= Math.min(n - 1, i1 + 1); i++) { const p = pointAt(G, Math.min(G.length, i * d), {}); x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
    box(x0, z0, x1, z1);
  }
  const key = P => `${P.key}|${P.x.toFixed(2)}|${P.z.toFixed(2)}|${P.y.toFixed(2)}|${P.r.toFixed(2)}`;
  const was = new Set((before?.pads || []).map(key)), now = new Set((after?.pads || []).map(key));
  for (const [list, other] of [[before?.pads || [], now], [after?.pads || [], was]]) for (const P of list) if (!other.has(key(P))) box(P.x - P.r, P.z - P.r, P.x + P.r, P.z + P.r);
  return out;
}
/** A junction's footprint from its plan (shared/road-kit.js): the paved area and every corner band, as polygons
 *  ({ x, z } lists, m) with their bounds; null without a plan. */
function footOf(plan) {
  if (!plan?.surface?.length) return null;
  const polys = [[plan.surface, 'surface']];
  for (const c of plan.corners || []) for (const [k, b] of Object.entries(c.bands || {})) if (b?.[0]?.length && b[1]?.length) polys.push([[...b[0], ...[...b[1]].reverse()], k]);
  return polys.map(([p, k]) => ({ p, k, x0: Math.min(...p.map(q => q.x)), x1: Math.max(...p.map(q => q.x)), z0: Math.min(...p.map(q => q.z)), z1: Math.max(...p.map(q => q.z)) }));
}
const inRing = (p, x, z) => { let k = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) k = !k; } return k; };
/** How far (m) (x, z) lies outside a footprint, or −1 inside it. */
function footDist(foot, x, z) {
  let best = Infinity;
  for (const F of foot) {
    if (x < F.x0 - BLEND || x > F.x1 + BLEND || z < F.z0 - BLEND || z > F.z1 + BLEND) continue;
    const p = F.p; let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[i], b = p[j];
      if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
      const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L)) : 0;
      best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
    }
    if (inside) return -1;
  }
  return best;
}
/** The piers under the bridges, where render/island-roads.js draws them - at the road's 2.44 m stations, one each 30 m
 *  of a span over water deeper than 2 m (hw across the road, hd along it), and an abutment where a span meets a bank -
 *  so swimmers meet them as walls (2026-10-05: swimming under a bridge). [{ x, z, nx, nz, hw, hd, top, bottom }];
 *  seabed(x, z): the ground under the water (Island.baseHeight); inCity(x, z): stations the city draws instead. */
export function bridgePiers(roads, seabed, inCity = () => false) {
  const out = [], STEP = 2.4384;
  for (const [id, spans] of roads.spans) {
    const G = roads.net.geometry(id), prof = roads.prof.get(id), sec = sectionOf(roads.profiles[roads.net.get(id).profile]);
    const n = Math.max(2, Math.ceil(G.length / STEP) + 1), d = G.length / (n - 1), st = [];
    for (let i = 0; i < n; i++) st.push(i * d);
    for (const [a, b] of spans) st.push(a, b);
    st.sort((a, b) => a - b);
    let prev = null, was = false;
    const at = s => { const p = pointAt(G, s, {}); return { s, x: p.x, z: p.z, y: profileAt(prof, s) + DRAW_LIFT, nx: -p.dz, nz: p.dx }; };
    for (const s of st) {
      if (prev && s - prev.s < 1e-3) continue;
      const cur = at(s);
      if (inCity(cur.x, cur.z)) { prev = null; continue; }
      if (prev) {
        const on = roads.onBridge(id, (prev.s + s) / 2);
        if (on !== was) { const A = on ? prev : cur, g = seabed(A.x, A.z); if (A.y - g > 0.6) out.push({ ...A, hw: sec.outer + 0.3, hd: 0.9, top: A.y - 0.05, bottom: g - 1.5 }); }
        was = on;
        if (on && Math.floor(prev.s / 30) !== Math.floor(s / 30)) { const g = seabed(cur.x, cur.z); if (g < cur.y - 2 && cur.y - g < 90) out.push({ ...cur, hw: sec.outer * 0.7, hd: 0.7, top: cur.y - 0.95, bottom: g - 1 }); }
      }
      prev = cur;
    }
  }
  return out;
}
/** How far a drawn road's surface stands above its profile (render/island-roads.js); the graded ground lies FORMATION
 *  below the profile. */
export const DRAW_LIFT = 0.035;
const GATE_REACH = 10;   // m of an access road held level with the module it meets
export const GATE_EASE = 16;   // m past that over which its grade comes on (a vertical curve)
/** m past the city's edge a road leaving it runs level with the city's streets (beyond its edge junction's mouth). */
const EDGE_REACH = 2 * CITY_RETURN + 6;
/** Curb-return radius at junction corners and how much wider than the roadway a dead end's turning circle is (m). */
export const CURB_RETURN = 8, TURN_EXTRA = 6;
const PAD_CELL = 64;
const BLEND = 14;   // metres of cutting/embankment blend beside a road's corridor
/** Water deeper than this (m) is crossed on a bridge (WP4.15): its deck stands BRIDGE_DECK m above the sea. */
export const BRIDGE_DEPTH = 6, BRIDGE_DECK = 5;
const WET = 0.25, ABUT = 6;   // m: water deeper than WET is bridged; the deck reaches ABUT m onto each bank
/** The graded ground (what wheels and feet stand on) lies this far below a road's profile; its drawn surface sits just above. */
export const FORMATION = 0.04;
const DRAWN_FORMATION = 0.3;
void alignmentGeometry;
