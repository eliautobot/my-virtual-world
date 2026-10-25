// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Renderer, scene, sky dome, sun/moon, fog, environment map, time of day, post-processing.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Outline } from './outline.js';
import { rf } from '../core/render-flags.js';
import { clamp, smoothstep } from '../core/util.js';
import { SNOW_LINE } from '/shared/terrain.js';

/**
 * The atmosphere (2026-10-04: "some kind of atmosphere haze, not fog because I don't want it to fully block far
 * distances, but a bit hazy so that details like waterfalls don't get made out from farther distances. Also around
 * mountains there should be a mist around those heights with snow ... and around very tall mountains fog/mist"), for
 * every material that takes fog (three's fog chunks, replaced once here):
 * - haze: aerial perspective — the view fades toward the horizon's colour with distance, a fifth at 1 km, two fifths at
 *   2.5 km (halved since: a tenth at 1 km, a fifth at 2.5 km), thinner where the line of sight runs high;
 * - mountain mist: a patchy band from a little under the snowline (shared/terrain.js SNOW_LINE) up past the peaks,
 *   seen more the farther off it is, a little brighter than the haze by day;
 * - the weather's fog (the scene's linear Fog: fog banks and rain close the view in) on top, as before.
 */
const HAZE_MAX = 0.31, HAZE_D = 2400;   // (half what it was: 2026-10-04, "reduce the world haze by 50%")
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
varying float vFogDepth;
varying vec3 vFogView;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
vFogDepth = - mvPosition.z;
vFogView = mvPosition.xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
uniform vec3 fogColor;
varying float vFogDepth;
varying vec3 vFogView;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear;
uniform float fogFar;
#endif
uniform vec2 mvwMistOff;
uniform float mvwMap;
float mvwH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float mvwN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mvwH(i), mvwH(i + vec2(1.0, 0.0)), f.x), mix(mvwH(i + vec2(0.0, 1.0)), mvwH(i + vec2(1.0, 1.0)), f.x), f.y); }
// how much of the fog's colour (haze and the weather's fog) and of the mist's
float mvwFog(out float mist) {
  vec3 wp = cameraPosition + transpose(mat3(viewMatrix)) * vFogView;
  float d = length(vFogView);
  float hAvg = max(0.0, 0.5 * (cameraPosition.y + wp.y));
  float haze = ${HAZE_MAX.toFixed(2)} * (1.0 - exp(-d / ${HAZE_D.toFixed(1)})) * mix(1.0, 0.5, smoothstep(180.0, 1100.0, hAvg));
  float L = ${SNOW_LINE.toFixed(1)};
  float band = smoothstep(L - 130.0, L - 40.0, wp.y) * (1.0 - smoothstep(L + 260.0, L + 420.0, wp.y));
  mist = 0.0;
  if (band > 0.0) {
    // it drifts with the wind (mvwMistOff, metres blown so far), the finer layer a little faster so the banks change shape
    vec2 q = (wp.xz - mvwMistOff) * 0.0035 + wp.y * 0.002;
    float n = mvwN(q) * 0.65 + mvwN((q - mvwMistOff * 0.0021) * 2.7 + 5.0) * 0.35;
    mist = band * smoothstep(0.32, 0.74, n) * 0.68 * smoothstep(40.0, 700.0, d);
  }
  #ifdef FOG_EXP2
  float wf = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
  float wf = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  return max(haze, wf);
}
vec3 mvwMistCol() { float l = dot(fogColor, vec3(0.299, 0.587, 0.114)); return mix(fogColor, vec3(min(1.0, l * 1.25 + 0.06)), 0.55); }
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
float mvwMist;
float fogFactor = mvwFog(mvwMist);
gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
gl_FragColor.rgb = mix(gl_FragColor.rgb, mvwMistCol(), mvwMist * (1.0 - fogFactor * 0.5));
// the property map (render/lots.js): the world turns to pale clay, keeping its light and shade, so the lots' colours read
// (the same on the screen pass, which writes sRGB, and the linear buffer High's bloom reads and tone-maps later)
if (mvwMap > 0.0) {
  bool mvwLin = linearToOutputTexel(vec4(0.5)).r < 0.6;
  float mvwL = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
  if (mvwLin) mvwL = pow(clamp(mvwL, 0.0, 1.0), 1.0 / 2.2);
  vec3 mvwClay = vec3(0.42 + 0.4 * mvwL) * vec3(0.96, 0.975, 1.0);
  if (mvwLin) mvwClay = pow(mvwClay, vec3(2.2)) * 0.85;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, mvwClay, mvwMap * 0.9);
}
#endif`;
/**
 * The mist's drift reaches every material: three gives each material its own copy of the fog uniforms, so one shared
 * value is handed to each material's uniforms as its shader is built — every material's onBeforeCompile (its own, if it
 * sets one, runs first) adds GU.uMistOff. The program cache key stays the material's own hook's text.
 */
