// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// City ground (roads with markings + scramble crossings, blocks with curbs/sidewalks/lots, outskirts), street lights
// (+ baked night light map), street trees, traffic + pedestrian signals (live, deterministic), subway kiosks,
// street props and door walkways.
import * as THREE from 'three';
import { makeGrid, blockRect, lotRect, blockAt } from '/shared/city.js';
import { GROUND_Y, sigLight, pedLight } from '/shared/constants.js';
import { toWorld, footprint } from '/shared/geom.js';
import { FINISHES } from '/shared/catalog.js';
import { GU } from './scene.js';
import { makeGroundMat, makeFurnMat, makeFloorMat } from './mats.js';
import { FB, treeRound, treePine, treeColumn, lin } from './furniture.js';
import { QB, hsh } from './qb.js';
import { apronRects } from '/shared/city-edge.js';
import { stationY } from '/shared/stations.js';
import { cityRoadSet } from '/shared/city-roads.js';
import { IslandRoadsLayer } from './island-roads.js';
import { SIGNAL_LAMPS } from './road-signals.js';

const LEAF = ['#4f8a3c', '#5e9a45', '#3f7a3a', '#4c7f3a', '#ffffff', '#d98cb3'];
const TREE_KIND = [0, 0, 0, 1, 2, 0];   // variant -> geometry (0 round, 1 column, 2 pine)
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();

