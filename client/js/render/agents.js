// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents: evaluates every server motion plan each frame (piecewise-linear segments in absolute sim time), decides who
// is visible (outdoors, parks, the focused floor), animates them (gait phase locked to distance travelled, clip
// cross-fades, yaw smoothing, error smoothing when a plan is replaced) and draws them through the instanced character
// renderer (distance LOD + frustum culling). Also: screen-space picking and a selection ring.
import * as THREE from 'three';
import { S } from '../core/state.js';
import { Characters } from './characters.js';
import { CLIP, CLIP_DUR, CLIP_STRIDE } from './anim.js';
import { holdClip, eatClip } from './char-props.js';
import { FoodTable, sideDrink } from './food-table.js';
import { arrToApp } from '/shared/appearance.js';
import { USE_ID } from '/shared/catalog.js';
import { evalDecoded as evalPlan } from '/shared/proto.js';

export const F_HIDDEN = 1, F_FACE = 2, F_TRAVEL = 4, F_SNAP = 8;
export const PLAYER_APP = 12000;
const LOOK_AT_PHONE = new Set([USE_ID.task_phone]);   // (working on a task by phone: always looking at it, never a call)
const GAIT_V = new Float32Array(64);
GAIT_V[CLIP.walk] = GAIT_V[CLIP.walk_hold] = GAIT_V[CLIP.walk_phone] = 1.35; GAIT_V[CLIP.run] = 3.4; GAIT_V[CLIP.jog] = 2.6;
const FADE = 0.28, TAU = Math.PI * 2;
const _v = new THREE.Vector3(), _e = { k: 0, u: 0, x: 0, y: 0, z: 0 };

/** Position of plan p at sim time t: the shared evaluator (shared/proto.js evalDecoded), unit-tested against the server. */
export { evalPlan };

