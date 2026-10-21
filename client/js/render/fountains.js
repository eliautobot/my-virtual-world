// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fountains' water (2026-10-05: a fountain in the middle of every park, "make sure it looks great"): one
// instanced mesh for every fountain in the world — the parks' (their level items) and the ones placed outdoors
// (world.decorations) — drawn over the stone model (render/furniture.js D.fountain, FOUNTAIN) with an animated
// water material: the pool and both bowls ripple out from where water falls, foam where it lands, curtains of
// streaky water spill over both lips, a crown jet rises from the spout and eight jets arc in from the rim. Pool lamps
// light it from below at night. All motion is in the shader (GU.uTime); the geometry is built once.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { floorAt } from '/shared/constants.js';
import { toWorld, bRot } from '/shared/geom.js';
import { GU } from './scene.js';
import { FOUNTAIN as F } from './furniture.js';

const TAU = Math.PI * 2, G = 9.8;
const K_POOL = 0, K_SHEET = 1, K_JET = 2, K_BOWL1 = 3, K_BOWL2 = 4;
// where the falling water lands (radius in the pool, in the lower bowl); the rim jets' landing radius
const CURTAIN1 = { r0: F.bowl1.r + 0.02, y0: F.bowl1.y, v: 0.55, y1: F.poolY };
const CURTAIN2 = { r0: F.bowl2.r + 0.02, y0: F.bowl2.y, v: 0.4, y1: F.bowl1.y - 0.02 };
const fall = c => { const T = Math.sqrt(2 * (c.y0 - c.y1) / G); return { T, r1: c.r0 + c.v * T }; };
const C1 = fall(CURTAIN1), C2 = fall(CURTAIN2);
const RIM_JETS = 8, RIM_FROM = F.poolIn - 0.04, RIM_TO = 1.95, RIM_APEX = 1.25;
const CROWN = 10, CROWN_TOP = F.spout + 0.5, CROWN_TO = 0.5;

