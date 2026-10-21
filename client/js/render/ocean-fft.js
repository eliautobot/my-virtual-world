// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The ocean's waves (2026-10-03, with the reference video "Three.js Water Pro V3": "we gotta make it look that good
// ... far LOD while keeping up performance"): real ocean waves worked out on the GPU every frame, the way films and games
// do it (J. Tessendorf, "Simulating Ocean Water", 2001): a spectrum of waves for the wind (JONSWAP, from the North Sea
// measurements of Hasselmann et al., 1973) plus a long swell from far away, turned into the sea's surface by an inverse
// FFT. Three sizes at once ("cascades": swell, waves, ripples), each tiling the sea seamlessly with its own period, so
// together they never visibly repeat. Each cascade gives three maps of the surface:
//   displacement (x, y, z, foam): choppy — crests sharpen and troughs widen; foam where the surface folds over (a
//     whitecap), kept and fading where it formed, so it trails behind the crest that broke;
//   slopes (dy/dx, dy/dz, dx/dx, dz/dz): the light, per pixel.
// Mipmapped, so from afar the waves average out to a calm, slightly rougher sea instead of shimmering. All in WebGL2
// fragment passes on half-float targets: one to move the spectrum on in time, log2(n) butterflies each way (Stockham,
// both directions in one atlas holding every cascade side by side), one to assemble each cascade's maps.
import * as THREE from 'three';

const G = 9.81;
/** The waves repeat every LOOP_S seconds (their frequencies are rounded to it): keeps the GPU's phases precise. */
const LOOP_S = 240;

/** A seeded random stream: the sea's phases are fixed; the wind only scales and turns its waves. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function lgamma(x) {
  let s = 0;
  while (x < 7) { s -= Math.log(x); x += 1; }
  return s + (x - 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI) + 1 / (12 * x) - 1 / (360 * x ** 3);
}
/** Directional spreading (cos^2s of half the angle off the wave's heading), normalised over the circle. */
function spread(th, s) {
  const c = Math.abs(Math.cos(th / 2));
  return Math.exp(2 * lgamma(s + 1) - lgamma(2 * s + 1) + (2 * s - 1) * Math.LN2) / Math.PI * c ** (2 * s);
}
/** JONSWAP's shape at angular frequency w for a peak wp (unscaled: the caller sets the height). */
function jonswap(w, wp, gamma = 3.3) {
  const sigma = w <= wp ? 0.07 : 0.09, r = Math.exp(-((w - wp) ** 2) / (2 * sigma * sigma * wp * wp));
  return Math.exp(-1.25 * (wp / w) ** 4) * gamma ** r / w ** 5;
}

/**
 * The sea state for a weather: wind (m/s) and where it blows to (radians, x toward z), the wind sea's significant
 * height (fetch-limited JONSWAP over `fetch` m of open water) and peak, and a long swell rolling in from offshore.
 */
export function seaState({ wind = 3, dir = 0, storm = 0, fetch = 30000, swellH = 0.75, swellLen = 140, swellDir = null } = {}) {
  // (2026-10-03: "a big improvement on the waves ... on the sea": a calm day still has a long swell rolling through
  // and a lively wind sea on it — the waves read from the shore and from the air)
  const U = Math.max(2.5, wind + 9 * storm);
  return {
    windDir: dir,
    windHs: Math.min(3.4, 0.0024 * U * Math.sqrt(fetch / G) * (1 + 0.6 * storm)),
    windWp: 22 * Math.pow(G * G / (U * fetch), 1 / 3),
    swellHs: swellH * (1 + 1.5 * storm),
    swellWp: Math.sqrt(G * 2 * Math.PI / swellLen),
    swellDir: swellDir ?? dir + 0.35,
  };
}