export class Agents {
  constructor(net, stage) {
    this.net = net; this.stage = stage;
    // Phones (2026-10-04, the phone slowed right down after loading): characters' colour maps at most 1024 square (a
    // person fills a few hundred pixels of a phone's screen at most), normal maps half that, two downloading at a time
    // (each is a worker decoding and a GPU upload) — 2048 maps were a quarter of a gigabyte of the phone's memory per 10.
    const phone = matchMedia('(pointer: coarse)').matches, mapSize = phone ? Math.min(1024, stage.q.charMap) : stage.q.charMap;
    this.chars = new Characters({ capacity: 4096, shadows: stage.q.shadows, renderer: stage.renderer, mapSize, normalSize: phone ? mapSize / 2 : mapSize, warmAll: false, concurrency: phone ? 2 : 4 });
    this.frame = 0; this.n = 0;
    this.stagger = stage.q.name === 'high' ? 3 : 7;   // re-evaluate not-drawn residents every 4th (High) / 8th frame
    this.ensure(4096);
    this.frustum = new THREE.Frustum(); this.pv = new THREE.Matrix4();
    this.stats = { out: 0, inside: 0, moving: 0, under: 0, drawn: 0 };
    this.extra = [];
    this.parkB = new Uint8Array(0);
    this.nDrawn = 0;
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xf0f0f0, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 40).rotateX(-Math.PI / 2), ringMat);
    this.ring.visible = false; this.ring.renderOrder = 2; this.ring.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.add(this.chars.group, this.ring);
    this.food = new FoodTable(this.group);   // what people eat and drink, on their tables (render/food-table.js)
  }
  ensure(n) {
    if (n <= this.n) return;
    const m = Math.max(n, this.n * 2 || 1024), old = this.n;
    const grow = (a, T) => { const b = new T(m); if (a) b.set(a.subarray(0, old)); return b; };
    this.k = grow(this.k, Int32Array); this.ver = grow(this.ver, Uint32Array); this.seen = grow(this.seen, Uint8Array);
    this.yaw = grow(this.yaw, Float32Array);
    this.ox = grow(this.ox, Float32Array); this.oy = grow(this.oy, Float32Array); this.oz = grow(this.oz, Float32Array);
    this.rx = grow(this.rx, Float32Array); this.ry = grow(this.ry, Float32Array); this.rz = grow(this.rz, Float32Array);
    this.ctx = grow(this.ctx, Int32Array); this.vis = grow(this.vis, Uint8Array); this.use = grow(this.use, Uint8Array);
    this.fl = grow(this.fl, Uint8Array); this.mov = grow(this.mov, Uint8Array);
    this.clip = grow(this.clip, Int16Array); this.pclip = grow(this.pclip, Int16Array);
    this.pph = grow(this.pph, Float32Array); this.lph = grow(this.lph, Float32Array);
    this.fadeT = grow(this.fadeT, Float64Array); this.last = grow(this.last, Int32Array);
    for (let i = old; i < m; i++) { this.clip[i] = -1; this.ctx[i] = -2; this.last[i] = -9; this.fadeT[i] = -1e9; }
    this.drawn = new Int32Array(m);
    this.n = m;
  }
  refreshWorld(world) {
    const B = world.buildings;
    this.parkB = new Uint8Array(B.length);
    B.forEach((b, i) => { if (b && !b.gone && b.type === 'park') this.parkB[i] = 1; });
  }
  setAppearance(i, arr) { if (i < PLAYER_APP) this.ensure(i + 1); this.chars.setAppearance(i, Array.isArray(arr) ? arrToApp(arr) : arr); }
  onNewPlan(i, p, t) {
    this.ver[i] = this.net.planVer[i];
    evalPlan(p, t, _e);
    this.k[i] = _e.k;
    if (!this.seen[i]) { this.seen[i] = 1; this.ox[i] = this.oy[i] = this.oz[i] = 0; return; }
    const dx = this.rx[i] - _e.x, dy = this.ry[i] - _e.y, dz = this.rz[i] - _e.z;
    if (dx * dx + dz * dz < 12 && Math.abs(dy) < 0.6 && p.ctx[_e.k] === this.ctx[i]) { this.ox[i] = dx; this.oy[i] = dy; this.oz[i] = dz; }
    else { this.ox[i] = this.oy[i] = this.oz[i] = 0; this.last[i] = -9; }
  }
  update(dt, now) {
    const net = this.net, plans = net.plans, pver = net.planVer;
    const chars = this.chars;
    chars.begin(); this.food.begin();
    if (!net.clock) { chars.end(); this.food.end(); return; }
    const t = net.simNow(), N = Math.min(plans.length, pver.length);
    this.ensure(N);
    const cam = this.stage.camera, cp = cam.position, q = this.stage.q;
    this.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const PL = this.frustum.planes;
    const fb = S.focus.b, ff = S.focus.f, parkB = this.parkB, sel = S.sel, hov = S.hover;
    const L0 = q.lod0 * q.lod0, L1 = q.lod1 * q.lod1, L2 = q.lod2 * q.lod2;
    const ky = 1 - Math.exp(-dt * 12), ko = Math.exp(-dt * 4.5);
    const frame = ++this.frame;
    let out = 0, inside = 0, moving = 0, under = 0, nd = 0;
    for (let i = 0; i < N; i++) {
      const p = plans[i];
      if (!p || !p.n) { this.vis[i] = 0; continue; }
      // Most residents are indoors or off screen. One not drawn last frame is re-evaluated every 4th/8th frame (staggered),
      // keeping its last position and counts meanwhile; anyone drawn, selected, hovered or with a new plan every frame.
      if (this.last[i] !== frame - 1 && pver[i] === this.ver[i] && i !== sel && i !== hov && ((i + frame) & this.stagger)) {
        const c0 = this.ctx[i];
        if (c0 === -1) out++; else if (c0 < -1) under++; else inside++;
        if (this.mov[i]) moving++;
        continue;
      }
      if (pver[i] !== this.ver[i]) this.onNewPlan(i, p, t);
      const n = p.n, T = p.t0, rel = t - p.base;
      let k = this.k[i], x, y, z, u;
      if (rel <= 0) { k = 0; u = 0; x = p.sx; y = p.sy; z = p.sz; }
      else if (rel >= T[n]) { k = n - 1; u = 1; x = p.x[k]; y = p.y[k]; z = p.z[k]; }
      else {
        if (k >= n || T[k] > rel) {
          let lo = 0, hi = n - 1;
          while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (T[mid] <= rel) lo = mid; else hi = mid - 1; }
          k = lo;
        } else while (T[k + 1] <= rel) k++;
        const dur = T[k + 1] - T[k];
        u = dur > 1e-6 ? (rel - T[k]) / dur : 1;
        const ax = k ? p.x[k - 1] : p.sx, ay = k ? p.y[k - 1] : p.sy, az = k ? p.z[k - 1] : p.sz;
        x = ax + (p.x[k] - ax) * u; y = ay + (p.y[k] - ay) * u; z = az + (p.z[k] - az) * u;
      }
      this.k[i] = k;
      const fl = p.flags[k], c = p.ctx[k];
      let ox = this.ox[i], oy = this.oy[i], oz = this.oz[i];
      if (ox !== 0 || oy !== 0 || oz !== 0) {
        ox *= ko; oy *= ko; oz *= ko;
        if (Math.abs(ox) + Math.abs(oy) + Math.abs(oz) < 1e-3) ox = oy = oz = 0;
        this.ox[i] = ox; this.oy[i] = oy; this.oz[i] = oz;
        x += ox; y += oy; z += oz;
      }
      this.rx[i] = x; this.ry[i] = y; this.rz[i] = z;
      this.ctx[i] = c; this.use[i] = p.use[k]; this.fl[i] = fl;
      const segLen = p.d0[k + 1] - p.d0[k];
      const mv = segLen > 0.02 && u > 0 && u < 1 && !(fl & F_HIDDEN);
      this.mov[i] = mv ? 1 : 0;
      if (mv) moving++;
      let vis = 0, indoor = 0;
      if (c === -1) { out++; if (!(fl & F_HIDDEN)) vis = 1; }
      else if (c < -1) under++;
      else {
        inside++;
        if (!(fl & F_HIDDEN)) {
          const b = c >> 6;
          if (b === fb) { if ((c & 63) === ff) { vis = 1; indoor = 1; } }
          else if (parkB[b]) vis = 1;
        }
      }
      this.vis[i] = vis;
      if (!vis) continue;
      const cy = y + 0.9;
      let inF = true;
      for (let pl = 0; pl < 6; pl++) { const P = PL[pl], nn = P.normal; if (nn.x * x + nn.y * cy + nn.z * z + P.constant < -1.3) { inF = false; break; } }
      if (!inF) continue;
      const dx = x - cp.x, dy = cy - cp.y, dz = z - cp.z, d2 = dx * dx + dy * dy + dz * dz;
      const lod = d2 < L0 ? 0 : d2 < L1 ? 1 : d2 < L2 ? 2 : -1;
      if (lod < 0) continue;
      // yaw
      const target = p.yaw[k];
      let yw;
      if (this.last[i] !== frame - 1) yw = target;
      else { yw = this.yaw[i]; let d = target - yw; d -= Math.round(d / TAU) * TAU; yw += d * ky; }
      const wasDrawn = this.last[i] === frame - 1;
      this.yaw[i] = yw; this.last[i] = frame;
      // clip
      let a = p.anim[k];
      const prop = p.prop[k];
      // what they ordered or made (shared/food.js): a visible segment's last byte (shared/proto.js)
      const item = fl & F_HIDDEN ? 0 : p.veh[k];
      if (a === CLIP.use && p.use[k] === USE_ID.work) a = CLIP.stand_work;   // standing desk: type while standing
      else if (a === CLIP.use && p.use[k] === USE_ID.prep) a = CLIP.prep;   // making something cold on a counter's board: chopping
      else a = eatClip(holdClip(a, prop, p.use[k], i, LOOK_AT_PHONE), item);   // holding something: walk or stand holding it, look at a phone, sip, read; a dish at a table: eaten its way
      let ph;
      const stride = CLIP_STRIDE[a];
      if (stride > 0) ph = (segLen > 0.02 && u < 1 ? (p.d0[k] + segLen * u) / stride : t * GAIT_V[a] / stride) + (i * 0.618034) % 1;
      else ph = t / Math.max(0.3, CLIP_DUR[a]) + (i * 0.381966) % 1;
      ph -= Math.floor(ph);
      if (a !== this.clip[i]) {
        if (this.clip[i] >= 0 && wasDrawn && !(fl & F_SNAP)) { this.pclip[i] = this.clip[i]; this.pph[i] = this.lph[i]; this.fadeT[i] = now; }
        else this.fadeT[i] = -1e9;
        this.clip[i] = a;
      }
      this.lph[i] = ph;
      const w = Math.max(0, 1 - (now - this.fadeT[i]) / FADE);
      // (someone between the camera and a screen the person is using — ui/pc-onscreen.js: the body isn't drawn meanwhile,
      // what is on the table in front of it is)
      const ghost = this.hideFn ? this.hideFn(i, x, y, z) : false;
      chars.push(lod, x, y, z, yw, a, ph, w > 0 ? this.pclip[i] : a, this.pph[i], w, i, prop, (i === sel ? 2 : i === hov ? 1 : 0) | (indoor ? 4 : 0), item, ghost);
      if (item && lod < 2) {
        // (typing at a table, the drink by the laptop stands on the same top as the laptop: a bar's counter is higher)
        const fy = p.anim[k] === CLIP.sit_type ? y + chars.deskLift(chars.kindOf[i] ?? 0, i, x, y, z, p.yaw[k]) : y;
        this.food.place(x, fy, z, p.yaw[k], p.anim[k], a, item, sideDrink(p, k), p.use[k] === USE_ID.cook ? 'cook' : p.use[k] === USE_ID.prep ? 'prep' : '');
      }
      this.drawn[nd++] = i;
    }
    for (const e of this.extra) {
      const dx = e.x - cp.x, dy = e.y + 0.9 - cp.y, dz = e.z - cp.z, d2 = dx * dx + dy * dy + dz * dz;
      const lod = d2 < L0 ? 0 : d2 < L1 ? 1 : 2;
      chars.push(lod, e.x, e.y, e.z, e.yaw, e.clip, e.ph, e.pclip ?? e.clip, e.pph ?? 0, e.w ?? 0, e.app, e.prop || 0, e.flags || 0);
    }
    chars.end(); this.food.end();
    this.nDrawn = nd;
    Object.assign(this.stats, { out, inside, moving, under, drawn: nd, t });
    // selection ring
    if (sel >= 0 && sel < N && this.vis[sel]) {
      const d = Math.hypot(this.rx[sel] - cp.x, this.ry[sel] - cp.y, this.rz[sel] - cp.z);
      this.ring.position.set(this.rx[sel], this.ry[sel] + 0.035, this.rz[sel]);
      this.ring.scale.setScalar(Math.max(1, d / 45));
      this.ring.material.opacity = 0.65 + 0.3 * Math.sin(now * 5);
      this.ring.visible = true;
    } else this.ring.visible = false;
  }
  pos(i) { return i >= 0 && i < this.n ? { x: this.rx[i], y: this.ry[i], z: this.rz[i] } : null; }
  /** Metres from the camera to agent i (its chest). */
  camDist(i) { return _v.set(this.rx[i], this.ry[i] + 0.9, this.rz[i]).distanceTo(this.stage.camera.position); }
  /** Nearest drawn agent to the cursor (client px), or -1. */
  pick(cx, cy) {
    const cam = this.stage.camera, r = this.stage.renderer.domElement.getBoundingClientRect();
    const tanH = Math.tan(cam.fov * Math.PI / 360);
    let best = -1, bs = Infinity;
    for (let n = 0; n < this.nDrawn; n++) {
      const i = this.drawn[n];
      _v.set(this.rx[i], this.ry[i] + 0.9, this.rz[i]);
      const dist = _v.distanceTo(cam.position);
      _v.project(cam);
      if (_v.z > 1 || _v.z < -1) continue;
      const sx = r.left + (_v.x + 1) * 0.5 * r.width, sy = r.top + (1 - _v.y) * 0.5 * r.height;
      const half = 0.9 / (dist * tanH) * r.height * 0.5;
      const dx = sx - cx, dy = (sy - cy) * (half > 1 ? Math.min(1, 0.5 * 18 / half + 0.5) : 1);
      const d = Math.hypot(dx, dy), rad = Math.max(11, half * 0.62);
      if (d > rad) continue;
      const score = d / rad + dist * 0.002;
      if (score < bs) { bs = score; best = i; }
    }
    return best;
  }
}
