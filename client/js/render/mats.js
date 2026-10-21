// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Shared materials + GLSL snippets: furniture/object material (per-vertex colour + flags, instanced tint, emissive
// screens/lamps/neon), floor-zone material (procedural finishes), city ground material (roads + blocks), depth
// materials for cutaway, and the occluder fade (screen-door dither between the camera and the focused building).
import * as THREE from 'three';
import { GU } from './scene.js';

export const GLSL = /* glsl */`
float h11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h31(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return vnoise(p) * .5 + vnoise(p * 2.03 + 1.7) * .3 + vnoise(p * 4.11 + 3.1) * .2; }
float pInt(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x) - a, 0., b - a); }
float pulseAA(float x, float a, float b, float w) { w = max(w, 1e-4); return (pInt(x + .5 * w, a, b) - pInt(x - .5 * w, a, b)) / w; }
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[q.x + q.y * 4]) + 0.5) / 16.0;
}
uniform vec4 uFade; uniform vec3 uCamP; uniform float uFocusB, uInB;
bool fadeOut(vec3 wp, float b) {
  if (abs(b - uInB) < 0.5) return true;   // the camera is inside it: its walls (drawn from outside only) are gone, so is the rest
  if (uFade.w <= 0.0 || abs(b - uFocusB) < 0.5) return false;
  vec3 ab = uFade.xyz - uCamP; float L2 = dot(ab, ab);
  if (L2 < 4.0) return false;
  float t = dot(wp - uCamP, ab) / L2;
  if (t < 0.0 || t > 0.97) return false;
  float d = length(wp - (uCamP + ab * t));
  float R = uFade.w * mix(0.3, 1.0, t);
  if (d > R) return false;
  return bayer4(gl_FragCoord.xy) < smoothstep(R, R * 0.5, d) * 0.92;
}
`;
export const WP_VERT = `{ vec4 w4 = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
w4 = instanceMatrix * w4;
#endif
#ifdef USE_BATCHING
w4 = batchingMatrix * w4;
#endif
vWP = (modelMatrix * w4).xyz; }`;

export function commonUniforms(sh) {
  Object.assign(sh.uniforms, {
    uNight: GU.uNight, uTime: GU.uTime, uFocusB: GU.uFocusB, uCutY: GU.uCutY, uFade: GU.uFade, uCamP: GU.uCamP, uInB: GU.uInB,
    uLightMap: GU.uLightMap, uLightRect: GU.uLightRect, uLightMap2: GU.uLightMap2, uLightRect2: GU.uLightRect2, uIndoor: GU.uIndoor, uHour: GU.uHour,
  });
}
export const FRAG_PARS = `uniform float uNight, uTime, uCutY, uIndoor, uHour; uniform sampler2D uLightMap, uLightMap2; uniform vec4 uLightRect, uLightRect2; varying vec3 vWP;
${GLSL}
float lampMap(sampler2D m, vec4 r, vec2 p) { vec2 q = (p - r.xy) / r.zw; if (q.x < 0. || q.y < 0. || q.x > 1. || q.y > 1.) return 0.; return texture2D(m, q).r; }
// the street lamps' light on whatever is under them: the city's (render/city.js) and the island roads' (render/island-roads.js)
float lampLight(vec3 wp) { return lampMap(uLightMap, uLightRect, wp.xz) + lampMap(uLightMap2, uLightRect2, wp.xz); }
`;

/**
 * Object material. Geometry attribute aC = (linear rgb, flags): flags = tint(1) + emit*2
 * (emit 1 screen, 2 lamp (night), 3 neon, 4 animated disco). Tint multiplies by the instance colour.
 * withB: geometry has attribute aB (building index) -> hidden when that building is focused (roof details).
 */
