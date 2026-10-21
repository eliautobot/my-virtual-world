// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The outline round what is picked or under the pointer (2026-10-19, the product owner: "an outline, similar to how inZOI does it" —
// for agents, characters, buildings, every interactive thing — instead of the glow all over them). Whatever is outlined
// is drawn once more, alone, into a mask (the selected in red, the hovered in green: render/characters.js its people,
// render/buildings.js a building, render/interiors.js a piece of furniture — each with a material of its own that writes
// only where it is), and a line is drawn over the finished picture just outside the mask's edge: white, soft-edged, a
// little wider for the selected. Its whole shape is outlined, also where something stands in front of it. Nothing is
// drawn while nothing is outlined.
//
// A source: outline.add(fn), fn(draw) called each frame — draw(obj, selected, box) once for each thing to outline: an
// object of its own, in no scene, its mask material on it and its matrixWorld set (it is drawn as it is, matrices not
// updated); box (a THREE.Box3, world) round it, when known: the line is then drawn only round those parts of the screen
// (a phone following an agent draws it every frame).
import * as THREE from 'three';

const W = 3;   // line width, CSS px (the hovered: the same line, fainter)
/** The colour a mask material writes (shared by every source's mask materials: red = selected, green = hovered). */
export const MASK_COL = { value: new THREE.Color(1, 0, 0) };
/** A plain mask material for geometry drawn by its own matrix (a piece of furniture, a proxy). */
export function maskMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uMaskCol: MASK_COL },
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uMaskCol; void main() { gl_FragColor = vec4(uMaskCol, 1.0); }',
    depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
}

const EDGE = {
  uniforms: { tMask: { value: null }, uTexel: { value: new THREE.Vector2() }, uW: { value: W } },
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`
uniform sampler2D tMask; uniform vec2 uTexel; uniform float uW;
varying vec2 vUv;
void main() {
  vec2 c = texture2D(tMask, vUv).rg;
  // the most of each mask within the line's width: round the edge (12 ways, at the width and half of it)
  vec2 o = c;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988;
    vec2 d = vec2(cos(a), sin(a)) * uTexel * uW;
    o = max(o, max(texture2D(tMask, vUv + d).rg, texture2D(tMask, vUv + d * 0.5).rg));
  }
  float inside = max(c.r, c.g);
  float sel = clamp(o.r - c.r, 0.0, 1.0), hov = clamp(o.g - inside, 0.0, 1.0) * (1.0 - o.r);
  float a = max(sel, hov * 0.72);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0), a);
}`,
};

export class Outline {
  constructor(stage) {
    this.stage = stage;
    this.sources = [];
    this.rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ ...EDGE, uniforms: THREE.UniformsUtils.clone(EDGE.uniforms), transparent: true, depthTest: false, depthWrite: false }));
    this.quad.frustumCulled = false;
    this.quad.material.uniforms.tMask.value = this.rt.texture;
    this.ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();   // (each outlined thing is drawn alone through it: its own matrix, no lights)
    this.scene.matrixWorldAutoUpdate = false;
    this._dbs = new THREE.Vector2(); this._col = new THREE.Color(); this.list = []; this.rect = [0, 0, 0, 0]; this._v = new THREE.Vector3();
  }
  /** fn(draw): called each frame; draw(obj, selected, box) for each thing it outlines now. */
  add(fn) { this.sources.push(fn); }
  /** After the scene is on the canvas: the outlines over it. */
  render() {
    const L = this.list, R = this.rect; L.length = 0;
    const r = this.stage.renderer, cam = this.stage.camera, dbs = r.getDrawingBufferSize(this._dbs);
    // (the part of the screen to draw the line in: round every box given, the whole screen once one has none)
    let whole = false; R[0] = R[1] = Infinity; R[2] = R[3] = -Infinity;
    const draw = (obj, sel, box) => {
      if (!obj) return;
      L.push(obj, sel ? 1 : 0);
      if (whole) return;
      if (!box) { whole = true; return; }
      for (let k = 0; k < 8; k++) {
        const v = this._v.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).applyMatrix4(cam.matrixWorldInverse);
        if (v.z > -cam.near) { whole = true; return; }   // (a corner behind the camera)
        v.applyMatrix4(cam.projectionMatrix);
        R[0] = Math.min(R[0], v.x); R[1] = Math.min(R[1], v.y); R[2] = Math.max(R[2], v.x); R[3] = Math.max(R[3], v.y);
      }
    };
    for (const fn of this.sources) { try { fn(draw); } catch (e) { console.warn('outline source', e); } }
    if (!L.length) return;
    if (!whole && (R[0] > 1 || R[1] > 1 || R[2] < -1 || R[3] < -1)) return;   // (all of it off the screen)
    if (this.rt.width !== dbs.x || this.rt.height !== dbs.y) this.rt.setSize(dbs.x, dbs.y);
    const prevRT = r.getRenderTarget(), auto = r.autoClear, prevClear = r.getClearColor(this._col).getHex(), prevA = r.getClearAlpha(), shadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false; r.autoClear = false;
    r.setRenderTarget(this.rt); r.setClearColor(0x000000, 0); r.clear(true, false, false);
    // the hovered first, the selected over it (one thing both: the selected's line)
    this.scene.children.length = 1;
    for (const pass of [0, 1]) {
      MASK_COL.value.setRGB(pass ? 1 : 0, pass ? 0 : 1, 0);
      for (let k = 0; k < L.length; k += 2) {
        if (L[k + 1] !== pass) continue;
        this.scene.children[0] = L[k];
        r.render(this.scene, cam);
      }
    }
    this.scene.children.length = 0;
    r.setRenderTarget(null);
    const pr = r.getPixelRatio(), U = this.quad.material.uniforms, m = W * pr + 2;
    U.uTexel.value.set(1 / dbs.x, 1 / dbs.y); U.uW.value = W * pr;
    r.setViewport(0, 0, dbs.x / pr, dbs.y / pr);
    if (!whole) {
      // (CSS px, as setScissor takes them; the line's width beyond the box)
      const x0 = Math.max(0, ((R[0] + 1) / 2 * dbs.x - m)), y0 = Math.max(0, ((R[1] + 1) / 2 * dbs.y - m));
      const x1 = Math.min(dbs.x, ((R[2] + 1) / 2 * dbs.x + m)), y1 = Math.min(dbs.y, ((R[3] + 1) / 2 * dbs.y + m));
      r.setScissor(x0 / pr, y0 / pr, (x1 - x0) / pr, (y1 - y0) / pr); r.setScissorTest(true);
    }
    r.render(this.quad, this.ocam);
    r.setScissorTest(false);
    r.setRenderTarget(prevRT); r.setClearColor(prevClear, prevA); r.autoClear = auto; r.shadowMap.autoUpdate = shadow;
  }
}
