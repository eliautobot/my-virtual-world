// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Marks on the water (the fishing game's polish, 2026-10-15 - the product owner: "the water splashing and water trails
// need some serious work … the splashes are way too basic, and so is the trail"): what boats, fish and splashes do to
// the surface, drawn from above into a map round the view every frame - white water (foam), the surface lifted and
// hollowed (waves: a wake's arms and the waves between them, rings spreading from a splash, the bow wave) and churned,
// bubbly water (aerated: milky, paler - a propeller's track). The sea's and the lakes' own shaders read it
// (MARKS_GLSL), so the marks ride their waves and are lit as water is, not strips laid over it.
// The map: RGBA8 - r foam, g the surface raised, b lowered (HMAX m at full), a aerated; added up where marks overlap.
// Redrawn from scratch each frame from what is live (nothing kept from frame to frame), so it can follow the view.
import * as THREE from 'three';
import { bus } from '../core/state.js';
import { GU } from './scene.js';

export const HMAX = 0.3;   // m of rise (or fall) a channel's full value stands for

const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1); blank.needsUpdate = true;
/** The map and where it lies (x0, z0, size m, texels across - 0: nothing to draw), for the water's materials. */
const HN = 4;   // hulls the water keeps out of at once (the nearest)
export const MARKS_U = {
  uMarks: { value: blank }, uMarksRect: { value: new THREE.Vector4(0, 0, 1, 0) }, uFoamTex: { value: blank },
  uHullM: { value: Array.from({ length: HN }, () => new THREE.Matrix4()) }, uHullS: { value: Array.from({ length: HN }, () => new THREE.Vector4()) },
  uHullT: { value: Array.from({ length: HN }, () => new THREE.Vector4()) }, uHullN: { value: 0 },
};

// Noise, for the marks' own shaders.
const NOISE_GLSL = /* glsl */`
float mkHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float mkN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mkHash(i), mkHash(i + vec2(1.0, 0.0)), f.x), mix(mkHash(i + vec2(0.0, 1.0)), mkHash(i + vec2(1.0, 1.0)), f.x), f.y); }
`;

/**
 * For a water material's shaders: mkAt(p) - the marks at world p (x, z): foam cover, aeration, the surface's slope -
 * and mkFoam(p, cover, px) - white water as it looks: solid where it is thick, a lacy web where it thins, flecks as it
 * goes; px: a pixel's size there (m), so it never sparkles from afar.
 */
