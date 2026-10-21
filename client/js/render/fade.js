// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Dithered cross-fades (2026-10-03: "a lot of popping in and out ... it should be a smooth transition"): a mesh
// fading in draws a growing share of its pixels, picked by a fixed screen pattern, while the mesh it replaces draws
// exactly the other pixels - so for the third of a second they overlap, every pixel comes from one of them: no blending,
// no doubled depth, nothing to sort. The same pattern fades scattered trees and grass in as they arrive.
import * as THREE from 'three';

/** Seconds a fade takes. */
export const FADE_S = 0.35;

/** The screen pattern (interleaved gradient noise): an even spread of thresholds 0..1 over neighbouring pixels. */
export const FADE_GLSL = /* glsl */`
float fadeNoise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

/**
 * Makes a material fadeable. uniform (optional): a { value: Vector2 } shared by several materials that fade together
 * (a terrain tile's ground and its countryside); x: progress 0..1, y: +1 fading in, −1 fading out, 0 steady.
 */
export function fadeable(material, uniform = { value: new THREE.Vector2(1, 0) }) {
  material.userData.fade = uniform;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    sh.uniforms.uFade = uniform;
    sh.fragmentShader = 'uniform vec2 uFade;\n' + FADE_GLSL + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (uFade.y != 0.0) { float fh = fadeNoise(gl_FragCoord.xy); if (uFade.y > 0.0 ? fh >= uFade.x : fh < uFade.x) discard; }`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|fade`;
  return material;
}

/**
 * Where finer tiles are shown over a coarser one (render/terrain.js: each finer tile shows as soon as it is ready, the
 * coarser one stands in only for the rest - 2026-10-04, after a jump the near tiles waited for the whole region), the
 * coarser one leaves out the pixels the finer one draws: a grid of HOLE_N x HOLE_N cells over the tile, each RG = the
 * share of the cell's pixels the finer tile draws (0..1) and whether it is fading in (1) or out (0) - the same screen
 * pattern as the fades, so the two share every pixel exactly. hole: { tex: { value }, rect: { value: Vector4(x0, z0,
 * size, on) } }.
 */
export const HOLE_N = 32;
export function holeUniforms() {
  const data = new Uint8Array(HOLE_N * HOLE_N * 2), tex = new THREE.DataTexture(data, HOLE_N, HOLE_N, THREE.RGFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  return { tex: { value: tex }, rect: { value: new THREE.Vector4(0, 0, 1, 0) }, data };
}
export function holeable(material, hole) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    sh.uniforms.uHole = hole.tex; sh.uniforms.uHoleRect = hole.rect;
    sh.vertexShader = 'varying vec2 vHoleW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vHoleW = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = 'uniform sampler2D uHole;\nuniform vec4 uHoleRect;\nvarying vec2 vHoleW;\n' + FADE_GLSL.replace('fadeNoise', 'holeNoise') + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (uHoleRect.w > 0.5) { vec2 hc = texture2D(uHole, (vHoleW - uHoleRect.xy) / uHoleRect.z).rg; if (hc.x > 0.0) { float hn = holeNoise(gl_FragCoord.xy); if (hc.y > 0.5 ? hn < hc.x : hn >= 1.0 - hc.x) discard; } }`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|hole`;
  return material;
}
