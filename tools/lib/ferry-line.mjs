// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Test and check helper (WP4.15): a ferry line round an island's coast between two stretches with a road near the
// shore, docks just off them where the water is deep enough - valid under shared/ferries.js. Used by tests/ferries and
// the browser checks.
import { makeGrid } from '../../shared/city.js';
import { Island } from '../../shared/terrain.js';
import { coastline, SECTORS } from '../../shared/coasts.js';
import { ferryWhy, waterFor, landing, normalizeFerry, FERRY } from '../../shared/ferries.js';

/** A ferry line round the coast between two stretches with a road near the shore (docks just off them). */
export function findLine(world, { id = 'fy-1', name = 'Test Ferry', boats = 2 } = {}) {
  const island = new Island(world.terrain, { roads: world.roads }), net = island.roads.net, T = world.terrain, g = makeGrid(world.grid);
  const line = coastline(island), docks = [];
  for (let k = 0; k < SECTORS; k++) {
    const c = line[k], ux = c.x - T.center.x, uz = c.z - T.center.z, L = Math.hypot(ux, uz);
    for (let d = 8; d <= 380; d += 6) {
      const x = c.x + ux / L * d, z = c.z + uz / L * d, w = waterFor(island, x, z);
      if (!w || w.depth < FERRY.DRAFT + 0.5) continue;
      const land = landing(island, x, z);
      if (land && net.nearest(land.x, land.z, FERRY.ROAD_REACH * 0.8)) docks.push({ k, x, z, r: L });
      break;
    }
  }
  const env = { island: new Island(world.terrain), roads: net, city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, buildings: world.buildings };
  for (const a of docks) for (const b of docks) {
    const span = b.k - a.k;
    if (span < 5 || span > 14) continue;
    const pts = [{ x: a.x, z: a.z }];
    for (let k = a.k; k <= b.k; k++) { const c = line[k], ux = c.x - T.center.x, uz = c.z - T.center.z, L = Math.hypot(ux, uz); pts.push({ x: c.x + ux / L * 650, z: c.z + uz / L * 650 }); }
    pts.push({ x: b.x, z: b.z });
    const f = normalizeFerry({ id, name, boats, pts });
    if (!ferryWhy(f, env)) return { f, env };
  }
  return null;
}

