// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character lab: GPU-instanced Tripo characters (male + female bodies, 65-bone Mixamo rig, 4-weight skinning).
// Same public API as the original renderer (constructor, group, setAppearance, begin, push, end, stats, setShadows).
// - Meshes/clips come from /assets/chars/<kind>.{json,bin} (built by mvw-next-character-module/tools/build_lab_chars.py).
// - Skinning matrices per clip frame live in a half-float texture (3 texels per bone per frame), sampled per vertex with
//   frame interpolation and a two-clip cross-fade.
// - Clothing, hair, and face are painted in the fragment shader from per-vertex region fields (bind position, head/scalp/
//   hand/foot masks, arm/leg progress) and the agent's appearance texels, so every outfit is one draw call per body+LOD.
import * as THREE from 'three';
import { packAppearance, defaultChar } from '/shared/appearance.js';
import { RIG_BATCHES, RIG_BODIES, normalizeRigSettings, rigBatchForKind } from '/shared/rigProfiles.js';
import { CLIP_NAMES } from './anim.js';
import { TRIPO_CLIPS, T, OLD_TO_TRIPO, TRIPO_FALLBACK, TRIPO_EXACT } from './charClips.js';
import { COMMON, SKIN_GLSL, packClips } from './char-glsl.js';
import { CharProps, shapeFor, GEAR_CLIP, onTable, deskPoint, DESK_TOP, DESK_LID } from './char-props.js';
import { MASK_COL } from './outline.js';
import { TEXTURED } from '/assets/chars/index.js';

export const KINDS = ['male', 'female', ...TEXTURED];
/** A point of a body's own frame (Characters.gripPoint) in the world: scaled by its height and build, turned by yaw, at (x, y, z). */
export function bodyToWorld(q, height, build, yaw, x, y, z, out = new THREE.Vector3()) {
  const sx = q[0] * height * build, sy = q[1] * height, sz = q[2] * height * build, c = Math.cos(yaw), s = Math.sin(yaw);
  return out.set(x + sx * c + sz * s, y + sy, z - sx * s + sz * c);
}
const NCL = TRIPO_CLIPS.length;
const OLD2T = new Float32Array(CLIP_NAMES.length).map((_, i) => T[OLD_TO_TRIPO[CLIP_NAMES[i]] || 'idle'] ?? 0);
const DANCE = T.dance_01;
const _back = [0], _root = [0, 0, 0], _far = { x: 0, z: 0, back: 0 };

