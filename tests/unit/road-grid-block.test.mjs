// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// "Fill this block" (shared/road-grid.js blockRuns; 2026-10-14, the product owner: lots taken away from one block of a
// grid put back like the rest): from a built grid's roads, the block beside a road is filled with exactly the runs the
// grid tool made for it - the rows along the roads its lots face (whichever the clicked road is), the rows between along
// the others - at any turn of the grid; a road that isn't a grid's, or a side with no block, gives nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { gridLayout, blockRuns } from '../../shared/road-grid.js';

const FT = 0.3048;
/** A built grid: the plan's roads with their ids, and the lots the tool made (their frontage roads only). */
function built(o) {
  const plan = gridLayout({ c: { x: 2000, z: -1500 }, profile: 'avenue-4', name: 'Town', level: 12, grid: 'grid-t', ...o });
  const roads = plan.roads.map((r, i) => ({ ...r, id: `road-${100 + i}` }));
  const runs = plan.runs.map(r => ({ ...r, road: roads[r.road].id }));
  const lots = runs.flatMap(r => Array.from({ length: r.count }, () => ({ frontage: [{ road: r.road, side: r.side }] })));
  return { plan, roads, runs, lots };
}
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.02, `${what}: ${a} vs ${b}`);
const same = (got, want) => {
  const k = r => `${r.road}:${r.side}`;
  assert.deepEqual(got.map(k).sort(), want.map(k).sort());
  for (const g of got) { const w = want.find(x => k(x) === k(g)); near(g.from, w.from, `${k(g)} from`); near(g.to, w.to, `${k(g)} to`); assert.equal(g.count, w.count); assert.equal(g.even, true); }
};
/** The grid tool's runs for block (i, j) of a plan with ns avenues and ew streets. */
const blockOf = (B, i, j) => {
  const { ns } = B.plan, st = [B.roads[ns + j].id, B.roads[ns + j + 1].id], av = [B.roads[i].id, B.roads[i + 1].id];
  const per = B.plan.runs.length / ((ns - 1) * (B.plan.ew - 1)), k = (i * (B.plan.ew - 1) + j) * per;   // (the plan lists runs block by block)
  const want = B.runs.slice(k, k + per);
  assert.ok(want.every(r => [...st, ...av].includes(r.road)));
  return want;
};
/** Where along road id a block's middle is (its station), from the grid tool's own run on it. */
const midOn = (runs, id) => { const r = runs.find(x => x.road === id); return (r.from + r.to) / 2; };

test('a block of 3 × 2 lots of 100 ft: clicked from its street on either side, or from its avenue, the same six lots as the grid tool made', () => {
  for (const rot of [0, 30, -73]) {
    const B = built({ ns: 5, ew: 4, lotsX: 3, lotsZ: 2, lotFt: 100, rot });
    for (const [i, j] of [[0, 0], [2, 1], [3, 2]]) {
      const want = blockOf(B, i, j), a = want[0], b = want[1];
      for (const click of [a, b]) {
        const got = blockRuns(B.roads, click.road, click.side, midOn(want, click.road), { width: 100 * FT, depth: 100 * FT, lots: B.lots });
        assert.ok(got, `block ${i},${j} at ${rot}°`);
        same(got.runs, want); assert.deepEqual([got.lx, got.lz], [3, 2]); near(got.depth, B.plan.lot.d, 'depth');
      }
      // from its avenue (avenue i + 1, its side a facing the block; the block's middle along it): the same lots, facing the
      // streets as the rest of the grid's do
      const sz = B.plan.D / (B.plan.ew - 1), fromAvenue = blockRuns(B.roads, B.roads[i + 1].id, 'a', (j + 0.5) * sz, { width: 100 * FT, depth: 100 * FT, lots: B.lots });
      assert.ok(fromAvenue, 'from its avenue'); same(fromAvenue.runs, want);
    }
  }
});

test('three rows deep: the rows between run along the avenues, as the grid tool makes them', () => {
  const B = built({ ns: 3, ew: 3, lotsX: 3, lotsZ: 4, lotFt: 80 });
  const want = blockOf(B, 1, 1), a = want[0];
  const got = blockRuns(B.roads, a.road, a.side, midOn(want, a.road), { width: 80 * FT, depth: 80 * FT, lots: B.lots });
  same(got.runs, want); assert.deepEqual([got.lx, got.lz], [3, 4]);
});

test("with no lots in the grid the clicked road's rows lead; not a grid road or no block there: nothing", () => {
  const B = built({ ns: 3, ew: 3, lotsX: 3, lotsZ: 2, lotFt: 100 });
  const want = blockOf(B, 0, 0), a = want[0];
  const got = blockRuns(B.roads, a.road, a.side, midOn(want, a.road), { width: 100 * FT, depth: 100 * FT, lots: [] });
  same(got.runs, want);
  // the outer side of an edge street: no block there
  const edge = B.roads[B.plan.ns].id;
  const outer = a.road === edge ? (a.side === 'a' ? 'b' : 'a') : null;
  if (outer) assert.equal(blockRuns(B.roads, edge, outer, midOn(want, edge), { width: 100 * FT, depth: 100 * FT, lots: B.lots }), null);
  const plain = [...B.roads.map(r => ({ ...r })), { id: 'road-x', profile: 'avenue-4', pts: [{ x: 0, z: 0 }, { x: 5e8, z: 0 }] }];
  assert.equal(blockRuns(plain, 'road-x', 'a', 100, { width: 30, depth: 30 }), null, "not a grid's");
});
