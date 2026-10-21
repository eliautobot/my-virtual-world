// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Water (WP4.18, wp4-world-spec.md §6.1): the ocean as a camera-centred radial mesh (fine near the camera, coarse to
// the horizon) with Gerstner waves along the wind — a low swell on calm days, whitecaps and ~1.5 m waves in storms —
// faded flat with distance; and surf on the shore: a foam line washing up and down the beach at the waterline, with
// darker wet sand below it, drawn in the terrain's own material. Waves are computed in world space, so the mesh can
// follow the camera without the sea moving.
import * as THREE from 'three';
import { GU } from './scene.js';
import { OCEAN_GLSL, seaState } from './ocean-fft.js';
import { MARKS_U, MARKS_GLSL, hullsUpdate } from './water-marks.js';

/**
 * Sheltered water (2026-10-15 — a marina's basin is a harbour: the surf rolling through it pinned the boats to the quay
 * and ran out of step with them): up to four areas, each a rectangle in its own frame (a dock's: render/docks.js),
 * where the surf dies away and the open sea's swell comes in cut down to CALM_SWELL of itself — over all the basin,
 * dredged deep for the boats (the sea's depth maps draw it as the beach it was, the swell there all but gone: boats
 * moored dead still in a storm) — fading out over CALM_FADE m beyond (round its corners: no square outline on the
 * water). Shared by the sea's shaders (SWASH_GLSL swCalm) and the boats (calmAt: render/sea-probe.js).
 */
export const CALM_N = 4, CALM_FADE = 18, CALM_SWELL = 0.35;
export const CALM = { uCalmA: { value: Array.from({ length: CALM_N }, () => new THREE.Vector4()) }, uCalmB: { value: Array.from({ length: CALM_N }, () => new THREE.Vector4()) }, uCalmN: { value: 0 } };
/** The areas: [{ x, z, rot (its frame: x = x + s·cos rot + f·sin rot, z = z − s·sin rot + f·cos rot), s0, s1, f0, f1 }]. */
export function setCalm(list) {
  const n = Math.min(CALM_N, list.length);
  for (let i = 0; i < n; i++) { const a = list[i]; CALM.uCalmA.value[i].set(a.x, a.z, Math.cos(a.rot), Math.sin(a.rot)); CALM.uCalmB.value[i].set((a.s0 + a.s1) / 2, (a.f0 + a.f1) / 2, (a.s1 - a.s0) / 2, (a.f1 - a.f0) / 2); }
  CALM.uCalmN.value = n;
}
/** How sheltered (x, z) is: 0 the open sea … 1 inside a harbour (as swCalm). */
export function calmAt(x, z) {
  let c = 0;
  for (let i = 0; i < CALM.uCalmN.value; i++) {
    const A = CALM.uCalmA.value[i], B = CALM.uCalmB.value[i], dx = x - A.x, dz = z - A.y, s = dx * A.z - dz * A.w, f = dx * A.w + dz * A.z;
    const qs = Math.abs(s - B.x) - B.z, qf = Math.abs(f - B.y) - B.w, q = Math.hypot(Math.max(qs, 0), Math.max(qf, 0)) + Math.min(Math.max(qs, qf), 0);
    const u = Math.min(1, Math.max(0, q / CALM_FADE));
    c = Math.max(c, 1 - u * u * (3 - 2 * u));
  }
  return c;
}

/** Wave height (m) for the weather: { wind (m/s), storm (0..1) }. */
export const waveHeight = w => 0.18 + 0.045 * (w.wind?.speed ?? 3) + 0.75 * (w.storm || 0);

/**
 * The surf's timing, shared by the sea and the beach so they move together (2026-10-03: "the waves should move in
 * and out, matching the foam ... the water itself doesn't move"): each wave rolls in over the shallows, breaks, and its
 * water runs up the beach and drains back; the sea's surface itself climbs the beach with it (render: the sea mesh is
 * raised near the shore) and the beach draws the foam on the water's moving edge. From the depth map around the camera
 * (signed: below the sea positive, above it negative). Needs uTime, uDepth(N, F), uDepthRect(N, F), uSurf.
 */
