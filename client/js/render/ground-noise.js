// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The ground's random texture (render flag 'noise', core/render-flags.js): 256² RGBA bytes from a fixed seed, made the
// same in the page (render/ground-detail.js: the shader looks it up) and in the terrain worker (render/terrain.worker.js:
// flowers and grass tufts stand where the shader draws their drifts and tints). x: value noise; y: hashes.
let bytes = null;
export function noiseBytes() {
  if (bytes) return bytes;
  let s = 0x9e3779b9;
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  bytes = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(rnd() * 256);
  return bytes;
}
const m256 = v => ((v % 256) + 256) % 256;
const texel = (x, y, c) => noiseBytes()[(m256(y) * 256 + m256(x)) * 4 + c] / 255;
/** The shader's gH21 with the texture (texelFetch of channel y). */
export function nH21(px, py) {
  const fx = Math.floor((px - Math.floor(px)) * 10), fy = Math.floor((py - Math.floor(py)) * 10);
  return texel(Math.floor(px) + fx * 37, Math.floor(py) + fy * 91, 1);
}
/** The shader's gNoise with the texture: the four corners of channel x blended with the smoothstep fade. */
export function nNoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py); let fx = px - ix, fy = py - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = texel(ix, iy, 0), b = texel(ix + 1, iy, 0), c = texel(ix, iy + 1, 0), e = texel(ix + 1, iy + 1, 0);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
}
