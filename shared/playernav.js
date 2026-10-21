// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Where a player may stand, shared by the server (it validates every move, PLAN WP1.10, DECISIONS C62) and usable by
// the browser. The browser's own collision (client/js/player/player.js) is stricter - it also stops at street
// furniture, kiosks and park hedges and keeps the body clear of walls - so every position it produces passes here; this
// module only has to refuse what no honest client sends: standing inside a building's walls, walking through an
// interior wall, off the floor plan, or changing floor or building without a door or an elevator.
import { moduleBoxes, aircraftSolids } from './world-modules.js';
import { WALL_T } from './constants.js';
import { toLocal, toWorld, footprint, inItemRect } from './geom.js';
import { CATALOG } from './catalog.js';
import { makeGrid } from './city.js';
import { buildGrid, walkable, wallBetween, nearestFree, cellCenter, furnitureOnly, ITEM_CLEAR } from './navgrid.js';
import { tallUnder, STAND_TOL } from './standable.js';
import { interiorBounds } from './edit.js';
import { elevatorStops } from './building.js';

export const PLAYER_RADIUS = 0.26;   // the body (player.js R)
export const RUN_SPEED = 5.33;       // m/s: the fastest a player moves, running (player.js RUN; 4.1 until 2026-10-06: 30% faster)
export const PUSH_RADIUS = 0.6;      // players closer than this push each other apart softly (I14.10)

/** The soft push (I14.10): how far a player at (x, z) moves this frame to get clear of the others ([x, z] each).
 *  Overlap closes at `rate` per second and never by more than the overlap itself, so a walker can always squeeze past
 *  (walking pushes back at up to 1.55 m/s, running at RUN_SPEED) and nobody can pin anyone. Exactly on top: a fixed direction. */
export function pushApart(x, z, others, dt, rate = 3) {
  let dx = 0, dz = 0;
  for (const o of others) {
    let ex = x - o[0], ez = z - o[1];
    const d = Math.hypot(ex, ez);
    if (d >= PUSH_RADIUS) continue;
    if (d < 1e-4) { ex = 1; ez = 0; } else { ex /= d; ez /= d; }
    const u = PUSH_RADIUS - d, k = Math.min(u, u * rate * dt + 0.002);
    dx += ex * k; dz += ez * k;
  }
  return { dx, dz };
}
const CELL = 16;