function mesh(geo, mat, { cast = false, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = receive; m.matrixAutoUpdate = false; return m;
}
function setInst(im, k, x, y, z, yaw, s = 1) {
  _q.setFromAxisAngle(_up, yaw); _p.set(x, y, z); _s.set(s, s, s);
  im.setMatrixAt(k, _m.compose(_p, _q, _s));
}

export class City {
  constructor(world, atlas) {
    this.world = world; this.atlas = atlas;
    this.g = makeGrid(world.grid);
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.furnMat = makeFurnMat({ lit: true });
    this.occ = [];
    // A city whose streets are the avenue (shared/city-roads.js): the road kit draws its streets, sidewalks, corners,
    // crosswalks and signals, like every road beyond it; the city draws its lots and everything on them.
    this.roadSet = cityRoadSet(world.grid, world.roads);
    this.buildGround();
    this.buildStations();
    if (this.roadSet) { this.roadLayer = new IslandRoadsLayer(this.roadSet, { lift: 0, only: this.roadSet.only }); this.add(this.roadLayer.group); this.keepClearOfSignals(); }
    else this.buildSignals();
    this.buildTrees();
    this.buildLamps();
    this.buildProps();
    this.buildPaths();
  }
  add(o) { this.group.add(o); o.updateMatrix?.(); o.updateMatrixWorld?.(true); return o; }
  // City-wide instanced street items (trees, lamps, bins...) would all be drawn into the shadow map every frame, though
  // shadows only cover the area around the camera. Each is split into a shadow-casting set near that area and a
  // non-casting rest, re-split as the area moves: the same items are drawn, the shadow pass only draws the near ones.
  initShadowSplit() {
    this.shadowSplits = [];
    for (const o of [...this.group.children]) {
      if (!o.isInstancedMesh || !o.castShadow || o.count < 32) continue;
      const n = o.count, near = new THREE.InstancedMesh(o.geometry, o.material, n);
      near.castShadow = true; near.receiveShadow = o.receiveShadow; near.count = 0;
      if (o.instanceColor) near.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      o.castShadow = false;
      this.shadowSplits.push({ far: o, near, mats: o.instanceMatrix.array.slice(), cols: o.instanceColor ? o.instanceColor.array.slice() : null, n, at: null });
      this.add(near);
    }
  }
  /** Re-split around the shadow area (centre x/z, half-size in metres) only when the square it needs no longer fits in
   *  the square split last time (prepared with a 25% margin) or has shrunk well inside it. The area moves and resizes
   *  with the camera every frame, so a plain change test would re-split on every frame of a drive or zoom. */
  updateShadowSplit(cx, cz, half) {
    if (!this.shadowSplits) this.initShadowSplit();
    const need = half * 1.42 + 50;   // long low-sun shadows reach in from outside the area
    for (const s of this.shadowSplits) {
      if (s.at && Math.abs(s.at[0] - cx) + need <= s.at[2] && Math.abs(s.at[1] - cz) + need <= s.at[2] && need > s.at[2] * 0.6) continue;
      const reach = need * 1.25;
      s.at = [cx, cz, reach];
      const fm = s.far.instanceMatrix.array, nm = s.near.instanceMatrix.array, fc = s.far.instanceColor?.array, nc = s.near.instanceColor?.array;
      let a = 0, b = 0;
      for (let i = 0; i < s.n; i++) {
        const o = i * 16, x = s.mats[o + 12], z = s.mats[o + 14];
        if (Math.abs(x - cx) < reach && Math.abs(z - cz) < reach) { nm.set(s.mats.subarray(o, o + 16), b * 16); if (nc) nc.set(s.cols.subarray(i * 3, i * 3 + 3), b * 3); b++; }
        else { fm.set(s.mats.subarray(o, o + 16), a * 16); if (fc) fc.set(s.cols.subarray(i * 3, i * 3 + 3), a * 3); a++; }
      }
      s.far.count = a; s.near.count = b;
      for (const m of [s.far, s.near]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); }
    }
  }
  // simple occupancy list of street objects (x, z, r) used to keep lamps / props apart
  free(x, z, r) { for (const o of this.occ) if (Math.hypot(o[0] - x, o[1] - z) < r + o[2]) return false; return true; }

  // ---------------------------------------------------------------- ground
  lotType(bi) {
    let big = 0, park = 0, n = 0;
    for (const b of this.world.buildings) {
      if (b.gone || b.block !== bi) continue;
      n++;
      if (b.type === 'park') park++;
      if (b.type === 'office' || b.type === 'hq' || b.floors >= 12) big++;
    }
    return park || big || !n ? 0 : 1;
  }
  buildGround() {
    const g = this.g;
    if (g.empty) { this.blockMat = makeGroundMat('block', g); return; }   // no city: the island's own ground everywhere
    const x0 = g.minX, x1 = g.maxX, z0 = g.minZ, z1 = g.maxZ;
    if (!this.roadSet) {
      const road = new QB();
      road.quad([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], [0, 1, 0], {});
      this.roadMat = makeGroundMat('road', g);
      this.add(mesh(road.build(), this.roadMat));
    }
    const blk = new QB({ aBR: 4, aLot: 1 });
    for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
      // with the road kit drawing the sidewalks, a block is its lots (inside the sidewalks); else curb to curb
      const r = blockRect(g, i, j), br = [r.x0, r.z0, r.x1, r.z1], lot = this.lotType(j * g.nx + i), q = this.roadSet ? lotRect(g, i, j) : r;
      blk.box(q.x0, 0, q.z0, q.x1, GROUND_Y, q.z1, face => ({ aBR: br, aLot: face === 't' ? lot : -1 }), 'b');
    }
    // Outskirts at sidewalk height: an endless plain, or on an island (WP4.2) the apron the terrain takes over from, open
    // where island roads leave the city (shared/city-edge.js — the same pieces the driving physics and walking use).
    const y = GROUND_Y, BR = [x0, z0, x1, z1], top = { aBR: BR, aLot: 2 }, curb = { aBR: BR, aLot: -1 };
    if (this.world.terrain) {
      // its own mesh: it changes when an administrator changes the roads (rebuildApron)
    } else {
      const A = 8000, ax0 = x0 - A, ax1 = x1 + A, az0 = z0 - A, az1 = z1 + A;
      blk.quad([[ax0, y, az0], [x0, y, az0], [x0, y, az1], [ax0, y, az1]], [0, 1, 0], top);
      blk.quad([[x1, y, az0], [ax1, y, az0], [ax1, y, az1], [x1, y, az1]], [0, 1, 0], top);
      blk.quad([[x0, y, z1], [x1, y, z1], [x1, y, az1], [x0, y, az1]], [0, 1, 0], top);
      blk.quad([[x0, y, az0], [x1, y, az0], [x1, y, z0], [x0, y, z0]], [0, 1, 0], top);
      blk.quad([[x0, 0, z0], [x0, y, z0], [x0, y, z1], [x0, 0, z1]], [1, 0, 0], curb);
      blk.quad([[x1, 0, z0], [x1, y, z0], [x1, y, z1], [x1, 0, z1]], [-1, 0, 0], curb);
      blk.quad([[x0, 0, z0], [x1, 0, z0], [x1, y, z0], [x0, y, z0]], [0, 0, 1], curb);
      blk.quad([[x0, 0, z1], [x1, 0, z1], [x1, y, z1], [x0, y, z1]], [0, 0, -1], curb);
    }
    this.blockMat = makeGroundMat('block', g);
    this.add(mesh(blk.build(), this.blockMat));
    if (this.world.terrain) this.rebuildApron();
  }
  /** On an island: the apron around the city, open where the island roads leave it (shared/city-edge.js). */
  /** The city's own junctions include the roads that join it: rebuilt with them. */
  rebuildRoads() {
    if (!this.roadSet) return;
    if (this.roadLayer) { this.group.remove(this.roadLayer.group); this.roadLayer.dispose(); }
    this.roadSet = cityRoadSet(this.world.grid, this.world.roads);
    this.roadLayer = new IslandRoadsLayer(this.roadSet, { lift: 0, only: this.roadSet.only });
    this.add(this.roadLayer.group);
  }
  rebuildApron() {
    if (this.roadLayer && this.world.terrain) this.rebuildRoads();
    if (this.apron) { this.group.remove(this.apron); this.apron.geometry.dispose(); this.apron = null; }
    const g = this.g, y = GROUND_Y, BR = [g.minX, g.minZ, g.maxX, g.maxZ], top = { aBR: BR, aLot: 2 }, curb = { aBR: BR, aLot: -1 }, qb = new QB({ aBR: 4, aLot: 1 });
    // a widened city's edge streets draw their own sidewalks just outside its edge and its edge junctions run out to
    // the island's roads: the island's own ground meets them (2026-10-03, the 4-lane/2-lane junctions: no flat
    // slabs of apron beside the road); walking and driving still stand on the apron's height there
    if (this.roadSet) return;
    for (const r of apronRects(g, this.world.roads)) qb.box(r.x0, 0, r.z0, r.x1, y, r.z1, face => (face === 't' ? top : curb), 'b');
    const geo = qb.build();
    if (geo) this.apron = this.add(mesh(geo, this.blockMat));
  }

  // ---------------------------------------------------------------- subway kiosks
  buildStations() {
    for (const m of this.stationMeshes || []) { this.group.remove(m); m.geometry.dispose(); }
    this.stationMeshes = [];
    const f = new FB(), sq = new QB({ uv: 2 });
    for (const st of this.world.stations) {
      // In the city a kiosk stands on the sidewalk, along z; beyond it (WP4.5) on its own pad, turned to face its road.
      const cx = st.x, cz = st.z, rot = st.rot || 0, y = stationY(st), c = Math.cos(rot), sn = Math.sin(rot);
      const W = (lx, lz) => [cx + lx * c + lz * sn, cz - lx * sn + lz * c];
      this.occ.push([cx, cz, 2.6]);
      f.push(cx, y, cz, rot);
      f.col('#08090b'); f.box(-0.52, 0.002, -1.75, 0.52, 0.01, 1.75);
      for (let k = 0; k < 8; k++) { f.col(k % 2 ? '#43474d' : '#2b2e33'); const zz = 1.72 - k * 0.43; f.box(-0.5, 0.011, zz - 0.05, 0.5, 0.013, zz); }
      f.col('#24533a');
      for (const [x, z] of [[-0.6, -1.85], [0.6, -1.85], [-0.6, 1.8], [0.6, 1.8]]) f.box(x - 0.04, 0, z - 0.04, x + 0.04, 2.5, z + 0.04);
      f.box(-0.6, 0.95, -1.85, 0.6, 1.05, -1.8); f.box(-0.64, 1.0, -1.85, -0.56, 1.06, 1.8); f.box(0.56, 1.0, -1.85, 0.64, 1.06, 1.8);
      f.box(-0.72, 2.46, -1.98, 0.72, 2.56, 1.98);
      f.col('#e8e3d6', 0, 2); f.box(-0.5, 2.43, -1.7, 0.5, 2.46, 1.7);
      f.glass('#cfe8f2'); f.box(-0.62, 0.05, -1.82, -0.58, 0.98, 1.78); f.box(0.58, 0.05, -1.82, 0.62, 0.98, 1.78); f.box(-0.58, 0.05, -1.84, 0.58, 0.98, -1.8);
      f.box(-0.62, 1.06, -1.85, -0.58, 2.44, -0.2); f.box(0.58, 1.06, -1.85, 0.62, 2.44, -0.2);
      const s = this.atlas.sign('st:' + st.id, st.name, { logo: 'M', bg: '#173d2a', logoBg: '#c0392b', span: 2 });
      const h = 0.5, w = Math.min(2.2, h * s.aspect * 0.9), y0 = 2.58;
      f.col('#24533a'); f.box(-w / 2 - 0.05, y0 - 0.02, -1.98, w / 2 + 0.05, y0 + h + 0.03, 1.98);
      f.pop();
      for (const side of [1, -1]) {
        const zz = side * 1.99, a = W(-side * w / 2, zz), b = W(side * w / 2, zz), n = [side * sn, 0, side * c];
        sq.quad([[a[0], y + y0, a[1]], [b[0], y + y0, b[1]], [b[0], y + y0 + h, b[1]], [a[0], y + y0 + h, a[1]]], n, null, k => ({ uv: [[s.uv[0], s.uv[1]], [s.uv[2], s.uv[1]], [s.uv[2], s.uv[3]], [s.uv[0], s.uv[3]]][k] }));
      }
    }
    const G = f.build();
    if (G.geo) this.stationMeshes.push(this.add(mesh(G.geo, this.furnMat, { cast: true })));
    if (G.glass) this.stationMeshes.push(this.add(mesh(G.glass, makeFurnMat({ glass: true }), { receive: false })));
    const sg = sq.build();
    if (sg) this.stationMeshes.push(this.add(mesh(sg, this.atlas.mat, { receive: false })));
  }

  // ---------------------------------------------------------------- traffic + pedestrian signals
  buildSignals() {
    if (this.g.empty) return;
    const g = this.g, f = new FB(), discs = [];
    for (let j = 0; j <= g.nz; j++) for (let i = 0; i <= g.nx; i++) {
      const ix = j * (g.nx + 1) + i;
      for (const [bi, bj, c] of [[i - 1, j - 1, 2], [i, j - 1, 3], [i - 1, j, 1], [i, j, 0]]) {
        if (bi < 0 || bj < 0 || bi >= g.nx || bj >= g.nz) continue;
        const r = blockRect(g, bi, bj);
        const cx = (c === 0 || c === 3) ? -1 : 1, cz = (c === 0 || c === 1) ? -1 : 1;
        const ex = cx < 0 ? r.x0 : r.x1, ez = cz < 0 ? r.z0 : r.z1;
        // pole A beside the N-S road (vehicles moving along z), pole B beside the E-W road (along x)
        // one pole per corner, standing before the intersection for the approach whose lanes it overhangs
        const poleA = [ex - cx * 0.5, ez - cz * 5.2, cx, 0, 0, -cz, 0], poleB = [ex - cx * 5.2, ez - cz * 0.5, 0, cz, -cx, 0, 1];
        for (const [px, pz, ax, az, fx, fz, axis] of [(c === 0 || c === 2) ? poleA : poleB]) {
          this.occ.push([px, pz, 1.2]);
          const y = GROUND_Y;
          f.col('#2d3137');
          f.cyl(px, pz, 0.11, y, y + 0.3, 8, 0.1);
          f.cyl(px, pz, 0.07, y + 0.3, y + 5.25, 8, 0.06);
          const hx = px + ax * 2.1, hz = pz + az * 2.1, hy = y + 4.95;
          f.rod([px, y + 5.15, pz], [hx, y + 5.15, hz], 0.04, 5);
          f.rod([hx, y + 5.15, hz], [hx, hy + 0.55, hz], 0.03, 5);
          const yaw = Math.atan2(fx, fz);
          // a US three-lamp head (2026-10-06): red, yellow, green, top to bottom
          f.col('#1c1f24'); f.push(hx, hy, hz, yaw); f.box(-0.19, -0.62, -0.14, 0.19, 0.55, 0.12);
          for (let k = 0; k < 3; k++) { f.col('#111317'); f.box(-0.17, 0.34 - k * 0.33 + 0.12, 0.12, 0.17, 0.34 - k * 0.33 + 0.15, 0.24); }
          f.pop();
          for (let k = 0; k < 3; k++) discs.push({ x: hx + fx * 0.125, y: hy + 0.33 - k * 0.33, z: hz + fz * 0.125, yaw, ix, kind: axis, lamp: k });
          // pedestrian head facing across the crosswalk this pole guards
          const pfx = axis === 0 ? cx : 0, pfz = axis === 0 ? 0 : cz, pyaw = Math.atan2(pfx, pfz);
          const qx = px + pfx * 0.16, qz = pz + pfz * 0.16;
          f.col('#1c1f24'); f.push(qx, y + 2.75, qz, pyaw); f.box(-0.17, -0.2, -0.1, 0.17, 0.2, 0.1); f.pop();
          discs.push({ x: qx + pfx * 0.105, y: y + 2.75, z: qz + pfz * 0.105, yaw: pyaw, ix, kind: 2, lamp: 0, sq: 1 });
        }
      }
    }
    const G = f.build();
    this.add(mesh(G.geo, this.furnMat, { cast: true }));
    const circ = new THREE.CircleGeometry(0.105, 12), sqr = new THREE.PlaneGeometry(0.26, 0.3);
    const mkDiscs = (geo, list) => {
      const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), list.length);
      list.forEach((d, k) => { setInst(im, k, d.x, d.y, d.z, d.yaw); im.setColorAt(k, _c.setRGB(0, 0, 0)); });
      im.instanceMatrix.needsUpdate = true; im.frustumCulled = false;
      this.add(im);
      return { im, list, state: new Int8Array(list.length).fill(-1) };
    };
    this.veh = mkDiscs(circ, discs.filter(d => !d.sq));
    this.ped = mkDiscs(sqr, discs.filter(d => d.sq));
    this.nIx = (g.nx + 1) * (g.nz + 1);
    this.ixState = new Int16Array(this.nIx * 3);
  }
  updateSignals(t, realT) {
    const S = this.ixState, blink = (realT % 1) < 0.55 ? 1 : 0;
    for (let ix = 0; ix < this.nIx; ix++) { S[ix * 3] = sigLight(ix, t, 0); S[ix * 3 + 1] = sigLight(ix, t, 1); S[ix * 3 + 2] = pedLight(ix, t); }
    const on = (d) => {
      if (d.kind === 2) { const p = S[d.ix * 3 + 2]; return p === 2 ? 2 : p === 1 ? (blink ? 1 : 0) : 1; }
      const l = S[d.ix * 3 + d.kind];
      return d.lamp === 0 ? (l === 0 || l === 3) : d.lamp === 1 ? l === 1 : l === 2;   // the protected-left time (3) shows red
    };
    const VC = SIGNAL_LAMPS;
    for (const set of [this.veh, this.ped]) {
      let dirty = false;
      set.list.forEach((d, k) => {
        const v = +on(d);
        if (set.state[k] === v) return;
        set.state[k] = v; dirty = true;
        if (d.kind === 2) {
          if (v === 2) _c.setRGB(3.2, 3.6, 3.9); else if (v === 1) _c.setRGB(5.5, 1.7, 0.25); else _c.setRGB(0.05, 0.02, 0.01);
        } else { const c = VC[d.lamp][v ? 1 : 0]; _c.setRGB(c[0], c[1], c[2]); }
        set.im.setColorAt(k, _c);
      });
      if (dirty) set.im.instanceColor.needsUpdate = true;
    }
  }

  /** The road kit's signal poles and mast arms (2026-10-03: no tree growing out of a signal pole): street items keep
   *  clear of them; trees whose crowns would meet them are left out (render/road-signals.js draws them). */
  keepClearOfSignals() {
    this.signalSpots = [];
    for (const P of this.roadSet.plans.values()) for (const sg of P.signals) {
      const A = P.arms[sg.arm];
      for (let r = 0; r <= sg.reach; r += 1) this.signalSpots.push([sg.x + A.n.x * r, sg.z + A.n.z * r]);
      this.occ.push([sg.x, sg.z, 1.0]);
    }
  }
  nearSignal(x, z, r) { for (const [px, pz] of this.signalSpots || []) if (Math.hypot(px - x, pz - z) < r) return true; return false; }
  // ---------------------------------------------------------------- street trees
  buildTrees() {
    const geos = [0, 1, 2].map(k => {
      const f = new FB();
      f.col('#33363a'); f.box(-0.62, 0, -0.62, 0.62, 0.014, 0.62); f.col('#4a3a2a'); f.box(-0.48, 0, -0.48, 0.48, 0.02, 0.48);
      if (k === 0) treeRound(f, 6.8, 1, 3); else if (k === 1) treeColumn(f, 8, 0.95, 5); else treePine(f, 7.6, 0.9);
      return f.build().geo;
    });
    const groups = [[], [], []];
    for (const t of this.world.trees) { if (this.nearSignal(t[0], t[1], 2.8)) continue; groups[TREE_KIND[t[2]] ?? 0].push(t); this.occ.push([t[0], t[1], 0.8]); }
    this.treeMeshes = groups.map((list, k) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geos[k], this.furnMat, list.length);
      list.forEach((t, n) => {
        setInst(im, n, t[0], GROUND_Y, t[1], hsh(Math.round(t[0] * 10), Math.round(t[1] * 10)) * 6.28, t[3]);
        im.setColorAt(n, _c.set(LEAF[t[2]] || LEAF[0]).multiplyScalar(0.9 + 0.2 * hsh(n, 7)));
      });
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      return this.add(im);
    });
  }

  // ---------------------------------------------------------------- street lights + night light map
  buildLamps() {
    const g = this.g, spots = [];
    if (g.empty) { this.lamps = spots; return; }   // (the roads' own lamps light the island: render/island-roads.js)
    const tryAt = (list) => { for (const [x, z, face, hx, hz] of list) if (this.free(x, z, 1.6)) { this.occ.push([x, z, 1.0]); spots.push({ x, z, face, hx, hz }); return true; } return false; };
    for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
      const r = blockRect(g, i, j), inset = 0.55;
      const sides = [
        { face: 0, L: r.x1 - r.x0, at: t => [r.x0 + t, r.z1 - inset], d: [0, 1] },
        { face: 2, L: r.x1 - r.x0, at: t => [r.x1 - t, r.z0 + inset], d: [0, -1] },
        { face: 1, L: r.z1 - r.z0, at: t => [r.x1 - inset, r.z0 + t], d: [1, 0] },
        { face: 3, L: r.z1 - r.z0, at: t => [r.x0 + inset, r.z1 - t], d: [-1, 0] },
      ];
      for (const s of sides) {
        const n = Math.max(2, Math.round((s.L - 16) / 17) + 1);
        for (let k = 0; k < n; k++) {
          const t0 = 8 + (s.L - 16) * k / (n - 1);
          const cands = [0, 1.8, -1.8, 3.4, -3.4, 5, -5].map(o => {
            const t = Math.min(s.L - 7.5, Math.max(7.5, t0 + o)), [x, z] = s.at(t);
            return [x, z, s.face, x + s.d[0] * 1.8, z + s.d[1] * 1.8];
          });
          tryAt(cands);
        }
      }
    }
    const f = new FB();
    f.col('#3a3e44'); f.cyl(0, 0, 0.13, 0, 0.35, 8, 0.1); f.cyl(0, 0, 0.075, 0.35, 6.7, 8, 0.055);
    f.rod([0, 6.4, 0], [0, 6.75, 0.9], 0.045, 6); f.rod([0, 6.75, 0.9], [0, 6.72, 1.75], 0.04, 6);
    f.col('#2c3036'); f.box(-0.2, 6.6, 1.4, 0.2, 6.76, 2.05);
    f.col('#ffe2a6', 0, 2); f.box(-0.16, 6.58, 1.45, 0.16, 6.6, 2.0);
    const im = new THREE.InstancedMesh(f.build().geo, this.furnMat, spots.length);
    spots.forEach((s, k) => { setInst(im, k, s.x, GROUND_Y, s.z, [0, Math.PI / 2, Math.PI, -Math.PI / 2][s.face]); im.setColorAt(k, _c.setRGB(1, 1, 1)); });
    im.castShadow = true; im.userData.smallCaster = true; im.computeBoundingSphere();
    this.add(im);
    this.lamps = spots;
    this.bakeLightMap(spots);
  }
  bakeLightMap(spots) {
    const g = this.g, pad = 30;
    const rx = g.minX - pad, rz = g.minZ - pad, rw = g.maxX - g.minX + 2 * pad, rh = g.maxZ - g.minZ + 2 * pad;
    const W = 1024, H = Math.round(1024 * rh / rw), s = W / rw;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
    const blob = (x, z, R, a) => {
      const px = (x - rx) * s, pz = (z - rz) * s, rr = R * s;
      const gr = c.createRadialGradient(px, pz, 0, px, pz, rr);
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.4, `rgba(255,255,255,${a * 0.45})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.fillRect(px - rr, pz - rr, 2 * rr, 2 * rr);
    };
    for (const p of spots) blob(p.hx, p.hz, 11, 0.8);
    for (const st of this.world.stations) blob(st.x, st.z, 5, 0.5);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace; tex.flipY = false;
    tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    GU.uLightMap.value = tex;
    GU.uLightRect.value.set(rx, rz, rw, rh);
  }

  // ---------------------------------------------------------------- props: bins, hydrants, benches
  buildProps() {
    const g = this.g, bins = [], hyd = [], benches = [];
    for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
      const r = blockRect(g, i, j), h = hsh(i * 31 + 7, j * 17 + 3);
      const cand = [
        [[r.x0 + 6.6, r.z0 + 0.6], [r.x1 - 0.6, r.z0 + 6.6], [r.x1 - 6.6, r.z1 - 0.6], [r.x0 + 0.6, r.z1 - 6.6]],
      ][0];
      cand.forEach((p, k) => { if ((h * 7 + k) % 2 < 1.2 && this.free(p[0], p[1], 0.9)) { bins.push([p[0], p[1], k]); this.occ.push([p[0], p[1], 0.5]); } });
      for (const [x, z] of [[(r.x0 + r.x1) / 2 + (h - 0.5) * 12, r.z1 - 0.5], [r.x0 + 0.5, (r.z0 + r.z1) / 2 + 6]]) {
        for (const o of [0, 2.5, -2.5, 4.5, -4.5]) {
          const px = z === r.z1 - 0.5 ? x + o : x, pz = z === r.z1 - 0.5 ? z : z + o;
          if (this.free(px, pz, 1.1)) { hyd.push([px, pz]); this.occ.push([px, pz, 0.5]); break; }
        }
      }
    }
    const fb = new FB();
    fb.col('#2f4f3a'); fb.lathe(0, 0, [[0.2, 0], [0.24, 0.9], [0.26, 0.92], [0.26, 0.97], [0, 0.97]], 10);
    fb.col('#1c1e21'); fb.cyl(0, 0, 0.18, 0.97, 1.0, 10);
    const fh = new FB();
    fh.col('#c0392b'); fh.cyl(0, 0, 0.13, 0, 0.08, 8); fh.cyl(0, 0, 0.1, 0.08, 0.62, 8); fh.sph(0, 0.62, 0, 0.1, 0.09, 0.1, 8, 5);
    fh.col('#d4d4d4'); fh.rod([-0.18, 0.42, 0], [0.18, 0.42, 0], 0.045, 6);
    for (const [geo, list] of [[fb.build().geo, bins], [fh.build().geo, hyd]]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo, this.furnMat, list.length);
      list.forEach((p, k) => { setInst(im, k, p[0], GROUND_Y, p[1], hsh(k, 3) * 6.28); im.setColorAt(k, _c.setRGB(1, 1, 1)); });
      im.castShadow = true; im.userData.smallCaster = true; im.computeBoundingSphere();
      this.add(im);
    }
    void benches;
  }

  // ---------------------------------------------------------------- walkways from building doors to the sidewalk
  buildPaths() {
    if (this.pathMesh) { this.group.remove(this.pathMesh); this.pathMesh.geometry.dispose(); }
    const q = new QB({ aPat: 1, aFC: 3, aL: 2 }), g = this.g, fin = FINISHES.paving, col = lin(fin.color);
    for (const b of this.world.buildings) {
      if (b.gone || b.type === 'park' || !b.door) continue;
      const blk = blockAt(g, b.x, b.z); if (!blk) continue;
      const lot = lotRect(g, blk.i, blk.j), fp = footprint(b);
      const r = ((b.rot % 360) + 360) % 360;
      const setback = r === 0 ? lot.z1 - fp.z1 : r === 180 ? fp.z0 - lot.z0 : r === 90 ? lot.x1 - fp.x1 : fp.x0 - lot.x0;
      if (setback < 0.2) continue;
      const hw = b.door.w / 2 + 0.5, y = GROUND_Y + 0.006;
      const pts = [[b.door.x - hw, b.d / 2], [b.door.x + hw, b.d / 2], [b.door.x + hw, b.d / 2 + setback + 0.05], [b.door.x - hw, b.d / 2 + setback + 0.05]]
        .map(([lx, lz]) => { const w = toWorld(b, lx, lz); return [w.x, y, w.z]; });
      q.quad(pts, [0, 1, 0], null, k => ({ aPat: fin.pattern, aFC: col, aL: [pts[k][0], pts[k][2]] }));
    }
    const geo = q.build();
    if (!geo) return;
    this.pathMesh = mesh(geo, this.pathMat || (this.pathMat = makeFloorMat({ lit: true })));
    this.add(this.pathMesh);
  }
  update(t, realT) { if (this.veh) this.updateSignals(t, realT); }
}
