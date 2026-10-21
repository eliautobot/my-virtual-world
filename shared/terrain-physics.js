// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The island's ground for vehicle physics (WP4.2/4.3): heightfield colliders, one per 400 ft chunk, kept around each
// car that is driving (the browser's own car, server-simulated cars), built from the same canonical 8 ft grid the
// renderer and the players use (roads graded in). Chunks inside the city are left to the city's own colliders; where a
// chunk reaches into the city its points there are held below the city's ground (as the renderer draws them).
// Bridges (2026-10-03: cars drove through the rails and on ground beside the deck): the heightfield leaves the water
// open under and beside them, and each bridge is its own solid deck, following the road's grade, with a guard rail along
// both edges where the drawn ones stand (render/island-roads.js bridgePiece).
// Rapier stores heightfield heights column by column along x (index ix·(nz+1)+iz) and centres the field on its body.
import { CHUNK_M, CELLS_PER_CHUNK, CELL_M, CITY_FLOOR_DROP, chunkHeights } from './terrain.js';
import { pointAt } from './roads.js';
import { profileAt, FORMATION } from './island-roads.js';
import { PHYSICS_GROUPS } from './driving-classic/physics-collision-groups.mjs';

export class TerrainColliders {
  /**
   * @param {object} RAPIER   the rapier module
   * @param {object} physics  the Rapier world
   * @param {import('./terrain.js').Island} island
   * @param {{ cityRect?: object, radius?: number }} [o] radius: chunks kept around each car (1 → a 3 × 3 block)
   */
  constructor(RAPIER, physics, island, { cityRect = null, radius = 1 } = {}) {
    this.R = RAPIER; this.physics = physics; this.island = island; this.city = cityRect; this.radius = radius;
    this.open = island.withoutBridges ? island.withoutBridges() : island;   // the ground with the water open under bridges
    this.live = new Map();   // key → { body, collider, at }
    this.stamp = 0;
  }
  key(cx, cz) { return `${cx},${cz}`; }
  inCity(cx, cz) {
    const c = this.city; if (!c) return false;
    const x0 = cx * CHUNK_M, z0 = cz * CHUNK_M;
    return x0 >= c.x0 && x0 + CHUNK_M <= c.x1 && z0 >= c.z0 && z0 + CHUNK_M <= c.z1;
  }
  /** Keep ground around each point ({ x, z }); chunks no point has needed for a while are removed. Returns changes. */
  update(points) {
    this.stamp++;
    let added = 0;
    for (const p of points) {
      const pcx = Math.floor(p.x / CHUNK_M), pcz = Math.floor(p.z / CHUNK_M);
      for (let dx = -this.radius; dx <= this.radius; dx++) for (let dz = -this.radius; dz <= this.radius; dz++) {
        const cx = pcx + dx, cz = pcz + dz, k = this.key(cx, cz);
        const e = this.live.get(k);
        if (e) { e.at = this.stamp; continue; }
        if (this.inCity(cx, cz)) { this.live.set(k, { body: null, collider: null, at: this.stamp }); continue; }
        this.live.set(k, { ...this.build(cx, cz), at: this.stamp }); added++;
      }
    }
    let removed = 0;
    for (const [k, e] of this.live) if (this.stamp - e.at > 120) { if (e.body) this.physics.removeRigidBody(e.body); this.live.delete(k); removed++; }
    return { added, removed };
  }
  build(cx, cz) {
    const n = CELLS_PER_CHUNK, a = chunkHeights(this.open, cx, cz, 1), H = new Float32Array((n + 1) * (n + 1));
    const c = this.city, low = this.island.p.plainY - CITY_FLOOR_DROP, x0 = cx * CHUNK_M, z0 = cz * CHUNK_M;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = x0 + i * CELL_M, z = z0 + j * CELL_M, inCity = c && x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1;
      H[i * (n + 1) + j] = inCity ? low : a[j * (n + 1) + i];   // rows along z → columns along x
    }
    const body = this.physics.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation((cx + 0.5) * CHUNK_M, 0, (cz + 0.5) * CHUNK_M));
    const collider = this.physics.createCollider(this.R.ColliderDesc.heightfield(n, n, H, { x: CHUNK_M, y: 1, z: CHUNK_M }).setFriction(0.9).setCollisionGroups(PHYSICS_GROUPS.ground), body);
    this.bridges(body, x0, z0);
    return { body, collider };
  }
  /** The bridge decks and their rails in a chunk: boxes every few metres along each span (those whose middle is here). */
  bridges(body, x0, z0) {
    const roads = this.island.roads; if (!roads?.spans?.size) return;
    const bx = x0 + CHUNK_M / 2, bz = z0 + CHUNK_M / 2, STEP = 4, RAIL = 1.2;
    for (const [id, spans] of roads.spans) {
      const G = roads.net.geometry(id), prof = roads.prof.get(id), half = roads.half.get(id);
      for (const [a, b] of spans) for (let s0 = a; s0 < b - 0.01; s0 += STEP) {
        const s1 = Math.min(b, s0 + STEP), m = pointAt(G, (s0 + s1) / 2, {});
        if (m.x < x0 || m.x >= x0 + CHUNK_M || m.z < z0 || m.z >= z0 + CHUNK_M) continue;
        const y0 = profileAt(prof, s0), y1 = profileAt(prof, s1), top = (y0 + y1) / 2 - FORMATION, len = s1 - s0;
        // turned to the road (yaw) and tilted to its grade (about the across axis)
        const yaw = Math.atan2(-m.dz, m.dx), pitch = Math.atan2(y1 - y0, len), cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
        const rot = { x: sy * sp, y: sy * cp, z: cy * sp, w: cy * cp };   // the yaw then the tilt
        const nx = -m.dz, nz = m.dx, box = (hx, hy, hz, ox, oy) => this.physics.createCollider(this.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(m.x + nx * ox - bx, oy, m.z + nz * ox - bz).setRotation(rot).setFriction(0.9).setCollisionGroups(PHYSICS_GROUPS.ground), body);
        box(len / 2 + 0.35, 0.4, half, 0, top - 0.4);
        for (const sd of [1, -1]) box(len / 2 + 0.35, RAIL / 2, 0.12, sd * (half - 0.08), top + RAIL / 2);
      }
    }
  }
  clear() { for (const e of this.live.values()) if (e.body) this.physics.removeRigidBody(e.body); this.live.clear(); }
}
