// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The countryside's standing detail as drawn (meshes from render/countryside-build.js, one per full-detail terrain
// tile): a shared material that sways crops and hedges in the wind, raises them out of the ground as the camera comes
// within reach (and lays them down beyond it, so tiles never pop), and gives each kind of surface its close texture —
// corn and sunflower leaves, wheat ears with the wind's waves running over them (the same waves the ground shader
// draws further off), hedge foliage, dry-stone, straw, wood. Darker toward the ground, like the shade under a crop.
// the owner's notes 2026-10-03 ("not lego/bands", "the hay-wheels' texture looks off"): foliage and crops take their texture
// from noise in all three dimensions (no streaks running across the world), and everything built along a path or round
// an axis — walls, bales, boards, shingles — from its own surface coordinates (aT): straw rolled round a bale with
// the spiral on its ends, plastic wrap wound in bands, square bales in flakes with their strings, stones laid in courses.
import * as THREE from 'three';
import { GU, wettable } from './scene.js';
import { TS } from './countryside-build.js';

/** Within this distance (m) the countryside stands, per quality; the small things (cabbages, sunflower heads, tulips)
 *  within SMALL_K of it. */
export const COUNTRYSIDE_R = { low: 0, medium: 170, high: 320 };
export const SMALL_K = 0.42;

