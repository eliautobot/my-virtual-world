// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Baked ground materials (render flag 'bake', core/render-flags.js; the reference renderer bakes its procedural
// materials once at start and only samples them after): the ground detail that cost the most per pixel -
// render/ground-detail.js's rock plates (gRockPlane), loose stones and river pebbles (gStones), sand ripples and shells,
// the meadow's fine grain and wild-flower specks (gDots) - drawn once into a stack of tiling textures (a texture array,
// mipmapped, so far ground fades to its average by itself instead of shimmering). Each layer is the same pattern as the
// per-pixel version, laid out to repeat seamlessly across its tile (its noise and cells wrap); the ground shader samples
// it twice, placed differently, and blends the two by a slow noise so the repeat never shows.
//   layer 0 ROCK   tile 32 m  (rock plates, joints 3.2 m)   r tone · g crack · b height
//   layer 1 CLIFF  tile 65 m  (cliff blocks, joints 6.5 m)  r tone · g crack · b height
//   layer 2 STONES 64 cells   (scree 0.6 m, pebbles 0.3 m)  r stone (disc) · g dome · b the stone's id
//   layer 3 SAND   tile 16 m                                 r ripple · g shell
//   layer 4 MEADOW tile 10 m                                 r fine grain · g flower speck · b its id
//   layer 5 MEADOW tile 10 m (the second, larger specks)     r speck · g its id
// Heights are packed: h (m) = (b − 0.45) · 0.24 · joint spacing.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const BAKE = { ROCK: 0, CLIFF: 1, STONES: 2, SAND: 3, MEADOW: 4, MEADOW2: 5, tiles: { rock: 32, cliff: 65, sand: 16, meadow: 10, stoneCells: 64 } };
const LAYERS = 6;