/** The water's geometry in the fountain's own frame: position, normal and aW (kind, u, v, seed). */
function waterGeometry() {
  const P = [], N = [], W = [], I = [];
  const v = (x, y, z, nx, ny, nz, k, a, b, c) => { P.push(x, y, z); N.push(nx, ny, nz); W.push(k, a, b, c); return P.length / 3 - 1; };
  const grid = (rows, cols, at, wrap = true) => {   // at(i, j) → [x, y, z, nx, ny, nz, k, a, b, c]
    const base = P.length / 3, nc = wrap ? cols : cols + 1;
    for (let i = 0; i <= rows; i++) for (let j = 0; j < nc; j++) v(...at(i, j));
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const j1 = wrap ? (j + 1) % cols : j + 1, a = base + i * nc + j, b = base + i * nc + j1, c = base + (i + 1) * nc + j, d = base + (i + 1) * nc + j1;
      I.push(a, c, b, b, c, d);
    }
  };
  const disc = (r0, r1, y, k, rings, seg) => grid(rings, seg, (i, j) => {
    const r = r0 + (r1 - r0) * i / rings, a = TAU * j / seg;
    return [Math.sin(a) * r, y, Math.cos(a) * r, 0, 1, 0, k, r, a, 0];
  });
  disc(F.ped - 0.02, F.poolIn, F.poolY, K_POOL, 22, 72);
  disc(0.2, F.bowl1.in + 0.08, F.bowl1.y - 0.02, K_BOWL1, 10, 48);
  disc(0.1, F.bowl2.in + 0.06, F.bowl2.y - 0.015, K_BOWL2, 6, 32);
  // curtains over the lips: a thin parabolic sheet all round (its streaks break it into streams)
  const sheet = (c, fl, seed) => grid(10, 64, (i, j) => {
    const t = fl.T * i / 10, r = c.r0 + c.v * t, y = c.y0 - 0.5 * G * t * t, a = TAU * j / 64;
    const dr = c.v, dy = -G * t, L = Math.hypot(dr, dy);   // normal: outward-ish, perpendicular to the fall
    return [Math.sin(a) * r, y, Math.cos(a) * r, Math.sin(a) * -dy / L, dr / L, Math.cos(a) * -dy / L, K_SHEET, i / 10, a, seed];
  });
  sheet(CURTAIN1, C1, 0); sheet(CURTAIN2, C2, 1);
  // a jet: a thin tube along points pts ([x, y, z] each), radius rad
  const tube = (pts, rad, seed) => {
    const n = pts.length - 1, side = 6;
    grid(n, side, (i, j) => {
      const p = pts[i], q = pts[Math.min(n, i + 1)], o = pts[Math.max(0, i - 1)];
      const tx = q[0] - o[0], ty = q[1] - o[1], tz = q[2] - o[2], tl = Math.hypot(tx, ty, tz) || 1;
      const T = [tx / tl, ty / tl, tz / tl], up = Math.abs(T[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      let A = [T[1] * up[2] - T[2] * up[1], T[2] * up[0] - T[0] * up[2], T[0] * up[1] - T[1] * up[0]]; const al = Math.hypot(...A); A = A.map(x => x / al);
      const B = [T[1] * A[2] - T[2] * A[1], T[2] * A[0] - T[0] * A[2], T[0] * A[1] - T[1] * A[0]];
      const th = TAU * j / side, c = Math.cos(th), s = Math.sin(th), r = rad * (1 - 0.35 * i / n);
      const nx = A[0] * c + B[0] * s, ny = A[1] * c + B[1] * s, nz = A[2] * c + B[2] * s;
      return [p[0] + nx * r, p[1] + ny * r, p[2] + nz * r, nx, ny, nz, K_JET, i / n, th, seed];
    });
  };
  const arc = (x0, y0, z0, x1, y1, z1, apex, n = 18) => {   // a parabola from one point to another, peaking at apex
    const out = [];
    for (let i = 0; i <= n; i++) { const u = i / n, h = 4 * (apex - Math.max(y0, y1)) * u * (1 - u); out.push([x0 + (x1 - x0) * u, y0 + (y1 - y0) * u + h, z0 + (z1 - z0) * u]); }
    return out;
  };
  for (let k = 0; k < RIM_JETS; k++) {
    const a = k * TAU / RIM_JETS, s = Math.sin(a), c = Math.cos(a);
    tube(arc(s * RIM_FROM, F.rim - 0.06, c * RIM_FROM, s * RIM_TO, F.poolY, c * RIM_TO, RIM_APEX), 0.021, 2 + k);
  }
  tube([[0, F.spout, 0], [0, F.spout + 0.2, 0], [0, CROWN_TOP - 0.05, 0], [0, CROWN_TOP, 0]], 0.034, 20);
  for (let k = 0; k < CROWN; k++) {
    const a = (k + 0.5) * TAU / CROWN, s = Math.sin(a), c = Math.cos(a);
    tube(arc(0, CROWN_TOP - 0.02, 0, s * CROWN_TO, F.bowl2.y - 0.02, c * CROWN_TO, CROWN_TOP + 0.08, 12), 0.016, 30 + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(W, 4));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

const GLSL_NOISE = /* glsl */`
float fwH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fwN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fwH(i), fwH(i + vec2(1, 0)), f.x), mix(fwH(i + vec2(0, 1)), fwH(i + vec2(1, 1)), f.x), f.y); }`;

function waterMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.07, metalness: 0.05, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = GU.uTime; sh.uniforms.uNight = GU.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aW; varying vec4 vW; varying vec3 vLP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = aW; vLP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime, uNight; varying vec4 vW; varying vec3 vLP;
${GLSL_NOISE}
const float C1R = ${C1.r1.toFixed(3)}, C2R = ${C2.r1.toFixed(3)}, RIMR = ${RIM_TO.toFixed(3)}, CRR = ${CROWN_TO.toFixed(3)};
// ripples spreading from a ring of radius R (amplitude and slope), fading with distance
vec2 ringWave(float r, float R, float t) { float d = abs(r - R); float w = sin(d * 26.0 - t * 7.0) * exp(-d * 2.2); return vec2(w, cos(d * 26.0 - t * 7.0) * exp(-d * 2.2) * sign(r - R)); }
float landing(vec2 p, float R, float n, float rad) {   // foam round n landing points on a ring of radius R
  float a = atan(p.x, p.y), k = floor(a / 6.2831853 * n + 0.5), b = k * 6.2831853 / n;
  return smoothstep(rad, 0.0, length(p - vec2(sin(b), cos(b)) * R)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float fwK = vW.x, fwT = uTime;
vec3 deep = vec3(0.04, 0.26, 0.31), shallow = vec3(0.26, 0.56, 0.58), foamC = vec3(0.93, 0.97, 0.98);
float fwA = 0.7, foam = 0.0; vec2 slope = vec2(0.0);
float fwR = length(vLP.xz); vec2 fwDir = fwR > 1e-4 ? vLP.xz / fwR : vec2(0.0);
if (fwK < 0.5) {                       // the pool
  vec2 a = ringWave(fwR, C1R, fwT), b = ringWave(fwR, RIMR, fwT * 1.13 + 1.7);
  float lj = landing(vLP.xz, RIMR, ${RIM_JETS}.0, 0.24);
  slope = fwDir * (a.y * 0.10 + b.y * 0.05 * (0.4 + lj)) + 0.03 * vec2(fwN(vLP.xz * 3.0 + fwT * 0.4) - 0.5, fwN(vLP.zx * 3.0 - fwT * 0.37) - 0.5);
  float rq = (fwR - C1R) / 0.16, ring = exp(-rq * rq);   // (pow() of a negative base is NaN on Direct3D: the bloom turned it into a black screen)
  foam = ring * (0.45 + 0.55 * fwN(vec2(atan(vLP.x, vLP.z) * 18.0, fwR * 9.0 - fwT * 2.6))) + lj * lj * smoothstep(0.35, 0.8, fwN(vLP.xz * 16.0 + vec2(fwT * 3.1, -fwT * 2.3)));
  foam += smoothstep(0.1, 0.0, abs(fwR - ${F.poolIn.toFixed(2)}) ) * 0.25;
  diffuseColor.rgb = mix(deep, shallow, 0.35 + 0.35 * smoothstep(${F.poolIn.toFixed(2)}, 1.0, fwR));
  fwA = 0.72;
} else if (fwK < 1.5) {                // the curtains: streaks running down, breaking into streams
  float v = vW.y, a = vW.z;
  float st = fwN(vec2(a * (vW.w > 0.5 ? 26.0 : 44.0), v * 3.0 - fwT * 3.2)), streams = smoothstep(0.18, 0.55, fwN(vec2(a * (vW.w > 0.5 ? 9.0 : 15.0), 0.3 + vW.w * 7.0)) * 0.7 + 0.3 * st);
  fwA = (0.18 + 0.55 * st) * streams * smoothstep(1.0, 0.82, v) + 0.12;
  foam = smoothstep(0.55, 1.0, v) * 0.6 + st * 0.25;
  diffuseColor.rgb = mix(shallow, foamC, 0.35);
  slope = vec2(st - 0.5) * 0.3;
} else if (fwK < 2.5) {                // the jets: pulses of water running along them
  float u = vW.y, p = fract(u * 6.0 - fwT * 2.4 + vW.w * 0.37), br = fwN(vec2(u * 22.0 - fwT * 8.0, vW.z * 2.0 + vW.w));
  fwA = (0.16 + 0.42 * smoothstep(0.0, 0.35, p) * smoothstep(1.0, 0.55, p)) * (0.55 + 0.45 * br) * smoothstep(1.0, 0.85, u + 0.1 * br);   // breaks into drops near its end
  foam = 0.12 + 0.3 * br * u;
  diffuseColor.rgb = mix(shallow, foamC, 0.3);
} else {                                // the bowls: ripples from the water falling into them
  float R = fwK < 3.5 ? C2R : CRR, rb = fwK < 3.5 ? ${(F.bowl1.in + 0.08).toFixed(2)} : ${(F.bowl2.in + 0.06).toFixed(2)};
  vec2 a = ringWave(fwR, R, fwT * 1.2);
  slope = fwDir * a.y * 0.09 + 0.03 * vec2(fwN(vLP.xz * 6.0 + fwT) - 0.5, fwN(vLP.zx * 6.0 - fwT) - 0.5);
  float bq = (fwR - R) / 0.09;
  foam = exp(-bq * bq) * (0.5 + 0.5 * fwN(vec2(atan(vLP.x, vLP.z) * 14.0, fwT * 3.0))) + smoothstep(rb - 0.1, rb, fwR) * 0.45;
  diffuseColor.rgb = mix(deep, shallow, 0.6);
  fwA = 0.78;
}
foam = clamp(foam, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, foamC, foam * 0.85);
diffuseColor.a = clamp(fwA + foam * 0.35, 0.0, 0.96);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(normal + (viewMatrix * vec4(-slope.x, 0.0, -slope.y, 0.0)).xyz);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.06, 0.5, foam);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
// the pool's lamps at night: the pool glows from below, the falling water catches it
totalEmissiveRadiance += uNight * (fwK < 0.5 || fwK > 2.5 ? vec3(0.1, 0.42, 0.46) * (0.6 + 0.4 * foam) : vec3(0.18, 0.4, 0.42) * (0.5 + foam));
if (fwK < 0.5) {   // a soft pool of light over each lamp in the floor
  float la = atan(vLP.x, vLP.z) / 6.2831853 * 8.0 - 0.5, lb = (floor(la + 0.5) + 0.5) * 6.2831853 / 8.0;
  float ld = length(vLP.xz - vec2(sin(lb), cos(lb)) * 2.25);
  totalEmissiveRadiance += uNight * vec3(0.35, 0.85, 0.9) * exp(-ld * ld / 0.09);
}`);
  };
  m.customProgramCacheKey = () => 'mvw-fountain-water';
  return m;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
let app, mesh = null, geo = null, mat = null, cap = 0;
/** Every fountain in the world: { x, y, z, yaw }. */
function fountains() {
  const W = S.world, out = [];
  for (const B of W.buildings || []) {
    if (!B || B.gone || B.type !== 'park') continue;
    for (const it of W.levels[B.lv[0]]?.items || []) if (it.t === 'fountain') { const w = toWorld(B, it.x, it.z); out.push({ x: w.x, y: floorAt(B, 0), z: w.z, yaw: bRot(B) + (it.r || 0) }); }
  }
  for (const d of W.decorations || []) if (d.t === 'fountain') out.push({ x: d.x, y: app.decor ? app.decor.y(d.x, d.z) : 0, z: d.z, yaw: d.r || 0 });
  return out;
}
function rebuild() {
  const list = fountains();
  if (!geo) { geo = waterGeometry(); mat = waterMaterial(); }
  if (!mesh || list.length > cap) {
    if (mesh) { app.stage.scene.remove(mesh); mesh.dispose(); }
    cap = Math.max(8, list.length * 2);
    mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.name = 'fountain-water'; mesh.renderOrder = 2; mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
    app.stage.scene.add(mesh);
  }
  list.forEach((o, k) => { _q.setFromAxisAngle(_up, o.yaw); _p.set(o.x, o.y, o.z); mesh.setMatrixAt(k, _m.compose(_p, _q, _s)); });
  mesh.count = list.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.visible = list.length > 0;
}
export function init(a) {
  app = a;
  rebuild();
  // compiled now, with the world's shaders, rather than as a hitch when the first fountain comes into view
  app.stage.renderer.compileAsync?.(mesh, app.stage.camera, app.stage.scene)?.catch?.(() => {});
  bus.on('world', () => rebuild());
  bus.on('decor', () => setTimeout(rebuild, 0));   // after the decorations' own layer has its ground heights
  app.fountains = { rebuild, list: fountains };
}
