// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.1 road model: exact units, road types, straight/arc alignments, junctions at any angle, queries, and the
// conversion of today's grid city into alignments with the same centrelines (wp4-world-spec.md §3–4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { UM_PER_FT, ftToUm, mToUm, umToM, umToFt, parseLength, formatFt, formatSqFt, snapUmToFt } from '../shared/units.js';
import { DEFAULT_ROAD_PROFILES as P, makeProfile, resolveProfiles, RoadNetwork, alignmentGeometry, checkAlignment, pointAt, tangentAt, project, offsetPoint,
  samplePolyline, spotsAlong, intersectSegs, alignmentsFromGrid } from '../shared/roads.js';
import { makeGrid, blockRect, lotRect, AVENUES, STREETS } from '../shared/city.js';
import { SIDEWALK } from '../shared/constants.js';

const ft = ftToUm, m = mToUm, near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const road = (id, pts, profile = 'two-lane', extra = {}) => ({ id, profile, pts: pts.map(([x, z, r]) => (r ? { x: ft(x), z: ft(z), r: ft(r) } : { x: ft(x), z: ft(z) })), ...extra });
const net = (...roads) => { const n = new RoadNetwork(); for (const r of roads) n.set(r); return n; };
const kinds = n => n.junctions().map(j => j.kind).sort().join(',');

test('units: feet and metres convert to whole micrometres without drift, and typed lengths parse', () => {
  assert.equal(UM_PER_FT, 304800);
  for (const f of [0.01, 12, 12.34, 1320, 20000.99, -7.25]) assert.equal(umToFt(ftToUm(f)), f);
  for (const v of [64, 14, 4.5, -331.17, 16.65, 0.000001]) assert.equal(umToM(mToUm(v)), v);
  assert.equal(parseLength('12'), ft(12));
  assert.equal(parseLength("12' 6\""), ft(12.5));
  assert.equal(parseLength('12 ft'), ft(12));
  assert.equal(parseLength('3.5 m'), m(3.5));
  assert.equal(parseLength('abc'), null);
  // The storage quantum is 1 µm: hundredths of a foot and eighths of an inch are exact; finer values round to the
  // nearest micrometre (at most 0.5 µm), as declared in shared/units.js.
  assert.equal(ftToUm(0.01), 3048); assert.equal(parseLength('0\' 0.125"'), 3175);
  assert.equal(ftToUm(0.001), 305); assert.equal(ftToUm(0.0001), 30);
  for (const f of [0.0001, 0.001, 12.3456, 1 / 16 / 12]) assert.ok(Math.abs(ftToUm(f) - f * UM_PER_FT) <= 0.5, `${f} ft within 0.5 µm`);
  assert.equal(formatFt(ft(1320)), '1,320 ft');
  assert.equal(formatFt(ft(12.5)), '12.5 ft');
  assert.equal(formatSqFt(BigInt(ft(50)) * BigInt(ft(100))), '5,000 sq ft');
  assert.equal(snapUmToFt(ft(12.4)), ft(12));
  assert.throws(() => mToUm(1e7), RangeError);
});

test('road types: classic two-lane profiles are 23.2 ft and 33.2 ft to the back of the sidewalk; the avenue matches today\'s city', () => {
  assert.equal(P['two-lane'].outerHalf, ft(23.2));
  assert.equal(P['two-lane'].carriageHalf, ft(14));
  assert.equal(P['two-lane-shoulder'].outerHalf, ft(33.2));
  assert.equal(P['city-14'].carriageHalf, m(7));
  assert.equal(P['city-14'].outerHalf, m(7 + SIDEWALK));
  assert.ok(Object.isFrozen(P['two-lane']) && Object.isFrozen(P['two-lane'].lanes));
  assert.throws(() => makeProfile({ id: 'bad', carriageHalf: ft(5), lanes: [{ offset: ft(6), width: ft(12) }] }), /wider than the roadway/);
  const custom = resolveProfiles({ lane1: { label: 'Country lane', carriageHalf: ft(9), sidewalk: 0, lanes: [{ offset: ft(4.5), width: ft(9) }] } });
  assert.equal(custom.lane1.outerHalf, ft(9));
  assert.ok(custom['two-lane'], 'defaults stay available');
});