const mistHook = (sh) => { if (sh.uniforms) { sh.uniforms.mvwMistOff = GU.uMistOff; sh.uniforms.mvwMap = GU.uMap; } };
mistHook.toString = THREE.Material.prototype.onBeforeCompile.toString.bind(THREE.Material.prototype.onBeforeCompile);
Object.defineProperty(THREE.Material.prototype, 'onBeforeCompile', {
  configurable: true,
  get() { return this._mvwHook ?? mistHook; },
  set(fn) {
    const hook = typeof fn === 'function' ? function (sh, r) { fn.call(this, sh, r); mistHook(sh); } : mistHook;
    if (typeof fn === 'function') hook.toString = () => fn.toString();
    Object.defineProperty(this, '_mvwHook', { value: hook, writable: true, configurable: true, enumerable: false });
  },
});

const DPR = Math.min(window.devicePixelRatio || 1, 2);
export const QUALITY = {
  low: { name: 'low', charMap: 512, pr: 1, shadows: false, shadowSize: 0, bloom: false, aa: false, lod0: 16, lod1: 55, lod2: 300 },
  medium: { name: 'medium', charMap: 1024, pr: Math.min(DPR, 1.25), shadows: true, shadowSize: 1024, bloom: false, aa: true, lod0: 26, lod1: 85, lod2: 450 },
  high: { name: 'high', charMap: 2048, pr: Math.min(DPR, 1.6), shadows: true, shadowSize: 2048, bloom: true, aa: true, lod0: 38, lod1: 120, lod2: 650 },
};
/** Uniforms shared by every custom material (updated once per frame). */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // comparisons with NaN are false, which the optimiser can't fold away the way it may an isnan()
      bvec4 ok = lessThan(abs(c), vec4(6.0e4));
      if (any(isnan(c)) || any(isinf(c)) || !all(ok)) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = c;
    }`,
};
export const GU = {
  uTime: { value: 0 }, uNight: { value: 0 }, uDay: { value: 1 }, uHour: { value: 12 },
  uFocusB: { value: -1 }, uCutY: { value: 1e6 }, uIndoor: { value: 0 },
  uFade: { value: new THREE.Vector4(0, 0, 0, 0) }, uCamP: { value: new THREE.Vector3() },
  uInB: { value: -1 },   // the building the camera is inside, all of it hidden (render/buildings.js cameraIn), or -1
  // the music on the floor looked into (render/venue-motion.js): its beat (beats since the song began) and whether one plays
  uBeat: { value: 0 }, uBeatOn: { value: 0 },
  // the camera under water (Stage.underwater): 1, and the water's colour there and the light through its surface overhead
  uUnder: { value: 0 }, uUnderCol: { value: new THREE.Color() }, uUnderSky: { value: new THREE.Color() },
  // ... and the world above the surface as seen from there (Stage.renderAbove): its image, the view's matrix, whether drawn
  uAbove: { value: null }, uUwVP: { value: new THREE.Matrix4() }, uAboveOn: { value: 0 },
  uLightMap: { value: null }, uLightRect: { value: new THREE.Vector4(-500, -500, 1000, 1000) },
  uLightMap2: { value: null }, uLightRect2: { value: new THREE.Vector4(-1e7, -1e7, 1, 1) },   // the island roads' lamps (render/island-roads.js)
  // The weather (WP4.18): wind (x, z = where it blows, m/s; w = gust 0..1) and how wet the ground is (0..1).
  uWind: { value: new THREE.Vector4(1.5, 0, 0, 0) }, uWet: { value: 0 },
  // the plants' sway phases (trees, grass, crops, the crop-field wave), advanced each frame faster in a stronger wind
  // (render/weather.js): a phase of time × a speed that changes with every gust jumped about (the jittery sway)
  uSway: { value: new THREE.Vector4() },
  // how far the wind has blown the mountain mist (metres, x and z; render/weather.js adds to it each frame)
  uMistOff: { value: new THREE.Vector2() },
  // the property map's pale world (0 off .. 1 on; ui/property.js eases it)
  uMap: { value: 0 },
};

/**
 * Send only the first `count` items of an instance attribute to the GPU this frame (none when it is empty). three.js
 * otherwise sends the whole buffer: the traffic sent ~0.9 MB a frame, mostly unused room, and the scatter pools whole
 * when the camera moved on — a busy phone's GPU process could not take that in without holding the page up for
 * 100-200 ms (2026-10-04: driving jittery with big stalls).
 */
export function uploadUsed(attr, count) {
  if (!attr) return;
  attr.clearUpdateRanges();
  if (count > 0) { attr.addUpdateRange(0, count * attr.itemSize); attr.needsUpdate = true; }
}

/**
 * Rain wets a material (WP4.18): darker and glossier while GU.uWet is up (it dries slowly after the rain). Chains any
 * onBeforeCompile the material already has.
 */
export function wettable(material, { darken = 0.28, gloss = 0.5 } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    sh.uniforms.uWet = GU.uWet;
    sh.fragmentShader = 'uniform float uWet;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.rgb *= 1.0 - ${darken.toFixed(2)} * uWet;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, roughnessFactor * ${(1 - gloss).toFixed(2)}, uWet);`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|wet`;
  return material;
}

const SKY_V = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_F = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunCol, uMoonDir;
uniform float uNight, uTime, uSunVis, uCloud, uCover, uStorm, uFlash;
uniform vec2 uCloudOff;
varying vec3 vDir;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5), b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5);
  float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5), d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, uGround, smoothstep(0.0, -0.15, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(sd, 6.0) * 0.28 + pow(sd, 90.0) * 0.7) * uSunVis;
  col += uSunCol * smoothstep(0.99955, 0.99985, sd) * 14.0 * uSunVis;
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.85, 0.9, 1.0) * smoothstep(0.99935, 0.99965, md) * 2.5 * uNight;
  col += vec3(0.22, 0.28, 0.45) * pow(md, 20.0) * 0.35 * uNight;
  if (uNight > 0.02 && h > 0.02) {
    vec3 p = d * 440.0; vec3 c = floor(p); float r = h3(c);
    if (r > 0.9968) { vec3 f = fract(p) - 0.5; float s = smoothstep(0.24, 0.0, length(f));
      col += vec3(0.9, 0.93, 1.0) * s * uNight * (0.55 + 0.45 * sin(uTime * 1.7 + r * 91.0)) * smoothstep(0.02, 0.25, h); }
  }
  // Overcast skies go grey toward the horizon; storms darker still.
  vec3 grey = mix(vec3(0.6, 0.63, 0.68), vec3(0.24, 0.26, 0.3), uStorm) * (1.0 - 0.85 * uNight) + vec3(0.03, 0.035, 0.05) * uNight;
  col = mix(col, grey, smoothstep(0.55, 1.0, uCover) * 0.85 * smoothstep(-0.05, 0.1, h));
  if (h > 0.0) {
    // Clouds drift with the wind (uCloudOff); cover sets how much of the sky they fill.
    vec2 uv = d.xz / (h + 0.12) * 1.4 + uCloudOff;
    float cl = n2(uv) * 0.55 + n2(uv * 2.3) * 0.3 + n2(uv * 5.1) * 0.15;
    float thr = mix(0.8, 0.28, uCover);
    cl = smoothstep(thr, thr + 0.22, cl) * smoothstep(0.0, 0.25, h) * uCloud;
    vec3 lit = mix(uHorizon * 1.15, vec3(1.0), 0.55), dark = mix(vec3(0.55, 0.57, 0.62), vec3(0.22, 0.23, 0.27), uStorm);
    vec3 ccol = mix(vec3(0.07, 0.09, 0.14), mix(lit, dark, smoothstep(0.4, 1.0, uCover)), 1.0 - uNight);
    col = mix(col, ccol + uSunCol * pow(sd, 4.0) * 0.25 * uSunVis * (1.0 - uCover), cl * 0.85);
  }
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + 0.6 * smoothstep(-0.1, 0.4, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const C = hex => new THREE.Color(hex);
const PAL = {
  zDay: C('#3a7ad6'), hDay: C('#b7d6f2'), zDusk: C('#3b5c99'), hDusk: C('#f09a60'), zNight: C('#060a18'), hNight: C('#17223d'),
  sunLow: C('#ffa060'), sunHigh: C('#fff4e6'), moon: C('#9fb4ff'),
  gDay: C('#6d6a5e'), gNight: C('#0c0f16'),
};

/**
 * Sharp upscaling (render flag 'sharpen'; the reference renderer sharpens as it scales its picture up to the screen):
 * when automatic resolution draws fewer pixels, the picture is scaled up with a contrast-adaptive sharpen (AMD's CAS,
 * lightly): each screen pixel is the bilinear sample pushed away from its four neighbours a source pixel off, by an
 * amount that backs off where the contrast is already high (no halos), so 0.7–0.9 of the pixels read close to full.
 */
const SharpenShader = {
  uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) }, uSharp: { value: 0.6 } },
  vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uSharp; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb, s = texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
  vec3 e = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb, w = texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb;
  vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
  vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
  vec3 k = -amp * mix(0.125, 0.2, uSharp);
  gl_FragColor = vec4(clamp((c + (n + s + e + w) * k) / (1.0 + 4.0 * k), 0.0, 1.0), 1.0);
}`,
};

