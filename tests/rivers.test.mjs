// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.18 rivers (terrain island-v3): the same rivers everywhere from the seed, water that only flows downhill to the sea
// or a lake, a channel under the water that walkers and cars treat as water, roads crossing on causeways, never looping
// and never on the city's plain; waterfalls only at real drops.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultIsland, Island, TERRAIN_GENERATOR, SNOW_LINE } from '../shared/terrain.js';

const p = defaultIsland({ seed: 'rivers-test:island', city: { x0: -470, z0: -300, x1: 470, z1: 300 }, plainY: 0.1 });
test('rivers run downhill from the mountains to the sea or a lake, in a channel', () => {
  assert.equal(TERRAIN_GENERATOR, 'island-v3');
  const I = new Island(p), J = new Island(p);
  assert.deepEqual(I.rivers.map(r => r.pts.length), J.rivers.map(r => r.pts.length), 'deterministic');
  assert.ok(I.rivers.length >= 1, 'at least one river');
  for (const R of I.rivers) {
    assert.ok(R.mouth === 'sea' || I.lakes.some(k => k.id === R.mouth), `${R.id} ends at the sea or a lake`);
    for (let k = 1; k < R.pts.length; k++) assert.ok(R.pts[k].y <= R.pts[k - 1].y, `${R.id} flows downhill at ${k}`);
    for (let k = 0; k < R.pts.length; k += 3) for (let m = k + 1; m < R.pts.length; m += 3) if (R.pts[m].s - R.pts[k].s > 120) assert.ok(Math.hypot(R.pts[k].x - R.pts[m].x, R.pts[k].z - R.pts[m].z) > 50, `${R.id} never loops back`);   // (by distance along it: a cascade's steps are points a few metres apart)
    for (const q of R.pts) assert.ok(I.cityDist(q.x, q.z) > p.plainMargin, `${R.id} keeps off the city's plain`);
    for (const d of R.drops) assert.ok(R.pts[d.i].y - R.pts[d.j].y >= 6 && R.falls.includes(d.j), 'a waterfall is a real drop, from its lip to its foot');
    // under the water: a channel; on it: water; over it: a road's causeway
    for (let k = 2; k < R.pts.length - 2; k += 5) {
      const q = R.pts[k], h = I.height(q.x, q.z), w = I.waterAt(q.x, q.z);
      assert.ok(h < q.y - 0.4, `${R.id} channel below the water at ${k} (${h.toFixed(2)} < ${q.y.toFixed(2)})`);
      assert.ok(w && (w.kind === 'river' || w.kind === 'lake' || w.kind === 'sea'), `${R.id} is water at ${k}`);
      assert.ok(I.dryGround(q.x, q.z) >= q.y + 1.2, 'roads cross on a causeway');
    }
  }
});

test('every river rises from a tarn in a hollow high on its course; frozen above the snowline (2026-10-03)', () => {
  const I = new Island(p), tarns = I.lakes.filter(k => k.tarn);
  assert.ok(tarns.length >= 1 && tarns.length === I.rivers.length, 'a tarn for each river');
  for (const R of I.rivers) {
    const a = R.pts[0], t = tarns.find(k => Math.hypot(k.x - a.x, k.z - a.z) < k.r * 1.4);
    assert.ok(t, `${R.id} starts at a tarn's shore`);
    assert.ok(Math.abs(a.y - t.level) < 1e-6, `${R.id} leaves at the tarn's level`);
    for (let k = 1; k < R.pts.length; k++) assert.ok(R.pts[k].y <= R.pts[k - 1].y, `${R.id} still only falls`);
  }
  for (const t of tarns) {
    assert.equal(t.frozen, t.level > SNOW_LINE - 15);
    // a hollow: the mountain stands round it (its lip just above the water) except where the river leaves
    const outlets = I.rivers.map(R => R.pts[0]).filter(a => Math.hypot(t.x - a.x, t.z - a.z) < t.r * 1.4);
    for (let k = 0; k < 24; k++) {
      const an = k / 24 * Math.PI * 2, x = t.x + Math.cos(an) * t.r * 1.5, z = t.z + Math.sin(an) * t.r * 1.5;
      if (outlets.some(o => Math.hypot(o.x - x, o.z - z) < 40)) continue;
      assert.ok(I.height(x, z) >= t.level + 0.2, `${t.id}'s rim stands above its water`);
    }
    assert.ok(I.natural(t.x, t.z) > t.level - 6, `${t.id} lies in a hollow, not on a built-up mound`);
    // its middle: water to swim in, or ice to walk on, flat just under it
    if (t.frozen) { assert.equal(I.waterAt(t.x, t.z), null); assert.ok(Math.abs(I.height(t.x, t.z) - (t.level - 0.05)) < 1e-6); }
    else assert.equal(I.waterAt(t.x, t.z)?.kind, 'lake');
  }
});