export const SWASH_GLSL = /* glsl */`
uniform vec4 uCalmA[${CALM_N}], uCalmB[${CALM_N}];
uniform int uCalmN;
// how sheltered p is (a harbour: setCalm): 0 the open sea … 1 inside
float swCalm(vec2 p) {
  float c = 0.0;
  for (int i = 0; i < ${CALM_N}; i++) {
    if (i >= uCalmN) break;
    vec4 A = uCalmA[i], B = uCalmB[i];
    vec2 d = p - A.xy; float s = d.x * A.z - d.y * A.w, f = d.x * A.w + d.y * A.z;
    vec2 q = vec2(abs(s - B.x) - B.z, abs(f - B.y) - B.w);
    c = max(c, 1.0 - smoothstep(0.0, ${CALM_FADE.toFixed(1)}, length(max(q, 0.0)) + min(max(q.x, q.y), 0.0)));
  }
  return c;
}
// water depth (x) and reef (y: how much of a reef section is under it, 0..1) from the fine map close round the camera
// (2 m), else the wide one (8 m)
vec2 swMap(vec2 p) {
  vec2 un = (p - uDepthRectN.xy) / uDepthRectN.z;
  if (uDepthRectN.w > 0.5 && un.x > 0.02 && un.y > 0.02 && un.x < 0.98 && un.y < 0.98) return texture2D(uDepthN, (un * (uDepthRectN.w - 1.0) + 0.5) / uDepthRectN.w).rg;
  vec2 uv = (p - uDepthRect.xy) / uDepthRect.z;
  if (uDepthRect.w < 0.5 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    // (beyond: the whole island's coarse map, else open sea)
    vec2 uf = (p - uDepthRectF.xy) / uDepthRectF.z;
    if (uDepthRectF.w < 0.5 || uf.x < 0.0 || uf.y < 0.0 || uf.x > 1.0 || uf.y > 1.0) return vec2(50.0, 0.0);
    return texture2D(uDepthF, (uf * (uDepthRectF.w - 1.0) + 0.5) / uDepthRectF.w).rg;
  }
  return texture2D(uDepth, (uv * (uDepthRect.w - 1.0) + 0.5) / uDepthRect.w).rg;
}
float swDepth(vec2 p) { return swMap(p).x; }
// the depth's gradient here (m of depth per m, pointing out to sea), from samples e apart
vec2 swGrad(vec2 p, float e) {
  return vec2(swDepth(p + vec2(e, 0.0)) - swDepth(p - vec2(e, 0.0)), swDepth(p + vec2(0.0, e)) - swDepth(p - vec2(0.0, e))) / (2.0 * e);
}
// the beach's slope here (rise over run), from the wide map's spacing
float swSlope(vec2 p) { return clamp(length(swGrad(p, uDepthRect.z / max(uDepthRect.w - 1.0, 1.0))), 0.006, 0.4); }
// ---- The surf (2026-10-03: "a big improvement on the waves on the shore"). The swell feels the bottom as it comes
// in: it slows and its crests crowd together (their spacing goes with the square root of the depth, as real waves' in
// shallow water do), it grows, steepens and leans forward, breaks where the water is about as shallow as the wave is
// high, and runs on as a tumbling white bore to the beach, where its water runs up the sand and drains back (swReach).
// The crests follow the depth contours with a gentle wander; each wave has its own size (they come in sets).
const float SW_K = 3.4, SW_F = 0.2;    // crests per unit of the depth's square root (m); waves per second (faster in)
float swHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float swNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0;
  return mix(mix(swHash(n), swHash(n + 1.0), f.x), mix(swHash(n + 57.0), swHash(n + 58.0), f.x), f.y);
}
float swWob(vec2 p) { return sin(p.x * 0.013 + p.y * 0.009) * 0.35 + sin(p.x * 0.029 - p.y * 0.021 + 1.7) * 0.12; }
float swPhase(vec2 p, float d) { return SW_K * sqrt(max(d, 0.0)) + uTime * SW_F + swWob(p); }
// a wave's size against the day's (0.5..1.7), by its number and where along the shore it is
float swSet(vec2 p, float n) { return (0.65 + 0.7 * swHash(n)) * (0.75 + 0.5 * swNoise(p * 0.012 + vec2(n * 0.37, n * 0.11))); }
// the breakers' height (m) on the day: about two-thirds of a metre when calm, a metre and a half in a storm (a little
// more than real beaches this gentle would get, so they read from the air)
float swH0() { return 0.36 + 0.55 * uSurf; }
// how deep (m) the surf reaches out: beyond it the open sea's own waves (render/ocean-fft.js)
float swOut() { return max(5.0, swH0() * 6.5); }
// The surf at p, depth d (m): the water's height (m) about the sea level; dhdd: its change with the depth (for the
// light); wh: x the breaking crest and the bore's tumbling face, y the foam left behind it, z how broken (0..1).
// sharp: how peaked the crests get (1 for the light; less for the mesh, whose vertices would show a peak as a zigzag)
float swSurf(vec2 p, float d, float sharp, out float dhdd, out vec3 wh) {
  dhdd = 0.0; wh = vec3(0.0);
  float H0 = swH0(), db = H0 * 1.3, reach = swOut();
  if (d <= 0.0 || d >= reach) return 0.0;
  float calm = 1.0 - swCalm(p);   // (none in a harbour)
  if (calm <= 0.0) return 0.0;
  float sho = 1.0 - smoothstep(db, reach, d);          // 0 far out .. 1 where it breaks
  float br = 1.0 - smoothstep(db * 0.7, db * 1.05, d);   // 0 a swell .. 1 broken: a bore
  float k = mix(0.5, mix(0.58, 0.8, sharp), max(sho * sho, br));   // the trough's place in the cycle: the front steepens
  float ph = swPhase(p, d), c = fract(ph), n = floor(ph + 1.0 - k);   // (a wave's number changes at its trough)
  float amp = H0 * swSet(p, n);
  float H = amp * (0.3 + 0.7 * sho) * (1.0 + 0.3 * sho);   // a low swell out there, growing as it comes in
  H = mix(H, min(H, 0.6 * d + 0.08), br);                       // a bore no higher than about half the depth
  H *= smoothstep(reach, reach * 0.6, d) * smoothstep(0.0, 0.06, d);
  // its profile: 0 at the trough, 1 at the crest; long flat troughs and peaked crests as it shoals
  float u, du;
  if (c < k) { float a = 3.14159 * c / k; u = 0.5 + 0.5 * cos(a); du = -1.5708 / k * sin(a); }
  else { float a = 3.14159 * (c - k) / (1.0 - k); u = 0.5 - 0.5 * cos(a); du = 1.5708 / (1.0 - k) * sin(a); }
  float sp = mix(1.0, 1.0 + 2.0 * sharp, max(sho, br)), up = pow(max(u, 0.0), sp), dup = sp * pow(max(u, 1e-3), sp - 1.0) * du;
  dhdd = H * dup * SW_K * 0.5 / sqrt(max(d, 0.03));
  // white water: the crest as it breaks, spilling down its front; then the bore's tumbling face and top, foam behind
  float crest = c < 0.5 ? 1.0 - smoothstep(0.0, 0.07, c) : smoothstep(0.88, 1.0, c);
  float face = smoothstep(k + 0.15 * (1.0 - k), 0.97, c), big = smoothstep(0.12, 0.35, amp);
  wh.x = max(crest * smoothstep(db * 1.3, db * 0.98, d) * 0.95, br * max(face, 1.0 - smoothstep(0.0, 0.1, c))) * big;
  wh.y = br * ((1.0 - smoothstep(0.0, 0.6, c)) * 0.75 + 0.12) * big;
  wh.z = br;
  wh.xy *= smoothstep(0.0, 0.08, d);
  wh *= calm; dhdd *= calm;
  return H * (up - 0.32) * calm;
}
// where along its cycle the wave arriving here is: 0 as its bore reaches the shore, 1 just before the next
float swRun(vec2 p) { return fract(uTime * SW_F + swWob(p)); }
// How high (m above the sea) the water reaches up the beach (2026-10-03: "come in and out further, more splashy";
// then, marked on a screenshot, about a fifth of the 8 m that gave): fast up, slower back; each wave in tongues of its
// own along the beach, farther for a bigger one — some 2–3 m up the sand. up: 0..1 of the way.
float swReachAt(vec2 p, float slope, float up) {
  float n = floor(uTime * SW_F + swWob(p)), tongue = 0.7 + 0.6 * swNoise(p * 0.07 + vec2(n * 1.7, n * 0.9));
  return min(0.5, slope * (0.3 + 2.6 * up * swSet(p, n) * tongue)) * max(uSurf, 0.6);
}
float swReachS(vec2 p, float slope) { float run = swRun(p); return swReachAt(p, slope, smoothstep(0.0, 0.2, run) * (1.0 - smoothstep(0.2, 0.95, run))); }
float swReachTop(vec2 p, float slope) { return swReachAt(p, slope, 1.0); }
// The swash's white water at a spot x m (across the beach) above the water's edge now — negative under the sheet of
// water running up — with xTop m from the edge to where this wave reaches, its lace (0..1), a pixel's size ex and a
// ragged offset jag: a bubbling line on the edge; the sheet churned white as it rushes up, lacy as it drains back; a
// line of foam left where it reached, thinning as the sand dries.
float swSwashFoam(float x, float xTop, float run, float lace, float ex, float jag) {
  float xb = x + jag, rush = 1.0 - smoothstep(0.1, 0.3, run);
  float edge = (1.0 - smoothstep(0.0, 0.45 + ex, abs(xb + 0.2))) * (0.65 + 0.35 * lace);
  float sheet = (1.0 - smoothstep(-ex, ex, xb)) * (1.0 - smoothstep(0.0, mix(1.0, 2.2, rush), -xb)) * mix(lace * 0.5, mix(0.75, 1.0, lace), rush);
  float mark = (1.0 - smoothstep(0.0, 0.3 + ex, abs(x - xTop + 0.15))) * smoothstep(-ex, ex, xb) * smoothstep(0.2, 0.32, run) * (1.0 - smoothstep(0.45, 1.0, run)) * lace * 0.7;
  return clamp(max(max(edge, sheet), mark), 0.0, 1.0);
}
float swReach(vec2 p) { return swReachS(p, swSlope(p)) * (1.0 - swCalm(p)); }
`;

