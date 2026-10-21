// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Where a city on an island meets the island (WP4.2/4.3): a sidewalk-height apron around the city's road edge, open
// where island roads leave the city so a road runs on at street level, and the one ground-height rule outdoors — the
// city's streets and blocks, the apron, then the island's terrain. The renderer draws these rectangles, the driving
// physics (shared/vehicle-world.js) builds them, and walking (server and browser) stands on them, so all agree.
import { RoadNetwork, samplePolyline, DEFAULT_ROAD_PROFILES } from './roads.js';
import { blockAt } from './city.js';
import { GROUND_Y } from './constants.js';
import { CITY_RETURN } from './city-roads.js';

export const APRON_M = 10;            // apron width (m) beyond the city's road edge
const GAP_PAD = 0.5;                  // m of clearance either side of a road's outer edge through the apron

/** Where each island road crosses the city's edge: [{ side: 'n'|'s'|'w'|'e', at, half }] (at: position along that side). */
export function roadCuts(g, records, { profiles = DEFAULT_ROAD_PROFILES } = {}) {
  if (g.empty || !records || !records.length) return [];
  const out = [], inside = (p) => p.x > g.minX && p.x < g.maxX && p.z > g.minZ && p.z < g.maxZ;
  let net;
  try { net = RoadNetwork.fromJSON(records, { profiles }); } catch { return []; }
  for (const r of net.all()) {
    const G = net.geometry(r.id), P = profiles[r.profile]; if (!G || !P) continue;
    const half = P.outerHalf / 1e6 + GAP_PAD, pts = samplePolyline(G, 0, { maxChord: 2 });
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      // A segment from inside to outside (or touching the edge from outside): where it crosses, and at what angle.
      const ia = inside(a) || onEdge(g, a), ib = inside(b) || onEdge(g, b);
      if (ia === ib) continue;
      const o = ia ? b : a, dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      const side = o.z <= g.minZ ? 'n' : o.z >= g.maxZ ? 's' : o.x <= g.minX ? 'w' : 'e';
      const along = side === 'n' || side === 's' ? 'x' : 'z', edge = { n: g.minZ, s: g.maxZ, w: g.minX, e: g.maxX }[side];
      const t = along === 'x' ? (dz ? (edge - a.z) / dz : 0) : (dx ? (edge - a.x) / dx : 0);
      const at = along === 'x' ? a.x + dx * clamp01(t) : a.z + dz * clamp01(t);
      const cos = Math.abs(along === 'x' ? dz : dx) / L;   // road direction against the edge's normal
      // a widened city's junction (shared/city-roads.js) reaches out round its curb returns: the apron opens for them
      const extra = Math.abs(g.road - 2 * (profiles['avenue-4']?.carriageHalf || 0) / 1e6) < 0.01 ? CITY_RETURN + 1 : 0;
      out.push({ side, at, half: half / Math.max(cos, 1 / 3) + extra, road: r.id });
    }
  }
  return out;
}
const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);
const onEdge = (g, p) => Math.abs(p.z - g.minZ) < 1e-6 || Math.abs(p.z - g.maxZ) < 1e-6 || Math.abs(p.x - g.minX) < 1e-6 || Math.abs(p.x - g.maxX) < 1e-6;

/**
 * The apron as rectangles ({ x0, z0, x1, z1 }, at sidewalk height): north and south strips across the corners, west and
 * east strips between them, each cut where a road crosses that side. `g` from makeGrid, `records` world.roads. inset:
 * metres left open next to the city's edge (drawing a widened city: its edge streets' own sidewalks lie there, at the
 * same height — two surfaces in one place would flicker); walking and driving use the whole apron.
 */
export function apronRects(g, records, { width = APRON_M, profiles, inset = 0 } = {}) {
  if (g.empty) return [];   // no city, no apron
  const cuts = roadCuts(g, records, { profiles }), W = width, out = [], I = inset;
  const strip = (side, lo, hi, make) => {
    const gaps = cuts.filter(c => c.side === side).map(c => [c.at - c.half, c.at + c.half]).sort((a, b) => a[0] - b[0]);
    let s = lo;
    for (const [a, b] of gaps) { if (a > s) out.push(make(s, Math.min(a, hi))); s = Math.max(s, b); if (s >= hi) break; }
    if (s < hi) out.push(make(s, hi));
  };
  strip('n', g.minX - I - W, g.maxX + I + W, (a, b) => ({ x0: a, z0: g.minZ - I - W, x1: b, z1: g.minZ - I }));
  strip('s', g.minX - I - W, g.maxX + I + W, (a, b) => ({ x0: a, z0: g.maxZ + I, x1: b, z1: g.maxZ + I + W }));
  strip('w', g.minZ - I, g.maxZ + I, (a, b) => ({ x0: g.minX - I - W, z0: a, x1: g.minX - I, z1: b }));
  strip('e', g.minZ - I, g.maxZ + I, (a, b) => ({ x0: g.maxX + I, z0: a, x1: g.maxX + I + W, z1: b }));
  return out.filter(r => r.x1 - r.x0 > 0.05 && r.z1 - r.z0 > 0.05);
}

/**
 * Outdoor ground height for a world: inside the city its streets (0) and blocks (sidewalk height); on an island the
 * apron around it, and beyond that (and in the apron's road openings) the terrain's `height(x, z)`. Without an island,
 * the endless plain at sidewalk height around the city.
 */
export class OutdoorGround {
  /** @param {object} g makeGrid result @param {object[]|null} records world.roads @param {{height:(x:number,z:number)=>number}|null} terrain */
  constructor(g, records, terrain) {
    this.g = g; this.terrain = terrain || null;
    this.apron = terrain ? apronRects(g, records) : [];
  }
  inCity(x, z) { const g = this.g; return x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ; }
  onApron(x, z) { for (const r of this.apron) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return true; return false; }
  height(x, z) {
    const g = this.g;
    if (this.inCity(x, z)) return blockAt(g, x, z) ? GROUND_Y : 0;
    if (!this.terrain) return GROUND_Y;
    if (this.onApron(x, z)) return GROUND_Y;
    return this.terrain.height(x, z);
  }
}
