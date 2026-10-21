// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Tyre smoke (2026-10-05: Shift boosts, and from a standstill it does a burnout): soft grey puffs from every wheel
// slipping hard — a burnout's spinning rear tyres, a handbrake slide — that swell, rise, drift with the wind and fade. One
// pool of points, one draw call; nothing is drawn while no tyre slips. Fed with the same wheel states as the tyre marks
// (player/vehicles.js).
import * as THREE from 'three';
import { GU } from './scene.js';

const N = 480, LIFE = 1.6, SLIP = 0.45;

export class TyreSmoke {
  constructor(scene) {
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.born = new Float32Array(N).fill(-99); this.seed = new Float32Array(N);
    this.next = 0; this.acc = new Map();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aBorn', new THREE.BufferAttribute(this.born, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uNow: { value: 0 }, uLife: { value: LIFE }, uNight: GU.uNight, uScale: { value: 600 } },
      vertexShader: `attribute float aBorn, aSeed; uniform float uNow, uLife, uScale; varying float vA, vS;
        void main() { float t = (uNow - aBorn) / uLife; vA = (t >= 0.0 && t < 1.0) ? (1.0 - t) * smoothstep(0.0, 0.08, t) : 0.0; vS = aSeed;
          vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = vA > 0.0 ? (0.9 + 4.2 * t) * uScale / max(1.0, -mv.z) : 0.0; }`,
      fragmentShader: `uniform float uNight; varying float vA, vS;
        void main() { vec2 p = gl_PointCoord - 0.5; float r = length(p); if (r > 0.5) discard;
          float lump = 0.55 + 0.45 * sin(p.x * 11.0 + vS * 40.0) * sin(p.y * 9.0 + vS * 23.0);   // not a smooth disc
          float a = smoothstep(0.5, 0.05, r) * lump * vA * 0.21; float g = mix(0.62, 0.52, vS) * mix(1.0, 0.4, uNight);
          gl_FragColor = vec4(vec3(g), a); }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 3; this.points.name = 'tyre-smoke';
    scene.add(this.points);
    this.live = 0;
  }
  /** Wheels of vehicle id this frame ([{ contact, slip, point }], world points), now in seconds. */
  wheels(id, wheels, now, yaw = 0) {
    for (let i = 0; i < (wheels?.length || 0); i++) {
      const w = wheels[i], p = w?.point;
      if (!w?.contact || !p || !(w.slip > SLIP)) continue;
      // puffs per second with the slip: a full burnout ~28 per wheel
      const key = `${id}:${i}`, a = (this.acc.get(key) || 0) + (w.slip - SLIP) * 50 * (1 / 60);
      let n = Math.floor(a); this.acc.set(key, a - n);
      while (n-- > 0) this.emit(p, now, yaw);
    }
  }
  emit(p, now, yaw) {
    const k = this.next; this.next = (this.next + 1) % N;
    const W = GU.uWind.value;
    // thrown back off the tyre (the car's forward is (cos yaw, −sin yaw)), then lifting and spreading on the wind
    const bx = -Math.cos(yaw), bz = Math.sin(yaw), back = 1.2 + Math.random() * 2.2;
    this.pos[k * 3] = p.x + bx * 0.35 + (Math.random() - 0.5) * 0.25; this.pos[k * 3 + 1] = p.y + 0.15; this.pos[k * 3 + 2] = p.z + bz * 0.35 + (Math.random() - 0.5) * 0.25;
    this.vel[k * 3] = bx * back + W.x * 0.3 + (Math.random() - 0.5) * 1.2; this.vel[k * 3 + 1] = 0.35 + Math.random() * 0.7; this.vel[k * 3 + 2] = bz * back + W.z * 0.3 + (Math.random() - 0.5) * 1.2;
    this.born[k] = now; this.seed[k] = Math.random();
    this.live = LIFE;
  }
  update(now, dt) {
    this.mat.uniforms.uNow.value = now;
    if (this.live <= 0) { this.points.visible = false; return; }
    this.points.visible = true; this.live -= dt;
    for (let k = 0; k < N; k++) {
      if (now - this.born[k] > LIFE) continue;
      const d = Math.exp(-dt * 0.9);
      this.vel[k * 3] *= d; this.vel[k * 3 + 2] *= d; this.vel[k * 3 + 1] *= Math.exp(-dt * 0.5);
      this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aBorn.needsUpdate = true; g.attributes.aSeed.needsUpdate = true;
  }
}