const WAVES = /* glsl */`
uniform float uWaveH, uTime, uSurf;
uniform vec4 uWind;
uniform sampler2D uDepth, uDepthN, uDepthF;
uniform vec4 uDepthRect, uDepthRectN, uDepthRectF;   // x0, z0, size, samples across (0: not ready) — water depth (m) around the camera, wide and close, and over the whole island
${SWASH_GLSL}
// Water depth (m) here, from the map around the camera (deep where the map doesn't reach).
float depthAt(vec2 p) {
  vec2 uv = (p - uDepthRect.xy) / uDepthRect.z;
  if (uDepthRect.w < 0.5 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 50.0;
  return texture2D(uDepth, (uv * (uDepthRect.w - 1.0) + 0.5) / uDepthRect.w).r;
}
// How much of the swell reaches here: none on the beach, full in a few metres of water.
float shoal(vec2 p) {
  vec2 uv = (p - uDepthRect.xy) / uDepthRect.z;
  if (uDepthRect.w < 0.5 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  float d = texture2D(uDepth, (uv * (uDepthRect.w - 1.0) + 0.5) / uDepthRect.w).r;
  return smoothstep(0.3, 3.5, d);
}
// Four Gerstner waves around the wind's direction; returns the displacement, accumulates the normal's terms.
vec3 gerstner(vec2 p, out vec3 nrm, out float crest) {
  vec2 wd = normalize(uWind.xz + vec2(1e-4, 0.0));
  vec3 disp = vec3(0.0); nrm = vec3(0.0, 1.0, 0.0); crest = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float ang = (fi - 1.5) * 0.38;
    vec2 D = vec2(wd.x * cos(ang) - wd.y * sin(ang), wd.x * sin(ang) + wd.y * cos(ang));
    float L = 64.0 / pow(1.85, fi), k = 6.2831853 / L, w = sqrt(9.81 * k), A = uWaveH * 0.5 * pow(0.62, fi);
    float Q = min(0.6, 1.0 / (k * A * 4.0 + 1e-4));   // steep but never looping over
    float f = k * dot(D, p) - w * uTime + fi * 1.7, c = cos(f), s = sin(f);
    disp.x += Q * A * D.x * c; disp.z += Q * A * D.y * c; disp.y += A * s;
    nrm.x -= D.x * k * A * c; nrm.z -= D.y * k * A * c; nrm.y -= Q * k * A * s;
    crest += s * pow(0.62, fi);
  }
  nrm = normalize(nrm);
  return disp;
}`;