test('a corner with a fillet radius becomes a tangent arc: exact length, smooth direction, every point on the curve', () => {
  const r = 200, al = road('a', [[0, 0], [1000, 0, r], [1000, 1000]]);
  const g = alignmentGeometry(al);
  assert.deepEqual(g.segs.map(s => s.type), ['line', 'arc', 'line']);
  const R = r * 0.3048, L = 1000 * 0.3048;
  assert.ok(near(g.length, 2 * (L - R) + R * Math.PI / 2, 1e-9), `length ${g.length}`);
  const arc = g.segs[1];
  for (const s of [arc.s0, arc.s0 + arc.len / 3, arc.s0 + arc.len]) { const p = pointAt(g, s); assert.ok(near(Math.hypot(p.x - arc.cx, p.z - arc.cz), R, 1e-9)); }
  for (const s of [arc.s0, arc.s0 + arc.len]) {
    const a = tangentAt(g, s, true), b = tangentAt(g, s, false);
    assert.ok(near(a.dx, b.dx, 1e-9) && near(a.dz, b.dz, 1e-9), 'tangent-continuous at both ends of the arc');
  }
  const sharp = alignmentGeometry(road('b', [[0, 0], [1000, 0], [1000, 1000]]));
  const before = tangentAt(sharp, 1000 * 0.3048, true), after = tangentAt(sharp, 1000 * 0.3048, false);
  assert.ok(near(before.dx, 1) && near(after.dz, 1), 'a radius-0 point is a sharp joint');
});

