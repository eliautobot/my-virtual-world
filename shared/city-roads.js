// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The city's streets in the road model (WP4.1; wp4-world-spec.md §4.2, the compatibility layer). The city is still a
// regular grid (world.grid, which rendering, traffic and walking read); here its avenues and streets are road records
// like any road beyond the city - the same centrelines (exact, in µm), the 'avenue-4' road type (14 m curb to curb, the
// city's street) and the names its addresses use - so a question about roads (what runs here, does this new road run on
// top of another or crowd a junction) is asked of one network. gridFromRoads goes back to the grid exactly; when WP4.5
// lets the road records lead, the grid becomes what they derive.
import { RoadNetwork, alignmentsFromGrid, DEFAULT_ROAD_PROFILES } from './roads.js';
import { AVENUES, STREETS, makeGrid, ixIndex, hasCity } from './city.js';
import { umToM } from './units.js';
import { junctionPlans, CROSSWALK_W } from './road-kit.js';
import { WALK_BAND, sigOffset } from './constants.js';

/** m: a city corner's curb return - a bus in the outer lane turns on ~14 m (more through the parking lane), and the
 *  walking band's corner (WALK_BAND in from both curbs), where walkers cross, stays on the sidewalk. */
export const CITY_RETURN = 9.0;

export const CITY_ROAD_PROFILE = 'avenue-4';
/** The road type of a grid's streets: the avenue once the grid is wide enough for it, else today's 14 m street. */
export const cityProfileFor = (grid, profiles = DEFAULT_ROAD_PROFILES) => (Math.abs(+grid.road - 2 * profiles[CITY_ROAD_PROFILE].carriageHalf / 1e6) < 0.01 ? CITY_ROAD_PROFILE : 'city-14');
const ID = /^grid-([as])(\d+)$/;
/** Whether a road id is one of the city's streets (grid-a<i>: avenue i; grid-s<j>: street j). */
export const isCityRoad = id => ID.test(String(id));

/** The city's streets as road records (µm): avenues along z at each X[i], streets along x at each Z[j] (none without a city). */
export function cityRoads(grid) {
  if (!hasCity(grid)) return [];
  return alignmentsFromGrid(grid, { profile: cityProfileFor(grid), names: { avenues: AVENUES, streets: STREETS } });
}

/** The grid ({ nx, nz, bw, bd, road } in m) that the city's road records describe; throws when they are not a regular
 *  grid centred on the origin. Other records (roads beyond the city) are ignored. */
export function gridFromRoads(records, profiles = DEFAULT_ROAD_PROFILES) {
  const av = [], st = [];
  for (const r of records || []) { const m = ID.exec(r.id); if (m) (m[1] === 'a' ? av : st)[+m[2]] = r; }
  const nx = av.length - 1, nz = st.length - 1;
  if (nx < 1 || nz < 1 || av.includes(undefined) || st.includes(undefined)) throw new Error('The city needs every avenue and street');
  const prof = profiles[av[0].profile];
  if (!prof || [...av, ...st].some(r => r.profile !== av[0].profile)) throw new Error("The city's streets share one road type");
  const line = (r, k) => { if (r.pts.length !== 2 || r.pts[0][k] !== r.pts[1][k]) throw new Error(`${r.name || r.id} is not a straight grid line`); return r.pts[0][k]; };
  const X = av.map(r => line(r, 'x')), Z = st.map(r => line(r, 'z'));
  const px = X[1] - X[0], pz = Z[1] - Z[0];
  if (!(px > 0 && pz > 0) || X.some((x, i) => x !== X[0] + i * px) || Z.some((z, j) => z !== Z[0] + j * pz)) throw new Error("The city's streets are not evenly spaced");
  if (X[0] * 2 !== -nx * px || Z[0] * 2 !== -nz * pz) throw new Error('The city is not centred');
  for (const r of av) if (Math.min(r.pts[0].z, r.pts[1].z) !== Z[0] || Math.max(r.pts[0].z, r.pts[1].z) !== Z[nz]) throw new Error(`${r.name || r.id} does not run from edge to edge`);
  for (const r of st) if (Math.min(r.pts[0].x, r.pts[1].x) !== X[0] || Math.max(r.pts[0].x, r.pts[1].x) !== X[nx]) throw new Error(`${r.name || r.id} does not run from edge to edge`);
  const road = 2 * prof.carriageHalf;
  return { nx, nz, bw: umToM(px - road), bd: umToM(pz - road), road: umToM(road) };
}

/** One network of every road: the city's streets and the roads beyond it (records that fail validation are left out). */
export function worldRoads(world, profiles = DEFAULT_ROAD_PROFILES) {
  const net = new RoadNetwork({ profiles });
  if (world.grid) for (const r of cityRoads(world.grid)) net.set(r);
  for (const r of world.roads || []) { try { if (!isCityRoad(r.id)) net.set(r); } catch { /* an older invalid road is left out */ } }
  return net;
}