/** shared: the camera/reach uniforms of another countryside material (per-tile materials share one set). */
export function countrysideMaterial(reach, shared = null) {
  const u = shared || { uCsCam: { value: new THREE.Vector3() }, uCsR: { value: reach } };
  const m = wettable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }), { darken: 0.2, gloss: 0.3 });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, u, { uCsTime: GU.uTime, uCsWind: GU.uWind, uCsNight: GU.uNight, uCsSway: GU.uSway });
    sh.vertexShader = `attribute vec3 aK;
attribute vec2 aT;
uniform vec3 uCsCam; uniform float uCsR, uCsTime; uniform vec4 uCsWind, uCsSway;
varying vec3 vCsPos; varying float vCsKind, vCsH; varying vec2 vCsT;
` + sh.vertexShader.replace('#include <begin_vertex>', `
  vec3 transformed = vec3(position);
  vec4 csW = modelMatrix * vec4(position, 1.0);
  float csHg = aK.z * 6.0, csSw = aK.y;
  // stand up within reach, lie down (under the ground) beyond it
  float grow = smoothstep(uCsR, uCsR * 0.8, distance(csW.xz, uCsCam.xz));
  transformed.y -= csHg * (1.0 - grow) + (grow <= 0.001 && csHg > 0.0 ? 0.3 : 0.0);   // (farmsteads, csHg 0, always stand)
  // the wind bends the tops
  vec2 csWd = uCsWind.xz / max(uCsWind.w, 0.01);
  float csPh = csW.x * 0.19 + csW.z * 0.13;
  float csAmp = (0.05 + 0.025 * uCsWind.w) * (0.55 + 0.45 * sin(uCsSway.z + csPh)) * csSw * csSw * grow;
  transformed.xz += csWd * csAmp;
  vCsPos = csW.xyz; vCsKind = aK.x * 255.0; vCsH = csHg; vCsT = aT * ${(1 / TS).toFixed(7)};`);
    sh.fragmentShader = `uniform float uCsTime; uniform vec4 uCsWind, uCsSway;
varying vec3 vCsPos; varying float vCsKind, vCsH; varying vec2 vCsT;
float csH21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float csN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(csH21(i), csH21(i + vec2(1.0, 0.0)), f.x), mix(csH21(i + vec2(0.0, 1.0)), csH21(i + vec2(1.0, 1.0)), f.x), f.y); }
float csH31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float csN3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(csH31(i), csH31(i + vec3(1.0, 0.0, 0.0)), f.x), mix(csH31(i + vec3(0.0, 1.0, 0.0)), csH31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(csH31(i + vec3(0.0, 0.0, 1.0)), csH31(i + vec3(1.0, 0.0, 1.0)), f.x), mix(csH31(i + vec3(0.0, 1.0, 1.0)), csH31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z); }
uniform float uCsNight;
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  float csBump = 0.0;
  {
    int k = int(vCsKind + 0.5);
    vec3 W = vCsPos; vec2 P = W.xz, T = vCsT; float y = W.y;
    float px = length(fwidth(W));
    float fine = smoothstep(0.25, 0.04, px);
    float wny = (vec4(normalize(vNormal), 0.0) * viewMatrix).y;   // the surface's slope in the world: tops and sides
    float t = 1.0;
    float bump = 0.0;
    // a noise layer of f cycles per metre at full strength while it spans several pixels, fading to its middle before
    // it would shimmer
    #define CSO(n, f) (0.5 + ((n) - 0.5) * smoothstep(0.5, 0.15, px * (f)))
    if (k == 1 || k == 4) {          // corn, sunflower leaves: broad blades, lighter edges, mottled
      float bl = CSO(csN3(W * vec3(2.2, 3.5, 2.2)), 3.5), lf = CSO(csN3(W * vec3(7.0, 2.5, 7.0) + 9.0), 7.0);
      t = 0.76 + 0.34 * bl + 0.14 * lf; bump = bl * 0.5 + lf * 0.5;
    } else if (k == 2) {             // wheat: ears on top, stalks on the sides, clumps, and the wind's waves
      vec2 wd = normalize(uCsWind.xz + vec2(1e-4, 0.0));
      float wave = sin(dot(P, wd) * 0.22 - uCsSway.w) * csN(P * 0.03 + uCsTime * 0.05);
      float ear = CSO(csN3(W * vec3(5.5, 8.0, 5.5)), 8.0) * 0.6 + CSO(csN3(W * 14.0 + 3.0), 14.0) * 0.4, stalk = CSO(csN3(W * vec3(16.0, 1.2, 16.0)), 16.0);
      float tex = mix(stalk, ear, smoothstep(0.3, 0.7, wny)), clump = csN3(W * 0.8);
      t = 0.86 + 0.18 * tex + 0.08 * (clump - 0.5) + (0.06 + 0.02 * uCsWind.w) * wave; bump = tex * 0.5 + clump * 0.4;
    } else if (k == 10) {            // hedge: clumps with deep pockets between them, leaves catching the light close up
      float clump = csN3(W * 1.1), mid = CSO(csN3(W * 3.5 + 5.0), 3.5), leaf = CSO(csN3(W * 11.0 + 11.0), 11.0), speck = csN3(W * 26.0 + 3.0);
      float body = 0.58 + 0.48 * smoothstep(0.2, 0.8, clump) + 0.22 * (mid - 0.5);
      t = body * (0.84 + 0.36 * (leaf - 0.5) + 0.26 * smoothstep(0.6, 0.85, speck) * smoothstep(0.5, 0.15, px * 26.0)); bump = clump * 0.5 + mid * 0.3 + leaf * 0.15;
    } else if (k == 11) {            // dry-stone: stones laid in courses, each its own size and grey, dark gaps
      vec2 q = vec2(T.x * 2.6, T.y * 4.2); float row = floor(q.y);
      q.x += row * 0.47 + csH21(vec2(row, 3.0)) * 0.6 + (csN(vec2(q.x * 1.3, row)) - 0.5) * 0.5;
      vec2 f = fract(q), i = floor(q);
      float edge = min(min(f.x, 1.0 - f.x) * 1.4, min(f.y, 1.0 - f.y)) + (csN(T * 9.0) - 0.5) * 0.08, st = smoothstep(0.0, 0.12, edge), sw = smoothstep(0.08, 0.025, px);
      t = (0.74 + 0.38 * csH21(i) * smoothstep(0.3, 0.1, px)) * (0.9 + 0.2 * CSO(csN(T * 6.0), 6.0)) * mix(0.8, st * 0.55 + 0.45, sw); bump = st * 0.6 * sw;
    } else if (k == 9) {             // round bale, its curve: straw wound round it, loose wisps
      float fib = CSO(csN(vec2(T.x * 26.0, T.y * 1.6)), 26.0) * 0.6 + CSO(csN(vec2(T.x * 70.0, T.y * 4.0 + 7.0)), 70.0) * 0.4, tuft = CSO(csN(T * vec2(5.0, 7.0) + 3.0), 7.0);
      float layer = csN(vec2(T.x * 7.0, T.y * 0.5 + 4.0));   // bands of straw round it, each a little paler or darker
      t = (0.82 + 0.24 * fib + 0.1 * (tuft - 0.5)) * (0.86 + 0.24 * layer) * (1.0 - 0.12 * smoothstep(0.4, 0.95, wny)); bump = fib * 0.5 + tuft * 0.3 + layer * 0.3;
    } else if (k == 20) {            // round bale, its ends: the straw rolled in a spiral, packed tight in the middle
      float r = length(T), ang = atan(T.y, T.x), d = r / 0.085 + ang / 6.2832, rg = fract(d);
      float gw = smoothstep(0.045, 0.018, px), groove = mix(0.9, 0.7 + 0.3 * smoothstep(0.0, 0.3, rg) * smoothstep(1.0, 0.75, rg), gw);
      float fib = CSO(csN(T * 18.0), 18.0) * 0.5 + CSO(csN(T * 6.0 + 5.0), 6.0) * 0.5;
      t = (0.8 + 0.22 * fib) * groove * (0.78 + 0.22 * smoothstep(0.0, 0.3, r)); bump = groove * 0.5 + fib * 0.2;
    } else if (k == 13) {            // wrapped bale, its curve: film wound on in overlapping bands, creased
      float bnd = fract((T.x * 0.9 + T.y * 0.42) / 0.5), lap = 0.96 + 0.04 * smoothstep(0.0, 0.06, bnd) * smoothstep(1.0, 0.7, bnd);
      float cr = CSO(csN(vec2(T.y * 1.5, T.x * 5.0)), 5.0);
      t = mix(0.98, lap, smoothstep(0.05, 0.02, px)) * (0.95 + 0.06 * cr); bump = lap * 0.15 + cr * 0.1;
    } else if (k == 21) {            // wrapped bale, its ends: film gathered in creases running out from the middle
      float r = length(T), cr = CSO(csN(T * 4.0 + 3.0), 4.0) * 0.7 + CSO(csN(T * 9.0), 9.0) * 0.3;
      t = (0.93 + 0.08 * cr) * (0.9 + 0.1 * smoothstep(0.0, 0.25, r)); bump = cr * 0.12;
    } else if (k == 22 || k == 23) { // square bales: flakes of straw across their length, two strings round them; cut straw on the ends
      float tw;
      if (k == 22) {
        float fl = fract(T.x * 9.0 + (csN(T * 3.0) - 0.5) * 0.4), flake = smoothstep(0.0, 0.12, fl), fw = smoothstep(0.04, 0.015, px);
        float fib = CSO(csN(vec2(T.x * 30.0, T.y * 70.0)), 70.0);
        t = (0.84 + 0.18 * fib) * mix(0.9, 0.8 + 0.2 * flake, fw); bump = flake * 0.4 * fw + fib * 0.2;
        tw = wny > 0.5 ? 1.0 - smoothstep(0.008, 0.018, abs(abs(T.y) - 0.12)) : 0.0;
      } else {
        float sp = CSO(csN(T * 45.0), 45.0) * 0.6 + CSO(csN(T * 12.0), 12.0) * 0.4;
        t = 0.78 + 0.26 * sp; bump = sp * 0.3;
        tw = 1.0 - smoothstep(0.008, 0.018, abs(abs(T.x) - 0.12));
      }
      t *= 1.0 - 0.4 * tw * smoothstep(0.02, 0.008, px);
    } else if (k == 6) {             // lavender: flower spikes
      float sp = CSO(csN3(W * vec3(9.0, 5.0, 9.0)), 9.0);
      t = 0.8 + 0.35 * sp; bump = sp * 0.5;
    } else if (k == 3 || k == 7 || k == 8) {
      float lf = CSO(csN3(W * 4.5), 4.5) * 0.6 + CSO(csN3(W * 11.0 + 2.0), 11.0) * 0.4;
      t = 0.85 + 0.25 * lf; bump = lf * 0.3;
    } else if (k == 12) {            // weathered wood: grain
      t = 0.8 + 0.3 * CSO(csN3(W * vec3(25.0, 2.0, 25.0)), 25.0);
    } else if (k == 14) {            // barn planks: upright boards, weathered
      float bd = fract(T.x * 3.3), seam = smoothstep(0.0, 0.08, bd) * smoothstep(1.0, 0.92, bd), fb = smoothstep(0.07, 0.025, px);   // boards fade before they shimmer
      t = (0.82 + 0.18 * csN(vec2(floor(T.x * 3.3) * 1.7, T.y * 0.6))) * mix(0.94, 0.72 + 0.28 * seam, fb); bump = seam * 0.5 * fb;
    } else if (k == 15) {            // roofs: courses of shingles up the slope, staggered joints, darker in the joints
      float cy = T.y * 3.2, c = fract(cy), crs = smoothstep(0.0, 0.15, c), j = fract(T.x * 2.4 + floor(cy) * 0.5), jt = smoothstep(0.0, 0.05, j) * smoothstep(1.0, 0.95, j);
      float fr = smoothstep(0.07, 0.025, px);
      t = (0.85 + 0.2 * csN(vec2(floor(T.x * 2.4 + floor(cy) * 0.5), floor(cy)) * 3.1)) * mix(0.95, 0.75 + 0.25 * crs * (0.85 + 0.15 * jt), fr); bump = crs * 0.4 * fr;
    } else if (k == 16) {            // plaster: soft mottling, a little grime low down
      t = (0.9 + 0.12 * csN3(W * 1.7)) * (0.85 + 0.15 * smoothstep(0.0, 1.2, T.y));
    } else if (k == 17) {            // painted metal: vertical seams, a sheen
      float sm = smoothstep(0.0, 0.06, fract(atan(vCsPos.z, vCsPos.x) * 6.0)) ;
      t = 0.88 + 0.1 * csN(vec2(P.x + P.y, y * 0.4)); t *= mix(1.0, 0.85 + 0.15 * sm, fine);
    } else if (k == 18) {            // window glass: dark by day, reflecting the sky a little
      t = 0.9 + 0.2 * smoothstep(0.3, 0.9, csN(vec2(P.x + P.y, y) * 2.0));
    } else if (k == 19) {            // gravel
      float gv = CSO(csN(P * 9.0), 9.0) * 0.6 + CSO(csN(P * 23.0), 23.0) * 0.4;
      t = 0.82 + 0.3 * gv; bump = gv * 0.4;
    }
    #undef CSO
    csBump = bump * fine * 0.35;
    // shade low down, as under a standing crop or a hedge
    float ao = k >= 14 && k <= 19 ? 1.0 : k == 11 || k == 12 || k == 9 || k == 13 || k >= 20 ? 0.75 + 0.25 * smoothstep(0.0, 0.5, vCsH) : 0.5 + 0.5 * smoothstep(0.0, 1.1, vCsH);
    diffuseColor.rgb *= t * ao;
  }`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  if (int(vCsKind + 0.5) == 13 || int(vCsKind + 0.5) == 21) roughnessFactor = 0.35;   // wrapped bales shine
  if (int(vCsKind + 0.5) == 17 || int(vCsKind + 0.5) == 18) roughnessFactor = 0.3;`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  if (int(vCsKind + 0.5) == 18) totalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * uCsNight * (0.6 + 0.4 * fract(sin(dot(floor(vCsPos.xz * 0.9), vec2(12.9898, 78.233))) * 43758.5));   // lamps lit inside at night`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec3 sp = -vViewPosition, sx = dFdx(sp), sy = dFdy(sp);
    vec2 dH = vec2(dFdx(csBump), dFdy(csBump));
    vec3 R1 = cross(sy, normal), R2 = cross(normal, sx);
    float det = dot(sx, R1) * faceDirection;
    normal = normalize(abs(det) * normal - sign(det) * (dH.x * R1 + dH.y * R2));
  }`);
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${key ? key() : ''}|countryside`;
  m.userData.cs = u;
  return m;
}

/** A tile's countryside mesh from the worker's arrays ({ pos, nrm, col, k, idx }); positioned in the tile's frame. */
export function countrysideMesh(cs, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(cs.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(cs.nrm, 3, true));
  g.setAttribute('color', new THREE.BufferAttribute(cs.col, 3, true));
  g.setAttribute('aK', new THREE.BufferAttribute(cs.k, 3, true));
  g.setAttribute('aT', cs.t ? new THREE.BufferAttribute(cs.t, 2) : new THREE.BufferAttribute(new Int16Array(cs.pos.length / 3 * 2), 2));
  g.setIndex(new THREE.BufferAttribute(cs.idx, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'countryside'; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
  return mesh;
}
