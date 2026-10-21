// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// One character on a small stage of its own (its own renderer, running the same instanced character shader and rig as the
// world): the Customizer's live preview and the Agent Studio's portrait. Drag to turn; it turns slowly by itself until
// touched. The portrait also holds things (a phone, a book…, render/char-props.js) and shows a glowing ring around a part
// of the body (ring()).
import * as THREE from 'three';
import { Characters } from './characters.js';
import { CLIP, CLIP_DUR, CLIP_STRIDE } from './anim.js';
import { PROP } from '/shared/anims.js';

export class CharPreview {
  /** warmAll: load every character in the background (the Customizer's roster); else only the one shown. */
  constructor({ warmAll = true, fov = 28, eye = [0, 1.05, 4.6], look = [0, 0.92, 0] } = {}) {
    this.canvas = document.createElement('canvas');
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 40);
    this.camera.position.set(...eye);
    this.camera.lookAt(...look);
    this.scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x3a3f4a, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(2.2, 3.5, 3); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc3ff, 1.4); rim.position.set(-3, 2.5, -2.5); this.scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.85, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0b0f16, transparent: true, opacity: 0.45 }));
    disc.position.y = 0.002; this.scene.add(disc);
    this.chars = new Characters({ capacity: 128, lods: [0], shadows: false, warmAll });
    this.scene.add(this.chars.group);
    this.yaw = 0.35; this.spin = true; this.clip = CLIP.idle; this.prop = 0; this.t0 = performance.now(); this.raf = 0;
    this.onFrame = null;   // (now) => void after each frame (the Studio places its pins)
    this.halo = null;
    let drag = null;
    this.canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, yaw: this.yaw, moved: false }; this.spin = false; this.canvas.setPointerCapture?.(e.pointerId); });
    this.canvas.addEventListener('pointermove', e => { if (drag) { if (Math.abs(e.clientX - drag.x) > 4) drag.moved = true; this.yaw = drag.yaw + (e.clientX - drag.x) * 0.012; } });
    const up = () => { this.dragged = !!drag?.moved; drag = null; };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }
  /** Puts the canvas in el and keeps the picture the size of el's box: when the box changes (the window, a strip filling
   *  in below it), the picture is redrawn at the new size - never stretched to it (that squashed the Studio's character). */
  mount(el) {
    el.prepend(this.canvas);
    this.ro?.disconnect();
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.ro?.observe(el);
    this.resize();
  }
  resize() {
    const p = this.canvas.parentElement; if (!p) return;
    const w = Math.max(50, p.clientWidth || 300), hh = Math.max(50, p.clientHeight || 460);
    if (w === this.w && hh === this.h) return;
    this.w = w; this.h = hh;
    this.renderer.setSize(w, hh, false);
    this.camera.aspect = w / hh; this.camera.updateProjectionMatrix();
  }
  setLook(app) { this.chars.setAppearance(0, app); }
  /** A clip by name (anim.js CLIP) and, optionally, what is held (shared/anims.js PROP name). */
  setClip(name, prop = 'none') { this.clip = CLIP[name] ?? CLIP.idle; this.prop = PROP[prop] ?? 0; this.t0 = performance.now(); }
  start() {
    if (this.raf) return;
    const loop = now => { this.raf = requestAnimationFrame(loop); this.frame(now); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  /** Takes it off the page and stops drawing, keeping its GPU context and what it loaded, to be mounted again (the Agent
   *  Studio keeps its one preview between opens: a new one compiled every character shader again, ~200 ms on a phone). */
  detach() {
    this.stop(); this.ro?.disconnect(); this.ro = null; this.canvas.remove();
    this.canvas.onpointermove = this.canvas.onpointerleave = this.canvas.onclick = null; this.canvas.style.cursor = '';
    this.onFrame = null; if (this.halo) this.halo.visible = false; this.spin = true; this.yaw = 0.35; this.dragged = false; this.w = this.h = 0;
  }
  /** Frees the GPU context (the Customizer keeps its one preview for the page's life, the Studio its own). */
  dispose() { this.stop(); this.ro?.disconnect(); this.renderer.dispose(); this.renderer.forceContextLoss?.(); this.canvas.remove(); }
  /** A glowing ring around the body at height y (metres; null hides it), in colour css. */
  ring(y, css = '#ffffff', r = 0.36) {
    if (!this.halo) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uCol: { value: new THREE.Color() }, uT: { value: 0 } },
        vertexShader: 'varying vec2 vU; void main() { vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 uCol; uniform float uT; varying vec2 vU; void main() { float a = smoothstep(0.0, 0.5, vU.y) * smoothstep(1.0, 0.5, vU.y); float p = 0.65 + 0.35 * sin(uT * 3.2 + vU.x * 6.2832 * 2.0); gl_FragColor = vec4(uCol * 1.4, a * p * 0.9); }',
      });
      this.halo = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.06, 64, 1, true), mat);
      this.halo.renderOrder = 4;
      this.scene.add(this.halo);
    }
    this.halo.visible = y !== null && y !== undefined;
    if (!this.halo.visible) return;
    this.halo.position.y = y;
    this.halo.scale.set(r, 1, r);
    this.halo.material.uniforms.uCol.value.set(css);
  }
  /** Where world point (x, y, z) is on the canvas, in CSS pixels from its top left. */
  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera), c = this.canvas;
    return { x: (v.x + 1) / 2 * c.clientWidth, y: (1 - v.y) / 2 * c.clientHeight };
  }
  /** The height (metres) on the body's axis under canvas point (px, py), CSS pixels. */
  heightAt(px, py) {
    const c = this.canvas, ndc = new THREE.Vector2(px / c.clientWidth * 2 - 1, -(py / c.clientHeight * 2 - 1));
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    // the vertical plane through the body's axis, facing the camera
    const n = new THREE.Vector3(this.camera.position.x, 0, this.camera.position.z).normalize();
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(n, 0), hit)) return null;
    return { y: hit.y, off: Math.hypot(hit.x, hit.z) };
  }
  frame(now) {
    const t = (now - this.t0) / 1000, c = this.clip, st = CLIP_STRIDE[c];
    if (this.spin) this.yaw += 0.0045;
    let ph = st > 0 ? t * 1.35 / st : t / Math.max(0.3, CLIP_DUR[c]);
    ph -= Math.floor(ph);
    if (this.halo?.visible) this.halo.material.uniforms.uT.value = now / 1000;
    this.chars.begin();
    this.chars.push(0, 0, 0, 0, this.yaw, c, ph, c, 0, 0, 0, this.prop, 0);
    this.chars.end();
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(now);
  }
}
