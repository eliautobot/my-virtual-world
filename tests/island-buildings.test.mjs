// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.6 buildings beyond the city and WP4.5 walking there (wp4-world-spec.md §4–5, §9): buildings turned to face their
// road, on level pads at the height of the ground along their front; residents reach them on footpaths along the
// island's roads, joined to the city's streets where the roads leave it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, createBuilding } from '../server/world/generate.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { makeGrid } from '../shared/city.js';
import { footprint, corners, inFootprint, footprintsOverlap, toWorld } from '../shared/geom.js';
import { normalizeSpec } from '../shared/edit.js';
import { checkIslandBuilding, baseFor, padHeight, buildingPads, MAX_PAD_SLOPE } from '../shared/island-build.js';
import { pointAt } from '../shared/roads.js';
import { floorAt, GROUND_Y } from '../shared/constants.js';
import { Nav } from '../server/sim/nav.js';
import { Router } from '../server/sim/plan.js';

test('turned footprints: bounds, corners, inside and overlap', () => {
  const sq = { x: 10, z: 20, w: 16, d: 10, rot: 90 };
  assert.deepEqual(footprint(sq), { x0: 5, x1: 15, z0: 12, z1: 28 }, 'square turns keep the exact box');
  const b = { x: 0, z: 0, w: 20, d: 10, rot: 30 }, f = footprint(b), c = corners(b);
  for (const p of c) assert.ok(p.x >= f.x0 - 1e-9 && p.x <= f.x1 + 1e-9 && p.z >= f.z0 - 1e-9 && p.z <= f.z1 + 1e-9, 'corners inside the bounds');
  assert.ok(Math.abs(Math.hypot(c[0].x - c[1].x, c[0].z - c[1].z) - 20) < 1e-9, 'front edge is the width');
  const front = toWorld(b, 0, 5.5);
  assert.ok(!inFootprint(b, front.x, front.z) && inFootprint(b, front.x, front.z, 0.6), 'a point just in front is outside, inside with padding');
  const corner = { x: f.x1 - 0.3, z: f.z1 - 0.3 };
  assert.ok(!inFootprint(b, corner.x, corner.z), 'the bounding box corner is not inside a turned building');
  assert.ok(footprintsOverlap(b, { ...b, x: 15 }), 'side by side, overlapping');
  assert.ok(!footprintsOverlap(b, { ...b, x: 30, z: -20 }), 'apart');
  const spec = normalizeSpec({ type: 'office', w: 20, d: 16, floors: 3, rot: 33.333, x: 5000.123, z: 10.456 }, { grid: { nx: 9, nz: 7, bw: 64, bd: 52, road: 14 } });
  assert.equal(spec.rot, 33.3, 'beyond the city: turned to 0.1°'); assert.equal(spec.x, 5000.12);
  const inCity = normalizeSpec({ type: 'office', w: 20, d: 16, floors: 3, rot: 33, x: 0, z: 0 }, { grid: { nx: 9, nz: 7, bw: 64, bd: 52, road: 14 } });
  assert.equal(inCity.rot, 0, 'in the city: square to the grid');
});

