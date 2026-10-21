// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Decorations on the land (WP4.7, shared/decor.js): the outdoor items people place outside buildings - trees, bushes,
// flower beds, benches, picnic tables, fountains - one instanced mesh per kind (and its glass), standing on the ground
// (the city's lots, or the terrain beyond the city). Rebuilt when the list or the ground changes.
import * as THREE from 'three';
import { furnitureGeometry } from './furniture.js';
import { makeFurnMat } from './mats.js';
import { GROUND_Y } from '/shared/constants.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();

export class DecorLayer {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group(); this.group.name = 'decor';
    this.mat = makeFurnMat({ lit: true }); this.glass = makeFurnMat({ glass: true });
    app.stage.scene.add(this.group);
    this.list = [];
  }
  /** The ground's height under (x, z): the city's lots, else the island. */
  y(x, z) {
    const g = this.app.city?.g, T = this.app.terrain;
    if (T?.ground && g && (x < g.minX || x > g.maxX || z < g.minZ || z > g.maxZ)) return T.heightAt(x, z);
    return GROUND_Y;
  }
  set(list) {
    this.list = list || [];
    for (const m of [...this.group.children]) { this.group.remove(m); m.dispose(); }
    const by = new Map();
    for (const d of this.list) { let a = by.get(d.t); if (!a) by.set(d.t, a = []); a.push(d); }
    for (const [t, arr] of by) {
      const G = furnitureGeometry(t);
      for (const [geo, mat, cast] of [[G.geo, this.mat, true], [G.glass, this.glass, false]]) {
        if (!geo) continue;
        const im = new THREE.InstancedMesh(geo, mat, arr.length);
        arr.forEach((d, k) => { _q.setFromAxisAngle(_up, d.r || 0); _p.set(d.x, this.y(d.x, d.z), d.z); im.setMatrixAt(k, _m.compose(_p, _q, _s)); im.setColorAt(k, _c.set(d.c || '#ffffff')); });
        im.castShadow = cast; im.receiveShadow = true; im.userData.smallCaster = true; im.computeBoundingSphere();
        this.group.add(im);
      }
    }
  }
  /** The decoration nearest ground point (x, z) within r m, or null. */
  at(x, z, r = 1.6) {
    let best = null, bd = r;
    for (const d of this.list) { const dd = Math.hypot(d.x - x, d.z - z); if (dd < bd) { bd = dd; best = d; } }
    return best;
  }
}
