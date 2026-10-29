// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Residents' drives on the roads (shared/car-route.js; 2026-10-28, the product owner: people leaving the Radio Station
// "disappear ... their position is moving straight (not through roads)"; "would it abide by traffic lights, traffic":
// a real route, the lights, the traffic keeping clear). A drive from a city office to the far end of the island's
// roads: along the roads, in the right-hand lane, round each junction without a jump; never past a stop bar on a red
// (a left turn may go on its arrow, an amber when it can't stop), standing at the bar while it waits, to a stop at the
// end; a stop sign stops it first. Its resident walks to its car, rides in it — where it is, at every moment, is where
// the car is — and gets out where it parks; the message every browser draws the car by says when. It sets off and
// arrives pulled over at the kerb, on its resident's side of the road (never getting out across the street).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { makeGrid } from '../shared/city.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { tangentAt, project } from '../shared/roads.js';
import { signalFor } from '../shared/road-kit.js';
import { sigLight } from '../shared/constants.js';
import { F_HIDDEN, VEH_CAR } from '../shared/proto.js';
import { Nav } from '../server/sim/nav.js';
import { Plan, Router } from '../server/sim/plan.js';
import { driveTimetable, carAt, pathAt, DRIVE } from '../shared/car-route.js';

const world = generateWorld({ seed: 'agent-cars', population: 0 }), g = makeGrid(world.grid);
world.terrain = defaultIsland({ seed: 'agent-cars:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
world.roads = generateIslandRoads(new Island(world.terrain), world.grid);
const nav = new Nav(world), W = nav.walk();
const C = world.buildings.find(b => b && !b.gone && b.type === 'office');
let far = -1, fd = 0; for (let n = 0; n < W.N; n += 7) { const d = Math.hypot(W.X[n], W.Z[n]); if (d > fd && d < 2600) { fd = d; far = n; } }
const A = nav.acc[C.idx][0], B = nav.walkAccess(W.X[far], W.Z[far]);
const route = nav.carRoute(A, B), net = nav._carNet.net;
const lightOf = (st, t) => (st.city ? sigLight(st.city.ix, t, st.city.axis) : signalFor(route.plans.get(st.key), st.arm, t));

test('a drive\'s route: along the roads, in the right-hand lane, round each junction without a jump', () => {
  assert.ok(route, `a route (${nav.lastCarError || ''})`);
  const n = route.pts.length / 2;
  let onRoad = 0, right = 0;
  for (let k = 0; k < n; k++) {
    const x = route.pts[2 * k], z = route.pts[2 * k + 1];
    if (k) assert.ok(Math.hypot(x - route.pts[2 * k - 2], z - route.pts[2 * k - 1]) < 45, `no jumps (${k})`);
    const q = net.nearest(x, z, 12); if (!q) continue;
    onRoad++;
    if (k + 1 < n) {
      const dx = route.pts[2 * k + 2] - x, dz = route.pts[2 * k + 3] - z, t = tangentAt(net.geometry(q.id), q.s), sg = Math.sign(t.dx * dx + t.dz * dz) || 1;
      const side = -(t.dz * sg) * (x - q.x) + (t.dx * sg) * (z - q.z);
      if (side > 0 || q.dist < 0.3) right++;
    }
  }
  assert.ok(onRoad / n > 0.97, `on the roads (${onRoad}/${n})`);
  assert.ok(right / (n - 1) > 0.9, `right-hand lanes (${right}/${n - 1})`);
  assert.ok(route.stops.length > 0, 'junctions with lights or signs on the way');
});

test('its timetable: never past a stop bar on a red; standing at the bar while it waits; to a stop at the end', () => {
  let waited = 0, signals = 0;
  for (const t0 of [1000, 1013, 1027, 1041]) {   // (set off at different moments of the lights' cycle)
    const T = driveTimetable(route, t0, { plans: route.plans }), D = { pts: route.pts, S: route.S, ks: T.ks, ts: T.ts };
    assert.equal(T.ks.at(-1), +route.len.toFixed(2)); assert.ok(T.t1 > t0 && T.t1 - t0 < route.len / 2, `there in time (${Math.round(T.t1 - t0)} s for ${Math.round(route.len)} m)`);
    for (const st of route.stops) {
      // the moment its front reaches the bar, and how long it stood just short of it
      let tPass = null, stood = 0;
      for (let t = t0; t <= T.t1; t += 0.1) {
        const c = carAt(D, t);
        if (tPass === null && c.s + DRIVE.carLen / 2 >= st.s) tPass = t;
        if (Math.abs(st.s - DRIVE.carLen / 2 - DRIVE.stopShort - c.s) < 0.6 && carAt(D, t + 0.1).s - c.s < 0.005) stood += 0.1;
      }
      assert.ok(tPass !== null, 'it passes every stop');
      if (st.kind === 'signal') {
        signals++;
        const lt = lightOf(st, tPass - 0.3);   // (its front at the bar a moment before)
        assert.ok(lt === 2 || lt === 1 || (lt === 3 && st.turn === 'left'), `not through a red (light ${lt}, ${st.turn}, at ${tPass.toFixed(1)})`);
        if (stood > 1) { waited++; assert.notEqual(lightOf(st, tPass - stood + 0.5), 2, 'it waited because the light was not green'); }
      } else assert.ok(stood >= DRIVE.signPause - 0.2, `a stop sign: it stops first (${stood.toFixed(1)} s)`);
    }
    const end = carAt(D, T.t1); assert.ok(Math.abs(end.s - route.len) < 0.01, 'there at the end');
  }
  assert.ok(signals > 0 && waited > 0, `it met lights, and waited at a red (${waited} of ${signals})`);
});

test('its resident walks to its car, rides in it (where it is, is where its car is), and gets out where it parks', () => {
  const router = new Router(world, nav), seen = [];
  router.onDrive = r => seen.push(r);
  const P = new Plan(5000, { x: A.x, y: 0.15, z: A.z, ctx: -1 }), r = nav.rideCost(A, B);
  router.drive(P, A, B, r, { speed: 1.4, anim: 1, use: 1, i: 7 });
  const m = seen[0], D = { pts: m.pts, S: route.S, ks: m.ks, ts: m.ts };
  assert.ok(m && m.tIn > m.t0 && m.tOut > m.tIn && m.t1 > m.tOut);
  let t = 5000, worst = 0, before = null, after = null;
  for (const s of P.segs) {
    const end = t + s.dur;
    if (s.veh === VEH_CAR) {
      assert.ok(s.flags & F_HIDDEN);
      const c = carAt(D, end); worst = Math.max(worst, Math.hypot(c.x - s.x, c.z - s.z));
    } else if (end <= m.tIn + 1e-6) before = s; else if (!after && t >= m.tOut - 1e-6) after = s;
    t = end;
  }
  assert.ok(worst < 0.6, `in its car all the way (at most ${worst.toFixed(2)} m from it)`);
  const c0 = pathAt(D, 0), cE = pathAt(D, route.len);
  assert.ok(Math.hypot(before.x - c0.x, before.z - c0.z) < 2, 'it walks up to its car before it gets in');
  assert.ok(Math.hypot(after.x - cE.x, after.z - cE.z) < 2, 'and steps out beside it where it parks');
  // pulled over at the kerb at both ends (not stopped in its lane), on its resident's side of the road: it gets out
  // where it is going, never across the street (2026-10-28, seen in the browser: a resident walked across an avenue)
  for (const [c, door, to, what] of [[c0, before, A.walk ? { x: W.X[A.node], z: W.Z[A.node] } : { x: A.bx, z: A.bz }, 'where it sets off'], [cE, after, { x: W.X[B.node], z: W.Z[B.node] }, 'where it arrives']]) {
    const q = net.nearest(c.x, c.z, 30), G = net.geometry(q.id), side = (x, z) => Math.sign(project(G, x, z).offset), half = net.profiles[net.get(q.id).profile].carriageHalf * 1e-6;
    assert.ok(q.dist >= half - 2.4, `${what}: pulled over to the kerb (${q.dist.toFixed(1)} m from the road's middle, its half ${half.toFixed(1)})`);
    assert.equal(side(door.x, door.z), side(to.x, to.z), `${what}: on its resident's side of the road`);
  }
});
