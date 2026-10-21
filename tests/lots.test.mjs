// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.13 exact lot geometry and lot rules: areas, overlaps (incl. the tricky touching cases), side-to-side merges up
// to 4 lots, unmerge, platting at the 100 × 100 ft standard, and partition checks (wp4-world-spec.md §5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ftToUm } from '../shared/units.js';
import { DEFAULT_LOT_POLICY as POL, area, area2, normalize, samePolygon, overlaps, contains, isSimple, isRectangle, unionLots, checkMerge, checkUnmerge,
  platRectangle, checkPartition, classifyPoint } from '../shared/lots.js';

const F = ftToUm;
const rect = (x0, z0, x1, z1) => [{ x: F(x0), z: F(z0) }, { x: F(x1), z: F(z0) }, { x: F(x1), z: F(z1) }, { x: F(x0), z: F(z1) }];
const me = { kind: 'account', id: 'u1' }, other = { kind: 'account', id: 'u2' };
const lot = (id, poly, extra = {}) => ({ id, poly, holder: me, zoning: 'res', lifecycle: 'owned', origins: 1, ...extra });
const grid = (cols, rows) => { const out = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(lot(`L${c}_${r}`, rect(c * 100, r * 100, c * 100 + 100, r * 100 + 100))); return out; };

test('standard lot is 100 × 100 ft and its area is exactly 10,000 sq ft', () => {
  assert.equal(POL.standardLotW, F(100));
  const a = area(rect(0, 0, 100, 100));
  assert.equal(a.twice, 2n * BigInt(F(100)) * BigInt(F(100)));
  assert.equal(a.sqft, 10000);
  assert.equal(POL.maxMergeLots, 4);
});

test('normalize gives one canonical form: counter-clockwise, no repeats or collinear corners, smallest corner first', () => {
  const p = [{ x: 10, z: 0 }, { x: 10, z: 10 }, { x: 10, z: 10 }, { x: 0, z: 10 }, { x: 0, z: 0 }, { x: 5, z: 0 }];
  assert.deepEqual(normalize(p), [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }]);
  assert.ok(samePolygon(p, [...p].reverse()));
  assert.ok(area2(normalize(p)) > 0n);
  assert.throws(() => normalize([{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 2 }]), /no area/);
  assert.throws(() => normalize([{ x: 0.5, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }]), /whole micrometres/);
});

test('overlap is exact: shared sides and corners are not overlaps; crossing, nesting and identical lots are', () => {
  const a = rect(0, 0, 100, 100);
  assert.equal(overlaps(a, rect(100, 0, 200, 100)), false, 'side by side');
  assert.equal(overlaps(a, rect(100, 100, 200, 200)), false, 'corner to corner');
  assert.equal(overlaps(a, rect(100, 50, 200, 150)), false, 'part of a side');
  assert.equal(overlaps(a, rect(300, 300, 400, 400)), false, 'apart');
  assert.equal(overlaps(a, rect(50, 50, 150, 150)), true, 'crossing');
  assert.equal(overlaps(a, rect(25, 25, 75, 75)), true, 'nested inside');
  assert.equal(overlaps(a, rect(0, 0, 100, 50)), true, 'inside, sharing three sides');
  assert.equal(overlaps(a, a), true, 'identical');
  const diamond = [{ x: F(50), z: F(-50) }, { x: F(150), z: F(50) }, { x: F(50), z: F(150) }, { x: F(-50), z: F(50) }];
  assert.equal(overlaps(a, diamond), true, 'corners on each other\'s sides');
  assert.equal(overlaps(rect(0, 0, 100, 100), [{ x: F(100), z: F(0) }, { x: F(200), z: F(-100) }, { x: F(200), z: F(100) }]), false, 'a triangle touching at one corner');
  assert.equal(overlaps(a, rect(99.99, 0, 200, 100)), true, 'one hundredth of a foot in');
  assert.equal(overlaps(a, [{ x: F(0.0001), z: F(-1) }, { x: F(1), z: F(-1) }, { x: F(1), z: F(0) }, { x: F(0.0001), z: F(0) }]), false, 'sub-µm-exact neighbour below');
});

test('point classification and containment are exact at the boundary', () => {
  const a = rect(0, 0, 100, 100);
  assert.equal(classifyPoint(BigInt(F(100)), BigInt(F(50)), 1n, a), 'boundary');
  assert.equal(classifyPoint(BigInt(F(100)) * 3n - 1n, BigInt(F(50)) * 3n, 3n, a), 'inside', 'a third of a µm inside');
  assert.ok(contains(a, rect(0, 0, 50, 100)));
  assert.ok(!contains(a, rect(50, 50, 150, 100)));
  const L = [{ x: 0, z: 0 }, { x: F(200), z: 0 }, { x: F(200), z: F(100) }, { x: F(100), z: F(100) }, { x: F(100), z: F(200) }, { x: 0, z: F(200) }];
  assert.ok(!contains(L, rect(50, 50, 150, 150)), 'a square across the notch of an L');
  assert.ok(isSimple(L) && !isSimple([{ x: 0, z: 0 }, { x: 10, z: 10 }, { x: 10, z: 0 }, { x: 0, z: 10 }]));
});

