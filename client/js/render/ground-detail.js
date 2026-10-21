// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The island ground's close detail (the design review 2026-10-03: "the terrain details are way lacking"), drawn to the pixel
// in the terrain's own material, so it costs no geometry: farm fields with their crops in rows, tram lines, headlands and
// furrows, hedges and dry-stone walls along their edges (shared/farms.js, mirrored exactly below); meadows of grass with
// patches of wild flowers that colour the land from afar; woodland floor; mountain rock; snow; sand; river pebbles.
// the owner's notes the same day ("more natural, not lego/bands"; "fluffy snow"): nothing is drawn as ruled lines - rock is
// plates of stone with cracks between them, each plate tilted its own way and seen in the face's own plane; sand has soft
// wind ripples in patches; crop rows are plants whose rows wander and thin; river banks are pebbles; snow lies in soft
// pillows with a thick rounded lip where it ends, blue in its hollows and lit through. Fine patterns fade to their
// average colour as they shrink below a pixel (no shimmer), and everything beyond ~2 km is left to the vertex colours.
// Which detail applies comes from the terrain worker per vertex (aSurfA: farm, rock, snow, forest; aSurfB: sand, wet),
// from shared/biome.js.
import * as THREE from 'three';
import { GU } from './scene.js';
import { rf } from '../core/render-flags.js';
import { noiseBytes } from './ground-noise.js';
import { SNOW_LINE } from '/shared/terrain.js';

/** shared/farms.js in GLSL: the same hash, farm space, fields and boundaries (keep the two in step). */
export const FARM_GLSL = /* glsl */`
float fHash(int x, int z, int s) {
  uint h = (uint(x) * 0x27d4eb2du) ^ (uint(z) * 0x165667b1u) ^ (uint(s) * 0x2545f491u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  h ^= h >> 15u;
  return float(h) * (1.0 / 4294967296.0);
}
vec2 toFarm(vec2 p) {
  vec2 q = p;
  for (int k = 0; k < 4; k++) {
    float ou = 38.0 * sin(q.y * 0.0021 + 1.3) + 22.0 * sin((q.x + q.y) * 0.0013 + 4.1);
    float ov = 30.0 * sin(q.x * 0.0017 + 0.4) + 18.0 * sin((q.x - q.y) * 0.0011 + 2.2);
    q = p - vec2(ou, ov);
  }
  return q;
}
int cropOf(float r) {
  if (r < 0.15) return 0; if (r < 0.24) return 1; if (r < 0.32) return 2; if (r < 0.5) return 3; if (r < 0.57) return 4;
  if (r < 0.66) return 5; if (r < 0.76) return 6; if (r < 0.82) return 7; if (r < 0.87) return 8; if (r < 0.91) return 9; return 10;
}
int edgeKind(float t) { return t < 0.52 ? 0 : t < 0.7 ? 1 : t < 0.8 ? 2 : 3; }
float edgeHalf(int k) { return k == 0 ? 1.5 : k == 1 ? 0.15 : k == 2 ? 0.45 : 0.0; }
float edgeGrass(int k) { return k == 0 ? 1.6 : k == 1 ? 1.4 : k == 2 ? 1.2 : 2.2; }
struct Field { int row; int fx; float lu; float lv; float w; float r; int crop; bool along; };
Field fieldOf(vec2 f) {
  Field F;
  float rv = f.y + 9000.0, rowf = floor(rv / 56.0);
  F.row = int(rowf); F.lv = rv - rowf * 56.0;
  F.w = 40.0 + fHash(F.row, 1, 4244) * 70.0;
  float ru = f.x + 5000.0 + fHash(F.row, 0, 4243) * 90.0, fxf = floor(ru / F.w);
  F.fx = int(fxf); F.lu = ru - fxf * F.w;
  F.r = fHash(F.fx, F.row, 4242); F.crop = fHash(F.fx, F.row, 4300) < 0.055 ? 6 : cropOf(F.r); F.along = fHash(F.fx, F.row, 4250) < 0.55;   // a farmstead's field: grass
  return F;
}
`;