export function makeFurnMat({ glass = false, withB = false, fade = false, lit = false, indoor = false, doorTex = null } = {}) {
  const m = glass
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.35, depthWrite: false })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    commonUniforms(sh);
    if (doorTex) sh.uniforms.uDoorTex = { value: doorTex };   // building details: door handles slide with their entrance's doors
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aC; varying vec4 vFC; varying vec3 vWP;${withB ? ' attribute float aB; varying float vBi;' : ''}${doorTex ? ' attribute vec2 aH; uniform sampler2D uDoorTex;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${doorTex ? '\nif (aH.x != 0.0 || aH.y != 0.0) transformed.xz += aH * texelFetch(uDoorTex, ivec2(int(mod(aB, 256.0)), int(aB / 256.0)), 0).r;' : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vFC = aC; ${WP_VERT}${withB ? ' vBi = aB;' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vFC;${withB ? ' varying float vBi;' : ''}
${FRAG_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
${withB ? 'if (abs(vBi - uFocusB) < 0.5 && vWP.y > uCutY + 0.02) discard;' : ''}
${fade ? `if (fadeOut(vWP, ${withB ? 'vBi' : '-3.0'})) discard;` : ''}`)
      .replace('#include <color_fragment>', `
float fFlags = vFC.w; float fTint = mod(fFlags + 0.01, 2.0); float fEmit = floor(fFlags * 0.5 + 0.01);
vec3 fBase = vFC.rgb;
#ifdef USE_COLOR
if (fTint > 0.5) fBase *= vColor.rgb;
#endif
diffuseColor.rgb *= fBase;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (fEmit > 0.5) {
  if (fEmit < 1.5) totalEmissiveRadiance += fBase * (0.5 + 0.55 * uNight);
  else if (fEmit < 2.5) totalEmissiveRadiance += fBase * (0.06 + 2.4 * uNight);
  else if (fEmit < 3.5) totalEmissiveRadiance += fBase * (0.55 + 1.7 * uNight);
  else { float fl = 0.5 + 0.5 * sin(uTime * 4.0 + dot(floor(vWP.xz * 1.14), vec2(1.7, 2.3))); totalEmissiveRadiance += fBase * fl * (0.8 + 1.3 * uNight); }
}
${lit ? 'totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.8, 0.55) * lampLight(vWP) * uNight * 1.6;' : ''}
${indoor ? 'totalEmissiveRadiance += diffuseColor.rgb * uIndoor;' : ''}`);
    if (!glass) sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (fEmit > 0.5) roughnessFactor = 0.35;`);
  };
  m.customProgramCacheKey = () => `mvw-furn-${glass}-${withB}-${fade}-${lit}-${indoor}`;
  return m;
}