// ------------------------------------------------------------------------------------------------ asset loading
// Lab shortcut: ?only=f01,f02 (or ?char=f01 on the showcase page) loads just those characters instead of all 25 (~209 MB).
const ONLY = (() => {
  try {
    const q = new URLSearchParams(location.search);
    const v = q.get('only') || (location.pathname.includes('/dev/showcase') ? q.get('char') : null);
    return v ? new Set(v.split(',').map(x => x.trim()).filter(Boolean)) : null;
  } catch { return null; }
})();
// The generic built-in male/female bodies are retired: only the textured characters (m01-m12, f01-f12) are loaded.
const wanted = kind => kind !== 'male' && kind !== 'female' && (!ONLY || ONLY.has(kind));
const cache = {};
let extraList = null;
/** The clips added to the baked characters (assets/chars/extra-clips.json), or null. */
function extraClips() { return (extraList ??= fetch('/assets/chars/extra-clips.json').then(r => (r.ok ? r.json() : null)).catch(() => null)); }
// Character assets load in a worker when the browser allows (main-thread fallback otherwise).
let worker = null, workerFailed = false, nextJob = 0;
const jobs = new Map();
function viaWorker(msg, transfer) {
  if (workerFailed || typeof Worker !== 'function') return null;
  if (!worker) {
    try { worker = new Worker(new URL('./char-loader.worker.js', import.meta.url), { type: 'module' }); }
    catch { workerFailed = true; return null; }
    worker.onmessage = e => { const j = jobs.get(e.data.id); if (!j) return; jobs.delete(e.data.id); if (e.data.error) j.reject(new Error(e.data.error)); else j.resolve(e.data); };
    worker.onerror = () => { workerFailed = true; worker = null; for (const j of jobs.values()) j.retry(); jobs.clear(); };
  }
  return new Promise((resolve, reject) => { const id = ++nextJob; jobs.set(id, { resolve, reject, retry: () => resolve(null) }); worker.postMessage({ ...msg, id }, transfer || []); });
}
// Decode maps off the main thread when the browser can. Same pixels as the <img> path three.js used: no flip, no
// premultiplication and no colour conversion (three uploads both maps with UNPACK_COLORSPACE_CONVERSION = NONE here).
async function loadMap(url, size = 2048) {
  if (typeof createImageBitmap !== 'function') return new THREE.TextureLoader().loadAsync(url);
  const done = await viaWorker({ op: 'map', url: new URL(url, location.href).href, size });
  if (done) { const t = new THREE.Texture(done.bitmap); t.needsUpdate = true; return t; }
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  const opts = { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  // Medium/Low quality draw characters small: decoding straight to a smaller size (off the main thread) cuts GPU
  // memory and upload time 4x/16x. Published maps are 2048 square; the full size is decoded unchanged.
  const small = size < 2048 ? { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' } : {};
  const t = new THREE.Texture(await createImageBitmap(await r.blob(), { ...opts, ...small })); t.needsUpdate = true;
  return t;
}
// Geometry and animation load once per model; maps once per model and size (Customizer previews keep full size).
const bundles = {};
function loadKind(kind, mapSize = 2048, normalSize = mapSize) {
  const key = kind + '@' + mapSize + '/' + normalSize;
  bundles[key] ??= loadBase(kind).then(async base => {
    const { man } = base;
    let normalMap = null, colorMap = null;
    if (man.baseColor) {
      colorMap = await loadMap(`/assets/chars/${man.baseColor}`, mapSize);
      colorMap.flipY = false; colorMap.colorSpace = THREE.SRGBColorSpace; colorMap.anisotropy = 4;
    }
    if (man.normalMap) {
      normalMap = await loadMap(`/assets/chars/${man.normalMap}`, normalSize).catch(() => null);
      if (normalMap) { normalMap.flipY = false; normalMap.colorSpace = THREE.NoColorSpace; }
    }
    return { ...base, normalMap, colorMap };
  });
  return bundles[key];
}
function loadBase(kind) {
  if (cache[kind]) return cache[kind];
  cache[kind] = (async () => {
    const done = await viaWorker({ op: 'base', kind });
    const [man, bin] = done ? [done.man, done.bin] : await Promise.all([
      fetch(`/assets/chars/${kind}.json`).then(r => { if (!r.ok) throw new Error(kind + '.json ' + r.status); return r.json(); }),
      fetch(`/assets/chars/${kind}.bin`).then(r => { if (!r.ok) throw new Error(kind + '.bin ' + r.status); return r.arrayBuffer(); }),
    ]);
    const view = e => {
      const C = { float32: Float32Array, uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array }[e.type];
      return new C(bin, e.off, e.len / C.BYTES_PER_ELEMENT);
    };
    const lods = man.lods.map(L => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(view(L.pos), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(view(L.nrm), 3));
      if (L.uv) g.setAttribute('uv', new THREE.BufferAttribute(view(L.uv), 2));
      g.setAttribute('aJ', new THREE.BufferAttribute(view(L.j), 4));
      g.setAttribute('aW', new THREE.BufferAttribute(view(L.w), 4, true));
      g.setAttribute('aMask', new THREE.BufferAttribute(view(L.mask), 4, true));
      g.setAttribute('aLimb', new THREE.BufferAttribute(view(L.limb), 2));
      g.setAttribute('aInfo', new THREE.BufferAttribute(view(L.info), 3));
      g.setAttribute('aCov', new THREE.BufferAttribute(view(L.cov), 2));
      g.setIndex(new THREE.BufferAttribute(view(L.idx), 1));
      g.userData.tris = L.tris;
      return g;
    });
    let a = man.anim, animData = view(a.data);
    // clips added after the bake (tools/chars/extra-clips.mjs: swimming, the walk and run with their loops mended, which
    // take the place of the bake's by name below, and holding things): their frames follow the bake's own
    const ex = await extraClips(), ef = ex?.kinds?.[kind];
    let added = false;
    if (ef) {
      const eb = await fetch(`/assets/chars/${kind}.extra.bin`).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
      if (eb && eb.byteLength === ef * man.bones * 24) {
        const base = a.frames * man.bones * 12, h = Math.ceil((a.frames + ef) * man.bones * 3 / a.w), merged = new Uint16Array(h * a.w * 4);
        merged.set(animData.subarray(0, base)); merged.set(new Uint16Array(eb), base);
        man.clips = [...man.clips, ...ex.clips.map(c => ({ ...c, off: a.frames + c.off }))];
        a = man.anim = { ...a, h, frames: a.frames + ef }; animData = merged; added = true;
      }
    }
    const tex = new THREE.DataTexture(animData, a.w, a.h, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    const off = new Float32Array(NCL), len = new Float32Array(NCL);
    man.clips.forEach(c => { const k = T[c.name]; if (k !== undefined) { off[k] = c.off; len[k] = c.len; } });
    // a clip this character lacks (its added frames missing or not yet made) plays as another, never as no frames at all
    TRIPO_CLIPS.forEach((n, k) => { if (len[k]) return; const f = T[TRIPO_FALLBACK[n]] ?? T.idle; off[k] = off[f]; len[k] = len[f] || len[T.idle]; });
    // the clips placed exactly against the body (charClips.js TRIPO_EXACT) play without the arm calibration: their length
    // goes negative (char-glsl.js chRigK) — only when the character has them, not a stand-in
    for (const n of TRIPO_EXACT) if (man.clips.some(c => c.name === n)) len[T[n]] = -Math.abs(len[T[n]]);
    // where it holds things (tools/chars/extra-clips.mjs grips): only with its added frames, which the hold clips are
    const grips = added ? ex.grips?.[kind] || null : null;
    return { man, lods, tex, off, len, clip: packClips(off, len), grips };
  })();
  return cache[kind];
}

// ------------------------------------------------------------------------------------------------ shaders
const VERT_PARS = /* glsl */`
attribute vec4 aJ;
attribute vec4 aW;
attribute vec4 aMask;
attribute vec2 aLimb;
attribute vec3 aInfo;
attribute vec2 aCov;
attribute vec4 iPos;
attribute vec4 iAnim;
attribute vec4 iMisc;
uniform float uTime;
uniform float uLidForce;   // <0: automatic (blink, closed while lying); 0..1: forced
${COMMON}
${SKIN_GLSL}
#ifndef CHAR_DEPTH
varying vec3 vBind;
varying vec4 vMask;
varying vec4 vLimb;
flat varying float vApp;
flat varying float vPart;
#endif
mat4 charM;
vec3 charRig;
uniform vec3 uRig;
float charHide;
float charLid;
float charShrink;
float charH;
float charB;
mat4 chSkin(int c, float phase) {
  mat4 m = chBoneAt(c, phase, int(aJ.x + 0.5)) * aW.x;
  if (aW.y > 0.004) m += chBoneAt(c, phase, int(aJ.y + 0.5)) * aW.y;
  if (aW.z > 0.004) m += chBoneAt(c, phase, int(aJ.z + 0.5)) * aW.z;
  if (aW.w > 0.004) m += chBoneAt(c, phase, int(aJ.w + 0.5)) * aW.w;
  return m;
}
void charCompute() {
  int a = int(iMisc.y + 0.5);
  int cat = int(aInfo.y + 0.5);
  int msk = int(aInfo.z + 0.5);
  int ts = chSty(chAppI(a, 2).a), bs = chSty(chAppI(a, 3).a);
  charHide = 0.0;
  if (cat == 1) charHide = ((msk >> chSty(chAppI(a, 1).a)) & 1) == 0 ? 1.0 : 0.0;
  else if (cat == 2) charHide = ((msk >> ts) & 1) == 0 ? 1.0 : 0.0;
  else if (cat == 3) charHide = (ts == 6 || ((msk >> bs) & 1) == 0) ? 1.0 : 0.0;
  else if (cat == 6) charHide = ((msk >> chSty(chAppI(a, 5).a)) & 1) == 0 ? 1.0 : 0.0;
  charLid = 1.0;
  if (aInfo.x > 10.5) {                                        // eyelid patch: closed while lying (sleep), otherwise a short blink every few seconds
    float h = fract(sin(dot(iPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
    float per = 3.6 + h * 2.4, ph = mod(uTime + h * 17.0, per);
    charLid = ph < 0.2 ? sin(ph / 0.2 * 3.14159) : 0.0;
    if (int(iAnim.x + 0.5) == 4) charLid = 1.0;
    if (uLidForce >= 0.0) charLid = uLidForce;
    if (charLid < 0.03) charHide = 1.0;
  }
  charShrink = 0.0;
  if (cat == 0) {
    int ct = int(aCov.x + 0.5), cb = int(aCov.y + 0.5);
    bool cov = ((ct >> ts) & 1) == 1 || (ts != 6 && ((cb >> bs) & 1) == 1) || (cb & 16) == 16;
    charShrink = cov ? 0.008 : 0.0;
  }
  charH = 0.8 + chAppI(a, 0).a * 0.4;
  charB = 0.8 + chAppI(a, 6).a * 0.45;
  if (charHide > 0.5) { charM = mat4(1.0); }
  else {
    charM = chSkin(int(iAnim.x + 0.5), iAnim.y);
    if (iMisc.x > 0.003) charM = charM * (1.0 - iMisc.x) + chSkin(int(iAnim.z + 0.5), iAnim.w) * iMisc.x;
  }
  charRig = vec3(0.0);
  float rigK = chRigK(int(iAnim.x + 0.5));
  if (iMisc.x > 0.003) rigK = mix(rigK, chRigK(int(iAnim.z + 0.5)), iMisc.x);
  if (charHide < 0.5 && rigK > 0.001 && dot(uRig, uRig) > 1e-9) {
    float wl = 0.0, wr = 0.0;
    for (int k = 0; k < 4; k++) {
      float jj = aJ[k], ww = aW[k];
      if (jj > 13.5 && jj < 37.5) wl += ww; else if (jj > 40.5 && jj < 64.5) wr += ww;
    }
    float sd = wl - wr;
    if (abs(sd) > 0.002) {
      mat4 cm = chBoneAt(int(iAnim.x + 0.5), iAnim.y, 13);
      if (iMisc.x > 0.003) cm = cm * (1.0 - iMisc.x) + chBoneAt(int(iAnim.z + 0.5), iAnim.w, 13) * iMisc.x;
      charRig = mat3(cm) * vec3(sd * uRig.x, abs(sd) * uRig.y, abs(sd) * uRig.z) * rigK;
    }
  }
#ifndef CHAR_DEPTH
  vBind = position;
  vMask = aMask;
  int fl = int(iMisc.w + 0.5);
  vLimb = vec4(aLimb, float(fl & 3), float((fl >> 2) & 1));
  vApp = iMisc.y;
  vPart = aInfo.x;
#endif
}
`;
const PLACE = /* glsl */`
if (aInfo.x > 10.5) {
  transformed.y = aLimb.x - (aLimb.x - transformed.y) * charLid;
  // The added pack's measured V3 lids use category7 and a per-vertex
  // partial-blink clearance envelope. Legacy category0 lids stay exact.
  if (aInfo.y > 6.5 && aInfo.y < 7.5)
    transformed.z += max(aInfo.z, 0.0) * sqrt(max(0.0, sin(charLid * 3.14159265)));
}
transformed -= normal * charShrink;
transformed = (charM * vec4(transformed, 1.0)).xyz + charRig;
transformed.xz *= charH * charB; transformed.y *= charH;
transformed = chRot(transformed) + iPos.xyz;
if (charHide > 0.5) transformed = vec3(0.0, -1000.0, 0.0);`;

// Fragment colour: every surface is real geometry (body, garments, hair); the part id picks the appearance colour.
const FRAG_PARS = /* glsl */`
${COMMON}
varying vec3 vBind;
varying vec4 vMask;
varying vec4 vLimb;
flat varying float vApp;
flat varying float vPart;
uniform float uIndoor;
uniform vec4 uLand;   // waist, neck joint y
float aa(float d, float w) { float e = fwidth(d) + 1e-5; return 1.0 - smoothstep(w - e, w + e, d); }
vec3 charDetail(int part, vec3 c, int a) {
  vec3 p = vBind;
  int ts = chSty(chAppI(a, 2).a), bs = chSty(chAppI(a, 3).a);
  if (part == 3 && bs != 2) {                                  // belt + buckle
    float belt = aa(abs(p.y - (uLand.x - 0.004)), 0.011);
    c = mix(c, chAppI(a, 5).rgb * 0.55, belt);
    c = mix(c, vec3(0.78, 0.72, 0.55), belt * aa(abs(p.x), 0.017) * step(0.0, p.z));
    if (bs == 3) c = mix(c, c * 0.72, aa(abs(abs(p.x) - 0.105), 0.0022) * step(p.y, uLand.x - 0.05));   // jeans seam
  }
  if (part == 4) c = mix(c, vec3(0.93, 0.92, 0.89), aa(p.y, 0.027));                 // sole
  if (part == 2 && p.z > 0.0) {
    if (ts == 2) {                                             // button shirt: placket + buttons
      c = mix(c, c * 0.82, aa(abs(p.x), 0.006));
      float by = mod(p.y - uLand.x, 0.072) - 0.036;
      c = mix(c, vec3(0.94), aa(length(vec2(p.x, by)), 0.0042));
    } else if (ts == 3) {                                      // blazer: shirt in the V + lapel edge
      float v = (p.y - (uLand.x + 0.1)) * 0.42;
      float open = step(uLand.x + 0.1, p.y) * aa(abs(p.x), v);
      float lapel = step(uLand.x + 0.1, p.y) * aa(abs(p.x), v + 0.022) * (1.0 - open);
      c = mix(c, c * 0.8, lapel);
      c = mix(c, vec3(0.95, 0.95, 0.93), open);
    } else if (ts == 4) {                                      // hoodie drawstrings
      float ds = aa(abs(abs(p.x) - 0.035), 0.0028) * step(uLand.y - 0.14, p.y) * step(p.y, uLand.y - 0.01);
      c = mix(c, vec3(0.92), ds);
    }
  }
  return c;
}
vec3 charPaint() {
  int a = int(vApp + 0.5);
  int part = int(vPart + 0.5);
  vec3 skin = chAppI(a, 0).rgb;
  if (part == 0) return skin;
  if (part == 1) return chAppI(a, 1).rgb;
  if (part == 2) return charDetail(2, chAppI(a, 2).rgb, a);
  if (part == 3) return charDetail(3, chAppI(a, 3).rgb, a);
  if (part == 4) return charDetail(4, chAppI(a, 4).rgb, a);
  if (part == 5) return chAppI(a, 5).rgb * 0.8;
  if (part == 6) return vec3(0.92, 0.91, 0.88);
  if (part == 7) return chAppI(a, 2).rgb * 0.72;
  if (part == 8) return vec3(0.95, 0.95, 0.93);
  if (part == 9) return mix(skin, chAppI(a, 1).rgb, 0.3);
  if (part == 10) return chAppI(a, 3).rgb * 0.7;
  return skin;
}
float charRough() {
  int part = int(vPart + 0.5);
  return part == 0 ? 0.62 : part == 1 ? 0.55 : part == 6 ? 0.7 : part == 4 ? 0.6 : 0.88;
}
`;
const RIM = /* glsl */`
{
  // (selected or hovered: outlined instead — render/outline.js)
  totalEmissiveRadiance += diffuseColor.rgb * uIndoor * vLimb.w * 0.45;
}
`;

// ------------------------------------------------------------------------------------------------ renderer
export class Characters {
  /** warmAll: load every character in the background (the Customizer's roster), else only those that someone wears
   *  (setAppearance / ensureKind). normalSize: the normal maps' size (phones: half the colour map's). concurrency: how
   *  many characters download and decode at once. */
  constructor({ capacity = 4096, lods = [0, 1, 2], shadows = true, renderer = null, mapSize = 2048, normalSize = mapSize, warmAll = true, concurrency = 4 } = {}) {
    this.cap = 0;
    // With a renderer, a loaded model's maps and animation texture go to the GPU in spare frame time (stepped from
    // begin()) before its meshes appear, instead of all inside the frame that first draws it.
    this.renderer = renderer; this.uploads = []; this.uploaded = new WeakSet(); this.mapSize = mapSize; this.normalSize = normalSize; this.skip = 0;
    this.shadows = shadows;
    this.lodIds = lods;
    this.group = new THREE.Group();
    this.appUniform = { value: null };
    this.indoor = { value: 0 };
    this.night = { value: 0 };   // (the held screens glow at night: render/char-props.js)
    this.uTime = { value: 0 };
    this.lidForce = { value: -1 };
    // Separate original A-pose and newer T-pose calibrations. Legacy aliases
    // still address Batch1 only; saved production profiles control each group.
    const pair = () => ({ male: { value: new THREE.Vector3() }, female: { value: new THREE.Vector3() } });
    this.rigBatchU = { batch1: pair(), batch2: pair() };
    this.rigU = this.rigBatchU.batch1;
    this.rigReady = this.loadRig();
    this.uniforms = { uIndoor: this.indoor, uApp: this.appUniform, uNight: this.night };
    this.props = new CharProps(this.group, this.uniforms, shadows);
    this.appData = null;
    this.kindOf = new Uint8Array(0);
    this.kinds = [];           // per kind: { data, lods: [{ L, g, mesh, ... }], mats }
    // instance staging per (kind, lod), filled by push() even before the meshes exist
    // (each sized for the people actually drawn with that character at that detail, and doubled when more are: sized for
    // every possible person, 12032, the 129 meshes' buffers were ~74 MB of zeros sent to the GPU at the first frame —
    // 4.5 s of the phone's loading screen, 2026-10-04)
    const room0 = 256;   // (instances each character's mesh at each detail starts with room for)
    this.stage = KINDS.map(() => lods.map(() => ({ P: new Float32Array(room0 * 4), An: new Float32Array(room0 * 4), M: new Float32Array(room0 * 4), n: 0, cap: room0 })));
    this.lods = lods.map(() => ({ tris: 0 }));
    this.tableTop = null;  // (x, z, highest) → the top of the table there (m, world) or null: set by main.js (render/interiors.js)
    this.hl = [];          // this frame's selected and hovered people: { kind, j, at (their slot in the staging), sel }
    this.masks = [];       // their outline's own meshes (outlineDraw), one each
    this.grow(capacity);
    // The Customizer warms the complete roster in the background (no character waits for a first click to begin
    // downloading); the world loads only the characters someone wears (2026-10-04, the phone slowed right down after
    // loading: all 44 were fetched, ~350 MB, and kept on the GPU, though the residents wear 24). Current residents and
    // explicit selections get priority. An explicit ?only= list still limits diagnostics.
    this.demand = new Uint32Array(KINDS.length);
    const todo = [];
    const pending = new Map();
    const complete = new Map();
    let active = 0, failed = null, initialDone = false, readyResolve;
    this.ready = new Promise(resolve => { readyResolve = resolve; });
    const queue = k => {
      if (this.kinds[k]) return Promise.resolve(this.kinds[k]);
      if (!wanted(KINDS[k])) return Promise.resolve(null);
      if (pending.has(k)) return pending.get(k);
      const promise = new Promise(resolve => complete.set(k, resolve));
      pending.set(k, promise); todo.push(k); return promise;
    };
    const pump = () => {
      while (active < concurrency && todo.length) {
        todo.sort((a, b) => this.demand[b] - this.demand[a] || a - b);
        const k = todo.shift(); active++;
        loadKind(KINDS[k], this.mapSize, this.normalSize).then(d => this.upload(d)).then(d => {
          this.initKind(k, d); this.loadedCount = (this.loadedCount || 0) + 1;
          complete.get(k)(this.kinds[k]);
        }).catch(err => {
          failed = this.loadError = err; complete.get(k)(null);
          console.error('character assets failed to load', KINDS[k], err);
        }).finally(() => {
          active--; pump();
          if (!active && !todo.length && !initialDone) {
            initialDone = true; if (!failed) this.loaded = true; readyResolve();
          }
        });
      }
    };
    this.ensureKind = name => {
      const k = typeof name === 'number' ? name : KINDS.indexOf(name);
      if (k < 2 || k >= KINDS.length) return Promise.resolve(null);
      const promise = queue(k); pump(); return promise;
    };
    if (warmAll) KINDS.forEach((kind, k) => {
      if (wanted(kind)) queue(k);
    });
    pump();
    if (!active && !todo.length) { initialDone = this.loaded = true; readyResolve(); }
  }
  setRig(body, w, h, f, batch = 'batch1') {
    const uniform = this.rigBatchU[batch]?.[body];
    if (!uniform) throw new Error('Unknown rig batch/body');
    uniform.value.set(w, h, f);
  }
  loadRig() {
    return fetch('/assets/chars/rig.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => {
      const settings = normalizeRigSettings(j);
      for (const batch of RIG_BATCHES) for (const body of RIG_BODIES) {
        const p = settings.batches[batch][body];
        this.setRig(body, p.width, p.height, p.forward, batch);
      }
      return settings;
    }).catch(() => normalizeRigSettings());
  }
  makeMaterial(kind, d, depth, withMap, mask = false) {
    const U = {
      uAnim: { value: d.tex }, uClip: { value: d.clip },
      uApp: this.appUniform, uIndoor: this.indoor, uTime: this.uTime, uLidForce: this.lidForce, uRig: this.rigBatchU[rigBatchForKind(kind, d.man)][kind[0] === 'f' ? 'female' : 'male'],
      uLand: { value: new THREE.Vector4(d.man.land.waist, d.man.land.neckY ?? d.man.land.neck, 0, 0) },
    };
    const tx = !!d.colorMap;
    if (mask) {
      // (render/outline.js: the body alone, in the mask's colour — its shape as its shadow has it)
      const m = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, fog: false });
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U, { uMaskCol: MASK_COL });
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n#define CHAR_DEPTH\n' + VERT_PARS)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ncharCompute();' + PLACE);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uMaskCol;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor = vec4(uMaskCol, 1.0);');
      };
      m.customProgramCacheKey = () => 'mvw-tripo-mask';
      return m;
    }
    const m = depth ? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
      : new THREE.MeshStandardMaterial({ roughness: tx ? 0.8 : 0.74, metalness: 0, map: tx ? d.colorMap : null, normalMap: withMap ? d.normalMap : null });
    if (!depth && withMap && d.normalMap) m.normalScale = new THREE.Vector2(1, -1);   // glTF normal maps without tangents: flip green (as GLTFLoader does)
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      let v = sh.vertexShader.replace('#include <common>', '#include <common>\n' + (depth ? '#define CHAR_DEPTH\n' : '') + VERT_PARS);
      if (depth) v = v.replace('#include <begin_vertex>', '#include <begin_vertex>\ncharCompute();' + PLACE);
      else {
        v = v.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\ncharCompute();\nobjectNormal = chRot(mat3(charM) * objectNormal);')
          .replace('#include <begin_vertex>', '#include <begin_vertex>' + PLACE);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS);
        if (!tx) sh.fragmentShader = sh.fragmentShader
          .replace('#include <color_fragment>', 'diffuseColor.rgb *= charPaint();')
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = charRough();')
          .replace('#include <normal_fragment_maps>', 'if (vPart < 0.5) {\n#include <normal_fragment_maps>\n}');
        if (tx) sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nif (vPart > 10.5) diffuseColor.rgb = mix(diffuseColor.rgb * 0.92, vec3(0.03, 0.02, 0.02), smoothstep(0.86, 0.97, vLimb.y));')
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + RIM);
      }
      sh.vertexShader = v;
    };
    // Bone/paint/shading code is identical between model IDs. Share programs
    // by actual shader variant, not by filename, avoiding a compile hitch for
    // every new Customizer choice. Per-material uniforms remain independent.
    m.customProgramCacheKey = () => `mvw-tripo-${tx ? 'textured' : 'painted'}-${depth ? 'd' : withMap ? 'n' : 'p'}`;
    return m;
  }
  upload(d) {
    const pending = this.renderer ? [d.colorMap, d.normalMap, d.tex].filter(t => t && !this.uploaded.has(t)) : [];
    if (!pending.length) return d;
    return new Promise(resolve => pending.forEach((t, i) => this.uploads.push(() => {
      try { this.renderer.initTexture(t); } catch (err) { console.error('character texture upload failed', err); }
      this.uploaded.add(t);
      if (i === pending.length - 1) resolve(d);
    })));
  }
  /**
   * Stand-ins for the characters' shaders — the clothed body (colour map, and normal map when they load one) and its
   * shadow's depth — to compile with the world's at load (render: main.js). The characters arrive after the loading
   * screen, and compiling their shader then held a frame 130–400 ms on the phone (2026-10-04). Kept afterwards, so
   * three.js keeps the programs for the real characters.
   */
  warmGroup() {
    const tex = cs => { const t = new THREE.DataTexture(new Uint8Array(4), 1, 1); t.colorSpace = cs; t.needsUpdate = true; return t; };
    const anim = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType); anim.needsUpdate = true;
    const d = { tex: anim, off: new Float32Array(NCL), len: new Float32Array(NCL), clip: packClips(new Float32Array(NCL), new Float32Array(NCL)), man: { land: { waist: 1, neck: 1.5 } }, colorMap: tex(THREE.SRGBColorSpace), normalMap: this.normalSize ? tex(THREE.NoColorSpace) : null };
    const g = new THREE.Group(), geo = new THREE.PlaneGeometry(0.01, 0.01);
    for (const m of [this.makeMaterial('f01', d, false, true), this.makeMaterial('f01', d, true, false)]) { const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = false; mesh.position.y = -9999; g.add(mesh); }
    this.warmKept = g;
    return g;
  }
  initKind(k, d) {
    const kind = KINDS[k];
    const mats = { map: this.makeMaterial(kind, d, false, true), plain: this.makeMaterial(kind, d, false, false), depth: this.makeMaterial(kind, d, true, false) };
    const lods = this.lodIds.map((L, j) => {
      const base = d.lods[Math.min(L, d.lods.length - 1)];
      if (!this.lods[j].tris) this.lods[j].tris = base.userData.tris;
      return this.makeLod(k, j, L, base, mats);
    });
    this.kinds[k] = { d, mats, lods };
    this.props.initKind(k, d, this.rigBatchU[rigBatchForKind(kind, d.man)][kind[0] === 'f' ? 'female' : 'male']);
  }
  makeLod(k, j, L, base, mats) {
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(base.index);
    for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
    const st = this.stage[k][j];
    const mk = arr => { const a = new THREE.InstancedBufferAttribute(arr, 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const iPos = mk(st.P), iAnim = mk(st.An), iMisc = mk(st.M);
    g.setAttribute('iPos', iPos); g.setAttribute('iAnim', iAnim); g.setAttribute('iMisc', iMisc);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e6, -1e6, -1e6), new THREE.Vector3(1e6, 1e6, 1e6));
    const mesh = new THREE.Mesh(g, base.attributes.uv ? mats.map : mats.plain);
    mesh.frustumCulled = false;
    mesh.castShadow = this.shadows && L < 2; mesh.userData.smallCaster = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = mats.depth;
    mesh.renderOrder = 1;
    this.group.add(mesh);
    return { L, g, mesh, iPos, iAnim, iMisc };
  }
  /** Make room for at least n agents (instance buffers + appearance texture). */
  grow(n) {
    if (n <= this.cap) return;
    const cap = Math.max(256, Math.ceil(n / 128) * 128);
    const rows = cap / 128;
    const data = new Uint8Array(1024 * rows * 4);
    if (this.appData) data.set(this.appData.subarray(0, Math.min(this.appData.length, data.length)));
    this.appData = data;
    const tex = new THREE.DataTexture(data, 1024, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.needsUpdate = true;
    if (this.appTex) this.appTex.dispose();
    this.appTex = tex; this.appUniform.value = tex;
    const ko = this.kindOf; this.kindOf = new Uint8Array(cap); this.kindOf.set(ko.subarray(0, Math.min(ko.length, cap)));
    this.cap = cap;
  }
  /** Room for one more instance of character `kind` at detail `j`: its staging doubles, and its mesh is rebuilt round it. */
  room(kind, j) {
    const s = this.stage[kind]?.[j]; if (!s) return null;
    if (s.n < s.cap) return s;
    if (s.cap >= this.cap) return null;
    const cap = Math.min(this.cap, s.cap * 2), more = a => { const b = new Float32Array(cap * 4); b.set(a); return b; };
    s.P = more(s.P); s.An = more(s.An); s.M = more(s.M); s.cap = cap;
    const kd = this.kinds[kind];
    if (kd) { const l = kd.lods[j]; this.group.remove(l.mesh); l.g.dispose(); kd.lods[j] = this.makeLod(kind, j, l.L, kd.d.lods[Math.min(l.L, kd.d.lods.length - 1)], kd.mats); }
    return s;
  }
  setShadows(on) { this.shadows = on; for (const kd of this.kinds) if (kd) for (const l of kd.lods) l.mesh.castShadow = on && l.L < 2; this.props.setShadows(on); }
  setAppearance(i, app) {
    if (i >= this.cap) this.grow(i + 1);
    packAppearance(app, this.appData, (i >> 7) * 4096 + (i & 127) * 32);
    const ck = KINDS.indexOf(app && app.char ? app.char : defaultChar(app || {}));
    this.kindOf[i] = ck >= 2 ? ck : KINDS.indexOf(defaultChar(app || {}));
    if (this.demand) this.demand[this.kindOf[i]]++;
    if (this.ensureKind) this.ensureKind(this.kindOf[i]);
    this.appTex.needsUpdate = true;
  }
  begin() { this.stepUploads(); for (const s of this.stage.flat()) s.n = 0; this.props.begin(); this.hl.length = 0; }
  /** One upload at most, after a frame that kept to this device's normal pace (or when nothing went up for 250 ms),
   *  then spaced so uploads average under ~4 ms a frame. Judged against the device's own typical frame time, so a
   *  device that is always a little slower still loads steadily and only spikes are skipped. */
  stepUploads() {
    if (!this.uploads.length) return;
    const now = performance.now(), gap = now - (this.lastBegin ?? now); this.lastBegin = now;
    if (gap > 0 && gap < 250) this.typGap = this.typGap ? this.typGap + (gap - this.typGap) * 0.1 : gap;
    if (this.skip > 0) { this.skip--; return; }
    if (gap > Math.max(20, (this.typGap || 0) * 1.25) && now - (this.lastUpload ?? -1e9) < 250) return;
    this.uploads.shift()();
    const end = performance.now(); this.lastUpload = end; this.skip = Math.min(8, Math.floor((end - now) / 4));
  }
  /**
   * A point of a hand's grip frame (tools/chars/extra-clips.mjs: x the index finger's side, y along the fingers, z out of
   * the palm, on the palm) where character `app` has it in MVW clip c at phase u — worked out on the CPU from the same
   * baked frames the shader skins with (the fishing line hangs off the rod's tip, the catch lies in the hands). side:
   * 'R' or 'L'. → [x, y, z] in the body's own frame (before its height, build and turn: bodyToWorld), or null while its
   * model loads. (For the clips that play without the arm calibration — charClips.js TRIPO_EXACT — this is exact.)
   */
  gripPoint(app, c, u, side, p = [0, 0, 0], out = [0, 0, 0]) {
    const kd = this.kinds[app < this.kindOf.length ? this.kindOf[app] : 0], d = kd?.d, gr = d?.grips?.[side];
    if (!d || !gr || !d.tex?.image?.data) return null;
    const bone = (d._hand ??= (() => { const names = d.man.names.map(n => n.replace(/^mixamorig:/, '')); return { R: names.indexOf('RightHand'), L: names.indexOf('LeftHand') }; })())[side];
    const k = OLD2T[c] ?? 0, L = Math.abs(d.len[k]), n = Math.round(L), o = Math.round(d.off[k]);
    if (!(n > 0) || bone < 0) return null;
    const f = (((u % 1) + 1) % 1) * L, f0 = Math.floor(f), t = f - f0;
    // the grip point in the hand's bind space, then the hand's bone at the two frames either side, blended
    const gx = gr[0] * p[0] + gr[1] * p[1] + gr[2] * p[2] + gr[3], gy = gr[4] * p[0] + gr[5] * p[1] + gr[6] * p[2] + gr[7], gz = gr[8] * p[0] + gr[9] * p[1] + gr[10] * p[2] + gr[11];
    const data = d.tex.image.data, half = THREE.DataUtils.fromHalfFloat;
    out[0] = out[1] = out[2] = 0;
    for (const [fr, w] of [[o + (f0 % n), 1 - t], [o + ((f0 + 1) % n), t]]) {
      const i = (fr * 65 + bone) * 3;
      for (let r = 0; r < 3; r++) { const q = (i + r) * 4; out[r] += w * (half(data[q]) * gx + half(data[q + 1]) * gy + half(data[q + 2]) * gz + half(data[q + 3])); }
    }
    return out;
  }
  /** k = lod index into this.lods; cA/cB are MVW clip ids (anim.js CLIP), mapped to Tripo clips here. prop: what they hold
   *  (shared/anims.js PROP), drawn with them up close (render/char-props.js); item: the food or drink item (shared/food.js). */
  push(k, x, y, z, yaw, cA, pA, cB, pB, w, app, prop, flags, item = 0, ghost = false) {
    const kind = app < this.kindOf.length ? this.kindOf[app] : 0;
    const s = this.room(kind, k);
    if (!s) return;
    let a = OLD2T[cA] ?? 0, b = OLD2T[cB] ?? 0;
    if (a === DANCE) a += app % 6;
    if (b === DANCE) b += app % 6;
    // ghost: the body left out, what it holds or has on the table drawn (a screen being used through its eyes)
    if (!ghost) {
      const o = s.n * 4; s.n++;
      s.P[o] = x; s.P[o + 1] = y; s.P[o + 2] = z; s.P[o + 3] = yaw;
      s.An[o] = a; s.An[o + 1] = pA; s.An[o + 2] = b; s.An[o + 3] = pB;
      s.M[o] = w; s.M[o + 1] = app; s.M[o + 2] = prop; s.M[o + 3] = flags;
      if (flags & 3) this.hl.push({ kind, j: k, at: o, sel: (flags & 3) === 2 });   // (selected or hovered: outlined — render/outline.js)
    }
    const shape = prop || item || GEAR_CLIP[cA] ? shapeFor(cA, prop, item) : 0;   // (item: the drink they hold, the dish they eat — shared/food.js; a fishing rod)
    if (shape && this.lodIds[k] < 2 && this.kinds[kind]) {
      // (set down on a table: on the top of the one in front of them — a picnic table, a bar stands higher than a café's)
      if (onTable(shape)) { const r = this.deskRoot(kind, app, x, y, z, yaw, _root); this.props.push(kind, r[0], r[1], r[2], yaw, a, pA, b, pB, w, app, shape, flags); }
      else this.props.push(kind, x, y, z, yaw, a, pA, b, pB, w, app, shape, flags);
    }
  }
  /**
   * How far the table in front of a seated person stands above or below a table's usual height (char-props.js DESK_TOP):
   * the top of the one under their desk point (tableTop(x, z, highest): render/interiors.js), 0 when none is known.
   * app: who (their height and build), kind: their model. back ([m]): set to how far it must come back toward them on that
   * table (its lid clear of a bar's bottles).
   */
  deskLift(kind, app, x, y, z, yaw, back = null) {
    if (back) back[0] = 0;
    const desk = this.props.desks[kind];
    if (!desk || !this.tableTop || !this.appData) return 0;
    const base = (app >> 7) * 4096 + (app & 127) * 32;
    const H = 0.8 + (this.appData[base + 3] / 255) * 0.4, Bd = 0.8 + (this.appData[base + 27] / 255) * 0.45;
    const [px, , pz] = deskPoint(desk, H, Bd), c = Math.cos(yaw), s = Math.sin(yaw);
    if (back) { _far.x = x + px * c + (pz + DESK_LID) * s; _far.z = z - px * s + (pz + DESK_LID) * c; }
    const top = this.tableTop(x + px * c + pz * s, z - px * s + pz * c, y + 1.4, back ? _far : null);
    const lift = top == null ? 0 : top - y - DESK_TOP;
    if (!(lift > -0.3 && lift < 0.45)) return 0;
    if (back) back[0] = _far.back;
    return lift;
  }
  /** Where what is set down on the table in front of a seated person is placed from (out: [x, y, z]): their root, lifted
   *  to the top of the table there and brought back toward them as far as that table needs (deskLift). */
  deskRoot(kind, app, x, y, z, yaw, out) {
    const lift = this.deskLift(kind, app, x, y, z, yaw, _back), b = _back[0];
    out[0] = x - Math.sin(yaw) * b; out[1] = y + lift; out[2] = z - Math.cos(yaw) * b;
    return out;
  }
  /** Direct Tripo clip index variant (showcase / customizer): same as push but clips are TRIPO_CLIPS indices. */
  pushT(k, x, y, z, yaw, tA, pA, tB, pB, w, app, prop = 0, flags = 0) {
    const kind = app < this.kindOf.length ? this.kindOf[app] : 0;
    const s = this.room(kind, k);
    if (!s) return;
    const o = s.n * 4; s.n++;
    s.P[o] = x; s.P[o + 1] = y; s.P[o + 2] = z; s.P[o + 3] = yaw;
    s.An[o] = tA; s.An[o + 1] = pA; s.An[o + 2] = tB; s.An[o + 3] = pB;
    s.M[o] = w; s.M[o + 1] = app; s.M[o + 2] = prop; s.M[o + 3] = flags;
  }
  end() {
    this.uTime.value = performance.now() / 1000;
    this.props.end();
    this.kinds.forEach((kd, k) => {
      if (!kd) return;
      kd.lods.forEach((l, j) => {
        const n = this.stage[k][j].n;
        l.g.instanceCount = n;
        l.mesh.visible = n > 0;   // 132 kind/LOD meshes: empty ones skip both render passes entirely
        if (!n) return;
        for (const a of [l.iPos, l.iAnim, l.iMisc]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
      });
    });
  }
  /** The selected and hovered people drawn alone, for their outline (render/outline.js): a mesh each, of their body at
   *  the detail they are drawn at, with just their instance. */
  outlineDraw(draw) {
    this.hl.forEach((h, n) => {
      const kd = this.kinds[h.kind]; if (!kd) return;
      kd.mask ??= this.makeMaterial(KINDS[h.kind], kd.d, false, false, true);
      const l = kd.lods[h.j], st = this.stage[h.kind][h.j];
      let m = this.masks[n];
      if (!m || m.userData.src !== l.g) {
        if (m) m.geometry.dispose();
        const g = new THREE.InstancedBufferGeometry();
        g.setIndex(l.g.index);
        for (const [name, attr] of Object.entries(l.g.attributes)) if (!attr.isInstancedBufferAttribute) g.setAttribute(name, attr);
        for (const name of ['iPos', 'iAnim', 'iMisc']) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
        g.instanceCount = 1;
        g.boundingSphere = l.g.boundingSphere;
        m = this.masks[n] = new THREE.Mesh(g, kd.mask);
        m.frustumCulled = false; m.matrixAutoUpdate = false; m.matrixWorldAutoUpdate = false; m.userData.src = l.g; m.userData.box = new THREE.Box3();
      }
      m.material = kd.mask;
      for (const [name, arr] of [['iPos', st.P], ['iAnim', st.An], ['iMisc', st.M]]) {
        const a = m.geometry.attributes[name];
        for (let c = 0; c < 4; c++) a.array[c] = arr[h.at + c];
        a.needsUpdate = true;
      }
      // (round them: the tallest, broadest body, arms out)
      const o = h.at, x = st.P[o], y = st.P[o + 1], z = st.P[o + 2];
      m.userData.box.min.set(x - 1.3, y - 0.2, z - 1.3); m.userData.box.max.set(x + 1.3, y + 2.5, z + 1.3);
      draw(m, h.sel, m.userData.box);
    });
  }
  stats() { return this.lodIds.map((_, j) => this.stage.reduce((a, s) => a + s[j].n, 0)); }
}
export { TRIPO_CLIPS };
