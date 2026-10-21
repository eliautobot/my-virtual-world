// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
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
import { sectionOf, CURB_RISE } from './road-kit.js';
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
    this.curbs(body, x0, z0);
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
  /** The curbs and sidewalks of the roads in a chunk, solid (the product owner 2026-10-21: cars on the drawn roads didn't
   *  feel the curb, the gutter's edge or the sidewalk: the heightfield's 2.4 m cells lie flat under a road's whole width).
   *  Boxes CURB_RISE over the road's own ground (its profile less FORMATION, as the heightfield and the city's kerbed
   *  blocks): along each curbed road from its curb face to the back of its sidewalk, short of every junction's footprint,
   *  and round each junction's corners (shared/road-kit.js plan: curb and sidewalk bands, coming down where a road has
   *  none). Bridges keep their own decks. */
  curbs(body, x0, z0) {
    const roads = this.island.roads; if (!roads?.net?.size) return;
    const c = this.city, bx = x0 + CHUNK_M / 2, bz = z0 + CHUNK_M / 2, DEEP = 0.6, STEP = 2, FINE = 0.5;
    const here = (x, z) => x >= x0 && x < x0 + CHUNK_M && z >= z0 && z < z0 + CHUNK_M && !(c && x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1);
    const rot = (yaw, pitch) => { const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2); return { x: sy * sp, y: sy * cp, z: cy * sp, w: cy * cp }; };
    const box = (x, z, top, hx, hz, yaw, pitch = 0) => this.physics.createCollider(this.R.ColliderDesc.cuboid(hx, DEEP / 2, hz).setTranslation(x - bx, top - DEEP / 2, z - bz).setRotation(rot(yaw, pitch)).setFriction(0.9).setCollisionGroups(PHYSICS_GROUPS.ground), body);
    const m = {}, e0 = {}, e1 = {};
    for (const r of roads.net.all()) {
      const P = roads.profiles[r.profile], sec = P && sectionOf(P); if (!sec?.curb) continue;
      const G = roads.net.geometry(r.id), prof = roads.prof.get(r.id), bb = G.bbox, o0 = sec.carriage, o1 = sec.sidewalk ? sec.sidewalk.o1 : sec.curb.o1;
      if (bb && (bb.x1 + o1 < x0 || bb.x0 - o1 > x0 + CHUNK_M || bb.z1 + o1 < z0 || bb.z0 - o1 > z0 + CHUNK_M)) continue;
      const mid = (o0 + o1) / 2, hw = (o1 - o0) / 2;
      // a piece of the band from station a to b on side sd; split finer where a junction's footprint reaches it
      const piece = (a, b, sd, fine) => {
        pointAt(G, (a + b) / 2, m); const x = m.x - m.dz * sd * mid, z = m.z + m.dx * sd * mid;
        if (!here(x, z)) return;
        pointAt(G, a, e0); pointAt(G, b, e1);
        const ends = [[e0, o0], [e0, o1], [e1, o0], [e1, o1]].map(([p, o]) => roads.junctionAt(p.x - p.dz * sd * o, p.z + p.dx * sd * o));
        const y0 = profileAt(prof, a), y1 = profileAt(prof, b), len = b - a, top = (y0 + y1) / 2 - FORMATION + CURB_RISE, yaw = Math.atan2(-m.dz, m.dx), pitch = Math.atan2(y1 - y0, len);
        if (!fine && !ends.some(Boolean) && !roads.junctionAt(x, z)) { box(x, z, top, len / 2 + 0.05, hw, yaw, pitch); return; }
        if (!fine) { for (let s = a; s < b - 0.01; s += FINE / 2) piece(s, Math.min(b, s + FINE / 2), sd, true); return; }
        // by a junction: strips across the band, each kept where the junction's footprint doesn't reach (a fine piece
        // reaching into a corner's own sidewalk overlaps it: no gap at the mouth)
        const n = Math.ceil((o1 - o0) / FINE), w = (o1 - o0) / n;
        for (let k = 0; k < n; k++) {
          const o = o0 + (k + 0.5) * w, px = m.x - m.dz * sd * o, pz = m.z + m.dx * sd * o;
          if (!roads.junctionAt(px, pz)) box(px, pz, top, len / 2 + 0.05, w / 2 + 0.02, yaw, pitch);
        }
      };
      for (let a = 0; a < G.length - 0.01; a += STEP) {
        const b = Math.min(G.length, a + STEP); if (roads.onBridge(r.id, (a + b) / 2)) continue;
        for (const sd of [1, -1]) piece(a, b, sd, false);
      }
    }
    // the junctions' corners
    for (const J of roads.pads || []) {
      const plan = J.foot && roads.plans?.get(J.key); if (!plan || Math.abs(J.x - bx) > CHUNK_M / 2 + J.r || Math.abs(J.z - bz) > CHUNK_M / 2 + J.r) continue;
      const y = J.y - FORMATION;
      for (const k of plan.corners) {
        const bd = k.bands; if (!bd.curb) continue;
        const inner = bd.curb[0], outer = bd.sidewalk ? resample(bd.sidewalk[1], inner.length) : bd.curb[1];
        for (let i = 0; i + 1 < inner.length && i + 1 < outer.length; i++) {
          const rise = k.rise ? (k.rise[i] + k.rise[i + 1]) / 2 : 1; if (rise < 0.2) continue;
          const a = inner[i], b = inner[i + 1], p = outer[i], q = outer[i + 1];
          if (!here((a.x + b.x + p.x + q.x) / 4, (a.z + b.z + p.z + q.z) / 4)) continue;
          // in strips from the curb face out: a corner's back edge can be far longer than its curb line (a fan), so one
          // box per piece would leave wedges open
          const n = Math.max(1, Math.ceil(Math.hypot((p.x + q.x - a.x - b.x) / 2, (p.z + q.z - a.z - b.z) / 2) / FINE));
          const L = (u, v, t) => ({ x: u.x + (v.x - u.x) * t, z: u.z + (v.z - u.z) * t });
          for (let k = 0; k < n; k++) {
            const a0 = L(a, p, k / n), b0 = L(b, q, k / n), a1 = L(a, p, (k + 1) / n), b1 = L(b, q, (k + 1) / n);
            const dx = (b0.x - a0.x + b1.x - a1.x) / 2, dz = (b0.z - a0.z + b1.z - a1.z) / 2, d = Math.hypot(dx, dz); if (d < 0.01) continue;
            const len = Math.max(Math.hypot(b0.x - a0.x, b0.z - a0.z), Math.hypot(b1.x - a1.x, b1.z - a1.z));
            const wide = Math.hypot((a1.x + b1.x - a0.x - b0.x) / 2, (a1.z + b1.z - a0.z - b0.z) / 2);
            box((a0.x + b0.x + a1.x + b1.x) / 4, (a0.z + b0.z + a1.z + b1.z) / 4, y + CURB_RISE * rise, len / 2 + 0.03, wide / 2 + 0.02, Math.atan2(-dz / d, dx / d));
          }
        }
      }
    }
  }
  clear() { for (const e of this.live.values()) if (e.body) this.physics.removeRigidBody(e.body); this.live.clear(); }
}

function resample(pts, n) {
  if (pts.length === n) return pts;
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const L = cum.at(-1) || 1, out = [];
  for (let k = 0; k < n; k++) {
    const s = L * k / (n - 1); let i = 1; while (i < pts.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t });
  }
  return out;
}