/** Depth material for merged building geometry (attribute aB). cut: hide above uCutY for the focused building; all: hide it completely. */
export function makeBDepthMat(mode = 'cut') {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    commonUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aB; varying float vBi; varying vec3 vWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>\nvBi = aB; ${WP_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFocusB, uCutY; varying float vBi; varying vec3 vWP;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (abs(vBi - uFocusB) < 0.5 ${mode === 'cut' ? '&& vWP.y > uCutY + 0.02' : ''}) discard;`);
  };
  m.customProgramCacheKey = () => 'mvw-bdepth-' + mode;
  return m;
}

/** Floor finishes. Attributes: aPat (pattern id), aFC (linear rgb), aL (local metres). */
export function makeFloorMat({ lit = true, indoor = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1;
  m.onBeforeCompile = (sh) => {
    commonUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPat; attribute vec3 aFC; attribute vec2 aL; varying float vPat; varying vec3 vFCol; varying vec2 vL; varying vec3 vWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>\nvPat = aPat; vFCol = aFC; vL = aL; ${WP_VERT}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vPat; varying vec3 vFCol; varying vec2 vL;\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `
vec2 p = vL; vec3 c = vFCol; float fr = 0.8; float pat = vPat;
float aw = max(fwidth(p.x), fwidth(p.y));
if (pat < 1.5) { c *= 0.9 + 0.18 * fbm(p * 6.0) * (1.0 - smoothstep(0.02, 0.08, aw)) + 0.06 * vnoise(p * 1.3); fr = 0.97; }
else if (pat < 2.5) {
  float row = floor(p.y / 0.19); float off = h11(row + 3.0) * 1.3; float col = floor((p.x + off) / 1.3);
  c *= 0.8 + 0.32 * h21(vec2(row, col));
  float gw = 1.0 - smoothstep(0.0, 0.07 + aw * 4.0, min(fract(p.y / 0.19), 1.0 - fract(p.y / 0.19)));
  float gl = 1.0 - smoothstep(0.0, 0.01 + aw, min(fract((p.x + off) / 1.3), 1.0 - fract((p.x + off) / 1.3)) * 1.3);
  c *= 1.0 - 0.3 * max(gw, gl) * (1.0 - smoothstep(0.02, 0.06, aw));
  c *= 0.94 + 0.06 * sin(p.x * 31.0 + vnoise(p * vec2(2.0, 22.0)) * 5.0);
  fr = 0.5;
} else if (pat < 3.5) {
  vec2 g = fract(p / 0.6); float e = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
  float grout = (1.0 - smoothstep(0.0, 0.035 + aw * 1.5, e)) * (1.0 - smoothstep(0.03, 0.09, aw));
  c *= mix(0.93 + 0.1 * h21(floor(p / 0.6)), 0.72, grout); fr = mix(0.32, 0.9, grout);
} else if (pat < 4.5) {
  float v = fbm(p * 0.9 + fbm(p * 0.45) * 2.5);
  c *= 0.93 + 0.1 * v - 0.12 * smoothstep(0.035, 0.0, abs(v - 0.52));
  float sp = step(0.955, h21(floor(p * 38.0))) * (1.0 - smoothstep(0.01, 0.03, aw));
  c = mix(c, c * vec3(0.55, 0.5, 0.48), sp * 0.6); fr = 0.18;
} else if (pat < 5.5) {
  c *= 0.9 + 0.12 * fbm(p * 1.2) + 0.04 * vnoise(p * 9.0);
  vec2 g = fract(p / 3.0); float e = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
  c *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.006 + aw * 0.4, e)); fr = 0.62;
} else {
  float n = fbm(p * 0.3), n2 = vnoise(p * 2.7), n3 = vnoise(p * 11.0);
  c = mix(c * 0.78, c * 1.2, n) * (0.9 + 0.12 * n2 + 0.06 * n3 * (1.0 - smoothstep(0.02, 0.1, aw)));
  c = mix(c, c * vec3(1.12, 1.06, 0.72), smoothstep(0.68, 0.8, fbm(p * 0.11 + 4.0)) * 0.5);
  fr = 1.0;
}
diffuseColor.rgb *= c;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fr;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${lit ? 'totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.8, 0.55) * lampLight(vWP) * uNight * 2.0;' : ''}\n${indoor ? 'totalEmissiveRadiance += diffuseColor.rgb * uIndoor;' : ''}`);
  };
  m.customProgramCacheKey = () => 'mvw-floor-' + lit + '-' + indoor;
  return m;
}

/** City ground: kind 'road' (asphalt + lane markings + zebra/scramble crossings) or 'block' (sidewalks, curbs, lots). */
export function makeGroundMat(kind, g) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  const U = { uG0: { value: new THREE.Vector4(g.X[0] ?? 0, g.Z[0] ?? 0, g.px || 1, g.pz || 1) }, uGN: { value: new THREE.Vector2(g.nx, g.nz) }, uHR: { value: g.hr } };
  m.onBeforeCompile = (sh) => {
    commonUniforms(sh); Object.assign(sh.uniforms, U);
    const blockAttr = kind === 'block';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP;${blockAttr ? ' attribute vec4 aBR; attribute float aLot; varying vec4 vBR; varying float vLot;' : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WP_VERT}${blockAttr ? ' vBR = aBR; vLot = aLot;' : ''}`);
    const road = `
vec2 p = vWP.xz; float fr = 0.92;
float gi = clamp(floor((p.x - uG0.x) / uG0.z + 0.5), 0.0, uGN.x), gj = clamp(floor((p.y - uG0.y) / uG0.w + 0.5), 0.0, uGN.y);
float dx = p.x - (uG0.x + gi * uG0.z), dz = p.y - (uG0.y + gj * uG0.w);
float adx = abs(dx), adz = abs(dz), hr = uHR;
float n = fbm(p * 0.33), n2 = vnoise(p * 3.3);
float aw = max(fwidth(p.x), fwidth(p.y));
vec3 c = vec3(0.105, 0.105, 0.108) * (0.8 + 0.32 * n + 0.1 * n2 * (1.0 - smoothstep(0.05, 0.3, aw)));
c *= 1.0 - 0.13 * smoothstep(0.6, 0.64, fbm(p * 0.06 + 7.0));
float paint = 0.0; vec3 pcol = vec3(0.9);
float lw = aw * 0.75;
#define LINE(d, w) (1.0 - smoothstep((w) - lw, (w) + lw, (d)))
bool ns = adx < hr, ew = adz < hr;
if (ns && ew) {
  float s1 = (dx + dz) * 0.7071, s2 = (dx - dz) * 0.7071;
  if (abs(s2) < 1.35) paint = max(paint, pulseAA(s1 / 0.9, 0.0, 0.5, fwidth(s1 / 0.9)) * step(abs(s1), hr * 1.32));
  if (abs(s1) < 1.35) paint = max(paint, pulseAA(s2 / 0.9, 0.0, 0.5, fwidth(s2 / 0.9)) * step(abs(s2), hr * 1.32));
  paint *= 0.85;
} else if (ns || ew) {
  float a = ns ? adx : adz, dl = ns ? dx : dz, e = (ns ? adz : adx) - hr, along = ns ? p.y : p.x, side = dx * dz * (ns ? 1.0 : -1.0);
  if (e > 0.6 && e < 3.6 && a < hr - 0.45) paint = pulseAA((dl + 60.0) / 0.9, 0.0, 0.52, fwidth(dl / 0.9));
  else if (e > 3.9 && e < 4.3 && side > 0.0 && a > 0.35 && a < hr - 0.45) paint = 1.0;
  else if (e > 4.3) {
    float y = LINE(abs(a - 0.17), 0.065);
    if (y > 0.0) { paint = y; pcol = vec3(0.93, 0.72, 0.18); }
    paint = max(paint, LINE(abs(a - 3.5), 0.065) * pulseAA(along / 6.0, 0.0, 0.5, fwidth(along / 6.0)));
    paint = max(paint, LINE(abs(a - (hr - 0.45)), 0.07));
  }
}
paint *= 0.72 + 0.28 * smoothstep(0.25, 0.6, n2 + n * 0.5);
c = mix(c, pcol * (0.8 + 0.2 * n), clamp(paint, 0.0, 1.0));
fr = mix(fr, 0.6, clamp(paint, 0.0, 1.0));
diffuseColor.rgb *= c;`;
    const block = `
vec2 p = vWP.xz; float fr = 0.85; vec3 c;
float aw = max(fwidth(p.x), fwidth(p.y));
if (vLot < -0.5) { c = vec3(0.4, 0.395, 0.38) * (0.9 + 0.1 * vnoise(p * 4.0)); fr = 0.8; }
else {
  float de;
  if (vLot > 1.5) { vec2 dd = max(max(vBR.xy - p, p - vBR.zw), 0.0); de = length(dd); }
  else de = min(min(p.x - vBR.x, vBR.z - p.x), min(p.y - vBR.y, vBR.w - p.y));
  if (de < 0.32) { c = vec3(0.46, 0.455, 0.44) * (0.92 + 0.08 * vnoise(p * 3.0)); }
  else if (de < 4.5) {
    vec2 q = (p - vBR.xy) / 1.5; vec2 gg = fract(q); float e = min(min(gg.x, 1.0 - gg.x), min(gg.y, 1.0 - gg.y));
    float joint = (1.0 - smoothstep(0.0, 0.022 + aw * 0.8, e)) * (1.0 - smoothstep(0.04, 0.12, aw));
    c = vec3(0.36, 0.352, 0.335) * (0.9 + 0.08 * h21(floor(q)) + 0.07 * vnoise(p * 1.7)) * (1.0 - 0.17 * joint);
  } else if (vLot < 0.5) {
    vec2 q = p / vec2(0.8, 0.4); q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
    vec2 gg = fract(q); float e = min(min(gg.x, 1.0 - gg.x) * 2.0, min(gg.y, 1.0 - gg.y));
    float joint = (1.0 - smoothstep(0.0, 0.05 + aw * 1.5, e)) * (1.0 - smoothstep(0.03, 0.1, aw));
    c = vec3(0.4, 0.33, 0.27) * (0.88 + 0.14 * h21(floor(q)) + 0.05 * vnoise(p * 0.8)) * (1.0 - 0.2 * joint); fr = 0.8;
  } else {
    float n = fbm(p * 0.3), n2 = vnoise(p * 2.9);
    c = mix(vec3(0.24, 0.36, 0.14), vec3(0.4, 0.52, 0.22), n) * (0.9 + 0.14 * n2); fr = 1.0;
  }
}
diffuseColor.rgb *= c;`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec4 uG0; uniform vec2 uGN; uniform float uHR;${blockAttr ? ' varying vec4 vBR; varying float vLot;' : ''}\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', kind === 'road' ? road : block)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fr;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.8, 0.55) * lampLight(vWP) * uNight * 2.2;');
  };
  m.customProgramCacheKey = () => 'mvw-ground-' + kind;
  return m;
}

/** Set every instance colour (so the instancing-colour shader path exists) and return the mesh. */
export function instanced(geo, mat, n, { cast = true, receive = true } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  im.count = n;
  im.castShadow = cast; im.receiveShadow = receive;
  const white = new THREE.Color(1, 1, 1);
  for (let k = 0; k < Math.max(1, n); k++) im.setColorAt(k, white);
  return im;
}
