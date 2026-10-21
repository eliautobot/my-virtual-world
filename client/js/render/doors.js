// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Doors on the floor being looked at (2026-10-05: "doors on buildings and apartments ... make them open and close"):
// the floor's doors (shared/doors.js levelDoors) as wooden leaves that swing - one leaf, or two on a wide doorway - and
// the glass doors of shops and offices that slide apart. A door opens when someone comes within reach of it (a
// resident, or the player) and closes again behind them; a click or tap on a door holds it open (or lets it close).
// Doors are as tall as the walls let them be in the cutaway. (Who may pass a locked flat door comes with the flats.)
import * as THREE from 'three';
import { S } from '../core/state.js';
import { levelDoors } from '/shared/doors.js';
import { floorAt, ctxOf } from '/shared/constants.js';
import { bRot } from '/shared/geom.js';
import { WALL_H } from './interiors.js';
import { mayEnter } from '../ui/flats.js';
import { post } from '../core/net.js';

const REACH2 = 1.45 * 1.45, SPEED = 2.6, SWING = 1.55, THICK = 0.045, MAX = 400;
const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
const _rc = new THREE.Raycaster();   // (door picking: the camera ray, cast against the door leaves)

export class Doors {
  constructor(scene, app) {
    this.app = app;
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.wood = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x9a7452, roughness: 0.65 }), MAX);
    this.glass = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0xcfe6ef, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false }), MAX);
    for (const m of [this.wood, this.glass]) { m.count = 0; m.frustumCulled = false; m.castShadow = m === this.wood; m.receiveShadow = true; scene.add(m); }
    this.doors = []; this.leaves = []; this.key = ''; this.frame = 0;
  }
  /** The doors of the focused floor (S.focus) for wall mode `mode` (cut / up / down). */
  build(focus = S.focus, mode = S.walls) {
    const B = focus.b >= 0 ? S.world.buildings[focus.b] : null, L = B ? S.world.levels[B.lv[focus.f]] : null;
    const H = WALL_H[mode] ?? WALL_H.cut, h = Math.min(2.1, H - 0.06);
    this.doors = []; this.leaves = []; this.wood.count = 0; this.glass.count = 0; this.focus = { b: focus.b, f: focus.f };
    if (!B || !L || h < 0.5) return;
    this.B = B; this.ctx = ctxOf(B.idx ?? focus.b, focus.f); this.base = new THREE.Matrix4().makeRotationY(bRot(B)).setPosition(B.x, floorAt(B, focus.f), B.z);
    const c = Math.cos(bRot(B)), s = Math.sin(bRot(B));
    for (const d of levelDoors(B, focus.f, L)) {
      const ax = d.axis === 'x' ? [1, 0] : [0, 1], nv = d.axis === 'x' ? [0, d.swing] : [d.swing, 0];
      const door = { ...d, t: 0, want: 0, held: !!S.world.doors?.[`${focus.b}:${focus.f}:${d.key}`], wx: B.x + d.x * c + d.z * s, wz: B.z - d.x * s + d.z * c, h: d.kind === 'entrance' ? Math.min(2.4, H - 0.06) : h };
      const i = this.doors.push(door) - 1, w = d.w - 0.04;
      if (d.style === 'slide') for (const sg of [-1, 1]) this.leaves.push({ i, slide: true, sg, ax, w: w / 2, glass: true });
      // a hinged leaf: its hinge, and the way it points when shut (hinge → free edge)
      else if (d.style === 'double') for (const sg of [-1, 1]) this.leaves.push({ i, nv, w: w / 2, hinge: [d.x + sg * ax[0] * w / 2, d.z + sg * ax[1] * w / 2], d0: [-sg * ax[0], -sg * ax[1]], glass: d.glass });
      else this.leaves.push({ i, nv, w, hinge: [d.x - ax[0] * w / 2, d.z - ax[1] * w / 2], d0: ax, glass: d.glass });
    }
    for (const lf of this.leaves) lf.slot = (lf.glass ? this.glass : this.wood).count++;
    for (const m of [this.wood, this.glass]) m.count = Math.min(MAX, m.count);
    this.place(true);
  }
  /** Leaf matrices for the doors' open amounts (only the doors that moved, unless all). */
  place(all = false) {
    let dw = false, dg = false;
    for (const lf of this.leaves) {
      const d = this.doors[lf.i];
      if (!all && !d.moved) continue;
      const t = d.t * d.t * (3 - 2 * d.t);
      let cx, cz, dx, dz;
      if (lf.slide) {   // the glass slides away from the middle
        const off = lf.sg * (lf.w / 2 + t * lf.w * 0.92);
        cx = d.x + lf.ax[0] * off; cz = d.z + lf.ax[1] * off; dx = lf.ax[0]; dz = lf.ax[1];
      } else {   // the leaf turns on its hinge toward the side it opens to
        const a = t * SWING;
        dx = Math.cos(a) * lf.d0[0] + Math.sin(a) * lf.nv[0]; dz = Math.cos(a) * lf.d0[1] + Math.sin(a) * lf.nv[1];
        cx = lf.hinge[0] + dx * lf.w / 2; cz = lf.hinge[1] + dz * lf.w / 2;
      }
      _q.setFromAxisAngle(_y, Math.atan2(-dz, dx));
      _l.compose(_p.set(cx, d.h / 2 + 0.01, cz), _q, _s.set(lf.w, d.h, lf.slide ? 0.03 : THICK));
      _m.multiplyMatrices(this.base, _l);
      (lf.glass ? this.glass : this.wood).setMatrixAt(lf.slot, _m);
      if (lf.glass) dg = true; else dw = true;
    }
    if (dw) this.wood.instanceMatrix.needsUpdate = true;
    if (dg) this.glass.instanceMatrix.needsUpdate = true;
  }
  /** The door a ray hits (a world click: the camera's THREE.Ray, cam.rayAt), or null. (It was handed to intersectObjects,
   *  which a Ray doesn't have: every click inside a building with doors threw before anything else could be picked.) */
  pick(ray) {
    if (!this.doors.length) return null;
    _rc.ray.copy(ray);
    const hits = _rc.intersectObjects([this.wood, this.glass], false);
    if (!hits.length) return null;
    const h = hits[0], lf = this.leaves.find(l => (l.glass ? this.glass : this.wood) === h.object && l.slot === h.instanceId);
    return lf ? this.doors[lf.i] : null;
  }
  /** Holds a door open, or lets it close again - for everyone (op door.set; the server says no to a locked flat's door). */
  toggle(d) {
    if (d.kind === 'flat' && !d.held && !mayEnter(this.B, this.focus.f, d.u, -1)) return false;   // locked, and not yours
    d.held = !d.held;
    d.want = d.held ? 1 : d.want;
    this.frame = 0;
    post('/api/edit', { ops: [{ op: 'door.set', b: this.focus.b, f: this.focus.f, key: d.key, open: d.held }], who: 'web' }).catch(err => { d.held = !d.held; this.app.toast?.(err.message, 'bad', 2400); });
    return true;
  }
  /** Doors held open or shut by anyone (a 'doors' patch). */
  sync() { for (const d of this.doors) { const h = !!S.world.doors?.[`${this.focus.b}:${this.focus.f}:${d.key}`]; if (h !== d.held) { d.held = h; d.want = h ? 1 : d.want; this.frame = 0; } } }
  /** Opens the doors someone is near, closes the others (who is near: every third frame). */
  update(dt) {
    if (!this.doors.length) return;
    if (this.frame++ % 3 === 0) {
      const A = this.app.agents, P = this.app.player, near = [];
      if (A) for (let i = 0; i < A.n; i++) if (A.ctx[i] === this.ctx || (A.ctx[i] === -1 && this.doors.some(d => d.kind === 'entrance'))) near.push(A.rx[i], A.rz[i], i);
      if (P && P.active) near.push(P.x, P.z, -1);
      for (const d of this.doors) {
        let open = 0;
        // a locked flat's door opens only for its people (its owner, tenants, visitors, whoever lives there)
        for (let k = 0; k < near.length && !open; k += 3) { const ex = near[k] - d.wx, ez = near[k + 1] - d.wz; if (ex * ex + ez * ez < REACH2 && (d.kind !== 'flat' || mayEnter(this.B, this.focus.f, d.u, near[k + 2]))) open = 1; }
        d.want = open || d.held ? 1 : 0;
      }
    }
    let any = false;
    for (const d of this.doors) {
      d.moved = false;
      if (d.t === d.want) continue;
      d.t = d.want > d.t ? Math.min(1, d.t + dt * SPEED) : Math.max(0, d.t - dt * SPEED * 0.8);
      d.moved = any = true;
    }
    if (any) this.place();
  }
}
