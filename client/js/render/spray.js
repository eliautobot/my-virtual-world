// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Water thrown into the air (the fishing game's polish, 2026-10-15 — the product owner: "the splashes are way too
// basic"): drops — drawn as short streaks along their flight, as a camera sees fast water — and mist (soft, ragged
// puffs that drift, spread and thin), and a splash's crown (the thin sheet of water that rises round where something
// hit, opens out, breaks into fingers at its rim and falls back). Lit by the day (grey-blue at night). One draw for every
// drop and puff, one for every crown; the drops that fall back can leave rings on the water (render/water-marks.js).
import * as THREE from 'three';
import { bus } from '../core/state.js';
import { GU } from './scene.js';

const CROWNS = 24;
const PUFF_VERT = /* glsl */`
attribute vec3 iP, iV;
attribute vec4 iD;   // size (m), alpha, kind (0 a drop, 1 mist), seed
varying vec2 vQ;
varying vec4 vD;
void main() {
  vQ = position.xy; vD = iD;
  vec4 mv = viewMatrix * vec4(iP, 1.0);
  float s = iD.x, len = s;
  vec2 ax = vec2(0.0, 1.0);
  if (iD.z < 0.5) {   // a drop: along its motion on the screen, as long as it goes in a 30th of a second
    vec3 vv = mat3(viewMatrix) * iV; float sp = length(vv.xy);
    if (sp > 0.01) ax = vv.xy / sp;
    len = s + min(sp * 0.022, 0.4);
  } else { float a = iD.w * 6.2832; ax = vec2(cos(a), sin(a)); }
  vec2 ay = vec2(ax.y, -ax.x);
  mv.xy += ax * position.y * len + ay * position.x * s * (iD.z < 0.5 ? 0.55 : 1.0);   // (a drop: a thin streak)
  gl_Position = projectionMatrix * mv;
}`;
const PUFF_FRAG = /* glsl */`
uniform float uDay;
varying vec2 vQ;
varying vec4 vD;
float pH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float pN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(pH(i), pH(i + vec2(1.0, 0.0)), f.x), mix(pH(i + vec2(0.0, 1.0)), pH(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  float d = length(vQ);
  if (d > 1.0) discard;
  vec3 lit = mix(vec3(0.17, 0.21, 0.27), vec3(0.93, 0.96, 1.0), uDay);
  float a;
  if (vD.z < 0.5) a = (1.0 - smoothstep(0.3, 1.0, d)) * vD.y;
  else {   // mist: a ragged cloud, thinner toward its edge
    float n = pN(vQ * 2.4 + vD.w * 31.0) * 0.6 + pN(vQ * 5.1 - vD.w * 17.0) * 0.4;
    a = (1.0 - smoothstep(0.15, 1.0, d + (n - 0.5) * 0.55)) * (0.5 + 0.5 * n) * vD.y;
    lit *= 0.94;
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(lit, a);
}`;
const CROWN_VERT = /* glsl */`
attribute vec4 iC, iS;   // x, y, z, its age (0..1); radius, height (m), seed, alpha
varying vec3 vU;
varying vec4 vS;
varying float vT;
void main() {
  float t = iC.w, y = position.y, ang = atan(position.z, position.x);
  // it rises fast, opens out (wider toward its rim), and falls back
  float R = iS.x * (0.45 + 0.75 * sqrt(t)) * (1.0 + 0.55 * y * (0.4 + t));
  float H = iS.y * sin(3.1416 * min(1.0, t * 1.08)) * (0.82 + 0.18 * sin(ang * 7.0 + iS.z * 40.0));
  vec3 p = vec3(position.x * R, y * H, position.z * R);
  vU = vec3(ang, y, 0.0); vS = iS; vT = t;
  gl_Position = projectionMatrix * viewMatrix * vec4(iC.xyz + p, 1.0);
}`;
const CROWN_FRAG = /* glsl */`
uniform float uDay;
varying vec3 vU;
varying vec4 vS;
varying float vT;
float cH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float cN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(cH(i), cH(i + vec2(1.0, 0.0)), f.x), mix(cH(i + vec2(0.0, 1.0)), cH(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  float a = vU.x * 1.5915, y = vU.y;   // (around it: 0..10 over a turn)
  // the rim breaks into fingers, more of it as it falls
  float fing = cN(vec2(a * 2.2 + vS.z * 50.0, 0.5)) * 0.7 + cN(vec2(a * 6.0, vT * 3.0)) * 0.3;
  if (y > 1.0 - (0.15 + 0.6 * vT) * fing) discard;
  // a thin sheet: see-through low down, whiter in streaks toward its rim
  float streak = cN(vec2(a * 9.0 + vS.z * 13.0, y * 1.5 - vT * 2.0));
  float al = (0.16 + 0.55 * smoothstep(0.35, 0.95, y)) * (0.55 + 0.6 * streak) * pow(1.0 - vT, 1.3) * vS.w;
  vec3 lit = mix(vec3(0.17, 0.21, 0.27), vec3(0.93, 0.96, 1.0), uDay);
  gl_FragColor = vec4(lit, al);
}`;

