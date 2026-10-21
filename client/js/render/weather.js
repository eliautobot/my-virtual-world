// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The weather in the browser (WP4.18, wp4-world-spec.md §6.1): the region's timeline (shared/weather.js) from the seed
// and override the server sends, run every frame on the world clock, so everyone sees the same sky. It sets the sky's
// cloud cover, light, fog and lightning (render/scene.js), the shared wind (GU.uWind: trees, clouds, rain) and how wet
// the ground is (GU.uWet), and draws rain as streaks in a box around the camera (GPU-animated, one draw call).
import * as THREE from 'three';
import { bus, S } from '../core/state.js';
import { GU } from './scene.js';
import { weatherAt, worldHours } from '/shared/weather.js';
bus.on('display', k => { if (k === 'weatherFx') fx = localStorage.getItem('mvw.weatherFx') !== 'off'; });

const RAIN = { low: 1400, medium: 3500, high: 8000 };   // streaks at full rain, per quality
const BOX = 70, HEIGHT = 36, FALL = 9.5;                 // m around the camera; m/s
let app = null, seed = null, override = null, rain = null, flash = 0, flashAt = -1, lastSlot = -1;
let fx = localStorage.getItem('mvw.weatherFx') !== 'off';   // Display → Rain and lightning (the sky and light still follow the weather)
const W = { kind: 'partly', cloud: 0.35, rain: 0, fog: 0, storm: 0, wind: { dir: 0, speed: 3 } };

export function init(a) {
  app = a;
  app.weather = { get now() { return W; }, get flash() { return flash; } };
  const take = m => { if (m && m.seed) { seed = m.seed; override = m.override || null; } };
  bus.on('hello', m => take(m.weather));
  bus.on('msg:weather', take);
  rain = new Rain(a.stage.scene, RAIN[a.stage.q.name] || RAIN.high);
  bus.on('preframe', update);
}
function update(dt, now) {
  const net = app.net, stage = app.stage;
  if (seed && net.clock) {
    const w = weatherAt(seed, worldHours(net.clock, net.simNow()), override);
    // ease toward the timeline (it already blends; this smooths overrides arriving mid-spell)
    const k = Math.min(1, dt * 0.8);
    W.kind = w.kind; W.cloud += (w.cloud - W.cloud) * k; W.rain += (w.rain - W.rain) * k; W.fog += (w.fog - W.fog) * k; W.storm += (w.storm - W.storm) * k;
    W.wind = w.wind;
    lightning(w, net, now);
  }
  // wind: direction and speed, with gusts (stronger in bad weather)
  const t = now / 1000, gust = 0.5 + 0.5 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1.3);
  const sp = W.wind.speed * (0.75 + 0.5 * gust), wx = Math.cos(W.wind.dir) * sp, wz = Math.sin(W.wind.dir) * sp;
  GU.uWind.value.set(wx, gust, wz, sp);
  const sw = GU.uSway.value, wrap = v => v % 6283.1853;   // 1000 turns: no jump at the wrap
  sw.set(wrap(sw.x + dt * (1.4 + 0.05 * sp)), wrap(sw.y + dt * (2.3 + 0.05 * sp)), wrap(sw.z + dt * (1.6 + 0.06 * sp)), wrap(sw.w + dt * (1.2 + 0.08 * sp)));
  const off = stage.skyU.uCloudOff.value; off.x += wx * dt * 0.0009; off.y += wz * dt * 0.0009;
  // the mountain mist drifts with it (a little faster than the wind down here, never quite still)
  const mo = GU.uMistOff.value, ms = 1.6 * Math.max(sp, 1.2) / Math.max(sp, 1e-3);
  mo.x = (mo.x + wx * ms * dt) % 1e5; mo.y = (mo.y + wz * ms * dt) % 1e5;
  // the ground gets wet in rain and dries slowly afterwards
  const wetTo = W.rain > 0.15 ? 1 : 0;
  GU.uWet.value += (wetTo - GU.uWet.value) * Math.min(1, dt * (wetTo ? 0.12 : 0.02));
  flash = flashAt >= 0 && fx ? flashCurve((now - flashAt) / 1000) : 0;
  if (flash <= 0 && flashAt >= 0 && now - flashAt > 1200) flashAt = -1;
  if (app.terrain) app.terrain.weather = W;
  stage.weather.cloud = W.cloud; stage.weather.rain = W.rain; stage.weather.fog = W.fog; stage.weather.storm = W.storm; stage.weather.flash = flash;
  rain.update(app.stage.camera, fx ? W.rain : 0, wx, wz, now / 1000, app);
}
/** Lightning in a storm: flash times come from the seed and the clock, so everyone sees the same flashes. */
function lightning(w, net, now) {
  if (w.storm < 0.3) return;
  const slot = Math.floor(net.realNow() / 2.5);   // 2.5 s slots of real time (shared via the server's clock)
  if (slot === lastSlot) return;
  lastSlot = slot;
  let h = 2166136261; for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h = Math.imul(h ^ slot, 2654435761); h ^= h >>> 15; const r = (h >>> 0) / 4294967296;
  if (r < 0.28 * w.storm) {
    flashAt = now + (r * 7919 % 1) * 2000;
    const distance = 0.6 + ((r * 104729) % 1) * 3.2;   // km: thunder follows ~3 s per km
    bus.emit('thunder', { at: flashAt, delay: distance * 2.9, loud: 1 - distance / 4.5 });
  }
}
/** A flash: two quick bright strokes and a fade (t in seconds since it began). */
function flashCurve(t) {
  if (t < 0) return 0;
  if (t < 0.08) return 1;
  if (t < 0.16) return 0.25;
  if (t < 0.24) return 0.8;
  return Math.max(0, 0.8 * (1 - (t - 0.24) / 0.5));
}