test('merging side to side: rows of 2–4 and a 2 × 2 square are allowed; the merged lot is the exact outline', () => {
  const g = grid(4, 2);
  const row2 = checkMerge([g[0], g[1]], { actor: me });
  assert.ok(row2.ok, JSON.stringify(row2.problems));
  assert.ok(samePolygon(row2.merged.poly, rect(0, 0, 200, 100)));
  assert.equal(row2.merged.origins, 2);
  assert.equal(row2.merged.areaTwice, area2(rect(0, 0, 200, 100)));
  assert.ok(checkMerge([g[0], g[1], g[2], g[3]], { actor: me }).ok, '1 × 4 row');
  const sq = checkMerge([g[0], g[1], g[4], g[5]], { actor: me });
  assert.ok(sq.ok && samePolygon(sq.merged.poly, rect(0, 0, 200, 200)), '2 × 2');
  assert.ok(isRectangle(sq.merged.poly));
});

test('merging is refused for: more than 4 lots, an L shape, corner-only contact, gaps, another holder, mixed zoning, leases', () => {
  const g = grid(4, 2), codes = r => r.problems.map(p => p.code);
  assert.deepEqual(codes(checkMerge([g[0], g[1], g[2], g[3], g[4]], { actor: me })), ['limit', 'shape']);
  assert.deepEqual(codes(checkMerge([g[0], g[1], g[4]], { actor: me })), ['shape'], 'L shape under the rectangle rule');
  assert.ok(checkMerge([g[0], g[1], g[4]], { actor: me, policy: { ...POL, mergeShapes: 'any' } }).ok, 'L shape allowed by policy');
  assert.deepEqual(codes(checkMerge([g[0], g[5]], { actor: me })), ['apart'], 'only a corner touches');
  assert.deepEqual(codes(checkMerge([g[0], g[2]], { actor: me })), ['apart'], 'a gap between');
  assert.deepEqual(codes(checkMerge([g[0], { ...g[1], holder: other }], { actor: me })), ['holder']);
  assert.deepEqual(codes(checkMerge([g[0], g[1]], { actor: other })), ['rights']);
  assert.deepEqual(codes(checkMerge([g[0], { ...g[1], zoning: 'com' }], { actor: me })), ['zoning']);
  assert.deepEqual(codes(checkMerge([g[0], { ...g[1], lifecycle: 'leased' }], { actor: me })), ['state']);
  assert.deepEqual(codes(checkMerge([g[0], { ...g[1], encumbrances: ['listing:7'] }], { actor: me })), ['state']);
  const two = { ...lot('M', rect(0, 0, 200, 100)), origins: 2 }, three = { ...lot('N', rect(200, 0, 500, 100)), origins: 3 };
  assert.deepEqual(codes(checkMerge([two, three], { actor: me })), ['limit'], 'the limit counts original lots through earlier merges');
  assert.ok(checkMerge([two, three], { actor: me, admin: true }).ok, 'administrators plat without the holder limit');
  assert.deepEqual(codes(checkMerge([g[0], g[0]], { actor: me })), ['count', 'overlap']);
});

test('a ring of lots around another lot can\'t be merged into one outline (it would enclose land)', () => {
  const ring = [], admin = true;
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) if (!(c === 1 && r === 1)) ring.push(lot(`R${c}${r}`, rect(c * 100, r * 100, c * 100 + 100, r * 100 + 100)));
  const res = checkMerge(ring, { actor: me, admin });
  assert.deepEqual(res.problems.map(p => p.code), ['hole']);
});

test('unmerge restores exactly the original lots, unless a building now crosses an original line', () => {
  const g = grid(2, 1), m = checkMerge(g, { actor: me }).merged, merged = { ...lot('M', m.poly), origins: 2 };
  assert.ok(checkUnmerge(merged, g.map(l => l.poly), [rect(10, 10, 90, 90), rect(110, 10, 190, 90)], { actor: me }).ok);
  const r = checkUnmerge(merged, g.map(l => l.poly), [rect(50, 10, 150, 90)], { actor: me });
  assert.deepEqual(r.problems.map(p => p.code), ['building']);
  assert.deepEqual(checkUnmerge(merged, [g[0].poly, rect(100, 0, 210, 100)], [], { actor: me }).problems.map(p => p.code), ['lineage']);
  assert.deepEqual(checkUnmerge(merged, g.map(l => l.poly), [], { actor: other }).problems.map(p => p.code), ['rights']);
});