class Spray {
  constructor(stage, marks) {
    this.marks = marks;
    const max = this.max = stage.q?.name === 'low' ? 700 : 1600;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    this.P = new Float32Array(max * 3); this.V = new Float32Array(max * 3); this.D = new Float32Array(max * 4);
    g.setAttribute('iP', new THREE.InstancedBufferAttribute(this.P, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iV', new THREE.InstancedBufferAttribute(this.V, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iD', new THREE.InstancedBufferAttribute(this.D, 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    // per particle, CPU only: age, life, the water it falls back to, its own alpha, grow (mist), ring (a drop's ring)
    this.age = new Float32Array(max); this.life = new Float32Array(max); this.floor = new Float32Array(max); this.a0 = new Float32Array(max); this.ring = new Uint8Array(max);
    this.n = 0;
    const mat = new THREE.ShaderMaterial({ vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, uniforms: { uDay: GU.uDay }, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.mesh.name = 'water-spray';
    // the crowns
    const cg = new THREE.InstancedBufferGeometry().copy(new THREE.CylinderGeometry(1, 1, 1, 30, 5, true).translate(0, 0.5, 0));
    this.C = new Float32Array(CROWNS * 4); this.CS = new Float32Array(CROWNS * 4);
    cg.setAttribute('iC', new THREE.InstancedBufferAttribute(this.C, 4).setUsage(THREE.DynamicDrawUsage));
    cg.setAttribute('iS', new THREE.InstancedBufferAttribute(this.CS, 4).setUsage(THREE.DynamicDrawUsage));
    cg.instanceCount = 0;
    this.crowns = new THREE.Mesh(cg, new THREE.ShaderMaterial({ vertexShader: CROWN_VERT, fragmentShader: CROWN_FRAG, uniforms: { uDay: GU.uDay }, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.crowns.frustumCulled = false; this.crowns.renderOrder = 4; this.crowns.name = 'water-crowns';
    this.cl = [];   // { x, y, z, t, life, r, h, seed, a }
    this.later = [];   // bursts to come: [when (s), fn]
    stage.scene.add(this.mesh, this.crowns);
    bus.on('frame', dt => this.update(Math.min(0.1, dt)));
  }
  _add(x, y, z, vx, vy, vz, size, life, kind, alpha, floor, ring) {
    let i = this.n;
    if (i >= this.max) { i = Math.floor(Math.random() * this.max); } else this.n++;
    const o = i * 3, d = i * 4;
    this.P[o] = x; this.P[o + 1] = y; this.P[o + 2] = z; this.V[o] = vx; this.V[o + 1] = vy; this.V[o + 2] = vz;
    this.D[d] = size; this.D[d + 1] = 0; this.D[d + 2] = kind; this.D[d + 3] = Math.random();
    this.age[i] = 0; this.life[i] = life; this.floor[i] = floor; this.a0[i] = alpha; this.ring[i] = ring ? 1 : 0;
  }
  /** A drop at (x, y, z) flying off at (vx, vy, vz) m/s, size m across; it ends when it falls back to the water (floor). */
  drop(x, y, z, vx, vy, vz, size = 0.05, life = 1.2, floor = y - 0.05, { alpha = 0.6, ring = false } = {}) { this._add(x, y, z, vx, vy, vz, size, life, 0, alpha, floor, ring); }
  /** A puff of mist, size m across at first, drifting at (vx, vy, vz) and spreading. */
  mist(x, y, z, vx, vy, vz, size = 0.8, life = 1.2, alpha = 0.22) { this._add(x, y, z, vx, vy, vz, size, life, 1, alpha, -1e9, false); }
  /** A splash's crown at (x, y, z): r m round, rising h m, over life s. */
  crown(x, y, z, r = 0.3, h = 0.4, life = 0.6, alpha = 1) { if (this.cl.length >= CROWNS) this.cl.shift(); this.cl.push({ x, y, z, t: GU.uTime.value, life, r, h, seed: Math.random(), a: alpha }); }
  /** fn after s seconds (a jet that follows a splash). */
  after(s, fn) { this.later.push([GU.uTime.value + s, fn]); }
  update(dt) {
    const now = GU.uTime.value;
    if (this.later.length) { const due = this.later.filter(l => l[0] <= now); this.later = this.later.filter(l => l[0] > now); for (const [, fn] of due) fn(); }
    let rings = 0;
    for (let i = this.n - 1; i >= 0; i--) {   // (backwards: a dead one's place takes the last, already moved)
      const o = i * 3, d = i * 4;
      this.age[i] += dt;
      const kind = this.D[d + 2], u = this.age[i] / this.life[i];
      let dead = u >= 1;
      if (kind < 0.5) {   // a drop: falls; a little air drag
        const k = Math.exp(-0.35 * dt);
        this.V[o] *= k; this.V[o + 2] *= k; this.V[o + 1] -= 9.81 * dt;
        this.P[o] += this.V[o] * dt; this.P[o + 1] += this.V[o + 1] * dt; this.P[o + 2] += this.V[o + 2] * dt;
        if (this.P[o + 1] < this.floor[i] && this.V[o + 1] < 0) {
          dead = true;
          if (this.ring[i] && rings < 8 && this.marks) { rings++; this.marks.splash(this.P[o], this.floor[i], this.P[o + 2], { r: 0.35 + this.D[d] * 4, life: 0.8, amp: 0.008 + this.D[d] * 0.08, lam: 0.09 }); }
        }
        this.D[d + 1] = this.a0[i] * Math.min(1, (1 - u) * 3);
      } else {            // mist: slows, rises a little, spreads and thins
        const k = Math.exp(-2.4 * dt);
        this.V[o] *= k; this.V[o + 2] *= k; this.V[o + 1] = this.V[o + 1] * k + 0.25 * dt;
        this.P[o] += this.V[o] * dt; this.P[o + 1] += this.V[o + 1] * dt; this.P[o + 2] += this.V[o + 2] * dt;
        this.D[d] *= 1 + 0.75 * dt;
        this.D[d + 1] = this.a0[i] * Math.min(1, u * 8) * (1 - u) ** 1.4;
      }
      if (dead) {   // (the last one into its place)
        const j = --this.n;
        if (j !== i) {
          for (let c = 0; c < 3; c++) { this.P[o + c] = this.P[j * 3 + c]; this.V[o + c] = this.V[j * 3 + c]; }
          for (let c = 0; c < 4; c++) this.D[d + c] = this.D[j * 4 + c];
          this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.floor[i] = this.floor[j]; this.a0[i] = this.a0[j]; this.ring[i] = this.ring[j];
        }
      }
    }
    const g = this.mesh.geometry; g.instanceCount = this.n; this.mesh.visible = this.n > 0;
    if (this.n) for (const k of ['iP', 'iV', 'iD']) { const at = g.attributes[k]; at.clearUpdateRanges(); at.addUpdateRange(0, this.n * at.itemSize); at.needsUpdate = true; }
    this.cl = this.cl.filter(c => now - c.t < c.life);
    this.cl.forEach((c, i) => { const o = i * 4; this.C[o] = c.x; this.C[o + 1] = c.y; this.C[o + 2] = c.z; this.C[o + 3] = (now - c.t) / c.life; this.CS[o] = c.r; this.CS[o + 1] = c.h; this.CS[o + 2] = c.seed; this.CS[o + 3] = c.a; });
    const cg = this.crowns.geometry; cg.instanceCount = this.cl.length; this.crowns.visible = this.cl.length > 0;
    if (this.cl.length) { cg.attributes.iC.needsUpdate = true; cg.attributes.iS.needsUpdate = true; }
  }
}
let one = null;
/** The spray (one for the page); marks: the water's marks, for the rings where drops fall back. */
export function spray(stage, marks = null) { return (one ||= new Spray(stage, marks)); }