export const MARKS_GLSL = /* glsl */`
uniform sampler2D uMarks, uFoamTex;
uniform vec4 uMarksRect;
uniform mat4 uHullM[${HN}];
uniform vec4 uHullS[${HN}], uHullT[${HN}];
uniform int uHullN;
// Whether p (the water's surface, in the world) is inside a boat's hull (2026-10-15, the product owner: "the water tends
// to go through the hull" - a wave higher than the cockpit's sole showed in it): the water there is not drawn. The hull
// as render/vessels.js lofts it - its beam along it, its sheer, its V down to the keel - in the boat's own frame
// (uHullM: the world into it); uHullS: L, B, free board at the transom, draft; uHullT: transom beam, rise to the bow, x, z.
bool mkDry(vec3 p) {
  for (int i = 0; i < ${HN}; i++) {
    if (i >= uHullN) break;
    vec4 S = uHullS[i], T = uHullT[i];
    vec2 d = p.xz - T.zw;
    if (dot(d, d) > S.x * S.x * 0.3) continue;
    vec3 q = (uHullM[i] * vec4(p, 1.0)).xyz;
    float t = q.z / S.x + 0.5;
    if (t < 0.0 || t > 1.0) continue;
    float fw = t > 0.55 ? pow(max(0.0, 1.0 - (t - 0.55) / 0.45), 0.75) : 1.0, af = T.x + (1.0 - T.x) * min(1.0, t / 0.3);
    float b = S.y * 0.5 * min(fw, af), s = S.z + T.y * t * t, k = S.w * (t > 0.85 ? 1.0 - (t - 0.85) / 0.15 * 0.8 : 1.0);
    if (q.y > s) continue;
    float hw = q.y >= 0.0 ? b * (0.93 + 0.07 * clamp(q.y / s, 0.0, 1.0)) : b * 0.93 * max(0.0, 1.0 + q.y / max(k, 0.05));
    if (abs(q.x) < hw - 0.03) return true;
  }
  return false;
}
void mkAt(vec2 p, out float foam, out float aer, out vec2 slope) {
  foam = 0.0; aer = 0.0; slope = vec2(0.0);
  if (uMarksRect.w < 0.5) return;
  vec2 uv = (p - uMarksRect.xy) / uMarksRect.z;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return;
  float e = smoothstep(0.0, 0.07, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));   // (faded out toward its edges)
  float t = 1.0 / uMarksRect.w;
  vec4 m = texture2D(uMarks, uv), mx = texture2D(uMarks, uv + vec2(t, 0.0)), mz = texture2D(uMarks, uv + vec2(0.0, t));
  float h = m.g - m.b;
  slope = vec2(mx.g - mx.b - h, mz.g - mz.b - h) * (${HMAX.toFixed(2)} / (uMarksRect.z * t)) * e;
  foam = m.r * e; aer = m.a * e;
}
// (the foam's pattern from a tiling texture, foamTexture(): three lookups - working its webs out per pixel cost the
// phone a third of its frame rate, 2026-10-15)
float mkFoam(vec2 p, float c, float px, float tm) {
  if (c < 0.004) return 0.0;
  vec4 lo = texture2D(uFoamTex, p * (1.0 / 61.0) + vec2(tm * 0.0015, -tm * 0.001));
  vec2 w = (lo.ba - 0.5) * 0.16;   // (drifting, warped)
  vec4 a = texture2D(uFoamTex, p * (1.0 / 12.8) + w);
  float b = texture2D(uFoamTex, p * (1.0 / 12.8) + w * 1.4 + vec2(0.37, 0.61)).g;
  float web = a.r * 0.6 + b * 0.4, bl = a.b * 0.7 + lo.b * 0.3;
  // (patches shape it, the web laces their edges: thinning foam breaks into islands of lace and flecks, not a net)
  float n = web * 0.35 + bl * 0.65, cc = min(c, 1.0), th = 1.0 - cc * 1.08;
  float f = smoothstep(th - 0.05, th + 0.12, n) * smoothstep(0.0, 0.15, c);
  f *= 0.7 + 0.3 * smoothstep(0.2, 0.8, n);   // (thick foam is still bubbles: brighter on its ridges)
  return mix(f, cc * 0.8, smoothstep(0.12, 0.6, px));   // (from afar: its cover, softly)
}
`;

/**
 * The foam's pattern, tiling (N px a side): r a web of foam (16 cells across), g a finer one (37), b soft patches,
 * a slow swirls (for warping). Worked out once, mipmapped.
 */
