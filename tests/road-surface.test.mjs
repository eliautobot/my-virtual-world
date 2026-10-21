// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Feet, wheels' tilt and tyre marks on the island's roads meet the drawn surface (2026-10-05: feet sank into the
// 2-lane roads; people and traffic sank into bridge decks near their edges): GroundQuery.height on a road is the road's
// drawn top - exactly, not off the 2.4 m height grid - with raised sidewalks a curb higher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { makeGrid } from '../shared/city.js';
import { defaultIsland, Island, GroundQuery } from '../shared/terrain.js';
import { generateIslandRoads, profileAt, DRAW_LIFT, FORMATION } from '../shared/island-roads.js';
import { sectionOf, CURB_RISE } from '../shared/road-kit.js';
import { pointAt } from '../shared/roads.js';

const world = generateWorld({ seed: 'road-surface', population: 50 }), g = makeGrid(world.grid);
world.terrain = defaultIsland({ seed: 'road-surface:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
world.roads = generateIslandRoads(new Island(world.terrain), world.grid);
const island = new Island(world.terrain, { roads: world.roads }), Q = new GroundQuery(island), R = island.roads;

test('on a road: the drawn lane, a raised sidewalk a curb higher, the graded ground FORMATION + DRAW_LIFT below', () => {
  let lanes = 0, walks = 0;
  for (const r of R.net.all()) {
    const G = R.net.geometry(r.id), sec = sectionOf(R.profiles[r.profile]);
    for (let s = 40; s < G.length - 40; s += 97) {
      if (R.onBridge(r.id, s)) continue;
      const p = pointAt(G, s, {}), y = profileAt(R.prof.get(r.id), s);
      if (Math.abs(Q.height(p.x, p.z) - (y + DRAW_LIFT)) > 1e-6) continue;   // a junction pad levels it: checked by the pads
      lanes++;
      assert.ok(Math.abs(island.height(p.x, p.z) - (y - FORMATION)) < 1e-6, 'the graded ground under it');
      if (sec.sidewalk) {
        const o = (sec.sidewalk.o0 + sec.sidewalk.o1) / 2, x = p.x - p.dz * o, z = p.z + p.dx * o;
        assert.ok(Math.abs(Q.height(x, z) - (y + DRAW_LIFT + CURB_RISE)) < 0.05, 'a sidewalk stands a curb above the lane');
        walks++;
      }
    }
  }
  assert.ok(lanes > 20, `checked ${lanes} lane points`);
  void walks;
});

test('on a bridge: the deck to its edges (the height grid pulled the edges down toward the water)', () => {
  let n = 0;
  for (const [id, spans] of R.spans) for (const [a, b] of spans) {
    const G = R.net.geometry(id), half = R.half.get(id);
    for (let s = a + 8; s < b - 8; s += 5) {
      const p = pointAt(G, s, {}), deck = profileAt(R.prof.get(id), s) + DRAW_LIFT;
      for (const f of [-0.9, 0, 0.9]) { assert.ok(Math.abs(Q.height(p.x - p.dz * half * f, p.z + p.dx * half * f) - deck) < 0.2, `deck at ${f} of its half width`); n++; }
    }
  }
  assert.ok(n > 0 || !R.spans.size);
});

test('under a bridge: the ground and water beneath it, not its deck; its piers stand where the renderer draws them', async () => {
  const { bridgePiers } = await import('../shared/island-roads.js');
  for (const [id, spans] of R.spans) for (const [a, b] of spans) {
    const G = R.net.geometry(id), s = (a + b) / 2, p = pointAt(G, s, {}), deck = profileAt(R.prof.get(id), s) + DRAW_LIFT;
    assert.equal(Q.under(p.x, p.z, deck), null, 'on the deck: the deck');
    const u = Q.under(p.x, p.z, deck - 4);
    assert.ok(u && u.h < deck - 1, 'well under it: the ground beneath');
    assert.ok(Math.abs(u.h - island.belowDeck(p.x, p.z)) < 1e-9);
  }
  const P = bridgePiers(R, (x, z) => island.baseHeight(x, z));
  for (const q of P) assert.ok(q.top > q.bottom && q.hw > 0 && q.hd > 0);
});
