// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What the fishing game draws on the water (docs/features/fishing.md §Fishing): the line from the rod's tip (sagging
// while it lies on the water, straight when a fish pulls), the bobber or the lure, the aim ring where a cast will
// land, splashes, the hooked fish's shadow under the surface and the fish itself when it leaps clear or is held up.
// Splashes (redone 2026-10-15 — the product owner: "way too basic"): rings of waves spreading in the water itself, a
// patch of white water and stirred, milky water where it hit (render/water-marks.js); drops thrown up as streaks, a
// crown of water rising round the spot and falling back, mist from a big one, and a jet after a heavy fish falls back
// in (render/spray.js); the drops that fall back ring the water again. Ripples beyond the water's marks (a far
// ground's) are drawn as soft rings over it. Pooled and cheap: one line, one lure, one ring mesh, one fish.
import * as THREE from 'three';
import { catchModel } from './fish-models.js';
import { waterMarks } from './water-marks.js';
import { spray } from './spray.js';

const LINE_PTS = 28, RINGS = 24;
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

export class FishingFx {
  /** @param stage the page's Stage (render/scene.js) */
  constructor(stage) {
    const scene = this.scene = stage.scene;
    this.marks = waterMarks(stage); this.spray = spray(stage, this.marks);
    // the line
    const lg = new THREE.BufferGeometry(); this.lp = new Float32Array(LINE_PTS * 3);
    lg.setAttribute('position', new THREE.BufferAttribute(this.lp, 3).setUsage(THREE.DynamicDrawUsage));
    this.lineObj = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xeef3f6, transparent: true, opacity: 0.85 }));
    this.lineObj.frustumCulled = false; this.lineObj.visible = false; this.lineObj.renderOrder = 4; this.lineObj.name = 'fishing-line';
    // the bobber (red over white) and a lure (a small bright body)
    const bob = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e03a2e', roughness: 0.4 }));
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f4f2ea', roughness: 0.4 }));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 5), new THREE.MeshStandardMaterial({ color: '#e03a2e' })); stem.position.y = 0.06;
    bob.add(top, bot, stem); bob.name = 'bobber'; bob.visible = false; bob.scale.setScalar(1.7);   // (a little big: it must show 20 m off)
    this.bobber = bob;
    this.lureObj = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.06, 4, 8), new THREE.MeshStandardMaterial({ color: '#e8d040', roughness: 0.3, metalness: 0.4 }));
    this.lureObj.rotation.x = Math.PI / 2; this.lureObj.visible = false; this.lureObj.name = 'lure';
    // the aim: a ring where the cast lands, and the arc to it
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.85, depthWrite: false }));
    this.aimRing.visible = false; this.aimRing.renderOrder = 4; this.aimRing.name = 'cast-aim';
    const ag = new THREE.BufferGeometry(); this.ap = new Float32Array(24 * 3); ag.setAttribute('position', new THREE.BufferAttribute(this.ap, 3).setUsage(THREE.DynamicDrawUsage));
    this.aimArc = new THREE.Line(ag, new THREE.LineDashedMaterial({ color: 0xffe29a, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.8 }));
    this.aimArc.visible = false; this.aimArc.frustumCulled = false;
    // ripples beyond the water's marks: rings spreading and fading (an instanced ring, its age per instance)
    this.rAge = new Float32Array(RINGS).fill(9); this.rLife = new Float32Array(RINGS).fill(1); this.rSize = new Float32Array(RINGS); this.rPos = new Float32Array(RINGS * 3); this.rNext = 0;
    const rg = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2), ra = new THREE.InstancedBufferAttribute(new Float32Array(RINGS), 1);
    rg.setAttribute('aFade', ra);
    this.rings = new THREE.InstancedMesh(rg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'attribute float aFade; varying float vF; varying vec2 vR; void main() { vF = aFade; vR = vec2(length(position.xz), 0.0); gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vF; varying vec2 vR; void main() { if (vF <= 0.0) discard; float e = 1.0 - abs(vR.x - 0.93) / 0.07; gl_FragColor = vec4(0.96, 0.98, 1.0, vF * 0.55 * smoothstep(0.0, 0.8, e)); }',
    }), RINGS);
    this.rings.count = RINGS; this.rings.frustumCulled = false; this.rings.renderOrder = 3; this.rings.name = 'fishing-ripples'; this.rFade = ra;
    for (let i = 0; i < RINGS; i++) this.rings.setMatrixAt(i, _m.makeScale(0, 0, 0));
    // the hooked fish's shadow under the surface (a soft dark oval along its way)
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d'), gr = c.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(6,18,26,0.75)'); gr.addColorStop(0.6, 'rgba(6,18,26,0.4)'); gr.addColorStop(1, 'rgba(6,18,26,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
    this.shadow.visible = false; this.shadow.renderOrder = 2; this.shadow.name = 'fish-shadow';
    this.fishObj = null; this.fishKey = '';
    scene.add(this.lineObj, this.bobber, this.lureObj, this.aimRing, this.aimArc, this.rings, this.shadow);
  }
  /** The line from the rod's tip to `end`; sag: how far it hangs (0 tight … 1 lying slack on the water), down to `floor` at most. */
  line(tip, end, sag = 0, floor = -Infinity) {
    if (!tip || !end) { this.lineObj.visible = false; return; }
    const L = tip.distanceTo(end), drop = sag * Math.min(4, 0.25 + L * 0.18);
    for (let i = 0; i < LINE_PTS; i++) {
      const u = i / (LINE_PTS - 1);
      const y = Math.max(floor, tip.y + (end.y - tip.y) * u - drop * 4 * u * (1 - u) * (1 - 0.5 * u));
      this.lp[i * 3] = tip.x + (end.x - tip.x) * u; this.lp[i * 3 + 1] = i === LINE_PTS - 1 ? end.y : y; this.lp[i * 3 + 2] = tip.z + (end.z - tip.z) * u;
    }
    this.lineObj.geometry.attributes.position.needsUpdate = true; this.lineObj.visible = true;
  }
  /** The bobber (kind 'float') or the lure at p; null hides both. dip: how far the bobber is pulled under (m). */
  lure(p, kind = 'float', colour = '#e8d040', dip = 0, yaw = 0) {
    this.bobber.visible = !!p && kind === 'float'; this.lureObj.visible = !!p && kind !== 'float';
    if (!p) return;
    if (kind === 'float') { this.bobber.position.set(p.x, p.y - dip, p.z); this.bobber.rotation.set(dip > 0.05 ? 0.3 : 0, 0, 0); }
    else { this.lureObj.position.copy(p); this.lureObj.rotation.set(Math.PI / 2, 0, yaw); if (this.lureColour !== colour) { this.lureColour = colour; this.lureObj.material.color.set(colour); } }
  }
  /** Where the cast will go: the ring at `to` (on the water), an arc from `from`; null hides them. */
  aim(from, to, k = 1) {
    this.aimRing.visible = this.aimArc.visible = !!to;
    if (!to) return;
    this.aimRing.position.set(to.x, to.y + 0.03, to.z); this.aimRing.scale.setScalar(0.8 + 0.6 * k);
    const L = Math.hypot(to.x - from.x, to.z - from.z), H = 1.5 + L * 0.22;
    for (let i = 0; i < 24; i++) { const u = i / 23; this.ap[i * 3] = from.x + (to.x - from.x) * u; this.ap[i * 3 + 1] = from.y + (to.y - from.y) * u + H * 4 * u * (1 - u); this.ap[i * 3 + 2] = from.z + (to.z - from.z) * u; }
    this.aimArc.geometry.attributes.position.needsUpdate = true; this.aimArc.computeLineDistances();
  }
  /** A ripple: rings spreading to `size` m across over `life` s. */
  ripple(x, y, z, size = 1.5, life = 1.6) {
    if (this.marks.covers(x, z, 3)) { this.marks.splash(x, y, z, { r: 0.2 + size * 0.6, life: life * 1.2, amp: 0.012 + size * 0.006, lam: 0.12 + size * 0.03 }); return; }
    const i = this.rNext++ % RINGS;
    this.rAge[i] = 0; this.rLife[i] = life; this.rSize[i] = size; this.rPos[i * 3] = x; this.rPos[i * 3 + 1] = y + 0.02; this.rPos[i * 3 + 2] = z;
  }
  /**
   * A splash (size ~ the fish's length, m): rings of waves out from it, white water and stirred water where it hit; drops
   * thrown up and out, a crown of water (from a lure's size up), mist and a jet that follows (a big fish falling back).
   */
  splash(x, y, z, size = 0.5) {
    const k = Math.min(1.6, size), S = this.spray, R = Math.random;
    if (this.marks.covers(x, z, 2)) this.marks.splash(x, y, z, { r: 1 + k * 3.2, life: 1.4 + k * 0.9, amp: 0.03 + k * 0.07, lam: 0.18 + k * 0.3, foam: Math.min(1, 0.35 + k), pfoam: Math.min(1, 0.5 + k * 0.6), pr: 0.2 + k * 0.7, aer: Math.min(1, 0.5 + k * 0.5), plife: 1.6 + k * 2.4 });
    else { this.ripple(x, y, z, 1.2 + k * 2.2, 1.4); this.ripple(x, y, z, 0.6 + k * 1.2, 1.0); }
    for (let n = Math.min(120, Math.round(18 + k * 80)); n > 0; n--) {
      const a = R() * Math.PI * 2, r0 = 0.04 + k * 0.12, out = (0.5 + R() * 1.6) * (0.55 + k * 0.9), up = (1.2 + R() * 2.4) * (0.6 + k * 0.7);
      S.drop(x + Math.cos(a) * r0, y + 0.04, z + Math.sin(a) * r0, Math.cos(a) * out, up, Math.sin(a) * out, (R() < 0.8 ? 0.014 + R() * 0.018 : 0.03 + R() * 0.03) * (0.7 + k * 0.6), 2, y - 0.01, { ring: k > 0.2 && R() < 0.25 });
    }
    if (k >= 0.12) S.crown(x, y - 0.02, z, 0.08 + k * 0.32, 0.12 + k * 0.5, 0.45 + k * 0.25);
    if (k >= 0.35) for (let n = Math.round(3 + k * 5); n > 0; n--) { const a = R() * Math.PI * 2, o = 0.1 + k * 0.3; S.mist(x + Math.cos(a) * o, y + 0.15 + k * 0.25 * R(), z + Math.sin(a) * o, Math.cos(a) * (0.5 + R()), 0.5 + R() * 0.6, Math.sin(a) * (0.5 + R()), 0.2 + k * 0.35, 0.9 + R() * 0.6, 0.11); }   // (fine spray drifting off the rim)
    if (k >= 0.45) S.after(0.16, () => {   // the jet: water closing over where it went in, thrown straight up
      for (let n = Math.round(8 + k * 12); n > 0; n--) { const a = R() * Math.PI * 2, o = R() * 0.35; S.drop(x, y + 0.05, z, Math.cos(a) * o, (2.5 + R() * 2) * (0.7 + k * 0.4), Math.sin(a) * o, 0.03 + R() * 0.03, 2, y - 0.01, { ring: R() < 0.3 }); }
    });
  }
  /**
   * The hooked fish stirring the water as it fights (once a frame; len m long, mode its move: render/fishing-fight.js):
   * rings along its way near the surface (none while it dives), white water where it thrashes on a shake.
   */
  stir(x, y, z, len, mode, dt) {
    const S = this._stir ||= { x, z, d: 0, t: 0, th: 0 };
    S.d += Math.hypot(x - S.x, z - S.z); S.x = x; S.z = z; S.t -= dt;
    if (mode !== 'dive' && (S.d > 0.35 + len * 0.4 || S.t <= 0)) {
      S.d = 0; S.t = 0.45 + Math.random() * 0.3;
      if (this.marks.covers(x, z, 2)) this.marks.splash(x, y, z, { r: 0.5 + len * 0.7, life: 1.3, amp: 0.012 + len * 0.012, lam: 0.14 + len * 0.05, pfoam: mode === 'shake' ? 0.3 : 0, pr: 0.15 + len * 0.2, aer: 0.2, plife: 0.9 });
    }
    if (mode === 'shake' && (S.th -= dt) <= 0) { S.th = 0.3 + Math.random() * 0.4; this.splash(x, y, z, Math.max(0.08, len * 0.3)); }
  }
  /**
   * The fish: species `id` (or a find: { find }) `len` m long at p, its nose along yaw (pitch: up), drawn `mode` —
   * 'under' (only its shadow on the surface above it), 'air' (itself, leaping), 'held', or null (hidden).
   */
  fish(what, mode, p, yaw = 0, pitch = 0, len = 0.4, roll = 0) {
    const key = what ? what.find || what.species : '';
    if (key !== this.fishKey) {
      if (this.fishObj) this.scene.remove(this.fishObj);
      this.fishObj = key ? catchModel(what) : null; this.fishKey = key;
      if (this.fishObj) { this.fishObj.visible = false; this.scene.add(this.fishObj); }
    }
    const show = mode === 'air' || mode === 'held';
    if (this.fishObj) {
      this.fishObj.visible = !!show && !!p;
      if (show && p) {
        this.fishObj.position.copy(p); this.fishObj.rotation.copy(_e.set(-pitch, yaw, roll, 'YXZ'));
        if (!what.find) this.fishObj.scale.setScalar(len); else this.fishObj.scale.setScalar(1);
      }
    }
    this.shadow.visible = mode === 'under' && !!p;
    if (this.shadow.visible) { this.shadow.position.set(p.x, p.y, p.z); this.shadow.rotation.set(0, yaw, 0); this.shadow.scale.set(Math.max(0.25, len * 0.45), 1, Math.max(0.5, len * 1.2)); }
  }
  hideAll() { this.line(null); this.lure(null); this.aim(null); this.fish(null, null); }
  /** Once a frame: the far ripples spread and fade (the marks and the spray keep themselves). */
  update(dt) {
    let any = false;
    for (let i = 0; i < RINGS; i++) {
      if (this.rAge[i] >= this.rLife[i]) { if (this.rFade.array[i] !== 0) { this.rFade.array[i] = 0; this.rings.setMatrixAt(i, _m.makeScale(0, 0, 0)); any = true; } continue; }
      this.rAge[i] += dt; any = true;
      const u = Math.min(1, this.rAge[i] / this.rLife[i]), r = 0.15 + this.rSize[i] * 0.5 * (1 - (1 - u) * (1 - u));
      this.rFade.array[i] = (1 - u) * (1 - u);
      this.rings.setMatrixAt(i, _m.compose(_v.set(this.rPos[i * 3], this.rPos[i * 3 + 1], this.rPos[i * 3 + 2]), _q.identity(), _s.set(r, 1, r)));
    }
    if (any) { this.rings.instanceMatrix.needsUpdate = true; this.rFade.needsUpdate = true; }
  }
}
