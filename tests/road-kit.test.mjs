// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The road kit (shared/road-kit.js): cross-sections band by band; junction corners whose curb returns let a bus keep
// its lane (never the classic release's tight corners), curb lines that run smoothly from the straight onto the arc, bands that blend
// between different roads, a clean paved area, crosswalks, stop bars, and signals on the city's timetable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoadNetwork, DEFAULT_ROAD_PROFILES as P } from '../shared/roads.js';
import { sectionOf, junctionPlans, returnRadius, signalFor, walkFor, walkStart, DESIGN_TURN_R, MAX_TANGENT } from '../shared/road-kit.js';

const um = v => Math.round(v * 1e6);
const road = (id, profile, ...pts) => ({ id, profile, name: id, pts: pts.map(([x, z]) => ({ x: um(x), z: um(z) })) });
const net = (...roads) => { const n = new RoadNetwork(); for (const r of roads) n.set(r); return n; };
const turn = (a, b, c) => Math.abs(Math.atan2((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)));
function simple(poly) {
  const n = poly.length, cross = (p, q, r, s) => { const d = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x); return d(p, q, r) * d(p, q, s) < -1e-9 && d(r, s, p) * d(r, s, q) < -1e-9; };
  for (let i = 0; i < n; i++) for (let k = i + 2; k < n; k++) { if (i === 0 && k === n - 1) continue; if (cross(poly[i], poly[(i + 1) % n], poly[k], poly[(k + 1) % n])) return false; }
  return true;
}

test('cross-sections: the city avenue and a country road, band by band', () => {
  const A = sectionOf(P['avenue-4']), C = sectionOf(P.country);
  assert.equal(A.lanes.length, 2); assert.equal(A.centre, 'double'); assert.equal(A.laneLines.length, 1);
  assert.equal(A.shoulder.kind, 'parking'); assert.ok(Math.abs(A.shoulder.o1 - A.shoulder.o0 - 3.048) < 1e-6, '10 ft parking lane');
  assert.ok(A.gutter && A.curb && A.sidewalk && A.raised && A.edgeLine !== null);
  assert.ok(Math.abs(A.lanes[0].w - 3.3528) < 1e-6 && Math.abs(A.lanes[1].w - 3.3528) < 1e-6, '11 ft lanes');
  assert.equal(C.centre, 'dashed'); assert.equal(C.shoulder.kind, 'gravel'); assert.equal(C.sidewalk, null); assert.equal(C.raised, false);
});

test('an avenue crossing: bus-sized curb returns, smooth curb lines, a clean paved area, crosswalks, stops, signals', () => {
  const N = net(road('ns', 'avenue-4', [0, -200], [0, 200]), road('ew', 'avenue-4', [-200, 0], [200, 0]));
  const [J] = junctionPlans(N, P);
  assert.equal(J.arms.length, 4); assert.equal(J.corners.length, 4);
  const sec = sectionOf(P['avenue-4']), room = sec.carriage - sec.lanes.at(-1).o;
  for (const c of J.corners) {
    assert.ok(Math.abs(c.R - returnRadius(sec, sec)) < 1e-9);
    assert.ok(c.R + room >= DESIGN_TURN_R - 1e-6, `a bus in the outer lane turns on ${(c.R + room).toFixed(1)} m (needs ${DESIGN_TURN_R})`);
    for (let k = 1; k + 1 < c.curb.length; k++) assert.ok(turn(c.curb[k - 1], c.curb[k], c.curb[k + 1]) < 0.2, 'no kink in the curb line');
    assert.ok(c.bands.gutter && c.bands.curb && c.bands.sidewalk, 'gutter, curb and sidewalk wrap the corner');
    // the sidewalk starts where the curb top ends
    c.bands.sidewalk[0].forEach((p, k) => assert.ok(Math.hypot(p.x - c.bands.curb[1][k].x, p.z - c.bands.curb[1][k].z) < 1e-9));
  }
  assert.ok(simple(J.surface), 'the paved area does not cross itself');
  assert.equal(J.crosswalks.length, 4); assert.equal(J.stops.length, 4);
  assert.equal(J.signalized, true); assert.equal(J.signals.length, 4);
  assert.deepEqual(J.phases.map((p, i) => p === J.phases[(i + 2) % 4]), [true, true, true, true], 'opposite arms go together');
  assert.notEqual(J.phases[0], J.phases[1]);
  // the timetable: one way green while the other is red, then the other way; walkers in the scramble
  const t0 = -J.sigOffset;   // cycle position 0
  assert.equal(signalFor(J, J.phases.indexOf(0), t0 + 5), 2); assert.equal(signalFor(J, J.phases.indexOf(1), t0 + 5), 0);
  assert.equal(signalFor(J, J.phases.indexOf(1), t0 + 20), 2); assert.equal(signalFor(J, J.phases.indexOf(0), t0 + 20), 0);
  assert.equal(walkFor(J, t0 + 40), 2); assert.equal(walkFor(J, t0 + 5), 0);
  const ws = walkStart(J, t0 + 5, 12); assert.ok(walkFor(J, ws + 0.01) === 2 && walkFor(J, ws + 12) >= 1, 'a walker starts in the window and is across before it closes');
});

test('an avenue meeting a country road: the sidewalk tapers round the corner; no crosswalk where there is no sidewalk', () => {
  const N = net(road('ave', 'avenue-4', [0, -200], [0, 200]), road('lane', 'country', [0, 0], [300, 0]));
  const [J] = junctionPlans(N, P);
  assert.equal(J.arms.length, 3);
  const country = J.arms.findIndex(a => a.id === 'lane');
  for (const c of J.corners.filter(c => c.i === country || c.k === country)) {
    const [inner, outer] = c.bands.sidewalk, a = c.k === country ? inner.at(-1) : inner[0], b = c.k === country ? outer.at(-1) : outer[0];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.6, 'the sidewalk has run out where the country road starts');
  }
  assert.ok(!J.crosswalks.some(x => x.arm === country), 'no crosswalk over the country road (no sidewalks to join)');
  assert.ok(simple(J.surface));
});

test('a sharp junction keeps its curb returns within reach', () => {
  const N = net(road('a', 'two-lane', [0, 0], [400, 0]), road('b', 'two-lane', [0, 0], [400 * Math.cos(0.5), 400 * Math.sin(0.5)]), road('c', 'two-lane', [0, 0], [-300, 0]));
  const [J] = junctionPlans(N, P);
  for (const c of J.corners) if (c.T1) assert.ok(Math.hypot(c.T1.x - c.X.x, c.T1.z - c.X.z) <= MAX_TANGENT + 1e-6);
  assert.ok(simple(J.surface));
});
