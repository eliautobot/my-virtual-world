// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Under water (2026-10-06: diving, it looked like air): specks drifting in the water round the camera, and the view
// darkening toward its edges, lit from above — while the camera is under the surface (Stage.under). The water's colour
// closing in, the sky going and the surface seen from below are render/scene.js's and render/water.js's.
import * as THREE from 'three';
import { GU } from './scene.js';

const N = 700, H = 11;   // specks in a box 2H across that moves with the camera (wrapped, so they never run out)

export class UnderwaterFX {
  constructor(stage) {
    const scene = stage.scene;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < pos.length; i++) pos[i] = (Math.random() * 2 - 1) * H;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.uCam = { value: new THREE.Vector3() };
    const m = new THREE.PointsMaterial({ color: 0xd6efe9, size: 0.03, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false, fog: true });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uFxCam: this.uCam, uFxT: GU.uTime });
      // each speck drifts slowly (rising a little, swaying), its place wrapped round the camera
      sh.vertexShader = 'uniform vec3 uFxCam;\nuniform float uFxT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
  vec3 transformed = position + vec3(sin(uFxT * 0.31 + position.y) * 0.35, uFxT * 0.06, cos(uFxT * 0.27 + position.x) * 0.35);
  transformed = mod(transformed - uFxCam + ${H.toFixed(1)}, ${(2 * H).toFixed(1)}) - ${H.toFixed(1)} + uFxCam;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (length(gl_PointCoord - 0.5) > 0.5) discard;   // round');
    };
    m.customProgramCacheKey = () => 'underwater-specks';
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.visible = false; this.points.renderOrder = 2;
    scene.add(this.points); stage.underOnly.push(this.points);
    const canvas = document.getElementById('gl');
    this.el = Object.assign(document.createElement('div'), { id: 'underwater' });
    if (canvas?.parentNode) canvas.parentNode.insertBefore(this.el, canvas.nextSibling); else document.body.appendChild(this.el);
    this.on = false;
  }
  /** Each frame: the camera's position and whether it is under the water. */
  update(camPos, under) {
    this.points.visible = under;
    if (under) this.uCam.value.copy(camPos);
    if (under !== this.on) { this.on = under; this.el.classList.toggle('on', under); document.body.classList.toggle('underwater', under); }
  }
}