test('waterfalls fall free from a lip into a plunge pool, cascades tumble down rock steps, and the river leaves the pool (2026-10-03)', () => {
  const I = new Island(p);
  let falls = 0, styles = new Set();
  for (const R of I.rivers) {
    let lastEnd = -Infinity;
    for (const d of R.drops) {
      const lip = R.pts[d.i], foot = R.pts[d.j], pool = I.lakes.find(k => k.id === d.pool);
      assert.ok(d.F >= 9 && d.F <= 160 && Math.abs(lip.y - foot.y - d.F) < 0.2, `${R.id}: a real drop (${d.F.toFixed(1)} m)`);
      assert.ok(pool && pool.pool && Math.abs(pool.level - foot.y) < 1e-6, `${R.id}: it falls into a pool at its foot`);
      for (let k = d.i + 1; k <= d.j; k++) assert.ok(R.pts[k].y <= R.pts[k - 1].y, `${R.id}: the water only falls`);
      if (d.kind === 'fall') {
        falls++; styles.add(d.style);
        assert.ok(d.F >= 30, 'a fall is a big drop; smaller ones are cascades');
        assert.equal(d.j, d.i + 1);
        assert.ok(Math.hypot(foot.x - lip.x, foot.z - lip.z) < 1, `${R.id}: the water falls straight down from its lip, not down a slope`);
        // the cliff: the ground well behind the lip up at the top of the fall, the pool reaching in under the cap rock,
        // deep where the fall lands, out from the lip
        assert.ok(I.height(lip.x - d.dx * 10, lip.z - d.dz * 10) > foot.y + d.F * 0.7, `${R.id}: the ground behind the lip is up at the top of the fall`);
        const ix = lip.x + d.dx * (d.ov + 2), iz = lip.z + d.dz * (d.ov + 2);
        assert.equal(I.waterAt(ix, iz)?.kind, 'lake', `${R.id}: the fall lands in its pool`);
        assert.ok(I.height(ix, iz) < pool.level - 1, `${R.id}: the pool is deep where the fall lands`);
      } else {
        assert.ok(d.F < 30 && d.steps >= 2, 'a cascade: a smaller drop, in steps');
        assert.ok(foot.s - lip.s >= d.F * 0.9, `${R.id}: a cascade tumbles down a slope of steps, not straight down`);
      }
      // the river leaves the pool at its level on a calm reach, at least 25 m long before the next drop
      const next = R.drops.find(e => e.i > d.i), end = next ? R.pts[next.i].s : Infinity;
      for (const q of R.pts) if (q.s > foot.s + pool.r * 2.1 && q.s <= end) { assert.ok(q.y <= pool.level && q.y >= pool.level - 0.02 * (q.s - foot.s) - 0.5, `${R.id}: the river leaves the pool on a calm reach`); break; }
      assert.ok(lip.s > lastEnd, `${R.id}: each drop a river's length below the last one's pool`);
      lastEnd = foot.s + pool.r * 2 + 24;
    }
  }
  assert.ok(falls >= 3 && styles.size >= 2, `big waterfalls on the mountain rivers, not all alike (${falls}, ${[...styles]})`);
});
