// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// GLSL shared by the characters (render/characters.js) and the things they hold (render/char-props.js): the
// appearance texture's lookups, and the baked clips' skinning sampled with frame interpolation.
import { TRIPO_CLIPS } from './charClips.js';

const NCL = TRIPO_CLIPS.length, NCL2 = Math.ceil(NCL / 2);
/**
 * A character's clips for SKIN_GLSL's uClip: (frame offset, length) for each, two clips to a vec4 - a vec4 a slot, where
 * two float arrays took a slot an element each (2026-10-14: 71 clips in 36 slots, not 142; phones give a vertex shader
 * as few as 256).
 */
export function packClips(off, len) {
  const a = new Float32Array(NCL2 * 4);
  for (let k = 0; k < NCL; k++) { a[k * 2] = off[k]; a[k * 2 + 1] = len[k]; }
  return a;
}
export const COMMON = /* glsl */`
uniform sampler2D uApp;
vec4 chAppI(int a, int k) { return texelFetch(uApp, ivec2((a & 127) * 8 + k, a >> 7), 0); }
int chSty(float v) { return int(v * 255.0 + 0.5); }
`;
/** The baked clips' skinning, sampled (shared with the things characters hold: render/char-props.js). */
export const SKIN_GLSL = /* glsl */`
uniform sampler2D uAnim;
uniform vec4 uClip[${NCL2}];
vec2 chClip(int c) { vec4 q = uClip[c >> 1]; return (c & 1) == 0 ? q.xy : q.zw; }
mat4 chFetch(int fr, int b) {
  int i = (fr * ${65} + b) * 3;
  int W = textureSize(uAnim, 0).x;
  vec4 r0 = texelFetch(uAnim, ivec2(i % W, i / W), 0);
  vec4 r1 = texelFetch(uAnim, ivec2((i + 1) % W, (i + 1) / W), 0);
  vec4 r2 = texelFetch(uAnim, ivec2((i + 2) % W, (i + 2) / W), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
// (a clip's length is stored negative when the arm calibration is left off for it: charClips.js TRIPO_EXACT)
float chRigK(int c) { return chClip(c).y < 0.0 ? 0.0 : 1.0; }
mat4 chBoneAt(int c, float phase, int b) {
  vec2 cl = chClip(c);
  float L = abs(cl.y);
  float f = fract(phase) * L;
  int f0 = int(f);
  float t = f - float(f0);
  int n = int(L + 0.5);
  int o = int(cl.x + 0.5);
  return chFetch(o + f0 % n, b) * (1.0 - t) + chFetch(o + (f0 + 1) % n, b) * t;
}
vec3 chRot(vec3 p) { float c = cos(iPos.w), s = sin(iPos.w); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }
`;
export const APP_GLSL = COMMON;