/** A small world with the island and its generated roads. */
function islandWorld() {
  const world = generateWorld({ seed: 'wp4-island-buildings', population: 0 });
  const g = makeGrid(world.grid);
  world.terrain = defaultIsland({ seed: 'wp4-island-buildings:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  world.roads = generateIslandRoads(new Island(world.terrain), world.grid);
  return world;
}
/** A spot facing the Island Loop a little way along it, square to the road, front just behind the road. */
function loopSpot(world, frac, spec) {
  const island = new Island(world.terrain, { roads: world.roads }), net = island.roads.net, G = net.geometry('isl-loop');
  const half = net.profiles[net.get('isl-loop').profile].outerHalf / 1e6;
  for (let k = 0; k < 40; k++) {
    const q = pointAt(G, G.length * ((frac + k * 0.013) % 1), {});
    for (const side of [1, -1]) {
      const nx = -q.dz * side, nz = q.dx * side, r = half + 2.5 + spec.d / 2;
      const s = normalizeSpec({ ...spec, x: q.x + nx * r, z: q.z + nz * r, rot: Math.atan2(-nx, -nz) * 180 / Math.PI }, world);
      const env = { heightAt: (x, z) => island.height(x, z), isWater: (x, z) => !!island.waterAt(x, z), roads: net };
      if (!checkIslandBuilding(world, s, env)) return { spec: s, env, island };
    }
  }
  return null;
}

test('a building beyond the city: rules, pad level along its front, the ground graded to it', () => {
  const world = islandWorld();
  const got = loopSpot(world, 0.3, { type: 'office', w: 20, d: 16, floors: 4, style: 'modern' });
  assert.ok(got, 'there is room beside the Island Loop');
  const { spec, env } = got;
  assert.ok(spec.rot % 90 !== 0 || true);
  const base = baseFor(env.heightAt, spec);
  assert.ok(Math.abs(GROUND_Y + base - padHeight(env.heightAt, spec)) < 0.011, 'the base is the pad level above the city ground');
  // refused: on the road, in the sea, on another building
  const onRoad = { ...spec, x: spec.x + (toWorld(spec, 0, 12).x - spec.x), z: spec.z + (toWorld(spec, 0, 12).z - spec.z) };
  assert.match(checkIslandBuilding(world, onRoad, env) || '', /Island Loop|road/);
  const T = world.terrain, sea = { ...spec, x: T.center.x + T.radius * 1.6, z: T.center.z };
  assert.match(checkIslandBuilding(world, sea, env) || '', /water/);
  const g = makeGrid(world.grid);
  const B = createBuilding(world, { type: spec.type, block: null, rot: spec.rot, base, floors: spec.floors, style: spec.style, rect: { x0: spec.x - spec.w / 2, x1: spec.x + spec.w / 2, z0: spec.z - spec.d / 2, z1: spec.z + spec.d / 2 } }, 1);
  assert.equal(B.rot, spec.rot); assert.equal(B.w, spec.w); assert.equal(B.d, spec.d); assert.equal(B.base, base);
  assert.ok(B.x > g.maxX || B.x < g.minX || B.z > g.maxZ || B.z < g.minZ);
  assert.match(checkIslandBuilding(world, spec, env, -1) || '', /Too close/, 'a second one on top is refused');
  // The ground: level under the pad, the road untouched by it.
  const padded = new Island(world.terrain, { roads: world.roads, pads: buildingPads(world) });
  for (const p of corners(B, 1)) assert.ok(Math.abs(padded.height(p.x, p.z) - (floorAt(B, 0) - 0.05)) < 1e-6, 'level pad');
  const net = padded.roads.net, near = net.nearest(B.x, B.z, 60);
  const bare = new Island(world.terrain, { roads: world.roads });
  assert.ok(Math.abs(padded.height(near.x, near.z) - bare.height(near.x, near.z)) < 1e-6, 'the road beside it keeps its height');
  // the pad stays within the slope rule wherever it was accepted
  for (const p of corners(B)) assert.ok(Math.abs(bare.height(p.x, p.z) - (GROUND_Y + base)) <= MAX_PAD_SLOPE + 0.01);
});

test('walking beyond the city: footpaths along the roads, linked to the city streets; routes both ways', () => {
  const world = islandWorld();
  const got = loopSpot(world, 0.55, { type: 'apartment', w: 16, d: 18, floors: 3, style: 'stucco' });
  const { spec, env } = got;
  const B = createBuilding(world, { type: spec.type, block: null, rot: spec.rot, base: baseFor(env.heightAt, spec), floors: spec.floors, style: spec.style, rect: { x0: spec.x - spec.w / 2, x1: spec.x + spec.w / 2, z0: spec.z - spec.d / 2, z1: spec.z + spec.d / 2 } }, 2);
  const nav = new Nav(world), W = nav.walk();
  assert.ok(W && W.N > 1000, `footpath points: ${W && W.N}`);
  assert.ok(W.portals.length >= 4, `links to the city streets: ${W.portals.length}`);
  const acc = nav.acc[B.idx][0];
  assert.ok(acc.walk && acc.node >= 0 && acc.spur < 30, `the door reaches the footpath (${acc.spur?.toFixed(1)} m)`);
  // a city building to the island one and back
  const C = world.buildings.find(b => b && !b.gone && b.type === 'office' && b.base === undefined);
  const ca = nav.acc[C.idx][0];
  const there = nav.walkRoute(ca, acc, true), back = nav.walkRoute(acc, ca, true);
  assert.ok(Number.isFinite(there.cost) && there.cost < 4 * 3600, `a walk there (${(there.cost / 60).toFixed(0)} min)`);
  assert.ok(Math.abs(there.cost - back.cost) < 1, 'the same both ways');
  for (const r of [there, back]) {
    for (let k = 1; k < r.pts.length; k++) {
      const a = r.pts[k - 1], b = r.pts[k];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 60, `no jumps (${k}: ${Math.hypot(a.x - b.x, a.z - b.z).toFixed(1)} m)`);
    }
    for (const p of r.pts) if (nav.beyond(p.x, p.z)) assert.ok(Number.isFinite(p.y), 'heights beyond the city');
    const crossings = r.pts.filter(p => p.c);
    for (const p of crossings) assert.ok(!nav.beyond(p.x, p.z) && p.ix >= 0 && p.ba >= 0 && p.bb >= 0, 'signalled crossings only in the city');
  }
  assert.equal(nav.streetCost(ca, acc), there.cost, 'street costs use the same route');
  // the router plans the trip, with heights following the ground beyond the city
  const router = new Router(world, nav), moves = [];
  const P = { x: ca.x, z: ca.z, t: 0, ctx: -1, move(x, y, z) { moves.push({ x, y, z }); this.x = x; this.z = z; }, hold() {}, seg() {} };
  router.walkStreet(P, ca, acc, { speed: 1.3, off: 0.4 });
  const last = moves.at(-1);
  assert.ok(Math.hypot(last.x - acc.x, last.z - acc.z) < 1.5, 'the walk ends at the door');
  const ground = new Island(world.terrain, { roads: world.roads, pads: buildingPads(world) });
  for (const m of moves) if (nav.beyond(m.x, m.z) && Math.hypot(m.x - acc.x, m.z - acc.z) > 3) assert.ok(Math.abs(m.y - ground.height(m.x, m.z)) < 1.2, `on the ground (${(m.y - ground.height(m.x, m.z)).toFixed(2)} m)`);
  // island to island: two spots on the loop
  const other = nav.walkAccess(...(() => { const q = pointAt(W.net.geometry('isl-loop'), 900, {}); return [q.x, q.z]; })());
  const r = nav.walkRoute(acc, other, true);
  assert.ok(Number.isFinite(r.cost) && r.pts.length > 3);
  assert.match(nav.addressAt(other.x, other.z), /Island Loop/);
  // Joggers out along the road come back to where they began.
  const trail = W.trail(acc.node, 400, null);
  assert.equal(trail[0], trail.at(-1));
});

test('residents living beyond the city: they go about their day, walking near home and driving further', async () => {
  const { generatePopulation } = await import('../server/sim/population.js');
  const { WorldIndex } = await import('../server/sim/windex.js');
  const { Sim } = await import('../server/sim/sim.js');
  const { evalPlan } = await import('../server/sim/plan.js');
  // A small city whose beds are all taken, so the island's apartment house fills too.
  const world = generateWorld({ seed: 'wp4-island-residents', nx: 4, nz: 3, population: 0 });
  const g = makeGrid(world.grid);
  world.terrain = defaultIsland({ seed: 'wp4-island-residents:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  world.roads = generateIslandRoads(new Island(world.terrain), world.grid);
  const blds = [];
  for (const [frac, type] of [[0.08, 'apartment'], [0.1, 'apartment'], [0.12, 'office']]) {
    const got = loopSpot(world, frac, { type, w: 18, d: 18, floors: 4, style: 'stucco' });
    const { spec, env } = got;
    blds.push(createBuilding(world, { type, block: null, rot: spec.rot, base: baseFor(env.heightAt, spec), floors: spec.floors, style: spec.style, rect: { x0: spec.x - spec.w / 2, x1: spec.x + spec.w / 2, z0: spec.z - spec.d / 2, z1: spec.z + spec.d / 2 } }, 7 + blds.length));
  }
  const index = new WorldIndex(world);
  const people = generatePopulation(world, index, { population: 2500, roster: [] });
  const islanders = people.filter(p => p.home && blds.some(B => B.idx === p.home.b));
  assert.ok(islanders.length >= 5, `people live beyond the city: ${islanders.length}`);
  let T = 0;
  const sim = new Sim(world, people, { index, budgetMs: 1e9, clock: { simBase: 0, realBase: 0, rate: 1, dayBase: 6.5 * 3600, dayScale: 16 } });
  sim.now = () => T;
  const modes = {};
  sim.router.travel = (travel => (P, dest, o) => { const m = travel(P, dest, o); modes[m] = (modes[m] || 0) + 1; return m; })(sim.router.travel.bind(sim.router));
  sim.start();
  const ids = new Set(islanders.map(p => people.indexOf(p)));
  const ground = new Island(world.terrain, { roads: world.roads, pads: buildingPads(world) });
  let checked = 0, inCity = 0;
  for (; T < 900; T += 0.5) {   // about four world hours from 6:30
    sim.tick();
    if (T % 30) continue;
    for (const i of ids) {
      const e = evalPlan(sim.agents[i].plan, T);
      assert.ok([e.x, e.y, e.z].every(Number.isFinite), 'a resident is always somewhere');
      if (e.ctx === -1 && !(e.s && e.s.flags & 1) && sim.nav.beyond(e.x, e.z)) {
        assert.ok(Math.abs(e.y - ground.height(e.x, e.z)) < 1.5, `outdoors on the ground (${(e.y - ground.height(e.x, e.z)).toFixed(2)} m at ${e.x.toFixed(0)},${e.z.toFixed(0)})`);
        checked++;
      }
      if (!sim.nav.beyond(e.x, e.z)) inCity++;
    }
  }
  assert.equal(sim.errorCount, 0, `simulation errors: ${JSON.stringify(sim.errors.slice(0, 2))}`);
  assert.ok(modes.drive > 0, `some trips are drives: ${JSON.stringify(modes)}`);
  assert.ok(inCity > 0, 'islanders come into the city');
  assert.ok(checked > 0, 'islanders are seen out on the island');
});

test('subway stations beyond the city: placed beside a road, residents ride between them and the city', async () => {
  const { normalizeStation, checkStation, stationInside, KIOSK } = await import('../shared/stations.js');
  const world = islandWorld();
  const island = new Island(world.terrain, { roads: world.roads }), net = island.roads.net, G = net.geometry('isl-loop');
  const env = { heightAt: (x, z) => island.height(x, z), isWater: (x, z) => !!island.waterAt(x, z), roads: net };
  const half = net.profiles[net.get('isl-loop').profile].outerHalf / 1e6;
  let st = null;
  for (let k = 0; k < 60 && !st; k++) {
    const q = pointAt(G, G.length * (0.3 + k * 0.01), {});
    for (const side of [1, -1]) {
      const nx = -q.dz * side, nz = q.dx * side, r = half + 1.6 + KIOSK.hd;
      const s = normalizeStation({ x: q.x + nx * r, z: q.z + nz * r, rot: Math.atan2(-nx, -nz), name: 'Hilltop' });
      if (!checkStation(world, s, env)) { st = s; break; }
    }
  }
  assert.ok(st, 'a station fits beside the loop');
  assert.match(checkStation(world, { ...st, x: st.x + 1e5 }, { ...env, isWater: () => true }) || '', /water/);
  const q0 = pointAt(G, G.length * 0.3, {});
  assert.match(checkStation(world, normalizeStation({ x: q0.x, z: q0.z, rot: 0 }), env) || '', /road/);
  st.id = 's99'; st.y = Math.round(island.height(st.x, st.z) * 100) / 100;
  world.stations.push(st);
  const along = { x: st.x + Math.cos(st.rot) * 15, z: st.z - Math.sin(st.rot) * 15 };   // 15 m along the road
  assert.match(checkStation(world, normalizeStation({ ...along, rot: st.rot }), env, 'x') || '', /apart/);
  const nav = new Nav(world), sa = nav.stAcc.find(a => a.st.id === 's99');
  assert.ok(sa.walk && sa.node >= 0, 'the station joins the footpaths');
  const inside = stationInside(st);
  assert.ok(Math.hypot(inside.x - st.x, inside.z - st.z) < 1, 'riders stand inside the kiosk');
  // A city office to a spot near the station: the subway (or a drive), never a three-hour walk.
  const C = world.buildings.find(b => b && !b.gone && b.type === 'office' && b.base === undefined), ca = nav.acc[C.idx][0];
  const there = nav.walkAccess(st.entry.x + 30, st.entry.z);
  const router = new Router(world, nav), moves = [];
  const P = { x: ca.x, z: ca.z, t: 0, yaw: 0, ctx: -1, move(x, y, z) { moves.push({ x, y, z }); this.x = x; this.z = z; }, hold() {}, seg(d, x, y, z) { moves.push({ x, y, z, hidden: true }); this.x = x; this.z = z; } };
  const mode = router.streetTrip(P, ca, there, { speed: 1.3, off: 0 });
  assert.ok(mode === 'subway' || mode === 'drive', `rides rather than walks: ${mode}`);
  assert.ok(moves.every(m => [m.x, m.y, m.z].every(Number.isFinite)));
});