export class Ocean {
  /** @param {number} seaLevel @param {THREE.Texture} normalMap */
  /** waves: an OceanWaves (render/ocean-fft.js) for the full sea; without it, the simpler Gerstner sea (Low). */
  constructor(seaLevel, normalMap, uSurf = { value: 1 }, waves = null) {
    const blank = () => { const t = new THREE.DataTexture(new Uint16Array(2), 1, 1, THREE.RGFormat, THREE.HalfFloatType); t.unpackAlignment = 4; t.needsUpdate = true; return t; };
    this.depthTex = blank(); this.depthTexN = blank(); this.depthTexF = blank();
    this.u = { uWaveH: { value: 0.3 }, uTime: GU.uTime, uWind: GU.uWind, uSurf, uNear: { value: new THREE.Vector2() }, uDepth: { value: this.depthTex }, uDepthRect: { value: new THREE.Vector4(0, 0, 1, 0) }, uDepthN: { value: this.depthTexN }, uDepthRectN: { value: new THREE.Vector4(0, 0, 1, 0) }, uDepthF: { value: this.depthTexF }, uDepthRectF: { value: new THREE.Vector4(0, 0, 1, 0) }, ...MARKS_U, ...CALM };   // (MARKS_U: what boats and splashes do to the water, render/water-marks.js)
    this.waves = waves;
    if (waves) { this._fft(seaLevel); return; }
    const m = this.material = new THREE.MeshStandardMaterial({ color: 0x14607a, roughness: 0.08, metalness: 0.02, transparent: true, opacity: 0.9, normalMap, normalScale: new THREE.Vector2(0.22, 0.22), depthWrite: false, envMapIntensity: 0.4 });   // (the water's own colour over the sky's glare)
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.u);
      sh.vertexShader = WAVES + '\nuniform vec2 uNear;\nvarying float vCrest;\nvarying vec3 vOPos;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', `
          vec3 wpos0 = (modelMatrix * vec4(position, 1.0)).xyz;
          float fade = 1.0 - smoothstep(700.0, 2600.0, distance(wpos0.xz, uNear));
          vec3 wn; float crest;
          fade *= mix(shoal(wpos0.xz), ${CALM_SWELL.toFixed(2)}, swCalm(wpos0.xz));   // (cut down in a harbour)
          vec3 wdisp = gerstner(wpos0.xz, wn, crest) * fade;
          // in the shallows the swell rises into breakers rolling in to the shore (swSurf), and at the shore the
          // water itself runs up the beach and back with each one (swReach) — the beach draws the foam on its edge
          float bd = depthAt(wpos0.xz), nearK = 1.0 - smoothstep(700.0, 1500.0, distance(wpos0.xz, uNear));
          if (bd > 0.0 && bd < swOut()) { float sdh; vec3 swh; wdisp.y += swSurf(wpos0.xz, bd, 0.0, sdh, swh) * nearK; }
          if (bd > -1.5 && bd < 2.0) wdisp.y += swReach(wpos0.xz) * smoothstep(-1.5, -1.0, bd) * (1.0 - smoothstep(0.4, 2.0, bd)) * nearK;
          vec3 objectNormal = normalize(mix(vec3(0.0, 1.0, 0.0), wn, fade));
          vCrest = crest * fade;
          #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position) + wdisp;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vOPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform float uWaveH, uTime, uSurf;\nuniform sampler2D uDepth, uDepthN, uDepthF;\nuniform vec4 uDepthRect, uDepthRectN, uDepthRectF;\nvarying float vCrest;\nvarying vec3 vOPos;\n' + SWASH_GLSL + MARKS_GLSL + `
float oH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float oN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(oH(i), oH(i + vec2(1.0, 0.0)), f.x), mix(oH(i + vec2(0.0, 1.0)), oH(i + vec2(1.0, 1.0)), f.x), f.y); }
// Foam lace (2026-10-03: like the cozy references): a white web with round holes — the edges between jittered
// cells, drifting; fades to its average where the holes would be smaller than a pixel or two.
float oLace(vec2 p, float px) {
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)), r = g + vec2(oH(i + g), oH(i + g + 19.7)) * 0.8 + 0.1 - f; float d = dot(r, r); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  float e = (sqrt(d2) - sqrt(d1)) * 0.5, w = max(px, 0.02);
  return mix(0.45, 1.0 - smoothstep(0.08, 0.16 + w, e), smoothstep(0.9, 0.35, px));
}
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        if (mkDry(vOPos)) discard;   // (not inside a boat's hull: render/water-marks.js)
        // the sea's colour by its depth: clear turquoise over the sand (its floor and the light dancing on it show
        // through, render/ground-detail.js), deepening to blue
        vec2 oMap = swMap(vOPos.xz); float od = oMap.x, oReef = oMap.y;
        vec3 shallow = vec3(0.04, 0.62, 0.62), mid = vec3(0.01, 0.36, 0.5);
        diffuseColor.rgb = mix(mix(shallow, mid, smoothstep(0.4, 6.0, od)), diffuseColor.rgb, smoothstep(5.0, 16.0, od));
        // clear in the shallows — the sand, the light on it and what lives there show through (2026-10-03) —
        // clouding with depth; more of a mirror where you look across it than down into it
        vec3 ovd = normalize(cameraPosition - vOPos);
        diffuseColor.a = mix(0.26, diffuseColor.a, smoothstep(0.3, 9.0, od));
        diffuseColor.a = mix(diffuseColor.a, 0.26, oReef * 0.6);   // (clearer over a reef: its corals' colours show)
        diffuseColor.a = mix(diffuseColor.a, 0.92, pow(1.0 - clamp(ovd.y, 0.0, 1.0), 4.0) * 0.7);
        // the water's moving edge on the beach: a clean white line of foam riding it, the thin film behind it clear
        float lip = 0.0, tw = 1.0, etw = 0.002;
        if (od < 1.2) {   // near the shore only
          float osl = swSlope(vOPos.xz), rch = swReachS(vOPos.xz, osl); tw = od + rch; etw = max(fwidth(tw), 0.002);
          lip = swSwashFoam(-tw / osl, (swReachTop(vOPos.xz, osl) - rch) / osl, swRun(vOPos.xz), 0.7, max(fwidth(tw / osl), 0.03), 0.0);
          diffuseColor.a *= smoothstep(-etw, osl * 1.2 + etw, tw);
        }
        // whitecaps on the crests when the sea is up
        float cap = smoothstep(0.75, 1.25, vCrest) * smoothstep(0.6, 1.4, uWaveH);
        // breakers: lines of white water rolling in over the shallows, lacy behind their fronts. The lace drifts slowly
        // and fades to its average where it would be finer than a pixel or two, so from afar the surf is a soft white
        // band along the coast and close up it never boils (2026-10-03: "flickering ... the shore more visible from
        // a bit farther away")
        float opx = length(fwidth(vOPos.xz)), lace = 0.45, brk = 0.0;
        if (od < 4.0) {   // the lace only where there is surf (most of the sea needs none of this)
          vec2 lp = vOPos.xz * 0.7 + (vec2(oN(vOPos.xz * 0.11 + uTime * 0.05), oN(vOPos.xz * 0.11 - 3.0 - uTime * 0.04)) - 0.5) * 2.0;
          lace = oLace(lp + vec2(uTime * 0.05, 0.0), opx * 0.7);
        }
        if (od > 0.03 && od < 4.0) {
          float sdh; vec3 swh; swSurf(vOPos.xz, od, 1.0, sdh, swh);
          brk = (swh.x + swh.y * 0.55) * mix(0.55, 1.0, lace);
          brk *= 0.55 + 0.45 * smoothstep(0.3, 0.7, oN(vOPos.xz * vec2(0.05, 0.05) + 3.0));   // breaking unevenly along the beach
          brk = max(brk, 0.35 * smoothstep(0.5, 3.0, opx) * (1.0 - smoothstep(1.2, 3.0, od)));   // far off: a white band where the surf runs
        }
        float foam = clamp(max(cap * 0.75 + brk, lip * (0.75 + 0.25 * lace) * smoothstep(-etw, etw * 2.0, tw)), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.94, 0.96), foam);
        diffuseColor.a = max(diffuseColor.a, foam * 0.95);
        // what boats and splashes did to it (render/water-marks.js): churned, milky water; white water; their waves
        float mkF, mkA; vec2 mkS; mkAt(vOPos.xz, mkF, mkA, mkS);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.3, 0.78, 0.74), vec3(0.16, 0.46, 0.52), smoothstep(1.0, 12.0, od)), mkA * 0.7);
        diffuseColor.a = max(diffuseColor.a, mkA * 0.6);
        float mkW = mkFoam(vOPos.xz, mkF, opx, uTime);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.94, 0.96), mkW); diffuseColor.a = max(diffuseColor.a, mkW * 0.95);`)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n        normal = normalize(normal - (viewMatrix * vec4(mkS.x, 0.0, mkS.y, 0.0)).xyz);');
    };
    m.customProgramCacheKey = () => 'ocean-gerstner';
    withUnderside(m, 'vOPos');
    this.mesh = new THREE.Mesh(radialGrid(), m);
    this.mesh.position.y = seaLevel; this.mesh.renderOrder = 1; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = hullsUpdate;   // (the boats' hulls it keeps out of, placed this frame)
  }
  /**
   * The full sea (render/ocean-fft.js waves): the surface displaced by the wave field and lit as water is — a mirror of
   * the sky by the Fresnel law (little looking down into it, almost all across it), the sun's glitter, light glowing
   * through the crests (subsurface scattering), whitecaps where the waves break; under it the water's own colour
   * thickening with depth, so the shallows are clear and the open sea deep teal. Drawn premultiplied: the reflection is
   * added in full however clear the water below it.
   */
  _fft(seaLevel) {
    const W = this.waves, u = Object.assign(this.u, W.uniforms, { uOcDay: GU.uDay });
    const m = this.material = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, ior: 1.33, transparent: true, premultipliedAlpha: true, depthWrite: false, envMapIntensity: 1 });
    const hi = W.n >= 128 && W.C >= 3;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = WAVES + OCEAN_GLSL + '\nuniform vec2 uNear;\nvarying vec3 vOPos;\nvarying vec2 vOcP;\nvarying float vOcH;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', `
          vec3 wpos0 = (modelMatrix * vec4(position, 1.0)).xyz;
          float vd = distance(wpos0.xz, uNear);
          // the waves, as fine as the grid is here, calming in shallow water and flat far off (the light still shows them)
          float bd = swDepth(wpos0.xz), nearK = 1.0 - smoothstep(700.0, 1500.0, vd);
          vec3 wdisp = ocDisp(wpos0.xz, max(1.0, vd * 0.05)) * mix(smoothstep(0.3, 6.0, bd), ${CALM_SWELL.toFixed(2)}, swCalm(wpos0.xz)) * (1.0 - smoothstep(1500.0, 4000.0, vd));   // (cut down in a harbour)
          // in the shallows the swell rises into breakers and bores rolling in to the shore (swSurf), each crest thrown
          // forward as it comes; at the shore the water itself runs up the beach and back with each one (swReach) — the
          // beach draws the foam on its edge
          // (on the mesh: rounded swells, and only where its vertices are close enough to draw them — crests fewer than
          // ~5 vertices apart came out as zigzags, 2026-10-03; the light draws them per pixel everywhere)
          if (bd > 0.0 && bd < swOut() && nearK > 0.0) {
            float crestM = 2.0 * sqrt(max(bd, 0.02)) / (SW_K * max(length(swGrad(wpos0.xz, 2.0)), 1e-3));
            float geo = 1.0 - smoothstep(0.16, 0.28, max(1.25, vd * 0.04) / crestM);
            float sdh; vec3 swh; wdisp.y += swSurf(wpos0.xz, bd, 0.0, sdh, swh) * nearK * geo;
          }
          // (a little above the sand's own line, so the drawn edge is the light's, not the mesh's)
          if (bd > -1.5 && bd < 2.0) wdisp.y += (swReach(wpos0.xz) + 0.02) * smoothstep(-1.5, -1.0, bd) * (1.0 - smoothstep(0.4, 2.0, bd)) * nearK;
          vOcH = wdisp.y;
          vOcP = wpos0.xz;
          vec3 objectNormal = vec3(0.0, 1.0, 0.0);
          #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position) + wdisp;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vOPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `uniform float uWaveH, uTime, uSurf, uOcDay;
