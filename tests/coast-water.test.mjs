// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// 2026-10-03 (screenshots): the city's straight shore met the island's coast in cliffs and square corners, and its
// road ran out over the sea round them; rivers floated above the ground beside them and waterfalls looked odd; lakes stood
// above lower ground next to them. The shore eases into the coast, the loop keeps to the land round every bay, and
// rivers' and lakes' water never stands above the ground at their banks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { makeGrid } from '../shared/city.js';
import { defaultIsland, Island, lakeShore } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { pointAt } from '../shared/roads.js';

const world = generateWorld({ seed: 'coast-water', nx: 3, nz: 3 }), g = makeGrid(world.grid);
world.terrain = defaultIsland({ seed: 'coast-water:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
const bare = new Island(world.terrain);

test('the straight shore south of the city eases into the coast: no cliff, no square corner', () => {
  const c = world.terrain.city;
  for (const x0 of [c.x0 - 900, c.x1 + 900]) for (let x = x0 - 1200; x <= x0 + 1200; x += 4) for (let z = c.z1 + 200; z < c.z1 + 1800; z += 25)
    assert.ok(Math.abs(bare.natural(x + 4, z) - bare.natural(x, z)) < 4, `a cliff at ${x}, ${z}`);
});

test("rivers' and lakes' water lies under the ground beside them", () => {
  for (const R of bare.rivers) for (let i = 1; i + 1 < R.pts.length; i++) {
    const a = R.pts[i - 1], q = R.pts[i], b = R.pts[i + 1], l = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
    if (R.drops.some(d => d.kind === 'cascade' ? i >= d.i && i < d.j : d.i === i)) continue;   // (a waterfall's lip, a cascade's steps: on the edge, beside them the rock falls away)
    for (const sd of [1, -1]) {
      // past its shallow shelf and the drawn water's edge
      const x = q.x + nx * sd * (q.w / 2 + 7), z = q.z + nz * sd * (q.w / 2 + 7), wat = bare.waterAt(x, z);
      if (wat?.kind === 'sea' || wat?.kind === 'lake' || (wat?.kind === 'river' && wat.id !== R.id)) continue;   // (water meeting water)
      const other = bare.riverAt(x, z); if (other && other.river !== R.id) continue;   // (a stream it meets: its shelf)
      assert.ok(bare.height(x, z) >= q.y - 0.3, `${R.id} stands above its bank at ${i}`);
    }
    assert.ok(q.y <= a.y, `${R.id} only falls`);
  }
  for (const k of bare.lakes) {
    if (k.frozen) continue;
    const oa = k.outlet ? Math.atan2(k.outlet.z - k.z, k.outlet.x - k.x) : null;
    for (let j = 0; j < 48; j++) {
      const an = j / 48 * Math.PI * 2; if (oa !== null && Math.abs(Math.atan2(Math.sin(an - oa), Math.cos(an - oa))) < 0.6) continue;
      const R = k.r * (k.tarn ? 1.38 : 1.32) * lakeShore(k, an), x = k.x + Math.cos(an) * R, z = k.z + Math.sin(an) * R, rv = bare.riverAt(x, z);
      if (rv && rv.d < rv.width / 2 + 8) continue;   // (a river flowing in or out: water meeting water)
      assert.ok(bare.height(x, z) >= k.level - 0.1, `${k.id}: the ground at its rim under its water`);
    }
  }
});

test('the island loop keeps to the land round every bay (no bridge over the sea)', () => {
  const roads = generateIslandRoads(bare, world.grid), I = new Island(world.terrain, { roads });
  const G = I.roads.net.geometry('isl-loop');
  for (const [a, b] of I.roads.spans.get('isl-loop') || []) for (let s = a + 8; s < b - 8; s += 6) {
    const q = pointAt(G, s, {}); assert.ok(I.baseHeight(q.x, q.z) >= I.p.seaLevel || I.riverAt(q.x, q.z) || I.lakes.some(k => Math.hypot(q.x - k.x, q.z - k.z) < k.r * 1.6), `the loop over the sea at ${Math.round(q.x)}, ${Math.round(q.z)}`);
  }
});