function foamTexture(N = 256) {
  const d = new Uint8Array(N * N * 4), sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const hash = (x, y, s) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const web = (u, v, C, s) => {
    const x = u * C, y = v * C, ix = Math.floor(x), iy = Math.floor(y); let d1 = 9, d2 = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j, wx = ((cx % C) + C) % C, wy = ((cy % C) + C) % C;
      const dd = (cx + 0.1 + 0.8 * hash(wx, wy, s) - x) ** 2 + (cy + 0.1 + 0.8 * hash(wx, wy, s + 7) - y) ** 2;
      if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
    }
    return 1 - sm(0, 0.32, Math.sqrt(d2) - Math.sqrt(d1));
  };
  const vn = (u, v, C, s) => {
    const x = u * C, y = v * C, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => hash(((ix + i) % C + C) % C, ((iy + j) % C + C) % C, s);
    return (at(0, 0) * (1 - ux) + at(1, 0) * ux) * (1 - uy) + (at(0, 1) * (1 - ux) + at(1, 1) * ux) * uy;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N, o = (y * N + x) * 4;
    d[o] = web(u, v, 16, 1) * 255; d[o + 1] = web(u, v, 37, 2) * 255;
    d[o + 2] = (vn(u, v, 8, 3) * 0.5 + vn(u, v, 16, 4) * 0.3 + vn(u, v, 32, 5) * 0.2) * 255;
    d[o + 3] = (vn(u, v, 3, 6) * 0.6 + vn(u, v, 6, 7) * 0.4) * 255;
  }
  const t = new THREE.DataTexture(d, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// The marks' own shaders: every mark draws straight into the map (no camera: its x, z to the map's place).
const VERT = /* glsl */`
attribute vec4 aA, aB;
uniform vec4 uMkR;
varying vec4 vA, vB;
varying vec2 vW;
void main() { vA = aA; vB = aB; vW = position.xz; gl_Position = vec4((position.xz - uMkR.xy) / uMkR.z * 2.0 - 1.0, 0.0, 1.0); }`;
const OUT = /* glsl */`gl_FragColor = vec4(clamp(foam, 0.0, 1.0), max(h, 0.0) / ${HMAX.toFixed(2)}, max(-h, 0.0) / ${HMAX.toFixed(2)}, clamp(aer, 0.0, 1.0));`;

// Rings and patches (instanced quads): a splash's rings of waves spreading, its foam and stirred water.
const SPOT_VERT = /* glsl */`
attribute vec4 iR, iS, iT;
uniform vec4 uMkR;
varying vec4 vR, vS, vT;
varying vec2 vW;
void main() {
  vR = iR; vS = iS; vT = iT;
  vec2 w = iR.xy + position.xz * (iR.z + iS.x * 2.2 + iS.w * 1.3 + 0.1);
  vW = w; gl_Position = vec4((w - uMkR.xy) / uMkR.z * 2.0 - 1.0, 0.0, 1.0);
}`;
const SPOT_FRAG = /* glsl */`
uniform float uT;
varying vec4 vR, vS, vT;
varying vec2 vW;
${NOISE_GLSL}
void main() {
  // vR: x, z, the leading ring's radius, its height (m); vS: wavelength, the ring's foam, the patch's foam, the patch's
  // radius; vT: the patch's stirred water
  float d = distance(vW, vR.xy), lam = max(vS.x, 0.02), x = (vR.z - d) / lam;   // (wavelengths in behind the leading crest)
  float env = smoothstep(-0.4, 0.05, x) * (1.0 - smoothstep(0.9, 2.4, x)) * smoothstep(0.0, lam * 0.8, d);
  float h = vR.w * cos(6.2832 * x) * env * exp(-0.55 * max(x, 0.0));
  float n = mkN(vW * 5.0 + vR.xy) * 0.6 + mkN(vW * 11.0 - uT * 0.7) * 0.4;
  float foam = vS.y * exp(-x * x / 0.05) * smoothstep(0.25, 0.65, n);
  float pr = max(vS.w, 0.01), dd = d + (n - 0.5) * pr * 0.7;
  float pat = 1.0 - smoothstep(pr * 0.45, pr, dd);
  foam += vS.z * pat * (0.55 + 0.45 * n);
  float aer = vT.x * (1.0 - smoothstep(pr * 0.6, pr * 1.35, dd));
  ${OUT}
}`;

const SPOTS = 128;
const ADD = { side: THREE.DoubleSide, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, depthTest: false, depthWrite: false, transparent: true };

class WaterMarks {
  constructor(stage) {
    this.stage = stage;
    const N = this.N = stage.q?.name === 'high' ? 1024 : 512;
    this.rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
    this.rt.texture.name = 'water-marks';
    MARKS_U.uFoamTex.value = foamTexture();
    this.scene = new THREE.Scene(); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this.uMkR = { value: new THREE.Vector4(0, 0, 1, N) };
    this.users = new Set();   // () => true while it has marks to draw
    this.level = 0;           // the water's height where the view looks (the latest mark's)
    // the splashes' rings and patches
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3)); g.setIndex([0, 2, 1, 0, 3, 2]);
    this.sR = new Float32Array(SPOTS * 4); this.sS = new Float32Array(SPOTS * 4); this.sT = new Float32Array(SPOTS * 4);
    for (const [k, a] of [['iR', this.sR], ['iS', this.sS], ['iT', this.sT]]) g.setAttribute(k, new THREE.InstancedBufferAttribute(a, 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    this.spots = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: SPOT_VERT, fragmentShader: SPOT_FRAG, uniforms: { uMkR: this.uMkR, uT: GU.uTime }, ...ADD }));
    this.spots.frustumCulled = false; this.scene.add(this.spots);
    this.live = [];   // the splashes' spots: { x, z, y, t, life, r, amp, lam, foam, pfoam, pr, aer, plife }
    // the hulls' laps
    const lg = new THREE.InstancedBufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3)); lg.setIndex([0, 2, 1, 0, 3, 2]);
    this.lA = new Float32Array(LAPS * 4); this.lB = new Float32Array(LAPS * 4);
    lg.setAttribute('iA', new THREE.InstancedBufferAttribute(this.lA, 4).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('iB', new THREE.InstancedBufferAttribute(this.lB, 4).setUsage(THREE.DynamicDrawUsage));
    lg.instanceCount = 0;
    this.laps = new THREE.Mesh(lg, new THREE.ShaderMaterial({ vertexShader: LAP_VERT, fragmentShader: LAP_FRAG, uniforms: { uMkR: this.uMkR, uT: GU.uTime }, ...ADD }));
    this.laps.frustumCulled = false; this.scene.add(this.laps);
    this.users.add(() => this._laps() > 0);
    bus.on('frame', dt => this.render(dt));
  }
  /** The hulls within the map now, into the laps' instances; how many. */
  _laps() {
    const W = this.win, near = HC.near || [];
    let n = 0;
    if (W) for (const [, e] of near) {
      if (n >= LAPS) break;
      const M = hullMatrix(e).elements, x = M[12], z = M[14], F = e.form, r = F.L * 0.5 + 6;
      if (x < W[0] - r || z < W[1] - r || x > W[0] + W[2] + r || z > W[1] + W[2] + r) continue;
      const fl = Math.hypot(M[8], M[10]) || 1, o = n * 4;
      this.lA[o] = x; this.lA[o + 1] = z; this.lA[o + 2] = M[8] / fl; this.lA[o + 3] = M[10] / fl;
      this.lB[o] = F.L; this.lB[o + 1] = F.B; this.lB[o + 2] = Math.min(1, Math.abs(e.vy) / 0.35); this.lB[o + 3] = 1 - Math.min(1, e.sp / 4);
      n++;
    }
    const g = this.laps.geometry; g.instanceCount = n;
    if (n) { g.attributes.iA.needsUpdate = true; g.attributes.iB.needsUpdate = true; }
    return n;
  }
  /** A material for marks drawn by others (ribbons, a hull): frag sets foam, h (m), aer from vA, vB, vW, uT. */
  material(frag) {
    return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: `uniform float uT;\nvarying vec4 vA, vB;\nvarying vec2 vW;\n${NOISE_GLSL}\nvoid main() {\n  float foam = 0.0, h = 0.0, aer = 0.0;\n${frag}\n  ${OUT}\n}`, uniforms: { uMkR: this.uMkR, uT: GU.uTime }, ...ADD });
  }
  /** Draws mesh into the map while live() says so. */
  add(mesh, live) { mesh.frustumCulled = false; this.scene.add(mesh); this.users.add(live); }
  /** Whether (x, z) is in the map now (with margin m to spare). */
  covers(x, z, margin = 0) { const [x0, z0, size] = this.win || this.place(); return x > x0 + margin && z > z0 + margin && x < x0 + size - margin && z < z0 + size - margin; }
  /**
   * A splash's mark at (x, y, z): rings of waves spreading to r m over life s (amp m high, lam m apart, foam on the
   * first), a patch of foam pr m across (pfoam) and stirred water (aer) fading over plife s.
   */
  splash(x, y, z, { r = 2, life = 1.6, amp = 0.04, lam = 0.3, foam = 0, pfoam = 0, pr = 0.4, aer = 0, plife = 2 } = {}) {
    if (this.live.length >= SPOTS) this.live.shift();
    this.live.push({ x, z, t: GU.uTime.value, life, r, amp, lam, foam, pfoam, pr, aer, plife });
    this.level = y;
  }
  /** Where the map goes this frame: round where the view meets the water, as wide as it reaches from there. */
  place() {
    const c = this.stage.camera, f = c.getWorldDirection(_v), p = c.position, y = this.level;
    let hx, hz, dist;
    if (f.y < -0.02 && (p.y - y) / -f.y < 600) { const k = (p.y - y) / -f.y; hx = p.x + f.x * k; hz = p.z + f.z * k; dist = Math.hypot(k * f.x, p.y - y, k * f.z); }
    else { const l = Math.hypot(f.x, f.z) || 1; hx = p.x + f.x / l * 60; hz = p.z + f.z / l * 60; dist = 60; }
    const max = this.N >= 1024 ? 288 : 208, size = Math.min(max, Math.max(48, Math.ceil(dist * 2.8 / 16) * 16)), px = size / this.N;
    const x0 = Math.floor((hx - size / 2) / px) * px, z0 = Math.floor((hz - size / 2) / px) * px;
    return [x0, z0, size];
  }
  render() {
    const now = GU.uTime.value;
    this.live = this.live.filter(s => now - s.t < Math.max(s.life, s.plife));
    let on = this.live.length > 0;
    for (const f of this.users) if (f()) on = true;
    const R = MARKS_U.uMarksRect.value, [x0, z0, size] = this.win = this.place();   // (placed even when idle: covers())
    if (!on) { R.w = 0; return; }
    this.uMkR.value.set(x0, z0, size, this.N);
    // the splashes: their rings out, their foam going
    const n = this.live.length;
    for (let i = 0; i < n; i++) {
      const s = this.live[i], a = now - s.t, u = Math.min(1, a / s.life), q = Math.min(1, a / s.plife), o = i * 4;
      const rr = s.r * (1 - (1 - u) ** 1.8);   // (fast at first, slowing)
      this.sR[o] = s.x; this.sR[o + 1] = s.z; this.sR[o + 2] = rr; this.sR[o + 3] = s.amp * (1 - u) ** 1.5 * Math.min(1, a / 0.06);
      this.sS[o] = s.lam * (1 + u * 0.6); this.sS[o + 1] = s.foam * (1 - u) ** 2.5; this.sS[o + 2] = s.pfoam * (1 - q) ** 1.6; this.sS[o + 3] = s.pr * (0.6 + 0.6 * Math.sqrt(q));
      this.sT[o] = s.aer * (1 - q) ** 1.3;
    }
    const g = this.spots.geometry; g.instanceCount = n;
    for (const k of ['iR', 'iS', 'iT']) g.attributes[k].needsUpdate = true;
    const r = this.stage.renderer, prev = r.getRenderTarget(), cc = r.getClearColor(_c), ca = r.getClearAlpha();
    r.setRenderTarget(this.rt); r.setClearColor(0x000000, 0); r.clear(true, false, false);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev); r.setClearColor(cc, ca);
    MARKS_U.uMarks.value = this.rt.texture; R.set(x0, z0, size, this.N);
  }
}
const _v = new THREE.Vector3(), _c = new THREE.Color();