const DETAIL_GLSL = /* glsl */`
uniform float uGTime, uGDay, uGSea;
#ifdef GD_MAP
uniform sampler2D uGMA, uGMB;
uniform vec4 uGMR;   // the tile's ground map: x0, z0, size (m), texels across
#endif
uniform vec4 uGWind, uGSway;
varying vec3 vGPos;
varying vec4 vSurfA, vSurfB;
${FARM_GLSL}
#ifdef GD_NTEX
// Randomness looked up in a 256² texture (core/render-flags.js 'noise'; the reference renderer's way): one fetch where
// the arithmetic hash took a dozen operations and value noise four of them. The hash reads exact texels (a fractional
// offset in its argument - the seeds such as + 7.1 - jumps far across the texture, so seeds never line up); value noise
// lets the texture's own filtering blend the four corners, with the smoothstep fade put into the coordinate.
uniform sampler2D uGNoise;
float gH21(vec2 p) { vec2 q = floor(p) + floor(fract(p) * 10.0) * vec2(37.0, 91.0); return texelFetch(uGNoise, ivec2(mod(q, 256.0)), 0).y; }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return textureLod(uGNoise, (mod(i, 256.0) + f + 0.5) / 256.0, 0.0).x;
}
#else
float gH21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gH21(i), gH21(i + vec2(1.0, 0.0)), f.x), mix(gH21(i + vec2(0.0, 1.0)), gH21(i + vec2(1.0, 1.0)), f.x), f.y);
}
#endif
// A stripe of width fill·period every period along x, soft-edged and fading to its average (fill) once too fine to see.
float gStripe(float x, float period, float fill, float px) {
  px = max(px * 0.35, fwidth(x));   // the coordinate's own footprint: no moiré where the rows run away from the eye
  float d = abs(fract(x / period) - 0.5) * period, hw = fill * period * 0.5, e = max(px, 1e-3);
  return mix(fill, 1.0 - smoothstep(hw - e, hw + e, d), smoothstep(period * 0.7, period * 0.22, px));
}
// Rows of plants seen from above: rows period apart whose width wanders along them (fill ± wob) - never ruled lines.
float gRows(float x, float along, float period, float fill, float wob, float px) {
  float ri = floor(x / period);
  float f = fill + (gNoise(vec2(along * 0.9, ri * 7.1)) - 0.5) * wob + (gNoise(vec2(along * 3.7, ri * 3.3 + 50.0)) - 0.5) * wob * 0.6;
  return gStripe(x, period, clamp(f, 0.05, 0.95), px);
}
// Single plants in rows (period apart across, gap apart along): each a soft round clump of its own size, nudged off the
// line; rd is how far from the clump's middle (0..1). Fades to the clumps' cover once too fine.
float gPlants(float x, float along, float period, float gap, float r, float px, float seed, out float id, out float rd) {
  float ri = floor(x / period), fa = x / period - ri - 0.5;
  float a2 = along / gap + gH21(vec2(ri, seed)) * 7.0, pi = floor(a2), fb = a2 - pi - 0.5;
  id = gH21(vec2(ri * 17.0 + pi, seed + 3.0));
  vec2 j = (vec2(gH21(vec2(pi, ri + seed)), gH21(vec2(ri, pi - seed))) - 0.5) * vec2(0.2, 0.3);
  float m = min(period, gap), rr = r * m * (0.75 + 0.5 * id), d = length(vec2((fa - j.x) * period, (fb - j.y) * gap)), e = max(px, 1e-3);
  rd = clamp(d / rr, 0.0, 1.0);
  return mix(3.14 * rr * rr / (period * gap), 1.0 - smoothstep(rr - e, rr + e, d), smoothstep(m * 0.8, m * 0.25, px));
}
// Round dots on a grid (cell size c, radius r as a fraction of the cell), jittered; fades to their coverage when tiny.
float gDots(vec2 p, float c, float r, float px, float seed, out float id) {
  vec2 q = p / c, i = floor(q), f = fract(q) - 0.5;
  id = gH21(i + seed);
  vec2 j = (vec2(gH21(i + seed + 7.1), gH21(i + seed + 3.7)) - 0.5) * (1.0 - 2.0 * r);
  float d = length(f - j) * c, rr = r * c, e = max(px, 1e-3);
  return mix(3.14 * r * r, 1.0 - smoothstep(rr - e, rr + e, d), smoothstep(c * 0.8, c * 0.25, px));
}
// Cells of a jittered grid (size 1): (distance to the nearest point, distance to the cell's edge (≈ F2 − F1), the cell's
// id); toC: from here to the nearest point (to tilt each cell as its own facet).
vec3 gVor(vec2 p, out vec2 toC) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0; toC = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), r = g + vec2(gH21(i + g), gH21(i + g + 19.7)) * 0.8 + 0.1 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = gH21(i + g + 7.3); toC = r; } else if (d < d2) d2 = d;
  }
  d1 = sqrt(d1);
  return vec3(d1, (sqrt(d2) - d1) * 0.5, id);
}
// Smooth gradient noise (quintic fade: no creases along its grid when used as relief - value noise's showed as streaks
// and lines in the lighting), about 0..1.
float gSoft(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a0 = gH21(i) * 6.2832, a1 = gH21(i + vec2(1.0, 0.0)) * 6.2832, a2 = gH21(i + vec2(0.0, 1.0)) * 6.2832, a3 = gH21(i + vec2(1.0, 1.0)) * 6.2832;
  float v = mix(mix(dot(vec2(cos(a0), sin(a0)), f), dot(vec2(cos(a1), sin(a1)), f - vec2(1.0, 0.0)), u.x),
                mix(dot(vec2(cos(a2), sin(a2)), f - vec2(0.0, 1.0)), dot(vec2(cos(a3), sin(a3)), f - vec2(1.0, 1.0)), u.x), u.y);
  return 0.5 + 0.75 * v;
}
vec3 gLin(vec3 c) { return c * c * (0.8 + 0.2 * c); }   // sRGB → linear, close enough for ground colours
// A noise layer of f cycles per metre: at full strength while it spans several pixels, fading to its middle before it
// would shimmer.
float gO(float n, float f, float px) { return 0.5 + (n - 0.5) * smoothstep(0.5, 0.15, px * f); }
// Rock in one plane (q in metres; s: the joints' spacing): bedrock split by two sets of joints, each set roughly
// parallel and wavy, its cracks opening in runs and closing again; the blocks between them each tilted a little and a
// shade of their own; mottled weathering and grain. Returns (tone around 0.5, crack 0..1, height m).
vec3 gRockPlane(vec2 q, float s, float px) {
  vec2 w = q / s;
  float ja = dot(w, vec2(0.83, 0.56)) * 1.1 + gNoise(w * 0.5) * 1.7, jb = dot(w, vec2(-0.48, 0.88)) * 0.7 + gNoise(w * 0.5 + 7.0) * 1.7;
  vec2 cell = floor(vec2(ja, jb)); float id = gH21(cell + 3.3), id2 = gH21(cell + 8.1);
  // a crack never thinner than a pixel: where it would be, it widens to one and pales in step (no dotted lines)
  float ea = max(fwidth(ja), 1e-4), eb = max(fwidth(jb), 1e-4), cw = 0.018, wa = max(cw, ea * 0.8), wb = max(cw, eb * 0.8);
  float ca = smoothstep(0.5 - wa - ea * 0.5, 0.5 - wa + ea * 0.5, abs(fract(ja) - 0.5)) * (cw / wa) * smoothstep(0.52, 0.72, gNoise(vec2(floor(ja + 0.5) * 3.7, dot(w, vec2(-0.56, 0.83)) * 0.7)));
  float cb = smoothstep(0.5 - wb - eb * 0.5, 0.5 - wb + eb * 0.5, abs(fract(jb) - 0.5)) * (cw / wb) * smoothstep(0.58, 0.76, gNoise(vec2(floor(jb + 0.5) * 5.1, dot(w, vec2(0.88, 0.48)) * 0.7)));
  float vis = smoothstep(0.35, 0.12, max(ea, eb));
  float crack = max(ca, cb) * vis;
  float mott = gNoise(w * 1.7) * 0.5 + gNoise(w * 4.1 + 5.0) * 0.3 + gNoise(w * 9.0 + 9.0) * 0.2;
  float grain = (gO(gNoise(q * 2.3), 2.3, px) * 0.5 + gO(gNoise(q * 6.1 + 4.0), 6.1, px) * 0.3) / 0.8 * 0.75 + 0.5 * 0.25;
  float fg = gO(gNoise(q * 15.0), 15.0, px);
  // each block a little tilted and domed, meeting its neighbours at the joints (no step there: no lines of light)
  float fa = fract(ja), fb2 = fract(jb), win = sin(3.1416 * fa) * sin(3.1416 * fb2);
  float tilt = ((fa - 0.5) * (id - 0.5) + (fb2 - 0.5) * (id2 - 0.5) + 0.15) * win * vis;
  return vec3(0.5 + (id - 0.5) * 0.1 + (mott - 0.5) * 0.75 + (grain - 0.5) * 0.5 + (fg - 0.5) * 0.15, crack * 0.8, tilt * 0.2 * s + (grain - 0.5) * 0.06 + (fg - 0.5) * 0.01);
}
// Loose stones lying on grit (cell size c): round, each its own size and shade, some cells bare; returns (cover, dome,
// id) - cover fades to its average once the stones are too small to see.
vec3 gStones(vec2 p, float c, float fill, float px) {
  vec2 toC; vec3 v = gVor(p / c, toC);
  float rr = 0.24 + 0.17 * fract(v.z * 7.13), e = max(px / c, 0.01);
  float on = step(v.z, fill) * (1.0 - smoothstep(rr - e, rr + e, v.x));
  float vis = smoothstep(c * 0.8, c * 0.2, px);
  return vec3(mix(fill * 0.55, on, vis), sqrt(clamp(1.0 - v.x * v.x / (rr * rr), 0.0, 1.0)) * on * vis, v.z);
}
#ifdef GD_BAKE
// Baked layers (render/ground-bake.js, render flag 'bake'): sampled with the coordinates' own derivatives (worked out
// once, outside any branch, so mip levels never jump at a branch's edge), twice - the second turned and shifted -
// blended by a slow noise so a tile's repeat never shows; k: the blend's half-width (narrow for stones and specks).
uniform highp sampler2DArray uGBake;
vec4 gBakeAt(float L, vec2 q, vec2 dx, vec2 dy, float T) { return textureGrad(uGBake, vec3(q / T, L), dx / T, dy / T); }
vec4 gBake2(float L, vec2 q, vec2 dx, vec2 dy, float T, float k) {
  const mat2 R = mat2(0.8, 0.6, -0.6, 0.8);
  vec4 a = gBakeAt(L, q, dx, dy, T), b = gBakeAt(L, R * q + T * vec2(0.37, 0.71), R * dx, R * dy, T);
  return mix(a, b, smoothstep(0.5 - k, 0.5 + k, gNoise(q / T * 0.9 + L * 13.7)));
}
// gRockPlane from its baked layer (L 0: plates, 3.2 m joints, 32 m tile; L 1: cliff blocks, 6.5 m, 65 m): the tile
// turned to the joints' angle; (tone, crack, height m)
vec3 gRockBaked(float L, vec2 q, vec2 dx, vec2 dy, float T, float s) {
  const mat2 J = mat2(0.83, -0.56, 0.56, 0.83);
  vec4 t = gBake2(L, J * q, J * dx, J * dy, T, 0.2);
  return vec3(t.r, t.g, (t.b - 0.45) * 0.24 * s);
}
// gStones from the baked layer (64 cells a tile): (cover, dome, id)
vec3 gStonesBaked(vec2 q, vec2 dx, vec2 dy, float c, float fill, float px) {
  vec4 t = gBake2(2.0, q, dx, dy, c * 64.0, 0.03);
  float on = step(t.b, fill) * t.r, vis = smoothstep(c * 0.8, c * 0.2, px);
  return vec3(mix(fill * 0.55, on, vis), t.g * on * vis, t.b);
}
#endif
`;