test('platting: a 200 × 400 ft block gives 2 × 4 standard lots; odd sizes stay as close to 100 ft as possible and cover exactly', () => {
  const block = { x0: 0, z0: 0, x1: F(200), z1: F(400) }, lots = platRectangle(block);
  assert.equal(lots.length, 8);
  assert.ok(lots.every(p => isRectangle(p) && area(p).sqft === 10000));
  const odd = { x0: F(-90.2), z0: F(-70.55), x1: F(90.2), z1: F(70.55) }, oddLots = platRectangle(odd);
  assert.equal(oddLots.length, 2, '180.4 × 141.1 ft → 2 columns × 1 row');
  const ids = oddLots.map((p, i) => ({ id: `o${i}`, poly: p }));
  assert.deepEqual(checkPartition(ids, { region: [{ x: odd.x0, z: odd.z0 }, { x: odd.x1, z: odd.z0 }, { x: odd.x1, z: odd.z1 }, { x: odd.x0, z: odd.z1 }] }), []);
  const q = platRectangle(odd, { cols: 2, rows: 2 });
  assert.equal(q.length, 4, 'an explicit 2 × 2 (quarters) for the original city');
  const awkward = { x0: 0, z0: 0, x1: 1_000_003, z1: 999_997 }, a = platRectangle(awkward, { cols: 3, rows: 3 });
  const widths = new Set(a.map(p => p[1].x - p[0].x));
  assert.ok([...widths].every(w => Math.abs(w - 333_334) <= 1), 'parts differ by at most 1 µm');
  assert.equal(a.reduce((s, p) => s + area2(p), 0n), BigInt(1_000_003) * BigInt(999_997) * 2n, 'covers the rectangle exactly');
});

test('partition check finds overlaps, lots outside the region and gaps', () => {
  const region = rect(0, 0, 200, 100), A = { id: 'A', poly: rect(0, 0, 100, 100) }, Bl = { id: 'B', poly: rect(100, 0, 200, 100) };
  assert.deepEqual(checkPartition([A, Bl], { region }), []);
  assert.deepEqual(checkPartition([A, { id: 'B', poly: rect(90, 0, 200, 100) }], { region }).map(p => p.code), ['overlap']);
  assert.deepEqual(checkPartition([A], { region }).map(p => p.code), ['cover']);
  assert.deepEqual(checkPartition([A], { region, publicAreas: [rect(100, 0, 200, 100)] }), []);
  assert.deepEqual(checkPartition([A, { id: 'C', poly: rect(150, 0, 250, 100) }], { region }).map(p => p.code), ['outside'], 'coverage is judged once lots are inside');
});

test('fuzz: random merges and unmerges on a platted region never gain or lose a µm² and never overlap', () => {
  let seed = 7; const rnd = n => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  const cols = 6, rows = 4, region = rect(0, 0, cols * 100, rows * 100);
  let lots = grid(cols, rows), originals = new Map(lots.map(l => [l.id, [l.poly]]));
  const total = area2(normalize(region));
  for (let step = 0; step < 300; step++) {
    if (rnd(3) && lots.length > 1) {
      const a = lots[rnd(lots.length)], b = lots.filter(l => l !== a && unionOk(a, l))[0];
      if (!b) continue;
      const res = checkMerge([a, b], { actor: me, policy: { ...POL, mergeShapes: 'any' } });
      if (!res.ok) { assert.ok(res.problems.every(p => ['limit', 'hole'].includes(p.code)), JSON.stringify(res.problems)); continue; }
      const id = `${a.id}+${b.id}`;
      originals.set(id, [...originals.get(a.id), ...originals.get(b.id)]);
      lots = lots.filter(l => l !== a && l !== b).concat({ ...lot(id, res.merged.poly), origins: res.merged.origins });
    } else {
      const m = lots.find(l => l.origins > 1);
      if (!m) continue;
      assert.ok(checkUnmerge(m, originals.get(m.id), [], { actor: me }).ok);
      lots = lots.filter(l => l !== m).concat(originals.get(m.id).map((p, i) => lot(`${m.id}/${i}`, p)));
      originals.delete(m.id);
      for (const l of lots.slice(-originals.size)) if (!originals.has(l.id)) originals.set(l.id, [l.poly]);
    }
    assert.ok(lots.every(l => l.origins <= POL.maxMergeLots));
    assert.equal(lots.reduce((s, l) => s + area2(normalize(l.poly)), 0n), total, `step ${step}: area conserved`);
  }
  assert.deepEqual(checkPartition(lots, { region }), [], 'the final lots still partition the region exactly');
  function unionOk(a, b) { try { unionLots([a.poly, b.poly]); return true; } catch { return false; } }
});