uniform sampler2D uDepth, uDepthN, uDepthF;
uniform vec4 uDepthRect, uDepthRectN, uDepthRectF;
varying vec3 vOPos;
varying vec2 vOcP;
varying float vOcH;
${hi ? '#define OC_FOAM2' : ''}
` + SWASH_GLSL + OCEAN_GLSL + MARKS_GLSL + `
float oH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float oN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(oH(i), oH(i + vec2(1.0, 0.0)), f.x), mix(oH(i + vec2(0.0, 1.0)), oH(i + vec2(1.0, 1.0)), f.x), f.y); }
float oLace(vec2 p, float px) {
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)), r = g + vec2(oH(i + g), oH(i + g + 19.7)) * 0.8 + 0.1 - f; float d = dot(r, r); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  float e = (sqrt(d2) - sqrt(d1)) * 0.5, w = max(px, 0.02);
  return mix(0.45, 1.0 - smoothstep(0.08, 0.16 + w, e), smoothstep(0.9, 0.35, px));
}
` + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
        if (mkDry(vOPos)) discard;   // (not inside a boat's hull: render/water-marks.js)
        vec2 oMap = swMap(vOcP); float od = oMap.x, oReef = oMap.y, opx = length(fwidth(vOcP)), ocDist = distance(cameraPosition, vOPos);
        vec3 ovd = normalize(cameraPosition - vOPos);
        // the surface: the waves' slopes (calmer over the shallows) and the whitecaps they leave
        vec2 osl, ost; float ofo;
        ocSurf(vOcP, opx, osl, ost, ofo);
        float osk = smoothstep(0.2, 5.0, od);
        osl *= mix(mix(0.3, 1.0, osk), 0.55, swCalm(vOcP));   // (a harbour's: calmer)
        // what boats and splashes did to it (render/water-marks.js): their waves' slopes; below, white water and churned,
        // milky water
        float mkF, mkA; vec2 mkS; mkAt(vOcP, mkF, mkA, mkS);
        osl += mkS;
        // the surf's own slopes and white water (swSurf); where its crests come closer than a few pixels apart, only
        // their average (saf)
        float sdh = 0.0, saf = 1.0 - smoothstep(0.12, 0.35, fwidth(swPhase(vOcP, max(od, 0.0)))); vec3 swh = vec3(0.0);
        if (od > 0.0 && od < swOut()) {
          swSurf(vOcP, od, 0.5, sdh, swh);
          vec2 ss = sdh * swGrad(vOcP, 1.0) * 1.3; float sl = length(ss);   // (a little more than the true slope: the faces catch the light)
          if (sl > 0.8) ss *= 0.8 / sl;
          osl += ss * saf;
        }
        vec3 ocNW = normalize(vec3(-osl.x / max(0.25, 1.0 + ost.x), 1.0, -osl.y / max(0.25, 1.0 + ost.y)));
        // the water's own colour by its depth: clear turquoise over the sand, teal, then deep blue-green; how much of it
        // stands between the eye and the bottom (down through the depth and back up along the view)
        vec3 shallow = vec3(0.02, 0.42, 0.40), mid = vec3(0.005, 0.17, 0.22), deep = vec3(0.002, 0.045, 0.075);
        vec3 body = mix(mix(shallow, mid, smoothstep(0.6, 7.0, od)), deep, smoothstep(7.0, 40.0, od));
        // a wave lifted in the shallows is thin water the light comes through: brighter turquoise toward its crest
        body = mix(body, vec3(0.05, 0.62, 0.56), clamp(vOcH * 0.9, 0.0, 0.65) * (1.0 - osk));
        body = mix(body, mix(vec3(0.36, 0.8, 0.76), vec3(0.12, 0.4, 0.46), smoothstep(1.0, 14.0, od)), mkA * 0.85);   // (bubbles: paler, milky)
        // (over a reef section the water is drawn clearer, so its corals keep their colours: 2026-10-04)
        float oBody = 1.0 - exp(-0.075 * (1.0 - 0.6 * oReef) * max(od, 0.0) * (1.0 + 1.0 / max(ovd.y, 0.12)));
        // whitecaps: the breaking crests' foam, in a lacy web close by, a soft white farther off
        float olc = 0.45;
        if (opx < 1.2) { vec2 lp = vOcP * 0.9 + (vec2(oN(vOcP * 0.13 + uTime * 0.04), oN(vOcP * 0.13 - 3.0)) - 0.5) * 2.0; olc = oLace(lp, opx * 0.9); }
        // (a bright core where it is breaking now, a lacy trail where it broke a moment ago)
        float wcap = max(smoothstep(0.35, 0.75, ofo * osk) * mix(0.7, 1.0, olc), smoothstep(0.12, 0.4, ofo * osk) * olc * smoothstep(0.3, 0.7, oN(vOcP * 0.35 + uTime * 0.02)) * 0.5) * (0.8 + 0.2 * oN(vOcP * 0.05));
        // the shore: breakers rolling in over the shallows, the water's moving edge on the beach (render/water.js swash)
        float lip = 0.0, tw = 1.0, etw = 0.002, oEdge = 1.0, oFilm = 0.0;
        if (od < 0.6) {   // (the swash: never deeper than this)
          float osl2 = swSlope(vOcP), rch = swReachS(vOcP, osl2); tw = od + rch; etw = max(fwidth(tw), 0.002);
          oFilm = 0.22 * smoothstep(-etw, osl2 * 3.0, tw) * (1.0 - smoothstep(0.2, 1.0, od));   // (the sheet running up the sand reads as water)
          float ox = -tw / osl2;
          lip = swSwashFoam(ox, (swReachTop(vOcP, osl2) - rch) / osl2, swRun(vOcP), olc, max(fwidth(ox), 0.03), (oN(vOcP * 0.9 + uTime * 0.3) - 0.5) * 0.35);
          oEdge = smoothstep(-etw, osl2 * 1.2 + etw, tw);
        }
        // the surf's white water (swSurf: only where the waves break, so over a sandbank farther out they only rise and
        // roll on): the breaking crest and the bore's tumbling face dense, the foam behind them thinning; lace of two
        // sizes so it reads as foam, not paving; from afar its average, a soft white band
        float brk = 0.0;
        if (swh.x + swh.y > 0.002) {
          float la = 0.6, lb = 0.6;
          if (opx < 1.5) {
            vec2 lw = (vec2(oN(vOcP * 0.21 + uTime * 0.05), oN(vOcP * 0.21 - 3.0 - uTime * 0.04)) - 0.5) * 3.2;
            la = oLace(vOcP * 0.8 + lw + vec2(uTime * 0.05, 0.0), opx * 0.8); lb = oLace(vOcP * 1.9 + lw * 1.6 + 11.0, opx * 1.9);
          }
          float dense = max(la, lb * 0.8), sparse = la * mix(0.35, 1.0, lb);
          float patchy = smoothstep(0.2, 0.6, 0.65 * oN(vOcP * 0.045 + vec2(uTime * 0.01, 0.0)) + 0.35 * oN(vOcP * 0.23 + 5.0));
          brk = swh.x * mix(0.6, 1.0, dense) * mix(0.75, 1.0, patchy) + swh.y * sparse * mix(0.4, 1.0, patchy);
          brk = mix(swh.z * 0.32 + swh.x * 0.25, brk, saf);
        }
        float oFoam = clamp(max(max(wcap, brk), lip * smoothstep(-etw, etw * 2.0, tw)), 0.0, 1.0);
        oFoam = max(oFoam, mkFoam(vOcP, mkF, opx, uTime));
        diffuseColor.rgb = mix(body, vec3(0.86, 0.9, 0.92), oFoam);
        // (a wave standing up in the shallows is more water to look through than the depth under it)
        oBody = max(max(max(oBody, oFoam), oFilm), smoothstep(0.05, 0.9, vOcH) * 0.5 * (1.0 - osk));
        oBody = max(oBody, mkA * 0.6);   // (bubbly water: thick with light of its own)`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        // farther off, waves too small to see still roughen the mirror (the sky's reflection blurs toward the horizon)
        roughnessFactor = mix(0.04, 0.17, smoothstep(30.0, 2500.0, ocDist)) + oFoam * 0.6;`)
        .replace('#include <normal_fragment_maps>', `normal = normalize((viewMatrix * vec4(mix(ocNW, vec3(0.0, 1.0, 0.0), oFoam * 0.5), 0.0)).xyz);`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // foam is lit by the whole sky, not just the sun: white-grey under clouds (the low sun alone made it tan)
        {
          vec3 fl = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
          reflectedLight.directDiffuse = mix(reflectedLight.directDiffuse, vec3(dot(fl, vec3(0.3, 0.55, 0.15))) * vec3(0.96, 0.98, 1.0) * 0.7, oFoam * 0.7);
          reflectedLight.indirectDiffuse *= 1.0 - oFoam * 0.7;
          totalEmissiveRadiance += vec3(0.5, 0.54, 0.58) * oFoam * (0.06 + 0.3 * uOcDay);
        }
        // light through the crests: looking toward the sun, the thin tops of the waves glow green-blue
        #if NUM_DIR_LIGHTS > 0
        {
          vec3 sl = directionalLights[0].direction, sv = normalize(geometryViewDir);
          float sss = pow(clamp(dot(sv, -sl), 0.0, 1.0), 4.0) * pow(clamp(0.5 - 0.5 * dot(sl, normal), 0.0, 1.0), 2.0) * clamp(vOcH * 1.2 + 0.25, 0.0, 1.8);
          sss += 0.12 * pow(clamp(dot(sv, normal), 0.0, 1.0), 2.0) * clamp(vOcH + 0.4, 0.0, 1.0);
          totalEmissiveRadiance += vec3(0.02, 0.32, 0.27) * sss * directionalLights[0].color * 0.35 * (1.0 - oFoam) * max(osk, smoothstep(0.1, 0.6, vOcH));
        }
        #endif`)
        .replace('#include <opaque_fragment>', `
        // premultiplied: the reflection in full, the water's own light by how much water there is, the bottom (drawn
        // before, tinted by the water over it: render/water.js underwater) through the rest
        // (over the shallows the sky's reflection is softened: the colour of the clear water and the sand beneath it is
        // what shows there — at High, drawn through the bloom's linear buffer, full strength laid a milky film over them)
        float oSoft = mix(${hi ? '0.45' : '0.85'}, 1.0, smoothstep(0.3, 6.0, od));
        float oNV = clamp(dot(normal, normalize(geometryViewDir)), 0.0, 1.0), oF = (0.02 + 0.98 * pow(1.0 - oNV, 5.0)) * oSoft;
        // tone-mapped and encoded here, before it is weighted (2026-10-03, the phone: drawn straight to the screen,
        // weighting first and encoding after brightened the red of the see-through part, and the surf's white water came
        // out lavender; through the bloom's buffer at High both are no-ops and nothing changes)
        // (the reflection adds what it would on top of the brightness of the water's own weighted light — of its
        // brightness only: on each colour apart, the reflection over thin turquoise came out pink)
        vec3 oUnder = totalDiffuse + totalEmissiveRadiance, oBase = vec3(dot(oUnder * oBody, vec3(0.2126, 0.7152, 0.0722))), oAll = oBase + totalSpecular * oSoft;
        #if defined( TONE_MAPPING )
        oUnder = toneMapping(oUnder); oBase = toneMapping(oBase); oAll = toneMapping(oAll);
        #endif
        oUnder = linearToOutputTexel(vec4(oUnder, 1.0)).rgb; oBase = linearToOutputTexel(vec4(oBase, 1.0)).rgb; oAll = linearToOutputTexel(vec4(oAll, 1.0)).rgb;
        gl_FragColor = vec4(oUnder * oBody + max(oAll - oBase, 0.0), clamp(oF + (1.0 - oF) * oBody, 0.0, 1.0)) * oEdge;`)
        .replace('#include <tonemapping_fragment>', '')
        .replace('#include <colorspace_fragment>', '')
        .replace('#include <premultiplied_alpha_fragment>', '')
        .replace('#include <fog_fragment>', `#ifdef USE_FOG
        float mvwMist, fogFactor = mvwFog(mvwMist);   // (the atmosphere's haze and the weather's fog: render/scene.js)
        gl_FragColor = mix(gl_FragColor, vec4(fogColor, 1.0) * oEdge, fogFactor);
        #endif`);
      // a ray off a steep wave heading down meets the next wave and the sky in it, never the ground below the horizon
      // (the sky map's lower half: rough seas came out with tan patches)
      sh.fragmentShader = sh.fragmentShader.replace('#include <envmap_physical_pars_fragment>', THREE.ShaderChunk.envmap_physical_pars_fragment
        .replace('reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );', 'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );\n\t\t\treflectVec.y = abs( reflectVec.y );'));
    };
    m.customProgramCacheKey = () => `ocean-fft-${hi ? 'hi' : 'lo'}`;
    withUnderside(m, 'vOPos');
    this.mesh = new THREE.Mesh(radialGrid(hi ? 256 : 160, hi ? 1.25 : 1.6), m);
    this.mesh.position.y = seaLevel; this.mesh.renderOrder = 1; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.mesh.onBeforeRender = hullsUpdate;   // (the boats' hulls it keeps out of, placed this frame)
  }
  /** A depth map from the terrain worker ({ x0, z0, size, n, px }). */
  setDepth(m) {
    const which = m.id === 'depthN' ? 'N' : m.id === 'depthF' ? 'F' : '';
    this['depthTex' + which].dispose();
    // half floats (2026-10-03: the surf came out in steps from 4 cm depth steps): depth in metres, smooth; and the reef
    const t = new THREE.DataTexture(m.px, m.n, m.n, THREE.RGFormat, THREE.HalfFloatType);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.unpackAlignment = 4; t.needsUpdate = true;   // rows of n pairs of half floats, packed
    this['depthTex' + which] = t; this.u['uDepth' + which].value = t; this.u['uDepthRect' + which].value.set(m.x0, m.z0, m.size, m.n);
    // (and kept here, for the boats: render/sea-probe.js feels the surf over the depth the sea is drawn with)
    const d = new Float32Array(m.n * m.n); for (let i = 0; i < d.length; i++) d[i] = THREE.DataUtils.fromHalfFloat(m.px[i * 2]);
    (this.depthCPU ||= {})[which || 'W'] = { d, n: m.n, x0: m.x0, z0: m.z0, size: m.size };
  }
  /**
   * The water's depth at (x, z) as the sea's shaders read it (SWASH_GLSL swMap: the fine map round the camera, else the
   * wide one, else the whole island's; 50 beyond) — low: as the low sea reads it (the wide map only). Null before any.
   */
  depthAt(x, z, low = false) {
    const D = this.depthCPU;
    if (!D) return null;
    const read = (M, u, v) => {
      const n = M.n, fi = Math.max(0, Math.min(n - 1.001, u * (n - 1))), fj = Math.max(0, Math.min(n - 1.001, v * (n - 1))), i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j, o = j * n + i;
      return (M.d[o] * (1 - a) + M.d[o + 1] * a) * (1 - b) + (M.d[o + n] * (1 - a) + M.d[o + n + 1] * a) * b;
    };
    const at = M => (M ? [(x - M.x0) / M.size, (z - M.z0) / M.size] : null);
    if (!low && D.N) { const [u, v] = at(D.N); if (u > 0.02 && v > 0.02 && u < 0.98 && v < 0.98) return read(D.N, u, v); }
    if (D.W) { const [u, v] = at(D.W); if (u >= 0 && v >= 0 && u <= 1 && v <= 1) return read(D.W, u, v); }
    if (!low && D.F) { const [u, v] = at(D.F); if (u >= 0 && v >= 0 && u <= 1 && v <= 1) return read(D.F, u, v); }
    return 50;
  }
  /** Follow the camera (snapped, so the grid's vertices don't crawl) and set the waves for the weather. */
  update(camPos, weather) {
    const s = 4; this.mesh.position.x = Math.round(camPos.x / s) * s; this.mesh.position.z = Math.round(camPos.z / s) * s;
    this.u.uNear.value.set(camPos.x, camPos.z);
    const want = waveHeight(weather || {}); this.u.uWaveH.value += (want - this.u.uWaveH.value) * 0.02;
    if (this.waves) {
      const now = GU.uTime.value, dt = this._t === undefined ? 0 : Math.max(0, Math.min(0.1, now - this._t)); this._t = now;
      // the sea for the weather, worked out again when the wind or the storm has changed (blended to over seconds)
      const w = weather || {}, wind = w.wind?.speed ?? 3, dir = w.wind?.dir ?? 0, storm = w.storm || 0, S = this._sea;
      if (!S || Math.abs(wind - S.wind) > 0.75 || Math.abs(Math.atan2(Math.sin(dir - S.dir), Math.cos(dir - S.dir))) > 0.25 || Math.abs(storm - S.storm) > 0.1) {
        this.waves.setSea(seaState({ wind, dir, storm }), S ? 8 : 0); this._sea = { wind, dir, storm };
      }
      this.waves.update(now, dt);
    }
  }
}
/** Concentric rings around the origin: step0 (m) apart near the centre, growing 3.5 % per ring out to 500 m (the surf's
 *  crests are 5–35 m apart), then 7 % out to 30 km. */