/** The detail for one fragment: base is the vertex colour (linear); returns the coloured ground and a bump height.
 *  2026-10-03 ("smooth ... cozy disney-3d, a bit cartoon but semi-realistic"): soft colour that changes slowly
 *  over tens of metres and is the same at every distance (no ring where close detail fades, no tile's edge), quiet
 *  close detail, the mountains' rock and snow worked out per pixel, sunlight dancing on the shallow sea floor. */
const DETAIL_MAIN = /* glsl */`
  float gBump = 0.0, gBumpL = 0.0, gSnowH = 0.0;   // fine relief (fades out soon), large relief (rock, swells), snow's swells
  vec3 gGlow = vec3(0.0);
  {
    vec2 P = vGPos.xz;
    float px = length(fwidth(P));
    #ifdef GD_BAKE
    vec3 gDX = dFdx(vGPos), gDY = dFdy(vGPos);   // (for the baked layers' mip levels: here, outside every branch)
    #endif
    float farm = vSurfA.x, forest = vSurfA.w, sand = vSurfB.x, wet = vSurfB.y;
    #ifdef GD_MAP
    {
      // the tile's ground map (render/terrain.worker.js): colour and kinds of ground per texel, not per mesh corner
      vec2 uv = ((P - uGMR.xy) / uGMR.z * uGMR.w + 0.5) / (uGMR.w + 1.0);
      vec4 ma = texture2D(uGMA, uv), mb = texture2D(uGMB, uv);
      diffuseColor.rgb = ma.rgb * diffuse; forest = ma.a; farm = mb.r; sand = mb.g; wet = mb.b;
    }
    #endif
    vec3 base = diffuseColor.rgb, col = base;
    vec3 wn = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz);
    float slopeP = 1.0 - wn.y, near = 1.0 - smoothstep(0.55, 1.1, px);
    float land = clamp(1.0 - sand - wet, 0.0, 1.0) * (1.0 - farm);
    // ---------- soft colour over the land, the same at every distance: lush and sunny patches tens of metres across,
    // gentle swells of tone (the grass tufts follow the same, render/terrain.worker.js)
    float v1 = gNoise(P * 0.012 + vec2(3.0, -7.0)), v2 = gNoise(P * 0.05 + vec2(1.0, 2.0)), v3 = gNoise(P * 0.021 - 9.0);
    col *= mix(1.0, 0.93 + 0.12 * v1 + 0.06 * v2, land);
    col = mix(col, col * vec3(1.08, 1.05, 0.8), smoothstep(0.62, 0.9, v3) * 0.3 * land * (1.0 - forest));
    // ---------- the mountains, per pixel: bare rock on the steep ground and high up, snow above the snowline on all but
    // the steepest faces - from the height and the smooth normal, never from a coarse tile's corners
    float mtn = clamp(1.0 - farm - sand - wet, 0.0, 1.0);
    float L = ${SNOW_LINE.toFixed(1)} + (gNoise(P * 0.004 + 5.0) - 0.5) * 80.0, edgeN = gNoise(P * 0.045) * 0.6 + gNoise(P * 0.19) * 0.4;
    float rockP = max(smoothstep(0.34, 0.5, slopeP + (v2 - 0.5) * 0.06), smoothstep(L - 90.0, L - 30.0, vGPos.y)) * mtn;
    float snowP = smoothstep(L - 12.0, L + 12.0, vGPos.y + (edgeN - 0.5) * 18.0) * (1.0 - smoothstep(0.5, 0.64, slopeP + (edgeN - 0.5) * 0.12)) * mtn;
    if (px < 1.1) {
      float other = land * (1.0 - forest);
      // ---------- meadows and woodland floor: quiet close detail (blades too small to draw singly), wild flowers
      if (land > 0.02) {
        #ifdef GD_BAKE
        vec4 mA = gBake2(4.0, P, gDX.xz, gDY.xz, 10.0, 0.03);
        float fine = mA.r, clump = gO(gNoise(P * 0.33), 0.33, px);
        #else
        float fine = gO(gNoise(P * 1.7 + 13.0), 1.7, px), clump = gO(gNoise(P * 0.33), 0.33, px);
        #endif
        vec3 g = col * (0.97 + 0.06 * (fine - 0.5) + 0.06 * (clump - 0.5));
        // woodland floor: moss and leaf litter under the trees, darker and warmer, its edge uneven
        float fo = smoothstep(0.3, 0.75, forest + (clump - 0.5) * 0.5 + (v3 - 0.5) * 0.3) * 0.45;
        g = mix(g, col * mix(vec3(0.78, 0.72, 0.58), vec3(0.85, 1.0, 0.8), v2), fo);
        // wild flowers in drifts that colour the meadow from afar (the 3D clumps stand in them close by)
        float patchN = gNoise(P * 0.035 + vec2(17.0, -9.0)) * 0.7 + gNoise(P * 0.11 + 3.0) * 0.3;
        float drift = smoothstep(0.58, 0.8, patchN) * other;
        if (drift > 0.01) {
          float k1 = gNoise(P * 0.009 + 5.0), k2 = gNoise(P * 0.013 - 11.0);
          vec3 fc = mix(mix(vec3(0.95, 0.3, 0.25), vec3(1.0, 0.85, 0.3), smoothstep(0.35, 0.65, k1)), mix(vec3(0.5, 0.6, 0.98), vec3(0.8, 0.5, 0.9), smoothstep(0.35, 0.65, k1)), smoothstep(0.4, 0.7, k2));
          float id1, id2;
          #ifdef GD_BAKE
          id1 = mA.b;
          float cov = mA.g * step(id1, 0.15 + 0.7 * drift);
          #ifndef GD_LITE
          { const mat2 R2 = mat2(0.8, -0.6, 0.6, 0.8); vec4 mB = gBake2(5.0, R2 * P + 7.3, R2 * gDX.xz, R2 * gDY.xz, 10.0, 0.03); cov += mB.r * step(mB.g, 0.1 + 0.5 * drift) * 0.9; }
          #endif
          #else
          float cov = gDots(P, 0.31, 0.17, px, 1.0, id1) * step(id1, 0.15 + 0.7 * drift);
          #ifndef GD_LITE
          cov += gDots(P * mat2(0.8, 0.6, -0.6, 0.8) + 7.3, 0.47, 0.13, px, 2.0, id2) * step(id2, 0.1 + 0.5 * drift) * 0.9;
          #endif
          #endif
          vec3 fcol = mix(gLin(fc), gLin(vec3(0.98, 0.97, 0.92)), step(0.85, id1));
          g = mix(g, fcol, clamp(cov * drift * 1.3, 0.0, 0.6));
        }
        col = mix(col, g, land * near);
        gBump += (fine - 0.5) * 0.02 * other;
      }
      // ---------- sand: warm cream, soft swells, the faintest wind ripples close by, a shell here and there
      if (sand > 0.02) {
        #ifdef GD_BAKE
        const mat2 SR = mat2(0.62, -0.78, 0.78, 0.62);   // (the ripples run across the wind's usual way)
        vec4 sd = gBake2(3.0, SR * P, SR * gDX.xz, SR * gDY.xz, 16.0, 0.2);
        float ripA = smoothstep(0.35, 0.7, gNoise(P * 0.045 + 4.0)), rip = sd.r, big = gNoise(P * 0.02 + 7.0), shell = sd.g;
        #else
        float warp = gNoise(P * 0.08) * 4.0 + gNoise(P * 0.31) * 0.8;
        float ph = dot(P, vec2(0.62, 0.78)) * 7.0 + warp * 3.0;
        float ripA = smoothstep(0.35, 0.7, gNoise(P * 0.045 + 4.0)) * smoothstep(1.2, 0.4, fwidth(ph));
        float rip = (sin(ph) + 0.3 * sin(ph * 2.0 + 1.0)) * 0.4 + 0.5, big = gNoise(P * 0.02 + 7.0);
        float id; float shell = gDots(P, 0.7, 0.06, px, 71.0, id) * step(id, 0.05);
        #endif
        vec3 sc = col * (0.98 + 0.02 * (rip - 0.5) * ripA + 0.06 * (big - 0.5)) + shell * 0.08;
        col = mix(col, sc, sand * near);
        gBump += rip * ripA * 0.015 * sand; gBumpL += big * 0.15 * sand * near;
      }
      // ---------- river beds and banks: round pebbles packed in clean sand and silt
      if (wet > 0.02) {
        float en = gNoise(P * 0.15) * 0.65 + gO(gNoise(P * 0.6), 0.6, px) * 0.35, m = smoothstep(0.4, 0.62, wet + (en - 0.5) * 0.4);   // a softly wandering edge, never hairy
        #ifdef GD_BAKE
        vec3 pb = gStonesBaked(P + 41.0, gDX.xz, gDY.xz, 0.3, 0.22 + 0.28 * en, px);
        #else
        vec3 pb = gStones(P, 0.3, 0.22 + 0.28 * en, px);
        #endif
        vec3 sandy = gLin(vec3(0.7, 0.64, 0.5)) * (0.92 + 0.12 * en), mud = gLin(vec3(0.5, 0.45, 0.35));
        vec3 pc = gLin(mix(vec3(0.58, 0.56, 0.52), vec3(0.68, 0.65, 0.59), pb.z)) * (0.9 + 0.12 * pb.y);
        vec3 bank = mix(mix(sandy, mud, smoothstep(0.5, 0.9, wet)), pc, pb.x * 0.4 * (1.0 - 0.7 * smoothstep(0.8, 1.0, wet)));   // pebbles a quiet part of the bank, fewer in the bed
        gBump += pb.y * 0.03 * m;
        col = mix(col, bank, m * near + (1.0 - near) * m * 0.0);
      }
    }
    // ---------- rock: soft greys, cooler and darker on the cliffs and warmer on the ledges, broad gentle mottling;
    // close up faint joints and grain (plates of stone with cracks between, seen in the face's own plane)
    if (rockP > 0.01) {
      float m1 = gNoise(P * 0.018 + vGPos.y * 0.012), m2 = gNoise(P * 0.07 + 4.0);
      vec3 rc = gLin(mix(vec3(0.5, 0.5, 0.49), vec3(0.66, 0.64, 0.6), m1 * 0.7 + m2 * 0.3));
      rc *= mix(1.04, 0.86, smoothstep(0.4, 0.9, slopeP));
      if (px < 1.1) {
        vec3 rk = vec3(0.0);
        #if defined(GD_BAKE) && defined(GD_LITE)
        { vec3 an = abs(wn);
          if (an.y >= max(an.x, an.z)) rk = gRockBaked(0.0, P, gDX.xz, gDY.xz, 32.0, 3.2);
          else if (an.x > an.z) rk = gRockBaked(0.0, vec2(vGPos.z, vGPos.y * 1.4), vec2(gDX.z, gDX.y * 1.4), vec2(gDY.z, gDY.y * 1.4), 32.0, 3.2);
          else rk = gRockBaked(0.0, vec2(vGPos.x, vGPos.y * 1.4), vec2(gDX.x, gDX.y * 1.4), vec2(gDY.x, gDY.y * 1.4), 32.0, 3.2); }
        #elif defined(GD_BAKE)
        vec3 aw = pow(abs(wn), vec3(6.0)); aw /= aw.x + aw.y + aw.z;
        if (aw.y > 0.03) rk += gRockBaked(0.0, P, gDX.xz, gDY.xz, 32.0, 3.2) * aw.y;
        if (aw.x > 0.03) rk += gRockBaked(0.0, vec2(vGPos.z, vGPos.y * 1.4), vec2(gDX.z, gDX.y * 1.4), vec2(gDY.z, gDY.y * 1.4), 32.0, 3.2) * aw.x;
        if (aw.z > 0.03) rk += gRockBaked(0.0, vec2(vGPos.x, vGPos.y * 1.4), vec2(gDX.x, gDX.y * 1.4), vec2(gDY.x, gDY.y * 1.4), 32.0, 3.2) * aw.z;
        #elif defined(GD_LITE)
        // phones: the face's own plane only (its strongest axis) - one rock pattern a pixel, not up to three blended
        // (the ground's detail was a fifth to a quarter of a phone's frame on the hills, 2026-10-03: "very hot")
        vec3 an = abs(wn);
        rk = gRockPlane(an.y >= max(an.x, an.z) ? P : an.x > an.z ? vec2(vGPos.z, vGPos.y * 1.4) : vec2(vGPos.x, vGPos.y * 1.4), 3.2, px);
        #else
        vec3 aw = pow(abs(wn), vec3(6.0)); aw /= aw.x + aw.y + aw.z;
        if (aw.y > 0.03) rk += gRockPlane(P, 3.2, px) * aw.y;
        if (aw.x > 0.03) rk += gRockPlane(vec2(vGPos.z, vGPos.y * 1.4), 3.2, px) * aw.x;
        if (aw.z > 0.03) rk += gRockPlane(vec2(vGPos.x, vGPos.y * 1.4), 3.2, px) * aw.z;
        #endif
        rc *= mix(1.0, (0.95 + 0.22 * (rk.x - 0.5)) * (1.0 - 0.25 * rk.y), near);
        // loose stones on the gentler slopes
        float scr = smoothstep(0.42, 0.3, slopeP) * near * (1.0 - snowP);
        #ifdef GD_LITE
        scr *= smoothstep(0.3, 0.12, px);   // (phones: the loose stones only close by - farther off they are under a pixel)
        #endif   // (under the snow: none - their relief showed through it as rings)
        if (scr > 0.01) {
          #ifdef GD_BAKE
          vec3 st = gStonesBaked(P, gDX.xz, gDY.xz, 0.6, 0.55, px);
          #else
          vec3 st = gStones(P, 0.6, 0.55, px);
          #endif
          rc = mix(rc, gLin(mix(vec3(0.6, 0.59, 0.56), vec3(0.74, 0.72, 0.67), st.z)) * (0.9 + 0.15 * st.y), st.x * scr * 0.7);
          gBump += st.y * 0.04 * scr;
        }
        rc = mix(rc, rc * vec3(0.96, 1.05, 0.84), smoothstep(0.7, 0.88, gNoise(P * 0.3 + 31.0)) * 0.35 * (1.0 - slopeP) * near);   // lichen
        gBumpL += rk.z * 0.6 * near * (1.0 - snowP);
      }
      // cliffs (2026-10-03, on the phone: not layers - "grey dark wall ... angled carved rocks"): on the steep faces,
      // dark grey stone in big angular blocks - two sets of joints, each block a facet of its own leaning its own way
      // and a shade of its own, the cracks between them dark; wet streaks running down, moss in the damp. One plane, the
      // face's own (seen along its strongest axis), so it costs one rock pattern a pixel.
      float cliff = smoothstep(0.55, 0.85, slopeP) * (1.0 - snowP);
      if (cliff > 0.01) {
        vec2 fq = abs(wn.x) > abs(wn.z) ? vec2(vGPos.z, vGPos.y * 1.15) : vec2(vGPos.x, vGPos.y * 1.15);
        if (abs(wn.y) > max(abs(wn.x), abs(wn.z))) fq = P;
        #ifdef GD_BAKE
        vec2 fdx = abs(wn.x) > abs(wn.z) ? vec2(gDX.z, gDX.y * 1.15) : vec2(gDX.x, gDX.y * 1.15), fdy = abs(wn.x) > abs(wn.z) ? vec2(gDY.z, gDY.y * 1.15) : vec2(gDY.x, gDY.y * 1.15);
        if (abs(wn.y) > max(abs(wn.x), abs(wn.z))) { fdx = gDX.xz; fdy = gDY.xz; }
        vec3 bk = gRockBaked(1.0, fq, fdx, fdy, 65.0, 6.5);
        #else
        vec3 bk = gRockPlane(fq, 6.5, px);
        #endif
        vec3 bc = gLin(vec3(0.38, 0.38, 0.39)) * (0.72 + 0.5 * bk.x) * (1.0 - 0.5 * bk.y);
        float u = mix(vGPos.x, vGPos.z, step(abs(wn.z), abs(wn.x)));
        bc *= mix(1.0, 0.72, smoothstep(0.6, 0.86, gNoise(vec2(u * 0.5, vGPos.y * 0.03)) * 0.7 + gNoise(vec2(u * 2.1, vGPos.y * 0.1) + 5.0) * 0.3));
        bc = mix(bc, gLin(vec3(0.24, 0.34, 0.18)), smoothstep(0.6, 0.82, gNoise(vec2(u * 0.22, vGPos.y * 0.12) + 11.0)) * 0.35);
        rc = mix(rc, bc, cliff);
        gBumpL += bk.z * 2.2 * cliff * near;
      }
      col = mix(col, rc, rockP);
    }
    // ---------- snow: soft pillows and drifts, blue in its hollows, lit through (2026-10-03, phone: "smooth fluffy
    // snow", not harsh). Big rounded swells of a few metres to tens, no fine pattern; their relief is drawn at every
    // quality (cheap: three noise layers and the pixel's derivatives), the snow a little off pure white so it shades.
    if (snowP > 0.01) {
      float p1 = gSoft(P * 0.05 + 3.0), p2 = gSoft(P * mat2(0.8, 0.6, -0.6, 0.8) * 0.15 - 5.0), p3 = gO(gSoft(P * mat2(0.6, -0.8, 0.8, 0.6) * 0.42 + 9.0), 0.42, px);
      float pil = p1 * 0.55 + p2 * 0.3 + p3 * 0.15;
      vec3 sc = gLin(vec3(0.9, 0.92, 0.96)) * (0.95 + 0.06 * pil);
      sc = mix(sc * vec3(0.8, 0.87, 1.0), sc, smoothstep(0.22, 0.62, pil));   // blue in the hollows
      float glint = 0.0;
      #ifndef GD_LITE
      vec3 vd = normalize(vGPos - cameraPosition);
      glint = step(0.996, gH21(floor(P * 7.0) + floor(vd.xz * 9.0) * 31.0)) * smoothstep(0.06, 0.02, px) * uGDay;
      #endif
      col = mix(col, sc + glint * 0.5, snowP);
      gGlow += sc * 0.05 * snowP * uGDay;
      gSnowH = (p1 * 2.2 + p2 * 0.8 + p3 * 0.2) * snowP;
      gBumpL = mix(gBumpL, 0.0, snowP);   // (nothing of the ground under it shows through)
      gBump *= 1.0 - snowP;
    }
    // ---------- under the sea: sunlight dancing on the sand in a soft web of thin bright lines, wavering, drifting,
    // only in the shallows and only close by (from further off the water's own colour says it)
    float dw = uGSea - vGPos.y;
    if (dw > 0.02 && dw < 6.0 && px < 0.3) {
      vec2 toC; float t = uGTime;
      vec2 q = P * 0.8 + (vec2(gNoise(P * 0.35 + t * 0.12), gNoise(P * 0.35 - 7.0 - t * 0.1)) - 0.5) * 1.4;
      vec3 ca = gVor(q + vec2(t * 0.06, t * 0.04), toC);
      float e = max(fwidth(ca.y), 0.004), cs = 1.0 - smoothstep(0.0, 0.05 + e, ca.y);
      #ifndef GD_LITE
      vec3 cb = gVor(q * 1.3 * mat2(0.8, 0.6, -0.6, 0.8) - vec2(t * 0.05, -t * 0.04) + 7.0, toC);
      cs = cs * 0.6 + (1.0 - smoothstep(0.0, 0.05 + e, cb.y)) * 0.4;
      #endif
      float k = smoothstep(0.05, 0.5, dw) * (1.0 - smoothstep(1.5, 5.5, dw)) * smoothstep(0.3, 0.1, px) * (0.3 + 0.7 * uGDay);
      col += gLin(vec3(0.85, 0.98, 0.92)) * cs * 0.16 * k;
    }
    // farmland at every distance: each field its own crop's colour with crisp, smoothed edges (2026-10-03: from
    // further off the fields showed the terrain's coarse tiles); rows and lines fade to their average by themselves
    if (farm > 0.02) {
      vec2 fp = toFarm(P);
      Field F = fieldOf(fp);
      int eL = edgeKind(fHash(F.fx, F.row, 4260)), eR = edgeKind(fHash(F.fx + 1, F.row, 4260));
      int eB = edgeKind(fHash(F.row, int(floor((fp.x + 5000.0) / 90.0)), 4261)), eT = edgeKind(fHash(F.row + 1, int(floor((fp.x + 5000.0) / 90.0)), 4261));
      float dL = F.lu, dR = F.w - F.lu, dB = F.lv, dT = 56.0 - F.lv;
      float dmin = dL; int kmin = eL;
      if (dR < dmin) { dmin = dR; kmin = eR; } if (dB < dmin) { dmin = dB; kmin = eB; } if (dT < dmin) { dmin = dT; kmin = eT; }
      float cropIn = min(min(dL - edgeHalf(eL) - edgeGrass(eL), dR - edgeHalf(eR) - edgeGrass(eR)), min(dB - edgeHalf(eB) - edgeGrass(eB), dT - edgeHalf(eT) - edgeGrass(eT)));
      float n1 = gNoise(P * 0.5), nf = gNoise(P * 2.3 + 5.0);
      vec3 grass = base * (0.92 + 0.14 * n1);
      // the margin's grass, longer, with poppies and cornflowers here and there
      { float id; float fl = gDots(P, 0.45, 0.16, px, 3.0, id); grass = mix(grass, gLin(id < 0.5 ? vec3(0.85, 0.1, 0.07) : vec3(0.35, 0.45, 0.9)), fl * step(id, 0.12) * 0.9); }
      grass = mix(gLin(vec3(0.42, 0.62, 0.24)) * (0.92 + 0.14 * n1), grass, 0.4);
      vec3 fc;
      float across = F.along ? F.lv : F.lu, alongC = F.along ? F.lu : F.lv, len = F.along ? F.w : 56.0;
      float ripe = fHash(F.fx, F.row, 4270);
      // headlands: where the tractors turn, rows run the other way along the field's ends
      bool head = cropIn > 0.0 && (alongC < 10.0 + edgeHalf(F.along ? eL : eB) + edgeGrass(F.along ? eL : eB) || len - alongC < 10.0 + edgeHalf(F.along ? eR : eT) + edgeGrass(F.along ? eR : eT));
      int c = F.crop;
      float rowsC = head && (c == 5 || c == 6 || c == 10) ? alongC : across, rowsA = head && (c == 5 || c == 6 || c == 10) ? across : alongC;
      // soil: crumbly, damp and dry patches
      float sn = gO(gNoise(P * 3.3), 3.3, px) * 0.6 + gO(gNoise(P * 9.1), 9.1, px) * 0.4;
      vec3 soil = gLin(vec3(0.52, 0.39, 0.27)) * (0.9 + 0.1 * gNoise(P * 0.15) + 0.1 * (sn - 0.5));
      float pid, prd;
      if (c == 0) {          // corn: rows of tall leafy plants on dark soil, their edges ragged with leaves
        float r = gRows(rowsC, rowsA, 1.5, 0.66, 0.4, px), lf = gO(gNoise(vec2(rowsC * 2.3, rowsA * 3.1)), 3.1, px);
        fc = mix(soil * 0.72, gLin(mix(vec3(0.27, 0.45, 0.15), vec3(0.42, 0.5, 0.2), ripe)) * (0.8 + 0.35 * lf), r); gBump += r * 0.18;
      } else if (c == 1) {   // vegetables: cabbages in rows, pale hearts in dark outer leaves
        float cv = gPlants(rowsC, rowsA, 0.9, 0.78, 0.44, px, 9.0, pid, prd);
        vec3 lc = gLin(mix(vec3(0.3, 0.48, 0.3), vec3(0.42, 0.56, 0.3), pid)) * (0.78 + 0.4 * (1.0 - prd * prd));
        fc = mix(soil, lc, cv); gBump += cv * (1.0 - prd * prd) * 0.12;
      } else if (c == 2) {   // young crop: fine green drills, the soil between
        float r = gRows(rowsC, rowsA, 0.5, 0.42, 0.3, px);
        fc = mix(soil, gLin(vec3(0.4, 0.6, 0.2)) * (0.85 + 0.25 * nf), r * (0.75 + 0.2 * ripe)); gBump += r * 0.04;
      } else if (c == 3 || c == 4) {   // wheat, barley: a ripe carpet with tram lines; the wind runs waves over it
        vec3 a = c == 3 ? mix(vec3(0.86, 0.71, 0.33), vec3(0.78, 0.66, 0.3), ripe) : mix(vec3(0.76, 0.74, 0.44), vec3(0.7, 0.72, 0.4), ripe);
        float ear = gO(gNoise(P * 2.6 + ripe * 50.0), 2.6, px) * 0.55 + gO(gNoise(P * 7.0), 7.0, px) * 0.3 + gO(gNoise(P * 17.0), 17.0, px) * 0.15;
        vec2 wd = normalize(uGWind.xz + vec2(1e-4, 0.0));
        float wave = sin(dot(P, wd) * 0.22 - uGSway.w) * gNoise(P * 0.03 + uGTime * 0.05);
        fc = gLin(a) * (0.9 + 0.14 * ear + 0.08 * (gNoise(P * 0.09) - 0.5) + (0.06 + 0.02 * uGWind.w) * wave);
        float tram = max(gStripe(across + 0.9, 24.0, 0.018, px), gStripe(across - 0.9, 24.0, 0.018, px));
        fc = mix(fc, soil * 0.9, tram * 0.8);
        gBump += ear * 0.04;
      } else if (c == 5) {   // stubble after harvest: pale straw, mown swaths shading softly one into the next
        float sw = 0.5 + 0.5 * sin(rowsC * 1.047 + gNoise(vec2(rowsA * 0.05, rowsC * 0.1)) * 1.5);
        float lines = gRows(rowsC, rowsA, 0.25, 0.4, 0.3, px);
        fc = gLin(vec3(0.84, 0.77, 0.52)) * (0.88 + 0.07 * sw + 0.05 * lines + 0.08 * (nf - 0.5));
        fc = mix(fc, soil, 0.1 * smoothstep(0.55, 0.85, gNoise(P * 0.7)));
      } else if (c == 6) {   // hay meadow, mown in broad soft stripes, some swaths raked into windrows
        float sw = 0.5 + 0.5 * sin(rowsC * 1.2566 + gNoise(vec2(rowsA * 0.04, rowsC * 0.07)) * 1.2);
        float wr = gRows(rowsC + 2.5, rowsA, 10.0, 0.11, 0.06, px) * step(0.5, ripe);
        fc = grass * (0.92 + 0.12 * sw); fc = mix(fc, gLin(vec3(0.68, 0.7, 0.36)) * (0.85 + 0.3 * nf), wr * 0.85); gBump += wr * 0.2;
      } else if (c == 7) {   // sunflowers: dark green rows, golden heads
        float r = gRows(rowsC, rowsA, 1.2, 0.72, 0.35, px), hd = gPlants(rowsC, rowsA, 1.2, 0.55, 0.3, px, 21.0, pid, prd);
        fc = mix(soil * 0.8, gLin(vec3(0.3, 0.45, 0.16)) * (0.85 + 0.3 * nf), r);
        fc = mix(fc, mix(gLin(vec3(0.98, 0.76, 0.1)), gLin(vec3(0.35, 0.22, 0.08)), step(prd, 0.45)), r * hd * 0.95);
      } else if (c == 8) {   // lavender: rounded bushes in rows, grey-green under the purple spikes
        float cv = gPlants(rowsC, rowsA, 1.6, 0.95, 0.46, px, 27.0, pid, prd);
        vec3 lv = gLin(mix(vec3(0.55, 0.4, 0.78), vec3(0.46, 0.35, 0.7), pid)) * (0.85 + 0.25 * nf);
        fc = mix(soil * 0.9, mix(lv, gLin(vec3(0.48, 0.53, 0.42)), smoothstep(0.65, 0.95, prd)), cv); gBump += cv * (1.0 - prd * prd) * 0.25;
      } else if (c == 9) {   // tulips: bands of colour across the rows, a flower on every plant
        float bh = fHash(int(floor(alongC / 3.5)), F.fx, 4280);
        vec3 tc = bh < 0.2 ? vec3(0.9, 0.12, 0.12) : bh < 0.4 ? vec3(0.98, 0.84, 0.15) : bh < 0.6 ? vec3(0.95, 0.45, 0.65) : bh < 0.8 ? vec3(0.97, 0.95, 0.92) : vec3(0.98, 0.5, 0.1);
        float r = gRows(across, alongC, 0.7, 0.6, 0.25, px), fl = gPlants(across, alongC, 0.7, 0.2, 0.4, px, 31.0, pid, prd);
        fc = mix(soil, gLin(vec3(0.35, 0.52, 0.25)), r); fc = mix(fc, gLin(tc) * (0.85 + 0.2 * pid), r * (0.45 + 0.55 * fl));
      } else {               // ploughed: rounded furrows that wander a little, clods on their ridges
        float ph = rowsC * 13.96 + gNoise(vec2(rowsA * 0.15, rowsC * 0.05)) * 2.0;
        float fa = smoothstep(1.4, 0.4, fwidth(ph)), ridge = (sin(ph) * 0.5 + 0.5);
        float cl = gO(gNoise(P * 4.0), 4.0, px) * 0.6 + gO(gNoise(P * 11.0), 11.0, px) * 0.4;
        fc = soil * (0.86 + 0.22 * (ridge - 0.5) * fa + 0.25 * (cl - 0.5) * (0.6 + 0.4 * ridge)); gBump += (ridge * 0.06 * fa + cl * 0.05);
      }
      float drift = (fHash(F.fx, F.row, 4271) - 0.5) * 0.08;
      fc *= 1.0 + drift;
      fc = mix(fc, base * (0.96 + 0.08 * v1), 0.28);   // softer rows: the field's own colour shows through
      // the field's edge: hedge bottom, dry-stone wall, or the grass margin
      vec3 edge = grass;
      float aw = max(0.25, px * 0.8);   // edges smoothed over the pixel's footprint
      float onEdge = 1.0 - smoothstep(edgeHalf(kmin) - aw, edgeHalf(kmin) + aw, dmin);
      if (kmin == 0) edge = mix(grass, gLin(vec3(0.16, 0.27, 0.11)) * (0.75 + 0.5 * n1), onEdge);
      else if (kmin == 2) { float st = gNoise(P * 3.3); edge = mix(grass, gLin(vec3(0.6, 0.58, 0.54)) * (0.7 + 0.45 * st), onEdge); gBump += st * 0.3 * onEdge; }
      float inside = smoothstep(-aw, aw, cropIn);
      col = mix(col, mix(edge, fc, inside), farm);
    }
    gBump = gBump * smoothstep(0.4, 0.05, px) * 0.6 + gBumpL * 0.8 + gSnowH;
    diffuseColor.rgb = col;
  }
`;