export class PlayerNav {
  /** ground: the island's GroundQuery (shared/terrain.js) when the world has terrain (WP4.2): players may then walk the
   *  whole island's dry land, not only the city. */
  constructor(world, { ground = null } = {}) { this.world = world; this.ground = ground; this.grids = new Map(); this.rebuild(); }
  /** After an edit: buildings may have moved, gone, or changed their floors. */
  rebuild() {
    const w = this.world;
    this.g = makeGrid(w.grid);
    this.cells = new Map();
    this.dcells = new Map();
    this.grids.clear();
    for (const d of w.decorations || []) {
      const R = CATALOG[d.t]?.rect; if (!R) continue;
      const e = Math.hypot(R[2] - R[0], R[3] - R[1]) / 2 + 0.2;
      for (let i = Math.floor((d.x - e) / CELL); i <= Math.floor((d.x + e) / CELL); i++) for (let j = Math.floor((d.z - e) / CELL); j <= Math.floor((d.z + e) / CELL); j++) {
        const k = i * 100003 + j; (this.dcells.get(k) || this.dcells.set(k, []).get(k)).push(d);
      }
    }
    this.mboxes = moduleBoxes(w);   // world modules' buildings (an airport's terminal, tower and hangar)
    this.planes = aircraftSolids(w);   // standing aircraft (a little looser than the browser's: a flown one may be away)
    for (const B of w.buildings) {
      if (!B || B.gone) continue;
      const fp = footprint(B);
      for (let i = Math.floor(fp.x0 / CELL); i <= Math.floor(fp.x1 / CELL); i++) {
        for (let j = Math.floor(fp.z0 / CELL); j <= Math.floor(fp.z1 / CELL); j++) {
          const k = i * 100003 + j;
          let a = this.cells.get(k);
          if (!a) this.cells.set(k, a = []);
          a.push(B);
        }
      }
    }
  }
  near(x, z) { return this.cells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) || []; }
  decorNear(x, z) { return this.dcells.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) || []; }
  building(ctx) { const B = ctx >= 0 ? this.world.buildings[ctx >> 6] : null; return B && !B.gone && (ctx & 63) < B.floors ? B : null; }
  gridFor(B, f) {
    const lv = B.lv[f], key = `${B.idx * 64 + f}:${lv}`;
    let g = this.grids.get(key);
    if (!g) { g = buildGrid(B, this.world.levels[lv]); this.grids.set(key, g); }
    return g;
  }
  /** Outside: on the island's dry land (or within the city's edge on a world without terrain) and not inside a
   *  building's walls (a doorway is open). up: how high the feet are above the ground - a body that high may stand on
   *  decorations no taller than that (shared/standable.js). */
  outsideOk(x, z, up = 0) {
    const g = this.g;
    const nearCity = x > g.minX - 40 && x < g.maxX + 40 && z > g.minZ - 40 && z < g.maxZ + 40;
    if (!nearCity) {
      if (!this.ground) return false;
      const t = this.world.terrain, r = t.radius * 1.35;
      if (Math.abs(x - t.center.x) > r || Math.abs(z - t.center.z) > r) return false;
      // water: swum in (2026-10-05) - anywhere within the island's reach
    }
    for (const b of this.mboxes) if (inItemRect(x, z, b.x, b.z, b.rot, [-b.hw, -b.hd, b.hw, b.hd], -0.12)) return false;
    for (const a of this.planes) if (Math.abs(x - a.x) < 9 && Math.abs(z - a.z) < 9 && inItemRect(x, z, a.x, a.z, a.rot, a.rect, -0.3)) return false;
    for (const d of this.decorNear(x, z)) if (inItemRect(x, z, d.x, d.z, d.r || 0, CATALOG[d.t].rect, 0.12) && tallUnder([d], x, z, 0.12, up + STAND_TOL)) return false;   // decorations (WP4.7), lower than a step above the feet: stood on
    for (const B of this.near(x, z)) {
      if (B.type === 'park') continue;
      const l = toLocal(B, x, z);
      if (Math.abs(l.x) >= B.w / 2 - 0.12 || Math.abs(l.z) >= B.d / 2 - 0.12) continue;
      if (B.door && Math.abs(l.x - B.door.x) < B.door.w / 2 && l.z > B.d / 2 - WALL_T - 1.0) continue;   // the doorway
      return false;
    }
    return true;
  }
  /** Inside floor f of B: on the floor plan and on a walkable cell (the ground-floor doorway counts as inside). */
  insideOk(B, f, x, z, up = 0) {
    if (!B || B.gone || f < 0 || f >= B.floors) return false;
    const l = toLocal(B, x, z), ib = interiorBounds(B);
    if (f === 0 && B.door && Math.abs(l.x - B.door.x) < B.door.w / 2 && l.z > ib.z1 - 1.2 && l.z < B.d / 2 + 1.4) return true;
    if (l.x < ib.x0 || l.x > ib.x1 || l.z < ib.z0 || l.z > ib.z1) return false;
    const g = this.gridFor(B, f);
    if (walkable(g, l.x, l.z)) return true;
    // over furniture: no wall there, and nothing there more than a STEP above the feet (up: above the floor) - the
    // browser's own rule (player.js inBlocked), with a little slack
    return furnitureOnly(g, l.x, l.z) && !tallUnder(g.items, l.x, l.z, ITEM_CLEAR, up + STAND_TOL);
  }
  /** up: the feet's height above the ground or floor (0: standing on it) - higher, a body may stand on things. */
  ok(x, z, ctx, up = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    return ctx < 0 ? this.outsideOk(x, z, up) : this.insideOk(this.world.buildings[ctx >> 6], ctx & 63, x, z, up);
  }
  /** Whether a straight move inside a floor passes through one of its interior walls. */
  wallCrossed(ctx, x0, z0, x1, z1) {
    const B = this.building(ctx);
    if (!B) return false;
    const a = toLocal(B, x0, z0), b = toLocal(B, x1, z1);
    return wallBetween(this.gridFor(B, ctx & 63), a.x, a.z, b.x, b.z);
  }
  nearDoor(B, x, z, r = 3) {
    if (!B || !B.door) return false;
    const l = toLocal(B, x, z);
    return Math.abs(l.x - B.door.x) < B.door.w / 2 + r && Math.abs(l.z - B.d / 2) < r;
  }
  /** Whether (x, z) in ctx is in or right in front of a doorway or an elevator: players never push each other there,
   *  so nobody can block a way in or out (I14.10). */
  inDoorway(x, z, ctx, r = 1.4) {
    const cands = ctx >= 0 ? [this.world.buildings[ctx >> 6]] : this.near(x, z);
    for (const B of cands) {
      if (!B || B.gone) continue;
      if (ctx >= 0 && this.nearElevator(B, x, z, 1.3)) return true;
      if (!B.door || (ctx >= 0 && (ctx & 63) !== 0)) continue;
      const l = toLocal(B, x, z);
      if (Math.abs(l.x - B.door.x) < B.door.w / 2 + 0.6 && Math.abs(l.z - B.d / 2) < r) return true;
    }
    return false;
  }
  nearElevator(B, x, z, r = 2.6) {
    if (!B) return false;
    const l = toLocal(B, x, z);
    return elevatorStops(B).some(s => Math.hypot(l.x - s.x, l.z - s.z) < r);
  }
  /** The nearest place a player may stand, from (x, z) in ctx: the same floor when it still exists, else outside the
   *  building's door, else the nearest open ground. Null when nothing is found within 80 m. */
  nearestValid(x, z, ctx) {
    const B = this.building(ctx);
    if (B) {
      const g = this.gridFor(B, ctx & 63), l = toLocal(B, x, z), c = nearestFree(g, l.x, l.z, 60);
      if (c >= 0) { const q = cellCenter(g, c, {}), w = toWorld(B, q.x, q.z); return { x: w.x, z: w.z, ctx }; }
    }
    const old = ctx >= 0 ? this.world.buildings[ctx >> 6] : null;
    if (old && !old.gone && old.door) {
      const d = toWorld(old, old.door.x, old.d / 2 + 1.4);
      if (this.outsideOk(d.x, d.z)) return { x: d.x, z: d.z, ctx: -1 };
    }
    return this.openGround(x, z);
  }
  /** Whether (x, z) is in the island's water (swimmers may be there; nobody is put there). */
  wet(x, z) { return !!(this.ground && this.ground.water(x, z)); }
  /** Dry open ground at or near (x, z) (spawn points, homes, the nearest free spot). */
  openGround(x, z) {
    const okHere = (px, pz) => this.outsideOk(px, pz) && !this.wet(px, pz);
    if (okHere(x, z)) return { x, z, ctx: -1 };
    for (let r = 1; r <= 80; r++) {
      const n = Math.max(8, Math.round(r * 2.5));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (okHere(px, pz)) return { x: px, z: pz, ctx: -1 };
      }
    }
    return null;
  }
  /** Outside the headquarters' door (or the city centre): where a player starts when no admin set a spawn point. */
  defaultSpawn() {
    const hq = this.world.buildings.find(b => b && !b.gone && b.type === 'hq');
    if (hq && hq.door) { const d = toWorld(hq, hq.door.x, hq.d / 2 + 3); const v = this.openGround(d.x, d.z); if (v) return v; }
    const g = this.g, cx = g.empty ? 0 : (g.minX + g.maxX) / 2, cz = g.empty ? 0 : (g.minZ + g.maxZ) / 2;   // (no city: the island's origin)
    return this.openGround(cx, cz) || { x: 0, z: 0, ctx: -1 };
  }
}
