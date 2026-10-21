// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What people have in front of them (shared/food.js, the models: render/food-models.js): the dish someone ordered on
// the table at their place, the drink beside it, a pan or a pot on the stove while someone cooks at home. One batched
// mesh draws every item near the camera in one call (and one for glass); an item's geometry is added the first time it
// is wanted. render/agents.js says each frame who has what (place()), from the item their plan carries (shared/proto.js).
import * as THREE from 'three';
import { makeFurnMat } from './mats.js';
import { foodGeometry } from './food-models.js';
import { FOOD_BY_N } from '/shared/food.js';
import { CLIP } from './anim.js';
import { isEating } from './char-props.js';
import { STOVE_PAN, PREP_BOARD } from '/shared/eating.js';

// where a table's top is from a seated person's feet, and how far ahead of them their place is
const TABLE = { y: 0.762, fwd: 0.46 }, BAR = { y: 0.815, fwd: 0.42 };
const AT_TABLE = new Set(['sit_eat', 'sit_talk', 'sit_type', 'sit_phone', 'sit', 'sit_drink'].map(n => CLIP[n]).filter(c => c !== undefined));
const SIP = CLIP.sit_drink;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);

class Batch {
  constructor(group, mat, cap) {
    this.group = group; this.mat = mat; this.cap = cap; this.verts = 60000; this.index = 150000;
    this.mesh = null; this.ids = new Map(); this.used = 0; this.pool = [];
  }
  make() {
    const m = new THREE.BatchedMesh(this.cap, this.verts, this.index, this.mat);
    m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.sortObjects = this.mat.transparent;
    this.group.add(m);
    this.mesh = m;
  }
  /** The batch's id of a geometry (added now if new; the batch grows when full). */
  geo(key, g) {
    let id = this.ids.get(key);
    if (id !== undefined) return id;
    if (!this.mesh) this.make();
    const nv = g.attributes.position.count, ni = g.index.count;
    const used = [...this.ids.values()].reduce((s, i) => { const r = this.mesh.getGeometryRangeAt(i); return [s[0] + r.reservedVertexCount, s[1] + r.reservedIndexCount]; }, [0, 0]);
    if (used[0] + nv > this.verts || used[1] + ni > this.index) {
      while (used[0] + nv > this.verts) this.verts = Math.ceil(this.verts * 1.6);
      while (used[1] + ni > this.index) this.index = Math.ceil(this.index * 1.6);
      this.mesh.setGeometrySize(this.verts, this.index);
    }
    id = this.mesh.addGeometry(g);
    this.ids.set(key, id);
    return id;
  }
  begin() { this.used = 0; }
  add(key, g, matrix) {
    const gid = this.geo(key, g);
    if (this.used >= this.cap) return;
    let iid = this.pool[this.used];
    if (iid === undefined) { iid = this.mesh.addInstance(gid); this.pool.push(iid); }
    else this.mesh.setGeometryIdAt(iid, gid);
    this.mesh.setMatrixAt(iid, matrix); this.mesh.setVisibleAt(iid, true);
    this.used++;
  }
  end() { if (!this.mesh) return; for (let k = this.used; k < this.pool.length; k++) this.mesh.setVisibleAt(this.pool[k], false); }
}

export class FoodTable {
  constructor(group, cap = 320) {
    this.group = new THREE.Group(); this.group.name = 'food'; group.add(this.group);
    this.solid = new Batch(this.group, makeFurnMat({ lit: true, indoor: true }), cap);
    this.glass = new Batch(this.group, makeFurnMat({ glass: true }), cap);
  }
  begin() { this.solid.begin(); this.glass.begin(); }
  /** Item n at a spot in someone's frame: (lx left, ly up, lz ahead) from (x, y, z), turned yaw. cook: the pan/pot;
   *  eat: being eaten — 'hand' (a piece of it in the hands) or 'tools' (the cutlery in the hands, not by the plate). */
  put(n, cook, x, y, z, yaw, lx, ly, lz, eat = '') {
    const g = foodGeometry(n, cook, eat === 'tools', eat === 'hand');
    if (!g.geo && !g.glass) return;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    _p.set(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
    _m.compose(_p, _q.setFromAxisAngle(UP, yaw), _s);
    const key = (cook ? -n : n) + (eat === 'tools' ? 1000 : eat === 'hand' ? 2000 : 0);
    if (g.geo) this.solid.add(key, g.geo, _m);
    if (g.glass) this.glass.add(key, g.glass, _m);
  }
  /**
   * Someone at (x, y, z) facing yaw, in plan clip `raw` (drawn as `clip`), with item n (0: none) and side n2 (a drink
   * ordered with it, still on the table), doing `use`: 'cook' (the pan on the stove's burner before them, shared/eating.js
   * STOVE_PAN), 'prep' (the dish made cold on the counter's board, PREP_BOARD). What they hold is char-props' (a drink
   * being sipped, the food eaten in the hands); the rest is put here.
   */
  place(x, y, z, yaw, raw, clip, n, n2, use = '') {
    const it = FOOD_BY_N[n];
    if (!it) return;
    if (use === 'cook') { if (!it.v) this.put(n, true, x, y, z, yaw, STOVE_PAN[0], STOVE_PAN[1], STOVE_PAN[2]); return; }
    if (use === 'prep') { if (!it.v) this.put(n, false, x, y, z, yaw, PREP_BOARD[0], PREP_BOARD[1], PREP_BOARD[2], 'tools'); return; }
    if (!AT_TABLE.has(raw) && raw !== CLIP.sit_high) return;   // (standing, walking, on a sofa: in the hand or nothing)
    const T = raw === CLIP.sit_high ? BAR : TABLE, typing = raw === CLIP.sit_type;
    if (it.v) {   // a drink: on the table unless it is being sipped (in the hand: render/char-props.js)
      if (clip === SIP) return;
      this.put(n, false, x, y, z, yaw, typing ? -0.27 : -0.2, T.y, T.fwd - 0.08);
      return;
    }
    // eaten (render/char-props.js eatClip): by hand, the piece in the hands is off the plate; with cutlery, the cutlery
    // is in the hands
    const eat = isEating(clip) ? (it.eat === 'hands' || it.eat === 'hand' ? 'hand' : 'tools') : '';
    this.put(n, false, x, y, z, yaw, 0, T.y, T.fwd, eat);
    if (n2 && FOOD_BY_N[n2]?.v) this.put(n2, false, x, y, z, yaw, -0.21, T.y, T.fwd - 0.1);
  }
  end() { this.solid.end(); this.glass.end(); }
  count() { return this.solid.used; }
}

/** The drink still on the table beside course k (ordered with it: an earlier segment at the same seat), else 0. */
export function sideDrink(p, k) {
  const x = p.x[k], z = p.z[k];
  for (let j = k - 1; j >= 0 && j >= k - 6; j--) {
    if (Math.abs(p.x[j] - x) > 0.01 || Math.abs(p.z[j] - z) > 0.01) return 0;
    const n = p.veh[j];
    if (n && FOOD_BY_N[n]?.v) return n;
  }
  return 0;
}