const QUAD_VS = /* glsl */`
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Moves the spectrum on to time uT and writes the eight fields' spectra, two to a complex number (A + iB: after the
// inverse transform, A is the real part and B the imaginary, both fields being real).
const TIME_FS = /* glsl */`
precision highp float; precision highp int;
uniform sampler2D uH0A, uH0B;
uniform float uT, uW0, uMix;
uniform vec3 uL;
uniform int uN;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
vec2 cm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 iB(vec2 b) { return vec2(-b.y, b.x); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int c = p.x / uN, i = p.x - c * uN, j = p.y;
  float L = c == 0 ? uL.x : c == 1 ? uL.y : uL.z;
  vec2 k = 6.2831853 / L * vec2(float(i < uN / 2 ? i : i - uN), float(j < uN / 2 ? j : j - uN));
  float kl = length(k);
  vec4 h0 = mix(texelFetch(uH0A, p, 0), texelFetch(uH0B, p, 0), uMix);   // (a change of wind: waves are linear in the spectrum)
  float w = floor(sqrt(9.81 * kl) / uW0) * uW0, ph = w * uT;
  vec2 e = vec2(cos(ph), sin(ph));
  vec2 h = cm(h0.xy, e) + cm(h0.zw, vec2(e.x, -e.y));
  vec2 u = kl > 1e-6 ? k / kl : vec2(0.0);
  float ik = kl > 1e-6 ? 1.0 / kl : 0.0;
  vec2 mi = vec2(h.y, -h.x), pi = vec2(-h.y, h.x);   // -i h, i h
  vec2 Dx = mi * u.x, Dz = mi * u.y, Dy = h;
  vec2 Dyx = pi * k.x, Dyz = pi * k.y;
  vec2 Dxx = h * (k.x * k.x * ik), Dzz = h * (k.y * k.y * ik), Dxz = h * (k.x * k.y * ik);
  o0 = vec4(Dx + iB(Dz), Dy + iB(Dxz));
  o1 = vec4(Dyx + iB(Dyz), Dxx + iB(Dzz));
}`;

// One butterfly stage of the inverse FFT along x (within each cascade's block) or z (Stockham: in and out in order).
const FFT_FS = /* glsl */`
precision highp float; precision highp int;
uniform sampler2D uA, uB;
uniform int uN, uS, uHoriz;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
vec2 cm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int base = uHoriz == 1 ? (p.x / uN) * uN : 0;
  int idx = uHoriz == 1 ? p.x - base : p.y;
  int hs = uS / 2;
  int ev = (idx / uS) * hs + (idx % hs), od = ev + uN / 2;
  ivec2 pe = uHoriz == 1 ? ivec2(base + ev, p.y) : ivec2(p.x, ev);
  ivec2 po = uHoriz == 1 ? ivec2(base + od, p.y) : ivec2(p.x, od);
  float a = 6.2831853 * float(idx % uS) / float(uS);
  vec2 tw = vec2(cos(a), sin(a));
  vec4 ea = texelFetch(uA, pe, 0), oa = texelFetch(uA, po, 0), eb = texelFetch(uB, pe, 0), ob = texelFetch(uB, po, 0);
  o0 = vec4(ea.xy + cm(tw, oa.xy), ea.zw + cm(tw, oa.zw));
  o1 = vec4(eb.xy + cm(tw, ob.xy), eb.zw + cm(tw, ob.zw));
}`;

// A cascade's maps from the transformed fields; foam where the surface folds (its Jacobian drops toward zero), kept and
// fading where it formed.
const ASSEMBLE_FS = /* glsl */`
precision highp float; precision highp int;
uniform sampler2D uA, uB, uPrev;
uniform int uN, uC;
uniform float uLambda, uDecay, uFoamBias, uFoamGain;
layout(location = 0) out vec4 oDisp;
layout(location = 1) out vec4 oDer;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), q = ivec2(uC * uN + p.x, p.y);
  vec4 a = texelFetch(uA, q, 0), b = texelFetch(uB, q, 0);   // a: Dx, Dz, Dy, Dxz; b: Dyx, Dyz, Dxx, Dzz
  float jxx = 1.0 + uLambda * b.z, jzz = 1.0 + uLambda * b.w, jxz = uLambda * a.w;
  float J = jxx * jzz - jxz * jxz;
  float foam = max(texelFetch(uPrev, p, 0).w * uDecay, clamp((uFoamBias - J) * uFoamGain, 0.0, 1.0));
  oDisp = vec4(a.x * uLambda, a.z, a.y * uLambda, foam);
  oDer = vec4(b.x, b.y, uLambda * b.z, uLambda * b.w);
}`;

// Probes: the surface's height and slope at a few points (boats riding the waves), packed into bytes for a read back.
/** How many points the boats' probe answers a frame. */
export const PROBES = 96;   // (a boat's hull: 35; the moored nearest: 18; a lure, checks)
const PROBE_FS = /* glsl */`
precision highp float; precision highp int;
uniform sampler2D uD0, uD1, uD2, uDr0, uDr1;
uniform vec3 uL;
uniform float uAmp, uN, uW2;
uniform vec4 uPts[96];
out vec4 oCol;
// the sea as its mesh is displaced near the camera (OCEAN_GLSL ocDisp with a metre's sample): all three cascades, each
// as finely as the mesh takes it (2026-10-15: the finest left out, and the others sharper than drawn, the boats rode a
// sea a little different from the one on the screen)
float ocLod(float L) { return max(0.0, log2(uN / L)); }
vec3 disp(vec2 p) {
  return textureLod(uD0, p / uL.x, ocLod(uL.x)).xyz + textureLod(uD1, p / uL.y, ocLod(uL.y)).xyz + textureLod(uD2, p / uL.z, ocLod(uL.z)).xyz * uW2;
}
void main() {
  int i = int(gl_FragCoord.x);
  vec2 p = uPts[i].xy;
  // (where the displacement moved the water from: two steps back)
  vec2 q = p - disp(p).xz * uAmp;
  q = p - disp(q).xz * uAmp;
  float h = disp(q).y * uAmp * uPts[i].z;
  vec2 s = (textureLod(uDr0, q / uL.x, 2.0).xy + textureLod(uDr1, q / uL.y, 3.0).xy) * uAmp * uPts[i].z;
  float hv = clamp(h / 16.0 + 0.5, 0.0, 1.0) * 65535.0;
  oCol = vec4(floor(hv / 256.0) / 255.0, mod(hv, 256.0) / 255.0, clamp(s * 2.0 + 0.5, 0.0, 1.0));
}`;

export class OceanWaves {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{ n?: number, sizes?: number[], seed?: number, lambda?: number }} opts n: samples across each cascade (a
   *   power of two); sizes: each cascade's tile (m), coarsest first — waves shorter than ~6 of a finer tile's cells
   *   belong to the finer one, so none is counted twice.
   */
  constructor(renderer, { n = 128, sizes = [512, 64, 13], seed = 7, lambda = 1.1 } = {}) {
    this.r = renderer; this.n = n; this.sizes = sizes.slice(0, 3); this.C = this.sizes.length; this.lambda = lambda;
    while (this.sizes.length < 3) this.sizes.push(1e6);
    this.seed = seed; this.stages = Math.round(Math.log2(n));
    this.t = 0; this.frame = 0;
    const W = n * this.C;
    const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false, count: 2 };
    this.ping = [new THREE.WebGLRenderTarget(W, n, rtOpts), new THREE.WebGLRenderTarget(W, n, rtOpts)];
    // each cascade's maps, twice (this frame's and last frame's foam)
    this.maps = [];
    for (let c = 0; c < this.C; c++) {
      const pair = [0, 1].map(() => {
        const rt = new THREE.WebGLRenderTarget(n, n, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, count: 2 });
        for (const t of rt.textures) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4; }
        return rt;
      });
      this.maps.push(pair);
    }
    // the spectrum at t = 0 (h0(k) and conj(h0(−k))), two of them to blend while the wind changes
    this.h0 = [0, 1].map(() => { const t = new THREE.DataTexture(new Float32Array(W * n * 4), W, n, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; return t; });
    this.gauss = this._gauss(W * n);
    // passes
    const mat = (fs, uniforms) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: QUAD_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    const L = new THREE.Vector3(...this.sizes);
    this.timeMat = mat(TIME_FS, { uH0A: { value: this.h0[0] }, uH0B: { value: this.h0[0] }, uMix: { value: 1 }, uT: { value: 0 }, uW0: { value: 2 * Math.PI / LOOP_S }, uL: { value: L }, uN: { value: n } });
    this.fftMat = mat(FFT_FS, { uA: { value: null }, uB: { value: null }, uN: { value: n }, uS: { value: 2 }, uHoriz: { value: 1 } });
    this.asmMat = mat(ASSEMBLE_FS, { uA: { value: null }, uB: { value: null }, uPrev: { value: null }, uN: { value: n }, uC: { value: 0 }, uLambda: { value: lambda }, uDecay: { value: 0.985 }, uFoamBias: { value: 0.55 }, uFoamGain: { value: 2.2 } });
    this.quad = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)), this.timeMat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.Camera();
    /** For the materials that draw the sea: this frame's maps and the cascades' sizes. */
    this.uniforms = {
      uOcD0: { value: this.maps[0][0].textures[0] }, uOcD1: { value: this.maps[Math.min(1, this.C - 1)][0].textures[0] }, uOcD2: { value: this.maps[this.C - 1][0].textures[0] },
      uOcN0: { value: this.maps[0][0].textures[1] }, uOcN1: { value: this.maps[Math.min(1, this.C - 1)][0].textures[1] }, uOcN2: { value: this.maps[this.C - 1][0].textures[1] },
      uOcL: { value: L }, uOcAmp: { value: 1 }, uOcN: { value: n },
    };
    this.state = null; this.fadeS = 1;
    // probes (boats): positions in, heights and slopes out a frame or two later
    this.probeRT = new THREE.WebGLRenderTarget(PROBES, 1, { depthBuffer: false, stencilBuffer: false });
    const w2 = this.C >= 3 ? 1 - THREE.MathUtils.smoothstep(1, L.z / 24, L.z / 6) : 0;   // (the finest cascade as the mesh near the camera takes it)
    this.probeMat = mat(PROBE_FS, { uD0: { value: null }, uD1: { value: null }, uD2: { value: null }, uDr0: { value: null }, uDr1: { value: null }, uL: { value: L }, uAmp: this.uniforms.uOcAmp, uN: { value: n }, uW2: { value: w2 }, uPts: { value: Array.from({ length: PROBES }, () => new THREE.Vector4()) } });
    this.probeBuf = new Uint8Array(PROBES * 4); this.probeBusy = false; this.probeOut = new Float32Array(PROBES * 3); this.probeCount = 0;
  }
  _gauss(count) {
    const r = rng(this.seed * 7919 + 13), g = new Float32Array(count * 4);
    for (let i = 0; i < count * 4; i += 2) { const u = Math.max(1e-9, r()), v = r(), m = Math.sqrt(-2 * Math.log(u)); g[i] = m * Math.cos(2 * Math.PI * v); g[i + 1] = m * Math.sin(2 * Math.PI * v); }
    return g;
  }
  /**
   * The spectrum for a sea state (see seaState()); blends to it over `fadeS` seconds. Each component (wind sea, swell)
   * is scaled so its significant height comes out as asked.
   */
  setSea(state, fadeS = 4) {
    const n = this.n, W = n * this.C, raw = new Float32Array(W * n * 2), dk2 = this.sizes.map(L => (2 * Math.PI / L) ** 2);
    const kBand = c => [c === 0 ? 1e-6 : 2 * Math.PI / this.sizes[c] * 6, c + 1 < this.C ? 2 * Math.PI / this.sizes[c + 1] * 6 : 1e9];
    let m0w = 0, m0s = 0;
    for (let c = 0; c < this.C; c++) {
      const L = this.sizes[c], [k0, k1] = kBand(c);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const kx = 2 * Math.PI / L * (i < n / 2 ? i : i - n), kz = 2 * Math.PI / L * (j < n / 2 ? j : j - n), k = Math.hypot(kx, kz), o = (j * W + c * n + i) * 2;
        if (k < k0 || k >= k1) continue;
        const w = Math.sqrt(G * k), dwdk = G / (2 * w), th = Math.atan2(kz, kx), cut = Math.exp(-((k * 0.012) ** 2));
        // wind sea: spreading narrow at the peak, wider for the short waves (Mitsuyasu)
        const sw = 9 * Math.pow(w / state.windWp, w <= state.windWp ? 5 : -2.5) + 0.6;
        raw[o] = jonswap(w, state.windWp) * spread(th - state.windDir, sw) * dwdk / k * cut * dk2[c];
        // swell: long, narrow, steady
        raw[o + 1] = jonswap(w, state.swellWp, 6) * spread(th - state.swellDir, 24) * dwdk / k * cut * dk2[c];
        m0w += raw[o]; m0s += raw[o + 1];
      }
    }
    const sw = m0w > 0 ? (state.windHs / 4) ** 2 / m0w : 0, ss = m0s > 0 ? (state.swellHs / 4) ** 2 / m0s : 0;
    // into the spare spectrum: h0(k) = ξ·sqrt(S Δk² / 4) (ξ: a complex gaussian; with its partner at −k each wave
    // gets the variance S Δk²), and conj(h0(−k)); then blended to from the one shown
    const T = this.timeMat.uniforms, shown = T.uH0B.value, next = shown === this.h0[0] ? this.h0[1] : this.h0[0], d = next.image.data, g = this.gauss;
    for (let c = 0; c < this.C; c++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const o = j * W + c * n + i, a = Math.sqrt(Math.max(0, raw[o * 2] * sw + raw[o * 2 + 1] * ss) / 4);
      const im = (n - i) % n, jm = (n - j) % n, om = jm * W + c * n + im, am = Math.sqrt(Math.max(0, raw[om * 2] * sw + raw[om * 2 + 1] * ss) / 4);
      d[o * 4] = g[o * 4] * a; d[o * 4 + 1] = g[o * 4 + 1] * a;
      d[o * 4 + 2] = g[om * 4] * am; d[o * 4 + 3] = -g[om * 4 + 1] * am;
    }
    next.needsUpdate = true;
    T.uH0A.value = this.state ? shown : next; T.uH0B.value = next; T.uMix.value = this.state ? 0 : 1;
    // whitecaps come easier as the wind rises: scattered on a breezy day, everywhere in a gale
    // (capped: the bigger waves of a gale fold more by themselves; more than this laid a net of foam over everything)
    this.asmMat.uniforms.uFoamBias.value = Math.min(0.74, 0.5 + 0.28 * state.windHs);
    this.fadeS = Math.max(0.1, fadeS);
    this.state = state;
  }
  _pass(material, target) { this.quad.material = material; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }
  /** Moves the sea on to time t (s). Call once a frame before drawing. */
  update(t, dt) {
    if (!this.state) return;
    const T = this.timeMat.uniforms; if (T.uMix.value < 1) T.uMix.value = Math.min(1, T.uMix.value + dt / this.fadeS);
    const r = this.r, prevRT = r.getRenderTarget(), prevXR = r.xr.enabled, ac = r.autoClear;
    r.xr.enabled = false; r.autoClear = false;
    this.timeMat.uniforms.uT.value = ((t % LOOP_S) + LOOP_S) % LOOP_S;
    let src = this.ping[0], dst = this.ping[1];
    this._pass(this.timeMat, src);
    const F = this.fftMat.uniforms;
    for (const horiz of [1, 0]) for (let s = 0; s < this.stages; s++) {
      F.uA.value = src.textures[0]; F.uB.value = src.textures[1]; F.uS.value = 2 << s; F.uHoriz.value = horiz;
      this._pass(this.fftMat, dst); [src, dst] = [dst, src];
    }
    const A = this.asmMat.uniforms, k = (this.frame + 1) & 1;
    A.uA.value = src.textures[0]; A.uB.value = src.textures[1]; A.uDecay.value = Math.exp(-Math.min(dt, 0.1) / 3.2);
    for (let c = 0; c < this.C; c++) {
      A.uC.value = c; A.uPrev.value = this.maps[c][1 - k].textures[0];
      this._pass(this.asmMat, this.maps[c][k]);
    }
    this.frame++;
    const U = this.uniforms, m = c => this.maps[Math.min(c, this.C - 1)][k];
    U.uOcD0.value = m(0).textures[0]; U.uOcD1.value = m(1).textures[0]; U.uOcD2.value = m(2).textures[0];
    U.uOcN0.value = m(0).textures[1]; U.uOcN1.value = m(1).textures[1]; U.uOcN2.value = m(2).textures[1];
    this._probe(k);
    r.setRenderTarget(prevRT); r.xr.enabled = prevXR; r.autoClear = ac;
  }
  /**
   * Asks for the surface at up to PROBES points ({ x, z, k }: k scales the waves there, e.g. the shallows' damping); the
   * answers (height, slope x, slope z) arrive a frame or two later in probeOut, in the order asked.
   */
  probe(points) {
    const P = this.probeMat.uniforms.uPts.value, n = Math.min(PROBES, points.length);
    for (let i = 0; i < n; i++) P[i].set(points[i].x, points[i].z, points[i].k ?? 1, 0);
    this.probeWant = n;
  }
  _probe(k) {
    if (!this.probeWant || this.probeBusy) return;
    const U = this.probeMat.uniforms, n = this.probeWant;
    U.uD0.value = this.maps[0][k].textures[0]; U.uD1.value = this.maps[Math.min(1, this.C - 1)][k].textures[0]; U.uD2.value = this.maps[this.C - 1][k].textures[0];
    U.uDr0.value = this.maps[0][k].textures[1]; U.uDr1.value = this.maps[Math.min(1, this.C - 1)][k].textures[1];
    this._pass(this.probeMat, this.probeRT);
    this.probeBusy = true;
    this.r.readRenderTargetPixelsAsync(this.probeRT, 0, 0, PROBES, 1, this.probeBuf).then(() => {
      const b = this.probeBuf, o = this.probeOut;
      for (let i = 0; i < n; i++) { o[i * 3] = ((b[i * 4] * 256 + b[i * 4 + 1]) / 65535 - 0.5) * 16; o[i * 3 + 1] = (b[i * 4 + 2] / 255 - 0.5) / 2; o[i * 3 + 2] = (b[i * 4 + 3] / 255 - 0.5) / 2; }
      this.probeCount = n; this.probeBusy = false;
    }, () => { this.probeBusy = false; });
  }
  dispose() {
    for (const rt of [...this.ping, ...this.maps.flat(), this.probeRT]) rt.dispose();
    for (const t of this.h0) t.dispose();
    for (const m of [this.timeMat, this.fftMat, this.asmMat, this.probeMat]) m.dispose();
    this.quad.geometry.dispose();
  }
}

/**
 * GLSL for the sea's materials (uniforms from OceanWaves.uniforms): the displacement at a point (vertex), the slopes and
 * foam (fragment). Each cascade fades out where it would be finer than what's drawn there: `px` is the size (m) of what
 * one vertex or pixel covers.
 */
export const OCEAN_GLSL = /* glsl */`
uniform sampler2D uOcD0, uOcD1, uOcD2, uOcN0, uOcN1, uOcN2;
uniform vec3 uOcL;
uniform float uOcAmp, uOcN;
// how much of a cascade shows when one sample covers px metres (its waves span its tile over the map's texels)
float ocW(float L, float px) { return 1.0 - smoothstep(L / 24.0, L / 6.0, px); }
vec3 ocDisp(vec2 p, float px) {
  vec3 d = vec3(0.0);
  float w0 = ocW(uOcL.x * 4.0, px), w1 = ocW(uOcL.y, px), w2 = ocW(uOcL.z, px);
  if (w0 > 0.0) d += textureLod(uOcD0, p / uOcL.x, max(0.0, log2(px * uOcN / uOcL.x))).xyz * w0;
  if (w1 > 0.0) d += textureLod(uOcD1, p / uOcL.y, max(0.0, log2(px * uOcN / uOcL.y))).xyz * w1;
  if (w2 > 0.0) d += textureLod(uOcD2, p / uOcL.z, max(0.0, log2(px * uOcN / uOcL.z))).xyz * w2;
  return d * uOcAmp;
}
// slopes (x, z), stretching (dx/dx, dz/dz) and foam at a point; the hardware's mipmaps average the waves out with distance
void ocSurf(vec2 p, float px, out vec2 slope, out vec2 stretch, out float foam) {
  vec4 n0 = texture(uOcN0, p / uOcL.x), n1 = texture(uOcN1, p / uOcL.y), n2 = texture(uOcN2, p / uOcL.z);
  float w1 = ocW(uOcL.y * 2.0, px), w2 = ocW(uOcL.z * 2.0, px);
  slope = (n0.xy + n1.xy * w1 + n2.xy * w2) * uOcAmp;
  stretch = (n0.zw + n1.zw * w1 + n2.zw * w2) * uOcAmp;
  foam = texture(uOcD0, p / uOcL.x).w + texture(uOcD1, p / uOcL.y).w * w1;
  #ifdef OC_FOAM2
  foam += texture(uOcD2, p / uOcL.z).w * w2 * 0.5;
  #endif
}`;