// ------------------------------------------------------------------ the hulls in the water
/**
 * The boats in the water, by key: the water keeps out of their hulls (mkDry) and laps at them - a line of foam where
 * the hull meets it, rings spreading as it bobs (the marks, while a map is drawn). obj: an Object3D whose world matrix
 * is the boat's (read when the water is drawn), else m: its matrix now (copied); form: its hull (render/boat-models.js
 * HULL_FORM). Call every frame it is there; one not seen for half a second is gone.
 */
export function hullAt(key, form, { obj = null, m = null } = {}) {
  let e = HULLS.get(key);
  if (!e) HULLS.set(key, e = { m: new THREE.Matrix4(), obj: null, form, y: null, vy: 0, sp: 0, px: null, pz: null, at: 0 });
  e.obj = obj; e.form = form; if (m) e.m.copy(m);
  e.t = GU.uTime.value;
}
export function hullGone(key) { HULLS.delete(key); }
const HULLS = new Map(), HC = { at: -1 };
const hullMatrix = e => (e.obj ? e.obj.matrixWorld : e.m);
/** The nearest hulls to the water's shaders (an onBeforeRender of the water's meshes: once a frame, the boats placed). */
export function hullsUpdate() {
  const now = GU.uTime.value;
  if (now === HC.at) return;
  const dt = Math.max(1e-3, Math.min(0.2, now - HC.at)); HC.at = now;
  const c = GU.uCamP.value, near = [];
  for (const [k, e] of HULLS) {
    if (now - e.t > 0.5) { HULLS.delete(k); continue; }
    const M = hullMatrix(e).elements, x = M[12], y = M[13], z = M[14];
    // how it moves: bobbing (m/s up and down) and its speed over the water, smoothed
    if (e.y !== null) { const a = Math.min(1, dt * 5); e.vy += ((y - e.y) / dt - e.vy) * a; e.sp += (Math.hypot(x - e.px, z - e.pz) / dt - e.sp) * a; }
    e.y = y; e.px = x; e.pz = z;
    near.push([(x - c.x) ** 2 + (z - c.z) ** 2, e]);
  }
  near.sort((a, b) => a[0] - b[0]);
  const U = MARKS_U, n = Math.min(HN, near.length);
  for (let i = 0; i < n; i++) {
    const e = near[i][1], F = e.form, M = hullMatrix(e);
    U.uHullM.value[i].copy(M).invert(); U.uHullS.value[i].set(F.L, F.B, F.free, F.draft); U.uHullT.value[i].set(F.transom, F.rise, M.elements[12], M.elements[14]);
  }
  U.uHullN.value = n;
  HC.near = near;
}
// the water lapping at each hull (instanced quads in the marks' map): a lacy line of foam where it meets the water, rings
// spreading as it bobs; quieter as it gets under way (the wake takes over: render/boat-fx.js)
const LAP_VERT = /* glsl */`
attribute vec4 iA, iB;   // x, z, its heading's sin, cos; L, B, how hard it bobs (0..1), how still (1 at rest)
uniform vec4 uMkR;
varying vec2 vQ, vW;
varying vec4 vB;
void main() {
  vec2 h = vec2(iB.y * 0.5 + 5.0, iB.x * 0.5 + 5.0), q = position.xz * h;   // (across, along: out to its rings' reach)
  vec2 w = iA.xy + vec2(q.x * iA.w + q.y * iA.z, -q.x * iA.z + q.y * iA.w);
  vQ = q; vW = w; vB = iB;
  gl_Position = vec4((w - uMkR.xy) / uMkR.z * 2.0 - 1.0, 0.0, 1.0);
}`;
const LAP_FRAG = /* glsl */`
uniform float uT;
varying vec2 vQ, vW;
varying vec4 vB;
${NOISE_GLSL}
void main() {
  float L = vB.x, B = vB.y, t = vQ.y / L + 0.5;
  // its waterline's half-beam along it (as render/vessels.js lofts it), and how far out of it this is
  float tc = clamp(t, 0.0, 1.0), fw = tc > 0.55 ? pow(max(0.0, 1.0 - (tc - 0.55) / 0.45), 0.75) : 1.0, af = 0.88 + 0.12 * min(1.0, tc / 0.3);
  float hw = B * 0.465 * min(fw, af), d = max(abs(vQ.x) - hw, max(-t, t - 1.0) * L);
  float bob = vB.z, still = vB.w, n = mkN(vW * 2.6 + uT * 0.6) * 0.6 + mkN(vW * 6.0 - uT * 0.9) * 0.4;
  float out_ = smoothstep(-0.25, 0.0, d);
  float foam = (0.6 + 0.9 * bob) * (1.0 - smoothstep(0.0, 0.28 + 0.4 * bob, d + (n - 0.5) * 0.2)) * out_ * (0.6 + 0.7 * n);
  // (and a fainter skirt of it further out, broken up)
  foam += (0.25 + 0.4 * bob) * (1.0 - smoothstep(0.2, 0.9 + 0.6 * bob, d)) * out_ * smoothstep(0.45, 0.8, n);
  float h = (0.02 + 0.07 * bob) * sin(d * 7.0 - uT * 4.5) * exp(-d / 2.2) * smoothstep(-0.1, 0.3, d) * (1.0 - smoothstep(3.5, 5.0, d));
  foam *= still; h *= still;
  float aer = foam * 0.4;
  ${OUT}
}`;
const LAPS = 24;

let one = null;
/** The marks (one for the page). */
export function waterMarks(stage) { return (one ||= new WaterMarks(stage)); }