const BUMP_MAIN = /* glsl */`
  {   // (phones: the snow's swells only; no branch round it - derivatives need every pixel of the quad)
    // bump from the detail's height (derivatives across the pixel), as three's bump map does
    #ifdef GD_LITE
    float bH = gSnowH;
    #else
    float bH = gBump;
    #endif
    vec3 sp = -vViewPosition, sx = dFdx(sp), sy = dFdy(sp);
    vec2 dH = vec2(dFdx(bH), dFdy(bH)) * 0.9;
    vec3 R1 = cross(sy, normal), R2 = cross(normal, sx);
    float det = dot(sx, R1) * faceDirection;
    vec3 grad = sign(det) * (dH.x * R1 + dH.y * R2);
    normal = normalize(abs(det) * normal - grad);
  }
`;

/**
 * Adds the ground detail to a terrain material (MeshStandardMaterial with vertex colours; geometry with aSurfA, aSurfB).
 * lite (phones, Medium): one layer of flowers, no glitter or big stones, no relief shading.
 * Apply it last of the material's wrappers, so the detail is drawn before the surf and the rain darken it.
 */
let noiseTex = null;
/** The shared random texture (render flag 'noise'; render/ground-noise.js makes its bytes, the worker the same). */
export function groundNoise() {
  if (noiseTex) return noiseTex;
  noiseTex = new THREE.DataTexture(noiseBytes(), 256, 256, THREE.RGBAFormat, THREE.UnsignedByteType);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping; noiseTex.minFilter = noiseTex.magFilter = THREE.LinearFilter; noiseTex.generateMipmaps = false;
  noiseTex.colorSpace = THREE.NoColorSpace; noiseTex.needsUpdate = true;
  return noiseTex;
}