class Rain {
  constructor(scene, count) {
    this.count = count;
    const seedA = new Float32Array(count * 2 * 4), end = new Float32Array(count * 2), pos = new Float32Array(count * 2 * 3);
    for (let i = 0; i < count; i++) {
      const r = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let e = 0; e < 2; e++) { seedA.set(r, (i * 2 + e) * 4); end[i * 2 + e] = e; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seedA, 4));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.u = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uWind: { value: new THREE.Vector2() }, uDrift: { value: new THREE.Vector2() }, uOpacity: { value: 0 }, uNight: GU.uNight };
    this.wind = null; this.lastT = null;
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), this.u), transparent: true, depthWrite: false, fog: true,
      vertexShader: /* glsl */`
        attribute vec4 aSeed; attribute float aEnd;
        uniform vec3 uCam; uniform float uTime; uniform vec2 uWind, uDrift;
        varying float vA;
        #include <fog_pars_vertex>
        void main() {
          float speed = ${FALL.toFixed(1)} * (0.85 + 0.3 * aSeed.w);
          vec3 vel = vec3(uWind.x * 0.6, -speed, uWind.y * 0.6);
          // falling by time; carried sideways by how far the wind has blown (summed each frame: wind × time slid the whole
          // rain back and forth with every gust)
          vec3 p = aSeed.xyz * vec3(${BOX}.0, ${HEIGHT}.0, ${BOX}.0) + vec3(uDrift.x, -speed * uTime, uDrift.y);
          // wrap the drop into the box around the camera
          p = mod(p - (uCam - vec3(${BOX / 2}.0, ${HEIGHT / 2}.0, ${BOX / 2}.0)), vec3(${BOX}.0, ${HEIGHT}.0, ${BOX}.0)) + uCam - vec3(${BOX / 2}.0, ${HEIGHT / 2}.0, ${BOX / 2}.0);
          p += normalize(vel) * 0.55 * aEnd;
          vA = 1.0 - aEnd * 0.8;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform float uOpacity, uNight;
        varying float vA;
        #include <fog_pars_fragment>
        void main() {
          gl_FragColor = vec4(mix(vec3(0.78, 0.82, 0.88), vec3(0.32, 0.36, 0.45), uNight), uOpacity * vA);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.LineSegments(g, m);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; this.mesh.visible = false;
    scene.add(this.mesh);
  }
  update(camera, amount, wx, wz, t, app) {
    // only near the ground, outside, and when it's actually raining
    const T = app.terrain, cp = camera.position, ground = T ? Math.max(T.params.seaLevel, T.heightAt(cp.x, cp.z)) : 0;
    const show = amount > 0.03 && cp.y - ground < 260 && !(S.focus && S.focus.b >= 0);
    this.mesh.visible = show;
    if (!show) return;
    // the rain follows the wind slowly (~10 s), so the slant doesn't swing with every gust (2026-10-05)
    const dt = this.lastT === null ? 0 : Math.min(0.1, Math.max(0, t - this.lastT)); this.lastT = t;
    if (!this.wind) this.wind = new THREE.Vector2(wx, wz);
    const k = Math.min(1, dt * 0.1); this.wind.x += (wx - this.wind.x) * k; this.wind.y += (wz - this.wind.y) * k;
    const D = this.u.uDrift.value; D.x = (D.x + this.wind.x * 0.6 * dt) % BOX; D.y = (D.y + this.wind.y * 0.6 * dt) % BOX;   // the box wraps it anyway
    this.u.uCam.value.copy(cp); this.u.uTime.value = t % 1000; this.u.uWind.value.copy(this.wind);
    this.u.uOpacity.value = 0.18 + 0.32 * amount;
    this.mesh.geometry.setDrawRange(0, Math.max(2, Math.floor(this.count * Math.min(1, amount * 1.2)) * 2));
  }
}