/** Whether a road beyond the city ends on one of the city's edge streets (where it joins the city's junction there). */
export function joinsCity(g, rec) {
  if (g.empty) return false;
  const on = p => { const x = p.x / 1e6, z = p.z / 1e6, onX = g.X.some(v => Math.abs(v - x) < 1), onZ = g.Z.some(v => Math.abs(v - z) < 1);
    return onX && onZ && (Math.abs(x - g.X[0]) < 1 || Math.abs(x - g.X.at(-1)) < 1 || Math.abs(z - g.Z[0]) < 1 || Math.abs(z - g.Z.at(-1)) < 1); };
  return on(rec.pts[0]) || on(rec.pts.at(-1));
}
/**
 * A road beyond the city that stops short of an edge street's junction - an end on the line of an avenue (or street)
 * that meets the city's edge, outside it but within the edge street's half width of the junction's centre (an island's
 * Beach Road ended at the curb, 2026-10-06: "the junction didn't trigger") - carried on to that centre, so it joins
 * the city's junction like every road there (joinsCity). The same record when nothing stops short, else a new one.
 */
export function joinCityEdge(grid, rec, profiles = DEFAULT_ROAD_PROFILES) {
  if (!hasCity(grid) || !Array.isArray(rec?.pts) || rec.pts.length < 2 || rec.closed || isCityRoad(rec.id) || cityProfileFor(grid, profiles) !== CITY_ROAD_PROFILE) return rec;
  const lines = cityRoads(grid), X = [], Z = [];
  for (const r of lines) { const m = ID.exec(r.id); if (m) (m[1] === 'a' ? X : Z)[+m[2]] = m[1] === 'a' ? r.pts[0].x : r.pts[0].z; }
  // µm: the edge street's half width; within a metre the road joins already (joinsCity), and is left as it is
  const reach = profiles[CITY_ROAD_PROFILE].outerHalf, near = 1000000;
  const pts = rec.pts.map(p => ({ ...p }));
  let moved = false;
  for (const k of [0, pts.length - 1]) {
    const p = pts[k], q = pts[k === 0 ? 1 : k - 1];
    // along an avenue out of the top or bottom edge, or along a street out of the left or right edge (heading away)
    for (const [along, across, lineVals, edges] of [['z', 'x', X, [Z[0], Z.at(-1)]], ['x', 'z', Z, [X[0], X.at(-1)]]]) {
      const line = lineVals.find(v => Math.abs(p[across] - v) <= near);
      if (line === undefined) continue;
      for (const e of edges) {
        const out = e === edges[0] ? -1 : 1, d = (p[along] - e) * out;
        if (d > near && d <= reach && (q[along] - e) * out > d) { p[along] = e; p[across] = line; delete p.r; moved = true; }
      }
    }
  }
  return moved ? { ...rec, pts } : rec;
}

/**
 * The city's streets drawn and run by the road kit (2026-10-03: "look and work the same" as drawn roads), once its
 * grid is wide enough for the avenue (cityProfileFor): { net (the city's streets and the roads that join it at its
 * edge), profiles, prof (flat at street level), plans (every junction with a city street: 9 m curb returns, crosswalks
 * where the walkers cross, the all-way scramble, the lights on the city's timetable), stopAt (m from a junction's
 * centre where traffic stops), islandCuts (road id → stretches of a joining road inside a city junction) }, or null for
 * an older, narrower grid.
 */
export function cityRoadSet(grid, roads = [], profiles = DEFAULT_ROAD_PROFILES) {
  if (!hasCity(grid) || cityProfileFor(grid, profiles) !== CITY_ROAD_PROFILE) return null;
  const g = makeGrid(grid), net = RoadNetwork.fromJSON(cityRoads(grid), { profiles }), hr = g.hr;
  for (const r of roads || []) if (!isCityRoad(r.id) && joinsCity(g, r)) { try { net.set(r); } catch { /* an invalid record is left out */ } }
  const crosswalkAt = hr + WALK_BAND;
  const rules = j => {
    const i = Math.round((j.x - g.X[0]) / g.px), k = Math.round((j.z - g.Z[0]) / g.pz);
    // along z (the avenues and what carries them on) go together, along x the other phase
    return { R: CITY_RETURN, crosswalkAt, scramble: true, sigOffset: sigOffset(ixIndex(g, i, k)), phaseOf: a => (Math.abs(a.d.z) > Math.abs(a.d.x) ? 0 : 1) };
  };
  const plans = new Map(junctionPlans(net, profiles, { rules, skip: j => !j.arms.some(a => isCityRoad(a.id)) }).map(P => [P.key, P]));
  const islandCuts = new Map();
  for (const P of plans.values()) for (const A of P.arms) if (!isCityRoad(A.id)) (islandCuts.get(A.id) || islandCuts.set(A.id, []).get(A.id)).push([Math.min(A.s, A.s + A.along * A.mouth), Math.max(A.s, A.s + A.along * A.mouth)]);
  const flat = { d: 1e9, y: new Float32Array([0, 0]) }, prof = new Map(net.all().map(r => [r.id, flat]));
  // where the city's traffic stops: at the stop bars, before the signals' mast arms (every city corner is alike)
  const cityArm = [...plans.values()].find(P => P.signalized && P.arms.every(A => isCityRoad(A.id)))?.arms[0];
  return { net, profiles, prof, plans, pads: [], spans: new Map(), onBridge: () => false, stopAt: cityArm?.stopAt ?? crosswalkAt + CROSSWALK_W / 2 + 0.6, islandCuts, g, only: isCityRoad };
}