export function groundDetail(material, { lite = false, sea = -1e4, map = null, bake = null } = {}) {
  const prev = material.onBeforeCompile, ntex = rf('noise');
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    if (ntex) sh.uniforms.uGNoise = { value: groundNoise() };
    if (bake) sh.uniforms.uGBake = { value: bake };
    if (map) { sh.uniforms.uGMA = { value: map.A }; sh.uniforms.uGMB = { value: map.B }; sh.uniforms.uGMR = { value: map.rect }; }
    sh.uniforms.uGTime = GU.uTime; sh.uniforms.uGWind = GU.uWind; sh.uniforms.uGSway = GU.uSway; sh.uniforms.uGDay = GU.uDay; sh.uniforms.uGSea = { value: sea };
    sh.vertexShader = 'attribute vec4 aSurfA, aSurfB;\nvarying vec4 vSurfA, vSurfB;\nvarying vec3 vGPos;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vGPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vSurfA = aSurfA; vSurfB = aSurfB;');
    sh.fragmentShader = DETAIL_GLSL + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n${DETAIL_MAIN}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${BUMP_MAIN}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += gGlow;');
    sh.fragmentShader = (lite ? '#define GD_LITE\n' : '') + (map ? '#define GD_MAP\n' : '') + (ntex ? '#define GD_NTEX\n' : '') + (bake ? '#define GD_BAKE\n' : '') + sh.fragmentShader;
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|ground3${lite ? '-lite' : ''}${map ? '-map' : ''}${ntex ? '-nt' : ''}${bake ? '-bk' : ''}`;
  if (map) material.userData.gm = map;
  return material;
}
