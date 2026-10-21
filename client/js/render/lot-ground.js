// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The ground of a grid's blocks, as the city draws its own (the grid layout tool; 2026-10-14, the product owner: "the
// inner areas of lot area to be the same as the green area in the main city on the residentials … and the brick/paved
// area if it's commercial or mixed use … flat and flush with the back of sidewalks"; then: "make sure it looks and works
// similar to how the main city works"). Every block of a grid (shared/island-build.js gridPads: from the back of one
// sidewalk to the next) is one lawn at its lots' level with the city's block material (render/mats.js), and every
// commercial, mixed-use or industrial lot on it is paved in the city's brick. The terrain's own mesh lies well below a
// block (shared/terrain.js GRID_SINK) and the lawn gives way to the junctions' corner sidewalks where they overlap
// (polygon offset), so nothing flickers through from afar. Two draw calls; rebuilt when the lots or the grids change.
import * as THREE from 'three';
import { makeGrid } from '/shared/city.js';
import { gridPads } from '/shared/island-build.js';
import { makeGroundMat } from './mats.js';

const PAVED = new Set(['commercial', 'mixed', 'industrial']);
const GROW = 0.025;   // m each paved lot reaches out: closes the 2 cm between lots and against the back of the sidewalk
const FAR = 1e6;

export class LotGround {
  constructor(scene, world) { this.scene = scene; this.world = world; this.meshes = []; this.key = ''; this.mats = null; }
  /** lots: [{ id, poly (µm), zoning }]. */
  update(lots, world = this.world) {
    this.world = world;
    const pads = gridPads(world);
    const local = (P, x, z) => { const dx = x - P.x, dz = z - P.z; return { u: dx * Math.cos(P.rot) - dz * Math.sin(P.rot), v: dx * Math.sin(P.rot) + dz * Math.cos(P.rot) }; };
    const inside = (P, x, z) => { const q = local(P, x, z); return Math.abs(q.u) <= P.hw && Math.abs(q.v) <= P.hd; };
    const toWorld = (P, u, v) => ({ x: P.x + u * Math.cos(P.rot) + v * Math.sin(P.rot), z: P.z - u * Math.sin(P.rot) + v * Math.cos(P.rot) });
    const blocks = pads.flatMap(P => (P.blocks || []).map(([u0, u1, v0, v1]) => ({ y: P.lot, pts: [toWorld(P, u0, v0), toWorld(P, u1, v0), toWorld(P, u1, v1), toWorld(P, u0, v1)] })));
    const paved = [];
    if (pads.length) for (const l of lots || []) {
      if (!l?.poly?.length || !PAVED.has(l.zoning)) continue;
      const pts = l.poly.map(p => ({ x: p.x / 1e6, z: p.z / 1e6 }));
      let cx = 0, cz = 0; for (const p of pts) { cx += p.x / pts.length; cz += p.z / pts.length; }
      const P = pads.find(G => inside(G, cx, cz)); if (!P) continue;
      paved.push({ y: P.lot, pts: pts.map(p => { const dx = p.x - cx, dz = p.z - cz, L = Math.hypot(dx, dz) || 1; return { x: p.x + dx / L * GROW, z: p.z + dz / L * GROW }; }) });
    }
    const key = JSON.stringify([blocks, paved]);
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (!blocks.length && !paved.length) return;
    if (!this.mats) {
      const g = makeGrid(world.grid), lawn = makeGroundMat('block', g), brick = makeGroundMat('block', g);
      Object.assign(lawn, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });   // behind the corner sidewalks and the paving
      this.mats = { lawn, brick };
    }
    for (const [list, kind, mat] of [[blocks, 1, this.mats.lawn], [paved, 0, this.mats.brick]]) {
      const g = polys(list, kind); if (!g) continue;
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.name = kind ? 'grid-blocks' : 'grid-paved-lots';
      this.scene.add(m); this.meshes.push(m);
    }
  }
  clear() { for (const m of this.meshes) { this.scene.remove(m); m.geometry.dispose(); } this.meshes = []; }
  get mesh() { return this.meshes[0] || null; }
}

/** Flat convex rings at their own heights, facing up, with the city block material's attributes (aLot: 1 lawn, 0 brick). */
function polys(list, kind) {
  if (!list.length) return null;
  const pos = [], nrm = [], br = [], lot = [], idx = [];
  for (const q of list) {
    const b = pos.length / 3;
    for (const p of q.pts) { pos.push(p.x, q.y, p.z); nrm.push(0, 1, 0); br.push(-FAR, -FAR, FAR, FAR); lot.push(kind); }
    let a2 = 0; for (let i = 0; i < q.pts.length; i++) { const p = q.pts[i], n = q.pts[(i + 1) % q.pts.length]; a2 += p.x * n.z - n.x * p.z; }
    for (let i = 1; i + 1 < q.pts.length; i++) a2 > 0 ? idx.push(b, b + i + 1, b + i) : idx.push(b, b + i, b + i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aBR', new THREE.Float32BufferAttribute(br, 4));
  g.setAttribute('aLot', new THREE.Float32BufferAttribute(lot, 1));
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}
