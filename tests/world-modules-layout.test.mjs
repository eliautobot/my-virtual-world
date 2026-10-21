// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The airport's layout and its access road (shared/world-modules.js, shared/airport-layout.js): the road leaves square to
// the airport's edge where its entrance road ends - straight on to a road ahead, or out and one curve round to the nearest
// road, met square on, never back across the airport; the module's access roads are the ones ending at its entrance; the
// paving's curves sit in real corners; the canopy's columns are solid.
import assert from 'node:assert/strict';
import test from 'node:test';
import { RoadNetwork, alignmentGeometry, DEFAULT_ROAD_PROFILES } from '../shared/roads.js';
import { accessRoadPath, accessRoadsOf, roadEndOf, padOf, inRect, moduleBoxes } from '../shared/world-modules.js';
import { SURFACES, FILLETS, BENDS, LANDSIDE, ROAD_END } from '../shared/airport-layout.js';

const um = v => Math.round(v * 1e6);
const net = (...roads) => RoadNetwork.fromJSON(roads.map((pts, k) => ({ id: `road-${k + 1}`, profile: 'country', pts: pts.map(([x, z]) => ({ x: um(x), z: um(z) })) })));
const asRecord = pts => ({ id: 'road-x', profile: 'country', pts: pts.map(p => (p.r ? { x: um(p.x), z: um(p.z), r: um(p.r) } : { x: um(p.x), z: um(p.z) })) });
const airport = rot => ({ kind: 'airport', x: 0, z: 0, rot });

test('the access road leaves square to the airport: straight on to a road ahead', () => {
  const m = airport(0), pts = accessRoadPath(m, net([[300, -900], [300, 900]])), e = roadEndOf(m);
  assert.equal(pts.length, 2);
  assert.ok(Math.hypot(pts[0].x - e.x, pts[0].z - e.z) < 1e-6, 'from the end of its entrance road');
  assert.ok(Math.abs(pts[1].z - pts[0].z) < 1.5 && Math.abs(pts[1].x - 300) < 1e-6, 'straight out, square to its edge, to the road');
});

test('a road to one side: out, one curve, met square on - a road the network accepts; never back across the airport', () => {
  for (const rot of [0, -0.6, -0.2]) {   // (its entrance square to the road's line, or turned towards it)
    const m = airport(rot), pts = accessRoadPath(m, net([[-2000, 600], [2000, 600]]));
    assert.equal(pts.length, 3, `rot ${rot}: out and round`);
    const out = { x: Math.cos(rot), z: -Math.sin(rot) }, l0 = { x: pts[1].x - pts[0].x, z: pts[1].z - pts[0].z };
    assert.ok(Math.abs(l0.x * out.z - l0.z * out.x) < 1e-6, 'its first stretch is square to the airport');
    assert.ok(Math.abs(pts[2].x - pts[1].x) < 1e-6 && Math.abs(pts[2].z - 600) < 1e-6, 'it meets the road square on');
    assert.ok(pts[1].r >= 18 && pts[1].r <= 60, `a curve of ${pts[1].r.toFixed(0)} m`);
    const g = alignmentGeometry(asRecord(pts), DEFAULT_ROAD_PROFILES);   // (throws if the curve doesn't fit)
    assert.ok(g.segs.some(s => s.type === 'arc'));
    const pad = padOf(m);
    for (let k = 1; k <= 40; k++) { const u = k / 40, x = pts[1].x + (pts[2].x - pts[1].x) * u, z = pts[1].z + (pts[2].z - pts[1].z) * u; assert.ok(!inRect(pad, x, z, 0), 'not across the airport'); }
  }
  // the road behind it: out, along the airport past its nearer end, on to the road - every stretch clear of it
  for (const [rot, line] of [[0.6, [[-2000, 600], [2000, 600]]], [0, [[-700, -2000], [-700, 2000]]]]) {
    const m = airport(rot), back = accessRoadPath(m, net(line)), pad = padOf(m), e = roadEndOf(m);
    assert.equal(back.length, 4, `rot ${rot}: round the airport (${back.length} points)`);
    alignmentGeometry(asRecord(back), DEFAULT_ROAD_PROFILES);
    for (let i = 0; i + 1 < back.length; i++) for (let k = 0; k <= 40; k++) {
      const x = back[i].x + (back[i + 1].x - back[i].x) * k / 40, z = back[i].z + (back[i + 1].z - back[i].z) * k / 40;
      if (Math.hypot(x - e.x, z - e.z) > 15) assert.ok(!inRect(pad, x, z, 6), `rot ${rot}: clear of the airport at ${x.toFixed(0)},${z.toFixed(0)}`);
    }
    assert.ok(line[0][1] === line[1][1] ? Math.abs(back[3].z - line[0][1]) < 1e-6 : Math.abs(back[3].x - line[0][0]) < 1e-6, 'and it reaches the road');
  }
  assert.equal(accessRoadPath(airport(0), net([[232.5, -900], [232.5, 900]])), null, 'a road right at its entrance: none needed');
});

test("a module's access roads are the ones that end at its entrance", () => {
  const m = airport(0), e = roadEndOf(m);
  const w = { roads: [{ id: 'road-1', pts: [{ x: um(e.x), z: um(e.z) }, { x: um(500), z: um(-20) }] }, { id: 'road-2', pts: [{ x: um(900), z: um(0) }, { x: um(1200), z: um(0) }] },
    { id: 'road-3', pts: [{ x: um(700), z: um(100) }, { x: um(e.x + 1), z: um(e.z - 1) }] }] };
  assert.deepEqual(accessRoadsOf(w, m).map(r => r.id), ['road-1', 'road-3']);
});

test('the paving turns round curves in real corners; the landside reaches the entrance; the canopy columns are solid', () => {
  const paved = (s, f) => SURFACES.some(([s0, f0, s1, f1, k]) => k !== 'grass' && s >= s0 - 1e-6 && s <= s1 + 1e-6 && f >= f0 - 1e-6 && f <= f1 + 1e-6);
  for (const F of FILLETS) {
    assert.ok(paved(F.s + F.u[0] * F.r * 0.5, F.f + F.u[1] * F.r * 0.5) && paved(F.s + F.w[0] * F.r * 0.5, F.f + F.w[1] * F.r * 0.5), `fillet at ${F.s},${F.f}: paving along both edges`);
    assert.ok(!paved(F.s + (F.u[0] + F.w[0]) * 0.3, F.f + (F.u[1] + F.w[1]) * 0.3), `fillet at ${F.s},${F.f}: in an open corner`);
  }
  for (const B of BENDS) assert.ok(!paved(B.s + Math.cos((B.a0 + B.a1) / 2) * B.r * 0.7, B.f + Math.sin((B.a0 + B.a1) / 2) * B.r * 0.7), 'a bend paves what the straights leave open');
  assert.ok(LANDSIDE.edge === ROAD_END.s && ROAD_END.f > LANDSIDE.entry[0] && ROAD_END.f < LANDSIDE.entry[1], 'the entrance road ends where the access road starts');
  const w = { worldModules: [{ id: 'wm0', kind: 'airport', x: 0, z: 0, rot: 0, y: 1 }] };
  assert.equal(moduleBoxes(w).filter(b => b.label === 'a canopy column').length, LANDSIDE.columns.f.length);
});