export class Stage {
  constructor(canvas, qualityName) {
    this.q = QUALITY[qualityName] || QUALITY.high;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.q.aa && !this.q.bloom, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(this.q.pr);
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    // ACES filmic (2026-10-03: Neutral made the city "way too over colorful ... saturated" — back to what it was)
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = this.q.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    // three.js asks the driver about every shader once it is first used (link status and logs: a wait on the GPU each,
    // ~1.8 s of the phone's loading screen, 2026-10-04); phones skip that unless ?glcheck — desktops and tests keep it
    r.debug.checkShaderErrors = !matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('glcheck');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 5000);
    // sky
    this.skyU = {
      uZenith: { value: PAL.zDay.clone() }, uHorizon: { value: PAL.hDay.clone() }, uGround: { value: PAL.gDay.clone() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uNight: { value: 0 }, uTime: GU.uTime, uSunVis: { value: 1 }, uCloud: { value: 1 }, uCover: { value: 0.35 }, uStorm: { value: 0 }, uFlash: { value: 0 }, uCloudOff: { value: new THREE.Vector2() },
    };
    const skyMat = new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_V, fragmentShader: SKY_F, side: THREE.BackSide, depthWrite: false, fog: false });
    const skyGeo = new THREE.SphereGeometry(100, 48, 24);
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(skyGeo, skyMat));
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envRT = null; this.envHour = -99;
    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = this.q.shadows;
    if (this.q.shadows) {
      this.sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
      const sc = this.sun.shadow.camera; sc.near = 1; sc.far = 2000;
      // bias is in depth units over near..far: -0.0004 was 0.8 m, which lifted every shadow off the ground by that much
      // (people's shins and feet cast none). ~8 cm; normalBias (per frame, a texel) keeps acne away.
      this.sun.shadow.bias = -0.08 / (sc.far - sc.near);
    }
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a5448, 0.5);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.Fog(0xb7d6f2, 400, 2600);
    this.state = { hour: 12, day: 1, night: 0, sunY: 1 };
    /** The weather the renderer shows (render/weather.js sets it each frame): cloud cover, rain, fog, storm (0..1), lightning flash. */
    this.weather = { cloud: 0.35, rain: 0, fog: 0, storm: 0, flash: 0 };
    this._v = new THREE.Vector3(); this._r = new THREE.Vector3(); this._u = new THREE.Vector3(); this._fogGrey = new THREE.Color();
    this.under = null; this._uwCol = { sea: new THREE.Color('#1c6d7c'), lake: new THREE.Color('#2a6b5a'), river: new THREE.Color('#3a6e5c') }; this._white = new THREE.Color(1, 1, 1);
    this._air = { col: new THREE.Color(), near: 0, far: 0 }; this._fogKeep = new THREE.Color(); this._v2 = new THREE.Vector3(); this.aboveRT = null;
    this.underOnly = [];   // things drawn only under the water (left out of the world above: render/underwater-fx.js)
    if (this.q.bloom) this.initComposer();
    this.outline = new Outline(this);   // (what is picked or under the pointer: outlined over the finished picture)
    window.addEventListener('resize', () => this.resize());
  }
  initComposer() {
    const r = this.renderer, w = window.innerWidth, h = window.innerHeight;
    const rt = new THREE.WebGLRenderTarget(w * this.q.pr, h * this.q.pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.setPixelRatio(this.q.pr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // A pixel any shader got wrong (NaN or infinite, e.g. pow() of a negative number on Direct3D) is put to black here:
    // the bloom's blur would otherwise spread it into black blocks over the screen (2026-10-05: the screen turned
    // black zoomed out over one spot).
    this.composer.addPass(new ShaderPass(SanitizeShader));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.10, 0.40, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    if (rf('sharpen')) { this.sharpen = new ShaderPass(SharpenShader); this.sharpen.enabled = false; this.composer.addPass(this.sharpen); }
  }
  /**
   * Medium and Low with sharp upscaling, while drawing fewer pixels: the scene is drawn straight into a corner of the
   * canvas at pr × scale, copied into a texture and drawn back over the whole canvas through the sharpen. (It used to be
   * drawn into a render target, which needs every material's other shader variant — linear, not tone-mapped: the first
   * time the resolution dropped, the phone froze 3.7 s compiling them all, 2026-10-04. Drawn to the canvas, the
   * materials keep the one variant they were compiled in at load.)
   */
  initUpscale() {
    const m = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(SharpenShader.uniforms), fragmentShader: SharpenShader.fragmentShader,
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', depthTest: false, depthWrite: false });
    this.upQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); this.upQuad.frustumCulled = false;
    this.upCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); this.upTex = null; this._dbs = new THREE.Vector2(); this._p0 = new THREE.Vector2();
  }
  /** Sizes for sharp upscaling: the canvas keeps the full pixel ratio, the picture is drawn at pr × scale. */
  sizeUpscale() {
    const s = this.resScale ?? 1, pr = this.q.pr * s, w = window.innerWidth, h = window.innerHeight;
    const texel = new THREE.Vector2(1 / Math.max(1, Math.round(w * pr)), 1 / Math.max(1, Math.round(h * pr)));
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); if (this.sharpen) { this.sharpen.enabled = s < 0.99; this.sharpen.uniforms.uTexel.value.copy(texel); } }
    else if (s < 0.99 && !this.upQuad) this.initUpscale();
  }
  /** The scene at pr × scale into the canvas's corner, then sharpened up over the whole canvas (Medium, Low). */
  renderScaled() {
    const r = this.renderer, s = this.resScale, dbs = r.getDrawingBufferSize(this._dbs), pr = r.getPixelRatio();
    const w = Math.max(1, Math.round(dbs.x * s)), h = Math.max(1, Math.round(dbs.y * s)), U = this.upQuad.material.uniforms;
    if (!this.upTex || this.upTex.image.width !== w || this.upTex.image.height !== h) {
      this.upTex?.dispose();
      // (RGB: the canvas has no alpha, and a copy may only take channels the canvas has)
      this.upTex = new THREE.FramebufferTexture(w, h); this.upTex.format = THREE.RGBFormat; this.upTex.internalFormat = 'RGB8'; this.upTex.minFilter = this.upTex.magFilter = THREE.LinearFilter;
      U.tDiffuse.value = this.upTex; U.uTexel.value.set(1 / w, 1 / h);
    }
    r.setViewport(0, 0, w / pr, h / pr);
    r.render(this.scene, this.camera);
    r.copyFramebufferToTexture(this.upTex, this._p0);
    r.setViewport(0, 0, dbs.x / pr, dbs.y / pr);
    r.render(this.upQuad, this.upCam);
  }
  /**
   * Compile the scene's shaders for how this quality draws them (main.js, under the loading screen): High draws through
   * the bloom's render target — linear, not tone-mapped — so its materials compile with that target bound (compiled for
   * the canvas, every one of them was built again in the first frame: 4.6 s on the phone, 2026-10-04); the passes after
   * the scene (bloom, output, sharpen) and Medium's upscale compile here too, so none waits for the first time
   * automatic resolution drops.
   */
  compileForDrawing(camera = this.camera) {
    const r = this.renderer;
    r.setRenderTarget(this.composer ? this.composer.renderTarget1 : null);
    const done = r.compileAsync(this.scene, camera);
    r.setRenderTarget(null);
    return done;
  }
  /** Draw the passes after the scene once (High: with the sharpen on), or compile Medium's upscale, under the loading screen. */
  warmPasses() {
    if (this.composer && this.sharpen) { this.sharpen.enabled = true; this.composer.render(); this.sharpen.enabled = (this.resScale ?? 1) < 0.99; }
    else if (!this.composer && rf('sharpen')) { if (!this.upQuad) this.initUpscale(); this.renderer.compile(this.upQuad, this.upCam); }
  }
  /** Render resolution as a fraction of the quality's pixel ratio (automatic resolution). */
  setResScale(s) {
    if (Math.abs(s - (this.resScale ?? 1)) < 1e-3) return;
    this.resScale = s;
    if (rf('sharpen')) { this.sizeUpscale(); return; }   // (the canvas stays at full resolution; the picture is drawn smaller and sharpened up)
    const pr = this.q.pr * s, w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setPixelRatio(pr); this.composer.setSize(w, h); }
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.composer) { this.composer.setSize(w, h); this.bloom.setSize(w / 2, h / 2); }
    if (rf('sharpen') && (this.resScale ?? 1) < 0.99) this.sizeUpscale();
  }
  /** Update lighting for world hour h; camTarget/camDist position the shadow frustum. */
  update(hour, camTarget, camDist, t) {
    GU.uTime.value = t;
    const a = (hour - 6) / 12 * Math.PI;
    const sun = this._v.set(Math.cos(a), Math.sin(a) * 0.9, 0.35 + 0.22 * Math.sin(a)).normalize();
    const sy = sun.y;
    const moon = this._u.set(-Math.cos(a) * 0.8, -Math.sin(a) * 0.85, 0.32).normalize();
    const day = smoothstep(-0.12, 0.3, sy), night = 1 - smoothstep(-0.07, 0.16, sy);
    const dusk = sy > -0.25 ? Math.exp(-Math.pow((sy - 0.05) / 0.14, 2)) : 0;
    this.state.hour = hour; this.state.day = day; this.state.night = night; this.state.sunY = sy;
    GU.uNight.value = night; GU.uDay.value = day; GU.uHour.value = hour;
    const U = this.skyU;
    U.uZenith.value.copy(PAL.zNight).lerp(PAL.zDay, day).lerp(PAL.zDusk, dusk * 0.45);
    U.uHorizon.value.copy(PAL.hNight).lerp(PAL.hDay, day).lerp(PAL.hDusk, dusk * 0.8);
    U.uGround.value.copy(PAL.gNight).lerp(PAL.gDay, day);
    U.uSunDir.value.copy(sun); U.uMoonDir.value.copy(moon);
    U.uSunCol.value.copy(PAL.sunLow).lerp(PAL.sunHigh, smoothstep(0.05, 0.45, sy));
    const W = this.weather, cover = W.cloud, gloom = smoothstep(0.45, 1, cover);
    U.uSunVis.value = smoothstep(-0.08, 0.02, sy) * (1 - 0.9 * gloom);
    U.uNight.value = night; U.uCover.value = cover; U.uStorm.value = W.storm; U.uFlash.value = W.flash;
    // main directional light: sun by day, moon by night (switch happens when both are ~0)
    const L = this.sun;
    let dir;
    if (sy > -0.03) { dir = sun; L.intensity = 2.7 * smoothstep(-0.03, 0.3, sy) * Math.max(0.04, 1 - 0.78 * gloom - 0.2 * W.storm); L.color.copy(U.uSunCol.value); }
    else { dir = moon; L.intensity = 0.32 * smoothstep(0.03, 0.25, -sy); L.color.copy(PAL.moon); }
    this.hemi.intensity = (0.3 + 0.6 * day) * (1 - 0.2 * gloom - 0.3 * W.storm) + W.flash * 1.6;
    this.hemi.color.copy(U.uZenith.value).lerp(new THREE.Color(1, 1, 1), 0.45);
    this.hemi.groundColor.set(day > 0.5 ? 0x5a5448 : 0x1c1e26);
    this.scene.environmentIntensity = 0.3 + 0.7 * day;
    this.renderer.toneMappingExposure = (1.0 + night * 0.45) * (1 - 0.18 * W.storm);
    this.scene.fog.color.copy(U.uHorizon.value).lerp(this._fogGrey.setRGB(0.55, 0.58, 0.62).multiplyScalar((1 - 0.85 * night) * (1 - 0.45 * W.storm)), Math.max(gloom * 0.7, W.fog * 0.8));
    if (this.bigWorld) {
      // The island (WP4.2): see the mountains and the coast; the view distance grows with the camera's height.
      // (the haze above carries the middle distance; this only closes the far horizon — 2026-10-04: not fog)
      this.scene.fog.near = Math.max(2600, camDist * 3.5);
      this.scene.fog.far = this.scene.fog.near + 6500 + camDist * 5;
    } else {
      this.scene.fog.near = Math.max(120, camDist * 1.6);
      this.scene.fog.far = this.scene.fog.near + 1500 + camDist * 2.5;
    }
    // Fog and rain close the view in (fog banks most of all).
    const thick = Math.max(W.fog, W.rain * 0.55);
    if (thick > 0.01) { const f = this.scene.fog, k = Math.pow(thick, 0.7); f.near += (15 - f.near) * thick; f.far += (f.near + 380 + camDist * 0.9 - f.far) * k; }
    // Under water (2026-10-06: diving, the whole island showed as if through air): the view closes in to the water's
    // own colour, darker the deeper and at night; the sky goes, so the only light from above is what the surface lets
    // through (the water materials' undersides, render/water.js withUnderside)
    const uw = this.under;
    GU.uUnder.value = uw ? 1 : 0;
    this.sky.visible = !uw;
    { const f = this.scene.fog; this._air.col.copy(f.color); this._air.near = f.near; this._air.far = f.far; }   // (the air's, for the world above)
    if (uw) {
      // (clear water, 2026-10-06: "a bit too foggy" — some 60 m in the sea by day, 35 in a lake, closer at night)
      const light = (0.16 + 0.84 * day) * (1 - 0.35 * W.storm), deep = Math.exp(-uw.depth / 22), base = this._uwCol[uw.kind] || this._uwCol.sea, f = this.scene.fog;
      f.color.copy(base).multiplyScalar(light * (0.55 + 0.45 * deep));
      f.near = uw.kind === 'sea' ? 3 : 2; f.far = (uw.kind === 'sea' ? 62 : 35) * (0.55 + 0.45 * day) * (1 - 0.4 * W.storm);
      GU.uUnderCol.value.copy(f.color);
      // what the surface does to the world above seen through it: a little blue-green, dimmer the deeper
      GU.uUnderSky.value.setRGB(0.72, 0.93, 0.98).lerp(base, uw.kind === 'sea' ? 0 : 0.25).multiplyScalar(0.6 + 0.4 * deep);
      this.scene.background = f.color;
    } else if (this.scene.background) this.scene.background = null;
    if (this.bloom) { this.bloom.strength = 0.10 + 0.30 * night; this.bloom.threshold = night > 0.5 ? 0.78 : 0.9; }
    // shadow frustum follows the camera target, snapped to shadow texels
    if (this.q.shadows) {
      const S = clamp(camDist * 1.25, 45, 460), sc = L.shadow.camera;
      if (sc.right !== S) { sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.updateProjectionMatrix(); }
      const texel = 2 * S / this.q.shadowSize;
      L.shadow.normalBias = texel * 1.2;
      const up = Math.abs(dir.y) > 0.98 ? this._r.set(1, 0, 0) : this._r.set(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(up, dir).normalize(), lup = new THREE.Vector3().crossVectors(dir, right);
      const tx = camTarget.dot(right), ty = camTarget.dot(lup);
      const snapped = camTarget.clone().addScaledVector(right, Math.round(tx / texel) * texel - tx).addScaledVector(lup, Math.round(ty / texel) * texel - ty);
      L.target.position.copy(snapped);
      L.position.copy(snapped).addScaledVector(dir, 900);
      L.target.updateMatrixWorld();
    } else {
      L.target.position.copy(camTarget); L.position.copy(camTarget).addScaledVector(dir, 500); L.target.updateMatrixWorld();
    }
    // environment map from the sky (refresh when the hour moves on)
    if (Math.abs(hour - this.envHour) > 0.2 || Math.abs(cover - (this.envCover ?? -1)) > 0.08 || !this.envRT) {
      this.envHour = hour; this.envCover = cover;
      const old = this.envRT;
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
      this.scene.environment = this.envRT.texture;
      if (old) old.dispose();
    }
  }
  /** Under water: whether the surface's window overhead (the sky within ~55° of straight up) can be on the screen. */
  windowInView() {
    const c = this.camera, d = c.getWorldDirection(this._v2), el = Math.asin(Math.max(-1, Math.min(1, d.y)));
    return el + THREE.MathUtils.degToRad(c.fov) * 0.62 > 0.5;   // (0.62 of the field: its top corners reach a little higher)
  }
  /**
   * Under water, looking up (2026-10-06: "I should see the outside, through the water ... distorted through its
   * waves"): the world above the surface drawn once more from the same eye, as through air — the sky, the air's haze, the
   * water's surface left out — through a wider lens than the eye's, since the surface bends the whole sky down to the
   * horizon into its window overhead; into an image the surface's underside looks up through (render/water.js
   * withUnderside). The shadows are the main pass's from the frame before.
   */
  renderAbove() {
    const r = this.renderer, c = this.camera, dbs = r.getDrawingBufferSize(this._dbsA ??= new THREE.Vector2()), w = Math.max(2, Math.round(dbs.x * 0.7)), h = Math.max(2, Math.round(dbs.y * 0.7));
    if (!this.aboveRT) { this.aboveRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType }); GU.uAbove.value = this.aboveRT.texture; }
    else if (this.aboveRT.width !== w || this.aboveRT.height !== h) this.aboveRT.setSize(w, h);
    const A = this.aboveCam ??= new THREE.PerspectiveCamera(110, 1, 0.5, 8000);
    c.updateMatrixWorld();
    A.position.copy(c.position); A.quaternion.copy(c.quaternion); A.aspect = c.aspect; A.fov = Math.min(140, c.fov + 70); A.far = c.far; A.near = 0.5;
    A.updateProjectionMatrix(); A.updateMatrixWorld();
    const f = this.scene.fog, keepCol = this._fogKeep.copy(f.color), near = f.near, far = f.far, bg = this.scene.background, auto = r.shadowMap.autoUpdate;
    const hidden = this.underOnly.filter(o => o.visible);
    f.color.copy(this._air.col); f.near = this._air.near; f.far = this._air.far;
    this.scene.background = null; this.sky.visible = true; GU.uUnder.value = 0; r.shadowMap.autoUpdate = false;
    for (const o of hidden) o.visible = false;
    GU.uUwVP.value.multiplyMatrices(A.projectionMatrix, A.matrixWorldInverse);
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.aboveRT); r.clear(); r.render(this.scene, A); r.setRenderTarget(prev);
    for (const o of hidden) o.visible = true;
    f.color.copy(keepCol); f.near = near; f.far = far;
    this.scene.background = bg; this.sky.visible = false; GU.uUnder.value = 1; r.shadowMap.autoUpdate = auto;
  }
  render() {
    this.renderer.info.reset();
    this.sky.position.copy(this.camera.position);
    GU.uAboveOn.value = this.under && this.windowInView() ? (this.renderAbove(), 1) : 0;
    if (this.composer) this.composer.render();
    else if (this.upQuad && (this.resScale ?? 1) < 0.99) this.renderScaled();
    else this.renderer.render(this.scene, this.camera);
    this.outline.render();
  }
}
