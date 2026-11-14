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
import { catchModel, fishAsset } from './fish-models.js';
import { waterMarks } from './water-marks.js';
import { spray } from './spray.js';

const LINE_PTS = 28, RINGS = 24;
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);   // (a model's +x, nose, to the +z the game aims)

export class FishingFx {
  /** @param stage the page's Stage (render/scene.js) */
  /** @param stage the page's Stage (render/scene.js) @param {{ uw?: function }} o uw: the terrain's under-the-water
   *  look for a material (render/terrain.js uw), so a hooked fish is seen through the water */
  constructor(stage, o = {}) {
    const scene = this.scene = stage.scene; this.uw = o.uw || null;
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
    // the modelled fish (Tripo, 2026-11-13): one skinned draw per species caught so far, its clip flopping when held
    // up, thrashing when it leaps (render/fish-models.js fishAsset)
    this.packs = new Map(); this.packOn = null; this.stage = stage;
    scene.add(this.lineObj, this.bobber, this.lureObj, this.aimRing, this.aimArc, this.rings, this.shadow);
  }
  /**
   * The line from the rod's tip to `end`: a rope (2026-11-13, the owner: "when the line is casted it has no physics, I
   * want it to flow, not be a static line") — LINE_PTS points carried on by their own momentum, pulled down by their
   * weight and slowed by the air, held to their length (it goes slack, never stretches), floating where it reaches the
   * water (`floor`, its height: they lie on it and drift slowly); the ends held at the tip and at `end`. sag: how much
   * line is out beyond the straight run to the end (0 tight … 1 lying slack on the water), so a tight line runs straight
   * and a slack one bellies, lies on the water and follows the rod's moves a moment late.
   */
  line(tip, end, sag = 0, floor = -Infinity, tension = 0) {
    if (!tip || !end) { this.lineObj.visible = false; this.rope = null; return; }
    const N = LINE_PTS, now = performance.now() / 1000, L = tip.distanceTo(end);
    let R = this.rope;
    // (from hidden, or the ends jumped — a new cast, a teleport: laid straight from the tip to the end)
    if (!R || Math.hypot(R.e[0] - end.x, R.e[1] - end.y, R.e[2] - end.z) > 25 || Math.hypot(R.t[0] - tip.x, R.t[1] - tip.y, R.t[2] - tip.z) > 25) {
      R = this.rope = { p: new Float32Array(N * 3), q: new Float32Array(N * 3), t: [0, 0, 0], e: [0, 0, 0], at: now, len: L };
      for (let i = 0; i < N; i++) { const u = i / (N - 1); for (let k = 0; k < 3; k++) R.p[i * 3 + k] = R.q[i * 3 + k] = (k ? (k === 1 ? tip.y + (end.y - tip.y) * u : tip.z + (end.z - tip.z) * u) : tip.x + (end.x - tip.x) * u); }
    }
    const dt = Math.min(1 / 30, Math.max(1 / 240, now - R.at)); R.at = now;
    R.t[0] = tip.x; R.t[1] = tip.y; R.t[2] = tip.z; R.e[0] = end.x; R.e[1] = end.y; R.e[2] = end.z;
    // the line out: a fish pulling holds it taut — the straight run, nothing over (2026-11-13, the owner: "the line is
    // sagging too much, like it's loose ... the fish should be pulling the line, it needs to show that tension"); slack
    // (sag): as much again as it says, bellying, lying on the water. Eased: line paid out or reeled in takes a moment.
    const slack = Math.max(0, sag), want = slack < 0.06 ? L * 0.997 : L * (1 + 0.012 + 0.28 * slack) + 0.03;
    R.len += (want - R.len) * Math.min(1, dt * (want < R.len ? 14 : 5)); if (slack >= 0.06) R.len = Math.max(R.len, L);
    // (a taut line hardly sags under its own weight)
    const seg = R.len / (N - 1), P = R.p, Q = R.q, g = 9.8 * 0.55 * dt * dt * (slack < 0.06 ? 0.08 : Math.min(1, 0.25 + slack * 2.5)), air = 0.985;
    // (a taut line cuts straight into the water to the fish; only a slack one lies along the surface)
    if (slack < 0.06) floor = -Infinity;
    // momentum, weight and the air; on the water: floating, the drift slowed
    for (let i = 1; i < N - 1; i++) {
      const j = i * 3;
      for (let k = 0; k < 3; k++) { const v = (P[j + k] - Q[j + k]) * air; Q[j + k] = P[j + k]; P[j + k] += v; }
      P[j + 1] -= g;
      if (P[j + 1] < floor) { P[j + 1] = floor; Q[j] += (P[j] - Q[j]) * 0.25; Q[j + 2] += (P[j + 2] - Q[j + 2]) * 0.25; Q[j + 1] = floor; }
    }
    // held to its length (only where stretched: a line goes slack), the ends pinned
    for (let it = 0; it < 14; it++) {
      P[0] = tip.x; P[1] = tip.y; P[2] = tip.z; const z = (N - 1) * 3; P[z] = end.x; P[z + 1] = end.y; P[z + 2] = end.z;
      for (let i = 0; i < N - 1; i++) {
        const a = i * 3, b = a + 3, dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d <= seg || d < 1e-6) continue;
        const c = (d - seg) / d * 0.5, wa = i === 0 ? 0 : 1, wb = i === N - 2 ? 0 : 1, sw = wa + wb || 1;
        P[a] += dx * c * 2 * wa / sw; P[a + 1] += dy * c * 2 * wa / sw; P[a + 2] += dz * c * 2 * wa / sw;
        P[b] -= dx * c * 2 * wb / sw; P[b + 1] -= dy * c * 2 * wb / sw; P[b + 2] -= dz * c * 2 * wb / sw;
      }
    }
    for (let i = 1; i < N - 1; i++) if (P[i * 3 + 1] < floor) P[i * 3 + 1] = floor;
    this.lp.set(P);
    // under heavy load it hums: a fine quiver across it, most in the middle (drawn only: the rope itself stays put)
    if (tension > 0.6) {
      const a = 0.012 * (tension - 0.6) / 0.4, ph = now * 47;
      for (let i = 1; i < N - 1; i++) { const u = i / (N - 1), w = Math.sin(Math.PI * u) * a * Math.sin(ph + i * 1.7); this.lp[i * 3] += w; this.lp[i * 3 + 1] += w * 0.6; }
    }
    this.lineObj.geometry.attributes.position.needsUpdate = true; this.lineObj.visible = true;
    // (and its colour brightens as it tightens)
    this.lineObj.material.opacity = 0.75 + 0.25 * Math.min(1, tension + (slack < 0.06 ? 0.3 : 0));
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
  /** How deep the fish's model is, back to belly with its fins, for each metre of its length (a guess till it has loaded). */
  depthOf(what) { const P = what ? this.packs.get(what.find || what.species) : null; return P?.A?.height || 0.35; }
  /**
   * The fish: species `id` (or a find: { find }) `len` m long at p, its nose along yaw (pitch: up), drawn `mode` —
   * 'under' (only its shadow on the surface above it), 'air' (itself, leaping), 'held', or null (hidden).
   */
  fish(what, mode, p, yaw = 0, pitch = 0, len = 0.4, roll = 0, act = null) {
    const key = what ? what.find || what.species : '';
    if (key !== this.fishKey) {
      if (this.fishObj) this.scene.remove(this.fishObj);
      this.fishObj = key ? catchModel(what) : null; this.fishKey = key;
      if (this.fishObj) { this.fishObj.visible = false; this.scene.add(this.fishObj); }
      if (key && !this.packs.has(key)) {
        this.packs.set(key, null);
        fishAsset(key).then(A => { if (A) import('./fauna-skinned.js').then(m => {
          const pack = m.skinnedPack(A, 1, this.scene, `catch-${key}`, m.coatsOf({}, A));
          if (this.uw) new Set(pack.meshes.map(x => x.material)).forEach(x => this.uw(x));   // (seen through the water)
          this.packs.set(key, { A, pack, was: -1 });
        }); });
      }
    }
    const show = mode === 'air' || mode === 'held';
    // the model, if this one has one: posed by its clip (held: rest, flopping now and then; in the air: thrashing; in
    // the water on the line — 2026-11-13, the owner: "have the fish actually be loaded so it's visible when caught, coming
    // up the water ... struggling within the water itself" — swimming hard on its runs, thrashing as it shakes its head,
    // a little below the surface, deeper as it dives, up to it as it tires and comes close)
    const P = key ? this.packs.get(key) : null;
    if (this.packOn && this.packOn !== P) { this.packOn.pack.begin(); this.packOn.pack.end(); this.packOn = null; }
    let under = false;
    if (P) {
      P.pack.begin();
      if ((show || (mode === 'under' && !what.find)) && p) {
        let y = p.y, pt = pitch, clip = mode === 'held' ? 0 : 2, rate = 1.2 + 0.5 / Math.max(0.25, len);
        if (mode === 'under') {
          under = true;
          const m = act?.mode || 'run', depth = act?.depth ?? 0.4;
          clip = m === 'shake' || m === 'jump' ? 2 : 6;
          rate = (clip === 2 ? 1.5 : m === 'rest' ? 0.6 : m === 'toward' ? 1.6 : 1.25) * (0.8 + 0.4 / Math.max(0.3, len));
          y -= depth; pt = m === 'dive' ? -0.35 : act?.up ? 0.2 : 0;
        }
        _q.setFromEuler(_e.set(-pt, yaw, roll, 'YXZ')).multiply(_turn);
        const k = what.find ? 1 : len;
        if (P.was !== clip) { P.was = clip; P.ph = Math.random(); }   // (each time it is shown, from somewhere in its clip)
        P.pack.put(_m.compose(_v.set(p.x, y, p.z), _q, _s.set(k, k, k)), 0, P.ph, clip ? rate : 0, clip, 0, null, true);
      }
      P.pack.end(); this.packOn = P;
    }
    if (this.fishObj) {
      this.fishObj.visible = !!show && !!p && !P;
      if (show && p) {
        this.fishObj.position.copy(p); this.fishObj.rotation.copy(_e.set(-pitch, yaw, roll, 'YXZ'));
        if (!what.find) this.fishObj.scale.setScalar(len); else this.fishObj.scale.setScalar(1);
      }
    }
    this.shadow.visible = mode === 'under' && !!p;
    if (this.shadow.visible) {
      this.shadow.position.set(p.x, p.y, p.z); this.shadow.rotation.set(0, yaw, 0); this.shadow.scale.set(Math.max(0.25, len * 0.45), 1, Math.max(0.5, len * 1.2));
      this.shadow.material.opacity = under ? 0.18 : 1;   // (the fish itself seen below: only a faint shade on the surface)
    }
  }
  /**
   * A burst of light round the catch as it is held up (2026-11-13: "more flare"): sparks in its rarity's colour flying out
   * and up from it and fading; a big one (epic, legendary, a trophy) twice as many, further, with a ring of light.
   */
  burst(x, y, z, color = '#ffd36a', big = false, size = 0.5) {
    const n = big ? 160 : 70, B = this.bursts ||= [];
    const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.3, sp = (big ? 1.6 : 1.0) * (0.6 + Math.random()) * (0.6 + size * 0.5);
      vel[i * 3] = Math.cos(a) * Math.cos(e) * sp; vel[i * 3 + 1] = Math.sin(e) * sp + 0.6; vel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * sp;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: new THREE.Color(color), size: big ? 0.075 : 0.055, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 6; this.scene.add(pts);
    B.push({ pts, vel, age: 0, life: big ? 1.8 : 1.3 });
    if (big) {   // and a ring of light spreading from it
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      ring.position.set(x, y, z); ring.lookAt(x, y + 1, z); ring.renderOrder = 6; this.scene.add(ring);
      B.push({ ring, age: 0, life: 1.0 });
    }
  }
  hideAll() { this.line(null); this.lure(null); this.aim(null); this.fish(null, null); }
  /** Once a frame: the far ripples spread and fade (the marks and the spray keep themselves). */
  update(dt) {
    for (const b of this.bursts || []) {   // (the catch's bursts: sparks flying, slowing, falling a little, fading)
      b.age += dt; const u = b.age / b.life;
      if (b.pts) {
        const P = b.pts.geometry.attributes.position, a = P.array, v = b.vel, drag = Math.exp(-dt * 2.2);
        for (let i = 0; i < v.length; i += 3) { v[i] *= drag; v[i + 1] = v[i + 1] * drag - 1.4 * dt; v[i + 2] *= drag; a[i] += v[i] * dt; a[i + 1] += v[i + 1] * dt; a[i + 2] += v[i + 2] * dt; }
        P.needsUpdate = true; b.pts.material.opacity = Math.max(0, 1 - u * u);
      } else if (b.ring) { const r = 0.2 + u * 2.4; b.ring.scale.set(r, r, r); b.ring.material.opacity = 0.8 * (1 - u); }
      if (u >= 1) { const o = b.pts || b.ring; this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); b.done = true; }
    }
    if (this.bursts?.some(b => b.done)) this.bursts = this.bursts.filter(b => !b.done);
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