test('bad alignments are refused with plain reasons', () => {
  assert.match(checkAlignment(road('a', [[0, 0]]))[0].message, /at least two points/);
  assert.match(checkAlignment(road('a', [[0, 0], [0, 0]]))[0].message, /same place/);
  assert.match(checkAlignment(road('a', [[0, 0], [100, 0, 400], [100, 100]]))[0].message, /don't fit/);
  assert.match(checkAlignment(road('a', [[0, 0], [1000, 0, 10], [1000, 1000]]))[0].message, /too tight/);
  assert.match(checkAlignment(road('a', [[0, 0], [1000, 0], [0, 1]]))[0].message, /turns back/);
  assert.match(checkAlignment(road('a', [[0, 0], [10, 0]], 'nope'))[0].message, /Unknown road type/);
  assert.match(checkAlignment({ id: 'a', profile: 'two-lane', pts: [{ x: 0.5, z: 0 }, { x: 10, z: 0 }] })[0].message, /not a valid position/);
  assert.throws(() => new RoadNetwork().set(road('a', [[0, 0]])), e => e.problems.length === 1);
});

test('junctions form at any angle: X, T, Y, turn, joint and dead ends, sized by the widest road', () => {
  assert.equal(kinds(net(road('a', [[-500, 0], [500, 0]]), road('b', [[0, -500], [0, 500]]))), 'X,end,end,end,end');
  const skew = net(road('a', [[-500, 0], [500, 0]]), road('b', [[-300, -400], [300, 400]], 'two-lane-shoulder'));
  const x = skew.junctions().find(j => j.kind === 'X');
  assert.ok(near(x.x, 0) && near(x.z, 0));
  assert.equal(x.outerHalf, P['two-lane-shoulder'].outerHalf, 'sized to the widest road');
  assert.equal(kinds(net(road('a', [[-500, 0], [500, 0]]), road('b', [[0, 0], [0, 500]]))), 'T,end,end,end');
  const y = net(road('a', [[0, 0], [500, 0]]), road('b', [[0, 0], [-250, 433]]), road('c', [[0, 0], [-250, -433]]));
  assert.equal(kinds(y), 'Y,end,end,end');
  assert.equal(kinds(net(road('a', [[0, 0], [500, 0]]), road('b', [[0, 0], [0, 500]]))), 'end,end,turn');
  assert.equal(kinds(net(road('a', [[0, 0], [500, 0]]), road('b', [[500, 0], [900, 20]]))), 'end,end,joint');
  const ab = net(road('a', [[-500, 0], [500, 0]]), road('b', [[-500, 300], [500, 300]]));
  assert.equal(ab.junctions().filter(j => j.kind === 'end').length, 4);
  assert.equal(kinds(net(road('a', [[-500, 0], [500, 0]]), road('b', [[0, -500], [0, 500]]), road('c', [[-400, -400], [400, 400]]))), 'end,end,end,end,end,end,multi');
});

test('a curved road crossing a straight one makes two crossings; junction arms point along each road', () => {
  const n = net(road('curve', [[-600, -300], [0, 300, 500], [600, -300]]), road('line', [[-800, 0], [800, 0]]));
  const X = n.junctions().filter(j => j.kind === 'X');
  assert.equal(X.length, 2);
  for (const j of X) {
    assert.equal(j.arms.length, 4);
    const a = j.arms.filter(a => a.id === 'line');
    assert.ok(a.every(arm => near(Math.abs(arm.dirX), 1, 1e-9)), 'the straight road\'s arms run along x');
    const c = j.arms.filter(a => a.id === 'curve');
    assert.ok(near(c[0].dirX, -c[1].dirX, 1e-9) && near(c[0].dirZ, -c[1].dirZ, 1e-9), 'the curve\'s two arms are opposite');
  }
  assert.ok(near(X[0].z, 0, 1e-9) && near(X[1].z, 0, 1e-9));
});

test('arc against arc: two curves crossing, and overlapping roads are reported', () => {
  const a = { type: 'arc', cx: 0, cz: 0, r: 100, a0: 0, sweep: Math.PI, len: 100 * Math.PI, s0: 0, ax: 100, az: 0, bx: -100, bz: 0 };
  const b = { type: 'arc', cx: 100, cz: 0, r: 100, a0: Math.PI / 2, sweep: Math.PI, len: 100 * Math.PI, s0: 0, ax: 100, az: 100, bx: 100, bz: -100 };
  const hit = intersectSegs(a, b);
  assert.equal(hit.length, 1);
  assert.ok(near(hit[0].x, 50, 1e-9) && near(hit[0].z, Math.sqrt(3) * 50, 1e-9));
  const same = { ...a, a0: Math.PI / 2, ax: 0, az: 100 };
  assert.equal(intersectSegs(a, same).overlap, true);
  const n = net(road('a', [[0, 0], [1000, 0]]), road('b', [[500, 0], [1500, 0]]));
  assert.deepEqual(n.validate().map(p => p.code), ['overlap']);
});

test('queries: nearest road, signed offsets, sidewalk lines and evenly spaced spots', () => {
  const n = net(road('a', [[0, 0], [1000, 0, 300], [1000, 1000]]));
  const g = n.geometry('a');
  const p = n.nearest(500 * 0.3048, 20 * 0.3048);
  assert.equal(p.id, 'a');
  assert.ok(near(p.dist, 20 * 0.3048, 1e-9) && near(p.offset, 20 * 0.3048, 1e-9), 'positive offset on the (−dz, dx) side');
  const back = umToM(P['two-lane'].outerHalf), line = samplePolyline(g, back, { maxErr: 0.001 });
  for (const q of line) assert.ok(near(Math.abs(project(g, q.x, q.z).offset), back, 0.002), 'sidewalk back edge stays at its offset on the curve too');
  const spots = spotsAlong(g, -10, 30, { startPad: 15, endPad: 15 });
  for (let i = 1; i < spots.length; i++) assert.ok(near(spots[i].s - spots[i - 1].s, spots[1].s - spots[0].s, 1e-9));
  assert.ok(spots.every(s => near(project(g, s.x, s.z).offset, -10, 1e-6)));
  const o = offsetPoint(g, 0, 5);
  assert.ok(near(o.x, 0) && near(o.z, 5));
});

test('footprints: clear of every road when outside the corridor, refused when they reach the sidewalk', () => {
  const n = net(road('a', [[-500, 0], [500, 0]]));
  const half = umToM(P['two-lane'].outerHalf), sq = (x0, z0, x1, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
  assert.deepEqual(n.corridorHits(sq(-10, half, 10, half + 20)), [], 'touching the back of the sidewalk is allowed');
  assert.equal(n.corridorHits(sq(-10, half - 0.01, 10, half + 20)).length, 1);
  assert.equal(n.corridorHits(sq(-10, -5, 10, 5))[0].dist, 0, 'a footprint across the road');
  const curve = net(road('c', [[0, 0], [1000, 0, 300], [1000, 1000]]));
  const g = curve.geometry('c'), arc = g.segs[1], mid = pointAt(g, arc.s0 + arc.len / 2);
  const out = { x: mid.x + (mid.x - arc.cx) / arc.r * (half + 1), z: mid.z + (mid.z - arc.cz) / arc.r * (half + 1) };
  assert.deepEqual(curve.corridorHits(sq(out.x - 0.5, out.z - 0.5, out.x + 0.5, out.z + 0.5)), [], 'outside the curve');
  const inn = { x: mid.x + (mid.x - arc.cx) / arc.r * (half - 0.5), z: mid.z + (mid.z - arc.cz) / arc.r * (half - 0.5) };
  assert.equal(curve.corridorHits(sq(inn.x - 0.2, inn.z - 0.2, inn.x + 0.2, inn.z + 0.2)).length, 1, 'on the sidewalk of the curve');
});

test("today's grid converts to alignments on the same centrelines: 48 X, 28 T and 4 corner turns, sidewalks meeting the lots", () => {
  const spec = { nx: 9, nz: 7, bw: 64, bd: 52, road: 14 };
  const g = makeGrid(spec), recs = alignmentsFromGrid(spec, { names: { avenues: AVENUES, streets: STREETS } });
  assert.equal(recs.length, 18);
  for (let i = 0; i <= 9; i++) { const r = recs.find(x => x.id === `grid-a${i}`); assert.equal(umToM(r.pts[0].x), g.X[i]); assert.equal(r.name, AVENUES[i]); }
  for (let j = 0; j <= 7; j++) { const r = recs.find(x => x.id === `grid-s${j}`); assert.equal(umToM(r.pts[0].z), g.Z[j]); assert.equal(r.name, STREETS[j]); }
  const n = RoadNetwork.fromJSON(recs);
  const J = n.junctions(), count = k => J.filter(j => j.kind === k).length;
  assert.equal(count('X'), 48); assert.equal(count('T'), 28); assert.equal(count('turn'), 4); assert.equal(J.length, 80);
  assert.deepEqual(n.validate(), []);
  for (const [i, j] of [[0, 0], [4, 3], [8, 6]]) {
    const b = blockRect(g, i, j), l = lotRect(g, i, j);
    assert.equal(n.nearest(b.x0, (b.z0 + b.z1) / 2).dist, g.hr, 'block edge = curb face');
    assert.ok(near(n.nearest(l.x0, (l.z0 + l.z1) / 2).dist, umToM(P['city-14'].outerHalf), 1e-9), 'lot edge = back of sidewalk');
    const lot = [{ x: l.x0, z: l.z0 }, { x: l.x1, z: l.z0 }, { x: l.x1, z: l.z1 }, { x: l.x0, z: l.z1 }];
    assert.deepEqual(n.corridorHits(lot), [], 'every lot is clear of the road corridors');
  }
  const again = RoadNetwork.fromJSON(JSON.parse(JSON.stringify(n.toJSON())));
  assert.deepEqual(again.toJSON(), n.toJSON(), 'save and reload round-trips exactly');
  assert.deepEqual(again.junctions().map(j => j.key), J.map(j => j.key));
});

test('fuzz: random straight roads produce one junction per crossing and stay consistent after deletes', () => {
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let round = 0; round < 20; round++) {
    const n = new RoadNetwork(), recs = [];
    for (let k = 0; k < 12; k++) {
      const a = [Math.round(rnd() * 4000 - 2000), Math.round(rnd() * 4000 - 2000)], ang = rnd() * Math.PI, L = 500 + rnd() * 2500;
      const r = road(`r${k}`, [a, [Math.round(a[0] + Math.cos(ang) * L), Math.round(a[1] + Math.sin(ang) * L)]]);
      try { n.set(r); recs.push(r); } catch { /* skip degenerate */ }
    }
    let crossings = 0;
    const G = recs.map(r => n.geometry(r.id));
    for (let i = 0; i < G.length; i++) for (let j = i + 1; j < G.length; j++) crossings += intersectSegs(G[i].segs[0], G[j].segs[0]).length;
    const J = n.junctions().filter(j => j.kind !== 'end');
    const pairs = J.reduce((s, j) => s + (new Set(j.arms.map(a => a.id)).size * (new Set(j.arms.map(a => a.id)).size - 1)) / 2, 0);
    assert.equal(pairs, crossings, `round ${round}`);
    const gone = recs.splice(0, 3);
    for (const r of gone) n.delete(r.id);
    const fresh = RoadNetwork.fromJSON(recs);
    assert.deepEqual(n.junctions().map(j => j.key), fresh.junctions().map(j => j.key), 'deleting gives the same network as building without');
  }
});