function radialGrid(segments = 128, step0 = 2) {
  const radii = [0]; let r = step0, step = step0;
  while (r < 30000) { radii.push(r); step *= r < 500 ? 1.035 : 1.07; r += step; }
  const pos = [], idx = [];
  pos.push(0, 0, 0);
  for (let i = 1; i < radii.length; i++) for (let j = 0; j < segments; j++) { const a = j / segments * Math.PI * 2; pos.push(Math.cos(a) * radii[i], 0, Math.sin(a) * radii[i]); }
  const at = (i, j) => (i === 0 ? 0 : 1 + (i - 1) * segments + (j % segments));
  for (let j = 0; j < segments; j++) idx.push(0, at(1, j + 1), at(1, j));
  for (let i = 1; i < radii.length - 1; i++) for (let j = 0; j < segments; j++) { const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j), d = at(i + 1, j + 1); idx.push(a, b, d, a, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv = new Float32Array(pos.length / 3 * 2); for (let k = 0; k < pos.length / 3; k++) { uv[k * 2] = pos[k * 3] / 6; uv[k * 2 + 1] = pos[k * 3 + 2] / 6; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const nrm = new Float32Array(pos.length); for (let k = 1; k < nrm.length; k += 3) nrm[k] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/**
 * A water surface that can be seen from under it (2026-10-06: diving, the sky and the whole island showed through
 * the sea): drawn from both sides — from above (the camera above the water) its top as before, from under the water
 * (GU.uUnder, scene.js Stage.under) its underside: Snell's window overhead, the sky's light through a rippling surface,
 * and outside it the water's own colour mirrored back (total internal reflection), all into the water's fog. pos: the
 * material's world-position varying.
 */
export function withUnderside(material, pos) {
  // both sides in one pass: three draws a see-through two-sided material's back faces in a pass of their own, with the
  // winding flipped, so gl_FrontFacing there called the underside the top
  material.side = THREE.DoubleSide; material.forceSinglePass = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    Object.assign(sh.uniforms, { uUnder: GU.uUnder, uUnderCol: GU.uUnderCol, uUnderSky: GU.uUnderSky, uUwT: GU.uTime, uAbove: GU.uAbove, uUwVP: GU.uUwVP, uAboveOn: GU.uAboveOn });
    sh.fragmentShader = 'uniform float uUnder, uUwT, uAboveOn;\nuniform vec3 uUnderCol, uUnderSky;\nuniform sampler2D uAbove;\nuniform mat4 uUwVP;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
  if (gl_FrontFacing == (uUnder > 0.5)) discard;   // from above its top; from under the water its underside
  if (uUnder > 0.5) {
    vec3 uwP = ${pos}, uwV = normalize(uwP - cameraPosition);
    float uwWin = smoothstep(0.64, 0.72, uwV.y);   // Snell's window: the world above, within ~48.6 degrees of straight up
    vec2 uwQ = uwP.xz * 3.2;
    // the surface's ripples from below: a moving web of bright lines (two warped wave trains crossing) over a softer swell
    float uwA = sin(uwQ.x * 2.3 + uUwT * 1.6 + sin(uwQ.y * 1.7 + uUwT) * 1.2), uwB = sin(uwQ.y * 2.1 - uUwT * 1.3 + sin(uwQ.x * 1.5 - uUwT * 0.8) * 1.2);
    float uwRip = pow(1.0 - abs(uwA + uwB) * 0.5, 6.0), uwSwell = 0.5 + 0.5 * sin((uwQ.x - uwQ.y) * 0.15 + uUwT * 0.6);
    // the world above (Stage.renderAbove), where the line of sight goes once the surface has bent it: refracted through
    // the wavy surface (water to air), so the whole sky down to the horizon fits in the window and the waves bend it;
    // tinted by the water, a faint web of light over it. Outside the window the water's own colour mirrored back.
    vec3 uwN = normalize(vec3(uwA * 0.07 + sin(uwQ.y * 0.35 + uUwT * 1.3) * 0.03, -1.0, uwB * 0.07 + cos(uwQ.x * 0.35 - uUwT * 1.1) * 0.03));
    vec3 uwT = refract(uwV, uwN, 1.333);
    // (a line of sight bent past the edge of that image — toward the horizon behind — takes the rim's light: the water's
    // colour, brighter)
    vec3 uwRim = uUnderCol * 1.6, uwSky = uwRim;
    if (uAboveOn > 0.5 && dot(uwT, uwT) > 0.0) {
      vec4 uwClip = uUwVP * vec4(cameraPosition + uwT * 1000.0, 1.0);
      if (uwClip.w > 0.0) {
        vec2 uwUV = uwClip.xy / uwClip.w * 0.5 + 0.5, uwOut = max(max(-uwUV, uwUV - 1.0), 0.0);
        uwSky = mix(texture2D(uAbove, clamp(uwUV, vec2(0.002), vec2(0.998))).rgb, uwRim, smoothstep(0.0, 0.06, max(uwOut.x, uwOut.y)));
      }
    }
    vec3 uwSee = uwSky * uUnderSky * (0.94 + 0.12 * uwSwell + 0.3 * uwRip);   // (the web as bright as what it lights: dim at night)
    vec3 uwC = mix(uUnderCol * (1.0 + 0.22 * uwRip), uwSee, uwWin);
    #ifdef TONE_MAPPING
    uwC = toneMapping(uwC);   // (drawn straight to the screen: the materials tone-map their own colours)
    #endif
    uwC = linearToOutputTexel(vec4(uwC, 1.0)).rgb;   // (into the output's colours, as three gives fogColor: drawn straight to the screen on Low and Medium)
    #ifdef USE_FOG
    uwC = mix(uwC, fogColor, smoothstep(fogNear, fogFar, vFogDepth) * 0.75);
    #endif
    gl_FragColor = vec4(uwC, 1.0);
  }`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|under`;
  return material;
}

/**
 * Things under the sea seen through it (the reference's clear tropical water): sunlight going down and the view coming
 * back up through the water lose their red first, then green — sand a metre down turns turquoise, deeper teal, then the
 * water's own blue-green — and the water's own glow fills in what the bottom loses. Applied to the lit colour of a
 * material's pixels below the sea (the ground, the rocks and corals, the fish); the sea's surface then adds its
 * reflection over them (Ocean, premultiplied).
 */
export function underwater(material, seaLevel, { clarity = 1 } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    sh.uniforms.uUwSea = { value: seaLevel }; sh.uniforms.uUwDay = GU.uDay; sh.uniforms.uUwK = { value: 1 / clarity }; sh.uniforms.uUnder = GU.uUnder;
    // (the pixel's place in the world from its place in the view: works whatever the material did to its vertices)
    sh.fragmentShader = 'uniform float uUwSea, uUwDay, uUwK, uUnder;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
  {
    vec3 uwP = cameraPosition + transpose(mat3(viewMatrix)) * (-vViewPosition);
    float uwD = uUwSea - uwP.y;
    if (uwD > 0.0) {
      vec3 uwV = normalize(cameraPosition - uwP);
      // the light down from the surface, and the view back: up through the surface, or (the camera under water) straight
      // to the eye (uUwK < 1: things that should keep their colours, the reefs' corals)
      float uwPath = (uwD + (uUnder > 0.5 ? 0.6 * distance(cameraPosition, uwP) : uwD / max(uwV.y, 0.15))) * uUwK;   // (clear water: 2026-10-06)
      vec3 uwT = exp(-vec3(0.42, 0.06, 0.042) * uwPath);
      outgoingLight = outgoingLight * uwT + vec3(0.002, 0.07, 0.085) * (0.12 + 0.88 * uUwDay) * (1.0 - uwT);
    }
  }
  #include <opaque_fragment>`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|uw`;
  return material;
}

/**
 * Surf on the shore, in a terrain material: the sea's water runs up the beach and back with each wave (render: the sea
 * mesh, SWASH_GLSL) and here, on the sand, a line of foam rides its edge with lace behind it as it drains; the sand it
 * reached stays dark and glossy. ocean: the Ocean's uniforms (its depth map, so the sand and the water agree exactly).
 */
export function shoreFoam(material, seaLevel, uSurf, ocean) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    Object.assign(sh.uniforms, CALM, { uSea: { value: seaLevel }, uSurf, uTime: GU.uTime, uDepth: ocean.uDepth, uDepthRect: ocean.uDepthRect, uDepthN: ocean.uDepthN, uDepthRectN: ocean.uDepthRectN, uDepthF: ocean.uDepthF, uDepthRectF: ocean.uDepthRectF });
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = `uniform float uSea, uSurf, uTime;\nuniform sampler2D uDepth, uDepthN, uDepthF;\nuniform vec4 uDepthRect, uDepthRectN, uDepthRectF;\nvarying vec3 vWPos;
${SWASH_GLSL}
float sfH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sfN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(sfH(i), sfH(i + vec2(1.0, 0.0)), f.x), mix(sfH(i + vec2(0.0, 1.0)), sfH(i + vec2(1.0, 1.0)), f.x), f.y); }
float sfLace(vec2 p, float px) {
  vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)), r = g + vec2(sfH(i + g), sfH(i + g + 19.7)) * 0.8 + 0.1 - f; float d = dot(r, r); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  float e = (sqrt(d2) - sqrt(d1)) * 0.5, w = max(px, 0.02);
  return mix(0.45, 1.0 - smoothstep(0.08, 0.16 + w, e), smoothstep(0.9, 0.35, px));
}
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 sp = vWPos.xz; float spx = length(fwidth(sp));   // (derivatives outside the branch)
      if (vWPos.y > uSea - 1.5 && vWPos.y < uSea + 1.25) {
        float slope = swSlope(sp), top = swReachTop(sp, slope), above = vWPos.y - uSea;
        // the sand the waves reach: dark and glossy, drying up the beach; under the water it eases off before this block
        // ends (1.5 m down) — the water's own colour takes over there (a hard stop drew a straight line)
        float wetSand = (1.0 - smoothstep(top * 0.6, top + slope * 2.0 + 0.02, above)) * (1.0 - smoothstep(0.5, 1.4, -above));
        diffuseColor.rgb *= 1.0 - 0.28 * wetSand;
        // the swash's foam, only where it can be (above where this wave reaches it is dry sand; far under the water
        // the sea draws the surf): the phone spends nothing on the rest of the beach
        float reach = swReachS(sp, slope), x = (above - reach) / slope;
        if (above < top + slope * 1.0 && x > -4.0) {
          float run = swRun(sp), ex = max(spx, 0.03);
          vec2 lq = sp * 1.1 + (vec2(sfN(sp * 0.15 + uTime * 0.05), sfN(sp * 0.15 - 4.0)) - 0.5) * 2.0;
          float lace = sfLace(lq + vec2(uTime * 0.04, -uTime * 0.03), spx * 1.1);
          if (run < 0.35 || lace > 0.05) lace *= mix(0.4, 1.0, sfLace(lq * 2.1 + 11.0, spx * 2.3));
          float foam = swSwashFoam(x, (top - reach) / slope, run, lace, ex, (sfN(sp * 0.9 + uTime * 0.3) - 0.5) * 0.35);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.97), foam * 0.9);
        }
      }`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|surf2`;
  return material;
}