const FRAG = /* glsl */`
precision highp float;
uniform int uLayer;
uniform float uTexel;   // one texel in uv
varying vec2 vUv;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// value noise whose lattice repeats every per cells (as ground-detail.js gNoise, but seamless across the tile)
float pn(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  vec2 a = mod(i, per), b = mod(i + 1.0, per);
  return mix(mix(h12(a), h12(vec2(b.x, a.y)), f.x), mix(h12(vec2(a.x, b.y)), h12(b), f.x), f.y);
}
// gRockPlane in tile space: joints along the tile's axes (the shader turns the tile to the joints' real angles), T w-units
// across (w = metres / joint spacing s); returns tone, crack, height (m)
vec3 rockPlane(vec2 uv, float s, float fgW) {
  const float T = 10.0;
  vec2 w = uv * T;
  float ja = w.x * 1.1 + pn(w * 0.5, vec2(5.0)) * 1.7, jb = w.y * 0.7 + pn(w * 0.5 + 7.0, vec2(5.0)) * 1.7;
  vec2 cell = mod(floor(vec2(ja, jb)), vec2(11.0, 7.0)); float id = h12(cell + 3.3), id2 = h12(cell + 8.1);
  float ea = 11.0 * uTexel, eb = 7.0 * uTexel, cw = 0.018, wa = max(cw, ea * 0.8), wb = max(cw, eb * 0.8);
  float ca = smoothstep(0.5 - wa - ea * 0.5, 0.5 - wa + ea * 0.5, abs(fract(ja) - 0.5)) * (cw / wa) * smoothstep(0.52, 0.72, pn(vec2(mod(floor(ja + 0.5), 11.0) * 3.7, w.y * 0.7), vec2(64.0, 7.0)));
  float cb = smoothstep(0.5 - wb - eb * 0.5, 0.5 - wb + eb * 0.5, abs(fract(jb) - 0.5)) * (cw / wb) * smoothstep(0.58, 0.76, pn(vec2(mod(floor(jb + 0.5), 7.0) * 5.1, w.x * 0.7), vec2(64.0, 7.0)));
  float crack = max(ca, cb);
  float mott = pn(w * 1.7, vec2(17.0)) * 0.5 + pn(w * 4.1 + 5.0, vec2(41.0)) * 0.3 + pn(w * 9.0 + 9.0, vec2(90.0)) * 0.2;
  float g1 = floor(2.3 * s * T + 0.5), g2 = floor(6.1 * s * T + 0.5), g3 = floor(15.0 * s * T + 0.5);
  float grain = (pn(uv * g1, vec2(g1)) * 0.5 + pn(uv * g2 + 4.0, vec2(g2)) * 0.3) / 0.8 * 0.75 + 0.5 * 0.25;
  float fg = mix(0.5, pn(uv * g3, vec2(g3)), fgW);
  float fa = fract(ja), fb2 = fract(jb), win = sin(3.1416 * fa) * sin(3.1416 * fb2);
  float tilt = ((fa - 0.5) * (id - 0.5) + (fb2 - 0.5) * (id2 - 0.5) + 0.15) * win;
  return vec3(0.5 + (id - 0.5) * 0.1 + (mott - 0.5) * 0.75 + (grain - 0.5) * 0.5 + (fg - 0.5) * 0.15, crack * 0.8, tilt * 0.2 * s + (grain - 0.5) * 0.06 + (fg - 0.5) * 0.01);
}
vec4 packRock(vec3 r, float s) { return vec4(clamp(r.x, 0.0, 1.0), clamp(r.y, 0.0, 1.0), clamp(r.z / (0.24 * s) + 0.45, 0.0, 1.0), 1.0); }
// gVor + gStones on a grid of n cells that wraps: (disc, dome, id)
vec3 stones(vec2 uv, float n) {
  vec2 p = uv * n, i = floor(p), f = fract(p);
  float d1 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), c = mod(i + g, n), r = g + vec2(h12(c), h12(c + 19.7)) * 0.8 + 0.1 - f;
    float d = dot(r, r);
    if (d < d1) { d1 = d; id = h12(c + 7.3); }
  }
  d1 = sqrt(d1);
  float rr = 0.24 + 0.17 * fract(id * 7.13), e = n * uTexel * 1.2;
  return vec3(1.0 - smoothstep(rr - e, rr + e, d1), sqrt(clamp(1.0 - d1 * d1 / (rr * rr), 0.0, 1.0)), id);
}
// gDots on n cells that wrap: (disc, id); r: radius in cells
vec2 dots(vec2 uv, float n, float r, float seed) {
  vec2 q = uv * n, i = floor(q), f = fract(q) - 0.5, c = mod(i, n);
  float id = h12(c + seed);
  vec2 j = (vec2(h12(c + seed + 7.1), h12(c + seed + 3.7)) - 0.5) * (1.0 - 2.0 * r);
  float d = length(f - j), e = n * uTexel * 1.2;
  return vec2(1.0 - smoothstep(r - e, r + e, d), id);
}
void main() {
  vec2 uv = vUv;
  vec4 o = vec4(0.0, 0.0, 0.0, 1.0);
  if (uLayer == 0) o = packRock(rockPlane(uv, 3.2, 1.0), 3.2);
  else if (uLayer == 1) o = packRock(rockPlane(uv, 6.5, 0.0), 6.5);
  else if (uLayer == 2) o = vec4(stones(uv, 64.0), 1.0);
  else if (uLayer == 3) {
    // sand: ripples ~0.9 m apart (18 across 16 m) warped by slow noise; a shell here and there (23 cells of 0.7 m)
    float warp = pn(uv * 1.0, vec2(1.0)) * 4.0 + pn(uv * 5.0, vec2(5.0)) * 0.8;
    float ph = uv.x * 6.28318 * 18.0 + warp * 3.0;
    float rip = (sin(ph) + 0.3 * sin(ph * 2.0 + 1.0)) * 0.4 + 0.5;
    vec2 sh = dots(uv, 23.0, 0.06, 71.0);
    o = vec4(rip, sh.x * step(sh.y, 0.05), 0.0, 1.0);
  } else if (uLayer == 4) {
    vec2 a = dots(uv, 32.0, 0.17, 1.0);
    o = vec4(pn(uv * 17.0 + 13.0, vec2(17.0)), a.x, a.y, 1.0);
  } else {
    vec2 b = dots(uv, 21.0, 0.13, 2.0);
    o = vec4(b.x, b.y, 0.0, 1.0);
  }
  gl_FragColor = o;
}`;

/**
 * Draws the layers once (a few milliseconds of GPU at start) and returns the texture array.
 * size: texels across a tile (1024 on High, 512 elsewhere).
 */
export function bakeGround(renderer, size = 1024) {
  const rt = new THREE.WebGLArrayRenderTarget(size, size, LAYERS, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false });
  const tex = rt.texture;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const mat = new THREE.ShaderMaterial({
    uniforms: { uLayer: { value: 0 }, uTexel: { value: 1 / size } },
    vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FRAG, depthTest: false, depthWrite: false,
  });
  const quad = new FullScreenQuad(mat), prev = renderer.getRenderTarget(), t0 = performance.now();
  for (let L = 0; L < LAYERS; L++) { mat.uniforms.uLayer.value = L; renderer.setRenderTarget(rt, L); quad.render(renderer); }
  renderer.setRenderTarget(prev);
  quad.dispose(); mat.dispose();
  return { texture: tex, target: rt, size, ms: performance.now() - t0 };
}
